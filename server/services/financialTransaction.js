'use strict';
const mongoose = require('mongoose');
const { AsyncLocalStorage } = require('node:async_hooks');
// Propagate the session to every query, save, aggregate, and insertMany in the unit of work.
mongoose.set('transactionAsyncLocalStorage', true);
const scope = new AsyncLocalStorage();
function financialTransaction(work) {
  if (scope.getStore()) return work();
  return mongoose.connection.transaction(() => scope.run(true, work), {
    readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' },
  });
}
const transactional = (work) => (...args) => financialTransaction(() => work(...args));
module.exports = { financialTransaction, transactional };
