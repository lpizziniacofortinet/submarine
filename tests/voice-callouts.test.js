'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

global.window = { addEventListener() {} };
require('../js/audio.js');

test('crew speech synthesis is not part of the simulator audio engine', () => {
  assert.equal('speechSynthesis' in window.SubAudio, false);
  assert.equal(typeof window.SubAudio.speak, 'undefined');
  assert.equal(typeof window.SubAudio.announce, 'undefined');
  assert.equal(typeof window.SubAudio.toggleVoice, 'undefined');
});
