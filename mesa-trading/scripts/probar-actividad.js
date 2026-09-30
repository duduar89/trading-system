'use strict';
// Caso conocido de la actividad del paso (§7 `actividad`): tres días de la
// demo sintética (semilla 42), y cada entrada se contrasta con la huella que
// deja en el estado o en disco el código que dice haber corrido en ese paso.
// Si una entrada no tiene huella, la actividad se estaría inventando trabajo.
//
//   node scripts/probar-actividad.js [--dias=3]
//
// Huellas (t = reloj del paso):
//   precios       vivo.preciosOkT === t
//   conciliacion  estado.conciliacion.t === t
//   regimen       estado.macro.ultimaHora cambió en este paso
//   nota          estado.analisis.porActivo[símbolo].t === t
//   senal         estado.puestos[puestoId].ultimaSenal.t === t
//   riesgo        'limites': cada paso; 'propuesta': un veto o aprobación de Riesgos de ese puesto en el paso
//   orden         una INTENCION de ese puesto en ordenes.jsonl con ese t (y al revés: toda orden propia sale)
//   comite        un mensaje del comité en el paso

const fs = require('fs');
const os = require('os');
const path = require('path');
const { crearConfig, leerArgs } = require('../src/config');
const { construir } = require('../src/index');
const { crearLLM } = require('../src/agentes/llm');
const { ACCIONES } = require('../src/agentes/actividad');
const { leerJSONL } = require('../src/util/almacen');
const { MIN, DIA } = require('../src/util/reloj');
const logMod = require('../src/util/log');

const PASO = 5 * MIN;
const INICIO = Date.UTC(2026, 5, 1);

async function main() {
  const args = leerArgs();
  const dias = Number(args.dias) || 3;
  logMod.fijarNivel('silencio');
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'mesa-actividad-'));
  const casos = [];
  const caso = (ok, texto) => { casos.push(ok); console.log(`${ok ? 'OK   ' : 'FALLO'} ${texto}`); };
  const sinHuella = [];
  const cuenta = Object.fromEntries(ACCIONES.map(a => [a, 0]));
  let ordenesSinEntrada = 0;
  let ordenesPropias = 0;
  try {
    const config = crearConfig({ modo: 'sintetico', datos: carpeta, semilla: '42' });
    config.inicio = INICIO;
    const llm = crearLLM({ apiKey: '', reloj: { tipo: 'simulado', ahora: () => 0 } });
    const piezas = construir(config, { llm, opciones: { comiteEnSegundoPlano: false, pausaComiteMs: 0, intervaloEstadoMs: 0 } });
    const o = piezas.orquestador;
    await o.iniciar();
    const rutaOrdenes = path.join(carpeta, 'ordenes.jsonl');
    let leidas = 0;
    const pasos = Math.round(dias * DIA / PASO);
    for (let k = 0; k < pasos; k++) {
      const horaAntes = o.estado.macro.ultimaHora;
      piezas.reloj.avanzar(PASO);
      await o.paso();
      const e = o.estado;
      const act = e.actividad;
      const t = act.t;
      const msgs = o.bus.ultimos(500).filter(m => m.t === t);
      const ordenes = leerJSONL(rutaOrdenes).slice(leidas);
      leidas += ordenes.length;
      const intenciones = ordenes.filter(r => r.estado === 'INTENCION' && !r.ajena && r.t === t);
      for (const x of act.lista) {
        cuenta[x.accion]++;
        let ok;
        switch (x.accion) {
          case 'precios': ok = o.vivo.preciosOkT === t; break;
          case 'conciliacion': ok = e.conciliacion.t === t; break;
          case 'regimen': ok = e.macro.ultimaHora !== horaAntes; break;
          case 'nota': {
            const a = o.universo.find(u => u.etiqueta === x.detalle);
            ok = Boolean(a && e.analisis.porActivo[a.simbolo] && e.analisis.porActivo[a.simbolo].t === t);
            break;
          }
          case 'senal': ok = Boolean(e.puestos[x.puestoId] && e.puestos[x.puestoId].ultimaSenal && e.puestos[x.puestoId].ultimaSenal.t === t); break;
          case 'riesgo': ok = x.detalle === 'limites' || msgs.some(m => m.de === 'riesgos' && (m.tipo === 'veto' || m.tipo === 'aprobacion') && m.datos && m.datos.puestoId === x.puestoId); break;
          case 'orden': ok = intenciones.some(r => r.puestoId === x.puestoId); break;
          case 'comite': ok = msgs.some(m => m.canal === 'comite'); break;
          default: ok = false;
        }
        if (!ok) sinHuella.push(`${new Date(t).toISOString()} ${x.agente} ${x.accion}`);
      }
      for (const r of intenciones) {
        ordenesPropias++;
        if (!act.lista.some(x => x.accion === 'orden' && x.puestoId === r.puestoId)) ordenesSinEntrada++;
      }
    }
    await o.detener();
    caso(!sinHuella.length, `${pasos} pasos: cada entrada tiene la huella de su código${sinHuella.length ? ` (${sinHuella.length} sin huella; la primera: ${sinHuella[0]})` : ''}`);
    caso(ordenesPropias > 0 && ordenesSinEntrada === 0, `las ${ordenesPropias} órdenes mandadas al bróker salen como «orden» en su paso`);
    caso(cuenta.precios === pasos && cuenta.riesgo >= pasos, `precios y vigilante en cada paso (${cuenta.precios} y ${cuenta.riesgo})`);
    caso(cuenta.regimen >= dias * 24 - 1 && cuenta.regimen <= dias * 24 + 1, `régimen una vez por hora (${cuenta.regimen} en ${dias * 24} h)`);
    caso(cuenta.comite >= dias * 6 - 1, `comité cada 4 h (${cuenta.comite})`);
    console.log(`Recuento: ${ACCIONES.map(a => `${a} ${cuenta[a]}`).join(', ')}.`);
  } finally {
    fs.rmSync(carpeta, { recursive: true, force: true });
  }
  const ok = casos.every(Boolean);
  console.log(ok ? `OK: ${casos.length} casos.` : `FALLO: ${casos.filter(x => !x).length} de ${casos.length} casos.`);
  process.exit(ok ? 0 : 1);
}

main().catch(e => { console.error(`FALLO: ${e.stack || e.message}`); process.exit(1); });
