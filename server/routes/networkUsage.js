'use strict';
const express = require('express'), mongoose = require('mongoose');
const requireRole = require('../middleware/requireRole');
const Event = require('../models/UsageEvent');
const Customer = require('../models/customers');
const router = express.Router();
const validId = v => typeof v === 'string' && /^[a-f0-9]{24}$/i.test(v);
function range(query) {
 const now=new Date(), from=query.from?new Date(query.from):new Date(+now-30*86400000);
 const to=query.to?new Date(query.to):now;
 if(query.to && /^\d{4}-\d\d-\d\d$/.test(query.to)) to.setUTCDate(to.getUTCDate()+1);
 if(!Number.isFinite(+from)||!Number.isFinite(+to)||from>=to||to-from>400*86400000) throw Object.assign(new Error('Use a valid date range of at most 400 days'),{statusCode:400});
 return {from,to};
}
const sumFields={uploadBytes:{$sum:{$toDecimal:'$uploadBytes'}},downloadBytes:{$sum:{$toDecimal:'$downloadBytes'}}};
const asStrings=row=>({uploadBytes:row?.uploadBytes?.toString()||'0',downloadBytes:row?.downloadBytes?.toString()||'0'});
router.get('/customer/:customerId',requireRole('any'),async(req,res)=>{
 if(!validId(req.params.customerId))return res.status(400).json({error:'Invalid customer ID'});
 if(!await Customer.exists({_id:req.params.customerId,tenantId:req.tenantId}))return res.status(404).json({error:'Customer not found'});
 const {from,to}=range(req.query),limit=Number(req.query.limit||100);
 if(!Number.isInteger(limit)||limit<1||limit>1000||req.query.after&&!validId(req.query.after))return res.status(400).json({error:'Invalid pagination'});
 const filter={tenantId:new mongoose.Types.ObjectId(req.tenantId),customerId:new mongoose.Types.ObjectId(req.params.customerId),occurredAt:{$gte:from,$lt:to}};
 const totals=await Event.aggregate([{$match:filter},{$group:{_id:null,...sumFields}}]);
 const items=await Event.find({...filter,...(req.query.after?{_id:{$gt:req.query.after}}:{})}).sort({_id:1}).limit(limit).lean();
 res.json({ok:true,from,to,totals:asStrings(totals[0]),items,nextCursor:items.length===limit?String(items.at(-1)._id):null});
});
router.get('/daily',requireRole('any'),async(req,res)=>{
 const {from,to}=range(req.query);
 const filter={tenantId:new mongoose.Types.ObjectId(req.tenantId),occurredAt:{$gte:from,$lt:to}};
 if(req.query.customerId){if(!validId(req.query.customerId))return res.status(400).json({error:'Invalid customer ID'});filter.customerId=new mongoose.Types.ObjectId(req.query.customerId);}
 const items=await Event.aggregate([{$match:filter},{$group:{_id:{$dateToString:{date:'$occurredAt',format:'%Y-%m-%d',timezone:'UTC'}},...sumFields,snapshots:{$sum:1}}},{$sort:{_id:1}}]);
 res.json({ok:true,from,to,timezone:'UTC',items:items.map(row=>({date:row._id,...asStrings(row),snapshots:row.snapshots}))});
});
router.use((error,req,res,next)=>res.status(error.statusCode||500).json({error:error.statusCode?error.message:'Unable to load usage'}));
module.exports=router;
