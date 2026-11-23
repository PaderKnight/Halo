export const DEFAULT_GESTURE_SETTINGS = {
  minConfidence: 0.6,
  stableFrames: 4,
  holdMs: 600,
  thumbsUpHoldMs: 500,
  cooldownMs: 2000,
  intervalMs: 80,
  waveWindowMs: 1200,
  waveMinReversals: 2,
  palmMaxDrift: 0.12,
  waveSuppressMs: 500,
};

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const isPoint = p => p != null && Number.isFinite(p.x) && Number.isFinite(p.y);
const nullPose = () => ({
  pose: null,
  extended: [false, false, false, false, false],
  palmX: NaN,
  palmY: NaN,
  ruleScore: 0,
});

export function analyzeHand(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length !== 21) return nullPose();
  for (let i = 0; i < 21; i += 1) if (!isPoint(landmarks[i])) return nullPose();
  const p = landmarks;
  const palmSize = dist(p[0], p[9]);
  if (!(palmSize > 0)) return nullPose();

  const fingerTips = [[8, 6], [12, 10], [16, 14], [20, 18]];
  const fingers = fingerTips.map(([tip, pip]) => dist(p[tip], p[0]) > dist(p[pip], p[0]) * 1.12);
  const thumb = dist(p[4], p[0]) > dist(p[3], p[0]) * 1.35 && dist(p[4], p[9]) > palmSize * 0.55;
  const extended = [thumb, ...fingers];

  const palmPoints = [0, 5, 9, 13, 17];
  const palmX = palmPoints.reduce((sum, i) => sum + p[i].x, 0) / palmPoints.length;
  const palmY = palmPoints.reduce((sum, i) => sum + p[i].y, 0) / palmPoints.length;

  const extendedCount = fingers.filter(Boolean).length;
  const bentCount = fingers.length - extendedCount;
  let pose = null;
  let satisfied = 0;
  let required = 0;

  if (thumb && extendedCount === fingers.length) {
    pose = 'openPalm';
    satisfied = 5;
    required = 5;
  } else if (bentCount === fingers.length && thumb) {
    const upright = p[4].y < p[0].y - palmSize;
    const centered = Math.abs(p[4].x - p[0].x) < palmSize * 0.8;
    if (upright && centered) {
      pose = 'thumbsUp';
      satisfied = 6;
      required = 6;
    }
  }
  if (!pose && bentCount === fingers.length && !thumb) {
    pose = 'fist';
    satisfied = 5;
    required = 5;
  }

  return { pose, extended, palmX, palmY, ruleScore: pose ? satisfied / required : 0 };
}

export class GestureStateMachine {
  constructor(settings = {}) {
    this.settings = { ...DEFAULT_GESTURE_SETTINGS, ...settings };
    this.cooldownUntil = -Infinity;
    this.waveSuppressUntil = -Infinity;
    this.lastAt = 0;
    this._resetRun();
    this._resetWave();
  }

  updateSettings(partial = {}) {
    this.settings = { ...this.settings, ...partial };
  }

  push(frame = {}) {
    const f = frame && typeof frame === 'object' ? frame : {};
    const at = Number.isFinite(f.at) ? f.at : this.lastAt;
    this.lastAt = at;
    const pose = f.pose ?? null;
    const confidence = Number.isFinite(f.confidence) ? f.confidence : 0;
    const hand = f.hand ?? '';
    const palmX = Number.isFinite(f.palmX) ? f.palmX : NaN;
    const settings = this.settings;

    const waving = pose === 'openPalm' ? this._noteWave(at, palmX) : false;

    if (pose === null || confidence < settings.minConfidence) {
      this._resetRun();
      return [];
    }

    if (waving) {
      this._resetWave();
      this._resetRun();
      if (at < this.cooldownUntil) return [];
      this.cooldownUntil = at + settings.cooldownMs;
      this.waveSuppressUntil = at + settings.waveSuppressMs;
      return [{ type: 'wave', confidence, at, hand }];
    }

    if (pose !== 'openPalm' && pose !== 'fist' && pose !== 'thumbsUp') {
      this._resetRun();
      return [];
    }

    if (!this._trackRun(pose, at, palmX)) return [];
    const holdMs = pose === 'thumbsUp' ? settings.thumbsUpHoldMs : settings.holdMs;
    if (this.run.count < settings.stableFrames) return [];
    if (at - this.run.startAt < holdMs) return [];
    if (at < this.cooldownUntil) return [];
    if (pose === 'openPalm' && at < this.waveSuppressUntil) return [];

    const event = { type: pose, confidence, at, hand };
    this._resetRun();
    this.cooldownUntil = at + settings.cooldownMs;
    return [event];
  }

  _resetRun() {
    this.run = { pose: null, startAt: 0, count: 0, minPalmX: Infinity, maxPalmX: -Infinity };
  }

  _trackRun(pose, at, palmX) {
    const run = this.run;
    if (run.pose !== pose) {
      run.pose = pose;
      run.startAt = at;
      run.count = 0;
      run.minPalmX = Infinity;
      run.maxPalmX = -Infinity;
    }
    run.count += 1;
    if (Number.isFinite(palmX)) {
      run.minPalmX = Math.min(run.minPalmX, palmX);
      run.maxPalmX = Math.max(run.maxPalmX, palmX);
    }
    if (pose === 'openPalm' && Number.isFinite(run.minPalmX) && Number.isFinite(run.maxPalmX)
      && run.maxPalmX - run.minPalmX > this.settings.palmMaxDrift) {
      run.startAt = at;
      run.count = 1;
      run.minPalmX = Number.isFinite(palmX) ? palmX : Infinity;
      run.maxPalmX = Number.isFinite(palmX) ? palmX : -Infinity;
      return false;
    }
    return true;
  }

  _resetWave() {
    this.wave = { points: [], lastTurnX: null, dir: 0, reversals: 0 };
  }

  _noteWave(at, palmX) {
    const wave = this.wave;
    wave.points.push({ at, palmX });
    const cutoff = at - this.settings.waveWindowMs;
    while (wave.points.length && wave.points[0].at < cutoff) wave.points.shift();

    if (!Number.isFinite(palmX)) return false;
    if (wave.points.length <= 1 || wave.lastTurnX === null) {
      wave.lastTurnX = palmX;
      wave.dir = 0;
      wave.reversals = 0;
      return false;
    }
    if (Math.abs(palmX - wave.lastTurnX) >= 0.02) {
      const dir = palmX > wave.lastTurnX ? 1 : -1;
      if (wave.dir !== 0 && dir !== wave.dir) wave.reversals += 1;
      wave.dir = dir;
      wave.lastTurnX = palmX;
    }
    return wave.reversals >= this.settings.waveMinReversals;
  }
}

export function resolveGestureAction(event, context = {}) {
  const ctx = context && typeof context === 'object' ? context : {};
  if (ctx.enabled === false) return null;
  const cameraConfirm = ctx.dialog === 'confirm' && ctx.candidateVia === 'camera';
  switch (event?.type) {
    case 'openPalm':
      return cameraConfirm ? 'confirm' : null;
    case 'fist':
      if (cameraConfirm) return 'cancel';
      return ctx.personalVia ? 'home' : null;
    case 'wave':
      if (ctx.personalVia) return 'home';
      return ctx.faceActive === false ? 'resumeFace' : null;
    case 'thumbsUp':
      return 'greet';
    default:
      return null;
  }
}
