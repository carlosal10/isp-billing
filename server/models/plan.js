// models/plan.js
const mongoose = require('mongoose');

// Parse helpers (accepts "30", "30 days", "monthly", etc.)
function parseDurationToDays(v) {
  if (v == null) return NaN;
  if (typeof v === 'number') return v;
  const s = String(v).trim().toLowerCase();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const m = s.match(/(\d+(\.\d+)?)\s*(day|week|month|year)s?/);
  if (m) {
    const n = parseFloat(m[1]);
    const u = m[3];
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

const planSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    description: { type: String, default: 'No description provided' },

    // store numeric fields as numbers
    price: { type: Number, required: true, min: 0 },
    durationDays: { type: Number, required: true, min: 1 }, // ← numeric days
    speed: { type: Number, required: true, min: 1 },        // Mbps

    // e.g. "10M/10M"
    rateLimit: {
      type: String,
      required: true,
      trim: true,
      // simple sanity check (optional)
      match: [/^\d+(?:[kKmMgG])?\/\d+(?:[kKmMgG])?$/, 'Invalid rateLimit format'],
    },

    dataCap: { type: Number, default: null }, // GB
    // optional human label preserved (nice for UI)
    durationLabel: { type: String, default: null },
  },
  { timestamps: true }
);

// Input convenience: allow sending "duration" (string/number) and auto-fill durationDays
planSchema.pre('validate', function (next) {
  // if api provided durationDays directly, keep it
  if (this.isModified('durationDays')) return next();

  // accept "duration" in payloads for compatibility
  if (this.isModified('duration') || this.duration != null) {
    const days = parseDurationToDays(this.duration);
    if (!Number.isFinite(days) || days <= 0) {
      return next(new Error('Invalid duration (cannot parse to days)'));
    }
    this.durationDays = days;
    if (!this.durationLabel) this.durationLabel = String(this.duration);
    // don’t persist legacy field
    this.set('duration', undefined, { strict: false });
  }
  next();
});

// Nice-to-have: computed props in responses
planSchema.set('toObject', { virtuals: true });
planSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    ret.priceFormatted = `${ret.price} KSH`;
    return ret;
  },
});

module.exports = mongoose.model('Plan', planSchema);
