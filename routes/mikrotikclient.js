const express = require('express');
const { RouterOSAPI } = require('routeros-client');
const router = express.Router();

router.post('/', async (req, res) => {
    const { ip, username, password } = req.body;

    if (!ip || !username || !password) {
        return res.status(400).json({ message: 'All fields are required' });
    }

    // Create new RouterOS API client for each request
    const mikrotikClient = new RouterOSAPI({
        host: ip,
        user: username,
        password: password,
        port: 8728,  // Default API port
        timeout: 30000
    });

    try {
        // Attempt to connect to the router
        await mikrotikClient.connect();
        console.log('Connected to MikroTik router at:', ip);
        
        // Fetch system identity as a test command
        const identity = await mikrotikClient.write('/system/identity/print');
        console.log('System Identity:', identity);
        
        // Send successful response to frontend
        res.status(200).json({
            message: `Successfully connected to ${identity[0].name}`,
            router: identity
        });

        // Close connection after operation
        mikrotikClient.close();
    } catch (error) {
        console.error('Failed to connect to MikroTik:', error.message);
        res.status(500).json({
            message: 'Failed to connect to MikroTik',
            error: error.message
        });
    }
});

module.exports = router;

