interface BrandProps {
  compact?: boolean;
  className?: string;
}

export function Brand({ compact = false, className = "" }: BrandProps) {
  return (
    <span aria-label="Vanta Pulse" className={`vp-brand${compact ? " vp-brand--compact" : ""}${className ? ` ${className}` : ""}`}>
      <span>VANTA</span>
      <span aria-hidden="true" className="vp-brand__slash">//</span>
      <span className="vp-brand__pulse">PULSE</span>
    </span>
  );
}

export function EclipseMark({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`vp-eclipse${className ? ` ${className}` : ""}`}>
      <span className="vp-eclipse__core" />
      <span className="vp-eclipse__ring" />
      <span className="vp-eclipse__flare vp-eclipse__flare--left" />
      <span className="vp-eclipse__flare vp-eclipse__flare--right" />
      <span className="vp-eclipse__particle vp-eclipse__particle--one" />
      <span className="vp-eclipse__particle vp-eclipse__particle--two" />
      <span className="vp-eclipse__particle vp-eclipse__particle--three" />
    </span>
  );
}
