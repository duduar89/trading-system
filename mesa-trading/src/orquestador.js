'use strict';
// Orquestador (§6.7-§6.10, §7): el latido de la mesa.
//
// En cada paso() (tiempo real: cada latido; sintético: cada 5 min simulados):
//   precios → valorar → cierre diario (si toca) → vigilante → conciliación →
//   macro y análisis (1H) → comité (cada 4 h) → pendientes de la bolsa (real y
//   sombra) → mesas con vela nueva → cadencias semanal y mensual → descansos
//   → curva → estado.json → evento 'estado'.
// El cierre diario va antes que el vigilante: al despertar el portátil tras
// las 00:05, el vigilante mide ya con la referencia del día nuevo (si no,
// perdidaDia es null en ese latido y una caída de la noche no se miraba).
//
// Reglas de la casa que se cumplen aquí:
// - La hora es siempre la del reloj (nunca Date.now() en la lógica). El único
//   tiempo real es el de PANTALLA (bocadillos, descansos mínimos, ritmo de
//   los eventos 'estado'), que se pide a opciones.ahoraPantalla.
// - paso() no se solapa: si el anterior sigue, se salta. Kill, prueba y
//   reabrir esperan a que acabe el latido en curso (no se cruzan con él).
// - Un error dentro de un departamento se captura, se publica como alerta en
//   el canal sistema y no tumba el proceso.
// - Arranque seguro (§6.10): un solo proceso por carpeta (data/.proceso) →
//   cargar (un estado.json ilegible NO arranca un fondo nuevo) → si estaba
//   bloqueado, sigue bloqueado → resolver órdenes a medias por idCliente →
//   conciliar → operar.
// - Reabrir tras un kill NO borra el máximo histórico ni el inicio real del
//   día: la cabecera y los informes siguen midiendo desde ahí. El vigilante
//   mide desde una referencia aparte (picoVigilancia, inicioDiaVigilancia) que
//   solo pone un REABRIR humano, para no volver a disparar al instante.
//
// Eventos: 'estado' (instantánea, como mucho una cada intervaloEstadoMs de
// pantalla), 'mensaje' (Mensaje del bus), 'agente' ({id, estado, sala,
// bocadillo}) y 'ejecucion'.

const { EventEmitter } = require('events');
const path = require('path');
const universoMod = require('./mercado/universo');
const calendario = require('./mercado/calendario');
const { mesasIniciales } = require('./estrategias');
const { reasignar, REGLAS: REGLAS_ASIGNADOR } = require('./aprendizaje/asignador');
const { metricasMesa, sharpeRodante } = require('./aprendizaje/evaluador');
const { crearBenchmarks, valorarBenchmarks } = require('./cartera/benchmarks');
const { exposicionConBroker } = require('./cartera/conciliacion');
const { Libros } = require('./cartera/libros');
const { DEPARTAMENTOS, crearPlantilla, puestosDeMesa } = require('./agentes/registro');
const megafono = require('./agentes/megafono');
const plantillas = require('./agentes/plantillas');
const { TARIFAS } = require('./agentes/llm');
const comite = require('./agentes/comite');
const macro = require('./agentes/departamentos/macro');
const analisis = require('./agentes/departamentos/analisis');
const riesgos = require('./agentes/departamentos/riesgos');
const operaciones = require('./agentes/departamentos/operaciones');
const mesasDep = require('./agentes/departamentos/mesas');
const laboratorio = require('./agentes/departamentos/laboratorio');
const direccion = require('./agentes/departamentos/direccion');
const { EPS, etiqueta, puestoId, puestoSombraId, agenteDePuesto } = require('./agentes/departamentos/comun');
const { leerJSON, escribirJSON, anadirJSONL, leerJSONL } = require('./util/almacen');
const { tomarBloqueo, soltarBloqueo } = require('./util/proceso');
const { inicioVela, diaUTC, MIN, HORA, DIA } = require('./util/reloj');
const f = require('./util/formato');
const log = require('./util/log').crear('orquestador');

const VERSION_ESTADO = 1;
const MAX_CURVA = 2000;
const MAX_CURVA_INSTANTANEA = 500;
const MAX_EJECUCIONES = 30;
const INACTIVIDAD_DESCANSO = 2 * HORA;
const DURACION_DESCANSO = 15 * MIN;
const MAX_EN_DESCANSO = 2;
// Casi todo el parqué está ocioso casi siempre: sin este ritmo, cada 2 h se
// irían todos en fila y el chat sería solo descansos.
const ENTRE_DESCANSOS = HORA;
const CADA_RELOJ_MERCADO = 5 * MIN;
const JEFES = comite.JEFES;
const CANAL_DE = { direccion: 'direccion', macro: 'macro', analisis: 'analisis', mesas: 'parque', riesgos: 'riesgo', operaciones: 'ejecucion', laboratorio: 'laboratorio' };
const MODELOS_DISPONIBLES = Object.keys(TARIFAS).filter(m => m !== 'claude-opus-4-8');
// Sin precios nuevos durante más de esto (fuera del sintético), la pantalla lo avisa.
const PRECIOS_VIEJOS = 3 * MIN;
// Una operación es la misma si coinciden id e instante de entrada: el id solo
// se repite en un rearranque (nOperaciones vuelve atrás con estado.json).
const claveOp = op => `${op.id}|${op.entradaT}`;

function siguienteHora(t, hh, mm) {
  const d = inicioVela(t, DIA) + hh * HORA + mm * MIN;
  return d > t ? d : d + DIA;
}

function siguienteLunes(t, hh, mm) {
  const dia0 = inicioVela(t, DIA);
  for (let k = 0; k < 8; k++) {
    const d = dia0 + k * DIA;
    const cand = d + hh * HORA + mm * MIN;
    if (new Date(d).getUTCDay() === 1 && cand > t) return cand;
  }
  return dia0 + 7 * DIA + hh * HORA + mm * MIN;
}

function siguienteMes(t) {
  const d = new Date(t);
  const esteMes = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 15);
  return esteMes > t ? esteMes : Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 15);
}

const valoracionVacia = () => ({
  porPuesto: {}, porMesa: {}, exposicionBruta: 0, exposicionCripto: 0, exposicionPorActivo: {}, posicionesAbiertas: 0, puestosAbiertos: 0, valorTotal: 0, pnlAbierto: 0,
});

class Orquestador extends EventEmitter {
  constructor({ config, reloj, datos, broker, llm, fg, bus, modo, velocidad, opciones = {} } = {}) {
    super();
    if (!config || !reloj || !datos || !broker || !bus) throw new Error('Orquestador necesita config, reloj, datos, broker y bus');
    this.config = config;
    this.limites = config.limites;
    this.carpeta = config.carpetaDatos;
    this.reloj = reloj;
    this.datos = datos;
    this.broker = broker;
    this.llm = llm || {
      activo: false, estado: () => ({ activo: false, modeloComite: null, modeloAgentes: null, gastoHoyUsd: 0, presupuestoDiaUsd: 0 }),
      gastoHoy: () => 0, gastoDelDia: () => 0, gastoEntre: () => 0,
    };
    this.fg = fg || { actual: async () => null, historico: async () => [] };
    this.bus = bus;
    this.modo = modo || config.modo;
    this.velocidad = Number(velocidad ?? config.velocidad) || 1;
    this.opciones = {
      pausaComiteMs: 0,                 // pausa real entre puntos del comité (para verlo en el panel)
      descansoMinPantallaMs: 0,         // duración mínima de un descanso en tiempo de pantalla
      intervaloEstadoMs: 2000,          // como mucho un evento 'estado' cada 2 s reales (§7)
      guardarCadaPasos: 1,              // estado.json en cada latido (§6.10)
      comiteEnSegundoPlano: true,       // el comité (con LLM tarda) no retiene el latido
      ahoraPantalla: () => Date.now(),  // SOLO para lo visual: bocadillos y descansos en pantalla
      ...opciones,
    };
    this.setMaxListeners(100);
    this.hayAlpaca = Boolean(config.alpaca && config.alpaca.hay) && this.modo !== 'sintetico';
    this.universo = universoMod.disponibles({ hayAlpaca: this.hayAlpaca }).filter(a => datos.disponible(a.simbolo));
    this.rutas = {
      estado: path.join(this.carpeta, 'estado.json'),
      operaciones: path.join(this.carpeta, 'operaciones.jsonl'),
      operacionesSombra: path.join(this.carpeta, 'operaciones-sombra.jsonl'),
      informes: path.join(this.carpeta, 'informes.jsonl'),
    };
    this.estado = null;
    this.libros = null;
    this.plantilla = [];
    this.vivo = {
      precios: {}, cuenta: null, posicionesBroker: [], valoracion: valoracionVacia(), valoracionSombra: valoracionVacia(),
      patrimonio: config.capitalInicial || 0, patrimonioSombra: config.capitalInicial || 0, mercadoAbierto: { accion: false }, relojMercado: null, relojMercadoT: null,
    };
    this.operaciones = [];
    this.operacionesSombra = [];
    this._opsVistas = new Set();
    this.registroOrdenes = [];
    this.historialPrecios = {};
    this.ultimoMensaje = {};
    this.tareas = new Set();
    this.comiteEnCurso = false;
    this.errores = [];
    this.pasos = 0;
    this.saltados = 0;
    this.iniciado = false;
    this._cadena = Promise.resolve();
    this._ocupado = false;
    this._ultimoEstado = -Infinity;
    this._estadoProgramado = null;
    this._erroresVistos = {};
    this._killPedido = false;
    this._bloqueoTomado = false;
    this._deteniendo = false;
    this._pausas = new Set();
  }

  // ---------- Arranque ----------

  // Crítico: un estado.json que existe pero no se puede leer (bloqueado por
  // otro programa, a ceros tras un corte de luz) no se aparta ni se sustituye
  // por un fondo nuevo: se niega a arrancar (lanza con un mensaje claro).
  static leerEstadoGuardado(carpeta) {
    return leerJSON(path.join(carpeta, 'estado.json'), null, { critico: true });
  }

  async iniciar() {
    // Un solo proceso por carpeta de datos, antes de tocar nada.
    tomarBloqueo(this.carpeta);
    this._bloqueoTomado = true;
    try {
      return await this._iniciar();
    } catch (e) {
      soltarBloqueo(this.carpeta);
      this._bloqueoTomado = false;
      throw e;
    }
  }

  async _iniciar() {
    const guardado = leerJSON(this.rutas.estado, null, { critico: true });
    // Un estado de la demo sintética no vale para el papel (ni al revés): sus
    // posiciones y su curva son de otros precios.
    if (guardado && guardado.modo && guardado.modo !== this.modo) {
      throw new Error(`${this.rutas.estado} es de modo ${guardado.modo} y se arranca en modo ${this.modo}: usa otra carpeta con --datos= o apártalo.`);
    }
    await this._actualizarPrecios(this.reloj.ahora());
    if (guardado && guardado.version === VERSION_ESTADO) {
      this.libros = new Libros(guardado.libros);
      delete guardado.libros;
      this.estado = this._completar(guardado);
    } else {
      this.libros = new Libros();
      this.estado = await this._estadoInicial();
    }
    this._aplicarAjustes();
    this.plantilla = crearPlantilla({ universo: this.universo, mesas: this.estado.mesas });
    for (const a of this.plantilla) this.bus.registrarAgente(a);
    this.bus.registrarAgente({ id: 'humano', nombre: 'Tú (megáfono)', departamento: null });
    this.bus.registrarAgente({ id: 'sistema', nombre: 'Sistema', departamento: null });
    for (const m of this.estado.mesas) this._asegurarPuestos(m);
    this.operaciones = leerJSONL(this.rutas.operaciones);
    this.operacionesSombra = leerJSONL(this.rutas.operacionesSombra);
    // Antes de resolverAlArrancar: una venta que se reaplica tras un corte ya
    // está en operaciones.jsonl y no se vuelve a apuntar.
    this._opsVistas = new Set([...this.operaciones, ...this.operacionesSombra].map(claveOp));
    const ahora = this.reloj.ahora();
    for (const a of this.plantilla) {
      const v = this.estado.agentes[a.id] || (this.estado.agentes[a.id] = {});
      if (v.ultimaActividad === undefined) v.ultimaActividad = ahora;
    }
    this._semillarHistorial(ahora);
    this._oyente = m => this._alMensaje(m);
    this.bus.on('mensaje', this._oyente);
    this.ejecutor = new operaciones.Ejecutor(this);

    // Arranque seguro: bloqueado sigue bloqueado; órdenes a medias; conciliar; operar.
    const bloqueado = this.estado.fondo.nivel === 'bloqueado';
    await this.refrescarCartera();
    await this._seguro('órdenes a medias', 'ejecutor', () => this.ejecutor.resolverAlArrancar());
    await this.refrescarCartera();
    await this._seguro('conciliación', 'controller', () => operaciones.conciliarCadaLatido(this));
    for (const h of this.estado.laboratorio.hipotesis) if (h.estado === 'evaluando') h.estado = 'pendiente';
    this.bus.publicar({
      de: 'sistema', canal: 'sistema', tipo: 'sistema',
      texto: plantillas.frase(`Mesa en marcha: modo ${this.modo}, bróker ${this.broker.nombre}, patrimonio ${f.usd(this.vivo.patrimonio)}, ${this.estado.mesas.length} mesas, LLM ${this.llm.activo ? 'activo' : 'apagado'}.`),
      datos: { modo: this.modo, broker: this.broker.nombre, nivel: this.estado.fondo.nivel },
    });
    if (bloqueado) {
      this.bus.publicar({ de: 'riesgos', canal: 'riesgo', tipo: 'alerta', texto: 'Arranco con el fondo BLOQUEADO: sigue bloqueado hasta que un humano pulse Reabrir.', importancia: 3 });
      for (const a of this.plantilla) this.moverAgente(a.id, null, 'de_pie');
    }
    this.lanzar('backtests de referencia', () => laboratorio.backtestsPendientes(this));
    if (this.estado.laboratorio.hipotesis.some(h => h.estado === 'pendiente')) this.lanzar('laboratorio', () => laboratorio.evaluarPendientes(this));
    this.iniciado = true;
    this.guardar();
    return this;
  }

  _completar(e) {
    // Campos nuevos con valor aunque el estado sea de una versión anterior.
    const base = {
      ultimaVela: {}, comprobadoMesa: {}, curva: [], curvaDiaria: [], lecciones: [], agentes: {}, puestos: {}, inicioDiaPuestos: {},
      pendientes: [], ordenesEnVuelo: {}, ejecuciones: [], megafonoPendiente: null, riesgo: { alertasVistas: {} }, ajustes: {},
      ultimoCierreT: null, picoVigilancia: null, inicioDiaVigilancia: null, diaInicioVigilancia: null, comisionesEstimadas: {},
      macro: { regimen: null, fg: null, ultimaHora: null, ultimoMensaje: null },
      analisis: { ultimaHora: null, porActivo: {} },
      noticias: { ultima: null, vistos: [], eventosGraves: [] },
      comite: { celebrados: 0, ultimo: null, historial: [], pnlMesas: {} },
      contadores: { vetos: 0, vetosDesdeComite: 0, mensajesPorCanal: {}, contrataciones: 0, kills: 0, reaperturas: 0 },
      conciliacion: { limpia: true, grave: false, resumen: '', gravesSeguidas: 0, clave: null, t: null },
    };
    const e2 = { ...base, ...e };
    for (const k of ['macro', 'analisis', 'noticias', 'comite', 'contadores', 'conciliacion']) e2[k] = { ...base[k], ...(e[k] || {}) };
    if (e2.sombra && !Array.isArray(e2.sombra.pendientes)) e2.sombra.pendientes = [];
    if (e2.fondo && e2.fondo.killReintento === undefined) e2.fondo.killReintento = null;
    e2.laboratorio = { ensayosTotales: 0, sharpesEnsayos: [], ensayos: [], hipotesis: [], aprobadas: [], proximaRevision: null, ...(e.laboratorio || {}) };
    for (const m of e2.mesas) {
      if (!Array.isArray(m.curvaDiaria)) m.curvaDiaria = [];
      if (!Number.isFinite(m.capitalBase)) m.capitalBase = (e2.capitalInicial || 0) * (m.peso || 0);
    }
    return e2;
  }

  async _estadoInicial() {
    const ahora = this.reloj.ahora();
    const cuenta = await this.broker.cuenta();
    const capital = cuenta.patrimonio;
    const disponibles = new Set(this.universo.map(a => a.simbolo));
    const mesas = mesasIniciales({ hayAlpaca: this.hayAlpaca })
      .map(m => ({ ...m, universo: m.universo.filter(s => disponibles.has(s)) }))
      .filter(m => m.universo.length);
    // Pesos iniciales con el asignador (§5.7): incubación 2 % fija y titulares
    // por paridad de riesgo dentro de suelo 5 % y techo 40 %.
    const r = reasignar({ mesas: mesas.map(m => ({ id: m.id, estado: m.estado, pesoActual: null, volHistorica: null, metricas: {}, diasActiva: 0, sharpeBacktest: null })), ahora });
    for (const m of mesas) {
      m.peso = r.pesos[m.id] || 0;
      m.fechaAlta = ahora;
      m.capitalBase = capital * m.peso;
      m.flujoPendiente = 0;
      m.curvaDiaria = [];
      m.metricas = null;
      m.backtest = null;
    }
    const benchmarks = crearBenchmarks({ capital, preciosIniciales: this.vivo.precios, hayAlpaca: this.hayAlpaca, t: ahora, penalizacion: this.limites.penalizacionPapel });
    const comiteMs = this.config.cadencias.comiteHoras * HORA;
    const e = this._completar({
      version: VERSION_ESTADO,
      creado: ahora,
      capitalInicial: capital,
      modo: this.modo,
      mesas,
      directivas: { ...megafono.directivasVacias(), multiplicadores: Object.fromEntries(mesas.map(m => [m.id, 1])) },
      fondo: { nivel: 'normal', motivo: null, multiplicadorCaida: 1, soloCerrarHasta: null },
      patrimonioInicioDia: capital,
      diaInicio: diaUTC(ahora),
      pico: capital,
      curva: [{ t: ahora, patrimonio: capital }],
      sombras: { benchmarks, curvas: {} },
      sombra: { efectivo: capital, pendientes: [] },
      cadencias: {
        proximoComite: inicioVela(ahora, comiteMs) + comiteMs,
        proximoDiario: siguienteHora(ahora, 0, 5),
        proximoSemanal: siguienteLunes(ahora, 0, 10),
        proximoMensual: siguienteMes(ahora),
      },
      laboratorio: { ensayosTotales: 0, sharpesEnsayos: [], ensayos: [], hipotesis: [], aprobadas: [], proximaRevision: siguienteLunes(ahora, 0, 10) },
      sintetico: this.modo === 'sintetico' ? { semilla: this.datos.semilla ?? null, inicio: this.datos.inicio ?? null } : null,
    });
    return e;
  }

  _aplicarAjustes() {
    const a = this.estado.ajustes || {};
    try {
      if (a.presupuestoDiaUsd !== undefined && this.llm.fijarPresupuesto) this.llm.fijarPresupuesto(a.presupuestoDiaUsd);
      if ((a.modeloComite || a.modeloAgentes) && this.llm.fijarModelos) this.llm.fijarModelos({ modeloComite: a.modeloComite, modeloAgentes: a.modeloAgentes });
      if (a.velocidad && this.modo === 'sintetico' && this.opciones.respetarVelocidadGuardada) this.velocidad = a.velocidad;
    } catch (e) { log.aviso(`ajustes guardados no aplicables: ${e.message}`); }
  }

  _asegurarPuestos(mesa) {
    for (const s of mesa.universo) {
      this.libros.asegurarPuesto({ puestoId: puestoId(mesa.id, s), mesaId: mesa.id, simbolo: s, sombra: false });
      this.libros.asegurarPuesto({ puestoId: puestoSombraId(mesa.id, s), mesaId: mesa.id, simbolo: s, sombra: true });
    }
  }

  // Mesa nueva (contratación): puestos, operadores que llegan al parqué y
  // multiplicador 1 hasta el próximo comité.
  agregarMesa(mesa) {
    this.estado.mesas.push(mesa);
    this.estado.directivas.multiplicadores = { ...(this.estado.directivas.multiplicadores || {}), [mesa.id]: 1 };
    this._asegurarPuestos(mesa);
    const nuevos = puestosDeMesa(mesa, { plantilla: this.plantilla });
    const ahora = this.reloj.ahora();
    for (const a of nuevos) {
      this.plantilla.push(a);
      this.bus.registrarAgente(a);
      this.estado.agentes[a.id] = { ultimaActividad: ahora };
      this.moverAgente(a.id, 'parque', 'trabajando', { forzar: true });
    }
    return nuevos;
  }

  _semillarHistorial(ahora) {
    // var24h de las cotizaciones: muestras horarias; al arrancar se siembran
    // con las velas de 1H de las últimas 26 h (en segundo plano, no bloquea).
    this.lanzar('historial de precios', async () => {
      for (const a of this.universo) {
        const v = await this.datos.velas(a.simbolo, '1Hour', { desde: ahora - 26 * HORA, hasta: ahora });
        const previas = this.historialPrecios[a.simbolo] || [];
        this.historialPrecios[a.simbolo] = [...v.map(x => ({ t: x.t + HORA, precio: x.c })), ...previas].sort((x, y) => x.t - y.t).slice(-30);
      }
    });
  }

  // ---------- Utilidades para los departamentos ----------

  mesaPorId(id) { return this.estado.mesas.find(m => m.id === id) || null; }
  agentePorId(id) { return this.plantilla.find(a => a.id === id) || null; }

  _casa(a) {
    const d = DEPARTAMENTOS.find(x => x.id === a.departamento);
    return d ? d.sala : 'parque';
  }

  _factorPantalla() { return this.modo === 'sintetico' ? Math.max(1, this.velocidad) : 1; }

  // Bocadillo = último mensaje del agente, visible 6 s + 60 ms por carácter
  // (máx. 12 s) de PANTALLA. En sintético el reloj corre `velocidad` veces más
  // rápido, así que se estira en tiempo simulado para que dure lo mismo a la vista.
  _bocadillo(id, ahora = this.reloj.ahora()) {
    const m = this.ultimoMensaje[id];
    if (!m) return null;
    const hasta = m.t + Math.min(12_000, 6_000 + 60 * m.texto.length) * this._factorPantalla();
    return hasta > ahora ? { texto: m.texto, hasta } : null;
  }

  moverAgente(id, sala, estado, { forzar = false } = {}) {
    const a = this.agentePorId(id);
    if (!a) return;
    const v = this.estado.agentes[id] || (this.estado.agentes[id] = {});
    const salaFinal = sala || this._casa(a);
    if (!forzar && v.sala === salaFinal && v.estado === estado) return;
    v.sala = salaFinal;
    v.estado = estado;
    if (estado !== 'descanso') { v.descansoHasta = null; v.descansoHastaPantalla = null; }
    this.emit('agente', { id, estado, sala: salaFinal, bocadillo: this._bocadillo(id) });
  }

  _alMensaje(m) {
    const c = this.estado.contadores.mensajesPorCanal;
    c[m.canal] = (c[m.canal] || 0) + 1;
    const a = this.agentePorId(m.de);
    if (a) {
      const v = this.estado.agentes[m.de] || (this.estado.agentes[m.de] = {});
      v.ultimaActividad = m.t;
      this.ultimoMensaje[m.de] = { texto: m.texto, t: m.t };
      // Quien tiene que hablar vuelve del descanso a su sitio.
      if (v.estado === 'descanso' && m.tipo !== 'descanso') this.moverAgente(m.de, null, 'trabajando');
    }
    this.emit('mensaje', m);
  }

  lanzar(nombre, fn) {
    const p = (async () => {
      try { return await fn(); } catch (e) { this._error(nombre, 'sistema', e); return null; }
    })();
    this.tareas.add(p);
    p.finally(() => this.tareas.delete(p));
    return p;
  }

  async esperarTareas() {
    while (this.tareas.size) await Promise.allSettled([...this.tareas]);
  }

  _error(nombre, agente, e) {
    const texto = `Error en ${nombre}: ${e && e.message ? e.message : String(e)}`;
    this.errores.push({ t: this.reloj.ahora(), nombre, mensaje: texto });
    if (this.errores.length > 200) this.errores.shift();
    log.error(texto, e && e.stack ? `\n${e.stack.split('\n').slice(1, 4).join('\n')}` : '');
    const ahora = this.reloj.ahora();
    if (this._erroresVistos[texto] !== undefined && ahora - this._erroresVistos[texto] < HORA) return;
    this._erroresVistos[texto] = ahora;
    try {
      this.bus.publicar({ de: this.agentePorId(agente) ? agente : 'sistema', canal: 'sistema', tipo: 'alerta', texto: plantillas.frase(texto, 280), datos: { departamento: nombre }, importancia: 3 });
    } catch (_) { /* el bus no debe tumbar el latido */ }
  }

  async _seguro(nombre, agente, fn) {
    try { return await fn(); } catch (e) { this._error(nombre, agente, e); return null; }
  }

  // Serializa lo que toca el bróker: un latido, un kill, una prueba, un reabrir.
  _exclusivo(fn) {
    const p = this._cadena.then(async () => {
      this._ocupado = true;
      try { return await fn(); } finally { this._ocupado = false; }
    });
    this._cadena = p.catch(() => {});
    return p;
  }

  // ---------- Cartera ----------

  async _actualizarPrecios(ahora) {
    const simbolos = new Set(this.universo.map(a => a.simbolo));
    if (this.libros) for (const p of this.libros.listaPuestos()) if (p.cantidad > EPS) simbolos.add(p.simbolo);
    const r = await this.datos.ultimos([...simbolos]);
    let alguno = false;
    for (const [s, q] of Object.entries(r || {})) if (q && q.precio > 0) { this.vivo.precios[s] = { precio: q.precio, t: q.t }; alguno = true; }
    // Última petición de precios que trajo algo (no la t de la cotización:
    // con la red bien, DOGE ya llega con minutos de retraso).
    if (alguno) this.vivo.preciosOkT = ahora;
    // Bolsa: con Alpaca manda su reloj (cada 5 min); si no, el calendario.
    if (this.hayAlpaca && typeof this.broker.relojMercado === 'function' && this.broker.nombre === 'alpaca-paper') {
      if (this.vivo.relojMercadoT === null || ahora - this.vivo.relojMercadoT >= CADA_RELOJ_MERCADO) {
        try { this.vivo.relojMercado = await this.broker.relojMercado(); this.vivo.relojMercadoT = ahora; } catch (e) { this.vivo.relojMercado = calendario.relojMercado(ahora); }
      }
      const rm = this.vivo.relojMercado || calendario.relojMercado(ahora);
      this.vivo.mercadoAbierto = { accion: Boolean(rm.abierto) && (!rm.proximoCierre || ahora < rm.proximoCierre) };
    } else {
      this.vivo.relojMercado = calendario.relojMercado(ahora);
      this.vivo.mercadoAbierto = { accion: this.vivo.relojMercado.abierto };
    }
    // Historial para var24h, con el instante del DATO (q.t), no el del latido:
    // un precio congelado (red o datos caídos) no suma muestras nuevas y su
    // var24h no se mueve sola con el paso del tiempo.
    for (const [s, q] of Object.entries(this.vivo.precios)) {
      const h = this.historialPrecios[s] || (this.historialPrecios[s] = []);
      const tq = Number.isFinite(q.t) ? q.t : ahora;
      if (!h.length || tq - h[h.length - 1].t >= HORA) {
        h.push({ t: tq, precio: q.precio });
        if (h.length > 30) h.shift();
      }
    }
  }

  revalorarSombra() {
    this.vivo.valoracionSombra = this.libros.valorar(this.vivo.precios, { sombra: true });
    this.vivo.patrimonioSombra = this.estado.sombra.efectivo + this.vivo.valoracionSombra.valorTotal;
    const s = this.estado.sombra;
    if (!(s.pico >= this.vivo.patrimonioSombra)) s.pico = this.vivo.patrimonioSombra;
  }

  // Único sitio que escribe vivo.valoracion. La exposición (por activo,
  // cripto, bruta y nº de posiciones) es la de los libros con, por símbolo, el
  // máximo frente al bróker: una posición del bróker sin puesto (huérfana)
  // cuenta para los topes de Riesgos, para el comité y para la cabecera.
  async refrescarCartera() {
    const cuenta = await this.broker.cuenta();
    const posiciones = await this.broker.posiciones();
    this.vivo.cuenta = cuenta;
    this.vivo.posicionesBroker = posiciones;
    this.vivo.patrimonio = cuenta.patrimonio;
    this.vivo.valoracion = exposicionConBroker(this.libros.valorar(this.vivo.precios, { sombra: false }), posiciones);
    this.vivo.carteraOkT = this.reloj.ahora();
    this.vivo.carteraOkPaso = this.pasos;
    this.revalorarSombra();
    if (this.estado && cuenta.patrimonio > (this.estado.pico || 0)) this.estado.pico = cuenta.patrimonio;
  }

  // Valoración con lo que ya se sabe (sin pedir nada al bróker): tras una
  // ejecución dentro del mismo latido, para que la siguiente propuesta del
  // lote se evalúe contra los libros ya actualizados.
  revalorarReal() {
    this.vivo.valoracion = exposicionConBroker(this.libros.valorar(this.vivo.precios, { sombra: false }), this.vivo.posicionesBroker);
  }

  registrarEjecucion(ej) {
    const lista = this.estado.ejecuciones;
    lista.unshift(ej);
    if (lista.length > MAX_EJECUCIONES) lista.length = MAX_EJECUCIONES;
    this.emit('ejecucion', ej);
  }

  registrarOperacion(op) {
    // Tras un corte entre una venta y el guardado de estado.json, al arrancar
    // la venta se vuelve a aplicar a los libros (bien), pero ya está en el
    // .jsonl: no se apunta dos veces (duplicaría métricas, tarjeta e informes).
    const k = claveOp(op);
    if (this._opsVistas.has(k)) { log.aviso(`operación ${op.id} ya apuntada; no se repite`); return; }
    this._opsVistas.add(k);
    if (op.sombra) {
      this.operacionesSombra.push(op);
      try { anadirJSONL(this.rutas.operacionesSombra, op); } catch (e) { log.aviso(e.message); }
      return;
    }
    this.operaciones.push(op);
    try { anadirJSONL(this.rutas.operaciones, op); } catch (e) { log.aviso(e.message); }
    const mesa = this.mesaPorId(op.mesaId);
    const de = mesa ? agenteDePuesto(op.mesaId, op.simbolo) : 'ejecutor';
    const texto = plantillas.cierre({ etiqueta: etiqueta(op.simbolo), pnl: op.pnl, pnlPct: op.pnlPct, motivoSalida: op.motivoSalida, barras: op.barras, rMultiple: op.rMultiple });
    this.bus.publicar({
      de, canal: mesa ? 'parque' : 'ejecucion', tipo: 'cierre', texto,
      datos: { puestoId: op.puestoId, operacionId: op.id, pnl: op.pnl, pnlPct: op.pnlPct, motivoSalida: op.motivoSalida, barras: op.barras },
      importancia: 2,
    });
    // La tarjeta dice lo último que pasó, no el «Largo en…» de la última vela.
    const aux = this.estado.puestos[op.puestoId];
    if (aux) aux.estadoTexto = texto;
  }

  async killSwitch(motivo) {
    this.estado.contadores.kills = (this.estado.contadores.kills || 0) + 1;
    try {
      return await operaciones.killSwitch(this, motivo);
    } finally {
      // El bloqueo queda en disco aunque el kill lance a mitad.
      this._seguroSinc('guardar', () => this.guardar());
      this._emitirEstado({ forzar: true });
    }
  }

  // ---------- Latido ----------

  async paso() {
    if (!this.iniciado) throw new Error('Orquestador: llama antes a iniciar()');
    if (this._ocupado) { this.saltados++; return false; }
    return this._exclusivo(() => this._paso());
  }

  async _paso() {
    const ahora = this.reloj.ahora();
    this.pasos++;
    await this._seguro('precios', 'controller', () => this._actualizarPrecios(ahora));
    await this._seguro('valoración', 'controller', () => this.refrescarCartera());
    await this._cadenciaDiaria(ahora);
    await this._seguro('vigilante', 'riesgos', () => this._vigilar(ahora));
    if (Object.keys(this.estado.ordenesEnVuelo).length) await this._seguro('órdenes en vuelo', 'ejecutor', () => this.ejecutor.resolverEnVuelo());
    await this._seguro('conciliación', 'controller', () => operaciones.conciliarCadaLatido(this));
    await this._seguro('macro', 'macro', () => macro.actualizar(this));
    await this._seguro('análisis', 'analisis', () => analisis.notas(this));
    if (analisis.hayNoticias(this)) this.lanzar('noticias', () => analisis.noticias(this));
    await this._cadenciaComite(ahora);
    await this._seguro('pendientes de la bolsa', 'ejecutor', () => this.ejecutor.procesarPendientes(o => this._reevaluarPendiente(o)));
    this._seguroSinc('pendientes de la bolsa (sombra)', () => mesasDep.procesarPendientesSombra(this));
    await this._seguro('mesas', 'mesas', () => mesasDep.procesar(this));
    await this._cadenciasLargas(ahora);
    this._seguroSinc('descansos', () => this._descansos(ahora));
    this._muestraCurva(ahora);
    if (this.pasos % Math.max(1, this.opciones.guardarCadaPasos) === 0) this._seguroSinc('guardar', () => this.guardar());
    this._emitirEstado();
    return true;
  }

  _seguroSinc(nombre, fn) {
    try { return fn(); } catch (e) { this._error(nombre, 'sistema', e); return null; }
  }

  async _vigilar(ahora) {
    const r = riesgos.vigilarFondo(this);
    for (const a of r.acciones) {
      if (a.tipo === 'kill') {
        await this.killSwitch(a.motivo);
        return r;
      }
    }
    if (r.nivel === 'bloqueado') {
      await this._reintentarKill(ahora);
      return r;
    }
    for (const a of r.acciones) {
      if (a.tipo !== 'stop') continue;
      if (a.sombra) { mesasDep.cerrarSombra(this, { puestoId: a.puestoId, motivo: 'stop' }); continue; }
      const p = this.libros.puesto(a.puestoId);
      if (!p || !(p.cantidad > EPS)) continue;
      if (this.estado.pendientes.some(o => o.puestoId === a.puestoId && o.lado === 'venta')) continue;   // ya espera a la apertura
      await mesasDep.proponerCierre(this, { mesaId: p.mesaId, simbolo: p.simbolo, tipo: 'stop', motivo: 'stop', accion: 'stop', velaT: inicioVela(ahora, 5 * MIN) });
    }
    return r;
  }

  // Con el fondo bloqueado, si el bróker aún tiene algo (el kill no pudo
  // venderlo: red caída, una venta rechazada o a medias), se vuelve a intentar
  // con esperas crecientes. Solo con la cartera leída en ESTE latido y sin
  // órdenes en vuelo. Sirve también al arrancar bloqueado.
  async _reintentarKill(ahora) {
    const fo = this.estado.fondo;
    if (this._killPedido || this.vivo.carteraOkPaso !== this.pasos || Object.keys(this.estado.ordenesEnVuelo).length) return null;
    const quedan = operaciones.quedanEnBroker(this);
    if (!quedan.length) {
      if (fo.killReintento) {
        fo.killReintento = null;
        this.bus.publicar({ de: 'riesgos', canal: 'riesgo', tipo: 'nota', texto: 'Tras el kill el bróker ya no tiene nada que vender.' });
      }
      return null;
    }
    if (fo.killReintento && ahora < fo.killReintento.proximo) return null;
    return operaciones.reintentarKill(this);
  }

  // Una orden de acciones que esperaba a la bolsa vuelve a pasar por Riesgos
  // con el precio de ahora (el desvío frente a la decisión la puede vetar).
  // Es el único punto por el que pasa una pendiente (procesarPendientes).
  async _reevaluarPendiente(o) {
    // El kill vende TODO lo del bróker (el Ejecutor lo recorta al disponible) y
    // lo reparte entre los puestos del símbolo que sigan abiertos; no depende
    // de tener precio. Con la cantidad de un solo puesto quedaría la otra mitad.
    if (o.lado === 'venta' && o.tipo === 'kill') {
      const reparto = this.libros.listaPuestos({ sombra: false })
        .filter(p => p.simbolo === o.simbolo && p.cantidad > EPS)
        .map(p => ({ puestoId: p.puestoId, cantidad: p.cantidad }));
      return { ...o, puestoId: reparto.length ? reparto[0].puestoId : o.puestoId, reparto };
    }
    const q = this.vivo.precios[o.simbolo];
    if (!q) return null;
    const p = this.libros.puesto(o.puestoId);
    if (o.lado === 'venta') {
      if (!p || !(p.cantidad > EPS)) return null;
      return { ...o, cantidad: p.cantidad, cantidadPuesto: p.cantidad };
    }
    // Las mesas solo encolan aperturas con el puesto vacío: si ya tiene
    // posición, esta compra ya se hizo (se envió antes de un corte y el
    // estado.json guardado aún la tenía en la cola). No se repite.
    if (p && p.cantidad > EPS) return null;
    // Se vuelve a dimensionar con el capital de ahora (comités de la noche,
    // banquillo) y se evalúa contra los libros con lo ya ejecutado en este lote.
    const nocional = mesasDep.redimensionarPendiente(this, o, q.precio);
    if (nocional === null) {
      this.bus.publicar({
        de: 'ejecutor', canal: 'ejecucion', tipo: 'nota',
        texto: plantillas.frase(`La mesa ${(this.mesaPorId(o.mesaId) || {}).nombre || o.mesaId} ya no opera (banquillo): se descarta la compra de ${etiqueta(o.simbolo)} que esperaba a la apertura.`),
        datos: { puestoId: o.puestoId, simbolo: o.simbolo },
      });
      return null;
    }
    this.revalorarReal();
    const propuesta = {
      puestoId: o.puestoId, mesaId: o.mesaId, simbolo: o.simbolo, clase: 'accion', lado: 'compra', tipo: 'apertura',
      nocional, precio: q.precio, precioT: q.t, stop: o.stop, precioDecision: o.precioReferencia,
    };
    const r = riesgos.evaluar(this, propuesta);
    return r.decision === 'vetar' ? null : { ...o, nocional: r.nocional };
  }

  async _cadenciaComite(ahora) {
    const c = this.estado.cadencias;
    if (ahora < c.proximoComite) return;
    const ms = this.config.cadencias.comiteHoras * HORA;
    c.proximoComite = inicioVela(ahora, ms) + ms;
    const celebrar = () => comite.celebrar(this, { motivo: 'programado' });
    if (this.opciones.comiteEnSegundoPlano) this.lanzar('comité', celebrar);
    else await this._seguro('comité', 'cio', celebrar);
  }

  async _cadenciaDiaria(ahora) {
    const c = this.estado.cadencias;
    if (ahora < c.proximoDiario) return;
    c.proximoDiario = siguienteHora(ahora, 0, 5);
    const ops = await this._seguro('cierre diario', 'controller', () => operaciones.cierreDiario(this));
    if (ops && ops.length) {
      const auditar = () => laboratorio.auditoria(this, ops);
      if (this.llm.activo) this.lanzar('auditor', auditar); else await this._seguro('auditor', 'auditor', auditar);
    }
  }

  async _cadenciasLargas(ahora) {
    const c = this.estado.cadencias;
    if (ahora >= c.proximoSemanal) {
      c.proximoSemanal = siguienteLunes(ahora, 0, 10);
      await this._seguro('informe semanal', 'controller', () => operaciones.informeSemanal(this));
      await this._seguro('laboratorio', 'laboratorio', () => laboratorio.revisionSemanal(this));
    }
    if (ahora >= c.proximoMensual) {
      c.proximoMensual = siguienteMes(ahora);
      await this._seguro('revisión mensual', 'cio', () => direccion.revisionMensual(this));
    }
  }

  // Un agente sin trabajo 2 h (simuladas) va 15 min a la sala de descanso.
  // Nunca durante un comité ni con el fondo en alerta; como mucho dos a la vez.
  _descansos(ahora) {
    const pantalla = this.opciones.ahoraPantalla();
    const e = this.estado;
    for (const a of this.plantilla) {
      const v = e.agentes[a.id];
      if (!v || v.estado !== 'descanso') continue;
      if (ahora >= (v.descansoHasta || 0) && pantalla >= (v.descansoHastaPantalla || 0)) {
        v.ultimaActividad = ahora;
        this.moverAgente(a.id, null, 'trabajando');
      }
    }
    if (this.comiteEnCurso || e.fondo.nivel !== 'normal') return;
    if (e.ultimoDescanso !== undefined && e.ultimoDescanso !== null && ahora - e.ultimoDescanso < ENTRE_DESCANSOS) return;
    const enDescanso = this.plantilla.filter(a => e.agentes[a.id] && e.agentes[a.id].estado === 'descanso').length;
    if (enDescanso >= MAX_EN_DESCANSO) return;
    const candidatos = this.plantilla
      .filter(a => {
        const v = e.agentes[a.id] || {};
        const estado = v.estado || 'trabajando';
        if (estado !== 'trabajando' || (v.sala && v.sala !== this._casa(a))) return false;
        if (a.mesaId) {
          const m = this.mesaPorId(a.mesaId);
          if (!m || m.estado === 'banquillo') return false;
        }
        return ahora - (v.ultimaActividad ?? ahora) >= INACTIVIDAD_DESCANSO;
      })
      .sort((x, y) => (e.agentes[x.id].ultimaActividad ?? 0) - (e.agentes[y.id].ultimaActividad ?? 0) || (x.id < y.id ? -1 : 1));
    for (const a of candidatos) {
      this.bus.publicar({ de: a.id, canal: CANAL_DE[a.departamento] || 'sistema', tipo: 'descanso', texto: plantillas.descanso({ minutos: DURACION_DESCANSO / MIN }), datos: { minutos: DURACION_DESCANSO / MIN } });
      const v = e.agentes[a.id];
      this.moverAgente(a.id, 'descanso', 'descanso');
      v.descansoHasta = ahora + DURACION_DESCANSO;
      v.descansoHastaPantalla = pantalla + (this.opciones.descansoMinPantallaMs || 0);
      e.ultimoDescanso = ahora;
      break;
    }
  }

  _muestraCurva(ahora) {
    const c = this.estado.curva;
    const ultimo = c[c.length - 1];
    if (!ultimo || inicioVela(ultimo.t, HORA) < inicioVela(ahora, HORA)) {
      c.push({ t: ahora, patrimonio: this.vivo.patrimonio });
      if (c.length > MAX_CURVA) c.splice(0, c.length - MAX_CURVA);
    }
  }

  guardar() {
    if (!this.estado || !this.libros) return;
    const ahora = this.reloj.ahora();
    this.estado.guardado = ahora;
    this.estado.ahora = ahora;
    escribirJSON(this.rutas.estado, { ...this.estado, libros: this.libros.serializar() }, { durable: true });
  }

  // Pausa de PANTALLA (entre puntos del comité, para verlo en el panel).
  // detener() las corta todas: un Ctrl+C no espera al orden del día.
  pausaPantalla(ms) {
    if (!(ms > 0) || this._deteniendo) return Promise.resolve();
    return new Promise(resolver => {
      const fin = () => { clearTimeout(t); this._pausas.delete(fin); resolver(); };
      const t = setTimeout(fin, ms);
      this._pausas.add(fin);
    });
  }

  async detener() {
    this._deteniendo = true;
    for (const fin of [...this._pausas]) fin();
    try {
      await this._cadena;
      await this.esperarTareas();
      this.guardar();
    } finally {
      if (this._oyente) this.bus.off('mensaje', this._oyente);
      if (this._estadoProgramado) clearTimeout(this._estadoProgramado);
      if (this._bloqueoTomado) { soltarBloqueo(this.carpeta); this._bloqueoTomado = false; }
    }
  }

  // ---------- Estado para la interfaz ----------

  _emitirEstado({ forzar = false } = {}) {
    if (!this.listenerCount('estado')) return;
    const pantalla = this.opciones.ahoraPantalla();
    const espera = this._ultimoEstado + this.opciones.intervaloEstadoMs - pantalla;
    if (espera <= 0) {
      this._ultimoEstado = pantalla;
      this.emit('estado', this.instantanea());
      return;
    }
    // Dentro de la ventana: una sola emisión diferida para no perder el último cambio.
    if (forzar && !this._estadoProgramado) {
      this._estadoProgramado = setTimeout(() => {
        this._estadoProgramado = null;
        this._ultimoEstado = this.opciones.ahoraPantalla();
        this.emit('estado', this.instantanea());
      }, espera);
      if (this._estadoProgramado.unref) this._estadoProgramado.unref();
    }
  }

  // Variación en 24 h medida desde el instante del dato (tDato = q.t).
  _var24h(simbolo, precio, tDato) {
    const h = this.historialPrecios[simbolo] || [];
    let ref = null;
    for (const x of h) if (x.t <= tDato - 24 * HORA + 30 * MIN) ref = x;
    return ref && ref.precio > 0 ? precio / ref.precio - 1 : null;
  }

  _statsPuesto(ops) {
    const n = ops.length;
    let ganado = 0; let perdido = 0; let ganadoras = 0; let regla = 0;
    for (const o of ops) {
      if (o.pnl > 0) { ganadoras++; ganado += o.pnl; } else if (o.pnl < 0) perdido += -o.pnl;
      if (o.motivoSalida === 'señal' || o.motivoSalida === 'stop') regla++;
    }
    return { operaciones: n, acierto: n ? ganadoras / n : null, factorBeneficio: perdido > 0 ? ganado / perdido : null, adherencia: n ? regla / n : null };
  }

  instantanea() {
    const e = this.estado;
    const v = this.vivo;
    const ahora = this.reloj.ahora();
    const patrimonio = v.patrimonio;
    const val = v.valoracion || valoracionVacia();
    const reg = e.macro.regimen;
    const vigentes = megafono.directivasVigentes(e.directivas, ahora);
    const defensivo = e.directivas.modo === 'DEFENSIVO' ? 0.5 : 1;
    const bloqueado = e.fondo.nivel === 'bloqueado';

    const opsPorPuesto = new Map();
    const opsPorMesa = new Map();
    for (const o of this.operaciones) {
      if (o.motivoSalida === 'prueba') continue;
      if (!opsPorPuesto.has(o.puestoId)) opsPorPuesto.set(o.puestoId, []);
      opsPorPuesto.get(o.puestoId).push(o);
      if (!opsPorMesa.has(o.mesaId)) opsPorMesa.set(o.mesaId, []);
      opsPorMesa.get(o.mesaId).push(o);
    }

    const puestos = [];
    const pnlDiaMesa = {};
    for (const m of e.mesas) {
      for (const s of m.universo) {
        const pid = puestoId(m.id, s);
        const p = this.libros.puesto(pid);
        const vp = val.porPuesto[pid];
        const abierta = p && p.cantidad > EPS;
        const total = vp ? vp.realizado + vp.pnlAbierto : (p ? p.realizado : 0);
        const pnlDia = total - (e.inicioDiaPuestos[pid] ?? 0);
        pnlDiaMesa[m.id] = (pnlDiaMesa[m.id] || 0) + pnlDia;
        const aux = e.puestos[pid] || {};
        // Con posición, el texto se rehace con las cifras de ahora (las mismas
        // que la fila «Abierto»); el de la última vela podía tener un día y
        // hasta el signo contrario.
        const enVivo = abierta && !bloqueado && m.estado !== 'banquillo';
        puestos.push({
          id: pid, mesaId: m.id, simbolo: s, etiqueta: etiqueta(s), agenteId: agenteDePuesto(m.id, s),
          posicion: abierta ? {
            cantidad: p.cantidad, nocional: p.costeMedio * p.cantidad, entrada: p.costeMedio, stop: p.stop, objetivo: p.objetivoPrecio,
            pnlAbierto: vp ? vp.pnlAbierto : 0, pnlAbiertoPct: vp ? vp.pnlAbiertoPct : null, abiertaT: p.abiertaT,
          } : null,
          pnlDia,
          ...this._statsPuesto(opsPorPuesto.get(pid) || []),
          estadoTexto: enVivo
            ? plantillas.estadoPuesto({ etiqueta: etiqueta(s), marco: m.marco, posicion: { cantidad: p.cantidad, entrada: p.costeMedio, stop: p.stop, pnlAbiertoPct: vp ? vp.pnlAbiertoPct : null } })
            : (aux.estadoTexto || `Esperando la primera vela ${m.marco === '1Day' ? 'diaria' : 'de 4H'} para decidir ${etiqueta(s)}.`),
          ultimaSenal: aux.ultimaSenal || null,
          chispa: aux.chispa || [],
        });
      }
    }

    const mesas = e.mesas.map(m => {
      const mult = mesasDep.multiplicador(this, m.id);
      const met = metricasMesa({
        operaciones: opsPorMesa.get(m.id) || [], curvaDiaria: m.curvaDiaria, penalizacionPapel: this.limites.penalizacionPapel,
        diasActiva: Math.max(0, Math.floor((ahora - m.fechaAlta) / DIA)),
      });
      return {
        id: m.id, nombre: m.nombre, familia: m.familia, marco: m.marco, estado: m.estado, peso: m.peso,
        capital: m.estado === 'banquillo' ? 0 : patrimonio * m.peso * mult * defensivo, multiplicador: mult,
        universo: m.universo.map(etiqueta), params: m.params,
        metricas: {
          operaciones: met.operaciones, acierto: met.acierto, factorBeneficio: met.factorBeneficio, sharpe: met.sharpe,
          sharpeAjustado: met.sharpeAjustado, maxDD: met.maxDD, adherencia: met.adherencia, pnlTotal: met.pnlTotal,
        },
        pnlDia: pnlDiaMesa[m.id] || 0,
        nota: m.nota || null,
      };
    });

    const agentes = this.plantilla.map(a => {
      const vis = e.agentes[a.id] || {};
      let estado = vis.estado || 'trabajando';
      if (a.mesaId) { const m = this.mesaPorId(a.mesaId); if (m && m.estado === 'banquillo') estado = 'banquillo'; }
      if (bloqueado && estado !== 'banquillo' && estado !== 'reunion') estado = 'de_pie';
      return {
        id: a.id, nombre: a.nombre, departamento: a.departamento, rol: a.rol, queDecide: a.queDecide, usaLLM: a.usaLLM,
        sala: vis.sala || this._casa(a), estado, bocadillo: this._bocadillo(a.id, ahora),
        mesaId: a.mesaId || null, simbolo: a.simbolo || null, etiqueta: a.etiqueta || null, puestoId: a.puestoId || null,
      };
    });

    const benchmarks = valorarBenchmarks(e.sombras.benchmarks, v.precios).map(b => ({ ...b, sharpe90: sharpeRodante(e.sombras.curvas[b.id] || [], 90) }));
    benchmarks.push({
      id: 'sin-comite', nombre: 'Mismas mesas sin comité', valor: v.patrimonioSombra,
      rentabilidad: e.capitalInicial > 0 ? v.patrimonioSombra / e.capitalInicial - 1 : null, sharpe90: sharpeRodante(e.sombras.curvas['sin-comite'] || [], 90),
    });
    const s90 = operaciones.sharpes90(this);
    const n2 = x => (x === null ? '—' : f.numero(x, 2));
    const mejora = {
      ...s90,
      texto: s90.sharpe90Fondo === null
        ? `Sharpe 90 d: hacen falta 30 días de curva y hay ${Math.max(0, e.curvaDiaria.length - 1)}.`
        : `Sharpe 90 d: fondo ${n2(s90.sharpe90Fondo)}, sin comité ${n2(s90.sharpe90SinComite)}, BTC ${n2(s90.sharpe90Btc)}.`,
    };

    const lab = e.laboratorio;
    const llm = this.llm.estado();
    const sinAsignar = this._sinAsignar(patrimonio);
    const vig = this._vigilancia(patrimonio, ahora);
    const avisos = this._avisos({ ahora, patrimonio, vigentes, sinAsignar });

    return {
      version: 1,
      ahora,
      modo: this.modo,
      broker: this.broker.nombre,
      velocidad: this.velocidad,
      fondo: { nivel: e.fondo.nivel, motivo: e.fondo.motivo || null, multiplicadorCaida: e.fondo.multiplicadorCaida },
      cabecera: {
        patrimonio,
        pnlDia: patrimonio - e.patrimonioInicioDia,
        pnlDiaPct: e.patrimonioInicioDia > 0 ? patrimonio / e.patrimonioInicioDia - 1 : 0,
        caida: e.pico > 0 ? Math.min(0, patrimonio / e.pico - 1) : 0,   // desde el máximo HISTÓRICO, también tras reabrir
        exposicionBrutaPct: patrimonio > 0 ? val.exposicionBruta / patrimonio : 0,
        exposicionCriptoPct: patrimonio > 0 ? val.exposicionCripto / patrimonio : 0,
        posiciones: (v.posicionesBroker || []).length,
        regimen: reg ? { valor: reg.valor, detalle: reg.detalle } : { valor: 'NEUTRAL', detalle: 'Sin datos todavía' },
        miedoCodicia: e.macro.fg ? { valor: e.macro.fg.valor, etiqueta: e.macro.fg.etiqueta, sintetico: Boolean(e.macro.fg.sintetico) } : null,
        proximoComite: e.cadencias.proximoComite,
        modoComite: e.directivas.modo || 'NORMAL',
        sinAsignar,
        vigilancia: vig,
      },
      llm: { activo: llm.activo, modeloComite: llm.modeloComite, modeloAgentes: llm.modeloAgentes, gastoHoyUsd: llm.gastoHoyUsd, presupuestoDiaUsd: llm.presupuestoDiaUsd },
      curva: e.curva.slice(-MAX_CURVA_INSTANTANEA).map(p => ({ t: p.t, patrimonio: p.patrimonio })),
      cotizaciones: this.universo.map(a => {
        const q = v.precios[a.simbolo];
        return { simbolo: a.simbolo, etiqueta: a.etiqueta, precio: q ? q.precio : null, var24hPct: q ? this._var24h(a.simbolo, q.precio, Number.isFinite(q.t) ? q.t : ahora) : null, t: q ? q.t : null };
      }),
      departamentos: DEPARTAMENTOS.map(d => ({ ...d })),
      agentes,
      mesas,
      puestos,
      posiciones: (v.posicionesBroker || []).map(p => ({
        simbolo: p.simbolo, etiqueta: etiqueta(p.simbolo), cantidad: p.cantidad, precioMedio: p.precioMedio, precio: p.precioActual, valor: p.valor, pnl: p.pnlNoRealizado,
      })),
      benchmarks,
      mejora,
      directivas: {
        modo: vigentes.modo || 'NORMAL', multiplicadores: { ...(vigentes.multiplicadores || {}) },
        activosVetados: vigentes.activosVetados.map(x => ({ simbolo: x.simbolo, hasta: x.hasta ?? null, motivo: x.motivo || null })),
        mesasPausadas: vigentes.mesasPausadas.map(x => ({ mesaId: x.mesaId, hasta: x.hasta ?? null })),
        soloCerrarHasta: vigentes.soloCerrarHasta ?? null,
        reduccion: vigentes.reduccion ? { factor: vigentes.reduccion.factor, hasta: vigentes.reduccion.hasta ?? null } : null,
      },
      megafonoPendiente: e.megafonoPendiente
        ? { id: e.megafonoPendiente.id, texto: e.megafonoPendiente.texto, directivas: e.megafonoPendiente.directivas, explicacion: e.megafonoPendiente.explicacion }
        : null,
      mensajes: this.bus.ultimos(150),
      ejecuciones: e.ejecuciones.slice(0, MAX_EJECUCIONES),
      laboratorio: {
        ensayosTotales: lab.ensayosTotales,
        hipotesis: lab.hipotesis.slice(-12).reverse().map(h => ({ id: h.id, descripcion: h.descripcion, estado: h.estado, criterios: h.criterios || [], t: h.t })),
        proximaRevision: e.cadencias.proximoSemanal,
      },
      limites: { ...this.limites },
      avisos,
    };
  }

  // Capital que ninguna mesa tiene asignado: queda en efectivo (el techo del
  // 40 % por mesa del asignador no deja repartirlo con solo dos titulares).
  _sinAsignar(patrimonio) {
    let asignado = 0;
    for (const m of this.estado.mesas) if (m.estado !== 'banquillo' && m.peso > 0) asignado += m.peso;
    const fraccion = Math.max(0, 1 - asignado);
    return { fraccion, usd: patrimonio > 0 ? patrimonio * fraccion : 0 };
  }

  // Lo que mide el vigilante contra sus límites (tras una reapertura, desde
  // la reapertura). La cabecera cuenta el resultado real; esto es la cercanía
  // a los límites (para la barra de límites).
  _vigilancia(patrimonio, ahora) {
    const ref = riesgos.referenciasVigilancia(this.estado, ahora);
    const perdidaDiaPct = ref.diaInicio === diaUTC(ahora) && ref.patrimonioInicioDia > 0 ? patrimonio / ref.patrimonioInicioDia - 1 : null;
    const caidaPct = ref.pico > 0 && patrimonio > 0 ? Math.min(0, patrimonio / Math.max(ref.pico, patrimonio) - 1) : 0;
    return { perdidaDiaPct, caidaPct, desdeReapertura: ref.desdeReapertura };
  }

  // Avisos de la pantalla: lo que bloquea o limita al fondo va delante (en el
  // móvil cada aviso va en una línea y se corta por el final).
  _avisos({ ahora, patrimonio, vigentes, sinAsignar }) {
    const e = this.estado;
    const L = this.limites;
    const avisos = [];
    const fo = e.fondo;
    if (fo.nivel === 'bloqueado') avisos.push('Fondo bloqueado por el kill switch: solo sale con Reabrir.');
    else if (fo.nivel === 'pausado') avisos.push('Fondo en pausa: solo cierra posiciones hasta Reabrir.');
    else if (fo.nivel === 'solo_cerrar') {
      avisos.push(`Solo cerrar hasta las 00:00 UTC${Number.isFinite(fo.soloCerrarHasta) ? ` (${f.hora(fo.soloCerrarHasta)} en Madrid)` : ''}: pérdida del día por encima del ${f.pct(L.perdidaDiariaSoloCerrar, { decimales: 0 })}; no se abre nada nuevo.`);
    }
    if (fo.killReintento) avisos.push(`Tras el kill siguen posiciones en el bróker: se reintenta venderlas solo (próximo intento a las ${f.hora(fo.killReintento.proximo)}).`);
    if (fo.nivel !== 'bloqueado') {
      if (vigentes.modo === 'SOLO_CERRAR') avisos.push('El comité ha puesto SOLO CERRAR: no se abre nada nuevo hasta el próximo comité.');
      else if (vigentes.soloCerrarHasta && vigentes.soloCerrarHasta > ahora) avisos.push(`Solo cerrar por el Megáfono hasta las ${f.hora(vigentes.soloCerrarHasta)}: no se abre nada nuevo.`);
      else if (fo.nivel === 'normal') avisos.push(...this._avisosAperturas(vigentes));   // con el fondo parado sobran
    }
    // Reabrir no borra el máximo histórico: mientras la caída desde él supere
    // el límite del kill, se dice con cifras.
    if (e.pico > 0 && patrimonio > 0) {
      const caida = patrimonio / e.pico - 1;
      if (caida <= -L.caidaKill + 1e-9) {
        avisos.push(plantillas.frase(`El fondo sigue un ${f.pct(-caida, { decimales: 1 })} (${f.usd(e.pico - patrimonio)}) por debajo de su máximo histórico (${f.usd(e.pico)}), más que el límite de caída del ${f.pct(L.caidaKill, { decimales: 0 })}: tras reabrir, el vigilante mide desde la reapertura.`, 280));
      }
    }
    if (this.modo !== 'sintetico' && Number.isFinite(this.vivo.preciosOkT) && ahora - this.vivo.preciosOkT > PRECIOS_VIEJOS) {
      avisos.push(`Sin precios nuevos desde las ${f.hora(this.vivo.preciosOkT)}: stops y cifras van con el último precio conocido.`);
    }
    if (!e.conciliacion.limpia) avisos.push(plantillas.frase(`Conciliación con incidencias: ${e.conciliacion.resumen}`));
    if (sinAsignar.fraccion > 0.0005) {
      avisos.push(`${f.pct(sinAsignar.fraccion, { decimales: 0 })} del capital sin asignar: queda en efectivo (techo del ${f.pct(REGLAS_ASIGNADOR.techo, { decimales: 0 })} por mesa).`);
    }
    avisos.push('Con el ordenador apagado no hay stops: en cripto no existen órdenes stop simples.');
    if (this.modo === 'sintetico') avisos.push('Precios sintéticos: la demo no usa el mercado real.');
    else if (this.broker.nombre === 'simulado') avisos.push('Bróker simulado con precios reales de cripto (sin claves de Alpaca).');
    return avisos;
  }

  // Lo que bloquea aperturas sin parar el fondo: activos vetados (Megáfono,
  // comité, noticias) y mesas sin abrir (pausa del Megáfono o ×0 del comité).
  // Una línea por tipo, con quién lo puso y hasta cuándo.
  _avisosAperturas(vigentes) {
    const out = [];
    const hasta = h => (Number.isFinite(h) ? `, hasta las ${f.hora(h)}` : '');
    const quien = o => (o === 'comite' ? 'comité' : o === 'noticias' ? 'noticia grave' : 'Megáfono');
    const vetos = new Map();
    for (const v of vigentes.activosVetados || []) {
      const previo = vetos.get(v.simbolo);
      if (!previo || (v.hasta ?? Infinity) > (previo.hasta ?? Infinity)) vetos.set(v.simbolo, v);
    }
    if (vetos.size) {
      const partes = [...vetos.values()].map(v => `${etiqueta(v.simbolo)} (${quien(v.origen)}${hasta(v.hasta)})`);
      out.push(plantillas.frase(`No se abre en ${partes.join(', ')}.`, 280));
    }
    const nombre = id => (this.mesaPorId(id) || {}).nombre || id;
    const paradas = new Map();
    for (const p of vigentes.mesasPausadas || []) paradas.set(p.mesaId, `${nombre(p.mesaId)} (Megáfono${hasta(p.hasta)})`);
    for (const m of this.estado.mesas) {
      if (m.estado === 'banquillo' || paradas.has(m.id)) continue;
      if ((vigentes.multiplicadores || {})[m.id] === 0) paradas.set(m.id, `${nombre(m.id)} (comité ×0, hasta el próximo comité)`);
    }
    if (paradas.size) out.push(plantillas.frase(`Mesas sin abrir nada: ${[...paradas.values()].join(', ')}.`, 280));
    return out;
  }

  // «Solo cerrar» que sigue vigente por el comité o el Megáfono: Reabrir no lo quita.
  _soloCerrarVigente(ahora) {
    const v = megafono.directivasVigentes(this.estado.directivas, ahora);
    if (v.modo === 'SOLO_CERRAR') return ' Sigue vigente el SOLO CERRAR del comité hasta el próximo comité: Reabrir no lo quita.';
    if (v.soloCerrarHasta && v.soloCerrarHasta > ahora) return ` Sigue vigente el solo cerrar del Megáfono hasta las ${f.hora(v.soloCerrarHasta)}: Reabrir no lo quita.`;
    return '';
  }

  // ---------- Comandos (§7) ----------
  // Devuelven { ok, mensaje, datos? } y, si hace falta otro código HTTP, `codigo`.

  async comando(nombre, datos) {
    const d = datos && typeof datos === 'object' ? datos : {};
    let r;
    switch (nombre) {
      case 'comite': r = this._cmdComite(); break;
      case 'megafono': r = await this._cmdMegafono(d); break;
      case 'megafono-aplicar': r = this._cmdMegafonoAplicar(d); break;
      case 'prueba': r = await this._cmdPrueba(d); break;
      case 'pausar': r = this._cmdPausar(); break;
      case 'reabrir': r = await this._cmdReabrir(d); break;
      case 'kill': r = await this._cmdKill(d); break;
      case 'ajustes': r = this._cmdAjustes(datos); break;
      default: return { ok: false, codigo: 404, mensaje: `Comando desconocido: ${nombre}` };
    }
    if (r.ok) { this._seguroSinc('guardar', () => this.guardar()); this._emitirEstado({ forzar: true }); }
    return r;
  }

  _cmdComite() {
    if (this.comiteEnCurso) return { ok: false, mensaje: 'Ya hay un comité reunido.' };
    this.lanzar('comité', () => comite.celebrar(this, { motivo: 'demanda' }));
    return { ok: true, mensaje: 'Comité convocado: los jefes van a la sala.' };
  }

  async _cmdMegafono(d) {
    const texto = typeof d.texto === 'string' ? d.texto.trim().slice(0, 500) : '';
    if (!texto) return { ok: false, mensaje: 'Escribe qué quieres que haga la mesa.' };
    const ahora = this.reloj.ahora();
    this.bus.publicar({ de: 'humano', canal: 'megafono', tipo: 'megafono', texto: `«${texto}»`, datos: { texto }, importancia: 3 });
    // Sin duración escrita, la orden dura hasta el comité siguiente (COMITE_HORAS).
    const r = await megafono.interpretar(texto, {
      llm: this.llm, universo: this.universo, mesas: this.estado.mesas, directivas: this.estado.directivas, ahora,
      horasPorDefecto: this.config.cadencias.comiteHoras,
    });
    this.estado.contadores.megafono = (this.estado.contadores.megafono || 0) + 1;
    const propuesta = { id: `mf-${ahora.toString(36)}-${this.estado.contadores.megafono}`, texto, directivas: r.directivas, explicacion: r.explicacion, fuente: r.fuente };
    this.estado.megafonoPendiente = propuesta;
    this.bus.publicar({ de: 'cio', canal: 'megafono', tipo: 'propuesta', texto: plantillas.frase(`Propuesta: ${r.explicacion}`, 280), datos: { id: propuesta.id, directivas: r.directivas, fuente: r.fuente }, importancia: 2, costeUsd: r.costeUsd || 0 });
    return { ok: true, mensaje: 'Propuesta lista: revísala y pulsa Aplicar.', datos: { id: propuesta.id, texto, directivas: propuesta.directivas, explicacion: propuesta.explicacion } };
  }

  _cmdMegafonoAplicar(d) {
    const p = this.estado.megafonoPendiente;
    if (!p || d.id !== p.id) return { ok: false, mensaje: 'No hay ninguna propuesta pendiente con ese id.' };
    const ahora = this.reloj.ahora();
    let aplicadas = 0;
    for (const dir of p.directivas) {
      if (dir.tipo === 'sin_efecto') continue;
      this.estado.directivas = megafono.aplicarDirectiva(this.estado.directivas, dir, ahora);
      aplicadas++;
      this.bus.publicar({ de: 'cio', canal: 'megafono', tipo: 'directiva', texto: plantillas.directiva(dir, this.estado.mesas), datos: { ...dir }, importancia: 3 });
    }
    this.estado.megafonoPendiente = null;
    const vig = megafono.directivasVigentes(this.estado.directivas, ahora);
    return { ok: true, mensaje: aplicadas ? `${aplicadas} directiva${aplicadas === 1 ? '' : 's'} aplicada${aplicadas === 1 ? '' : 's'}.` : 'No había nada que aplicar.', datos: vig };
  }

  async _cmdPrueba(d) {
    if (d.ordenMinima && d.confirmacion !== 'PRUEBA') return { ok: false, codigo: 400, mensaje: 'Para la orden mínima hay que escribir PRUEBA.' };
    const comprobaciones = [];
    const comprobar = async (nombre, fn) => {
      try { const detalle = await fn(); comprobaciones.push({ nombre, ok: true, detalle }); } catch (e) { comprobaciones.push({ nombre, ok: false, detalle: e.message }); }
    };
    const ahora = this.reloj.ahora();
    await comprobar('Bróker', async () => {
      const c = await this.broker.cuenta();
      if (c.bloqueada) throw new Error(`cuenta bloqueada (${c.estado})`);
      return `${this.broker.nombre}: patrimonio ${f.usd(c.patrimonio)}, efectivo ${f.usd(c.efectivo)}.`;
    });
    await comprobar('Datos de mercado', async () => {
      const q = await this.datos.ultimos(['BTC/USD']);
      if (!q['BTC/USD']) throw new Error('sin precio de BTC');
      return `BTC ${f.precio(q['BTC/USD'].precio)} (hace ${f.numero(Math.max(0, (ahora - q['BTC/USD'].t) / 1000))} s).`;
    });
    await comprobar('Miedo y codicia', async () => {
      const x = await this.fg.actual();
      if (!x) throw new Error('sin dato');
      return `${x.valor} · ${x.etiqueta}${x.sintetico ? ' (sintético)' : ''}.`;
    });
    await comprobar('LLM', async () => {
      const s = this.llm.estado();
      if (!s.activo) return 'Apagado: los agentes hablan con plantillas.';
      return `Activo: comité ${s.modeloComite}, agentes ${s.modeloAgentes}; hoy ${f.usd(s.gastoHoyUsd)} de ${f.usd(s.presupuestoDiaUsd)}.`;
    });
    if (d.ordenMinima) {
      await comprobar('Orden mínima (15 $ de BTC)', () => this._exclusivo(() => this._ordenMinima()));
    }
    const ok = comprobaciones.every(c => c.ok);
    return { ok, mensaje: ok ? 'Todo responde.' : 'Alguna comprobación ha fallado.', datos: { comprobaciones } };
  }

  async _ordenMinima() {
    const s = 'BTC/USD';
    const pid = 'prueba-BTC';
    this.libros.asegurarPuesto({ puestoId: pid, mesaId: 'prueba', simbolo: s, sombra: false });
    await this._actualizarPrecios(this.reloj.ahora());
    await this.refrescarCartera();
    const q = this.vivo.precios[s];
    const compra = riesgos.evaluar(this, { puestoId: pid, mesaId: 'prueba', simbolo: s, clase: 'cripto', lado: 'compra', tipo: 'prueba', nocional: 15, precio: q.precio, precioT: q.t });
    if (compra.decision === 'vetar') throw new Error(compra.motivos.map(m => m.texto).join(' '));
    const ahora = this.reloj.ahora();
    const r1 = await this.ejecutor.ejecutar({ puestoId: pid, mesaId: 'prueba', simbolo: s, lado: 'compra', nocional: 15, tipo: 'prueba', motivo: 'prueba', accion: 'prueba', velaT: ahora, precioReferencia: q.precio });
    if (!r1.ok) throw new Error(`compra: ${r1.motivo}`);
    await this.refrescarCartera();
    const p = this.libros.puesto(pid);
    const r2 = await this.ejecutor.ejecutar({ puestoId: pid, mesaId: 'prueba', simbolo: s, lado: 'venta', cantidad: p.cantidad, cantidadPuesto: p.cantidad, tipo: 'prueba', motivo: 'prueba', accion: 'prueba', velaT: ahora, precioReferencia: q.precio, cierraTodo: true });
    await this.refrescarCartera();
    if (!r2.ok) throw new Error(`venta: ${r2.motivo}`);
    const op = (r2.operaciones || [])[0];
    return `Comprados ${f.cantidad(r1.cantidad, 8)} BTC y vendidos ${f.cantidad(r2.cantidad, 8)}; resultado ${f.usd(op ? op.pnl : null, { signo: true })}.`;
  }

  _cmdPausar() {
    const fo = this.estado.fondo;
    if (fo.nivel === 'bloqueado') return { ok: false, mensaje: 'El fondo ya está bloqueado.' };
    if (fo.nivel === 'pausado') return { ok: true, mensaje: 'Ya estaba en pausa.' };
    fo.nivel = 'pausado';
    fo.motivo = 'Pausa humana: solo cerrar hasta Reabrir.';
    this.bus.publicar({ de: 'riesgos', canal: 'riesgo', tipo: 'alerta', texto: 'Pausa pedida desde el panel: solo se cierran posiciones hasta que un humano pulse Reabrir.', importancia: 3 });
    return { ok: true, mensaje: 'Pausado: solo cerrar hasta Reabrir.' };
  }

  // Reabrir: solo sale de 'pausado' (botón o conciliación) y de 'bloqueado'
  // (kill). El solo cerrar por la pérdida del día NO se reabre: dura hasta las
  // 00:00 UTC y se levanta solo (reabrirlo volvería a saltar en el latido
  // siguiente). Tras un kill no se borra el máximo histórico: el vigilante
  // mide desde una referencia aparte que se pone aquí, y el mensaje dice con
  // cifras cuánto acumula el fondo desde su máximo.
  async _cmdReabrir(d) {
    if (d.confirmacion !== 'REABRIR') return { ok: false, codigo: 400, mensaje: 'Para reabrir hay que escribir REABRIR.' };
    return this._exclusivo(async () => {
      const fo = this.estado.fondo;
      const ahora = this.reloj.ahora();
      const directivas = this._soloCerrarVigente(ahora);
      if (fo.nivel === 'normal') return { ok: true, mensaje: `El fondo ya estaba en nivel normal.${directivas}` };
      if (fo.nivel === 'solo_cerrar') {
        const hasta = Number.isFinite(fo.soloCerrarHasta) ? ` (${f.hora(fo.soloCerrarHasta)} en Madrid)` : '';
        return { ok: false, mensaje: `No se reabre: el solo cerrar por la pérdida del día dura hasta las 00:00 UTC${hasta} y se levanta solo. Mientras, se pueden cerrar posiciones; para parar del todo, usa Pausar o el kill switch.` };
      }
      try {
        await this._actualizarPrecios(ahora);
        await this.refrescarCartera();
      } catch (e) {
        return { ok: false, mensaje: plantillas.frase(`No se reabre: el bróker o los precios no responden (${e.message}).`, 280) };
      }
      const c = operaciones.conciliarCadaLatido(this);
      if (!c.limpia) return { ok: false, mensaje: plantillas.frase(`No se reabre: la conciliación no está limpia. ${c.resumen}`, 280) };
      const venia = fo.nivel;
      fo.nivel = 'normal';
      fo.motivo = null;
      fo.soloCerrarHasta = null;
      fo.killReintento = null;
      this.estado.conciliacion.gravesSeguidas = 0;
      const patrimonio = this.vivo.patrimonio;
      if (venia === 'bloqueado') {
        // Referencia de vigilancia: el patrimonio de ahora. La contable (pico
        // histórico, inicio real del día) no se toca.
        this.estado.picoVigilancia = patrimonio < this.estado.pico ? patrimonio : null;
        this.estado.inicioDiaVigilancia = patrimonio;
        this.estado.diaInicioVigilancia = diaUTC(ahora);
      }
      this.estado.contadores.reaperturas = (this.estado.contadores.reaperturas || 0) + 1;
      for (const a of this.plantilla) {
        const m = a.mesaId ? this.mesaPorId(a.mesaId) : null;
        this.moverAgente(a.id, null, m && m.estado === 'banquillo' ? 'banquillo' : 'trabajando');
      }
      const texto = plantillas.reabrir({ quien: 'un humano desde el panel', patrimonio, pico: this.estado.pico });
      this.bus.publicar({ de: 'riesgos', canal: 'riesgo', tipo: 'alerta', texto, datos: { desde: venia, patrimonio, pico: this.estado.pico }, importancia: 3 });
      return { ok: true, mensaje: plantillas.frase(`Reabierto: vuelta a nivel normal. ${texto.replace(/^Reabierto por [^.]*\.\s*/, '')}${directivas}`, 400) };
    });
  }

  // Kill manual: el fondo queda BLOQUEADO al instante (y en disco), antes de
  // esperar al latido en curso o a la red; luego se cierra todo con los
  // últimos precios si no hay otros. ok solo si no queda nada por vender.
  async _cmdKill(d) {
    if (d.confirmacion !== 'KILL') return { ok: false, codigo: 400, mensaje: 'Para el kill switch hay que escribir KILL.' };
    const motivo = 'kill switch manual desde el panel';
    const fo = this.estado.fondo;
    this._killPedido = true;
    if (fo.nivel !== 'bloqueado') {
      fo.nivel = 'bloqueado';
      fo.motivo = motivo;
      fo.soloCerrarHasta = null;
      this._seguroSinc('guardar', () => this.guardar());
      this._emitirEstado({ forzar: true });
    }
    try {
      return await this._exclusivo(async () => {
        const ahora = this.reloj.ahora();
        await this._seguro('precios', 'controller', () => this._actualizarPrecios(ahora));
        await this._seguro('valoración', 'controller', () => this.refrescarCartera());
        let r;
        try {
          r = await this.killSwitch(motivo);
        } catch (err) {
          return { ok: false, mensaje: plantillas.frase(`Fondo BLOQUEADO, pero el cierre falló (${err.message}): se reintenta solo cada pocos minutos.`, 280) };
        }
        const espera = r.esperanApertura.length ? ` ${r.esperanApertura.map(etiqueta).join(', ')} se vende${r.esperanApertura.length === 1 ? '' : 'n'} a la apertura (bolsa cerrada).` : '';
        if (r.quedanEnBroker.length || r.errores.length) {
          const quedan = r.quedanEnBroker.length ? `siguen abiertas ${r.quedanEnBroker.map(etiqueta).join(', ')}` : 'hubo errores';
          const motivos = r.errores.map(x => x.motivo || x.mensaje).filter(Boolean).slice(0, 2).join('; ');
          return { ok: false, mensaje: plantillas.frase(`Kill: ${r.cerradas.length} cerradas; ${quedan}${motivos ? ` (${motivos})` : ''}. Fondo bloqueado; se reintenta solo cada pocos minutos.${espera}`, 400), datos: r };
        }
        return { ok: true, mensaje: `Kill switch: ${r.cerradas.length} posiciones cerradas, fondo bloqueado.${espera}`, datos: r };
      });
    } finally {
      this._killPedido = false;
    }
  }

  _datosAjustes() {
    const s = this.llm.estado();
    return {
      modo: this.modo, broker: this.broker.nombre, presupuestoDiaUsd: s.presupuestoDiaUsd, modeloComite: s.modeloComite, modeloAgentes: s.modeloAgentes,
      velocidad: this.velocidad, limites: { ...this.limites }, modelosDisponibles: MODELOS_DISPONIBLES,
    };
  }

  _cmdAjustes(datos) {
    if (!datos || typeof datos !== 'object' || !Object.keys(datos).length) return { ok: true, mensaje: '', datos: this._datosAjustes() };
    const errores = [];
    const a = this.estado.ajustes;
    if (datos.presupuestoDiaUsd !== undefined) {
      const v = Number(datos.presupuestoDiaUsd);
      if (!Number.isFinite(v) || v < 0 || v > 1000) errores.push('presupuesto entre 0 y 1.000 $');
      else if (this.llm.fijarPresupuesto) { this.llm.fijarPresupuesto(v); a.presupuestoDiaUsd = v; }
    }
    for (const k of ['modeloComite', 'modeloAgentes']) {
      if (datos[k] === undefined) continue;
      if (typeof datos[k] !== 'string' || !MODELOS_DISPONIBLES.includes(datos[k])) errores.push(`${k} de la lista (${MODELOS_DISPONIBLES.join(', ')})`);
      else if (this.llm.fijarModelos) { this.llm.fijarModelos({ [k]: datos[k] }); a[k] = datos[k]; }
    }
    if (datos.velocidad !== undefined) {
      const v = Number(datos.velocidad);
      if (this.modo !== 'sintetico') errores.push('la velocidad solo se cambia en modo sintético');
      else if (!Number.isFinite(v) || v < 1 || v > 100000) errores.push('velocidad entre 1 y 100.000');
      else { this.velocidad = v; a.velocidad = v; }
    }
    for (const k of Object.keys(datos)) {
      if (!['presupuestoDiaUsd', 'modeloComite', 'modeloAgentes', 'velocidad'].includes(k)) errores.push(`«${k}» no se cambia desde aquí${k === 'limites' ? ' (los límites solo se ven)' : ''}`);
    }
    if (errores.length) return { ok: false, mensaje: `No se guardó todo: ${errores.join('; ')}.`, datos: this._datosAjustes() };
    return { ok: true, mensaje: 'Ajustes guardados.', datos: this._datosAjustes() };
  }
}

module.exports = { Orquestador, VERSION_ESTADO, siguienteHora, siguienteLunes, siguienteMes };
