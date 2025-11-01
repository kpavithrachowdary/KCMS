//src/modules/club/club.routes.js
const router       = require('express').Router({ mergeParams: true });
const authenticate = require('../../middlewares/auth');
const { 
  permit, 
  requireAdmin, 
  requireClubRole, 
  requireEither, 
  requireAssignedCoordinator,
  requireAdminOrCoordinatorOrClubRole,
  requirePresident,
  CORE_AND_PRESIDENT,  // All core roles + leadership
  LEADERSHIP_ROLES,    // President + Vice President (same permissions)
  PRESIDENT_ONLY       // President only (deprecated)
} = require('../../middlewares/permission');
const validate     = require('../../middlewares/validate');
const { validateUpload } = require('../../middlewares/fileValidator');
const multer       = require('multer');
const upload       = multer({ dest: 'uploads/' });
const v            = require('./club.validators');
const ctrl         = require('./club.controller');

// Create Club (Admin only - Section 3.1)
router.post(
  '/',
  authenticate,
  requireAdmin(),
  upload.single('logo'),
  validateUpload('image'), // Validate file type, size, and security
  validate(v.createClub),
  ctrl.createClub
);

// PUBLIC: Get platform stats for homepage (no auth required) - MUST BE BEFORE OTHER ROUTES
router.get('/public/stats', ctrl.getPublicStats);

// List Active Clubs (Public - Section 3.2)
router.get(
  '/',
  validate(v.listClubsSchema, 'query'),
  ctrl.listClubs
);

// Get Club Details (Public for basic info, Members for internal - Section 3.2)
router.get(
  '/:clubId',
  authenticate,
  validate(v.clubId, 'params'),
  ctrl.getClub
);

// Update Settings (Leadership can edit, Coordinator approval for protected - Section 3.3)
router.patch(
  '/:clubId/settings',
  authenticate,
  requireEither(['admin'], LEADERSHIP_ROLES), // ✅ Admin OR Leadership (President/Vice President)
  validate(v.clubId, 'params'),
  validate(v.updateSettings),
  ctrl.updateSettings
);

// Approve protected settings (Assigned Coordinator only - Section 3.3)
router.post(
  '/:clubId/settings/approve',
  authenticate,
  requireAssignedCoordinator(), // Admin OR Assigned Coordinator only
  validate(v.clubId, 'params'),
  validate(v.approveSettingsSchema),
  ctrl.approveSettings
);

// Reject protected settings (Assigned Coordinator only - Section 3.3)
router.post(
  '/:clubId/settings/reject',
  authenticate,
  requireAssignedCoordinator(), // Admin OR Assigned Coordinator only
  validate(v.clubId, 'params'),
  ctrl.rejectSettings
);

// NOTE: Club approval route removed - Admin creates clubs directly as 'active'
// Only settings changes require coordinator approval (see /settings/approve and /settings/reject above)

// Archive Club (Admin OR Leadership - Section 3.3)
// Leadership requests archive → coordinator approves, Admin archives directly
router.delete(
  '/:clubId',
  authenticate,
  requireEither(['admin'], LEADERSHIP_ROLES), // Admin OR Leadership (President/Vice President)
  validate(v.clubId, 'params'),
  validate(v.archiveClubSchema, 'body'),
  ctrl.archiveClub
);

// Approve/Reject Archive Request (Coordinator only)
router.post(
  '/:clubId/archive/approve',
  authenticate,
  requireAssignedCoordinator(),
  validate(v.clubId, 'params'),
  validate(v.approveArchiveSchema, 'body'),
  ctrl.approveArchiveRequest
);

// Restore Archived Club (Admin only)
router.post(
  '/:clubId/restore',
  authenticate,
  requireAdmin(), // Admin only
  validate(v.clubId, 'params'),
  ctrl.restoreClub
);

// Get club members (Members can view, Core+ can manage - Section 2.2)
router.get(
  '/:clubId/members',
  authenticate,
  requireAdminOrCoordinatorOrClubRole(['member', ...CORE_AND_PRESIDENT]), // Admin OR Assigned Coordinator OR All Club Members (member + all core + leadership)
  validate(v.clubId, 'params'),
  validate(v.getMembersSchema, 'query'),
  ctrl.getMembers
);

// Add member to club (Admin, Coordinator, Core+ can add members - Section 2.2)
router.post(
  '/:clubId/members',
  authenticate,
  requireAdminOrCoordinatorOrClubRole(CORE_AND_PRESIDENT), // ✅ Admin OR Assigned Coordinator OR Core+Leadership (service enforces role restrictions)
  validate(v.clubId, 'params'),
  validate(v.addMemberSchema),
  ctrl.addMember
);

// Update member role (Admin, Coordinator, Leadership can assign roles - Section 2.2)
router.patch(
  '/:clubId/members/:memberId',
  authenticate,
  requireAdminOrCoordinatorOrClubRole(CORE_AND_PRESIDENT), // ✅ Admin OR Assigned Coordinator OR Core+Leadership (service enforces role restrictions)
  validate(v.clubIdAndMemberId, 'params'),
  validate(v.updateMemberRoleSchema),
  ctrl.updateMemberRole
);

// Remove member from club (Admin, Coordinator, Leadership can remove - Section 2.2)
router.delete(
  '/:clubId/members/:memberId',
  authenticate,
  requireAdminOrCoordinatorOrClubRole(CORE_AND_PRESIDENT), // ✅ Admin OR Assigned Coordinator OR Core+Leadership (service enforces role restrictions)
  validate(v.clubIdAndMemberId, 'params'),
  ctrl.removeMember
);

// Get club analytics (Core+ can view analytics - Section 2.2)
router.get(
  '/:clubId/analytics',
  authenticate,
  requireAdminOrCoordinatorOrClubRole(['core', 'president', 'vicePresident', 'secretary', 'treasurer', 'leadPR', 'leadTech']), // Admin OR Assigned Coordinator OR All core team
  validate(v.clubId, 'params'),
  validate(v.analyticsSchema, 'query'),
  ctrl.getAnalytics
);

// Upload club banner (Leadership can upload banner - Section 3.3)
router.post(
  '/:clubId/banner',
  authenticate,
  requireEither(['admin'], LEADERSHIP_ROLES), // ✅ Admin OR Leadership (President/Vice President)
  validate(v.clubId, 'params'),
  upload.single('banner'),
  validateUpload('image'), // Validate file type, size, and security
  ctrl.uploadBanner
);

// Mount document routes under clubs/:clubId/documents
const documentRoutes = require('../document/document.routes');
router.use('/:clubId/documents', documentRoutes);

module.exports = router;