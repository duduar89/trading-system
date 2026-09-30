import { useState } from 'react';
import { api, fechaHora } from '../api.js';
import { useDatos, Cabecera, Boton, Error, Vacio } from '../componentes/comunes.jsx';

const MOTIVO = {
  aplazamiento: 'Aplazó', ocupado: 'Estaba ocupado', recordatorio_oferta: 'Recordar oferta', pensar: 'Lo estaba pensando',
  duda: 'Tenía una duda', recordatorio: 'Recordatorio', cierre_sin_respuesta: 'Cierre si no contesta',
  sin_respuesta_a_cuando: 'No dijo cuándo', sin_respuesta_a_propuesta: 'No eligió hueco', precio_sin_oferta: 'Precio',
  precio_importe_alto: 'Precio (importe alto)', pregunta: 'Pregunta', evento: 'Tiene un evento', reserva: 'Quiere cita',
};

export default function Seguimientos() {
  const { datos, error, recargar } = useDatos('/panel/seguimientos', { cadaMs: 30000 });
  const [editando, setEditando] = useState(null);
  const [fecha, setFecha] = useState('');
  const [hora, setHora] = useState('11:30');
  if (error) return <Error texto={error} />;
  if (!datos) return null;
  const porDia = new Map();
  for (const s of datos) {
    const d = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(s.programado));
    (porDia.get(d) || porDia.set(d, []).get(d)).push(s);
  }
  const guardar = async (id, cuerpo) => { await api(`/panel/seguimientos/${id}`, { metodo: 'PATCH', cuerpo }); setEditando(null); recargar(); };
  return (
    <>
      <Cabecera antetitulo="La memoria de la repesca" titulo="Seguimientos programados" />
      {datos.length === 0 && <Vacio titulo="No hay seguimientos pendientes">Cuando un paciente diga «el mes que viene» o «cuando cobre», aparecerá aquí con su fecha y sus palabras.</Vacio>}
      <div className="space-y-6">
        {[...porDia.entries()].map(([dia, lista]) => (
          <section key={dia}>
            <h2 className="etiqueta mb-2 first-letter:uppercase">{dia}</h2>
            <ul className="tarjeta divide-y divide-[var(--borde)]">
              {lista.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <div className="min-w-0">
                    <div className="font-medium">{s.nombre || 'Contacto'} <span className="text-sm font-normal" style={{ color: 'var(--texto-suave)' }}>· {MOTIVO[s.motivo] || s.motivo}{s.tratamiento ? ` · ${s.tratamiento}` : ''}</span></div>
                    {s.frase && <div className="mt-0.5 text-sm italic" style={{ color: 'var(--texto-suave)' }}>«{s.frase}»</div>}
                    <div className="mt-0.5 text-xs cifras" style={{ color: 'var(--texto-suave)' }}>{fechaHora(s.programado)} · {s.creadoPor === 'persona' ? 'cambiado a mano' : 'fecha calculada por el sistema'}</div>
                  </div>
                  {editando === s.id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <input aria-label="Fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="rounded-full border border-[var(--borde)] bg-transparent px-3 py-1.5 text-sm" />
                      <input aria-label="Hora" type="time" value={hora} onChange={(e) => setHora(e.target.value)} className="rounded-full border border-[var(--borde)] bg-transparent px-3 py-1.5 text-sm" />
                      <Boton variante="lleno" disabled={!fecha} onClick={() => guardar(s.id, { fecha, hora })}>Guardar</Boton>
                      <Boton onClick={() => setEditando(null)}>Volver</Boton>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      {s.conversacionId && <a href={`#conversaciones/${s.conversacionId}`} className="rounded-full border border-[var(--borde)] px-4 py-2 text-sm hover:border-oro">Ver chat</a>}
                      <Boton onClick={() => { setEditando(s.id); setFecha(''); }}>Cambiar fecha</Boton>
                      <Boton onClick={() => guardar(s.id, { cancelar: true })}>Cancelar</Boton>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
