// src/modules/user/user.validators.js
const Joi = require('joi');
const { Types } = require('mongoose');

const objectId = Joi.string().custom((value, helper) => {
  return Types.ObjectId.isValid(value) ? value : helper.error('any.invalid');
}, 'ObjectId validation');

const passwordPattern = /^(?!.*(?:123456|password|qwerty)).*$/;

module.exports = {
  // Self: update profile
  updateProfileSchema: Joi.object({
    name: Joi.string().min(2).max(50),
    department: Joi.string().max(100),
    batch: Joi.string().max(20),
    year: Joi.number().integer().min(1).max(4), // Year of study: 1-4
    phone: Joi.string().max(20),
    profilePhoto: Joi.string().uri(),
    linkedIn: Joi.string().uri(),
    github: Joi.string().uri()
  }),

  // Self: change password
  changePasswordSchema: Joi.object({
    oldPassword: Joi.string().required(),
    newPassword: Joi.string()
      .min(8)
      .pattern(/[A-Z]/)
      .pattern(/[a-z]/)
      .pattern(/\d/)
      .pattern(/[^A-Za-z0-9]/)
      .pattern(passwordPattern)
      .required(),
    confirmPassword: Joi.any()
      .valid(Joi.ref('newPassword'))
      .required()
      .messages({ 'any.only': 'Passwords do not match' })
  }),

  // Admin: list users (with filters and pagination)
  listUsersSchema: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    search: Joi.string().allow(''), // General search across name, email, rollNumber
    name: Joi.string().allow(''),
    rollNumber: Joi.string().allow(''),
    email: Joi.string().email().allow(''),
    department: Joi.string().allow(''),
    role: Joi.string().valid('student','coordinator','admin').allow(''),
    status: Joi.string().valid('pending','otp_sent','verified','profile_complete','locked','suspended').allow('')
  }),

  // Admin: userId param
  userIdSchema: Joi.object({
    id: objectId.required()
  }),

  // Admin: update arbitrary fields
  updateUserSchema: Joi.object({
    email: Joi.string().email(),
    status: Joi.string().valid('pending','otp_sent','verified','profile_complete','locked','suspended'),
    // scoped roles update allowed, e.g. [{ club, role }]
    roles: Joi.object({
      global: Joi.string().valid('student','coordinator','admin'),
      scoped: Joi.array().items(
        Joi.object({
          club: objectId.required(),
          role: Joi.string().valid('member','core','president','vicePresident','secretary','treasurer','leadPR','leadTech')
        })
      )
    }),
    profile: Joi.object({
      name: Joi.string().min(2).max(50),
      department: Joi.string(),
      batch: Joi.string(),
      year: Joi.number().integer().min(1).max(4), // Year of study: 1-4
      phone: Joi.string(),
      profilePhoto: Joi.string().uri(),
      linkedIn: Joi.string().uri(),
      github: Joi.string().uri()
    })
  }).min(1),

  // Admin: change global role
  updateGlobalRoleSchema: Joi.object({
    global: Joi.string().valid('student','coordinator','admin').required()
  }),

  // Photo upload (no body payload)
  photoUploadParams: Joi.object({}),

  // Preferences update
  preferencesSchema: Joi.object({
    emailNotifications: Joi.boolean().required(),
    pushNotifications:  Joi.boolean().required()
  }),

  // Session revocation
  sessionIdParam: Joi.object({
    sessionId: objectId.required()
  })
};