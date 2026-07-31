import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InputRouter } from "../src/game/input/InputRouter";
import { loadSettings, saveSettings } from "../src/game/persistence/settings";

describe("accessibility defaults", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("inherits the operating-system reduced-motion preference on first launch", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));

    expect(loadSettings().reducedMotion).toBe(true);
  });

  it("preserves an explicit in-game reduced-motion choice", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    const settings = { ...loadSettings(), reducedMotion: false };
    saveSettings(settings);

    expect(loadSettings().reducedMotion).toBe(false);
  });
});

describe("gameplay input isolation", () => {
  it("does not steal gameplay shortcuts from focused controls", () => {
    const onPress = vi.fn();
    const onRelease = vi.fn();
    const onPause = vi.fn();
    const onRestart = vi.fn();
    const router = new InputRouter({ onPress, onRelease, onPause, onRestart });
    const button = document.createElement("button");
    document.body.append(button);

    button.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "Space",
    }));
    button.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "KeyR",
    }));

    expect(onPress).not.toHaveBeenCalled();
    expect(onRestart).not.toHaveBeenCalled();

    window.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "Space",
    }));
    expect(onPress).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new KeyboardEvent("keyup", {
      bubbles: true,
      cancelable: true,
      code: "Space",
    }));
    expect(onRelease).toHaveBeenCalledTimes(1);

    button.remove();
    router.destroy();
  });
});
