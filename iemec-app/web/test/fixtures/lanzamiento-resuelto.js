'use strict';
// Datos INVENTADOS que resuelven lo imprescindible de web/datos/lanzamiento.json (clase «a»), para
// probar «construir --publicar» como quedará cuando la clínica los mande. No son de la clínica: el
// correo y el delegado usan el dominio reservado .test y la cirujana no existe. Solo se usan en una
// carpeta temporal; nunca en web/dist.

const CIRUJANA = {
  codigo: 'cirujana-de-prueba',
  nombre: 'Dra. Cirujana de Prueba',
  cargo: 'Cirugía',
  bio: 'Persona inventada para las pruebas del generador.',
  areas: ['cirugia-estetica', 'cirugia-capilar'],
  foto: null,
  titulo: 'Licenciada en Medicina',
  especialidad: 'Cirugía Plástica, Estética y Reparadora',
  colegio: 'Colegio de Médicos de Prueba',
  colegiado: '00/00000',
  titulo_extranjero: false,
  opera: ['cirugia-estetica', 'cirugia-capilar', 'labioplastia'],
  pendiente: null,
};

function resolverImprescindibles(datos) {
  datos.sitio.correo = 'hola@clinica-de-prueba.test';
  datos.sitio.dpd = { nombre: 'Delegado de prueba', correo: 'dpd@clinica-de-prueba.test' };
  datos.equipo.personas.push({ ...CIRUJANA });
  const capilar = datos.especialidades.especialidades.find((e) => e.slug === 'cirugia-capilar');
  capilar.donde_cirugia = 'En la sala de procedimientos de la clínica de prueba, con anestesia local';
  for (const c of datos.contenidos) {
    for (const p of c.paginas || []) {
      if (p.slug === 'labioplastia') p.sesion.donde = 'En la sala de procedimientos de la clínica de prueba, con anestesia local';
    }
  }
  datos.lanzamiento.vistos_buenos.medico.fecha = '2026-10-01';
  datos.lanzamiento.vistos_buenos.legal.fecha = '2026-10-02';
  return datos;
}

// Lo contrario: deja sin resolver lo imprescindible que se completa con datos (correo, DPD, quién opera
// y dónde, vistos buenos), aunque la clínica ya los haya mandado.
function sinResolver(datos) {
  datos.sitio.correo = null;
  datos.sitio.dpd = null;
  for (const p of datos.equipo.personas) p.colegiado = null;
  const capilar = datos.especialidades.especialidades.find((e) => e.slug === 'cirugia-capilar');
  capilar.donde_cirugia = null;
  datos.lanzamiento.vistos_buenos.medico.fecha = null;
  datos.lanzamiento.vistos_buenos.legal.fecha = null;
  return datos;
}

module.exports = { resolverImprescindibles, sinResolver, CIRUJANA };
