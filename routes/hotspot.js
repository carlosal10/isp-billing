const express = require('express');
const router = express.Router();

const {
  getHotspotServers,
  getHotspotProfiles
} = require('../controllers/mikrotikController'); // ✅ MikroTik stuff

const {
  getAvailableHotspotPlans,
  prepareCheckout,
  confirmPaymentAndGrantAccess,
  getReceipt
} = require('../controllers/hotspotController'); // ✅ Hotspot flow handlers

router.get('/servers', getHotspotServers);
router.get('/profiles', getHotspotProfiles);
router.get('/available-plans', getAvailableHotspotPlans);
router.post('/prepare-checkout', prepareCheckout);
router.post('/confirm-access', confirmPaymentAndGrantAccess);
router.get('/receipt/:txnId', getReceipt);
// POST: User chooses plan
router.post('/connect', connectHotspotUser);


module.exports = router;
