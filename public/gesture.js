import {
  analyzeHand, GestureStateMachine, PointStability, DEFAULT_GESTURE_SETTINGS, mirrorX,
} from './gesture-rules.js';

const VISION_PATH = '/mediapipe/vision_bundle.mjs';
const WASM_PATH = '/mediapipe/wasm';
const MODEL_PATH = '/models/hand_landmarker.task';

export class GestureEngine {
  constructor(video, { onFrame = () => {}, onEvent = () => {}, onStop = () => {}, settings = {} } = {}) {
    this.video = video;
    this.onFrame = typeof onFrame === 'function' ? onFrame : () => {};
    this.onEvent = typeof onEvent === 'function' ? onEvent : () => {};
    this.onStop = typeof onStop === 'function' ? onStop : () => {};
    this.settings = {
      ...DEFAULT_GESTURE_SETTINGS,
      ...(settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {}),
    };
    this.mirror = this.settings.mirror !== false;
    this.machine = new GestureStateMachine(this.settings);
    this.pointStability = new PointStability({
      stableFrames: this.settings.pointStableFrames,
      minConfidence: this.settings.minConfidence,
    });
    this.handLandmarker = null;
    this.timer = null;
    this.lastTimestamp = -1;
    this._running = false;
    this._generation = 0;
  }

  get running() {
    return this._running;
  }

  updateSettings(partial) {
    if (!partial || typeof partial !== 'object' || Array.isArray(partial)) return;
    this.settings = { ...this.settings, ...partial };
    this.mirror = this.settings.mirror !== false;
    this.machine.updateSettings(partial);
    this.pointStability.updateSettings(partial);
  }

  async start() {
    if (this._running) return;
    const token = this._generation;
    const api = await import(VISION_PATH);
    const fileset = await api.FilesetResolver.forVisionTasks(WASM_PATH);
    const landmarker = await api.HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'CPU' },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    // stop() may have been called while the wasm runtime and model were loading.
    if (token !== this._generation) {
      try { landmarker.close?.(); } catch (error) { console.error('手势模型关闭失败', error); }
      return;
    }
    this.handLandmarker = landmarker;
    this._running = true;
    this.lastTimestamp = -1;
    this._schedule(0);
  }

  stop() {
    this._generation += 1;
    this._running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const landmarker = this.handLandmarker;
    this.handLandmarker = null;
    if (landmarker) {
      try { landmarker.close?.(); } catch (error) { console.error('手势模型关闭失败', error); }
    }
  }

  _schedule(delay) {
    if (!this._running) return;
    clearTimeout(this.timer);
    const wait = Number.isFinite(delay) ? delay : this.settings.intervalMs;
    this.timer = setTimeout(() => {
      this.timer = null;
      this._tick();
    }, Math.max(0, wait));
  }

  _tick() {
    if (!this._running) return;
    try {
      this._detect();
    } catch (error) {
      // A broken frame must never escape as an uncaught exception.
      console.error('手势检测循环失败', error);
      this.stop();
      try { this.onStop(error); } catch (stopError) { console.error('手势停止回调失败', stopError); }
      return;
    }
    this._schedule(this.settings.intervalMs);
  }

  _detect() {
    const video = this.video;
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
    let at = performance.now();
    if (!(at > this.lastTimestamp)) at = this.lastTimestamp + 1;
    this.lastTimestamp = at;

    const detectStarted = performance.now();
    const result = this.handLandmarker?.detectForVideo(video, at);
    const detectMs = Math.round(performance.now() - detectStarted);
    const landmarksList = Array.isArray(result?.landmarks) ? result.landmarks : [];
    const handednessList = Array.isArray(result?.handedness) ? result.handedness : [];
    const hands = [];
    let driver = null;
    for (let index = 0; index < landmarksList.length; index += 1) {
      const landmarks = landmarksList[index];
      const category = handednessList[index]?.[0];
      const handedness = typeof category?.categoryName === 'string' ? category.categoryName : '';
      const score = Number.isFinite(category?.score) ? category.score : 0;
      const analysis = analyzeHand(landmarks);
      hands.push({ landmarks, handedness, score });
      if (!driver || score > driver.score) driver = { handedness, score, analysis };
    }

    const analysis = driver?.analysis;
    const pose = analysis?.pose ?? null;
    const confidence = driver ? analysis.ruleScore * driver.score : 0;
    const palmX = Number.isFinite(analysis?.palmX) ? analysis.palmX : NaN;
    const palmY = Number.isFinite(analysis?.palmY) ? analysis.palmY : NaN;
    const swipeX = Number.isFinite(palmX) ? mirrorX(palmX, this.mirror) : NaN;
    const pointerActive = this.pointStability.update({ pose, confidence });
    const events = this.machine.push({
      pose,
      confidence,
      palmX,
      palmY,
      swipeX,
      hand: driver?.handedness ?? '',
      at,
    });

    this.onFrame({
      hands,
      pose,
      confidence,
      at,
      timings: { detectMs },
      progress: this.machine.progress,
      pointer: {
        x: analysis?.tipX ?? NaN,
        y: analysis?.tipY ?? NaN,
        active: pointerActive,
      },
    });
    for (const event of events) this.onEvent(event);
  }
}
