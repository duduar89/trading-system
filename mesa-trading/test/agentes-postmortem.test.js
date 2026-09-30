'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const pm = require('../src/agentes/postmortem');
const { crearLLM } = require('../src/agentes/llm');
const { mensaje, fetchFalso, relojFijo } = require('./agentes-ayuda');

// Operación base (forma de §5.1); cada caso cambia lo que la regla mira.
const base = {
  id: 'op-1', puestoId: 'tendencia-SOL', mesaId: 'tendencia', simbolo: 'SOL/USD',
  entradaT: 0, entradaPrecio: 150, salidaT: 1, salidaPrecio: 145, cantidad: 9, pnl: -45.2, pnlPct: -0.0333,
  comisiones: 3.4, motivoSalida: 'señal', barras: 6, rMultiple: -0.8, regimenEntrada: 'NEUTRAL', deslizamiento: 0.001,
};
const op = cambios => ({ ...base, ...cambios });

test('CATEGORIAS exactamente como §6.6', () => {
  assert.deepEqual([...pm.CATEGORIAS], ['señal_falsa', 'stop_estrecho', 'contra_regimen', 'noticia', 'ejecucion', 'acierto_de_libro', 'suerte']);
});

test('reglas fijas: una operación por rama, en el orden del contrato', () => {
  const c = o => pm.clasificarReglas(o).categoria;
  assert.equal(c(op({ pnl: 120, motivoSalida: 'señal' })), 'acierto_de_libro');
  assert.equal(c(op({ pnl: 120, motivoSalida: 'stop' })), 'acierto_de_libro');   // trailing: salida por regla
  assert.equal(c(op({ pnl: 120, motivoSalida: 'kill' })), 'suerte');
  assert.equal(c(op({ pnl: 120, motivoSalida: 'riesgo' })), 'suerte');
  // Perdedora en RISK-OFF gana a todo lo demás aunque también saltara el stop enseguida.
  assert.equal(c(op({ regimenEntrada: 'RISK-OFF', motivoSalida: 'stop', barras: 1 })), 'contra_regimen');
  assert.equal(c(op({ motivoSalida: 'stop', barras: 2 })), 'stop_estrecho');
  assert.equal(c(op({ motivoSalida: 'stop', barras: 3 })), 'señal_falsa');
  // 0,6 % de deslizamiento > 0,5 %; 0,5 % justo no cuenta.
  assert.equal(c(op({ deslizamiento: 0.006 })), 'ejecucion');
  assert.equal(c(op({ deslizamiento: 0.005 })), 'señal_falsa');
  assert.equal(c(op({})), 'señal_falsa');
  // pnl 0 cuenta como perdedora (las comisiones ya van dentro).
  assert.equal(c(op({ pnl: 0 })), 'señal_falsa');
});

test('la lección de las reglas lleva cifras de la operación y pasa su propia comprobación', () => {
  const r = pm.clasificarReglas(op({ motivoSalida: 'stop', barras: 2 }));
  assert.equal(r.leccion, 'SOL tocó el stop en 2 velas y perdió 45,20 $.');
  assert.ok(r.leccion.length <= 140);
});

test('lecciones por reglas: «perdió»/«ganó» con el importe sin signo, sin doble negativo', () => {
  const l = cambios => pm.clasificarReglas(op(cambios)).leccion;
  assert.equal(l({ pnl: -1234.5 }), 'SOL perdió 1.235 $: la señal no se confirmó.');
  assert.equal(l({ regimenEntrada: 'RISK-OFF' }), 'SOL entró en RISK-OFF y perdió 45,20 $.');
  assert.equal(l({ deslizamiento: 0.006 }), 'SOL perdió 45,20 $ con 0,60 % de deslizamiento en contra.');
  assert.equal(l({ pnl: 120, motivoSalida: 'kill' }), 'SOL ganó 120,00 $ pero salió por kill, no por su regla.');
  // La frase neutra sí lleva el signo.
  assert.equal(l({ pnl: 120 }), 'SOL salió por regla con +120,00 $: la regla funcionó como estaba escrita.');
  assert.equal(l({ pnl: null }), 'SOL perdió —: la señal no se confirmó.');
  for (const pnl of [-45.2, -1234.5, 0]) assert.doesNotMatch(l({ pnl }), /perdió -/);
});

test('lote sin LLM: todo por reglas y [] si no hay operaciones', async () => {
  assert.deepEqual(await pm.lote({ operaciones: [], llm: null }), []);
  const r = await pm.lote({ operaciones: [op({}), op({ id: 'op-2', pnl: 50 })], llm: { activo: false } });
  assert.deepEqual(r.map(x => [x.operacionId, x.categoria, x.fuente, x.mesaId]),
    [['op-1', 'señal_falsa', 'reglas', 'tendencia'], ['op-2', 'acierto_de_libro', 'reglas', 'tendencia']]);
});

test('lote con LLM: enum de categorías, una llamada, lección comprobada contra su operación', async () => {
  const ops = [
    op({ id: 'op-1' }),
    op({ id: 'op-2', motivoSalida: 'stop', barras: 1, pnl: -30 }),
    op({ id: 'op-3', pnl: 80, pnlPct: 0.059 }),
  ];
  let llamadas = 0;
  const llm = {
    activo: true,
    async pedirJSON(p) {
      llamadas++;
      assert.equal(p.proposito, 'postmortem');
      const items = p.esquema.properties.clasificaciones.items.properties;
      assert.deepEqual(items.categoria.enum, [...pm.CATEGORIAS]);
      assert.deepEqual(items.operacionId.enum, ['op-1', 'op-2', 'op-3']);
      assert.equal(p.entrada.operaciones[1].categoriaPorReglas, 'stop_estrecho');
      return {
        ok: true,
        costeUsd: 0.002,
        datos: {
          clasificaciones: [
            { operacionId: 'op-1', categoria: 'noticia', leccion: 'SOL perdió 45,20 $ tras un titular.' },            // cifra buena
            { operacionId: 'op-2', categoria: 'stop_estrecho', leccion: 'El stop estaba a 3,1 % y saltó en 1 vela.' }, // 3,1 % inventado
            // op-3 no viene: va por reglas
          ],
        },
      };
    },
  };
  const r = await pm.lote({ operaciones: ops, llm });
  assert.equal(llamadas, 1);
  assert.deepEqual(r[0], { operacionId: 'op-1', mesaId: 'tendencia', simbolo: 'SOL/USD', motivoSalida: 'señal', categoria: 'noticia', leccion: 'SOL perdió 45,20 $ tras un titular.', fuente: 'llm' });
  assert.equal(r[1].fuente, 'reglas');
  assert.equal(r[1].categoria, 'stop_estrecho');
  assert.equal(r[2].fuente, 'reglas');
  assert.equal(r[2].categoria, 'acierto_de_libro');
});

test('lote con el cliente LLM real y fetch falso; si el LLM falla, todo por reglas', async () => {
  const ok = { clasificaciones: [{ operacionId: 'op-1', categoria: 'señal_falsa', leccion: 'SOL entró a 150 y salió a 145.' }] };
  const fetch = fetchFalso(mensaje({ texto: JSON.stringify(ok) }));
  const llm = crearLLM({ apiKey: 'sk-prueba', fetch, reloj: relojFijo(Date.UTC(2026, 8, 29)) });
  const r = await pm.lote({ operaciones: [op({})], llm });
  assert.equal(r[0].fuente, 'llm');
  assert.equal(fetch.llamadas[0].cuerpo.output_config.effort, 'low');

  const malo = fetchFalso(mensaje({ texto: JSON.stringify({ clasificaciones: [{ operacionId: 'op-1', categoria: 'mala_suerte', leccion: 'x' }] }) }));
  const llm2 = crearLLM({ apiKey: 'sk-prueba', fetch: malo, reloj: relojFijo(Date.UTC(2026, 8, 29)) });
  const r2 = await pm.lote({ operaciones: [op({})], llm: llm2 });
  assert.equal(r2[0].fuente, 'reglas');   // categoría fuera del enum → esquema → reglas
});

test('hipotesisDesdeLecciones: (mesa × categoría) con n ≥ 5, sin aciertos ni suerte', () => {
  const lecciones = [
    ...Array(5).fill({ mesaId: 'tendencia', categoria: 'stop_estrecho' }),
    ...Array(4).fill({ mesaId: 'tendencia', categoria: 'contra_regimen' }),
    ...Array(7).fill({ operacion: { mesaId: 'ruptura' }, categoria: 'señal_falsa' }),
    ...Array(9).fill({ mesaId: 'momentum', categoria: 'acierto_de_libro' }),
    ...Array(6).fill({ mesaId: 'momentum', categoria: 'suerte' }),
    { mesaId: 'tendencia', categoria: 'inventada' },
  ];
  assert.deepEqual(pm.hipotesisDesdeLecciones(lecciones), [
    { mesaId: 'ruptura', categoria: 'señal_falsa', n: 7 },
    { mesaId: 'tendencia', categoria: 'stop_estrecho', n: 5 },
  ]);
  assert.deepEqual(pm.hipotesisDesdeLecciones([]), []);
});

test('lote con LLM: una perdedora no puede salir como «suerte» ni con el signo o el verbo cambiados', async () => {
  // Caso de la revisión: pnl −45,20 y el LLM escribe «ganó +45,20 $ (+1,13 %)» con categoría suerte.
  const perdedora = op({ id: 'op-1', pnl: -45.2, pnlPct: -0.0113 });
  const ganadora = op({ id: 'op-2', pnl: 45.2, pnlPct: 0.0113, motivoSalida: 'señal' });
  const respuestas = [
    { operacionId: 'op-1', categoria: 'suerte', leccion: 'SOL ganó +45,20 $ (+1,13 %) sin seguir la regla.' },
    { operacionId: 'op-2', categoria: 'señal_falsa', leccion: 'SOL perdió 45,20 $.' },
  ];
  const llm = { activo: true, pedirJSON: async () => ({ ok: true, costeUsd: 0, datos: { clasificaciones: respuestas } }) };
  const r = await pm.lote({ operaciones: [perdedora, ganadora], llm });
  assert.equal(r[0].fuente, 'reglas');
  assert.equal(r[0].categoria, 'señal_falsa');
  assert.equal(r[0].leccion, 'SOL perdió 45,20 $: la señal no se confirmó.');
  assert.equal(r[1].fuente, 'reglas');
  assert.equal(r[1].categoria, 'acierto_de_libro');

  // Categoría compatible, pero la cifra con signo cambiado o el verbo contrario: reglas.
  const casos = [
    ['señal_falsa', 'SOL cerró con +45,20 $ tras una señal falsa.'],
    ['señal_falsa', 'SOL ganó 45,20 $ con una señal falsa.'],
  ];
  for (const [categoria, leccion] of casos) {
    const llm2 = { activo: true, pedirJSON: async () => ({ ok: true, costeUsd: 0, datos: { clasificaciones: [{ operacionId: 'op-1', categoria, leccion }] } }) };
    const [x] = await pm.lote({ operaciones: [perdedora], llm: llm2 });
    assert.equal(x.fuente, 'reglas', leccion);
  }
  // Y una lección honesta de la misma perdedora sí pasa.
  const llm3 = { activo: true, pedirJSON: async () => ({ ok: true, costeUsd: 0, datos: { clasificaciones: [{ operacionId: 'op-1', categoria: 'señal_falsa', leccion: 'SOL perdió 45,20 $ (-1,13 %): la ruptura no siguió.' }] } }) };
  assert.equal((await pm.lote({ operaciones: [perdedora], llm: llm3 }))[0].fuente, 'llm');
});

test('pistas: las operaciones cerradas por kill, a mano o de prueba no cuentan', async () => {
  // lote() deja el motivo de salida en cada lección para poder apartarlas.
  const lecc = await pm.lote({ operaciones: [op({ id: 'k1', motivoSalida: 'kill' })], llm: null });
  assert.equal(lecc[0].motivoSalida, 'kill');
  assert.equal(lecc[0].categoria, 'señal_falsa');
  const lecciones = [
    ...Array(6).fill({ mesaId: 'tendencia', categoria: 'señal_falsa', motivoSalida: 'kill' }),
    ...Array(5).fill({ mesaId: 'momentum', categoria: 'señal_falsa', motivoSalida: 'manual' }),
    ...Array(5).fill({ mesaId: 'ruptura', categoria: 'señal_falsa', operacion: { mesaId: 'ruptura', motivoSalida: 'prueba' } }),
    ...Array(4).fill({ mesaId: 'reversion', categoria: 'stop_estrecho', motivoSalida: 'stop' }),
    { mesaId: 'reversion', categoria: 'stop_estrecho', motivoSalida: 'kill' },
    ...Array(5).fill({ mesaId: 'reversion', categoria: 'señal_falsa', motivoSalida: 'señal' }),
  ];
  assert.deepEqual(pm.hipotesisDesdeLecciones(lecciones), [{ mesaId: 'reversion', categoria: 'señal_falsa', n: 5 }]);
});
