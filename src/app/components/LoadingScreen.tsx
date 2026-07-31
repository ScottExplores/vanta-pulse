import type { CSSProperties } from "react";
import type { LoadingScreenProps } from "../ui-types";
import { Brand, EclipseMark } from "./Brand";
import { Icon } from "./Icons";

export function LoadingScreen({
  progress,
  status = "Synchronizing the lattice",
  error = null,
  onRetry,
}: LoadingScreenProps) {
  const normalized = progress === undefined ? undefined : Math.min(1, Math.max(0, progress));
  const style = normalized === undefined
    ? undefined
    : ({ "--vp-loading-progress": `${Math.round(normalized * 100)}%` } as CSSProperties);

  return (
    <main aria-busy={!error} className="vp-loading-screen">
      <div aria-hidden="true" className="vp-loading-screen__grid" />
      <div className="vp-loading-screen__center">
        <EclipseMark className="vp-loading-screen__eclipse" />
        <Brand />
        {error ? (
          <div className="vp-loading-error" role="alert">
            <strong>Signal acquisition failed</strong>
            <p>{error}</p>
            {onRetry && (
              <button className="vp-action-button vp-action-button--compact" onClick={onRetry} type="button">
                <Icon name="refresh" size={18} />
                <span>Reacquire</span>
              </button>
            )}
          </div>
        ) : (
          <div className="vp-loading-status">
            <div
              aria-label={normalized === undefined ? status : `${status}: ${Math.round(normalized * 100)}%`}
              aria-valuemax={100}
              aria-valuemin={0}
              {...(normalized === undefined ? {} : { "aria-valuenow": Math.round(normalized * 100) })}
              className={`vp-loading-rail${normalized === undefined ? " is-indeterminate" : ""}`}
              role="progressbar"
              style={style}
            >
              <span />
            </div>
            <div className="vp-loading-status__copy">
              <span>{status}</span>
              {normalized !== undefined && <strong>{Math.round(normalized * 100)}%</strong>}
            </div>
          </div>
        )}
      </div>
      <p className="vp-loading-screen__footer">Deterministic signal engine · build 1.0</p>
    </main>
  );
}
