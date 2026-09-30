import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDatos, Cabecera, Boton, Error, Vacio } from '../componentes/comunes.jsx';
import { api, diaLargo, hhmm, hoyMadrid, sumarDias } from '../api.js';

const PX_MIN = 1.5;
const TONOS = {
  facial: '#c48981', corporal: '#d9bf8f', medicina_capilar: '#5e8c8f', cirugia_capilar: '#304e50', head_spa: '#76c3c7',
  perdida_peso: '#8fb8a8', ginecoestetica: '#b7a1c9', sexualidad_masculina: '#6f7fa8', cirugia_estetica: '#1d5b58', estetica_avanzada: '#e3c9a8',
};

// Lo que recepción marca de cada cita. Qué botones tocan lo dice el servidor (según estado y hora).
const ESTADO_CITA = {
  retenida: 'Hueco retenido', confirmada: 'Confirmada', llegada: 'Ha llegado', en_curso: 'En cabina',
  completada: 'Completada', no_presentada: 'No vino',
};
const BOTON = { llegada: 'Ha llegado', completada: 'Completada', no_presentada: 'No vino' };
const ORO = 'text-[#7a5a1f] dark:text-champan';
const ROSA = 'text-[#9a5a52] dark:text-[#e0b1aa]';
const TINTA = { llegada: ORO, en_curso: ORO, no_presentada: ROSA };
const PASTILLA = {
  retenida: `bg-oro/15 ${ORO}`, confirmada: 'bg-[var(--superficie-2)] text-[var(--texto-suave)]', llegada: `bg-oro/20 ${ORO}`,
  en_curso: `bg-oro/20 ${ORO}`, completada: 'bg-terciopelo-800 text-white', no_presentada: `bg-rosa/15 ${ROSA}`,
};

const fmtHora = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' });
const fmtFecha = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' });
const fmtLarga = new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });
const horaDe = (iso) => fmtHora.format(new Date(iso));
const cuando = (iso) => `el ${diaLargo(fmtFecha.format(new Date(iso)))} a las ${horaDe(iso)}`;
const fechaLarga = (f) => fmtLarga.format(new Date(`${f}T12:00:00Z`));

function ahoraMin() {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  return Number(p.find((x) => x.type === 'hour').value) * 60 + Number(p.find((x) => x.type === 'minute').value);
}

// La marca de cada estado: siempre acompaña a su palabra, nunca va sola.
function MarcaEstado({ estado }) {
  if (estado === 'completada') {
    return (
      <svg aria-hidden="true" viewBox="0 0 12 12" className="h-3 w-3 shrink-0" fill="none" stroke="var(--dorado)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2.4 6.3 5 8.8l4.6-5.4" />
      </svg>
    );
  }
  if (estado === 'no_presentada') return <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full border-[1.5px] border-rosa" />;
  if (estado === 'retenida') return <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rotate-45 bg-oro" />;
  if (estado === 'confirmada') return <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full border-[1.5px] border-[var(--texto-suave)] opacity-60" />;
  return <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-oro" />;
}

// La tarjeta cambia con el estado, en los tonos de la casa: dorado si ha llegado, terciopelo
// apagado si se completó y borde discontinuo si no vino.
function estiloTarjeta(estado, alto, tono) {
  const base = { height: alto, borderColor: tono, boxShadow: `inset 3px 0 0 ${tono}` };
  if (estado === 'llegada' || estado === 'en_curso') return { ...base, borderColor: 'var(--dorado)', background: 'color-mix(in srgb, var(--dorado) 12%, var(--superficie))' };
  if (estado === 'completada') return { ...base, borderColor: `color-mix(in srgb, ${tono} 45%, var(--borde))`, background: 'var(--superficie-2)' };
  if (estado === 'no_presentada') return { ...base, borderStyle: 'dashed', borderColor: 'color-mix(in srgb, var(--color-rosa) 75%, transparent)', boxShadow: 'none' };
  return base;
}

// La cuenta del día: cuántas citas y qué ha pasado con ellas (los «no vino», a la vista).
function ResumenDia({ citas }) {
  const n = (...estados) => citas.filter((c) => estados.includes(c.estado)).length;
  const partes = [
    ['llegada', n('llegada', 'en_curso'), 'ha llegado', 'han llegado'],
    ['completada', n('completada'), 'completada', 'completadas'],
    ['no_presentada', n('no_presentada'), 'no vino', 'no vinieron'],
  ].filter(([, cuantas]) => cuantas > 0);
  return (
    <p className="-mt-3 mb-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm" style={{ color: 'var(--texto-suave)' }}>
      <span><b className="cifras font-medium text-[var(--texto)]">{citas.length}</b> {citas.length === 1 ? 'cita' : 'citas'}</span>
      {partes.map(([estado, cuantas, una, varias]) => (
        <span key={estado} className="inline-flex items-center gap-1.5">
          <MarcaEstado estado={estado} /><b className="cifras font-medium text-[var(--texto)]">{cuantas}</b> {cuantas === 1 ? una : varias}
        </span>
      ))}
    </p>
  );
}

export default function Agenda() {
  const [fecha, setFecha] = useState(hoyMadrid());
  const [vista, setVista] = useState('cabina');
  const [abierta, setAbierta] = useState(null);
  const origen = useRef(null);
  const { datos: d, error, recargar } = useDatos(`/panel/agenda?fecha=${fecha}`, { cadaMs: 15000 });
  const abrir = (id, boton) => { origen.current = boton; setAbierta(id); };
  // Al cerrar el detalle, el foco vuelve a la tarjeta que lo abrió.
  const cerrar = useCallback(() => { setAbierta(null); origen.current?.focus(); }, []);

  const columnas = useMemo(() => {
    if (!d) return [];
    return vista === 'cabina'
      ? d.salas.map((s) => ({ id: s.id, nombre: s.nombre, citas: d.citas.filter((c) => c.salaId === s.id), bloqueos: [] }))
      : d.profesionales.filter((p) => p.turnos.length).map((p) => ({ id: p.id, nombre: p.nombre, color: p.color, citas: d.citas.filter((c) => c.profesionalId === p.id), bloqueos: p.pausas, turnos: p.turnos, flotantes: p.comidasFlotantes }));
  }, [d, vista]);

  if (error) return <Error texto={error} />;
  const desde = d?.abierto?.length ? Math.min(...d.abierto.map((a) => a.desde)) - 30 : 600;
  const hasta = d?.abierto?.length ? Math.max(...d.abierto.map((a) => a.hasta)) + 30 : 1230;
  const horas = [];
  for (let m = Math.ceil(desde / 60) * 60; m <= hasta; m += 60) horas.push(m);
  const esHoy = fecha === hoyMadrid();
  const ahora = ahoraMin();
  const profesional = (id) => d?.profesionales.find((p) => p.id === id);

  return (
    <>
      <Cabecera antetitulo="Agenda" titulo={diaLargo(fecha)}>
        <Boton onClick={() => setFecha(sumarDias(fecha, -1))} aria-label="Día anterior">←</Boton>
        <Boton onClick={() => setFecha(hoyMadrid())}>Hoy</Boton>
        <Boton onClick={() => setFecha(sumarDias(fecha, 1))} aria-label="Día siguiente">→</Boton>
        <div className="ml-2 inline-flex rounded-full border border-[var(--borde)] p-1 text-sm" role="group" aria-label="Ver por">
          {[['cabina', 'Por cabina'], ['profesional', 'Por profesional']].map(([v, t]) => (
            <button key={v} type="button" onClick={() => setVista(v)} aria-pressed={vista === v}
              className={`rounded-full px-3 py-1 ${vista === v ? 'bg-terciopelo-800 text-white' : ''}`}>{t}</button>
          ))}
        </div>
      </Cabecera>
      {d?.festivo && <Vacio titulo="Festivo: la clínica no abre">No se ofrecen huecos a los pacientes este día.</Vacio>}
      {d && !d.festivo && <ResumenDia citas={d.citas} />}
      {d && !d.festivo && (
        <div className="tarjeta overflow-x-auto">
          <div className="grid min-w-[760px]" style={{ gridTemplateColumns: `64px repeat(${columnas.length}, minmax(150px, 1fr))` }}>
            <div className="sticky left-0 z-20 border-b border-[var(--borde)] bg-[var(--superficie)]" />
            {columnas.map((c) => (
              <div key={c.id} className="border-b border-l border-[var(--borde)] px-3 py-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {c.color && <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: c.color }} />}{c.nombre}
                </div>
                <div className="etiqueta mt-0.5">{c.citas.length} citas</div>
              </div>
            ))}
            <div className="sticky left-0 z-10 bg-[var(--superficie)] relative" style={{ height: (hasta - desde) * PX_MIN }}>
              {horas.map((m) => (
                <div key={m} className="absolute right-2 -translate-y-2 text-xs cifras" style={{ top: (m - desde) * PX_MIN, color: 'var(--texto-suave)' }}>{hhmm(m)}</div>
              ))}
            </div>
            {columnas.map((c) => (
              <div key={c.id} className="relative border-l border-[var(--borde)]" style={{ height: (hasta - desde) * PX_MIN }}>
                {horas.map((m) => <div key={m} className="absolute inset-x-0 border-t border-[var(--borde)]/70" style={{ top: (m - desde) * PX_MIN }} />)}
                {(d.abierto || []).length > 0 && [{ desde, hasta: d.abierto[0].desde }, { desde: d.abierto.at(-1).hasta, hasta }].map((z) => (
                  <div key={`c${z.desde}`} className="absolute inset-x-0 bg-[var(--superficie-2)]" style={{ top: (z.desde - desde) * PX_MIN, height: Math.max(0, z.hasta - z.desde) * PX_MIN }} />
                ))}
                {c.bloqueos.map((b) => (
                  <div key={`b${b.desde}`} className="rayado absolute inset-x-1 rounded-md text-[10px] px-2 py-1" style={{ top: (b.desde - desde) * PX_MIN, height: (b.hasta - b.desde) * PX_MIN, color: 'var(--texto-suave)' }}>Comida</div>
                ))}
                {(c.flotantes || []).map((f) => (
                  <div key={`f${f.desde}`} className="absolute inset-x-1 rounded-md border border-dashed border-oro/60 text-[10px] px-2 py-1" style={{ top: (f.desde - desde) * PX_MIN, height: (f.hasta - f.desde) * PX_MIN, color: 'var(--texto-suave)' }}>
                    Comida flotante · {f.duracion} min garantizados
                  </div>
                ))}
                {c.citas.map((ci) => {
                  const tono = TONOS[ci.familia] || '#76c3c7';
                  const prof = profesional(ci.profesionalId);
                  const estado = ESTADO_CITA[ci.estado] || ci.estado;
                  return (
                    <div key={ci.id} className="absolute inset-x-1" style={{ top: (ci.inicio - desde) * PX_MIN }}>
                      <button type="button" onClick={(e) => abrir(ci.id, e.currentTarget)} aria-haspopup="dialog"
                        aria-label={`${ci.paciente}, ${hhmm(ci.inicio)}, ${ci.tratamiento}: ${estado.toLowerCase()}. Abrir la cita`}
                        className="block w-full cursor-pointer overflow-hidden rounded-lg border bg-[var(--superficie)] px-2.5 py-1.5 text-left text-xs hover:outline hover:outline-oro/70"
                        style={estiloTarjeta(ci.estado, (ci.fin - ci.inicio) * PX_MIN - 2, tono)}>
                        <span className="flex items-center justify-between gap-1">
                          <span className="font-medium truncate">{ci.paciente}</span>
                          <span className="cifras shrink-0" style={{ color: 'var(--texto-suave)' }}>{hhmm(ci.inicio)}</span>
                        </span>
                        {ci.estado !== 'confirmada' && (
                          <span className={`flex items-center gap-1.5 truncate font-medium ${TINTA[ci.estado] || ''}`} style={TINTA[ci.estado] ? undefined : { color: 'var(--texto-suave)' }}>
                            <MarcaEstado estado={ci.estado} />{estado}
                          </span>
                        )}
                        <span className="block truncate" style={{ color: 'var(--texto-suave)' }}>{ci.tratamiento}</span>
                        {vista === 'cabina' && prof && (
                          <span className="flex items-center gap-1.5 truncate" style={{ color: 'var(--texto-suave)' }}>
                            <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: prof.color || 'var(--acento)' }} />{prof.nombre}
                          </span>
                        )}
                        {ci.origen === 'ia_whatsapp' && ci.estado !== 'retenida' && (
                          <span className="mt-0.5 flex items-center gap-1.5 truncate" style={{ color: 'var(--texto-suave)' }}>
                            <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rotate-45 bg-oro" />Reservada por la IA
                          </span>
                        )}
                      </button>
                      {vista === 'cabina' && ci.limpiezaHasta > ci.fin && (
                        <div className="rayado mx-1 rounded-b-md opacity-70" title="Limpieza y preparación de la cabina" style={{ height: (ci.limpiezaHasta - ci.fin) * PX_MIN }} />
                      )}
                    </div>
                  );
                })}
                {esHoy && ahora > desde && ahora < hasta && <div className="absolute inset-x-0 z-10 border-t-2 border-oro" style={{ top: (ahora - desde) * PX_MIN }} aria-label="Ahora" />}
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="mt-3 text-xs" style={{ color: 'var(--texto-suave)' }}>
        Franjas de 5 minutos. El rayado dorado es la limpieza de la cabina tras cada cita o la comida del profesional. Pulsa una cita para marcar si ha llegado, si se completó o si no vino. Se actualiza sola cada 15 segundos.
      </p>
      {abierta && <DetalleCita id={abierta} alCerrar={cerrar} alCambiar={recargar} />}
    </>
  );
}

// Lo que se programó (o se anuló) al marcar la cita, en palabras de recepción.
function resumen(r) {
  if (r.anulado) {
    const a = r.anulado;
    return [
      `Deshecho: la cita vuelve a «${ESTADO_CITA[r.estado] || r.estado}».`,
      a.resena?.anuladas ? 'La petición de reseña queda anulada.' : '',
      a.resena?.yaEnviada ? 'La petición de reseña ya había salido.' : '',
      a.secuencia === 'toca_repetir' ? 'Ya no se le avisará para repetir.' : '',
      a.secuencia === 'cancelacion' ? 'Ya no se le escribirá para recuperar la cita.' : '',
    ].filter(Boolean).join(' ');
  }
  const e = r.efectos || {};
  return [
    `Marcada como «${ESTADO_CITA[r.estado] || r.estado}».`,
    e.resena?.estado === 'programada' ? `Le pediremos su opinión ${cuando(e.resena.cuando)}.` : '',
    e.resena?.estado === 'omitida' ? `No se le pide reseña: ${e.resena.motivo}.` : '',
    e.resena?.error ? `No se pudo programar la reseña: ${e.resena.error}.` : '',
    e.tocaRepetir?.inscripcion ? `Le avisaremos para repetir ${cuando(e.tocaRepetir.primerMensaje)} (le toca hacia el ${fechaLarga(e.tocaRepetir.toca)}).` : '',
    e.tocaRepetir?.omitido ? `No se le avisa para repetir: ${e.tocaRepetir.omitido}.` : '',
    e.recuperar?.inscripcion ? `Le escribiremos para buscarle otro hueco ${cuando(e.recuperar.primerMensaje)}.` : '',
    e.recuperar?.omitido ? `No se le escribe para recuperarla: ${e.recuperar.omitido}.` : '',
    e.tocaRepetir?.error || e.recuperar?.error ? `No se pudo programar el mensaje: ${e.tocaRepetir?.error || e.recuperar?.error}.` : '',
  ].filter(Boolean).join(' ');
}

// «llegó a las 11:52», «a las 13:05»… (con el día si no fue el de la cita).
function momento(iso, fechaCita) {
  if (!iso) return '';
  const f = fmtFecha.format(new Date(iso));
  return `${f === fechaCita ? '' : `el ${diaLargo(f)} `}a las ${horaDe(iso)}`;
}

function detalleEstado(d) {
  if (d.estado === 'llegada' || d.estado === 'en_curso') return d.llegadaEn ? `Llegó ${momento(d.llegadaEn, d.fecha)}` : '';
  if (d.estado === 'completada') return d.completadaEn ? `Marcada ${momento(d.completadaEn, d.fecha)}` : '';
  if (d.estado === 'no_presentada') return d.noPresentadaEn ? `Marcado ${momento(d.noPresentadaEn, d.fecha)}` : '';
  return '';
}

function nadaQueMarcar(d) {
  if (d.estado === 'retenida') return 'El hueco está retenido: el paciente aún no lo ha confirmado.';
  if (d.estado === 'completada' || d.estado === 'no_presentada') return 'Ya está marcada. El rato para deshacerlo ha pasado.';
  return 'Ahora no hay nada que marcar en esta cita.';
}

// El detalle de una cita, con los botones que tocan según su estado y la hora. Es un diálogo
// nativo: atrapa el foco, se cierra con Esc (o fuera) y el foco vuelve a la tarjeta.
function DetalleCita({ id, alCerrar, alCambiar }) {
  const dialogo = useRef(null);
  const titulo = useRef(null);
  const { datos: d, error, recargar } = useDatos(`/panel/citas/${id}`, { cadaMs: 15000 });
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState(null);

  useEffect(() => {
    const dlg = dialogo.current;
    if (!dlg.open) {
      dlg.showModal();
      titulo.current?.focus();
    }
    dlg.addEventListener('close', alCerrar);
    return () => dlg.removeEventListener('close', alCerrar);
  }, [alCerrar]);

  const cambiar = async (cuerpo) => {
    setOcupado(true);
    setAviso(null);
    try {
      setAviso({ texto: resumen(await api(`/panel/citas/${id}/estado`, { metodo: 'POST', cuerpo })) });
      alCambiar();
    } catch (err) {
      setAviso({ texto: err.message, error: true });
    } finally {
      setOcupado(false);
      recargar();
    }
  };
  const suave = { color: 'var(--texto-suave)' };
  const hoy = hoyMadrid();

  return (
    <dialog ref={dialogo} aria-labelledby="cita-titulo" onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.close(); }}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl border filete bg-[var(--superficie)] p-0 text-[var(--texto)] shadow-2xl backdrop:bg-terciopelo-950/60">
      <header className="terciopelo overflow-hidden px-6 pt-5 pb-5 text-white">
        <div className="relative z-10">
          <p className="text-[10px] uppercase tracking-[.2em] text-white/60">
            {d ? `${d.fecha === hoy ? 'Hoy' : diaLargo(d.fecha)} · ${d.inicio}–${d.fin}` : 'Cita'}
          </p>
          {/* El foco entra por el título (así se lee a quién es la cita); no es un control: sin anillo. */}
          <h2 id="cita-titulo" ref={titulo} tabIndex={-1} className="titulo mt-1 text-2xl" style={{ outline: 'none' }}>{d?.paciente || 'Cargando…'}</h2>
          {d && <p className="mt-0.5 text-sm text-white/80">{d.tratamiento}</p>}
        </div>
      </header>
      {error && <div className="p-6"><Error texto={error} /></div>}
      {d && (
        <div className="px-6 py-5">
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt style={suave}>Estado</dt>
            <dd className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${PASTILLA[d.estado] || ''}`}>
                <MarcaEstado estado={d.estado} />{ESTADO_CITA[d.estado] || d.estado}
              </span>
              <span className="text-xs" style={suave}>{detalleEstado(d)}</span>
            </dd>
            <dt style={suave}>Hora</dt>
            <dd className="cifras">{d.inicio}–{d.fin}</dd>
            <dt style={suave}>Profesional</dt>
            <dd>{d.profesional || '—'}</dd>
            <dt style={suave}>Cabina</dt>
            <dd>{d.sala || '—'}</dd>
            {(d.origen === 'ia_whatsapp' || d.primeraVisita) && (
              <>
                <dt style={suave}>Origen</dt>
                <dd>{[d.origen === 'ia_whatsapp' && 'Reservada por la IA', d.primeraVisita && 'Primera visita'].filter(Boolean).join(' · ')}</dd>
              </>
            )}
          </dl>
          <p className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
            <a href={d.enlaceCita} target="_blank" rel="noreferrer" className="underline decoration-oro/60 underline-offset-4 hover:decoration-oro">
              Su página «Tu cita»<span className="sr-only"> (se abre en otra pestaña)</span><span aria-hidden="true"> ↗</span>
            </a>
            {d.conversacionId
              ? <a href={`#conversaciones/${d.conversacionId}`} className="underline decoration-oro/60 underline-offset-4 hover:decoration-oro">Su conversación</a>
              : <span style={suave}>Aún no tiene conversación de WhatsApp</span>}
          </p>
          <section className="mt-5 border-t border-[var(--borde)] pt-5" aria-labelledby="cita-marcar">
            <h3 id="cita-marcar" className="etiqueta">Qué ha pasado con la cita</h3>
            {d.acciones.length > 0 || d.deshacer ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {d.acciones.map((a, i) => (
                  <Boton key={a} variante={i === 0 ? 'lleno' : 'contorno'} disabled={ocupado} onClick={() => cambiar({ estado: a })}>{BOTON[a]}</Boton>
                ))}
                {d.deshacer && (
                  <Boton disabled={ocupado} onClick={() => cambiar({ deshacer: true })} aria-describedby="cita-deshacer">Deshacer «{d.deshacer.de}»</Boton>
                )}
              </div>
            ) : !d.espera && <p className="mt-2 text-sm" style={suave}>{nadaQueMarcar(d)}</p>}
            {d.deshacer && (
              <p id="cita-deshacer" className="mt-2 text-xs" style={suave}>
                Vuelve a «{d.deshacer.etiqueta}» y anula lo programado. Se puede hasta las {horaDe(d.deshacer.hasta)}.
              </p>
            )}
            {d.espera && <p className="mt-2 text-xs" style={suave}>{d.espera}.</p>}
            {aviso && (
              <p role={aviso.error ? 'alert' : 'status'} className={`mt-4 rounded-xl border px-3 py-2 text-sm ${aviso.error ? `border-rosa/60 ${ROSA}` : 'filete'}`}>
                {aviso.texto}
              </p>
            )}
          </section>
        </div>
      )}
      <footer className="flex justify-end border-t border-[var(--borde)] px-6 py-4">
        <Boton onClick={() => dialogo.current.close()}>Cerrar</Boton>
      </footer>
    </dialog>
  );
}
