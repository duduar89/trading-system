'use strict';
// Análisis (§6.9): un analista por activo.
//
// - Nota técnica con cada vela 1H cerrada: precio frente a la SMA50 diaria,
//   RSI(14) de 4H y volatilidad 30 d. Se publica si cambia el sesgo o cada
//   4 h. Las cifras son del código; la nota sale de plantillas.
// - Noticias (solo con claves de Alpaca y LLM): cada 4 h, en lote. El LLM
//   clasifica cada titular en una lista cerrada y marca si es evento grave;
//   un evento grave veta aperturas 24 h en ese activo.
//
// Sesgo (no opera, solo describe): sobre la SMA50 y RSI ≥ 50 → alcista; bajo
// la SMA50 y RSI < 50 → bajista; el resto, neutral. Es la lectura estándar de
// «tendencia de fondo + impulso»; ninguna mesa decide con él.

const { sma, rsi, volatilidad } = require('../../mercado/indicadores');
const { periodosAnio } = require('../../estrategias/comun');
const plantillas = require('../plantillas');
const { inicioVela, HORA, DIA } = require('../../util/reloj');
const f = require('../../util/formato');
const { precioDe, etiqueta } = require('./comun');

const CADA_NOTA = 4 * HORA;
const CADA_NOTICIAS = 4 * HORA;
const VETO_NOTICIA = 24 * HORA;

function ultimo(arr) {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] !== null && arr[i] !== undefined) return arr[i];
  return null;
}

function sesgoDe(precio, sma50, rsi4h) {
  if (!(precio > 0) || !(sma50 > 0) || rsi4h === null) return 'sin datos';
  if (precio > sma50 && rsi4h >= 50) return 'alcista';
  if (precio < sma50 && rsi4h < 50) return 'bajista';
  return 'neutral';
}

async function notaDe(ctx, activo, ahora) {
  const s = activo.simbolo;
  const diarias = await ctx.datos.velas(s, '1Day', { desde: ahora - 80 * DIA, hasta: ahora });
  const h4 = await ctx.datos.velas(s, '4Hour', { desde: ahora - 25 * DIA, hasta: ahora });
  const cd = diarias.map(v => v.c);
  const sma50 = cd.length >= 50 ? ultimo(sma(cd, 50)) : null;
  const vol = cd.length >= 31 ? ultimo(volatilidad(cd, 30, periodosAnio([s], '1Day'))) : null;
  const c4 = h4.map(v => v.c);
  const r4 = c4.length >= 15 ? ultimo(rsi(c4, 14)) : null;
  const precio = precioDe(ctx.vivo.precios, s) ?? (cd.length ? cd[cd.length - 1] : null);
  return { simbolo: s, etiqueta: activo.etiqueta, precio, sma50, rsi: r4, volAnual: vol, sesgo: sesgoDe(precio, sma50, r4) };
}

async function notas(ctx, { forzar = false } = {}) {
  const ahora = ctx.reloj.ahora();
  const a = ctx.estado.analisis;
  const hora = inicioVela(ahora, HORA);
  if (!forzar && a.ultimaHora !== null && hora <= a.ultimaHora) return [];
  a.ultimaHora = hora;
  const publicadas = [];
  for (const activo of ctx.universo) {
    const n = await notaDe(ctx, activo, ahora);
    const previa = a.porActivo[n.simbolo] || null;
    const cambia = previa && previa.sesgo !== n.sesgo;
    a.porActivo[n.simbolo] = { sesgo: n.sesgo, sma50: n.sma50, rsi: n.rsi, volAnual: n.volAnual, t: ahora, publicada: previa ? previa.publicada : null };
    if (forzar || !previa || cambia || previa.publicada === null || ahora - previa.publicada >= CADA_NOTA) {
      a.porActivo[n.simbolo].publicada = ahora;
      ctx.bus.publicar({
        de: `analista-${n.etiqueta}`, canal: 'analisis', tipo: 'nota',
        texto: plantillas.notaAnalista({ ...n, marco: '4Hour' }),
        datos: { simbolo: n.simbolo, sesgo: n.sesgo, precio: n.precio, sma50: n.sma50, rsi4h: n.rsi, volAnual: n.volAnual, sesgoAnterior: previa ? previa.sesgo : null },
        importancia: cambia ? 2 : 1,
      });
      publicadas.push(n);
    }
  }
  return publicadas;
}

// ---------- Noticias ----------

const CATEGORIAS_NOTICIA = Object.freeze(['regulacion', 'hackeo', 'quiebra', 'exclusion', 'fallo_red', 'macro', 'empresa', 'mercado', 'otro']);

const SISTEMA_NOTICIAS = 'Eres el equipo de analistas de una mesa de trading en papel. Clasificas titulares de noticias en una lista cerrada. '
  + 'No inventas datos ni opinas: solo eliges de las listas.';
const INSTRUCCIONES_NOTICIAS = [
  'Para cada noticia de «noticias», devuelve su id, el símbolo afectado (de la lista «simbolos»), una categoría y si es un EVENTO GRAVE.',
  'Evento grave SOLO si amenaza directamente al activo en días: hackeo o robo, quiebra o insolvencia de un emisor o exchange clave,',
  'prohibición regulatoria, exclusión de cotización (delisting) o caída de la red del activo. Opiniones, previsiones de precio,',
  'datos macro o resultados de empresa NO son eventos graves.',
].join('\n');

function esquemaNoticias(ids, simbolos) {
  return {
    type: 'object',
    properties: {
      noticias: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', enum: ids },
            simbolo: { type: 'string', enum: simbolos },
            categoria: { type: 'string', enum: [...CATEGORIAS_NOTICIA] },
            impacto: { type: 'string', enum: ['positivo', 'neutral', 'negativo'] },
            eventoGrave: { type: 'boolean' },
          },
          required: ['id', 'simbolo', 'categoria', 'impacto', 'eventoGrave'],
          additionalProperties: false,
        },
      },
    },
    required: ['noticias'],
    additionalProperties: false,
  };
}

function hayNoticias(ctx) {
  return Boolean(ctx.config.alpaca && ctx.config.alpaca.hay && ctx.llm && ctx.llm.activo && ctx.modo !== 'sintetico');
}

async function noticias(ctx) {
  if (!hayNoticias(ctx)) return null;
  const ahora = ctx.reloj.ahora();
  const n = ctx.estado.noticias;
  if (n.ultima !== null && ahora - n.ultima < CADA_NOTICIAS) return null;
  n.ultima = ahora;
  const simbolos = ctx.universo.map(a => a.simbolo);
  const lista = await ctx.datos.noticias(simbolos, { desde: ahora - CADA_NOTICIAS, limite: 40 });
  const vistos = new Set(n.vistos || []);
  const nuevas = (lista || []).filter(x => x && x.id !== undefined && !vistos.has(String(x.id))).slice(0, 30);
  if (!nuevas.length) return { clasificadas: 0 };
  for (const x of nuevas) vistos.add(String(x.id));
  n.vistos = [...vistos].slice(-500);

  const ids = nuevas.map(x => String(x.id));
  const r = await ctx.llm.pedirJSON({
    uso: 'agentes', proposito: 'noticias', sistema: SISTEMA_NOTICIAS, instrucciones: INSTRUCCIONES_NOTICIAS,
    entrada: { simbolos, noticias: nuevas.map(x => ({ id: String(x.id), titular: x.titular, resumen: String(x.resumen || '').slice(0, 400), simbolos: x.simbolos })) },
    esquema: esquemaNoticias(ids, simbolos), maxTokens: 3000, esfuerzo: 'low',
  });
  if (!r.ok) return { clasificadas: 0, motivo: r.motivo };
  const porId = new Map(nuevas.map(x => [String(x.id), x]));
  let graves = 0;
  for (const c of r.datos.noticias) {
    if (!c.eventoGrave) continue;
    const noticia = porId.get(c.id);
    if (!noticia) continue;
    graves++;
    const hasta = ahora + VETO_NOTICIA;
    const d = ctx.estado.directivas;
    d.activosVetados = (d.activosVetados || []).filter(v => !(v.simbolo === c.simbolo && v.origen === 'noticias'));
    d.activosVetados.push({ simbolo: c.simbolo, hasta, motivo: `noticia grave (${c.categoria})`, origen: 'noticias' });
    n.eventosGraves = (n.eventosGraves || []).filter(e => e.hasta > ahora);
    n.eventosGraves.push({ simbolo: c.simbolo, hasta, categoria: c.categoria, titular: noticia.titular, t: ahora });
    // El titular es de la fuente, no del LLM: no lleva cifras inventadas.
    ctx.bus.publicar({
      de: `analista-${etiqueta(c.simbolo)}`, canal: 'analisis', tipo: 'alerta',
      texto: plantillas.frase(`Noticia grave en ${etiqueta(c.simbolo)} (${c.categoria}): «${noticia.titular}». No se abre hasta las ${f.hora(hasta)}.`),
      datos: { simbolo: c.simbolo, categoria: c.categoria, hasta, noticiaId: c.id, url: noticia.url || null },
      importancia: 3, costeUsd: r.costeUsd,
    });
  }
  return { clasificadas: r.datos.noticias.length, graves };
}

module.exports = { notas, noticias, sesgoDe, esquemaNoticias, CATEGORIAS_NOTICIA, hayNoticias };
