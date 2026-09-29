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
  assert.equal(r.leccion, 'SOL tocó el stop en 2 velas y perdió -45,20 $.');
  assert.ok(r.leccion.length <= 140);
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
  assert.deepEqual(r[0], { operacionId: 'op-1', mesaId: 'tendencia', simbolo: 'SOL/USD', categoria: 'noticia', leccion: 'SOL perdió 45,20 $ tras un titular.', fuente: 'llm' });
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
