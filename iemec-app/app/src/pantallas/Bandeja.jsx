import { useEffect, useState } from 'react';
import { api, fechaHora } from '../api.js';
import { useDatos, Cabecera, EstadoConversacion, Boton, Error, Vacio, INTENCION } from '../componentes/comunes.jsx';

const PASO = { cita: 'Cita', seguimiento: 'Seguimiento', persona: 'Una persona', cerrada: 'Cerrada', espera_respuesta: 'Espera respuesta', ninguno: 'Sin próximo paso' };
const AUTOR = { paciente: 'Paciente', ia: 'Asistente IA', persona: 'Equipo', sistema: 'Automático' };
const ACCION = {
  proponer_huecos: 'proponer huecos', programar_seguimiento: 'volver a escribir', pasar_a_persona: 'pasar a una persona',
  cita_reservada: 'cita reservada', ofrecer: 'ofrecer una opción del catálogo', baja: 'dar de baja', cerrar: 'cerrar',
  preguntar_cuando: 'preguntar cuándo', tarea_llamar: 'llamarle', responder: 'responder', ofrecer_valoracion: 'ofrecer valoración',
  preguntar_si_cancela: 'preguntar si cancela', cancelar_cita: 'cancelar la cita', mantener_cita: 'mantener la cita', apuntar_lista_espera: 'apuntar en la lista de espera', salir_lista_espera: 'sacar de la lista de espera',
};
const proximo = (c) => (c.proximoPaso === 'cita' && c.proximoPasoEn ? `Cita ${fechaHora(c.proximoPasoEn)}` : PASO[c.proximoPaso]);
// Lo que dice WhatsApp de cada mensaje nuestro; si no llegó, por qué (p. ej., el límite de marketing de Meta).
const ENTREGA = { entregado: 'entregado', leido: 'leído' };
const entrega = (m) => {
  if (m.direccion !== 'saliente') return '';
  if (m.estado === 'fallido') return ` · no entregado${m.error ? `: ${m.error.texto || ''}${m.error.codigo ? ` (${m.error.codigo})` : ''}` : ''}`;
  return ENTREGA[m.estado] ? ` · ${ENTREGA[m.estado]}` : '';
};

// Las variables de una plantilla ({{1}}, {{2}}…) y cómo le llega con los valores puestos.
const variables = (cuerpo) => [...new Set([...String(cuerpo).matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
const rellenar = (cuerpo, valores) => String(cuerpo).replace(/\{\{(\d+)\}\}/g, (v, n) => valores[Number(n) - 1]?.trim() || v);

// Los enlaces de los mensajes («Tu cita», reseñas) se pueden abrir desde el panel.
function ConEnlaces({ texto }) {
  const partes = String(texto).split(/(https?:\/\/[^\s]+)/g);
  return partes.map((p, i) => (/^https?:\/\//.test(p)
    ? <a key={i} href={p} target="_blank" rel="noreferrer" className="underline underline-offset-2 break-all">{p}</a>
    : p));
}

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
                className={`foco-dentro w-full px-4 py-3 text-left hover:bg-[var(--superficie-2)] ${sel === c.id ? 'bg-[var(--superficie-2)]' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium truncate">{c.nombre}</span>
                  <span className="text-xs shrink-0" style={{ color: 'var(--texto-suave)' }}>{fechaHora(c.actualizado)}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <EstadoConversacion estado={c.estado} urgente={c.urgente} motivoCierre={c.motivoCierre} />
                  <span className="text-xs" style={{ color: 'var(--texto-suave)' }}>
                    {c.proximoSeguimiento ? `Le escribimos ${fechaHora(c.proximoSeguimiento)}` : proximo(c)}
                  </span>
                  {c.noEntregado && <span className="text-xs text-rosa">· No le llegó el último mensaje</span>}
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
  const [valores, setValores] = useState([]);
  const [aviso, setAviso] = useState('');
  if (error) return <Error texto={error} />;
  if (!d) return null;
  const c = d.conversacion;
  const ventana = c.ventanaHasta && new Date(c.ventanaHasta) > new Date();
  // Con la ventana cerrada, solo plantillas aprobadas; las que llevan el enlace de una cita o de una
  // reseña las manda la app sola. Cada variable lleva su valor ({{1}}, el nombre con que se le saluda).
  const aMano = (plantillas.datos || []).filter((p) => p.estado === 'aprobada' && p.aMano);
  const elegida = aMano.find((p) => String(p.id) === plantilla);
  const campos = elegida ? variables(elegida.cuerpo) : [];
  const completa = Boolean(elegida) && campos.every((n) => valores[n - 1]?.trim());
  const elegir = (id) => { setPlantilla(id); setValores([d.saludo || '']); };
  const accion = async (a) => { await api(`/panel/conversaciones/${id}/${a}`, { metodo: 'POST', cuerpo: {} }); recargar(); alCambiar(); };
  const enviar = async (e) => {
    e.preventDefault();
    setAviso('');
    try {
      await api(`/panel/conversaciones/${id}/enviar`, { metodo: 'POST', cuerpo: ventana ? { texto } : { plantillaId: Number(plantilla), variables: campos.map((n) => valores[n - 1].trim()) } });
      setTexto(''); setPlantilla(''); setValores([]); recargar(); alCambiar();
    } catch (err) { setAviso(err.message); }
  };
  return (
    <section className="grid gap-4 xl:grid-cols-[1fr_300px] min-w-0">
      <div className="tarjeta flex min-h-[560px] flex-col overflow-hidden min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--borde)] px-5 py-4">
          <div className="min-w-0">
            <div className="titulo text-xl truncate">{d.paciente ? `${d.paciente.nombre} ${d.paciente.apellidos || ''}` : d.lead?.nombre || c.nombreWhatsapp || 'Contacto nuevo'}</div>
            <div className="mt-1"><EstadoConversacion estado={c.estado} urgente={c.urgente} motivoCierre={c.motivoCierre} /></div>
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
                <div className="whitespace-pre-wrap break-words"><ConEnlaces texto={m.texto} /></div>
                <div className={`mt-1 text-[10px] ${m.direccion === 'entrante' ? '' : 'opacity-70'}`} style={m.direccion === 'entrante' ? { color: 'var(--texto-suave)' } : undefined}>
                  {m.tipo === 'plantilla' ? 'Plantilla aprobada · ' : ''}{AUTOR[m.autor]} · {fechaHora(m.en)}{m.intencion && m.direccion === 'entrante' ? ` · entendido: ${(INTENCION[m.intencion] || m.intencion.replaceAll('_', ' ')).toLowerCase()}` : ''}{entrega(m)}
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
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs" style={{ color: 'var(--texto-suave)' }}>Pasaron 24 h desde su último mensaje: solo con plantilla aprobada.</span>
                <label htmlFor="plantilla" className="sr-only">Plantilla</label>
                <select id="plantilla" value={plantilla} onChange={(e) => elegir(e.target.value)} className="min-w-0 max-w-full rounded-full border border-[var(--borde)] bg-transparent px-3 py-2 text-sm">
                  <option value="">Elige plantilla…</option>
                  {aMano.map((p) => <option key={p.id} value={p.id}>{p.uso.replaceAll('_', ' ')}</option>)}
                </select>
              </div>
              {elegida && campos.map((n) => (
                <label key={n} className="grid min-w-0 gap-1 text-sm">
                  <span className="etiqueta">Dato {n}</span>
                  <input value={valores[n - 1] || ''} onChange={(e) => setValores(Object.assign([...valores], { [n - 1]: e.target.value }))}
                    placeholder={elegida.ejemplos?.[n - 1] ? `Por ejemplo, ${elegida.ejemplos[n - 1]}` : ''}
                    className="min-w-0 rounded-full border border-[var(--borde)] bg-transparent px-3 py-1.5 outline-none focus:border-oro" />
                </label>
              ))}
              {elegida && (
                <div className="rounded-xl bg-[var(--superficie-2)] px-3 py-2 text-sm">
                  <span className="etiqueta block">Le llegará</span>
                  <p className="mt-1 whitespace-pre-wrap break-words">{rellenar(elegida.cuerpo, valores)}</p>
                </div>
              )}
              <div><Boton variante="lleno" type="submit" disabled={!completa}>Enviar plantilla</Boton></div>
            </div>
          )}
          {aviso && <p role="alert" className="mt-2 text-sm text-rosa">{aviso}</p>}
        </form>
      </div>
      <aside className="flex flex-col gap-4 min-w-0">
        <div className="tarjeta p-5">
          <div className="etiqueta">Próximo paso</div>
          <div className="titulo mt-1 text-lg">{proximo(c)}</div>
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
              <li>{d.paciente.es_cliente ? 'Paciente de la clínica' : d.citas.length ? 'Primera visita' : 'Aún no es paciente'}</li>
              {d.paciente.baja_comercial_en && <li className="text-rosa">Baja de mensajes comerciales</li>}
              {d.citas.map((ci) => <li key={ci.inicio} style={{ color: 'var(--texto-suave)' }}>{fechaHora(ci.inicio)} · {ci.tratamiento} · {ci.estado}</li>)}
            </ul>
          ) : d.lead ? (
            <ul className="mt-2 space-y-1 text-sm">
              <li>Lead · {d.lead.etapa}</li>
              {d.lead.tratamiento && <li style={{ color: 'var(--texto-suave)' }}>Interés: {d.lead.tratamiento}</li>}
              <li style={{ color: 'var(--texto-suave)' }}>Origen: {d.lead.origen?.replaceAll('_', ' ')}{d.lead.campana ? ` · ${d.lead.campana}` : ''}{d.lead.anuncio ? ` · ${d.lead.anuncio}` : ''}</li>
              {(d.lead.respuestas || []).map((r) => <li key={r.pregunta} style={{ color: 'var(--texto-suave)' }}>{r.pregunta}: {r.valor}</li>)}
            </ul>
          ) : <p className="mt-2 text-sm" style={{ color: 'var(--texto-suave)' }}>Contacto sin ficha todavía.</p>}
        </div>
        <div className="tarjeta p-5">
          <div className="etiqueta">Qué ha decidido la IA</div>
          <ul className="mt-2 space-y-2 text-xs">
            {d.decisiones.filter((e) => e.tipo === 'repesca_decision').slice(0, 5).map((e) => (
              <li key={e.en}>
                <span className="font-medium">{INTENCION[e.datos.intencion] || e.datos.intencion?.replaceAll('_', ' ')}</span>
                <span style={{ color: 'var(--texto-suave)' }}> → {e.datos.acciones?.map((a) => (ACCION[a.tipo] || a.tipo.replaceAll('_', ' ')) + (a.fecha ? ` (${a.fecha.split('-').reverse().join('/')})` : '')).join(', ')}</span>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </section>
  );
}
