import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularAcumulacion, calcularCanje, calcularCaducidad,
         aplicarMultiplicadores, normalizarConfig } from '../motor-puntos.js';

const AHORA = '2026-03-11T13:00:00.000Z';   // miercoles
const base = (extra = {}) => normalizarConfig({ antipassback_minutos: 90, ...extra });

// --- modo sellos -------------------------------------------------------------

test('sellos: una visita suma exactamente un sello', () => {
  const r = calcularAcumulacion({ config: base(), ahora: AHORA });
  assert.equal(r.ok, true);
  assert.equal(r.puntos, 1);
});

test('sellos: por debajo del consumo minimo no suma', () => {
  const r = calcularAcumulacion({
    config: base({ sellos: { objetivo: 10, importe_minimo_cents: 500 } }),
    importe_cents: 300, ahora: AHORA });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'importe_minimo');
});

// --- modo puntos por euro ----------------------------------------------------

test('euro: 23,40 EUR a 1 punto/EUR redondea a la baja -> 23', () => {
  const r = calcularAcumulacion({
    config: base({ modo: 'puntos_por_euro' }), importe_cents: 2340, ahora: AHORA });
  assert.equal(r.puntos, 23);
});

test('euro: con redondeo "cercano", 23,40 -> 23 y 23,60 -> 24', () => {
  const cfg = base({ modo: 'puntos_por_euro', redondeo: 'cercano' });
  assert.equal(calcularAcumulacion({ config: cfg, importe_cents: 2340, ahora: AHORA }).puntos, 23);
  assert.equal(calcularAcumulacion({ config: cfg, importe_cents: 2360, ahora: AHORA }).puntos, 24);
});

test('euro: sin importe no se puede calcular', () => {
  const r = calcularAcumulacion({ config: base({ modo: 'puntos_por_euro' }), ahora: AHORA });
  assert.equal(r.motivo, 'falta_importe');
});

test('euro: un importe negativo se rechaza', () => {
  const r = calcularAcumulacion({ config: base({ modo: 'puntos_por_euro' }),
                                  importe_cents: -1000, ahora: AHORA });
  assert.equal(r.ok, false);
});

test('hibrido: sello de visita + puntos del ticket', () => {
  const r = calcularAcumulacion({ config: base({ modo: 'hibrido', puntos_por_euro: 2 }),
                                  importe_cents: 1000, ahora: AHORA });
  assert.equal(r.puntos, 21);   // 1 sello + 20 puntos
});

// --- guardas antifraude ------------------------------------------------------

test('antipassback: dos taps seguidos no cuentan como dos visitas', () => {
  const r = calcularAcumulacion({
    config: base(), ahora: AHORA,
    movimientosRecientes: [{ tipo: 'acumular', ts: '2026-03-11T12:30:00.000Z' }] });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'antipassback');
  assert.equal(r.minutos_restantes, 60);
});

test('antipassback: pasada la ventana vuelve a sumar', () => {
  const r = calcularAcumulacion({
    config: base(), ahora: AHORA,
    movimientosRecientes: [{ tipo: 'acumular', ts: '2026-03-11T11:00:00.000Z' }] });
  assert.equal(r.ok, true);
});

test('un encargado puede forzar el antipassback', () => {
  const r = calcularAcumulacion({
    config: base(), ahora: AHORA, forzado: true,
    movimientosRecientes: [{ tipo: 'acumular', ts: '2026-03-11T12:59:00.000Z' }] });
  assert.equal(r.ok, true);
});

test('tope diario: la tercera visita del dia no suma', () => {
  const r = calcularAcumulacion({
    config: base({ max_acumulaciones_dia: 2 }), ahora: AHORA,
    movimientosRecientes: [
      { tipo: 'acumular', ts: '2026-03-11T08:00:00.000Z' },
      { tipo: 'acumular', ts: '2026-03-11T10:00:00.000Z' }] });
  assert.equal(r.motivo, 'tope_diario');
});

test('el tope diario cuenta solo el dia de hoy', () => {
  const r = calcularAcumulacion({
    config: base({ max_acumulaciones_dia: 2 }), ahora: AHORA,
    movimientosRecientes: [
      { tipo: 'acumular', ts: '2026-03-10T08:00:00.000Z' },
      { tipo: 'acumular', ts: '2026-03-09T10:00:00.000Z' }] });
  assert.equal(r.ok, true);
});

test('un ticket absurdo (900 EUR) para y pide encargado', () => {
  const r = calcularAcumulacion({
    config: base({ modo: 'puntos_por_euro', importe_maximo_cents: 30000 }),
    importe_cents: 90000, ahora: AHORA });
  assert.equal(r.motivo, 'importe_alto');
});

test('el tope por operacion corta el maximo que se puede dar de una vez', () => {
  const r = calcularAcumulacion({
    config: base({ modo: 'puntos_por_euro', puntos_por_euro: 10,
                   tope_puntos_por_operacion: 200, importe_maximo_cents: 100000 }),
    importe_cents: 50000, ahora: AHORA });
  assert.equal(r.puntos, 200);
});

// --- multiplicadores ---------------------------------------------------------

test('multiplicador por dia de la semana', () => {
  const cfg = base({ multiplicadores: [{ tipo: 'dia_semana', dia: 3, factor: 2, etiqueta: 'Miercoles x2' }] });
  const r = calcularAcumulacion({ config: cfg, ahora: AHORA });
  assert.equal(r.puntos, 2);
  assert.deepEqual(r.detalle.multiplicadores, ['Miercoles x2']);
});

test('multiplicador de cumpleanos con margen de dias', () => {
  const cfg = base({ multiplicadores: [{ tipo: 'cumpleanos', margen_dias: 3, factor: 3 }] });
  const dentro = calcularAcumulacion({ config: cfg, ahora: AHORA,
                                       cliente: { fecha_nacimiento: '1990-03-13' } });
  const fuera = calcularAcumulacion({ config: cfg, ahora: AHORA,
                                      cliente: { fecha_nacimiento: '1990-03-20' } });
  assert.equal(dentro.puntos, 3);
  assert.equal(fuera.puntos, 1);
});

test('dos multiplicadores activos se multiplican entre si', () => {
  const cfg = base({ multiplicadores: [
    { tipo: 'dia_semana', dia: 3, factor: 2 },
    { tipo: 'franja', desde: '12:00', hasta: '16:00', factor: 2 }] });
  const { factor } = aplicarMultiplicadores(cfg, AHORA, null);
  assert.equal(factor, 4);
});

test('fuera de la franja horaria no multiplica', () => {
  const cfg = base({ multiplicadores: [{ tipo: 'franja', desde: '16:00', hasta: '18:00', factor: 2 }] });
  assert.equal(aplicarMultiplicadores(cfg, AHORA, null).factor, 1);
});

// --- canje -------------------------------------------------------------------

test('canje: con saldo suficiente descuenta los puntos', () => {
  const r = calcularCanje({ recompensa: { coste_puntos: 10, activa: 1 }, saldoActual: 12 });
  assert.equal(r.ok, true);
  assert.equal(r.puntos, -10);
  assert.equal(r.saldo_resultante, 2);
});

test('canje: sin saldo dice cuantos puntos faltan', () => {
  const r = calcularCanje({ recompensa: { coste_puntos: 10, activa: 1 }, saldoActual: 7 });
  assert.equal(r.ok, false);
  assert.equal(r.faltan, 3);
});

test('canje: una recompensa desactivada no se puede pedir', () => {
  const r = calcularCanje({ recompensa: { coste_puntos: 1, activa: 0 }, saldoActual: 999 });
  assert.equal(r.motivo, 'recompensa_inactiva');
});

// --- caducidad ---------------------------------------------------------------

test('caducidad: 13 meses sin moverse vacia el saldo', () => {
  const r = calcularCaducidad({ config: base({ caducidad_meses: 12 }), saldoActual: 7,
                                ultimoMovimientoTs: '2025-02-01T10:00:00.000Z', ahora: AHORA });
  assert.equal(r.ok, true);
  assert.equal(r.puntos, -7);
});

test('caducidad: 11 meses todavia no caduca', () => {
  const r = calcularCaducidad({ config: base({ caducidad_meses: 12 }), saldoActual: 7,
                                ultimoMovimientoTs: '2025-05-01T10:00:00.000Z', ahora: AHORA });
  assert.equal(r.ok, false);
});

test('caducidad: sin saldo no genera apunte', () => {
  const r = calcularCaducidad({ config: base(), saldoActual: 0,
                                ultimoMovimientoTs: '2020-01-01T00:00:00.000Z', ahora: AHORA });
  assert.equal(r.ok, false);
});

test('el tope diario NO se puede forzar: es el freno contra el fraude interno', () => {
  const r = calcularAcumulacion({
    config: base({ max_acumulaciones_dia: 2 }), ahora: AHORA, forzado: true,
    movimientosRecientes: [
      { tipo: 'acumular', ts: '2026-03-11T08:00:00.000Z' },
      { tipo: 'acumular', ts: '2026-03-11T10:00:00.000Z' }] });
  assert.equal(r.motivo, 'tope_diario');
});
