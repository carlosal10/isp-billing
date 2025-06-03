const express = require('express');
const router = express.Router();
const mikrotikClient = require('./mikrotikclient');

// Create a new user on MikroTik
router.post('/add', async (req, res) => {
    const { username, password, profile } = req.body;

    if (!username || !password || !profile) {
        return res.status(400).json({ message: 'Username, password, and profile are required' });
    }

    try {
        const result = await mikrotikClient.write('/ppp/secret/add', [
            '=name=' + username,
            '=password=' + password,
            '=service=pppoe',
            '=profile=' + profile
        ]);

        res.status(201).json({ message: 'User added successfully', result });
    } catch (error) {
        console.error('Error adding user:', error);
        res.status(500).json({ message: 'Failed to add user to MikroTik' });
    }
});

// Remove user from MikroTik
router.delete('/remove/:username', async (req, res) => {
    const { username } = req.params;

    try {
        const result = await mikrotikClient.write('/ppp/secret/remove', [
            '?.name=' + username
        ]);

        res.status(200).json({ message: 'User removed successfully', result });
    } catch (error) {
        console.error('Error removing user:', error);
        res.status(500).json({ message: 'Failed to remove user from MikroTik' });
    }
});

// Update user password
router.put('/update/:username', async (req, res) => {
    const { username } = req.params;
    const { password } = req.body;

    if (!password) {
        return res.status(400).json({ message: 'New password is required' });
    }

    try {
        const result = await mikrotikClient.write('/ppp/secret/set', [
            '=password=' + password,
            '?.name=' + username
        ]);

        res.status(200).json({ message: 'Password updated successfully', result });
    } catch (error) {
        console.error('Error updating password:', error);
        res.status(500).json({ message: 'Failed to update password' });
    }
});


module.exports = router;
