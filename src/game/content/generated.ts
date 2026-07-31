import { authorLevel, type ThreatAuthoring } from "./builders";
import type {
  GeneratedSegment,
  HazardKind,
  LevelDefinition,
} from "./types";

export const DEFAULT_ENDLESS_SEGMENTS = 24;
export const DEFAULT_DAILY_SEGMENTS = 18;

const unsignedSeed = (seed: number): number => {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
    throw new Error("seed must be an unsigned 32-bit integer");
  }
  return seed;
};

export const hashSeed = (text: string): number => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
};

export const nextRandom = (
  seed: number,
): Readonly<{ seed: number; value: number }> => {
  let value = unsignedSeed(seed) || 0x6d2b79f5;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  value >>>= 0;
  return { seed: value, value };
};

const daysInMonth = (year: number, month: number): number => {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
};

export const normalizeDailyDate = (date: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error("daily date must be YYYY-MM-DD");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (
    year < 2020 ||
    year > 9999 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month)
  ) {
    throw new Error("daily date is not a real calendar date");
  }
  return date;
};

export const dailySeedForDate = (date: string): number =>
  hashSeed(`vanta-pulse/daily/${normalizeDailyDate(date)}`);

const segmentKind = (value: number): HazardKind | "gap" => {
  switch (value % 5) {
    case 0:
      return "spike";
    case 1:
      return "double-spike";
    case 2:
      return "pulse-gate";
    default:
      return "gap";
  }
};

export const generateEndlessSegment = (
  seed: number,
  index: number,
): GeneratedSegment => {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new Error("segment index must be a non-negative integer");
  }
  let cursor = (unsignedSeed(seed) ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  const first = nextRandom(cursor);
  cursor = first.seed;
  const second = nextRandom(cursor);
  const kind = segmentKind(first.value);
  const widths = kind === "gap" ? [144, 156, 168, 180, 192] : [42, 48, 60, 72];
  const width = widths[second.value % widths.length] ?? widths[0] ?? 48;
  return {
    index,
    seed: second.seed,
    launchBeat: 2 + index * 3,
    kind,
    width,
    prismHeight: 174 + (first.value % 3) * 6,
  };
};

const generatedThreats = (
  seed: number,
  segmentCount: number,
): readonly ThreatAuthoring[] => {
  if (!Number.isSafeInteger(segmentCount) || segmentCount < 1 || segmentCount > 128) {
    throw new Error("segmentCount must be an integer from 1 through 128");
  }
  return Array.from({ length: segmentCount }, (_, index) => {
    const segment = generateEndlessSegment(seed, index);
    return {
      beat: segment.launchBeat,
      kind: segment.kind,
      width: segment.width,
    };
  });
};

const generatedLevel = (
  mode: "daily" | "endless",
  id: string,
  title: string,
  seed: number,
  segmentCount: number,
): LevelDefinition =>
  authorLevel({
    id,
    title,
    subtitle:
      mode === "daily"
        ? "One seed. One global signal."
        : "A deterministic run into the infinite dark.",
    mode,
    seed,
    difficulty: mode === "daily" ? 4 : 5,
    bpm: 150,
    totalBeats: 2 + segmentCount * 3 + 3,
    echoDelaysBeats: [2, 4],
    threats: generatedThreats(seed, segmentCount),
    theme: {
      primary: mode === "daily" ? "#37f5ff" : "#c8ff4a",
      secondary: "#ff2bd6",
      accent: mode === "daily" ? "#c8ff4a" : "#37f5ff",
      background: "#03040a",
    },
  });

export const createDailyLevel = (date: string): LevelDefinition => {
  const normalized = normalizeDailyDate(date);
  const seed = dailySeedForDate(normalized);
  return generatedLevel(
    "daily",
    `daily-${normalized}`,
    `Daily Signal // ${normalized}`,
    seed,
    DEFAULT_DAILY_SEGMENTS,
  );
};

export const endlessLevelId = (seed: number, segmentCount: number): string =>
  `endless-${unsignedSeed(seed).toString(16).padStart(8, "0")}-${segmentCount}`;

export const createEndlessLevel = (
  seed: number,
  segmentCount = DEFAULT_ENDLESS_SEGMENTS,
): LevelDefinition => {
  const normalizedSeed = unsignedSeed(seed);
  return generatedLevel(
    "endless",
    endlessLevelId(normalizedSeed, segmentCount),
    "Infinite Signal",
    normalizedSeed,
    segmentCount,
  );
};

export const parseEndlessLevelId = (
  id: string,
): Readonly<{ seed: number; segmentCount: number }> | undefined => {
  const match = /^endless-([0-9a-f]{8})-(\d{1,3})$/.exec(id);
  if (!match) return undefined;
  const seed = Number.parseInt(match[1] ?? "", 16) >>> 0;
  const segmentCount = Number(match[2]);
  if (segmentCount < 1 || segmentCount > 128) return undefined;
  return { seed, segmentCount };
};
