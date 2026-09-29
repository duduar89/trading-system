// Dibujo procedural del parqué en Canvas 2D (sin imágenes).
//
// Casi todo se pinta en coordenadas de MUNDO (zoom 1): quien llama deja puesta
// en el contexto la transformación de la cámara. Las texturas de las pantallas
// se pintan en su propio canvas y se pegan sobre la pared con una transformación
// afín, así que el texto sale inclinado como en la referencia.
//
// Luz desde arriba a la izquierda: tapa clara, cara sur (+fila) media, cara este (+col) oscura.
(function (raiz, fabrica) {
  const esNode = typeof module === 'object' && module.exports;
  const mod = fabrica(esNode ? require('./cifras.js') : raiz.Parque.cifras, esNode ? require('./mapa.js') : raiz.Parque.mapa);
  if (esNode) module.exports = mod;
  else (raiz.Parque = raiz.Parque || {}).dibujo = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (cifras, mapaMod) {
  'use strict';

  const P = (c, f, z) => ({ x: (c - f) * 32, y: (c + f) * 16 - (z || 0) });
  const FUENTE = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const BORDE = 'rgba(16, 20, 38, 0.32)';

  const PALETA = {
    fondo: '#0f1424', panel: '#151b2e', borde: '#232b45', texto: '#e6e9f2', secundario: '#8a93b0',
    positivo: '#22c55e', negativo: '#ef4444', aviso: '#f59e0b', lila: '#8b5cf6', azul: '#3b82f6',
    pared: '#3a4466', paredOscura: '#2b3350', paredTapa: '#232a44',
  };

  // ---------- color ----------
  const cacheRgb = new Map();
  function rgbDe(hex) {
    if (cacheRgb.has(hex)) return cacheRgb.get(hex);
    let h = String(hex).replace('#', '');
    if (h.length === 3) h = h.split('').map(x => x + x).join('');
    const n = parseInt(h, 16);
    const v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    cacheRgb.set(hex, v);
    return v;
  }
  const cacheTono = new Map();
  // k > 0 aclara hacia blanco, k < 0 oscurece hacia negro.
  function tono(hex, k) {
    const clave = hex + '|' + k;
    if (cacheTono.has(clave)) return cacheTono.get(clave);
    const [r, g, b] = rgbDe(hex);
    const f = k >= 0 ? (x => Math.round(x + (255 - x) * k)) : (x => Math.round(x * (1 + k)));
    const s = `rgb(${f(r)},${f(g)},${f(b)})`;
    cacheTono.set(clave, s);
    return s;
  }
  function rgba(hex, a) {
    const [r, g, b] = rgbDe(hex);
    return `rgba(${r},${g},${b},${a})`;
  }

  // ---------- primitivas ----------
  function poligono(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
  }

  function cara(ctx, pts, relleno, borde) {
    poligono(ctx, pts);
    ctx.fillStyle = relleno;
    ctx.fill();
    if (borde) {
      ctx.strokeStyle = borde;
      ctx.stroke();
    }
  }

  // Prisma recto con base [c0,c1]×[f0,f1] y alturas z0..z1.
  function caja(ctx, c0, f0, c1, f1, z0, z1, color, op) {
    const o = op || {};
    const borde = o.sinBorde ? null : (o.borde || BORDE);
    ctx.lineWidth = o.grosor || 1;
    ctx.lineJoin = 'round';
    if (z1 > z0) {
      if (!o.sinSur) cara(ctx, [P(c0, f1, z0), P(c1, f1, z0), P(c1, f1, z1), P(c0, f1, z1)], o.sur || tono(color, -0.1), borde);
      if (!o.sinEste) cara(ctx, [P(c1, f0, z0), P(c1, f1, z0), P(c1, f1, z1), P(c1, f0, z1)], o.este || tono(color, -0.26), borde);
    }
    if (!o.sinTapa) cara(ctx, [P(c0, f0, z1), P(c1, f0, z1), P(c1, f1, z1), P(c0, f1, z1)], o.tapa || tono(color, 0.08), borde);
  }

  function elipseSuelo(ctx, c, f, z, radio, relleno) {
    const p = P(c, f, z);
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, radio * 45.25, radio * 22.63, 0, 0, Math.PI * 2);
    ctx.fillStyle = relleno;
    ctx.fill();
  }

  // Sombra suave de un mueble sobre el suelo (desplazada hacia la luz contraria).
  function sombra(ctx, c0, f0, c1, f1, z, fuerza) {
    const d = 0.1;
    cara(ctx, [P(c0 + d, f0 + d, z), P(c1 + d * 1.6, f0 + d, z), P(c1 + d * 1.6, f1 + d * 1.6, z), P(c0 + d, f1 + d * 1.6, z)],
      `rgba(20, 24, 44, ${fuerza || 0.13})`, null);
  }

  // ---------- planos de pared (para pegar texturas y dibujos) ----------

  // Devuelve el marco afín de un rectángulo sobre una pared: origen arriba a la
  // izquierda (visto en pantalla), eje u a lo largo y eje v hacia abajo.
  function marcoPared(pared, desde, hasta, z0, z1, eje, en) {
    let O; let U; let V;
    if (pared === 'fila0') {
      O = P(desde, 0, z1); U = P(hasta, 0, z1); V = P(desde, 0, z0);
    } else if (pared === 'col0') {
      O = P(0, hasta, z1); U = P(0, desde, z1); V = P(0, hasta, z0);
    } else if (eje === 'fila') {
      const f = en + mapaMod.GROSOR_PARED / 2 + 0.01;
      O = P(desde, f, z1); U = P(hasta, f, z1); V = P(desde, f, z0);
    } else {
      const c = en + mapaMod.GROSOR_PARED / 2 + 0.01;
      O = P(c, hasta, z1); U = P(c, desde, z1); V = P(c, hasta, z0);
    }
    return { O, U: { x: U.x - O.x, y: U.y - O.y }, V: { x: V.x - O.x, y: V.y - O.y } };
  }

  // Aplica el marco para dibujar en un espacio local de ancho×alto unidades.
  function conMarco(ctx, marco, ancho, alto, fn) {
    ctx.save();
    ctx.transform(marco.U.x / ancho, marco.U.y / ancho, marco.V.x / alto, marco.V.y / alto, marco.O.x, marco.O.y);
    fn(ctx);
    ctx.restore();
  }

  function rectRedondo(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  // Pseudoaleatorio determinista (para rascacielos, libros, etc.).
  function azar(semilla) {
    let s = semilla >>> 0 || 1;
    return () => {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- capa estática: edificio, suelos, paredes del fondo ----------

  function pintarEdificio(ctx, mapa, opciones) {
    const o = opciones || {};
    const C = mapa.cols;
    const F = mapa.filas;
    // Sombra del edificio sobre el fondo: capas translúcidas cada vez más
    // anchas. Parece difuminada y cuesta mucho menos que shadowBlur, que en
    // pantallas retina se comía el fotograma al arrastrar la cámara.
    for (let k = 6; k >= 1; k--) {
      const d = k * 0.32;
      const baja = -16 - k * 5;
      cara(ctx, [P(-d, -d, baja), P(C + d, -d, baja), P(C + d, F + d, baja), P(-d, F + d, baja)], `rgba(4, 6, 16, ${0.07 + (6 - k) * 0.012})`, null);
    }
    // Losa: el suelo tiene grosor, como una maqueta.
    caja(ctx, -0.25, -0.25, C, F, -16, 0, '#2a3354', { sur: '#262f4d', este: '#1c2440', tapa: '#2a3354', borde: 'rgba(8,10,22,0.5)' });
    // Suelos.
    for (const id of mapaMod.ORDEN_SALAS) pintarSuelo(ctx, mapa.salas[id]);
    // Alfombras y rótulos en el suelo.
    for (const m of mapa.muebles) if (m.tipo === 'alfombra') pintarAlfombra(ctx, m);
    // Sombras de los muebles (en el suelo, debajo de todo).
    for (const m of mapa.muebles) {
      if (!m.bloquea || m.tipo === 'alfombra') continue;
      sombra(ctx, m.c0, m.f0, m.c1, m.f1, m.z, m.tipo === 'planta' ? 0.1 : 0.14);
    }
    for (const id of mapaMod.ORDEN_SALAS) rotuloSuelo(ctx, mapa.salas[id]);
    // Paredes del fondo (exteriores) y lo que cuelga de ellas.
    pintarParedesFondo(ctx, mapa, o);
  }

  const DETALLE_SUELO = {
    parque: 'moqueta', direccion: 'madera', macro: 'tarima', analisis: 'baldosa', laboratorio: 'baldosa',
    riesgos: 'baldosa', comite: 'madera', descanso: 'baldosa',
  };

  function pintarSuelo(ctx, s) {
    const z = s.elevacion || 0;
    if (z > 0) {
      // Tarima: se ven sus caras en el borde de delante.
      caja(ctx, s.c0, s.f0, s.c1, s.f1, 0, z, tono(s.suelo, -0.25), { sinTapa: true, borde: 'rgba(16,20,38,0.35)' });
    }
    cara(ctx, [P(s.c0, s.f0, z), P(s.c1, s.f0, z), P(s.c1, s.f1, z), P(s.c0, s.f1, z)], s.suelo, null);
    const tipo = DETALLE_SUELO[s.id];
    ctx.lineWidth = 1;
    if (tipo === 'madera' || tipo === 'tarima') {
      // Lamas a lo largo de las columnas, con juntas escalonadas.
      ctx.strokeStyle = 'rgba(60, 30, 10, 0.16)';
      ctx.beginPath();
      for (let f = s.f0 + 0.33; f < s.f1; f += 0.33) {
        const a = P(s.c0, f, z); const b = P(s.c1, f, z);
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      }
      let k = 0;
      for (let f = s.f0; f < s.f1 - 0.01; f += 0.33, k++) {
        for (let c = s.c0 + (k % 3) * 0.7 + 0.6; c < s.c1; c += 2.1) {
          const a = P(c, f, z); const b = P(c, Math.min(s.f1, f + 0.33), z);
          ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        }
      }
      ctx.stroke();
    } else {
      // Baldosas o moqueta: damero muy suave y juntas.
      // Un solo trazado para todo el damero: cientos de rellenos sueltos cuestan más.
      ctx.fillStyle = tipo === 'moqueta' ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.14)';
      ctx.beginPath();
      for (let c = s.c0; c < s.c1; c++) {
        for (let f = s.f0; f < s.f1; f++) {
          if ((c + f) % 2 !== 0) continue;
          const a = P(c, f, z); const b = P(c + 1, f, z); const d = P(c + 1, f + 1, z); const e = P(c, f + 1, z);
          ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(d.x, d.y); ctx.lineTo(e.x, e.y); ctx.closePath();
        }
      }
      ctx.fill();
      ctx.strokeStyle = tipo === 'moqueta' ? 'rgba(40, 50, 80, 0.07)' : 'rgba(40, 50, 80, 0.1)';
      ctx.beginPath();
      for (let c = s.c0; c <= s.c1; c++) { const a = P(c, s.f0, z); const b = P(c, s.f1, z); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
      for (let f = s.f0; f <= s.f1; f++) { const a = P(s.c0, f, z); const b = P(s.c1, f, z); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
      ctx.stroke();
    }
    if (s.id === 'parque') {
      // Pasillo central más claro, hacia la pantalla gigante.
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      poligono(ctx, [P(0.4, 1.2, 0), P(19.6, 1.2, 0), P(19.6, 2.6, 0), P(0.4, 2.6, 0)]);
      ctx.fill();
    }
  }

  function pintarAlfombra(ctx, m) {
    const z = m.z || 0;
    cara(ctx, [P(m.c0, m.f0, z), P(m.c1, m.f0, z), P(m.c1, m.f1, z), P(m.c0, m.f1, z)], m.color, 'rgba(0,0,0,0.12)');
    const d = 0.18;
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 1.2;
    poligono(ctx, [P(m.c0 + d, m.f0 + d, z), P(m.c1 - d, m.f0 + d, z), P(m.c1 - d, m.f1 - d, z), P(m.c0 + d, m.f1 - d, z)]);
    ctx.stroke();
  }

  // Nombre de la sala pintado en el suelo, cerca de su borde delantero.
  function rotuloSuelo(ctx, s) {
    const z = s.elevacion || 0;
    const texto = s.nombre.toUpperCase();
    // Marco del plano del suelo: u a lo largo de las columnas, v a lo largo de las filas.
    const f = s.f1 - 0.55;
    const c = s.c0 + 0.45;
    const O = P(c, f, z);
    ctx.save();
    ctx.transform(32 / 40, 16 / 40, -32 / 40, 16 / 40, O.x, O.y);
    ctx.font = `800 18px ${FUENTE}`;
    ctx.fillStyle = s.id === 'parque' ? 'rgba(40, 52, 90, 0.16)' : 'rgba(40, 30, 50, 0.2)';
    ctx.textBaseline = 'middle';
    ctx.fillText(texto, 0, 0);
    ctx.restore();
  }

  function pintarParedesFondo(ctx, mapa, o) {
    const C = mapa.cols;
    const F = mapa.filas;
    const H = mapaMod.ALTO_PARED_EXTERIOR;
    const G = 0.25;
    // Pared izquierda (col 0) y pared derecha del fondo (fila 0).
    const cara0 = '#3d4870';
    caja(ctx, -G, 0, 0, F, 0, H, cara0, { sinSur: false, este: tono(cara0, 0.02), tapa: PALETA.paredTapa, sur: tono(cara0, -0.2) });
    caja(ctx, -G, -G, C, 0, 0, H, cara0, { sur: tono(cara0, 0.06), este: tono(cara0, -0.25), tapa: PALETA.paredTapa });
    // Zócalo oscuro y línea de luz en lo alto: dan escala a la pared.
    ctx.lineWidth = 1;
    cara(ctx, [P(0, 0, 0), P(0, F, 0), P(0, F, 6), P(0, 0, 6)], 'rgba(10,12,24,0.35)', null);
    cara(ctx, [P(0, 0, 0), P(C, 0, 0), P(C, 0, 6), P(0, 0, 6)], 'rgba(10,12,24,0.35)', null);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    let a = P(0, F, H - 3); let b = P(0, 0, H - 3); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    a = P(0, 0, H - 3); b = P(C, 0, H - 3); ctx.lineTo(b.x, b.y);
    ctx.stroke();
    // Pilares donde un tabique interior toca la pared del fondo.
    for (const p of mapa.paredes) {
      if (p.eje === 'col' && p.desde === 0) caja(ctx, p.en - 0.14, -0.02, p.en + 0.14, 0.12, 0, H, '#465281');
      if (p.eje === 'fila' && p.desde === 0) caja(ctx, -0.02, p.en - 0.14, 0.12, p.en + 0.14, 0, H, '#465281');
    }
    for (const d of mapa.decoraciones) {
      if (d.tipo === 'ventana') pintarVentana(ctx, d, o.ahora || Date.now());
      else if (d.tipo === 'relojes') pintarRelojes(ctx, d, o.ahora || Date.now());
      else if (d.tipo === 'rotuloParque') pintarRotuloParque(ctx, d);
      else if (d.tipo === 'pantallaGigante' || d.tipo === 'limites') pintarMarcoPantalla(ctx, d);
    }
    // Muebles pegados al fondo que nadie puede tapar por detrás.
  }

  function pintarMarcoPantalla(ctx, d) {
    const m = marcoPared(d.pared, d.desde - 0.12, d.hasta + 0.12, d.z0 - 5, d.z1 + 5);
    conMarco(ctx, m, 100, 100, (c) => {
      c.fillStyle = '#10152a';
      rectRedondo(c, 0, 0, 100, 100, 2);
      c.fill();
    });
    // Soportes bajo la pantalla gigante.
    if (d.tipo === 'pantallaGigante') {
      for (const x of [d.desde + 1.5, d.hasta - 1.5]) {
        const top = P(x, 0.02, d.z0 - 5); const bot = P(x, 0.02, 4);
        ctx.strokeStyle = '#1b2240';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(bot.x, bot.y); ctx.stroke();
      }
    }
  }

  function colorCielo(hora) {
    if (hora >= 8 && hora < 18) return ['#7fb4f0', '#cfe6ff', '#6d80a8', false];
    if ((hora >= 18 && hora < 21) || (hora >= 6 && hora < 8)) return ['#2d3f75', '#f3a46e', '#27304f', true];
    return ['#070d24', '#1b2a58', '#141b33', true];
  }

  function pintarVentana(ctx, d, ahora) {
    const hora = new Date(ahora).getHours();
    const [arriba, abajo, edificios, luces] = colorCielo(hora);
    const m = marcoPared(d.pared, d.desde, d.hasta, d.z0, d.z1);
    const W = 200; const Hh = 110;
    conMarco(ctx, m, W, Hh, (c) => {
      const g = c.createLinearGradient(0, 0, 0, Hh);
      g.addColorStop(0, arriba); g.addColorStop(1, abajo);
      c.fillStyle = g;
      c.fillRect(0, 0, W, Hh);
      const r = azar(Math.round(d.desde * 97 + d.hasta * 13));
      let x = -4;
      while (x < W) {
        const w = 14 + r() * 26;
        const h = 22 + r() * 62;
        c.fillStyle = edificios;
        c.fillRect(x, Hh - h, w - 2, h);
        if (luces) {
          c.fillStyle = 'rgba(255, 214, 120, 0.8)';
          for (let yy = Hh - h + 5; yy < Hh - 4; yy += 7) {
            for (let xx = x + 3; xx < x + w - 5; xx += 6) if (r() < 0.35) c.fillRect(xx, yy, 2.4, 3);
          }
        }
        x += w;
      }
      // Marco y parteluces.
      c.strokeStyle = '#d4dbea';
      c.lineWidth = 5;
      c.strokeRect(2.5, 2.5, W - 5, Hh - 5);
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(W / 2, 0); c.lineTo(W / 2, Hh);
      c.moveTo(0, Hh * 0.42); c.lineTo(W, Hh * 0.42);
      c.stroke();
      // Reflejo.
      c.fillStyle = 'rgba(255,255,255,0.10)';
      c.beginPath(); c.moveTo(20, 0); c.lineTo(60, 0); c.lineTo(10, Hh); c.lineTo(-30, Hh); c.closePath(); c.fill();
    });
  }

  const CIUDADES = [['NUEVA YORK', 'America/New_York'], ['LONDRES', 'Europe/London'], ['MADRID', 'Europe/Madrid'], ['TOKIO', 'Asia/Tokyo']];
  function pintarRelojes(ctx, d, ahora) {
    const m = marcoPared(d.pared, d.desde, d.hasta, d.z0, d.z1);
    const W = 400; const Hh = 70;
    conMarco(ctx, m, W, Hh, (c) => {
      CIUDADES.forEach(([nombre, zona], i) => {
        const x = i * 100 + 4;
        c.fillStyle = '#0d1226';
        rectRedondo(c, x, 4, 92, 62, 6);
        c.fill();
        c.fillStyle = '#8a93b0';
        c.font = `700 11px ${FUENTE}`;
        c.textAlign = 'center';
        c.fillText(nombre, x + 46, 22);
        c.fillStyle = '#ffb547';
        c.font = `700 24px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
        let h = '--:--';
        try { h = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: zona }).format(new Date(ahora)); } catch (_) { /* zona no disponible */ }
        c.fillText(h, x + 46, 54);
      });
      c.textAlign = 'left';
    });
  }

  function pintarRotuloParque(ctx, d) {
    const m = marcoPared(d.pared, d.desde, d.hasta, d.z0, d.z1);
    conMarco(ctx, m, 150, 60, (c) => {
      c.fillStyle = '#1d4ed8';
      rectRedondo(c, 0, 0, 150, 60, 8);
      c.fill();
      c.fillStyle = '#fff';
      c.font = `800 22px ${FUENTE}`;
      c.textAlign = 'center';
      c.fillText('PARQUÉ', 75, 38);
      c.textAlign = 'left';
    });
  }

  // Textura pegada a una pared (pantalla gigante, límites…), cada fotograma.
  function pegarTextura(ctx, d, textura) {
    if (!textura) return;
    const m = marcoPared(d.pared, d.desde, d.hasta, d.z0, d.z1, d.eje, d.en);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.transform(m.U.x / textura.width, m.U.y / textura.width, m.V.x / textura.height, m.V.y / textura.height, m.O.x, m.O.y);
    ctx.drawImage(textura, 0, 0);
    ctx.restore();
  }

  // ---------- tabiques ----------

  function pintarTrozoPared(ctx, w) {
    const color = PALETA.pared;
    caja(ctx, w.c0, w.f0, w.c1, w.f1, 0, w.alto, color, { tapa: PALETA.paredTapa, sur: '#414d78', este: '#343e62', borde: 'rgba(10,12,26,0.45)' });
    // Jambas de las puertas: un poco más altas y claras, para que se lean los huecos.
    const jamba = (c0, f0, c1, f1) => caja(ctx, c0, f0, c1, f1, 0, w.alto + 5, '#5a6795', { tapa: '#6f7cab' });
    const g = 0.12;
    if (w.c1 - w.c0 < w.f1 - w.f0) {
      if (w.inicioHueco) jamba(w.c0 - 0.02, w.f0, w.c1 + 0.02, w.f0 + g);
      if (w.finHueco) jamba(w.c0 - 0.02, w.f1 - g, w.c1 + 0.02, w.f1);
    } else {
      if (w.inicioHueco) jamba(w.c0, w.f0 - 0.02, w.c0 + g, w.f1 + 0.02);
      if (w.finHueco) jamba(w.c1 - g, w.f0 - 0.02, w.c1, w.f1 + 0.02);
    }
  }

  // Cristal bajo en los bordes delanteros: cierra el edificio sin tapar nada.
  function pintarBordeDelantero(ctx, mapa) {
    const C = mapa.cols; const F = mapa.filas;
    ctx.lineWidth = 1;
    cara(ctx, [P(0, F, 0), P(C, F, 0), P(C, F, 12), P(0, F, 12)], 'rgba(170, 200, 255, 0.10)', 'rgba(190, 215, 255, 0.28)');
    cara(ctx, [P(C, 0, 0), P(C, F, 0), P(C, F, 12), P(C, 0, 12)], 'rgba(170, 200, 255, 0.07)', 'rgba(190, 215, 255, 0.24)');
    ctx.strokeStyle = 'rgba(220, 235, 255, 0.45)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    let a = P(0, F, 12); let b = P(C, F, 12); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    a = P(C, 0, 12); ctx.lineTo(a.x, a.y);
    ctx.stroke();
  }

  // ---------- monitores ----------

  const COLORES_MONITOR = {
    verde: ['#15803d', '#bbf7d0'],
    rojo: ['#b91c1c', '#fecaca'],
    plano: ['#155e75', '#a5f3fc'],
    sin: ['#374257', '#93a1bd'],
    orden: ['#f59e0b', '#fff7d6'],
    ordenApagado: ['#b45309', '#fde68a'],
    veto: ['#ff1f3d', '#ffe4e6'],
    apagado: ['#1b2130', '#3a4356'],
    analisis: ['#14532d', '#4ade80'],
    macro: ['#3b1d78', '#c4b5fd'],
    riesgos: ['#6b1a1a', '#fca5a5'],
    ejecucion: ['#7c2d12', '#fdba74'],
    laboratorio: ['#134e5e', '#67e8f9'],
    direccion: ['#1e3a8a', '#fde68a'],
  };

  // Estado del monitor de un puesto (propuesta-visual §4.3): verde con P&L abierto
  // > +0,1 %, rojo < −0,1 %, gris sin posición; ámbar 2 s al enviar una orden y
  // rojo intenso 2 s tras un veto.
  function estadoMonitor(puesto, destello, t, banquillo) {
    if (destello && destello.hasta > t) return destello.tipo === 'veto' ? 'veto' : 'orden';
    if (!puesto) return 'apagado';
    if (banquillo) return 'apagado';
    const pos = puesto.posicion;
    if (!pos) return 'sin';
    const p = pos.pnlAbiertoPct;
    if (typeof p !== 'number' || !Number.isFinite(p)) return 'plano';
    if (p > 0.001) return 'verde';
    if (p < -0.001) return 'rojo';
    return 'plano';
  }

  function colorRegimen(valor) {
    if (valor === 'RISK-ON') return 'verde';
    if (valor === 'RISK-OFF') return 'rojo';
    return 'sin';
  }

  // Monitor mirando al sur (+fila). `ctxDatos`: { puesto, destello, t, banquillo, regimen, fondoBloqueado, movimiento }.
  function pintarMonitor(ctx, m, d) {
    const z = m.z;
    const mid = (m.c0 + m.c1) / 2;
    // Pie y base.
    caja(ctx, mid - 0.06, m.f0 - 0.02, mid + 0.06, m.f1 + 0.02, z, z + 4, '#2a3142', { sinBorde: true });
    caja(ctx, mid - 0.02, m.f0 + 0.01, mid + 0.02, m.f0 + 0.05, z + 3, z + 6, '#20263a', { sinBorde: true });
    const z0 = z + 5;
    const z1 = z + m.alto;
    let clave;
    if (m.pantalla === 'puesto') clave = estadoMonitor(d.puesto, d.destello, d.t, d.banquillo);
    else if (m.pantalla === 'regimen') clave = colorRegimen(d.regimen);
    else clave = m.pantalla;
    if (d.fondoBloqueado && clave !== 'apagado') clave = 'veto';
    if (clave === 'orden' && d.movimiento && Math.floor(d.t / 250) % 2) clave = 'ordenApagado';
    const [fondoPant, linea] = COLORES_MONITOR[clave] || COLORES_MONITOR.sin;
    // Carcasa.
    caja(ctx, m.c0, m.f0, m.c1, m.f1, z0, z1, '#1e2433', { tapa: '#2c3346', sur: '#171c29', este: '#11151f', borde: 'rgba(0,0,0,0.5)' });
    // Pantalla en la cara sur.
    const i = 0.035;
    const ff = m.f1 + 0.002;
    const cc0 = m.c0 + i; const cc1 = m.c1 - i; const zz0 = z0 + 1.6; const zz1 = z1 - 1.6;
    cara(ctx, [P(cc0, ff, zz0), P(cc1, ff, zz0), P(cc1, ff, zz1), P(cc0, ff, zz1)], fondoPant, null);
    // Brillo proyectado sobre la mesa.
    if (clave !== 'apagado') {
      cara(ctx, [P(m.c0 - 0.05, m.f1, z + 0.2), P(m.c1 + 0.05, m.f1, z + 0.2), P(m.c1 + 0.12, m.f1 + 0.36, z + 0.2), P(m.c0 - 0.12, m.f1 + 0.36, z + 0.2)],
        rgba(rgbHex(fondoPant), clave === 'veto' || clave === 'orden' ? 0.3 : 0.16), null);
    }
    // Contenido: minicurva con los últimos cierres (o un dibujo fijo en otras salas).
    const serie = m.pantalla === 'puesto' && d.puesto && Array.isArray(d.puesto.chispa) && d.puesto.chispa.length > 1
      ? d.puesto.chispa : serieFija(m.id, m.pantalla);
    if (clave === 'apagado') return;
    const n = serie.length;
    let min = Infinity; let max = -Infinity;
    for (const v of serie) { if (v < min) min = v; if (v > max) max = v; }
    const rango = max - min || 1;
    ctx.strokeStyle = linea;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    for (let k = 0; k < n; k++) {
      const u = cc0 + 0.03 + (cc1 - cc0 - 0.06) * (k / (n - 1));
      const zz = zz0 + 2 + (zz1 - zz0 - 4) * ((serie[k] - min) / rango);
      const p = P(u, ff, zz);
      if (k) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
    }
    ctx.stroke();
    if (m.pantalla === 'analisis' || m.pantalla === 'ejecucion') {
      // Barras abajo, como un volumen o una lista de órdenes.
      ctx.fillStyle = rgba(rgbHex(linea), 0.55);
      for (let k = 0; k < 6; k++) {
        const u = cc0 + 0.04 + k * (cc1 - cc0 - 0.08) / 6;
        const h = 1 + ((k * 7 + m.id.length) % 4);
        cara(ctx, [P(u, ff, zz0 + 1), P(u + 0.03, ff, zz0 + 1), P(u + 0.03, ff, zz0 + 1 + h), P(u, ff, zz0 + 1 + h)], ctx.fillStyle, null);
      }
    }
  }

  function rgbHex(color) {
    if (color[0] === '#') return color;
    const m = color.match(/\d+/g);
    return '#' + m.slice(0, 3).map(x => Number(x).toString(16).padStart(2, '0')).join('');
  }

  const cacheSeries = new Map();
  function serieFija(id, tipo) {
    const clave = id + tipo;
    if (cacheSeries.has(clave)) return cacheSeries.get(clave);
    let h = 0;
    for (const ch of clave) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const r = azar(h);
    const s = [];
    let v = 10;
    for (let k = 0; k < 12; k++) { v += (r() - 0.45) * 3; s.push(v); }
    cacheSeries.set(clave, s);
    return s;
  }

  // ---------- muebles ----------

  function pintarMueble(ctx, m, d) {
    const z = m.z || 0;
    switch (m.tipo) {
      case 'mesa': return pintarMesa(ctx, m);
      case 'monitor': return pintarMonitor(ctx, m, d);
      case 'teclado': {
        cara(ctx, [P(m.c0, m.f0, z + 0.6), P(m.c1, m.f0, z + 0.6), P(m.c1, m.f1, z + 0.6), P(m.c0, m.f1, z + 0.6)], '#2b3142', 'rgba(0,0,0,0.25)');
        return;
      }
      case 'silla': return pintarSilla(ctx, m);
      case 'respaldo': return pintarRespaldo(ctx, m);
      case 'planta': return pintarPlanta(ctx, m);
      case 'fuente': return pintarFuente(ctx, m);
      case 'impresora': {
        caja(ctx, m.c0, m.f0, m.c1, m.f1, z, z + m.alto, '#d9dde6');
        caja(ctx, m.c0 + 0.1, m.f0 + 0.1, m.c1 - 0.1, m.f1 - 0.25, z + m.alto, z + m.alto + 2, '#3a4152');
        cara(ctx, [P(m.c0 + 0.15, m.f1, z + 8), P(m.c1 - 0.15, m.f1, z + 8), P(m.c1 - 0.15, m.f1, z + 10), P(m.c0 + 0.15, m.f1, z + 10)], '#9aa3b5', null);
        return;
      }
      case 'estanteria': return pintarEstanteria(ctx, m);
      case 'mesaRedonda': case 'mesaAlta': return pintarMesaRedonda(ctx, m);
      case 'mesaComite': {
        caja(ctx, m.c0 + 0.12, m.f0 + 0.12, m.c1 - 0.12, m.f1 - 0.12, z, z + m.alto - 3, tono(m.color, -0.35), { borde: 'rgba(0,0,0,0.25)' });
        caja(ctx, m.c0, m.f0, m.c1, m.f1, z + m.alto - 3, z + m.alto, m.color, { tapa: tono(m.color, 0.12), borde: 'rgba(40,20,5,0.35)' });
        // Papeles y un vaso en cada tramo.
        const c = (m.c0 + m.c1) / 2;
        cara(ctx, [P(c - 0.5, m.f0 + 0.3, z + m.alto + 0.3), P(c - 0.1, m.f0 + 0.3, z + m.alto + 0.3), P(c - 0.1, m.f0 + 0.6, z + m.alto + 0.3), P(c - 0.5, m.f0 + 0.6, z + m.alto + 0.3)], '#f8fafc', null);
        cara(ctx, [P(c + 0.2, m.f1 - 0.6, z + m.alto + 0.3), P(c + 0.6, m.f1 - 0.6, z + m.alto + 0.3), P(c + 0.6, m.f1 - 0.3, z + m.alto + 0.3), P(c + 0.2, m.f1 - 0.3, z + m.alto + 0.3)], '#f8fafc', null);
        return;
      }
      case 'sofa': return pintarSofa(ctx, m);
      case 'mesaBaja': {
        caja(ctx, m.c0, m.f0, m.c1, m.f1, z, z + m.alto, m.color, { tapa: tono(m.color, 0.15) });
        elipseSuelo(ctx, (m.c0 + m.c1) / 2 - 0.3, (m.f0 + m.f1) / 2, z + m.alto + 1, 0.1, '#f8fafc');
        return;
      }
      case 'expendedora': return pintarExpendedora(ctx, m, d);
      case 'cafetera': return pintarCafetera(ctx, m);
      case 'rack': return pintarRack(ctx, m, d);
      case 'archivador': {
        caja(ctx, m.c0, m.f0, m.c1, m.f1, z, z + m.alto, m.color);
        ctx.strokeStyle = 'rgba(20,24,40,0.45)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const zz of [z + 10, z + 20]) { const a = P(m.c0, m.f1, zz); const b = P(m.c1, m.f1, zz); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
        ctx.stroke();
        return;
      }
      default:
        if (m.bloquea) caja(ctx, m.c0, m.f0, m.c1, m.f1, z, z + (m.alto || 10), m.color || '#9aa3b5');
    }
  }

  function pintarMesa(ctx, m) {
    const z = m.z || 0;
    const top = z + m.alto;
    const madera = m.color !== '#f4f5f8';
    if (madera) {
      // Mesa de despacho: cuerpo macizo con faldón.
      caja(ctx, m.c0 + 0.05, m.f0 + 0.05, m.c1 - 0.05, m.f1 - 0.1, z, top - 2.5, tono(m.color, -0.2));
      caja(ctx, m.c0, m.f0, m.c1, m.f1, top - 2.5, top, m.color, { tapa: tono(m.color, 0.14) });
      return;
    }
    // Mesa de parqué: patas laterales grises y tablero blanco.
    const pata = '#8f99ad';
    caja(ctx, m.c0 + 0.04, m.f0 + 0.06, m.c0 + 0.1, m.f1 - 0.06, z, top - 2.5, pata);
    caja(ctx, m.c0 + 0.1, m.f0 + 0.08, m.c1 - 0.1, m.f0 + 0.14, z + 5, top - 2.5, '#aab3c5', { sinTapa: true });
    caja(ctx, m.c1 - 0.1, m.f0 + 0.06, m.c1 - 0.04, m.f1 - 0.06, z, top - 2.5, pata);
    caja(ctx, m.c0, m.f0, m.c1, m.f1, top - 2.5, top, m.color, { tapa: '#fbfcfe', sur: '#dfe3ec', este: '#c3c9d6' });
  }

  function pintarSilla(ctx, m) {
    const z = m.z || 0;
    const c = (m.c0 + m.c1) / 2; const f = (m.f0 + m.f1) / 2;
    // Base de estrella y pistón.
    const b = P(c, f, z + 1);
    ctx.fillStyle = '#1b2030';
    ctx.beginPath(); ctx.ellipse(b.x, b.y, 8, 4, 0, 0, Math.PI * 2); ctx.fill();
    caja(ctx, c - 0.03, f - 0.03, c + 0.03, f + 0.03, z + 1, z + 7, '#3a4152', { sinBorde: true });
    caja(ctx, m.c0 + 0.02, m.f0 + 0.02, m.c1 - 0.02, m.f1 - 0.02, z + 7, z + 9.5, m.color, { tapa: tono(m.color, 0.12) });
  }

  function pintarRespaldo(ctx, m) {
    const z = m.z || 0;
    const c = (m.c0 + m.c1) / 2; const f = (m.f0 + m.f1) / 2;
    const g = 0.045; const a = 0.21;
    let r;
    if (m.mira === 'N' || m.mira === 'S') r = [c - a, f - g, c + a, f + g];
    else r = [c - g, f - a, c + g, f + a];
    caja(ctx, r[0], r[1], r[2], r[3], z + 9, z + m.alto, m.color, { tapa: tono(m.color, 0.15), sur: tono(m.color, -0.05), este: tono(m.color, -0.2) });
  }

  function pintarPlanta(ctx, m) {
    const z = m.z || 0;
    const c = (m.c0 + m.c1) / 2; const f = (m.f0 + m.f1) / 2;
    caja(ctx, c - 0.2, f - 0.2, c + 0.2, f + 0.2, z, z + 10, '#e9e4dc', { tapa: '#5b4636' });
    const p = P(c, f, z + 10);
    const hojas = [[-6, -8, 7, '#2f8f4e'], [6, -9, 7, '#2a7d44'], [0, -15, 8, '#38a65b'], [-4, -20, 6, '#43b866'], [5, -19, 6, '#3aa35c']];
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(15,40,20,0.45)';
    for (const [dx, dy, r, col] of hojas) {
      ctx.beginPath(); ctx.arc(p.x + dx, p.y + dy, r, 0, Math.PI * 2);
      ctx.fillStyle = col; ctx.fill(); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath(); ctx.arc(p.x - 2, p.y - 20, 2.5, 0, Math.PI * 2); ctx.fill();
  }

  function pintarFuente(ctx, m) {
    const z = m.z || 0;
    caja(ctx, m.c0, m.f0, m.c1, m.f1, z, z + 24, '#eef1f6');
    const c = (m.c0 + m.c1) / 2; const f = (m.f0 + m.f1) / 2;
    const p = P(c, f, z + 24);
    ctx.fillStyle = 'rgba(96, 165, 250, 0.85)';
    ctx.strokeStyle = 'rgba(30, 64, 175, 0.6)';
    ctx.lineWidth = 1;
    rectRedondo(ctx, p.x - 6, p.y - 14, 12, 15, 4);
    ctx.fill(); ctx.stroke();
    cara(ctx, [P(c - 0.12, m.f1, z + 14), P(c + 0.12, m.f1, z + 14), P(c + 0.12, m.f1, z + 18), P(c - 0.12, m.f1, z + 18)], '#3b82f6', null);
  }

  function pintarEstanteria(ctx, m) {
    const z = m.z || 0;
    caja(ctx, m.c0, m.f0, m.c1, m.f1, z, z + m.alto, '#6b4a33', { sur: '#4a3223' });
    const r = azar(Math.round(m.c0 * 100));
    const colores = ['#c0392b', '#2e86de', '#f1c40f', '#27ae60', '#8e44ad', '#e67e22', '#ecf0f1'];
    const baldas = 4;
    for (let k = 0; k < baldas; k++) {
      const z0 = z + 4 + k * (m.alto - 6) / baldas;
      const z1 = z0 + (m.alto - 6) / baldas - 2;
      let c = m.c0 + 0.08;
      while (c < m.c1 - 0.12) {
        const w = 0.06 + r() * 0.07;
        const h = (z1 - z0) * (0.65 + r() * 0.35);
        cara(ctx, [P(c, m.f1 + 0.001, z0), P(c + w, m.f1 + 0.001, z0), P(c + w, m.f1 + 0.001, z0 + h), P(c, m.f1 + 0.001, z0 + h)],
          colores[Math.floor(r() * colores.length)], null);
        c += w + 0.012;
      }
    }
  }

  function pintarMesaRedonda(ctx, m) {
    const z = m.z || 0;
    const c = (m.c0 + m.c1) / 2; const f = (m.f0 + m.f1) / 2;
    const r = (m.c1 - m.c0) / 2;
    caja(ctx, c - 0.06, f - 0.06, c + 0.06, f + 0.06, z, z + m.alto - 2, '#5b6478', { sinBorde: true });
    const b = P(c, f, z + 0.5);
    ctx.fillStyle = '#3a4152';
    ctx.beginPath(); ctx.ellipse(b.x, b.y, 9, 4.5, 0, 0, Math.PI * 2); ctx.fill();
    const p0 = P(c, f, z + m.alto - 2); const p1 = P(c, f, z + m.alto);
    ctx.fillStyle = tono(m.color, -0.2);
    ctx.beginPath(); ctx.ellipse(p0.x, p0.y, r * 45.25, r * 22.63, 0, 0, Math.PI); ctx.lineTo(p1.x - r * 45.25, p1.y); ctx.ellipse(p1.x, p1.y, r * 45.25, r * 22.63, 0, Math.PI, 0, true); ctx.closePath(); ctx.fill();
    ctx.fillStyle = tono(m.color, 0.1);
    ctx.strokeStyle = BORDE;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(p1.x, p1.y, r * 45.25, r * 22.63, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }

  function pintarSofa(ctx, m) {
    const z = m.z || 0;
    const col = m.color;
    const a = 0.2;   // brazo
    const r = 0.26;  // respaldo
    if (m.mira === 'S') {
      caja(ctx, m.c0, m.f0 + r * 0.6, m.c1, m.f1, z, z + 7, col);
      caja(ctx, m.c0, m.f0, m.c1, m.f0 + r, z, z + m.alto, col, { tapa: tono(col, 0.18) });
      caja(ctx, m.c0, m.f0, m.c0 + a, m.f1, z, z + 11, col, { tapa: tono(col, 0.18) });
      caja(ctx, m.c1 - a, m.f0, m.c1, m.f1, z, z + 11, col, { tapa: tono(col, 0.18) });
      // Cojines.
      const n = 3; const w = (m.c1 - m.c0 - 2 * a) / n;
      for (let k = 0; k < n; k++) {
        caja(ctx, m.c0 + a + k * w + 0.02, m.f0 + r, m.c0 + a + (k + 1) * w - 0.02, m.f1 - 0.03, z + 7, z + 9, tono(col, 0.1), { borde: 'rgba(10,20,60,0.3)' });
      }
    } else {
      caja(ctx, m.c0 + r * 0.6, m.f0, m.c1, m.f1, z, z + 7, col);
      caja(ctx, m.c0, m.f0, m.c0 + r, m.f1, z, z + m.alto, col, { tapa: tono(col, 0.18) });
      caja(ctx, m.c0, m.f0, m.c1, m.f0 + a, z, z + 11, col, { tapa: tono(col, 0.18) });
      caja(ctx, m.c0, m.f1 - a, m.c1, m.f1, z, z + 11, col, { tapa: tono(col, 0.18) });
      const n = 2; const w = (m.f1 - m.f0 - 2 * a) / n;
      for (let k = 0; k < n; k++) {
        caja(ctx, m.c0 + r, m.f0 + a + k * w + 0.02, m.c1 - 0.03, m.f0 + a + (k + 1) * w - 0.02, z + 7, z + 9, tono(col, 0.1), { borde: 'rgba(10,20,60,0.3)' });
      }
    }
  }

  function pintarExpendedora(ctx, m, d) {
    const z = m.z || 0;
    caja(ctx, m.c0, m.f0, m.c1, m.f1, z, z + m.alto, m.color, { tapa: tono(m.color, 0.2) });
    const f = m.f1 + 0.002;
    const vidrio = [P(m.c0 + 0.08, f, z + 14), P(m.c1 - 0.3, f, z + 14), P(m.c1 - 0.3, f, z + m.alto - 5), P(m.c0 + 0.08, f, z + m.alto - 5)];
    cara(ctx, vidrio, '#10203d', 'rgba(0,0,0,0.4)');
    const colores = ['#f59e0b', '#22c55e', '#3b82f6', '#ef4444', '#e5e7eb'];
    for (let fila = 0; fila < 5; fila++) {
      for (let k = 0; k < 4; k++) {
        const c = m.c0 + 0.13 + k * 0.12;
        const zz = z + 17 + fila * 6;
        const p = P(c, f, zz);
        ctx.fillStyle = colores[(fila + k) % colores.length];
        ctx.fillRect(p.x - 1.6, p.y - 3, 3.2, 3);
      }
    }
    // Panel de botones iluminado.
    const luz = d && d.movimiento ? (Math.sin(d.t / 400) > 0 ? '#fde68a' : '#fbbf24') : '#fde68a';
    cara(ctx, [P(m.c1 - 0.24, f, z + 30), P(m.c1 - 0.08, f, z + 30), P(m.c1 - 0.08, f, z + 40), P(m.c1 - 0.24, f, z + 40)], luz, null);
    cara(ctx, [P(m.c0 + 0.15, f, z + 5), P(m.c1 - 0.3, f, z + 5), P(m.c1 - 0.3, f, z + 10), P(m.c0 + 0.15, f, z + 10)], '#1a1a1a', null);
  }

  function pintarCafetera(ctx, m) {
    const z = m.z || 0;
    caja(ctx, m.c0, m.f0, m.c1, m.f1, z, z + m.alto, m.color, { tapa: '#f8f6f1', sur: '#d8d2c6' });
    caja(ctx, m.c0 + 0.1, m.f0 + 0.08, m.c0 + 0.55, m.f0 + 0.5, z + m.alto, z + m.alto + 16, '#2a2d36', { tapa: '#3a3e4a' });
    const p = P(m.c0 + 0.32, m.f0 + 0.5, z + m.alto + 11);
    ctx.fillStyle = '#ef4444';
    ctx.beginPath(); ctx.arc(p.x, p.y, 1.4, 0, Math.PI * 2); ctx.fill();
    for (const c of [m.c0 + 0.8, m.c0 + 1.05]) {
      caja(ctx, c, m.f0 + 0.3, c + 0.12, m.f0 + 0.42, z + m.alto, z + m.alto + 4, '#ffffff', { sinBorde: false });
    }
  }

  function pintarRack(ctx, m, d) {
    const z = m.z || 0;
    caja(ctx, m.c0, m.f0, m.c1, m.f1, z, z + m.alto, m.color, { sur: '#161b2a', este: '#0f1320' });
    const f = m.f1 + 0.002;
    const t = d ? d.t : 0;
    for (let k = 0; k < 7; k++) {
      const zz = z + 5 + k * 5.6;
      cara(ctx, [P(m.c0 + 0.06, f, zz), P(m.c1 - 0.06, f, zz), P(m.c1 - 0.06, f, zz + 4), P(m.c0 + 0.06, f, zz + 4)], '#252c40', null);
      for (let l = 0; l < 3; l++) {
        const encendido = d && d.movimiento ? ((Math.floor(t / (180 + 70 * l)) + k * 3 + l) % 4 !== 0) : true;
        const p = P(m.c0 + 0.14 + l * 0.12, f, zz + 2);
        ctx.fillStyle = encendido ? (l === 2 ? '#f59e0b' : '#22d3ee') : '#123040';
        ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
      }
    }
  }

  // ---------- pantallas colgadas de tabiques (en la lista ordenada) ----------

  // Pantalla o pizarra colgada de un tabique. Con [corteDesde, corteHasta] se
  // pinta solo el tramo que cae sobre un trozo de pared (ver app.js).
  function pintarPantallaPared(ctx, pp, textura, corteDesde, corteHasta) {
    ctx.save();
    if (corteDesde !== undefined) {
      const k = mapaMod.GROSOR_PARED / 2 + 0.01;
      const z0 = pp.z0 - 6; const z1 = pp.z1 + 6;
      const pts = pp.eje === 'col'
        ? [P(pp.en + k, corteDesde, z0), P(pp.en + k, corteHasta, z0), P(pp.en + k, corteHasta, z1), P(pp.en + k, corteDesde, z1)]
        : [P(corteDesde, pp.en + k, z0), P(corteHasta, pp.en + k, z0), P(corteHasta, pp.en + k, z1), P(corteDesde, pp.en + k, z1)];
      poligono(ctx, pts);
      ctx.clip();
    }
    const m = marcoPared(null, pp.desde - 0.08, pp.hasta + 0.08, pp.z0 - 3, pp.z1 + 3, pp.eje, pp.en);
    conMarco(ctx, m, 100, 100, (c) => {
      c.fillStyle = pp.tipo === 'pizarra' ? '#cfd6e3' : '#0c1124';
      rectRedondo(c, 0, 0, 100, 100, 3);
      c.fill();
    });
    pegarTextura(ctx, { pared: null, desde: pp.desde, hasta: pp.hasta, z0: pp.z0, z1: pp.z1, eje: pp.eje, en: pp.en }, textura);
    ctx.restore();
  }

  // ---------- texturas (se repintan al llegar datos) ----------

  function lienzo(ancho, alto) {
    if (typeof OffscreenCanvas !== 'undefined' && typeof document === 'undefined') return new OffscreenCanvas(ancho, alto);
    const c = document.createElement('canvas');
    c.width = ancho; c.height = alto;
    return c;
  }

  const textoAjustado = (c, texto, max) => {
    let t = String(texto);
    if (c.measureText(t).width <= max) return t;
    while (t.length > 1 && c.measureText(t + '…').width > max) t = t.slice(0, -1);
    return t + '…';
  };

  function colorVar(v) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return '#8a93b0';
    return v > 0 ? '#34d399' : v < 0 ? '#f87171' : '#8a93b0';
  }

  // Pantalla gigante: cotizaciones | patrimonio, resultado y curva | hechos de la mesa.
  function pintarPantallaGigante(tex, inst, extra) {
    const c = tex.getContext('2d');
    const W = tex.width; const H = tex.height;
    const e = extra || {};
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, W, H);
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#101a38'); g.addColorStop(1, '#0a1026');
    c.fillStyle = g;
    rectRedondo(c, 0, 0, W, H, 14);
    c.fill();
    c.strokeStyle = '#2b3f7a';
    c.lineWidth = 4;
    rectRedondo(c, 2, 2, W - 4, H - 4, 12);
    c.stroke();
    if (!inst) {
      c.fillStyle = '#8a93b0';
      c.font = `600 40px ${FUENTE}`;
      c.fillText('Conectando con la mesa…', 60, H / 2);
      return;
    }
    const cab = inst.cabecera || {};
    // Cabecera.
    c.fillStyle = '#8fb3ff';
    c.font = `800 26px ${FUENTE}`;
    c.textBaseline = 'alphabetic';
    c.fillText('MESA DE AGENTES · PARQUÉ EN VIVO', 30, 44);
    c.textAlign = 'right';
    c.fillStyle = '#8a93b0';
    c.font = `600 24px ${FUENTE}`;
    const modoTexto = inst.modo === 'alpaca' ? 'PAPEL ALPACA' : inst.modo === 'sintetico' ? 'SINTÉTICO' : 'SIMULADO';
    c.fillText(`${modoTexto} · ${cifras.hora(inst.ahora)}`, W - 30, 44);
    c.textAlign = 'left';
    c.fillStyle = '#1e2a50';
    c.fillRect(24, 60, W - 48, 2);
    const x1 = 600; const x2 = 1230;
    c.fillRect(x1 - 16, 76, 2, H - 96);
    c.fillRect(x2 - 16, 76, 2, H - 96);

    // Cotizaciones.
    c.fillStyle = '#8a93b0';
    c.font = `700 22px ${FUENTE}`;
    c.fillText('COTIZACIONES', 30, 100);
    const cot = (inst.cotizaciones || []).slice(0, 6);
    cot.forEach((q, k) => {
      const y = 142 + k * 36;
      c.fillStyle = '#e6e9f2';
      c.font = `800 26px ${FUENTE}`;
      c.fillText(q.etiqueta || q.simbolo, 30, y);
      c.textAlign = 'right';
      c.font = `600 26px ${FUENTE}`;
      c.fillText(cifras.precio(q.precio), 390, y);
      c.fillStyle = colorVar(q.var24hPct);
      c.font = `700 24px ${FUENTE}`;
      const flecha = q.var24hPct > 0 ? '▲ ' : q.var24hPct < 0 ? '▼ ' : '';
      c.fillText(flecha + cifras.pct(q.var24hPct, { signo: true }), 566, y);
      c.textAlign = 'left';
    });

    // Patrimonio y curva.
    c.fillStyle = '#8a93b0';
    c.font = `700 22px ${FUENTE}`;
    c.fillText('PATRIMONIO', x1, 100);
    c.fillStyle = '#ffffff';
    c.font = `800 70px ${FUENTE}`;
    const patr = typeof e.patrimonioAnimado === 'number' ? e.patrimonioAnimado : cab.patrimonio;
    c.fillText(cifras.usd(patr), x1, 166);
    c.fillStyle = colorVar(cab.pnlDia);
    c.font = `700 28px ${FUENTE}`;
    c.fillText(`${cifras.usd(cab.pnlDia, { signo: true })} (${cifras.pct(cab.pnlDiaPct, { signo: true })}) hoy`, x1, 204);
    const curva = (inst.curva || []).filter(p => p && Number.isFinite(p.patrimonio));
    const cx0 = x1; const cx1 = x2 - 40; const cy0 = 222; const cy1 = H - 24;
    if (curva.length > 1) {
      let min = Infinity; let max = -Infinity;
      for (const p of curva) { if (p.patrimonio < min) min = p.patrimonio; if (p.patrimonio > max) max = p.patrimonio; }
      const base = curva[0].patrimonio;
      min = Math.min(min, base); max = Math.max(max, base);
      const rango = (max - min) || 1;
      const X = k => cx0 + (cx1 - cx0) * (k / (curva.length - 1));
      const Y = v => cy1 - (cy1 - cy0) * ((v - min) / rango);
      const ultimo = curva[curva.length - 1].patrimonio;
      const color = ultimo >= base ? '#34d399' : '#f87171';
      const grad = c.createLinearGradient(0, cy0, 0, cy1);
      grad.addColorStop(0, ultimo >= base ? 'rgba(52,211,153,0.35)' : 'rgba(248,113,113,0.35)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      c.beginPath();
      curva.forEach((p, k) => (k ? c.lineTo(X(k), Y(p.patrimonio)) : c.moveTo(X(k), Y(p.patrimonio))));
      c.lineTo(cx1, cy1); c.lineTo(cx0, cy1); c.closePath();
      c.fillStyle = grad; c.fill();
      c.setLineDash([10, 8]);
      c.strokeStyle = 'rgba(200, 210, 240, 0.45)';
      c.lineWidth = 2;
      c.beginPath(); c.moveTo(cx0, Y(base)); c.lineTo(cx1, Y(base)); c.stroke();
      c.setLineDash([]);
      c.strokeStyle = color;
      c.lineWidth = 4;
      c.lineJoin = 'round';
      c.beginPath();
      curva.forEach((p, k) => (k ? c.lineTo(X(k), Y(p.patrimonio)) : c.moveTo(X(k), Y(p.patrimonio))));
      c.stroke();
      c.fillStyle = color;
      c.beginPath(); c.arc(cx1, Y(ultimo), 7, 0, Math.PI * 2); c.fill();
    }

    // Hechos de la mesa.
    c.fillStyle = '#8a93b0';
    c.font = `700 22px ${FUENTE}`;
    c.fillText('HECHOS DE LA MESA', x2, 100);
    const hechos = (inst.ejecuciones || []).slice().sort((a, b) => b.t - a.t).slice(0, 6);
    if (!hechos.length) {
      c.fillStyle = '#5d6685';
      c.font = `600 24px ${FUENTE}`;
      c.fillText('Sin ejecuciones todavía', x2, 150);
    }
    hechos.forEach((h, k) => {
      const y = 142 + k * 36;
      const compra = h.lado === 'compra';
      c.fillStyle = compra ? '#34d399' : '#f87171';
      c.fillRect(x2, y - 22, 6, 26);
      c.fillStyle = '#8a93b0';
      c.font = `600 21px ${FUENTE}`;
      c.fillText(cifras.hora(h.t), x2 + 16, y);
      c.fillStyle = '#e6e9f2';
      c.font = `700 23px ${FUENTE}`;
      const texto = `${compra ? 'COMPRA' : 'VENTA'} ${cifras.cantidad(h.cantidad, 4)} ${h.etiqueta || ''} a ${cifras.precio(h.precio)}`;
      c.fillText(textoAjustado(c, texto, W - x2 - 110), x2 + 90, y);
    });

    // Estado del fondo: el kill switch pone la pantalla en rojo.
    const nivel = inst.fondo && inst.fondo.nivel;
    if (nivel === 'bloqueado') {
      c.fillStyle = 'rgba(185, 28, 28, 0.82)';
      rectRedondo(c, 0, 0, W, H, 14);
      c.fill();
      c.fillStyle = '#fff';
      c.textAlign = 'center';
      c.font = `900 64px ${FUENTE}`;
      c.fillText('KILL SWITCH · FONDO BLOQUEADO', W / 2, H / 2 + 4);
      c.font = `600 28px ${FUENTE}`;
      c.fillText(textoAjustado(c, (inst.fondo.motivo || 'Todo cerrado. Solo sale con Reabrir.'), W - 200), W / 2, H / 2 + 52);
      c.textAlign = 'left';
    } else if (nivel === 'solo_cerrar' || nivel === 'pausado') {
      c.fillStyle = '#f59e0b';
      rectRedondo(c, W / 2 - 170, 16, 340, 38, 19);
      c.fill();
      c.fillStyle = '#1a1300';
      c.textAlign = 'center';
      c.font = `800 22px ${FUENTE}`;
      c.fillText(nivel === 'pausado' ? 'PAUSADO · SOLO CERRAR' : 'SOLO CERRAR', W / 2, 43);
      c.textAlign = 'left';
    }
  }

  function barraLimite(c, x, y, w, titulo, valor, maximo, textoValor) {
    c.fillStyle = '#aab3cc';
    c.font = `700 20px ${FUENTE}`;
    c.fillText(titulo, x, y);
    c.textAlign = 'right';
    c.fillStyle = '#e6e9f2';
    c.fillText(textoValor, x + w, y);
    c.textAlign = 'left';
    const f = maximo > 0 && Number.isFinite(valor) ? Math.min(1, Math.max(0, valor / maximo)) : 0;
    c.fillStyle = '#1f2742';
    rectRedondo(c, x, y + 10, w, 14, 7); c.fill();
    c.fillStyle = f < 0.6 ? '#22c55e' : f < 0.85 ? '#f59e0b' : '#ef4444';
    if (f > 0) { rectRedondo(c, x, y + 10, Math.max(14, w * f), 14, 7); c.fill(); }
  }

  function pintarLimites(tex, inst) {
    const c = tex.getContext('2d');
    const W = tex.width; const H = tex.height;
    c.clearRect(0, 0, W, H);
    c.fillStyle = '#0d1328';
    rectRedondo(c, 0, 0, W, H, 12); c.fill();
    c.strokeStyle = '#4b1d1d'; c.lineWidth = 4;
    rectRedondo(c, 2, 2, W - 4, H - 4, 10); c.stroke();
    c.fillStyle = '#fca5a5';
    c.font = `800 24px ${FUENTE}`;
    c.fillText('LÍMITES DEL FONDO', 24, 40);
    if (!inst) return;
    const cab = inst.cabecera || {};
    const lim = inst.limites || {};
    const x = 24; const w = W - 48;
    barraLimite(c, x, 84, w, 'Exposición bruta', cab.exposicionBrutaPct, lim.maxExposicionBruta,
      `${cifras.pct(cab.exposicionBrutaPct, { decimales: 0 })} / ${cifras.pct(lim.maxExposicionBruta, { decimales: 0 })}`);
    barraLimite(c, x, 136, w, 'Exposición cripto', cab.exposicionCriptoPct, lim.maxExposicionCripto,
      `${cifras.pct(cab.exposicionCriptoPct, { decimales: 0 })} / ${cifras.pct(lim.maxExposicionCripto, { decimales: 0 })}`);
    const perdida = Number.isFinite(cab.pnlDiaPct) ? Math.max(0, -cab.pnlDiaPct) : 0;
    barraLimite(c, x, 188, w, 'Pérdida del día', perdida, lim.perdidaDiariaSoloCerrar,
      `${cifras.pct(-perdida)} / −${cifras.pct(lim.perdidaDiariaSoloCerrar)}`);
    const caida = Number.isFinite(cab.caida) ? Math.abs(cab.caida) : 0;
    barraLimite(c, x, 240, w, 'Caída desde máximo', caida, lim.caidaKill,
      `${cifras.pct(-caida)} / −${cifras.pct(lim.caidaKill, { decimales: 0 })}`);
  }

  function pintarPantallaRegimen(tex, inst) {
    const c = tex.getContext('2d');
    const W = tex.width; const H = tex.height;
    c.clearRect(0, 0, W, H);
    c.fillStyle = '#120c2a';
    rectRedondo(c, 0, 0, W, H, 10); c.fill();
    const cab = (inst && inst.cabecera) || {};
    const valor = (cab.regimen && cab.regimen.valor) || 'NEUTRAL';
    const color = valor === 'RISK-ON' ? '#22c55e' : valor === 'RISK-OFF' ? '#ef4444' : '#94a3b8';
    c.fillStyle = '#c4b5fd';
    c.font = `800 22px ${FUENTE}`;
    c.fillText('RÉGIMEN MACRO', 20, 36);
    c.fillStyle = color;
    c.font = `900 50px ${FUENTE}`;
    c.fillText(valor, 20, 94);
    const fg = cab.miedoCodicia;
    c.fillStyle = '#aab3cc';
    c.font = `700 22px ${FUENTE}`;
    c.fillText(fg ? `F&G ${fg.valor} · ${fg.etiqueta}` : 'F&G —', 20, 130);
  }

  function pintarPantallaComite(tex, inst, ahoraServidor) {
    const c = tex.getContext('2d');
    const W = tex.width; const H = tex.height;
    c.clearRect(0, 0, W, H);
    c.fillStyle = '#1a1208';
    rectRedondo(c, 0, 0, W, H, 10); c.fill();
    const cab = (inst && inst.cabecera) || {};
    c.fillStyle = '#fcd9a8';
    c.font = `800 22px ${FUENTE}`;
    c.fillText('COMITÉ', 20, 36);
    const modo = cab.modoComite || 'NORMAL';
    c.fillStyle = modo === 'NORMAL' ? '#22c55e' : modo === 'DEFENSIVO' ? '#f59e0b' : '#ef4444';
    c.font = `900 44px ${FUENTE}`;
    c.fillText(modo, 20, 88);
    c.fillStyle = '#d6c7b0';
    c.font = `700 22px ${FUENTE}`;
    const resta = Number.isFinite(cab.proximoComite) && Number.isFinite(ahoraServidor) ? cab.proximoComite - ahoraServidor : null;
    c.fillText(resta === null ? 'Próximo: —' : `Próximo en ${cifras.cuentaAtras(resta)}`, 20, 126);
  }

  function pintarPizarra(tex, tipo) {
    const c = tex.getContext('2d');
    const W = tex.width; const H = tex.height;
    c.clearRect(0, 0, W, H);
    c.fillStyle = '#f7f9fc';
    c.fillRect(0, 0, W, H);
    c.strokeStyle = tipo === 'laboratorio' ? '#0e7490' : '#15803d';
    c.fillStyle = c.strokeStyle;
    c.lineWidth = 3;
    c.font = `700 16px "Comic Sans MS", "Segoe Print", ${FUENTE}`;
    if (tipo === 'laboratorio') {
      c.fillText('Sharpe OOS ≥ 0,6', 12, 26);
      c.fillText('DSR ≥ 0,90 · n ≥ 30', 12, 50);
      c.beginPath(); c.moveTo(14, 90); c.bezierCurveTo(60, 60, 100, 100, 180, 64); c.stroke();
    } else {
      c.fillText('Sesgo 4H', 12, 26);
      [30, 52, 40, 64, 48].forEach((h, k) => c.fillRect(20 + k * 30, 96 - h * 0.8, 16, h * 0.8));
    }
  }

  return {
    PALETA, FUENTE, P, tono, rgba, caja, cara, poligono, rectRedondo, elipseSuelo, azar,
    marcoPared, conMarco, pegarTextura, lienzo,
    pintarEdificio, pintarTrozoPared, pintarBordeDelantero, pintarMueble, pintarMonitor, pintarPantallaPared,
    pintarPantallaGigante, pintarLimites, pintarPantallaRegimen, pintarPantallaComite, pintarPizarra,
    estadoMonitor, COLORES_MONITOR,
  };
});
