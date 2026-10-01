export function G3Logo({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden>
        <defs>
          <linearGradient id="g3g" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="oklch(0.85 0.03 70)" />
            <stop offset="100%" stopColor="oklch(0.55 0.02 60)" />
          </linearGradient>
        </defs>
        {Array.from({ length: 22 }).map((_, i) => {
          const a = (i / 22) * Math.PI * 2;
          const x1 = 16 + Math.cos(a) * 5;
          const y1 = 16 + Math.sin(a) * 5;
          const x2 = 16 + Math.cos(a) * 14;
          const y2 = 16 + Math.sin(a) * 14;
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="url(#g3g)" strokeWidth="1" />;
        })}
        <polygon points="16,7 24,22 8,22" fill="none" stroke="oklch(0.78 0.03 70)" strokeWidth="1.6" />
      </svg>
      <span className="text-lg font-semibold tracking-tight text-primary">
        Global<span className="text-warning">3</span>
      </span>
    </div>
  );
}