import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import type { ModalShellProps } from "../ui-types";
import { Icon } from "./Icons";

const FOCUSABLE = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function ModalShell({
  title,
  eyebrow,
  children,
  open,
  size = "standard",
  footer,
  onClose,
}: ModalShellProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const app = document.querySelector<HTMLElement>(".vp-app");
    const wasInert = app?.hasAttribute("inert") ?? false;
    app?.setAttribute("inert", "");
    document.body.style.overflow = "hidden";

    const panel = panelRef.current;
    const firstFocusable = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (firstFocusable ?? panel)?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab" || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (!wasInert) app?.removeAttribute("inert");
      previousFocus?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;

  return createPortal(
    <div className="vp-modal-layer" role="presentation">
      <button
        aria-label="Close dialog"
        className="vp-modal-backdrop"
        onClick={onClose}
        type="button"
      />
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className={`vp-modal vp-modal--${size}`}
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <span aria-hidden="true" className="vp-modal__edge vp-modal__edge--top" />
        <span aria-hidden="true" className="vp-modal__edge vp-modal__edge--bottom" />
        <header className="vp-modal__header">
          <div>
            {eyebrow && <p className="vp-modal__eyebrow">{eyebrow}</p>}
            <h2 className="vp-modal__title" id={titleId}>{title}</h2>
          </div>
          <button aria-label="Close" className="vp-icon-button vp-modal__close" onClick={onClose} type="button">
            <Icon name="close" size={19} />
          </button>
        </header>
        <div className="vp-modal__body">{children}</div>
        {footer && <footer className="vp-modal__footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
