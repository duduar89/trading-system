import { useEffect, useState } from 'react';
import { api, fechaHora } from '../api.js';
import { useDatos, Cabecera, EstadoConversacion, Boton, Error, Vacio } from '../componentes/comunes.jsx';

const PASO = { cita: 'Cita', seguimiento: 'Seguimiento', persona: 'Una persona', cerrada: 'Cerrada', espera_respuesta: 'Espera respuesta', ninguno: 'Sin próximo paso' };
const AUTOR = { paciente: 'Paciente', ia: 'Asistente IA', persona: 'Equipo', sistema: 'Automático' };

export default function Bandeja() {
  const lista = useDatos('/panel/conversaciones', { cadaMs: 10000 });
  const [sel, setSel] = useState(null);
  const [filtro, setFiltro] = useState('abiertas');
  useEffect(() => {
    const id = Number(window.location.hash.split('/')[1]);
    if (id) setSel(id);
  }, []);
  if (lista.error) return <Error texto={lista.error} />;
  const convs = (lista.datos || []).filter((c) => (filtro === 'abiertas' ? c.estado !== 'cerrada' : filtro === 'persona' ? ['espera_persona', 'persona'].includes(c.estado) : true));
  return (
    <>
      <Cabecera antetitulo="Bandeja única de WhatsApp" titulo="Conversaciones">
        {[['abiertas', 'Abiertas'], ['persona', 'Para una persona'], ['todas', 'Todas']].map(([v, t]) => (
          <Boton key={v} variante={filtro === v ? 'lleno' : 'contorno'} onClick={() => setFiltro(v)}>{t}</Boton>
        ))}
      </Cabecera>
      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <ul className="tarjeta divide-y divide-[var(--borde)] self-start overflow-hidden">
          {convs.length === 0 && <li className="p-6 text-sm" style={{ color: 'var(--texto-suave)' }}>No hay conversaciones con este filtro.</li>}
          {convs.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => { setSel(c.id); window.location.hash = `conversaciones/${c.id}`; }}
                className={`w-full px-4 py-3 text-left hover:bg-[var(--superficie-2)] ${sel === c.id ? 'bg-[var(--superficie-2)]' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium truncate">{c.nombre}</span>
                  <span className="text-xs shrink-0" style={{ color: 'var(--texto-suave)' }}>{fechaHora(c.actualizado)}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <EstadoConversacion estado={c.estado} urgente={c.urgente} />
                  <span className="text-xs" style={{ color: 'var(--texto-suave)' }}>
                    {c.proximoSeguimiento ? `Le escribimos ${fechaHora(c.proximoSeguimiento)}` : PASO[c.proximoPaso]}
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
        {sel ? <Detalle id={sel} alCambiar={lista.recargar} /> : <Vacio titulo="Elige una conversación">Verás el chat, la ficha del paciente, el próximo paso y qué ha decidido la IA.</Vacio>}
      </div>
    </>
  );
}

function Detalle({ id, alCambiar }) {
  const { datos: d, error, recargar } = useDatos(`/panel/conversaciones/${id}`, { cadaMs: 8000 });
  const plantillas = useDatos('/panel/plantillas');
  const [texto, setTexto] = useState('');
  const [plantilla, setPlantilla] = useState('');
  const [aviso, setAviso] = useState('');
  if (error) return <Error texto={error} />;
  if (!d) return null;
  const c = d.conversacion;
  const ventana = c.ventanaHasta && new Date(c.ventanaHasta) > new Date();
  const accion = async (a) => { await api(`/panel/conversaciones/${id}/${a}`, { metodo: 'POST', cuerpo: {} }); recargar(); alCambiar(); };
  const enviar = async (e) => {
    e.preventDefault();
    setAviso('');
    try {
      await api(`/panel/conversaciones/${id}/enviar`, { metodo: 'POST', cuerpo: ventana ? { texto } : { plantillaId: Number(plantilla), variables: [d.paciente?.nombre || ''] } });
      setTexto(''); recargar(); alCambiar();
    } catch (err) { setAviso(err.message); }
  };
  return (
    <section className="grid gap-4 xl:grid-cols-[1fr_300px] min-w-0">
      <div className="tarjeta flex min-h-[560px] flex-col overflow-hidden min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--borde)] px-5 py-4">
          <div className="min-w-0">
            <div className="titulo text-xl truncate">{d.paciente ? `${d.paciente.nombre} ${d.paciente.apellidos || ''}` : d.lead?.nombre || 'Contacto nuevo'}</div>
            <div className="mt-1"><EstadoConversacion estado={c.estado} urgente={c.urgente} /></div>
          </div>
          <div className="flex flex-wrap gap-2">
            {c.estado !== 'persona' && <Boton onClick={() => accion('tomar')}>Tomar</Boton>}
            {c.estado === 'persona' || c.estado === 'espera_persona' ? <Boton onClick={() => accion('devolver')}>Devolver a la IA</Boton> : null}
            <Boton onClick={() => accion('cerrar')}>Cerrar</Boton>
          </div>
        </div>
        <ol className="flex-1 space-y-3 overflow-y-auto px-5 py-5">
          {d.mensajes.map((m) => (
            <li key={m.id} className={`flex ${m.direccion === 'entrante' ? 'justify-start' : 'justify-end'}`}>
              <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${m.direccion === 'entrante' ? 'bg-[var(--superficie-2)]' : m.autor === 'ia' ? 'bg-aqua text-terciopelo-900' : 'bg-terciopelo-800 text-white'}`}>
                <div className="whitespace-pre-wrap">{m.texto}</div>
                <div className={`mt-1 text-[10px] ${m.direccion === 'entrante' ? '' : 'opacity-70'}`} style={m.direccion === 'entrante' ? { color: 'var(--texto-suave)' } : undefined}>
                  {AUTOR[m.autor]} · {fechaHora(m.en)}{m.intencion && m.direccion === 'entrante' ? ` · entendido: ${m.intencion.replace('_', ' ')}` : ''}{m.estado === 'fallido' ? ' · no entregado' : ''}
                </div>
              </div>
            </li>
          ))}
        </ol>
        <form onSubmit={enviar} className="border-t border-[var(--borde)] p-4">
          {ventana ? (
            <div className="flex gap-2">
              <label htmlFor="texto" className="sr-only">Mensaje</label>
              <textarea id="texto" rows={2} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escribe como equipo IEMEC…"
                className="flex-1 resize-none rounded-xl border border-[var(--borde)] bg-transparent px-3 py-2 text-sm outline-none focus:border-oro" />
              <Boton variante="lleno" type="submit" disabled={!texto.trim()}>Enviar</Boton>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs" style={{ color: 'var(--texto-suave)' }}>Pasaron 24 h desde su último mensaje: solo con plantilla aprobada.</span>
              <label htmlFor="plantilla" className="sr-only">Plantilla</label>
              <select id="plantilla" value={plantilla} onChange={(e) => setPlantilla(e.target.value)} className="rounded-full border border-[var(--borde)] bg-transparent px-3 py-2 text-sm">
                <option value="">Elige plantilla…</option>
                {(plantillas.datos || []).filter((p) => p.estado === 'aprobada').map((p) => <option key={p.id} value={p.id}>{p.uso.replaceAll('_', ' ')}</option>)}
              </select>
              <Boton variante="lleno" type="submit" disabled={!plantilla}>Enviar plantilla</Boton>
            </div>
          )}
          {aviso && <p role="alert" className="mt-2 text-sm text-rosa">{aviso}</p>}
        </form>
      </div>
      <aside className="flex flex-col gap-4 min-w-0">
        <div className="tarjeta p-5">
          <div className="etiqueta">Próximo paso</div>
          <div className="titulo mt-1 text-lg">{PASO[c.proximoPaso]}</div>
          {d.seguimientos.filter((s) => s.estado === 'pendiente').map((s) => (
            <div key={s.id} className="mt-3 rounded-xl border filete p-3 text-sm">
              <div className="font-medium">Le escribimos {fechaHora(s.programado)}</div>
              {s.frase && <div className="mt-1 italic" style={{ color: 'var(--texto-suave)' }}>«{s.frase}»</div>}
            </div>
          ))}
        </div>
        <div className="tarjeta p-5">
          <div className="etiqueta">Ficha</div>
          {d.paciente ? (
            <ul className="mt-2 space-y-1 text-sm">
              <li>{d.paciente.es_cliente ? 'Paciente de la clínica' : 'Aún no es paciente'}</li>
              {d.paciente.baja_comercial_en && <li className="text-rosa">Baja de mensajes comerciales</li>}
              {d.citas.map((ci) => <li key={ci.inicio} style={{ color: 'var(--texto-suave)' }}>{fechaHora(ci.inicio)} · {ci.tratamiento} · {ci.estado}</li>)}
            </ul>
          ) : d.lead ? (
            <ul className="mt-2 space-y-1 text-sm">
              <li>Lead · {d.lead.etapa}</li>
              {d.lead.tratamiento && <li style={{ color: 'var(--texto-suave)' }}>Interés: {d.lead.tratamiento}</li>}
              <li style={{ color: 'var(--texto-suave)' }}>Origen: {d.lead.origen?.replaceAll('_', ' ')}{d.lead.campana ? ` · ${d.lead.campana}` : ''}</li>
            </ul>
          ) : <p className="mt-2 text-sm" style={{ color: 'var(--texto-suave)' }}>Contacto sin ficha todavía.</p>}
        </div>
        <div className="tarjeta p-5">
          <div className="etiqueta">Qué ha decidido la IA</div>
          <ul className="mt-2 space-y-2 text-xs">
            {d.decisiones.filter((e) => e.tipo === 'repesca_decision').slice(0, 5).map((e) => (
              <li key={e.en}>
                <span className="font-medium">{e.datos.intencion?.replaceAll('_', ' ')}</span>
                <span style={{ color: 'var(--texto-suave)' }}> → {e.datos.acciones?.map((a) => a.tipo.replaceAll('_', ' ') + (a.fecha ? ` (${a.fecha})` : '')).join(', ')}</span>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </section>
  );
}
