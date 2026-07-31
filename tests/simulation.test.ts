import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_LEVELS,
  GLASS_HORIZON,
  NULL_CIRCUIT,
  PHASE_BLOOM,
  THREAT_LAUNCH_DISTANCE,
  createDailyLevel,
  createEndlessLevel,
  dailySeedForDate,
  generateEndlessSegment,
  normalizeDailyDate,
  validateLevelDefinition,
  type LevelDefinition,
} from "../src/game/content";
import {
  SIMULATION_HZ,
  SIMULATION_RULES,
  SIMULATION_VERSION,
  createSimulation,
  judgeTiming,
  restartSimulation,
  simulateReplay,
  simulationChecksum,
  stepSimulation,
  validateReplayEvents,
  verifyReplay,
  type Replay,
  type SimulationState,
} from "../src/game/sim";
import { createReferenceReplay } from "./helpers/referenceReplay";

const stepMany = (
  initial: SimulationState,
  ticks: number,
  jump: (tick: number) => boolean = () => false,
): SimulationState => {
  let state = initial;
  for (let tick = 0; tick < ticks; tick += 1) {
    state = stepSimulation(state, { jump: jump(tick) });
  }
  return state;
};

const quiet = (level: LevelDefinition): LevelDefinition => ({
  ...level,
  hazards: [],
  gaps: [],
  prisms: [],
});

describe("campaign content contracts", () => {
  it("ships three valid integer-authored campaigns", () => {
    expect(CAMPAIGN_LEVELS.map((level) => level.id)).toEqual([
      "glass-horizon",
      "phase-bloom",
      "null-circuit",
    ]);
    for (const level of CAMPAIGN_LEVELS) {
      expect(validateLevelDefinition(level)).toEqual({ valid: true, errors: [] });
      expect(Number.isInteger(level.beatTicks)).toBe(true);
      expect(Number.isInteger(level.finishX)).toBe(true);
      expect(level.hazards.length + level.gaps.length).toBeGreaterThanOrEqual(9);
    }
    expect(GLASS_HORIZON.echoDelaysBeats).toEqual([]);
    expect(PHASE_BLOOM.echoDelaysBeats).toEqual([2]);
    expect(NULL_CIRCUIT.echoDelaysBeats).toEqual([2, 4]);
  });

  it("places every threat at a beat-relative, readable launch distance", () => {
    for (const level of CAMPAIGN_LEVELS) {
      const threatStarts = [
        ...level.hazards.map((hazard) => hazard.x),
        ...level.gaps.map((gap) => gap.startX),
      ];
      for (const x of threatStarts) {
        const launchX = x - THREAT_LAUNCH_DISTANCE;
        expect((launchX - level.startX) % (level.beatTicks * level.speed)).toBe(0);
      }
    }
  });

  it("teaches Glass Horizon with a two-second runway and two single spikes", () => {
    const beatDistance = GLASS_HORIZON.beatTicks * GLASS_HORIZON.speed;
    const orderedThreats = [
      ...GLASS_HORIZON.hazards.map((hazard) => ({ x: hazard.x, kind: hazard.kind })),
      ...GLASS_HORIZON.gaps.map((gap) => ({ x: gap.startX, kind: "gap" as const })),
    ].sort((left, right) => left.x - right.x);
    const beats = orderedThreats.map(({ x }) =>
      (x - THREAT_LAUNCH_DISTANCE - GLASS_HORIZON.startX) / beatDistance,
    );
    expect(beats).toEqual([4, 8, 12, 16, 19, 22, 24, 26, 28]);
    expect(orderedThreats.slice(0, 2).map(({ kind }) => kind)).toEqual(["spike", "spike"]);
    expect(GLASS_HORIZON.prisms.filter((prism) => prism.y === 18).map((prism) => prism.x)).toEqual(
      [1, 2, 10, 27].map((beat) => GLASS_HORIZON.startX + beat * beatDistance),
    );
  });
});

describe("120 Hz deterministic simulation", () => {
  it("produces byte-stable checksums from the same replay", () => {
    const replay = createReferenceReplay(GLASS_HORIZON);
    const first = simulateReplay(GLASS_HORIZON, replay);
    const second = simulateReplay(GLASS_HORIZON, {
      ...replay,
      events: replay.events.map((event) => ({ ...event })),
    });
    expect(SIMULATION_HZ).toBe(120);
    expect(first.finalState).toEqual(second.finalState);
    expect(first.checksum).toBe(second.checksum);
    expect(simulationChecksum(first.finalState)).toMatch(/^[0-9a-f]{8}$/);
    expect(first.finalState.judgments.every((item) => item.rating === "perfect")).toBe(true);
    expect(first.finalState.score.prism).toBeGreaterThan(0);
    expect(first.finalState.score.flow).toBeGreaterThan(0);
  });

  it("uses a longer, integer-only spring arc with an exact landing", () => {
    const level = quiet(GLASS_HORIZON);
    const measureArc = (heldTicks: number) => {
      let state = createSimulation(level);
      let peak = 0;
      const landEvents: number[] = [];
      while (state.tick < 100 && landEvents.length === 0) {
        state = stepSimulation(state, { jump: state.tick < heldTicks });
        peak = Math.max(peak, state.player.y);
        landEvents.push(...state.events.filter((event) => event.type === "land").map((event) => event.tick));
      }
      return { state, peak, landEvents };
    };
    const tapped = measureArc(1);
    const held = measureArc(SIMULATION_RULES.maxHoldTicks);
    expect(tapped).toMatchObject({ peak: 120, landEvents: [31] });
    expect(held).toMatchObject({ peak: 225, landEvents: [44] });
    for (const arc of [tapped, held]) {
      expect(arc.state.player).toMatchObject({ y: 0, velocityY: 0, grounded: true });
      expect(Number.isInteger(arc.peak)).toBe(true);
    }
  });

  it("gives the first Glass spike forgiving tap and hold input windows", () => {
    const first = [...GLASS_HORIZON.hazards].sort((left, right) => left.x - right.x)[0]!;
    const opening: LevelDefinition = {
      ...quiet(GLASS_HORIZON),
      finishX: first.x + first.width + 240,
      hazards: [first],
    };
    const survives = (startTick: number, heldTicks: number) => {
      let state = createSimulation(opening);
      while (state.status === "running") {
        state = stepSimulation(state, {
          jump: state.tick >= startTick && state.tick < startTick + heldTicks,
        });
      }
      return state.status === "finished";
    };
    const tapWindow = Array.from({ length: 80 }, (_, index) => 190 + index)
      .filter((tick) => survives(tick, 1));
    const holdWindow = Array.from({ length: 80 }, (_, index) => 190 + index)
      .filter((tick) => survives(tick, SIMULATION_RULES.maxHoldTicks));
    expect(tapWindow.length).toBeGreaterThanOrEqual(18);
    expect(holdWindow.length).toBeGreaterThanOrEqual(30);
    expect(tapWindow).toContain(240);
    expect(holdWindow).toContain(240);
  });

  it("uses exact perfect/great/good/miss timing boundaries", () => {
    const marker = GLASS_HORIZON.beatTicks * 3;
    expect(judgeTiming(GLASS_HORIZON, marker - 2).rating).toBe("perfect");
    expect(judgeTiming(GLASS_HORIZON, marker + 2).rating).toBe("perfect");
    expect(judgeTiming(GLASS_HORIZON, marker + 3).rating).toBe("great");
    expect(judgeTiming(GLASS_HORIZON, marker + 5).rating).toBe("great");
    expect(judgeTiming(GLASS_HORIZON, marker + 6).rating).toBe("good");
    expect(judgeTiming(GLASS_HORIZON, marker + 9).rating).toBe("good");
    expect(judgeTiming(GLASS_HORIZON, marker + 10).rating).toBe("miss");
    expect(judgeTiming(GLASS_HORIZON, marker, [3]).rating).toBe("miss");
  });

  it("emits delayed echo jumps at exactly 2 and 4 beats", () => {
    const level = quiet(NULL_CIRCUIT);
    let state = createSimulation(level);
    const source = stepSimulation(state, { jump: true });
    const sourceJumpTick = source.events.find((event) => event.type === "jump")?.tick;
    expect(sourceJumpTick).toBe(1);
    state = source;
    const echoedAt: number[] = [];
    while (state.tick <= NULL_CIRCUIT.beatTicks * 4 + 1) {
      state = stepSimulation(state, { jump: false });
      echoedAt.push(
        ...state.events
          .filter((event) => event.type === "echo-jump")
          .map((event) => event.tick),
      );
    }
    expect(echoedAt).toEqual([
      1 + NULL_CIRCUIT.beatTicks * 2,
      1 + NULL_CIRCUIT.beatTicks * 4,
    ]);
    expect(state.echoes.map((echo) => echo.delayBeats)).toEqual([2, 4]);
  });

  it("restarts to a pristine run while preserving the attempt number", () => {
    const fatal: LevelDefinition = {
      ...quiet(GLASS_HORIZON),
      finishX: GLASS_HORIZON.startX + 600,
      hazards: [
        {
          id: "instant",
          kind: "spike",
          x: GLASS_HORIZON.startX + GLASS_HORIZON.speed,
          width: 30,
          height: 80,
        },
      ],
    };
    const dead = stepSimulation(createSimulation(fatal), { jump: false });
    expect(dead.status).toBe("dead");
    const restarted = restartSimulation(dead);
    expect(restarted.status).toBe("running");
    expect(restarted.tick).toBe(0);
    expect(restarted.attempt).toBe(2);
    expect(restarted.player.x).toBe(fatal.startX);
    expect(restarted.score.total).toBe(0);
    expect(restarted.events).toEqual([{ type: "restart", tick: 0 }]);
  });

  it("falls through a real rail gap instead of landing from below it", () => {
    const gapStart = GLASS_HORIZON.startX + GLASS_HORIZON.speed * 2;
    const brokenRail: LevelDefinition = {
      ...quiet(GLASS_HORIZON),
      finishX: GLASS_HORIZON.startX + 1_200,
      gaps: [{ id: "test-gap", startX: gapStart, endX: gapStart + 400 }],
    };
    let state = createSimulation(brokenRail);
    while (state.status === "running") state = stepSimulation(state, { jump: false });
    expect(state.status).toBe("dead");
    expect(state.deathReason).toBe("void");
    expect(state.player.x).toBeLessThan(gapStart + 400);
  });

  it("gives a lethal collision priority over crossing the finish line", () => {
    const finishX = GLASS_HORIZON.startX + GLASS_HORIZON.speed;
    const trap: LevelDefinition = {
      ...quiet(GLASS_HORIZON),
      finishX,
      hazards: [
        {
          id: "finish-trap",
          kind: "pulse-gate",
          x: finishX - 1,
          width: 10,
          height: 100,
        },
      ],
    };
    const result = stepSimulation(createSimulation(trap), { jump: false });
    expect(result.player.x).toBe(finishX);
    expect(result.status).toBe("dead");
    expect(result.deathReason).toBe("hazard");
    expect(result.events.some((event) => event.type === "finish")).toBe(false);
  });
});

describe("seeded modes", () => {
  it("derives a stable daily seed without timezone or locale state", () => {
    const date = "2026-07-31";
    expect(normalizeDailyDate(date)).toBe(date);
    expect(dailySeedForDate(date)).toBe(dailySeedForDate(date));
    expect(dailySeedForDate(date)).not.toBe(dailySeedForDate("2026-08-01"));
    expect(createDailyLevel(date)).toEqual(createDailyLevel(date));
    expect(createDailyLevel(date).id).toBe(`daily-${date}`);
    expect(() => normalizeDailyDate("2026-02-29")).toThrow(/real calendar date/);
  });

  it("generates deterministic, index-addressable endless geometry", () => {
    expect(generateEndlessSegment(42, 7)).toEqual(generateEndlessSegment(42, 7));
    expect(generateEndlessSegment(42, 7)).not.toEqual(generateEndlessSegment(42, 8));
    expect(createEndlessLevel(42, 12)).toEqual(createEndlessLevel(42, 12));
    expect(createEndlessLevel(42, 12).contentChecksum).not.toBe(
      createEndlessLevel(43, 12).contentChecksum,
    );
  });
});

describe("authoritative replay verification", () => {
  it.each(CAMPAIGN_LEVELS)("autoplays and verifies $id", (level) => {
    const replay = createReferenceReplay(level);
    const result = verifyReplay({
      mode: level.mode,
      levelId: level.id,
      seed: level.seed,
      replay,
      simulationVersion: SIMULATION_VERSION,
    });
    expect(result.valid, result.reason).toBe(true);
    expect(result.completed).toBe(true);
    expect(result.score).toBeGreaterThan(5_000);
    expect(result.completionTicks).toBe(
      (level.finishX - level.startX) / level.speed,
    );
    expect(result.durationMs).toBe(
      Math.round((result.completionTicks * 1_000) / SIMULATION_HZ),
    );
  });

  it("also proves deterministic daily and endless layouts are playable", () => {
    const levels = [createDailyLevel("2026-07-31"), createEndlessLevel(0xdecafbad, 10)];
    for (const level of levels) {
      const replay = createReferenceReplay(level);
      const result = verifyReplay({
        mode: level.mode,
        levelId: level.id,
        seed: level.seed,
        replay,
        simulationVersion: SIMULATION_VERSION,
      });
      expect(result.valid, result.reason).toBe(true);
    }
  });

  it("rejects score tampering and malformed input streams", () => {
    const replay = createReferenceReplay(GLASS_HORIZON);
    const tampered: Replay = { ...replay, claimedScore: (replay.claimedScore ?? 0) + 1 };
    const result = verifyReplay({
      mode: "campaign",
      levelId: GLASS_HORIZON.id,
      replay: tampered,
      simulationVersion: SIMULATION_VERSION,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/claimed score/);
    expect(
      validateReplayEvents(
        [
          { tick: 10, action: "jump-down" },
          { tick: 9, action: "jump-up" },
        ],
        1_000,
      ),
    ).toEqual({ valid: false, reason: "replay events must have strictly increasing ticks" });
  });

  it("fails closed on legacy physics replays", () => {
    const current = createReferenceReplay(GLASS_HORIZON);
    const legacy: Replay = { ...current, simulationVersion: 1 };
    const result = verifyReplay({
      mode: "campaign",
      levelId: GLASS_HORIZON.id,
      replay: legacy,
      simulationVersion: 1,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/simulation version/i);
  });
});
