import { useSearchParams } from 'react-router';
import { Calculator, Download, Grid2x2, LineChart, Receipt, Scale } from 'lucide-react';
import { PageHeader, Segmented } from '../components/ui';
import { CardSkeleton } from '../components/home/shared';
import { useReportsData } from '../components/home/reports/useReportsData';
import { MenuEngineeringTab } from '../components/home/reports/MenuEngineeringTab';
import { PriceEvolutionTab } from '../components/home/reports/PriceEvolutionTab';
import { PurchasesTab } from '../components/home/reports/PurchasesTab';
import { WasteTab } from '../components/home/reports/WasteTab';
import { SimulatorTab } from '../components/home/reports/SimulatorTab';
import { ExportTab } from '../components/home/reports/ExportTab';

type Tab = 'menu' | 'precios' | 'compras' | 'mermas' | 'simulador' | 'exportar';

const TABS: { value: Tab; label: string; icon: typeof Grid2x2; subtitle: string }[] = [
  { value: 'menu', label: 'Ingeniería de menú', icon: Grid2x2, subtitle: 'Qué platos son estrellas y cuáles conviene reformular, cruzando popularidad y margen.' },
  { value: 'precios', label: 'Evolución de precios', icon: LineChart, subtitle: 'Cómo cambia lo que pagas por cada ingrediente, factura a factura.' },
  { value: 'compras', label: 'Compras', icon: Receipt, subtitle: 'Cuánto gastas, a quién le compras y en qué productos.' },
  { value: 'mermas', label: 'Mermas', icon: Scale, subtitle: 'Dónde se pierde el dinero entre la compra y el plato.' },
  { value: 'simulador', label: 'Simulador', icon: Calculator, subtitle: 'Anticípate a las subidas: cambia un precio y mira el efecto en toda la carta.' },
  { value: 'exportar', label: 'Exportar', icon: Download, subtitle: 'Excel de escandallos e ingredientes y copia de seguridad.' },
];

function isTab(v: string | null): v is Tab {
  return TABS.some((t) => t.value === v);
}

export default function Reports() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: Tab = isTab(raw) ? raw : 'menu';
  const data = useReportsData();
  const current = TABS.find((t) => t.value === tab)!;

  const setTab = (t: Tab) => {
    const next = new URLSearchParams();
    next.set('tab', t);
    setParams(next, { replace: true });
  };

  return (
    <div className="animate-fade-in">
      <PageHeader eyebrow="Informes" title={current.label} subtitle={current.subtitle} />

      <div className="-mx-4 mb-5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          className="min-w-max"
          options={TABS.map((t) => ({ value: t.value, label: t.label, icon: <t.icon className="size-4" /> }))}
        />
      </div>

      {!data ? (
        <div className="space-y-4" aria-busy="true" aria-label="Cargando informe">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <CardSkeleton key={i} lines={1} />
            ))}
          </div>
          <CardSkeleton lines={8} />
        </div>
      ) : (
        <div key={tab} className="animate-slide-up" role="tabpanel" aria-label={current.label}>
          {tab === 'menu' && <MenuEngineeringTab data={data} />}
          {tab === 'precios' && <PriceEvolutionTab data={data} />}
          {tab === 'compras' && <PurchasesTab data={data} />}
          {tab === 'mermas' && <WasteTab data={data} />}
          {tab === 'simulador' && <SimulatorTab data={data} />}
          {tab === 'exportar' && <ExportTab data={data} />}
        </div>
      )}
    </div>
  );
}
