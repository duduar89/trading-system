import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { FlaskConical, Sparkles, UtensilsCrossed } from 'lucide-react';
import type { BaseUnit, DishKind } from '../../types';
import { createDish, proposeForDishes } from '../../services/dishes';
import { aiAvailable } from '../../extract/index';
import { useAppSettings } from '../../state/hooks';
import { errorMessage, toast } from '../../state/store';
import { Button, Field, Input, Modal, NumberInput, Segmented, Select, Switch } from '../ui';

/** Alta rápida de plato o elaboración, con propuesta automática de ingredientes. */
export function NewDishModal({ open, initialKind = 'plato', sections, onClose }: { open: boolean; initialKind?: DishKind; sections: string[]; onClose: () => void }) {
  const navigate = useNavigate();
  const settings = useAppSettings();
  const [kind, setKind] = useState<DishKind>(initialKind);
  const [name, setName] = useState('');
  const [section, setSection] = useState('');
  const [price, setPrice] = useState<number | undefined>();
  const [portions, setPortions] = useState<number | undefined>(1);
  const [yieldQty, setYieldQty] = useState<number | undefined>();
  const [yieldUnit, setYieldUnit] = useState<BaseUnit>('kg');
  const [propose, setPropose] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    setKind(initialKind);
    setName('');
    setSection('');
    setPrice(undefined);
    setPortions(1);
    setYieldQty(undefined);
    setYieldUnit('kg');
    setPropose(true);
    setBusy(null);
    const t = setTimeout(() => nameRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [open, initialKind]);

  const submit = async () => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy('Creando…');
    try {
      const dish = await createDish({
        name: n,
        kind,
        section: section.trim() || undefined,
        menuPrice: kind === 'plato' && price && price > 0 ? price : undefined,
        portions: portions && portions >= 1 ? Math.round(portions) : 1,
        yieldQty: kind === 'elaboracion' && yieldQty && yieldQty > 0 ? yieldQty : undefined,
        yieldUnit: kind === 'elaboracion' && yieldQty && yieldQty > 0 ? yieldUnit : undefined,
        source: 'manual',
      });
      if (propose) {
        setBusy(aiAvailable(settings) ? 'Proponiendo con IA…' : 'Buscando la receta…');
        try {
          const res = await proposeForDishes([dish.id], { replace: true, createMissing: true });
          if (res.proposed > 0) toast.success(`«${dish.name}» creado con propuesta`, 'Revisa las líneas en violeta: gramajes, mermas e ingrediente vinculado.');
          else toast.info(`«${dish.name}» creado`, 'No encontramos una receta parecida: añade los ingredientes a mano.');
        } catch (e) {
          toast.error('Plato creado, pero no se pudo proponer la receta', errorMessage(e));
        }
      } else {
        toast.success(kind === 'plato' ? 'Plato creado' : 'Elaboración creada', dish.name);
      }
      onClose();
      navigate(`/platos/${dish.id}`);
    } catch (e) {
      toast.error('No se pudo crear', errorMessage(e));
      setBusy(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title={kind === 'plato' ? 'Nuevo plato' : 'Nueva elaboración'}
      subtitle={kind === 'plato' ? 'Un plato de tu carta.' : 'Una sub-receta (salsa, fondo, masa…) que podrás usar como ingrediente en tus platos.'}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={!!busy}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={!!busy} disabled={!name.trim()} icon={propose ? <Sparkles className="size-4" /> : undefined}>
            {busy ?? (propose ? 'Crear y proponer' : 'Crear')}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Segmented<DishKind>
          value={kind}
          onChange={setKind}
          className="w-full [&>button]:flex-1 [&>button]:justify-center"
          options={[
            { value: 'plato', label: 'Plato de carta', icon: <UtensilsCrossed className="size-4" /> },
            { value: 'elaboracion', label: 'Elaboración', icon: <FlaskConical className="size-4" /> },
          ]}
        />
        <Field label="Nombre">
          <Input ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'plato' ? 'Ej.: Croquetas de jamón ibérico' : 'Ej.: Salsa brava'} required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Sección" className={kind === 'plato' ? '' : 'col-span-2'}>
            <Input value={section} onChange={(e) => setSection(e.target.value)} list={listId} placeholder={kind === 'plato' ? 'Entrantes' : 'Salsas'} />
            <datalist id={listId}>
              {sections.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>
          {kind === 'plato' && (
            <Field label="PVP carta (IVA incl.)">
              <NumberInput value={price} onValue={setPrice} decimals={2} min={0} suffix="€" placeholder="0,00" />
            </Field>
          )}
          <Field label="Raciones" hint="Que salen de la receta">
            <NumberInput value={portions} onValue={setPortions} decimals={0} min={1} />
          </Field>
          {kind === 'elaboracion' && (
            <Field label="Rendimiento" hint="Opcional">
              <div className="flex gap-1.5">
                <NumberInput value={yieldQty} onValue={setYieldQty} decimals={3} min={0} placeholder="0" className="min-w-0 flex-1" />
                <Select value={yieldUnit} onChange={(e) => setYieldUnit(e.target.value as BaseUnit)} className="w-[72px]! shrink-0 px-2!" aria-label="Unidad de rendimiento">
                  <option value="kg">kg</option>
                  <option value="l">l</option>
                  <option value="ud">ud</option>
                </Select>
              </div>
            </Field>
          )}
        </div>
        <div className="rounded-2xl border border-line bg-surface-2 p-3.5">
          <Switch
            checked={propose}
            onChange={setPropose}
            label="Proponer ingredientes al crear"
            description={
              aiAvailable(settings)
                ? 'Con tu IA opcional (y la base de recetas local si falla), cruzada con tus productos.'
                : 'Receta tipo con gramajes y mermas, cruzada con tus productos. Gratis, en tu dispositivo.'
            }
          />
        </div>
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}
