// src/modules/club/club.service.js
const { Club }       = require('./club.model');
const { Membership } = require('./membership.model');
const cloudinary     = require('../../utils/cloudinary');
const redis          = require('../../config/redis');
const mongoose       = require('mongoose');
const auditService        = require('../audit/audit.service');
const notificationService = require('../notification/notification.service');

const CLUB_LIST_CACHE = 'clubs:list';

class ClubService {
  // Clear cached club listings
  async flushCache() {
    const keys = await redis.keys(`${CLUB_LIST_CACHE}:*`);
    if (keys.length) await redis.del(...keys);
  }

  // Create a new club
  async createClub(data, logoFile, userContext) {
    // Import User model for validation
    const { User } = require('../auth/user.model');
    
    // Check if club name already exists
    if (await Club.findOne({ name: data.name })) {
      const err = new Error('Club name already exists');
      err.statusCode = 409;
      throw err;
    }

    // ✅ VALIDATE COORDINATOR: Must be a coordinator role
    const coordinator = await User.findById(data.coordinator);
    if (!coordinator) {
      const err = new Error('Coordinator user not found');
      err.statusCode = 404;
      throw err;
    }
    if (coordinator.roles?.global !== 'coordinator' && coordinator.roles?.global !== 'admin') {
      const err = new Error('Coordinator must have coordinator or admin role. Selected user is: ' + coordinator.roles?.global);
      err.statusCode = 400;
      throw err;
    }

    // ✅ VALIDATE PRESIDENT: Must be a student role
    const president = await User.findById(data.president);
    if (!president) {
      const err = new Error('President user not found');
      err.statusCode = 404;
      throw err;
    }
    if (president.roles?.global !== 'student') {
      const err = new Error('President must be a student. Selected user is: ' + president.roles?.global);
      err.statusCode = 400;
      throw err;
    }

    // Create the club logo if provided
    let logoUrl = '';
    if (logoFile) {
      const res = await cloudinary.uploader.upload(logoFile.path, {
        folder: `clubs/${data.name}/logo`,
        width: 500, height: 500, crop: 'limit'
      });
      logoUrl = res.secure_url;
    }

    // Create club document - Admin creates directly as active
    const club = await Club.create({ ...data, logoUrl, status: 'active' });

    // ✅ ADD PRESIDENT as club member with president role
    await Membership.create({
      club: club._id,
      user: data.president,
      role: 'president',
      status: 'approved'
    });

    // Add core members (excluding president if already in list)
    if (Array.isArray(data.coreMembers)) {
      const coreMembers = data.coreMembers.filter(id => id.toString() !== data.president.toString());
      await Promise.all(coreMembers.map(userId =>
        Membership.create({
          club: club._id,
          user: userId,
          role: 'core',
          status: 'approved'
        })
      ));
    }
    
    // NOTE: Coordinator is NOT added as a club member
    // They are assigned via the club.coordinator field for oversight role only

    // Notify coordinator about club assignment
    await notificationService.create({
      user: data.coordinator,
      type: 'role_assigned',
      payload: { clubId: club._id, name: club.name, role: 'coordinator' },
      priority: 'HIGH'
    });

    // Notify president about club leadership
    await notificationService.create({
      user: data.president,
      type: 'role_assigned',
      payload: { clubId: club._id, name: club.name, role: 'president' },
      priority: 'HIGH'
    });

    // Audit the creation
    await auditService.log({
      user: userContext.id,
      action: 'CLUB_CREATE',
      target: `Club:${club._id}`,
      newValue: club.toObject(),
      ip: userContext.ip,
      userAgent: userContext.userAgent
    });

    await this.flushCache();
    return club;
  }

  // List active clubs (with Redis caching)
  async listClubs({ category, search, coordinator, status, page = 1, limit = 20, _t }) {
    const key = `${CLUB_LIST_CACHE}:${category||'all'}:${search||''}:${coordinator||''}:${status||'active'}:${page}:${limit}`;
    
    // Skip cache if timestamp parameter is provided (cache busting)
    const cached = _t ? null : await redis.get(key);
    if (cached) return JSON.parse(cached);

    // ✅ Default includes both active and pending_archive (functionally active)
    const query = status 
      ? { status } 
      : { status: { $in: ['active', 'pending_archive'] } };
    if (category) query.category = category;
    if (search) query.name = new RegExp(search, 'i');
    if (coordinator) query.coordinator = coordinator; // Filter by assigned coordinator

    const skip = (page - 1) * limit;
    const [total, clubs] = await Promise.all([
      Club.countDocuments(query),
      Club.find(query)
        .populate('coordinator', 'profile.name email')
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
    ]);

    // ✅ ADD MEMBER COUNT to each club
    const clubsWithCounts = await Promise.all(
      clubs.map(async (club) => {
        const clubObj = club.toObject();
        const memberCount = await Membership.countDocuments({ 
          club: club._id, 
          status: 'approved' 
        });
        clubObj.memberCount = memberCount;
        return clubObj;
      })
    );

    const result = { total, page, limit, clubs: clubsWithCounts };
    
    await redis.set(key, JSON.stringify(result), 'EX', 300);
    return result;
  }

  // Get club details, include members if scoped
  async getClub(clubId, userContext) {
    const club = await Club.findById(clubId)
      .populate('coordinator', 'profile.name email roles.global');
    // ✅ Treat pending_archive as active - club remains functional until coordinator approves
    if (!club || (club.status !== 'active' && club.status !== 'pending_archive')) {
      const err = new Error('Club not found');
      err.statusCode = 404;
      throw err;
    }
    const data = club.toObject();

    // ✅ ADD MEMBER COUNT
    const memberCount = await Membership.countDocuments({ 
      club: clubId, 
      status: 'approved' 
    });
    data.memberCount = memberCount;

    // If user is a member, include full member list
    if (userContext) {
      const membership = await Membership.findOne({
        club: clubId,
        user: userContext.id,
        status: 'approved'
      });
      
      if (membership) {
        data.members = await Membership.find({ club: clubId, status: 'approved' })
          .populate('user', 'profile.name rollNumber');
        
        // ✅ Add permission flags (BACKEND is SOURCE OF TRUTH)
        data.userRole = membership.role; // User's role in this club
        data.canEdit = membership.role === 'president'; // Only president can edit
        data.canManage = ['president', 'core', 'vicePresident', 'secretary', 'treasurer', 'leadPR', 'leadTech'].includes(membership.role);
      } else {
        // User is not a member
        data.canEdit = false;
        data.canManage = false;
      }
      
      // Admin override
      if (userContext.roles?.global === 'admin') {
        data.canEdit = true;
        data.canManage = true;
      }
    }

    return data;
  }

  /**
   * Update club settings.
   * Public fields apply immediately.
   * Protected (name, category, coreMembers) require approval UNLESS user is admin.
   * Admin changes are always immediate.
   */
  async updateSettings(clubId, updates, userContext) {
    const club = await Club.findById(clubId);
    if (!club) throw Object.assign(new Error('Club not found'), { statusCode: 404 });

    // Check if user is admin
    const isAdmin = userContext.role === 'admin';
    console.log('🔍 updateSettings Debug:', {
      userId: userContext.id,
      role: userContext.role,
      isAdmin: isAdmin,
      clubName: club.name,
      updates: updates
    });

    // Separate fields
    const publicFields    = ['description','vision','mission','socialLinks','bannerUrl'];
    const protectedFields = ['name','category','coreMembers'];

    const pub = {};
    const prot = {};

    // Split updates
    for (const key of Object.keys(updates)) {
      if (publicFields.includes(key)) pub[key] = updates[key];
      else if (protectedFields.includes(key)) prot[key] = updates[key];
    }

    // Apply public immediately
    if (Object.keys(pub).length) {
      Object.assign(club, pub);

      // Audit public update
      await auditService.log({
        user: userContext.id,
        action: 'CLUB_PUBLIC_UPDATE',
        target: `Club:${clubId}`,
        newValue: pub,
        ip: userContext.ip,
        userAgent: userContext.userAgent
      });
    }

    // Handle protected fields
    if (Object.keys(prot).length) {
      if (isAdmin) {
        // Admin: Apply protected changes immediately
        Object.assign(club, prot);
        
        // Clear any existing pending settings
        club.pendingSettings = undefined;
        
        // Keep status as active
        if (club.status === 'pending_approval') {
          club.status = 'active';
        }

        // Audit admin direct update
        await auditService.log({
          user: userContext.id,
          action: 'CLUB_ADMIN_UPDATE',
          target: `Club:${clubId}`,
          newValue: prot,
          ip: userContext.ip,
          userAgent: userContext.userAgent
        });
      } else {
        // President: Store protected under pendingSettings for approval
        club.pendingSettings = { ...club.pendingSettings, ...prot };
        // ✅ FIXED: Club status remains 'active', only pendingSettings waits for approval
        // club.status = 'pending_approval'; // ❌ REMOVED - Don't change club status!

        // Notify coordinator for approval
        await notificationService.create({
          user: club.coordinator,
          type: 'approval_required',
          payload: { clubId, clubName: club.name, pending: Object.keys(prot) },
          priority: 'HIGH'
        });

        // Audit protected request
        await auditService.log({
          user: userContext.id,
          action: 'CLUB_PROTECTED_UPDATE_REQUEST',
          target: `Club:${clubId}`,
          newValue: prot,
          ip: userContext.ip,
          userAgent: userContext.userAgent
        });
      }
    }

    await club.save();
    await this.flushCache();
    return club;
  }

  
  /**
   * Coordinator/Admin approves pendingSettings.
   */
  async approveSettings(clubId, userContext) {
    const club = await Club.findById(clubId);
    if (!club) throw Object.assign(new Error('Club not found'), { statusCode: 404 });
    if (!club.pendingSettings) {
      throw Object.assign(new Error('No pending changes'), { statusCode: 400 });
    }

    const old = {};
    for (const k of Object.keys(club.pendingSettings)) {
      old[k] = club[k];
      club[k] = club.pendingSettings[k];
    }
    club.pendingSettings = undefined;
    club.status = 'active';
    await club.save();

    // Notify president & members
    const members = await Membership.find({ club: clubId, status: 'approved' }).distinct('user');
    await notificationService.create({
      user: club.coordinator,
      type: 'approval_required', // or define 'settings_approved'
      payload: { clubId, approved: true },
      priority: 'MEDIUM'
    });

    // Audit approval
    await auditService.log({
      user: userContext.id,
      action: 'CLUB_PROTECTED_UPDATE_APPROVE',
      target: `Club:${clubId}`,
      oldValue: old,
      newValue: club.toObject(),
      ip: userContext.ip,
      userAgent: userContext.userAgent
    });

    await this.flushCache();
    return club;
  }

  /**
   * Coordinator/Admin rejects pendingSettings.
   */
  async rejectSettings(clubId, userContext) {
    const club = await Club.findById(clubId);
    if (!club) throw Object.assign(new Error('Club not found'), { statusCode: 404 });
    if (!club.pendingSettings) {
      throw Object.assign(new Error('No pending changes'), { statusCode: 400 });
    }

    const rejectedChanges = { ...club.pendingSettings };
    club.pendingSettings = undefined;
    await club.save();

    // Notify president
    const presidentMembership = await Membership.findOne({ 
      club: clubId, 
      role: 'president', 
      status: 'approved' 
    });
    
    if (presidentMembership) {
      await notificationService.create({
        user: presidentMembership.user,
        type: 'settings_rejected',
        payload: { clubId, clubName: club.name, rejectedChanges },
        priority: 'MEDIUM'
      });
    }

    // Audit rejection
    await auditService.log({
      user: userContext.id,
      action: 'CLUB_PROTECTED_UPDATE_REJECT',
      target: `Club:${clubId}`,
      oldValue: rejectedChanges,
      ip: userContext.ip,
      userAgent: userContext.userAgent
    });

    await this.flushCache();
    return club;
  }

  // DEPRECATED: Club approval no longer needed
  // Admin creates clubs directly as 'active' (no approval workflow)
  // Only settings changes require approval (see approveSettings above)
  async approveClub(clubId, action, userContext) {
    throw Object.assign(
      new Error('Club approval is deprecated. Clubs are created directly as active by admin.'), 
      { statusCode: 400 }
    );
  }

  // Archive (soft-delete) a club - Requires coordinator approval if requested by leadership
  async archiveClub(clubId, reason, userContext) {
    const club = await Club.findById(clubId).populate('coordinator', 'profile.name');
    if (!club) throw Object.assign(new Error('Club not found'), { statusCode: 404 });
    
    const { User } = require('../auth/user.model');
    const requester = await User.findById(userContext.id);
    const isAdmin = requester?.roles?.global === 'admin';
    
    const prevStatus = club.status;
    
    if (isAdmin) {
      // Admin can archive directly
      club.status = 'archived';
      
      await auditService.log({
        user: userContext.id,
        action: 'CLUB_ARCHIVE',
        target: `Club:${clubId}`,
        oldValue: { status: prevStatus },
        newValue: { status: 'archived' },
        ip: userContext.ip,
        userAgent: userContext.userAgent
      });
    } else {
      // Leadership requests archive - needs coordinator approval
      console.log(`🔄 [Archive] Setting club status to pending_archive. Current: ${club.status}`);
      club.status = 'pending_archive';
      club.archiveRequest = {
        requestedBy: userContext.id,
        requestedAt: new Date(),
        reason: reason || 'Leadership requested to archive this club'
      };
      console.log(`✅ [Archive] Status set to: ${club.status}, archiveRequest created`);
      
      // Notify coordinator
      await notificationService.create({
        user: club.coordinator._id,
        type: 'approval_required',
        payload: { 
          clubId: clubId,
          clubName: club.name,
          requestedBy: requester.profile?.name || 'Club Leadership',
          reason: reason
        },
        priority: 'HIGH'
      });
      
      await auditService.log({
        user: userContext.id,
        action: 'CLUB_ARCHIVE_REQUEST',
        target: `Club:${clubId}`,
        oldValue: { status: prevStatus },
        newValue: { status: 'pending_archive', reason },
        ip: userContext.ip,
        userAgent: userContext.userAgent
      });
    }
    
    console.log(`💾 [Archive] Saving club. Status before save: ${club.status}`);
    await club.save();
    console.log(`✅ [Archive] Club saved. Status after save: ${club.status}`);
    console.log(`🔍 [Archive] Returning club with status: ${club.status}, archiveRequest: ${!!club.archiveRequest}`);
    await this.flushCache();
    return club;
  }
  
  // Approve or reject archive request (Coordinator only)
  async approveArchiveRequest(clubId, decision, userContext) {
    const club = await Club.findById(clubId);
    if (!club) throw Object.assign(new Error('Club not found'), { statusCode: 404 });
    
    console.log(`🔍 [Approve Archive] Club: ${club.name}, Current Status: ${club.status}, Decision: ${decision}`);
    
    if (club.status !== 'pending_archive') {
      throw Object.assign(new Error('No pending archive request for this club'), { statusCode: 400 });
    }
    
    // Verify coordinator
    const isCoordinator = await this.isAssignedCoordinator(userContext.id, clubId);
    if (!isCoordinator) {
      throw Object.assign(new Error('Only assigned coordinator can approve archive requests'), { statusCode: 403 });
    }
    
    const prevStatus = club.status;
    
    if (decision === 'approve') {
      console.log(`✅ [Approve Archive] Approving - Setting status to 'archived'`);
      club.status = 'archived';
      
      // Notify requester
      await notificationService.create({
        user: club.archiveRequest.requestedBy,
        type: 'request_approved',
        payload: { 
          clubId: clubId,
          clubName: club.name,
          message: 'Your archive request has been approved by the coordinator'
        },
        priority: 'HIGH'
      });
    } else {
      // Rejected - restore to active
      console.log(`❌ [Approve Archive] Rejecting - Setting status to 'active'`);
      club.status = 'active';
      
      // Notify requester
      await notificationService.create({
        user: club.archiveRequest.requestedBy,
        type: 'request_rejected',
        payload: { 
          clubId: clubId,
          clubName: club.name,
          message: 'Your archive request has been rejected by the coordinator'
        },
        priority: 'HIGH'
      });
    }
    
    // Clear archive request
    club.archiveRequest = undefined;
    
    await auditService.log({
      user: userContext.id,
      action: decision === 'approve' ? 'CLUB_ARCHIVE_APPROVED' : 'CLUB_ARCHIVE_REJECTED',
      target: `Club:${clubId}`,
      oldValue: { status: prevStatus },
      newValue: { status: club.status },
      ip: userContext.ip,
      userAgent: userContext.userAgent
    });
    
    console.log(`💾 [Approve Archive] Saving club with status: ${club.status}`);
    await club.save();
    console.log(`✅ [Approve Archive] Saved! Final status: ${club.status}`);
    await this.flushCache();
    return club;
  }

  // Restore archived club
  async restoreClub(clubId, userContext) {
    const club = await Club.findById(clubId);
    if (!club) throw Object.assign(new Error('Club not found'), { statusCode: 404 });
    if (club.status !== 'archived') {
      throw Object.assign(new Error('Club is not archived'), { statusCode: 400 });
    }
    
    const prevStatus = club.status;
    club.status = 'active';
    await club.save();

    // Notify core team
    await notificationService.create({
      user: userContext.id,
      type: 'system_maintenance',
      payload: { clubId, message: 'Club has been restored' },
      priority: 'HIGH'
    });

    await auditService.log({
      user: userContext.id,
      action: 'CLUB_RESTORE',
      target: `Club:${clubId}`,
      oldValue: { status: prevStatus },
      newValue: { status: 'active' },
      ip: userContext.ip,
      userAgent: userContext.userAgent
    });

    await this.flushCache();
    return club;
  }

  // Get club members with pagination and filtering
  async getMembers(clubId, { page = 1, limit = 20, role, status }) {
    const query = { club: clubId };
    if (role) query.role = role;
    if (status) query.status = status;

    const skip = (page - 1) * limit;
    const [total, members] = await Promise.all([
      Membership.countDocuments(query),
      Membership.find(query)
        .populate('user', 'profile.name profile.email rollNumber')
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
    ]);

    return { total, page, limit, members };
  }

  // Helper: Check if a coordinator is assigned to a specific club
  async isAssignedCoordinator(coordinatorId, clubId) {
    const club = await Club.findById(clubId);
    if (!club) return false;
    return club.coordinator?.toString() === coordinatorId.toString();
  }

  // Add member to club
  async addMember(clubId, userId, role, userContext) {
    // Import User model to check global role
    const { User } = require('../auth/user.model');
    
    // Check user's global role - coordinators and admins cannot be club members
    const user = await User.findById(userId);
    if (!user) {
      const err = new Error('User not found');
      err.statusCode = 404;
      throw err;
    }
    
    if (user.roles?.global === 'coordinator' || user.roles?.global === 'admin') {
      const err = new Error(`${user.roles.global.charAt(0).toUpperCase() + user.roles.global.slice(1)}s cannot be added as club members. They already have system-level access.`);
      err.statusCode = 400;
      throw err;
    }
    
    // Check if user is already a member
    const existing = await Membership.findOne({ club: clubId, user: userId });
    if (existing) {
      const err = new Error('User is already a member');
      err.statusCode = 409;
      throw err;
    }

    // ✅ ENFORCE 3-CLUB LIMIT: Check if user already has 3 approved club memberships
    const approvedMembershipsCount = await Membership.countDocuments({
      user: userId,
      status: 'approved'
    });

    if (approvedMembershipsCount >= 3) {
      const err = new Error('This student is already a member of 3 clubs. Maximum club limit reached. Students cannot join more than 3 clubs.');
      err.statusCode = 400;
      throw err;
    }

    // ✅ ACCESS CONTROL: Check who is adding the member
    const adderMembership = await Membership.findOne({ club: clubId, user: userContext.id });
    // Get the adder's user object to check their global role
    const adder = await User.findById(userContext.id);
    const adderGlobalRole = adder?.roles?.global;
    
    const CORE_ROLES = ['core', 'secretary', 'treasurer', 'leadPR', 'leadTech'];
    const LEADERSHIP_ROLES = ['president', 'vicePresident'];
    const ELEVATED_ROLES = [...CORE_ROLES, ...LEADERSHIP_ROLES];
    
    // ✅ LEADERSHIP ROLES: Only assigned coordinator or admin can assign president/vicePresident
    if (LEADERSHIP_ROLES.includes(role)) {
      const isAdmin = adderGlobalRole === 'admin';
      const isAssignedCoordinator = adderGlobalRole === 'coordinator' && await this.isAssignedCoordinator(userContext.id, clubId);
      
      if (!isAdmin && !isAssignedCoordinator) {
        const err = new Error('Only Admin or Assigned Coordinator can assign Sr Club Head (President) or Jr Club Head (Vice President) roles.');
        err.statusCode = 403;
        throw err;
      }
    }
    
    // ✅ CORE ROLES: Only admin or club leadership can assign (NOT coordinator, NOT core members)
    if (CORE_ROLES.includes(role)) {
      const isAdmin = adderGlobalRole === 'admin';
      const isLeadership = adderMembership && LEADERSHIP_ROLES.includes(adderMembership.role);
      
      if (!isAdmin && !isLeadership) {
        const err = new Error('Only Admin or Club Leadership (President/Vice President) can assign core team roles. Core members can only add regular members.');
        err.statusCode = 403;
        throw err;
      }
    }
    
    // ✅ MEMBER ROLE: Admin, leadership, or core members can assign
    if (role === 'member') {
      const isAdmin = adderGlobalRole === 'admin';
      const isLeadership = adderMembership && LEADERSHIP_ROLES.includes(adderMembership.role);
      const isCoreTeam = adderMembership && CORE_ROLES.includes(adderMembership.role);
      
      if (!isAdmin && !isLeadership && !isCoreTeam) {
        const err = new Error('Only Admin, Club Leadership, or Core Team members can add regular members.');
        err.statusCode = 403;
        throw err;
      }
    }

    // ✅ ONE PRESIDENT PER CLUB: Check if president already exists
    if (role === 'president') {
      const existingPresident = await Membership.findOne({
        club: clubId,
        role: 'president',
        status: 'approved'
      });
      
      if (existingPresident) {
        const err = new Error('This club already has a Sr Club Head (President). There can only be one President per club.');
        err.statusCode = 400;
        throw err;
      }
    }
    
    // ✅ ONE VICE PRESIDENT PER CLUB: Check if vice president already exists
    if (role === 'vicePresident') {
      const existingVP = await Membership.findOne({
        club: clubId,
        role: 'vicePresident',
        status: 'approved'
      });
      
      if (existingVP) {
        const err = new Error('This club already has a Jr Club Head (Vice President). There can only be one Vice President per club.');
        err.statusCode = 400;
        throw err;
      }
    }
    
    // ✅ CROSS-CLUB RESTRICTION: If being added as president/VP or core, check they are not president/VP elsewhere
    if (ELEVATED_ROLES.includes(role)) {
      const otherLeadership = await Membership.findOne({
        user: userId,
        club: { $ne: clubId },
        role: { $in: LEADERSHIP_ROLES },
        status: 'approved'
      });
      
      if (otherLeadership) {
        const err = new Error('This user is already a President or Vice President in another club. They can only be added as a regular member in this club.');
        err.statusCode = 400;
        throw err;
      }
    }

    const membership = await Membership.create({
      club: clubId,
      user: userId,
      role,
      status: 'approved'
    });

    await auditService.log({
      user: userContext.id,
      action: 'MEMBER_ADD',
      target: `Club:${clubId}`,
      newValue: { userId, role },
      ip: userContext.ip,
      userAgent: userContext.userAgent
    });

    return membership;
  }

  // Update member role
  async updateMemberRole(clubId, memberId, role, userContext) {
    const membership = await Membership.findOne({ _id: memberId, club: clubId });

    if (!membership) {
      const err = new Error('Member not found');
      err.statusCode = 404;
      throw err;
    }

    // ✅ ACCESS CONTROL: Check who is updating the role
    const { User } = require('../auth/user.model');
    const updater = await User.findById(userContext.id);
    const updaterMembership = await Membership.findOne({ club: clubId, user: userContext.id });
    
    const CORE_ROLES = ['core', 'secretary', 'treasurer', 'leadPR', 'leadTech'];
    const LEADERSHIP_ROLES = ['president', 'vicePresident'];
    const ELEVATED_ROLES = [...CORE_ROLES, ...LEADERSHIP_ROLES];
    
    // ✅ LEADERSHIP PROTECTION: Only admin can change leadership members' roles
    if (LEADERSHIP_ROLES.includes(membership.role)) {
      if (updater.roles?.global !== 'admin') {
        const err = new Error('Only Admin can change the role of President or Vice President. Leadership cannot edit other leadership members\' roles.');
        err.statusCode = 403;
        throw err;
      }
    }
    
    // ✅ LEADERSHIP ROLES: Only assigned coordinator or admin can assign president/vicePresident
    if (LEADERSHIP_ROLES.includes(role)) {
      const isAdmin = updater.roles?.global === 'admin';
      const isAssignedCoordinator = updater.roles?.global === 'coordinator' && await this.isAssignedCoordinator(userContext.id, clubId);
      
      if (!isAdmin && !isAssignedCoordinator) {
        const err = new Error('Only Admin or Assigned Coordinator can assign Sr Club Head (President) or Jr Club Head (Vice President) roles.');
        err.statusCode = 403;
        throw err;
      }
    }
    
    // ✅ CORE ROLES: Only admin or club leadership can assign (NOT coordinator, NOT core members)
    if (CORE_ROLES.includes(role)) {
      const isAdmin = updater.roles?.global === 'admin';
      const isLeadership = updaterMembership && LEADERSHIP_ROLES.includes(updaterMembership.role);
      
      if (!isAdmin && !isLeadership) {
        const err = new Error('Only Admin or Club Leadership (President/Vice President) can assign core team roles. Core members can only change to member role.');
        err.statusCode = 403;
        throw err;
      }
    }
    
    // ✅ MEMBER ROLE: Admin, leadership, or core members can assign
    if (role === 'member') {
      const isAdmin = updater.roles?.global === 'admin';
      const isLeadership = updaterMembership && LEADERSHIP_ROLES.includes(updaterMembership.role);
      const isCoreTeam = updaterMembership && CORE_ROLES.includes(updaterMembership.role);
      
      if (!isAdmin && !isLeadership && !isCoreTeam) {
        const err = new Error('Only Admin, Club Leadership, or Core Team members can change to member role.');
        err.statusCode = 403;
        throw err;
      }
    }

    // ✅ ONE PRESIDENT PER CLUB: Check if president already exists (excluding current member)
    if (role === 'president') {
      const existingPresident = await Membership.findOne({
        club: clubId,
        role: 'president',
        status: 'approved',
        _id: { $ne: memberId } // Exclude the member being updated
      });
      
      if (existingPresident) {
        const err = new Error('This club already has a Sr Club Head (President). There can only be one President per club.');
        err.statusCode = 400;
        throw err;
      }
    }
    
    // ✅ ONE VICE PRESIDENT PER CLUB: Check if vice president already exists (excluding current member)
    if (role === 'vicePresident') {
      const existingVP = await Membership.findOne({
        club: clubId,
        role: 'vicePresident',
        status: 'approved',
        _id: { $ne: memberId } // Exclude the member being updated
      });
      
      if (existingVP) {
        const err = new Error('This club already has a Jr Club Head (Vice President). There can only be one Vice President per club.');
        err.statusCode = 400;
        throw err;
      }
    }
    
    // ✅ CROSS-CLUB RESTRICTION: If promoting to president/VP or core, check they are not president/VP elsewhere
    if (ELEVATED_ROLES.includes(role)) {
      const otherLeadership = await Membership.findOne({
        user: membership.user,
        club: { $ne: clubId },
        role: { $in: LEADERSHIP_ROLES },
        status: 'approved'
      });
      
      if (otherLeadership) {
        const err = new Error('This user is already a President or Vice President in another club. They can only be a regular member in this club.');
        err.statusCode = 400;
        throw err;
      }
    }

    membership.role = role;
    await membership.save();

    await auditService.log({
      user: userContext.id,
      action: 'MEMBER_ROLE_UPDATE',
      target: `Membership:${memberId}`,
      newValue: { role },
      ip: userContext.ip,
      userAgent: userContext.userAgent
    });

    return membership;
  }

  // Remove member from club
  async removeMember(clubId, memberId, userContext) {
    const membership = await Membership.findOne({ _id: memberId, club: clubId });

    if (!membership) {
      const err = new Error('Member not found');
      err.statusCode = 404;
      throw err;
    }

    // ✅ SELF-REMOVAL PREVENTION: President/Vice President cannot remove themselves
    const LEADERSHIP_ROLES = ['president', 'vicePresident'];
    const { User } = require('../auth/user.model');
    const remover = await User.findById(userContext.id);
    
    // Check if trying to remove self
    const isSelfRemoval = membership.user.toString() === userContext.id.toString();
    
    if (isSelfRemoval && LEADERSHIP_ROLES.includes(membership.role)) {
      // Only admin can remove president/vice president (even themselves)
      if (remover.roles?.global !== 'admin') {
        const err = new Error('President and Vice President cannot remove themselves from the club. Only Admin can remove leadership roles.');
        err.statusCode = 403;
        throw err;
      }
    }

    const removerMembership = await Membership.findOne({ club: clubId, user: userContext.id });
    const CORE_ROLES = ['core', 'secretary', 'treasurer', 'leadPR', 'leadTech'];
    
    // ✅ LEADERSHIP MEMBERS: Only admin or assigned coordinator can remove
    if (LEADERSHIP_ROLES.includes(membership.role)) {
      const isAdmin = remover.roles?.global === 'admin';
      const isAssignedCoordinator = remover.roles?.global === 'coordinator' && await this.isAssignedCoordinator(userContext.id, clubId);
      
      if (!isAdmin && !isAssignedCoordinator) {
        const err = new Error('Only Admin or Assigned Coordinator can remove President or Vice President. Leadership cannot remove other leadership members.');
        err.statusCode = 403;
        throw err;
      }
    }

    // ✅ CORE & MEMBER ROLES: Only admin or club leadership can remove (NOT coordinator)
    if (CORE_ROLES.includes(membership.role) || membership.role === 'member') {
      const isAdmin = remover.roles?.global === 'admin';
      const isLeadership = removerMembership && LEADERSHIP_ROLES.includes(removerMembership.role);
      
      if (!isAdmin && !isLeadership) {
        const err = new Error('Only Admin or Club Leadership (President/Vice President) can remove core team and regular members. Coordinator can only remove Sr/Jr Club Head.');
        err.statusCode = 403;
        throw err;
      }
    }

    await Membership.findByIdAndDelete(memberId);

    await auditService.log({
      user: userContext.id,
      action: 'MEMBER_REMOVE',
      target: `Membership:${memberId}`,
      oldValue: { userId: membership.user, role: membership.role },
      ip: userContext.ip,
      userAgent: userContext.userAgent
    });
  }

  // Get club analytics
  async getAnalytics(clubId, { period = 'month', startDate, endDate }) {
    const now = new Date();
    let start, end;

    if (startDate && endDate) {
      start = new Date(startDate);
      end = new Date(endDate);
    } else {
      switch (period) {
        case 'week':
          start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          end = now;
          break;
        case 'month':
          start = new Date(now.getFullYear(), now.getMonth(), 1);
          end = now;
          break;
        case 'quarter':
          start = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
          end = now;
          break;
        case 'year':
          start = new Date(now.getFullYear(), 0, 1);
          end = now;
          break;
      }
    }

    const [
      totalMembers,
      memberGrowth,
      eventCount,
      budgetUsed,
      recruitmentStats
    ] = await Promise.all([
      Membership.countDocuments({ club: clubId, status: 'approved' }),
      Membership.countDocuments({ 
        club: clubId, 
        status: 'approved',
        createdAt: { $gte: start, $lte: end }
      }),
      mongoose.model('Event').countDocuments({ 
        club: clubId,
        dateTime: { $gte: start, $lte: end }
      }),
      mongoose.model('BudgetRequest').aggregate([
        { $match: { 
          event: { $in: await mongoose.model('Event').find({ club: clubId }).distinct('_id') },
          status: 'settled',
          createdAt: { $gte: start, $lte: end }
        }},
        { $group: { _id: null, total: { $sum: '$amount' } }}
      ]),
      mongoose.model('Recruitment').aggregate([
        { $match: { club: clubId, createdAt: { $gte: start, $lte: end } }},
        { $group: { _id: '$status', count: { $sum: 1 } }}
      ])
    ]);

    return {
      totalMembers,
      memberGrowth,
      eventCount,
      budgetUsed: budgetUsed[0]?.total || 0,
      recruitmentStats: recruitmentStats.reduce((acc, stat) => {
        acc[stat._id] = stat.count;
        return acc;
      }, {})
    };
  }

  // Upload club banner
  async uploadBanner(clubId, bannerFile, userContext) {
    if (!bannerFile) {
      const err = new Error('No banner file provided');
      err.statusCode = 400;
      throw err;
    }

    const res = await cloudinary.uploader.upload(bannerFile.path, {
      folder: `clubs/${clubId}/banner`,
      width: 1200,
      height: 400,
      crop: 'limit'
    });

    const club = await Club.findByIdAndUpdate(
      clubId,
      { bannerUrl: res.secure_url },
      { new: true }
    );

    if (!club) {
      const err = new Error('Club not found');
      err.statusCode = 404;
      throw err;
    }

    await auditService.log({
      user: userContext.id,
      action: 'CLUB_BANNER_UPLOAD',
      target: `Club:${clubId}`,
      newValue: { bannerUrl: res.secure_url },
      ip: userContext.ip,
      userAgent: userContext.userAgent
    });

    await this.flushCache();
    return club;
  }

  /**
   * Get public stats for homepage
   */
  async getPublicStats() {
    try {
      const { User } = require('../auth/user.model');
      const { Event } = require('../event/event.model');
      
      console.log('📊 Fetching public stats...');
      
      // Get active clubs count
      const activeClubs = await Club.countDocuments({ status: 'active' });
      console.log('✅ Active clubs:', activeClubs);
      
      // Get total ALL users count (regardless of role)
      const allUsers = await User.countDocuments({});
      console.log('✅ All users in DB:', allUsers);
      
      // Get total unique students (all users with student role)
      const totalStudents = await User.countDocuments({ 'roles.global': 'student' });
      console.log('✅ Total students with student role:', totalStudents);
      
      // Alternative: Count unique students from approved memberships
      const uniqueStudentsFromMemberships = await Membership.distinct('user', { status: 'approved' });
      console.log('✅ Unique students from memberships:', uniqueStudentsFromMemberships.length);
      
      // Get total events count
      const totalEvents = await Event.countDocuments();
      console.log('✅ Total events:', totalEvents);
      
      // Use the higher count between direct user count and membership count
      const finalStudentCount = Math.max(totalStudents, uniqueStudentsFromMemberships.length);
      
      const stats = {
        activeClubs,
        students: finalStudentCount,
        events: totalEvents
      };
      
      console.log('📊 Final stats:', stats);
      return stats;
    } catch (error) {
      console.error('❌ Error in getPublicStats:', error);
      console.error('❌ Stack trace:', error.stack);
      throw error;
    }
  }
}

module.exports = new ClubService();