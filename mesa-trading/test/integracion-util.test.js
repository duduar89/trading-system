'use strict';
// Piezas base que usa todo el núcleo: persistencia (Windows: ficheros
// bloqueados un instante, cortes de luz), formato de cifras, variables de
// entorno y el bloqueo de un solo proceso por carpeta de datos.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { carpetaTemporal } = require('./integracion-ayuda');
const { leerJSON, escribirJSON } = require('../src/util/almacen');
const f = require('../src/util/formato');
const { num, esLoopback, cargarEnv } = require('../src/config');
const { tomarBloqueo, soltarBloqueo, rutaBloqueo } = require('../src/util/proceso');

// fs.readFileSync / fs.renameSync fallan `veces` veces con `codigo` (EBUSY, EPERM…).
function fallar(metodo, codigo, veces = Infinity, filtro = () => true) {
  const original = fs[metodo];
  const control = { fallos: 0 };
  fs[metodo] = (...args) => {
    if (control.fallos < veces && filtro(...args)) {
      control.fallos++;
      const e = new Error(`${codigo}: resource busy or locked, ${metodo} '${args[0]}'`);
      e.code = codigo;
      throw e;
    }
    return original(...args);
  };
  control.restaurar = () => { fs[metodo] = original; };
  return control;
}

test('leerJSON crítico: un EBUSY de un instante se reintenta y NO se aparta el fichero', () => {
  const c = carpetaTemporal();
  const ruta = path.join(c, 'estado.json');
  escribirJSON(ruta, { nivel: 'bloqueado' });
  const f1 = fallar('readFileSync', 'EBUSY', 2, r => r === ruta);
  let leido;
  try { leido = leerJSON(ruta, null, { critico: true }); } finally { f1.restaurar(); }
  assert.equal(f1.fallos, 2);
  assert.deepEqual(leido, { nivel: 'bloqueado' });
  assert.deepEqual(fs.readdirSync(c), ['estado.json'], 'nada apartado como .corrupto');
});

test('leerJSON crítico: un JSON roto (a ceros tras un corte de luz) lanza y deja el fichero donde está', () => {
  const c = carpetaTemporal();
  const ruta = path.join(c, 'estado.json');
  fs.writeFileSync(ruta, Buffer.alloc(64));            // NTFS tras un corte: el tamaño, a ceros
  assert.throws(() => leerJSON(ruta, null, { critico: true }), /no es un JSON válido/);
  assert.deepEqual(fs.readdirSync(c), ['estado.json']);
  // Sin crítico (una caché): se aparta y se usa el valor por defecto, como siempre.
  assert.equal(leerJSON(ruta, 'defecto'), 'defecto');
  assert.ok(fs.readdirSync(c).some(x => x.startsWith('estado.json.corrupto-')));
  assert.ok(!fs.existsSync(ruta));
  // No existe: valor por defecto, también crítico.
  assert.equal(leerJSON(ruta, null, { critico: true }), null);
});

test('leerJSON sin crítico: un fichero bloqueado no se aparta (no está roto)', () => {
  const c = carpetaTemporal();
  const ruta = path.join(c, 'cache.json');
  escribirJSON(ruta, { a: 1 });
  const f1 = fallar('readFileSync', 'EPERM', 1, r => r === ruta);
  try { assert.equal(leerJSON(ruta, 'defecto'), 'defecto'); } finally { f1.restaurar(); }
  assert.deepEqual(fs.readdirSync(c), ['cache.json']);
  assert.deepEqual(leerJSON(ruta, null), { a: 1 });
});

test('escribirJSON: un EPERM de un instante al renombrar (OneDrive, antivirus) se reintenta; si sigue, lanza sin dejar el .tmp', () => {
  const c = carpetaTemporal();
  const ruta = path.join(c, 'estado.json');
  const f1 = fallar('renameSync', 'EPERM', 3);
  try { escribirJSON(ruta, { v: 1 }, { durable: true }); } finally { f1.restaurar(); }
  assert.equal(f1.fallos, 3);
  assert.deepEqual(leerJSON(ruta, null), { v: 1 });
  const f2 = fallar('renameSync', 'EBUSY');
  try { assert.throws(() => escribirJSON(ruta, { v: 2 }), /EBUSY/); } finally { f2.restaurar(); }
  assert.deepEqual(fs.readdirSync(c), ['estado.json'], 'sin temporales sueltos');
  assert.deepEqual(leerJSON(ruta, null), { v: 1 }, 'el bueno sigue intacto');
});

test('formato: un cero redondeado no lleva signo («-0,00 %» parecería una pérdida)', () => {
  assert.equal(f.pct(-0), '0,00 %');
  assert.equal(f.pct(-0.0000283, { signo: true }), '0,00 %');
  assert.equal(f.pct(0.0000025, { signo: true }), '0,00 %');
  assert.equal(f.usd(-0), '0,00 $');
  assert.equal(f.usd(-0.001, { signo: true }), '0,00 $');
  assert.equal(f.numero(-0.3), '0');
  // Las pérdidas de verdad no cambian.
  assert.equal(f.usd(-1234.5), '-1.235 $');
  assert.equal(f.pct(-0.00005), '-0,01 %');
  assert.equal(f.usd(12, { signo: true }), '+12,00 $');
  assert.equal(f.pct(0.0125, { signo: true }), '+1,25 %');
});

test('config.num: «0,5» es 0,5; lo que no es un número para el arranque con el nombre de la variable', () => {
  const guarda = process.env.PRUEBA_NUM;
  try {
    const leer = v => { if (v === undefined) delete process.env.PRUEBA_NUM; else process.env.PRUEBA_NUM = v; return num('PRUEBA_NUM', 2); };
    assert.equal(leer('0,5'), 0.5);
    assert.equal(leer(' 1,25 '), 1.25);
    assert.equal(leer('0.5'), 0.5);
    assert.equal(leer('100000'), 100000);
    assert.equal(leer(''), 2);
    assert.equal(leer('   '), 2, 'solo espacios: el valor por defecto (antes daba 0)');
    assert.equal(leer(undefined), 2);
    assert.throws(() => leer('abc'), /PRUEBA_NUM=abc no es un número/);
    assert.throws(() => leer('1.000,5'), /PRUEBA_NUM/);
  } finally {
    if (guarda === undefined) delete process.env.PRUEBA_NUM; else process.env.PRUEBA_NUM = guarda;
  }
});

test('config: HOST de loopback o abierto a la red; el proxy en el .env no se copia (Node solo lo lee al arrancar)', () => {
  for (const h of ['127.0.0.1', 'localhost', '::1', '[::1]', '127.0.1.1']) assert.equal(esLoopback(h), true, h);
  for (const h of ['0.0.0.0', '::', '192.168.1.20', 'mi-portatil.local', '']) assert.equal(esLoopback(h), false, h);
  const c = carpetaTemporal();
  const ruta = path.join(c, '.env');
  fs.writeFileSync(ruta, 'NODE_USE_ENV_PROXY=1\nHTTPS_PROXY=http://proxy:3128\nPRUEBA_ENV_X=7\n');
  const antes = { a: process.env.NODE_USE_ENV_PROXY, b: process.env.HTTPS_PROXY };
  delete process.env.PRUEBA_ENV_X;
  try {
    const r = cargarEnv(ruta);
    assert.deepEqual(r.ignoradas.sort(), ['HTTPS_PROXY', 'NODE_USE_ENV_PROXY']);
    assert.equal(process.env.PRUEBA_ENV_X, '7');
    assert.equal(process.env.NODE_USE_ENV_PROXY, antes.a);
    assert.equal(process.env.HTTPS_PROXY, antes.b);
  } finally {
    delete process.env.PRUEBA_ENV_X;
  }
});

test('un solo proceso por carpeta: otro pid vivo → error claro; un pid muerto o el mismo proceso → se toma', () => {
  const c = carpetaTemporal();
  const ruta = rutaBloqueo(c);
  // Otro proceso vivo (el padre de este sigue vivo mientras corre la prueba).
  fs.writeFileSync(ruta, JSON.stringify({ pid: process.ppid, host: require('os').hostname(), desde: '2026-09-30T10:00:00Z' }));
  assert.throws(() => tomarBloqueo(c), err => err.code === 'EBLOQUEO' && /Otra mesa ya usa la carpeta/.test(err.message) && err.message.includes(ruta));
  // Un pid que ya no existe: el proceso murió sin soltarlo.
  fs.writeFileSync(ruta, JSON.stringify({ pid: 2 ** 22 + 12345, host: require('os').hostname() }));
  assert.equal(tomarBloqueo(c).tomado, true);
  assert.equal(JSON.parse(fs.readFileSync(ruta, 'utf8')).pid, process.pid);
  // El mismo proceso puede volver a tomarlo (la demo reinicia el orquestador).
  assert.equal(tomarBloqueo(c).reentrada, true);
  soltarBloqueo(c);
  assert.ok(!fs.existsSync(ruta));
  // Otra máquina (carpeta compartida): no se puede saber si vive → se niega.
  fs.writeFileSync(ruta, JSON.stringify({ pid: process.pid, host: 'otro-portatil' }));
  assert.throws(() => tomarBloqueo(c), /otro-portatil/);
});

// La web matada a mitad de un botón deja un cerrojo de un pid muerto, y el
// latido del minuto y otro botón lo ven a la vez: antes, el segundo borraba el
// cerrojo que el primero acababa de tomar y acababan los dos dueños.
test('cerrojo de un pid muerto visto por muchos procesos a la vez: UN solo dueño', async () => {
  const { fork } = require('child_process');
  const os = require('os');
  const hijo = `
    const { tomarBloqueo } = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'util', 'proceso.js'))});
    process.on('message', carpeta => {
      let ok = false;
      try { tomarBloqueo(carpeta); ok = true; } catch (e) { if (e.code !== 'EBLOQUEO') throw e; }
      setTimeout(() => { process.send(ok); process.exit(0); }, 200);
    });
    process.send('listo');`;
  const fichero = path.join(carpetaTemporal(), 'hijo-cerrojo.js');
  fs.writeFileSync(fichero, hijo);
  for (let ronda = 0; ronda < 8; ronda++) {
    const c = carpetaTemporal();
    fs.writeFileSync(rutaBloqueo(c), JSON.stringify({ pid: 2 ** 22 + 54321, host: os.hostname() }));
    const hijos = Array.from({ length: 6 }, () => fork(fichero));
    await Promise.all(hijos.map(h => new Promise(r => h.once('message', r))));
    const respuestas = Promise.all(hijos.map(h => new Promise(r => h.once('message', r))));
    for (const h of hijos) h.send(c);
    const dueños = (await respuestas).filter(Boolean).length;
    assert.equal(dueños, 1, `ronda ${ronda}: ${dueños} dueños a la vez`);
    assert.equal(fs.existsSync(`${rutaBloqueo(c)}.romper`), false, 'no queda el .romper');
  }
});
