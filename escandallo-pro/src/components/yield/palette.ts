import type { CSSProperties } from 'react';
import type { CascadeStep, SegmentKey } from './model';

/**
 * Colores de los gráficos de merma, derivados de los tokens semánticos del tema.
 * Validados (script de dataviz) en claro y oscuro: separación suficiente para daltonismo entre tramos contiguos.
 * En oscuro se oscurecen "aprovechable" y "descongelación" para no deslumbrar sobre la superficie.
 * El tramo "no registrado" es gris con textura (es la clase "sin medir"), así nunca depende sólo del color.
 * Se aplican como variables CSS en el contenedor: añade YIELD_VIZ_VARS a su className.
 */
export const YIELD_VIZ_VARS = [
  '[--yv-principal:var(--color-ok)]',
  'dark:[--yv-principal:color-mix(in_oklab,var(--color-ok)_85%,black)]',
  '[--yv-subproducto:var(--color-info)]',
  '[--yv-desperdicio:var(--color-bad)]',
  '[--yv-none:color-mix(in_oklab,var(--color-muted)_62%,var(--color-surface))]',
  'dark:[--yv-none:var(--color-muted)]',
  '[--yv-thaw:var(--color-warn)]',
  'dark:[--yv-thaw:color-mix(in_oklab,var(--color-warn)_90%,black)]',
  '[--yv-coccion:var(--color-brand-400)]',
  '[--yv-bruto:var(--color-ink-2)]',
].join(' ');

const VAR: Record<SegmentKey | CascadeStep['tone'], string> = {
  principal: 'var(--yv-principal)',
  subproducto: 'var(--yv-subproducto)',
  desperdicio: 'var(--yv-desperdicio)',
  noRegistrado: 'var(--yv-none)',
  descongelacion: 'var(--yv-thaw)',
  coccion: 'var(--yv-coccion)',
  bruto: 'var(--yv-bruto)',
  sobrante: 'var(--yv-none)',
};

/** Estilo de relleno de un tramo (con textura diagonal para lo no registrado / sobrante). */
export function fillStyle(key: SegmentKey | CascadeStep['tone']): CSSProperties {
  const color = VAR[key];
  if (key === 'noRegistrado' || key === 'sobrante') {
    return {
      backgroundColor: color,
      backgroundImage: `repeating-linear-gradient(135deg, transparent 0 5px, color-mix(in oklab, var(--color-surface) 45%, transparent) 5px 7px)`,
    };
  }
  return { backgroundColor: color };
}

/** Tramos con relleno saturado sobre los que el texto blanco es legible en ambos temas. */
export function whiteTextFits(key: SegmentKey | CascadeStep['tone']): boolean {
  return key === 'principal' || key === 'subproducto' || key === 'desperdicio';
}
