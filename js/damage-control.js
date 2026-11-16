/**
 * Damage Control Model
 * Compartment condition and progressive flooding for the game simulation.
 * Values are gameplay abstractions, not a real submarine damage model.
 */
class DamageControlSystem {
  constructor(savedState = null) {
    const defaults = {
      bow: { integrityPct: 100, floodingPct: 0 },
      operations: { integrityPct: 100, floodingPct: 0 },
      reactor: { integrityPct: 100, floodingPct: 0 },
      engineering: { integrityPct: 100, floodingPct: 0 },
      stern: { integrityPct: 100, floodingPct: 0 }
    };
    this.compartments = {};
    for (const [key, value] of Object.entries(defaults)) {
      const saved = savedState?.compartments?.[key] || {};
      this.compartments[key] = {
        integrityPct: this.clamp(saved.integrityPct ?? value.integrityPct),
        floodingPct: this.clamp(saved.floodingPct ?? value.floodingPct)
      };
    }
    this.pumping = Boolean(savedState?.pumping);
  }

  clamp(value) {
    return Math.max(0, Math.min(100, Number(value) || 0));
  }

  applyWear(zone, amountPct) {
    const compartment = this.compartments[zone];
    if (!compartment || amountPct <= 0) return;
    compartment.integrityPct = this.clamp(compartment.integrityPct - amountPct);
  }

  applyHit(zone, damagePct, floodingPct = damagePct * 0.45) {
    const compartment = this.compartments[zone];
    if (!compartment) return;
    this.applyWear(zone, damagePct);
    compartment.floodingPct = this.clamp(compartment.floodingPct + floodingPct);
  }

  setPumping(enabled) {
    this.pumping = Boolean(enabled);
  }

  update(dt) {
    if (!this.pumping || dt <= 0) return;
    // Dewatering reduces flooding; it cannot repair structural damage.
    for (const compartment of Object.values(this.compartments)) {
      compartment.floodingPct = this.clamp(compartment.floodingPct - 0.35 * dt);
    }
  }

  getSystemHealth(system) {
    const c = this.compartments;
    const values = {
      sonar: [c.bow.integrityPct],
      command: [c.operations.integrityPct],
      reactor: [c.reactor.integrityPct],
      propulsion: [c.engineering.integrityPct],
      steering: [c.stern.integrityPct],
      ballast: [c.engineering.integrityPct, c.stern.integrityPct],
      electrical: [c.operations.integrityPct, c.reactor.integrityPct, c.engineering.integrityPct]
    }[system];
    if (!values) return 100;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  get totalFloodingPct() {
    const values = Object.values(this.compartments);
    return values.reduce((sum, c) => sum + c.floodingPct, 0) / values.length;
  }

  get floodingWeightTons() {
    return Object.values(this.compartments).reduce((sum, c) => sum + c.floodingPct, 0) * 0.08;
  }

  serialize() {
    return {
      pumping: this.pumping,
      compartments: Object.fromEntries(
        Object.entries(this.compartments).map(([key, value]) => [key, { ...value }])
      )
    };
  }
}

window.DamageControlSystem = DamageControlSystem;
