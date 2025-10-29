const { hasGlobalRole, hasClubMembership } = require('../utils/rbac');
const { errorResponse } = require('../utils/response');

function normalizeRole(r) {
  return (r || '').toString();
}

/**
 * Leadership roles (president and vicePresident have SAME permissions)
 * ⚠️ IMPORTANT: President and Vice President have identical permissions
 */
const LEADERSHIP_ROLES = ['president', 'vicePresident'];

/**
 * Core team roles (all positions that are considered "core" level)
 * These roles have elevated permissions compared to regular members
 */
const CORE_ROLES = ['core', 'secretary', 'treasurer', 'leadPR', 'leadTech'];

/**
 * All management roles (core team + leadership)
 */
const CORE_AND_PRESIDENT = [...CORE_ROLES, ...LEADERSHIP_ROLES];

/**
 * Check if a role is a core team role (including leadership)
 */
function isCoreRole(role) {
  return CORE_AND_PRESIDENT.includes(role);
}

/**
 * Check if a role is president only
 */
function isPresidentOnly(role) {
  return role === 'president';
}

/**
 * Check if a role is leadership (president or vicePresident)
 */
function isLeadership(role) {
  return LEADERSHIP_ROLES.includes(role);
}

// ✅ Export these constants for use in routes
module.exports.CORE_ROLES = CORE_ROLES;
module.exports.LEADERSHIP_ROLES = LEADERSHIP_ROLES;
module.exports.CORE_AND_PRESIDENT = CORE_AND_PRESIDENT;
module.exports.PRESIDENT_ONLY = ['president']; // Deprecated - use LEADERSHIP_ROLES instead

/**
 * Check if user has required global role
 * @param {Object} user - User object with roles
 * @param {string[]} allowed - Array of allowed global roles
 * @returns {boolean}
 */
function checkGlobalRole(user, allowed = []) {
  if (!user || !user.roles || !user.roles.global) return false;
  const role = normalizeRole(user.roles.global);
  return allowed.some(a => a === role);
}

/**
 * Comprehensive permission checker that handles both global and scoped roles
 * Uses Membership collection as SINGLE SOURCE OF TRUTH for scoped roles
 * @param {Object} options - Permission options
 * @param {string[]} options.global - Required global roles
 * @param {string[]} options.scoped - Required scoped roles  
 * @param {string} options.clubParam - Parameter name for clubId (default: 'clubId')
 * @param {boolean} options.allowGlobalOverride - Allow global roles to override scoped (default: true)
 */
exports.permit = (options = {}) => {
  const { 
    global = [], 
    scoped = [], 
    clubParam = 'clubId',
    allowGlobalOverride = true 
  } = options;

  return async (req, res, next) => {
    // Check authentication
    if (!req.user) {
      return errorResponse(res, 401, 'Authentication required');
    }

    // Check global roles first (if specified)
    if (global.length > 0) {
      const hasGlobal = checkGlobalRole(req.user, global);
      if (hasGlobal) {
        return next(); // Global role allows access
      }
      
      // If global roles are required and user doesn't have them, deny access
      if (!allowGlobalOverride) {
        return errorResponse(res, 403, 'Insufficient global permissions');
      }
    }

    // Check scoped roles (if specified)
    if (scoped.length > 0) {
      const clubId = req.params[clubParam] || req.body[clubParam] || req.query[clubParam];
      
      if (!clubId) {
        return errorResponse(res, 400, `${clubParam} is required for this operation`);
      }

      try {
        // ✅ Use Membership collection (SINGLE SOURCE OF TRUTH)
        const hasScoped = await hasClubMembership(req.user.id, clubId, scoped);
        
        if (!hasScoped) {
          return errorResponse(res, 403, `Insufficient club permissions for ${clubParam}: ${clubId}`);
        }
        
        return next();
      } catch (error) {
        console.error('Error checking scoped permissions:', error);
        return errorResponse(res, 500, 'Error checking permissions');
      }
    }

    // If no specific roles required, allow authenticated user
    if (global.length === 0 && scoped.length === 0) {
      return next();
    }

    // If we reach here and no roles matched, deny access
    return errorResponse(res, 403, 'Access denied: insufficient permissions');
  };
};

/**
 * Require global roles only
 * @param {string[]} allowed - Array of allowed global roles
 */
exports.requireGlobal = (allowed = []) => {
  return exports.permit({ global: allowed, allowGlobalOverride: false });
};

/**
 * Require scoped roles only
 * @param {string[]} allowed - Array of allowed scoped roles
 * @param {string} clubParam - Parameter name for clubId
 */
exports.requireScoped = (allowed = [], clubParam = 'clubId') => {
  return exports.permit({ scoped: allowed, clubParam, allowGlobalOverride: false });
};

/**
 * Require either global OR scoped roles
 * @param {string[]} globalRoles - Required global roles
 * @param {string[]} scopedRoles - Required scoped roles
 * @param {string} clubParam - Parameter name for clubId
 */
exports.requireEither = (globalRoles = [], scopedRoles = [], clubParam = 'clubId') => {
  return exports.permit({ 
    global: globalRoles, 
    scoped: scopedRoles, 
    clubParam,
    allowGlobalOverride: true 
  });
};

/**
 * Club-specific permission checker
 * @param {string[]} roles - Required roles for the club
 * @param {string} clubParam - Parameter name for clubId
 */
exports.requireClubRole = (roles = [], clubParam = 'clubId') => {
  return exports.requireScoped(roles, clubParam);
};

/**
 * Admin-only access
 */
exports.requireAdmin = () => {
  return exports.requireGlobal(['admin']);
};

/**
 * Coordinator or Admin access
 */
exports.requireCoordinatorOrAdmin = () => {
  return exports.requireGlobal(['coordinator', 'admin']);
};

/**
 * Check if coordinator is accessing their assigned club only
 * Admins have full access to all clubs
 * @param {string} clubParam - Parameter name for clubId
 */
exports.requireAssignedCoordinator = (clubParam = 'clubId') => {
  return async (req, res, next) => {
    if (!req.user) {
      return errorResponse(res, 401, 'Authentication required');
    }

    // Admins have full access
    if (req.user.roles?.global === 'admin') {
      return next();
    }

    // Check if user is a coordinator
    if (req.user.roles?.global !== 'coordinator') {
      return errorResponse(res, 403, 'Coordinator or Admin access required');
    }

    // Get clubId from params/body/query
    const clubId = req.params[clubParam] || req.body[clubParam] || req.query[clubParam];
    
    if (!clubId) {
      return errorResponse(res, 400, `${clubParam} is required`);
    }

    // Check if this coordinator is assigned to this club
    const { Club } = require('../modules/club/club.model');
    try {
      const club = await Club.findById(clubId);
      
      if (!club) {
        return errorResponse(res, 404, 'Club not found');
      }

      // Check if coordinator matches
      if (club.coordinator.toString() !== req.user.id.toString()) {
        return errorResponse(res, 403, 'Access denied: You are not assigned to this club');
      }

      next();
    } catch (error) {
      console.error('Coordinator check error:', error);
      return errorResponse(res, 500, 'Error checking coordinator access');
    }
  };
};

/**
 * Allows Admin, OR assigned coordinator, OR club members with specific roles
 * @param {string[]} clubRoles - Required club roles (e.g., ['member', 'core'])
 * @param {string} clubParam - Parameter name for clubId
 */
exports.requireAdminOrCoordinatorOrClubRole = (clubRoles = [], clubParam = 'clubId') => {
  return async (req, res, next) => {
    if (!req.user) {
      return errorResponse(res, 401, 'Authentication required');
    }

    // Admin has full access
    if (req.user.roles?.global === 'admin') {
      return next();
    }

    const clubId = req.params[clubParam] || req.body[clubParam] || req.query[clubParam];
    
    if (!clubId) {
      return errorResponse(res, 400, `${clubParam} is required`);
    }

    // Check if assigned coordinator
    if (req.user.roles?.global === 'coordinator') {
      const { Club } = require('../modules/club/club.model');
      try {
        const club = await Club.findById(clubId);
        if (club && club.coordinator.toString() === req.user.id.toString()) {
          return next(); // Assigned coordinator - allow access
        }
      } catch (error) {
        console.error('Coordinator check error:', error);
      }
    }

    // ✅ Check club roles via Membership collection (SINGLE SOURCE OF TRUTH)
    if (clubRoles.length > 0) {
      const hasMembership = await hasClubMembership(req.user.id, clubId, clubRoles);
      if (hasMembership) {
        return next();
      }
    }

    return errorResponse(res, 403, 'Access denied: Insufficient permissions');
  };
};

/**
 * Require president role ONLY (not core team)
 * Uses Membership collection as SINGLE SOURCE OF TRUTH
 * @param {string} clubParam - Parameter name for clubId
 */
exports.requirePresident = (clubParam = 'clubId') => {
  return async (req, res, next) => {
    if (!req.user) {
      return errorResponse(res, 401, 'Authentication required');
    }

    // Admin always has access
    if (req.user.roles?.global === 'admin') {
      return next();
    }

    const clubId = req.params[clubParam] || req.body[clubParam] || req.query[clubParam];
    
    if (!clubId) {
      return errorResponse(res, 400, `${clubParam} is required`);
    }

    try {
      // ✅ Use Membership collection (SINGLE SOURCE OF TRUTH)
      const { Membership } = require('../modules/club/membership.model');
      const membership = await Membership.findOne({
        user: req.user.id,
        club: clubId,
        status: 'approved'
      });

      if (!membership) {
        return errorResponse(res, 403, 'Not a member of this club');
      }

      // Check if president
      if (membership.role !== 'president') {
        return errorResponse(res, 403, `President access required. Your role: ${membership.role}`);
      }

      next();
    } catch (error) {
      console.error('Error checking president permission:', error);
      return errorResponse(res, 500, 'Error checking permissions');
    }
  };
};

/**
 * Require assigned coordinator OR club role for EVENT operations
 * This middleware loads the event, finds its club, then checks permissions
 * @param {string[]} clubRoles - Required club roles (e.g., ['core', 'president'])
 */
exports.requireAssignedCoordinatorOrClubRoleForEvent = (clubRoles = []) => {
  return async (req, res, next) => {
    if (!req.user) {
      return errorResponse(res, 401, 'Authentication required');
    }

    // Admin always has access
    if (req.user.roles?.global === 'admin') {
      return next();
    }

    // Get event ID from params
    const eventId = req.params.id;
    
    if (!eventId) {
      return errorResponse(res, 400, 'Event ID is required');
    }

    try {
      // Load event to get its club
      const { Event } = require('../modules/event/event.model');
      const event = await Event.findById(eventId).populate('club', 'coordinator');
      
      if (!event) {
        return errorResponse(res, 404, 'Event not found');
      }

      // Check if assigned coordinator
      if (req.user.roles?.global === 'coordinator') {
        // event.club is populated with coordinator field
        if (event.club.coordinator && event.club.coordinator.toString() === req.user.id.toString()) {
          return next(); // ✅ Assigned coordinator - allow access
        }
      }

      // Check club roles via Membership collection
      // ✅ FIX: Check BOTH primary club AND participating clubs
      if (clubRoles.length > 0) {
        // Check primary club
        const hasClubRole = await hasClubMembership(req.user.id, event.club._id.toString(), clubRoles);
        if (hasClubRole) {
          return next();
        }
        
        // ✅ NEW: Check participating clubs
        if (event.participatingClubs && event.participatingClubs.length > 0) {
          for (const participatingClubId of event.participatingClubs) {
            const hasParticipatingClubRole = await hasClubMembership(
              req.user.id, 
              participatingClubId.toString(), 
              clubRoles
            );
            if (hasParticipatingClubRole) {
              return next();
            }
          }
        }
      }

      return errorResponse(res, 403, 'Access denied: Not assigned coordinator or club member');
    } catch (error) {
      console.error('Permission check error:', error);
      return errorResponse(res, 500, 'Error checking permissions');
    }
  };
};
