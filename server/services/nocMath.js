'use strict';

const INCIDENT_KIND = ['outage', 'degradation', 'maintenance', 'security', 'other'];
const INCIDENT_SEVERITY = ['low', 'medium', 'high', 'critical'];
const INCIDENT_STATUS = ['scheduled', 'open', 'investigating', 'monitoring', 'resolved', 'closed'];

function normalizeIncidentKind(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return INCIDENT_KIND.includes(normalized) ? normalized : 'outage';
}

function normalizeIncidentSeverity(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return INCIDENT_SEVERITY.includes(normalized) ? normalized : 'medium';
}

function normalizeIncidentStatus(kind, value) {
  const normalizedKind = normalizeIncidentKind(kind);
  const normalizedStatus = String(value || '').trim().toLowerCase();
  if (INCIDENT_STATUS.includes(normalizedStatus)) return normalizedStatus;
  return normalizedKind === 'maintenance' ? 'scheduled' : 'open';
}

function isActiveIncidentStatus(status) {
  return ['scheduled', 'open', 'investigating', 'monitoring'].includes(
    normalizeIncidentStatus('outage', status)
  );
}

module.exports = {
  INCIDENT_KIND,
  INCIDENT_SEVERITY,
  INCIDENT_STATUS,
  isActiveIncidentStatus,
  normalizeIncidentKind,
  normalizeIncidentSeverity,
  normalizeIncidentStatus,
};
