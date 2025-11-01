// src/modules/auth/auth.controller.js
const authSvc          = require('./auth.service');
const { successResponse } = require('../../utils/response');
const jwtUtil          = require('../../utils/jwt');

exports.register = async (req, res, next) => {
  try {
    await authSvc.register(req.body, {
      id: null,
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });
    successResponse(res, null, 'OTP sent to email');
  } catch (err) {
    next(err);
  }
};

exports.verifyOtp = async (req, res, next) => {
  try {
    const token = await authSvc.verifyOtp(req.body, {
      id: null,
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });
    successResponse(res, { token }, 'OTP verified');
  } catch (err) {
    next(err);
  }
};

exports.completeProfile = async (req, res, next) => {
  try {
    const { user, tokens } = await authSvc.completeProfile(
      req.user.id, 
      req.body,
      { id: req.user.id, ip: req.ip, userAgent: req.headers['user-agent'] }
    );
    successResponse(res, { user, ...tokens }, 'Profile complete');
  } catch (err) {
    next(err);
  }
};

exports.login = async (req, res, next) => {
  try {
    // Pass userContext to the service so it can log/audit correctly
    const { user, tokens } = await authSvc.login(
      {
        identifier: req.body.identifier,
        password: req.body.password
      },
      {
        // id is not needed for audit here since service uses found user._id
        id: null,
        ip: req.ip,
        userAgent: req.headers['user-agent'] || ''
      }
    );

    // Return both user and tokens to the client
    successResponse(res, { user, ...tokens }, 'Login successful');
  } catch (err) {
    next(err);
  }
};

exports.refreshToken = async (req, res, next) => {
  try {
    const tokens = await authSvc.refreshToken(req.body);
    successResponse(res, tokens, 'Token refreshed');
  } catch (err) {
    next(err);
  }
};

exports.logout = async (req, res, next) => {
  try {
    await authSvc.revokeRefreshToken(req.body.refreshToken, req.user.id);
    successResponse(res, null, 'Logged out');
  } catch (err) {
    next(err);
  }
};

exports.logoutAll = async (req, res, next) => {
  try {
    await authSvc.revokeAllSessions(req.user.id);
    successResponse(res, null, 'All sessions revoked');
  } catch (err) {
    next(err);
  }
};

exports.forgotPassword = async (req, res, next) => {
  try {
    await authSvc.forgotPassword(req.body.identifier, {
      id: null,
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });
    successResponse(res, null, 'If an account exists, a reset OTP has been sent to your email.');
  } catch (err) {
    next(err);
  }
};

exports.verifyReset = async (req, res, next) => {
  try {
    console.log('Verify reset request body:', req.body);
    await authSvc.verifyResetOtp(req.body, {
      id: null,
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });
    successResponse(res, null, 'OTP verified. You may now set a new password.');
  } catch (err) {
    next(err);
  }
};

exports.resetPassword = async (req, res, next) => {
  try {
    console.log('🔐 Reset password request body:', {
      identifier: req.body.identifier,
      otp: req.body.otp,
      hasNewPassword: !!req.body.newPassword,
      hasConfirmPassword: !!req.body.confirmPassword
    });
    await authSvc.resetPassword(req.body, {
      id: null,
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });
    successResponse(res, null, 'Your password has been reset successfully.');
  } catch (err) {
    next(err);
  }
};

/**
 * Get JWT configuration info
 * Workplan Line 622: JWT RS256 support
 * Useful for debugging and monitoring JWT migration
 */
exports.getJwtInfo = async (req, res, next) => {
  try {
    const info = jwtUtil.getInfo();
    successResponse(res, info, 'JWT configuration retrieved');
  } catch (err) {
    next(err);
  }
};

/**
 * Resend OTP (Workplan Line 32: Session progress saving)
 */
exports.resendOtp = async (req, res, next) => {
  try {
    await authSvc.resendOtp(req.body, {
      id: null,
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });
    successResponse(res, null, 'OTP resent to email');
  } catch (err) {
    next(err);
  }
};