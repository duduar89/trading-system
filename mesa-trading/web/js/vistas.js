// Vistas de lectura del panel: Evolución, Estrategias, Noticias, Decisiones y
// Laboratorio. Se abren con el botón «Informes» de la botonera (o con
// #evolucion, #estrategias… en la dirección) y tapan el parqué sin pararlo:
// la botonera, con Kill y Pausar, sigue a la vista.
//
// Todo lo que se enseña sale de la API (src/informes): el historial por hora,
// las decisiones apuntadas, las noticias tal y como llegaron y la instantánea.
// Aquí no se calcula ninguna cifra de negocio nueva: solo se cambia de base
// (variación desde el inicio del periodo), se suma el reparto y se formatea.
// Los textos que llevan cifras las toman de esos datos.
//
// Script clásico (window.Parque.vistas) y a la vez módulo CommonJS para las
// pruebas de las partes puras (series, marcas, textos).
(function (raiz, fabrica) {
  const esNode = typeof module === 'object' && module.exports;
  const mod = esNode
    ? fabrica(require('./cifras.js'), require('./graficas.js'), (() => { try { return require('./caras.js'); } catch (_) { return null; } })())
    : fabrica(raiz.Parque.cifras, raiz.Parque.graficas, raiz.Parque.caras || null);
  if (esNode) module.exports = mod;
  else (raiz.Parque = raiz.Parque || {}).vistas = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (cifras, graficas, caras) {
  'use strict';

  const valido = x => typeof x === 'number' && Number.isFinite(x);
  const D = 86400e3;
  const G = graficas;

  const VISTAS = Object.freeze([
    { id: 'evolucion', nombre: 'Evolución' },
    { id: 'estrategias', nombre: 'Estrategias' },
    { id: 'noticias', nombre: 'Noticias' },
    { id: 'decisiones', nombre: 'Decisiones' },
    { id: 'laboratorio', nombre: 'Laboratorio' },
  ]);
  const RANGOS = Object.freeze([
    { id: '1s', nombre: '1S', largo: 'la última semana', ms: 7 * D },
    { id: '1m', nombre: '1M', largo: 'el último mes', ms: 30 * D },
    { id: '3m', nombre: '3M', largo: 'los últimos 3 meses', ms: 91 * D },
    { id: 'todo', nombre: 'Todo', largo: 'todo el periodo', ms: null },
  ]);

  // Colores: el fondo en tinta clara (es la línea que importa) y las sombras
  // con tres tonos de la paleta validada; cada mesa, siempre el mismo color.
  const COLOR_FONDO = G.TINTA.primaria;
  const COLOR_SOMBRA = { btc: G.PALETA[1], cesta: G.PALETA[2], sinComite: G.PALETA[6] };
  const ORDEN_MESAS = ['momentum', 'tendencia', 'reversion', 'ruptura', 'momentum-ampliada', 'momentum-etf', 'reversion-etf'];
  const COLOR_SIN_ASIGNAR = '#3a4462';
  const extraMesas = new Map();
  function colorMesa(id) {
    const k = ORDEN_MESAS.indexOf(id);
    if (k >= 0) return G.PALETA[k];
    if (!extraMesas.has(id)) extraMesas.set(id, extraMesas.size);
    const j = ORDEN_MESAS.length + extraMesas.get(id);
    return j < G.PALETA.length ? G.PALETA[j] : G.GRIS_OTRAS;
  }

  const ESTADO_MESA = {
    titular: { texto: 'Titular', clase: 'verde', ayuda: 'Opera con capital de verdad (en papel).' },
    incubacion: { texto: 'En prueba', clase: 'azul', ayuda: 'Incubación: opera con el 2 % mientras demuestra que funciona.' },
    banquillo: { texto: 'Banquillo', clase: 'gris', ayuda: 'Sin capital: no abre posiciones.' },
  };
  const FAMILIA = {
    'tendencia-sma': 'Tendencia (medias móviles)', 'momentum-rotacion': 'Momentum (rotación)', 'reversion-rsi': 'Reversión (RSI)', 'ruptura-donchian': 'Ruptura (Donchian)',
  };
  const MARCO = { '1Hour': 'velas de 1 hora', '4Hour': 'velas de 4 horas', '1Day': 'velas diarias' };
  const CATEGORIA = {
    regulacion: 'Regulación', hackeo: 'Hackeo', quiebra: 'Quiebra', exclusion: 'Exclusión', fallo_red: 'Fallo de la red',
    macro: 'Macro', empresa: 'Empresa', mercado: 'Mercado', otro: 'Otro',
  };

  // Tipos de decisión → grupos del filtro (tipos de §6.10).
  const GRUPOS_DECISION = Object.freeze([
    { id: 'todas', nombre: 'Todas', tipos: null },
    { id: 'comite', nombre: 'Comité y reuniones', tipos: ['comite', 'reunion'] },
    { id: 'ordenes', nombre: 'Órdenes', tipos: ['orden'] },
    { id: 'riesgos', nombre: 'Vetos y recortes', tipos: ['veto', 'recorte'] },
    { id: 'estrategias', nombre: 'Cambios de estrategia', tipos: ['asignacion', 'ascenso', 'despido', 'descarte'] },
    { id: 'laboratorio', nombre: 'Laboratorio', tipos: ['laboratorio'] },
    { id: 'fondo', nombre: 'Kill, pausas y Megáfono', tipos: ['kill', 'pausa', 'megafono'] },
    { id: 'noticias', nombre: 'Noticias', tipos: ['noticia'] },
  ]);
  const TIPO_DECISION = {
    comite: 'Comité', orden: 'Orden', veto: 'Veto', recorte: 'Recorte', asignacion: 'Reparto', ascenso: 'Ascenso', despido: 'Despido',
    descarte: 'Descarte', laboratorio: 'Laboratorio', kill: 'Kill', pausa: 'Pausa', megafono: 'Megáfono', noticia: 'Noticia',
    reunion: 'Reunión',
  };
  const CLASE_TIPO = { kill: 'roja', veto: 'ambar', recorte: 'ambar', despido: 'ambar', descarte: 'ambar', ascenso: 'verde', pausa: 'ambar', megafono: 'ambar', noticia: 'roja', reunion: 'azul' };

  // Qué mide cada puerta del laboratorio y por qué protege de la suerte.
  // Texto fijo, sin cifras: los valores y umbrales salen de cada evaluación.
  const PUERTAS = Object.freeze({
    'Sharpe OOS': 'Cuánto gana por cada unidad de susto (rentabilidad frente a sus vaivenes), contado solo en los tramos que la estrategia no vio al elegir sus parámetros. Protege de la suerte porque cuenta cómo le fue con datos nuevos, no con los que se usaron para ajustarla.',
    'Ventanas de prueba en positivo': 'El histórico se corta en tramos: se ajusta con uno y se prueba en el siguiente, una y otra vez (walk-forward). Pide ganar en casi todos los tramos de prueba: una racha afortunada no basta.',
    'Sharpe deflactado': 'Si se prueban muchas combinaciones, alguna sale bien por casualidad. Esta cifra descuenta todos los ensayos que lleva el laboratorio y da la probabilidad de que el resultado sea real y no el mejor de muchos intentos al azar.',
    'Operaciones OOS': 'Operaciones en los tramos de prueba. Con pocas, cualquier resultado puede ser suerte; con muchas, la suerte se compensa.',
    'maxDD OOS': 'La peor caída en los tramos de prueba, comparada con la de la estrategia que ya opera en esa familia (o con comprar y mantener). Evita contratar algo que gana a base de aguantar caídas mucho peores.',
    'Correlación con mesas activas': 'Cuánto se parecen sus resultados diarios a los de las mesas que ya operan. Si se mueve casi igual que una de ellas no aporta nada nuevo: sería doblar la apuesta, no repartirla.',
    'Datos suficientes': 'Hace falta histórico para varios tramos de prueba. Sin datos no se puede juzgar, y se rechaza.',
  });
  const NOMBRE_PUERTA = {
    'Sharpe OOS': 'Sharpe fuera de muestra', 'Ventanas de prueba en positivo': 'Tramos de prueba ganadores', 'Sharpe deflactado': 'Probabilidad de que no sea suerte (DSR)',
    'Operaciones OOS': 'Operaciones fuera de muestra', 'maxDD OOS': 'Caída máxima fuera de muestra', 'Correlación con mesas activas': 'Parecido con las mesas activas', 'Datos suficientes': 'Datos suficientes',
  };
  const ESTADO_HIPOTESIS = {
    aprobada: { texto: 'Aprobada', clase: 'verde' }, rechazada: { texto: 'Rechazada', clase: 'roja' },
    pendiente: { texto: 'Pendiente', clase: 'gris' }, evaluando: { texto: 'Evaluando', clase: 'azul' },
  };

  // ================= partes puras (se prueban en Node) =================

  const num = x => (valido(x) ? x : null);
  // Nombre de pila («Marta Solís» → «Marta»); el humano del panel, «tú».
  const pila = n => String(n || '').trim().split(/\s+/)[0].replace(/,$/, '') || '';

  // Filas de historial.jsonl → series alineadas por instante.
  function seriesEvolucion(filas) {
    const ordenadas = (filas || []).filter(l => l && valido(l.t)).slice().sort((a, b) => a.t - b.t);
    const n = ordenadas.length;
    const ts = ordenadas.map(l => l.t);
    const sombra = k => ordenadas.map(l => (l.sombras ? num(l.sombras[k]) : null));
    const mesas = new Map();
    ordenadas.forEach((l, i) => {
      for (const m of Array.isArray(l.mesas) ? l.mesas : []) {
        if (!m || !m.id) continue;
        if (!mesas.has(m.id)) mesas.set(m.id, { id: m.id, nombre: m.nombre || m.id, pnl: new Array(n).fill(null), peso: new Array(n).fill(null), estado: new Array(n).fill(null) });
        const s = mesas.get(m.id);
        s.nombre = m.nombre || s.nombre;
        s.pnl[i] = num(m.pnlAcumulado);
        s.peso[i] = num(m.peso);
        s.estado[i] = m.estado || null;
      }
    });
    const lista = [...mesas.values()].sort((a, b) => {
      const ia = ORDEN_MESAS.indexOf(a.id);
      const ib = ORDEN_MESAS.indexOf(b.id);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.id.localeCompare(b.id);
    });
    return {
      ts, filas: ordenadas,
      fondo: ordenadas.map(l => num(l.patrimonio)),
      btc: sombra('btc'), cesta: sombra('cesta'), sinComite: sombra('sinComite'),
      caida: ordenadas.map(l => num(l.caida)),
      mesas: lista,
    };
  }

  // Reparto del capital: el peso de cada mesa y lo que queda sin asignar
  // (1 − Σ pesos, que se queda en efectivo), instante a instante.
  function reparto(series) {
    const n = series.ts.length;
    const capas = series.mesas.map(m => ({ id: m.id, nombre: m.nombre, valores: m.peso.map(v => (valido(v) ? Math.max(0, v) : 0)) }));
    const libre = new Array(n).fill(0).map((_, i) => Math.max(0, 1 - capas.reduce((s, c) => s + c.valores[i], 0)));
    return { capas, libre };
  }

  // Variación del periodo de cada cartera: primera y última cifra válidas.
  function variacion(valores) {
    const v = (valores || []).filter(valido);
    if (v.length < 1) return null;
    const a = v[0];
    const b = v[v.length - 1];
    return { inicio: a, fin: b, usd: b - a, pct: a !== 0 ? b / a - 1 : null };
  }

  // Frase del periodo, con las cifras de la serie (nada más).
  function lecturaPeriodo(series, nombreRango) {
    const f = variacion(series.fondo);
    if (!f) return 'Todavía no hay historial: la mesa apunta un punto cada hora.';
    const p = x => cifras.pct(x, { signo: true });
    const partes = [`En ${nombreRango} el fondo ${f.usd >= 0 ? 'gana' : 'pierde'} ${cifras.usd(Math.abs(f.usd))} (${p(f.pct)}).`];
    const sombras = [['btc', 'comprar y mantener BTC'], ['cesta', 'la cesta cripto'], ['sinComite', 'las mismas mesas sin comité']]
      .map(([k, nombre]) => ({ nombre, v: variacion(series[k]) })).filter(x => x.v && valido(x.v.pct));
    if (sombras.length) partes.push(`En el mismo tiempo, ${sombras.map(x => `${x.nombre} ${p(x.v.pct)}`).join('; ')}.`);
    const sc = variacion(series.sinComite);
    if (sc && valido(sc.pct) && valido(f.pct)) {
      const dif = (f.pct - sc.pct) * 100;
      const txt = cifras.numero(Math.abs(dif), 2);
      partes.push(Math.abs(dif) < 0.005 ? 'El comité no ha cambiado el resultado frente a las mismas mesas sin él.'
        : `El comité ${dif > 0 ? 'suma' : 'resta'} ${txt} ${txt === '1,00' ? 'punto' : 'puntos'} frente a las mismas mesas sin él.`);
    }
    return partes.join(' ');
  }

  // Sucesos de la línea de tiempo. De historial: los cambios de modo del
  // comité. De decisiones: kill, pausas y reaperturas, ascensos, despidos,
  // descartes y los repartos que contratan una mesa.
  function marcasDe(filas, decisiones) {
    const E = G.ESTADO;
    const marcas = [];
    for (const l of filas || []) {
      if (!l || l.motivo !== 'comite' || !valido(l.t)) continue;
      const modo = cifras.modoComite(l.modoComite);
      marcas.push({ t: l.t, tipo: 'comite', forma: 'rombo', color: l.modoComite === 'NORMAL' ? E.neutro : E.aviso, texto: `Comité: pasa a modo ${modo}.`, quien: 'cio' });
    }
    for (const d of decisiones || []) {
      if (!d || !valido(d.t)) continue;
      const x = d.datos || {};
      const resumen = String(d.resumen || '');
      const quien = d.quien || null;   // quién lo decidió: su cara en la lista de sucesos
      if (d.tipo === 'kill') marcas.push({ t: d.t, tipo: 'kill', forma: 'cuadrado', color: E.grave, vertical: true, texto: resumen || 'Kill switch.', clase: 'grave', quien });
      else if (d.tipo === 'pausa') {
        const reabre = x.accion === 'reabrir';
        marcas.push({ t: d.t, tipo: 'pausa', forma: 'circulo', color: reabre ? E.bien : E.aviso, texto: resumen, quien });
      } else if (d.tipo === 'ascenso') marcas.push({ t: d.t, tipo: 'ascenso', forma: 'arriba', color: E.bien, texto: resumen, quien });
      else if (d.tipo === 'despido' || d.tipo === 'descarte') marcas.push({ t: d.t, tipo: d.tipo, forma: 'abajo', color: E.aviso, texto: resumen, quien });
      else if (d.tipo === 'asignacion' && ((Array.isArray(x.contratadas) && x.contratadas.length) || x.migracion)) {
        marcas.push({ t: d.t, tipo: 'alta', forma: 'circulo', color: E.neutro, texto: resumen, quien });
      }
    }
    return marcas.sort((a, b) => a.t - b.t);
  }

  // Tramos sombreados: el comité en DEFENSIVO o SOLO CERRAR (del historial) y
  // el fondo bloqueado entre un kill y su reapertura (de las decisiones).
  function bandasDe(filas, decisiones, tFin) {
    const E = G.ESTADO;
    const bandas = [];
    let abierta = null;
    for (const l of filas || []) {
      if (!l || !valido(l.t)) continue;
      const modo = l.modoComite || 'NORMAL';
      if (abierta && abierta.modo !== modo) { abierta.hasta = l.t; bandas.push(abierta); abierta = null; }
      if (!abierta && modo !== 'NORMAL') abierta = { desde: l.t, modo, color: modo === 'SOLO_CERRAR' ? E.grave : E.aviso, texto: `Comité en ${cifras.modoComite(modo)}` };
    }
    const fin = valido(tFin) ? tFin : ((filas || []).length ? filas[filas.length - 1].t : null);
    if (abierta && valido(fin)) { abierta.hasta = fin; bandas.push(abierta); }
    const eventos = (decisiones || []).filter(d => d && valido(d.t) && (d.tipo === 'kill' || (d.tipo === 'pausa' && d.datos && d.datos.accion === 'reabrir'))).sort((a, b) => a.t - b.t);
    let kill = null;
    for (const d of eventos) {
      if (d.tipo === 'kill' && !kill) kill = d.t;
      else if (d.tipo === 'pausa' && kill !== null) { bandas.push({ desde: kill, hasta: d.t, modo: 'bloqueado', color: E.grave, texto: 'Fondo bloqueado (kill)' }); kill = null; }
    }
    if (kill !== null && valido(fin) && fin > kill) bandas.push({ desde: kill, hasta: fin, modo: 'bloqueado', color: E.grave, texto: 'Fondo bloqueado (kill)' });
    return bandas;
  }

  // Filas diarias (la última de cada día de Madrid) para la tabla de datos.
  function porDia(series) {
    const ult = new Map();
    series.ts.forEach((t, i) => ult.set(cifras.dia(t), i));
    return [...ult.values()];
  }

  // Comités seguidos sin cambio de modo → un grupo (en «Todas» son ruido).
  function agruparRutina(lista) {
    const salida = [];
    for (const d of lista) {
      const rutina = d.tipo === 'comite' && d.datos && d.datos.modo === d.datos.modoAnterior && !(d.datos.vetos && d.datos.vetos.length);
      const ultimo = salida[salida.length - 1];
      if (rutina && ultimo && ultimo.grupo && cifras.dia(ultimo.items[0].t) === cifras.dia(d.t)) { ultimo.items.push(d); continue; }
      if (rutina) { salida.push({ grupo: true, items: [d] }); continue; }
      salida.push(d);
    }
    return salida.map(x => (x.grupo && x.items.length === 1 ? x.items[0] : x));
  }

  // Valor de un criterio del laboratorio con sus unidades.
  function valorCriterio(c, v) {
    if (!valido(v)) return '—';
    const n = c && c.nombre;
    if (n === 'Ventanas de prueba en positivo') return cifras.pct(v, { decimales: 0 });
    if (n === 'maxDD OOS') return cifras.pct(v, { decimales: 1 });
    if (n === 'Sharpe deflactado') return cifras.pct(v, { decimales: 0 });
    if (n === 'Operaciones OOS' || n === 'Datos suficientes') return cifras.numero(v);
    return cifras.numero(v, 2);
  }

  // Detalle de un criterio con sus extras (lo que dice de dónde sale).
  function detalleCriterio(c) {
    const extra = [];
    if (valido(c.positivas) && valido(c.total)) extra.push(`${cifras.numero(c.positivas)} de ${cifras.numero(c.total)} tramos ganan`);
    if (valido(c.ensayos)) extra.push(`descontando ${cifras.numero(c.ensayos)} ensayos`);
    if (valido(c.referencia)) extra.push(`referencia ${cifras.pct(c.referencia, { decimales: 1 })}${c.fuenteReferencia ? ` (${c.fuenteReferencia})` : ''}`);
    if (c.nombre === 'Correlación con mesas activas') extra.push(c.mesa ? `la más parecida: ${c.mesa}` : (valido(c.valor) ? '' : 'sin mesa activa con la que compararla'));
    if (c.nombre === 'Datos suficientes') extra.push('tramos de prueba posibles');
    return extra.filter(Boolean).join(' · ');
  }

  // Formato genérico de un valor de `datos` de una decisión.
  function textoValor(v) {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'boolean') return v ? 'sí' : 'no';
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) return '—';
      if (Number.isInteger(v)) return cifras.numero(v);
      const a = Math.abs(v);
      return cifras.numero(v, a >= 1000 ? 0 : a >= 1 ? 2 : 4);
    }
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) {
      if (!v.length) return 'ninguno';
      if (v.every(x => x === null || typeof x !== 'object')) return v.map(textoValor).join(', ');
      return v.map(x => (x && typeof x === 'object' ? Object.entries(x).map(([k, y]) => `${k}: ${textoValor(y)}`).join(' · ') : textoValor(x))).join('\n');
    }
    if (typeof v === 'object') {
      const e = Object.entries(v);
      if (!e.length) return 'ninguno';
      return e.map(([k, y]) => `${k}: ${y && typeof y === 'object' ? JSON.stringify(y) : textoValor(y)}`).join(' · ');
    }
    return String(v);
  }

  // Quién decidió: el agente de la plantilla, el humano del panel o un id.
  function quienEs(id, inst) {
    if (id === 'humano') return { id, nombre: 'Tú, desde el panel', rol: 'Humano', agente: null };
    const a = inst && Array.isArray(inst.agentes) ? inst.agentes.find(x => x.id === id) : null;
    if (a) return { id, nombre: a.nombre, rol: a.rol || '', agente: a };
    return { id, nombre: id || 'sistema', rol: '', agente: null };
  }

  // ================= DOM =================

  const est = {
    iniciada: false,
    abierta: false,
    vista: 'evolucion',
    empujado: false,
    opciones: {},
    rango: 'todo',
    grupoDecision: 'todas',
    quienDecision: null,    // id del agente cuyas decisiones se ven (desde su ficha), o null
    limiteDecisiones: 300,
    sinFoco: false,         // al cerrar para abrir la ficha de un agente, el foco no vuelve a «Informes»
    noticias: { simbolo: '', graves: false },
    cache: new Map(),       // ruta → { t, datos }
    animado: new Set(),     // vistas que ya han entrado con animación
    refresco: null,
    redibujar: [],          // funciones que rehacen las gráficas al cambiar el ancho
    ultimoAncho: 0,
    pidiendo: 0,
  };
  const $ = id => document.getElementById(id);

  function el(tag, attrs, ...hijos) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const h of hijos.flat(Infinity)) {
      if (h === null || h === undefined || h === false) continue;
      e.appendChild(typeof h === 'string' || typeof h === 'number' ? document.createTextNode(String(h)) : h);
    }
    return e;
  }
  function recordar(k, v) { try { localStorage.setItem(`mesa-vistas-${k}`, v); } catch (_) { /* sin almacenamiento */ } }
  function recuperar(k) { try { return localStorage.getItem(`mesa-vistas-${k}`); } catch (_) { return null; } }

  const inst = () => (est.opciones.instantanea ? est.opciones.instantanea() : null);
  function ahoraMesa() {
    if (est.opciones.ahoraServidor) { const t = est.opciones.ahoraServidor(); if (valido(t)) return t; }
    const i = inst();
    return i && valido(i.ahora) ? i.ahora : null;
  }

  // ---------- red ----------

  async function pedir(ruta, { fresco = false, vida = 30000 } = {}) {
    const c = est.cache.get(ruta);
    const ahora = Date.now();   // caché de pantalla: reloj del navegador, no de la mesa
    if (!fresco && c && ahora - c.t < vida) return c.datos;
    const token = est.opciones.token || '';
    const url = token ? `${ruta}${ruta.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : ruta;
    let r;
    try {
      r = await fetch(url, { cache: 'no-store', headers: token ? { 'x-panel-token': token } : {} });
    } catch (_) {
      throw new Error('Sin conexión con la mesa.');
    }
    let datos = null;
    try { datos = await r.json(); } catch (_) { datos = null; }
    if (r.status === 401 && datos && typeof datos.login === 'string' && datos.login.startsWith('/') && !token) {
      location.replace(datos.login);
      throw new Error('La sesión ha caducado: vuelve a entrar.');
    }
    if (!r.ok) throw new Error((datos && datos.mensaje) || `La mesa respondió ${r.status}.`);
    est.cache.set(ruta, { t: ahora, datos });
    if (est.cache.size > 40) est.cache.delete(est.cache.keys().next().value);
    return datos;
  }

  // ---------- estructura ----------

  function iniciar(opciones) {
    if (typeof document === 'undefined' || est.iniciada) return;
    est.iniciada = true;
    est.opciones = opciones || {};
    const guardado = recuperar('rango');
    if (RANGOS.some(r => r.id === guardado)) est.rango = guardado;
    const app = $('app') || document.body;
    const seccion = el('section', { class: 'vistas', id: 'vistas', 'aria-label': 'Informes', hidden: true },
      el('header', { class: 'vistas-cab' },
        el('div', { class: 'vistas-pestanas', role: 'tablist', 'aria-label': 'Informes', id: 'vistas-pestanas' },
          VISTAS.map(v => el('button', {
            class: 'vistas-pestana', type: 'button', role: 'tab', id: `vt-${v.id}`, 'data-vista': v.id,
            'aria-selected': 'false', 'aria-controls': 'vistas-panel', tabindex: '-1', text: v.nombre, onclick: () => abrir(v.id),
          }))),
        el('button', { class: 'boton-icono vistas-cerrar', type: 'button', 'aria-label': 'Volver al parqué', title: 'Volver al parqué', onclick: () => cerrar() }, iconoCerrar())),
      el('div', { class: 'vistas-cuerpo', id: 'vistas-panel', role: 'tabpanel', tabindex: '-1' }));
    app.appendChild(seccion);
    $('vistas-pestanas').addEventListener('keydown', teclasPestanas);
    const boton = $('abrir-vistas');
    if (boton) boton.addEventListener('click', () => (est.abierta ? cerrar() : abrir(recuperar('vista') || 'evolucion')));
    // «Atrás» vuelve al parqué. Tras un replaceState (cambiar de pestaña) el
    // navegador solo avisa con popstate, no con hashchange: se escuchan los dos.
    window.addEventListener('hashchange', () => alHash());
    window.addEventListener('popstate', () => alHash());
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !est.abierta) return;
      const modal = $('modal');
      if (modal && modal.open) return;
      // Con la ficha de una gráfica abierta, Escape la cierra antes (graficas.js
      // no deja que llegue aquí); si no, vuelve al parqué.
      cerrar();
    });
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(() => {
        const w = $('vistas-panel').clientWidth;
        if (!est.abierta || Math.abs(w - est.ultimoAncho) < 8) return;
        est.ultimoAncho = w;
        clearTimeout(est.redimTimer);
        est.redimTimer = setTimeout(() => { for (const f of est.redibujar) f(); }, 120);
      }).observe($('vistas-panel'));
    }
    alHash();
  }

  function iconoCerrar() {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('class', 'icono');
    s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', 'M6 6l12 12M18 6L6 18');
    s.appendChild(p);
    return s;
  }

  function teclasPestanas(e) {
    const ids = VISTAS.map(v => v.id);
    const i = ids.indexOf(est.vista);
    const mapa = { ArrowRight: 1, ArrowLeft: -1, Home: -Infinity, End: Infinity };
    if (!(e.key in mapa)) return;
    e.preventDefault();
    const d = mapa[e.key];
    const j = d === Infinity ? ids.length - 1 : d === -Infinity ? 0 : (i + d + ids.length) % ids.length;
    abrir(ids[j]);
    $(`vt-${ids[j]}`).focus();
  }

  function alHash() {
    const h = String(location.hash || '').replace(/^#/, '');
    if (VISTAS.some(v => v.id === h)) mostrar(h);
    else if (est.abierta) ocultar();
  }

  // `o.quien` (solo Decisiones): las decisiones de ese agente, desde su ficha;
  // null quita el filtro.
  function abrir(vista, o) {
    if (!VISTAS.some(v => v.id === vista)) vista = 'evolucion';
    if (o && o.quien !== undefined && vista === 'decisiones') {
      est.quienDecision = o.quien || null;
      est.grupoDecision = 'todas';
      est.limiteDecisiones = 300;
      if (est.abierta && est.vista === vista) { pintarVista({ animar: false, fresco: true }); return; }
    }
    if (location.hash === `#${vista}`) { mostrar(vista); return; }
    if (est.abierta) {
      // Cambiar de pestaña no apila historial: «atrás» vuelve al parqué.
      try { history.replaceState(null, '', `#${vista}`); } catch (_) { /* sin history */ }
      mostrar(vista);
    } else {
      est.empujado = true;
      location.hash = vista;
    }
  }

  function cerrar() {
    if (!est.abierta) return;
    if (est.empujado) { est.empujado = false; history.back(); return; }
    try { history.replaceState(null, '', location.pathname + location.search); } catch (_) { /* sin history */ }
    ocultar();
  }

  function mostrar(vista) {
    const cambia = !est.abierta || est.vista !== vista;
    est.abierta = true;
    est.vista = vista;
    recordar('vista', vista);
    $('vistas').hidden = false;
    const app = $('app');
    if (app) app.classList.add('vistas-abiertas');
    const b = $('abrir-vistas');
    if (b) { b.setAttribute('aria-expanded', 'true'); b.classList.add('activo'); }
    for (const v of VISTAS) {
      const t = $(`vt-${v.id}`);
      const activa = v.id === vista;
      t.setAttribute('aria-selected', String(activa));
      t.tabIndex = activa ? 0 : -1;
      t.classList.toggle('activa', activa);
    }
    // La pestaña elegida, a la vista en su fila (sin scrollIntoView: movería
    // también la página entera, que no se desplaza).
    const tab = $(`vt-${vista}`);
    const fila = $('vistas-pestanas');
    if (tab && fila) {
      const izq = tab.offsetLeft - fila.offsetLeft;
      if (izq < fila.scrollLeft) fila.scrollLeft = Math.max(0, izq - 8);
      else if (izq + tab.offsetWidth > fila.scrollLeft + fila.clientWidth) fila.scrollLeft = izq + tab.offsetWidth - fila.clientWidth + 8;
    }
    if (cambia) pintarVista({ animar: true });
    if (est.refresco) clearInterval(est.refresco);
    // Un latido por minuto: más a menudo no hay nada nuevo que enseñar.
    est.refresco = setInterval(() => { if (est.abierta && !document.hidden) pintarVista({ animar: false, fresco: true }); }, 60000);
    if (est.opciones.alCambiar) est.opciones.alCambiar(true);
  }

  function ocultar() {
    est.abierta = false;
    $('vistas').hidden = true;
    const app = $('app');
    if (app) app.classList.remove('vistas-abiertas');
    const b = $('abrir-vistas');
    if (b) { b.setAttribute('aria-expanded', 'false'); b.classList.remove('activo'); if (!est.sinFoco) b.focus({ preventScroll: true }); }
    est.sinFoco = false;
    if (est.refresco) { clearInterval(est.refresco); est.refresco = null; }
    if (est.opciones.alCambiar) est.opciones.alCambiar(false);
  }

  const PINTORES = {};
  async function pintarVista({ animar = false, fresco = false } = {}) {
    const cuerpo = $('vistas-panel');
    const vista = est.vista;
    const turno = ++est.pidiendo;
    est.ultimoAncho = cuerpo.clientWidth;
    if (est.opciones.maqueta) {
      cuerpo.textContent = '';
      cuerpo.appendChild(el('div', { class: 'vistas-contenido' }, el('p', { class: 'v-vacio', text: 'En la maqueta no hay registros: los informes salen del historial, las decisiones y las noticias que guarda la mesa. Abre el panel conectado a la mesa para verlos.' })));
      return;
    }
    // Al recargar se conserva lo que había, atenuado, sin saltos ni esqueletos.
    cuerpo.classList.add('v-recargando');
    try {
      const pintar = PINTORES[vista];
      const nodo = await pintar({ animar: animar && !est.animado.has(vista), fresco, turno });
      if (turno !== est.pidiendo || est.vista !== vista || !nodo) return;
      // El refresco de cada minuto no toca nada si los datos no han cambiado
      // (así no se cierra la ficha que se está mirando).
      if (fresco && nodo._firma && nodo._firma === est.firma && cuerpo.firstChild) return;
      est.firma = nodo._firma || null;
      const scroll = fresco ? cuerpo.scrollTop : 0;
      // Lo desplegado sigue desplegado tras refrescar.
      const abiertos = fresco ? new Set([...cuerpo.querySelectorAll('details[open] > summary')].map(x => x.textContent.replace(/\s*\(\d[\d.]*\)$/, ''))) : new Set();
      cuerpo.textContent = '';
      est.redibujar = [];
      cuerpo.appendChild(nodo);
      for (const f of nodo._alMontar || []) f();
      for (const x of cuerpo.querySelectorAll('details > summary')) if (abiertos.has(x.textContent.replace(/\s*\(\d[\d.]*\)$/, ''))) x.parentNode.open = true;
      if (fresco) cuerpo.scrollTop = scroll;
      if (animar) est.animado.add(vista);
    } catch (e) {
      if (turno !== est.pidiendo) return;
      if (fresco && cuerpo.childNodes.length) return;   // el refresco que falla deja lo que había
      cuerpo.textContent = '';
      cuerpo.appendChild(el('div', { class: 'vistas-contenido' },
        el('div', { class: 'v-error', role: 'alert' }, el('p', { text: e.message || 'No se pudo cargar.' }),
          el('button', { class: 'boton', type: 'button', text: 'Reintentar', onclick: () => pintarVista({ animar: false, fresco: true }) }))));
    } finally {
      if (turno === est.pidiendo) cuerpo.classList.remove('v-recargando');
    }
  }

  // Huella de los datos de una vista (para no repintar lo que no ha cambiado).
  function firma(...partes) {
    const texto = JSON.stringify(partes);
    let h = 0;
    for (let k = 0; k < texto.length; k++) h = (h * 31 + texto.charCodeAt(k)) | 0;
    return `${texto.length}:${h}`;
  }

  // Monta una gráfica cuando el nodo ya está en la página (necesita su ancho).
  function alMontar(raizNodo, f) {
    (raizNodo._alMontar = raizNodo._alMontar || []).push(() => { f(true); est.redibujar.push(() => f(false)); });
  }

  // Cifra que cuenta hacia arriba al entrar (con movimiento reducido, directa).
  function cifra(valor, formato, clase, animar) {
    const s = el('span', { class: `v-cifra${clase ? ` ${clase}` : ''}` });
    if (animar) { s.textContent = formato(0); s._pendiente = { valor, formato }; } else s.textContent = formato(valor);
    return s;
  }
  function animarCifras(nodo) {
    for (const s of nodo.querySelectorAll('.v-cifra')) {
      if (!s._pendiente) continue;
      const { valor, formato } = s._pendiente;
      s._pendiente = null;
      s._cifra = { valor: 0 };
      cifras.animar(s, valor, formato, { duracion: 700 });
    }
  }

  function tarjeta(titulo, subtitulo, ...hijos) {
    return el('section', { class: 'v-tarjeta' }, titulo ? el('h2', { class: 'v-titulo', text: titulo }) : null,
      subtitulo ? el('p', { class: 'v-sub', text: subtitulo }) : null, ...hijos);
  }

  function pildora(texto, clase, titulo) { return el('span', { class: `pildora ${clase || 'gris'}`, text: texto, title: titulo || null }); }

  function vacio(texto) { return el('p', { class: 'v-vacio', text: texto }); }

  // Tabla accesible con los datos de una gráfica (la ficha nunca es la única vía).
  function tablaDatos(resumen, columnas, filas) {
    return el('details', { class: 'v-datos' }, el('summary', { text: resumen }),
      el('div', { class: 'v-tabla-scroll' }, el('table', { class: 'v-tabla' },
        el('thead', {}, el('tr', {}, columnas.map(c => el('th', { scope: 'col', text: c })))),
        el('tbody', {}, filas.map(f => el('tr', {}, f.map((x, k) => (k === 0 ? el('th', { scope: 'row', text: x }) : el('td', { text: x })))))))));
  }

  // ================= Evolución =================

  PINTORES.evolucion = async ({ animar, fresco }) => {
    const rango = RANGOS.find(r => r.id === est.rango) || RANGOS[3];
    const ancho = $('vistas-panel').clientWidth || 800;
    const puntos = Math.max(300, Math.min(2000, Math.round(ancho * 1.5)));
    const ahora = ahoraMesa();
    const desde = rango.ms && valido(ahora) ? Math.floor(ahora - rango.ms) : null;
    const q = desde !== null ? `&desde=${desde}` : '';
    const [filas, decisiones] = await Promise.all([
      pedir(`/api/historial?puntos=${puntos}${q}`, { fresco }),
      pedir(`/api/decisiones?tipo=kill,pausa,ascenso,despido,descarte,asignacion&limite=500${q}`, { fresco }),
    ]);
    // Sin reloj de la mesa todavía (la instantánea no ha llegado): el periodo
    // se cuenta hacia atrás desde el último punto del historial.
    let lista = Array.isArray(filas) ? filas : [];
    if (desde === null && rango.ms && lista.length) {
      const fin = lista.reduce((m, l) => (l && valido(l.t) && l.t > m ? l.t : m), -Infinity);
      lista = lista.filter(l => l && l.t >= fin - rango.ms);
    }
    const s = seriesEvolucion(lista);
    const cont = el('div', { class: 'vistas-contenido' });
    cont._firma = firma(est.rango, filas, decisiones);

    const selector = el('div', { class: 'v-segmentos', role: 'radiogroup', 'aria-label': 'Periodo' }, RANGOS.map(r => el('button', {
      type: 'button', role: 'radio', class: `v-segmento${r.id === rango.id ? ' activo' : ''}`, 'aria-checked': String(r.id === rango.id),
      text: r.nombre, title: `Ver ${r.largo}`,
      onclick: () => { if (est.rango === r.id) return; est.rango = r.id; recordar('rango', r.id); est.animado.delete('evolucion'); pintarVista({ animar: true }); },
    })));
    cont.appendChild(el('div', { class: 'v-filtros' }, selector));

    if (!s.ts.length) {
      cont.appendChild(tarjeta('Evolución', null, vacio('Todavía no hay historial en este periodo: la mesa apunta un punto cada hora (y otro en cada cambio del comité, del reparto o un kill).')));
      return cont;
    }

    const i = inst();
    const patr = i && i.cabecera && valido(i.cabecera.patrimonio) ? i.cabecera.patrimonio : s.fondo[s.fondo.length - 1];
    const v = variacion(s.fondo);
    const heroe = el('div', { class: 'v-heroe' },
      el('div', {}, el('span', { class: 'v-rotulo', text: 'Patrimonio' }), cifra(patr, x => cifras.usd(x), 'grande', animar)),
      v ? el('div', {}, el('span', { class: 'v-rotulo', text: `En ${rango.largo}` }),
        el('span', { class: 'v-var' }, cifra(v.usd, x => cifras.usd(x, { signo: true }), cifras.claseSigno(v.usd, 0.005), animar),
          ' ', cifra(v.pct, x => cifras.pct(x, { signo: true }), `sub ${cifras.claseSigno(v.pct, 0.00005)}`, animar))) : null);
    cont.appendChild(heroe);
    cont.appendChild(el('p', { class: 'v-lectura', text: lecturaPeriodo(s, rango.largo) }));

    // 1. El fondo frente a sus sombras, en variación desde el inicio del periodo.
    const marcas = marcasDe(s.filas, decisiones);
    const bandas = bandasDe(s.filas, decisiones, s.ts[s.ts.length - 1]);
    const lineasSombra = [
      { id: 'fondo', nombre: 'El fondo', color: COLOR_FONDO, grosor: 2.5, principal: true, bruto: s.fondo },
      { id: 'btc', nombre: 'Comprar y mantener BTC', color: COLOR_SOMBRA.btc, bruto: s.btc },
      { id: 'cesta', nombre: 'Cesta cripto', color: COLOR_SOMBRA.cesta, bruto: s.cesta },
      { id: 'sinComite', nombre: 'Mismas mesas sin comité', color: COLOR_SOMBRA.sinComite, bruto: s.sinComite },
    ].filter(x => x.bruto.some(valido)).map(x => ({ ...x, valores: G.rebasar(x.bruto) }));
    const cajaSombras = el('div', { class: 'v-grafica' });
    const ley = G.leyenda(lineasSombra.map(x => {
      const va = variacion(x.bruto);
      return { color: x.color, nombre: x.nombre, valor: va ? cifras.pct(va.pct, { signo: true }) : '—' };
    }), { etiqueta: 'Series de la gráfica y su variación en el periodo' });
    const sucesosLeyenda = leyendaSucesos(marcas, bandas);
    const dias = porDia(s);
    cont.appendChild(tarjeta('El fondo frente a sus sombras',
      'Variación desde el inicio del periodo. Las sombras son carteras de comparación con el mismo capital inicial y sus costes: comprar y mantener BTC, la cesta cripto y las mismas mesas sin las decisiones del comité.',
      ley, cajaSombras, sucesosLeyenda,
      marcas.length ? el('details', { class: 'v-datos' }, el('summary', { text: `Sucesos del periodo (${marcas.length})` }),
        el('ul', { class: 'v-sucesos' }, marcas.slice().reverse().map(m => el('li', {}, formaSuceso(m), el('time', { text: cifras.momento(m.t, ahora) }),
          m.quien ? caraDe(quienEs(m.quien, i), i, 24) : null, el('span', { text: m.texto }))))) : null,
      tablaDatos(`Ver los datos por día (${dias.length})`, ['Día', 'Fondo', 'BTC', 'Cesta', 'Sin comité', 'Caída'],
        dias.slice().reverse().map(k => [cifras.fechaCorta(s.ts[k]), cifras.usd(s.fondo[k]), cifras.usd(s.btc[k]), cifras.usd(s.cesta[k]), cifras.usd(s.sinComite[k]), cifras.pct(s.caida[k], { decimales: 1 })]))));
    alMontar(cont, (primera) => G.lineas(cajaSombras, {
      ts: s.ts, series: lineasSombra, alto: altoGrafica(280), cero: true, animar: primera && animar,
      formatoY: (x, paso) => pctEje(x, paso, true),
      formatoValor: (x, serie, k) => ({ valor: cifras.pct(x, { signo: true }), detalle: cifras.usd(serie.bruto[k]) }),
      tituloFicha: t => `${cifras.fechaCorta(t)} ${cifras.hora(t)}`,
      marcas, bandas,
      descripcion: `Gráfica del fondo frente a sus sombras en ${rango.largo}. ${lecturaPeriodo(s, rango.largo)} Flechas izquierda y derecha para recorrerla.`,
    }));

    // 2. Resultado de cada mesa en el periodo.
    const mesasCon = s.mesas.filter(m => m.pnl.some(valido));
    if (mesasCon.length) {
      const seriesMesa = mesasCon.map(m => ({ id: m.id, nombre: m.nombre, color: colorMesa(m.id), valores: G.desdeInicio(m.pnl) }));
      const caja = el('div', { class: 'v-grafica' });
      cont.appendChild(tarjeta('Resultado de cada mesa',
        'Lo que ha ganado o perdido cada mesa en el periodo (o desde su alta), con lo cerrado y lo abierto de sus puestos.',
        G.leyenda(seriesMesa.map(x => { const u = x.valores.filter(valido); const fin = u.length ? u[u.length - 1] : null; return { color: x.color, nombre: x.nombre, valor: cifras.usd(fin, { signo: true }) }; }),
          { etiqueta: 'Mesas y su resultado en el periodo' }),
        caja));
      alMontar(cont, (primera) => G.lineas(caja, {
        ts: s.ts, series: seriesMesa, alto: altoGrafica(220), cero: true, animar: primera && animar,
        formatoY: (x, paso) => usdEje(x, paso), formatoValor: x => cifras.usd(x, { signo: true }),
        descripcion: `Resultado de cada mesa en ${rango.largo}.`,
      }));
    }

    // 3. Reparto del capital (áreas apiladas) y lo que queda sin asignar.
    if (s.mesas.length) {
      const rep = reparto(s);
      const capas = rep.capas.map(c => ({ id: c.id, nombre: c.nombre, color: colorMesa(c.id), valores: c.valores }))
        .concat([{ id: 'libre', nombre: 'Sin asignar (efectivo)', color: COLOR_SIN_ASIGNAR, valores: rep.libre }]);
      const caja = el('div', { class: 'v-grafica' });
      const ultimo = s.ts.length - 1;
      cont.appendChild(tarjeta('Reparto del capital',
        'Qué parte del patrimonio tiene asignada cada mesa en cada momento. Lo que no tiene ninguna se queda en efectivo.',
        G.leyenda(capas.map(c => ({ color: c.color, forma: 'caja', nombre: c.nombre, valor: cifras.pct(c.valores[ultimo], { decimales: 0 }) })).reverse(),
          { etiqueta: 'Reparto actual del capital' }),
        caja));
      alMontar(cont, (primera) => G.apiladas(caja, {
        ts: s.ts, capas, maxY: 1, alto: altoGrafica(200), animar: primera && animar, escalon: true,
        formatoY: (x, paso) => pctEje(x, paso), descripcion: `Reparto del capital entre mesas en ${rango.largo}.`,
      }));
    }

    // 4. Caída desde el máximo, con los límites del vigilante.
    if (s.caida.some(valido)) {
      const lim = i && i.limites ? i.limites : {};
      const caja = el('div', { class: 'v-grafica' });
      const minimo = Math.min(...s.caida.filter(valido));
      const refs = [];
      if (valido(lim.caidaReducir)) refs.push({ v: -lim.caidaReducir, texto: `−${cifras.pct(lim.caidaReducir, { decimales: 0 })}: tamaño a la mitad` });
      if (valido(lim.caidaKill) && minimo < -lim.caidaReducir) refs.push({ v: -lim.caidaKill, texto: `−${cifras.pct(lim.caidaKill, { decimales: 0 })}: kill` });
      cont.appendChild(tarjeta('Caída desde el máximo',
        `Cuánto está el fondo por debajo de su máximo histórico. Peor caída del periodo: ${cifras.pct(minimo, { decimales: 1 })}.${refs.length ? ' Las líneas marcan los límites del vigilante.' : ''}`,
        caja, refs.length ? el('ul', { class: 'g-leyenda' }, refs.map(r => el('li', {}, el('span', { class: 'g-llave ref' }), el('span', { class: 'g-leyenda-n', text: r.texto })))) : null));
      alMontar(cont, (primera) => {
        const valores = s.caida.map(x => (valido(x) ? x : null));
        G.lineas(caja, {
          ts: s.ts, series: [{ id: 'caida', nombre: 'Caída desde el máximo', color: G.PALETA[7], relleno: true, valores }],
          referencias: refs, alto: altoGrafica(170), cero: true, animar: primera && animar,
          formatoY: (x, paso) => pctEje(x, paso), formatoValor: x => cifras.pct(x, { decimales: 1 }),
          descripcion: `Caída del fondo desde su máximo en ${rango.largo}; la peor, ${cifras.pct(minimo, { decimales: 1 })}.`,
        });
      });
    }
    alMontar(cont, (primera) => { if (primera) animarCifras(cont); });
    return cont;
  };

  // Marcas de los ejes: los decimales los pide el paso, no el valor.
  function pctEje(x, paso, signo) {
    return cifras.pct(x, { decimales: valido(paso) ? G.decimalesPaso(paso, 100) : 0, signo: Boolean(signo) });
  }
  function usdEje(x, paso) {
    const d = valido(paso) ? Math.min(2, G.decimalesPaso(paso, 1)) : 0;
    const texto = cifras.numero(x, d);
    return `${x > 0 && /[1-9]/.test(texto) ? '+' : ''}${texto} $`;
  }

  const altoGrafica = (alto) => (typeof window !== 'undefined' && window.innerWidth < 600 ? Math.round(alto * 0.85) : alto);

  function formaSuceso(m) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 14 14');
    s.setAttribute('class', 'v-forma');
    s.setAttribute('aria-hidden', 'true');
    G.forma(s, m.forma, 7, 7, 5, m.color);
    return s;
  }

  function leyendaSucesos(marcas, bandas) {
    const tipos = new Map();
    const nombres = { kill: 'Kill switch', pausa: 'Pausa o reapertura', ascenso: 'Ascenso', despido: 'Despido', descarte: 'Descarte', alta: 'Mesa nueva', comite: 'Cambio de modo del comité' };
    for (const m of marcas) if (!tipos.has(m.tipo)) tipos.set(m.tipo, m);
    const items = [...tipos.values()].map(m => el('li', {}, formaSuceso(m), el('span', { class: 'g-leyenda-n', text: nombres[m.tipo] || m.tipo })));
    const vistas = new Set();
    for (const b of bandas) {
      if (vistas.has(b.texto)) continue;
      vistas.add(b.texto);
      const llave = el('span', { class: 'g-llave banda' });
      llave.style.setProperty('--c', b.color);
      items.push(el('li', {}, llave, el('span', { class: 'g-leyenda-n', text: b.texto })));
    }
    return items.length ? el('ul', { class: 'g-leyenda sucesos', 'aria-label': 'Marcas de la línea de tiempo' }, items) : null;
  }

  // ================= Estrategias =================

  PINTORES.estrategias = async ({ animar, fresco }) => {
    const datos = await pedir('/api/estrategias', { fresco });
    const cont = el('div', { class: 'vistas-contenido' });
    cont._firma = firma(datos);
    if (!datos || !Array.isArray(datos.mesas)) throw new Error((datos && datos.error) || 'La mesa no devolvió las estrategias.');
    const r = datos.resumen || {};
    const sa = r.sinAsignar;
    cont.appendChild(el('div', { class: 'v-intro' },
      el('p', { class: 'v-lectura', text: `${cifras.numero(r.total || 0)} ${r.total === 1 ? 'mesa' : 'mesas'}: ${cifras.numero(r.titulares || 0)} titular${r.titulares === 1 ? '' : 'es'}, ${cifras.numero(r.incubacion || 0)} en prueba y ${cifras.numero(r.banquillo || 0)} en el banquillo.${sa && valido(sa.fraccion) && sa.fraccion > 0.0005 ? ` Sin asignar: ${cifras.pct(sa.fraccion, { decimales: 0 })} del patrimonio${valido(sa.usd) ? ` (${cifras.usd(sa.usd)})` : ''}, en efectivo.` : ''}` }),
      el('p', { class: 'v-sub', text: 'Cada mesa es una estrategia con reglas fijas. Se compara lo que hace en papel con lo que hizo en su histórico (backtest), las dos con costes y el resultado de papel con su penalización: si en papel se porta mucho peor, la ventaja del histórico era suerte o ya no existe.' })));
    if (!datos.mesas.length) { cont.appendChild(vacio('Todavía no hay mesas.')); return cont; }
    const rejilla = el('div', { class: 'v-rejilla' });
    const i = inst();
    for (const m of datos.mesas) rejilla.appendChild(fichaMesa(m, cont, animar, datos.t, i));
    cont.appendChild(rejilla);
    alMontar(cont, (primera) => { if (primera) animarCifras(cont); });
    return cont;
  };

  // Quién opera la mesa: la cara de cada operador (botón a su ficha) y su activo.
  function operadores(m, i) {
    const lista = i && Array.isArray(i.agentes) ? i.agentes.filter(a => a.mesaId === m.id && a.puestoId) : [];
    if (!lista.length) return null;
    return el('div', { class: 'v-operadores' }, el('span', { class: 'v-rotulo', text: lista.length === 1 ? 'La opera' : 'La operan' }),
      el('ul', { class: 'v-operadores-lista' }, lista.map(a => el('li', {}, caraDe(quienEs(a.id, i), i, 24),
        el('span', { class: 'v-operador-n' }, pila(a.nombre), a.etiqueta ? el('span', { class: 'v-tenue', text: ` · ${a.etiqueta}` }) : null)))));
  }

  function fichaMesa(m, raizNodo, animar, ahora, i) {
    const color = colorMesa(m.id);
    const e = ESTADO_MESA[m.estado] || { texto: m.estado || '—', clase: 'gris', ayuda: '' };
    const x = m.explicacion || {};
    const papel = m.papel || {};
    const bt = m.backtest || null;
    const llave = el('span', { class: 'g-llave caja' });
    llave.style.setProperty('--c', color);
    const caja = el('div', { class: 'v-grafica mini' });
    const evol = Array.isArray(m.evolucion) ? m.evolucion : [];
    const porMes = (ops, dias) => (valido(ops) && valido(dias) && dias > 0 ? `(${cifras.numero(ops / dias * 30, 1)}/mes)` : null);
    const filaComp = (nombre, h, p) => el('tr', {}, el('th', { scope: 'row', text: nombre }), el('td', { text: h }), el('td', { text: p }));
    const tono = m.lectura ? ({ mejor: 'bien', peor: 'mal' }[m.lectura.tipo] || 'neutro') : 'neutro';
    const ficha = el('article', { class: 'v-mesa', 'aria-labelledby': `mesa-${m.id}` },
      el('header', { class: 'v-mesa-cab' }, llave, el('h3', { id: `mesa-${m.id}`, text: m.nombre }), pildora(e.texto, e.clase, e.ayuda)),
      el('p', { class: 'v-mesa-sub', text: [FAMILIA[m.familia] || m.familia, MARCO[m.marco] || m.marco, valido(m.diasActiva) ? `${cifras.numero(m.diasActiva)} ${m.diasActiva === 1 ? 'día' : 'días'} en marcha` : null].filter(Boolean).join(' · ') }),
      el('div', { class: 'v-mesa-cifras' },
        el('div', {}, el('span', { class: 'v-rotulo', text: 'Peso' }), cifra(m.peso, y => cifras.pct(y, { decimales: 0 }), null, animar),
          valido(m.capital) ? el('span', { class: 'v-mini-sub', text: cifras.usd(m.capital) }) : null),
        el('div', {}, el('span', { class: 'v-rotulo', text: 'Resultado en papel' }), cifra(papel.pnlTotal, y => cifras.usd(y, { signo: true }), cifras.claseSigno(papel.pnlTotal, 0.005), animar),
          el('span', { class: 'v-mini-sub', text: `${cifras.numero(papel.operaciones || 0)} operaciones` }))),
      evol.length > 1 ? caja : null,
      el('div', { class: 'v-activos', 'aria-label': 'Activos que opera' }, (m.universo || []).map(a => el('span', { class: 'v-chip', text: a }))),
      operadores(m, i),
      x.queMira ? el('p', { class: 'v-explica', text: x.queMira }) : null,
      (x.cuandoCompra || x.cuandoVende || x.cuandoNada || x.riesgo || x.filtros) ? el('details', { class: 'v-datos' }, el('summary', { text: 'Cuándo compra, cuándo vende y cuánto arriesga' }),
        el('dl', { class: 'v-dl' },
          x.cuandoCompra ? [el('dt', { text: 'Compra' }), el('dd', { text: x.cuandoCompra })] : null,
          x.cuandoVende ? [el('dt', { text: 'Vende' }), el('dd', { text: x.cuandoVende })] : null,
          x.cuandoNada ? [el('dt', { text: 'No hace nada' }), el('dd', { text: x.cuandoNada })] : null,
          x.riesgo ? [el('dt', { text: 'Riesgo' }), el('dd', { text: x.riesgo })] : null,
          x.filtros ? [el('dt', { text: 'Filtros' }), el('dd', { text: x.filtros })] : null)) : null,
      el('div', { class: 'v-tabla-scroll' }, el('table', { class: 'v-tabla v-comparar' },
        el('caption', { class: 'visualmente-oculto', text: `Histórico frente a papel de ${m.nombre}` }),
        el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: '' }),
          el('th', { scope: 'col' }, 'Histórico', bt && valido(bt.dias) ? el('span', { class: 'v-th-sub', text: `${cifras.numero(bt.dias)} días` }) : null),
          el('th', { scope: 'col' }, 'Papel', valido(m.diasActiva) ? el('span', { class: 'v-th-sub', text: `${cifras.numero(m.diasActiva)} días` }) : null))),
        el('tbody', {},
          filaComp('Sharpe', bt ? n2(bt.sharpe) : '—', n2(papel.sharpe)),
          filaComp('Caída máxima', bt && valido(bt.maxDD) ? cifras.pct(bt.maxDD, { decimales: 1 }) : '—', valido(papel.maxDD) ? cifras.pct(papel.maxDD, { decimales: 1 }) : '—'),
          filaComp('Operaciones', bt && valido(bt.operaciones) ? [cifras.numero(bt.operaciones), porMes(bt.operaciones, bt.dias)].filter(Boolean).join(' ') : '—',
            [cifras.numero(papel.operaciones || 0), porMes(papel.operaciones, m.diasActiva)].filter(Boolean).join(' '))))),
      textoResultados(bt, papel),
      m.lectura ? el('p', { class: `v-veredicto ${tono}`, text: m.lectura.texto }) : null,
      m.regla ? el('p', { class: 'v-regla', text: m.regla.texto }) : null,
      m.nota ? el('p', { class: 'v-nota', text: m.nota }) : null,
      Array.isArray(m.hitos) && m.hitos.length ? el('details', { class: 'v-datos' }, el('summary', { text: `Su historia (${m.hitos.length})` }),
        el('ul', { class: 'v-sucesos' }, m.hitos.slice().reverse().map(h => el('li', {}, el('time', { text: cifras.momento(h.t, ahora) }), el('span', { text: h.texto }))))) : null);
    if (evol.length > 1) {
      alMontar(raizNodo, (primera) => G.lineas(caja, {
        ts: evol.map(p => p.t), compacto: true, alto: 64, cero: true, animar: primera && animar,
        series: [{ id: m.id, nombre: 'Resultado acumulado', color, relleno: true, valores: evol.map(p => (valido(p.pnl) ? p.pnl : null)) }],
        formatoY: (y, paso) => usdEje(y, paso), formatoValor: y => cifras.usd(y, { signo: true }),
        notasFicha: (k) => { const p = evol[k]; return p ? [{ texto: `${ESTADO_MESA[p.estado] ? ESTADO_MESA[p.estado].texto : p.estado || ''} · peso ${cifras.pct(p.peso, { decimales: 0 })}` }] : []; },
        descripcion: `Resultado acumulado de ${m.nombre} en papel desde su alta.`,
      }));
    }
    return ficha;
  }
  const n2 = x => (valido(x) ? cifras.numero(x, 2) : '—');

  // El resultado no va en la tabla: el histórico es un % sobre su capital y el
  // papel son dólares sobre un capital que cambia con cada reparto; puestos
  // lado a lado parecerían comparables y no lo son.
  function textoResultados(bt, papel) {
    const h = bt && valido(bt.rentabilidad) ? `el histórico dio ${cifras.pct(bt.rentabilidad, { signo: true })} sobre su capital` : null;
    const p = valido(papel.pnlTotal) ? `en papel lleva ${cifras.usd(papel.pnlTotal, { signo: true })} desde su alta` : null;
    if (!h && !p) return null;
    const texto = [h, p].filter(Boolean).join('; ');
    return el('p', { class: 'v-tenue v-resultados', text: `Resultado: ${texto}.${h && p ? ' No se comparan: uno es un porcentaje y el otro dólares sobre un capital que ha cambiado con cada reparto.' : ''}` });
  }

  // ================= Noticias =================

  PINTORES.noticias = async ({ fresco }) => {
    const f = est.noticias;
    const q = new URLSearchParams({ limite: '200' });
    if (f.simbolo) q.set('simbolo', f.simbolo);
    if (f.graves) q.set('graves', '1');
    const lista = await pedir(`/api/noticias?${q.toString()}`, { fresco });
    const i = inst();
    const ahora = ahoraMesa();
    const cont = el('div', { class: 'vistas-contenido' });
    cont._firma = firma(q.toString(), lista);
    const activos = new Set((i && Array.isArray(i.cotizaciones) ? i.cotizaciones : []).map(c => c.etiqueta).filter(Boolean));
    for (const n of lista || []) for (const s of n.simbolos || []) activos.add(String(s).split('/')[0]);
    const sel = el('select', { class: 'campo v-select', id: 'v-noticias-activo', 'aria-label': 'Filtrar por activo',
      onchange: (e) => { est.noticias.simbolo = e.target.value; pintarVista({ fresco: true }); } },
    el('option', { value: '', text: 'Todos los activos' }), [...activos].sort().map(a => el('option', { value: a, text: a, selected: a === f.simbolo })));
    const graves = el('label', { class: 'v-check' }, el('input', { type: 'checkbox', checked: f.graves, onchange: (e) => { est.noticias.graves = e.target.checked; pintarVista({ fresco: true }); } }), el('span', { text: 'Solo graves' }));
    cont.appendChild(el('div', { class: 'v-filtros' }, sel, graves));
    if (i && i.llm && !i.llm.activo && (lista || []).length) {
      cont.appendChild(el('p', { class: 'v-aviso', text: 'Sin LLM activo: las noticias se guardan tal cual llegan, pero nadie las clasifica ni veta activos por ellas.' }));
    }
    if (!Array.isArray(lista) || !lista.length) {
      cont.appendChild(tarjeta(null, null, vacio(textoSinNoticias(i, f))));
      return cont;
    }
    cont.appendChild(el('p', { class: 'v-sub', text: `${cifras.numero(lista.length)} ${lista.length === 1 ? 'noticia' : 'noticias'}${f.simbolo ? ` de ${f.simbolo}` : ''}${f.graves ? ' graves' : ''}, de la más reciente a la más antigua. Llegan de Alpaca cada hora.` }));
    const ul = el('ul', { class: 'v-noticias' });
    for (const n of lista) ul.appendChild(fichaNoticia(n, ahora));
    cont.appendChild(ul);
    return cont;
  };

  function textoSinNoticias(i, f) {
    if (f.simbolo || f.graves) return 'Ninguna noticia con ese filtro.';
    const modo = i && i.modo;
    if (modo === 'sintetico') return 'En el modo sintético no hay noticias: los precios son inventados y no se inventan titulares.';
    if (modo === 'alpaca') return 'Aún no ha llegado ninguna noticia. La mesa las pide a Alpaca cada hora para los activos que opera.';
    return 'No hay noticias. Llegan de Alpaca y hacen falta sus claves en el .env (ALPACA_API_KEY_ID y ALPACA_API_SECRET_KEY); sin claves, esta lista se queda vacía.';
  }

  function fichaNoticia(n, ahora) {
    const cuando = valido(n.publicada) ? n.publicada : n.t;
    const cls = Array.isArray(n.clasificacion) ? n.clasificacion : null;
    const grave = cls && cls.some(c => c && c.grave);
    const url = typeof n.url === 'string' && /^https?:\/\//i.test(n.url) ? n.url : null;
    const titular = n.titular || '(sin titular)';
    const veto = n.veto && valido(n.veto.hasta) ? n.veto : null;
    const vigente = veto && valido(ahora) ? veto.hasta > ahora : null;
    return el('li', { class: `v-noticia${grave ? ' grave' : ''}` },
      el('div', { class: 'v-noticia-cab' }, el('time', { text: cifras.momento(cuando, ahora) }),
        n.fuente ? el('span', { class: 'v-fuente', text: n.fuente }) : null,
        (n.simbolos || []).map(s => el('span', { class: 'v-chip', text: String(s).split('/')[0] }))),
      el('h3', { class: 'v-noticia-t' }, url ? el('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text: titular }) : titular),
      n.resumen ? el('details', { class: 'v-datos' }, el('summary', { text: 'Resumen' }), el('p', { text: n.resumen })) : null,
      el('div', { class: 'v-clasif' },
        cls === null ? el('span', { class: 'v-tenue', text: 'Sin clasificar todavía.' })
          : !cls.length ? el('span', { class: 'v-tenue', text: 'Clasificada: nada que afecte a la mesa.' })
            : cls.map(c => el('span', { class: `v-etq${c.grave ? ' grave' : ''}` }, c.grave ? '⚠ ' : '', `${String(c.simbolo || '').split('/')[0]} · ${CATEGORIA[c.categoria] || c.categoria || '—'}${c.grave ? ' · grave' : ''}`))),
      veto ? el('p', { class: `v-veto${vigente ? ' vigente' : ''}` },
        `${vigente ? 'Veta' : 'Vetó'} abrir posiciones en ${(veto.simbolos && veto.simbolos.length ? veto.simbolos : [veto.simbolo]).map(s => String(s).split('/')[0]).join(', ')} hasta ${cifras.hastaLas(veto.hasta, ahora)}${vigente === false ? ' (ya pasó)' : ''}.`) : null);
  }

  // ================= Decisiones =================

  PINTORES.decisiones = async ({ fresco }) => {
    const g = GRUPOS_DECISION.find(x => x.id === est.grupoDecision) || GRUPOS_DECISION[0];
    const q = new URLSearchParams({ limite: String(est.limiteDecisiones) });
    if (g.tipos) q.set('tipo', g.tipos.join(','));
    if (est.quienDecision) q.set('quien', est.quienDecision);
    const lista = await pedir(`/api/decisiones?${q.toString()}`, { fresco });
    const i = inst();
    const ahora = ahoraMesa();
    const cont = el('div', { class: 'vistas-contenido' });
    cont._firma = firma(q.toString(), lista);
    // Desde la ficha de un agente: solo las suyas, con su cara y cómo quitar el filtro.
    const de = est.quienDecision ? quienEs(est.quienDecision, i) : null;
    if (de) {
      cont.appendChild(el('div', { class: 'v-quien' }, caraDe(de, i, 40),
        el('div', { class: 'v-quien-t' }, el('b', { text: `Decisiones de ${de.nombre}` }), de.rol ? el('span', { class: 'v-tenue', text: de.rol }) : null),
        el('button', { class: 'boton enlace', type: 'button', text: 'Ver las de todos', onclick: () => abrir('decisiones', { quien: null }) })));
    }
    cont.appendChild(el('div', { class: 'v-filtros chips', role: 'toolbar', 'aria-label': 'Filtrar decisiones por tipo' }, GRUPOS_DECISION.map(x => el('button', {
      type: 'button', class: `chip${x.id === g.id ? ' activa' : ''}`, 'aria-pressed': String(x.id === g.id), text: x.nombre,
      onclick: () => { est.grupoDecision = x.id; est.limiteDecisiones = 300; pintarVista({ fresco: true }); },
    }))));
    const ordenada = (Array.isArray(lista) ? lista : []).slice().sort((a, b) => b.t - a.t);
    if (!ordenada.length) {
      cont.appendChild(tarjeta(null, null, vacio(de
        ? `${pila(de.nombre)} no tiene decisiones apuntadas${g.tipos ? ' de este tipo' : ''}. Aquí salen las que toma cada uno: el comité y las reuniones, las órdenes, los vetos y recortes, los cambios de estrategia, el laboratorio, el kill, las pausas y las noticias graves.`
        : g.tipos ? 'Ninguna decisión de este tipo todavía.' : 'Todavía no hay decisiones apuntadas: se apuntan desde que la mesa arranca con esta versión.')));
      return cont;
    }
    cont.appendChild(el('p', { class: 'v-sub', text: `${de ? `Lo que ha decidido ${pila(de.nombre)}, con sus datos` : 'Cada decisión real de la mesa, con quién la tomó y sus datos'}. Las ${cifras.numero(ordenada.length)} más recientes${g.tipos ? ` de «${g.nombre}»` : ''}.` }));
    const ol = el('ol', { class: 'v-linea' });
    let dia = null;
    const items = g.id === 'todas' ? agruparRutina(ordenada) : ordenada;
    for (const d of items) {
      const t = d.grupo ? d.items[0].t : d.t;
      const k = cifras.dia(t);
      if (k !== dia) { dia = k; ol.appendChild(el('li', { class: 'separador-dia', text: cifras.dia(ahora) === k ? 'Hoy' : cifras.fechaCorta(t) })); }
      ol.appendChild(d.grupo ? filaRutina(d.items, i, ahora) : filaDecision(d, i, ahora));
    }
    cont.appendChild(ol);
    if (ordenada.length >= est.limiteDecisiones && est.limiteDecisiones < 5000) {
      cont.appendChild(el('button', { class: 'boton v-mas', type: 'button', text: 'Ver más antiguas', onclick: () => { est.limiteDecisiones = Math.min(5000, est.limiteDecisiones * 2); pintarVista({ fresco: true }); } }));
    }
    return cont;
  };

  // La cara de quien decidió; si es un agente de la plantilla, es un botón a su ficha.
  function caraDe(q, i, tam) {
    const nodo = caraSola(q, i, tam);
    if (!q.agente || typeof est.opciones.alVerAgente !== 'function') return nodo;
    return el('button', { class: 'v-cara-boton', type: 'button', 'aria-label': `Ficha de ${q.nombre}`, title: `Ficha de ${q.nombre}`, 'data-agente': q.id,
      onclick: () => verAgente(q.id) }, nodo);
  }

  // Cierra los informes y abre la ficha del agente en el parqué.
  function verAgente(id) {
    est.sinFoco = true;
    cerrar();
    if (!est.abierta) est.sinFoco = false;
    est.opciones.alVerAgente(id);
  }


  function caraSola(q, i, tam) {
    if (caras && typeof caras.nodoCara === 'function') {
      try {
        if (q.id === 'humano') return caras.nodoCara('humano', { tam, etiqueta: q.nombre });
        if (q.agente) {
          const dep = i && Array.isArray(i.departamentos) ? i.departamentos.find(d => d.id === q.agente.departamento) : null;
          return caras.nodoCara(q.agente, { tam, color: dep ? dep.color : null, etiqueta: q.nombre });
        }
        return caras.nodoCara('sistema', { tam, etiqueta: q.nombre });
      } catch (_) { /* sin caras: la inicial */ }
    }
    const ini = String(q.nombre || '?').trim().split(/\s+/).map(p => p[0] || '').join('').slice(0, 2).toUpperCase();
    return el('span', { class: `v-inicial cara-${tam}`, 'aria-hidden': 'true', text: ini || '?' });
  }

  function filaDecision(d, i, ahora) {
    const q = quienEs(d.quien, i);
    const datos = d.datos && typeof d.datos === 'object' ? Object.entries(d.datos) : [];
    return el('li', { class: `v-decision tipo-${d.tipo}` },
      caraDe(q, i, 40),
      el('div', { class: 'v-decision-cuerpo' },
        el('div', { class: 'v-decision-cab' },
          el('b', { text: q.nombre }), q.rol ? el('span', { class: 'v-tenue', text: q.rol }) : null,
          pildora(TIPO_DECISION[d.tipo] || d.tipo, CLASE_TIPO[d.tipo] || 'gris'),
          el('time', { text: cifras.hora(d.t) })),
        el('p', { class: 'v-decision-t', text: d.resumen || '' }),
        datos.length ? el('details', { class: 'v-datos' }, el('summary', { text: 'Ver los datos' }),
          el('dl', { class: 'v-dl compacta' }, datos.map(([k, v]) => [el('dt', { text: k }), el('dd', { text: textoValor(v) })]))) : null));
  }

  function filaRutina(items, i, ahora) {
    const q = quienEs(items[0].quien, i);
    const modo = items[0].datos && items[0].datos.modo;
    return el('li', { class: 'v-decision rutina' },
      caraDe(q, i, 24),
      el('div', { class: 'v-decision-cuerpo' },
        el('details', { class: 'v-datos' },
          el('summary', { text: `${cifras.numero(items.length)} reuniones del comité sin cambios (modo ${cifras.modoComite(modo)}), de ${cifras.hora(items[items.length - 1].t)} a ${cifras.hora(items[0].t)}` }),
          el('ul', { class: 'v-sucesos' }, items.map(d => el('li', {}, el('time', { text: cifras.hora(d.t) }), el('span', { text: d.resumen || '' })))))));
  }

  // ================= Laboratorio =================

  PINTORES.laboratorio = async ({ animar, fresco }) => {
    const datos = await pedir('/api/laboratorio', { fresco });
    if (!datos || !Array.isArray(datos.hipotesis)) throw new Error((datos && datos.error) || 'La mesa no devolvió el laboratorio.');
    const ahora = ahoraMesa();
    const r = datos.resumen || {};
    const cont = el('div', { class: 'vistas-contenido' });
    cont._firma = firma(datos);
    // Quién crea las estrategias: el director del laboratorio (y el auditor, que le da pistas).
    const i = inst();
    const director = quienEs('laboratorio', i);
    const auditor = quienEs('auditor', i);
    cont.appendChild(el('div', { class: 'v-intro' },
      el('h2', { class: 'v-pregunta', text: '¿Quien crea las estrategias lo hace bien?' }),
      director.agente ? el('div', { class: 'v-quien' }, caraDe(director, i, 40),
        el('div', { class: 'v-quien-t' }, el('b', { text: director.nombre }), el('span', { class: 'v-tenue', text: `${director.rol}: propone las ideas y las examina.${auditor.agente ? ` ${pila(auditor.nombre)}, el auditor, le pasa pistas de las operaciones cerradas.` : ''}` })),
        el('button', { class: 'boton enlace', type: 'button', text: 'Sus decisiones', onclick: () => abrir('decisiones', { quien: 'laboratorio' }) })) : null,
      el('p', { class: 'v-sub', text: 'El laboratorio propone ideas nuevas (hipótesis) cada semana y las pasa por una serie de puertas con datos que la idea no vio al ajustarse. Solo se contrata la que las pasa todas, y entra en prueba con poco capital. Que rechace la mayoría es buena señal: casi todas las ideas que parecen buenas en el histórico lo son por suerte.' })));
    cont.appendChild(el('div', { class: 'v-fichas' },
      tile('Hipótesis evaluadas', r.evaluadas, x => cifras.numero(x), animar, valido(r.pendientes) && r.pendientes ? `${cifras.numero(r.pendientes)} en cola` : null),
      tile('Aprobadas', r.aprobadas, x => cifras.numero(x), animar, valido(r.tasaAprobacion) ? `${cifras.pct(r.tasaAprobacion, { decimales: 0 })} de las evaluadas` : null),
      tile('Ensayos acumulados', datos.ensayosTotales, x => cifras.numero(x), animar, 'combinaciones probadas; cuentan en el DSR'),
      tile('Contratadas', r.contratadas, x => cifras.numero(x), animar, valido(datos.proximaRevision) ? `próxima revisión: ${cifras.momento(datos.proximaRevision, ahora)}` : null)));

    // Qué puertas pasan: barras que crecen desde la izquierda.
    if (Array.isArray(datos.puertas) && datos.puertas.length) {
      const orden = datos.puertas.slice().sort((a, b) => (a.pasan / Math.max(1, a.miradas)) - (b.pasan / Math.max(1, b.miradas)));
      cont.appendChild(tarjeta('Qué puertas pasan', 'De las hipótesis evaluadas, qué parte pasa cada puerta. La que más tumba es la que más protege: dice dónde fallan las ideas.',
        el('ul', { class: 'v-barras' + (animar ? ' g-entra' : '') }, orden.map((p, k) => {
          const frac = p.miradas ? p.pasan / p.miradas : 0;
          const barra = el('span', { class: 'v-barra-relleno' });
          barra.style.setProperty('--f', String(frac));
          barra.style.setProperty('--retraso', `${k * 35}ms`);
          return el('li', {},
            el('div', { class: 'v-barra-cab' }, el('b', { text: NOMBRE_PUERTA[p.nombre] || p.nombre }),
              el('span', { text: `${cifras.numero(p.pasan)} de ${cifras.numero(p.miradas)} (${cifras.pct(frac, { decimales: 0 })})` })),
            el('span', { class: 'v-barra', role: 'img', 'aria-label': `${cifras.pct(frac, { decimales: 0 })} pasan` }, barra),
            PUERTAS[p.nombre] ? el('p', { class: 'v-explica', text: PUERTAS[p.nombre] }) : null);
        }))));
    }

    if (Array.isArray(datos.contratadas) && datos.contratadas.length) {
      cont.appendChild(tarjeta('Las aprobadas, en papel', 'La prueba de verdad: cómo van con datos que nadie había visto, frente a su histórico.',
        el('div', { class: 'v-tabla-scroll' }, el('table', { class: 'v-tabla' },
          el('thead', {}, el('tr', {}, ['Mesa', 'Estado', 'Días', 'Operaciones', 'Sharpe papel', 'Sharpe histórico'].map(x => el('th', { scope: 'col', text: x })))),
          el('tbody', {}, datos.contratadas.map(c => el('tr', {},
            el('th', { scope: 'row', text: c.mesa || c.mesaId || '—' }),
            el('td', { text: c.estadoActual ? (ESTADO_MESA[c.estadoActual] || { texto: c.estadoActual }).texto : 'ya no está' }),
            el('td', { text: valido(c.diasActiva) ? cifras.numero(c.diasActiva) : '—' }),
            el('td', { text: valido(c.operaciones) ? cifras.numero(c.operaciones) : '—' }),
            el('td', { text: n2(c.sharpePapel) }), el('td', { text: n2(c.sharpeBacktest) }))))))));
    }

    if (!datos.hipotesis.length) {
      cont.appendChild(tarjeta('Hipótesis', null, vacio(`Aún no ha evaluado ninguna hipótesis.${valido(datos.proximaRevision) ? ` La próxima revisión es ${cifras.momento(datos.proximaRevision, ahora)}.` : ''}`)));
    } else {
      const ul = el('ul', { class: 'v-hipotesis' });
      for (const h of datos.hipotesis) ul.appendChild(fichaHipotesis(h, ahora));
      cont.appendChild(tarjeta(`Hipótesis (${cifras.numero(datos.hipotesis.length)})`, 'De la más reciente a la más antigua, con cada puerta: su valor frente al umbral.', ul));
    }
    alMontar(cont, (primera) => { if (primera) animarCifras(cont); });
    return cont;
  };

  function tile(rotulo, valor, formato, animar, sub) {
    return el('div', { class: 'v-ficha-cifra' }, el('span', { class: 'v-rotulo', text: rotulo }),
      valido(valor) ? cifra(valor, formato, 'media', animar) : el('span', { class: 'v-cifra media', text: '—' }),
      sub ? el('span', { class: 'v-mini-sub', text: sub }) : null);
  }

  function fichaHipotesis(h, ahora) {
    const e = ESTADO_HIPOTESIS[h.estado] || { texto: h.estado || '—', clase: 'gris' };
    const wf = h.walkforward;
    const crit = Array.isArray(h.criterios) ? h.criterios : [];
    return el('li', { class: `v-hip ${h.estado || ''}` },
      el('div', { class: 'v-hip-cab' }, pildora(e.texto, e.clase), el('time', { text: valido(h.t) ? cifras.momento(h.t, ahora) : '' }),
        valido(h.puertasOk) && valido(h.puertasTotal) ? el('span', { class: 'v-tenue', text: `pasa ${cifras.numero(h.puertasOk)} de ${cifras.numero(h.puertasTotal)} puertas` }) : null),
      el('p', { class: 'v-hip-t', text: h.descripcion || h.id }),
      h.motivo ? el('p', { class: 'v-tenue', text: `${h.origen === 'leccion' ? 'Sale de lo aprendido en operaciones cerradas: ' : ''}${h.motivo}` }) : null,
      crit.length ? el('ul', { class: 'v-criterios' }, crit.map(c => el('li', { class: c.ok ? 'ok' : 'no' },
        el('span', { class: 'v-marca', 'aria-hidden': 'true', text: c.ok ? '✓' : '✗' }),
        el('span', { class: 'visualmente-oculto', text: c.ok ? 'pasa: ' : 'no pasa: ' }),
        el('span', { class: 'v-crit-n', text: NOMBRE_PUERTA[c.nombre] || c.nombre, title: PUERTAS[c.nombre] || null }),
        el('span', { class: 'v-crit-v', text: `${valorCriterio(c, c.valor)} ${c.comparacion || ''} ${valorCriterio(c, c.umbral)}`.replace(/\s+/g, ' ').trim() }),
        detalleCriterio(c) ? el('span', { class: 'v-crit-d', text: detalleCriterio(c) }) : null))) : (h.estado === 'pendiente' || h.estado === 'evaluando' ? el('p', { class: 'v-tenue', text: 'Esperando su evaluación.' }) : null),
      wf ? el('p', { class: 'v-tenue', text: `Walk-forward: ${valido(wf.ventanas) ? `${cifras.numero(wf.ventanas)} tramos` : 'tramos sin dato'}${valido(wf.entrenoMeses) && valido(wf.pruebaMeses) ? ` (${cifras.numero(wf.entrenoMeses)} meses para ajustar y ${cifras.numero(wf.pruebaMeses)} para probar)` : ''}; ${cifras.numero(wf.combinaciones || 0)} combinaciones de parámetros probadas.` }) : null,
      h.contratada ? el('p', { class: 'v-veredicto bien', text: `Contratada como mesa «${h.contratada.mesa || h.contratada.mesaId}» el ${cifras.fechaCorta(h.contratada.t)}.` }) : null,
      h.informe ? el('details', { class: 'v-datos' }, el('summary', { text: 'Informe completo' }), el('p', { class: 'v-informe', text: h.informe })) : null);
  }

  return {
    VISTAS, RANGOS, GRUPOS_DECISION, PUERTAS, NOMBRE_PUERTA, ORDEN_MESAS, COLOR_FONDO, COLOR_SOMBRA,
    colorMesa, seriesEvolucion, reparto, variacion, lecturaPeriodo, marcasDe, bandasDe, porDia, agruparRutina,
    valorCriterio, detalleCriterio, textoValor, quienEs, textoSinNoticias,
    iniciar, abrir, cerrar, abierta: () => est.abierta, vista: () => est.vista,
  };
});
