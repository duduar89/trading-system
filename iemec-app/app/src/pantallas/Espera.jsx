import { useState } from 'react';
import { api, fechaHora } from '../api.js';
import { useDatos, Cabecera, Cifra, Boton, Error, Vacio } from '../componentes/comunes.jsx';

// Lista de espera: quién espera un hueco, los que se le están guardando ahora mismo (30 minutos para
// contestar por WhatsApp) y lo que pasó con los últimos. Recepción apunta y quita desde aquí, y
// resuelve una oferta cuando su conversación la lleva una persona (la IA ya no lee su «sí»).
const FRANJA = { manana: 'Por la mañana', tarde: 'Por la tarde' };
const OFERTA = {
  ofrecida: ['Esperando su respuesta', 'bg-oro/20 text-[#7a5a1f] dark:text-champan'],
  aceptada: ['Aceptada: cita confirmada', 'bg-aqua text-terciopelo-800'],
  rechazada: ['No le venía bien', 'bg-[var(--superficie-2)] text-[var(--texto-suave)]'],
  caducada: ['Sin respuesta', 'bg-[var(--superficie-2)] text-[var(--texto-suave)]'],
  anulada: ['Anulada', 'bg-[var(--superficie-2)] text-[var(--texto-suave)]'],
};
const fmtDia = new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
const dia = (f) => fmtDia.format(new Date(`${f}T12:00:00Z`));
const minutosHasta = (d) => Math.max(0, Math.round((new Date(d) - Date.now()) / 60000));
const suave = { color: 'var(--texto-suave)' };

function EstadoOferta({ estado }) {
  const [texto, clase] = OFERTA[estado] || [estado, ''];
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${clase}`}>{texto}</span>;
}

function fechas(e) {
  return e.hasta ? `Del ${dia(e.desde)} al ${dia(e.hasta)}` : `Desde el ${dia(e.desde)}`;
}

export default function Espera() {
  const { datos: d, error, recargar } = useDatos('/panel/lista-espera', { cadaMs: 30000 });
  const [alta, setAlta] = useState(false);
  const [aviso, setAviso] = useState('');
  if (error) return <Error texto={error} />;
  if (!d) return null;
  const enCurso = d.ofertas.filter((o) => o.estado === 'ofrecida');
  const ultimas = d.ofertas.filter((o) => o.estado !== 'ofrecida').slice(0, 12);
  const quitar = async (e) => {
    if (!window.confirm(`¿Quitar a ${e.paciente} de la lista de espera?`)) return;
    await api(`/panel/lista-espera/${e.id}`, { metodo: 'DELETE' });
    recargar();
  };
  // Recepción ha hablado con el paciente: dice que sí (se le confirma y le llega su cita) o que no
  // (el hueco pasa al siguiente).
  const resolver = async (o, accion) => {
    const pregunta = accion === 'aceptar'
      ? `¿Confirmar a ${o.paciente} el hueco del ${fechaHora(o.inicio)}?${o.cambia ? ` Su cita del ${fechaHora(o.cambia)} quedará anulada.` : ''} Le llegará su cita por WhatsApp.`
      : `¿Soltar el hueco del ${fechaHora(o.inicio)}? Pasará al siguiente de la lista y ${o.paciente} seguirá esperando.`;
    if (!window.confirm(pregunta)) return;
    setAviso('');
    try {
      await api(`/panel/lista-espera/ofertas/${o.id}/${accion}`, { metodo: 'POST' });
    } catch (err) {
      setAviso(err.message);
    }
    recargar();
  };
  return (
    <>
      <Cabecera antetitulo="Huecos que no se pierden" titulo="Lista de espera">
        <Boton variante={alta ? 'contorno' : 'lleno'} onClick={() => setAlta(!alta)} aria-expanded={alta}>{alta ? 'Cerrar' : 'Apuntar a alguien'}</Boton>
      </Cabecera>
      <p className="mb-6 max-w-2xl text-sm" style={suave}>
        Cuando se cancela o se cambia una cita, el hueco se le guarda 30 minutos al primero de la lista que encaja (mismo tratamiento, sus fechas y su franja) y le llega por WhatsApp. Si no lo quiere o no contesta, pasa al siguiente. De noche no se escribe.
      </p>
      {alta && <Alta tratamientos={d.tratamientos} alGuardar={(r) => { setAlta(false); setAviso(r?.paciente ? `Apuntado en la lista: ${r.paciente}.` : ''); recargar(); }} />}
      {aviso && <p role="status" className="mb-6 text-sm">{aviso}</p>}

      <section className="grid gap-4 sm:grid-cols-3">
        <Cifra etiqueta="Esperando" valor={d.cifras.esperando} detalle="pacientes en la lista" />
        <Cifra etiqueta="Huecos guardados ahora" valor={d.cifras.enCurso} detalle="esperando su «sí»" />
        <Cifra etiqueta="Huecos recuperados" valor={d.cifras.recuperados30d} detalle="en los últimos 30 días" tono="oro" />
      </section>

      {enCurso.length > 0 && (
        <section className="mt-8">
          <h2 className="etiqueta mb-3">Ofertas en curso</h2>
          <ul className="tarjeta divide-y divide-[var(--borde)]">
            {enCurso.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <div className="font-medium">{o.paciente} <span className="text-sm font-normal" style={suave}>· {o.tratamiento}</span></div>
                  <div className="mt-0.5 text-sm cifras" style={suave}>Hueco del {fechaHora(o.inicio)} · se lo guardamos {minutosHasta(o.caduca)} min más</div>
                  {o.cambia && <div className="mt-0.5 text-xs" style={suave}>Si lo acepta, se le cambia su cita del {fechaHora(o.cambia)}.</div>}
                  {o.conPersona && <div className="mt-0.5 text-xs text-rosa">Su conversación la lleva una persona: la IA no lee su respuesta. Acéptalo o suéltalo según lo que te diga.</div>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <EstadoOferta estado={o.estado} />
                  <Boton onClick={() => resolver(o, 'aceptar')}>Dice que sí</Boton>
                  <Boton onClick={() => resolver(o, 'rechazar')}>Soltar</Boton>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8">
        <h2 className="etiqueta mb-3">Quién espera</h2>
        {d.entradas.length === 0 ? (
          <Vacio titulo="Nadie en la lista de espera">Cuando un paciente no encuentra hueco, la IA le ofrece apuntarse; recepción también puede apuntarle desde aquí.</Vacio>
        ) : (
          <ol className="tarjeta divide-y divide-[var(--borde)]">
            {d.entradas.map((e, i) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="flex min-w-0 items-start gap-4">
                  <span aria-hidden="true" className="titulo cifras w-6 shrink-0 text-2xl text-oro" style={{ fontStyle: 'normal' }}>{i + 1}</span>
                  <div className="min-w-0">
                    <div className="font-medium">{e.paciente} <span className="text-sm font-normal cifras" style={suave}>· ···{e.telefonoFinal}</span></div>
                    <div className="mt-0.5 text-sm">{e.tratamiento}</div>
                    <div className="mt-0.5 text-xs" style={suave}>
                      {fechas(e)} · {FRANJA[e.franja] || 'A cualquier hora'} · {e.origen === 'whatsapp' ? 'Se apuntó por WhatsApp' : 'Apuntado en recepción'}
                    </div>
                    {e.citaActual && <div className="mt-0.5 text-xs" style={suave}>Quiere adelantar su cita del {fechaHora(e.citaActual)}: se le ofrece solo un hueco antes (y se le cambia).</div>}
                    {e.notas && <div className="mt-0.5 text-xs italic" style={suave}>«{e.notas}»</div>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {e.estado === 'ofrecido' && <EstadoOferta estado="ofrecida" />}
                  <Boton onClick={() => quitar(e)}>Quitar</Boton>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {ultimas.length > 0 && (
        <section className="mt-8">
          <h2 className="etiqueta mb-3">Últimas ofertas</h2>
          <ul className="tarjeta divide-y divide-[var(--borde)]">
            {ultimas.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                <span className="min-w-0">{o.paciente} <span style={suave}>· {o.tratamiento} · hueco del {fechaHora(o.inicio)}</span></span>
                <EstadoOferta estado={o.estado} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

// Apuntar a alguien: por su móvil (si no tiene ficha, se crea con su nombre). Si el móvil es de otra
// persona que la que se ha tecleado, se pide confirmarlo antes (el aviso le llegaría a ella).
function Alta({ tratamientos, alGuardar }) {
  const [f, setF] = useState({ telefono: '', nombre: '', tratamientoId: '', desde: '', hasta: '', franja: '', notas: '', adelantar: false });
  const [aviso, setAviso] = useState('');
  const [otra, setOtra] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const cambiar = (k) => (ev) => { setOtra(null); setF({ ...f, [k]: ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value }); };
  const guardar = async (confirmado = false) => {
    setAviso('');
    setGuardando(true);
    try {
      alGuardar(await api('/panel/lista-espera', { metodo: 'POST', cuerpo: { ...f, confirmado } }));
    } catch (err) {
      setAviso(err.message);
      setOtra(err.codigo === 'OTRO_PACIENTE' ? err.message : null);
    } finally {
      setGuardando(false);
    }
  };
  const enviar = (ev) => { ev.preventDefault(); guardar(false); };
  const campo = 'w-full min-w-0 rounded-full border border-[var(--borde)] bg-transparent px-4 py-2 text-sm';
  return (
    <form onSubmit={enviar} className="tarjeta mb-6 grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
      <label className="grid min-w-0 gap-1.5">
        <span className="etiqueta">Móvil</span>
        <input required inputMode="tel" autoComplete="off" placeholder="611 22 33 44" value={f.telefono} onChange={cambiar('telefono')} className={campo} />
      </label>
      <label className="grid min-w-0 gap-1.5">
        <span className="etiqueta">Nombre</span>
        <input autoComplete="off" value={f.nombre} onChange={cambiar('nombre')} className={campo} />
      </label>
      <label className="grid min-w-0 gap-1.5">
        <span className="etiqueta">Tratamiento</span>
        <select required value={f.tratamientoId} onChange={cambiar('tratamientoId')} className={campo}>
          <option value="">Elige…</option>
          {tratamientos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
        </select>
      </label>
      <label className="grid min-w-0 gap-1.5">
        <span className="etiqueta">Desde</span>
        <input type="date" value={f.desde} onChange={cambiar('desde')} className={campo} />
      </label>
      <label className="grid min-w-0 gap-1.5">
        <span className="etiqueta">Hasta (opcional)</span>
        <input type="date" value={f.hasta} onChange={cambiar('hasta')} className={campo} />
      </label>
      <label className="grid min-w-0 gap-1.5">
        <span className="etiqueta">Franja</span>
        <select value={f.franja} onChange={cambiar('franja')} className={campo}>
          <option value="">A cualquier hora</option>
          <option value="manana">Por la mañana</option>
          <option value="tarde">Por la tarde</option>
        </select>
      </label>
      <label className="flex min-w-0 items-start gap-2 text-sm sm:col-span-2 lg:col-span-3">
        <input type="checkbox" checked={f.adelantar} onChange={cambiar('adelantar')} className="mt-0.5 h-4 w-4 shrink-0 accent-[#123f3e]" />
        <span>Ya tiene cita de este tratamiento y quiere adelantarla <span style={suave}>(se le ofrecerá solo un hueco antes y, si lo acepta, se le cambia)</span></span>
      </label>
      <label className="grid min-w-0 gap-1.5 sm:col-span-2 lg:col-span-3">
        <span className="etiqueta">Notas para recepción</span>
        <input maxLength={255} value={f.notas} onChange={cambiar('notas')} placeholder="Sin datos de salud" className={campo} />
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-3">
        <Boton variante="lleno" type="submit" disabled={guardando || !f.telefono.trim() || !f.tratamientoId}>{guardando ? 'Apuntando…' : 'Apuntar en la lista'}</Boton>
        {otra && <Boton onClick={() => guardar(true)} disabled={guardando}>Sí, es esa persona: apuntarla</Boton>}
        {aviso && <span role="alert" className="text-sm text-rosa">{aviso}</span>}
      </div>
    </form>
  );
}
