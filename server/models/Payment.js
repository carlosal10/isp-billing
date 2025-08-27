const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  accountNumber: { type: String, required: true, trim: true },
  phoneNumber: { type: String, required: true, trim: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  plan: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', required: true },
  amount: { type: Number, required: true, min: [0, 'Amount cannot be negative'] },
  transactionId: { type: String, trim: true },
  method: { type: String, enum: ['mpesa', 'manual', 'stripe', 'PayPal'], required: true },
  status: { type: String, enum: ['Pending', 'Success', 'Failed'], default: 'Pending' },
  expiryDate: { type: Date },
  
  // 🔹 Manual validation audit fields
  validatedBy: { type: String, trim: true }, // admin who validated
  validatedAt: { type: Date },
  notes: { type: String, trim: true }, // optional remarks

  createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('Payment', paymentSchema);
