import test from 'node:test';
import assert from 'node:assert/strict';
import { rank, identify } from '../public/match.js';

const vec = d => [d, ...Array(127).fill(0)];
const templates = { a: [vec(0.20)], b: [vec(0.60)], empty: [] };

test('rank sorts known members by distance and skips empty banks', () => {
  assert.deepEqual(rank(vec(0), templates).map(r => [r.id, r.score]), [['a', 0.2], ['b', 0.6]]);
});
test('identify keeps default threshold and margin', () => {
  assert.equal(identify(vec(0), templates), 'a');
  assert.equal(identify(vec(0), { a: [vec(0.55)] }), null);
  assert.equal(identify(vec(0), { a: [vec(0.20)], b: [vec(0.24)] }), null); // 差距 0.04 < 0.07
});
test('identify accepts tuning overrides', () => {
  assert.equal(identify(vec(0), templates, { threshold: 0.7, margin: 0.1 }), 'a');
  assert.equal(identify(vec(0), { a: [vec(0.20)], b: [vec(0.24)] }, { margin: 0.03 }), 'a');
});
