import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_POINTER_MAP, mapToScreen, solveAffine, isCalibrationCurrent,
  calibrationWindow, pointerContextAllowed, PointerController, DwellFistGuard,
} from '../public/pointer-rules.js';

test('default mapping mirrors raw coordinates and clamps to the screen', () => {
  const mid = mapToScreen({ x: 0.5, y: 0.5 });
  assert.ok(Math.abs(mid.x - 0.5) < 1e-9);
  assert.ok(Math.abs(mid.y - 0.4666666666666667) < 1e-9);
  assert.ok(mapToScreen({ x: 0.2, y: 0.5 }).x > 0.9);
  assert.ok(mapToScreen({ x: 0.8, y: 0.5 }).x < 0.1);
  assert.deepEqual(mapToScreen({ x: 2, y: -1 }), { x: 0, y: 0 });
  assert.ok(mapToScreen({ x: 0.2, y: 0.5 }, null, false).x < 0.1);
});

test('affine calibration restores a known transform on mirrored input', () => {
  const expected = { a: 0.6, b: 0.1, c: 0.2, d: 0.05, e: 0.7, f: 0.1 };
  const pairs = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]].map(([rawX, rawY]) => {
    const mx = 1 - rawX;
    return {
      rawX, rawY,
      screenX: expected.a * mx + expected.b * rawY + expected.c,
      screenY: expected.d * mx + expected.e * rawY + expected.f,
    };
  });
  const cal = solveAffine(pairs, true);
  assert.ok(cal);
  for (const key of Object.keys(expected)) assert.ok(Math.abs(cal[key] - expected[key]) < 1e-9);
  const point = mapToScreen({ x: 0.1, y: 0.1 }, cal, true);
  assert.ok(Math.abs(point.x - pairs[0].screenX) < 1e-9);
  assert.ok(Math.abs(point.y - pairs[0].screenY) < 1e-9);
});

test('degenerate calibration returns null', () => {
  const same = { rawX: 0.5, rawY: 0.5, screenX: 0.5, screenY: 0.5 };
  assert.equal(solveAffine([same, same, same, same], true), null);
});

test('calibration validity compares camera fingerprint', () => {
  assert.equal(isCalibrationCurrent({ device: 'a', size: '1280x720' }, { device: 'a', size: '1280x720' }), true);
  assert.equal(isCalibrationCurrent({ device: 'a', size: '1280x720' }, { device: 'b', size: '1280x720' }), false);
  assert.equal(isCalibrationCurrent(null, { device: '', size: '1280x720' }), false);
});

test('pointer context is limited to the wall and info window', () => {
  assert.equal(pointerContextAllowed({ dialog: '', enabled: true, streaming: true }), true);
  assert.equal(pointerContextAllowed({ dialog: 'info', enabled: true, streaming: true }), true);
  assert.equal(pointerContextAllowed({ dialog: 'settings', enabled: true, streaming: true }), false);
  assert.equal(pointerContextAllowed({ dialog: 'confirm', enabled: true, streaming: true }), false);
  assert.equal(pointerContextAllowed({ dialog: '', enabled: false, streaming: true }), false);
  assert.equal(pointerContextAllowed({ dialog: '', enabled: true, streaming: false }), false);
});

const settings = { pointerDwellMs: 100, pointerSmoothing: 1, pointerLostMs: 100, pointerCooldownMs: 200 };
const target = { key: 'card:m1', inside: true };

test('dwell clicks once on a stable target', () => {
  const p = new PointerController({ settings });
  assert.equal(p.update({ x: .5, y: .5, active: true, at: 0, target }).click, false);
  assert.equal(p.update({ x: .5, y: .5, active: true, at: 60, target }).click, false);
  assert.equal(p.update({ x: .5, y: .5, active: true, at: 110, target }).click, true);
  assert.equal(p.update({ x: .5, y: .5, active: true, at: 120, target }).click, false);
  assert.equal(p.update({ x: .5, y: .5, active: true, at: 300, target }).click, false);
  assert.equal(p.update({ x: .5, y: .5, active: true, at: 420, target }).click, true);
});

test('changing or leaving the target resets dwell', () => {
  const p = new PointerController({ settings });
  p.update({ x: .5, y: .5, active: true, at: 0, target });
  const changed = p.update({ x: .5, y: .5, active: true, at: 60, target: { key: 'card:m2', inside: true } });
  assert.equal(changed.progress, 0);
  const left = p.update({ x: .5, y: .5, active: true, at: 120, target: { key: null, inside: false } });
  assert.equal(left.progress, 0);
  assert.equal(left.click, false);
});

test('inactive hand keeps the last position then hides', () => {
  const p = new PointerController({ settings });
  p.update({ x: .5, y: .5, active: true, at: 0, target });
  assert.equal(p.update({ x: .5, y: .5, active: false, at: 50, target: null }).visible, true);
  const hidden = p.update({ x: .5, y: .5, active: false, at: 150, target: null });
  assert.equal(hidden.visible, false);
  assert.equal(hidden.progress, 0);
});

test('smoothing follows the alpha', () => {
  const p = new PointerController({ settings: { ...settings, pointerSmoothing: .5 } });
  const first = p.update({ x: 0, y: 0, active: true, at: 0, target: null });
  assert.deepEqual({ x: first.x, y: first.y }, { x: 0, y: 0 });
  const second = p.update({ x: 1, y: 1, active: true, at: 10, target: null });
  assert.deepEqual({ x: second.x, y: second.y }, { x: .5, y: .5 });
});

test('fist during dwell is consumed after the pointer goes inactive', () => {
  const g = new DwellFistGuard();
  g.frame({ pose: 'point', progress: 0.5, at: 0 });
  g.frame({ pose: 'fist', progress: 0, at: 80 });
  g.frame({ pose: 'fist', progress: 0, at: 680 });
  assert.equal(g.event({ type: 'fist', dialog: '', at: 700 }), true);
  assert.equal(g.event({ type: 'fist', dialog: '', at: 8000 }), false);
});
test('fist without a dwell is not consumed', () => {
  const g = new DwellFistGuard();
  g.frame({ pose: 'fist', progress: 0, at: 0 });
  assert.equal(g.event({ type: 'fist', dialog: '', at: 700 }), false);
});
test('fist in the info dialog is not consumed as a dwell cancel', () => {
  const g = new DwellFistGuard();
  g.frame({ pose: 'point', progress: 0.5, at: 0 });
  g.frame({ pose: 'fist', progress: 0, at: 80 });
  assert.equal(g.event({ type: 'fist', dialog: 'info', at: 700 }), false);
});

test('calibration window ages out pre-corner movement and becomes ready', () => {
  const samples = [
    { x: .1, y: .1, at: 0 }, { x: .5, y: .5, at: 200 }, { x: .5, y: .5, at: 600 },
    { x: .5, y: .5, at: 1000 }, { x: .5, y: .5, at: 1400 }, { x: .5, y: .5, at: 1800 },
  ];
  const state = calibrationWindow(samples, { at: 1800, windowMs: 1200, requiredMs: 800, maxSpread: .05 });
  assert.equal(state.ready, true);
  assert.equal(state.spread, 0);
});
test('calibration window needs three samples and 800ms', () => {
  const at = 800;
  assert.equal(calibrationWindow([{ x: .5, y: .5, at: 800 }], { at, windowMs: 1200 }).ready, false);
  assert.equal(calibrationWindow(
    [{ x: .5, y: .5, at: 0 }, { x: .5, y: .5, at: 800 }], { at, windowMs: 1200 },
  ).ready, false);
});
test('calibration window stays satisfiable at a 1000ms interval', () => {
  const samples = [0, 1000, 2000, 3000].map(t => ({ x: .5, y: .5, at: t }));
  const state = calibrationWindow(samples, { at: 3000, windowMs: 3100, requiredMs: 800, maxSpread: .05 });
  assert.equal(state.ready, true);
});
