import type { RenderActor, RenderQuality } from "./types";

export type CourierFrameIndex = 0 | 1 | 2 | 3 | 4 | 5;

export type TrailSample = {
  tick: number;
  x: number;
  y: number;
  rotation: number;
  frameIndex: CourierFrameIndex;
};

export type RenderCapabilityProfile = {
  coarsePointer: boolean;
  viewportWidth: number;
  effectivePixels: number;
  hardwareConcurrency: number;
  deviceMemoryGb: number | undefined;
};

export const selectRenderQuality = (profile: RenderCapabilityProfile): RenderQuality => {
  if (
    profile.hardwareConcurrency <= 2 ||
    (profile.deviceMemoryGb !== undefined && profile.deviceMemoryGb <= 2) ||
    profile.effectivePixels > 6_000_000
  ) return "low";
  if (
    profile.coarsePointer ||
    profile.viewportWidth <= 680 ||
    profile.hardwareConcurrency <= 4 ||
    (profile.deviceMemoryGb !== undefined && profile.deviceMemoryGb <= 4) ||
    profile.effectivePixels > 4_000_000
  ) return "medium";
  return "high";
};

export const selectCourierFrame = (
  actor: Pick<RenderActor, "grounded" | "velocityY">,
  tick: number,
  landingAgeSeconds: number,
  reducedMotion: boolean,
): CourierFrameIndex => {
  if (actor.grounded) {
    if (landingAgeSeconds >= 0 && landingAgeSeconds < (reducedMotion ? 0.08 : 0.16)) return 5;
    return Math.floor(tick / 8) % 2 === 0 ? 0 : 1;
  }
  if (actor.velocityY > 4) return 2;
  if (actor.velocityY < -4) return 4;
  return 3;
};

export const trailSampleFor = (
  actor: Pick<RenderActor, "x" | "y" | "rotation">,
  tick: number,
  frameIndex: CourierFrameIndex,
): TrailSample => ({
  tick,
  x: actor.x,
  y: actor.y,
  rotation: actor.rotation,
  frameIndex,
});

export const projectTrailX = (sample: Pick<TrailSample, "x">, cameraX: number): number =>
  sample.x - cameraX;

export const projectCourierAnchor = (
  sample: Pick<TrailSample, "x" | "y" | "rotation">,
  cameraX: number,
  localOffsetY: number,
): { x: number; y: number } => ({
  x: projectTrailX(sample, cameraX) - Math.sin(sample.rotation) * localOffsetY,
  y: sample.y + Math.cos(sample.rotation) * localOffsetY,
});

export const selectTrailSamplesByAge = (
  history: readonly TrailSample[],
  currentTick: number,
  targetAges: readonly number[],
): TrailSample[] => {
  const selected: TrailSample[] = [];
  const selectedTicks = new Set<number>();
  for (const targetAge of targetAges) {
    const targetTick = currentTick - targetAge;
    let best: TrailSample | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const sample of history) {
      if (sample.tick >= currentTick || selectedTicks.has(sample.tick)) continue;
      const distance = Math.abs(sample.tick - targetTick);
      if (distance < bestDistance || (distance === bestDistance && (!best || sample.tick < best.tick))) {
        best = sample;
        bestDistance = distance;
      }
    }
    if (best) {
      selected.push(best);
      selectedTicks.add(best.tick);
    }
  }
  return selected;
};
