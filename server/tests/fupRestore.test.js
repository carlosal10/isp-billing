'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createFupEnforcer } = require('../services/fupEnforcementService');
function simulator(type='pppoe') {
 const root=type==='pppoe'?'/ppp/secret':'/ip/hotspot/user', profiles=type==='pppoe'?'/ppp/profile':'/ip/hotspot/user/profile', active=type==='pppoe'?'/ppp/active':'/ip/hotspot/active';
 const data={ [root]:[{'.id':'*u',name:'alice',profile:'normal',disabled:'no'}], [profiles]:[{'.id':'*p',name:'normal','rate-limit':'5M/20M','local-address':'10.1.1.1'}], [active]:[{'.id':'*s',[type==='pppoe'?'name':'user']:'alice'}] };
 const calls=[];let seq=0,failVerify=false;
 async function send(path, words, context) {
  calls.push({path,words,context});
  assert.equal(context.tenantId,'tenant');assert.equal(context.serverId,'router');
  const base=path.slice(0,path.lastIndexOf('/')), action=path.split('/').at(-1);
  if(action==='print') {
   assert.ok(words.every(w=>w.startsWith('?')),'print filters must be query words');
   let rows=data[base]||[];
   for(const word of words) { const i=word.indexOf('='); rows=rows.filter(r=>String(r[word.slice(1,i)])===word.slice(i+1)); }
   return structuredClone(rows).map(r=>failVerify&&base===root?{...r,profile:'wrong'}:r);
  }
  const v=Object.fromEntries(words.map(w=>{const i=w.indexOf('=',1);return [w.slice(1,i),w.slice(i+1)];}));
  assert.ok(!(base===root&&v['rate-limit']),'rate-limit is a profile property');
  if(action==='add') { const copy=(data[base]||[]).find(r=>r['.id']===v['copy-from'])||{};data[base].push({...copy,...v,'.id':'*new'+ ++seq}); }
  else if(action==='set') Object.assign(data[base].find(r=>r['.id']===v['.id']),v);
  else if(action==='remove') data[base]=data[base].filter(r=>r['.id']!==v['.id']);
  return [];
 }
 return {send,calls,data,root,profiles,active, fail:()=>{failVerify=true;}};
}
test('PPPoE and hotspot use dedicated profiles, preserve shared settings, disconnect, block and restore',async()=>{
 for(const type of ['pppoe','hotspot']) {
  const sim=simulator(type), a={_id:'a',tenantId:'tenant',routerId:'router',accessType:type,authenticationMode:'local',username:'alice',desiredState:'present',status:'active',fup:{}};
  const enforce=createFupEnforcer({send:sim.send,saveBaseline:async(a,b)=>{a.fup.baseline=b;return b;}});
  const result=await enforce(a,{desiredState:{fupState:'throttled',uploadRate:'512K',downloadRate:'2M'}});
  assert.equal(result.fupState,'throttled'); assert.equal(sim.data[sim.profiles][0]['rate-limit'],'5M/20M');
  assert.equal(sim.data[sim.profiles][1]['local-address'],'10.1.1.1');
  assert.equal(sim.data[sim.profiles][1]['rate-limit'],'512K/2M');assert.equal(sim.data[sim.active].length,0);
  await enforce(a,{desiredState:{fupState:'blocked'}});assert.equal(sim.data[sim.root][0].disabled,'yes');
  await enforce(a,{desiredState:{fupState:'normal'}});assert.equal(sim.data[sim.root][0].profile,'normal');assert.equal(sim.data[sim.root][0].disabled,'no');
  a.desiredState='suspended';await enforce(a,{desiredState:{fupState:'normal'}});assert.equal(sim.data[sim.root][0].disabled,'yes','restoration must not undo billing suspension');
 }
});
test('verification failure is surfaced and no user is mutated before durable baseline capture',async()=>{
 const sim=simulator(), a={_id:'a',tenantId:'tenant',routerId:'router',accessType:'pppoe',username:'alice',desiredState:'present',fup:{}};
 const enforce=createFupEnforcer({send:sim.send,saveBaseline:async()=>{throw new Error('database offline');}});
 await assert.rejects(()=>enforce(a,{desiredState:{fupState:'throttled',uploadRate:'1M',downloadRate:'2M'}}),/database offline/);
 assert.ok(sim.calls.every(c=>c.path.endsWith('/print')));
});
test('RADIUS policy must be acknowledged before any session disconnection',async()=>{
 let calls=0;
 const a={_id:'a',tenantId:'tenant',routerId:'router',username:'alice',accessType:'pppoe',authenticationMode:'radius',desiredState:'present'};
 const enforce=createFupEnforcer({send:async()=>{calls++;return [];},loadRadius:async()=>({tenantId:'tenant',enabled:true,fupIntegration:'rest'})});
 await assert.rejects(()=>enforce(a,{desiredState:{fupState:'throttled',uploadRate:'1M',downloadRate:'2M'}}),/acknowledgment/);
 assert.equal(calls,0);
 const result=await enforce(a,{desiredState:{fupState:'throttled',uploadRate:'1M',downloadRate:'2M',radiusAcknowledged:true}});
 assert.equal(result.verified,true);
});
module.exports={simulator};
