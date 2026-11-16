'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

global.window = {
  addEventListener() {},
  localStorage: {
    getItem() { return null; },
    setItem() {}
  },
  speechSynthesis: {
    getVoices() { return []; },
    addEventListener() {},
    cancel() {},
    speak() {}
  },
  SpeechSynthesisUtterance: class SpeechSynthesisUtterance {
    constructor(text) { this.text = text; }
  },
  setTimeout
};

require('../js/audio.js');
const VoiceEngine = window.SubAudio.constructor;

test('urgent alerts are announced regardless of station', () => {
  assert.equal(VoiceEngine.shouldAnnounce('ALERT', 'Hull implosion', 'alert'), true);
  assert.equal(VoiceEngine.shouldAnnounce('WEPS', 'Cannot launch', 'alert'), true);
});

test('routine connection log entries stay visual', () => {
  assert.equal(VoiceEngine.shouldAnnounce('CONN', 'Patrol state saved.', 'conn'), false);
  assert.equal(VoiceEngine.shouldAnnounce('ENG', 'Main coolant pumps set to SLOW.', 'eng'), false);
});

test('important sonar reports are announced', () => {
  assert.equal(VoiceEngine.shouldAnnounce('SONAR', 'Transmitting 3.5 kHz Active Ping', 'sonar'), true);
  assert.equal(VoiceEngine.shouldAnnounce('SONAR', 'Contact classified as Akula', 'sonar'), true);
});

test('significant weapons events are announced but unrelated messages are not', () => {
  assert.equal(VoiceEngine.shouldAnnounce('WEPS', 'Tube 1 FIRED', 'weps'), true);
  assert.equal(VoiceEngine.shouldAnnounce('WEPS', 'Flooding Torpedo Tube 2', 'weps'), true);
  assert.equal(VoiceEngine.shouldAnnounce('WEPS', 'Selected VLS payload', 'weps'), false);
});

test('radio formatting removes duplicate sonar prefix and expands common symbols', () => {
  assert.equal(
    VoiceEngine.formatRadioMessage('SONAR', 'CONN, SONAR! TORPEDO IN THE WATER! Bearing 123°!'),
    'Sonar, Conn. TORPEDO IN THE WATER! Bearing 123 degrees!'
  );
  assert.match(VoiceEngine.formatRadioMessage('WEPS', 'Tube 1 at <= 45m'), /at or below/);
});
