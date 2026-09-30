// Maqueta: una mesa inventada para trabajar la interfaz sin servidor (?maqueta=1
// o abriendo index.html como fichero). Genera la instantánea con la forma EXACTA
// de §7 y la va cambiando: precios, mensajes, operaciones con su monitor en
// ámbar, un comité que lleva a los jefes a su sala y los devuelve, descansos, y
// responde a los comandos de la botonera.
//
// Todo es inventado y así lo dice la pantalla (aviso y píldora MAQUETA). La
// contabilidad interna sí cuadra: patrimonio = efectivo + Σ valor de posiciones.
(function (raiz, fabrica) {
  const mod = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (raiz.Parque = raiz.Parque || {}).maqueta = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SEG = 1000;
  const MIN = 60 * SEG;
  const HORA = 60 * MIN;

  const DEPARTAMENTOS = [
    { id: 'direccion', nombre: 'Dirección', color: '#f5b942', sala: 'direccion' },
    { id: 'macro', nombre: 'Macro', color: '#8b5cf6', sala: 'macro' },
    { id: 'analisis', nombre: 'Análisis', color: '#22c55e', sala: 'analisis' },
    { id: 'mesas', nombre: 'Mesas', color: '#3b82f6', sala: 'parque' },
    { id: 'riesgos', nombre: 'Riesgos', color: '#ef4444', sala: 'riesgos' },
    { id: 'operaciones', nombre: 'Operaciones', color: '#f97316', sala: 'riesgos' },
    { id: 'laboratorio', nombre: 'Laboratorio', color: '#06b6d4', sala: 'laboratorio' },
  ];
  const SALA_DE = Object.fromEntries(DEPARTAMENTOS.map(d => [d.id, d.sala]));

  const LIMITES = {
    maxPesoPorActivo: 0.10, maxExposicionBruta: 0.80, maxExposicionCripto: 0.50, riesgoPorOperacion: 0.01,
    maxPosiciones: 12, perdidaDiariaSoloCerrar: 0.02, perdidaDiariaKill: 0.07, caidaReducir: 0.10, caidaKill: 0.25,
    maxOrdenesMinuto: 10, maxOrdenesMesaHora: 4, minNocionalOrden: 10, maxAntiguedadPrecioSegCripto: 900,
    maxAntiguedadPrecioSegAcciones: 120, desvioMaxPrecio: 0.02, penalizacionPapel: 0.001,
  };

  const MODELOS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-haiku-4-5'];

  const ACTIVOS = [
    { simbolo: 'BTC/USD', etiqueta: 'BTC', precio: 83547, var24: 0.0132, vol: 0.00055 },
    { simbolo: 'ETH/USD', etiqueta: 'ETH', precio: 2651.4, var24: 0.0214, vol: 0.0007 },
    { simbolo: 'SOL/USD', etiqueta: 'SOL', precio: 142.37, var24: -0.0087, vol: 0.0009 },
    { simbolo: 'LINK/USD', etiqueta: 'LINK', precio: 14.182, var24: 0.0046, vol: 0.0009 },
    { simbolo: 'AVAX/USD', etiqueta: 'AVAX', precio: 21.43, var24: -0.0154, vol: 0.001 },
    { simbolo: 'DOGE/USD', etiqueta: 'DOGE', precio: 0.1234, var24: 0.0311, vol: 0.0012 },
  ];
  const POR_ETIQUETA = Object.fromEntries(ACTIVOS.map(a => [a.etiqueta, a]));

  // Como en el arranque real (src/estrategias/index.js, 30-sep-2026): una
  // titular al 40 % (techo del asignador) y tres en incubación al 2 %; el 54 %
  // queda sin asignar, en efectivo.
  const MESAS = [
    { id: 'tendencia', nombre: 'Tendencia SMA', familia: 'tendencia-sma', marco: '4Hour', universo: ['BTC', 'ETH', 'SOL'],
      params: { rapida: 7, lenta: 25, filtro: 200, atrStop: 2.5 }, peso: 0.02, estado: 'incubacion',
      nota: 'Backtest real 2021-2026 con costes: Sharpe −0,53. Empieza en prueba con el 2 %.' },
    { id: 'momentum', nombre: 'Momentum cripto', familia: 'momentum-rotacion', marco: '1Day', universo: ['BTC', 'ETH', 'SOL', 'LINK', 'AVAX', 'DOGE'],
      params: { lookback: 28, top: 2, rebalanceo: 'lunes' }, peso: 0.4, estado: 'titular',
      nota: 'Backtest real 2021-2026 con costes: Sharpe 0,91 frente a 0,63 de comprar y mantener. Única titular.' },
    { id: 'reversion', nombre: 'Reversión RSI', familia: 'reversion-rsi', marco: '1Day', universo: ['BTC', 'ETH'],
      params: { rsi: 2, umbral: 10, salidaSma: 5, maxVelas: 5 }, peso: 0.02, estado: 'incubacion',
      nota: 'Backtest real 2021-2026 con costes: Sharpe −0,36. Empieza en prueba con el 2 %.' },
    { id: 'ruptura', nombre: 'Ruptura Donchian', familia: 'ruptura-donchian', marco: '1Day', universo: ['BTC', 'ETH', 'SOL'],
      params: { entrada: 20, salida: 10, atrStop: 2 }, peso: 0.02, estado: 'incubacion',
      nota: 'Correlación diaria con Momentum 0,80: juntas, Sharpe 0,58 y caída 26,0 %; Momentum sola, 0,72 y 11,2 %. No diversifica: empieza en prueba con el 2 %.' },
  ];

  const FIJOS = [
    { id: 'cio', nombre: 'Carmen Aguirre', departamento: 'direccion', rol: 'Presidenta del comité', usaLLM: true,
      queDecide: 'Modo del fondo (NORMAL, DEFENSIVO o SOLO_CERRAR), multiplicadores por mesa de {0; 0,5; 1} y vetos de 24 h. Nunca toca los límites duros.' },
    { id: 'macro', nombre: 'Tomás Herrera', departamento: 'macro', rol: 'Estratega macro', usaLLM: false,
      queDecide: 'Régimen RISK-ON, NEUTRAL o RISK-OFF por regla fija (BTC y SPY frente a sus medias, volatilidad). Vota DEFENSIVO en RISK-OFF.' },
    { id: 'riesgos', nombre: 'Marta Solís', departamento: 'riesgos', rol: 'Jefa de riesgos', usaLLM: false,
      queDecide: 'Aprueba, recorta o veta cada orden contra los límites duros. Su voto DEFENSIVO en el comité es veto.' },
    { id: 'ejecutor', nombre: 'Raúl Campos', departamento: 'operaciones', rol: 'Ejecutor', usaLLM: false,
      queDecide: 'Nada de qué comprar: envía las órdenes aprobadas, espera la ejecución y no repite una orden ya enviada.' },
    { id: 'controller', nombre: 'Inés Ferrer', departamento: 'operaciones', rol: 'Controller', usaLLM: false,
      queDecide: 'Nada operativo: patrimonio, P&L, caída, exposición y conciliación con el bróker en cada latido.' },
    { id: 'laboratorio', nombre: 'Álvaro Medina', departamento: 'laboratorio', rol: 'Director de laboratorio', usaLLM: false,
      queDecide: 'Qué variantes se prueban (gramática cerrada) y si pasan las puertas del walk-forward para entrar en incubación.' },
    { id: 'auditor', nombre: 'Julián Prieto', departamento: 'laboratorio', rol: 'Auditor post-mortem', usaLLM: true,
      queDecide: 'La categoría de cada operación cerrada, de una lista cerrada, y la lección en una frase con cifras comprobadas.' },
  ];
  const NOMBRES_ANALISTAS = ['Lucía Romero', 'Hugo Navarro', 'Sofía Torres', 'Mateo Ramos', 'Paula Gil', 'Daniel Serrano'];
  const NOMBRES_OPERADORES = [
    ['Elena Molina', 'f'], ['Pablo Ortega', 'm'], ['Irene Delgado', 'f'], ['Adrián Castro', 'm'], ['Claudia Ortiz', 'f'],
    ['Javier Rubio', 'm'], ['Nerea Marín', 'f'], ['Sergio Sanz', 'm'], ['Alba Iglesias', 'f'], ['Marcos Núñez', 'm'],
    ['Noelia Garrido', 'f'], ['Diego Cortés', 'm'], ['Rocío Lozano', 'f'], ['Iván Guerrero', 'm'],
  ];
  const JEFES_COMITE = ['cio', 'controller', 'macro', 'riesgos', 'laboratorio'];

  // Aleatorio con semilla (mulberry32): la misma semilla da la misma maqueta.
  function generador(semilla) {
    let s = (semilla >>> 0) || 1;
    return () => {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Formato mínimo para los textos (el de verdad lo pone el servidor).
  const nf = (d) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });
  const agrupar = (s) => { const [e, d] = s.split(','); const sg = e.startsWith('-') && /[1-9]/.test(s) ? '-' : ''; const g = e.replace(/^-/, '').replace(/\./g, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.'); return sg + g + (d !== undefined ? ',' + d : ''); };
  const usd = (x, signo) => (signo && x > 0 ? '+' : '') + agrupar(Math.abs(x) >= 1000 ? nf(0).format(x) : nf(2).format(x)) + ' $';
  const pct = (x, d, signo) => (signo && x > 0 ? '+' : '') + agrupar(nf(d === undefined ? 2 : d).format(x * 100)) + ' %';
  const prec = (x) => { const a = Math.abs(x); return agrupar(nf(a >= 1000 ? 0 : a >= 10 ? 2 : a >= 1 ? 3 : 4).format(x)); };
  const cant = (x) => agrupar(new Intl.NumberFormat('es-ES', { maximumFractionDigits: x >= 100 ? 1 : x >= 1 ? 3 : 5 }).format(x));
  // En hora de Madrid, como formato.hora del servidor y la hora del feed.
  const hora = (t) => new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }).format(new Date(t));
  const copia = (x) => JSON.parse(JSON.stringify(x));

  function crearMaqueta(opciones) {
    const o = opciones || {};
    const rnd = generador(o.semilla === undefined ? 7 : o.semilla);
    const inicio = o.ahora || Date.now();
    let ahora = inicio;
    const eventos = [];
    const cola = [];
    let nMensaje = 0;
    let nProp = 0;
    let comiteEnCurso = false;

    const precios = {};
    const precio24 = {};
    const historia = {};
    for (const a of ACTIVOS) {
      precios[a.etiqueta] = a.precio;
      precio24[a.etiqueta] = a.precio / (1 + a.var24);
      historia[a.etiqueta] = [];
      let p = a.precio;
      for (let k = 0; k < 16; k++) { historia[a.etiqueta].unshift(p); p *= 1 + (rnd() - 0.5) * a.vol * 12; }
    }

    // ----- plantilla -----
    const agentes = FIJOS.map(f => ({ ...f, sala: SALA_DE[f.departamento], estado: 'trabajando', bocadillo: null,
      mesaId: null, simbolo: null, etiqueta: null, puestoId: null }));
    ACTIVOS.forEach((a, i) => agentes.push({
      id: `analista-${a.etiqueta}`, nombre: NOMBRES_ANALISTAS[i], departamento: 'analisis', rol: `Analista de ${a.etiqueta}`, usaLLM: true,
      queDecide: `Nada operativo: nota técnica de ${a.etiqueta} (sesgo, SMA50, RSI, volatilidad) con cifras del código; el LLM solo la redacta.`,
      sala: 'analisis', estado: 'trabajando', bocadillo: null, mesaId: null, simbolo: a.simbolo, etiqueta: a.etiqueta, puestoId: null,
    }));
    const puestos = [];
    let nOp = 0;
    for (const m of MESAS) {
      for (const e of m.universo) {
        const [nombre, genero] = NOMBRES_OPERADORES[nOp++ % NOMBRES_OPERADORES.length];
        const puestoId = `${m.id}-${e}`;
        const agenteId = `puesto-${puestoId}`;
        agentes.push({
          id: agenteId, nombre, departamento: 'mesas', rol: `${genero === 'f' ? 'Operadora' : 'Operador'} de ${m.nombre} · ${e}`, usaLLM: false,
          queDecide: `Abrir, mantener o cerrar ${e} según la regla de ${m.familia}; el tamaño lo fija el código y lo aprueba Riesgos.`,
          sala: 'parque', estado: 'trabajando', bocadillo: null, mesaId: m.id, simbolo: POR_ETIQUETA[e].simbolo, etiqueta: e, puestoId,
        });
        puestos.push({
          id: puestoId, mesaId: m.id, simbolo: POR_ETIQUETA[e].simbolo, etiqueta: e, agenteId,
          posicion: null, pnlDia: 0, operaciones: 0, acierto: null, factorBeneficio: null, adherencia: null,
          estadoTexto: '', ultimaSenal: null, chispa: [],
          _ganadas: 0, _ganado: 0, _perdido: 0, _porRegla: 0, _realizadoDia: 0,
        });
      }
    }
    const puestoPorId = new Map(puestos.map(p => [p.id, p]));
    const agentePorId = new Map(agentes.map(a => [a.id, a]));

    // Historial inventado por puesto (para que la tarjeta no salga vacía).
    for (const p of puestos) {
      const n = 2 + Math.floor(rnd() * 9);
      const g = Math.round(n * (0.35 + rnd() * 0.35));
      p.operaciones = n;
      p._ganadas = g;
      p._ganado = g * (40 + rnd() * 90);
      p._perdido = (n - g) * (30 + rnd() * 60);
      p._porRegla = n - (rnd() < 0.2 ? 1 : 0);
      recalcular(p);
    }

    // ----- cartera -----
    const CAPITAL = 100000;
    let efectivo = CAPITAL + 412.35;   // realizado previo inventado
    let comisionesTotales = 0;
    function abrir(p, nocional, desvio) {
      const precio = precios[p.etiqueta];
      const entrada = precio * (1 + desvio);
      const cantidad = nocional / entrada;
      const comision = nocional * 0.0025;
      efectivo -= nocional;
      comisionesTotales += comision;
      const mesa = MESAS.find(m => m.id === p.mesaId);
      const stopPct = mesa.familia === 'tendencia-sma' ? 0.06 : mesa.familia === 'ruptura-donchian' ? 0.07 : 0.08;
      p.posicion = {
        cantidad: cantidad * (1 - 0.0025), nocional, entrada, stop: entrada * (1 - stopPct),
        objetivo: mesa.familia === 'reversion-rsi' ? entrada * 1.04 : null, pnlAbierto: 0, pnlAbiertoPct: 0,
        abiertaT: ahora - Math.floor(rnd() * 30) * HORA,
      };
      return { precio: entrada, cantidad: p.posicion.cantidad, comision };
    }
    // Posiciones de partida.
    abrir(puestoPorId.get('tendencia-BTC'), 3200, -0.012);
    abrir(puestoPorId.get('tendencia-ETH'), 2800, 0.009);
    abrir(puestoPorId.get('momentum-SOL'), 2500, -0.02);
    abrir(puestoPorId.get('momentum-DOGE'), 2400, -0.031);
    abrir(puestoPorId.get('ruptura-ETH'), 2600, 0.004);
    abrir(puestoPorId.get('reversion-BTC'), 1800, 0.003);

    const valorPosiciones = () => puestos.reduce((s, p) => s + (p.posicion ? p.posicion.cantidad * precios[p.etiqueta] : 0), 0);
    const patrimonio = () => efectivo + valorPosiciones();
    const patrimonioInicioDia = patrimonio() - 184.2;
    let pico = Math.max(CAPITAL + 1250, patrimonio());
    // Referencia del vigilante tras un Reabrir humano (como el servidor): la
    // cabecera sigue midiendo desde el máximo histórico y el inicio real del día.
    let vigilancia = null;

    // Curva: 300 puntos hacia atrás cada 5 min que acaban en el patrimonio de ahora.
    const curva = [];
    {
      let v = patrimonio();
      for (let k = 0; k < 300; k++) {
        curva.unshift({ t: ahora - k * 5 * MIN, patrimonio: Math.round(v * 100) / 100 });
        v -= (rnd() - 0.47) * 70;
      }
    }

    let fondo = { nivel: 'normal', motivo: null, multiplicadorCaida: 1 };
    let proximoComite = inicio + 25 * SEG;
    let modoComite = 'NORMAL';
    let gastoLLM = 0.1243;
    let presupuesto = 1;
    let modeloComite = 'claude-opus-5-5';
    let modeloAgentes = 'claude-haiku-4-5';
    let velocidad = 1;
    const directivas = { modo: 'NORMAL', multiplicadores: Object.fromEntries(MESAS.map(m => [m.id, 1])), activosVetados: [],
      mesasPausadas: [], soloCerrarHasta: null, reduccion: null };
    // §7 fondo.factorTamano: DEFENSIVO (×0,5) × reducción del Megáfono vigente × caída.
    const factorTamano = (ahora) => {
      const r = directivas.reduccion;
      const comite = directivas.modo === 'DEFENSIVO' ? 0.5 : 1;
      const megafono = r && (r.hasta === null || r.hasta === undefined || r.hasta > ahora) ? r.factor : 1;
      const caida = Number.isFinite(fondo.multiplicadorCaida) ? fondo.multiplicadorCaida : 1;
      return { total: comite * megafono * caida, comite, megafono, caida };
    };
    let megafonoPendiente = null;
    const mensajes = [];
    const ejecuciones = [];
    const destellos = [];
    const laboratorio = {
      ensayosTotales: 37,
      hipotesis: [
        { id: 'H-38', descripcion: 'tendencia-sma 4H en BTC, ETH, SOL con filtro regimen-no-riskoff', estado: 'evaluando', criterios: [], t: inicio - 3 * HORA },
        { id: 'H-37', descripcion: 'ruptura-donchian 1D con stop 2,5 × ATR', estado: 'rechazada',
          criterios: [{ nombre: 'Sharpe OOS', valor: 0.41, umbral: 0.6, ok: false }, { nombre: 'Operaciones OOS', valor: 44, umbral: 30, ok: true }], t: inicio - 26 * HORA },
      ],
      proximaRevision: inicio + 3 * 24 * HORA,
    };

    // ----- utilidades de eventos -----
    function emitir(tipo, datos) { eventos.push({ tipo, datos: copia(datos) }); }
    function programar(retraso, fn, grupo) { cola.push({ t: ahora + retraso, fn, grupo: grupo || null }); cola.sort((a, b) => a.t - b.t); }

    function decir(de, canal, tipo, texto, extra) {
      const e = extra || {};
      const ag = agentePorId.get(de);
      const m = {
        id: `m-${++nMensaje}`, t: e.t || ahora, de, deNombre: ag ? ag.nombre : (e.deNombre || 'Sistema'),
        departamento: ag ? ag.departamento : null, para: e.para || 'todos', canal, tipo, texto,
        datos: e.datos || null, importancia: e.importancia || 1, costeUsd: e.costeUsd || 0,
      };
      mensajes.push(m);
      if (mensajes.length > 150) mensajes.shift();
      if (ag && !e.sinBocadillo) ag.bocadillo = { texto, hasta: m.t + Math.min(12000, 6000 + 60 * texto.length) };
      if (!e.silencioso) emitir('mensaje', m);
      if (e.costeUsd) gastoLLM += e.costeUsd;
      return m;
    }

    function moverAgente(id, sala, estado) {
      const a = agentePorId.get(id);
      if (!a) return;
      a.sala = sala;
      a.estado = estado;
      emitir('agente', { id: a.id, estado: a.estado, sala: a.sala, bocadillo: a.bocadillo });
    }

    const elegir = (lista) => lista[Math.floor(rnd() * lista.length)];

    // ----- mensajes de ambiente -----
    function textoEstadoPuesto(p) {
      const mesa = MESAS.find(m => m.id === p.mesaId);
      const e = p.etiqueta;
      const px = precios[e];
      if (p.posicion) {
        return `Largo en ${e}: ${cant(p.posicion.cantidad)} a ${prec(p.posicion.entrada)}, stop ${prec(p.posicion.stop)}, ${pct(p.posicion.pnlAbiertoPct, 2, true)}.`;
      }
      switch (mesa.familia) {
        case 'tendencia-sma': return `Sin posición en ${e}. Esperando a que SMA 7-25 dé LONG con filtro 200 (4H).`;
        case 'momentum-rotacion': return `Sin posición en ${e}. Fuera del top 2 de la rotación (28 d ${pct((rnd() - 0.6) * 0.2, 1, true)}).`;
        case 'reversion-rsi': return `Sin posición en ${e}. RSI(2) en ${Math.round(20 + rnd() * 60)}: espero < 10 con cierre sobre SMA200.`;
        default: return `Sin posición en ${e}. Máximo de 20 días en ${prec(px * (1.02 + rnd() * 0.05))}; cierre ${prec(px)}.`;
      }
    }

    function ambiente() {
      const r = rnd();
      if (r < 0.34) {
        const p = elegir(puestos.filter(x => agentePorId.get(x.agenteId).sala === 'parque'));
        if (!p) return;
        const texto = rnd() < 0.2 && !p.posicion ? elegir(['No hay señal ahora. Mejor no forzar.', 'Vela cerrada sin cambios. Sigo esperando.']) : textoEstadoPuesto(p);
        p.estadoTexto = texto;
        p.ultimaSenal = { accion: p.posicion ? 'mantener' : 'nada', t: ahora };
        decir(p.agenteId, 'parque', 'estado', texto, { datos: { puestoId: p.id } });
      } else if (r < 0.54) {
        const a = elegir(ACTIVOS);
        const px = precios[a.etiqueta];
        const sesgo = elegir(['muy alcista', 'alcista', 'neutral', 'bajista']);
        const sobre = sesgo.includes('alcista');
        decir(`analista-${a.etiqueta}`, 'analisis', 'nota',
          `Nota de análisis ${a.etiqueta}: sesgo ${sesgo}. ${sobre ? 'Sobre' : 'Bajo'} SMA50 ${prec(px * (sobre ? 0.96 : 1.03))}; RSI 4H ${Math.round(sobre ? 55 + rnd() * 15 : 35 + rnd() * 15)}, vol. 30 d ${Math.round(40 + rnd() * 40)} %.`,
          { costeUsd: 0.0021, datos: { simbolo: a.simbolo, sesgo } });
      } else if (r < 0.62) {
        decir('macro', 'macro', 'regimen', `Régimen RISK-ON (+3). BTC ${prec(precios.BTC)} sobre SMA200 ${prec(precios.BTC * 0.88)}; SMA50 > SMA200; vol. 30 d 46 %.`,
          { importancia: 2 });
      } else if (r < 0.7) {
        const c = cabecera();
        decir('riesgos', 'riesgo', 'nota', `Exposición bruta ${pct(c.exposicionBrutaPct, 0)} de 80 %; cripto ${pct(c.exposicionCriptoPct, 0)} de 50 %. Nada cerca del límite.`);
      } else if (r < 0.77) {
        const c = cabecera();
        decir('controller', 'riesgo', 'nota', `Patrimonio ${usd(c.patrimonio)}, hoy ${usd(c.pnlDia, true)} (${pct(c.pnlDiaPct, 2, true)}). Conciliación limpia.`);
      } else if (r < 0.82) {
        decir('ejecutor', 'ejecucion', 'nota', 'Sin órdenes en cola. El bróker simulado responde en 0,2 s.');
      } else if (r < 0.88) {
        decir('laboratorio', 'laboratorio', 'hipotesis', 'Hipótesis H-38: tendencia-sma 4H con filtro regimen-no-riskoff. Walk-forward en 5 de 6 ventanas.');
      } else if (r < 0.93) {
        const p = elegir(puestos);
        decir('auditor', 'laboratorio', 'leccion', `Lección ${p.mesaId}/${p.etiqueta} (stop estrecho): salió en 2 velas por ${usd(-(20 + Math.round(rnd() * 40)))}.`, { costeUsd: 0.0034 });
      } else {
        decir('cio', 'direccion', 'nota', `Sin cambios hasta el comité de las ${hora(proximoComite)}. Modo ${modoComite}.`);
      }
    }

    // ----- operaciones -----
    function flash(puestoId, tipo) { destellos.push({ puestoId, tipo, t: ahora }); }

    function operacion() {
      if (fondo.nivel !== 'normal' && fondo.nivel !== 'solo_cerrar' && fondo.nivel !== 'pausado') return;
      const enParque = puestos.filter(p => agentePorId.get(p.agenteId).sala === 'parque');
      const abiertas = enParque.filter(p => p.posicion);
      const libres = enParque.filter(p => !p.posicion && !directivas.activosVetados.some(v => v.simbolo === p.simbolo));
      const cerrar = fondo.nivel !== 'normal' || (abiertas.length >= 7) || (abiertas.length && rnd() < 0.4) || !libres.length;
      if (cerrar && abiertas.length) {
        const p = elegir(abiertas);
        const e = p.etiqueta;
        decir(p.agenteId, 'parque', 'senal', `Señal de salida en ${e}: cierre ${prec(precios[e])} bajo la media lenta.`, { datos: { puestoId: p.id }, importancia: 2 });
        p.ultimaSenal = { accion: 'cerrar', t: ahora };
        programar(1100, () => decir('riesgos', 'riesgo', 'aprobacion', `Aprobada la venta de ${cant(p.posicion ? p.posicion.cantidad : 0)} ${e}.`, { datos: { puestoId: p.id } }));
        programar(2000, () => {
          if (!p.posicion) return;
          decir('ejecutor', 'ejecucion', 'orden', `Orden a mercado: vender ${cant(p.posicion.cantidad)} ${e}.`, { datos: { puestoId: p.id } });
          flash(p.id, 'orden');
        });
        programar(3200, () => cerrarPosicion(p, 'señal'));
        return;
      }
      if (!libres.length) return;
      const p = elegir(libres);
      const e = p.etiqueta;
      const noc = Math.round(1200 + rnd() * 2200);
      const px = precios[e];
      decir(p.agenteId, 'parque', 'propuesta', `Propongo comprar ${usd(noc)} de ${e} a ${prec(px)}, stop ${prec(px * 0.94)}.`, { datos: { puestoId: p.id }, importancia: 2 });
      p.ultimaSenal = { accion: 'abrir', t: ahora };
      const vetar = rnd() < 0.18;
      if (vetar) {
        programar(1200, () => {
          decir('riesgos', 'riesgo', 'veto', `Veto a ${e}: exposición cripto ${pct(cabecera().exposicionCriptoPct + 0.04, 0)} rozaría el 50 % tras la orden.`,
            { datos: { puestoId: p.id }, importancia: 3 });
          flash(p.id, 'veto');
        });
        return;
      }
      programar(1200, () => decir('riesgos', 'riesgo', 'aprobacion', `Aprobado: ${usd(noc)} de ${e}.`, { datos: { puestoId: p.id } }));
      programar(2200, () => {
        decir('ejecutor', 'ejecucion', 'orden', `Orden a mercado: comprar ${usd(noc)} de ${e}.`, { datos: { puestoId: p.id } });
        flash(p.id, 'orden');
      });
      programar(3400, () => {
        if (p.posicion || fondo.nivel === 'bloqueado') return;
        const r = abrir(p, noc, (rnd() - 0.5) * 0.001);
        const ej = { t: ahora, puestoId: p.id, simbolo: p.simbolo, etiqueta: e, lado: 'compra', cantidad: r.cantidad, precio: r.precio,
          nocional: noc, comision: r.comision, motivo: 'señal' };
        registrarEjecucion(ej);
        decir('ejecutor', 'ejecucion', 'ejecucion', `Comprados ${cant(r.cantidad)} ${e} a ${prec(r.precio)} (${usd(noc)}). Comisión ${usd(r.comision)}.`,
          { datos: { puestoId: p.id } });
        p.estadoTexto = textoEstadoPuesto(p);
      });
    }

    function registrarEjecucion(ej) {
      ejecuciones.unshift(ej);
      if (ejecuciones.length > 30) ejecuciones.pop();
      emitir('ejecucion', ej);
    }

    function cerrarPosicion(p, motivo) {
      if (!p.posicion) return null;
      const e = p.etiqueta;
      const px = precios[e];
      const q = p.posicion.cantidad;
      const bruto = q * px;
      const comision = bruto * 0.0025;
      efectivo += bruto - comision;
      comisionesTotales += comision;
      const coste = p.posicion.nocional;
      const pnl = bruto - comision - coste;
      p._realizadoDia += pnl;
      p.operaciones += 1;
      if (pnl > 0) { p._ganadas += 1; p._ganado += pnl; } else p._perdido += -pnl;
      if (motivo === 'señal' || motivo === 'stop') p._porRegla += 1;
      const barras = 1 + Math.floor(rnd() * 12);
      p.posicion = null;
      recalcular(p);
      const ej = { t: ahora, puestoId: p.id, simbolo: p.simbolo, etiqueta: e, lado: 'venta', cantidad: q, precio: px, nocional: bruto, comision, motivo };
      registrarEjecucion(ej);
      decir('ejecutor', 'ejecucion', 'ejecucion', `Vendidos ${cant(q)} ${e} a ${prec(px)} (${usd(bruto)}). Comisión ${usd(comision)}.`, { datos: { puestoId: p.id } });
      programar(600, () => {
        const texto = `Cerrada ${e} ${motivo === 'kill' ? 'por kill switch' : 'por señal'}: ${usd(pnl, true)} (${pct(pnl / coste, 2, true)}) en ${barras} vela${barras === 1 ? '' : 's'}.`;
        p.estadoTexto = texto;
        decir(p.agenteId, 'parque', 'cierre', texto, { datos: { puestoId: p.id }, importancia: 2 });
      });
      return pnl;
    }

    function recalcular(p) {
      p.acierto = p.operaciones ? p._ganadas / p.operaciones : null;
      p.factorBeneficio = p._perdido > 0 ? p._ganado / p._perdido : (p._ganado > 0 ? null : null);
      p.adherencia = p.operaciones ? p._porRegla / p.operaciones : null;
    }

    // ----- comité -----
    function comite() {
      if (comiteEnCurso || fondo.nivel === 'bloqueado') return false;
      comiteEnCurso = true;
      for (const id of JEFES_COMITE) moverAgente(id, 'comite', 'reunion');
      decir('cio', 'comite', 'comite', `Abro el comité de las ${hora(ahora)}. Orden del día: siete puntos.`, { importancia: 3 });
      programar(6500, () => {
        const c = cabecera();
        decir('controller', 'comite', 'informe', `Patrimonio ${usd(c.patrimonio)}, hoy ${usd(c.pnlDia, true)} (${pct(c.pnlDiaPct, 2, true)}). Caída ${pct(Math.abs(c.caida))}. Exposición ${pct(c.exposicionBrutaPct, 0)}.`, { importancia: 3 });
      }, 'comite');
      programar(9000, () => decir('macro', 'comite', 'voto', 'Régimen RISK-ON (+3). Voto NORMAL.', { importancia: 3 }), 'comite');
      programar(11500, () => decir('riesgos', 'comite', 'voto', 'Nivel normal, 1 veto en el periodo. Voto NORMAL.', { importancia: 3 }), 'comite');
      programar(14000, () => {
        const orden = puestos.slice().sort((a, b) => b._realizadoDia - a._realizadoDia);
        decir('cio', 'comite', 'informe', `Mesas: mejor ${orden[0].mesaId} ${usd(orden[0]._realizadoDia, true)}; peor ${orden[orden.length - 1].mesaId} ${usd(orden[orden.length - 1]._realizadoDia, true)}.`, { importancia: 3 });
      }, 'comite');
      programar(16500, () => decir('laboratorio', 'comite', 'informe', 'Laboratorio: 1 hipótesis en curso, 0 aprobadas; 37 ensayos acumulados.', { importancia: 3 }), 'comite');
      programar(19500, () => {
        decir('cio', 'comite', 'decision', `Decisión: modo ${modoComite}. Multiplicadores 1 en las cuatro mesas. Sin vetos.`, { importancia: 3, costeUsd: 0.0184 });
      }, 'comite');
      programar(24000, () => {
        for (const id of JEFES_COMITE) {
          const a = agentePorId.get(id);
          moverAgente(id, SALA_DE[a.departamento], fondo.nivel === 'bloqueado' ? 'de_pie' : 'trabajando');
        }
        comiteEnCurso = false;
        proximoComite = ahora + 70 * SEG;
      }, 'comite');
      return true;
    }

    function descanso() {
      const candidatos = agentes.filter(a => a.sala === SALA_DE[a.departamento] && a.estado === 'trabajando' && !JEFES_COMITE.includes(a.id)
        && !(a.puestoId && puestoPorId.get(a.puestoId).posicion));
      if (!candidatos.length || comiteEnCurso || fondo.nivel === 'bloqueado') return;
      const a = elegir(candidatos);
      decir(a.id, a.departamento === 'mesas' ? 'parque' : (a.departamento === 'analisis' ? 'analisis' : 'sistema'), 'descanso', 'Pausa de cinco minutos.');
      moverAgente(a.id, 'descanso', 'descanso');
      programar(22000, () => {
        if (a.sala === 'descanso') moverAgente(a.id, SALA_DE[a.departamento], fondo.nivel === 'bloqueado' ? 'de_pie' : 'trabajando');
      });
    }

    // ----- instantánea -----
    function cabecera() {
      const patr = patrimonio();
      const valor = valorPosiciones();
      return {
        patrimonio: redondear(patr), pnlDia: redondear(patr - patrimonioInicioDia), pnlDiaPct: (patr - patrimonioInicioDia) / patrimonioInicioDia,
        caida: Math.min(0, patr / pico - 1), exposicionBrutaPct: valor / patr, exposicionCriptoPct: valor / patr,
        posiciones: puestos.filter(p => p.posicion).length,
        regimen: { valor: 'RISK-ON', detalle: 'BTC sobre SMA200 (+1), SMA50 > SMA200 (+1), vol. 30 d 46 % (0); sin datos de SPY.' },
        miedoCodicia: { valor: 70, etiqueta: 'Codicia', sintetico: true },
        proximoComite, modoComite,
        sinAsignar: capitalSinAsignar(patr),
        vigilancia: {
          perdidaDiaPct: vigilancia ? patr / vigilancia.inicioDia - 1 : (patr - patrimonioInicioDia) / patrimonioInicioDia,
          caidaPct: vigilancia ? Math.min(0, patr / Math.max(vigilancia.pico, patr) - 1) : Math.min(0, patr / pico - 1),
          desdeReapertura: Boolean(vigilancia),
        },
      };
    }

    // Capital que ninguna mesa tiene (queda en efectivo), como _sinAsignar del servidor.
    function capitalSinAsignar(patr) {
      const asignado = MESAS.reduce((s, m) => s + (m.estado !== 'banquillo' && m.peso > 0 ? m.peso : 0), 0);
      const fraccion = Math.max(0, 1 - asignado);
      return { fraccion, usd: patr > 0 ? redondear(patr * fraccion) : 0 };
    }

    function redondear(x) { return Math.round(x * 100) / 100; }

    // Avisos como los del servidor: lo que bloquea el fondo va delante (en el
    // móvil el aviso va en una línea y se corta por el final).
    function avisos() {
      const lista = [];
      if (fondo.nivel === 'bloqueado') lista.push('Fondo bloqueado por el kill switch: solo sale con Reabrir.');
      else if (fondo.nivel === 'pausado') lista.push('Fondo en pausa: solo cierra posiciones hasta Reabrir.');
      else if (fondo.nivel === 'solo_cerrar') lista.push(`Solo cerrar hasta las 00:00 UTC: ${fondo.motivo || 'límite de pérdida del día'}`);
      const sa = capitalSinAsignar(patrimonio());
      if (sa.fraccion > 0.0005) {
        const titulares = MESAS.filter(m => m.estado === 'titular' && m.peso > 0).length;
        const enPrueba = MESAS.filter(m => m.estado === 'incubacion').length;
        const quien = titulares === 0 ? 'ninguna mesa titular'
          : titulares === 1 ? 'solo 1 mesa titular (techo del 40 %)' : `solo ${titulares} mesas titulares (techo del 40 % cada una)`;
        lista.push(`${pct(sa.fraccion, 0)} del capital sin asignar: queda en efectivo. Hay ${quien}${enPrueba ? ` y ${enPrueba} en prueba al 2 %` : ''}: mejor efectivo que capital en estrategias sin ventaja demostrada.`);
      }
      lista.push('Con el ordenador apagado no hay stops: en cripto no existen órdenes stop simples.');
      lista.push('Maqueta: todos los datos de esta pantalla son inventados.');
      return lista;
    }

    // Semáforo «¿Listo para dinero real?» (§5.8) con la forma del servidor.
    // Inventado como todo: un fondo de 41 días que cumple unos criterios y otros no.
    function listoParaReal(cab) {
      const DIAS = 41;
      const COSTE_LLM = 3.12;
      const beneficio = cab.patrimonio - CAPITAL;
      const fraccion = beneficio > 0 ? COSTE_LLM / beneficio : null;
      const n2 = x => nf(2).format(x);
      const criterios = [
        { id: 'a', nombre: 'Días en papel', valor: DIAS, umbral: 180, ok: false, valorTexto: `${DIAS} días`, umbralTexto: '≥ 180 días', detalle: 'Desde el arranque del fondo (2026-08-20).' },
        { id: 'b', nombre: 'Operaciones cerradas', valor: 23, umbral: 100, ok: false, valorTexto: '23', umbralTexto: '≥ 100', detalle: 'Del fondo real, sin la orden de prueba.' },
        { id: 'c', nombre: 'Sharpe del fondo', valor: 1.02, umbral: 0.7, ok: true, valorTexto: n2(1.02), umbralTexto: `≥ ${n2(0.7)}`, detalle: 'Anualizado, retornos diarios desde el arranque, con la penalización de papel.' },
        { id: 'd', nombre: 'Bate a comprar y mantener', valor: 1.02, umbral: 0.84, ok: true, valorTexto: n2(1.02), umbralTexto: `≥ ${n2(0.84)} (BTC)`, detalle: `Sharpe en el mismo periodo: BTC ${n2(0.84)}, cesta cripto ${n2(0.52)}.` },
        { id: 'e', nombre: 'Caída máxima', valor: 0.018, umbral: 0.2, ok: true, valorTexto: pct(0.018, 1), umbralTexto: '≤ 20 %', detalle: 'Desde el máximo histórico del fondo, la peor vista.' },
        { id: 'f', nombre: 'Sin incidentes en 90 días', valor: 0, umbral: 0, ok: false, valorTexto: `0 en ${DIAS} días`, umbralTexto: '0 en 90 días', detalle: `El registro de incidentes empezó el 2026-08-20: cubre ${DIAS} de 90 días.` },
        { id: 'g', nombre: 'Coste del LLM', valor: fraccion, umbral: 0.1, ok: fraccion !== null && fraccion < 0.1,
          valorTexto: fraccion !== null ? `${pct(fraccion, 1)} (${usd(COSTE_LLM)})` : usd(COSTE_LLM), umbralTexto: '< 10 % del beneficio',
          detalle: beneficio > 0 ? `Acumulado ${usd(COSTE_LLM)} sobre un beneficio neto de ${usd(beneficio)}.` : `El fondo no gana (${usd(beneficio, true)}): cualquier gasto en IA (${usd(COSTE_LLM)}) es demasiado.` },
      ];
      const cumplidos = criterios.filter(k => k.ok).length;
      return {
        listo: cumplidos === criterios.length, cumplidos, total: criterios.length, criterios,
        comite: { sharpeFondo: 1.02, sharpeSinComite: 0.91, bate: true, texto: `El comité aporta: Sharpe del fondo ${n2(1.02)} frente a ${n2(0.91)} de «mismas mesas sin comité».` },
        nota: 'El semáforo no activa nada: el código sigue siendo solo papel. Pasar a real exige una decisión escrita de Eduardo y un cambio deliberado de código. '
          + 'Primer tramo recomendado: una cantidad que se pueda perder entera (como mucho 2.000 €) y 3 meses comparando las ejecuciones reales con las de papel.',
      };
    }

    function instantanea() {
      const cab = cabecera();
      for (const a of agentes) if (a.bocadillo && a.bocadillo.hasta < ahora) a.bocadillo = null;
      const vistaPuestos = puestos.map(p => {
        const pos = p.posicion;
        let posicion = null;
        if (pos) {
          const px = precios[p.etiqueta];
          const pnlAbierto = pos.cantidad * px - pos.nocional;
          posicion = { cantidad: pos.cantidad, nocional: pos.nocional, entrada: pos.entrada, stop: pos.stop, objetivo: pos.objetivo,
            pnlAbierto: redondear(pnlAbierto), pnlAbiertoPct: pnlAbierto / pos.nocional, abiertaT: pos.abiertaT };
        }
        const abierto = posicion ? posicion.pnlAbierto : 0;
        return {
          id: p.id, mesaId: p.mesaId, simbolo: p.simbolo, etiqueta: p.etiqueta, agenteId: p.agenteId, posicion,
          pnlDia: redondear(p._realizadoDia + abierto * 0.35), operaciones: p.operaciones, acierto: p.acierto, factorBeneficio: p.factorBeneficio,
          adherencia: p.adherencia, estadoTexto: p.estadoTexto || textoEstadoPuesto(p), ultimaSenal: p.ultimaSenal,
          chispa: historia[p.etiqueta].slice(-16),
        };
      });
      const vistaMesas = MESAS.map(m => {
        const ps = puestos.filter(p => p.mesaId === m.id);
        const ops = ps.reduce((s, p) => s + p.operaciones, 0);
        const gan = ps.reduce((s, p) => s + p._ganadas, 0);
        const ganado = ps.reduce((s, p) => s + p._ganado, 0);
        const perdido = ps.reduce((s, p) => s + p._perdido, 0);
        const regla = ps.reduce((s, p) => s + p._porRegla, 0);
        const sharpe = redondear(((ganado - perdido) / Math.max(1, ops)) / 60);
        return {
          id: m.id, nombre: m.nombre, familia: m.familia, marco: m.marco, estado: m.estado, peso: m.peso,
          capital: redondear(cab.patrimonio * m.peso), multiplicador: directivas.multiplicadores[m.id], universo: m.universo.slice(), params: copia(m.params),
          metricas: { operaciones: ops, acierto: ops ? gan / ops : null, factorBeneficio: perdido > 0 ? ganado / perdido : null, sharpe,
            sharpeAjustado: redondear(sharpe * ops / (ops + 30)), maxDD: 0.031 + ops * 0.001, adherencia: ops ? regla / ops : null, pnlTotal: redondear(ganado - perdido) },
          pnlDia: redondear(vistaPuestos.filter(p => p.mesaId === m.id).reduce((s, p) => s + p.pnlDia, 0)),
          nota: m.nota,
        };
      });
      const porSimbolo = new Map();
      for (const p of puestos) {
        if (!p.posicion) continue;
        const x = porSimbolo.get(p.simbolo) || { simbolo: p.simbolo, etiqueta: p.etiqueta, cantidad: 0, coste: 0 };
        x.cantidad += p.posicion.cantidad;
        x.coste += p.posicion.nocional;
        porSimbolo.set(p.simbolo, x);
      }
      const posiciones = Array.from(porSimbolo.values()).map(x => {
        const px = precios[x.etiqueta];
        return { simbolo: x.simbolo, etiqueta: x.etiqueta, cantidad: x.cantidad, precioMedio: x.coste / x.cantidad, precio: px,
          valor: redondear(x.cantidad * px), pnl: redondear(x.cantidad * px - x.coste) };
      });
      const rentBtc = precios.BTC / (ACTIVOS[0].precio / 1.004) - 1;
      return {
        version: 1, ahora, modo: 'sintetico', broker: 'simulado', velocidad,
        fondo: Object.assign(copia(fondo), { factorTamano: factorTamano(ahora) }),
        cabecera: cab,
        llm: { activo: true, modeloComite, modeloAgentes, gastoHoyUsd: Math.round(gastoLLM * 10000) / 10000, presupuestoDiaUsd: presupuesto },
        curva: curva.slice(-500).map(p => ({ t: p.t, patrimonio: p.patrimonio })),
        cotizaciones: ACTIVOS.map(a => ({ simbolo: a.simbolo, etiqueta: a.etiqueta, precio: precios[a.etiqueta],
          var24hPct: precios[a.etiqueta] / precio24[a.etiqueta] - 1, t: ahora - 1500 })),
        departamentos: copia(DEPARTAMENTOS),
        agentes: agentes.map(a => ({ id: a.id, nombre: a.nombre, departamento: a.departamento, rol: a.rol, queDecide: a.queDecide, usaLLM: a.usaLLM,
          sala: a.sala, estado: a.estado, bocadillo: a.bocadillo ? { texto: a.bocadillo.texto, hasta: a.bocadillo.hasta } : null,
          mesaId: a.mesaId, simbolo: a.simbolo, etiqueta: a.etiqueta, puestoId: a.puestoId })),
        mesas: vistaMesas,
        puestos: vistaPuestos,
        posiciones,
        benchmarks: [
          { id: 'btc', nombre: 'Solo BTC', valor: redondear(CAPITAL * (1 + rentBtc)), rentabilidad: rentBtc, sharpe90: 0.84 },
          { id: 'cesta-cripto', nombre: 'Cesta de 6 cripto', valor: redondear(CAPITAL * 1.0071), rentabilidad: 0.0071, sharpe90: 0.52 },
          { id: 'sin-comite', nombre: 'Mismas mesas sin comité', valor: redondear(cab.patrimonio - 96.4), rentabilidad: (cab.patrimonio - 96.4) / CAPITAL - 1, sharpe90: 0.91 },
        ],
        mejora: { sharpe90Fondo: 1.02, sharpe90SinComite: 0.91, sharpe90Btc: 0.84,
          texto: 'Sharpe 90 d: fondo 1,02, sin comité 0,91, BTC 0,84. Aún pocos días para sacar conclusiones.' },
        directivas: copia(directivas),
        megafonoPendiente: megafonoPendiente ? copia(megafonoPendiente) : null,
        mensajes: copia(mensajes.slice(-150)),
        ejecuciones: copia(ejecuciones.slice(0, 30)),
        laboratorio: copia(laboratorio),
        limites: Object.assign({}, LIMITES),
        listoParaReal: listoParaReal(cab),
        avisos: avisos(),
        actividad: copia(actividad),
      };
    }

    // ----- mensajes de partida (media hora de historia) -----
    {
      const guion = [
        ['macro', 'macro', 'regimen', 'Régimen RISK-ON (+3). BTC sobre SMA200; SMA50 > SMA200; vol. 30 d 46 %.'],
        ['analista-ETH', 'analisis', 'nota', 'Nota de análisis ETH: sesgo muy alcista. Sobre SMA50 2.540; RSI 4H 61, vol. 30 d 48 %.'],
        ['puesto-tendencia-SOL', 'parque', 'estado', 'Sin posición en SOL. Esperando a que SMA 7-25 dé LONG con filtro 200 (4H).'],
        ['riesgos', 'riesgo', 'nota', 'Sin vetos en la última hora. Pérdida del día lejos del −2 %.'],
        ['puesto-reversion-ETH', 'parque', 'estado', 'No hay señal ahora. Mejor no forzar.'],
        ['controller', 'riesgo', 'nota', 'Conciliación limpia: los libros cuadran con el bróker.'],
        ['analista-BTC', 'analisis', 'nota', 'Nota de análisis BTC: sesgo alcista. Sobre SMA50 79.900; RSI 4H 58, vol. 30 d 44 %.'],
        ['laboratorio', 'laboratorio', 'hipotesis', 'Hipótesis H-38: tendencia-sma 4H en BTC, ETH, SOL con regimen-no-riskoff. Origen: lección.'],
        ['puesto-momentum-AVAX', 'parque', 'estado', 'Sin posición en AVAX. Fuera del top 2 de la rotación (28 d −6,2 %).'],
        ['cio', 'direccion', 'nota', 'Sin cambios hasta el comité. Modo NORMAL.'],
        ['auditor', 'laboratorio', 'leccion', 'Lección tendencia/SOL (stop estrecho): salió en 2 velas por −38 $.'],
        ['ejecutor', 'ejecucion', 'nota', 'Sin órdenes en cola. El bróker simulado responde en 0,2 s.'],
        ['puesto-tendencia-BTC', 'parque', 'estado', null],
        ['analista-SOL', 'analisis', 'nota', 'Nota de análisis SOL: sesgo neutral. Bajo SMA50 146,80; RSI 4H 44, vol. 30 d 71 %.'],
      ];
      guion.forEach(([de, canal, tipo, texto], k) => {
        const t = inicio - (guion.length - k) * 2 * MIN;
        const p = de.startsWith('puesto-') ? puestoPorId.get(de.slice(7)) : null;
        const tx = texto || textoEstadoPuesto(p);
        if (p) p.estadoTexto = tx;
        decir(de, canal, tipo, tx, { t, silencioso: true, sinBocadillo: true, datos: p ? { puestoId: p.id } : null });
      });
      [['momentum-SOL', 'compra', 2500], ['tendencia-ETH', 'compra', 2800], ['ruptura-ETH', 'compra', 2600]].forEach(([id, lado, noc], k) => {
        const p = puestoPorId.get(id);
        ejecuciones.push({ t: inicio - (k + 1) * 17 * MIN, puestoId: p.id, simbolo: p.simbolo, etiqueta: p.etiqueta, lado, cantidad: p.posicion.cantidad,
          precio: p.posicion.entrada, nocional: noc, comision: noc * 0.0025, motivo: 'señal' });
      });
    }

    // ----- avance del tiempo -----
    let proxMensaje = inicio + 1500;
    // Actividad del «paso» de la maqueta (§7): cada 12 s los precios se mueven
    // y el vigilante mira, como en cada paso de la mesa de verdad.
    const actividadDe = t => ({ t, lista: [
      { agente: 'controller', accion: 'precios', objetivo: 'pantalla-cotizaciones' },
      { agente: 'riesgos', accion: 'riesgo', objetivo: 'mesas', detalle: 'limites' },
    ] });
    let actividad = actividadDe(inicio);
    let proxActividad = inicio + 12000;
    let proxOperacion = inicio + 6000;
    let proxDescanso = inicio + 14000;
    let proxMuestra = inicio + 4000;
    let proxCurva = inicio + 5000;
    let proxEstado = inicio + 2000;

    function paso(dt) {
      ahora += dt;
      // Precios: paseo aleatorio con un factor común (las cripto se mueven juntas).
      const comun = (rnd() - 0.5) * 2;
      for (const a of ACTIVOS) {
        const propio = (rnd() - 0.5) * 2;
        const z = 0.7 * comun + 0.5 * propio;
        precios[a.etiqueta] *= 1 + z * a.vol * Math.sqrt(dt / 1000);
      }
      const patr = patrimonio();
      if (patr > pico) pico = patr;
      if (vigilancia && patr > vigilancia.pico) vigilancia.pico = patr;
      // Stops: si el precio toca el stop, se cierra (como el vigilante).
      for (const p of puestos) {
        if (p.posicion && precios[p.etiqueta] <= p.posicion.stop) cerrarPosicion(p, 'stop');
      }
      while (cola.length && cola[0].t <= ahora) cola.shift().fn();
      if (ahora >= proxMuestra) {
        for (const a of ACTIVOS) { historia[a.etiqueta].push(precios[a.etiqueta]); if (historia[a.etiqueta].length > 32) historia[a.etiqueta].shift(); }
        proxMuestra = ahora + 4000;
      }
      if (ahora >= proxActividad) { actividad = actividadDe(ahora); proxActividad = ahora + 12000; }
      if (ahora >= proxCurva) {
        curva.push({ t: ahora, patrimonio: redondear(patrimonio()) });
        if (curva.length > 500) curva.shift();
        proxCurva = ahora + 5000;
      }
      if (fondo.nivel !== 'bloqueado') {
        if (ahora >= proxMensaje) { ambiente(); proxMensaje = ahora + 3800 + rnd() * 3200; }
        if (ahora >= proxOperacion) { operacion(); proxOperacion = ahora + 9000 + rnd() * 6000; }
        if (ahora >= proxDescanso) { descanso(); proxDescanso = ahora + 26000 + rnd() * 10000; }
        if (ahora >= proximoComite && !comiteEnCurso) comite();
      }
      if (ahora >= proxEstado) {
        emitir('estado', instantanea());
        proxEstado = ahora + 2000;
      }
    }

    function avanzar(ms) {
      let resto = Math.max(0, Math.min(ms, 60000));
      while (resto > 0) {
        const dt = Math.min(250, resto);
        paso(dt);
        resto -= dt;
      }
      return eventos.splice(0, eventos.length);
    }

    // ----- comandos (misma respuesta que §7: { ok, mensaje, datos? }) -----
    function interpretar(texto) {
      const t = String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      const etiquetas = ACTIVOS.filter(a => new RegExp(`\\b${a.etiqueta.toLowerCase()}\\b`).test(t));
      const mesas = MESAS.filter(m => t.includes(m.id) || t.includes(m.nombre.toLowerCase().split(' ')[0]));
      const horasM = t.match(/(\d+)\s*h/);
      const horas = horasM ? Math.min(72, Math.max(1, Number(horasM[1]))) : 4;
      const d = [];
      if (/reanuda|vuelve a abrir|quita la pausa/.test(t)) {
        etiquetas.forEach(a => d.push({ tipo: 'reanudar_activo', simbolo: a.simbolo }));
        mesas.forEach(m => d.push({ tipo: 'reanudar_mesa', mesaId: m.id }));
      } else {
        if (/solo cerrar|no abras|nada nuevo/.test(t)) d.push({ tipo: 'solo_cerrar', horas });
        if (/reduce|baja|menos riesgo|a la mitad/.test(t)) d.push({ tipo: 'reducir_riesgo', factor: /cuarto/.test(t) ? 0.25 : 0.5, horas });
        if (/pausa|para |parar|deja de/.test(t)) {
          etiquetas.forEach(a => d.push({ tipo: 'pausar_activo', simbolo: a.simbolo, horas }));
          mesas.forEach(m => d.push({ tipo: 'pausar_mesa', mesaId: m.id, horas }));
        }
      }
      if (!d.length) d.push({ tipo: 'sin_efecto', motivo: 'no reconozco ninguna orden de la lista cerrada en el texto' });
      const explicacion = d[0].tipo === 'sin_efecto'
        ? 'No he encontrado nada que aplicar. Prueba con «pausa SOL 6 h», «reduce riesgo» o «solo cerrar».'
        : `He entendido ${d.length} directiva${d.length === 1 ? '' : 's'} (palabras clave). Solo aprietan y caducan solas.`;
      return { directivas: d, explicacion };
    }

    function aplicarDirectiva(d) {
      const hasta = d.horas ? ahora + d.horas * HORA : null;
      if (d.tipo === 'pausar_activo') directivas.activosVetados.push({ simbolo: d.simbolo, hasta, motivo: 'Megáfono' });
      else if (d.tipo === 'pausar_mesa') directivas.mesasPausadas.push({ mesaId: d.mesaId, hasta });
      else if (d.tipo === 'solo_cerrar') directivas.soloCerrarHasta = hasta;
      else if (d.tipo === 'reducir_riesgo') directivas.reduccion = { factor: d.factor, hasta };
      else if (d.tipo === 'reanudar_activo') directivas.activosVetados = directivas.activosVetados.filter(v => v.simbolo !== d.simbolo);
      else if (d.tipo === 'reanudar_mesa') directivas.mesasPausadas = directivas.mesasPausadas.filter(v => v.mesaId !== d.mesaId);
    }

    function datosAjustes() {
      return { modo: 'sintetico', broker: 'simulado', presupuestoDiaUsd: presupuesto, modeloComite, modeloAgentes, velocidad,
        modelosDisponibles: MODELOS.slice(), limites: Object.assign({}, LIMITES) };
    }

    function comando(nombre, cuerpo) {
      const c = cuerpo || {};
      switch (nombre) {
        case 'comite': {
          if (comiteEnCurso) return { ok: false, mensaje: 'Ya hay un comité reunido.' };
          if (fondo.nivel === 'bloqueado') return { ok: false, mensaje: 'Con el fondo bloqueado no hay comité: primero Reabrir.' };
          comite();
          return { ok: true, mensaje: 'Comité convocado: los jefes van a la sala.' };
        }
        case 'megafono': {
          const texto = String(c.texto || '').trim();
          if (!texto) return { ok: false, mensaje: 'Escribe qué quieres que haga la mesa.' };
          const r = interpretar(texto);
          megafonoPendiente = { id: `meg-${++nProp}`, texto, directivas: r.directivas, explicacion: r.explicacion };
          decir('humano', 'megafono', 'megafono', texto, { deNombre: 'Megáfono (humano)', importancia: 3 });
          return { ok: true, mensaje: 'Propuesta lista: revísala y pulsa Aplicar.', datos: copia(megafonoPendiente) };
        }
        case 'megafono-aplicar': {
          if (!megafonoPendiente || c.id !== megafonoPendiente.id) return { ok: false, mensaje: 'No hay ninguna propuesta pendiente con ese id.' };
          const aplicadas = megafonoPendiente.directivas.filter(d => d.tipo !== 'sin_efecto');
          aplicadas.forEach(aplicarDirectiva);
          megafonoPendiente = null;
          decir('cio', 'megafono', 'directiva', aplicadas.length ? `Megáfono aplicado: ${aplicadas.length} directiva${aplicadas.length === 1 ? '' : 's'} en vigor.` : 'Megáfono: nada que aplicar.', { importancia: 3 });
          return { ok: true, mensaje: aplicadas.length ? 'Directivas aplicadas.' : 'No había nada que aplicar.', datos: copia(directivas) };
        }
        case 'prueba': {
          if (c.ordenMinima) {
            if (c.confirmacion !== 'PRUEBA') return { ok: false, mensaje: 'Para la orden mínima hay que escribir PRUEBA.' };
            const px = precios.BTC;
            const q = 15 / px * (1 - 0.0025);
            registrarEjecucion({ t: ahora, puestoId: null, simbolo: 'BTC/USD', etiqueta: 'BTC', lado: 'compra', cantidad: q, precio: px, nocional: 15, comision: 0.0375, motivo: 'prueba' });
            registrarEjecucion({ t: ahora + 800, puestoId: null, simbolo: 'BTC/USD', etiqueta: 'BTC', lado: 'venta', cantidad: q, precio: px, nocional: q * px, comision: q * px * 0.0025, motivo: 'prueba' });
            // Compra de 15 $ (comisión cobrada en BTC) y venta de lo recibido (comisión en dólares).
            efectivo += -15 + q * px * (1 - 0.0025);
            decir('ejecutor', 'ejecucion', 'ejecucion', `Prueba: comprados y vendidos ${cant(q)} BTC a ${prec(px)}. Coste total ${usd(15 - q * px * (1 - 0.0025))}.`);
            return { ok: true, mensaje: 'Orden mínima hecha: compra y venta de 15 $ de BTC.', datos: { comprobaciones: [
              { nombre: 'Compra 15 $ BTC', ok: true, detalle: `${cant(q)} BTC a ${prec(px)}` },
              { nombre: 'Venta', ok: true, detalle: 'ejecutada' }] } };
          }
          return { ok: true, mensaje: 'Todo responde.', datos: { comprobaciones: [
            { nombre: 'Bróker', ok: true, detalle: 'simulado · 12 ms' },
            { nombre: 'Datos de mercado', ok: true, detalle: `BTC ${prec(precios.BTC)} hace 2 s` },
            { nombre: 'Miedo y codicia', ok: true, detalle: '70 · Codicia (sintético)' },
            { nombre: 'LLM', ok: true, detalle: `${modeloAgentes} · ${usd(gastoLLM)} de ${usd(presupuesto)} hoy` },
          ] } };
        }
        case 'pausar': {
          if (fondo.nivel === 'bloqueado') return { ok: false, mensaje: 'El fondo ya está bloqueado.' };
          fondo = { nivel: 'pausado', motivo: 'Pausado a mano: solo se cierran posiciones hasta Reabrir.', multiplicadorCaida: fondo.multiplicadorCaida };
          decir('riesgos', 'riesgo', 'alerta', 'Pausa manual: solo cerrar hasta que alguien pulse Reabrir.', { importancia: 3 });
          return { ok: true, mensaje: 'Pausado: solo cerrar hasta Reabrir.' };
        }
        case 'reabrir': {
          if (c.confirmacion !== 'REABRIR') return { ok: false, mensaje: 'Para reabrir hay que escribir REABRIR.' };
          if (fondo.nivel === 'solo_cerrar') return { ok: false, mensaje: 'No se reabre: el «solo cerrar» por la pérdida del día dura hasta las 00:00 UTC y se levanta solo.' };
          if (fondo.nivel === 'normal') return { ok: true, mensaje: 'El fondo ya estaba en nivel normal.' };
          const venia = fondo.nivel;
          fondo = { nivel: 'normal', motivo: null, multiplicadorCaida: 1 };
          for (const a of agentes) if (a.estado === 'de_pie') moverAgente(a.id, a.sala === 'comite' ? SALA_DE[a.departamento] : a.sala, 'trabajando');
          // Como plantillas.reabrir: el máximo histórico no se borra y se dice con cifras.
          const patr = patrimonio();
          const maximo = Math.max(pico, patr);
          if (venia === 'bloqueado') vigilancia = { inicioDia: patr, pico: patr };
          const cifrasPico = maximo - patr < 0.005
            ? `El fondo está en su máximo histórico (${usd(maximo)}).`
            : `El fondo sigue un ${pct((maximo - patr) / maximo)} (${usd(maximo - patr)}) por debajo de su máximo histórico (${usd(maximo)}).`;
          decir('riesgos', 'riesgo', 'alerta', `Reabierto por un humano desde el panel. ${cifrasPico}`, { importancia: 3 });
          return { ok: true, mensaje: `Reabierto: vuelta a nivel normal. ${cifrasPico}` };
        }
        case 'kill': {
          if (c.confirmacion !== 'KILL') return { ok: false, mensaje: 'Para el kill switch hay que escribir KILL.' };
          const cerradas = puestos.filter(p => p.posicion).map(p => { cerrarPosicion(p, 'kill'); return p.simbolo; });
          fondo = { nivel: 'bloqueado', motivo: 'Kill switch manual. Todo cerrado; solo sale con Reabrir.', multiplicadorCaida: fondo.multiplicadorCaida };
          comiteEnCurso = false;
          // El comité que estaba reunido se disuelve: fuera sus puntos pendientes.
          for (let k = cola.length - 1; k >= 0; k--) if (cola[k].grupo === 'comite') cola.splice(k, 1);
          for (const a of agentes) moverAgente(a.id, a.sala === 'descanso' || a.sala === 'comite' ? SALA_DE[a.departamento] : a.sala, 'de_pie');
          decir('riesgos', 'riesgo', 'alerta', 'KILL SWITCH: orden manual. Cierro todo y bloqueo hasta Reabrir.', { importancia: 3 });
          return { ok: true, mensaje: `Kill switch: ${cerradas.length} posiciones cerradas, fondo bloqueado.`, datos: { cerradas: Array.from(new Set(cerradas)), errores: [] } };
        }
        case 'ajustes': {
          if (!cuerpo || !Object.keys(c).length) return { ok: true, mensaje: '', datos: datosAjustes() };
          const errores = [];
          if (c.presupuestoDiaUsd !== undefined) {
            const v = Number(c.presupuestoDiaUsd);
            if (Number.isFinite(v) && v >= 0 && v <= 100) presupuesto = v; else errores.push('presupuesto entre 0 y 100 $');
          }
          if (c.modeloComite !== undefined) { if (MODELOS.includes(c.modeloComite)) modeloComite = c.modeloComite; else errores.push('modelo del comité desconocido'); }
          if (c.modeloAgentes !== undefined) { if (MODELOS.includes(c.modeloAgentes)) modeloAgentes = c.modeloAgentes; else errores.push('modelo de agentes desconocido'); }
          if (c.velocidad !== undefined) {
            const v = Number(c.velocidad);
            if (Number.isFinite(v) && v >= 1 && v <= 3600) velocidad = v; else errores.push('velocidad entre 1 y 3.600');
          }
          if (errores.length) return { ok: false, mensaje: `No se guardó: ${errores.join('; ')}.`, datos: datosAjustes() };
          return { ok: true, mensaje: 'Ajustes guardados.', datos: datosAjustes() };
        }
        default:
          return { ok: false, mensaje: `Comando desconocido: ${nombre}` };
      }
    }

    function destellosDesde(t) { return destellos.filter(d => d.t >= t); }

    return {
      instantanea, avanzar, comando, destellosDesde,
      get ahora() { return ahora; },
      _interno: { patrimonio, efectivo: () => efectivo, puestos, agentes, comisionesTotales: () => comisionesTotales },
    };
  }

  // Fuente de datos para el navegador con la misma interfaz que la real.
  function fuente(manejadores, opciones) {
    const o = opciones || {};
    const sim = crearMaqueta({ semilla: o.semilla, ahora: Date.now() });
    let ultimo = Date.now();
    const repartir = (evs) => {
      for (const e of evs) if (manejadores[e.tipo]) manejadores[e.tipo](e.datos);
    };
    setTimeout(() => {
      if (manejadores.conexion) manejadores.conexion(true);
      manejadores.estado(sim.instantanea());
    }, 30);
    const reloj = setInterval(() => {
      const t = Date.now();
      repartir(sim.avanzar(Math.min(5000, t - ultimo)));
      ultimo = t;
    }, 250);
    const espera = ms => new Promise(r => setTimeout(r, ms));
    return {
      nombre: 'maqueta',
      async comando(nombre, cuerpo) {
        await espera(250);
        const r = sim.comando(nombre, cuerpo);
        repartir(sim.avanzar(1));
        manejadores.estado(sim.instantanea());
        return r;
      },
      async ajustes() { await espera(120); return sim.comando('ajustes'); },
      parar() { clearInterval(reloj); },
    };
  }

  return { crearMaqueta, fuente, DEPARTAMENTOS, LIMITES, MODELOS };
});
