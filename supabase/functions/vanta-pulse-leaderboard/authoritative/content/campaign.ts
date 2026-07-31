import { authorLevel } from "./builders.ts";
import type { LevelDefinition } from "./types.ts";

export const GLASS_HORIZON = authorLevel({
  id: "glass-horizon",
  title: "Glass Horizon",
  subtitle: "Find the downbeat. Break the skyline.",
  mode: "campaign",
  seed: 0x474c4153,
  difficulty: 1,
  bpm: 120,
  totalBeats: 30,
  echoDelaysBeats: [],
  threats: [
    { beat: 2, kind: "spike" },
    { beat: 5, kind: "double-spike" },
    { beat: 8, kind: "gap", width: 144 },
    { beat: 11, kind: "pulse-gate" },
    { beat: 14, kind: "gap", width: 180 },
    { beat: 17, kind: "spike" },
    { beat: 20, kind: "double-spike" },
    { beat: 23, kind: "gap", width: 168 },
    { beat: 26, kind: "pulse-gate" },
  ],
  bonusPrisms: [
    { beat: 3, y: 18 },
    { beat: 18, y: 18 },
    { beat: 28, y: 18 },
  ],
  theme: {
    primary: "#37f5ff",
    secondary: "#7c63ff",
    accent: "#f6fbff",
    background: "#03040a",
  },
});

export const PHASE_BLOOM = authorLevel({
  id: "phase-bloom",
  title: "Phase Bloom",
  subtitle: "Your signal returns two beats later.",
  mode: "campaign",
  seed: 0x50484153,
  difficulty: 3,
  bpm: 150,
  totalBeats: 36,
  echoDelaysBeats: [2],
  threats: [
    { beat: 2, kind: "spike" },
    { beat: 5, kind: "gap", width: 168 },
    { beat: 8, kind: "pulse-gate" },
    { beat: 11, kind: "double-spike" },
    { beat: 14, kind: "gap", width: 192 },
    { beat: 17, kind: "spike" },
    { beat: 20, kind: "gap", width: 156 },
    { beat: 23, kind: "pulse-gate" },
    { beat: 26, kind: "double-spike" },
    { beat: 29, kind: "gap", width: 180 },
    { beat: 32, kind: "pulse-gate" },
  ],
  bonusPrisms: [
    { beat: 6, y: 18 },
    { beat: 18, y: 18 },
    { beat: 34, y: 18 },
  ],
  theme: {
    primary: "#ff2bd6",
    secondary: "#37f5ff",
    accent: "#c8ff4a",
    background: "#06030b",
  },
});

export const NULL_CIRCUIT = authorLevel({
  id: "null-circuit",
  title: "Null Circuit",
  subtitle: "Outrun two futures at once.",
  mode: "campaign",
  seed: 0x4e554c4c,
  difficulty: 5,
  bpm: 180,
  totalBeats: 40,
  echoDelaysBeats: [2, 4],
  threats: [
    { beat: 2, kind: "pulse-gate" },
    { beat: 5, kind: "gap", width: 168 },
    { beat: 8, kind: "double-spike" },
    { beat: 11, kind: "gap", width: 192 },
    { beat: 14, kind: "pulse-gate" },
    { beat: 17, kind: "gap", width: 156 },
    { beat: 20, kind: "double-spike" },
    { beat: 23, kind: "pulse-gate" },
    { beat: 26, kind: "gap", width: 204 },
    { beat: 29, kind: "double-spike" },
    { beat: 32, kind: "gap", width: 180 },
    { beat: 35, kind: "pulse-gate" },
    { beat: 38, kind: "spike" },
  ],
  bonusPrisms: [
    { beat: 3, y: 18 },
    { beat: 21, y: 18 },
    { beat: 37, y: 18 },
  ],
  theme: {
    primary: "#c8ff4a",
    secondary: "#ff2bd6",
    accent: "#37f5ff",
    background: "#020604",
  },
});

export const CAMPAIGN_LEVELS = [
  GLASS_HORIZON,
  PHASE_BLOOM,
  NULL_CIRCUIT,
] as const satisfies readonly LevelDefinition[];

export type CampaignLevelId = (typeof CAMPAIGN_LEVELS)[number]["id"];

export const getCampaignLevel = (id: string): LevelDefinition | undefined =>
  CAMPAIGN_LEVELS.find((level) => level.id === id);
