import { useState } from 'react';
import { api } from '../api.js';
import { useDatos, Cabecera, Boton, Error } from '../componentes/comunes.jsx';

const ESTADO = { borrador: 'Borrador', en_revision: 'En revisión en Meta', aprobada: 'Aprobada', rechazada: 'Rechazada', pausada: 'Pausada por Meta', desactivada: 'Desactivada' };
const CALIDAD = { verde: 'bg-emerald-600', amarilla: 'bg-amber-500', roja: 'bg-rose-600', pendiente: 'bg-[var(--borde)]' };

export default function Plantillas() {
  const { datos, error } = useDatos('/panel/plantillas');
  const [borrador, setBorrador] = useState({ nombre: 'iemec_nueva', categoria: 'marketing', cuerpo: '' });
  const [revision, setRevision] = useState(null);
  if (error) return <Error texto={error} />;
  if (!datos) return null;
  const comprobar = async () => setRevision(await api('/panel/plantillas/comprobar', { metodo: 'POST', cuerpo: { ...borrador, ejemplos: ['Laura', 'tu tratamiento'], botones: [] } }));
  return (
    <>
      <Cabecera antetitulo="Mensajes aprobados por Meta" titulo="Plantillas de WhatsApp" />
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <ul className="grid gap-3 sm:grid-cols-2 self-start">
          {datos.map((p) => (
            <li key={p.id} className="tarjeta p-5 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="etiqueta">{p.uso.replaceAll('_', ' ')}</span>
                <span className="inline-flex items-center gap-1.5 text-xs" title={`Calidad según Meta: ${p.calidad}`}>
                  <span aria-hidden="true" className={`h-2 w-2 rounded-full ${CALIDAD[p.calidad]}`} />{ESTADO[p.estado]}
                </span>
              </div>
              <p className="mt-3 text-sm whitespace-pre-wrap">{p.cuerpo}</p>
              {p.botones?.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">{p.botones.map((b) => <span key={b.texto} className="rounded-full border filete px-2.5 py-0.5 text-xs">{b.texto}</span>)}</div>
              )}
              <div className="mt-3 flex flex-wrap gap-x-4 text-xs cifras" style={{ color: 'var(--texto-suave)' }}>
                <span>{p.categoria === 'marketing' ? 'Marketing' : 'Utilidad'}</span>
                <span>{p.enviadas} enviadas</span><span>{p.leidas} leídas</span>{p.fallidas > 0 && <span className="text-rosa">{p.fallidas} fallidas</span>}
              </div>
              {p.motivoRechazo && <p className="mt-2 text-xs text-rosa">Meta: {p.motivoRechazo}</p>}
            </li>
          ))}
        </ul>
        <aside className="tarjeta p-5 self-start">
          <h2 className="titulo text-xl">Nueva plantilla</h2>
          <p className="mt-1 text-sm" style={{ color: 'var(--texto-suave)' }}>Antes de mandarla a Meta pasa el formato y el filtro de publicidad sanitaria.</p>
          <label className="etiqueta mt-4 block" htmlFor="pl-nombre">Nombre</label>
          <input id="pl-nombre" value={borrador.nombre} onChange={(e) => setBorrador({ ...borrador, nombre: e.target.value })} className="mt-1 w-full rounded-xl border border-[var(--borde)] bg-transparent px-3 py-2 text-sm" />
          <label className="etiqueta mt-3 block" htmlFor="pl-cat">Tipo</label>
          <select id="pl-cat" value={borrador.categoria} onChange={(e) => setBorrador({ ...borrador, categoria: e.target.value })} className="mt-1 w-full rounded-xl border border-[var(--borde)] bg-transparent px-3 py-2 text-sm">
            <option value="marketing">Marketing (promociones, repesca)</option><option value="utilidad">Utilidad (citas)</option>
          </select>
          <label className="etiqueta mt-3 block" htmlFor="pl-cuerpo">Texto (variables: {'{{1}}'}, {'{{2}}'})</label>
          <textarea id="pl-cuerpo" rows={6} value={borrador.cuerpo} onChange={(e) => setBorrador({ ...borrador, cuerpo: e.target.value })}
            placeholder="Hola {{1}}, en IEMEC…" className="mt-1 w-full rounded-xl border border-[var(--borde)] bg-transparent px-3 py-2 text-sm" />
          <div className="mt-3"><Boton variante="lleno" onClick={comprobar} disabled={!borrador.cuerpo.trim()}>Comprobar</Boton></div>
          {revision && (
            <div className="mt-4 text-sm">
              {revision.ok ? <p className="text-emerald-700 dark:text-emerald-400">Lista para enviar a Meta.</p> : <p className="text-rosa">Hay que corregirla:</p>}
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {revision.errores.map((e) => <li key={e} className="text-rosa">{e}</li>)}
                {revision.avisos.map((a) => <li key={a} style={{ color: 'var(--texto-suave)' }}>{a}</li>)}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
