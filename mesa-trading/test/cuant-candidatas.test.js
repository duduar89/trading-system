'use strict';
// scripts/estudiar-candidatas.js sin red (revisión del 30-sep-2026):
//   - cada candidata recibe los ensayos de las anteriores para su Sharpe
//     deflactado (iban dentro de un comentario y cada una se deflactaba como
//     si fuera la primera);
//   - las mesas de ETF se estudian con SU universo (Reversión ETF opera SPY y
//     QQQ y enseñaba el estudio de SPY, QQQ, IWM y DIA);
//   - la salida guarda con cuánto dinero invertido, como mucho, se hizo la
//     rentabilidad, y una copia versionada de la que salen las notas.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CANDIDATAS, MESAS_ETF, estudiar } = require('../scripts/estudiar-candidatas');
const { mesasIniciales, exposicionMaximaEstudio } = require('../src/estrategias');
const { LIMITES_DUROS } = require('../src/config');

const carpetas = [];
process.on('exit', () => { for (const c of carpetas) { try { fs.rmSync(c, { recursive: true, force: true }); } catch (_) { /* ya no está */ } } });

// Velas diarias sintéticas (paseo aleatorio determinista), como las da Alpaca.
function barras(n, semilla, desde) {
  let x = 100;
  let s = semilla;
  const out = [];
  const t0 = Date.parse(desde);
  for (let i = 0; i < n; i++) {
    s = (s * 16807) % 2147483647;
    x *= 1 + ((s / 2147483647) - 0.5) * 0.02;
    out.push({ t: new Date(t0 + i * 864e5).toISOString(), o: x, h: x * 1.01, l: x * 0.99, c: x, v: 1000 });
  }
  return out;
}

test('estudiar-candidatas: cada candidata recibe los ensayos de las anteriores, y las mesas de ETF se estudian con su universo', async () => {
  const salida = fs.mkdtempSync(path.join(os.tmpdir(), 'mesa-candidatas-'));
  carpetas.push(salida);
  let k = 1;
  const pedir = async url => {
    const u = new URL(String(url));
    const sim = u.searchParams.get('symbols');
    const bars = barras(520, k++, u.searchParams.get('start') || '2021-01-01');
    return { status: 200, ok: true, text: async () => JSON.stringify({ bars: { [sim]: bars }, next_page_token: null }) };
  };
  const llamadas = [];
  const evaluar = async (h, opts) => {
    llamadas.push({ id: h.id, universo: h.universo, ensayosPrevios: opts.ensayosPrevios, sharpesPrevios: [...opts.sharpesPrevios] });
    return { aprobada: false, criterios: [], informe: 'falso', walkforward: { combinaciones: 12, sharpesEnsayos: [0.1, 0.2, 0.3] } };
  };
  const config = { alpaca: { hay: true, claveId: 'x', secreto: 'y' }, limites: LIMITES_DUROS };
  const escribir = process.stdout.write;
  process.stdout.write = () => true;
  let r;
  try {
    r = await estudiar({ config, desde: '2024-01-01', salida, versionado: path.join(salida, 'docs'), pedir, evaluar, ahora: Date.UTC(2026, 8, 30, 12) });
  } finally { process.stdout.write = escribir; }
  assert.equal(llamadas.length, CANDIDATAS.length);
  // La 1.ª empieza de cero; la 2.ª ya lleva los 12 ensayos y los 3 Sharpe de la 1.ª, y así.
  assert.equal(llamadas[0].ensayosPrevios, 0);
  assert.deepEqual(llamadas[0].sharpesPrevios, []);
  assert.equal(llamadas[1].ensayosPrevios, 12, 'la 2.ª candidata cuenta los ensayos de la 1.ª');
  assert.deepEqual(llamadas[1].sharpesPrevios, [0.1, 0.2, 0.3]);
  llamadas.forEach((l, i) => assert.equal(l.ensayosPrevios, 12 * i, l.id));
  // Las mesas de ETF, con su universo exacto.
  for (const m of mesasIniciales({ hayAlpaca: true }).filter(x => x.estudio)) {
    const c = CANDIDATAS.find(x => x.mesaId === m.id);
    assert.ok(c, `${m.id} es una candidata del estudio`);
    assert.deepEqual([...c.universo].sort(), [...m.universo].sort(), `${m.id}: se estudia lo que opera`);
    assert.equal(c.familia, m.familia);
    assert.deepEqual(llamadas.find(l => l.id === `estudio-${c.id}`).universo.sort(), [...m.universo].sort());
  }
  assert.deepEqual(MESAS_ETF['reversion-etf'].universo, ['SPY', 'QQQ']);
  // La salida (y su copia versionada) dice lo que la nota tiene que contar.
  const guardada = JSON.parse(fs.readFileSync(r.versionado, 'utf8'));
  assert.deepEqual(guardada, JSON.parse(fs.readFileSync(r.fichero, 'utf8')));
  assert.equal(path.basename(r.versionado), 'candidatas-2026-09-30.json');
  for (const x of guardada.resultados) {
    assert.equal(x.exposicionMaxima, exposicionMaximaEstudio(x.familia, x.universoUsado, LIMITES_DUROS), x.id);
    assert.ok(Number.isFinite(x.ensayosPrevios), x.id);
    assert.ok(x.completo && Number.isFinite(x.completo.estrategia.sharpe) && Number.isFinite(x.completo.comprarYMantener.sharpe), `${x.id}: los Sharpe de las dos, para comparar lo comparable`);
  }
  assert.equal(guardada.resultados.find(x => x.id === 'etf-actual').exposicionMaxima, 0.2, 'top 2 con el 10 % por activo');
});
