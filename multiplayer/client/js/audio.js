(function (root) {
  'use strict';

  class MultiplayerAudio {
    constructor() {
      this.ctx = null;
      this.enabled = false;
      this.initialized = false;
      this.masterGain = null;
      this.cavGain = null;
      this.hydroGain = null;
      this.hydroFilter = null;
      this.hydroPanner = null;
      this.hydroOscs = [];
      this.hydroOscGains = [];
      this.torpOsc = null;
      this.torpGain = null;
      this.screwPhase = 0;
    }

    init() {
      if (this.initialized) return;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.55;
      this.masterGain.connect(this.ctx.destination);

      // Shared white-noise buffer for ocean wash & cavitation
      const bufLen = this.ctx.sampleRate * 2;
      const noiseBuf = this.ctx.createBuffer(1, bufLen, this.ctx.sampleRate);
      const ch = noiseBuf.getChannelData(0);
      for (let i = 0; i < bufLen; i++) ch[i] = Math.random() * 2 - 1;

      const cavSrc = this.ctx.createBufferSource();
      cavSrc.buffer = noiseBuf;
      cavSrc.loop = true;
      const cavFilter = this.ctx.createBiquadFilter();
      cavFilter.type = 'bandpass';
      cavFilter.frequency.value = 950;
      cavFilter.Q.value = 0.9;
      this.cavGain = this.ctx.createGain();
      this.cavGain.gain.value = 0;
      cavSrc.connect(cavFilter);
      cavFilter.connect(this.cavGain);
      this.cavGain.connect(this.masterGain);
      cavSrc.start();

      // Hydrophone channel (filtered broadband wash + 3 tonal oscillators + stereo panner)
      this.hydroPanner = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
      if (this.hydroPanner) this.hydroPanner.connect(this.masterGain);
      const hydroOut = this.hydroPanner || this.masterGain;

      const hydroSrc = this.ctx.createBufferSource();
      hydroSrc.buffer = noiseBuf;
      hydroSrc.loop = true;
      this.hydroFilter = this.ctx.createBiquadFilter();
      this.hydroFilter.type = 'bandpass';
      this.hydroFilter.frequency.value = 260;
      this.hydroFilter.Q.value = 2.4;
      this.hydroGain = this.ctx.createGain();
      this.hydroGain.gain.value = 0;
      hydroSrc.connect(this.hydroFilter);
      this.hydroFilter.connect(this.hydroGain);
      this.hydroGain.connect(hydroOut);
      hydroSrc.start();

      for (let i = 0; i < 3; i++) {
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 60 * (i + 1);
        g.gain.value = 0;
        osc.connect(g);
        g.connect(hydroOut);
        osc.start();
        this.hydroOscs.push(osc);
        this.hydroOscGains.push(g);
      }

      // Active torpedo screw whine
      this.torpOsc = this.ctx.createOscillator();
      this.torpOsc.type = 'sawtooth';
      this.torpOsc.frequency.value = 460;
      this.torpGain = this.ctx.createGain();
      this.torpGain.gain.value = 0;
      this.torpOsc.connect(this.torpGain);
      this.torpGain.connect(this.masterGain);
      this.torpOsc.start();

      this.initialized = true;
    }

    enable() {
      this.enabled = true;
      this.init();
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      return true;
    }

    toggle() {
      if (this.enabled) {
        this.enabled = false;
        this.silenceContinuous();
        return false;
      }
      return this.enable();
    }

    silenceContinuous() {
      if (!this.initialized || !this.ctx) return;
      const now = this.ctx.currentTime;
      this.cavGain.gain.setTargetAtTime(0, now, 0.08);
      this.hydroGain.gain.setTargetAtTime(0, now, 0.08);
      this.torpGain.gain.setTargetAtTime(0, now, 0.08);
      for (const g of this.hydroOscGains) g.gain.setTargetAtTime(0, now, 0.08);
    }

    updateTelemetry(snapshot, selectedContactId, activeStation, dt = 0.016) {
      if (!this.enabled || !this.initialized || !this.ctx || !snapshot) return;
      if (this.ctx.state === 'suspended') return;

      const now = this.ctx.currentTime;
      const sub = snapshot.ownSub;
      const isCav = Math.abs(sub.speedKts) > 16 && sub.depthM < 80;
      this.cavGain.gain.setTargetAtTime(isCav ? 0.14 : 0.0, now, 0.12);

      const contacts = snapshot.contacts || [];
      const target = contacts.find((c) => c.id === selectedContactId) || (activeStation === 'sonar' ? contacts[0] : null);

      if (target && target.snrDb > -2) {
        const snrNorm = Math.min(1.0, Math.max(0.12, (target.snrDb + 4) / 42));
        if (this.hydroPanner) {
          const relRad = (((target.bearingDeg - sub.headingDeg + 360) % 360) * Math.PI) / 180;
          this.hydroPanner.pan.setTargetAtTime(Math.sin(relRad) * 0.82, now, 0.08);
        }

        const isMerchant = target.category === 'MERCHANT';
        const isWarship = target.category === 'WARSHIP';
        const tonals = isMerchant ? [32, 64, 128] : isWarship ? [75, 150, 260] : [52, 104, 185];
        const beatHz = isMerchant ? 2.6 : isWarship ? 5.2 : 3.4;
        this.screwPhase = (this.screwPhase + beatHz * dt * Math.PI * 2) % (Math.PI * 2);
        const pulse = 0.35 + 0.65 * Math.pow((Math.sin(this.screwPhase) + 1) * 0.5, 2.0);

        const baseWash = isMerchant ? 320 : isWarship ? 540 : 210;
        this.hydroFilter.frequency.setTargetAtTime(baseWash + pulse * 140, now, 0.05);
        this.hydroGain.gain.setTargetAtTime(snrNorm * 0.18 * pulse, now, 0.05);

        const oscType = isMerchant ? 'sawtooth' : isWarship ? 'triangle' : 'sine';
        for (let i = 0; i < this.hydroOscs.length; i++) {
          const osc = this.hydroOscs[i];
          const g = this.hydroOscGains[i];
          osc.type = i === 0 ? oscType : 'sine';
          osc.frequency.setTargetAtTime(tonals[i], now, 0.05);
          const weight = i === 0 ? 0.045 : i === 1 ? 0.025 : 0.015;
          g.gain.setTargetAtTime(snrNorm * weight * (0.75 + 0.25 * pulse), now, 0.05);
        }
      } else if (activeStation === 'sonar') {
        // Subtle ambient ocean floor hiss in Sonar Room even when no contact is selected
        if (this.hydroPanner) this.hydroPanner.pan.setTargetAtTime(0, now, 0.1);
        this.hydroFilter.frequency.setTargetAtTime(240, now, 0.1);
        this.hydroGain.gain.setTargetAtTime(0.035, now, 0.1);
        for (const g of this.hydroOscGains) g.gain.setTargetAtTime(0, now, 0.1);
      } else {
        this.hydroGain.gain.setTargetAtTime(0, now, 0.1);
        for (const g of this.hydroOscGains) g.gain.setTargetAtTime(0, now, 0.1);
      }

      const torpCount = (snapshot.weapons || []).length;
      if (torpCount > 0) {
        this.torpOsc.frequency.setTargetAtTime(460 + Math.sin(now * 14) * 35, now, 0.05);
        this.torpGain.gain.setTargetAtTime(Math.min(0.08, torpCount * 0.04), now, 0.1);
      } else {
        this.torpGain.gain.setTargetAtTime(0, now, 0.12);
      }
    }

    playBeep(freq = 880, duration = 0.04, gainVal = 0.06) {
      if (!this.enabled || !this.ctx) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);
      g.gain.setValueAtTime(gainVal, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(g);
      g.connect(this.masterGain || this.ctx.destination);
      osc.start(now);
      osc.stop(now + duration);
    }

    playActivePing() {
      if (!this.enabled || !this.ctx) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(3500, now);
      osc.frequency.exponentialRampToValueAtTime(3430, now + 0.35);
      g.gain.setValueAtTime(0.001, now);
      g.gain.linearRampToValueAtTime(0.22, now + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 1.4);
      osc.connect(g);
      g.connect(this.masterGain || this.ctx.destination);
      osc.start(now);
      osc.stop(now + 1.45);
    }

    playTorpedoAlert() {
      if (!this.enabled || !this.ctx) return;
      this.playBeep(740, 0.14, 0.14);
      setTimeout(() => this.playBeep(560, 0.16, 0.14), 180);
    }
  }

  root.MultiplayerAudio = new MultiplayerAudio();
})(window);
