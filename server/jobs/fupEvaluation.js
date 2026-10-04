'use strict';
const { scheduleJob } = require('../utils/scheduler');
const NetworkAssignment = require('../models/NetworkAssignment');
const { evaluateFup } = require('../services/fupEvaluationService');
scheduleJob({ name: 'fup-evaluation', cronExpr: process.env.FUP_EVALUATION_CRON || '*/5 * * * *', noOverlap: true, task: async () => { const assignments = await NetworkAssignment.find({ fupPolicyId: { $ne: null }, status: { $in: ['active', 'suspended'] } }).select('_id tenantId').limit(1000).lean(); for (const assignment of assignments) await evaluateFup({ tenantId: assignment.tenantId, assignmentId: assignment._id }); return { evaluated: assignments.length }; } });
