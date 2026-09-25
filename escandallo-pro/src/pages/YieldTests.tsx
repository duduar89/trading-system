import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { FilePlus2, Link2, Plus, Scale, ShieldCheck, Sparkles, TrendingUp } from 'lucide-react';
import { Button, Card, EmptyState, PageHeader, Stat, cx } from '../components/ui';
import { useProducts, useYieldTests } from '../state/hooks';
import type { YieldTemplate } from '../services/yieldTests';
import { fmtNum, fmtPct } from '../lib/format';
import { YieldFlowDiagram } from '../components/yield/YieldFlowDiagram';
import { TemplateGallery } from '../components/yield/TemplateGallery';
import { CreateYieldTestModal } from '../components/yield/CreateYieldTestModal';
import { YieldTestList, buildYieldRows } from '../components/yield/YieldTestList';

/** Pruebas de rendimiento y despiece: qué rinde de verdad cada pieza y cuánto cuesta su merma. */
export default function YieldTests() {
  const tests = useYieldTests();
  const products = useProducts();
  const [params, setParams] = useSearchParams();
  const [modal, setModal] = useState<{ open: boolean; template?: YieldTemplate | null; productId?: string }>({ open: false });
  const galleryRef = useRef<HTMLDivElement>(null);

  // ?nuevo=1 (acción rápida) abre el alta; &producto=<id> preselecciona el ingrediente.
  useEffect(() => {
    if (params.get('nuevo') !== '1') return;
    const productId = params.get('producto') ?? undefined;
    setModal({ open: true, template: undefined, productId });
    const next = new URLSearchParams(params);
    next.delete('nuevo');
    next.delete('producto');
    setParams(next, { replace: true });
  }, [params, setParams]);

  const rows = useMemo(() => (tests && products ? buildYieldRows(tests, products) : undefined), [tests, products]);

  const kpis = useMemo(() => {
    if (!rows?.length) return undefined;
    const valid = rows.filter((r) => r.result.principalKg > 0 && r.result.grossWeightKg > 0);
    const avgYield = valid.length ? valid.reduce((s, r) => s + r.result.yieldPct, 0) / valid.length : undefined;
    const withFactor = valid.filter((r) => r.factor > 0);
    const avgFactor = withFactor.length ? withFactor.reduce((s, r) => s + r.factor, 0) / withFactor.length : undefined;
    return { count: rows.length, linked: rows.filter((r) => r.linked).length, avgYield, avgFactor };
  }, [rows]);

  const openTemplate = (template: YieldTemplate | null) => setModal({ open: true, template });
  const scrollToGallery = () => galleryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const loading = !rows;

  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="Mermas y rendimientos"
        title="Pruebas de rendimiento"
        subtitle="La merma real de cada pieza, pesada en tu cocina. Es lo que separa un escandallo aproximado de uno exacto."
        actions={
          <>
            <Button variant="outline" icon={<FilePlus2 className="size-4" />} onClick={() => openTemplate(null)} aria-label="Nueva prueba en blanco">
              <span className="sm:hidden">En blanco</span>
              <span className="hidden sm:inline">Nueva prueba en blanco</span>
            </Button>
            <Button icon={<Plus className="size-4" />} onClick={() => setModal({ open: true, template: undefined })}>
              Nueva prueba
            </Button>
          </>
        }
      />

      {/* Hero explicativo */}
      <Card padded={false} className="relative mb-6 overflow-hidden">
        <div className="hero-mesh pointer-events-none absolute inset-0 opacity-70" aria-hidden />
        <div className="relative grid gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center lg:gap-10">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface/80 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-brand-600 backdrop-blur-sm dark:text-brand-400">
              <Scale className="size-3.5" /> Merma por pieza y por plato
            </div>
            <h2 className="mt-3 font-display text-2xl font-extrabold leading-tight text-ink sm:text-[28px]">
              Lo que compras <span className="text-gradient-brand">no es lo que sirves</span>
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
              Pesa la pieza al comprarla y lo que sale al limpiarla: calculamos el rendimiento real, el coste por kilo aprovechable y la merma de cada
              ración. Todos los escandallos que usen ese producto se actualizan solos.
            </p>
            <ul className={cx('mt-4 space-y-1.5 text-sm text-ink-2', rows && rows.length > 0 && 'hidden sm:block')}>
              <li className="flex items-start gap-2">
                <TrendingUp className="mt-0.5 size-4 shrink-0 text-brand-500" /> Descubre cuánto cuesta de verdad el kilo limpio y cada ración.
              </li>
              <li className="flex items-start gap-2">
                <Sparkles className="mt-0.5 size-4 shrink-0 text-brand-500" /> Los subproductos (espinas, recortes, cordón) restan coste: se aprovechan.
              </li>
              <li className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand-500" /> Todo se calcula en tu dispositivo, sin enviar tus datos a nadie.
              </li>
            </ul>
          </div>
          <YieldFlowDiagram />
        </div>
      </Card>

      {/* KPIs */}
      {kpis && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Pruebas" value={fmtNum(kpis.count, 0)} icon={<Scale className="size-4" />} tone="brand" hint="registradas en este local" />
          <Stat
            label="En escandallos"
            value={fmtNum(kpis.linked, 0)}
            icon={<Link2 className="size-4" />}
            tone={kpis.linked > 0 ? 'ok' : 'default'}
            hint={kpis.linked === 1 ? 'producto con rendimiento real' : 'productos con rendimiento real'}
          />
          <Stat label="Rendimiento medio" value={fmtPct(kpis.avgYield, 0)} hint="de la parte aprovechable" />
          <Stat
            label="Sobrecoste medio"
            value={kpis.avgFactor ? `×${fmtNum(kpis.avgFactor, 2)}` : '—'}
            tone={kpis.avgFactor && kpis.avgFactor >= 1.8 ? 'warn' : 'default'}
            hint="€/kg útil frente a compra"
          />
        </div>
      )}

      {/* Listado */}
      <section className="mb-10" aria-labelledby="mis-pruebas">
        <h2 id="mis-pruebas" className="mb-3 font-display text-lg font-bold text-ink sm:text-xl">
          Tus pruebas
        </h2>
        {loading ? (
          <div className="space-y-2.5" aria-busy="true" aria-label="Cargando pruebas">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-[76px] animate-pulse-soft rounded-2xl border border-line bg-surface" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Scale className="size-7" />}
            title="Aún no has pesado ninguna pieza"
            description="Elige una plantilla (salmón, solomillo, pulpo…) y ajusta los pesos con tu báscula. En cinco minutos sabrás cuánto te cuesta de verdad cada ración."
            action={
              <>
                <Button icon={<Sparkles className="size-4" />} onClick={scrollToGallery}>
                  Empezar con una plantilla
                </Button>
                <Button variant="outline" icon={<FilePlus2 className="size-4" />} onClick={() => openTemplate(null)}>
                  Prueba en blanco
                </Button>
              </>
            }
          />
        ) : (
          <YieldTestList rows={rows} />
        )}
      </section>

      {/* Plantillas */}
      <section ref={galleryRef} className="scroll-mt-20" aria-labelledby="plantillas">
        <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="plantillas" className="font-display text-lg font-bold text-ink sm:text-xl">
              Empieza con una plantilla
            </h2>
            <p className="text-sm text-muted">Despieces habituales con porcentajes típicos de cocina profesional. Luego ajustas con tus pesos reales.</p>
          </div>
        </div>
        <TemplateGallery onPick={openTemplate} />
      </section>

      <CreateYieldTestModal
        open={modal.open}
        template={modal.template}
        productId={modal.productId}
        onClose={() => setModal((m) => ({ ...m, open: false }))}
      />
    </div>
  );
}
