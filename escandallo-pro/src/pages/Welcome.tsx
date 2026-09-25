import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  FileSpreadsheet,
  FileText,
  Link2,
  Lock,
  PlayCircle,
  Scale,
  ScanText,
  Store,
  Wheat,
  WifiOff,
} from 'lucide-react';
import { createWorkspace, updateAppSettings } from '../db';
import { useUI, toast, errorMessage } from '../state/store';
import { switchWorkspace } from '../components/WorkspaceSwitcher';
import { Logo } from '../components/Logo';
import { Button, Card, Field, Input, Select, cx } from '../components/ui';
import { EscandalloMock, HeroVisual, InvoiceMock, PhoneMenuMock, WELCOME_MOCK_CSS } from '../components/home/WelcomeMocks';
import { RestoreBackupButton } from '../components/home/backup';
import { useDemoLoader } from '../components/home/shared';

const BUSINESS_TYPES = ['Restaurante', 'Bar de tapas', 'Cafetería', 'Gastrobar', 'Catering', 'Hotel', 'Grupo de restauración', 'Cliente de consultoría'];
const COLORS = ['#ff5a1f', '#8b5cf6', '#10b981', '#3b82f6', '#f43f5e', '#f59e0b', '#0ea5e9', '#14b8a6'];

const FEATURES: { icon: ReactNode; title: string; text: string; highlight?: boolean }[] = [
  {
    icon: <ScanText className="size-5" />,
    title: 'Facturas y cartas, gratis',
    text: 'PDF, foto o Excel. Se leen en tu dispositivo con OCR avanzado y comprobación de importes línea a línea. IA opcional para los casos más difíciles.',
    highlight: true,
  },
  {
    icon: <Link2 className="size-5" />,
    title: 'Cotejo automático',
    text: 'Cada línea de factura se vincula a su ingrediente y aprende tus nombres: «TOM. PERA CAT I» es tu tomate pera.',
  },
  {
    icon: <Scale className="size-5" />,
    title: 'Mermas por pieza y por plato',
    text: 'Pruebas de rendimiento con subproductos: coste real por kilo aprovechable y lo que se pierde en euros en cada ración.',
  },
  {
    icon: <Wheat className="size-5" />,
    title: 'Alérgenos automáticos',
    text: 'Los 14 alérgenos obligatorios pasan de ingredientes y elaboraciones a cada plato, siempre al día.',
  },
  {
    icon: <Building2 className="size-5" />,
    title: 'Multi-restaurante',
    text: 'Para consultoras, agencias y grupos: cada cliente con sus datos separados y cambio en un toque.',
  },
  {
    icon: <WifiOff className="size-5" />,
    title: 'Funciona sin conexión',
    text: 'Instálala como app en el móvil, la tablet o el ordenador. En cocina, en el almacén o de visita.',
  },
  {
    icon: <FileSpreadsheet className="size-5" />,
    title: 'Excel y fichas técnicas',
    text: 'Exporta tus escandallos a Excel e imprime fichas técnicas listas para la cocina.',
  },
  {
    icon: <Lock className="size-5" />,
    title: 'Tus datos, solo tuyos',
    text: 'No salen de tu dispositivo: sin cuentas, sin servidores y sin cuotas. Copias de seguridad cuando quieras.',
  },
];

const STEPS = [
  {
    n: 1,
    title: 'Sube tus facturas',
    text: 'Arrastra el PDF o haz una foto. Leemos proveedor, productos, cantidades y precios, y comprobamos que las cuentas cuadran.',
    visual: <InvoiceMock compact className="w-full" />,
  },
  {
    n: 2,
    title: 'Haz una foto a la carta',
    text: 'Detectamos cada plato con su precio y te proponemos la receta con ingredientes, gramajes y mermas.',
    visual: <PhoneMenuMock className="scale-[0.92]" />,
  },
  {
    n: 3,
    title: 'Obtén tu escandallo',
    text: 'Food cost, margen, precio recomendado y merma de cada plato, actualizados solos con cada nueva factura.',
    visual: <EscandalloMock compact className="w-full" />,
  },
];

function CreateWorkspaceForm({ onCancel }: { onCancel: () => void }) {
  const [name, setName] = useState('');
  const [businessType, setBusinessType] = useState(BUSINESS_TYPES[0]!);
  const [city, setCity] = useState('');
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const navigate = useNavigate();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const ws = await createWorkspace({
        name: name.trim(),
        businessType: businessType || undefined,
        city: city.trim() || undefined,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
      });
      await updateAppSettings({ onboardingDone: true });
      await switchWorkspace(ws.id);
      navigate('/');
      toast.success(`¡Bienvenido a «${ws.name}»!`, 'Empieza subiendo una factura o fotografiando tu carta.');
    } catch (err) {
      toast.error('No se pudo crear el restaurante', errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Card className="animate-slide-up border-line-strong shadow-pop">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold text-ink">Tu restaurante</h2>
            <p className="text-sm text-muted">Solo el nombre es obligatorio. Podrás cambiarlo en Ajustes.</p>
          </div>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-500/10 text-brand-500">
            <Store className="size-5" />
          </span>
        </div>
        <Field label="Nombre del restaurante o cliente" error={touched && !name.trim() ? 'Escribe un nombre para continuar' : undefined}>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej.: Taberna La Lonja" maxLength={80} autoComplete="organization" className="h-12 text-base" />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Tipo de negocio">
            <Select value={businessType} onChange={(e) => setBusinessType(e.target.value)} className="h-12 text-base sm:text-sm">
              {BUSINESS_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Ciudad (opcional)">
            <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Ej.: Valencia" maxLength={60} autoComplete="address-level2" className="h-12 text-base sm:text-sm" />
          </Field>
        </div>
        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button variant="ghost" size="lg" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" size="lg" loading={busy} iconRight={<ArrowRight className="size-4" />}>
            Crear y empezar
          </Button>
        </div>
      </form>
    </Card>
  );
}

export default function Welcome() {
  const hasWorkspace = useUI((s) => !!s.workspaceId);
  const [loadDemo, demoLoading] = useDemoLoader();
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const formRef = useRef<HTMLDivElement>(null);

  const openCreate = () => {
    setCreating(true);
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  };

  const ctaCls = 'h-auto! min-h-14 w-full whitespace-normal! px-5! py-3 text-center leading-tight sm:w-auto sm:px-7!';
  const ctas = (where: 'hero' | 'footer') => (
    <div className={cx('flex flex-col gap-3 sm:flex-row', where === 'footer' && 'sm:justify-center')}>
      <Button size="xl" onClick={loadDemo} loading={demoLoading} icon={<PlayCircle className="size-5 shrink-0" />} className={ctaCls}>
        Probar con un restaurante de ejemplo
      </Button>
      <Button size="xl" variant="outline" onClick={openCreate} iconRight={<ArrowRight className="size-5 shrink-0" />} className={ctaCls}>
        Empezar con mi restaurante
      </Button>
    </div>
  );

  return (
    <div className={cx('relative', !hasWorkspace && 'min-h-dvh bg-bg')}>
      <style>{WELCOME_MOCK_CSS}</style>

      {/* Barra superior */}
      {hasWorkspace ? (
        <div className="mb-4 flex items-center justify-between gap-3">
          <Button variant="outline" icon={<ArrowLeft className="size-4" />} onClick={() => navigate('/')}>
            Volver al panel
          </Button>
          <span className="hidden text-xs font-semibold text-muted sm:block">Presentación de Escandallo Pro</span>
        </div>
      ) : (
        <header className="pt-safe relative z-10 mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <Logo />
          <RestoreBackupButton variant="ghost" size="sm" label="Restaurar copia" />
        </header>
      )}

      {/* Hero */}
      <section className={cx('relative overflow-hidden', hasWorkspace ? 'rounded-3xl border border-line bg-surface' : '')}>
        <div className="hero-mesh pointer-events-none absolute inset-0 opacity-90" aria-hidden />
        <div className={cx('relative mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] items-center gap-10 px-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-8', hasWorkspace ? 'py-10 sm:px-8 lg:py-14' : 'pb-14 pt-6 sm:px-6 lg:pb-20 lg:pt-12')}>
          <div className="animate-slide-up">
            <div className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-full border border-line bg-surface/80 px-3 py-1.5 text-xs font-semibold text-ink-2 shadow-card backdrop-blur">
              <span className="flex size-4 items-center justify-center rounded-full bg-ok text-white">
                <Check className="size-3" />
              </span>
              Gratis · En tu dispositivo · Sin enviar tus datos a nadie
            </div>
            <h1 className="mt-5 font-display text-[40px] font-extrabold leading-[1.02] text-ink sm:text-6xl lg:text-[64px]">
              Tu food cost, bajo control. <span className="text-gradient-brand">En minutos.</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-2 sm:text-lg">
              Sube tus facturas, haz una foto a la carta y obtén el <strong className="font-semibold text-ink">escandallo</strong>, el{' '}
              <strong className="font-semibold text-ink">food cost</strong> y la <strong className="font-semibold text-ink">merma</strong> de cada plato. Sin teclear
              precios ni pelearte con hojas de cálculo.
            </p>
            <div className="mt-7">{ctas('hero')}</div>
            <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-2">
              {['Sin registro', 'Sin tarjeta ni cuotas', 'Funciona sin conexión'].map((t) => (
                <li key={t} className="flex items-center gap-1.5">
                  <Check className="size-4 text-ok" aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <HeroVisual className="lg:ml-auto" />
        </div>
      </section>

      {creating && (
        <div ref={formRef} className="relative z-10 mx-auto -mt-6 max-w-2xl px-4 sm:px-6">
          <CreateWorkspaceForm onCancel={() => setCreating(false)} />
        </div>
      )}

      {/* Cómo funciona */}
      <section className={cx('mx-auto max-w-6xl', hasWorkspace ? 'py-12' : 'px-4 py-16 sm:px-6')} aria-labelledby="como-funciona">
        <div className="mx-auto max-w-2xl text-center">
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-brand-500">Cómo funciona</div>
          <h2 id="como-funciona" className="mt-2 font-display text-3xl font-extrabold text-ink sm:text-4xl">
            Tres pasos. Cero hojas de cálculo.
          </h2>
          <p className="mt-3 text-muted">Lo que antes llevaba días de teclear precios ahora está listo antes del servicio.</p>
        </div>
        <ol className="mt-10 grid gap-5 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.n} className="relative">
              <Card className="flex h-full flex-col overflow-hidden" padded={false}>
                <div className="relative flex h-[260px] items-center justify-center overflow-hidden border-b border-line bg-surface-2 px-6">
                  <div className="hero-mesh pointer-events-none absolute inset-0 opacity-40" aria-hidden />
                  <div className="relative w-full max-w-[290px]">{s.visual}</div>
                </div>
                <div className="p-5">
                  <div className="flex items-center gap-3">
                    <span className="flex size-8 items-center justify-center rounded-full bg-brand-500 font-display text-sm font-extrabold text-white shadow-glow">{s.n}</span>
                    <h3 className="font-display text-lg font-bold text-ink">{s.title}</h3>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{s.text}</p>
                </div>
              </Card>
              {i < STEPS.length - 1 && (
                <span className="absolute -right-4 top-[130px] z-10 hidden size-8 items-center justify-center rounded-full border border-line bg-elevated text-brand-500 shadow-card md:flex" aria-hidden>
                  <ArrowRight className="size-4" />
                </span>
              )}
            </li>
          ))}
        </ol>
      </section>

      {/* Funcionalidades */}
      <section className={cx('mx-auto max-w-6xl', hasWorkspace ? 'pb-12' : 'px-4 pb-16 sm:px-6')} aria-labelledby="funciones">
        <div className="mx-auto max-w-2xl text-center">
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-brand-500">Todo incluido</div>
          <h2 id="funciones" className="mt-2 font-display text-3xl font-extrabold text-ink sm:text-4xl">
            Pensado para cocinas de verdad
          </h2>
          <p className="mt-3 text-muted">Para restaurantes independientes, grupos y consultoras de hostelería que gestionan varios clientes.</p>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <Card key={f.title} className={cx('relative overflow-hidden transition hover:-translate-y-0.5 hover:shadow-pop', f.highlight && 'border-brand-500/40')}>
              {f.highlight && <div className="hero-mesh pointer-events-none absolute inset-0 opacity-50" aria-hidden />}
              <div className="relative">
                <div className={cx('flex size-10 items-center justify-center rounded-xl', f.highlight ? 'bg-brand-500 text-white shadow-glow' : 'bg-brand-500/10 text-brand-500')}>{f.icon}</div>
                <h3 className="mt-4 font-display text-base font-bold text-ink">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{f.text}</p>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* Llamada final */}
      <section className={cx('mx-auto max-w-6xl', hasWorkspace ? 'pb-4' : 'px-4 pb-16 sm:px-6')}>
        <div className="relative overflow-hidden rounded-3xl bg-ink px-6 py-12 text-center text-bg shadow-pop sm:px-10">
          <div className="hero-mesh pointer-events-none absolute inset-0 opacity-70" aria-hidden />
          <div className="relative">
            <FileText className="mx-auto size-8 text-brand-400" aria-hidden />
            <h2 className="mt-3 font-display text-3xl font-extrabold sm:text-4xl">Tu primer escandallo, antes del próximo servicio</h2>
            <p className="mx-auto mt-3 max-w-xl text-bg/75">Gratis y sin registro. Prueba con el restaurante de ejemplo o empieza directamente con tus facturas.</p>
            <div className="mt-7">{ctas('footer')}</div>
          </div>
        </div>
        {!hasWorkspace && (
          <p className="pb-safe mt-8 text-center text-xs text-muted">
            Escandallo Pro 1.0 · Tus datos se guardan solo en este dispositivo · Instalable como app
          </p>
        )}
      </section>
    </div>
  );
}
