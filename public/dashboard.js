import {esc} from './board.js';
import {showAvatar} from './avatar.js';
const $=id=>document.getElementById(id);
const stamp=v=>v?new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(v)):'';
const dateKey=d=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
const clockZones={'Asia/Shanghai':'中国','Asia/Tokyo':'东京','Asia/Singapore':'新加坡','Europe/London':'伦敦','America/New_York':'纽约','America/Los_Angeles':'洛杉矶'};
const defaultConfig={weather:{city:'杭州'},forecast:{city:'杭州'},news:{source:'headlines',keyword:''},agenda:{days:1,keyword:''},project:{repo:'ollama/ollama'},clock:{zone:'Asia/Tokyo'},countdown:{target:'weekend'},notes:{text:''},links:{links:[]}};
const labelTypes={weather:'天气',forecast:'预报',agenda:'日程',news:'新闻',project:'技术',clock:'时钟',countdown:'倒计时',notes:'便签',links:'链接'};
function matches(text,query){const keys=query.split(/[,，]/).map(v=>v.trim().toLowerCase()).filter(Boolean);return !keys.length||keys.some(k=>text.toLowerCase().includes(k));}
function weatherSymbol(code){return code===149?'≋':code===113?'☀':code===116?'⛅':code===119||code===122?'☁':code===143||code===248||code===260?'≋':code>=200?'☂':'☁';}
function condition(text){const words={'Smoky haze':'霾','Haze':'霾','Clear':'晴','Sunny':'晴','Partly cloudy':'局部多云','Cloudy':'多云','Overcast':'阴','Mist':'薄雾','Fog':'雾','Light rain':'小雨','Moderate rain':'中雨','Heavy rain':'大雨','Light drizzle':'毛毛雨','Light snow':'小雪','Patchy rain nearby':'局部有雨'};return words[text]||text;}
function href(item,label){return '<a href="'+esc(item.url)+'" title="'+esc(label||item.title)+'" target="_blank" rel="noopener noreferrer">'+esc(label||item.title)+'</a>';}
export function createDashboard({api,setDialog,closeDialog,notify}) {
  let scope='public',data,wall,profile,request=0,pending=false,last='',calendarDraft;
  function context(){return scope==='public'?'团队公共屏':(profile?.profile.name||'成员')+'的个人屏';}
  function empty(text,action,id){return '<div class="widget-empty"><p>'+esc(text)+'</p>'+(action?'<button class="textbtn" data-edit="'+id+'">'+esc(action)+'</button>':'')+'</div>';}
  function eventsFor(m){
    const now=new Date(),today=dateKey(now),end=new Date(today+'T00:00:00+08:00');end.setDate(end.getDate()+m.config.days);
    return data.events.filter(e=>Date.parse(e.endAt)>=Date.parse(today+'T00:00:00+08:00')&&Date.parse(e.startAt)<+end&&matches(e.title+' '+e.location,m.config.keyword)).sort((a,b)=>a.startAt.localeCompare(b.startAt));
  }
  function contents(m) {
    const c=m.config,d=m.data;
    if(m.type==='weather')return d?`<div class="weather-main"><span class="temperature">${Math.round(d.temp)}<small>°C</small></span><span class="weather-symbol" aria-hidden="true">${weatherSymbol(d.code)}</span></div><p class="weather-description">${esc(c.city)} · ${esc(condition(d.condition))}</p><div class="weather-details"><span>体感 ${Math.round(d.feels)}°</span><span>湿度 ${d.humidity}%</span><span>风速 ${d.wind} km/h</span></div>`:empty(m.loading?'正在获取 '+c.city+' 天气':'天气暂未读取，稍后自动重试','更换城市',m.id);
    if(m.type==='forecast')return d?'<div class="forecast-days">'+d.days.map(day=>`<div><span>${day.date.slice(5).replace('-','/')}</span><strong>${day.max}°</strong><span class="forecast-low">${day.min}°</span><small>降雨 ${day.rain}%</small></div>`).join('')+'</div>':empty(m.loading?'正在获取三日预报':'预报暂未读取，稍后自动重试','更换城市',m.id);
    if(m.type==='news'){
      if(!d)return empty(m.loading?'正在整理新闻…':'新闻源暂不可用，稍后自动重试','设置栏目',m.id);
      const items=d.items.filter(item=>matches(item.title,c.keyword));
      return items.length?'<ol class="news-list">'+items.slice(0,3).map(item=>'<li>'+href(item)+'<time>'+esc(stamp(item.publishedAt))+'</time></li>').join('')+'</ol>':empty('当前栏目没有匹配的新闻','调整关键词',m.id);
    }
    if(m.type==='agenda'){
      const list=eventsFor(m);
      return list.length?'<ul class="agenda-list">'+list.slice(0,3).map(e=>`<li><time>${e.allDay?'全天':stamp(e.startAt)}</time><div><b>${esc(e.title)}</b><span>${esc(e.location||'')}</span></div></li>`).join('')+'</ul>':empty(m.config.keyword?'暂无符合关注词的日程':'这段时间还没有安排');
    }
    if(m.type==='notes')return c.text?'<ul class="note-lines">'+c.text.split('\n').filter(Boolean).slice(0,5).map(line=>'<li>'+esc(line)+'</li>').join('')+'</ul>':empty('记下今天想关注的人、事或灵感','写一条关注',m.id);
    if(m.type==='clock')return '<div class="world-time" data-zone="'+esc(c.zone)+'"></div><p class="world-date" data-date-zone="'+esc(c.zone)+'"></p><span class="zone-label">'+esc(c.zone)+'</span>';
    if(m.type==='countdown'){
      const now=new Date(),target=c.target==='weekend'?new Date():new Date(c.target+'T00:00:00+08:00');
      if(c.target==='weekend'){target.setHours(0,0,0,0);target.setDate(target.getDate()+([0,6].includes(target.getDay())?0:(6-target.getDay()+7)%7));}
      const days=Math.max(0,Math.ceil((target-now)/86400000));
      return '<div class="countdown-number">'+days+'<span>天</span></div><p class="countdown-note">'+(c.target==='weekend'?(days?'距离本周六':'今天就是周末'):Date.parse(c.target+'T23:59:59+08:00')<+now?'目标日期已过':esc(c.target))+'</p>';
    }
    if(m.type==='links')return c.links.length?'<div class="quick-links">'+c.links.map(l=>href(l,l.label)).join('')+'</div>':empty('把经常打开的网站放在这里','添加链接',m.id);
    if(m.type==='project'){
      const existing=wall?.publicBrief.find(s=>s.repo===c.repo),items=d?.items?.length&&m.checkedAt>existing?.checkedAt?d.items:existing?[existing.item,...(existing.history||[])].filter(Boolean).filter((x,i,all)=>all.findIndex(y=>y.url===x.url)===i):d?.items;
      return items?.length?'<div class="project-focus"><span>'+esc(c.repo)+'</span><h3>'+href(items[0],items[0].tag||items[0].title)+'</h3><p>'+esc(items[0].url===existing?.item?.url?(existing.item.detailZh||existing.note):'查看最新发布说明')+'</p></div>':empty(m.loading?'正在检查 '+c.repo:'尚未读取到项目发布','更换项目',m.id);
    }
    return '';
  }
  function sourceLine(m){
    if(m.type==='agenda')return '<button class="textbtn" data-calendar="'+m.id+'">管理日程 · '+eventsFor(m).length+' 项</button><span>本地日历</span>';
    if(m.type==='news')return '<span>'+esc(data.newsSources[m.config.source].label)+(m.config.keyword?' · '+esc(m.config.keyword):'')+'</span><a href="https://www.chinanews.com.cn/rss/" target="_blank" rel="noopener noreferrer">中新网</a>';
    if(m.type==='weather'||m.type==='forecast')return '<span>'+esc(m.config.city)+'</span><a href="https://wttr.in" target="_blank" rel="noopener noreferrer">wttr.in</a>';
    if(m.type==='project')return '<span>GitHub Releases</span>';
    return '<span>'+esc({notes:'保存在本机',links:'你的常用入口',clock:clockZones[m.config.zone]||'当地时间',countdown:'按日历计算'}[m.type]||'')+'</span>';
  }
  function render(){
    const signature=JSON.stringify([scope,data,wall?.publicBrief,dateKey(new Date())]);if(signature===last)return;last=signature;
    $('tiles').innerHTML=data.modules.map(m=>`<section class="widget module widget-${m.type}" data-module="${m.id}"><div class="widget-heading"><span class="type-dot ${m.type}" aria-hidden="true"></span><h2>${esc(m.title)}</h2><button class="module-config" data-edit="${m.id}" aria-label="设置${esc(m.title)}" title="设置此模块">···</button></div><div class="widget-body">${contents(m)}</div><div class="widget-source">${sourceLine(m)}</div>${m.error?'<div class="data-warning">'+(m.checkedAt?'缓存 '+esc(stamp(m.checkedAt))+' · 更新失败':'来源暂不可用')+'</div>':''}</section>`).join('');
    $('facts').innerHTML='<span><b>16</b> 个模块</span><span><b>'+new Set(data.modules.map(m=>m.type)).size+'</b> 种内容</span>';
    $('feed-count').textContent=context()+' · 每个模块都可设置关注内容';
    $('tiles').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>edit(b.dataset.edit));
    $('tiles').querySelectorAll('[data-calendar]').forEach(b=>b.onclick=()=>calendar(b.dataset.calendar));
    void showAvatar(data.character);
    updateClocks();
  }
  function updateClocks(){document.querySelectorAll('[data-zone]').forEach(el=>el.textContent=new Intl.DateTimeFormat('zh-CN',{timeZone:el.dataset.zone,hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date()));document.querySelectorAll('[data-date-zone]').forEach(el=>el.textContent=new Intl.DateTimeFormat('zh-CN',{timeZone:el.dataset.dateZone,month:'long',day:'numeric',weekday:'short'}).format(new Date()));}
  setInterval(updateClocks,10000);
  async function refresh(){
    const token=++request,which=scope;pending=true;
    try{const next=await api('/api/dashboard?scope='+encodeURIComponent(which));if(token===request&&which===scope){data=next;render();}}
    catch(e){if(token===request)$('tiles').textContent='模块暂未读取：'+e.message;}
    finally{if(token===request)pending=false;}
  }
  function fields(type,c){
    const input=(id,label,value,extra='')=>`<label class="formlabel" for="${id}">${label}</label><input class="field" id="${id}" value="${esc(value||'')}" ${extra}>`;
    if(['weather','forecast'].includes(type))return input('cfg-city','关注城市',c.city,'required maxlength="60" list="cities"')+'<datalist id="cities">'+['杭州','上海','北京','深圳','广州','成都','南京','武汉'].map(n=>'<option>'+n+'</option>').join('')+'</datalist><p class="formhint">支持国内外城市；同名城市可填写英文名或经纬度。</p>';
    if(type==='news')return '<label class="formlabel" for="cfg-source">新闻栏目</label><select id="cfg-source">'+Object.entries(data.newsSources).map(([key,s])=>'<option value="'+key+'" '+(c.source===key?'selected':'')+'>'+s.label+'</option>').join('')+'</select>'+input('cfg-keyword','只关注这些关键词',c.keyword,'placeholder="例如 杭州，电影，旅行" maxlength="100"')+'<p class="formhint">逗号分隔，匹配任意关键词；留空显示整个栏目。新闻保留原标题与原文链接。</p>';
    if(type==='agenda')return '<label class="formlabel" for="cfg-days">显示范围</label><select id="cfg-days"><option value="1" '+(c.days===1?'selected':'')+'>今天</option><option value="7" '+(c.days===7?'selected':'')+'>未来七天</option></select>'+input('cfg-keyword','关注的会议或事项',c.keyword,'placeholder="例如 设计，产品，客户" maxlength="100"')+'<p class="formhint">日程可在卡片下方管理，支持本地填写和导入 ICS 文件。</p>';
    if(type==='notes')return '<label class="formlabel" for="cfg-text">关注清单</label><textarea class="field" id="cfg-text" rows="7" maxlength="1800" placeholder="每行一条">'+esc(c.text)+'</textarea>';
    if(type==='links')return '<label class="formlabel" for="cfg-links">链接列表</label><textarea class="field" id="cfg-links" rows="6" placeholder="名称 | https://example.com">'+esc(c.links.map(l=>l.label+' | '+l.url).join('\n'))+'</textarea><p class="formhint">每行一条，名称和网址用 | 分隔，最多 8 条。</p>';
    if(type==='project')return input('cfg-repo','关注的公开项目',c.repo,'required placeholder="例如 ollama/ollama"')+'<p class="formhint">填写 GitHub 的 owner/repo，可随时换成其他类型的模块。</p>';
    if(type==='clock')return '<label class="formlabel" for="cfg-zone">关注时区</label><select id="cfg-zone">'+Object.entries(clockZones).map(([z,name])=>'<option value="'+z+'" '+(z===c.zone?'selected':'')+'>'+name+' · '+z+'</option>').join('')+'</select>';
    if(type==='countdown')return '<label class="formlabel" for="cfg-target-kind">目标</label><select id="cfg-target-kind"><option value="weekend" '+(c.target==='weekend'?'selected':'')+'>每周六</option><option value="date" '+(c.target!=='weekend'?'selected':'')+'>指定日期</option></select>'+input('cfg-target','指定日期',c.target==='weekend'?'':c.target,'type="date"');
    return '';
  }
  function collect(type){
    const value=id=>$(id).value;
    if(['weather','forecast'].includes(type))return {city:value('cfg-city')};
    if(type==='news')return {source:value('cfg-source'),keyword:value('cfg-keyword')};
    if(type==='agenda')return {days:Number(value('cfg-days')),keyword:value('cfg-keyword')};
    if(type==='notes')return {text:value('cfg-text')};
    if(type==='project')return {repo:value('cfg-repo')};
    if(type==='clock')return {zone:value('cfg-zone')};
    if(type==='countdown')return {target:value('cfg-target-kind')==='weekend'?'weekend':value('cfg-target')};
    if(type==='links')return {links:value('cfg-links').split('\n').map(l=>l.trim()).filter(Boolean).map(l=>{const at=l.indexOf('|');return {label:l.slice(0,at).trim(),url:l.slice(at+1).trim()};})};
  }
  function edit(id){
    const m=data.modules.find(m=>m.id===id);if(!m)return;const editingScope=scope;
    setDialog('module',`<h2 id="dialog-title">设置模块</h2><p>${esc(context())} · 此设置仅影响当前模块。</p><form id="module-form"><label class="formlabel" for="cfg-type">内容类型</label><select id="cfg-type">${Object.entries(data.types).map(([key,name])=>'<option value="'+key+'" '+(key===m.type?'selected':'')+'>'+name+'</option>').join('')}</select><label class="formlabel" for="cfg-title">模块标题</label><input class="field" id="cfg-title" required maxlength="30" value="${esc(m.title)}"><div id="cfg-fields">${fields(m.type,m.config)}</div><div class="dialog-actions"><button class="primary" type="submit">保存模块</button><button class="secondary" type="button" id="module-cancel">取消</button></div><div class="msg" id="module-msg" role="status"></div></form>`);
    $('module-cancel').onclick=closeDialog;
    $('cfg-type').onchange=()=>{const type=$('cfg-type').value;$('cfg-fields').innerHTML=fields(type,structuredClone(defaultConfig[type]));$('cfg-title').value=data.types[type];};
    $('module-form').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('[type=submit]');button.disabled=true;try{await api('/api/modules/save',{scope:editingScope,module:{id,type:$('cfg-type').value,title:$('cfg-title').value,config:collect($('cfg-type').value)}});closeDialog();await refresh();notify('模块已保存。');}catch(err){$('module-msg').textContent=err.message;button.disabled=false;}};
  }
  function manager(){
    if(!data)return;
    setDialog('modules',`<h2 id="dialog-title">模块设置</h2><p>${esc(context())} · 选择一张卡片，设置它关注的内容。</p><div class="module-picker"><button data-character="true"><b>简报助手</b><small>角色与动作</small></button>${data.modules.map(m=>'<button data-edit="'+m.id+'"><b>'+esc(m.title)+'</b><small>'+labelTypes[m.type]+'</small></button>').join('')}</div>`);
    $('dialog-body').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>edit(b.dataset.edit));
    $('dialog-body').querySelector('[data-character]').onclick=character;
  }
  function character(){
    if(!data)return;const editingScope=scope;
    setDialog('character',`<h2 id="dialog-title">简报助手</h2><p>选择 LivLiv 角色，支持眨眼、呼吸、表情与点头。</p><form id="character-form"><div class="character-choices">${data.characters.map(c=>'<label><input type="radio" name="character" value="'+c.id+'" '+(data.character===c.id?'checked':'')+'><img src="/vendor/livliv/characters/'+c.id+'/avatar.webp" alt=""><span>'+c.name+'</span></label>').join('')}</div><div class="dialog-actions"><button class="primary" type="submit">保存角色</button><a class="secondary" href="/vendor/livliv/example/gallery.html" target="_blank" rel="noopener">打开角色画廊</a></div><p class="formhint">角色：LivLiv（livliv.ai）。<a href="/vendor/livliv/characters/LICENSE.md" target="_blank">查看角色许可</a></p><div class="msg" id="character-msg"></div></form>`);
    $('character-form').onsubmit=async e=>{e.preventDefault();try{await api('/api/modules/character',{scope:editingScope,character:new FormData(e.target).get('character')});closeDialog();await refresh();}catch(err){$('character-msg').textContent=err.message;}};
  }
  function calendar(id){
    calendarDraft=id;const editingScope=scope;
    const events=[...data.events].sort((a,b)=>a.startAt.localeCompare(b.startAt));
    setDialog('calendar',`<h2 id="dialog-title">管理日程</h2><p>${esc(context())}的本地日历。导入的事项会保存在本机。</p><div class="calendar-import"><label class="secondary">导入 ICS<input id="ics-file" type="file" accept=".ics,text/calendar" hidden></label><span>导入未来 90 天，支持重复日程</span></div><form id="event-form"><label class="formlabel" for="event-title">日程标题</label><input class="field" id="event-title" required maxlength="100" placeholder="例如 产品评审"><div class="event-time-fields"><div><label class="formlabel" for="event-start">开始时间</label><input class="field" id="event-start" type="datetime-local" required></div><div><label class="formlabel" for="event-end">结束时间</label><input class="field" id="event-end" type="datetime-local" required></div></div><label class="formlabel" for="event-location">地点</label><input class="field" id="event-location" maxlength="100" placeholder="会议室或线上"><div class="dialog-actions"><button class="primary" type="submit">添加日程</button></div></form><div class="msg" id="calendar-msg" role="status"></div><ul class="calendar-events">${events.map(e=>'<li><div><b>'+esc(e.title)+'</b><span>'+esc(stamp(e.startAt))+' — '+esc(stamp(e.endAt))+(e.location?' · '+esc(e.location):'')+'</span></div><button class="textbtn" data-delete-event="'+esc(e.id)+'" aria-label="删除'+esc(e.title)+'">删除</button></li>').join('')||'<li>还没有日程，添加或导入后即可显示在大屏上。</li>'}</ul>`);
    $('event-form').onsubmit=async e=>{e.preventDefault();try{await api('/api/modules/event',{scope:editingScope,event:{title:$('event-title').value,startAt:new Date($('event-start').value).toISOString(),endAt:new Date($('event-end').value).toISOString(),location:$('event-location').value}});await refresh();calendar(id);notify('日程已添加。');}catch(err){$('calendar-msg').textContent=err.message;}};
    $('ics-file').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>450000)throw Error('请选择小于 450 KB 的 ICS 文件。');const result=await api('/api/modules/import',{scope:editingScope,ics:await file.text()});await refresh();calendar(id);notify('已导入 '+result.count+' 条日程。');}catch(err){$('calendar-msg').textContent=err.message;}};
    $('dialog-body').querySelectorAll('[data-delete-event]').forEach(b=>b.onclick=async()=>{try{await api('/api/modules/event',{scope:editingScope,action:'delete',id:b.dataset.deleteEvent});await refresh();calendar(id);}catch(err){$('calendar-msg').textContent=err.message;}});
  }
  $('modules-settings').onclick=manager;$('character-settings').onclick=character;
  return {update(nextScope,nextWall,nextProfile){wall=nextWall;profile=nextProfile;if(nextScope!==scope){scope=nextScope;data=null;last='';pending=false;}if(!pending)void refresh();},refresh,manager};
}

