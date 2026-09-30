'use strict';
// Datos INVENTADOS que resuelven lo imprescindible de web/datos/lanzamiento.json (clase «a»), para
// probar «construir --publicar» como quedará cuando la clínica los mande. No son de la clínica: el
// correo y el delegado usan el dominio reservado .test y las personas del equipo no existen (el equipo
// de verdad se cambia por ellas: no se le ponen números de colegiado inventados a nadie real). Solo se
// usan en una carpeta temporal; nunca en web/dist.

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
const MEDICA = {
  codigo: 'medica-de-prueba',
  nombre: 'Dra. Médica de Prueba',
  cargo: 'Medicina estética',
  bio: 'Persona inventada para las pruebas del generador.',
  areas: ['medicina-estetica-facial', 'medicina-estetica-corporal'],
  foto: null,
  titulo: 'Licenciada en Medicina',
  especialidad: null,
  colegio: 'Colegio de Médicos de Prueba',
  colegiado: '00/00001',
  titulo_extranjero: false,
  opera: [],
  pendiente: null,
};
// Quien no ejerce una profesión sanitaria regulada («colegiado»: false): sale en /equipo/, no en la
// tabla de colegiación del aviso legal.
const TECNICA = {
  codigo: 'tecnica-de-prueba',
  nombre: 'Técnica de Prueba',
  cargo: 'Área capilar',
  bio: 'Persona inventada para las pruebas del generador.',
  areas: ['medicina-capilar'],
  foto: null,
  titulo: null,
  especialidad: null,
  colegio: null,
  colegiado: false,
  titulo_extranjero: null,
  opera: [],
  pendiente: null,
};

const MARCA_U900 = ' `[PENDIENTE: qué actividad concreta cubre la U.900 según la resolución de autorización]`';
const MARCA_BASE_DPD = ' `[PENDIENTE: validar la base con el DPD]`';
const quitarTexto = (s, t) => s.split(t).join('');

// Todo lo imprescindible resuelto, salvo lo que diga `sin` (ids de lanzamiento.json): así se prueba cada
// alternativa (p. ej. sin: ['cirugias'] con alternativas.aplicar = ['sin-cirugias']).
function resolverImprescindibles(datos, { sin = [] } = {}) {
  const falta = (id) => sin.includes(id);
  datos.sitio.correo = 'hola@clinica-de-prueba.test';
  datos.sitio.dpd = { nombre: 'Delegado de prueba', correo: 'dpd@clinica-de-prueba.test' };
  datos.equipo.personas = [MEDICA, TECNICA, ...(falta('cirugias') ? [] : [CIRUJANA])].map((p) => ({ ...p }));
  if (!falta('cirugias')) {
    const capilar = datos.especialidades.especialidades.find((e) => e.slug === 'cirugia-capilar');
    capilar.donde_cirugia = 'En la sala de procedimientos de la clínica de prueba, con anestesia local';
  }
  for (const c of datos.contenidos) {
    for (const p of c.paginas || []) {
      if (p.slug === 'labioplastia' && !falta('cirugias')) p.sesion.donde = 'En la sala de procedimientos de la clínica de prueba, con anestesia local';
      if (p.slug === 'diagnostico-capilar' && !falta('diagnostico-capilar')) p.sesion.profesional = 'Médico';
      if (!falta('paginas-por-confirmar')) delete p.confirmar;
    }
  }
  const esp = (slug) => datos.especialidades.especialidades.find((e) => e.slug === slug);
  if (!falta('u900')) {
    delete esp('medicina-capilar').pendiente;
    datos.legales['aviso-legal.md'] = quitarTexto(datos.legales['aviso-legal.md'], MARCA_U900);
  }
  if (!falta('intima-autorizacion')) delete esp('estetica-intima-femenina').pendiente;
  if (!falta('visto-bueno-legal')) {
    datos.legales['privacidad.md'] = quitarTexto(datos.legales['privacidad.md'], MARCA_BASE_DPD);
    datos.lanzamiento.vistos_buenos.legal.fecha = '2026-10-02';
  }
  if (!falta('visto-bueno-medico')) datos.lanzamiento.vistos_buenos.medico.fecha = '2026-10-01';
  return datos;
}

// Lo contrario: deja sin resolver cada imprescindible, aunque la clínica ya haya mandado lo suyo.
function sinResolver(datos) {
  datos.sitio.correo = null;
  datos.sitio.dpd = null;
  for (const p of datos.equipo.personas) p.colegiado = null;
  const esp = (slug) => datos.especialidades.especialidades.find((e) => e.slug === slug);
  esp('cirugia-capilar').donde_cirugia = null;
  esp('medicina-capilar').pendiente = esp('medicina-capilar').pendiente || 'qué cubre la unidad U.900 de la autorización en medicina capilar';
  esp('estetica-intima-femenina').pendiente = esp('estetica-intima-femenina').pendiente || 'qué servicios de la zona íntima cubre la autorización (la ginecología, U.26, no figura)';
  for (const c of datos.contenidos) {
    for (const p of c.paginas || []) {
      if (p.slug === 'diagnostico-capilar') p.sesion.profesional = '[PENDIENTE: profesión y titulación de quien hace el diagnóstico]';
      if (p.slug === 'lipolaser') p.confirmar = [...(p.confirmar || []), { tipo: 'oferta', que: 'Pregunta de prueba: ¿se ofrece?' }];
    }
  }
  datos.lanzamiento.vistos_buenos.medico.fecha = null;
  datos.lanzamiento.vistos_buenos.legal.fecha = null;
  return datos;
}

module.exports = { resolverImprescindibles, sinResolver, CIRUJANA, MEDICA, TECNICA };
