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
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'morning-wall-test-'));
const now=new Date(), day=editionDay(now), iso=now.toISOString();
const feeds=Object.fromEntries(catalog.map(s=>[s.repo,{checkedAt:iso,attemptedAt:iso,error:null,item:{
  title:'v1.0',tag:'v1.0',detail:'A release for the screen test.',publishedAt:iso,url:'https://github.com/'+s.repo+'/releases/tag/v1.0'}}]));
for(const feed of Object.values(feeds)) {
  feed.history=[feed.item,{...feed.item,tag:'v0.9',url:feed.item.url.replace('v1.0','v0.9'),publishedAt:new Date(now.getTime()-86400000).toISOString()}];
}
fs.writeFileSync(path.join(dir,'wall.json'),JSON.stringify({profiles:[defaultProfile],feeds,briefs:{demo:makeBrief(defaultProfile,feeds,day)},lastRunAt:iso}));
const port=process.env.BRIEF_TEST_PORT || '4329',url='http://127.0.0.1:'+port;
const server=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,BRIEF_DATA:dir,PORT:port,BRIEF_OFFLINE:'1'},stdio:['ignore','pipe','pipe'],windowsHide:true});
let browser;
try {
  await Promise.race([once(server.stdout,'data'),once(server,'exit').then(()=>{throw Error('test server failed');})]);
  browser=await chromium.launch({channel:'chrome',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader'],headless:true});
  const p=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];p.on('pageerror',err=>errors.push(err.message));
  await p.emulateMedia({reducedMotion:'reduce'});
  await p.goto(url);
  await p.locator('.widget').first().waitFor();
  await p.evaluate(()=>document.fonts.ready);
  await p.locator('#avatar[data-ready="d02"]').waitFor({timeout:30000});
  const motion=p.getByRole('button',{name:'大屏动效'});
  assert.equal(await motion.getAttribute('aria-pressed'),'false');
  await motion.click();
  await p.waitForFunction(()=>getComputedStyle(document.querySelector('.waterlight')).animationPlayState==='running');
  await motion.click();
  await p.reload();await p.locator('.widget').first().waitFor();
  assert.equal(await motion.getAttribute('aria-pressed'),'false');await motion.click();
  for(const [width,height] of [[1920,1080],[3840,2160],[1280,720]]) {
    await p.setViewportSize({width,height});
    assert.equal(await p.locator('[data-module]').count(),16);
    assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth && document.querySelector('footer').getBoundingClientRect().bottom<=innerHeight));
  }
  await p.setViewportSize({width:1440,height:1000});
  await p.getByRole('button',{name:'设置杭州天气',exact:true}).click();
  await p.getByLabel('关注城市').fill('上海');
  await p.getByRole('button',{name:'保存模块',exact:true}).click();
  await p.getByRole('button',{name:'设置杭州天气',exact:true}).click();
  assert.equal(await p.getByLabel('关注城市').inputValue(),'上海');
  await p.getByRole('button',{name:'取消',exact:true}).click();
  await p.getByRole('button',{name:'设置热点新闻',exact:true}).click();
  await p.getByLabel('新闻栏目').selectOption('culture');await p.getByLabel('只关注这些关键词').fill('杭州，电影');
  await p.getByRole('button',{name:'保存模块',exact:true}).click();
  await p.getByRole('button',{name:'设置今日关注',exact:true}).click();
  await p.getByLabel('关注清单').fill('团队要事\n<img src=x onerror=alert(1)>');
  await p.getByRole('button',{name:'保存模块',exact:true}).click();
  await p.locator('.note-lines').filter({hasText:'团队要事'}).waitFor();
  assert.equal(await p.locator('.note-lines img').count(),0);
  await p.getByRole('button',{name:'体验示例简报'}).click();
  await p.getByRole('heading',{name:'是示例成员吗？'}).waitFor();
  assert.equal(await p.locator('.identity-seal').innerText(),'示');
  assert.equal(await p.locator('html').getAttribute('data-paused'),'true');
  await p.getByRole('button',{name:'是我，打开简报'}).click();
  await p.getByRole('heading',{name:'示例成员的简报'}).waitFor();
  await p.getByRole('button',{name:'设置今日关注',exact:true}).click();
  await p.getByLabel('关注清单').fill('仅我可见的关注');
  await p.getByRole('button',{name:'保存模块',exact:true}).click();
  await p.locator('.note-lines').filter({hasText:'仅我可见的关注'}).waitFor();
  await p.getByRole('button',{name:'返回团队晨报'}).click();
  await p.locator('.note-lines').filter({hasText:'团队要事'}).waitFor();
  assert.doesNotMatch(await p.locator('.note-lines').innerText(),/仅我可见/);
  console.log('PASS sixteen modules, responsive layout, configuration, safe notes and independent member preferences');
  await p.locator('[data-module="m2"] [data-calendar]').click();
  const today=new Intl.DateTimeFormat('en-CA').format(new Date());
  await p.getByLabel('日程标题',{exact:true}).fill('产品评审');
  await p.getByLabel('开始时间',{exact:true}).fill(today+'T09:00');
  await p.getByLabel('结束时间',{exact:true}).fill(today+'T10:00');
  await p.getByRole('button',{name:'添加日程',exact:true}).click();
  await p.locator('.calendar-events').filter({hasText:'产品评审'}).waitFor();
  const dayCode=today.replaceAll('-','');
  const ics=['BEGIN:VCALENDAR','VERSION:2.0','BEGIN:VEVENT','UID:browser-import','DTSTART:'+dayCode+'T120000','DTEND:'+dayCode+'T123000','SUMMARY:设计同步','END:VEVENT','END:VCALENDAR'].join('\r\n');
  await p.locator('#ics-file').setInputFiles({name:'team.ics',mimeType:'text/calendar',buffer:Buffer.from(ics)});
  await p.locator('.calendar-events').filter({hasText:'设计同步'}).waitFor();
  await p.getByRole('button',{name:'关闭弹窗'}).click();
  await p.locator('[data-module="m2"]').filter({hasText:'产品评审'}).waitFor();
  await p.getByRole('button',{name:'设置简报助手',exact:true}).click();
  await p.locator('input[name="character"][value="k02"]').check();
  await p.getByRole('button',{name:'保存角色',exact:true}).click();
  await p.locator('#avatar[data-ready="k02"]').waitFor({timeout:30000});
  await p.getByRole('button',{name:'点头',exact:true}).click();
  await p.getByRole('button',{name:'换表情',exact:true}).click();
  await p.reload();await p.locator('#avatar[data-ready="k02"]').waitFor({timeout:30000});
  await p.locator('[data-module="m2"]').filter({hasText:'设计同步'}).waitFor();
  const gallery=await browser.newPage();
  await gallery.goto(url+'/vendor/livliv/example/gallery.html');
  await gallery.locator('#name').filter({hasText:'Leo'}).waitFor({timeout:30000});
  assert.equal(await gallery.locator('.cast button').count(),4);
  await gallery.getByRole('button',{name:'Sena',exact:true}).click();
  await gallery.locator('#name').filter({hasText:'Sena'}).waitFor({timeout:30000});
  await gallery.close();
  console.log('PASS local schedule, ICS import, persisted character selection and integrated LivLiv gallery');


  await p.getByRole('button',{name:'成员与订阅'}).click();
  await p.getByLabel('选择成员').selectOption('');
  await p.getByLabel('成员名字').fill('小禾');
  await p.getByLabel('Vite',{exact:true}).check();
  await p.getByRole('button',{name:'保存订阅'}).click();
  await p.getByRole('button',{name:'录入本人'}).waitFor();
  const stored=JSON.parse(fs.readFileSync(path.join(dir,'wall.json'),'utf8'));
  const added=stored.profiles.find(r=>r.name==='小禾');
  assert.deepEqual(added.repos,['vitejs/vite']);
  assert.equal(stored.briefs[added.id].items[0].repo,'vitejs/vite');
  assert.equal(stored.briefs[added.id].discovery.group,'前端开发');
  console.log('PASS member subscriptions persisted and bulletin prepared');

  await p.getByRole('button',{name:'录入本人'}).click();
  await p.evaluate(()=>Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>{throw new DOMException('denied','NotAllowedError');}}));
  await p.getByRole('button',{name:'本人同意并开始录入'}).click();
  await p.locator('#msg').filter({hasText:'权限未授予'}).waitFor();
  console.log('PASS camera permission denial');

  const asset=fs.readFileSync(path.join(root,'node_modules/@vladmandic/face-api/demo/sample3.jpg')).toString('base64');
  await p.evaluate(async b64=>{
    const img=new Image();img.src='data:image/jpeg;base64,'+b64;await img.decode();
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
    const ctx=canvas.getContext('2d');
    window.drawTestFrame=(visible)=>{
      ctx.fillStyle='#202020';ctx.fillRect(0,0,640,480);
      if(visible) {
        const width=img.width*0.27, height=width*0.75;
        ctx.drawImage(img,img.width*0.63-width/2,img.height*0.26-height/2,width,height,0,0,640,480);
      }
    };
    let visible=true;
    window.hideTestFace=()=>{visible=false;};
    window.drawTestFrame(true);
    setInterval(()=>window.drawTestFrame(visible),200);
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>canvas.captureStream(5)});
  },asset);
  await p.getByRole('button',{name:'本人同意并开始录入'}).click();
  try {await p.getByRole('button',{name:'重新录入本人'}).waitFor({timeout:90000});}
  catch(err){console.log('enrollment UI',await p.locator('#msg').innerText(),errors);throw err;}
  assert.equal(await p.evaluate(id=>JSON.parse(localStorage.getItem('morning.wall.face-templates.v1'))[id].length,added.id),3);
  assert.equal(fs.readFileSync(path.join(dir,'wall.json'),'utf8').includes('face-templates'),false);
  await p.getByRole('button',{name:'关闭弹窗'}).click();
  await p.getByRole('heading',{name:'是小禾吗？'}).waitFor({timeout:45000});
  await p.getByRole('button',{name:'是我，打开简报'}).click();
  await p.getByRole('heading',{name:'小禾的简报'}).waitFor();
  await p.evaluate(()=>window.hideTestFace());
  await p.getByRole('heading',{name:'团队晨报'}).waitFor({timeout:25000});
  console.log('PASS real local models, virtual video enrollment, recognized candidate, exit after absence');

  await p.getByRole('button',{name:'关闭摄像头'}).click();
  await p.getByRole('button',{name:'成员与订阅'}).click();
  await p.getByLabel('选择成员').selectOption(added.id);
  await p.getByRole('button',{name:'清除识别特征'}).waitFor();
  p.once('dialog',d=>d.accept());
  await p.getByRole('button',{name:'清除识别特征'}).click();
  await p.getByRole('button',{name:'录入本人',exact:true}).waitFor();
  await p.getByRole('button',{name:'关闭弹窗'}).click();
  await p.setViewportSize({width:390,height:844});await p.reload();
  await p.getByRole('button',{name:'选择成员简报'}).waitFor();
  assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);
  console.log('PASS forget face, reload, narrow viewport and browser console');
} finally {
  await browser?.close();
  if(server.exitCode===null){const stopped=once(server,'exit');server.kill();await stopped;}
  fs.rmSync(dir,{recursive:true,force:true});
}

