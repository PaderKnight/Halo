import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMeshSegments, buildMeshTriangles, drawFaceMesh } from '../public/facemesh.js';

const square = [
  { x: 0.0, y: 0.0 }, { x: 0.5, y: 0.0 },
  { x: 0.5, y: 0.5 }, { x: 0.0, y: 0.5 },
];
const squareEdges = [
  { start: 0, end: 1 }, { start: 1, end: 2 },
  { start: 2, end: 3 }, { start: 3, end: 0 },
  { start: 0, end: 2 },
];

test('buildMeshSegments maps connections to point pairs', () => {
  const segments = buildMeshSegments(square, squareEdges);
  assert.equal(segments.length, 5);
  assert.deepEqual(segments[0], { a: { x: 0, y: 0 }, b: { x: 0.5, y: 0 } });
});

test('buildMeshSegments skips invalid coordinates and out-of-range indices', () => {
  const points = [...square, { x: NaN, y: 0.1 }];
  const edges = [{ start: 0, end: 1 }, { start: 0, end: 4 }, { start: 0, end: 99 }];
  assert.equal(buildMeshSegments(points, edges).length, 1);
});

test('buildMeshSegments returns empty for missing input', () => {
  assert.deepEqual(buildMeshSegments([], squareEdges), []);
  assert.deepEqual(buildMeshSegments(square, []), []);
});

test('buildMeshTriangles derives unique triangles from edges', () => {
  const triangles = buildMeshTriangles(squareEdges);
  assert.deepEqual(triangles.map(t => t.join(',')).sort(), ['0,1,2', '0,2,3']);
});

test('buildMeshTriangles ignores open paths', () => {
  assert.deepEqual(buildMeshTriangles([{ start: 0, end: 1 }, { start: 1, end: 2 }]), []);
});

test('drawFaceMesh strokes one path per face and fills triangles', () => {
  const calls = [];
  const context = {
    set globalAlpha(v) { calls.push(['alpha', v]); },
    set strokeStyle(v) { calls.push(['strokeStyle', v]); },
    set fillStyle(v) { calls.push(['fillStyle', v]); },
    set lineWidth(v) { calls.push(['lineWidth', v]); },
    beginPath() { calls.push(['beginPath']); },
    moveTo(x, y) { calls.push(['moveTo', x, y]); },
    lineTo(x, y) { calls.push(['lineTo', x, y]); },
    closePath() { calls.push(['closePath']); },
    stroke() { calls.push(['stroke']); },
    fill() { calls.push(['fill']); },
    save() { calls.push(['save']); },
    restore() { calls.push(['restore']); },
  };
  const count = drawFaceMesh(context, [{ landmarks: square }], {
    connections: squareEdges, width: 100, height: 100,
  });
  assert.equal(count, 5);
  assert.ok(calls.some(([name]) => name === 'stroke'));
  assert.ok(calls.some(([name]) => name === 'fill'));
  assert.ok(calls.some(([name, v]) => name === 'moveTo' && v === 50));
});

test('drawFaceMesh skips zero-size frames', () => {
  const context = { beginPath() { throw Error('should not draw'); } };
  assert.equal(drawFaceMesh(context, [{ landmarks: square }], {
    connections: squareEdges, width: 0, height: 0,
  }), 0);
});
