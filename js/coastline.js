/**
 * Cached 360-degree coastline and terrain horizon profile.
 * Elevations: Copernicus DEM GLO-90 via Open-Meteo Elevation API.
 */
(function () {
  'use strict';

  var root = typeof window !== 'undefined' ? window : globalThis;
  var API_URL = 'https://api.open-meteo.com/v1/elevation';
  var CACHE_PREFIX = 'ssn774_coastline_profile_v1:';
  var CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  var EARTH_RADIUS_M = 6371008.8;
  var REFRACTION_COEFFICIENT = 0.13;
  var OBSERVER_HEIGHT_M = 4.5;
  var AZIMUTH_STEP_DEG = 5;
  var RANGES_KM = [1, 2, 3.5, 5.5, 8, 12, 18, 26, 38, 55, 80, 115, 145];
  var BATCH_SIZE = 100;
  var CONCURRENCY = 3;

  class CoastlineModel {
    constructor() {
      this.profile = null;
      this.status = 'IDLE';
      this.loadingKey = null;
      this.requestedKey = null;
      this.error = null;
    }

    static destinationPoint(lat, lon, bearingDeg, distanceKm) {
      var angularDistance = distanceKm * 1000 / EARTH_RADIUS_M;
      var bearing = bearingDeg * Math.PI / 180;
      var phi1 = lat * Math.PI / 180;
      var lambda1 = lon * Math.PI / 180;

      var sinPhi2 = Math.sin(phi1) * Math.cos(angularDistance)
        + Math.cos(phi1) * Math.sin(angularDistance) * Math.cos(bearing);
      var phi2 = Math.asin(Math.max(-1, Math.min(1, sinPhi2)));
      var lambda2 = lambda1 + Math.atan2(
        Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(phi1),
        Math.cos(angularDistance) - Math.sin(phi1) * Math.sin(phi2)
      );

      return {
        lat: phi2 * 180 / Math.PI,
        lon: ((lambda2 * 180 / Math.PI + 540) % 360) - 180
      };
    }

    static effectiveEarthRadius(refractionCoefficient) {
      var coefficient = Number.isFinite(refractionCoefficient)
        ? refractionCoefficient : REFRACTION_COEFFICIENT;
      return EARTH_RADIUS_M / (1 - coefficient);
    }

    static horizonDipDegrees(observerHeightM, refractionCoefficient) {
      var height = Number.isFinite(observerHeightM) ? Math.max(0, observerHeightM) : OBSERVER_HEIGHT_M;
      var radius = this.effectiveEarthRadius(refractionCoefficient);
      return -Math.acos(radius / (radius + height)) * 180 / Math.PI;
    }

    static apparentElevationAngle(elevationM, distanceKm, observerHeightM, refractionCoefficient) {
      var height = Number.isFinite(observerHeightM) ? observerHeightM : OBSERVER_HEIGHT_M;
      var distanceM = Math.max(1, distanceKm * 1000);
      var radius = this.effectiveEarthRadius(refractionCoefficient);
      var curvatureDropM = (distanceM * distanceM) / (2 * radius);
      return Math.atan2(elevationM - height - curvatureDropM, distanceM) * 180 / Math.PI;
    }

    static buildRay(elevations, distancesKm, bearingDeg) {
      var ranges = distancesKm || RANGES_KM;
      var bearing = ((bearingDeg || 0) % 360 + 360) % 360;
      var best = {
        bearing: bearing,
        angleDeg: this.horizonDipDegrees(),
        rangeKm: 0,
        elevationM: 0,
        hasLand: false
      };

      for (var i = 0; i < ranges.length; i++) {
        var elevation = Number(elevations[i]);
        if (!Number.isFinite(elevation) || elevation < 3) continue;
        var angle = this.apparentElevationAngle(elevation, ranges[i]);
        if (angle > best.angleDeg) {
          best = {
            bearing: bearing,
            angleDeg: angle,
            rangeKm: ranges[i],
            elevationM: elevation,
            hasLand: true
          };
        }
      }
      return best;
    }

    static sample(profile, bearingDeg) {
      if (!profile || !Array.isArray(profile.rays) || !profile.rays.length) return null;
      var step = profile.azimuthStepDeg || AZIMUTH_STEP_DEG;
      var normalized = ((bearingDeg % 360) + 360) % 360;
      var position = normalized / step;
      var lowerIndex = Math.floor(position) % profile.rays.length;
      var upperIndex = (lowerIndex + 1) % profile.rays.length;
      var mix = position - Math.floor(position);
      var a = profile.rays[lowerIndex];
      var b = profile.rays[upperIndex];
      if (!a || !b) return a || b || null;

      return {
        bearing: normalized,
        angleDeg: a.angleDeg + (b.angleDeg - a.angleDeg) * mix,
        rangeKm: a.rangeKm + (b.rangeKm - a.rangeKm) * mix,
        elevationM: a.elevationM + (b.elevationM - a.elevationM) * mix,
        hasLand: Boolean(a.hasLand || b.hasLand)
      };
    }

    static positionKey(lat, lon) {
      return String(Math.round(lat * 50)) + ':' + String(Math.round(lon * 50));
    }

    updatePosition(lat, lon) {
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      var key = CoastlineModel.positionKey(lat, lon);
      if (key === this.requestedKey || key === this.loadingKey) return;

      this.requestedKey = key;
      this.profile = null;
      this.error = null;

      var cacheKey = CACHE_PREFIX + key;
      try {
        var cachedRaw = root.localStorage && root.localStorage.getItem(cacheKey);
        if (cachedRaw) {
          var cached = JSON.parse(cachedRaw);
          if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS &&
              Array.isArray(cached.profile && cached.profile.rays) && cached.profile.rays.length === 72) {
            this.profile = cached.profile;
            this.status = 'CACHED';
            return;
          }
          if (root.localStorage) root.localStorage.removeItem(cacheKey);
        }
      } catch (_) {
        // Storage is optional. Continue with a live lookup when available.
      }

      this.loadingKey = key;
      this.status = 'LOADING';
      this.loadProfile(lat, lon, key).catch((error) => {
        this.error = error;
        this.status = 'OFFLINE';
      }).finally(() => {
        if (this.loadingKey === key) this.loadingKey = null;
      });
    }

    async loadProfile(lat, lon, key) {
      var bearings = Array.from({ length: 360 / AZIMUTH_STEP_DEG }, function (_, i) {
        return i * AZIMUTH_STEP_DEG;
      });
      var points = [];

      for (var rayIndex = 0; rayIndex < bearings.length; rayIndex++) {
        for (var rangeIndex = 0; rangeIndex < RANGES_KM.length; rangeIndex++) {
          var point = CoastlineModel.destinationPoint(lat, lon, bearings[rayIndex], RANGES_KM[rangeIndex]);
          points.push({ lat: point.lat, lon: point.lon });
        }
      }

      var batches = [];
      for (var i = 0; i < points.length; i += BATCH_SIZE) {
        batches.push(points.slice(i, i + BATCH_SIZE));
      }

      var elevations = new Array(points.length);
      var nextBatch = 0;
      var worker = async () => {
        while (nextBatch < batches.length) {
          var batchIndex = nextBatch++;
          var batch = batches[batchIndex];
          var latitudes = batch.map(function (p) { return p.lat.toFixed(5); }).join(',');
          var longitudes = batch.map(function (p) { return p.lon.toFixed(5); }).join(',');
          var url = API_URL + '?latitude=' + latitudes + '&longitude=' + longitudes;
          var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
          var timeout = controller ? root.setTimeout(function () { controller.abort(); }, 20000) : null;

          try {
            var response = await fetch(url, { signal: controller ? controller.signal : undefined });
            if (!response.ok) throw new Error('Elevation API returned HTTP ' + response.status);
            var payload = await response.json();
            if (!Array.isArray(payload.elevation) || payload.elevation.length !== batch.length) {
              throw new Error('Elevation API returned an incomplete terrain batch');
            }
            var offset = batchIndex * BATCH_SIZE;
            payload.elevation.forEach(function (value, index) {
              elevations[offset + index] = Number(value);
            });
          } finally {
            if (timeout !== null) root.clearTimeout(timeout);
          }
        }
      };

      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));

      var rays = bearings.map(function (bearing, rayIndex) {
        var values = RANGES_KM.map(function (_, rangeIndex) {
          return elevations[rayIndex * RANGES_KM.length + rangeIndex];
        });
        return CoastlineModel.buildRay(values, RANGES_KM, bearing);
      });

      var profile = {
        azimuthStepDeg: AZIMUTH_STEP_DEG,
        seaHorizonAngleDeg: CoastlineModel.horizonDipDegrees(),
        rays: rays,
        source: 'Copernicus DEM GLO-90 via Open-Meteo',
        sampledAt: Date.now()
      };

      this.profile = profile;
      this.status = 'READY';
      this.error = null;

      try {
        if (root.localStorage) {
          root.localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({
            savedAt: Date.now(),
            profile: profile
          }));
        }
      } catch (_) {
        // Storage quota and privacy settings must not break the periscope display.
      }
      return profile;
    }
  }

  root.CoastlineModel = CoastlineModel;
})();
