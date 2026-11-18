(function (root) {
  'use strict';

  class MultiplayerAudio {
    constructor() {
      this.ctx = null;
      this.enabled = false;
    }

    toggle() {
      this.enabled = !this.enabled;
      if (this.enabled) {
        if (!this.ctx && (window.AudioContext || window.webkitAudioContext)) {
          const Ctx = window.AudioContext || window.webkitAudioContext;
          this.ctx = new Ctx();
        }
        if (this.ctx && this.ctx.state === 'suspended') {
          this.ctx.resume();
        }
      }
      return this.enabled;
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
      g.connect(this.ctx.destination);
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
      g.gain.linearRampToValueAtTime(0.18, now + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 1.4);
      osc.connect(g);
      g.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 1.45);
    }

    playTorpedoAlert() {
      if (!this.enabled || !this.ctx) return;
      this.playBeep(740, 0.14, 0.12);
      setTimeout(() => this.playBeep(560, 0.16, 0.12), 180);
    }
  }

  root.MultiplayerAudio = new MultiplayerAudio();
})(window);
