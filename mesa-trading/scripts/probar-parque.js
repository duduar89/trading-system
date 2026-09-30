'use strict';
// Casos conocidos del parqué (interfaz). Cada uno con su resultado calculado a
// mano; imprime OK/FALLO y sale con código 1 si alguno falla.
//   node scripts/probar-parque.js

const iso = require('../web/js/iso.js');
const cifras = require('../web/js/cifras.js');
const mapa = require('../web/js/mapa.js');
const dibujo = require('../web/js/dibujo.js');
const pers = require('../web/js/personajes.js');
const { crearMaqueta } = require('../web/js/maqueta.js');
const formato = require('../src/util/formato.js');

let fallos = 0;
function caso(nombre, obtenido, esperado, tolerancia) {
  const ok = typeof esperado === 'number' && typeof obtenido === 'number'
    ? Math.abs(obtenido - esperado) <= (tolerancia || 1e-9)
    : JSON.stringify(obtenido) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log(`${ok ? 'OK   ' : 'FALLO'} ${nombre}: ${JSON.stringify(obtenido)}${ok ? '' : ` (esperado ${JSON.stringify(esperado)})`}`);
}

// 1. Proyección 2:1: x = (col − fila)·32 ; y = (col + fila)·16 − z.
caso('proyectar(3, 1)', iso.proyectar(3, 1), { x: 64, y: 64 });
caso('proyectar(28, 0, 88): esquina derecha en lo alto de la pared', iso.proyectar(28, 0, 88), { x: 896, y: 360 });
caso('desproyectar(64, 64)', iso.desproyectar(64, 64), { col: 3, fila: 1 });

// 2. Formato: el navegador escribe las cifras igual que el servidor.
caso('usd(99.999)', cifras.usd(99999), '99.999 $');
caso('usd(−1)', cifras.usd(-1), '-1,00 $');
caso('pct(0,0019, signo)', cifras.pct(0.0019, { signo: true }), '+0,19 %');
caso('precio(0,1234) de DOGE', cifras.precio(0.1234), '0,1234');
caso('usd igual que src/util/formato', cifras.usd(100503.27), formato.usd(100503.27));
caso('cuenta atrás de 83 min', cifras.cuentaAtras(83 * 60000), '01:23');
caso('cuenta atrás de 30 s (redondea arriba)', cifras.cuentaAtras(30000), '00:01');
caso('suavizar(0,5) = 1 − 0,5³', cifras.suavizar(0.5), 0.875);

// 3. Monitores: umbral ±0,1 % y destellos de 2 s.
const pos = p => ({ posicion: { pnlAbiertoPct: p } });
caso('monitor con +0,15 %', dibujo.estadoMonitor(pos(0.0015), null, 0), 'verde');
caso('monitor con −0,15 %', dibujo.estadoMonitor(pos(-0.0015), null, 0), 'rojo');
caso('monitor con +0,05 %', dibujo.estadoMonitor(pos(0.0005), null, 0), 'plano');
caso('monitor sin posición', dibujo.estadoMonitor({ posicion: null }, null, 0), 'sin');
caso('monitor 1,5 s después de una orden', dibujo.estadoMonitor(pos(0.01), { tipo: 'orden', hasta: 2000 }, 1500), 'orden');
caso('monitor 2,5 s después de una orden', dibujo.estadoMonitor(pos(0.01), { tipo: 'orden', hasta: 2000 }, 2500), 'verde');

// 4. Bocadillos: 6 s + 60 ms/carácter, tope 12 s.
caso('bocadillo de 50 caracteres', pers.duracionBocadillo('x'.repeat(50)), 9000);
caso('bocadillo de 150 caracteres', pers.duracionBocadillo('x'.repeat(150)), 12000);
caso('bocadillo partido en ≤ 40', pers.partirTexto('Sin posición en SOL. Esperando a que SMA 7-25 dé LONG con filtro 200 (4H).'),
  ['Sin posición en SOL. Esperando a que SMA', '7-25 dé LONG con filtro 200 (4H).']);

// 5. Plano con las 4 mesas iniciales.
const T0 = Date.UTC(2026, 8, 29, 12);
const maqueta = crearMaqueta({ semilla: 7, ahora: T0 });
const inst = maqueta.instantanea();
const plano = mapa.construirMapa(inst);
const btc = plano.puestos.get('tendencia-BTC');
// Ancho de puesto = min(2,5; 15,2/6) = 2,5 y hueco 0,28 → tablero de 2,6 + 0,14 a 2,6 + 2,5 − 0,14.
caso('primer tablero del parqué, col inicial', btc.c0, 2.74);
caso('primer tablero del parqué, col final', btc.c1, 4.96);
caso('filas del parqué (paso 3)', Array.from(new Set(Array.from(plano.puestos.values()).map(p => p.f0))), [3.2, 6.2, 9.2, 12.2]);
const sitios = mapa.asignarSitios(plano, inst.agentes, inst.departamentos);
caso('silla de la Presidenta en dirección', [sitios.get('cio').col, sitios.get('cio').fila], [23.5, 2.45]);
caso('operador de momentum-SOL en la silla de su puesto', sitios.get('puesto-momentum-SOL').puestoId, 'momentum-SOL');
caso('elevación de la tarima de macro en (20,1; 6) = 14·0,1/0,35', mapa.elevacionEn(20.1, 6), 4);

// 6. Ruta de dirección al comité: sale por la puerta (20; 2) y entra por (15; 16).
const r = mapa.ruta(plano, { col: 23.5, fila: 2.45 }, { col: 18.55, fila: 19.1 });
let puertaDireccion = null; let puertaComite = null;
for (let k = 0; k < r.length - 1; k++) {
  const a = r[k]; const b = r[k + 1];
  if ((a.col - 20) * (b.col - 20) < 0) puertaDireccion = a.fila + (b.fila - a.fila) * (20 - a.col) / (b.col - a.col);
  if ((a.fila - 16) * (b.fila - 16) < 0) puertaComite = a.col + (b.col - a.col) * (16 - a.fila) / (b.fila - a.fila);
}
caso('cruza col 20 dentro de la puerta de dirección (2 ± 0,75)', Math.abs(puertaDireccion - 2) < 0.75, true);
caso('cruza fila 16 dentro de la puerta del comité (15 ± 0,75)', Math.abs(puertaComite - 15) < 0.75, true);

// 7. Maqueta: la contabilidad cuadra y la forma es la de §7.
const valor = inst.posiciones.reduce((s, p) => s + p.cantidad * p.precio, 0);
caso('patrimonio = efectivo + Σ valor de posiciones', maqueta._interno.efectivo() + valor, maqueta._interno.patrimonio(), 1e-6);
caso('exposición bruta = Σ valor / patrimonio', inst.cabecera.exposicionBrutaPct, valor / maqueta._interno.patrimonio(), 1e-9);
// 25 desde el 30-sep-2026: se añade listoParaReal (el semáforo «¿Listo para dinero real?», §7).
caso('25 campos de primer nivel en la instantánea', Object.keys(inst).length, 25);
caso('el semáforo trae los criterios a-g', inst.listoParaReal.criterios.map(k => k.id).join(''), 'abcdefg');
caso('… y cuántos cumple', inst.listoParaReal.cumplidos, inst.listoParaReal.criterios.filter(k => k.ok).length);
caso('puestos de la maqueta (3 + 6 + 2 + 3)', inst.puestos.length, 14);
const comprado = maqueta.comando('megafono', { texto: 'pausa SOL 6 h' });
caso('Megáfono «pausa SOL 6 h»', comprado.datos.directivas, [{ tipo: 'pausar_activo', simbolo: 'SOL/USD', horas: 6 }]);
caso('kill switch sin escribir KILL', maqueta.comando('kill', { confirmacion: 'kil' }).ok, false);

// 8. Lo que la pantalla tiene que decir bien (revisión de la interfaz).
caso('caída con el fondo en su máximo: sin signo', cifras.pct(-0), '0,00 %');
caso('−2,83 $ sobre 100.000 $ en % con signo', cifras.pct(-0.0000283, { signo: true }), '0,00 %');
caso('hora del feed en Madrid (19:44 UTC)', cifras.hora(Date.UTC(2026, 8, 29, 19, 44)), '21:44');
caso('ejecución de hace 66 h con fecha', cifras.momento(Date.UTC(2026, 9, 5, 8, 0), Date.UTC(2026, 9, 8, 2, 10)), '5 oct 10:00');
caso('estado de mesa con tilde', cifras.estadoMesa('incubacion'), 'Incubación');
caso('modo del comité sin guion bajo', cifras.modoComite('SOLO_CERRAR'), 'SOLO CERRAR');
const sa = cifras.sinAsignar(inst);
// Arranque del 30-sep-2026: Momentum 40 % y Tendencia, Reversión y Ruptura en prueba al 2 % (antes Ruptura era titular al 40 %: 16 %).
caso('capital sin asignar en el arranque (1 − 0,02 − 0,40 − 0,02 − 0,02)', sa.fraccion, 0.54, 1e-12);
caso('… y lo mismo contado desde los pesos de las mesas', cifras.sinAsignar({ ...inst, cabecera: { ...inst.cabecera, sinAsignar: undefined } }).fraccion, 0.54, 1e-12);
const soloMeg = cifras.nivelEfectivo({ ...inst, directivas: { ...inst.directivas, soloCerrarHasta: T0 + 6 * 3600000 } }, T0);
caso('«solo cerrar 6 h» del Megáfono con fondo normal', [soloMeg.nivel, soloMeg.origen], ['solo_cerrar', 'Megáfono']);
const conMesas = n => {
  const mesas = []; const puestos = [];
  for (let k = 0; k < n; k++) {
    const universo = ['BTC', 'ETH', 'SOL', 'LINK', 'AVAX'].slice(0, 2 + (k % 4));
    mesas.push({ id: `m${k}`, nombre: `Mesa ${k}`, marco: '1Day', estado: 'titular', universo });
    for (const e of universo) puestos.push({ id: `m${k}-${e}`, mesaId: `m${k}`, etiqueta: e });
  }
  return { mesas, puestos, agentes: [] };
};
// 12 mesas: se juntan hasta 6 filas; paso = (12,9 − 3,2) / 5 = 1,94 (la silla llega a fila + 1,85).
const filas12 = Array.from(new Set(Array.from(mapa.construirMapa(conMesas(12)).puestos.values()).map(p => p.f0))).sort((a, b) => a - b);
caso('12 mesas: filas del parqué', filas12, [3.2, 5.14, 7.08, 9.02, 10.96, 12.9]);

// 9. Pulido final (revisión FINAL): tamaño real, señal, rótulos y cotizaciones.
const hasta = T0 + 3 * 3600000;
const defMeg = cifras.nivelEfectivo({ ahora: T0, fondo: { nivel: 'normal', multiplicadorCaida: 1 }, directivas: { modo: 'DEFENSIVO', reduccion: { factor: 0.5, hasta } } }, T0);
caso('DEFENSIVO (×0,5 al capital de la mesa) y Megáfono «a la mitad» (×0,5 al nocional): 0,5 · 0,5', defMeg.tamano.factor, 0.25, 1e-12);
caso('píldora con los dos', cifras.rotuloTamano(defMeg.tamano), 'DEFENSIVO + MEGÁFONO ×0,25');
caso('con la caída del vigilante además: 0,5 · 0,5 · 0,5', cifras.tamanoEntradas(true, { factor: 0.5 }, 0.5).factor, 0.125, 1e-12);
caso('última señal «nada» en la ficha', cifras.accionSenal('nada'), 'Esperar');
const junto = dibujo.colocarRotulos([{ id: 'r', inicio: { x: 40, y: 100 }, fin: null, formas: [{ texto: 'RUPTURA DONCHIAN · 1D', w: 150 }, { texto: 'RUPTURA DONCHIAN', w: 120 }], prioridad: 0.4 }],
  { ancho: 390, alto: 844, h: 14, ocupado: [] });
// Acabaría en x = 40: con 150 px empezaría en −110; pegado al borde (x = 4) cabe entero sin pisar nada.
caso('rótulo cuyo sitio empieza en x = −110: pegado al borde, dentro del lienzo', junto.map(r => [r.x, r.x + r.w]), [[4, 154]]);
const cot = crearMaqueta({ semilla: 7, ahora: T0 }).instantanea();
const medidas = { font: '' };
const ctxMedir = { set font(f) { medidas.font = f; }, get font() { return medidas.font; }, measureText: t => ({ width: t.length * Number(/(\d+)px/.exec(medidas.font)[1]) * 0.55 }) };
// DOGE (4 × 20 × 0,55 = 44), «108.974» (7 × 11 = 77), «▲ +10,37 %» (10 × 18 × 0,55 = 99): 44 + 12 + 77 + 12 + 99 = 244 ≤ 260.
const filasCot = [{ simbolo: 'DOGE/USD', etiqueta: 'DOGE', precio: 108974, var24hPct: 0.1037, t: T0 }];
const disp = dibujo.disposicionCotizaciones(ctxMedir, filasCot, { ahora: T0, limites: cot.limites }, { fuente: 20, xPrecio: 0, ancho: 260 });
caso('dos columnas: precio acaba en 44 + 12 + 77 = 133 y la variación en 260, con flecha', [disp.xPrecio, disp.xVar, disp.flecha, disp.fuente], [133, 260, true, 20]);

console.log(fallos ? `\n${fallos} caso(s) con FALLO` : '\nTodos los casos cuadran.');
process.exit(fallos ? 1 : 0);
