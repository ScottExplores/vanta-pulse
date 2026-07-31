import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CosmeticsPanel,
  LeaderboardPanel,
  LoadingScreen,
  ModalShell,
  SettingsPanel,
  TutorialOverlay,
} from "./components";
import { GameplayHud, MenuScreen, ResultsScreen } from "./screens";
import type {
  CampaignLevel,
  CosmeticCategory,
  CosmeticItem,
  GameSettings,
  LeaderboardEntry as UiLeaderboardEntry,
  PanelId,
  PlayerProfile,
  RunResult,
  TutorialStep,
} from "./ui-types";
import {
  createLeaderboardClient,
  type LeaderboardClient,
  type LeaderboardSnapshot,
  type RunTicket,
  type TicketRequest,
} from "../features/leaderboard";
import { AudioDirector, type AudioThemeId, type GameAudioEvent } from "../game/audio";
import {
  CAMPAIGN_LEVELS,
  createDailyLevel,
  createEndlessLevel,
  type LevelDefinition,
} from "../game/content";
import { InputRouter } from "../game/input/InputRouter";
import {
  DEFAULT_SETTINGS,
  hasCompletedTutorial,
  loadSettings,
  markTutorialComplete,
  saveSettings,
} from "../game/persistence/settings";
import { GameRuntime, type RuntimeHudSnapshot } from "../game/runtime";
import { SIMULATION_HZ, type Replay, type SimulationEvent, type SimulationState } from "../game/sim";
import { GameCanvas, type GameCanvasHandle, type GameRenderFrame } from "../game/view";

const PROGRESS_KEY = "vanta-pulse.progress.v1";
const COSMETICS_KEY = "vanta-pulse.cosmetics.v1";
const COUNTDOWN_STEP_MS = 560;

type Screen = "loading" | "menu" | "game" | "results";
type ProgressRecord = Record<string, { bestScore: number; completion: number }>;
type ActiveRun = { level: LevelDefinition; ticket: RunTicket; request: TicketRequest };
type RankedRow = UiLeaderboardEntry & { achievedAt: string };

const BACKDROPS: Record<string, string> = {
  "glass-horizon": "/art/backdrops/glass-horizon.webp",
  "phase-bloom": "/art/backdrops/phase-bloom.webp",
  "null-circuit": "/art/backdrops/null-circuit.webp",
};

const DEFAULT_COSMETICS: readonly CosmeticItem[] = [
  { id: "vanta-core", name: "Vanta Core", category: "shell", accent: "cyan", owned: true, equipped: true, description: "Original courier shell" },
  { id: "bloom-shell", name: "Bloom Prism", category: "shell", accent: "magenta", owned: true, equipped: false, description: "Phase-reactive facets" },
  { id: "null-shell", name: "Null Vector", category: "shell", accent: "lime", owned: false, equipped: false, description: "Clear Null Circuit" },
  { id: "ion-thread", name: "Ion Thread", category: "trail", accent: "cyan", owned: true, equipped: true, description: "Tight cyan filament" },
  { id: "afterimage", name: "Afterimage", category: "trail", accent: "magenta", owned: true, equipped: false, description: "Two-beat chroma wake" },
  { id: "event-horizon", name: "Event Horizon", category: "trail", accent: "lime", owned: false, equipped: false, description: "Reach 100,000 flow" },
  { id: "clean-break", name: "Clean Break", category: "burst", accent: "cyan", owned: true, equipped: true, description: "Geometric signal burst" },
  { id: "phase-flower", name: "Phase Flower", category: "burst", accent: "magenta", owned: true, equipped: false, description: "Radial bloom fracture" },
  { id: "singularity", name: "Singularity", category: "burst", accent: "lime", owned: false, equipped: false, description: "Top 10 global signal" },
];

const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: "phase",
    title: "Phase on the pulse",
    body: "Tap, click, Space, W, or controller face buttons to jump. Hold briefly for a longer arc.",
    keyLabel: "SPACE / TAP",
  },
  {
    id: "flow",
    title: "Build clean flow",
    body: "Launch near the beat to raise Flow. Perfect chains multiply distance, prism, and timing score.",
    keyLabel: "LISTEN + REACT",
  },
  {
    id: "echo",
    title: "Protect your echoes",
    body: "Later signals replay your inputs two and four beats behind. One input must carry every timeline.",
    keyLabel: "2 BEATS / 4 BEATS",
  },
];

const loadProgress = (): ProgressRecord => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return false;
        const record = value as Record<string, unknown>;
        return Number.isFinite(record.bestScore) && Number.isFinite(record.completion);
      }),
    ) as ProgressRecord;
  } catch {
    return {};
  }
};

const loadCosmetics = (): CosmeticItem[] => {
  try {
    const equipped = JSON.parse(localStorage.getItem(COSMETICS_KEY) ?? "{}") as Record<string, string>;
    return DEFAULT_COSMETICS.map((item) => ({
      ...item,
      equipped: equipped[item.category] ? equipped[item.category] === item.id : item.equipped,
    }));
  } catch {
    return DEFAULT_COSMETICS.map((item) => ({ ...item }));
  }
};

const saveProgress = (progress: ProgressRecord) => {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    // Progress remains valid for this session when storage is unavailable.
  }
};

const boardForCampaign = (id: string) => `campaign:${id}`;
const themeFor = (level: LevelDefinition): AudioThemeId => {
  if (level.mode === "daily" || level.mode === "endless") return level.mode;
  return level.id as AudioThemeId;
};

const toCampaignCards = (progress: ProgressRecord): CampaignLevel[] =>
  CAMPAIGN_LEVELS.map((level, index) => ({
    id: level.id,
    title: level.title,
    description: level.subtitle,
    backdropUrl: BACKDROPS[level.id] ?? BACKDROPS["glass-horizon"]!,
    accent: index === 0 ? "cyan" : index === 1 ? "magenta" : "lime",
    completion: progress[level.id]?.completion ?? 0,
    bestScore: progress[level.id]?.bestScore ?? 0,
    difficulty: ["SYNC I", "ECHO III", "VOID V"][index]!,
  }));

const gradeRun = (state: SimulationState, completion: number): string => {
  if (state.status !== "finished") return completion >= 70 ? "C" : completion >= 40 ? "D" : "F";
  const judged = Math.max(1, state.judgments.length);
  const precision = state.judgments.reduce((total, judgment) => {
    if (judgment.rating === "perfect") return total + 1;
    if (judgment.rating === "great") return total + 0.82;
    if (judgment.rating === "good") return total + 0.58;
    return total;
  }, 0) / judged;
  if (precision >= 0.92 && state.collectedPrismIds.length === state.level.prisms.length) return "S+";
  if (precision >= 0.82) return "S";
  if (precision >= 0.68) return "A";
  if (precision >= 0.5) return "B";
  return "C";
};

const scoreErrorCopy = (reason: string) => {
  const copies: Record<string, string> = {
    offline: "Network offline; this run is ranked on your device.",
    timeout: "The verifier timed out; this run is preserved locally.",
    "rate-limited": "Signal traffic is high; this run is preserved locally.",
    rejected: "The verifier rejected this signal; the local result is untouched.",
    unavailable: "The verified service is unavailable; this run is preserved locally.",
    unconfigured: "Verified rankings are unavailable; local scoring remains active.",
  };
  return copies[reason] ?? "The run is preserved locally.";
};

const mapLeaderboard = (snapshot: LeaderboardSnapshot): RankedRow[] =>
  snapshot.entries.map((entry) => ({
    rank: entry.rank,
    playerId: entry.publicId,
    name: entry.callsign,
    score: entry.score,
    verified: entry.status === "verified",
    isCurrentPlayer: entry.isCurrentPlayer,
    accent: entry.rank === 1 ? "lime" : entry.rank === 2 ? "cyan" : "magenta",
    achievedAt: entry.achievedAt,
  }));

const initialHud = (): RuntimeHudSnapshot => ({
  tick: 0,
  score: 0,
  progress: 0,
  combo: 0,
  multiplier: 1,
  flow: 0,
  collectedPrisms: 0,
  totalPrisms: 0,
  status: "running",
  attempt: 1,
});

export function App() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [loadingProgress, setLoadingProgress] = useState(0.08);
  const [loadingStatus, setLoadingStatus] = useState("Synchronizing the lattice");
  const [selectedLevelId, setSelectedLevelId] = useState(CAMPAIGN_LEVELS[0].id);
  const [progress, setProgress] = useState<ProgressRecord>(() => loadProgress());
  const [settings, setSettings] = useState<GameSettings>(() => loadSettings());
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [activeRun, setActiveRun] = useState<ActiveRun | null>(null);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [hud, setHud] = useState<RuntimeHudSnapshot>(() => initialHud());
  const [paused, setPaused] = useState(true);
  const [countdown, setCountdown] = useState<string | null>(null);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [timingFault, setTimingFault] = useState(false);
  const [fps, setFps] = useState(0);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [panel, setPanel] = useState<PanelId | null>(null);
  const [leaderboardRows, setLeaderboardRows] = useState<RankedRow[]>([]);
  const [leaderboardStatus, setLeaderboardStatus] = useState<"verified" | "local">("local");
  const [leaderboardLoading, setLeaderboardLoading] = useState(true);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [submittingScore, setSubmittingScore] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [cosmetics, setCosmetics] = useState<CosmeticItem[]>(() => loadCosmetics());
  const [cosmeticCategory, setCosmeticCategory] = useState<CosmeticCategory>("shell");
  const [attempt, setAttempt] = useState(1);

  const canvasRef = useRef<GameCanvasHandle>(null);
  const runtimeRef = useRef<GameRuntime | null>(null);
  const inputRef = useRef<InputRouter | null>(null);
  const audioRef = useRef(new AudioDirector());
  const countdownTimersRef = useRef<number[]>([]);
  const finalizeTimerRef = useRef<number | null>(null);
  const countdownRunRef = useRef<string | null>(null);
  const finishHandledRef = useRef(false);
  const launchingRef = useRef(false);
  const frameCountRef = useRef({ count: 0, since: performance.now() });
  const leaderboardRequestRef = useRef(0);
  const leaderboardClientRef = useRef<LeaderboardClient | null>(null);
  if (!leaderboardClientRef.current) {
    leaderboardClientRef.current = createLeaderboardClient();
  }
  const leaderboardClient = leaderboardClientRef.current;
  const [identity, setIdentity] = useState(() => leaderboardClient.getIdentity());
  const [callsignDraft, setCallsignDraft] = useState(identity.callsign);

  const campaignCards = useMemo(() => toCampaignCards(progress), [progress]);
  const equippedLoadout = useMemo(() => ({
    shellId: cosmetics.find((item) => item.category === "shell" && item.equipped)?.id ?? "vanta-core",
    trailId: cosmetics.find((item) => item.category === "trail" && item.equipped)?.id ?? "ion-thread",
    burstId: cosmetics.find((item) => item.category === "burst" && item.equipped)?.id ?? "clean-break",
  }), [cosmetics]);
  const selectedCard = campaignCards.find((level) => level.id === selectedLevelId) ?? campaignCards[0]!;
  const currentBoardId = activeRun?.ticket.boardId ?? boardForCampaign(selectedLevelId);
  const playerBest = progress[selectedLevelId]?.bestScore ?? 0;
  const profile: PlayerProfile = useMemo(() => ({
    name: identity.callsign,
    localRank: leaderboardRows.find((row) => row.isCurrentPlayer)?.rank ?? null,
    streak: campaignCards.filter((level) => level.completion >= 100).length,
    bestScore: Math.max(0, ...Object.values(progress).map((record) => record.bestScore)),
    verified: leaderboardStatus === "verified",
  }), [campaignCards, identity.callsign, leaderboardRows, leaderboardStatus, progress]);

  const clearCountdown = useCallback(() => {
    countdownTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    countdownTimersRef.current = [];
    setCountdown(null);
  }, []);

  const refreshLeaderboard = useCallback(async (boardId = currentBoardId) => {
    const requestId = ++leaderboardRequestRef.current;
    setLeaderboardLoading(true);
    setLeaderboardError(null);
    setLeaderboardRows([]);
    try {
      const snapshot = await leaderboardClient.fetchLeaderboard(boardId, 50);
      if (requestId !== leaderboardRequestRef.current) return;
      setLeaderboardRows(mapLeaderboard(snapshot));
      setLeaderboardStatus(snapshot.status);
      if (snapshot.fallbackReason && snapshot.fallbackReason !== "unconfigured") {
        setLeaderboardError(scoreErrorCopy(snapshot.fallbackReason));
      }
    } catch {
      if (requestId !== leaderboardRequestRef.current) return;
      setLeaderboardStatus("local");
      setLeaderboardError("Could not decode the global signal. Local records are still safe.");
    } finally {
      if (requestId === leaderboardRequestRef.current) setLeaderboardLoading(false);
    }
  }, [currentBoardId, leaderboardClient]);

  const finalizeRun = useCallback(async (
    state: SimulationState,
    replay: Replay,
    run: ActiveRun,
    runAttempt: number,
  ) => {
    const distance = Math.max(1, state.level.finishX - state.level.startX);
    const completion = Math.min(100, Math.max(0, ((state.player.x - state.level.startX) / distance) * 100));
    const previousBest = progress[state.level.id]?.bestScore ?? 0;
    const bestScore = Math.max(previousBest, state.score.total);
    const result: RunResult = {
      grade: gradeRun(state, completion),
      score: state.score.total,
      bestScore,
      completion,
      prisms: state.collectedPrismIds.length,
      attempts: runAttempt,
      multiplier: state.score.multiplier,
      timing: {
        perfect: state.judgments.filter((judgment) => judgment.rating === "perfect").length,
        good: state.judgments.filter((judgment) => judgment.rating === "great" || judgment.rating === "good").length,
        late: state.judgments.filter((judgment) => judgment.rating === "miss").length,
      },
      isNewBest: state.score.total > previousBest,
      levelName: state.level.title,
      ...(state.status === "finished" ? {} : { leaderboardStatus: "not-eligible" as const }),
    };
    setRunResult(result);
    setScreen("results");
    setPaused(true);
    clearCountdown();

    const nextProgress = {
      ...progress,
      [state.level.id]: {
        bestScore,
        completion: Math.max(progress[state.level.id]?.completion ?? 0, completion),
      },
    };
    setProgress(nextProgress);
    saveProgress(nextProgress);

    if (state.status !== "finished") {
      setSubmittingScore(false);
      setSubmitError(null);
      return;
    }

    setSubmittingScore(true);
    setSubmitError(null);
    try {
      const submitted = await leaderboardClient.submitRun(run.ticket, replay, {
        score: state.score.total,
        durationMs: Math.round((state.tick * 1_000) / SIMULATION_HZ),
      });
      const verifiedRank = submitted.rank;
      if (verifiedRank !== null) {
        setRunResult((current) => current ? { ...current, leaderboardRank: verifiedRank } : current);
      }
      setRunResult((current) => current ? {
        ...current,
        leaderboardStatus: submitted.status === "local"
          ? "local"
          : submitted.isPersonalBest
            ? "verified"
            : "unchanged",
      } : current);
      if (submitted.status === "local") setSubmitError(scoreErrorCopy(submitted.reason));
      await refreshLeaderboard(submitted.boardId);
    } catch {
      setSubmitError("The run could not be published, but your personal best is saved.");
    } finally {
      setSubmittingScore(false);
    }
  }, [clearCountdown, leaderboardClient, progress, refreshLeaderboard]);

  const startCountdown = useCallback((force = false) => {
    const runtime = runtimeRef.current;
    const run = activeRun;
    if (!runtime || !run || screen !== "game" || tutorialOpen) return;
    const key = `${run.ticket.ticketId ?? run.ticket.boardId}:${attempt}`;
    if (!force && countdownRunRef.current === key) return;
    countdownRunRef.current = key;
    clearCountdown();
    runtime.pause();
    audioRef.current.pause();
    setPaused(true);
    setCountdown("3");
    ["2", "1", "GO"].forEach((label, index) => {
      const timer = window.setTimeout(() => setCountdown(label), COUNTDOWN_STEP_MS * (index + 1));
      countdownTimersRef.current.push(timer);
    });
    const launchTimer = window.setTimeout(() => {
      setCountdown(null);
      setPaused(false);
      runtime.resume();
      audioRef.current.resume(themeFor(run.level), run.level.bpm, runtime.snapshot.tick, SIMULATION_HZ);
    }, COUNTDOWN_STEP_MS * 4);
    countdownTimersRef.current.push(launchTimer);
  }, [activeRun, attempt, clearCountdown, screen, tutorialOpen]);

  const restartInPlace = useCallback(() => {
    if (screen !== "game" || !runtimeRef.current) return;
    if (finalizeTimerRef.current !== null) {
      window.clearTimeout(finalizeTimerRef.current);
      finalizeTimerRef.current = null;
    }
    const nextAttempt = attempt + 1;
    setAttempt(nextAttempt);
    finishHandledRef.current = false;
    runtimeRef.current.restart(false);
    setHud({ ...initialHud(), attempt: nextAttempt, totalPrisms: activeRun?.level.prisms.length ?? 0 });
    setTimingFault(false);
    setHasInteracted(false);
    countdownRunRef.current = null;
    clearCountdown();
  }, [activeRun?.level.prisms.length, attempt, clearCountdown, screen]);

  const togglePause = useCallback(() => {
    const runtime = runtimeRef.current;
    const run = activeRun;
    if (!runtime || !run || countdown !== null || tutorialOpen) return;
    if (runtime.isPaused) {
      runtime.resume();
      audioRef.current.resume(themeFor(run.level), run.level.bpm, runtime.snapshot.tick, SIMULATION_HZ);
      setPaused(false);
      setTimingFault(false);
    } else {
      runtime.pause();
      audioRef.current.pause();
      setPaused(true);
    }
  }, [activeRun, countdown, tutorialOpen]);

  const press = useCallback(() => {
    if (countdown !== null || tutorialOpen) return;
    setHasInteracted(true);
    runtimeRef.current?.press();
  }, [countdown, tutorialOpen]);
  const release = useCallback(() => runtimeRef.current?.release(), []);

  const handleRendererError = useCallback(() => {
    runtimeRef.current?.pause();
    audioRef.current.pause();
    setPaused(true);
  }, []);

  const beginRun = useCallback(async (request: TicketRequest) => {
    if (launchingRef.current) return;
    launchingRef.current = true;
    if (finalizeTimerRef.current !== null) {
      window.clearTimeout(finalizeTimerRef.current);
      finalizeTimerRef.current = null;
    }
    setLoadingStatus("Securing verified run channel");
    setLoadingProgress(0.88);
    setScreen("loading");
    setSubmitError(null);
    setRunResult(null);
    setAttempt(1);
    setHasInteracted(false);
    setTimingFault(false);
    finishHandledRef.current = false;
    countdownRunRef.current = null;
    await audioRef.current.unlock().catch(() => false);
    let ticket: RunTicket;
    try {
      ticket = await leaderboardClient.issueTicket(request);
    } catch {
      launchingRef.current = false;
      setScreen("menu");
      return;
    }
    let level: LevelDefinition;
    if (ticket.mode === "campaign") {
      level = CAMPAIGN_LEVELS.find((candidate) => candidate.id === ticket.levelId) ?? CAMPAIGN_LEVELS[0];
    } else if (ticket.mode === "daily") {
      level = createDailyLevel(ticket.levelId.replace(/^daily-/, ""));
    } else {
      level = createEndlessLevel(ticket.seed, Number(ticket.boardId.split(":")[1] ?? 24));
    }
    setActiveRun({ level, ticket, request });
    setHud({ ...initialHud(), totalPrisms: level.prisms.length });
    setTutorialStep(0);
    setTutorialOpen(!hasCompletedTutorial());
    setScreen("game");
    launchingRef.current = false;
  }, [leaderboardClient]);

  const retryRun = useCallback(() => {
    if (activeRun) void beginRun(activeRun.request);
  }, [activeRun, beginRun]);

  const completeTutorial = useCallback(() => {
    markTutorialComplete();
    setTutorialOpen(false);
    countdownRunRef.current = null;
  }, []);

  const pressRef = useRef(press);
  const releaseRef = useRef(release);
  const restartRef = useRef(restartInPlace);
  const pauseRef = useRef(togglePause);
  const finalizeRunRef = useRef(finalizeRun);
  const attemptRef = useRef(attempt);
  pressRef.current = press;
  releaseRef.current = release;
  restartRef.current = restartInPlace;
  pauseRef.current = togglePause;
  finalizeRunRef.current = finalizeRun;
  attemptRef.current = attempt;

  useEffect(() => {
    const start = performance.now();
    const interval = window.setInterval(() => {
      const normalized = Math.min(1, (performance.now() - start) / 1_050);
      setLoadingProgress(0.08 + normalized * 0.92);
      if (normalized >= 1) {
        window.clearInterval(interval);
        setScreen("menu");
      }
    }, 50);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    saveSettings(settings);
    audioRef.current.setMix(settings.masterVolume, settings.musicVolume, settings.sfxVolume);
    canvasRef.current?.configure({
      reducedMotion: settings.reducedMotion,
      photosensitive: settings.photosensitiveMode,
      highContrast: settings.highContrast,
    });
  }, [settings]);

  useEffect(() => {
    audioRef.current.setMuted(!soundEnabled);
  }, [soundEnabled]);

  useEffect(() => {
    const clearedNull = (progress["null-circuit"]?.completion ?? 0) >= 100;
    const reachedFlowTarget = Object.values(progress).some((record) => record.bestScore >= 100_000);
    const reachedGlobalTopTen = leaderboardRows.some((row) => row.isCurrentPlayer && row.rank <= 10);
    setCosmetics((current) => current.map((item) => {
      const unlocked = item.owned ||
        (item.id === "null-shell" && clearedNull) ||
        (item.id === "event-horizon" && reachedFlowTarget) ||
        (item.id === "singularity" && reachedGlobalTopTen);
      return unlocked === item.owned ? item : { ...item, owned: true };
    }));
  }, [leaderboardRows, progress]);

  useEffect(() => {
    if (screen === "loading" || screen === "game") return;
    void refreshLeaderboard(currentBoardId);
  }, [currentBoardId, refreshLeaderboard, screen]);

  useEffect(() => {
    if (screen !== "game" || !activeRun) return;
    const run = activeRun;
    const runtime = new GameRuntime(run.level, {
      onFrame: (frame: GameRenderFrame) => {
        canvasRef.current?.present(settings.screenShake ? frame : { ...frame, shake: 0 });
        const meter = frameCountRef.current;
        meter.count += 1;
        const elapsed = performance.now() - meter.since;
        if (elapsed >= 1_000) {
          setFps(Math.round((meter.count * 1_000) / elapsed));
          frameCountRef.current = { count: 0, since: performance.now() };
        }
      },
      onHud: setHud,
      onEvent: (event: SimulationEvent, state: SimulationState) => {
        let audioEvent: GameAudioEvent | undefined;
        if (event.type === "jump" || event.type === "land" || event.type === "prism" || event.type === "death") {
          audioEvent = event.type;
        } else if (event.type === "finish") {
          audioEvent = "complete";
        } else if (event.type === "echo-jump") {
          audioEvent = "portal";
        } else if (event.type === "judgment" && event.rating && event.rating !== "miss") {
          audioEvent = event.rating === "great" ? "great" : event.rating;
        }
        if (audioEvent) audioRef.current.trigger(audioEvent, state.score.flow);
      },
      onStatus: (state: SimulationState) => {
        if (state.status === "running" || finishHandledRef.current) return;
        finishHandledRef.current = true;
        audioRef.current.pause();
        const replay = runtime.replay();
        finalizeTimerRef.current = window.setTimeout(() => {
          finalizeTimerRef.current = null;
          void finalizeRunRef.current(state, replay, run, attemptRef.current);
        }, 360);
      },
      onTimingFault: () => {
        setTimingFault(true);
        setPaused(true);
        audioRef.current.pause();
      },
    });
    runtimeRef.current = runtime;
    runtime.start();
    runtime.pause();
    setPaused(true);
    const input = new InputRouter({
      onPress: () => pressRef.current(),
      onRelease: () => releaseRef.current(),
      onPause: () => pauseRef.current(),
      onRestart: () => restartRef.current(),
    });
    inputRef.current = input;

    const onVisibility = () => {
      if (!document.hidden || runtime.isPaused || runtime.snapshot.status !== "running") return;
      runtime.pause();
      audioRef.current.pause();
      setPaused(true);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      input.destroy();
      runtime.dispose();
      if (runtimeRef.current === runtime) runtimeRef.current = null;
      if (inputRef.current === input) inputRef.current = null;
      countdownRunRef.current = null;
      if (finalizeTimerRef.current !== null) {
        window.clearTimeout(finalizeTimerRef.current);
        finalizeTimerRef.current = null;
      }
      clearCountdown();
      audioRef.current.pause();
    };
  }, [activeRun, clearCountdown, screen, settings.screenShake]);

  useEffect(() => {
    if (screen === "game" && !tutorialOpen && activeRun && runtimeRef.current) startCountdown();
  }, [activeRun, screen, startCountdown, tutorialOpen]);

  useEffect(() => () => {
    clearCountdown();
    void audioRef.current.destroy();
  }, [clearCountdown]);

  const handleSettings = (next: GameSettings) => setSettings(next);
  const handleEquip = (itemId: string) => {
    setCosmetics((current) => {
      const selected = current.find((item) => item.id === itemId);
      if (!selected?.owned) return current;
      const next = current.map((item) => item.category === selected.category ? { ...item, equipped: item.id === itemId } : item);
      const equipped = Object.fromEntries(next.filter((item) => item.equipped).map((item) => [item.category, item.id]));
      try { localStorage.setItem(COSMETICS_KEY, JSON.stringify(equipped)); } catch { /* session-only cosmetic */ }
      return next;
    });
  };

  const applyCallsign = () => {
    const nextIdentity = leaderboardClient.setCallsign(callsignDraft);
    setIdentity(nextIdentity);
    setCallsignDraft(nextIdentity.callsign);
  };

  const nextCampaign = activeRun?.level.mode === "campaign"
    ? CAMPAIGN_LEVELS[CAMPAIGN_LEVELS.findIndex((level) => level.id === activeRun.level.id) + 1]
    : undefined;

  const modalTitle = panel === "leaderboard" ? "Global signal"
    : panel === "cosmetics" ? "Signal cosmetics"
      : panel === "loadout" ? "Runner loadout"
        : panel === "accessibility" ? "Accessibility"
          : "System settings";

  return (
    <div
      className="vp-app"
      data-high-contrast={settings.highContrast}
      data-photosensitive={settings.photosensitiveMode}
      data-reduced-motion={settings.reducedMotion}
    >
      {screen === "loading" && <LoadingScreen progress={loadingProgress} status={loadingStatus} />}

      {screen === "menu" && (
        <MenuScreen
          leaderboard={leaderboardRows}
          leaderboardLoading={leaderboardLoading}
          levels={campaignCards}
          networkOnline={online && leaderboardStatus === "verified"}
          onOpenPanel={setPanel}
          onRun={() => void beginRun({ mode: "campaign", levelId: selectedLevelId as "glass-horizon" | "phase-bloom" | "null-circuit" })}
          onSelectLevel={setSelectedLevelId}
          onStartMode={(mode) => {
            if (mode === "daily") void beginRun({ mode: "daily", date: new Date().toISOString().slice(0, 10) });
            else void beginRun({ mode: "endless", segmentCount: 32 });
          }}
          profile={profile}
          selectedLevelId={selectedLevelId}
        />
      )}

      {screen === "game" && activeRun && (
        <main className="vp-game-screen" data-mode={activeRun.level.mode}>
          <GameCanvas
            ref={canvasRef}
            className="vp-game-canvas"
            onError={handleRendererError}
            onPress={press}
            onRelease={release}
            options={{
              quality: navigator.hardwareConcurrency <= 4 ||
                window.innerWidth * window.innerHeight * Math.min(window.devicePixelRatio || 1, 1.5) ** 2 > 4_000_000
                ? "medium"
                : "high",
              reducedMotion: settings.reducedMotion,
              photosensitive: settings.photosensitiveMode,
              highContrast: settings.highContrast,
              cosmetics: equippedLoadout,
            }}
          />
          <GameplayHud
            combo={hud.combo}
            hasInteracted={hasInteracted}
            levelName={activeRun.level.title}
            multiplier={hud.multiplier}
            onJump={() => { press(); window.setTimeout(release, 135); }}
            onPause={togglePause}
            onToggleSound={() => setSoundEnabled((enabled) => !enabled)}
            paused={paused && countdown === null && !tutorialOpen}
            prisms={hud.collectedPrisms}
            progress={hud.progress * 100}
            score={hud.score}
            soundEnabled={soundEnabled}
          />
          {countdown && (
            <div aria-live="assertive" className={`vp-countdown${countdown === "GO" ? " is-go" : ""}`}>
              <span>{countdown}</span>
              <small>lock to {activeRun.level.bpm} bpm</small>
            </div>
          )}
          {timingFault && (
            <div className="vp-timing-fault" role="alert">
              <strong>Timing guard engaged</strong>
              <span>The tab stalled, so ranked time is frozen.</span>
              <button onClick={togglePause} type="button">Resume cleanly</button>
            </div>
          )}
          {settings.showFps && <output className="vp-fps-meter">{fps} FPS · 120 Hz SIM</output>}
          <TutorialOverlay
            activeStep={tutorialStep}
            onComplete={completeTutorial}
            onSkip={completeTutorial}
            onStepChange={setTutorialStep}
            open={tutorialOpen}
            steps={TUTORIAL_STEPS}
          />
        </main>
      )}

      {screen === "results" && runResult && activeRun && (
        <ResultsScreen
          actionsDisabled={submittingScore}
          backdropUrl={(BACKDROPS[activeRun.level.id] ?? (activeRun.level.mode === "daily" ? BACKDROPS["phase-bloom"] : BACKDROPS["null-circuit"]))!}
          onMenu={() => {
            setScreen("menu");
            setActiveRun(null);
            setPanel(null);
          }}
          onRetry={retryRun}
          onViewLeaderboard={() => setPanel("leaderboard")}
          {...(nextCampaign ? {
            onNextLevel: () => {
              setSelectedLevelId(nextCampaign.id);
              void beginRun({ mode: "campaign", levelId: nextCampaign.id as "glass-horizon" | "phase-bloom" | "null-circuit" });
            },
          } : {})}
          result={runResult}
          submitError={submitError}
          submittingScore={submittingScore}
        />
      )}

      <ModalShell
        eyebrow="VANTA NETWORK // LIVE"
        onClose={() => setPanel(null)}
        open={panel !== null}
        size={panel === "leaderboard" || panel === "cosmetics" ? "wide" : "standard"}
        title={modalTitle}
      >
        {panel === "leaderboard" && (
          <LeaderboardPanel
            entries={leaderboardRows}
            error={leaderboardError}
            loading={leaderboardLoading}
            onRefresh={() => void refreshLeaderboard()}
            playerBest={activeRun ? (progress[activeRun.level.id]?.bestScore ?? 0) : playerBest}
          />
        )}
        {(panel === "settings" || panel === "accessibility") && (
          <SettingsPanel
            onChange={handleSettings}
            onReset={() => setSettings({ ...DEFAULT_SETTINGS })}
            settings={settings}
          />
        )}
        {panel === "cosmetics" && (
          <CosmeticsPanel
            activeCategory={cosmeticCategory}
            items={cosmetics}
            onCategoryChange={setCosmeticCategory}
            onEquip={handleEquip}
          />
        )}
        {panel === "loadout" && (
          <div className="vp-loadout-panel">
            <div className="vp-runner-id-card vp-cut-panel">
              <span>Verified runner callsign</span>
              <div>
                <input
                  aria-label="Runner callsign"
                  maxLength={12}
                  onChange={(event) => setCallsignDraft(event.target.value)}
                  spellCheck={false}
                  value={callsignDraft}
                />
                <button className="vp-action-button vp-action-button--compact" onClick={applyCallsign} type="button">Apply</button>
              </div>
              <small>3–12 letters, numbers, or underscore. Stored only as your public leaderboard name.</small>
            </div>
            <div className="vp-control-matrix">
              <div><kbd>SPACE / W / ↑</kbd><span>Phase jump / hold</span></div>
              <div><kbd>ESC / P</kbd><span>Freeze signal</span></div>
              <div><kbd>R</kbd><span>Restart attempt</span></div>
              <div><kbd>GAMEPAD A/B/X</kbd><span>Phase jump / hold</span></div>
            </div>
          </div>
        )}
      </ModalShell>
    </div>
  );
}
