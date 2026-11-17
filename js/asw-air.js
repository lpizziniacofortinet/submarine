/**
 * ============================================================================
 * ASW HELICOPTERS (KA-27 HELIX) & SONOBUOY FIELD SIMULATION
 * Launched by Non-NATO surface warships (Slava CG, Gorshkov/Grigorovich FFG)
 * when investigating or attacking a submarine datum.
 * ============================================================================
 */
(function (root) {
  'use strict';

  class SonobuoyEntity {
    constructor(config) {
      this.id = config.id;
      this.lat = config.lat;
      this.lon = config.lon;
      this.ownerName = config.ownerName || 'HELIX';
      this.ttlSec = config.ttlSec ?? 180;
      this.pingCooldown = config.pingCooldown ?? 8;
      this.detectedSub = false;
    }

    update(dt, ownSub, thermoclineDepthM, world) {
      this.ttlSec -= dt;
      if (this.ttlSec <= 0) return;

      this.pingCooldown -= dt;
      const distNm = window.Bathymetry.distanceNm(this.lat, this.lon, ownSub.lat, ownSub.lon);
      // Sonobuoy hydrophone hangs at ~30m (above layer) unless deep-setting
      const layerPenalty = thermoclineDepthM && ownSub.depthM > thermoclineDepthM ? 0.55 : 1.0;

      // Passive DIFAR detection
      const passiveRangeNm = Math.max(0.4, ((ownSub.radiatedNoiseDb - 82) / 22) * layerPenalty);
      if (distNm <= passiveRangeNm) {
        this.detectedSub = true;
      }

      // Active DICASS ping every 14s
      if (this.pingCooldown <= 0) {
        this.pingCooldown = 14;
        if (distNm <= 3.5) {
          if (window.SubAudio) window.SubAudio.playHostilePing(14);
          if (world) world.lastHostilePingTime = world.simTimeSec;
        }
        if (distNm <= 2.2 * layerPenalty) {
          this.detectedSub = true;
        }
      }
    }
  }

  class AswHelicopterEntity {
    constructor(config) {
      this.id = config.id;
      this.callsign = config.callsign || 'HELIX-1';
      this.ownerId = config.ownerId;
      this.lat = config.lat;
      this.lon = config.lon;
      this.altitudeM = config.altitudeM ?? 45;
      this.heading = config.heading ?? 0;
      this.speedKts = config.speedKts ?? 105;
      this.state = config.state || 'TRANSIT'; // 'TRANSIT', 'HOVER_DIP', 'RTB'

      this.targetLat = config.targetLat;
      this.targetLon = config.targetLon;
      this.dipTimer = 18;
      this.buoyCount = 4;
      this.buoyCooldown = 10;
      this.torpedoesRemaining = 2;
      this.weaponCooldown = 12;
      this.fuelSec = 540;
      this.rotorPhase = 0;
      this.rtbDone = false;
    }

    update(dt, ownSub, thermoclineDepthM, world) {
      if (this.rtbDone) return;
      this.fuelSec -= dt;
      this.rotorPhase = (this.rotorPhase + dt * 18) % (Math.PI * 2);
      if (this.weaponCooldown > 0) this.weaponCooldown -= dt;
      if (this.buoyCooldown > 0) this.buoyCooldown -= dt;

      if (this.fuelSec <= 0 && this.state !== 'RTB') {
        this.state = 'RTB';
      }

      const ownerShip = world.contacts.find((c) => c.id === this.ownerId && !c.sunk);
      if (this.state === 'RTB') {
        if (!ownerShip) {
          this.rtbDone = true;
          return;
        }
        this.targetLat = ownerShip.lat;
        this.targetLon = ownerShip.lon;
        const distHome = window.Bathymetry.distanceNm(this.lat, this.lon, ownerShip.lat, ownerShip.lon);
        if (distHome < 0.2) {
          this.rtbDone = true;
          return;
        }
      }

      const distToTarget = window.Bathymetry.distanceNm(this.lat, this.lon, this.targetLat, this.targetLon);
      const brgToTarget = window.Bathymetry.bearingDeg(this.lat, this.lon, this.targetLat, this.targetLon);

      if (this.state === 'TRANSIT' || this.state === 'RTB') {
        this.heading = brgToTarget;
        this.speedKts = 105;
        this.altitudeM += (55 - this.altitudeM) * Math.min(1, dt * 2);
        const stepNm = (this.speedKts * dt) / 3600;
        const nextPt = window.Bathymetry.destinationPoint(this.lat, this.lon, this.heading, stepNm);
        this.lat = nextPt.lat;
        this.lon = nextPt.lon;

        if (this.state === 'TRANSIT' && distToTarget <= 0.35) {
          this.state = 'HOVER_DIP';
          this.dipTimer = 22;
          this.speedKts = 0;
        }
      } else if (this.state === 'HOVER_DIP') {
        this.speedKts = 0;
        this.altitudeM += (22 - this.altitudeM) * Math.min(1, dt * 2);
        this.dipTimer -= dt;

        // Drop a sonobuoy on arrival
        if (this.buoyCount > 0 && this.buoyCooldown <= 0) {
          this.buoyCount--;
          this.buoyCooldown = 35;
          world.sonobuoys.push(new SonobuoyEntity({
            id: `BUOY-${world.sonobuoys.length + 1}`,
            lat: this.lat,
            lon: this.lon,
            ownerName: this.callsign
          }));
          if (window.GameLogger) {
            window.GameLogger.log('SONAR', `Conn, Sonar! ${this.callsign} ASW Helicopter dropped an active sonobuoy nearby!`, 'alert');
          }
        }

        // Dipping sonar can lower below the thermocline!
        const distSub = window.Bathymetry.distanceNm(this.lat, this.lon, ownSub.lat, ownSub.lon);
        if (Math.floor(this.dipTimer) % 7 === 0 && Math.floor(this.dipTimer + dt) !== Math.floor(this.dipTimer)) {
          if (distSub <= 7.0) {
            if (window.SubAudio) window.SubAudio.playHostilePing(25);
            world.lastHostilePingTime = world.simTimeSec;
          }
        }

        // Visual / dipping lock on player submarine -> Drop lightweight APR-3E ASW Torpedo!
        const mastExposed = (ownSub.periscopeRaised || ownSub.esmMastRaised || ownSub.radarTxActive) && ownSub.depthM <= 20.5 && distSub <= 6.5;
        const dippingDetected = distSub <= 2.4;

        if ((dippingDetected || mastExposed) && this.torpedoesRemaining > 0 && this.weaponCooldown <= 0) {
          this.torpedoesRemaining--;
          this.weaponCooldown = 45;
          const brgToSub = window.Bathymetry.bearingDeg(this.lat, this.lon, ownSub.lat, ownSub.lon);
          world.fireAirDroppedTorpedo(this, brgToSub, ownSub.depthM);
        }

        if (this.dipTimer <= 0) {
          if (ownerShip && ownerShip.alertedBearing !== null) {
            const datum = window.Bathymetry.destinationPoint(ownerShip.lat, ownerShip.lon, ownerShip.alertedBearing, 4.5);
            this.targetLat = datum.lat;
            this.targetLon = datum.lon;
            this.state = 'TRANSIT';
          } else {
            this.state = 'RTB';
          }
        }
      }
    }
  }

  root.SonobuoyEntity = SonobuoyEntity;
  root.AswHelicopterEntity = AswHelicopterEntity;
})(typeof window !== 'undefined' ? window : globalThis);
