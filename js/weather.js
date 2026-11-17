/**
 * ============================================================================
 * LIVE MEDITERRANEAN METEOROLOGY SERVICE (Open-Meteo Real-Time Forecast API)
 * Fetches actual current weather conditions (cloud cover, wind speed/direction,
 * visibility, temperature, precipitation, WMO weather code, day/night) for the
 * submarine's current latitude & longitude, with smart caching & offline fallback.
 * ============================================================================
 */
(function () {
  'use strict';

  const API_URL = 'https://api.open-meteo.com/v1/forecast';
  const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

  const WMO_LABELS = {
    0: 'CLEAR SKY',
    1: 'MAINLY CLEAR',
    2: 'PARTLY CLOUDY',
    3: 'OVERCAST',
    45: 'FOG',
    48: 'RIME FOG',
    51: 'LIGHT DRIZZLE',
    53: 'DRIZZLE',
    55: 'DENSE DRIZZLE',
    61: 'LIGHT RAIN',
    63: 'MODERATE RAIN',
    65: 'HEAVY RAIN',
    80: 'RAIN SHOWERS',
    81: 'MOD SHOWERS',
    82: 'HEAVY SHOWERS',
    95: 'THUNDERSTORM',
    96: 'THUNDERSTORM / HAIL',
    99: 'SEVERE STORM'
  };

  class LiveWeatherService {
    constructor() {
      this.cache = new Map();
      this.pendingKey = null;
      this.status = 'IDLE'; // 'IDLE', 'LOADING', 'LIVE', 'OFFLINE'
      this.current = {
        label: 'CLEAR SKY',
        weatherCode: 0,
        tempC: 21.0,
        cloudCover: 0.18,      // 0..1
        windSpeedKts: 8.0,     // knots
        windDirDeg: 135,       // degrees from
        visibilityKm: 42.0,    // km
        rainMm: 0.0,           // mm/h
        isDay: 1,
        pressureHpa: 1016,
        seaState: 2
      };
    }

    positionKey(lat, lon) {
      return `${(Math.round(lat * 4) / 4).toFixed(2)},${(Math.round(lon * 4) / 4).toFixed(2)}`;
    }

    updatePosition(lat, lon) {
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      const key = this.positionKey(lat, lon);
      const cached = this.cache.get(key);
      if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS) {
        this.current = cached.data;
        this.status = 'LIVE';
        return;
      }
      if (this.pendingKey === key) return;
      this.pendingKey = key;
      this.status = 'LOADING';

      const url =
        `${API_URL}?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}` +
        `&current=temperature_2m,cloud_cover,precipitation,rain,weather_code,wind_speed_10m,wind_direction_10m,is_day,surface_pressure` +
        `&hourly=visibility&forecast_days=1&timezone=UTC`;

      fetch(url)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then((payload) => {
          if (!payload || !payload.current) throw new Error('Invalid weather payload');
          const c = payload.current;

          // Match current UTC hour visibility if provided (Open-Meteo returns meters)
          let visKm = 45.0;
          if (payload.hourly && Array.isArray(payload.hourly.visibility)) {
            const utcHour = new Date().getUTCHours();
            const rawVisM = Number(payload.hourly.visibility[utcHour]);
            if (Number.isFinite(rawVisM) && rawVisM > 0) {
              visKm = Math.max(1.5, Math.min(60.0, rawVisM / 1000.0));
            }
          }

          const code = Number(c.weather_code) || 0;
          const windKmh = Number(c.wind_speed_10m) || 0;
          const windKts = Math.max(1.0, windKmh * 0.539957);
          const rainMm = Math.max(Number(c.rain) || 0, Number(c.precipitation) || 0);
          const cloudPct = Math.max(0, Math.min(100, Number(c.cloud_cover) || 0));

          // Adjust visibility for fog/rain if hourly visibility is overly optimistic
          if (code === 45 || code === 48) visKm = Math.min(visKm, 4.5);
          else if (rainMm > 2.0 || code >= 80) visKm = Math.min(visKm, 14.0);
          else if (rainMm > 0.2) visKm = Math.min(visKm, 22.0);

          const seaState = windKts < 4 ? 1 : windKts < 10 ? 2 : windKts < 17 ? 3 : windKts < 25 ? 4 : 5;

          const parsed = {
            label: WMO_LABELS[code] || (cloudPct > 75 ? 'OVERCAST' : cloudPct > 35 ? 'PARTLY CLOUDY' : 'CLEAR SKY'),
            weatherCode: code,
            tempC: Number.isFinite(Number(c.temperature_2m)) ? Number(c.temperature_2m) : 20.0,
            cloudCover: cloudPct / 100.0,
            windSpeedKts: Number(windKts.toFixed(1)),
            windDirDeg: Number(c.wind_direction_10m) || 120,
            visibilityKm: Number(visKm.toFixed(1)),
            rainMm: Number(rainMm.toFixed(2)),
            isDay: Number(c.is_day) ? 1 : 0,
            pressureHpa: Math.round(Number(c.surface_pressure) || 1015),
            seaState
          };

          this.cache.set(key, { savedAt: Date.now(), data: parsed });
          this.current = parsed;
          this.status = 'LIVE';
        })
        .catch(() => {
          this.status = 'OFFLINE';
        })
        .finally(() => {
          if (this.pendingKey === key) this.pendingKey = null;
        });
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = LiveWeatherService;
  }
  if (typeof window !== 'undefined') {
    window.LiveWeather = new LiveWeatherService();
  }
})();
