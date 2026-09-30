'use strict';
// Actividad de un paso (§7, `actividad`): lo que de verdad hizo cada agente
// en el último paso(), para que el parqué lo represente (un paseo a la
// pantalla, a su monitor, una ronda por las mesas).
//
// Reglas:
// - Una entrada solo si ese código corrió en ese paso: la anota el propio
//   código que hace el trabajo (precios, vigilante, notas, señales, órdenes…),
//   nunca una regla de adorno.
// - Acciones y objetivos de listas cerradas (abajo). Agentes que existen en la
//   plantilla: el orquestador descarta los demás.
// - Determinista: mismo paso → misma lista, en el orden en que ocurrió. Sin
//   Date.now(): `t` es el reloj de la mesa al empezar el paso.
// - Como mucho MAX_ACTIVIDAD entradas. Si sobran, se quitan primero las de
//   rutina que no cambian nada (señal sin cambio, nota), las más antiguas.
// - Sin repetidas: la misma (agente, acción, objetivo, puesto) cuenta una vez.

const MAX_ACTIVIDAD = 20;

// accion → de qué código sale (docs/ARQUITECTURA.md §7).
const ACCIONES = Object.freeze([
  'precios',       // controller: _actualizarPrecios trajo cotizaciones nuevas
  'conciliacion',  // controller: operaciones.conciliarCadaLatido cuadró libros y bróker
  'riesgo',        // riesgos: vigilante del fondo (cada paso) o evaluación de una propuesta
  'regimen',       // macro: macro.actualizar recalculó el régimen (vela 1H nueva)
  'nota',          // analista-<ETQ>: analisis.notas calculó su nota técnica (vela 1H nueva)
  'senal',         // puesto-<id>: mesas.procesarMesa decidió su puesto con vela nueva
  'orden',         // ejecutor: mandó una orden al bróker
  'comite',        // cio: se convocó el comité en este paso
]);

// A dónde mira quien la hizo (el parqué lo traduce a un punto del plano).
const OBJETIVOS = Object.freeze([
  'pantalla-cotizaciones',   // la pantalla gigante de la pared del fondo del parqué
  'monitor',                 // su propio monitor
  'mesas',                   // las mesas de trading (con puestoId: la de ese puesto)
  'ejecucion',               // el puesto del Ejecutor (Riesgos · Operaciones)
  'pantalla-regimen',        // la pantalla del régimen de la sala de macro
  'sala-comite',             // la sala de comité
]);

// De rutina: primeras en salir si la lista se llena.
function esRutina(x) {
  return (x.accion === 'senal' && x.objetivo === 'monitor') || x.accion === 'nota';
}

class RegistroActividad {
  constructor(t) {
    this.t = t;
    this.lista = [];
    this._claves = new Set();
  }

  anotar({ agente, accion, objetivo = null, detalle = null, puestoId = null }) {
    if (!agente || !ACCIONES.includes(accion)) return false;
    if (objetivo !== null && !OBJETIVOS.includes(objetivo)) return false;
    const clave = `${agente}|${accion}|${objetivo || ''}|${puestoId || ''}`;
    if (this._claves.has(clave)) return false;
    const e = { agente, accion };
    if (objetivo) e.objetivo = objetivo;
    if (detalle) e.detalle = String(detalle).slice(0, 60);
    if (puestoId) e.puestoId = puestoId;
    if (this.lista.length >= MAX_ACTIVIDAD) {
      const k = this.lista.findIndex(esRutina);
      if (k < 0 || esRutina(e)) return false;
      const [fuera] = this.lista.splice(k, 1);
      this._claves.delete(`${fuera.agente}|${fuera.accion}|${fuera.objetivo || ''}|${fuera.puestoId || ''}`);
    }
    this._claves.add(clave);
    this.lista.push(e);
    return true;
  }

  aJSON() { return { t: this.t, lista: this.lista.map(x => ({ ...x })) }; }
}

module.exports = { RegistroActividad, ACCIONES, OBJETIVOS, MAX_ACTIVIDAD };
