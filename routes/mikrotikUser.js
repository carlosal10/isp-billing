const express = require('express');
const router = express.Router();
const mikrotikClient = require('./mikrotikclient');

// Create a new PPPoE user
router.post('/', async (req, res) => {
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

// Remove PPPoE user by username
router.delete('/remove/:username', async (req, res) => {
    const { username } = req.params;

    try {
        const users = await mikrotikClient.write('/ppp/secret/print', [
            '?name=' + username
        ]);

        if (!users.length) {
            return res.status(404).json({ message: 'User not found' });
        }

        const userId = users[0]['.id'];

        const result = await mikrotikClient.write('/ppp/secret/remove', [
            '=.id=' + userId
        ]);

        res.status(200).json({ message: 'User removed successfully', result });
    } catch (error) {
        console.error('Error removing user:', error);
        res.status(500).json({ message: 'Failed to remove user from MikroTik' });
    }
});

// Update PPPoE user password
router.put('/update/:username', async (req, res) => {
    const { username } = req.params;
    const { password } = req.body;

    if (!password) {
        return res.status(400).json({ message: 'New password is required' });
    }

    try {
        const users = await mikrotikClient.write('/ppp/secret/print', [
            '?name=' + username
        ]);

        if (!users.length) {
            return res.status(404).json({ message: 'User not found' });
        }

        const userId = users[0]['.id'];

        const result = await mikrotikClient.write('/ppp/secret/set', [
            '=.id=' + userId,
            '=password=' + password
        ]);

        res.status(200).json({ message: 'Password updated successfully', result });
    } catch (error) {
        console.error('Error updating password:', error);
        res.status(500).json({ message: 'Failed to update password' });
    }
});

// GET /api/pppoe/list
router.get('/list', async (req, res) => {
    try {
        const result = await mikrotikClient.write('/ppp/secret/print');
        res.status(200).json({ message: 'PPPoE users fetched successfully', users: result });
    } catch (error) {
        console.error('Error fetching PPPoE users:', error);
        res.status(500).json({ message: 'Failed to fetch PPPoE users from MikroTik' });
    }
});

// GET /api/pppoe/online
router.get('/online', async (req, res) => {
    try {
        const result = await mikrotikClient.write('/ppp/active/print');
        res.status(200).json({ message: 'Online users fetched', users: result });
    } catch (error) {
        console.error('Error fetching online users:', error);
        res.status(500).json({ message: 'Failed to fetch online PPPoE users' });
    }
});


module.exports = router;

