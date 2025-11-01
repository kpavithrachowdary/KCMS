const config = require('./config');
const http = require('http');
const mongoose = require('mongoose');
const app = require('./app');
const redis = require('./config/redis');
const { startSchedulers } = require('./workers/bootstrap');
const { startNotificationBatcher } = require('./workers/notification.batcher');
const { startRecruitmentScheduler } = require('./workers/recruitment.scheduler');
const { verifyTransport } = require('./utils/mail');

// ✅ Import workers
const auditWorker = require('./workers/audit.worker');
const notificationWorker = require('./workers/notification.worker');
const recruitmentWorker = require('./workers/recruitment.worker');
const eventCompletionWorker = require('./workers/event-completion.worker');
const eventReportWorker = require('./workers/event-report.worker');

const PORT = config.PORT;
const MONGO_URI = config.MONGODB_URI;

let server;
let schedulers;

async function waitForRedis() {
  const pong = await redis.ping();
  if (pong !== 'PONG') throw new Error('Redis not ready');
}

async function start() {
  // Connect Mongo
  console.log('🔄 Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('✅ MongoDB connected successfully');
  console.log(`   Database: ${mongoose.connection.name}`);

  // Verify Redis
  console.log('🔄 Connecting to Redis...');
  await waitForRedis();
  console.log('✅ Redis connected successfully');

  if (config.START_SCHEDULERS) {
    try {
      schedulers = startSchedulers();
      console.log('QueueSchedulers started');
      
      // ✅ Workers are automatically started on import
      console.log('✅ Workers started:');
      console.log('   - Audit Worker: Processing audit logs');
      console.log('   - Notification Worker: Processing notifications');
      console.log('   - Recruitment Worker: Processing recruitment tasks');
      console.log('   - Event Completion Worker: Monitoring event completion ✨');
      console.log('   - Event Report Worker: Generating event reports ✨');
    } catch (e) {
      console.error('Failed to start QueueSchedulers:', e);
    }
  }

  if (config.START_NOTIFICATION_BATCH) {
    try {
      startNotificationBatcher();
      console.log('📬 Notification Batching: Running');
    } catch (e) {
      console.error('Failed to schedule notification batching:', e);
    }
  }

  // Start recruitment lifecycle scheduler
  if (config.START_SCHEDULERS) {
    try {
      startRecruitmentScheduler(60000); // Check every minute
    } catch (e) {
      console.error('Failed to start recruitment scheduler:', e);
    }
  }

  // Start event status cron jobs (auto-status transitions)
  if (config.START_SCHEDULERS) {
    try {
      require('./jobs/eventStatusCron');
      console.log('📅 Event Status Cron Jobs: Running');
    } catch (e) {
      console.error('Failed to start event status cron jobs:', e);
    }
  }

  // Start recruitment reminder cron (Workplan Line 222: Daily reminder if <100 applications)
  if (config.START_SCHEDULERS) {
    try {
      require('./jobs/recruitmentReminder');
      console.log('📋 Recruitment Reminder Cron: Running daily at 6 PM IST');
    } catch (e) {
      console.error('Failed to start recruitment reminder:', e);
    }
  }

  // Verify SMTP (optional hard fail)
  if (config.SMTP_HOST) {
    try {
      await verifyTransport();
    } catch (err) {
      console.error('SMTP verify failed at boot:', err.message);
    }
  }

  server = http.createServer(app);

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n🚀 Server started successfully!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📡 Server listening on port: ${PORT} (0.0.0.0)`);
  console.log(`🌍 Environment: ${config.NODE_ENV}`);
  console.log(`💾 MongoDB: Connected (${mongoose.connection.name})`);
  console.log(`🔴 Redis: Connected`);
  console.log(`📧 SMTP: ${config.SMTP_HOST ? 'Configured' : 'Not configured'}`);
  console.log(`⚙️  Queue Schedulers: ${config.START_SCHEDULERS ? 'Running' : 'Disabled'}`);
  console.log(`📬 Notification Batching: ${config.START_NOTIFICATION_BATCH ? 'Running' : 'Disabled'}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
});

}

// Graceful shutdown
function shutdown(signal) {
  console.log(`${signal} received, shutting down...`);
  server?.close(() => {
    mongoose.connection.close(false, () => {
      console.log('Mongo connection closed');
      redis.quit().finally(() => {
        console.log('Redis connection closed');
        process.exit(0);
      });
    });
  });
  // Fallback hard exit if not closed in time
  setTimeout(() => process.exit(1), 15000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start().catch((err) => {
  console.error('Startup error:', err);
  process.exit(1);
});
