/**
 * ==============================================================================
 * Production Express Task Manager Server (`server.js`)
 * ==============================================================================
 * Comprehensive REST API backend for the Day 19 Task Manager application.
 *
 * Core Capabilities & Assignments:
 * - Core: Full CRUD operations for Tasks with MongoDB persistence via Mongoose.
 * - Assignment 1: Edit task title via PUT /tasks/:id.
 * - Assignment 2: Strict category taxonomy ('Work', 'Personal', 'Urgent') with
 *   'Personal' as default, including category filtering via GET /tasks?category=...
 * - Assignment 3: Chronological task sorting via query param `?sort=asc` or
 *   `?sort=desc` (defaulting to descending).
 * - Assignment 4: Multi-tenant user architecture via User model, endpoints
 *   `GET /users`, `POST /users`, relational linkage `userId`.
 * - Day 19 Auth: JWT-based stateless authentication (`/auth/register`, `/auth/login`,
 *   `/auth/me`), bcrypt password hashing, and strict bearer token verification.
 * - Tenant Isolation: Strictly prevents cross-user task access (403 Forbidden).
 *
 * Resilience & Operational Standards:
 * - Express 5 compatible middleware and JSON payload body parsing.
 * - CORS enabled for cross-origin client integration.
 * - Static frontend serving from `./public` with fallback JSON status.
 * - Centralized asynchronous error handling and Mongoose CastError / ValidationError handling.
 * - Graceful shutdown handles for process SIGINT / SIGTERM signals.
 * ==============================================================================
 */

// Load environment variables before any module configuration
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

// Import domain schemas
const User = require('./models/User');
const Task = require('./models/Task');
const { VALID_CATEGORIES } = require('./models/Task');

// Initialize Express application
const app = express();

// Configuration parameters with fallbacks
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/taskdb';
const JWT_SECRET = process.env.JWT_SECRET || 'taskmanager_super_secret_jwt_key_2026';

// ==============================================================================
// 1. Database Connection Management
// ==============================================================================

// In-flight concurrency guards to prevent duplicate simultaneous connection/sync operations
let dbConnectionPromise = null;
let syncRootAdminPromise = null;

/**
 * Idempotent root administrator synchronization helper.
 * Enforces the Strict Single Root Administrator Invariant during system startup.
 * - Seeds the single root admin if not present using environment variables
 * - Synchronizes password hash and email if changed in environment
 */
const syncRootAdmin = async () => {
  if (syncRootAdminPromise) {
    return syncRootAdminPromise;
  }

  syncRootAdminPromise = (async () => {
    try {
      const adminUsername = process.env.ADMIN_USERNAME || 'admin';
      const adminPassword = process.env.ADMIN_PASSWORD || 'AdminPass123!';
      const adminEmail = process.env.ADMIN_EMAIL || 'admin@taskmaster.local';

      let adminUser = await User.findOne({ username: adminUsername }).select('+password');

      if (!adminUser) {
        // Guard: Check if an administrator already exists under an alternate username
        const existingAdmin = await User.findOne({ role: 'admin' });
        if (existingAdmin) {
          console.log(`[RootAdmin] Root administrator already exists as '${existingAdmin.username}'.`);
          return existingAdmin;
        }

        adminUser = await User.create({
          username: adminUsername,
          email: adminEmail,
          password: adminPassword,
          role: 'admin'
        });
        console.log(`[RootAdmin] Root administrator '${adminUsername}' initialized successfully.`);
        return adminUser;
      }

      // Existing admin account: verify if role, password, or email need updating
      let needsSave = false;
      if (adminUser.role !== 'admin') {
        adminUser.role = 'admin';
        needsSave = true;
      }
      if (adminEmail && adminUser.email !== adminEmail) {
        adminUser.email = adminEmail;
        needsSave = true;
      }
      const isPasswordMatch = await adminUser.comparePassword(adminPassword);
      if (!isPasswordMatch) {
        adminUser.password = adminPassword; // Pre-save hook rehashes
        needsSave = true;
      }

      if (needsSave) {
        await adminUser.save();
        console.log(`[RootAdmin] Root administrator '${adminUsername}' credentials updated.`);
      }

      return adminUser;
    } catch (error) {
      console.error(`[RootAdmin] Synchronization failed: ${error.message}`);
      throw error;
    } finally {
      syncRootAdminPromise = null;
    }
  })();

  return syncRootAdminPromise;
};

/**
 * Connect to MongoDB instance using Mongoose.
 * Provides connection state logging, auto-indexing, and root administrator synchronization.
 */
const connectDB = async () => {
  if (mongoose.connection.readyState === 1) {
    try {
      await syncRootAdmin();
    } catch (err) {
      console.warn('[RootAdmin] Sync notice:', err.message);
    }
    return mongoose.connection;
  }

  if (dbConnectionPromise) {
    return dbConnectionPromise;
  }

  dbConnectionPromise = (async () => {
    try {
      const conn = await mongoose.connect(MONGO_URI, {
        serverSelectionTimeoutMS: 5000,
        autoIndex: true
      });
      console.log(`[MongoDB] Connected to database: ${conn.connection.name} @ ${conn.connection.host}`);
      try {
        await syncRootAdmin();
      } catch (err) {
        console.warn('[RootAdmin] Sync notice:', err.message);
      }
      return conn;
    } catch (error) {
      console.error(`[MongoDB] Connection failed: ${error.message}`);
      // If not in a test environment, let the app fail fast if database is unreachable
      if (process.env.NODE_ENV !== 'test' && require.main === module) {
        process.exit(1);
      }
      throw error;
    } finally {
      dbConnectionPromise = null;
    }
  })();

  return dbConnectionPromise;
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

// Root route: serves frontend if present, otherwise returns clean API status
app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  return res.status(200).json({
    status: 'online',
    message: 'Task Manager API is running live',
    endpoints: {
      auth: {
        register: 'POST /auth/register',
        login: 'POST /auth/login',
        me: 'GET /auth/me'
      },
      tasks: '/tasks',
      users: '/users',
      health: '/api/health'
    }
  });
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
// 4. Authentication Middleware
// ==============================================================================

/**
 * authMiddleware (protect)
 * Protects downstream routes by verifying the JSON Web Token in the Authorization header.
 * Attaches the verified User document to `req.user`.
 */
const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    // Guard: Verify presence of Bearer authorization header
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'No authentication token provided. Please log in.'
      });
    }

    const token = authHeader.split(' ')[1];
    if (!token || !token.trim()) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'No authentication token provided. Please log in.'
      });
    }

    // Verify token validity and signature
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or expired authentication token'
      });
    }

    // Ensure the user corresponding to the token still exists in database
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'The user belonging to this token no longer exists'
      });
    }

    // Attach authenticated user document to request context
    req.user = user;
    return next();
  } catch (error) {
    return next(error);
  }
};

/**
 * adminMiddleware
 * Combines authentication token verification with strict administrator role authorization.
 * - If not authenticated -> 401 Unauthorized
 * - If authenticated but req.user.role !== 'admin' -> 403 Forbidden
 */
const adminMiddleware = async (req, res, next) => {
  try {
    // If request user is not already attached by authMiddleware, run authMiddleware first
    if (!req.user) {
      let authError = null;
      await new Promise((resolve) => {
        authMiddleware(req, res, (err) => {
          if (err) authError = err;
          resolve();
        });
      });

      if (authError) {
        return next(authError);
      }

      // If authMiddleware sent a response (e.g., 401 Unauthorized), stop execution
      if (res.headersSent) {
        return;
      }
    }

    // Enforce administrator privilege check
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Access denied: Administrator privileges required.'
      });
    }

    return next();
  } catch (error) {
    return next(error);
  }
};

// ==============================================================================
// 5. Authentication API Routes (/auth & /api/auth)
// ==============================================================================

const authRouter = express.Router();

/**
 * POST /auth/register (or /api/auth/register)
 * Registers a new user account with hashed password and signs a JWT token.
 * Body: { username: string, email?: string, password: string }
 */
authRouter.post('/register', async (req, res, next) => {
  try {
    const { username, email, password } = req.body;

    // Guard: Validate mandatory username field
    if (!username || typeof username !== 'string' || !username.trim()) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Username is required and cannot be empty'
      });
    }

    const trimmedUsername = username.trim();
    if (trimmedUsername.length < 2) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Username must be at least 2 characters long'
      });
    }

    // Guard: Validate mandatory password field and minlength
    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Password is required and must be at least 6 characters long'
      });
    }

    // Guard: Proactively check for duplicate username
    const existingUser = await User.findOne({ username: trimmedUsername });
    if (existingUser) {
      return res.status(409).json({
        error: 'Conflict',
        message: `Username '${trimmedUsername}' is already taken`
      });
    }

    // Persist new user entity (pre-save hook hashes the password)
    // Security Guard: Single Root Administrator Invariant - public registration strictly forces role: 'user'
    const newUser = await User.create({
      username: trimmedUsername,
      email: email && typeof email === 'string' ? email.trim().toLowerCase() : '',
      password,
      role: 'user'
    });

    // Generate signed JSON Web Token including user role
    const token = jwt.sign(
      { id: newUser._id, username: newUser.username, role: newUser.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        _id: newUser._id,
        id: newUser._id,
        username: newUser.username,
        email: newUser.email,
        role: newUser.role,
        createdAt: newUser.createdAt
      }
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'A user with that username already exists'
      });
    }
    return next(error);
  }
});

/**
 * POST /auth/login (or /api/auth/login)
 * Authenticates user credentials and returns a JWT session token.
 * Body: { username: string, password: string }
 */
authRouter.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;

    // Guard: Validate input presence
    if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Username and password are required'
      });
    }

    const trimmedUsername = username.trim();

    // Query user by username, explicitly including password field
    const user = await User.findOne({ username: trimmedUsername }).select('+password');
    if (!user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid username or password'
      });
    }

    // Verify candidate password against stored bcrypt hash
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid username or password'
      });
    }

    // Generate signed JWT token including user role
    const token = jwt.sign(
      { id: user._id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        _id: user._id,
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /auth/me (or /api/auth/me)
 * Retrieves currently authenticated user profile from token.
 */
authRouter.get('/me', authMiddleware, async (req, res) => {
  return res.status(200).json({
    user: {
      _id: req.user._id,
      id: req.user._id,
      username: req.user.username,
      email: req.user.email,
      role: req.user.role,
      createdAt: req.user.createdAt
    }
  });
});

// Mount authentication router
app.use('/auth', authRouter);
app.use('/api/auth', authRouter);

// ==============================================================================
// 6. User Profile Management API (/users & /api/users)
// ==============================================================================

const userRouter = express.Router();

/**
 * GET /users (or /api/users)
 * Fetch all registered users in descending chronological order (excluding passwords).
 */
userRouter.get('/', async (req, res, next) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    return res.status(200).json(users);
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /users (or /api/users)
 * Register a user profile (compatible with Assignment 4 endpoints).
 * Body: { username: string, email?: string, password?: string }
 */
userRouter.post('/', async (req, res, next) => {
  try {
    const { username, email, password } = req.body;

    if (!username || typeof username !== 'string' || !username.trim()) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Username is required and cannot be empty'
      });
    }

    const trimmedUsername = username.trim();
    const existingUser = await User.findOne({ username: trimmedUsername });
    if (existingUser) {
      return res.status(409).json({
        error: 'Conflict',
        message: `Username '${trimmedUsername}' is already taken`
      });
    }

    // Default password to secure fallback if not provided in legacy profile creation
    const userPassword = password && password.length >= 6 ? password : 'Password123!';

    const newUser = await User.create({
      username: trimmedUsername,
      email: email ? email.trim().toLowerCase() : '',
      password: userPassword,
      role: 'user'
    });

    const userObj = {
      _id: newUser._id,
      id: newUser._id,
      username: newUser.username,
      email: newUser.email,
      role: newUser.role,
      createdAt: newUser.createdAt
    };

    return res.status(201).json(userObj);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'A user with that username already exists'
      });
    }
    return next(error);
  }
});

app.use('/users', userRouter);
app.use('/api/users', userRouter);

// ==============================================================================
// 7. Protected Task API Endpoints (/tasks & /api/tasks)
// ==============================================================================

const taskRouter = express.Router();

// Enforce strict authentication on all task operations
taskRouter.use(authMiddleware);

/**
 * GET /tasks (or /api/tasks)
 * Retrieve tasks belonging strictly to the authenticated user.
 * Supports:
 * - Assignment 2: Category filter (`?category=Work`)
 * - Assignment 3: Chronological sorting (`?sort=asc` or `?sort=desc`, default `desc`)
 * - Core: Completed filter (`?completed=true` or `?completed=false`)
 */
taskRouter.get('/', async (req, res, next) => {
  try {
    const { category, completed, sort } = req.query;

    // Enforce tenant isolation: query strictly by authenticated user's ID
    const filterQuery = { userId: req.user._id };

    // 1. Filter by category (Assignment 2)
    if (category) {
      filterQuery.category = category.trim();
    }

    // 2. Filter by completion status (Core)
    if (completed !== undefined) {
      if (completed === 'true' || completed === true) {
        filterQuery.completed = true;
      } else if (completed === 'false' || completed === false) {
        filterQuery.completed = false;
      }
    }

    // 3. Chronological sorting (Assignment 3: default desc, asc if explicitly requested)
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
 * GET /tasks/:id (or /api/tasks/:id)
 * Retrieve a single task by ID with tenant isolation verification.
 */
taskRouter.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Invalid task ID format: '${id}'`
      });
    }

    const task = await Task.findById(id).populate('userId', 'username email');
    if (!task) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Task with id '${id}' not found`
      });
    }

    // Tenant isolation ownership guard
    const taskOwnerId = task.userId && task.userId._id ? task.userId._id.toString() : task.userId.toString();
    if (taskOwnerId !== req.user._id.toString()) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You are not authorized to view this task'
      });
    }

    return res.status(200).json(task);
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /tasks (or /api/tasks)
 * Create a new task strictly bound to the authenticated user.
 * Body: { title: string, category?: string, completed?: boolean }
 */
taskRouter.post('/', async (req, res, next) => {
  try {
    const { title, category, completed } = req.body;

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

    // Persist task strictly assigned to the authenticated user's ID
    const createdTask = await Task.create({
      title: title.trim(),
      category: taskCategory,
      userId: req.user._id,
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
 * Update existing task properties with ownership verification:
 * - Assignment 1: Edit task title.
 * - Core / Assignment 2: Update completed status or category.
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

    const task = await Task.findById(id);

    // Guard: Verify task existence
    if (!task) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Task with id '${id}' not found`
      });
    }

    // Guard: Tenant isolation ownership check (403 Forbidden on mismatch)
    if (task.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You are not authorized to update this task'
      });
    }

    const { title, completed, category } = req.body;
    let hasUpdates = false;

    // Validate and apply title modification (Assignment 1)
    if (title !== undefined) {
      if (typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'Task title cannot be empty'
        });
      }
      task.title = title.trim();
      hasUpdates = true;
    }

    // Validate and apply completed toggle
    if (completed !== undefined) {
      task.completed = Boolean(completed);
      hasUpdates = true;
    }

    // Validate and apply category modification (Assignment 2)
    if (category !== undefined) {
      if (!VALID_CATEGORIES.includes(category)) {
        return res.status(400).json({
          error: 'Validation Error',
          message: `Invalid category '${category}'. Allowed values: ${VALID_CATEGORIES.join(', ')}`
        });
      }
      task.category = category;
      hasUpdates = true;
    }

    if (!hasUpdates) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'No updatable fields provided in request body'
      });
    }

    // Persist updates
    await task.save();

    const updatedTask = await Task.findById(task._id).populate('userId', 'username email');
    return res.status(200).json(updatedTask);
  } catch (error) {
    return next(error);
  }
});

/**
 * DELETE /tasks/:id (or /api/tasks/:id)
 * Permanently delete a task by ID with ownership verification.
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

    const task = await Task.findById(id);

    // Guard: Verify task existence
    if (!task) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Task with id '${id}' not found`
      });
    }

    // Guard: Tenant isolation ownership check (403 Forbidden on mismatch)
    if (task.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You are not authorized to delete this task'
      });
    }

    await Task.findByIdAndDelete(id);

    return res.status(200).json({
      message: 'Task deleted successfully',
      id: task._id
    });
  } catch (error) {
    return next(error);
  }
});

// Mount task routes
app.use('/tasks', taskRouter);
app.use('/api/tasks', taskRouter);

// ==============================================================================
// 8. Administrator UI Static Serving & API Routes (/api/admin & /admin)
// ==============================================================================

/**
 * Static serving handler for the Administrator Dashboard.
 * Serves public/admin.html if present, otherwise redirects to /admin.html.
 */
app.get('/admin', (req, res) => {
  const adminPath = path.join(__dirname, 'public', 'admin.html');
  if (fs.existsSync(adminPath)) {
    return res.sendFile(adminPath);
  }
  return res.redirect('/admin.html');
});

const adminRouter = express.Router();

// Enforce admin privileges across all administrative endpoints
adminRouter.use(adminMiddleware);

/**
 * GET /api/admin/metrics (or /admin/metrics)
 * Returns operational telemetry and aggregate system metrics.
 */
adminRouter.get('/metrics', async (req, res, next) => {
  try {
    const [totalUsers, totalTasks, completedTasks] = await Promise.all([
      User.countDocuments(),
      Task.countDocuments(),
      Task.countDocuments({ completed: true })
    ]);

    const activeTasks = totalTasks - completedTasks;
    const completionRate = totalTasks > 0
      ? Math.round((completedTasks / totalTasks) * 10000) / 100
      : 0;

    const dbState = mongoose.connection.readyState;
    const dbStatusMap = {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting'
    };

    return res.status(200).json({
      totalUsers,
      totalTasks,
      completedTasks,
      activeTasks,
      completionRate,
      databaseStatus: dbStatusMap[dbState] || 'unknown',
      uptime: process.uptime()
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /api/admin/users (or /admin/users)
 * Returns all registered users with their individual task counts.
 * Schema: [{ _id, username, email, role, createdAt, taskCount }]
 */
adminRouter.get('/users', async (req, res, next) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });

    // Aggregate task counts grouped by userId
    const taskCounts = await Task.aggregate([
      { $group: { _id: '$userId', count: { $sum: 1 } } }
    ]);

    const countMap = {};
    taskCounts.forEach((item) => {
      if (item._id) {
        countMap[item._id.toString()] = item.count;
      }
    });

    const usersWithCounts = users.map((u) => ({
      _id: u._id,
      id: u._id,
      username: u.username,
      email: u.email || '',
      role: u.role || 'user',
      createdAt: u.createdAt,
      taskCount: countMap[u._id.toString()] || 0
    }));

    return res.status(200).json(usersWithCounts);
  } catch (error) {
    return next(error);
  }
});

/**
 * DELETE /api/admin/users/:id (or /admin/users/:id)
 * Deletes user and cascades deletion of all tasks owned by this user.
 * Validates ObjectId and strictly prevents deletion of root administrator.
 */
adminRouter.delete('/users/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    // Guard: Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Invalid user ID format: '${id}'`
      });
    }

    const userToDelete = await User.findById(id);
    if (!userToDelete) {
      return res.status(404).json({
        error: 'Not Found',
        message: `User with id '${id}' not found`
      });
    }

    // Guard: Prevent deletion of the root administrator account
    const rootAdminUsername = process.env.ADMIN_USERNAME || 'admin';
    if (userToDelete.role === 'admin' || userToDelete.username === rootAdminUsername) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Cannot delete root administrator'
      });
    }

    // Cascade delete all tasks belonging to this user
    const deleteResult = await Task.deleteMany({ userId: id });

    // Remove user account
    await User.findByIdAndDelete(id);

    return res.status(200).json({
      message: 'User and associated tasks deleted successfully',
      deletedUserId: id,
      deletedTasksCount: deleteResult.deletedCount
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /api/admin/tasks (or /admin/tasks)
 * Returns all tasks across all users, populated with userId: 'username email'.
 * Supports category and completed filtering, plus sort ordering.
 */
adminRouter.get('/tasks', async (req, res, next) => {
  try {
    const { category, completed, sort } = req.query;
    const filterQuery = {};

    // 1. Filter by category
    if (category) {
      filterQuery.category = category.trim();
    }

    // 2. Filter by completion status
    if (completed !== undefined) {
      if (completed === 'true' || completed === true) {
        filterQuery.completed = true;
      } else if (completed === 'false' || completed === false) {
        filterQuery.completed = false;
      }
    }

    // 3. Chronological sorting
    const sortDirection = sort && sort.toLowerCase() === 'asc' ? 1 : -1;

    const tasks = await Task.find(filterQuery)
      .sort({ createdAt: sortDirection })
      .populate('userId', 'username email');

    return res.status(200).json(tasks);
  } catch (error) {
    return next(error);
  }
});

/**
 * DELETE /api/admin/tasks/:id (or /admin/tasks/:id)
 * Admin can delete any task regardless of owner.
 */
adminRouter.delete('/tasks/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    // Guard: Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Invalid task ID format: '${id}'`
      });
    }

    const deletedTask = await Task.findByIdAndDelete(id);
    if (!deletedTask) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Task with id '${id}' not found`
      });
    }

    return res.status(200).json({
      message: 'Task deleted by administrator',
      id: deletedTask._id
    });
  } catch (error) {
    return next(error);
  }
});

// Mount administrator router on both /api/admin and /admin
app.use('/api/admin', adminRouter);
app.use('/admin', adminRouter);

// ==============================================================================
// 9. Centralized Error Handling & 404 Route Guards
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
// 9. Server Listener & Process Signal Handlers
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
module.exports.authMiddleware = authMiddleware;
module.exports.adminMiddleware = adminMiddleware;
module.exports.syncRootAdmin = syncRootAdmin;
module.exports.JWT_SECRET = JWT_SECRET;
