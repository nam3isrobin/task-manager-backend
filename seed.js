/**
 * ==============================================================================
 * Database Seeder Script (`seed.js`)
 * ==============================================================================
 * Turnkey Evaluator Onboarding & Idempotent Database Seeder.
 *
 * Capabilities:
 * - Establishes resilient connection to MongoDB using MONGO_URI from .env
 * - Synchronizes the single root administrator (admin / AdminPass123!)
 * - Populates rich sample demo users and multi-category tasks ('Work', 'Personal', 'Urgent')
 * - Idempotent: can be executed multiple times safely without duplicate key violations
 * ==============================================================================
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const Task = require('./models/Task');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/taskdb';

/**
 * Main seeding workflow.
 * Connects to MongoDB, seeds root admin, demo user, and initial tasks.
 */
async function seedDatabase() {
  console.log('====================================================');
  console.log('🌱 Starting Idempotent Database Seed Operation');
  console.log(`📡 Target MongoDB URI: ${MONGO_URI}`);
  console.log('====================================================');

  try {
    // 1. Establish connection with timeout guard
    await mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
      autoIndex: true
    });
    console.log('[MongoDB] Connected successfully.');

    // 2. Seed / Synchronize Root Administrator
    const adminUsername = process.env.ADMIN_USERNAME || 'admin';
    const adminPassword = process.env.ADMIN_PASSWORD || 'AdminPass123!';
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@taskmaster.local';

    let admin = await User.findOne({ username: adminUsername }).select('+password');
    if (!admin) {
      // Check if an admin already exists under an alternate username
      const existingAdmin = await User.findOne({ role: 'admin' });
      if (!existingAdmin) {
        admin = await User.create({
          username: adminUsername,
          email: adminEmail,
          password: adminPassword,
          role: 'admin'
        });
        console.log(`✅ Root Administrator created: ${adminUsername} (${adminEmail})`);
      } else {
        admin = existingAdmin;
        console.log(`ℹ️ Existing Root Administrator verified: ${admin.username}`);
      }
    } else {
      let updated = false;
      if (admin.role !== 'admin') {
        admin.role = 'admin';
        updated = true;
      }
      const isMatch = await admin.comparePassword(adminPassword);
      if (!isMatch) {
        admin.password = adminPassword; // Pre-save hook rehashes
        updated = true;
      }
      if (adminEmail && admin.email !== adminEmail) {
        admin.email = adminEmail;
        updated = true;
      }
      if (updated) {
        await admin.save();
        console.log(`🔄 Root Administrator synchronized: ${adminUsername}`);
      } else {
        console.log(`ℹ️ Root Administrator up-to-date: ${adminUsername}`);
      }
    }

    // 3. Seed / Synchronize Demo Regular User
    const demoUsername = 'demo_user';
    const demoPassword = 'UserPass123!';
    const demoEmail = 'demo@taskmaster.local';

    let demoUser = await User.findOne({ username: demoUsername }).select('+password');
    if (!demoUser) {
      demoUser = await User.create({
        username: demoUsername,
        email: demoEmail,
        password: demoPassword,
        role: 'user'
      });
      console.log(`✅ Demo User created: ${demoUsername} (${demoEmail})`);
    } else {
      console.log(`ℹ️ Demo User verified: ${demoUsername}`);
    }

    // 4. Seed Initial Multi-Category Tasks
    const sampleTasks = [
      {
        title: 'Review Day 19 REST API Architecture & Admin Routes',
        category: 'Work',
        completed: true,
        userId: admin._id
      },
      {
        title: 'Perform System Security & Invariant Audit',
        category: 'Urgent',
        completed: false,
        userId: admin._id
      },
      {
        title: 'Set up local MongoDB development environment',
        category: 'Work',
        completed: true,
        userId: demoUser._id
      },
      {
        title: 'Explore Task Manager categories and sorting features',
        category: 'Personal',
        completed: false,
        userId: demoUser._id
      },
      {
        title: 'Submit internship daily progress log',
        category: 'Urgent',
        completed: false,
        userId: demoUser._id
      }
    ];

    let insertedTasksCount = 0;
    for (const taskData of sampleTasks) {
      const existingTask = await Task.findOne({
        title: taskData.title,
        userId: taskData.userId
      });
      if (!existingTask) {
        await Task.create(taskData);
        insertedTasksCount++;
      }
    }

    console.log(`📋 Sample Tasks synchronized. (${insertedTasksCount} newly created)`);
    console.log('====================================================');
    console.log('✨ Turnkey Database Seeding Completed Successfully!');
    console.log('====================================================');

    await mongoose.connection.close();
    return true;
  } catch (error) {
    console.error('❌ Seeder encountered fatal error:', error.message);
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
    throw error;
  }
}

// Execute directly if run via CLI (`node seed.js`)
if (require.main === module) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = seedDatabase;
