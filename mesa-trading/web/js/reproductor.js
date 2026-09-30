// Reproductor de conversaciones que llegan de golpe (30-sep-2026). En el modo
// latido el comité entero (apertura, seis puntos y la decisión) se publica en
// un solo paso, en segundos, y una operación (señal → propuesta → Riesgos →
// Ejecutor → ejecución) también: en el feed aparecía todo a la vez y no se veía
// nada. Aquí esos mensajes se sueltan uno a uno:
//
// - reunión (comité, «Reunión de la mañana», «Cierre del día»): repartida en
//   unos 2,5 min (menos en el sintético acelerado), con «reunión en curso»;
// - operación de un puesto: un mensaje cada pocos segundos, para que se vea al
//   operador proponer y esperar de pie junto al Ejecutor hasta la ejecución.
//
// No cambia nada de los mensajes: su hora (`t`) es la real; solo se retrasa
// cuándo entran en el feed. El primero de una conversación entra en el acto.
// Un mensaje de una conversación que ya tiene cola, espera detrás (el orden
// se respeta siempre). El resto de mensajes pasan sin esperar.
//
// Puro (sin DOM): el reloj lo pone quien lo usa (performance.now() en el
// panel), así se prueba en Node. Script clásico (window.Parque.reproductor) y
// módulo CommonJS.
(function (raiz, fabrica) {
  const mod = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (raiz.Parque = raiz.Parque || {}).reproductor = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VENTANA_MAX_MS = 150000;      // una reunión, repartida en ~2,5 min
  const COMITE_HORAS_MS = 4 * 3600e3; // cada cuánto hay comité (reloj de la mesa)
  const PASO_OPERACION_MAX_MS = 8000; // entre dos mensajes de una operación
  const MENSAJES_COMITE = 8;          // apertura + 6 puntos + decisión (§6.8)
  const NOMBRE = { comite: 'Comité', manana: 'Reunión de la mañana', cierre: 'Cierre del día' };   // CITAS de src/agentes/reuniones.js
  const FINAL_OPERACION = new Set(['ejecucion', 'veto', 'alerta', 'nota', 'cierre']);

  const valido = x => typeof x === 'number' && Number.isFinite(x);

  // Ventana de una reunión en ms reales: ~2,5 min, y en el sintético acelerado
  // nunca más de la mitad del tiempo real entre dos comités (a ×120 un comité
  // cada 2 min: la reunión se reparte en 1 min).
  function ventanaReunionMs(inst) {
    const i = inst || {};
    const factor = i.modo === 'sintetico' && valido(i.velocidad) && i.velocidad > 1 ? i.velocidad : 1;
    return Math.min(VENTANA_MAX_MS, 0.5 * COMITE_HORAS_MS / factor);
  }

  // Lo más viejo que aún se reproduce, con el reloj de la mesa (`ahoraMesa`):
  // lo que dura la reproducción de una reunión, en tiempo de la mesa (en el
  // sintético acelerado, × su velocidad). Lo anterior es historia.
  function limiteHistoria(inst, ahoraMesa) {
    const i = inst || {};
    if (!valido(ahoraMesa)) return null;
    const factor = i.modo === 'sintetico' && valido(i.velocidad) ? Math.max(1, i.velocidad) : 1;
    return ahoraMesa - ventanaReunionMs(i) * factor;
  }

  // Tras volver la red (o despertar el móvil) la instantánea trae lo que no se
  // vio: lo que ya es historia entra de golpe, en su sitio y sin efectos; solo
  // lo reciente pasa por el reproductor (revisión del 30-sep-2026: un comité de
  // hace 3 h salía «en curso» y los jefes repetían sus frases).
  // → { viejos, recientes }
  function separarViejos(lista, limite) {
    const viejos = [];
    const recientes = [];
    for (const m of lista || []) {
      if (!m) continue;
      if (valido(limite) && valido(m.t) && m.t < limite) viejos.push(m); else recientes.push(m);
    }
    return { viejos, recientes };
  }

  const claveHilo = m => String(m.hilo || m.id);

  // ¿De qué conversación es? { clase: 'reunion'|'operacion', tipo?, nombre?, total? } o null.
  // Una reunión se reconoce por su canal (comité) o por datos.reunion (las de
  // las 9:00 y las 22:15); una operación, por su puesto.
  function clasificar(m, porId) {
    if (!m) return null;
    const raiz = m.hilo && porId && porId.get(String(m.hilo)) ? porId.get(String(m.hilo)) : (m.hilo && String(m.hilo) === String(m.id) ? m : null);
    const d = m.datos || {};
    if (m.canal === 'comite') return { clase: 'reunion', tipo: 'comite', nombre: NOMBRE.comite, total: MENSAJES_COMITE };
    if (m.canal === 'direccion' && d.reunion) {
      const tipo = d.reunion === 'cierre' ? 'cierre' : 'manana';
      const nombre = typeof d.nombre === 'string' && d.nombre.trim() ? d.nombre.trim().slice(0, 40) : NOMBRE[tipo];
      const total = Array.isArray(d.turnos) ? d.turnos.length + 1 : null;
      return { clase: 'reunion', tipo, nombre, total };
    }
    if (m.hilo && (d.puestoId || (raiz && raiz.datos && raiz.datos.puestoId))) return { clase: 'operacion', puestoId: d.puestoId || raiz.datos.puestoId };
    return null;
  }

  // ops: { ahora: () => ms, ventana: () => ms (la de una reunión) }
  function crearReproductor(ops) {
    const o = ops || {};
    const ahora = () => (typeof o.ahora === 'function' ? o.ahora() : 0);
    const ventana = () => { const v = typeof o.ventana === 'function' ? o.ventana() : VENTANA_MAX_MS; return valido(v) && v > 0 ? v : VENTANA_MAX_MS; };
    const colas = new Map();       // hilo → { clase, tipo, nombre, total, vistos, paso, ultima, mensajes: [] }
    const retenidos = new Set();   // ids en cola
    const porId = new Map();       // id → mensaje (para clasificar las respuestas)

    function paso(c) {
      const v = ventana();
      if (c.clase === 'reunion') return v / Math.max(1, (valido(c.total) ? c.total : MENSAJES_COMITE) - 1);
      return Math.min(PASO_OPERACION_MAX_MS, v / 18);
    }

    function cola(clave, info) {
      let c = colas.get(clave);
      if (!c) {
        c = { clave, clase: info.clase, tipo: info.tipo || null, nombre: info.nombre || null, total: info.total || null, puestoId: info.puestoId || null, vistos: 0, ultima: -Infinity, mensajes: [] };
        colas.set(clave, c);
      } else if (info && info.total && !c.total) c.total = info.total;
      return c;
    }

    // Recibe mensajes nuevos (sin repetir los que ya pasaron o esperan: eso lo
    // mira quien llama con su lista de vistos). `retener`: forzar que todos los
    // de reunión entren en cola aunque sea el primero (al abrir el panel justo
    // después de una reunión, para verla entera). → los que entran ya.
    function recibir(lista, opciones) {
      const op = opciones || {};
      const t = ahora();
      const ya = [];
      const ordenados = (lista || []).filter(m => m && m.id && !retenidos.has(m.id)).slice().sort((a, b) => (a.t - b.t) || (String(a.id) < String(b.id) ? -1 : 1));
      for (const m of ordenados) porId.set(String(m.id), m);
      if (porId.size > 2000) for (const k of [...porId.keys()].slice(0, porId.size - 1500)) porId.delete(k);
      for (const m of ordenados) {
        const clave = claveHilo(m);
        const existente = colas.get(clave);
        const info = clasificar(m, porId);
        if (!info && !(existente && existente.mensajes.length)) { ya.push(m); continue; }
        const c = cola(clave, info || existente);
        const forzar = op.retener && c.clase === 'reunion';
        if (!c.mensajes.length && !forzar && t - c.ultima >= paso(c)) {
          c.ultima = t;
          c.vistos++;
          ya.push(m);
          continue;
        }
        c.mensajes.push(m);
        retenidos.add(m.id);
      }
      return ya;
    }

    // Lo que toca soltar ahora (como mucho uno por conversación y llamada).
    function tic() {
      const t = ahora();
      const sale = [];
      for (const [clave, c] of colas) {
        const p = paso(c);
        if (c.mensajes.length && t - c.ultima >= p) {
          const m = c.mensajes.shift();
          retenidos.delete(m.id);
          // A su hora, sin arrastrar el retraso de cada tic; tras una pausa larga, desde ahora.
          const debido = c.ultima + p;
          c.ultima = Number.isFinite(debido) && t - debido < p ? debido : t;
          c.vistos++;
          sale.push(m);
        }
        // Una conversación sin nada en cola y quieta un buen rato se olvida.
        if (!c.mensajes.length && t - c.ultima > Math.max(4 * p, 60000)) colas.delete(clave);
      }
      return sale.sort((a, b) => a.t - b.t);
    }

    // Suelta todo lo que espera (p. ej. al volver a la pestaña tras mucho rato).
    function vaciar() {
      const sale = [];
      for (const c of colas.values()) {
        for (const m of c.mensajes) { retenidos.delete(m.id); c.vistos++; sale.push(m); }
        c.mensajes = [];
      }
      return sale.sort((a, b) => a.t - b.t);
    }

    // La reunión que se está reproduciendo (la más reciente con cola), o null.
    // → { tipo, nombre, vistos, total, quedan }
    function reunionEnCurso() {
      let r = null;
      for (const c of colas.values()) {
        if (c.clase !== 'reunion' || !c.mensajes.length) continue;
        if (!r || c.ultima > r.ultima) r = c;
      }
      return r ? { tipo: r.tipo, nombre: r.nombre, vistos: r.vistos, total: valido(r.total) ? Math.max(r.total, r.vistos + r.mensajes.length) : r.vistos + r.mensajes.length, quedan: r.mensajes.length } : null;
    }

    return {
      recibir, tic, vaciar, reunionEnCurso,
      retenido: id => retenidos.has(id),
      // ¿Tiene este agente algo en cola? (su bocadillo de la instantánea esperaría a su mensaje)
      esperaDe: agenteId => { for (const c of colas.values()) for (const m of c.mensajes) if (m.de === agenteId) return true; return false; },
      get pendientes() { return retenidos.size; },
    };
  }

  // ¿Este mensaje (ya soltado) termina la espera del operador junto al Ejecutor?
  // La propuesta la abre; la ejecución, el veto o un aviso del Ejecutor la cierran.
  function abreEspera(m) { return Boolean(m && m.tipo === 'propuesta' && m.datos && m.datos.puestoId && m.de && String(m.de).startsWith('puesto-')); }
  function cierraEspera(m) { return Boolean(m && FINAL_OPERACION.has(m.tipo) && m.de !== undefined && !String(m.de || '').startsWith('puesto-')); }

  return { crearReproductor, clasificar, ventanaReunionMs, limiteHistoria, separarViejos, abreEspera, cierraEspera, VENTANA_MAX_MS, MENSAJES_COMITE, PASO_OPERACION_MAX_MS, NOMBRE };
});
