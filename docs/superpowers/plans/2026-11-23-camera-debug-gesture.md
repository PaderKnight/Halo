# 摄像头调试页与手势识别 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 Halo 增加一个本地摄像头识别调试页，并新增基于 MediaPipe HandLandmarker 的手势识别：调试页可视化/调参，主屏按已确认映射执行动作。

**Architecture:** 保留 face-api 人脸管线；把 `Camera` 拆成“视频流持有”与“人脸管线”两个生命周期。手势引擎与人脸共用同一条 `MediaStream`：手势开启时流常开，“关闭摄像头”只暂停人脸。纯逻辑（手势判据、状态机、动作解析）放在无 DOM 依赖的 `public/gesture-rules.js`，由 Node 单测覆盖；MediaPipe 只出现在 `public/gesture.js` 与调试页。

**Tech Stack:** Node 22+（本机 24）、原生 ESM、face-api（已有）、`@mediapipe/tasks-vision@1.2.3`、Playwright（已有）。

**Spec:** `docs/superpowers/specs/2026-11-23-camera-debug-gesture-design.md`

## Global Constraints

- 服务只监听 `127.0.0.1`，不得放宽 Host/Origin 校验（`server.mjs:104-105`）。
- 前端不得引入 CDN；MediaPipe 运行时与模型全部本地托管。
- 未调参时人脸识别行为必须与现状一致：`DEFAULT_FACE_TUNING = { inputSize:320, detectScore:0.55, matchThreshold:0.48, margin:0.07 }`。
- `morning.gesture.enabled` 缺省视为 `on`；值为 `'off'` 才关闭。
- 存储键固定：`morning.camera.device`、`morning.camera.size`、`morning.face.tuning`、`morning.gesture.enabled`、`morning.gesture.tuning`；人脸模板沿用 `morning.wall.face-templates.v1`。
- 所有新增用户可见文案用简体中文，语气与现有界面一致。
- 手势规则数值：稳定帧 4、保持 600ms（点赞 500ms）、冷却 2000ms、检测间隔 80ms、挥手窗口 1200ms、挥手反转 ≥2、掌心漂移 ≤0.12、挥手后抑制张开手掌 500ms。
- 未经用户明确同意，不执行 `git commit` / `git push`；每个任务以测试通过和工作区改动收尾。若用户要求提交，提交信息末尾加 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- 现有测试命令：`npm test`（Node 单测）、`npm run test:browser`（Playwright）。

## Review Focus

- 摄像头权限被拒或设备不可用时，“手势默认开启”不得让页面崩溃或反复弹权限框；手动选择成员仍可用。
- 模型或 wasm 加载失败时，手势静默禁用，人脸识别与调试页人脸部分不受影响。
- 手部关键点缺失、为 NaN、全为零时不得抛错或产生手势事件。
- 挥手动作不得同时触发“张开手掌”，身份确认弹窗不能被挥手确认。
- 摄像头轨道中途断开（拔线、被其他应用占用）时，流状态、人脸状态、手势引擎都要复位并给出提示。

---

### Task 1: MediaPipe 资源与静态托管

**Files:**
- Modify: `package.json`（依赖与测试脚本）
- Create: `public/models/hand_landmarker.task`（下载，7,819,105 字节）
- Create: `public/models/NOTICE.md`
- Modify: `server.mjs:85-99`（静态映射与 MIME）
- Modify: `.gitattributes`（`*.task binary`）
- Test: `test/assets.test.mjs`（新建）

**Interfaces:**
- Consumes: 现有静态文件表 `staticFiles`、`types`（`server.mjs:85-99`）。
- Produces: HTTP 路由 `/mediapipe/vision_bundle.mjs`、`/mediapipe/wasm/<file>`、`/models/hand_landmarker.task`；后续任务用这些路径加载引擎。

- [ ] **Step 1: 写失败测试**

`test/assets.test.mjs`（沿用 `test/wall.mjs` 的 spawn 模式，端口 `4331`）：

```js
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
```

- [ ] **Step 2: 运行并确认失败**

Run: `node --test test/assets.test.mjs`
Expected: FAIL（模型文件不存在）。

- [ ] **Step 3: 安装依赖、下载模型、加路由**

```bash
npm install --save-exact @mediapipe/tasks-vision@1.2.3
mkdir -p public/models
curl -L -o public/models/hand_landmarker.task \
  https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
```

`public/models/NOTICE.md` 写明：来源 URL、版本 `float16/1`、大小 7,819,105 字节、Apache-2.0。

`server.mjs`：在 `registerPublic` 之后追加

```js
const mpPkg = path.join(root, 'node_modules/@mediapipe/tasks-vision');
if (fs.existsSync(mpPkg)) {
  staticFiles.set('/mediapipe/vision_bundle.mjs', path.relative(root, path.join(mpPkg, 'vision_bundle.mjs')));
  for (const name of fs.readdirSync(path.join(mpPkg, 'wasm')))
    staticFiles.set('/mediapipe/wasm/' + name, path.relative(root, path.join(mpPkg, 'wasm', name)));
}
staticFiles.set('/models/hand_landmarker.task', 'public/models/hand_landmarker.task');
```

`types` 增加 `.wasm: 'application/wasm'`、`.mjs: 'text/javascript; charset=utf-8'`、`.task: 'application/octet-stream'`；`Cache-Control` 的长缓存条件扩展为 `route.startsWith('/models/') || route.startsWith('/mediapipe/') || route === '/face-api.js'`。

`package.json` 的 `test` 脚本追加 `test/assets.test.mjs`。`.gitattributes` 追加 `*.task binary`。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/assets.test.mjs`
Expected: PASS（1 test）。

- [ ] **Step 5: 收尾**

Run: `npm test`
Expected: 全部 PASS。等用户确认后再提交。

---

### Task 2: 匹配分数排行与可调阈值

**Files:**
- Modify: `public/match.js`
- Test: `test/match.test.mjs`（新建）
- Modify: `package.json`（test 脚本追加）

**Interfaces:**
- Produces:
  - `rank(face, templates) -> [{ id: string, score: number }]`，按 `score` 升序，跳过无样本成员。
  - `identify(face, templates, options = {}) -> string|null`，`options = { threshold?: number, margin?: number }`，缺省 `0.48` / `0.07`。
- Consumes: 现有 `distance(a,b)`（128 维，非法输入返回 `Infinity`）。

- [ ] **Step 1: 写失败测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { rank, identify } from '../public/match.js';

const vec = d => [d, ...Array(127).fill(0)];
const templates = { a: [vec(0.20)], b: [vec(0.60)], empty: [] };

test('rank sorts known members by distance and skips empty banks', () => {
  assert.deepEqual(rank(vec(0), templates).map(r => [r.id, r.score]), [['a', 0.2], ['b', 0.6]]);
});
test('identify keeps default threshold and margin', () => {
  assert.equal(identify(vec(0), templates), 'a');
  assert.equal(identify(vec(0), { a: [vec(0.55)] }), null);
  assert.equal(identify(vec(0), { a: [vec(0.20)], b: [vec(0.24)] }), null); // 差距 0.04 < 0.07
});
test('identify accepts tuning overrides', () => {
  assert.equal(identify(vec(0), templates, { threshold: 0.7, margin: 0.1 }), 'a');
  assert.equal(identify(vec(0), { a: [vec(0.20)], b: [vec(0.24)] }, { margin: 0.03 }), 'a');
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `node --test test/match.test.mjs`
Expected: FAIL（`rank is not a function`）。

- [ ] **Step 3: 实现**

`rank` 复用现有排序逻辑；`identify` 改为调用 `rank`，判定 `ranks[0].score > threshold || (ranks[1] && ranks[1].score - ranks[0].score < margin)` 返回 `null`，否则返回第一名 `id`。默认参数写在函数签名里。

- [ ] **Step 4: 运行测试**

Run: `node --test test/match.test.mjs`
Expected: PASS（3 tests）。

- [ ] **Step 5: 收尾**

Run: `npm test`；等用户确认后再提交。

---

### Task 3: 手势纯逻辑（判据、状态机、动作解析）

**Files:**
- Create: `public/gesture-rules.js`
- Test: `test/gesture.test.mjs`（新建）
- Modify: `package.json`（test 脚本追加）

**Interfaces:**
- Produces:
  - `DEFAULT_GESTURE_SETTINGS = { minConfidence:0.6, stableFrames:4, holdMs:600, thumbsUpHoldMs:500, cooldownMs:2000, intervalMs:80, waveWindowMs:1200, waveMinReversals:2, palmMaxDrift:0.12, waveSuppressMs:500 }`
  - `analyzeHand(landmarks) -> { pose:'openPalm'|'fist'|'thumbsUp'|null, extended:[boolean,boolean,boolean,boolean,boolean], palmX:number, palmY:number, ruleScore:number }`（`extended` 顺序：拇指、食指、中指、无名指、小指）。
  - `class GestureStateMachine { constructor(settings = {}); updateSettings(partial); push({ pose, confidence, palmX, hand, at }) -> Event[]; }`
  - `Event = { type:'wave'|'openPalm'|'fist'|'thumbsUp', confidence:number, at:number, hand:string }`
  - `resolveGestureAction(event, context) -> 'confirm'|'cancel'|'home'|'resumeFace'|'greet'|null`
  - `context = { enabled, dialog, candidateVia, personalVia, faceActive }`
- Consumes: 无。

- [ ] **Step 1: 写失败测试**

测试夹具（放入 `test/gesture.test.mjs`）：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeHand, GestureStateMachine, resolveGestureAction, DEFAULT_GESTURE_SETTINGS,
} from '../public/gesture-rules.js';

const hand = points => Array.from({ length: 21 }, (_, i) => points[i] ?? { x: 0.5, y: 0.75 });
const palm = hand({
  0:{x:.5,y:.8}, 1:{x:.42,y:.74}, 2:{x:.32,y:.68}, 3:{x:.26,y:.62}, 4:{x:.16,y:.54},
  5:{x:.44,y:.64}, 6:{x:.44,y:.53}, 7:{x:.44,y:.46}, 8:{x:.44,y:.38},
  9:{x:.50,y:.62}, 10:{x:.50,y:.50}, 11:{x:.50,y:.42}, 12:{x:.50,y:.34},
  13:{x:.56,y:.64}, 14:{x:.56,y:.53}, 15:{x:.56,y:.46}, 16:{x:.56,y:.38},
  17:{x:.62,y:.66}, 18:{x:.62,y:.56}, 19:{x:.62,y:.50}, 20:{x:.62,y:.42},
});
const fist = hand({
  0:{x:.5,y:.8}, 1:{x:.45,y:.74}, 2:{x:.48,y:.70}, 3:{x:.50,y:.68}, 4:{x:.53,y:.69},
  5:{x:.44,y:.64}, 6:{x:.44,y:.54}, 7:{x:.46,y:.62}, 8:{x:.47,y:.68},
  9:{x:.50,y:.62}, 10:{x:.50,y:.52}, 11:{x:.51,y:.60}, 12:{x:.52,y:.67},
  13:{x:.56,y:.64}, 14:{x:.56,y:.55}, 15:{x:.55,y:.62}, 16:{x:.54,y:.68},
  17:{x:.61,y:.66}, 18:{x:.61,y:.58}, 19:{x:.60,y:.64}, 20:{x:.59,y:.69},
});
const thumbsUp = hand({
  0:{x:.5,y:.8}, 1:{x:.46,y:.74}, 2:{x:.47,y:.62}, 3:{x:.48,y:.54}, 4:{x:.49,y:.40},
  5:{x:.44,y:.64}, 6:{x:.44,y:.54}, 7:{x:.46,y:.62}, 8:{x:.47,y:.68},
  9:{x:.50,y:.62}, 10:{x:.50,y:.52}, 11:{x:.51,y:.60}, 12:{x:.52,y:.67},
  13:{x:.56,y:.64}, 14:{x:.56,y:.55}, 15:{x:.55,y:.62}, 16:{x:.54,y:.68},
  17:{x:.61,y:.66}, 18:{x:.61,y:.58}, 19:{x:.60,y:.64}, 20:{x:.59,y:.69},
});

test('classifies open palm, fist and thumbs up', () => {
  assert.equal(analyzeHand(palm).pose, 'openPalm');
  assert.deepEqual(analyzeHand(palm).extended, [true, true, true, true, true]);
  assert.equal(analyzeHand(fist).pose, 'fist');
  assert.equal(analyzeHand(thumbsUp).pose, 'thumbsUp');
});
test('rejects malformed landmarks without throwing', () => {
  for (const bad of [[], Array(21).fill({ x: NaN, y: NaN }), Array(21).fill({ x: 0, y: 0 })])
    assert.equal(analyzeHand(bad).pose, null);
});
test('holds openPalm for holdMs before emitting', () => {
  const sm = new GestureStateMachine({ stableFrames: 2, holdMs: 200 });
  const frame = at => ({ pose: 'openPalm', confidence: 0.9, palmX: 0.5, hand: 'Right', at });
  assert.equal(sm.push(frame(0)).length, 0);
  assert.equal(sm.push(frame(80)).length, 0);
  assert.equal(sm.push(frame(160)).length, 0);
  const events = sm.push(frame(240));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'openPalm');
});
test('moving palm does not emit openPalm', () => {
  const sm = new GestureStateMachine({ stableFrames: 2, holdMs: 200 });
  const xs = [0.3, 0.4, 0.5, 0.6];
  const events = xs.flatMap((palmX, i) => sm.push({ pose: 'openPalm', confidence: 0.9, palmX, hand: 'Right', at: i * 80 }));
  assert.equal(events.some(e => e.type === 'openPalm'), false);
});
test('wave takes precedence over openPalm and suppresses it', () => {
  const sm = new GestureStateMachine({ stableFrames: 2, cooldownMs: 0, waveWindowMs: 1200 });
  const xs = [0.5, 0.62, 0.5, 0.62, 0.5];
  const events = xs.flatMap((palmX, i) => sm.push({ pose: 'openPalm', confidence: 0.9, palmX, hand: 'Right', at: i * 80 }));
  assert.equal(events.some(e => e.type === 'wave'), true);
  assert.equal(events.some(e => e.type === 'openPalm'), false);
  sm.updateSettings({ stableFrames: 1, holdMs: 0 });
  assert.equal(sm.push({ pose: 'openPalm', confidence: 0.9, palmX: 0.5, hand: 'Right', at: 480 }).length, 0);
  assert.deepEqual(
    sm.push({ pose: 'openPalm', confidence: 0.9, palmX: 0.5, hand: 'Right', at: 800 }).map(e => e.type),
    ['openPalm'],
  );
});
test('cooldown blocks repeated events', () => {
  const sm = new GestureStateMachine({ stableFrames: 1, holdMs: 0, cooldownMs: 1000 });
  const f = at => ({ pose: 'fist', confidence: 0.9, palmX: 0.5, hand: 'Right', at });
  assert.equal(sm.push(f(0)).length, 1);
  assert.equal(sm.push(f(200)).length, 0);
  assert.equal(sm.push(f(1200)).length, 1);
});
test('resolveGestureAction applies context guards', () => {
  const evt = type => ({ type, confidence: 0.9, at: 0, hand: 'Right' });
  const base = { enabled: true, dialog: '', candidateVia: null, personalVia: null, faceActive: true };
  assert.equal(resolveGestureAction(evt('wave'), { ...base, faceActive: false }), 'resumeFace');
  assert.equal(resolveGestureAction(evt('openPalm'), { ...base, dialog: 'confirm', candidateVia: 'camera' }), 'confirm');
  assert.equal(resolveGestureAction(evt('openPalm'), base), null);
  assert.equal(resolveGestureAction(evt('fist'), { ...base, dialog: 'confirm', candidateVia: 'camera' }), 'cancel');
  assert.equal(resolveGestureAction(evt('fist'), { ...base, personalVia: 'camera' }), 'home');
  assert.equal(resolveGestureAction(evt('wave'), { ...base, personalVia: 'manual' }), 'home');
  assert.equal(resolveGestureAction(evt('thumbsUp'), base), 'greet');
  assert.equal(resolveGestureAction(evt('thumbsUp'), { ...base, enabled: false }), null);
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `node --test test/gesture.test.mjs`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `public/gesture-rules.js`**

关键判据（数值固定）：

- `palmSize = distance(wrist, middleMcp)`。
- 食指/中指/无名指/小指：`tipWrist > pipWrist * 1.12` 判为伸展。
- 拇指：`thumbTipWrist > thumbIpWrist * 1.35 && distance(thumbTip, middleMcp) > palmSize * 0.55`。
- `openPalm`：四指与拇指全部伸展。
- `fist`：四指全部弯曲且拇指弯曲。
- `thumbsUp`：四指全部弯曲、拇指伸展、`thumbTip.y < wrist.y - palmSize`、`|thumbTip.x - wrist.x| < palmSize * 0.8`。
- `palmX/palmY`：0、5、9、13、17 号点的平均值。
- `ruleScore`：满足的判据数 / 该姿势要求的判据数；无姿势为 0。
- 任一坐标非有限数或长度 ≠ 21：返回 `{ pose:null, extended:[false×5], palmX:NaN, palmY:NaN, ruleScore:0 }`，不抛错。

`GestureStateMachine.push` 行为：

- 置信度低于 `minConfidence` 或 `pose === null`：结束当前连续计数，仍记录挥手历史（仅 `openPalm` 帧），返回 `[]`。
- 连续段从第一帧开始计时；连续计数达到 `stableFrames` 且距段首达到 `holdMs`（`thumbsUp` 用 `thumbsUpHoldMs`）时发事件，发事件后清空当前连续段。
- 冷却期内（`at < cooldownUntil`）不发任何事件。
- `openPalm` 当前连续段的 `palmX` 极差 > `palmMaxDrift` 时重置该段，不发事件。
- 挥手历史：`pose === 'openPalm'` 时记录 `{at,palmX}`，丢弃早于 `at - waveWindowMs` 的项；方向变化以 `|x - lastTurnX| >= 0.02` 认定；反转数 ≥ `waveMinReversals` 时发 `wave`，清空历史，设 `waveSuppressUntil = at + waveSuppressMs`、`cooldownUntil = at + cooldownMs`。
- `at < waveSuppressUntil` 时禁止 `openPalm` 事件；同一帧先判定挥手，挥手成立则不产生 `openPalm`。
- `updateSettings(partial)` 合并设置并保留当前状态。

`resolveGestureAction` 按设计 §7.4：

- `enabled === false` → `null`。
- `openPalm`：`dialog === 'confirm' && candidateVia === 'camera'` → `'confirm'`，否则 `null`。
- `fist`：同上条件 → `'cancel'`；否则 `personalVia` 存在 → `'home'`；否则 `null`。
- `wave`：`personalVia` 存在 → `'home'`；否则 `faceActive === false` → `'resumeFace'`；否则 `null`。
- `thumbsUp` → `'greet'`。

- [ ] **Step 4: 运行测试**

Run: `node --test test/gesture.test.mjs`
Expected: PASS（7 tests）。

- [ ] **Step 5: 收尾**

Run: `npm test`；等用户确认后再提交。

---

### Task 4: Camera 拆分（流 / 人脸管线 / 调试数据 / 调参）

**Files:**
- Modify: `public/camera.js`（整体重写，保留导出 `enrolled/remember/forget/addSample`）
- Modify: `public/app.js`（流/人脸生命周期、状态文案、按钮语义）
- Modify: `test/wall.mjs`（`addInitScript` 固定手势关闭）
- Modify: `package.json`（`test:browser` 追加 `test/camera.mjs`）
- Test: `test/camera.mjs`（新建）

**Interfaces:**
- Produces:

```js
export const DEFAULT_FACE_TUNING = { inputSize:320, detectScore:0.55, matchThreshold:0.48, margin:0.07 };
export function loadFaceTuning();            // localStorage 'morning.face.tuning' 与默认值合并
export class Camera {
  constructor(video, onFrame, onError, tuning = loadFaceTuning());
  get streaming();                            // 视频流是否存活
  get faceActive();                           // 人脸检测循环是否运行
  get active();                               // === streaming（兼容旧调用）
  setDebug(on);                               // 消费者标记；不门控 onFrame 载荷
  setTuning(partial);
  async openStream();                         // 读取 device/size；失败回退
  async openCamera();                         // openStream + startFace
  async startFace();                          // 加载模型并启动循环（旧 start）
  pauseFace();                                // 停 loop，不关流
  async resumeFace();
  stop();                                     // 停 loop + 停所有轨道
  fail(message);
}
```

- `onFrame` 载荷：`{ count, face, match, scores, threshold, margin, detections, timings }`。`detections` **始终**为数组（无脸时为空数组），每项 `{ box:{x,y,width,height}, landmarks:[{x,y}] }`；`setDebug` 仅为消费者标记，不门控载荷；`scores` 来自 `rank`；`timings.detectMs` 为整数。
- 存储：`morning.camera.device`（deviceId 字符串，缺省不传）、`morning.camera.size`（`'1280x720'` 缺省）。
- `openStream` 行为：先按 `{ deviceId:{exact:id} }`（若有）与 size ideal 请求；遇到 `OverconstrainedError` 时去掉 `deviceId` 重试一次；再失败则用 `{ facingMode:'user' }` 重试一次。`video.play()` 后设置 `streaming`。`onended` 与 `fail` 必须同时重置 `streaming`/`faceActive` 并调用 `onError`。
- `setTuning` 后下一帧生效（`TinyFaceDetectorOptions` 每次扫描构造）。

- [ ] **Step 1: 写失败测试 `test/camera.mjs`**

沿用 `test/wall.mjs` 的服务器启动方式（端口 `4332`），`addInitScript` 必须在 `goto` 前安装假摄像头：

```js
const fakeCamera = () => {
  if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: {} });
  let calls = 0;
  navigator.mediaDevices.getUserMedia = async constraints => {
    calls++; window.__calls = calls; window.__lastConstraints = constraints;
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 480;
    canvas.getContext('2d').fillStyle = '#222', canvas.getContext('2d').fillRect(0, 0, 640, 480);
    const stream = canvas.captureStream(5);
    window.__stream = stream;
    return stream;
  };
  navigator.mediaDevices.enumerateDevices = async () => [{ kind: 'videoinput', deviceId: 'fake-1', label: 'Fake Camera', groupId: 'g' }];
};
```

用例（每个用独立 `browser.newPage` + `addInitScript`）：

1. **手势关闭时保持旧行为**：init 脚本里 `localStorage.setItem('morning.gesture.enabled','off')`，`goto(url)` 后 `[data-camera]` 为 `off`，`window.__calls` 为 `undefined`；点“开启摄像头识别”后 `data-camera` 为 `on`；再点“关闭摄像头”，`window.__stream.getTracks()[0].readyState === 'ended'`。
2. **手势开启时流常开**：init 脚本 `localStorage.setItem('morning.gesture.enabled','on')`；`goto` 后等待 `data-camera="on"`；状态文案包含“手势运行中”；点“暂停人脸识别”后轨道仍为 `live`，状态包含“人脸识别已暂停”；再点“开始人脸识别”恢复。
3. **权限拒绝**：init 脚本覆盖 `getUserMedia` 为抛出 `new DOMException('denied','NotAllowedError')`，且手势开启；`goto` 后等待提示包含“权限”，`pageerror` 为空；“选择成员简报”按钮可用。
4. **轨道中途断开**：用例 2 的页面里执行 `window.__stream.getTracks()[0].dispatchEvent(new Event('ended'))`（`stop()` 不会触发 `ended` 事件），等待状态包含“摄像头已断开”或 `data-camera` 回 `off`，且无 `pageerror`。
5. **OverconstrainedError 回退**：init 脚本第一次调用以 `deviceId` 请求时抛出 `new DOMException('bad','OverconstrainedError')`，第二次成功；在 `localStorage` 预置 `morning.camera.device='ghost'`；`goto` 后 `window.__calls >= 2`，`data-camera="on"`，第二次的约束不含 `deviceId`。

- [ ] **Step 2: 运行并确认失败**

Run: `node test/camera.mjs`
Expected: FAIL（`data-camera` 或状态文案不符）。

- [ ] **Step 3: 重写 `public/camera.js` 并调整 `public/app.js` 生命周期**

保持 `samples/enrolled/remember/forget/addSample/loadModels` 逻辑不变；`loadModels` 仍从 `/face-api.js` 与 `/models` 加载三套模型。扫描循环沿用 450ms，`found.length` 不变；`match` 用 `identify(face, samples(), { threshold: tuning.matchThreshold, margin: tuning.margin })`；`scores` 用 `rank`。所有存储读取加 `try/catch`，损坏 JSON 回退默认值。

`app.js` 生命周期（让 Task 4 的浏览器用例可独立通过）：

- `gestureEnabled()` = `localStorage.getItem('morning.gesture.enabled') !== 'off'`。
- 启动条件改为 `localStorage.getItem('morning.camera') === 'on' || gestureEnabled()`；`camera.openCamera()` 失败只 `notify`。
- `cameraStatus()`：未开流 → 原提示；开流且 `faceActive` → “摄像头已开启 · 手势运行中”（手势关闭时保留“摄像头已开启”）；开流且暂停 → “人脸识别已暂停 · 手势运行中”。
- `#cam` 按钮：`faceActive` 时点击，手势开启走 `camera.pauseFace()`（文案“暂停人脸识别”），手势关闭走 `camera.stop()`（文案“关闭摄像头”）；未运行时点击走 `openCamera()`（文案“开启摄像头识别/开始人脸识别”）。
- `render()` 签名纳入 `camera.streaming` 与 `camera.faceActive`；`document.documentElement.dataset.camera` 用 `streaming`。
- 错误回调：重置 `starting`，调用 `home()`，`onError` 文案包含“摄像头已断开”（轨道中途停止时）。
- `openCamera()` / `pauseFace()` / `resumeFace()` / `stop()` 完成后都调用 `render()`，保证按钮文案与状态即时更新。

`test/wall.mjs` 在 `p.goto(url)` 前加入：

```js
await p.addInitScript(() => { try { localStorage.setItem('morning.gesture.enabled', 'off'); } catch {} });
```

- [ ] **Step 4: 运行测试**

Run: `node test/camera.mjs`
Expected: PASS（5 个用例）。
Run: `node test/wall.mjs`
Expected: PASS（既有回归不受默认开启影响）。
Run: `npm test`
Expected: 全部 PASS。

- [ ] **Step 5: 收尾**

等用户确认后再提交。

---

### Task 5: 调试页（人脸部分）

**Files:**
- Create: `public/debug.html`
- Create: `public/debug.css`
- Create: `public/debug.js`
- Modify: `package.json`（`test:browser` 追加 `test/debug.mjs`）
- Test: `test/debug.mjs`（新建）
- Modify: `README.md`（新增“调试页”小节）

**Interfaces:**
- Consumes: `Camera`、`loadFaceTuning`、`enrolled/remember/forget/addSample`（Task 4），`rank`（Task 2），`/api/wall` 的 `profiles`。
- Produces（供 Task 6 扩展）：`debug.js` 内部函数 `start()`、`stop()`、`renderScores(payload)`、`applyTuning()`；页面元素 id：`video`、`overlay`、`device`、`size`、`toggle`、`scores`、`status`、`enroll-list`、`gesture-panel`、`gesture-log`、`gesture-toggle`。

- [ ] **Step 1: 写失败测试 `test/debug.mjs`**

端口 `4333`；`addInitScript` 安装空白假摄像头（同 Task 4），`goto(url + '/debug.html')`。

```js
await page.locator('#video').waitFor();
await page.waitForFunction(() => document.querySelector('#video').videoWidth > 0);
assert.ok(await page.locator('#overlay').isVisible());
assert.equal(await page.locator('#match-threshold').inputValue(), '0.48');
assert.equal(await page.locator('#margin').inputValue(), '0.07');
await page.locator('#match-threshold').evaluate(el => { el.value = '0.55'; el.dispatchEvent(new Event('input', { bubbles: true })); });
assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('morning.face.tuning')).matchThreshold), 0.55);
await page.locator('#scores').filter({ hasText: '未检测到人脸' }).waitFor();
await page.locator('#device option').first().waitFor();
assert.deepEqual(errors, []);
```

另外断言页面无 `#debug` 以外的主界面元素（不加载 `/app.js`）：`page.on('response')` 记录 `/app.js`，断言未请求。

- [ ] **Step 2: 运行并确认失败**

Run: `node test/debug.mjs`
Expected: FAIL（404/元素不存在）。

- [ ] **Step 3: 实现调试页**

- `debug.html`：独立页面，只加载 `/debug.css` 与 `/debug.js`；结构按设计 §6.1，包含视频区（`<video id="video" muted playsinline>` + `<canvas id="overlay">`）、右侧状态/分数、滑杆（`#match-threshold`、`#margin`、`#detect-score`、`#input-size`）、设备/分辨率选择、样本按钮、手势面板占位（Task 6 填充）。
- `debug.js`：
  - 构造 `new Camera(video, onFrame, onError, loadFaceTuning())` 并 `setDebug(true)`；页面加载即 `openCamera()`。
  - `onFrame`：更新 `#status`（人脸数、帧耗时、人脸/手部 fps 占位）、`#scores`（每人一行“姓名 距离”，第一名 `data-best`），在 `overlay` 用 `devicePixelRatio` 缩放绘制矩形与 68 点。
  - 滑杆 `input` 事件写 `morning.face.tuning` 并 `camera.setTuning`；按钮恢复默认。
  - 设备下拉：`enumerateDevices()` 填充，选择写 `morning.camera.device` 并重开流；分辨率写 `morning.camera.size` 并重开流。
  - 样本区：从 `/api/wall` 取 `profiles`，选择成员后“采集当前人脸”用最近一帧 `face` 调 `addSample`，3 组后 `remember`；导出/导入/清空模板 JSON。
  - 视频与叠加层尺寸跟随 `video.videoWidth/Height`，窗口 `resize` 时重算。
  - 所有异步错误写入 `#status`，不抛出未捕获异常。
- `README.md`：新增“调试页”小节，写明 `http://127.0.0.1:4317/debug.html`、无主界面入口、参数刷新后生效。

- [ ] **Step 4: 运行测试**

Run: `node test/debug.mjs`
Expected: PASS。
Run: `node test/wall.mjs`
Expected: PASS（未受影响的既有回归）。

- [ ] **Step 5: 收尾**

等用户确认后再提交。

---

### Task 6: GestureEngine 与调试页手势面板

**Files:**
- Create: `public/gesture.js`
- Modify: `public/debug.html`、`public/debug.js`、`public/debug.css`
- Modify: `test/debug.mjs`
- Modify: `README.md`（调试页小节补充手势）

**Interfaces:**
- Consumes: `analyzeHand`、`GestureStateMachine`、`DEFAULT_GESTURE_SETTINGS`、`loadFaceTuning`（Task 3/4）。
- Produces:

```js
export class GestureEngine {
  constructor(video, { onFrame = () => {}, onEvent = () => {}, settings = {} } = {});
  async start();        // 加载模型并启动检测循环；失败时 reject 且不留下定时器
  stop();               // 停循环并 close()
  updateSettings(partial);
  get running();
}
```

- `onFrame({ hands:[{ landmarks, handedness, score }], pose, confidence, at })`。
- `onEvent(Event)` 类型同 Task 3。

- [ ] **Step 1: 扩展失败测试 `test/debug.mjs`**

```js
// 手势面板存在且引擎可用
await page.locator('#gesture-panel').waitFor();
await page.locator('#gesture-toggle').click();          // 启动
await page.locator('#gesture-state').filter({ hasText: '未检测到' }).waitFor({ timeout: 60000 });
assert.equal(await page.evaluate(() => localStorage.getItem('morning.gesture.tuning') !== null), true);

// 模型 404 时优雅降级
const bad = await browser.newPage();
await bad.addInitScript(fakeCamera);
await bad.route('**/models/hand_landmarker.task', route => route.abort());
await bad.goto(url + '/debug.html');
await bad.locator('#gesture-toggle').click();
await bad.locator('#gesture-error').filter({ hasText: '手势' }).waitFor({ timeout: 30000 });
assert.equal(await bad.evaluate(() => document.querySelector('#video').videoWidth > 0), true);
assert.deepEqual(badErrors, []);
```

- [ ] **Step 2: 运行并确认失败**

Run: `node test/debug.mjs`
Expected: FAIL（元素不存在）。

- [ ] **Step 3: 实现 `public/gesture.js`**

- 动态导入：`const api = await import('/mediapipe/vision_bundle.mjs')`。
- `const fileset = await api.FilesetResolver.forVisionTasks('/mediapipe/wasm')`。
- `HandLandmarker.createFromOptions(fileset, { baseOptions:{ modelAssetPath:'/models/hand_landmarker.task', delegate:'CPU' }, runningMode:'VIDEO', numHands:2, minHandDetectionConfidence:0.5, minHandPresenceConfidence:0.5, minTrackingConfidence:0.5 })`。`delegate` 固定 `'CPU'`：主屏已有 WebGL 角色上下文，避免冲突。
- 循环：`setTimeout` 每 `settings.intervalMs` 毫秒；时间戳 `performance.now()`，若非递增则 `+1`。首次加载失败由 `start()` reject；循环内异常调用 `this.stop()` 并 `console.error`，不抛出未捕获异常。
- 取 `result.landmarks` 与 `result.handedness`，逐手 `analyzeHand`；选 `handedness[0].score` 最高的手驱动状态机；置信度 = `analyzeHand.ruleScore * handedness[0].score`；`hand` 传 `handedness[0].categoryName`。
- `onFrame` 传全部手的关键点供绘制。
- `stop()` 清定时器、`handLandmarker.close?.()`、置空引用；可重复调用。

- [ ] **Step 4: 调试页手势面板**

- 工具栏：“启动手势 / 停止手势”按钮 `#gesture-toggle`；全局开关 `#gesture-enabled`（写 `morning.gesture.enabled`，默认勾选）。
- 状态区：`#gesture-state`（当前手势 + 置信度，无手时“未检测到”）、`#gesture-error`（加载错误）。
- 手部骨架绘制：在 `#overlay` 上以 `HAND_CONNECTIONS` 常量（21 点连线对）绘制，颜色与脸不同。
- `#gesture-log` 最近 20 条事件（时间 + 手势），`#gesture-export` 导出最近一帧 `{landmarks, handedness, at}` 为 JSON。
- 设置滑杆：稳定帧、保持毫秒、冷却毫秒、检测间隔；写 `morning.gesture.tuning` 并 `updateSettings`。页面初始化时把“默认值 + 存储值”的合并结果写回该键，便于导出与测试。
- 页面卸载 `beforeunload` 时 `engine.stop()`。

- [ ] **Step 5: 运行测试**

Run: `node test/debug.mjs`
Expected: PASS。
Run: `npm test`
Expected: 全部 PASS。

- [ ] **Step 6: 收尾**

等用户确认后再提交。

---

### Task 7: 主屏手势动作接入与回归

**Files:**
- Modify: `public/app.js`
- Modify: `public/avatar.js`（导出 `greet()`）
- Modify: `README.md`（“成员与走近识别”补充手势与隐私说明）
- Modify: `package.json`（`test:browser` 追加 `test/wall-gesture.mjs`）
- Test: `test/wall-gesture.mjs`（新建）

**Interfaces:**
- Consumes: `GestureEngine`（Task 6，构造签名 `(video, { onEvent, settings })`）、`resolveGestureAction`（Task 3）、`Camera` 生命周期（Task 4）。
- Produces: `avatar.js` 的 `export function greet()`；无其它公共接口。

- [ ] **Step 1: 写失败测试 `test/wall-gesture.mjs`**

用 Playwright 拦截 `/gesture.js` 换成桩模块，避免在回归里加载 MediaPipe：

```js
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
```

服务器端口 `4334`，其余脚手架与 `test/wall.mjs` 相同。

Run: `node test/wall-gesture.mjs`
Expected: FAIL（`window.__gestureReady` 永远不为真，app 没有加载手势）。

- [ ] **Step 2: 实现 `app.js` 手势接入**

- 顶部 `import { greet } from './avatar.js';`；`avatar.js` 抽出 `export function greet()`，`#avatar-greet` 的 `onclick` 改为 `greet`。
- 在所有 `let` 声明区、`new Camera(...)` 之前加入：`let gesture = null, gestureStarting = false, navAt = 0;`
- `gestureEnabled()`：`localStorage.getItem('morning.gesture.enabled') !== 'off'`。
- `startGestures()`：`if (gesture || gestureStarting || !gestureEnabled() || !camera.streaming) return;`；`gestureStarting = true`；动态 `import('/gesture.js')`，构造 `new GestureEngine(video, { onEvent: handleGesture, settings: JSON.parse(localStorage.getItem('morning.gesture.tuning') || '{}') })`；`await engine.start()` 后赋值 `gesture = engine`；`catch` 时 `console.warn('手势不可用', e)` 并清空实例；`finally` 清 `gestureStarting`。
- 启动流程：`loadWall()` 成功后，若 `camera.streaming && gestureEnabled()` 则 `void startGestures()`。
- `handleGesture(event)`：`if (!wall || Date.now() - navAt < 300) return;` 后调用 `resolveGestureAction(event, { enabled: gestureEnabled(), dialog, candidateVia: candidate?.via, personalVia: personal?.via, faceActive: camera.faceActive })`，按返回值执行：`confirm` → `$('yes')?.click()`；`cancel` → `closeDialog()`；`home` → `home()`；`resumeFace` → `void startFace()`；`greet` → `greet()`。
- `confirmPerson`、`closeDialog`、`home` 开头设置 `navAt = Date.now()`。
- `camera` 的错误回调里额外 `gesture?.stop(); gesture = null;`。
- 页面卸载：`window.addEventListener('pagehide', () => { gesture?.stop(); camera.stop(); })`。
- `README.md`：补充手势映射、默认开启与摄像头常驻的隐私说明、Mac 打包暂未包含。
- `package.json` 的 `test:browser` 脚本追加 `test/wall-gesture.mjs`。

- [ ] **Step 3: 运行测试**

Run: `node test/wall-gesture.mjs`
Expected: PASS。
Run: `node test/camera.mjs`
Expected: PASS。
Run: `node test/debug.mjs`
Expected: PASS。
Run: `node test/wall.mjs`
Expected: PASS。

- [ ] **Step 4: 全量回归**

Run: `npm test && npm run test:browser`
Expected: 全部 PASS（Node 单测 + wall/camera/debug/wall-gesture 四个浏览器脚本）。

- [ ] **Step 5: 手工验收（Windows）**

按设计 §8 手测清单执行，记录：2 米内四种手势在调试页的置信度；确认弹窗手势确认/取消；个人屏挥手返回；调参刷新后保持；10 次路人经过无误触发。

- [ ] **Step 6: 收尾**

等用户确认后再提交。

---

## Self-Review

- **Spec coverage:** 调试页（Task 5）、参数调节/持久化（Task 2/4/5）、特征管理（Task 5）、手势判据与状态机（Task 3）、MediaPipe 与资源（Task 1/6）、主屏映射与守卫（Task 3/7）、默认开启与常开流（Task 4/7）、降级（Task 6/7）、测试（各任务）、README（Task 5/6/7）、Mac 包不在范围（全局约束/README）。
- **Type consistency:** `GestureEngine.onFrame` 的 `hands` 字段由 Task 6 定义、Task 6 调试页消费；`Camera` 的 `streaming/faceActive/active` 在 Task 4 定义、Task 7 使用；`resolveGestureAction` 的 context 字段在各任务一致。
- **Review Focus tests:** 权限拒绝（Task 4 用例 3）、模型 404（Task 6 测试）、异常关键点（Task 3 测试）、挥手抑制（Task 3 测试）、轨道断开（Task 4 用例 4）。
- **Proportion:** 计划代码块仅包含测试、接口签名与固定数值，实现细节由执行者完成。
