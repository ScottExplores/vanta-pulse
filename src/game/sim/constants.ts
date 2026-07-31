export const SIMULATION_VERSION = 1 as const;
export const REPLAY_VERSION = 1 as const;
export const SIMULATION_HZ = 120 as const;

export const SIMULATION_RULES = Object.freeze({
  playerWidth: 42,
  playerHeight: 42,
  gravityPerTick: 2,
  jumpVelocity: 24,
  holdBoostPerTick: 1,
  maxHoldTicks: 10,
  deathY: -150,
  echoVisualSpacing: 66,
  maxReplayEvents: 1_024,
  finishGraceTicks: 600,
});

export const TIMING_WINDOWS = Object.freeze({
  perfect: 2,
  great: 5,
  good: 9,
});

export const TIMING_POINTS = Object.freeze({
  perfect: 500,
  great: 300,
  good: 150,
  miss: 0,
});

export const ticksToMilliseconds = (ticks: number): number =>
  Math.round((ticks * 1_000) / SIMULATION_HZ);
