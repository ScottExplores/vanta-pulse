import type { CSSProperties } from "react";
import type { ResultsScreenProps } from "../ui-types";
import { Brand } from "../components/Brand";
import { Icon } from "../components/Icons";

const formatScore = (score: number) => new Intl.NumberFormat("en-US").format(score);

export function ResultsScreen({
  result,
  backdropUrl = "/art/backdrops/glass-horizon.webp",
  submittingScore = false,
  actionsDisabled = false,
  submitError = null,
  onRetry,
  onMenu,
  onNextLevel,
  onViewLeaderboard,
}: ResultsScreenProps) {
  const completion = Math.min(100, Math.max(0, result.completion));
  const timingTotal = Math.max(1, result.timing.perfect + result.timing.good + result.timing.late);
  const timingRows = [
    { id: "perfect", label: "Perfect", value: result.timing.perfect, accent: "cyan" },
    { id: "good", label: "Good", value: result.timing.good, accent: "magenta" },
    { id: "late", label: "Late", value: result.timing.late, accent: "lime" },
  ] as const;

  return (
    <main className="vp-results-screen">
      <div aria-hidden="true" className="vp-results-screen__backdrop" style={{ backgroundImage: `url(${backdropUrl})` }} />
      <div aria-hidden="true" className="vp-screen-vignette" />
      <div aria-hidden="true" className="vp-scanlines" />

      <header className="vp-results-header">
        <Brand compact />
        <div>
          <span>Run complete</span>
          <strong>{result.levelName}</strong>
        </div>
      </header>

      <section aria-labelledby="vp-results-title" className="vp-results-card vp-cut-panel">
        <div className="vp-results-hero">
          <div aria-label={`Grade ${result.grade}`} className="vp-grade" data-grade={result.grade.toLowerCase()}>
            <span>{result.grade}</span>
          </div>
          <div className="vp-result-score">
            <p id="vp-results-title">Final score</p>
            <strong>{formatScore(result.score)}</strong>
            {result.isNewBest ? (
              <span className="vp-new-best"><Icon name="spark" size={13} /> New personal best</span>
            ) : (
              <span>Best {formatScore(result.bestScore)}</span>
            )}
          </div>
          <div className="vp-completion-dial" style={{ "--vp-completion": `${completion * 3.6}deg` } as CSSProperties}>
            <div>
              <strong>{Math.round(completion)}%</strong>
              <span>Complete</span>
            </div>
          </div>
        </div>

        <div className="vp-result-grid">
          <section aria-labelledby="vp-timing-title" className="vp-result-panel">
            <header>
              <h2 id="vp-timing-title">Timing analysis</h2>
              <span>{timingTotal} inputs</span>
            </header>
            <div className="vp-timing-list">
              {timingRows.map((row) => (
                <div className="vp-timing-row" data-accent={row.accent} key={row.id}>
                  <div><span>{row.label}</span><strong>{row.value}</strong></div>
                  <span className="vp-timing-rail">
                    <i style={{ width: `${Math.round((row.value / timingTotal) * 100)}%` }} />
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section aria-labelledby="vp-run-data-title" className="vp-result-panel">
            <header><h2 id="vp-run-data-title">Run data</h2><span>Attempt {result.attempts}</span></header>
            <dl className="vp-run-data">
              <div><dt>Prisms</dt><dd><Icon name="prism" size={20} />{result.prisms}</dd></div>
              <div><dt>Peak flow</dt><dd>×{result.multiplier}</dd></div>
              <div>
                <dt>Global rank</dt>
                <dd>
                  {result.leaderboardStatus === "local"
                    ? result.leaderboardRank
                      ? `Local #${formatScore(result.leaderboardRank)}`
                      : "Local only"
                    : result.leaderboardRank
                      ? `#${formatScore(result.leaderboardRank)}`
                      : result.leaderboardStatus === "not-eligible"
                      ? "Finish required"
                      : result.leaderboardStatus === "unchanged"
                          ? "PB unchanged"
                          : "Pending"}
                </dd>
              </div>
            </dl>
          </section>
        </div>

        <div className="vp-score-submit-status" aria-live="polite">
          {submittingScore && <span className="is-loading"><i /> Publishing verified score…</span>}
          {!submittingScore && submitError && <span className="is-error">Score saved locally · {submitError}</span>}
          {!submittingScore && !submitError && result.leaderboardRank && result.leaderboardStatus !== "unchanged" && <span className="is-success">Global signal synchronized at rank #{formatScore(result.leaderboardRank)}</span>}
          {!submittingScore && !submitError && result.leaderboardStatus === "not-eligible" && <span>Finish the signal to enter the global board. This attempt remains saved locally.</span>}
          {!submittingScore && !submitError && result.leaderboardStatus === "unchanged" && <span className="is-success">Verified run · personal best unchanged{result.leaderboardRank ? ` at rank #${formatScore(result.leaderboardRank)}` : ""}.</span>}
        </div>

        <div className="vp-results-actions">
          <button className="vp-secondary-button" disabled={actionsDisabled} onClick={onMenu} type="button">
            <Icon name="menu" size={18} />
            <span>Menu</span>
          </button>
          <button autoFocus className="vp-action-button" disabled={actionsDisabled} onClick={onRetry} type="button">
            <Icon name="retry" size={19} />
            <span>Retry signal</span>
          </button>
          {onNextLevel && (
            <button className="vp-secondary-button" disabled={actionsDisabled} onClick={onNextLevel} type="button">
              <span>Next level</span>
              <Icon name="next" size={18} />
            </button>
          )}
          {onViewLeaderboard && !onNextLevel && (
            <button className="vp-secondary-button" disabled={actionsDisabled} onClick={onViewLeaderboard} type="button">
              <Icon name="leaderboard" size={18} />
              <span>Leaderboard</span>
            </button>
          )}
        </div>
      </section>
    </main>
  );
}
