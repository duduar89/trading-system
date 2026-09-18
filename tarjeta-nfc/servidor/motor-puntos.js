// Motor de puntos: funcion pura. Entra el estado, sale cuantos puntos tocan.
// Sin base de datos, sin red, sin reloj propio -> se puede probar entera.
//
// Tres modos (ver docs/02-como-funcionan-los-puntos.md):
//   'sellos'          1 visita = 1 sello.       Cero teclear. Es el que recomiendo empezar.
//   'puntos_por_euro' N puntos por euro gastado. Hay que meter el importe.
//   'hibrido'         sello por visita + puntos por euro.

/** @typedef {{motivo: string, [k: string]: unknown}} Rechazo */

export const CONFIG_POR_DEFECTO = {
  modo: 'sellos',
  moneda: 'EUR',
  sellos: { objetivo: 10, importe_minimo_cents: 0 },
  puntos_por_euro: 1,
  redondeo: 'abajo',                  // abajo | cercano
  antipassback_minutos: 90,           // dos taps seguidos no son dos visitas
  max_acumulaciones_dia: 3,
  tope_puntos_por_operacion: 500,
  importe_maximo_cents: 50000,        // por encima, pide confirmacion de encargado
  caducidad_meses: 12,                // inactividad, no fecha fija
  multiplicadores: [],                // ver aplicarMultiplicadores()
};

export function normalizarConfig(parcial = {}) {
  return {
    ...CONFIG_POR_DEFECTO,
    ...parcial,
    sellos: { ...CONFIG_POR_DEFECTO.sellos, ...(parcial.sellos ?? {}) },
    multiplicadores: parcial.multiplicadores ?? [],
  };
}

const MINUTO = 60_000;
const diaLocal = (iso) => iso.slice(0, 10);

/**
 * Multiplicadores activos en este momento. Se multiplican entre si.
 *   { tipo: 'dia_semana', dia: 2, factor: 2 }          // 0=domingo ... 6=sabado
 *   { tipo: 'franja', desde: '16:00', hasta: '18:30', factor: 2 }
 *   { tipo: 'cumpleanos', margen_dias: 3, factor: 2 }
 */
export function aplicarMultiplicadores(config, ahora, cliente) {
  const activos = [];
  const d = new Date(ahora);
  const hhmm = d.toISOString().slice(11, 16);
  for (const m of config.multiplicadores) {
    if (m.tipo === 'dia_semana' && d.getUTCDay() === m.dia) activos.push(m);
    else if (m.tipo === 'franja' && hhmm >= m.desde && hhmm < m.hasta) activos.push(m);
    else if (m.tipo === 'cumpleanos' && cliente?.fecha_nacimiento) {
      const [, mes, dia] = cliente.fecha_nacimiento.split('-').map(Number);
      const cumple = Date.UTC(d.getUTCFullYear(), mes - 1, dia);
      const margen = (m.margen_dias ?? 0) * 86_400_000;
      if (Math.abs(cumple - Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) <= margen) {
        activos.push(m);
      }
    }
  }
  const factor = activos.reduce((f, m) => f * (m.factor ?? 1), 1);
  return { factor, activos: activos.map((m) => m.etiqueta ?? m.tipo) };
}

/**
 * @param {object} e
 * @param {object} e.config
 * @param {number} [e.importe_cents]
 * @param {string} e.ahora            ISO
 * @param {Array}  e.movimientosRecientes  acumulaciones del cliente, mas nuevas primero
 * @param {object} [e.cliente]
 * @param {boolean} [e.forzado]       un encargado salta antipassback / importe alto
 * @returns {{ok: true, puntos: number, detalle: object} | {ok: false} & Rechazo}
 */
export function calcularAcumulacion({ config, importe_cents = null, ahora,
                                      movimientosRecientes = [], cliente = null, forzado = false }) {
  const cfg = normalizarConfig(config);
  const t = Date.parse(ahora);

  const acumulaciones = movimientosRecientes.filter((m) => m.tipo === 'acumular');

  // --- Guardas antifraude (docs/05) ---
  if (!forzado) {
    const ultima = acumulaciones[0];
    if (ultima) {
      const minutos = (t - Date.parse(ultima.ts)) / MINUTO;
      if (minutos < cfg.antipassback_minutos) {
        return { ok: false, motivo: 'antipassback',
                 mensaje: `Esta tarjeta ya sumó hace ${Math.round(minutos)} min.`,
                 minutos_restantes: Math.ceil(cfg.antipassback_minutos - minutos) };
      }
    }
    if (importe_cents != null && importe_cents > cfg.importe_maximo_cents) {
      return { ok: false, motivo: 'importe_alto',
               mensaje: 'Importe fuera de rango: lo confirma el encargado.' };
    }
  }

  // El tope diario NO se puede forzar, ni siendo encargado. Es el ultimo freno
  // contra el fraude interno; para casos legitimos esta el ajuste manual, que
  // queda marcado como tal en el libro mayor.
  const hoy = acumulaciones.filter((m) => diaLocal(m.ts) === diaLocal(ahora)).length;
  if (hoy >= cfg.max_acumulaciones_dia) {
    return { ok: false, motivo: 'tope_diario',
             mensaje: `Límite de ${cfg.max_acumulaciones_dia} acumulaciones por día.` };
  }

  if (importe_cents != null && importe_cents < 0) {
    return { ok: false, motivo: 'importe_invalido', mensaje: 'El importe no puede ser negativo.' };
  }

  // --- Calculo base ---
  const necesitaImporte = cfg.modo === 'puntos_por_euro' || cfg.modo === 'hibrido';
  if (necesitaImporte && importe_cents == null) {
    return { ok: false, motivo: 'falta_importe', mensaje: 'Hace falta el importe del ticket.' };
  }
  if (cfg.modo !== 'puntos_por_euro' && importe_cents != null &&
      importe_cents < cfg.sellos.importe_minimo_cents) {
    return { ok: false, motivo: 'importe_minimo',
             mensaje: `Consumo mínimo ${(cfg.sellos.importe_minimo_cents / 100).toFixed(2)} ${cfg.moneda}.` };
  }

  const porEuro = () => {
    const bruto = (importe_cents / 100) * cfg.puntos_por_euro;
    return cfg.redondeo === 'cercano' ? Math.round(bruto) : Math.floor(bruto);
  };

  let base;
  if (cfg.modo === 'sellos') base = 1;
  else if (cfg.modo === 'puntos_por_euro') base = porEuro();
  else base = 1 + porEuro();

  const { factor, activos } = aplicarMultiplicadores(cfg, ahora, cliente);
  const puntos = Math.min(Math.floor(base * factor), cfg.tope_puntos_por_operacion);

  if (puntos <= 0) {
    return { ok: false, motivo: 'cero_puntos', mensaje: 'Esta operación no genera puntos.' };
  }
  return { ok: true, puntos, detalle: { base, factor, multiplicadores: activos, modo: cfg.modo } };
}

/** Un canje: comprueba saldo y devuelve el apunte negativo. */
export function calcularCanje({ recompensa, saldoActual }) {
  if (!recompensa || !recompensa.activa) {
    return { ok: false, motivo: 'recompensa_inactiva', mensaje: 'Esa recompensa no está disponible.' };
  }
  if (saldoActual < recompensa.coste_puntos) {
    return { ok: false, motivo: 'saldo_insuficiente',
             mensaje: `Faltan ${recompensa.coste_puntos - saldoActual} puntos.`,
             faltan: recompensa.coste_puntos - saldoActual };
  }
  return { ok: true, puntos: -recompensa.coste_puntos, saldo_resultante: saldoActual - recompensa.coste_puntos };
}

/**
 * Caducidad por inactividad: si el cliente lleva `caducidad_meses` sin moverse,
 * su saldo se pone a cero con un apunte visible (nunca borrando historico).
 */
export function calcularCaducidad({ config, saldoActual, ultimoMovimientoTs, ahora }) {
  const cfg = normalizarConfig(config);
  if (!cfg.caducidad_meses || saldoActual <= 0 || !ultimoMovimientoTs) return { ok: false };
  const limite = new Date(ultimoMovimientoTs);
  limite.setMonth(limite.getMonth() + cfg.caducidad_meses);
  if (Date.parse(ahora) < limite.getTime()) return { ok: false };
  return { ok: true, puntos: -saldoActual, concepto: `Caducidad por ${cfg.caducidad_meses} meses de inactividad` };
}
