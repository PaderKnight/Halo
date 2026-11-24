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
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'morning-info-test-'));
const now=new Date(), day=editionDay(now), iso=now.toISOString();
const feeds=Object.fromEntries(catalog.map(s=>[s.repo,{checkedAt:iso,attemptedAt:iso,error:null,item:{
  title:'v1.0',tag:'v1.0',detail:'A release for the info window test.',publishedAt:iso,url:'https://github.com/'+s.repo+'/releases/tag/v1.0'}}]));
fs.writeFileSync(path.join(dir,'wall.json'),JSON.stringify({profiles:[defaultProfile],feeds,briefs:{demo:makeBrief(defaultProfile,feeds,day)},lastRunAt:iso}));
const port='4334',url='http://127.0.0.1:'+port;
const server=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,BRIEF_DATA:dir,PORT:port,BRIEF_OFFLINE:'1'},stdio:['ignore','pipe','pipe'],windowsHide:true});
let browser;
try {
  await Promise.race([once(server.stdout,'data'),once(server,'exit').then(()=>{throw Error('test server failed');})]);
  browser=await chromium.launch({channel:'chrome',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader'],headless:true});
  const p=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];p.on('pageerror',err=>errors.push(err.message));
  await p.addInitScript(() => { try { localStorage.setItem('morning.gesture.enabled','off'); } catch {} });
  await p.goto(url);
  await p.locator('.widget').first().waitFor();

  assert.equal(await p.locator('#gesture-cursor').count(),1);
  assert.equal(await p.locator('#gesture-cursor').getAttribute('popover'),'manual');
  assert.equal(await p.locator('#gesture-cursor').isVisible(),false);

  assert.equal(await p.locator('[data-gesture-card]').count(),15);
  await p.getByRole('button',{name:'设置今日关注',exact:true}).click();
  await p.getByLabel('关注清单').fill('第一行\n第二行\n第三行');
  await p.getByRole('button',{name:'保存模块',exact:true}).click();
  await p.locator('.widget-notes .note-lines').waitFor();
  assert.equal(await p.locator('.widget-notes [data-gesture-item]').count(),3);

  await p.locator('.widget-notes .widget-body').click();
  await p.locator('dialog[data-kind="info"]').waitFor();
  // 手势关闭时没有手部输入，光标保持隐藏，但元素仍必须是顶层 popover
  assert.equal(await p.locator('#gesture-cursor').isVisible(),false);
  assert.equal(await p.locator('.info-page').innerText(),'1 / 3');
  assert.ok((await p.locator('.info-body').innerText()).includes('第一行'));
  assert.ok(await p.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.info-line')).fontSize)) >= 22);

  await p.locator('[data-info-next]').click();
  assert.equal(await p.locator('.info-page').innerText(),'2 / 3');
  await p.keyboard.press('ArrowRight');
  assert.equal(await p.locator('.info-page').innerText(),'3 / 3');
  await p.keyboard.press('ArrowRight');
  assert.equal(await p.locator('.info-page').innerText(),'3 / 3');
  await p.keyboard.press('ArrowLeft');
  assert.equal(await p.locator('.info-page').innerText(),'2 / 3');
  assert.match(await p.locator('[data-info-next]').getAttribute('data-gesture-key'),/^info:next:/);

  await p.keyboard.press('Escape');
  await p.waitForFunction(() => !document.getElementById('modal').open);

  await p.locator('.widget-weather .widget-heading h2').click();
  await p.locator('dialog[data-kind="info"]').waitFor();
  assert.equal(await p.locator('.info-page').innerText(),'1 / 1');
  await p.keyboard.press('Escape');

  await p.getByRole('button',{name:'设置今日关注',exact:true}).click();
  assert.equal(await p.locator('dialog[data-kind="module"]').count(),1);
  await p.getByRole('button',{name:'取消',exact:true}).click();

  assert.deepEqual(errors,[]);
  console.log('PASS info window opens, pages with buttons and arrow keys, and leaves module settings intact');
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    const stopped = once(server, 'exit');
    server.kill();
    await Promise.race([stopped, new Promise(resolve => setTimeout(resolve, 5000))]);
  }
  fs.rmSync(dir, { recursive: true, force: true });
}
