'use strict';

let registered = false;

function registerJobs() {
  if (registered) return;
  registered = true;

  require('./exports');
  require('./historyRetention');
  require('./smsReminders');

  if (String(process.env.LEGACY_ENFORCEMENT_JOBS || 'false').toLowerCase() === 'true') {
    const { registerExpireAccessJob } = require('./expireAccess');
    registerExpireAccessJob();
    require('./expireStatic');
    require('./enforceInactiveCustomers');
    console.log('[jobs] registered legacy enforcement jobs');
    return;
  }

  require('./enforceAllExpired');
  console.log('[jobs] registered unified enforcement job');
}

registerJobs();

module.exports = { registerJobs };
