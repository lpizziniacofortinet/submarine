/**
 * Local neural crew voice engine.
 *
 * The simulator sends speech requests to a HeadTTS/Kokoro process listening
 * on loopback. No audio is sent to a third-party API.
 */
(() => {
  'use strict';

  const audio = window.SubAudio;
  if (!audio) throw new Error('SubAudio must be loaded before local-tts.js');

  const DEFAULT_BASE_URL = 'http://127.0.0.1:8882';
  const VOICE_STORAGE_KEY = 'ssn774_voice_profile';
  const ENABLED_STORAGE_KEY = 'ssn774_voice_enabled';
  const VOICES = Object.freeze({
    am_michael: 'Michael — American male',
    am_fenrir: 'Fenrir — American male',
    am_onyx: 'Onyx — American male',
    af_bella: 'Bella — American female',
    af_sarah: 'Sarah — American female'
  });

  audio.speechSupported = typeof fetch === 'function';
  audio.voiceEnabled = (() => {
    try { return window.localStorage?.getItem(ENABLED_STORAGE_KEY) !== 'false'; }
    catch (_) { return true; }
  })();
  audio.voiceProfile = (() => {
    try {
      const saved = window.localStorage?.getItem(VOICE_STORAGE_KEY);
      return Object.prototype.hasOwnProperty.call(VOICES, saved) ? saved : 'am_michael';
    } catch (_) { return 'am_michael'; }
  })();
  audio.ttsBaseUrl = DEFAULT_BASE_URL;
  audio.ttsOnline = false;
  audio.currentTtsSource = null;
  audio._ttsProcessing = null;
  audio._ttsLastError = null;

  const notify = (state, detail) => audio.notifyVoiceStatus(state, detail);

  audio.setVoiceProfile = function setVoiceProfile(profile) {
    if (!Object.prototype.hasOwnProperty.call(VOICES, profile)) return false;
    this.voiceProfile = profile;
    try { window.localStorage?.setItem(VOICE_STORAGE_KEY, profile); } catch (_) {}
    notify('ready', 'Crew voice profile: ' + VOICES[profile]);
    return true;
  };

  audio.setVoiceEnabled = function setVoiceEnabled(enabled) {
    this.voiceEnabled = Boolean(enabled);
    try { window.localStorage?.setItem(ENABLED_STORAGE_KEY, String(this.voiceEnabled)); } catch (_) {}
    if (!this.voiceEnabled) {
      this.voiceGeneration++;
      this.voiceQueue.length = 0;
      this.stopCurrentTts();
      this.voiceSpeaking = false;
      notify('off', 'Crew voice communications disabled');
    } else {
      notify('ready', 'Crew voice enabled; start the local TTS server and run VOICE TEST');
    }
    return this.voiceEnabled;
  };

  audio.toggleVoice = function toggleVoice() {
    return this.setVoiceEnabled(!this.voiceEnabled);
  };

  audio.stopCurrentTts = function stopCurrentTts() {
    const source = this.currentTtsSource;
    this.currentTtsSource = null;
    if (source) {
      try { source.stop(); } catch (_) {}
    }
  };

  audio.checkLocalTts = async function checkLocalTts() {
    if (!this.speechSupported) {
      this.ttsOnline = false;
      notify('offline', 'Local TTS requires a browser with Fetch and Web Audio support');
      return false;
    }
    try {
      const response = await fetch(this.ttsBaseUrl + '/v1/hello', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      const greeting = await response.text();
      if (!response.ok || !greeting.startsWith('HeadTTS')) {
        throw new Error('Unexpected local TTS response (' + response.status + ')');
      }
      this.ttsOnline = true;
      notify('ready', 'Kokoro local voice engine connected');
      return true;
    } catch (error) {
      this.ttsOnline = false;
      notify('offline', 'LOCAL TTS OFFLINE — start the server at 127.0.0.1:8882 (' + error.message + ')');
      return false;
    }
  };

  audio.synthesizeLocalVoice = async function synthesizeLocalVoice(text) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeout = controller ? window.setTimeout(() => controller.abort(), 300000) : null;
    try {
      const response = await fetch(this.ttsBaseUrl + '/v1/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: text,
          voice: this.voiceProfile,
          language: 'en-us',
          speed: 0.96,
          audioEncoding: 'wav'
        }),
        signal: controller?.signal
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Local TTS returned HTTP ' + response.status);
      }
      if (!payload.audio || typeof payload.audio !== 'string') {
        throw new Error('Local TTS response did not contain WAV audio');
      }

      const binary = window.atob(payload.audio);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const audioData = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

      this.init();
      if (!this.ctx) throw new Error('Web Audio could not be initialized');
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return await this.ctx.decodeAudioData(audioData);
    } finally {
      if (timeout !== null) window.clearTimeout(timeout);
    }
  };

  audio.playLocalVoiceBuffer = function playLocalVoiceBuffer(buffer, generation) {
    return new Promise((resolve, reject) => {
      if (!this.ctx || generation !== this.voiceGeneration || !this.voiceEnabled) {
        resolve();
        return;
      }

      try {
        const source = this.ctx.createBufferSource();
        const highPass = this.ctx.createBiquadFilter();
        const lowPass = this.ctx.createBiquadFilter();
        const compressor = this.ctx.createDynamicsCompressor();
        const voiceGain = this.ctx.createGain();

        // Narrow-band radio chain: remove sub-bass/high treble and compress
        // the voice slightly, while retaining intelligibility.
        highPass.type = 'highpass';
        highPass.frequency.value = 280;
        highPass.Q.value = 0.7;
        lowPass.type = 'lowpass';
        lowPass.frequency.value = 3400;
        lowPass.Q.value = 0.7;
        compressor.threshold.value = -24;
        compressor.knee.value = 18;
        compressor.ratio.value = 3;
        compressor.attack.value = 0.004;
        compressor.release.value = 0.18;
        voiceGain.gain.value = this.voiceLevel || 0.92;

        source.buffer = buffer;
        source.connect(highPass);
        highPass.connect(lowPass);
        lowPass.connect(compressor);
        compressor.connect(voiceGain);
        // VOX is independent from the SND master switch.
        voiceGain.connect(this.ctx.destination);

        this.currentTtsSource = source;
        source.onended = () => {
          if (this.currentTtsSource === source) this.currentTtsSource = null;
          this.playRadioSquelch(false);
          resolve();
        };
        this.playRadioSquelch(true);
        source.start();
      } catch (error) {
        this.currentTtsSource = null;
        reject(error);
      }
    });
  };

  audio.processVoiceQueue = function processVoiceQueue() {
    if (this._ttsProcessing) return this._ttsProcessing;
    if (!this.voiceEnabled || !this.voiceQueue.length) return Promise.resolve();

    this._ttsProcessing = (async () => {
      while (this.voiceEnabled && this.voiceQueue.length) {
        const item = this.voiceQueue.shift();
        const generation = this.voiceGeneration;
        this.voiceSpeaking = true;
        notify('loading', 'Generating crew voice with local Kokoro model…');

        try {
          const buffer = await this.synthesizeLocalVoice(item.text);
          if (generation !== this.voiceGeneration || !this.voiceEnabled) continue;
          notify('speaking', 'Crew voice transmitting');
          await this.playLocalVoiceBuffer(buffer, generation);
          if (generation === this.voiceGeneration) {
            notify('ready', 'Crew voice ready');
          }
        } catch (error) {
          if (generation === this.voiceGeneration) {
            this._ttsLastError = error?.message || String(error);
            this.voiceQueue.length = 0;
            this.ttsOnline = false;
            notify('error', 'LOCAL TTS ERROR — ' + this._ttsLastError);
          }
        }
      }
    })().finally(() => {
      this.voiceSpeaking = false;
      this.currentTtsSource = null;
      this._ttsProcessing = null;
      if (this.voiceEnabled && this.voiceQueue.length) this.processVoiceQueue();
    });

    return this._ttsProcessing;
  };

  audio.speak = function speak(text, urgent = false) {
    if (!this.voiceEnabled || !text) return false;
    const cleanText = String(text).replace(/\s+/g, ' ').trim().slice(0, 260);
    if (!cleanText) return false;

    if (urgent) {
      this.voiceGeneration++;
      this.voiceQueue.length = 0;
      this.stopCurrentTts();
      this.voiceSpeaking = false;
    }

    this.voiceQueue.push({ text: cleanText, urgent: Boolean(urgent) });
    while (this.voiceQueue.length > 6) this.voiceQueue.shift();
    this.processVoiceQueue();
    return true;
  };

  audio.testVoice = function testVoice() {
    if (!this.voiceEnabled) {
      notify('off', 'Enable crew voice communications before running VOICE TEST');
      return false;
    }

    // Unlock/resume Web Audio synchronously in the button click handler.
    this.init();
    if (this.ctx?.state === 'suspended') this.ctx.resume();
    this.voiceGeneration++;
    this.voiceQueue.length = 0;
    this.stopCurrentTts();
    this.voiceSpeaking = false;
    this.voiceQueue.push({
      text: 'Conn. Radio check. This is USS Virginia. Crew voice communications are operational. How copy?',
      urgent: true
    });
    this.processVoiceQueue();
    return true;
  };

  // Keep the existing OPTIONS checkbox, VOX toggle and diagnostic button.
  // Add only the voice-profile selector here so main.js remains untouched.
  document.addEventListener('DOMContentLoaded', () => {
    const profileSelect = document.getElementById('opt-crew-voice-profile');
    if (profileSelect) {
      profileSelect.value = audio.voiceProfile;
      profileSelect.addEventListener('change', () => audio.setVoiceProfile(profileSelect.value));
    }
    audio.checkLocalTts();
  });
})();
