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
      if (k === 'fillText') return (texto, x, y) => textos.push({ texto: String(texto), x, y, alpha: t.globalAlpha === undefined ? 1 : t.globalAlpha, font: t.font, align: t.textAlign || 'left' });
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
  // DEFENSIVO: el servidor lo cuenta en fondo.factorTamano (§7), que es lo que manda.
  i.directivas.modo = 'DEFENSIVO';
  i.fondo.factorTamano = { total: 0.5, comite: 0.5, megafono: 1, caida: 1 };
  tex = lienzoFalso(1800, 340);
  dibujo.pintarPantallaGigante(tex, i, {});
  assert.ok(tex.hay(/^DEFENSIVO ×0,5$/));
  i.directivas.modo = 'NORMAL';
  i.fondo.factorTamano = { total: 1, comite: 1, megafono: 1, caida: 1 };
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
  assert.ok(tex.hay(/^0,00 % \/ -2,00 %$/));
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
  assert.ok(tex.hay(/^-0,50 % \/ -2,00 %$/), todo);
  assert.ok(tex.hay(/^-1,00 % \/ -15 %$/), todo);
  assert.ok(!tex.hay(/-16|-3,00/), todo);
  assert.ok(tex.hay(/^medido desde la reapertura$/), todo);
  // Antes del cierre diario del día (sin referencia del día) no se inventa un 0.
  i.cabecera.vigilancia = { perdidaDiaPct: null, caidaPct: 0, desdeReapertura: false };
  const t2 = lienzoFalso(480, 270);
  dibujo.pintarLimites(t2, i);
  assert.ok(t2.hay(/^— \/ -2,00 %$/), t2.textos.map(x => x.texto).join(' | '));
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

// Caja de un texto pintado en el lienzo falso (misma medida que su measureText;
// alto: 0,8 del cuerpo por encima de la línea base y 0,2 por debajo).
function caja(t) {
  const px = Number(/(\d+(?:\.\d+)?)px/.exec(t.font)[1]);
  const w = t.texto.length * px * 0.55;
  const x0 = t.align === 'right' ? t.x - w : t.align === 'center' ? t.x - w / 2 : t.x;
  return { x0, x1: x0 + w, y0: t.y - px * 0.8, y1: t.y + px * 0.2, texto: t.texto };
}
const pisan = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
function solapes(textos) {
  const cajas = textos.map(caja);
  const out = [];
  for (let a = 0; a < cajas.length; a++) for (let b = a + 1; b < cajas.length; b++) if (pisan(cajas[a], cajas[b])) out.push(`«${cajas[a].texto}» / «${cajas[b].texto}»`);
  return out;
}

test('límites tras reabrir un kill: «medido desde la reapertura» no se monta sobre el título', () => {
  const i = instBase();
  i.cabecera.vigilancia = { perdidaDiaPct: 0, caidaPct: 0, desdeReapertura: true };
  const tex = lienzoFalso(480, 270);
  dibujo.pintarLimites(tex, i);
  assert.ok(tex.hay(/^LÍMITES DEL FONDO$/) && tex.hay(/^medido desde la reapertura$/));
  assert.deepEqual(solapes(tex.textos), []);
  // Todo dentro de la textura.
  for (const c of tex.textos.map(caja)) assert.ok(c.x0 >= 0 && c.x1 <= 480 && c.y0 >= 0 && c.y1 <= 270, JSON.stringify(c));
});

test('pantalla gigante con 15 cotizaciones: la variación nunca se monta sobre el precio', () => {
  const i = instBase();
  const vars = { BTC: 0.0481, ETH: -0.1234, SOL: 0.0815, LINK: 0.0898, AVAX: -0.0615, DOGE: 0.1037 };
  const precios = { BTC: 108974, ETH: 5107, SOL: 172.04, LINK: 14.79, AVAX: 35.34, DOGE: 0.1795 };
  for (const q of i.cotizaciones) { q.var24hPct = vars[q.etiqueta]; q.precio = precios[q.etiqueta]; q.t = T0; }
  for (const e of ['SPY', 'QQQ', 'IWM', 'TLT', 'GLD', 'XLE', 'XLF', 'EEM', 'DIA']) {
    i.cotizaciones.push({ simbolo: e, etiqueta: e, precio: 466.85, var24hPct: -0.1234, t: T0 });
  }
  const tex = lienzoFalso(1800, 340);
  dibujo.pintarPantallaGigante(tex, i, {});
  // Bloque de cotizaciones: de x = 30 a la raya de 584, bajo el rótulo COTIZACIONES.
  const bloque = tex.textos.filter(t => t.y > 110 && t.x < 600 && caja(t).x1 < 600);
  assert.ok(bloque.length >= 13 * 3, `filas pintadas: ${bloque.length}`);
  for (const t of bloque) assert.ok(caja(t).x1 <= 584, `se sale del bloque: ${t.texto}`);
  // Por fila (misma y): etiqueta, precio y variación con al menos 8 px entre cada dos.
  const filas = new Map();
  for (const t of bloque) { const k = `${t.y}|${t.x < 300 ? 0 : 1}`; if (!filas.has(k)) filas.set(k, []); filas.get(k).push(caja(t)); }
  for (const [k, cajas] of filas) {
    cajas.sort((a, b) => a.x0 - b.x0);
    for (let j = 1; j < cajas.length; j++) {
      assert.ok(cajas[j].x0 - cajas[j - 1].x1 >= 8, `fila ${k}: «${cajas[j - 1].texto}» y «${cajas[j].texto}» a ${(cajas[j].x0 - cajas[j - 1].x1).toFixed(1)} px`);
    }
  }
  assert.deepEqual(solapes(bloque), []);
});

test('pantalla gigante: con 6 cotizaciones sigue la columna ancha de siempre', () => {
  const i = instBase();
  const tex = lienzoFalso(1800, 340);
  dibujo.pintarPantallaGigante(tex, i, {});
  const precioBtc = tex.textos.find(t => t.align === 'right' && t.y === 142 && /^\d/.test(t.texto));
  assert.equal(precioBtc.x, 30 + 360, 'el precio sigue alineado a x = 390');
});

test('franja de la pantalla gigante con el tamaño real (DEFENSIVO × Megáfono)', () => {
  const i = instBase();
  i.directivas.modo = 'DEFENSIVO';
  i.directivas.reduccion = { factor: 0.5, hasta: T0 + 3 * 3600000 };
  i.fondo.factorTamano = { total: 0.25, comite: 0.5, megafono: 0.5, caida: 1 };
  let tex = lienzoFalso(1800, 340);
  dibujo.pintarPantallaGigante(tex, i, {});
  assert.ok(tex.hay(/^DEFENSIVO \+ MEGÁFONO ×0,25$/), tex.textos.map(x => x.texto).join(' | '));
  i.directivas.modo = 'NORMAL';
  i.fondo.factorTamano = { total: 0.5, comite: 1, megafono: 0.5, caida: 1 };
  tex = lienzoFalso(1800, 340);
  dibujo.pintarPantallaGigante(tex, i, {});
  assert.ok(tex.hay(/^RIESGO ×0,5 HASTA 07:10 · MEGÁFONO$/), tex.textos.map(x => x.texto).join(' | '));
  // Servidor sin factorTamano: se saca de las directivas y de la caída.
  delete i.fondo.factorTamano;
  i.directivas.modo = 'DEFENSIVO';
  i.fondo.multiplicadorCaida = 0.5;
  assert.equal(dibujo.textoNivel(require('../web/js/cifras.js').nivelEfectivo(i, T0)), 'DEFENSIVO + MEGÁFONO + CAÍDA ×0,125');
});

// ---------- rótulos de fila en pantalla ----------
const formas = (largo, corto, px = 6) => [{ texto: largo, w: largo.length * px + 20 }, { texto: corto, w: corto.length * px + 20 }];

test('rótulos: nunca fuera del lienzo (en el móvil empezaban en x = −35 … −133)', () => {
  // Cuatro filas cuyo principio cae junto al borde izquierdo de un lienzo de 390.
  const items = [
    { id: 'tendencia', inicio: { x: 150, y: 200 }, fin: { x: 280, y: 250 }, formas: formas('TENDENCIA SMA · 4H · INCUBACIÓN', 'TENDENCIA SMA'), prioridad: 0.02 },
    { id: 'momentum', inicio: { x: 102, y: 224 }, fin: { x: 360, y: 330 }, formas: formas('MOMENTUM CRIPTO · 1D', 'MOMENTUM CRIPTO'), prioridad: 0.4 },
    { id: 'reversion', inicio: { x: 54, y: 248 }, fin: { x: 150, y: 280 }, formas: formas('REVERSIÓN RSI · 1D · INCUBACIÓN', 'REVERSIÓN RSI'), prioridad: 0.02 },
    { id: 'ruptura', inicio: { x: 6, y: 272 }, fin: { x: 130, y: 320 }, formas: formas('RUPTURA DONCHIAN · 1D', 'RUPTURA DONCHIAN'), prioridad: 0.4 },
  ];
  // Etiquetas de puesto ya pintadas: el primer puesto de cada fila.
  const ocupado = [{ x: 156, y: 205, w: 36, h: 22 }, { x: 108, y: 229, w: 36, h: 22 }, { x: 60, y: 253, w: 36, h: 22 }, { x: 12, y: 277, w: 36, h: 22 }];
  const r = dibujo.colocarRotulos(items, { ancho: 390, alto: 844, h: 14, ocupado });
  for (const x of r) {
    assert.ok(x.x >= 4 && x.x + x.w <= 386, `${x.id} fuera: ${x.x}…${x.x + x.w}`);
    for (const b of ocupado.concat(r.filter(o => o !== x))) {
      assert.ok(!(x.x < b.x + b.w && b.x < x.x + x.w && x.y < b.y + b.h && b.y < x.y + x.h), `${x.id} pisa algo`);
    }
  }
  assert.ok(r.length >= 3, `se ven ${r.map(x => x.id)}`);
  // La de siempre si cabe: con sitio de sobra, a la izquierda de la fila y con el texto largo.
  const holgado = dibujo.colocarRotulos([{ id: 'a', inicio: { x: 400, y: 100 }, fin: null, formas: formas('TENDENCIA SMA · 4H', 'TENDENCIA SMA'), prioridad: 0.4 }],
    { ancho: 1440, alto: 900, h: 16, ocupado: [] });
  assert.deepEqual(holgado.map(x => [x.x + x.w, x.forma]), [[400, 0]]);
});

test('rótulos: con poco sitio cede la mesa de menos peso, no la titular del 40 %', () => {
  // Dos rótulos que solo caben uno: la incubada va antes en la lista (orden de fila).
  const items = [
    { id: 'incubada', inicio: { x: 300, y: 100 }, fin: null, formas: formas('TENDENCIA 2 · 4H · INCUBACIÓN', 'TENDENCIA 2'), prioridad: 0.02 },
    { id: 'ruptura', inicio: { x: 300, y: 100 }, fin: null, formas: formas('RUPTURA DONCHIAN · 1D', 'RUPTURA DONCHIAN'), prioridad: 0.4 },
  ];
  const ocupado = [{ x: 0, y: 90, w: 110, h: 40 }];
  const r = dibujo.colocarRotulos(items, { ancho: 1440, alto: 900, h: 16, ocupado });
  assert.deepEqual(r.map(x => x.id), ['ruptura']);
  // La elegida se ve siempre, dentro del lienzo.
  const sel = dibujo.colocarRotulos([Object.assign({}, items[0], { seleccionado: true })].concat(items[1]), { ancho: 1440, alto: 900, h: 16, ocupado });
  assert.ok(sel.some(x => x.id === 'incubada' && x.x >= 4));
});

test('pantalla del parqué: el «solo cerrar» del Megáfono de más de un día dice la fecha', () => {
  const cifras = require('../web/js/cifras.js');
  const i = instBase();
  i.directivas.soloCerrarHasta = T0 + 72 * 3600000;       // 11 oct 04:10 en Madrid
  assert.equal(dibujo.textoNivel(cifras.nivelEfectivo(i, T0)), 'SOLO CERRAR HASTA 11 OCT 04:10 · MEGÁFONO');
  i.directivas.soloCerrarHasta = T0 + 3600000;
  assert.equal(dibujo.textoNivel(cifras.nivelEfectivo(i, T0)), 'SOLO CERRAR HASTA 05:10 · MEGÁFONO');
});

test('rótulos en el móvil con 7 mesas: la titular del 40 % (Ruptura) se ve y desplaza a la incubada del 2 %', () => {
  const cifras = require('../web/js/cifras.js');
  // Geometría real (Chromium 390×844, maqueta con 7 mesas, zoom 0,5): la fila
  // de Ruptura empieza en x = 100 y su primer puesto tapa desde x = 104; a su
  // izquierda caben 96 px y «RUPTURA DONCHIAN» pide 116.
  const filas = [
    ['tendencia', 'Tendencia SMA', '4Hour', 'incubacion', 0.02, [162, 111], [260, 156]],
    ['momentum', 'Momentum cripto', '1Day', 'titular', 0.4, [131, 126], null],
    ['reversion', 'Reversión RSI', '1Day', 'incubacion', 0.02, [131, 142], null],
    ['ruptura', 'Ruptura Donchian', '1Day', 'titular', 0.4, [100, 142], [197, 187]],
    ['etf-rot', 'Rotación ETF', '1Day', 'incubacion', 0.02, [69, 157], [313, 276]],
    ['tendencia-2', 'Tendencia rápida', '4Hour', 'incubacion', 0.02, [38, 173], [224, 262]],
    ['reversion-2', 'Reversión DOGE', '1Day', 'incubacion', 0.02, [7, 188], [104, 233]],
  ];
  const ocupado = [[166, 117, 31], [179, 131, 63], [225, 146, 31], [135, 132, 31], [164, 147, 31], [176, 161, 66], [221, 176, 34], [249, 191, 37],
    [260, 206, 74], [319, 224, 31], [349, 239, 31], [104, 148, 31], [117, 162, 63], [162, 177, 31], [73, 163, 31], [101, 178, 34], [130, 192, 33],
    [162, 207, 28], [190, 222, 32], [220, 237, 30], [250, 251, 30], [278, 266, 32], [42, 179, 31], [71, 193, 31], [100, 208, 31], [128, 223, 34],
    [156, 237, 37], [185, 252, 39], [7, 194, 39], [37, 209, 37], [68, 224, 34]].map(([x, y, w]) => ({ x, y, w, h: 20 }));
  const medir = texto => texto.length * 6;             // ≈ 800 8px de la fuente del parqué
  const inst = { ahora: T0, directivas: {}, mesas: [] };
  const items = filas.map(([id, nombre, marco, estado, peso, ini, fin]) => {
    const mesa = { id, nombre, marco, estado, peso };
    return { id, prioridad: peso, inicio: { x: ini[0], y: ini[1] }, fin: fin ? { x: fin[0], y: fin[1] } : null,
      formas: dibujo.formasRotulo({ mesaId: id, nombre, marco, estado }, mesa, inst, medir) };
  });
  const r = dibujo.colocarRotulos(items, { ancho: 390, alto: 698, h: 14, ocupado });
  const ids = r.map(x => x.id);
  assert.ok(ids.includes('ruptura'), `se ven ${ids}`);
  assert.ok(ids.includes('momentum'), `se ven ${ids}`);
  const rup = r.find(x => x.id === 'ruptura');
  assert.equal(rup.texto, 'RUPTURA', 'con el nombre corto, a la izquierda de su fila');
  assert.ok(rup.x + rup.w <= 100);
  // Nada se pisa ni se sale.
  for (const x of r) {
    assert.ok(x.x >= 4 && x.x + x.w <= 386, `${x.id} fuera`);
    for (const b of ocupado.concat(r.filter(o => o !== x))) {
      assert.ok(!(x.x < b.x + b.w && b.x < x.x + x.w && x.y < b.y + b.h && b.y < x.y + x.h), `${x.id} pisa algo`);
    }
  }
  // Una incubada no quita el sitio a una titular: si cae alguna, es de menos peso.
  const fuera = filas.filter(f => !ids.includes(f[0]));
  assert.ok(fuera.every(f => f[4] <= Math.min(...filas.filter(g => ids.includes(g[0])).map(g => g[4]))), `fuera: ${fuera.map(f => f[0])}`);
});

test('rótulos: la forma mínima solo se usa si no cabe ninguna otra en ningún sitio (en escritorio sigue el nombre entero)', () => {
  const inst = { ahora: T0, directivas: {}, mesas: [] };
  const medir = texto => texto.length * 6;
  const formas = dibujo.formasRotulo({ mesaId: 'ruptura', nombre: 'Ruptura Donchian', marco: '1Day', estado: 'titular' }, { nombre: 'Ruptura Donchian', marco: '1Day', estado: 'titular' }, inst, medir);
  assert.deepEqual(formas.map(f => f.texto), ['RUPTURA DONCHIAN · 1D', 'RUPTURA DONCHIAN', 'RUPTURA']);
  // Sin sitio a la izquierda de la fila pero sí detrás de su final: el nombre entero detrás, no el corto delante.
  const r = dibujo.colocarRotulos([{ id: 'ruptura', inicio: { x: 90, y: 100 }, fin: { x: 600, y: 300 }, formas, prioridad: 0.4 }],
    { ancho: 1440, alto: 900, h: 16, ocupado: [{ x: 0, y: 90, w: 20, h: 40 }] });   // «RUPTURA» sí cabría delante
  assert.equal(r[0].texto, 'RUPTURA DONCHIAN · 1D');
  // Un nombre de una palabra no repite forma.
  assert.equal(dibujo.formasRotulo({ mesaId: 'x', nombre: 'Rotación', marco: '1Day', estado: 'titular' }, { nombre: 'Rotación', marco: '1Day', estado: 'titular' }, inst, medir).length, 2);
});

test('límites: un solo signo menos en todo el panel (el de las cifras, «-»), no guion y «−» mezclados', () => {
  const i = instBase();
  i.cabecera.vigilancia = { perdidaDiaPct: -0.005, caidaPct: -0.01, desdeReapertura: false };
  const tex = lienzoFalso(480, 270);
  dibujo.pintarLimites(tex, i);
  const todo = tex.textos.map(x => x.texto).join(' | ');
  assert.ok(!/−/.test(todo), todo);
  assert.ok(tex.hay(/^-0,50 % \/ -2,00 %$/), todo);
});
