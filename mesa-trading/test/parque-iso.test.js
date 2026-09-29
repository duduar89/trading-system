'use strict';
// Parqué · proyección isométrica 2:1 (tesela 64×32) y cámara.
const test = require('node:test');
const assert = require('node:assert/strict');
const iso = require('../web/js/iso.js');
const dibujo = require('../web/js/dibujo.js');

test('proyección: casos a mano con x = (col − fila)·32, y = (col + fila)·16 − z', () => {
  assert.deepEqual(iso.proyectar(3, 1), { x: 64, y: 64 });
  assert.deepEqual(iso.proyectar(0, 22), { x: -704, y: 352 });   // esquina izquierda del plano
  assert.deepEqual(iso.proyectar(28, 0, 88), { x: 896, y: 360 }); // esquina derecha, en lo alto de la pared (448 − 88)
  assert.equal(iso.TESELA_ANCHO, 64);
  assert.equal(iso.TESELA_ALTO, 32);
});

test('desproyectar es la inversa sobre su plano z', () => {
  assert.deepEqual(iso.desproyectar(64, 64), { col: 3, fila: 1 });
  for (const [c, f, z] of [[0, 0, 0], [13.25, 7.5, 0], [27.9, 21.1, 18], [4, 19, 52]]) {
    const p = iso.proyectar(c, f, z);
    const r = iso.desproyectar(p.x, p.y, z);
    assert.ok(Math.abs(r.col - c) < 1e-9 && Math.abs(r.fila - f) < 1e-9, `${c},${f},${z}`);
  }
});

test('caja envolvente de un prisma de 1×1 y 10 de alto', () => {
  // Esquinas del suelo: (0,0)→(0,0) (1,0)→(32,16) (1,1)→(0,32) (0,1)→(−32,16); la tapa sube 10.
  assert.deepEqual(iso.cajaMundo(0, 0, 1, 1, 0, 10), { x0: -32, y0: -10, x1: 32, y1: 32 });
});

test('cámara: el zoom deja quieto el punto bajo el ratón y respeta 0,5×–2×', () => {
  const c = new iso.Camara({ zoom: 1, x: 100, y: 40 });
  const antes = c.pantallaAMundo(300, 200);
  c.zoomEn(300, 200, 1.5);
  const despues = c.pantallaAMundo(300, 200);
  assert.ok(Math.abs(antes.x - despues.x) < 1e-9 && Math.abs(antes.y - despues.y) < 1e-9);
  c.zoomEn(0, 0, 100);
  assert.equal(c.zoom, 2);
  c.zoomEn(0, 0, 0.0001);
  assert.equal(c.zoom, 0.5);
  const v = c.version;
  c.mover(10, 0);
  assert.equal(c.version, v + 1, 'mover cambia la versión (la capa estática se repinta)');
});

test('encuadrar centra la caja y, si no cabe a 0,5×, baja el mínimo', () => {
  const c = new iso.Camara();
  const caja = { x0: -704, y0: -120, x1: 896, y1: 820 };   // oficina entera: 1.600 × 940
  const z = c.encuadrar(caja, 1128, 790, 28);
  // (1128 − 56) / 1600 = 0,67 ; (790 − 56) / 940 = 0,78 → 0,67
  assert.ok(Math.abs(z - 0.67) < 1e-9);
  const centro = c.mundoAPantalla((caja.x0 + caja.x1) / 2, (caja.y0 + caja.y1) / 2);
  assert.ok(Math.abs(centro.x - 564) < 1e-9 && Math.abs(centro.y - 395) < 1e-9);
  const m = new iso.Camara();
  const zm = m.encuadrar(caja, 390, 600, 10);                // móvil: (390 − 20) / 1600 = 0,23
  assert.ok(Math.abs(zm - 0.23125) < 1e-9);
  assert.ok(m.zoomMin <= zm);
});

test('monitor de un puesto: verde > +0,1 %, rojo < −0,1 %, gris sin posición, ámbar 2 s tras una orden', () => {
  const pos = (p) => ({ posicion: { pnlAbiertoPct: p } });
  assert.equal(dibujo.estadoMonitor({ posicion: null }, null, 0), 'sin');
  assert.equal(dibujo.estadoMonitor(pos(0.0015), null, 0), 'verde');
  assert.equal(dibujo.estadoMonitor(pos(-0.0015), null, 0), 'rojo');
  assert.equal(dibujo.estadoMonitor(pos(0.0005), null, 0), 'plano');      // entre −0,1 % y +0,1 %
  assert.equal(dibujo.estadoMonitor(pos(0.001), null, 0), 'plano');       // justo en el umbral no es verde
  assert.equal(dibujo.estadoMonitor(pos(0.05), { tipo: 'orden', hasta: 2000 }, 1500), 'orden');
  assert.equal(dibujo.estadoMonitor(pos(0.05), { tipo: 'orden', hasta: 2000 }, 2500), 'verde');  // pasados los 2 s
  assert.equal(dibujo.estadoMonitor(pos(0.05), { tipo: 'veto', hasta: 2000 }, 100), 'veto');
  assert.equal(dibujo.estadoMonitor(pos(0.05), null, 0, true), 'apagado');   // mesa en el banquillo
  assert.equal(dibujo.estadoMonitor(null, null, 0), 'apagado');
});
