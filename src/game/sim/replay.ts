import {
  createDailyLevel,
  createEndlessLevel,
  getCampaignLevel,
  parseEndlessLevelId,
  type LevelDefinition,
} from "../content";
import { simulationChecksum } from "./checksum";
import {
  REPLAY_VERSION,
  SIMULATION_RULES,
  SIMULATION_VERSION,
  ticksToMilliseconds,
} from "./constants";
import { createSimulation, stepSimulation } from "./simulation";
import type {
  Replay,
  ReplayEvent,
  ReplaySimulationResult,
  VerifyReplayRequest,
  VerifyReplayResult,
} from "./types";

export interface ReplayEventValidation {
  readonly valid: boolean;
  readonly reason?: string;
}

const failure = (reason: string): ReplayEventValidation => ({ valid: false, reason });

export const validateReplayEvents = (
  events: readonly ReplayEvent[],
  maximumTick: number,
): ReplayEventValidation => {
  if (!Array.isArray(events)) return failure("replay events must be an array");
  if (events.length > SIMULATION_RULES.maxReplayEvents) {
    return failure("replay has too many events");
  }
  let previousTick = -1;
  let held = false;
  for (const event of events) {
    if (event === null || typeof event !== "object") {
      return failure("replay events must be objects");
    }
    if (!Number.isSafeInteger(event.tick) || event.tick < 0) {
      return failure("replay ticks must be non-negative integers");
    }
    if (event.tick <= previousTick) {
      return failure("replay events must have strictly increasing ticks");
    }
    if (event.tick > maximumTick) {
      return failure("replay event exceeds the level time limit");
    }
    if (event.action !== "jump-down" && event.action !== "jump-up") {
      return failure("replay contains an unknown action");
    }
    if (event.action === "jump-down" && held) {
      return failure("jump-down cannot occur while jump is held");
    }
    if (event.action === "jump-up" && !held) {
      return failure("jump-up cannot occur while jump is released");
    }
    held = event.action === "jump-down";
    previousTick = event.tick;
  }
  return { valid: true };
};

export const replayTickLimit = (level: LevelDefinition): number =>
  Math.ceil((level.finishX - level.startX) / level.speed) +
  SIMULATION_RULES.finishGraceTicks;

export const simulateReplay = (
  level: LevelDefinition,
  replay: Replay,
): ReplaySimulationResult => {
  let state = createSimulation(level);
  let held = false;
  let eventIndex = 0;
  const maximumTick = replayTickLimit(level);

  while (state.status === "running" && state.tick < maximumTick) {
    const event = replay.events[eventIndex];
    if (event?.tick === state.tick) {
      held = event.action === "jump-down";
      eventIndex += 1;
    }
    state = stepSimulation(state, { jump: held });
  }

  return {
    finalState: state,
    checksum: simulationChecksum(state),
    completed: state.status === "finished",
    completionTicks: state.tick,
    durationMs: ticksToMilliseconds(state.tick),
    consumedEvents: eventIndex,
  };
};

export const createReplay = (
  level: LevelDefinition,
  events: readonly ReplayEvent[],
): Replay => ({
  version: REPLAY_VERSION,
  simulationVersion: SIMULATION_VERSION,
  mode: level.mode,
  levelId: level.id,
  seed: level.seed,
  events: [...events],
});

interface ResolvedLevel {
  readonly level?: LevelDefinition;
  readonly reason?: string;
}

export const resolveReplayLevel = (
  mode: VerifyReplayRequest["mode"],
  levelId: string,
  requestedSeed?: number,
): ResolvedLevel => {
  try {
    if (mode === "campaign") {
      const level = getCampaignLevel(levelId);
      if (!level) return { reason: "unknown campaign level" };
      if (requestedSeed !== undefined && requestedSeed !== level.seed) {
        return { reason: "campaign seed mismatch" };
      }
      return { level };
    }
    if (mode === "daily") {
      const match = /^daily-(\d{4}-\d{2}-\d{2})$/.exec(levelId);
      if (!match?.[1]) return { reason: "invalid daily level id" };
      const level = createDailyLevel(match[1]);
      if (requestedSeed !== undefined && requestedSeed !== level.seed) {
        return { reason: "daily seed mismatch" };
      }
      return { level };
    }
    if (mode === "endless") {
      const parsed = parseEndlessLevelId(levelId);
      if (!parsed) return { reason: "invalid endless level id" };
      if (requestedSeed !== undefined && requestedSeed !== parsed.seed) {
        return { reason: "endless seed mismatch" };
      }
      return { level: createEndlessLevel(parsed.seed, parsed.segmentCount) };
    }
    return { reason: "unknown level mode" };
  } catch (error) {
    return {
      reason: error instanceof Error ? error.message : "level resolution failed",
    };
  }
};

const invalidResult = (
  reason: string,
  result?: ReplaySimulationResult,
): VerifyReplayResult => ({
  valid: false,
  score: result?.finalState.score.total ?? 0,
  durationMs: result?.durationMs ?? 0,
  completionTicks: result?.completionTicks ?? 0,
  checksum: result?.checksum ?? "",
  completed: result?.completed ?? false,
  reason,
});

export const verifyReplay = (
  request: VerifyReplayRequest,
): VerifyReplayResult => {
  if (request.simulationVersion !== SIMULATION_VERSION) {
    return invalidResult("unsupported simulation version");
  }
  const replay = request.replay;
  if (replay.version !== REPLAY_VERSION) {
    return invalidResult("unsupported replay version");
  }
  if (replay.simulationVersion !== SIMULATION_VERSION) {
    return invalidResult("replay simulation version mismatch");
  }
  if (
    !Number.isSafeInteger(replay.seed) ||
    replay.seed < 0 ||
    replay.seed > 0xffff_ffff
  ) {
    return invalidResult("replay seed must be an unsigned 32-bit integer");
  }
  if (
    request.seed !== undefined &&
    (!Number.isSafeInteger(request.seed) || request.seed < 0 || request.seed > 0xffff_ffff)
  ) {
    return invalidResult("request seed must be an unsigned 32-bit integer");
  }
  if (!Array.isArray(replay.events)) return invalidResult("replay events must be an array");
  if (
    replay.claimedScore !== undefined &&
    (!Number.isSafeInteger(replay.claimedScore) || replay.claimedScore < 0)
  ) {
    return invalidResult("claimed score must be a non-negative integer");
  }
  if (
    replay.claimedChecksum !== undefined &&
    !/^[0-9a-f]{8}$/.test(replay.claimedChecksum)
  ) {
    return invalidResult("claimed checksum must be eight lowercase hex characters");
  }
  if (replay.mode !== request.mode || replay.levelId !== request.levelId) {
    return invalidResult("replay board does not match request");
  }
  if (request.seed !== undefined && request.seed !== replay.seed) {
    return invalidResult("request seed does not match replay");
  }

  const resolved = resolveReplayLevel(request.mode, request.levelId, replay.seed);
  if (!resolved.level) return invalidResult(resolved.reason ?? "level could not be resolved");
  const level = resolved.level;
  if (replay.seed !== level.seed) return invalidResult("replay seed mismatch");

  const eventValidation = validateReplayEvents(replay.events, replayTickLimit(level));
  if (!eventValidation.valid) {
    return invalidResult(eventValidation.reason ?? "invalid replay events");
  }

  const result = simulateReplay(level, replay);
  if (result.consumedEvents !== replay.events.length) {
    return invalidResult("replay contains events after the run ended", result);
  }
  if (!result.completed) return invalidResult("run did not finish", result);
  if (
    replay.claimedScore !== undefined &&
    replay.claimedScore !== result.finalState.score.total
  ) {
    return invalidResult("claimed score does not match simulation", result);
  }
  if (
    replay.claimedChecksum !== undefined &&
    replay.claimedChecksum !== result.checksum
  ) {
    return invalidResult("claimed checksum does not match simulation", result);
  }
  return {
    valid: true,
    score: result.finalState.score.total,
    durationMs: result.durationMs,
    completionTicks: result.completionTicks,
    checksum: result.checksum,
    completed: true,
  };
};
