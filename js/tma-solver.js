/**
 * ============================================================================
 * TRUE BEARING-ONLY TARGET MOTION ANALYSIS (TMA) SOLVER
 * 4-State Cartesian Levenberg-Marquardt / Gauss-Newton Estimator
 *
 * State vector at reference time t_now: s = [px, py, vx, vy]
 *   - (px, py): Target position in Nautical Miles (East, North) from origin
 *   - (vx, vy): Target velocity in Knots (NM / hour)
 *
 * Strictly uses ONLY own-ship trajectory (x_o, y_o) and passive sonar
 * bearings (plus optional active-ping/radar/periscope range aids).
 * Never accesses target truth coordinates, heading, or speed.
 * ============================================================================
 */
(function (root) {
  'use strict';

  const DEG_TO_RAD = Math.PI / 180;
  const RAD_TO_DEG = 180 / Math.PI;
  const NM_PER_DEG_LAT = 60.0;

  function wrapAngleRad(rad) {
    let a = (rad + Math.PI) % (2 * Math.PI);
    if (a < 0) a += 2 * Math.PI;
    return a - Math.PI;
  }

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  /**
   * Solves a 4x4 linear system A * x = b using Gaussian elimination with partial pivoting.
   * Returns null if singular.
   */
  function solveLinear4x4(A, b) {
    const M = [
      [A[0][0], A[0][1], A[0][2], A[0][3], b[0]],
      [A[1][0], A[1][1], A[1][2], A[1][3], b[1]],
      [A[2][0], A[2][1], A[2][2], A[2][3], b[2]],
      [A[3][0], A[3][1], A[3][2], A[3][3], b[3]]
    ];

    for (let col = 0; col < 4; col++) {
      let pivotRow = col;
      let maxAbs = Math.abs(M[col][col]);
      for (let row = col + 1; row < 4; row++) {
        const v = Math.abs(M[row][col]);
        if (v > maxAbs) {
          maxAbs = v;
          pivotRow = row;
        }
      }
      if (maxAbs < 1e-12) return null;

      if (pivotRow !== col) {
        const tmp = M[col];
        M[col] = M[pivotRow];
        M[pivotRow] = tmp;
      }

      const pivotVal = M[col][col];
      for (let j = col; j < 5; j++) {
        M[col][j] /= pivotVal;
      }

      for (let row = 0; row < 4; row++) {
        if (row === col) continue;
        const factor = M[row][col];
        if (factor === 0) continue;
        for (let j = col; j < 5; j++) {
          M[row][j] -= factor * M[col][j];
        }
      }
    }

    return [M[0][4], M[1][4], M[2][4], M[3][4]];
  }

  class BearingOnlyTMASolver {
    constructor(savedState = null) {
      this.originLat = savedState && Number.isFinite(savedState.originLat) ? savedState.originLat : null;
      this.originLon = savedState && Number.isFinite(savedState.originLon) ? savedState.originLon : null;
      this.observations = savedState && Array.isArray(savedState.observations) ? savedState.observations.slice(-90) : [];
      this.lastState = savedState && Array.isArray(savedState.lastState) ? savedState.lastState.slice(0, 4) : null;
      this.lastSolution = {
        estRangeNm: 6.0,
        estHeading: 0,
        estSpeedKts: 10,
        qualityPct: 0,
        rmsDeg: 0,
        observable: false,
        crossTrackNm: 0,
        sampleCount: this.observations.length
      };
    }

    serialize() {
      return {
        originLat: this.originLat,
        originLon: this.originLon,
        observations: this.observations.slice(-60),
        lastState: this.lastState ? this.lastState.slice(0, 4) : null
      };
    }

    toLocalNm(lat, lon) {
      if (this.originLat === null || this.originLon === null) {
        this.originLat = lat;
        this.originLon = lon;
      }
      const cosLat = Math.max(0.15, Math.cos(this.originLat * DEG_TO_RAD));
      const xNm = (lon - this.originLon) * NM_PER_DEG_LAT * cosLat;
      const yNm = (lat - this.originLat) * NM_PER_DEG_LAT;
      return { xNm, yNm };
    }

    /**
     * Records a new passive bearing (and optional direct range from active ping/radar/scope/Link-16).
     */
    addObservation({ timeSec, ownLat, ownLon, bearingDeg, rangeNm = null, bearingSigmaDeg = 0.9 }) {
      if (!Number.isFinite(timeSec) || !Number.isFinite(ownLat) || !Number.isFinite(ownLon) || !Number.isFinite(bearingDeg)) {
        return;
      }

      const last = this.observations[this.observations.length - 1];
      if (last && rangeNm === null && timeSec - last.t < 1.8) {
        return; // Throttle high-FPS passive samples to >= 1.8s intervals
      }

      const { xNm, yNm } = this.toLocalNm(ownLat, ownLon);
      const bearingRad = (((bearingDeg % 360) + 360) % 360) * DEG_TO_RAD;

      this.observations.push({
        t: timeSec,
        ox: xNm,
        oy: yNm,
        b: bearingRad,
        r: Number.isFinite(rangeNm) && rangeNm > 0.05 ? rangeNm : null,
        sigmaB: Math.max(0.2, bearingSigmaDeg) * DEG_TO_RAD
      });

      if (this.observations.length > 90) {
        this.observations.shift();
      }
    }

    /**
     * Measures own-ship cross-track maneuver baseline (parallax) in Nautical Miles.
     * Bearing-only TMA requires own-ship to deviate from a single straight constant-velocity leg.
     */
    computeManeuverParallaxNm() {
      const n = this.observations.length;
      if (n < 3) return { crossTrackNm: 0, hasRangeAid: false };

      let hasRangeAid = false;
      for (let i = 0; i < n; i++) {
        if (this.observations[i].r !== null) {
          hasRangeAid = true;
          break;
        }
      }

      const first = this.observations[0];
      const last = this.observations[n - 1];
      const dtTotal = Math.max(1e-6, (last.t - first.t) / 3600.0);

      // Deviation from a constant-velocity chord connecting first and last own-ship positions
      let maxDevNm = 0;
      for (let i = 1; i < n - 1; i++) {
        const obs = this.observations[i];
        const frac = ((obs.t - first.t) / 3600.0) / dtTotal;
        const expectedX = first.ox + (last.ox - first.ox) * frac;
        const expectedY = first.oy + (last.oy - first.oy) * frac;
        const dev = Math.hypot(obs.ox - expectedX, obs.oy - expectedY);
        if (dev > maxDevNm) maxDevNm = dev;
      }

      return { crossTrackNm: maxDevNm, hasRangeAid };
    }

    /**
     * Runs the 4-state Levenberg-Marquardt Bearing-Only TMA solver at `currentTimeSec`.
     */
    solve(currentTimeSec, currentOwnLat, currentOwnLon) {
      const n = this.observations.length;
      if (n === 0) {
        return this.lastSolution;
      }

      const { xNm: curOwnX, yNm: curOwnY } = this.toLocalNm(currentOwnLat, currentOwnLon);
      const latest = this.observations[n - 1];
      const { crossTrackNm, hasRangeAid } = this.computeManeuverParallaxNm();
      const timeSpanSec = latest.t - this.observations[0].t;

      // Range is observable if own-ship maneuvered (>= 0.035 NM cross-track) or has direct range aid
      const observable = hasRangeAid || (n >= 6 && timeSpanSec >= 18 && crossTrackNm >= 0.035);

      if (!observable) {
        // Without a maneuver leg or range aid, range is mathematically ambiguous along the LOS bearing.
        const priorRange = clamp(this.lastSolution.estRangeNm || 6.0, 1.5, 14.0);
        const headingGuess = Math.round(((latest.b * RAD_TO_DEG) + 180) % 360);
        const unobsQuality = Math.min(30, n * 2.2 + (timeSpanSec / 60) * 8);

        this.lastSolution = {
          estRangeNm: Number(priorRange.toFixed(2)),
          estHeading: headingGuess,
          estSpeedKts: this.lastSolution.estSpeedKts || 10,
          qualityPct: Math.round(unobsQuality),
          rmsDeg: 0,
          observable: false,
          crossTrackNm: Number(crossTrackNm.toFixed(3)),
          sampleCount: n
        };
        return this.lastSolution;
      }

      // Initialize 4-state [px, py, vx, vy] at reference time `tRef = currentTimeSec`
      const tRef = currentTimeSec;
      let state;
      if (this.lastState && hasRangeAid === false) {
        // Propagate previous state forward if reasonable
        state = this.lastState.slice(0, 4);
      } else {
        const initRange = latest.r !== null ? latest.r : clamp(this.lastSolution.estRangeNm || 6.0, 1.5, 15.0);
        state = [
          curOwnX + Math.sin(latest.b) * initRange,
          curOwnY + Math.cos(latest.b) * initRange,
          0.0,
          0.0
        ];
      }

      // Levenberg-Marquardt nonlinear least-squares optimization
      let lambda = 0.05;
      let prevCost = this.computeCost(state, tRef);

      for (let iter = 0; iter < 18; iter++) {
        const { H, g } = this.assembleNormalEquations(state, tRef);

        // Levenberg-Marquardt damping on diagonal
        const dampedH = [
          [H[0][0] + lambda, H[0][1], H[0][2], H[0][3]],
          [H[1][0], H[1][1] + lambda, H[1][2], H[1][3]],
          [H[2][0], H[2][1], H[2][2] + lambda, H[2][3]],
          [H[3][0], H[3][1], H[3][2], H[3][3] + lambda]
        ];

        const step = solveLinear4x4(dampedH, [-g[0], -g[1], -g[2], -g[3]]);
        if (!step) {
          lambda *= 5.0;
          continue;
        }

        const candState = [
          state[0] + clamp(step[0], -3.0, 3.0),
          state[1] + clamp(step[1], -3.0, 3.0),
          state[2] + clamp(step[2], -8.0, 8.0),
          state[3] + clamp(step[3], -8.0, 8.0)
        ];

        // Enforce physical naval speed cap (<= 38 kts) & range cap
        const candSpd = Math.hypot(candState[2], candState[3]);
        if (candSpd > 38.0) {
          candState[2] *= 38.0 / candSpd;
          candState[3] *= 38.0 / candSpd;
        }

        const candCost = this.computeCost(candState, tRef);
        if (candCost < prevCost) {
          state = candState;
          const relImprove = (prevCost - candCost) / Math.max(1e-9, prevCost);
          prevCost = candCost;
          lambda = Math.max(1e-4, lambda * 0.4);
          if (relImprove < 1e-5 && iter >= 4) break;
        } else {
          lambda = Math.min(1e4, lambda * 4.0);
        }
      }

      // Evaluate fit quality (bearing RMS in degrees)
      let sumSqDeg = 0;
      for (let i = 0; i < n; i++) {
        const obs = this.observations[i];
        const dtHr = (obs.t - tRef) / 3600.0;
        const dx = state[0] + state[2] * dtHr - obs.ox;
        const dy = state[1] + state[3] * dtHr - obs.oy;
        const predB = Math.atan2(dx, dy);
        const resDeg = wrapAngleRad(obs.b - predB) * RAD_TO_DEG;
        sumSqDeg += resDeg * resDeg;
      }
      const rmsDeg = Math.sqrt(sumSqDeg / n);

      const relX = state[0] - curOwnX;
      const relY = state[1] - curOwnY;
      const estRangeNm = clamp(Math.hypot(relX, relY), 0.2, 40.0);
      const estSpeedKts = clamp(Math.hypot(state[2], state[3]), 0, 38);
      const estHeading = Math.round(((Math.atan2(state[2], state[3]) * RAD_TO_DEG) + 360) % 360);

      // Compute TMA Solution Quality (0..100%) from parallax, sample span, and bearing fit RMS
      const parallaxScore = hasRangeAid ? 45 : clamp((crossTrackNm / 0.22) * 45, 5, 45);
      const spanScore = hasRangeAid ? 30 : clamp((timeSpanSec / 90.0) * 30, 5, 30);
      const fitScore = clamp(25 - Math.max(0, rmsDeg - 0.6) * 5.5, 2, 25);
      const qualityPct = Math.round(clamp(parallaxScore + spanScore + fitScore, 20, 99));

      this.lastState = state;
      this.lastSolution = {
        estRangeNm: Number(estRangeNm.toFixed(2)),
        estHeading,
        estSpeedKts: Math.round(estSpeedKts),
        qualityPct,
        rmsDeg: Number(rmsDeg.toFixed(2)),
        observable: true,
        crossTrackNm: Number(crossTrackNm.toFixed(3)),
        sampleCount: n
      };
      return this.lastSolution;
    }

    computeCost(state, tRef) {
      let cost = 0;
      const n = this.observations.length;
      for (let i = 0; i < n; i++) {
        const obs = this.observations[i];
        const dtHr = (obs.t - tRef) / 3600.0;
        const dx = state[0] + state[2] * dtHr - obs.ox;
        const dy = state[1] + state[3] * dtHr - obs.oy;
        const r2 = dx * dx + dy * dy;
        if (r2 < 1e-4) return 1e9;

        const predB = Math.atan2(dx, dy);
        const resB = wrapAngleRad(obs.b - predB) / obs.sigmaB;
        cost += resB * resB;

        if (obs.r !== null) {
          const rHat = Math.sqrt(r2);
          const resR = (obs.r - rHat) / 0.15; // 0.15 NM direct range sigma
          cost += resR * resR;
        }
      }
      // Weak velocity regularization so stationary/low-observability runs don't explode
      cost += (state[2] * state[2] + state[3] * state[3]) * 0.002;
      return cost;
    }

    assembleNormalEquations(state, tRef) {
      const H = [
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0.004, 0],
        [0, 0, 0, 0.004]
      ];
      const g = [0, 0, state[2] * 0.004, state[3] * 0.004];
      const n = this.observations.length;

      for (let i = 0; i < n; i++) {
        const obs = this.observations[i];
        const dtHr = (obs.t - tRef) / 3600.0;
        const dx = state[0] + state[2] * dtHr - obs.ox;
        const dy = state[1] + state[3] * dtHr - obs.oy;
        const r2 = Math.max(1e-4, dx * dx + dy * dy);
        const invR2 = 1.0 / r2;

        // Bearing angle beta = atan2(dx, dy):
        // d(beta)/d(dx) = dy / r^2, d(beta)/d(dy) = -dx / r^2
        const predB = Math.atan2(dx, dy);
        const resB = -wrapAngleRad(obs.b - predB) / obs.sigmaB;
        const jB = [
          (-dy * invR2) / obs.sigmaB,
          (dx * invR2) / obs.sigmaB,
          (-dy * dtHr * invR2) / obs.sigmaB,
          (dx * dtHr * invR2) / obs.sigmaB
        ];

        for (let a = 0; a < 4; a++) {
          g[a] += jB[a] * resB;
          for (let b = 0; b < 4; b++) {
            H[a][b] += jB[a] * jB[b];
          }
        }

        if (obs.r !== null) {
          const rHat = Math.sqrt(r2);
          const sigmaR = 0.15;
          const resR = -(obs.r - rHat) / sigmaR;
          const jR = [
            (dx / rHat) / sigmaR,
            (dy / rHat) / sigmaR,
            (dx * dtHr / rHat) / sigmaR,
            (dy * dtHr / rHat) / sigmaR
          ];
          for (let a = 0; a < 4; a++) {
            g[a] += jR[a] * resR;
            for (let b = 0; b < 4; b++) {
              H[a][b] += jR[a] * jR[b];
            }
          }
        }
      }

      return { H, g };
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BearingOnlyTMASolver;
  }
  root.BearingOnlyTMASolver = BearingOnlyTMASolver;
})(typeof window !== 'undefined' ? window : globalThis);
