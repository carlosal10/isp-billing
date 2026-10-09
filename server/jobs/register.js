'use strict';

let registered = false;

function registerJobs() {
  if (registered) return;
  registered = true;

  require('./accessRecovery');
  require('./networkOperations');
  require('./fupEvaluation');
  require('./exports');
  require('./historyRetention');
  require('./privacyRetention');
  require('./recurringBilling');
  require('./billingCollections');
  require('./smsReminders');

  // Customer expiry uses the same access outbox as payment activation.
  require('./enforceAllExpired');
  console.log('[jobs] registered unified enforcement job');
}

registerJobs();

module.exports = { registerJobs };
