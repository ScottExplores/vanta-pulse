import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import type { TutorialOverlayProps } from "../ui-types";
import { Icon } from "./Icons";

export function TutorialOverlay({
  open,
  steps,
  activeStep,
  onStepChange,
  onComplete,
  onSkip,
}: TutorialOverlayProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const safeIndex = Math.min(Math.max(0, activeStep), Math.max(0, steps.length - 1));
  const step = steps[safeIndex];
  const isLast = safeIndex === steps.length - 1;

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const app = document.querySelector<HTMLElement>(".vp-app");
    const wasInert = app?.hasAttribute("inert") ?? false;
    app?.setAttribute("inert", "");
    const panel = panelRef.current;
    panel?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onSkip();
      }
      if (event.key === "ArrowRight" && !isLast) onStepChange(safeIndex + 1);
      if (event.key === "ArrowLeft" && safeIndex > 0) onStepChange(safeIndex - 1);
      if (event.key === "Tab" && panel) {
        const focusable = Array.from(panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ));
        const first = focusable[0];
        const last = focusable.at(-1);
        if (!first || !last) {
          event.preventDefault();
          panel.focus();
        } else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (!wasInert) app?.removeAttribute("inert");
      previousFocus?.focus();
    };
  }, [isLast, onSkip, onStepChange, open, safeIndex]);

  if (!open || !step) return null;

  return createPortal(
    <div className="vp-tutorial-layer">
      <div aria-hidden="true" className="vp-tutorial-layer__veil" />
      <div aria-labelledby={titleId} aria-modal="true" className="vp-tutorial" ref={panelRef} role="dialog" tabIndex={-1}>
        <div className="vp-tutorial__visual" data-step={safeIndex + 1}>
          <span className="vp-tutorial__orbit" />
          <span className="vp-tutorial__runner" />
          <span className="vp-tutorial__platform" />
        </div>
        <div className="vp-tutorial__content">
          <span className="vp-tutorial__count">Signal lesson {safeIndex + 1}/{steps.length}</span>
          <h2 id={titleId}>{step.title}</h2>
          <p>{step.body}</p>
          {step.keyLabel && <kbd>{step.keyLabel}</kbd>}
          <div className="vp-tutorial__steps" aria-label={`Step ${safeIndex + 1} of ${steps.length}`}>
            {steps.map((item, index) => (
              <button
                aria-label={`Go to ${item.title}`}
                aria-current={index === safeIndex ? "step" : undefined}
                className={index === safeIndex ? "is-active" : ""}
                key={item.id}
                onClick={() => onStepChange(index)}
                type="button"
              />
            ))}
          </div>
          <div className="vp-tutorial__actions">
            <button className="vp-text-button" onClick={onSkip} type="button">Skip tutorial</button>
            <button className="vp-action-button vp-action-button--compact" onClick={isLast ? onComplete : () => onStepChange(safeIndex + 1)} type="button">
              <span>{isLast ? "Enter the lattice" : "Next lesson"}</span>
              <Icon name={isLast ? "play" : "chevron"} size={17} />
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
