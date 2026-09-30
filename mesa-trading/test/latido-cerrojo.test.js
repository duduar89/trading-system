'use strict';
// Motor por latido (docs/ARQUITECTURA-WEB.md W2, W5-M): cerrojo, vigía,
// laboratorio fuera de banda, comité convocado y la instantánea.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { carpetaTemporal, llmApagado, INICIO } = require('./integracion-ayuda');
const { crearConfig } = require('../src/config');
const { conLaMesa, latido, FICHEROS, SALA_TRAS_COMITE_MS } = require('../src/latido');
const { ejecutarLaboratorio, tomarCerrojo, soltarCerrojo, CERROJO } = require('../scripts/laboratorio');
const scriptLatido = require('../scripts/latido');
const { leerJSON, leerJSONL, escribirJSON } = require('../src/util/almacen');
const { JEFES } = require('../src/agentes/comite');
const { MIN } = require('../src/util/reloj');

const RAIZ = path.resolve(__dirname, '..');

function configEn(carpeta) {
  const config = crearConfig({ modo: 'sintetico', datos: carpeta, semilla: '42' });
  config.inicio = INICIO;
  return config;
}

const cerrojoCogido = carpeta => fs.existsSync(path.join(carpeta, '.proceso'));

// Otro proceso vivo de esta máquina (el padre de esta prueba; el pid 1 no
// vale en Windows) y un pid que ya no existe.
const otroVivo = () => process.ppid;
async function pidMuerto() {
  const h = spawn(process.execPath, ['-e', '0'], { stdio: 'ignore' });
  await new Promise(r => h.on('close', r));
  return h.pid;
}
const cerrojoDe = pid => JSON.stringify({ pid, host: require('os').hostname(), desde: new Date().toISOString() });

test('conLaMesa: dos a la vez sobre la misma carpeta → una ejecuta y la otra sale «ocupado»', async () => {
  const config = configEn(carpetaTemporal());
  let soltar;
  const bloqueo = new Promise(r => { soltar = r; });
  let dentro;
  const enMarcha = new Promise(r => { dentro = r; });
  const primera = conLaMesa(config, async orq => { dentro(); await bloqueo; return orq.estado.fondo.nivel; }, { llm: llmApagado() });
  await enMarcha;
  const t0 = Date.now();
  const segunda = await conLaMesa(config, () => 'no debería correr', { espera: 300, llm: llmApagado() });
  assert.equal(segunda.ok, false);
  assert.equal(segunda.motivo, 'ocupado');
  assert.ok(Date.now() - t0 >= 250, 'espera antes de rendirse');
  soltar();
  const r = await primera;
  assert.deepEqual(r, { ok: true, resultado: 'normal' });
  assert.equal(cerrojoCogido(config.carpetaDatos), false);
  // Con el cerrojo ya suelto, la siguiente entra.
  const tercera = await conLaMesa(config, () => 'ya', { llm: llmApagado() });
  assert.deepEqual(tercera, { ok: true, resultado: 'ya' });
});

test('conLaMesa: con espera, la segunda entra en cuanto la primera suelta', async () => {
  const config = configEn(carpetaTemporal());
  const orden = [];
  const a = conLaMesa(config, async () => { orden.push('a'); await new Promise(r => setTimeout(r, 400)); orden.push('a fin'); }, { llm: llmApagado() });
  await new Promise(r => setTimeout(r, 50));
  const b = await conLaMesa(config, () => { orden.push('b'); return 1; }, { espera: 5000, llm: llmApagado() });
  await a;
  assert.equal(b.ok, true);
  assert.deepEqual(orden, ['a', 'a fin', 'b']);
});

test('conLaMesa: una excepción dentro de fn suelta el cerrojo y no guarda el estado a medias', async () => {
  const config = configEn(carpetaTemporal());
  const r0 = await latido(config, { llm: llmApagado() });
  assert.equal(r0.ok, true);
  const antes = fs.readFileSync(path.join(config.carpetaDatos, 'estado.json'), 'utf8');
  const r = await conLaMesa(config, orq => {
    orq.estado.fondo.nivel = 'pausado';   // cambio a medias que no debe quedar
    throw new Error('fallo a propósito');
  }, { llm: llmApagado() });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'error');
  assert.match(r.detalle, /fallo a propósito/);
  assert.equal(cerrojoCogido(config.carpetaDatos), false);
  assert.equal(fs.readFileSync(path.join(config.carpetaDatos, 'estado.json'), 'utf8'), antes);
  // Y se puede volver a entrar.
  const r2 = await latido(config, { llm: llmApagado() });
  assert.equal(r2.ok, true);
  assert.equal(leerJSON(path.join(config.carpetaDatos, 'estado.json')).fondo.nivel, 'normal');
});

test('conLaMesa: un cerrojo de otro proceso vivo deja fuera; el de un pid muerto se toma', async () => {
  const config = configEn(carpetaTemporal());
  const ruta = path.join(config.carpetaDatos, '.proceso');
  fs.writeFileSync(ruta, cerrojoDe(otroVivo()));
  const r = await conLaMesa(config, () => 'no', { espera: 0, llm: llmApagado() });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'ocupado');
  assert.ok(fs.existsSync(ruta), 'el cerrojo ajeno no se toca');
  // Un pid que ya no existe (un latido que murió): se toma.
  fs.writeFileSync(ruta, cerrojoDe(await pidMuerto()));
  const r2 = await conLaMesa(config, () => 'sí', { llm: llmApagado() });
  assert.deepEqual(r2, { ok: true, resultado: 'sí' });
  assert.equal(fs.existsSync(ruta), false);
});

test('latido: avanza 5 min en sintético, publica la instantánea con latidoMs y apunta el latido', async () => {
  const config = configEn(carpetaTemporal());
  const r1 = await latido(config, { llm: llmApagado() });
  const r2 = await latido(config, { llm: llmApagado() });
  assert.equal(r1.ok && r2.ok, true);
  assert.ok(r1.ms >= 0 && typeof r1.resumen === 'string' && r1.resumen.length <= 255);
  const estado = leerJSON(path.join(config.carpetaDatos, 'estado.json'));
  assert.equal(estado.ahora, INICIO + 2 * 5 * MIN);
  const inst = leerJSON(path.join(config.carpetaDatos, FICHEROS.instantanea));
  assert.equal(inst.latidoMs, 60_000);
  assert.equal(inst.ahora, INICIO + 10 * MIN);
  assert.ok(Number.isFinite(inst.publicada));
  const latidos = leerJSONL(path.join(config.carpetaDatos, FICHEROS.latidos));
  assert.equal(latidos.length, 2);
  for (const l of latidos) {
    assert.equal(l.ok, true);
    assert.ok(Number.isFinite(l.inicio) && Number.isFinite(l.ms) && typeof l.resumen === 'string');
  }
  // Un comando no mueve el reloj.
  const c = await conLaMesa(config, orq => orq.comando('pausar', {}), { espera: 1000, llm: llmApagado() });
  assert.equal(c.ok && c.resultado.ok, true);
  assert.equal(leerJSON(path.join(config.carpetaDatos, 'estado.json')).ahora, INICIO + 10 * MIN);
  // Un latido con el cerrojo cogido no hace nada y lo apunta.
  fs.writeFileSync(path.join(config.carpetaDatos, '.proceso'), cerrojoDe(otroVivo()));
  const r3 = await latido(config, { llm: llmApagado() });
  assert.equal(r3.ok, false);
  assert.equal(r3.motivo, 'ocupado');
  assert.equal(leerJSON(path.join(config.carpetaDatos, 'estado.json')).ahora, INICIO + 10 * MIN);
  const ultimo = leerJSONL(path.join(config.carpetaDatos, FICHEROS.latidos)).pop();
  assert.equal(ultimo.ok, false);
  assert.match(ultimo.resumen, /^ocupado/);
  fs.unlinkSync(path.join(config.carpetaDatos, '.proceso'));
});

test('comité convocado desde fuera: queda pedido y se celebra en el latido siguiente; los jefes se ven en la sala 5 min', async () => {
  const config = configEn(carpetaTemporal());
  await latido(config, { llm: llmApagado() });
  const c = await conLaMesa(config, orq => orq.comando('comite', {}), { espera: 1000, llm: llmApagado() });
  assert.equal(c.resultado.ok, true);
  assert.match(c.resultado.mensaje, /próximo latido/);
  let estado = leerJSON(path.join(config.carpetaDatos, 'estado.json'));
  assert.ok(estado.comite.pedido);
  assert.equal(estado.comite.celebrados, 0);
  assert.equal(leerJSON(path.join(config.carpetaDatos, FICHEROS.instantanea)).cabecera.comitePedido, true);
  // Dos veces: sigue siendo uno.
  const c2 = await conLaMesa(config, orq => orq.comando('comite', {}), { espera: 1000, llm: llmApagado() });
  assert.match(c2.resultado.mensaje, /Ya estaba convocado/);

  await latido(config, { llm: llmApagado() });
  estado = leerJSON(path.join(config.carpetaDatos, 'estado.json'));
  assert.equal(estado.comite.pedido, null);
  assert.equal(estado.comite.celebrados, 1);
  assert.equal(estado.comite.salaHasta, estado.ahora + SALA_TRAS_COMITE_MS);
  const mensajes = leerJSONL(path.join(config.carpetaDatos, 'mensajes.jsonl'));
  assert.ok(mensajes.some(m => m.canal === 'comite' && m.tipo === 'comite' && m.datos.motivo === 'demanda'));
  let inst = leerJSON(path.join(config.carpetaDatos, FICHEROS.instantanea));
  assert.equal(inst.cabecera.comitePedido, false);
  for (const id of JEFES) {
    const a = inst.agentes.find(x => x.id === id);
    assert.equal(a.sala, 'comite', `${id} en la sala`);
    assert.equal(a.estado, 'reunion');
  }
  // En el estado (lo que decide) ya han vuelto a su sitio.
  for (const id of JEFES) assert.equal(estado.agentes[id].estado, 'trabajando');
  // 5 min después (un latido sintético) ya no están.
  await latido(config, { llm: llmApagado() });
  inst = leerJSON(path.join(config.carpetaDatos, FICHEROS.instantanea));
  for (const id of JEFES) assert.notEqual(inst.agentes.find(x => x.id === id).sala, 'comite');
});

test('laboratorio fuera de banda: su propio cerrojo, deja el resultado y el latido lo incorpora UNA vez', async () => {
  const config = configEn(carpetaTemporal());
  const carpeta = config.carpetaDatos;
  assert.equal((await ejecutarLaboratorio(config)).motivo, 'sin_estado');
  await latido(config, { llm: llmApagado() });
  assert.equal((await ejecutarLaboratorio(config)).motivo, 'nada');
  // Una hipótesis pendiente, como la deja la revisión semanal.
  const ok = await conLaMesa(config, orq => {
    const lab = require('../src/agentes/departamentos/laboratorio');
    orq.reloj.fijar(orq.reloj.ahora());   // sin mover el reloj
    return lab.revisionSemanal(orq).length;
  }, { llm: llmApagado() });
  assert.ok(ok.ok && ok.resultado > 0, 'la revisión semanal propone hipótesis');
  let estado = leerJSON(path.join(carpeta, 'estado.json'));
  const pendientes = estado.laboratorio.hipotesis.filter(h => h.estado === 'pendiente').map(h => h.id);
  assert.ok(pendientes.length > 0, 'quedan pendientes (el latido no las evalúa)');
  const estadoAntes = fs.readFileSync(path.join(carpeta, 'estado.json'), 'utf8');
  const mensajesAntes = leerJSONL(path.join(carpeta, 'mensajes.jsonl')).length;

  // Con el cerrojo del laboratorio cogido por otro vivo, no hace nada.
  fs.writeFileSync(path.join(carpeta, CERROJO), cerrojoDe(otroVivo()));
  assert.equal((await ejecutarLaboratorio(config)).motivo, 'ocupado');
  fs.unlinkSync(path.join(carpeta, CERROJO));

  const r = await ejecutarLaboratorio(config);
  assert.equal(r.ok, true, r.detalle);
  assert.equal(r.motivo, 'hecho');
  assert.equal(r.hipotesis, pendientes.length);
  assert.equal(fs.existsSync(path.join(carpeta, CERROJO)), false, 'suelta su cerrojo');
  // No toca el estado ni publica nada.
  assert.equal(fs.readFileSync(path.join(carpeta, 'estado.json'), 'utf8'), estadoAntes);
  assert.equal(leerJSONL(path.join(carpeta, 'mensajes.jsonl')).length, mensajesAntes);
  const resultado = leerJSON(path.join(carpeta, FICHEROS.laboratorio));
  assert.equal(resultado.id, r.id);
  // Un segundo laboratorio no evalúa encima de un resultado sin incorporar.
  assert.equal((await ejecutarLaboratorio(config)).motivo, 'sin_incorporar');

  await latido(config, { llm: llmApagado() });
  estado = leerJSON(path.join(carpeta, 'estado.json'));
  for (const id of pendientes) assert.notEqual(estado.laboratorio.hipotesis.find(h => h.id === id).estado, 'pendiente');
  assert.deepEqual(estado.laboratorio.incorporados, [r.id]);
  assert.equal(fs.existsSync(path.join(carpeta, FICHEROS.laboratorio)), false, 'el fichero se borra una vez guardado');
  const resultadosLab = leerJSONL(path.join(carpeta, 'mensajes.jsonl')).filter(m => m.canal === 'laboratorio' && m.tipo === 'hipotesis' && m.datos && m.datos.aprobada !== undefined);
  assert.equal(resultadosLab.length, pendientes.length);
  const ensayos = estado.laboratorio.ensayosTotales;
  assert.ok(ensayos > 0);

  // Si el fichero reaparece (un corte entre guardar y borrar), no se incorpora dos veces.
  escribirJSON(path.join(carpeta, FICHEROS.laboratorio), resultado);
  await latido(config, { llm: llmApagado() });
  estado = leerJSON(path.join(carpeta, 'estado.json'));
  assert.equal(estado.laboratorio.ensayosTotales, ensayos);
  assert.equal(leerJSONL(path.join(carpeta, 'mensajes.jsonl')).filter(m => m.canal === 'laboratorio' && m.tipo === 'hipotesis' && m.datos && m.datos.aprobada !== undefined).length, pendientes.length);
  assert.equal(fs.existsSync(path.join(carpeta, FICHEROS.laboratorio)), false);
});

test('cerrojo del laboratorio: el de un pid muerto se toma y solo se suelta el propio', async () => {
  const carpeta = carpetaTemporal();
  const ruta = path.join(carpeta, CERROJO);
  fs.writeFileSync(ruta, cerrojoDe(await pidMuerto()));
  assert.equal(tomarCerrojo(carpeta), true);
  assert.equal(JSON.parse(fs.readFileSync(ruta, 'utf8')).pid, process.pid);
  soltarCerrojo(carpeta);
  assert.equal(fs.existsSync(ruta), false);
  fs.writeFileSync(ruta, cerrojoDe(otroVivo()));
  assert.equal(tomarCerrojo(carpeta), false, 'el de otro vivo no se toma');
  soltarCerrojo(carpeta);
  assert.equal(fs.existsSync(ruta), true, 'el ajeno no se suelta');
});

test('vigía: un latido colgado se corta con código 1 y se apunta', async () => {
  const carpeta = carpetaTemporal();
  const config = configEn(carpeta);
  const codigo = await new Promise(resolver => {
    scriptLatido.ejecutar({
      config, vigiaMs: 80, salir: resolver, latidoFn: () => new Promise(() => {}), espejo: () => ({ sincronizar: async () => ({}) }), escribir: () => {},
    });
  });
  assert.equal(codigo, 1);
  const l = leerJSONL(path.join(carpeta, FICHEROS.latidos));
  assert.equal(l.length, 1);
  assert.equal(l[0].ok, false);
  assert.match(l[0].resumen, /vigía/);
});

test('vigía en un proceso de verdad: se sale solo aunque el latido no acabe nunca', { timeout: 20_000 }, async () => {
  const carpeta = carpetaTemporal();
  const codigo = `
    const { crearConfig } = require(${JSON.stringify(path.join(RAIZ, 'src/config'))});
    const s = require(${JSON.stringify(path.join(RAIZ, 'scripts/latido'))});
    const config = crearConfig({ modo: 'sintetico', datos: ${JSON.stringify(carpeta)} });
    s.ejecutar({ config, vigiaMs: 300, latidoFn: () => new Promise(() => { setInterval(() => {}, 1000); }) });
  `;
  const t0 = Date.now();
  const hijo = spawn(process.execPath, ['-e', codigo], { cwd: RAIZ, env: { ...process.env, LOG_NIVEL: 'silencio' } });
  const salida = await new Promise(r => hijo.on('close', c => r(c)));
  assert.equal(salida, 1);
  assert.ok(Date.now() - t0 < 10_000);
  assert.match(leerJSONL(path.join(carpeta, FICHEROS.latidos))[0].resumen, /vigía/);
});

test('scripts/latido.js: sin src/bd/espejo.js o con la base caída sale con 0; ocupado también', async () => {
  const carpeta = carpetaTemporal();
  const config = configEn(carpeta);
  const correr = espejo => new Promise(resolver => {
    scriptLatido.ejecutar({ config, salir: resolver, espejo, escribir: () => {}, latidoFn: c => latido(c, { llm: llmApagado() }) });
  });
  assert.equal(await correr(() => { const e = new Error('no está'); e.code = 'MODULE_NOT_FOUND'; throw e; }), 0);
  assert.equal(await correr(() => ({ sincronizar: async () => { throw new Error('ECONNREFUSED'); } })), 0);
  assert.equal(leerJSONL(path.join(carpeta, 'espejo-fallos.jsonl')).length, 1);
  let llamado = null;
  assert.equal(await correr(() => ({ sincronizar: async c => { llamado = c; return { copiados: 3 }; } })), 0);
  assert.equal(llamado, config);
  fs.writeFileSync(path.join(carpeta, '.proceso'), cerrojoDe(otroVivo()));
  assert.equal(await correr(() => ({ sincronizar: async () => ({}) })), 0);
  fs.unlinkSync(path.join(carpeta, '.proceso'));
  assert.equal(leerJSON(path.join(carpeta, 'estado.json')).ahora, INICIO + 3 * 5 * MIN);
});

test('modo latido: el ritmo de órdenes, las acciones del panel y los errores vistos sobreviven de un proceso a otro', async () => {
  const config = configEn(carpetaTemporal());
  await latido(config, { llm: llmApagado() });
  // Una orden apuntada en ordenes.jsonl hace 10 min cuenta; una de hace 2 h, no.
  const { anadirJSONL } = require('../src/util/almacen');
  const ahora = leerJSON(path.join(config.carpetaDatos, 'estado.json')).ahora;
  const rutaOrdenes = path.join(config.carpetaDatos, 'ordenes.jsonl');
  anadirJSONL(rutaOrdenes, { t: ahora - 2 * 60 * MIN, estado: 'INTENCION', idCliente: 'x-1', mesaId: 'tendencia', simbolo: 'BTC/USD' });
  anadirJSONL(rutaOrdenes, { t: ahora - 10 * MIN, estado: 'INTENCION', idCliente: 'x-2', mesaId: 'tendencia', simbolo: 'BTC/USD' });
  anadirJSONL(rutaOrdenes, { t: ahora - 5 * MIN, estado: 'INTENCION', idCliente: 'x-3', mesaId: 'sombra', simbolo: 'BTC/USD' });
  anadirJSONL(rutaOrdenes, { t: ahora - 5 * MIN, estado: 'INTENCION', ajena: true, idCliente: 'x-4', mesaId: 'fondo', simbolo: 'BTC/USD' });
  for (const id of ['x-1', 'x-2', 'x-3', 'x-4']) anadirJSONL(rutaOrdenes, { t: ahora - 60 * MIN, estado: 'CANCELADA', idCliente: id });
  const r = await conLaMesa(config, async orq => {
    await orq.comando('pausar', {});
    orq._error('prueba', 'sistema', new Error('uno'));
    return orq.registroOrdenes;
  }, { llm: llmApagado() });
  // Las del primer latido (reales) y la de hace 10 min; ni la de hace 2 h, ni la sombra, ni la ajena.
  const propias = r.resultado.filter(o => o.mesaId === 'tendencia');
  assert.deepEqual(propias, [{ t: ahora - 10 * MIN, mesaId: 'tendencia' }]);
  assert.ok(r.resultado.every(o => o.mesaId !== 'sombra' && o.mesaId !== 'fondo' && o.t > ahora - 60 * MIN));
  const r2 = await conLaMesa(config, orq => ({ seq: orq.seqHumana, tipos: orq.accionesHumanas.map(a => a.tipo), errores: Object.keys(orq._erroresVistos).length }), { llm: llmApagado() });
  assert.deepEqual(r2.resultado, { seq: 1, tipos: ['pausar'], errores: 1 });
});
