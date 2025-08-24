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
}, { timestamps: true });

module.exports = mongoose.model('Plan', planSchema);

