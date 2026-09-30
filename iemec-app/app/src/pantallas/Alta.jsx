import { useEffect, useRef, useState } from 'react';
import { api, fechaHora } from '../api.js';
import { crearPasskeyConEnlace, hayPasskeys, nombreDeEsteDispositivo } from '../passkeys.js';
import { Marco, IconoPasskey } from '../componentes/Acceso.jsx';

const ROL = { direccion: 'dirección', recepcion: 'recepción', medico: 'médico', estetica: 'estética', marketing: 'marketing', admin: 'administración' };

// Lo que ve quien abre el enlace de alta (#alta/<token>): quién es, el nombre del dispositivo y el botón
// para crear su passkey. Al crearla ya está dentro.
export default function Alta({ token, alEntrar, alSalir }) {
  const [invitacion, setInvitacion] = useState(undefined);
  const [error, setError] = useState('');
  const [dispositivo, setDispositivo] = useState(nombreDeEsteDispositivo);
  const [ocupado, setOcupado] = useState(false);
  const aviso = useRef(null);
  const soporta = hayPasskeys();

  useEffect(() => {
    api('/acceso/invitacion', { metodo: 'POST', cuerpo: { token } })
      .then(setInvitacion)
      .catch((err) => { setInvitacion(null); setError(err.message); });
  }, [token]);
  useEffect(() => { if (error) aviso.current?.focus(); }, [error]);

  const crear = async (e) => {
    e.preventDefault();
    setError('');
    setOcupado(true);
    try { alEntrar(await crearPasskeyConEnlace(token, dispositivo)); } catch (err) { setError(err.message); } finally { setOcupado(false); }
  };

  if (invitacion === undefined && !error) return <div className="terciopelo h-full" aria-busy="true" />;
  return (
    <Marco titulo={invitacion ? `Hola, ${invitacion.nombre.split(' ')[0]}` : 'Enlace de alta'}>
      {invitacion ? (
        <form onSubmit={crear}>
          <p className="mt-6 text-center text-sm leading-relaxed text-white/75">
            Te han dado de alta en el panel de IEMEC con el rol de {ROL[invitacion.rol] || invitacion.rol}. Crea tu passkey: entrarás con la huella, la cara o el PIN de este dispositivo, sin contraseñas.
          </p>
          <p className="mt-3 text-center text-xs text-white/55">{invitacion.email}</p>
          <label className="mt-6 block text-xs uppercase tracking-[.16em] text-white/60" htmlFor="dispositivo">Nombre de este dispositivo</label>
          <input id="dispositivo" required maxLength={80} value={dispositivo} onChange={(e) => setDispositivo(e.target.value)} aria-describedby="dispositivo-ayuda"
            className="mt-2 w-full rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-white outline-none focus:border-oro" />
          <p id="dispositivo-ayuda" className="mt-1.5 text-xs text-white/50">Para reconocerla si un día lo pierdes («iPhone de Marta», «Ordenador de recepción»).</p>
          <button type="submit" disabled={ocupado || !soporta} aria-busy={ocupado}
            className="mt-7 flex w-full items-center justify-center gap-2.5 rounded-full bg-oro px-4 py-3.5 font-medium text-terciopelo-950 transition-colors hover:bg-champan disabled:opacity-50 cursor-pointer">
            <IconoPasskey />
            {ocupado ? 'Esperando a tu dispositivo…' : 'Crear mi passkey'}
          </button>
          {!soporta && <p role="alert" className="mt-4 text-center text-sm text-rosa">Este navegador no admite passkeys. Abre el enlace con Safari, Chrome o Edge actualizados.</p>}
          <p className="mt-6 text-center text-xs text-white/50">El enlace es de un solo uso y caduca el {fechaHora(invitacion.caduca)}.</p>
        </form>
      ) : null}
      {error && <p ref={aviso} tabIndex={-1} role="alert" className="mt-6 text-center text-sm text-rosa outline-none">{error}</p>}
      {!invitacion && (
        <button type="button" onClick={alSalir} className="mt-6 w-full rounded-full border border-white/25 px-4 py-2.5 text-sm text-white/80 hover:border-oro cursor-pointer">
          Ir a la entrada del panel
        </button>
      )}
    </Marco>
  );
}
