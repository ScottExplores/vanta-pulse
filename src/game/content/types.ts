export const LEVEL_SCHEMA_VERSION = 1 as const;

export type LevelMode = "campaign" | "daily" | "endless";

export type HazardKind = "spike" | "double-spike" | "pulse-gate";

export interface GapDefinition {
  readonly id: string;
  readonly startX: number;
  readonly endX: number;
}

export interface HazardDefinition {
  readonly id: string;
  readonly kind: HazardKind;
  readonly x: number;
  readonly width: number;
  readonly height: number;
}

export interface PrismDefinition {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly value: number;
}

export interface BeatMarkerDefinition {
  readonly index: number;
  readonly tick: number;
  readonly x: number;
  readonly accent: boolean;
}

export interface LevelTheme {
  readonly primary: string;
  readonly secondary: string;
  readonly accent: string;
  readonly background: string;
}

/**
 * Immutable, renderer-agnostic content consumed by both the browser simulation
 * and the score verifier. All world and timing values are integers.
 */
export interface LevelDefinition {
  readonly schemaVersion: typeof LEVEL_SCHEMA_VERSION;
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly mode: LevelMode;
  readonly seed: number;
  readonly difficulty: 1 | 2 | 3 | 4 | 5;
  readonly bpm: number;
  readonly beatTicks: number;
  readonly speed: number;
  readonly startX: number;
  readonly finishX: number;
  readonly echoDelaysBeats: readonly number[];
  readonly gaps: readonly GapDefinition[];
  readonly hazards: readonly HazardDefinition[];
  readonly prisms: readonly PrismDefinition[];
  readonly beatMarkers: readonly BeatMarkerDefinition[];
  readonly theme: LevelTheme;
  readonly contentChecksum: string;
}

export interface GeneratedSegment {
  readonly index: number;
  readonly seed: number;
  readonly launchBeat: number;
  readonly kind: HazardKind | "gap";
  readonly width: number;
  readonly prismHeight: number;
}

export interface LevelValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}
