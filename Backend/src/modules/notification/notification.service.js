const { Notification }     = require('./notification.model');
const notificationQueue    = require('../../queues/notification.queue');

/**
 * Generate title and message based on notification type and payload
 */
function generateNotificationContent(type, payload = {}) {
  const templates = {
    // Recruitment notifications
    recruitment_created: {
      title: 'New Recruitment Started',
      message: `${payload.clubName || 'A club'} has started recruiting new members!`
    },
    recruitment_opened: {
      title: 'Recruitment Now Open',
      message: `Applications are now open for ${payload.clubName || 'club recruitment'}`
    },
    recruitment_closed: {
      title: 'Recruitment Closed',
      message: `Recruitment for ${payload.clubName || 'the club'} has closed`
    },
    application_received: {
      title: 'Application Received',
      message: `Your application to ${payload.clubName || 'the club'} has been received`
    },
    application_approved: {
      title: 'Application Approved! 🎉',
      message: `Congratulations! You've been accepted to ${payload.clubName || 'the club'}`
    },
    application_rejected: {
      title: 'Application Update',
      message: `Your application to ${payload.clubName || 'the club'} was not successful this time`
    },
    
    // Event notifications
    event_created: {
      title: 'New Event Created',
      message: `${payload.eventTitle || 'An event'} has been created by ${payload.clubName || 'a club'}`
    },
    event_published: {
      title: 'Event Published',
      message: `${payload.eventTitle || 'Event'} is now live! Check it out`
    },
    event_updated: {
      title: 'Event Updated',
      message: `${payload.eventTitle || 'An event'} has been updated`
    },
    event_cancelled: {
      title: 'Event Cancelled',
      message: `${payload.eventTitle || 'Event'} has been cancelled`
    },
    event_reminder: {
      title: 'Event Reminder',
      message: `${payload.eventTitle || 'Event'} is coming up soon!`
    },
    
    // Role notifications
    role_assigned: {
      title: 'New Role Assigned',
      message: `You've been assigned as ${payload.role || 'member'} in ${payload.clubName || 'a club'}`
    },
    role_removed: {
      title: 'Role Removed',
      message: `Your role in ${payload.clubName || 'the club'} has been updated`
    },
    
    // Club notifications
    club_created: {
      title: 'New Club Created',
      message: `${payload.clubName || 'A new club'} has been created`
    },
    club_approved: {
      title: 'Club Approved',
      message: `${payload.clubName || 'Your club'} has been approved!`
    },
    member_joined: {
      title: 'New Member',
      message: `${payload.memberName || 'Someone'} joined ${payload.clubName || 'your club'}`
    },
    member_left: {
      title: 'Member Left',
      message: `${payload.memberName || 'A member'} left ${payload.clubName || 'your club'}`
    },
    
    // Registration notifications
    registration_approved: {
      title: 'Registration Approved',
      message: `Your registration for ${payload.eventTitle || 'the event'} has been approved`
    },
    registration_rejected: {
      title: 'Registration Update',
      message: `Your registration for ${payload.eventTitle || 'the event'} was not approved`
    },
    performer_registration: {
      title: 'New Performance Registration',
      message: `New registration received for ${payload.eventTitle || 'event'}`
    },
    performer_approved: {
      title: 'Performance Approved! 🎭',
      message: `Your performance for ${payload.eventTitle || 'the event'} has been approved`
    },
    performer_rejected: {
      title: 'Performance Update',
      message: `Your performance registration for ${payload.eventTitle || 'the event'} was not approved`
    },
    
    // System notifications
    system: {
      title: 'System Notification',
      message: payload.message || 'You have a new notification'
    },
    announcement: {
      title: payload.title || 'Announcement',
      message: payload.message || 'New announcement from KMIT Clubs Hub'
    }
  };
  
  const template = templates[type] || {
    title: type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
    message: payload.message || 'You have a new notification'
  };
  
  return template;
}

class NotificationService {
  /**
   * Create & enqueue a notification.
   * Includes deduplication to prevent duplicate notifications within 1 hour.
   * @param {Object} opts: { user, type, payload, priority, title, message }
   */
  async create({ user, type, payload = {}, priority = 'MEDIUM', title, message }) {
    // Deduplication: Check for similar notification created in last hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    const existingNotif = await Notification.findOne({
      user,
      type,
      createdAt: { $gte: oneHourAgo },
      // For role_assigned, also check if payload is similar
      ...(type === 'role_assigned' && payload.role ? { 'payload.role': payload.role } : {})
    }).sort({ createdAt: -1 });

    // If duplicate found within last hour, return existing instead of creating new
    if (existingNotif) {
      console.log(`[Notification] Duplicate prevented: ${type} for user ${user}`);
      return existingNotif;
    }

    // Generate title and message if not provided
    const content = generateNotificationContent(type, payload);
    const finalTitle = title || content.title;
    const finalMessage = message || content.message;

    // Create new notification with proper title and message
    const notif = await Notification.create({ 
      user, 
      type, 
      payload, 
      priority,
      title: finalTitle,
      message: finalMessage
    });
    if (!notificationQueue || typeof notificationQueue.add !== 'function') {
      console.error('notificationQueue is not properly initialized:', notificationQueue);
      throw new Error('Notification queue is not available');
    }
    await notificationQueue.add('send', { notifId: notif._id });
    return notif;
  }

  async list(userId, { page = 1, limit = 20, type, priority, isRead, includeOlder = false }) {
    const query = { user: userId };
    
    // Workplan Line 362: Last 30 days visible by default, pagination for older
    if (!includeOlder) {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      query.createdAt = { $gte: thirtyDaysAgo };
    }
    
    if (type) query.type = type;
    if (priority) query.priority = priority;
    if (typeof isRead === 'boolean') query.isRead = isRead;
    
    const skip = (page - 1) * limit;
    const [total, items] = await Promise.all([
      Notification.countDocuments(query),
      Notification.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
    ]);
    
    return { 
      total, 
      page, 
      limit, 
      items,
      hasOlder: !includeOlder && await this.hasOlderNotifications(userId)
    };
  }
  
  /**
   * Check if user has notifications older than 30 days
   */
  async hasOlderNotifications(userId) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const count = await Notification.countDocuments({
      user: userId,
      createdAt: { $lt: thirtyDaysAgo }
    });
    return count > 0;
  }

  async markRead(userId, id, isRead) {
    const notif = await Notification.findOneAndUpdate(
      { _id: id, user: userId },
      { isRead },
      { new: true }
    );
    if (!notif) throw Object.assign(new Error('Not found'), { statusCode: 404 });
    return notif;
  }

  async markAllRead(userId) {
    await Notification.updateMany({ user: userId, isRead: false }, { isRead: true });
  }

  async countUnread(userId) {
    return Notification.countDocuments({ user: userId, isRead: false });
  }
}

module.exports = new NotificationService();