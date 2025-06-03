const mongoose = require('mongoose');

const usageLogSchema = new mongoose.Schema({
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    dataUsed: { type: Number, required: true }, // in GB
    loggedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('UsageLog', usageLogSchema);
