/**
 * ============================================================================
 * SUBMARINE HYDRODYNAMICS, BUOYANCY, TRIM & ACOUSTIC PROPAGATION ENGINE
 * Simulates USS Virginia (SSN-774) 6-DOF vertical/longitudinal motion,
 * ballast tanks, cavitation physics, thermocline refraction, and sonar SNR.
 * ============================================================================
 */

class SubmarinePhysics {
  constructor() {
    this.reset(20.25, 121.17, 90, 60);
  }

  reset(lat = 20.25, lon = 121.17, heading = 90, depth = 60) {
    // Geodetic position
    this.lat = lat;
    this.lon = lon;

    // Attitude & Kinematics
    this.heading = heading;          // 0..359.9 deg True
    this.orderedHeading = heading;
    this.speedKts = 8.0;             // Current water speed in knots
    this.orderedSpeedKts = 8.0;
    this.depthM = depth;             // Keel depth in meters
    this.orderedDepthM = depth;
    this.verticalSpeedMps = 0.0;     // + is diving, - is rising (m/s)
    this.pitchDeg = 0.0;             // + is bow up, - is bow down

    // Control Surfaces
    this.autoDepth = true;
    this.bowPlanesDeg = 0.0;         // -25 (dive) to +25 (rise)
    this.sternPlanesDeg = 0.0;       // -25 (dive) to +25 (rise)
    this.rudderDeg = 0.0;            // -30 (left) to +30 (right)
    this.manualRudder = false;

    // Main Ballast Tanks (MBT) & Trim System
    this.mbtFillPct = depth > 8 ? 100.0 : 0.0; // 100% = fully flooded for submerged ops
    this.mbtVentsOpen = false;
    this.mbtBlowState = 'OFF';       // 'OFF', 'NORMAL', 'EMERGENCY'
    this.hpAirPsi = 4500;            // 4500 PSI High Pressure Air Banks
    this.hpCompressorOn = false;

    // Variable Ballast (Auxiliary Trim Tank in metric tons: -30 light to +30 heavy)
    this.auxTrimTons = 0.0;
    this.autoNeutralTrim = true;
    this.hoverSystemActive = false;

    // Structural & Damage State
    this.hullIntegrityPct = 100.0;
    this.testDepthM = 490;
    this.crushDepthM = 730;

    // Sensors & Masts
    this.towedArrayDeployed = true;
    this.towedArrayDamaged = false;
    this.periscopeRaised = false;
    this.esmMastRaised = false;
    this.radarTxActive = false;

    // Acoustic Signature Telemetry
    this.cavitationSpeedKts = 16.0;
    this.isCavitating = false;
    this.radiatedNoiseDb = 92;       // Own-ship Source Level (SL) in dB
    this.transientNoiseDb = 0;       // Temporary spike from active ping, launch, blow

    // Countermeasures
    this.decoysRemaining = 8;

    // Waypoint navigation
    this.waypoint = null; // { lat, lon }
  }

  /**
   * Computes propeller cavitation threshold speed (knots) at current depth (meters).
   * Pump-jet propulsor on Virginia-class is resisted by hydrostatic pressure.
   */
  computeCavitationThreshold(depthM) {
    return Number((10.5 + 0.068 * Math.max(0, depthM)).toFixed(1));
  }

  /**
   * Adds an immediate acoustic transient (e.g., torpedo launch, active ping, emergency blow)
   */
  addAcousticTransient(dbBoost) {
    this.transientNoiseDb = Math.max(this.transientNoiseDb, dbBoost);
  }

  /**
   * Step submarine hydrodynamics, ballast, and acoustics by dt (seconds)
   */
  update(dt, reactorOutput, seafloorDepthM, thermoclineDepthM) {
    // 1. Decay temporary acoustic transients
    if (this.transientNoiseDb > 0) {
      this.transientNoiseDb = Math.max(0, this.transientNoiseDb - 8.5 * dt);
    }

    // 2. Waypoint auto-steering if active
    if (this.waypoint) {
      const distToWp = window.Bathymetry.distanceNm(this.lat, this.lon, this.waypoint.lat, this.waypoint.lon);
      if (distToWp < 0.25) {
        if (window.GameLogger) {
          window.GameLogger.log('CONN', 'Arrived at plotted navigation waypoint.', 'conn');
        }
        this.waypoint = null;
      } else {
        this.orderedHeading = Math.round(
          window.Bathymetry.bearingDeg(this.lat, this.lon, this.waypoint.lat, this.waypoint.lon)
        ) % 360;
      }
    }

    // 3. Speed & Propulsion Dynamics
    const targetSpeed = reactorOutput.effectiveOrderedSpeedKts;
    const accelRate = targetSpeed > this.speedKts ? 0.55 : 0.75; // knots per second
    if (Math.abs(targetSpeed - this.speedKts) <= accelRate * dt) {
      this.speedKts = targetSpeed;
    } else {
      this.speedKts += Math.sign(targetSpeed - this.speedKts) * accelRate * dt;
    }

    // Check Towed Array overspeed damage (> 25 kts)
    if (this.towedArrayDeployed && !this.towedArrayDamaged && Math.abs(this.speedKts) > 25.5) {
      this.towedArrayDamaged = true;
      this.towedArrayDeployed = false;
      if (window.GameLogger) {
        window.GameLogger.log('SONAR', 'CRITICAL: TB-29A Towed Array cable sheared due to overspeed (>25 KT)!', 'alert');
      }
    }

    // Check Mast / Periscope depth safety (> 20m snaps or auto-lowers masts)
    if (this.depthM > 20.5) {
      if (this.periscopeRaised || this.esmMastRaised || this.radarTxActive) {
        this.periscopeRaised = false;
        this.esmMastRaised = false;
        this.radarTxActive = false;
        if (window.GameLogger) {
          window.GameLogger.log('CONN', 'Submerging past 20m: Photonics Mast, ESM, and Radar automatically retracted.', 'conn');
        }
      }
    }

    // 4. Rudder & Heading Turn Rate
    if (!this.manualRudder) {
      // Autopilot helm computes shortest turn to orderedHeading
      let diff = ((this.orderedHeading - this.heading + 540) % 360) - 180;
      if (Math.abs(diff) < 0.5) {
        this.rudderDeg = 0;
        this.heading = this.orderedHeading;
      } else {
        this.rudderDeg = Math.max(-30, Math.min(30, diff * 1.2));
      }
    }

    // Turn rate depends on rudder angle and water flow over rudder
    const effectiveFlowKts = Math.max(1.5, Math.abs(this.speedKts));
    const turnRateDegPerSec = (this.rudderDeg / 30.0) * Math.min(3.2, effectiveFlowKts * 0.22) * (this.speedKts >= 0 ? 1 : -1);
    this.heading = (this.heading + turnRateDegPerSec * dt + 360) % 360;

    // 5. Main Ballast Tanks (MBT) & High-Pressure Air Physics
    if (this.mbtVentsOpen) {
      // Flooding MBTs
      this.mbtFillPct = Math.min(100.0, this.mbtFillPct + 14.0 * dt);
      if (this.mbtFillPct >= 100.0) {
        this.mbtVentsOpen = false;
      }
    }

    if (this.mbtBlowState === 'NORMAL') {
      if (this.hpAirPsi > 150) {
        this.mbtFillPct = Math.max(0.0, this.mbtFillPct - 5.5 * dt);
        this.hpAirPsi = Math.max(0, this.hpAirPsi - 28 * dt);
        this.addAcousticTransient(14);
        if (this.mbtFillPct <= 0) this.mbtBlowState = 'OFF';
      } else {
        this.mbtBlowState = 'OFF';
      }
    } else if (this.mbtBlowState === 'EMERGENCY') {
      if (this.hpAirPsi > 200) {
        this.mbtFillPct = Math.max(0.0, this.mbtFillPct - 24.0 * dt);
        this.hpAirPsi = Math.max(0, this.hpAirPsi - 140 * dt);
        this.addAcousticTransient(38); // Loud high-pressure roar!
        if (this.mbtFillPct <= 0) this.mbtBlowState = 'OFF';
      } else {
        this.mbtBlowState = 'OFF';
      }
    }

    // High Pressure Air Compressor (recharges HP air banks when at PD/Surface)
    if (this.hpCompressorOn) {
      if (this.depthM <= 20) {
        this.hpAirPsi = Math.min(4500, this.hpAirPsi + 45 * dt);
      } else {
        this.hpCompressorOn = false;
      }
    }

    // 6. Buoyancy & Trim Forces
    // Hull compression effect: deeper depth makes hull slightly heavier unless compensated by Variable Trim
    const hullCompressionTons = (this.depthM / 100.0) * 2.4;
    if (this.autoNeutralTrim || this.hoverSystemActive) {
      // Automatically pump/flood variable ballast to neutralize hull compression
      const targetAux = -hullCompressionTons;
      this.auxTrimTons += (targetAux - this.auxTrimTons) * Math.min(1, dt * 1.5);
    }

    // Positive buoyancy from unflooded MBT (+650 tons when 0% flooded) - Aux Trim + Hull Compression
    const mbtPositiveBuoyancyTons = (100.0 - this.mbtFillPct) * 6.5;
    const netBuoyancyTons = mbtPositiveBuoyancyTons - this.auxTrimTons - hullCompressionTons;

    // 7. Auto-Depth Controller & Hydroplanes (Bow & Stern Planes)
    if (this.autoDepth) {
      // If ordered depth > 5m and MBTs are not flooded, auto-open vents to submerge
      if (this.orderedDepthM > 5 && this.mbtFillPct < 99 && this.mbtBlowState === 'OFF') {
        this.mbtVentsOpen = true;
      }

      const depthError = this.orderedDepthM - this.depthM; // + means need to dive deeper
      // Target pitch angle based on depth error (clamped to ±18 deg)
      const desiredPitchDeg = Math.max(-18, Math.min(18, -depthError * 0.35 + this.verticalSpeedMps * 2.2));
      const pitchError = desiredPitchDeg - this.pitchDeg;

      this.sternPlanesDeg = Math.max(-25, Math.min(25, pitchError * 1.8));
      this.bowPlanesDeg = Math.max(-25, Math.min(25, -depthError * 0.45));
    }

    // Hydrodynamic plane authority scales with speed
    const planeAuthority = Math.min(1.0, Math.pow(Math.abs(this.speedKts) / 8.0, 1.4));
    const targetPitch = (this.sternPlanesDeg * 0.65 + this.bowPlanesDeg * 0.25) * planeAuthority + (netBuoyancyTons * 0.015);
    this.pitchDeg += (Math.max(-28, Math.min(28, targetPitch)) - this.pitchDeg) * Math.min(1, dt * 1.4);

    // Vertical velocity (m/s): positive = diving deeper, negative = rising
    const speedMps = this.speedKts * 0.514444;
    const hydrodynamicVerticalMps = -speedMps * Math.sin((this.pitchDeg * Math.PI) / 180) + (-this.bowPlanesDeg * 0.06 * planeAuthority);
    const buoyantVerticalMps = -netBuoyancyTons * 0.018; // Positive buoyancy pushes boat UP (-depth)

    const targetVertMps = hydrodynamicVerticalMps + buoyantVerticalMps;
    this.verticalSpeedMps += (targetVertMps - this.verticalSpeedMps) * Math.min(1, dt * 1.6);

    this.depthM += this.verticalSpeedMps * dt;

    // Surface clamp
    if (this.depthM <= 0) {
      this.depthM = 0;
      if (this.verticalSpeedMps < 0) this.verticalSpeedMps = 0;
      if (this.pitchDeg > 2) this.pitchDeg *= 0.8;
    }

    // Seafloor collision / grounding check
    const maxSafeKeel = Math.max(0, seafloorDepthM - 6);
    if (this.depthM > maxSafeKeel && seafloorDepthM > 0) {
      this.depthM = maxSafeKeel;
      this.verticalSpeedMps = 0;
      this.pitchDeg = Math.max(0, this.pitchDeg);
      if (Math.abs(this.speedKts) > 3) {
        const dmg = Math.abs(this.speedKts) * 0.35 * dt;
        this.hullIntegrityPct = Math.max(0, this.hullIntegrityPct - dmg);
        this.addAcousticTransient(35);
      }
    }

    // Test Depth & Crush Depth Hull Stress
    if (this.depthM > this.testDepthM) {
      const overDepth = this.depthM - this.testDepthM;
      const stressDmg = (overDepth / (this.crushDepthM - this.testDepthM)) * 2.8 * dt;
      this.hullIntegrityPct = Math.max(0, this.hullIntegrityPct - stressDmg);
      if (this.depthM >= this.crushDepthM) {
        this.hullIntegrityPct = 0;
      }
    }

    // 8. Advance Geodetic Position (Lat / Lon)
    const distanceNmStep = (this.speedKts * dt) / 3600.0;
    if (Math.abs(distanceNmStep) > 0) {
      const moveBrg = distanceNmStep >= 0 ? this.heading : (this.heading + 180) % 360;
      const nextPos = window.Bathymetry.destinationPoint(this.lat, this.lon, moveBrg, Math.abs(distanceNmStep));
      const nextDepth = window.Bathymetry.getSeafloorDepthMeters(nextPos.lat, nextPos.lon);

      if (nextDepth <= 4) {
        // Land / shoal collision! Stop boat
        this.speedKts = 0;
        this.orderedSpeedKts = 0;
        this.hullIntegrityPct = Math.max(0, this.hullIntegrityPct - 5);
        this.addAcousticTransient(40);
        if (window.GameLogger) {
          window.GameLogger.log('CONN', 'GROUNDING ALERT! Shoal or landmass ahead! All Stop!', 'alert');
        }
      } else {
        this.lat = nextPos.lat;
        this.lon = nextPos.lon;
      }
    }

    // 9. Cavitation & Own-Ship Acoustic Radiated Noise (dB re 1 uPa)
    this.cavitationSpeedKts = this.computeCavitationThreshold(this.depthM);
    this.isCavitating = Math.abs(this.speedKts) > this.cavitationSpeedKts;

    // Virginia-class baseline quietness: ~88 dB at creep
    const flowNoiseDb = Math.pow(Math.abs(this.speedKts), 1.45) * 0.95;
    const cavPenaltyDb = this.isCavitating ? 46.0 : 0.0;
    this.radiatedNoiseDb = Math.round(
      88.0 +
      flowNoiseDb +
      reactorOutput.plantNoiseDb +
      cavPenaltyDb +
      this.transientNoiseDb
    );
  }

  /**
   * Computes Passive Sonar Signal Excess (SNR in dB) from a target to a listener.
   * Positive SNR means the contact is detectable above ambient + self-noise.
   */
  computePassiveSonarSNR({
    sourceLat,
    sourceLon,
    sourceDepthM,
    sourceNoiseDb,
    listenerLat,
    listenerLon,
    listenerDepthM,
    listenerHeading,
    listenerSpeedKts,
    listenerHasTowedArray,
    thermoclineDepthM
  }) {
    const rangeNm = Math.max(0.05, window.Bathymetry.distanceNm(listenerLat, listenerLon, sourceLat, sourceLon));
    const rangeMeters = rangeNm * 1852.0;

    // Spherical/Cylindrical Spreading Loss + Sea Absorption (~0.08 dB/km at low-mid freq)
    const spreadingLossDb = 18.0 * Math.log10(rangeMeters) + 0.08 * (rangeMeters / 1000.0);

    // Thermal Layer (Thermocline) Refraction Shadow Loss (-14 dB if on opposite sides of layer)
    let layerLossDb = 0;
    if (thermoclineDepthM) {
      const sourceAbove = sourceDepthM < thermoclineDepthM;
      const listenerAbove = listenerDepthM < thermoclineDepthM;
      if (sourceAbove !== listenerAbove) {
        layerLossDb = 14.0;
      }
    }

    // Relative bearing for Baffles check (150° to 210° relative is astern blind zone)
    const trueBrg = window.Bathymetry.bearingDeg(listenerLat, listenerLon, sourceLat, sourceLon);
    const relBrg = (trueBrg - listenerHeading + 360) % 360;
    const inAsternBaffles = relBrg >= 150 && relBrg <= 210;

    let arrayGainDb = 16.0; // Spherical Bow Array directivity index
    if (inAsternBaffles) {
      if (listenerHasTowedArray && Math.abs(listenerSpeedKts) < 20) {
        // Towed array covers astern baffles (except dead astern 176-184 deg cable cone)
        arrayGainDb = (relBrg >= 176 && relBrg <= 184) ? 2.0 : 18.0;
      } else {
        // Blinded by own propulsor & hull baffles!
        arrayGainDb = -14.0;
      }
    } else if (listenerHasTowedArray && Math.abs(listenerSpeedKts) < 16) {
      // Broadside towed array aperture bonus
      arrayGainDb = 21.0;
    }

    // Ambient Sea State 3 Noise (~62 dB effective in band) + Listener Own-Ship Flow Self-Noise
    const selfNoiseDb = 58.0 + Math.pow(Math.abs(listenerSpeedKts), 1.55) * 1.1;

    const snrDb = sourceNoiseDb - spreadingLossDb - layerLossDb - selfNoiseDb + arrayGainDb;
    return {
      snrDb: Number(snrDb.toFixed(1)),
      trueBrg: Number(trueBrg.toFixed(1)),
      relBrg: Number(relBrg.toFixed(1)),
      rangeNm: Number(rangeNm.toFixed(2)),
      inBaffles: inAsternBaffles && !listenerHasTowedArray
    };
  }
}

window.SubPhysics = new SubmarinePhysics();
