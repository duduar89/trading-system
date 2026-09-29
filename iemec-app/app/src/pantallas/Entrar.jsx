import { useState } from 'react';
import { api } from '../api.js';

export default function Entrar({ alEntrar }) {
  const [email, setEmail] = useState('');
  const [clave, setClave] = useState('');
  const [error, setError] = useState('');
  const entrar = async (e) => {
    e.preventDefault();
    setError('');
    try { alEntrar(await api('/sesion', { metodo: 'POST', cuerpo: { email, clave } })); } catch (err) { setError(err.message); }
  };
  return (
    <div className="terciopelo min-h-full grid place-items-center px-4 py-10">
      <form onSubmit={entrar} className="relative z-10 w-full max-w-sm rounded-2xl border filete bg-terciopelo-950/60 p-8 text-white backdrop-blur">
        <div className="marca text-3xl text-turquesa text-center">IEMEC</div>
        <p className="titulo mt-3 text-center text-xl text-white/90">Panel de la clínica</p>
        <label className="mt-8 block text-xs uppercase tracking-[.16em] text-white/60" htmlFor="email">Correo</label>
        <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)}
          className="mt-2 w-full rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-white outline-none focus:border-oro" />
        <label className="mt-5 block text-xs uppercase tracking-[.16em] text-white/60" htmlFor="clave">Clave de acceso</label>
        <input id="clave" type="password" autoComplete="current-password" required value={clave} onChange={(e) => setClave(e.target.value)}
          className="mt-2 w-full rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-white outline-none focus:border-oro" />
        {error && <p role="alert" className="mt-4 text-sm text-rosa">{error}</p>}
        <button type="submit" className="mt-8 w-full rounded-full bg-oro px-4 py-3 font-medium text-terciopelo-950 hover:bg-champan">Entrar</button>
      </form>
    </div>
  );
}
