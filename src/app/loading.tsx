export default function Loading() {
  return (
    <div className="fc-premium-overlay" role="status" aria-live="polite" aria-label="Carregando">
      <div className="ball-stage">
        <div className="premium-ball">
          <div className="ball-texture" />
          <div className="ball-shimmer" />
        </div>
        <div className="dynamic-shadow" />
      </div>
    </div>
  );
}
