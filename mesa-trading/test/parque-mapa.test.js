'use strict';
// Parqué · plano: salas, filas de mesas, muebles, sitios y rutas por las puertas.
const test = require('node:test');
const assert = require('node:assert/strict');
const mapa = require('../web/js/mapa.js');
const { crearMaqueta } = require('../web/js/maqueta.js');

const T0 = Date.UTC(2026, 8, 29, 12, 0, 0);
const inst = crearMaqueta({ semilla: 7, ahora: T0 }).instantanea();

// Instantánea con más mesas (como con claves de Alpaca) para probar el reparto.
function conMesas(n) {
  const mesas = []; const puestos = [];
  for (let k = 0; k < n; k++) {
    const universo = ['BTC', 'ETH', 'SOL', 'LINK', 'AVAX'].slice(0, 2 + (k % 4));
    mesas.push({ id: `m${k}`, nombre: `Mesa ${k}`, marco: '1Day', estado: 'titular', universo });
    for (const e of universo) puestos.push({ id: `m${k}-${e}`, mesaId: `m${k}`, etiqueta: e });
  }
  return { mesas, puestos, agentes: [] };
}

test('las salas cubren el plano de 28×22 sin huecos ni solapes', () => {
  let area = 0;
  for (const id of mapa.ORDEN_SALAS) { const s = mapa.SALAS[id]; area += (s.c1 - s.c0) * (s.f1 - s.f0); }
  assert.equal(area, 28 * 22);
  for (let c = 0; c < 28; c++) {
    for (let f = 0; f < 22; f++) {
      const dentro = mapa.ORDEN_SALAS.filter(id => { const s = mapa.SALAS[id]; return c + 0.5 >= s.c0 && c + 0.5 < s.c1 && f + 0.5 >= s.f0 && f + 0.5 < s.f1; });
      assert.equal(dentro.length, 1, `tesela ${c},${f}`);
    }
  }
  assert.equal(mapa.salaEn(5, 5), 'parque');
  assert.equal(mapa.salaEn(24, 2), 'direccion');
  assert.equal(mapa.salaEn(24, 6), 'macro');
  assert.equal(mapa.salaEn(15, 19), 'comite');
  assert.equal(mapa.salaEn(25, 19), 'descanso');
  assert.equal(mapa.salaEn(3, 18), 'riesgos');
});

test('la tarima de macro: 14 dentro, rampa de 0,35 en el borde, 0 fuera', () => {
  assert.equal(mapa.elevacionEn(24, 6), 14);
  assert.ok(Math.abs(mapa.elevacionEn(20.1, 6) - 4) < 1e-9);   // 14 · 0,1 / 0,35 = 4
  assert.equal(mapa.elevacionEn(5, 5), 0);
});

test('parqué: una fila por mesa, un puesto por activo, puestos alineados en columnas', () => {
  const m = mapa.construirMapa(inst);
  assert.equal(m.puestos.size, 14);
  // 4 mesas → paso = min(3, (12,9 − 3,2)/3) = 3 → filas 3,2 · 6,2 · 9,2 · 12,2.
  const filas = new Set(Array.from(m.puestos.values()).map(p => p.f0));
  assert.deepEqual(Array.from(filas).sort((a, b) => a - b), [3.2, 6.2, 9.2, 12.2]);
  // La mesa más larga tiene 6 puestos → ancho = min(2,5; 15,2/6) = 2,5; hueco 0,28 → primer tablero 2,74–4,96.
  const btc = m.puestos.get('tendencia-BTC');
  assert.ok(Math.abs(btc.c0 - 2.74) < 1e-9 && Math.abs(btc.c1 - 4.96) < 1e-9);
  assert.ok(Math.abs(m.puestos.get('momentum-BTC').c0 - btc.c0) < 1e-9, 'mismas columnas en todas las filas');
  for (const p of m.puestos.values()) {
    assert.equal(mapa.salaEn(p.c0, p.f0), 'parque');
    assert.equal(mapa.salaEn(p.c1 - 0.01, p.f1 + 0.9), 'parque', `${p.puestoId} cabe con su silla`);
    assert.equal(p.monitores.length, 2);
  }
  assert.equal(m.rotulosFila.length, 4);
  assert.deepEqual(m.rotulosFila.map(r => r.mesaId), ['tendencia', 'momentum', 'reversion', 'ruptura']);
});

test('con 6 mesas siguen cabiendo en el parqué; con 8 se juntan en filas', () => {
  const m6 = mapa.construirMapa(conMesas(6));
  assert.equal(new Set(Array.from(m6.puestos.values()).map(p => p.f0)).size, 6);
  const m8 = mapa.construirMapa(conMesas(8));
  const filas8 = new Set(Array.from(m8.puestos.values()).map(p => p.f0));
  assert.ok(filas8.size <= 6, `filas: ${filas8.size}`);
  for (const mm of [m6, m8]) {
    for (const p of mm.puestos.values()) {
      assert.equal(mapa.salaEn(p.c0, p.f0), 'parque');
      assert.ok(p.c1 <= 18.2 && p.f1 + 0.9 < 16, `${p.puestoId} dentro del parqué`);
    }
  }
});

test('ningún mueble que estorba se solapa con otro ni atraviesa un tabique', () => {
  for (const entrada of [inst, conMesas(6), conMesas(8)]) {
    const m = mapa.construirMapa(entrada);
    const b = m.muebles.filter(x => x.bloquea);
    for (let i = 0; i < b.length; i++) {
      for (let j = i + 1; j < b.length; j++) {
        const x = b[i]; const y = b[j];
        const solapa = x.c0 < y.c1 - 1e-6 && y.c0 < x.c1 - 1e-6 && x.f0 < y.f1 - 1e-6 && y.f0 < x.f1 - 1e-6;
        assert.ok(!solapa, `${x.id} solapa con ${y.id}`);
      }
      const x = b[i];
      assert.equal(mapa.salaEn(x.c0 + 0.001, x.f0 + 0.001), mapa.salaEn(x.c1 - 0.001, x.f1 - 0.001), `${x.id} en una sola sala`);
    }
  }
});

test('sitios: deterministas, sin repetir, cada agente en su sala y el operador en la silla de su puesto', () => {
  const m = mapa.construirMapa(inst);
  const a1 = mapa.asignarSitios(m, inst.agentes, inst.departamentos);
  const a2 = mapa.asignarSitios(mapa.construirMapa(inst), inst.agentes, inst.departamentos);
  assert.equal(a1.size, inst.agentes.length);
  const vistos = new Set();
  for (const a of inst.agentes) {
    const s = a1.get(a.id);
    assert.ok(s, `sitio de ${a.id}`);
    assert.deepEqual([s.col, s.fila], [a2.get(a.id).col, a2.get(a.id).fila], 'determinista');
    assert.equal(mapa.salaEn(s.col, s.fila), a.sala, `${a.id} en ${a.sala}`);
    const k = `${s.col},${s.fila}`;
    assert.ok(!vistos.has(k), `sitio repetido ${k}`);
    vistos.add(k);
    if (a.puestoId) assert.equal(s.puestoId, a.puestoId);
  }
  // La Presidenta, en la mesa de dirección (silla a 23,5 · 2,45) y, en comité, a la cabecera.
  assert.deepEqual([a1.get('cio').col, a1.get('cio').fila], [23.5, 2.45]);
  const enComite = inst.agentes.map(a => (['cio', 'macro', 'riesgos', 'controller', 'laboratorio'].includes(a.id) ? { ...a, sala: 'comite' } : a));
  const ac = mapa.asignarSitios(m, enComite, inst.departamentos);
  assert.deepEqual([ac.get('cio').col, ac.get('cio').fila], [18.55, 19.1]);
  // La mesa de la jefa de riesgos queda libre aunque ella esté en el comité: nadie se sienta en ella.
  const mesaRiesgos = a1.get('riesgos');
  for (const a of enComite) if (a.id !== 'riesgos') assert.notDeepEqual([ac.get(a.id).col, ac.get(a.id).fila], [mesaRiesgos.col, mesaRiesgos.fila]);
});

test('un agente con sala desconocida va a la sala de su departamento (§6.1)', () => {
  assert.equal(mapa.salaDeAgente({ departamento: 'operaciones', sala: 'marte' }, inst.departamentos), 'riesgos');
  assert.equal(mapa.salaDeAgente({ departamento: 'mesas' }, null), 'parque');
  assert.equal(mapa.salaDeAgente({ departamento: 'x' }, null), 'parque');
});

// ¿Cruza el segmento a→b un tabique fuera de una puerta? Muestreo fino.
function cruzaTabique(a, b) {
  const pasos = Math.ceil(Math.hypot(b.col - a.col, b.fila - a.fila) / 0.02);
  for (let s = 1; s <= pasos; s++) {
    const p0 = { col: a.col + (b.col - a.col) * (s - 1) / pasos, fila: a.fila + (b.fila - a.fila) * (s - 1) / pasos };
    const p1 = { col: a.col + (b.col - a.col) * s / pasos, fila: a.fila + (b.fila - a.fila) * s / pasos };
    for (const w of mapa.PAREDES) {
      const [x0, x1, y] = w.eje === 'col' ? [p0.col, p1.col, (p0.fila + p1.fila) / 2] : [p0.fila, p1.fila, (p0.col + p1.col) / 2];
      if ((x0 - w.en) * (x1 - w.en) < 0 && y > w.desde && y < w.hasta) {
        const enPuerta = w.puertas.some(c => Math.abs(y - c) < mapa.ANCHO_PUERTA / 2);
        if (!enPuerta) return { w: w.id, y };
      }
    }
  }
  return null;
}

test('rutas: de cada sala a cada sala, siempre por las puertas', () => {
  const m = mapa.construirMapa(inst);
  const asig = mapa.asignarSitios(m, inst.agentes, inst.departamentos);
  const origenes = ['cio', 'macro', 'riesgos', 'laboratorio', 'analista-BTC', 'puesto-momentum-DOGE', 'puesto-ruptura-SOL'].map(id => asig.get(id));
  const destinos = mapa.ORDEN_SALAS.map(s => m.sitios[s][0]);
  for (const o of origenes) {
    for (const d of destinos) {
      const r = mapa.ruta(m, o, d);
      assert.deepEqual(r[0], { col: o.col, fila: o.fila });
      assert.deepEqual(r[r.length - 1], { col: d.col, fila: d.fila });
      for (let k = 0; k < r.length - 1; k++) {
        const x = cruzaTabique(r[k], r[k + 1]);
        assert.equal(x, null, `${o.id} → ${d.id}: atraviesa ${x && x.w} en ${x && x.y}`);
      }
    }
  }
});

test('ruta conocida: de la mesa de dirección a la cabecera del comité por las puertas (20; 2) y (15; 16)', () => {
  const m = mapa.construirMapa(inst);
  const r = mapa.ruta(m, { col: 23.5, fila: 2.45 }, { col: 18.55, fila: 19.1 });
  const cruces = [];
  for (let k = 0; k < r.length - 1; k++) {
    const a = r[k]; const b = r[k + 1];
    if ((a.col - 20) * (b.col - 20) < 0) cruces.push(['col20', a.fila + (b.fila - a.fila) * (20 - a.col) / (b.col - a.col)]);
    if ((a.fila - 16) * (b.fila - 16) < 0) cruces.push(['fila16', a.col + (b.col - a.col) * (16 - a.fila) / (b.fila - a.fila)]);
  }
  assert.equal(cruces.length, 2, JSON.stringify(r));
  assert.equal(cruces[0][0], 'col20');
  assert.ok(Math.abs(cruces[0][1] - 2) < 0.75, `puerta de dirección en fila ${cruces[0][1]}`);
  assert.equal(cruces[1][0], 'fila16');
  assert.ok(Math.abs(cruces[1][1] - 15) < 0.75, `puerta del comité en col ${cruces[1][1]}`);
});

test('la firma del plano cambia al contratar una mesa y no con los precios', () => {
  const f1 = mapa.firmaEstructura(inst);
  const otra = JSON.parse(JSON.stringify(inst));
  otra.cotizaciones[0].precio *= 2;
  assert.equal(mapa.firmaEstructura(otra), f1);
  otra.mesas.push({ id: 'nueva', estado: 'incubacion' });
  otra.puestos.push({ id: 'nueva-BTC', mesaId: 'nueva' });
  assert.notEqual(mapa.firmaEstructura(otra), f1);
});

// Con las mesas que va contratando el laboratorio (o con Alpaca: 6 + las
// contratadas) el parqué no puede apretar las filas hasta que una silla caiga
// encima de la mesa de detrás ni juntar mesas sin decir cuál es cuál.
function comprobarParque(n) {
  const m = mapa.construirMapa(conMesas(n));
  const geo = Array.from(m.puestos.values());
  const filas = Array.from(new Set(geo.map(p => p.f0))).sort((a, b) => a - b);
  assert.ok(filas.length <= mapa.MAX_FILAS_PARQUE, `${n} mesas: ${filas.length} filas`);
  for (let k = 1; k < filas.length; k++) assert.ok(filas[k] - filas[k - 1] >= 1.94 - 1e-9, `${n} mesas: paso ${filas[k] - filas[k - 1]}`);
  const mesasParque = m.muebles.filter(x => x.tipo === 'mesa' && x.sala === 'parque');
  const sillas = m.muebles.filter(x => (x.tipo === 'silla' || x.tipo === 'respaldo') && x.sala === 'parque');
  const solapa = (a, b) => a.c0 < b.c1 - 1e-6 && b.c0 < a.c1 - 1e-6 && a.f0 < b.f1 - 1e-6 && b.f0 < a.f1 - 1e-6;
  for (const s of sillas) for (const me of mesasParque) assert.ok(!solapa(s, me), `${n} mesas: ${s.id} encima de ${me.id}`);
  for (const g of geo) {
    for (const me of mesasParque) {
      if (me.id === g.mesaMueble) continue;
      const dentro = g.sitio.col > me.c0 && g.sitio.col < me.c1 && g.sitio.fila > me.f0 && g.sitio.fila < me.f1;
      assert.ok(!dentro, `${n} mesas: el operador de ${g.puestoId} sentado dentro de ${me.id}`);
    }
    assert.equal(mapa.salaEn(g.c1 - 0.01, g.f1 + 0.9), 'parque', `${g.puestoId} cabe en el parqué con su silla`);
  }
  // Rótulos: todos los de una fila a la izquierda de la fila (ningún puesto de
  // otra mesa a su izquierda), apilados por orden y, si la fila es compartida,
  // diciendo de qué activo a qué activo va su tramo.
  for (const f of filas) {
    const enFila = geo.filter(p => p.f0 === f).sort((a, b) => a.c0 - b.c0);
    const rotulos = m.rotulosFila.filter(r => Math.abs(r.fila - (f + 0.18)) < 1e-9);
    const minC0 = Math.min(...enFila.map(p => p.c0));
    assert.deepEqual(rotulos.map(r => r.orden), rotulos.map((_, k) => k), `fila ${f}: orden de apilado`);
    for (const r of rotulos) {
      assert.ok(r.col < minC0, `fila ${f}: el rótulo de ${r.mesaId} tiene puestos a su izquierda`);
      assert.equal(r.compartida, rotulos.length > 1);
      const suyos = enFila.filter(p => p.mesaId === r.mesaId);
      assert.deepEqual([r.desde, r.hasta], [suyos[0].etiqueta, suyos[suyos.length - 1].etiqueta]);
    }
    // Media tesela de pasillo entre dos mesas que comparten fila.
    for (let k = 1; k < enFila.length; k++) {
      if (enFila[k].mesaId !== enFila[k - 1].mesaId) assert.ok(enFila[k].c0 - enFila[k - 1].c1 >= mapa.HUECO_ENTRE_MESAS - 1e-9, `fila ${f}: sin pasillo entre mesas`);
    }
  }
  return { m, filas };
}

test('7 mesas: filas compartidas con rótulos apilados a la izquierda y pasillo entre mesas', () => {
  const { m } = comprobarParque(7);
  assert.ok(m.rotulosFila.some(r => r.compartida && r.orden === 1), 'alguna fila compartida');
});

test('12 y 16 mesas: nunca más de 6 filas, paso ≥ 1,94 y ninguna silla encima de otra mesa', () => {
  for (const n of [12, 16]) {
    const { m } = comprobarParque(n);
    assert.equal(m.puestos.size, conMesas(n).puestos.length);
  }
});
