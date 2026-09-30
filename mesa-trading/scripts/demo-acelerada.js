'use strict';
// Demo acelerada (§9-F): el caso conocido del sistema entero.
//
//   node scripts/demo-acelerada.js [--dias=60] [--semilla=42] [--inicio=2026-06-01] [--con-llm] [--datos=carpeta]
//
// Modo sintético, sin servidor, en una carpeta temporal. Corre N días simulados
// tan rápido como puede y COMPRUEBA (sale con 1 si falla alguno):
//   - ningún límite duro violado: en cada compra, exposición bruta ≤ 80 %,
//     cripto ≤ 50 % y cada activo ≤ 10 % del patrimonio; entre compras, lo
//     mismo con la tolerancia que da el movimiento de precio desde la última
//     compra (la cantidad solo puede bajar, así que el valor está acotado por
//     tope · patrimonio en la compra · precio ahora / precio en la compra);
//   - Σ puestos no-sombra = posiciones del bróker por símbolo (1e-6 relativo);
//   - patrimonio = efectivo + Σ valor de las posiciones;
//   - hubo operaciones y hubo comités cada 4 h;
//   - tras un reinicio simulado (guardar, otro orquestador desde el mismo
//     data/) el estado se recupera igual;
//   - ninguna operación se apunta dos veces en operaciones.jsonl (mismo id y
//     misma entrada) y el bloqueo de la carpeta (.proceso) se suelta al parar;
//   - al final, un kill switch forzado lo cierra todo y deja el fondo bloqueado.
// Sin --con-llm no se usa el LLM aunque haya clave en el .env (la demo no gasta).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { crearConfig, leerArgs } = require('../src/config');
const { construir } = require('../src/index');
const { crearLLM } = require('../src/agentes/llm');
const universo = require('../src/mercado/universo');
const { casiIgual } = require('../src/util/numeros');
const { leerJSONL } = require('../src/util/almacen');
const { MIN, HORA, DIA } = require('../src/util/reloj');
const f = require('../src/util/formato');
const logMod = require('../src/util/log');

const PASO = 5 * MIN;
const TOL_EXPO = 1e-3;          // relativa sobre el tope, en el instante de la compra (comisiones del mismo latido)
const TOL_CANTIDAD = 1e-6;      // relativa, Σ puestos frente al bróker
const INICIO_POR_DEFECTO = Date.UTC(2026, 5, 1);   // lunes 1-jun-2026 00:00 UTC: fijo para que la demo sea reproducible

const ceder = () => new Promise(r => setImmediate(r));

function crearPiezas({ carpeta, semilla, inicio, conLLM }) {
  const config = crearConfig({ modo: 'sintetico', datos: carpeta, semilla: String(semilla) });
  config.inicio = inicio;
  const llm = conLLM ? undefined : crearLLM({ apiKey: '', reloj: { tipo: 'simulado', ahora: () => 0 } });
  const piezas = construir(config, {
    llm,
    opciones: { comiteEnSegundoPlano: false, pausaComiteMs: 0, descansoMinPantallaMs: 0, guardarCadaPasos: 12, intervaloEstadoMs: 2000 },
  });
  return { config, ...piezas };
}

// Proyección del estado que tiene que sobrevivir a un reinicio.
function proyeccion(orq) {
  const e = orq.estado;
  const libros = orq.libros.serializar().puestos.map(p => [p.puestoId, p.cantidad, p.costeMedio, p.realizado, p.stop, p.barrasAbierta]);
  return JSON.stringify({
    fondo: e.fondo, directivas: e.directivas, pico: e.pico, patrimonioInicioDia: e.patrimonioInicioDia, diaInicio: e.diaInicio,
    mesas: e.mesas.map(m => [m.id, m.estado, m.peso, m.capitalBase, m.curvaDiaria.length]), ultimaVela: e.ultimaVela,
    sombra: e.sombra, curva: e.curva.length, curvaDiaria: e.curvaDiaria, laboratorio: [e.laboratorio.ensayosTotales, e.laboratorio.hipotesis.length],
    comites: e.comite.celebrados, cadencias: e.cadencias, libros, patrimonio: orq.vivo.patrimonio,
    posiciones: orq.vivo.posicionesBroker.map(p => [p.simbolo, p.cantidad]),
  });
}

async function ejecutarDemo({ dias = 60, semilla = 42, inicio = INICIO_POR_DEFECTO, carpeta = null, conLLM = false, silencioso = false, diasTrasReinicio = 1, conservarSiFalla = false } = {}) {
  const t0 = Date.now();
  const dir = carpeta || fs.mkdtempSync(path.join(os.tmpdir(), 'mesa-demo-'));
  const fallos = [];
  const avisos = [];
  const fallar = texto => { if (fallos.length < 50) fallos.push(texto); };
  const nivelLog = process.env.LOG_NIVEL;
  if (silencioso) logMod.fijarNivel('silencio');

  let p = crearPiezas({ carpeta: dir, semilla, inicio, conLLM });
  let orq = p.orquestador;
  await orq.iniciar();
  const L = orq.limites;

  // ---- Registro de lo que pasa ----
  const comites = [];
  const porCanal = {};
  let ejecuciones = 0;
  let compras = 0;
  let maxExpo = { bruta: 0, cripto: 0, activo: 0 };
  let ultimaCompra = null;                 // { patr, precios }
  const ultimaCompraActivo = {};           // simbolo → { patr, precio }
  let kills = 0;
  let reaperturas = 0;

  const patrimonioBroker = broker => {
    let v = broker.estado.efectivo;
    for (const [s, pos] of Object.entries(broker.estado.posiciones)) v += pos.cantidad * p.datos.precioEn(s, p.reloj.ahora());
    return v;
  };

  const enlazar = o => {
    o.bus.on('mensaje', m => {
      porCanal[m.canal] = (porCanal[m.canal] || 0) + 1;
      if (m.canal === 'comite' && m.tipo === 'decision') comites.push(m.t);
    });
    o.on('ejecucion', ej => {
      ejecuciones++;
      if (ej.lado !== 'compra' || ej.motivo === 'prueba') return;
      compras++;
      // Límites duros en el instante de la compra (lo que Riesgos tuvo que garantizar).
      const patr = patrimonioBroker(p.broker);
      const val = o.libros.valorar(o.vivo.precios, { sombra: false });
      const bruta = val.exposicionBruta / patr;
      const cripto = val.exposicionCripto / patr;
      maxExpo.bruta = Math.max(maxExpo.bruta, bruta);
      maxExpo.cripto = Math.max(maxExpo.cripto, cripto);
      if (bruta > L.maxExposicionBruta * (1 + TOL_EXPO)) fallar(`exposición bruta ${f.pct(bruta)} > ${f.pct(L.maxExposicionBruta)} al comprar ${ej.etiqueta} (${new Date(ej.t).toISOString()})`);
      if (cripto > L.maxExposicionCripto * (1 + TOL_EXPO)) fallar(`exposición cripto ${f.pct(cripto)} > ${f.pct(L.maxExposicionCripto)} al comprar ${ej.etiqueta}`);
      // Solo el activo comprado tiene que caber aquí; los demás pueden haber
      // crecido por precio desde su compra (eso lo acota comprobarMuestra).
      const x = (val.exposicionPorActivo[ej.simbolo] || 0) / patr;
      maxExpo.activo = Math.max(maxExpo.activo, x);
      if (x > L.maxPesoPorActivo * (1 + TOL_EXPO)) fallar(`${ej.simbolo} pesa ${f.pct(x)} > ${f.pct(L.maxPesoPorActivo)} al comprarlo`);
      if (val.posicionesAbiertas > L.maxPosiciones) fallar(`${val.posicionesAbiertas} posiciones > ${L.maxPosiciones}`);
      const precios = Object.fromEntries(Object.entries(o.vivo.precios).map(([s, q]) => [s, q.precio]));
      ultimaCompra = { patr, precios };
      ultimaCompraActivo[ej.simbolo] = { patr, precio: precios[ej.simbolo] };
    });
  };
  enlazar(orq);

  // Entre compras: el valor está acotado por lo que se compró y lo que se ha movido el precio.
  const comprobarMuestra = () => {
    const val = orq.vivo.valoracion;
    const precios = orq.vivo.precios;
    if (!ultimaCompra) return;
    let maxRatio = 1;
    for (const [s, v] of Object.entries(val.exposicionPorActivo)) {
      const u = ultimaCompraActivo[s];
      if (!u) { fallar(`${s} tiene exposición sin compra registrada`); continue; }
      const ratio = precios[s].precio / u.precio;
      const tope = L.maxPesoPorActivo * u.patr * ratio * (1 + TOL_EXPO);
      if (v > tope + 1e-6) fallar(`${s} vale ${f.usd(v)} > tope por movimiento de precio ${f.usd(tope)}`);
      const rTodo = precios[s].precio / (ultimaCompra.precios[s] || precios[s].precio);
      if (rTodo > maxRatio) maxRatio = rTodo;
    }
    const topeBruta = L.maxExposicionBruta * ultimaCompra.patr * maxRatio * (1 + TOL_EXPO);
    if (val.exposicionBruta > topeBruta + 1e-6) fallar(`exposición bruta ${f.usd(val.exposicionBruta)} > tope ${f.usd(topeBruta)}`);
    const topeCripto = L.maxExposicionCripto * ultimaCompra.patr * maxRatio * (1 + TOL_EXPO);
    if (val.exposicionCripto > topeCripto + 1e-6) fallar(`exposición cripto ${f.usd(val.exposicionCripto)} > tope ${f.usd(topeCripto)}`);
  };

  const comprobarCuadre = async (cuando) => {
    const posiciones = await p.broker.posiciones();
    const cuenta = await p.broker.cuenta();
    const libros = orq.libros.totalesPorSimbolo({ sombra: false });
    const enBroker = {};
    for (const x of posiciones) enBroker[x.simbolo] = x.cantidad;
    for (const s of new Set([...Object.keys(libros), ...Object.keys(enBroker)])) {
      const a = libros[s] || 0;
      const b = enBroker[s] || 0;
      if (!casiIgual(a, b, TOL_CANTIDAD, 1e-9)) fallar(`${cuando}: ${s} libros ${a} ≠ bróker ${b}`);
    }
    const suma = cuenta.efectivo + posiciones.reduce((s, x) => s + x.valor, 0);
    if (!casiIgual(cuenta.patrimonio, suma, 1e-9, 1e-6)) fallar(`${cuando}: patrimonio ${cuenta.patrimonio} ≠ efectivo + posiciones ${suma}`);
    if (!casiIgual(orq.vivo.patrimonio, cuenta.patrimonio, 1e-9, 1e-6)) fallar(`${cuando}: la cabecera dice ${orq.vivo.patrimonio} y el bróker ${cuenta.patrimonio}`);
  };

  let bloqueadoDesde = null;
  const correr = async (nPasos) => {
    for (let k = 0; k < nPasos; k++) {
      p.reloj.avanzar(PASO);
      await orq.paso();
      comprobarMuestra();
      if (k % 12 === 11) await comprobarCuadre(new Date(p.reloj.ahora()).toISOString());
      // Si salta un kill por límites, un «humano» reabre a las 24 h para que la demo siga.
      if (orq.estado.fondo.nivel === 'bloqueado') {
        if (bloqueadoDesde === null) { bloqueadoDesde = p.reloj.ahora(); kills++; }
        else if (p.reloj.ahora() - bloqueadoDesde >= DIA) {
          const r = await orq.comando('reabrir', { confirmacion: 'REABRIR' });
          if (r.ok) { reaperturas++; bloqueadoDesde = null; ultimaCompra = null; }
        }
      }
      await ceder();   // deja avanzar el laboratorio (va en trozos con setImmediate)
    }
  };

  const pasosTotales = Math.round(dias * DIA / PASO);
  const pasosTras = Math.min(pasosTotales, Math.round(diasTrasReinicio * DIA / PASO));
  await correr(pasosTotales - pasosTras);
  await orq.esperarTareas();

  // ---- Reinicio simulado ----
  await orq.detener();
  const antes = proyeccion(orq);
  const instAntes = orq.instantanea();
  const errAntes = orq.errores.length;
  p = crearPiezas({ carpeta: dir, semilla, inicio, conLLM });
  orq = p.orquestador;
  await orq.iniciar();
  enlazar(orq);
  const despues = proyeccion(orq);
  if (antes !== despues) {
    const a = JSON.parse(antes); const b = JSON.parse(despues);
    const distintos = Object.keys(a).filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
    fallar(`el reinicio no recupera el mismo estado (difieren: ${distintos.join(', ')})`);
  }
  const instDespues = orq.instantanea();
  if (instAntes.cabecera.patrimonio !== instDespues.cabecera.patrimonio) fallar('el patrimonio cambia con el reinicio');
  await correr(pasosTras);
  await orq.esperarTareas();
  await comprobarCuadre('final');

  // ---- Resultado antes del kill ----
  const inst = orq.instantanea();
  const e = orq.estado;
  const opsPorMesa = {};
  for (const o of orq.operaciones) if (o.motivoSalida !== 'prueba') opsPorMesa[o.mesaId] = (opsPorMesa[o.mesaId] || 0) + 1;
  const bench = Object.fromEntries(inst.benchmarks.map(b => [b.id, b]));
  const capital = e.capitalInicial;

  // Comités cada 4 h.
  comites.sort((a, b) => a - b);
  let huecoMax = 0;
  for (let i = 1; i < comites.length; i++) huecoMax = Math.max(huecoMax, comites[i] - comites[i - 1]);
  const esperados = Math.floor((dias * DIA) / (4 * HORA)) - 1;
  if (comites.length < esperados) fallar(`solo ${comites.length} comités en ${dias} días (esperados ≥ ${esperados})`);
  if (huecoMax > 4 * HORA + PASO) fallar(`hueco de ${f.numero(huecoMax / HORA, 1)} h entre comités`);
  if (!ejecuciones || !compras) fallar('no hubo ejecuciones');
  if (!orq.operaciones.length) fallar('no se cerró ninguna operación');
  const errores = errAntes + orq.errores.length;
  if (errores) fallar(`${errores} errores dentro de los departamentos (el primero: ${(orq.errores[0] || {}).mensaje || 'antes del reinicio'})`);

  // ---- Kill switch forzado ----
  const rKill = await orq.comando('kill', { confirmacion: 'KILL' });
  if (!rKill.ok) fallar(`el kill no respondió ok: ${rKill.mensaje}`);
  const posTrasKill = await p.broker.posiciones();
  if (posTrasKill.length) fallar(`tras el kill quedan posiciones en el bróker: ${posTrasKill.map(x => x.simbolo).join(', ')}`);
  const librosTrasKill = orq.libros.totalesPorSimbolo({ sombra: false });
  if (Object.keys(librosTrasKill).length) fallar(`tras el kill quedan puestos abiertos: ${Object.keys(librosTrasKill).join(', ')}`);
  if (orq.estado.fondo.nivel !== 'bloqueado') fallar(`tras el kill el fondo está ${orq.estado.fondo.nivel}`);
  p.reloj.avanzar(PASO);
  await orq.paso();
  if (orq.estado.fondo.nivel !== 'bloqueado') fallar('el bloqueo no se mantiene en el latido siguiente');
  if ((await p.broker.posiciones()).length) fallar('se abrió algo con el fondo bloqueado');
  const rSinConfirmar = await orq.comando('kill', {});
  if (rSinConfirmar.codigo !== 400) fallar('un kill sin confirmación no devuelve 400');
  await comprobarCuadre('tras el kill');
  await orq.detener();
  if (fs.existsSync(path.join(dir, '.proceso'))) fallar('el bloqueo de la carpeta (.proceso) no se suelta al parar');
  const vistas = new Set();
  for (const op of leerJSONL(path.join(dir, 'operaciones.jsonl'))) {
    const k = `${op.id}|${op.entradaT}`;
    if (vistas.has(k)) fallar(`la operación ${op.id} está dos veces en operaciones.jsonl`);
    vistas.add(k);
  }

  // Lo gastado en esta demo (llm-costes.jsonl de su carpeta), no el gasto de hoy del reloj real.
  const costeLLM = leerJSONL(path.join(dir, 'llm-costes.jsonl')).reduce((s, x) => s + (Number(x.costeUsd) || 0), 0);
  const resumen = {
    dias, semilla, carpeta: dir, duracionS: (Date.now() - t0) / 1000,
    capital, patrimonio: inst.cabecera.patrimonio, rentabilidad: inst.cabecera.patrimonio / capital - 1,
    sombras: {
      btc: bench.btc ? bench.btc.rentabilidad : null,
      'cesta-cripto': bench['cesta-cripto'] ? bench['cesta-cripto'].rentabilidad : null,
      'sin-comite': bench['sin-comite'] ? bench['sin-comite'].rentabilidad : null,
    },
    operacionesPorMesa: opsPorMesa,
    ejecuciones, compras,
    comites: comites.length, huecoMaxComiteH: huecoMax / HORA,
    vetos: e.contadores.vetos,
    mensajesPorCanal: porCanal,
    costeLLMUsd: costeLLM,
    maxExposicion: maxExpo,
    kills, reaperturas,
    laboratorio: { ensayos: e.laboratorio.ensayosTotales, hipotesis: e.laboratorio.hipotesis.length, aprobadas: e.laboratorio.hipotesis.filter(h => h.estado === 'aprobada').length },
    mesas: inst.mesas.map(m => ({ id: m.id, estado: m.estado, peso: m.peso, operaciones: m.metricas.operaciones, pnlTotal: m.metricas.pnlTotal })),
    kill: { cerradas: rKill.datos ? rKill.datos.cerradas.length : 0 },
    reinicioIgual: antes === despues,
    errores,
  };
  if (silencioso && nivelLog !== undefined) logMod.fijarNivel(nivelLog); else if (silencioso) logMod.fijarNivel('info');
  // La carpeta temporal se borra; si algo falla desde la consola, se queda para mirarla.
  if (!carpeta && !(fallos.length && conservarSiFalla)) fs.rmSync(dir, { recursive: true, force: true });
  return { resumen, fallos, avisos };
}

function imprimir({ resumen: r, fallos }) {
  const pct = x => (x === null || x === undefined ? '—' : f.pct(x, { signo: true }));
  const lineas = [
    `== Demo acelerada: ${r.dias} días sintéticos (semilla ${r.semilla}) en ${f.numero(r.duracionS, 1)} s ==`,
    `Patrimonio final ${f.usd(r.patrimonio)} (${pct(r.rentabilidad)} sobre ${f.usd(r.capital)})`,
    `Sombras: BTC ${pct(r.sombras.btc)} · cesta cripto ${pct(r.sombras['cesta-cripto'])} · sin comité ${pct(r.sombras['sin-comite'])}`,
    `Operaciones cerradas por mesa: ${Object.entries(r.operacionesPorMesa).map(([k, v]) => `${k} ${v}`).join(', ') || 'ninguna'} · ejecuciones ${r.ejecuciones} (${r.compras} compras)`,
    `Mesas: ${r.mesas.map(m => `${m.id} ${m.estado} ${f.pct(m.peso, { decimales: 0 })} ${f.usd(m.pnlTotal, { signo: true })}`).join(' · ')}`,
    `Comités: ${r.comites} (hueco máximo ${f.numero(r.huecoMaxComiteH, 2)} h) · vetos de Riesgos: ${r.vetos} · kills por límites: ${r.kills}, reaperturas: ${r.reaperturas}`,
    `Laboratorio: ${r.laboratorio.hipotesis} hipótesis, ${r.laboratorio.aprobadas} aprobadas, ${r.laboratorio.ensayos} ensayos`,
    `Exposición máxima al comprar: bruta ${f.pct(r.maxExposicion.bruta)}, cripto ${f.pct(r.maxExposicion.cripto)}, un activo ${f.pct(r.maxExposicion.activo)}`,
    `Mensajes por canal: ${Object.entries(r.mensajesPorCanal).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`,
    `Coste LLM: ${f.usd(r.costeLLMUsd)}`,
    `Reinicio simulado: ${r.reinicioIgual ? 'estado recuperado igual' : 'DISTINTO'} · kill final: ${r.kill.cerradas} posiciones cerradas, fondo bloqueado`,
  ];
  console.log(lineas.join('\n'));
  if (fallos.length) {
    console.log(`\nFALLO: ${fallos.length} invariantes no se cumplen (datos en ${r.carpeta}):`);
    for (const x of fallos) console.log(`  - ${x}`);
  } else {
    console.log('\nOK: todas las invariantes se cumplen.');
  }
}

if (require.main === module) {
  const args = leerArgs();
  const opciones = {
    dias: Number(args.dias) || 60,
    semilla: Number(args.semilla) || 42,
    inicio: args.inicio ? Date.parse(args.inicio) : INICIO_POR_DEFECTO,
    carpeta: typeof args.datos === 'string' ? args.datos : null,
    conLLM: Boolean(args['con-llm']),
    silencioso: !args.ruidoso,
    conservarSiFalla: true,
  };
  ejecutarDemo(opciones).then(res => {
    imprimir(res);
    process.exit(res.fallos.length ? 1 : 0);
  }).catch(e => {
    console.error(`FALLO: la demo se cayó: ${e.stack || e.message}`);
    process.exit(1);
  });
}

module.exports = { ejecutarDemo, imprimir, INICIO_POR_DEFECTO };
