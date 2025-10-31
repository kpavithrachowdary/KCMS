const Joi = require('joi');
const { Types } = require('mongoose');
const objectId = Joi.string().custom((v,h)=>
  Types.ObjectId.isValid(v)?v:h.error('invalid id')
);

module.exports = {
  createEvent: Joi.object({
    club: objectId.required(),
    title: Joi.string().max(100).required(),
    description: Joi.string().max(1000).optional(),
    objectives: Joi.string().max(500).optional(),
    dateTime: Joi.date()
      .required()
      .min('now')
      .messages({
        'date.min': 'Event date must be in the future',
        'date.base': 'Invalid date format',
        'any.required': 'Event date is required'
      }),
    duration: Joi.number().min(0).required(),
    venue: Joi.string().max(200).optional(),
    capacity: Joi.number().min(0).optional(),
    expectedAttendees: Joi.number().min(0).optional(),
    isPublic: Joi.boolean().optional(),
    budget: Joi.number().min(0).optional(),
    guestSpeakers: Joi.alternatives().try(
      Joi.array().items(Joi.string()),
      Joi.string()
    ).optional(),
    participatingClubs: Joi.alternatives().try(
      Joi.array().items(objectId),
      Joi.string()
    ).optional(),
    requiresAudition: Joi.alternatives().try(
      Joi.boolean(),
      Joi.string().valid('true', 'false')
    ).optional(),
    allowPerformerRegistrations: Joi.alternatives().try(
      Joi.boolean(),
      Joi.string().valid('true', 'false')
    ).optional()
  }),

  updateEvent: Joi.object({
    title: Joi.string().max(100).optional(),
    description: Joi.string().max(1000).optional(),
    objectives: Joi.string().max(500).optional(),
    dateTime: Joi.date().optional(),
    duration: Joi.number().min(0).optional(),
    venue: Joi.string().max(200).optional(),
    capacity: Joi.number().min(0).optional(),
    expectedAttendees: Joi.number().min(0).optional(),
    isPublic: Joi.boolean().optional(),
    budget: Joi.number().min(0).optional(),
    guestSpeakers: Joi.alternatives().try(
      Joi.array().items(Joi.string()),
      Joi.string()
    ).optional(),
    participatingClubs: Joi.alternatives().try(
      Joi.array().items(objectId),
      Joi.string()
    ).optional(),
    requiresAudition: Joi.alternatives().try(
      Joi.boolean(),
      Joi.string().valid('true', 'false')
    ).optional(),
    allowPerformerRegistrations: Joi.alternatives().try(
      Joi.boolean(),
      Joi.string().valid('true', 'false')
    ).optional()
  }),

  list: Joi.object({
    club: objectId.optional(),
    status: Joi.string().valid('draft','pending_coordinator','pending_admin','published','ongoing','completed','archived').optional(),
    limit: Joi.number().min(1).max(100).optional(),
    page: Joi.number().min(1).optional(),
    startDate: Joi.date().optional(),
    endDate: Joi.date().optional(),
    upcoming: Joi.boolean().optional(), // Filter for future events only
    past: Joi.boolean().optional() // Filter for past events only
  }),

  eventId: Joi.object({ id: objectId.required() }),

  changeStatus: Joi.object({
    action: Joi.string().valid('submit','approve','reject','publish','start','complete').required(),
    reason: Joi.string().min(10).max(500).when('action', {
      is: 'reject',
      then: Joi.required(),
      otherwise: Joi.optional()
    })
  }),

  rsvp: Joi.object({}),

  attendance: Joi.object({
    userId: objectId.optional(), // for admin/qr mark
    qrCode: Joi.string().optional()
  }),

  organizerAttendance: Joi.array().items(
    Joi.object({
      userId: objectId.required(),
      status: Joi.string().valid('present', 'absent').required()
    })
  ).min(1),

  budgetRequest: Joi.object({
    amount: Joi.number().min(0).required(),
    breakdown: Joi.string().max(1000).optional(),
    quotations: Joi.array().items(Joi.string().uri()).optional()
  }),

  settleBudget: Joi.object({
    reportUrl: Joi.string().uri().required(),
    unusedFunds: Joi.number().min(0).optional()
  })
};