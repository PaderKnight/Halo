export const esc = value => String(value ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date = (v,options) => new Intl.DateTimeFormat('zh-CN',options).format(new Date(v));
const shortDate = v => date(v,{month:'numeric',day:'numeric'});
const flavor = item => item.prerelease ? '预发布' : '正式版';
function dayKey(d) { return [d.getFullYear(),d.getMonth()+1,d.getDate()].join('-'); }
function link(item, label, className='') {
  return `<a class="${className}" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
}
function version(s,item) {
  const prefix=s.label.toLowerCase()+'@';
  return item.tag.toLowerCase().startsWith(prefix) ? item.tag.slice(prefix.length) : item.tag;
}
function availability(s) {
  if(s.error) return s.checkedAt?'上次成功读取 '+shortDate(s.checkedAt):'来源暂时不可用';
  return s.checkedAt?'暂无公开发布':'等待首次整理';
}
export function collectReleases(sources) {
  const unique=new Map();
  for(const s of sources) {
    const releases=[s.item,...(s.history || [])].filter(Boolean);
    for(const item of releases) {
      if(!unique.has(item.url)) unique.set(item.url,{source:s,item,latest:item.url===s.item?.url});
    }
  }
  return [...unique.values()].sort((a,b)=>Date.parse(b.item.publishedAt)-Date.parse(a.item.publishedAt));
}
export function weekCounts(records, now = new Date()) {
  const buckets=Array.from({length:7},(_,i)=>{
    const d=new Date(now.getFullYear(),now.getMonth(),now.getDate()-6+i);
    return {key:dayKey(d),label:shortDate(d),count:0};
  });
  for (const {item} of records) {
    const bucket=buckets.find(d=>d.key===dayKey(new Date(item.publishedAt)));
    if(bucket) bucket.count++;
  }
  return buckets;
}
export function focusCard(s) {
  if(!s?.item) return '<div class="lead-inner"><h2>本期重点</h2><p>正在等待来源发布内容。</p></div>';
  const item=s.item, headline=item.headline || s.label+' 发布 '+version(s,item);
  const summary=item.detailZh || item.detail || s.note;
  return `<div class="lead-inner"><div class="lead-kicker"><i></i>最新发布</div><h2>${link(item,headline)}</h2><p>${esc(summary)}</p><div class="lead-meta"><span>${esc(s.label)} <b>${esc(version(s,item))}</b></span><time>${esc(shortDate(item.publishedAt))} 发布${s.error?' · 缓存':''}</time></div></div>`;
}
export function chartCard(buckets) {
  const total=buckets.reduce((n,b)=>n+b.count,0);
  const max=Math.max(...buckets.map(b=>b.count),1);
  const bars=buckets.map((b,i)=>`<button class="bar ${i===6?'today':''}" data-day="${b.key}" aria-label="${esc(b.label)}收录 ${b.count} 条发布，查看记录"><span class="stick"><i style="--bar:${b.count/max*100}%"></i></span><strong>${b.count}</strong><span class="bar-label">${i===6?'今天':esc(b.label)}</span></button>`).join('');
  return `<div class="panel-head"><h2>近七日发布</h2><span>${total} 条收录</span></div><div class="bars">${bars}</div><div class="chart-note">统计当前项目，每个项目取最近 5 条</div>`;
}
function story(s,expanded) {
  const item=s.item;
  const description=item?.detailZh || item?.detail || (item?s.note:availability(s));
  const meta=item ? `<span class="version">${esc(version(s,item))}</span><time>${esc(shortDate(item.publishedAt))}</time>` : '';
  const earlier=expanded ? (s.history || []).filter(r=>r.url!==item?.url).slice(0,2) : [];
  const notes=earlier.map(r=>`<li><div>${link(r,version(s,r))}<time>${esc(shortDate(r.publishedAt))}</time></div>${r.detail?'<p>'+esc(r.detail)+'</p>':''}</li>`).join('');
  return `<article class="story module" data-module="project:${esc(s.repo)}"><div class="project-group">${esc(s.group)}<span>${item?flavor(item):'等待更新'}</span></div><div class="story-head"><span class="source-mark" aria-hidden="true">${esc(s.label.slice(0,1))}</span><h4>${item?link(item,s.label):esc(s.label)}</h4>${meta}</div><p title="${esc(description)}">${esc(description)}</p>${s.error && item?'<small class="stale">'+esc(availability(s))+'</small>':''}${notes?'<div class="previous">此前版本要点</div><ul class="source-history">'+notes+'</ul>':''}</article>`;
}
export function topicPanels(sources) {
  const groups=new Map();
  for(const s of sources) { if(!groups.has(s.group)) groups.set(s.group,[]);groups.get(s.group).push(s); }
  const order=['本地 AI','前端开发','自选项目'];
  return [...groups].sort(([a],[b])=>order.indexOf(a)-order.indexOf(b)).map(([name,items])=>`<section class="topic ${name==='前端开发'?'web':name==='本地 AI'?'ai':'custom'}"><div class="topic-head"><h3><i></i>${esc(name)}</h3><span>${items.length} 个项目</span></div><div class="topic-rows">${items.map(s=>story(s,groups.size===1 && items.length<=2)).join('')}</div></section>`).join('');
}
export function timelineRows(records) {
  return records.map(({source:s,item})=>`<li><time datetime="${esc(item.publishedAt)}">${esc(shortDate(item.publishedAt))}</time><div><h4>${link(item,s.label+' '+version(s,item))}</h4><span>${esc(s.group)} · ${flavor(item)}</span></div></li>`).join('');
}
export function timelineCard(records) {
  const older=records.filter(r=>!r.latest);
  const seen=new Map();
  const visible=older.filter(({source})=>{
    const count=seen.get(source.repo)||0;
    seen.set(source.repo,count+1);
    return count<2;
  }).slice(0,4);
  return `<div class="panel-head"><h3>早前发布</h3><button id="all-records" class="textbtn">全部记录</button></div>${visible.length?'<ol class="timeline">'+timelineRows(visible)+'</ol>':'<p class="empty">尚未收录更早版本。</p>'}`;
}
export function recordsOnDay(records,key) { return records.filter(r=>dayKey(new Date(r.item.publishedAt))===key); }


export function insightPanels(sources,records,days) {
  const keys=new Set(days.map(d=>d.key));
  const counts=new Map();
  for(const r of records) if(keys.has(dayKey(new Date(r.item.publishedAt)))) counts.set(r.source.repo,(counts.get(r.source.repo)||0)+1);
  const active=sources.filter(s=>counts.has(s.repo)).sort((a,b)=>counts.get(b.repo)-counts.get(a.repo)).slice(0,3);
  const max=Math.max(1,...counts.values());
  const ranking=active.map(s=>`<li><span>${esc(s.label)}</span><i><b style="width:${counts.get(s.repo)/max*100}%"></b></i><strong>${counts.get(s.repo)} 条</strong></li>`).join('');
  function releases(preview) {
    const seen=new Set();
    return records.filter(r=>Boolean(r.item.prerelease)===preview && !seen.has(r.source.repo) && seen.add(r.source.repo)).slice(0,2)
      .map(({source:s,item})=>`<li><div>${link(item,s.label)}<time>${esc(shortDate(item.publishedAt))}</time></div><span>${esc(version(s,item))}</span></li>`).join('');
  }
  const stable=releases(false), previews=releases(true);
  const ready=sources.filter(s=>s.checkedAt&&!s.error).length;
  const failed=sources.filter(s=>s.error).length;
  const waiting=sources.length-ready-failed;
  return `<section class="panel insight module" data-module="ranking"><div class="panel-head"><h2>本周活跃项目</h2><button class="textbtn" data-release-kind="week">查看记录</button></div>${ranking?'<ol class="ranking">'+ranking+'</ol>':'<p class="insight-empty">近七日暂无收录的发布</p>'}<p class="insight-foot">按当前收录的发布次数</p></section>
  <section class="panel insight module" data-module="stable"><div class="panel-head"><h2>最新正式版</h2><button class="textbtn" data-release-kind="stable">查看全部</button></div>${stable?'<ul class="release-picks">'+stable+'</ul>':'<p class="insight-empty">尚未收录正式版本</p>'}</section>
  <section class="panel insight module" data-module="preview"><div class="panel-head"><h2>测试版追踪</h2><button class="textbtn" data-release-kind="preview">查看全部</button></div>${previews?'<ul class="release-picks">'+previews+'</ul>':'<p class="insight-empty">尚未收录测试版本</p>'}</section>
  <section class="panel insight module" data-module="health"><div class="panel-head"><h2>来源状态</h2><span>${failed?'有来源待重试':waiting?'等待整理':'已完成整理'}</span></div><div class="source-score"><strong>${ready}</strong><span>/ ${sources.length} 个来源正常</span></div><div class="source-meter" aria-hidden="true">${sources.map(s=>`<i class="${s.error?'failed':s.checkedAt?'ready':'waiting'}"></i>`).join('')}</div><p class="insight-foot">${failed?failed+' 个来源待重试，保留上次记录':waiting?waiting+' 个来源等待首次整理':'所有来源已成功读取'}</p></section>`;
}
