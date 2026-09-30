'use strict';
// Lo que falta para publicar (web/datos/lanzamiento.json): clasifica cada [PENDIENTE: …] que se ve y
// cada cosa que falta según los datos (las páginas con algo por confirmar, quien se nombra sin su
// colegiación), aplica al publicar las redacciones neutras de la clase «b» y las alternativas que haya
// decidido la clínica, y dice qué imprescindibles («a») quedan. Lo usa web/construir.js; el detalle de
// cada dato está en el propio JSON y en docs/LANZAR-WEB.md.
const fs = require('fs');
const path = require('path');

const RUTA = path.join(__dirname, '..', 'datos', 'lanzamiento.json');
const CLASES = { a: 'imprescindible', b: 'se oculta hasta tenerlo', c: 'completado con una fuente oficial' };
// Lo que se pide confirmar en una página (web/contenido/*.json → «confirmar»).
const TIPOS_CONFIRMAR = {
  oferta: 'Que se ofrece',
  producto: 'Producto y régimen legal',
  autorizacion: 'Autorización',
  abogado: 'Para el abogado sanitario',
};

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

// Quita las preguntas frecuentes ({p, r}) cuya pregunta es exactamente `pregunta`; devuelve cuántas.
function quitarPregunta(obj, pregunta) {
  let n = 0;
  const recorrer = (v) => {
    if (Array.isArray(v)) {
      for (let i = v.length - 1; i >= 0; i--) {
        const x = v[i];
        if (x && typeof x === 'object' && !Array.isArray(x) && x.p === pregunta && typeof x.r === 'string') { v.splice(i, 1); n++; } else recorrer(x);
      }
      return;
    }
    if (v && typeof v === 'object') for (const k of Object.keys(v)) recorrer(v[k]);
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

// Con --publicar: primero las redacciones (un texto exacto por otro), después las preguntas que se
// quitan enteras y al final «quitar» (la marca y el espacio de delante, también entre comillas
// invertidas en los .md). Devuelve qué se ha aplicado.
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
    for (const pregunta of (d.en_publicacion && d.en_publicacion.quitar_preguntas) || []) {
      let veces = 0;
      for (const [, obj] of f) veces += quitarPregunta(obj, pregunta);
      hecho.push({ dato: d.id, quitar_pregunta: pregunta, veces });
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

// Las alternativas que decide la clínica para lanzar sin algo imprescindible (lanzamiento.json →
// alternativas.aplicar), solo con --publicar: la web sale sin esas páginas (y sin las especialidades
// que se quedan vacías: fuera de menús, portada y listados), con sus tratamientos del catálogo en «sin
// página» (así no nacen provisionales) y con las redacciones que quitan lo que las anunciaba en otras
// páginas. «sin_confirmar»: además, las páginas con algo por confirmar («confirmar»).
function aplicarAlternativas(datos, lanzamiento) {
  const alt = lanzamiento.alternativas || {};
  const hecho = [];
  for (const id of alt.aplicar || []) {
    const a = (alt.lista || []).find((x) => x.id === id);
    if (!a) throw new Error(`lanzamiento.json: no conozco la alternativa «${id}»`);
    const especialidades = new Set(a.especialidades || []);
    const paginas = new Set(a.paginas || []);
    const fuera = [];
    for (const c of datos.contenidos) {
      const quedan = [];
      for (const p of c.paginas || []) {
        const sale = especialidades.has(p.especialidad) || paginas.has(p.slug) || (a.sin_confirmar && (p.confirmar || []).length > 0);
        if (!sale) { quedan.push(p); continue; }
        fuera.push(`/${p.especialidad}/${p.slug}/`);
        c.sin_pagina = c.sin_pagina || [];
        const ids = new Set([...(p.catalogo || []), ...(p.variantes || []).map((v) => v.catalogo).filter(Boolean)]);
        for (const catalogo of ids) c.sin_pagina.push({ catalogo, motivo: `No se publica todavía: la clínica ha decidido lanzar «${a.titulo}» (lanzamiento.json → alternativas). Vuelve cuando llegue lo que falta.` });
      }
      c.paginas = quedan;
    }
    const redacciones = aplicarRedacciones(datos, { datos: [{ id: `alternativa:${a.id}`, en_publicacion: { redacciones: a.redacciones || [], quitar_preguntas: a.quitar_preguntas || [] } }] });
    hecho.push({ alternativa: a.id, paginas: fuera, redacciones });
  }
  return hecho;
}

// Marca visible → su dato.
function clasificador(lanzamiento) {
  const porMarca = new Map();
  for (const d of lanzamiento.datos) for (const m of d.marcas || []) porMarca.set(m, d);
  return (marca) => porMarca.get(marca) || null;
}

// El estado del lanzamiento con las marcas que se ven, las obligatorias que faltan y lo que falta según
// los datos («faltas»: [{ comprobacion, ruta, que }], que cuentan en el dato con esa «comprobacion»):
// cada dato con cuántas cosas le quedan, los imprescindibles sin resolver y lo que no está clasificado.
function estado(lanzamiento, { marcas, obligatoriasPendientes = [], faltas = [], publicar = false }) {
  const dato = clasificador(lanzamiento);
  const porDato = new Map(lanzamiento.datos.map((d) => [d.id, { n: 0, paginas: new Set(), ejemplo: null, detalle: [] }]));
  const sinClasificar = new Map();
  const contar = (d, ruta) => {
    const e = porDato.get(d.id);
    e.n++;
    e.paginas.add(ruta);
    if (!e.ejemplo) e.ejemplo = ruta;
    return e;
  };
  for (const x of marcas) {
    for (const m of x.lista) {
      const d = dato(m);
      if (!d) {
        if (!sinClasificar.has(m)) sinClasificar.set(m, new Set());
        sinClasificar.get(m).add(x.ruta);
        continue;
      }
      contar(d, x.ruta);
    }
  }
  // Las obligatorias que faltan (el correo o el número de colegiado del aviso legal) cuentan en su dato.
  for (const o of obligatoriasPendientes) {
    const d = lanzamiento.datos.find((x) => (x.obligatorias || []).includes(o.patron));
    if (d) contar(d, o.ruta); else sinClasificar.set(`obligatoria: ${o.patron}`, new Set([o.ruta]));
  }
  for (const f of faltas) {
    const d = lanzamiento.datos.find((x) => x.comprobacion === f.comprobacion);
    if (d) contar(d, f.ruta).detalle.push({ ruta: f.ruta, que: f.que, ...(f.tipo ? { tipo: f.tipo } : {}) });
    else sinClasificar.set(`comprobación: ${f.comprobacion}`, new Set([f.ruta]));
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
      ...(e.detalle.length ? { detalle: e.detalle } : {}),
    };
  });
  const imprescindibles = resumen.filter((r) => r.clase === 'a' && !r.resuelto).map((r) => {
    const d = lanzamiento.datos.find((x) => x.id === r.id);
    return {
      dato: r.id, titulo: d.titulo, falta: d.falta, responsable: d.responsable, paginas: r.paginas, ejemplo: r.ejemplo, como_completar: d.como_completar,
      ...(r.detalle ? { detalle: r.detalle } : {}),
    };
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
  [/class="nota-interna|Nota para la revisión|no se publicará/, 'nota para la revisión'],
  [/class="aviso-borrador-legal"/, 'aviso de borrador legal'],
  [/class="franja-borrador"|Borrador: pendiente de autorización/, 'franja de borrador'],
  [/class="aviso-provisional"|página provisional/, 'página provisional'],
  [/\{\{[a-z_]+\}\}|\{donde_cirugia\}|\{areas\}/, 'dato de plantilla sin rellenar'],
];
function textosDeTrabajo(html) {
  return TEXTOS_DE_TRABAJO.filter(([re]) => re.test(html)).map(([, nombre]) => nombre);
}

module.exports = {
  cargarLanzamiento, aplicarRedacciones, aplicarAlternativas, clasificador, estado, textosDeTrabajo, quitarPregunta,
  CLASES, TIPOS_CONFIRMAR, TEXTOS_DE_TRABAJO,
};
