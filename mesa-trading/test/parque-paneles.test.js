'use strict';
// Parqué · textos de los paneles que no necesitan navegador: directivas del
// Megáfono, franja de conexión, criterios del laboratorio y rentabilidad del fondo.
const test = require('node:test');
const assert = require('node:assert/strict');
const paneles = require('../web/js/paneles.js');

const MESAS = [{ id: 'reversion', nombre: 'Reversión RSI' }, { id: 'lab3', nombre: 'Tendencia SMA 14/60' }];

test('Megáfono: la propuesta nombra la mesa como la ve Eduardo, no por su id', () => {
  assert.equal(paneles.textoDirectiva({ tipo: 'pausar_mesa', mesaId: 'reversion', horas: 6 }, MESAS), 'Pausar la mesa Reversión RSI durante 6 h.');
  assert.equal(paneles.textoDirectiva({ tipo: 'reanudar_mesa', mesaId: 'lab3' }, MESAS), 'Quitar la pausa del Megáfono a la mesa Tendencia SMA 14/60.');
  // Sin la lista (o con una mesa que ya no existe) se queda el id: nunca «undefined».
  assert.equal(paneles.textoDirectiva({ tipo: 'pausar_mesa', mesaId: 'reversion', horas: 6 }), 'Pausar la mesa reversion durante 6 h.');
  assert.equal(paneles.textoDirectiva({ tipo: 'pausar_activo', simbolo: 'SOL/USD', horas: 6 }, MESAS), 'No abrir en SOL durante 6 h.');
});

test('Megáfono: el motivo de «sin efecto» (escrito por el LLM) se acota', () => {
  const largo = 'La exposición bruta ya está en el 87 % '.repeat(20);
  const t = paneles.textoDirectiva({ tipo: 'sin_efecto', motivo: largo });
  assert.ok(t.length <= 'Sin efecto: '.length + 160 + 1, `largo ${t.length}`);
  assert.ok(t.endsWith('….'));
  assert.equal(paneles.textoDirectiva({ tipo: 'sin_efecto', motivo: 'pide más riesgo.' }), 'Sin efecto: pide más riesgo.');
  assert.equal(paneles.textoDirectiva({ tipo: 'sin_efecto' }), 'Sin efecto: no hay nada que aplicar.');
});

test('franja de conexión: dice por qué no hay conexión cuando se sabe', () => {
  assert.equal(paneles.textoConexion(4000, 'token'), 'Falta el token del panel: abre la URL con ?token=… (el valor de PANEL_TOKEN).');
  assert.match(paneles.textoConexion(4000, 'token-malo'), /^El token del panel no vale/);
  assert.match(paneles.textoConexion(8000, 'lleno'), /^Hay demasiados paneles abiertos contra la mesa: cierra alguna pestaña\. Reintentando en 8 s…$/);
  assert.equal(paneles.textoConexion(4000, null), 'Sin conexión con la mesa, reintentando en 4 s…');
  assert.match(paneles.textoConexion(2000, 'arrancando'), /^La mesa está arrancando .* Reintentando en 2 s…$/);
});

test('criterios del laboratorio con su unidad', () => {
  assert.equal(paneles.valorCriterio({ nombre: 'Sharpe OOS' }, 0.4123), '0,41');
  assert.equal(paneles.valorCriterio({ nombre: 'Operaciones OOS' }, 44), '44');
  assert.equal(paneles.valorCriterio({ nombre: 'maxDD OOS' }, 0.183), '18 %');
  assert.equal(paneles.valorCriterio({ nombre: 'Ventanas de prueba en positivo' }, 0.6667), '67 %');
  assert.equal(paneles.valorCriterio({ nombre: 'Sharpe deflactado' }, null), '—');
});

test('capital de partida sacado de las sombras (todas empiezan con él)', () => {
  const inst = { benchmarks: [{ id: 'btc', valor: 101000, rentabilidad: 0.01 }, { id: 'sin-comite', valor: 99000, rentabilidad: -0.01 }] };
  assert.ok(Math.abs(paneles.capitalDe(inst) - 100000) < 1e-6);
  assert.equal(paneles.capitalDe({ benchmarks: [{ valor: null, rentabilidad: null }] }), null);
});

// ---------- con un DOM falso: modales, píldora del nivel y ficha del puesto ----------
// Lo justo del DOM que usa paneles.js. Como el de verdad, Element.append(null)
// escribe el texto «null» (así se veía en el modal Reabrir).
class FNodo {
  constructor(doc) { this.ownerDocument = doc; this.childNodes = []; this.parentNode = null; }
  appendChild(n) {
    if (n.nodeType === 11) { for (const c of n.childNodes.slice()) this.appendChild(c); return n; }
    if (n.parentNode) n.parentNode.removeChild(n);
    n.parentNode = this;
    this.childNodes.push(n);
    return n;
  }
  append(...ns) { for (const n of ns) this.appendChild(n instanceof FNodo ? n : this.ownerDocument.createTextNode(String(n))); }
  insertBefore(n, ref) {
    if (!ref) return this.appendChild(n);
    if (n.parentNode) n.parentNode.removeChild(n);
    n.parentNode = this;
    this.childNodes.splice(this.childNodes.indexOf(ref), 0, n);
    return n;
  }
  removeChild(n) { this.childNodes.splice(this.childNodes.indexOf(n), 1); n.parentNode = null; return n; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  get textContent() { return this.childNodes.map(c => c.textContent).join(''); }
  set textContent(v) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    if (v !== '' && v !== null && v !== undefined) this.appendChild(this.ownerDocument.createTextNode(String(v)));
  }
  contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
}
class FTexto extends FNodo {
  constructor(doc, t) { super(doc); this.nodeType = 3; this.data = t; }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
}
class FElemento extends FNodo {
  constructor(doc, tag) {
    super(doc);
    this.nodeType = 1; this.tagName = tag.toUpperCase(); this.atributos = new Map();
    this.style = { cssText: '', setProperty() {} }; this.dataset = {}; this.oyentes = {}; this.scrollTop = 0; this.open = false;
  }
  get children() { return this.childNodes.filter(c => c.nodeType === 1); }
  get firstElementChild() { return this.children[0] || null; }
  get lastElementChild() { const h = this.children; return h[h.length - 1] || null; }
  get previousElementSibling() { const h = this.parentNode ? this.parentNode.children : []; return h[h.indexOf(this) - 1] || null; }
  get childElementCount() { return this.children.length; }
  get className() { return this.getAttribute('class') || ''; }
  set className(v) { this.setAttribute('class', v); }
  get id() { return this.getAttribute('id') || ''; }
  get hidden() { return this.hasAttribute('hidden'); }
  set hidden(v) { if (v) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
  get disabled() { return this.hasAttribute('disabled'); }
  set disabled(v) { if (v) this.setAttribute('disabled', ''); else this.removeAttribute('disabled'); }
  get title() { return this.getAttribute('title') || ''; }
  set title(v) { this.setAttribute('title', v); }
  get classList() {
    const lista = () => this.className.split(/\s+/).filter(Boolean);
    const cl = {
      contains: c => lista().includes(c),
      add: (...cs) => { this.className = [...new Set([...lista(), ...cs])].join(' '); },
      remove: (...cs) => { this.className = lista().filter(x => !cs.includes(x)).join(' '); },
      toggle: (c, f) => { const poner = f === undefined ? !lista().includes(c) : Boolean(f); if (poner) cl.add(c); else cl.remove(c); return poner; },
    };
    return cl;
  }
  setAttribute(k, v) { this.atributos.set(k, String(v)); }
  getAttribute(k) { return this.atributos.has(k) ? this.atributos.get(k) : null; }
  hasAttribute(k) { return this.atributos.has(k); }
  removeAttribute(k) { this.atributos.delete(k); }
  addEventListener(tipo, fn) { (this.oyentes[tipo] = this.oyentes[tipo] || []).push(fn); }
  click() { for (const fn of this.oyentes.click || []) fn({ target: this, preventDefault() {} }); }
  focus() { this.ownerDocument.activeElement = this; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  set innerHTML(v) { this._html = v; }
  get innerHTML() { return this._html || ''; }
  getBoundingClientRect() { return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0 }; }
  descendientes() { const s = []; const ir = n => { for (const c of n.children) { s.push(c); ir(c); } }; ir(this); return s; }
  querySelectorAll(selector) { return this.descendientes().filter(n => selector.split(',').some(s => encaja(n, s.trim()))); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
// Selectores simples: etiqueta, #id, .clase, [atributo], [atributo="v"] y :not([atributo]).
function encaja(n, sel) {
  let excluido = false;
  let resto = sel.replace(/:not\(\[([\w-]+)\]\)/g, (_, a) => { if (n.hasAttribute(a)) excluido = true; return ''; });
  if (excluido) return false;
  const m = /^([a-z0-9]*)/i.exec(resto);
  if (m[1] && n.tagName !== m[1].toUpperCase()) return false;
  resto = resto.slice(m[1].length);
  for (const [, tipo, valor, attr, v] of resto.matchAll(/([#.])([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/g)) {
    if (tipo === '#' && n.id !== valor) return false;
    if (tipo === '.' && !n.classList.contains(valor)) return false;
    if (attr && (!n.hasAttribute(attr) || (v !== undefined && n.getAttribute(attr) !== v))) return false;
  }
  return true;
}
function crearDocumento() {
  const doc = { oyentes: {}, addEventListener() {} };
  doc.createElement = tag => new FElemento(doc, tag);
  doc.createElementNS = (_, tag) => new FElemento(doc, tag);
  doc.createTextNode = t => new FTexto(doc, t);
  doc.createDocumentFragment = () => { const f = new FElemento(doc, 'fragmento'); f.nodeType = 11; return f; };
  doc.body = doc.createElement('body');
  doc.activeElement = doc.body;
  doc.contains = n => doc.body.contains(n);
  doc.getElementById = id => (doc.body.id === id ? doc.body : doc.body.querySelector(`#${id}`));
  const ids = ['barra', 'lateral', 'lienzo', 'botonera', 'acciones', 'camara', 'chips', 'pildoras', 'feed', 'nuevos', 'asa', 'contador',
    'franja', 'avisos', 'tostadas', 'anuncio', 'p-regimen', 'p-fg', 'p-comite', 'p-nivel', 'p-modo', 'p-llm', 'p-maqueta',
    'v-patrimonio', 'v-resultado', 'v-resultado-pct', 'v-caida', 'v-exposicion', 'v-posiciones'];
  for (const id of ids) { const e = doc.createElement(id === 'lienzo' ? 'canvas' : 'div'); e.setAttribute('id', id); doc.body.appendChild(e); }
  const tarjeta = doc.createElement('section'); tarjeta.setAttribute('id', 'tarjeta'); tarjeta.hidden = true; doc.body.appendChild(tarjeta);
  const modal = doc.createElement('dialog'); modal.setAttribute('id', 'modal'); doc.body.appendChild(modal);
  const cuerpo = doc.createElement('div'); cuerpo.setAttribute('id', 'modal-cuerpo'); modal.appendChild(cuerpo);
  return doc;
}

const { crearMaqueta } = require('../web/js/maqueta.js');
const cifras = require('../web/js/cifras.js');
const T0 = Date.UTC(2026, 8, 30, 0, 45);                // 02:45 en Madrid
const DOC = crearDocumento();
globalThis.document = DOC;
globalThis.window = { matchMedia: () => ({ matches: false }), addEventListener() {} };
let instActual = null;
paneles.iniciar({ instantanea: () => instActual, ahoraServidor: () => T0, comando: async () => ({ ok: true }) });
const $ = id => DOC.getElementById(id);
const nuevaInst = () => JSON.parse(JSON.stringify(crearMaqueta({ semilla: 7, ahora: T0 }).instantanea()));

test('modal Reabrir sin directivas vigentes: ningún «null» suelto entre la explicación y el campo', () => {
  const i = nuevaInst();
  i.fondo.nivel = 'pausado';
  instActual = i;
  paneles.abrirModal('reabrir');
  const cuerpo = $('modal-cuerpo');
  const sueltos = cuerpo.childNodes.filter(n => n.nodeType === 3).map(n => n.textContent);
  assert.deepEqual(sueltos, [], `textos sueltos en #modal-cuerpo: ${JSON.stringify(sueltos)}`);
  assert.doesNotMatch(cuerpo.textContent, /null|undefined/);
  assert.equal(DOC.activeElement.tagName, 'INPUT', 'el foco va al campo REABRIR');
  paneles.cerrarModal();
});

test('Resultados se abre por arriba: foco en el título, no en el «Cerrar» del pie, y scroll a 0', () => {
  instActual = nuevaInst();
  $('modal').scrollTop = 1721;                         // donde lo dejaba el foco en «Cerrar»
  paneles.abrirModal('resultados');
  const foco = DOC.activeElement;
  assert.notEqual(foco.textContent, 'Cerrar', 'el foco no puede ir al botón del pie');
  assert.equal(foco.id, 'modal-titulo');
  assert.equal(foco.getAttribute('tabindex'), '-1');
  assert.equal($('modal').scrollTop, 0);
  // Lo primero después de la cabecera es «¿Aporta algo el comité?», con qué compara.
  const bloques = $('modal-cuerpo').children.filter(n => n.tagName === 'SECTION');
  assert.equal(bloques[0].querySelector('h3').textContent, '¿Aporta algo el comité?');
  assert.equal(bloques[0].querySelector('.que-compara').textContent,
    'Mismas mesas, mismos límites y mismas órdenes tuyas (kill, pausa, Megáfono); solo cambia lo que decide el comité.');
  paneles.cerrarModal();
  // Los modales con campo siguen poniendo el foco en el campo.
  paneles.abrirModal('kill');
  assert.equal(DOC.activeElement.tagName, 'INPUT');
  paneles.cerrarModal();
});

test('píldora y avisos con el tamaño REAL: DEFENSIVO ×0,5 por la reducción del Megáfono = ×0,25', () => {
  const i = nuevaInst();
  const hasta = T0 + 3 * 3600000;                      // 05:45 en Madrid
  i.directivas.modo = 'DEFENSIVO';
  i.cabecera.modoComite = 'DEFENSIVO';
  i.directivas.reduccion = { factor: 0.5, hasta };
  i.fondo.factorTamano = { total: 0.25, comite: 0.5, megafono: 0.5, caida: 1 };
  instActual = i;
  paneles.actualizarBarra(i, { ahoraServidor: T0 });
  const pn = $('p-nivel');
  assert.equal(pn.hidden, false);
  assert.equal(pn.textContent, 'DEFENSIVO + MEGÁFONO ×0,25');
  const aviso = 'Posiciones nuevas a ×0,25 del tamaño normal: modo DEFENSIVO del comité (×0,5) y reducción del Megáfono (×0,5 hasta las 05:45).';
  assert.equal(pn.title, aviso);
  assert.equal($('avisos').children[0].textContent, aviso, 'el recorte va el primero de los avisos');
  // Solo la reducción del Megáfono (comité en NORMAL): también se ve.
  i.directivas.modo = 'NORMAL'; i.cabecera.modoComite = 'NORMAL';
  i.fondo.factorTamano = { total: 0.5, comite: 1, megafono: 0.5, caida: 1 };
  paneles.actualizarBarra(i, { ahoraServidor: T0 });
  assert.equal(pn.hidden, false);
  assert.equal(pn.textContent, 'RIESGO ×0,5 hasta 05:45 · Megáfono');
  assert.equal($('avisos').children[0].textContent, 'Posiciones nuevas a ×0,5 del tamaño normal: reducción del Megáfono (×0,5 hasta las 05:45).');
  // Con el fondo en pausa manda la pausa: el tamaño no importa (no se abre nada).
  i.fondo.nivel = 'pausado';
  paneles.actualizarBarra(i, { ahoraServidor: T0 });
  assert.equal(pn.textContent, 'PAUSADO');
  assert.ok(!$('avisos').children.some(a => /Posiciones nuevas/.test(a.textContent)));
  // Sin recortes, ni píldora ni aviso.
  i.fondo.nivel = 'normal';
  i.fondo.factorTamano = { total: 1, comite: 1, megafono: 1, caida: 1 };
  paneles.actualizarBarra(i, { ahoraServidor: T0 });
  assert.equal(pn.hidden, true);
});

test('ficha del puesto: la última señal con palabras, no con el id («nada»)', () => {
  const i = nuevaInst();
  const p = i.puestos.find(x => !x.posicion);
  p.ultimaSenal = { accion: 'nada', t: Date.UTC(2026, 8, 30, 0, 0) };
  instActual = i;
  paneles.mostrarTarjeta({ tipo: 'puesto', id: p.id }, i);
  const dts = $('tarjeta').querySelectorAll('dt');
  const dt = dts.find(d => d.textContent === 'Última señal');
  const dd = dt.parentNode.children[dt.parentNode.children.indexOf(dt) + 1];
  assert.equal(dd.textContent, 'Esperar · 02:00');
  paneles.ocultarTarjeta();
  assert.equal(cifras.accionSenal('abrir'), 'Comprar');
  assert.equal(cifras.accionSenal('cerrar'), 'Vender');
  assert.equal(cifras.accionSenal('mantener'), 'Mantener');
});

test('píldora del «solo cerrar» y del RIESGO del Megáfono de más de un día: con fecha, no solo la hora', () => {
  const i = nuevaInst();
  const hasta = T0 + 72 * 3600000;                     // 3 oct 02:45 en Madrid
  i.directivas.soloCerrarHasta = hasta;
  instActual = i;
  paneles.actualizarBarra(i, { ahoraServidor: T0 });
  assert.equal($('p-nivel').textContent, `SOLO CERRAR hasta ${cifras.momento(hasta, T0)} · Megáfono`);
  assert.match($('p-nivel').textContent, /hasta 3 oct 02:45/);
  i.directivas.soloCerrarHasta = null;
  i.directivas.reduccion = { factor: 0.5, hasta };
  i.fondo.factorTamano = { total: 0.5, comite: 1, megafono: 0.5, caida: 1 };
  paneles.actualizarBarra(i, { ahoraServidor: T0 });
  assert.equal($('p-nivel').textContent, 'RIESGO ×0,5 hasta 3 oct 02:45 · Megáfono');
  assert.equal($('avisos').children[0].textContent, 'Posiciones nuevas a ×0,5 del tamaño normal: reducción del Megáfono (×0,5 hasta el 3 oct 02:45).');
});

test('franja de conexión: «reintentando en N s» cuenta hacia atrás, y el lector de pantalla no la relee cada segundo', () => {
  const t0 = 5_000_000;
  const f = $('franja');
  paneles.conexion(false, 16000, null, t0);
  assert.equal(f.hidden, false);
  assert.equal(f.textContent, 'Sin conexión con la mesa, reintentando en 16 s…');
  paneles.refrescarFranja(t0 + 5000);
  assert.equal(f.textContent, 'Sin conexión con la mesa, reintentando en 11 s…');
  paneles.refrescarFranja(t0 + 15500);
  assert.equal(f.textContent, 'Sin conexión con la mesa, reintentando en 1 s…');
  paneles.refrescarFranja(t0 + 16000);
  assert.equal(f.textContent, 'Sin conexión con la mesa, reintentando…');
  // El número va aparte y oculto al lector (la franja es role=status): lo que
  // se anuncia no cambia con cada segundo.
  const cuenta = f.querySelector('.cuenta');
  assert.equal(cuenta.getAttribute('aria-hidden'), 'true');
  assert.equal(f.childNodes.filter(n => n !== cuenta).map(n => n.textContent).join(''), 'Sin conexión con la mesa, reintentando…');
  // Con motivo, igual: «… Reintentando en 8 s…» → «… Reintentando en 3 s…».
  paneles.conexion(false, 8000, 'lleno', t0);
  paneles.refrescarFranja(t0 + 5000);
  assert.equal(f.textContent, 'Hay demasiados paneles abiertos contra la mesa: cierra alguna pestaña. Reintentando en 3 s…');
  paneles.conexion(true);
  assert.equal(f.hidden, true);
});

test('ficha abierta con un toque en el lienzo (el foco estaba en <body>): al cerrarla, el foco vuelve al lienzo, no a <body>', () => {
  const i = nuevaInst();
  instActual = i;
  const movil = globalThis.window.matchMedia;
  globalThis.window.matchMedia = () => ({ matches: true });          // < 768 px
  try {
    DOC.activeElement = DOC.body;                    // el toque no enfoca el lienzo (preventDefault)
    paneles.mostrarTarjeta({ tipo: 'puesto', id: i.puestos[0].id }, i, { origen: $('lienzo') });
    assert.ok($('tarjeta').contains(DOC.activeElement), 'en el móvil el foco entra en la ficha');
    $('tarjeta').querySelector('.cerrar').click();
    assert.equal(DOC.activeElement, $('lienzo'));
    // Sin decir quién la abrió y con el foco en <body>, también al lienzo.
    DOC.activeElement = DOC.body;
    paneles.mostrarTarjeta({ tipo: 'puesto', id: i.puestos[1].id }, i);
    paneles.ocultarTarjeta();
    assert.equal(DOC.activeElement, $('lienzo'));
    // Abierta desde un botón con foco (teclado), vuelve a ese botón.
    const boton = DOC.createElement('button');
    DOC.body.appendChild(boton);
    boton.focus();
    paneles.mostrarTarjeta({ tipo: 'puesto', id: i.puestos[0].id }, i);
    paneles.ocultarTarjeta();
    assert.equal(DOC.activeElement, boton);
    boton.remove();
  } finally {
    globalThis.window.matchMedia = movil;
  }
});

test('barra: si la fila de píldoras no cabe (DEFENSIVO + MEGÁFONO ×0,25 a 1440 px), se compacta antes de cortar la última', () => {
  const i = nuevaInst();
  i.cabecera.miedoCodicia = { valor: 36, etiqueta: 'Miedo', sintetico: true };
  instActual = i;
  const pild = $('pildoras');
  // Cabe: nada cambia.
  pild.scrollWidth = 700; pild.clientWidth = 749;
  paneles.actualizarBarra(i, { ahoraServidor: T0 });
  assert.equal(pild.classList.contains('compacta'), false);
  const pf = $('p-fg');
  assert.equal(pf.textContent, 'F&G 36 · Miedo');
  // La palabra del F&G va aparte (lo que se esconde al compactar) y el título la dice siempre.
  assert.equal(pf.querySelector('.largo').textContent, ' · Miedo');
  assert.match(pf.title, /36 · Miedo/);
  // No cabe (772 px en 749, la medida de Chromium): se compacta.
  pild.scrollWidth = 772;
  paneles.marcarDesborde();
  assert.equal(pild.classList.contains('compacta'), true);
});
