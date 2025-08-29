// models/plan.js
const mongoose = require('mongoose');

function parseDurationToDays(v) {
  if (v == null) return NaN;
  if (typeof v === 'number') return v;
  const s = String(v).trim().toLowerCase();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const m = s.match(/(\d+(\.\d+)?)\s*(day|week|month|year)s?/);
  if (m) {
    const n = parseFloat(m[1]); const u = m[3];
    if (u === 'day') return n;
    if (u === 'week') return n * 7;
    if (u === 'month') return n * 30;
    if (u === 'year') return n * 365;
  }
  if (s === 'monthly' || s === 'month') return 30;
  if (s === 'weekly' || s === 'week') return 7;
  if (s === 'yearly' || s === 'annual' || s === 'year') return 365;
  const num = parseFloat(s.replace(/[^\d.]/g, ''));
  return Number.isFinite(num) ? num : NaN;
}

const planSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true },
  description: { type: String, required: true },
  price: { type: Number, required: true },
  duration: { type: String, required: true }, // keep your current field
  speed: { type: Number, required: true },
  rateLimit: { type: String, required: true, trim: true },
  dataCap: { type: Number, default: null },
}, { timestamps: true });

// NEW: numeric days derived from your string
planSchema.virtual('durationDays').get(function () {
  return parseDurationToDays(this.duration);
});

module.exports = mongoose.model('Plan', planSchema);
