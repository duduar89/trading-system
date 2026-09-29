'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../src/agentes/megafono');
const { crearLLM } = require('../src/agentes/llm');
const { HORA } = require('../src/util/reloj');
const { mensaje, fetchFalso, relojFijo } = require('./agentes-ayuda');

const UNIVERSO = [
  { simbolo: 'BTC/USD', etiqueta: 'BTC', clase: 'cripto', nombre: 'Bitcoin' },
  { simbolo: 'ETH/USD', etiqueta: 'ETH', clase: 'cripto', nombre: 'Ethereum' },
  { simbolo: 'SOL/USD', etiqueta: 'SOL', clase: 'cripto', nombre: 'Solana' },
  { simbolo: 'LINK/USD', etiqueta: 'LINK', clase: 'cripto', nombre: 'Chainlink' },
  { simbolo: 'DOGE/USD', etiqueta: 'DOGE', clase: 'cripto', nombre: 'Dogecoin' },
];
const MESAS = [
  { id: 'tendencia', nombre: 'Tendencia SMA' },
  { id: 'momentum', nombre: 'Momentum cripto' },
  { id: 'momentum-etf', nombre: 'Momentum ETF' },
  { id: 'reversion', nombre: 'Reversión RSI' },
];
const CTX = { universo: UNIVERSO, mesas: MESAS };
const T0 = Date.UTC(2026, 8, 29, 12, 0, 0);

async function pc(texto, extra = {}) {
  return m.interpretar(texto, { ...CTX, ...extra });
}

test('palabras clave: cada verbo del contrato con su directiva', async () => {
  const casos = [
    ['pausa SOL 24 h', [{ tipo: 'pausar_activo', simbolo: 'SOL/USD', horas: 24 }]],
    ['Para todo', [{ tipo: 'solo_cerrar', horas: 4 }]],
    ['para DOGE 2 horas', [{ tipo: 'pausar_activo', simbolo: 'DOGE/USD', horas: 2 }]],
    ['reduce el riesgo a la mitad durante 12 horas', [{ tipo: 'reducir_riesgo', factor: 0.5, horas: 12 }]],
    ['baja el riesgo un 25 %', [{ tipo: 'reducir_riesgo', factor: 0.75, horas: 4 }]],
    ['solo cerrar hasta mañana', [{ tipo: 'solo_cerrar', horas: 24 }]],
    ['no abras nada en 3 días', [{ tipo: 'solo_cerrar', horas: 72 }]],
    ['reanuda SOL', [{ tipo: 'reanudar_activo', simbolo: 'SOL/USD' }]],
    ['pausa la mesa momentum etf y la de reversión', [
      { tipo: 'pausar_mesa', mesaId: 'momentum-etf', horas: 4 }, { tipo: 'pausar_mesa', mesaId: 'reversion', horas: 4 }]],
    ['pausa la mesa de momentum y reanuda ETH', [
      { tipo: 'pausar_mesa', mesaId: 'momentum', horas: 4 }, { tipo: 'reanudar_activo', simbolo: 'ETH/USD' }]],
    ['pausa Solana', [{ tipo: 'pausar_activo', simbolo: 'SOL/USD', horas: 4 }]],
  ];
  for (const [texto, esperado] of casos) {
    const r = await pc(texto);
    assert.equal(r.fuente, 'palabras_clave', texto);
    assert.deepEqual(r.directivas, esperado, texto);
    assert.match(r.explicacion, /^He entendido: /, texto);
  }
});

test('palabras clave: ajustes a la lista cerrada y lo que no se entiende', async () => {
  // «al 40 %» no existe: se redondea hacia lo más prudente (0,25) y se avisa.
  const r1 = await pc('reduce al 40 %');
  assert.deepEqual(r1.directivas, [{ tipo: 'reducir_riesgo', factor: 0.25, horas: 4 }]);
  assert.match(r1.explicacion, /ajustado a 0,25/);
  // 100 h → 72 h (máximo) y se avisa.
  const r2 = await pc('pausa DOGE y LINK 100 horas');
  assert.deepEqual(r2.directivas, [{ tipo: 'pausar_activo', simbolo: 'DOGE/USD', horas: 72 }, { tipo: 'pausar_activo', simbolo: 'LINK/USD', horas: 72 }]);
  assert.match(r2.explicacion, /72 h/);
  // Subir el riesgo no existe en la lista.
  const r3 = await pc('compra más BTC');
  assert.equal(r3.directivas.length, 1);
  assert.equal(r3.directivas[0].tipo, 'sin_efecto');
  // «al 100 %» no aprieta nada.
  const r4 = await pc('sube el riesgo al 100 %');
  assert.equal(r4.directivas[0].tipo, 'sin_efecto');
  // «para» como preposición no es una orden de parar.
  const r5 = await pc('reduce el riesgo para SOL');
  assert.deepEqual(r5.directivas, [{ tipo: 'reducir_riesgo', factor: 0.5, horas: 4 }]);
});

test('reanudar solo deshace un apretón previo del Megáfono', async () => {
  const sinPausa = m.directivasVacias();
  const r = await pc('reanuda SOL', { directivas: sinPausa, ahora: T0 });
  assert.equal(r.directivas[0].tipo, 'sin_efecto');
  assert.match(r.explicacion, /No hay ninguna pausa del Megáfono sobre SOL/);

  const conPausa = m.aplicarDirectiva(sinPausa, { tipo: 'pausar_activo', simbolo: 'SOL/USD', horas: 24 }, T0);
  const r2 = await pc('reanuda SOL', { directivas: conPausa, ahora: T0 + HORA });
  assert.deepEqual(r2.directivas, [{ tipo: 'reanudar_activo', simbolo: 'SOL/USD' }]);
  // Un veto del comité (origen distinto) no se puede deshacer desde aquí.
  const vetoComite = { ...sinPausa, activosVetados: [{ simbolo: 'SOL/USD', hasta: T0 + 24 * HORA, motivo: 'comité' }] };
  assert.equal(m.validarDirectiva({ tipo: 'reanudar_activo', simbolo: 'SOL' }, { ...CTX, directivas: vetoComite, ahora: T0 }).ok, false);
});

test('validarDirectiva: rangos, lista cerrada y normalización', () => {
  const v = d => m.validarDirectiva(d, CTX);
  assert.deepEqual(v({ tipo: 'reducir_riesgo', factor: 0.5, horas: 12, sobra: 1 }).directiva, { tipo: 'reducir_riesgo', factor: 0.5, horas: 12 });
  assert.equal(v({ tipo: 'reducir_riesgo', factor: 0.3, horas: 12 }).ok, false);
  assert.equal(v({ tipo: 'reducir_riesgo', factor: 1.5, horas: 12 }).ok, false);
  assert.equal(v({ tipo: 'solo_cerrar', horas: 0 }).ok, false);
  assert.equal(v({ tipo: 'solo_cerrar', horas: 73 }).ok, false);
  assert.equal(v({ tipo: 'solo_cerrar', horas: 1.5 }).ok, false);
  assert.equal(v({ tipo: 'solo_cerrar', horas: 72 }).ok, true);
  assert.deepEqual(v({ tipo: 'pausar_activo', simbolo: 'sol', horas: 1 }).directiva, { tipo: 'pausar_activo', simbolo: 'SOL/USD', horas: 1 });
  assert.equal(v({ tipo: 'pausar_activo', simbolo: 'XRP', horas: 1 }).ok, false);
  assert.deepEqual(v({ tipo: 'pausar_mesa', mesaId: 'Tendencia SMA', horas: 3 }).directiva, { tipo: 'pausar_mesa', mesaId: 'tendencia', horas: 3 });
  assert.equal(v({ tipo: 'pausar_mesa', mesaId: 'inventada', horas: 3 }).ok, false);
  assert.equal(v({ tipo: 'subir_riesgo', factor: 2 }).ok, false);
  assert.equal(v(null).ok, false);
});

test('aplicarDirectiva: solo aprieta, no muta la entrada y todo caduca', () => {
  let d = m.directivasVacias();
  const original = JSON.stringify(d);
  d = m.aplicarDirectiva(d, { tipo: 'reducir_riesgo', factor: 0.25, horas: 12 }, T0);
  assert.equal(JSON.stringify(m.directivasVacias()), original);
  assert.deepEqual(d.reduccion, { factor: 0.25, hasta: T0 + 12 * HORA, origen: 'megafono' });
  // Una reducción más floja no afloja la vigente.
  d = m.aplicarDirectiva(d, { tipo: 'reducir_riesgo', factor: 0.75, horas: 48 }, T0 + HORA);
  assert.deepEqual(d.reduccion, { factor: 0.25, hasta: T0 + 12 * HORA, origen: 'megafono' });
  // Pausa: una segunda más corta no acorta; una más larga alarga.
  d = m.aplicarDirectiva(d, { tipo: 'pausar_activo', simbolo: 'SOL/USD', horas: 24 }, T0);
  d = m.aplicarDirectiva(d, { tipo: 'pausar_activo', simbolo: 'SOL/USD', horas: 2 }, T0);
  assert.deepEqual(d.activosVetados, [{ simbolo: 'SOL/USD', hasta: T0 + 24 * HORA, motivo: 'Megáfono', origen: 'megafono' }]);
  d = m.aplicarDirectiva(d, { tipo: 'pausar_activo', simbolo: 'SOL/USD', horas: 48 }, T0);
  assert.equal(d.activosVetados[0].hasta, T0 + 48 * HORA);
  d = m.aplicarDirectiva(d, { tipo: 'pausar_mesa', mesaId: 'tendencia', horas: 6 }, T0);
  d = m.aplicarDirectiva(d, { tipo: 'solo_cerrar', horas: 8 }, T0);
  d = m.aplicarDirectiva(d, { tipo: 'solo_cerrar', horas: 2 }, T0);
  assert.equal(d.soloCerrarHasta, T0 + 8 * HORA);
  // Caducidad: a las 10 h solo quedan la reducción (12 h) y la pausa de SOL (48 h).
  const v10 = m.directivasVigentes(d, T0 + 10 * HORA);
  assert.equal(v10.soloCerrarHasta, null);
  assert.deepEqual(v10.mesasPausadas, []);
  assert.equal(v10.reduccion.factor, 0.25);
  assert.equal(v10.activosVetados.length, 1);
  const v50 = m.directivasVigentes(d, T0 + 50 * HORA);
  assert.equal(v50.reduccion, null);
  assert.deepEqual(v50.activosVetados, []);
  // Reanudar quita solo lo del Megáfono.
  const conComite = { ...d, activosVetados: [...d.activosVetados, { simbolo: 'ETH/USD', hasta: T0 + 24 * HORA, motivo: 'comité' }] };
  const tras = m.aplicarDirectiva(conComite, { tipo: 'reanudar_activo', simbolo: 'SOL/USD' }, T0);
  assert.deepEqual(tras.activosVetados.map(x => x.simbolo), ['ETH/USD']);
  // modo y multiplicadores del comité se conservan.
  const conModo = m.aplicarDirectiva({ ...m.directivasVacias(), modo: 'DEFENSIVO', multiplicadores: { tendencia: 0.5 } }, { tipo: 'solo_cerrar', horas: 1 }, T0);
  assert.equal(conModo.modo, 'DEFENSIVO');
  assert.deepEqual(conModo.multiplicadores, { tendencia: 0.5 });
});

test('con LLM: valida sus directivas y descarta las que se salen de rango', async () => {
  const llm = {
    activo: true,
    async pedirJSON(p) {
      assert.equal(p.proposito, 'megafono');
      assert.deepEqual(p.esquema.properties.directivas.items.properties.tipo.enum, [...m.TIPOS]);
      return {
        ok: true,
        costeUsd: 0.001,
        datos: {
          directivas: [
            { tipo: 'pausar_activo', factor: null, horas: 24, simbolo: 'SOL', mesaId: null, motivo: null },
            { tipo: 'solo_cerrar', factor: null, horas: 500, simbolo: null, mesaId: null, motivo: null },
          ],
          explicacion: 'Pauso SOL 24 h.',
        },
      };
    },
  };
  const r = await m.interpretar('no quiero ver SOL en todo el día', { ...CTX, llm });
  assert.equal(r.fuente, 'llm');
  assert.deepEqual(r.directivas, [{ tipo: 'pausar_activo', simbolo: 'SOL/USD', horas: 24 }]);
  // Hubo una directiva descartada: la explicación sale de la plantilla y lo dice.
  assert.match(r.explicacion, /Las horas deben ser un entero/);
});

test('con LLM: explicación con cifra inventada → plantilla; LLM caído → palabras clave', async () => {
  const llmInventa = {
    activo: true,
    pedirJSON: async () => ({
      ok: true, costeUsd: 0,
      datos: { directivas: [{ tipo: 'pausar_activo', factor: null, horas: 24, simbolo: 'SOL', mesaId: null, motivo: null }], explicacion: 'Pauso SOL 24 h para ahorrar 1.500 $.' },
    }),
  };
  const r = await m.interpretar('pausa SOL un día', { ...CTX, llm: llmInventa });
  assert.equal(r.explicacion, 'He entendido: no abrir en SOL durante 24 h.');

  const llmCaido = { activo: true, pedirJSON: async () => ({ ok: false, motivo: 'presupuesto', detalle: 'x' }) };
  const r2 = await m.interpretar('pausa SOL 24 h', { ...CTX, llm: llmCaido });
  assert.equal(r2.fuente, 'palabras_clave');
  assert.deepEqual(r2.directivas, [{ tipo: 'pausar_activo', simbolo: 'SOL/USD', horas: 24 }]);
});

test('con el cliente LLM real y fetch falso: el esquema enviado es aceptable para la API', async () => {
  const respuesta = { directivas: [{ tipo: 'reducir_riesgo', factor: 0.5, horas: 6, simbolo: null, mesaId: null, motivo: null }], explicacion: 'Reduzco a la mitad 6 h.' };
  const fetch = fetchFalso(mensaje({ texto: JSON.stringify(respuesta) }));
  const llm = crearLLM({ apiKey: 'sk-prueba', fetch, reloj: relojFijo(T0) });
  const r = await m.interpretar('baja el riesgo a la mitad 6 horas', { ...CTX, llm });
  assert.equal(r.fuente, 'llm');
  assert.deepEqual(r.directivas, [{ tipo: 'reducir_riesgo', factor: 0.5, horas: 6 }]);
  const enviado = fetch.llamadas[0].cuerpo.output_config.format.schema;
  // Sin palabras que la API no admite y con additionalProperties: false en cada objeto.
  assert.doesNotMatch(JSON.stringify(enviado), /minimum|maximum|maxLength|minLength/);
  assert.equal(enviado.additionalProperties, false);
  assert.equal(enviado.properties.directivas.items.additionalProperties, false);
});
