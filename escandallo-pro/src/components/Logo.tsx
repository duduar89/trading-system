import clsx from 'clsx';

/** Marca de Escandallo Pro: plato + gráfico ascendente. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={clsx('shrink-0', className)} aria-hidden="true">
      <defs>
        <linearGradient id="ep-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff7a3d" />
          <stop offset="1" stopColor="#ed3f0b" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#ep-g)" />
      <circle cx="32" cy="34" r="17" fill="none" stroke="#fff" strokeOpacity="0.35" strokeWidth="3" />
      <path d="M20 40 L28 32 L34 37 L45 24" fill="none" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="45" cy="24" r="3.6" fill="#fff" />
    </svg>
  );
}

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark className={compact ? 'size-8' : 'size-9'} />
      <div className="leading-none">
        <div className={clsx('font-display font-extrabold tracking-tight text-ink', compact ? 'text-[17px]' : 'text-lg')}>
          Escandallo<span className="text-brand-500">Pro</span>
        </div>
        {!compact && <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">Food cost inteligente</div>}
      </div>
    </div>
  );
}
