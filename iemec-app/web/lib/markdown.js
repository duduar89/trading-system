'use strict';
// Markdown mínimo para los textos legales (web/contenido/legal/*.md): títulos, párrafos, listas,
// tablas, citas, negrita, cursiva, código y enlaces. Todo se escapa; los huecos «[PENDIENTE: …]»
// salen resaltados y los enlaces entre documentos apuntan a las páginas de la web.
const { escapar } = require('./html');

const ENLACES_INTERNOS = {
  'aviso-legal.md': '/aviso-legal/',
  'privacidad.md': '/privacidad/',
  'cookies.md': '/cookies/',
};

function url(destino) {
  const limpio = destino.replace(/^\.\//, '');
  if (ENLACES_INTERNOS[limpio]) return ENLACES_INTERNOS[limpio];
  if (/\.md$/.test(limpio)) return null; // documentos internos (p. ej. casillas-formulario.md): sin enlace
  return destino;
}

function enLinea(txt) {
  const guardados = [];
  const guardar = (h) => `\u0000${guardados.push(h) - 1}\u0000`;
  let s = escapar(txt);
  // Código: si es un hueco pendiente, resaltado; si no, <code>.
  s = s.replace(/`([^`]+)`/g, (_, c) => guardar(/^\[PENDIENTE/.test(c) ? `<mark class="pendiente">${c}</mark>` : `<code>${c}</code>`));
  s = s.replace(/\[PENDIENTE[^\]]*\]/g, (m) => guardar(`<mark class="pendiente">${m}</mark>`));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, d) => {
    const u = url(d.replace(/&amp;/g, '&'));
    if (!u) return t;
    const externo = /^https?:/.test(u);
    return guardar(`<a href="${escapar(u)}"${externo ? ' rel="noopener"' : ''}>${t}</a>`);
  });
  // Las fechas (20-07-2025) no se parten por el guion en pantallas estrechas.
  s = s.replace(/\b\d{1,2}-\d{1,2}-\d{4}\b/g, (m) => guardar(`<span class="sin-corte">${m}</span>`));
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\*)/g, '$1<em>$2</em>');
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => guardados[Number(i)]);
}

const celdas = (linea) => linea.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

function tabla(lineas) {
  const cab = celdas(lineas[0]);
  const filas = lineas.slice(2).map(celdas);
  const conCabecera = cab.some((c) => c);
  let h = `<div class="tabla-legal${cab.length === 2 && !conCabecera ? ' clave-valor' : ''}"><table>`;
  if (conCabecera) h += `<thead><tr>${cab.map((c) => `<th scope="col">${enLinea(c)}</th>`).join('')}</tr></thead>`;
  h += '<tbody>';
  for (const f of filas) {
    h += '<tr>' + f.map((c, i) => {
      const etiqueta = conCabecera && cab[i] ? ` data-etiqueta="${escapar(cab[i].replace(/\*\*/g, ''))}"` : '';
      return (!conCabecera && i === 0) ? `<th scope="row">${enLinea(c)}</th>` : `<td${etiqueta}>${enLinea(c)}</td>`;
    }).join('') + '</tr>';
  }
  return h + '</tbody></table></div>';
}

function lista(lineas, ordenada) {
  const items = [];
  for (const l of lineas) {
    const m = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(l);
    if (m && !/^\s{2,}/.test(l)) items.push(m[1]);
    else if (items.length) items[items.length - 1] += ` ${l.trim()}`;
  }
  const tag = ordenada ? 'ol' : 'ul';
  return `<${tag}>${items.map((i) => `<li>${enLinea(i)}</li>`).join('')}</${tag}>`;
}

// Convierte un documento. `nivelBase`: el «# Título» del documento pasa a ser el H1 de la página, y
// los «##» son H2.
function markdownAHtml(md, { citaComoNota = true } = {}) {
  const lineas = md.replace(/\r\n/g, '\n').split('\n');
  const salida = [];
  let i = 0;
  const esTabla = (l) => /^\s*\|/.test(l);
  const esLista = (l) => /^\s*(?:[-*]|\d+\.)\s+/.test(l);
  while (i < lineas.length) {
    const l = lineas[i];
    if (!l.trim()) { i++; continue; }
    const t = /^(#{1,4})\s+(.*)$/.exec(l);
    if (t) {
      const nivel = Math.min(t[1].length, 4);
      salida.push(`<h${nivel}>${enLinea(t[2])}</h${nivel}>`);
      i++; continue;
    }
    if (/^---+\s*$/.test(l)) { salida.push('<hr>'); i++; continue; }
    if (esTabla(l)) {
      const bloque = [];
      while (i < lineas.length && esTabla(lineas[i])) bloque.push(lineas[i++]);
      salida.push(tabla(bloque));
      continue;
    }
    if (/^>\s?/.test(l)) {
      const bloque = [];
      while (i < lineas.length && /^>\s?/.test(lineas[i])) bloque.push(lineas[i++].replace(/^>\s?/, ''));
      const dentro = markdownAHtml(bloque.join('\n'), { citaComoNota: false });
      salida.push(citaComoNota
        ? `<aside class="nota-interna"><p class="etiqueta">Nota para la revisión · no se publicará</p>${dentro}</aside>`
        : `<blockquote>${dentro}</blockquote>`);
      continue;
    }
    if (esLista(l)) {
      const ordenada = /^\s*\d+\./.test(l);
      const bloque = [];
      while (i < lineas.length && lineas[i].trim() && (esLista(lineas[i]) || /^\s{2,}\S/.test(lineas[i]))) bloque.push(lineas[i++]);
      salida.push(lista(bloque, ordenada));
      continue;
    }
    const parrafo = [];
    while (i < lineas.length && lineas[i].trim() && !/^(#{1,4}\s|>|\s*\||---+\s*$)/.test(lineas[i]) && !esLista(lineas[i])) parrafo.push(lineas[i++].trim());
    salida.push(`<p>${enLinea(parrafo.join(' '))}</p>`);
  }
  return salida.join('\n');
}

// Parte un documento por sus secciones «## …»: [{ titulo, md }]. La primera (antes del primer «##»)
// lleva el título «#».
function secciones(md) {
  const partes = [];
  let actual = { titulo: null, lineas: [] };
  for (const l of md.replace(/\r\n/g, '\n').split('\n')) {
    const m = /^##\s+(.*)$/.exec(l);
    if (m) { partes.push(actual); actual = { titulo: m[1].trim(), lineas: [l] }; } else actual.lineas.push(l);
  }
  partes.push(actual);
  return partes.map((p) => ({ titulo: p.titulo, md: p.lineas.join('\n') }));
}

module.exports = { markdownAHtml, enLinea, secciones };
