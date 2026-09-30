import { useEffect, useState } from 'react';
import { api } from './api.js';
import Hoy from './pantallas/Hoy.jsx';
import Tareas from './pantallas/Tareas.jsx';
import Agenda from './pantallas/Agenda.jsx';
import Espera from './pantallas/Espera.jsx';
import Bandeja from './pantallas/Bandeja.jsx';
import Seguimientos from './pantallas/Seguimientos.jsx';
import Repesca from './pantallas/Repesca.jsx';
import Plantillas from './pantallas/Plantillas.jsx';
import Resenas from './pantallas/Resenas.jsx';
import Ajustes from './pantallas/Ajustes.jsx';
import Entrar from './pantallas/Entrar.jsx';

const SECCIONES = [
  { id: 'hoy', nombre: 'Hoy', Pantalla: Hoy },
  { id: 'tareas', nombre: 'Tareas', Pantalla: Tareas },
  { id: 'agenda', nombre: 'Agenda', Pantalla: Agenda },
  { id: 'espera', nombre: 'Lista de espera', Pantalla: Espera },
  { id: 'conversaciones', nombre: 'Conversaciones', Pantalla: Bandeja },
  { id: 'seguimientos', nombre: 'Seguimientos', Pantalla: Seguimientos },
  { id: 'repesca', nombre: 'Repesca', Pantalla: Repesca },
  { id: 'plantillas', nombre: 'Plantillas', Pantalla: Plantillas },
  { id: 'resenas', nombre: 'Reseñas y Google', Pantalla: Resenas },
  { id: 'ajustes', nombre: 'Cabinas y tratamientos', Pantalla: Ajustes },
];

function seccionActual() {
  const h = window.location.hash.replace('#', '').split('/')[0];
  return SECCIONES.find((s) => s.id === h) ? h : 'hoy';
}

export default function App() {
  const [seccion, setSeccion] = useState(seccionActual);
  const [sesion, setSesion] = useState(undefined);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    const cambio = () => { setSeccion(seccionActual()); setMenu(false); };
    const sinSesion = () => setSesion(null);
    window.addEventListener('hashchange', cambio);
    window.addEventListener('iemec:sin-sesion', sinSesion);
    api('/sesion').then(setSesion).catch(() => setSesion(null));
    return () => { window.removeEventListener('hashchange', cambio); window.removeEventListener('iemec:sin-sesion', sinSesion); };
  }, []);

  if (sesion === undefined) return <div className="terciopelo h-full" />;
  if (sesion === null) return <Entrar alEntrar={setSesion} />;
  const { Pantalla } = SECCIONES.find((s) => s.id === seccion);

  return (
    <div className="min-h-full md:grid md:grid-cols-[250px_1fr]">
      <aside className={`terciopelo text-white md:sticky md:top-0 md:h-screen flex flex-col border-r filete ${menu ? '' : 'max-md:[&_nav]:hidden'}`}>
        <div className="relative z-10 flex items-center justify-between px-6 pt-7 pb-6">
          <a href="#hoy" className="block">
            <div className="marca text-2xl text-turquesa">IEMEC</div>
            <div className="mt-1 text-[10px] tracking-[.2em] uppercase text-white/75">Panel de la clínica</div>
          </a>
          <button type="button" className="md:hidden rounded-full border border-white/30 px-3 py-1 text-xs" onClick={() => setMenu(!menu)} aria-expanded={menu}>Menú</button>
        </div>
        <nav className="relative z-10 flex-1 px-3 pb-6" aria-label="Secciones">
          {SECCIONES.map((s) => (
            <a key={s.id} href={`#${s.id}`} aria-current={s.id === seccion ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm tracking-wide transition-colors ${s.id === seccion ? 'bg-white/10 text-white shadow-[inset_0_0_0_1px_rgba(201,164,92,.55)]' : 'text-white/70 hover:text-white hover:bg-white/5'}`}>
              <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${s.id === seccion ? 'bg-oro' : 'bg-white/25'}`} />
              {s.nombre}
            </a>
          ))}
        </nav>
        <div className="relative z-10 hidden md:block border-t border-white/10 px-6 py-5 text-xs text-white/60">
          {sesion.nombre}{sesion.demo ? ' · datos de ejemplo' : ''}
        </div>
      </aside>
      <main className="min-w-0 px-4 py-8 md:px-10">
        {sesion.demo && (
          <div className="mb-6 rounded-xl border filete px-4 py-2 text-xs" style={{ color: 'var(--texto-suave)' }}>
            Demostración con pacientes y conversaciones inventados. Los tratamientos, salas y equipo salen de la web pública de IEMEC y están sin confirmar.
          </div>
        )}
        <Pantalla />
      </main>
    </div>
  );
}
