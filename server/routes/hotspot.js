const express = require('express');
const router = express.Router();

const {
  getHotspotServers,
  getHotspotProfiles
} = require('../controllers/mikrotikController');

const {
  getAvailableHotspotPlans,
  prepareCheckout,
  confirmPaymentAndGrantAccess,
  getReceipt,
  connectHotspotUser 
} = require('../controllers/hotspotController');

router.get('/servers', getHotspotServers);
router.get('/profiles', getHotspotProfiles);
router.get('/available-plans', getAvailableHotspotPlans);
router.post('/prepare-checkout', prepareCheckout);
router.post('/confirm-access', confirmPaymentAndGrantAccess);
router.get('/receipt/:txnId', getReceipt);
router.post('/connect', connectHotspotUser); 

module.exports = router;
