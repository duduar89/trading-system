'use strict';
// Ninguna cifra de un LLM llega a la pantalla sin comprobar (§0.2): se sacan
// los números del texto y se buscan entre los números de los datos que se le
// dieron. Si falta uno, el texto no sale y se usa la plantilla.
//
// Formatos que entiende: 1.234,56 · 1,234.56 · 12 % · 3,5 $ · 5 pb · 84k · 1,2 M.
// Un «1.234» es ambiguo (mil doscientos o uno coma dos): se prueban las dos
// lecturas y basta con que una cuadre.
//
// Signo: un «+» o «-» (o «−») pegado al número y precedido de espacio, «(» o
// el principio del texto es un signo escrito, y tiene que coincidir con el del
// dato: «+523,40 $» no pasa si el dato es −523,40. Sin signo escrito se compara
// el valor absoluto («pérdida de 45,20 $» con pnl −45,2 pasa). «7-25» o
// «83.900 - 84.120» no llevan signo.

// Hora de reloj (16:00): no es una cifra de negocio, pero tampoco se inventa:
// solo pasa si la misma hora aparece escrita en los datos.
const RE_HORA = /(?<![\d:.,])([01]?\d|2[0-3]):([0-5]\d)(?![\d:])/g;
// Dígitos con separadores . o , SIEMPRE entre dígitos (el punto final de una
// frase no forma parte del número).
const RE_NUMERO = /\d+(?:[.,]\d+)*/g;
const RE_LETRA = /\p{L}/u;

// Unidades que cambian la escala con la que se compara.
const SUFIJOS = [
  { re: /^\s?(%|por\s?ciento)/i, tipo: 'pct', escalas: [100, 1] },
  { re: /^\s?(pb|p\.b\.|puntos básicos)(?!\p{L})/iu, tipo: 'pb', escalas: [10000, 1] },
  { re: /^\s?(k|mil)(?!\p{L})/u, tipo: 'mult', multiplicador: 1e3 },
  { re: /^\s?(M|millones|millón)(?!\p{L})/u, tipo: 'mult', multiplicador: 1e6 },
];

// Lecturas posibles de un número escrito: [{ valor, decimales }].
// `decimales` son los que se ven en el texto: fijan cuánto redondeo se acepta.
function lecturas(token) {
  const seps = token.match(/[.,]/g) || [];
  if (seps.length === 0) return [{ valor: Number(token), decimales: 0 }];
  const hayPunto = token.includes('.');
  const hayComa = token.includes(',');
  if (hayPunto && hayComa) {
    // El último separador es el decimal; el otro, de miles.
    const dec = token.lastIndexOf('.') > token.lastIndexOf(',') ? '.' : ',';
    const miles = dec === '.' ? ',' : '.';
    const [ent, frac] = [token.slice(0, token.lastIndexOf(dec)), token.slice(token.lastIndexOf(dec) + 1)];
    if (ent.includes(dec)) return [];
    const grupos = ent.split(miles);
    if (grupos.slice(1).some(g => g.length !== 3)) return [];
    return [{ valor: Number(grupos.join('') + '.' + frac), decimales: frac.length }];
  }
  const sep = hayPunto ? '.' : ',';
  const partes = token.split(sep);
  if (partes.length > 2) {
    // 1.234.567 son miles; 4.1.2 (una versión) no es una cifra.
    if (partes[0].length > 3 || partes.slice(1).some(g => g.length !== 3)) return [];
    return [{ valor: Number(partes.join('')), decimales: 0 }];
  }
  const [a, b] = partes;
  const salida = [{ valor: Number(`${a}.${b}`), decimales: b.length }];
  if (b.length === 3 && a.length <= 3 && !/^0+$/.test(a)) salida.push({ valor: Number(a + b), decimales: 0 });
  return salida;
}

// Signo escrito delante del número que empieza en la posición i: 1, −1 o 0.
function signoDelante(s, i) {
  const c1 = i > 0 ? s[i - 1] : '';
  if (!c1 || !/[+\-−]/.test(c1)) return 0;
  if (i >= 2 && !/[\s(]/.test(s[i - 2])) return 0;
  return c1 === '+' ? 1 : -1;
}

// Números del texto con su contexto. Devuelve [{ texto, lecturas, unidad, escalas, multiplicador, libre, signo }].
function extraerNumeros(texto) {
  const s = String(texto ?? '');
  const horas = [];
  // Las horas se apartan antes para que 16:45 no se lea como 16 y 45.
  const sinHoras = s.replace(RE_HORA, (m) => { horas.push(m.padStart(5, '0')); return ' '.repeat(m.length); });
  const numeros = [];
  for (const m of sinHoras.matchAll(RE_NUMERO)) {
    const token = m[0];
    const i = m.index;
    const antes = i > 0 ? sinHoras[i - 1] : '';
    // SMA200, RSI2, H1: parte de un nombre, no una cifra.
    if (antes && RE_LETRA.test(antes)) continue;
    const lects = lecturas(token);
    if (!lects.length) continue;
    const signo = signoDelante(sinHoras, i);
    const resto = sinHoras.slice(i + token.length);
    let unidad = null; let escalas = [1]; let multiplicador = 1; let sufijo = '';
    for (const suf of SUFIJOS) {
      const mm = resto.match(suf.re);
      if (mm) {
        unidad = suf.tipo; sufijo = mm[0];
        if (suf.escalas) escalas = suf.escalas;
        if (suf.multiplicador) multiplicador = suf.multiplicador;
        break;
      }
    }
    const dinero = /^\s?[$€]/.test(resto) || /[$€]\s?$/.test(sinHoras.slice(Math.max(0, i - 2), i));
    if (dinero && !unidad) unidad = 'dinero';
    // Conteos, días y horas (0-31) pasan siempre, pero solo si son enteros sin
    // unidad ni signo: «12 %», «5 $» o «+3» sí son cifras que hay que encontrar.
    const libre = !unidad && !signo && lects.length === 1 && lects[0].decimales === 0 && !/[.,]/.test(token) && lects[0].valor <= 31;
    const marca = signo === 1 ? '+' : signo === -1 ? '-' : '';
    numeros.push({ texto: (marca + token + sufijo).trim(), lecturas: lects, unidad, escalas, multiplicador, libre, signo });
  }
  return { numeros, horas };
}

// Todos los números de la entrada (aplanada), incluidos los que vienen dentro
// de textos: un motivo «SMA7 84.120 > SMA25 83.900» también es un dato dado.
function numerosDeEntrada(entrada) {
  const valores = [];
  const horas = new Set();
  const vistos = new Set();
  const visitar = (x, prof) => {
    if (x === null || x === undefined || prof > 40) return;
    if (typeof x === 'number') { if (Number.isFinite(x)) valores.push(x); return; }
    if (typeof x === 'string') {
      const { numeros, horas: hs } = extraerNumeros(x);
      // «(kill en -15 %)» dentro de un texto dado conserva su signo.
      for (const n of numeros) for (const l of n.lecturas) valores.push((n.signo || 1) * l.valor * n.multiplicador);
      for (const h of hs) horas.add(h);
      return;
    }
    if (typeof x !== 'object' || vistos.has(x)) return;
    vistos.add(x);
    for (const v of Array.isArray(x) ? x : Object.values(x)) visitar(v, prof + 1);
  };
  visitar(entrada, 0);
  return { valores, horas };
}

// ¿Es `valor` (con `decimales` a la vista) el redondeo de `dato` a esa precisión?
function cuadra(valor, decimales, dato) {
  const tolerancia = 0.5 * 10 ** -decimales;
  const d = Math.abs(dato);
  return Math.abs(valor - d) <= tolerancia + 1e-9 * Math.max(1, d);
}

function numeroEncontrado(n, valores) {
  for (const l of n.lecturas) {
    for (const dato of valores) {
      // Con signo escrito, el dato tiene que tener el mismo. Un cero (dato o
      // cifra redondeada a 0) no tiene signo que contradecir.
      if (n.signo && dato !== 0 && l.valor !== 0 && Math.sign(dato) !== n.signo) continue;
      if (n.multiplicador !== 1) {
        // 84k con dato 84.123: se compara en la unidad del texto (miles).
        if (cuadra(l.valor, l.decimales, dato / n.multiplicador)) return true;
        continue;
      }
      for (const escala of n.escalas) {
        if (cuadra(l.valor, l.decimales, dato * escala)) return true;
      }
    }
  }
  return false;
}

// Conteos escritos con letra («cuatro operaciones», «ninguna posición»): con
// { conteos: true } son cifras como las otras. «Un», «uno» y «una» no entran:
// casi siempre son artículos («una buena racha»).
const NUMEROS_LETRA = Object.freeze({
  cero: 0, ningun: 0, ninguna: 0, ninguno: 0, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8,
  nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17,
  dieciocho: 18, diecinueve: 19, veinte: 20, veintiuno: 21, veintidos: 22, veintitres: 23, veinticuatro: 24,
  veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29, treinta: 30,
});
const sinTildes = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const RE_PALABRA = /\p{L}+/gu;

function numerosConLetra(texto) {
  const out = [];
  for (const m of String(texto ?? '').matchAll(RE_PALABRA)) {
    const clave = sinTildes(m[0].toLowerCase());
    if (Object.prototype.hasOwnProperty.call(NUMEROS_LETRA, clave)) out.push({ texto: m[0], valor: NUMEROS_LETRA[clave] });
  }
  return out;
}

// `conteos: true` (reuniones y comité, donde lo que se cuenta son operaciones,
// posiciones y órdenes): los enteros pequeños sin unidad y los escritos con
// letra también tienen que estar en los datos. Sin la opción pasan libres,
// como siempre (días y conteos que el texto no puede inventar con daño).
function verificarCifras(texto, entrada, { conteos = false } = {}) {
  const { numeros, horas } = extraerNumeros(texto);
  const datos = numerosDeEntrada(entrada);
  const noEncontradas = [];
  for (const h of horas) if (!datos.horas.has(h)) noEncontradas.push(h);
  for (const n of numeros) {
    if (n.libre && !conteos) continue;
    if (!numeroEncontrado(n, datos.valores)) noEncontradas.push(n.texto);
  }
  if (conteos) {
    for (const p of numerosConLetra(texto)) {
      if (!datos.valores.some(d => Math.abs(d) === p.valor)) noEncontradas.push(p.texto);
    }
  }
  return { ok: noEncontradas.length === 0, noEncontradas };
}

// ---------- Modo, voto y régimen, también en llano ----------
//
// Un texto del LLM no puede decir un modo, un voto o un régimen distinto del
// que calculó el código, ni con su nombre (DEFENSIVO, «modo defensivo») ni en
// llano («las compras nuevas a la mitad», «el mercado tiene miedo»): ahí no hay
// cifras y verificarCifras no lo ve. Se buscan sin distinguir mayúsculas. Las
// frases de plantillas.MODO_TEXTO y REGIMEN_TEXTO se reconocen como su valor
// (test/agentes-cifras.test.js lo comprueba). Un falso positivo solo cuesta
// que salga la plantilla; un falso negativo enseña algo falso.

// Lo que no es un modo ni un régimen aunque use sus palabras.
const QUITAR = [
  /\b(el\s+)?(nivel|estado)\s+(del\s+fondo\s+)?(es\s+|de\s+)?[«"]?(normal|solo[\s_-]+cerrar|en\s+pausa|pausado|bloqueado)\b[»"]?/giu,  // el nivel de riesgo del fondo
  /\b([ií]ndice|indicador|term[oó]metro)\s+(de(l)?\s+)?miedo\s+y\s+(la\s+)?codicia\b/giu,
  /\bmiedo\s+y\s+(la\s+)?codicia\b/giu,
  /\bfear\s*(and|&)\s*greed\b/giu,
];

// Por su nombre (en cualquier forma).
const NOMBRES_MODO = [
  ['NORMAL', /\bNORMAL\b/u],                                  // en mayúsculas: el nombre del modo
  ['NORMAL', /\bmodo\s+normal\b/iu],
  ['NORMAL', /\bvot\p{L}*\s*:?\s*(por\s+)?(el\s+)?(modo\s+)?normal\b/iu],
  ['DEFENSIVO', /\bdefensiv[oa]s?\b/iu],
  ['SOLO_CERRAR', /\bs[oó]lo[\s_-]+cerrar\b/iu],
];
// Lo que dice que se hace con las compras, como el modo que lo produce.
const COMPRAS = [
  ['NORMAL', /\b(a|de|con)\s+tama[ñn]o\s+(normal|completo|entero|habitual)\b/iu],   // «a ×0,5 del tamaño normal» no
  ['NORMAL', /\bcompras?\s+normales?\b/iu],
  ['DEFENSIVO', /\ba\s+la\s+mitad\b/iu],
  ['DEFENSIVO', /\b(la\s+)?mitad\s+del?\s+(tama[ñn]o|capital|dinero|riesgo)\b/iu],
  ['DEFENSIVO', /\bmedio\s+tama[ñn]o\b/iu],
  ['SOLO_CERRAR', /\bs[oó]lo\s+(se\s+)?(cierra|cierran|cerramos|cierro)\b/iu],
  ['SOLO_CERRAR', /\bno\s+se\s+(abre|compra)\s+nada\b/iu],
  ['SOLO_CERRAR', /\bno\s+(abrimos|compramos|abro|compro|abre|compra)\s+nada\b/iu],
  ['SOLO_CERRAR', /\bsin\s+(abrir|comprar)\s+nada\b/iu],
];
const NEUTRAL_LLANO = /\bni\s+a\s+favor\s+ni\s+en\s+contra\b/giu;
const REGIMENES = [
  ['RISK-ON', /\brisk[\s-]?on\b/iu],
  ['RISK-ON', /\bacompa[ñn]a\b/iu],
  ['RISK-ON', /\bapetito\b/iu],
  ['RISK-ON', /\ba\s+favor\b(?!\s+de)/iu],
  ['NEUTRAL', /\bneutral\b/iu],
  ['NEUTRAL', NEUTRAL_LLANO],
  ['RISK-OFF', /\brisk[\s-]?off\b/iu],
  ['RISK-OFF', /\bmiedo\b/iu],
  ['RISK-OFF', /\baversi[oó]n\b/iu],
  ['RISK-OFF', /\ben\s+contra\b/iu],
];

function buscar(lista, texto) {
  const out = new Set();
  for (const [valor, re] of lista) { re.lastIndex = 0; if (re.test(texto)) out.add(valor); }
  return [...out];
}

// { modos, compras, regimenes } que dice un texto.
function vocabulario(texto) {
  let s = String(texto ?? '');
  for (const re of QUITAR) s = s.replace(re, ' ');
  const modos = buscar(NOMBRES_MODO, s);
  const compras = buscar(COMPRAS, s);
  const regimenes = buscar(REGIMENES, s);
  // «ni a favor ni en contra» es NEUTRAL, no «a favor» ni «en contra».
  const sinNeutral = s.replace(NEUTRAL_LLANO, ' ');
  return { modos, compras, regimenes: [...new Set([...buscar(REGIMENES.filter(([v]) => v !== 'NEUTRAL'), sinNeutral), ...regimenes.filter(v => v === 'NEUTRAL')])] };
}

// ¿Dice el texto algo distinto de lo permitido? `modos`: los modos que puede
// nombrar ([] = ninguno); `compras`: lo que puede decir que se hace con las
// compras (por defecto, lo mismo que `modos`); `regimen`: el único régimen que
// puede decir (null = ninguno).
function contradiceVocabulario(texto, { modos = [], compras = modos, regimen = null } = {}) {
  const v = vocabulario(texto);
  if (v.modos.some(m => !modos.includes(m))) return true;
  if (v.compras.some(m => !compras.includes(m))) return true;
  return v.regimenes.some(r => r !== regimen);
}

module.exports = { verificarCifras, extraerNumeros, numerosDeEntrada, lecturas, vocabulario, contradiceVocabulario };
