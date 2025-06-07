const express = require('express');
const router = express.Router();
const {
  getHotspotServers,
  getHotspotProfiles
} = require('../controllers/mikrotikController');

router.get('/servers', getHotspotServers);
router.get('/profiles', getHotspotProfiles);
router.get('/available-plans', getAvailableHotspotPlans);


module.exports = router;
