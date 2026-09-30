'use strict';
// Macro (§6.9): régimen con cada vela 1H cerrada y miedo y codicia cada hora.
// El régimen es la regla fija de src/mercado/regimen.js; aquí solo se decide
// cuándo se cuenta: si cambia o, como mucho, cada 4 h.

const { calcularRegimen } = require('../../mercado/regimen');
const plantillas = require('../plantillas');
const { inicioVela, diaUTC, HORA, DIA } = require('../../util/reloj');

const CADA_MENSAJE = 4 * HORA;
const DIAS_FG = 5;

function anotarDia(m, punto) {
  const lista = m.fgDias || (m.fgDias = []);
  const k = lista.findIndex(x => x.dia === punto.dia);
  if (k >= 0) lista[k] = punto; else lista.push(punto);
  lista.sort((a, b) => (a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : 0));
  if (lista.length > DIAS_FG) lista.splice(0, lista.length - DIAS_FG);
}
// SMA200 diaria + margen para fines de semana y huecos de datos.
const DIAS_DIARIAS = 320;

async function actualizar(ctx, { forzar = false } = {}) {
  const ahora = ctx.reloj.ahora();
  const m = ctx.estado.macro;
  const hora = inicioVela(ahora, HORA);
  if (!forzar && m.ultimaHora !== null && hora <= m.ultimaHora) return null;
  m.ultimaHora = hora;

  const btcDiario = await ctx.datos.velas('BTC/USD', '1Day', { desde: ahora - DIAS_DIARIAS * DIA, hasta: ahora });
  let spyDiario = null;
  if (ctx.datos.disponible('SPY') && ctx.universo.some(a => a.simbolo === 'SPY')) {
    spyDiario = await ctx.datos.velas('SPY', '1Day', { desde: ahora - DIAS_DIARIAS * DIA, hasta: ahora });
  }
  const r = calcularRegimen({ btcDiario, spyDiario });
  const anterior = m.regimen ? m.regimen.valor : null;

  // Miedo y codicia: la fuente ya cachea una hora; sin red se queda el último.
  let fg = null;
  try { fg = await ctx.fg.actual(); } catch (_) { fg = m.fg; }
  m.fg = fg ? { valor: fg.valor, etiqueta: fg.etiqueta, sintetico: Boolean(fg.sintetico), t: fg.t ?? null } : m.fg;
  // Los últimos días, para que las mesas usen el valor vigente en la hora de
  // su decisión (valorEn(·, t − RETRASO_FG), como el backtest) y no el último
  // leído: a las 00:00 aún vale el de ayer. En frío se siembra con el histórico.
  if (!Array.isArray(m.fgDias) || !m.fgDias.length) {
    try {
      const hist = (await ctx.fg.historico()) || [];
      m.fgDias = hist.filter(x => x && typeof x.dia === 'string' && Number.isFinite(x.valor)).map(x => ({ dia: x.dia, valor: x.valor })).slice(-DIAS_FG);
    } catch (_) { m.fgDias = []; }
  }
  if (m.fg && Number.isFinite(m.fg.t) && Number.isFinite(m.fg.valor)) anotarDia(m, { dia: diaUTC(m.fg.t), valor: m.fg.valor });
  m.regimen = { valor: r.valor, puntos: r.puntos, detalle: r.detalle, t: r.t };

  const cambia = anterior !== null && anterior !== r.valor;
  if (forzar || cambia || m.ultimoMensaje === null || ahora - m.ultimoMensaje >= CADA_MENSAJE) {
    m.ultimoMensaje = ahora;
    ctx.bus.publicar({
      de: 'macro', canal: 'macro', tipo: 'regimen',
      texto: plantillas.regimen({ valor: r.valor, puntos: r.puntos, anterior, detalle: r.detalle }),
      datos: { valor: r.valor, puntos: r.puntos, anterior, fg: m.fg ? m.fg.valor : null, componentes: r.componentes },
      importancia: cambia ? 3 : 1,
    });
  }
  return m.regimen;
}

module.exports = { actualizar, CADA_MENSAJE };
