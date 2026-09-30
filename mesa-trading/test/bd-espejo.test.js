'use strict';
// Espejo de los JSONL en MariaDB (ARQUITECTURA-WEB W4 y W5-D): idempotente
// (dos veces → mismas filas), incremental, tolera ficheros que no existen y
// una última línea a medio escribir. Cada prueba usa sus propias tablas
// (copias vacías de mesa_registros y mesa_latidos) para no pisarse con otras
// que corren a la vez sobre la misma base.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sincronizar, leerLineasCompletas, FUENTES } = require('../src/bd/espejo');
const { motivoSalto, prepararBD, sufijo } = require('./bd-ayuda');

function carpetaTemporal(t) {
  const c = fs.mkdtempSync(path.join(os.tmpdir(), 'mesa-espejo-'));
  t.after(() => fs.rmSync(c, { recursive: true, force: true }));
  return c;
}
const escribir = (c, f, texto) => fs.appendFileSync(path.join(c, f), texto);
const linea = o => `${JSON.stringify(o)}\n`;

async function tablasPropias(t) {
  const { pool, alAcabar } = await prepararBD(t);
  const s = sufijo();
  const tablas = { registros: `mesa_registros_p${s}`, latidos: `mesa_latidos_p${s}` };
  await pool.query(`CREATE TABLE ${tablas.registros} LIKE mesa_registros`);
  await pool.query(`CREATE TABLE ${tablas.latidos} LIKE mesa_latidos`);
  alAcabar(async () => {
    await pool.query(`DROP TABLE IF EXISTS ${tablas.registros}`);
    await pool.query(`DROP TABLE IF EXISTS ${tablas.latidos}`);
  });
  const filas = async () => (await pool.query(`SELECT fuente, linea, t, datos FROM ${tablas.registros} ORDER BY fuente, linea`))[0];
  const latidos = async () => (await pool.query(`SELECT id, inicio, ms, ok, resumen FROM ${tablas.latidos} ORDER BY id`))[0];
  return { pool, tablas, filas, latidos };
}

test('leerLineasCompletas: solo hasta el último salto de línea, sin partir caracteres', (t) => {
  const c = carpetaTemporal(t);
  const ruta = path.join(c, 'x.jsonl');
  fs.writeFileSync(ruta, '{"a":"ñ"}\n{"b":"€"}\n{"c":');
  const r = leerLineasCompletas(ruta, 0);
  assert.deepEqual(r.lineas, ['{"a":"ñ"}', '{"b":"€"}']);
  assert.equal(r.bytes, Buffer.byteLength('{"a":"ñ"}\n{"b":"€"}\n'));
  // Con un tope más corto que una línea, se lee esa línea entera.
  const r2 = leerLineasCompletas(ruta, 0, 3);
  assert.deepEqual(r2.lineas, ['{"a":"ñ"}']);
  // Desde el final de lo completo: la línea a medias no sale.
  assert.deepEqual(leerLineasCompletas(ruta, r.bytes).lineas, []);
  // CRLF de Windows: la \r no se queda en el texto.
  fs.writeFileSync(ruta, '{"a":1}\r\n');
  assert.deepEqual(leerLineasCompletas(ruta, 0).lineas, ['{"a":1}']);
});

test('sin DB_* no hace nada y no falla', async (t) => {
  const c = carpetaTemporal(t);
  escribir(c, 'operaciones.jsonl', linea({ t: 1 }));
  const r = await sincronizar({ carpetaDatos: c }, { entorno: {} });
  assert.equal(r.copiados, 0);
  assert.match(r.omitido, /DB_/);
  assert.equal(fs.existsSync(path.join(c, 'espejo.json')), false);
});

test('espejo: todas las fuentes, idempotente, incremental y con la última línea a medias', { skip: motivoSalto }, async (t) => {
  const { pool, tablas, filas, latidos } = await tablasPropias(t);
  const c = carpetaTemporal(t);
  const config = { carpetaDatos: c };
  // Una línea por fuente (salvo ordenes, que aún no existe) y cosas raras.
  escribir(c, 'operaciones.jsonl', linea({ t: 1000, id: 'op1', pnl: 12.5 }) + linea({ t: 2000, id: 'op2' }));
  escribir(c, 'operaciones-sombra.jsonl', linea({ t: 1500, id: 's1' }));
  escribir(c, 'incidentes.jsonl', linea({ t: 3000, tipo: 'prueba', texto: 'ñandú €' }));
  escribir(c, 'llm-costes.jsonl', linea({ t: 4000, usd: 0.0012 }));
  escribir(c, 'informes.jsonl', linea({ t: 5000, tipo: 'diario' }));
  escribir(c, 'mensajes.jsonl', linea({ t: 6000, texto: 'hola' }) + '\n' + 'esto no es json\n' + linea({ t: 7000, texto: 'adiós' }) + '{"t":8000,"texto":"a me');
  escribir(c, 'latidos.jsonl', linea({ t: 1_790_000_000_000, inicio: 1_790_000_000_000, ms: 1234, ok: true, resumen: 'x'.repeat(300) }) + linea({ inicio: 1_790_000_060_000, ms: 50, ok: false, resumen: 'ocupado' }));

  const r1 = await sincronizar(config, { pool, tablas });
  assert.equal(r1.copiados, 11);
  assert.equal(r1.fuentes.ordenes.noExiste, true, 'un fichero que no existe se salta');
  assert.equal(r1.fuentes.mensajes.copiados, 3, 'ni la vacía ni la de a medias');
  assert.equal(r1.fuentes.mensajes.linea, 4, 'la vacía cuenta como línea');

  const antes = await filas();
  assert.equal(antes.length, 11);
  const mensajes = antes.filter(f => f.fuente === 'mensajes');
  assert.deepEqual(mensajes.map(f => [f.linea, f.t]), [[1, 6000], [3, null], [4, 7000]]);
  assert.equal(mensajes[1].datos, 'esto no es json', 'lo que no es JSON se copia tal cual');
  assert.deepEqual(JSON.parse(antes.find(f => f.fuente === 'incidentes').datos), { t: 3000, tipo: 'prueba', texto: 'ñandú €' });
  assert.equal(antes.find(f => f.fuente === 'latidos' && f.linea === 2).t, 1_790_000_060_000, 'sin t, el instante del latido es su inicio');

  const l = await latidos();
  assert.deepEqual(l.map(x => [x.id, x.inicio.getTime(), x.ms, x.ok, x.resumen.length]), [[1, 1_790_000_000_000, 1234, 1, 255], [2, 1_790_000_060_000, 50, 0, 7]]);

  // Dos veces → mismas filas.
  const r2 = await sincronizar(config, { pool, tablas });
  assert.equal(r2.copiados, 0);
  assert.deepEqual(await filas(), antes);

  // Se termina la línea a medias y llega otra: solo esas dos.
  escribir(c, 'mensajes.jsonl', 'nsaje"}\n' + linea({ t: 9000, texto: 'otra' }));
  escribir(c, 'ordenes.jsonl', linea({ t: 8500, idCliente: 'o1' }));
  const r3 = await sincronizar(config, { pool, tablas });
  assert.equal(r3.copiados, 3);
  const despues = await filas();
  assert.deepEqual(despues.filter(f => f.fuente === 'mensajes').map(f => [f.linea, f.t]), [[1, 6000], [3, null], [4, 7000], [5, 8000], [6, 9000]]);
  assert.equal(JSON.parse(despues.find(f => f.fuente === 'mensajes' && f.linea === 5).datos).texto, 'a mensaje');

  // Se pierde data/espejo.json: se vuelve a copiar todo y no se duplica nada.
  const pos = JSON.parse(fs.readFileSync(path.join(c, 'espejo.json'), 'utf8'));
  assert.deepEqual(Object.keys(pos).sort(), Object.keys(FUENTES).sort());
  fs.unlinkSync(path.join(c, 'espejo.json'));
  const r4 = await sincronizar(config, { pool, tablas });
  assert.equal(r4.copiados, despues.length, 'se recorre todo otra vez…');
  assert.deepEqual(await filas(), despues, '…y quedan las mismas filas');
  assert.equal((await latidos()).length, 2);
  assert.equal(fs.existsSync(path.join(c, '.espejo')), false, 'el cerrojo se suelta');
});

test('espejo: con tope por llamada, un historial largo entra en varias y sin huecos', { skip: motivoSalto }, async (t) => {
  const { pool, tablas, filas } = await tablasPropias(t);
  const c = carpetaTemporal(t);
  let texto = '';
  for (let i = 1; i <= 500; i++) texto += linea({ t: i, relleno: 'x'.repeat(50) });
  escribir(c, 'mensajes.jsonl', texto);
  let vueltas = 0;
  let r;
  do {
    r = await sincronizar({ carpetaDatos: c }, { pool, tablas, maxBytes: 4096 });
    vueltas += 1;
  } while (r.fuentes.mensajes.pendiente && vueltas < 100);
  assert.ok(vueltas > 5, `varias llamadas (${vueltas})`);
  const f = await filas();
  assert.equal(f.length, 500);
  assert.deepEqual(f.map(x => x.linea), Array.from({ length: 500 }, (_, i) => i + 1));
  assert.deepEqual(f.map(x => x.t), Array.from({ length: 500 }, (_, i) => i + 1), 'cada línea con su número');
});

test('espejo: con el cerrojo cogido no copia; uno abandonado se toma', { skip: motivoSalto }, async (t) => {
  const { pool, tablas, filas } = await tablasPropias(t);
  const c = carpetaTemporal(t);
  escribir(c, 'incidentes.jsonl', linea({ t: 1 }));
  const cerrojo = path.join(c, '.espejo');
  fs.writeFileSync(cerrojo, '{}');
  const ocupado = await sincronizar({ carpetaDatos: c }, { pool, tablas });
  assert.equal(ocupado.ocupado, true);
  assert.equal((await filas()).length, 0);
  const viejo = (Date.now() - 11 * 60 * 1000) / 1000;
  fs.utimesSync(cerrojo, viejo, viejo);
  const r = await sincronizar({ carpetaDatos: c }, { pool, tablas });
  assert.equal(r.copiados, 1);
});

test('espejo: un fichero sustituido por otro más corto se vuelve a copiar desde el principio', { skip: motivoSalto }, async (t) => {
  const { pool, tablas, filas } = await tablasPropias(t);
  const c = carpetaTemporal(t);
  escribir(c, 'informes.jsonl', linea({ t: 1, a: 'largo-largo' }) + linea({ t: 2 }));
  await sincronizar({ carpetaDatos: c }, { pool, tablas });
  fs.writeFileSync(path.join(c, 'informes.jsonl'), linea({ t: 3 }));
  const r = await sincronizar({ carpetaDatos: c }, { pool, tablas });
  assert.equal(r.fuentes.informes.reiniciada, true);
  const f = (await filas()).filter(x => x.fuente === 'informes');
  assert.deepEqual(f.map(x => [x.linea, x.t]), [[1, 3], [2, 2]], 'la línea 1 es la del fichero de ahora');
});
