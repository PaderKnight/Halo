# 调试页人脸三角网格叠加层 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `/debug.html` 人脸叠加层从 68 个点换成 MediaPipe FaceLandmarker 的 468 点三角网格面具（线框 + 8% 淡填充）。

**Architecture:** 新增 `public/facemesh.js`：一个与 `GestureEngine` 同构的 `FaceMeshEngine`（MediaPipe `FaceLandmarker`，CPU，VIDEO 模式，约 15 fps），以及三个纯函数（连线构建、三角面构建、绘制）。`debug.js` 在摄像头开启时启动它、关闭时停止，`drawOverlay()` 改画网格；引擎不可用时退回原来的点阵。

**Tech Stack:** Node 22+、原生 ESM、`@mediapipe/tasks-vision@1.2.3`（已安装，不新增依赖）、Playwright（已安装）、face-api（保持不动）。

**Spec:** `docs/superpowers/specs/2026-11-24-face-mesh-overlay-design.md`

## Global Constraints

- 不新增任何前端/后端依赖；MediaPipe 版本保持 `@mediapipe/tasks-vision@1.2.3`。
- 所有资源本地托管，运行时不访问 CDN；模型文件是 `public/models/face_landmarker.task`（MediaPipe 官方 float16 v1）。
- 归一化坐标约定：FaceLandmarker 的 landmarks 为 `0..1`，绘制时乘 `video.videoWidth` / `videoHeight`。
- `Connection` 类型是 `{ start: number, end: number }`（已用 `vision.d.ts` 确认），不是数组对。
- `.task` 的 MIME 是 `application/octet-stream`（`server.mjs` 已有）。
- 静态文件表在服务启动时构建：新增模型文件后本地开发服务需重启一次。
- 调试页任何网格失败都必须降级到「人脸框 + 68 点」，不得抛未捕获异常。
- `npm test` 与 `npm run test:browser` 必须继续通过；新增测试要登记进对应脚本。

## Review Focus

- **模型 404 / 加载失败**：引擎 `onError` 一次，页面其余功能正常，叠加层退回 68 点，不得白屏或无限重试。
- **摄像头未开或已关闭时启动/停止引擎**：不得启动检测循环，也不得抛错。
- **画面里没有人脸**：只画人脸框，网格为空，状态提示显示 `网格 0 张`。
- **视频尺寸为 0（刚开流、未出画）**：`drawFaceMesh` 直接返回，不除以 0、不画。
- **关闭摄像头后**：网格检测循环停止、状态位复位、不抛未捕获异常（加载中途关闭由 `generation` token 兜底）。

---

### Task 1: 模型资源与静态路由

**Files:**
- Create: `public/models/face_landmarker.task`
- Modify: `public/models/NOTICE.md`
- Modify: `server.mjs:104`（在 `hand_landmarker.task` 那行后面）
- Test: `test/assets.test.mjs`

**Interfaces:**
- Consumes: 无
- Produces: HTTP 路由 `/models/face_landmarker.task`，返回 `application/octet-stream`；后续任务用它作为 `modelAssetPath`。

- [ ] **Step 1: 下载模型到 `public/models/face_landmarker.task`**

```bash
curl -L -o public/models/face_landmarker.task \
  https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
```

校验：文件大于 3,000,000 字节，且第 3–4 字节是 `PK`（MediaPipe `.task` 是带 2 字节前缀的 zip）。

- [ ] **Step 2: 在 `public/models/NOTICE.md` 追加条目**

按现有 `hand_landmarker.task` 的格式，写明文件 `face_landmarker.task`、来源 URL、Apache-2.0 许可。

- [ ] **Step 3: 写失败测试**

在 `test/assets.test.mjs` 的 `cases` 数组加一行：

```js
['/models/face_landmarker.task', /^application\/octet-stream/],
```

并在同一个测试开头、`hand_landmarker.task` 断言之后加：

```js
const faceModel = path.join(root, 'public/models/face_landmarker.task');
assert.ok(fs.statSync(faceModel).size > 3_000_000);
assert.equal(fs.readFileSync(faceModel).subarray(2, 4).toString(), 'PK');
```

- [ ] **Step 4: 运行测试确认失败**

Run: `node --test test/assets.test.mjs`
Expected: FAIL — `/models/face_landmarker.task` 返回 404。

- [ ] **Step 5: 在 `server.mjs` 注册路由**

在 `staticFiles.set('/models/hand_landmarker.task', 'public/models/hand_landmarker.task');` 之后加：

```js
staticFiles.set('/models/face_landmarker.task', 'public/models/face_landmarker.task');
```

- [ ] **Step 6: 运行测试确认通过**

Run: `node --test test/assets.test.mjs`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add public/models/face_landmarker.task public/models/NOTICE.md server.mjs test/assets.test.mjs
git commit -m "feat: serve mediapipe face landmarker model"
```

---

### Task 2: 网格纯函数

**Files:**
- Create: `public/facemesh.js`（本任务只放三个纯函数；Task 3 在同一文件加引擎）
- Create: `test/facemesh.test.mjs`
- Modify: `package.json`（`test` 脚本追加 `test/facemesh.test.mjs`）

**Interfaces:**
- Consumes: 无
- Produces:
  - `buildMeshSegments(landmarks, connections) -> Array<{ a: {x, y}, b: {x, y} }>`
  - `buildMeshTriangles(connections) -> Array<[number, number, number]>`
  - `drawFaceMesh(context, faces, options) -> number`（返回画的线段数）
    - `faces: Array<{ landmarks: Array<{x, y}> }>`
    - `options: { connections, width, height, lineColor = '#59d2ff', lineAlpha = 0.55, fillAlpha = 0.08, lineWidth = 1 }`

- [ ] **Step 1: 写失败测试**

创建 `test/facemesh.test.mjs`：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMeshSegments, buildMeshTriangles, drawFaceMesh } from '../public/facemesh.js';

const square = [
  { x: 0.0, y: 0.0 }, { x: 0.5, y: 0.0 },
  { x: 0.5, y: 0.5 }, { x: 0.0, y: 0.5 },
];
const squareEdges = [
  { start: 0, end: 1 }, { start: 1, end: 2 },
  { start: 2, end: 3 }, { start: 3, end: 0 },
  { start: 0, end: 2 },
];

test('buildMeshSegments maps connections to point pairs', () => {
  const segments = buildMeshSegments(square, squareEdges);
  assert.equal(segments.length, 5);
  assert.deepEqual(segments[0], { a: { x: 0, y: 0 }, b: { x: 0.5, y: 0 } });
});

test('buildMeshSegments skips invalid coordinates and out-of-range indices', () => {
  const points = [...square, { x: NaN, y: 0.1 }];
  const edges = [{ start: 0, end: 1 }, { start: 0, end: 4 }, { start: 0, end: 99 }];
  assert.equal(buildMeshSegments(points, edges).length, 1);
});

test('buildMeshSegments returns empty for missing input', () => {
  assert.deepEqual(buildMeshSegments([], squareEdges), []);
  assert.deepEqual(buildMeshSegments(square, []), []);
});

test('buildMeshTriangles derives unique triangles from edges', () => {
  const triangles = buildMeshTriangles(squareEdges);
  assert.deepEqual(triangles.map(t => t.join(',')).sort(), ['0,1,2', '0,2,3']);
});

test('buildMeshTriangles ignores open paths', () => {
  assert.deepEqual(buildMeshTriangles([{ start: 0, end: 1 }, { start: 1, end: 2 }]), []);
});

test('drawFaceMesh strokes one path per face and fills triangles', () => {
  const calls = [];
  const context = {
    set globalAlpha(v) { calls.push(['alpha', v]); },
    set strokeStyle(v) { calls.push(['strokeStyle', v]); },
    set fillStyle(v) { calls.push(['fillStyle', v]); },
    set lineWidth(v) { calls.push(['lineWidth', v]); },
    beginPath() { calls.push(['beginPath']); },
    moveTo(x, y) { calls.push(['moveTo', x, y]); },
    lineTo(x, y) { calls.push(['lineTo', x, y]); },
    closePath() { calls.push(['closePath']); },
    stroke() { calls.push(['stroke']); },
    fill() { calls.push(['fill']); },
    save() { calls.push(['save']); },
    restore() { calls.push(['restore']); },
  };
  const count = drawFaceMesh(context, [{ landmarks: square }], {
    connections: squareEdges, width: 100, height: 100,
  });
  assert.equal(count, 5);
  assert.ok(calls.some(([name]) => name === 'stroke'));
  assert.ok(calls.some(([name]) => name === 'fill'));
  assert.ok(calls.some(([name, v]) => name === 'moveTo' && v === 50));
});

test('drawFaceMesh skips zero-size frames', () => {
  const context = { beginPath() { throw Error('should not draw'); } };
  assert.equal(drawFaceMesh(context, [{ landmarks: square }], {
    connections: squareEdges, width: 0, height: 0,
  }), 0);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/facemesh.test.mjs`
Expected: FAIL — 模块或导出不存在。

- [ ] **Step 3: 实现三个纯函数**

`public/facemesh.js`，要点：

- `buildMeshSegments`：遍历 `connections`，索引越界或任一坐标非有限值就跳过；返回 `{ a: { x, y }, b: { x, y } }` 的新对象。
- `buildMeshTriangles`：建邻接表（无向），对每条边 `(u, v)` 取 `u` 与 `v` 的共同邻居 `w`，`u < v < w` 的升序三元组去重后返回；没有闭合三角形的边不产生结果。
- `drawFaceMesh`：`width` 或 `height` 非正数直接返回 0；内部用 `buildMeshSegments` 取线段、`buildMeshTriangles` 取三角面；`save()` → 线：单个 path 里对所有线段 `moveTo/lineTo`，`globalAlpha = lineAlpha`，`strokeStyle = lineColor`，`lineWidth`，`stroke()`；面：单个 path 里对每个三角形 `moveTo/lineTo/lineTo/closePath`，`globalAlpha = fillAlpha`，`fillStyle = lineColor`，`fill()`；`restore()`；返回线段总数。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/facemesh.test.mjs`
Expected: PASS（8 个测试）。

- [ ] **Step 5: 登记到 `npm test`**

把 `test/facemesh.test.mjs` 加进 `package.json` 的 `test` 脚本（放在 `test/match.test.mjs` 之后）。

- [ ] **Step 6: 提交**

```bash
git add public/facemesh.js test/facemesh.test.mjs package.json
git commit -m "feat: add face mesh segment and triangle builders"
```

---

### Task 3: FaceMeshEngine 与调试页接入

**Files:**
- Modify: `public/facemesh.js`（追加 `FaceMeshEngine`）
- Modify: `public/debug.js`（导入、状态、`drawOverlay`、`start`/`stop`/`restartCamera`）
- Modify: `public/debug.html`（`.hand-stats` 里加 `#mesh-note`）
- Test: `test/debug.mjs`

**Interfaces:**
- Consumes: `drawFaceMesh`、`buildMeshSegments`（Task 2）；`/models/face_landmarker.task`（Task 1）；`/mediapipe/vision_bundle.mjs`、`/mediapipe/wasm`（已有）。
- Produces:
  - `new FaceMeshEngine(video, { onFrame, onError, intervalMs = 66 })`
  - `engine.start() -> Promise<void>`、`engine.stop() -> void`、`engine.running -> boolean`
  - `onFrame(payload)` 的 `payload`：`{ faces: Array<{ landmarks }>, timings: { detectMs }, connections }`

- [ ] **Step 1: 写失败的浏览器测试**

在 `test/debug.mjs` 的既有断言之后追加（同一个 `page`）：

```js
// 网格引擎：请求模型、状态提示从「网格 —」变成「网格 N 张」
assert.ok(requested.some(pathname => pathname === '/models/face_landmarker.task'), 'face landmarker model requested');
await page.waitForFunction(() => /网格 \d+ 张/.test(document.querySelector('#mesh-note')?.textContent || ''), null, { timeout: 120000 });
await page.locator('#toggle').click();
await page.waitForFunction(() => (document.querySelector('#mesh-note')?.textContent || '').includes('网格 —'));
assert.deepEqual(errors, [], 'no page errors while starting and stopping the mesh');

// 模型不可用 → 降级为「框 + 68 点」，不抛未捕获异常
const fallback = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const fallbackErrors = [];
fallback.on('pageerror', error => fallbackErrors.push(error.message));
await fallback.addInitScript(fakeCamera);
await fallback.route('**/models/face_landmarker.task', route => route.abort());
await fallback.goto(url + '/debug.html');
await fallback.locator('#toggle').click();
await fallback.waitForFunction(() => (document.querySelector('#mesh-note')?.textContent || '').includes('网格未启用'), null, { timeout: 60000 });
assert.deepEqual(fallbackErrors, [], 'mesh failure degrades without page errors');
await fallback.close();
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node test/debug.mjs`
Expected: FAIL — 没有 `#mesh-note`，也没有请求模型。

- [ ] **Step 3: 在 `public/facemesh.js` 追加 `FaceMeshEngine`**

结构与 `public/gesture.js` 的 `GestureEngine` 一致，差异点：

- `const VISION_PATH = '/mediapipe/vision_bundle.mjs'; const WASM_PATH = '/mediapipe/wasm'; const MODEL_PATH = '/models/face_landmarker.task';`
- `start()`：`await import(VISION_PATH)` → `api.FilesetResolver.forVisionTasks(WASM_PATH)` → `api.FaceLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'CPU' }, runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: false, outputFacialTransformationMatrixes: false })`。
- `this.connections = api.FaceLandmarker.FACE_LANDMARKS_TESSELATION`。
- `generation` token：加载期间调用 `stop()` 时 `close()` 后直接返回，不启动循环。
- `_detect()`：`video.readyState < 2` 或尺寸为 0 时跳过；时间戳必须严格递增；`detectForVideo(video, at)`；`onFrame({ faces: result?.faceLandmarks?.map(landmarks => ({ landmarks })) ?? [], timings: { detectMs }, connections })`。
- 异常：`stop()` 后调用 `onError(error)`，不得抛出。

- [ ] **Step 4: 在 `public/debug.html` 的 `.hand-stats` 里加状态位**

```html
<span id="mesh-note">网格 —</span>
```

- [ ] **Step 5: 在 `public/debug.js` 接入**

- 导入：`import { FaceMeshEngine, drawFaceMesh } from './facemesh.js';`
- 元素：`const meshNote = $('mesh-note');`
- 状态：`let meshEngine = null; let latestMesh = []; let meshConnections = []; let meshFailed = false;`
- `onMeshFrame(payload)`：保存 `latestMesh` 与 `meshConnections`；`meshNote.textContent = \`网格 ${payload.faces.length} 张 · ${payload.timings.detectMs}ms\``；调 `drawOverlay(latestFrame?.detections)`。
- `onMeshError(error)`：`meshFailed = true`；`meshNote.textContent = '网格未启用'`；调 `drawOverlay(latestFrame?.detections)`。
- `startMesh()`：`meshFailed` 或已运行则返回；`meshFailed = false`；创建 `new FaceMeshEngine(video, { onFrame: onMeshFrame, onError: onMeshError })` 并 `await start()`，失败走 `onMeshError`。
- `stopMesh()`：`meshEngine?.stop(); meshEngine = null; latestMesh = []; meshNote.textContent = '网格 —';`
- `start()` 在 `await camera.openCamera()` 成功后 `void startMesh()`；`restartCamera()` 在重开成功后 `stopMesh()` 再 `void startMesh()`；`stop()` 里 `stopMesh()`。
- `drawOverlay()`：保留人脸框；当 `latestMesh.length` 时调用 `drawFaceMesh(context, latestMesh, { connections: meshConnections, width, height })`，否则当 `!meshEngine?.running` 时保留原 68 点循环；删掉「始终画点」的行为。

- [ ] **Step 6: 运行浏览器测试确认通过**

Run: `node test/debug.mjs`
Expected: PASS，含新的 `#mesh-note` 断言。

- [ ] **Step 7: 跑全量测试**

Run: `npm test` 与 `npm run test:browser`
Expected: 全部 PASS。

- [ ] **Step 8: 提交**

```bash
git add public/facemesh.js public/debug.js public/debug.html test/debug.mjs
git commit -m "feat: draw mediapipe face mesh overlay on debug page"
```

---

## 手工验收（实施后）

1. 重启本地服务（新模型文件需要重新构建静态表）。
2. 打开 `http://127.0.0.1:4317/debug.html`，开摄像头。
3. 画面里正对镜头：出现青色三角网格 + 8% 淡填充，随头部移动；人脸框保留；68 个黄点消失。
4. 关摄像头：网格与状态位复位，页面不报错。
5. 把 `public/models/face_landmarker.task` 临时改名后刷新并开摄像头：状态位显示「网格未启用」，叠加层退回「框 + 68 点」，识别仍可用。
