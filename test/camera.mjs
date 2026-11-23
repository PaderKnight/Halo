import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { catalog, defaultProfile, editionDay, makeBrief } from '../brief.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'morning-camera-test-'));
const now=new Date(), day=editionDay(now), iso=now.toISOString();
const feeds=Object.fromEntries(catalog.map(s=>[s.repo,{checkedAt:iso,attemptedAt:iso,error:null,item:{
  title:'v1.0',tag:'v1.0',detail:'A release for the camera test.',publishedAt:iso,url:'https://github.com/'+s.repo+'/releases/tag/v1.0'}}]));
const profiles=[defaultProfile,{id:'u2',name:'小禾',repos:['vitejs/vite']}];
const briefs=Object.fromEntries(profiles.map(p=>[p.id,makeBrief(p,feeds,day)]));
fs.writeFileSync(path.join(dir,'wall.json'),JSON.stringify({profiles,feeds,briefs,lastRunAt:iso}));
const port=process.env.CAMERA_TEST_PORT || '4332',url='http://127.0.0.1:'+port;
const server=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,BRIEF_DATA:dir,PORT:port,BRIEF_OFFLINE:'1'},stdio:['ignore','pipe','pipe'],windowsHide:true});
let browser;
const fakeCamera = ({gesture='on',device=null,denied=false,overconstrained=false}={}) => {
  try {
    localStorage.setItem('morning.gesture.enabled',gesture);
    if (device) localStorage.setItem('morning.camera.device',device); else localStorage.removeItem('morning.camera.device');
  } catch {}
  if (!navigator.mediaDevices) Object.defineProperty(navigator,'mediaDevices',{value:{},configurable:true});
  let calls=0;
  navigator.mediaDevices.getUserMedia = async constraints => {
    calls++; window.__calls=calls; window.__lastConstraints=constraints;
    if (denied) throw new DOMException('denied','NotAllowedError');
    if (overconstrained && constraints?.video?.deviceId) throw new DOMException('bad','OverconstrainedError');
    const canvas=document.createElement('canvas');
    canvas.width=640; canvas.height=480;
    canvas.getContext('2d').fillStyle='#222'; canvas.getContext('2d').fillRect(0,0,640,480);
    const stream=canvas.captureStream(5);
    window.__stream=stream;
    return stream;
  };
  navigator.mediaDevices.enumerateDevices = async () => [{kind:'videoinput',deviceId:'fake-1',label:'Fake Camera',groupId:'g'}];
};
async function openPage(options) {
  const p=await browser.newPage({viewport:{width:1280,height:900}});
  p.setDefaultTimeout(120000);
  const errors=[];
  p.on('pageerror',err=>errors.push(err.message));
  await p.emulateMedia({reducedMotion:'reduce'});
  await p.addInitScript(fakeCamera,options);
  await p.goto(url);
  await p.locator('.widget').first().waitFor();
  return {p,errors};
}
try {
  await Promise.race([once(server.stdout,'data'),once(server,'exit').then(()=>{throw Error('test server failed');})]);
  browser=await chromium.launch({channel:'chrome',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader'],headless:true});

  {
    const {p}=await openPage({gesture:'off'});
    await p.waitForFunction(()=>document.documentElement.dataset.camera==='off');
    assert.equal(await p.evaluate(()=>window.__calls),undefined);
    await p.getByRole('button',{name:'开启摄像头识别',exact:true}).click();
    await p.waitForFunction(()=>document.documentElement.dataset.camera==='on',{},{timeout:30000});
    await p.getByRole('button',{name:'关闭摄像头',exact:true}).waitFor({timeout:120000});
    await p.getByRole('button',{name:'关闭摄像头',exact:true}).click();
    assert.equal(await p.evaluate(()=>window.__stream.getTracks()[0].readyState),'ended');
    await p.close();
    console.log('PASS gesture off keeps the old click-to-start and close behavior');
  }

  {
    const {p}=await openPage({gesture:'off'});
    await p.evaluate(async()=>{
      const { Camera } = await import('/camera.js');
      const video=document.createElement('video');
      video.muted=true; video.playsInline=true;
      window.__detachedPayloads=[];
      window.__detachedCamera=new Camera(video,payload=>window.__detachedPayloads.push(payload),err=>{window.__detachedError=err?.message || String(err);});
      await window.__detachedCamera.openCamera();
    });
    await p.waitForFunction(()=>window.__detachedPayloads?.length>0,{},{timeout:120000});
    const payload=await p.evaluate(()=>window.__detachedPayloads[0]);
    assert.equal(Array.isArray(payload.detections),true);
    assert.equal(Array.isArray(payload.scores),true);
    assert.equal(await p.evaluate(()=>window.__detachedError || null),null);
    await p.evaluate(()=>window.__detachedCamera.stop());
    await p.close();
    console.log('PASS frame payload includes detections and scores without setDebug');
  }

  let streamingPage;
  {
    const {p,errors}=await openPage({gesture:'on'});
    streamingPage={p,errors};
    await p.waitForFunction(()=>document.documentElement.dataset.camera==='on',{},{timeout:30000});
    await p.locator('.statusline').filter({hasText:'手势运行中'}).waitFor({timeout:120000});
    assert.equal(await p.evaluate(()=>window.__stream.getTracks()[0].readyState),'live');
    await p.getByRole('button',{name:'暂停人脸识别',exact:true}).click();
    await p.locator('.statusline').filter({hasText:'人脸识别已暂停'}).waitFor();
    assert.equal(await p.evaluate(()=>window.__stream.getTracks()[0].readyState),'live');
    await p.getByRole('button',{name:'开始人脸识别',exact:true}).click();
    await p.getByRole('button',{name:'暂停人脸识别',exact:true}).waitFor({timeout:120000});
    assert.deepEqual(errors,[]);
    console.log('PASS gesture on keeps the stream alive while face recognition is paused and resumed');
  }

  {
    const {p,errors}=await openPage({gesture:'on'});
    await p.waitForFunction(()=>document.documentElement.dataset.camera==='on',{},{timeout:30000});
    await p.getByRole('button',{name:'暂停人脸识别',exact:true}).click();
    assert.equal(await p.evaluate(()=>window.__stream.getTracks()[0].readyState),'live');
    await p.evaluate(()=>localStorage.setItem('morning.gesture.enabled','off'));
    await p.locator('#cam').click();
    await p.waitForFunction(()=>document.documentElement.dataset.camera==='off');
    assert.equal(await p.evaluate(()=>window.__stream.getTracks()[0].readyState),'ended');
    assert.deepEqual(errors,[]);
    await p.close();
    console.log('PASS paused face with gestures disabled closes the stream from the camera button');
  }

  {
    const {p,errors}=await openPage({gesture:'on',denied:true});
    await p.locator('#notice').filter({hasText:'权限'}).waitFor();
    assert.deepEqual(await p.evaluate(()=>document.documentElement.dataset.camera),'off');
    assert.equal(await p.getByRole('button',{name:'选择成员简报'}).isEnabled(),true);
    assert.deepEqual(errors,[]);
    await p.close();
    console.log('PASS camera permission denial surfaces a message without page errors');
  }

  {
    const {p,errors}=streamingPage;
    await p.evaluate(()=>window.__stream.getTracks()[0].dispatchEvent(new Event('ended')));
    await p.waitForFunction(()=>document.documentElement.dataset.camera==='off' || document.querySelector('.statusline')?.textContent.includes('摄像头已断开'));
    assert.deepEqual(errors,[]);
    await p.close();
    console.log('PASS a track ending mid-session resets state and reports the disconnect');
  }

  {
    const {p}=await openPage({gesture:'on',device:'ghost',overconstrained:true});
    await p.waitForFunction(()=>window.__calls>=2,{},{timeout:30000});
    await p.waitForFunction(()=>document.documentElement.dataset.camera==='on',{},{timeout:30000});
    assert.equal(await p.evaluate(()=>'deviceId' in window.__lastConstraints.video),false);
    await p.close();
    console.log('PASS OverconstrainedError retries without the requested device id');
  }
} finally {
  await browser?.close();
  if(server.exitCode===null){const stopped=once(server,'exit');server.kill();await stopped;}
  fs.rmSync(dir,{recursive:true,force:true});
}
