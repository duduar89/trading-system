'use strict';
// Quién puede hacer qué en el panel: una sola tabla, cada permiso con los roles que lo tienen. La usan
// las rutas (exige) y el panel (la sesión lleva la lista de permisos para ocultar lo que no se puede
// usar). Los permisos de «todo el personal» están aquí para que se vean de un vistazo, pero no se
// comprueban ruta a ruta: para llegar al panel ya hace falta la sesión de alguien del equipo, y todos
// los roles son del equipo.
const ROLES = ['direccion', 'recepcion', 'medico', 'estetica', 'marketing', 'admin'];
const TODOS = ROLES;

const NOMBRE_ROL = {
  direccion: 'dirección', recepcion: 'recepción', medico: 'médico', estetica: 'estética', marketing: 'marketing', admin: 'administración',
};

// que: lo que permite, dicho para el mensaje de «no tienes permiso».
const PERMISOS = {
  'citas.estado': { roles: TODOS, que: 'marcar la llegada, la cita completada o «No vino»' },
  'citas.reservar': { roles: TODOS, que: 'dar citas' },
  'conversaciones.atender': { roles: TODOS, que: 'atender conversaciones' },
  'tareas.cerrar': { roles: TODOS, que: 'cerrar tareas' },
  'seguimientos.editar': { roles: TODOS, que: 'cambiar seguimientos' },
  'resenas.aprobar': { roles: ['direccion', 'marketing'], que: 'aprobar y publicar respuestas a reseñas' },
  'salas.editar': { roles: ['direccion', 'admin'], que: 'cambiar qué tratamiento va en cada sala' },
  'tratamientos.editar': { roles: ['direccion', 'admin'], que: 'cambiar el catálogo de tratamientos' },
  'ofertas.gestionar': { roles: ['direccion', 'admin'], que: 'gestionar las ofertas' },
  'plantillas.gestionar': { roles: ['direccion', 'marketing', 'admin'], que: 'gestionar las plantillas de WhatsApp' },
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
