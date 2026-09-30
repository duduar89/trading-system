'use strict';
// Parqué · franja del capital (debajo de la barra, §7 cabecera.capital): las
// tres cifras, el reparto por tipo de activo y la línea que explica cada cifra
// al tocarla, con las cifras de la instantánea (ninguna inventada). Y la
// maqueta con el mismo campo, cuadrado.
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDocumento } = require('./parque-dom-ayuda.js');

const DOC = crearDocumento({ conCapital: true });
globalThis.document = DOC;
globalThis.window = { matchMedia: () => ({ matches: false }), addEventListener() {} };
const paneles = require('../web/js/paneles.js');
const cifras = require('../web/js/cifras.js');
const { crearMaqueta } = require('../web/js/maqueta.js');
const $ = id => DOC.getElementById(id);

const T0 = Date.UTC(2026, 8, 30, 10, 0);
const CAPITAL = {
  patrimonio: 101000, invertido: 26000, invertidoPct: 26000 / 101000, efectivo: 75000,
  disponible: 54800, disponibleCripto: 32500,
  porTipo: [
    { tipo: 'cripto', nombre: 'Cripto', importe: 18000, pct: 18000 / 101000,
      activos: [{ simbolo: 'BTC/USD', etiqueta: 'BTC', importe: 12000 }, { simbolo: 'ETH/USD', etiqueta: 'ETH', importe: 6000 }], mesas: ['momentum', 'tendencia'] },
    { tipo: 'indices', nombre: 'Índices', importe: 8000, pct: 8000 / 101000, activos: [{ simbolo: 'SPY', etiqueta: 'SPY', importe: 8000 }], mesas: ['momentum-etf'] },
    { tipo: 'materias', nombre: 'Materias primas', importe: 0, pct: 0, activos: [], mesas: ['momentum-etf'] },
  ],
  limites: {
    bruta: { maximo: 0.8, tope: 80800, usado: 26000, queda: 54800 },
    cripto: { maximo: 0.5, tope: 50500, usado: 18000, queda: 32500 },
  },
};
const INST = {
  ahora: T0, modo: 'alpaca', velocidad: 1,
  fondo: { nivel: 'normal', motivo: null, multiplicadorCaida: 1, factorTamano: { total: 1, comite: 1, megafono: 1, caida: 1 } },
  directivas: { modo: 'NORMAL', multiplicadores: {}, activosVetados: [], mesasPausadas: [], soloCerrarHasta: null, reduccion: null },
  mesas: [{ id: 'momentum', nombre: 'Momentum cripto' }, { id: 'tendencia', nombre: 'Tendencia SMA' }, { id: 'momentum-etf', nombre: 'Momentum ETF' }],
  agentes: [], llm: { activo: false }, mensajes: [],
  cabecera: { patrimonio: 101000, pnlDia: 0, pnlDiaPct: 0, caida: 0, exposicionBrutaPct: 0.26, exposicionCriptoPct: 0.18, posiciones: 3, capital: CAPITAL },
};
paneles.iniciar({ departamentos: [], instantanea: () => INST, ahoraServidor: () => T0 });

// Todas las cifras de un texto tienen que estar entre las de la instantánea
// (tal y como las escribe la pantalla).
function cifrasDe(texto) { return (texto.match(/\d[\d.]*(?:,\d+)?\s?[$%]/g) || []).map(x => x.replace(/\s/, ' ')); }
function permitidas(cap) {
  const s = new Set();
  const u = x => s.add(cifras.usd(x));
  for (const k of ['patrimonio', 'invertido', 'efectivo', 'disponible', 'disponibleCripto']) u(cap[k]);
  for (const t of Object.values(cap.limites)) { u(t.tope); u(t.usado); u(t.queda); s.add(cifras.pct(t.maximo, { decimales: 0 })); }
  s.add(cifras.pct(cap.invertidoPct, { decimales: 1 }));
  for (const t of cap.porTipo) { u(t.importe); s.add(cifras.pct(t.pct, { decimales: 1 })); for (const a of t.activos) u(a.importe); }
  return s;
}

test('explicaciones: cada cifra dice de dónde sale, con las cifras de la instantánea y ninguna más', () => {
  const ok = permitidas(CAPITAL);
  const textos = ['patrimonio', 'invertido', 'efectivo', 'disponible', 'tipo:cripto', 'tipo:indices', 'tipo:materias'].map(k => [k, cifras.explicarCapital(k, INST)]);
  for (const [k, t] of textos) {
    assert.ok(t && t.length > 20, `${k}: ${t}`);
    for (const c of cifrasDe(t)) assert.ok(ok.has(c), `${k}: «${c}» no sale de la instantánea (${t})`);
  }
  const de = Object.fromEntries(textos);
  assert.match(de.patrimonio, /75\.000 \$ en efectivo más 26\.000 \$ invertidos, 101\.000 \$ en total/);
  assert.match(de.disponible, /^Margen que dejan los límites de seguridad: como mucho el 80 % del patrimonio invertido \(80\.800 \$\); ya hay 26\.000 \$, quedan 54\.800 \$\. En cripto, como mucho el 50 % \(50\.500 \$\): hay 18\.000 \$, así que en cripto caben 32\.500 \$\./);
  assert.match(de['tipo:cripto'], /^Cripto: BTC 12\.000 \$, ETH 6\.000 \$ .*Lo operan Momentum cripto y Tendencia SMA\.$/);
  assert.equal(de['tipo:materias'], 'Materias primas: nada invertido ahora. Lo opera Momentum ETF.');
  assert.equal(cifras.explicarCapital('tipo:bonos', INST), null, 'un tipo que no está no se inventa');
  assert.equal(cifras.explicarCapital('invertido', { cabecera: {} }), null, 'sin capital (servidor anterior), nada');
});

test('explicación de lo disponible: si manda el efectivo lo dice, y con el fondo parado avisa de que no compra', () => {
  const poco = { ...INST, cabecera: { ...INST.cabecera, capital: { ...CAPITAL, efectivo: 20000, disponible: 20000, disponibleCripto: 20000 } } };
  assert.match(cifras.explicarCapital('disponible', poco), /quedan 54\.800 \$, pero solo hay 20\.000 \$ en efectivo\./);
  const pausado = { ...INST, fondo: { ...INST.fondo, nivel: 'pausado', motivo: 'Pausado a mano: solo se cierran posiciones hasta Reabrir.' } };
  assert.match(cifras.explicarCapital('disponible', pausado), /Ahora el fondo no compra nada: Pausado a mano/);
});

test('franja: cifras, un tramo y un botón por tipo con su nombre, importe y %; tocar explica y tocar otra vez lo quita', () => {
  paneles.actualizarBarra(INST, { ahoraServidor: T0 });
  assert.equal($('capital').hidden, false);
  assert.equal($('v-invertido-pct').textContent, '(26 %)');
  const segs = $('reparto-barra').children;
  assert.deepEqual(segs.map(x => x.getAttribute('data-tipo')), ['cripto', 'indices', 'materias', 'efectivo'], 'en el orden del servidor, el efectivo al final');
  assert.equal(segs[0].style.getPropertyValue('--c'), cifras.colorTipo('cripto'));
  assert.equal(segs[0].style.getPropertyValue('--w'), `${(18000 / 101000 * 100).toFixed(3)}%`);
  assert.equal(segs[3].style.getPropertyValue('--w'), `${(75000 / 101000 * 100).toFixed(3)}%`);
  const botones = $('reparto-tipos').querySelectorAll('button');
  assert.deepEqual(botones.map(b => b.querySelector('.reparto-nombre').textContent), ['Cripto', 'Índices', 'Materias primas']);
  assert.equal(botones[0].querySelector('.reparto-importe').textContent, '18.000 $');
  assert.equal(botones[0].querySelector('.reparto-pct').textContent, '18 %');
  assert.ok(botones[2].classList.contains('cero'), 'un tipo sin nada invertido se ve apagado');
  assert.ok($('reparto-tipos').querySelector('.leyenda-efectivo'), 'la leyenda nombra el efectivo (el color nunca va solo)');

  // Tocar una cifra: la línea; la misma otra vez: se quita.
  const clic = n => $('capital').disparar('click', { target: n });
  clic(botones[1].querySelector('.reparto-nombre'));
  assert.equal($('capital-explica').hidden, false);
  assert.match($('capital-explica').textContent, /^Índices: SPY 8\.000\u00a0\$/, 'cifra y unidad sin partir');
  assert.equal(botones[1].getAttribute('aria-expanded'), 'true');
  assert.equal(botones[0].getAttribute('aria-expanded'), 'false');
  clic($('c-disponible'));
  assert.match($('capital-explica').textContent, /^Margen que dejan los límites de seguridad/);
  assert.equal($('c-disponible').getAttribute('aria-expanded'), 'true');
  assert.equal(botones[1].getAttribute('aria-expanded'), 'false');
  clic($('c-disponible'));
  assert.equal($('capital-explica').hidden, true);
  assert.equal($('c-disponible').getAttribute('aria-expanded'), 'false');
});

test('margen de los límites (revisión del 30-sep-2026): no se lee como lo que el fondo va a comprar, y con el fondo parado dice «no compra»', () => {
  // Caso de la revisión: 54 % sin asignar y las mesas con su parte.
  const mesas = [
    { id: 'momentum', nombre: 'Momentum cripto', estado: 'titular', peso: 0.4, capital: 39983 },
    { id: 'tendencia', nombre: 'Tendencia SMA', estado: 'incubacion', peso: 0.02, capital: 1999 },
    { id: 'viejo', nombre: 'Del banquillo', estado: 'banquillo', peso: 0, capital: 0 },
  ];
  const con = { ...INST, mesas, cabecera: { ...INST.cabecera, sinAsignar: { fraccion: 0.54, usd: 53977 } } };
  const t = cifras.explicarCapital('disponible', con);
  assert.match(t, /No es lo que el fondo va a comprar: las mesas tienen 41\.982 \$ para invertir y el resto, el 54 % \(53\.977 \$\), se queda en efectivo por el reparto\./);
  // Todas sus cifras salen de la instantánea (Σ capital de las mesas y sinAsignar).
  const ok = permitidas(CAPITAL);
  ok.add(cifras.usd(41982)); ok.add(cifras.usd(53977)); ok.add(cifras.pct(0.54, { decimales: 0 }));
  for (const c of cifrasDe(t)) assert.ok(ok.has(c), `«${c}» no sale de la instantánea`);
  // El rótulo ya no promete que se pueda invertir.
  paneles.actualizarBarra(con, { ahoraServidor: T0 });
  assert.equal($('v-disponible-nota').textContent, '');
  assert.equal($('c-disponible').classList.contains('no-compra'), false);
  const bloqueado = { ...con, fondo: { ...con.fondo, nivel: 'bloqueado', motivo: 'Kill switch: no se opera hasta Reabrir.' } };
  paneles.actualizarBarra(bloqueado, { ahoraServidor: T0 });
  assert.equal($('v-disponible-nota').textContent, '(no compra)');
  assert.ok($('c-disponible').classList.contains('no-compra'));
  assert.match(cifras.explicarCapital('disponible', bloqueado), /Ahora el fondo no compra nada: Kill switch/);
  paneles.actualizarBarra(INST, { ahoraServidor: T0 });
  assert.equal($('v-disponible-nota').textContent, '');
});

test('el rótulo de la cifra es «Margen de los límites»', () => {
  const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'web', 'index.html'), 'utf8');
  assert.match(html, /<span class="rotulo">Margen de los límites<\/span><span class="valor-linea"><span class="valor" id="v-disponible">/);
  assert.doesNotMatch(html, /Puedes invertir aún/);
});

test('sin capital (servidor anterior) la franja no se pinta', () => {
  paneles.actualizarBarra({ ...INST, cabecera: { ...INST.cabecera, capital: undefined } }, { ahoraServidor: T0 });
  assert.equal($('capital').hidden, true);
  paneles.actualizarBarra(INST, { ahoraServidor: T0 });
  assert.equal($('capital').hidden, false);
});

test('maqueta: el mismo campo y cuadrado (invertido + efectivo = patrimonio, Σ tipos = invertido = Σ posiciones)', () => {
  const s = crearMaqueta({ semilla: 7, ahora: T0 });
  for (let k = 0; k < 4; k++) {
    const i = s.instantanea();
    const cap = i.cabecera.capital;
    const enPosiciones = i.posiciones.reduce((x, p) => x + p.cantidad * p.precio, 0);
    assert.ok(Math.abs(cap.invertido - enPosiciones) < 1e-6, 'invertido = Σ posiciones');
    assert.ok(Math.abs(cap.invertido + cap.efectivo - cap.patrimonio) < 1e-6, 'invertido + efectivo = patrimonio');
    assert.ok(Math.abs(cap.patrimonio - i.cabecera.patrimonio) < 0.006, 'el de la cabecera (redondeado a céntimos)');
    assert.ok(Math.abs(cap.porTipo.reduce((x, t) => x + t.importe, 0) - cap.invertido) < 1e-6, 'Σ porTipo = invertido');
    assert.deepEqual(cap.porTipo.map(t => t.tipo), ['cripto'], 'la maqueta es cripto, como el sintético');
    assert.ok(Math.abs(cap.disponible - Math.max(0, Math.min(cap.efectivo, 0.8 * cap.patrimonio - cap.invertido))) < 1e-6);
    assert.ok(Math.abs(cap.disponibleCripto - Math.max(0, Math.min(cap.disponible, 0.5 * cap.patrimonio - cap.invertido))) < 1e-6);
    s.avanzar(15000);
  }
});
