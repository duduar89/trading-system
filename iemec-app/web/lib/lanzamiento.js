'use strict';
// Lo que falta para publicar (web/datos/lanzamiento.json): clasifica cada [PENDIENTE: …] que se ve,
// aplica las redacciones neutras de la clase «b» al publicar y dice qué imprescindibles («a»)
// quedan. Lo usa web/construir.js; el detalle de cada dato está en el propio JSON y en
// docs/LANZAR-WEB.md.
const fs = require('fs');
const path = require('path');

const RUTA = path.join(__dirname, '..', 'datos', 'lanzamiento.json');
const CLASES = { a: 'imprescindible', b: 'se oculta hasta tenerlo', c: 'completado con una fuente oficial' };

function cargarLanzamiento(ruta = RUTA) {
  return JSON.parse(fs.readFileSync(ruta, 'utf8'));
}

const escaparRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Cambia `buscar` (texto exacto o expresión) en todas las cadenas de un objeto; devuelve cuántas veces.
function cambiarEnObjeto(obj, buscar, por) {
  let n = 0;
  const cambiar = (s) => {
    const partes = typeof buscar === 'string' ? s.split(buscar) : null;
    if (partes) { n += partes.length - 1; return partes.join(por); }
    return s.replace(buscar, () => { n++; return por; });
  };
  const recorrer = (v) => {
    if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) { if (typeof v[i] === 'string') v[i] = cambiar(v[i]); else recorrer(v[i]); } return; }
    if (v && typeof v === 'object') for (const k of Object.keys(v)) { if (typeof v[k] === 'string') v[k] = cambiar(v[k]); else recorrer(v[k]); }
  };
  recorrer(obj);
  return n;
}

// Las fuentes de texto a las que se aplican las redacciones, por su ruta dentro de web/.
function fuentes(datos) {
  const f = new Map();
  for (const c of datos.contenidos) f.set(`contenido/${c.fichero}`, c);
  f.set('datos/especialidades.json', datos.especialidades);
  f.set('datos/sitio.json', datos.sitio);
  f.set('datos/equipo.json', datos.equipo);
  f.set('datos/tarjetas.json', datos.tarjetas);
  f.set('contenido/legal', datos.legales); // { 'aviso-legal.md': texto, … }
  return f;
}
const objetoDe = (f, archivo) => (archivo.startsWith('contenido/legal/')
  ? { obj: f.get('contenido/legal'), clave: archivo.slice('contenido/legal/'.length) }
  : { obj: f.get(archivo), clave: null });

// Con --publicar: primero las redacciones (un texto exacto por otro) y después «quitar» (la marca y el
// espacio de delante, también entre comillas invertidas en los .md). Devuelve qué se ha aplicado.
function aplicarRedacciones(datos, lanzamiento) {
  const f = fuentes(datos);
  const hecho = [];
  for (const d of lanzamiento.datos) {
    for (const r of (d.en_publicacion && d.en_publicacion.redacciones) || []) {
      const { obj, clave } = objetoDe(f, r.archivo);
      if (!obj) throw new Error(`lanzamiento.json (${d.id}): no conozco el archivo ${r.archivo}`);
      let veces;
      if (clave) {
        const texto = obj[clave];
        if (typeof texto !== 'string') throw new Error(`lanzamiento.json (${d.id}): no conozco el texto legal ${clave}`);
        const partes = texto.split(r.buscar);
        veces = partes.length - 1;
        obj[clave] = partes.join(r.cambiar_por);
      } else {
        veces = cambiarEnObjeto(obj, r.buscar, r.cambiar_por);
      }
      hecho.push({ dato: d.id, archivo: r.archivo, buscar: r.buscar, veces });
    }
  }
  for (const d of lanzamiento.datos) {
    for (const m of (d.en_publicacion && d.en_publicacion.quitar) || []) {
      // Los .md parten las líneas largas: un espacio de la marca vale por cualquier espacio o salto.
      const re = new RegExp(`[ \\t\\n]?\`?${escaparRe(m).replace(/ /g, '\\s+')}\`?`, 'g');
      let veces = 0;
      for (const [, obj] of f) veces += cambiarEnObjeto(obj, re, '');
      hecho.push({ dato: d.id, quitar: m, veces });
    }
  }
  return hecho;
}

// Marca visible → su dato.
function clasificador(lanzamiento) {
  const porMarca = new Map();
  for (const d of lanzamiento.datos) for (const m of d.marcas || []) porMarca.set(m, d);
  return (marca) => porMarca.get(marca) || null;
}

// El estado del lanzamiento con las marcas que se ven (y las obligatorias que faltan):
// cada dato con cuántas marcas quedan, los imprescindibles sin resolver y lo que no está clasificado.
function estado(lanzamiento, { marcas, obligatoriasPendientes = [], publicar = false }) {
  const dato = clasificador(lanzamiento);
  const porDato = new Map(lanzamiento.datos.map((d) => [d.id, { n: 0, paginas: new Set(), ejemplo: null }]));
  const sinClasificar = new Map();
  for (const x of marcas) {
    for (const m of x.lista) {
      const d = dato(m);
      if (!d) {
        if (!sinClasificar.has(m)) sinClasificar.set(m, new Set());
        sinClasificar.get(m).add(x.ruta);
        continue;
      }
      const e = porDato.get(d.id);
      e.n++;
      e.paginas.add(x.ruta);
      if (!e.ejemplo) e.ejemplo = x.ruta;
    }
  }
  // Las obligatorias que faltan (el correo del aviso legal) cuentan en su dato.
  for (const o of obligatoriasPendientes) {
    const d = lanzamiento.datos.find((x) => (x.obligatorias || []).includes(o.patron));
    if (d) { const e = porDato.get(d.id); e.n++; e.paginas.add(o.ruta); e.ejemplo = e.ejemplo || o.ruta; } else sinClasificar.set(`obligatoria: ${o.patron}`, new Set([o.ruta]));
  }
  const vb = lanzamiento.vistos_buenos || {};
  const vistoBueno = (clave) => !!(vb[clave] && typeof vb[clave].fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(vb[clave].fecha));
  const resumen = lanzamiento.datos.map((d) => {
    const e = porDato.get(d.id);
    const pendienteVb = d.visto_bueno ? !vistoBueno(d.visto_bueno) : false;
    return {
      id: d.id, clase: d.clase, titulo: d.titulo, responsable: d.responsable || null,
      marcas_visibles: e.n, paginas: e.paginas.size, ejemplo: e.ejemplo,
      resuelto: e.n === 0 && !pendienteVb,
      ...(d.visto_bueno ? { visto_bueno: vistoBueno(d.visto_bueno) ? vb[d.visto_bueno].fecha : null } : {}),
    };
  });
  const imprescindibles = resumen.filter((r) => r.clase === 'a' && !r.resuelto).map((r) => {
    const d = lanzamiento.datos.find((x) => x.id === r.id);
    return { dato: r.id, titulo: d.titulo, falta: d.falta, responsable: d.responsable, paginas: r.paginas, ejemplo: r.ejemplo, como_completar: d.como_completar };
  });
  // Al publicar, una marca de «b» o «c» que se sigue viendo es una redacción neutra que no se ha
  // aplicado (o un dato completado que se ha perdido): también para.
  const sinNeutralizar = publicar ? resumen.filter((r) => r.clase !== 'a' && r.marcas_visibles).map((r) => ({ dato: r.id, clase: r.clase, paginas: r.paginas, ejemplo: r.ejemplo })) : [];
  return {
    resumen,
    imprescindibles,
    sin_neutralizar: sinNeutralizar,
    sin_clasificar: [...sinClasificar].map(([marca, rutas]) => ({ marca, paginas: rutas.size, ejemplo: [...rutas][0] })),
  };
}

// Lo que no puede llegar a una página publicada: marcas, notas para la revisión, franjas de borrador,
// textos provisionales y llaves de plantilla sin rellenar.
const TEXTOS_DE_TRABAJO = [
  [/\[PENDIENTE/, 'marca [PENDIENTE]'],
  [/class="pendiente"/, 'marca amarilla'],
  [/class="nota-interna"|Nota para la revisión|no se publicará/, 'nota para la revisión'],
  [/class="aviso-borrador-legal"/, 'aviso de borrador legal'],
  [/class="franja-borrador"|Borrador: pendiente de autorización/, 'franja de borrador'],
  [/class="aviso-provisional"|página provisional/, 'página provisional'],
  [/\{\{[a-z_]+\}\}|\{donde_cirugia\}/, 'dato de plantilla sin rellenar'],
];
function textosDeTrabajo(html) {
  return TEXTOS_DE_TRABAJO.filter(([re]) => re.test(html)).map(([, nombre]) => nombre);
}

module.exports = { cargarLanzamiento, aplicarRedacciones, clasificador, estado, textosDeTrabajo, CLASES, TEXTOS_DE_TRABAJO };
