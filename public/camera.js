import { distance, identify, rank } from './match.js';

const storeKey = 'morning.wall.face-templates.v1';
function samples() {
  try {
    const bank = JSON.parse(localStorage.getItem(storeKey) || '{}');
    return bank && typeof bank === 'object' && !Array.isArray(bank) ? bank : {};
  } catch { return {}; }
}
export const enrolled = id => !!samples()[id]?.length;
export function forget(id) { const bank = samples(); delete bank[id]; localStorage.setItem(storeKey,JSON.stringify(bank)); }
export function remember(id, values) {
  const bank = samples();
  const others = Object.fromEntries(Object.entries(bank).filter(([key]) => key !== id));
  if (values.some(v => identify(v,others))) throw Error('这张脸已绑定其他成员。请检查所选成员。');
  bank[id] = values;
  localStorage.setItem(storeKey,JSON.stringify(bank));
}

export const DEFAULT_FACE_TUNING = { inputSize:320, detectScore:0.55, matchThreshold:0.48, margin:0.07 };
export function loadFaceTuning() {
  let stored = {};
  try {
    const raw = localStorage.getItem('morning.face.tuning');
    const parsed = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) stored = parsed;
  } catch { stored = {}; }
  const tuning = {};
  for (const [key, fallback] of Object.entries(DEFAULT_FACE_TUNING)) {
    tuning[key] = Number.isFinite(stored[key]) ? stored[key] : fallback;
  }
  return tuning;
}
function cameraDevice() {
  try { return localStorage.getItem('morning.camera.device') || ''; } catch { return ''; }
}
function cameraSize() {
  let raw = '1280x720';
  try { raw = localStorage.getItem('morning.camera.size') || raw; } catch {}
  const match = /^(\d{2,5})x(\d{2,5})$/.exec(raw);
  return match ? { width:Number(match[1]), height:Number(match[2]) } : { width:1280, height:720 };
}

let models;
async function loadModels() {
  const api = await import('/face-api.js');
  await Promise.all([api.nets.tinyFaceDetector,api.nets.faceLandmark68TinyNet,api.nets.faceRecognitionNet].map(n => n.loadFromUri('/models')));
  return api;
}

export class Camera {
  constructor(video, onFrame, onError, tuning = loadFaceTuning()) {
    this.video = video;
    this.onFrame = onFrame;
    this.onError = onError;
    this.tuning = { ...DEFAULT_FACE_TUNING, ...(tuning && typeof tuning === 'object' ? tuning : {}) };
    this.generation = 0;
    this.faceGeneration = 0;
    this.stream = null;
    this.faceRunning = false;
    this.faceTimer = null;
    this.debug = false;
  }
  get streaming() { return !!this.stream; }
  get faceActive() { return this.faceRunning; }
  get active() { return this.streaming; }
  setDebug(on) { this.debug = !!on; }
  setTuning(partial) {
    if (partial && typeof partial === 'object') this.tuning = { ...this.tuning, ...partial };
  }
  async openStream() {
    if (this.streaming) return;
    const token = this.generation;
    if (!navigator.mediaDevices?.getUserMedia) throw Error('浏览器未提供摄像头接口，请用本机地址打开。');
    const device = cameraDevice();
    const { width, height } = cameraSize();
    const sized = { width:{ ideal:width }, height:{ ideal:height } };
    const attempts = device ? [{ ...sized, deviceId:{ exact:device } }, sized, { facingMode:'user' }] : [sized, { facingMode:'user' }];
    let stream = null, lastError;
    try {
      for (const video of attempts) {
        try { stream = await navigator.mediaDevices.getUserMedia({ video, audio:false }); break; }
        catch (err) {
          lastError = err;
          if (token !== this.generation) return;
          if (err?.name !== 'OverconstrainedError') throw err;
        }
      }
      if (!stream) throw lastError || Error('摄像头启动失败。');
      if (token !== this.generation) { stream.getTracks().forEach(t => t.stop()); return; }
      this.video.srcObject = stream;
      await this.video.play();
      if (token !== this.generation) { stream.getTracks().forEach(t => t.stop()); this.video.srcObject = null; return; }
      this.stream = stream;
      const track = stream.getVideoTracks()[0];
      if (track) track.onended = () => { if (this.stream === stream) this.fail('摄像头已断开。'); };
    } catch (e) {
      if (this.stream === stream) this.stream = null;
      if (this.video.srcObject === stream) this.video.srcObject = null;
      stream?.getTracks().forEach(t => { t.onended = null; t.stop(); });
      if (token !== this.generation) return;
      const messages = { NotAllowedError:'摄像头权限未授予，可在浏览器地址栏调整权限。', NotFoundError:'未找到摄像头，请连接 USB 摄像头。', NotReadableError:'摄像头暂时无法读取，可能正被其他应用使用。' };
      throw Error(messages[e?.name] || e?.message || '摄像头启动失败。');
    }
  }
  async openCamera() {
    await this.openStream();
    if (!this.streaming) return;
    await this.startFace();
  }
  async startFace() {
    if (this.faceRunning) return;
    if (!this.streaming) throw Error('摄像头未开启。');
    const streamToken = this.generation;
    const token = ++this.faceGeneration;
    let api;
    try {
      models ||= loadModels().catch(e => { models = null; throw e; });
      api = await models;
    } catch (e) {
      if (token === this.faceGeneration) this.faceRunning = false;
      throw e;
    }
    if (token !== this.faceGeneration || streamToken !== this.generation || !this.streaming) return;
    this.faceRunning = true;
    const scan = async () => {
      if (token !== this.faceGeneration || streamToken !== this.generation) return;
      const started = performance.now();
      try {
        const options = new api.TinyFaceDetectorOptions({ inputSize:this.tuning.inputSize, scoreThreshold:this.tuning.detectScore });
        const found = await api.detectAllFaces(this.video,options).withFaceLandmarks(true).withFaceDescriptors();
        if (token !== this.faceGeneration || streamToken !== this.generation) return;
        const bank = samples();
        const face = found.length === 1 ? Array.from(found[0].descriptor) : null;
        this.onFrame({
          count: found.length,
          face,
          match: face ? identify(face,bank,{ threshold:this.tuning.matchThreshold, margin:this.tuning.margin }) : null,
          scores: face ? rank(face,bank) : [],
          threshold: this.tuning.matchThreshold,
          margin: this.tuning.margin,
          detections: found.map(item => ({
            box: { x:item.detection.box.x, y:item.detection.box.y, width:item.detection.box.width, height:item.detection.box.height },
            landmarks: (item.landmarks?.positions || []).map(point => ({ x:point.x, y:point.y })),
          })),
          timings: { detectMs: Math.round(performance.now() - started) },
        });
        this.faceTimer = setTimeout(scan,450);
      } catch { if (token === this.faceGeneration && streamToken === this.generation) this.fail('识别中断，请重新开启摄像头。'); }
    };
    void scan();
  }
  pauseFace() {
    this.faceGeneration++;
    clearTimeout(this.faceTimer);
    this.faceTimer = null;
    this.faceRunning = false;
  }
  async resumeFace() { await this.startFace(); }
  stop() {
    this.generation++;
    this.faceGeneration++;
    clearTimeout(this.faceTimer);
    this.faceTimer = null;
    this.faceRunning = false;
    const stream = this.stream;
    this.stream = null;
    stream?.getTracks().forEach(t => { t.onended = null; t.stop(); });
    this.video.srcObject = null;
  }
  fail(message) { this.stop(); this.onError(message); }
}
export function templateSamples(id) {
  return samples()[id] || [];
}
export async function analyzeImage(source, tuning = loadFaceTuning()) {
  models ||= loadModels().catch(e => { models = null; throw e; });
  const api = await models;
  const options = new api.TinyFaceDetectorOptions({ inputSize: tuning.inputSize, scoreThreshold: tuning.detectScore });
  const found = await api.detectAllFaces(source, options).withFaceLandmarks(true).withFaceDescriptors();
  return found.map(item => ({ descriptor: Array.from(item.descriptor) }));
}
export const SAMPLE_MAX_DISTANCE = 0.48;
export function addSample(list,face) {
  if (!face || (list.length && list.some(other => distance(other,face)>SAMPLE_MAX_DISTANCE))) return [];
  return [...list,face];
}
