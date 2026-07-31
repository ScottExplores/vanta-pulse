export type InputRouterCallbacks = {
  onPress: () => void;
  onRelease: () => void;
  onPause: () => void;
  onRestart: () => void;
};

const DEFAULT_JUMP_CODES = new Set(["Space", "KeyW", "ArrowUp"]);

const isInteractiveTarget = (target: EventTarget | null): boolean =>
  target instanceof Element && Boolean(target.closest(
    'button, a[href], input, select, textarea, summary, [contenteditable="true"], [role="button"], [role="menuitem"], [role="option"], [role="slider"], [role="switch"], [role="tab"]',
  ));

/** Normalizes keyboard and gamepad sources into a single held-state edge stream. */
export class InputRouter {
  private readonly keyboardHeld = new Set<string>();
  private gamepadHeld = false;
  private logicalHeld = false;
  private frame: number | null = null;
  private disposed = false;

  constructor(private readonly callbacks: InputRouterCallbacks) {
    window.addEventListener("keydown", this.onKeyDown, { passive: false });
    window.addEventListener("keyup", this.onKeyUp, { passive: false });
    window.addEventListener("blur", this.onBlur);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.frame = requestAnimationFrame(this.pollGamepad);
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    document.removeEventListener("visibilitychange", this.onVisibility);
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.clearHeld();
  }

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (isInteractiveTarget(event.target)) return;
    if (event.code === "Escape" || event.code === "KeyP") {
      if (!event.repeat) this.callbacks.onPause();
      event.preventDefault();
      return;
    }
    if (event.code === "KeyR") {
      if (!event.repeat) this.callbacks.onRestart();
      event.preventDefault();
      return;
    }
    if (!DEFAULT_JUMP_CODES.has(event.code)) return;
    event.preventDefault();
    if (event.repeat || this.keyboardHeld.has(event.code)) return;
    this.keyboardHeld.add(event.code);
    this.reconcileHeld();
  };

  private readonly onKeyUp = (event: KeyboardEvent) => {
    if (!DEFAULT_JUMP_CODES.has(event.code)) return;
    if (isInteractiveTarget(event.target) && !this.keyboardHeld.has(event.code)) return;
    event.preventDefault();
    this.keyboardHeld.delete(event.code);
    this.reconcileHeld();
  };

  private readonly onBlur = () => this.clearHeld();

  private readonly onVisibility = () => {
    if (document.hidden) this.clearHeld();
  };

  private readonly pollGamepad = () => {
    if (this.disposed) return;
    const pads = navigator.getGamepads?.() ?? [];
    let held = false;
    for (const pad of pads) {
      if (!pad) continue;
      held ||= Boolean(pad.buttons[0]?.pressed || pad.buttons[1]?.pressed || pad.buttons[2]?.pressed);
    }
    if (held !== this.gamepadHeld) {
      this.gamepadHeld = held;
      this.reconcileHeld();
    }
    this.frame = requestAnimationFrame(this.pollGamepad);
  };

  private reconcileHeld() {
    const next = this.keyboardHeld.size > 0 || this.gamepadHeld;
    if (next === this.logicalHeld) return;
    this.logicalHeld = next;
    if (next) this.callbacks.onPress();
    else this.callbacks.onRelease();
  }

  private clearHeld() {
    this.keyboardHeld.clear();
    this.gamepadHeld = false;
    if (this.logicalHeld) {
      this.logicalHeld = false;
      this.callbacks.onRelease();
    }
  }
}
