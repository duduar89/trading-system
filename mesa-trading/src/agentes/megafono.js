'use strict';
// Megáfono (§6.5): una frase libre del humano se convierte en directivas de
// una lista CERRADA que solo aprietan y caducan. Nunca aplica nada: devuelve
// la propuesta y el humano confirma con «Aplicar».
//
// Estado de directivas (el mismo resumen de §7 que entiende evaluarPropuesta):
//   { modo, multiplicadores, activosVetados: [{ simbolo, hasta, motivo, origen }],
//     mesasPausadas: [{ mesaId, hasta, origen }], soloCerrarHasta, reduccion: { factor, hasta, origen } | null }
// `origen: 'megafono'` marca lo que el Megáfono puede deshacer con «reanuda»;
// los vetos del comité o de noticias no se tocan desde aquí.

const { HORA } = require('../util/reloj');
const { verificarCifras } = require('./cifras');
const plantillas = require('./plantillas');

const TIPOS = Object.freeze(['reducir_riesgo', 'pausar_activo', 'pausar_mesa', 'solo_cerrar', 'reanudar_activo', 'reanudar_mesa', 'sin_efecto']);
const FACTORES = Object.freeze([0.25, 0.5, 0.75]);
const HORAS_MIN = 1;
const HORAS_MAX = 72;
// Sin duración explícita, hasta el siguiente comité (cada 4 h): lo que el
// Megáfono aprieta caduca solo.
const HORAS_POR_DEFECTO = 4;
const ORIGEN = 'megafono';
// Cifras de las reglas del Megáfono: un motivo de sin_efecto puede citarlas.
const LIMITES = Object.freeze([HORAS_MIN, HORAS_MAX, HORAS_POR_DEFECTO, ...FACTORES]);
// Motivo de sin_efecto cuando el del LLM trae una cifra que no está ni en la
// orden ni en las reglas (§0.2): no se enseña.
const MOTIVO_FIJO = 'La orden no encaja en la lista cerrada o pide más riesgo.';
const MAX_MOTIVO = 140;

const quitarTildes = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const etiquetaDe = a => (a && typeof a === 'object' ? a.etiqueta || String(a.simbolo || '').split('/')[0] : String(a || '').split('/')[0]);
const simboloDe = a => (a && typeof a === 'object' ? a.simbolo : String(a || ''));

function resolverActivo(valor, universo = []) {
  if (!valor) return null;
  const v = String(valor).trim().toUpperCase();
  for (const a of universo) {
    const s = simboloDe(a);
    if (s.toUpperCase() === v || etiquetaDe(a).toUpperCase() === v) return s;
  }
  return null;
}

function resolverMesa(valor, mesas = []) {
  if (!valor) return null;
  const v = quitarTildes(valor).trim();
  for (const m of mesas) {
    if (quitarTildes(m.id) === v || (m.nombre && quitarTildes(m.nombre) === v)) return m.id;
  }
  return null;
}

function horasValidas(h) {
  return Number.isInteger(h) && h >= HORAS_MIN && h <= HORAS_MAX;
}

// Duración por defecto pedida por quien llama (p. ej. el intervalo del
// comité); si no vale, la del contrato.
const horasPorDefectoDe = h => (horasValidas(h) ? h : HORAS_POR_DEFECTO);

const nombreMesa = (id, mesas = []) => {
  const m = (mesas || []).find(x => x && x.id === id);
  return (m && m.nombre) || id;
};

const vigente = (hasta, ahora) => hasta === null || hasta === undefined || hasta > ahora;

// ¿Hay un apretón del Megáfono vigente que deshacer?
function hayPausaMegafono(directivas, campo, clave, valor, ahora) {
  const lista = (directivas && directivas[campo]) || [];
  return lista.some(x => x && x[clave] === valor && x.origen === ORIGEN && (ahora === undefined || vigente(x.hasta, ahora)));
}

// Devuelve { ok, error, directiva } con la directiva normalizada (solo los
// campos de su tipo, símbolo canónico, id de mesa).
// ctx = { universo, mesas, directivas?, ahora? }: con `directivas`, un
// «reanudar» solo vale si deshace una pausa previa del Megáfono.
function validarDirectiva(d, ctx = {}) {
  const mal = error => ({ ok: false, error, directiva: null });
  if (!d || typeof d !== 'object') return mal('La directiva no es un objeto.');
  if (!TIPOS.includes(d.tipo)) return mal(`Tipo fuera de la lista cerrada: ${d.tipo}.`);
  const universo = ctx.universo || [];
  const mesas = ctx.mesas || [];
  const horasOk = () => horasValidas(d.horas);
  const errHoras = `Las horas deben ser un entero entre ${HORAS_MIN} y ${HORAS_MAX}.`;

  switch (d.tipo) {
    case 'reducir_riesgo': {
      const factor = FACTORES.find(x => Math.abs(x - d.factor) < 1e-9);
      if (factor === undefined) return mal('El factor de reducción solo puede ser 0,25, 0,5 o 0,75.');
      if (!horasOk()) return mal(errHoras);
      return { ok: true, error: null, directiva: { tipo: d.tipo, factor, horas: d.horas } };
    }
    case 'pausar_activo': {
      const simbolo = resolverActivo(d.simbolo, universo);
      if (!simbolo) return mal(`Activo desconocido: ${d.simbolo}.`);
      if (!horasOk()) return mal(errHoras);
      return { ok: true, error: null, directiva: { tipo: d.tipo, simbolo, horas: d.horas } };
    }
    case 'pausar_mesa': {
      const mesaId = resolverMesa(d.mesaId, mesas);
      if (!mesaId) return mal(`Mesa desconocida: ${d.mesaId}.`);
      if (!horasOk()) return mal(errHoras);
      return { ok: true, error: null, directiva: { tipo: d.tipo, mesaId, horas: d.horas } };
    }
    case 'solo_cerrar': {
      if (!horasOk()) return mal(errHoras);
      return { ok: true, error: null, directiva: { tipo: d.tipo, horas: d.horas } };
    }
    case 'reanudar_activo': {
      const simbolo = resolverActivo(d.simbolo, universo);
      if (!simbolo) return mal(`Activo desconocido: ${d.simbolo}.`);
      if (ctx.directivas && !hayPausaMegafono(ctx.directivas, 'activosVetados', 'simbolo', simbolo, ctx.ahora)) {
        return mal(`No hay ninguna pausa del Megáfono sobre ${etiquetaDe(simbolo)} que deshacer.`);
      }
      return { ok: true, error: null, directiva: { tipo: d.tipo, simbolo } };
    }
    case 'reanudar_mesa': {
      const mesaId = resolverMesa(d.mesaId, mesas);
      if (!mesaId) return mal(`Mesa desconocida: ${d.mesaId}.`);
      if (ctx.directivas && !hayPausaMegafono(ctx.directivas, 'mesasPausadas', 'mesaId', mesaId, ctx.ahora)) {
        return mal(`No hay ninguna pausa del Megáfono sobre la mesa ${nombreMesa(mesaId, mesas)} que deshacer.`);
      }
      return { ok: true, error: null, directiva: { tipo: d.tipo, mesaId } };
    }
    default: // sin_efecto
      return { ok: true, error: null, directiva: { tipo: 'sin_efecto', motivo: String(d.motivo || 'Sin efecto.') } };
  }
}

function directivasVacias() {
  return { modo: 'NORMAL', multiplicadores: {}, activosVetados: [], mesasPausadas: [], soloCerrarHasta: null, reduccion: null };
}

function copiar(directivas) {
  const b = { ...directivasVacias(), ...(directivas || {}) };
  return {
    ...b,
    multiplicadores: { ...(b.multiplicadores || {}) },
    activosVetados: (b.activosVetados || []).map(x => ({ ...x })),
    mesasPausadas: (b.mesasPausadas || []).map(x => ({ ...x })),
    reduccion: b.reduccion ? { ...b.reduccion } : null,
  };
}

// Aplica UNA directiva ya validada. Pura: devuelve un estado nuevo. Solo
// aprieta: si ya hay algo más duro o más largo, se queda lo que había.
function aplicarDirectiva(directivas, d, ahora) {
  const out = copiar(directivas);
  if (!d || !TIPOS.includes(d.tipo)) return out;
  const hasta = Number.isFinite(d.horas) ? ahora + d.horas * HORA : null;
  switch (d.tipo) {
    case 'reducir_riesgo': {
      const r = out.reduccion && vigente(out.reduccion.hasta, ahora) ? out.reduccion : null;
      if (!r || d.factor < r.factor) out.reduccion = { factor: d.factor, hasta, origen: ORIGEN };
      else if (d.factor === r.factor && r.hasta !== null && hasta > r.hasta) out.reduccion = { ...r, hasta };
      break;
    }
    case 'pausar_activo': {
      const previo = out.activosVetados.find(x => x.simbolo === d.simbolo && x.origen === ORIGEN);
      if (previo) {
        if (previo.hasta !== null && hasta > previo.hasta) previo.hasta = hasta;
      } else {
        out.activosVetados.push({ simbolo: d.simbolo, hasta, motivo: 'Megáfono', origen: ORIGEN });
      }
      break;
    }
    case 'pausar_mesa': {
      const previo = out.mesasPausadas.find(x => x.mesaId === d.mesaId && x.origen === ORIGEN);
      if (previo) {
        if (previo.hasta !== null && hasta > previo.hasta) previo.hasta = hasta;
      } else {
        out.mesasPausadas.push({ mesaId: d.mesaId, hasta, origen: ORIGEN });
      }
      break;
    }
    case 'solo_cerrar': {
      const actual = out.soloCerrarHasta;
      if (actual === null || actual === undefined || actual <= ahora || hasta > actual) out.soloCerrarHasta = hasta;
      break;
    }
    case 'reanudar_activo':
      out.activosVetados = out.activosVetados.filter(x => !(x.simbolo === d.simbolo && x.origen === ORIGEN));
      break;
    case 'reanudar_mesa':
      out.mesasPausadas = out.mesasPausadas.filter(x => !(x.mesaId === d.mesaId && x.origen === ORIGEN));
      break;
    default: break;   // sin_efecto
  }
  return out;
}

// Lo que sigue en vigor a `ahora` (lo caducado desaparece).
function directivasVigentes(directivas, ahora) {
  const out = copiar(directivas);
  out.activosVetados = out.activosVetados.filter(x => vigente(x.hasta, ahora));
  out.mesasPausadas = out.mesasPausadas.filter(x => vigente(x.hasta, ahora));
  if (out.soloCerrarHasta !== null && out.soloCerrarHasta !== undefined && out.soloCerrarHasta <= ahora) out.soloCerrarHasta = null;
  if (out.reduccion && !vigente(out.reduccion.hasta, ahora)) out.reduccion = null;
  return out;
}

// ---------- Palabras clave (sin LLM) ----------

const NUMEROS_TEXTO = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, ocho: 8, doce: 12, veinticuatro: 24, cuarenta: 40 };

// Duración en horas escrita en el texto, o null.
function leerHoras(texto) {
  const s = quitarTildes(texto);
  const num = x => (/^\d+$/.test(x) ? Number(x) : NUMEROS_TEXTO[x]);
  let m = s.match(/(\d+|un|una|uno|dos|tres|cuatro|cinco|seis|ocho|doce|veinticuatro|cuarenta)\s*(h|hs|hr|hrs|horas?)\b/);
  if (m && num(m[1])) return num(m[1]);
  m = s.match(/(\d+|un|uno|dos|tres)\s*(d|dias?)\b/);
  if (m && num(m[1])) return num(m[1]) * 24;
  if (/\bmedia hora\b/.test(s)) return 1;
  if (/\bhasta manana\b/.test(s)) return 24;
  return null;
}

// Factor de reducción pedido, ajustado a la lista cerrada hacia lo más prudente
// (el valor permitido que no quede por encima de lo pedido).
function leerFactor(texto) {
  const s = quitarTildes(texto);
  let f = null;
  if (/tres cuartos/.test(s)) f = 0.75;
  else if (/\bun cuarto\b|\ba la cuarta\b/.test(s)) f = 0.25;
  else if (/\bmitad\b/.test(s)) f = 0.5;
  else {
    let m = s.match(/\bal\s+(\d+(?:[.,]\d+)?)\s*(%|por ciento)/);
    if (m) f = Number(m[1].replace(',', '.')) / 100;
    else {
      m = s.match(/(\d+(?:[.,]\d+)?)\s*(%|por ciento)/);
      if (m) f = 1 - Number(m[1].replace(',', '.')) / 100;   // «reduce un 25 %» = quita un 25 %
    }
  }
  if (f === null) return { factor: 0.5, pedido: null };
  if (!(f < 1)) return { factor: null, pedido: f };
  const permitido = [...FACTORES].reverse().find(x => x <= f + 1e-9) ?? FACTORES[0];
  return { factor: permitido, pedido: f };
}

// Busca activos y mesas nombrados en el texto. Coincidencia más larga primero,
// para que «momentum etf» no cuente también como «momentum».
function buscarObjetivos(texto, universo, mesas) {
  const s = ` ${quitarTildes(texto).replace(/[^a-z0-9ñ\s/-]/g, ' ')} `;
  const candidatos = [];
  for (const a of universo) {
    const e = quitarTildes(etiquetaDe(a));
    candidatos.push({ clave: e, tipo: 'activo', valor: simboloDe(a) });
    const nombre = a && a.nombre ? quitarTildes(a.nombre).split(/[\s(]/)[0] : '';
    if (nombre.length >= 3 && nombre !== e) candidatos.push({ clave: nombre, tipo: 'activo', valor: simboloDe(a) });
  }
  for (const m of mesas) {
    candidatos.push({ clave: quitarTildes(m.id).replace(/-/g, ' '), tipo: 'mesa', valor: m.id });
    candidatos.push({ clave: quitarTildes(m.id), tipo: 'mesa', valor: m.id });
    if (m.nombre) candidatos.push({ clave: quitarTildes(m.nombre), tipo: 'mesa', valor: m.id });
  }
  candidatos.sort((a, b) => b.clave.length - a.clave.length);
  const ocupado = new Array(s.length).fill(false);
  const hallados = [];
  for (const c of candidatos) {
    if (!c.clave) continue;
    const re = new RegExp(`(?<=[\\s/])${c.clave.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[\\s/])`, 'g');
    for (const m of s.matchAll(re)) {
      const i = m.index;
      if (ocupado.slice(i, i + c.clave.length).some(Boolean)) continue;
      for (let k = i; k < i + c.clave.length; k++) ocupado[k] = true;
      hallados.push({ i, ...c });
    }
  }
  // En el orden en que aparecen en la frase.
  hallados.sort((a, b) => a.i - b.i);
  const unicos = tipo => [...new Set(hallados.filter(h => h.tipo === tipo).map(h => h.valor))];
  return { activos: unicos('activo'), mesas: unicos('mesa') };
}

// Trocea «reduce el riesgo y pausa SOL» en cláusulas, una por verbo.
const VERBOS = '(?:reanud|vuelve a operar|quita la pausa|reactiva|solo cerr|solo cierr|no abr|nada nuevo|reduc|baj|recort|menos riesgo|paus|deten|no operes|no toques|evita|para\\b)';
function trocear(texto) {
  const s = quitarTildes(texto);
  return s.split(new RegExp(`[.;!?]|,\\s*(?=${VERBOS})|\\s+y\\s+(?=${VERBOS})`)).map(x => x.trim()).filter(Boolean);
}

function accionDe(clausula) {
  const s = ` ${clausula} `;
  if (/\breanud|\bvuelve a operar|\bquita(r)? la pausa|\breactiva/.test(s)) return 'reanudar';
  if (/\bsolo (cerrar|cierres|cierra)|\bno abr(as|ir|ais)\b|\bnada nuevo\b/.test(s)) return 'solo_cerrar';
  if (/\breduc|\bbaj(a|ar|ad|en)\b|\brecort|\bmenos riesgo/.test(s)) return 'reducir';
  if (/\bpaus|\bdeten|\bno operes|\bno toques|\bevita/.test(s)) return 'pausar';
  // «para» es también preposición: solo cuenta como verbo al empezar la orden.
  if (/^\s*(por favor\s+)?para\s/.test(s)) return 'pausar';
  return null;
}

function interpretarPalabrasClave(texto, { universo = [], mesas = [], horasPorDefecto = HORAS_POR_DEFECTO } = {}) {
  const horasTexto = leerHoras(texto);
  const directivas = [];
  const notas = [];
  const ajustarHoras = (h) => {
    const bruto = h ?? horasTexto ?? horasPorDefecto;
    const r = Math.min(HORAS_MAX, Math.max(HORAS_MIN, Math.round(bruto)));
    if (r !== bruto) notas.push(`duración ajustada a ${r} h (entre ${HORAS_MIN} y ${HORAS_MAX})`);
    return r;
  };
  for (const cl of trocear(texto)) {
    const accion = accionDe(cl);
    if (!accion) continue;
    const obj = buscarObjetivos(cl, universo, mesas);
    const horas = ajustarHoras(leerHoras(cl));
    if (accion === 'reanudar') {
      for (const s of obj.activos) directivas.push({ tipo: 'reanudar_activo', simbolo: s });
      for (const m of obj.mesas) directivas.push({ tipo: 'reanudar_mesa', mesaId: m });
      if (!obj.activos.length && !obj.mesas.length) notas.push('para reanudar hay que nombrar un activo o una mesa');
    } else if (accion === 'solo_cerrar') {
      directivas.push({ tipo: 'solo_cerrar', horas });
    } else if (accion === 'reducir') {
      const { factor, pedido } = leerFactor(cl);
      if (factor === null) notas.push('eso no reduce el riesgo: el Megáfono solo aprieta');
      else {
        directivas.push({ tipo: 'reducir_riesgo', factor, horas });
        if (pedido !== null && Math.abs(pedido - factor) > 1e-9) notas.push(`factor ajustado a ${String(factor).replace('.', ',')} (solo 0,25, 0,5 o 0,75)`);
        if (obj.activos.length) notas.push('la reducción vale para todo el fondo');
      }
    } else if (accion === 'pausar') {
      for (const s of obj.activos) directivas.push({ tipo: 'pausar_activo', simbolo: s, horas });
      for (const m of obj.mesas) directivas.push({ tipo: 'pausar_mesa', mesaId: m, horas });
      // «Para todo» / «pausa» sin objetivo: no abrir nada.
      if (!obj.activos.length && !obj.mesas.length) directivas.push({ tipo: 'solo_cerrar', horas });
    }
  }
  return { directivas, notas };
}

// ---------- Interpretación con LLM ----------

const SISTEMA = 'Eres el Megáfono de una mesa de trading en papel. Traduces la orden de un humano a directivas de una lista cerrada. '
  + 'Las directivas solo pueden apretar el riesgo (reducir, pausar, solo cerrar) o deshacer una pausa previa (reanudar). '
  + 'Nunca aumentan el riesgo. Si la orden pide otra cosa, devuelve una directiva sin_efecto con el motivo. '
  + 'Responde en español.';

function esquemaLLM(universo, mesas) {
  const etiquetas = universo.map(etiquetaDe);
  const ids = mesas.map(m => m.id);
  const opcional = (base) => ({ anyOf: [base, { type: 'null' }] });
  return {
    type: 'object',
    properties: {
      directivas: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            tipo: { type: 'string', enum: [...TIPOS] },
            factor: opcional({ type: 'number', enum: [...FACTORES] }),
            // El rango de horas lo comprueba validarDirectiva: así una directiva
            // fuera de rango se descarta sola y no tumba las demás.
            horas: opcional({ type: 'integer' }),
            simbolo: etiquetas.length ? opcional({ type: 'string', enum: etiquetas }) : { type: 'null' },
            mesaId: ids.length ? opcional({ type: 'string', enum: ids }) : { type: 'null' },
            motivo: opcional({ type: 'string' }),
          },
          required: ['tipo', 'factor', 'horas', 'simbolo', 'mesaId', 'motivo'],
          additionalProperties: false,
        },
      },
      explicacion: { type: 'string' },
    },
    required: ['directivas', 'explicacion'],
    additionalProperties: false,
  };
}

function instrucciones(horasPorDefecto = HORAS_POR_DEFECTO) {
  return [
    'Convierte «texto» en directivas. Tipos:',
    '- reducir_riesgo: factor 0.25, 0.5 o 0.75 (tamaño de las entradas nuevas) y horas.',
    '- pausar_activo: simbolo (etiqueta de «activos») y horas. pausar_mesa: mesaId (de «mesas») y horas.',
    '- solo_cerrar: horas (no se abre nada nuevo). reanudar_activo / reanudar_mesa: deshacen una pausa previa.',
    '- sin_efecto: motivo, si la orden no encaja o pide más riesgo.',
    `Horas: entero de ${HORAS_MIN} a ${HORAS_MAX}; si el texto no dice duración, ${horasPorDefecto}. Campos que no apliquen: null.`,
    'explicacion: una frase corta que diga lo que has entendido, sin cifras que no estén en el texto.',
  ].join('\n');
}
const INSTRUCCIONES = instrucciones();

// El motivo de un sin_efecto lo escribe el LLM: solo se enseña si sus cifras
// están en la orden o en las reglas, y recortado.
function motivoComprobado(motivo, texto, limites) {
  const m = String(motivo || '').trim();
  if (!m) return MOTIVO_FIJO;
  return verificarCifras(m, { texto: String(texto || ''), limites }).ok ? plantillas.frase(m, MAX_MOTIVO) : MOTIVO_FIJO;
}

function explicar(directivas, notas, mesas = []) {
  const partes = directivas.map(d => {
    const x = plantillas.directiva(d, mesas).replace(/\.$/, '');
    return x.charAt(0).toLowerCase() + x.slice(1);
  });
  const base = partes.length ? `He entendido: ${partes.join('; ')}.` : 'No he entendido ninguna orden de la lista cerrada.';
  return notas.length ? `${base} Nota: ${notas.join('; ')}.` : base;
}

// Devuelve { directivas, explicacion, fuente: 'llm'|'palabras_clave' }. No aplica nada.
// `horasPorDefecto`: duración cuando la orden no dice cuánto (por defecto 4 h,
// hasta el siguiente comité); quien llama puede pasar su intervalo de comité.
async function interpretar(texto, { llm, universo = [], mesas = [], directivas: estado, ahora, horasPorDefecto } = {}) {
  const ctx = { universo, mesas, directivas: estado, ahora };
  const hDef = horasPorDefectoDe(horasPorDefecto);
  const limites = [...LIMITES, hDef];
  if (llm && llm.activo) {
    const r = await llm.pedirJSON({
      uso: 'agentes',
      proposito: 'megafono',
      sistema: SISTEMA,
      entrada: {
        texto: String(texto || ''),
        activos: universo.map(a => ({ etiqueta: etiquetaDe(a), nombre: (a && a.nombre) || etiquetaDe(a) })),
        mesas: mesas.map(m => ({ id: m.id, nombre: m.nombre || m.id })),
      },
      instrucciones: hDef === HORAS_POR_DEFECTO ? INSTRUCCIONES : instrucciones(hDef),
      esquema: esquemaLLM(universo, mesas),
      maxTokens: 1500,
    });
    if (r.ok) {
      const validas = []; const notas = [];
      for (const d of r.datos.directivas) {
        const v = validarDirectiva(d, ctx);
        if (!v.ok) { notas.push(v.error.replace(/\.$/, '')); continue; }
        if (v.directiva.tipo === 'sin_efecto') v.directiva.motivo = motivoComprobado(v.directiva.motivo, texto, limites);
        validas.push(v.directiva);
      }
      const utiles = validas.filter(d => d.tipo !== 'sin_efecto');
      if (utiles.length || validas.length) {
        const directivas = utiles.length ? utiles : validas;
        // La explicación del LLM solo se enseña si sus cifras están en la orden
        // o en las directivas, sin nada que haya escrito el propio LLM (el
        // motivo de un sin_efecto) ni las reglas: un «75 %» de la lista no
        // puede colarse en una reducción al 50 %.
        const suya = String(r.datos.explicacion || '').trim();
        const soloCodigo = directivas.map(({ motivo, ...d }) => d);
        const comprobada = suya && verificarCifras(suya, { texto: String(texto || ''), directivas: soloCodigo }).ok;
        const explicacion = comprobada && !notas.length ? plantillas.frase(suya, 280) : explicar(directivas, notas, mesas);
        return { directivas, explicacion, fuente: 'llm', costeUsd: r.costeUsd };
      }
    }
    // LLM sin respuesta válida: se cae a palabras clave, que no cuestan nada.
  }
  const { directivas: brutas, notas } = interpretarPalabrasClave(texto, { universo, mesas, horasPorDefecto: hDef });
  const validas = [];
  for (const d of brutas) {
    const v = validarDirectiva(d, ctx);
    if (v.ok) validas.push(v.directiva);
    else notas.push(v.error.replace(/\.$/, ''));
  }
  const directivas = validas.length ? validas : [{ tipo: 'sin_efecto', motivo: 'No he entendido ninguna orden de la lista cerrada (pausa, para, reduce, baja, solo cerrar, no abras, reanuda).' }];
  return { directivas, explicacion: validas.length ? explicar(validas, notas, mesas) : explicar([], notas.length ? notas : ['prueba con «pausa SOL 24 h» o «reduce el riesgo a la mitad»']), fuente: 'palabras_clave' };
}

// Una interpretación hecha FUERA (la web interpreta sin el cerrojo de la
// mesa, ARQUITECTURA-WEB W3) se vuelve a pasar por validarDirectiva contra el
// estado de AHORA: entre interpretar y guardar pudo pasar un latido. La
// explicación solo se conserva si ninguna directiva cambió; si no, la redacta
// el código. Devuelve lo mismo que interpretar().
function revalidar(interpretacion, { universo = [], mesas = [], directivas: estado, ahora, texto = '' } = {}) {
  const ctx = { universo, mesas, directivas: estado, ahora };
  const brutas = interpretacion && Array.isArray(interpretacion.directivas) ? interpretacion.directivas.slice(0, 20) : [];
  const validas = []; const notas = [];
  let cambiada = false;
  for (const d of brutas) {
    const v = validarDirectiva(d, ctx);
    if (!v.ok) { notas.push(v.error.replace(/\.$/, '')); cambiada = true; continue; }
    if (v.directiva.tipo === 'sin_efecto') v.directiva.motivo = motivoComprobado(v.directiva.motivo, texto, [...LIMITES, HORAS_POR_DEFECTO]);
    if (JSON.stringify(v.directiva) !== JSON.stringify(d)) cambiada = true;
    validas.push(v.directiva);
  }
  const utiles = validas.filter(d => d.tipo !== 'sin_efecto');
  const directivas = utiles.length ? utiles : validas.length ? validas
    : [{ tipo: 'sin_efecto', motivo: 'No he entendido ninguna orden de la lista cerrada (pausa, para, reduce, baja, solo cerrar, no abras, reanuda).' }];
  if (utiles.length !== validas.length && utiles.length) cambiada = true;
  const fuente = interpretacion && interpretacion.fuente === 'llm' ? 'llm' : 'palabras_clave';
  const suya = typeof (interpretacion && interpretacion.explicacion) === 'string' ? interpretacion.explicacion.trim() : '';
  const explicacion = !cambiada && suya ? plantillas.frase(suya, 280) : explicar(utiles.length ? utiles : validas, notas, mesas);
  const coste = Number(interpretacion && interpretacion.costeUsd);
  return { directivas, explicacion, fuente, ...(Number.isFinite(coste) && coste > 0 ? { costeUsd: coste } : {}) };
}

module.exports = {
  interpretar,
  revalidar,
  explicar,
  validarDirectiva,
  aplicarDirectiva,
  directivasVigentes,
  directivasVacias,
  interpretarPalabrasClave,
  leerHoras,
  leerFactor,
  TIPOS,
  FACTORES,
  HORAS_MIN,
  HORAS_MAX,
  HORAS_POR_DEFECTO,
  MOTIVO_FIJO,
};
