const test = require('node:test');
const assert = require('node:assert/strict');
const SimulationClock = require('../js/simulation-clock.js');

test('updates in fixed-size steps regardless of frame partitioning', () => {
  const a = new SimulationClock({ fixedStepSec: 0.1, maxFrameDeltaSec: 2, maxSubSteps: 30 });
  const b = new SimulationClock({ fixedStepSec: 0.1, maxFrameDeltaSec: 2, maxSubSteps: 30 });
  let stepsA = 0;
  let stepsB = 0;
  for (let i = 0; i < 10; i++) a.advance(0.1, dt => { assert.equal(dt, 0.1); stepsA++; });
  for (let i = 0; i < 100; i++) b.advance(0.01, () => { stepsB++; });
  assert.equal(stepsA, 10);
  assert.equal(stepsB, 10);
  assert.ok(Math.abs(a.accumulatorSec - b.accumulatorSec) < 1e-10);
});

test('clamps long frames and limits catch-up work', () => {
  const clock = new SimulationClock({ fixedStepSec: 0.1, maxFrameDeltaSec: 1, maxSubSteps: 3 });
  let steps = 0;
  const count = clock.advance(5, () => { steps++; });
  assert.equal(count, 3);
  assert.equal(steps, 3);
  assert.ok(clock.droppedTimeSec >= 4.7);
  assert.ok(clock.accumulatorSec < 0.1);
});

test('rejects invalid deltas and callbacks', () => {
  const clock = new SimulationClock();
  assert.throws(() => clock.advance(-1, () => {}), RangeError);
  assert.throws(() => clock.advance(0.1, null), TypeError);
});

test('reset clears accumulated and diagnostic state', () => {
  const clock = new SimulationClock({ fixedStepSec: 0.1 });
  clock.advance(0.05, () => {});
  clock.advance(1, () => {});
  clock.reset();
  assert.equal(clock.accumulatorSec, 0);
  assert.equal(clock.totalSteps, 0);
  assert.equal(clock.droppedTimeSec, 0);
});

test('preserves 10x simulation time at 30 FPS without dropping fixed steps', () => {
  const compression = 10;
  const clock = new SimulationClock();
  clock.maxFrameDeltaSec = 0.25 * compression;
  clock.maxSubSteps = Math.ceil(clock.maxFrameDeltaSec / clock.fixedStepSec);

  let simulatedSeconds = 0;
  for (let frame = 0; frame < 100; frame++) {
    clock.advance((1 / 30) * compression, dt => { simulatedSeconds += dt; });
  }

  assert.ok(Math.abs(simulatedSeconds - (100 / 30) * compression) < 1e-9);
  assert.equal(clock.droppedTimeSec, 0);
  assert.ok(clock.totalSteps > 8 * 100);
});

test('still drops excessive wall-clock stalls after applying compression', () => {
  const compression = 10;
  const clock = new SimulationClock();
  clock.maxFrameDeltaSec = 0.25 * compression;
  clock.maxSubSteps = Math.ceil(clock.maxFrameDeltaSec / clock.fixedStepSec);

  clock.advance(1 * compression, () => {});

  assert.ok(clock.droppedTimeSec >= 7.49);
  assert.ok(clock.accumulatorSec < clock.fixedStepSec);
});
