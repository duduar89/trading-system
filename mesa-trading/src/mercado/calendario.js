'use strict';
// Calendario de la sesión regular NYSE (9:30-16:00 America/New_York) para el
// bróker simulado y como respaldo del reloj de Alpaca (ARQUITECTURA §3.3). La
// hora de Nueva York sale de Intl, así el horario de verano lo pone la base de
// zonas horarias del sistema y no una regla escrita a mano.
//
// Festivos y cierres a las 13:00 copiados de nyse.com/markets/hours-calendars
// y comprobados allí el 29-sep-2026. Fuera de 2026-2027 no hay lista: se tratan
// como hábiles todos los días laborables (cubre() lo dice).

const ZONA = 'America/New_York';
const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

const FESTIVOS = Object.freeze(new Set([
  // 2026
  '2026-01-01', // Año Nuevo
  '2026-01-19', // Martin Luther King, Jr.
  '2026-02-16', // Washington's Birthday
  '2026-04-03', // Viernes Santo
  '2026-05-25', // Memorial Day
  '2026-06-19', // Juneteenth
  '2026-07-03', // Independencia (el 4 cae en sábado: se observa el viernes)
  '2026-09-07', // Labor Day
  '2026-11-26', // Acción de Gracias
  '2026-12-25', // Navidad
  // 2027
  '2027-01-01', // Año Nuevo
  '2027-01-18', // Martin Luther King, Jr.
  '2027-02-15', // Washington's Birthday
  '2027-03-26', // Viernes Santo
  '2027-05-31', // Memorial Day
  '2027-06-18', // Juneteenth (el 19 cae en sábado)
  '2027-07-05', // Independencia (el 4 cae en domingo)
  '2027-09-06', // Labor Day
  '2027-11-25', // Acción de Gracias
  '2027-12-24', // Navidad (el 25 cae en sábado)
  // El 31-dic-2027 SÍ abre: la NYSE no observa el Año Nuevo de 2028 (sábado).
]));

// Cierre a las 13:00 ET. El 2-jul-2026 no cierra pronto (el festivo es el 3).
const CIERRES_TEMPRANOS = Object.freeze(new Set([
  '2026-11-27', // viernes tras Acción de Gracias
  '2026-12-24', // Nochebuena
  '2027-11-26', // viernes tras Acción de Gracias
]));

const ANIOS_CUBIERTOS = Object.freeze([2026, 2027]);

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONA, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

// Desfase ET − UTC en ms. Los cambios de hora caen en horas UTC exactas, así
// que se puede memorizar por hora sin error.
const cacheDesfase = new Map();
function desfase(t) {
  const h = Math.floor(t / HORA);
  let d = cacheDesfase.get(h);
  if (d !== undefined) return d;
  const p = {};
  for (const x of fmt.formatToParts(new Date(h * HORA))) p[x.type] = x.value;
  const comoUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  d = comoUTC - h * HORA;
  if (cacheDesfase.size > 50_000) cacheDesfase.clear();
  cacheDesfase.set(h, d);
  return d;
}

// Día de Nueva York ('AAAA-MM-DD') que contiene el instante t.
function diaET(t) {
  return new Date(t + desfase(t)).toISOString().slice(0, 10);
}

function partesDia(dia) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dia));
  if (!m) throw new Error(`calendario: día no válido «${dia}» (se espera AAAA-MM-DD)`);
  return { y: +m[1], mo: +m[2], d: +m[3] };
}

// Instante (ms) de la hora local de Nueva York hh:mm del día dado.
function msDesdeET(dia, hh, mm = 0) {
  const { y, mo, d } = partesDia(dia);
  const supuesto = Date.UTC(y, mo - 1, d, hh, mm);
  let t = supuesto - desfase(supuesto);
  const corregido = supuesto - desfase(t);
  if (corregido !== t) t = corregido;
  return t;
}

function sumarDias(dia, n) {
  const { y, mo, d } = partesDia(dia);
  return new Date(Date.UTC(y, mo - 1, d + n)).toISOString().slice(0, 10);
}

function normalizarDia(diaOInstante) {
  return typeof diaOInstante === 'number' ? diaET(diaOInstante) : String(diaOInstante);
}

function esFinDeSemana(dia) {
  const { y, mo, d } = partesDia(dia);
  const s = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return s === 0 || s === 6;
}

// Hay sesión regular ese día (acepta 'AAAA-MM-DD' o un instante en ms).
function esDiaHabil(diaOInstante) {
  const dia = normalizarDia(diaOInstante);
  return !esFinDeSemana(dia) && !FESTIVOS.has(dia);
}

function aperturaSesion(diaOInstante) {
  const dia = normalizarDia(diaOInstante);
  return esDiaHabil(dia) ? msDesdeET(dia, 9, 30) : null;
}

// Fin de la sesión regular del día D (16:00, o 13:00 en cierre temprano).
// null si ese día no hay sesión: no hay vela diaria que esperar.
function cierreSesion(diaOInstante) {
  const dia = normalizarDia(diaOInstante);
  if (!esDiaHabil(dia)) return null;
  return CIERRES_TEMPRANOS.has(dia) ? msDesdeET(dia, 13, 0) : msDesdeET(dia, 16, 0);
}

function abierto(t) {
  const a = aperturaSesion(diaET(t));
  if (a === null) return false;
  return t >= a && t < cierreSesion(diaET(t));
}

// Primera apertura estrictamente posterior a t (si está abierto, la del día siguiente).
function proximaApertura(t) {
  let dia = diaET(t);
  for (let i = 0; i < 20; i++, dia = sumarDias(dia, 1)) {
    const a = aperturaSesion(dia);
    if (a !== null && a > t) return a;
  }
  throw new Error('calendario: no hay apertura en 20 días');
}

// Primer cierre posterior a t (si está abierto, el de hoy).
function proximoCierre(t) {
  let dia = diaET(t);
  for (let i = 0; i < 20; i++, dia = sumarDias(dia, 1)) {
    const c = cierreSesion(dia);
    if (c !== null && c > t) return c;
  }
  throw new Error('calendario: no hay cierre en 20 días');
}

// Misma forma que broker.relojMercado(), para el bróker simulado.
function relojMercado(t) {
  return { abierto: abierto(t), proximaApertura: proximaApertura(t), proximoCierre: proximoCierre(t) };
}

// ¿La lista de festivos cubre el año de t? Fuera de ella el calendario es solo aproximado.
function cubre(t) {
  return ANIOS_CUBIERTOS.includes(Number(diaET(t).slice(0, 4)));
}

module.exports = {
  ZONA, FESTIVOS, CIERRES_TEMPRANOS, ANIOS_CUBIERTOS,
  abierto, proximaApertura, proximoCierre, cierreSesion, aperturaSesion,
  esDiaHabil, diaET, msDesdeET, sumarDias, relojMercado, cubre,
};
