// src/modules/event/event.service.js
const { Event }         = require('./event.model');
const { Attendance }    = require('./attendance.model');
const { BudgetRequest } = require('./budgetRequest.model');
const cloudinary        = require('../../utils/cloudinary');
const { generateEventQR } = require('../../utils/qrcode');
const auditService      = require('../audit/audit.service');
const notificationSvc   = require('../notification/notification.service');
const { Membership }    = require('../club/membership.model');

class EventService {
  /**
   * Create a new event (draft).
   */
  async create(data, files, userContext) {
    const evt = new Event(data);

    // Parse participatingClubs if sent as string from FormData
    if (data.participatingClubs) {
      evt.participatingClubs = typeof data.participatingClubs === 'string' 
        ? JSON.parse(data.participatingClubs) 
        : data.participatingClubs;
    }

    // Handle attachments
    if (files.proposal) {
      const r = await cloudinary.uploadFile(files.proposal[0].path, { folder: 'events/proposals' });
      evt.attachments.proposalUrl = r.secure_url;
    }
    if (files.budgetBreakdown) {
      const r = await cloudinary.uploadFile(files.budgetBreakdown[0].path, { folder: 'events/budgets' });
      evt.attachments.budgetBreakdownUrl = r.secure_url;
    }
    if (files.venuePermission) {
      const r = await cloudinary.uploadFile(files.venuePermission[0].path, { folder: 'events/permissions' });
      evt.attachments.venuePermissionUrl = r.secure_url;
    }

    await evt.save();

    // ✅ Auto-create attendance records for ALL club members (primary + participating clubs)
    // IMPORTANT: Includes ALL approved members regardless of role (member, core, vicePresident, president)
    // This ensures regular members have participation data for promotion evaluations
    const allClubIds = [evt.club, ...(evt.participatingClubs || [])];
    
    // Get all approved members from all involved clubs (NO role filter - includes everyone!)
    const clubMembers = await Membership.find({
      club: { $in: allClubIds },
      status: 'approved'  // Only status check, NO role filtering
    }).lean();
    
    // Create attendance records for all club members
    const attendanceRecords = clubMembers.map(member => ({
      event: evt._id,
      user: member.user,
      club: member.club,
      status: 'absent', // Default status
      type: 'organizer' // All club members are considered organizers/helpers
    }));
    
    if (attendanceRecords.length > 0) {
      await Attendance.insertMany(attendanceRecords, { ordered: false }).catch(err => {
        // Ignore duplicate key errors (in case records already exist)
        if (err.code !== 11000) throw err;
      });
    }

    // Audit log
    await auditService.log({
      user: userContext.id,
      action: 'EVENT_CREATE',
      target: `Event:${evt._id}`,
      newValue: evt.toObject(),
      ip: userContext.ip,
      userAgent: userContext.userAgent
    });

    // Notification will be sent when event is SUBMITTED (changeStatus 'submit')
    // Not when created (status is 'draft')

    return evt;
  }

  /**
   * List events with pagination and filters.
   * Permission-based filtering:
   * - draft/pending_coordinator/pending_admin: Only visible to creator, assigned coordinator, or admin
   * - published/ongoing/completed: Visible to everyone
   */
  async list({ club, status, page = 1, limit = 20, upcoming, past }, userContext = null) {
    const query = {};
    if (club)   query.club   = club;

    // ✅ Permission-based status filtering
    const restrictedStatuses = ['draft', 'pending_coordinator', 'pending_admin'];
    const publicStatuses = ['published', 'ongoing', 'completed', 'archived'];
    
    if (status) {
      if (restrictedStatuses.includes(status)) {
        // Restricted statuses - only visible to authorized users
        if (!userContext) {
          // Not authenticated - can't see restricted events
          query.status = { $in: [] }; // Return no results
        } else {
          const isAdmin = userContext.roles?.global === 'admin';
          
          if (isAdmin) {
            // Admin can see all restricted events
            query.status = status;
          } else {
            // For non-admins, filter by events from their clubs
            const { Club } = require('../club/club.model');
            const { Membership } = require('../club/membership.model');
            
            // Get clubs where user is coordinator or member
            const [coordinatorClubs, memberClubs] = await Promise.all([
              Club.find({ coordinator: userContext.id }).select('_id'),
              Membership.find({ user: userContext.id, status: 'approved' }).select('club')
            ]);
            
            const clubIds = [
              ...coordinatorClubs.map(c => c._id),
              ...memberClubs.map(m => m.club)
            ];
            
            // Only show events from user's clubs with the requested status
            query.status = status;
            query.club = { $in: clubIds };
          }
        }
      } else {
        // Public statuses (published, ongoing, completed) - visible to all
        query.status = status;
      }
    } else {
      // ✅ No status specified
      // If querying specific club AND user is authenticated, check if user is member
      if (club && userContext) {
        const { Membership } = require('../club/membership.model');
        const isMember = await Membership.exists({
          club: club,
          user: userContext.id,
          status: 'approved'
        });
        
        const isCoordinator = userContext.roles?.global === 'coordinator';
        const isAdmin = userContext.roles?.global === 'admin';
        
        // If user is member/coordinator/admin of this club, show ALL events
        if (isMember || isCoordinator || isAdmin) {
          // Don't filter by status - show all events from this club
        } else {
          // Not a member - only show public events
          query.status = { $in: publicStatuses };
        }
      } else {
        // No club specified or not authenticated - only show public events
        query.status = { $in: publicStatuses };
      }
    }

    // ✅ Filter by date for upcoming/past events
    const now = new Date();
    if (upcoming === 'true' || upcoming === true) {
      query.dateTime = { $gte: now }; // Future events only
    } else if (past === 'true' || past === true) {
      query.dateTime = { $lt: now }; // Past events only
    }

    const skip = (page - 1) * limit;
    
    // ✅ Smart sorting based on status/filter
    let sortOrder = { dateTime: -1 }; // Default: newest first
    if (status === 'published' || upcoming) {
      sortOrder = { dateTime: 1 }; // Upcoming: soonest first
    } else if (status === 'completed') {
      sortOrder = { dateTime: -1 }; // Completed: most recent first
    }

    const [total, events] = await Promise.all([
      Event.countDocuments(query),
      Event.find(query)
        .populate('club', 'name logo category') // Populate club details
        .populate('participatingClubs', 'name logo category') // Populate participating clubs
        .skip(skip)
        .limit(limit)
        .sort(sortOrder)
    ]);
    return { total, page, limit, events };
  }

  /**
   * Get event details with permission flags.
   */
  async getById(id, userContext) {
    const evt = await Event.findById(id)
      .populate('club', 'name logo category coordinator')
      .populate('participatingClubs', 'name logo category');
    if (!evt) {
      const err = new Error('Event not found');
      err.statusCode = 404;
      throw err;
    }
    
    const data = evt.toObject();
    
    // Add canManage flag (BACKEND is SOURCE OF TRUTH)
    if (userContext && userContext.id) {
      const isAdmin = userContext.roles?.global === 'admin';
      const isCoordinator = userContext.roles?.global === 'coordinator' && 
        evt.club.coordinator && 
        evt.club.coordinator.toString() === userContext.id;
      
      // FIX: Check membership in PRIMARY club OR ANY PARTICIPATING club
      const { Membership } = require('../club/membership.model');
      const allClubIds = [evt.club._id, ...(evt.participatingClubs || []).map(c => c._id || c)];
      
      const memberships = await Membership.find({
        user: userContext.id,
        club: { $in: allClubIds },  // Check ALL involved clubs!
        status: 'approved'
      });
      
      const coreRoles = ['president', 'core', 'vicePresident', 'secretary', 'treasurer', 'leadPR', 'leadTech'];
      const hasClubRole = memberships.some(m => coreRoles.includes(m.role));
      
      console.log(`✅ canManage check for user ${userContext.id}:`, {
        isAdmin,
        isCoordinator,
        hasClubRole,
        userMemberships: memberships.map(m => ({ club: m.club.toString(), role: m.role })),
        allClubIds: allClubIds.map(id => id.toString())
      });
      
      data.canManage = isAdmin || isCoordinator || hasClubRole;
    } else {
      data.canManage = false;
    }
    
    // Check if user has already registered for this event
    if (userContext && userContext.id) {
      const { EventRegistration } = require('./eventRegistration.model');
      const existingRegistration = await EventRegistration.findOne({
        event: id,
        user: userContext.id
      });
      data.hasRegistered = !!existingRegistration;
      data.myRegistration = existingRegistration || null;
    } else {
      data.hasRegistered = false;
      data.myRegistration = null;
    }
    
    // ✅ Add dynamic photo count from Document collection
    const { Document } = require('../document/document.model');
    const photoCount = await Document.countDocuments({
      event: id,
      type: 'photo'
    });
    data.photos = data.photos || [];
    data.photoCount = photoCount; // Add actual count for display
    
    // ✅ Add registration counts for event management
    const { EventRegistration } = require('./eventRegistration.model');
    
    // Total registrations from ALL clubs
    const registrationCount = await EventRegistration.countDocuments({ event: id });
    data.registrationCount = registrationCount;
    
    // ✅ Pending registrations - only count for clubs where user has management role
    if (userContext && userContext.id) {
      // Redefine allClubIds for this scope (primary club + participating clubs)
      const allClubIds = [data.club._id, ...(data.participatingClubs || []).map(c => c._id || c)];
      
      // Get user's managed clubs (clubs where user has core/leadership role)
      const { Membership } = require('../club/membership.model');
      const userMemberships = await Membership.find({
        user: userContext.id,
        club: { $in: allClubIds },
        status: 'approved'
      });
      
      const coreRoles = ['president', 'core', 'vicePresident', 'secretary', 'treasurer', 'leadPR', 'leadTech'];
      const userManagedClubIds = userMemberships
        .filter(m => coreRoles.includes(m.role))
        .map(m => m.club);
      
      // Count pending registrations only for user's managed clubs
      const pendingRegistrations = await EventRegistration.countDocuments({ 
        event: id, 
        status: 'pending',
        representingClub: { $in: userManagedClubIds }  // Only count for user's clubs
      });
      data.pendingRegistrations = pendingRegistrations;
    } else {
      // For non-authenticated users, show 0
      data.pendingRegistrations = 0;
    }
    
    // ✅ RSVP count = approved audience + approved performers
    const rsvpCount = await EventRegistration.countDocuments({
      event: id,
      status: 'approved'
    });
    data.rsvpCount = rsvpCount;
    
    return data;
  }

  /**
   * Change event status: submit, approve, publish, start, complete.
   */
  async changeStatus(id, action, userContext) {
    const evt = await Event.findById(id).populate('club', 'name coordinator');
    if (!evt) {
      const err = new Error('Event not found');
      err.statusCode = 404;
      throw err;
    }

    const prevStatus = evt.status;
    if (action === 'submit' && prevStatus === 'draft') {
      // Check if budget requires admin approval
      const requiresAdminApproval = evt.budget > 5000 || 
                                     (evt.guestSpeakers && evt.guestSpeakers.length > 0);
      
      evt.status = 'pending_coordinator';
      evt.requiresAdminApproval = requiresAdminApproval;
      
      await notificationSvc.create({
        user: evt.club.coordinator,
        type: 'approval_required',
        payload: { eventId: id, title: evt.title, budget: evt.budget },
        priority: 'HIGH'
      });

    } else if (action === 'approve' && prevStatus === 'pending_coordinator') {
      // Check if admin approval is required
      const requiresAdminApproval = evt.budget > 5000 || 
                                     (evt.guestSpeakers && evt.guestSpeakers.length > 0);
      
      if (requiresAdminApproval) {
        // Route to admin for approval
        evt.status = 'pending_admin';
        
        // Notify admin
        const { User } = require('../auth/user.model');
        const admins = await User.find({ 'roles.global': 'admin' }).select('_id');
        
        await Promise.all(admins.map(admin =>
          notificationSvc.create({
            user: admin._id,
            type: 'approval_required',
            payload: { 
              eventId: id, 
              title: evt.title, 
              budget: evt.budget,
              reason: evt.budget > 5000 ? 'Budget exceeds ₹5000' : 'External guest speakers'
            },
            priority: 'HIGH'
          })
        ));
      } else {
        // Auto-publish if no admin approval needed
        evt.status = 'published';
        
        // Notify all members
        const members = await Membership.find({ club: evt.club._id, status: 'approved' })
          .distinct('user');
        await Promise.all(members.map(u =>
          notificationSvc.create({
            user: u,
            type: 'event_reminder',
            payload: { eventId: id, dateTime: evt.dateTime },
            priority: 'MEDIUM'
          })
        ));
      }

    } else if (action === 'approve' && prevStatus === 'pending_admin') {
      // ✅ Admin approval for high-budget or special events
      evt.status = 'published';

      // Notify all members
      const members = await Membership.find({ club: evt.club._id, status: 'approved' })
        .distinct('user');
      await Promise.all(members.map(u =>
        notificationSvc.create({
          user: u,
          type: 'event_reminder',
          payload: { eventId: id, dateTime: evt.dateTime },
          priority: 'MEDIUM'
        })
      ));

    } else if (action === 'publish' && prevStatus === 'approved') {
      evt.status = 'published';
      await notificationSvc.create({
        user: evt.coordinator,
        type: 'event_reminder',
        payload: { eventId: id, dateTime: evt.dateTime },
        priority: 'MEDIUM'
      });

    } else if (action === 'start') {
      evt.status = 'ongoing';
      
      // Generate QR code for attendance when event starts
      try {
        const qrData = await generateEventQR(id, evt.title);
        evt.qrCodeUrl = qrData.url;
        evt.attendanceUrl = qrData.attendanceUrl;
      } catch (error) {
        console.error('Failed to generate QR code for event:', error);
        // Don't fail the event start if QR generation fails
      }

    } else if (action === 'complete') {
      evt.status = 'completed';
      // Set report due date to 7 days from completion
      evt.reportDueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    } else if (action === 'reject') {
      // ✅ Reject event (Coordinator or Admin can reject)
      // Can reject from pending_coordinator or pending_admin status
      if (!['pending_coordinator', 'pending_admin'].includes(prevStatus)) {
        const err = new Error('Can only reject events pending approval');
        err.statusCode = 400;
        throw err;
      }
      
      evt.status = 'draft'; // Send back to draft
      evt.rejectionReason = statusData.reason;
      evt.rejectedBy = userContext.id;
      evt.rejectedAt = new Date();
      
      // Notify club president about rejection
      const president = await Membership.findOne({
        club: evt.club._id,
        role: 'president',
        status: 'approved'
      });
      
      if (president) {
        await notificationSvc.create({
          user: president.user,
          type: 'event_rejected',
          payload: { 
            eventId: id, 
            title: evt.title,
            reason: statusData.reason
          },
          priority: 'HIGH'
        });
      }

    } else {
      const err = new Error('Invalid action/state');
      err.statusCode = 400;
      throw err;
    }

    await evt.save();

    // Audit log
    await auditService.log({
      user: userContext.id,
      action: `EVENT_${action.toUpperCase()}`,
      target: `Event:${id}`,
      oldValue: { status: prevStatus },
      newValue: { status: evt.status },
      ip: userContext.ip,
      userAgent: userContext.userAgent
    });

    return evt;
  }

  /**
   * RSVP for an event.
   */
  async rsvp(eventId, userContext) {
    const evt = await Event.findById(eventId);
    if (!evt || !['approved','published','ongoing'].includes(evt.status)) {
      const err = new Error('Not open for RSVP');
      err.statusCode = 400;
      throw err;
    }

    if (!evt.isPublic) {
      const isMember = await Membership.exists({
        club: evt.club,
        user: userContext.id,
        status: 'approved'
      });
      if (!isMember) {
        const err = new Error('Forbidden');
        err.statusCode = 403;
        throw err;
      }
    }

    await Attendance.findOneAndUpdate(
      { event: eventId, user: userContext.id },
      { status: 'rsvp', timestamp: new Date() },
      { upsert: true }
    );

    // Audit log
    await auditService.log({
      user: userContext.id,
      action: 'EVENT_RSVP',
      target: `Event:${eventId}`,
      ip: userContext.ip,
      userAgent: userContext.userAgent
    });

    return;
  }

  /**
   * Mark attendance for an event.
   */
  async markAttendance(eventId, { userId }, userContext) {
    await Attendance.findOneAndUpdate(
      { event: eventId, user: userId },
      { status: 'present', timestamp: new Date() },
      { upsert: true }
    );

    // Audit log
    await auditService.log({
      user: userContext.id,
      action: 'EVENT_MARK_ATTENDANCE',
      target: `Event:${eventId}`,
      newValue: { userId },
      ip: userContext.ip,
      userAgent: userContext.userAgent
    });

    return;
  }

  /**
   * Create a budget request.
   */
  async createBudget(eventId, data, userContext) {
    const br = await BudgetRequest.create({ event: eventId, ...data });

    // Audit log
    await auditService.log({
      user: userContext.id,
      action: 'BUDGET_REQUEST',
      target: `Event:${eventId}`,
      newValue: br.toObject(),
      ip: userContext.ip,
      userAgent: userContext.userAgent
    });

    // Notify coordinator
    const evt = await Event.findById(eventId);
    await notificationSvc.create({
      user: evt.coordinator,
      type: 'approval_required',
      payload: { budgetRequestId: br._id, amount: br.amount },
      priority: 'HIGH'
    });

    return br;
  }

  /**
   * List budget requests.
   */
  async listBudgets(eventId) {
    return BudgetRequest.find({ event: eventId }).sort({ createdAt: -1 });
  }

  /**
   * Settle a budget.
   */
  async settleBudget(eventId, data, userContext) {
    const br = await BudgetRequest.findOne({ event: eventId, status: 'approved' });
    if (!br) {
      const err = new Error('No approved budget');
      err.statusCode = 400;
      throw err;
    }
    br.status = 'settled';
    br.settledAt = new Date();
    br.summaryUrl = data.reportUrl;
    br.unusedFunds = data.unusedFunds || 0;
    await br.save();

    // Audit log
    await auditService.log({
      user: userContext.id,
      action: 'BUDGET_SETTLE',
      target: `BudgetRequest:${br._id}`,
      newValue: { status: 'settled' },
      ip: userContext.ip,
      userAgent: userContext.userAgent
    });

    // Notify finance/coordinator
    await notificationSvc.create({
      user: br.eventCoordinatorId, // set from controller
      type: 'system_maintenance', // or new type 'budget_settled'
      payload: { budgetRequestId: br._id },
      priority: 'MEDIUM'
    });

    return br;
  }

  /**
   * Get attendance analytics for an event
   */
  async getAttendanceAnalytics(eventId) {
    const event = await Event.findById(eventId);
    if (!event) {
      const err = new Error('Event not found');
      err.statusCode = 404;
      throw err;
    }

    const [
      totalRSVPs,
      totalAttendance,
      attendanceByHour,
      attendanceStats
    ] = await Promise.all([
      Attendance.countDocuments({ event: eventId, status: 'rsvp' }),
      Attendance.countDocuments({ event: eventId, status: 'present' }),
      
      // Attendance by hour (for ongoing/completed events)
      Attendance.aggregate([
        { $match: { event: new mongoose.Types.ObjectId(eventId), status: 'present' } },
        {
          $group: {
            _id: { $hour: '$timestamp' },
            count: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ]),
      
      // General attendance statistics
      Attendance.aggregate([
        { $match: { event: new mongoose.Types.ObjectId(eventId) } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ])
    ]);

    const attendanceRate = totalRSVPs > 0 ? (totalAttendance / totalRSVPs) * 100 : 0;

    return {
      totalRSVPs,
      totalAttendance,
      attendanceRate: Math.round(attendanceRate * 100) / 100,
      attendanceByHour,
      statusBreakdown: attendanceStats.reduce((acc, stat) => {
        acc[stat._id] = stat.count;
        return acc;
      }, {}),
      eventCapacity: event.capacity,
      capacityUtilization: event.capacity > 0 ? (totalAttendance / event.capacity) * 100 : null
    };
  }

  /**
   * Get event analytics dashboard
   */
  async getEventAnalytics(eventId, period = 'month') {
    const event = await Event.findById(eventId);
    if (!event) {
      const err = new Error('Event not found');
      err.statusCode = 404;
      throw err;
    }

    const attendanceAnalytics = await this.getAttendanceAnalytics(eventId);
    
    return {
      event: {
        id: event._id,
        title: event.title,
        dateTime: event.dateTime,
        status: event.status,
        venue: event.venue,
        capacity: event.capacity
      },
      attendance: attendanceAnalytics,
      summary: {
        totalBudget: event.budget,
        expectedAttendees: event.expectedAttendees,
        actualAttendees: attendanceAnalytics.totalAttendance,
        attendanceAccuracy: event.expectedAttendees > 0 
          ? (attendanceAnalytics.totalAttendance / event.expectedAttendees) * 100 
          : null
      }
    };
  }

  /**
   * Generate attendance report
   */
  async generateAttendanceReport(eventId, format = 'json') {
    const event = await Event.findById(eventId);
    if (!event) {
      const err = new Error('Event not found');
      err.statusCode = 404;
      throw err;
    }

    const attendees = await Attendance.find({ event: eventId })
      .populate('user', 'profile.name rollNumber email')
      .sort({ timestamp: -1 });

    const analytics = await this.getAttendanceAnalytics(eventId);

    const report = {
      event: {
        id: event._id,
        title: event.title,
        dateTime: event.dateTime,
        venue: event.venue,
        status: event.status
      },
      summary: analytics,
      attendees: attendees.map(att => ({
        name: att.user.profile.name,
        rollNumber: att.user.rollNumber,
        email: att.user.email,
        status: att.status,
        timestamp: att.timestamp
      })),
      generatedAt: new Date(),
      format
    };

    return report;
  }

  /**
   * Coordinator Financial Override
   * Allows coordinator to reject/reduce event budget with reason
   */
  async coordinatorOverrideBudget(eventId, overrideData, userContext) {
    const evt = await Event.findById(eventId).populate('club', 'name coordinator');
    if (!evt) {
      const err = new Error('Event not found');
      err.statusCode = 404;
      throw err;
    }

    const { action, reason, adjustedBudget } = overrideData;
    
    // Validate action
    if (!['budget_rejection', 'budget_reduction', 'event_cancellation'].includes(action)) {
      const err = new Error('Invalid override action');
      err.statusCode = 400;
      throw err;
    }

    // Store original budget
    const originalBudget = evt.budget;

    // Apply override
    evt.coordinatorOverride = {
      overridden: true,
      type: action,
      reason: reason,
      originalBudget: originalBudget,
      adjustedBudget: action === 'budget_reduction' ? adjustedBudget : 0,
      overriddenBy: userContext.id,
      overriddenAt: new Date()
    };

    // Update event based on action
    if (action === 'budget_rejection') {
      evt.budget = 0;
      evt.status = 'archived'; // Reject the event
    } else if (action === 'budget_reduction') {
      if (!adjustedBudget || adjustedBudget >= originalBudget) {
        const err = new Error('Adjusted budget must be less than original');
        err.statusCode = 400;
        throw err;
      }
      evt.budget = adjustedBudget;
    } else if (action === 'event_cancellation') {
      evt.status = 'archived';
      evt.budget = 0;
    }

    await evt.save();

    // Audit log
    await auditService.log({
      user: userContext.id,
      action: 'COORDINATOR_FINANCIAL_OVERRIDE',
      target: `Event:${eventId}`,
      oldValue: { budget: originalBudget, status: evt.status },
      newValue: { 
        budget: evt.budget, 
        status: evt.status,
        override: evt.coordinatorOverride 
      },
      ip: userContext.ip,
      userAgent: userContext.userAgent,
      severity: 'HIGH' // High severity for override actions
    });

    // Get club president for notification
    const president = await Membership.findOne({ 
      club: evt.club._id, 
      role: 'president',
      status: 'approved' 
    }).select('user');

    if (president) {
      await notificationSvc.create({
        user: president.user,
        type: 'coordinator_override',
        payload: { 
          eventId: evt._id,
          eventTitle: evt.title,
          action: action,
          reason: reason,
          originalBudget: originalBudget,
          adjustedBudget: evt.budget,
          coordinatorName: userContext.name || 'Coordinator'
        },
        priority: 'HIGH'
      });
    }

    return evt;
  }
  /**
   * Update an existing event (only draft events can be edited)
   * @param {string} eventId - Event ID
   * @param {object} data - Updated event data
   * @param {object} files - Optional new file attachments
   * @param {object} userContext - User context for audit log
   * @returns {object} Updated event
   */
  async update(eventId, data, files, userContext) {
    console.log('🔧 Backend UPDATE - Received data:', Object.keys(data));
    console.log('🔧 Backend UPDATE - participatingClubs field:', data.participatingClubs);
    console.log('🔧 Backend UPDATE - Type of participatingClubs:', typeof data.participatingClubs);
    
    const event = await Event.findById(eventId).populate('club');
    if (!event) {
      const err = new Error('Event not found');
      err.statusCode = 404;
      throw err;
    }

    // ✅ Only draft events can be edited (prevent editing submitted/approved events)
    if (event.status !== 'draft') {
      const err = new Error(`Cannot edit event with status '${event.status}'. Only draft events can be edited.`);
      err.statusCode = 400;
      throw err;
    }

    // Store old values for audit log
    const oldValue = event.toObject();

    // Update fields
    const allowedFields = [
      'title', 'description', 'objectives', 'dateTime', 'duration',
      'venue', 'capacity', 'expectedAttendees', 'isPublic', 'budget', 'guestSpeakers',
      'participatingClubs', 'allowPerformerRegistrations', 'requiresAudition'
    ];
    
    allowedFields.forEach(field => {
      if (data[field] !== undefined) {
        // Parse JSON strings from FormData
        if ((field === 'participatingClubs' || field === 'guestSpeakers') && typeof data[field] === 'string') {
          try {
            console.log(`📤 Parsing ${field} from JSON string:`, data[field]);
            const parsed = JSON.parse(data[field]);
            console.log('✅ Parsed result:', parsed);
            event[field] = parsed;
          } catch (err) {
            console.error(`❌ Failed to parse ${field}:`, err);
            event[field] = [];
          }
        }
        // Parse boolean strings from FormData
        else if ((field === 'requiresAudition' || field === 'allowPerformerRegistrations') && typeof data[field] === 'string') {
          console.log(`📤 Converting ${field} from string to boolean:`, data[field]);
          event[field] = data[field] === 'true';
          console.log(`✅ Converted to:`, event[field]);
        }
        // Direct assignment for other fields
        else {
          event[field] = data[field];
        }
      }
    });
    
    console.log('🎯 After processing - event.participatingClubs:', event.participatingClubs);
    
    // ✅ Update attendance records if participating clubs changed
    if (data.participatingClubs !== undefined) {
      // Remove all existing attendance records
      await Attendance.deleteMany({
        event: eventId,
        type: 'organizer'
      });
      
      // Recreate attendance for all club members
      // IMPORTANT: Includes ALL approved members regardless of role (for promotion data)
      const allClubIds = [event.club._id, ...(event.participatingClubs || [])];
      
      const clubMembers = await Membership.find({
        club: { $in: allClubIds },
        status: 'approved'  // NO role filtering - includes regular members too
      }).lean();
      
      const attendanceRecords = clubMembers.map(member => ({
        event: eventId,
        user: member.user,
        club: member.club,
        status: 'absent',
        type: 'organizer'
      }));
      
      if (attendanceRecords.length > 0) {
        await Attendance.insertMany(attendanceRecords, { ordered: false }).catch(err => {
          if (err.code !== 11000) throw err;
        });
      }
    }

    // Handle file uploads (replace existing files)
    if (files?.proposal) {
      const r = await cloudinary.uploadFile(files.proposal[0].path, { folder: 'events/proposals' });
      event.attachments.proposalUrl = r.secure_url;
    }
    if (files?.budgetBreakdown) {
      const r = await cloudinary.uploadFile(files.budgetBreakdown[0].path, { folder: 'events/budgets' });
      event.attachments.budgetBreakdownUrl = r.secure_url;
    }
    if (files?.venuePermission) {
      const r = await cloudinary.uploadFile(files.venuePermission[0].path, { folder: 'events/permissions' });
      event.attachments.venuePermissionUrl = r.secure_url;
    }

    // ✅ Keep status as 'draft' after editing (user can submit again for approval)
    event.status = 'draft';

    console.log('💾 BEFORE SAVE - participatingClubs:', event.participatingClubs);
    await event.save();
    console.log('✅ AFTER SAVE - Event saved successfully!');
    
    // Verify what was actually saved
    const savedEvent = await Event.findById(eventId);
    console.log('🔍 VERIFICATION - participatingClubs in DB:', savedEvent.participatingClubs);

    // Audit log
    await auditService.log({
      user: userContext.id,
      action: 'EVENT_UPDATE',
      target: `Event:${event._id}`,
      oldValue,
      newValue: event.toObject(),
      ip: userContext.ip,
      userAgent: userContext.userAgent
    });

    return event;
  }

  /**
   * Delete an event (only draft events can be deleted)
   * @param {string} eventId - Event ID
   * @param {object} userContext - User context for audit log
   * @returns {object} Success message
   */
  async delete(eventId, userContext) {
    const event = await Event.findById(eventId).populate('club');
    if (!event) {
      const err = new Error('Event not found');
      err.statusCode = 404;
      throw err;
    }

    // ✅ Only draft events can be deleted (prevent deleting submitted/approved/published events)
    if (event.status !== 'draft') {
      const err = new Error(`Cannot delete event with status '${event.status}'. Only draft events can be deleted.`);
      err.statusCode = 400;
      throw err;
    }

    // Store event data for audit log before deletion
    const eventData = event.toObject();

    // Hard delete the event
    await Event.findByIdAndDelete(eventId);

    // Audit log
    await auditService.log({
      user: userContext.id,
      action: 'EVENT_DELETE',
      target: `Event:${eventId}`,
      oldValue: eventData,
      ip: userContext.ip,
      userAgent: userContext.userAgent
    });

    // ✅ Notify club members about event deletion
    // Get all approved club members
    const members = await Membership.find({ 
      club: eventData.club._id || eventData.club, 
      status: 'approved' 
    }).distinct('user');
    
    // Create individual notifications for each member
    await Promise.all(members.map(userId =>
      notificationSvc.create({
        user: userId,
        type: 'system_maintenance', // Using existing enum value (closest match for event deletion)
        payload: { 
          message: `Event "${eventData.title}" has been deleted`,
          eventTitle: eventData.title,
          eventDate: eventData.dateTime,
          deletedBy: userContext.id
        },
        priority: 'MEDIUM'
      })
    ));

    return { message: 'Event deleted successfully' };
  }

  /**
   * Upload completion materials (photos, report, attendance, bills)
   */
  async uploadCompletionMaterials(eventId, files, data, userContext) {
    const event = await Event.findById(eventId);
    if (!event) {
      const err = new Error('Event not found');
      err.statusCode = 404;
      throw err;
    }

    // Check if event allows material uploads
    // ✅ Allow uploads for: pending_completion (initial upload) OR completed (re-upload/updates)
    if (event.status !== 'pending_completion' && event.status !== 'completed') {
      const err = new Error(`Cannot upload materials for events with status '${event.status}'. Only pending_completion and completed events can upload materials.`);
      err.statusCode = 400;
      throw err;
    }
    
    console.log(`✅ Event status '${event.status}' allows material uploads`);

    let updated = false;

    // Handle photo uploads
    if (files && files.photos) {
      const photoUrls = files.photos.map(file => `/uploads/${file.filename}`);
      event.photos = event.photos || [];
      event.photos.push(...photoUrls);
      event.completionChecklist.photosUploaded = event.photos.length >= 5;
      updated = true;
    }

    // Handle report upload
    if (files && files.report && files.report.length > 0) {
      console.log('📄 DEBUG - Report upload started');
      console.log('📄 File path:', files.report[0].path);
      console.log('📄 File name:', files.report[0].filename);
      console.log('📄 File mimetype:', files.report[0].mimetype);
      
      try {
        // ✅ Upload to Cloudinary and get URL
        const reportUpload = await cloudinary.uploadFile(files.report[0].path, {
          folder: 'events/reports',
          resource_type: 'raw' // For PDF/DOC files
        });
        
        console.log('✅ Cloudinary upload successful!');
        console.log('📄 Cloudinary response:', reportUpload);
        console.log('📄 secure_url:', reportUpload.secure_url);
        
        event.reportUrl = reportUpload.secure_url; // ✅ Save Cloudinary HTTPS URL
        console.log('✅ Saved reportUrl to event:', event.reportUrl);
        
        event.completionChecklist.reportUploaded = true;
        event.reportSubmittedAt = new Date();
        updated = true;
      } catch (uploadErr) {
        console.error('❌ Cloudinary upload failed:', uploadErr);
        throw uploadErr;
      }
    }

    // Handle attendance upload
    if (files && files.attendance && files.attendance.length > 0) {
      // ✅ Upload to Cloudinary and get URL
      const attendanceUpload = await cloudinary.uploadFile(files.attendance[0].path, {
        folder: 'events/attendance',
        resource_type: 'raw' // For Excel/CSV files
      });
      event.attendanceUrl = attendanceUpload.secure_url; // ✅ Save Cloudinary HTTPS URL
      event.completionChecklist.attendanceUploaded = true;
      updated = true;
    }

    // Handle bills upload
    if (files && files.bills) {
      // ✅ Upload each bill to Cloudinary
      const billUploadPromises = files.bills.map(file => 
        cloudinary.uploadFile(file.path, {
          folder: 'events/bills',
          resource_type: 'auto' // Auto-detect (PDF or image)
        })
      );
      const billUploads = await Promise.all(billUploadPromises);
      const billUrls = billUploads.map(upload => upload.secure_url); // ✅ Cloudinary HTTPS URLs
      
      event.billsUrls = event.billsUrls || [];
      event.billsUrls.push(...billUrls);
      event.completionChecklist.billsUploaded = event.budget > 0 ? event.billsUrls.length > 0 : true;
      updated = true;
    }

    if (!updated) {
      const err = new Error('No files uploaded');
      err.statusCode = 400;
      throw err;
    }

    // Check if all materials are complete
    const isComplete = Object.values(event.completionChecklist).every(v => v === true);
    if (isComplete) {
      event.status = 'completed';
      event.completedAt = new Date();
    }

    console.log('💾 Saving event to database...');
    await event.save();
    
    console.log('✅ Event saved successfully!');
    console.log('📄 Final reportUrl in DB:', event.reportUrl);
    console.log('📊 Final attendanceUrl in DB:', event.attendanceUrl);
    console.log('🧾 Final billsUrls in DB:', event.billsUrls);

    // Audit log
    await auditService.log({
      user: userContext.id,
      action: 'MATERIALS_UPLOADED',
      target: `Event:${eventId}`,
      newValue: { completionChecklist: event.completionChecklist, status: event.status },
      ip: userContext.ip,
      userAgent: userContext.userAgent
    });

    return event;
  }

  /**
   * Get organizers with proper role/type and club filtering
   * Presidents of participating clubs see ONLY their club members
   */
  async getEventOrganizers(eventId, userContext = null) {
    const event = await Event.findById(eventId).lean();
    
    if (!event) {
      const err = new Error('Event not found');
      err.statusCode = 404;
      throw err;
    }
    
    const { Membership } = require('../club/membership.model');
    const { Club } = require('../club/club.model');
    
    // Determine which clubs the user can view
    let allowedClubIds = [];
    
    if (userContext && userContext.roles?.global !== 'admin') {
      // Check if user is coordinator
      const eventClub = await Club.findById(event.club).lean();
      const isCoordinator = eventClub && eventClub.coordinator.toString() === userContext.id.toString();
      
      if (!isCoordinator) {
        // Find user's leadership positions in involved clubs
        const userMemberships = await Membership.find({
          user: userContext.id,
          club: { $in: [event.club, ...(event.participatingClubs || [])] },
          status: 'approved',
          role: { $in: ['president', 'vicePresident', 'core', 'secretary', 'treasurer', 'leadPR', 'leadTech'] }
        }).lean();
        
        if (userMemberships.length === 0) {
          const err = new Error('You do not have permission to view organizers');
          err.statusCode = 403;
          throw err;
        }
        
        // User can only see their own club's members
        allowedClubIds = userMemberships.map(m => m.club.toString());
      } else {
        // Coordinator sees all clubs
        allowedClubIds = [event.club.toString(), ...(event.participatingClubs || []).map(c => c.toString())];
      }
    } else {
      // Admin or no context - show all
      allowedClubIds = [event.club.toString(), ...(event.participatingClubs || []).map(c => c.toString())];
    }
    
    // Get members from allowed clubs ONLY
    const clubMembers = await Membership.find({
      club: { $in: allowedClubIds },
      status: 'approved'
    })
    .populate('user', 'profile.name email rollNumber')
    .populate('club', 'name')
    .lean();
    
    // Get existing attendance records
    const attendanceRecords = await Attendance.find({
      event: eventId,
      type: 'organizer'
    }).lean();
    
    // Build attendance map for quick lookup
    const attendanceMap = {};
    attendanceRecords.forEach(att => {
      attendanceMap[att.user.toString()] = att.status;
    });
    
    // Build member list grouped by club with role and type
    const membersByClub = {};
    
    clubMembers.forEach(membership => {
      if (!membership.user) return;
      
      const clubId = membership.club._id.toString();
      const clubName = membership.club.name;
      const userId = membership.user._id.toString();
      const isPrimaryClub = clubId === event.club.toString();
      
      // Determine member type
      const isLeadership = ['president', 'vicePresident'].includes(membership.role);
      const isCoreTeam = ['core', 'secretary', 'treasurer', 'leadPR', 'leadTech'].includes(membership.role);
      let memberType = 'volunteer';
      if (isPrimaryClub && (isLeadership || isCoreTeam)) {
        memberType = 'organizer';
      }
      
      if (!membersByClub[clubId]) {
        membersByClub[clubId] = {
          clubId,
          clubName,
          isPrimaryClub,
          members: []
        };
      }
      
      membersByClub[clubId].members.push({
        userId: membership.user._id,
        name: membership.user.profile?.name || 'Unknown',
        email: membership.user.email,
        rollNumber: membership.user.rollNumber,
        role: membership.role,
        type: memberType,
        attendanceStatus: attendanceMap[userId] || 'pending'
      });
    });
    
    // Convert to array and sort by role hierarchy
    const result = Object.values(membersByClub).map(group => {
      group.members.sort((a, b) => {
        const roleOrder = {
          'president': 1, 'vicePresident': 2, 'secretary': 3,
          'treasurer': 4, 'leadPR': 5, 'leadTech': 6, 'core': 7, 'member': 8
        };
        const roleA = roleOrder[a.role] || 9;
        const roleB = roleOrder[b.role] || 9;
        if (roleA !== roleB) return roleA - roleB;
        return a.name.localeCompare(b.name);
      });
      return group;
    });
    
    // Primary club first
    result.sort((a, b) => {
      if (a.isPrimaryClub && !b.isPrimaryClub) return -1;
      if (!a.isPrimaryClub && b.isPrimaryClub) return 1;
      return a.clubName.localeCompare(b.clubName);
    });
    
    return result;
  }

  /**
   * Update organizer attendance (bulk update)
   * @param {string} eventId - Event ID
   * @param {Array} attendance - Array of {userId, status} objects
   */
  async updateOrganizerAttendance(eventId, attendance, userContext) {
    const event = await Event.findById(eventId);
    if (!event) {
      const err = new Error('Event not found');
      err.statusCode = 404;
      throw err;
    }
    
    // Validate attendance array
    if (!Array.isArray(attendance) || attendance.length === 0) {
      const err = new Error('Invalid attendance data');
      err.statusCode = 400;
      throw err;
    }
    
    // Update each attendance record
    const updates = attendance.map(async ({ userId, status }) => {
      // Validate status
      if (!['present', 'absent'].includes(status)) {
        throw new Error(`Invalid status: ${status}`);
      }
      
      // Update or create attendance record
      const result = await Attendance.findOneAndUpdate(
        {
          event: eventId,
          user: userId,
          type: { $in: ['organizer', 'volunteer'] }
        },
        {
          status,
          checkInTime: status === 'present' ? new Date() : null
        },
        { new: true, upsert: false }
      );
      
      if (!result) {
        throw new Error(`Attendance record not found for user ${userId}`);
      }
      
      return result;
    });
    
    await Promise.all(updates);
    
    // Audit log
    await auditService.log({
      user: userContext.id,
      action: 'ORGANIZER_ATTENDANCE_UPDATE',
      target: `Event:${eventId}`,
      newValue: { attendance },
      ip: userContext.ip,
      userAgent: userContext.userAgent
    });
    
    return { message: 'Attendance updated successfully' };
  }
}

module.exports = new EventService();