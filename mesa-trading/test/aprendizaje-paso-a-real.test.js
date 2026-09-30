'use strict';
// Semáforo «¿Listo para dinero real?» (§5.8, docs/05-paso-a-real.md): cada
// criterio a-g en verde y en rojo, la nota del comité y que todo junto decide.
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluarPasoAReal, CRITERIOS, NOTA } = require('../src/aprendizaje/paso-a-real');

const DIA = 86_400_000;
const T0 = Date.UTC(2026, 9, 1);
const cerca = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);

// Curva diaria de n retornos que alternan +a y −b (valor inicial v0).
function curva(n, a, b, v0 = 100000) {
  const out = [{ dia: '2026-10-01', valor: v0 }];
  let v = v0;
  for (let i = 1; i <= n; i++) {
    v *= 1 + (i % 2 ? a : -b);
    out.push({ dia: new Date(T0 + i * DIA).toISOString().slice(0, 10), valor: v });
  }
  return out;
}

// Sharpe a mano: media / desviación (n − 1) · √365 de los retornos de la curva.
function sharpeAMano(c) {
  const r = c.slice(1).map((p, i) => p.valor / c[i].valor - 1);
  const m = r.reduce((s, x) => s + x, 0) / r.length;
  const sd = Math.sqrt(r.reduce((s, x) => s + (x - m) ** 2, 0) / (r.length - 1));
  return (m / sd) * Math.sqrt(365);
}

// Operaciones pequeñas: la penalización de papel (0,1 % por lado) no mueve la curva.
const operacion = (k, extra = {}) => ({
  id: `op${k}`, mesaId: 'momentum', simbolo: 'BTC/USD', entradaT: T0 + k * DIA, salidaT: T0 + k * DIA + 3600_000,
  entradaPrecio: 100, salidaPrecio: 101, cantidad: 0.001, pnl: 0.001, motivoSalida: 'señal', ...extra,
});

// Un fondo que lo cumple todo: 200 días, 120 operaciones, Sharpe alto, caída del
// 5 %, sin incidentes desde el arranque y 50 $ de IA sobre 20.000 $ de beneficio.
function base(extra = {}) {
  return {
    ahora: T0 + 200 * DIA, creado: T0, capitalInicial: 100000, patrimonio: 120000,
    operaciones: Array.from({ length: 120 }, (_, k) => operacion(k)),
    operacionesSombra: [],
    curvaDiaria: curva(199, 0.004, 0.002),
    curvasSombra: { btc: curva(199, 0.01, 0.009), 'cesta-cripto': curva(199, 0.012, 0.0115), 'sin-comite': curva(199, 0.003, 0.002) },
    hayAlpaca: false, penalizacionPapel: 0.001, caidaMaximaVista: 0.05,
    incidentes: [], incidentesDesde: T0, costeLLMUsd: 50,
    ...extra,
  };
}
const crit = (r, id) => r.criterios.find(c => c.id === id);

test('todo en verde: listo, 7 de 7, y la nota dice que no activa nada', () => {
  const r = evaluarPasoAReal(base());
  assert.deepEqual(r.criterios.map(c => [c.id, c.ok]), [['a', true], ['b', true], ['c', true], ['d', true], ['e', true], ['f', true], ['g', true]]);
  assert.equal(r.listo, true);
  assert.equal(r.cumplidos, 7);
  assert.equal(r.total, 7);
  assert.equal(r.nota, NOTA);
  assert.match(r.nota, /no activa nada: el código sigue siendo solo papel/);
  assert.match(r.nota, /decisión escrita de Eduardo/);
  assert.match(r.nota, /como mucho 2\.000 €/);
  assert.match(r.nota, /3 meses/);
  for (const c of r.criterios) {
    assert.deepEqual(Object.keys(c).sort(), ['detalle', 'id', 'nombre', 'ok', 'umbral', 'umbralTexto', 'valor', 'valorTexto']);
    assert.equal(typeof c.valorTexto, 'string');
    assert.equal(typeof c.umbralTexto, 'string');
  }
});

test('los umbrales son los de Eduardo (30-sep-2026)', () => {
  assert.deepEqual({ ...CRITERIOS }, { diasPapel: 180, operaciones: 100, sharpe: 0.7, caidaMax: 0.20, diasSinIncidentes: 90, costeLLMMax: 0.10, minRetornosSharpe: 30 });
});

test('a) días en papel: 180 en verde, 179 en rojo', () => {
  const verde = crit(evaluarPasoAReal(base({ ahora: T0 + 180 * DIA })), 'a');
  assert.equal(verde.ok, true);
  assert.equal(verde.valor, 180);
  assert.equal(verde.valorTexto, '180 días');
  assert.equal(verde.umbralTexto, '≥ 180 días');
  const r = evaluarPasoAReal(base({ ahora: T0 + 180 * DIA - 1 }));
  assert.equal(crit(r, 'a').ok, false);
  assert.equal(crit(r, 'a').valor, 179);
  assert.equal(r.listo, false, 'uno en rojo basta para no estar listo');
  assert.equal(r.cumplidos, 6);
});

test('b) operaciones cerradas del fondo: 100 en verde; 99 en rojo aunque haya órdenes de prueba y de sombra', () => {
  const cien = Array.from({ length: 100 }, (_, k) => operacion(k));
  assert.equal(crit(evaluarPasoAReal(base({ operaciones: cien })), 'b').ok, true);
  const noCuentan = [operacion(900, { motivoSalida: 'prueba' }), operacion(901, { motivoSalida: 'prueba' }), operacion(902, { sombra: true })];
  const r = crit(evaluarPasoAReal(base({ operaciones: [...cien.slice(0, 99), ...noCuentan] })), 'b');
  assert.equal(r.ok, false);
  assert.equal(r.valor, 99);
  assert.equal(r.umbralTexto, '≥ 100');
});

test('c) Sharpe del fondo desde el arranque: ≥ 0,7 en verde; por debajo en rojo; con menos de 30 días, sin cifra', () => {
  const r = crit(evaluarPasoAReal(base()), 'c');
  cerca(r.valor, sharpeAMano(base().curvaDiaria), 1e-3);   // la penalización de 120 × 0,2 $ apenas se nota
  assert.ok(r.valor >= 0.7);
  // Retornos +1 % / −0,99 %: Sharpe ≈ 0,09. Comprar y mantener aún peor, para aislar el criterio c.
  const flojo = curva(199, 0.01, 0.0099);
  const peores = { btc: curva(199, 0.01, 0.0102), 'cesta-cripto': curva(199, 0.01, 0.0105), 'sin-comite': curva(199, 0.01, 0.0101) };
  const rojo = evaluarPasoAReal(base({ curvaDiaria: flojo, curvasSombra: peores }));
  assert.equal(crit(rojo, 'c').ok, false);
  assert.ok(crit(rojo, 'c').valor < 0.7 && crit(rojo, 'c').valor > 0, String(crit(rojo, 'c').valor));
  assert.equal(crit(rojo, 'd').ok, true, 'd se mide aparte: sigue batiendo a comprar y mantener');
  cerca(crit(rojo, 'c').valor, sharpeAMano(flojo), 1e-3);
  // 29 retornos: sin cifra y en rojo, con cuántos días faltan.
  const corto = crit(evaluarPasoAReal(base({ curvaDiaria: curva(29, 0.004, 0.002) })), 'c');
  assert.equal(corto.valor, null);
  assert.equal(corto.ok, false);
  assert.equal(corto.valorTexto, '—');
  assert.match(corto.detalle, /Hacen falta 30 días de curva; faltan 1\./);
  assert.notEqual(crit(evaluarPasoAReal(base({ curvaDiaria: curva(30, 0.004, 0.002) })), 'c').valor, null);
});

test('c) la penalización de papel cuenta: muchas operaciones grandes bajan el Sharpe', () => {
  const grandes = Array.from({ length: 150 }, (_, k) => operacion(k, { entradaPrecio: 100000, salidaPrecio: 100000, cantidad: 0.5, pnl: 0 }));
  const sin = crit(evaluarPasoAReal(base()), 'c').valor;
  const con = crit(evaluarPasoAReal(base({ operaciones: grandes })), 'c').valor;
  assert.ok(con < sin, `${con} < ${sin}`);
});

test('d) frente a comprar y mantener: bate al mejor en verde; pierde contra uno, en rojo; con claves cuenta SPY', () => {
  const r = crit(evaluarPasoAReal(base()), 'd');
  assert.equal(r.ok, true);
  const mejor = Math.max(sharpeAMano(base().curvasSombra.btc), sharpeAMano(base().curvasSombra['cesta-cripto']));
  cerca(r.umbral, mejor, 1e-9);
  assert.match(r.detalle, /^Sharpe en el mismo periodo: BTC [\d,−-]+, cesta cripto [\d,−-]+\.$/);
  // La cesta con Sharpe ~12,7 (+0,5 % / −0,1 %): el fondo (~6) no la bate.
  const fuerte = { ...base().curvasSombra, 'cesta-cripto': curva(199, 0.005, 0.001) };
  const rojo = crit(evaluarPasoAReal(base({ curvasSombra: fuerte })), 'd');
  assert.equal(rojo.ok, false);
  assert.match(rojo.umbralTexto, /\(cesta cripto\)$/);
  // Con claves de Alpaca, SPY también: sin su curva no se puede afirmar.
  const conClaves = crit(evaluarPasoAReal(base({ hayAlpaca: true })), 'd');
  assert.equal(conClaves.ok, false);
  assert.equal(conClaves.umbral, null);
  assert.match(conClaves.detalle, /SPY —/);
  const conSpy = crit(evaluarPasoAReal(base({ hayAlpaca: true, curvasSombra: { ...base().curvasSombra, spy: curva(199, 0.002, 0.0015) } })), 'd');
  assert.equal(conSpy.ok, true);
  assert.match(conSpy.detalle, /SPY/);
  // Si el fondo no tiene cifra (menos de 30 días), no bate a nadie.
  assert.equal(crit(evaluarPasoAReal(base({ curvaDiaria: curva(10, 0.004, 0.002) })), 'd').ok, false);
});

test('e) caída máxima: 20 % en verde; la vista latido a latido (21 %) o la de la curva (25 %), en rojo', () => {
  const justo = crit(evaluarPasoAReal(base({ caidaMaximaVista: 0.20 })), 'e');
  assert.equal(justo.ok, true);
  assert.equal(justo.valorTexto, '20,0 %');
  assert.equal(justo.umbralTexto, '≤ 20 %');
  const vista = crit(evaluarPasoAReal(base({ caidaMaximaVista: 0.21 })), 'e');
  assert.equal(vista.ok, false);
  cerca(vista.valor, 0.21);
  // La curva diaria cae un 25 % aunque la vista diga menos: manda la peor.
  const c = curva(199, 0.004, 0.002);
  for (let i = 100; i < 110; i++) c[i].valor *= 0.75;
  const r = crit(evaluarPasoAReal(base({ curvaDiaria: c, caidaMaximaVista: 0.02 })), 'e');
  assert.equal(r.ok, false);
  assert.ok(r.valor >= 0.25 - 1e-9, String(r.valor));
});

test('f) incidentes: ninguno en 90 días con el registro cubriéndolos, verde; uno reciente o un registro nuevo, rojo', () => {
  const verde = crit(evaluarPasoAReal(base()), 'f');
  assert.equal(verde.ok, true);
  assert.equal(verde.valorTexto, '0');
  assert.equal(verde.umbralTexto, '0 en 90 días');
  // Uno de hace 91 días ya no cuenta.
  const viejo = [{ t: T0 + 109 * DIA, tipo: 'kill', detalle: 'Caída desde el máximo -25,00 %' }];
  assert.equal(crit(evaluarPasoAReal(base({ incidentes: viejo })), 'f').ok, true);
  // Uno de hace 10 días, sí.
  const reciente = [{ t: T0 + 190 * DIA, tipo: 'error_departamento', detalle: 'Error en mesas: x' }, { t: T0 + 195 * DIA, tipo: 'kill', detalle: 'kill switch manual desde el panel' }];
  const rojo = crit(evaluarPasoAReal(base({ incidentes: reciente })), 'f');
  assert.equal(rojo.ok, false);
  assert.equal(rojo.valor, 2);
  assert.match(rojo.detalle, /1 error en un departamento, 1 kill switch\. El último, el 2027-04-14: kill switch manual desde el panel/);
  // Registro que empezó hace 30 días: cero incidentes, pero no cubre los 90.
  const nuevo = crit(evaluarPasoAReal(base({ incidentesDesde: T0 + 170 * DIA })), 'f');
  assert.equal(nuevo.ok, false);
  assert.equal(nuevo.valorTexto, '0 en 30 días');
  assert.match(nuevo.detalle, /cubre 30 de 90 días/);
  // Justo 90 días de registro: vale.
  assert.equal(crit(evaluarPasoAReal(base({ incidentesDesde: T0 + 110 * DIA })), 'f').ok, true);
});

test('g) coste del LLM: por debajo del 10 % del beneficio, verde; 10 % o más, rojo; sin beneficio solo pasa con coste 0', () => {
  const verde = crit(evaluarPasoAReal(base()), 'g');
  assert.equal(verde.ok, true);
  cerca(verde.valor, 50 / 20000);
  assert.equal(verde.valorTexto, '0,3 % (50,00 $)');
  assert.equal(verde.umbralTexto, '< 10 % del beneficio');
  const diez = crit(evaluarPasoAReal(base({ costeLLMUsd: 2000 })), 'g');
  assert.equal(diez.ok, false, 'el 10 % justo no es «menos del 10 %»');
  assert.equal(crit(evaluarPasoAReal(base({ costeLLMUsd: 1999 })), 'g').ok, true);
  const pierde = crit(evaluarPasoAReal(base({ patrimonio: 99000, costeLLMUsd: 0.5 })), 'g');
  assert.equal(pierde.ok, false);
  assert.equal(pierde.valor, null);
  assert.match(pierde.detalle, /El fondo no gana \(-1\.000 \$\): cualquier gasto en IA \(0,50 \$\) es demasiado\./);
  const sinIA = crit(evaluarPasoAReal(base({ patrimonio: 99000, costeLLMUsd: 0 })), 'g');
  assert.equal(sinIA.ok, true);
  assert.match(sinIA.detalle, /sin gasto en IA, no bloquea/);
});

test('comité (informativo, no bloquea): si no bate a «mismas mesas sin comité», recomienda real sin comité', () => {
  const bate = evaluarPasoAReal(base());
  assert.equal(bate.comite.bate, true);
  assert.match(bate.comite.texto, /^El comité aporta: Sharpe del fondo/);
  const sinComiteMejor = { ...base().curvasSombra, 'sin-comite': curva(199, 0.005, 0.0015) };
  const r = evaluarPasoAReal(base({ curvasSombra: sinComiteMejor }));
  assert.equal(r.comite.bate, false);
  assert.match(r.comite.texto, /no bate a «mismas mesas sin comité».*si se pasa a real, que sea sin comité \(LLM apagado\)\.$/);
  assert.equal(r.listo, true, 'no bloquea: los siete criterios siguen en verde');
  const sinDatos = evaluarPasoAReal(base({ curvasSombra: { btc: base().curvasSombra.btc, 'cesta-cripto': base().curvasSombra['cesta-cripto'] } }));
  assert.equal(sinDatos.comite.bate, null);
  assert.match(sinDatos.comite.texto, /Aún sin datos/);
});

test('un fondo recién arrancado: nada listo y ninguna cifra inventada', () => {
  const r = evaluarPasoAReal({ ahora: T0, creado: T0, capitalInicial: 100000, patrimonio: 100000, incidentesDesde: T0 });
  assert.equal(r.listo, false);
  assert.deepEqual(r.criterios.map(c => c.ok), [false, false, false, false, true, false, true]);
  assert.equal(crit(r, 'c').valor, null);
  assert.equal(crit(r, 'd').valor, null);
  for (const c of r.criterios) assert.doesNotMatch(`${c.valorTexto} ${c.umbralTexto} ${c.detalle}`, /NaN|undefined|null/);
});
