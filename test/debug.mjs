import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { catalog, defaultProfile, editionDay, makeBrief } from '../brief.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'morning-debug-test-'));
const now=new Date(), day=editionDay(now), iso=now.toISOString();
const feeds=Object.fromEntries(catalog.map(s=>[s.repo,{checkedAt:iso,attemptedAt:iso,error:null,item:{
  title:'v1.0',tag:'v1.0',detail:'A release for the debug page test.',publishedAt:iso,url:'https://github.com/'+s.repo+'/releases/tag/v1.0'}}]));
const profiles=[defaultProfile,{id:'u2',name:'小禾',repos:['vitejs/vite']}];
const briefs=Object.fromEntries(profiles.map(p=>[p.id,makeBrief(p,feeds,day)]));
fs.writeFileSync(path.join(dir,'wall.json'),JSON.stringify({profiles,feeds,briefs,lastRunAt:iso}));
const port=process.env.DEBUG_TEST_PORT || '4333',url='http://127.0.0.1:'+port;
const server=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,BRIEF_DATA:dir,PORT:port,BRIEF_OFFLINE:'1'},stdio:['ignore','pipe','pipe'],windowsHide:true});
let browser;
const fakeCamera = () => {
  try { localStorage.setItem('morning.gesture.enabled','off'); } catch {}
  if (!navigator.mediaDevices) Object.defineProperty(navigator,'mediaDevices',{value:{},configurable:true});
  let calls=0;
  navigator.mediaDevices.getUserMedia = async constraints => {
    calls++; window.__calls=calls; window.__lastConstraints=constraints;
    window.__granted=true;
    const canvas=document.createElement('canvas');
    canvas.width=640; canvas.height=480;
    canvas.getContext('2d').fillStyle='#222'; canvas.getContext('2d').fillRect(0,0,640,480);
    const stream=canvas.captureStream(5);
    window.__stream=stream;
    return stream;
  };
  navigator.mediaDevices.enumerateDevices = async () => {
    const granted=!!window.__granted;
    return [
      {kind:'videoinput',deviceId:granted?'fake-1':'',label:granted?'Fake Camera':'',groupId:'g'},
      {kind:'audioinput',deviceId:granted?'mic-1':'',label:granted?'Fake Mic':'',groupId:'g'},
    ];
  };
  navigator.mediaDevices.addEventListener = navigator.mediaDevices.addEventListener || (()=>{});
};
try {
  await Promise.race([once(server.stdout,'data'),once(server,'exit').then(()=>{throw Error('test server failed');})]);
  browser=await chromium.launch({channel:'chrome',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader'],headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  page.setDefaultTimeout(120000);
  const errors=[];page.on('pageerror',err=>errors.push(err.message));
  const requested=[];
  page.on('request',req=>{try{requested.push(new URL(req.url()).pathname);}catch{}});
  await page.addInitScript(fakeCamera);
  const response=await page.goto(url+'/debug.html');
  assert.equal(response.status(),200,'debug page is served');

  await page.locator('#video').waitFor();
  await page.waitForFunction(()=>document.querySelector('#video').videoWidth>0);
  assert.ok(await page.locator('#overlay').isVisible());
  assert.equal(await page.locator('#match-threshold').inputValue(),'0.48');
  assert.equal(await page.locator('#margin').inputValue(),'0.07');
  await page.locator('#match-threshold').evaluate(el=>{el.value='0.55';el.dispatchEvent(new Event('input',{bubbles:true}));});
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('morning.face.tuning')).matchThreshold),0.55);
  await page.locator('#scores').filter({hasText:'未检测到人脸'}).waitFor();
  await page.locator('#device option').first().waitFor({state:'attached'});
  // Device ids appear only after permission; never fabricate or persist placeholder ids.
  await page.waitForFunction(()=>[...document.querySelectorAll('#device option')].some(option=>option.value==='fake-1'));
  assert.equal(await page.evaluate(()=>[...document.querySelectorAll('#device option')].some(option=>/^camera-\d+$/.test(option.value))),false);
  assert.equal(await page.evaluate(()=>localStorage.getItem('morning.camera.device')),null);
  assert.deepEqual(errors,[]);

  // The page is standalone: the main wall scripts and styles are never requested.
  for (const forbidden of ['/app.js','/wall.css','/scene.css','/board.js','/dashboard.css'])
    assert.equal(requested.includes(forbidden),false,forbidden+' should not be requested');
  assert.equal(await page.locator('#debug').count(),1);
  assert.equal(await page.locator('.widget').count(),0);

  // Restoring defaults writes the default tuning back.
  await page.getByRole('button',{name:'恢复默认',exact:true}).click();
  assert.equal(await page.locator('#match-threshold').inputValue(),'0.48');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('morning.face.tuning')).matchThreshold),0.48);

  // Resolution changes persist and reopen the stream.
  await page.locator('#size').selectOption('640x480');
  assert.equal(await page.evaluate(()=>localStorage.getItem('morning.camera.size')),'640x480');
  await page.waitForFunction(()=>window.__calls>=2,{},{timeout:60000});

  // Sample capture without a detected face reports in the page instead of throwing.
  await page.locator('#enroll-list option[value="u2"]').waitFor({state:'attached'});
  await page.locator('#enroll-list').selectOption('u2');
  await page.locator('#capture-sample').click();
  await page.locator('#sample-note').filter({hasText:'未检测到人脸'}).waitFor();

  // Sample-panel failures stay visible in #sample-note across camera status updates.
  await page.locator('#import-templates').setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from('{not json')});
  await page.locator('#sample-note').filter({hasText:'导入特征失败'}).waitFor();
  await page.waitForTimeout(800);
  assert.match(await page.locator('#sample-note').innerText(),/导入特征失败/);
  assert.deepEqual(errors,[]);

  // Gesture panel: the engine starts on demand, reports no hands and persists merged tuning.
  await page.locator('#gesture-panel').waitFor();
  await page.locator('#gesture-toggle').click();
  await page.locator('#gesture-state').filter({hasText:'未检测到'}).waitFor({timeout:60000});
  // Hand diagnostics update from frame arrivals; the stable run starts at zero with no hand present.
  await page.waitForFunction(()=>/\d+(?:\.\d+)?\/s/.test(document.querySelector('#hand-fps')?.textContent||''),{},{timeout:60000});
  assert.match(await page.locator('#hand-timing').innerText(),/ms/);
  assert.match(await page.locator('#gesture-stable').innerText(),/0\/4/);
  assert.equal(await page.evaluate(()=>localStorage.getItem('morning.gesture.tuning') !== null),true);
  assert.equal(await page.evaluate(()=>{
    const tuning=JSON.parse(localStorage.getItem('morning.gesture.tuning'));
    return tuning.stableFrames===4 && tuning.holdMs===600 && tuning.cooldownMs===2000 && tuning.intervalMs===80;
  }),true);
  await page.waitForTimeout(600);
  assert.deepEqual(errors,[]);

  // A missing model degrades gracefully: a gesture error is shown, the video keeps running and no page errors escape.
  const bad=await browser.newPage({viewport:{width:1280,height:900}});
  bad.setDefaultTimeout(120000);
  const badErrors=[];bad.on('pageerror',err=>badErrors.push(err.message));
  await bad.addInitScript(fakeCamera);
  await bad.route('**/models/hand_landmarker.task',route=>route.abort());
  await bad.goto(url+'/debug.html');
  await bad.locator('#video').waitFor();
  await bad.waitForFunction(()=>document.querySelector('#video').videoWidth>0);
  await bad.locator('#gesture-toggle').click();
  await bad.locator('#gesture-error').filter({hasText:'手势'}).waitFor({timeout:30000});
  assert.equal(await bad.evaluate(()=>document.querySelector('#video').videoWidth>0),true);
  assert.deepEqual(badErrors,[]);
  await bad.close();

  console.log('PASS debug page loads camera, tuning, standalone assets, sample guard and gesture panel');
  await page.close();
} finally {
  await browser?.close();
  if(server.exitCode===null){const stopped=once(server,'exit');server.kill();await stopped;}
  fs.rmSync(dir,{recursive:true,force:true});
}
