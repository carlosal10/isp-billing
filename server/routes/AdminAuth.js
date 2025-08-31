//routes/AdminAuth.js
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const AdminUser = require('../models/AdminUser');

// Register a new admin user
router.post('/register', async (req, res) => {
    const { username, email, password } = req.body;

    try {
        const existingUser = await AdminUser.findOne({ email });
        if (existingUser) return res.status(400).json({ message: 'Email already in use' });

        const adminUser = new AdminUser({ username, email, password });
        await adminUser.save();
        res.status(201).json({ message: 'Admin user registered successfully' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Admin login
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const adminUser = await AdminUser.findOne({ email });
        if (!adminUser) return res.status(400).json({ message: 'Invalid email or password' });

        const isMatch = await adminUser.comparePassword(password);
        if (!isMatch) return res.status(400).json({ message: 'Invalid email or password' });

        const token = jwt.sign(
            { id: adminUser._id, username: adminUser.username },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        res.json({ token });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Verify token (middleware)
router.get('/verify', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) return res.status(401).json({ message: 'No token provided' });

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) return res.status(401).json({ message: 'Invalid token' });
        res.json({ message: 'Token is valid', user: decoded });
    });
});

module.exports = router;
