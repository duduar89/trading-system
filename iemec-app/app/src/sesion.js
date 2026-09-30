import { createContext, useContext } from 'react';

// La sesión de quien usa el panel: nombre, rol y permisos (servidor/permisos.js). El panel oculta lo
// que el rol no puede usar; el servidor, además, lo rechaza con un 403.
export const Sesion = createContext(null);
export const useSesion = () => useContext(Sesion);
export const usePuede = (permiso) => Boolean(useContext(Sesion)?.permisos?.includes(permiso));
