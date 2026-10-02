/**
 * ==============================================================================
 * Task Model (`models/Task.js`)
 * ==============================================================================
 * Core data schema for Tasks in the Task Manager application.
 *
 * Core Features & Assignments Supported:
 * - Core: Title, completion status, creation timestamp.
 * - Assignment 1: Title updates via PUT /tasks/:id.
 * - Assignment 2: Strict category taxonomy ('Work', 'Personal', 'Urgent') with
 *   'Personal' as default.
 * - Assignment 3: Chronological sorting via `createdAt` indexing.
 * - Assignment 4: Relational binding to `User` model via `userId`.
 * ==============================================================================
 */

const mongoose = require('mongoose');

// Allowed categories taxonomy based on Assignment 2 specifications
const VALID_CATEGORIES = ['Work', 'Personal', 'Urgent'];

const taskSchema = new mongoose.Schema(
  {
    // Task title/description - mandatory non-empty trimmed string
    title: {
      type: String,
      required: [true, 'Task title is required'],
      trim: true,
      minlength: [1, 'Task title cannot be empty']
    },
    // Task completion status flag
    completed: {
      type: Boolean,
      default: false
    },
    // Assignment 2: Category categorization with strict enum guard
    category: {
      type: String,
      enum: {
        values: VALID_CATEGORIES,
        message: 'Invalid category "{VALUE}". Allowed categories: ' + VALID_CATEGORIES.join(', ')
      },
      default: 'Personal'
    },
    // Assignment 4: Foreign reference to associated User model
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
      default: null
    },
    // Assignment 3: Inception timestamp for asc/desc sorting
    createdAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    // Enable virtual fields (such as 'id' alongside '_id')
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Optimize query performance for multi-tenant and sorting operations
taskSchema.index({ createdAt: -1 });
taskSchema.index({ userId: 1, createdAt: -1 });
taskSchema.index({ category: 1, createdAt: -1 });

// Export the Task model and valid categories constant
const Task = mongoose.model('Task', taskSchema);
module.exports = Task;
module.exports.VALID_CATEGORIES = VALID_CATEGORIES;
