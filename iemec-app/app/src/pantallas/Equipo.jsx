import { useEffect, useRef, useState } from 'react';
import { api, fechaHora } from '../api.js';
import { useDatos, Cabecera, Boton, Error } from '../componentes/comunes.jsx';
import { IconoPasskey } from '../componentes/Acceso.jsx';
import { useSesion, usePuede } from '../sesion.js';
import { anadirPasskey, hayPasskeys, nombreDeEsteDispositivo } from '../passkeys.js';

const ROLES = [['direccion', 'Dirección'], ['recepcion', 'Recepción'], ['medico', 'Médico'], ['estetica', 'Estética'], ['marketing', 'Marketing'], ['admin', 'Administración']];
const campo = 'w-full rounded-full border border-[var(--borde)] bg-transparent px-4 py-2 text-sm';
const suave = { color: 'var(--texto-suave)' };
// Si la persona se cambia a sí misma (el rol), el panel vuelve a leer su sesión y sus permisos.
const recargarSesion = () => window.dispatchEvent(new Event('iemec:recargar-sesion'));

// Equipo y accesos. Todos ven sus passkeys (añadir la de este dispositivo, borrar una perdida, cerrar
// las demás sesiones); quien gestiona el equipo (dirección, administración) da de alta, cambia roles,
// manda enlaces nuevos y desactiva.
export default function Equipo() {
  const gestiona = usePuede('usuarios.gestionar');
  return (
    <>
      <Cabecera antetitulo="Accesos al panel" titulo={gestiona ? 'Equipo' : 'Mis passkeys'} />
      {gestiona ? (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <ElEquipo />
          <div className="xl:col-start-2 xl:row-start-1"><MisPasskeys /></div>
        </div>
      ) : <div className="max-w-2xl"><MisPasskeys /></div>}
    </>
  );
}

// ── Mis passkeys ──────────────────────────────────────────────────────────────────────────────
function MisPasskeys() {
  const sesion = useSesion();
  return (
    <section aria-labelledby="mis-passkeys" className="tarjeta p-5">
      <h2 id="mis-passkeys" className="titulo text-xl">Tus passkeys</h2>
      {sesion?.emergencia && (
        <p className="mt-2 rounded-xl border border-rosa/50 bg-rosa/10 px-3 py-2 text-sm">Has entrado con la clave de emergencia: crea aquí tu passkey nueva.</p>
      )}
      {sesion?.id
        ? <ListaPasskeys />
        : <p className="mt-2 text-sm" style={suave}>En la demostración no hay passkeys propias: entra con tu passkey para gestionarlas.</p>}
    </section>
  );
}

function ListaPasskeys() {
  const { datos, error, recargar } = useDatos('/panel/passkeys');
  const [dispositivo, setDispositivo] = useState(nombreDeEsteDispositivo);
  const [aviso, setAviso] = useState('');
  const [fallo, setFallo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  if (error) return <div className="mt-3"><Error texto={error} /></div>;
  if (!datos) return null;
  const hacer = async (fn, hecho) => {
    setAviso('');
    setFallo('');
    try { await fn(); setAviso(hecho); } catch (err) { setFallo(err.message); }
    recargar();
  };
  const anadir = async (e) => {
    e.preventDefault();
    setOcupado(true);
    await hacer(() => anadirPasskey(dispositivo), `Passkey «${dispositivo.trim()}» añadida.`);
    setOcupado(false);
  };
  const borrar = (p) => {
    const avisos = [`¿Borrar la passkey «${p.dispositivo}»?`];
    if (p.id === datos.actual) avisos.push('Es con la que has entrado: esta sesión se cerrará.');
    if (datos.passkeys.length === 1) avisos.push('Es la única que tienes: para volver a entrar necesitarás un enlace nuevo de dirección.');
    if (!window.confirm(avisos.join(' '))) return;
    hacer(async () => {
      const r = await api(`/panel/passkeys/${p.id}`, { metodo: 'DELETE' });
      if (r.sesionCerrada) window.dispatchEvent(new Event('iemec:sin-sesion'));
    }, `Passkey «${p.dispositivo}» borrada.`);
  };
  return (
    <>
      <p className="mt-1 text-sm" style={suave}>Con cualquiera de ellas entras al panel. Si pierdes un dispositivo, borra su passkey desde otro.</p>
      <ul className="mt-3 divide-y divide-[var(--borde)]">
        {datos.passkeys.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 font-medium">
                <IconoPasskey className="h-4 w-4 shrink-0 text-oro" />
                <span className="break-words">{p.dispositivo}</span>
                {p.id === datos.actual && <span className="rounded-full bg-oro/20 px-2 py-0.5 text-xs font-normal text-[#7a5a1f] dark:text-champan">con esta has entrado</span>}
              </div>
              <div className="mt-0.5 text-xs" style={suave}>
                Alta {fechaHora(p.alta)} · {p.ultimoUso ? `último uso ${fechaHora(p.ultimoUso)}` : 'sin usar todavía'}{p.sincronizada ? ' · sincronizada en la nube' : ''}
              </div>
            </div>
            <Boton onClick={() => borrar(p)} aria-label={`Borrar la passkey ${p.dispositivo}`}>Borrar</Boton>
          </li>
        ))}
      </ul>
      <form onSubmit={anadir} className="mt-2 border-t border-[var(--borde)] pt-4">
        <label htmlFor="nueva-passkey" className="etiqueta">Añadir una passkey en este dispositivo</label>
        <div className="mt-2 flex flex-wrap gap-2">
          <input id="nueva-passkey" required maxLength={80} value={dispositivo} onChange={(e) => setDispositivo(e.target.value)} className={`${campo} min-w-0 flex-1`} />
          <Boton type="submit" variante="lleno" disabled={ocupado || !hayPasskeys()} aria-busy={ocupado}>{ocupado ? 'Esperando…' : 'Añadir'}</Boton>
        </div>
      </form>
      <div className="mt-4 border-t border-[var(--borde)] pt-4">
        <Boton onClick={() => hacer(() => api('/panel/sesiones/cerrar-otras', { metodo: 'POST' }), 'Listo: las sesiones de tus otros dispositivos se han cerrado.')}>
          Cerrar la sesión en los demás dispositivos
        </Boton>
      </div>
      <p role="status" className="mt-3 text-sm empty:hidden">{aviso}</p>
      {fallo && <p role="alert" className="mt-3 text-sm text-rosa">{fallo}</p>}
    </>
  );
}

// ── El equipo ─────────────────────────────────────────────────────────────────────────────────
function ElEquipo() {
  const { datos, error, recargar } = useDatos('/panel/equipo');
  const [enlace, setEnlace] = useState(null);
  const [fallo, setFallo] = useState('');
  if (error) return <Error texto={error} />;
  if (!datos) return null;
  // Cada acción: el error, si lo hay, arriba; y la lista, siempre recargada (un rol que no se pudo
  // cambiar vuelve a su sitio).
  const hacer = async (fn) => {
    setFallo('');
    try { return await fn(); } catch (err) { setFallo(err.message); return null; } finally { recargar(); }
  };
  return (
    <>
    <section aria-labelledby="equipo-titulo" className="min-w-0 space-y-4 xl:col-start-1 xl:row-start-1">
      <h2 id="equipo-titulo" className="sr-only">Personas del equipo</h2>
      <AltaPersona alCrear={(r) => { setEnlace({ para: r.usuario.nombre, enlace: r.enlace, caduca: r.caduca }); recargar(); }} />
      {enlace && <EnlaceNuevo {...enlace} alCerrar={() => setEnlace(null)} />}
      {fallo && <Error texto={fallo} />}
      <ul className="space-y-3">
        {datos.usuarios.map((u) => (
          <Persona key={u.id} u={u} yo={datos.yo} hacer={hacer} alEnlace={(r) => setEnlace({ para: u.nombre, enlace: r.enlace, caduca: r.caduca })} />
        ))}
      </ul>
    </section>
    <QuePuedeCadaRol permisos={datos.permisos} />
    </>
  );
}

function AltaPersona({ alCrear }) {
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [rol, setRol] = useState('recepcion');
  const [fallo, setFallo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const enviar = async (e) => {
    e.preventDefault();
    setFallo('');
    setOcupado(true);
    try {
      alCrear(await api('/panel/equipo', { metodo: 'POST', cuerpo: { nombre, email, rol } }));
      setNombre('');
      setEmail('');
    } catch (err) { setFallo(err.message); } finally { setOcupado(false); }
  };
  return (
    <form onSubmit={enviar} className="tarjeta p-5" aria-labelledby="alta-titulo">
      <h3 id="alta-titulo" className="titulo text-xl">Dar de alta a alguien</h3>
      <p className="mt-1 text-sm" style={suave}>Se crea un enlace de un solo uso para que cree su passkey. Caduca a las 24 horas.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 sm:items-end">
        <div>
          <label htmlFor="alta-nombre" className="etiqueta">Nombre</label>
          <input id="alta-nombre" required maxLength={120} autoComplete="off" value={nombre} onChange={(e) => setNombre(e.target.value)} className={`${campo} mt-1`} />
        </div>
        <div>
          <label htmlFor="alta-email" className="etiqueta">Correo</label>
          <input id="alta-email" type="email" required maxLength={160} autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} className={`${campo} mt-1`} />
        </div>
        <div>
          <label htmlFor="alta-rol" className="etiqueta">Rol</label>
          <select id="alta-rol" value={rol} onChange={(e) => setRol(e.target.value)} className={`${campo} mt-1 bg-[var(--superficie)]`}>
            {ROLES.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
          </select>
        </div>
        <div className="sm:justify-self-start"><Boton type="submit" variante="lleno" disabled={ocupado}>Crear enlace</Boton></div>
      </div>
      {fallo && <p role="alert" className="mt-3 text-sm text-rosa">{fallo}</p>}
    </form>
  );
}

// El enlace recién creado: solo se ve ahora (en la base solo queda su huella).
function EnlaceNuevo({ para, enlace, caduca, alCerrar }) {
  const [copiado, setCopiado] = useState(false);
  const caja = useRef(null);
  useEffect(() => { setCopiado(false); caja.current?.focus(); caja.current?.select(); }, [enlace]);
  const copiar = async () => {
    try { await navigator.clipboard.writeText(enlace); setCopiado(true); } catch { caja.current?.select(); }
  };
  const compartir = typeof navigator.share === 'function'
    ? () => navigator.share({ title: 'Tu acceso al panel de IEMEC', text: `Con este enlace creas tu passkey para el panel de IEMEC (un solo uso; caduca en 24 horas).`, url: enlace }).catch(() => {})
    : null;
  return (
    <div className="rounded-2xl border filete bg-[var(--superficie)] p-5 shadow-[0_18px_40px_-28px_rgba(11,43,42,.6)]">
      <p role="status" className="font-medium">Enlace listo para {para}</p>
      <p className="mt-1 text-sm" style={suave}>
        De un solo uso; caduca el {fechaHora(caduca)}. Pásaselo en mano o por un canal de confianza: quien lo abra crea la passkey. No se vuelve a mostrar.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <label htmlFor="enlace-alta" className="sr-only">Enlace de alta de {para}</label>
        <input id="enlace-alta" ref={caja} readOnly value={enlace} onFocus={(e) => e.target.select()} className={`${campo} min-w-0 flex-1 bg-[var(--superficie-2)] font-mono text-xs`} />
        <Boton variante="lleno" onClick={copiar}>{copiado ? 'Copiado' : 'Copiar'}</Boton>
        {compartir && <Boton onClick={compartir}>Compartir</Boton>}
        <Boton onClick={alCerrar}>Hecho</Boton>
      </div>
    </div>
  );
}

function Persona({ u, yo, hacer, alEnlace }) {
  const soyYo = u.id === yo;
  const [texto, clase] = !u.activo ? ['Desactivada', 'bg-[var(--superficie-2)] text-[var(--texto-suave)]']
    : u.invitacionHasta ? [`Enlace pendiente hasta ${fechaHora(u.invitacionHasta)}`, 'bg-oro/20 text-[#7a5a1f] dark:text-champan']
      : !u.passkeys.length ? ['Sin passkey', 'bg-rosa/20 text-rosa'] : ['Activa', 'bg-aqua text-terciopelo-800'];
  const cambiar = (cuerpo) => hacer(async () => {
    await api(`/panel/equipo/${u.id}`, { metodo: 'PATCH', cuerpo });
    if (soyYo) recargarSesion();
  });
  const enlaceNuevo = async () => {
    const r = await hacer(() => api(`/panel/equipo/${u.id}/invitacion`, { metodo: 'POST' }));
    if (r) alEnlace(r);
  };
  const desactivar = () => {
    if (u.activo && !window.confirm(`¿Desactivar a ${u.nombre}? Sus sesiones se cierran ahora mismo y no podrá entrar hasta que se reactive.`)) return;
    cambiar({ activo: !u.activo });
  };
  const borrar = (p) => {
    if (!window.confirm(`¿Borrar la passkey «${p.dispositivo}» de ${u.nombre}? Las sesiones abiertas con ella se cierran ahora mismo.`)) return;
    hacer(async () => {
      const r = await api(`/panel/equipo/${u.id}/passkeys/${p.id}`, { metodo: 'DELETE' });
      if (r.sesionCerrada) window.dispatchEvent(new Event('iemec:sin-sesion'));
    });
  };
  return (
    <li className={`tarjeta p-5 ${u.activo ? '' : 'opacity-75'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium">{u.nombre}{soyYo && <span className="font-normal" style={suave}> (tú)</span>}</div>
          <div className="text-sm break-all" style={suave}>{u.email}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className={`rounded-full px-2.5 py-0.5 font-medium ${clase}`}>{texto}</span>
            <span style={suave}>{u.ultimoAcceso ? `Último acceso ${fechaHora(u.ultimoAcceso)}` : 'Aún no ha entrado'}</span>
          </div>
        </div>
        <div>
          <label htmlFor={`rol-${u.id}`} className="sr-only">Rol de {u.nombre}</label>
          <select id={`rol-${u.id}`} value={u.rol} disabled={!u.activo} onChange={(e) => cambiar({ rol: e.target.value })}
            className="rounded-full border border-[var(--borde)] bg-[var(--superficie)] px-3 py-1.5 text-sm disabled:opacity-50">
            {ROLES.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
          </select>
        </div>
      </div>
      {u.passkeys.length > 0 && (
        <ul className="mt-3 space-y-1.5" aria-label={`Passkeys de ${u.nombre}`}>
          {u.passkeys.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--superficie-2)] px-3 py-2 text-sm">
              <span className="flex min-w-0 items-center gap-1.5">
                <IconoPasskey className="h-4 w-4 shrink-0 text-oro" />
                <span className="break-words">{p.dispositivo}</span>
                <span className="text-xs" style={suave}>· {p.ultimoUso ? `usada ${fechaHora(p.ultimoUso)}` : 'sin usar'}</span>
              </span>
              <button type="button" onClick={() => borrar(p)} aria-label={`Borrar la passkey ${p.dispositivo} de ${u.nombre}`}
                className="rounded-full px-2 py-0.5 text-xs underline underline-offset-2 hover:text-rosa cursor-pointer">Borrar</button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {u.activo && <Boton onClick={enlaceNuevo}>{u.passkeys.length ? 'Enlace para otra passkey' : 'Enlace nuevo'}</Boton>}
        {u.activo && !soyYo && <Boton onClick={() => hacer(() => api(`/panel/equipo/${u.id}/cerrar-sesiones`, { metodo: 'POST' }))}>Cerrar sus sesiones</Boton>}
        {!soyYo && <Boton onClick={desactivar}>{u.activo ? 'Desactivar' : 'Reactivar'}</Boton>}
      </div>
    </li>
  );
}

// La tabla de permisos del servidor (servidor/permisos.js), para verla de un vistazo.
function QuePuedeCadaRol({ permisos = [] }) {
  return (
    <details className="tarjeta p-5 xl:col-span-2">
      <summary className="cursor-pointer font-medium">Qué puede hacer cada rol</summary>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[680px] text-sm">
          <thead>
            <tr className="border-b border-[var(--borde)]">
              <th scope="col" className="w-2/5 py-2 pr-3 text-left etiqueta">Permiso</th>
              {ROLES.map(([v, n]) => <th key={v} scope="col" className="px-2 py-2 text-center etiqueta">{n}</th>)}
            </tr>
          </thead>
          <tbody>
            {permisos.map((p) => (
              <tr key={p.id} className="border-b border-[var(--borde)] last:border-0">
                <th scope="row" className="py-2 pr-3 text-left font-normal first-letter:uppercase">{p.que}</th>
                {ROLES.map(([v, n]) => (
                  <td key={v} className="px-2 py-2 text-center">
                    {p.roles.includes(v) ? <span className="text-oro" role="img" aria-label={`${n}: sí`}>●</span> : <span className="opacity-30" role="img" aria-label={`${n}: no`}>·</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
