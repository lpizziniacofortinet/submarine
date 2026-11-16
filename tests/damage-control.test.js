const test = require('node:test');
const assert = require('node:assert/strict');

global.window = {};
require('../js/damage-control.js');

test('damage control starts with intact, dry compartments', () => {
  const dc = new window.DamageControlSystem();
  assert.equal(dc.getSystemHealth('propulsion'), 100);
  assert.equal(dc.totalFloodingPct, 0);
  assert.equal(dc.floodingWeightTons, 0);
});

test('localized hit damages only the selected compartment and creates flooding', () => {
  const dc = new window.DamageControlSystem();
  dc.applyHit('stern', 40, 25);
  assert.equal(dc.compartments.stern.integrityPct, 60);
  assert.equal(dc.compartments.stern.floodingPct, 25);
  assert.equal(dc.compartments.bow.integrityPct, 100);
  assert.equal(dc.getSystemHealth('steering'), 60);
});

test('uncontrolled flooding increases slowly while pumps are secured', () => {
  const dc = new window.DamageControlSystem();
  dc.applyHit('engineering', 10, 20);
  dc.update(10);
  assert.equal(dc.compartments.engineering.floodingPct, 20.6);
});

test('dewatering reduces flooding but does not repair structural damage', () => {
  const dc = new window.DamageControlSystem();
  dc.applyHit('engineering', 35, 30);
  dc.setPumping(true);
  dc.update(10);
  assert.equal(dc.compartments.engineering.integrityPct, 65);
  assert.equal(dc.compartments.engineering.floodingPct, 26.5);
});

test('damage state can be serialized and restored', () => {
  const original = new window.DamageControlSystem();
  original.applyHit('bow', 20, 10);
  original.setPumping(true);
  const restored = new window.DamageControlSystem(original.serialize());
  assert.equal(restored.compartments.bow.integrityPct, 80);
  assert.equal(restored.compartments.bow.floodingPct, 10);
  assert.equal(restored.pumping, true);
});
