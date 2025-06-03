const mongoose = require("mongoose");

const customerSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    phone: { type: String, required: true },
    address: { type: String },
    accountNumber: { type: String, required: true, unique: true },
    plan: { type: mongoose.Schema.Types.ObjectId, ref: "Plan", required: true },
    routerIp: { type: String },
    createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Customer", customerSchema);
