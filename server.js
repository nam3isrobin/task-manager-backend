/**
 * ==============================================================================
 * Production Express Task Manager Server (`server.js`)
 * ==============================================================================
 * Comprehensive REST API backend for the Day 19 Task Manager application.
 *
 * Core Capabilities & Assignment Implementations:
 * - Core: Full CRUD operations for Tasks with MongoDB persistence via Mongoose.
 * - Assignment 1: Edit task title via PUT /tasks/:id.
 * - Assignment 2: Strict category taxonomy ('Work', 'Personal', 'Urgent') with
 *   'Personal' as default, including category filtering via GET /tasks?category=...
 * - Assignment 3: Chronological task sorting via query param `?sort=asc` or
 *   `?sort=desc` (defaulting to descending).
 * - Assignment 4: Multi-tenant user architecture via User model, endpoints
 *   `GET /users`, `POST /users`, relational linkage `userId`, and filtering via
 *   `GET /tasks?userId=...`.
 *
 * Resilience & Operational Standards:
 * - Express 5 compatible middleware and JSON payload body parsing.
 * - CORS enabled for cross-origin client integration.
 * - Static frontend serving from `./public`.
 * - Centralized asynchronous error handling and Mongoose CastError / ValidationError handling.
 * - Graceful shutdown handles for process SIGINT / SIGTERM signals.
 * ==============================================================================
 */

// Load environment variables before any module configuration
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');

// Import domain schemas
const User = require('./models/User');
const Task = require('./models/Task');
const { VALID_CATEGORIES } = require('./models/Task');

// Initialize Express application
const app = express();

// Configuration parameters with fallbacks
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/taskdb';

// ==============================================================================
// 1. Database Connection Management
// ==============================================================================

/**
 * Connect to MongoDB instance using Mongoose.
 * Provides connection state logging and error diagnostics.
 */
const connectDB = async () => {
  if (mongoose.connection.readyState >= 1) {
    return mongoose.connection;
  }

  try {
    const conn = await mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
      autoIndex: true
    });
    console.log(`[MongoDB] Connected to database: ${conn.connection.name} @ ${conn.connection.host}`);
    return conn;
  } catch (error) {
    console.error(`[MongoDB] Connection failed: ${error.message}`);
    // If not in a test environment, let the app fail fast if database is unreachable
    if (process.env.NODE_ENV !== 'test' && require.main === module) {
      process.exit(1);
    }
    throw error;
  }
};

// Initiate database connection
connectDB().catch((err) => {
  console.warn('[MongoDB] Initial connection pending or delayed:', err.message);
});

// ==============================================================================
// 2. Global Middleware Stack
// ==============================================================================

// Enable Cross-Origin Resource Sharing (CORS) for external clients
app.use(cors());

// Parse incoming JSON request bodies with payload size protection
app.use(express.json({ limit: '1mb' }));

// Parse URL-encoded bodies for standard HTML form submissions
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Serve static assets from the public directory (Frontend UI)
app.use(express.static(path.join(__dirname, 'public')));

// Explicit root route serving index.html to guarantee zero 'Cannot GET /' errors
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Request logging for diagnostics in development
if (process.env.NODE_ENV !== 'test') {
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
    next();
  });
}

// ==============================================================================
// 3. Health & Telemetry Endpoints
// ==============================================================================

/**
 * Health check endpoint for uptime monitors, Render health checks, and orchestration.
 * Route: GET /api/health (and alias GET /health)
 */
const healthHandler = (req, res) => {
  const dbState = mongoose.connection.readyState;
  const dbStatusMap = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting'
  };

  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    database: dbStatusMap[dbState] || 'unknown',
    timestamp: new Date().toISOString()
  });
};

app.get('/api/health', healthHandler);
app.get('/health', healthHandler);

// ==============================================================================
// 4. User API Endpoints (Assignment 4: Multiple Users Support)
// ==============================================================================

const userRouter = express.Router();

/**
 * GET /users (or /api/users)
 * Fetch all registered users in descending chronological order.
 */
userRouter.get('/', async (req, res, next) => {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    return res.status(200).json(users);
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /users (or /api/users)
 * Register a new user profile with a unique username and optional email.
 * Body: { username: string, email?: string }
 */
userRouter.post('/', async (req, res, next) => {
  try {
    const { username, email } = req.body;

    // Guard: Verify presence of mandatory username
    if (!username || typeof username !== 'string' || !username.trim()) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Username is required and cannot be empty'
      });
    }

    const trimmedUsername = username.trim();

    // Guard: Check for duplicate username proactively to return user-friendly message
    const existingUser = await User.findOne({ username: trimmedUsername });
    if (existingUser) {
      return res.status(409).json({
        error: 'Conflict',
        message: `Username '${trimmedUsername}' is already taken`
      });
    }

    // Persist new user entity
    const newUser = await User.create({
      username: trimmedUsername,
      email: email ? email.trim().toLowerCase() : ''
    });

    return res.status(201).json(newUser);
  } catch (error) {
    // Handle MongoDB duplicate key collision (E11000)
    if (error.code === 11000) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'A user with that username already exists'
      });
    }
    return next(error);
  }
});

// Mount user routes under both /users and /api/users for client flexibility
app.use('/users', userRouter);
app.use('/api/users', userRouter);

// ==============================================================================
// 5. Task API Endpoints (Full CRUD & Assignments 1-4)
// ==============================================================================

const taskRouter = express.Router();

/**
 * GET /tasks (or /api/tasks)
 * Retrieve tasks with support for:
 * - Assignment 2: Filtering by category (`?category=Work`)
 * - Assignment 3: Sorting by createdAt (`?sort=asc` or `?sort=desc`, default `desc`)
 * - Assignment 4: Filtering by userId (`?userId=...`) and populating user info
 * - Core: Filtering by completed status (`?completed=true` or `?completed=false`)
 */
taskRouter.get('/', async (req, res, next) => {
  try {
    const { userId, category, completed, sort } = req.query;
    const filterQuery = {};

    // 1. Filter by userId (Assignment 4)
    if (userId) {
      if (!mongoose.Types.ObjectId.isValid(userId)) {
        return res.status(400).json({
          error: 'Bad Request',
          message: `Invalid userId format: '${userId}'`
        });
      }
      filterQuery.userId = userId;
    }

    // 2. Filter by category (Assignment 2)
    if (category) {
      // Check if provided category is valid
      const normalizedCategory = category.trim();
      filterQuery.category = normalizedCategory;
    }

    // 3. Filter by completion status (Core)
    if (completed !== undefined) {
      if (completed === 'true' || completed === true) {
        filterQuery.completed = true;
      } else if (completed === 'false' || completed === false) {
        filterQuery.completed = false;
      }
    }

    // 4. Chronological sorting (Assignment 3: default desc, asc if explicitly requested)
    const sortDirection = sort && sort.toLowerCase() === 'asc' ? 1 : -1;

    // Execute query with relational population of user details
    const tasks = await Task.find(filterQuery)
      .sort({ createdAt: sortDirection })
      .populate('userId', 'username email');

    return res.status(200).json(tasks);
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /tasks (or /api/tasks)
 * Create a new task.
 * Body: { title: string, category?: string, userId?: string, completed?: boolean }
 *
 * Validations:
 * - title: required, non-empty trimmed string.
 * - category: if provided, must be in ['Work', 'Personal', 'Urgent']. Default 'Personal'.
 * - userId: if provided, must be valid ObjectId corresponding to an existing User.
 */
taskRouter.post('/', async (req, res, next) => {
  try {
    const { title, category, userId, completed } = req.body;

    // Guard: Validate title requirement
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Task title is required and cannot be empty'
      });
    }

    // Guard: Validate category if explicitly provided (Assignment 2)
    let taskCategory = 'Personal';
    if (category !== undefined && category !== null && category !== '') {
      if (!VALID_CATEGORIES.includes(category)) {
        return res.status(400).json({
          error: 'Validation Error',
          message: `Invalid category '${category}'. Allowed values: ${VALID_CATEGORIES.join(', ')}`
        });
      }
      taskCategory = category;
    }

    // Guard: Validate userId if provided (Assignment 4)
    let assignedUserId = null;
    if (userId) {
      if (!mongoose.Types.ObjectId.isValid(userId)) {
        return res.status(400).json({
          error: 'Bad Request',
          message: `Invalid userId format: '${userId}'`
        });
      }
      // Verify user actually exists in the database
      const existingUser = await User.findById(userId);
      if (!existingUser) {
        return res.status(404).json({
          error: 'Not Found',
          message: `Associated user with id '${userId}' does not exist`
        });
      }
      assignedUserId = userId;
    }

    // Create task document
    const createdTask = await Task.create({
      title: title.trim(),
      category: taskCategory,
      userId: assignedUserId,
      completed: Boolean(completed)
    });

    // Populate user references before returning response
    const populatedTask = await Task.findById(createdTask._id).populate('userId', 'username email');

    return res.status(201).json(populatedTask);
  } catch (error) {
    return next(error);
  }
});

/**
 * PUT /tasks/:id (or /api/tasks/:id)
 * Update existing task properties:
 * - Assignment 1: Edit task title.
 * - Core / Assignment 2: Update completed status or category.
 *
 * Parameters:
 * - :id: Task ObjectId
 * Body: { title?: string, completed?: boolean, category?: string, userId?: string }
 */
taskRouter.put('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    // Guard: Validate Task ObjectId parameter
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Invalid task ID format: '${id}'`
      });
    }

    const { title, completed, category, userId } = req.body;
    const updateFields = {};

    // Validate and apply title modification (Assignment 1)
    if (title !== undefined) {
      if (typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'Task title cannot be empty'
        });
      }
      updateFields.title = title.trim();
    }

    // Validate and apply completed toggle
    if (completed !== undefined) {
      updateFields.completed = Boolean(completed);
    }

    // Validate and apply category modification (Assignment 2)
    if (category !== undefined) {
      if (!VALID_CATEGORIES.includes(category)) {
        return res.status(400).json({
          error: 'Validation Error',
          message: `Invalid category '${category}'. Allowed values: ${VALID_CATEGORIES.join(', ')}`
        });
      }
      updateFields.category = category;
    }

    // Validate and apply userId re-assignment (Assignment 4)
    if (userId !== undefined) {
      if (userId === null || userId === '') {
        updateFields.userId = null;
      } else {
        if (!mongoose.Types.ObjectId.isValid(userId)) {
          return res.status(400).json({
            error: 'Bad Request',
            message: `Invalid userId format: '${userId}'`
          });
        }
        const userExists = await User.findById(userId);
        if (!userExists) {
          return res.status(404).json({
            error: 'Not Found',
            message: `User with id '${userId}' not found`
          });
        }
        updateFields.userId = userId;
      }
    }

    // Ensure at least one valid field was provided to update
    if (Object.keys(updateFields).length === 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'No updatable fields provided in request body'
      });
    }

    // Execute atomic update with schema validators enabled (Mongoose 9 compatible)
    const updatedTask = await Task.findByIdAndUpdate(
      id,
      { $set: updateFields },
      { returnDocument: 'after', runValidators: true }
    ).populate('userId', 'username email');

    // Guard: Verify document existence
    if (!updatedTask) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Task with id '${id}' not found`
      });
    }

    return res.status(200).json(updatedTask);
  } catch (error) {
    return next(error);
  }
});

/**
 * DELETE /tasks/:id (or /api/tasks/:id)
 * Permanently delete a task by its ObjectId.
 */
taskRouter.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    // Guard: Validate Task ObjectId parameter
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Invalid task ID format: '${id}'`
      });
    }

    const deletedTask = await Task.findByIdAndDelete(id);

    // Guard: Verify document existence
    if (!deletedTask) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Task with id '${id}' not found`
      });
    }

    return res.status(200).json({
      message: 'Task deleted successfully',
      id: deletedTask._id
    });
  } catch (error) {
    return next(error);
  }
});

// Mount task routes under both /tasks and /api/tasks
app.use('/tasks', taskRouter);
app.use('/api/tasks', taskRouter);

// ==============================================================================
// 6. Centralized Error Handling & 404 Route Guards
// ==============================================================================

// Catch-all route for unhandled API and application endpoints
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.originalUrl}`
  });
});

/**
 * Global Error Handling Middleware.
 * Catches Mongoose CastError, ValidationError, JSON parser errors, and unhandled exceptions.
 */
app.use((err, req, res, next) => {
  // Diagnostic log for internal inspection
  if (process.env.NODE_ENV !== 'test') {
    console.error(`[Error] ${err.name}: ${err.message}`, err.stack);
  }

  // 1. Handle JSON syntax parse error from express.json()
  if (err.type === 'entity.parse.failed' || err.status === 400) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Malformed JSON payload provided in request body'
    });
  }

  // 2. Handle Mongoose invalid ObjectId CastError
  if (err.name === 'CastError') {
    return res.status(400).json({
      error: 'Bad Request',
      message: `Invalid format for field '${err.path}': '${err.value}'`
    });
  }

  // 3. Handle Mongoose Schema Validation Errors
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map((e) => e.message);
    return res.status(400).json({
      error: 'Validation Error',
      message: messages.join('; ')
    });
  }

  // 4. Default Internal Server Error response
  const statusCode = err.statusCode || err.status || 500;
  return res.status(statusCode).json({
    error: err.name || 'Internal Server Error',
    message: err.message || 'An unexpected error occurred on the server'
  });
});

// ==============================================================================
// 7. Server Listener & Process Signal Handlers
// ==============================================================================

let server = null;

// Only bind HTTP listener if script is executed directly (not required as module)
if (require.main === module) {
  const startServer = (portToTry) => {
    server = app.listen(portToTry, () => {
      console.log(`=======================================================`);
      console.log(` Task Manager Backend running on http://localhost:${portToTry}`);
      console.log(` Database: ${MONGO_URI}`);
      console.log(` Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`=======================================================`);
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        const nextPort = Number(portToTry) + 1;
        console.warn(`[Port Collision] Port ${portToTry} is in use by another process.`);
        console.log(`[Auto-Recovery] Attempting next port http://localhost:${nextPort}...`);
        startServer(nextPort);
      } else {
        console.error('[Server Error]', err.message);
        process.exit(1);
      }
    });
  };

  startServer(PORT);

  // Graceful shutdown handling
  const shutdown = async (signal) => {
    console.log(`\n[Process] Received ${signal}. Initiating graceful shutdown...`);
    if (server) {
      server.close(() => {
        console.log('[Server] HTTP listener closed.');
      });
    }
    try {
      await mongoose.connection.close(false);
      console.log('[MongoDB] Database connection closed.');
      process.exit(0);
    } catch (err) {
      console.error('[Shutdown Error]', err.message);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Export app and helper bindings for testing suites and programmatic runners
module.exports = app;
module.exports.app = app;
module.exports.connectDB = connectDB;
module.exports.server = server;
