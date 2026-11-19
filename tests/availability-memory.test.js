import test from 'node:test';
import assert from 'node:assert/strict';
import { createAvailabilityMemory } from '../public/availability-memory.js';
const now = Date.parse('2026-11-19T12:00:00.000Z');
const e={id:'basketball/nba:1234567',sourceEventId:'1234567',route:'basketball/nba',state:'pre',homeId:'1',awayId:'2',date:'2026-11-20T12:00:00.000Z'};
const report=(time,items)=>({availability:{identityVerified:true,eventId:e.sourceEventId,startTime:e.date,state:'pre',fetchedAt:new Date(time).toISOString(),teams:[{id:'1',injuries:{items}},{id:'2',injuries:{items:[]}}]}});
test('unknown reports retain an earlier exclusion; only a newer explicit available status clears it',()=>{
 const m=createAvailabilityMemory();m.observe(e,report(now,[{id:'99',status:'Out'}]),{now});
 assert.deepEqual(m.excluded(e,{now}),['99']);
 m.observe(e,report(now+60000,[]),{now:now+60000});assert.equal(m.retained(e,{now:now+60000}).length,1);
 assert.deepEqual(m.excluded(e,{now:now+3600000}),['99']);
 m.observe(e,report(now+120000,[{id:'99',status:'Active'}]),{now:now+120000});assert.deepEqual(m.excluded(e,{now:now+120000}),[]);
});
test('stale, future and mismatched observations cannot alter availability for another fixture',()=>{
 const m=createAvailabilityMemory();const out=report(now,[{id:'99',status:'Out'}]);
 for(const data of [report(now-16*60000,[{id:'99',status:'Out'}]),report(now+120000,[{id:'99',status:'Out'}]),{availability:{...out.availability,eventId:'7654321'}}])assert.equal(m.observe(e,data,{now}),false);
 m.observe(e,out,{now});assert.deepEqual(m.excluded({...e,date:'2026-11-20T13:00:00.000Z'},{now}),[]);
 assert.deepEqual(m.excluded({...e,homeId:'2',awayId:'1'},{now}),[]);
 assert.deepEqual(m.excluded(e,{now:Date.parse(e.date)}),[]);
});
