import clsx from 'clsx';
import { Camera, Check, ScanLine, Sparkles } from 'lucide-react';

/**
 * Ilustraciones de la bienvenida en CSS/SVG puro (sin imágenes): factura leyéndose, móvil fotografiando la carta
 * y ficha de escandallo. Las animaciones solo se activan si el usuario no ha pedido reducir el movimiento.
 */

export const WELCOME_MOCK_CSS = `
@media (prefers-reduced-motion: no-preference) {
  .ep-w-scan { animation: ep-w-scan 3.2s cubic-bezier(.45,.05,.55,.95) infinite; }
  .ep-w-row { animation: ep-w-row 3.2s ease-out infinite; }
  .ep-w-float { animation: ep-w-float 6s ease-in-out infinite; }
  .ep-w-float-slow { animation: ep-w-float 8s ease-in-out infinite reverse; }
  .ep-w-flash { animation: ep-w-flash 4s ease-out infinite; }
  .ep-w-pop { animation: ep-w-pop 4s ease-out infinite; }
  .ep-w-grow { animation: ep-w-grow 1.2s cubic-bezier(.2,.8,.2,1) both; }
}
@keyframes ep-w-scan { 0% { top: 8%; opacity: 0; } 10% { opacity: 1; } 85% { opacity: 1; } 100% { top: 92%; opacity: 0; } }
@keyframes ep-w-row { 0%, 15% { background-color: transparent; } 30%, 80% { background-color: color-mix(in oklab, #10b981 12%, transparent); } 100% { background-color: transparent; } }
@keyframes ep-w-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
@keyframes ep-w-flash { 0%, 62% { opacity: 0; } 66% { opacity: .85; } 76%, 100% { opacity: 0; } }
@keyframes ep-w-pop { 0%, 66% { transform: scale(.6); opacity: 0; } 74% { transform: scale(1.06); opacity: 1; } 80%, 96% { transform: scale(1); opacity: 1; } 100% { opacity: 0; } }
@keyframes ep-w-grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
`;

const INVOICE_LINES = [
  { name: 'Tomate pera cat. I', qty: '5 kg', price: '1,85', total: '9,25' },
  { name: 'Solomillo de ternera', qty: '3,2 kg', price: '24,90', total: '79,68' },
  { name: 'AOVE garrafa 5 L', qty: '2 ud', price: '38,50', total: '77,00' },
  { name: 'Patata agria saco', qty: '10 kg', price: '0,95', total: '9,50' },
  { name: 'Nata 35 % MG 1 L', qty: '6 ud', price: '3,10', total: '18,60' },
];

/** Factura de proveedor con sus líneas "leyéndose". */
export function InvoiceMock({ className, compact }: { className?: string; compact?: boolean }) {
  const lines = compact ? INVOICE_LINES.slice(0, 4) : INVOICE_LINES;
  return (
    <div className={clsx('relative overflow-hidden rounded-2xl border border-line bg-surface p-4 shadow-pop', className)} aria-hidden>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">Factura</div>
          <div className="font-display text-sm font-bold text-ink">Distribuciones Norte S.L.</div>
          <div className="text-[10px] text-muted">Nº F-2026/0918 · 18 sep 2026</div>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-ok-soft px-2 py-0.5 text-[10px] font-bold text-ok">
          <Check className="size-3" /> Cuadra
        </span>
      </div>
      <div className="mt-3 grid grid-cols-[1fr_auto_auto] gap-x-3 border-b border-line pb-1 text-[9px] font-bold uppercase tracking-wide text-muted">
        <span>Descripción</span>
        <span className="text-right">Cant.</span>
        <span className="text-right">Importe</span>
      </div>
      <div className="relative mt-1 space-y-0.5">
        {lines.map((l, i) => (
          <div
            key={l.name}
            className="ep-w-row grid grid-cols-[1fr_auto_auto] items-center gap-x-3 rounded-md px-1 py-1 text-[11px]"
            style={{ animationDelay: `${0.35 + i * 0.42}s` }}
          >
            <span className="truncate font-medium text-ink-2">{l.name}</span>
            <span className="tabular text-right text-muted">{l.qty}</span>
            <span className="tabular text-right font-semibold text-ink">{l.total} €</span>
          </div>
        ))}
        <div className="ep-w-scan pointer-events-none absolute inset-x-0 top-1/2 h-8 -translate-y-1/2">
          <div className="h-full bg-gradient-to-b from-transparent via-brand-500/15 to-transparent" />
          <div className="absolute inset-x-0 top-1/2 h-px bg-brand-500 shadow-[0_0_12px_2px_rgb(255_90_31/0.55)]" />
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-line pt-2 text-[11px]">
        <span className="inline-flex items-center gap-1 font-semibold text-muted">
          <ScanLine className="size-3.5 text-brand-500" /> Leída en tu dispositivo
        </span>
        <span className="tabular font-display text-sm font-extrabold text-ink">{compact ? '175,43' : '194,03'} €</span>
      </div>
    </div>
  );
}

const MENU_ITEMS = [
  { name: 'Croquetas de jamón', price: '9,50' },
  { name: 'Pulpo a la brasa', price: '18,90' },
  { name: 'Solomillo al PX', price: '28,50' },
  { name: 'Tarta de queso', price: '6,50' },
];

/** Móvil fotografiando la carta. */
export function PhoneMenuMock({ className }: { className?: string }) {
  return (
    <div className={clsx('relative mx-auto w-[210px]', className)} aria-hidden>
      <div className="relative rounded-[2.1rem] border-[5px] border-ink bg-ink p-1 shadow-pop">
        <div className="absolute left-1/2 top-1.5 z-10 h-4 w-16 -translate-x-1/2 rounded-full bg-ink" />
        <div className="relative overflow-hidden rounded-[1.6rem] bg-[#f6efe4] px-4 pb-14 pt-8 text-[#3b2a1a]">
          <div className="text-center font-display text-[13px] font-extrabold tracking-[0.3em]">CARTA</div>
          <div className="mx-auto mt-1 h-px w-10 bg-[#3b2a1a]/40" />
          <div className="mt-3 space-y-2">
            {MENU_ITEMS.map((m) => (
              <div key={m.name} className="flex items-baseline gap-1 text-[10.5px]">
                <span className="font-semibold">{m.name}</span>
                <span className="mb-0.5 min-w-3 flex-1 border-b border-dotted border-[#3b2a1a]/40" />
                <span className="tabular font-bold">{m.price}</span>
              </div>
            ))}
          </div>
          {/* Visor de la cámara */}
          <div className="pointer-events-none absolute inset-x-2.5 bottom-12 top-6">
            {[
              'left-0 top-0 border-l-2 border-t-2 rounded-tl-lg',
              'right-0 top-0 border-r-2 border-t-2 rounded-tr-lg',
              'bottom-0 left-0 border-b-2 border-l-2 rounded-bl-lg',
              'bottom-0 right-0 border-b-2 border-r-2 rounded-br-lg',
            ].map((c) => (
              <span key={c} className={clsx('absolute size-5 border-brand-500', c)} />
            ))}
          </div>
          <div className="ep-w-flash pointer-events-none absolute inset-0 bg-white opacity-0" />
          <div className="absolute inset-x-0 bottom-2.5 flex justify-center">
            <span className="flex size-9 items-center justify-center rounded-full border-[3px] border-white bg-brand-500 shadow-glow">
              <Camera className="size-4 text-white" />
            </span>
          </div>
        </div>
      </div>
      <div className="ep-w-pop absolute -right-6 top-16 flex items-center gap-1.5 rounded-full border border-line bg-elevated px-2.5 py-1 text-[11px] font-bold text-ink shadow-pop">
        <span className="flex size-4 items-center justify-center rounded-full bg-ok text-white">
          <Check className="size-3" />
        </span>
        12 platos detectados
      </div>
    </div>
  );
}

const ESC_LINES = [
  { name: 'Solomillo de ternera', qty: '220 g', cost: '5,48', share: 78 },
  { name: 'Reducción de PX', qty: '40 ml', cost: '0,62', share: 9 },
  { name: 'Patata confitada', qty: '150 g', cost: '0,48', share: 7 },
  { name: 'Guarnición y sal', qty: '—', cost: '0,41', share: 6 },
];

/** Ficha de escandallo con el food cost en verde. */
export function EscandalloMock({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <div className={clsx('relative overflow-hidden rounded-2xl border border-line bg-surface p-4 shadow-pop', className)} aria-hidden>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-500">Escandallo</div>
          <div className="truncate font-display text-[15px] font-bold text-ink">Solomillo al Pedro Ximénez</div>
          <div className="text-[10px] text-muted">PVP carta 28,50 € · 1 ración</div>
        </div>
        <div className="shrink-0 rounded-xl bg-ok px-2.5 py-1.5 text-center text-white shadow-[0_10px_30px_-10px_rgb(16_185_129/0.9)]">
          <div className="tabular font-display text-[26px] font-extrabold leading-none">27 %</div>
          <div className="mt-0.5 text-[9px] font-bold uppercase tracking-wide text-white/85">Food cost</div>
        </div>
      </div>
      {!compact && (
        <div className="mt-3 space-y-1.5">
          {ESC_LINES.map((l, i) => (
            <div key={l.name} className="text-[11px]">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium text-ink-2">{l.name}</span>
                <span className="tabular shrink-0 text-muted">
                  {l.qty} · <span className="font-semibold text-ink">{l.cost} €</span>
                </span>
              </div>
              <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-line/70">
                <div
                  className="ep-w-grow h-full origin-left rounded-r-[4px] bg-brand-500"
                  style={{ width: `${l.share}%`, animationDelay: `${0.2 + i * 0.12}s` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3">
        {[
          { label: 'Coste', value: '6,99 €' },
          { label: 'Margen', value: '18,92 €' },
          { label: 'Merma', value: '18 %' },
        ].map((k) => (
          <div key={k.label}>
            <div className="text-[9px] font-bold uppercase tracking-wide text-muted">{k.label}</div>
            <div className="tabular font-display text-sm font-extrabold text-ink">{k.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Composición del hero: factura detrás, escandallo delante y chip de "gratis". */
export function HeroVisual({ className }: { className?: string }) {
  return (
    <div className={clsx('relative mx-auto w-full max-w-[460px] pb-12', className)} aria-hidden>
      <div className="ep-w-float-slow relative w-[78%] -rotate-3">
        <InvoiceMock />
      </div>
      <div className="ep-w-float relative -mt-24 ml-auto w-[80%] rotate-2 sm:-mt-28">
        <EscandalloMock />
      </div>
      <div className="absolute bottom-0 left-0 flex items-center gap-2 rounded-2xl border border-line bg-elevated px-3 py-2 shadow-pop sm:-left-4">
        <span className="flex size-8 items-center justify-center rounded-xl bg-brand-500/12 text-brand-500">
          <Sparkles className="size-4" />
        </span>
        <div className="leading-tight">
          <div className="text-xs font-bold text-ink">0 € · sin cuotas</div>
          <div className="text-[10px] text-muted">Todo en tu dispositivo</div>
        </div>
      </div>
    </div>
  );
}
