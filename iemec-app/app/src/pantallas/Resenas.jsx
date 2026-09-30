import { useState } from 'react';
import { api, fechaHora } from '../api.js';
import { useDatos, Cabecera, Cifra, Boton, Error } from '../componentes/comunes.jsx';
import Barras from '../componentes/Barras.jsx';

// Reseñas de Google: los KPI de la ficha, las alertas clínicas (para dirección médica), lo que hay que
// contestar (siempre lo aprueba una persona), el historial que sale poco a poco y la prueba del
// momento de pedir. El texto y el autor de cada reseña se borran a los 29 días (norma de Google: 30
// como mucho). Las etiquetas «Sin responder» y «Respuesta publicada» las buscan las pruebas del panel.

const TEMA = {
  trato: 'Trato', profesionalidad: 'Profesionalidad', resultados: 'Resultados', instalaciones: 'Instalaciones', precio: 'Precio',
  espera_puntualidad: 'Espera o puntualidad', dolor_comodidad: 'Dolor o comodidad', atencion_recepcion: 'Recepción', seguimiento: 'Seguimiento',
};
const MODERACION = {
  pendiente: ['Google la está revisando', 'bg-[var(--superficie-2)] text-[var(--texto-suave)]'],
  aprobada: ['Publicada en Google', 'bg-aqua text-terciopelo-800'],
  rechazada: ['Google la ha rechazado', 'bg-rosa/20 text-rosa'],
};
const MOTIVO = {
  PERSONAL_INFO: 'datos personales', REPETITIVE: 'repetida', ADVERTISING_AND_SOLICITATION: 'publicidad',
  REGULATED_GOODS_AND_SERVICES: 'productos regulados', FAKE_ENGAGEMENT: 'interacción falsa',
};
const CHIP = 'rounded-full px-2.5 py-0.5 text-xs font-medium';

const numero = (n, decimales = 1) => (n == null ? '—' : Number(n).toLocaleString('es-ES', { maximumFractionDigits: decimales }));
const porciento = (n) => (n == null ? '—' : `${n} %`);
const horas = (h) => (h == null ? '—' : h < 48 ? `${numero(h)} h` : `${numero(h / 24)} días`);
const diaCorto = (f) => new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${f}T12:00:00Z`));
const plural = (n, una, varias) => `${n} ${n === 1 ? una : varias}`;
const cuantas = (n) => plural(n, 'reseña', 'reseñas');

const Estrellas = ({ n }) => <span role="img" aria-label={`${n} de 5 estrellas`} className="text-oro tracking-wider">{'★'.repeat(n)}<span className="opacity-25">{'★'.repeat(5 - n)}</span></span>;

// Reseñas por semana: una columna por semana (la última va en curso, más clara). Al pasar o al
// enfocar una columna se lee su cifra; la tabla es para lectores de pantalla.
function Semanas({ semanas }) {
  const [activa, setActiva] = useState(null);
  const pico = Math.max(0, ...semanas.map((s) => s.resenas));
  const escala = Math.max(1, pico);
  const ultima = semanas.length - 1;
  const texto = (s, i) => `${i === ultima ? 'Esta semana (en curso)' : `Semana del ${diaCorto(s.semana)}`}: ${cuantas(s.resenas)}`;
  return (
    <figure className="tarjeta p-5 min-w-0">
      <figcaption className="etiqueta">Reseñas por semana · últimas 12</figcaption>
      <p className="mt-1 text-sm cifras" aria-hidden="true" style={{ color: 'var(--texto-suave)', minHeight: '1.25rem' }}>
        {activa != null ? texto(semanas[activa], activa) : pico ? `Pico: ${cuantas(pico)} en una semana. Mejor constante, sin picos.` : 'Sin reseñas en estas 12 semanas.'}
      </p>
      <div className="mt-3 flex h-32 items-end gap-[2px] border-b border-[var(--borde)]" onMouseLeave={() => setActiva(null)}>
        {semanas.map((s, i) => (
          <div key={s.semana} tabIndex={0} aria-label={texto(s, i)} title={texto(s, i)}
            className="flex h-full flex-1 cursor-default items-end justify-center outline-offset-0"
            onMouseEnter={() => setActiva(i)} onFocus={() => setActiva(i)} onBlur={() => setActiva(null)}>
            <div className="w-full max-w-6 rounded-t-[4px] transition-opacity"
              style={{ height: `${s.resenas ? Math.max(3, (s.resenas / escala) * 100) : 0}%`, background: 'var(--acento)', opacity: i === ultima ? 0.5 : activa === i ? 0.8 : 1 }} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-xs" style={{ color: 'var(--texto-suave)' }}>
        <span>{diaCorto(semanas[0].semana)}</span><span>esta semana</span>
      </div>
      <table className="sr-only">
        <caption>Reseñas por semana</caption>
        <tbody>{semanas.map((s, i) => <tr key={s.semana}><th scope="row">{i === ultima ? 'Esta semana' : `Semana del ${diaCorto(s.semana)}`}</th><td>{s.resenas}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

// La respuesta que se ve en Google, con su estado de moderación.
function RespuestaPublicada({ r, nota }) {
  return (
    <div className="mt-3 rounded-xl border filete p-3 text-sm">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="etiqueta">Respuesta publicada</span>
        {MODERACION[r.moderacion] && <span className={`${CHIP} ${MODERACION[r.moderacion][1]}`}>{MODERACION[r.moderacion][0]}</span>}
      </div>
      {r.respuesta}
      {nota && <p className="mt-2 text-rosa">{nota}</p>}
    </div>
  );
}

function Resena({ r, texto, onTexto, onPublicar, onAsociar, ocupado }) {
  const quien = r.autor || (r.contenidoBorrado ? 'Autor borrado a los 29 días' : 'Sin nombre');
  // Por contestar: sin respuesta, la que su autor cambió después de contestarla y la aprobada que no sale.
  const porContestar = ['nueva', 'borrador', 'historial'].includes(r.estado) || r.reintentar;
  const reabierta = r.respuestaPublica && r.estado !== 'publicada';
  const boton = r.estado === 'aprobada' ? 'Aprobar otra vez (sale por turno)' : r.historial ? 'Aprobar (sale por turno)' : 'Aprobar y publicar';
  return (
    <li className="tarjeta p-5" style={r.alerta && r.alertaAbierta ? { borderLeft: '4px solid var(--color-rosa)' } : undefined}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{quien}</span><Estrellas n={r.nota} />
          {r.alerta && <span className={`${CHIP} bg-rosa/20 text-rosa`}>Alerta clínica · dirección médica</span>}
          {r.historial && <span className={`${CHIP} bg-[var(--superficie-2)]`}>Historial</span>}
          {r.dePaciente && <span className={`${CHIP} bg-[var(--superficie-2)] font-normal`}>De un paciente: no se le vuelve a pedir</span>}
        </div>
        <span className="text-xs" style={{ color: 'var(--texto-suave)' }}>{fechaHora(r.publicada)}{r.prioridad === 'alta' && !r.alerta ? ' · prioridad alta' : ''}</span>
      </div>
      {r.texto ? <p className="mt-2 text-sm">{r.texto}</p>
        : r.contenidoBorrado && r.conTexto ? <p className="mt-2 text-sm italic" style={{ color: 'var(--texto-suave)' }}>Texto borrado a los 29 días (norma de Google: 30 como mucho).</p> : null}
      {r.temas?.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">{r.temas.map((t) => <span key={t} className={`${CHIP} bg-[var(--superficie-2)] font-normal`}>{TEMA[t] || t}</span>)}</div>
      )}
      {r.candidatos?.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span style={{ color: 'var(--texto-suave)' }}>¿Es de un paciente? Si lo es, no se le vuelve a pedir:</span>
          {r.candidatos.map((c) => (
            <Boton key={c.id} disabled={ocupado} onClick={() => onAsociar(c)}>{c.nombre} · cita del {diaCorto(c.cita)}{c.abrioEnlace ? ' · abrió el enlace' : ''}</Boton>
          ))}
        </div>
      )}

      {r.estado === 'publicada' && <RespuestaPublicada r={r} />}
      {reabierta && <RespuestaPublicada r={r} nota="La reseña ha cambiado después de contestarla: esta respuesta sigue en Google hasta que se apruebe otra, que la sustituye." />}
      {r.estado === 'aprobada' && (
        <div className="mt-3 rounded-xl border border-[var(--borde)] p-3 text-sm">
          <div className="etiqueta mb-1">Aprobada · sale {fechaHora(r.publicarEn)} (el historial, poco a poco)</div>
          {r.respuesta}
          {r.errorPublicar && <p role="alert" className="mt-2 text-rosa">No se ha podido publicar: {r.errorPublicar}. Se reintenta sola unas veces; si no sale, vuelve a la bandeja. También se puede aprobar otra vez.</p>}
        </div>
      )}
      {porContestar && (
        <div className="mt-3">
          {r.moderacion === 'rechazada' && (
            <p className="mb-2 text-sm text-rosa">Google rechazó la respuesta anterior{r.motivoRechazo ? ` (${MOTIVO[r.motivoRechazo] || r.motivoRechazo})` : ''}: esta es otra, distinta.</p>
          )}
          {r.estado !== 'aprobada' && r.errorPublicar && <p className="mb-2 text-sm text-rosa">{r.errorPublicar}. Revísala y apruébala otra vez.</p>}
          <label className="etiqueta" htmlFor={`r-${r.id}`}>Respuesta propuesta (breve, sin datos de salud, del equipo ni fechas)</label>
          <textarea id={`r-${r.id}`} rows={3} value={texto} onChange={(e) => onTexto(e.target.value)} readOnly={!r.puedeContestar}
            className="mt-1 w-full rounded-xl border border-[var(--borde)] bg-transparent px-3 py-2 text-sm" />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {r.puedeContestar
              ? <Boton variante="lleno" disabled={ocupado || !texto.trim()} onClick={onPublicar}>{boton}</Boton>
              : <span className="text-sm text-rosa">{r.alerta ? 'La contesta dirección médica' : 'La aprueba dirección o marketing'}: con tu rol no se puede aprobar.</span>}
            {r.alerta && r.puedeContestar && <span className="text-xs" style={{ color: 'var(--texto-suave)' }}>La decide dirección médica.</span>}
          </div>
        </div>
      )}
    </li>
  );
}

function Seccion({ titulo, detalle, children }) {
  return (
    <section className="mt-8">
      <h2 className="etiqueta mb-1">{titulo}</h2>
      {detalle && <p className="mb-3 text-sm" style={{ color: 'var(--texto-suave)' }}>{detalle}</p>}
      <ul className="space-y-3">{children}</ul>
    </section>
  );
}

export default function Resenas() {
  const { datos: d, error, recargar } = useDatos('/panel/resenas');
  const [textos, setTextos] = useState({});
  const [aviso, setAviso] = useState(null);
  const [ocupado, setOcupado] = useState(null);
  if (error) return <Error texto={error} />;
  if (!d) return null;
  const m = d.metricas;
  const p = m.peticiones;
  // Lo que hay en la caja: lo que se ha escrito, o el borrador (en una aprobada que no sale, lo aprobado).
  const texto = (r) => textos[r.id] ?? (r.estado === 'aprobada' ? r.respuesta : r.borrador) ?? '';
  const publicar = async (r) => {
    setAviso(null);
    setOcupado(r.id);
    try {
      const hecho = await api(`/panel/resenas/${r.id}/publicar`, { metodo: 'POST', cuerpo: { texto: texto(r) } });
      const extra = hecho.avisos?.length ? ` Ojo: ${hecho.avisos.join(' ')}` : '';
      setAviso({ ok: true, texto: `${hecho.estado === 'aprobada' ? `Aprobada: sale ${fechaHora(hecho.publicarEn)}.` : 'Respuesta publicada.'}${extra}` });
      recargar();
    } catch (err) {
      setAviso({ ok: false, texto: err.message });
    } finally {
      setOcupado(null);
    }
  };
  const asociar = async (r, c) => {
    setAviso(null);
    setOcupado(r.id);
    try {
      await api(`/panel/resenas/${r.id}/paciente`, { metodo: 'POST', cuerpo: { pacienteId: c.id } });
      setAviso({ ok: true, texto: `Anotado: la reseña es de ${c.nombre}. No se le vuelve a pedir.` });
      recargar();
    } catch (err) {
      setAviso({ ok: false, texto: err.message });
    } finally {
      setOcupado(null);
    }
  };
  const tarjeta = (r) => (
    <Resena key={r.id} r={r} texto={texto(r)} ocupado={ocupado === r.id}
      onTexto={(v) => setTextos({ ...textos, [r.id]: v })} onPublicar={() => publicar(r)} onAsociar={(c) => asociar(r, c)} />
  );
  const fallidas = d.peticionesFallidas || { n: 0 };
  const alertas = d.resenas.filter((r) => r.alerta && r.alertaAbierta);
  const resto = d.resenas.filter((r) => !(r.alerta && r.alertaAbierta));
  const porContestar = resto.filter((r) => ['nueva', 'borrador'].includes(r.estado) && !r.historial);
  const delHistorial = resto.filter((r) => ['nueva', 'borrador'].includes(r.estado) && r.historial);
  const enCola = resto.filter((r) => r.estado === 'aprobada');
  const contestadas = resto.filter((r) => r.estado === 'publicada');
  const h = d.historial;

  return (
    <>
      <Cabecera antetitulo="Google Business Profile" titulo="Reseñas y ficha de Google">
        <span className={`${CHIP} ${d.ficha.enlaceOficial ? 'bg-aqua text-terciopelo-800' : 'bg-[var(--superficie-2)] text-[var(--texto-suave)]'}`}
          title={d.ficha.leidaEn ? `Ficha leída ${fechaHora(d.ficha.leidaEn)}` : 'La ficha aún no se ha leído de Google'}>
          {d.ficha.enlaceOficial ? 'Enlace oficial de la ficha' : 'Enlace de reserva (writereview)'}
        </span>
        <span className={`${CHIP} bg-[var(--superficie-2)] text-[var(--texto-suave)]`} title="Las normas de Google permiten guardarlo 30 días como mucho">Texto de Google: 29 días</span>
      </Cabecera>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Cifras de la ficha">
        <Cifra etiqueta="Nota de 90 días" valor={numero(m.nota90, 2)} tono="oro"
          detalle={`${numero(m.notaTotal, 2)} en total · ${cuantas(m.total)} · objetivo ≥ 4,8`} />
        <Cifra etiqueta="Reseñas en 14 días" valor={m.resenas14} detalle={`${cuantas(m.resenas90)} en 90 días`} />
        <Cifra etiqueta="Tasa de respuesta · 90 días" valor={porciento(m.tasaRespuesta)} tono={m.tasaRespuestaConTexto != null && m.tasaRespuestaConTexto < 100 ? 'alerta' : 'normal'}
          detalle={`Con texto: ${porciento(m.tasaRespuestaConTexto)} · objetivo 100 %`} />
        <Cifra etiqueta="Tiempo de respuesta" valor={horas(m.horasRespuesta)}
          detalle={`Mediana · las de 1-2 ★: ${horas(m.horasRespuestaNegativas)} (objetivo: el mismo día)`} />
        <Cifra etiqueta="Rechazadas por Google" valor={m.rechazadas} tono={m.rechazadas ? 'alerta' : 'normal'}
          detalle={`${porciento(m.tasaRechazo)} de ${plural(m.respuestas90, 'respuesta', 'respuestas')} en 90 días · objetivo 0`} />
        <Cifra etiqueta="Conversión de peticiones" valor={p.porCada100 == null ? '—' : `${p.porCada100} / 100`}
          detalle={`${plural(p.enviadas, 'petición enviada', 'peticiones enviadas')} · ${p.abiertas} abrieron el enlace (${porciento(p.tasaApertura)}) · ${cuantas(p.resenasNuevas)} en los 14 días siguientes`} />
        <Cifra etiqueta="Sin responder" valor={m.porResponder} tono={m.porResponder ? 'alerta' : 'normal'}
          detalle={`Recientes, con borrador para aprobar${alertas.length ? ` · ${alertas.length} con alerta clínica` : ''}`} />
        <Cifra etiqueta="Historial por contestar" valor={h.pendientes + h.enBandeja}
          detalle={`${h.enBandeja} en la bandeja hoy · ${h.enCola} en cola · ${h.publicadasHoy} publicadas hoy (máx. ${h.cupo} al día)`} />
      </section>
      {fallidas.n > 0 && (
        <p className="mt-4 text-sm text-rosa">
          {fallidas.n === 1 ? '1 petición de reseña no ha salido' : `${fallidas.n} peticiones de reseña no han salido`} en 90 días (no cuentan en las cifras).
          {fallidas.motivo ? ` La última: ${fallidas.motivo}.` : ''}
        </p>
      )}

      <section className="mt-6 grid gap-4 xl:grid-cols-3">
        <Semanas semanas={m.porSemana} />
        <Barras titulo={`Temas del mes · ${cuantas(m.conTextoMes)} con texto`} formato={(v) => `${v} %`}
          filas={m.temasMes.map((t) => ({ etiqueta: TEMA[t.tema] || t.tema, valor: t.pct }))} vacio="Sin reseñas con texto en el último mes" />
        <div className="min-w-0">
          <Barras titulo="Momento de pedir · abrieron el enlace (antes del recordatorio)" formato={(v) => `${v} %`}
            filas={m.variantes.filter((v) => v.enviadas).map((v) => ({ etiqueta: `${v.nombre} (${v.enviadas})`, valor: v.tasa }))}
            vacio="Aún no ha salido ninguna petición en estos 90 días" />
          <p className="mt-2 px-1 text-xs" style={{ color: 'var(--texto-suave)' }}>
            En prueba: {d.momentos.map((x) => x.nombre).join(' · ')}. Un recordatorio a los 7-9 días, igual para todos: {p.recordatorios} enviados, {p.abiertasTrasRecordatorio} abrieron después.
          </p>
        </div>
      </section>

      {aviso && <p role={aviso.ok ? 'status' : 'alert'} className={`mt-6 text-sm ${aviso.ok ? '' : 'text-rosa'}`}>{aviso.texto}</p>}

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0">
          {alertas.length > 0 && (
            <Seccion titulo="Alertas clínicas · para dirección médica" detalle="Hablan de una posible complicación o de una reclamación. Tienen su tarea urgente: no las contesta marketing.">
              {alertas.map(tarjeta)}
            </Seccion>
          )}
          <Seccion titulo={`Por contestar · ${porContestar.length}`} detalle="Siempre las aprueba una persona. Mejor el mismo día; las de 1-2 estrellas, antes.">
            {porContestar.length ? porContestar.map(tarjeta) : <li className="tarjeta p-5 text-sm" style={{ color: 'var(--texto-suave)' }}>Nada por contestar.</li>}
          </Seccion>
          {delHistorial.length > 0 && (
            <Seccion titulo={`Historial de hoy · ${delHistorial.length}`} detalle={`Reseñas antiguas sin respuesta, unas ${h.cupo} al día. Al aprobarlas salen por turno, una cada 25 minutos.`}>
              {delHistorial.map(tarjeta)}
            </Seccion>
          )}
          {enCola.length > 0 && <Seccion titulo={`En cola · ${enCola.length}`}>{enCola.map(tarjeta)}</Seccion>}
          {contestadas.length > 0 && <Seccion titulo="Contestadas · últimos 60 días">{contestadas.map(tarjeta)}</Seccion>}
        </div>
        <aside className="tarjeta mt-8 p-5 self-start">
          <h2 className="titulo text-xl">Publicaciones para este mes</h2>
          <p className="mt-1 text-sm" style={{ color: 'var(--texto-suave)' }}>Ideas para la ficha de Google, sin medicamentos ni productos sanitarios, con botón de reserva por WhatsApp que dice de dónde viene la cita.</p>
          <ul className="mt-4 space-y-3">
            {d.publicaciones.map((x) => (
              <li key={x.codigo} className="rounded-xl border border-[var(--borde)] p-3 text-sm">
                <div className="font-medium">{x.titulo}</div>
                <p className="mt-1" style={{ color: 'var(--texto-suave)' }}>{x.texto}</p>
                <div className="mt-2 text-xs text-oro">Código de origen: {x.codigo}</div>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </>
  );
}
