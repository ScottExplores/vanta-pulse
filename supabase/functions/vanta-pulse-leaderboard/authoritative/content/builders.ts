import {
  LEVEL_SCHEMA_VERSION,
  type BeatMarkerDefinition,
  type GapDefinition,
  type HazardDefinition,
  type HazardKind,
  type LevelDefinition,
  type LevelMode,
  type LevelTheme,
  type LevelValidationResult,
  type PrismDefinition,
} from "./types.ts";

export const CONTENT_START_X = 120;
export const CONTENT_RUN_SPEED = 12;
export const THREAT_LAUNCH_DISTANCE = 168;

export interface ThreatAuthoring {
  readonly beat: number;
  readonly kind: HazardKind | "gap";
  readonly width?: number;
  readonly height?: number;
  readonly prism?: boolean;
}

export interface BonusPrismAuthoring {
  readonly beat: number;
  readonly offsetTicks?: number;
  readonly y?: number;
  readonly value?: number;
}

export interface LevelAuthoring {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly mode: LevelMode;
  readonly seed: number;
  readonly difficulty: 1 | 2 | 3 | 4 | 5;
  readonly bpm: number;
  readonly totalBeats: number;
  readonly echoDelaysBeats: readonly number[];
  readonly threats: readonly ThreatAuthoring[];
  readonly bonusPrisms?: readonly BonusPrismAuthoring[];
  readonly theme: LevelTheme;
}

const fnv1a = (parts: readonly (string | number)[]): string => {
  let hash = 0x811c9dc5;
  for (const part of parts) {
    const value = String(part);
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    hash ^= 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

const hazardDefaults = (
  kind: HazardKind,
): Readonly<{ width: number; height: number }> => {
  switch (kind) {
    case "double-spike":
      return { width: 84, height: 54 };
    case "pulse-gate":
      return { width: 42, height: 76 };
    case "spike":
      return { width: 48, height: 50 };
  }
};

const contentChecksum = (
  level: Omit<LevelDefinition, "contentChecksum">,
): string =>
  fnv1a([
    level.schemaVersion,
    level.id,
    level.mode,
    level.seed,
    level.bpm,
    level.beatTicks,
    level.speed,
    level.startX,
    level.finishX,
    ...level.echoDelaysBeats,
    ...level.gaps.flatMap((gap) => [gap.id, gap.startX, gap.endX]),
    ...level.hazards.flatMap((hazard) => [
      hazard.id,
      hazard.kind,
      hazard.x,
      hazard.width,
      hazard.height,
    ]),
    ...level.prisms.flatMap((prism) => [
      prism.id,
      prism.x,
      prism.y,
      prism.radius,
      prism.value,
    ]),
  ]);

export const authorLevel = (authoring: LevelAuthoring): LevelDefinition => {
  if (7_200 % authoring.bpm !== 0) {
    throw new Error(`BPM ${authoring.bpm} does not map to an integer 120 Hz beat`);
  }

  const beatTicks = 7_200 / authoring.bpm;
  const beatDistance = beatTicks * CONTENT_RUN_SPEED;
  const gaps: GapDefinition[] = [];
  const hazards: HazardDefinition[] = [];
  const prisms: PrismDefinition[] = [];

  authoring.threats.forEach((threat, index) => {
    const launchX = CONTENT_START_X + threat.beat * beatDistance;
    const x = launchX + THREAT_LAUNCH_DISTANCE;
    if (threat.kind === "gap") {
      const width = threat.width ?? 168;
      gaps.push({ id: `gap-${index}`, startX: x, endX: x + width });
    } else {
      const defaults = hazardDefaults(threat.kind);
      hazards.push({
        id: `hazard-${index}`,
        kind: threat.kind,
        x,
        width: threat.width ?? defaults.width,
        height: threat.height ?? defaults.height,
      });
    }

    if (threat.prism !== false) {
      prisms.push({
        id: `prism-threat-${index}`,
        x: x - 24,
        y: threat.kind === "gap" ? 170 : 168,
        radius: 15,
        value: 250,
      });
    }
  });

  for (const [index, prism] of (authoring.bonusPrisms ?? []).entries()) {
    prisms.push({
      id: `prism-bonus-${index}`,
      x:
        CONTENT_START_X +
        (prism.beat * beatTicks + (prism.offsetTicks ?? 0)) * CONTENT_RUN_SPEED,
      y: prism.y ?? 18,
      radius: 14,
      value: prism.value ?? 150,
    });
  }

  const finishX =
    CONTENT_START_X + authoring.totalBeats * beatTicks * CONTENT_RUN_SPEED;
  const beatMarkers: BeatMarkerDefinition[] = Array.from(
    { length: authoring.totalBeats + 1 },
    (_, index) => ({
      index,
      tick: index * beatTicks,
      x: CONTENT_START_X + index * beatDistance,
      accent: index % 4 === 0,
    }),
  );

  const withoutChecksum: Omit<LevelDefinition, "contentChecksum"> = {
    schemaVersion: LEVEL_SCHEMA_VERSION,
    id: authoring.id,
    title: authoring.title,
    subtitle: authoring.subtitle,
    mode: authoring.mode,
    seed: authoring.seed >>> 0,
    difficulty: authoring.difficulty,
    bpm: authoring.bpm,
    beatTicks,
    speed: CONTENT_RUN_SPEED,
    startX: CONTENT_START_X,
    finishX,
    echoDelaysBeats: [...authoring.echoDelaysBeats],
    gaps,
    hazards,
    prisms,
    beatMarkers,
    theme: authoring.theme,
  };

  const level: LevelDefinition = {
    ...withoutChecksum,
    contentChecksum: contentChecksum(withoutChecksum),
  };
  const validation = validateLevelDefinition(level);
  if (!validation.valid) {
    throw new Error(`Invalid level ${level.id}: ${validation.errors.join("; ")}`);
  }
  return level;
};

export const validateLevelDefinition = (
  level: LevelDefinition,
): LevelValidationResult => {
  const errors: string[] = [];
  const integers: readonly [string, number][] = [
    ["seed", level.seed],
    ["bpm", level.bpm],
    ["beatTicks", level.beatTicks],
    ["speed", level.speed],
    ["startX", level.startX],
    ["finishX", level.finishX],
  ];
  for (const [name, value] of integers) {
    if (!Number.isSafeInteger(value)) errors.push(`${name} must be an integer`);
  }
  if (level.schemaVersion !== LEVEL_SCHEMA_VERSION) {
    errors.push("unsupported schema version");
  }
  if (level.finishX <= level.startX) errors.push("finish must follow start");
  if (level.beatTicks <= 0 || level.speed <= 0) {
    errors.push("beatTicks and speed must be positive");
  }
  if (new Set(level.echoDelaysBeats).size !== level.echoDelaysBeats.length) {
    errors.push("echo delays must be unique");
  }
  if (level.echoDelaysBeats.some((beats) => !Number.isSafeInteger(beats) || beats <= 0)) {
    errors.push("echo delays must be positive integer beats");
  }

  const ids = [
    ...level.gaps.map((item) => item.id),
    ...level.hazards.map((item) => item.id),
    ...level.prisms.map((item) => item.id),
  ];
  if (new Set(ids).size !== ids.length) errors.push("geometry ids must be unique");

  for (const gap of level.gaps) {
    if (
      !Number.isSafeInteger(gap.startX) ||
      !Number.isSafeInteger(gap.endX) ||
      gap.startX < level.startX ||
      gap.endX <= gap.startX ||
      gap.endX >= level.finishX
    ) {
      errors.push(`invalid gap ${gap.id}`);
    }
  }
  for (const hazard of level.hazards) {
    if (
      !Number.isSafeInteger(hazard.x) ||
      !Number.isSafeInteger(hazard.width) ||
      !Number.isSafeInteger(hazard.height) ||
      hazard.width <= 0 ||
      hazard.height <= 0 ||
      hazard.x < level.startX ||
      hazard.x >= level.finishX
    ) {
      errors.push(`invalid hazard ${hazard.id}`);
    }
  }
  for (const prism of level.prisms) {
    if (
      !Number.isSafeInteger(prism.x) ||
      !Number.isSafeInteger(prism.y) ||
      !Number.isSafeInteger(prism.radius) ||
      !Number.isSafeInteger(prism.value) ||
      prism.radius <= 0 ||
      prism.value <= 0 ||
      prism.x < level.startX ||
      prism.x >= level.finishX
    ) {
      errors.push(`invalid prism ${prism.id}`);
    }
  }
  for (const marker of level.beatMarkers) {
    if (
      marker.tick !== marker.index * level.beatTicks ||
      marker.x !== level.startX + marker.tick * level.speed
    ) {
      errors.push(`invalid beat marker ${marker.index}`);
    }
  }

  return { valid: errors.length === 0, errors };
};
