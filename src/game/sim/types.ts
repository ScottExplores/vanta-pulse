import type { LevelDefinition, LevelMode } from "../content";

export type RunStatus = "running" | "dead" | "finished";
export type DeathReason = "hazard" | "void";
export type TimingRating = "perfect" | "great" | "good" | "miss";

export interface InputFrame {
  readonly jump: boolean;
  readonly restart?: boolean;
}

export interface PlayerState {
  readonly x: number;
  readonly y: number;
  readonly velocityY: number;
  readonly grounded: boolean;
  readonly holdTicks: number;
  readonly rotationTenths: number;
  readonly jumpCount: number;
}

export interface EchoActorState {
  readonly id: string;
  readonly delayBeats: number;
  readonly delayTicks: number;
  readonly sourceTick: number;
  readonly sourceX: number;
  readonly active: boolean;
  readonly x: number;
  readonly y: number;
  readonly velocityY: number;
  readonly grounded: boolean;
  readonly jumpStarted: boolean;
}

export interface TimingJudgment {
  readonly beatIndex: number;
  readonly markerTick: number;
  readonly inputTick: number;
  readonly offsetTicks: number;
  readonly rating: TimingRating;
  readonly basePoints: number;
}

export interface ScoreState {
  readonly total: number;
  readonly distance: number;
  readonly prism: number;
  readonly timing: number;
  readonly finish: number;
  readonly flow: number;
  readonly combo: number;
  readonly bestCombo: number;
  readonly multiplier: 1 | 2 | 3 | 4;
}

export type SimulationEventType =
  | "beat"
  | "jump"
  | "land"
  | "prism"
  | "judgment"
  | "echo-jump"
  | "death"
  | "finish"
  | "restart";

export interface SimulationEvent {
  readonly type: SimulationEventType;
  readonly tick: number;
  readonly entityId?: string;
  readonly value?: number;
  readonly rating?: TimingRating;
  readonly reason?: DeathReason;
  readonly accent?: boolean;
}

export interface HistoryFrame {
  readonly tick: number;
  readonly x: number;
  readonly y: number;
  readonly velocityY: number;
  readonly grounded: boolean;
  readonly jumpStarted: boolean;
}

/** Pure serializable game state. `history` is a bounded echo ring, never a full replay. */
export interface SimulationState {
  readonly level: LevelDefinition;
  readonly tick: number;
  readonly attempt: number;
  readonly status: RunStatus;
  readonly player: PlayerState;
  readonly echoes: readonly EchoActorState[];
  readonly score: ScoreState;
  readonly collectedPrismIds: readonly string[];
  readonly judgedBeatIndices: readonly number[];
  readonly judgments: readonly TimingJudgment[];
  readonly input: Readonly<{ jumpHeld: boolean }>;
  readonly history: readonly HistoryFrame[];
  readonly events: readonly SimulationEvent[];
  readonly deathReason?: DeathReason;
}

export type ReplayAction = "jump-down" | "jump-up";

export interface ReplayEvent {
  readonly tick: number;
  readonly action: ReplayAction;
}

export interface Replay {
  readonly version: 1;
  readonly simulationVersion: number;
  readonly mode: LevelMode;
  readonly levelId: string;
  readonly seed: number;
  readonly events: readonly ReplayEvent[];
  readonly claimedScore?: number;
  readonly claimedChecksum?: string;
}

export interface ReplaySimulationResult {
  readonly finalState: SimulationState;
  readonly checksum: string;
  readonly completed: boolean;
  readonly completionTicks: number;
  readonly durationMs: number;
  readonly consumedEvents: number;
}

export interface VerifyReplayRequest {
  readonly boardId?: string;
  readonly mode: LevelMode;
  readonly levelId: string;
  readonly seed?: number;
  readonly replay: Replay;
  readonly simulationVersion: number;
}

export interface VerifyReplayResult {
  readonly valid: boolean;
  readonly score: number;
  readonly durationMs: number;
  readonly completionTicks: number;
  readonly checksum: string;
  readonly completed: boolean;
  readonly reason?: string;
}
