// Personajes del parqué: dónde está cada agente, cómo anda entre salas y cómo
// se dibuja; y los bocadillos de lo que dice.
//
// Solo se mueven por eventos reales (§4.5 de la propuesta): cambia su `sala` o
// su `estado` en la instantánea o en un evento `agente`. Andan a 2 teselas/s
// por las puertas, siguiendo la ruta del mapa.
(function (raiz, fabrica) {
  const esNode = typeof module === 'object' && module.exports;
  const mod = fabrica(esNode ? require('./mapa.js') : raiz.Parque.mapa);
  if (esNode) module.exports = mod;
  else (raiz.Parque = raiz.Parque || {}).personajes = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (mapaMod) {
  'use strict';

  const VELOCIDAD = 2;          // teselas por segundo
  const MAX_BOCADILLOS = 5;
  const MAX_CARACTERES_LINEA = 40;
  const MAX_LINEAS = 3;

  const PIELES = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#f3cfa6', '#d7a07a'];
  const PELOS = ['#2b1d14', '#4a3121', '#6b4423', '#1c1c1c', '#a0522d', '#d6b370', '#8c8c8c', '#3d2b1f'];

  function hash(texto) {
    let h = 0x811c9dc5;
    for (const c of String(texto)) {
      h ^= c.codePointAt(0);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  // ---------- bocadillos ----------

  // 6 s + 60 ms por carácter, como mucho 12 s (propuesta-visual §4.6).
  function duracionBocadillo(texto) {
    const n = String(texto || '').length;
    return Math.min(12000, 6000 + 60 * n);
  }

  // Parte en líneas de ≤ 40 caracteres, máximo 3; si sobra, la última acaba en «…».
  function partirTexto(texto, maxCar, maxLineas) {
    const mc = maxCar || MAX_CARACTERES_LINEA;
    const ml = maxLineas || MAX_LINEAS;
    const palabras = String(texto || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    const lineas = [];
    let actual = '';
    let sobra = false;
    for (let k = 0; k < palabras.length; k++) {
      let p = palabras[k];
      while (p.length > mc) {
        // Palabra más larga que una línea: se corta a pelo.
        if (actual) { lineas.push(actual); actual = ''; }
        lineas.push(p.slice(0, mc));
        p = p.slice(mc);
      }
      if (!actual) actual = p;
      else if (actual.length + 1 + p.length <= mc) actual += ' ' + p;
      else { lineas.push(actual); actual = p; }
      if (lineas.length >= ml) { sobra = true; break; }
    }
    if (actual && lineas.length < ml) lineas.push(actual);
    else if (actual) sobra = true;
    if (lineas.length > ml) { lineas.length = ml; sobra = true; }
    if (sobra) {
      let ultima = lineas[ml - 1] || '';
      if (ultima.length >= mc) ultima = ultima.slice(0, mc - 1);
      lineas[ml - 1] = ultima.replace(/[\s.,;:]+$/, '') + '…';
    }
    return lineas;
  }

  // Como mucho 5 a la vez: primero los más importantes y, a igualdad, los más nuevos.
  function elegirBocadillos(candidatos, max) {
    return candidatos
      .slice()
      .sort((a, b) => (b.importancia || 1) - (a.importancia || 1) || b.desde - a.desde)
      .slice(0, max || MAX_BOCADILLOS);
  }

  // ---------- personaje ----------

  class Personaje {
    constructor(agente, sitio, mapa) {
      this.id = agente.id;
      this.agente = agente;
      const h = hash(agente.id);
      this.aspecto = {
        piel: PIELES[h % PIELES.length],
        pelo: PELOS[(h >>> 4) % PELOS.length],
        peinado: (h >>> 9) % 3,           // 0 corto, 1 largo, 2 moño
        desfase: (h % 1000) / 1000,       // para que no tecleen todos a la vez
      };
      this.sitio = sitio;
      this.destino = null;
      this.ruta = [];
      this.fase = 0;
      this.bocadillo = null;
      this.textoVisto = '';
      const p = this.puntoObjetivo(sitio, agente.estado, mapa);
      this.col = p.col;
      this.fila = p.fila;
      this.z = mapaMod.elevacionEn(p.col, p.fila);
      this.postura = p.postura;
      this.mira = sitio ? sitio.mira : 'S';
      this.destino = p;
    }

    get andando() { return this.ruta.length > 0; }

    // Clave de orden de pintado: la posición en el suelo.
    get clave() { return this.col + this.fila; }

    puntoObjetivo(sitio, estado, mapa) {
      if (!sitio) return { col: this.col || 10, fila: this.fila || 10, postura: 'de_pie' };
      if (estado === 'de_pie') {
        const p = mapaMod.posicionDePie(mapa, sitio);
        return { col: p.col, fila: p.fila, postura: 'de_pie' };
      }
      return { col: sitio.col, fila: sitio.fila, postura: sitio.postura === 'sentado' ? 'sentado' : 'de_pie' };
    }

    // Nuevo sitio o estado. Si el punto cambia, calcula la ruta (o salta, con
    // movimiento reducido o en la primera carga).
    fijarDestino(sitio, agente, mapa, opciones) {
      const o = opciones || {};
      this.agente = agente;
      this.sitio = sitio;
      const p = this.puntoObjetivo(sitio, agente.estado, mapa);
      const mismo = this.destino && Math.abs(this.destino.col - p.col) < 1e-6 && Math.abs(this.destino.fila - p.fila) < 1e-6;
      this.destino = p;
      if (mismo) {
        if (!this.andando) { this.postura = p.postura; this.mira = sitio ? sitio.mira : this.mira; }
        return false;
      }
      if (o.instantaneo) {
        this.col = p.col; this.fila = p.fila; this.ruta = [];
        this.z = mapaMod.elevacionEn(p.col, p.fila);
        this.postura = p.postura;
        this.mira = sitio ? sitio.mira : this.mira;
        return true;
      }
      const r = mapaMod.ruta(mapa, { col: this.col, fila: this.fila }, p);
      this.ruta = r.slice(1);
      this.postura = 'de_pie';
      return true;
    }

    actualizar(dt) {
      if (!this.ruta.length) return;
      let resto = VELOCIDAD * dt;
      while (resto > 0 && this.ruta.length) {
        const obj = this.ruta[0];
        const dc = obj.col - this.col;
        const df = obj.fila - this.fila;
        const d = Math.hypot(dc, df);
        if (d > 1e-6) this.mira = direccion(dc, df);
        if (d <= resto) {
          this.col = obj.col; this.fila = obj.fila;
          this.ruta.shift();
          resto -= d;
        } else {
          this.col += (dc / d) * resto;
          this.fila += (df / d) * resto;
          resto = 0;
        }
      }
      this.fase += dt * 9;
      this.z = mapaMod.elevacionEn(this.col, this.fila);
      if (!this.ruta.length && this.destino) {
        this.postura = this.destino.postura;
        if (this.sitio) this.mira = this.sitio.mira;
      }
    }

    decir(texto, importancia, ahora) {
      if (!texto) return;
      this.bocadillo = { texto: String(texto), importancia: importancia || 1, desde: ahora, hasta: ahora + duracionBocadillo(texto) };
    }
  }

  // Dirección a la que mira quien se mueve (dc, df).
  function direccion(dc, df) {
    if (Math.abs(dc) >= Math.abs(df)) return dc >= 0 ? 'E' : 'O';
    return df >= 0 ? 'S' : 'N';
  }

  // ---------- elenco: todos los personajes ----------

  function crearElenco() {
    const personajes = new Map();
    return {
      personajes,
      // Crea los nuevos donde les toca, quita a los que ya no están y manda a
      // cada uno a su sitio.
      sincronizar(agentes, mapa, asignacion, opciones) {
        const o = opciones || {};
        const vivos = new Set();
        for (const a of agentes || []) {
          vivos.add(a.id);
          const sitio = asignacion.get(a.id);
          const agente = o.forzarDePie ? Object.assign({}, a, { estado: 'de_pie' }) : a;
          let p = personajes.get(a.id);
          if (!p) {
            p = new Personaje(agente, sitio, mapa);
            personajes.set(a.id, p);
          } else {
            p.fijarDestino(sitio, agente, mapa, { instantaneo: o.instantaneo });
          }
        }
        for (const id of Array.from(personajes.keys())) if (!vivos.has(id)) personajes.delete(id);
      },
      actualizar(dt) { for (const p of personajes.values()) p.actualizar(dt); },
      lista() { return Array.from(personajes.values()); },
    };
  }

  // ---------- dibujo (coordenadas de mundo) ----------

  const P = (c, f, z) => ({ x: (c - f) * 32, y: (c + f) * 16 - (z || 0) });
  const ESCALA = 1.15;

  function oscurecer(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const f = x => Math.max(0, Math.min(255, Math.round(x * (1 - k))));
    return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
  }
  function aclarar(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const f = x => Math.round(x + (255 - x) * k);
    return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
  }

  function rect(ctx, x, y, w, h, r, relleno, borde) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
    ctx.fillStyle = relleno;
    ctx.fill();
    if (borde) { ctx.strokeStyle = borde; ctx.stroke(); }
  }

  // Cuadro envolvente en mundo (para saber si el ratón le toca).
  function cajaPersonaje(p) {
    const b = P(p.col, p.fila, p.z);
    const alto = (p.postura === 'sentado' ? 26 : 30) * ESCALA;
    return { x0: b.x - 8 * ESCALA, x1: b.x + 8 * ESCALA, y0: b.y - alto - 2, y1: b.y + 3 };
  }

  // Punto sobre la cabeza (para anclar el bocadillo).
  function cabeza(p) {
    const b = P(p.col, p.fila, p.z);
    return { x: b.x, y: b.y - (p.postura === 'sentado' ? 30 : 34) * ESCALA };
  }

  function pintarPersonaje(ctx, p, o) {
    const t = o.t || 0;
    const color = o.color || '#3b82f6';
    const mov = o.movimiento !== false;
    const b = P(p.col, p.fila, p.z);
    const sentado = p.postura === 'sentado' && !p.andando;
    const frente = p.mira === 'S' || p.mira === 'E';
    const volteo = p.mira === 'O' || p.mira === 'S' ? -1 : 1;
    const estado = p.agente && p.agente.estado;
    const hablando = p.bocadillo && p.bocadillo.hasta > o.ahora;

    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.scale(ESCALA, ESCALA);
    if (estado === 'banquillo') ctx.globalAlpha = 0.45;
    ctx.lineWidth = 0.9;
    const contorno = 'rgba(14, 18, 34, 0.6)';

    // Anillo de seleccionado, bajo los pies.
    if (o.seleccionado) {
      const r = 9 + (mov ? Math.sin(t / 220) * 1.2 : 0);
      ctx.fillStyle = 'rgba(251, 191, 36, 0.22)';
      ctx.beginPath(); ctx.ellipse(0, 0, r + 2, (r + 2) / 2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.ellipse(0, 0, r, r / 2, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 0.9;
    }
    // Sombra.
    if (!sentado) {
      ctx.fillStyle = 'rgba(15, 20, 40, 0.22)';
      ctx.beginPath(); ctx.ellipse(0, 0, 6.5, 3.2, 0, 0, Math.PI * 2); ctx.fill();
    }

    const andar = p.andando && mov;
    const paso = andar ? Math.sin(p.fase) : 0;
    const bote = andar ? Math.abs(Math.sin(p.fase)) * 1.1 : 0;
    const cadera = sentado ? -9.5 : -7 - bote;
    const pantalon = '#27304a';

    // Piernas.
    if (!sentado) {
      rect(ctx, -3.6, cadera, 3, 7 + (paso > 0 ? -paso * 1.4 : 0) + bote, 1, pantalon, null);
      rect(ctx, 0.6, cadera, 3, 7 + (paso < 0 ? paso * 1.4 : 0) + bote, 1, pantalon, null);
      rect(ctx, -3.9, -1.6 - (paso > 0 ? paso * 1.4 : 0), 3.6, 1.8, 0.8, '#151a2a', null);
      rect(ctx, 0.3, -1.6 - (paso < 0 ? -paso * 1.4 : 0), 3.6, 1.8, 0.8, '#151a2a', null);
    } else if (frente) {
      // Sentado de cara: se ven los muslos hacia delante.
      rect(ctx, -4, cadera - 1, 8, 3.2, 1.2, pantalon, null);
      rect(ctx, -3.6, cadera + 2, 2.8, 6, 1, pantalon, null);
      rect(ctx, 0.8, cadera + 2, 2.8, 6, 1, pantalon, null);
    }

    // Tronco con volumen: mitad clara, mitad oscura.
    const alto = 11;
    const yTronco = cadera - alto;
    rect(ctx, -5, yTronco, 10, alto + 1, 3, color, contorno);
    ctx.save();
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-5, yTronco, 10, alto + 1, 3); else ctx.rect(-5, yTronco, 10, alto + 1);
    ctx.clip();
    ctx.fillStyle = oscurecer(color, 0.22);
    ctx.fillRect(volteo > 0 ? 1 : -5, yTronco, 4, alto + 1);
    ctx.fillStyle = aclarar(color, 0.18);
    ctx.fillRect(-5, yTronco, 10, 1.6);
    ctx.restore();
    if (frente) {
      // Cuello de la camisa.
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath(); ctx.moveTo(-2, yTronco + 0.4); ctx.lineTo(0, yTronco + 2.6); ctx.lineTo(2, yTronco + 0.4); ctx.closePath(); ctx.fill();
    }

    // Brazos.
    const brazo = oscurecer(color, 0.12);
    const trabajando = sentado && (estado === 'trabajando' || !estado);
    if (trabajando && !frente) {
      // Tecleo: codos que suben y bajan a ráfagas.
      const r = mov ? rafaga(t, p.aspecto.desfase) : 0;
      const a1 = mov ? Math.sin(t / 55 + p.aspecto.desfase * 10) * r : 0;
      const a2 = mov ? Math.sin(t / 55 + 2 + p.aspecto.desfase * 10) * r : 0;
      rect(ctx, -7, yTronco + 2 + a1, 2.6, 6, 1.2, brazo, contorno);
      rect(ctx, 4.4, yTronco + 2 + a2, 2.6, 6, 1.2, brazo, contorno);
    } else if (sentado) {
      rect(ctx, -6.8, yTronco + 2, 2.4, 7, 1.2, brazo, contorno);
      rect(ctx, 4.4, yTronco + 2, 2.4, 7, 1.2, brazo, contorno);
      ctx.fillStyle = p.aspecto.piel;
      ctx.beginPath(); ctx.arc(-5.6, yTronco + 9.4, 1.3, 0, Math.PI * 2); ctx.arc(5.6, yTronco + 9.4, 1.3, 0, Math.PI * 2); ctx.fill();
    } else {
      const s = andar ? paso * 1.8 : 0;
      rect(ctx, -7, yTronco + 1.5 + s, 2.4, 8, 1.2, brazo, contorno);
      rect(ctx, 4.6, yTronco + 1.5 - s, 2.4, 8, 1.2, brazo, contorno);
      ctx.fillStyle = p.aspecto.piel;
      ctx.beginPath(); ctx.arc(-5.8, yTronco + 10 + s, 1.3, 0, Math.PI * 2); ctx.arc(5.8, yTronco + 10 - s, 1.3, 0, Math.PI * 2); ctx.fill();
    }

    // Cabeza.
    const asiente = hablando && mov ? Math.sin(t / 140) * 0.6 : 0;
    const cy = yTronco - 4.6 + asiente;
    ctx.fillStyle = p.aspecto.piel;
    ctx.beginPath(); ctx.arc(0, cy, 4.7, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = contorno; ctx.stroke();
    ctx.fillStyle = p.aspecto.pelo;
    if (frente) {
      ctx.beginPath(); ctx.arc(0, cy - 0.6, 4.9, Math.PI * 1.02, Math.PI * 1.98); ctx.closePath(); ctx.fill();
      if (p.aspecto.peinado === 1) { rect(ctx, -5.2, cy - 2, 2, 6.5, 1, p.aspecto.pelo, null); rect(ctx, 3.2, cy - 2, 2, 6.5, 1, p.aspecto.pelo, null); }
      ctx.fillStyle = '#1b1b24';
      ctx.fillRect(-2.2 * volteo - 0.6, cy + 0.2, 1.3, 1.5);
      ctx.fillRect(1.2 * volteo - 0.6, cy + 0.2, 1.3, 1.5);
      if (hablando) { ctx.fillStyle = '#7a2e2e'; ctx.fillRect(-0.9, cy + 2.6, 1.8, 0.9 + Math.abs(asiente)); }
    } else {
      ctx.beginPath(); ctx.arc(0, cy - 0.3, 4.85, Math.PI * 0.92, Math.PI * 2.08); ctx.closePath(); ctx.fill();
      if (p.aspecto.peinado === 1) rect(ctx, -4.4, cy, 8.8, 5.5, 2, p.aspecto.pelo, null);
      if (p.aspecto.peinado === 2) { ctx.beginPath(); ctx.arc(0, cy - 4.8, 2.1, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.restore();
  }

  // Ráfagas de tecleo: a ratos teclea, a ratos no (si no, parece una máquina).
  function rafaga(t, desfase) {
    const x = Math.sin(t / 1300 + desfase * 17) + Math.sin(t / 530 + desfase * 5);
    return x > 0.2 ? 1.1 : 0.15;
  }

  // ---------- bocadillos (coordenadas de pantalla CSS) ----------

  function medirBocadillo(ctx, lineas) {
    let w = 0;
    for (const l of lineas) w = Math.max(w, ctx.measureText(l).width);
    return { w: Math.ceil(w) + 18, h: lineas.length * 14 + 11 };
  }

  // Coloca y pinta los bocadillos elegidos sin que se pisen: si uno choca con
  // otro ya puesto, sube.
  function pintarBocadillos(ctx, elegidos, o) {
    const puestos = [];
    ctx.font = `500 11px ${o.fuente || 'system-ui, sans-serif'}`;
    ctx.textBaseline = 'alphabetic';
    const orden = elegidos.slice().sort((a, b) => b.y - a.y);
    for (const e of orden) {
      const lineas = partirTexto(e.texto);
      const m = medirBocadillo(ctx, lineas);
      let x = Math.round(e.x - m.w / 2);
      let y = Math.round(e.y - m.h - 9);
      x = Math.max(6, Math.min(o.ancho - m.w - 6, x));
      for (let intento = 0; intento < 12; intento++) {
        const choque = puestos.find(r => x < r.x + r.w + 4 && x + m.w + 4 > r.x && y < r.y + r.h + 4 && y + m.h + 4 > r.y);
        if (!choque) break;
        y = choque.y - m.h - 6;
      }
      y = Math.max(4, y);
      puestos.push({ x, y, w: m.w, h: m.h });
      const vida = Math.min(1, (o.ahora - e.desde) / 160, (e.hasta - o.ahora) / 400);
      ctx.save();
      ctx.globalAlpha = o.movimiento === false ? 1 : Math.max(0, vida);
      // Sombra, cuerpo, cola.
      ctx.fillStyle = 'rgba(8, 12, 28, 0.28)';
      rect(ctx, x + 1, y + 2, m.w, m.h, 7, 'rgba(8, 12, 28, 0.28)', null);
      rect(ctx, x, y, m.w, m.h, 7, 'rgba(255,255,255,0.97)', 'rgba(15,20,36,0.18)');
      const colaX = Math.max(x + 10, Math.min(x + m.w - 10, e.x));
      ctx.fillStyle = 'rgba(255,255,255,0.97)';
      ctx.beginPath(); ctx.moveTo(colaX - 5, y + m.h - 0.5); ctx.lineTo(e.x, Math.min(e.y - 1, y + m.h + 8)); ctx.lineTo(colaX + 5, y + m.h - 0.5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = e.color || '#3b82f6';
      rect(ctx, x + 4, y + 5, 2.5, m.h - 10, 1.2, e.color || '#3b82f6', null);
      ctx.fillStyle = '#111827';
      lineas.forEach((l, k) => ctx.fillText(l, x + 11, y + 16 + k * 14));
      ctx.restore();
    }
    return puestos;
  }

  return {
    VELOCIDAD, MAX_BOCADILLOS, MAX_CARACTERES_LINEA, MAX_LINEAS, ESCALA,
    Personaje, crearElenco, duracionBocadillo, partirTexto, elegirBocadillos, direccion,
    pintarPersonaje, pintarBocadillos, cajaPersonaje, cabeza, hash,
  };
});
