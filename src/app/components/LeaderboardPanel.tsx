import type { LeaderboardPanelProps } from "../ui-types";
import { Icon, VerifiedBadge } from "./Icons";

const formatScore = (score: number) => new Intl.NumberFormat("en-US").format(score);

export function LeaderboardPanel({
  entries,
  playerBest,
  loading = false,
  error = null,
  onRefresh,
}: LeaderboardPanelProps) {
  return (
    <div className="vp-leaderboard-panel">
      <div className="vp-leaderboard-toolbar">
        <span className="vp-leaderboard-scope">All-time personal bests · current signal</span>
        {onRefresh && (
          <button aria-label="Refresh leaderboard" className="vp-icon-button" disabled={loading} onClick={onRefresh} type="button">
            <Icon className={loading ? "is-spinning" : ""} name="refresh" size={18} />
          </button>
        )}
      </div>

      {error ? (
        <div className="vp-inline-error" role="alert">
          <span>Signal interrupted</span>
          <p>{error}</p>
          {onRefresh && <button className="vp-text-button" onClick={onRefresh} type="button">Reconnect</button>}
        </div>
      ) : (
        <div aria-busy={loading} className="vp-leaderboard-table-wrap">
          <table className="vp-leaderboard-table">
            <caption className="vp-sr-only">Global VANTA PULSE high scores</caption>
            <thead>
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Runner</th>
                <th scope="col">Score</th>
              </tr>
            </thead>
            <tbody>
              {loading && entries.length === 0 ? Array.from({ length: 8 }, (_, index) => (
                <tr className="vp-score-row vp-score-row--skeleton" key={index}>
                  <td><span /></td>
                  <td><span /></td>
                  <td><span /></td>
                </tr>
              )) : entries.map((entry) => (
                <tr className={`vp-score-row${entry.isCurrentPlayer ? " is-player" : ""}`} key={entry.playerId ?? `${entry.rank}-${entry.name}`}>
                  <td><span className="vp-score-rank">{String(entry.rank).padStart(2, "0")}</span></td>
                  <td>
                    <span className="vp-score-name">{entry.name}</span>
                    {entry.verified && <VerifiedBadge />}
                    {entry.isCurrentPlayer && <span className="vp-you-label">You</span>}
                  </td>
                  <td><span className="vp-score-value">{formatScore(entry.score)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && entries.length === 0 && <p className="vp-empty-state">No completed runs on this signal. Become the first.</p>}
        </div>
      )}

      <div className="vp-player-best-bar">
        <span>Your best</span>
        <strong>{formatScore(playerBest)}</strong>
      </div>
    </div>
  );
}
