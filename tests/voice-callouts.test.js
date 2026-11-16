'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const spokenUtterances = [];
const mockSpeechSynthesis = {
  paused: false,
  getVoices() { return []; },
  addEventListener() {},
  cancel() {},
  resume() { this.paused = false; },
  speak(utterance) { spokenUtterances.push(utterance); }
};

global.window = {
  addEventListener() {},
  localStorage: {
    getItem() { return null; },
    setItem() {}
  },
  speechSynthesis: mockSpeechSynthesis,
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


test('voice test sends an utterance synchronously to speechSynthesis', () => {
  window.SubAudio.playRadioSquelch = () => {};
  assert.equal(window.SubAudio.testVoice(), true);
  assert.equal(spokenUtterances.length, 1);
  assert.match(spokenUtterances[0].text, /USS Virginia/);
  assert.equal(typeof spokenUtterances[0].onend, 'function');
});

test('voice selection falls back to an installed system voice when no English voice exists', () => {
  mockSpeechSynthesis.getVoices = () => [
    { name: 'French Default', lang: 'fr-FR', default: true, localService: true }
  ];
  window.SubAudio.refreshVoices();
  assert.equal(window.SubAudio.preferredVoice.name, 'French Default');
});
