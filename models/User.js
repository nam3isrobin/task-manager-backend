/**
 * ==============================================================================
 * User Model (`models/User.js`)
 * ==============================================================================
 * Represents a registered user in the Task Manager ecosystem.
 * Supports Assignment 4: Multi-user architecture linking tasks to user profiles.
 * ==============================================================================
 */

const mongoose = require('mongoose');

// Define Schema for User entities
const userSchema = new mongoose.Schema(
  {
    // Unique human-readable handle/username
    username: {
      type: String,
      required: [true, 'Username is required'],
      unique: true,
      trim: true,
      minlength: [2, 'Username must be at least 2 characters long'],
      maxlength: [50, 'Username cannot exceed 50 characters']
    },
    // User electronic mail address (standardized to lowercase)
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: '',
      match: [
        /^(?:$|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})$/,
        'Please provide a valid email address'
      ]
    },
    // Timestamp for account inception
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

// Compile and export the User model
const User = mongoose.model('User', userSchema);
module.exports = User;
