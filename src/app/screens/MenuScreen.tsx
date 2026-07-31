import type { CSSProperties } from "react";
import type { CampaignLevel, MenuScreenProps, PanelId } from "../ui-types";
import { Brand, EclipseMark } from "../components/Brand";
import { Icon, type IconName, VerifiedBadge } from "../components/Icons";

const formatScore = (score: number) => new Intl.NumberFormat("en-US").format(score);

interface UtilityAction {
  id: PanelId | "endless";
  label: string;
  icon: IconName;
  accent?: "cyan" | "magenta" | "lime";
}

const utilityActions: readonly UtilityAction[] = [
  { id: "daily-rift", label: "Daily rift", icon: "daily", accent: "cyan" },
  { id: "endless", label: "Endless", icon: "endless", accent: "magenta" },
  { id: "loadout", label: "Loadout", icon: "loadout" },
  { id: "cosmetics", label: "Cosmetics", icon: "cosmetics", accent: "lime" },
  { id: "settings", label: "Settings", icon: "settings" },
  { id: "accessibility", label: "Accessibility", icon: "accessibility" },
];

function ProfileCard({ profile }: Pick<MenuScreenProps, "profile">) {
  return (
    <section aria-label="Runner profile" className="vp-profile-card vp-cut-panel">
      <div className="vp-profile-avatar">
        {profile.avatarUrl ? <img alt="" src={profile.avatarUrl} /> : <span aria-hidden="true">V</span>}
      </div>
      <div className="vp-profile-card__body">
        <div className="vp-profile-card__name">
          <strong>{profile.name}</strong>
          {profile.verified && <VerifiedBadge />}
        </div>
        <dl className="vp-profile-stats">
          <div>
            <dt>Local rank</dt>
            <dd>{profile.localRank === null ? "—" : `#${formatScore(profile.localRank)}`}</dd>
          </div>
          <div>
            <dt>Streak</dt>
            <dd><span aria-hidden="true">◆</span>{profile.streak}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

interface CampaignCardProps {
  level: CampaignLevel;
  selected: boolean;
  onSelect: () => void;
}

function CampaignCard({ level, selected, onSelect }: CampaignCardProps) {
  const percentage = Math.round(Math.min(100, Math.max(0, level.completion)));
  return (
    <button
      aria-label={`${level.title}, ${percentage}% complete, best score ${formatScore(level.bestScore)}${level.locked ? ", locked" : ""}`}
      aria-pressed={selected}
      className={`vp-campaign-card${selected ? " is-selected" : ""}`}
      data-accent={level.accent}
      disabled={level.locked}
      onClick={onSelect}
      type="button"
    >
      <span className="vp-campaign-card__art">
        <img
          alt=""
          decoding="async"
          fetchPriority={selected ? "high" : "low"}
          loading={selected ? "eager" : "lazy"}
          src={level.backdropUrl}
        />
        <span
          aria-hidden="true"
          className="vp-completion-ring"
          style={{ "--vp-completion": `${percentage * 3.6}deg` } as CSSProperties}
        >
          <span>{percentage}%</span>
        </span>
      </span>
      <span className="vp-campaign-card__copy">
        <strong>{level.title}</strong>
        {level.difficulty && <small>{level.difficulty}</small>}
        <span>Your best</span>
        <b>{formatScore(level.bestScore)}</b>
      </span>
      {level.locked && <span className="vp-campaign-card__locked"><Icon name="lock" size={18} /> Signal locked</span>}
      <span aria-hidden="true" className="vp-campaign-card__corner" />
    </button>
  );
}

function CompactLeaderboard({
  entries,
  loading,
  bestScore,
  onOpen,
}: {
  entries: MenuScreenProps["leaderboard"];
  loading: boolean;
  bestScore: number;
  onOpen: () => void;
}) {
  return (
    <aside className="vp-signal-panel vp-cut-panel">
      <header className="vp-signal-panel__header">
        <div>
          <Icon name="leaderboard" size={21} />
          <h2>Global signal</h2>
        </div>
        <button aria-label="Open full leaderboard" className="vp-dots-button" onClick={onOpen} type="button">
          <span /><span /><span />
        </button>
      </header>
      <div aria-busy={loading} className="vp-signal-panel__scores">
        {loading && entries.length === 0 ? Array.from({ length: 8 }, (_, index) => (
          <div className="vp-signal-row vp-signal-row--skeleton" key={index}><span /><span /><span /></div>
        )) : entries.slice(0, 10).map((entry) => (
          <div className={`vp-signal-row${entry.rank === 1 ? " is-first" : ""}${entry.isCurrentPlayer ? " is-player" : ""}`} key={entry.playerId ?? `${entry.rank}-${entry.name}`}>
            <span className="vp-signal-row__rank">{entry.rank}</span>
            <span className="vp-signal-row__name">{entry.name}{entry.verified && <VerifiedBadge />}</span>
            <strong>{formatScore(entry.score)}</strong>
          </div>
        ))}
        {!loading && entries.length === 0 && <p className="vp-empty-state">Awaiting the first clean signal.</p>}
      </div>
      <button className="vp-signal-panel__best" onClick={onOpen} type="button">
        <span>Your best</span>
        <strong>{formatScore(bestScore)}</strong>
        <Icon name="chevron" size={17} />
      </button>
    </aside>
  );
}

export function MenuScreen({
  profile,
  levels,
  selectedLevelId,
  leaderboard,
  leaderboardLoading = false,
  networkOnline = true,
  onSelectLevel,
  onRun,
  onOpenPanel,
  onStartMode,
}: MenuScreenProps) {
  const selectedLevel = levels.find((level) => level.id === selectedLevelId) ?? levels[0];
  const backdropUrl = selectedLevel?.backdropUrl ?? "/art/backdrops/glass-horizon.webp";
  const accent = selectedLevel?.accent ?? "cyan";

  const handleUtility = (action: UtilityAction) => {
    if (action.id === "endless") {
      onStartMode?.("endless");
      return;
    }
    if (action.id === "daily-rift" && onStartMode) {
      onStartMode("daily");
      return;
    }
    onOpenPanel(action.id);
  };

  return (
    <main className="vp-menu-screen" data-accent={accent}>
      <div aria-hidden="true" className="vp-menu-backdrop" style={{ backgroundImage: `url(${backdropUrl})` }} />
      <div aria-hidden="true" className="vp-screen-vignette" />
      <div aria-hidden="true" className="vp-scanlines" />

      <ProfileCard profile={profile} />
      <div className={`vp-network-status${networkOnline ? " is-online" : ""}`} role="status">
        <span aria-hidden="true" />
        {networkOnline ? "Signal online" : "Local mode"}
      </div>

      <div className="vp-menu-core">
        <section className="vp-menu-hero">
          <EclipseMark />
          <h1><Brand /></h1>
          <button
            aria-label={`Run ${selectedLevel?.title ?? "selected level"}`}
            className="vp-run-button"
            onClick={onRun}
            type="button"
          >
            <span aria-hidden="true" className="vp-run-button__chevrons vp-run-button__chevrons--left">»»</span>
            <span>Run</span>
            <span aria-hidden="true" className="vp-run-button__chevrons">««</span>
          </button>
          {selectedLevel && (
            <p className="vp-selected-signal">
              <span>{selectedLevel.title}</span>
              <span aria-hidden="true">//</span>
              <strong>{Math.round(selectedLevel.completion)}%</strong>
            </p>
          )}
        </section>

        <section aria-labelledby="vp-campaign-title" className="vp-campaign">
          <header className="vp-section-heading">
            <h2 id="vp-campaign-title">Campaign</h2>
            <span>{levels.filter((level) => level.completion >= 100).length}/{levels.length} cleared</span>
          </header>
          <div className="vp-campaign-rail">
            {levels.map((level) => (
              <CampaignCard
                key={level.id}
                level={level}
                onSelect={() => onSelectLevel(level.id)}
                selected={level.id === selectedLevelId}
              />
            ))}
          </div>
        </section>

        <CompactLeaderboard
          bestScore={profile.bestScore}
          entries={leaderboard}
          loading={leaderboardLoading}
          onOpen={() => onOpenPanel("leaderboard")}
        />
      </div>

      <nav aria-label="Game modes and utilities" className="vp-utility-nav">
        {utilityActions.map((action) => (
          <button
            className="vp-utility-button"
            data-accent={action.accent ?? "neutral"}
            key={action.id}
            onClick={() => handleUtility(action)}
            type="button"
          >
            <Icon name={action.icon} size={26} />
            <span>{action.label}</span>
            {(action.id === "endless" || action.id === "daily-rift") && <Icon className="vp-utility-button__next" name="chevron" size={13} />}
          </button>
        ))}
      </nav>
    </main>
  );
}
