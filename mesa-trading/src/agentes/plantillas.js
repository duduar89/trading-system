'use strict';
// Plantillas (§6.4): funciones puras que convierten datos del código en frases
// cortas en español. Son lo que se ve cuando no hay LLM, cuando se acaba el
// presupuesto o cuando un texto de LLM no pasa verificarCifras(). Por eso cada
// una aguanta datos incompletos sin escribir «undefined» ni «NaN»: una cifra
// que falta sale como «—».
//
// Firmas (todas reciben un objeto; los campos que faltan no rompen nada):
//   estadoPuesto({ etiqueta, marco, posicion: {cantidad, entrada, stop, pnlAbiertoPct} | null, estadoEstrategia })
//   notaAnalista({ etiqueta, precio, sesgo, sma50, rsi, volAnual, marco })
//   regimen({ valor, puntos, anterior, detalle })
//   propuesta({ etiqueta, lado, nocional, cantidad, precio, stop, factor? })
//   aprobacion({ etiqueta, lado, decision, nocional, nocionalPedido, cantidad, motivos })
//   veto({ etiqueta, motivos: [{ texto }] })
//   ejecucion({ etiqueta, lado, cantidad, precio, nocional, comision })
//   cierre({ etiqueta, pnl, pnlPct, motivoSalida, barras, rMultiple })
//   stopSaltado({ etiqueta, precio, stop })
//   informeComite(jefe, datos) o informeComite.<jefe>(datos), jefe ∈ controller|macro|riesgos|mesas|laboratorio|megafono
//   decisionComite({ modo, multiplicadores: {mesaId: m}, vetos: [simbolo], fuente: 'llm'|'defecto' }, mesas?)
//   directiva(d, mesas?)  (una directiva del Megáfono, §6.5)
//     mesas: [{ id, nombre }] opcional; con ella se escribe el nombre de la mesa
//     («Reversión RSI») en vez de su id («reversion», «lab3»).
//   leccion({ mesaId, etiqueta, categoria, pnl, barras, leccion })
//   hipotesis({ id, familia, marco, universo, filtros, origen })
//   resultadoHipotesis({ id, aprobada, criterios: [{ nombre, valor, umbral, ok }] })
//   contratacion({ nombre, familia, peso, universo })
//   despido({ nombre, motivo })
//   informeDiario({ dia, desde?, hasta?, patrimonio, pnlDia, pnlDiaPct, operaciones, acierto, gastoLLMUsd })
//     desde/hasta (ms): tramo que cubre el cierre; si no dura 24 h (±30 min),
//     se escribe el tramo en vez del día. gastoLLMUsd null: no se dice.
//   informeSemanal({ rentabilidad, sharpe90Fondo, sharpe90SinComite, sharpe90Btc })
//   descanso({ minutos })
//   killSwitch({ motivo })
//   soloCerrar({ motivo, hasta })
//   reabrir({ quien, patrimonio?, pico? })  (con las dos cifras, dice cuánto
//     acumula el fondo desde su máximo histórico)
//   conciliacion({ acciones: [{ tipo, simbolo }], grave })

const f = require('../util/formato');

const MAX = 140;
const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// Una frase: espacios normalizados y, como mucho, 140 caracteres. Se corta
// por un separador, nunca a mitad de un número: «54…» se leería como cifra.
function frase(texto, max = MAX) {
  const s = String(texto).replace(/\s+/g, ' ').trim()
    .replace(/\ba el activo\b/g, 'al activo').replace(/\bde el activo\b/g, 'del activo');
  if (s.length <= max) return s;
  const corte = s.slice(0, max - 1);
  let i = Math.max(corte.lastIndexOf('; '), corte.lastIndexOf(', '), corte.lastIndexOf('. '));
  if (i < max * 0.5) i = corte.lastIndexOf(' ');
  const base = i > 0 ? corte.slice(0, i) : corte;
  return base.replace(/[\s;,.:(–-]+$/, '') + '…';
}

// Texto opcional: nunca «undefined» ni «null».
const t = (x, porDefecto = '—') => (x === null || x === undefined || x === '' || (typeof x === 'number' && !Number.isFinite(x)) ? porDefecto : String(x));
const fin = x => typeof x === 'number' && Number.isFinite(x);
const etq = x => t(x && String(x).includes('/') ? String(x).split('/')[0] : x, 'el activo');

const MARCO_CORTO = { '1Hour': '1H', '4Hour': '4H', '1Day': '1D' };
const marcoCorto = m => MARCO_CORTO[m] || t(m, '');

const CATEGORIA_TEXTO = {
  señal_falsa: 'señal falsa',
  stop_estrecho: 'stop estrecho',
  contra_regimen: 'contra el régimen',
  noticia: 'noticia',
  ejecucion: 'ejecución',
  acierto_de_libro: 'acierto de libro',
  suerte: 'suerte',
};

const MOTIVO_SALIDA = { señal: 'por señal', stop: 'por stop', kill: 'por kill switch', riesgo: 'por riesgo', manual: 'a mano', prueba: 'de prueba', fin: 'al final' };

// Nombre de una mesa para el humano: el de la lista si está, si no su id.
function nombreMesa(id, mesas) {
  const m = Array.isArray(mesas) ? mesas.find(x => x && x.id === id) : null;
  return t((m && m.nombre) || id);
}

// «02-jun 00:05» en UTC (el día de los cierres es el día UTC).
function momentoUTC(ms) {
  const d = new Date(ms);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${dd}-${MESES[d.getUTCMonth()]} ${hh}:${mm}`;
}

function lista(xs, max = 4) {
  const v = (xs || []).map(x => t(x, '')).filter(Boolean);
  if (!v.length) return '';
  return v.length > max ? `${v.slice(0, max).join(', ')} y ${v.length - max} más` : v.join(', ');
}

function estadoPuesto({ etiqueta, marco, posicion, estadoEstrategia } = {}) {
  const e = etq(etiqueta);
  if (!posicion || !(posicion.cantidad > 0)) {
    // La estrategia ya escribe su espera con cifras (§4.3): se respeta.
    if (estadoEstrategia) return frase(estadoEstrategia);
    const m = marcoCorto(marco);
    return frase(`Sin posición en ${e}. Esperando señal${m ? ` (${m})` : ''}.`);
  }
  const pnl = fin(posicion.pnlAbiertoPct) ? `, ${f.pct(posicion.pnlAbiertoPct, { signo: true })}` : '';
  return frase(`Largo en ${e}: ${f.cantidad(posicion.cantidad)} a ${f.precio(posicion.entrada)}, stop ${f.precio(posicion.stop)}${pnl}.`);
}

function notaAnalista({ etiqueta, precio, sesgo, sma50, rsi, volAnual, marco = '4Hour' } = {}) {
  const partes = [];
  if (fin(sma50) && fin(precio)) partes.push(`${precio >= sma50 ? 'sobre' : 'bajo'} SMA50 ${f.precio(sma50)}`);
  if (fin(rsi)) partes.push(`RSI ${marcoCorto(marco)} ${f.numero(rsi, 0)}`);
  if (fin(volAnual)) partes.push(`vol. 30 d ${f.pct(volAnual, { decimales: 0 })}`);
  const resto = partes.length ? '. ' + partes.join(', ').replace(/^./, c => c.toUpperCase()) : '';
  return frase(`${etq(etiqueta)} ${f.precio(precio)}: sesgo ${t(sesgo, 'sin definir')}${resto}.`);
}

const signoPuntos = p => (fin(p) ? (p > 0 ? `+${p}` : String(p).replace('-', '−')) : '—');

function regimen({ valor, puntos, anterior, detalle } = {}) {
  const v = t(valor, 'NEUTRAL');
  const cabeza = anterior && anterior !== v
    ? `Régimen: ${anterior} → ${v} (${signoPuntos(puntos)}).`
    : `Régimen ${v} (${signoPuntos(puntos)}).`;
  // El detalle de calcularRegimen empieza repitiendo «VALOR (±n):»; se quita.
  const d = detalle ? String(detalle).replace(/^[A-Z-]+\s*\([^)]*\):\s*/, '') : '';
  return frase(d ? `${cabeza} ${d}` : cabeza);
}

// `factor` (opcional): el factor de tamaño ya aplicado (mesas.tamanoApertura),
// { total, comite, mesa, megafono, caida }; si recorta, se dice de dónde viene.
function propuesta({ etiqueta, lado = 'compra', nocional, cantidad, precio, stop, factor } = {}) {
  const e = etq(etiqueta);
  if (lado === 'venta') return frase(`Propongo vender ${f.cantidad(cantidad)} ${e} a ${f.precio(precio)}.`);
  const s = fin(stop) ? `, stop ${f.precio(stop)}` : '';
  let tam = '';
  if (factor && fin(factor.total) && factor.total < 1) {
    const causas = [factor.comite < 1 && 'DEFENSIVO', factor.mesa < 1 && `mesa ${f.factor(factor.mesa)}`, factor.megafono < 1 && 'Megáfono', factor.caida < 1 && 'caída'].filter(Boolean);
    tam = ` (tamaño ${f.factor(factor.total)}${causas.length ? `: ${causas.join(', ')}` : ''})`;
  }
  return frase(`Propongo comprar ${f.usd(nocional)} de ${e} a ${f.precio(precio)}${s}${tam}.`);
}

function aprobacion({ etiqueta, lado = 'compra', decision = 'aprobar', nocional, nocionalPedido, cantidad, motivos } = {}) {
  const e = etq(etiqueta);
  if (lado === 'venta') return frase(`Aprobada la venta de ${f.cantidad(cantidad)} ${e}.`);
  if (decision === 'reducir' || (fin(nocionalPedido) && fin(nocional) && nocional < nocionalPedido)) {
    const m = motivos && motivos[0] && motivos[0].texto ? ` ${motivos[0].texto}` : '';
    return frase(`Aprobado con recorte: ${f.usd(nocional)} de ${e} (pedía ${f.usd(nocionalPedido)}).${m}`);
  }
  return frase(`Aprobado: ${f.usd(nocional)} de ${e}.`);
}

function veto({ etiqueta, motivos } = {}) {
  const ms = (motivos || []).filter(m => m && m.texto);
  const primero = ms.length ? ms[0].texto : 'fuera de límites';
  const mas = ms.length > 1 ? ` (+${ms.length - 1} motivo${ms.length > 2 ? 's' : ''})` : '';
  return frase(`Veto a ${etq(etiqueta)}: ${primero}${mas}`);
}

function ejecucion({ etiqueta, lado = 'compra', cantidad, precio, nocional, comision } = {}) {
  const verbo = lado === 'venta' ? 'Vendidos' : 'Comprados';
  const importe = fin(nocional) ? nocional : (fin(cantidad) && fin(precio) ? cantidad * precio : null);
  const com = fin(comision) ? ` Comisión ${f.usd(comision)}.` : '';
  return frase(`${verbo} ${f.cantidad(cantidad)} ${etq(etiqueta)} a ${f.precio(precio)} (${f.usd(importe)}).${com}`);
}

function cierre({ etiqueta, pnl, pnlPct, motivoSalida, barras, rMultiple } = {}) {
  const motivo = MOTIVO_SALIDA[motivoSalida] || '';
  const velas = fin(barras) ? ` en ${f.numero(barras)} vela${barras === 1 ? '' : 's'}` : '';
  const r = fin(rMultiple) ? `, ${f.numero(rMultiple, 1)} R` : '';
  const pct = fin(pnlPct) ? ` (${f.pct(pnlPct, { signo: true })}${r})` : '';
  return frase(`Cerrada ${etq(etiqueta)}${motivo ? ' ' + motivo : ''}: ${f.usd(pnl, { signo: true })}${pct}${velas}.`);
}

function stopSaltado({ etiqueta, precio, stop } = {}) {
  return frase(`Stop de ${etq(etiqueta)} saltado: ${f.precio(precio)} ≤ ${f.precio(stop)}. Vendo a mercado.`);
}

// ---------- Comité: un informe por jefe (§6.8) ----------

const INFORMES = {
  controller({ patrimonio, pnlDia, pnlDiaPct, caida, exposicionBrutaPct, posiciones } = {}) {
    return frase(`Patrimonio ${f.usd(patrimonio)}, hoy ${f.usd(pnlDia, { signo: true })} (${f.pct(pnlDiaPct, { signo: true })}). `
      + `Caída ${f.pct(fin(caida) ? Math.abs(caida) : caida)}. Exposición ${f.pct(exposicionBrutaPct, { decimales: 0 })}, ${f.numero(posiciones)} posiciones.`);
  },
  macro({ regimen: valor, puntos, voto } = {}) {
    return frase(`Régimen ${t(valor, 'NEUTRAL')} (${signoPuntos(puntos)}). Voto ${t(voto, 'NORMAL')}.`);
  },
  riesgos({ nivel, vetos, cercanos, voto } = {}) {
    const cerca = cercanos && cercanos.length ? ` Cerca del límite: ${lista(cercanos, 2)}.` : '';
    return frase(`Nivel ${t(nivel, 'normal')}, ${f.numero(fin(vetos) ? vetos : 0)} vetos en el periodo. Voto ${t(voto, 'NORMAL')}.${cerca}`);
  },
  mesas({ mejor, peor } = {}) {
    if (!mejor && !peor) return frase('Mesas: sin operaciones cerradas en el periodo.');
    const m = mejor ? `Mejor: ${t(mejor.nombre)} ${f.usd(mejor.pnl, { signo: true })}.` : '';
    const p = peor ? ` Peor: ${t(peor.nombre)} ${f.usd(peor.pnl, { signo: true })}.` : '';
    return frase(`${m}${p}`);
  },
  laboratorio({ enCurso, aprobadas, ensayos } = {}) {
    return frase(`Laboratorio: ${f.numero(fin(enCurso) ? enCurso : 0)} hipótesis en curso, ${f.numero(fin(aprobadas) ? aprobadas : 0)} aprobadas; `
      + `${f.numero(fin(ensayos) ? ensayos : 0)} ensayos acumulados.`);
  },
  megafono({ vigentes, pendientes } = {}) {
    const v = fin(vigentes) ? vigentes : 0;
    const p = fin(pendientes) ? pendientes : 0;
    return frase(`Megáfono: ${v === 0 ? 'ninguna directiva vigente' : `${f.numero(v)} directiva${v === 1 ? '' : 's'} vigente${v === 1 ? '' : 's'}`}, `
      + `${p === 0 ? 'nada pendiente' : `${f.numero(p)} pendiente${p === 1 ? '' : 's'} de aplicar`}.`);
  },
};

function informeComite(jefe, datos) {
  const fn = INFORMES[jefe];
  return fn ? fn(datos || {}) : frase(`Sin informe de ${t(jefe, 'este punto')}.`);
}
Object.assign(informeComite, INFORMES);

function decisionComite({ modo, multiplicadores, vetos, fuente } = {}, mesas = null) {
  const porValor = { 0: [], 0.5: [] };
  for (const [id, m] of Object.entries(multiplicadores || {})) if (m === 0 || m === 0.5) porValor[m].push(nombreMesa(id, mesas));
  // De más a menos grave, con «(plan por defecto)» en la cabeza: con nombres
  // de mesa largos, lo que se recorta es lo último, las mesas a la mitad.
  const partes = [`Decisión: modo ${t(modo, 'NORMAL')}${fuente === 'defecto' ? ' (plan por defecto)' : ''}.`];
  if (porValor[0].length) partes.push(`Mesas paradas: ${lista(porValor[0], 3)}.`);
  if (vetos && vetos.length) partes.push(`Vetos 24 h: ${lista(vetos.map(etq), 3)}.`);
  if (porValor[0.5].length) partes.push(`Mesas a la mitad: ${lista(porValor[0.5], 3)}.`);
  return frase(partes.join(' '));
}

function directiva(d = {}, mesas = null) {
  d = d || {};
  const h = fin(d.horas) ? ` durante ${f.numero(d.horas)} h` : '';
  switch (d.tipo) {
    case 'reducir_riesgo': return frase(`Reducir el tamaño de las entradas al ${f.pct(d.factor, { decimales: 0 })}${h}.`);
    case 'pausar_activo': return frase(`No abrir en ${etq(d.simbolo)}${h}.`);
    case 'pausar_mesa': return frase(`Pausar la mesa ${nombreMesa(d.mesaId, mesas)}${h}.`);
    case 'solo_cerrar': return frase(`Solo cerrar posiciones, sin abrir nada${h}.`);
    case 'reanudar_activo': return frase(`Quitar la pausa del Megáfono en ${etq(d.simbolo)}.`);
    case 'reanudar_mesa': return frase(`Quitar la pausa del Megáfono a la mesa ${nombreMesa(d.mesaId, mesas)}.`);
    case 'sin_efecto': return frase(`Sin efecto: ${t(d.motivo, 'no hay nada que aplicar')}.`.replace(/\.\.$/, '.'));
    default: return frase('Directiva desconocida: no se aplica.');
  }
}

function leccion({ mesaId, etiqueta, categoria, pnl, barras, leccion: texto } = {}) {
  const cat = CATEGORIA_TEXTO[categoria] || t(categoria, 'sin categoría');
  const cabeza = `Lección ${t(mesaId, 'mesa')}/${etq(etiqueta)} (${cat}):`;
  if (texto) return frase(`${cabeza} ${texto}`);
  const velas = fin(barras) ? ` en ${f.numero(barras)} velas` : '';
  return frase(`${cabeza} ${f.usd(pnl, { signo: true })}${velas}.`);
}

function hipotesis({ id, familia, marco, universo, filtros, origen } = {}) {
  const u = lista((universo || []).map(etq), 3);
  const fil = filtros && filtros.length ? ` con ${lista(filtros.map(x => (x && x.id) || x), 2)}` : '';
  const o = origen === 'leccion' ? 'lección' : origen === 'exploracion' ? 'exploración' : t(origen, '—');
  return frase(`Hipótesis ${t(id)}: ${t(familia)} ${marcoCorto(marco)}${u ? ` en ${u}` : ''}${fil}. Origen: ${o}.`);
}

function resultadoHipotesis({ id, aprobada, criterios } = {}) {
  const cs = criterios || [];
  const ok = cs.filter(c => c && c.ok).length;
  if (aprobada) return frase(`Hipótesis ${t(id)} aprobada: ${f.numero(ok)}/${f.numero(cs.length)} criterios. Pasa a incubación.`);
  const falla = cs.find(c => c && !c.ok);
  const detalle = falla
    ? ` Falla ${t(falla.nombre)}: ${fin(falla.valor) ? f.numero(falla.valor, 2) : t(falla.valor)} frente a ${fin(falla.umbral) ? f.numero(falla.umbral, 2) : t(falla.umbral)}.`
    : '';
  return frase(`Hipótesis ${t(id)} rechazada (${f.numero(ok)}/${f.numero(cs.length)}).${detalle}`);
}

function contratacion({ nombre, familia, peso, universo } = {}) {
  const u = universo && universo.length ? ` en ${lista(universo.map(etq), 3)}` : '';
  return frase(`Contratada la mesa ${t(nombre)} (${t(familia)})${u}, en incubación con ${f.pct(peso, { decimales: 0 })} del capital.`);
}

// Con peso 0, la sombra de la mesa dimensiona con 0 $ y ya no abre nada: lo
// que tenga abierto en sombra solo se cierra por su regla. Lo que pasa de
// verdad va delante, para que un motivo largo no lo corte.
function despido({ nombre, motivo } = {}) {
  const m = String(t(motivo, 'resultados por debajo del umbral')).replace(/[.\s]+$/, '');
  return frase(`Mesa ${t(nombre)} al banquillo (cierra sus puestos y no abre nada nuevo, ni en sombra): ${m}.`);
}

function informeDiario({ dia, desde, hasta, patrimonio, pnlDia, pnlDiaPct, operaciones, acierto, gastoLLMUsd } = {}) {
  const ac = fin(acierto) ? `, acierto ${f.pct(acierto, { decimales: 0 })}` : '';
  const llm = fin(gastoLLMUsd) ? ` LLM ${f.usd(gastoLLMUsd)}.` : '';
  // Un cierre que llega tarde (portátil apagado a las 00:05) cubre más de un
  // día: se dice el tramo real en vez de ponerle la fecha de un solo día.
  const tramo = fin(desde) && fin(hasta) && hasta > desde && Math.abs(hasta - desde - DIA) > 30 * MIN
    ? `(${momentoUTC(desde)} → ${momentoUTC(hasta)} UTC, ${f.numero(Math.round((hasta - desde) / HORA))} h)`
    : t(dia);
  return frase(`Cierre ${tramo}: ${f.usd(patrimonio)} (${f.usd(pnlDia, { signo: true })}, ${f.pct(pnlDiaPct, { signo: true })}). `
    + `${f.numero(fin(operaciones) ? operaciones : 0)} operaciones${ac}.${llm}`);
}

function informeSemanal({ rentabilidad, sharpe90Fondo, sharpe90SinComite, sharpe90Btc } = {}) {
  const s = x => (fin(x) ? f.numero(x, 2) : '—');
  return frase(`Semana ${f.pct(rentabilidad, { signo: true })}. Sharpe 90 d: fondo ${s(sharpe90Fondo)}, sin comité ${s(sharpe90SinComite)}, BTC ${s(sharpe90Btc)}.`);
}

function descanso({ minutos = 15 } = {}) {
  return frase(`Sin trabajo pendiente: ${f.numero(fin(minutos) ? minutos : 15)} min en la sala de descanso.`);
}

function killSwitch({ motivo } = {}) {
  return frase(`KILL SWITCH: ${t(motivo, 'límite duro')}. Cierro todo y bloqueo hasta Reabrir.`);
}

function soloCerrar({ motivo, hasta } = {}) {
  const h = fin(hasta) ? `hasta las ${f.hora(hasta)}` : 'hasta nueva orden';
  return frase(`Solo cerrar ${h}: ${t(motivo, 'límite de pérdida')}.`);
}

// Reabrir no borra el máximo histórico: el mensaje dice con cifras cuánto
// acumula el fondo desde él (el vigilante mide aparte desde la reapertura).
function reabrir({ quien, patrimonio, pico } = {}) {
  const q = t(quien, 'un humano');
  if (!fin(patrimonio) || !fin(pico) || !(pico > 0)) return frase(`Reabierto por ${q}. Conciliación limpia; vuelta a nivel normal.`);
  const maximo = Math.max(pico, patrimonio);
  const perdida = maximo - patrimonio;
  const cabeza = `Reabierto por ${q}.`;
  if (perdida < 0.005) return frase(`${cabeza} El fondo está en su máximo histórico (${f.usd(maximo)}).`);
  return frase(`${cabeza} El fondo sigue un ${f.pct(perdida / maximo)} (${f.usd(perdida)}) por debajo de su máximo histórico (${f.usd(maximo)}).`);
}

function conciliacion({ acciones, grave } = {}) {
  const as = acciones || [];
  if (!as.length) return frase('Conciliación limpia: los libros cuadran con el bróker.');
  const cuenta = tipo => as.filter(a => a && a.tipo === tipo);
  const partes = [];
  const esc = cuenta('escalar');
  const hue = cuenta('huerfana');
  const fan = cuenta('fantasma');
  if (esc.length) partes.push(`${f.numero(esc.length)} ajuste${esc.length === 1 ? '' : 's'} (${lista(esc.map(a => etq(a.simbolo)), 2)})`);
  if (hue.length) partes.push(`${f.numero(hue.length)} huérfana${hue.length === 1 ? '' : 's'} (${lista(hue.map(a => etq(a.simbolo)), 2)})`);
  if (fan.length) partes.push(`${f.numero(fan.length)} fantasma${fan.length === 1 ? '' : 's'} (${lista(fan.map(a => etq(a.simbolo)), 2)})`);
  return frase(`Conciliación: ${partes.join(', ') || f.numero(as.length) + ' diferencias'}.${grave ? ' GRAVE: solo cerrar.' : ''}`);
}

module.exports = {
  estadoPuesto, notaAnalista, regimen, propuesta, aprobacion, veto, ejecucion, cierre, stopSaltado,
  informeComite, decisionComite, directiva, leccion, hipotesis, resultadoHipotesis, contratacion, despido,
  informeDiario, informeSemanal, descanso, killSwitch, soloCerrar, reabrir, conciliacion,
  frase, CATEGORIA_TEXTO, MAX,
};
