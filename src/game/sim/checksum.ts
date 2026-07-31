import type { Replay, SimulationState } from "./types";

const hashParts = (parts: readonly (string | number | boolean)[]): string => {
  let hash = 0x811c9dc5;
  for (const part of parts) {
    const value = typeof part === "boolean" ? (part ? "1" : "0") : String(part);
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    hash ^= 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

export const simulationChecksum = (state: SimulationState): string =>
  hashParts([
    state.level.contentChecksum,
    state.tick,
    state.attempt,
    state.status,
    state.deathReason ?? "",
    state.player.x,
    state.player.y,
    state.player.velocityY,
    state.player.grounded,
    state.player.holdTicks,
    state.player.rotationTenths,
    state.player.jumpCount,
    state.score.total,
    state.score.distance,
    state.score.prism,
    state.score.timing,
    state.score.finish,
    state.score.flow,
    state.score.combo,
    state.score.bestCombo,
    state.score.multiplier,
    state.input.jumpHeld,
    ...state.collectedPrismIds,
    ...state.judgments.flatMap((judgment) => [
      judgment.beatIndex,
      judgment.markerTick,
      judgment.inputTick,
      judgment.offsetTicks,
      judgment.rating,
      judgment.basePoints,
    ]),
  ]);

export const replayChecksum = (replay: Replay): string =>
  hashParts([
    replay.version,
    replay.simulationVersion,
    replay.mode,
    replay.levelId,
    replay.seed,
    ...replay.events.flatMap((event) => [event.tick, event.action]),
  ]);
