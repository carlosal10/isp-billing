'use strict';
const assert=require('node:assert/strict');const {test}=require('node:test');
const {createFupEnforcer}=require('../services/fupEnforcementService');
test('PPPoE FUP cannot silently use a local secret for RADIUS',async()=>{
 const run=createFupEnforcer({loadRadius:async()=>null});
 await assert.rejects(()=>run({authenticationMode:'radius',accessType:'pppoe',tenantId:'t',routerId:'r'},{desiredState:{fupState:'blocked'}}),/RADIUS FUP/);
});
