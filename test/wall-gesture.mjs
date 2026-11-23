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
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'morning-wall-gesture-test-'));
const now=new Date(), day=editionDay(now), iso=now.toISOString();
const feeds=Object.fromEntries(catalog.map(s=>[s.repo,{checkedAt:iso,attemptedAt:iso,error:null,item:{
  title:'v1.0',tag:'v1.0',detail:'A release for the gesture wall test.',publishedAt:iso,url:'https://github.com/'+s.repo+'/releases/tag/v1.0'}}]));
fs.writeFileSync(path.join(dir,'wall.json'),JSON.stringify({profiles:[defaultProfile],feeds,briefs:{demo:makeBrief(defaultProfile,feeds,day)},lastRunAt:iso}));
const port=process.env.WALL_GESTURE_TEST_PORT || '4334',url='http://127.0.0.1:'+port;
const server=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,BRIEF_DATA:dir,PORT:port,BRIEF_OFFLINE:'1'},stdio:['ignore','pipe','pipe'],windowsHide:true});
let browser;
try {
  await Promise.race([once(server.stdout,'data'),once(server,'exit').then(()=>{throw Error('test server failed');})]);
  browser=await chromium.launch({channel:'chrome',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader'],headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.setDefaultTimeout(120000);
  const errors=[];page.on('pageerror',err=>errors.push(err.message));
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.addInitScript(() => {
    try { localStorage.setItem('morning.gesture.enabled', 'on'); } catch {}
    if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: {} });
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 640; canvas.height = 480;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#222'; ctx.fillRect(0, 0, 640, 480);
      return canvas.captureStream(5);
    };
  });
  await page.route('**/gesture.js', route => route.fulfill({
    contentType: 'text/javascript',
    body: `export class GestureEngine {
      constructor(video, { onEvent } = {}) { this.onEvent = onEvent; window.__emitGesture = e => this.onEvent(e); }
      async start() { window.__gestureReady = true; }
      stop() { window.__gestureStopped = true; }
      updateSettings() {}
    }`,
  }));
  await page.goto(url);
  await page.waitForFunction(() => window.__gestureReady === true, {}, { timeout: 20000 });
  await page.getByRole('button', { name: '体验示例简报' }).click();
  await page.getByRole('button', { name: '是我，打开简报' }).click();
  await page.waitForFunction(() => document.title === '示例成员的简报 · Halo');
  await page.waitForTimeout(500); // 越过 300ms 导航保护
  await page.evaluate(() => window.__emitGesture({ type: 'fist', confidence: 0.9, at: Date.now(), hand: 'Right' }));
  await page.waitForFunction(() => document.title === 'Halo · 团队简报', {}, { timeout: 5000 });
  assert.deepEqual(errors, []);
  console.log('PASS gesture stub drives the wall back from personal view');

  // Spec §8: when the hand model fails, the wall still opens the camera and keeps manual selection.
  const degraded = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  degraded.setDefaultTimeout(120000);
  const degradedErrors = [];
  degraded.on('pageerror', err => degradedErrors.push(err.message));
  await degraded.emulateMedia({ reducedMotion: 'reduce' });
  await degraded.addInitScript(() => {
    try { localStorage.setItem('morning.gesture.enabled', 'on'); } catch {}
    if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: {} });
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 640; canvas.height = 480;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#222'; ctx.fillRect(0, 0, 640, 480);
      return canvas.captureStream(5);
    };
  });
  await degraded.route('**/models/hand_landmarker.task', route => route.abort());
  await degraded.goto(url);
  await degraded.waitForFunction(() => document.documentElement.dataset.camera === 'on', {}, { timeout: 30000 });
  assert.equal(await degraded.locator('#manual').isEnabled(), true);
  assert.deepEqual(degradedErrors, []);
  await degraded.close();
  console.log('PASS wall keeps the camera and manual selection when the hand model fails');
} finally {
  await browser?.close();
  if(server.exitCode===null){const stopped=once(server,'exit');server.kill();await stopped;}
  fs.rmSync(dir,{recursive:true,force:true});
}
