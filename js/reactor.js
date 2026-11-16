/**
 * ============================================================================
 * GENERAL ELECTRIC S9G PRESSURIZED WATER NUCLEAR REACTOR (PWR) SIMULATION
 * Realistic thermodynamics, negative temperature reactivity feedback,
 * primary coolant pumps, steam generator, turbines, battery & diesel backup.
 * ============================================================================
 */

class S9GReactorPlant {
  constructor() {
    this.reset();
  }

  reset() {
    this.status = 'CRITICAL'; // 'CRITICAL', 'SCRAMMED', 'RESTARTING'
    this.autoRegulator = true;

    // Control rods (0% = fully inserted, 100% = fully withdrawn)
    this.rodPositionPct = 36.0;
    this.neutronFluxPct = 24.0; // % of 210 MWt rated thermal output
    this.ratedThermalMW = 210.0;

    // Primary Coolant Loop (Pressurized Water @ ~2250 PSI)
    this.pumpMode = 'SLOW'; // 'NAT_CIRC', 'SLOW', 'FAST'
    this.tAvgC = 285.0;     // Target 285°C
    this.tHotC = 296.0;
    this.tColdC = 274.0;
    this.primaryPressurePsi = 2250;

    // Secondary Steam Plant & Propulsion Turbines
    this.steamPressurePsi = 890;
    this.shaftRpm = 60;     // 0..240 RPM (240 RPM = 34 kts flank)
    this.turbineDemandPct = 20.0;
    this.electricalOutputMWe = 4.2;

    // Backup Power Systems
    this.batteryPct = 100.0;
    this.dieselRunning = false;
    this.scramCooldownSec = 0;
  }

  /**
   * Maximum safe thermal power % before core overheating for each pump mode
   */
  getMaxSafeFlowPowerPct() {
    if (this.pumpMode === 'NAT_CIRC') return 38.0;
    if (this.pumpMode === 'SLOW') return 76.0;
    return 110.0; // FAST
  }

  /**
   * Acoustic noise contribution in dB from Reactor Coolant Pumps & Diesel
   */
  getPlantNoiseDb() {
    let db = 0;
    if (this.pumpMode === 'SLOW') db += 5;
    if (this.pumpMode === 'FAST') db += 14;
    if (this.dieselRunning) db += 28; // Loud diesel snorkel exhaust
    return db;
  }

  triggerScram(reason = 'MANUAL OPERATOR TRIP') {
    if (this.status === 'SCRAMMED') return;
    this.status = 'SCRAMMED';
    this.rodPositionPct = 0.0;
    this.scramCooldownSec = 8.0;
    if (window.SubAudio) window.SubAudio.playAlarm('SCRAM');
    if (window.GameLogger) {
      window.GameLogger.log('ENG', `REACTOR SCRAM! (${reason}) Control rods dropped to 0%. On Main Battery.`, 'alert');
    }
  }

  attemptRestart() {
    if (this.status !== 'SCRAMMED') return;
    if (this.scramCooldownSec > 0) {
      if (window.GameLogger) {
        window.GameLogger.log('ENG', `Cannot reset SCRAM latch yet: wait ${Math.ceil(this.scramCooldownSec)}s latch cooldown.`, 'eng');
      }
      return;
    }
    this.status = 'CRITICAL';
    this.rodPositionPct = 28.0;
    this.autoRegulator = true;
    if (window.GameLogger) {
      window.GameLogger.log('ENG', 'Reactor trip reset. Pulling control rods to criticality (28%). Auto T-Avg engaged.', 'eng');
    }
  }

  /**
   * Step reactor thermodynamics and steam propulsion plant by dt (seconds)
   * @param {number} dt - simulation timestep in seconds
   * @param {number} orderedSpeedKts - helm telegraph speed (-8 to +32 knots)
   * @param {number} depthM - submarine keel depth (meters)
   */
  update(dt, orderedSpeedKts, depthM) {
    if (this.scramCooldownSec > 0) {
      this.scramCooldownSec = Math.max(0, this.scramCooldownSec - dt);
    }

    // Emergency Diesel can only snorkel at depth <= 20m
    if (this.dieselRunning && depthM > 21) {
      this.dieselRunning = false;
      if (window.GameLogger) {
        window.GameLogger.log('ENG', 'Emergency Diesel snorkel head valve shut due to depth > 20m! Diesel tripped.', 'eng');
      }
    }

    // Calculate steam demand from ordered speed + hotel electrical load (12% baseline)
    const speedRatio = Math.abs(orderedSpeedKts) / 32.0;
    // Propulsion power scales roughly with speed^2.4
    const propulsionLoadPct = Math.pow(speedRatio, 2.15) * 86.0;
    const hotelLoadPct = 12.0;
    this.turbineDemandPct = this.status === 'SCRAMMED' ? 4.0 : (hotelLoadPct + propulsionLoadPct);

    // Automatic Control Rod Regulator (maintains T-avg ~ 285°C and matches turbine steam demand)
    if (this.status === 'CRITICAL' && this.autoRegulator) {
      const targetRod = Math.min(100, Math.max(12, this.turbineDemandPct * 0.92 + (285.0 - this.tAvgC) * 1.4));
      const rodRate = 8.5 * dt; // Max rod drive speed %/sec
      if (Math.abs(targetRod - this.rodPositionPct) <= rodRate) {
        this.rodPositionPct = targetRod;
      } else {
        this.rodPositionPct += Math.sign(targetRod - this.rodPositionPct) * rodRate;
      }
    }

    // Negative temperature feedback & neutron flux dynamics
    if (this.status === 'SCRAMMED') {
      // Decay heat (~1.5%) after scram
      this.neutronFluxPct += (1.2 - this.neutronFluxPct) * Math.min(1, dt * 1.8);
    } else {
      // Negative moderator temperature coefficient: hotter water slightly reduces reactivity
      const tempFeedback = (285.0 - this.tAvgC) * 0.18;
      const targetFlux = Math.max(0, Math.min(115, this.rodPositionPct * 1.08 + tempFeedback));
      this.neutronFluxPct += (targetFlux - this.neutronFluxPct) * Math.min(1, dt * 1.2);
    }

    // Coolant Flow Rate based on Pump Mode
    const maxSafePower = this.getMaxSafeFlowPowerPct();
    const flowFactor = this.pumpMode === 'NAT_CIRC' ? 0.42 : (this.pumpMode === 'SLOW' ? 0.78 : 1.15);

    // Core thermal balance: Heat Generated (Neutron Flux) vs Heat Removed (Steam Demand)
    const netHeatImbalance = this.neutronFluxPct - this.turbineDemandPct;
    let overPowerPenalty = 0;
    if (this.neutronFluxPct > maxSafePower) {
      // Insufficient coolant pump flow for current reactor power! Core overheats rapidly
      overPowerPenalty = (this.neutronFluxPct - maxSafePower) * 0.85;
    }

    const targetTAvg = this.status === 'SCRAMMED'
      ? 215.0
      : 285.0 + netHeatImbalance * 0.45 + overPowerPenalty * 1.6;

    this.tAvgC += (targetTAvg - this.tAvgC) * Math.min(1, dt * 0.45);

    // Delta-T across reactor core depends on power / coolant flow rate
    const deltaT = (this.neutronFluxPct / Math.max(0.3, flowFactor)) * 0.34;
    this.tHotC = this.tAvgC + deltaT * 0.5;
    this.tColdC = this.tAvgC - deltaT * 0.5;

    // Primary Loop Pressure (2250 PSI nominal, rises with T-avg)
    this.primaryPressurePsi = Math.round(2250 + (this.tAvgC - 285.0) * 6.5);

    // Automatic Reactor Protection System (RPS) SCRAM checks
    if (this.status === 'CRITICAL') {
      if (this.tHotC > 332.0 || this.primaryPressurePsi > 2520) {
        this.triggerScram(`HIGH PRIMARY TEMP/PRESS: T-HOT ${this.tHotC.toFixed(0)}°C — INCREASE COOLANT PUMP SPEED!`);
      }
    }

    // Secondary Steam Generator Pressure (nominal 890 PSI)
    const targetSteamPsi = this.status === 'SCRAMMED'
      ? Math.max(120, this.steamPressurePsi - 35 * dt)
      : Math.max(400, Math.min(1050, 620 + (this.tAvgC - 230) * 4.9 - propulsionLoadPct * 0.55));
    this.steamPressurePsi += (targetSteamPsi - this.steamPressurePsi) * Math.min(1, dt * 0.8);

    // Electrical Output & Main Storage Battery
    if (this.status === 'CRITICAL' && this.steamPressurePsi > 480) {
      this.electricalOutputMWe = 4.2 + (propulsionLoadPct * 0.02);
      // Trickle charge battery when reactor is online
      this.batteryPct = Math.min(100, this.batteryPct + 0.15 * dt);
    } else if (this.dieselRunning) {
      this.electricalOutputMWe = 1.8;
      this.batteryPct = Math.min(100, this.batteryPct + 0.25 * dt);
    } else {
      this.electricalOutputMWe = 0.0;
      // Drain battery (faster if trying to turn screw on emergency propulsion motor)
      const drainRate = 0.08 + Math.abs(orderedSpeedKts) * 0.035;
      this.batteryPct = Math.max(0, this.batteryPct - drainRate * dt);
    }

    // Calculate achievable shaft RPM & maximum available speed
    let maxAvailableSpeedKts = 32.0;
    if (this.status === 'SCRAMMED') {
      // On battery emergency propulsion motor (EPM) or diesel: max 6 knots
      maxAvailableSpeedKts = this.batteryPct > 0 || this.dieselRunning ? 6.0 : 0.0;
    } else {
      const steamFactor = Math.min(1.0, Math.max(0, (this.steamPressurePsi - 350) / 500));
      const fluxFactor = Math.min(1.0, (this.neutronFluxPct + 15) / 95);
      maxAvailableSpeedKts = 32.0 * Math.min(steamFactor, fluxFactor);
    }

    const clampedOrderedSpd = Math.sign(orderedSpeedKts) * Math.min(Math.abs(orderedSpeedKts), maxAvailableSpeedKts);
    const targetRpm = clampedOrderedSpd * 7.5; // 240 RPM @ 32 kts
    this.shaftRpm += (targetRpm - this.shaftRpm) * Math.min(1, dt * 0.5);

    return {
      effectiveOrderedSpeedKts: clampedOrderedSpd,
      plantNoiseDb: this.getPlantNoiseDb()
    };
  }
}

window.ReactorPlant = new S9GReactorPlant();
