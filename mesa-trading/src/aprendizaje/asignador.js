'use strict';
// Asignador mensual de capital entre mesas — ARQUITECTURA §5.7.
//
// Por qué así (critica-sintesis §1 y §3, propuesta-cuant §5):
// - Base = paridad de riesgo (1/vol) entre titulares: cada mesa aporta un
//   riesgo parecido, sin fiarse de Sharpes que con meses de papel son ruido.
// - Objetivo = base × limitar(1 + sharpeAjustado, 0,5, 2): una inclinación
//   acotada; el Sharpe ya viene contraído n/(n+30).
// - Sin cambio con < 20 operaciones o < 60 días: no se mueve capital por ruido.
// - Suavizado 0,7·actual + 0,3·objetivo, suelo 5 %, techo 40 %.
// - Incubación fija 2 %; los titulares se reparten 1 − Σ incubación.
// - Despido (banquillo, peso 0; su sombra ya no abre nada): sharpeAjustado < −0,5 con
//   ≥ 40 operaciones, o caída máxima de la mesa > 25 %.
// - Incubación de ≥ 60 días: asciende si Sharpe de papel > Sharpe de
//   backtest − 1 con ≥ 10 operaciones; si no, se descarta.
//
// El objetivo se normaliza al presupuesto de titulares ANTES de mezclarlo con
// el peso actual: así 0,7/0,3 pesan de verdad 0,7/0,3 (dos repartos que suman
// lo mismo). Un titular sin peso actual (primer reparto) recibe su objetivo.

const { limitar } = require('../util/numeros');
const { pct, numero: fNumero } = require('../util/formato');

const REGLAS = Object.freeze({
  minOperaciones: 20,
  minDias: 60,
  suavizadoActual: 0.7,
  suavizadoObjetivo: 0.3,
  suelo: 0.05,
  techo: 0.40,
  incubacion: 0.02,
  inclinacionMin: 0.5,
  inclinacionMax: 2,
  despidoSharpe: -0.5,
  despidoMinOperaciones: 40,
  despidoMaxDD: 0.25,
  incubacionDias: 60,
  ascensoMinOperaciones: 10,
  ascensoMargenSharpe: 1,
});

const HOLGURA = 1e-9;
const esNumero = x => typeof x === 'number' && Number.isFinite(x);
const p1 = x => pct(x, { decimales: 1 });
const n2 = x => fNumero(x, 2);

// Reparte `presupuesto` entre `items` ({ id, propuesto, fijo }) respetando
// suelo y techo. Los fijos (muestra corta) conservan su peso si cabe; el
// resto se escala en proporción a lo propuesto y se recorta por arriba y por
// abajo hasta que todo cabe. Devuelve { id: { peso, limite } }.
function repartir(items, presupuesto, suelo, techo) {
  const out = {};
  const n = items.length;
  if (!n) return out;
  if (n * techo <= presupuesto + HOLGURA) {
    // No cabe todo: cada mesa en el techo y el resto queda en efectivo.
    for (const it of items) out[it.id] = { peso: techo, limite: 'techo' };
    return out;
  }
  if (n * suelo >= presupuesto - HOLGURA) {
    for (const it of items) out[it.id] = { peso: presupuesto / n, limite: 'suelo' };
    return out;
  }

  const fijos = items.filter(it => it.fijo);
  let libres = items.filter(it => !it.fijo);
  let sumaFijos = 0;
  for (const it of fijos) {
    const peso = limitar(it.propuesto, suelo, techo);
    out[it.id] = { peso, limite: peso > it.propuesto + HOLGURA ? 'suelo' : peso < it.propuesto - HOLGURA ? 'techo' : null };
    sumaFijos += peso;
  }
  let restante = presupuesto - sumaFijos;
  const cabeEnLibres = libres.length && restante >= libres.length * suelo - HOLGURA && restante <= libres.length * techo + HOLGURA;
  const cuadraSinLibres = !libres.length && Math.abs(restante) <= HOLGURA;
  if (!cabeEnLibres && !cuadraSinLibres) {
    // Los fijos no dejan hueco coherente (p. ej. cambió la incubación o hubo
    // un despido y no hay nadie libre): se escalan todos juntos.
    for (const it of fijos) delete out[it.id];
    libres = items;
    restante = presupuesto;
  }

  let activos = [...libres];
  let asignado = 0;
  for (let vuelta = 0; vuelta <= n && activos.length; vuelta++) {
    const disponible = restante - asignado;
    const suma = activos.reduce((s, it) => s + Math.max(0, it.propuesto), 0);
    const pesos = activos.map(it => (suma > 0 ? (Math.max(0, it.propuesto) / suma) * disponible : disponible / activos.length));
    const siguen = [];
    let recortes = 0;
    activos.forEach((it, i) => {
      if (pesos[i] > techo + HOLGURA) { out[it.id] = { peso: techo, limite: 'techo' }; asignado += techo; recortes++; }
      else if (pesos[i] < suelo - HOLGURA) { out[it.id] = { peso: suelo, limite: 'suelo' }; asignado += suelo; recortes++; }
      else siguen.push({ it, peso: pesos[i] });
    });
    if (!recortes) {
      for (const { it, peso } of siguen) out[it.id] = { peso, limite: null };
      activos = [];
      break;
    }
    activos = siguen.map(s => s.it);
  }
  return out;
}

function reasignar({ mesas = [], ahora = null } = {}) {
  const R = REGLAS;
  const pesos = {};
  const cambios = [];
  const despidos = [];
  const ascensos = [];
  const descartes = [];
  const detalle = {};
  const motivos = {};
  const titulares = [];
  const incubando = [];

  for (const m of mesas) {
    const met = m.metricas || {};
    const dias = esNumero(m.diasActiva) ? m.diasActiva : (esNumero(met.diasActiva) ? met.diasActiva : 0);
    const ops = esNumero(met.operaciones) ? met.operaciones : 0;

    // Sin estado se entiende titular; un estado desconocido (p. ej. una mesa ya
    // descartada que siga en la lista) no recibe capital.
    const estado = m.estado || 'titular';
    if (estado !== 'titular' && estado !== 'incubacion') { pesos[m.id] = 0; continue; }

    if (estado === 'incubacion') {
      if (dias < R.incubacionDias) { incubando.push(m); continue; }
      const umbral = esNumero(m.sharpeBacktest) ? m.sharpeBacktest - R.ascensoMargenSharpe : null;
      const sharpeOk = umbral !== null && esNumero(met.sharpe) && met.sharpe > umbral;
      if (sharpeOk && ops >= R.ascensoMinOperaciones) {
        ascensos.push(m.id);
        motivos[m.id] = `Asciende tras ${dias} días: Sharpe de papel ${n2(met.sharpe)} > backtest ${n2(m.sharpeBacktest)} − 1 con ${ops} operaciones.`;
        titulares.push({ m, ops, dias });
      } else {
        descartes.push(m.id);
        pesos[m.id] = 0;
        motivos[m.id] = !sharpeOk
          ? `Descartada tras ${dias} días: Sharpe de papel ${esNumero(met.sharpe) ? n2(met.sharpe) : 'sin dato'} no supera backtest ${esNumero(m.sharpeBacktest) ? n2(m.sharpeBacktest) : 'sin dato'} − 1.`
          : `Descartada tras ${dias} días: ${ops} operaciones (mínimo ${R.ascensoMinOperaciones}).`;
      }
      continue;
    }

    // Titular: ¿despido? No espera a la muestra mínima: el criterio de Sharpe
    // ya exige 40 operaciones y una caída del 25 % no necesita más pruebas.
    const porSharpe = esNumero(met.sharpeAjustado) && met.sharpeAjustado < R.despidoSharpe && ops >= R.despidoMinOperaciones;
    const porCaida = esNumero(met.maxDD) && met.maxDD > R.despidoMaxDD;
    if (porSharpe || porCaida) {
      despidos.push(m.id);
      pesos[m.id] = 0;
      motivos[m.id] = porCaida
        ? `Despido al banquillo: caída máxima ${p1(met.maxDD)} (máximo ${p1(R.despidoMaxDD)}).`
        : `Despido al banquillo: Sharpe ajustado ${n2(met.sharpeAjustado)} con ${ops} operaciones (umbral ${n2(R.despidoSharpe)} con ≥ ${R.despidoMinOperaciones}).`;
      continue;
    }
    titulares.push({ m, ops, dias });
  }

  for (const m of incubando) pesos[m.id] = R.incubacion;
  const presupuesto = Math.max(0, 1 - R.incubacion * incubando.length);

  // Base de paridad de riesgo. Una mesa sin volatilidad conocida toma la media
  // de las demás (ni premio ni castigo por no tener dato).
  const volsValidas = titulares.map(t => t.m.volHistorica).filter(v => esNumero(v) && v > 0);
  const volMedia = volsValidas.length ? volsValidas.reduce((s, v) => s + v, 0) / volsValidas.length : 1;
  const inversas = titulares.map(t => 1 / (esNumero(t.m.volHistorica) && t.m.volHistorica > 0 ? t.m.volHistorica : volMedia));
  const sumaInv = inversas.reduce((s, x) => s + x, 0);
  const bases = inversas.map(x => (sumaInv > 0 ? x / sumaInv : 0));
  const brutos = titulares.map((t, i) => {
    const sa = esNumero(t.m.metricas && t.m.metricas.sharpeAjustado) ? t.m.metricas.sharpeAjustado : 0;
    return bases[i] * limitar(1 + sa, R.inclinacionMin, R.inclinacionMax);
  });
  const sumaBrutos = brutos.reduce((s, x) => s + x, 0);
  const objetivos = brutos.map(x => (sumaBrutos > 0 ? (x / sumaBrutos) * presupuesto : 0));

  const items = titulares.map((t, i) => {
    const actual = esNumero(t.m.pesoActual) && t.m.pesoActual >= 0 ? t.m.pesoActual : null;
    const muestraCorta = t.ops < R.minOperaciones || t.dias < R.minDias;
    let propuesto;
    let fijo = false;
    let texto;
    if (actual === null) {
      propuesto = objetivos[i];
      texto = `Primer reparto: paridad de riesgo ${p1(bases[i])} → ${p1(objetivos[i])}.`;
    } else if (muestraCorta) {
      propuesto = actual;
      fijo = true;
      texto = `Sin cambio: ${t.ops} operaciones y ${t.dias} días (mínimo ${R.minOperaciones} y ${R.minDias}).`;
    } else {
      propuesto = R.suavizadoActual * actual + R.suavizadoObjetivo * objetivos[i];
      const sa = t.m.metricas && t.m.metricas.sharpeAjustado;
      texto = `Sharpe ajustado ${esNumero(sa) ? n2(sa) : 'sin dato'}: objetivo ${p1(objetivos[i])}; 0,7·${p1(actual)} + 0,3·${p1(objetivos[i])} = ${p1(propuesto)}.`;
    }
    detalle[t.m.id] = { base: bases[i], objetivo: objetivos[i], propuesto, fijo };
    if (motivos[t.m.id]) texto = `${motivos[t.m.id]} ${texto}`;
    motivos[t.m.id] = texto;
    return { id: t.m.id, propuesto, fijo };
  });

  const reparto = repartir(items, presupuesto, R.suelo, R.techo);
  for (const it of items) {
    const { peso, limite } = reparto[it.id] || { peso: 0, limite: null };
    pesos[it.id] = peso;
    detalle[it.id].final = peso;
    detalle[it.id].limite = limite;
    if (limite === 'techo') motivos[it.id] += ` Techo del ${p1(R.techo)}.`;
    else if (limite === 'suelo') motivos[it.id] += ` Suelo del ${p1(R.suelo)}.`;
    else if (Math.abs(peso - it.propuesto) > 1e-6) motivos[it.id] += ` Normalizado al ${p1(presupuesto)} de los titulares: ${p1(peso)}.`;
  }

  for (const m of mesas) {
    const de = esNumero(m.pesoActual) ? m.pesoActual : 0;
    const a = pesos[m.id] ?? 0;
    if (Math.abs(a - de) > 1e-6) {
      cambios.push({ id: m.id, de, a, motivo: motivos[m.id] || (m.estado === 'incubacion' ? `Incubación: ${p1(R.incubacion)} fijo.` : '') });
    }
  }

  return { pesos, cambios, despidos, ascensos, descartes, detalle, presupuestoTitulares: presupuesto, t: ahora };
}

module.exports = { reasignar, repartir, REGLAS };
