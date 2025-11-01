// src/jobs/eventStatusCron.js
const cron = require('node-cron');
const { Event } = require('../modules/event/event.model');
const { Membership } = require('../modules/club/membership.model');
const notificationService = require('../modules/notification/notification.service');
const auditService = require('../modules/audit/audit.service');

console.log('🔄 Event Status Cron Jobs - Initializing...');

// ========================================
// JOB 1: Start Ongoing Events
// Runs every hour
// Changes 'published' → 'ongoing' on event day
// ========================================
cron.schedule('0 * * * *', async () => {
  try {
    console.log('🔄 [Cron Job 1] Checking for events to mark as ongoing...');
    
    // ✅ PRODUCTION MODE: Only mark events as ongoing when their dateTime arrives
    const now = new Date();
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
    
    const events = await Event.find({
      status: 'published',
      dateTime: { 
        $lte: now,          // Event time has passed (dateTime <= now)
        $gte: oneDayAgo     // Within last 24 hours (not too old)
      }
    }).populate('club');
    
    if (events.length === 0) {
      console.log('   ℹ️  No events to start');
      return;
    }
    
    for (const event of events) {
      event.status = 'ongoing';
      await event.save();
      
      console.log(`   ✅ Event "${event.title}" marked as ongoing`);
      
      // Get club core members to notify
      const coreMembers = await Membership.find({
        club: event.club._id,
        role: { $in: ['president', 'vicePresident', 'secretary', 'treasurer', 'leadPR', 'leadTech', 'core'] },
        status: 'approved'
      }).distinct('user');
      
      // Notify organizers
      await Promise.all(coreMembers.map(userId =>
        notificationService.create({
          user: userId,
          type: 'event_reminder',
          payload: { 
            eventId: event._id, 
            eventName: event.title,
            message: '🎬 Your event is now live! QR code is active for attendance.'
          },
          priority: 'HIGH'
        }).catch(err => console.error('Failed to send notification:', err))
      ));
    }
    
    console.log(`   ✅ [Job 1] Completed - ${events.length} event(s) started`);
  } catch (error) {
    console.error('   ❌ [Job 1] Error:', error.message);
  }
});

// ========================================
// JOB 2: Move to Pending Completion
// Runs every hour at :30
// Changes 'ongoing' → 'pending_completion' after event ends (dateTime + duration)
// ========================================
cron.schedule('30 * * * *', async () => { // TESTING: Every minute (change back to '30 * * * *' after testing)
  try {
    console.log('🔄 [Cron Job 2] Checking events to move to pending_completion...');
    
    const now = new Date();
    
    // ✅ FIX: Get all ongoing events and check if they've ended (dateTime + duration)
    const events = await Event.find({
      status: 'ongoing'
    }).populate('club');
    
    if (events.length === 0) {
      console.log('   ℹ️  No ongoing events found');
      return;
    }
    
    let movedCount = 0;
    
    for (const event of events) {
      // Calculate event end time: dateTime + duration (convert minutes to ms)
      const eventDurationMs = (event.duration || 0) * 60 * 1000;
      const eventEndTime = new Date(event.dateTime.getTime() + eventDurationMs);
      
      // Only move to pending_completion if event has ended
      if (now < eventEndTime) {
        console.log(`   ⏸️  Event "${event.title}" still ongoing (ends at ${eventEndTime.toLocaleString()})`);
        continue; // Skip this event
      }
      
      event.status = 'pending_completion';
      event.completionDeadline = new Date(event.dateTime.getTime() + 7 * 24 * 60 * 60 * 1000);
      movedCount++;
      
      // Check current completion status
      event.completionChecklist = {
        photosUploaded: (event.photos && event.photos.length >= 5),
        reportUploaded: !!event.reportUrl,
        attendanceUploaded: !!event.attendanceUrl,
        billsUploaded: event.budget > 0 ? (event.billsUrls && event.billsUrls.length > 0) : true
      };
      
      await event.save();
      console.log(`   ⏳ Event "${event.title}" moved to pending_completion`);
      
      // Check if already complete
      const isComplete = Object.values(event.completionChecklist).every(v => v === true);
      
      if (isComplete) {
        event.status = 'completed';
        event.completedAt = new Date();
        await event.save();
        console.log(`   ✅ Event "${event.title}" auto-completed (all materials uploaded)`);
      } else {
        // Send initial reminder with missing items
        const missing = [];
        if (!event.completionChecklist.photosUploaded) missing.push('photos (min 5)');
        if (!event.completionChecklist.reportUploaded) missing.push('event report');
        if (!event.completionChecklist.attendanceUploaded) missing.push('attendance sheet');
        if (!event.completionChecklist.billsUploaded) missing.push('bills/receipts');
        
        // Get club core members
        const coreMembers = await Membership.find({
          club: event.club._id,
          role: { $in: ['president', 'vicePresident', 'secretary', 'treasurer', 'leadPR', 'leadTech', 'core'] },
          status: 'approved'
        }).distinct('user');
        
        await Promise.all(coreMembers.map(userId =>
          notificationService.create({
            user: userId,
            type: 'approval_required',
            payload: {
              eventId: event._id,
              eventName: event.title,
              message: `⏰ Please upload: ${missing.join(', ')} within 7 days to complete the event.`
            },
            priority: 'HIGH'
          }).catch(err => console.error('Failed to send notification:', err))
        ));
      }
    }
    
    console.log(`   ✅ [Job 2] Completed - ${movedCount} event(s) moved to pending_completion (${events.length} ongoing events checked)`);
  } catch (error) {
    console.error('   ❌ [Job 2] Error:', error.message);
  }
});

// ========================================
// JOB 3: Send Completion Reminders
// Runs daily at 9:00 AM
// Sends reminders on Day 3 and Day 5
// ========================================
cron.schedule('0 9 * * *', async () => {
  try {
    console.log('🔄 [Cron Job 3] Sending completion reminders...');
    
    const now = new Date();
    let remindersSent = 0;
    
    // ===== DAY 3 REMINDERS =====
    const day3Start = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const day3End = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000);
    
    const day3Events = await Event.find({
      status: 'pending_completion',
      completionDeadline: {
        $gte: day3Start,
        $lt: day3End
      },
      'completionReminderSent.day3': false
    }).populate('club');
    
    for (const event of day3Events) {
      const missing = [];
      if (!event.completionChecklist.photosUploaded) missing.push('photos');
      if (!event.completionChecklist.reportUploaded) missing.push('report');
      if (!event.completionChecklist.attendanceUploaded) missing.push('attendance');
      if (!event.completionChecklist.billsUploaded) missing.push('bills');
      
      const coreMembers = await Membership.find({
        club: event.club._id,
        role: { $in: ['president', 'vicePresident', 'secretary', 'treasurer', 'leadPR', 'leadTech', 'core'] },
        status: 'approved'
      }).distinct('user');
      
      await Promise.all(coreMembers.map(userId =>
        notificationService.create({
          user: userId,
          type: 'event_reminder',
          payload: {
            eventId: event._id,
            eventName: event.title,
            message: `⏰ 4 days left! Still need: ${missing.join(', ')}`
          },
          priority: 'HIGH'
        }).catch(err => console.error('Failed to send notification:', err))
      ));
      
      event.completionReminderSent.day3 = true;
      await event.save();
      remindersSent++;
      console.log(`   📧 Day 3 reminder sent for "${event.title}"`);
    }
    
    // ===== DAY 5 REMINDERS (URGENT) =====
    const day5Start = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);
    const day5End = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
    
    const day5Events = await Event.find({
      status: 'pending_completion',
      completionDeadline: {
        $gte: day5Start,
        $lt: day5End
      },
      'completionReminderSent.day5': false
    }).populate('club');
    
    for (const event of day5Events) {
      const missing = [];
      if (!event.completionChecklist.photosUploaded) missing.push('photos');
      if (!event.completionChecklist.reportUploaded) missing.push('report');
      if (!event.completionChecklist.attendanceUploaded) missing.push('attendance');
      if (!event.completionChecklist.billsUploaded) missing.push('bills');
      
      const coreMembers = await Membership.find({
        club: event.club._id,
        role: { $in: ['president', 'vicePresident', 'secretary', 'treasurer', 'leadPR', 'leadTech', 'core'] },
        status: 'approved'
      }).distinct('user');
      
      await Promise.all(coreMembers.map(userId =>
        notificationService.create({
          user: userId,
          type: 'event_reminder',
          payload: {
            eventId: event._id,
            eventName: event.title,
            message: `🚨 URGENT: 2 days left! Upload: ${missing.join(', ')} or event will be marked incomplete.`
          },
          priority: 'URGENT'
        }).catch(err => console.error('Failed to send notification:', err))
      ));
      
      // Also notify coordinator
      await notificationService.create({
        user: event.club.coordinator,
        type: 'approval_required',
        payload: {
          eventId: event._id,
          eventName: event.title,
          clubName: event.club.name,
          message: `Event completion deadline approaching. Missing: ${missing.join(', ')}`
        },
        priority: 'HIGH'
      }).catch(err => console.error('Failed to send notification:', err));
      
      event.completionReminderSent.day5 = true;
      await event.save();
      remindersSent++;
      console.log(`   🚨 Day 5 URGENT reminder sent for "${event.title}"`);
    }
    
    console.log(`   ✅ [Job 3] Completed - ${remindersSent} reminder(s) sent`);
  } catch (error) {
    console.error('   ❌ [Job 3] Error:', error.message);
  }
});

// ========================================
// JOB 4: Mark Incomplete Events
// Runs daily at 10:00 AM
// Marks events as 'incomplete' after 7 days
// ========================================
cron.schedule('0 10 * * *', async () => {
  try {
    console.log('🔄 [Cron Job 4] Checking for incomplete events...');
    
    const now = new Date();
    const events = await Event.find({
      status: 'pending_completion',
      completionDeadline: { $lt: now }
    }).populate('club');
    
    if (events.length === 0) {
      console.log('   ℹ️  No incomplete events found');
      return;
    }
    
    for (const event of events) {
      event.status = 'incomplete';
      event.markedIncompleteAt = now;
      
      const missing = [];
      if (!event.completionChecklist.photosUploaded) missing.push('Photos (min 5)');
      if (!event.completionChecklist.reportUploaded) missing.push('Event report');
      if (!event.completionChecklist.attendanceUploaded) missing.push('Attendance sheet');
      if (!event.completionChecklist.billsUploaded) missing.push('Bills/receipts');
      
      event.incompleteReason = `7-day deadline passed. Missing: ${missing.join(', ')}`;
      await event.save();
      
      console.log(`   ❌ Event "${event.title}" marked as incomplete`);
      
      // Notify organizers
      const coreMembers = await Membership.find({
        club: event.club._id,
        role: { $in: ['president', 'vicePresident', 'secretary', 'treasurer', 'leadPR', 'leadTech', 'core'] },
        status: 'approved'
      }).distinct('user');
      
      await Promise.all(coreMembers.map(userId =>
        notificationService.create({
          user: userId,
          type: 'request_rejected',
          payload: {
            eventId: event._id,
            eventName: event.title,
            message: `Event marked incomplete due to missing materials: ${missing.join(', ')}`
          },
          priority: 'URGENT'
        }).catch(err => console.error('Failed to send notification:', err))
      ));
      
      // Notify coordinator
      await notificationService.create({
        user: event.club.coordinator,
        type: 'approval_required',
        payload: {
          eventId: event._id,
          eventName: event.title,
          clubName: event.club.name,
          message: `Event marked incomplete. Missing: ${missing.join(', ')}`
        },
        priority: 'HIGH'
      }).catch(err => console.error('Failed to send notification:', err));
      
      // Audit log
      await auditService.log({
        user: null,
        action: 'EVENT_MARKED_INCOMPLETE',
        target: `Event:${event._id}`,
        oldValue: { status: 'pending_completion' },
        newValue: { status: 'incomplete', reason: event.incompleteReason },
        ip: 'system',
        userAgent: 'cron-job'
      }).catch(err => console.error('Failed to log audit:', err));
    }
    
    console.log(`   ✅ [Job 4] Completed - ${events.length} event(s) marked incomplete`);
  } catch (error) {
    console.error('   ❌ [Job 4] Error:', error.message);
  }
});

console.log('✅ Event Status Cron Jobs - Initialized Successfully!');
console.log('📅 Job 1: Start ongoing events - Every hour (0 * * * *)');
console.log('📅 Job 2: Move to pending_completion - Every hour at :30 (30 * * * *)');
console.log('📅 Job 3: Send reminders - Daily at 9:00 AM (0 9 * * *)');
console.log('📅 Job 4: Mark incomplete - Daily at 10:00 AM (0 10 * * *)');
