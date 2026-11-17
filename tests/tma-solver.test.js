const test = require('node:test');
const assert = require('node:assert/strict');
const BearingOnlyTMASolver = require('../js/tma-solver.js');

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

function stepPoint(lat, lon, headingDeg, speedKts, dtSec) {
  const distNm = (speedKts * dtSec) / 3600;
  const dLat = (Math.cos(headingDeg * DEG_TO_RAD) * distNm) / 60;
  const dLon = (Math.sin(headingDeg * DEG_TO_RAD) * distNm) / (60 * Math.cos(lat * DEG_TO_RAD));
  return { lat: lat + dLat, lon: lon + dLon };
}

function trueBearing(lat1, lon1, lat2, lon2) {
  const dx = (lon2 - lon1) * 60 * Math.cos(lat1 * DEG_TO_RAD);
  const dy = (lat2 - lat1) * 60;
  return ((Math.atan2(dx, dy) * RAD_TO_DEG) + 360) % 360;
}

function trueRangeNm(lat1, lon1, lat2, lon2) {
  const dx = (lon2 - lon1) * 60 * Math.cos(lat1 * DEG_TO_RAD);
  const dy = (lat2 - lat1) * 60;
  return Math.hypot(dx, dy);
}

test('remains unobservable along a single straight own-ship leg without range aids', () => {
  const solver = new BearingOnlyTMASolver();
  let own = { lat: 37.0, lon: 15.0 };
  let tgt = { lat: 37.08, lon: 15.05 }; // ~5.4 NM away

  for (let t = 0; t <= 120; t += 4) {
    own = stepPoint(own.lat, own.lon, 0, 8, 4);
    tgt = stepPoint(tgt.lat, tgt.lon, 270, 12, 4);
    solver.addObservation({
      timeSec: t,
      ownLat: own.lat,
      ownLon: own.lon,
      bearingDeg: trueBearing(own.lat, own.lon, tgt.lat, tgt.lon)
    });
  }

  const sol = solver.solve(120, own.lat, own.lon);
  assert.equal(sol.observable, false);
  assert.ok(sol.qualityPct <= 32, `Expected low unobservable quality, got ${sol.qualityPct}`);
});

test('converges to true target range, course, and speed after an own-ship TMA maneuver leg', () => {
  const solver = new BearingOnlyTMASolver();
  let own = { lat: 37.0, lon: 15.0 };
  // Target 6.0 NM NE, heading 225 deg at 14 knots
  let tgt = { lat: 37.07, lon: 15.09 };
  const tgtHeading = 225;
  const tgtSpeed = 14;

  // Leg 1 (0..180s): Own-ship heading 000° at 10 kts
  // Leg 2 (180..380s): Own-ship turns to 090° at 10 kts (creates bearing-rate parallax)
  for (let t = 0; t <= 380; t += 4) {
    const ownHdg = t < 180 ? 0 : 90;
    own = stepPoint(own.lat, own.lon, ownHdg, 10, 4);
    tgt = stepPoint(tgt.lat, tgt.lon, tgtHeading, tgtSpeed, 4);
    const brg = trueBearing(own.lat, own.lon, tgt.lat, tgt.lon);
    // Deterministic +/- 0.35 deg realistic passive sonar bearing jitter
    const noisyBrg = brg + Math.sin(t * 0.31) * 0.35;

    solver.addObservation({
      timeSec: t,
      ownLat: own.lat,
      ownLon: own.lon,
      bearingDeg: noisyBrg,
      bearingSigmaDeg: 0.6
    });
  }

  const sol = solver.solve(380, own.lat, own.lon);
  const actualRng = trueRangeNm(own.lat, own.lon, tgt.lat, tgt.lon);

  assert.equal(sol.observable, true);
  assert.ok(sol.qualityPct >= 75, `Expected high TMA quality after maneuver, got ${sol.qualityPct}`);
  assert.ok(Math.abs(sol.estRangeNm - actualRng) < 0.75, `Range error too large: est ${sol.estRangeNm} vs true ${actualRng.toFixed(2)}`);
  assert.ok(Math.abs(sol.estSpeedKts - tgtSpeed) <= 3, `Speed error too large: est ${sol.estSpeedKts} vs true ${tgtSpeed}`);
  const hdgErr = Math.abs(((sol.estHeading - tgtHeading + 540) % 360) - 180);
  assert.ok(hdgErr <= 18, `Heading error too large: est ${sol.estHeading} vs true ${tgtHeading}`);
});

test('active range aid breaks range ambiguity immediately', () => {
  const solver = new BearingOnlyTMASolver();
  const own = { lat: 37.0, lon: 15.0 };
  const tgt = { lat: 37.05, lon: 15.05 };
  const brg = trueBearing(own.lat, own.lon, tgt.lat, tgt.lon);
  const rng = trueRangeNm(own.lat, own.lon, tgt.lat, tgt.lon);

  solver.addObservation({
    timeSec: 10,
    ownLat: own.lat,
    ownLon: own.lon,
    bearingDeg: brg,
    rangeNm: rng
  });

  const sol = solver.solve(10, own.lat, own.lon);
  assert.equal(sol.observable, true);
  assert.ok(Math.abs(sol.estRangeNm - rng) < 0.35);
});

test('serialize and restore preserves observations and solver state', () => {
  const solver = new BearingOnlyTMASolver();
  solver.addObservation({ timeSec: 10, ownLat: 37.0, ownLon: 15.0, bearingDeg: 45, rangeNm: 4.2 });
  solver.solve(10, 37.0, 15.0);

  const saved = solver.serialize();
  const restored = new BearingOnlyTMASolver(saved);
  assert.equal(restored.observations.length, 1);
  assert.ok(Array.isArray(restored.lastState));
});
