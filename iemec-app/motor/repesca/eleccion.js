'use strict';
// El paciente contesta a los huecos que le hemos propuesto. ¿Cuál ha elegido?
//
//   «el martes a las 11», «la de las 14:00», «la primera», «vale» (si solo había uno)
//        → { tipo: 'elegido', hueco }             se reserva y le llega su cita
//   «el martes» con dos huecos ese día
//        → { tipo: 'dudoso', candidatos }         se le pregunta cuál de ellos
//   «ninguno me viene bien», «otro día», «el martes no puedo»
//        → { tipo: 'otros', franja }              se buscan otros
//   «¿y el jueves a las 12?» sin haberlo ofrecido
//        → { tipo: 'pide', fecha, hora, franja }  se mira si ese momento está libre
//   nada de lo anterior → null                    sigue la repesca normal
//
// No reserva nada: solo entiende. La reserva la hace la agenda, que vuelve a comprobar el hueco.
const T = require('../tiempo');
const { normalizar, detectarFranja } = require('./interpretar');

const DIAS = { lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6, domingo: 7 };
const MESES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
const HORAS = { una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12 };
const RX_HORA_PALABRA = Object.keys(HORAS).join('|');

const ORDINALES = [
  [/\b(el primero|la primera|el primer hueco|primera opcion|opcion 1|1\s?[ªº])/, 0],
  [/\b(el segundo|la segunda|el segundo hueco|segunda opcion|opcion 2|2\s?[ªº])/, 1],
  [/\b(el tercero|la tercera|el tercer hueco|tercera opcion|opcion 3|3\s?[ªº])/, 2],
  [/\b(el ultimo|la ultima)\b/, -1],
];

const ACEPTA = /^(si|sii+|vale|ok|okey|okay|perfecto|genial|estupendo|de acuerdo|claro|venga|dale|me viene bien|me va bien|me vale|reservamelo|reservalo|reserva|apuntame|guardamelo|me lo quedo|ese|esa|ese mismo|esa misma)\b/;
const NINGUNO = /\b(ninguno|ninguna|ni uno ni otro|no me (viene|vienen|va|van|cuadra|cuadran|encaja|encajan)( bien)? (ninguno|ninguna|esos|esas|esos dias|esas horas)|no me (viene|vienen|va|van|cuadra|cuadran)( bien)?$|otro dia|otros dias|otra hora|otras horas|otro hueco|otros huecos|otra fecha|otras fechas|no puedo (ninguno|ninguna|esos dias|a esas horas|en esos))\b/;
const NEGATIVO = /\b(no (puedo|me (viene|vienen|va|van|cuadra|cuadran|encaja|encajan)|me es posible)|imposible)\b/;

// «las 2» en una clínica que abre por la tarde son las 14:00: de 1 a 8 se entiende tarde.
function aVeinticuatro(h, t) {
  if (/de la tarde|por la tarde|de la noche/.test(t) && h < 12) return h + 12;
  if (h >= 1 && h <= 8) return h + 12;
  return h;
}

function leerHora(t) {
  let m;
  if ((m = /\b(\d{1,2})[:.h](\d{2})\b/.exec(t))) return { h: aVeinticuatro(Number(m[1]), t), m: Number(m[2]) };
  if ((m = /\b(?:a )?las (\d{1,2})(?: y (media|cuarto))?\b(?!\s*(?:de (?:la )?(?:semana|mes)))/.exec(t))) {
    return { h: aVeinticuatro(Number(m[1]), t), m: m[2] === 'media' ? 30 : m[2] === 'cuarto' ? 15 : null };
  }
  if ((m = new RegExp(`\\b(?:a )?la(?:s)? (${RX_HORA_PALABRA})(?: y (media|cuarto))?\\b`).exec(t))) {
    return { h: aVeinticuatro(HORAS[m[1]], t), m: m[2] === 'media' ? 30 : m[2] === 'cuarto' ? 15 : null };
  }
  if ((m = /\b(\d{1,2}) ?h\b/.exec(t))) return { h: aVeinticuatro(Number(m[1]), t), m: null };
  if (/\bmediodia\b/.test(t)) return { h: 12, m: null };
  return null;
}

// Qué día dice, sin inventar: día de la semana, día del mes o «hoy / mañana / pasado mañana».
function leerDia(t, hoy) {
  const sinFranja = t.replace(/(por|de|a) la manana|mananas|primera hora de la manana/g, ' ');
  if (/\bpasado manana\b/.test(sinFranja)) return { fecha: T.sumarDias(hoy, 2) };
  if (/\bmanana\b/.test(sinFranja)) return { fecha: T.sumarDias(hoy, 1) };
  if (/\bhoy\b/.test(t)) return { fecha: hoy };
  const salida = {};
  let m;
  if ((m = new RegExp(`\\b(\\d{1,2}) de (${Object.keys(MESES).join('|')})\\b`).exec(t))) {
    salida.diaMes = Number(m[1]);
    salida.mes = MESES[m[2]];
  } else if ((m = /\b(?:el|dia|el dia) (\d{1,2})\b(?!\s*(?:[:.h]\d|h\b|horas?\b|de la (?:manana|tarde)|y (?:media|cuarto)))/.exec(t))) {
    if (Number(m[1]) >= 1 && Number(m[1]) <= 31) salida.diaMes = Number(m[1]);
  }
  if ((m = /\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/.exec(t))) salida.diaSemana = DIAS[m[1]];
  return Object.keys(salida).length ? salida : null;
}

const minutos = (hora) => T.minutosDe(hora);

function encaja(hueco, f) {
  if (f.fecha && hueco.fecha !== f.fecha) return false;
  if (f.diaSemana && T.diaSemana(hueco.fecha) !== f.diaSemana) return false;
  if (f.diaMes && Number(hueco.fecha.slice(8, 10)) !== f.diaMes) return false;
  if (f.mes && Number(hueco.fecha.slice(5, 7)) !== f.mes) return false;
  if (f.hora) {
    const [h, m] = hueco.hora.split(':').map(Number);
    if (h !== f.hora.h) return false;
    if (f.hora.m != null && m !== f.hora.m) return false;
  }
  if (f.franja === 'manana' && minutos(hueco.hora) >= 14 * 60) return false;
  if (f.franja === 'tarde' && minutos(hueco.hora) < 14 * 60) return false;
  return true;
}

// La fecha que pide, si no era de las ofrecidas: el próximo día que encaja a partir de mañana.
function resolverFecha(f, hoy) {
  if (f.fecha) return f.fecha;
  for (let i = 1; i <= 62; i++) {
    const d = T.sumarDias(hoy, i);
    if (f.diaSemana && T.diaSemana(d) !== f.diaSemana) continue;
    if (f.diaMes && Number(d.slice(8, 10)) !== f.diaMes) continue;
    if (f.mes && Number(d.slice(5, 7)) !== f.mes) continue;
    return d;
  }
  return null;
}

const dosDigitos = (n) => String(n).padStart(2, '0');

/**
 * @param {string} texto      lo que ha contestado el paciente
 * @param {Array} huecos      los que se le ofrecieron, en orden: [{ fecha, hora }]
 * @param {object} o          { hoy: 'AAAA-MM-DD' }
 */
function elegirHueco(texto, huecos, { hoy }) {
  const lista = Array.isArray(huecos) ? huecos : [];
  const completo = normalizar(texto);
  // «El martes no puedo, mejor el miércoles», «vale, pero por la tarde», «ninguno de esos, ¿el
  // viernes?»: manda la última parte que dice algo concreto y no es una negativa.
  const partes = completo.split(/[,;.?]+|\b(?:pero|mejor(?! que)|prefiero|preferiria|mas bien)\b/).map((x) => x.trim()).filter(Boolean);
  const concretas = partes.filter((c) => (leerDia(c, hoy) || leerHora(c) || detectarFranja(c) || ORDINALES.some(([rx]) => rx.test(c)))
    && !NEGATIVO.test(c) && !NINGUNO.test(c));
  const t = concretas.length ? concretas.at(-1) : completo;

  // «Ninguno me viene bien» (o «ninguno, mejor por la tarde»): otros. Si además dice un día o una
  // hora («ninguno, mejor el jueves»), se sigue con eso.
  if (NINGUNO.test(completo) && !leerDia(t, hoy) && !leerHora(t)) return { tipo: 'otros', franja: detectarFranja(t), evitar: null };

  for (const [rx, i] of ORDINALES) {
    if (rx.test(t) && lista.length) {
      const hueco = i === -1 ? lista.at(-1) : lista[i];
      if (hueco) return { tipo: 'elegido', hueco };
    }
  }

  const dia = leerDia(t, hoy);
  const hora = leerHora(t);
  const franja = hora ? null : detectarFranja(t);

  // «El martes no puedo»: se buscan otros, fuera de ese día.
  if (NEGATIVO.test(t) || NINGUNO.test(t)) return { tipo: 'otros', franja, evitar: dia };

  if (!dia && !hora && !franja) {
    if (!ACEPTA.test(t) || !lista.length) return null;
    return lista.length === 1 ? { tipo: 'elegido', hueco: lista[0] } : { tipo: 'dudoso', candidatos: lista };
  }

  const candidatos = lista.filter((h) => encaja(h, { ...(dia || {}), hora, franja }));
  // Con solo «por la tarde» no ha elegido: ha dicho qué prefiere. Se le confirma antes de reservar.
  if (candidatos.length === 1 && (dia || hora)) return { tipo: 'elegido', hueco: candidatos[0] };
  if (candidatos.length) return { tipo: 'dudoso', candidatos };

  // Pide algo que no se le ofreció: se mira en la agenda.
  const fecha = dia ? resolverFecha(dia, hoy) : null;
  if (dia && !fecha) return null;
  return { tipo: 'pide', fecha, hora: hora ? `${dosDigitos(hora.h)}:${dosDigitos(hora.m ?? 0)}` : null, franja };
}

module.exports = { elegirHueco, leerHora, leerDia };
