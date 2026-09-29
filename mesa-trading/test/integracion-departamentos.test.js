'use strict';
// Departamentos con casos construidos a mano: conciliación (escalar, grave ×3
// → pausa, Reabrir solo con conciliación limpia), revisión mensual
// (contratación, despido al banquillo con sus flujos), noticias graves (veto
// 24 h) y descansos.

const test = require('node:test');
const assert = require('node:assert/strict');
const { crearOrquestador, PASO } = require('./integracion-ayuda');
const direccion = require('../src/agentes/departamentos/direccion');
const analisis = require('../src/agentes/departamentos/analisis');

const HORA = 3_600_000;
const EPS = 1e-12;

async function pasos(ctx, n) { for (let i = 0; i < n; i++) { ctx.reloj.avanzar(PASO); await ctx.orquestador.paso(); } }

test('conciliación: escala la comisión cobrada en el activo, 3 graves seguidas pausan y Reabrir exige limpieza', async () => {
  const ctx = await crearOrquestador({ pasos: 2 });
  const o = ctx.orquestador;
  const pos = ctx.broker.estado.posiciones;
  const simbolos = Object.keys(pos);
  assert.ok(simbolos.length >= 2, 'la semilla 42 abre momentum el primer lunes');
  const [a, b] = simbolos;
  const mensajes = [];
  o.on('mensaje', m => mensajes.push(m));

  // Como Alpaca: llega un 0,25 % menos de lo que dicen los libros → escalar.
  const librosAntes = o.libros.totalesPorSimbolo({ sombra: false })[a];
  pos[a].cantidad = Number((pos[a].cantidad * 0.9975).toFixed(9));
  await pasos(ctx, 1);
  const librosDespues = o.libros.totalesPorSimbolo({ sombra: false })[a];
  assert.ok(Math.abs(librosDespues - pos[a].cantidad) <= 1e-9 * librosAntes);
  assert.ok(mensajes.some(m => m.de === 'controller' && /ajuste/.test(m.texto)));
  assert.equal(o.estado.conciliacion.limpia, true);
  assert.equal(o.estado.fondo.nivel, 'normal');

  // Un 10 % que falta es grave: aviso una vez, y a la tercera seguida, pausa.
  const guardada = pos[b].cantidad;
  pos[b].cantidad = Number((guardada * 0.9).toFixed(9));
  await pasos(ctx, 3);
  assert.equal(o.estado.conciliacion.grave, true);
  assert.equal(o.estado.fondo.nivel, 'pausado');
  assert.match(o.estado.fondo.motivo, /3 conciliaciones graves/);
  assert.equal(mensajes.filter(m => m.de === 'controller' && m.tipo === 'alerta' && /Descuadre grave/.test(m.texto)).length, 1, 'el mismo descuadre se avisa una vez');
  const r1 = await o.comando('reabrir', { confirmacion: 'REABRIR' });
  assert.equal(r1.ok, false);
  assert.match(r1.mensaje, /conciliación/);

  // Arreglado en el bróker: la conciliación vuelve a estar limpia y ya se puede reabrir.
  pos[b].cantidad = guardada;
  await pasos(ctx, 1);
  assert.equal(o.estado.conciliacion.limpia, true);
  const r2 = await o.comando('reabrir', { confirmacion: 'REABRIR' });
  assert.equal(r2.ok, true, r2.mensaje);
  assert.equal(o.estado.fondo.nivel, 'normal');
  await o.detener();
});

test('revisión mensual: contrata lo aprobado (incubación 2 %, puestos y operadores nuevos) y manda al banquillo con flujo', async () => {
  const ctx = await crearOrquestador({ pasos: 2 });
  const o = ctx.orquestador;
  const agentes = [];
  o.on('agente', a => agentes.push(a));
  o.estado.laboratorio.aprobadas.push({
    id: 'h-prueba', familia: 'ruptura-donchian', marco: '1Day', universo: ['BTC/USD', 'ETH/USD'],
    filtros: [{ id: 'regimen-no-riskoff', parametro: null }], params: { entrada: 30 }, origen: 'leccion', motivo: 'prueba', mesaId: 'ruptura',
  });
  const momentum = o.mesaPorId('momentum');
  momentum.metricas = { operaciones: 50, sharpeAjustado: -1, maxDD: 0.3, sharpe: -1 };
  const conPosicion = o.libros.listaPuestos({ sombra: false }).filter(p => p.mesaId === 'momentum' && p.cantidad > EPS);
  assert.ok(conPosicion.length > 0);
  const r = await direccion.revisionMensual(o);

  assert.deepEqual(r.contratadas, ['lab1']);
  assert.deepEqual(r.despidos, ['momentum']);
  const lab = o.mesaPorId('lab1');
  assert.equal(lab.estado, 'incubacion');
  assert.equal(lab.peso, 0.02);
  assert.equal(lab.params.entrada, 30);
  assert.deepEqual(lab.filtros, [{ id: 'regimen-no-riskoff', parametro: null }]);
  assert.ok(o.libros.puesto('lab1-BTC') && o.libros.puesto('lab1-ETH@sombra'));
  assert.ok(o.plantilla.some(a => a.id === 'puesto-lab1-BTC'));
  assert.ok(agentes.some(a => a.id === 'puesto-lab1-ETH' && a.sala === 'parque'), 'los nuevos llegan al parqué');
  assert.equal(o.estado.laboratorio.aprobadas.length, 0);

  assert.equal(momentum.estado, 'banquillo');
  assert.equal(momentum.peso, 0);
  assert.ok(momentum.flujoPendiente < 0, 'el capital que sale es un flujo, no una pérdida');
  for (const p of conPosicion) assert.equal(o.libros.puesto(p.puestoId).cantidad, 0, `${p.puestoId} cerrado`);
  assert.ok(agentes.some(a => a.id === 'puesto-momentum-BTC' && a.estado === 'banquillo'));

  const inst = o.instantanea();
  const m = inst.mesas.find(x => x.id === 'lab1');
  assert.ok(m && m.nota && m.universo.join() === 'BTC,ETH');
  assert.ok(inst.puestos.some(p => p.id === 'lab1-ETH'));
  assert.equal(inst.mesas.find(x => x.id === 'momentum').capital, 0);
  assert.ok(inst.agentes.filter(a => a.mesaId === 'momentum').every(a => a.estado === 'banquillo'));
  const suma = o.estado.mesas.reduce((s, x) => s + x.peso, 0);
  assert.ok(suma <= 1 + 1e-9);
  // Los libros siguen cuadrando con el bróker tras vender lo de momentum.
  await pasos(ctx, 1);
  assert.equal(o.estado.conciliacion.limpia, true, o.estado.conciliacion.resumen);
  // Y el laboratorio de la mesa nueva decide en la vela diaria siguiente.
  await pasos(ctx, 288);
  assert.ok(o.estado.ultimaVela.lab1 !== undefined);
  await o.detener();
});

test('noticias (con claves y LLM): un evento grave veta aperturas 24 h en ese activo; cada 4 h como mucho', async () => {
  const t0 = Date.UTC(2026, 8, 29, 12);
  const mensajes = [];
  const llamadas = [];
  const ctx = {
    modo: 'alpaca',
    config: { alpaca: { hay: true } },
    reloj: { ahora: () => t0 },
    universo: [{ simbolo: 'BTC/USD', etiqueta: 'BTC' }, { simbolo: 'SOL/USD', etiqueta: 'SOL' }],
    estado: { noticias: { ultima: null, vistos: [], eventosGraves: [] }, directivas: { activosVetados: [] } },
    datos: {
      noticias: async () => [
        { id: 11, titular: 'Hackean un puente de Solana', resumen: '', simbolos: ['SOL/USD'], t: t0 - HORA, url: null },
        { id: 12, titular: 'BTC sube en Asia', resumen: '', simbolos: ['BTC/USD'], t: t0 - HORA, url: null },
      ],
    },
    llm: {
      activo: true,
      async pedirJSON(args) {
        llamadas.push(args);
        return { ok: true, costeUsd: 0.002, datos: { noticias: [
          { id: '11', simbolo: 'SOL/USD', categoria: 'hackeo', impacto: 'negativo', eventoGrave: true },
          { id: '12', simbolo: 'BTC/USD', categoria: 'mercado', impacto: 'positivo', eventoGrave: false },
        ] } };
      },
    },
    bus: { publicar: m => mensajes.push(m) },
  };
  const r = await analisis.noticias(ctx);
  assert.equal(r.graves, 1);
  assert.equal(llamadas[0].esfuerzo, 'low');
  assert.deepEqual(llamadas[0].esquema.properties.noticias.items.properties.id.enum, ['11', '12']);
  const v = ctx.estado.directivas.activosVetados;
  assert.equal(v.length, 1);
  assert.equal(v[0].simbolo, 'SOL/USD');
  assert.equal(v[0].hasta, t0 + 24 * HORA);
  assert.equal(v[0].origen, 'noticias');
  assert.equal(mensajes[0].de, 'analista-SOL');
  assert.equal(mensajes[0].tipo, 'alerta');
  assert.equal(await analisis.noticias(ctx), null, 'antes de 4 h no se vuelve a preguntar');
  // Sin claves de Alpaca (o sin LLM) no hay noticias.
  assert.equal(await analisis.noticias({ ...ctx, config: { alpaca: { hay: false } } }), null);
});

test('descanso: tras 2 h sin trabajo un agente va 15 min a la sala de descanso y vuelve; nunca con el fondo en alerta', async () => {
  const ctx = await crearOrquestador({ pasos: 1 });
  const o = ctx.orquestador;
  const eventos = [];
  o.on('agente', a => eventos.push(a));
  await pasos(ctx, 36);                 // 3 h
  const ida = eventos.find(a => a.estado === 'descanso');
  assert.ok(ida, 'alguien se va al descanso');
  assert.equal(ida.sala, 'descanso');
  await pasos(ctx, 4);
  assert.ok(eventos.some(a => a.id === ida.id && a.estado === 'trabajando'), 'y vuelve a su sitio');
  o.estado.fondo.nivel = 'solo_cerrar';
  o.estado.fondo.soloCerrarHasta = ctx.reloj.ahora() + 24 * HORA;
  const n = eventos.filter(a => a.estado === 'descanso').length;
  await pasos(ctx, 36);
  assert.equal(eventos.filter(a => a.estado === 'descanso').length, n, 'con el fondo en alerta nadie se va');
  await o.detener();
});

test('vela tardía: si la 4H de un símbolo aún no ha llegado, la mesa espera (hasta 10 min) para decidir todos los puestos', async () => {
  const ctx = await crearOrquestador({ pasos: 1 });
  const o = ctx.orquestador;
  const H4 = 4 * HORA;
  // Avanza hasta justo antes del próximo cierre de 4H.
  while ((ctx.reloj.ahora() + PASO) % H4 !== 0) { ctx.reloj.avanzar(PASO); await o.paso(); }
  const original = ctx.datos.velas.bind(ctx.datos);
  let retener = true;
  ctx.datos.velas = async (s, marco, r) => {
    const v = await original(s, marco, r);
    return retener && s === 'SOL/USD' && marco === '4Hour' ? v.slice(0, -1) : v;
  };
  const antes = o.estado.ultimaVela.tendencia;
  await pasos(ctx, 1);                  // cierra la vela: SOL no ha llegado
  assert.equal(o.estado.ultimaVela.tendencia, antes, 'no se marca la vela sin SOL');
  retener = false;
  await pasos(ctx, 1);                  // llega SOL 5 min después
  assert.ok(o.estado.ultimaVela.tendencia > antes);
  const sol = o.estado.puestos['tendencia-SOL'];
  const btc = o.estado.puestos['tendencia-BTC'];
  assert.equal(sol.ultimaSenal.t, btc.ultimaSenal.t, 'los tres puestos deciden en la misma vela');
  // Si no llega en 10 min, se decide con lo que hay.
  while ((ctx.reloj.ahora() + PASO) % H4 !== 0) { ctx.reloj.avanzar(PASO); await o.paso(); }
  retener = true;
  const antes2 = o.estado.ultimaVela.tendencia;
  await pasos(ctx, 2);
  assert.equal(o.estado.ultimaVela.tendencia, antes2);
  await pasos(ctx, 1);                  // 10 min después del cierre
  assert.ok(o.estado.ultimaVela.tendencia > antes2);
  await o.detener();
});
