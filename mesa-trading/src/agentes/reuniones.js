'use strict';
// Reuniones informativas (§6.9), con el reloj de la mesa y la hora de Madrid
// (cambio de hora incluido):
//
//   «Reunión de la mañana», 9:00  Controller: cómo fue la noche (desde el
//                                 cierre del día anterior) · Macro: el
//                                 ambiente · Riesgos: qué vigila · cada
//                                 operador con posición: qué tiene y su stop ·
//                                 Presidenta: resumen.
//   «Cierre del día», 22:15       Controller: resultado del día y operaciones
//                                 cerradas · Riesgos: lo que queda abierto ·
//                                 Presidenta: cierra.
//
// Solo CUENTAN: no cambian modo, multiplicadores ni vetos (eso es del comité
// de 4 h) y no tocan nada del fondo. Los jefes van a la sala de comité como en
// el comité (en el modo latido se ven allí hasta estado.comite.salaHasta).
//
// La cadencia vive en estado.cadencias (proximaReunionManana,
// proximaReunionCierre): exacta latido a latido. Una reunión que llega más de
// una hora tarde (portátil apagado) no se celebra a destiempo: se pasa a la
// siguiente. Si hay un comité reunido (modo continuo, en segundo plano), la
// reunión espera al paso siguiente.
//
// Conversación (§6.2): la apertura de la Presidenta abre el hilo y cada turno
// contesta al anterior. Con LLM, UNA llamada redacta los turnos; cada texto
// pasa por verificarCifras contra los datos de SU turno, también los conteos
// («4 operaciones», «cuatro»), y no puede decir un modo o un régimen distinto
// del de ahora, ni por su nombre ni en llano («a la mitad», «tiene miedo»);
// del modo y de las compras solo habla el resumen, con lo que el fondo hace
// de verdad (nada, si no está en nivel normal); si no, plantilla.

const plantillas = require('./plantillas');
const comite = require('./comite');
const { verificarCifras, contradiceVocabulario } = require('./cifras');
const conversacion = require('./conversacion');
const { directivasVigentes } = require('./megafono');
const mesasDep = require('./departamentos/mesas');
const f = require('../util/formato');
const { inicioVela, MIN, HORA, DIA } = require('../util/reloj');
const { EPS, etiqueta, agenteDePuesto } = require('./departamentos/comun');

const ZONA = 'Europe/Madrid';
const CITAS = Object.freeze({
  manana: Object.freeze({ campo: 'proximaReunionManana', hora: 9, minuto: 0, nombre: 'Reunión de la mañana' }),
  cierre: Object.freeze({ campo: 'proximaReunionCierre', hora: 22, minuto: 15, nombre: 'Cierre del día' }),
});
const TARDE_MAX = HORA;
// Los mismos que van al comité (el laboratorio escucha): la instantánea los
// pone en la sala hasta estado.comite.salaHasta.
const JEFES = comite.JEFES;

// ---------- Hora de Madrid ----------

const partesMadrid = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function enMadrid(t) {
  const p = {};
  for (const x of partesMadrid.formatToParts(new Date(t))) if (x.type !== 'literal') p[x.type] = Number(x.value);
  return p;
}

// Diferencia de Madrid con UTC en el instante t (ms): +1 h en invierno, +2 h en verano.
function desfase(t) {
  const p = enMadrid(t);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(t / MIN) * MIN;
}

// Instante (ms UTC) de las hh:mm de Madrid del día (año, mes 1-12, día).
function instanteMadrid(anio, mes, dia, hora, minuto) {
  const local = Date.UTC(anio, mes - 1, dia, hora, minuto);
  let t = local - desfase(local);
  // Si el desfase de ese instante no es el que se supuso (día del cambio de hora), se corrige.
  const d2 = desfase(t);
  if (local - d2 !== t) t = local - d2;
  return t;
}

// La próxima cita (hh:mm de Madrid) estrictamente después de `ahora`.
function siguienteCita(ahora, { hora, minuto }) {
  const p = enMadrid(ahora);
  for (let k = 0; k < 3; k++) {
    const d = new Date(Date.UTC(p.year, p.month - 1, p.day + k));
    const t = instanteMadrid(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), hora, minuto);
    if (t > ahora) return t;
  }
  return ahora + DIA;
}

// La última cita (hh:mm de Madrid) en o antes de `ahora`.
function anteriorCita(ahora, cita) {
  const sig = siguienteCita(ahora, cita);
  const p = enMadrid(sig);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day - 1));
  return instanteMadrid(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), cita.hora, cita.minuto);
}

// ---------- Datos de cada turno (todo del código) ----------

function nombre(ctx, id) { return conversacion.pilaDe(ctx, id); }

function posicionesAbiertas(ctx) {
  const por = (ctx.vivo.valoracion && ctx.vivo.valoracion.porPuesto) || {};
  return ctx.libros.listaPuestos({ sombra: false })
    .filter(p => p.cantidad > EPS)
    .map(p => {
      const v = por[p.puestoId] || {};
      const q = ctx.vivo.precios && ctx.vivo.precios[p.simbolo];
      return {
        puestoId: p.puestoId, mesaId: p.mesaId, simbolo: p.simbolo, etiqueta: etiqueta(p.simbolo),
        cantidad: p.cantidad, entrada: p.costeMedio, precio: q && q.precio > 0 ? q.precio : (Number.isFinite(v.precio) ? v.precio : null),
        pnlAbierto: Number.isFinite(v.pnlAbierto) ? v.pnlAbierto : null, pnlAbiertoPct: Number.isFinite(v.pnlAbiertoPct) ? v.pnlAbiertoPct : null,
        stop: Number.isFinite(p.stop) ? p.stop : null,
      };
    });
}

// Operaciones reales cerradas en (desde, hasta], sin las de prueba.
function cerradasEntre(ctx, desde, hasta) {
  return (ctx.operaciones || []).filter(o => o && !o.sombra && o.motivoSalida !== 'prueba' && Number.isFinite(o.salidaT) && o.salidaT > desde && o.salidaT <= hasta);
}

// Patrimonio en el instante `t`: el del último cierre del día si es ese, o el
// último punto de la curva horaria anterior a `t` (null si no hay).
function patrimonioEn(ctx, t) {
  const r = ctx.estado.reuniones || {};
  if (r.ultimoCierre && Number.isFinite(r.ultimoCierre.patrimonio) && Math.abs(r.ultimoCierre.t - t) <= TARDE_MAX) return r.ultimoCierre.patrimonio;
  const curva = ctx.estado.curva || [];
  for (let k = curva.length - 1; k >= 0; k--) if (curva[k].t <= t) return curva[k].patrimonio > 0 ? curva[k].patrimonio : null;
  return null;
}

// Lo mismo que Riesgos cuenta en el comité (cerca de sus límites), sin votar.
function riesgosAhora(ctx) {
  return comite.reunirDatos(ctx).riesgos;
}

// Turnos de la reunión, en orden: { id, de, tipo, datos, plantilla(datos, anterior) }.
function turnosManana(ctx, ahora) {
  const e = ctx.estado;
  const desde = anteriorCita(ahora, CITAS.cierre);
  const antes = patrimonioEn(ctx, desde);
  const ops = cerradasEntre(ctx, desde, ahora);
  const reg = e.macro.regimen || { valor: 'NEUTRAL', puntos: 0 };
  const rg = riesgosAhora(ctx);
  const vetados = [...new Set((directivasVigentes(e.directivas, ahora).activosVetados || []).map(v => v.simbolo))];
  const pos = posicionesAbiertas(ctx);
  const turnos = [
    {
      id: 'noche', de: 'controller', tipo: 'informe',
      datos: {
        patrimonio: ctx.vivo.patrimonio, patrimonioAntes: antes,
        cambio: antes > 0 ? ctx.vivo.patrimonio - antes : null, cambioPct: antes > 0 ? ctx.vivo.patrimonio / antes - 1 : null,
        desdeHora: f.hora(desde), operaciones: ops.length, pnlOperaciones: ops.reduce((s, o) => s + (o.pnl || 0), 0),
      },
      plantilla: plantillas.reunion.noche,
    },
    {
      id: 'macro', de: 'macro', tipo: 'informe',
      datos: { regimen: reg.valor, puntos: reg.puntos, fg: e.macro.fg && Number.isFinite(e.macro.fg.valor) ? e.macro.fg.valor : null, escalaMiedo: 100 },
      plantilla: plantillas.reunion.macro,
    },
    {
      id: 'riesgos', de: 'riesgos', tipo: 'informe',
      datos: { nivel: e.fondo.nivel, cercanos: rg.cercanos, vetados },
      plantilla: plantillas.reunion.riesgos,
    },
  ];
  for (const p of pos) {
    const de = agenteDePuesto(p.mesaId, p.simbolo);
    if (!conversacion.agente(ctx, de)) continue;
    // Los operadores cuentan lo suyo a toda la sala, sin dirigirse a nadie.
    turnos.push({ id: `posicion-${p.puestoId}`, de, tipo: 'informe', datos: { ...p }, plantilla: plantillas.reunion.posicion, aTodos: true });
  }
  turnos.push({
    id: 'resumen', de: 'cio', tipo: 'reunion',
    datos: { patrimonio: ctx.vivo.patrimonio, posiciones: pos.length, ...comoCompra(ctx, ahora), proximoComite: Number.isFinite(e.cadencias.proximoComite) ? f.hora(e.cadencias.proximoComite) : null },
    plantilla: plantillas.reunion.resumenManana,
  });
  return turnos;
}

// Lo que el fondo hace de verdad con las compras (plantillas.comoCompra): el
// modo, el nivel, el factor que se aplica y el «solo cerrar» del Megáfono.
function comoCompra(ctx, ahora) {
  const e = ctx.estado;
  const vig = directivasVigentes(e.directivas, ahora);
  return {
    modo: e.directivas.modo || 'NORMAL', nivel: e.fondo.nivel, factor: mesasDep.factorTamano(ctx, ahora),
    soloCerrarHasta: Number.isFinite(vig.soloCerrarHasta) ? f.hora(vig.soloCerrarHasta) : null,
  };
}

function turnosCierre(ctx, ahora) {
  const e = ctx.estado;
  const inicioDia = inicioVela(ahora, DIA);
  const patrimonio = ctx.vivo.patrimonio;
  const pnlDia = e.patrimonioInicioDia > 0 ? patrimonio - e.patrimonioInicioDia : null;
  const ops = cerradasEntre(ctx, inicioDia, ahora);
  const orden = [...ops].sort((a, b) => b.pnl - a.pnl);
  const pos = posicionesAbiertas(ctx);
  return [
    {
      id: 'resultado', de: 'controller', tipo: 'informe',
      datos: { patrimonio, pnlDia, pnlDiaPct: pnlDia !== null ? pnlDia / e.patrimonioInicioDia : null, desdeHora: f.hora(inicioDia) },
      plantilla: plantillas.reunion.resultadoDia,
    },
    {
      id: 'cerradas', de: 'controller', tipo: 'informe',
      datos: {
        operaciones: ops.length, ganadoras: ops.filter(o => o.pnl > 0).length, perdedoras: ops.filter(o => !(o.pnl > 0)).length, pnl: ops.reduce((s, o) => s + (o.pnl || 0), 0),
        mejor: orden.length ? { etiqueta: etiqueta(orden[0].simbolo), pnl: orden[0].pnl } : null,
        peor: orden.length > 1 ? { etiqueta: etiqueta(orden[orden.length - 1].simbolo), pnl: orden[orden.length - 1].pnl } : null,
      },
      plantilla: plantillas.reunion.cerradas,
    },
    {
      id: 'abiertas', de: 'riesgos', tipo: 'informe',
      datos: { posiciones: pos.length, pnlAbierto: pos.reduce((s, p) => s + (p.pnlAbierto || 0), 0), lista: pos.map(p => p.etiqueta) },
      plantilla: plantillas.reunion.abiertas,
    },
    {
      id: 'resumen', de: 'cio', tipo: 'reunion',
      datos: { patrimonio, pnlDia, ...comoCompra(ctx, ahora) },
      plantilla: plantillas.reunion.resumenCierre,
    },
  ];
}

// ---------- LLM (opcional): redacta los turnos, con el mismo control de cifras ----------

const SISTEMA = 'Redactas lo que dice cada participante en una reunión informativa de una mesa de trading en papel. '
  + 'Lo lee alguien que no sabe de bolsa: español de España, tono llano y cercano, frases cortas, primera persona, sin jerga ni siglas sin explicar. '
  + 'Nunca inventas cifras: cualquier número que escribas tiene que estar en los datos de ese turno. La reunión no decide nada.';

const INSTRUCCIONES = [
  'Para cada turno de «turnos», escribe lo que dice «quien» con los «datos» de SU turno: una o dos frases, 200 caracteres como mucho.',
  'Es una conversación: cuando venga a cuento, dirígete a quien habló antes por su nombre de pila («Gracias, Inés.»). El primero contesta a la Presidenta, que abrió la reunión.',
  'Del modo del fondo y de cómo se compra («a la mitad», «tamaño normal», «no se abre nada») solo habla la Presidenta en el resumen, y solo con lo de sus datos: si «nivel» no es «normal», el fondo no compra nada.',
  'Del mercado, solo el régimen de los datos, también en llano («acompaña» es RISK-ON; «ni a favor ni en contra», NEUTRAL; «tiene miedo», RISK-OFF). No propongas cambios: la reunión solo cuenta.',
  'Un turno que diga otro modo u otro régimen, aunque sea en llano, o una cifra que no esté en sus datos (también «cuatro operaciones»), se descarta y sale la plantilla.',
].join('\n');

function esquema(ids) {
  return {
    type: 'object',
    properties: {
      intervenciones: {
        type: 'array',
        items: {
          type: 'object',
          properties: { turno: { type: 'string', enum: ids }, texto: { type: 'string' } },
          required: ['turno', 'texto'],
          additionalProperties: false,
        },
      },
    },
    required: ['intervenciones'],
    additionalProperties: false,
  };
}

// Un texto del LLM vale si sus cifras (también los conteos) están en los datos
// de su turno y no dice un modo ni un régimen que no son los de ahora, ni por
// su nombre ni en llano. El modo solo lo puede decir el turno que lo lleva en
// sus datos (el resumen), y lo que diga de las compras tiene que ser lo que
// pasa (plantillas.comprasEfectivas): nada si el fondo no está en nivel
// normal, y el factor real (con la caída del fondo, «tamaño normal» no vale).
function textoValido(texto, turno, { hora, regimen }) {
  if (!texto) return false;
  const d = turno.datos || {};
  const modos = d.modo ? [d.modo] : [];
  const efectivas = d.modo ? plantillas.comprasEfectivas(d) : null;
  const compras = efectivas ? [efectivas] : [];
  if (contradiceVocabulario(texto, { modos, compras, regimen })) return false;
  return verificarCifras(texto, { hora, datos: d }, { conteos: true }).ok;
}

async function redactarConLLM(ctx, tipo, turnos, hora) {
  if (!ctx.llm || !ctx.llm.activo) return { textos: {}, costeUsd: 0 };
  const entrada = {
    reunion: CITAS[tipo].nombre, hora, presidenta: nombre(ctx, 'cio'),
    turnos: turnos.map(t => ({ turno: t.id, quien: nombre(ctx, t.de), datos: t.datos })),
  };
  const r = await ctx.llm.pedirJSON({
    uso: 'agentes', proposito: 'reunion', sistema: SISTEMA, instrucciones: INSTRUCCIONES, entrada,
    esquema: esquema(turnos.map(t => t.id)), maxTokens: 1500, esfuerzo: 'low',
  });
  const textos = {};
  if (r.ok) for (const it of r.datos.intervenciones || []) if (it && !textos[it.turno]) textos[it.turno] = String(it.texto || '').trim();
  return { textos, costeUsd: r.costeUsd || 0 };
}

// ---------- La reunión ----------

async function celebrar(ctx, tipo) {
  const cita = CITAS[tipo];
  if (!cita) throw new Error(`reunión desconocida: ${tipo}`);
  const e = ctx.estado;
  const ahora = ctx.reloj.ahora();
  const hora = f.hora(ahora);
  ctx.reunionEnCurso = true;
  try {
    for (const id of JEFES) ctx.moverAgente(id, 'comite', 'reunion');
    const turnos = tipo === 'manana' ? turnosManana(ctx, ahora) : turnosCierre(ctx, ahora);
    const { textos, costeUsd } = await redactarConLLM(ctx, tipo, turnos, hora);
    const comprobar = { hora, regimen: e.macro.regimen ? e.macro.regimen.valor : 'NEUTRAL' };
    const apertura = ctx.bus.publicar({
      de: 'cio', para: turnos[0].de, canal: 'direccion', tipo: 'reunion',
      texto: plantillas.reunion.apertura({ tipo, hora, primero: nombre(ctx, turnos[0].de) }),
      datos: { reunion: tipo, fase: 'apertura', nombre: cita.nombre, turnos: turnos.map(t => t.id) }, importancia: 2, hilo: true, costeUsd,
    });
    let anterior = apertura;
    let usadosLLM = 0;
    for (const turno of turnos) {
      const deAntes = anterior.de !== turno.de && !turno.aTodos ? anterior.de : null;
      const propuesto = textos[turno.id];
      const vale = textoValido(propuesto, turno, comprobar);
      if (vale) usadosLLM++;
      const texto = vale ? plantillas.frase(propuesto, plantillas.MAX) : turno.plantilla({ ...turno.datos, anterior: deAntes ? nombre(ctx, deAntes) : null });
      anterior = ctx.bus.publicar({
        de: turno.de, para: deAntes || 'todos', canal: 'direccion', tipo: turno.tipo, texto,
        datos: { reunion: tipo, turno: turno.id, fuente: vale ? 'llm' : 'plantilla', ...(turno.id === 'resumen' ? { fase: 'cierre' } : {}) },
        importancia: turno.id === 'resumen' ? 2 : 1, respondeA: anterior.id, hilo: apertura.id,
      });
    }
    // Memoria para la reunión siguiente: la de la mañana cuenta desde este cierre.
    const r = e.reuniones || (e.reuniones = {});
    r[tipo === 'manana' ? 'ultimaManana' : 'ultimoCierre'] = { t: ahora, patrimonio: ctx.vivo.patrimonio };
    anotar(ctx, tipo, turnos, { hora, fuente: usadosLLM ? 'llm' : 'plantilla', costeUsd });
    return { ok: true, tipo, turnos: turnos.length };
  } finally {
    const bloqueado = e.fondo.nivel === 'bloqueado';
    for (const id of JEFES) ctx.moverAgente(id, null, bloqueado ? 'de_pie' : 'trabajando');
    const sala = ctx.opciones && ctx.opciones.salaTrasComiteMs;
    if (sala > 0) e.comite.salaHasta = Math.max(Number.isFinite(e.comite.salaHasta) ? e.comite.salaHasta : 0, ctx.reloj.ahora() + sala);
    ctx.reunionEnCurso = false;
  }
}

// Una línea en decisiones.jsonl, tipo 'reunion' (§6.10): la reunión no
// decide nada, pero la pantalla de Decisiones la cuenta con sus cifras.
function anotar(ctx, tipo, turnos, { hora, fuente, costeUsd }) {
  if (typeof ctx.anotarDecision !== 'function') return false;
  const d = Object.fromEntries(turnos.map(t => [t.id, t.datos]));
  const nivel = d.resumen.nivel;
  const modo = nivel && nivel !== 'normal' ? `modo ${d.resumen.modo} pero sin comprar (fondo ${plantillas.NIVEL_TEXTO[nivel] || nivel})` : `modo ${d.resumen.modo}`;
  const resumen = tipo === 'manana'
    ? `${CITAS.manana.nombre} (${hora}): el fondo vale ${f.usd(d.resumen.patrimonio)}, ${d.resumen.posiciones} ${d.resumen.posiciones === 1 ? 'posición abierta' : 'posiciones abiertas'}, ${modo}. Informativa: no cambia nada.`
    : `${CITAS.cierre.nombre} (${hora}): el fondo vale ${f.usd(d.resumen.patrimonio)}${Number.isFinite(d.resumen.pnlDia) ? ` (${f.usd(d.resumen.pnlDia, { signo: true })} hoy)` : ''}, ${d.cerradas.operaciones} ${d.cerradas.operaciones === 1 ? 'operación cerrada' : 'operaciones cerradas'}, ${modo}. Informativa: no cambia nada.`;
  return ctx.anotarDecision({ tipo: 'reunion', quien: 'cio', resumen, datos: { reunion: tipo, hora, fuente, costeUsd, turnos: d } });
}

// ---------- Cadencia (la llama el orquestador en cada paso) ----------

async function cadencia(ctx, ahora = ctx.reloj.ahora()) {
  const c = ctx.estado.cadencias;
  const hechas = [];
  for (const tipo of Object.keys(CITAS)) {
    const cita = CITAS[tipo];
    // Primera vez (fondo nuevo o de antes de las reuniones): la próxima cita.
    if (!Number.isFinite(c[cita.campo])) { c[cita.campo] = siguienteCita(ahora, cita); continue; }
    if (ahora < c[cita.campo]) continue;
    // Con un comité reunido (continuo, en segundo plano) se espera al paso siguiente.
    if (ctx.comiteEnCurso || ctx.reunionEnCurso) return hechas;
    const tarde = ahora - c[cita.campo];
    c[cita.campo] = siguienteCita(ahora, cita);
    if (tarde > TARDE_MAX) continue;
    // Modo latido con LLM: la cita ya movida queda en disco antes de llamar;
    // un latido que muere a mitad no repite la reunión (ni la llamada).
    if (ctx.opciones && ctx.opciones.latido && ctx.llm && ctx.llm.activo && typeof ctx.guardar === 'function') ctx.guardar();
    await celebrar(ctx, tipo);
    hechas.push(tipo);
  }
  return hechas;
}

module.exports = {
  cadencia, celebrar, siguienteCita, anteriorCita, instanteMadrid, turnosManana, turnosCierre, textoValido,
  CITAS, TARDE_MAX, JEFES,
};
