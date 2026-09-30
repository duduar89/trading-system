'use strict';
// Caso conocido del tono y de las conversaciones (ARQUITECTURA §6.2, §6.4, §6.9):
//
//   node scripts/probar-tono.js [--dias=5]
//
// 1. Cada plantilla con datos de ejemplo: en llano, ≤ MAX caracteres, sin
//    «undefined» ni «NaN», y ninguna cifra que no esté en sus datos
//    (verificarCifras, más las escalas fijas 50, 90 y 200 días y RSI sobre 100).
//    Imprime el ejemplo para que se lea cómo suena.
// 2. Una demo sintética de unos días (semilla 42): toda respuesta apunta a un
//    mensaje que existe; cada operación cerrada es un hilo que empieza en la
//    señal del operador y acaba en su cierre, con Riesgos y el Ejecutor
//    dirigiéndose al operador por su nombre; cada lección del Auditor contesta
//    a un cierre; una reunión de la mañana a las 9:00 y un cierre del día a
//    las 22:15 de Madrid cada día, sin cambiar el modo.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { crearConfig, leerArgs } = require('../src/config');
const { construir } = require('../src/index');
const { crearLLM } = require('../src/agentes/llm');
const { opcionesLatido } = require('../src/latido');
const p = require('../src/agentes/plantillas');
const { verificarCifras } = require('../src/agentes/cifras');
const f = require('../src/util/formato');
const { leerJSONL } = require('../src/util/almacen');
const { MIN, DIA } = require('../src/util/reloj');
const logMod = require('../src/util/log');

const casos = [];
const caso = (ok, texto) => { casos.push(Boolean(ok)); console.log(`${ok ? 'OK   ' : 'FALLO'} ${texto}`); };
const ESCALAS = { escalas: [50, 90, 100, 200] };

function plantillas() {
  console.log('— Plantillas en llano (con las cifras de sus datos)');
  const ejemplos = [
    ['notaAnalista', { etiqueta: 'ETH', nombre: 'Ethereum', precio: 2560, sesgo: 'alcista', sma50: 2480, rsi: 71.2, volAnual: 0.62 }],
    ['regimen', { valor: 'RISK-OFF', puntos: -2, anterior: 'NEUTRAL', componentes: [{ nombre: 'btc_sobre_sma200', valor: 70100, referencia: 79100, puntos: -1 }, { nombre: 'vixy_sobre_sma50', valor: 31, referencia: 25, puntos: -1 }] }],
    ['estadoPuesto', { etiqueta: 'BTC', marco: '4Hour', posicion: { cantidad: 0.012345, entrada: 84120.5, stop: 81200, pnlAbiertoPct: 0.0234 } }],
    ['propuesta', { etiqueta: 'SOL', nocional: 1234.56, precio: 145.2, stop: 139.1, factor: { total: 0.5, comite: 0.5, mesa: 1, megafono: 1, caida: 1 }, a: 'Marta Solís' }],
    ['aprobacion', { etiqueta: 'SOL', nocional: 1234.56, a: 'Lucía García' }],
    ['aprobacion', { etiqueta: 'BTC', decision: 'reducir', nocional: 800, nocionalPedido: 1234.56, motivos: [{ texto: 'BTC pesaría 11,2 % del patrimonio (máximo 10 %).' }], a: 'Lucía' }],
    ['veto', { etiqueta: 'SOL', motivos: [{ texto: 'El precio es de hace 250 s (máximo 180 s).' }], a: 'Lucía' }],
    ['orden', { etiqueta: 'SOL', lado: 'compra', nocional: 1234.56, a: ['Lucía', 'Marta'] }],
    ['ejecucion', { etiqueta: 'SOL', cantidad: 8.49, precio: 145.3, nocional: 1234.56, comision: 3.09, a: 'Lucía' }],
    ['cierre', { etiqueta: 'SOL', pnl: 123.45, pnlPct: 0.0234, motivoSalida: 'señal', barras: 12, rMultiple: 1.6 }],
    ['leccion', { mesaId: 'tendencia', mesa: 'Tendencia SMA', etiqueta: 'SOL', categoria: 'stop_estrecho', pnl: -45.2, barras: 2, a: 'Lucía' }],
    ['decisionComite', { modo: 'DEFENSIVO', multiplicadores: { tendencia: 0.5 }, vetos: ['DOGE/USD'], fuente: 'defecto' }],
    ['informeDiario', { dia: '2026-09-30', patrimonio: 100415, pnlDia: 443.67, pnlDiaPct: 0.00442, operaciones: 5, acierto: 0.4, gastoLLMUsd: 0.22 }],
    ['informeSemanal', { rentabilidad: 0.012, sharpe90Fondo: 0.85, sharpe90SinComite: 0.8, sharpe90Btc: 0.6 }],
    ['conciliacion', { acciones: [{ tipo: 'escalar', simbolo: 'BTC/USD' }], grave: false }],
    ['resultadoHipotesis', { id: 'h-2', aprobada: false, criterios: [{ nombre: 'Sharpe OOS', valor: 0.42, umbral: 0.6, ok: false, comparacion: '≥' }] }],
  ];
  const comite = [
    ['controller', { patrimonio: 100234.5, pnlDia: -534.2, pnlDiaPct: -0.0053, caida: -0.031, exposicionBrutaPct: 0.45, posiciones: 5, anterior: 'Carmen' }],
    ['macro', { regimen: 'NEUTRAL', puntos: 1, voto: 'NORMAL', anterior: 'Inés' }],
    ['riesgos', { nivel: 'normal', vetos: 3, cercanos: ['lo invertido en cripto, 47 % de un máximo de 50 %'], voto: 'DEFENSIVO', anterior: 'Tomás' }],
  ];
  const reunion = [
    ['noche', { patrimonio: 100234.5, patrimonioAntes: 100001, cambio: 233.5, cambioPct: 0.002335, desdeHora: '22:15', operaciones: 2, pnlOperaciones: 45.2, anterior: 'Carmen' }],
    ['posicion', { etiqueta: 'ETH', cantidad: 0.5, entrada: 2480, precio: 2560, pnlAbiertoPct: 0.0322, stop: 2350 }],
    ['cerradas', { operaciones: 3, ganadoras: 2, perdedoras: 1, pnl: 88.1, mejor: { etiqueta: 'SOL', pnl: 123.45 }, peor: { etiqueta: 'BTC', pnl: -45.2 }, anterior: 'Inés' }],
  ];
  const mirar = (nombre, texto, datos) => {
    const v = verificarCifras(texto, [datos, ESCALAS]);
    const ok = typeof texto === 'string' && texto.length > 0 && texto.length <= p.MAX && !/undefined|NaN|null|\[object/.test(texto) && v.ok;
    caso(ok, `${nombre}: «${texto}»${v.ok ? '' : ` (cifras sin dato: ${v.noEncontradas.join(', ')})`}`);
  };
  for (const [n, d] of ejemplos) mirar(n, p[n](d), d);
  for (const [j, d] of comite) mirar(`comité ${j}`, p.informeComite(j, d), d);
  for (const [t, d] of reunion) mirar(`reunión ${t}`, p.reunion[t](d), d);
  caso(p.notaAnalista(ejemplos[0][1]) === 'Ethereum vale 2.560 $ y sigue en subida: está por encima de su precio medio de los últimos 50 días (2.480 $). Ojo: ha subido muy deprisa (RSI 71 de 100) y podría tomarse un respiro.',
    'la nota de ETH es la del ejemplo de Eduardo');
}

async function demo(dias) {
  console.log(`— Demo sintética de ${dias} días: hilos y reuniones`);
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'mesa-tono-'));
  try {
    const config = crearConfig({ modo: 'sintetico', datos: carpeta, semilla: '42' });
    config.inicio = Date.UTC(2026, 5, 1);
    const piezas = construir(config, { llm: crearLLM({ apiKey: '', reloj: { tipo: 'simulado', ahora: () => 0 } }), opciones: opcionesLatido(config) });
    const o = piezas.orquestador;
    await o.iniciar();
    for (let k = 0; k < dias * DIA / (5 * MIN); k++) { piezas.reloj.avanzar(5 * MIN); await o.paso(); await o.esperarTareas(); }
    await o.detener();
    const ms = leerJSONL(path.join(carpeta, 'mensajes.jsonl'));
    const porId = new Map(ms.map(m => [m.id, m]));
    caso(porId.size === ms.length, `ids únicos (${ms.length} mensajes)`);
    const colgadas = ms.filter(m => m.respondeA && !porId.has(m.respondeA));
    caso(!colgadas.length, `toda respuesta apunta a un mensaje que existe (${ms.filter(m => m.respondeA).length} respuestas)`);
    const cierres = ms.filter(m => m.tipo === 'cierre' && m.hilo);
    const completos = cierres.filter(c => {
      const hilo = ms.filter(m => m.hilo === c.hilo);
      const tipos = hilo.map(m => m.tipo);
      const operador = hilo[0].de;
      const pila = p.pila(hilo[0].deNombre);
      return tipos[0] === 'senal' && tipos.includes('propuesta') && tipos.includes('aprobacion') && tipos.includes('orden') && tipos.includes('ejecucion')
        && hilo.filter(m => m.tipo === 'aprobacion').every(m => m.para === operador && m.texto.startsWith(`${pila}, `))
        && hilo.filter(m => m.tipo === 'ejecucion').every(m => m.para === operador && m.texto.startsWith(`${pila}, hecho`));
    });
    caso(cierres.length > 0 && completos.length === cierres.length, `cada operación cerrada es un hilo completo con el operador por su nombre (${completos.length} de ${cierres.length})`);
    if (cierres.length) {
      const c = cierres[0];
      for (const m of ms.filter(x => x.hilo === c.hilo)) console.log(`        ${m.deNombre}: ${m.texto}`);
    }
    const lecciones = ms.filter(m => m.tipo === 'leccion');
    caso(lecciones.length > 0 && lecciones.every(l => l.respondeA && porId.get(l.respondeA) && porId.get(l.respondeA).tipo === 'cierre' && l.para === porId.get(l.respondeA).de),
      `cada lección del Auditor contesta al cierre de su operador (${lecciones.length})`);
    const aperturas = ms.filter(m => m.tipo === 'reunion' && m.datos && m.datos.fase === 'apertura');
    const horas = aperturas.map(m => `${m.datos.reunion} ${f.hora(m.t)}`);
    const bien = aperturas.every(m => f.hora(m.t) === (m.datos.reunion === 'manana' ? '09:00' : '22:15'));
    caso(aperturas.length >= 2 * dias - 2 && bien, `reuniones a las 09:00 y 22:15 de Madrid (${aperturas.length}: ${[...new Set(horas)].join(', ')})`);
    const turnos = ms.filter(m => m.datos && m.datos.reunion);
    caso(turnos.every(m => m.hilo && porId.get(m.hilo) && porId.get(m.hilo).tipo === 'reunion'), 'cada turno va en el hilo de su reunión');
    // El resumen de cada reunión dice el modo que decidió el último comité: la reunión no lo toca.
    const comites = ms.filter(m => m.canal === 'comite' && m.tipo === 'decision');
    const resumenes = turnos.filter(m => m.datos.turno === 'resumen');
    const cuadran = resumenes.filter(r => {
      const ultimo = [...comites].reverse().find(c => c.t <= r.t);
      return r.texto.includes(`modo ${ultimo ? ultimo.datos.modo : 'NORMAL'}`);
    });
    caso(resumenes.length > 0 && cuadran.length === resumenes.length, `cada reunión cuenta el modo del último comité, sin cambiarlo (${cuadran.length} de ${resumenes.length})`);
  } finally {
    fs.rmSync(carpeta, { recursive: true, force: true });
  }
}

async function main() {
  logMod.fijarNivel('silencio');
  const args = leerArgs();
  plantillas();
  await demo(Number(args.dias) || 5);
  const ok = casos.every(Boolean);
  console.log(ok ? `OK: ${casos.length} casos.` : `FALLO: ${casos.filter(x => !x).length} de ${casos.length} casos.`);
  process.exit(ok ? 0 : 1);
}

main().catch(e => { console.error(`FALLO: ${e.stack || e.message}`); process.exit(1); });
