import type { ReactNode } from "react";

export type AccentTone = "cyan" | "magenta" | "lime";

export type PanelId =
  | "leaderboard"
  | "settings"
  | "cosmetics"
  | "accessibility"
  | "loadout"
  | "daily-rift";

export type CosmeticCategory = "shell" | "trail" | "burst";

export interface PlayerProfile {
  name: string;
  localRank: number | null;
  streak: number;
  bestScore: number;
  avatarUrl?: string;
  verified?: boolean;
}

export interface CampaignLevel {
  id: string;
  title: string;
  description?: string;
  backdropUrl: string;
  accent: AccentTone;
  completion: number;
  bestScore: number;
  difficulty?: string;
  locked?: boolean;
}

export interface LeaderboardEntry {
  rank: number;
  playerId?: string;
  name: string;
  score: number;
  verified?: boolean;
  isCurrentPlayer?: boolean;
  accent?: AccentTone;
}

export interface MenuScreenProps {
  profile: PlayerProfile;
  levels: readonly CampaignLevel[];
  selectedLevelId: string;
  leaderboard: readonly LeaderboardEntry[];
  leaderboardLoading?: boolean;
  networkOnline?: boolean;
  onSelectLevel: (levelId: string) => void;
  onRun: () => void;
  onOpenPanel: (panel: PanelId) => void;
  onStartMode?: (mode: "daily" | "endless") => void;
}

export interface GameplayHudProps {
  levelName: string;
  score: number;
  multiplier: number;
  progress: number;
  combo: number;
  paused: boolean;
  soundEnabled: boolean;
  hasInteracted: boolean;
  prisms?: number;
  onPause: () => void;
  onToggleSound: () => void;
  onJump?: () => void;
}

export interface TimingBreakdown {
  perfect: number;
  good: number;
  late: number;
}

export interface RunResult {
  grade: string;
  score: number;
  bestScore: number;
  completion: number;
  prisms: number;
  attempts: number;
  multiplier: number;
  timing: TimingBreakdown;
  leaderboardRank?: number;
  leaderboardStatus?: "not-eligible" | "verified" | "unchanged" | "local";
  isNewBest?: boolean;
  levelName: string;
}

export interface ResultsScreenProps {
  result: RunResult;
  backdropUrl?: string;
  submittingScore?: boolean;
  actionsDisabled?: boolean;
  submitError?: string | null;
  onRetry: () => void;
  onMenu: () => void;
  onNextLevel?: () => void;
  onViewLeaderboard?: () => void;
}

export interface ModalShellProps {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  open: boolean;
  size?: "compact" | "standard" | "wide";
  footer?: ReactNode;
  onClose: () => void;
}

export interface GameSettings {
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  reducedMotion: boolean;
  photosensitiveMode: boolean;
  screenShake: boolean;
  highContrast: boolean;
  showFps: boolean;
}

export interface SettingsPanelProps {
  settings: GameSettings;
  onChange: (settings: GameSettings) => void;
  onReset?: () => void;
}

export interface CosmeticItem {
  id: string;
  name: string;
  category: CosmeticCategory;
  accent: AccentTone;
  owned: boolean;
  equipped: boolean;
  description?: string;
}

export interface CosmeticsPanelProps {
  items: readonly CosmeticItem[];
  activeCategory: CosmeticCategory;
  onCategoryChange: (category: CosmeticCategory) => void;
  onEquip: (itemId: string) => void;
}

export interface LeaderboardPanelProps {
  entries: readonly LeaderboardEntry[];
  playerBest: number;
  loading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
}

export interface TutorialStep {
  id: string;
  title: string;
  body: string;
  keyLabel?: string;
}

export interface TutorialOverlayProps {
  open: boolean;
  steps: readonly TutorialStep[];
  activeStep: number;
  onStepChange: (step: number) => void;
  onComplete: () => void;
  onSkip: () => void;
}

export interface LoadingScreenProps {
  progress?: number;
  status?: string;
  error?: string | null;
  onRetry?: () => void;
}
