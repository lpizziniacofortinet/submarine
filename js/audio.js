/**
 * ============================================================================
 * ENHANCED PROCEDURAL WEB AUDIO & HYDROPHONE SYNTHESIZER + CREW VOICE TTS
 * Full 90s submarine soundscape:
 * - Auto-unlocks on first click/keypress
 * - Console switch clicks & CRT terminal beeps
 * - Live Hydrophone Propeller Screw Beats (rhythmic chug-swish per target!)
 * - High-speed Torpedo screw whine in water
 * - Diving Klaxon ("AWOOGA!"), Red Alert, Reactor SCRAM alarm
 * - Torpedo Tube flood hiss, Water-Ram launch thump, VLS Missile rocket roar
 * - 3.5 kHz Active Sonar Ping + hull reverb + timed echoes
 * - Naval Crew Voice Callouts (Web Speech API)
 * ============================================================================
 */

class SubAudioEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.enabled = true;
    this.voiceEnabled = true;
    this.hydrophoneEnabled = true;
    this.volume = 0.75;
    this.initialized = false;
    this.alarmNodes = [];

    // Continuous nodes
    this.ambientGain = null;
    this.pumpOsc = null;
    this.pumpHarmonicOsc = null;
    this.pumpGain = null;
    this.cavGain = null;

    // Hydrophone target screw modulation nodes
    this.hydroGain = null;
    this.hydroFilter = null;
    this.screwPhase = 0;

    // Torpedo whine oscillator
    this.torpOsc = null;
    this.torpGain = null;

    this.speechSynthesis = window.speechSynthesis || null;
    this.speechSupported = Boolean(this.speechSynthesis && window.SpeechSynthesisUtterance);
    this.voiceQueue = [];
    this.voiceSpeaking = false;
    this.currentUtterance = null;
    this.voiceGeneration = 0;
    this.availableVoices = [];
    this.preferredVoice = null;
    this.voiceRate = 0.94;
    this.voicePitch = 0.82;
    this.voiceLevel = 0.92;
    this.lastVoiceError = null;
    this.onVoiceStatus = null;
    try {
      this.voiceEnabled = this.speechSupported &&
        window.localStorage?.getItem('ssn774_voice_enabled') !== 'false';
    } catch (e) {
      this.voiceEnabled = this.speechSupported;
    }
    this.refreshVoices();
    if (this.speechSynthesis?.addEventListener) {
      this.speechSynthesis.addEventListener('voiceschanged', () => this.refreshVoices());
    } else if (this.speechSynthesis) {
      this.speechSynthesis.onvoiceschanged = () => this.refreshVoices();
    }

    this.bindGlobalUnlock();
  }

  bindGlobalUnlock() {
    const unlock = () => {
      if (!this.initialized) {
        this.init();
      } else if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
  }

  init() {
    if (this.initialized) {
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.enabled ? this.volume : 0;
      this.masterGain.connect(this.ctx.destination);

      this.setupContinuousLoops();
      this.initialized = true;
      this.playConsoleBeep(880, 0.06);
    } catch (e) {
      console.warn('WebAudio init deferred:', e);
    }
  }

  setVolume(val) {
    this.volume = Math.max(0, Math.min(1, Number(val)));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.enabled ? this.volume : 0, this.ctx.currentTime, 0.05);
    }
  }

  toggle() {
    this.enabled = !this.enabled;
    if (this.enabled && !this.initialized) {
      this.init();
    }
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.enabled ? this.volume : 0, this.ctx.currentTime, 0.08);
    }
    return this.enabled;
  }

  /**
   * Select a system-provided English voice. Prefer an installed/local en-US voice
   * and voices labelled natural/neural when the operating system exposes them.
   */
  refreshVoices() {
    if (!this.speechSynthesis) return [];
    try {
      this.availableVoices = this.speechSynthesis.getVoices() || [];
    } catch (e) {
      this.availableVoices = [];
    }

    const score = (voice) => {
      const lang = String(voice.lang || '').toLowerCase();
      const name = String(voice.name || '').toLowerCase();
      let value = 0;
      if (lang === 'en-us') value += 100;
      else if (lang.startsWith('en-')) value += 65;
      else if (lang === 'en') value += 55;
      if (voice.localService) value += 35;
      if (voice.default) value += 5;
      if (/natural|neural|premium|enhanced/.test(name)) value += 45;
      if (/alex|daniel|fred|guy|david|mark|james|tom|aaron|christopher/.test(name)) value += 12;
      return value;
    };

    const englishVoices = this.availableVoices
      .filter((voice) => String(voice.lang || '').toLowerCase().startsWith('en'))
      .sort((a, b) => score(b) - score(a));
    this.preferredVoice = englishVoices[0] ||
      this.availableVoices.find((voice) => voice.default) ||
      this.availableVoices[0] || null;
    return this.availableVoices;
  }

  static shouldAnnounce(station, message, cssClass = 'conn') {
    const text = String(message || '');
    if (cssClass === 'alert') return true;
    if (station === 'SONAR' && cssClass === 'sonar' &&
        /active ping|classified|matched demon|noisemaker|decoy/i.test(text)) return true;
    if (station === 'WEPS' && cssClass === 'weps' &&
        /flooding|fired|broached|deployed|reloaded/i.test(text)) return true;
    if (station === 'CONN' && /^(DIVE!|MISSION ACCOMPLISHED)/i.test(text)) return true;
    return false;
  }

  static formatRadioMessage(station, message) {
    let body = String(message || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/^\s*Conn,\s*Sonar[.!:,]?\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/<=/g, ' at or below ')
      .replace(/>=/g, ' at or above ')
      .replace(/°/g, ' degrees ')
      .replace(/\bKT\b/gi, ' knots ')
      .replace(/\s+/g, ' ')
      .replace(/\s+([,!.?])/g, '$1');
    const callsign = station === 'SONAR' ? 'Sonar, Conn.' :
      station === 'WEPS' ? 'Weapons, Conn.' :
      station === 'ENG' ? 'Engineering, Conn.' : 'Conn.';
    return `${callsign} ${body}`.slice(0, 260);
  }

  announce(station, message, cssClass = 'conn') {
    if (!SubAudioEngine.shouldAnnounce(station, message, cssClass)) return false;
    const radioMessage = SubAudioEngine.formatRadioMessage(station, message);
    this.speak(radioMessage, cssClass === 'alert');
    return true;
  }

  setVoiceEnabled(enabled) {
    if (!this.speechSupported) {
      this.voiceEnabled = false;
      return false;
    }
    this.voiceEnabled = Boolean(enabled);
    try {
      window.localStorage?.setItem('ssn774_voice_enabled', String(this.voiceEnabled));
    } catch (e) {
      // Voice still works for this session when storage is unavailable.
    }
    if (!this.voiceEnabled) {
      this.voiceGeneration++;
      this.voiceQueue.length = 0;
      this.voiceSpeaking = false;
      this.currentUtterance = null;
      this.speechSynthesis.cancel();
      this.notifyVoiceStatus('off', 'Crew voice communications disabled');
    } else {
      this.notifyVoiceStatus('ready', 'Crew voice enabled; click VOX TEST to verify playback');
    }
    return this.voiceEnabled;
  }

  toggleVoice() {
    return this.setVoiceEnabled(!this.voiceEnabled);
  }

  playRadioSquelch(opening = true) {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const duration = opening ? 0.065 : 0.045;
    const length = Math.max(1, Math.floor(this.ctx.sampleRate * duration));
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * 0.7;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = opening ? 1550 : 950;
    filter.Q.value = 0.9;
    const gain = this.ctx.createGain();
    const peak = opening ? 0.045 : 0.032;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.009);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    source.start(now);
    source.stop(now + duration + 0.005);
  }

  notifyVoiceStatus(state, detail = '') {
    if (typeof this.onVoiceStatus === 'function') {
      this.onVoiceStatus(state, detail);
    }
  }

  createVoiceUtterance(text) {
    const utterance = new window.SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = this.voiceRate;
    utterance.pitch = this.voicePitch;
    utterance.volume = this.voiceLevel;
    if (this.preferredVoice) utterance.voice = this.preferredVoice;
    return utterance;
  }

  processVoiceQueue() {
    if (!this.voiceEnabled || !this.speechSupported || this.voiceSpeaking || !this.voiceQueue.length) return;

    const item = this.voiceQueue.shift();
    const generation = this.voiceGeneration;
    const utterance = this.createVoiceUtterance(item.text);

    const finish = (state = 'ready', detail = '') => {
      if (generation !== this.voiceGeneration) return;
      this.voiceSpeaking = false;
      this.currentUtterance = null;
      this.notifyVoiceStatus(state, detail);
      this.playRadioSquelch(false);
      this.processVoiceQueue();
    };
    utterance.onstart = () => this.notifyVoiceStatus('speaking', 'Crew voice transmitting');
    utterance.onend = () => finish('ready', 'Crew voice ready');
    utterance.onerror = (event) => {
      this.lastVoiceError = event.error || 'speech-error';
      finish('error', `Speech synthesis error: ${this.lastVoiceError}`);
    };

    this.voiceSpeaking = true;
    this.currentUtterance = utterance;
    this.playRadioSquelch(true);
    try {
      if (this.speechSynthesis.paused) this.speechSynthesis.resume();
      // Speak immediately. Do not defer this call: browsers may require a
      // recent user gesture to start speech synthesis.
      this.speechSynthesis.speak(utterance);
    } catch (error) {
      this.lastVoiceError = error?.message || String(error);
      finish('error', `Unable to start speech synthesis: ${this.lastVoiceError}`);
    }
  }

  /**
   * Direct playback probe intended for a real button click. This bypasses the
   * queue so browser gesture restrictions cannot be lost to timers.
   */
  testVoice() {
    if (!this.speechSupported) {
      this.notifyVoiceStatus('unsupported', 'Speech synthesis is unavailable in this browser');
      return false;
    }
    if (!this.voiceEnabled) {
      this.notifyVoiceStatus('off', 'Enable VOX before running the voice test');
      return false;
    }

    this.refreshVoices();
    this.voiceGeneration++;
    this.voiceQueue.length = 0;
    this.voiceSpeaking = false;
    this.currentUtterance = null;
    this.speechSynthesis.cancel();

    const message = 'Conn. Radio check. This is USS Virginia. Crew voice communications are operational. How copy?';
    const utterance = this.createVoiceUtterance(message);
    const generation = this.voiceGeneration;

    utterance.onstart = () => this.notifyVoiceStatus('speaking', 'Radio check transmitting');
    utterance.onend = () => {
      if (generation !== this.voiceGeneration) return;
      this.voiceSpeaking = false;
      this.currentUtterance = null;
      this.notifyVoiceStatus('ready', 'Radio check complete');
      this.playRadioSquelch(false);
    };
    utterance.onerror = (event) => {
      if (generation !== this.voiceGeneration) return;
      this.voiceSpeaking = false;
      this.currentUtterance = null;
      this.lastVoiceError = event.error || 'speech-error';
      this.notifyVoiceStatus('error', `Speech synthesis error: ${this.lastVoiceError}`);
      this.playRadioSquelch(false);
    };

    this.voiceSpeaking = true;
    this.currentUtterance = utterance;
    this.playRadioSquelch(true);
    try {
      if (this.speechSynthesis.paused) this.speechSynthesis.resume();
      // This method is called synchronously by the VOX TEST click handler.
      this.speechSynthesis.speak(utterance);
      this.notifyVoiceStatus('speaking', 'Radio check sent to the browser speech engine');
      return true;
    } catch (error) {
      this.voiceSpeaking = false;
      this.currentUtterance = null;
      this.lastVoiceError = error?.message || String(error);
      this.notifyVoiceStatus('error', `Unable to start speech synthesis: ${this.lastVoiceError}`);
      return false;
    }
  }

  /**
   * Speak only selected operational dispatches. Routine console chatter remains
   * visual, urgent alerts flush the queue, and ordinary callouts are serialized.
   */
  speak(text, urgent = false) {
    if (!this.voiceEnabled || !this.speechSupported || !text) return false;
    const cleanText = String(text).replace(/\s+/g, ' ').trim().slice(0, 260);
    if (!cleanText) return false;

    if (urgent) {
      this.voiceGeneration++;
      this.voiceQueue.length = 0;
      this.voiceSpeaking = false;
      this.currentUtterance = null;
      this.speechSynthesis.cancel();
    }

    this.voiceQueue.push({ text: cleanText, urgent: Boolean(urgent) });
    while (this.voiceQueue.length > 6) this.voiceQueue.shift();
    this.processVoiceQueue();
    return true;
  }

  setupContinuousLoops() {
    if (!this.ctx) return;

    // Create 3-second pink/white noise buffer for ocean ambiance, cavitation, and hydrophone screw beats
    const bufferSize = this.ctx.sampleRate * 3;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + white * 0.029;
      b1 = 0.985 * b1 + white * 0.032;
      b2 = 0.950 * b2 + white * 0.048;
      output[i] = (b0 + b1 + b2 + white * 0.18) * 0.7;
    }

    // 1. Deep Ocean Hull Ambiance
    const ambientNoise = this.ctx.createBufferSource();
    ambientNoise.buffer = noiseBuffer;
    ambientNoise.loop = true;

    const lpFilter = this.ctx.createBiquadFilter();
    lpFilter.type = 'lowpass';
    lpFilter.frequency.value = 135;

    this.ambientGain = this.ctx.createGain();
    this.ambientGain.gain.value = 0.16;

    ambientNoise.connect(lpFilter);
    lpFilter.connect(this.ambientGain);
    this.ambientGain.connect(this.masterGain);
    ambientNoise.start(0);

    // 2. Own-Ship Propeller Cavitation Roar
    const cavNoise = this.ctx.createBufferSource();
    cavNoise.buffer = noiseBuffer;
    cavNoise.loop = true;

    const cavFilter = this.ctx.createBiquadFilter();
    cavFilter.type = 'bandpass';
    cavFilter.frequency.value = 780;
    cavFilter.Q.value = 1.1;

    this.cavGain = this.ctx.createGain();
    this.cavGain.gain.value = 0.0;

    cavNoise.connect(cavFilter);
    cavFilter.connect(this.cavGain);
    this.cavGain.connect(this.masterGain);
    cavNoise.start(0);

    // 3. Hydrophone Target Propeller Blade-Beat ("Chug-Chug-Swish")
    const hydroNoise = this.ctx.createBufferSource();
    hydroNoise.buffer = noiseBuffer;
    hydroNoise.loop = true;

    this.hydroFilter = this.ctx.createBiquadFilter();
    this.hydroFilter.type = 'bandpass';
    this.hydroFilter.frequency.value = 420;
    this.hydroFilter.Q.value = 2.4;

    this.hydroGain = this.ctx.createGain();
    this.hydroGain.gain.value = 0.0;

    hydroNoise.connect(this.hydroFilter);
    this.hydroFilter.connect(this.hydroGain);
    this.hydroGain.connect(this.masterGain);
    hydroNoise.start(0);

    // 4. Reactor Coolant Pump & Steam Turbine Hum
    this.pumpOsc = this.ctx.createOscillator();
    this.pumpOsc.type = 'sine';
    this.pumpOsc.frequency.value = 60;

    this.pumpHarmonicOsc = this.ctx.createOscillator();
    this.pumpHarmonicOsc.type = 'triangle';
    this.pumpHarmonicOsc.frequency.value = 120;

    this.pumpGain = this.ctx.createGain();
    this.pumpGain.gain.value = 0.035;

    const harmonicGain = this.ctx.createGain();
    harmonicGain.gain.value = 0.25;

    this.pumpOsc.connect(this.pumpGain);
    this.pumpHarmonicOsc.connect(harmonicGain);
    harmonicGain.connect(this.pumpGain);
    this.pumpGain.connect(this.masterGain);

    this.pumpOsc.start(0);
    this.pumpHarmonicOsc.start(0);

    // 5. High-Speed Torpedo Propeller Whine in Hydrophone
    this.torpOsc = this.ctx.createOscillator();
    this.torpOsc.type = 'sawtooth';
    this.torpOsc.frequency.value = 380;

    const torpFilter = this.ctx.createBiquadFilter();
    torpFilter.type = 'bandpass';
    torpFilter.frequency.value = 520;
    torpFilter.Q.value = 3.0;

    this.torpGain = this.ctx.createGain();
    this.torpGain.gain.value = 0.0;

    this.torpOsc.connect(torpFilter);
    torpFilter.connect(this.torpGain);
    this.torpGain.connect(this.masterGain);
    this.torpOsc.start(0);
  }

  /**
   * Updates continuous sound loops every frame:
   * - Own cavitation hiss
   * - Reactor coolant pump & turbine RPM pitch
   * - Selected contact's rhythmic propeller blade-rate beats on hydrophone
   * - Active torpedo screw whine in water
   */
  updateContinuousTelemetry(isCavitating, pumpMode, speedKts, scrammed, selectedContact = null, activeTorpedoCount = 0, dt = 0.016) {
    if (!this.initialized || !this.enabled || !this.ctx) return;
    if (this.ctx.state === 'suspended') return;

    const now = this.ctx.currentTime;

    // 1. Own-ship Cavitation hiss
    const targetCav = isCavitating ? Math.min(0.32, 0.09 + Math.abs(speedKts) * 0.006) : 0.0;
    this.cavGain.gain.setTargetAtTime(targetCav, now, 0.12);

    // 2. Reactor Pump & Turbine Hum
    if (scrammed) {
      this.pumpGain.gain.setTargetAtTime(0.004, now, 0.2);
    } else {
      let pumpLevel = 0.015;
      let baseFreq = 52 + Math.abs(speedKts) * 2.1;
      if (pumpMode === 'SLOW') pumpLevel = 0.028;
      if (pumpMode === 'FAST') {
        pumpLevel = 0.055;
        baseFreq += 28;
      }
      this.pumpOsc.frequency.setTargetAtTime(baseFreq, now, 0.15);
      this.pumpHarmonicOsc.frequency.setTargetAtTime(baseFreq * 2.0, now, 0.15);
      this.pumpGain.gain.setTargetAtTime(pumpLevel, now, 0.15);
    }

    // 3. Hydrophone Target Propeller Blade Beat or Biological Whale/Dolphin Calls
    if (this.hydrophoneEnabled && selectedContact && selectedContact.detected && !selectedContact.sunk && selectedContact.snrDb > -2) {
      if (selectedContact.profile.category === 'BIOLOGIC') {
        // Biological marine mammal frequency sweep & clicks
        this.screwPhase = (this.screwPhase + 1.8 * dt) % (Math.PI * 2);
        const bioSweep = 220 + Math.sin(this.screwPhase) * 140 + Math.cos(this.screwPhase * 3.7) * 80;
        const snrStrength = Math.min(0.18, Math.max(0.02, (selectedContact.snrDb + 5) * 0.006));
        this.hydroFilter.frequency.setTargetAtTime(Math.max(90, bioSweep), now, 0.06);
        this.hydroGain.gain.setTargetAtTime(snrStrength * (0.5 + 0.5 * Math.sin(this.screwPhase * 2.3)), now, 0.06);
      } else {
        const blades = selectedContact.profile.blades || 5;
        const spd = Math.max(2, selectedContact.speedKts);
        const bladeBeatHz = (spd * 0.35) * (blades / 5.0);
        this.screwPhase = (this.screwPhase + bladeBeatHz * dt * Math.PI * 2) % (Math.PI * 2);

        // Rhythmic amplitude pulse per blade pass
        const pulse = 0.35 + 0.65 * Math.pow((Math.sin(this.screwPhase) + 1) * 0.5, 2.2);
        const snrStrength = Math.min(0.24, Math.max(0.02, (selectedContact.snrDb + 5) * 0.008));

        // Submarines sound deeper/lower pitched than surface warships/merchants
        const centerFreq = selectedContact.profile.category === 'SUBMARINE' ? 280 : 540;
        this.hydroFilter.frequency.setTargetAtTime(centerFreq + pulse * 140, now, 0.04);
        this.hydroGain.gain.setTargetAtTime(snrStrength * pulse, now, 0.04);
      }
    } else if (this.hydroGain) {
      this.hydroGain.gain.setTargetAtTime(0.0, now, 0.1);
    }

    // 4. Active Torpedo Screw Whine
    if (activeTorpedoCount > 0) {
      const warble = 460 + Math.sin(now * 14) * 35;
      this.torpOsc.frequency.setTargetAtTime(warble, now, 0.05);
      this.torpGain.gain.setTargetAtTime(Math.min(0.09, activeTorpedoCount * 0.045), now, 0.1);
    } else if (this.torpGain) {
      this.torpGain.gain.setTargetAtTime(0.0, now, 0.15);
    }
  }

  /**
   * Tactile 90s CRT Console Button Click / Beep
   */
  playConsoleBeep(freq = 1200, duration = 0.045) {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, now);

    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + duration + 0.01);
  }

  /**
   * Biological Whale Song / Echolocation Call on Hydrophone
   */
  playWhaleSong() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(340, now);
    osc.frequency.exponentialRampToValueAtTime(165, now + 0.65);
    osc.frequency.exponentialRampToValueAtTime(280, now + 1.15);

    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.14, now + 0.2);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.25);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 1.3);
  }

  /**
   * Classic Submarine Diving Klaxon ("AWOOGA! AWOOGA!")
   */
  playDiveKlaxon() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    [0, 0.65].forEach((offset) => {
      const t = now + offset;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';

      // "A-WOO-GA" pitch contour
      osc.frequency.setValueAtTime(240, t);
      osc.frequency.linearRampToValueAtTime(520, t + 0.22);
      osc.frequency.setValueAtTime(520, t + 0.36);
      osc.frequency.exponentialRampToValueAtTime(190, t + 0.56);

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1100;

      gain.gain.setValueAtTime(0.01, t);
      gain.gain.linearRampToValueAtTime(0.22, t + 0.06);
      gain.gain.setValueAtTime(0.22, t + 0.42);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.58);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.6);
    });
  }

  /**
   * Compressed Air / Hydraulic Hiss (Ballast Blow or Torpedo Tube Flood)
   */
  playPneumaticHiss(durationSec = 1.2) {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const bufLen = Math.floor(this.ctx.sampleRate * durationSec);
    const buffer = this.ctx.createBuffer(1, bufLen, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufLen; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1400, now);
    filter.frequency.exponentialRampToValueAtTime(650, now + durationSec);
    filter.Q.value = 1.8;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.22, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.001, now + durationSec);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    noise.start(now);
  }

  /**
   * AN/BQQ-10 3.5 kHz Active Sonar Ping + Metallic Reverb + Echo Returns
   */
  playActivePing(echoRangesNm = []) {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;

    // Dual-oscillator metallic sonar chirp (3320Hz + 3550Hz)
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc1.type = 'sine';
    osc2.type = 'sine';

    osc1.frequency.setValueAtTime(3320, now);
    osc1.frequency.setValueAtTime(3550, now + 0.14);

    osc2.frequency.setValueAtTime(1660, now);
    osc2.frequency.setValueAtTime(1775, now + 0.14);

    gain.gain.setValueAtTime(0.32, now);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 1.65);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(this.masterGain);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 1.7);
    osc2.stop(now + 1.7);

    // Returning target echoes delayed by distance
    echoRangesNm.slice(0, 5).forEach((rngNm) => {
      const delaySec = Math.min(3.6, Math.max(0.55, rngNm * 0.30));
      const echoOsc = this.ctx.createOscillator();
      const echoGain = this.ctx.createGain();
      echoOsc.type = 'sine';
      echoOsc.frequency.setValueAtTime(3565, now + delaySec);

      const atten = Math.max(0.025, 0.18 / (1 + rngNm * 0.3));
      echoGain.gain.setValueAtTime(atten, now + delaySec);
      echoGain.gain.exponentialRampToValueAtTime(0.0005, now + delaySec + 0.75);

      echoOsc.connect(echoGain);
      echoGain.connect(this.masterGain);
      echoOsc.start(now + delaySec);
      echoOsc.stop(now + delaySec + 0.8);
    });
  }

  /**
   * Hostile Warship / Submarine Active Sonar Ping Striking Our Hull
   */
  playHostilePing(snrDb = 20) {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(4380, now);
    osc.frequency.setValueAtTime(4650, now + 0.11);

    const vol = Math.min(0.30, Math.max(0.05, snrDb * 0.008));
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 1.15);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 1.2);
  }

  /**
   * Compressed Air Water-Ram Torpedo Launch Pulse + Screw Spin-up
   */
  playTubeLaunch() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;

    // 1. Heavy hydraulic water-ram thump
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(28, now + 0.55);

    gain.gain.setValueAtTime(0.45, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.62);

    // 2. High-pressure air impulse + torpedo turbine spin-up whine
    this.playPneumaticHiss(0.65);

    const spinOsc = this.ctx.createOscillator();
    const spinGain = this.ctx.createGain();
    spinOsc.type = 'sawtooth';
    spinOsc.frequency.setValueAtTime(180, now + 0.15);
    spinOsc.frequency.exponentialRampToValueAtTime(720, now + 1.1);

    spinGain.gain.setValueAtTime(0.08, now + 0.15);
    spinGain.gain.exponentialRampToValueAtTime(0.001, now + 1.15);

    spinOsc.connect(spinGain);
    spinGain.connect(this.masterGain);
    spinOsc.start(now + 0.15);
    spinOsc.stop(now + 1.2);
  }

  /**
   * VLS Rocket Booster Ignition Roar (Harpoon / Tomahawk Launch)
   */
  playMissileLaunch() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const duration = 2.0;
    const bufLen = Math.floor(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, bufLen, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufLen; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(220, now);
    filter.frequency.exponentialRampToValueAtTime(950, now + duration);
    filter.Q.value = 0.8;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.02, now);
    gain.gain.linearRampToValueAtTime(0.35, now + 0.3);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    noise.start(now);
  }

  /**
   * Underwater Torpedo / Warhead Detonation Shockwave
   */
  playExplosion(distanceNm = 2.0) {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const bufferSize = Math.floor(this.ctx.sampleRate * 2.4);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.55));
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(320, now);
    filter.frequency.exponentialRampToValueAtTime(38, now + 2.2);

    const gain = this.ctx.createGain();
    const vol = Math.min(0.75, Math.max(0.15, 0.65 / (1 + distanceNm * 0.22)));
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 2.35);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    noise.start(now);
  }

  /**
   * Immediately silence active alarm klaxon oscillators without muting
   * other simulator audio (hydrophone, torpedo screw, reactor, etc.).
   */
  stopAlarm(type = 'TORPEDO') {
    if (!this.ctx || !this.alarmNodes.length) return;
    const now = this.ctx.currentTime;
    const remaining = [];
    for (const alarm of this.alarmNodes) {
      if (alarm.type !== type) {
        remaining.push(alarm);
        continue;
      }
      try {
        alarm.gain.gain.cancelScheduledValues(now);
        alarm.gain.gain.setTargetAtTime(0, now, 0.015);
        alarm.osc.stop(now + 0.06);
      } catch (e) {
        // Oscillator may already have completed.
      }
    }
    this.alarmNodes = remaining;
  }

  /**
   * Alarm Klaxon (Torpedo Warning / Reactor Scram / Emergency Blow)
   */
  playAlarm(type = 'TORPEDO') {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;

    if (type === 'SCRAM') {
      [0, 0.35, 0.70].forEach((offset) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(920, now + offset);
        osc.frequency.setValueAtTime(580, now + offset + 0.16);
        gain.gain.setValueAtTime(0.20, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.32);
        osc.connect(gain);
        gain.connect(this.masterGain);
        this.alarmNodes.push({ type, osc, gain });
        osc.onended = () => {
          this.alarmNodes = this.alarmNodes.filter((node) => node.osc !== osc);
        };
        osc.start(now + offset);
        osc.stop(now + offset + 0.34);
      });
    } else {
      // Urgent 3-pulse Torpedo / Red Alert Klaxon
      [0, 0.28, 0.56].forEach((offset) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(1320, now + offset);
        osc.frequency.setValueAtTime(980, now + offset + 0.12);
        gain.gain.setValueAtTime(0.18, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.25);
        osc.connect(gain);
        gain.connect(this.masterGain);
        this.alarmNodes.push({ type, osc, gain });
        osc.onended = () => {
          this.alarmNodes = this.alarmNodes.filter((node) => node.osc !== osc);
        };
        osc.start(now + offset);
        osc.stop(now + offset + 0.26);
      });
    }
  }
}

window.SubAudio = new SubAudioEngine();
