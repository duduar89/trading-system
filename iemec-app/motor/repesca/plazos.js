'use strict';
// De «lo que dijo el paciente» a una fecha y hora concretas. La IA (o el intérprete de reglas)
// solo dice QUÉ tipo de plazo es; la fecha la pone siempre este código, y la comprueba: futura,
// con la clínica abierta, sin festivos, dentro del horizonte y nunca demasiado pronto.
//
// Tipos de plazo:
//   hoy_tarde                    «ahora no puedo, luego» → esta tarde o el siguiente día laborable
//   manana | pasado_manana
//   dias {n}                     «dentro de 10 días»
//   semanas {n}                  «en dos semanas»
//   semana_siguiente             «la semana que viene» → lunes (o primer laborable) de esa semana
//   dia_semana {dia, siguiente}  «el jueves», «el viernes que viene»
//   mes_siguiente                «el mes que viene» → regla de la clínica (primer lunes laborable)
//   meses {n}                    «en un par de meses»
//   mes {mes}                    «en enero», «en octubre»
//   fecha {dia, mes?}            «el día 15», «el 3 de noviembre»
//   tras_fecha {dia, mes?}       «vuelvo de viaje el 20», «hasta el 15 estoy fuera» → el día siguiente
//   inicio_mes | fin_mes         «a primeros», «a final de mes»
//   cobro {dia?}                 «cuando cobre» → el día que diga o a primeros del mes siguiente
//   tras_hito {hito}             verano, navidad, reyes, semana_santa, vacaciones, puente
//   vago                         «más adelante», «ya te diré» → regla por defecto (y se pregunta una vez)
const T = require('../tiempo');

const REGLAS_POR_DEFECTO = {
  mesSiguiente: 'primer_lunes',        // o 'primer_laborable'
  diasMinimos: 2,                      // nunca antes de 2 días, salvo hoy_tarde / mañana pedidos
  horizonteDias: 365,
  vagoDias: 14,
  horaManana: '11:30',
  horaTarde: '17:30',
  horaHoyTarde: '18:00',
};

function pascua(anio) {
  // Algoritmo anónimo gregoriano (Meeus/Jones/Butcher).
  const a = anio % 19, b = Math.floor(anio / 100), c = anio % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

const fechaDe = (anio, mes, dia) => `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
const anioDe = (f) => Number(f.slice(0, 4));
const mesDe = (f) => Number(f.slice(5, 7));
const diaDe = (f) => Number(f.slice(8, 10));

function ultimoDiaDelMes(anio, mes) {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

// Primer día (desde «fecha» incluida) que cae en ese día de la semana.
function proximoDiaSemana(fecha, dia) {
  const actual = T.diaSemana(fecha);
  return T.sumarDias(fecha, (dia - actual + 7) % 7);
}

function primerLunesLaborable(anio, mes, cal) {
  let f = proximoDiaSemana(fechaDe(anio, mes, 1), 1);
  // Si ese lunes es festivo (el 5-oct-2026 lo es en Boadilla), el siguiente laborable.
  return cal.siguienteLaborable(f);
}

// Siguiente vez que ocurre (día, mes) a partir de hoy (incluido si es hoy o después).
function proximaFecha(hoy, dia, mes) {
  let anio = anioDe(hoy);
  const m = mes ?? mesDe(hoy);
  const mk = (a, mm) => fechaDe(a, mm, Math.min(dia, ultimoDiaDelMes(a, mm)));
  let f = mk(anio, m);
  if (f < hoy) {
    if (mes == null) {
      // «el día 15» pasado este mes → el 15 del mes siguiente.
      const sig = T.sumarMeses(fechaDe(anio, m, 1), 1);
      f = mk(anioDe(sig), mesDe(sig));
    } else {
      f = mk(anio + 1, m);
    }
  }
  return f;
}

function fechaObjetivo(plazo, hoy, cal, reglas) {
  const anio = anioDe(hoy);
  switch (plazo.tipo) {
    case 'hoy_tarde': return hoy;
    case 'manana': return T.sumarDias(hoy, 1);
    case 'pasado_manana': return T.sumarDias(hoy, 2);
    case 'dias': return T.sumarDias(hoy, Math.max(1, plazo.n || 1));
    case 'semanas': return T.sumarDias(hoy, 7 * Math.max(1, plazo.n || 1));
    case 'semana_siguiente': return T.sumarDias(hoy, 8 - T.diaSemana(hoy)); // lunes de la semana que viene
    case 'dia_semana': {
      // El más cercano a partir de mañana; «el viernes de la semana que viene», el de la semana
      // siguiente. Como «el viernes que viene» es ambiguo en España, al paciente siempre se le
      // confirma la fecha con número («el viernes 2 de octubre»).
      if (plazo.semanaSiguiente) return T.sumarDias(T.sumarDias(hoy, 8 - T.diaSemana(hoy)), plazo.dia - 1);
      return proximoDiaSemana(T.sumarDias(hoy, 1), plazo.dia);
    }
    case 'mes_siguiente': {
      const m = T.sumarMeses(fechaDe(anio, mesDe(hoy), 1), 1);
      return reglas.mesSiguiente === 'primer_laborable' ? m : primerLunesLaborable(anioDe(m), mesDe(m), cal);
    }
    case 'meses': return T.sumarMeses(hoy, Math.max(1, plazo.n || 1));
    case 'mes': {
      // El mes en curso: si aún queda mes, dentro de una semana; si no, el del año que viene.
      if (plazo.mes === mesDe(hoy) && diaDe(hoy) <= 15) return T.sumarDias(hoy, 7);
      const a = plazo.mes > mesDe(hoy) ? anio : anio + 1;
      return primerLunesLaborable(a, plazo.mes, cal);
    }
    case 'fecha': return proximaFecha(hoy, plazo.dia, plazo.mes);
    case 'tras_fecha': return T.sumarDias(proximaFecha(hoy, plazo.dia, plazo.mes), 1);
    case 'inicio_mes': {
      const m = T.sumarMeses(fechaDe(anio, mesDe(hoy), 1), 1);
      return m;
    }
    case 'fin_mes': {
      // Tres días antes del último del mes; si ya ha pasado, el último día; si también, el mes que viene.
      const ultimo = fechaDe(anio, mesDe(hoy), ultimoDiaDelMes(anio, mesDe(hoy)));
      if (T.sumarDias(ultimo, -3) > hoy) return T.sumarDias(ultimo, -3);
      if (ultimo > hoy) return ultimo;
      const sig = T.sumarMeses(fechaDe(anio, mesDe(hoy), 1), 1);
      return T.sumarDias(fechaDe(anioDe(sig), mesDe(sig), ultimoDiaDelMes(anioDe(sig), mesDe(sig))), -3);
    }
    case 'cobro': {
      if (plazo.dia) return proximaFecha(T.sumarDias(hoy, 1), plazo.dia);
      return T.sumarMeses(fechaDe(anio, mesDe(hoy), 1), 1);
    }
    case 'tras_hito': return trasHito(plazo.hito, hoy, cal);
    case 'vago':
    default:
      return T.sumarDias(hoy, reglas.vagoDias);
  }
}

function trasHito(hito, hoy, cal) {
  const anio = anioDe(hoy);
  const siguienteDe = (f) => (f > hoy ? f : null);
  switch (hito) {
    case 'verano': {
      // Primera semana de septiembre (primer lunes laborable).
      const f = primerLunesLaborable(anio, 9, cal);
      return siguienteDe(f) || primerLunesLaborable(anio + 1, 9, cal);
    }
    case 'navidad':
    case 'reyes': {
      // La semana después de Reyes: primer lunes laborable a partir del 7 de enero.
      const a = mesDe(hoy) === 1 && diaDe(hoy) < 7 ? anio : anio + 1;
      return cal.siguienteLaborable(proximoDiaSemana(fechaDe(a, 1, 7), 1));
    }
    case 'semana_santa': {
      let p = pascua(anio);
      if (T.sumarDias(p, 1) < hoy) p = pascua(anio + 1);
      return T.sumarDias(p, 2); // martes después del lunes de Pascua
    }
    case 'vacaciones':
    case 'puente':
    default:
      return T.sumarDias(hoy, 14);
  }
}

/**
 * @param {object} plazo  interpretación ({ tipo, ... })
 * @param {object} o      { hoy 'AAAA-MM-DD', ahoraMin (minutos de Madrid), calendario, franja 'manana'|'tarde',
 *                          horaHabitual 'HH:MM', reglas }
 * @returns {{ fecha, hora, avisos: string[], texto }}
 */
function calcularSeguimiento(plazo, o) {
  const reglas = { ...REGLAS_POR_DEFECTO, ...(o.reglas || {}) };
  const cal = o.calendario;
  const avisos = [];
  let fecha = fechaObjetivo(plazo, o.hoy, cal, reglas);

  const pidioPronto = ['hoy_tarde', 'manana', 'pasado_manana', 'dia_semana', 'fecha', 'tras_fecha', 'cobro'].includes(plazo.tipo);
  if (!pidioPronto && T.diasEntre(o.hoy, fecha) < reglas.diasMinimos) {
    fecha = T.sumarDias(o.hoy, reglas.diasMinimos);
    avisos.push(`adelantado a ${reglas.diasMinimos} días como mínimo`);
  }

  let hora;
  if (plazo.tipo === 'hoy_tarde') {
    const tarde = T.minutosDe(reglas.horaHoyTarde);
    if ((o.ahoraMin ?? 0) + 60 <= tarde && cal.abre(fecha)) {
      hora = cal.horaDeEnvio(fecha, reglas.horaHoyTarde);
    } else {
      fecha = T.sumarDias(fecha, 1);
      avisos.push('ya es tarde: pasa al día siguiente');
    }
  }

  const antes = fecha;
  fecha = cal.siguienteLaborable(fecha);
  if (fecha !== antes) avisos.push(`${antes} la clínica no abre: se mueve al ${fecha}`);

  if (T.diasEntre(o.hoy, fecha) > reglas.horizonteDias) {
    fecha = cal.siguienteLaborable(T.sumarDias(o.hoy, reglas.horizonteDias));
    avisos.push('más allá del horizonte: se revisa con una persona');
  }

  if (!hora) {
    const deseada = o.horaHabitual || (o.franja === 'tarde' || plazo.franja === 'tarde' ? reglas.horaTarde : reglas.horaManana);
    hora = cal.horaDeEnvio(fecha, deseada);
  }
  return { fecha, hora, avisos, texto: textoFecha(fecha, hora, o.hoy) };
}

const DIAS = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const MESES = ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// «el martes 6 de octubre», «esta tarde», «mañana por la mañana»
function textoFecha(fecha, hora, hoy) {
  const tarde = T.minutosDe(hora) >= 15 * 60;
  if (fecha === hoy) return tarde ? 'esta tarde' : 'esta mañana';
  if (fecha === T.sumarDias(hoy, 1)) return tarde ? 'mañana por la tarde' : 'mañana por la mañana';
  const base = `el ${DIAS[T.diaSemana(fecha)]} ${diaDe(fecha)} de ${MESES[mesDe(fecha)]}`;
  return anioDe(fecha) !== anioDe(hoy) ? `${base} de ${anioDe(fecha)}` : base;
}

module.exports = { calcularSeguimiento, textoFecha, pascua, REGLAS_POR_DEFECTO, DIAS, MESES };
