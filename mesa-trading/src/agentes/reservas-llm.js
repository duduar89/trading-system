'use strict';
// Reservas del tope diario del LLM compartidas entre procesos (§6.3 y
// ARQUITECTURA-WEB W2).
//
// En el modo web hay varios crearLLM a la vez: el del latido (comité,
// noticias, auditor), el de cada petición del Megáfono y los de cada proceso de
// la web. Cada uno leía el gasto de llm-costes.jsonl, pero lo que las demás
// tenían EN VUELO solo lo sabían ellas (en memoria), así que tres llamadas a la
// vez pasaban el control del tope y el gasto real lo rebasaba. Y si el proceso
// moría a mitad de una llamada (el vigía del latido), la llamada ya había
// salido y se cobraba, pero nadie la apuntaba nunca.
//
// Aquí, junto a llm-costes.jsonl:
// - llm-reservas.jsonl: una línea { id, t, costeUsd, intentos, vence,
//   proposito, modelo, pid } al reservar y otra { id, cierra: true } al acabar. Abierta = sin su
//   cierre.
// - .llm-reservas: un cerrojo corto (flag 'wx', milisegundos) bajo el que se
//   mira el gasto, se reserva, y se apunta el coste y el cierre. Así mirar y
//   reservar son una sola cosa para todos los procesos.
// - Una reserva abierta y vencida (su `vence` es el timeout total de la
//   llamada más un margen: nadie puede seguir esperándola) es de un proceso que
//   murió a mitad. Se salda una sola vez: se apunta en llm-costes.jsonl con su
//   estimado por cada intento posible (`estimado: true, huerfana: true`, como
//   una llamada cortada por timeout), porque la llamada pudo cobrarse, y se
//   cierra.
//
// El tiempo aquí es de infraestructura (Date.now()): cuándo vence una llamada y
// cuánto lleva un cerrojo. El día del gasto lo pone quien llama (`t`).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { anadirJSONL, leerJSONL } = require('../util/almacen');
const { diaUTC } = require('../util/reloj');

const CERROJO_VIEJO_MS = 10_000;     // un cerrojo de milisegundos con 10 s es de un proceso muerto
const ESPERA_CERROJO_MS = 5_000;
const REINTENTO_MS = 15;
const COMPACTAR_BYTES = 256 * 1024;

const dormir = ms => new Promise(r => setTimeout(r, ms));
const n0 = x => (Number.isFinite(x) ? x : 0);

function crearReservas({ rutaCostes, ahora = () => Date.now() }) {
  const carpeta = path.dirname(rutaCostes);
  const rutaReservas = path.join(carpeta, 'llm-reservas.jsonl');
  const rutaCerrojo = path.join(carpeta, '.llm-reservas');

  async function conCerrojo(fn) {
    fs.mkdirSync(carpeta, { recursive: true });
    const t0 = Date.now();
    for (;;) {
      try {
        fs.writeFileSync(rutaCerrojo, String(process.pid), { flag: 'wx' });
        break;
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
      }
      try {
        if (Date.now() - fs.statSync(rutaCerrojo).mtimeMs > CERROJO_VIEJO_MS) fs.unlinkSync(rutaCerrojo);
      } catch (_) { /* lo soltaron entre medias */ }
      if (Date.now() - t0 > ESPERA_CERROJO_MS) throw new Error('el cerrojo de las reservas del LLM no se soltó a tiempo');
      await dormir(REINTENTO_MS);
    }
    try {
      return fn();
    } finally {
      try { fs.unlinkSync(rutaCerrojo); } catch (_) { /* ya no está */ }
    }
  }

  // Reservas abiertas (sin su cierre), en orden de apertura.
  function abiertas() {
    const mapa = new Map();
    for (const r of leerJSONL(rutaReservas)) {
      if (!r || !r.id) continue;
      if (r.cierra) mapa.delete(r.id);
      else mapa.set(r.id, r);
    }
    return [...mapa.values()];
  }

  // Gasto apuntado del día (UTC) de `t` en llm-costes.jsonl.
  function gastoDelDiaEnDisco(t) {
    const dia = diaUTC(t);
    let s = 0;
    for (const r of leerJSONL(rutaCostes)) if (r && Number.isFinite(r.t) && diaUTC(r.t) === dia) s += n0(r.costeUsd);
    return s;
  }

  // Salda las vencidas: se apuntan como gastadas (estimadas) y se cierran.
  // Devuelve los registros apuntados.
  function saldarVencidas(lista) {
    const saldados = [];
    const ya = ahora();
    for (const r of lista) {
      if (!(Number.isFinite(r.vence) && r.vence < ya)) continue;
      const registro = {
        t: r.t, proposito: r.proposito || 'sin_proposito', modelo: r.modelo || null, entrada: 0, salida: 0, cacheLectura: 0, cacheEscritura: 0,
        costeUsd: n0(r.costeUsd) * Math.max(1, n0(r.intentos)), ok: false, motivo: 'error', estimado: true, huerfana: true, reserva: r.id,
      };
      anadirJSONL(rutaCostes, registro);
      anadirJSONL(rutaReservas, { id: r.id, cierra: true });
      saldados.push(registro);
    }
    return saldados;
  }

  // Rehace llm-reservas.jsonl con solo las abiertas cuando crece (bajo el cerrojo).
  function compactar(lista) {
    let st;
    try { st = fs.statSync(rutaReservas); } catch (_) { return; }
    if (st.size < COMPACTAR_BYTES) return;
    const tmp = `${rutaReservas}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, lista.map(r => JSON.stringify(r) + '\n').join(''));
    fs.renameSync(tmp, rutaReservas);
  }

  // Al crear una instancia: salda las vencidas si el cerrojo está libre en
  // este momento (sin esperar: si no, ya lo hará la próxima reserva). Así un
  // latido que murió a mitad cuenta en el gasto desde el latido siguiente,
  // aunque este no llame al LLM. → los registros apuntados.
  function saldarSiSePuede() {
    try {
      fs.mkdirSync(carpeta, { recursive: true });
      fs.writeFileSync(rutaCerrojo, String(process.pid), { flag: 'wx' });
    } catch (_) {
      return [];
    }
    try {
      return saldarVencidas(abiertas());
    } catch (_) {
      return [];
    } finally {
      try { fs.unlinkSync(rutaCerrojo); } catch (_) { /* ya no está */ }
    }
  }

  // Mira el tope y, si cabe, reserva. `gastoMemoria` es lo que la instancia
  // sabe que se ha gastado hoy (por si una línea no llegó al disco): se toma lo
  // mayor. → { ok: true, id, saldados } | { ok: false, gastado, reservado, saldados }
  async function reservar({ t, costeUsd, intentos = 1, vence, proposito, modelo, presupuesto, gastoMemoria = 0 }) {
    return conCerrojo(() => {
      const saldados = saldarVencidas(abiertas());
      const vivas = abiertas();
      const gastado = Math.max(gastoDelDiaEnDisco(t), n0(gastoMemoria));
      const reservado = vivas.reduce((s, r) => s + n0(r.costeUsd), 0);
      if (gastado + reservado + costeUsd > presupuesto) return { ok: false, gastado, reservado, saldados };
      compactar(vivas);
      const id = `${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
      anadirJSONL(rutaReservas, { id, t, costeUsd, intentos, vence, proposito, modelo, pid: process.pid });
      return { ok: true, id, saldados };
    });
  }

  // Apunta el coste de verdad y cierra la reserva, las dos cosas bajo el
  // cerrojo: quien mire entre medias ve o la reserva o el coste, nunca ninguno.
  async function cerrar(id, registro) {
    return conCerrojo(() => {
      if (registro) anadirJSONL(rutaCostes, registro);
      anadirJSONL(rutaReservas, { id, cierra: true });
    });
  }

  return { reservar, cerrar, abiertas, saldarSiSePuede, rutaReservas, rutaCerrojo };
}

module.exports = { crearReservas, CERROJO_VIEJO_MS };
