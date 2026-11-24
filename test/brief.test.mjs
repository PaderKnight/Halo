import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBrief, validateProfile, due, editionDay, refreshEntry, defaultProfile, catalog } from '../brief.mjs';
import { identify } from '../public/match.js';
import { addSample } from '../public/camera.js';
import { collectReleases, weekCounts, recordsOnDay } from '../public/board.js';

test('the morning edition rolls once at 07:00 and catches up after downtime',()=>{
  const before=new Date(2026,10,22,6,59), at=new Date(2026,10,22,7);
  assert.equal(editionDay(before),'2026-11-21');assert.equal(editionDay(at),'2026-11-22');
  const entry={attemptedAt:at.toISOString()};
  assert.equal(due(entry,new Date(2026,10,23,6,50).getTime()),false);
  assert.equal(due(entry,new Date(2026,10,24,13).getTime()),true);
});
test('the activity chart uses only in-scope unique records across seven local calendar days',()=>{
  const item=(url,d)=>({url,tag:url,publishedAt:new Date(2026,10,d,12).toISOString()});
  const last=item('v3',22),previous=item('v2',16),outside=item('v1',15);
  const source={repo:'team/demo',item:last,history:[last,last,previous,outside]};
  const records=collectReleases([source]);
  const days=weekCounts(records,new Date(2026,10,22,19));
  assert.deepEqual(days.map(d=>d.count),[1,0,0,0,0,0,1]);
  assert.equal(recordsOnDay(records,days[0].key)[0].item,previous);
  assert.equal(collectReleases([{item:last}]).length,1);
});
test('a failed read keeps the last successful item and retries after an hour',async()=>{
  const checkedAt='2026-11-20T07:00:00Z', now=new Date('2026-11-22T07:00:00Z');
  const item={tag:'v1'}, entry=await refreshEntry('a/b',{checkedAt,item},now,async()=>({ok:false,status:503}));
  assert.equal(entry.checkedAt,checkedAt);assert.deepEqual(entry.item,item);assert.match(entry.error,/503/);
  assert.equal(due(entry,now.getTime()+3599999),false);assert.equal(due(entry,now.getTime()+3600000),true);
});
test('discovery uses adjacent unsubscribed sources, is stable in an edition and changes on the next',()=>{
  const feeds=Object.fromEntries(catalog.map(s=>[s.repo,{item:{publishedAt:'2026-11-20',title:s.label}}]));
  const a=makeBrief(defaultProfile,feeds,'2026-11-22'),b=makeBrief(defaultProfile,feeds,'2026-11-23');
  assert.equal(a.items.length,2);assert.equal(a.discovery.related,true);
  assert.ok(!defaultProfile.repos.includes(a.discovery.repo));assert.notEqual(a.discovery.repo,b.discovery.repo);
  assert.deepEqual(a,makeBrief(defaultProfile,feeds,'2026-11-22'));
  assert.equal(makeBrief({...defaultProfile,repos:catalog.map(s=>s.repo)},feeds,'2026-11-22').discovery,null);
});
test('subscriptions accept public project coordinates; empty selections are allowed for face-only members',()=>{
  assert.deepEqual(validateProfile({name:' 松子 ',repos:['Apple/Example','apple/example']}),{name:'松子',repos:['apple/example']});
  assert.deepEqual(validateProfile({name:'小禾',repos:[]}),{name:'小禾',repos:[]});
  for(const repos of [['a/..'],['https://localhost/x'],['a/b/c']]) assert.throws(()=>validateProfile({name:'A',repos}));
});
test('stable identity requires a close, unambiguous match and consistent enrollment samples',()=>{
  const vec=v=>Array(128).fill(v), a=vec(0), b=vec(.05);
  assert.equal(identify(a,{a:[a,a,a],b:[b,b,b]}),'a');
  assert.equal(identify(a,{a:[a],other:[vec(.003)]}),null);
  assert.equal(identify(a,{b:[b]}),null);
  assert.equal(addSample([a],b).length,0);assert.equal(addSample([a],a).length,2);
});
test('real feed schema produces readable release text and tracks pre-releases and empty sources',async()=>{
  const release={name:'Version 2',tag_name:'v2',published_at:'2026-11-21T03:00:00Z',prerelease:true,body:'## Changes\n\n- Support Apple Silicon acceleration by @test in https://github.com/foo/bar/pull/1'};
  const now=new Date();
  const f=data=>async()=>({ok:true,json:async()=>data});
  const r=await refreshEntry('foo/bar',{},now,f([release]));
  assert.equal(r.item.detail,'Support Apple Silicon acceleration');assert.equal(r.item.prerelease,true);assert.equal(r.item.url,'https://github.com/foo/bar/releases/tag/v2');
  assert.equal((await refreshEntry('foo/bar',{},now,f([]))).item,null);
});

