import type { LevelDefinition } from "../content";
import {
  SIMULATION_HZ,
  createReplay,
  createSimulation,
  restartSimulation,
  stepSimulation,
  type Replay,
  type ReplayEvent,
  type SimulationEvent,
  type SimulationState,
} from "../sim";
import type {
  GameRenderFrame,
  RenderObject,
  RenderPrism,
  RenderPulse,
  VisualThemeId,
} from "../view";

const STEP_MS = 1_000 / SIMULATION_HZ;
// Allow a short GC/shader-compilation hitch to catch up without invalidating a
// run. Longer stalls still freeze ranked time instead of silently skipping it.
const MAX_CATCH_UP_STEPS = 24;
const GROUND_Y = 430;
const CAMERA_ANCHOR_X = 220;

export type RuntimeHudSnapshot = {
  tick: number;
  score: number;
  progress: number;
  combo: number;
  multiplier: number;
  flow: number;
  collectedPrisms: number;
  totalPrisms: number;
  status: SimulationState["status"];
  attempt: number;
};

export type RuntimeCallbacks = {
  onFrame?: (frame: GameRenderFrame) => void;
  onHud?: (snapshot: RuntimeHudSnapshot) => void;
  onEvent?: (event: SimulationEvent, state: SimulationState) => void;
  onStatus?: (state: SimulationState) => void;
  onTimingFault?: () => void;
};

const themeForLevel = (level: LevelDefinition): VisualThemeId => {
  if (level.mode === "daily") return "daily";
  if (level.mode === "endless") return "endless";
  if (level.id === "phase-bloom") return "phase-bloom";
  if (level.id === "null-circuit") return "null-circuit";
  return "glass-horizon";
};

const railSegments = (level: LevelDefinition): RenderObject[] => {
  const gaps = [...level.gaps].sort((a, b) => a.startX - b.startX);
  const objects: RenderObject[] = [];
  let cursor = level.startX - 900;
  for (const gap of gaps) {
    if (gap.startX > cursor) {
      objects.push({
        id: `rail-${objects.length}`,
        kind: "rail",
        x: cursor,
        y: GROUND_Y,
        width: gap.startX - cursor,
        height: 28,
      });
    }
    cursor = gap.endX;
  }
  if (cursor < level.finishX + 900) {
    objects.push({
      id: `rail-${objects.length}`,
      kind: "rail",
      x: cursor,
      y: GROUND_Y,
      width: level.finishX + 900 - cursor,
      height: 28,
    });
  }
  return objects;
};

const buildRenderObjects = (level: LevelDefinition): readonly RenderObject[] => {
  const objects: RenderObject[] = railSegments(level);
  for (const hazard of level.hazards) {
    objects.push({
      id: hazard.id,
      kind: hazard.kind === "pulse-gate" ? "shutter" : "fracture",
      x: hazard.x,
      y: GROUND_Y - hazard.height,
      width: hazard.width,
      height: hazard.height,
      active: true,
      phase: (hazard.x / level.speed / level.beatTicks) % 1,
    });
  }
  level.echoDelaysBeats.forEach((delay, index) => {
    const x = level.startX + delay * level.beatTicks * level.speed;
    objects.push({
      id: `echo-portal-${delay}`,
      kind: "portal",
      x: x - 32,
      y: 212 + index * 58,
      width: 54,
      height: 108,
      active: true,
    });
  });
  for (let index = 1; index < 4; index += 1) {
    const x = level.startX + ((level.finishX - level.startX) * index) / 4;
    objects.push({
      id: `checkpoint-${index}`,
      kind: "checkpoint",
      x,
      y: 218,
      width: 18,
      height: 212,
      active: true,
    });
  }
  objects.push({
    id: "finish-gate",
    kind: "speed-gate",
    x: level.finishX - 70,
    y: 326,
    width: 68,
    height: 90,
    active: true,
  });
  return objects;
};

const pulseForEvent = (event: SimulationEvent, state: SimulationState): RenderPulse | undefined => {
  const type =
    event.type === "jump" ||
    event.type === "land" ||
    event.type === "prism" ||
    event.type === "death" ||
    event.type === "finish"
      ? event.type === "finish"
        ? "complete"
        : event.type
      : event.type === "judgment" && event.rating === "perfect"
        ? "perfect"
        : undefined;
  if (!type) return undefined;
  let x = state.player.x;
  let y = GROUND_Y - state.player.y - 21;
  if (event.type === "prism" && event.entityId) {
    const prism = state.level.prisms.find((candidate) => candidate.id === event.entityId);
    if (prism) {
      x = prism.x;
      y = GROUND_Y - prism.y;
    }
  }
  return { id: `${state.attempt}-${event.tick}-${event.type}-${event.entityId ?? "player"}`, type, x, y };
};

export const simulationToRenderFrame = (
  state: SimulationState,
  staticObjects: readonly RenderObject[],
  paused: boolean,
): GameRenderFrame => {
  const distance = Math.max(1, state.level.finishX - state.level.startX);
  const progress = Math.max(0, Math.min(1, (state.player.x - state.level.startX) / distance));
  const cameraX = state.player.x - CAMERA_ANCHOR_X;
  const prisms: RenderPrism[] = state.level.prisms.map((prism) => ({
    id: prism.id,
    x: prism.x,
    y: GROUND_Y - prism.y,
    collected: state.collectedPrismIds.includes(prism.id),
  }));
  const pulses = state.events
    .map((event) => pulseForEvent(event, state))
    .filter((pulse): pulse is RenderPulse => pulse !== undefined);
  return {
    tick: state.tick,
    attempt: state.attempt,
    theme: themeForLevel(state.level),
    cameraX,
    progress,
    beatPhase: (state.tick % state.level.beatTicks) / state.level.beatTicks,
    state: paused
      ? "paused"
      : state.status === "finished"
        ? "complete"
        : state.status === "dead"
          ? "dead"
          : "running",
    actors: [
      {
        id: "courier",
        role: "courier",
        x: state.player.x,
        y: GROUND_Y - state.player.y - 21,
        rotation: (-state.player.rotationTenths * Math.PI) / 18_000,
        lane: 0,
        grounded: state.player.grounded,
        velocityY: state.player.velocityY,
        dead: state.status === "dead",
      },
      ...state.echoes
        .filter((echo) => echo.active)
        .map((echo, index) => ({
          id: echo.id,
          role: "echo" as const,
          x: echo.x,
          y: GROUND_Y - echo.y - 21 - (index + 1) * 62,
          rotation: (-state.player.rotationTenths * Math.PI) / 18_000,
          lane: index + 1,
          grounded: echo.grounded,
          velocityY: echo.velocityY,
          alpha: index === 0 ? 0.6 : 0.42,
          color: index === 0 ? 0xff2bd6 : 0xc8ff4a,
        })),
    ],
    objects: staticObjects,
    prisms,
    pulses,
    shake: state.events.some((event) => event.type === "death") ? 8 : state.events.some((event) => event.type === "land") ? 1.5 : 0,
  };
};

export class GameRuntime {
  private state: SimulationState;
  private readonly staticObjects: readonly RenderObject[];
  private readonly callbacks: RuntimeCallbacks;
  private replayEvents: ReplayEvent[] = [];
  private jumpHeld = false;
  private paused = true;
  private disposed = false;
  private timingFault = false;
  private animationFrame: number | null = null;
  private accumulator = 0;
  private previousTime = 0;
  private lastHudTick = -Infinity;

  constructor(readonly level: LevelDefinition, callbacks: RuntimeCallbacks = {}) {
    this.state = createSimulation(level);
    this.staticObjects = buildRenderObjects(level);
    this.callbacks = callbacks;
  }

  get snapshot() {
    return this.state;
  }

  get isPaused() {
    return this.paused;
  }

  get hadTimingFault() {
    return this.timingFault;
  }

  start() {
    if (this.disposed) return;
    this.paused = false;
    this.previousTime = performance.now();
    this.callbacks.onStatus?.(this.state);
    this.emitFrame();
    if (this.animationFrame === null) this.animationFrame = requestAnimationFrame(this.loop);
  }

  pause() {
    if (this.disposed || this.paused) return;
    this.paused = true;
    this.accumulator = 0;
    this.emitFrame();
  }

  resume() {
    if (this.disposed || !this.paused || this.state.status !== "running") return;
    this.paused = false;
    this.previousTime = performance.now();
    this.accumulator = 0;
    this.emitFrame();
  }

  press() {
    if (this.disposed || this.paused || this.jumpHeld || this.state.status !== "running") return;
    this.jumpHeld = true;
    this.replayEvents.push({ tick: this.state.tick, action: "jump-down" });
  }

  release() {
    if (this.disposed || !this.jumpHeld) return;
    this.jumpHeld = false;
    this.replayEvents.push({ tick: this.state.tick, action: "jump-up" });
  }

  restart(autoStart = true) {
    if (this.disposed) return;
    this.state = restartSimulation(this.state);
    this.replayEvents = [];
    this.jumpHeld = false;
    this.timingFault = false;
    this.accumulator = 0;
    this.previousTime = performance.now();
    this.paused = !autoStart;
    this.callbacks.onStatus?.(this.state);
    this.emitFrame();
  }

  replay(): Replay {
    return createReplay(this.level, this.replayEvents);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    this.replayEvents = [];
  }

  private readonly loop = (time: number) => {
    if (this.disposed) return;
    const delta = Math.max(0, Math.min(250, time - this.previousTime));
    this.previousTime = time;
    if (!this.paused && this.state.status === "running") {
      this.accumulator += delta;
      let steps = 0;
      while (this.accumulator >= STEP_MS && steps < MAX_CATCH_UP_STEPS) {
        this.step();
        this.accumulator -= STEP_MS;
        steps += 1;
        if (this.state.status !== "running") break;
      }
      if (this.accumulator >= STEP_MS && this.state.status === "running") {
        this.timingFault = true;
        this.paused = true;
        this.accumulator = 0;
        this.callbacks.onTimingFault?.();
      }
    }
    this.emitFrame();
    this.animationFrame = requestAnimationFrame(this.loop);
  };

  private step() {
    const previousStatus = this.state.status;
    this.state = stepSimulation(this.state, { jump: this.jumpHeld });
    for (const event of this.state.events) this.callbacks.onEvent?.(event, this.state);
    if (this.state.tick - this.lastHudTick >= 8 || this.state.status !== previousStatus) {
      this.lastHudTick = this.state.tick;
      this.callbacks.onHud?.({
        tick: this.state.tick,
        score: this.state.score.total,
        progress: Math.max(
          0,
          Math.min(
            1,
            (this.state.player.x - this.level.startX) / Math.max(1, this.level.finishX - this.level.startX),
          ),
        ),
        combo: this.state.score.combo,
        multiplier: this.state.score.multiplier,
        flow: this.state.score.flow,
        collectedPrisms: this.state.collectedPrismIds.length,
        totalPrisms: this.level.prisms.length,
        status: this.state.status,
        attempt: this.state.attempt,
      });
    }
    if (this.state.status !== previousStatus) {
      this.paused = true;
      this.callbacks.onStatus?.(this.state);
    }
  }

  private emitFrame() {
    this.callbacks.onFrame?.(simulationToRenderFrame(this.state, this.staticObjects, this.paused));
  }
}
