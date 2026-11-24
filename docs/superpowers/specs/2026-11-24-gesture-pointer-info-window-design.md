# 手势指针、悬浮信息窗与翻页 · 设计

- 日期：2026-11-24
- 状态：待评审
- 涉及项目：Halo（本地信息墙，`E:\workspace_halo\Halo`，分支 `codex/halo`）
- 前置设计：`docs/superpowers/specs/2026-11-23-camera-debug-gesture-design.md`

## 1. 目的与原因

现有手势只做状态切换：确认弹窗用张开手掌/握拳，个人简报用挥手/握拳返回，竖大拇指让助手点头。用户希望手势能直接操作大屏内容：**指着某张卡片或某条讯息点击，打开悬浮窗看详情；在悬浮窗里用手势左右翻页。**

大屏固定显示 15 张卡片，一屏放得下，不需要主屏分页。因此本次把「页」放在悬浮信息窗内部：主屏保持现状，点击卡片打开一个更大的阅读窗，窗内按条目分页，左右滑动翻页。这样既不重构现有布局和后端模块数据，又能让远处站着的人读清内容。

交付四件事：

1. **空气指针**：食指指向屏幕，出现光标；悬停到卡片/条目上高亮。
2. **停留点击**：光标在同一目标上停留 1 秒触发点击，带进度环；不引入捏合手势。
3. **悬浮信息窗**：点击卡片或条目打开，按模块类型生成一页一条的可读内容，支持上一页/下一页。
4. **滑动翻页**：悬浮窗内张开手掌左右滑动翻页，握拳关闭；同时保留鼠标与键盘操作。

## 2. 目标 / 非目标 / 反目标

### 目标

- 站在大屏前 2 米左右，用食指指向即可移动光标，停留点击打开悬浮窗。
- 悬浮窗内可用张开手掌左右滑动翻页，握拳关闭；也能用鼠标点箭头、键盘左右方向键翻页。
- 指针与翻页只在安全上下文生效，不干扰身份确认、设置、录入等现有弹窗。
- 坐标映射可在调试页做四点标定并持久化；没有标定时有可用的默认映射。
- 全部计算在浏览器本地完成，不录像、不截图、不上传。
- 手势关闭、摄像头不可用或模型加载失败时，页面与鼠标操作完全不受影响。
- 现有 `npm test` 与 `npm run test:browser` 全部继续通过。

### 非目标

- 不做主屏卡片分页；15 张卡片仍保持一屏。
- 不做捏合点击、双手操作、抓取/拖拽或手势自定义训练。
- 不把指针用于身份确认、设置、录入等弹窗，避免误改配置。
- 不新增第三方依赖、不引入 CDN、不生成二维码。
- 不改动现有新闻订阅、日程、角色播放器与后端数据结构。
- 不在本次重建 Mac 交付包；源码保持可打包状态。

### 反目标（即使技术上可行也算失败）

- 路人经过或说话时比划就打开悬浮窗或翻页。
- 光标明显抖动，或停留过程中轻微移动就误点。
- 滑动翻页与既有挥手、张开手掌确认互相误触发。
- 悬浮窗打开后摄像头、人脸识别或角色动画被破坏。
- 光标被用于点击设置/确认按钮，造成配置或身份状态被误改。
- 为了指针引入需要联网或高 CPU 的新运行时。

## 3. 约束

- 服务只监听 `127.0.0.1`；页面通过 `http://127.0.0.1:4317` 访问。
- 前端依赖全部本地托管；MediaPipe 版本保持 `@mediapipe/tasks-vision@1.2.3`。
- 手势引擎默认每 80ms 检测一帧，与人脸识别共用同一条 `MediaStream`。
- 现有 `morning.gesture.enabled` 缺省为 on；为 off 时不得启动指针与翻页。
- 现有手势默认参数保持不变；新增参数追加到 `morning.gesture.tuning`。
- 现有 Playwright 用例在页面加载前关闭手势；本次新增用例同样不得依赖真实摄像头。
- 所有新增用户可见文案用简体中文，语气与现有一致。

## 4. 已确认的决定

| 决定 | 选择 | 原因 |
|---|---|---|
| 指向姿势 | 仅食指伸出（`point`） | 与张开手掌（挥手/确认）、握拳（取消/关闭）、竖大拇指区分明确 |
| 点击方式 | 停留 1.0 秒（dwell） | 远处比捏合更稳；有进度环可预期；避免捏合导致指姿消失 |
| 悬浮窗形态 | 复用现有 `<dialog id="modal">`，新增 `data-kind="info"` | 与现有弹窗共用关闭、遮罩、动效与无障碍行为 |
| 翻页对象 | 悬浮信息窗内部 | 主屏 15 张卡片一屏放完，不引入主屏分页 |
| 翻页手势 | 张开手掌单方向横滑 | 与挥手（方向反复）可区分；与确认用的张开手掌靠上下文隔离 |
| 关闭手势 | 握拳 | 沿用现有习惯 |
| 坐标映射 | 调试页四点仿射标定；无标定用默认线性映射 | 摄像头位置与站位固定后可达到可用精度；标定不污染主屏 |
| 鼠标/键盘 | 点击卡片正文也打开悬浮窗；左右方向键翻页 | 可验证、可访问，也是鼠标用户的自然行为 |
| 指针生效上下文 | 主屏 + 信息窗；其他弹窗禁用 | 避免误改设置或身份状态 |
| 生效时机 | 调参与标定保存后刷新主屏生效 | 与现有调参策略一致 |

## 5. 交互模型

### 5.1 上下文与安全边界

指针只在以下条件同时满足时工作：

- `morning.gesture.enabled` 不是 `off`；
- 摄像头流正在运行且手势引擎已启动；
- 当前没有弹窗（`dialog === ''`），或弹窗是信息窗（`dialog === 'info'`）；
- 检测到稳定的 `point` 姿势，且只有一只驱动手（沿用现有「置信度最高的手」规则）。

其他弹窗（`confirm`、`settings`、`enroll`、`module`、`calendar`、`character`、`modules`、`records`）一律隐藏光标、禁用停留点击与滑动翻页。身份确认仍只认现有的张开手掌/握拳。

页面切换、弹窗开关后的 300ms 内丢弃所有指针点击与翻页事件（沿用现有 `navAt` 守卫）。

### 5.2 主屏指针

```
+--------------------------------------------------------------+
|  卡片 A           卡片 B           卡片 C                     |
|                                                              |
|        ◎ ← 光标（18px 圆点 + 34px 进度环）                     |
|  卡片 D  [高亮描边]  卡片 E           卡片 F                  |
+--------------------------------------------------------------+
```

- 位置来源：食指指尖（landmark 8）经坐标映射到视口；左右镜像，移动右手光标向右。
- 平滑：指数滑动平均（默认 0.35），CSS `transition: transform 90ms linear` 掩盖 12.5fps 的采样间隔。
- 丢失容忍：手离开画面或姿势抖动后，光标保留最后位置 500ms；超过则隐藏并重置停留。
- 悬停高亮：目标元素加 `.gesture-hover`；条目优先于卡片。
- 停留点击：同一目标键值保持不变、光标仍在目标内，累计 1.0 秒触发一次；进度环从 0 到 1；点击后进入 800ms 冷却并重置。
- 目标变化、光标离开目标、手丢失超过 500ms、页面状态切换都会重置进度。
- 停留期间握拳：取消本次停留；信息窗打开时则关闭信息窗。

### 5.3 目标解析

用 `document.elementFromPoint(x, y)` 命中光标下的元素，然后按顺序查找：

1. `[data-gesture-item]`：卡片内的单条新闻、日程、便签行、快捷链接；
2. `[data-gesture-card]`：整张模块卡片；
3. 信息窗内的 `[data-gesture-key]`（原文链接、翻页箭头、关闭按钮）。

主屏只允许前两类；信息窗内允许带 `data-gesture-key` 的元素。每个目标必须有稳定的键值，用于停留去重：

- 卡片：`card:<moduleId>`；
- 条目：`item:<moduleId>:<pageIndex>`，**一律使用数字页码**，不使用业务 ID；
- 信息窗：`info:<action>:<pageIndex>`，如 `info:open:3`、`info:prev`、`info:next`、`info:close`。

`app.js` 只把 `moduleId` 与数字 `pageIndex` 交给 `dashboard.openInfo`，不解析业务数据。`dashboard` 负责保证卡片上第 N 条的序号与信息窗第 N 页对应：新闻、日程、便签都按同一排序取前 N 条；快捷链接的第 i 条位于第 `floor(i/3)` 页。没有命中时不显示进度。

### 5.4 悬浮信息窗

打开方式：

- 手势停留点击卡片正文 → 打开该卡片第 1 页；
- 手势停留点击某条新闻/日程/便签/链接 → 打开该卡片并从该条目的页开始；
- 鼠标点击卡片正文（非链接、非按钮） → 同第一项，便于验证与日常使用。

布局：

```
+--------------------------------------------------------------+
| 热点新闻                                     3 / 18      ×   |
|--------------------------------------------------------------|
|                                                              |
|  标题（大号，最多三行）                                        |
|  来源 · 发布时间                                              |
|                                                              |
|  [ 打开原文 ↗ ]                                               |
|                                                              |
|--------------------------------------------------------------|
|  ‹ 上一页        中新网 · 即时         下一页 ›               |
+--------------------------------------------------------------+
```

分页规则：

| 模块类型 | 每页内容 | 页数 |
|---|---|---|
| 新闻 | 一条（标题、来源、时间、原文链接） | 按关键词过滤后的全部条目，最多 80 |
| 日程 | 一条（标题、起止时间、地点） | 当前筛选范围内全部日程 |
| 便签 | 一行 | 全部非空行 |
| 常用链接 | 3 条（名称 + 地址） | 按 3 条分组 |
| 天气 / 预报 / 时钟 / 倒计时 | 一页（复用卡片内容并放大） | 1 |
| 技术项目 | 一页（项目名、最新发布、说明、链接） | 1 |

- 打开时对当前数据做快照；信息窗打开期间后台数据刷新不重建页面，避免阅读位置跳动。关闭后再次打开才取新数据。
- 页码显示 `当前 / 总数`；总数 ≤ 12 时显示圆点，超过 12 只显示数字。
- 翻到边界不循环；继续滑同方向无动作，仅让页码轻微闪动一次作为反馈。
- 信息窗内不再弹出模块设置；`×`、遮罩点击、Esc、握拳都关闭。

### 5.5 手势事件与动作

| 手势 | 主屏 | 信息窗 | 判据 |
|---|---|---|---|
| 食指指向 `point` | 移动光标、停留点击 | 移动光标、停留点击链接/箭头 | 仅食指伸出，稳定 3 帧 |
| 张开手掌横滑 `swipeLeft/Right` | 无动作 | 下一页 / 上一页 | 单方向位移 ≥18% 画面宽、≤600ms、竖向漂移 ≤12%、无方向反转 |
| 握拳 `fist` | 取消当前停留；没有停留时沿用现有语义 | 关闭信息窗 | 沿用现有判据 |
| 挥手 `wave` | 现有语义不变 | 无动作 | 沿用现有判据 |
| 张开手掌 `openPalm` | 现有语义不变 | 无动作 | 沿用现有判据 |
| 竖大拇指 `thumbsUp` | 现有语义不变 | 无动作 | 沿用现有判据 |

信息窗打开时，挥手不再触发「返回团队晨报」，避免阅读时误退出个人简报。信息窗内只有握拳和横滑生效。

防误触：

- 滑动只在 `dialog === 'info'` 时生效；主屏横滑不翻页。
- 滑动要求手在移动后近似静止 320ms，且窗口内无显著方向反转、置信度达标；挥手的第一段不会抢先触发翻页。
- 滑动后 300ms 内抑制 `openPalm` 与 `wave`；挥手事件产生时清空滑动窗口。
- 一次滑动只翻一页，冷却 700ms。
- 停留点击冷却 800ms；目标变化必须重新累计。
- 光标仅在 `point` 姿势下显示；`openPalm`/`fist`/`thumbsUp` 会立即隐藏光标并取消停留。
- 指针不模拟真实鼠标事件，只调用应用内动作；不会误触浏览器原生控件。
- 个人简报上正在停留时，握拳只取消停留并被消费，不触发「返回团队晨报」；没有停留时仍按现有语义返回。
- 指针在个人简报上同样生效。

### 5.6 发现性

手势运行且在主屏或个人简报时，成员面板的摄像头状态下方显示一行小字：

> 手势：食指指向卡片并停留打开 · 信息窗内张开手左右翻页

不影响现有布局；手势关闭或摄像头不可用时该行不显示。

## 6. 手势判据与参数

### 6.1 指姿

`analyzeHand` 现在返回 `{pose, extended, palmX, palmY, ruleScore}`。本次追加：

- `pose: 'point'`：食指伸出，中指、无名指、小指均弯曲；拇指不参与判定。
- `tipX`、`tipY`：landmark 8 的归一化坐标。
- `ruleScore`：`point` 为 3/3 或 4/4（按满足条件数计），用于调试页置信度展示。

判定顺序：`openPalm` → `thumbsUp` → `point` → `fist`。`point` 与其余姿势互斥。

### 6.2 横滑

在 `GestureStateMachine` 内新增滑动跟踪，与挥手共用 `palmX` 历史但独立判据：

- 输入：`pose === 'openPalm'`，`swipeX`（已按镜像换算到屏幕方向），`palmY`，`at`。
- `swipeX` 由 `GestureEngine` 计算：读取 `mirror`（默认 true），`swipeX = mirror ? 1 - palmX : palmX`。状态机只接收换算后的值，保证单测与运行方向一致；`palmX` 仍原样传入，用于既有挥手判据（只看反转次数，与方向无关）。
- 窗口：保留最近 600ms 的点。
- 基础条件：窗口首尾 `|ΔswipeX| ≥ 0.18`；竖向 `|ΔpalmY| ≤ 0.12`；至少 3 个采样点；`confidence ≥ minConfidence`。
- 方向一致：窗口内相邻有效步长（≥0.02）不得出现方向反转；有反转即视为挥手候选，不产生滑动。
- 静止确认：手在最近 `swipeSettleMs`（320ms）内的水平位移必须 ≤ `swipeSettleDistance`（0.02），且该窗口至少有 2 个采样点。满足基础条件后不立即发事件，等手近似静止再发；这样挥手在峰值处重复采样或自然减速时，反转会先出现在窗口里，不会被误判成滑动。
- 方向：`ΔswipeX > 0` 为 `swipeRight`，否则 `swipeLeft`。
- 触发后清空窗口、进入 700ms 冷却，并设置 300ms 的 `openPalm`/`wave` 抑制。
- 挥手事件产生时清空滑动窗口；滑动抑制期间也清空窗口，避免挥手结束后的残余位移被当成滑动。
- 置信度不足或姿势不是 `openPalm` 时清空滑动窗口，避免低质量样本在恢复后立即触发。

### 6.3 新增默认参数

追加到 `DEFAULT_GESTURE_SETTINGS`，不修改既有默认值：

```js
pointerDwellMs: 1000,
pointerSmoothing: 0.35,
pointerLostMs: 500,
pointerCooldownMs: 800,
swipeMinDistance: 0.18,
swipeMaxMs: 600,
swipeMaxRise: 0.12,
swipeCooldownMs: 700,
swipeSuppressMs: 300,
swipeSettleMs: 320,
swipeSettleDistance: 0.02,
```

## 7. 架构

### 7.1 数据流

```
<video>
  └─ GestureEngine ──> analyzeHand ──┬─ onFrame({ hands, pointer, ... })
        │                            │        └─ app.js: 映射 → 平滑 → 命中 → 停留进度
        │                            │                 ├─ 打开信息窗（dashboard.openInfo）
        │                            │                 └─ 点击信息窗内链接/箭头
        └─ GestureStateMachine ──> 事件（wave/openPalm/fist/thumbsUp/swipeLeft/swipeRight）
                                     └─ resolveGestureAction → app.js 动作分发
                                              └─ dashboard.flipPage(±1) / closeDialog()
```

### 7.2 文件改动

| 文件 | 改动 |
|---|---|
| `public/gesture-rules.js` | `analyzeHand` 增加 `point` 与指尖坐标；状态机增加横滑；`resolveGestureAction` 增加信息窗语义；新增默认参数 |
| `public/pointer-rules.js`（新增） | 纯逻辑：仿射映射、默认映射、夹取、平滑、`PointerController`（停留/目标/进度/点击） |
| `public/gesture.js` | 每帧附带 `pointer` 信息（指尖、镜像后 x、活跃状态）；设置透传 |
| `public/app.js` | 光标 DOM 生命周期、指针上下文守卫、命中测试、停留动作、信息窗分页动作、手势提示文案 |
| `public/dashboard.js` | 卡片/条目 `data-gesture-*` 属性；`openInfo`、`flipPage`、信息窗渲染与页码；鼠标点击卡片正文打开信息窗；方向键翻页 |
| `public/index.html` | 增加光标元素（进度环、圆点、隐藏态） |
| `public/dashboard.css` | 光标、悬停高亮、信息窗、页码与箭头、页码闪动反馈 |
| `public/wall.css` | 信息窗在窄屏/大屏下的尺寸与排版 |
| `public/debug.html`、`debug.css`、`debug.js` | 指针停留/滑动参数、四点标定入口与全屏标定层、测试光标、滑动手势日志 |
| `test/gesture.test.mjs` | 指姿、横滑、动作语义、指针映射与停留单测 |
| `test/info-window.mjs`（新增） | 浏览器回归：卡片属性、鼠标打开信息窗、翻页、Esc、链接不被劫持 |
| `package.json` | `test` / `test:browser` 增加新测试文件 |
| `README.md` | 新增手势指针、悬浮窗与翻页说明 |

`server.mjs` 不需要改动：没有新增静态资源或 MIME 类型。

### 7.3 公共接口

```js
// gesture-rules.js
analyzeHand(landmarks) -> {
  pose: 'openPalm' | 'fist' | 'thumbsUp' | 'point' | null,
  extended: boolean[], palmX, palmY, tipX, tipY, ruleScore
}

new GestureStateMachine(settings)
  .push({ pose, confidence, palmX, swipeX, palmY, hand, at })
  -> Array<{ type: 'wave'|'openPalm'|'fist'|'thumbsUp'|'swipeLeft'|'swipeRight', ... }>

resolveGestureAction(event, { enabled, dialog, candidateVia, personalVia, faceActive })
  -> 'confirm' | 'cancel' | 'home' | 'resumeFace' | 'greet' | 'closeInfo' | 'pageNext' | 'pagePrev' | null

// pointer-rules.js
// 输入为原始归一化指尖坐标；镜像在内部先于仿射应用。
mapToScreen({ x, y }, calibration, mirror = true) -> { x, y }   // 0..1
// pairs: [{ rawX, rawY, screenX, screenY }]，拟合前按 mirror 把 rawX 换算到屏幕方向。
solveAffine(pairs, mirror = true) -> { a, b, c, d, e, f } | null
new PointerController({ settings })
  .update({ x, y, active, at, target }) -> { visible, x, y, key, progress, click }
  .reset()
// target 由 app.js 命中测试提供：{ key: string|null, inside: boolean }
// PointerController 不访问 DOM，只做平滑、目标去重、停留计时与冷却。

// gesture.js
new GestureEngine(video, { onFrame, onEvent, settings })
  // onFrame 追加 pointer: { x, y, active }，x/y 为 landmark 8 的原始归一化坐标；
  // 映射到视口由 app.js 调用 mapToScreen 完成。
  // settings.mirror（默认 true）只影响滑动方向换算。
```

`dashboard` 对外新增：

```js
openInfo(moduleId, index = 0)  // 打开信息窗
flipPage(delta)                // 翻页，返回 {index,total} | null
infoState()                    // { open, moduleId, index, total } | null
```

### 7.4 存储

新增键：

```js
morning.gesture.pointer = {
  mirror: true,
  calibration: { a, b, c, d, e, f } | null,
  camera: { device: '<deviceId|>', size: '<1280x720|>' },
  updatedAt: 'ISO 时间'
}
```

- 调参仍写 `morning.gesture.tuning`，新增键合并进现有对象。
- 调试页保存后提示“刷新主屏生效”；主屏只在加载时读取。
- 清除标定写入 `calibration: null`，主屏回退默认映射。
- 标定时记录当时的 `morning.camera.device` 与 `morning.camera.size`。主屏应用标定前比对这两个值；不一致时忽略标定并回退默认映射，调试页提示「摄像头已变化，请重新标定」。
- 切换镜像开关会清除标定；重新标定后按新方向拟合。

### 7.5 终点标记与浏览器命中

`dashboard.js` 在渲染时为可点击内容加属性：

| 位置 | 属性 |
|---|---|
| 卡片 `<section>` | `data-gesture-card="<moduleId>"` |
| 新闻 `li` | `data-gesture-item="news:<moduleId>:<pageIndex>"` |
| 日程 `li` | `data-gesture-item="agenda:<moduleId>:<pageIndex>"` |
| 便签 `li` | `data-gesture-item="notes:<moduleId>:<pageIndex>"` |
| 快捷链接 `a` | `data-gesture-item="links:<moduleId>:<pageIndex>"` |
| 信息窗链接/按钮 | `data-gesture-key="info:<action>:<pageIndex>"` |
| 信息窗条目容器 | `data-info-page="<index>"` |

所有条目属性统一带数字页码；`data-gesture-key` 只出现在信息窗元素上。`app.js` 不解析业务数据，只把命中的 `data-gesture-card` 与条目序号交给 `dashboard.openInfo`。信息窗内的链接与按钮由浏览器原生命中，点击时使用 `elementFromPoint` 后 `.click()`；翻页后键值中的 `pageIndex` 变化，停留自动重置。

### 7.6 光标与顶层元素

`dialog.showModal()` 会把弹窗放进浏览器顶层（top layer），body 上的普通固定定位光标会被遮罩盖住。注意 `<dialog>` 自身带 `backdrop-filter`，它会成为 `position: fixed` 后代的包含块，因此把光标移进对话框会导致坐标基准错误。做法：

- `index.html` 只放一个 `#gesture-cursor`（含圆点与进度环），带 `popover="manual"`。
- 显示时调用 `showPopover()`，让它进入顶层；隐藏时调用 `hidePopover()`。它不挂在 `<dialog>` 内，坐标始终相对视口。
- 任何弹窗打开时先隐藏光标；下一帧若在信息窗上下文，再 `showPopover()`，保证它叠在刚打开的对话框之上。
- `pointer-events: none`，不参与命中测试；命中仍用光标坐标调用 `elementFromPoint`。
- 浏览器不支持 Popover API 时退回 body 上的固定定位（目标浏览器为 Chrome，正常路径不使用该回退）。

## 8. 调试页

- 手势面板新增：
  - 「指针停留」滑杆 300–2500ms（默认 1000）；
  - 「翻页滑动距离」滑杆 0.08–0.35（默认 0.18）；
  - 「镜像」开关（默认开；切换后清除标定并提示重新标定）；
  - 当前姿势显示 `指向`，并显示指尖在画面中的位置；
  - 手势日志记录 `swipeLeft` / `swipeRight`。
- 「四点标定」：进入全屏标定层，四角 8%/92% 处显示目标圆点，依次停留 800ms 采集指尖原始坐标；四点完成后最小二乘拟合仿射矩阵并保存；Esc 取消。标定期间不执行主屏动作。
- 「测试指针」：把当前指尖经保存的映射画成页面上的光标，便于确认方向与范围。
- 「清除标定」：恢复默认映射。
- 标定与测试都不录像、不截图、不上传；覆盖层只读取手部关键点。

## 9. 测试策略

### 单测（`node --test`）

- `analyzeHand`：仅食指伸出的夹具判定 `point`；中指也伸出时不判定；张开手掌/握拳/点赞不变；缺失或 NaN 关键点不抛错；指尖坐标正确。
- 横滑：单方向位移在静止确认后触发一次且方向正确；反向位移方向正确；未静止不触发；距离不足不触发；超过 600ms 不触发；竖向漂移过大不触发；置信度不足不触发；冷却期内不重复、且冷却前的样本不会在冷却结束时立即触发；挥手式来回摆动（包括幅度 ≥0.19、峰值处重复采样或减速）不触发滑动。
- 滑动后 300ms 内不产生 `openPalm`；挥手仍优先于 `openPalm`。
- `resolveGestureAction`：信息窗中 `fist → closeInfo`、`swipeLeft → pageNext`、`swipeRight → pagePrev`；信息窗中 `wave/openPalm/thumbsUp` 返回 null；`enabled: false` 时一律 null；其他弹窗行为不变。
- `mapToScreen`：默认映射镜像、边界夹取；仿射标定对已知四点还原；镜像在仿射之前应用；无效标定回退默认。
- `PointerController`：停留累计到阈值只点击一次；`target.key` 变化重置；`inside=false` 重置；手丢失超过 500ms 隐藏；冷却期内不重复；平滑值符合系数。
- `solveAffine`：用构造的四点与已知矩阵验证误差接近 0；退化点返回 null；按镜像换算输入。

### 浏览器回归（Playwright，沿用假摄像头）

- 现有全部用例通过；加载前固定 `morning.gesture.enabled = off`。
- 主屏卡片和条目带有 `data-gesture-*` 属性。
- 鼠标点击便签卡片正文打开信息窗；`下一页`/方向键翻页；页码更新；Esc 关闭；新闻链接仍打开新标签页（不被拦截）。
- 手势关闭时页面不出现光标元素，也不请求手势模型。
- 调试页显示指针参数、镜像开关与标定按钮；点击进入/取消标定层不报错；参数写入 localStorage。
- 信息窗翻页后，`data-gesture-key` 中的页码变化；光标元素带 `popover="manual"`，在信息窗打开后仍能显示在顶层。
- 标定记录的 `camera.device`/`size` 与当前设置不一致时，主屏回退默认映射，调试页显示重新标定提示。
- 手势模型 404 时指针与信息窗的鼠标/键盘路径仍可用。

### 手测清单（Windows 现在 / Mac 之后各跑一遍）

- 2 米内食指指向能稳定移动光标；手放下后光标 0.5 秒内隐藏。
- 停留 1 秒打开对应卡片/条目；中途移开或握拳取消。
- 信息窗内左右滑动各翻一页，边界不循环；握拳关闭。
- 路过、说话比划、拿水杯不触发点击或翻页（至少 10 次经过测试）。
- 标定后四个角与中心的目标可达；刷新主屏后保持。

## 10. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 摄像头视角与站位导致坐标偏差 | 四点标定；默认映射保守；调试页测试光标；标定后可调边距 |
| 手部关键点抖动 | 平滑 + 停留 1 秒 + 目标键不变才累计 + 手丢失容忍 |
| 光标移动太慢或跳帧 | 12.5fps 采样 + CSS 过渡；必要时调试页降低检测间隔 |
| 滑动与挥手混淆 | 单方向位移与方向反转互斥；滑动后抑制 300ms；独立单测 |
| 误点设置或身份确认 | 指针只在主屏与信息窗生效；其他弹窗禁用 |
| 信息窗打开时误退个人简报 | 信息窗内挥手不触发 home；只有握拳关闭 |
| 标定流程复杂 | 默认映射可用；四点标定仅需一次；调试页明确提示 |
| 悬浮窗内容过长 | 一页一条；页码与箭头；边界不循环；链接保留原文 |
| 模型/摄像头不可用 | 指针静默禁用；鼠标与键盘路径不受影响 |

## 11. 实施顺序

1. 纯规则：`point` 指姿、指尖坐标、横滑状态机、动作语义、指针映射与停留控制器，先写单测。
2. 引擎接线：`gesture.js` 每帧输出指针信息与滑动方向，保持现有行为不变。
3. 信息窗：数据属性、`openInfo`/`flipPage`、分页渲染、鼠标与键盘路径、浏览器用例。
4. 主屏指针：光标 DOM、上下文守卫、命中测试、停留动作、提示文案。
5. 调试页：参数滑杆、镜像、四点标定、测试指针、滑动日志。
6. 文档与回归：README、`npm test`、`npm run test:browser`、手测清单。

## 12. 留给实施者的决定

- 仿射求解的具体数值方法与默认映射常数，以单测和实测可达为准。
- 光标圆点/进度环的尺寸、颜色与动效细节，遵循现有材质与色板。
- 信息窗各模块的排版细节；可在不改变「一页一条」规则的前提下调整字号与留白。
- 默认映射在常见摄像头位置（屏幕上方居中）下的初始边距，先在 Windows 机器实测后定。
- 若 `point` 在远处识别不稳，可在不改变交互语义的前提下放宽中指弯曲判据，但需补单测。

## 13. 审查问题的处理（实施者决定，供确认）

| # | 问题 | 决定 |
|---|---|---|
| 1 | 指针控制器如何知道悬停目标 | `app.js` 做 DOM 命中，把 `{key, inside}` 传给 `PointerController.update`；控制器保持无 DOM 依赖 |
| 2 | `onFrame.pointer` 坐标空间 | 原始归一化指尖坐标；`app.js` 调 `mapToScreen` 先镜像再做仿射 |
| 3 | `mirror` 如何进入引擎 | 作为 `GestureEngine` 设置传入，引擎算好 `swipeX` 再交给状态机；调试页同样传入 |
| 4 | 日程条目的标识 | 所有条目用数字 `pageIndex`，不用 `eventId`；`openInfo(moduleId, index)` 不变 |
| 5 | 信息窗元素的停留键 | 新增 `data-gesture-key="info:<action>:<pageIndex>"`；翻页后键变化，停留自动重置 |
| 6 | 光标如何盖过弹窗 | 光标使用 `popover="manual"` 进入顶层；不放进 `<dialog>`，避免 `backdrop-filter` 改变固定定位基准 |
| 7 | 换摄像头/分辨率后标定是否有效 | 标定记录 device/size；不一致时忽略并回退默认映射，调试页提示重新标定 |
| 8 | 个人简报上握拳与停留冲突 | 正在停留时握拳只取消停留并被消费；没有停留时沿用现有「返回团队晨报」 |
| 9 | 横滑与挥手的第一段重叠 | 横滑要求移动后静止 320ms（至少 2 个采样点）、窗口内无显著方向反转且置信度达标；挥手事件与抑制期间清空滑动窗口，避免残余位移翻页 |
