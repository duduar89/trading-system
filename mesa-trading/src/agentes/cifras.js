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

function verificarCifras(texto, entrada) {
  const { numeros, horas } = extraerNumeros(texto);
  const datos = numerosDeEntrada(entrada);
  const noEncontradas = [];
  for (const h of horas) if (!datos.horas.has(h)) noEncontradas.push(h);
  for (const n of numeros) {
    if (n.libre) continue;
    if (!numeroEncontrado(n, datos.valores)) noEncontradas.push(n.texto);
  }
  return { ok: noEncontradas.length === 0, noEncontradas };
}

module.exports = { verificarCifras, extraerNumeros, numerosDeEntrada, lecturas };
