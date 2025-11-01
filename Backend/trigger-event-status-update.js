// Manual script to trigger event status updates
require('dotenv').config();
const mongoose = require('mongoose');
const { Event } = require('./src/modules/event/event.model');
const { Club } = require('./src/modules/club/club.model');
const { Membership } = require('./src/modules/club/membership.model');
const notificationService = require('./src/modules/notification/notification.service');

async function updateEventStatuses() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    const now = new Date();
    console.log(`🔄 Checking event statuses at ${now.toLocaleString()}\n`);
    
    // Get all ongoing events
    const events = await Event.find({ status: 'ongoing' }).populate('club');
    
    if (events.length === 0) {
      console.log('ℹ️  No ongoing events found');
      process.exit(0);
    }
    
    console.log(`📋 Found ${events.length} ongoing event(s)\n`);
    
    let movedCount = 0;
    
    for (const event of events) {
      // Calculate event end time
      const eventDurationMs = (event.duration || 0) * 60 * 1000;
      const eventEndTime = new Date(event.dateTime.getTime() + eventDurationMs);
      
      console.log(`\n📅 Event: "${event.title}"`);
      console.log(`   Start: ${event.dateTime.toLocaleString()}`);
      console.log(`   Duration: ${event.duration} minutes`);
      console.log(`   End: ${eventEndTime.toLocaleString()}`);
      console.log(`   Current: ${now.toLocaleString()}`);
      
      // Check if event has ended
      if (now < eventEndTime) {
        console.log(`   ⏸️  Still ongoing (${Math.round((eventEndTime - now) / 60000)} minutes remaining)`);
        continue;
      }
      
      // Move to pending_completion
      console.log(`   ✅ Event has ended - moving to pending_completion`);
      
      event.status = 'pending_completion';
      event.completionDeadline = new Date(event.dateTime.getTime() + 7 * 24 * 60 * 60 * 1000);
      
      // Check completion status
      event.completionChecklist = {
        photosUploaded: (event.photos && event.photos.length >= 5),
        reportUploaded: !!event.reportUrl,
        attendanceUploaded: !!event.attendanceUrl,
        billsUploaded: event.budget > 0 ? (event.billsUrls && event.billsUrls.length > 0) : true
      };
      
      await event.save();
      movedCount++;
      
      // Check if already complete
      const isComplete = Object.values(event.completionChecklist).every(v => v === true);
      
      if (isComplete) {
        event.status = 'completed';
        event.completedAt = new Date();
        await event.save();
        console.log(`   🎉 Auto-completed (all materials uploaded)`);
      } else {
        // Send notification
        const missing = [];
        if (!event.completionChecklist.photosUploaded) missing.push('photos (min 5)');
        if (!event.completionChecklist.reportUploaded) missing.push('event report');
        if (!event.completionChecklist.attendanceUploaded) missing.push('attendance sheet');
        if (!event.completionChecklist.billsUploaded) missing.push('bills/receipts');
        
        console.log(`   ⏰ Missing: ${missing.join(', ')}`);
        console.log(`   📧 Sending notifications to club leadership...`);
        
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
        
        console.log(`   ✅ Notifications sent to ${coreMembers.length} member(s)`);
      }
    }
    
    console.log(`\n✅ Update complete - ${movedCount} event(s) moved to pending_completion`);
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

updateEventStatuses();
