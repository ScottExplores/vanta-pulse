export type VisualThemeId = "glass-horizon" | "phase-bloom" | "null-circuit" | "daily" | "endless";

export type RenderActor = {
  id: string;
  role: "courier" | "echo";
  x: number;
  y: number;
  rotation: number;
  lane: number;
  grounded: boolean;
  velocityY: number;
  color?: number;
  alpha?: number;
  dead?: boolean;
};

export type RenderObjectKind =
  | "rail"
  | "fracture"
  | "shutter"
  | "membrane"
  | "portal"
  | "speed-gate"
  | "checkpoint";

export type RenderObject = {
  id: string;
  kind: RenderObjectKind;
  x: number;
  y: number;
  width: number;
  height: number;
  active?: boolean;
  phase?: number;
  color?: number;
};

export type RenderPrism = {
  id: string;
  x: number;
  y: number;
  collected: boolean;
};

export type RenderPulse = {
  id: string;
  type: "jump" | "land" | "perfect" | "prism" | "portal" | "death" | "complete";
  x: number;
  y: number;
  color?: number;
};

export type GameRenderFrame = {
  tick: number;
  attempt: number;
  theme: VisualThemeId;
  cameraX: number;
  progress: number;
  beatPhase: number;
  state: "countdown" | "running" | "paused" | "dead" | "complete";
  actors: readonly RenderActor[];
  objects: readonly RenderObject[];
  prisms: readonly RenderPrism[];
  pulses?: readonly RenderPulse[];
  shake?: number;
};

export type RenderQuality = "high" | "medium" | "low";
