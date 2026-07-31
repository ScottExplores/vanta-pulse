import { describe, expect, it } from "vitest";
import {
  projectCourierAnchor,
  projectTrailX,
  selectRenderQuality,
  selectTrailSamplesByAge,
  selectCourierFrame,
  trailSampleFor,
} from "../src/game/view/presentation";

describe("courier presentation contracts", () => {
  it("keeps mobile and constrained devices on sustainable effect tiers", () => {
    expect(selectRenderQuality({
      coarsePointer: false,
      viewportWidth: 1440,
      effectivePixels: 2_073_600,
      hardwareConcurrency: 12,
      deviceMemoryGb: 16,
    })).toBe("high");
    expect(selectRenderQuality({
      coarsePointer: true,
      viewportWidth: 844,
      effectivePixels: 1_500_000,
      hardwareConcurrency: 8,
      deviceMemoryGb: 8,
    })).toBe("medium");
    expect(selectRenderQuality({
      coarsePointer: true,
      viewportWidth: 390,
      effectivePixels: 740_000,
      hardwareConcurrency: 2,
      deviceMemoryGb: 2,
    })).toBe("low");
  });

  it("selects grounded, rise, apex, fall, and landing poses deterministically", () => {
    expect(selectCourierFrame({ grounded: true, velocityY: 0 }, 0, Infinity, false)).toBe(0);
    expect(selectCourierFrame({ grounded: true, velocityY: 0 }, 8, Infinity, false)).toBe(1);
    expect(selectCourierFrame({ grounded: false, velocityY: 8 }, 9, Infinity, false)).toBe(2);
    expect(selectCourierFrame({ grounded: false, velocityY: 2 }, 10, Infinity, false)).toBe(3);
    expect(selectCourierFrame({ grounded: false, velocityY: -8 }, 11, Infinity, false)).toBe(4);
    expect(selectCourierFrame({ grounded: true, velocityY: 0 }, 12, 0.05, false)).toBe(5);
  });

  it("stores trails in world space and projects them only at draw time", () => {
    const sample = trailSampleFor({ x: 1_234, y: 321, rotation: 0.4 }, 42, 4);
    expect(sample).toMatchObject({ x: 1_234, y: 321, tick: 42, frameIndex: 4 });
    expect(projectTrailX(sample, 1_000)).toBe(234);
    expect(sample.x).toBe(1_234);
  });

  it("rotates afterimage contact anchors around the collider like the live courier", () => {
    expect(projectCourierAnchor({ x: 1_234, y: 321, rotation: 0 }, 1_000, 21)).toEqual({
      x: 234,
      y: 342,
    });
    const quarterTurn = projectCourierAnchor(
      { x: 1_234, y: 321, rotation: Math.PI / 2 },
      1_000,
      21,
    );
    expect(quarterTurn.x).toBeCloseTo(213);
    expect(quarterTurn.y).toBeCloseTo(321);
  });

  it("selects afterimages by simulation age regardless of render sampling rate", () => {
    const historyAt = (tickStep: number) => Array.from(
      { length: Math.floor(52 / tickStep) + 1 },
      (_, index) => {
        const tick = 100 - 52 + index * tickStep;
        return trailSampleFor({ x: tick * 12, y: 300, rotation: 0 }, tick, 0);
      },
    );
    const targetAges = [4, 8, 12, 16, 22, 28];
    for (const tickStep of [1, 2, 4]) {
      const selected = selectTrailSamplesByAge(historyAt(tickStep), 100, targetAges);
      expect(selected).toHaveLength(targetAges.length);
      selected.forEach((sample, index) => {
        expect(Math.abs(100 - sample.tick - targetAges[index]!)).toBeLessThanOrEqual(tickStep / 2);
      });
    }
  });
});
