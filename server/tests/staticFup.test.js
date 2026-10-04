'use strict';
const assert=require('node:assert/strict'),{test}=require('node:test');
const {createFupEnforcer}=require('../services/fupEnforcementService');
test('static FUP enforces rates, installs two drop rules, flushes flows and restores its own rules',async()=>{
 const data={'/queue/simple':[{'.id':'*q',name:'billing-a',target:'10.0.0.5/32','max-limit':'5M/20M'}],'/ip/firewall/filter':[], '/ip/firewall/connection':[{'.id':'*c','src-address':'10.0.0.5:40','dst-address':'8.8.8.8:53'}]};
 let id=0;const calls=[];
 async function send(path,words,ctx) {
  calls.push(path);assert.equal(ctx.serverId,'router');
  const base=path.slice(0,path.lastIndexOf('/')), action=path.split('/').at(-1);
  if(action==='print') {let rows=data[base]||[];for(const q of words){assert.ok(q.startsWith('?'));const i=q.indexOf('=');rows=rows.filter(r=>r[q.slice(1,i)]===q.slice(i+1));}return structuredClone(rows);}
  const v=Object.fromEntries(words.map(w=>{const i=w.indexOf('=',1);return[w.slice(1,i),w.slice(i+1)];}));
  if(action==='add')data[base].push({...v,'.id':'*'+ ++id});
  if(action==='set')Object.assign(data[base].find(r=>r['.id']===v['.id']),v);
  if(action==='remove')data[base]=data[base].filter(r=>r['.id']!==v['.id']);
  if(action==='move'){const index=data[base].findIndex(r=>r['.id']===v.numbers);data[base].unshift(...data[base].splice(index,1));}
  return [];
 }
 const a={_id:'a',tenantId:'tenant',routerId:'router',accessType:'static',ipAddress:'10.0.0.5',desiredState:'present',fup:{}};
 const enforce=createFupEnforcer({send,saveBaseline:async(a,b)=>{a.fup.baseline=b;return b;}});
 await enforce(a,{desiredState:{fupState:'throttled',uploadRate:'512K',downloadRate:'2M'}});
 assert.equal(data['/queue/simple'][0]['max-limit'],'512K/2M');
 await enforce(a,{desiredState:{fupState:'blocked'}});
 assert.equal(data['/ip/firewall/filter'].length,2);assert.ok(data['/ip/firewall/filter'].every(r=>r.action==='drop'));
 assert.equal(data['/ip/firewall/connection'].length,0);
 await enforce(a,{desiredState:{fupState:'normal'}});
 assert.equal(data['/ip/firewall/filter'].length,0);assert.equal(data['/queue/simple'][0]['max-limit'],'5M/20M');
});
