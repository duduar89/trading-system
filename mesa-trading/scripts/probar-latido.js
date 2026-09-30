'use strict';
// Caso conocido del motor por latido (docs/ARQUITECTURA-WEB.md W2 y W5):
//
//   node scripts/probar-latido.js [--dias=20] [--semilla=42] [--sin-laboratorio]
//
// La misma demo sintética corrida de dos maneras tiene que dejar EXACTAMENTE
// lo mismo en disco:
//   (a) continuo: un solo orquestador en memoria que da todos los pasos;
//   (b) latido:   src/latido.js, que en cada paso toma el cerrojo, reconstruye
//                 el orquestador desde disco, da un paso, guarda y lo suelta
//                 (como hará el cron en el cPanel, un proceso por minuto).
// Las dos con las opciones del modo latido (opcionesLatido) y con los mismos
// sucesos a la misma hora: un comité convocado desde el panel, el Megáfono
// (propuesta y aplicar), Pausar y Reabrir, el Reabrir de «un humano» 24 h
// después de un kill, y el laboratorio fuera de banda en cuanto hay
// hipótesis pendientes (scripts/laboratorio.js), que el latido siguiente
// incorpora.
// Se compara: estado.json, broker-simulado.json, operaciones (y sombra),
// órdenes, incidentes, costes del LLM, historial, decisiones, noticias, mensajes (con su id,
// su respondeA y su hilo: los ids son deterministas desde el 30-sep-2026, §6.2)
// e instantánea (sin su marca «publicada»).
// Si algo difiere, se arregla la causa, no esta prueba.
//
// Solo para ir deprisa: el mercado sintético (una función pura de la semilla y
// el origen, generada en orden) se genera una vez y lo comparten todas las
// reconstrucciones (compartirMercado). La prueba comprueba que da los mismos
// precios que uno generado aparte.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { crearConfig, leerArgs } = require('../src/config');
const { construir } = require('../src/index');
const { crearLLM } = require('../src/agentes/llm');
const { DatosSinteticos } = require('../src/mercado/sintetico');
const { conLaMesa, latido, opcionesLatido, publicarInstantanea, incorporarLaboratorio, borrarResultadoLaboratorio } = require('../src/latido');
const { ejecutarLaboratorio } = require('./laboratorio');
const { leerJSON, leerJSONL } = require('../src/util/almacen');
const { RelojSimulado, MIN, HORA, DIA } = require('../src/util/reloj');
const logMod = require('../src/util/log');

const PASO = 5 * MIN;
const INICIO = Date.UTC(2026, 5, 1);   // lunes 1-jun-2026 00:00 UTC, como la demo acelerada

const llmApagado = () => crearLLM({ apiKey: '', reloj: { tipo: 'simulado', ahora: () => 0 } });

function compartirMercado() {
  const original = DatosSinteticos.prototype._asegurar;
  const maestros = new Map();
  DatosSinteticos.prototype._asegurar = function asegurarCompartido(k) {
    const clave = `${this.semilla}|${this.origen}|${this.inicio}`;
    const m = maestros.get(clave);
    if (!m) { maestros.set(clave, this); return original.call(this, k); }
    if (m === this) return original.call(this, k);
    original.call(m, k);
    this.L = m.L; this.arriba = m.arriba; this.abajo = m.abajo; this.regimen = m.regimen;
    this.n = m.n; this.capacidad = m.capacidad; this.ancla = m.ancla; this.estadoRegimen = m.estadoRegimen;
    return undefined;
  };
  return () => { DatosSinteticos.prototype._asegurar = original; };
}

// Los sucesos «humanos» del guion, por paso (k = número de paso ya dado).
function guion(dias) {
  const enPaso = t => Math.round(t / PASO);
  const s = new Map();
  const poner = (t, ev) => { const k = enPaso(t); if (k < dias * DIA / PASO) { if (!s.has(k)) s.set(k, []); s.get(k).push(ev); } };
  poner(1 * DIA + 12 * HORA + 2 * PASO, { nombre: 'comite', datos: {} });
  poner(3 * DIA + 9 * HORA, { nombre: 'megafono', datos: { texto: 'reduce el tamaño a la mitad durante 6 horas' } });
  poner(3 * DIA + 9 * HORA + PASO, { nombre: 'megafono-aplicar', datos: {} });
  poner(5 * DIA + 14 * HORA, { nombre: 'pausar', datos: {} });
  poner(5 * DIA + 16 * HORA, { nombre: 'reabrir', datos: { confirmacion: 'REABRIR' } });
  return s;
}

// Lo que el guion necesita saber del estado entre pasos (igual en los dos modos).
function vista(estado) {
  return {
    ahora: estado.ahora,
    nivel: estado.fondo.nivel,
    megafono: estado.megafonoPendiente ? estado.megafonoPendiente.id : null,
    labPendiente: estado.laboratorio.hipotesis.some(h => h.estado === 'pendiente'),
  };
}

function datosDe(ev, v) {
  return ev.nombre === 'megafono-aplicar' ? { id: v.megafono } : ev.datos;
}

// Corre el guion. `modo`: 'continuo' | 'latido'.
async function correr({ modo, carpeta, dias, semilla, conLaboratorio }) {
  const config = crearConfig({ modo: 'sintetico', datos: carpeta, semilla: String(semilla) });
  config.inicio = INICIO;
  const pasos = Math.round(dias * DIA / PASO);
  const sucesos = guion(dias);
  const cuenta = { pasos: 0, comandos: 0, laboratorios: 0, incorporados: 0, reaperturas: 0, ocupado: 0 };

  let orq = null;
  let dar;       // () → vista tras un paso
  let mandar;    // (nombre, datos) → resultado del comando
  let cerrar = async () => {};
  if (modo === 'continuo') {
    const piezas = construir(config, { llm: llmApagado(), opciones: opcionesLatido(config) });
    orq = piezas.orquestador;
    await orq.iniciar();
    await orq.esperarTareas();
    let hecho = false;
    dar = async () => {
      const lab = incorporarLaboratorio(config, orq);
      if (lab && lab.hipotesis) cuenta.incorporados += lab.hipotesis;
      piezas.reloj.avanzar(PASO);
      await orq.paso();
      await orq.esperarTareas();
      orq.guardar();
      publicarInstantanea(config, orq);
      if (lab) borrarResultadoLaboratorio(config, lab.id);
      hecho = true;
      return vista(orq.estado);
    };
    mandar = async (nombre, datos) => {
      const r = await orq.comando(nombre, datos);
      await orq.esperarTareas();
      orq.guardar();
      publicarInstantanea(config, orq);
      return r;
    };
    cerrar = async () => { if (hecho || orq.iniciado) await orq.detener(); };
  } else {
    dar = async () => {
      const antes = leerJSON(path.join(carpeta, 'laboratorio-resultado.json'), null);
      const r = await latido(config, { llm: llmApagado() });
      if (!r.ok) throw new Error(`latido: ${r.resumen}`);
      const estado = leerJSON(path.join(carpeta, 'estado.json'), null, { critico: true });
      if (antes && (estado.laboratorio.incorporados || []).includes(antes.id)) cuenta.incorporados += antes.evaluaciones.length;
      return vista(estado);
    };
    mandar = async (nombre, datos) => {
      const r = await conLaMesa(config, o => o.comando(nombre, datos), { espera: 5000, motivo: nombre, llm: llmApagado() });
      if (!r.ok) throw new Error(`comando ${nombre}: ${r.motivo} ${r.detalle || ''}`);
      return r.resultado;
    };
  }

  const respuestas = [];
  let bloqueadoDesde = null;
  let v = null;
  try {
    for (let k = 0; k < pasos; k++) {
      for (const ev of sucesos.get(k) || []) {
        const r = await mandar(ev.nombre, datosDe(ev, v || {}));
        cuenta.comandos++;
        respuestas.push({ k, nombre: ev.nombre, ok: r.ok, mensaje: r.mensaje });
      }
      if (conLaboratorio && v && v.labPendiente) {
        const r = await ejecutarLaboratorio(config, { llm: llmApagado() });
        if (!r.ok) throw new Error(`laboratorio: ${r.detalle}`);
        if (r.motivo === 'hecho') cuenta.laboratorios++;
      }
      v = await dar();
      cuenta.pasos++;
      // Como la demo acelerada: tras un kill, un «humano» reabre a las 24 h.
      if (v.nivel === 'bloqueado') {
        if (bloqueadoDesde === null) bloqueadoDesde = v.ahora;
        else if (v.ahora - bloqueadoDesde >= DIA) {
          const r = await mandar('reabrir', { confirmacion: 'REABRIR' });
          respuestas.push({ k, nombre: 'reabrir (tras kill)', ok: r.ok, mensaje: r.mensaje });
          if (r.ok) { cuenta.reaperturas++; bloqueadoDesde = null; }
        }
      } else bloqueadoDesde = null;
    }
  } finally {
    await cerrar();
  }
  return { cuenta, respuestas };
}

// ---- Comparación de lo escrito en disco ----

const FICHEROS_JSON = ['estado.json', 'broker-simulado.json', 'instantanea.json'];
// historial y decisiones (src/registros.js) también: las pantallas no pueden depender de cómo corre el motor.
const FICHEROS_JSONL = ['operaciones.jsonl', 'operaciones-sombra.jsonl', 'ordenes.jsonl', 'incidentes.jsonl', 'llm-costes.jsonl', 'mensajes.jsonl', 'historial.jsonl', 'decisiones.jsonl', 'noticias.jsonl'];

function normalizar(nombre, x) {
  if (nombre === 'instantanea.json' && x) {
    const { publicada: _p, ...resto } = x;
    return resto;
  }
  return x;
}

// Primera diferencia entre dos valores JSON, con su ruta.
function diferencia(a, b, ruta = '') {
  if (a === b) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
    if (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b)) return null;
    return { ruta: ruta || '(raíz)', a, b };
  }
  if (Array.isArray(a) !== Array.isArray(b)) return { ruta, a: 'array?', b: 'array?' };
  if (Array.isArray(a)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) { const d = diferencia(a[i], b[i], `${ruta}[${i}]`); if (d) return d; }
    return a.length === b.length ? null : { ruta: `${ruta}.length`, a: a.length, b: b.length };
  }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const d = diferencia(a[k], b[k], ruta ? `${ruta}.${k}` : k);
    if (d) return d;
  }
  return null;
}

function comparar(dirA, dirB) {
  const diferencias = [];
  for (const nombre of FICHEROS_JSON) {
    const a = normalizar(nombre, leerJSON(path.join(dirA, nombre), null));
    const b = normalizar(nombre, leerJSON(path.join(dirB, nombre), null));
    const d = diferencia(a, b);
    if (d) diferencias.push({ fichero: nombre, ...d });
  }
  for (const nombre of FICHEROS_JSONL) {
    const a = normalizar(nombre, leerJSONL(path.join(dirA, nombre)));
    const b = normalizar(nombre, leerJSONL(path.join(dirB, nombre)));
    const d = diferencia(a, b);
    if (d) diferencias.push({ fichero: nombre, ...d });
  }
  return diferencias;
}

function recuento(dir) {
  const mensajes = leerJSONL(path.join(dir, 'mensajes.jsonl'));
  const estado = leerJSON(path.join(dir, 'estado.json'), null) || {};
  return {
    mensajes: mensajes.length,
    comites: mensajes.filter(m => m.canal === 'comite' && m.tipo === 'decision').length,
    comitesDemanda: mensajes.filter(m => m.canal === 'comite' && m.tipo === 'comite' && m.datos && m.datos.motivo === 'demanda').length,
    // Conversaciones (§6.2): mensajes que contestan a otro, hilos de operación con su lección y reuniones (§6.9).
    respuestas: mensajes.filter(m => m.respondeA).length,
    lecciones: mensajes.filter(m => m.tipo === 'leccion' && m.respondeA).length,
    reuniones: mensajes.filter(m => m.tipo === 'reunion' && m.datos && m.datos.fase === 'apertura').length,
    operaciones: leerJSONL(path.join(dir, 'operaciones.jsonl')).length,
    ordenes: leerJSONL(path.join(dir, 'ordenes.jsonl')).length,
    hipotesis: ((estado.laboratorio || {}).hipotesis || []).map(h => h.estado),
    historial: leerJSONL(path.join(dir, 'historial.jsonl')).length,
    decisiones: leerJSONL(path.join(dir, 'decisiones.jsonl')).length,
    nivel: estado.fondo && estado.fondo.nivel,
  };
}

// El mercado compartido da los mismos precios que uno generado aparte.
function comprobarMercado(semilla, dias) {
  const reloj = new RelojSimulado(INICIO + dias * DIA);
  const a = new DatosSinteticos({ semilla, reloj, inicio: INICIO });
  const b = new DatosSinteticos({ semilla, reloj, inicio: INICIO });
  const fallos = [];
  for (const t of [INICIO, INICIO + DIA / 2, INICIO + dias * DIA]) {
    for (const s of ['BTC/USD', 'ETH/USD', 'DOGE/USD']) {
      const x = a.precioEn(s, t);
      const y = b.precioEn(s, t);
      if (x !== y) fallos.push(`${s} en ${new Date(t).toISOString()}: ${x} ≠ ${y}`);
    }
  }
  return fallos;
}

async function compararLatido({ dias = 20, semilla = 42, conLaboratorio = true, conservar = false } = {}) {
  const t0 = Date.now();
  const nivel = process.env.LOG_NIVEL;
  logMod.fijarNivel('silencio');
  const quitar = compartirMercado();
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'mesa-latido-'));
  const dirA = path.join(raiz, 'continuo');
  const dirB = path.join(raiz, 'latido');
  try {
    const mercado = comprobarMercado(semilla, dias);
    const t1 = Date.now();
    const a = await correr({ modo: 'continuo', carpeta: dirA, dias, semilla, conLaboratorio });
    const t2 = Date.now();
    const b = await correr({ modo: 'latido', carpeta: dirB, dias, semilla, conLaboratorio });
    const t3 = Date.now();
    const diferencias = comparar(dirA, dirB);
    const respuestasDistintas = diferencia(a.respuestas, b.respuestas);
    return {
      diferencias,
      respuestasDistintas,
      mercado,
      continuo: { ...a.cuenta, ...recuento(dirA), segundos: (t2 - t1) / 1000 },
      latido: { ...b.cuenta, ...recuento(dirB), segundos: (t3 - t2) / 1000 },
      respuestas: a.respuestas,
      cerrojos: ['.proceso', '.laboratorio'].filter(n => fs.existsSync(path.join(dirA, n)) || fs.existsSync(path.join(dirB, n))),
      resultadoLabSinBorrar: fs.existsSync(path.join(dirA, 'laboratorio-resultado.json')) || fs.existsSync(path.join(dirB, 'laboratorio-resultado.json')),
      segundos: (Date.now() - t0) / 1000,
      carpeta: conservar ? raiz : null,
    };
  } finally {
    quitar();
    logMod.fijarNivel(nivel || 'info');
    if (!conservar) fs.rmSync(raiz, { recursive: true, force: true });
  }
}

async function main() {
  const args = leerArgs();
  const dias = Number(args.dias) || 20;
  const semilla = Number(args.semilla) || 42;
  const r = await compararLatido({ dias, semilla, conLaboratorio: !args['sin-laboratorio'], conservar: Boolean(args.conservar) });
  const casos = [];
  const caso = (ok, texto) => { casos.push(ok); console.log(`${ok ? 'OK   ' : 'FALLO'} ${texto}`); };
  const d = r.diferencias;
  caso(!r.mercado.length, `el mercado compartido da los mismos precios que uno aparte${r.mercado.length ? `: ${r.mercado[0]}` : ''}`);
  caso(!d.length, `${dias} días: continuo = latido a latido en ${['estado.json', 'broker-simulado.json', 'instantanea.json', 'operaciones', 'órdenes', 'incidentes', 'costes', 'mensajes', 'historial', 'decisiones', 'noticias'].join(', ')}${d.length ? `\n        ${d.slice(0, 5).map(x => `${x.fichero} ${x.ruta}: ${JSON.stringify(x.a)?.slice(0, 160)} ≠ ${JSON.stringify(x.b)?.slice(0, 160)}`).join('\n        ')}` : ''}`);
  caso(!r.respuestasDistintas, `los comandos responden lo mismo (${r.respuestas.length}: ${[...new Set(r.respuestas.map(x => x.nombre))].join(', ')})`);
  caso(r.continuo.operaciones > 0 && r.continuo.operaciones === r.latido.operaciones, `operaciones: ${r.continuo.operaciones} y ${r.latido.operaciones}`);
  caso(r.continuo.comites >= Math.floor(dias * 6) && r.continuo.comites === r.latido.comites, `comités: ${r.continuo.comites} y ${r.latido.comites} (a demanda: ${r.latido.comitesDemanda})`);
  caso(r.latido.comitesDemanda >= 1, 'el comité convocado desde el panel se celebra en el latido siguiente');
  caso(r.continuo.mensajes === r.latido.mensajes, `mensajes: ${r.continuo.mensajes} y ${r.latido.mensajes}`);
  // Las 9:00 y las 22:15 de Madrid caen una vez al día cada una; y los hilos
  // (quién contesta a quién) salen iguales, ids incluidos.
  caso(r.latido.reuniones >= 2 * dias - 2 && r.continuo.reuniones === r.latido.reuniones && r.latido.respuestas > 0 && r.continuo.respuestas === r.latido.respuestas,
    `reuniones: ${r.continuo.reuniones} y ${r.latido.reuniones}; mensajes que contestan a otro: ${r.continuo.respuestas} y ${r.latido.respuestas} (lecciones en su hilo: ${r.latido.lecciones})`);
  // Una línea de historial por hora (más los sucesos) y alguna decisión: si
  // no, «iguales» no diría nada (dos ficheros vacíos también lo son).
  caso(r.latido.historial >= dias * 24 && r.continuo.historial === r.latido.historial && r.latido.decisiones > 0 && r.continuo.decisiones === r.latido.decisiones,
    `historial: ${r.continuo.historial} y ${r.latido.historial} líneas; decisiones: ${r.continuo.decisiones} y ${r.latido.decisiones}`);
  if (!args['sin-laboratorio']) caso(r.latido.laboratorios > 0 && r.latido.incorporados > 0 && r.latido.incorporados === r.continuo.incorporados, `laboratorio fuera de banda: ${r.latido.laboratorios} resultados, ${r.latido.incorporados} hipótesis incorporadas (${r.latido.hipotesis.join(', ')})`);
  caso(!r.cerrojos.length && !r.resultadoLabSinBorrar, 'al acabar no queda ningún cerrojo ni resultado del laboratorio sin incorporar');
  console.log(`Continuo ${r.continuo.segundos.toFixed(1)} s, latido a latido ${r.latido.segundos.toFixed(1)} s (${r.latido.pasos} latidos, ${r.latido.comandos} comandos). Nivel final ${r.latido.nivel}.`);
  if (r.carpeta) console.log(`Carpetas: ${r.carpeta}`);
  const ok = casos.every(Boolean);
  console.log(ok ? `OK: ${casos.length} casos.` : `FALLO: ${casos.filter(x => !x).length} de ${casos.length} casos.`);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) {
  main().catch(e => { console.error(`FALLO: ${e.stack || e.message}`); process.exit(1); });
}

module.exports = { compararLatido, compartirMercado, comparar, diferencia, INICIO, PASO };
