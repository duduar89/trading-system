import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { Sesion } from './sesion.js';
import Hoy from './pantallas/Hoy.jsx';
import Tareas from './pantallas/Tareas.jsx';
import Agenda from './pantallas/Agenda.jsx';
import Bandeja from './pantallas/Bandeja.jsx';
import Seguimientos from './pantallas/Seguimientos.jsx';
import Repesca from './pantallas/Repesca.jsx';
import Plantillas from './pantallas/Plantillas.jsx';
import Resenas from './pantallas/Resenas.jsx';
import Ajustes from './pantallas/Ajustes.jsx';
import Equipo from './pantallas/Equipo.jsx';
import Entrar from './pantallas/Entrar.jsx';
import Alta from './pantallas/Alta.jsx';

const SECCIONES = [
  { id: 'hoy', nombre: 'Hoy', Pantalla: Hoy },
  { id: 'tareas', nombre: 'Tareas', Pantalla: Tareas },
  { id: 'agenda', nombre: 'Agenda', Pantalla: Agenda },
  { id: 'conversaciones', nombre: 'Conversaciones', Pantalla: Bandeja },
  { id: 'seguimientos', nombre: 'Seguimientos', Pantalla: Seguimientos },
  { id: 'repesca', nombre: 'Repesca', Pantalla: Repesca },
  { id: 'plantillas', nombre: 'Plantillas', Pantalla: Plantillas },
  { id: 'resenas', nombre: 'Reseñas y Google', Pantalla: Resenas },
  { id: 'ajustes', nombre: 'Cabinas y tratamientos', Pantalla: Ajustes },
  { id: 'equipo', nombre: (s) => (s.permisos?.includes('usuarios.gestionar') ? 'Equipo' : 'Mis passkeys'), Pantalla: Equipo },
];
// Las secciones que piden un permiso para verse (servidor/permisos.js); las demás, todo el personal.
// «Equipo» la ve todo el mundo: quien no gestiona el equipo ve ahí sus passkeys.
const PERMISO_DE_SECCION = { conversaciones: 'conversaciones.atender', espera: 'citas.reservar', ajustes: 'salas.editar' };

const seccionActual = () => window.location.hash.replace('#', '').split('/')[0] || 'hoy';
// El enlace de alta: #alta/<token>.
const tokenDeAlta = () => /^#alta\/([A-Za-z0-9_-]{43})$/.exec(window.location.hash)?.[1] || null;

export default function App() {
  const [seccion, setSeccion] = useState(seccionActual);
  const [sesion, setSesion] = useState(undefined);
  const [alta, setAlta] = useState(tokenDeAlta);
  const [menu, setMenu] = useState(false);
  const cargarSesion = useCallback(() => api('/sesion').then(setSesion).catch(() => setSesion(null)), []);

  useEffect(() => {
    const cambio = () => { setSeccion(seccionActual()); setAlta(tokenDeAlta()); setMenu(false); };
    const sinSesion = () => setSesion(null);
    window.addEventListener('hashchange', cambio);
    window.addEventListener('iemec:sin-sesion', sinSesion);
    window.addEventListener('iemec:recargar-sesion', cargarSesion);
    cargarSesion();
    return () => {
      window.removeEventListener('hashchange', cambio);
      window.removeEventListener('iemec:sin-sesion', sinSesion);
      window.removeEventListener('iemec:recargar-sesion', cargarSesion);
    };
  }, [cargarSesion]);

  // Tras entrar (o crear la passkey con el enlace): el enlace sale de la barra y del historial.
  const entrar = (s) => {
    if (tokenDeAlta()) window.history.replaceState(null, '', '/#hoy');
    setAlta(null);
    setSeccion(seccionActual());
    setSesion(s);
  };
  const aLaEntrada = () => { window.history.replaceState(null, '', '/'); setAlta(null); setSeccion('hoy'); };
  const salir = async () => {
    await api('/sesion/salir', { metodo: 'POST' }).catch(() => {});
    setSesion(null);
  };

  if (alta) return <Alta token={alta} alEntrar={entrar} alSalir={aLaEntrada} />;
  if (sesion === undefined) return <div className="terciopelo h-full" />;
  if (sesion === null) return <Entrar alEntrar={entrar} />;
  const visibles = SECCIONES.filter((s) => !PERMISO_DE_SECCION[s.id] || sesion.permisos?.includes(PERMISO_DE_SECCION[s.id]));
  const actual = visibles.find((s) => s.id === seccion) || visibles[0];
  const nombre = (s) => (typeof s.nombre === 'function' ? s.nombre(sesion) : s.nombre);
  const { Pantalla } = actual;

  // El panel, con la sesión (nombre, rol y permisos) a mano de cada pantalla: así oculta lo que no se
  // puede usar.
  const panel = (
    <div className="min-h-full md:grid md:grid-cols-[250px_1fr]">
      <aside className={`terciopelo text-white md:sticky md:top-0 md:h-screen flex flex-col border-r filete ${menu ? '' : 'max-md:[&_.plegable]:hidden'}`}>
        <div className="relative z-10 flex items-center justify-between px-6 pt-7 pb-6">
          <a href="#hoy" className="block">
            <div className="marca text-2xl text-turquesa">IEMEC</div>
            <div className="mt-1 text-[10px] tracking-[.2em] uppercase text-white/60">Panel de la clínica</div>
          </a>
          <button type="button" className="md:hidden rounded-full border border-white/30 px-3 py-1 text-xs" onClick={() => setMenu(!menu)} aria-expanded={menu}>Menú</button>
        </div>
        <nav className="plegable relative z-10 flex-1 px-3 pb-6" aria-label="Secciones">
          {visibles.map((s) => (
            <a key={s.id} href={`#${s.id}`} aria-current={s.id === actual.id ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm tracking-wide transition-colors ${s.id === actual.id ? 'bg-white/10 text-white shadow-[inset_0_0_0_1px_rgba(201,164,92,.55)]' : 'text-white/70 hover:text-white hover:bg-white/5'}`}>
              <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${s.id === actual.id ? 'bg-oro' : 'bg-white/25'}`} />
              {nombre(s)}
            </a>
          ))}
        </nav>
        <div className="plegable relative z-10 border-t border-white/10 px-6 py-5 text-xs text-white/60">
          <div className="text-sm text-white/85">{sesion.nombre}</div>
          <div className="mt-0.5">{sesion.rolNombre}{sesion.demo ? ' · datos de ejemplo' : ''}</div>
          {sesion.id && (
            <button type="button" onClick={salir} className="mt-3 rounded-full border border-white/25 px-3 py-1 text-xs text-white/80 hover:border-oro hover:text-white cursor-pointer">Salir</button>
          )}
        </div>
      </aside>
      <main className="min-w-0 px-4 py-8 md:px-10">
        {sesion.emergencia && (
          <div role="note" className="mb-6 rounded-xl border border-rosa/60 bg-rosa/10 px-4 py-3 text-sm">
            Has entrado con la clave de emergencia: la sesión dura una hora y queda registrada. <a href="#equipo" className="underline underline-offset-2">Crea tu passkey</a> para la próxima vez.
          </div>
        )}
        {sesion.demo && (
          <div className="mb-6 rounded-xl border filete px-4 py-2 text-xs" style={{ color: 'var(--texto-suave)' }}>
            Demostración con pacientes y conversaciones inventados. Los tratamientos, salas y equipo salen de la web pública de IEMEC y están sin confirmar.
          </div>
        )}
        <Pantalla />
      </main>
    </div>
  );
  return <Sesion.Provider value={sesion}>{panel}</Sesion.Provider>;
}
