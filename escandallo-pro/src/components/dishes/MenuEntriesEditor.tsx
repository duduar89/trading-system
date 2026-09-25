import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import clsx from 'clsx';
import { AlertTriangle, CheckSquare, ExternalLink, Plus, Square, Trash2 } from 'lucide-react';
import type { ID, MenuEntry } from '../../types';
import { Button, IconButton, Input } from '../ui';
import { AmountInput } from '../purchases/AmountInput';
import { SelectBox } from './DishCard';
import { entriesSummary, groupEntries, normalize } from './logic';
import { newMenuEntry } from './menuScanStore';

const FALLBACK = 'Sin sección';

/**
 * Revisión de los platos leídos de la carta, agrupados por sección y editables en línea
 * (selección, nombre, descripción, PVP y sección).
 */
export function MenuEntriesEditor({ entries, onChange, knownSections }: { entries: MenuEntry[]; onChange: (entries: MenuEntry[]) => void; knownSections: string[] }) {
  const listId = useId();
  const groups = useMemo(() => groupEntries(entries, FALLBACK), [entries]);
  const summary = useMemo(() => entriesSummary(entries), [entries]);
  const sections = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of [...entries.map((e) => e.section ?? ''), ...knownSections]) {
      const t = s.trim();
      if (t && !seen.has(normalize(t))) seen.set(normalize(t), t);
    }
    return [...seen.values()];
  }, [entries, knownSections]);
  const nameRefs = useRef(new Map<ID, HTMLInputElement>());
  const [focusId, setFocusId] = useState<ID | null>(null);

  useEffect(() => {
    if (!focusId) return;
    const el = nameRefs.current.get(focusId);
    if (el) {
      el.focus();
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setFocusId(null);
    }
  }, [focusId, entries]);

  const patch = (id: ID, p: Partial<MenuEntry>) => onChange(entries.map((e) => (e.id === id ? { ...e, ...p } : e)));
  const remove = (id: ID) => onChange(entries.filter((e) => e.id !== id));
  const setAll = (selected: boolean, filter?: (e: MenuEntry) => boolean) => onChange(entries.map((e) => (!filter || filter(e) ? { ...e, selected } : e)));
  const addTo = (section?: string) => {
    const e = newMenuEntry(section === FALLBACK ? undefined : section);
    // Se inserta al final de su sección para respetar el orden de la carta.
    const idx = section ? entries.map((x) => normalize(x.section?.trim() || FALLBACK)).lastIndexOf(normalize(section)) : -1;
    const next = [...entries];
    next.splice(idx >= 0 ? idx + 1 : next.length, 0, e);
    onChange(next);
    setFocusId(e.id);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-ink-2">
          <span className="font-display text-lg font-extrabold text-ink">{summary.selected}</span> de {summary.total} platos seleccionados
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="ghost" icon={<CheckSquare className="size-4" />} onClick={() => setAll(true)}>
            Todos
          </Button>
          <Button size="sm" variant="ghost" icon={<Square className="size-4" />} onClick={() => setAll(false)}>
            Ninguno
          </Button>
          <Button size="sm" variant="outline" icon={<Plus className="size-4" />} onClick={() => addTo(groups.at(-1)?.section)}>
            Añadir plato
          </Button>
        </div>
      </div>

      <datalist id={listId}>
        {sections.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      {groups.map((g) => {
        const allOn = g.entries.every((e) => e.selected);
        const inGroup = (e: MenuEntry) => normalize(e.section?.trim() || FALLBACK) === normalize(g.section);
        return (
          <section key={g.section} className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card" aria-label={g.section}>
            <header className="flex items-center gap-1 border-b border-line bg-surface-2 py-1 pl-1.5 pr-2">
              <SelectBox checked={allOn} onChange={() => setAll(!allOn, inGroup)} label={`${allOn ? 'Quitar' : 'Seleccionar'} toda la sección ${g.section}`} />
              <h3 className="min-w-0 flex-1 truncate font-display text-[15px] font-bold text-ink">{g.section}</h3>
              <span className="text-xs font-semibold text-muted">
                {g.entries.filter((e) => e.selected).length}/{g.entries.length}
              </span>
              <IconButton label={`Añadir plato en ${g.section}`} onClick={() => addTo(g.section)}>
                <Plus className="size-4" />
              </IconButton>
            </header>
            <ul className="divide-y divide-line">
              {g.entries.map((e) => (
                <EntryRow
                  key={e.id}
                  entry={e}
                  listId={listId}
                  onPatch={(p) => patch(e.id, p)}
                  onRemove={() => remove(e.id)}
                  nameRef={(el) => {
                    if (el) nameRefs.current.set(e.id, el);
                    else nameRefs.current.delete(e.id);
                  }}
                />
              ))}
            </ul>
          </section>
        );
      })}

      {!entries.length && (
        <div className="rounded-2xl border border-dashed border-line-strong px-6 py-10 text-center">
          <p className="font-display text-lg font-bold text-ink">No hemos encontrado platos en la foto</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted">Prueba con una foto más cercana y con buena luz, o añade los platos a mano.</p>
          <Button className="mt-4" icon={<Plus className="size-4" />} onClick={() => addTo()}>
            Añadir plato
          </Button>
        </div>
      )}
    </div>
  );
}

function EntryRow({
  entry,
  listId,
  onPatch,
  onRemove,
  nameRef,
}: {
  entry: MenuEntry;
  listId: string;
  onPatch: (p: Partial<MenuEntry>) => void;
  onRemove: () => void;
  nameRef: (el: HTMLInputElement | null) => void;
}) {
  const low = entry.confidence != null && entry.confidence < 0.6;
  return (
    <li
      className={clsx(
        'grid grid-cols-[auto_minmax(0,1fr)_6.75rem_auto] items-start gap-x-1 gap-y-1 py-2.5 pl-1.5 pr-2 transition sm:grid-cols-[auto_minmax(0,1fr)_7.5rem_auto] sm:gap-x-1.5',
        !entry.selected && 'opacity-55',
      )}
    >
      <SelectBox
        checked={entry.selected}
        onChange={() => onPatch({ selected: !entry.selected })}
        label={`Importar ${entry.name || 'plato sin nombre'}`}
        className="col-start-1 row-start-1"
      />
      {/* Móvil: nombre a lo ancho y, debajo, descripción/sección junto al precio. Escritorio: precio al lado del nombre. */}
      <div className="col-span-2 col-start-2 row-start-1 min-w-0 sm:col-span-1">
        <Input
          ref={nameRef}
          value={entry.name}
          onChange={(e) => onPatch({ name: e.target.value })}
          placeholder="Nombre del plato"
          aria-label="Nombre del plato"
          className={clsx('font-semibold', !entry.name.trim() && entry.selected && 'border-warn/60')}
        />
      </div>
      <div className="col-start-2 row-start-2 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            value={entry.description ?? ''}
            onChange={(e) => onPatch({ description: e.target.value || undefined })}
            placeholder="Descripción del plato"
            title="La descripción ayuda a proponer una receta más fiel"
            aria-label="Descripción del plato"
            className="h-8 min-w-0 flex-1 basis-40 rounded-lg border border-transparent bg-transparent px-2 text-xs text-ink-2 placeholder:text-muted/70 hover:border-line focus:border-brand-500 focus:outline-none"
          />
          <input
            value={entry.section ?? ''}
            onChange={(e) => onPatch({ section: e.target.value || undefined })}
            list={listId}
            placeholder="Sección"
            aria-label="Sección"
            className="h-8 w-32 rounded-lg border border-line bg-surface-2 px-2 text-[11px] font-semibold text-ink-2 focus:border-brand-500 focus:outline-none"
          />
          {low && (
            <span className="inline-flex items-center gap-1 rounded-full bg-warn-soft px-2 py-0.5 text-[10px] font-bold text-warn" title="La lectura de esta línea es dudosa: compárala con la foto">
              <AlertTriangle className="size-3" /> Revisa
            </span>
          )}
          {entry.dishId && (
            <Link to={`/platos/${entry.dishId}`} className="inline-flex items-center gap-1 rounded-full bg-ok-soft px-2 py-0.5 text-[10px] font-bold text-ok hover:underline">
              Ya importado <ExternalLink className="size-3" />
            </Link>
          )}
        </div>
      </div>
      <div className="col-start-3 row-start-2 sm:row-start-1">
        <AmountInput
          value={entry.price}
          onValue={(v) => onPatch({ price: v != null && v > 0 ? v : undefined })}
          decimals={2}
          minDecimals={2}
          min={0}
          suffix="€"
          placeholder="PVP"
          aria-label={`PVP de ${entry.name || 'plato'}`}
          className={clsx('[&_input]:text-right [&_input]:font-semibold [&_input]:pr-8', !entry.price && entry.selected && '[&_input]:border-warn/60')}
        />
      </div>
      <div className="col-start-4 row-start-1 flex items-start justify-end">
        <IconButton label={`Quitar ${entry.name || 'plato'}`} onClick={onRemove} className="size-10 hover:text-bad">
          <Trash2 className="size-4" />
        </IconButton>
      </div>
    </li>
  );
}
