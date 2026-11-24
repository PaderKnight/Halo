import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { catalog, defaultProfile, editionDay, makeBrief } from '../brief.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'morning-pointer-integration-test-'));
const now = new Date(), day = editionDay(now), iso = now.toISOString();
const feeds = Object.fromEntries(catalog.map(s => [s.repo, { checkedAt: iso, attemptedAt: iso, error: null, item: {
  title: 'v1.0', tag: 'v1.0', detail: 'A release for the pointer integration test.', publishedAt: iso, url: 'https://github.com/' + s.repo + '/releases/tag/v1.0' } }]));
fs.writeFileSync(path.join(dir, 'wall.json'), JSON.stringify({ profiles: [defaultProfile], feeds, briefs: { demo: makeBrief(defaultProfile, feeds, day) }, lastRunAt: iso }));
const port = process.env.POINTER_INTEGRATION_TEST_PORT || '4335', url = 'http://127.0.0.1:' + port;
const server = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, BRIEF_DATA: dir, PORT: port, BRIEF_OFFLINE: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let browser;

// Convert a screen position into raw (unmirrored, uncalibrated) hand coordinates
// by inverting the default pointer map.
const rawFor = (page, selector) => page.evaluate(sel => {
  const r = document.querySelector(sel).getBoundingClientRect();
  const sx = (r.left + r.width / 2) / window.innerWidth;
  const sy = (r.top + r.height / 2) / window.innerHeight;
  const mx = sx * 0.7 + 0.15;
  return { x: 1 - mx, y: sy * 0.75 + 0.15 };
}, selector);

const drivePoint = (page, raw, frames) => page.evaluate(({ raw, frames }) => {
  window.__frameClock = Number.isFinite(window.__frameClock) ? window.__frameClock : performance.now();
  for (let i = 0; i < frames; i += 1) {
    window.__frameClock += 80;
    window.__gestureFrame({ pointer: { x: raw.x, y: raw.y, active: true }, pose: 'point', at: window.__frameClock });
  }
}, { raw, frames });

const emit = (page, type) => page.evaluate(t => window.__gestureEvent({ type: t, confidence: 0.9, at: performance.now(), hand: 'Right' }), type);

try {
  await Promise.race([once(server.stdout, 'data'), once(server, 'exit').then(() => { throw Error('test server failed'); })]);
  browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'], headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(120000);
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
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
      constructor(video, { onFrame, onEvent } = {}) {
        this.onFrame = onFrame; this.onEvent = onEvent;
        window.__gestureFrame = p => this.onFrame(p);
        window.__gestureEvent = e => this.onEvent(e);
      }
      get running() { return true; }
      async start() { window.__gestureReady = true; }
      stop() { window.__gestureStopped = true; }
      updateSettings() {}
    }`,
  }));
  await page.goto(url);
  await page.waitForFunction(() => window.__gestureReady === true, {}, { timeout: 20000 });
  await page.waitForFunction(() => document.documentElement.dataset.camera === 'on', {}, { timeout: 30000 });

  await page.getByRole('button', { name: '设置今日关注', exact: true }).click();
  await page.getByLabel('关注清单').fill('第一行\n第二行\n第三行');
  await page.getByRole('button', { name: '保存模块', exact: true }).click();
  await page.locator('.widget-notes .note-lines').waitFor();

  // Dwell on the notes card opens the info window; the cursor must be a live popover.
  const notes = await rawFor(page, '.widget-notes');
  await page.waitForTimeout(500); // 越过 300ms 导航保护
  await drivePoint(page, notes, 5);
  assert.equal(await page.locator('#gesture-cursor').evaluate(el => el.matches(':popover-open')), true);
  await drivePoint(page, notes, 13);
  await page.waitForFunction(() => document.getElementById('modal').open, {}, { timeout: 5000 });
  assert.equal(await page.locator('.info-page').innerText(), '1 / 3');
  assert.equal(await page.locator('.info-line').innerText(), '第一行');

  // Dwell on the close button dismisses the info window.
  await page.waitForTimeout(500);
  const close = await rawFor(page, '#close');
  await drivePoint(page, close, 18);
  await page.waitForFunction(() => !document.getElementById('modal').open, {}, { timeout: 5000 });

  // swipes page, wave is ignored inside info, fist closes it.
  await page.waitForTimeout(500);
  await page.locator('.widget-notes .widget-body').click();
  await page.waitForFunction(() => document.getElementById('modal').open, {}, { timeout: 5000 });
  await page.waitForTimeout(500);
  await emit(page, 'swipeLeft');
  assert.equal(await page.locator('.info-page').innerText(), '2 / 3');
  await emit(page, 'swipeRight');
  assert.equal(await page.locator('.info-page').innerText(), '1 / 3');
  await emit(page, 'wave');
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.info-page').innerText(), '1 / 3');
  assert.equal(await page.evaluate(() => document.getElementById('modal').open), true);
  await emit(page, 'fist');
  await page.waitForFunction(() => !document.getElementById('modal').open, {}, { timeout: 5000 });

  // A fist during a dwell on the personal brief cancels the dwell and is consumed.
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: '体验示例简报' }).click();
  await page.getByRole('button', { name: '是我，打开简报' }).click();
  await page.waitForFunction(() => document.title === '示例成员的简报 · Halo', {}, { timeout: 5000 });
  await page.waitForTimeout(500);
  const personalNotes = await rawFor(page, '.widget-notes');
  await drivePoint(page, personalNotes, 8);
  await page.evaluate(() => {
    const at = performance.now();
    window.__gestureFrame({ pointer: { active: false, x: NaN, y: NaN }, pose: 'fist', at });
    window.__gestureEvent({ type: 'fist', confidence: 0.9, at, hand: 'Right' });
  });
  await page.waitForTimeout(200);
  assert.equal(await page.title(), '示例成员的简报 · Halo');

  // After the dwell grace expires, a normal fist returns to the team board.
  await page.waitForTimeout(1700);
  await page.evaluate(() => {
    const at = performance.now();
    window.__gestureFrame({ pointer: { active: false, x: NaN, y: NaN }, pose: 'fist', at });
    window.__gestureEvent({ type: 'fist', confidence: 0.9, at, hand: 'Right' });
  });
  await page.waitForFunction(() => document.title === 'Halo · 团队简报', {}, { timeout: 5000 });

  assert.deepEqual(errors, []);
  console.log('PASS pointer drives open, close, page flips, and the dwell-fist guard through the real app');
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    const stopped = once(server, 'exit');
    server.kill();
    await Promise.race([stopped, new Promise(resolve => setTimeout(resolve, 5000))]);
  }
  fs.rmSync(dir, { recursive: true, force: true });
}
