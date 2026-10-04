'use strict';
const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { configureTestEnvironment, createTestDatabase } = require('../testing/environment');
configureTestEnvironment();
const mongoose = require('mongoose'), oid = () => new mongoose.Types.ObjectId();
const A = require('../models/NetworkAssignment'), P = require('../models/FupPolicy'), S = require('../models/FupState');
const O = require('../models/NetworkOperation'), E = require('../models/UsageEvent'), N = require('../models/FupNotice');
const R = require('../models/RadiusServer'), Router = require('../models/MikrotikConnection');
const { evaluateFup } = require('../services/fupEvaluationService');
const { processFupOperations } = require('../services/fupOperationService');
const { radiusPolicy, acknowledgeRadiusPolicy } = require('../services/radiusFupService');
const { ingestAccounting } = require('../services/radiusAccountingService');
const { pollStaticUsage } = require('../services/staticUsageService');
let db, server;
before(async () => {
 db = await createTestDatabase(); await mongoose.connect(process.env.MONGO_URI);
 for (const model of Object.values(mongoose.models)) await model.init();
}, { timeout:180000 });
after(async()=>{ if(server) await new Promise(resolve=>server.close(resolve)); await mongoose.disconnect(); if(db) await db.stop(); });
async function fixture(extra={}) {
 const tenantId=oid(), routerId=oid(), customerId=oid();
 const p=await P.create({tenantId,name:'Home',includedBytes:'100',hardBlockPercent:120,...extra});
 const a=await A.create({tenantId,routerId,customerId,accessType:'pppoe',username:'alice',status:'active',desiredState:'present',fupPolicyId:p._id});
 return {tenantId,p,a};
}
async function event(f,bytes,when='2026-10-10T00:00:00Z') {
 return E.create({tenantId:f.tenantId,routerId:f.a.routerId,assignmentId:f.a._id,customerId:f.a.customerId,sessionKey:'test',source:'radius',occurredAt:new Date(when),uploadBytes:bytes,downloadBytes:'0'});
}
const run=f=>evaluateFup({tenantId:f.tenantId,assignmentId:f.a._id,now:new Date('2026-10-15T00:00:00Z')});
test('evaluation is atomic and idempotent; warning and hard block thresholds create notices',async()=>{
 const f=await fixture();await event(f,'80');
 assert.equal((await run(f)).state,'warned');
 await event(f,'20');assert.equal((await run(f)).state,'throttled');
 await run(f);await run(f);
 assert.equal(await O.countDocuments({tenantId:f.tenantId,'desiredState.fupState':'throttled'}),1);
 await event(f,'20');assert.equal((await run(f)).state,'blocked');
 assert.equal(await N.countDocuments({tenantId:f.tenantId}),3);
 const a=await A.findById(f.a._id);assert.equal(a.fup.applied,'normal');
 const state=await S.findOne({tenantId:f.tenantId});assert.equal(state.appliedAt,undefined);
});
test('monthly reset restores a previous month and stale operations are skipped',async()=>{
 const f=await fixture();await event(f,'110');await run(f);
 await A.updateOne({_id:f.a._id},{$set:{'fup.applied':'throttled'}});
 const next=await evaluateFup({tenantId:f.tenantId,assignmentId:f.a._id,now:new Date('2026-10-31T21:01:00Z')});
 assert.equal(next.desired,'normal');
 const ops=await O.find({tenantId:f.tenantId}).sort({createdAt:1});
 assert.equal(ops.at(-1).operationType,'fup.restore');
 await O.updateMany({tenantId:{$ne:f.tenantId}},{$set:{status:'complete'}});
 let calls=0;
 const summary=await processFupOperations({enforce:async()=>{calls++;return {verified:true,fupState:'normal'};}});
 assert.equal(summary.superseded,1);assert.equal(calls,1);
 assert.equal((await A.findById(f.a._id)).fup.applied,'normal');
});
test('rolling windows expire old usage; override expiry and repeated transitions get new generations',async()=>{
 const f=await fixture({period:'rolling-30d'});await event(f,'110','2026-09-01Z');
 assert.equal((await run(f)).desired,'normal');
 await event(f,'110'); const throttled=await run(f);assert.equal(throttled.desired,'throttled');
 await A.updateOne({_id:f.a._id},{$set:{'fup.overrideUntil':new Date('2026-10-16Z')}});
 const over=await run(f);assert.equal(over.state,'overridden');assert.equal(over.desired,'normal');
 const again=await evaluateFup({tenantId:f.tenantId,assignmentId:f.a._id,now:new Date('2026-10-17Z')});
 assert.equal(again.desired,'throttled');assert.ok(again.generation>throttled.generation);
});
test('disabled and removed policy restore while preserving billing suspension',async()=>{
 const f=await fixture();await event(f,'120');await run(f);
 await P.updateOne({_id:f.p._id},{$set:{enabled:false}});
 assert.equal((await run(f)).desired,'normal');
 await A.updateOne({_id:f.a._id},{$set:{desiredState:'suspended',status:'suspended',fupPolicyId:null}});
 await run(f); const a=await A.findById(f.a._id);assert.equal(a.status,'suspended');assert.equal(a.desiredState,'suspended');
});
test('failed router writes never mark enforcement applied or damage billing state',async()=>{
 const f=await fixture();await event(f,'110');await run(f);
 await O.updateMany({tenantId:{$ne:f.tenantId}},{$set:{status:'complete'}});
 const summary=await processFupOperations({limit:1,enforce:async()=>{throw new Error('secret-do-not-store');}});
 assert.equal(summary.retried,1);
 const a=await A.findById(f.a._id);assert.equal(a.fup.applied,'normal');assert.equal(a.status,'active');
 const op=await O.findOne({tenantId:f.tenantId});assert.equal(op.status,'pending');assert.ok(!op.lastError.includes('secret-do-not-store'));
});
test('RADIUS cannot acknowledge another tenant or an obsolete generation',async()=>{
 const f=await fixture();const radius=await R.create({tenantId:f.tenantId,name:'Radius',host:'10.1.1.2',sharedSecret:'test-secret',fupIntegration:'rest'});
 await A.updateOne({_id:f.a._id},{$set:{authenticationMode:'radius',radiusServerId:radius._id}});
 await event(f,'110');const result=await run(f);
 const overlay=await radiusPolicy(f.tenantId,String(f.a.routerId),'alice');
 assert.equal(overlay.reply['Mikrotik-Rate-Limit'],'512K/2M');assert.equal(overlay.decision,'continue');
 await assert.rejects(()=>acknowledgeRadiusPolicy(oid(),String(f.a._id),result.generation),/stale/);
 await assert.rejects(()=>acknowledgeRadiusPolicy(f.tenantId,String(f.a._id),result.generation+1),/stale/);
 await acknowledgeRadiusPolicy(f.tenantId,String(f.a._id),result.generation);
 assert.equal((await O.findOne({tenantId:f.tenantId})).desiredState.radiusAcknowledged,true);
 await A.updateOne({_id:f.a._id},{$set:{desiredState:'suspended'}});
 assert.equal((await radiusPolicy(f.tenantId,String(f.a.routerId),'alice')).decision,'reject');
});
test('RADIUS accounting atomically records exact deltas without double charging duplicates',async()=>{
 const f=await fixture({includedBytes:'18446744073709551615'});
 await Router.create({_id:f.a.routerId,tenant:f.tenantId,name:'r',host:'10.0.0.2',username:'api',password:'test-secret'});
 const input={routerId:String(f.a.routerId),sessionKey:'session',username:'alice',event:'interim',occurredAt:new Date().toISOString(),sessionSeconds:60,uploadBytes:'9007199254740993',downloadBytes:'7'};
 await ingestAccounting(f.tenantId,input,oid());await ingestAccounting(f.tenantId,input,oid());
 const events=await E.find({tenantId:f.tenantId});assert.equal(events.length,1);assert.equal(events[0].uploadBytes,input.uploadBytes);
 input.uploadBytes='9007199254740994';await ingestAccounting(f.tenantId,input,oid());
 assert.equal((await E.find({tenantId:f.tenantId})).reduce((n,e)=>n+BigInt(e.uploadBytes),0n),9007199254740994n);
});
test('static counters start at a baseline, record deltas, detect resets and reject unrelated queues',async()=>{
 const f=await fixture();f.a.accessType='static';f.a.ipAddress='10.1.1.5';
 const now=new Date();let bytes='100/200';
 const send=async()=>[{name:'billing-'+f.a._id,target:'10.1.1.5/32',bytes}];
 await pollStaticUsage(f.a,send,now);bytes='150/230';await pollStaticUsage(f.a,send,new Date(+now+1000));
 await pollStaticUsage(f.a,send,new Date(+now+1000));bytes='5/10';
 await pollStaticUsage(f.a,send,new Date(+now+2000));
 const events=await E.find({tenantId:f.tenantId}).sort({occurredAt:1});
 assert.equal(events.length,3);assert.equal(events[1].uploadBytes,'50');assert.equal(events[2].counterReset,true);
});
test('policy routes validate input, roles and foreign assignments',async()=>{
 const express=require('express'), app=express();app.use(express.json());
 app.use((req,res,next)=>{req.tenantId=req.headers['x-test-tenant'];req.user={id:String(oid())};req.membership={role:req.headers['x-test-role']||'admin'};next();});
 app.use('/fup',require('../routes/fupPolicies'));
 server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const f=await fixture();
 const call=(path,body,role='admin')=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','x-test-tenant':String(f.tenantId),'x-test-role':role},body:JSON.stringify(body)});
 assert.equal((await call('/fup',{name:'invalid',includedBytes:'0'})).status,400);
 assert.equal((await call('/fup',{name:'valid',includedBytes:'100'},'operator')).status,403);
 assert.equal((await call('/fup/assignments/'+oid()+'/evaluate',{})).status,404);
 assert.equal((await call('/fup/assignments/'+f.a._id+'/override',{until:'wrong',reason:'x'})).status,400);
 const create=await call('/fup',{name:'valid',includedBytes:'100',resetTimezone:'Africa/Nairobi'});assert.equal(create.status,201);
});
