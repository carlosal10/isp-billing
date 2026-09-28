'use strict';
const cron = require('node-cron');
const { processAccessOutbox } = require('../services/accessOutboxService');
let running = false;
cron.schedule('* * * * *', async () => {
  if (running) return;
  running = true;
  try { await processAccessOutbox(); }
  catch { console.error('[access-recovery] Worker failed; queued work remains recoverable'); }
  finally { running = false; }
});
