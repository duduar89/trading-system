'use strict';
// Todo el sistema pregunta la hora a un reloj, nunca a Date.now() directamente.
// Así el mismo código corre en tiempo real (Alpaca, simulado) y en tiempo
// acelerado (demo sintética, pruebas), donde un día pasa en segundos.

class RelojReal {
  constructor() { this.tipo = 'real'; }
  ahora() { return Date.now(); }
  // Espera real; en el reloj simulado no espera nada.
  dormir(ms) { return new Promise(r => setTimeout(r, ms)); }
}

class RelojSimulado {
  constructor(inicioMs) {
    this.tipo = 'simulado';
    this.t = inicioMs;
  }
  ahora() { return this.t; }
  avanzar(ms) { this.t += ms; return this.t; }
  fijar(ms) { this.t = ms; }
  dormir() { return Promise.resolve(); }
}

const MIN = 60 * 1000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

// Inicio de la vela que contiene `t` para un marco en ms (velas alineadas a UTC).
function inicioVela(t, marcoMs) {
  return Math.floor(t / marcoMs) * marcoMs;
}

// Clave de día UTC (AAAA-MM-DD) para cortes diarios de P&L.
function diaUTC(t) {
  return new Date(t).toISOString().slice(0, 10);
}

module.exports = { RelojReal, RelojSimulado, inicioVela, diaUTC, MIN, HORA, DIA };
