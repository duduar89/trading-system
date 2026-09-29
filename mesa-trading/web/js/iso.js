// Proyección isométrica 2:1 y cámara del parqué.
//
// Mundo = píxeles a zoom 1: una tesela de 64×32 (§8). Pantalla = píxeles CSS
// del lienzo: pantalla = mundo · zoom + desplazamiento. El devicePixelRatio se
// aplica aparte, al pintar, para que la cámara no dependa de la pantalla.
(function (raiz, fabrica) {
  const mod = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (raiz.Parque = raiz.Parque || {}).iso = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TESELA_ANCHO = 64;
  const TESELA_ALTO = 32;
  const MEDIO_ANCHO = TESELA_ANCHO / 2;
  const MEDIO_ALTO = TESELA_ALTO / 2;

  // x = (col − fila)·32 ; y = (col + fila)·16 − z   (z en píxeles de mundo, hacia arriba)
  function proyectar(col, fila, z) {
    return { x: (col - fila) * MEDIO_ANCHO, y: (col + fila) * MEDIO_ALTO - (z || 0) };
  }

  // Inversa sobre el plano z (por defecto el suelo).
  function desproyectar(x, y, z) {
    const yy = y + (z || 0);
    const a = x / MEDIO_ANCHO;   // col − fila
    const b = yy / MEDIO_ALTO;   // col + fila
    return { col: (a + b) / 2, fila: (b - a) / 2 };
  }

  // Caja envolvente en mundo de un prisma con base [c0,c1]×[f0,f1] y altura z0..z1.
  function cajaMundo(c0, f0, c1, f1, z0, z1) {
    const esquinas = [[c0, f0], [c1, f0], [c1, f1], [c0, f1]];
    let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
    for (const [c, f] of esquinas) {
      const arriba = proyectar(c, f, z1);
      const abajo = proyectar(c, f, z0);
      x0 = Math.min(x0, arriba.x); x1 = Math.max(x1, arriba.x);
      y0 = Math.min(y0, arriba.y); y1 = Math.max(y1, abajo.y);
    }
    return { x0, y0, x1, y1 };
  }

  class Camara {
    constructor(opciones) {
      const o = opciones || {};
      this.zoom = o.zoom || 1;
      this.x = o.x || 0;
      this.y = o.y || 0;
      this.zoomMin = o.zoomMin || 0.5;
      this.zoomMax = o.zoomMax || 2;
      this.version = 0;   // sube con cada cambio: la capa estática se repinta solo entonces
    }

    aPantalla(col, fila, z) {
      const p = proyectar(col, fila, z);
      return { x: p.x * this.zoom + this.x, y: p.y * this.zoom + this.y };
    }

    mundoAPantalla(wx, wy) {
      return { x: wx * this.zoom + this.x, y: wy * this.zoom + this.y };
    }

    pantallaAMundo(px, py) {
      return { x: (px - this.x) / this.zoom, y: (py - this.y) / this.zoom };
    }

    pantallaARejilla(px, py, z) {
      const m = this.pantallaAMundo(px, py);
      return desproyectar(m.x, m.y, z);
    }

    mover(dx, dy) {
      if (!dx && !dy) return;
      this.x += dx;
      this.y += dy;
      this.version++;
    }

    // Zoom manteniendo fijo el punto de pantalla (px, py): el que está bajo el ratón.
    zoomEn(px, py, factor) {
      const nuevo = Math.min(this.zoomMax, Math.max(this.zoomMin, this.zoom * factor));
      if (nuevo === this.zoom) return false;
      const m = this.pantallaAMundo(px, py);
      this.zoom = nuevo;
      this.x = px - m.x * nuevo;
      this.y = py - m.y * nuevo;
      this.version++;
      return true;
    }

    // Encuadra una caja de mundo en un lienzo ancho×alto. Si no cabe ni al zoom
    // mínimo (móvil), el mínimo baja hasta que quepa: la oficina entera siempre
    // se puede ver de un vistazo.
    encuadrar(caja, ancho, alto, margen) {
      const m = margen === undefined ? 24 : margen;
      const zw = (ancho - 2 * m) / Math.max(1, caja.x1 - caja.x0);
      const zh = (alto - 2 * m) / Math.max(1, caja.y1 - caja.y0);
      let z = Math.min(zw, zh);
      if (z < this.zoomMin) this.zoomMin = Math.max(0.2, z);
      z = Math.min(this.zoomMax, Math.max(this.zoomMin, z));
      this.zoom = z;
      this.x = ancho / 2 - ((caja.x0 + caja.x1) / 2) * z;
      this.y = alto / 2 - ((caja.y0 + caja.y1) / 2) * z;
      this.version++;
      return z;
    }
  }

  return { TESELA_ANCHO, TESELA_ALTO, MEDIO_ANCHO, MEDIO_ALTO, proyectar, desproyectar, cajaMundo, Camara };
});
