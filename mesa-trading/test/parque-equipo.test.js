'use strict';
// Parqué · feed con caras y conversaciones, ficha del agente y pestaña Equipo
// (web/js/paneles.js) sobre un DOM falso (test/parque-dom-ayuda.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDocumento } = require('./parque-dom-ayuda.js');
const registro = require('../src/agentes/registro.js');

const DOC = crearDocumento({ conPestanas: true });
globalThis.document = DOC;
let movil = false;
globalThis.window = { matchMedia: () => ({ matches: movil }), addEventListener() {} };
const paneles = require('../web/js/paneles.js');
const $ = id => DOC.getElementById(id);

const MESAS = [
  { id: 'tendencia', nombre: 'Tendencia SMA', familia: 'tendencia-sma', estado: 'incubacion', peso: 0.02, universo: ['BTC', 'ETH'] },
  { id: 'momentum', nombre: 'Momentum cripto', familia: 'momentum-rotacion', estado: 'titular', peso: 0.4, universo: ['BTC'] },
];
const AGENTES = registro.crearPlantilla({
  universo: ['BTC/USD', 'ETH/USD'],
  mesas: MESAS.map(m => ({ ...m, universo: m.universo.map(e => `${e}/USD`) })),
}).map(a => ({ ...a, estado: 'trabajando', bocadillo: null }));
const T0 = Date.UTC(2026, 8, 30, 10, 0);
const operador = AGENTES.find(a => a.puestoId === 'tendencia-BTC');
const INST = {
  ahora: T0,
  departamentos: registro.DEPARTAMENTOS.map(d => ({ ...d })),
  agentes: AGENTES,
  mesas: MESAS,
  puestos: [
    { id: 'tendencia-BTC', mesaId: 'tendencia', simbolo: 'BTC/USD', etiqueta: 'BTC', agenteId: operador.id,
      posicion: { cantidad: 0.0125, nocional: 1250, entrada: 100000, stop: 96000, objetivo: null, pnlAbierto: 12.5, pnlAbiertoPct: 0.01, abiertaT: T0 - 3600000 },
      pnlDia: 12.5, operaciones: 3, acierto: 0.67, factorBeneficio: 1.4, adherencia: 1, estadoTexto: 'Comprado 0,0125 BTC a 100.000.', ultimaSenal: null, chispa: [] },
  ],
  llm: { activo: false },
  cabecera: {},
  mensajes: [],
};
let seleccionado = null;
paneles.iniciar({
  departamentos: INST.departamentos,
  instantanea: () => INST,
  ahoraServidor: () => T0,
  alSeleccionar: (sel) => { seleccionado = sel; paneles.mostrarTarjeta(sel, INST); },
  alCerrarTarjeta: () => {},
});

let n = 0;
const msg = (de, extra) => {
  const a = AGENTES.find(x => x.id === de);
  n++;
  return { id: `m${n}`, t: T0 + n * 1000, de, deNombre: a ? a.nombre : (de === 'humano' ? 'humano' : 'Sistema'), departamento: a ? a.departamento : null,
    para: 'todos', respondeA: null, hilo: null, canal: 'riesgo', tipo: 'nota', texto: `texto ${n}`, datos: null, importancia: 1, ...extra };
};
// Ojo: el DOM falso no entiende selectores con descendientes («.a b»): se encadena querySelector.
const hijosFeed = () => $('feed').children.filter(c => c.classList.contains('msg'));

test('feed: cada mensaje con su cara (la de su muñeco), su nombre, la etiqueta del departamento con su color y su rol', () => {
  const m = msg('riesgos', { texto: 'Recorto la compra de BTC.' });
  paneles.anadirMensajes([m]);
  const nodo = hijosFeed().pop();
  const boton = nodo.querySelector('.cara-boton');
  assert.ok(boton, 'la cara es un botón que abre la ficha');
  assert.equal(boton.getAttribute('aria-label'), 'Ficha de Marta Solís');
  const cara = boton.querySelector('.cara');
  assert.ok(cara.classList.contains('cara-40'));
  assert.match(cara.innerHTML, /^<svg /);
  assert.ok(cara.innerHTML.includes('fill="#ef4444"'), 'camisa roja de Riesgos');
  const etq = nodo.querySelector('.dep-etq');
  assert.equal(etq.textContent, 'Riesgos');
  assert.equal(etq.style.getPropertyValue('--dep'), '#ef4444', 'el color va en una variable CSS (la CSP no deja style=)');
  assert.equal(nodo.querySelector('.rol-texto').textContent, 'Jefa de riesgos');
  assert.equal(nodo.querySelector('p').textContent, 'Recorto la compra de BTC.');
  // Al pulsar la cara, la ficha de ese agente.
  boton.click();
  assert.deepEqual(seleccionado, { tipo: 'agente', id: 'riesgos' });
  paneles.ocultarTarjeta();
});

test('feed: el humano (Megáfono) con su propio icono; el sistema con el suyo; ni uno ni otro tienen ficha', () => {
  paneles.anadirMensajes([msg('humano', { canal: 'megafono', tipo: 'megafono', texto: '«baja el riesgo»' })]);
  let nodo = hijosFeed().pop();
  assert.equal(nodo.querySelector('b').textContent, 'Megáfono');
  assert.equal(nodo.querySelector('.dep-etq').textContent, 'Humano');
  assert.equal(nodo.querySelector('.cara-boton'), null);
  assert.ok(nodo.querySelector('.cara').innerHTML.includes('M4 10v4h3l7 4V6L7 10H4z'), 'el megáfono');
  paneles.anadirMensajes([msg('sistema', { canal: 'sistema', tipo: 'sistema', texto: 'Arranque.' })]);
  nodo = hijosFeed().pop();
  assert.equal(nodo.querySelector('b').textContent, 'Sistema');
  assert.equal(nodo.querySelector('.dep-etq'), null);
  assert.ok(nodo.querySelector('.cara').innerHTML.includes('fill="#94a3b8"'), 'el cubo gris');
});

test('conversación: la respuesta va sangrada bajo su mensaje (más pequeña) y con «→ Marta» si va para alguien', () => {
  const raiz = msg('cio', { canal: 'comite', tipo: 'comite', texto: '¿Cómo vemos el riesgo?', hilo: null });
  raiz.hilo = raiz.id;
  paneles.anadirMensajes([raiz]);
  const r1 = msg('riesgos', { respondeA: raiz.id, hilo: raiz.id, texto: 'Pido DEFENSIVO.', para: 'cio' });
  paneles.anadirMensajes([r1]);
  const bloque = hijosFeed().pop();
  assert.equal(bloque.getAttribute('data-id'), raiz.id);
  assert.ok(bloque.classList.contains('conversacion'));
  const resp = bloque.querySelector('.respuestas');
  assert.ok(resp, 'las respuestas van dentro del mensaje');
  const hija = resp.children[0];
  assert.ok(hija.classList.contains('respuesta'));
  assert.ok(hija.querySelector('.cara').classList.contains('cara-24'), 'la respuesta, con la cara pequeña');
  assert.equal(hija.querySelector('.para').textContent, '→ Carmen');
  assert.equal(hija.querySelector('p').textContent, 'Pido DEFENSIVO.');
});

test('conversación: una respuesta a un mensaje de más arriba sube la conversación entera abajo del todo', () => {
  const raiz = hijosFeed().pop();
  const raizId = raiz.getAttribute('data-id');
  paneles.anadirMensajes([msg('macro', { texto: 'Régimen NEUTRAL.' })]);
  assert.notEqual(hijosFeed().pop().getAttribute('data-id'), raizId);
  const r2 = msg('macro', { respondeA: raizId, hilo: raizId, texto: 'Yo también DEFENSIVO.' });
  paneles.anadirMensajes([r2]);
  const ultimo = hijosFeed().pop();
  assert.equal(ultimo.getAttribute('data-id'), raizId, 'la conversación vuelve abajo');
  assert.deepEqual(ultimo.querySelector('.respuestas').children.map(c => c.querySelector('p').textContent), ['Pido DEFENSIVO.', 'Yo también DEFENSIVO.']);
  // Nada repetido en el feed.
  const ids = $('feed').querySelectorAll('.msg').map(x => x.getAttribute('data-id'));
  assert.equal(new Set(ids).size, ids.length);
});

test('ficha del agente: cara grande, nombre, departamento, rol, qué hace en llano y el detalle técnico desplegable que sobrevive al refresco', () => {
  paneles.mostrarTarjeta({ tipo: 'agente', id: 'riesgos' }, INST);
  const t = $('tarjeta');
  assert.equal(t.hidden, false);
  assert.ok(t.classList.contains('ficha-agente'));
  assert.ok(t.querySelector('.cara-96'));
  assert.equal(t.querySelector('#tarjeta-titulo').textContent, 'Marta Solís');
  assert.equal(t.querySelector('.dep-etq').textContent, 'Riesgos');
  assert.equal(t.querySelector('.tarjeta-sub').textContent, 'Jefa de riesgos');
  const marta = AGENTES.find(a => a.id === 'riesgos');
  assert.equal(t.querySelector('.que-hace').querySelector('p').textContent, marta.queHace);
  const det = t.querySelector('details');
  assert.equal(det.querySelector('summary').textContent, 'Detalle técnico');
  assert.equal(det.querySelector('.que-decide').querySelector('p').textContent, marta.queDecide, 'lo técnico, dentro del desplegable');
  assert.equal(det.open, false);
  // Sus últimos mensajes, del más nuevo al más viejo.
  const ultimos = t.querySelector('.ultimos').children.map(li => li.textContent);
  assert.ok(ultimos.length >= 2);
  assert.match(ultimos[0], /Pido DEFENSIVO\./);
  assert.match(ultimos[1], /Recorto la compra de BTC\./);
  // Se despliega, llega otro dato y la ficha se rehace: sigue desplegado.
  det.open = true;
  det.disparar('toggle');
  paneles.refrescarTarjeta(INST);
  assert.equal($('tarjeta').querySelector('details').open, true);
  paneles.ocultarTarjeta();
});

test('ficha de un operador: su mesa y su posición, con enlaces a su puesto y a la mesa; el puesto lleva a la ficha', () => {
  paneles.mostrarTarjeta({ tipo: 'agente', id: operador.id }, INST);
  const t = $('tarjeta');
  const bloque = t.querySelector('.bloque-mesa');
  assert.ok(bloque);
  assert.match(bloque.textContent, /Tendencia SMA · Incubación · peso 2 %/);
  const dd = bloque.querySelectorAll('dt').map(x => x.textContent);
  assert.deepEqual(dd, ['Posición', 'Nocional', 'Entrada', 'Stop', 'Abierto']);
  assert.match(bloque.textContent, /Comprado 0,0125 BTC/);
  assert.deepEqual(bloque.querySelectorAll('button').map(b => b.textContent), ['Ver su puesto', 'Ver la mesa']);
  // Desde el puesto, la persona con su cara lleva a su ficha.
  paneles.mostrarTarjeta({ tipo: 'puesto', id: 'tendencia-BTC' }, INST);
  const persona = $('tarjeta').querySelector('.tarjeta-persona');
  assert.ok(persona.querySelector('.cara-40'));
  persona.click();
  assert.deepEqual(seleccionado, { tipo: 'agente', id: operador.id });
  paneles.ocultarTarjeta();
});

test('pestaña Equipo: por departamento, con color, frase, cara, nombre, rol y qué hace; en Mesas, por mesa', () => {
  paneles.elegirPestana('equipo');
  assert.equal(paneles.pestana, 'equipo');
  assert.equal($('vista-equipo').hidden, false);
  assert.equal($('vista-mensajes').hidden, true);
  assert.equal($('pestana-equipo').getAttribute('aria-selected'), 'true');
  assert.equal($('pestana-mensajes').getAttribute('tabindex'), '-1');
  const secciones = $('equipo').querySelectorAll('.equipo-dep');
  assert.deepEqual(secciones.map(s => s.querySelector('h3').childNodes[1].textContent),
    ['Dirección', 'Macro', 'Análisis', 'Mesas', 'Riesgos', 'Operaciones', 'Laboratorio']);
  const riesgos = secciones.find(s => /Riesgos/.test(s.querySelector('h3').textContent));
  assert.equal(riesgos.style.getPropertyValue('--dep'), '#ef4444');
  assert.match(riesgos.querySelector('.equipo-dep-cab').querySelector('p').textContent, /límites de seguridad/);
  const fila = riesgos.querySelector('.equipo-persona');
  assert.equal(fila.getAttribute('data-agente'), 'riesgos');
  assert.ok(fila.querySelector('.cara-40'));
  assert.equal(fila.querySelector('.equipo-nombre').querySelector('b').textContent, 'Marta Solís');
  assert.equal(fila.querySelector('.equipo-rol').textContent, 'Jefa de riesgos');
  assert.equal(fila.querySelector('.equipo-hace').textContent, AGENTES.find(a => a.id === 'riesgos').queHace);
  fila.click();
  assert.deepEqual(seleccionado, { tipo: 'agente', id: 'riesgos' });
  paneles.ocultarTarjeta();
  // Mesas: un rótulo por mesa, y cada operador bajo el suyo.
  const mesas = secciones.find(s => /Mesas/.test(s.querySelector('h3').textContent));
  assert.deepEqual(mesas.querySelectorAll('.equipo-mesa').map(x => x.textContent), ['Tendencia SMA · Incubación', 'Momentum cripto · Titular']);
  assert.equal($('contador-equipo').textContent, String(AGENTES.length));
});

test('Equipo: el buscador filtra por nombre sin tildes; Escape lo borra; sin nadie, lo dice', () => {
  const input = $('buscar-equipo');
  input.value = 'solis';
  input.disparar('input');
  let nombres = $('equipo').querySelectorAll('.equipo-nombre').map(x => x.querySelector('b').textContent);
  assert.deepEqual(nombres, ['Marta Solís']);
  assert.match($('equipo').querySelector('.cuantos').textContent, /^1 de 1$|^1$/);
  input.value = 'nadie-asi';
  input.disparar('input');
  assert.equal($('equipo').textContent, 'Nadie del equipo se llama «nadie-asi».');
  // Escape borra lo escrito y no llega a cerrar la ficha.
  const siguio = input.disparar('keydown', { key: 'Escape' });
  assert.equal(siguio, false, 'Escape se queda en el buscador');
  assert.equal(input.value, '');
  nombres = $('equipo').querySelectorAll('.equipo-nombre').map(x => x.querySelector('b').textContent);
  assert.equal(nombres.length, AGENTES.length);
});

test('Equipo: se rehace solo si cambia alguien (y se ve); el estado de cada uno sale en su fila', () => {
  const antes = $('equipo').querySelector('.equipo-persona');
  paneles.actualizarEquipo(INST);
  assert.equal($('equipo').querySelector('.equipo-persona'), antes, 'sin cambios, no se toca el DOM');
  const cio = AGENTES.find(a => a.id === 'cio');
  cio.estado = 'reunion';
  paneles.actualizarEquipo(INST);
  const fila = $('equipo').querySelector('[data-agente="cio"]');
  assert.equal(fila.querySelector('.estado-agente').textContent, 'En comité');
  cio.estado = 'trabajando';
  // Teclado: flecha a la izquierda desde Equipo vuelve a Mensajes (tabindex itinerante).
  const tab = $('pestana-equipo');
  tab.disparar('keydown', { key: 'ArrowLeft' });
  assert.equal(paneles.pestana, 'mensajes');
  assert.equal(DOC.activeElement, $('pestana-mensajes'));
  assert.equal($('vista-mensajes').hidden, false);
  // En el móvil, elegir una pestaña abre la hoja inferior.
  movil = true;
  $('pestana-equipo').click();
  assert.ok($('lateral').classList.contains('abierta'));
  assert.equal($('asa').getAttribute('aria-expanded'), 'true');
  movil = false;
});

test('al cerrar la ficha, el foco vuelve a la fila del equipo aunque el equipo se haya rehecho con la ficha abierta', () => {
  paneles.elegirPestana('equipo');
  const fila = $('equipo').querySelector('[data-agente="macro"]');
  fila.focus();
  fila.click();
  assert.equal($('tarjeta').hidden, false);
  // Llega un dato que cambia el equipo: las filas son nodos nuevos.
  AGENTES.find(a => a.id === 'macro').estado = 'descanso';
  paneles.actualizarEquipo(INST);
  const nueva = $('equipo').querySelector('[data-agente="macro"]');
  assert.notEqual(nueva, fila);
  paneles.ocultarTarjeta();
  assert.equal(DOC.activeElement, nueva);
  AGENTES.find(a => a.id === 'macro').estado = 'trabajando';
});
