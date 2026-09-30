'use strict';
// Parqué · pantallas pintadas en canvas (pantalla gigante, comité, límites,
// relojes). Sin navegador: un lienzo falso apunta cada texto que se pinta.
const test = require('node:test');
const assert = require('node:assert/strict');
const dibujo = require('../web/js/dibujo.js');
const { crearMaqueta } = require('../web/js/maqueta.js');

// Lienzo falso: cualquier método es un no-op, salvo fillText (se apunta) y
// measureText (ancho aproximado según el cuerpo de la fuente).
function lienzoFalso(w, h) {
  const textos = [];
  const estado = { font: '10px sans-serif' };
  const ctx = new Proxy(estado, {
    get(t, k) {
      if (k === 'fillText') return (texto, x, y) => textos.push({ texto: String(texto), x, y, alpha: t.globalAlpha === undefined ? 1 : t.globalAlpha });
      if (k === 'measureText') {
        return (texto) => {
          const m = /(\d+(?:\.\d+)?)px/.exec(t.font);
          return { width: String(texto).length * (m ? Number(m[1]) : 10) * 0.55 };
        };
      }
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (k in t) return t[k];
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  return { width: w, height: h, getContext: () => ctx, textos, hay: (re) => textos.some(x => re.test(x.texto)) };
}

const T0 = Date.UTC(2026, 9, 8, 2, 10);   // 8-oct 04:10 en Madrid
function instBase() {
  const i = crearMaqueta({ semilla: 7, ahora: T0 }).instantanea();
  return JSON.parse(JSON.stringify(i));
}

test('pantalla gigante: con 14 cotizaciones (modo Alpaca) se pintan las 14, no solo las 6 cripto', () => {
  const i = instBase();
  for (const e of ['SPY', 'QQQ', 'IWM', 'TLT', 'GLD', 'DIA', 'EFA', 'VNQ']) {
    i.cotizaciones.push({ simbolo: e, etiqueta: e, precio: 500, var24hPct: 0.001, t: T0 - 30000 });
  }
  const tex = lienzoFalso(1800, 340);
  dibujo.pintarPantallaGigante(tex, i, {});
  for (const q of i.cotizaciones) assert.ok(tex.textos.some(x => x.texto === q.etiqueta), `falta ${q.etiqueta}`);
  // Dos columnas dentro del bloque de cotizaciones (antes de la curva, x < 584) y dentro de la altura.
  const filas = tex.textos.filter(x => i.cotizaciones.some(q => q.etiqueta === x.texto));
  assert.ok(filas.every(x => x.x < 584 && x.y <= 316), JSON.stringify(filas.map(x => [x.texto, x.x, x.y])));
  // Con más de 14 se dice cuántas faltan.
  const j = instBase();
  for (let k = 0; k < 12; k++) j.cotizaciones.push({ simbolo: `X${k}`, etiqueta: `X${k}`, precio: 10, var24hPct: 0, t: T0 });
  const tex2 = lienzoFalso(1800, 340);
  dibujo.pintarPantallaGigante(tex2, j, {});
  assert.ok(tex2.hay(/^\+5 más$/), 'con 18 cotizaciones: 13 y «+5 más»');
});

test('pantalla gigante: un precio parado se pinta apagado y dice su edad', () => {
  const i = instBase();
  i.cotizaciones[0].t = T0 - 120 * 60000;               // BTC con 2 h
  const tex = lienzoFalso(1800, 340);
  dibujo.pintarPantallaGigante(tex, i, {});
  assert.ok(tex.hay(/^hace 2 h$/), 'la edad en lugar de la variación');
  const btc = tex.textos.find(x => x.texto === 'BTC');
  assert.ok(btc.alpha < 1, 'la fila de BTC va apagada');
  const eth = tex.textos.find(x => x.texto === 'ETH');
  assert.equal(eth.alpha, 1, 'la de ETH, fresca, no');
});

test('hechos de la mesa: una ejecución de otro día lleva su fecha', () => {
  const i = instBase();
  i.ejecuciones = [
    { t: Date.UTC(2026, 9, 5, 8, 0), puestoId: 'x', simbolo: 'ETH/USD', etiqueta: 'ETH', lado: 'venta', cantidad: 1, precio: 2500, nocional: 2500, comision: 1, motivo: 'señal' },
    { t: T0 - 3600000, puestoId: 'y', simbolo: 'BTC/USD', etiqueta: 'BTC', lado: 'compra', cantidad: 0.01, precio: 80000, nocional: 800, comision: 1, motivo: 'señal' },
  ];
  const tex = lienzoFalso(1800, 340);
  dibujo.pintarPantallaGigante(tex, i, {});
  assert.ok(tex.hay(/^5 oct 10:00$/), 'la de hace 66 h, con fecha');
  assert.ok(tex.hay(/^03:10$/), 'la de hace una hora, solo la hora');
  assert.ok(!tex.hay(/^10:00$/), 'nunca «10:00» a secas para la del día 5');
});

test('pantalla gigante: el «solo cerrar» del Megáfono o del comité sale aunque fondo.nivel sea normal', () => {
  const i = instBase();
  i.directivas.soloCerrarHasta = T0 + 6 * 3600000;
  let tex = lienzoFalso(1800, 340);
  dibujo.pintarPantallaGigante(tex, i, {});
  assert.ok(tex.hay(/^SOLO CERRAR HASTA 10:10 · MEGÁFONO$/), tex.textos.map(x => x.texto).join(' | '));
  i.directivas.soloCerrarHasta = null;
  i.directivas.modo = 'SOLO_CERRAR';
  tex = lienzoFalso(1800, 340);
  dibujo.pintarPantallaGigante(tex, i, {});
  assert.ok(tex.hay(/^SOLO CERRAR · COMITÉ$/));
  i.directivas.modo = 'DEFENSIVO';
  tex = lienzoFalso(1800, 340);
  dibujo.pintarPantallaGigante(tex, i, {});
  assert.ok(tex.hay(/^DEFENSIVO ×0,5$/));
  i.directivas.modo = 'NORMAL';
  tex = lienzoFalso(1800, 340);
  dibujo.pintarPantallaGigante(tex, i, {});
  assert.ok(!tex.hay(/SOLO CERRAR|DEFENSIVO/), 'sin nada que bloquee, sin franja');
});

test('pantalla del comité: «SOLO CERRAR» con espacio y cabiendo en la textura', () => {
  const i = instBase();
  i.cabecera.modoComite = 'SOLO_CERRAR';
  const tex = lienzoFalso(340, 140);
  dibujo.pintarPantallaComite(tex, i, T0);
  assert.ok(tex.hay(/^SOLO CERRAR$/));
  assert.ok(!tex.hay(/SOLO_CERRAR/));
});

test('límites: con el fondo en su máximo y sin pérdida no sale «-0,00 %»', () => {
  const i = instBase();
  i.cabecera.caida = 0;
  i.cabecera.pnlDiaPct = 0.004;
  i.cabecera.vigilancia = { perdidaDiaPct: 0.004, caidaPct: 0, desdeReapertura: false };
  const tex = lienzoFalso(480, 270);
  dibujo.pintarLimites(tex, i);
  assert.ok(!tex.hay(/^-0,00 %| -0,00 %/), tex.textos.map(x => x.texto).join(' | '));
  assert.ok(tex.hay(/^0,00 % \/ −2,00 %$/));
  assert.ok(!tex.hay(/reapertura/));
});

test('límites: las barras son lo que mide el vigilante (cabecera.vigilancia), no el resultado histórico', () => {
  const i = instBase();
  // Tras reabrir un kill: la cabecera cuenta −16 % desde el máximo histórico y
  // −3 % en el día real; el vigilante mide −1 % y −0,5 % desde la reapertura.
  i.cabecera.caida = -0.16;
  i.cabecera.pnlDiaPct = -0.03;
  i.cabecera.vigilancia = { perdidaDiaPct: -0.005, caidaPct: -0.01, desdeReapertura: true };
  const tex = lienzoFalso(480, 270);
  dibujo.pintarLimites(tex, i);
  const todo = tex.textos.map(x => x.texto).join(' | ');
  assert.ok(tex.hay(/^-0,50 % \/ −2,00 %$/), todo);
  assert.ok(tex.hay(/^-1,00 % \/ −15 %$/), todo);
  assert.ok(!tex.hay(/-16|-3,00/), todo);
  assert.ok(tex.hay(/^medido desde la reapertura$/), todo);
  // Antes del cierre diario del día (sin referencia del día) no se inventa un 0.
  i.cabecera.vigilancia = { perdidaDiaPct: null, caidaPct: 0, desdeReapertura: false };
  const t2 = lienzoFalso(480, 270);
  dibujo.pintarLimites(t2, i);
  assert.ok(t2.hay(/^— \/ −2,00 %$/), t2.textos.map(x => x.texto).join(' | '));
});

test('relojes de pared con la hora de la MESA y fuera de la capa estática', () => {
  const tex = lienzoFalso(800, 140);
  dibujo.pintarRelojesTex(tex, T0);                    // 02:10 UTC
  assert.ok(tex.hay(/^04:10$/), 'MADRID a las 04:10 de la mesa');
  assert.ok(tex.hay(/^22:10$/), 'NUEVA YORK');
  // La capa estática (que se repintaba con la hora real) ya no pinta relojes.
  const mapa = require('../web/js/mapa.js').construirMapa(instBase());
  const capa = lienzoFalso(2000, 1200);
  dibujo.pintarEdificio(capa.getContext(), mapa, {});
  assert.ok(!capa.hay(/MADRID|NUEVA YORK/), 'ni relojes ni hora real en la capa');
  // El cielo de las ventanas sigue la hora de la mesa: de noche a las 04:10, de día a las 12:10.
  assert.equal(dibujo.colorCielo(dibujo.horaDe(T0))[0], '#070d24');
  assert.equal(dibujo.colorCielo(dibujo.horaDe(T0 + 8 * 3600000))[0], '#7fb4f0');
});

test('texto del nivel efectivo', () => {
  assert.equal(dibujo.textoNivel({ nivel: 'normal', defensivo: false }), '');
  assert.equal(dibujo.textoNivel({ nivel: 'pausado' }), 'PAUSADO · SOLO CERRAR');
  assert.equal(dibujo.textoNivel({ nivel: 'solo_cerrar', origen: 'fondo' }), 'SOLO CERRAR');
});
