const mongoose = require('mongoose');

const DailyUsageSchema = new mongoose.Schema({
  date: { type: Date, required: true, unique: true },
  activeUsersCount: { type: Number, default: 0 },
  usagePerUser: [
    {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      bytesIn: { type: Number, default: 0 },
      bytesOut: { type: Number, default: 0 },
    },
  ],
});

module.exports = mongoose.model('DailyUsage', DailyUsageSchema);
