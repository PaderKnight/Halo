# 手势指针、悬浮信息窗与翻页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 Halo 增加食指空气指针、停留点击、悬浮信息窗与张开手掌左右翻页，并把标定与调参接到现有调试页。

**Architecture:** 纯逻辑分两层：`gesture-rules.js` 负责指姿、横滑状态机与动作语义；新文件 `pointer-rules.js` 负责坐标映射、仿射标定与停留控制器。`gesture.js` 只做 MediaPipe 适配并把指尖/镜像方向交给这两层。`app.js` 负责 DOM 命中、光标与上下文守卫；`dashboard.js` 负责信息窗分页。光标使用 `popover="manual"` 进入浏览器顶层，避免被 `<dialog>` 的 `backdrop-filter` 改变定位基准。

**Tech Stack:** Node 22+、原生 ESM、`@mediapipe/tasks-vision@1.2.3`（已锁定）、Playwright（已有）、无新增依赖。

**Spec:** `docs/superpowers/specs/2026-11-24-gesture-pointer-info-window-design.md`

## Global Constraints

- 服务只监听 `127.0.0.1`，不改 Host/Origin 校验。
- 前端不得引入 CDN；MediaPipe 运行时与模型保持本地托管；不新增第三方依赖。
- `morning.gesture.enabled` 缺省视为 on；值为 `'off'` 时不得启动指针、停留点击或翻页。
- 现有手势默认值保持不变；新增默认值固定为：`pointerDwellMs:1000`、`pointerSmoothing:0.35`、`pointerLostMs:500`、`pointerCooldownMs:800`、`swipeMinDistance:0.18`、`swipeMaxMs:600`、`swipeMaxRise:0.12`、`swipeCooldownMs:700`、`swipeSuppressMs:300`、`swipeSettleMs:320`、`swipeSettleDistance:0.02`。
- 存储键固定：`morning.gesture.tuning`、`morning.gesture.pointer`、`morning.camera.device`、`morning.camera.size`；不新增其他键。
- 所有新增用户可见文案用简体中文，语气与现有界面一致。
- 现有 Playwright 用例在加载前设置 `morning.gesture.enabled = 'off'`；新增用例同样不得依赖真实摄像头或真实手部。
- 工作区已有未提交改动（`README.md`、`brief.mjs`、`public/camera.js`、`public/debug.*`、`test/brief.test.mjs`、`test/debug.mjs`）；不得回退或覆盖与本次无关的改动。
- **未经用户明确同意，不执行 `git commit` / `git push`。** 每个任务以测试通过和工作区改动收尾；把模板里的 Commit 步骤换成“Checkpoint”。
- 目标浏览器为 Chrome；Playwright 使用已有 `channel:'chrome'`。

## Review Focus

1. **摄像头或分辨率变化后仍套用旧标定** → 应回退默认映射并提示重新标定，而不是让光标整体偏移。
2. **手部关键点抖动、指姿短暂丢失** → 光标不得瞬移或误点；500ms 内保持最后位置且暂停进度。
3. **张开手掌横滑与挥手/确认混淆** → 单方向滑动只翻页，来回摆动只挥手，滑动后 300ms 不产生 `openPalm`。
4. **信息窗打开后光标不可见或坐标错误** → `<dialog>` 带 `backdrop-filter`，光标必须用 popover 顶层，不能作为 dialog 的固定定位后代。
5. **设置/确认/录入弹窗打开时被指针点击** → 非主屏、非信息窗上下文必须隐藏光标并拒绝点击。
6. **空模块或无数据时打开信息窗** → 应显示一页合理的空状态，不得抛错或出现 `1 / 0`。
7. **个人简报上停留时握拳** → 只取消停留，不得顺带退回团队晨报；信息窗内握拳仍应关闭窗口。

---

### Task 1: 手势规则（指向、横滑、信息窗动作）

**Files:**
- Modify: `public/gesture-rules.js`
- Test: `test/gesture.test.mjs`

**Interfaces:**
- Consumes: 现有 `analyzeHand`、`GestureStateMachine`、`resolveGestureAction` 的调用方。
- Produces:
  - `analyzeHand(landmarks) -> { pose, extended, palmX, palmY, tipX, tipY, ruleScore }`，`pose` 新增 `'point'`。
  - `mirrorX(x, mirror = true) -> number`：`mirror ? 1 - x : x`。
  - `GestureStateMachine.push({ pose, confidence, palmX, swipeX, palmY, hand, at })` 可发出 `swipeLeft` / `swipeRight`。
  - `resolveGestureAction(event, ctx)` 在 `ctx.dialog === 'info'` 时返回 `'closeInfo'`、`'pageNext'`、`'pagePrev'` 或 `null`。
  - `DEFAULT_GESTURE_SETTINGS` 增加 Global Constraints 中的九个键。

- [ ] **Step 1: 写失败测试**

在 `test/gesture.test.mjs` 的导入中加入 `mirrorX`：

```js
import {
  analyzeHand, GestureStateMachine, resolveGestureAction, DEFAULT_GESTURE_SETTINGS, mirrorX,
} from '../public/gesture-rules.js';
```

在夹具区追加：

```js
const point = hand({
  0:{x:.5,y:.8}, 1:{x:.43,y:.73}, 2:{x:.34,y:.66}, 3:{x:.28,y:.60}, 4:{x:.20,y:.54},
  5:{x:.44,y:.64}, 6:{x:.44,y:.53}, 7:{x:.44,y:.46}, 8:{x:.44,y:.36},
  9:{x:.50,y:.62}, 10:{x:.50,y:.52}, 11:{x:.51,y:.60}, 12:{x:.52,y:.67},
  13:{x:.56,y:.64}, 14:{x:.56,y:.55}, 15:{x:.55,y:.62}, 16:{x:.54,y:.68},
  17:{x:.61,y:.66}, 18:{x:.61,y:.58}, 19:{x:.60,y:.64}, 20:{x:.59,y:.69},
});
const pointAndMiddle = hand({
  ...point.reduce((map, p, i) => { map[i] = p; return map; }, {}),
  10:{x:.50,y:.52}, 11:{x:.50,y:.44}, 12:{x:.50,y:.34},
});
```

追加测试：

```js
test('classifies index-pointing pose and exposes the fingertip', () => {
  const result = analyzeHand(point);
  assert.equal(result.pose, 'point');
  assert.equal(result.tipX, .44);
  assert.equal(result.tipY, .36);
});
test('point is rejected when the middle finger is also extended', () => {
  assert.notEqual(analyzeHand(pointAndMiddle).pose, 'point');
});
test('malformed landmarks expose NaN fingertip without throwing', () => {
  assert.ok(Number.isNaN(analyzeHand([]).tipX));
  assert.ok(Number.isNaN(analyzeHand(Array(21).fill({x:NaN,y:NaN})).tipY));
});
test('mirrorX flips only when mirroring is on', () => {
  assert.equal(mirrorX(0.2), 0.8);
  assert.equal(mirrorX(0.2, false), 0.2);
});
```

追加横滑测试（`swipeFrame` 同时给 `palmX` 与 `swipeX`，避免挥手判据干扰）：

```js
const swipeFrame = (swipeX, at, { palmY = 0.5, palmX = 0.5, confidence = 0.9 } = {}) => ({
  pose: 'openPalm', confidence, palmX, swipeX, palmY, hand: 'Right', at,
});
test('emits one swipe right after the hand settles', () => {
  const sm = new GestureStateMachine({ stableFrames: 1, holdMs: 10000, cooldownMs: 0 });
  const xs = [0.2, 0.32, 0.45, 0.58, 0.7, 0.7, 0.7, 0.7, 0.7];
  const events = xs.flatMap((x, i) => sm.push(swipeFrame(x, i * 80)));
  assert.deepEqual(events.map(e => e.type), ['swipeRight']);
});
test('emits swipe left for the opposite sweep', () => {
  const sm = new GestureStateMachine({ stableFrames: 1, holdMs: 10000, cooldownMs: 0 });
  const xs = [0.7, 0.58, 0.45, 0.32, 0.2, 0.2, 0.2, 0.2, 0.2];
  const events = xs.flatMap((x, i) => sm.push(swipeFrame(x, i * 80)));
  assert.deepEqual(events.map(e => e.type), ['swipeLeft']);
});
test('does not swipe until the hand settles, on a slow move or vertical drift', () => {
  const moving = new GestureStateMachine({ stableFrames: 1, holdMs: 10000, cooldownMs: 0 });
  const movingEvents = [0.2, 0.45, 0.7].flatMap((x, i) => moving.push(swipeFrame(x, i * 80)));
  assert.equal(movingEvents.some(e => e.type.startsWith('swipe')), false);
  assert.deepEqual(moving.push(swipeFrame(0.7, 480)).map(e => e.type), ['swipeRight']);

  const slow = new GestureStateMachine({ stableFrames: 1, holdMs: 10000, cooldownMs: 0 });
  const slowEvents = [0.2, 0.25, 0.3, 0.35, 0.4, 0.4].flatMap((x, i) => slow.push(swipeFrame(x, i * 200)));
  assert.equal(slowEvents.some(e => e.type.startsWith('swipe')), false);

  const drift = new GestureStateMachine({ stableFrames: 1, holdMs: 10000, cooldownMs: 0 });
  const driftEvents = [0.2, 0.32, 0.45, 0.58, 0.7, 0.7, 0.7, 0.7, 0.7].flatMap((x, i) => drift.push(
    swipeFrame(x, i * 80, { palmY: 0.2 + i * 0.1 }),
  ));
  assert.equal(driftEvents.some(e => e.type.startsWith('swipe')), false);
});
test('a wave with a sampled peak does not emit a swipe', () => {
  const wave = new GestureStateMachine({ stableFrames: 1, holdMs: 10000, cooldownMs: 0, waveWindowMs: 1200 });
  const palms = [0.3, 0.55, 0.55, 0.3, 0.55, 0.55, 0.3];
  const events = palms.flatMap((palm, i) => wave.push(swipeFrame(1 - palm, i * 80, { palmX: palm })));
  assert.equal(events.some(e => e.type === 'swipeRight' || e.type === 'swipeLeft'), false);
  assert.equal(events.some(e => e.type === 'wave'), true);
});
test('swipe requires the minimum confidence', () => {
  const sm = new GestureStateMachine({
    stableFrames: 1, holdMs: 10000, cooldownMs: 0, minConfidence: 0.6,
  });
  const events = [0.2, 0.45, 0.7, 0.7, 0.7, 0.7, 0.7].flatMap((x, i) => sm.push(
    swipeFrame(x, i * 80, { confidence: 0.2 }),
  ));
  assert.equal(events.some(e => e.type.startsWith('swipe')), false);
});
test('swipe cooldown discards pre-expiry samples', () => {
  const sm = new GestureStateMachine({
    stableFrames: 1, holdMs: 10000, cooldownMs: 0, swipeCooldownMs: 700,
  });
  const first = [0.2, 0.45, 0.7, 0.7, 0.7, 0.7, 0.7].flatMap((x, i) => sm.push(swipeFrame(x, i * 80)));
  assert.equal(first.filter(e => e.type === 'swipeRight').length, 1);
  const pre = [0.7, 0.45, 0.2, 0.2].flatMap((x, i) => sm.push(swipeFrame(x, 900 + i * 80)));
  assert.equal(pre.some(e => e.type.startsWith('swipe')), false);
  const post = [0.2, 0.2, 0.2].flatMap((x, i) => sm.push(swipeFrame(x, 1220 + i * 80)));
  assert.equal(post.some(e => e.type.startsWith('swipe')), false);
});
test('swipe suppresses openPalm for the configured window', () => {
  const sm = new GestureStateMachine({
    stableFrames: 1, holdMs: 10000, cooldownMs: 0, swipeSuppressMs: 300, waveWindowMs: 99999,
  });
  const sweep = [0.2, 0.45, 0.7, 0.7, 0.7, 0.7, 0.7].flatMap((x, i) => sm.push(swipeFrame(x, i * 80)));
  assert.equal(sweep.some(e => e.type === 'swipeRight'), true);
  sm.updateSettings({ stableFrames: 1, holdMs: 0 });
  assert.equal(sm.push(swipeFrame(0.5, 560)).length, 0);
  assert.deepEqual(sm.push(swipeFrame(0.5, 800)).map(e => e.type), ['openPalm']);
});
test('resolveGestureAction handles the info window', () => {
  const evt = type => ({ type, confidence: 0.9, at: 0, hand: 'Right' });
  const info = { enabled: true, dialog: 'info', candidateVia: null, personalVia: null, faceActive: true };
  assert.equal(resolveGestureAction(evt('swipeLeft'), info), 'pageNext');
  assert.equal(resolveGestureAction(evt('swipeRight'), info), 'pagePrev');
  assert.equal(resolveGestureAction(evt('fist'), info), 'closeInfo');
  assert.equal(resolveGestureAction(evt('wave'), info), null);
  assert.equal(resolveGestureAction(evt('openPalm'), info), null);
  assert.equal(resolveGestureAction(evt('thumbsUp'), info), null);
  assert.equal(resolveGestureAction(evt('swipeLeft'), { ...info, enabled: false }), null);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/gesture.test.mjs`
Expected: FAIL，`mirrorX is not a function` 或 `point` 判定失败。

- [ ] **Step 3: 实现 `public/gesture-rules.js`**

- `DEFAULT_GESTURE_SETTINGS` 追加十一个新键，值见 Global Constraints。
- `nullPose()` 追加 `tipX: NaN, tipY: NaN`。
- `analyzeHand`：
  - 校验通过后取 `tipX = p[8].x`、`tipY = p[8].y`。
  - 现有 `openPalm` → `thumbsUp` → `fist` 的顺序中，在 `thumbsUp` 之后、`fist` 之前加 `point`：食指伸出且中指、无名指、小指均弯曲（`fingers[0] && !fingers[1] && !fingers[2] && !fingers[3]`），`satisfied = 4`、`required = 4`；拇指不参与。
  - 返回值追加 `tipX`、`tipY`。
- 导出 `mirrorX`。
- `GestureStateMachine`：
  - 构造函数初始化 `swipeSuppressUntil = -Infinity`、`swipeCooldownUntil = -Infinity`、`_resetSwipe()`。
  - `push` 读取 `swipeX`、`palmY`（缺失为 `NaN`）。在 `pose === 'openPalm' && at < swipeSuppressUntil` 时重置 run、重置滑动窗口并返回 `[]`。
  - 先算 `waving`。滑动分支必须同时满足 `pose === 'openPalm'`、`!waving`、`confidence >= minConfidence`；否则重置滑动窗口。满足时调用 `_noteSwipe(at, swipeX, palmY)`。
  - `_noteSwipe` 返回 `swipeRight`/`swipeLeft` 时，重置 run 与 wave 窗口，设 `swipeSuppressUntil = at + swipeSuppressMs`、`swipeCooldownUntil = at + swipeCooldownMs`，返回事件。滑动事件不占用通用 `cooldownUntil`。
  - 挥手事件额外把 `swipeSuppressUntil` 设为 `at + swipeSuppressMs`，并重置滑动窗口。
  - 非 `openPalm`、空姿势或置信度不足时重置滑动窗口。
  - `_noteSwipe`：
    - 非有限 `swipeX`/`palmY` 或处于 `swipeCooldownMs` 冷却时，先清空窗口再返回 `null`（避免冷却前的样本在冷却结束时立刻触发）。
    - 保留最近 `swipeMaxMs` 的点；少于 3 点返回 `null`。
    - 首尾 `|Δx| ≥ swipeMinDistance`；`|Δy| ≤ swipeMaxRise`；否则返回 `null`。
    - 方向一致：按时间顺序扫描相邻位移，忽略 `|步长| < 0.02` 的抖动；一旦出现方向反转（正负切换）就返回 `null`，这是挥手与滑动的分界。
    - 静止确认：最近 `swipeSettleMs`（320ms）内至少有 2 个采样点，且水平位移 `≤ swipeSettleDistance`（0.02）；仍在移动或样本不足时返回 `null`，等下一帧再判定。这样挥手峰值处的重复采样或减速会让方向反转先进入窗口。
    - 触发后清空窗口、设置冷却，返回方向。
- `resolveGestureAction`：在 `enabled` 检查之后、其他分支之前，若 `ctx.dialog === 'info'`，仅处理 `fist → 'closeInfo'`、`swipeLeft → 'pageNext'`、`swipeRight → 'pagePrev'`，其余返回 `null`。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/gesture.test.mjs`
Expected: PASS，原有 7 个用例继续通过，新增用例全部通过（共 19 个）。

- [ ] **Step 5: Checkpoint**

Run: `npm test`
Expected: 全部通过。不要提交；保留工作区改动。

---

### Task 2: 指针纯逻辑（映射、标定、停留控制器）

**Files:**
- Create: `public/pointer-rules.js`
- Create: `test/pointer.test.mjs`
- Modify: `package.json`（`test` 脚本追加 `test/pointer.test.mjs`）

**Interfaces:**
- Consumes: `DEFAULT_GESTURE_SETTINGS`、`mirrorX`（来自 Task 1）。
- Produces:
  - `DEFAULT_POINTER_MAP = { left: 0.15, right: 0.85, top: 0.15, bottom: 0.9 }`
  - `mapToScreen({ x, y }, calibration, mirror = true) -> { x, y }`（输入原始归一化指尖，内部先镜像；输出夹取到 0..1）
  - `solveAffine(pairs, mirror = true) -> { a,b,c,d,e,f } | null`；`pairs` 为 `{ rawX, rawY, screenX, screenY }`
  - `isCalibrationCurrent(savedCamera, currentCamera) -> boolean`；两侧形如 `{ device, size }`
  - `pointerContextAllowed({ dialog, enabled, streaming }) -> boolean`
  - `new PointerController({ settings })`，`update({ x, y, active, at, target }) -> { visible, x, y, key, progress, click }`，`reset()`

- [ ] **Step 1: 写失败测试**

创建 `test/pointer.test.mjs`：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_POINTER_MAP, mapToScreen, solveAffine, isCalibrationCurrent,
  pointerContextAllowed, PointerController,
} from '../public/pointer-rules.js';

test('default mapping mirrors raw coordinates and clamps to the screen', () => {
  const mid = mapToScreen({ x: 0.5, y: 0.5 });
  assert.ok(Math.abs(mid.x - 0.5) < 1e-9);
  assert.ok(Math.abs(mid.y - 0.4666666666666667) < 1e-9);
  assert.ok(mapToScreen({ x: 0.2, y: 0.5 }).x > 0.9);
  assert.ok(mapToScreen({ x: 0.8, y: 0.5 }).x < 0.1);
  assert.deepEqual(mapToScreen({ x: 2, y: -1 }), { x: 0, y: 0 });
  assert.ok(mapToScreen({ x: 0.2, y: 0.5 }, null, false).x < 0.1);
});

test('affine calibration restores a known transform on mirrored input', () => {
  const expected = { a: 0.6, b: 0.1, c: 0.2, d: 0.05, e: 0.7, f: 0.1 };
  const pairs = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]].map(([rawX, rawY]) => {
    const mx = 1 - rawX;
    return {
      rawX, rawY,
      screenX: expected.a * mx + expected.b * rawY + expected.c,
      screenY: expected.d * mx + expected.e * rawY + expected.f,
    };
  });
  const cal = solveAffine(pairs, true);
  assert.ok(cal);
  for (const key of Object.keys(expected)) assert.ok(Math.abs(cal[key] - expected[key]) < 1e-9);
  const point = mapToScreen({ x: 0.1, y: 0.1 }, cal, true);
  assert.ok(Math.abs(point.x - pairs[0].screenX) < 1e-9);
  assert.ok(Math.abs(point.y - pairs[0].screenY) < 1e-9);
});

test('degenerate calibration returns null', () => {
  const same = { rawX: 0.5, rawY: 0.5, screenX: 0.5, screenY: 0.5 };
  assert.equal(solveAffine([same, same, same, same], true), null);
});

test('calibration validity compares camera fingerprint', () => {
  assert.equal(isCalibrationCurrent({ device: 'a', size: '1280x720' }, { device: 'a', size: '1280x720' }), true);
  assert.equal(isCalibrationCurrent({ device: 'a', size: '1280x720' }, { device: 'b', size: '1280x720' }), false);
  assert.equal(isCalibrationCurrent(null, { device: '', size: '1280x720' }), false);
});

test('pointer context is limited to the wall and info window', () => {
  assert.equal(pointerContextAllowed({ dialog: '', enabled: true, streaming: true }), true);
  assert.equal(pointerContextAllowed({ dialog: 'info', enabled: true, streaming: true }), true);
  assert.equal(pointerContextAllowed({ dialog: 'settings', enabled: true, streaming: true }), false);
  assert.equal(pointerContextAllowed({ dialog: 'confirm', enabled: true, streaming: true }), false);
  assert.equal(pointerContextAllowed({ dialog: '', enabled: false, streaming: true }), false);
  assert.equal(pointerContextAllowed({ dialog: '', enabled: true, streaming: false }), false);
});

const settings = { pointerDwellMs: 100, pointerSmoothing: 1, pointerLostMs: 100, pointerCooldownMs: 200 };
const target = { key: 'card:m1', inside: true };

test('dwell clicks once on a stable target', () => {
  const p = new PointerController({ settings });
  assert.equal(p.update({ x: .5, y: .5, active: true, at: 0, target }).click, false);
  assert.equal(p.update({ x: .5, y: .5, active: true, at: 60, target }).click, false);
  assert.equal(p.update({ x: .5, y: .5, active: true, at: 110, target }).click, true);
  assert.equal(p.update({ x: .5, y: .5, active: true, at: 120, target }).click, false);
  assert.equal(p.update({ x: .5, y: .5, active: true, at: 300, target }).click, false);
  assert.equal(p.update({ x: .5, y: .5, active: true, at: 420, target }).click, true);
});

test('changing or leaving the target resets dwell', () => {
  const p = new PointerController({ settings });
  p.update({ x: .5, y: .5, active: true, at: 0, target });
  const changed = p.update({ x: .5, y: .5, active: true, at: 60, target: { key: 'card:m2', inside: true } });
  assert.equal(changed.progress, 0);
  const left = p.update({ x: .5, y: .5, active: true, at: 120, target: { key: null, inside: false } });
  assert.equal(left.progress, 0);
  assert.equal(left.click, false);
});

test('inactive hand keeps the last position then hides', () => {
  const p = new PointerController({ settings });
  p.update({ x: .5, y: .5, active: true, at: 0, target });
  assert.equal(p.update({ x: .5, y: .5, active: false, at: 50, target: null }).visible, true);
  const hidden = p.update({ x: .5, y: .5, active: false, at: 150, target: null });
  assert.equal(hidden.visible, false);
  assert.equal(hidden.progress, 0);
});

test('smoothing follows the alpha', () => {
  const p = new PointerController({ settings: { ...settings, pointerSmoothing: .5 } });
  const first = p.update({ x: 0, y: 0, active: true, at: 0, target: null });
  assert.deepEqual({ x: first.x, y: first.y }, { x: 0, y: 0 });
  const second = p.update({ x: 1, y: 1, active: true, at: 10, target: null });
  assert.deepEqual({ x: second.x, y: second.y }, { x: .5, y: .5 });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/pointer.test.mjs`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 `public/pointer-rules.js`**

- 导入 `DEFAULT_GESTURE_SETTINGS` 与 `mirrorX`。
- `DEFAULT_POINTER_MAP` 用上面的常量。
- `mapToScreen`：先 `mirrorX(x, mirror)`；标定有效时用 `a..f` 仿射，否则用默认矩形；结果 `clamp01`。
- `solveAffine`：过滤有限值；把 `rawX` 按 `mirror` 换算；构造 `[mx, rawY, 1]` 设计矩阵；用最小二乘正规方程分别解 `screenX`、`screenY` 的三元一次方程组；行列式过小或点数不足返回 `null`。
- `isCalibrationCurrent(saved, current)`：两侧 `device` 与 `size` 严格相等才为 `true`；任一侧缺失为 `false`。
- `pointerContextAllowed`：`enabled !== false && streaming === true && (!dialog || dialog === 'info')`。
- `PointerController`：
  - 设置合并 `DEFAULT_GESTURE_SETTINGS`。
  - 状态：`smoothed = null`、`lastActiveAt = -Infinity`、`targetKey = null`、`hoverStart = 0`、`cooldownUntil = 0`。
  - `update`：`active` 且坐标有限时做 EMA（`smoothed = smoothed + alpha * (next - smoothed)`，首帧直接取值）；更新 `lastActiveAt`。`key = target?.inside && target.key ? target.key : null`。目标键变化或为空时重置 `hoverStart`。满足停留时长且不在冷却时 `click = true`，并把 `cooldownUntil` 推到 `at + pointerCooldownMs`、`hoverStart = at`、进度归零；否则返回 `min(1, (at - hoverStart) / pointerDwellMs)`。
  - `active` 为假时：若 `at - lastActiveAt > pointerLostMs` 则 `reset()` 并返回不可见；否则返回最后位置、`key: null`、`progress: 0`。
  - `reset()` 清空所有状态。
- `package.json` 的 `test` 脚本在 `test/gesture.test.mjs` 后追加 `test/pointer.test.mjs`。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/pointer.test.mjs`
Expected: PASS。

- [ ] **Step 5: Checkpoint**

Run: `npm test`
Expected: 全部通过。不要提交。

---

### Task 3: 手势引擎接线

**Files:**
- Modify: `public/gesture.js`
- Test: `test/gesture.test.mjs`（沿用 Task 1 的 `mirrorX` 测试；本任务只做语法与全量回归）

**Interfaces:**
- Consumes: `mirrorX`（Task 1）；`analyzeHand` 的 `tipX/tipY`。
- Produces:
  - `GestureEngine` 的 `settings.mirror`（默认 `true`）与 `updateSettings({ mirror })`。
  - `onFrame` 载荷追加 `pointer: { x, y, active }`，`x/y` 为 landmark 8 的原始归一化坐标，`active` 仅在 `pose === 'point'` 时为 `true`。
  - `machine.push` 追加 `swipeX`（`mirror ? 1 - palmX : palmX`）与 `palmY`。

- [ ] **Step 1: 写失败测试**

本任务的适配层依赖 MediaPipe，不为它引入浏览器外的伪造运行时。先用现有纯逻辑测试锁定 `mirrorX` 行为（Task 1 已写），并加一个加载期检查：

Run: `node --check public/gesture.js`
Expected: 当前通过；完成改动后仍须通过。

- [ ] **Step 2: 实现 `public/gesture.js`**

- 导入 `mirrorX`。
- 构造函数：在 settings 合并后设置 `this.mirror = this.settings.mirror !== false`。
- `updateSettings`：合并后同步 `this.mirror`。
- `_detect`：
  - `const analysis = driver?.analysis;`
  - `const palmX = Number.isFinite(analysis?.palmX) ? analysis.palmX : NaN;`
  - `const palmY = Number.isFinite(analysis?.palmY) ? analysis.palmY : NaN;`
  - `const swipeX = Number.isFinite(palmX) ? mirrorX(palmX, this.mirror) : NaN;`
  - `machine.push({ pose, confidence, palmX, palmY, swipeX, hand, at })`。
  - `onFrame({ ..., pointer: { x: analysis?.tipX ?? NaN, y: analysis?.tipY ?? NaN, active: pose === 'point' } })`。
- 不改动现有事件、定时器、错误处理与 `hands` 结构。

- [ ] **Step 3: 运行语法与全量单测**

Run: `node --check public/gesture.js && npm test`
Expected: 语法通过，全部单测通过。

- [ ] **Step 4: Checkpoint**

不要提交；保留工作区改动。

---

### Task 4: 悬浮信息窗与分页（鼠标/键盘路径）

**Files:**
- Modify: `public/dashboard.js`
- Modify: `public/index.html`（给关闭按钮加 `data-gesture-key="info:close"`）
- Modify: `public/dashboard.css`
- Create: `test/info-window.mjs`
- Modify: `package.json`（`test:browser` 追加 `node test/info-window.mjs`）

**Interfaces:**
- Consumes: 现有 `createDashboard` 的 `data`、`eventsFor`、`contents`、`sourceLine`、`setDialog`、`updateClocks`。
- Produces:
  - `dashboard.openInfo(moduleId, index = 0) -> { index, total } | null`
  - `dashboard.flipPage(delta) -> { index, total } | null`
  - `dashboard.infoState() -> { open, moduleId, index, total } | null`
  - 卡片属性 `data-gesture-card="<moduleId>"`；条目属性 `data-gesture-item="<kind>:<moduleId>:<pageIndex>"`；信息窗可点元素 `data-gesture-key`。

- [ ] **Step 1: 写失败测试**

创建 `test/info-window.mjs`，沿用 `test/wall.mjs` 的临时数据与服务启动方式，端口固定 `4334`：

```js
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
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'morning-info-test-'));
const now=new Date(), day=editionDay(now), iso=now.toISOString();
const feeds=Object.fromEntries(catalog.map(s=>[s.repo,{checkedAt:iso,attemptedAt:iso,error:null,item:{
  title:'v1.0',tag:'v1.0',detail:'A release for the info window test.',publishedAt:iso,url:'https://github.com/'+s.repo+'/releases/tag/v1.0'}}]));
fs.writeFileSync(path.join(dir,'wall.json'),JSON.stringify({profiles:[defaultProfile],feeds,briefs:{demo:makeBrief(defaultProfile,feeds,day)},lastRunAt:iso}));
const port='4334',url='http://127.0.0.1:'+port;
const server=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,BRIEF_DATA:dir,PORT:port,BRIEF_OFFLINE:'1'},stdio:['ignore','pipe','pipe'],windowsHide:true});
let browser;
try {
  await Promise.race([once(server.stdout,'data'),once(server,'exit').then(()=>{throw Error('test server failed');})]);
  browser=await chromium.launch({channel:'chrome',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader'],headless:true});
  const p=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];p.on('pageerror',err=>errors.push(err.message));
  await p.addInitScript(() => { try { localStorage.setItem('morning.gesture.enabled','off'); } catch {} });
  await p.goto(url);
  await p.locator('.widget').first().waitFor();

  assert.equal(await p.locator('[data-gesture-card]').count(),15);
  await p.getByRole('button',{name:'设置今日关注',exact:true}).click();
  await p.getByLabel('关注清单').fill('第一行\n第二行\n第三行');
  await p.getByRole('button',{name:'保存模块',exact:true}).click();
  await p.locator('.widget-notes .note-lines').waitFor();
  assert.equal(await p.locator('.widget-notes [data-gesture-item]').count(),3);

  await p.locator('.widget-notes .widget-body').click();
  await p.locator('dialog[data-kind="info"]').waitFor();
  assert.equal(await p.locator('.info-page').innerText(),'1 / 3');
  assert.ok((await p.locator('.info-body').innerText()).includes('第一行'));

  await p.locator('[data-info-next]').click();
  assert.equal(await p.locator('.info-page').innerText(),'2 / 3');
  await p.keyboard.press('ArrowRight');
  assert.equal(await p.locator('.info-page').innerText(),'3 / 3');
  await p.keyboard.press('ArrowRight');
  assert.equal(await p.locator('.info-page').innerText(),'3 / 3');
  await p.keyboard.press('ArrowLeft');
  assert.equal(await p.locator('.info-page').innerText(),'2 / 3');
  assert.match(await p.locator('[data-info-next]').getAttribute('data-gesture-key'),/^info:next:/);

  await p.keyboard.press('Escape');
  await p.waitForFunction(() => !document.getElementById('modal').open);

  await p.locator('.widget-weather .widget-heading h2').click();
  await p.locator('dialog[data-kind="info"]').waitFor();
  assert.equal(await p.locator('.info-page').innerText(),'1 / 1');
  await p.keyboard.press('Escape');

  await p.getByRole('button',{name:'设置今日关注',exact:true}).click();
  assert.equal(await p.locator('dialog[data-kind="module"]').count(),1);
  await p.getByRole('button',{name:'取消',exact:true}).click();

  assert.deepEqual(errors,[]);
  console.log('PASS info window opens, pages with buttons and arrow keys, and leaves module settings intact');
} finally {
  await browser?.close();
  server.kill();
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node test/info-window.mjs`
Expected: FAIL，`[data-gesture-card]` 数量为 0 或点击后没有信息窗。

- [ ] **Step 3: 实现 `public/dashboard.js`**

在渲染模板中加属性：

- 卡片 `<section ... data-gesture-card="${m.id}">`。
- 新闻 `li`：`data-gesture-item="news:${m.id}:${index}"`（`slice(0,3)` 的索引）。
- 日程 `li`：`data-gesture-item="agenda:${m.id}:${index}"`。
- 便签 `li`：`data-gesture-item="notes:${m.id}:${index}"`。
- 快捷链接 `a`：`data-gesture-item="links:${m.id}:${Math.floor(index/3)}"`。

在 `createDashboard` 内新增：

- `let info = null;`
- `pagesFor(m)`：新闻返回按关键词过滤后的全部条目，每页一条；日程返回 `eventsFor(m)`，每页一条；便签返回全部非空行，每页一行；链接按 3 条分组；其他类型返回一页 `{ kind: 'single', module: m }`。空列表也返回一页空状态。
- `openInfo(moduleId, index = 0)`：从 `data.modules` 找模块；生成页码并夹取；`info = { moduleId, index, pages, module: m, scope }`；`setDialog('info', infoHtml())`；`bind()`；返回 `{ index, total }`。
- `flipPage(delta)`：无 `info` 返回 `null`；越界时返回当前页；否则更新索引、重绘、返回 `{ index, total }`。
- `infoState()`：`info` 存在时返回 `{ open: $('modal')?.open === true, moduleId, index, total }`。
- `infoHtml()`：标题、`x / y` 页码、`.info-body`、上一页/下一页按钮（`data-info-prev`/`data-info-next`，并带 `data-gesture-key="info:prev:<index>"` / `info:next:<index>"`）、来源行；总数 ≤ 12 时渲染非交互圆点。
- `pageHtml(page)`：
  - 新闻：大标题（`href(item)`）、时间与栏目、`打开原文` 链接（`data-gesture-key="info:open:<index>"`）。
  - 日程：标题、起止时间、地点。
  - 便签：`<p class="info-line">`。
  - 链接：列表，每项 `data-gesture-key="info:open:<pageIndex>:<itemIndex>"`。
  - 单页：`contents(page.module)`；插入后由 `bind()` 移除其中的 `[data-edit]`、`[data-calendar]` 按钮，并调用 `updateClocks()`。
- `bind()`：给 `[data-info-prev]`、`[data-info-next]` 绑定 `flipPage(±1)`；移除无效按钮；调用 `updateClocks()`。
- 模态窗关闭时清空 `info`：`$('modal').addEventListener('close', () => { info = null; });`
- 渲染 `#tiles` 后，为每个 `[data-gesture-card]` 绑定点击：`event.target.closest('a,button,input,select,textarea')` 时忽略，否则 `openInfo(card.dataset.gestureCard, 0)`。
- 文档级 `keydown`：仅当 `info` 存在且模态窗的 `data-kind === 'info'` 时处理 `ArrowLeft` / `ArrowRight`，阻止默认并翻页。
- 返回对象追加 `openInfo, flipPage, infoState`。

`public/index.html`：给关闭按钮加 `data-gesture-key="info:close"`（其余弹窗不受影响，因为指针只在信息窗上下文启用）。

`public/dashboard.css` 追加：

```css
dialog[data-kind="info"] { width:min(880px,92vw);max-height:86dvh; }
.dialog-inner .info-head { display:flex;align-items:baseline;justify-content:space-between;gap:1rem;margin-right:2.4rem; }
.info-page { font-size:13px;color:#a9c0d8;white-space:nowrap; }
.info-body { min-height:12rem;padding:1.2rem 0;overflow:auto;font-size:18px;line-height:1.7;color:#dbe8f7; }
.info-title { font-size:28px;line-height:1.35;margin:0 0 .6rem; }
.info-meta { font-size:13px;color:#a9c0d8;margin:0 0 1.4rem; }
.info-open { display:inline-block;margin-top:.8rem; }
.info-line { font-size:24px;line-height:1.7;margin:0; }
.info-links { list-style:none;padding:0;display:grid;gap:1rem; }
.info-links a { font-size:20px; }.info-links span { display:block;font-size:12px;color:#9eb6cf;margin-top:.2rem; }
.info-nav { display:flex;align-items:center;justify-content:space-between;gap:1rem;border-top:1px solid #ffffff1f;padding-top:1rem; }
.info-nav button[disabled] { opacity:.35;pointer-events:none; }
.info-source { font-size:12px;color:#9eb6cf;flex:1;text-align:center; }
.info-dots { display:flex;justify-content:center;gap:6px;margin-top:.8rem; }
.info-dots i { width:6px;height:6px;border-radius:50%;background:#ffffff33; }
.info-dots i.on { background:#cfe6ff; }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node test/info-window.mjs`
Expected: PASS，输出 `PASS info window opens, pages with buttons and arrow keys, and leaves module settings intact`。

- [ ] **Step 5: Checkpoint**

Run: `npm run test:browser`
Expected: 现有四个浏览器用例与新增用例全部通过。不要提交。

---

### Task 5: 空气指针接线与光标

**Files:**
- Modify: `public/app.js`
- Modify: `public/index.html`（加入 `#gesture-cursor`）
- Modify: `public/dashboard.css`（光标、悬停、提示）
- Test: `test/info-window.mjs`（补光标存在性断言）

**Interfaces:**
- Consumes: `mapToScreen`、`PointerController`、`pointerContextAllowed`、`isCalibrationCurrent`（Task 2）；`onFrame.pointer`（Task 3）；`resolveGestureAction` 的 `closeInfo/pageNext/pagePrev`（Task 1）；`dashboard.openInfo/flipPage`（Task 4）。
- Produces: 用户可见的指针对话；`morning.gesture.pointer` 读取与摄像头指纹校验。

- [ ] **Step 1: 写失败测试**

在 `test/info-window.mjs` 的初始加载后追加：

```js
assert.equal(await p.locator('#gesture-cursor').count(),1);
assert.equal(await p.locator('#gesture-cursor').getAttribute('popover'),'manual');
assert.equal(await p.locator('#gesture-cursor').isVisible(),false);
```

在打开信息窗后（`dialog[data-kind="info"]` 已出现）追加：

```js
// 手势关闭时没有手部输入，光标保持隐藏，但元素仍必须是顶层 popover
assert.equal(await p.locator('#gesture-cursor').isVisible(),false);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node test/info-window.mjs`
Expected: FAIL，`#gesture-cursor` 不存在。

- [ ] **Step 3: 实现 `public/index.html`**

在 `#notice` 之后、脚本之前加入：

```html
<div id="gesture-cursor" popover="manual" aria-hidden="true"><span class="gesture-cursor-ring"></span><span class="gesture-cursor-dot"></span></div>
```

- [ ] **Step 4: 实现 `public/app.js`**

- 导入 `mapToScreen, PointerController, pointerContextAllowed, isCalibrationCurrent`。
- 状态：`let pointer = null, pointerSettings = null, hoverEl = null, pointerState = null;`
- `cursor = $('gesture-cursor')`。
- `loadPointerSettings()`：读 `morning.gesture.pointer`；`mirror` 缺省 true；标定六项均为有限数才有效；用 `isCalibrationCurrent(saved.camera, currentFingerprint())` 校验，失败则 `console.warn` 并置 `calibration = null`。`currentFingerprint()` 返回 `{ device: localStorage.getItem('morning.camera.device') || '', size: localStorage.getItem('morning.camera.size') || '1280x720' }`。
- `startGestures()`：
  - 读取当前 `morning.gesture.tuning` 后 `pointerSettings = loadPointerSettings()`。
  - 创建控制器 `pointer = new PointerController({ settings })`（失败时置空）。
  - 构造引擎时传 `onFrame: handleGestureFrame`、`onStop: stopPointerVisuals`、`settings: { ...settings, mirror: pointerSettings.mirror }`。
- `handleGestureFrame(payload)`：
  - 若 `!pointer || !pointerSettings || !pointerContextAllowed({ dialog, enabled: gestureEnabled(), streaming: camera.streaming })`，调用 `stopPointerVisuals()` 并返回。
  - 若 `Date.now() - navAt < 300`，调用 `stopPointerVisuals()` 并返回，避免状态切换瞬间的停留进度延续。
  - 指针活跃且坐标有限时：`mapToScreen` → 视口像素（`norm.x * (innerWidth - 1)`、`norm.y * (innerHeight - 1)`）→ `document.elementFromPoint` → `resolvePointerTarget`。
  - 调用 `pointer.update({ x, y, active, at, target })`，保存 `pointerState`，`renderPointer(result, target)`；`result.click` 时 `activatePointerTarget(target)`。
- `resolvePointerTarget(el)`：
  - `[data-gesture-item]` → 解析 `kind:moduleId:index`，返回 `{ type:'item', moduleId, index:Number(index), key:'item:'+moduleId+':'+index, element }`。
  - `[data-gesture-card]` → `{ type:'card', moduleId, index:0, key:'card:'+moduleId, element }`。
  - `dialog === 'info'` 时 `[data-gesture-key]` → `{ type:'info', key, element }`。
  - 否则 `null`。
- `activatePointerTarget(target)`：`navAt = Date.now(); pointer?.reset(); hideCursor();`；`type === 'info'` 时 `target.element.click()`，否则 `dashboard.openInfo(target.moduleId, target.index)`。
- `renderPointer(result, target)`：不可见时 `hideCursor()`；否则 `showCursor()`、设置 `transform: translate3d(x px, y px, 0)`、`--progress`、`dwelling` 类；目标键存在时给 `target.element` 加 `.gesture-hover`，无目标时清除。
- `showCursor()` / `hideCursor()`：`showPopover()` / `hidePopover()` 前后用 `hidden` 与 `:popover-open` 守卫；`hideCursor` 清除悬停与 `pointerState`。
- `stopPointerVisuals()`：`pointer?.reset(); pointerState = null; hideCursor();`
- `setDialog()` 和 `closeDialog()` 中调用 `hideCursor(); pointer?.reset();`，避免状态切换瞬间误点。
- `handleGesture()`：
  - 在 300ms 守卫之后，若 `event.type === 'fist' && dialog !== 'info' && pointerState?.progress > 0`，只做 `stopPointerVisuals()` 并返回。
  - 动作分发追加：`pageNext → dashboard.flipPage(1)`、`pagePrev → dashboard.flipPage(-1)`、`closeInfo → closeDialog()`；翻页后 `pointer?.reset()`。
- `camera` 的错误回调、`pagehide`、`startGestures` 的 catch 都调用 `stopPointerVisuals()`。
- `render()` 的成员面板两个分支都追加手势提示：
  `camera.streaming && gestureEnabled() && gesture?.running` 时插入 `<p class="gesture-hint">手势：食指指向卡片并停留打开 · 信息窗内张开手左右翻页</p>`。

- [ ] **Step 5: 实现 `public/dashboard.css` 光标样式**

```css
#gesture-cursor { position:fixed; inset:auto; left:0; top:0; width:34px; height:34px; margin:-17px 0 0 -17px; padding:0; border:0; background:none; pointer-events:none; transition:transform 90ms linear; }
#gesture-cursor[hidden] { display:none; }
.gesture-cursor-ring { position:absolute; inset:0; border-radius:50%; background:conic-gradient(#cfe6ff calc(var(--progress,0) * 360deg), #ffffff26 0); -webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 3px),#000 calc(100% - 2px)); mask:radial-gradient(farthest-side,transparent calc(100% - 3px),#000 calc(100% - 2px)); }
.gesture-cursor-dot { position:absolute; left:50%; top:50%; width:8px; height:8px; margin:-4px 0 0 -4px; border-radius:50%; background:#f4f9ff; box-shadow:0 0 12px #bfe0ff; }
.gesture-hover { outline:2px solid #bfe0ff; outline-offset:-2px; }
.gesture-hint { font-size:.6rem;color:#9fb6cf;margin:.4rem 0 0;line-height:1.4; }
```

- [ ] **Step 6: 运行测试确认通过**

Run: `node test/info-window.mjs && npm run test:browser`
Expected: 全部通过；手势关闭时页面不出现可见光标，光标元素存在且带 `popover="manual"`。

- [ ] **Step 7: Checkpoint**

不要提交。

---

### Task 6: 调试页指针参数、四点标定与测试光标

**Files:**
- Modify: `public/debug.html`
- Modify: `public/debug.css`
- Modify: `public/debug.js`
- Test: `test/debug.mjs`

**Interfaces:**
- Consumes: `mapToScreen`、`solveAffine`、`isCalibrationCurrent`（Task 2）；`onFrame.pointer`（Task 3）。
- Produces:
  - 滑杆 `#gesture-pointer-dwell`（`pointerDwellMs`）、`#gesture-swipe-distance`（`swipeMinDistance`）。
  - 镜像开关 `#pointer-mirror`、标定按钮 `#pointer-calibrate`、清除按钮 `#pointer-clear`、测试开关 `#pointer-test`、状态 `#pointer-status`。
  - 标定层 `#calibration` 与目标点；调试光标 `#debug-cursor`。
  - `morning.gesture.pointer = { mirror, calibration, camera: { device, size }, updatedAt }`。

- [ ] **Step 1: 写失败测试**

在 `test/debug.mjs` 的页面加载与现有断言之后追加：

```js
assert.equal(await page.locator('#gesture-pointer-dwell').inputValue(),'1000');
assert.equal(await page.locator('#gesture-swipe-distance').inputValue(),'0.18');
assert.equal(await page.locator('#pointer-mirror').isChecked(),true);

await page.locator('#gesture-pointer-dwell').evaluate(el=>{el.value='1200';el.dispatchEvent(new Event('input',{bubbles:true}));});
assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('morning.gesture.tuning')).pointerDwellMs),1200);

await page.locator('#pointer-mirror').uncheck();
assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('morning.gesture.pointer')).mirror),false);

await page.locator('#pointer-calibrate').click();
assert.equal(await page.locator('#calibration').isVisible(),true);
await page.keyboard.press('Escape');
assert.equal(await page.locator('#calibration').isVisible(),false);

await page.locator('#pointer-test').check();
assert.equal(await page.locator('#pointer-test').isChecked(),true);
assert.equal(await page.locator('#debug-cursor').isVisible(),false);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node test/debug.mjs`
Expected: FAIL，`#gesture-pointer-dwell` 不存在。

- [ ] **Step 3: 实现 `public/debug.html`**

在现有 `gesture-sliders` 中追加两个滑杆：

```html
<label>指针停留
  <input id="gesture-pointer-dwell" type="range" min="300" max="2500" step="50" value="1000">
  <output for="gesture-pointer-dwell">1000</output>
</label>
<label>翻页滑动距离
  <input id="gesture-swipe-distance" type="range" min="0.08" max="0.35" step="0.01" value="0.18">
  <output for="gesture-swipe-distance">0.18</output>
</label>
```

在手势面板内追加指针行与标定层：

```html
<div class="row pointer-row">
  <label class="switch"><input type="checkbox" id="pointer-mirror" checked> 镜像</label>
  <button type="button" id="pointer-calibrate">四点标定</button>
  <button type="button" id="pointer-clear">清除标定</button>
  <label class="switch"><input type="checkbox" id="pointer-test"> 测试指针</label>
  <span id="pointer-status" class="hint" role="status">未标定</span>
</div>
<div id="calibration" class="calibration" hidden>
  <div class="calibration-card">
    <p id="calibration-step">点击角落圆点，保持食指指向 1 秒</p>
    <div class="calibration-progress"><i id="calibration-bar"></i></div>
    <button type="button" id="calibration-cancel">取消（Esc）</button>
  </div>
  <span class="calibration-target c0" data-corner="0"></span>
  <span class="calibration-target c1" data-corner="1"></span>
  <span class="calibration-target c2" data-corner="2"></span>
  <span class="calibration-target c3" data-corner="3"></span>
</div>
<div id="debug-cursor" hidden></div>
```

- [ ] **Step 4: 实现 `public/debug.js`**

- 导入 `mapToScreen, solveAffine, isCalibrationCurrent`。
- 新增 `POINTER_KEY = 'morning.gesture.pointer'`、`let pointerSettings = loadPointerSettings()`、`let calibration = null`、`let testPointer = false`。
- `loadPointerSettings()` / `persistPointerSettings()`：读写 `{ mirror, calibration, camera: { device, size }, updatedAt }`；`camera` 取 `localStorage.getItem(DEVICE_KEY) || ''` 与 `localStorage.getItem(SIZE_KEY) || '1280x720'`。
- `gestureInputs` 追加 `pointerDwellMs`、`swipeMinDistance`；`GESTURE_LABELS` 追加 `point:'指向'`、`swipeLeft:'左滑'`、`swipeRight:'右滑'`。
- `startGestures()` 传 `settings: { ...gestureTuning, mirror: pointerSettings.mirror }`。
- `onGestureFrame(payload)`：
  - 若标定会话存在，调用 `captureCalibration(payload?.pointer, payload?.at)`。
  - 若 `testPointer` 且 `payload?.pointer?.active`，用 `mapToScreen` 定位 `#debug-cursor` 并显示；否则隐藏。
- 标定：
  - 四角屏幕比例固定为 `{x:.08,y:.08}`、`{x:.92,y:.08}`、`{x:.92,y:.92}`、`{x:.08,y:.92}`。
  - 每个角收集最近 800ms 的原始指尖点；跨度 ≤0.05 且时长 ≥800ms 时取平均，写入 `{ rawX, rawY, screenX, screenY }`，进入下一角。
  - 四角完成后 `solveAffine(pairs, pointerSettings.mirror)`；成功则写入 `calibration`、`camera`、`updatedAt` 并持久化，关闭标定层，状态“标定已保存，刷新主屏生效”；失败显示“标定失败，请重试”。
  - 手势未启动或指针不活跃时不采集，状态提示“等待手势数据”。
  - `Escape` 或取消按钮关闭标定层并清空会话。
- 镜像开关变化：更新 `pointerSettings.mirror`、`calibration = null`、持久化、`engine?.updateSettings({ mirror })`，状态提示“标定已清除，请重新标定”。
- 清除标定：`calibration = null`、持久化、状态“已清除标定”。
- 加载时：有标定且 `isCalibrationCurrent(pointerSettings.camera, currentFingerprint())` 为真 → “已标定”；否则 → “摄像头已变化，请重新标定”。
- `boot()` 中同步 `#pointer-mirror.checked = pointerSettings.mirror`、`#pointer-test.checked = false`，并按上面的规则写入 `#pointer-status` 初始文案。
- 在 `onGestureEvent` 中，`GESTURE_LABELS` 已覆盖滑动类型，无需额外逻辑。

- [ ] **Step 5: 实现 `public/debug.css`**

```css
.pointer-row { align-items:center;gap:12px;flex-wrap:wrap;margin-top:10px; }
.calibration { position:fixed;inset:0;z-index:50;background:#0b1726e8;display:grid;place-items:center; }
.calibration[hidden] { display:none; }
.calibration-card { text-align:center;max-width:22rem;padding:1.2rem;border:1px solid #ffffff26;border-radius:16px;background:#1a2c43; }
.calibration-progress { height:4px;background:#ffffff1f;border-radius:2px;margin:14px 0;overflow:hidden; }
.calibration-progress i { display:block;height:100%;width:0;background:#cfe6ff;transition:width 80ms linear; }
.calibration-target { position:absolute;width:28px;height:28px;border:2px solid #cfe6ff;border-radius:50%;box-shadow:0 0 18px #cfe6ff66; }
.calibration-target.c0 { left:8%;top:8%; }.calibration-target.c1 { right:8%;top:8%; }
.calibration-target.c2 { right:8%;bottom:8%; }.calibration-target.c3 { left:8%;bottom:8%; }
#debug-cursor { position:fixed;left:0;top:0;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;background:#cfe6ff;box-shadow:0 0 14px #cfe6ff;pointer-events:none;z-index:60; }
#debug-cursor[hidden] { display:none; }
```

- [ ] **Step 6: 运行测试确认通过**

Run: `node test/debug.mjs`
Expected: PASS。

- [ ] **Step 7: Checkpoint**

Run: `npm run test:browser`
Expected: 全部通过。不要提交。

---

### Task 7: 文档与全量回归

**Files:**
- Modify: `README.md`
- Test: `npm test`、`npm run test:browser`

**Interfaces:**
- Consumes: 前六个任务完成的界面与行为。
- Produces: 用户可查的手势说明与调试页说明。

- [ ] **Step 1: 更新 README 手势章节**

在现有“成员与走近识别”手势段落中补充：

- 食指指向卡片或条目出现光标，停留 1 秒打开悬浮信息窗；
- 信息窗内张开手掌左右滑动翻页，握拳关闭；鼠标点卡片正文、键盘左右键同样可用；
- 设置、身份确认、录入等弹窗不响应指针；
- 信息窗打开时挥手不再返回团队晨报；
- 坐标映射默认可用，建议在调试页做一次四点标定；换摄像头或分辨率后旧标定会被忽略。

在“调试页”手势面板段落中补充指针停留、翻页滑动距离、镜像开关、四点标定、清除标定与测试指针。

- [ ] **Step 2: 运行全部单测**

Run: `npm test`
Expected: 所有 Node 单测通过，包括 `gesture.test.mjs` 与 `pointer.test.mjs`。

- [ ] **Step 3: 运行全部浏览器回归**

Run: `npm run test:browser`
Expected: `wall.mjs`、`camera.mjs`、`debug.mjs`、`info-window.mjs`、`wall-gesture.mjs` 全部通过。

- [ ] **Step 4: 真实摄像头手测（Windows 本机）**

打开 `http://127.0.0.1:4317`，确认：

- 2 米内食指指向能稳定移动光标，手放下后 0.5 秒内隐藏；
- 停留 1 秒打开对应卡片/条目，中途移开或握拳取消；
- 信息窗内左右滑动各翻一页，边界不循环，握拳关闭；
- 路过、说话比划、拿水杯不触发点击或翻页（至少 10 次经过测试）；
- 打开设置/确认弹窗时光标消失，且无法用指针点击其中按钮；
- 个人简报上停留时握拳只取消停留，不返回团队晨报；
- 调试页标定四个角后，测试指针能到达四个角与中心；刷新主屏后标定保持。

- [ ] **Step 5: Checkpoint**

不要提交；把改动、测试结果与手测结论汇报给用户。

---

## 计划自检

- **Spec 覆盖**：设计 §5.1 上下文守卫 → Task 5；§5.2 指针 → Task 2/5；§5.3 命中 → Task 4/5；§5.4 信息窗 → Task 4；§5.5 手势与动作 → Task 1/5；§5.6 提示 → Task 5；§6 判据与参数 → Task 1/2；§7 架构/接口/存储/属性 → Task 1-6；§8 调试页 → Task 6；§9 测试 → Task 1/2/4/5/6/7；§10 风险 → Review Focus 与各任务测试。
- **类型一致性**：`PointerController.update({x,y,active,at,target})`、`target {key, inside}`、`mapToScreen` 原始坐标、`solveAffine(pairs, mirror)`、`openInfo(moduleId,index)`、`flipPage(delta)`、`infoState()` 在所有任务中保持一致。
- **Review Focus 对应测试**：摄像头指纹 → `isCalibrationCurrent` 单测 + Task 5 生效逻辑；抖动/丢失 → `PointerController` 单测；滑动/挥手 → Task 1 的静止确认、无方向反转、幅度 ≥0.19 与置信度单测；popover 光标 → Task 5 浏览器断言；非信息窗禁用 → `pointerContextAllowed` 单测；空模块 → Task 4 天气单页用例；个人简报握拳 → Task 5 代码守卫 + Task 7 手测。
- **未覆盖的取舍**：标定采集的 800ms、跨度 0.05 与四角 8% 边距由实施者按手测微调；光标圆点/环的视觉细节由实施者按现有色板定；`pointerDwellMs` 等滑杆范围以调试页实际手感为准。
