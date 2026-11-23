export function distance(a,b) {
  if (a?.length !== 128 || b?.length !== 128) return Infinity;
  return Math.sqrt(a.reduce((sum,v,i) => sum+(v-b[i])**2,0));
}
export function rank(face, templates) {
  return Object.entries(templates).filter(([,samples]) => samples?.length)
    .map(([id,samples]) => ({ id, score: samples.reduce((s,v) => s+distance(v,face),0)/samples.length }))
    .sort((a,b)=>a.score-b.score);
}
export function identify(face, templates, { threshold = 0.48, margin = 0.07 } = {}) {
  const ranks = rank(face, templates);
  if (!ranks.length || ranks[0].score > threshold || (ranks[1] && ranks[1].score-ranks[0].score < margin)) return null;
  return ranks[0].id;
}

