//src/modules/user/user.service.js
const { User }           = require('../auth/user.model');
const { Session }        = require('../auth/session.model');
const cloudinary         = require('../../utils/cloudinary');
const authService        = require('../auth/auth.service');
const auditService       = require('../audit/audit.service');
const notificationService= require('../notification/notification.service');

class UserService {
  // 1) Self: get current profile
  async getMe(userId) {
    const user = await User.findById(userId).select('-passwordHash').lean();
    if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 });
    
    // Fetch user's club memberships from Membership collection (SINGLE SOURCE OF TRUTH)
    const { Membership } = require('../club/membership.model');
    const memberships = await Membership.find({
      user: userId,
      status: 'approved'
    }).populate('club', 'name').lean();

    // Transform memberships to match old roles.scoped format for frontend compatibility
    const scopedRoles = memberships.map(m => ({
      club: m.club._id,
      role: m.role,
      clubName: m.club.name
    }));

    // Attach scoped roles to user object (populated from Membership)
    user.roles = {
      ...user.roles,
      scoped: scopedRoles
    };
    
    return user;
  }

  // 2) Self: update profile fields
  async updateProfile(userId, data, userContext) {
    const prev = await User.findById(userId);
    if (!prev) throw Object.assign(new Error('User not found'), { statusCode: 404 });

    const user = await User.findByIdAndUpdate(
      userId,
      { profile: data },
      { new: true, select: '-passwordHash' }
    ).lean();

    // ✅ Fetch user's club memberships from Membership collection (SINGLE SOURCE OF TRUTH)
    const { Membership } = require('../club/membership.model');
    const memberships = await Membership.find({
      user: userId,
      status: 'approved'
    }).populate('club', 'name').lean();

    // Transform memberships to match old roles.scoped format for frontend compatibility
    const scopedRoles = memberships.map(m => ({
      club: m.club._id,
      role: m.role,
      clubName: m.club.name
    }));

    // Attach scoped roles to user object (populated from Membership)
    user.roles = {
      ...user.roles,
      scoped: scopedRoles
    };

    await auditService.log({
      user: userId,
      action: 'PROFILE_UPDATE',
      target: `User:${userId}`,
      oldValue: prev.profile,
      newValue: data,
      ip: userContext.ip,
      userAgent: userContext.userAgent
    });

    return user;
  }

  // 3) Self: change own password
  async changePassword(userId, oldPassword, newPassword, userContext) {
    const user = await User.findById(userId);
    if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 });

    const ok = await user.verifyPassword(oldPassword);
    if (!ok) throw Object.assign(new Error('Old password is incorrect'), { statusCode: 400 });

    await user.setPassword(newPassword);
    await user.save();

    // Revoke all sessions
    await authService.revokeAllSessions(userId);

    // Audit log
    await auditService.log({
      user: userId,
      action: 'PASSWORD_CHANGE',
      target: `User:${userId}`,
      ip: userContext.ip,
      userAgent: userContext.userAgent
    });

    // Notification
    await notificationService.create({
      user: userId,
      type: 'system_maintenance',  // or 'password_change'
      payload: {},
      priority: 'MEDIUM'
    });
  }

  // Get my clubs - ✅ IMPROVED: Query Membership collection directly
  async getMyClubs(userId, roleFilter) {
    const user = await User.findById(userId);
    if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 });
    
    // ✅ SINGLE SOURCE OF TRUTH: Query Membership collection
    const { Membership } = require('../club/membership.model');
    const query = { 
      user: userId, 
      status: 'approved' // Only approved memberships
    };
    
    // Filter by specific club role if requested
    if (roleFilter) {
      query.role = roleFilter;
    }
    
    // Get memberships and populate club details
    let memberships = await Membership.find(query)
      .populate({
        path: 'club',
        select: 'name category logoUrl status',
        match: { status: { $in: ['active', 'pending_archive'] } } // Include pending_archive - club functional until approved
      })
      .sort({ createdAt: -1 }); // Most recent first
    
    let clubs = memberships
      .filter(m => m.club) // Filter out null clubs (inactive/deleted)
      .map(m => ({
        club: m.club,
        role: m.role,
        joinedAt: m.createdAt // Use createdAt as joinedAt
      }));
    
    // ✅ If user is a coordinator, also include clubs they coordinate
    if (user.roles?.global === 'coordinator') {
      const { Club } = require('../club/club.model');
      const coordinatedClubs = await Club.find({ 
        coordinator: userId,
        status: { $in: ['active', 'pending_archive'] } // Include pending_archive
      }).select('name category logoUrl status');
      
      // Add coordinated clubs to the list
      coordinatedClubs.forEach(club => {
        // Don't duplicate if already in memberships
        const exists = clubs.some(c => c.club._id.toString() === club._id.toString());
        if (!exists) {
          clubs.push({
            club: club,
            role: 'coordinator'
          });
        }
      });
    }
    
    return clubs;
  }

  // 4) List users with filters & pagination (Admin sees all, others see students only)
  async listUsers(filters, page = 1, limit = 20, userContext = null) {
    const query = {};
    
    // General search across name, email, and rollNumber
    if (filters.search) {
      const searchRegex = new RegExp(filters.search, 'i');
      query.$or = [
        { 'profile.name': searchRegex },
        { email: searchRegex },
        { rollNumber: searchRegex }
      ];
    }
    
    // Specific field filters (only applied if search is not used)
    if (!filters.search) {
      if (filters.name)       query['profile.name']    = new RegExp(filters.name, 'i');
      if (filters.rollNumber) query.rollNumber         = filters.rollNumber;
      if (filters.email)      query.email              = filters.email;
    }
    
    if (filters.department) query['profile.department'] = filters.department;
    if (filters.role)       query['roles.global']    = filters.role;
    if (filters.status)     query.status             = filters.status;

    // Non-admins can only see students (for adding to clubs)
    if (userContext && userContext.roles?.global !== 'admin') {
      query['roles.global'] = 'student';
    }
    
    const skip = (page - 1) * limit;
    const [total, users] = await Promise.all([
      User.countDocuments(query),
      User.find(query)
        .select('-passwordHash')
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
    ]);

    return { total, page, limit, users };
  }

  // 5) Admin: get any user
  async getUserById(id) {
    const user = await User.findById(id).select('-passwordHash');
    if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 });
    return user;
  }

  // 6) Admin: update user fields
  async updateUserById(id, data, userContext) {
    const prev = await User.findById(id);
    if (!prev) throw Object.assign(new Error('User not found'), { statusCode: 404 });

    const user = await User.findByIdAndUpdate(id, data, {
      new: true,
      select: '-passwordHash'
    });

    await auditService.log({
      user: userContext.id,
      action: 'USER_UPDATE',
      target: `User:${id}`,
      oldValue: prev.toObject(),
      newValue: data,
      ip: userContext.ip,
      userAgent: userContext.userAgent
    });

    return user;
  }

  // 7) Admin: change global role
  async changeGlobalRole(id, globalRole, userContext) {
    const user = await User.findById(id);
    if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 });

    const oldRole = user.roles.global;
    user.roles.global = globalRole;
    await user.save();
    
    // If promoted to coordinator or admin, remove all club memberships
    // (coordinators/admins have system-level access, shouldn't be club members)
    if ((globalRole === 'coordinator' || globalRole === 'admin') && oldRole === 'student') {
      const { Membership } = require('../club/membership.model');
      const removedMemberships = await Membership.find({ user: id });
      await Membership.deleteMany({ user: id });
      
      // Log membership removals
      if (removedMemberships.length > 0) {
        await auditService.log({
          user: userContext.id,
          action: 'MEMBERSHIPS_REMOVED',
          target: `User:${id}`,
          oldValue: JSON.stringify(removedMemberships.map(m => ({ club: m.club, role: m.role }))),
          newValue: `Removed ${removedMemberships.length} club membership(s) due to promotion to ${globalRole}`,
          ip: userContext.ip,
          userAgent: userContext.userAgent
        });
      }
    }

    await auditService.log({
      user: userContext.id,
      action: 'ROLE_CHANGE',
      target: `User:${id}`,
      oldValue: { global: oldRole },
      newValue: { global: globalRole },
      ip: userContext.ip,
      userAgent: userContext.userAgent
    });

    await notificationService.create({
      user: id,
      type: 'role_assigned',
      payload: { global: globalRole },
      priority: 'MEDIUM'
    });

    return user;
  }

  // 8) Admin: suspend/delete user
  async suspendUser(id, userContext) {
    const user = await User.findById(id);
    if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 });
    user.status = 'suspended';
    await user.save();

    await auditService.log({
      user: userContext.id,
      action: 'USER_SUSPEND',
      target: `User:${id}`,
      ip: userContext.ip,
      userAgent: userContext.userAgent
    });

    await notificationService.create({
      user: id,
      type: 'system_maintenance',  // or 'account_suspended'
      payload: {},
      priority: 'HIGH'
    });

    return user;
  }

  // 8b) Admin: permanently delete user
  async deleteUser(id, userContext) {
    const user = await User.findById(id);
    if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 });
    
    const userEmail = user.email;
    const userName = user.profile?.name || 'Unknown';

    // Log audit BEFORE deletion
    await auditService.log({
      user: userContext.id,
      action: 'USER_DELETE',
      target: `User:${id}`,
      oldValue: JSON.stringify({ email: userEmail, name: userName }),
      ip: userContext.ip,
      userAgent: userContext.userAgent
    });

    // Permanently delete from database
    await User.findByIdAndDelete(id);

    return { email: userEmail, name: userName };
  }

  // 9) Self: upload profile photo
  async uploadPhoto(userId, file, userContext) {
    if (!file) throw Object.assign(new Error('No file provided'), { statusCode: 400 });

    const res = await cloudinary.uploadImage(file.path, {
      folder: `users/${userId}/profile`,
      transformation: [{ width: 256, height: 256, crop: 'thumb' }]
    });

    const user = await User.findById(userId);
    if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 });

    user.profile.profilePhoto = res.secure_url;
    await user.save();

    await auditService.log({
      user: userId,
      action: 'PROFILE_PHOTO_UPLOAD',
      target: `User:${userId}`,
      newValue: { profilePhoto: res.secure_url },
      ip: userContext.ip,
      userAgent: userContext.userAgent
    });

    await notificationService.create({
      user: userId,
      type: 'system_maintenance', // or 'profile_photo_updated'
      payload: { url: res.secure_url },
      priority: 'MEDIUM'
    });

    return { profilePhoto: res.secure_url };
  }

  // 10) Self: update notification preferences
  async updatePreferences(userId, prefs, userContext) {
    const user = await User.findByIdAndUpdate(
      userId,
      { preferences: prefs },
      { new: true, select: 'preferences' }
    );
    if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 });

    await auditService.log({
      user: userId,
      action: 'PREFERENCES_UPDATE',
      target: `User:${userId}`,
      newValue: prefs,
      ip: userContext.ip,
      userAgent: userContext.userAgent
    });

    return user.preferences;
  }

  // 11) Self: list active sessions
  async listSessions(userId) {
    return Session.find({ user: userId, revokedAt: null })
      .select('userAgent ip createdAt expiresAt');
  }

  // 12) Self: revoke a session
  async revokeSession(userId, sessionId, userContext) {
    const session = await Session.findOne({
      _id: sessionId,
      user: userId,
      revokedAt: null
    });
    if (!session) throw Object.assign(new Error('Session not found'), { statusCode: 404 });

    session.revokedAt = new Date();
    await session.save();

    await auditService.log({
      user: userContext.id,
      action: 'SESSION_REVOKE',
      target: `Session:${sessionId}`,
      ip: userContext.ip,
      userAgent: userContext.userAgent
    });

    await notificationService.create({
      user: userId,
      type: 'system_maintenance', // or 'session_revoked'
      payload: { sessionId },
      priority: 'MEDIUM'
    });
  }
}

module.exports = new UserService();