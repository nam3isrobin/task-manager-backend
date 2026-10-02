/**
 * ==============================================================================
 * Comprehensive Integration & Unit Test Suite (`test/api.test.js`)
 * ==============================================================================
 * Validates all backend functionality and the 4 Day 19 assignments:
 * - Health Check (/api/health)
 * - Assignment 1: Edit task title via PUT /tasks/:id
 * - Assignment 2: Category taxonomy ('Work', 'Personal', 'Urgent') & category filtering
 * - Assignment 3: Sort tasks by createdAt (asc/desc)
 * - Assignment 4: Multi-user architecture (User model, CRUD, linking, filtering)
 * - Error handlers, validations, and edge case guards.
 * ==============================================================================
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');

// Set test environment before server loads
process.env.NODE_ENV = 'test';
process.env.PORT = '3099';
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/taskdb_test';

const app = require('../server');
const User = require('../models/User');
const Task = require('../models/Task');

describe('Task Manager API Suite (Day 19 Core + Assignments 1-4)', () => {
  let createdUserId = null;
  let createdTaskId = null;
  let testUser1 = null;
  let testUser2 = null;

  before(async () => {
    // Ensure database connection is established
    await app.connectDB();
    // Clean test database tables
    await User.deleteMany({});
    await Task.deleteMany({});
  });

  after(async () => {
    // Clean test database collections and close connection
    await User.deleteMany({});
    await Task.deleteMany({});
    await mongoose.connection.close();
  });

  // ============================================================================
  // 1. Health & Server Diagnostics
  // ============================================================================
  describe('Health Check API', () => {
    it('GET /api/health should return 200 with uptime and database status', async () => {
      const res = await request(app).get('/api/health');
      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'ok');
      assert.ok(typeof res.body.uptime === 'number');
      assert.equal(res.body.database, 'connected');
    });
  });

  // ============================================================================
  // 2. Assignment 4: User Model & Users API
  // ============================================================================
  describe('Assignment 4: Multiple Users API (/users)', () => {
    it('POST /users should validate presence of username', async () => {
      const res = await request(app)
        .post('/users')
        .send({ username: '', email: 'empty@example.com' });

      assert.equal(res.status, 400);
      assert.match(res.body.message, /Username is required/i);
    });

    it('POST /users should successfully register a new user', async () => {
      const res = await request(app)
        .post('/users')
        .send({ username: 'alice_quant', email: 'Alice@example.com' });

      assert.equal(res.status, 201);
      assert.equal(res.body.username, 'alice_quant');
      assert.equal(res.body.email, 'alice@example.com'); // Lowercase check
      assert.ok(res.body._id || res.body.id);
      testUser1 = res.body;
      createdUserId = res.body._id;
    });

    it('POST /users should prevent duplicate usernames (Conflict 409)', async () => {
      const res = await request(app)
        .post('/users')
        .send({ username: 'alice_quant', email: 'duplicate@example.com' });

      assert.equal(res.status, 409);
      assert.match(res.body.message, /already taken|already exists/i);
    });

    it('POST /users should register a second user', async () => {
      const res = await request(app)
        .post('/users')
        .send({ username: 'bob_systems', email: 'bob@example.com' });

      assert.equal(res.status, 201);
      assert.equal(res.body.username, 'bob_systems');
      testUser2 = res.body;
    });

    it('GET /users should return list of registered users', async () => {
      const res = await request(app).get('/users');
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body));
      assert.equal(res.body.length, 2);
    });
  });

  // ============================================================================
  // 3. Task Creation & Validation
  // ============================================================================
  describe('Task Creation & Input Validation (/tasks)', () => {
    it('POST /tasks should reject empty or whitespace title', async () => {
      const res = await request(app)
        .post('/tasks')
        .send({ title: '   ' });

      assert.equal(res.status, 400);
      assert.match(res.body.message, /title is required/i);
    });

    it('POST /tasks should reject invalid category enum', async () => {
      const res = await request(app)
        .post('/tasks')
        .send({ title: 'Invalid Task', category: 'NonExistent' });

      assert.equal(res.status, 400);
      assert.match(res.body.message, /Invalid category/i);
    });

    it('POST /tasks should reject invalid userId ObjectId format', async () => {
      const res = await request(app)
        .post('/tasks')
        .send({ title: 'Bad User ID Task', userId: '123-invalid-id' });

      assert.equal(res.status, 400);
      assert.match(res.body.message, /Invalid userId format/i);
    });

    it('POST /tasks should reject non-existent userId with 404', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .post('/tasks')
        .send({ title: 'Ghost User Task', userId: fakeId.toString() });

      assert.equal(res.status, 404);
      assert.match(res.body.message, /user with id/i);
    });

    it('POST /tasks should create a task with default category "Personal"', async () => {
      const res = await request(app)
        .post('/tasks')
        .send({ title: 'Buy groceries' });

      assert.equal(res.status, 201);
      assert.equal(res.body.title, 'Buy groceries');
      assert.equal(res.body.category, 'Personal'); // Default check
      assert.equal(res.body.completed, false);
      assert.equal(res.body.userId, null);
      createdTaskId = res.body._id;
    });

    it('POST /tasks should create a task with linked user and Work category', async () => {
      const res = await request(app)
        .post('/tasks')
        .send({
          title: 'Implement MT5 order routing',
          category: 'Work',
          userId: testUser1._id
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.title, 'Implement MT5 order routing');
      assert.equal(res.body.category, 'Work');
      assert.equal(res.body.userId._id.toString(), testUser1._id.toString());
      assert.equal(res.body.userId.username, 'alice_quant');
    });

    it('POST /tasks should create an Urgent task for user 2', async () => {
      const res = await request(app)
        .post('/tasks')
        .send({
          title: 'Patch security vulnerability',
          category: 'Urgent',
          userId: testUser2._id,
          completed: true
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.category, 'Urgent');
      assert.equal(res.body.completed, true);
    });
  });

  // ============================================================================
  // 4. Assignments 1-4: Querying, Filtering, and Sorting
  // ============================================================================
  describe('Assignments 2, 3, 4: Filtering and Sorting (/tasks)', () => {
    it('Assignment 2: GET /tasks?category=Work should filter only Work tasks', async () => {
      const res = await request(app).get('/tasks?category=Work');
      assert.equal(res.status, 200);
      assert.ok(res.body.length >= 1);
      res.body.forEach((t) => assert.equal(t.category, 'Work'));
    });

    it('Assignment 2: GET /tasks?category=Urgent should filter only Urgent tasks', async () => {
      const res = await request(app).get('/tasks?category=Urgent');
      assert.equal(res.status, 200);
      assert.equal(res.body.length, 1);
      assert.equal(res.body[0].category, 'Urgent');
    });

    it('Core: GET /tasks?completed=true should return only completed tasks', async () => {
      const res = await request(app).get('/tasks?completed=true');
      assert.equal(res.status, 200);
      res.body.forEach((t) => assert.equal(t.completed, true));
    });

    it('Assignment 4: GET /tasks?userId=... should return tasks for specified user', async () => {
      const res = await request(app).get(`/tasks?userId=${testUser1._id}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.length, 1);
      assert.equal(res.body[0].title, 'Implement MT5 order routing');
      assert.equal(res.body[0].userId.username, 'alice_quant');
    });

    it('Assignment 3: GET /tasks?sort=asc should sort oldest first', async () => {
      const res = await request(app).get('/tasks?sort=asc');
      assert.equal(res.status, 200);
      assert.ok(res.body.length >= 2);
      const time1 = new Date(res.body[0].createdAt).getTime();
      const time2 = new Date(res.body[res.body.length - 1].createdAt).getTime();
      assert.ok(time1 <= time2, 'Oldest task should be first when sort=asc');
    });

    it('Assignment 3: GET /tasks?sort=desc (default) should sort newest first', async () => {
      const res = await request(app).get('/tasks?sort=desc');
      assert.equal(res.status, 200);
      const time1 = new Date(res.body[0].createdAt).getTime();
      const time2 = new Date(res.body[res.body.length - 1].createdAt).getTime();
      assert.ok(time1 >= time2, 'Newest task should be first when sort=desc');
    });
  });

  // ============================================================================
  // 5. Assignment 1: Editing Tasks via PUT /tasks/:id
  // ============================================================================
  describe('Assignment 1: Task Updates (PUT /tasks/:id)', () => {
    it('PUT /tasks/:id should return 400 for invalid ObjectId format', async () => {
      const res = await request(app)
        .put('/tasks/invalid-object-id')
        .send({ title: 'New Title' });

      assert.equal(res.status, 400);
      assert.match(res.body.message, /Invalid task ID format/i);
    });

    it('PUT /tasks/:id should return 404 for non-existent task', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .put(`/tasks/${fakeId}`)
        .send({ title: 'New Title' });

      assert.equal(res.status, 404);
      assert.match(res.body.message, /Task with id.*not found/i);
    });

    it('PUT /tasks/:id should reject empty title string', async () => {
      const res = await request(app)
        .put(`/tasks/${createdTaskId}`)
        .send({ title: '   ' });

      assert.equal(res.status, 400);
      assert.match(res.body.message, /Task title cannot be empty/i);
    });

    it('Assignment 1: PUT /tasks/:id should successfully edit task title', async () => {
      const res = await request(app)
        .put(`/tasks/${createdTaskId}`)
        .send({ title: 'Buy groceries and cook organic meal' });

      assert.equal(res.status, 200);
      assert.equal(res.body.title, 'Buy groceries and cook organic meal');
    });

    it('PUT /tasks/:id should update completed status and category', async () => {
      const res = await request(app)
        .put(`/tasks/${createdTaskId}`)
        .send({ completed: true, category: 'Urgent' });

      assert.equal(res.status, 200);
      assert.equal(res.body.completed, true);
      assert.equal(res.body.category, 'Urgent');
    });

    it('PUT /tasks/:id should reject invalid category enum', async () => {
      const res = await request(app)
        .put(`/tasks/${createdTaskId}`)
        .send({ category: 'InvalidCategory' });

      assert.equal(res.status, 400);
      assert.match(res.body.message, /Invalid category/i);
    });
  });

  // ============================================================================
  // 6. Task Deletion (DELETE /tasks/:id)
  // ============================================================================
  describe('Task Deletion (DELETE /tasks/:id)', () => {
    it('DELETE /tasks/:id should return 400 for invalid ObjectId format', async () => {
      const res = await request(app).delete('/tasks/not-valid-id');
      assert.equal(res.status, 400);
      assert.match(res.body.message, /Invalid task ID format/i);
    });

    it('DELETE /tasks/:id should return 404 for non-existent task', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app).delete(`/tasks/${fakeId}`);
      assert.equal(res.status, 404);
      assert.match(res.body.message, /not found/i);
    });

    it('DELETE /tasks/:id should successfully remove the task', async () => {
      const res = await request(app).delete(`/tasks/${createdTaskId}`);
      assert.equal(res.status, 200);
      assert.match(res.body.message, /deleted successfully/i);

      // Verify task no longer exists
      const verifyRes = await request(app).get(`/tasks/${createdTaskId}`);
      assert.equal(verifyRes.status, 404);
    });
  });

  // ============================================================================
  // 7. Route and Error Handling Middleware
  // ============================================================================
  describe('Error Handling Middleware', () => {
    it('Should return 404 for undefined routes', async () => {
      const res = await request(app).get('/api/unknown-endpoint');
      assert.equal(res.status, 404);
      assert.equal(res.body.error, 'Not Found');
    });

    it('Should handle malformed JSON payload gracefully', async () => {
      const res = await request(app)
        .post('/tasks')
        .set('Content-Type', 'application/json')
        .send('{"badJson": ');

      assert.equal(res.status, 400);
      assert.match(res.body.message, /Malformed JSON payload/i);
    });
  });
});
