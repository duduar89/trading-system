#!/usr/bin/env node
'use strict';
// Trae de Flowww los pacientes y las citas futuras (la facturación se queda fuera) para poder
// apagarlo sin perder nada. Paso a paso, qué pedir a Flowww y cómo leer el informe: docs/MIGRAR-FLOWWW.md
//
//   node scripts/importar-flowww.js --pacientes <csv> --citas <csv> [--mapa <json>] [--aplicar] [--sin-recordatorios]
//   node scripts/importar-flowww.js --deshacer [lote] [--aplicar]
//   node scripts/importar-flowww.js --recordatorios si|no [--cita <número>] [--aplicar]
//
// Sin --aplicar es un ensayo: no cambia nada y saca el informe (confidencial: trátalo como los CSV).
// Trabaja con la base del .env; para aplicar, con su CLAVE_CIFRADO.
const fs = require('fs');
const path = require('path');
const db = require('../servidor/db');
const I = require('../servidor/importacion-flowww');

const USO = `Uso:
  node scripts/importar-flowww.js --pacientes <csv> --citas <csv> [--mapa <json>] [--aplicar] [--sin-recordatorios]
      Importa (o, sin --aplicar, ensaya) los pacientes y las citas futuras de Flowww. Vale con uno de los dos ficheros.
      --mapa               qué columna es qué y qué es en la app cada servicio, profesional, cabina o estado de Flowww
      --sin-recordatorios  las citas que se traen no reciben la víspera ni las 2 horas (Flowww aún los manda)
  node scripts/importar-flowww.js --deshacer [lote] [--aplicar]
      Quita lo que metió la última importación (o la de ese lote) y nadie ha tocado.
  node scripts/importar-flowww.js --recordatorios si|no [--cita <número>] [--aplicar]
      Pone o quita los recordatorios a las citas futuras que se trajeron de Flowww (las que están a revisar
      porque en Flowww ya no son así, no: esas, una a una con --cita, cuando se vea que siguen en pie).
Sin --aplicar, nada cambia. Guía: docs/MIGRAR-FLOWWW.md`;

// Opción → si lleva valor.
const OPCIONES = {
  '--pacientes': 'valor', '--citas': 'valor', '--mapa': 'valor', '--recordatorios': 'valor', '--cita': 'valor', '--deshacer': 'opcional',
  '--aplicar': 'no', '--sin-recordatorios': 'no', '--ayuda': 'no', '-h': 'no',
};

class ErrorUso extends Error {}

function leerArgumentos(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const [nombre, conIgual] = argv[i].split(/=(.*)/s);
    const tipo = OPCIONES[nombre];
    if (!tipo) throw new ErrorUso(`No conozco «${argv[i]}»`);
    let valor = conIgual;
    if (tipo === 'no') valor = true;
    else if (valor === undefined && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) valor = argv[++i];
    if (tipo === 'valor' && !valor) throw new ErrorUso(`Falta el valor de ${nombre}`);
    o[nombre.replace(/^-+/, '')] = valor ?? true;
  }
  const modos = [o.pacientes || o.citas, o.deshacer, o.recordatorios].filter(Boolean).length;
  if (!o.ayuda && !o.h && modos !== 1) throw new ErrorUso('Di qué hacer: importar (--pacientes y/o --citas), --deshacer o --recordatorios');
  if ((o.mapa || o['sin-recordatorios']) && !(o.pacientes || o.citas)) throw new ErrorUso('--mapa y --sin-recordatorios van con --pacientes o --citas');
  if (o.recordatorios && !['si', 'sí', 'no'].includes(String(o.recordatorios).toLowerCase())) throw new ErrorUso('--recordatorios va con «si» o «no»');
  if (o.cita && !o.recordatorios) throw new ErrorUso('--cita va con --recordatorios');
  if (o.cita && !/^\d{1,10}$/.test(String(o.cita))) throw new ErrorUso('--cita va con el número de la cita en la app');
  return o;
}

function leerFichero(ruta) {
  if (!ruta) return null;
  if (!fs.existsSync(ruta)) throw new I.ErrorImportacion(`No encuentro el fichero ${ruta}`);
  return { nombre: path.basename(ruta), contenido: fs.readFileSync(ruta) };
}

function leerMapa(ruta) {
  if (!ruta) return null;
  const f = leerFichero(ruta);
  try {
    return JSON.parse(f.contenido.toString('utf8').replace(/^\uFEFF/, ''));
  } catch (err) {
    throw new I.ErrorImportacion(`El mapa ${f.nombre} no es un JSON válido: ${err.message}`);
  }
}

/** @returns el código de salida: 0 bien, 1 no se ha podido (o no se ha aplicado lo pedido), 2 mal llamado */
async function main(argv, { pool = null, escribir = console.log, avisar = console.error } = {}) {
  let o;
  try {
    o = leerArgumentos(argv);
  } catch (err) {
    if (!(err instanceof ErrorUso)) throw err;
    avisar(`✗ ${err.message}\n\n${USO}`);
    return 2;
  }
  if (o.ayuda || o.h) { escribir(USO); return 0; }
  const p = pool || db.pool();
  try {
    const aplicar = Boolean(o.aplicar);
    if (o.deshacer) {
      escribir((await I.deshacer(p, { lote: o.deshacer === true ? null : String(o.deshacer), aplicar })).informe);
      return 0;
    }
    if (o.recordatorios) {
      escribir((await I.cambiarRecordatorios(p, { activar: String(o.recordatorios).toLowerCase() !== 'no', cita: o.cita ? Number(o.cita) : null, aplicar })).informe);
      return 0;
    }
    const r = await I.importar(p, {
      pacientes: leerFichero(o.pacientes), citas: leerFichero(o.citas), mapa: leerMapa(o.mapa), aplicar, sinRecordatorios: Boolean(o['sin-recordatorios']),
    });
    escribir(r.informe);
    return aplicar && !r.aplicado ? 1 : 0;
  } catch (err) {
    if (!(err instanceof I.ErrorImportacion)) throw err;
    avisar(`✗ ${err.message}`);
    return 1;
  } finally {
    if (!pool) await db.cerrar();
  }
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((codigo) => { process.exitCode = codigo; })
    .catch(async (err) => { console.error(`✗ ${err.stack || err.message}`); await db.cerrar(); process.exitCode = 1; });
}

module.exports = { main, leerArgumentos, ErrorUso };
