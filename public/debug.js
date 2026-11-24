import { Camera, DEFAULT_FACE_TUNING, SAMPLE_MAX_DISTANCE, loadFaceTuning, enrolled, remember, forget, addSample, analyzeImage, templateSamples } from './camera.js';
import { distance } from './match.js';
import { GestureEngine } from './gesture.js';
import { DEFAULT_GESTURE_SETTINGS } from './gesture-rules.js';

const TUNING_KEY = 'morning.face.tuning';
const TEMPLATES_KEY = 'morning.wall.face-templates.v1';
const DEVICE_KEY = 'morning.camera.device';
const SIZE_KEY = 'morning.camera.size';
const GESTURE_ENABLED_KEY = 'morning.gesture.enabled';
const GESTURE_TUNING_KEY = 'morning.gesture.tuning';

const $ = id => document.getElementById(id);
const video = $('video');
const overlay = $('overlay');
const deviceSelect = $('device');
const sizeSelect = $('size');
const toggleButton = $('toggle');
const scoresBox = $('scores');
const statusBox = $('status');
const sampleNote = $('sample-note');
const enrollList = $('enroll-list');
const newMemberName = $('new-member-name');
const addMemberButton = $('add-member');
const importInput = $('import-templates');
const photoInput = $('photo-input');
const photoNote = $('photo-note');
const gestureToggle = $('gesture-toggle');
const gestureEnabledInput = $('gesture-enabled');
const gestureState = $('gesture-state');
const gestureStable = $('gesture-stable');
const gestureError = $('gesture-error');
const handFps = $('hand-fps');
const handTiming = $('hand-timing');
const handCount = $('hand-count');
const gestureLog = $('gesture-log');
const gestureExport = $('gesture-export');

const tuningInputs = {
  matchThreshold: $('match-threshold'),
  margin: $('margin'),
  detectScore: $('detect-score'),
  inputSize: $('input-size'),
};

const gestureInputs = {
  stableFrames: $('gesture-stable-frames'),
  holdMs: $('gesture-hold-ms'),
  cooldownMs: $('gesture-cooldown-ms'),
  intervalMs: $('gesture-interval-ms'),
};

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];
const GESTURE_LABELS = { openPalm: '张开手掌', fist: '握拳', thumbsUp: '竖大拇指', wave: '挥手' };

let tuning = loadFaceTuning();
let gestureTuning = loadGestureTuning();
let latestFrame = null;
let latestHands = [];
let latestHandFrame = null;
let engine = null;
let gestureStarting = false;
let profiles = [];
let profileNames = new Map();
let frameStamps = [];
let handFrameStamps = [];
let starting = false;
const pending = new Map();

function showError(message) {
  statusBox.dataset.state = 'error';
  statusBox.textContent = message || '发生未知错误。';
}

function showOk(message) {
  statusBox.dataset.state = 'ok';
  statusBox.textContent = message;
}

function showSampleError(message) {
  showError(message);
  sampleNote.textContent = message;
}

function describeError(error) {
  return error?.message || String(error || '未知错误');
}

function readTuningInputs() {
  return {
    matchThreshold: Number(tuningInputs.matchThreshold.value),
    margin: Number(tuningInputs.margin.value),
    detectScore: Number(tuningInputs.detectScore.value),
    inputSize: Number(tuningInputs.inputSize.value),
  };
}

function syncTuningInputs(values) {
  for (const [key, input] of Object.entries(tuningInputs)) {
    if (Number.isFinite(values[key])) input.value = String(values[key]);
  }
  for (const input of Object.values(tuningInputs)) {
    const output = document.querySelector(`output[for="${input.id}"]`);
    if (output) output.textContent = input.value;
  }
}

function applyTuning(values = readTuningInputs(), persist = true) {
  tuning = { ...DEFAULT_FACE_TUNING, ...values };
  syncTuningInputs(tuning);
  camera.setTuning(tuning);
  if (persist) {
    try {
      localStorage.setItem(TUNING_KEY, JSON.stringify(tuning));
      sampleNote.textContent = '识别参数已保存，刷新主屏后生效。';
    } catch (error) {
      showError('调参保存失败：' + describeError(error));
    }
  }
}

function loadGestureTuning() {
  let stored = {};
  try {
    const raw = localStorage.getItem(GESTURE_TUNING_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) stored = parsed;
  } catch { stored = {}; }
  const merged = {};
  for (const [key, fallback] of Object.entries(DEFAULT_GESTURE_SETTINGS)) {
    merged[key] = Number.isFinite(stored[key]) ? stored[key] : fallback;
  }
  return merged;
}

function syncGestureInputs(values = gestureTuning) {
  for (const [key, input] of Object.entries(gestureInputs)) {
    if (Number.isFinite(values[key])) input.value = String(values[key]);
    const output = document.querySelector(`output[for="${input.id}"]`);
    if (output) output.textContent = input.value;
  }
}

function readGestureInputs() {
  return Object.fromEntries(
    Object.entries(gestureInputs).map(([key, input]) => [key, Number(input.value)]),
  );
}

function showGestureError(message) {
  gestureError.textContent = message || '';
}

function persistGestureTuning() {
  try {
    localStorage.setItem(GESTURE_TUNING_KEY, JSON.stringify(gestureTuning));
  } catch (error) {
    showGestureError('手势调参保存失败：' + describeError(error));
  }
}

function applyGestureTuning(values = readGestureInputs(), persist = true) {
  const merged = { ...DEFAULT_GESTURE_SETTINGS, ...gestureTuning };
  for (const [key, value] of Object.entries(values)) {
    if (Number.isFinite(value)) merged[key] = value;
  }
  gestureTuning = merged;
  syncGestureInputs();
  engine?.updateSettings(gestureTuning);
  if (persist) persistGestureTuning();
}

function onFrame(payload) {
  try {
    latestFrame = payload;
    renderStatus(payload);
    renderScores(payload);
    drawOverlay(payload?.detections);
  } catch (error) {
    showError('调试页绘制失败：' + describeError(error));
  }
}

function renderStatus(payload) {
  const now = performance.now();
  frameStamps.push(now);
  frameStamps = frameStamps.filter(stamp => now - stamp <= 2000);
  const fps = frameStamps.length > 1
    ? ((frameStamps.length - 1) / ((now - frameStamps[0]) / 1000)).toFixed(1)
    : '0.0';
  const count = Number.isFinite(payload?.count) ? payload.count : 0;
  const detectMs = Number.isFinite(payload?.timings?.detectMs) ? payload.timings.detectMs : '—';
  showOk(`人脸 ${count} · 检测 ${detectMs}ms · 人脸 ${fps}/s`);
}

function formatScore(value) {
  return Number.isFinite(value) ? value.toFixed(2) : '—';
}

function renderScores(payload) {
  const scores = Array.isArray(payload?.scores) ? payload.scores : [];
  scoresBox.textContent = '';
  if (!scores.length) {
    const empty = document.createElement('p');
    if (payload?.count > 1) empty.textContent = '检测到多张人脸，距离不计算。';
    else if (payload?.count) empty.textContent = '检测到人脸，但还没有成员样本。';
    else empty.textContent = '未检测到人脸。';
    scoresBox.append(empty);
    return;
  }
  const threshold = Number(payload?.threshold);
  for (let index = 0; index < scores.length; index += 1) {
    const item = scores[index];
    const row = document.createElement('p');
    row.className = 'score';
    if (index === 0) row.dataset.best = 'true';
    const name = profileNames.get(item.id) || item.id;
    const label = document.createElement('span');
    label.textContent = `${name} ${formatScore(item.score)}`;
    row.append(label);
    if (index === 0 && Number.isFinite(threshold)) {
      const tag = document.createElement('span');
      tag.className = 'score-tag';
      tag.textContent = `阈值 ${formatScore(threshold)}`;
      row.append(tag);
    } else if (index === 1 && Number.isFinite(scores[0]?.score)) {
      const tag = document.createElement('span');
      tag.className = 'score-tag';
      tag.textContent = `差距 ${formatScore(item.score - scores[0].score)}`;
      row.append(tag);
    }
    scoresBox.append(row);
  }
  const best = scores[0];
  const second = scores[1];
  const margin = Number(payload?.margin);
  let verdict;
  if (payload?.match) verdict = `已匹配 ${profileNames.get(payload.match) || payload.match}`;
  else if (Number.isFinite(best?.score) && Number.isFinite(threshold) && best.score > threshold)
    verdict = `未达阈值（${formatScore(best.score)} > ${formatScore(threshold)}）`;
  else if (second && Number.isFinite(second.score) && Number.isFinite(best?.score) && Number.isFinite(margin) && second.score - best.score < margin)
    verdict = `与第二名差距不足（${formatScore(second.score - best.score)} < ${formatScore(margin)}）`;
  else verdict = '匹配结果为空';
  const summary = document.createElement('p');
  summary.className = 'score-summary';
  summary.textContent = `结论：${verdict}`;
  scoresBox.append(summary);
}

function drawOverlay(detections) {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return;
  const ratio = window.devicePixelRatio || 1;
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  if (overlay.width !== pixelWidth) overlay.width = pixelWidth;
  if (overlay.height !== pixelHeight) overlay.height = pixelHeight;
  const context = overlay.getContext('2d');
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.lineWidth = 2;
  context.strokeStyle = '#59d2ff';
  context.fillStyle = '#ffd166';
  for (const detection of Array.isArray(detections) ? detections : []) {
    const box = detection?.box;
    if (box && [box.x, box.y, box.width, box.height].every(Number.isFinite)) {
      context.strokeRect(box.x, box.y, box.width, box.height);
    }
    for (const point of Array.isArray(detection?.landmarks) ? detection.landmarks : []) {
      if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) continue;
      context.beginPath();
      context.arc(point.x, point.y, 1.6, 0, Math.PI * 2);
      context.fill();
    }
  }
  drawHands(context, latestHands, width, height);
}

function validPoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

function drawHands(context, hands, width, height) {
  for (const hand of Array.isArray(hands) ? hands : []) {
    const points = Array.isArray(hand?.landmarks) ? hand.landmarks : [];
    context.strokeStyle = '#a78bfa';
    context.fillStyle = '#f472b6';
    for (const [from, to] of HAND_CONNECTIONS) {
      const a = points[from];
      const b = points[to];
      if (!validPoint(a) || !validPoint(b)) continue;
      context.beginPath();
      context.moveTo(a.x * width, a.y * height);
      context.lineTo(b.x * width, b.y * height);
      context.stroke();
    }
    for (const point of points) {
      if (!validPoint(point)) continue;
      context.beginPath();
      context.arc(point.x * width, point.y * height, 1.8, 0, Math.PI * 2);
      context.fill();
    }
  }
}

function handFpsValue() {
  const now = performance.now();
  handFrameStamps.push(now);
  handFrameStamps = handFrameStamps.filter(stamp => now - stamp <= 2000);
  return handFrameStamps.length > 1
    ? ((handFrameStamps.length - 1) / ((now - handFrameStamps[0]) / 1000)).toFixed(1)
    : '0.0';
}

function handLabel(handedness) {
  if (handedness === 'Left') return '左手';
  if (handedness === 'Right') return '右手';
  return handedness || '手部';
}

function currentStableFrames() {
  const value = engine?.settings?.stableFrames;
  return Number.isFinite(value) ? value : gestureTuning.stableFrames;
}

function renderHandStats(payload, hands, best) {
  const detectMs = Number.isFinite(payload?.timings?.detectMs) ? payload.timings.detectMs : null;
  handFps.textContent = `手部 ${handFpsValue()}/s`;
  handTiming.textContent = `手部耗时 ${detectMs === null ? '—' : detectMs}ms`;
  const score = Number.isFinite(best?.score) ? best.score.toFixed(2) : '—';
  handCount.textContent = best
    ? `手: ${hands.length} (${handLabel(best.handedness)} ${score})`
    : `手: ${hands.length}`;
  const stable = Number.isFinite(payload?.progress?.count) ? payload.progress.count : 0;
  gestureStable.textContent = `稳定 ${stable}/${currentStableFrames()}`;
}

function resetHandStats() {
  handFrameStamps = [];
  handFps.textContent = '手部 —/s';
  handTiming.textContent = '手部耗时 —ms';
  handCount.textContent = '手: 0';
  gestureStable.textContent = `稳定 0/${currentStableFrames()}`;
}

function onGestureFrame(payload) {
  try {
    const hands = Array.isArray(payload?.hands) ? payload.hands : [];
    latestHands = hands;
    const best = hands.length
      ? hands.reduce((current, hand) => (hand.score > current.score ? hand : current), hands[0])
      : null;
    if (best) {
      latestHandFrame = { landmarks: best.landmarks, handedness: best.handedness, at: payload?.at };
      const pose = payload?.pose;
      const confidence = Number.isFinite(payload?.confidence) ? payload.confidence : 0;
      gestureState.textContent = pose
        ? `${GESTURE_LABELS[pose] || pose} · 置信度 ${confidence.toFixed(2)}`
        : `检测到手部 · 置信度 ${confidence.toFixed(2)}`;
    } else {
      gestureState.textContent = '未检测到';
    }
    renderHandStats(payload, hands, best);
    drawOverlay(latestFrame?.detections);
  } catch (error) {
    showGestureError('手势画面绘制失败：' + describeError(error));
  }
}

function onGestureEvent(event) {
  if (!event) return;
  try {
    const item = document.createElement('li');
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const confidence = Number.isFinite(event.confidence) ? ` · ${event.confidence.toFixed(2)}` : '';
    item.textContent = `${time} ${GESTURE_LABELS[event.type] || event.type}${confidence}`;
    gestureLog.prepend(item);
    while (gestureLog.children.length > 20) gestureLog.lastElementChild.remove();
  } catch (error) {
    showGestureError('手势日志更新失败：' + describeError(error));
  }
}

function setGestureToggleState() {
  gestureToggle.textContent = engine?.running ? '停止手势' : '启动手势';
  gestureToggle.disabled = gestureStarting;
}

function resetGestureView() {
  latestHands = [];
  latestHandFrame = null;
  resetHandStats();
  drawOverlay(latestFrame?.detections);
}

async function startGestures() {
  if (engine?.running || gestureStarting) return;
  if (!video.videoWidth) {
    showGestureError('请先开启摄像头再启动手势。');
    return;
  }
  gestureStarting = true;
  setGestureToggleState();
  showGestureError('');
  gestureState.textContent = '手势启动中…';
  let next = null;
  try {
    next = new GestureEngine(video, {
      onFrame: onGestureFrame,
      onEvent: onGestureEvent,
      onStop: onEngineStopped,
      settings: gestureTuning,
    });
    await next.start();
    engine = next;
    gestureState.textContent = '未检测到';
  } catch (error) {
    next?.stop();
    showGestureError('手势引擎启动失败：' + describeError(error));
    gestureState.textContent = '手势未启动';
    resetGestureView();
  } finally {
    gestureStarting = false;
    setGestureToggleState();
  }
}

function onEngineStopped(error) {
  engine = null;
  resetGestureView();
  gestureState.textContent = '手势未启动';
  if (error) showGestureError('手势检测已停止：' + describeError(error));
  setGestureToggleState();
}

function stopGestures() {
  const current = engine;
  engine = null;
  try { current?.stop(); } catch (error) { console.warn('手势停止失败', error); }
  resetGestureView();
  gestureState.textContent = '手势未启动';
  setGestureToggleState();
}

function toggleGestures() {
  if (engine?.running) stopGestures();
  else void startGestures();
}

function exportGestureFrame() {
  if (!latestHandFrame) {
    showGestureError('还没有检测到手部，无法导出手势帧。');
    return;
  }
  try {
    const blob = new Blob([JSON.stringify(latestHandFrame)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'halo-gesture-frame.json';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showGestureError('');
  } catch (error) {
    showGestureError('导出手势帧失败：' + describeError(error));
  }
}

function gestureEnabled() {
  try { return localStorage.getItem(GESTURE_ENABLED_KEY) !== 'off'; } catch { return true; }
}

function persistGestureEnabled(enabled) {
  try {
    localStorage.setItem(GESTURE_ENABLED_KEY, enabled ? 'on' : 'off');
  } catch (error) {
    showGestureError('手势开关保存失败：' + describeError(error));
  }
}

const camera = new Camera(video, onFrame, onError, tuning);
camera.setDebug(true);

function onError(message) {
  showError(message || '摄像头出现错误。');
  setToggleState();
}

function setToggleState() {
  toggleButton.textContent = camera.streaming ? '关闭摄像头' : '开启摄像头';
}

async function start() {
  if (starting) return;
  starting = true;
  toggleButton.disabled = true;
  try {
    await camera.openCamera();
    if (camera.faceActive) showOk('摄像头已开启，等待人脸。');
    else showError('人脸识别未能启动，请重试。');
    await listDevices();
  } catch (error) {
    showError(describeError(error));
  } finally {
    starting = false;
    toggleButton.disabled = false;
    setToggleState();
  }
}

function stop() {
  stopGestures();
  camera.stop();
  frameStamps = [];
  setToggleState();
  statusBox.dataset.state = 'idle';
  statusBox.textContent = '摄像头已关闭。';
}

async function restartCamera() {
  stopGestures();
  try {
    camera.stop();
    setToggleState();
    await camera.openCamera();
    await listDevices();
    if (camera.faceActive) showOk('摄像头已重新开启。');
    if (gestureEnabledInput.checked && camera.streaming) void startGestures();
  } catch (error) {
    showError(describeError(error));
  } finally {
    setToggleState();
  }
}

function savedDevice() {
  try { return localStorage.getItem(DEVICE_KEY) || ''; } catch { return ''; }
}

function savedSize() {
  try { return localStorage.getItem(SIZE_KEY) || '1280x720'; } catch { return '1280x720'; }
}

async function listDevices() {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    const selected = savedDevice();
    deviceSelect.textContent = '';
    const automatic = document.createElement('option');
    automatic.value = '';
    automatic.textContent = '默认摄像头';
    deviceSelect.append(automatic);
    let index = 0;
    for (const device of devices) {
      if (device.kind !== 'videoinput' || !device.deviceId) continue;
      index += 1;
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label || `摄像头 ${index}`;
      deviceSelect.append(option);
    }
    if ([...deviceSelect.options].some(option => option.value === selected)) deviceSelect.value = selected;
  } catch (error) {
    showError('无法读取摄像头列表：' + describeError(error));
  }
}

function memberCount(id) {
  if (!id) return 0;
  try {
    const bank = JSON.parse(localStorage.getItem(TEMPLATES_KEY) || '{}');
    return Array.isArray(bank?.[id]) ? bank[id].length : 0;
  } catch {
    return 0;
  }
}

function updateMemberOption(id) {
  const option = [...enrollList.options].find(item => item.value === id);
  if (!option) return;
  const name = profileNames.get(id) || id;
  const count = memberCount(id);
  option.textContent = count ? `${name} · ${count} 组` : name;
}

function updateAllMemberOptions() {
  for (const option of enrollList.options) if (option.value) updateMemberOption(option.value);
}

function updateMemberState() {
  const id = enrollList.value;
  if (!id) {
    sampleNote.textContent = '';
    return;
  }
  updateMemberOption(id);
  const name = profileNames.get(id) || id;
  const saved = enrolled(id) && memberCount(id);
  const waiting = pending.get(id)?.length || 0;
  if (saved) sampleNote.textContent = `${name} 已保存 ${saved} 组特征；重新采集 3 组后会覆盖。`;
  else if (waiting) sampleNote.textContent = `${name} 本次已采集 ${waiting}/3 组。`;
  else sampleNote.textContent = `${name} 尚未采集特征。`;
}

async function loadProfiles() {
  try {
    const response = await fetch('/api/wall');
    if (!response.ok) throw Error('简报服务未就绪。');
    const data = await response.json();
    profiles = Array.isArray(data?.profiles) ? data.profiles : [];
    profileNames = new Map(profiles.map(profile => [profile.id, profile.name]));
    const previous = enrollList.value;
    enrollList.textContent = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '选择成员';
    enrollList.append(placeholder);
    for (const profile of profiles) {
      const option = document.createElement('option');
      option.value = profile.id;
      option.textContent = profile.name || profile.id;
      enrollList.append(option);
      updateMemberOption(profile.id);
    }
    if ([...enrollList.options].some(option => option.value === previous)) enrollList.value = previous;
    updateMemberState();
  } catch (error) {
    showError('读取成员列表失败：' + describeError(error));
  }
}

async function createMember(name) {
  const response = await fetch('/api/profiles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: '', name, repos: [] }),
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || '添加成员失败。');
  return data;
}

async function addMember() {
  const name = newMemberName.value.trim();
  if (!name) {
    sampleNote.textContent = '请输入新成员名字。';
    newMemberName.focus();
    return;
  }
  addMemberButton.disabled = true;
  try {
    const data = await createMember(name);
    newMemberName.value = '';
    await loadProfiles();
    if ([...enrollList.options].some(option => option.value === data.id)) enrollList.value = data.id;
    updateMemberState();
    sampleNote.textContent = `已添加成员 ${data.name || name}，可以开始采集人脸。`;
  } catch (error) {
    showSampleError('添加成员失败：' + describeError(error));
  } finally {
    addMemberButton.disabled = false;
  }
}

async function importPhotos(files) {
  if (!files?.length) return;
  const results = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    photoNote.textContent = `正在处理 ${index + 1}/${files.length}：${file.name}`;
    const name = file.name.replace(/\.[^.]+$/, '').trim().slice(0, 20);
    try {
      if (!name) throw Error('文件名为空');
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close?.();
      const found = await analyzeImage(canvas, tuning);
      if (!found.length) throw Error('未检测到人脸');
      if (found.length > 1) throw Error('检测到多张脸，请换单人照');
      let profile = profiles.find(item => item.name === name);
      if (!profile) {
        profile = await createMember(name);
        profiles.push(profile);
      }
      const existing = templateSamples(profile.id);
      if (existing.length >= 3) throw Error('已有 3 组特征，请先清除');
      const next = addSample(existing, found[0].descriptor);
      if (!next.length) throw Error('与已有样本差异过大');
      remember(profile.id, next);
      results.push(`${name}：已保存 ${next.length} 组`);
    } catch (error) {
      results.push(`${file.name}：跳过（${describeError(error)}）`);
    }
  }
  await loadProfiles();
  photoNote.textContent = results.join('；');
  photoInput.value = '';
}

function captureSample() {
  const id = enrollList.value;
  if (!id) {
    sampleNote.textContent = '请先选择成员。';
    return;
  }
  const name = profileNames.get(id) || id;
  const face = latestFrame?.face;
  if (!Array.isArray(face)) {
    sampleNote.textContent = '未检测到人脸，请正对镜头后重试。';
    return;
  }
  const current = pending.get(id) || [];
  if (current.length >= 3) {
    sampleNote.textContent = `${name} 本次已采集 3 组，保存后重新选择即可。`;
    return;
  }
  const next = addSample(current, face);
  if (!next.length) {
    const closest = Math.min(...current.map(other => distance(other, face)));
    const hint = Number.isFinite(closest)
      ? `最近距离 ${closest.toFixed(2)}，采集门槛 ${SAMPLE_MAX_DISTANCE.toFixed(2)}。`
      : '';
    sampleNote.textContent = `这张脸与已采集样本差异过大（${hint}）请保持光线和距离、正对镜头重试，或点“重置本次采集”重新开始。`;
    return;
  }
  pending.set(id, next);
  if (next.length < 3) {
    sampleNote.textContent = `${name} 本次已采集 ${next.length}/3 组，请稍微变换角度。`;
    return;
  }
  try {
    remember(id, next);
    pending.delete(id);
    updateMemberOption(id);
    sampleNote.textContent = `已保存 ${name} 的 3 组人脸特征。`;
  } catch (error) {
    pending.delete(id);
    showSampleError(describeError(error));
  }
}

function resetSamples() {
  const id = enrollList.value;
  if (!id) {
    sampleNote.textContent = '请先选择成员。';
    return;
  }
  pending.delete(id);
  updateMemberState();
  const name = profileNames.get(id) || id;
  sampleNote.textContent = `已重置 ${name} 的本次采集，请重新采集 3 组。`;
}

function forgetMember() {
  const id = enrollList.value;
  if (!id) {
    sampleNote.textContent = '请先选择成员。';
    return;
  }
  const name = profileNames.get(id) || id;
  if (!memberCount(id)) {
    sampleNote.textContent = `${name} 还没有保存的人脸特征。`;
    return;
  }
  try {
    forget(id);
    pending.delete(id);
    updateMemberOption(id);
    sampleNote.textContent = `已清除 ${name} 的人脸特征。`;
  } catch (error) {
    showSampleError('清除特征失败：' + describeError(error));
  }
}

function exportTemplates() {
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY) || '{}';
    const blob = new Blob([raw], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'halo-face-templates.json';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    sampleNote.textContent = '已导出人脸特征 JSON。';
  } catch (error) {
    showSampleError('导出特征失败：' + describeError(error));
  }
}

async function importTemplates(file) {
  if (!file) return;
  try {
    const bank = JSON.parse(await file.text());
    if (!bank || typeof bank !== 'object' || Array.isArray(bank)) throw Error('特征文件格式不正确。');
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(bank));
    pending.clear();
    sampleNote.textContent = '已导入人脸特征。';
    updateAllMemberOptions();
    updateMemberState();
  } catch (error) {
    showSampleError('导入特征失败：' + describeError(error));
  } finally {
    importInput.value = '';
  }
}

function clearTemplates() {
  try {
    localStorage.removeItem(TEMPLATES_KEY);
    pending.clear();
    sampleNote.textContent = '已清空全部人脸特征。';
    updateAllMemberOptions();
    updateMemberState();
  } catch (error) {
    showSampleError('清空特征失败：' + describeError(error));
  }
}

function wireEvents() {
  toggleButton.addEventListener('click', () => {
    if (starting) return;
    if (camera.streaming) stop();
    else void start();
  });

  for (const input of Object.values(tuningInputs)) {
    input.addEventListener('input', () => {
      const output = document.querySelector(`output[for="${input.id}"]`);
      if (output) output.textContent = input.value;
      applyTuning();
    });
  }

  $('restore-tuning').addEventListener('click', () => {
    applyTuning(DEFAULT_FACE_TUNING);
    sampleNote.textContent = '已恢复默认识别参数，刷新主屏后生效。';
  });

  deviceSelect.addEventListener('change', () => {
    try {
      if (deviceSelect.value) localStorage.setItem(DEVICE_KEY, deviceSelect.value);
      else localStorage.removeItem(DEVICE_KEY);
    } catch (error) {
      showError('设备设置保存失败：' + describeError(error));
    }
    void restartCamera();
  });

  sizeSelect.addEventListener('change', () => {
    const value = sizeSelect.value;
    if (!/^\d{2,5}x\d{2,5}$/.test(value)) {
      showError('分辨率格式不正确。');
      return;
    }
    try {
      localStorage.setItem(SIZE_KEY, value);
    } catch (error) {
      showError('分辨率设置保存失败：' + describeError(error));
    }
    void restartCamera();
  });

  enrollList.addEventListener('change', updateMemberState);
  addMemberButton.addEventListener('click', () => void addMember());
  newMemberName.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void addMember();
  });
  $('capture-sample').addEventListener('click', captureSample);
  $('reset-samples').addEventListener('click', resetSamples);
  $('forget-member').addEventListener('click', forgetMember);
  $('export-templates').addEventListener('click', exportTemplates);
  $('clear-templates').addEventListener('click', clearTemplates);
  importInput.addEventListener('change', () => void importTemplates(importInput.files?.[0]));
  photoInput.addEventListener('change', () => void importPhotos(Array.from(photoInput.files || [])));

  gestureToggle.addEventListener('click', toggleGestures);
  gestureEnabledInput.addEventListener('change', () => {
    persistGestureEnabled(gestureEnabledInput.checked);
    if (gestureEnabledInput.checked) void startGestures();
    else stopGestures();
  });
  for (const input of Object.values(gestureInputs)) {
    input.addEventListener('input', () => {
      const output = document.querySelector(`output[for="${input.id}"]`);
      if (output) output.textContent = input.value;
      applyGestureTuning();
    });
  }
  gestureExport.addEventListener('click', exportGestureFrame);

  navigator.mediaDevices?.addEventListener?.('devicechange', () => void listDevices());

  const redraw = () => {
    try {
      drawOverlay(latestFrame?.detections);
    } catch (error) {
      showError('叠加层重绘失败：' + describeError(error));
    }
  };
  window.addEventListener('resize', redraw);
  video.addEventListener('resize', redraw);
  video.addEventListener('loadedmetadata', redraw);
}

function savedSizeValue() {
  const value = savedSize();
  return [...sizeSelect.options].some(option => option.value === value) ? value : '1280x720';
}

async function boot() {
  applyGestureTuning(gestureTuning, true);
  gestureEnabledInput.checked = gestureEnabled();
  syncTuningInputs(tuning);
  sizeSelect.value = savedSizeValue();
  wireEvents();
  await listDevices();
  await loadProfiles();
  await start();
  if (gestureEnabledInput.checked && camera.streaming) void startGestures();
}

window.addEventListener('beforeunload', () => {
  try { engine?.stop(); } catch { /* page is going away */ }
});

window.addEventListener('unhandledrejection', event => {
  showError('操作失败：' + describeError(event.reason));
  event.preventDefault();
});

window.addEventListener('error', event => {
  if (event?.message) showError('页面错误：' + event.message);
});

export { start, stop, renderScores, applyTuning };

void boot().catch(error => showError('调试页初始化失败：' + describeError(error)));
