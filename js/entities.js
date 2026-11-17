/**
 * ============================================================================
 * TACTICAL ENTITIES: CONTACTS (HOSTILE, NATO FRIENDLY, AIS NEUTRAL, BIOLOGIC),
 * TMA ENGINE, TORPEDOES, MISSILES, DECOYS & SAVE/LOAD SERIALIZATION
 * ============================================================================
 */

class ContactEntity {
  static shouldLaunchHostileTorpedo({
    hasContact, attackState, rangeNm, reloadTimerSec, torpedoesRemaining,
    shotsThisEngagement, activeHostileTorpedoes
  }) {
    return Boolean(hasContact && attackState === 'ATTACK') &&
      Number.isFinite(rangeNm) &&
      rangeNm >= 0.8 && rangeNm <= 5.0 &&
      reloadTimerSec <= 0 &&
      torpedoesRemaining > 0 &&
      shotsThisEngagement < 1 &&
      activeHostileTorpedoes < 2;
  }

  constructor(index, config) {
    this.id = config.id || `S-${index}`;
    this.designation = config.designation || `SIERRA-${index}`;
    this.profileId = config.profileId;
    this.profile = window.ACOUSTIC_PROFILES[config.profileId] || window.ACOUSTIC_PROFILES.KILO_636_SSK;
    this.trueName = config.trueName || this.profile.name;

    this.lat = config.lat;
    this.lon = config.lon;
    this.heading = config.heading ?? 0;
    this.orderedHeading = config.orderedHeading !== undefined ? config.orderedHeading : this.heading;
    this.speedKts = config.speedKts ?? 10;
    this.orderedSpeedKts = config.orderedSpeedKts !== undefined ? config.orderedSpeedKts : this.speedKts;
    this.depthM = config.depthM ?? 0;
    this.orderedDepthM = config.orderedDepthM !== undefined ? config.orderedDepthM : this.depthM;

    this.aiBehavior = config.aiBehavior || 'PATROL_TRANSIT';
    this.aiState = config.aiState || 'PATROL'; // 'PATROL', 'INVESTIGATE', 'ATTACK', 'EVADE'
    this.alertedBearing = config.alertedBearing !== undefined ? config.alertedBearing : null;
    this.activeSonarCooldown = config.activeSonarCooldown ?? (25 + Math.random() * 35);
    this.weaponReloadTimer = config.weaponReloadTimer ?? (20 + Math.random() * 40);
    this.torpedoesRemaining = config.torpedoesRemaining !== undefined ? config.torpedoesRemaining : (this.profile.torpedoCount || 0);
    this.hostileShotsThisEngagement = config.hostileShotsThisEngagement ?? 0;
    this.contactLostTimer = config.contactLostTimer ?? 0;
    this.decoysRemaining = config.decoysRemaining !== undefined ? config.decoysRemaining : 4;
    this.bioWanderTimer = config.bioWanderTimer ?? (20 + Math.random() * 40);

    this.hp = config.hp !== undefined ? config.hp : this.profile.hitPoints;
    this.maxHp = this.profile.hitPoints;
    this.sunk = Boolean(config.sunk);

    // Own-Ship Sonar & TMA Tracking State
    this.detected = Boolean(config.detected);
    this.snrDb = config.snrDb !== undefined ? config.snrDb : -20;
    this.lastTrueBrg = config.lastTrueBrg || 0;
    this.bearingRateDegMin = config.bearingRateDegMin || 0;
    this.tmaQualityPct = config.tmaQualityPct || 0;
    this.classifiedAs = config.classifiedAs || null;
    this.estRangeNm = config.estRangeNm || 6.0;
    this.estHeading = config.estHeading || 0;
    this.estSpeedKts = config.estSpeedKts || 10;
    this.tmaObservable = Boolean(config.tmaObservable);
    this.tmaRmsDeg = config.tmaRmsDeg || 0;
    this.helicopterLaunched = Boolean(config.helicopterLaunched);
    this.tmaSolver = window.BearingOnlyTMASolver
      ? new window.BearingOnlyTMASolver(config.tmaState || null)
      : null;
  }

  serialize() {
    return {
      id: this.id,
      designation: this.designation,
      profileId: this.profileId,
      trueName: this.trueName,
      lat: this.lat,
      lon: this.lon,
      heading: this.heading,
      orderedHeading: this.orderedHeading,
      speedKts: this.speedKts,
      orderedSpeedKts: this.orderedSpeedKts,
      depthM: this.depthM,
      orderedDepthM: this.orderedDepthM,
      aiBehavior: this.aiBehavior,
      aiState: this.aiState,
      alertedBearing: this.alertedBearing,
      activeSonarCooldown: this.activeSonarCooldown,
      weaponReloadTimer: this.weaponReloadTimer,
      hostileShotsThisEngagement: this.hostileShotsThisEngagement,
      contactLostTimer: this.contactLostTimer,
      bioWanderTimer: this.bioWanderTimer,
      torpedoesRemaining: this.torpedoesRemaining,
      decoysRemaining: this.decoysRemaining,
      hp: this.hp,
      sunk: this.sunk,
      detected: this.detected,
      snrDb: this.snrDb,
      lastTrueBrg: this.lastTrueBrg,
      bearingRateDegMin: this.bearingRateDegMin,
      tmaQualityPct: this.tmaQualityPct,
      classifiedAs: this.classifiedAs,
      estRangeNm: this.estRangeNm,
      estHeading: this.estHeading,
      estSpeedKts: this.estSpeedKts,
      tmaObservable: this.tmaObservable,
      tmaRmsDeg: this.tmaRmsDeg,
      tmaState: this.tmaSolver ? this.tmaSolver.serialize() : null
    };
  }

  getRadiatedNoiseDb() {
    if (this.sunk) return 0;
    if (this.profile.category === 'BIOLOGIC') {
      // Whales/Dolphins emit intermittent biological songs and echolocation clicks
      return this.profile.baseNoiseDb;
    }
    const speedFactor = Math.pow(Math.abs(this.speedKts), 1.35) * 0.75;
    let cavBonus = 0;
    if (this.profile.category === 'SUBMARINE') {
      const cavSpd = 10.0 + 0.065 * this.depthM;
      if (this.speedKts > cavSpd) cavBonus = 42;
    } else if (this.speedKts > 20) {
      cavBonus = 18;
    }
    return this.profile.baseNoiseDb + speedFactor + cavBonus;
  }

  update(dt, ownSub, thermoclineDepthM, world) {
    if (this.sunk) return;

    // 1. Biological Marine Mammal Wandering Behavior (Whales & Dolphins)
    if (this.profile.category === 'BIOLOGIC') {
      this.bioWanderTimer -= dt;
      if (this.bioWanderTimer <= 0) {
        this.bioWanderTimer = 25 + Math.random() * 45;
        this.orderedHeading = (this.heading + (Math.random() - 0.5) * 90 + 360) % 360;
        if (this.profile.id === 'BIO_SPERM_WHALE') {
          // Sperm whales dive deep (up to 350m) to hunt squid, then surface to breathe
          this.orderedDepthM = this.depthM > 120 ? 15 : 220 + Math.random() * 120;
        } else {
          this.orderedDepthM = 10 + Math.random() * 45;
        }
      }
    }

    // 2. Kinematics
    let hdgDiff = ((this.orderedHeading - this.heading + 540) % 360) - 180;
    const turnRate = (this.profile.category === 'SUBMARINE' || this.profile.category === 'BIOLOGIC' ? 2.2 : 1.6) * dt;
    if (Math.abs(hdgDiff) <= turnRate) {
      this.heading = this.orderedHeading;
    } else {
      this.heading = (this.heading + Math.sign(hdgDiff) * turnRate + 360) % 360;
    }

    const spdDiff = this.orderedSpeedKts - this.speedKts;
    this.speedKts += Math.sign(spdDiff) * Math.min(Math.abs(spdDiff), 0.5 * dt);

    if (this.profile.category === 'SUBMARINE' || this.profile.category === 'BIOLOGIC') {
      const dDiff = this.orderedDepthM - this.depthM;
      this.depthM += Math.sign(dDiff) * Math.min(Math.abs(dDiff), 2.2 * dt);
    } else {
      this.depthM = 0;
    }

    const distNm = (this.speedKts * dt) / 3600.0;
    const nextPt = window.Bathymetry.destinationPoint(this.lat, this.lon, this.heading, distNm);
    const nextFloor = window.Bathymetry.getSeafloorDepthMeters(nextPt.lat, nextPt.lon);

    if (nextFloor < (this.profile.category === 'SUBMARINE' ? 35 : 12)) {
      this.orderedHeading = (this.heading + 125) % 360;
    } else {
      this.lat = nextPt.lat;
      this.lon = nextPt.lon;
      if ((this.profile.category === 'SUBMARINE' || this.profile.category === 'BIOLOGIC') && this.depthM > nextFloor - 15) {
        this.orderedDepthM = Math.max(15, nextFloor - 25);
      }
    }

    // 3. Hostile Non-NATO AI Sensor & Tactical Logic
    if (this.profile.allegiance === 'HOSTILE') {
      this.updateHostileAI(dt, ownSub, thermoclineDepthM, world);
    }

    // 4. Player Sonar Detection & True Bearing-Only TMA Solution Update
    this.updatePlayerTMA(dt, ownSub, thermoclineDepthM, world);
  }

  updateHostileAI(dt, ownSub, thermoclineDepthM, world) {
    if (this.weaponReloadTimer > 0) this.weaponReloadTimer -= dt;
    if (this.activeSonarCooldown > 0) this.activeSonarCooldown -= dt;

    // Check if an incoming player torpedo is close (< 1.8 NM) -> EVADE!
    const incomingTorp = world.weapons.find(
      (w) => w.isPlayer && w.type === 'TORPEDO' && !w.exploded &&
      window.Bathymetry.distanceNm(this.lat, this.lon, w.lat, w.lon) < 1.8
    );

    if (incomingTorp) {
      if (this.aiState !== 'EVADE') {
        this.aiState = 'EVADE';
        const torpBrg = window.Bathymetry.bearingDeg(this.lat, this.lon, incomingTorp.lat, incomingTorp.lon);
        this.orderedHeading = (torpBrg + 155) % 360;
        this.orderedSpeedKts = this.profile.maxSpeedKts;
        if (this.profile.category === 'SUBMARINE') {
          this.orderedDepthM = this.depthM < 100 ? 220 : 45;
        }
        if (this.decoysRemaining > 0) {
          this.decoysRemaining--;
          world.spawnDecoy(this.lat, this.lon, this.depthM, false, this.designation);
        }
      }
      return;
    } else if (this.aiState === 'EVADE') {
      this.aiState = 'INVESTIGATE';
      this.orderedSpeedKts = 12;
    }

    // Listen passively for USS Virginia
    const passiveCheck = window.SubPhysics.computePassiveSonarSNR({
      sourceLat: ownSub.lat,
      sourceLon: ownSub.lon,
      sourceDepthM: ownSub.depthM,
      sourceNoiseDb: ownSub.radiatedNoiseDb,
      listenerLat: this.lat,
      listenerLon: this.lon,
      listenerDepthM: this.depthM,
      listenerHeading: this.heading,
      listenerSpeedKts: this.speedKts,
      listenerHasTowedArray: this.profile.category === 'SUBMARINE' || this.profile.id === 'GRIGOROVICH_FFG',
      thermoclineDepthM
    });

    const trueRangeNm = passiveCheck.rangeNm;
    const brgToPlayer = window.Bathymetry.bearingDeg(this.lat, this.lon, ownSub.lat, ownSub.lon);
    let detectedPlayer = passiveCheck.snrDb > 2.5;

    // Counter-detection: Surface warships & submarines can spot exposed Radar, Periscope, ESM, or Diesel Snorkel
    const isSurfaceUnit = this.profile.category === 'SURFACE_WARSHIP';
    const periscopeExposed = ownSub.periscopeRaised && ownSub.depthM <= 20.5 && trueRangeNm < (isSurfaceUnit ? 4.8 : 2.2);
    const esmExposed = ownSub.esmMastRaised && ownSub.depthM <= 20.5 && trueRangeNm < (isSurfaceUnit ? 3.8 : 1.8);
    const dieselSnorkeling = window.ReactorPlant && window.ReactorPlant.dieselRunning && ownSub.depthM <= 20.5 && trueRangeNm < 7.2;

    if ((ownSub.radarTxActive && trueRangeNm < 18.0) || periscopeExposed || esmExposed || dieselSnorkeling) {
      detectedPlayer = true;
    }

    // Also check if any friendly ASW Sonobuoy detected the submarine nearby
    if (!detectedPlayer && Array.isArray(world.sonobuoys)) {
      const hotBuoy = world.sonobuoys.find(
        (b) => b.detectedSub && window.Bathymetry.distanceNm(this.lat, this.lon, b.lat, b.lon) < 12.0
      );
      if (hotBuoy) {
        detectedPlayer = true;
      }
    }

    if (detectedPlayer) {
      this.contactLostTimer = 0;
      this.alertedBearing = brgToPlayer + (Math.random() - 0.5) * 4.0;
      this.aiState = passiveCheck.snrDb > 9.0 || trueRangeNm < 5.5 || periscopeExposed ? 'ATTACK' : 'INVESTIGATE';

      // Launch Ka-27 Helix ASW Helicopter from surface warships if not yet airborne
      if (isSurfaceUnit && !this.helicopterLaunched && typeof world.launchAswHelicopter === 'function') {
        this.helicopterLaunched = true;
        world.launchAswHelicopter(this, ownSub.lat, ownSub.lon);
      }
    } else {
      this.contactLostTimer += dt;
      if (this.contactLostTimer >= 90 && this.hostileShotsThisEngagement > 0) {
        this.hostileShotsThisEngagement = 0;
        this.alertedBearing = null;
        this.aiState = 'INVESTIGATE';
        this.weaponReloadTimer = Math.max(this.weaponReloadTimer, 90);
      }
    }

    if (this.aiState === 'INVESTIGATE' && this.alertedBearing !== null) {
      this.orderedHeading = Math.round(this.alertedBearing) % 360;
      this.orderedSpeedKts = 14;

      if (this.profile.hasActiveSonar && this.activeSonarCooldown <= 0 && trueRangeNm < 9.5) {
        this.activeSonarCooldown = 32 + Math.random() * 20;
        if (window.SubAudio) window.SubAudio.playHostilePing(22);
        if (window.GameLogger) {
          window.GameLogger.log(
            'SONAR',
            `Conn, Sonar! Non-NATO active sonar ping received from ${this.designation} bearing ${Math.round((brgToPlayer + 180) % 360).toString().padStart(3, '0')}°!`,
            'alert'
          );
        }
        world.lastHostilePingTime = world.simTimeSec;
        if (trueRangeNm < 7.5) {
          this.aiState = 'ATTACK';
        }
      }
    } else if (this.aiState === 'ATTACK' && this.alertedBearing !== null) {
      this.orderedHeading = Math.round(this.alertedBearing) % 360;
      this.orderedSpeedKts = 16;

      const activeHostileTorpedoes = world.weapons.filter(
        (weapon) => !weapon.isPlayer && weapon.type === 'TORPEDO' && !weapon.exploded
      ).length;
      const launchAuthorized = ContactEntity.shouldLaunchHostileTorpedo({
        hasContact: detectedPlayer,
        attackState: this.aiState,
        rangeNm: trueRangeNm,
        reloadTimerSec: this.weaponReloadTimer,
        torpedoesRemaining: this.torpedoesRemaining,
        shotsThisEngagement: this.hostileShotsThisEngagement,
        activeHostileTorpedoes
      });

      if (launchAuthorized && world.fireHostileTorpedo(this, brgToPlayer, ownSub.depthM)) {
        this.torpedoesRemaining--;
        this.hostileShotsThisEngagement++;
        this.weaponReloadTimer = 210 + Math.random() * 90;
      }
    }
  }

  updatePlayerTMA(dt, ownSub, thermoclineDepthM, world) {
    const prevBrg = this.lastTrueBrg;
    const sonarResult = window.SubPhysics.computePassiveSonarSNR({
      sourceLat: this.lat,
      sourceLon: this.lon,
      sourceDepthM: this.depthM,
      sourceNoiseDb: this.getRadiatedNoiseDb(),
      listenerLat: ownSub.lat,
      listenerLon: ownSub.lon,
      listenerDepthM: ownSub.depthM,
      listenerHeading: ownSub.heading,
      listenerSpeedKts: ownSub.speedKts,
      listenerHasTowedArray: ownSub.towedArrayDeployed,
      listenerBowArrayHealth: ownSub.damageControl.getSystemHealth('sonar'),
      thermoclineDepthM
    });

    this.snrDb = sonarResult.snrDb;
    this.lastTrueBrg = sonarResult.trueBrg;

    let dBrg = ((this.lastTrueBrg - prevBrg + 540) % 360) - 180;
    if (dt > 0) {
      const instRate = (dBrg / dt) * 60.0;
      this.bearingRateDegMin = this.bearingRateDegMin * 0.8 + instRate * 0.2;
    }

    // Friendly NATO units share Link-16/IFF position data; Commercial AIS ships broadcast AIS when at Periscope Depth!
    const isFriendlyLink = this.profile.allegiance === 'FRIENDLY';
    const isAisBroadcast = this.profile.allegiance === 'NEUTRAL' && ownSub.esmMastRaised && ownSub.depthM <= 20 && sonarResult.rangeNm <= 18.0;
    const canSeeOnRadar = ownSub.radarTxActive && this.depthM <= 2 && sonarResult.rangeNm <= 16.0;
    const canSeeOnScope = ownSub.periscopeRaised && this.depthM <= 5 && sonarResult.rangeNm <= 9.0;
    const hasDirectRangeAid = canSeeOnRadar || canSeeOnScope || isFriendlyLink || isAisBroadcast;

    if (this.snrDb >= 0 || hasDirectRangeAid) {
      if (!this.detected) {
        this.detected = true;
        if (isFriendlyLink) {
          this.classifiedAs = this.profile.id;
        }
        if (isAisBroadcast && !this.classifiedAs) {
          this.classifiedAs = this.profile.id;
        }
        if (window.SubAudio) {
          if (this.profile.category === 'BIOLOGIC') {
            window.SubAudio.playWhaleSong();
          } else {
            window.SubAudio.playConsoleBeep(1480, 0.08);
          }
        }
        if (window.GameLogger) {
          const src = isFriendlyLink ? 'NATO LINK-16' : isAisBroadcast ? 'AIS TRANSPONDER' : canSeeOnRadar ? 'RADAR' : 'SONAR';
          window.GameLogger.log(
            'SONAR',
            `New contact designated ${this.designation}, bearing ${Math.round(this.lastTrueBrg).toString().padStart(3, '0')}° via ${src}!`,
            'sonar'
          );
        }
      }

      if (this.tmaSolver) {
        const simTimeSec = world && Number.isFinite(world.simTimeSec) ? world.simTimeSec : (Date.now() / 1000);
        // Passive sonar bearing noise depends on SNR & towed array aperture
        const snrFactor = Math.max(0.35, Math.min(1.6, 1.4 - this.snrDb * 0.035));
        const baseSigma = ownSub.towedArrayDeployed ? 0.45 : 0.85;
        const bearingSigmaDeg = baseSigma * snrFactor;
        const measuredBrg = hasDirectRangeAid
          ? sonarResult.trueBrg
          : (sonarResult.trueBrg + (Math.random() - 0.5) * 1.6 * bearingSigmaDeg + 360) % 360;

        this.tmaSolver.addObservation({
          timeSec: simTimeSec,
          ownLat: ownSub.lat,
          ownLon: ownSub.lon,
          bearingDeg: measuredBrg,
          rangeNm: hasDirectRangeAid ? sonarResult.rangeNm : null,
          bearingSigmaDeg
        });

        const sol = this.tmaSolver.solve(simTimeSec, ownSub.lat, ownSub.lon);
        this.estRangeNm = sol.estRangeNm;
        this.estHeading = sol.estHeading;
        this.estSpeedKts = sol.estSpeedKts;
        this.tmaQualityPct = hasDirectRangeAid ? Math.max(sol.qualityPct, 96) : sol.qualityPct;
        this.tmaObservable = sol.observable;
        this.tmaRmsDeg = sol.rmsDeg;
      }
    } else {
      this.tmaQualityPct = Math.max(0, this.tmaQualityPct - 0.6 * dt);
      if (this.tmaQualityPct <= 0) {
        this.detected = false;
      }
    }
  }
}

class WeaponEntity {
  constructor(config) {
    this.id = config.id;
    this.name = config.name || 'MK-48 ADCAP';
    this.type = config.type || 'TORPEDO';
    this.isPlayer = config.isPlayer !== false;
    this.tubeIndex = config.tubeIndex || 1;

    this.lat = config.lat;
    this.lon = config.lon;
    this.depthM = config.depthM ?? 40;
    this.orderedDepthM = config.orderedDepthM ?? 40;
    this.heading = config.heading || 0;
    this.orderedHeading = config.orderedHeading !== undefined ? config.orderedHeading : this.heading;
    this.speedKts = config.speedKts ?? 40;

    this.runDistanceYds = config.runDistanceYds ?? 0;
    this.maxRunYds = this.type === 'MISSILE' ? 95000 : 36000;
    this.enableDistanceYds = config.enableDistanceYds ?? 1200;

    this.seekerMode = config.seekerMode || 'ACTIVE_PASSIVE';
    this.searchPattern = config.searchPattern || 'SNAKE';
    this.seekerActive = Boolean(config.seekerActive);
    this.wireConnected = config.wireConnected !== undefined ? config.wireConnected : (this.isPlayer && this.type === 'TORPEDO');
    this.launchHeading = config.launchHeading ?? config.heading ?? 0;
    this.maxWireYds = config.maxWireYds ?? 30000;
    this.lockedTarget = null;
    this.exploded = Boolean(config.exploded);
    this.snakePhase = config.snakePhase ?? 0;
  }

  serialize() {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      isPlayer: this.isPlayer,
      tubeIndex: this.tubeIndex,
      lat: this.lat,
      lon: this.lon,
      depthM: this.depthM,
      orderedDepthM: this.orderedDepthM,
      heading: this.heading,
      orderedHeading: this.orderedHeading,
      speedKts: this.speedKts,
      runDistanceYds: this.runDistanceYds,
      enableDistanceYds: this.enableDistanceYds,
      seekerMode: this.seekerMode,
      searchPattern: this.searchPattern,
      seekerActive: this.seekerActive,
      wireConnected: this.wireConnected,
      launchHeading: this.launchHeading,
      exploded: this.exploded,
      snakePhase: this.snakePhase
    };
  }

  update(dt, ownSub, contacts, decoys, thermoclineDepthM, world) {
    if (this.exploded) return;

    if (this.wireConnected) {
      const turnDelta = Math.abs(((ownSub.heading - this.launchHeading + 540) % 360) - 180);
      if (Math.abs(ownSub.speedKts) > 22.5) {
        this.wireConnected = false;
        if (window.GameLogger) {
          window.GameLogger.log('WEPS', `Tube ${this.tubeIndex} MK-48 fiber-optic wire parted due to own-ship speed > 22 kts!`, 'weps');
        }
      } else if (turnDelta > 110) {
        this.wireConnected = false;
        if (window.GameLogger) {
          window.GameLogger.log('WEPS', `Tube ${this.tubeIndex} MK-48 fiber-optic wire parted due to sharp turn (>110° from launch bearing)!`, 'weps');
        }
      } else if (this.runDistanceYds >= this.maxWireYds) {
        this.wireConnected = false;
        if (window.GameLogger) {
          window.GameLogger.log('WEPS', `Tube ${this.tubeIndex} MK-48 fiber-optic wire spool exhausted (${this.maxWireYds} yds).`, 'weps');
        }
      }
    }

    if (!this.seekerActive && this.runDistanceYds >= this.enableDistanceYds) {
      this.seekerActive = true;
      if (this.isPlayer && window.GameLogger) {
        window.GameLogger.log('WEPS', `${this.name} (${this.id}) reached enable point (${Math.round(this.runDistanceYds)} yds) — Seeker ACTIVE!`, 'weps');
      }
    }

    if (this.seekerActive) {
      this.updateSeekerHoming(dt, ownSub, contacts, decoys, thermoclineDepthM);
    }

    let hdgDiff = ((this.orderedHeading - this.heading + 540) % 360) - 180;
    const maxTurnRate = (this.type === 'MISSILE' ? 12.0 : 9.5) * dt;
    if (Math.abs(hdgDiff) <= maxTurnRate) {
      this.heading = this.orderedHeading;
    } else {
      this.heading = (this.heading + Math.sign(hdgDiff) * maxTurnRate + 360) % 360;
    }

    if (this.type === 'MISSILE') {
      this.depthM = 0;
    } else {
      const dDiff = this.orderedDepthM - this.depthM;
      this.depthM += Math.sign(dDiff) * Math.min(Math.abs(dDiff), 8.5 * dt);
    }

    const stepNm = (this.speedKts * dt) / 3600.0;
    const stepYds = stepNm * 2025.37;
    this.runDistanceYds += stepYds;

    const nextPos = window.Bathymetry.destinationPoint(this.lat, this.lon, this.heading, stepNm);
    this.lat = nextPos.lat;
    this.lon = nextPos.lon;

    // Destroy torpedo if it strikes land, reef, or runs into the seafloor
    if (this.type === 'TORPEDO') {
      const hitLandMask = window.CoastlineModel && window.CoastlineModel.isLand
        ? window.CoastlineModel.isLand(this.lat, this.lon)
        : false;
      const seafloorM = window.Bathymetry.getSeafloorDepthMeters(this.lat, this.lon);
      const hitSeafloor = seafloorM <= 4 || this.depthM >= seafloorM;

      if (hitLandMask || hitSeafloor) {
        this.exploded = true;
        this.wireConnected = false;
        const distFromPlayer = window.Bathymetry.distanceNm(ownSub.lat, ownSub.lon, this.lat, this.lon);
        if (window.SubAudio) window.SubAudio.playExplosion(distFromPlayer);
        if (window.GameLogger) {
          const reason = hitLandMask || seafloorM <= 4 ? 'LAND / COASTLINE' : `SEABED (${seafloorM}m)`;
          const msg = this.isPlayer
            ? `TORPEDO DESTROYED: ${this.name} (${this.id}) impacted ${reason} at ${Math.round(this.runDistanceYds)} yds!`
            : `INCOMING THREAT DESTROYED: Hostile torpedo (${this.id}) impacted ${reason}!`;
          window.GameLogger.log('WEPS', msg, 'alert');
        }
        return;
      }
    }

    this.checkImpact(ownSub, contacts, world);

    if (this.runDistanceYds >= this.maxRunYds && !this.exploded) {
      this.exploded = true;
      if (window.GameLogger) {
        window.GameLogger.log('WEPS', `${this.name} (${this.id}) fuel exhausted at ${Math.round(this.runDistanceYds)} yds.`, 'weps');
      }
    }
  }

  updateSeekerHoming(dt, ownSub, contacts, decoys, thermoclineDepthM) {
    if (this.type === 'TORPEDO') {
      for (const decoy of decoys) {
        const dNm = window.Bathymetry.distanceNm(this.lat, this.lon, decoy.lat, decoy.lon);
        if (dNm < 1.1) {
          const brg = window.Bathymetry.bearingDeg(this.lat, this.lon, decoy.lat, decoy.lon);
          const rel = Math.abs(((brg - this.heading + 540) % 360) - 180);
          if (rel <= 42) {
            this.orderedHeading = brg;
            this.orderedDepthM = decoy.depthM;
            return;
          }
        }
      }
    }

    const maxAcquireNm = this.type === 'MISSILE' ? 6.5 : 2.4;
    let bestTarget = null;
    let bestDistNm = maxAcquireNm;

    // MK-48 ADCAP CBASS digital guidance filters out biological whale/dolphin returns unless no metal hull is present
    const candidateList = this.isPlayer
      ? contacts.filter((c) => !c.sunk && c.profile.category !== 'BIOLOGIC')
      : [ownSub];

    for (const cand of candidateList) {
      if (this.type === 'MISSILE' && cand.depthM > 5) continue;

      const dNm = window.Bathymetry.distanceNm(this.lat, this.lon, cand.lat, cand.lon);
      if (dNm > bestDistNm) continue;

      const brg = window.Bathymetry.bearingDeg(this.lat, this.lon, cand.lat, cand.lon);
      const rel = Math.abs(((brg - this.heading + 540) % 360) - 180);

      let effectiveAcquireNm = maxAcquireNm;
      if (this.type === 'TORPEDO' && thermoclineDepthM) {
        const torpAbove = this.depthM < thermoclineDepthM;
        const tgtAbove = cand.depthM < thermoclineDepthM;
        if (torpAbove !== tgtAbove) {
          effectiveAcquireNm *= 0.45;
        }
      }

      if (dNm <= effectiveAcquireNm && rel <= 42) {
        bestDistNm = dNm;
        bestTarget = cand;
      }
    }

    if (bestTarget) {
      if (this.lockedTarget !== bestTarget) {
        this.lockedTarget = bestTarget;
        if (this.type === 'TORPEDO' && this.speedKts < 50) {
          this.speedKts = 52;
        }
        if (this.isPlayer && window.GameLogger) {
          const tgtLabel = bestTarget.designation || 'TARGET';
          window.GameLogger.log('WEPS', `${this.name} (${this.id}) ACQUIRED ${tgtLabel}! Homing in at ${this.speedKts} KT!`, 'weps');
        }
      }
      this.orderedHeading = window.Bathymetry.bearingDeg(this.lat, this.lon, bestTarget.lat, bestTarget.lon);
      if (this.type === 'TORPEDO') {
        this.orderedDepthM = bestTarget.depthM;
      }
    } else {
      this.lockedTarget = null;
      if (this.searchPattern === 'SNAKE') {
        this.snakePhase += dt * 0.45;
        this.orderedHeading = (this.heading + Math.sin(this.snakePhase) * 18 + 360) % 360;
      } else if (this.searchPattern === 'CIRCLE') {
        this.orderedHeading = (this.heading + 15 * dt) % 360;
      }
    }
  }

  checkImpact(ownSub, contacts, world) {
    const hitRadiusNm = 0.065;

    if (this.isPlayer) {
      for (const c of contacts) {
        if (c.sunk) continue;
        const dNm = window.Bathymetry.distanceNm(this.lat, this.lon, c.lat, c.lon);
        const dDepth = Math.abs(this.depthM - c.depthM);
        if (dNm <= hitRadiusNm && (this.type === 'MISSILE' ? c.depthM <= 5 : dDepth <= 28)) {
          this.exploded = true;
          this.wireConnected = false;

          const dmg = this.type === 'MISSILE' ? 95 : 115;
          c.hp = Math.max(0, c.hp - dmg);
          const distFromPlayer = window.Bathymetry.distanceNm(ownSub.lat, ownSub.lon, c.lat, c.lon);
          if (window.SubAudio) window.SubAudio.playExplosion(distFromPlayer);

          if (c.hp <= 0) {
            c.sunk = true;
            if (window.GameLogger) {
              window.GameLogger.log(
                'SONAR',
                `HIT! Target ${c.designation} (${c.trueName}) destroyed!`,
                'weps'
              );
            }
            world.onContactSunk(c);
          } else {
            if (window.GameLogger) {
              window.GameLogger.log(
                'SONAR',
                `DETONATION on ${c.designation} (${c.trueName})! Target heavily damaged (${Math.round((c.hp / c.maxHp) * 100)}% hull remaining).`,
                'weps'
              );
            }
          }
          return;
        }
      }
    } else {
      // Hostile weapon checking impact against USS Virginia
      const dNm = window.Bathymetry.distanceNm(this.lat, this.lon, ownSub.lat, ownSub.lon);
      const dDepth = Math.abs(this.depthM - ownSub.depthM);
      if (dNm <= hitRadiusNm && dDepth <= 28) {
        this.exploded = true;
        if (window.SubAudio) window.SubAudio.playExplosion(0.1);
        ownSub.hullIntegrityPct = Math.max(0, ownSub.hullIntegrityPct - 42);
        const incomingBearing = window.Bathymetry.bearingDeg(ownSub.lat, ownSub.lon, this.lat, this.lon);
        const relativeBearing = (incomingBearing - ownSub.heading + 360) % 360;
        const hitZone = relativeBearing < 36 || relativeBearing >= 324
          ? 'bow'
          : relativeBearing < 108
          ? 'operations'
          : relativeBearing < 180
          ? 'reactor'
          : relativeBearing < 252
          ? 'engineering'
          : 'stern';
        ownSub.damageControl.applyHit(hitZone, 42, 24);
        ownSub.addAcousticTransient(50);
        if (window.GameLogger) {
          window.GameLogger.log(
            'ENG',
            `TORPEDO IMPACT! ${hitZone.toUpperCase()} COMPARTMENT HIT // Hull integrity ${Math.round(ownSub.hullIntegrityPct)}% // Flooding reported.`,
            'alert'
          );
        }
        if (Math.random() < 0.45 && window.ReactorPlant.status === 'CRITICAL') {
          window.ReactorPlant.triggerScram('SHOCKWAVE SEISMIC TRIP FROM TORPEDO DETONATION');
        }
      }
    }
  }
}

window.ContactEntity = ContactEntity;
window.WeaponEntity = WeaponEntity;
