const router       = require('express').Router();
const authenticate = require('../../middlewares/auth');
const optionalAuth = require('../../middlewares/optionalAuth'); // ✅ Optional authentication
const { 
  permit, 
  requireEither, 
  requireAssignedCoordinatorOrClubRoleForEvent,
  CORE_AND_PRESIDENT,  // ✅ All core roles + leadership
  LEADERSHIP_ROLES,    // ✅ President + Vice President (same permissions)
  PRESIDENT_ONLY       // ✅ President only (deprecated)
} = require('../../middlewares/permission');
const validate     = require('../../middlewares/validate');
const parseFormData = require('../../middlewares/parseFormData');
const multer       = require('multer');
const upload       = multer({ dest: 'uploads/' });
const v            = require('./event.validators');
const ctrl         = require('./event.controller');

// Create Event (Core+ can create events - Section 5.1)
router.post(
  '/',
  authenticate,
  upload.fields([
    { name: 'proposal', maxCount: 1 },
    { name: 'budgetBreakdown', maxCount: 1 },
    { name: 'venuePermission', maxCount: 1 }
  ]),
  parseFormData,
  requireEither(['admin'], CORE_AND_PRESIDENT, 'club'), // ✅ Core team + President
  validate(v.createEvent),
  ctrl.createEvent
);

// List Events (Public but with optional authentication for permission filtering - Section 5.1)
// ✅ Uses optionalAuth to extract user info if available, but doesn't require login
router.get(
  '/',
  optionalAuth,
  validate(v.list),
  ctrl.listEvents
);

// Get Event Details (Public but with optional auth for registration check - Section 5.1)
// Uses optionalAuth to check if user has registered, but still allows public access
router.get(
  '/:id',
  optionalAuth, // Get user context if logged in
  validate(v.eventId, 'params'),
  ctrl.getEvent
);

// Update Event (Core+ can update draft events - Section 5.1)
router.patch(
  '/:id',
  authenticate,
  upload.fields([
    { name: 'proposal', maxCount: 1 },
    { name: 'budgetBreakdown', maxCount: 1 },
    { name: 'venuePermission', maxCount: 1 }
  ]),
  parseFormData,
  requireAssignedCoordinatorOrClubRoleForEvent(CORE_AND_PRESIDENT), // ✅ Check permissions based on event's club, not request body
  validate(v.eventId, 'params'),
  validate(v.updateEvent),
  ctrl.updateEvent
);

// Delete Event (Core+ can delete draft events - Section 5.1)
router.delete(
  '/:id',
  authenticate,
  requireAssignedCoordinatorOrClubRoleForEvent(CORE_AND_PRESIDENT), // ✅ Check permissions based on event's club
  validate(v.eventId, 'params'),
  ctrl.deleteEvent
);

// Change Status (Core+ OR Assigned Coordinator can change status - Section 5.1)
router.patch(
  '/:id/status',
  authenticate,
  requireAssignedCoordinatorOrClubRoleForEvent(CORE_AND_PRESIDENT), // ✅ Admin OR Assigned Coordinator OR Core+President
  validate(v.eventId, 'params'),
  validate(v.changeStatus),
  ctrl.changeStatus
);

// RSVP (Students can RSVP - Section 2.1)
router.post(
  '/:id/rsvp',
  authenticate,
  validate(v.eventId, 'params'),
  ctrl.rsvp
);

// Mark Attendance (Core+ can mark attendance - Section 5.2)
router.post(
  '/:id/attendance',
  authenticate,
  requireEither(['admin', 'coordinator'], CORE_AND_PRESIDENT), // ✅ Admin/Coordinator OR Core+President
  validate(v.eventId, 'params'),
  validate(v.attendance),
  ctrl.markAttendance
);

// Budget Requests (Core+ can create budget requests - Section 5.3)
router.post(
  '/:id/budget',
  authenticate,
  requireEither(['admin'], CORE_AND_PRESIDENT), // ✅ Admin OR Core+President
  validate(v.eventId, 'params'),
  validate(v.budgetRequest),
  ctrl.createBudget
);

// List Budget Requests (Core+ can view budget requests - Section 5.3)
router.get(
  '/:id/budget',
  authenticate,
  requireEither(['admin'], CORE_AND_PRESIDENT), // ✅ Admin OR Core+President
  validate(v.eventId, 'params'),
  ctrl.listBudgets
);

// Settle Budget (Leadership can settle budget - Section 5.3)
router.post(
  '/:id/budget/settle',
  authenticate,
  requireEither(['admin'], LEADERSHIP_ROLES), // Admin OR Leadership (President/Vice President)
  validate(v.eventId, 'params'),
  validate(v.settleBudget),
  ctrl.settleBudget
);

// Upload Completion Materials (Photos, Report, Attendance, Bills)
router.post(
  '/:id/upload-materials',
  authenticate,
  upload.fields([
    { name: 'photos', maxCount: 10 },
    { name: 'report', maxCount: 1 },
    { name: 'attendance', maxCount: 1 },
    { name: 'bills', maxCount: 10 }
  ]),
  requireAssignedCoordinatorOrClubRoleForEvent(CORE_AND_PRESIDENT), // ✅ Event creators can upload
  validate(v.eventId, 'params'),
  ctrl.uploadCompletionMaterials
);

// Get Event Organizers (with attendance status)
router.get(
  '/:id/organizers',
  authenticate,
  requireAssignedCoordinatorOrClubRoleForEvent(CORE_AND_PRESIDENT), // ✅ Event managers can view
  validate(v.eventId, 'params'),
  ctrl.getEventOrganizers
);

// Update Organizer Attendance (bulk update)
router.post(
  '/:id/organizer-attendance',
  authenticate,
  requireAssignedCoordinatorOrClubRoleForEvent(CORE_AND_PRESIDENT), // ✅ Event managers can update
  validate(v.eventId, 'params'),
  validate(v.organizerAttendance), // ✅ Validate attendance array
  ctrl.updateOrganizerAttendance
);

// Generate Attendance Report (JSON or CSV)
router.get(
  '/:id/attendance-report',
  authenticate,
  requireAssignedCoordinatorOrClubRoleForEvent(CORE_AND_PRESIDENT), // ✅ Event managers can generate
  validate(v.eventId, 'params'),
  ctrl.generateAttendanceReport
);

module.exports = router;