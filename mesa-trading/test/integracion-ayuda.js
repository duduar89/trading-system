'use strict';
// Ayudas de las pruebas de integración: un orquestador sintético en una
// carpeta temporal, sin LLM (salvo que se inyecte uno falso) y sin tocar data/.

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { crearConfig } = require('../src/config');
const { construir } = require('../src/index');
const { crearLLM } = require('../src/agentes/llm');
const { crearServidor } = require('../src/servidor');
const logMod = require('../src/util/log');

const INICIO = Date.UTC(2026, 5, 1);   // lunes 1-jun-2026 00:00 UTC
const PASO = 5 * 60_000;

logMod.fijarNivel('silencio');

// Las carpetas temporales se borran al acabar el proceso de pruebas.
const creadas = [];
process.on('exit', () => { for (const c of creadas) { try { fs.rmSync(c, { recursive: true, force: true }); } catch (_) { /* ya no está */ } } });

function carpetaTemporal(prefijo = 'mesa-prueba-') {
  const c = fs.mkdtempSync(path.join(os.tmpdir(), prefijo));
  creadas.push(c);
  return c;
}

function llmApagado() {
  return crearLLM({ apiKey: '', reloj: { tipo: 'simulado', ahora: () => 0 } });
}

async function crearOrquestador({ carpeta = carpetaTemporal(), semilla = 42, inicio = INICIO, llm = llmApagado(), opciones = {}, pasos = 0 } = {}) {
  const config = crearConfig({ modo: 'sintetico', datos: carpeta, semilla: String(semilla) });
  config.inicio = inicio;
  const piezas = construir(config, { llm, opciones: { comiteEnSegundoPlano: false, pausaComiteMs: 0, intervaloEstadoMs: 0, ...opciones } });
  await piezas.orquestador.iniciar();
  for (let i = 0; i < pasos; i++) {
    piezas.reloj.avanzar(PASO);
    await piezas.orquestador.paso();
  }
  return { ...piezas, config, carpeta };
}

async function arrancarServidor(orquestador, { token = '' } = {}) {
  const servidor = crearServidor({ orquestador, raizWeb: path.join(__dirname, '..', 'web'), carpetaDatos: orquestador.carpeta, token, pingMs: 200 });
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  const { port } = servidor.address();
  return { servidor, base: `http://127.0.0.1:${port}`, puerto: port };
}

function pedir(base, ruta, { metodo = 'GET', cuerpo, cabeceras = {} } = {}) {
  return new Promise((resolver, rechazar) => {
    const url = new URL(ruta, base);
    const datos = cuerpo === undefined ? null : (typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo));
    const req = http.request(url, { method: metodo, headers: { ...(datos ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(datos) } : {}), ...cabeceras } }, res => {
      const trozos = [];
      res.on('data', t => trozos.push(t));
      res.on('end', () => {
        const texto = Buffer.concat(trozos).toString('utf8');
        let json = null;
        try { json = JSON.parse(texto); } catch (_) { /* no es JSON */ }
        resolver({ status: res.statusCode, cabeceras: res.headers, texto, json });
      });
    });
    req.on('error', rechazar);
    if (datos) req.write(datos);
    req.end();
  });
}

// Abre el SSE y va guardando los eventos. `esperar(tipo)` resuelve con el primero de ese tipo.
function abrirSSE(base, ruta = '/api/eventos') {
  const eventos = [];
  const esperando = [];
  let resto = '';
  let req;
  const listo = new Promise((resolver, rechazar) => {
    req = http.get(new URL(ruta, base), res => {
      resolver(res);
      res.setEncoding('utf8');
      res.on('data', trozo => {
        resto += trozo;
        let i;
        while ((i = resto.indexOf('\n\n')) >= 0) {
          const bloque = resto.slice(0, i);
          resto = resto.slice(i + 2);
          const ev = /^event: (.+)$/m.exec(bloque);
          const dt = /^data: (.+)$/m.exec(bloque);
          if (!ev) continue;
          const e = { tipo: ev[1], datos: dt ? JSON.parse(dt[1]) : null };
          eventos.push(e);
          for (const w of [...esperando]) if (w.tipo === e.tipo) { esperando.splice(esperando.indexOf(w), 1); w.resolver(e); }
        }
      });
    });
    req.on('error', rechazar);
  });
  return {
    listo,
    eventos,
    esperar(tipo, ms = 5000) {
      const ya = eventos.find(e => e.tipo === tipo);
      if (ya) return Promise.resolve(ya);
      return new Promise((resolver, rechazar) => {
        const w = { tipo, resolver };
        esperando.push(w);
        setTimeout(() => rechazar(new Error(`sin evento ${tipo} en ${ms} ms`)), ms).unref();
      });
    },
    cerrar() { req.destroy(); },
  };
}

module.exports = { INICIO, PASO, carpetaTemporal, llmApagado, crearOrquestador, arrancarServidor, pedir, abrirSSE };
