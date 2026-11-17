const test = require('node:test');
const assert = require('node:assert/strict');
const { SonobuoyEntity, AswHelicopterEntity } = require('../js/asw-air.js');

// Minimal Bathymetry stub for Node unit tests
globalThis.Bathymetry = {
  distanceNm(lat1, lon1, lat2, lon2) {
    const dx = (lon2 - lon1) * 60 * Math.cos((lat1 * Math.PI) / 180);
    const dy = (lat2 - lat1) * 60;
    return Math.hypot(dx, dy);
  },
  bearingDeg(lat1, lon1, lat2, lon2) {
    const dx = (lon2 - lon1) * 60 * Math.cos((lat1 * Math.PI) / 180);
    const dy = (lat2 - lat1) * 60;
    return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  },
  destinationPoint(lat, lon, brgDeg, distNm) {
    const rad = (brgDeg * Math.PI) / 180;
    return {
      lat: lat + (Math.cos(rad) * distNm) / 60,
      lon: lon + (Math.sin(rad) * distNm) / (60 * Math.cos((lat * Math.PI) / 180))
    };
  }
};

test('SonobuoyEntity detects loud or close submarine and expires after TTL', () => {
  const buoy = new SonobuoyEntity({ id: 'BUOY-1', lat: 37.0, lon: 15.0, ttlSec: 10, pingCooldown: 1 });
  const ownSub = { lat: 37.005, lon: 15.0, depthM: 40, radiatedNoiseDb: 115 };
  const world = { simTimeSec: 100, lastHostilePingTime: 0 };

  buoy.update(2, ownSub, 88, world);
  assert.equal(buoy.detectedSub, true);
  assert.equal(world.lastHostilePingTime, 100);

  buoy.update(9, ownSub, 88, world);
  assert.ok(buoy.ttlSec <= 0);
});

test('AswHelicopterEntity transits to datum, hovers, drops sonobuoy, and fires torpedo when sub is within dipping range', () => {
  const fired = [];
  const world = {
    simTimeSec: 200,
    lastHostilePingTime: 0,
    sonobuoys: [],
    contacts: [{ id: 'S-1', lat: 37.1, lon: 15.1, sunk: false, alertedBearing: 0 }],
    fireAirDroppedTorpedo(heli, brg, depth) {
      fired.push({ heliId: heli.id, brg, depth });
      return true;
    }
  };

  const heli = new AswHelicopterEntity({
    id: 'HELIX-1',
    ownerId: 'S-1',
    lat: 37.0,
    lon: 15.0,
    targetLat: 37.004,
    targetLon: 15.0,
    buoyCooldown: 0,
    weaponCooldown: 0
  });

  const ownSub = { lat: 37.004, lon: 15.0, depthM: 60, periscopeRaised: false, esmMastRaised: false, radarTxActive: false };

  // Transit ~0.24 NM -> arrives immediately in HOVER_DIP
  heli.update(1, ownSub, 88, world);
  assert.equal(heli.state, 'HOVER_DIP');

  // Hover tick -> drops sonobuoy and air-dropped torpedo
  heli.update(1, ownSub, 88, world);
  assert.equal(world.sonobuoys.length, 1);
  assert.equal(fired.length, 1);
  assert.equal(heli.torpedoesRemaining, 1);
});

test('AswHelicopterEntity enters RTB when fuel is exhausted', () => {
  const world = {
    simTimeSec: 500,
    sonobuoys: [],
    contacts: [{ id: 'S-1', lat: 37.1, lon: 15.1, sunk: false }]
  };
  const heli = new AswHelicopterEntity({
    id: 'HELIX-2',
    ownerId: 'S-1',
    lat: 37.0,
    lon: 15.0,
    targetLat: 37.0,
    targetLon: 15.0,
    fuelSec: 1
  });

  heli.update(2, { lat: 37.5, lon: 15.5, depthM: 100 }, 88, world);
  assert.equal(heli.state, 'RTB');
});
