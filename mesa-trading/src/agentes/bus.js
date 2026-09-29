'use strict';
// Bus de mensajes (§6.2): un EventEmitter dentro del proceso más un JSONL donde
// se añade cada mensaje. Lo que el panel pinta ES este registro: `datos` es lo
// que leen otros agentes (cifras del código) y `texto` es para el humano.

const { EventEmitter } = require('events');
const { anadirJSONL, leerJSONL } = require('../util/almacen');
const { RelojReal } = require('../util/reloj');
const log = require('../util/log').crear('bus');

const CANALES = Object.freeze(['parque', 'analisis', 'macro', 'riesgo', 'ejecucion', 'comite', 'megafono', 'laboratorio', 'direccion', 'sistema']);
const TIPOS = Object.freeze(['estado', 'nota', 'regimen', 'senal', 'propuesta', 'aprobacion', 'veto', 'orden', 'ejecucion', 'cierre', 'alerta',
  'comite', 'voto', 'decision', 'megafono', 'directiva', 'leccion', 'hipotesis', 'contratacion', 'despido', 'informe', 'sistema', 'descanso']);

class Bus extends EventEmitter {
  // `estricto`: un canal o tipo fuera de la lista lanza error (para pruebas).
  // Sin él, se registra como 'sistema' y se avisa: un mensaje mal etiquetado
  // no debe tumbar el latido de la mesa.
  constructor({ reloj = new RelojReal(), ruta = null, agentes = [], maxMemoria = 500, estricto = false } = {}) {
    super();
    this.reloj = reloj;
    this.ruta = ruta;
    this.maxMemoria = Math.max(1, maxMemoria | 0);
    this.estricto = estricto;
    this.agentes = new Map();
    for (const a of agentes || []) this.registrarAgente(a);
    this.memoria = [];
    this.secuencia = 0;
    // El reloj simulado puede repetir instantes entre dos demos: una marca de
    // sesión evita ids repetidos en el mismo mensajes.jsonl.
    this.sesion = Math.floor(Math.random() * 36 ** 3).toString(36).padStart(3, '0');
    // Tras un reinicio, el panel vuelve a ver la conversación reciente.
    if (ruta) {
      try {
        this.memoria = leerJSONL(ruta, this.maxMemoria);
      } catch (e) {
        log.aviso(`no se pudo leer ${ruta}: ${e.message}`);
      }
    }
    this.setMaxListeners(50);   // cada cliente SSE es un oyente
  }

  registrarAgente(agente) {
    if (!agente || !agente.id) return;
    this.agentes.set(agente.id, agente);
  }

  publicar({ de, para = 'todos', canal, tipo, texto, datos = null, importancia = 1, costeUsd = 0 } = {}) {
    const c = this._validar('canal', canal, CANALES);
    const tp = this._validar('tipo', tipo, TIPOS);
    const t = this.reloj.ahora();
    const agente = this.agentes.get(de);
    const mensaje = {
      id: `${t.toString(36)}-${this.sesion}${(++this.secuencia).toString(36)}`,
      t,
      de: de || 'sistema',
      deNombre: agente ? agente.nombre : (de && de !== 'sistema' ? String(de) : 'Sistema'),
      departamento: agente ? agente.departamento : null,
      para: para || 'todos',
      canal: c,
      tipo: tp,
      texto: texto === null || texto === undefined ? '' : String(texto),
      datos: datos === undefined ? null : datos,
      importancia: Number.isFinite(importancia) ? importancia : 1,
      costeUsd: Number.isFinite(costeUsd) && costeUsd > 0 ? costeUsd : 0,
    };
    this.memoria.push(mensaje);
    if (this.memoria.length > this.maxMemoria) this.memoria.splice(0, this.memoria.length - this.maxMemoria);
    if (this.ruta) {
      try { anadirJSONL(this.ruta, mensaje); } catch (e) { log.aviso(`no se pudo guardar el mensaje: ${e.message}`); }
    }
    this.emit('mensaje', mensaje);
    return mensaje;
  }

  // filtro: función (m) → boolean, u objeto { canal, tipo, de, para, departamento, desde }
  // donde cada campo puede ser un valor o una lista; `desde` = t estrictamente mayor.
  ultimos(n = 150, filtro) {
    let lista = this.memoria;
    if (typeof filtro === 'function') lista = lista.filter(filtro);
    else if (filtro && typeof filtro === 'object') lista = lista.filter(m => cumple(m, filtro));
    const k = Number.isFinite(n) ? Math.max(0, n | 0) : lista.length;
    return k >= lista.length ? lista.slice() : lista.slice(lista.length - k);
  }

  desde(t) { return this.ultimos(Infinity, { desde: t }); }

  _validar(campo, valor, lista) {
    if (lista.includes(valor)) return valor;
    const texto = `${campo} desconocido: ${valor}`;
    if (this.estricto) throw new Error(texto);
    log.aviso(`${texto} (se publica como 'sistema')`);
    return 'sistema';
  }
}

function cumple(m, filtro) {
  for (const campo of ['canal', 'tipo', 'de', 'para', 'departamento']) {
    const v = filtro[campo];
    if (v === undefined) continue;
    if (Array.isArray(v) ? !v.includes(m[campo]) : m[campo] !== v) return false;
  }
  if (filtro.desde !== undefined && !(m.t > filtro.desde)) return false;
  return true;
}

module.exports = { Bus, CANALES, TIPOS };
