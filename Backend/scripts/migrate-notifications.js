/**
 * Migration Script: Update Existing Notifications with Proper Titles
 * Run this once to fix notifications that have default 'Notification' title
 * 
 * Usage: node scripts/migrate-notifications.js
 */

const mongoose = require('mongoose');
const appConfig = require('../src/config');
const { Notification } = require('../src/modules/notification/notification.model');

/**
 * Generate title and message based on notification type and payload
 */
function generateNotificationContent(type, payload = {}) {
  const templates = {
    // Recruitment notifications
    recruitment_open: {
      title: 'Recruitment Now Open',
      message: `Applications are now open for ${payload.clubName || payload.title || 'club recruitment'}`
    },
    recruitment_closing: {
      title: 'Recruitment Closing Soon',
      message: `${payload.title || payload.clubName || 'A recruitment'} is closing in ${payload.hoursLeft || 24} hours`
    },
    application_status: {
      title: 'Application Update',
      message: `Your application status has been updated to: ${payload.status || 'pending'}`
    },
    application_approved: {
      title: 'Application Approved! 🎉',
      message: `Congratulations! You've been accepted to ${payload.clubName || 'the club'}`
    },
    
    // Event notifications
    event_reminder: {
      title: 'Event Reminder',
      message: `${payload.eventTitle || payload.title || 'An event'} is coming up soon!`
    },
    event_published: {
      title: 'Event Published',
      message: `${payload.eventTitle || payload.title || 'Event'} is now live! Check it out`
    },
    
    // Role notifications
    role_assigned: {
      title: 'New Role Assigned',
      message: `You've been assigned as ${payload.role || 'member'} in ${payload.clubName || 'a club'}`
    },
    
    // Approval notifications
    approval_required: {
      title: 'Approval Required',
      message: `${payload.title || 'An item'} requires your approval`
    },
    
    // System notifications
    system_maintenance: {
      title: 'System Maintenance',
      message: payload.message || 'System maintenance is scheduled'
    }
  };
  
  const template = templates[type] || {
    title: type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
    message: payload.message || 'You have a new notification'
  };
  
  return template;
}

async function migrateNotifications() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(appConfig.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Find all notifications that need updating
    const notifications = await Notification.find({
      $or: [
        { title: 'Notification' },
        { title: { $exists: false } },
        { title: '' },
        { title: null }
      ]
    });

    console.log(`Found ${notifications.length} notifications to update`);

    let updated = 0;

    for (const notif of notifications) {
      try {
        const content = generateNotificationContent(notif.type, notif.payload);
        
        await Notification.updateOne(
          { _id: notif._id },
          { 
            $set: { 
              title: content.title,
              message: content.message
            }
          }
        );
        
        updated++;
        if (updated % 10 === 0) {
          console.log(`Updated ${updated}/${notifications.length} notifications...`);
        }
      } catch (err) {
        console.error(`Failed to update notification ${notif._id}:`, err.message);
      }
    }

    console.log('\n✅ Migration completed!');
    console.log(`  - Updated: ${updated} notifications`);

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
    process.exit(0);
  }
}

// Run migration
migrateNotifications();