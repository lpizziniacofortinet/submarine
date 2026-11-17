/**
 * ============================================================================
 * ENHANCED PROCEDURAL WEB AUDIO & HYDROPHONE SYNTHESIZER
 * Full 90s submarine soundscape:
 * - Auto-unlocks on first click/keypress
 * - Console switch clicks & CRT terminal beeps
 * - Live Hydrophone Propeller Screw Beats (rhythmic chug-swish per target!)
 * - High-speed Torpedo screw whine in water
 * - Diving Klaxon ("AWOOGA!"), Red Alert, Reactor SCRAM alarm
 * - Torpedo Tube flood hiss, Water-Ram launch thump, VLS Missile rocket roar
 * - 3.5 kHz Active Sonar Ping + hull reverb + timed echoes
 * ============================================================================
 */

class SubAudioEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.enabled = true;
    this.hydrophoneEnabled = true;
    this.volume = 0.75;
    this.initialized = false;
    this.alarmNodes = [];
    this.sonarReverb = null;
    this.sonarReverbGain = null;
    this.sonarSampleUrl = 'https://opengameart.org/sites/default/files/sonar_ping_0.mp3';
    this.sonarAudioPlayers = Object.create(null);

    // Continuous nodes
    this.ambientGain = null;
    this.pumpOsc = null;
    this.pumpHarmonicOsc = null;
    this.pumpGain = null;
    this.cavGain = null;

    // Hydrophone target screw modulation & multi-tonal machinery synthesizer
    this.hydroGain = null;
    this.hydroFilter = null;
    this.hydroPanner = null;
    this.hydroMasterGain = null;
    this.hydroTonalOscs = [];
    this.hydroTonalGains = [];
    this.screwPhase = 0;

    // Torpedo whine oscillator
    this.torpOsc = null;
    this.torpGain = null;

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

      this.setupSonarReverb();
      this.preloadSonarRecordings();
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
    for (const player of Object.values(this.sonarAudioPlayers)) {
      if (player) player.volume = this.enabled ? this.volume * (player.subVolumeScale || 1) : 0;
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

    // 3. Hydrophone Target Broadband Screw + Multi-Tonal Machinery Bank + Stereo Panner
    this.hydroMasterGain = this.ctx.createGain();
    this.hydroMasterGain.gain.value = 1.0;

    if (typeof this.ctx.createStereoPanner === 'function') {
      this.hydroPanner = this.ctx.createStereoPanner();
      this.hydroPanner.pan.value = 0;
      this.hydroMasterGain.connect(this.hydroPanner);
      this.hydroPanner.connect(this.masterGain);
    } else {
      this.hydroMasterGain.connect(this.masterGain);
    }

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
    this.hydroGain.connect(this.hydroMasterGain);
    hydroNoise.start(0);

    // 4 dedicated machinery / biological tonal oscillators driven by contact's tonalHz[]
    this.hydroTonalOscs = [];
    this.hydroTonalGains = [];
    for (let i = 0; i < 4; i++) {
      const osc = this.ctx.createOscillator();
      osc.type = i === 0 ? 'triangle' : 'sine';
      osc.frequency.value = 60 * (i + 1);
      const tGain = this.ctx.createGain();
      tGain.gain.value = 0.0;
      osc.connect(tGain);
      tGain.connect(this.hydroMasterGain);
      osc.start(0);
      this.hydroTonalOscs.push(osc);
      this.hydroTonalGains.push(tGain);
    }

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
   * - Selected contact's realistic multi-tonal machinery frequencies, blade-rate
   *   propeller cadence, Doppler shift, and stereo bearing pan on hydrophone
   * - Active torpedo screw whine in water
   */
  updateContinuousTelemetry(isCavitating, pumpMode, speedKts, scrammed, selectedContact = null, activeTorpedoCount = 0, dt = 0.016, ownHeadingDeg = 0) {
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

    // 3. Hydrophone Target Acoustic Signature (Broadband Screw + Multi-Tonal Machinery Harmonics)
    if (this.hydrophoneEnabled && selectedContact && selectedContact.detected && !selectedContact.sunk && selectedContact.snrDb > -2) {
      const prof = selectedContact.profile;
      const tonals = Array.isArray(prof.tonalHz) && prof.tonalHz.length ? prof.tonalHz : [60, 140];
      const snrNorm = Math.min(1.0, Math.max(0.08, (selectedContact.snrDb + 4) / 36));

      // Stereo Pan from relative bearing (-1 Port, +1 Starboard)
      if (this.hydroPanner) {
        const relBrgRad = (((selectedContact.lastTrueBrg - ownHeadingDeg + 360) % 360) * Math.PI) / 180;
        this.hydroPanner.pan.setTargetAtTime(Math.sin(relBrgRad) * 0.82, now, 0.08);
      }

      if (prof.category === 'BIOLOGIC') {
        // Biological marine mammal calls (20Hz Fin Whale pulse, 185-310Hz Sperm Whale clicks, Dolphin whistles)
        this.screwPhase = (this.screwPhase + 1.9 * dt) % (Math.PI * 2);
        const f0 = tonals[0] || 180;
        const bioSweep = f0 * 1.4 + Math.sin(this.screwPhase) * (f0 * 0.45) + Math.cos(this.screwPhase * 3.1) * 45;
        this.hydroFilter.frequency.setTargetAtTime(Math.max(70, bioSweep), now, 0.06);
        this.hydroGain.gain.setTargetAtTime(snrNorm * 0.16 * (0.4 + 0.6 * Math.sin(this.screwPhase * 2.3)), now, 0.06);

        for (let i = 0; i < this.hydroTonalOscs.length; i++) {
          const osc = this.hydroTonalOscs[i];
          const tg = this.hydroTonalGains[i];
          if (i < tonals.length) {
            const callFreq = tonals[i] * (0.92 + 0.16 * Math.sin(this.screwPhase * (1.2 + i * 0.5)));
            if (osc.type !== 'sine') osc.type = 'sine';
            osc.frequency.setTargetAtTime(Math.max(20, callFreq), now, 0.05);
            const pulseGate = Math.max(0, Math.sin(this.screwPhase * (1.5 + i)));
            tg.gain.setTargetAtTime(snrNorm * 0.032 * pulseGate, now, 0.05);
          } else {
            tg.gain.setTargetAtTime(0.0, now, 0.08);
          }
        }
      } else {
        const blades = prof.blades || 5;
        const spd = Math.max(1.5, selectedContact.speedKts);
        // Realistic DEMON blade-rate beat frequency & speed-proportional machinery shift
        const bladeBeatHz = (spd * 0.32) * (blades / 5.0);
        this.screwPhase = (this.screwPhase + bladeBeatHz * dt * Math.PI * 2) % (Math.PI * 2);
        const pulse = 0.30 + 0.70 * Math.pow((Math.sin(this.screwPhase) + 1) * 0.5, 2.2);

        // Acoustic Doppler factor from target radial velocity relative to own ship
        const brgToTargetRad = (selectedContact.lastTrueBrg * Math.PI) / 180;
        const tgtHdgRad = ((selectedContact.heading || 0) * Math.PI) / 180;
        const radialSpdKts = Math.cos(tgtHdgRad - brgToTargetRad) * spd;
        const dopplerFactor = 1.0 - (radialSpdKts * 0.51444) / 1500.0; // Exaggerated slightly below? No, real c=1500m/s, keep subtle + speed RPM shift

        // Plant-specific broadband wash center frequency & Q
        const isSub = prof.category === 'SUBMARINE';
        const isMerchant = prof.category === 'MERCHANT';
        const baseWashHz = isSub ? 210 : isMerchant ? 340 : 580;
        const speedShift = 0.85 + Math.min(0.45, spd / 40.0);

        this.hydroFilter.frequency.setTargetAtTime(
          Math.max(110, (baseWashHz * speedShift + pulse * (isSub ? 85 : 165)) * dopplerFactor),
          now,
          0.04
        );
        this.hydroFilter.Q.setTargetAtTime(isSub ? 3.2 : 2.1, now, 0.08);
        this.hydroGain.gain.setTargetAtTime(snrNorm * 0.22 * pulse, now, 0.04);

        // Drive up to 4 real machinery tonal oscillators from the vessel's exact tonalHz[] profile!
        // - Submarines: clean sinusoidal reactor/motor hums
        // - Merchants: heavy sawtooth/triangle low-RPM 2-stroke diesel chug
        // - Warships: crisp gas-turbine / gear-mesh harmonics
        const primaryType = isMerchant ? 'sawtooth' : (isSub ? 'sine' : 'triangle');
        const speedHarmonicShift = 0.88 + (spd / Math.max(12, prof.maxSpeedKts || 25)) * 0.24;

        for (let i = 0; i < this.hydroTonalOscs.length; i++) {
          const osc = this.hydroTonalOscs[i];
          const tg = this.hydroTonalGains[i];
          if (i < tonals.length) {
            const targetType = i === 0 ? primaryType : (isMerchant && i === 1 ? 'triangle' : 'sine');
            if (osc.type !== targetType) osc.type = targetType;

            // Low diesel tonals (22-35 Hz) are shifted gently up 1 octave in sub-bass harmonic if needed so laptop speakers reproduce them clearly alongside fundamental
            const rawHz = tonals[i] * speedHarmonicShift * dopplerFactor;
            const audibleHz = Math.max(24, rawHz);
            osc.frequency.setTargetAtTime(audibleHz, now, 0.05);

            // Fundamental tonal is strongest, higher harmonics taper off; modulated slightly by blade pass
            const harmonicWeight = i === 0 ? 0.042 : (i === 1 ? 0.028 : 0.016);
            const mod = isMerchant ? (0.72 + 0.28 * pulse) : (0.88 + 0.12 * pulse);
            tg.gain.setTargetAtTime(snrNorm * harmonicWeight * mod, now, 0.05);
          } else {
            tg.gain.setTargetAtTime(0.0, now, 0.08);
          }
        }
      }
    } else {
      if (this.hydroGain) this.hydroGain.gain.setTargetAtTime(0.0, now, 0.1);
      for (let i = 0; i < this.hydroTonalGains.length; i++) {
        this.hydroTonalGains[i].gain.setTargetAtTime(0.0, now, 0.1);
      }
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
   * Preload a real CC0 submarine sonar recording from OpenGameArt.
   * Audio elements are kept separate so incoming and outgoing pings can overlap.
   */
  preloadSonarRecordings() {
    if (typeof Audio === 'undefined') return;
    for (const channel of ['active', 'hostile']) {
      try {
        const player = new Audio(this.sonarSampleUrl);
        player.preload = 'auto';
        player.volume = this.volume;
        player.subVolumeScale = 1;
        this.sonarAudioPlayers[channel] = player;
        player.load();
      } catch (error) {
        this.sonarAudioPlayers[channel] = null;
      }
    }
  }

  /**
   * Play the recorded ping. If the external asset is unavailable or playback
   * is blocked, fall back to the procedural pulse so gameplay remains audible.
   */
  playSonarRecording(channel, volumeScale, playbackRate, fallbackOptions) {
    const player = this.sonarAudioPlayers[channel];
    if (!player || !this.enabled) return false;

    const fallback = () => {
      if (this.ctx && this.enabled) {
        this.scheduleSonarPulse(this.ctx.currentTime, fallbackOptions);
      }
    };

    try {
      player.pause();
      player.currentTime = 0;
      player.playbackRate = playbackRate;
      player.subVolumeScale = volumeScale;
      player.volume = Math.max(0, Math.min(1, this.volume * volumeScale));
      const playResult = player.play();
      if (playResult && typeof playResult.catch === 'function') {
        playResult.catch(fallback);
      }
      return true;
    } catch (error) {
      fallback();
      return false;
    }
  }

  /**
   * Build a short, diffuse underwater impulse response. The convolver is
   * shared by all sonar transmissions so each ping has a soft acoustic tail.
   */
  setupSonarReverb() {
    try {
      const sampleRate = this.ctx.sampleRate;
      const durationSec = 2.6;
      const length = Math.floor(sampleRate * durationSec);
      const impulse = this.ctx.createBuffer(2, length, sampleRate);

      for (let channel = 0; channel < 2; channel++) {
        const data = impulse.getChannelData(channel);
        for (let i = 0; i < length; i++) {
          const progress = i / length;
          const decay = Math.pow(1 - progress, 5.2);
          data[i] = (Math.random() * 2 - 1) * decay * 0.16;
        }
      }

      this.sonarReverb = this.ctx.createConvolver();
      this.sonarReverb.buffer = impulse;
      this.sonarReverbGain = this.ctx.createGain();
      this.sonarReverbGain.gain.value = 0.22;
      this.sonarReverb.connect(this.sonarReverbGain);
      this.sonarReverbGain.connect(this.masterGain);
    } catch (error) {
      // Keep dry sonar audio available on browsers with limited Web Audio support.
      this.sonarReverb = null;
      this.sonarReverbGain = null;
    }
  }

  /**
   * AN/BQQ-10-style active sonar pulse: a sharp broadband onset followed by
   * several damped resonant modes and a diffuse underwater reverberation.
   */
  scheduleSonarPulse(startTime, options = {}) {
    const {
      level = 1,
      frequency = 3500,
      tailSec = 1.55,
      transient = true
    } = options;
    const ctx = this.ctx;
    if (!ctx || level <= 0) return;

    // The short broadband onset gives the transmission its characteristic
    // hard "tock" instead of sounding like a continuous electronic beep.
    if (transient) {
      const durationSec = 0.026;
      const length = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) {
        samples[i] = (Math.random() * 2 - 1) * (1 - i / length);
      }

      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const bandpass = ctx.createBiquadFilter();
      bandpass.type = 'bandpass';
      bandpass.frequency.setValueAtTime(frequency, startTime);
      bandpass.Q.value = 1.15;
      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.0001, startTime);
      noiseGain.gain.linearRampToValueAtTime(0.12 * level, startTime + 0.0015);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec);

      noise.connect(bandpass);
      bandpass.connect(noiseGain);
      noiseGain.connect(this.masterGain);
      if (this.sonarReverb) noiseGain.connect(this.sonarReverb);
      noise.start(startTime);
      noise.stop(startTime + durationSec + 0.002);
    }

    // A real transducer does not emit one perfectly clean sine wave. These
    // slightly detuned resonances create the metallic, beating ring-down.
    const modes = [
      { ratio: 1.000, amplitude: 0.30, q: 3.8 },
      { ratio: 0.503, amplitude: 0.105, q: 2.8 },
      { ratio: 1.487, amplitude: 0.045, q: 5.2 },
      { ratio: 1.006, amplitude: 0.075, q: 4.5 }
    ];

    for (const mode of modes) {
      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      const modeFrequency = frequency * mode.ratio;

      osc.type = 'sine';
      osc.frequency.setValueAtTime(modeFrequency * 0.91, startTime);
      osc.frequency.exponentialRampToValueAtTime(modeFrequency, startTime + 0.014);
      osc.frequency.setValueAtTime(modeFrequency, startTime + 0.038);
      osc.frequency.exponentialRampToValueAtTime(modeFrequency * 0.997, startTime + tailSec);

      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(modeFrequency, startTime);
      filter.Q.value = mode.q;

      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.linearRampToValueAtTime(mode.amplitude * level, startTime + 0.002);
      gain.gain.setValueAtTime(mode.amplitude * level * 0.72, startTime + 0.028);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + tailSec);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);
      if (this.sonarReverb) gain.connect(this.sonarReverb);
      osc.start(startTime);
      osc.stop(startTime + tailSec + 0.02);
    }
  }

  /**
   * 3.5 kHz active sonar transmission with range-timed acoustic returns.
   */
  playActivePing(echoRangesNm = []) {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const recorded = this.playSonarRecording('active', 0.78, 1.0, {
      level: 1,
      frequency: 3500,
      tailSec: 1.6,
      transient: true
    });
    if (!recorded) {
      this.scheduleSonarPulse(now, {
        level: 1,
        frequency: 3500,
        tailSec: 1.6,
        transient: true
      });
    }

    // Round-trip propagation at approximately 1500 m/s:
    // 2 x 1852 metres per nautical mile.
    echoRangesNm
      .filter((range) => Number.isFinite(range) && range >= 0)
      .sort((a, b) => a - b)
      .slice(0, 5)
      .forEach((rangeNm) => {
        const delaySec = (rangeNm * 2 * 1852) / 1500;
        const attenuation = Math.max(0.006, 0.15 / Math.pow(1 + rangeNm * 0.42, 1.45));
        this.scheduleSonarPulse(now + delaySec, {
          level: attenuation,
          frequency: 3480 - Math.min(180, rangeNm * 4),
          tailSec: 1.25,
          transient: false
        });
      });
  }

  /**
   * Incoming hostile sonar ping: slightly higher, sharper and quieter,
   * with its apparent strength scaled by received signal-to-noise ratio.
   */
  playHostilePing(snrDb = 20) {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const level = Math.min(0.82, Math.max(0.16, snrDb * 0.025));
    const recorded = this.playSonarRecording('hostile', 0.7 * level, 1.06, {
      level,
      frequency: 4520,
      tailSec: 1.2,
      transient: true
    });
    if (!recorded) {
      this.scheduleSonarPulse(this.ctx.currentTime, {
        level,
        frequency: 4520,
        tailSec: 1.2,
        transient: true
      });
    }
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
