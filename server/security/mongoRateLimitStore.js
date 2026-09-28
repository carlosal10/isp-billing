'use strict';
const mongoose = require('mongoose');
const crypto = require('node:crypto');
const schema = new mongoose.Schema({ _id: String, hits: Number, expiresAt: { type: Date, index: { expires: 0 } } });
const Counter = mongoose.models.RiskCounter || mongoose.model('RiskCounter', schema);
class MongoRateLimitStore {
  constructor(namespace) { this.namespace = namespace; this.localKeys = false; }
  init(options) { this.windowMs = options.windowMs; }
  key(key) {
    const window = Math.floor(Date.now() / this.windowMs);
    return `${this.namespace}:${window}:${crypto.createHash('sha256').update(key).digest('hex')}`;
  }
  async increment(key) {
    const resetTime = new Date((Math.floor(Date.now() / this.windowMs) + 1) * this.windowMs);
    const filter = { _id: this.key(key) };
    const update = { $inc: { hits: 1 }, $setOnInsert: { expiresAt: resetTime } };
    let row;
    try { row = await Counter.findOneAndUpdate(filter, update, { upsert: true, new: true }).lean(); }
    catch (err) { if (err.code !== 11000) throw err; row = await Counter.findOneAndUpdate(filter, { $inc: { hits: 1 } }, { new: true }).lean(); }
    return { totalHits: row.hits, resetTime: row.expiresAt };
  }
  async decrement(key) { await Counter.updateOne({ _id: this.key(key), hits: { $gt: 0 } }, { $inc: { hits: -1 } }); }
  async resetKey(key) { await Counter.deleteOne({ _id: this.key(key) }); }
}
module.exports = { MongoRateLimitStore };
