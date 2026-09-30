// Caras de los agentes y equipo: el retrato SVG de cada agente, la agrupación
// del equipo por departamento y el orden de las conversaciones del feed.
//
// La cara sale del id del agente, siempre la misma (determinista): la piel,
// el color del pelo y el peinado son los de su muñeco del parqué
// (personajes.aspectoDe), la camisa es del color de su departamento y el
// resto (corte, gafas, barba, cejas, boca) sale de otro hash del mismo id.
// Estilo plano y amable, sin imágenes externas: la CSP solo admite lo propio
// y el SVG va con atributos de presentación (nunca `style=`).
//
// Tres tamaños: 24 (respuestas de una conversación), 40 (feed y equipo) y
// 96 (ficha del agente).
(function (raiz, fabrica) {
  const esNode = typeof module === 'object' && module.exports;
  const mod = fabrica(esNode ? require('./personajes.js') : raiz.Parque.personajes);
  if (esNode) module.exports = mod;
  else (raiz.Parque = raiz.Parque || {}).caras = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (personajes) {
  'use strict';

  const TAMANOS = [24, 40, 96];
  const COLOR_NEUTRO = '#8a93b0';
  const COLOR_MEGAFONO = '#f59e0b';
  const COLOR_SISTEMA = '#64748b';
  const FONDO_PANEL = '#151b2e';

  // Qué hace cada departamento, en una frase llana (texto de la interfaz, sin
  // cifras). Si algún día el departamento trae su propio `queHace`, manda ese.
  const FRASES_DEPARTAMENTO = {
    direccion: 'Preside el comité: decide si el fondo sigue normal, va con la mitad de tamaño o solo cierra posiciones.',
    macro: 'Lee el ambiente del mercado en conjunto (apetito, neutral o miedo) y pide prudencia cuando hay miedo.',
    analisis: 'Un analista por activo: sigue su precio cada hora y escribe una nota para los demás. No compran ni venden.',
    mesas: 'Los operadores: cada uno aplica la regla de su estrategia a un activo y propone comprar o vender.',
    riesgos: 'Revisa cada orden antes de que salga contra los límites de seguridad: la aprueba, la recorta o la prohíbe.',
    operaciones: 'Manda al bróker las órdenes aprobadas y lleva las cuentas del fondo, comparándolas con las del bróker.',
    laboratorio: 'Prueba estrategias nuevas con precios del pasado y repasa por qué se ganó o se perdió en cada operación.',
  };

  // ---------- utilidades ----------

  const hash = personajes.hash;

  function hexARgb(hex) {
    const h = String(hex || '').trim();
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(h);
    if (!m) return null;
    const s = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1];
    const n = parseInt(s, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const aHex = rgb => '#' + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

  // Color válido o el neutro (un color raro no puede romper el SVG).
  const colorSeguro = c => (hexARgb(c) ? String(c).trim().toLowerCase() : COLOR_NEUTRO);

  // Mezcla `a` con `b` (k = cuánto de `a`).
  function mezclar(a, b, k) {
    const x = hexARgb(a) || hexARgb(COLOR_NEUTRO);
    const y = hexARgb(b) || hexARgb(FONDO_PANEL);
    return aHex(x.map((v, i) => v * k + y[i] * (1 - k)));
  }
  const oscurecer = (hex, k) => mezclar(hex, '#000000', 1 - k);

  // Texto seguro dentro de un atributo o de <title>.
  const escapar = s => String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  // Nombre de pila («Marta» de «Marta Solís»).
  const pila = nombre => String(nombre || '').trim().split(/\s+/)[0] || '';

  // Minúsculas y sin tildes, para buscar «solis» y encontrar «Solís».
  function normalizar(texto) {
    return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  // ---------- género aparente (solo para la barba) ----------

  // Los nombres de pila de la plantilla (src/agentes/registro.js) que no
  // siguen la regla «acaba en a → femenino».
  const FEMENINOS_SIN_A = new Set(['irene', 'rocio', 'beatriz', 'raquel', 'miriam', 'pilar', 'montse', 'maite', 'carmen', 'ines', 'isabel', 'mercedes', 'nieves', 'belen']);
  const MASCULINOS_CON_A = new Set(['borja', 'luca']);
  const ROL_F = /\b(operadora|presidenta|jefa|directora|auditora|ejecutora)\b/;
  const ROL_M = /\b(operador|presidente|jefe|director|auditor|ejecutor)\b/;

  // 'f' | 'm' | null. Lo primero, lo que diga el agente; después, su rol
  // («Operadora», «Jefa»…) y, si no, su nombre de pila.
  function generoDe(agente) {
    if (!agente) return null;
    if (agente.genero === 'f' || agente.genero === 'm') return agente.genero;
    const rol = normalizar(agente.rol);
    if (ROL_F.test(rol)) return 'f';
    if (ROL_M.test(rol)) return 'm';
    const n = normalizar(pila(agente.nombre));
    if (!n) return null;
    if (FEMENINOS_SIN_A.has(n)) return 'f';
    if (MASCULINOS_CON_A.has(n)) return 'm';
    return /a$/.test(n) ? 'f' : 'm';
  }

  // ---------- rasgos ----------

  const CORTES = { 0: ['raya', 'flequillo', 'rapado', 'rizos'], 1: ['melena', 'flequillo-largo'], 2: ['mono-alto', 'mono-lado'] };
  const BARBAS = ['barba', 'bigote', 'perilla'];

  // Rasgos de la cara de un agente (o de un id suelto). Piel, pelo y peinado:
  // los del muñeco. Lo demás, de un segundo hash del id.
  function rasgosDe(agente) {
    const id = agente && typeof agente === 'object' ? agente.id : agente;
    const base = personajes.aspectoDe(String(id || ''));
    const h = hash(`${id}|cara`);
    const cortes = CORTES[base.peinado] || CORTES[0];
    const genero = agente && typeof agente === 'object' ? generoDe(agente) : null;
    const conBarba = genero === 'm' && ((h >>> 3) % 3 === 0);
    return {
      piel: base.piel,
      pelo: base.pelo,
      peinado: base.peinado,
      corte: cortes[h % cortes.length],
      gafas: (h >>> 5) % 4 === 0 ? ((h >>> 7) % 2 ? 'cuadradas' : 'redondas') : null,
      barba: conBarba ? BARBAS[(h >>> 8) % BARBAS.length] : null,
      cejas: (h >>> 10) % 2 ? 'arqueadas' : 'rectas',
      boca: ['sonrisa', 'abierta', 'suave'][(h >>> 11) % 3],
      genero,
    };
  }

  // ---------- SVG (viewBox 48×48, todo dentro del círculo: sin clipPath ni ids) ----------

  function capaPeloDetras(r) {
    if (r.peinado === 1) {
      // Melena: por detrás de la cabeza, hasta los hombros.
      return `<path d="M11.4 21.5C10.8 11 16 6.8 24 6.8S37.2 11 36.6 21.5L37.6 36C33 38.6 15 38.6 10.4 36Z" fill="${r.pelo}"/>`;
    }
    if (r.corte === 'mono-alto') return `<circle cx="24" cy="5.6" r="4.4" fill="${r.pelo}"/>`;
    if (r.corte === 'mono-lado') return `<circle cx="33.6" cy="8.2" r="4" fill="${r.pelo}"/>`;
    return '';
  }

  function capaPeloArriba(r) {
    const p = r.pelo;
    switch (r.corte) {
      case 'raya':
        return `<path d="M13.3 19.6C12.5 10.4 17 6.4 24.2 6.4S35.7 10.4 34.7 19.6C34 15.8 32.8 13.6 30.6 12.6C26.4 14.6 20.4 14.4 16.3 12.4C14.8 13.9 13.8 16.3 13.3 19.6Z" fill="${p}"/>`;
      case 'flequillo':
        return `<path d="M13.2 20C12.4 10 17 6.3 24 6.3S35.6 10 34.8 20C34.2 17.2 33.5 15.6 32.4 14.9L15.6 14.9C14.5 15.6 13.8 17.2 13.2 20Z" fill="${p}"/>`;
      case 'rapado':
        return `<path d="M13.7 16.6C13.7 10.2 18 7.1 24 7.1S34.3 10.2 34.3 16.6C31 12.3 17 12.3 13.7 16.6Z" fill="${p}"/>`;
      case 'rizos':
        return `<path d="M13.6 17.4C13.6 11 18 8.4 24 8.4S34.4 11 34.4 17.4C31 13.4 17 13.4 13.6 17.4Z" fill="${p}"/>`
          + `<g fill="${p}"><circle cx="15.8" cy="12" r="3.3"/><circle cx="19.6" cy="8.9" r="3.5"/><circle cx="24.2" cy="7.6" r="3.6"/>`
          + `<circle cx="28.8" cy="8.9" r="3.5"/><circle cx="32.4" cy="12" r="3.3"/></g>`;
      case 'melena':
        return `<path d="M12.9 21.2C12.1 10.4 17 6.5 24 6.5S35.9 10.4 35.1 21.2C34.3 16 32 12.9 24 12.3C16 12.9 13.7 16 12.9 21.2Z" fill="${p}"/>`;
      case 'flequillo-largo':
        return `<path d="M12.9 21.2C12.1 10.2 17 6.3 24 6.3S35.9 10.2 35.1 21.2C34.5 17.6 33.7 15.8 32.6 15.1C27 16.4 19.4 15.4 16.8 13.4C15 15 13.6 17.4 12.9 21.2Z" fill="${p}"/>`;
      case 'mono-alto':
      case 'mono-lado':
        return `<path d="M13.6 17.6C13 10 17.5 7 24 7S35 10 34.4 17.6C32.5 13.2 28.5 11.5 24 11.5S15.5 13.2 13.6 17.6Z" fill="${p}"/>`;
      default:
        return '';
    }
  }

  function capaCejas(r, grueso) {
    const c = oscurecer(r.pelo, 0.25);
    const d = r.cejas === 'arqueadas'
      ? 'M17.4 17Q19.6 15.4 21.8 16.4M26.2 16.4Q28.4 15.4 30.6 17'
      : 'M17.6 16.7L21.6 16.2M26.4 16.2L30.4 16.7';
    return `<path d="${d}" fill="none" stroke="${c}" stroke-width="${grueso ? 1.9 : 1.3}" stroke-linecap="round"/>`;
  }

  function capaBoca(r, grueso, sobreBarba) {
    const c = sobreBarba ? '#f6ddd2' : '#8a3b3b';
    if (r.boca === 'abierta') return `<path d="M20.6 25.3Q24 26 27.4 25.3Q24 29.6 20.6 25.3Z" fill="${c}"/>`;
    const d = r.boca === 'suave' ? 'M21.6 25.8Q24 27.4 26.4 25.8' : 'M20.8 25.4Q24 28.4 27.2 25.4';
    return `<path d="${d}" fill="none" stroke="${c}" stroke-width="${grueso ? 1.9 : 1.3}" stroke-linecap="round"/>`;
  }

  function capaBarba(r) {
    const p = r.pelo;
    const bigote = `<path d="M20 24.7C21.6 23.2 23 23.4 24 24C25 23.4 26.4 23.2 28 24.7C26.4 25.4 25 25.2 24 24.8C23 25.2 21.6 25.4 20 24.7Z" fill="${p}"/>`;
    if (r.barba === 'barba') {
      return `<path d="M13.8 19.5C13.8 27.5 18 31.2 24 31.2S34.2 27.5 34.2 19.5C33.2 22.6 31.4 24.2 29 24.4C27 23.8 25.4 23.6 24 23.6S21 23.8 19 24.4C16.6 24.2 14.8 22.6 13.8 19.5Z" fill="${p}"/>`;
    }
    if (r.barba === 'perilla') return bigote + `<path d="M21.4 28.3C22.2 30.8 25.8 30.8 26.6 28.3C25.4 28.9 22.6 28.9 21.4 28.3Z" fill="${p}"/>`;
    if (r.barba === 'bigote') return bigote;
    return '';
  }

  function capaGafas(r, grueso) {
    const w = grueso ? 1.5 : 1.1;
    const marco = '#1f2433';
    const cristal = r.gafas === 'cuadradas'
      ? `<rect x="16.5" y="17.3" width="7" height="5.2" rx="1.4"/><rect x="24.5" y="17.3" width="7" height="5.2" rx="1.4"/>`
      : `<circle cx="20" cy="19.8" r="3.2"/><circle cx="28" cy="19.8" r="3.2"/>`;
    return `<g fill="#ffffff" fill-opacity="0.14" stroke="${marco}" stroke-width="${w}">${cristal}</g>`
      + `<path d="M23.2 19.4Q24 18.8 24.8 19.4M16.6 19.2L13.9 18.8M31.4 19.2L34.1 18.8" fill="none" stroke="${marco}" stroke-width="${w}" stroke-linecap="round"/>`;
  }

  // Cabecera común del <svg>: tamaño, accesibilidad y el círculo de fondo.
  function abrirSvg(tam, clase, etiqueta, fondo) {
    const t = TAMANOS.includes(tam) ? tam : 40;
    const acc = etiqueta ? `role="img" aria-label="${escapar(etiqueta)}"` : 'aria-hidden="true" focusable="false"';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="${t}" height="${t}" class="${clase}" ${acc}>`
      + (etiqueta ? `<title>${escapar(etiqueta)}</title>` : '')
      + `<circle cx="24" cy="24" r="24" fill="${fondo}"/>`;
  }

  // Retrato de un agente. `opciones`: { tam: 24|40|96, color (el de su
  // departamento), etiqueta (texto para el lector de pantalla; sin ella, la
  // cara es decorativa: aria-hidden) }.
  function svgCara(agente, opciones) {
    const o = opciones || {};
    const tam = TAMANOS.includes(o.tam) ? o.tam : 40;
    const r = rasgosDe(agente);
    const color = colorSeguro(o.color);
    const camisa = color;
    const camisaSombra = oscurecer(color, 0.2);
    const fondo = mezclar(color, FONDO_PANEL, 0.3);
    const pielSombra = oscurecer(r.piel, 0.12);
    const pielLinea = oscurecer(r.piel, 0.3);
    const detalle = tam >= 40;
    const grueso = tam <= 24;
    let s = abrirSvg(tam, `cara-svg cara-svg-${tam}`, o.etiqueta, fondo);
    s += capaPeloDetras(r);
    // Hombros con la camisa del departamento; la mitad derecha más oscura (volumen, como el muñeco).
    s += `<path d="M4.5 38C7 33.5 11 31.6 17 30.8L31 30.8C37 31.6 41 33.5 43.5 38A24 24 0 0 1 4.5 38Z" fill="${camisa}"/>`;
    s += `<path d="M24 30.8L31 30.8C37 31.6 41 33.5 43.5 38A24 24 0 0 1 24 48Z" fill="${camisaSombra}"/>`;
    // Cuello en pico y las solapas de la camisa.
    s += `<path d="M20 24L28 24L28.4 30.6L24 35.2L19.6 30.6Z" fill="${pielSombra}"/>`;
    s += `<path d="M18.8 30.4L24 35.6L29.2 30.4" fill="none" stroke="#ffffff" stroke-opacity="0.85" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>`;
    // Orejas y cabeza.
    s += `<circle cx="13.8" cy="20" r="2.4" fill="${r.piel}"/><circle cx="34.2" cy="20" r="2.4" fill="${r.piel}"/>`;
    s += `<ellipse cx="24" cy="19" rx="10.4" ry="11" fill="${r.piel}"/>`;
    s += capaPeloArriba(r);
    s += capaCejas(r, grueso);
    // Ojos (con brillo si hay sitio), nariz y mofletes.
    s += `<ellipse cx="20" cy="19.8" rx="1.35" ry="1.65" fill="#1b1b24"/><ellipse cx="28" cy="19.8" rx="1.35" ry="1.65" fill="#1b1b24"/>`;
    if (detalle) {
      s += `<circle cx="20.5" cy="19.2" r="0.45" fill="#ffffff"/><circle cx="28.5" cy="19.2" r="0.45" fill="#ffffff"/>`;
      s += `<path d="M24 20.6Q25.3 23 23.8 23.6" fill="none" stroke="${pielLinea}" stroke-width="0.9" stroke-linecap="round"/>`;
    }
    s += `<circle cx="17.4" cy="23.4" r="2" fill="#ff7a7a" fill-opacity="0.22"/><circle cx="30.6" cy="23.4" r="2" fill="#ff7a7a" fill-opacity="0.22"/>`;
    s += capaBarba(r);
    s += capaBoca(r, grueso, r.barba === 'barba');
    if (r.gafas) s += capaGafas(r, grueso);
    return s + '</svg>';
  }

  // El humano (lo que se dice por el Megáfono): su propio icono, ámbar.
  function svgHumano(opciones) {
    const o = opciones || {};
    const tam = TAMANOS.includes(o.tam) ? o.tam : 40;
    return abrirSvg(tam, `cara-svg cara-svg-${tam}`, o.etiqueta, mezclar(COLOR_MEGAFONO, FONDO_PANEL, 0.34))
      + `<g transform="translate(12 12)" fill="none" stroke="${COLOR_MEGAFONO}" stroke-width="${tam <= 24 ? 2.6 : 2}" stroke-linecap="round" stroke-linejoin="round">`
      + '<path d="M4 10v4h3l7 4V6L7 10H4z"/><path d="M17.5 9a4 4 0 0 1 0 6"/><path d="M8 14l1.2 4.5"/></g></svg>';
  }

  // Los avisos del sistema: el cubo del panel, en gris.
  function svgSistema(opciones) {
    const o = opciones || {};
    const tam = TAMANOS.includes(o.tam) ? o.tam : 40;
    return abrirSvg(tam, `cara-svg cara-svg-${tam}`, o.etiqueta, mezclar(COLOR_SISTEMA, FONDO_PANEL, 0.4))
      + '<g transform="translate(12 12)"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" fill="#94a3b8"/><path d="M12 3l8 4.5-8 4.5-8-4.5z" fill="#cbd5e1"/>'
      + '<path d="M12 12v9l8-4.5v-9z" fill="#64748b"/></g></svg>';
  }

  // Nodo HTML con la cara (span.cara > svg). `quien`: un agente, o 'humano' /
  // 'sistema'. Solo en el navegador.
  // Cada cara se analiza (innerHTML) una vez y después se clona: el feed
  // entero son hasta 300 caras y repintarlo analizando cada SVG costaba
  // ~110 ms en Chromium.
  const PLANTILLAS = new Map();
  const MAX_PLANTILLAS = 400;
  function nodoCara(quien, opciones) {
    const o = opciones || {};
    const tam = TAMANOS.includes(o.tam) ? o.tam : 40;
    const svg = quien === 'humano' ? svgHumano(o) : quien === 'sistema' ? svgSistema(o) : svgCara(quien, o);
    const guardada = PLANTILLAS.get(svg);
    if (guardada && typeof guardada.cloneNode === 'function') return guardada.cloneNode(true);
    const span = document.createElement('span');
    span.className = `cara cara-${tam}`;
    span.innerHTML = svg;
    if (PLANTILLAS.size >= MAX_PLANTILLAS) PLANTILLAS.clear();
    PLANTILLAS.set(svg, span.cloneNode ? span.cloneNode(true) : span);
    return span;
  }

  // ---------- equipo ----------

  function fraseDepartamento(dep) {
    if (!dep) return '';
    if (typeof dep.queHace === 'string' && dep.queHace.trim()) return dep.queHace.trim();
    return FRASES_DEPARTAMENTO[dep.id] || '';
  }

  // ¿Encaja el agente con lo buscado? Cada palabra tiene que estar en su
  // nombre o en su rol (sin tildes ni mayúsculas).
  function encajaBusqueda(agente, busqueda) {
    const q = normalizar(busqueda);
    if (!q) return true;
    const texto = normalizar(`${agente.nombre || ''} ${agente.rol || ''}`);
    return q.split(' ').every(p => texto.includes(p));
  }

  // Agentes agrupados por departamento, en el orden de `departamentos`. Dentro
  // de cada uno, el orden de la plantilla; en Mesas, por mesa (el orden de
  // `mesas`) para que cada operador salga junto a sus compañeros de mesa.
  // Un agente de un departamento desconocido va a «Otros», al final. Sin
  // búsqueda no sale ningún grupo vacío; con búsqueda, solo los que encajan.
  // → [{ id, nombre, color, frase, total, agentes }]
  function agruparEquipo(agentes, departamentos, opciones) {
    const o = opciones || {};
    const deps = Array.isArray(departamentos) ? departamentos : [];
    const ordenMesa = new Map((o.mesas || []).map((m, i) => [m.id, i]));
    const grupos = new Map(deps.map(d => [d.id, { id: d.id, nombre: d.nombre || d.id, color: colorSeguro(d.color), frase: fraseDepartamento(d), total: 0, agentes: [] }]));
    const otros = { id: 'otros', nombre: 'Otros', color: COLOR_NEUTRO, frase: '', total: 0, agentes: [] };
    (Array.isArray(agentes) ? agentes : []).forEach((a, i) => {
      if (!a || !a.id) return;
      const g = grupos.get(a.departamento) || otros;
      g.total++;
      if (encajaBusqueda(a, o.busqueda)) g.agentes.push({ a, i });
    });
    const salida = [];
    for (const g of [...grupos.values(), otros]) {
      if (g.id === 'mesas') {
        const pos = x => (ordenMesa.has(x.a.mesaId) ? ordenMesa.get(x.a.mesaId) : Infinity);
        g.agentes.sort((x, y) => pos(x) - pos(y) || x.i - y.i);
      }
      g.agentes = g.agentes.map(x => x.a);
      if (g.agentes.length) salida.push(g);
    }
    return salida;
  }

  // ---------- conversaciones del feed ----------

  // Clave de la conversación de un mensaje: su `hilo` si lo trae; si no,
  // subiendo por `respondeA` hasta el primero que se conoce; si no responde a
  // nadie conocido, él mismo. `porId`: Map id → mensaje.
  function claveHilo(m, porId) {
    if (!m) return null;
    if (m.hilo !== undefined && m.hilo !== null && m.hilo !== '') return String(m.hilo);
    let actual = m;
    for (let k = 0; k < 50; k++) {
      const padre = actual.respondeA ? porId.get(actual.respondeA) : null;
      if (!padre) break;
      if (padre.hilo !== undefined && padre.hilo !== null && padre.hilo !== '') return String(padre.hilo);
      actual = padre;
    }
    return String(actual.id);
  }

  // Mensajes (en orden de t) → conversaciones [{ clave, raiz, respuestas, ultimoT }].
  // La raíz es el mensaje cuyo id es la clave o, si no está, el primero de la
  // conversación; las respuestas, el resto por orden de t. Las conversaciones
  // van por su último mensaje: una respuesta nueva la trae abajo del todo,
  // donde se lee lo último.
  function organizarHilos(mensajes, porId) {
    const lista = (Array.isArray(mensajes) ? mensajes : []).filter(m => m && m.id);
    const indice = porId || new Map(lista.map(m => [m.id, m]));
    const bloques = new Map();
    lista.forEach((m, i) => {
      const clave = claveHilo(m, indice);
      let b = bloques.get(clave);
      if (!b) { b = { clave, mensajes: [], orden: i }; bloques.set(clave, b); }
      b.mensajes.push(m);
    });
    const salida = [];
    for (const b of bloques.values()) {
      const ms = b.mensajes.slice().sort((x, y) => x.t - y.t);
      const raiz = ms.find(m => String(m.id) === b.clave) || ms[0];
      const respuestas = ms.filter(m => m !== raiz);
      const ultimoT = ms.reduce((mx, m) => (Number.isFinite(m.t) && m.t > mx ? m.t : mx), Number.isFinite(raiz.t) ? raiz.t : -Infinity);
      salida.push({ clave: b.clave, raiz, respuestas, ultimoT, orden: b.orden });
    }
    salida.sort((x, y) => x.ultimoT - y.ultimoT || x.orden - y.orden);
    return salida.map(({ orden, ...b }) => b);
  }

  // «→ Marta» de un mensaje: a quién va (`para`, si no es a todos) o, en una
  // respuesta a una respuesta, a quién contesta. `agentes`: Map id → agente.
  function textoPara(m, agentes, porId, raiz) {
    if (!m) return null;
    const nombreDe = (id) => {
      if (id === 'humano') return 'Megáfono';
      const a = agentes && agentes.get(id);
      return a ? pila(a.nombre) : null;
    };
    const para = m.para;
    const ids = Array.isArray(para) ? para : para && para !== 'todos' ? [para] : [];
    const nombres = ids.map(id => nombreDe(id) || String(id)).filter(Boolean);
    if (nombres.length) return `→ ${nombres.join(', ')}`;
    const padre = m.respondeA && porId ? porId.get(m.respondeA) : null;
    // Quien sigue hablando tras su propio mensaje no se contesta a sí mismo.
    if (padre && raiz && padre !== raiz && padre.de !== m.de) {
      const n = nombreDe(padre.de) || pila(padre.deNombre);
      if (n) return `→ ${n}`;
    }
    return null;
  }

  return {
    TAMANOS, FRASES_DEPARTAMENTO, COLOR_MEGAFONO, COLOR_SISTEMA,
    rasgosDe, generoDe, svgCara, svgHumano, svgSistema, nodoCara, mezclar, colorSeguro,
    normalizar, pila, fraseDepartamento, encajaBusqueda, agruparEquipo,
    claveHilo, organizarHilos, textoPara,
  };
});
