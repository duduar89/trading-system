'use strict';
// Ayudas de las pruebas de la web (ARQUITECTURA-WEB W5-W): una carpeta de
// datos temporal con la instantánea y los mensajes que dejaría un latido, el
// servidor en modo web con un almacén en memoria y un conLaMesa inyectado, y
// peticiones HTTP con las cabeceras que manda un navegador.

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { crearConfig } = require('../src/config');
const { crearServidor } = require('../src/servidor');
const { almacenMemoria } = require('../src/web/almacen');
const { crearMaqueta } = require('../web/js/maqueta.js');
const logMod = require('../src/util/log');

logMod.fijarNivel('silencio');

const RAIZ = path.join(__dirname, '..');
const creadas = [];
process.on('exit', () => { for (const c of creadas) { try { fs.rmSync(c, { recursive: true, force: true }); } catch (_) { /* ya no está */ } } });

function carpetaTemporal(prefijo = 'mesa-web-') {
  const c = fs.mkdtempSync(path.join(os.tmpdir(), prefijo));
  creadas.push(c);
  return c;
}

// Instantánea con la forma completa de §7 (la de la maqueta de la interfaz).
function instantaneaDePrueba(extra = {}) {
  const inst = crearMaqueta({ semilla: 7, ahora: Date.UTC(2026, 5, 1, 12) }).instantanea();
  return { ...inst, ...extra };
}

function escribirInstantanea(carpeta, inst) {
  const ruta = path.join(carpeta, 'instantanea.json');
  const tmp = `${ruta}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(inst));
  fs.renameSync(tmp, ruta);
}

function anadirMensaje(carpeta, m) {
  fs.appendFileSync(path.join(carpeta, 'mensajes.jsonl'), JSON.stringify(m) + '\n');
}

function configDePrueba(carpeta) {
  const config = crearConfig({ modo: 'sintetico', datos: carpeta });
  return config;
}

async function arrancarWeb({ carpeta = carpetaTemporal(), almacen, conLaMesa, interpretarMegafono, instantanea = instantaneaDePrueba(), usuarios = [['eduardo', 'clave-larga-de-prueba']], ...resto } = {}) {
  if (instantanea) escribirInstantanea(carpeta, instantanea);
  const alm = almacen === undefined ? almacenMemoria() : almacen;
  if (alm && alm.crearUsuario) for (const [u, c] of usuarios) await alm.crearUsuario({ usuario: u, clave: c });
  const config = configDePrueba(carpeta);
  const servidor = crearServidor({
    modo: 'web', config, raizWeb: path.join(RAIZ, 'web'), carpetaDatos: carpeta, almacen: alm,
    conLaMesa: conLaMesa || (async () => ({ ok: false, motivo: 'error', detalle: 'sin conLaMesa en la prueba' })),
    interpretarMegafono, version: 'prueba-1', ...resto,
  });
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  const puerto = servidor.address().port;
  const base = `http://127.0.0.1:${puerto}`;
  return {
    servidor, carpeta, config, almacen: alm, puerto, base,
    cerrar: () => new Promise(r => servidor.close(() => r())),
  };
}

// Petición con las cabeceras de un navegador en el mismo origen. `cookie`
// es el valor mesa_sesion=… (o nada).
function pedir(base, ruta, { metodo = 'GET', cuerpo, cookie, cabeceras = {}, origen = true, crudo = false } = {}) {
  const u = new URL(ruta, base);
  const h = { ...cabeceras };
  if (cookie) h.cookie = cookie;
  if (origen && metodo !== 'GET' && h.origin === undefined) h.origin = base;
  let datos = null;
  if (cuerpo !== undefined) {
    datos = typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo);
    if (h['content-type'] === undefined) h['content-type'] = 'application/json';
    h['content-length'] = Buffer.byteLength(datos);
  }
  return new Promise((resolver, rechazar) => {
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: metodo, headers: h }, res => {
      const trozos = [];
      res.on('data', t => trozos.push(t));
      res.on('end', () => {
        const texto = Buffer.concat(trozos).toString('utf8');
        let json = null;
        if (!crudo) { try { json = JSON.parse(texto); } catch (_) { json = null; } }
        resolver({ status: res.statusCode, headers: res.headers, texto, json });
      });
    });
    req.on('error', rechazar);
    if (datos !== null) req.write(datos);
    req.end();
  });
}

// Entra y devuelve la cookie «mesa_sesion=…» (o lanza).
async function entrar(base, usuario = 'eduardo', clave = 'clave-larga-de-prueba', cabeceras = {}) {
  const r = await pedir(base, '/api/login', { metodo: 'POST', cuerpo: { usuario, clave }, cabeceras });
  if (r.status !== 200) throw new Error(`login ${r.status}: ${r.texto}`);
  const sc = [].concat(r.headers['set-cookie'] || [])[0] || '';
  return sc.split(';')[0];
}

// SSE: abre /api/eventos y junta los eventos. { eventos, esperar(fn, ms), cerrar }.
function abrirSSE(base, cookie) {
  const u = new URL('/api/eventos', base);
  const eventos = [];
  let resto = '';
  let res = null;
  const esperas = [];
  const revisar = () => {
    for (const e of esperas.slice()) {
      if (e.fn(eventos)) { esperas.splice(esperas.indexOf(e), 1); clearTimeout(e.t); e.ok(eventos); }
    }
  };
  const abierto = new Promise((resolver, rechazar) => {
    const req = http.get({ hostname: u.hostname, port: u.port, path: u.pathname, headers: { cookie, accept: 'text/event-stream' } }, r => {
      res = r;
      resolver(r);
      r.setEncoding('utf8');
      r.on('data', t => {
        resto += t;
        let i;
        while ((i = resto.indexOf('\n\n')) >= 0) {
          const bloque = resto.slice(0, i);
          resto = resto.slice(i + 2);
          let evento = 'message';
          let data = '';
          for (const l of bloque.split('\n')) {
            if (l.startsWith('event: ')) evento = l.slice(7);
            else if (l.startsWith('data: ')) data += l.slice(6);
          }
          if (!data) continue;
          let d = data;
          try { d = JSON.parse(data); } catch (_) { /* texto */ }
          eventos.push({ evento, datos: d });
        }
        revisar();
      });
    });
    req.on('error', rechazar);
  });
  return {
    eventos,
    abierto,
    get respuesta() { return res; },
    esperar(fn, ms = 5000) {
      return new Promise((ok, mal) => {
        if (fn(eventos)) { ok(eventos); return; }
        const e = { fn, ok, t: setTimeout(() => { esperas.splice(esperas.indexOf(e), 1); mal(new Error(`SSE: no llegó lo esperado en ${ms} ms (${eventos.map(x => x.evento).join(', ')})`)); }, ms) };
        esperas.push(e);
      });
    },
    cerrar() { if (res) res.destroy(); },
  };
}

module.exports = {
  RAIZ, carpetaTemporal, instantaneaDePrueba, escribirInstantanea, anadirMensaje, configDePrueba, arrancarWeb, pedir, entrar, abrirSSE,
};
