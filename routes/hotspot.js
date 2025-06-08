const express = require('express');
const router = express.Router();
const {
  getHotspotServers,
  getHotspotProfiles,
  getAvailableHotspotPlans,
  prepareCheckout,
  confirmPaymentAndGrantAccess,
  getReceipt,
} = require('../controllers/mikrotikController');

router.get('/servers', getHotspotServers);
router.get('/profiles', getHotspotProfiles);
router.get('/available-plans', getAvailableHotspotPlans);
router.get('/available-plans', getAvailableHotspotPlans);
router.post('/prepare-checkout', prepareCheckout);
router.post('/confirm-access', confirmPaymentAndGrantAccess);
router.get('/receipt/:txnId', getReceipt);

module.exports = router;
