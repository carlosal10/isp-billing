'use strict';
const Event = require('../models/UsageEvent');
const Counter = require('../models/UsageCounter');
const { financialTransaction } = require('./financialTransaction');
async function initializeUsageEvents(counter) {
  if (!counter || counter.eventsInitialized) return;
  const end = new Date(+counter.bucketStart + 86400000);
  const events = await Event.find({tenantId:counter.tenantId,routerId:counter.routerId,sessionKey:counter.sessionKey,occurredAt:{$gte:counter.bucketStart,$lt:end}}).select('uploadBytes downloadBytes').lean();
  const sums=events.reduce((n,e)=>({up:n.up+BigInt(e.uploadBytes),down:n.down+BigInt(e.downloadBytes)}),{up:0n,down:0n});
  const up=BigInt(counter.inputBytes||'0')-sums.up, down=BigInt(counter.outputBytes||'0')-sums.down;
  if(up>0n||down>0n) await Event.create({
    tenantId:counter.tenantId,routerId:counter.routerId,assignmentId:counter.assignmentId,customerId:counter.customerId,
    sessionKey:counter.sessionKey,source:'radius',occurredAt:counter.lastEventAt||counter.bucketStart,
    uploadBytes:(up>0n?up:0n).toString(),downloadBytes:(down>0n?down:0n).toString(),
    legacyBucket:true,
  });
  counter.eventsInitialized=true;
  await counter.save();
}
async function backfillLegacyUsage(tenantId) {
  let migrated=0;
  for (;;) {
    const batch=await Counter.find({eventsInitialized:{$ne:true}, ...(tenantId ? {tenantId} : {})}).sort({_id:1}).limit(100).select('_id').lean();
    if(!batch.length) break;
    for(const item of batch) await financialTransaction(async()=>{
      const counter=await Counter.findById(item._id);
      await initializeUsageEvents(counter); migrated++;
    });
  }
  return {migrated};
}
module.exports={initializeUsageEvents,backfillLegacyUsage};
