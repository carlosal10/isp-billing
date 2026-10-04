'use strict';
const assert=require('node:assert/strict');const {test}=require('node:test');
const {createFupEnforcer}=require('../services/fupEnforcementService');
test('hotspot FUP requires a username',async()=>{
 await assert.rejects(()=>createFupEnforcer()({accessType:'hotspot',tenantId:'t',routerId:'r'},{desiredState:{fupState:'blocked'}}),/no username/);
});
