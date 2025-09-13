const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, required: true },
    actor: { type: String, default: null }, // user id/email if available
    action: { type: String, required: true },
    routerHost: { type: String, default: null },
    payload: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

module.exports = mongoose.model('AuditLog', AuditLogSchema);

