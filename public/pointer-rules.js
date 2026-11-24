import { DEFAULT_GESTURE_SETTINGS, mirrorX } from './gesture-rules.js';

export const DEFAULT_POINTER_MAP = { left: 0.15, right: 0.85, top: 0.15, bottom: 0.9 };

const clamp01 = value => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

const isCalibration = calibration => calibration != null
  && ['a', 'b', 'c', 'd', 'e', 'f'].every(key => Number.isFinite(calibration[key]));

export function mapToScreen(point, calibration = null, mirror = true) {
  const raw = point && typeof point === 'object' ? point : {};
  const mx = mirrorX(Number(raw.x), mirror);
  const my = Number(raw.y);
  if (isCalibration(calibration)) {
    return {
      x: clamp01(calibration.a * mx + calibration.b * my + calibration.c),
      y: clamp01(calibration.d * mx + calibration.e * my + calibration.f),
    };
  }
  const { left, right, top, bottom } = DEFAULT_POINTER_MAP;
  return {
    x: clamp01((mx - left) / (right - left)),
    y: clamp01((my - top) / (bottom - top)),
  };
}

function det3(m) {
  return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
    - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
    + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
}

function solve3(m, b) {
  const det = det3(m);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return null;
  const replace = col => m.map((row, i) => row.map((value, j) => (j === col ? b[i] : value)));
  return {
    x: det3(replace(0)) / det,
    y: det3(replace(1)) / det,
    z: det3(replace(2)) / det,
  };
}

export function solveAffine(pairs, mirror = true) {
  if (!Array.isArray(pairs)) return null;
  const points = [];
  for (const pair of pairs) {
    if (!pair || typeof pair !== 'object') continue;
    const { rawX, rawY, screenX, screenY } = pair;
    if (![rawX, rawY, screenX, screenY].every(Number.isFinite)) continue;
    points.push({ mx: mirrorX(rawX, mirror), my: rawY, screenX, screenY });
  }
  if (points.length < 3) return null;

  // Normal equations: (AᵀA) [a,b,c]ᵀ = Aᵀ screen, with each design row [mx, rawY, 1].
  const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const bx = [0, 0, 0];
  const by = [0, 0, 0];
  for (const { mx, my, screenX, screenY } of points) {
    const row = [mx, my, 1];
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) m[i][j] += row[i] * row[j];
      bx[i] += row[i] * screenX;
      by[i] += row[i] * screenY;
    }
  }

  const sx = solve3(m, bx);
  const sy = solve3(m, by);
  if (!sx || !sy) return null;
  return { a: sx.x, b: sx.y, c: sx.z, d: sy.x, e: sy.y, f: sy.z };
}

export function isCalibrationCurrent(savedCamera, currentCamera) {
  if (!savedCamera || !currentCamera) return false;
  const saved = typeof savedCamera === 'object' ? savedCamera : {};
  const current = typeof currentCamera === 'object' ? currentCamera : {};
  if (saved.device == null || saved.size == null) return false;
  if (current.device == null || current.size == null) return false;
  return saved.device === current.device && saved.size === current.size;
}

export function calibrationWindow(samples, {
  at,
  windowMs,
  requiredMs = 800,
  maxSpread = 0.05,
  minSamples = 3,
} = {}) {
  const now = Number.isFinite(at) ? at : 0;
  const width = Number.isFinite(windowMs) ? windowMs : 0;
  const list = Array.isArray(samples) ? samples : [];
  // Only points inside the trailing window survive; early movement ages out.
  const kept = list.filter(sample => sample != null
    && Number.isFinite(sample.at)
    && now - sample.at <= width);
  if (!kept.length) return { kept, span: 0, spread: 0, ready: false, progress: 0 };

  const span = kept[kept.length - 1].at - kept[0].at;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const sample of kept) {
    if (!Number.isFinite(sample.x) || !Number.isFinite(sample.y)) continue;
    minX = Math.min(minX, sample.x);
    maxX = Math.max(maxX, sample.x);
    minY = Math.min(minY, sample.y);
    maxY = Math.max(maxY, sample.y);
  }
  const spread = Number.isFinite(minX)
    ? Math.max(maxX - minX, maxY - minY)
    : 0;
  const required = Number.isFinite(requiredMs) ? requiredMs : 800;
  const threshold = Number.isFinite(maxSpread) ? maxSpread : 0.05;
  const ready = kept.length >= minSamples && span >= required && spread <= threshold;
  const progress = required > 0 ? Math.min(1, span / required) : 1;
  return { kept, span, spread, ready, progress };
}

export function pointerContextAllowed({ dialog = '', enabled = true, streaming = false } = {}) {
  return enabled !== false && streaming === true && (!dialog || dialog === 'info');
}

export class DwellFistGuard {
  constructor({ graceMs = 1600 } = {}) {
    this.graceMs = Number.isFinite(graceMs) && graceMs >= 0 ? graceMs : 1600;
    this.reset();
  }

  reset() {
    this.dwellAt = -Infinity;
    this.pending = false;
  }

  frame({ pose = null, progress = 0, at = 0 } = {}) {
    const now = Number.isFinite(at) ? at : 0;
    if (Number.isFinite(progress) && progress > 0) this.dwellAt = now;
    if (pose === 'fist') {
      if (now - this.dwellAt <= this.graceMs) this.pending = true;
    } else {
      this.pending = false;
    }
  }

  event({ type = '', dialog = '', at = 0 } = {}) {
    if (type !== 'fist') return false;
    const now = Number.isFinite(at) ? at : 0;
    const duringDwell = this.pending || now - this.dwellAt <= this.graceMs;
    if (!duringDwell) return false;
    this.reset();
    return dialog !== 'info';
  }
}

export class PointerController {
  constructor({ settings = {} } = {}) {
    this.settings = { ...DEFAULT_GESTURE_SETTINGS, ...settings };
    this.reset();
  }

  reset() {
    this.smoothed = null;
    this.lastActiveAt = -Infinity;
    this.lastAt = 0;
    this.targetKey = null;
    this.hoverStart = 0;
    this.cooldownUntil = 0;
  }

  update({ x, y, active = false, at = 0, target = null } = {}) {
    const now = Number.isFinite(at) ? at : this.lastAt;
    this.lastAt = now;

    if (!active) {
      if (this.smoothed === null || now - this.lastActiveAt > this.settings.pointerLostMs) {
        this.reset();
        return { visible: false, x: 0, y: 0, key: null, progress: 0, click: false };
      }
      return {
        visible: true,
        x: this.smoothed.x,
        y: this.smoothed.y,
        key: null,
        progress: 0,
        click: false,
      };
    }

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return {
        visible: this.smoothed !== null,
        x: this.smoothed ? this.smoothed.x : 0,
        y: this.smoothed ? this.smoothed.y : 0,
        key: null,
        progress: 0,
        click: false,
      };
    }

    const alpha = this.settings.pointerSmoothing;
    if (this.smoothed === null) {
      this.smoothed = { x, y };
    } else {
      this.smoothed = {
        x: this.smoothed.x + alpha * (x - this.smoothed.x),
        y: this.smoothed.y + alpha * (y - this.smoothed.y),
      };
    }
    this.lastActiveAt = now;

    const key = target && target.inside && target.key ? target.key : null;
    if (key === null || key !== this.targetKey) {
      this.targetKey = key;
      this.hoverStart = now;
    }

    const dwellMs = this.settings.pointerDwellMs;
    if (key !== null && now - this.hoverStart >= dwellMs && now >= this.cooldownUntil) {
      this.cooldownUntil = now + this.settings.pointerCooldownMs;
      this.hoverStart = now;
      return {
        visible: true, x: this.smoothed.x, y: this.smoothed.y, key, progress: 0, click: true,
      };
    }

    return {
      visible: true,
      x: this.smoothed.x,
      y: this.smoothed.y,
      key,
      progress: Math.min(1, (now - this.hoverStart) / dwellMs),
      click: false,
    };
  }
}
