import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeHand, GestureStateMachine, resolveGestureAction, DEFAULT_GESTURE_SETTINGS,
} from '../public/gesture-rules.js';

const hand = points => Array.from({ length: 21 }, (_, i) => points[i] ?? { x: 0.5, y: 0.75 });
const palm = hand({
  0:{x:.5,y:.8}, 1:{x:.42,y:.74}, 2:{x:.32,y:.68}, 3:{x:.26,y:.62}, 4:{x:.16,y:.54},
  5:{x:.44,y:.64}, 6:{x:.44,y:.53}, 7:{x:.44,y:.46}, 8:{x:.44,y:.38},
  9:{x:.50,y:.62}, 10:{x:.50,y:.50}, 11:{x:.50,y:.42}, 12:{x:.50,y:.34},
  13:{x:.56,y:.64}, 14:{x:.56,y:.53}, 15:{x:.56,y:.46}, 16:{x:.56,y:.38},
  17:{x:.62,y:.66}, 18:{x:.62,y:.56}, 19:{x:.62,y:.50}, 20:{x:.62,y:.42},
});
const fist = hand({
  0:{x:.5,y:.8}, 1:{x:.45,y:.74}, 2:{x:.48,y:.70}, 3:{x:.50,y:.68}, 4:{x:.53,y:.69},
  5:{x:.44,y:.64}, 6:{x:.44,y:.54}, 7:{x:.46,y:.62}, 8:{x:.47,y:.68},
  9:{x:.50,y:.62}, 10:{x:.50,y:.52}, 11:{x:.51,y:.60}, 12:{x:.52,y:.67},
  13:{x:.56,y:.64}, 14:{x:.56,y:.55}, 15:{x:.55,y:.62}, 16:{x:.54,y:.68},
  17:{x:.61,y:.66}, 18:{x:.61,y:.58}, 19:{x:.60,y:.64}, 20:{x:.59,y:.69},
});
const thumbsUp = hand({
  0:{x:.5,y:.8}, 1:{x:.46,y:.74}, 2:{x:.47,y:.62}, 3:{x:.48,y:.54}, 4:{x:.49,y:.40},
  5:{x:.44,y:.64}, 6:{x:.44,y:.54}, 7:{x:.46,y:.62}, 8:{x:.47,y:.68},
  9:{x:.50,y:.62}, 10:{x:.50,y:.52}, 11:{x:.51,y:.60}, 12:{x:.52,y:.67},
  13:{x:.56,y:.64}, 14:{x:.56,y:.55}, 15:{x:.55,y:.62}, 16:{x:.54,y:.68},
  17:{x:.61,y:.66}, 18:{x:.61,y:.58}, 19:{x:.60,y:.64}, 20:{x:.59,y:.69},
});

test('classifies open palm, fist and thumbs up', () => {
  assert.equal(analyzeHand(palm).pose, 'openPalm');
  assert.deepEqual(analyzeHand(palm).extended, [true, true, true, true, true]);
  assert.equal(analyzeHand(fist).pose, 'fist');
  assert.equal(analyzeHand(thumbsUp).pose, 'thumbsUp');
});
test('rejects malformed landmarks without throwing', () => {
  for (const bad of [[], Array(21).fill({ x: NaN, y: NaN }), Array(21).fill({ x: 0, y: 0 })])
    assert.equal(analyzeHand(bad).pose, null);
});
test('holds openPalm for holdMs before emitting', () => {
  const sm = new GestureStateMachine({ stableFrames: 2, holdMs: 200 });
  const frame = at => ({ pose: 'openPalm', confidence: 0.9, palmX: 0.5, hand: 'Right', at });
  assert.equal(sm.push(frame(0)).length, 0);
  assert.equal(sm.push(frame(80)).length, 0);
  assert.equal(sm.push(frame(160)).length, 0);
  const events = sm.push(frame(240));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'openPalm');
});
test('moving palm does not emit openPalm', () => {
  const sm = new GestureStateMachine({ stableFrames: 2, holdMs: 200 });
  const xs = [0.3, 0.4, 0.5, 0.6];
  const events = xs.flatMap((palmX, i) => sm.push({ pose: 'openPalm', confidence: 0.9, palmX, hand: 'Right', at: i * 80 }));
  assert.equal(events.some(e => e.type === 'openPalm'), false);
});
test('wave takes precedence over openPalm and suppresses it', () => {
  const sm = new GestureStateMachine({ stableFrames: 2, cooldownMs: 0, waveWindowMs: 1200 });
  const xs = [0.5, 0.62, 0.5, 0.62, 0.5];
  const events = xs.flatMap((palmX, i) => sm.push({ pose: 'openPalm', confidence: 0.9, palmX, hand: 'Right', at: i * 80 }));
  assert.equal(events.some(e => e.type === 'wave'), true);
  assert.equal(events.some(e => e.type === 'openPalm'), false);
  sm.updateSettings({ stableFrames: 1, holdMs: 0 });
  assert.equal(sm.push({ pose: 'openPalm', confidence: 0.9, palmX: 0.5, hand: 'Right', at: 480 }).length, 0);
  assert.deepEqual(
    sm.push({ pose: 'openPalm', confidence: 0.9, palmX: 0.5, hand: 'Right', at: 800 }).map(e => e.type),
    ['openPalm'],
  );
});
test('cooldown blocks repeated events', () => {
  const sm = new GestureStateMachine({ stableFrames: 1, holdMs: 0, cooldownMs: 1000 });
  const f = at => ({ pose: 'fist', confidence: 0.9, palmX: 0.5, hand: 'Right', at });
  assert.equal(sm.push(f(0)).length, 1);
  assert.equal(sm.push(f(200)).length, 0);
  assert.equal(sm.push(f(1200)).length, 1);
});
test('resolveGestureAction applies context guards', () => {
  const evt = type => ({ type, confidence: 0.9, at: 0, hand: 'Right' });
  const base = { enabled: true, dialog: '', candidateVia: null, personalVia: null, faceActive: true };
  assert.equal(resolveGestureAction(evt('wave'), { ...base, faceActive: false }), 'resumeFace');
  assert.equal(resolveGestureAction(evt('openPalm'), { ...base, dialog: 'confirm', candidateVia: 'camera' }), 'confirm');
  assert.equal(resolveGestureAction(evt('openPalm'), base), null);
  assert.equal(resolveGestureAction(evt('fist'), { ...base, dialog: 'confirm', candidateVia: 'camera' }), 'cancel');
  assert.equal(resolveGestureAction(evt('fist'), { ...base, personalVia: 'camera' }), 'home');
  assert.equal(resolveGestureAction(evt('wave'), { ...base, personalVia: 'manual' }), 'home');
  assert.equal(resolveGestureAction(evt('thumbsUp'), base), 'greet');
  assert.equal(resolveGestureAction(evt('thumbsUp'), { ...base, enabled: false }), null);
});
