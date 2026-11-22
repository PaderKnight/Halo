const root=document.documentElement,toggle=document.getElementById('motion'),reduced=matchMedia('(prefers-reduced-motion: reduce)');
let preference=localStorage.getItem('morning.wall.motion'),covered=false,visible=true,enabled;
function playback(){root.dataset.paused=String(document.hidden||covered||!visible);}
function apply(){enabled=preference===null?!reduced.matches:preference==='on';root.dataset.motion=enabled?'on':'off';toggle.setAttribute('aria-pressed',String(enabled));toggle.title=enabled?'关闭大屏动效':'开启动效';toggle.querySelector('.motion-label').textContent=enabled?'动效开':'动效关';playback();}
toggle.onclick=()=>{preference=enabled?'off':'on';localStorage.setItem('morning.wall.motion',preference);apply();};
reduced.addEventListener('change',apply);document.addEventListener('visibilitychange',playback);
new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;playback();}).observe(document.querySelector('.member-zone'));
apply();
export function coverMotion(value){covered=value;playback();}
export function showBoard(view){root.dataset.view=view==='public'?'public':'member';}

