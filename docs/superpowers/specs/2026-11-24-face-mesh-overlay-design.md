# 调试页人脸三角网格叠加层 · 设计

- 日期：2026-11-24
- 状态：待评审
- 涉及项目：Halo（本地信息墙，`E:\workspace_halo\Halo`）
- 前置设计：`docs/superpowers/specs/2026-11-23-camera-debug-gesture-design.md`

## 1. 目的与原因

`/debug.html` 现在的人脸叠加层画的是 68 个关键点：青色人脸框 + 黄色实心小圆点。点阵看起来零散，用户希望换成**三角形组成的面具**。

选用 MediaPipe `FaceLandmarker`（478 点，官方 2543 个三角形的 tessellation 连接表），而不是对现有 68 点做 Delaunay：68 点只能切出约 110 个大三角形，稀疏，达不到面具的密度。识别（face-api）链路完全不动，网格只做可视化。

## 2. 目标 / 非目标 / 反目标

### 目标

- 调试页摄像头画面上叠加随人脸移动的三角网格：线框 + 8% 淡填充。
- 网格与画面镜像一致（沿用 `.stage` 的 CSS 翻转），不额外做坐标变换。
- 摄像头关闭、暂停人脸识别或模型加载失败时，页面其余功能（识别、手势、调参）完全不受影响。
- 全部本地运行，不录像、不截图、不上传。
- `npm test` 与 `npm run test:browser` 继续通过。

### 非目标

- 不改主屏 `index.html`：那里本来没有人脸叠加层。
- 不用网格做身份识别，不替换 face-api 的检测与匹配。
- 不改匹配阈值、样本库或录入流程。
- 不新增前端依赖（`@mediapipe/tasks-vision` 已在）。

### 反目标

- 网格明显滞后于人脸或抖动，或让识别帧率下降。
- 模型缺失/加载失败时让调试页白屏或抛出未捕获异常。

## 3. 方案

**A. 现有 68 点做 Delaunay 三角剖分** —— 零新资源，但三角形大而少，是低多边形风格，不满足「面具」的密度。未采用。

**B. MediaPipe `FaceLandmarker` 468 点 + 官方 `FACE_LANDMARKS_TESSELATION`** —— 与手势引擎同一套 `@mediapipe/tasks-vision@1.2.3`，已确认安装包里导出了 `FACE_LANDMARKS_TESSELATION`。视觉是常见的 dense face mesh。代价是多一个 3.7 MB 模型和一条检测循环。**采用。**

## 4. 设计

### 引擎

新增 `public/facemesh.js`，`FaceMeshEngine` 对齐现有 `GestureEngine` 的结构：

- 动态 `import('/mediapipe/vision_bundle.mjs')`；`FilesetResolver.forVisionTasks('/mediapipe/wasm')`。
- `FaceLandmarker.createFromOptions(fileset, { baseOptions:{ modelAssetPath:'/models/face_landmarker.task', delegate:'CPU' }, runningMode:'VIDEO', numFaces:1, outputFaceBlendshapes:false })`。
- `setTimeout` 循环，默认 `intervalMs: 66`（约 15 fps）；`generation` token 防止加载期间被 `stop()` 的竞态；`stop()` 里 `close()`。
- 每帧回调 `{ faces: [{ landmarks }], timings }`，landmarks 为归一化 `0..1` 坐标。

### 渲染

`debug.js` 的 `drawOverlay()` 增加网格绘制：

- 用 `FACE_LANDMARKS_TESSELATION` 的 `[start, end]` 连接索引画三角形边：`strokeStyle` 沿用 `#59d2ff`，`globalAlpha 0.55`，`lineWidth 1`。
- 三角面用 `globalAlpha 0.08` 一次性 `fill()`（每个三角形一个 path，或合并 path）。
- 坐标映射 `x * video.videoWidth`、`y * video.videoHeight`，与现有 68 点一致。
- **去掉 68 个黄点，保留人脸框**（框仍有调试价值）。这是本次的默认决定，评审时可以改回保留点或去掉框。

### 生命周期

- 摄像头 `openCamera()` 成功后启动网格引擎；`stop()` / `pauseFace()` 时停止；页面卸载沿用现有 `beforeunload` 清理。
- 手势引擎与网格引擎并行，各自独立实例。
- 模型加载失败：控制台告警一次 + 页面提示，叠加层退回「仅人脸框 + 68 点」的旧行为，识别不受影响。

### 资源与路由

- 新增 `public/models/face_landmarker.task`：MediaPipe 官方 float16 v1，来源 `<https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task>`，`NOTICE.md` 补来源与 Apache-2.0。
- `server.mjs` 增加 `staticFiles.set('/models/face_landmarker.task', 'public/models/face_landmarker.task')`。`.task` 的 MIME 已有。
- **需要重启一次服务**：静态文件表在启动时构建。

## 5. 测试

- 单测：把「468 点 + connections → 线段列表」抽成纯函数，断言输出段数、非法坐标被跳过、空输入返回空。
- 浏览器测试：沿用 `test/debug.mjs` 的假摄像头，断言页面加载后请求了 `/models/face_landmarker.task`、网格引擎启动不抛未捕获异常；摄像头关闭后引擎停止。
- 静态路由测试：`/models/face_landmarker.task` 返回 200 与 `application/octet-stream`（对齐现有 `hand_landmarker.task` 的断言）。

## 6. 约束与风险

- 服务必须重启才能提供新模型文件。
- CPU：网格 15 fps 与手势 12.5 fps 可能同时跑；中低端机器掉帧时把 `intervalMs` 调到 100。
- 两个模型各自检测，网格与 68 点之间可能有轻微位置偏差，属预期。
- 调试页是唯一入口；主屏不受影响。

## 7. 改动面

| 文件 | 改动 |
|---|---|
| `public/facemesh.js` | 新增：FaceMeshEngine + 线段构建纯函数 |
| `public/debug.js` | `drawOverlay()` 接入网格；启停生命周期；失败降级 |
| `public/debug.html` | 可选：网格状态提示 |
| `server.mjs` | 静态路由 `/models/face_landmarker.task` |
| `public/models/face_landmarker.task` | 新增模型文件 |
| `public/models/NOTICE.md` | 来源与许可说明 |
| `test/*.mjs` | 单测 + 浏览器测试 + 静态路由断言 |
