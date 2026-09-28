'use strict';

const rateLimit = require('express-rate-limit');
const { MongoRateLimitStore } = require('../security/mongoRateLimitStore');

function createRiskLimiter({ limit, message, windowMs }) {
  return rateLimit({
    store: new MongoRateLimitStore(message),
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler(req, res) {
      return res.status(429).json({
        ok: false,
        error: message,
        requestId: req.id || null,
      });
    },
  });
}

const loginLimiter = createRiskLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  message: 'Too many sign-in attempts. Try again later.',
});

const registrationLimiter = createRiskLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  message: 'Too many registration attempts. Try again later.',
});

const refreshLimiter = createRiskLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  message: 'Too many session refresh attempts. Try again later.',
});

const paymentInitiationLimiter = createRiskLimiter({
  windowMs: 5 * 60 * 1000,
  limit: 20,
  message: 'Too many payment attempts. Try again later.',
});

module.exports = {
  createRiskLimiter,
  loginLimiter,
  paymentInitiationLimiter,
  refreshLimiter,
  registrationLimiter,
};
