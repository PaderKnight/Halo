import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {defaultModules,validateModule,parseNews,parseCalendar,createModules} from '../modules.mjs';
test('sixteen modules include assistant and fifteen configurable slots with varied types',()=>{
 const mods=defaultModules();assert.equal(mods.length+1,16);assert.ok(new Set(mods.map(m=>m.type)).size>=8);assert.equal(mods[0].config.city,'杭州');
 for(const m of mods)assert.deepEqual(validateModule(m),m);
 assert.throws(()=>validateModule({id:'m1',type:'links',title:'链接',config:{links:[{label:'bad',url:'javascript:alert(1)'}]}}));
 assert.throws(()=>validateModule({id:'m1',type:'news',title:'新闻',config:{source:'https://localhost/admin'}}));
});
test('RSS only exposes safe title links and dates, never HTML or external entities',()=>{
 const rows=parseNews('<rss><channel><item><title><![CDATA[杭州 & 世界]]></title><link>https://example.com/one</link><pubDate>Sun, 22 Nov 2026 09:00:00 GMT</pubDate></item><item><title>bad</title><link>javascript:alert(1)</link></item></channel></rss>');
 assert.equal(rows.length,1);assert.equal(rows[0].title,'杭州 & 世界');assert.equal(rows[0].publishedAt,'2026-11-22T09:00:00.000Z');
 assert.throws(()=>parseNews('<!DOCTYPE x SYSTEM "file:///test"><rss/>'));
});
test('ICS unfolds text and expands repeated events with exclusions in China timezone',()=>{
 const input=['BEGIN:VCALENDAR','VERSION:2.0','BEGIN:VEVENT','UID:daily','DTSTART;TZID=Asia/Shanghai:20261123T090000','DTEND;TZID=Asia/Shanghai:20261123T093000','RRULE:FREQ=DAILY;COUNT=3','EXDATE;TZID=Asia/Shanghai:20261124T090000','SUMMARY:产品',' 评审','END:VEVENT','BEGIN:VEVENT','UID:allday','DTSTART;VALUE=DATE:20261125','DTEND;VALUE=DATE:20261126','SUMMARY:全天事项','END:VEVENT','END:VCALENDAR'].join('\r\n');
 const events=parseCalendar(input,new Date('2026-11-22T00:00:00Z'));
 assert.equal(events.length,3);assert.equal(events[0].title,'产品评审');assert.equal(events[0].startAt,'2026-11-23T01:00:00.000Z');assert.ok(events.some(e=>e.allDay));assert.ok(!events.some(e=>e.startAt==='2026-11-24T01:00:00.000Z'));
});
test('public and member settings persist independently and failed refresh keeps cached news',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'brief-modules-'));let fail=false;
 const fetcher=async()=>{if(fail)throw Error('offline');return new Response('<rss><channel><item><title>headline</title><link>https://example.com/one</link></item></channel></rss>');};
 try{
  const m=createModules(dir,{offline:true});m.get('public');m.get('person',['vitejs/vite']);
  m.update('person',{id:'m13',title:'我的便签',type:'notes',config:{text:'只属于我'}});
  assert.equal(m.get('public').modules.find(v=>v.id==='m13').config.text,'');
  assert.equal(createModules(dir,{offline:true}).get('person').modules.find(v=>v.id==='m13').config.text,'只属于我');
  const file=path.join(dir,'modules.json'),saved=JSON.parse(fs.readFileSync(file,'utf8'));saved.boards={public:{modules:[{id:'m3',type:'news',title:'新闻',config:{source:'headlines',keyword:''}}],events:[],character:'d02'}};fs.writeFileSync(file,JSON.stringify(saved));
  const n=createModules(dir,{fetcher});await n.refresh(true);assert.equal(n.get('public').modules[0].data.items[0].title,'headline');
  fail=true;await n.refresh(true);const after=n.get('public').modules[0];assert.equal(after.data.items.length,1);assert.ok(after.error);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

