'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

global.window = {};
require('../js/entities.js');

const authorize = (overrides = {}) => window.ContactEntity.shouldLaunchHostileTorpedo({
  hasContact: true,
  attackState: 'ATTACK',
  rangeNm: 3.2,
  reloadTimerSec: 0,
  torpedoesRemaining: 4,
  shotsThisEngagement: 0,
  activeHostileTorpedoes: 0,
  ...overrides
});

test('hostile sub launches only with a live attack solution inside 0.8–5 NM', () => {
  assert.equal(authorize(), true);
  assert.equal(authorize({ hasContact: false }), false);
  assert.equal(authorize({ attackState: 'INVESTIGATE' }), false);
  assert.equal(authorize({ rangeNm: 5.1 }), false);
  assert.equal(authorize({ rangeNm: 0.7 }), false);
});

test('hostile sub does not launch while reloading or out of weapons', () => {
  assert.equal(authorize({ reloadTimerSec: 0.1 }), false);
  assert.equal(authorize({ torpedoesRemaining: 0 }), false);
});

test('one shot is allowed per continuous contact and no more than two hostile torpedoes may be active', () => {
  assert.equal(authorize({ shotsThisEngagement: 1 }), false);
  assert.equal(authorize({ activeHostileTorpedoes: 2 }), false);
  assert.equal(authorize({ activeHostileTorpedoes: 1 }), true);
});
