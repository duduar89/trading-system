import { useState } from 'react';
import { api, fechaHora } from '../api.js';
import { useDatos, Cabecera, Cifra, Boton, Error } from '../componentes/comunes.jsx';

const Estrellas = ({ n }) => <span aria-label={`${n} de 5`} className="text-oro tracking-wider">{'★'.repeat(n)}<span className="opacity-25">{'★'.repeat(5 - n)}</span></span>;

export default function Resenas() {
  const { datos: d, error, recargar } = useDatos('/panel/resenas');
  const [textos, setTextos] = useState({});
  const [aviso, setAviso] = useState('');
  if (error) return <Error texto={error} />;
  if (!d) return null;
  const m = d.metricas;
  const publicar = async (r) => {
    setAviso('');
    try { await api(`/panel/resenas/${r.id}/publicar`, { metodo: 'POST', cuerpo: { texto: textos[r.id] ?? r.borrador } }); recargar(); } catch (err) { setAviso(err.message); }
  };
  return (
    <>
      <Cabecera antetitulo="Google Business Profile" titulo="Reseñas y ficha de Google" />
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Cifra etiqueta="Nota media" valor={m.notaMediaTotal ?? '—'} detalle={`${d.resenas.length} reseñas en la app`} tono="oro" />
        <Cifra etiqueta="Sin responder" valor={m.sinResponder} detalle="con borrador listo para aprobar" tono={m.sinResponder ? 'alerta' : 'normal'} />
        <Cifra etiqueta="Peticiones enviadas" valor={m.peticiones} detalle={`${m.pulsadas} abrieron el enlace`} />
        <Cifra etiqueta="Conversión" valor={m.conversion == null ? '—' : `${m.conversion} %`} detalle="peticiones que acaban en reseña" />
      </section>
      {aviso && <p role="alert" className="mt-4 text-sm text-rosa">{aviso}</p>}
      <div className="mt-6 grid gap-4 xl:grid-cols-[1fr_360px]">
        <ul className="space-y-3">
          {d.resenas.map((r) => (
            <li key={r.id} className="tarjeta p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3"><span className="font-medium">{r.autor}</span><Estrellas n={r.nota} /></div>
                <span className="text-xs" style={{ color: 'var(--texto-suave)' }}>{fechaHora(r.publicada)}{r.prioridad === 'alta' ? ' · prioridad alta' : ''}</span>
              </div>
              {r.texto && <p className="mt-2 text-sm">{r.texto}</p>}
              {r.temas?.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{r.temas.map((t) => <span key={t} className="rounded-full bg-[var(--superficie-2)] px-2.5 py-0.5 text-xs">{t.replaceAll('_', ' ')}</span>)}</div>}
              {r.estado === 'publicada' ? (
                <div className="mt-3 rounded-xl border filete p-3 text-sm"><div className="etiqueta mb-1">Respuesta publicada</div>{r.respuesta}</div>
              ) : r.borrador ? (
                <div className="mt-3">
                  <label className="etiqueta" htmlFor={`r-${r.id}`}>Respuesta propuesta (sin datos de salud)</label>
                  <textarea id={`r-${r.id}`} rows={3} value={textos[r.id] ?? r.borrador} onChange={(e) => setTextos({ ...textos, [r.id]: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-[var(--borde)] bg-transparent px-3 py-2 text-sm" />
                  <div className="mt-2"><Boton variante="lleno" onClick={() => publicar(r)}>Aprobar y publicar</Boton></div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        <aside className="tarjeta p-5 self-start">
          <h2 className="titulo text-xl">Publicaciones para este mes</h2>
          <p className="mt-1 text-sm" style={{ color: 'var(--texto-suave)' }}>Ideas para la ficha de Google, sin medicamentos ni productos sanitarios, con botón de reserva por WhatsApp que dice de dónde viene la cita.</p>
          <ul className="mt-4 space-y-3">
            {d.publicaciones.map((p) => (
              <li key={p.codigo} className="rounded-xl border border-[var(--borde)] p-3 text-sm">
                <div className="font-medium">{p.titulo}</div>
                <p className="mt-1" style={{ color: 'var(--texto-suave)' }}>{p.texto}</p>
                <div className="mt-2 text-xs text-oro">Código de origen: {p.codigo}</div>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </>
  );
}
