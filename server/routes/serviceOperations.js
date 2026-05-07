'use strict';

const express = require('express');
const requireRole = require('../middleware/requireRole');
const {
  getServiceOperationsSummary,
  listInventoryAssets,
  createInventoryAsset,
  updateInventoryAsset,
  assignAssetToCustomer,
  unassignAssetFromCustomer,
  listIpPools,
  createIpPool,
  updateIpPool,
  listIpAssignments,
  allocateIpAddress,
  releaseIpAssignment,
} = require('../services/serviceOperationsService');

const router = express.Router();

function requestActor(req) {
  return {
    id: String(req.user?.email || req.user?.sub || req.user?.id || req.user?._id || ''),
    email: req.user?.email || null,
    role: req.role || (req.user?.isPlatformAdmin ? 'platform-admin' : null),
  };
}

router.get('/summary', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const summary = await getServiceOperationsSummary(req.tenantId);
    return res.json(summary);
  } catch (err) {
    console.error('service ops summary error:', err);
    return res.status(500).json({ error: 'Failed to load service operations summary' });
  }
});

router.get('/assets', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const assets = await listInventoryAssets(req.tenantId, req.query);
    return res.json(assets);
  } catch (err) {
    console.error('service ops assets list error:', err);
    return res.status(500).json({ error: 'Failed to load inventory assets' });
  }
});

router.post('/assets', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const asset = await createInventoryAsset(req.tenantId, req.body, requestActor(req));
    return res.status(201).json({ ok: true, asset });
  } catch (err) {
    console.error('service ops asset create error:', err);
    return res.status(err?.statusCode || 500).json({ error: err?.message || 'Failed to create asset' });
  }
});

router.put('/assets/:id', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const asset = await updateInventoryAsset(req.tenantId, req.params.id, req.body, requestActor(req));
    return res.json({ ok: true, asset });
  } catch (err) {
    console.error('service ops asset update error:', err);
    return res.status(err?.statusCode || 500).json({ error: err?.message || 'Failed to update asset' });
  }
});

router.post('/assets/:id/assign-customer', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const asset = await assignAssetToCustomer(req.tenantId, req.params.id, req.body, requestActor(req));
    return res.json({ ok: true, asset });
  } catch (err) {
    console.error('service ops asset assign error:', err);
    return res.status(err?.statusCode || 500).json({ error: err?.message || 'Failed to assign asset' });
  }
});

router.post('/assets/:id/unassign-customer', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const asset = await unassignAssetFromCustomer(req.tenantId, req.params.id, req.body, requestActor(req));
    return res.json({ ok: true, asset });
  } catch (err) {
    console.error('service ops asset unassign error:', err);
    return res.status(err?.statusCode || 500).json({ error: err?.message || 'Failed to unassign asset' });
  }
});

router.get('/ip-pools', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const pools = await listIpPools(req.tenantId, req.query);
    return res.json(pools);
  } catch (err) {
    console.error('service ops ip pools list error:', err);
    return res.status(500).json({ error: 'Failed to load IP pools' });
  }
});

router.post('/ip-pools', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const pool = await createIpPool(req.tenantId, req.body, requestActor(req));
    return res.status(201).json({ ok: true, pool });
  } catch (err) {
    console.error('service ops ip pool create error:', err);
    return res.status(err?.statusCode || 500).json({ error: err?.message || 'Failed to create IP pool' });
  }
});

router.put('/ip-pools/:id', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const pool = await updateIpPool(req.tenantId, req.params.id, req.body, requestActor(req));
    return res.json({ ok: true, pool });
  } catch (err) {
    console.error('service ops ip pool update error:', err);
    return res.status(err?.statusCode || 500).json({ error: err?.message || 'Failed to update IP pool' });
  }
});

router.get('/ip-assignments', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const assignments = await listIpAssignments(req.tenantId, req.query);
    return res.json(assignments);
  } catch (err) {
    console.error('service ops ip assignments list error:', err);
    return res.status(500).json({ error: 'Failed to load IP assignments' });
  }
});

router.post('/ip-pools/:id/allocate', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const assignment = await allocateIpAddress(req.tenantId, req.params.id, req.body, requestActor(req));
    return res.status(201).json({ ok: true, assignment });
  } catch (err) {
    console.error('service ops ip allocate error:', err);
    return res.status(err?.statusCode || 500).json({ error: err?.message || 'Failed to allocate IP address' });
  }
});

router.post('/ip-assignments/:id/release', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const assignment = await releaseIpAssignment(req.tenantId, req.params.id, req.body, requestActor(req));
    return res.json({ ok: true, assignment });
  } catch (err) {
    console.error('service ops ip release error:', err);
    return res.status(err?.statusCode || 500).json({ error: err?.message || 'Failed to release IP assignment' });
  }
});

module.exports = router;
