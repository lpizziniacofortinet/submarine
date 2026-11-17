const test = require('node:test');
const assert = require('node:assert/strict');
const LiveWeatherService = require('../js/weather.js');

test('LiveWeatherService rounds coordinates to 0.25-deg grid keys and uses fresh cache', () => {
  const svc = new LiveWeatherService();
  assert.equal(svc.positionKey(37.18, 15.36), '37.25,15.25');

  const sample = {
    label: 'THUNDERSTORM',
    weatherCode: 95,
    tempC: 19.5,
    cloudCover: 0.95,
    windSpeedKts: 24.0,
    windDirDeg: 220,
    visibilityKm: 9.0,
    rainMm: 6.2,
    isDay: 1,
    pressureHpa: 1004,
    seaState: 4
  };
  svc.cache.set('37.25,15.25', { savedAt: Date.now(), data: sample });
  svc.updatePosition(37.18, 15.36);

  assert.equal(svc.status, 'LIVE');
  assert.equal(svc.current.label, 'THUNDERSTORM');
  assert.equal(svc.current.seaState, 4);
});

test('LiveWeatherService ignores invalid coordinates safely', () => {
  const svc = new LiveWeatherService();
  svc.updatePosition(NaN, 15.0);
  assert.equal(svc.status, 'IDLE');
});
