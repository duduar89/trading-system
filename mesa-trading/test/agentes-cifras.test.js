'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { verificarCifras, extraerNumeros, lecturas, vocabulario, contradiceVocabulario } = require('../src/agentes/cifras');
const { MODO_TEXTO, REGIMEN_TEXTO, NO_COMPRA, comoCompra, comprasEfectivas } = require('../src/agentes/plantillas');

test('cifras buenas: 1.234,56 $ presente como 1234.56 y 12,5 % presente como 0.125', () => {
  const r = verificarCifras('Patrimonio 1.234,56 $ y caída del 12,5 %.', { patrimonio: 1234.56, caida: 0.125 });
  assert.deepEqual(r, { ok: true, noEncontradas: [] });
});

test('cifras buenas en formato inglés y redondeadas a 0-2 decimales', () => {
  assert.equal(verificarCifras('Equity 1,234.56 $', { p: 1234.56 }).ok, true);
  // 84.123,4 redondeado a 0 decimales = 84.123; a 1 decimal = 84.123,4.
  assert.equal(verificarCifras('BTC en 84.123', { c: 84123.4 }).ok, true);
  assert.equal(verificarCifras('BTC en 84.123,4', { c: 84123.4 }).ok, true);
  // 1.234,56 $ pintado por formato.usd como «1.235 $»: redondeo a 0 decimales.
  assert.equal(verificarCifras('ganó 1.235 $', { pnl: 1234.56 }).ok, true);
  // Porcentaje con redondeo: 0,12534 → 12,53 % o 12,5 % o 13 %.
  assert.equal(verificarCifras('sube 12,53 %', { r: 0.12534 }).ok, true);
  assert.equal(verificarCifras('sube 13 %', { r: 0.12534 }).ok, true);
  // El signo lo pone la palabra: «pérdida de 45,20 $» con pnl −45,2.
  assert.equal(verificarCifras('pérdida de 45,20 $', { pnl: -45.2 }).ok, true);
});

test('cifras malas: un número inventado no pasa', () => {
  const r = verificarCifras('Patrimonio 1.234,56 $ y ganamos 1.999 $ hoy.', { patrimonio: 1234.56 });
  assert.equal(r.ok, false);
  assert.deepEqual(r.noEncontradas, ['1.999']);
  // 84.120 NO es el redondeo de 84.123,4 (sería 84.123).
  assert.deepEqual(verificarCifras('BTC en 84.120', { c: 84123.4 }).noEncontradas, ['84.120']);
  // Un porcentaje pequeño tampoco pasa gratis: «12 %» con caída real del 3 %.
  assert.deepEqual(verificarCifras('Cayó un 12 %', { c: 0.03 }).noEncontradas, ['12 %']);
});

test('enteros 0-31 sin unidad pasan siempre (conteos, días, horas)', () => {
  assert.equal(verificarCifras('3 operaciones en 12 días y 4 horas', {}).ok, true);
  assert.equal(verificarCifras('32 operaciones', {}).ok, false);
  assert.equal(verificarCifras('5 $', {}).ok, false);
});

test('números dentro de textos de la entrada cuentan como datos', () => {
  const entrada = { motivo: 'SMA7 84.120 > SMA25 83.900' };
  assert.equal(verificarCifras('La rápida está en 84.120 y la lenta en 83.900.', entrada).ok, true);
});

test('identificadores (SMA200, RSI2) no son cifras; las horas solo si están en los datos', () => {
  assert.equal(verificarCifras('Cierre sobre la SMA200 y RSI2 bajo', {}).ok, true);
  assert.deepEqual(verificarCifras('Comité a las 16:00', {}).noEncontradas, ['16:00']);
  assert.equal(verificarCifras('Comité a las 16:00', { proximo: '16:00' }).ok, true);
});

test('puntos básicos y multiplicadores k / M', () => {
  assert.equal(verificarCifras('deslizamiento de 5 pb', { d: 0.0005 }).ok, true);
  assert.equal(verificarCifras('BTC ronda los 84k', { p: 84123 }).ok, true);
  assert.equal(verificarCifras('BTC ronda los 90k', { p: 84123 }).ok, false);
  assert.equal(verificarCifras('volumen de 1,2 M', { v: 1234567 }).ok, true);
});

test('lecturas de números ambiguos', () => {
  assert.deepEqual(lecturas('1.234').map(l => l.valor), [1.234, 1234]);
  assert.deepEqual(lecturas('12,5').map(l => l.valor), [12.5]);
  assert.deepEqual(lecturas('1.234.567').map(l => l.valor), [1234567]);
  assert.deepEqual(lecturas('4.1.2'), []);
  assert.deepEqual(extraerNumeros('SMA 7-25, vol. 48 % y 0,0123 BTC. Fin.').numeros.map(n => n.texto), ['7', '25', '48 %', '0,0123']);
});

test('texto vacío o sin números: ok', () => {
  assert.equal(verificarCifras('', { a: 1 }).ok, true);
  assert.equal(verificarCifras(null, null).ok, true);
  assert.equal(verificarCifras('Sin posición. Esperando señal.', {}).ok, true);
});

test('signo: una pérdida escrita como ganancia no pasa (y al revés)', () => {
  // Caso de la revisión: «hoy +523,40 $» con el día en −523,40 $.
  assert.deepEqual(verificarCifras('hoy +523,40 $', { pnlDia: -523.4 }).noEncontradas, ['+523,40']);
  assert.equal(verificarCifras('hoy -523,40 $', { pnlDia: -523.4 }).ok, true);
  assert.equal(verificarCifras('+1.587,45 $', { pnl: -1587.45 }).ok, false);
  assert.equal(verificarCifras('−2,10 %', { r: 0.021 }).ok, false);
  assert.equal(verificarCifras('(+1,13 %)', { r: -0.0113 }).ok, false);
  assert.equal(verificarCifras('(-1,13 %)', { r: -0.0113 }).ok, true);
  // Sin signo escrito se sigue comparando el valor absoluto.
  assert.equal(verificarCifras('perdió 45,20 $', { pnl: -45.2 }).ok, true);
  // Un entero pequeño con signo ya no pasa gratis: «(+3)» con −3 puntos.
  assert.equal(verificarCifras('Régimen RISK-OFF (+3)', { puntos: -3 }).ok, false);
  assert.equal(verificarCifras('Régimen RISK-OFF (−3)', { puntos: -3 }).ok, true);
  // Guiones que no son signo: rangos y restas.
  assert.equal(verificarCifras('SMA 7-25 y 83.900 - 84.120', { a: 83900, b: 84120 }).ok, true);
  // Un cero redondeado no tiene signo que contradecir.
  assert.equal(verificarCifras('Caída -0,00 %', { c: 0 }).ok, true);
  assert.equal(verificarCifras('hoy +0,00 %', { r: -0.00001 }).ok, true);
  // El signo de un número escrito dentro de un texto de la entrada se conserva.
  assert.equal(verificarCifras('kill en -15 %', { regla: '(kill en -15 %)' }).ok, true);
  assert.equal(verificarCifras('kill en +15 %', { regla: '(kill en -15 %)' }).ok, false);
  assert.deepEqual(extraerNumeros('(-0,53 %) y +3').numeros.map(n => [n.texto, n.signo]), [['-0,53 %', -1], ['+3', 1]]);
});

// ---------- Conteos (reuniones y comité) ----------

test('conteos: con { conteos: true } un entero pequeño o escrito con letra tiene que estar en los datos', () => {
  // Caso de la revisión: el LLM inventaba las operaciones de la noche.
  const noche = { patrimonio: 100000, cambio: 0, operaciones: 0, pnlOperaciones: 0, desdeHora: '22:15' };
  assert.equal(verificarCifras('Esta noche hemos cerrado 7 operaciones, todas con ganancia.', noche).ok, true, 'sin la opción pasan libres, como siempre');
  assert.deepEqual(verificarCifras('Esta noche hemos cerrado 7 operaciones, todas con ganancia.', noche, { conteos: true }).noEncontradas, ['7']);
  assert.deepEqual(verificarCifras('Esta noche hemos cerrado cuatro operaciones.', noche, { conteos: true }).noEncontradas, ['cuatro']);
  assert.deepEqual(verificarCifras('Hoy se han cerrado dieciséis.', { operaciones: 3 }, { conteos: true }).noEncontradas, ['dieciséis']);
  // Los que sí están en los datos pasan, con cifra o con letra.
  assert.equal(verificarCifras('Esta noche no se ha cerrado ninguna operación.', noche, { conteos: true }).ok, true);
  assert.equal(verificarCifras('Tengo 2 ideas en prueba y tres aprobadas.', { enCurso: 2, aprobadas: 3 }, { conteos: true }).ok, true);
  assert.deepEqual(verificarCifras('Ninguna idea en prueba.', { enCurso: 2 }, { conteos: true }).noEncontradas, ['Ninguna']);
  // «Un», «una» son artículos: no cuentan. Las horas se siguen comprobando igual.
  assert.equal(verificarCifras('Una buena racha: próximo comité a las 12:00.', { proximo: '12:00' }, { conteos: true }).ok, true);
  assert.deepEqual(verificarCifras('Próximo comité a las 16:00.', { proximo: '12:00' }, { conteos: true }).noEncontradas, ['16:00']);
});

// ---------- Modo, voto y régimen en llano ----------

test('vocabulario: cada frase de MODO_TEXTO y REGIMEN_TEXTO (y las de «no compra») se reconoce como su valor', () => {
  for (const [modo, texto] of Object.entries(MODO_TEXTO)) {
    const v = vocabulario(`Seguimos: ${texto}.`);
    assert.deepEqual([...v.modos, ...v.compras], [modo], `${modo}: «${texto}»`);
  }
  for (const [regimen, texto] of Object.entries(REGIMEN_TEXTO)) {
    assert.deepEqual(vocabulario(`Hoy ${texto}.`).regimenes, [regimen], `${regimen}: «${texto}»`);
  }
  for (const texto of Object.values(NO_COMPRA)) assert.deepEqual(vocabulario(texto).compras, ['SOLO_CERRAR'], texto);
  // Por su nombre, en cualquier forma.
  assert.deepEqual(vocabulario('Seguimos en modo defensivo.').modos, ['DEFENSIVO']);
  assert.deepEqual(vocabulario('Voto normal.').modos, ['NORMAL']);
  assert.deepEqual(vocabulario('Toca solo cerrar.').modos, ['SOLO_CERRAR']);
  assert.deepEqual(vocabulario('El mercado está risk-off.').regimenes, ['RISK-OFF']);
  assert.deepEqual(vocabulario('Mercado neutral: ni a favor ni en contra.').regimenes, ['NEUTRAL'], '«ni a favor ni en contra» no es «a favor» ni «en contra»');
  // Lo que usa sus palabras sin ser un modo ni un régimen.
  assert.deepEqual(vocabulario('El índice de miedo y codicia está en 25 de 100.'), { modos: [], compras: [], regimenes: [] });
  assert.deepEqual(vocabulario('El fondo está en nivel solo cerrar y en nivel normal ayer.').modos, []);
  assert.deepEqual(vocabulario('Gracias, Inés. El fondo vale 100.000 $.'), { modos: [], compras: [], regimenes: [] });
});

test('contradiceVocabulario: los casos de la revisión (modo, voto y régimen dichos en llano al revés que los datos)', () => {
  // Reunión con modo NORMAL: «compras nuevas a la mitad» es DEFENSIVO.
  assert.equal(contradiceVocabulario('Seguimos con las compras nuevas a la mitad hasta el próximo comité.', { modos: ['NORMAL'], regimen: 'RISK-ON' }), true);
  assert.equal(contradiceVocabulario('Seguimos en modo defensivo: compras nuevas a la mitad.', { modos: ['NORMAL'], regimen: 'RISK-ON' }), true);
  // Comité: régimen RISK-ON y voto de Macro NORMAL.
  assert.equal(contradiceVocabulario('Gracias. El mercado tiene miedo: yo pondría las compras nuevas a la mitad. Mi voto: NORMAL.', { modos: ['NORMAL'], regimen: 'RISK-ON' }), true);
  assert.equal(contradiceVocabulario('El mercado tiene miedo esta mañana.', { regimen: 'RISK-ON' }), true);
  // Lo mismo dicho de acuerdo con los datos pasa.
  assert.equal(contradiceVocabulario('El mercado acompaña: compras a tamaño normal. Mi voto: NORMAL.', { modos: ['NORMAL'], regimen: 'RISK-ON' }), false);
  // Sin modo en sus datos, un turno no habla de modo (aunque acierte).
  assert.equal(contradiceVocabulario('Seguimos en NORMAL.', { modos: [], regimen: 'RISK-ON' }), true);
  // Con el fondo sin comprar, el modo se puede nombrar pero no decir que se compra.
  const bloqueado = { modos: ['DEFENSIVO'], compras: ['SOLO_CERRAR'], regimen: 'NEUTRAL' };
  assert.equal(contradiceVocabulario('Decido DEFENSIVO: compras nuevas a la mitad.', bloqueado), true);
  assert.equal(contradiceVocabulario('Decido DEFENSIVO; hoy no se compra nada.', bloqueado), false);
});

test('comoCompra: con el fondo fuera del nivel normal no se compra nada, y el factor es el real', () => {
  assert.equal(comoCompra({ modo: 'NORMAL' }), MODO_TEXTO.NORMAL, 'sin nivel ni factor, lo que significa el modo');
  assert.equal(comoCompra({ modo: 'NORMAL', nivel: 'bloqueado' }), NO_COMPRA.bloqueado);
  assert.equal(comoCompra({ modo: 'DEFENSIVO', nivel: 'solo_cerrar', factor: { total: 0.5, comite: 0.5, megafono: 1, caida: 1 } }), NO_COMPRA.solo_cerrar);
  assert.equal(comoCompra({ modo: 'DEFENSIVO', nivel: 'normal', factor: { total: 0.5, comite: 0.5, megafono: 1, caida: 1 } }), MODO_TEXTO.DEFENSIVO);
  assert.equal(comoCompra({ modo: 'NORMAL', nivel: 'normal', factor: { total: 0.5, comite: 1, megafono: 1, caida: 0.5 } }),
    'compras nuevas a ×0,5 del tamaño normal por la caída del fondo');
  assert.equal(comoCompra({ modo: 'DEFENSIVO', nivel: 'normal', factor: { total: 0.25, comite: 0.5, megafono: 1, caida: 0.5 } }),
    'compras nuevas a ×0,25 del tamaño normal por el modo DEFENSIVO y la caída del fondo');
  assert.equal(comoCompra({ modo: 'NORMAL', nivel: 'normal', soloCerrarHasta: '14:00' }), 'el fondo no compra nada: el Megáfono pide solo cerrar hasta las 14:00');
  // «a ×0,5 del tamaño normal» no se lee como «a tamaño normal».
  assert.deepEqual(vocabulario(comoCompra({ modo: 'NORMAL', nivel: 'normal', factor: { total: 0.5, comite: 1, megafono: 1, caida: 0.5 } })).compras, []);
  // Lo que el control de los textos del LLM acepta de las compras.
  assert.equal(comprasEfectivas({ modo: 'NORMAL', nivel: 'bloqueado' }), 'SOLO_CERRAR');
  assert.equal(comprasEfectivas({ modo: 'NORMAL', nivel: 'normal', factor: { total: 1 } }), 'NORMAL');
  assert.equal(comprasEfectivas({ modo: 'NORMAL', nivel: 'normal', factor: { total: 0.5, caida: 0.5 } }), 'DEFENSIVO', 'con la caída, «tamaño normal» no es verdad');
  assert.equal(comprasEfectivas({ modo: 'DEFENSIVO', nivel: 'normal', factor: { total: 0.25 } }), null, 'a ×0,25 ninguna frase llana es verdad');
  assert.equal(comprasEfectivas({ modo: 'NORMAL', nivel: 'normal', soloCerrarHasta: '14:00' }), 'SOLO_CERRAR');
});
