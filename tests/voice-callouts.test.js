'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const storedSettings = new Map();
const synthRequests = [];
const voiceStatuses = [];

global.window = {
  addEventListener() {},
  localStorage: {
    getItem(key) { return storedSettings.get(key) ?? null; },
    setItem(key, value) { storedSettings.set(key, String(value)); }
  },
  setTimeout,
  clearTimeout,
  atob,
  speechSynthesis: null
};
global.document = { addEventListener() {} };

global.fetch = async (url, options = {}) => {
  if (url.endsWith('/v1/hello')) {
    return { ok: true, status: 200, text: async () => 'HeadTTS v0.1.0' };
  }
  if (url.endsWith('/v1/synthesize')) {
    synthRequests.push(JSON.parse(options.body));
    return {
      ok: true,
      status: 200,
      json: async () => ({ audio: Buffer.from([82, 73, 70, 70]).toString('base64') })
    };
  }
  throw new Error('Unexpected URL: ' + url);
};

require('../js/audio.js');
require('../js/local-tts.js');
const engine = window.SubAudio;

function makeNode() {
  return {
    value: 0,
    gain: { value: 0 },
    frequency: { value: 0 },
    Q: { value: 0 },
    threshold: { value: 0 },
    knee: { value: 0 },
    ratio: { value: 0 },
    attack: { value: 0 },
    release: { value: 0 },
    connect() {},
    start() { setImmediate(() => this.onended?.()); },
    stop() { setImmediate(() => this.onended?.()); }
  };
}

engine.init = () => {
  if (!engine.ctx) {
    engine.ctx = {
      state: 'running',
      destination: {},
      resume: async () => {},
      decodeAudioData: async () => ({ duration: 1 }),
      createBufferSource: makeNode,
      createBiquadFilter: makeNode,
      createDynamicsCompressor: makeNode,
      createGain: makeNode
    };
  }
};
engine.playRadioSquelch = () => {};
engine.onVoiceStatus = (state, detail) => voiceStatuses.push({ state, detail });

test('urgent alerts are announced regardless of station', () => {
  assert.equal(engine.constructor.shouldAnnounce('ALERT', 'Hull implosion', 'alert'), true);
  assert.equal(engine.constructor.shouldAnnounce('WEPS', 'Cannot launch', 'alert'), true);
});

test('routine connection log entries stay visual', () => {
  assert.equal(engine.constructor.shouldAnnounce('CONN', 'Patrol state saved.', 'conn'), false);
  assert.equal(engine.constructor.shouldAnnounce('ENG', 'Main coolant pumps set to SLOW.', 'eng'), false);
});

test('important sonar reports are announced', () => {
  assert.equal(engine.constructor.shouldAnnounce('SONAR', 'Transmitting 3.5 kHz Active Ping', 'sonar'), true);
  assert.equal(engine.constructor.shouldAnnounce('SONAR', 'Contact classified as Akula', 'sonar'), true);
});

test('significant weapons events are announced but unrelated messages are not', () => {
  assert.equal(engine.constructor.shouldAnnounce('WEPS', 'Tube 1 FIRED', 'weps'), true);
  assert.equal(engine.constructor.shouldAnnounce('WEPS', 'Flooding Torpedo Tube 2', 'weps'), true);
  assert.equal(engine.constructor.shouldAnnounce('WEPS', 'Selected VLS payload', 'weps'), false);
});

test('radio formatting removes duplicate sonar prefix and expands common symbols', () => {
  assert.equal(
    engine.constructor.formatRadioMessage('SONAR', 'CONN, SONAR! TORPEDO IN THE WATER! Bearing 123°!'),
    'Sonar, Conn. TORPEDO IN THE WATER! Bearing 123 degrees!'
  );
  assert.match(engine.constructor.formatRadioMessage('WEPS', 'Tube 1 at <= 45m'), /at or below/);
});

test('local neural voice profile is persisted and validated', () => {
  assert.equal(engine.setVoiceProfile('af_bella'), true);
  assert.equal(engine.voiceProfile, 'af_bella');
  assert.equal(storedSettings.get('ssn774_voice_profile'), 'af_bella');
  assert.equal(engine.setVoiceProfile('not-a-real-voice'), false);
  assert.equal(engine.voiceProfile, 'af_bella');
});

test('voice preference persists when disabled from simulator options', () => {
  assert.equal(engine.setVoiceEnabled(false), false);
  assert.equal(storedSettings.get('ssn774_voice_enabled'), 'false');
  assert.equal(engine.setVoiceEnabled(true), true);
  assert.equal(storedSettings.get('ssn774_voice_enabled'), 'true');
});

test('local HeadTTS health check recognizes the local server', async () => {
  assert.equal(await engine.checkLocalTts(), true);
  assert.equal(engine.ttsOnline, true);
});

test('VOICE TEST requests neural WAV audio from the local Kokoro engine', async () => {
  assert.equal(engine.setVoiceProfile('am_michael'), true);
  assert.equal(engine.testVoice(), true);
  await engine._ttsProcessing;

  assert.equal(synthRequests.length, 1);
  assert.match(synthRequests[0].input, /USS Virginia/);
  assert.equal(synthRequests[0].voice, 'am_michael');
  assert.equal(synthRequests[0].language, 'en-us');
  assert.equal(synthRequests[0].audioEncoding, 'wav');
  assert.ok(voiceStatuses.some((status) => status.state === 'speaking'));
  assert.equal(engine.voiceSpeaking, false);
});
