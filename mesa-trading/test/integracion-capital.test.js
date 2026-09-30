'use strict';
// Capital de la cabecera (§7, cabecera.capital, 30-sep-2026): cuánto hay
// invertido y en qué, cuánto en efectivo y cuánto dejan aún los límites duros.
// Tiene que cuadrar con el bróker: Σ porTipo = invertido = Σ posiciones del
// bróker; invertido + efectivo = patrimonio; y lo disponible es exactamente
// min(efectivo, 80 % del patrimonio − exposición) y, en cripto, además 50 % −
// exposición cripto. El sintético no trae acciones: se añaden ETF a la fuente
// (como en integracion-bolsa) con la bolsa abierta el miércoles 3-jun-2026.

const test = require('node:test');
const assert = require('node:assert/strict');
const { crearOrquestador } = require('./integracion-ayuda');
const universo = require('../src/mercado/universo');

const MIE_APERTURA = Date.UTC(2026, 5, 3, 13, 40);   // 9:40 ET
const cerca = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} frente a ${b}`);

async function montar({ etf = false } = {}) {
  const piezas = await crearOrquestador({});
  const { orquestador: o, reloj, datos } = piezas;
  const px = { SPY: 500, QQQ: 400, TLT: 90, GLD: 200 };
  if (etf) {
    const ultimos = datos.ultimos.bind(datos);
    datos.ultimos = async s => ({
      ...(await ultimos(s.filter(x => !(x in px)))),
      ...Object.fromEntries(s.filter(x => x in px).map(x => [x, { precio: px[x], t: reloj.ahora() }])),
    });
    const mesa = (id, nombre, familia, uni) => ({
      id, nombre, familia, marco: '1Day', universo: uni, params: {}, filtros: [], estado: 'incubacion', peso: 0.02,
      fechaAlta: reloj.ahora(), capitalBase: 2000, flujoPendiente: 0, curvaDiaria: [], metricas: null, backtest: null,
    });
    o.agregarMesa(mesa('momentum-etf', 'Momentum ETF', 'momentum-rotacion', ['SPY', 'QQQ', 'TLT', 'GLD']));
  }
  const irA = async (t) => {
    reloj.fijar(t);
    await o._actualizarPrecios(t);
    if (etf) for (const s of Object.keys(px)) o.vivo.precios[s] = { precio: px[s], t };
    o.vivo.mercadoAbierto = { accion: true };
    await o.refrescarCartera();
  };
  let n = 0;
  const comprar = async (simbolo, nocional) => {
    const r = await piezas.broker.enviarOrden({ idCliente: `prueba-capital-${++n}`, simbolo, lado: 'compra', nocional });
    assert.equal(r.estado, 'ejecutada', `compra de ${simbolo}`);
  };
  return { ...piezas, px, irA, comprar };
}

async function cuadra(o, broker) {
  const cap = o.instantanea().cabecera.capital;
  const cuenta = await broker.cuenta();
  const posiciones = await broker.posiciones();
  const enBroker = posiciones.reduce((s, p) => s + Math.abs(p.valor), 0);
  cerca(cap.patrimonio, cuenta.patrimonio, 'patrimonio = el del bróker');
  cerca(cap.efectivo, cuenta.efectivo, 'efectivo = el del bróker');
  cerca(cap.invertido, enBroker, 'invertido = Σ posiciones del bróker');
  cerca(cap.invertido + cap.efectivo, cap.patrimonio, 'invertido + efectivo = patrimonio');
  cerca(cap.porTipo.reduce((s, t) => s + t.importe, 0), cap.invertido, 'Σ porTipo = invertido');
  for (const t of cap.porTipo) {
    cerca(t.activos.reduce((s, a) => s + a.importe, 0), t.importe, `Σ activos de ${t.tipo}`);
    cerca(t.pct, t.importe / cap.patrimonio, `pct de ${t.tipo}`);
    for (const a of t.activos) assert.equal(universo.tipoDe(a.simbolo), t.tipo, `${a.simbolo} es de ${t.tipo}`);
  }
  cerca(cap.invertidoPct, cap.invertido / cap.patrimonio, 'invertidoPct');
  const lim = o.limites;
  const bruta = o.vivo.valoracion.exposicionBruta;
  const cripto = o.vivo.valoracion.exposicionCripto;
  // Los topes son los de config.limites y lo usado, la exposición de Riesgos (§5.3).
  assert.equal(cap.limites.bruta.maximo, lim.maxExposicionBruta);
  assert.equal(cap.limites.cripto.maximo, lim.maxExposicionCripto);
  cerca(cap.limites.bruta.tope, lim.maxExposicionBruta * cap.patrimonio, 'tope bruto en $');
  cerca(cap.limites.cripto.tope, lim.maxExposicionCripto * cap.patrimonio, 'tope cripto en $');
  cerca(cap.limites.bruta.usado, bruta, 'lo usado es la exposición de Riesgos');
  cerca(cap.limites.cripto.usado, cripto, 'lo usado en cripto');
  cerca(cap.limites.bruta.queda, Math.max(0, cap.limites.bruta.tope - bruta), 'queda bruto');
  cerca(cap.limites.cripto.queda, Math.max(0, cap.limites.cripto.tope - cripto), 'queda cripto');
  cerca(cap.disponible, Math.max(0, Math.min(cap.efectivo, lim.maxExposicionBruta * cap.patrimonio - bruta)), 'disponible');
  cerca(cap.disponibleCripto, Math.max(0, Math.min(cap.disponible, lim.maxExposicionCripto * cap.patrimonio - cripto)), 'disponible en cripto');
  assert.equal(cap.patrimonio, o.instantanea().cabecera.patrimonio, 'el mismo patrimonio que la cabecera');
  return cap;
}

test('sin nada invertido: todo es efectivo y el tope es el 80 % (50 % en cripto); salen los tipos con mesa', async () => {
  const { orquestador: o, broker } = await montar();
  await o.refrescarCartera();
  const cap = await cuadra(o, broker);
  assert.equal(cap.invertido, 0);
  cerca(cap.disponible, 0.8 * cap.patrimonio, 'el 80 % del patrimonio');
  cerca(cap.disponibleCripto, 0.5 * cap.patrimonio, 'el 50 % en cripto');
  // Sintético: solo mesas de cripto.
  assert.deepEqual(cap.porTipo.map(t => t.tipo), ['cripto']);
  assert.equal(cap.porTipo[0].importe, 0);
  assert.deepEqual(cap.porTipo[0].mesas.sort(), o.estado.mesas.filter(m => m.estado !== 'banquillo').map(m => m.id).sort());
});

test('con cripto y ETF: cuadra con el bróker, desglose por tipo en su orden y los tipos sin nada pero con mesa, a 0', async () => {
  const { orquestador: o, broker, irA, comprar } = await montar({ etf: true });
  await irA(MIE_APERTURA);
  await comprar('BTC/USD', 12000);
  await comprar('ETH/USD', 6000);
  await comprar('SPY', 5000);
  await comprar('TLT', 3000);
  await irA(MIE_APERTURA + 60_000);
  const cap = await cuadra(o, broker);
  assert.deepEqual(cap.porTipo.map(t => t.tipo), ['cripto', 'indices', 'bonos', 'materias'], 'Acciones no sale: nadie la opera ni hay nada');
  const de = id => cap.porTipo.find(t => t.tipo === id);
  assert.deepEqual(de('cripto').activos.map(a => a.etiqueta), ['BTC', 'ETH'], 'de mayor a menor');
  assert.deepEqual(de('indices').activos.map(a => a.etiqueta), ['SPY']);
  assert.equal(de('materias').importe, 0, 'GLD: la mesa lo opera pero no hay nada');
  assert.deepEqual(de('materias').mesas, ['momentum-etf']);
  assert.equal(de('indices').nombre, 'Índices');
  assert.equal(de('materias').nombre, 'Materias primas');
});

test('lo disponible lo marcan los topes de verdad: cripto por encima del 50 % deja 0 en cripto y el resto hasta el 80 %', async () => {
  const { orquestador: o, broker, irA, comprar } = await montar({ etf: true });
  await irA(MIE_APERTURA);
  // Posiciones del bróker sin puesto (huérfanas): cuentan igual para los topes (§5.3).
  await comprar('BTC/USD', 30000);
  await comprar('ETH/USD', 25000);
  await irA(MIE_APERTURA + 60_000);
  const cap = await cuadra(o, broker);
  assert.equal(cap.disponibleCripto, 0, 'más del 50 % en cripto: nada más en cripto');
  assert.ok(cap.disponible > 20000 && cap.disponible < 30000, `queda hasta el 80 %: ${cap.disponible}`);
  await comprar('SPY', 24000);
  await irA(MIE_APERTURA + 120_000);
  const cap2 = await cuadra(o, broker);
  assert.ok(cap2.disponible < 2000, `casi en el 80 %: ${cap2.disponible}`);
});

test('el efectivo también limita: con poco efectivo, lo disponible es el efectivo', async () => {
  const { orquestador: o, irA, broker } = await montar({ etf: true });
  await irA(MIE_APERTURA);
  // En marcha Riesgos no deja pasar del 80 %, así que el efectivo solo manda
  // si la cuenta del bróker dice menos (dinero retenido, una orden a medias):
  // se prueba la regla con una cuenta de 5.000 $ de efectivo.
  const cuenta = broker.cuenta.bind(broker);
  broker.cuenta = async () => ({ ...(await cuenta()), efectivo: 5000 });
  await o.refrescarCartera();
  const cap = o.instantanea().cabecera.capital;
  assert.equal(cap.efectivo, 5000);
  assert.equal(cap.disponible, 5000);
  assert.equal(cap.disponibleCripto, 5000);
});
