import clsx from 'clsx';
import type { IngredientCategory } from '../../types';
import { CATEGORY_LABELS } from '../../lib/labels';

/** Píldora de categoría de ingrediente con su emoji. `compact` muestra sólo el emoji (con título accesible). */
export function CategoryBadge({ category, compact, className }: { category: IngredientCategory; compact?: boolean; className?: string }) {
  const c = CATEGORY_LABELS[category] ?? CATEGORY_LABELS.otros;
  if (compact) {
    return (
      <span
        role="img"
        aria-label={c.label}
        title={c.label}
        className={clsx('inline-flex size-8 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-base leading-none', className)}
      >
        {c.emoji}
      </span>
    );
  }
  return (
    <span
      className={clsx(
        'inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-ink-2',
        className,
      )}
      title={c.label}
    >
      <span aria-hidden>{c.emoji}</span>
      <span className="truncate">{c.label}</span>
    </span>
  );
}
