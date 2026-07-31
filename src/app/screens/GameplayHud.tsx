import { useEffect, useRef, type CSSProperties } from "react";
import type { GameplayHudProps } from "../ui-types";
import { Brand } from "../components/Brand";
import { Icon } from "../components/Icons";

const formatScore = (score: number) => new Intl.NumberFormat("en-US").format(score);

export function GameplayHud({
  levelName,
  score,
  multiplier,
  progress,
  combo,
  paused,
  soundEnabled,
  hasInteracted,
  prisms = 0,
  onPause,
  onToggleSound,
  onJump,
}: GameplayHudProps) {
  const normalizedProgress = Math.min(100, Math.max(0, progress));
  const activeComboSegments = Math.min(12, Math.max(0, Math.ceil(combo / 8.34)));
  const resumeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!paused) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    resumeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onPause();
      } else if (event.key === "Tab") {
        event.preventDefault();
        resumeRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [onPause, paused]);

  return (
    <div className={`vp-game-hud${paused ? " is-paused" : ""}`}>
      <div className="vp-game-hud__top" inert={paused ? true : undefined}>
        <div className="vp-game-hud__brand">
          <Brand compact />
          <span>{levelName}</span>
        </div>
        <div className="vp-progress-cluster">
          <div
            aria-label={`${Math.round(normalizedProgress)} percent complete`}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={Math.round(normalizedProgress)}
            className="vp-progress-rail"
            role="progressbar"
            style={{ "--vp-run-progress": `${normalizedProgress}%` } as CSSProperties}
          >
            <span className="vp-progress-rail__fill" />
            {[0, 25, 50, 75, 100].map((marker) => (
              <i className={normalizedProgress >= marker ? "is-passed" : ""} key={marker} style={{ left: `${marker}%` }} />
            ))}
          </div>
          <strong>{Math.round(normalizedProgress)}%</strong>
        </div>
        <div className="vp-game-hud__controls">
          <button
            aria-label={paused ? "Resume run" : "Pause run"}
            aria-pressed={paused}
            className="vp-hud-button"
            onClick={onPause}
            type="button"
          >
            <Icon name={paused ? "play" : "pause"} size={20} />
          </button>
          <button
            aria-label={soundEnabled ? "Mute audio" : "Enable audio"}
            aria-pressed={!soundEnabled}
            className="vp-hud-button"
            onClick={onToggleSound}
            type="button"
          >
            <Icon name={soundEnabled ? "audio" : "audioOff"} size={21} />
          </button>
        </div>
      </div>

      <div className="vp-game-hud__stats" inert={paused ? true : undefined}>
        <div className="vp-score-block">
          <span>Score</span>
          <strong>{formatScore(score)}</strong>
        </div>
        <div className="vp-flow-block" aria-label={`Flow multiplier times ${multiplier}`}>
          <span>Flow</span>
          <strong><small>×</small>{multiplier}</strong>
          <div aria-hidden="true" className="vp-combo-meter">
            {Array.from({ length: 12 }, (_, index) => (
              <i className={index < activeComboSegments ? "is-active" : ""} key={index} />
            ))}
          </div>
        </div>
        <div className="vp-prism-count">
          <Icon name="prism" size={18} />
          <span>{prisms}</span>
        </div>
      </div>

      {!hasInteracted && !paused && (
        onJump ? (
          <button className="vp-input-hint" inert={paused ? true : undefined} onClick={onJump} type="button">
            <kbd>Space</kbd>
            <span>/</span>
            <strong>Tap to phase</strong>
          </button>
        ) : (
          <div className="vp-input-hint" inert={paused ? true : undefined} role="note">
            <kbd>Space</kbd>
            <span>/</span>
            <strong>Tap to phase</strong>
          </div>
        )
      )}

      {paused && (
        <div className="vp-pause-layer" role="presentation">
          <section aria-label="Run paused" aria-modal="true" className="vp-pause-card vp-cut-panel" role="dialog">
            <span className="vp-pause-card__index">//  PAUSED</span>
            <h2>Signal held</h2>
            <p>Your run is frozen at {Math.round(normalizedProgress)}%. Re-enter when ready.</p>
            <button className="vp-action-button" onClick={onPause} ref={resumeRef} type="button">
              <Icon name="play" size={20} />
              <span>Resume run</span>
            </button>
            <small>Press <kbd>Esc</kbd> to resume</small>
          </section>
        </div>
      )}
    </div>
  );
}
