'use strict';
// Parqué · caras de los agentes (web/js/caras.js): deterministas, con la misma
// piel, pelo y peinado que su muñeco, la camisa del color del departamento y
// un SVG válido que cumple la CSP (sin style=, sin nada externo). Y las
// funciones puras de la pestaña Equipo y de las conversaciones del feed.
const test = require('node:test');
const assert = require('node:assert/strict');
const caras = require('../web/js/caras.js');
const personajes = require('../web/js/personajes.js');
const registro = require('../src/agentes/registro.js');

const DEPS = registro.DEPARTAMENTOS;
const colorDe = id => (DEPS.find(d => d.id === id) || {}).color;

// Plantilla de verdad (src/agentes/registro.js) con un universo y dos mesas fijos.
const MESAS = [
  { id: 'tendencia', nombre: 'Tendencia SMA', familia: 'tendencia-sma', universo: ['BTC/USD', 'ETH/USD', 'SOL/USD'] },
  { id: 'reversion', nombre: 'Reversión RSI', familia: 'reversion-rsi', universo: ['BTC/USD', 'ETH/USD'] },
];
const PLANTILLA = registro.crearPlantilla({ universo: ['BTC/USD', 'ETH/USD', 'SOL/USD'], mesas: MESAS });

// ---------- comprobador de SVG (XML bien formado y lo que admite la CSP) ----------
const ELEMENTOS = new Set(['svg', 'title', 'g', 'circle', 'ellipse', 'path', 'rect']);
const NUMERICOS = new Set(['cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'width', 'height', 'stroke-width', 'fill-opacity', 'stroke-opacity']);
function comprobarSvg(svg, { tam } = {}) {
  assert.equal(typeof svg, 'string');
  assert.ok(svg.startsWith('<svg '), 'empieza por <svg');
  assert.ok(!/NaN|undefined|null|Infinity/.test(svg), `sin valores rotos: ${svg.match(/.{0,30}(NaN|undefined|null|Infinity).{0,30}/)}`);
  const pila = [];
  let raices = 0;
  const re = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"<>]*")*)\s*(\/?)>|([^<]+)/g;
  let m; let fin = 0;
  while ((m = re.exec(svg))) {
    assert.equal(m.index, fin, `hueco sin analizar en ${fin}: «${svg.slice(fin, fin + 40)}»`);
    fin = re.lastIndex;
    if (m[5] !== undefined) {
      assert.ok(pila.length && pila[pila.length - 1] === 'title', `texto suelto fuera de <title>: «${m[5]}»`);
      assert.ok(!/[<>]/.test(m[5]));
      continue;
    }
    const [, cierra, nombre, attrs, solo] = m;
    assert.ok(ELEMENTOS.has(nombre), `elemento no admitido: ${nombre}`);
    if (cierra) { assert.equal(pila.pop(), nombre, `cierre ${nombre} sin abrir`); continue; }
    if (!pila.length) raices++;
    const vistos = new Set();
    for (const [, k, v] of attrs.matchAll(/([\w:-]+)="([^"]*)"/g)) {
      assert.ok(!vistos.has(k), `atributo repetido ${k} en ${nombre}`);
      vistos.add(k);
      assert.ok(k !== 'style' && !/^on/i.test(k) && !/href$/i.test(k), `atributo prohibido por la CSP o inseguro: ${k}`);
      if (NUMERICOS.has(k)) assert.ok(Number.isFinite(Number(v)), `${k}="${v}" no es un número`);
      if (k === 'fill' || k === 'stroke') assert.match(v, /^(#[0-9a-f]{6}|none)$/, `${k}="${v}"`);
      if (k === 'd') assert.match(v, /^[MmLlHhVvCcSsQqTtAaZz0-9 .,-]+$/, `d="${v}"`);
    }
    if (nombre === 'svg') {
      assert.equal(pila.length, 0, '<svg> anidado');
      assert.equal(vistos.has('viewBox'), true);
      if (tam) { assert.match(attrs, new RegExp(`width="${tam}"`)); assert.match(attrs, new RegExp(`height="${tam}"`)); }
      assert.ok(/aria-hidden="true"/.test(attrs) || (/role="img"/.test(attrs) && /aria-label="[^"]+"/.test(attrs)), 'o decorativa o con nombre');
    }
    if (!solo) pila.push(nombre);
  }
  assert.equal(fin, svg.length, 'se analizó hasta el final');
  assert.equal(pila.length, 0, `sin cerrar: ${pila.join(',')}`);
  assert.equal(raices, 1, 'una sola raíz');
}

test('cara determinista: el mismo agente da siempre el mismo SVG; agentes distintos, caras distintas', () => {
  for (const a of PLANTILLA) {
    const o = { tam: 40, color: colorDe(a.departamento) };
    assert.equal(caras.svgCara(a, o), caras.svgCara({ ...a }, o), a.id);
    assert.deepEqual(caras.rasgosDe(a), caras.rasgosDe(JSON.parse(JSON.stringify(a))));
  }
  const distintas = new Set(PLANTILLA.map(a => caras.svgCara(a, { tam: 40, color: colorDe(a.departamento) })));
  assert.equal(distintas.size, PLANTILLA.length, 'ninguna cara repetida en la plantilla');
  // Variedad de verdad: peinados, gafas y barbas repartidos.
  const r = Array.from({ length: 300 }, (_, i) => caras.rasgosDe({ id: `puesto-x-${i}`, nombre: i % 2 ? 'Pablo Gil' : 'Lucía Gil', rol: '' }));
  for (const corte of ['raya', 'flequillo', 'rapado', 'rizos', 'melena', 'flequillo-largo', 'mono-alto', 'mono-lado']) assert.ok(r.some(x => x.corte === corte), corte);
  assert.ok(r.filter(x => x.gafas).length > 30 && r.filter(x => x.gafas).length < 150, 'gafas en una parte, no en todos');
  assert.ok(r.some(x => x.barba === 'barba') && r.some(x => x.barba === 'bigote') && r.some(x => x.barba === 'perilla'));
});

test('misma piel, pelo y peinado que su muñeco del parqué', () => {
  for (const a of PLANTILLA) {
    const muneco = new personajes.Personaje({ ...a, estado: 'trabajando' }, null, null);
    const r = caras.rasgosDe(a);
    assert.equal(r.piel, muneco.aspecto.piel, `piel de ${a.id}`);
    assert.equal(r.pelo, muneco.aspecto.pelo, `pelo de ${a.id}`);
    assert.equal(r.peinado, muneco.aspecto.peinado, `peinado de ${a.id}`);
    // El largo del pelo del muñeco (0 corto, 1 largo, 2 moño) manda en el corte de la cara.
    assert.ok({ 0: ['raya', 'flequillo', 'rapado', 'rizos'], 1: ['melena', 'flequillo-largo'], 2: ['mono-alto', 'mono-lado'] }[r.peinado].includes(r.corte));
    const svg = caras.svgCara(a, { tam: 96, color: colorDe(a.departamento) });
    assert.ok(svg.includes(`fill="${r.piel}"`), `la cara lleva su piel ${r.piel}`);
    assert.ok(svg.includes(`fill="${r.pelo}"`), `la cara lleva su pelo ${r.pelo}`);
  }
  // personajes.aspectoDe es la fuente única (la usa el muñeco).
  assert.deepEqual(personajes.aspectoDe('riesgos'), new personajes.Personaje({ id: 'riesgos' }, null, null).aspecto);
});

test('camisa del color de su departamento; un color raro no rompe el SVG', () => {
  for (const d of DEPS) {
    const a = PLANTILLA.find(x => x.departamento === d.id);
    if (!a) continue;
    const svg = caras.svgCara(a, { tam: 40, color: d.color });
    assert.ok(svg.includes(`fill="${d.color.toLowerCase()}"`), `camisa ${d.color} para ${d.id}`);
  }
  const raro = caras.svgCara(PLANTILLA[0], { tam: 40, color: 'rojo"><script>' });
  comprobarSvg(raro, { tam: 40 });
  assert.ok(!raro.includes('script'));
});

test('SVG válido en los tres tamaños (24, 40, 96), sin nada que la CSP bloquee; el humano y el sistema, con su icono', () => {
  for (const tam of [24, 40, 96]) {
    for (const a of PLANTILLA) comprobarSvg(caras.svgCara(a, { tam, color: colorDe(a.departamento) }), { tam });
    comprobarSvg(caras.svgHumano({ tam }), { tam });
    comprobarSvg(caras.svgSistema({ tam }), { tam });
  }
  // Un tamaño que no es de los tres cae en 40.
  assert.match(caras.svgCara(PLANTILLA[0], { tam: 33 }), /width="40" height="40"/);
  // Con etiqueta: role=img, nombre y <title> (escapados); sin ella, decorativa.
  const conNombre = caras.svgCara(PLANTILLA[0], { tam: 96, etiqueta: 'Cara de "Carmen" <Aguirre>' });
  comprobarSvg(conNombre, { tam: 96 });
  assert.match(conNombre, /role="img" aria-label="Cara de &quot;Carmen&quot; &lt;Aguirre&gt;"/);
  assert.match(caras.svgCara(PLANTILLA[0], { tam: 24 }), /aria-hidden="true"/);
  // El humano, ámbar y con el megáfono; el sistema, gris y con el cubo.
  assert.ok(caras.svgHumano({ tam: 40 }).includes('stroke="#f59e0b"'));
  assert.ok(caras.svgHumano({ tam: 40 }).includes('M4 10v4h3l7 4V6L7 10H4z'));
  assert.ok(caras.svgSistema({ tam: 40 }).includes('fill="#94a3b8"'));
});

test('la barba solo sale en hombres: el género se deduce del rol o del nombre de pila, y cuadra con toda la lista de nombres', () => {
  for (const n of registro.NOMBRES) {
    assert.equal(caras.generoDe({ nombre: `${n.nombre} García`, rol: 'Analista de BTC' }), n.genero, n.nombre);
  }
  assert.equal(caras.generoDe({ nombre: 'Carmen Aguirre', rol: 'Presidenta del comité' }), 'f');
  assert.equal(caras.generoDe({ nombre: 'Inés Ferrer', rol: 'Controller' }), 'f');
  assert.equal(caras.generoDe({ nombre: 'Tomás Herrera', rol: 'Estratega macro' }), 'm');
  assert.equal(caras.generoDe({ nombre: 'X', rol: 'Operadora de Tendencia SMA · BTC' }), 'f');
  assert.equal(caras.generoDe({ nombre: 'Sofía', genero: 'm' }), 'm', 'si el agente lo trae, manda');
  for (const a of PLANTILLA) if (caras.generoDe(a) !== 'm') assert.equal(caras.rasgosDe(a).barba, null, a.nombre);
  for (let i = 0; i < 200; i++) assert.equal(caras.rasgosDe({ id: `a${i}`, nombre: 'Lucía Gil', rol: '' }).barba, null);
  assert.equal(caras.rasgosDe('solo-un-id').barba, null, 'sin agente no hay género: sin barba');
});

test('equipo agrupado por departamento, en su orden, con su color y su frase; cada agente una vez', () => {
  const grupos = caras.agruparEquipo(PLANTILLA, DEPS, { mesas: MESAS });
  assert.deepEqual(grupos.map(g => g.id), DEPS.map(d => d.id).filter(id => PLANTILLA.some(a => a.departamento === id)));
  const ids = grupos.flatMap(g => g.agentes.map(a => a.id));
  assert.equal(ids.length, PLANTILLA.length);
  assert.equal(new Set(ids).size, PLANTILLA.length);
  for (const g of grupos) {
    assert.equal(g.color, colorDe(g.id).toLowerCase());
    assert.ok(g.frase.length > 20 && !/\d/.test(g.frase), `frase llana y sin cifras: ${g.id}`);
    assert.equal(g.total, g.agentes.length);
    assert.ok(g.agentes.every(a => a.departamento === g.id));
  }
  // Dentro de Mesas, por mesa (en el orden de `mesas`): cada operador con sus compañeros.
  const alReves = caras.agruparEquipo(PLANTILLA, DEPS, { mesas: MESAS.slice().reverse() }).find(g => g.id === 'mesas');
  assert.deepEqual(alReves.agentes.map(a => a.mesaId), ['reversion', 'reversion', 'tendencia', 'tendencia', 'tendencia']);
  // Un departamento que no existe va a «Otros», al final; un departamento sin nadie no sale.
  const conRaro = caras.agruparEquipo(PLANTILLA.concat([{ id: 'nuevo', nombre: 'Ana Nueva', departamento: 'marketing', rol: 'Becaria' }]), DEPS.concat([{ id: 'vacio', nombre: 'Vacío', color: '#000000' }]));
  assert.equal(conRaro[conRaro.length - 1].id, 'otros');
  assert.equal(conRaro[conRaro.length - 1].agentes[0].id, 'nuevo');
  assert.ok(!conRaro.some(g => g.id === 'vacio'));
  // Si el departamento trae su propio queHace, manda ese.
  assert.equal(caras.fraseDepartamento({ id: 'macro', queHace: 'Otra frase.' }), 'Otra frase.');
});

test('buscador del equipo: por nombre o puesto, sin tildes ni mayúsculas', () => {
  const buscar = q => caras.agruparEquipo(PLANTILLA, DEPS, { busqueda: q, mesas: MESAS }).flatMap(g => g.agentes.map(a => a.nombre));
  assert.deepEqual(buscar('solis'), ['Marta Solís']);
  assert.deepEqual(buscar('  MARTA   sOLÍS '), ['Marta Solís']);
  assert.deepEqual(buscar('zzz'), []);
  const btc = caras.agruparEquipo(PLANTILLA, DEPS, { busqueda: 'btc', mesas: MESAS });
  assert.ok(btc.every(g => g.agentes.every(a => /BTC/.test(a.rol))));
  // Con búsqueda, `total` sigue siendo el del departamento entero.
  const mesas = btc.find(g => g.id === 'mesas');
  assert.equal(mesas.agentes.length, 2);
  assert.equal(mesas.total, 5);
  assert.equal(caras.normalizar('Álvaro  Núñez'), 'alvaro nunez');
});

// ---------- conversaciones ----------
const M = (id, t, extra) => ({ id, t, de: 'riesgos', deNombre: 'Marta Solís', departamento: 'riesgos', para: 'todos', texto: id, ...extra });

test('conversaciones: una respuesta va con su mensaje y trae la conversación abajo del todo', () => {
  const lista = [
    M('a', 1, { hilo: 'a' }),                        // abre conversación (hilo: true en el bus → su propio id)
    M('b', 2),
    M('r1', 3, { respondeA: 'a', hilo: 'a', de: 'cio', deNombre: 'Carmen Aguirre' }),
    M('c', 4),
    M('r2', 5, { respondeA: 'r1', hilo: 'a' }),
  ];
  const b = caras.organizarHilos(lista);
  assert.deepEqual(b.map(x => x.raiz.id), ['b', 'c', 'a']);
  assert.deepEqual(b[2].respuestas.map(x => x.id), ['r1', 'r2']);
  assert.equal(b[2].ultimoT, 5);
  // Sin `hilo`, subiendo por respondeA.
  const sinHilo = caras.organizarHilos([M('a', 1), M('r1', 2, { respondeA: 'a' }), M('r2', 3, { respondeA: 'r1' })]);
  assert.equal(sinHilo.length, 1);
  assert.deepEqual(sinHilo[0].respuestas.map(x => x.id), ['r1', 'r2']);
  // Responde a algo que ya no está en memoria: va suelto.
  const huerfana = caras.organizarHilos([M('x', 1), M('r', 2, { respondeA: 'desaparecido' })]);
  assert.deepEqual(huerfana.map(x => x.raiz.id), ['x', 'r']);
  // Con `hilo` cuya raíz ya no está: la conversación sigue junta; abre la primera que queda.
  const sinRaiz = caras.organizarHilos([M('r1', 2, { hilo: 'viejo', respondeA: 'viejo' }), M('r2', 3, { hilo: 'viejo', respondeA: 'r1' })]);
  assert.equal(sinRaiz.length, 1);
  assert.equal(sinRaiz[0].raiz.id, 'r1');
  assert.deepEqual(sinRaiz[0].respuestas.map(x => x.id), ['r2']);
  // Nada se pierde ni se repite.
  const todos = b.flatMap(x => [x.raiz, ...x.respuestas]).map(x => x.id).sort();
  assert.deepEqual(todos, lista.map(x => x.id).sort());
});

test('«→ Marta»: a quién va un mensaje (para), y a quién contesta una respuesta a otra respuesta', () => {
  const agentes = new Map(PLANTILLA.map(a => [a.id, a]));
  const lista = [M('a', 1, { hilo: 'a' }), M('r1', 2, { respondeA: 'a', hilo: 'a', de: 'cio', deNombre: 'Carmen Aguirre' }), M('r2', 3, { respondeA: 'r1', hilo: 'a' })];
  const porId = new Map(lista.map(m => [m.id, m]));
  assert.equal(caras.textoPara({ para: 'riesgos' }, agentes), '→ Marta');
  assert.equal(caras.textoPara({ para: 'todos' }, agentes), null);
  assert.equal(caras.textoPara({ para: 'humano' }, agentes), '→ Megáfono');
  assert.equal(caras.textoPara({ para: ['riesgos', 'cio'] }, agentes), '→ Marta, Carmen');
  assert.equal(caras.textoPara({ para: 'despedido-x' }, agentes), '→ despedido-x', 'un id que no está: se dice tal cual, sin inventar nombre');
  // r1 contesta a la raíz: el sangrado ya lo dice. r2 contesta a Carmen (r1), no a la raíz.
  assert.equal(caras.textoPara(lista[1], agentes, porId, lista[0]), null);
  assert.equal(caras.textoPara(lista[2], agentes, porId, lista[0]), '→ Carmen');
});
