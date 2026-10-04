/**
 * ==============================================================================
 * Comprehensive Integration & Unit Test Suite (`test/api.test.js`)
 * ==============================================================================
 * Validates all backend functionality for Day 19 Task Manager with Authentication:
 * 1. Health Check & Diagnostics (/api/health)
 * 2. User Authentication (/auth/register, /auth/login, /auth/me)
 * 3. Protected Task Routes (Authentication token enforcement - 401 Unauthorized)
 * 4. Task CRUD Operations for Authenticated Users
 * 5. Strict Tenant Isolation (Multi-Tenancy: 403 Forbidden cross-user access)
 * 6. Assignment 2 & 3: Filtering (category, status) & Sorting (asc, desc)
 * 7. Legacy Users Endpoints (/users)
 * 8. Error handling (malformed JSON, 404 undefined routes)
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
process.env.JWT_SECRET = 'test_jwt_secret_key_day19_deterministic_2026';
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'AdminPass123!';
process.env.ADMIN_EMAIL = 'admin@taskmaster.local';

const app = require('../server');
const User = require('../models/User');
const Task = require('../models/Task');

describe('Day 19 Task Manager API Test Suite (Auth + Multi-Tenancy)', () => {
  let user1Token = null;
  let user1Data = null;
  let user2Token = null;
  let user2Data = null;

  let adminToken = null;
  let adminUser = null;

  let user1TaskId = null;
  let user2TaskId = null;

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

    it('GET /health alias should return 200', async () => {
      const res = await request(app).get('/health');
      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'ok');
    });
  });

  // ============================================================================
  // 2. Authentication API (/auth/register, /auth/login, /auth/me)
  // ============================================================================
  describe('Authentication API (/auth)', () => {
    it('POST /auth/register should reject empty username', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({ username: '  ', password: 'Password123!' });

      assert.equal(res.status, 400);
      assert.match(res.body.message, /Username is required/i);
    });

    it('POST /auth/register should reject short username (< 2 chars)', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({ username: 'a', password: 'Password123!' });

      assert.equal(res.status, 400);
      assert.match(res.body.message, /at least 2 characters/i);
    });

    it('POST /auth/register should reject missing or short password (< 6 chars)', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({ username: 'alice_quant', password: '123' });

      assert.equal(res.status, 400);
      assert.match(res.body.message, /at least 6 characters/i);
    });

    it('POST /auth/register should successfully register User 1 and return JWT token', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({
          username: 'alice_quant',
          email: 'Alice@example.com',
          password: 'Password123!'
        });

      assert.equal(res.status, 201);
      assert.ok(res.body.token, 'Registration should return JWT token');
      assert.equal(res.body.message, 'User registered successfully');
      assert.equal(res.body.user.username, 'alice_quant');
      assert.equal(res.body.user.email, 'alice@example.com');
      assert.ok(res.body.user.id, 'User object should contain id');
      // Critical security assertion: password must NEVER be in response
      assert.equal(res.body.user.password, undefined);

      user1Token = res.body.token;
      user1Data = res.body.user;
    });

    it('POST /auth/register should prevent duplicate username registration (Conflict 409)', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({
          username: 'alice_quant',
          email: 'another@example.com',
          password: 'Password123!'
        });

      assert.equal(res.status, 409);
      assert.match(res.body.message, /already taken|already exists/i);
    });

    it('POST /auth/register should successfully register User 2', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({
          username: 'bob_systems',
          email: 'bob@example.com',
          password: 'Password456!'
        });

      assert.equal(res.status, 201);
      assert.ok(res.body.token);
      assert.equal(res.body.user.username, 'bob_systems');
      user2Token = res.body.token;
      user2Data = res.body.user;
    });

    it('POST /auth/login should reject missing username or password', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ username: 'alice_quant' });

      assert.equal(res.status, 400);
      assert.match(res.body.message, /Username and password are required/i);
    });

    it('POST /auth/login should reject non-existent username (401 Unauthorized)', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ username: 'nonexistent_user', password: 'Password123!' });

      assert.equal(res.status, 401);
      assert.match(res.body.message, /Invalid username or password/i);
    });

    it('POST /auth/login should reject incorrect password (401 Unauthorized)', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ username: 'alice_quant', password: 'WrongPassword999!' });

      assert.equal(res.status, 401);
      assert.match(res.body.message, /Invalid username or password/i);
    });

    it('POST /auth/login should authenticate valid credentials and return JWT token', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ username: 'alice_quant', password: 'Password123!' });

      assert.equal(res.status, 200);
      assert.ok(res.body.token);
      assert.equal(res.body.message, 'Login successful');
      assert.equal(res.body.user.username, 'alice_quant');
      assert.equal(res.body.user.password, undefined);
    });

    it('GET /auth/me should reject request when token is missing (401 Unauthorized)', async () => {
      const res = await request(app).get('/auth/me');
      assert.equal(res.status, 401);
      assert.match(res.body.message, /No authentication token provided/i);
    });

    it('GET /auth/me should reject invalid or forged token (401 Unauthorized)', async () => {
      const res = await request(app)
        .get('/auth/me')
        .set('Authorization', 'Bearer invalid_forged_token_xyz');

      assert.equal(res.status, 401);
      assert.match(res.body.message, /Invalid or expired authentication token/i);
    });

    it('GET /auth/me should return current user profile with valid Bearer token', async () => {
      const res = await request(app)
        .get('/auth/me')
        .set('Authorization', `Bearer ${user1Token}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.user.username, 'alice_quant');
      assert.equal(res.body.user.email, 'alice@example.com');
      assert.equal(res.body.user.id, user1Data.id);
    });

    it('POST /auth/register should prevent public registration from assigning admin role (defaults to user)', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({
          username: 'sneaky_admin_attempt',
          email: 'sneaky@example.com',
          password: 'Password123!',
          role: 'admin'
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.user.role, 'user');

      const userInDb = await User.findOne({ username: 'sneaky_admin_attempt' });
      assert.equal(userInDb.role, 'user');
    });
  });

  // ============================================================================
  // 3. Protected Task Routes (Token Enforcement)
  // ============================================================================
  describe('Protected Task Routes Guard (401 Unauthorized)', () => {
    it('GET /tasks should reject request without token', async () => {
      const res = await request(app).get('/tasks');
      assert.equal(res.status, 401);
    });

    it('POST /tasks should reject request without token', async () => {
      const res = await request(app)
        .post('/tasks')
        .send({ title: 'Unauthorized Task' });

      assert.equal(res.status, 401);
    });

    it('PUT /tasks/:id should reject request without token', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .put(`/tasks/${fakeId}`)
        .send({ title: 'Unauthorized Edit' });

      assert.equal(res.status, 401);
    });

    it('DELETE /tasks/:id should reject request without token', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app).delete(`/tasks/${fakeId}`);
      assert.equal(res.status, 401);
    });
  });

  // ============================================================================
  // 4. Task CRUD Operations for Authenticated Users
  // ============================================================================
  describe('Task CRUD Operations for Authenticated Users (/tasks)', () => {
    it('POST /tasks should reject empty or whitespace title', async () => {
      const res = await request(app)
        .post('/tasks')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ title: '   ' });

      assert.equal(res.status, 400);
      assert.match(res.body.message, /Task title is required/i);
    });

    it('POST /tasks should reject invalid category enum', async () => {
      const res = await request(app)
        .post('/tasks')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ title: 'Invalid Category Task', category: 'InvalidCategoryName' });

      assert.equal(res.status, 400);
      assert.match(res.body.message, /Invalid category/i);
    });

    it('POST /tasks should create task with default category "Personal" and link to authenticated user', async () => {
      const res = await request(app)
        .post('/tasks')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ title: 'Buy high-protein groceries' });

      assert.equal(res.status, 201);
      assert.equal(res.body.title, 'Buy high-protein groceries');
      assert.equal(res.body.category, 'Personal');
      assert.equal(res.body.completed, false);
      assert.equal(res.body.userId.username, 'alice_quant');
      assert.equal(res.body.userId._id.toString(), user1Data.id.toString());

      user1TaskId = res.body._id;
    });

    it('POST /tasks should create a Work task for user 1', async () => {
      const res = await request(app)
        .post('/tasks')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          title: 'Deploy QuantForge algorithmic execution gateway',
          category: 'Work'
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.category, 'Work');
      assert.equal(res.body.userId.username, 'alice_quant');
    });

    it('POST /tasks should create an Urgent completed task for user 1', async () => {
      const res = await request(app)
        .post('/tasks')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          title: 'Review Meta Cloud API webhook SSL certs',
          category: 'Urgent',
          completed: true
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.category, 'Urgent');
      assert.equal(res.body.completed, true);
    });

    it('GET /tasks should return all tasks belonging to user 1', async () => {
      const res = await request(app)
        .get('/tasks')
        .set('Authorization', `Bearer ${user1Token}`);

      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body));
      assert.equal(res.body.length, 3);
      res.body.forEach((task) => {
        assert.equal(task.userId.username, 'alice_quant');
      });
    });

    it('GET /tasks/:id should return 400 for invalid ObjectId format', async () => {
      const res = await request(app)
        .get('/tasks/invalid-object-id')
        .set('Authorization', `Bearer ${user1Token}`);

      assert.equal(res.status, 400);
      assert.match(res.body.message, /Invalid task ID format/i);
    });

    it('GET /tasks/:id should return 404 for non-existent task', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .get(`/tasks/${fakeId}`)
        .set('Authorization', `Bearer ${user1Token}`);

      assert.equal(res.status, 404);
      assert.match(res.body.message, /not found/i);
    });

    it('GET /tasks/:id should return specific task for user 1', async () => {
      const res = await request(app)
        .get(`/tasks/${user1TaskId}`)
        .set('Authorization', `Bearer ${user1Token}`);

      assert.equal(res.status, 200);
      assert.equal(res.body._id, user1TaskId);
      assert.equal(res.body.title, 'Buy high-protein groceries');
    });

    it('PUT /tasks/:id should update title, completed status, and category (Assignment 1 & 2)', async () => {
      const res = await request(app)
        .put(`/tasks/${user1TaskId}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          title: 'Buy organic high-protein groceries and cook meal',
          completed: true,
          category: 'Urgent'
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.title, 'Buy organic high-protein groceries and cook meal');
      assert.equal(res.body.completed, true);
      assert.equal(res.body.category, 'Urgent');
    });

    it('PUT /tasks/:id should reject empty title string', async () => {
      const res = await request(app)
        .put(`/tasks/${user1TaskId}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ title: '   ' });

      assert.equal(res.status, 400);
      assert.match(res.body.message, /Task title cannot be empty/i);
    });

    it('PUT /tasks/:id should reject invalid category', async () => {
      const res = await request(app)
        .put(`/tasks/${user1TaskId}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ category: 'UnsupportedCategory' });

      assert.equal(res.status, 400);
      assert.match(res.body.message, /Invalid category/i);
    });

    it('DELETE /tasks/:id should return 400 for invalid ObjectId format', async () => {
      const res = await request(app)
        .delete('/tasks/invalid-id-format')
        .set('Authorization', `Bearer ${user1Token}`);

      assert.equal(res.status, 400);
      assert.match(res.body.message, /Invalid task ID format/i);
    });

    it('DELETE /tasks/:id should return 404 for non-existent task', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .delete(`/tasks/${fakeId}`)
        .set('Authorization', `Bearer ${user1Token}`);

      assert.equal(res.status, 404);
      assert.match(res.body.message, /not found/i);
    });

    it('DELETE /tasks/:id should delete task and return 200', async () => {
      const res = await request(app)
        .delete(`/tasks/${user1TaskId}`)
        .set('Authorization', `Bearer ${user1Token}`);

      assert.equal(res.status, 200);
      assert.match(res.body.message, /Task deleted successfully/i);
      assert.equal(res.body.id, user1TaskId);

      // Verify deletion
      const verifyRes = await request(app)
        .get(`/tasks/${user1TaskId}`)
        .set('Authorization', `Bearer ${user1Token}`);
      assert.equal(verifyRes.status, 404);
    });
  });

  // ============================================================================
  // 5. Strict Tenant Isolation (Multi-Tenancy Security)
  // ============================================================================
  describe('Strict Multi-Tenant Isolation (Cross-User Security)', () => {
    before(async () => {
      // Create a task owned by User 1
      const res1 = await request(app)
        .post('/tasks')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          title: "User 1's Private Strategy Task",
          category: 'Work'
        });
      user1TaskId = res1.body._id;

      // Create a task owned by User 2
      const res2 = await request(app)
        .post('/tasks')
        .set('Authorization', `Bearer ${user2Token}`)
        .send({
          title: "User 2's Database Migration Task",
          category: 'Urgent'
        });
      user2TaskId = res2.body._id;
    });

    it('User 1 GET /tasks should NOT include tasks owned by User 2', async () => {
      const res = await request(app)
        .get('/tasks')
        .set('Authorization', `Bearer ${user1Token}`);

      assert.equal(res.status, 200);
      const user2TaskFound = res.body.find((t) => t._id.toString() === user2TaskId.toString());
      assert.equal(user2TaskFound, undefined, 'User 1 must not see User 2 tasks');
    });

    it('User 2 GET /tasks should NOT include tasks owned by User 1', async () => {
      const res = await request(app)
        .get('/tasks')
        .set('Authorization', `Bearer ${user2Token}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.length, 1);
      assert.equal(res.body[0]._id, user2TaskId);
      assert.equal(res.body[0].title, "User 2's Database Migration Task");
    });

    it('User 1 attempting to GET User 2 task should return 403 Forbidden', async () => {
      const res = await request(app)
        .get(`/tasks/${user2TaskId}`)
        .set('Authorization', `Bearer ${user1Token}`);

      assert.equal(res.status, 403);
      assert.match(res.body.message, /not authorized/i);
    });

    it('User 1 attempting to PUT/update User 2 task should return 403 Forbidden', async () => {
      const res = await request(app)
        .put(`/tasks/${user2TaskId}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ title: 'Hacked Title Attempt' });

      assert.equal(res.status, 403);
      assert.match(res.body.message, /not authorized to update this task/i);

      // Verify task in database remains uncompromised
      const intactTask = await Task.findById(user2TaskId);
      assert.equal(intactTask.title, "User 2's Database Migration Task");
    });

    it('User 1 attempting to DELETE User 2 task should return 403 Forbidden', async () => {
      const res = await request(app)
        .delete(`/tasks/${user2TaskId}`)
        .set('Authorization', `Bearer ${user1Token}`);

      assert.equal(res.status, 403);
      assert.match(res.body.message, /not authorized to delete this task/i);

      // Verify task still exists in database
      const intactTask = await Task.findById(user2TaskId);
      assert.ok(intactTask);
    });
  });

  // ============================================================================
  // 6. Filtering & Sorting for Authenticated User (Assignments 2 & 3)
  // ============================================================================
  describe('Assignments 2 & 3: Filtering and Sorting (/tasks)', () => {
    before(async () => {
      // Create additional structured tasks for User 1 to test filtering and sorting
      await request(app)
        .post('/tasks')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ title: 'Work Task Alpha', category: 'Work', completed: false });

      await request(app)
        .post('/tasks')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ title: 'Personal Task Beta', category: 'Personal', completed: true });

      await request(app)
        .post('/tasks')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ title: 'Urgent Task Gamma', category: 'Urgent', completed: false });
    });

    it('Assignment 2: GET /tasks?category=Work should filter only Work tasks for user', async () => {
      const res = await request(app)
        .get('/tasks?category=Work')
        .set('Authorization', `Bearer ${user1Token}`);

      assert.equal(res.status, 200);
      assert.ok(res.body.length >= 1);
      res.body.forEach((t) => assert.equal(t.category, 'Work'));
    });

    it('Assignment 2: GET /tasks?category=Urgent should filter only Urgent tasks for user', async () => {
      const res = await request(app)
        .get('/tasks?category=Urgent')
        .set('Authorization', `Bearer ${user1Token}`);

      assert.equal(res.status, 200);
      assert.ok(res.body.length >= 1);
      res.body.forEach((t) => assert.equal(t.category, 'Urgent'));
    });

    it('Core: GET /tasks?completed=true should return only completed tasks for user', async () => {
      const res = await request(app)
        .get('/tasks?completed=true')
        .set('Authorization', `Bearer ${user1Token}`);

      assert.equal(res.status, 200);
      res.body.forEach((t) => assert.equal(t.completed, true));
    });

    it('Assignment 3: GET /tasks?sort=asc should sort oldest tasks first', async () => {
      const res = await request(app)
        .get('/tasks?sort=asc')
        .set('Authorization', `Bearer ${user1Token}`);

      assert.equal(res.status, 200);
      assert.ok(res.body.length >= 2);
      const time1 = new Date(res.body[0].createdAt).getTime();
      const time2 = new Date(res.body[res.body.length - 1].createdAt).getTime();
      assert.ok(time1 <= time2, 'Oldest task should be first when sort=asc');
    });

    it('Assignment 3: GET /tasks?sort=desc (default) should sort newest tasks first', async () => {
      const res = await request(app)
        .get('/tasks?sort=desc')
        .set('Authorization', `Bearer ${user1Token}`);

      assert.equal(res.status, 200);
      const time1 = new Date(res.body[0].createdAt).getTime();
      const time2 = new Date(res.body[res.body.length - 1].createdAt).getTime();
      assert.ok(time1 >= time2, 'Newest task should be first when sort=desc');
    });
  });

  // ============================================================================
  // 7. Legacy Users Endpoint (/users)
  // ============================================================================
  describe('Legacy Users Endpoint (/users)', () => {
    it('GET /users should return registered users list without password hashes', async () => {
      const res = await request(app).get('/users');
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body));
      assert.ok(res.body.length >= 2);
      res.body.forEach((u) => {
        assert.equal(u.password, undefined);
      });
    });

    it('POST /users should register user with fallback password', async () => {
      const res = await request(app)
        .post('/users')
        .send({ username: 'carol_engineer', email: 'carol@example.com' });

      assert.equal(res.status, 201);
      assert.equal(res.body.username, 'carol_engineer');
      assert.equal(res.body.password, undefined);
    });
  });

  // ============================================================================
  // 8. Single Root Administrator & Schema Invariants
  // ============================================================================
  describe('Single Root Administrator & Schema Invariants', () => {
    it('Single root admin schema validator prevents secondary admin creation', async () => {
      // Ensure the single root administrator is seeded
      adminUser = await app.syncRootAdmin();
      assert.ok(adminUser);
      assert.equal(adminUser.role, 'admin');

      // Attempting to create a second admin must be rejected by Mongoose pre-save hook
      await assert.rejects(
        async () => {
          await User.create({
            username: 'secondary_admin_candidate',
            password: 'Password123!',
            role: 'admin'
          });
        },
        (err) => {
          assert.match(
            err.message,
            /A root administrator already exists\. Secondary administrators are strictly forbidden\./i
          );
          return true;
        }
      );
    });

    it('Idempotent syncRootAdmin updates password hash if environment password changes', async () => {
      const admin = await app.syncRootAdmin();
      assert.ok(admin);
      const isMatch = await admin.comparePassword(process.env.ADMIN_PASSWORD || 'AdminPass123!');
      assert.equal(isMatch, true);
    });
  });

  // ============================================================================
  // 9. Administrator API Endpoints (/api/admin & /admin)
  // ============================================================================
  describe('Administrator API Endpoints (/api/admin & /admin)', () => {
    before(async () => {
      // Authenticate as root administrator
      adminUser = await app.syncRootAdmin();
      const loginRes = await request(app)
        .post('/auth/login')
        .send({
          username: process.env.ADMIN_USERNAME || 'admin',
          password: process.env.ADMIN_PASSWORD || 'AdminPass123!'
        });

      assert.equal(loginRes.status, 200);
      assert.ok(loginRes.body.token);
      adminToken = loginRes.body.token;
    });

    // --------------------------------------------------------------------------
    // 9.1 Metrics Endpoint (/api/admin/metrics)
    // --------------------------------------------------------------------------
    it('GET /api/admin/metrics should reject unauthenticated request with 401', async () => {
      const res = await request(app).get('/api/admin/metrics');
      assert.equal(res.status, 401);
      assert.equal(res.body.error, 'Unauthorized');
    });

    it('GET /api/admin/metrics should reject non-admin authenticated user with 403 Forbidden', async () => {
      const res = await request(app)
        .get('/api/admin/metrics')
        .set('Authorization', `Bearer ${user1Token}`);
      assert.equal(res.status, 403);
      assert.equal(res.body.error, 'Forbidden');
      assert.match(res.body.message, /Administrator privileges required/i);
    });

    it('GET /api/admin/metrics should return operational metrics for root administrator', async () => {
      const res = await request(app)
        .get('/api/admin/metrics')
        .set('Authorization', `Bearer ${adminToken}`);

      assert.equal(res.status, 200);
      assert.ok(typeof res.body.totalUsers === 'number');
      assert.ok(typeof res.body.totalTasks === 'number');
      assert.ok(typeof res.body.completedTasks === 'number');
      assert.ok(typeof res.body.activeTasks === 'number');
      assert.ok(typeof res.body.completionRate === 'number');
      assert.equal(res.body.databaseStatus, 'connected');
      assert.ok(typeof res.body.uptime === 'number');
    });

    // --------------------------------------------------------------------------
    // 9.2 Users List Endpoint (/api/admin/users)
    // --------------------------------------------------------------------------
    it('GET /api/admin/users should reject request without admin credentials (401 & 403)', async () => {
      const unauth = await request(app).get('/api/admin/users');
      assert.equal(unauth.status, 401);

      const forbidden = await request(app)
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${user1Token}`);
      assert.equal(forbidden.status, 403);
    });

    it('GET /api/admin/users should return all users with individual task counts for admin', async () => {
      const res = await request(app)
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${adminToken}`);

      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body));
      assert.ok(res.body.length >= 2);

      res.body.forEach((u) => {
        assert.ok(u._id);
        assert.ok(u.username);
        assert.ok(u.role);
        assert.ok(typeof u.taskCount === 'number');
        assert.equal(u.password, undefined);
      });
    });

    // --------------------------------------------------------------------------
    // 9.3 Cascade User Deletion (/api/admin/users/:id)
    // --------------------------------------------------------------------------
    it('DELETE /api/admin/users/:id should reject invalid ObjectId format with 400', async () => {
      const res = await request(app)
        .delete('/api/admin/users/invalid-id')
        .set('Authorization', `Bearer ${adminToken}`);

      assert.equal(res.status, 400);
      assert.match(res.body.message, /Invalid user ID format/i);
    });

    it('DELETE /api/admin/users/:id should reject attempt to delete root administrator (400 Bad Request)', async () => {
      const res = await request(app)
        .delete(`/api/admin/users/${adminUser._id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      assert.equal(res.status, 400);
      assert.match(res.body.message, /Cannot delete root administrator/i);
    });

    it('DELETE /api/admin/users/:id should cascade delete user and all owned tasks', async () => {
      // 1. Create a temporary user with associated tasks
      const victim = await User.create({
        username: 'cascade_victim_user',
        email: 'victim@taskmaster.local',
        password: 'Password123!',
        role: 'user'
      });

      await Task.create([
        { title: 'Victim Task 1', category: 'Work', userId: victim._id },
        { title: 'Victim Task 2', category: 'Urgent', userId: victim._id }
      ]);

      const victimTasksBefore = await Task.countDocuments({ userId: victim._id });
      assert.equal(victimTasksBefore, 2);

      // 2. Admin performs cascade delete
      const deleteRes = await request(app)
        .delete(`/api/admin/users/${victim._id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      assert.equal(deleteRes.status, 200);
      assert.match(deleteRes.body.message, /User and associated tasks deleted successfully/i);
      assert.equal(deleteRes.body.deletedUserId, victim._id.toString());
      assert.equal(deleteRes.body.deletedTasksCount, 2);

      // 3. Verify user and tasks are purged
      const victimInDb = await User.findById(victim._id);
      assert.equal(victimInDb, null);

      const victimTasksAfter = await Task.find({ userId: victim._id });
      assert.equal(victimTasksAfter.length, 0);
    });

    // --------------------------------------------------------------------------
    // 9.4 Cross-Tenant Tasks Retrieval (/api/admin/tasks)
    // --------------------------------------------------------------------------
    it('GET /api/admin/tasks should return all tasks across users with populated userId', async () => {
      const unauth = await request(app).get('/api/admin/tasks');
      assert.equal(unauth.status, 401);

      const forbidden = await request(app)
        .get('/api/admin/tasks')
        .set('Authorization', `Bearer ${user1Token}`);
      assert.equal(forbidden.status, 403);

      const res = await request(app)
        .get('/api/admin/tasks')
        .set('Authorization', `Bearer ${adminToken}`);

      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body));
      assert.ok(res.body.length >= 1);

      // Check population
      const firstTask = res.body[0];
      assert.ok(firstTask.userId);
      assert.ok(typeof firstTask.userId === 'object');
      assert.ok(firstTask.userId.username);

      // Verify category filter
      const workFiltered = await request(app)
        .get('/api/admin/tasks?category=Work')
        .set('Authorization', `Bearer ${adminToken}`);
      assert.equal(workFiltered.status, 200);
      workFiltered.body.forEach((t) => assert.equal(t.category, 'Work'));
    });

    // --------------------------------------------------------------------------
    // 9.5 Task Deletion by Admin (/api/admin/tasks/:id)
    // --------------------------------------------------------------------------
    it('DELETE /api/admin/tasks/:id should allow admin to delete any task regardless of owner', async () => {
      // Create a task owned by user 1
      const taskToDelete = await Task.create({
        title: 'Task to be purged by administrator',
        category: 'Personal',
        userId: user1Data.id || user1Data._id
      });

      const res = await request(app)
        .delete(`/api/admin/tasks/${taskToDelete._id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      assert.equal(res.status, 200);
      assert.match(res.body.message, /Task deleted by administrator/i);
      assert.equal(res.body.id.toString(), taskToDelete._id.toString());

      const checkInDb = await Task.findById(taskToDelete._id);
      assert.equal(checkInDb, null);
    });
  });

  // ============================================================================
  // 10. Error Handling Middleware & 404 Route Guards
  // ============================================================================
  describe('Error Handling Middleware', () => {
    it('Should return 404 for undefined routes', async () => {
      const res = await request(app).get('/api/unknown-endpoint');
      assert.equal(res.status, 404);
      assert.equal(res.body.error, 'Not Found');
    });

    it('Should handle malformed JSON payload gracefully', async () => {
      const res = await request(app)
        .post('/auth/register')
        .set('Content-Type', 'application/json')
        .send('{"badJson": ');

      assert.equal(res.status, 400);
      assert.match(res.body.message, /Malformed JSON payload/i);
    });
  });
});
