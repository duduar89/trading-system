'use strict';
// Registro de incidentes (data/incidentes.jsonl) — ARQUITECTURA §6.10.
//
// Lo usa el semáforo «¿Listo para dinero real?» (criterio f: cero incidentes
// en los últimos 90 días). Solo se añade, nunca se borra ni se reescribe: un
// incidente que se pudiera quitar no probaría nada. Cuenta como incidente:
// - 'kill': el kill switch, por cualquier causa (vigilante o manual);
// - 'conciliacion_grave': libros y bróker no cuadran y no es comisión
//   (descuadre grave, o un puesto sin posición en el bróker);
// - 'orden_duplicada': el bróker ya tenía otra orden con el mismo idCliente;
// - 'orden_huerfana': una posición del bróker sin puesto, o una orden que el
//   bróker aceptó y luego no conoce;
// - 'error_departamento': un error capturado dentro de un departamento del
//   latido o de una tarea en segundo plano (también los de red).
// Cada situación se apunta una vez al aparecer, no en cada latido.

const { anadirJSONL, leerJSONL } = require('../util/almacen');
const { DIA } = require('../util/reloj');
const log = require('../util/log').crear('incidentes');

const TIPOS = Object.freeze(['kill', 'conciliacion_grave', 'orden_duplicada', 'orden_huerfana', 'error_departamento']);
const NOMBRE_TIPO = Object.freeze({
  kill: 'kill switch',
  conciliacion_grave: 'conciliación grave',
  orden_duplicada: 'orden duplicada',
  orden_huerfana: 'orden huérfana',
  error_departamento: 'error en un departamento',
});

class RegistroIncidentes {
  // ruta: data/incidentes.jsonl (null = solo en memoria, para pruebas).
  constructor({ ruta = null } = {}) {
    this.ruta = ruta;
    this.lista = ruta ? leerJSONL(ruta).filter(r => r && Number.isFinite(r.t) && TIPOS.includes(r.tipo)) : [];
  }

  registrar({ t, tipo, detalle = '', datos = null }) {
    if (!TIPOS.includes(tipo)) throw new Error(`tipo de incidente desconocido: ${tipo}`);
    if (!Number.isFinite(t)) throw new Error('un incidente necesita su instante (t)');
    const registro = { t, tipo, detalle: String(detalle || '').slice(0, 300), ...(datos ? { datos } : {}) };
    this.lista.push(registro);
    // Que no se pueda escribir no para el latido, pero se dice: el registro es la prueba del criterio f.
    if (this.ruta) {
      try { anadirJSONL(this.ruta, registro); } catch (e) { log.error(`no se pudo apuntar el incidente ${tipo}: ${e.message}`); }
    }
    return registro;
  }

  // Incidentes de los últimos `dias` (t > ahora − dias). Uno con fecha
  // posterior a «ahora» (un reloj que volvió atrás) también cuenta.
  enVentana(ahora, dias = 90) {
    const desde = ahora - dias * DIA;
    return this.lista.filter(r => r.t > desde);
  }
}

module.exports = { RegistroIncidentes, TIPOS, NOMBRE_TIPO };
