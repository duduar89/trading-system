'use strict';
// Laboratorio fuera de banda (modo latido, docs/ARQUITECTURA-WEB.md W2).
//
//   node scripts/laboratorio.js [--datos=carpeta] [--modo=…]
//
// Lo lanza su propio cron (los lunes). La evaluación de hipótesis (walk-forward
// con años de velas) no cabe en un latido de menos de 20 s, así que corre
// aquí: con su propio cerrojo (<datos>/.laboratorio, no el de la mesa), lee
// el estado.json SIN tocarlo, evalúa las hipótesis pendientes y deja el
// resultado en <datos>/laboratorio-resultado.json. El latido siguiente lo
// incorpora al estado bajo el cerrojo principal, una sola vez (el id queda en
// estado.laboratorio.incorporados) y borra el fichero.
//
// - Si ya hay un resultado sin incorporar, no se evalúa otro encima: sale.
// - Nada de lo que hace aquí publica mensajes ni escribe estado.json,
//   broker-simulado.json u ordenes.jsonl: todo eso lo hace el latido.
// - El id del resultado sale del contenido (instante de la mesa e hipótesis):
//   el mismo estado da el mismo id.
// Sale con 0 si ha hecho su trabajo o no había nada que hacer (o el cerrojo
// estaba cogido); con 1 si falla.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { crearConfig, leerArgs } = require('../src/config');
const { construir } = require('../src/index');
const { crearLLM } = require('../src/agentes/llm');
const { Orquestador } = require('../src/orquestador');
const { FICHEROS } = require('../src/latido');
const laboratorio = require('../src/agentes/departamentos/laboratorio');
const { escribirJSON } = require('../src/util/almacen');
const { pidVivo, romperMuerto, leerTexto } = require('../src/util/proceso');
const log = require('../src/util/log').crear('laboratorio');

const CERROJO = '.laboratorio';
const pendiente = h => h && (h.estado === 'pendiente' || h.estado === 'evaluando');

// Cerrojo propio con la misma regla que data/.proceso: fichero creado con
// 'wx'; si es de un pid de esta máquina que ya no existe, se toma.
function tomarCerrojo(carpeta) {
  fs.mkdirSync(carpeta, { recursive: true });
  const ruta = path.join(carpeta, CERROJO);
  const mio = { pid: process.pid, host: os.hostname(), desde: new Date().toISOString() };
  for (let intento = 0; intento < 3; intento++) {
    try {
      fs.writeFileSync(ruta, JSON.stringify(mio), { flag: 'wx' });
      return true;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    const visto = leerTexto(ruta);
    if (visto === null) continue;   // lo soltaron entre medias
    let otro = {};
    try { otro = JSON.parse(visto); } catch (_) { /* ilegible */ }
    const mismaMaquina = !otro.host || otro.host === mio.host;
    // Se rompe solo si sigue siendo el mismo cerrojo muerto (src/util/proceso.js).
    if (mismaMaquina && otro.pid !== process.pid && !pidVivo(otro.pid) && romperMuerto(ruta, visto)) continue;
    return false;
  }
  return false;
}

function soltarCerrojo(carpeta) {
  const ruta = path.join(carpeta, CERROJO);
  try {
    const otro = JSON.parse(fs.readFileSync(ruta, 'utf8'));
    if (otro && otro.pid === process.pid) fs.unlinkSync(ruta);
  } catch (_) { /* ya no está */ }
}

function idDe(relojMesa, evaluaciones) {
  const h = crypto.createHash('sha256').update(JSON.stringify([relojMesa, evaluaciones.map(e => e.id)])).digest('hex').slice(0, 12);
  return `lab-${Number(relojMesa).toString(36)}-${h}`;
}

// → { ok, motivo, id?, hipotesis }
//   motivo: 'hecho' | 'ocupado' | 'sin_estado' | 'nada' | 'sin_incorporar' | 'error'
async function ejecutarLaboratorio(config, { llm } = {}) {
  const carpeta = path.resolve(config.carpetaDatos);
  if (!tomarCerrojo(carpeta)) return { ok: true, motivo: 'ocupado', hipotesis: 0 };
  try {
    const rutaResultado = path.join(carpeta, FICHEROS.laboratorio);
    if (fs.existsSync(rutaResultado)) return { ok: true, motivo: 'sin_incorporar', hipotesis: 0 };
    const guardado = Orquestador.leerEstadoGuardado(carpeta);
    if (!guardado || !guardado.laboratorio) return { ok: true, motivo: 'sin_estado', hipotesis: 0 };
    if (!guardado.laboratorio.hipotesis.some(pendiente)) return { ok: true, motivo: 'nada', hipotesis: 0 };
    // Las piezas de mercado, como las del latido (en sintético, el reloj y la
    // semilla salen del estado). construir() no escribe nada si el estado existe.
    const piezas = construir({ ...config, carpetaDatos: carpeta }, {
      llm: llm || crearLLM({ apiKey: '', reloj: { tipo: 'simulado', ahora: () => 0 } }),
    });
    const { libros: _libros, ...resto } = guardado;
    const ctx = {
      estado: JSON.parse(JSON.stringify(resto)),
      reloj: piezas.reloj,
      datos: piezas.datos,
      fg: piezas.fg,
      universo: piezas.orquestador.universo,
      limites: config.limites,
      modo: piezas.orquestador.modo,
      opciones: {},
    };
    const relojMesa = piezas.reloj.ahora();
    const evaluaciones = await laboratorio.evaluarFueraDeBanda(ctx);
    const id = idDe(relojMesa, evaluaciones);
    escribirJSON(rutaResultado, { id, creado: Date.now(), relojMesa, basadoEn: guardado.guardado ?? null, evaluaciones }, { durable: true });
    return { ok: true, motivo: 'hecho', id, hipotesis: evaluaciones.length };
  } catch (e) {
    return { ok: false, motivo: 'error', detalle: e.message, hipotesis: 0 };
  } finally {
    soltarCerrojo(carpeta);
  }
}

async function main() {
  const config = crearConfig(leerArgs());
  const t0 = Date.now();
  const r = await ejecutarLaboratorio(config);
  const seg = ((Date.now() - t0) / 1000).toFixed(1);
  const textos = {
    hecho: `${r.hipotesis} hipótesis evaluadas; el próximo latido las incorpora (${r.id}).`,
    ocupado: 'Otro laboratorio sigue en marcha: no hago nada.',
    sin_estado: 'Sin estado.json todavía: no hay nada que evaluar.',
    nada: 'No hay hipótesis pendientes.',
    sin_incorporar: 'Hay un resultado que el latido aún no ha incorporado: no evalúo otro encima.',
  };
  if (!r.ok) {
    log.error(`laboratorio: ${r.detalle}`);
    console.error(`FALLO laboratorio (${seg} s): ${r.detalle}`);
    process.exit(1);
  }
  console.log(`Laboratorio (${seg} s): ${textos[r.motivo] || r.motivo}`);
  process.exit(0);
}

if (require.main === module) {
  main().catch(e => { console.error(`FALLO laboratorio: ${e.stack || e.message}`); process.exit(1); });
}

module.exports = { ejecutarLaboratorio, tomarCerrojo, soltarCerrojo, CERROJO };
