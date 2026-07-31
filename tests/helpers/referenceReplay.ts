import { THREAT_LAUNCH_DISTANCE, type LevelDefinition } from "../../src/game/content";
import {
  SIMULATION_RULES,
  SIMULATION_VERSION,
  createSimulation,
  replayTickLimit,
  simulationChecksum,
  stepSimulation,
  type Replay,
  type ReplayEvent,
} from "../../src/game/sim";

const nextThreatX = (level: LevelDefinition, playerX: number): number | undefined => {
  let nearest = Number.POSITIVE_INFINITY;
  for (const gap of level.gaps) {
    if (gap.startX > playerX && gap.startX < nearest) nearest = gap.startX;
  }
  for (const hazard of level.hazards) {
    if (hazard.x > playerX && hazard.x < nearest) nearest = hazard.x;
  }
  return Number.isFinite(nearest) ? nearest : undefined;
};

/** Test/operator-only deterministic pilot used to prove authored levels are completable. */
export const createReferenceReplay = (level: LevelDefinition): Replay => {
  let state = createSimulation(level);
  let held = false;
  let releaseTick = -1;
  const events: ReplayEvent[] = [];
  const maximumTick = replayTickLimit(level);

  while (state.status === "running" && state.tick < maximumTick) {
    if (held && state.tick >= releaseTick) {
      held = false;
      events.push({ tick: state.tick, action: "jump-up" });
    }
    const threatX = nextThreatX(level, state.player.x);
    if (
      !held &&
      state.player.grounded &&
      threatX !== undefined &&
      threatX - state.player.x <= THREAT_LAUNCH_DISTANCE &&
      threatX > state.player.x
    ) {
      held = true;
      releaseTick = state.tick + SIMULATION_RULES.maxHoldTicks;
      events.push({ tick: state.tick, action: "jump-down" });
    }
    state = stepSimulation(state, { jump: held });
  }

  if (state.status !== "finished") {
    throw new Error(
      `Reference pilot could not finish ${level.id} (status=${state.status}, tick=${state.tick})`,
    );
  }
  return {
    version: 1,
    simulationVersion: SIMULATION_VERSION,
    mode: level.mode,
    levelId: level.id,
    seed: level.seed,
    events,
    claimedScore: state.score.total,
    claimedChecksum: simulationChecksum(state),
  };
};
