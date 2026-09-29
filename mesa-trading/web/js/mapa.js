// Plano del parqué (28×22 teselas, §8 y propuesta-visual §4.2): salas, paredes
// con puertas, muebles, sitios de cada agente y rutas entre salas.
//
// Todo en coordenadas de rejilla (col, fila); nada de píxeles ni de canvas, para
// poder probarlo en Node. Determinista: la misma instantánea da el mismo plano
// y los mismos sitios, así que un agente no cambia de silla al recargar.
(function (raiz, fabrica) {
  const mod = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (raiz.Parque = raiz.Parque || {}).mapa = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const COLS = 28;
  const FILAS = 22;
  const CELDA = 0.5;                 // rejilla de rutas: media tesela
  const ANCHO_PUERTA = 1.5;
  const ALTO_PARED_EXTERIOR = 88;    // paredes del fondo (fila 0 y col 0): llevan pantallas y ventanas
  const ALTO_PARED_INTERIOR = 22;    // tabiques bajos: dejan ver a quien pasa detrás
  const GROSOR_PARED = 0.2;

  // Copia de §6.1 por si la instantánea llega sin departamentos (maqueta a medias).
  const DEPARTAMENTOS_POR_DEFECTO = [
    { id: 'direccion', nombre: 'Dirección', color: '#f5b942', sala: 'direccion' },
    { id: 'macro', nombre: 'Macro', color: '#8b5cf6', sala: 'macro' },
    { id: 'analisis', nombre: 'Análisis', color: '#22c55e', sala: 'analisis' },
    { id: 'mesas', nombre: 'Mesas', color: '#3b82f6', sala: 'parque' },
    { id: 'riesgos', nombre: 'Riesgos', color: '#ef4444', sala: 'riesgos' },
    { id: 'operaciones', nombre: 'Operaciones', color: '#f97316', sala: 'riesgos' },
    { id: 'laboratorio', nombre: 'Laboratorio', color: '#06b6d4', sala: 'laboratorio' },
  ];

  // Salas: rectángulos [c0,c1)×[f0,f1) que cubren el plano sin solaparse.
  // Laboratorio y análisis se reparten 5+3 filas (el boceto daba 2 al
  // laboratorio, donde no caben dos mesas con silla).
  const SALAS = {
    parque: { id: 'parque', nombre: 'Parqué', c0: 0, f0: 0, c1: 20, f1: 16, suelo: '#d9dde6', elevacion: 0 },
    direccion: { id: 'direccion', nombre: 'Dirección', c0: 20, f0: 0, c1: 28, f1: 4, suelo: '#c9a27a', elevacion: 0 },
    macro: { id: 'macro', nombre: 'Macro', c0: 20, f0: 4, c1: 28, f1: 8, suelo: '#cdb8f0', elevacion: 14 },
    analisis: { id: 'analisis', nombre: 'Análisis', c0: 20, f0: 8, c1: 28, f1: 13, suelo: '#bfe3c8', elevacion: 0 },
    laboratorio: { id: 'laboratorio', nombre: 'Laboratorio', c0: 20, f0: 13, c1: 28, f1: 16, suelo: '#bfe7ec', elevacion: 0 },
    riesgos: { id: 'riesgos', nombre: 'Riesgos · Operaciones', c0: 0, f0: 16, c1: 10, f1: 22, suelo: '#f1c9c9', elevacion: 0 },
    comite: { id: 'comite', nombre: 'Sala de comité', c0: 10, f0: 16, c1: 20, f1: 22, suelo: '#b98b5e', elevacion: 0 },
    descanso: { id: 'descanso', nombre: 'Descanso', c0: 20, f0: 16, c1: 28, f1: 22, suelo: '#f3e3c2', elevacion: 0 },
  };
  const ORDEN_SALAS = ['parque', 'direccion', 'macro', 'analisis', 'laboratorio', 'riesgos', 'comite', 'descanso'];

  // Tabiques interiores. eje 'col' = la línea col = en (corre a lo largo de las filas).
  // `puertas` son los centros de los huecos, de ANCHO_PUERTA de ancho.
  const PAREDES = [
    { id: 'parque-derecha', eje: 'col', en: 20, desde: 0, hasta: 16, puertas: [2, 6, 10.5, 14.5] },
    { id: 'direccion-macro', eje: 'fila', en: 4, desde: 20, hasta: 28, puertas: [] },
    { id: 'macro-analisis', eje: 'fila', en: 8, desde: 20, hasta: 28, puertas: [] },
    { id: 'analisis-laboratorio', eje: 'fila', en: 13, desde: 20, hasta: 28, puertas: [] },
    { id: 'parque-abajo', eje: 'fila', en: 16, desde: 0, hasta: 28, puertas: [5, 15, 21.5] },
    { id: 'riesgos-comite', eje: 'col', en: 10, desde: 16, hasta: 22, puertas: [] },
    { id: 'comite-descanso', eje: 'col', en: 20, desde: 16, hasta: 22, puertas: [] },
  ];

  const ORDEN_FIJOS = ['cio', 'controller', 'macro', 'riesgos', 'ejecutor', 'laboratorio', 'auditor'];

  // ---------- utilidades ----------

  const dentro = (sala, col, fila) => col >= sala.c0 && col < sala.c1 && fila >= sala.f0 && fila < sala.f1;

  function salaEn(col, fila) {
    for (const id of ORDEN_SALAS) if (dentro(SALAS[id], col, fila)) return id;
    return null;
  }

  // Altura del suelo: la sala de macro está sobre una tarima; en la puerta hay rampa corta.
  function elevacionEn(col, fila) {
    const s = SALAS.macro;
    if (!dentro(s, col, fila)) return 0;
    const d = Math.min(col - s.c0, s.c1 - col, fila - s.f0, s.f1 - fila);
    return s.elevacion * Math.min(1, Math.max(0, d / 0.35));
  }

  function departamentosDe(departamentos) {
    return Array.isArray(departamentos) && departamentos.length ? departamentos : DEPARTAMENTOS_POR_DEFECTO;
  }

  // Sala en la que tiene que estar un agente: la que dice la instantánea; si no
  // es válida, la de su departamento (§6.1); si tampoco, el parqué.
  function salaDeAgente(agente, departamentos) {
    if (agente && SALAS[agente.sala]) return agente.sala;
    const dep = departamentosDe(departamentos).find(d => d.id === (agente && agente.departamento));
    return dep && SALAS[dep.sala] ? dep.sala : 'parque';
  }

  function salaCasa(agente, departamentos) {
    const dep = departamentosDe(departamentos).find(d => d.id === (agente && agente.departamento));
    return dep && SALAS[dep.sala] ? dep.sala : 'parque';
  }

  // Firma de lo que cambia el plano (mesas, puestos, plantilla). Si no cambia, no se reconstruye.
  function firmaEstructura(inst) {
    if (!inst) return '';
    const m = (inst.mesas || []).map(x => x.id + ':' + (x.estado || '')).join(',');
    const p = (inst.puestos || []).map(x => x.id).join(',');
    const a = (inst.agentes || []).map(x => x.id + ':' + x.departamento).join(',');
    return m + '|' + p + '|' + a;
  }

  // ---------- construcción del plano ----------

  function construirMapa(entrada) {
    const e = entrada || {};
    const mesas = Array.isArray(e.mesas) ? e.mesas : [];
    const puestos = Array.isArray(e.puestos) ? e.puestos : [];
    const agentes = Array.isArray(e.agentes) ? e.agentes : [];
    const departamentos = departamentosDe(e.departamentos);

    const muebles = [];
    const sitios = {};
    for (const id of ORDEN_SALAS) sitios[id] = [];
    const geoPuestos = new Map();
    const rotulosFila = [];
    let n = 0;

    const nuevoMueble = (tipo, sala, c0, f0, c1, f1, alto, extra) => {
      const z = extra && extra.z !== undefined ? extra.z : SALAS[sala].elevacion;
      const m = Object.assign({ id: `${sala}-${tipo}-${n++}`, tipo, sala, c0, f0, c1, f1, z, alto, bloquea: true }, extra || {});
      m.z = z;
      if (m.clave === undefined) m.clave = (c0 + c1) / 2 + (f0 + f1) / 2;
      muebles.push(m);
      return m;
    };

    const nuevoSitio = (sala, col, fila, mira, postura, extra) => {
      const s = Object.assign({ id: `${sala}-sitio-${sitios[sala].length}`, sala, col, fila, mira, postura }, extra || {});
      sitios[sala].push(s);
      return s;
    };

    // Silla: asiento (antes que quien se sienta) y respaldo (después si queda
    // entre la persona y quien mira, antes si queda detrás).
    const silla = (sala, col, fila, mira, color, extra) => {
      const z = SALAS[sala].elevacion;
      const clave = col + fila;
      nuevoMueble('silla', sala, col - 0.22, fila - 0.22, col + 0.22, fila + 0.22, 9,
        { bloquea: false, mira, color: color || '#2f3a56', clave: clave - 0.02, z });
      const detras = { N: [0, 0.3], S: [0, -0.3], E: [-0.3, 0], O: [0.3, 0] }[mira];
      const cc = col + detras[0];
      const ff = fila + detras[1];
      nuevoMueble('respaldo', sala, cc - 0.2, ff - 0.2, cc + 0.2, ff + 0.2, 20,
        { bloquea: false, mira, color: color || '#2f3a56', clave: clave + (detras[0] + detras[1]) + (mira === 'N' || mira === 'O' ? 0.01 : 0), z });
      return nuevoSitio(sala, col, fila, mira, 'sentado', extra);
    };

    // Fila de mesas mirando al norte (hacia la pared del fondo): la persona da
    // la espalda a quien mira el parqué y los monitores se ven de frente.
    const filaDeMesas = (sala, o) => {
      const cant = o.n;
      if (!cant) return [];
      const hueco = o.hueco || 0;
      const ancho = Math.min(o.anchoMax, (o.c1 - o.c0) / cant);
      const inicio = (o.c0 + o.c1) / 2 - (ancho * cant) / 2;
      const fondo = o.fondo || 0.9;
      const salida = [];
      for (let i = 0; i < cant; i++) {
        const c0 = inicio + i * ancho + hueco / 2;
        const c1 = inicio + (i + 1) * ancho - hueco / 2;
        const mesa = nuevoMueble('mesa', sala, c0, o.fila, c1, o.fila + fondo, o.alto || 18,
          { color: o.color || '#f4f5f8', puestoId: o.puestos ? o.puestos[i] : undefined, continua: !hueco });
        const cm = (c0 + c1) / 2;
        const nMon = o.monitores !== undefined ? o.monitores : (c1 - c0 >= 1.5 ? 2 : 1);
        const monitores = [];
        const anchoMon = nMon >= 3 ? Math.min(0.6, (c1 - c0) / 3.4) : nMon === 2 ? Math.min(0.66, (c1 - c0) * 0.36) : Math.min(0.72, (c1 - c0) * 0.55);
        for (let k = 0; k < nMon; k++) {
          const centro = nMon === 1 ? cm : c0 + (c1 - c0) * (k + 0.5) / nMon;
          const mon = nuevoMueble('monitor', sala, centro - anchoMon / 2, o.fila + 0.14, centro + anchoMon / 2, o.fila + 0.22, 18,
            { bloquea: false, z: mesa.z + mesa.alto, mira: 'S', clave: mesa.clave + 0.001 * (k + 1), puestoId: mesa.puestoId, indice: k, pantalla: o.pantalla || 'puesto' });
          monitores.push(mon);
        }
        if (!o.sinTeclado) {
          nuevoMueble('teclado', sala, cm - 0.28, o.fila + fondo - 0.34, cm + 0.28, o.fila + fondo - 0.14, 1,
            { bloquea: false, z: mesa.z + mesa.alto, clave: mesa.clave + 0.0005 });
        }
        const sitio = silla(sala, cm, o.fila + fondo + 0.45, 'N', o.colorSilla,
          Object.assign({ mesaMueble: mesa.id }, o.sitioExtra ? o.sitioExtra(i) : {}));
        salida.push({ mesa, monitores, sitio, c0, c1, fila: o.fila, fondo });
      }
      return salida;
    };

    // ----- Parqué: una fila por mesa (familia), un puesto por activo -----
    const porMesa = new Map();
    for (const m of mesas) porMesa.set(m.id, []);
    const huerfanos = [];
    for (const p of puestos) {
      if (porMesa.has(p.mesaId)) porMesa.get(p.mesaId).push(p);
      else huerfanos.push(p);
    }
    const grupos = mesas.map(m => ({ mesa: m, puestos: porMesa.get(m.id) })).filter(g => g.puestos.length);
    if (huerfanos.length) grupos.push({ mesa: { id: 'otros', nombre: 'Otros puestos', marco: '' }, puestos: huerfanos });

    // Con más de 6 mesas no cabe una fila por mesa: se juntan las que caben en 16 teselas.
    const MAX_ANCHO_FILA = 16;
    let filasParque = grupos.map(g => [g]);
    if (grupos.length > 6) {
      filasParque = [];
      let actual = [];
      let usado = 0;
      for (const g of grupos) {
        const w = g.puestos.length * 2;
        if (actual.length && usado + w > MAX_ANCHO_FILA) { filasParque.push(actual); actual = []; usado = 0; }
        actual.push(g);
        usado += w;
      }
      if (actual.length) filasParque.push(actual);
    }
    const nFilas = filasParque.length;
    const PRIMERA = 3.2;
    const paso = nFilas <= 1 ? 0 : Math.min(3, (12.9 - PRIMERA) / (nFilas - 1));
    // Todas las filas empiezan en la misma columna y con el mismo ancho de
    // puesto: los puestos quedan en columnas y el rótulo de cada mesa, a la
    // izquierda, no cae debajo de las etiquetas de otra fila.
    const INICIO_FILA = 2.6;
    const LARGO_FILA = 15.2;
    const masLarga = Math.max(1, ...filasParque.map(f => f.reduce((s, g) => s + g.puestos.length, 0)));
    const anchoPuesto = Math.min(2.5, LARGO_FILA / masLarga);
    filasParque.forEach((grupoFila, k) => {
      const fila = Math.round((PRIMERA + k * paso) * 100) / 100;
      const lista = [];
      for (const g of grupoFila) for (const p of g.puestos) lista.push({ p, mesa: g.mesa });
      const hechos = filaDeMesas('parque', {
        n: lista.length, c0: INICIO_FILA, c1: INICIO_FILA + anchoPuesto * lista.length, fila,
        anchoMax: anchoPuesto, hueco: anchoPuesto > 2.1 ? 0.28 : 0.1, fondo: 0.9, alto: 18, puestos: lista.map(x => x.p.id),
        sitioExtra: i => ({ puestoId: lista[i].p.id }),
      });
      hechos.forEach((h, i) => {
        const { p, mesa } = lista[i];
        geoPuestos.set(p.id, {
          puestoId: p.id, mesaId: p.mesaId, etiqueta: p.etiqueta, c0: h.c0, c1: h.c1, f0: fila, f1: fila + h.fondo,
          sitio: h.sitio, monitores: h.monitores.map(x => x.id), mesaMueble: h.mesa.id,
          ancla: { col: (h.c0 + h.c1) / 2, fila: fila + 0.18, z: h.mesa.alto + 34 },
          mesaNombre: mesa.nombre || mesa.id,
        });
      });
      // Rótulo de cada mesa al principio de su tramo de fila.
      let cursor = 0;
      for (const g of grupoFila) {
        const primero = hechos[cursor];
        rotulosFila.push({ mesaId: g.mesa.id, nombre: g.mesa.nombre || g.mesa.id, marco: g.mesa.marco || '', estado: g.mesa.estado || '',
          col: primero.c0 - 0.1, fila: fila + 0.18, z: primero.mesa.alto + 34 });
        cursor += g.puestos.length;
      }
    });

    // Visitas y mobiliario del parqué.
    [[18.9, 4.7, 'O'], [18.9, 6.9, 'O'], [18.9, 10.7, 'O'], [1.5, 5.2, 'E'], [1.5, 10.2, 'E'], [6.5, 1.7, 'N'], [13.5, 1.7, 'N']]
      .forEach(([c, f, mira]) => nuevoSitio('parque', c, f, mira, 'de_pie'));
    nuevoMueble('planta', 'parque', 0.3, 0.3, 0.95, 0.95, 30);
    nuevoMueble('planta', 'parque', 19.05, 0.3, 19.7, 0.95, 30);
    nuevoMueble('planta', 'parque', 0.3, 15.05, 0.95, 15.7, 30);
    nuevoMueble('planta', 'parque', 19.1, 15.15, 19.75, 15.8, 30);
    nuevoMueble('fuente', 'parque', 0.15, 7.9, 0.7, 8.45, 36);
    nuevoMueble('impresora', 'parque', 0.15, 12.2, 0.95, 12.95, 20);
    nuevoMueble('planta', 'parque', 19.1, 8.1, 19.75, 8.75, 30);
    nuevoMueble('mesaAlta', 'parque', 1.0, 13.7, 1.9, 14.6, 26, { color: '#f0ece4' });
    nuevoSitio('parque', 2.3, 14.15, 'O', 'de_pie');

    // ----- Dirección -----
    nuevoMueble('alfombra', 'direccion', 21.9, 1.9, 25.1, 3.7, 0, { bloquea: false, color: '#7c4a3a' });
    nuevoMueble('estanteria', 'direccion', 20.35, 0.1, 22.1, 0.55, 52, { clave: 20.45 });
    nuevoMueble('mesa', 'direccion', 22.4, 1.0, 24.6, 1.9, 20, { color: '#8b5a3c' });
    nuevoMueble('monitor', 'direccion', 23.15, 1.12, 23.85, 1.2, 18, { bloquea: false, z: 20, mira: 'S', clave: 23.5 + 1.45 + 0.001, pantalla: 'direccion' });
    silla('direccion', 23.5, 2.45, 'N', '#3a2a22', { preferente: 'cio' });
    nuevoMueble('mesaRedonda', 'direccion', 25.7, 1.9, 26.7, 2.9, 16, { color: '#9c6b48' });
    silla('direccion', 25.2, 2.4, 'E', '#3a2a22');
    silla('direccion', 27.2, 2.4, 'O', '#3a2a22');
    nuevoMueble('planta', 'direccion', 27.2, 0.2, 27.85, 0.85, 30);
    nuevoSitio('direccion', 21.3, 3.2, 'E', 'de_pie');

    // ----- Macro (tarima) -----
    nuevoMueble('mesa', 'macro', 22.6, 5.0, 25.4, 5.9, 18, { color: '#f4f5f8' });
    for (let k = 0; k < 3; k++) {
      const cc = 22.6 + 2.8 * (k + 0.5) / 3;
      nuevoMueble('monitor', 'macro', cc - 0.36, 5.14, cc + 0.36, 5.22, 18,
        { bloquea: false, z: 14 + 18, mira: 'S', clave: 24 + 5.45 + 0.001 * (k + 1), pantalla: k === 1 ? 'regimen' : 'macro', indice: k });
    }
    silla('macro', 24, 6.4, 'N', null, { preferente: 'macro' });
    nuevoSitio('macro', 21.6, 6.9, 'N', 'de_pie');
    nuevoSitio('macro', 26.5, 6.9, 'N', 'de_pie');
    nuevoMueble('planta', 'macro', 27.2, 4.2, 27.85, 4.85, 30);
    nuevoMueble('planta', 'macro', 20.25, 4.2, 20.9, 4.85, 30);

    // ----- Análisis: un sitio por analista (mínimo 6), en dos filas -----
    const analistas = agentes.filter(a => salaCasa(a, departamentos) === 'analisis');
    const nAn = Math.max(6, analistas.length);
    const porFila = Math.ceil(nAn / 2);
    const idsAn = analistas.map(a => a.id);
    filaDeMesas('analisis', { n: porFila, c0: 21.0, c1: 27.8, fila: 8.55, anchoMax: 1.75, hueco: 0.12, fondo: 0.8, alto: 17,
      monitores: 1, pantalla: 'analisis', sitioExtra: i => (idsAn[i] ? { preferente: idsAn[i] } : {}) });
    filaDeMesas('analisis', { n: nAn - porFila, c0: 21.0, c1: 27.8, fila: 10.85, anchoMax: 1.75, hueco: 0.12, fondo: 0.8, alto: 17,
      monitores: 1, pantalla: 'analisis', sitioExtra: i => (idsAn[porFila + i] ? { preferente: idsAn[porFila + i] } : {}) });
    nuevoSitio('analisis', 20.8, 12.4, 'E', 'de_pie');

    // ----- Laboratorio -----
    nuevoMueble('rack', 'laboratorio', 27.1, 13.2, 27.8, 13.9, 46, { color: '#1f2638' });
    const lab = agentes.filter(a => salaCasa(a, departamentos) === 'laboratorio').map(a => a.id);
    filaDeMesas('laboratorio', { n: 2, c0: 22.4, c1: 26.4, fila: 13.45, anchoMax: 1.9, hueco: 0.2, fondo: 0.8, alto: 17,
      monitores: 2, pantalla: 'laboratorio', sitioExtra: i => (lab[i] ? { preferente: lab[i] } : {}) });
    nuevoSitio('laboratorio', 21.2, 14.2, 'N', 'de_pie');
    nuevoSitio('laboratorio', 26.9, 15.3, 'O', 'de_pie');

    // ----- Riesgos + operaciones -----
    filaDeMesas('riesgos', { n: 2, c0: 0.6, c1: 4.4, fila: 17.3, anchoMax: 1.85, hueco: 0.15, fondo: 0.85, alto: 18,
      monitores: 2, pantalla: 'riesgos', sitioExtra: i => ({ preferente: ['riesgos', 'controller'][i] }) });
    filaDeMesas('riesgos', { n: 1, c0: 6.1, c1: 9.0, fila: 17.3, anchoMax: 2.9, fondo: 0.85, alto: 18,
      monitores: 3, pantalla: 'ejecucion', sitioExtra: () => ({ preferente: 'ejecutor' }) });
    nuevoMueble('archivador', 'riesgos', 9.1, 16.2, 9.8, 16.8, 30, { color: '#7d8699', clave: 9.45 + 16.3 });
    nuevoMueble('mesaRedonda', 'riesgos', 3.2, 19.8, 4.4, 21.0, 16, { color: '#e8e2d6' });
    nuevoSitio('riesgos', 2.7, 20.4, 'E', 'de_pie');
    nuevoSitio('riesgos', 4.9, 20.4, 'O', 'de_pie');
    nuevoSitio('riesgos', 6.8, 20.3, 'N', 'de_pie');
    nuevoMueble('planta', 'riesgos', 9.1, 21.1, 9.75, 21.75, 30);
    nuevoMueble('planta', 'riesgos', 0.25, 21.1, 0.9, 21.75, 30);

    // ----- Comité: mesa larga en tres tramos (para ordenar bien quién tapa a quién) -----
    for (let k = 0; k < 3; k++) {
      nuevoMueble('mesaComite', 'comite', 12 + 2 * k, 18.3, 14 + 2 * k, 19.9, 17, { color: '#7a4b2a', tramo: k });
    }
    silla('comite', 18.55, 19.1, 'O', '#2a2f45', { preferente: 'cio', cedible: true });
    [12.75, 14.25, 15.75, 17.25].forEach(c => silla('comite', c, 17.75, 'S', '#2a2f45'));
    silla('comite', 11.45, 19.1, 'E', '#2a2f45');
    [12.75, 14.25, 15.75, 17.25].forEach(c => silla('comite', c, 20.45, 'N', '#2a2f45'));
    nuevoMueble('planta', 'comite', 19.15, 16.25, 19.8, 16.9, 30);
    nuevoMueble('planta', 'comite', 10.25, 21.15, 10.9, 21.8, 30);
    nuevoSitio('comite', 11.2, 17.2, 'E', 'de_pie');
    nuevoSitio('comite', 19.2, 21.2, 'N', 'de_pie');

    // ----- Descanso: sofás, mesa baja, máquina y café -----
    nuevoMueble('alfombra', 'descanso', 21.6, 17.6, 25.2, 20.6, 0, { bloquea: false, color: '#c9a86e' });
    nuevoMueble('sofa', 'descanso', 22.4, 16.25, 25.0, 17.05, 16, { color: '#3b6fd8', mira: 'S', clave: 22.4 + 16.25 });
    nuevoMueble('sofa', 'descanso', 20.2, 18.2, 21.0, 20.8, 16, { color: '#3b6fd8', mira: 'E', clave: 20.2 + 18.2 });
    nuevoMueble('mesaBaja', 'descanso', 22.2, 18.3, 24.2, 19.3, 9, { color: '#8b5a3c' });
    nuevoMueble('expendedora', 'descanso', 25.4, 16.15, 26.3, 16.95, 50, { color: '#c0392b' });
    nuevoMueble('cafetera', 'descanso', 26.5, 16.15, 27.85, 16.85, 22, { color: '#e7e2d8' });
    nuevoMueble('mesaAlta', 'descanso', 25.9, 19.8, 26.8, 20.7, 26, { color: '#f0ece4' });
    nuevoMueble('planta', 'descanso', 27.2, 21.2, 27.85, 21.85, 30);
    nuevoMueble('planta', 'descanso', 20.2, 21.2, 20.85, 21.85, 30);
    [23.0, 23.7, 24.4].forEach(c => nuevoSitio('descanso', c, 16.75, 'S', 'sentado', { enSofa: true }));
    [18.9, 20.1].forEach(f => nuevoSitio('descanso', 20.65, f, 'E', 'sentado', { enSofa: true }));
    nuevoSitio('descanso', 25.85, 17.55, 'N', 'de_pie');
    nuevoSitio('descanso', 27.15, 17.45, 'N', 'de_pie');
    nuevoSitio('descanso', 25.45, 20.25, 'E', 'de_pie');
    nuevoSitio('descanso', 27.25, 20.25, 'O', 'de_pie');

    // Decoración de las dos paredes del fondo y de algunos tabiques.
    const decoraciones = [
      { tipo: 'pantallaGigante', pared: 'fila0', desde: 2, hasta: 18, z0: 12, z1: 108 },
      { tipo: 'relojes', pared: 'col0', desde: 0.9, hasta: 4.3, z0: 50, z1: 72 },
      { tipo: 'ventana', pared: 'col0', desde: 5.0, hasta: 7.4, z0: 24, z1: 78 },
      { tipo: 'ventana', pared: 'col0', desde: 9.0, hasta: 11.4, z0: 24, z1: 78 },
      { tipo: 'ventana', pared: 'col0', desde: 13.0, hasta: 15.4, z0: 24, z1: 78 },
      { tipo: 'limites', pared: 'col0', desde: 16.6, hasta: 21.4, z0: 26, z1: 78 },
      { tipo: 'ventana', pared: 'fila0', desde: 23.2, hasta: 27.4, z0: 24, z1: 78 },
      { tipo: 'rotuloParque', pared: 'fila0', desde: 18.4, hasta: 19.9, z0: 40, z1: 70 },
    ];
    const pantallasPared = [
      { id: 'pared-regimen', tipo: 'pantallaSala', contenido: 'regimen', eje: 'fila', en: 4, desde: 22.3, hasta: 25.7, z0: 28, z1: 62 },
      { id: 'pared-comite', tipo: 'pantallaSala', contenido: 'comite', eje: 'col', en: 10, desde: 17.3, hasta: 20.9, z0: 14, z1: 50 },
      { id: 'pared-lab', tipo: 'pizarra', contenido: 'laboratorio', eje: 'fila', en: 13, desde: 20.5, hasta: 22.2, z0: 10, z1: 38 },
      { id: 'pared-analisis', tipo: 'pizarra', contenido: 'analisis', eje: 'fila', en: 8, desde: 25.4, hasta: 27.6, z0: 10, z1: 38 },
    ];

    // Trozos de tabique de ≤ 1 tesela, para ordenarlos con los personajes.
    const trozosPared = [];
    for (const p of PAREDES) {
      const huecos = p.puertas.map(c => [c - ANCHO_PUERTA / 2, c + ANCHO_PUERTA / 2]);
      const tramos = [];
      let ini = p.desde;
      for (const [a, b] of huecos.sort((x, y) => x[0] - y[0])) {
        if (a > ini) tramos.push([ini, a]);
        ini = Math.max(ini, b);
      }
      if (ini < p.hasta) tramos.push([ini, p.hasta]);
      for (const [a, b] of tramos) {
        for (let x = a; x < b - 1e-9; x = Math.min(b, Math.floor(x + 1 + 1e-9))) {
          const y = Math.min(b, Math.floor(x + 1 + 1e-9));
          const elev = Math.max(elevLinea(p, x, y));
          const pieza = p.eje === 'col'
            ? { c0: p.en - GROSOR_PARED / 2, c1: p.en + GROSOR_PARED / 2, f0: x, f1: y }
            : { c0: x, c1: y, f0: p.en - GROSOR_PARED / 2, f1: p.en + GROSOR_PARED / 2 };
          pieza.id = `${p.id}-${trozosPared.length}`;
          pieza.tipo = 'pared';
          pieza.alto = ALTO_PARED_INTERIOR + elev;
          pieza.clave = (pieza.c0 + pieza.c1) / 2 + (pieza.f0 + pieza.f1) / 2;
          pieza.pared = p.id;
          pieza.inicioHueco = huecos.some(h => Math.abs(h[1] - x) < 1e-6);
          pieza.finHueco = huecos.some(h => Math.abs(h[0] - y) < 1e-6);
          trozosPared.push(pieza);
        }
      }
    }

    const mapa = {
      cols: COLS, filas: FILAS, salas: SALAS, paredes: PAREDES, trozosPared, muebles, sitios, puestos: geoPuestos,
      rotulosFila, decoraciones, pantallasPared, rejilla: null,
    };
    mapa.rejilla = construirRejilla(muebles);
    return mapa;
  }

  // Un tabique que linda con la tarima de macro sube con ella.
  function elevLinea(p, desde, hasta) {
    const s = SALAS.macro;
    if (p.eje === 'col') {
      if ((p.en === s.c0 || p.en === s.c1) && hasta > s.f0 && desde < s.f1) return s.elevacion;
    } else if ((p.en === s.f0 || p.en === s.f1) && hasta > s.c0 && desde < s.c1) return s.elevacion;
    return 0;
  }

  // ---------- rejilla de rutas ----------

  function construirRejilla(muebles) {
    const ancho = Math.round(COLS / CELDA);
    const alto = Math.round(FILAS / CELDA);
    const bloqueada = new Uint8Array(ancho * alto);
    const MARGEN = 0.08;
    for (const m of muebles) {
      if (!m.bloquea) continue;
      const i0 = Math.max(0, Math.floor((m.c0 - MARGEN) / CELDA));
      const i1 = Math.min(ancho - 1, Math.floor((m.c1 + MARGEN) / CELDA));
      const j0 = Math.max(0, Math.floor((m.f0 - MARGEN) / CELDA));
      const j1 = Math.min(alto - 1, Math.floor((m.f1 + MARGEN) / CELDA));
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const cx = (i + 0.5) * CELDA;
          const cy = (j + 0.5) * CELDA;
          if (cx > m.c0 - MARGEN && cx < m.c1 + MARGEN && cy > m.f0 - MARGEN && cy < m.f1 + MARGEN) bloqueada[j * ancho + i] = 1;
        }
      }
    }
    return { ancho, alto, bloqueada };
  }

  const enHueco = (p, v) => p.puertas.some(c => v > c - ANCHO_PUERTA / 2 && v < c + ANCHO_PUERTA / 2);

  // ¿Moverse de la celda (i1,j1) a una vecina ORTOGONAL (i2,j2) atraviesa un tabique sin puerta?
  function cruzaPared(i1, j1, i2, j2) {
    if (i1 !== i2) {
      const linea = Math.max(i1, i2) * CELDA;
      const y = (j1 + 0.5) * CELDA;
      for (const p of PAREDES) {
        if (p.eje === 'col' && Math.abs(p.en - linea) < 1e-9 && y > p.desde && y < p.hasta && !enHueco(p, y)) return true;
      }
    }
    if (j1 !== j2) {
      const linea = Math.max(j1, j2) * CELDA;
      const x = (i1 + 0.5) * CELDA;
      for (const p of PAREDES) {
        if (p.eje === 'fila' && Math.abs(p.en - linea) < 1e-9 && x > p.desde && x < p.hasta && !enHueco(p, x)) return true;
      }
    }
    return false;
  }

  function libre(rej, i, j) {
    return i >= 0 && j >= 0 && i < rej.ancho && j < rej.alto && !rej.bloqueada[j * rej.ancho + i];
  }

  function paso(rej, i1, j1, i2, j2) {
    if (!libre(rej, i2, j2)) return false;
    if (i1 !== i2 && j1 !== j2) {
      // En diagonal, solo si los dos caminos en L también se pueden andar (no cortar esquinas).
      return libre(rej, i2, j1) && libre(rej, i1, j2)
        && !cruzaPared(i1, j1, i2, j1) && !cruzaPared(i2, j1, i2, j2)
        && !cruzaPared(i1, j1, i1, j2) && !cruzaPared(i1, j2, i2, j2);
    }
    return !cruzaPared(i1, j1, i2, j2);
  }

  const celdaDe = (col, fila) => ({ i: Math.floor(col / CELDA), j: Math.floor(fila / CELDA) });
  const centroDe = (i, j) => ({ col: (i + 0.5) * CELDA, fila: (j + 0.5) * CELDA });

  // Celda libre más cercana a un punto, sin cruzar tabiques (búsqueda en anchura).
  function celdaLibreCercana(rej, col, fila) {
    const c = celdaDe(Math.min(COLS - 0.01, Math.max(0, col)), Math.min(FILAS - 0.01, Math.max(0, fila)));
    if (libre(rej, c.i, c.j)) return c;
    const vistos = new Set([c.j * rej.ancho + c.i]);
    const cola = [c];
    while (cola.length) {
      const a = cola.shift();
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const i = a.i + di;
        const j = a.j + dj;
        if (i < 0 || j < 0 || i >= rej.ancho || j >= rej.alto) continue;
        const k = j * rej.ancho + i;
        if (vistos.has(k) || cruzaPared(a.i, a.j, i, j)) continue;
        vistos.add(k);
        if (libre(rej, i, j)) return { i, j };
        cola.push({ i, j });
      }
    }
    return c;
  }

  // A* con montículo binario sobre la rejilla de medias teselas.
  function aEstrella(rej, ini, fin) {
    const N = rej.ancho * rej.alto;
    const g = new Float64Array(N).fill(Infinity);
    const padre = new Int32Array(N).fill(-1);
    const cerrado = new Uint8Array(N);
    const h = (i, j) => {
      const dx = Math.abs(i - fin.i);
      const dy = Math.abs(j - fin.j);
      return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
    };
    const monton = [];
    const empujar = (k, f) => {
      monton.push([f, k]);
      let x = monton.length - 1;
      while (x > 0) {
        const p = (x - 1) >> 1;
        if (monton[p][0] <= monton[x][0]) break;
        [monton[p], monton[x]] = [monton[x], monton[p]];
        x = p;
      }
    };
    const sacar = () => {
      const top = monton[0];
      const ultimo = monton.pop();
      if (monton.length) {
        monton[0] = ultimo;
        let x = 0;
        for (;;) {
          const a = 2 * x + 1;
          const b = a + 1;
          let m = x;
          if (a < monton.length && monton[a][0] < monton[m][0]) m = a;
          if (b < monton.length && monton[b][0] < monton[m][0]) m = b;
          if (m === x) break;
          [monton[m], monton[x]] = [monton[x], monton[m]];
          x = m;
        }
      }
      return top;
    };
    const kIni = ini.j * rej.ancho + ini.i;
    const kFin = fin.j * rej.ancho + fin.i;
    g[kIni] = 0;
    empujar(kIni, h(ini.i, ini.j));
    while (monton.length) {
      const [, k] = sacar();
      if (cerrado[k]) continue;
      if (k === kFin) break;
      cerrado[k] = 1;
      const i = k % rej.ancho;
      const j = (k - i) / rej.ancho;
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          if (!di && !dj) continue;
          const ni = i + di;
          const nj = j + dj;
          if (!paso(rej, i, j, ni, nj)) continue;
          const nk = nj * rej.ancho + ni;
          const ng = g[k] + (di && dj ? Math.SQRT2 : 1);
          if (ng < g[nk]) {
            g[nk] = ng;
            padre[nk] = k;
            empujar(nk, ng + h(ni, nj));
          }
        }
      }
    }
    if (g[kFin] === Infinity) return null;
    const camino = [];
    for (let k = kFin; k !== -1; k = padre[k]) {
      const i = k % rej.ancho;
      camino.push({ i, j: (k - i) / rej.ancho });
      if (k === kIni) break;
    }
    return camino.reverse();
  }

  // ¿Se puede ir en línea recta de a a b sin pisar muebles ni atravesar tabiques?
  function aLaVista(rej, a, b) {
    const d = Math.hypot(b.col - a.col, b.fila - a.fila);
    const pasos = Math.max(1, Math.ceil(d / 0.1));
    let prev = celdaDe(a.col, a.fila);
    for (let s = 1; s <= pasos; s++) {
      const t = s / pasos;
      const c = celdaDe(a.col + (b.col - a.col) * t, a.fila + (b.fila - a.fila) * t);
      if (c.i === prev.i && c.j === prev.j) continue;
      if (!libre(rej, c.i, c.j)) return false;
      if (c.i !== prev.i && c.j !== prev.j) {
        if (!paso(rej, prev.i, prev.j, c.i, c.j)) return false;
      } else if (cruzaPared(prev.i, prev.j, c.i, c.j)) return false;
      prev = c;
    }
    return true;
  }

  // Ruta de (col, fila) a (col, fila): lista de puntos, el primero el origen y el
  // último el destino exacto (que puede estar sobre un sofá o una silla).
  function ruta(mapa, desde, hasta) {
    const rej = mapa.rejilla;
    const ini = celdaLibreCercana(rej, desde.col, desde.fila);
    const fin = celdaLibreCercana(rej, hasta.col, hasta.fila);
    const celdas = aEstrella(rej, ini, fin);
    if (!celdas) return [{ col: desde.col, fila: desde.fila }, { col: hasta.col, fila: hasta.fila }];
    const puntos = [{ col: desde.col, fila: desde.fila }].concat(celdas.map(c => centroDe(c.i, c.j)));
    puntos.push({ col: hasta.col, fila: hasta.fila });
    // Suavizado: desde cada punto, saltar al más lejano que se ve en línea recta.
    const suave = [puntos[0]];
    let k = 0;
    while (k < puntos.length - 1) {
      let siguiente = k + 1;
      for (let m = puntos.length - 1; m > k + 1; m--) {
        if (aLaVista(rej, puntos[k], puntos[m])) { siguiente = m; break; }
      }
      suave.push(puntos[siguiente]);
      k = siguiente;
    }
    return suave;
  }

  // ---------- sitios ----------

  // Reparte sitios de forma determinista: puesto → su silla; luego los sitios
  // con dueño (la mesa de la jefa de riesgos es suya aunque esté en el comité);
  // luego el resto en orden (los de casa antes que las visitas). Lo que sobra,
  // de pie en celdas libres de la sala.
  function asignarSitios(mapa, agentes, departamentos) {
    const asignacion = new Map();
    const lista = Array.isArray(agentes) ? agentes : [];
    const orden = (a) => {
      const k = ORDEN_FIJOS.indexOf(a.id);
      return k >= 0 ? k : 100 + lista.indexOf(a);
    };
    const porSala = {};
    for (const id of ORDEN_SALAS) porSala[id] = [];
    for (const a of lista) porSala[salaDeAgente(a, departamentos)].push(a);

    for (const sala of ORDEN_SALAS) {
      const enSala = porSala[sala];
      if (!enSala.length) continue;
      const ocupados = new Set();
      const presentes = new Set(enSala.map(a => a.id));
      const pendientes = [];
      for (const a of enSala) {
        let s = null;
        if (sala === 'parque' && a.puestoId) s = mapa.sitios.parque.find(x => x.puestoId === a.puestoId && !ocupados.has(x.id));
        if (!s) s = mapa.sitios[sala].find(x => x.preferente === a.id && !ocupados.has(x.id));
        if (s) { ocupados.add(s.id); asignacion.set(a.id, s); } else pendientes.push(a);
      }
      const casa = sala;
      pendientes.sort((a, b) => {
        const ca = salaCasa(a, departamentos) === casa ? 0 : 1;
        const cb = salaCasa(b, departamentos) === casa ? 0 : 1;
        return ca - cb || orden(a) - orden(b);
      });
      const disponibles = mapa.sitios[sala].filter(x => !ocupados.has(x.id) && !x.puestoId
        && (!x.preferente || x.cedible || !presentesEnPlantilla(lista, x.preferente)) && !(x.preferente && presentes.has(x.preferente)));
      const extra = sitiosDePie(mapa, sala);
      for (const a of pendientes) {
        const s = disponibles.shift() || extra.shift() || { id: `${sala}-centro`, sala, col: (SALAS[sala].c0 + SALAS[sala].c1) / 2, fila: (SALAS[sala].f0 + SALAS[sala].f1) / 2, mira: 'S', postura: 'de_pie' };
        asignacion.set(a.id, s);
      }
    }
    return asignacion;
  }

  function presentesEnPlantilla(lista, id) { return lista.some(a => a.id === id); }

  // Sitios de pie de reserva: celdas libres de la sala lejos de muebles y sillas.
  function sitiosDePie(mapa, sala) {
    const s = SALAS[sala];
    const rej = mapa.rejilla;
    const ocupados = mapa.sitios[sala];
    const salida = [];
    for (let f = s.f0 + 0.75; f < s.f1 - 0.5; f += 1) {
      for (let c = s.c0 + 0.75; c < s.c1 - 0.5; c += 1) {
        const cel = celdaDe(c, f);
        if (!libre(rej, cel.i, cel.j)) continue;
        if (ocupados.some(o => Math.hypot(o.col - c, o.fila - f) < 1)) continue;
        if (salida.some(o => Math.hypot(o.col - c, o.fila - f) < 1)) continue;
        salida.push({ id: `${sala}-extra-${salida.length}`, sala, col: c, fila: f, mira: 'S', postura: 'de_pie' });
      }
    }
    return salida;
  }

  // Dónde se pone un agente que está «de pie» junto a su sitio: detrás de la
  // silla si hay hueco; si no, en el propio sitio.
  function posicionDePie(mapa, sitio) {
    if (sitio.postura === 'de_pie') return { col: sitio.col, fila: sitio.fila };
    const d = { N: [0, 0.55], S: [0, -0.55], E: [-0.55, 0], O: [0.55, 0] }[sitio.mira] || [0, 0];
    const p = { col: sitio.col + d[0], fila: sitio.fila + d[1] };
    const c = celdaDe(p.col, p.fila);
    if (libre(mapa.rejilla, c.i, c.j) && salaEn(p.col, p.fila) === sitio.sala) return p;
    return { col: sitio.col, fila: sitio.fila };
  }

  return {
    COLS, FILAS, CELDA, ANCHO_PUERTA, ALTO_PARED_EXTERIOR, ALTO_PARED_INTERIOR, GROSOR_PARED,
    SALAS, ORDEN_SALAS, PAREDES, DEPARTAMENTOS_POR_DEFECTO,
    construirMapa, asignarSitios, posicionDePie, ruta, salaEn, elevacionEn, salaDeAgente, salaCasa, firmaEstructura,
    cruzaPared, celdaDe, libre, aLaVista, departamentosDe,
  };
});
