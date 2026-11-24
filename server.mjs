import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createModules } from './modules.mjs';
import { catalog, publicRepos, defaultProfile, validateProfile, editionDay, due, makeBrief, refreshEntry } from './brief.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4317);
const dbDir = process.env.BRIEF_DATA || path.join(root, '.local');
fs.mkdirSync(dbDir, { recursive: true });
const dbPath = path.join(dbDir,'wall.json');
const starter = JSON.parse(fs.readFileSync(path.join(root,'starter-feeds.json'),'utf8'));
const state = fs.existsSync(dbPath) ? JSON.parse(fs.readFileSync(dbPath,'utf8')) :
  { profiles: [defaultProfile], feeds: starter, briefs: {}, lastRunAt: Object.values(starter).map(s=>s.checkedAt).sort().at(-1) };
const modules=createModules(dbDir,{offline:process.env.BRIEF_OFFLINE==='1'});
let running = false, pending = false;
function attachEditionNote(repo, entry) {
  const sample = starter[repo]?.item;
  if (sample?.headline && sample.url === entry.item?.url && sample.detail === entry.item.detail) {
    Object.assign(entry.item, { headline:sample.headline, detailZh:sample.detailZh });
  }
}
for (const [repo,entry] of Object.entries(state.feeds)) {
  if (!entry.history && starter[repo]?.history && entry.item?.url === starter[repo].item?.url) {
    entry.history = starter[repo].history;
  }
  attachEditionNote(repo,entry);
}
prepare(new Date());
function save() {
  fs.writeFileSync(dbPath + '.tmp', JSON.stringify(state), { mode: 0o600 });
  fs.renameSync(dbPath + '.tmp', dbPath);
}
function prepare(now) {
  const day = editionDay(now);
  state.briefs = Object.fromEntries(state.profiles.map(p => [p.id, makeBrief(p, state.feeds, day)]));
}
async function refresh(force = false) {
  if (running) { pending = true; return; }
  running = true;
  try {
    do {
      pending = false;
      const now = new Date();
      const all = new Set([...catalog.map(s => s.repo), ...state.profiles.flatMap(p => p.repos)]);
      const repos = [...all].filter(r => force || due(state.feeds[r],now.getTime()) ||
        (!Array.isArray(state.feeds[r]?.history) && !state.feeds[r]?.error));
      force = false;
      for (let i = 0; i < repos.length; i += 3) {
        await Promise.all(repos.slice(i,i+3).map(async r => {
          state.feeds[r] = await refreshEntry(r, state.feeds[r], now);
          attachEditionNote(r,state.feeds[r]);
        }));
      }
      if (repos.length) state.lastRunAt = now.toISOString();
      if (repos.length || state.profiles.some(p => state.briefs[p.id]?.day !== editionDay(now))) {
        prepare(now);
        save();
      }
    } while (pending);
  } catch (err) { console.error('简报整理失败', err.message); }
  finally { running = false; }
}
function wall() {
  return { profiles: state.profiles.map(({ id, name }) => ({ id, name })), catalog, running,
    lastRunAt: state.lastRunAt, schedule: '07:00', zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    publicBrief: makeBrief({ id:'public', repos:publicRepos },state.feeds,editionDay(new Date())).items };
}
function send(res, status, body) {
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' });
  res.end(JSON.stringify(body));
}
async function input(req) {
  const parts = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 600000) throw Error('输入内容过长。');
    parts.push(chunk);
  }
  return JSON.parse(Buffer.concat(parts).toString('utf8') || '{}');
}
const staticFiles = new Map(Object.entries({
  '/':'public/index.html', '/wall.css':'public/wall.css', '/app.js':'public/app.js', '/board.js':'public/board.js',
  '/scene.css':'public/scene.css', '/motion.js':'public/motion.js',
  '/camera.js':'public/camera.js','/match.js':'public/match.js',
  '/face-api.js':'node_modules/@vladmandic/face-api/dist/face-api.esm.js'
}));
for (const net of ['tiny_face_detector_model','face_landmark_68_tiny_model','face_recognition_model']) {
  for (const ext of ['.bin','-weights_manifest.json']) staticFiles.set('/models/'+net+ext,'node_modules/@vladmandic/face-api/model/'+net+ext);
}
function registerPublic(folder) {
  for(const entry of fs.readdirSync(folder,{withFileTypes:true})){const file=path.join(folder,entry.name);if(entry.isDirectory())registerPublic(file);else if(/\.(js|css|html|json|webp|livliv|md)$/.test(file))staticFiles.set('/'+path.relative(path.join(root,'public'),file).split(path.sep).join('/'),path.relative(root,file));}
}
registerPublic(path.join(root,'public'));
const mpPkg = path.join(root, 'node_modules/@mediapipe/tasks-vision');
if (fs.existsSync(mpPkg)) {
  staticFiles.set('/mediapipe/vision_bundle.mjs', path.relative(root, path.join(mpPkg, 'vision_bundle.mjs')));
  for (const name of fs.readdirSync(path.join(mpPkg, 'wasm')))
    staticFiles.set('/mediapipe/wasm/' + name, path.relative(root, path.join(mpPkg, 'wasm', name)));
}
staticFiles.set('/models/hand_landmarker.task', 'public/models/hand_landmarker.task');
staticFiles.set('/models/face_landmarker.task', 'public/models/face_landmarker.task');
const types = { '.webp':'image/webp','.livliv':'application/octet-stream','.md':'text/plain; charset=utf-8', '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
  '.jpg':'image/jpeg','.png':'image/png','.bin':'application/octet-stream','.json':'application/json',
  '.mjs':'text/javascript; charset=utf-8','.wasm':'application/wasm','.task':'application/octet-stream' };
let lastManual = 0;
const server = http.createServer(async (req,res) => {
  try {
    const host = req.headers.host;
    if (!['127.0.0.1:'+port,'localhost:'+port].includes(host) ||
        (req.headers.origin && req.headers.origin !== 'http://'+host)) return send(res,403,{ error:'请在本机打开简报台。' });
    const url = new URL(req.url, 'http://'+host);
    const route = url.pathname;
    if (req.method === 'GET' && staticFiles.has(route)) {
      const file = path.join(root,staticFiles.get(route));
      if (!fs.existsSync(file)) return send(res,404,{error:'缺少本地文件，请运行 npm ci。'});
      res.writeHead(200, {'Content-Type':types[path.extname(file)],'Content-Length':fs.statSync(file).size,
        'X-Content-Type-Options':'nosniff', 'Cache-Control':route.startsWith('/models/') || route.startsWith('/mediapipe/') || route === '/face-api.js' ? 'max-age=86400' : 'no-cache' });
      fs.createReadStream(file).on('error',()=>res.destroy()).pipe(res);
      return;
    }
    if(route==='/api/dashboard' && req.method==='GET') {
      const scope=url.searchParams.get('scope')||'public';
      const profile=state.profiles.find(p=>p.id===scope);
      if(scope!=='public'&&!profile)return send(res,404,{error:'成员不存在。'});
      return send(res,200,modules.get(scope,profile?.repos));
    }
    if(route.startsWith('/api/modules/') && req.method==='POST'){
      if(req.headers['content-type']?.split(';')[0]!=='application/json')return send(res,415,{error:'需要 JSON 请求。'});
      const data=await input(req),scope=data.scope||'public';
      if(scope!=='public'&&!state.profiles.some(p=>p.id===scope))return send(res,404,{error:'成员不存在。'});
      modules.get(scope,state.profiles.find(p=>p.id===scope)?.repos);
      if(route==='/api/modules/save')modules.update(scope,data.module);
      else if(route==='/api/modules/character')modules.character(scope,data.character);
      else if(route==='/api/modules/event')data.action==='delete'?modules.removeEvent(scope,data.id):modules.addEvent(scope,data.event);
      else if(route==='/api/modules/import')return send(res,200,{count:modules.importCalendar(scope,data.ics)});
      else return send(res,404,{error:'未找到此操作。'});
      return send(res,200,{ok:true});
    }
    if (req.method === 'GET' && route === '/api/wall') return send(res,200,wall());
    if (req.method === 'GET' && route === '/api/brief') {
      const id = url.searchParams.get('id');
      const profile = state.profiles.find(p => p.id === id);
      return profile ? send(res,200,{profile, brief:state.briefs[id] || makeBrief(profile,state.feeds,editionDay(new Date()))}) :
        send(res,404,{error:'成员不存在。'});
    }
    if (req.method === 'POST' && req.headers['content-type']?.split(';')[0] !== 'application/json')
      return send(res,415,{error:'需要 JSON 请求。'});
    if (req.method === 'POST' && route === '/api/profiles') {
      const data = await input(req);
      const value = validateProfile(data);
      if (state.profiles.some(p => p.id !== data.id && p.name === value.name)) throw Error('这个名字已在使用。');
      if (data.id && !state.profiles.some(p => p.id === data.id)) throw Error('成员不存在。');
      const profile = { id: data.id || randomUUID(), ...value };
      const idx = state.profiles.findIndex(p => p.id === profile.id);
      if (idx === -1) state.profiles.push(profile);
      else state.profiles[idx] = profile;
      prepare(new Date());
      save();
      void refresh();
      return send(res,200,profile);
    }
    if (req.method === 'POST' && route === '/api/refresh') {
      if (!running && Date.now()-lastManual > 60000) { lastManual = Date.now(); void refresh(true); void modules.refresh(true); }
      return send(res,200,wall());
    }
    return send(res,404,{error:'未找到此页面。'});
  } catch(err) {
    return send(res,400,{error:err instanceof SyntaxError ? '输入的 JSON 无效。' : err.message});
  }
});
server.listen(port,'127.0.0.1',() => {
  console.log('晨报台 http://127.0.0.1:'+port);
  void refresh();
  modules.get('public');
  setInterval(()=>void modules.refresh(),60000).unref();
  setInterval(() => void refresh(),60000).unref();
});

