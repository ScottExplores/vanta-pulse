// Deployment adapter. `authoritative/` is an exact local, Edge-pure mirror of
// src/game/{sim,content}, so Dashboard/MCP deployments bundle the verifier
// instead of depending on files outside this function directory.
export {
  dailySeedForDate,
} from "./authoritative/content/generated.ts";
export { SIMULATION_VERSION } from "./authoritative/sim/constants.ts";
export { verifyReplay } from "./authoritative/sim/replay.ts";

export type { LevelMode } from "./authoritative/content/types.ts";
export type {
  Replay,
  ReplayEvent,
  VerifyReplayRequest,
  VerifyReplayResult,
} from "./authoritative/sim/types.ts";
