'use strict';
// Macro (§6.9): régimen con cada vela 1H cerrada y miedo y codicia cada hora.
// El régimen es la regla fija de src/mercado/regimen.js; aquí solo se decide
// cuándo se cuenta: si cambia o, como mucho, cada 4 h.

const { calcularRegimen } = require('../../mercado/regimen');
const plantillas = require('../plantillas');
const { inicioVela, HORA, DIA } = require('../../util/reloj');

const CADA_MENSAJE = 4 * HORA;
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
