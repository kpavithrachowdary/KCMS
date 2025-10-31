// src/modules/admin/admin.routes.js
const router = require('express').Router();
const authenticate = require('../../middlewares/auth');
const { requireAdmin } = require('../../middlewares/permission');
const validate = require('../../middlewares/validate');
const Joi = require('joi');
const redis = require('../../config/redis');
const {
  enableMaintenanceMode,
  disableMaintenanceMode,
  getMaintenanceInfo
} = require('../../middlewares/maintenance');

// Validation schemas
const maintenanceModeSchema = Joi.object({
  reason: Joi.string().optional(),
  estimatedEnd: Joi.string().isoDate().optional(),
  message: Joi.string().optional()
});

/**
 * Get maintenance mode status
 * GET /api/admin/maintenance
 */
router.get('/maintenance', authenticate, requireAdmin(), async (req, res, next) => {
  try {
    const info = await getMaintenanceInfo();
    res.json({
      status: 'success',
      data: {
        enabled: info !== null,
        info
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Enable maintenance mode
 * POST /api/admin/maintenance/enable
 */
router.post(
  '/maintenance/enable',
  authenticate,
  requireAdmin(),
  validate(maintenanceModeSchema),
  async (req, res, next) => {
    try {
      await enableMaintenanceMode({
        ...req.body,
        enabledBy: req.user.id
      });
      
      res.json({
        status: 'success',
        message: 'Maintenance mode enabled successfully'
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Disable maintenance mode
 * POST /api/admin/maintenance/disable
 */
router.post(
  '/maintenance/disable',
  authenticate,
  requireAdmin(),
  async (req, res, next) => {
    try {
      await disableMaintenanceMode();
      
      res.json({
        status: 'success',
        message: 'Maintenance mode disabled successfully'
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Get system statistics
 * GET /api/admin/stats
 */
router.get('/stats', authenticate, requireAdmin(), async (req, res, next) => {
  try {
    const mongoose = require('mongoose');
    const { User } = require('../auth/user.model');
    const { Club } = require('../club/club.model');
    const { Event } = require('../event/event.model');
    
    const [totalUsers, totalClubs, totalEvents, dbStats] = await Promise.all([
      User.countDocuments(),
      Club.countDocuments(),
      Event.countDocuments(),
      mongoose.connection.db.stats()
    ]);
    
    res.json({
      status: 'success',
      data: {
        users: totalUsers,
        clubs: totalClubs,
        events: totalEvents,
        database: {
          collections: dbStats.collections,
          dataSize: dbStats.dataSize,
          indexSize: dbStats.indexSize,
          storageSize: dbStats.storageSize
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

// Backup Management Routes

const { performBackup, getBackupStats, restoreBackup } = require('../../workers/backup.worker');

const backupTypeSchema = Joi.object({
  type: Joi.string().valid('daily', 'weekly', 'monthly').required()
});

const restoreBackupSchema = Joi.object({
  backupPath: Joi.string().required()
});

/**
 * Get backup statistics
 * GET /api/admin/backups/stats
 */
router.get('/backups/stats', authenticate, requireAdmin(), async (req, res, next) => {
  try {
    const stats = await getBackupStats();
    res.json({
      status: 'success',
      data: stats
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Trigger manual backup
 * POST /api/admin/backups/create
 */
router.post(
  '/backups/create',
  authenticate,
  requireAdmin(),
  validate(backupTypeSchema),
  async (req, res, next) => {
    try {
      const { type } = req.body;
      const result = await performBackup(type);
      
      res.json({
        status: 'success',
        message: `${type} backup created successfully`,
        data: result
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Restore from backup
 * POST /api/admin/backups/restore
 */
router.post(
  '/backups/restore',
  authenticate,
  requireAdmin(),
  validate(restoreBackupSchema),
  async (req, res, next) => {
    try {
      const { backupPath } = req.body;
      const result = await restoreBackup(backupPath);
      
      res.json({
        status: 'success',
        message: 'Backup restored successfully',
        data: result
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Clear Redis cache (useful for debugging)
 * POST /api/admin/cache/clear
 */
router.post('/cache/clear', authenticate, requireAdmin(), async (req, res, next) => {
  try {
    const keys = await redis.keys('clubs:list:*');
    
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    
    res.json({
      status: 'success',
      message: `Cleared ${keys.length} cache entries`,
      data: { clearedKeys: keys.length }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
