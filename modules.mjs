import fs from 'node:fs';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import ICAL from 'ical.js';

export const newsSources = {
  headlines:{label:'即时热点',file:'scroll-news'},world:{label:'国际',file:'world'},
  finance:{label:'财经',file:'finance'},culture:{label:'文化文娱',file:'culture'},
  sports:{label:'体育',file:'sports'},life:{label:'生活',file:'life'},society:{label:'社会',file:'society'}
};
export const characters=[{id:'d02',name:'Leo'},{id:'k01',name:'Sena'},{id:'k02',name:'Elio'},{id:'s01',name:'Hana'}];
export const moduleTypes={weather:'当前天气',forecast:'三日天气',agenda:'日程',news:'新闻订阅',project:'技术项目',clock:'世界时钟',countdown:'倒计时',notes:'便签清单',links:'常用链接'};
export function defaultModules() {
  const defs=[
    ['weather','杭州天气',{city:'杭州'}],['agenda','今日日程',{days:1,keyword:''}],
    ['news','热点新闻',{source:'headlines',keyword:''}],['news','世界正在发生',{source:'world',keyword:''}],
    ['news','财经速递',{source:'finance',keyword:''}],['forecast','未来三天天气',{city:'杭州'}],
    ['agenda','近期安排',{days:7,keyword:''}],['news','文化与娱乐',{source:'culture',keyword:''}],
    ['news','体育快讯',{source:'sports',keyword:''}],['news','生活灵感',{source:'life',keyword:''}],
    ['clock','东京时间',{zone:'Asia/Tokyo'}],['countdown','周末倒计时',{target:'weekend'}],
    ['notes','今日关注',{text:''}],['project','开源动态',{repo:'ollama/ollama'}],
    ['links','常用入口',{links:[{label:'杭州发布',url:'https://www.hangzhou.gov.cn/'},{label:'中国新闻网',url:'https://www.chinanews.com.cn/'},{label:'角色画廊',url:'/vendor/livliv/example/gallery.html'}]}]
  ];
  return defs.map(([type,title,config],i)=>({id:'m'+(i+1),type,title,config}));
}
const plain=(v,max=120)=>String(v??'').trim().slice(0,max);
export function safeLink(value) {
  try {const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{return '';}
}
export function validateModule(value) {
  if(!/^m([1-9]|1[0-5])$/.test(value?.id)||!moduleTypes[value.type]) throw Error('请选择有效的模块类型。');
  const title=plain(value.title,30);if(!title) throw Error('请填写模块标题。');
  const c=value.config||{},config={};
  if(['weather','forecast'].includes(value.type)) {config.city=plain(c.city,60);if(!config.city)throw Error('请填写城市。');}
  if(value.type==='news') {if(!newsSources[c.source])throw Error('请选择新闻栏目。');config.source=c.source;config.keyword=plain(c.keyword,100);}
  if(value.type==='agenda'){config.days=Number(c.days)===7?7:1;config.keyword=plain(c.keyword,100);}
  if(value.type==='notes') config.text=plain(c.text,1800);
  if(value.type==='clock') {try{if(typeof c.zone!=='string'||!c.zone)throw Error();new Intl.DateTimeFormat('zh-CN',{timeZone:c.zone}).format();}catch{throw Error('时区无效。');}config.zone=c.zone;}
  if(value.type==='countdown'){config.target=c.target==='weekend'?'weekend':plain(c.target,10);if(config.target!=='weekend'&&(!/^\d{4}-\d{2}-\d{2}$/.test(config.target)||!Number.isFinite(Date.parse(config.target+'T00:00:00Z'))||new Date(config.target+'T00:00:00Z').toISOString().slice(0,10)!==config.target))throw Error('请选择有效的目标日期。');}
  if(value.type==='project'){config.repo=plain(c.repo,150).toLowerCase();if(!/^[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9._-]{1,100}$/.test(config.repo)||['.','..'].includes(config.repo.split('/')[1]))throw Error('项目格式为 owner/repo。');}
  if(value.type==='links') {
    if(!Array.isArray(c.links)||c.links.length>8)throw Error('最多设置 8 个链接。');
    config.links=c.links.map(l=>{const url=l.url==='/vendor/livliv/example/gallery.html'?l.url:safeLink(l.url);if(!url||!plain(l.label,40))throw Error('请填写链接名称和有效的 http/https 地址。');return {label:plain(l.label,40),url};});
  }
  return {id:value.id,type:value.type,title,config};
}
export function parseNews(xml) {
  if(/<!DOCTYPE|<!ENTITY/i.test(xml)) throw Error('不支持此新闻源格式。');
  const parser=new XMLParser({ignoreAttributes:false,parseTagValue:false});
  const rows=parser.parse(xml)?.rss?.channel?.item;
  if(!rows)throw Error('新闻源未返回 RSS 条目。');
  return (Array.isArray(rows)?rows:[rows]).slice(0,80).map(r=>({title:plain(r.title,220),url:safeLink(r.link),publishedAt:Number.isFinite(Date.parse(r.pubDate))?new Date(r.pubDate).toISOString():null})).filter(r=>r.title&&r.url);
}
function inZone(t, zone) {
  if(t.zone?.tzid && !['floating','local'].includes(t.zone.tzid)) return t.toJSDate().toISOString();
  const y=t.year,m=t.month,d=t.day,h=t.hour||0,mi=t.minute||0,se=t.second||0;
  let stamp=Date.UTC(y,m-1,d,h,mi,se);
  const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:zone||'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  const desired=stamp;
  for(let i=0;i<2;i++){const parts=Object.fromEntries(formatter.formatToParts(stamp).map(p=>[p.type,p.value]));stamp+=desired-Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour,+parts.minute,+parts.second);}
  return new Date(stamp).toISOString();
}
export function parseCalendar(text,now=new Date()) {
  if(typeof text!=='string'||text.length>450000||!text.includes('BEGIN:VCALENDAR'))throw Error('请选择小于 450 KB 的 ICS 日历文件。');
  const calendar=new ICAL.Component(ICAL.parse(text)),out=[];
  for(const zone of calendar.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(zone.getFirstPropertyValue('tzid'),new ICAL.Timezone({component:zone}));
  const components=calendar.getAllSubcomponents('vevent'),exceptions=components.filter(c=>c.hasProperty('recurrence-id'));
  const floor=now.getTime()-86400000,ceiling=now.getTime()+90*86400000;
  for(const c of components.filter(c=>!c.hasProperty('recurrence-id'))) {
    if(c.getFirstPropertyValue('status')==='CANCELLED')continue;
    const event=new ICAL.Event(c);
    if(!event.startDate)continue;
    for(const ex of exceptions.filter(e=>e.getFirstPropertyValue('uid')===event.uid)) event.relateException(new ICAL.Event(ex));
    const tz=c.getFirstProperty('dtstart')?.getParameter('tzid')||'Asia/Shanghai';
    const append=(start,end,actual=event)=>{
      const startAt=inZone(start,tz),endAt=inZone(end||start,tz);
      if(Date.parse(startAt)>ceiling)return false;
      if(Date.parse(endAt)>=floor&&actual.component.getFirstPropertyValue('status')!=='CANCELLED')out.push({id:'ics-'+event.uid+'-'+startAt,title:plain(actual.summary||'未命名日程',100),startAt,endAt,allDay:!!start.isDate,location:plain(actual.location,100),origin:'ics'});
      return true;
    };
    if(event.isRecurring()){
      const iter=event.iterator();for(let n=0;n<20000&&out.length<500;n++){const next=iter.next();if(!next)break;const detail=event.getOccurrenceDetails(next);if(!append(detail.startDate,detail.endDate,detail.item))break;}
    } else append(event.startDate,event.endDate);
    if(out.length>=500)break;
  }
  return [...new Map(out.map(e=>[e.id,e])).values()].sort((a,b)=>a.startAt.localeCompare(b.startAt));
}
export function validateEvent(e) {
  const title=plain(e.title,100),startAt=new Date(e.startAt),endAt=new Date(e.endAt||e.startAt);
  if(!title||!Number.isFinite(+startAt)||!Number.isFinite(+endAt)||endAt<startAt)throw Error('请填写标题和有效的起止时间。');
  return {id:e.id||crypto.randomUUID(),title,startAt:startAt.toISOString(),endAt:endAt.toISOString(),allDay:!!e.allDay,location:plain(e.location,100),origin:'local'};
}
const aliases={'杭州':'Hangzhou','上海':'Shanghai','北京':'Beijing','深圳':'Shenzhen','广州':'Guangzhou','成都':'Chengdu','南京':'Nanjing','武汉':'Wuhan'};
async function readURL(url,fetcher) {
  const r=await fetcher(url,{headers:{'User-Agent':'MorningBrief/0.2'},signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw Error('来源 HTTP '+r.status);
  let size=0,parts=[];
  for await(const part of r.body){size+=part.length;if(size>1500000)throw Error('来源内容过大。');parts.push(part);}
  return Buffer.concat(parts).toString('utf8');
}
export function createModules(dir,{fetcher=fetch,offline=false}={}) {
  const file=path.join(dir,'modules.json');
  let saved={boards:{},cache:{}};
  if(fs.existsSync(file)) saved={...saved,...JSON.parse(fs.readFileSync(file,'utf8'))};
  const pending=new Set();
  const persist=()=>{fs.writeFileSync(file+'.tmp',JSON.stringify(saved),{mode:0o600});fs.renameSync(file+'.tmp',file);};
  function board(scope,repos) {
    if(!Object.hasOwn(saved.boards,scope)){
      const modules=scope==='public'?defaultModules():structuredClone(board('public').modules);
      if(scope!=='public'&&repos?.length)for(const m of modules)if(m.type==='project')m.config.repo=repos[0];
      saved.boards[scope]={modules,events:[],character:'d02'};persist();
    }
    return saved.boards[scope];
  }
  function key(m) {return m.type==='weather'||m.type==='forecast'?'weather:'+m.config.city:m.type==='news'?'news:'+m.config.source:m.type==='project'?'project:'+m.config.repo:null;}
  async function refreshOne(m,force=false) {
    const k=key(m);if(!k||pending.has(k)||offline)return;
    const old=saved.cache[k],ttl=old?.error?300000:k.startsWith('weather:')?1800000:k.startsWith('news:')?900000:3600000;
    if(!force&&old?.attemptedAt&&Date.now()-Date.parse(old.attemptedAt)<ttl)return;
    pending.add(k);
    try {
      let data;
      if(k.startsWith('weather:')){
        const raw=JSON.parse(await readURL('https://wttr.in/'+encodeURIComponent(aliases[m.config.city]||m.config.city)+'?format=j1&lang=zh-cn',fetcher));
        const c=raw.current_condition?.[0];if(!c||!raw.weather?.length)throw Error('天气来源格式异常');
        data={city:m.config.city,temp:Number(c.temp_C),feels:Number(c.FeelsLikeC),humidity:Number(c.humidity),wind:Number(c.windspeedKmph),code:Number(c.weatherCode),condition:c['lang_zh-cn']?.[0]?.value||c.weatherDesc?.[0]?.value,observation:c.localObsDateTime,days:raw.weather.slice(0,3).map(d=>({date:d.date,max:Number(d.maxtempC),min:Number(d.mintempC),rain:Math.max(...d.hourly.map(h=>Number(h.chanceofrain)||0))})),provider:'wttr.in'};
      } else if(k.startsWith('news:'))data={items:parseNews(await readURL('https://www.chinanews.com.cn/rss/'+newsSources[m.config.source].file+'.xml',fetcher)),provider:'中国新闻网'};
      else {
        const rows=JSON.parse(await readURL('https://api.github.com/repos/'+m.config.repo+'/releases?per_page=3',fetcher));
        if(!Array.isArray(rows))throw Error('项目来源格式异常');
        data={items:rows.filter(r=>!r.draft).slice(0,3).map(r=>({title:plain(r.name||r.tag_name,160),tag:plain(r.tag_name,120),publishedAt:r.published_at,url:safeLink(r.html_url)})),provider:'GitHub'};
      }
      saved.cache[k]={data,checkedAt:new Date().toISOString(),attemptedAt:new Date().toISOString(),error:null};
    }catch{saved.cache[k]={...old,attemptedAt:new Date().toISOString(),error:'来源暂时不可用，将自动重试'};}
    finally{pending.delete(k);persist();}
  }
  async function refresh(force=false) {
    const unique=new Map();for(const b of Object.values(saved.boards))for(const m of b.modules)if(key(m))unique.set(key(m),m);
    const all=[...unique.values()];for(let i=0;i<all.length;i+=3)await Promise.all(all.slice(i,i+3).map(m=>refreshOne(m,force)));
  }
  return {
    get(scope,repos) {
      const b=board(scope,repos);
      for(const m of b.modules)void refreshOne(m);
      return {...b,modules:b.modules.map(m=>({...m,...(saved.cache[key(m)]||{}),loading:pending.has(key(m))})),types:moduleTypes,newsSources,characters};
    },
    update(scope,value) {const b=board(scope);const m=validateModule(value),index=b.modules.findIndex(o=>o.id===m.id);if(index<0)throw Error('模块不存在。');b.modules[index]=m;persist();void refreshOne(m);return m;},
    character(scope,id){if(!characters.some(c=>c.id===id))throw Error('请选择可用角色。');board(scope).character=id;persist();},
    events(scope,values){if(!Array.isArray(values)||values.length>500)throw Error('日程过多。');board(scope).events=values.map(validateEvent);persist();},
    addEvent(scope,value){const b=board(scope),e=validateEvent(value);if(b.events.length>=500)throw Error('最多保留 500 条日程。');b.events.push(e);persist();return e;},
    removeEvent(scope,id){const b=board(scope);b.events=b.events.filter(e=>e.id!==id);persist();},
    importCalendar(scope,text){const b=board(scope),events=parseCalendar(text);b.events=[...new Map([...b.events,...events].map(e=>[e.id,e])).values()].slice(-500);persist();return events.length;},
    refresh
  };
}

