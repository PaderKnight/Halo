import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-assets-'));

test('mediapipe runtime and hand model are served locally', async () => {
  const model = path.join(root, 'public/models/hand_landmarker.task');
  assert.equal(fs.statSync(model).size, 7819105);
  // MediaPipe .task 是带 2 字节前缀的 zip：00 00 50 4b
  assert.equal(fs.readFileSync(model).subarray(2, 4).toString(), 'PK');
  assert.ok(fs.existsSync(path.join(root, 'node_modules/@mediapipe/tasks-vision/vision_bundle.mjs')));

  const port = '4331';
  const server = spawn(process.execPath, ['server.mjs'], {
    cwd: root,
    env: { ...process.env, BRIEF_DATA: dir, PORT: port, BRIEF_OFFLINE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  try {
    await Promise.race([once(server.stdout, 'data'), once(server, 'exit').then(() => { throw Error('server failed'); })]);
    const base = 'http://127.0.0.1:' + port;
    const cases = [
      ['/mediapipe/vision_bundle.mjs', /^text\/javascript/],
      ['/mediapipe/wasm/vision_wasm_internal.js', /^text\/javascript/],
      ['/mediapipe/wasm/vision_wasm_internal.wasm', /^application\/wasm/],
      ['/models/hand_landmarker.task', /^application\/octet-stream/],
    ];
    for (const [route, type] of cases) {
      const res = await fetch(base + route);
      assert.equal(res.status, 200, route);
      assert.match(res.headers.get('content-type'), type, route);
      await res.body.cancel();
    }
  } finally {
    if (server.exitCode === null) { const stopped = once(server, 'exit'); server.kill(); await stopped; }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
