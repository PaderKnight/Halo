import { esc, collectReleases, weekCounts, focusCard, chartCard, topicPanels, timelineCard, timelineRows, recordsOnDay, insightPanels } from './board.js';
import { Camera, enrolled, forget, remember, addSample } from './camera.js';
import { coverMotion, showBoard } from './motion.js';
import { createDashboard } from './dashboard.js';

const $ = id => document.getElementById(id);
const fmt = (v, options) => new Intl.DateTimeFormat('zh-CN', options).format(new Date(v));
const stamp = v => fmt(v,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});
const video = $('video'), modal = $('modal');
let wall, personal = null, dialog = '', candidate = null, editing = null, enrollment = null;
let profileSequence = 0, sessionSequence = 0, wallSequence = 0, lastAction = Date.now(), lastSeen = 0;
let consecutive = 0, lastMatch = null, ignored = null, absentSince = 0;
let starting = false, noticeTimer, cameraMessage = '', lastRender = '';
const camera = new Camera(video, onFrame, error => {
  localStorage.removeItem('morning.camera');
  starting = false;
  cameraMessage = error;
  if (enrollment) { enrollment.collect = false; $('slot').dataset.capturing='false'; message(error); }
  if (personal?.via === 'camera' || candidate?.via === 'camera') home();
  render();
  notify(error);
});
const gestureEnabled = () => localStorage.getItem('morning.gesture.enabled') !== 'off';
async function api(url, body) {
  const options = body === undefined ? {} : {method:'POST', headers:{'Content-Type':'application/json'},body:JSON.stringify(body)};
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw Error(data.error || '请求失败。');
  return data;
}
function notify(text) {
  $('notice').textContent=text; clearTimeout(noticeTimer);
  noticeTimer=setTimeout(()=>$('notice').textContent='',5800);
}
function message(text) { if ($('msg')) $('msg').textContent=text; }
function setDialog(type, html) {
  dialog = type;
  modal.dataset.kind=type;
  coverMotion(true);
  $('dialog-body').innerHTML=html;
  modal.setAttribute('aria-labelledby','dialog-title');
  if (!modal.open) modal.showModal();
  else $('dialog-title')?.focus();
}
function closeDialog() {
  if (candidate?.via === 'camera') ignored = candidate.id;
  if (enrollment) {
    $('camera-stage').append(video);
    if (!enrollment.previouslyOn && !localStorage.getItem('morning.camera')) camera.stop();
  }
  enrollment=null; candidate=null; editing=null; dialog=''; profileSequence++;
  if (modal.open) modal.close();
  coverMotion(false);
  consecutive=0; lastMatch=null;
}
$('close').onclick=closeDialog;
modal.addEventListener('cancel',e=>{e.preventDefault(); closeDialog();render();});
modal.addEventListener('click',e=>{if(e.target===modal){closeDialog();render();}});
function home() {
  if (personal?.via === 'camera') ignored=personal.profile.id;
  sessionSequence++; personal=null; closeDialog(); render();
}
function openRecords(records, title) {
  setDialog('records','<h2 id="dialog-title">'+esc(title)+'</h2>'+
    (records.length ? '<ol class="timeline record-list">'+timelineRows(records)+'</ol>' : '<p>这一天没有收录发布。</p>'));
}
function updateClock() {
  $('clock').textContent=fmt(Date.now(),{hour:'2-digit',minute:'2-digit',hour12:false});
}
updateClock();
setInterval(updateClock,10000);
function cameraStatus() {
  if (starting) return '正在启动摄像头';
  if (!camera.streaming) return cameraMessage || '摄像头未开启';
  if (camera.faceActive) return gestureEnabled() ? '摄像头已开启 · 手势运行中' : '摄像头已开启';
  return gestureEnabled() ? '人脸识别已暂停 · 手势运行中' : '摄像头已开启';
}
function cameraButtonLabel() {
  if (camera.faceActive) return gestureEnabled() ? '暂停人脸识别' : '关闭摄像头';
  return camera.streaming ? '开始人脸识别' : '开启摄像头识别';
}
const dashboard=createDashboard({api,setDialog,closeDialog,notify});
function render() {
  if (!wall) return;
  dashboard.update(personal?.profile.id||'public',wall,personal);
  const signature=JSON.stringify([wall.running,wall.lastRunAt,wall.publicBrief,wall.profiles,personal,cameraStatus(),camera.streaming,camera.faceActive,starting,new Date().toDateString()]);
  if(signature===lastRender) return;
  lastRender=signature;
  const brief=personal?.brief;
  $('day').textContent=fmt(Date.now(),{month:'long',day:'numeric',weekday:'long'});
  $('robot-text').textContent=wall.running?'正在整理':wall.publicBrief.some(s=>s.error)?'部分来源待重试':'机器人待命';
  document.title=personal ? personal.profile.name+'的简报 · Halo' : 'Halo · 团队简报';
  $('sync-time').textContent='天气每30分钟 · 新闻每15分钟 · 日程本地保存';
  $('sync').disabled=wall.running;
  document.documentElement.dataset.sync=wall.running?'busy':'idle';
  document.documentElement.dataset.camera=camera.streaming?'on':'off';
  if (personal) {
    const d=brief.discovery;
    $('side').classList.add('personal-side');
    $('side').innerHTML=`<div class="panel-head"><h2>今日发现</h2><span>订阅之外</span></div>${d?`<h3><a href="${esc(d.item.url)}" target="_blank" rel="noopener noreferrer">${esc(d.label)} ↗</a></h3><p>${esc(d.item.detailZh || d.note)}</p><div class="side-meta">${esc(d.group)} · ${esc(d.item.tag)}${d.error?' · 缓存':''}</div>`:'<p>暂时没有订阅之外的发布。</p>'}<button class="secondary" id="back">返回团队晨报</button>`;
    $('back').onclick=home;
  } else {
    const demoOnly=wall.profiles.length===1 && wall.profiles[0].id==='demo';
    $('side').classList.remove('personal-side');
    $('side').innerHTML=`<div class="panel-head"><h2>我的简报</h2></div><p>确认身份后，查看你的天气、日程和关注内容。</p><button class="primary" id="manual">${demoOnly?'体验示例简报':'选择成员简报'}</button><div class="camera-control"><span class="statusline"><i class="indicator ${camera.streaming?'':'off'}"></i>${esc(cameraStatus())}</span><button class="textbtn" id="cam" ${starting?'disabled':''}>${cameraButtonLabel()}</button></div>`;
    $('manual').onclick=()=>demoOnly ? confirmPerson(wall.profiles[0],'manual') : choose();
    $('cam').onclick=async()=>{
      if (camera.faceActive) {
        if (gestureEnabled()) { camera.pauseFace(); render(); }
        else { camera.stop(); localStorage.removeItem('morning.camera'); cameraMessage=''; render(); }
        return;
      }
      try { await startCamera(); if (camera.faceActive) { localStorage.setItem('morning.camera','on'); if (!wall.profiles.some(p=>enrolled(p.id))) notify('摄像头已开启。请在「成员与订阅」中录入本人。'); } }
      catch(e){notify(e.message);} render();
    };
  }
  showBoard(personal?.profile.id || 'public','',wall.running);
}
async function loadWall() {
  const seq=++wallSequence;
  const next=await api('/api/wall');
  if (seq!==wallSequence) return;
  wall=next;
  const current=personal;
  if (current) {
    const fresh=await api('/api/brief?id='+encodeURIComponent(current.profile.id));
    if (seq!==wallSequence) return;
    if (current===personal) Object.assign(current,fresh);
  }
  render();
}
function choose() {
  setDialog('choose','<h2 id="dialog-title">选择成员</h2>'+wall.profiles.map(p=>`<button class="person-button" data-member="${esc(p.id)}">${esc(p.name)}　→</button>`).join(''));
  $('dialog-body').querySelectorAll('[data-member]').forEach(b=>b.onclick=()=>confirmPerson(wall.profiles.find(p=>p.id===b.dataset.member),'manual'));
}
function confirmPerson(profile,via) {
  candidate={ id:profile.id,via };
  if(via==='camera') lastSeen=Date.now();
  setDialog('confirm',`<h2 id="dialog-title">是${esc(profile.name)}吗？</h2><p>${via==='camera'?'摄像头匹配到这位成员。':'你手动选择了这位成员。'}确认后，个人简报将显示在公共大屏上。</p><div class="dialog-actions"><button id="no" class="secondary">取消</button><button id="yes" class="primary">是我，打开简报</button></div><div id="msg" role="status" class="msg"></div>`);
  const seal=document.createElement('div');
  seal.className='identity-seal';
  seal.setAttribute('aria-hidden','true');
  seal.textContent=Array.from(profile.name.trim())[0] || '•';
  $('dialog-body').prepend(seal);
  $('no').onclick=closeDialog;
  $('yes').onclick=async()=>{
    const c=candidate, seq=++sessionSequence;
    $('yes').disabled=true;
    try {
      const result=await api('/api/brief?id='+encodeURIComponent(c.id));
      if (candidate!==c || seq!==sessionSequence) return;
      closeDialog();
      personal={...result,via:c.via}; lastAction=lastSeen=Date.now();
      render();
    } catch(e) { message(e.message); if($('yes')) $('yes').disabled=false; }
  };
}
async function startCamera() {
  if (camera.faceActive) return;
  starting=true;cameraMessage='';render();
  try {
    if (camera.streaming) await camera.resumeFace();
    else await camera.openCamera();
  }
  catch(e) { cameraMessage=e.message;throw e; }
  finally { starting=false;render(); }
}
function onFrame({count,face,match}) {
  const now=Date.now();
  if (enrollment) {
    const e=enrollment;
    if (!e.collect) return;
    if (count!==1) { e.values=[];message(count?'画面中有多张脸，请只留本人。':'请正对摄像头，保持光线充足。');return; }
    e.values=addSample(e.values,face);
    message('已采集 '+e.values.length+' / 3，请保持在画面中。');
    if (e.values.length===3) {
      try { remember(e.id,e.values);localStorage.setItem('morning.camera','on');const id=e.id;closeDialog();void settings(id);notify('已录入，返回公共简报后即可识别。'); }
      catch(err) { message(err.message);e.collect=false;e.values=[];$('slot').dataset.capturing='false';$('capture').disabled=false; }
    }
    return;
  }
  if (ignored) {
    if (match===ignored) absentSince=0;
    else if (!absentSince) absentSince=now;
    else if (now-absentSince>2000) {ignored=null;absentSince=0;}
  }
  if (personal?.via==='camera' || candidate?.via==='camera') {
    const id=personal?.profile.id || candidate.id;
    if (match===id && count===1) lastSeen=now;
    else if (count>1 || (match && match!==id)) home();
    return;
  }
  if (dialog || personal || !match || count!==1 || match===ignored) { consecutive=0;lastMatch=null;return; }
  consecutive=lastMatch===match?consecutive+1:1; lastMatch=match;
  const profile=wall?.profiles.find(p=>p.id===match);
  if (profile && consecutive>=2) confirmPerson(profile,'camera');
}
setInterval(()=>{
  if ((personal?.via==='camera' || candidate?.via==='camera') && Date.now()-lastSeen>10000) home();
  else if (personal?.via==='manual' && Date.now()-lastAction>90000) home();
},1000);
for (const event of ['pointerdown','keydown','wheel']) document.addEventListener(event,()=>{lastAction=Date.now();},{passive:true});

async function settings(selected) {
  const seq=++profileSequence;
  editing=null;
  setDialog('settings','<h2 id="dialog-title">成员与订阅</h2><p>正在读取…</p>');
  try {
    const id=selected===undefined?wall.profiles[0]?.id:selected;
    const profile=id?(await api('/api/brief?id='+encodeURIComponent(id))).profile:{name:'',repos:[]};
    if (dialog!=='settings' || seq!==profileSequence) return;
    editing=profile;
    const custom=profile.repos.filter(r=>!wall.catalog.some(c=>c.repo===r));
    const list=wall.profiles.map(p=>`<option value="${esc(p.id)}" ${p.id===id?'selected':''}>${esc(p.name)}</option>`).join('');
    const groups=[...new Set(wall.catalog.map(s=>s.group))];
    const boxes=groups.map(group=>`<fieldset class="source-group"><legend>${esc(group)}</legend><div class="choose">${wall.catalog.filter(s=>s.group===group).map(s=>`<label><input type="checkbox" aria-label="${esc(s.label)}" value="${esc(s.repo)}" ${profile.repos.includes(s.repo)?'checked':''}><span><b>${esc(s.label)}</b><small>${esc(s.note)}</small></span></label>`).join('')}</div></fieldset>`).join('');
    const identity=id?`<section class="recognition-settings"><h3>走近识别</h3><p>${enrolled(id)?'已录入本人，可在大屏前确认身份。':'录入后，走近屏幕即可收到身份确认。'}</p><button id="enroll" class="secondary" type="button">${enrolled(id)?'重新录入本人':'录入本人'}</button>${enrolled(id)?'<button id="forget" class="textbtn" type="button">清除识别特征</button>':''}</section>`:'<p class="formhint">保存成员后，即可设置走近识别。</p>';
    setDialog('settings',`<div class="settings-heading"><h2 id="dialog-title">成员与订阅</h2><p>为每位成员选择感兴趣的内容，每天自动整理。</p></div><div class="settings-layout"><aside class="member-editor"><label class="formlabel" for="member">选择成员</label><select id="member">${list}<option value="" ${!id?'selected':''}>＋ 新增成员</option></select><button class="textbtn" type="button" id="add-member">＋ 添加成员</button><label class="formlabel" for="name">成员名字</label><input class="field" id="name" form="prefs" required maxlength="40" value="${esc(profile.name)}" placeholder="输入名字">${identity}</aside><form id="prefs"><div class="source-heading"><h3>关注的内容</h3><span>最多 8 个项目</span></div>${boxes}<details class="custom-sources" ${custom.length?'open':''}><summary>添加其他公开 GitHub 项目</summary><label class="formlabel" for="custom">项目地址</label><input id="custom" class="field" value="${esc(custom.join(', '))}" placeholder="例如 apple/swift-collections"><p class="formhint">多个项目用逗号分隔。</p></details><div class="settings-save"><button type="submit" class="primary">保存订阅</button><div id="msg" class="msg" role="status"></div></div></form></div>`);
    $('add-member').onclick=()=>void settings('');
    $('member').onchange=e=>void settings(e.target.value);
    $('prefs').onsubmit=async e=>{
      e.preventDefault();
      const submit=e.target.querySelector('[type=submit]');submit.disabled=true;
      const preset=[...$('prefs').querySelectorAll('input:checked')].map(el=>el.value);
      const extra=$('custom').value.split(/[\s,，]+/).filter(Boolean);
      try { const saved=await api('/api/profiles',{id:profile.id,name:$('name').value,repos:[...new Set([...preset,...extra])]});
        await loadWall(); if (seq===profileSequence && dialog==='settings') await settings(saved.id);notify('订阅已保存。'); }
      catch(err){message(err.message);submit.disabled=false;}
    };
    if($('enroll')) $('enroll').onclick=()=>enroll(profile);
    if($('forget')) $('forget').onclick=()=>{if(window.confirm('清除这位成员在本浏览器保存的面部特征？')){forget(id);void settings(id);notify('识别特征已清除。');}};
  } catch(err){if(seq===profileSequence){closeDialog();notify(err.message);}}
}
function enroll(profile) {
  enrollment={id:profile.id,collect:false,values:[],previouslyOn:camera.active || localStorage.getItem('morning.camera')==='on'};
  setDialog('enroll',`<h2 id="dialog-title">为${esc(profile.name)}录入本人</h2><p>同意后将读取摄像头画面，连续采集 3 组面部特征。特征仅保存在这台设备的当前浏览器中，可随时清除。录入完成后会开启走近识别。</p><div class="cam-slot" id="slot"></div><div class="dialog-actions"><button class="primary" id="capture">本人同意并开始录入</button></div><div class="msg" id="msg" role="status"></div>`);
  $('slot').append(video);
  $('capture').onclick=async()=>{
    const e=enrollment;$('capture').disabled=true;message('正在准备摄像头与本地模型…');
    try { await startCamera();if(enrollment===e && camera.active){e.collect=true;$('slot').dataset.capturing='true';message('请正对摄像头，画面中只留本人。');} }
    catch(err){if(enrollment===e){message(err.message);$('capture').disabled=false;}}
  };
}
$('settings').onclick=()=>{if(wall) void settings(personal?.profile.id);};
$('full').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{notify('请使用浏览器菜单进入全屏。');}};
document.addEventListener('fullscreenchange',()=>{const name=document.fullscreenElement?'退出全屏':'进入全屏';$('full').setAttribute('aria-label',name);$('full').title=name;});
$('sync').onclick=async()=>{try{wall=await api('/api/refresh',{});render();void dashboard.refresh();notify(wall.running?'机器人正在检查订阅源。':'刚刚已检查过订阅源。');}catch(e){notify(e.message);}};
try {
  await loadWall();
  if (localStorage.getItem('morning.camera')==='on' || gestureEnabled()) {
    try {await startCamera();} catch(e) {notify(e.message);}
  }
} catch(e){$('tiles').textContent='暂时无法读取简报，将自动重试。';notify(e.message);}
setInterval(()=>loadWall().catch(()=>{lastRender='';$('robot-text').textContent='等待本机服务';}),5000);

