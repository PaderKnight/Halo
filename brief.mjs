export const catalog = [
  { repo: 'ollama/ollama', label: 'Ollama', group: '本地 AI', note: '在自己的电脑上运行和管理大模型。' },
  { repo: 'ggml-org/llama.cpp', label: 'llama.cpp', group: '本地 AI', note: '面向本地设备的大模型推理引擎。' },
  { repo: 'ml-explore/mlx', label: 'MLX', group: '本地 AI', note: '看看 Apple 芯片上的模型计算框架有何进展。' },
  { repo: 'ml-explore/mlx-swift', label: 'MLX Swift', group: '本地 AI', note: '用 Swift 把端侧模型集成到 Mac 应用里。' },
  { repo: 'ggml-org/whisper.cpp', label: 'whisper.cpp', group: '本地 AI', note: '同样在本机运行，把语音转成文字。' },
  { repo: 'vitejs/vite', label: 'Vite', group: '前端开发', note: '跟进前端开发服务器与构建工具的变化。' },
  { repo: 'sveltejs/svelte', label: 'Svelte', group: '前端开发', note: '了解编译型前端框架的开发进展。' },
  { repo: 'vuejs/core', label: 'Vue', group: '前端开发', note: '关注 Vue 的响应式系统与组件更新。' }
];
const byRepo = new Map(catalog.map(s => [s.repo, s]));
export const publicRepos = catalog.map(s => s.repo);
export const source = repo => byRepo.get(repo) || { repo, label: repo.split('/')[1], group: '自选项目', note: '来自你添加的公开项目。' };
export const defaultProfile = { id: 'demo', name: '示例成员', repos: ['ollama/ollama','ggml-org/llama.cpp'] };

export function validateProfile(input) {
  if (typeof input?.name !== 'string' || !Array.from(input.name.trim()).length || Array.from(input.name.trim()).length > 20)
    throw Error('请输入 1 至 20 个字的成员名字。');
  if (!Array.isArray(input.repos) || input.repos.length > 8) throw Error('最多选择 8 个项目。');
  const repos = input.repos.map(s => typeof s === 'string' ? s.trim().toLowerCase() : '');
  if (repos.some(s => !/^[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9._-]{1,100}$/.test(s) || ['.', '..'].includes(s.split('/')[1])))
    throw Error('项目请按 owner/repo 格式填写。');
  return { name: input.name.trim(), repos: [...new Set(repos)] };
}

export function localDate(d) {
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
}
export function editionDay(now) {
  const d = new Date(now);
  if (d.getHours() < 7) d.setDate(d.getDate()-1);
  return localDate(d);
}
export function due(entry, now) {
  if (!entry?.attemptedAt) return true;
  if (entry.error) return now - Date.parse(entry.attemptedAt) >= 3600000;
  return editionDay(now) !== editionDay(entry.attemptedAt);
}

function excerpt(body) {
  const lines = String(body || '').replace(/<!--[\s\S]*?-->/g,'').split(/\r?\n/);
  for (let line of lines) {
    line = line.replace(/<[^>]+>/g,'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[*_\x60]/g,'').replace(/^\s*[-+]\s*/,'').trim();
    if (line.length < 14 || /^(#|https?:|!\[|\||assisted-by:|full changelog|new contributors|what.s (new|changed)|website:|changelog|download |macos apple silicon|release notes)/i.test(line)) continue;
    return line.replace(/\s+by @\S+ in https?:\/\/\S+/g,'').replace(/https?:\/\/\S+/g,'').trim().slice(0,210);
  }
  return '';
}
async function fetchReleases(repo, fetcher = fetch) {
  const response = await fetcher('https://api.github.com/repos/' + repo + '/releases?per_page=5', {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'morning-brief-wall' },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw Error('GitHub HTTP ' + response.status);
  const data = await response.json();
  if (!Array.isArray(data)) throw Error('GitHub 返回格式异常');
  return data.filter(r => !r.draft && r.tag_name && Number.isFinite(Date.parse(r.published_at)))
    .map(r => ({
      title: String(r.name || r.tag_name).slice(0,120), tag: r.tag_name,
      prerelease: !!r.prerelease, publishedAt: r.published_at, detail: excerpt(r.body),
      url: 'https://github.com/' + repo + '/releases/tag/' + encodeURIComponent(r.tag_name)
    })).sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)).slice(0,5);
}

export async function refreshEntry(repo, previous, now, fetcher) {
  const attemptedAt = now.toISOString();
  try {
    const history = await fetchReleases(repo, fetcher);
    return { item: history[0] || null, history, checkedAt: attemptedAt, attemptedAt, error: null };
  } catch (err) {
    return { ...previous, attemptedAt, error: String(err.message).slice(0,100) };
  }
}
export function makeBrief(profile, feeds, day) {
  const items = profile.repos.map(repo => ({ ...source(repo), ...feeds[repo] }))
    .sort((a,b) => (b.item?.publishedAt || '').localeCompare(a.item?.publishedAt || ''));
  const groups = new Set(items.map(s => s.group));
  const eligible = catalog.filter(s => !profile.repos.includes(s.repo) && feeds[s.repo]?.item);
  const related = eligible.filter(s => groups.has(s.group));
  const pool = related.length ? related : eligible;
  const idSum = Array.from(profile.id).reduce((n,c) => n + c.codePointAt(0),0);
  const index = Math.floor(Date.parse(day + 'T12:00:00Z')/86400000) + idSum;
  const pick = pool.length ? pool[index % pool.length] : null;
  return { day, items, discovery: pick && { ...pick, ...feeds[pick.repo], related: !!related.length } };
}

