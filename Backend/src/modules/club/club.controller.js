// src/modules/club/club.controller.js
const clubService     = require('./club.service');
const { successResponse } = require('../../utils/response');

// Create Club
exports.createClub = async (req, res, next) => {
  try {
    const club = await clubService.createClub(
      req.body, req.file,
      { id: req.user.id, ip: req.ip, userAgent: req.headers['user-agent'] }
    );
    successResponse(res, { club }, 'Club created');
  } catch (err) { next(err); }
};

// List active clubs
exports.listClubs = async (req, res, next) => {
  try {
    const data = await clubService.listClubs(req.query);
    successResponse(res, data);
  } catch (err) { next(err); }
};

// Get club
exports.getClub = async (req, res, next) => {
  try {
    const club = await clubService.getClub(
      req.params.clubId,
      { id: req.user?.id, ip: req.ip, userAgent: req.headers['user-agent'] }
    );
    successResponse(res, { club });
  } catch (err) { next(err); }
};

// Update settings
exports.updateSettings = async (req, res, next) => {
  try {
    const club = await clubService.updateSettings(
      req.params.clubId,
      req.body,
      { 
        id: req.user.id, 
        role: req.user.roles?.global, 
        ip: req.ip, 
        userAgent: req.headers['user-agent'] 
      }
    );
    successResponse(res, { club }, 'Settings updated or pending approval');
  } catch (err) { next(err); }
};

// Approve protected settings
exports.approveSettings = async (req, res, next) => {
  try {
    const club = await clubService.approveSettings(
      req.params.clubId,
      { id: req.user.id, ip: req.ip, userAgent: req.headers['user-agent'] }
    );
    successResponse(res, { club }, 'Settings approved');
  } catch (err) { next(err); }
};

// Reject protected settings
exports.rejectSettings = async (req, res, next) => {
  try {
    const club = await clubService.rejectSettings(
      req.params.clubId,
      { id: req.user.id, ip: req.ip, userAgent: req.headers['user-agent'] }
    );
    successResponse(res, { club }, 'Settings rejected');
  } catch (err) { next(err); }
};

// Approve Club
exports.approveClub = async (req, res, next) => {
  try {
    const club = await clubService.approveClub(
      req.params.clubId,
      req.body.action,
      { id: req.user.id, ip: req.ip, userAgent: req.headers['user-agent'] }
    );
    successResponse(res, { club }, `Club ${req.body.action}d`);
  } catch (err) {
    next(err);
  }
};

// Archive Club (Leadership requests, Admin archives directly)
exports.archiveClub = async (req, res, next) => {
  try {
    const club = await clubService.archiveClub(
      req.params.clubId,
      req.body.reason,
      { id: req.user.id, ip: req.ip, userAgent: req.headers['user-agent'] }
    );
    const message = club.status === 'archived' 
      ? 'Club archived successfully' 
      : 'Archive request sent to coordinator for approval';
    successResponse(res, { club }, message);
  } catch (err) {
    next(err);
  }
};

// Approve/Reject Archive Request (Coordinator only)
exports.approveArchiveRequest = async (req, res, next) => {
  try {
    // Convert boolean 'approved' to string 'approve'/'reject' for service
    const decision = req.body.approved ? 'approve' : 'reject';
    
    const club = await clubService.approveArchiveRequest(
      req.params.clubId,
      decision,
      { id: req.user.id, ip: req.ip, userAgent: req.headers['user-agent'] }
    );
    const message = req.body.approved
      ? 'Club archived successfully' 
      : 'Archive request rejected';
    successResponse(res, { club }, message);
  } catch (err) {
    next(err);
  }
};

// Restore Archived Club
exports.restoreClub = async (req, res, next) => {
  try {
    const club = await clubService.restoreClub(
      req.params.clubId,
      { id: req.user.id, ip: req.ip, userAgent: req.headers['user-agent'] }
    );
    successResponse(res, { club }, 'Club restored successfully');
  } catch (err) {
    next(err);
  }
};

// Get club members
exports.getMembers = async (req, res, next) => {
  try {
    const members = await clubService.getMembers(req.params.clubId, req.query);
    successResponse(res, { members }, 'Club members retrieved');
  } catch (err) {
    next(err);
  }
};

// Add member to club
exports.addMember = async (req, res, next) => {
  try {
    const membership = await clubService.addMember(
      req.params.clubId,
      req.body.userId,
      req.body.role,
      { id: req.user.id, ip: req.ip, userAgent: req.headers['user-agent'] }
    );
    successResponse(res, { membership }, 'Member added successfully');
  } catch (err) {
    next(err);
  }
};

// Update member role
exports.updateMemberRole = async (req, res, next) => {
  try {
    const membership = await clubService.updateMemberRole(
      req.params.clubId,
      req.params.memberId,
      req.body.role,
      { id: req.user.id, ip: req.ip, userAgent: req.headers['user-agent'] }
    );
    successResponse(res, { membership }, 'Member role updated');
  } catch (err) {
    next(err);
  }
};

// Remove member from club
exports.removeMember = async (req, res, next) => {
  try {
    await clubService.removeMember(
      req.params.clubId,
      req.params.memberId,
      { id: req.user.id, ip: req.ip, userAgent: req.headers['user-agent'] }
    );
    successResponse(res, null, 'Member removed successfully');
  } catch (err) {
    next(err);
  }
};

// Get club analytics
exports.getAnalytics = async (req, res, next) => {
  try {
    const analytics = await clubService.getAnalytics(req.params.clubId, req.query);
    successResponse(res, { analytics }, 'Club analytics retrieved');
  } catch (err) {
    next(err);
  }
};

// Upload club banner
exports.uploadBanner = async (req, res, next) => {
  try {
    const club = await clubService.uploadBanner(
      req.params.clubId,
      req.file,
      { id: req.user.id, ip: req.ip, userAgent: req.headers['user-agent'] }
    );
    successResponse(res, { club }, 'Banner uploaded successfully');
  } catch (err) {
    next(err);
  }
};

// Get public stats for homepage (no auth required)
exports.getPublicStats = async (req, res, next) => {
  try {
    const stats = await clubService.getPublicStats();
    successResponse(res, stats);
  } catch (err) {
    next(err);
  }
};