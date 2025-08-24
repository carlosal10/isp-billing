const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
    accountNumber: { 
        type: String, 
        required: true, 
        trim: true 
    },
    phoneNumber: { 
        type: String, 
        required: true, 
        trim: true 
    },
    customer: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Customer',
        required: true 
    },
    amount: { 
        type: Number, 
        required: true,
        min: [0, 'Amount cannot be negative'] // Ensures no negative payments
    },
    transactionId: { 
        type: String, 
        trim: true 
    },
    status: { 
        type: String, 
        enum: ['Pending', 'Success', 'Failed'], 
        default: 'Pending'
    },
    createdAt: { 
        type: Date, 
        default: Date.now 
    }
}, { timestamps: true }); // Automatically adds 'createdAt' and 'updatedAt'

module.exports = mongoose.model('Payment', paymentSchema);
