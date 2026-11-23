import { Player } from './vendor/livliv/dist/index.js';
const root=document.documentElement;
const canvas=document.getElementById('avatar');
const cover=document.getElementById('avatar-cover');
const label=document.getElementById('avatar-status');
let player,selected,seq=0,expressions=[],index=-1;
function playback(){if(!player)return;const active=root.dataset.motion==='on'&&root.dataset.paused!=='true'&&!document.hidden;if(active)player.play();else{player.pause();player.resize();}}
export async function showAvatar(id) {
  if(selected===id)return;selected=id;const token=++seq;
  cover.src='/vendor/livliv/characters/'+id+'/cover.webp';cover.hidden=false;label.textContent='角色载入中';
  try {
    player ||= new Player(canvas,{maxPixelRatio:1.25,followPointer:'canvas',autoplay:false,lang:'zh-CN'});
    // Local player extension: attribution is shown in character settings.
    player.showMark=false;
    player.view.fit='whole';
    const info=await player.load('/vendor/livliv/characters/'+id+'.livliv');
    if(token!==seq)return;
    expressions=info.expressions;index=-1;cover.hidden=true;label.textContent=info.name;canvas.dataset.ready=id;playback();
  }catch {if(token===seq){label.textContent='静态预览';selected=null;}}
}
export function greet(){if(!player)return;player.act('nod');player.setExpression(expressions.find(e=>e.id==='smile')?.id||null);player.resize();}
document.getElementById('avatar-greet').onclick=greet;
document.getElementById('avatar-expression').onclick=()=>{if(!player)return;index=(index+1)%(expressions.length+1);player.setExpression(expressions[index]?.id||null);player.resize();};
new MutationObserver(playback).observe(root,{attributes:true,attributeFilter:['data-motion','data-paused']});
document.addEventListener('visibilitychange',playback);
window.addEventListener('pagehide',()=>player?.dispose({release:true}));

