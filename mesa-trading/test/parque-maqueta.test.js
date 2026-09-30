'use strict';
// Parqué · maqueta: la instantánea tiene la forma EXACTA de §7, cuadra por
// dentro y se mueve como la mesa de verdad (comité, órdenes, comandos).
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearMaqueta, DEPARTAMENTOS } = require('../web/js/maqueta.js');

const T0 = Date.UTC(2026, 8, 29, 12, 0, 0);
const claves = o => Object.keys(o).sort();

// Forma de §7 de ARQUITECTURA.md, campo a campo.
const FORMA = {
  raiz: ['version', 'ahora', 'modo', 'broker', 'velocidad', 'fondo', 'cabecera', 'llm', 'curva', 'cotizaciones', 'departamentos', 'agentes',
    'mesas', 'puestos', 'posiciones', 'benchmarks', 'mejora', 'directivas', 'megafonoPendiente', 'mensajes', 'ejecuciones', 'laboratorio', 'limites',
    'listoParaReal', 'avisos'],
  listoParaReal: ['listo', 'cumplidos', 'total', 'criterios', 'comite', 'nota'],
  criterioReal: ['id', 'nombre', 'valor', 'umbral', 'ok', 'valorTexto', 'umbralTexto', 'detalle'],
  comiteReal: ['sharpeFondo', 'sharpeSinComite', 'bate', 'texto'],
  fondo: ['nivel', 'motivo', 'multiplicadorCaida', 'factorTamano'],
  cabecera: ['patrimonio', 'pnlDia', 'pnlDiaPct', 'caida', 'exposicionBrutaPct', 'exposicionCriptoPct', 'posiciones', 'regimen', 'miedoCodicia', 'proximoComite', 'modoComite',
    'sinAsignar', 'vigilancia'],
  sinAsignar: ['fraccion', 'usd'],
  vigilancia: ['perdidaDiaPct', 'caidaPct', 'desdeReapertura'],
  llm: ['activo', 'modeloComite', 'modeloAgentes', 'gastoHoyUsd', 'presupuestoDiaUsd'],
  curva: ['t', 'patrimonio'],
  cotizacion: ['simbolo', 'etiqueta', 'precio', 'var24hPct', 't'],
  agente: ['id', 'nombre', 'departamento', 'rol', 'queDecide', 'usaLLM', 'sala', 'estado', 'bocadillo', 'mesaId', 'simbolo', 'etiqueta', 'puestoId'],
  mesa: ['id', 'nombre', 'familia', 'marco', 'estado', 'peso', 'capital', 'multiplicador', 'universo', 'params', 'metricas', 'pnlDia', 'nota'],
  metricas: ['operaciones', 'acierto', 'factorBeneficio', 'sharpe', 'sharpeAjustado', 'maxDD', 'adherencia', 'pnlTotal'],
  puesto: ['id', 'mesaId', 'simbolo', 'etiqueta', 'agenteId', 'posicion', 'pnlDia', 'operaciones', 'acierto', 'factorBeneficio', 'adherencia', 'estadoTexto', 'ultimaSenal', 'chispa'],
  posicionPuesto: ['cantidad', 'nocional', 'entrada', 'stop', 'objetivo', 'pnlAbierto', 'pnlAbiertoPct', 'abiertaT'],
  posicion: ['simbolo', 'etiqueta', 'cantidad', 'precioMedio', 'precio', 'valor', 'pnl'],
  benchmark: ['id', 'nombre', 'valor', 'rentabilidad', 'sharpe90'],
  mejora: ['sharpe90Fondo', 'sharpe90SinComite', 'sharpe90Btc', 'texto'],
  directivas: ['modo', 'multiplicadores', 'activosVetados', 'mesasPausadas', 'soloCerrarHasta', 'reduccion'],
  mensaje: ['id', 't', 'de', 'deNombre', 'departamento', 'para', 'canal', 'tipo', 'texto', 'datos', 'importancia', 'costeUsd'],
  ejecucion: ['t', 'puestoId', 'simbolo', 'etiqueta', 'lado', 'cantidad', 'precio', 'nocional', 'comision', 'motivo'],
  laboratorio: ['ensayosTotales', 'hipotesis', 'proximaRevision'],
  hipotesis: ['id', 'descripcion', 'estado', 'criterios', 't'],
};
const SALAS = ['parque', 'direccion', 'macro', 'analisis', 'laboratorio', 'riesgos', 'comite', 'descanso'];
const ESTADOS = ['trabajando', 'reunion', 'descanso', 'de_pie', 'banquillo'];
const CANALES = ['parque', 'analisis', 'macro', 'riesgo', 'ejecucion', 'comite', 'megafono', 'laboratorio', 'direccion', 'sistema'];

function comprobarForma(i) {
  assert.deepEqual(claves(i), FORMA.raiz.slice().sort());
  assert.equal(i.version, 1);
  assert.ok(['alpaca', 'simulado', 'sintetico'].includes(i.modo));
  assert.ok(['alpaca-paper', 'simulado'].includes(i.broker));
  assert.deepEqual(claves(i.fondo), FORMA.fondo.slice().sort());
  assert.ok(['normal', 'solo_cerrar', 'pausado', 'bloqueado'].includes(i.fondo.nivel));
  // §7: el recorte real de las aperturas, total = comité × Megáfono × caída.
  const ft = i.fondo.factorTamano;
  assert.deepEqual(claves(ft), ['caida', 'comite', 'megafono', 'total']);
  assert.ok(Math.abs(ft.total - ft.comite * ft.megafono * ft.caida) < 1e-12);
  assert.deepEqual(claves(i.cabecera), FORMA.cabecera.slice().sort());
  assert.deepEqual(claves(i.cabecera.regimen), ['detalle', 'valor']);
  assert.deepEqual(claves(i.cabecera.miedoCodicia), ['etiqueta', 'sintetico', 'valor']);
  assert.deepEqual(claves(i.cabecera.sinAsignar), FORMA.sinAsignar.slice().sort());
  assert.deepEqual(claves(i.cabecera.vigilancia), FORMA.vigilancia.slice().sort());
  assert.equal(typeof i.cabecera.vigilancia.desdeReapertura, 'boolean');
  assert.ok(['NORMAL', 'DEFENSIVO', 'SOLO_CERRAR'].includes(i.cabecera.modoComite));
  assert.deepEqual(claves(i.llm), FORMA.llm.slice().sort());
  // §7: el semáforo «¿Listo para dinero real?», criterios a-g.
  const lr = i.listoParaReal;
  assert.deepEqual(claves(lr), FORMA.listoParaReal.slice().sort());
  assert.deepEqual(lr.criterios.map(k => k.id), ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  for (const k of lr.criterios) {
    assert.deepEqual(claves(k), FORMA.criterioReal.slice().sort());
    assert.equal(typeof k.ok, 'boolean');
    assert.equal(typeof k.valorTexto, 'string');
    assert.equal(typeof k.umbralTexto, 'string');
  }
  assert.equal(lr.cumplidos, lr.criterios.filter(k => k.ok).length);
  assert.equal(lr.listo, lr.cumplidos === lr.total);
  assert.deepEqual(claves(lr.comite), FORMA.comiteReal.slice().sort());
  assert.match(lr.nota, /no activa nada/);
  assert.ok(i.curva.length <= 500);
  for (const p of i.curva) assert.deepEqual(claves(p), FORMA.curva.slice().sort());
  for (const c of i.cotizaciones) assert.deepEqual(claves(c), FORMA.cotizacion.slice().sort());
  assert.deepEqual(i.departamentos, DEPARTAMENTOS);
  for (const a of i.agentes) {
    assert.deepEqual(claves(a), FORMA.agente.slice().sort(), a.id);
    assert.ok(SALAS.includes(a.sala), a.sala);
    assert.ok(ESTADOS.includes(a.estado), a.estado);
    if (a.bocadillo) assert.deepEqual(claves(a.bocadillo), ['hasta', 'texto']);
  }
  for (const m of i.mesas) {
    assert.deepEqual(claves(m), FORMA.mesa.slice().sort(), m.id);
    assert.deepEqual(claves(m.metricas), FORMA.metricas.slice().sort());
    assert.ok(m.universo.every(e => typeof e === 'string' && !e.includes('/')), 'universo por etiqueta');
  }
  for (const p of i.puestos) {
    assert.deepEqual(claves(p), FORMA.puesto.slice().sort(), p.id);
    if (p.posicion) assert.deepEqual(claves(p.posicion), FORMA.posicionPuesto.slice().sort());
    if (p.ultimaSenal) assert.deepEqual(claves(p.ultimaSenal), ['accion', 't']);
    assert.equal(p.chispa.length, 16, 'últimos 16 cierres');
  }
  for (const p of i.posiciones) assert.deepEqual(claves(p), FORMA.posicion.slice().sort());
  for (const b of i.benchmarks) assert.deepEqual(claves(b), FORMA.benchmark.slice().sort());
  assert.ok(i.benchmarks.some(b => b.id === 'sin-comite'), 'incluye la sombra sin comité');
  assert.deepEqual(claves(i.mejora), FORMA.mejora.slice().sort());
  assert.deepEqual(claves(i.directivas), FORMA.directivas.slice().sort());
  assert.ok(i.mensajes.length <= 150);
  for (const m of i.mensajes) {
    assert.deepEqual(claves(m), FORMA.mensaje.slice().sort());
    assert.ok(CANALES.includes(m.canal), m.canal);
  }
  assert.ok(i.ejecuciones.length <= 30);
  for (const e of i.ejecuciones) assert.deepEqual(claves(e), FORMA.ejecucion.slice().sort());
  assert.deepEqual(claves(i.laboratorio), FORMA.laboratorio.slice().sort());
  for (const h of i.laboratorio.hipotesis) assert.deepEqual(claves(h), FORMA.hipotesis.slice().sort());
  assert.ok(Array.isArray(i.avisos) && i.avisos.every(a => typeof a === 'string'));
  assert.equal(typeof i.limites.maxExposicionBruta, 'number');
}

test('la instantánea tiene la forma exacta de §7', () => {
  const s = crearMaqueta({ semilla: 7, ahora: T0 });
  const i = s.instantanea();
  comprobarForma(i);
  assert.equal(i.ahora, T0);
  assert.equal(i.cotizaciones.length, 6);
  assert.deepEqual(i.cotizaciones.map(c => c.etiqueta), ['BTC', 'ETH', 'SOL', 'LINK', 'AVAX', 'DOGE']);
  assert.deepEqual(i.mesas.map(m => m.id), ['tendencia', 'momentum', 'reversion', 'ruptura']);
  assert.equal(i.puestos.length, 3 + 6 + 2 + 3);
  assert.equal(i.agentes.length, 7 + 6 + 14);          // fijos + un analista por activo + un operador por puesto
  for (const p of i.puestos) {
    const a = i.agentes.find(x => x.id === p.agenteId);
    assert.ok(a && a.puestoId === p.id && a.id === `puesto-${p.id}`);
  }
  // Tras avanzar, la forma se mantiene.
  s.avanzar(40000);
  comprobarForma(s.instantanea());
});

test('la contabilidad cuadra: patrimonio = efectivo + Σ valor y la exposición sale de ahí', () => {
  const s = crearMaqueta({ semilla: 7, ahora: T0 });
  for (let k = 0; k < 4; k++) {
    const i = s.instantanea();
    const valor = i.posiciones.reduce((x, p) => x + p.cantidad * p.precio, 0);
    const patr = s._interno.patrimonio();
    assert.ok(Math.abs(s._interno.efectivo() + valor - patr) < 1e-6, 'efectivo + posiciones');
    assert.ok(Math.abs(i.cabecera.patrimonio - patr) < 0.006, 'patrimonio redondeado a céntimos');
    assert.ok(Math.abs(i.cabecera.exposicionBrutaPct - valor / patr) < 1e-9);
    assert.equal(i.cabecera.posiciones, i.puestos.filter(p => p.posicion).length);
    assert.ok(Math.abs(i.cabecera.pnlDiaPct) < 0.05, 'fracción, no porcentaje');
    assert.ok(i.cabecera.caida <= 0);
    s.avanzar(15000);
  }
});

test('misma semilla y mismo inicio → misma maqueta', () => {
  const a = crearMaqueta({ semilla: 11, ahora: T0 });
  const b = crearMaqueta({ semilla: 11, ahora: T0 });
  a.avanzar(30000); b.avanzar(30000);
  assert.equal(JSON.stringify(a.instantanea()), JSON.stringify(b.instantanea()));
});

test('se mueve: estado cada 2 s, mensajes, órdenes y el comité lleva a los jefes a su sala y los devuelve', () => {
  const s = crearMaqueta({ semilla: 7, ahora: T0 });
  const eventos = s.avanzar(24000);
  const n = t => eventos.filter(e => e.tipo === t).length;
  assert.equal(n('estado'), 12);                         // 24 s / 2 s
  assert.ok(n('mensaje') >= 5, `mensajes: ${n('mensaje')}`);
  for (const e of eventos.filter(x => x.tipo === 'mensaje')) assert.deepEqual(claves(e.datos), FORMA.mensaje.slice().sort());
  // El comité de la maqueta empieza a los 25 s.
  const alComite = s.avanzar(2000).filter(e => e.tipo === 'agente');
  const jefes = ['cio', 'controller', 'macro', 'riesgos', 'laboratorio'];
  assert.deepEqual(alComite.filter(e => e.datos.sala === 'comite').map(e => e.datos.id).sort(), jefes.slice().sort());
  for (const e of alComite) assert.deepEqual(claves(e.datos), ['bocadillo', 'estado', 'id', 'sala']);
  assert.ok(s.instantanea().agentes.filter(a => jefes.includes(a.id)).every(a => a.sala === 'comite' && a.estado === 'reunion'));
  const resto = s.avanzar(30000);
  const vuelta = resto.filter(e => e.tipo === 'agente' && jefes.includes(e.datos.id));
  assert.ok(vuelta.length >= 5);
  const i = s.instantanea();
  const casa = { cio: 'direccion', controller: 'riesgos', macro: 'macro', riesgos: 'riesgos', laboratorio: 'laboratorio' };
  for (const id of jefes) assert.equal(i.agentes.find(a => a.id === id).sala, casa[id], id);
  assert.ok(resto.some(e => e.tipo === 'mensaje' && e.datos.tipo === 'decision'), 'la Presidenta decide');
  // En un minuto hay al menos una ejecución con la forma de §7 (el monitor se pone ámbar).
  const ejecuciones = eventos.concat(resto).filter(e => e.tipo === 'ejecucion');
  assert.ok(ejecuciones.length >= 1, 'hay ejecuciones');
  for (const e of ejecuciones) assert.deepEqual(claves(e.datos), FORMA.ejecucion.slice().sort());
});

test('comandos: confirmaciones, Megáfono con propuesta y Aplicar, kill y reabrir', () => {
  const s = crearMaqueta({ semilla: 7, ahora: T0 });
  assert.equal(s.comando('kill', {}).ok, false);
  assert.equal(s.comando('kill', { confirmacion: 'kill' }).ok, false, 'la palabra exacta, en mayúsculas');
  assert.equal(s.comando('reabrir', { confirmacion: 'SI' }).ok, false);
  assert.equal(s.comando('prueba', { ordenMinima: true }).ok, false);
  const pr = s.comando('prueba', {});
  assert.ok(pr.ok && Array.isArray(pr.datos.comprobaciones));

  const prop = s.comando('megafono', { texto: 'pausa SOL 6 h y reduce el riesgo' });
  assert.ok(prop.ok);
  assert.deepEqual(claves(prop.datos), ['directivas', 'explicacion', 'id', 'texto']);
  assert.deepEqual(prop.datos.directivas, [
    { tipo: 'reducir_riesgo', factor: 0.5, horas: 6 },
    { tipo: 'pausar_activo', simbolo: 'SOL/USD', horas: 6 },
  ]);
  assert.equal(s.instantanea().megafonoPendiente.id, prop.datos.id);
  assert.equal(s.comando('megafono-aplicar', { id: 'otro' }).ok, false);
  assert.ok(s.comando('megafono-aplicar', { id: prop.datos.id }).ok);
  const d = s.instantanea().directivas;
  assert.equal(d.activosVetados[0].simbolo, 'SOL/USD');
  assert.equal(d.activosVetados[0].hasta, T0 + 6 * 3600000);
  assert.deepEqual(d.reduccion, { factor: 0.5, hasta: T0 + 6 * 3600000 });
  assert.equal(s.instantanea().megafonoPendiente, null);
  const nada = s.comando('megafono', { texto: 'hola' });
  assert.equal(nada.datos.directivas[0].tipo, 'sin_efecto');

  const k = s.comando('kill', { confirmacion: 'KILL' });
  assert.ok(k.ok);
  const i = s.instantanea();
  assert.equal(i.fondo.nivel, 'bloqueado');
  assert.equal(i.posiciones.length, 0);
  assert.ok(i.agentes.every(a => a.estado === 'de_pie'), 'kill switch: todos de pie');
  assert.equal(s.comando('comite').ok, false, 'sin comité con el fondo bloqueado');
  assert.equal(i.cabecera.vigilancia.desdeReapertura, false);
  const re = s.comando('reabrir', { confirmacion: 'REABRIR' });
  assert.ok(re.ok);
  // Como el servidor: reabrir no borra el máximo histórico y lo dice con cifras;
  // el vigilante (barra de LÍMITES) mide desde la reapertura.
  assert.match(re.mensaje, /máximo histórico \(\d{3}\.\d{3} \$\)/);
  const tras = s.instantanea();
  assert.equal(tras.fondo.nivel, 'normal');
  assert.equal(tras.cabecera.vigilancia.desdeReapertura, true);
  assert.equal(tras.cabecera.vigilancia.caidaPct, 0);
  assert.ok(tras.cabecera.caida < 0, 'la cabecera sigue midiendo desde el máximo histórico');
  assert.ok(s.comando('pausar').ok);
  assert.equal(s.instantanea().fondo.nivel, 'pausado');
});

test('ajustes: se ven los límites; se cambian presupuesto, modelos y velocidad; lo inválido no entra', () => {
  const s = crearMaqueta({ semilla: 7, ahora: T0 });
  const v = s.comando('ajustes');
  assert.ok(v.ok);
  assert.equal(v.datos.limites.maxExposicionBruta, 0.8);
  // De partida, como el servidor (30-sep-2026): agentes en Haiku 4.5 y tope de 1 $/día.
  assert.equal(s.instantanea().llm.modeloAgentes, 'claude-haiku-4-5');
  assert.equal(s.instantanea().llm.presupuestoDiaUsd, 1);
  // Un modelo distinto del de partida, para que el cambio se vea.
  const r = s.comando('ajustes', { presupuestoDiaUsd: 3.5, modeloAgentes: 'claude-sonnet-5-5', velocidad: 60 });
  assert.ok(r.ok);
  const i = s.instantanea();
  assert.equal(i.llm.presupuestoDiaUsd, 3.5);
  assert.equal(i.llm.modeloAgentes, 'claude-sonnet-5-5');
  assert.equal(i.velocidad, 60);
  const mal = s.comando('ajustes', { modeloComite: 'gpt-9' });
  assert.equal(mal.ok, false);
  assert.equal(s.instantanea().llm.modeloComite, 'claude-opus-5-5');
});

test('mesas como en el arranque real: una titular al 40 %, tres incubadas al 2 % con su nota y el 54 % sin asignar avisado', () => {
  const i = crearMaqueta({ semilla: 7, ahora: T0 }).instantanea();
  const inc = i.mesas.filter(m => m.estado === 'incubacion');
  assert.deepEqual(inc.map(m => m.id), ['tendencia', 'reversion', 'ruptura']);
  for (const m of inc) { assert.equal(m.peso, 0.02); assert.match(m.nota, /Sharpe/); }
  assert.deepEqual(i.mesas.filter(m => m.estado === 'titular').map(m => [m.id, m.peso]), [['momentum', 0.4]]);
  const aviso = i.avisos.find(a => /^54 % del capital sin asignar: queda en efectivo\./.test(a));
  assert.ok(aviso, i.avisos.join(' | '));
  assert.match(aviso, /solo 1 mesa titular \(techo del 40 %\) y 3 en prueba al 2 %/);
  assert.ok(Math.abs(i.cabecera.sinAsignar.fraccion - 0.54) < 1e-9);
  assert.ok(Math.abs(i.cabecera.sinAsignar.usd - i.cabecera.patrimonio * 0.54) < 0.01);
  // Los límites de la maqueta son los del servidor (src/config.js).
  const { LIMITES_DUROS } = require('../src/config');
  assert.deepEqual(i.limites, { ...LIMITES_DUROS });
  // Las notas y los nombres son los del arranque real (src/estrategias/index.js).
  const reales = require('../src/estrategias').mesasIniciales({ hayAlpaca: false });
  for (const m of i.mesas) {
    const r = reales.find(x => x.id === m.id);
    assert.equal(m.nota, r.nota ?? null, m.id);
    assert.equal(m.nombre, r.nombre, m.id);
  }
});

test('avisos: lo que bloquea el fondo va el primero (en el móvil se corta por el final)', () => {
  const s = crearMaqueta({ semilla: 7, ahora: T0 });
  assert.ok(s.comando('pausar').ok);
  assert.match(s.instantanea().avisos[0], /^Fondo en pausa/);
  assert.ok(s.comando('kill', { confirmacion: 'KILL' }).ok);
  assert.match(s.instantanea().avisos[0], /^Fondo bloqueado por el kill switch/);
  assert.ok(s.comando('reabrir', { confirmacion: 'REABRIR' }).ok);
  assert.ok(!s.instantanea().avisos.some(a => /bloqueado|pausa/.test(a)));
});
