import { distance, identify } from './match.js';

const storeKey = 'morning.wall.face-templates.v1';
function samples() { return JSON.parse(localStorage.getItem(storeKey) || '{}'); }
export const enrolled = id => !!samples()[id]?.length;
export function forget(id) { const bank = samples(); delete bank[id]; localStorage.setItem(storeKey,JSON.stringify(bank)); }
export function remember(id, values) {
  const bank = samples();
  const others = Object.fromEntries(Object.entries(bank).filter(([key]) => key !== id));
  if (values.some(v => identify(v,others))) throw Error('这张脸已绑定其他成员。请检查所选成员。');
  bank[id] = values;
  localStorage.setItem(storeKey,JSON.stringify(bank));
}
let models;
async function loadModels() {
  const api = await import('/face-api.js');
  await Promise.all([api.nets.tinyFaceDetector,api.nets.faceLandmark68TinyNet,api.nets.faceRecognitionNet].map(n => n.loadFromUri('/models')));
  return api;
}
export class Camera {
  constructor(video, onFrame, onError) {
    this.video = video;
    this.onFrame = onFrame;
    this.onError = onError;
    this.generation = 0;
  }
  async start() {
    if (this.active) return;
    this.stop();
    const token = this.generation;
    let stream;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Error('浏览器未提供摄像头接口，请用本机地址打开。');
      stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:640},height:{ideal:480}},audio:false});
      if (this.generation !== token) { stream.getTracks().forEach(t => t.stop()); return; }
      this.stream = stream;
      this.video.srcObject = stream;
      await this.video.play();
      models ||= loadModels().catch(e => { models = null; throw e; });
      const api = await models;
      if (this.generation !== token) return;
      this.active = true;
      stream.getVideoTracks()[0].onended = () => { if (token === this.generation) this.fail('摄像头已断开。'); };
      const options = new api.TinyFaceDetectorOptions({inputSize:320,scoreThreshold:0.55});
      const scan = async () => {
        if (token !== this.generation) return;
        try {
          const found = await api.detectAllFaces(this.video,options).withFaceLandmarks(true).withFaceDescriptors();
          if (token !== this.generation) return;
          const face = found.length === 1 ? Array.from(found[0].descriptor) : null;
          this.onFrame({ count:found.length, face, match:face ? identify(face,samples()) : null });
          this.timer = setTimeout(scan,450);
        } catch { if (token === this.generation) this.fail('识别中断，请重新开启摄像头。'); }
      };
      void scan();
    } catch(e) {
      if (token !== this.generation) return;
      this.stop();
      const messages = {NotAllowedError:'摄像头权限未授予，可在浏览器地址栏调整权限。', NotFoundError:'未找到摄像头，请连接 USB 摄像头。', NotReadableError:'摄像头暂时无法读取，可能正被其他应用使用。'};
      throw Error(messages[e.name] || e.message || '摄像头启动失败。');
    }
  }
  fail(message) { this.stop(); this.onError(message); }
  stop() {
    this.generation++;
    clearTimeout(this.timer);
    this.stream?.getTracks().forEach(t => { t.onended = null; t.stop(); });
    this.stream = null;
    this.video.srcObject = null;
    this.active = false;
  }
}
export function addSample(list,face) {
  if (!face || (list.length && list.some(other => distance(other,face)>0.48))) return [];
  return [...list,face];
}

