'use strict';
// Conversaciones del chat (§6.2): quién contesta a quién.
//
// Una operación es un hilo por puesto. La señal del operador lo abre y cada
// mensaje de la cadena contesta al anterior: propuesta → Riesgos (aprueba,
// recorta o veta, dirigiéndose al operador por su nombre) → Ejecutor (confirma
// a los dos) → ejecución → … → cierre. Al cerrar, el hilo se guarda por
// operación en `estado.conversaciones.cierres` y el Auditor, en el cierre
// diario, contesta al operador en ese mismo hilo.
//
// El Megáfono es otro hilo: la orden del humano, la propuesta de la
// Presidenta, las directivas aplicadas y la respuesta del agente al que le
// toca cada una (`estado.conversaciones.megafono`).
//
// Todo vive en el estado (estado.puestos[pid].conversacion y
// estado.conversaciones): el latido siguiente, que es otro proceso, sigue la
// misma conversación. Aquí no se decide nada: solo se enlazan mensajes.

const plantillas = require('./plantillas');
const { etiqueta, agenteDePuesto } = require('./departamentos/comun');

const MAX_CIERRES = 300;
const VIDA_CIERRE = 10 * 86_400_000;   // el Auditor pasa como mucho al día siguiente (o al volver el portátil)

function agente(ctx, id) {
  if (!id) return null;
  if (typeof ctx.agentePorId === 'function') return ctx.agentePorId(id) || null;
  return ctx.bus && ctx.bus.agentes ? ctx.bus.agentes.get(id) || null : null;
}

// Nombre de pila de un agente de la plantilla ('' si no existe).
function pilaDe(ctx, id) {
  const a = agente(ctx, id);
  return a ? plantillas.pila(a.nombre) : '';
}

// El operador de un puesto, si existe en la plantilla (null si no: la mesa
// 'fondo' de las liquidaciones, un puesto sin agente).
function operadorDe(ctx, mesaId, simbolo) {
  if (!mesaId || !simbolo) return null;
  const id = agenteDePuesto(mesaId, simbolo);
  return agente(ctx, id) ? id : null;
}

function auxDe(ctx, pid) {
  const p = ctx.estado && ctx.estado.puestos;
  return pid && p && p[pid] ? p[pid] : null;
}

// Abre una conversación nueva en el puesto (la señal de abrir).
function abrir(ctx, pid, mensaje) {
  const m = ctx.bus.publicar({ ...mensaje, respondeA: null, hilo: true });
  const aux = auxDe(ctx, pid);
  if (aux) aux.conversacion = { hilo: m.hilo, ultimo: m.id };
  return m;
}

// Contesta al último mensaje de la conversación del puesto; si el puesto no
// tiene ninguna abierta, la abre. Sin puesto en el estado, mensaje suelto.
function seguir(ctx, pid, mensaje) {
  const aux = auxDe(ctx, pid);
  if (!aux) return ctx.bus.publicar(mensaje);
  const c = aux.conversacion;
  if (!c || !c.hilo) return abrir(ctx, pid, mensaje);
  const m = ctx.bus.publicar({ ...mensaje, respondeA: c.ultimo, hilo: c.hilo });
  aux.conversacion = { hilo: c.hilo, ultimo: m.id };
  return m;
}

// Termina la conversación del puesto. Con `operacionId` y el mensaje del
// cierre, la guarda para que el Auditor conteste en el mismo hilo.
function terminar(ctx, pid, { operacionId, mensaje } = {}) {
  const aux = auxDe(ctx, pid);
  if (aux) delete aux.conversacion;
  if (operacionId === undefined || operacionId === null || !mensaje) return;
  const e = ctx.estado;
  const conv = e.conversaciones || (e.conversaciones = {});
  const cierres = conv.cierres || (conv.cierres = {});
  cierres[String(operacionId)] = { hilo: mensaje.hilo || mensaje.id, id: mensaje.id, de: mensaje.de, t: mensaje.t };
  podar(ctx);
}

function podar(ctx) {
  const cierres = ctx.estado.conversaciones && ctx.estado.conversaciones.cierres;
  if (!cierres) return;
  const limite = ctx.reloj.ahora() - VIDA_CIERRE;
  for (const [k, v] of Object.entries(cierres)) if (!v || !(v.t >= limite)) delete cierres[k];
  const claves = Object.keys(cierres);
  if (claves.length > MAX_CIERRES) {
    claves.sort((a, b) => cierres[a].t - cierres[b].t || (a < b ? -1 : 1));
    for (const k of claves.slice(0, claves.length - MAX_CIERRES)) delete cierres[k];
  }
}

// El hilo del cierre de una operación (y se olvida: el Auditor contesta una vez).
function cierreDe(ctx, operacionId, { quitar = true } = {}) {
  const cierres = ctx.estado.conversaciones && ctx.estado.conversaciones.cierres;
  const k = String(operacionId);
  const c = cierres && cierres[k] ? cierres[k] : null;
  if (c && quitar) delete cierres[k];
  return c;
}

// ---------- Megáfono ----------

function convMegafono(ctx) {
  const e = ctx.estado;
  const conv = e.conversaciones || (e.conversaciones = {});
  return conv;
}

// La orden del humano abre la conversación del Megáfono.
function megafonoOrden(ctx, texto) {
  const m = ctx.bus.publicar({ de: 'humano', canal: 'megafono', tipo: 'megafono', texto: `«${texto}»`, datos: { texto }, importancia: 3, hilo: true });
  convMegafono(ctx).megafono = { hilo: m.hilo, ultimo: m.id, propuestaId: null };
  return m;
}

// La Presidenta contesta al humano con la propuesta (lo que ha entendido).
function megafonoPropuesta(ctx, { texto, datos, costeUsd = 0 }) {
  const c = convMegafono(ctx).megafono;
  const m = ctx.bus.publicar({
    de: 'cio', para: 'humano', canal: 'megafono', tipo: 'propuesta', texto, datos, importancia: 2, costeUsd,
    ...(c ? { respondeA: c.ultimo, hilo: c.hilo } : {}),
  });
  convMegafono(ctx).megafono = { hilo: m.hilo || m.id, ultimo: m.id, propuestaId: datos && datos.id ? datos.id : null };
  return m;
}

// A quién le toca una directiva: quien la tiene que cumplir.
function afectadoPor(ctx, d) {
  const mesas = (ctx.estado.mesas || []).filter(m => m.estado !== 'banquillo');
  switch (d && d.tipo) {
    case 'reducir_riesgo':
    case 'solo_cerrar':
      return 'riesgos';
    case 'pausar_activo':
    case 'reanudar_activo': {
      for (const m of mesas) {
        if (!(m.universo || []).includes(d.simbolo)) continue;
        const op = operadorDe(ctx, m.id, d.simbolo);
        if (op) return op;
      }
      const analista = `analista-${etiqueta(d.simbolo)}`;
      return agente(ctx, analista) ? analista : 'riesgos';
    }
    case 'pausar_mesa':
    case 'reanudar_mesa': {
      const m = (ctx.estado.mesas || []).find(x => x.id === d.mesaId);
      for (const s of (m && m.universo) || []) {
        const op = operadorDe(ctx, m.id, s);
        if (op) return op;
      }
      return 'cio';
    }
    default:
      return null;
  }
}

// La Presidenta anuncia cada directiva aplicada y el agente afectado contesta
// al humano en el mismo hilo. `propuestaId`: la propuesta que se aplica (si
// no es la de la conversación guardada, van sueltos).
function megafonoDirectiva(ctx, dir, { propuestaId = null } = {}) {
  const conv = convMegafono(ctx);
  const c = conv.megafono && (!propuestaId || conv.megafono.propuestaId === propuestaId) ? conv.megafono : null;
  const mesas = ctx.estado.mesas;
  const anuncio = ctx.bus.publicar({
    de: 'cio', para: 'todos', canal: 'megafono', tipo: 'directiva', texto: plantillas.directiva(dir, mesas), datos: { ...dir }, importancia: 3,
    ...(c ? { respondeA: c.ultimo, hilo: c.hilo } : {}),
  });
  const quien = afectadoPor(ctx, dir);
  let ultimo = anuncio;
  if (quien) {
    ultimo = ctx.bus.publicar({
      de: quien, para: 'humano', canal: 'megafono', tipo: 'nota', texto: plantillas.respuestaMegafono(dir, { mesas }),
      datos: { directiva: { ...dir } }, importancia: 2, respondeA: anuncio.id, hilo: anuncio.hilo || anuncio.id,
    });
  }
  if (c) conv.megafono = { ...c, ultimo: ultimo.id };
  return { anuncio, respuesta: quien ? ultimo : null };
}

module.exports = {
  abrir, seguir, terminar, cierreDe, pilaDe, operadorDe, agente,
  megafonoOrden, megafonoPropuesta, megafonoDirectiva, afectadoPor,
  MAX_CIERRES, VIDA_CIERRE,
};
