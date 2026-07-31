import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { PixiGameView, PixiViewOptions } from "./PixiGameView";
import type { GameRenderFrame } from "./types";

export type GameCanvasHandle = {
  present: (frame: GameRenderFrame) => void;
  configure: (options: PixiViewOptions) => void;
};

export type GameCanvasProps = {
  className?: string;
  options?: PixiViewOptions;
  onPress?: () => void;
  onRelease?: () => void;
  onReady?: () => void;
  onError?: () => void;
};

export const GameCanvas = forwardRef<GameCanvasHandle, GameCanvasProps>(function GameCanvas(
  { className, options, onPress, onRelease, onReady, onError },
  forwardedRef,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<PixiGameView | null>(null);
  const pendingFrameRef = useRef<GameRenderFrame | null>(null);
  const pendingOptionsRef = useRef<PixiViewOptions | undefined>(options);
  const [rendererError, setRendererError] = useState(false);
  const [safeModeAttempt, setSafeModeAttempt] = useState(0);

  useImperativeHandle(
    forwardedRef,
    () => ({
      present(frame) {
        pendingFrameRef.current = frame;
        viewRef.current?.present(frame);
      },
      configure(nextOptions) {
        pendingOptionsRef.current = { ...pendingOptionsRef.current, ...nextOptions };
        viewRef.current?.configure(nextOptions);
      },
    }),
    [],
  );

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    let view: PixiGameView | null = null;
    let cancelled = false;
    setRendererError(false);
    const initOptions = safeModeAttempt > 0
      ? { ...pendingOptionsRef.current, quality: "low" as const, reducedMotion: true }
      : pendingOptionsRef.current;
    void import("./PixiGameView")
      .then(({ PixiGameView: View }) => {
        if (cancelled) return null;
        view = new View(host, canvas);
        viewRef.current = view;
        return view.init(initOptions);
      })
      .then(() => {
        if (cancelled || !view) return;
        if (pendingFrameRef.current) view.present(pendingFrameRef.current);
        onReady?.();
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          const failedView = view;
          view = null;
          if (viewRef.current === failedView) viewRef.current = null;
          if (failedView) {
            void failedView.destroy().catch((destroyError: unknown) => {
              console.error("VANTA//PULSE failed renderer cleanup", destroyError);
            });
          }
          setRendererError(true);
          onError?.();
          console.error("VANTA//PULSE renderer initialization failed", error);
        }
      });
    return () => {
      cancelled = true;
      viewRef.current = null;
      if (view) void view.destroy();
    };
  }, [onError, onReady, safeModeAttempt]);

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    onPress?.();
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    event.preventDefault();
    onRelease?.();
  };

  return (
    <div ref={hostRef} className={className ?? "game-canvas"} data-game-canvas>
      <canvas
        ref={canvasRef}
        aria-label="VANTA//PULSE game field. Press or hold to jump."
        role="application"
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onContextMenu={(event) => event.preventDefault()}
      />
      {rendererError && (
        <div className="vp-renderer-fallback" role="alert">
          <strong>Visual signal interrupted</strong>
          <span>Your run is paused. Retry with lightweight effects.</span>
          <button onClick={() => setSafeModeAttempt((attempt) => attempt + 1)} type="button">
            Retry in safe mode
          </button>
        </div>
      )}
    </div>
  );
});
