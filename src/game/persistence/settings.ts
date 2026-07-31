import { z } from "zod";
import type { GameSettings } from "../../app/ui-types";

const STORAGE_KEY = "vanta-pulse.settings.v1";

export const DEFAULT_SETTINGS: GameSettings = Object.freeze({
  masterVolume: 0.72,
  musicVolume: 0.66,
  sfxVolume: 0.82,
  reducedMotion: false,
  photosensitiveMode: false,
  screenShake: true,
  highContrast: false,
  showFps: false,
});

const prefersReducedMotion = (): boolean => {
  try {
    return typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

const defaultSettings = (): GameSettings => ({
  ...DEFAULT_SETTINGS,
  reducedMotion: prefersReducedMotion(),
});

const schema = z.object({
  masterVolume: z.number().min(0).max(1),
  musicVolume: z.number().min(0).max(1),
  sfxVolume: z.number().min(0).max(1),
  reducedMotion: z.boolean(),
  photosensitiveMode: z.boolean(),
  screenShake: z.boolean(),
  highContrast: z.boolean(),
  showFps: z.boolean(),
});

export const loadSettings = (): GameSettings => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSettings();
    const result = schema.safeParse(JSON.parse(raw));
    return result.success ? result.data : defaultSettings();
  } catch {
    return defaultSettings();
  }
};

export const saveSettings = (settings: GameSettings) => {
  const result = schema.safeParse(settings);
  if (!result.success) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(result.data));
  } catch {
    // Private browsing or full storage must never block play.
  }
};

export const hasCompletedTutorial = (): boolean => {
  try {
    return localStorage.getItem("vanta-pulse.tutorial.v1") === "complete";
  } catch {
    return false;
  }
};

export const markTutorialComplete = () => {
  try {
    localStorage.setItem("vanta-pulse.tutorial.v1", "complete");
  } catch {
    // Tutorial completion is non-critical persistence.
  }
};
