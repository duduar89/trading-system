import { useMemo, useState } from 'react';
import { useDatos, Cabecera, Boton, Error, Vacio } from '../componentes/comunes.jsx';
import { diaLargo, hhmm, hoyMadrid, sumarDias } from '../api.js';

const PX_MIN = 1.5;
const TONOS = {
  facial: '#c48981', corporal: '#d9bf8f', medicina_capilar: '#5e8c8f', cirugia_capilar: '#304e50', head_spa: '#76c3c7',
  perdida_peso: '#8fb8a8', ginecoestetica: '#b7a1c9', sexualidad_masculina: '#6f7fa8', cirugia_estetica: '#1d5b58', estetica_avanzada: '#e3c9a8',
};

function ahoraMin() {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  return Number(p.find((x) => x.type === 'hour').value) * 60 + Number(p.find((x) => x.type === 'minute').value);
}

export default function Agenda() {
  const [fecha, setFecha] = useState(hoyMadrid());
  const [vista, setVista] = useState('cabina');
  const { datos: d, error } = useDatos(`/panel/agenda?fecha=${fecha}`, { cadaMs: 15000 });

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
                  return (
                    <div key={ci.id} className="absolute inset-x-1" style={{ top: (ci.inicio - desde) * PX_MIN }}>
                      <div className="rounded-lg border bg-[var(--superficie)] px-2.5 py-1.5 text-xs shadow-sm overflow-hidden"
                        style={{ height: (ci.fin - ci.inicio) * PX_MIN - 2, borderColor: tono, boxShadow: `inset 3px 0 0 ${tono}` }}>
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-medium truncate">{ci.paciente}</span>
                          <span className="cifras shrink-0" style={{ color: 'var(--texto-suave)' }}>{hhmm(ci.inicio)}</span>
                        </div>
                        <div className="truncate" style={{ color: 'var(--texto-suave)' }}>{ci.tratamiento}</div>
                        {vista === 'cabina' && prof && (
                          <div className="flex items-center gap-1.5 truncate" style={{ color: 'var(--texto-suave)' }}>
                            <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: prof.color || 'var(--acento)' }} />{prof.nombre}
                          </div>
                        )}
                        {(ci.estado === 'retenida' || ci.origen === 'ia_whatsapp') && (
                          <div className="mt-0.5 flex items-center gap-1.5 truncate" style={{ color: 'var(--texto-suave)' }}>
                            <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rotate-45 bg-oro" />{ci.estado === 'retenida' ? 'Hueco retenido' : 'Reservada por la IA'}
                          </div>
                        )}
                      </div>
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
        Franjas de 5 minutos. El rayado dorado es la limpieza de la cabina tras cada cita o la comida del profesional. Se actualiza sola cada 15 segundos.
      </p>
    </>
  );
}
