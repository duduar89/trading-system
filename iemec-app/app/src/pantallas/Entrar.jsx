import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { entrarConPasskey, hayPasskeys } from '../passkeys.js';
import { Marco, IconoPasskey } from '../componentes/Acceso.jsx';

// Entrar al panel con la passkey (la huella, la cara o el PIN del dispositivo). No se escribe el correo:
// el navegador ofrece las passkeys del panel que tiene. La clave de emergencia, solo para dirección y
// solo si el servidor la tiene puesta.
export default function Entrar({ alEntrar }) {
  const [emergencia, setEmergencia] = useState(false);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [email, setEmail] = useState('');
  const [clave, setClave] = useState('');
  const aviso = useRef(null);
  const soporta = hayPasskeys();

  useEffect(() => { api('/acceso').then((d) => setEmergencia(Boolean(d.emergencia))).catch(() => {}); }, []);
  useEffect(() => { if (error) aviso.current?.focus(); }, [error]);

  const conPasskey = async () => {
    setError('');
    setOcupado(true);
    try { alEntrar(await entrarConPasskey()); } catch (err) { setError(err.message); } finally { setOcupado(false); }
  };
  const conClave = async (e) => {
    e.preventDefault();
    setError('');
    try { alEntrar(await api('/acceso/emergencia', { metodo: 'POST', cuerpo: { email, clave } })); } catch (err) { setError(err.message); }
  };

  return (
    <Marco titulo="Panel de la clínica">
      <p className="mt-6 text-center text-sm leading-relaxed text-white/75">
        Entra con tu passkey: la huella, la cara o el PIN de tu dispositivo. Sin contraseñas.
      </p>
      <button type="button" onClick={conPasskey} disabled={ocupado || !soporta} aria-busy={ocupado}
        className="mt-7 flex w-full items-center justify-center gap-2.5 rounded-full bg-oro px-4 py-3.5 font-medium text-terciopelo-950 shadow-[0_10px_30px_-12px_rgba(201,164,92,.8)] transition-colors hover:bg-champan disabled:opacity-50 cursor-pointer">
        <IconoPasskey />
        {ocupado ? 'Esperando a tu passkey…' : 'Entrar con passkey'}
      </button>
      {!soporta && (
        <p role="alert" className="mt-4 text-center text-sm text-rosa">Este navegador no admite passkeys. Usa Safari, Chrome o Edge actualizados.</p>
      )}
      {error && <p ref={aviso} tabIndex={-1} role="alert" className="mt-4 text-center text-sm text-rosa outline-none">{error}</p>}
      <p className="mt-7 border-t border-white/10 pt-5 text-center text-xs leading-relaxed text-white/60">
        ¿Es tu primera vez? Abre el enlace que te ha mandado dirección: con él creas tu passkey.
      </p>
      {emergencia && (
        <details className="group mt-5 text-sm">
          <summary className="flex cursor-pointer list-none items-center justify-center gap-2 text-xs uppercase tracking-[.16em] text-white/55 hover:text-champan [&::-webkit-details-marker]:hidden">
            <span aria-hidden="true" className="text-[10px] transition-transform group-open:rotate-90">▸</span>
            Acceso de emergencia de dirección
          </summary>
          <form onSubmit={conClave} className="mt-4">
            <p className="text-xs leading-relaxed text-white/60">Solo si no puedes usar tu passkey. Queda registrado y la sesión dura una hora.</p>
            <label className="mt-4 block text-xs uppercase tracking-[.16em] text-white/60" htmlFor="email">Correo</label>
            <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)}
              className="mt-2 w-full rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-white outline-none focus:border-oro" />
            <label className="mt-4 block text-xs uppercase tracking-[.16em] text-white/60" htmlFor="clave">Clave de emergencia</label>
            <input id="clave" type="password" autoComplete="current-password" required value={clave} onChange={(e) => setClave(e.target.value)}
              className="mt-2 w-full rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-white outline-none focus:border-oro" />
            <button type="submit" className="mt-5 w-full rounded-full border border-oro/70 px-4 py-2.5 text-sm text-champan hover:bg-white/5 cursor-pointer">Entrar con la clave</button>
          </form>
        </details>
      )}
    </Marco>
  );
}
