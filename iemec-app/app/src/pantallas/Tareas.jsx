import { useState } from 'react';
import { api, fechaHora } from '../api.js';
import { useDatos, Cabecera, Boton, Error, Vacio } from '../componentes/comunes.jsx';

const TIPO = {
  llamar: 'Llamar', atender_conversacion: 'Contestar', aprobar_oferta: 'Aprobar oferta', aprobar_respuesta: 'Aprobar respuesta',
  revisar_ia: 'Revisar', otro: 'Revisar',
};
const ORIGEN = {
  meta_formulario: 'formulario de Meta', meta_ctwa: 'anuncio de WhatsApp', web: 'la web', ghl: 'GHL', web_whatsapp: 'WhatsApp de la web',
};
// «+34611000604» → «611 00 06 04».
const legible = (t) => {
  const m = /^\+34(\d{3})(\d{2})(\d{2})(\d{2})$/.exec(t || '');
  return m ? m.slice(1).join(' ') : t;
};

// Lo que tiene que hacer una persona: llamar a un lead con fijo, escribir a quien no tiene WhatsApp,
// contestar una conversación… Con quién es y cómo contactarle; un lead sin conversación solo está aquí.
export default function Tareas() {
  const { datos, error, recargar } = useDatos('/panel/tareas', { cadaMs: 30000 });
  const [aviso, setAviso] = useState('');
  if (error) return <Error texto={error} />;
  if (!datos) return null;
  const cerrar = async (id, estado) => {
    setAviso('');
    try {
      await api(`/panel/tareas/${id}`, { metodo: 'POST', cuerpo: { estado } });
      recargar();
    } catch (err) { setAviso(err.message); }
  };
  return (
    <>
      <Cabecera antetitulo="Lo que necesita a una persona" titulo="Tareas" />
      {datos.avisosFallidos > 0 && (
        <div role="alert" className="tarjeta mb-4 p-4 text-sm text-rosa">
          {datos.avisosFallidos} {datos.avisosFallidos === 1 ? 'aviso' : 'avisos'} de WhatsApp o de Meta no se han podido procesar: hay que revisarlos en el servidor.
        </div>
      )}
      {aviso && <div className="mb-4"><Error texto={aviso} /></div>}
      {datos.tareas.length === 0
        ? <Vacio titulo="No hay tareas abiertas">Cuando haya que llamar a alguien, contestar una conversación o revisar un lead, aparecerá aquí.</Vacio>
        : (
          <ul className="tarjeta divide-y divide-[var(--borde)]">
            {datos.tareas.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--texto-suave)' }}>
                    {t.urgente && <span className="rounded-full bg-rosa/20 px-2.5 py-0.5 font-medium text-rosa">Urgente</span>}
                    <span className="etiqueta">{TIPO[t.tipo] || t.tipo}</span>
                    <span className={`cifras ${t.vencida ? 'text-rosa' : ''}`}>{t.vencida ? 'Vencida' : 'Vence'} {fechaHora(t.vence)}</span>
                  </div>
                  <div className="mt-1 font-medium break-words">{t.titulo}</div>
                  <div className="mt-0.5 text-sm break-words" style={{ color: 'var(--texto-suave)' }}>
                    {[t.quien, t.lead && `lead de ${ORIGEN[t.lead.origen] || t.lead.origen?.replaceAll('_', ' ')}${t.lead.campana ? ` · ${t.lead.campana}` : ''}`].filter(Boolean).join(' · ')}
                    {t.telefono && <>{t.quien || t.lead ? ' · ' : ''}<a className="underline underline-offset-2" href={`tel:${t.telefono}`}>{legible(t.telefono)}</a></>}
                    {t.email && <> · <a className="underline underline-offset-2" href={`mailto:${t.email}`}>{t.email}</a></>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {t.conversacionId && <a href={`#conversaciones/${t.conversacionId}`} className="rounded-full border border-[var(--borde)] px-4 py-2 text-sm hover:border-oro">Ver chat</a>}
                  <Boton variante="lleno" onClick={() => cerrar(t.id, 'hecha')}>Hecha</Boton>
                  <Boton onClick={() => cerrar(t.id, 'cancelada')}>Descartar</Boton>
                </div>
              </li>
            ))}
          </ul>
        )}
    </>
  );
}
