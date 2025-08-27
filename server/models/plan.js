const mongoose = require('mongoose');

const planSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true,
    },
    description: {
        type: String,
        required: true,
    },
    price: {
        type: Number,
        required: true,
    },
    duration: {
        type: String,  // e.g., 'monthly', 'yearly'
        required: true,
    },
    speed: {
        type: Number, // in Mbps, e.g., 10 for 10Mbps
        required: true,
    },
    rateLimit: {
        type: String, // e.g., '10M/10M' for MikroTik
        required: true,
    },
    dataCap: {
        type: Number, // Optional, in GB
        default: null,
    }
}, { timestamps: true });

module.exports = mongoose.model('Plan', planSchema);
