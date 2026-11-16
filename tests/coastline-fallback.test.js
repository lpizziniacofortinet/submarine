'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
window.Bathymetry = { features: [] };
window.localStorage = {
  getItem() { return null; },
  setItem() {},
  removeItem() {}
};
global.fetch = async () => { throw new Error('offline test'); };

require('../js/med-landmask.js');
require('../js/coastline.js');

const CoastlineModel = window.CoastlineModel;

test('local land mask distinguishes Mediterranean coast from nearby water', () => {
  assert.equal(CoastlineModel.isLand(44.1, 9.82), true, 'La Spezia land');
  assert.equal(CoastlineModel.isLand(43.9, 10.2), false, 'offshore Tyrrhenian water');
  assert.equal(CoastlineModel.isLand(40.47, 17.23), true, 'Taranto land');
  assert.equal(CoastlineModel.isLand(40.25, 17.6), false, 'Gulf of Taranto water');
  assert.equal(CoastlineModel.isLand(35.3, 24.8), true, 'Crete land');
  assert.equal(CoastlineModel.isLand(35.2, 23.8), false, 'south of Crete');
});

test('fallback profile contains 72 bearings and detects coast from offshore', () => {
  const profile = CoastlineModel.buildFallbackProfile(43.9, 10.2);
  assert.equal(profile.fallback, true);
  assert.equal(profile.rays.length, 72);
  assert.ok(profile.rays.some((ray) => ray.hasLand), 'at least one coastline ray is visible');
});

test('fallback profile includes the Provençal coast from the Toulon departure sector', () => {
  const start = CoastlineModel.destinationPoint(42.92, 5.94, 177.5, 5.25 * 1.852);
  const profile = CoastlineModel.buildFallbackProfile(start.lat, start.lon);
  const visibleBearings = profile.rays.filter((ray) => ray.hasLand).map((ray) => ray.bearing);
  assert.ok(visibleBearings.some((bearing) => bearing <= 30 || bearing >= 330));
});

test('DEM profile keeps local coastline rays where its terrain samples contain no land', () => {
  const fallback = CoastlineModel.buildFallbackProfile(43.9, 10.2);
  const emptyDem = {
    azimuthStepDeg: 5,
    source: 'Copernicus DEM test profile',
    rays: fallback.rays.map((ray) => ({
      ...ray,
      angleDeg: CoastlineModel.horizonDipDegrees(),
      rangeKm: 0,
      elevationM: 0,
      hasLand: false
    }))
  };
  const merged = CoastlineModel.mergeProfiles(emptyDem, fallback);
  assert.equal(merged.fallback, false);
  assert.equal(merged.hybrid, true);
  assert.ok(merged.rays.some((ray) => ray && ray.hasLand));
});

test('local land profile is available immediately while the DEM request is loading', () => {
  const model = new CoastlineModel();
  model.updatePosition(43.9, 10.2);
  assert.ok(model.profile);
  assert.equal(model.profile.fallback, true);
});
