'use strict';
// DOM falso, lo justo para probar los paneles del parqué (web/js/paneles.js)
// en Node sin navegador. Es el de test/parque-paneles.test.js con lo que
// necesitan el feed con caras, la ficha del agente y la pestaña Equipo:
// pestañas con role=tab, <details>, un buscador y disparar eventos.
// Como el DOM de verdad, Element.append(null) escribe el texto «null».

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
    const props = new Map();
    this.style = { cssText: '', setProperty: (k, v) => props.set(k, v), getPropertyValue: k => props.get(k) || '' };
    this.dataset = {}; this.oyentes = {}; this.scrollTop = 0; this.open = false;
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
  // Dispara un evento con los oyentes propios (sin propagar).
  disparar(tipo, extra) {
    let parado = false;
    const ev = { type: tipo, target: this, preventDefault() {}, stopPropagation() { parado = true; }, ...extra };
    for (const fn of this.oyentes[tipo] || []) fn(ev);
    return !parado;
  }
  click() { this.disparar('click'); }
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

// Selectores simples: etiqueta, #id, .clase, [atributo], [atributo="v"],
// [atributo^="v"] y :not([atributo]). Sin combinadores.
function encaja(n, sel) {
  let excluido = false;
  let resto = sel.replace(/:not\(\[([\w-]+)\]\)/g, (_, a) => { if (n.hasAttribute(a)) excluido = true; return ''; });
  if (excluido) return false;
  const m = /^([a-z0-9]*)/i.exec(resto);
  if (m[1] && n.tagName !== m[1].toUpperCase()) return false;
  resto = resto.slice(m[1].length);
  for (const [, tipo, valor, attr, op, v] of resto.matchAll(/([#.])([\w-]+)|\[([\w-]+)(?:(\^?=)"([^"]*)")?\]/g)) {
    if (tipo === '#' && n.id !== valor) return false;
    if (tipo === '.' && !n.classList.contains(valor)) return false;
    if (attr) {
      if (!n.hasAttribute(attr)) return false;
      if (op === '=' && n.getAttribute(attr) !== v) return false;
      if (op === '^=' && !n.getAttribute(attr).startsWith(v)) return false;
    }
  }
  return true;
}

// Documento con los ids que usa paneles.js. `conPestanas`: además, las
// pestañas del panel lateral (Mensajes y Equipo) y el buscador del equipo,
// como en web/index.html.
function crearDocumento({ conPestanas = false } = {}) {
  const doc = { oyentes: {}, addEventListener(tipo, fn) { (doc.oyentes[tipo] = doc.oyentes[tipo] || []).push(fn); } };
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
  if (conPestanas) {
    const lista = doc.createElement('div');
    lista.setAttribute('id', 'pestanas-lateral');
    lista.setAttribute('role', 'tablist');
    for (const [id, activa] of [['mensajes', true], ['equipo', false]]) {
      const b = doc.createElement('button');
      b.setAttribute('id', `pestana-${id}`);
      b.setAttribute('role', 'tab');
      b.setAttribute('data-pestana', id);
      b.setAttribute('aria-controls', `vista-${id}`);
      b.setAttribute('aria-selected', String(activa));
      lista.appendChild(b);
      const vista = doc.createElement('div');
      vista.setAttribute('id', `vista-${id}`);
      vista.setAttribute('role', 'tabpanel');
      vista.hidden = !activa;
      doc.body.appendChild(vista);
    }
    doc.body.appendChild(lista);
    const cuenta = doc.createElement('span'); cuenta.setAttribute('id', 'contador-equipo'); doc.body.appendChild(cuenta);
    const vistaEquipo = doc.getElementById('vista-equipo');
    const input = doc.createElement('input'); input.setAttribute('id', 'buscar-equipo'); input.value = ''; vistaEquipo.appendChild(input);
    const equipo = doc.createElement('div'); equipo.setAttribute('id', 'equipo'); vistaEquipo.appendChild(equipo);
  }
  const tarjeta = doc.createElement('section'); tarjeta.setAttribute('id', 'tarjeta'); tarjeta.hidden = true; doc.body.appendChild(tarjeta);
  const modal = doc.createElement('dialog'); modal.setAttribute('id', 'modal'); doc.body.appendChild(modal);
  const cuerpo = doc.createElement('div'); cuerpo.setAttribute('id', 'modal-cuerpo'); modal.appendChild(cuerpo);
  return doc;
}

module.exports = { crearDocumento, FElemento, encaja };
