/**
 * Fixed-step simulation clock.
 *
 * Keeps simulation updates independent from display refresh rate. Long browser
 * stalls are clamped and excess catch-up work is discarded to avoid a spiral
 * of death. Time compression is deliberately applied by the caller to each
 * fixed simulation step, not to the wall-clock accumulator.
 */
class SimulationClock {
  constructor({ fixedStepSec = 1 / 30, maxFrameDeltaSec = 0.25, maxSubSteps = 8 } = {}) {
    if (!(fixedStepSec > 0)) throw new RangeError('fixedStepSec must be > 0');
    if (!(maxFrameDeltaSec > 0)) throw new RangeError('maxFrameDeltaSec must be > 0');
    if (!Number.isInteger(maxSubSteps) || maxSubSteps < 1) {
      throw new RangeError('maxSubSteps must be a positive integer');
    }

    this.fixedStepSec = fixedStepSec;
    this.maxFrameDeltaSec = maxFrameDeltaSec;
    this.maxSubSteps = maxSubSteps;
    this.accumulatorSec = 0;
    this.totalSteps = 0;
    this.droppedTimeSec = 0;
  }

  advance(frameDeltaSec, update) {
    if (typeof update !== 'function') throw new TypeError('update must be a function');
    if (!Number.isFinite(frameDeltaSec) || frameDeltaSec < 0) {
      throw new RangeError('frameDeltaSec must be a finite non-negative number');
    }

    const acceptedDelta = Math.min(frameDeltaSec, this.maxFrameDeltaSec);
    this.droppedTimeSec += frameDeltaSec - acceptedDelta;
    this.accumulatorSec += acceptedDelta;

    let steps = 0;
    while (this.accumulatorSec + Number.EPSILON >= this.fixedStepSec &&
           steps < this.maxSubSteps) {
      update(this.fixedStepSec);
      this.accumulatorSec -= this.fixedStepSec;
      if (this.accumulatorSec < 0 && this.accumulatorSec > -1e-12) {
        this.accumulatorSec = 0;
      }
      steps += 1;
      this.totalSteps += 1;
    }

    // Discard whole overdue ticks, preserving the fractional remainder.
    if (this.accumulatorSec >= this.fixedStepSec) {
      const retained = this.accumulatorSec % this.fixedStepSec;
      this.droppedTimeSec += this.accumulatorSec - retained;
      this.accumulatorSec = retained;
    }

    return steps;
  }

  reset() {
    this.accumulatorSec = 0;
    this.totalSteps = 0;
    this.droppedTimeSec = 0;
  }
}

if (typeof window !== 'undefined') window.SimulationClock = SimulationClock;
if (typeof module !== 'undefined' && module.exports) module.exports = SimulationClock;
