// src/modules/auth/user.model.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const SALT = 12;

const UserSchema = new mongoose.Schema({
  rollNumber: {
    type: String, required: true, unique: true,
    match: /^[0-9]{2}[Bb][Dd][A-Za-z0-9]{6}$/
  },
  email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  passwordHistory: {
    type: [String],      // store last 3 password hashes
    default: []
  },
  forgotPasswordRequestedAt: Date,
  loginAttempts: { type: Number, default: 0 },
  accountLockedUntil: Date,

  status: {
    type: String,
    enum: ['pending', 'otp_sent', 'verified', 'profile_complete', 'locked', 'suspended'],
    default: 'pending'
  },

  roles: {
    global: {
      type: String,
      enum: ['student', 'coordinator', 'admin'],
      default: 'student'
    }
    // REMOVED scoped roles - Use Membership collection as SINGLE SOURCE OF TRUTH
  },

  profile: {
    name: String,
    department: String,
    batch: String,
    year: Number,
    phone: String,
    profilePhoto: String,
    linkedIn: String,
    github: String
  }
}, { timestamps: true });

// Workplan Line 592: Database indexes for performance
UserSchema.index({ rollNumber: 1 });
UserSchema.index({ email: 1 });

// Override setPassword to push to history
UserSchema.methods.setPassword = async function (plain) {
  // Check not reusing last 3
  for (let oldHash of this.passwordHistory) {
    if (await bcrypt.compare(plain, oldHash)) {
      throw new Error('Cannot reuse last 3 passwords');
    }
  }
  // push current hash to history
  if (this.passwordHash) {
    this.passwordHistory.unshift(this.passwordHash);
    if (this.passwordHistory.length > 3) this.passwordHistory.pop();
  }
  this.passwordHash = await bcrypt.hash(plain, SALT);
};

UserSchema.methods.verifyPassword = function (plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

module.exports.User = mongoose.model('User', UserSchema);