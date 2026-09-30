'use strict';
// Comité (§6.8): cada COMITE_HORAS (alineado a 00, 04, 08… UTC) o a demanda.
//
// Orden del día fijo; cada punto es un mensaje en el canal `comite`:
//   1. Controller: patrimonio, P&L del día, caída, exposición.
//   2. Estratega macro: régimen y por qué. Voto: RISK-OFF → DEFENSIVO.
//   3. Jefa de riesgos: límites cerca de saltar y vetos del periodo. Voto:
//      nivel ≠ normal o caída ≤ −5 % → DEFENSIVO. Su DEFENSIVO es veto: no
//      puede salir NORMAL.
//   4. Mesas: mejor y peor por P&L del periodo.
//   5. Laboratorio: hipótesis en curso.
//   6. Megáfono: lo pendiente.
//   7. Presidenta: decisión.
//
// Datos frescos: el comité tarda (pausas de pantalla, la llamada al LLM) y
// mientras está reunido un humano puede reabrir, pausar, lanzar el kill o
// aplicar el Megáfono, y el latido sigue. Por eso cada punto se redacta con el
// estado del momento en que se publica (reunirDatos otra vez), y si cambió
// desde que empezó la reunión, el punto afectado lo dice (notaCambios). La
// decisión se toma con el estado del final: los votos se recalculan y, si ya
// se habían dicho otros, la decisión lo dice. La del LLM se pidió con los
// datos del principio: si los votos cambiaron, no se aplica (plan por defecto
// con los votos del final).
//
// La decisión es UNA llamada al LLM (uso 'comite') con esquema estricto:
// modo de una lista, multiplicadores de {0; 0,5; 1}, vetos de 24 h de activos
// del universo. Sin LLM, o si no valida: plan por defecto (mayoría de votos,
// en empate el más prudente; multiplicadores 1; vetos = eventos graves de
// noticias). Las intervenciones del LLM sustituyen a las plantillas de los
// puntos 1-6 solo si pasan verificarCifras() contra los datos DE SU PUNTO (un
// «80 %» que es un límite no vale como exposición del Controller), también los
// conteos pequeños ({ conteos: true }), y no dicen un voto, un modo o un
// régimen distinto del que calculó el código, ni por su nombre ni en llano
// («las compras nuevas a la mitad», «el mercado tiene miedo»:
// cifras.contradiceVocabulario). Solo Macro y Riesgos hablan de modo, y solo
// de su voto. La razón de la Presidenta no se publica si Riesgos vetó su modo
// o si contradice lo que se aplica (con el fondo sin comprar, no puede decir
// que se compra).
//
// Conversación (§6.2): la Presidenta abre la reunión (su mensaje abre el
// hilo) y da la palabra al Controller; cada jefe habla en su turno
// contestando al anterior y dándole las gracias por su nombre de pila, y la
// Presidenta cierra citando a quien vetó o votó distinto. Con LLM, el turno lo
// redacta el LLM con los nombres; sin él, las plantillas. Mismo control de
// cifras en los dos casos.

const plantillas = require('./plantillas');
const { verificarCifras, contradiceVocabulario } = require('./cifras');
const { directivasVigentes } = require('./megafono');
const { HORA } = require('../util/reloj');
const f = require('../util/formato');
const { pnlMesaTotal } = require('./departamentos/operaciones');
const { referenciasVigilancia } = require('./departamentos/riesgos');
const { etiqueta } = require('./departamentos/comun');
const mesasDep = require('./departamentos/mesas');
const { diaUTC } = require('../util/reloj');

const JEFES = Object.freeze(['cio', 'controller', 'macro', 'riesgos', 'laboratorio']);
// Cuánto se quedan los jefes en la sala de comité tras un comité o una reunión
// informativa, con el reloj de la mesa (estado.comite.salaHasta). En el modo
// latido la reunión cabe en un paso y el panel la reproduce en 2–3 min: con 5
// min no se veía (Eduardo, 30-sep-2026). Solo visual: no decide nada.
const SALA_TRAS_REUNION_MS = 15 * 60_000;
const MODOS = Object.freeze(['NORMAL', 'DEFENSIVO', 'SOLO_CERRAR']);
const PRUDENCIA = Object.freeze({ NORMAL: 0, DEFENSIVO: 1, SOLO_CERRAR: 2 });
const MULTIPLICADORES = Object.freeze([0, 0.5, 1]);
const PUNTOS = Object.freeze(['controller', 'macro', 'riesgos', 'mesas', 'laboratorio', 'megafono']);
// Quién habla en cada punto: los puntos de mesas y del Megáfono los lleva la Presidenta.
const PORTAVOZ = Object.freeze({ controller: 'controller', macro: 'macro', riesgos: 'riesgos', mesas: 'cio', laboratorio: 'laboratorio', megafono: 'cio' });
const CAIDA_DEFENSIVA = -0.05;
const CERCA = 0.8;           // un límite «cerca de saltar» es el 80 % de su tope
const VETO_HORAS = 24;

const esperarReal = ms => (ms > 0 ? new Promise(r => setTimeout(r, ms)) : Promise.resolve());

// ¿El texto de un punto dice un voto, un modo o un régimen distinto del
// calculado? Macro y Riesgos solo pueden decir su voto (por su nombre o en
// llano); los demás puntos no hablan de modo, que no está en sus datos. El
// régimen, en cualquier punto, solo el de Macro.
function contradice(punto, texto, datos) {
  const voto = (punto === 'macro' || punto === 'riesgos') ? datos.votos[punto] : null;
  return contradiceVocabulario(texto, { modos: voto ? [voto] : [], regimen: datos.macro.regimen });
}

// ¿La razón de la Presidenta dice otro modo, otro régimen, o algo de las
// compras que no es lo que pasa? Puede nombrar el modo que se aplica; lo que
// diga de las compras tiene que ser `efectivas` (plantillas.comprasEfectivas
// con la decisión ya aplicada: nada si el fondo no compra, el factor real).
function razonContradice(texto, decision, datos, efectivas = decision.modo) {
  return contradiceVocabulario(texto, { modos: [decision.modo], compras: efectivas ? [efectivas] : [], regimen: datos.macro.regimen });
}

// Entrada con la que se comprueban las cifras de una intervención: solo los
// datos de su punto (y los límites, que son el tema de Riesgos).
function entradaDelPunto(entrada, punto) {
  return { hora: entrada.hora, [punto]: entrada[punto], ...(punto === 'riesgos' ? { limites: entrada.limites } : {}) };
}

function cercanos(ctx, patrimonio, pnlDiaPct, caida) {
  const lim = ctx.limites;
  const val = ctx.vivo.valoracion || { exposicionBruta: 0, exposicionCripto: 0, exposicionPorActivo: {}, posicionesAbiertas: 0 };
  const out = [];
  const mirar = (nombre, uso, tope, texto) => { if (tope > 0 && uso >= CERCA * tope) out.push(texto); };
  // En llano: qué es, cuánto va y dónde está la raya.
  if (patrimonio > 0) {
    mirar('bruta', val.exposicionBruta / patrimonio, lim.maxExposicionBruta, `lo invertido, ${f.pct(val.exposicionBruta / patrimonio, { decimales: 0 })} de un máximo de ${f.pct(lim.maxExposicionBruta, { decimales: 0 })}`);
    mirar('cripto', val.exposicionCripto / patrimonio, lim.maxExposicionCripto, `lo invertido en cripto, ${f.pct(val.exposicionCripto / patrimonio, { decimales: 0 })} de un máximo de ${f.pct(lim.maxExposicionCripto, { decimales: 0 })}`);
    for (const [s, v] of Object.entries(val.exposicionPorActivo || {})) {
      mirar('activo', v / patrimonio, lim.maxPesoPorActivo, `${etiqueta(s)}, que pesa ${f.pct(v / patrimonio, { decimales: 1 })} (máximo ${f.pct(lim.maxPesoPorActivo, { decimales: 0 })})`);
    }
  }
  if (pnlDiaPct !== null && pnlDiaPct < 0) mirar('dia', -pnlDiaPct, lim.perdidaDiariaSoloCerrar, `la pérdida de hoy, ${f.pct(pnlDiaPct)} (en ${f.pct(-lim.perdidaDiariaSoloCerrar)} se deja de comprar)`);
  if (caida !== null && caida < 0) mirar('caida', -caida, lim.caidaKill, `la caída desde el máximo, ${f.pct(caida)} (en ${f.pct(-lim.caidaKill, { decimales: 0 })} salta el freno de emergencia)`);
  mirar('posiciones', val.posicionesAbiertas || 0, lim.maxPosiciones, `${val.posicionesAbiertas} posiciones abiertas de un máximo de ${lim.maxPosiciones}`);
  return out;
}

// Datos de los seis primeros puntos, calculados por el código.
function reunirDatos(ctx) {
  const e = ctx.estado;
  const v = ctx.vivo;
  const ahora = ctx.reloj.ahora();
  const patrimonio = v.patrimonio;
  const pnlDia = patrimonio - e.patrimonioInicioDia;
  const pnlDiaPct = e.patrimonioInicioDia > 0 ? pnlDia / e.patrimonioInicioDia : null;
  const caida = e.pico > 0 ? Math.min(0, patrimonio / e.pico - 1) : 0;
  // «Cerca de saltar» se mide con lo que mide el vigilante (tras una
  // reapertura, desde la reapertura); el Controller cuenta el resultado real.
  const ref = referenciasVigilancia(e, ahora);
  const pnlDiaLimite = ref.diaInicio === diaUTC(ahora) && ref.patrimonioInicioDia > 0 ? patrimonio / ref.patrimonioInicioDia - 1 : null;
  const caidaLimite = ref.pico > 0 ? Math.min(0, patrimonio / Math.max(ref.pico, patrimonio) - 1) : 0;
  const val = v.valoracion || { exposicionBruta: 0, exposicionCripto: 0, posicionesAbiertas: 0 };
  const controller = {
    patrimonio, pnlDia, pnlDiaPct, caida,
    exposicionBrutaPct: patrimonio > 0 ? val.exposicionBruta / patrimonio : null,
    exposicionCriptoPct: patrimonio > 0 ? val.exposicionCripto / patrimonio : null,
    posiciones: val.posicionesAbiertas,
  };
  const reg = e.macro.regimen || { valor: 'NEUTRAL', puntos: 0, detalle: 'sin datos' };
  const votoMacro = reg.valor === 'RISK-OFF' ? 'DEFENSIVO' : 'NORMAL';
  const macro = { regimen: reg.valor, puntos: reg.puntos, detalle: reg.detalle, fg: e.macro.fg ? e.macro.fg.valor : null, voto: votoMacro };
  const votoRiesgos = e.fondo.nivel !== 'normal' || caida <= CAIDA_DEFENSIVA ? 'DEFENSIVO' : 'NORMAL';
  const riesgos = { nivel: e.fondo.nivel, vetos: e.contadores.vetosDesdeComite || 0, cercanos: cercanos(ctx, patrimonio, pnlDiaLimite, caidaLimite), caida, voto: votoRiesgos };
  const previos = (e.comite && e.comite.pnlMesas) || {};
  const porMesa = e.mesas.filter(m => m.estado !== 'banquillo').map(m => {
    const total = pnlMesaTotal(ctx, m.id);
    return { id: m.id, nombre: m.nombre, estado: m.estado, peso: m.peso, pnl: total - (previos[m.id] ?? 0), pnlTotal: total };
  });
  const conMovimiento = porMesa.filter(m => Math.abs(m.pnl) >= 0.005).sort((a, b) => b.pnl - a.pnl);
  const mesas = {
    mejor: conMovimiento.length ? { nombre: conMovimiento[0].nombre, pnl: conMovimiento[0].pnl } : null,
    peor: conMovimiento.length > 1 ? { nombre: conMovimiento[conMovimiento.length - 1].nombre, pnl: conMovimiento[conMovimiento.length - 1].pnl } : null,
    lista: porMesa,
  };
  const lab = e.laboratorio;
  const laboratorio = {
    enCurso: lab.hipotesis.filter(h => h.estado === 'pendiente' || h.estado === 'evaluando').length,
    aprobadas: lab.aprobadas.length,
    ensayos: lab.ensayosTotales,
  };
  const vig = directivasVigentes(e.directivas, ahora);
  const deMegafono = [...(vig.activosVetados || []), ...(vig.mesasPausadas || [])].filter(x => x.origen === 'megafono').length
    + (vig.reduccion && vig.reduccion.origen === 'megafono' ? 1 : 0) + (vig.soloCerrarHasta ? 1 : 0);
  const megafono = { vigentes: deMegafono, pendientes: e.megafonoPendiente ? 1 : 0 };
  const graves = (e.noticias.eventosGraves || []).filter(x => x.hasta > ahora).map(x => x.simbolo);
  return { hora: f.hora(ahora), controller, macro, riesgos, mesas, laboratorio, megafono, votos: { macro: votoMacro, riesgos: votoRiesgos }, eventosGraves: [...new Set(graves)] };
}

const NIVEL_TEXTO = Object.freeze({ normal: 'normal', solo_cerrar: 'solo cerrar', pausado: 'en pausa', bloqueado: 'bloqueado' });
const ACCION_HUMANA = Object.freeze({
  reabrir: 'ha reabierto el fondo', pausar: 'ha pausado el fondo', kill: 'ha lanzado el kill switch', megafono: 'ha aplicado el Megáfono',
});
const NOMBRE_VOTO = Object.freeze({ macro: 'Macro', riesgos: 'Riesgos' });

// Nombre de pila de un agente ('' si no está en la plantilla).
function nombreDe(ctx, id) {
  const a = typeof ctx.agentePorId === 'function' ? ctx.agentePorId(id) : null;
  return a ? plantillas.pila(a.nombre) : '';
}

const conHumano = (humanas, tipos) => {
  const hechas = [...new Set(humanas.map(a => a.tipo).filter(t => tipos.includes(t)))];
  if (!hechas.length) return '';
  const partes = hechas.map(t => ACCION_HUMANA[t]);
  return `un humano ${partes.length > 1 ? `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}` : partes[0]}`;
};

// Lo que cambió en un punto desde que se abrió la reunión (datos `antes`) hasta
// que se publica (`ahora`), dicho por quien lo presenta; null si nada.
// `humanas`: lo que se pulsó en el panel mientras tanto ({ tipo }).
function notaCambios(punto, antes, ahora, humanas = []) {
  if (punto === 'controller') {
    const kill = humanas.some(a => a.tipo === 'kill') || (antes.riesgos.nivel !== 'bloqueado' && ahora.riesgos.nivel === 'bloqueado');
    return kill ? 'Durante el comité se ha lanzado el kill switch.' : null;
  }
  if (punto === 'macro') {
    return antes.macro.regimen !== ahora.macro.regimen ? `Al abrir el comité el régimen era ${antes.macro.regimen}.` : null;
  }
  if (punto === 'riesgos') {
    const quien = conHumano(humanas, ['reabrir', 'pausar', 'kill']);
    if (antes.riesgos.nivel !== ahora.riesgos.nivel) {
      return `Durante el comité el fondo ha pasado de ${NIVEL_TEXTO[antes.riesgos.nivel] || antes.riesgos.nivel} a ${NIVEL_TEXTO[ahora.riesgos.nivel] || ahora.riesgos.nivel}${quien ? `: ${quien}` : ''}.`;
    }
    if (antes.votos.riesgos !== ahora.votos.riesgos) return `Al abrir el comité mi voto era ${antes.votos.riesgos}.`;
    return quien ? `Durante el comité ${quien}.` : null;
  }
  if (punto === 'megafono') {
    const quien = conHumano(humanas, ['megafono']);
    if (quien) return `Durante el comité ${quien}.`;
    if (antes.megafono.vigentes !== ahora.megafono.vigentes) return `Al abrir el comité había ${antes.megafono.vigentes} vigente${antes.megafono.vigentes === 1 ? '' : 's'}.`;
    return null;
  }
  return null;
}

// Nombre de pila de quien habla en cada punto (y de la Presidenta), para
// que el LLM redacte la conversación. Solo nombres: no traen cifras.
function participantes(ctx) {
  const pila = id => {
    const a = typeof ctx.agentePorId === 'function' ? ctx.agentePorId(id) : null;
    return a ? plantillas.pila(a.nombre) : null;
  };
  const out = { presidenta: pila('cio') };
  for (const punto of PUNTOS) out[punto] = pila(PORTAVOZ[punto]);
  return out;
}

// Entrada del LLM (y con la que se comprueban sus cifras) para unos datos.
function entradaDe(ctx, datos, plan) {
  return {
    participantes: participantes(ctx),
    hora: datos.hora, controller: datos.controller, macro: datos.macro, riesgos: datos.riesgos,
    mesas: { mejor: datos.mesas.mejor, peor: datos.mesas.peor, lista: datos.mesas.lista.map(m => ({ id: m.id, nombre: m.nombre, estado: m.estado, peso: m.peso, pnl: m.pnl })) },
    laboratorio: datos.laboratorio, megafono: datos.megafono, votos: datos.votos, eventosGraves: datos.eventosGraves,
    planPorDefecto: { modo: plan.modo, multiplicadores: plan.multiplicadores, vetos: plan.vetos }, vetoHoras: VETO_HORAS,
    limites: { maxExposicionBruta: ctx.limites.maxExposicionBruta, maxExposicionCripto: ctx.limites.maxExposicionCripto, perdidaDiariaSoloCerrar: ctx.limites.perdidaDiariaSoloCerrar, caidaKill: ctx.limites.caidaKill },
  };
}

// Mayoría de votos; en empate, el más prudente. El DEFENSIVO de Riesgos es veto.
function planPorDefecto(datos, mesasActivas) {
  const votos = Object.values(datos.votos);
  const cuenta = {};
  for (const v of votos) cuenta[v] = (cuenta[v] || 0) + 1;
  const max = Math.max(...Object.values(cuenta));
  let modo = Object.keys(cuenta).filter(k => cuenta[k] === max).sort((a, b) => PRUDENCIA[b] - PRUDENCIA[a])[0] || 'NORMAL';
  if (datos.votos.riesgos !== 'NORMAL' && PRUDENCIA[modo] < PRUDENCIA[datos.votos.riesgos]) modo = datos.votos.riesgos;
  return {
    modo,
    multiplicadores: Object.fromEntries(mesasActivas.map(m => [m.id, 1])),
    vetos: [...datos.eventosGraves],
    razon: null,
  };
}

function esquemaDecision(mesasActivas, simbolos) {
  const props = {};
  for (const m of mesasActivas) props[m.id] = { type: 'number', enum: [...MULTIPLICADORES] };
  return {
    type: 'object',
    properties: {
      modo: { type: 'string', enum: [...MODOS] },
      multiplicadores: { type: 'object', properties: props, required: mesasActivas.map(m => m.id), additionalProperties: false },
      vetos: { type: 'array', items: { type: 'string', enum: simbolos } },
      razon: { type: 'string' },
      intervenciones: {
        type: 'array',
        items: {
          type: 'object',
          properties: { agente: { type: 'string', enum: [...PUNTOS] }, texto: { type: 'string' } },
          required: ['agente', 'texto'],
          additionalProperties: false,
        },
      },
    },
    required: ['modo', 'multiplicadores', 'vetos', 'razon', 'intervenciones'],
    additionalProperties: false,
  };
}

const SISTEMA = 'Eres la Presidenta del comité de una mesa de trading en papel. Decides entre opciones cerradas con los datos que te da el código. '
  + 'Nunca cambias límites duros ni inventas cifras: cualquier número que escribas tiene que estar en los datos. '
  + 'Todo lo que escribes lo lee alguien que no sabe de bolsa: español de España, tono llano y cercano, frases cortas, sin jerga ni siglas sin explicar.';

const INSTRUCCIONES = [
  'Decide el modo del fondo para las próximas horas: NORMAL, DEFENSIVO (las mesas operan con la mitad de capital) o SOLO_CERRAR.',
  'Reglas que el código aplica igualmente: si Riesgos vota DEFENSIVO, no puede salir NORMAL. Los multiplicadores por mesa solo pueden ser 0, 0,5 o 1.',
  'Vetos: activos del universo en los que no se abrirá durante 24 h (solo si hay motivo en los datos).',
  '«planPorDefecto» es lo que haría el código sin ti: apártate de él solo con un motivo que esté en los datos.',
  'razon: una o dos frases llanas con cifras copiadas de los datos.',
  'intervenciones: una o dos frases por punto del orden del día (controller, macro, riesgos, mesas, laboratorio, megafono), con cifras de los datos.',
  'Cada intervención la dice, en primera persona, quien presenta ese punto («participantes» da su nombre de pila; los puntos mesas y megafono los presentas tú).',
  'Es una conversación: cada uno se dirige a quien habló antes por su nombre de pila cuando venga a cuento («Gracias, Inés. Por mi parte…»). El primero contesta a la Presidenta.',
  'Del modo solo hablan Macro y Riesgos, y solo de su voto (el de «votos»; el código lo repite al final de su turno). Nadie más habla del modo ni de cómo se compra, ni por su nombre ni en llano («a la mitad», «tamaño normal», «no se abre nada»), salvo tú en la razón y solo con el modo que decides.',
  'Del mercado, solo el régimen de los datos, también en llano («acompaña» es RISK-ON; «ni a favor ni en contra», NEUTRAL; «tiene miedo», RISK-OFF). Si riesgos.nivel no es «normal», el fondo no compra nada, decidas lo que decidas.',
  'Un texto que diga otro modo, otro voto u otro régimen, aunque sea en llano, o una cifra que no esté en los datos de su punto (también «cuatro operaciones»), se descarta y sale la plantilla.',
].join('\n');

function normalizarDecision(datosLLM, mesasActivas, simbolos, votos) {
  const multiplicadores = {};
  for (const m of mesasActivas) {
    const v = datosLLM.multiplicadores ? datosLLM.multiplicadores[m.id] : undefined;
    multiplicadores[m.id] = MULTIPLICADORES.includes(v) ? v : 1;
  }
  let modo = MODOS.includes(datosLLM.modo) ? datosLLM.modo : 'NORMAL';
  let vetoRiesgos = false;
  if (votos.riesgos !== 'NORMAL' && PRUDENCIA[modo] < PRUDENCIA[votos.riesgos]) { modo = votos.riesgos; vetoRiesgos = true; }
  const vetos = [...new Set((datosLLM.vetos || []).filter(s => simbolos.includes(s)))];
  return { modo, multiplicadores, vetos, vetoRiesgos };
}

// `anterior`: el nombre de quien habló antes (el turno empieza dándole las gracias).
function textoPlantilla(punto, datos, anterior = null) {
  return plantillas.informeComite(punto, { ...(datos[punto] || {}), anterior });
}

function aplicarDecision(ctx, decision, ahora) {
  const d = ctx.estado.directivas;
  d.modo = decision.modo;
  d.multiplicadores = { ...decision.multiplicadores };
  const hasta = ahora + VETO_HORAS * HORA;
  for (const s of decision.vetos) {
    d.activosVetados = (d.activosVetados || []).filter(x => !(x.simbolo === s && x.origen === 'comite'));
    d.activosVetados.push({ simbolo: s, hasta, motivo: 'comité', origen: 'comite' });
  }
}

async function celebrar(ctx, { motivo = 'programado' } = {}) {
  if (ctx.comiteEnCurso) return { ok: false, mensaje: 'Ya hay un comité reunido.' };
  ctx.comiteEnCurso = true;
  const e = ctx.estado;
  const t0 = ctx.reloj.ahora();
  // Pausa real entre puntos para verlo en el panel, pero acotada: el comité
  // entero (8 mensajes) no puede ocupar más de la mitad del intervalo entre
  // comités en tiempo de pantalla (a ×3000, 4 h simuladas son 4,8 s).
  const intervaloPantalla = (ctx.config.cadencias.comiteHoras * HORA) / (ctx.modo === 'sintetico' ? Math.max(1, ctx.velocidad) : 1);
  const pausaMs = Math.min(ctx.opciones.pausaComiteMs || 0, intervaloPantalla / 2 / 8);
  // detener() corta las pausas en curso (pausaPantalla): un Ctrl+C durante el
  // comité no espera a que acabe el orden del día en la pantalla.
  const pausa = () => (typeof ctx.pausaPantalla === 'function' ? ctx.pausaPantalla(pausaMs) : esperarReal(pausaMs));
  try {
    for (const id of JEFES) ctx.moverAgente(id, 'comite', 'reunion');
    // La apertura abre el hilo de la reunión y le da la palabra al Controller.
    const apertura = ctx.bus.publicar({
      de: 'cio', para: PORTAVOZ.controller, canal: 'comite', tipo: 'comite',
      texto: plantillas.aperturaComite({ hora: f.hora(t0), motivo, primero: nombreDe(ctx, PORTAVOZ.controller) }),
      datos: { motivo }, importancia: 3, hilo: true,
    });
    let anterior = apertura;
    // Lo que se pulse en el panel desde ahora (Reabrir, Pausar, kill, Megáfono).
    const seq0 = ctx.seqHumana || 0;
    const humanas = () => (ctx.accionesHumanas || []).filter(a => a.seq > seq0);
    const inicio = reunirDatos(ctx);
    const mesasActivas = e.mesas.filter(m => m.estado !== 'banquillo');
    const simbolos = ctx.universo.map(a => a.simbolo);
    let costeUsd = 0;
    let motivoDefecto = null;
    let respuestaLLM = null;          // lo que devolvió el LLM, pedido con los datos de `inicio`
    const intervenciones = {};        // sin comprobar: cada una se comprueba al publicar su punto

    if (ctx.llm && ctx.llm.activo) {
      const entrada = entradaDe(ctx, inicio, planPorDefecto(inicio, mesasActivas));
      const r = await ctx.llm.pedirJSON({
        uso: 'comite', proposito: 'comite', sistema: SISTEMA, instrucciones: INSTRUCCIONES, entrada,
        esquema: esquemaDecision(mesasActivas, simbolos), maxTokens: 4000, esfuerzo: 'medium',
      });
      costeUsd = r.costeUsd || 0;
      if (r.ok) {
        respuestaLLM = r.datos;
        for (const it of r.datos.intervenciones || []) {
          const texto = String(it.texto || '').trim();
          if (texto && PUNTOS.includes(it.agente) && !intervenciones[it.agente]) intervenciones[it.agente] = texto;
        }
      } else {
        motivoDefecto = r.motivo;
      }
    }

    const votosDichos = {};
    let nivelDicho = null;
    for (const punto of PUNTOS) {
      await pausa();
      // El estado del momento en que se publica el punto, no el del principio.
      const datos = reunirDatos(ctx);
      const entradaPunto = entradaDelPunto(entradaDe(ctx, datos, planPorDefecto(datos, mesasActivas)), punto);
      const propuesta = intervenciones[punto];
      const vale = propuesta && !contradice(punto, propuesta, datos) && verificarCifras(propuesta, entradaPunto, { conteos: true }).ok;
      // Cada uno contesta a quien habló antes (salvo que hable él mismo otra vez).
      const deAntes = anterior.de !== PORTAVOZ[punto] ? anterior.de : null;
      let texto = vale ? plantillas.frase(propuesta, 200) : textoPlantilla(punto, datos, deAntes ? nombreDe(ctx, deAntes) : null);
      const esVoto = punto === 'macro' || punto === 'riesgos';
      // El voto del código se dice siempre, salvo que el texto ya lo diga con ese valor.
      if (esVoto && vale && !new RegExp(`\\bvoto:? ${datos.votos[punto]}\\b`, 'i').test(texto)) texto = plantillas.frase(`${texto} Mi voto: ${datos.votos[punto]}.`, 220);
      const cambio = notaCambios(punto, inicio, datos, humanas());
      if (cambio) texto = plantillas.frase(`${texto} ${cambio}`, 240);
      if (esVoto) votosDichos[punto] = datos.votos[punto];
      if (punto === 'riesgos') nivelDicho = datos.riesgos.nivel;
      anterior = ctx.bus.publicar({
        de: PORTAVOZ[punto], para: deAntes || 'todos', canal: 'comite', tipo: esVoto ? 'voto' : 'informe', texto,
        datos: {
          punto, fuente: vale ? 'llm' : 'plantilla', ...(esVoto ? { voto: datos.votos[punto] } : {}), ...(punto === 'riesgos' ? { cercanos: datos.riesgos.cercanos } : {}),
          ...(cambio ? { cambio } : {}),
        },
        importancia: 2, respondeA: anterior.id, hilo: apertura.id,
      });
    }
    await pausa();
    // La decisión, con el estado del final de la reunión.
    const final = reunirDatos(ctx);
    const activasFinal = e.mesas.filter(m => m.estado !== 'banquillo');
    const plan = planPorDefecto(final, activasFinal);
    let decision = { ...plan, vetoRiesgos: false };
    let fuente = 'defecto';
    let razonLLM = null;              // se comprueba con la decisión ya aplicada
    const cambiados = Object.keys(final.votos).filter(k => final.votos[k] !== inicio.votos[k]);
    if (respuestaLLM && cambiados.length) {
      motivoDefecto = `los votos cambiaron durante el comité (${cambiados.map(k => `${NOMBRE_VOTO[k] || k} ${inicio.votos[k]} → ${final.votos[k]}`).join(', ')}): la decisión del LLM se tomó con los de antes`;
    } else if (respuestaLLM) {
      decision = normalizarDecision(respuestaLLM, mesasActivas, simbolos, final.votos);
      fuente = 'llm';
      razonLLM = String(respuestaLLM.razon || '').trim();
    }
    const ahora = ctx.reloj.ahora();
    const modoAnterior = e.directivas.modo || 'NORMAL';
    aplicarDecision(ctx, decision, ahora);
    // Lo que se dice de las compras es lo que el fondo hace de verdad ya con la
    // decisión aplicada: nada si no está en nivel normal, y el factor real.
    const vigentes = directivasVigentes(e.directivas, ahora);
    const compras = {
      modo: decision.modo, nivel: e.fondo.nivel, factor: mesasDep.factorTamano(ctx, ahora),
      soloCerrarHasta: Number.isFinite(vigentes.soloCerrarHasta) ? f.hora(vigentes.soloCerrarHasta) : null,
    };
    let razon = null;
    // Con el veto de Riesgos el modo aplicado no es el que razonó el LLM.
    const razonCuadra = razonLLM && !decision.vetoRiesgos && !razonContradice(razonLLM, decision, final, plantillas.comprasEfectivas(compras));
    if (razonCuadra && verificarCifras(razonLLM, entradaDe(ctx, final, plan), { conteos: true }).ok) razon = plantillas.frase(razonLLM, 200);
    // La Presidenta cita a quien vetó o votó distinto, por su nombre, y los
    // votos que se recontaron. Van detrás del modo y antes que las mesas: si
    // no cabe todo, se recorta la lista de mesas, nunca una cita.
    const citas = [];
    const quienVota = k => nombreDe(ctx, k) || NOMBRE_VOTO[k] || k;
    const vm = final.votos.macro;
    const vr = final.votos.riesgos;
    if (decision.vetoRiesgos || (vr !== 'NORMAL' && decision.modo === vr && vm !== vr)) {
      citas.push(`${quienVota('riesgos')} ha votado ${vr} y su voto es veto: no puede salir NORMAL.`);
    } else if (vm !== vr) {
      citas.push(`${quienVota('macro')} ha votado ${vm} y ${quienVota('riesgos')}, ${vr}.`);
    }
    // Un voto dicho en su punto que ya no es el del final: se recalculó.
    const recalculados = Object.keys(votosDichos).filter(k => votosDichos[k] !== final.votos[k]);
    if (recalculados.length) {
      const porque = k => (k === 'riesgos' && nivelDicho !== final.riesgos.nivel ? `; el fondo está ahora ${NIVEL_TEXTO[final.riesgos.nivel] || final.riesgos.nivel}` : '');
      citas.push(`Al cerrar he vuelto a contar los votos: ${recalculados.map(k => `${quienVota(k)} vota ahora ${final.votos[k]} (antes dijo ${votosDichos[k]}${porque(k)})`).join(', ')}.`);
    }
    let texto = plantillas.decisionComite({ ...decision, fuente, ...compras }, e.mesas, { citas, max: 300 });
    if (razon) texto = plantillas.frase(`${texto} ${razon}`, 300);
    ctx.bus.publicar({
      de: 'cio', para: 'todos', respondeA: anterior.id, hilo: apertura.id, canal: 'comite', tipo: 'decision', texto,
      datos: {
        modo: decision.modo, multiplicadores: decision.multiplicadores, vetos: decision.vetos, fuente, votos: final.votos, motivoPlanPorDefecto: motivoDefecto,
        ...(recalculados.length ? { votosDichos } : {}),
      },
      importancia: 3, costeUsd,
    });
    // Registro de decisiones (y punto del historial si cambia el modo).
    if (typeof ctx.anotarDecision === 'function') {
      ctx.anotarDecision({
        tipo: 'comite', quien: 'cio', resumen: texto,
        datos: {
          motivo, modo: decision.modo, modoAnterior, multiplicadores: decision.multiplicadores, vetos: decision.vetos, fuente,
          votos: final.votos, vetoRiesgos: Boolean(decision.vetoRiesgos), motivoPlanPorDefecto: motivoDefecto, costeUsd,
          ...(recalculados.length ? { votosDichos } : {}),
        },
      });
    }
    if (modoAnterior !== decision.modo && typeof ctx.anotarHistorial === 'function') ctx.anotarHistorial('comite');
    const c = e.comite;
    c.celebrados = (c.celebrados || 0) + 1;
    c.ultimo = { t: ahora, modo: decision.modo, multiplicadores: decision.multiplicadores, vetos: decision.vetos, fuente };
    c.historial = [...(c.historial || []), ahora].slice(-50);
    c.pnlMesas = Object.fromEntries(e.mesas.map(m => [m.id, pnlMesaTotal(ctx, m.id)]));
    e.contadores.vetosDesdeComite = 0;
    return { ok: true, mensaje: `Comité celebrado: modo ${decision.modo}.`, datos: { ...c.ultimo } };
  } finally {
    const bloqueado = e.fondo.nivel === 'bloqueado';
    for (const id of JEFES) ctx.moverAgente(id, null, bloqueado ? 'de_pie' : 'trabajando');
    // Modo latido: la reunión cabe en un paso y no hay pausas de pantalla; los
    // jefes se ven en la sala hasta este instante (solo visual: la instantánea).
    const sala = ctx.opciones && ctx.opciones.salaTrasComiteMs;
    if (sala > 0) e.comite.salaHasta = ctx.reloj.ahora() + sala;
    ctx.comiteEnCurso = false;
  }
}

module.exports = { celebrar, reunirDatos, planPorDefecto, esquemaDecision, normalizarDecision, aplicarDecision, contradice, razonContradice, entradaDelPunto, entradaDe, notaCambios, JEFES, PUNTOS, MODOS, SALA_TRAS_REUNION_MS };
