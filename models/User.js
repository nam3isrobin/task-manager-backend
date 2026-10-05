/**
 * ==============================================================================
 * User Model (`models/User.js`)
 * ==============================================================================
 * Represents a registered user in the Task Manager ecosystem.
 *
 * Capabilities & Security Architecture:
 * - Multi-user tenancy: Binds tasks securely to authenticated user profiles.
 * - Password Security: Hashes plain-text passwords using bcryptjs (salt rounds: 10)
 *   in a Mongoose pre-save hook.
 * - Confidentiality: `select: false` prevents accidental credential leakage in queries.
 * - Credential Verification: `comparePassword` instance method for constant-time
 *   bcrypt comparisons during user authentication.
 * ==============================================================================
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

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
    // Hashed secret password credential (hidden by default from query results)
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [6, 'Password must be at least 6 characters long'],
      select: false
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

/**
 * Pre-save Mongoose middleware hook.
 * Automatically hashes the plain-text password using bcryptjs with 10 salt rounds
 * only when the password field has been modified or newly created.
 */
userSchema.pre('save', async function () {
  // Only hash the password if it has been modified or is new
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 10);
  }
});

/**
 * Compares a candidate plain-text password with the stored bcrypt hash.
 * @param {string} candidatePassword - Plain text password to verify
 * @returns {Promise<boolean>} Resolves true if password matches, false otherwise
 */
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Compile and export the User model
const User = mongoose.model('User', userSchema);
module.exports = User;
