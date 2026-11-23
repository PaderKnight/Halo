import { Camera, DEFAULT_FACE_TUNING, loadFaceTuning, enrolled, remember, forget, addSample } from './camera.js';

const TUNING_KEY = 'morning.face.tuning';
const TEMPLATES_KEY = 'morning.wall.face-templates.v1';
const DEVICE_KEY = 'morning.camera.device';
const SIZE_KEY = 'morning.camera.size';

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
const importInput = $('import-templates');

const tuningInputs = {
  matchThreshold: $('match-threshold'),
  margin: $('margin'),
  detectScore: $('detect-score'),
  inputSize: $('input-size'),
};

let tuning = loadFaceTuning();
let latestFrame = null;
let profiles = [];
let profileNames = new Map();
let frameStamps = [];
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
  showOk(`人脸 ${count} · 检测 ${detectMs}ms · 人脸 ${fps}/s · 手部 —/s`);
}

function formatScore(value) {
  return Number.isFinite(value) ? value.toFixed(2) : '—';
}

function renderScores(payload) {
  const scores = Array.isArray(payload?.scores) ? payload.scores : [];
  scoresBox.textContent = '';
  if (!scores.length) {
    const empty = document.createElement('p');
    empty.textContent = payload?.count ? '检测到人脸，但还没有成员样本。' : '未检测到人脸。';
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
  camera.stop();
  frameStamps = [];
  setToggleState();
  statusBox.dataset.state = 'idle';
  statusBox.textContent = '摄像头已关闭。';
}

async function restartCamera() {
  try {
    camera.stop();
    setToggleState();
    await camera.openCamera();
    await listDevices();
    if (camera.faceActive) showOk('摄像头已重新开启。');
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

function updateMemberState() {
  const id = enrollList.value;
  if (!id) {
    sampleNote.textContent = '';
    return;
  }
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
    }
    if ([...enrollList.options].some(option => option.value === previous)) enrollList.value = previous;
    updateMemberState();
  } catch (error) {
    showError('读取成员列表失败：' + describeError(error));
  }
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
    sampleNote.textContent = '这张脸与已采集样本差异过大，请调整姿势后重试。';
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
    sampleNote.textContent = `已保存 ${name} 的 3 组人脸特征。`;
  } catch (error) {
    pending.delete(id);
    showSampleError(describeError(error));
  }
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
  $('capture-sample').addEventListener('click', captureSample);
  $('forget-member').addEventListener('click', forgetMember);
  $('export-templates').addEventListener('click', exportTemplates);
  $('clear-templates').addEventListener('click', clearTemplates);
  importInput.addEventListener('change', () => void importTemplates(importInput.files?.[0]));

  $('gesture-toggle').addEventListener('click', () => {
    sampleNote.textContent = '手势面板将在下一步接入。';
  });

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
  syncTuningInputs(tuning);
  sizeSelect.value = savedSizeValue();
  wireEvents();
  await listDevices();
  await loadProfiles();
  await start();
}

window.addEventListener('unhandledrejection', event => {
  showError('操作失败：' + describeError(event.reason));
  event.preventDefault();
});

window.addEventListener('error', event => {
  if (event?.message) showError('页面错误：' + event.message);
});

export { start, stop, renderScores, applyTuning };

void boot().catch(error => showError('调试页初始化失败：' + describeError(error)));
