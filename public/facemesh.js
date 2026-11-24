const VISION_PATH = '/mediapipe/vision_bundle.mjs';
const WASM_PATH = '/mediapipe/wasm';
const MODEL_PATH = '/models/face_landmarker.task';

function finitePoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

export function buildMeshSegments(landmarks, connections) {
  const points = Array.isArray(landmarks) ? landmarks : [];
  const edges = Array.isArray(connections) ? connections : [];
  const segments = [];
  for (const edge of edges) {
    const start = edge?.start;
    const end = edge?.end;
    if (!Number.isInteger(start) || !Number.isInteger(end)) continue;
    const a = points[start];
    const b = points[end];
    if (!finitePoint(a) || !finitePoint(b)) continue;
    segments.push({ a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } });
  }
  return segments;
}

export function buildMeshTriangles(connections) {
  const edges = Array.isArray(connections) ? connections : [];
  const adjacency = new Map();
  for (const edge of edges) {
    const start = edge?.start;
    const end = edge?.end;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start === end) continue;
    if (!adjacency.has(start)) adjacency.set(start, new Set());
    if (!adjacency.has(end)) adjacency.set(end, new Set());
    adjacency.get(start).add(end);
    adjacency.get(end).add(start);
  }
  const seen = new Set();
  const triangles = [];
  for (const [start, neighbors] of adjacency) {
    for (const end of neighbors) {
      if (end <= start) continue;
      const endNeighbors = adjacency.get(end);
      for (const third of neighbors) {
        if (!endNeighbors.has(third)) continue;
        const triangle = [start, end, third].sort((a, b) => a - b);
        const key = triangle.join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        triangles.push(triangle);
      }
    }
  }
  return triangles;
}

export function drawFaceMesh(context, faces, {
  connections,
  width,
  height,
  lineColor = '#59d2ff',
  lineAlpha = 0.55,
  fillAlpha = 0.08,
  lineWidth = 1,
} = {}) {
  if (!(width > 0) || !(height > 0)) return 0;
  const list = Array.isArray(faces) ? faces : [];
  const perFace = list.map((face) => buildMeshSegments(face?.landmarks, connections));
  const total = perFace.reduce((sum, segments) => sum + segments.length, 0);
  const triangles = buildMeshTriangles(connections);

  context.save();
  context.globalAlpha = lineAlpha;
  context.strokeStyle = lineColor;
  context.lineWidth = lineWidth;
  context.beginPath();
  for (const segments of perFace) {
    for (const { a, b } of segments) {
      context.moveTo(a.x * width, a.y * height);
      context.lineTo(b.x * width, b.y * height);
    }
  }
  context.stroke();

  if (triangles.length) {
    context.globalAlpha = fillAlpha;
    context.fillStyle = lineColor;
    context.beginPath();
    for (const face of list) {
      const landmarks = face?.landmarks;
      if (!Array.isArray(landmarks)) continue;
      for (const triangle of triangles) {
        const points = triangle.map((index) => landmarks[index]);
        if (!points.every(finitePoint)) continue;
        context.moveTo(points[0].x * width, points[0].y * height);
        context.lineTo(points[1].x * width, points[1].y * height);
        context.lineTo(points[2].x * width, points[2].y * height);
        context.closePath();
      }
    }
    context.fill();
  }
  context.restore();

  return total;
}

export class FaceMeshEngine {
  constructor(video, { onFrame = () => {}, onError = () => {}, intervalMs = 66 } = {}) {
    this.video = video;
    this.onFrame = typeof onFrame === 'function' ? onFrame : () => {};
    this.onError = typeof onError === 'function' ? onError : () => {};
    this.intervalMs = Number.isFinite(intervalMs) ? Math.max(0, intervalMs) : 66;
    this.faceLandmarker = null;
    this.connections = [];
    this.timer = null;
    this.lastTimestamp = -1;
    this._running = false;
    this._generation = 0;
  }

  get running() {
    return this._running;
  }

  async start() {
    if (this._running) return;
    const token = this._generation;
    let api;
    let landmarker;
    try {
      api = await import(VISION_PATH);
      const fileset = await api.FilesetResolver.forVisionTasks(WASM_PATH);
      landmarker = await api.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'CPU' },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      });
    } catch (error) {
      // stop() during the load makes the failed load irrelevant, not a degradation.
      if (token !== this._generation) return;
      throw error;
    }
    // stop() may have been called while the wasm runtime and model were loading.
    if (token !== this._generation) {
      try { landmarker.close?.(); } catch (error) { console.error('人脸网格模型关闭失败', error); }
      return;
    }
    this.faceLandmarker = landmarker;
    this.connections = api.FaceLandmarker.FACE_LANDMARKS_TESSELATION;
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
    const landmarker = this.faceLandmarker;
    this.faceLandmarker = null;
    if (landmarker) {
      try { landmarker.close?.(); } catch (error) { console.error('人脸网格模型关闭失败', error); }
    }
  }

  _schedule(delay) {
    if (!this._running) return;
    clearTimeout(this.timer);
    const wait = Number.isFinite(delay) ? delay : this.intervalMs;
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
      console.error('人脸网格检测循环失败', error);
      this.stop();
      try { this.onError(error); } catch (callbackError) { console.error('人脸网格停止回调失败', callbackError); }
      return;
    }
    this._schedule(this.intervalMs);
  }

  _detect() {
    const video = this.video;
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
    let at = performance.now();
    if (!(at > this.lastTimestamp)) at = this.lastTimestamp + 1;
    this.lastTimestamp = at;

    const detectStarted = performance.now();
    const result = this.faceLandmarker?.detectForVideo(video, at);
    const detectMs = Math.round(performance.now() - detectStarted);
    const landmarksList = Array.isArray(result?.faceLandmarks) ? result.faceLandmarks : [];
    const faces = landmarksList.map(landmarks => ({ landmarks }));
    this.onFrame({ faces, timings: { detectMs }, connections: this.connections });
  }
}
