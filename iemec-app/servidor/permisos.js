'use strict';
// Quién puede hacer qué en el panel: una sola tabla, cada permiso con los roles que lo tienen. La usan
// las rutas (exige; las del panel, todas juntas al principio de servidor/rutas/panel.js) y el panel (la
// sesión lleva la lista de permisos para ocultar lo que no se puede usar). También los de «todo el
// personal» se comprueban en su ruta: si un día se le quita uno a un rol (p. ej., lo que decida el DPO
// sobre las conversaciones), el servidor se lo niega en ese momento, no solo el panel deja de enseñarlo.
const ROLES = ['direccion', 'recepcion', 'medico', 'estetica', 'marketing', 'admin'];
const TODOS = ROLES;

const NOMBRE_ROL = {
  direccion: 'dirección', recepcion: 'recepción', medico: 'médico', estetica: 'estética', marketing: 'marketing', admin: 'administración',
};

// que: lo que permite, dicho para el mensaje de «no tienes permiso».
const PERMISOS = {
  'citas.estado': { roles: TODOS, que: 'marcar la llegada, la cita completada o «No vino»' },
  // También la lista de espera y sus ofertas de hueco: son citas que se dan.
  'citas.reservar': { roles: TODOS, que: 'dar citas y llevar la lista de espera' },
  // Leerlas también: llevan lo que ha contado cada paciente.
  'conversaciones.atender': { roles: TODOS, que: 'atender conversaciones' },
  'tareas.cerrar': { roles: TODOS, que: 'cerrar tareas' },
  'seguimientos.editar': { roles: TODOS, que: 'cambiar seguimientos' },
  'resenas.aprobar': { roles: ['direccion', 'marketing'], que: 'aprobar y publicar respuestas a reseñas' },
  // La reseña con alerta clínica (una posible complicación, una reclamación) la contesta dirección médica,
  // no marketing. Si el servicio de reseñas también lo comprueba, que lea los roles de aquí.
  'resenas.alerta_clinica': { roles: ['direccion', 'medico', 'admin'], que: 'contestar reseñas con alerta clínica' },
  'salas.editar': { roles: ['direccion', 'admin'], que: 'cambiar las salas y los tratamientos' },
  // El catálogo de ofertas comerciales (tabla ofertas), para cuando tenga pantalla: su ruta tiene que
  // llevar exige('ofertas.gestionar'). No son las ofertas de hueco de la lista de espera (citas.reservar).
  'ofertas.gestionar': { roles: ['direccion', 'admin'], que: 'gestionar las ofertas' },
  // A quien es de dirección (y el rol de dirección) solo lo gestiona dirección: servidor/acceso.js.
  'usuarios.gestionar': { roles: ['direccion', 'admin'], que: 'gestionar el equipo y sus accesos' },
};

const puede = (rol, permiso) => Boolean(PERMISOS[permiso]?.roles.includes(rol));
const permisosDe = (rol) => Object.keys(PERMISOS).filter((p) => puede(rol, p));
const lista = (roles) => {
  const n = roles.map((r) => NOMBRE_ROL[r]);
  return n.length > 1 ? `${n.slice(0, -1).join(', ')} o ${n.at(-1)}` : n[0];
};

// Middleware para una ruta: 403 claro si el rol de la sesión no tiene el permiso. Un nombre que no
// está en la tabla es un error de programación: salta al arrancar, no en la primera petición.
function exige(permiso) {
  if (!PERMISOS[permiso]) throw new Error(`Permiso desconocido: ${permiso}`);
  return (req, res, next) => {
    const rol = req.usuario?.rol;
    if (puede(rol, permiso)) return next();
    const { roles, que } = PERMISOS[permiso];
    res.status(403).json({
      error: `${rol ? `Con el rol de ${NOMBRE_ROL[rol] || rol}` : 'Sin rol'} no se puede ${que}: lo hace ${lista(roles)}.`,
      codigo: 'SIN_PERMISO', permiso,
    });
  };
}

module.exports = { ROLES, NOMBRE_ROL, PERMISOS, puede, permisosDe, exige };
