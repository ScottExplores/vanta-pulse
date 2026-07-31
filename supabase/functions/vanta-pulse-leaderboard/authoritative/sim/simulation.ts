import type { LevelDefinition } from "../content/types.ts";
import {
  SIMULATION_RULES,
  TIMING_POINTS,
  TIMING_WINDOWS,
} from "./constants.ts";
import type {
  DeathReason,
  EchoActorState,
  HistoryFrame,
  InputFrame,
  PlayerState,
  ScoreState,
  SimulationEvent,
  SimulationState,
  TimingJudgment,
  TimingRating,
} from "./types.ts";

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

const multiplierForFlow = (flow: number): 1 | 2 | 3 | 4 => {
  if (flow >= 750) return 4;
  if (flow >= 500) return 3;
  if (flow >= 250) return 2;
  return 1;
};

export const railExistsAt = (level: LevelDefinition, x: number): boolean =>
  !level.gaps.some((gap) => x >= gap.startX && x <= gap.endX);

const initialScore = (): ScoreState => ({
  total: 0,
  distance: 0,
  prism: 0,
  timing: 0,
  finish: 0,
  flow: 0,
  combo: 0,
  bestCombo: 0,
  multiplier: 1,
});

const inactiveEchoes = (level: LevelDefinition): readonly EchoActorState[] =>
  level.echoDelaysBeats.map((delayBeats, index) => ({
    id: `echo-${index + 1}`,
    delayBeats,
    delayTicks: delayBeats * level.beatTicks,
    sourceTick: -delayBeats * level.beatTicks,
    sourceX: level.startX,
    active: false,
    x: level.startX - SIMULATION_RULES.echoVisualSpacing * (index + 1),
    y: 0,
    velocityY: 0,
    grounded: true,
    jumpStarted: false,
  }));

export const createSimulation = (
  level: LevelDefinition,
  options: Readonly<{ attempt?: number }> = {},
): SimulationState => {
  const player: PlayerState = {
    x: level.startX,
    y: 0,
    velocityY: 0,
    grounded: true,
    holdTicks: 0,
    rotationTenths: 0,
    jumpCount: 0,
  };
  const firstFrame: HistoryFrame = {
    tick: 0,
    x: player.x,
    y: player.y,
    velocityY: player.velocityY,
    grounded: player.grounded,
    jumpStarted: false,
  };
  return {
    level,
    tick: 0,
    attempt: options.attempt ?? 1,
    status: "running",
    player,
    echoes: inactiveEchoes(level),
    score: initialScore(),
    collectedPrismIds: [],
    judgedBeatIndices: [],
    judgments: [],
    input: { jumpHeld: false },
    history: [firstFrame],
    events: [],
  };
};

export const restartSimulation = (state: SimulationState): SimulationState => ({
  ...createSimulation(state.level, { attempt: state.attempt + 1 }),
  events: [{ type: "restart", tick: 0 }],
});

const timingRating = (absoluteOffset: number): TimingRating => {
  if (absoluteOffset <= TIMING_WINDOWS.perfect) return "perfect";
  if (absoluteOffset <= TIMING_WINDOWS.great) return "great";
  if (absoluteOffset <= TIMING_WINDOWS.good) return "good";
  return "miss";
};

export const judgeTiming = (
  level: LevelDefinition,
  inputTick: number,
  usedBeatIndices: readonly number[] = [],
): TimingJudgment => {
  const lastBeat = Math.max(0, level.beatMarkers.length - 1);
  const nearest = clamp(
    Math.floor((inputTick + Math.floor(level.beatTicks / 2)) / level.beatTicks),
    0,
    lastBeat,
  );
  const markerTick = nearest * level.beatTicks;
  const offsetTicks = inputTick - markerTick;
  const duplicate = usedBeatIndices.includes(nearest);
  const rating = duplicate ? "miss" : timingRating(Math.abs(offsetTicks));
  return {
    beatIndex: nearest,
    markerTick,
    inputTick,
    offsetTicks,
    rating,
    basePoints: TIMING_POINTS[rating],
  };
};

const scoreJudgment = (
  score: ScoreState,
  judgment: TimingJudgment,
): ScoreState => {
  const success = judgment.rating !== "miss";
  const flowGain =
    judgment.rating === "perfect"
      ? 125
      : judgment.rating === "great"
        ? 80
        : judgment.rating === "good"
          ? 40
          : -180;
  const combo = success ? score.combo + 1 : 0;
  const flow = clamp(score.flow + flowGain, 0, 1_000);
  const timingGain = judgment.basePoints * score.multiplier;
  return {
    ...score,
    total: score.total + timingGain,
    timing: score.timing + timingGain,
    flow,
    combo,
    bestCombo: Math.max(score.bestCombo, combo),
    multiplier: multiplierForFlow(flow),
  };
};

const addDistanceScore = (score: ScoreState, nextTick: number): ScoreState => {
  const decay = nextTick % 30 === 0 && score.flow > 0 ? 1 : 0;
  const flow = score.flow - decay;
  return {
    ...score,
    total: score.total + score.multiplier,
    distance: score.distance + score.multiplier,
    flow,
    multiplier: multiplierForFlow(flow),
  };
};

const overlapsHazard = (
  player: PlayerState,
  level: LevelDefinition,
): string | undefined => {
  const left = player.x - Math.floor(SIMULATION_RULES.playerWidth / 2);
  const right = player.x + Math.floor(SIMULATION_RULES.playerWidth / 2);
  const bottom = player.y;
  const top = player.y + SIMULATION_RULES.playerHeight;
  return level.hazards.find(
    (hazard) =>
      right >= hazard.x &&
      left <= hazard.x + hazard.width &&
      top >= 0 &&
      bottom <= hazard.height,
  )?.id;
};

const overlapsPrism = (
  player: PlayerState,
  prism: LevelDefinition["prisms"][number],
): boolean => {
  const left = player.x - Math.floor(SIMULATION_RULES.playerWidth / 2);
  const right = player.x + Math.floor(SIMULATION_RULES.playerWidth / 2);
  const bottom = player.y;
  const top = player.y + SIMULATION_RULES.playerHeight;
  return (
    prism.x + prism.radius >= left &&
    prism.x - prism.radius <= right &&
    prism.y + prism.radius >= bottom &&
    prism.y - prism.radius <= top
  );
};

const updateEchoes = (
  level: LevelDefinition,
  player: PlayerState,
  tick: number,
  history: readonly HistoryFrame[],
  events: SimulationEvent[],
): readonly EchoActorState[] =>
  level.echoDelaysBeats.map((delayBeats, index) => {
    const delayTicks = delayBeats * level.beatTicks;
    const sourceTick = tick - delayTicks;
    const source = history.find((frame) => frame.tick === sourceTick);
    const echo: EchoActorState = {
      id: `echo-${index + 1}`,
      delayBeats,
      delayTicks,
      sourceTick,
      sourceX: source?.x ?? level.startX,
      active: source !== undefined,
      x: player.x - SIMULATION_RULES.echoVisualSpacing * (index + 1),
      y: source?.y ?? 0,
      velocityY: source?.velocityY ?? 0,
      grounded: source?.grounded ?? true,
      jumpStarted: source?.jumpStarted ?? false,
    };
    if (echo.active && echo.jumpStarted) {
      events.push({ type: "echo-jump", tick, entityId: echo.id });
    }
    return echo;
  });

const terminalState = (
  state: SimulationState,
  events: readonly SimulationEvent[],
  status: "dead" | "finished",
  deathReason?: DeathReason,
): SimulationState => {
  if (deathReason === undefined) return { ...state, status, events };
  return { ...state, status, events, deathReason };
};

export const stepSimulation = (
  state: SimulationState,
  input: InputFrame = { jump: false },
): SimulationState => {
  if (input.restart === true) return restartSimulation(state);
  if (state.status !== "running") {
    return state.events.length > 0 ? { ...state, events: [] } : state;
  }

  const nextTick = state.tick + 1;
  const events: SimulationEvent[] = [];
  let score = addDistanceScore(state.score, nextTick);
  let judgments = state.judgments;
  let judgedBeatIndices = state.judgedBeatIndices;
  let player: PlayerState = { ...state.player };
  const jumpPressed = input.jump && !state.input.jumpHeld;
  let jumpStarted = false;

  const beat = state.level.beatMarkers.find((marker) => marker.tick === nextTick);
  if (beat) {
    events.push({ type: "beat", tick: nextTick, value: beat.index, accent: beat.accent });
  }

  if (jumpPressed && player.grounded) {
    jumpStarted = true;
    player = {
      ...player,
      velocityY: SIMULATION_RULES.jumpVelocity,
      grounded: false,
      holdTicks: 0,
      jumpCount: player.jumpCount + 1,
    };
    const judgment = judgeTiming(state.level, state.tick, judgedBeatIndices);
    judgments = [...judgments, judgment];
    judgedBeatIndices = [...judgedBeatIndices, judgment.beatIndex];
    score = scoreJudgment(score, judgment);
    events.push(
      { type: "jump", tick: nextTick },
      { type: "judgment", tick: nextTick, rating: judgment.rating, value: judgment.basePoints },
    );
  }

  const previousY = player.y;
  const nextX = player.x + state.level.speed;
  let velocityY = player.velocityY;
  let y = player.y;
  let grounded = player.grounded;
  let holdTicks = player.holdTicks;
  if (grounded && !railExistsAt(state.level, nextX)) grounded = false;
  if (!grounded) {
    if (
      input.jump &&
      holdTicks < SIMULATION_RULES.maxHoldTicks &&
      velocityY > 0
    ) {
      velocityY += SIMULATION_RULES.holdBoostPerTick;
      holdTicks += 1;
    } else if (!input.jump) {
      holdTicks = SIMULATION_RULES.maxHoldTicks;
    }
    velocityY -= SIMULATION_RULES.gravityPerTick;
    y += velocityY;
    if (
      previousY >= 0 &&
      y <= 0 &&
      velocityY <= 0 &&
      railExistsAt(state.level, nextX)
    ) {
      y = 0;
      velocityY = 0;
      grounded = true;
      holdTicks = 0;
      events.push({ type: "land", tick: nextTick });
    }
  }
  const rotationTenths = grounded
    ? Math.round(player.rotationTenths / 900) * 900 % 3_600
    : (player.rotationTenths + 135) % 3_600;
  player = {
    ...player,
    x: nextX,
    y,
    velocityY,
    grounded,
    holdTicks,
    rotationTenths,
  };

  const collected = new Set(state.collectedPrismIds);
  for (const prism of state.level.prisms) {
    if (!collected.has(prism.id) && overlapsPrism(player, prism)) {
      collected.add(prism.id);
      const gain = prism.value * score.multiplier;
      score = {
        ...score,
        total: score.total + gain,
        prism: score.prism + gain,
        flow: clamp(score.flow + 35, 0, 1_000),
      };
      score = { ...score, multiplier: multiplierForFlow(score.flow) };
      events.push({ type: "prism", tick: nextTick, entityId: prism.id, value: gain });
    }
  }

  const frame: HistoryFrame = {
    tick: nextTick,
    x: player.x,
    y: player.y,
    velocityY: player.velocityY,
    grounded: player.grounded,
    jumpStarted,
  };
  const maximumDelay = Math.max(0, ...state.level.echoDelaysBeats) * state.level.beatTicks;
  const history = [...state.history, frame].filter(
    (item) => item.tick >= nextTick - maximumDelay,
  );
  const echoes = updateEchoes(state.level, player, nextTick, history, events);

  let next: SimulationState = {
    ...state,
    tick: nextTick,
    player,
    echoes,
    score,
    collectedPrismIds: [...collected],
    judgedBeatIndices,
    judgments,
    input: { jumpHeld: input.jump },
    history,
    events,
  };

  // Death is deliberately resolved before finish. A finish-line hazard cannot
  // produce a leaderboard-eligible run on the collision tick.
  const hazardId = overlapsHazard(player, state.level);
  if (hazardId !== undefined) {
    events.push({ type: "death", tick: nextTick, entityId: hazardId, reason: "hazard" });
    return terminalState(next, events, "dead", "hazard");
  }
  if (player.y < SIMULATION_RULES.deathY) {
    events.push({ type: "death", tick: nextTick, reason: "void" });
    return terminalState(next, events, "dead", "void");
  }
  if (player.x >= state.level.finishX) {
    const finishGain = 1_000 + score.flow * 2;
    score = {
      ...score,
      total: score.total + finishGain,
      finish: score.finish + finishGain,
    };
    events.push({ type: "finish", tick: nextTick, value: finishGain });
    next = { ...next, score };
    return terminalState(next, events, "finished");
  }
  return next;
};
