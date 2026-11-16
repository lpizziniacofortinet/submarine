'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

global.window = {};
require('../js/coastline.js');
const CoastlineModel = global.window.CoastlineModel;

test('destination point follows a geodesic bearing and distance', () => {
  const point = CoastlineModel.destinationPoint(0, 0, 0, 100);
  assert.ok(Math.abs(point.lat - 0.8993) < 0.002);
  assert.ok(Math.abs(point.lon) < 0.0001);
});

test('optical horizon depression is negative and small at periscope height', () => {
  const dip = CoastlineModel.horizonDipDegrees(4.5, 0.13);
  assert.ok(dip < 0);
  assert.ok(dip > -0.1);
});

test('Earth curvature reduces the apparent elevation of distant terrain', () => {
  const flatEarthAngle = Math.atan2(1000 - 4.5, 100000) * 180 / Math.PI;
  const curvedEarthAngle = CoastlineModel.apparentElevationAngle(1000, 100, 4.5, 0.13);
  assert.ok(curvedEarthAngle < flatEarthAngle);
  assert.ok(curvedEarthAngle > 0);
});

test('ray profile chooses the most elevated visible terrain angle', () => {
  const ray = CoastlineModel.buildRay([0, 100, 1000, 200], [1, 10, 50, 100], 125);
  assert.equal(ray.bearing, 125);
  assert.equal(ray.hasLand, true);
  assert.equal(ray.rangeKm, 50);
  assert.equal(ray.elevationM, 1000);
});

test('ray profile falls back to the sea horizon when no land is sampled', () => {
  const ray = CoastlineModel.buildRay([0, 0, 0], [1, 8, 100], 270);
  assert.equal(ray.hasLand, false);
  assert.ok(ray.angleDeg < 0);
});

test('azimuth interpolation wraps smoothly across north', () => {
  const rays = Array.from({ length: 72 }, (_, i) => ({
    bearing: i * 5,
    angleDeg: i,
    rangeKm: i,
    elevationM: i,
    hasLand: true
  }));
  const sample = CoastlineModel.sample({ azimuthStepDeg: 5, rays }, 357.5);
  assert.equal(sample.angleDeg, 35.5);
  assert.equal(sample.bearing, 357.5);
});

test('nearby submarine positions share a small local terrain cache cell', () => {
  assert.equal(
    CoastlineModel.positionKey(43.0001, 9.0001),
    CoastlineModel.positionKey(43.008, 9.008)
  );
  assert.notEqual(
    CoastlineModel.positionKey(43.0001, 9.0001),
    CoastlineModel.positionKey(43.04, 9.04)
  );
});
