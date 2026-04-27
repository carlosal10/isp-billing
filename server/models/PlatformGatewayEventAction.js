'use strict';

const mongoose = require('mongoose');

const PlatformGatewayEventActionSchema = new mongoose.Schema(
  {
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PaymentGatewayEvent',
      required: true,
      index: true,
    },
    actor: { type: String, default: null, trim: true, index: true },
    actorDisplay: { type: String, default: null, trim: true },
    action: { type: String, required: true, trim: true, index: true },
    note: { type: String, default: null, trim: true },
    ok: { type: Boolean, default: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
  }
);

PlatformGatewayEventActionSchema.index({ eventId: 1, createdAt: -1 });

module.exports = mongoose.model(
  'PlatformGatewayEventAction',
  PlatformGatewayEventActionSchema
);
