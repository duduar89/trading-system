// Maqueta: una mesa inventada para trabajar la interfaz sin servidor (?maqueta=1
// o abriendo index.html como fichero). Genera la instantánea con la forma EXACTA
// de §7 (también los campos del 30-sep-2026: genero y queHace de cada agente,
// explicación y backtest de cada mesa, respondeA e hilo de cada mensaje) y la va
// cambiando: precios, mensajes en llano, operaciones que son conversaciones
// (señal → Riesgos → Ejecutor → cierre → lección) con su monitor en ámbar, un
// comité y reuniones informativas que llevan a los jefes a su sala y los
// devuelven, descansos, y responde a los comandos de la botonera (el Megáfono,
// también como conversación).
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

  // Como src/agentes/registro.js (DEPARTAMENTOS, con su «queHace» llano para la
  // pestaña Equipo): test/parque-maqueta.test.js comprueba que son iguales.
  const DEPARTAMENTOS = [
    { id: 'direccion', nombre: 'Dirección', color: '#f5b942', sala: 'direccion',
      queHace: 'Preside el comité: decide si el fondo sigue normal, va con la mitad de tamaño o solo cierra posiciones.' },
    { id: 'macro', nombre: 'Macro', color: '#8b5cf6', sala: 'macro',
      queHace: 'Lee el ambiente del mercado en conjunto (apetito, neutral o miedo) y pide prudencia cuando hay miedo.' },
    { id: 'analisis', nombre: 'Análisis', color: '#22c55e', sala: 'analisis',
      queHace: 'Un analista por activo: sigue su precio cada hora y escribe una nota para los demás. No compran ni venden.' },
    { id: 'mesas', nombre: 'Mesas', color: '#3b82f6', sala: 'parque',
      queHace: 'Los operadores: cada uno aplica la regla de su estrategia a un activo y propone comprar o vender.' },
    { id: 'riesgos', nombre: 'Riesgos', color: '#ef4444', sala: 'riesgos',
      queHace: 'Revisa cada orden antes de que salga contra los límites de seguridad: la aprueba, la recorta o la prohíbe.' },
    { id: 'operaciones', nombre: 'Operaciones', color: '#f97316', sala: 'riesgos',
      queHace: 'Manda al bróker las órdenes aprobadas y lleva las cuentas del fondo, comparándolas con las del bróker.' },
    { id: 'laboratorio', nombre: 'Laboratorio', color: '#06b6d4', sala: 'laboratorio',
      queHace: 'Prueba estrategias nuevas con precios del pasado y repasa por qué se ganó o se perdió en cada operación.' },
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
    { simbolo: 'BTC/USD', etiqueta: 'BTC', nombre: 'Bitcoin', precio: 83547, var24: 0.0132, vol: 0.00055 },
    { simbolo: 'ETH/USD', etiqueta: 'ETH', nombre: 'Ethereum', precio: 2651.4, var24: 0.0214, vol: 0.0007 },
    { simbolo: 'SOL/USD', etiqueta: 'SOL', nombre: 'Solana', precio: 142.37, var24: -0.0087, vol: 0.0009 },
    { simbolo: 'LINK/USD', etiqueta: 'LINK', nombre: 'Chainlink', precio: 14.182, var24: 0.0046, vol: 0.0009 },
    { simbolo: 'AVAX/USD', etiqueta: 'AVAX', nombre: 'Avalanche', precio: 21.43, var24: -0.0154, vol: 0.001 },
    { simbolo: 'DOGE/USD', etiqueta: 'DOGE', nombre: 'Dogecoin', precio: 0.1234, var24: 0.0311, vol: 0.0012 },
  ];
  const POR_ETIQUETA = Object.fromEntries(ACTIVOS.map(a => [a.etiqueta, a]));

  // Como en el arranque real (src/estrategias/index.js, 30-sep-2026): una
  // titular al 40 % (techo del asignador) y tres en incubación al 2 %; el 54 %
  // queda sin asignar, en efectivo. Mismos parámetros que las reales y la misma
  // explicación en llano que da explicarMesa (lo comprueba parque-maqueta).
  // `backtest` es el de referencia (§7): inventado, como todo aquí, pero con el
  // Sharpe de la nota; Ruptura aún no lo tiene (para ver ese caso en pantalla).
  const RIESGO_STOP = 'El stop lo vigila la mesa en cada latido, no el bróker: con la mesa parada no hay stop. Cada compra se dimensiona para perder como mucho el 1 % del fondo si salta el stop.';
  const MESAS = [
    { id: 'tendencia', nombre: 'Tendencia SMA', familia: 'tendencia-sma', marco: '4Hour', universo: ['BTC', 'ETH', 'SOL'],
      params: { rapida: 7, lenta: 25, filtro: 200, atr: 14, atrStop: 2.5 }, peso: 0.02, estado: 'incubacion',
      nota: 'Backtest real 2021-2026 con costes: Sharpe −0,53. Empieza en prueba con el 2 %.',
      backtest: { sharpe: -0.53, maxDD: 0.312, operaciones: 388, rentabilidad: -0.27, vol: 0.29, dias: 1826 },
      explicacion: {
        queMira: 'Mira BTC, ETH y SOL en velas de 4 horas y compara dos medias del precio: la de las últimas 7 velas (rápida) y la de las últimas 25 (lenta). Una media es el precio promedio de ese tramo: suaviza los vaivenes.',
        cuandoCompra: 'Compra cuando la media rápida pasa por encima de la lenta (el precio empieza a subir con fuerza) y además el precio está por encima de su media de 200 velas (la tendencia de fondo también es alcista).',
        cuandoVende: 'Vende cuando la media rápida vuelve a caer por debajo de la lenta, o si salta el stop (precio de salida de emergencia) a 2,5 veces el movimiento típico de 14 velas (ATR) por debajo; ese stop sube con el precio y nunca baja.',
        cuandoNada: 'Sin cruce hacia arriba, o con el precio por debajo de la media larga, no hace nada y espera en efectivo.',
        riesgo: `Opera a menudo y paga comisión en cada compra y venta; en mercados de lado da muchas señales falsas. ${RIESGO_STOP}`,
        filtros: null,
      } },
    { id: 'momentum', nombre: 'Momentum cripto', familia: 'momentum-rotacion', marco: '1Day', universo: ['BTC', 'ETH', 'SOL', 'LINK', 'AVAX', 'DOGE'],
      params: { perfil: 'cripto', lookbacks: [28], ajustarVol: true, top: 2, rebalanceo: 'semanal', soloPositivos: true, atr: 14, atrStop: 3 }, peso: 0.4, estado: 'titular',
      nota: 'Backtest real 2021-2026 con costes: Sharpe 0,91 frente a 0,63 de comprar y mantener. Única titular.',
      backtest: { sharpe: 0.91, maxDD: 0.214, operaciones: 212, rentabilidad: 1.84, vol: 0.38, dias: 1826 },
      explicacion: {
        queMira: 'Mira BTC, ETH, SOL, LINK, AVAX y DOGE (6) y los ordena por cuánto han subido en los últimos 28 días, descontando lo nerviosos que son (la subida se divide por su volatilidad: un activo que sube a trompicones puntúa menos).',
        cuandoCompra: 'Cada lunes compra los 2 que más han subido (momentum: lo que sube tiende a seguir subiendo un tiempo), pero solo si de verdad ha subido: si todos bajan, se queda en efectivo.',
        cuandoVende: 'Cada lunes vende lo que ya no está entre los 2 primeros o ha dejado de subir. Entre medias solo vende si salta el stop de emergencia, a 3 veces el movimiento típico de 14 días (ATR) por debajo de la compra.',
        cuandoNada: 'De martes a domingo no toca nada: mantiene lo que tiene.',
        riesgo: `Llega tarde a los giros: cuando el mercado se da la vuelta, aguanta hasta el siguiente lunes o hasta el stop. Con pocos activos elegidos, el resultado depende mucho de ellos. ${RIESGO_STOP}`,
        filtros: null,
      } },
    { id: 'reversion', nombre: 'Reversión RSI', familia: 'reversion-rsi', marco: '1Day', universo: ['BTC', 'ETH'],
      params: { rsi: 2, umbral: 10, filtro: 200, salidaSma: 5, maxBarras: 5, atr: 14, atrStop: 3 }, peso: 0.02, estado: 'incubacion',
      nota: 'Backtest real 2021-2026 con costes: Sharpe −0,36. Empieza en prueba con el 2 %.',
      backtest: { sharpe: -0.36, maxDD: 0.19, operaciones: 141, rentabilidad: -0.12, vol: 0.17, dias: 1826 },
      explicacion: {
        queMira: 'Mira BTC y ETH una vez al día. Usa el RSI de 2 días (un medidor de 0 a 100 de cuánto ha caído o subido en muy poco tiempo) y la media del precio de 200 días.',
        cuandoCompra: 'Compra cuando el RSI baja de 10 (ha caído muy deprisa, está «sobrevendido») pero el precio sigue por encima de su media de 200 días: apuesta a que un bajón brusco dentro de una subida de fondo rebota.',
        cuandoVende: 'Vende en cuanto el cierre supera la media de 5 días (el rebote ya llegó), o a las 5 velas si no ha rebotado, o si salta el stop (salida de emergencia) a 3 veces el movimiento típico de 14 días (ATR) por debajo de la compra.',
        cuandoNada: 'Si no hay caída brusca, o el precio está por debajo de su media de 200 días (tendencia bajista), no hace nada.',
        riesgo: `Compra cuando el precio cae: si la caída sigue, pierde hasta el stop. Gana poco muchas veces y pierde más alguna vez. ${RIESGO_STOP}`,
        filtros: null,
      } },
    { id: 'ruptura', nombre: 'Ruptura Donchian', familia: 'ruptura-donchian', marco: '1Day', universo: ['BTC', 'ETH', 'SOL'],
      params: { entrada: 20, salida: 10, atr: 20, atrStop: 2 }, peso: 0.02, estado: 'incubacion',
      nota: 'Correlación diaria con Momentum 0,80: juntas, Sharpe 0,58 y caída 26,0 %; Momentum sola, 0,72 y 11,2 %. No diversifica: empieza en prueba con el 2 %.',
      backtest: null,
      explicacion: {
        queMira: 'Mira BTC, ETH y SOL una vez al día: el precio más alto de los últimos 20 días y el más bajo de los últimos 10.',
        cuandoCompra: 'Compra cuando el precio cierra por encima del máximo de los 20 días anteriores (rompe el techo): apuesta a que una subida que rompe récords sigue.',
        cuandoVende: 'Vende cuando cierra por debajo del mínimo de los 10 días anteriores, o si salta el stop (salida de emergencia) a 2 veces el movimiento típico de 20 días (ATR) por debajo de la compra.',
        cuandoNada: 'Mientras el precio no rompa el techo, no compra; con posición, la mantiene mientras no rompa el suelo.',
        riesgo: `Muchas rupturas fallan y vuelven atrás: pierde poco muchas veces y gana mucho pocas. ${RIESGO_STOP}`,
        filtros: null,
      } },
  ];
  // Días en marcha de todas las mesas: las cuatro arrancaron con el fondo
  // (el mismo día que el semáforo, 41 días).
  const DIAS_FONDO = 41;

  // Como FIJOS de src/agentes/registro.js (con `genero` para la cara y
  // `queHace` en llano): parque-maqueta comprueba que coinciden.
  const FIJOS = [
    { id: 'cio', nombre: 'Carmen Aguirre', genero: 'f', departamento: 'direccion', rol: 'Presidenta del comité', usaLLM: true,
      queDecide: 'Modo del fondo (NORMAL, DEFENSIVO o SOLO_CERRAR), multiplicadores por mesa de {0; 0,5; 1} y vetos de 24 h. Nunca toca los límites duros.',
      queHace: 'Preside la reunión del comité cada 4 horas: escucha a los jefes y decide si el fondo sigue normal, va con la mitad de tamaño o solo cierra. No puede saltarse los límites de seguridad.' },
    { id: 'macro', nombre: 'Tomás Herrera', genero: 'm', departamento: 'macro', rol: 'Estratega macro', usaLLM: false,
      queDecide: 'Régimen RISK-ON, NEUTRAL o RISK-OFF por regla fija (BTC y SPY frente a sus medias, volatilidad; VIXY si hay dato). Vota DEFENSIVO en RISK-OFF.',
      queHace: 'Mira el mercado en conjunto (si el bitcoin y la bolsa van por encima de su media, si hay nervios) y dice si el ambiente es de apetito, neutral o de miedo. Con miedo, pide prudencia en el comité.' },
    { id: 'riesgos', nombre: 'Marta Solís', genero: 'f', departamento: 'riesgos', rol: 'Jefa de riesgos', usaLLM: false,
      queDecide: 'Aprueba, recorta o veta cada orden contra los límites duros. Su voto DEFENSIVO en el comité es veto.',
      queHace: 'Revisa cada compra antes de que salga: si arriesga demasiado la recorta o la prohíbe. Vigila las pérdidas del día y la caída del fondo, y si se pasan de la raya para todo.' },
    { id: 'ejecutor', nombre: 'Raúl Campos', genero: 'm', departamento: 'operaciones', rol: 'Ejecutor', usaLLM: false,
      queDecide: 'Nada de qué comprar: envía las órdenes aprobadas, espera la ejecución y no repite una orden ya enviada.',
      queHace: 'Manda al bróker las compras y ventas ya aprobadas y comprueba que se han hecho. No elige qué comprar: solo ejecuta, y nunca manda dos veces la misma orden.' },
    { id: 'controller', nombre: 'Inés Ferrer', genero: 'f', departamento: 'operaciones', rol: 'Controller', usaLLM: false,
      queDecide: 'Nada operativo: patrimonio, P&L, caída, exposición y conciliación con el bróker en cada latido.',
      queHace: 'Lleva las cuentas: cuánto vale el fondo, cuánto gana o pierde hoy y cuánto está invertido. Cada minuto comprueba que lo que dicen nuestros libros coincide con lo que tiene el bróker.' },
    { id: 'laboratorio', nombre: 'Álvaro Medina', genero: 'm', departamento: 'laboratorio', rol: 'Director de laboratorio', usaLLM: false,
      queDecide: 'Qué variantes se prueban (gramática cerrada) y si pasan las puertas del walk-forward para entrar en incubación.',
      queHace: 'Inventa cada semana variantes de las estrategias y las prueba con años de precios pasados, por tramos que no ha visto al diseñarlas. Solo aprueba las que pasan seis exámenes; las aprobadas empiezan en prueba con poco dinero.' },
    { id: 'auditor', nombre: 'Julián Prieto', genero: 'm', departamento: 'laboratorio', rol: 'Auditor post-mortem', usaLLM: true,
      queDecide: 'La categoría de cada operación cerrada, de una lista cerrada, y la lección en una frase con cifras comprobadas.',
      queHace: 'Repasa cada noche las operaciones cerradas: por qué se ganó o se perdió (señal falsa, stop demasiado cerca, ir contra el mercado…) y apunta la lección. Sus pistas alimentan al laboratorio.' },
  ];
  const NOMBRES_ANALISTAS = [['Lucía Romero', 'f'], ['Hugo Navarro', 'm'], ['Sofía Torres', 'f'], ['Mateo Ramos', 'm'], ['Paula Gil', 'f'], ['Daniel Serrano', 'm']];
  const NOMBRES_OPERADORES = [
    ['Elena Molina', 'f'], ['Pablo Ortega', 'm'], ['Irene Delgado', 'f'], ['Adrián Castro', 'm'], ['Claudia Ortiz', 'f'],
    ['Javier Rubio', 'm'], ['Nerea Marín', 'f'], ['Sergio Sanz', 'm'], ['Alba Iglesias', 'f'], ['Marcos Núñez', 'm'],
    ['Noelia Garrido', 'f'], ['Diego Cortés', 'm'], ['Rocío Lozano', 'f'], ['Iván Guerrero', 'm'],
  ];
  const JEFES_COMITE = ['cio', 'controller', 'macro', 'riesgos', 'laboratorio'];
  // Como plantillas.MODO_TEXTO: el modo del comité con lo que significa al lado.
  const MODO_TEXTO = { NORMAL: 'compras a tamaño normal', DEFENSIVO: 'compras nuevas a la mitad', SOLO_CERRAR: 'no se abre nada, solo se cierra' };

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
  const pd = (x) => `${prec(x)} $`;   // un precio con su unidad, como px() de las plantillas
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
      id: `analista-${a.etiqueta}`, nombre: NOMBRES_ANALISTAS[i][0], genero: NOMBRES_ANALISTAS[i][1], departamento: 'analisis', rol: `Analista de ${a.etiqueta}`, usaLLM: true,
      queDecide: `Nada operativo: nota técnica de ${a.etiqueta} (sesgo, SMA50, RSI, volatilidad) con cifras del código; el LLM solo la redacta.`,
      queHace: `Sigue ${a.etiqueta} cada hora: si va por encima o por debajo de su media, si viene con fuerza y lo nervioso que está. Escribe una nota para los demás; no compra ni vende.`,
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
          id: agenteId, nombre, genero, departamento: 'mesas', rol: `${genero === 'f' ? 'Operadora' : 'Operador'} de ${m.nombre} · ${e}`, usaLLM: false,
          queDecide: `Abrir, mantener o cerrar ${e} según la regla de ${m.familia}; el tamaño lo fija el código y lo aprueba Riesgos.`,
          queHace: `Aplica la estrategia de ${m.nombre} a ${e}: cuando la regla lo dice, propone comprar o vender. No decide cuánto: eso lo calcula el código y lo revisa Riesgos.`,
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

    // Como bus.publicar (§6.2): `para` (id, 'humano' o 'todos'), `respondeA`
    // (un mensaje o su id) e `hilo` (true abre una conversación con el propio
    // id; sin hilo pero con respondeA, el del mensaje al que contesta, o ese
    // mismo mensaje si iba suelto).
    const mensajePorId = new Map();
    function decir(de, canal, tipo, texto, extra) {
      const e = extra || {};
      const ag = agentePorId.get(de);
      const id = `m-${++nMensaje}`;
      const previo = e.respondeA ? (typeof e.respondeA === 'object' ? e.respondeA : mensajePorId.get(e.respondeA)) : null;
      const respondeA = e.respondeA ? (typeof e.respondeA === 'object' ? e.respondeA.id : String(e.respondeA)) : null;
      const hilo = e.hilo === true ? id : (typeof e.hilo === 'string' ? e.hilo : (respondeA ? (previo ? (previo.hilo || previo.id) : respondeA) : null));
      const m = {
        id, t: e.t || ahora, de, deNombre: ag ? ag.nombre : (e.deNombre || 'Sistema'),
        departamento: ag ? ag.departamento : null, para: e.para || 'todos', respondeA, hilo, canal, tipo, texto,
        datos: e.datos || null, importancia: e.importancia || 1, costeUsd: e.costeUsd || 0,
      };
      mensajes.push(m);
      mensajePorId.set(id, m);
      if (mensajes.length > 150) mensajePorId.delete(mensajes.shift().id);
      if (ag && !e.sinBocadillo) ag.bocadillo = { texto, hasta: m.t + Math.min(12000, 6000 + 60 * texto.length) };
      if (!e.silencioso) emitir('mensaje', m);
      if (e.costeUsd) gastoLLM += e.costeUsd;
      return m;
    }
    const pila = (id) => { const a = agentePorId.get(id); return a ? a.nombre.split(' ')[0] : ''; };

    function moverAgente(id, sala, estado) {
      const a = agentePorId.get(id);
      if (!a) return;
      a.sala = sala;
      a.estado = estado;
      emitir('agente', { id: a.id, estado: a.estado, sala: a.sala, bocadillo: a.bocadillo });
    }

    const elegir = (lista) => lista[Math.floor(rnd() * lista.length)];

    // ----- mensajes de ambiente (en llano, como src/agentes/plantillas.js) -----
    const mesaDe = (p) => MESAS.find(m => m.id === p.mesaId);
    const stopPctDe = (p) => { const f = mesaDe(p).familia; return f === 'tendencia-sma' ? 0.06 : f === 'ruptura-donchian' ? 0.07 : 0.08; };
    function textoEstadoPuesto(p) {
      const e = p.etiqueta;
      const px = precios[e];
      if (p.posicion) {
        const voy = px * p.posicion.cantidad / p.posicion.nocional - 1;
        return `Tengo ${cant(p.posicion.cantidad)} ${e} comprados a ${pd(p.posicion.entrada)}; voy ${pct(voy, 2, true)}. Si cae a ${pd(p.posicion.stop)}, vendo (stop).`;
      }
      switch (mesaDe(p).familia) {
        case 'tendencia-sma': return `No tengo ${e}. Compro cuando su media de 7 velas de 4 horas cruce por encima de la de 25 con el precio sobre su media de 200.`;
        case 'momentum-rotacion': return `No tengo ${e}: es el ${3 + Math.floor(rnd() * 4)}.º de 6 por lo que ha subido en 28 días, descontando lo que se mueve. Solo compro los 2 primeros; vuelvo a repartir el lunes.`;
        case 'reversion-rsi': return `No tengo ${e}. Compro tras una caída brusca (RSI por debajo de 10 de 100; ahora ${nf(1).format(20 + rnd() * 60)}) con el precio sobre su media de 200 días.`;
        default: return `No tengo ${e}. Compro si cierra por encima de ${pd(px * (1.02 + rnd() * 0.05))}, su máximo de los últimos 20 días.`;
      }
    }
    // Lo que dice el operador al abrir o cerrar (la regla de su estrategia).
    function textoEntrada(p, stop) {
      const e = p.etiqueta;
      const px = precios[e];
      switch (mesaDe(p).familia) {
        case 'tendencia-sma': return `Mi regla dice comprar ${e}: su media de 7 velas ha cruzado por encima de la de 25 (${pd(px * 0.99)}) y el precio sigue sobre su media de 200 (${pd(px * 0.9)}). Si cae a ${pd(stop)}, vendo (stop).`;
        case 'momentum-rotacion': return `Reparto de nuevo y mi regla dice comprar ${e}: es de los 2 que más han subido en 28 días. Si cae a ${pd(stop)}, vendo (stop).`;
        case 'reversion-rsi': return `Mi regla dice comprar ${e}: ha caído muy deprisa (RSI ${nf(1).format(3 + rnd() * 6)} de 100, por debajo de 10) pero sigue sobre su media de 200 días. Espero un rebote. Si cae a ${pd(stop)}, vendo (stop).`;
        default: return `Mi regla dice comprar ${e}: ha cerrado en ${pd(px)}, por encima del máximo de los 20 días anteriores (${pd(px * 0.985)}). Si cae a ${pd(stop)}, vendo (stop).`;
      }
    }
    function textoSalida(p) {
      const e = p.etiqueta;
      const px = precios[e];
      switch (mesaDe(p).familia) {
        case 'tendencia-sma': return `Mi regla dice vender ${e}: su media de 7 velas ha caído por debajo de la de 25 (${pd(px * 1.005)}); la subida se ha acabado.`;
        case 'momentum-rotacion': return `Reparto de nuevo y mi regla dice vender ${e}: ya no está entre los 2 que más han subido en 28 días.`;
        case 'reversion-rsi': return `Mi regla dice vender ${e}: el precio (${pd(px)}) ya ha vuelto por encima de su media de 5 días; el rebote está hecho.`;
        default: return `Mi regla dice vender ${e}: ha cerrado en ${pd(px)}, por debajo del mínimo de los 10 días anteriores (${pd(px * 1.01)}).`;
      }
    }

    function ambiente() {
      const r = rnd();
      if (r < 0.34) {
        const p = elegir(puestos.filter(x => agentePorId.get(x.agenteId).sala === 'parque' && !x._enCurso));
        if (!p) return;
        const texto = textoEstadoPuesto(p);
        p.estadoTexto = texto;
        p.ultimaSenal = { accion: p.posicion ? 'mantener' : 'nada', t: ahora };
        decir(p.agenteId, 'parque', 'estado', texto, { datos: { puestoId: p.id } });
      } else if (r < 0.54) {
        const a = elegir(ACTIVOS);
        const px = precios[a.etiqueta];
        const sube = rnd() < 0.62;
        const rsi = Math.round(sube ? 52 + rnd() * 24 : 26 + rnd() * 22);
        const ritmo = rsi >= 70 ? `Ojo: ha subido muy deprisa (RSI ${rsi} de 100) y podría tomarse un respiro.`
          : rsi <= 30 ? `Ojo: ha caído muy deprisa (RSI ${rsi} de 100) y podría rebotar.`
            : `Sube y baja a un ritmo normal (RSI ${rsi} de 100, velas de 4 horas).`;
        decir(`analista-${a.etiqueta}`, 'analisis', 'nota',
          `${a.nombre} vale ${pd(px)} y ${sube ? 'sigue en subida' : 'sigue de bajada'}: está por ${sube ? 'encima' : 'debajo'} de su precio medio de los últimos 50 días (${pd(px * (sube ? 0.96 : 1.03))}). ${ritmo}`,
          { costeUsd: 0.0021, datos: { simbolo: a.simbolo, sesgo: sube ? 'alcista' : 'bajista' } });
      } else if (r < 0.62) {
        decir('macro', 'macro', 'regimen', `Ambiente del mercado: RISK-ON (+2 puntos), el mercado acompaña. Motivos: el bitcoin (${pd(precios.BTC)}) va por encima de su media de 200 días (${pd(precios.BTC * 0.88)}); su tendencia de fondo es al alza.`,
          { importancia: 2 });
      } else if (r < 0.7) {
        const c = cabecera();
        decir('riesgos', 'riesgo', 'nota', `Lo invertido en total es el ${pct(c.exposicionBrutaPct, 0)}, de un máximo de 80 %; en cripto, el ${pct(c.exposicionCriptoPct, 0)}, de un máximo de 50 %. Nada cerca de sus límites.`);
      } else if (r < 0.77) {
        const c = cabecera();
        decir('controller', 'riesgo', 'nota', `El fondo vale ${usd(c.patrimonio)}; hoy vamos ${usd(c.pnlDia, true)} (${pct(c.pnlDiaPct, 2, true)}). Nuestros libros cuadran con el bróker.`);
      } else if (r < 0.82) {
        decir('ejecutor', 'ejecucion', 'nota', 'No tengo órdenes en cola. El bróker simulado contesta en 0,2 s.');
      } else if (r < 0.88) {
        decir('laboratorio', 'laboratorio', 'nota', 'Sigo con la idea H-38 (Tendencia SMA que no compra con miedo en el mercado): de momento pasa 5 de 6 tramos del examen.');
      } else {
        decir('cio', 'direccion', 'nota', `Sin cambios hasta el comité de las ${hora(proximoComite)}. Seguimos en modo ${modoComite} (${MODO_TEXTO[modoComite]}).`);
      }
    }

    // ----- operaciones: cada una es una conversación del puesto (§6.2) -----
    function flash(puestoId, tipo) { destellos.push({ puestoId, tipo, t: ahora }); }

    // Sigue la conversación del puesto (contesta a lo último que se dijo en
    // ella) o, si no hay, la abre.
    function enHilo(p, de, canal, tipo, texto, extra) {
      const o = Object.assign({ datos: { puestoId: p.id } }, extra || {});
      if (p._conv) o.respondeA = p._conv.ultimo; else o.hilo = true;
      const m = decir(de, canal, tipo, texto, o);
      p._conv = { hilo: m.hilo, ultimo: m };
      return m;
    }

    function operacion() {
      if (fondo.nivel !== 'normal' && fondo.nivel !== 'solo_cerrar' && fondo.nivel !== 'pausado') return;
      const enParque = puestos.filter(p => agentePorId.get(p.agenteId).sala === 'parque' && !p._enCurso);
      const abiertas = enParque.filter(p => p.posicion);
      const libres = enParque.filter(p => !p.posicion && !directivas.activosVetados.some(v => v.simbolo === p.simbolo));
      const cerrar = fondo.nivel !== 'normal' || (abiertas.length >= 7) || (abiertas.length && rnd() < 0.4) || !libres.length;
      const jefa = pila('riesgos');
      if (cerrar && abiertas.length) {
        const p = elegir(abiertas);
        const e = p.etiqueta;
        const op = pila(p.agenteId);
        p._enCurso = true;
        enHilo(p, p.agenteId, 'parque', 'senal', textoSalida(p), { importancia: 2 });
        p.ultimaSenal = { accion: 'cerrar', t: ahora };
        programar(700, () => { if (p.posicion) enHilo(p, p.agenteId, 'parque', 'propuesta', `${jefa}, quiero vender mis ${cant(p.posicion.cantidad)} ${e} a ${pd(precios[e])}.`, { para: 'riesgos', importancia: 2 }); });
        programar(1300, () => { if (p.posicion) enHilo(p, 'riesgos', 'riesgo', 'aprobacion', `${op}, adelante con la venta de ${cant(p.posicion.cantidad)} ${e}.`, { para: p.agenteId }); });
        programar(2000, () => {
          if (!p.posicion) return;
          enHilo(p, 'ejecutor', 'ejecucion', 'orden', `Recibido, ${op} y ${jefa}: mando al bróker la venta de ${cant(p.posicion.cantidad)} ${e} a precio de mercado.`, { para: p.agenteId });
          flash(p.id, 'orden');
        });
        programar(3200, () => { p._enCurso = false; cerrarPosicion(p, 'señal'); });
        return;
      }
      if (!libres.length) return;
      const p = elegir(libres);
      const e = p.etiqueta;
      const op = pila(p.agenteId);
      const noc = Math.round(1200 + rnd() * 2200);
      const px = precios[e];
      const stop = px * (1 - stopPctDe(p));
      p._conv = null;          // una compra abre conversación nueva
      p._enCurso = true;
      enHilo(p, p.agenteId, 'parque', 'senal', textoEntrada(p, stop), { importancia: 2 });
      p.ultimaSenal = { accion: 'abrir', t: ahora };
      programar(700, () => enHilo(p, p.agenteId, 'parque', 'propuesta', `${jefa}, quiero comprar ${usd(noc)} de ${e} a ${pd(px)}. Si cae a ${pd(stop)}, salgo (stop).`, { para: 'riesgos', importancia: 2 }));
      if (rnd() < 0.18) {
        programar(1300, () => {
          vetosPeriodo++;
          enHilo(p, 'riesgos', 'riesgo', 'veto', `${op}, no puedo aprobar la compra de ${e}: lo invertido en cripto pasaría del máximo del 50 %.`, { para: p.agenteId, importancia: 3 });
          flash(p.id, 'veto');
          p._conv = null;      // una compra vetada acaba ahí su conversación
          p._enCurso = false;
        });
        return;
      }
      programar(1300, () => enHilo(p, 'riesgos', 'riesgo', 'aprobacion', `${op}, aprobado: ${usd(noc)} de ${e}, dentro de los límites.`, { para: p.agenteId }));
      programar(2200, () => {
        enHilo(p, 'ejecutor', 'ejecucion', 'orden', `Recibido, ${op} y ${jefa}: mando al bróker la compra de ${usd(noc)} de ${e} a precio de mercado.`, { para: p.agenteId });
        flash(p.id, 'orden');
      });
      programar(3400, () => {
        p._enCurso = false;
        if (p.posicion || fondo.nivel === 'bloqueado') { p._conv = null; return; }
        const r = abrir(p, noc, (rnd() - 0.5) * 0.001);
        const ej = { t: ahora, puestoId: p.id, simbolo: p.simbolo, etiqueta: e, lado: 'compra', cantidad: r.cantidad, precio: r.precio,
          nocional: noc, comision: r.comision, motivo: 'señal' };
        registrarEjecucion(ej);
        enHilo(p, 'ejecutor', 'ejecucion', 'ejecucion', `${op}, hecho: he comprado ${cant(r.cantidad)} ${e} a ${pd(r.precio)} (${usd(noc)}). Comisión: ${usd(r.comision)}.`, { para: p.agenteId });
        p.estadoTexto = textoEstadoPuesto(p);
      });
    }

    function registrarEjecucion(ej) {
      ejecuciones.unshift(ej);
      if (ejecuciones.length > 30) ejecuciones.pop();
      emitir('ejecucion', ej);
    }

    const cerradasHoy = { n: 0, ganadoras: 0, pnl: 0 };
    const MOTIVO_CIERRE = { 'señal': 'por la señal de mi regla', stop: 'por el stop', kill: 'por el kill switch' };
    // La lección del Auditor, por reglas (§6.6), en llano y con las cifras de SU operación.
    function leccionDe(p, pnl, barras, motivo) {
      const sobre = `${pila(p.agenteId)}, sobre tu operación en ${p.etiqueta} (${mesaDe(p).nombre})`;
      if (pnl > 0) return motivo === 'señal' ? `${sobre}: acierto de libro. La regla entró y salió cuando tocaba, y ganó ${usd(pnl)}.` : `${sobre}: ganó ${usd(pnl)}, pero salió por el stop: más suerte que regla.`;
      if (motivo === 'stop' && barras <= 2) return `${sobre}: el stop estaba demasiado cerca. Saltó en ${barras} vela${barras === 1 ? '' : 's'} y perdió ${usd(-pnl)}.`;
      return `${sobre}: la señal no se confirmó. La regla dio entrada, pero el precio no siguió y perdió ${usd(-pnl)}.`;
    }

    function cerrarPosicion(p, motivo) {
      if (!p.posicion) return null;
      const e = p.etiqueta;
      const px = precios[e];
      const q = p.posicion.cantidad;
      const stop = p.posicion.stop;
      const bruto = q * px;
      const comision = bruto * 0.0025;
      efectivo += bruto - comision;
      comisionesTotales += comision;
      const coste = p.posicion.nocional;
      const pnl = bruto - comision - coste;
      p._realizadoDia += pnl;
      p.operaciones += 1;
      cerradasHoy.n += 1;
      cerradasHoy.pnl += pnl;
      if (pnl > 0) cerradasHoy.ganadoras += 1;
      if (pnl > 0) { p._ganadas += 1; p._ganado += pnl; } else p._perdido += -pnl;
      if (motivo === 'señal' || motivo === 'stop') p._porRegla += 1;
      const barras = 1 + Math.floor(rnd() * 12);
      p.posicion = null;
      recalcular(p);
      const ej = { t: ahora, puestoId: p.id, simbolo: p.simbolo, etiqueta: e, lado: 'venta', cantidad: q, precio: px, nocional: bruto, comision, motivo };
      registrarEjecucion(ej);
      const op = pila(p.agenteId);
      if (motivo === 'stop') {
        p._conv = p._conv || null;
        enHilo(p, p.agenteId, 'parque', 'senal', `${e} ha caído a ${pd(px)} y ha tocado mi stop (${pd(stop)}): vendo ya a precio de mercado.`, { importancia: 2 });
      }
      enHilo(p, 'ejecutor', 'ejecucion', 'ejecucion', `${op}, hecho: he vendido ${cant(q)} ${e} a ${pd(px)} (${usd(bruto)}). Comisión: ${usd(comision)}.`, { para: p.agenteId });
      const conv = p._conv;
      programar(600, () => {
        const resultado = Math.abs(pnl) < 0.005 ? `ni gano ni pierdo (${usd(pnl)})` : `${pnl > 0 ? 'gano' : 'pierdo'} ${usd(Math.abs(pnl))}`;
        const texto = `He cerrado ${e} ${MOTIVO_CIERRE[motivo] || ''}: ${resultado} (${pct(pnl / coste, 2, true)}) en ${barras} vela${barras === 1 ? '' : 's'}.`;
        p.estadoTexto = texto;
        const cierre = decir(p.agenteId, 'parque', 'cierre', texto, { datos: { puestoId: p.id }, importancia: 2, respondeA: conv ? conv.ultimo : null });
        if (p._conv === conv) p._conv = null;
        // El Auditor contesta al cierre (en la mesa de verdad, en el cierre diario).
        if (motivo !== 'kill') {
          programar(4500, () => decir('auditor', 'laboratorio', 'leccion', leccionDe(p, pnl, barras, motivo),
            { para: p.agenteId, respondeA: cierre, costeUsd: 0.0034, datos: { puestoId: p.id } }));
        }
      });
      return pnl;
    }

    function recalcular(p) {
      p.acierto = p.operaciones ? p._ganadas / p.operaciones : null;
      p.factorBeneficio = p._perdido > 0 ? p._ganado / p._perdido : (p._ganado > 0 ? null : null);
      p.adherencia = p.operaciones ? p._porRegla / p.operaciones : null;
    }

    // ----- comité: una conversación; cada punto contesta al anterior (§6.8) -----
    let vetosPeriodo = 1;
    function vigentesMegafono() {
      const n = directivas.activosVetados.filter(v => v.motivo === 'Megáfono').length + directivas.mesasPausadas.length
        + (directivas.reduccion ? 1 : 0) + (directivas.soloCerrarHasta ? 1 : 0);
      const vig = n ? `hay ${n} ${n === 1 ? 'orden vigente' : 'órdenes vigentes'}` : 'no hay órdenes vigentes';
      return `${vig} y ${megafonoPendiente ? 'una propuesta pendiente de aplicar' : 'nada pendiente de aplicar'}`;
    }
    function comite() {
      if (comiteEnCurso || reunionEnCurso || fondo.nivel === 'bloqueado') return false;
      comiteEnCurso = true;
      for (const id of JEFES_COMITE) moverAgente(id, 'comite', 'reunion');
      let ultimo = decir('cio', 'comite', 'comite', `Abro el comité de las ${hora(ahora)}. Orden del día: siete puntos. ${pila('controller')}, empiezas tú.`,
        { importancia: 3, hilo: true, para: 'controller', datos: { motivo: 'programado' } });
      // Cada punto se redacta al publicarse (datos del momento) y da las gracias a quien habló antes.
      const turno = (retraso, de, tipo, texto, extra) => programar(retraso, () => {
        const antes = ultimo.de;
        const gracias = antes && antes !== de ? `Gracias, ${pila(antes)}. ` : '';
        ultimo = decir(de, 'comite', tipo, gracias + texto(),
          Object.assign({ importancia: 3, respondeA: ultimo, para: antes && antes !== de ? antes : 'todos' }, extra || {}));
      }, 'comite');
      turno(6500, 'controller', 'informe', () => {
        const c = cabecera();
        return `El fondo vale ${usd(c.patrimonio)}. Hoy vamos ${usd(c.pnlDia, true)} (${pct(c.pnlDiaPct, 2, true)}). Estamos un ${pct(Math.abs(c.caida))} por debajo del máximo y tenemos invertido el ${pct(c.exposicionBrutaPct, 0)} en ${c.posiciones} posiciones.`;
      });
      turno(9000, 'macro', 'voto', () => 'Por mi parte: el mercado está RISK-ON (+2 puntos): el mercado acompaña. Mi voto: NORMAL (compras a tamaño normal).');
      turno(11500, 'riesgos', 'voto', () => {
        const v = vetosPeriodo === 0 ? 'no he vetado ninguna orden' : `he vetado ${vetosPeriodo} ${vetosPeriodo === 1 ? 'orden' : 'órdenes'}`;
        return `El fondo está en nivel normal y ${v} desde el último comité. Mi voto: NORMAL (compras a tamaño normal).`;
      });
      turno(14000, 'cio', 'informe', () => {
        const porMesa = MESAS.map(m => ({ m, v: puestos.filter(p => p.mesaId === m.id).reduce((s, p) => s + p._realizadoDia, 0) })).sort((a, b) => b.v - a.v);
        const mejor = porMesa[0];
        const peor = porMesa[porMesa.length - 1];
        return `En las mesas, la que mejor va desde el último comité es ${mejor.m.nombre} (${usd(mejor.v, true)}) y la que peor, ${peor.m.nombre} (${usd(peor.v, true)}).`;
      });
      turno(16500, 'laboratorio', 'informe', () => `En el laboratorio tengo 1 idea en prueba y 0 aprobadas; llevamos ${laboratorio.ensayosTotales} ensayos.`);
      turno(18000, 'cio', 'informe', () => `Y por último, el megáfono: ${vigentesMegafono()}.`);
      turno(19500, 'cio', 'decision', () => `Decido: modo ${modoComite} (${MODO_TEXTO[modoComite]}).`, { costeUsd: 0.0184, datos: { modo: modoComite } });
      programar(24000, () => {
        for (const id of JEFES_COMITE) {
          const a = agentePorId.get(id);
          moverAgente(id, SALA_DE[a.departamento], fondo.nivel === 'bloqueado' ? 'de_pie' : 'trabajando');
        }
        comiteEnCurso = false;
        vetosPeriodo = 0;
        proximoComite = ahora + 70 * SEG;
      }, 'comite');
      return true;
    }

    // ----- reuniones informativas de las 9:00 y las 22:15 (§6.9) -----
    // Cuentan cómo va el fondo y no cambian nada. En la maqueta se alternan.
    let reunionEnCurso = false;
    let siguienteReunion = 'manana';
    let proximaReunion = inicio + 80 * SEG;
    const NOMBRE_REUNION = { manana: 'Reunión de la mañana', cierre: 'Cierre del día' };   // los de src/agentes/reuniones.js (CITAS)
    // Los turnos de cada reunión: quién habla y qué dice (con los datos del momento).
    function turnosReunion(tipo) {
      if (tipo === 'manana') {
        const conPosicion = puestos.filter(p => p.posicion).slice(0, 2);
        return [
          { de: 'controller', clave: 'noche', texto: () => { const c = cabecera(); return `El fondo vale ${usd(c.patrimonio)}: ${c.pnlDia >= 0 ? 'gana' : 'pierde'} ${usd(Math.abs(c.pnlDia))} (${pct(c.pnlDiaPct, 2, true)}) desde las 22:15. Esta noche no se ha cerrado ninguna operación.`; } },
          { de: 'macro', clave: 'macro', texto: () => 'El mercado está RISK-ON (+2 puntos): el mercado acompaña. El índice de miedo y codicia está en 70 de 100.' },
          { de: 'riesgos', clave: 'riesgos', texto: () => `El fondo está en nivel ${fondo.nivel === 'pausado' ? 'en pausa' : fondo.nivel === 'solo_cerrar' ? 'solo cerrar' : 'normal'}. Nada cerca de sus límites.` },
        ].concat(conPosicion.map(p => ({ de: p.agenteId, clave: `posicion-${p.id}`, sinGracias: true, texto: () => {
          const pos = p.posicion;
          if (!pos) return `Ya no tengo ${p.etiqueta}: la he cerrado hace un momento.`;
          const px = precios[p.etiqueta];
          return `Tengo ${cant(pos.cantidad)} ${p.etiqueta} comprados a ${pd(pos.entrada)}. Ahora vale ${pd(px)} y voy ${pct(px * pos.cantidad / pos.nocional - 1, 2, true)}. Mi stop está en ${pd(pos.stop)}.`;
        } })), [
          { de: 'cio', clave: 'resumen', texto: () => { const c = cabecera(); return `Resumen: el fondo vale ${usd(c.patrimonio)}, con ${c.posiciones} posiciones abiertas y en modo ${modoComite} (${MODO_TEXTO[modoComite]}). El próximo comité, a las ${hora(proximoComite)}. Buen día a todos.`; } },
        ]);
      }
      return [
        { de: 'controller', clave: 'resultado', texto: () => { const c = cabecera(); return `Hoy (desde las 02:00) el fondo ${c.pnlDia >= 0 ? 'gana' : 'pierde'} ${usd(Math.abs(c.pnlDia))} (${pct(c.pnlDiaPct, 2, true)}) y vale ${usd(c.patrimonio)}.`; } },
        { de: 'controller', clave: 'cerradas', texto: () => {
          const n = cerradasHoy.n;
          if (!n) return 'Hoy no se ha cerrado ninguna operación.';
          return `Hoy se ${n === 1 ? 'ha cerrado 1 operación' : `han cerrado ${n} operaciones`}: ${cerradasHoy.ganadoras} con ganancia, ${usd(cerradasHoy.pnl, true)} en total.`;
        } },
        { de: 'riesgos', clave: 'abiertas', texto: () => {
          const abiertas = puestos.filter(p => p.posicion);
          if (!abiertas.length) return 'Esta noche no queda nada abierto: todo en efectivo.';
          const etq = Array.from(new Set(abiertas.map(p => p.etiqueta)));
          const lista = etq.length > 4 ? `${etq.slice(0, 4).join(', ')} y ${etq.length - 4} más` : etq.join(', ');
          const sinRealizar = abiertas.reduce((s, p) => s + p.posicion.cantidad * precios[p.etiqueta] - p.posicion.nocional, 0);
          return `Quedan ${abiertas.length} posiciones abiertas (${lista}), con ${usd(sinRealizar, true)} sin realizar. Cada una sigue con su stop.`;
        } },
        { de: 'cio', clave: 'resumen', texto: () => { const c = cabecera(); return `Cerramos el día con ${usd(c.patrimonio)} (${usd(c.pnlDia, true)} hoy), en modo ${modoComite} (${MODO_TEXTO[modoComite]}). Buenas noches.`; } },
      ];
    }
    // `pasada` (minutos): una reunión que ya fue, para la historia de partida.
    function reunion(o) {
      const pasada = o && Number.isFinite(o.pasada) ? o.pasada : null;
      if (pasada === null && (comiteEnCurso || reunionEnCurso || fondo.nivel === 'bloqueado')) return false;
      const tipo = (o && o.tipo) || siguienteReunion;
      siguienteReunion = tipo === 'manana' ? 'cierre' : 'manana';
      const turnos = turnosReunion(tipo);
      const extra = pasada === null ? {} : { t: inicio - pasada * MIN, silencioso: true, sinBocadillo: true };
      if (pasada === null) {
        reunionEnCurso = true;
        for (const id of JEFES_COMITE) moverAgente(id, 'comite', 'reunion');
      }
      const t0 = pasada === null ? ahora : extra.t;
      const que = tipo === 'cierre'
        ? `Empezamos el cierre del día de las ${hora(t0)}: resultado, operaciones cerradas y lo que queda abierto.`
        : `Buenos días. Empezamos la reunión de las ${hora(t0)}: cómo fue la noche, el mercado, los riesgos y las posiciones.`;
      let ultimo = decir('cio', 'direccion', 'reunion', `${que} ${pila(turnos[0].de)}, empiezas tú. Es informativa: no cambia nada del fondo.`, Object.assign({
        hilo: true, para: turnos[0].de, importancia: 2, datos: { reunion: tipo, fase: 'apertura', nombre: NOMBRE_REUNION[tipo], turnos: turnos.map(x => x.clave) },
      }, extra));
      // Cada turno contesta al anterior y le da las gracias (salvo quien sigue hablando).
      const hablar = (x) => {
        const antes = ultimo.de;
        const gracias = antes !== x.de && !x.sinGracias ? `Gracias, ${pila(antes)}. ` : '';
        ultimo = decir(x.de, 'direccion', x.clave === 'resumen' ? 'reunion' : 'informe', gracias + x.texto(), Object.assign({
          respondeA: ultimo, para: gracias ? antes : 'todos', importancia: x.clave === 'resumen' ? 2 : 1,
          datos: Object.assign({ reunion: tipo, turno: x.clave, fuente: 'plantilla' }, x.clave === 'resumen' ? { fase: 'cierre' } : {}),
        }, extra));
      };
      if (pasada !== null) { turnos.forEach(hablar); return true; }
      let r = 0;
      for (const x of turnos) programar(r += 2500, () => hablar(x), 'reunion');
      programar(r + 4000, () => {
        for (const id of JEFES_COMITE) {
          const a = agentePorId.get(id);
          if (a.sala === 'comite') moverAgente(id, SALA_DE[a.departamento], fondo.nivel === 'bloqueado' ? 'de_pie' : 'trabajando');
        }
        reunionEnCurso = false;
        proximaReunion = ahora + 150 * SEG;
      }, 'reunion');
      return true;
    }

    function descanso() {
      const candidatos = agentes.filter(a => a.sala === SALA_DE[a.departamento] && a.estado === 'trabajando' && !JEFES_COMITE.includes(a.id)
        && !(a.puestoId && (puestoPorId.get(a.puestoId).posicion || puestoPorId.get(a.puestoId)._enCurso)));
      if (!candidatos.length || comiteEnCurso || reunionEnCurso || fondo.nivel === 'bloqueado') return;
      const a = elegir(candidatos);
      decir(a.id, a.departamento === 'mesas' ? 'parque' : (a.departamento === 'analisis' ? 'analisis' : 'sistema'), 'descanso', 'No tengo nada pendiente: me tomo 5 minutos en la sala de descanso.');
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
        capital: capital(patr, valor),
        vigilancia: {
          perdidaDiaPct: vigilancia ? patr / vigilancia.inicioDia - 1 : (patr - patrimonioInicioDia) / patrimonioInicioDia,
          caidaPct: vigilancia ? Math.min(0, patr / Math.max(vigilancia.pico, patr) - 1) : Math.min(0, patr / pico - 1),
          desdeReapertura: Boolean(vigilancia),
        },
      };
    }

    // Capital de la barra de arriba, como _capital del servidor (§7): del
    // «bróker» de la maqueta (efectivo y posiciones), por tipo de activo. En
    // la maqueta todo es cripto, como en el modo sintético.
    function capital(patr, valor) {
      const porSimbolo = new Map();
      for (const p of puestos) {
        if (!p.posicion) continue;
        porSimbolo.set(p.etiqueta, (porSimbolo.get(p.etiqueta) || 0) + p.posicion.cantidad * precios[p.etiqueta]);
      }
      const activos = Array.from(porSimbolo, ([etiqueta, importe]) => ({ simbolo: POR_ETIQUETA[etiqueta].simbolo, etiqueta, importe }))
        .sort((a, b) => b.importe - a.importe || (a.etiqueta < b.etiqueta ? -1 : 1));
      const tope = (maximo, usado) => ({ maximo, tope: maximo * patr, usado, queda: Math.max(0, maximo * patr - usado) });
      const limites = { bruta: tope(LIMITES.maxExposicionBruta, valor), cripto: tope(LIMITES.maxExposicionCripto, valor) };
      const disponible = Math.max(0, Math.min(efectivo, limites.bruta.queda));
      return {
        patrimonio: patr, invertido: valor, invertidoPct: valor / patr, efectivo, disponible, disponibleCripto: Math.min(disponible, limites.cripto.queda),
        porTipo: [{ tipo: 'cripto', nombre: 'Cripto', importe: valor, pct: valor / patr, activos,
          mesas: MESAS.filter(m => m.estado !== 'banquillo').map(m => m.id) }],
        limites,
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
          diasActiva: DIAS_FONDO,
          explicacion: copia(m.explicacion),
          filtros: [],
          sharpeBacktest: m.backtest ? m.backtest.sharpe : null,
          backtest: m.backtest ? Object.assign(copia(m.backtest), { t: inicio - DIAS_FONDO * 24 * HORA }) : null,
          estudio: null,   // solo las mesas de ETF llevan el estudio del 30-sep-2026 (la maqueta es cripto)
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
        agentes: agentes.map(a => ({ id: a.id, nombre: a.nombre, genero: a.genero, departamento: a.departamento, rol: a.rol, queDecide: a.queDecide, queHace: a.queHace, usaLLM: a.usaLLM,
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

    // ----- mensajes de partida (una hora de historia, en llano) -----
    {
      const antes = (min) => inicio - min * MIN;
      const dicho = (de, canal, tipo, texto, min, extra) => decir(de, canal, tipo, texto, Object.assign({ t: antes(min), silencioso: true, sinBocadillo: true }, extra || {}));
      // La reunión informativa de hace una hora (la siguiente, en vivo, será la otra).
      reunion({ pasada: 62, tipo: 'manana' });
      dicho('macro', 'macro', 'regimen', `Ambiente del mercado: RISK-ON (+2 puntos), el mercado acompaña. Motivos: el bitcoin (${pd(82910)}) va por encima de su media de 200 días (${pd(73400)}); su tendencia de fondo es al alza.`, 56);
      dicho('analista-ETH', 'analisis', 'nota', `Ethereum vale ${pd(2638)} y sigue en subida: está por encima de su precio medio de los últimos 50 días (${pd(2540)}). Sube y baja a un ritmo normal (RSI 61 de 100, velas de 4 horas).`, 54, { costeUsd: 0.0021 });
      // Una compra de hace 51 minutos, entera: señal → propuesta → Riesgos → Ejecutor.
      {
        const p = puestoPorId.get('ruptura-ETH');
        const op = pila(p.agenteId);
        const pos = p.posicion;
        const hilo = [
          [p.agenteId, 'parque', 'senal', `Mi regla dice comprar ETH: ha cerrado en ${pd(pos.entrada)}, por encima del máximo de los 20 días anteriores (${pd(pos.entrada * 0.988)}). Si cae a ${pd(pos.stop)}, vendo (stop).`, {}],
          [p.agenteId, 'parque', 'propuesta', `${pila('riesgos')}, quiero comprar ${usd(2600)} de ETH a ${pd(pos.entrada)}. Si cae a ${pd(pos.stop)}, salgo (stop).`, { para: 'riesgos' }],
          ['riesgos', 'riesgo', 'aprobacion', `${op}, aprobado: ${usd(2600)} de ETH, dentro de los límites.`, { para: p.agenteId }],
          ['ejecutor', 'ejecucion', 'orden', `Recibido, ${op} y ${pila('riesgos')}: mando al bróker la compra de ${usd(2600)} de ETH a precio de mercado.`, { para: p.agenteId }],
          ['ejecutor', 'ejecucion', 'ejecucion', `${op}, hecho: he comprado ${cant(pos.cantidad)} ETH a ${pd(pos.entrada)} (${usd(2600)}). Comisión: ${usd(2600 * 0.0025)}.`, { para: p.agenteId }],
        ];
        let ultimo = null;
        hilo.forEach(([de, canal, tipo, texto, extra], k) => {
          ultimo = dicho(de, canal, tipo, texto, 51 - k * 0.2, Object.assign({ datos: { puestoId: p.id } }, ultimo ? { respondeA: ultimo } : { hilo: true }, extra));
        });
        p._conv = { hilo: ultimo.hilo, ultimo };
      }
      const sueltos = [
        ['puesto-tendencia-SOL', 'parque', 'estado', null, 44],
        ['riesgos', 'riesgo', 'nota', 'No he vetado nada en la última hora. La pérdida del día está lejos de su límite del 2 %.', 40],
        ['controller', 'riesgo', 'nota', 'He comparado nuestras cuentas con las del bróker: cuadran.', 36],
        ['analista-BTC', 'analisis', 'nota', `Bitcoin vale ${pd(83390)} y sigue en subida: está por encima de su precio medio de los últimos 50 días (${pd(79900)}). Sube y baja a un ritmo normal (RSI 58 de 100, velas de 4 horas).`, 32],
        ['laboratorio', 'laboratorio', 'nota', 'Pruebo la idea H-38: Tendencia SMA en BTC, ETH y SOL que no compra con el mercado en modo miedo. Sale de una lección del Auditor.', 28],
        ['puesto-momentum-AVAX', 'parque', 'estado', null, 24],
        ['cio', 'direccion', 'nota', 'Sin cambios hasta el comité. Seguimos en modo NORMAL (compras a tamaño normal).', 20],
        ['ejecutor', 'ejecucion', 'nota', 'No tengo órdenes en cola. El bróker simulado contesta en 0,2 s.', 12],
        ['puesto-tendencia-BTC', 'parque', 'estado', null, 8],
        ['analista-SOL', 'analisis', 'nota', `Solana vale ${pd(142.1)}, sin una dirección clara: está por debajo de su precio medio de los últimos 50 días (${pd(146.8)}). Sube y baja a un ritmo normal (RSI 44 de 100, velas de 4 horas).`, 4],
      ];
      for (const [de, canal, tipo, texto, min] of sueltos) {
        const p = de.startsWith('puesto-') ? puestoPorId.get(de.slice(7)) : null;
        const tx = texto || textoEstadoPuesto(p);
        if (p) p.estadoTexto = tx;
        dicho(de, canal, tipo, tx, min, { datos: p ? { puestoId: p.id } : null });
      }
      mensajes.sort((a, b) => a.t - b.t);
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
        if (ahora >= proximoComite && !comiteEnCurso && !reunionEnCurso) comite();
        if (ahora >= proximaReunion && !comiteEnCurso && !reunionEnCurso) reunion();
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

    // Como plantillas.directiva y respuestaMegafono, y conversacion.afectadoPor.
    let megafonoConv = null;
    const nombreMesa = (id) => { const m = MESAS.find(x => x.id === id); return m ? m.nombre : id; };
    const etqDe = (s) => String(s || '').split('/')[0];
    function textoDirectiva(d) {
      const h = d.horas ? ` durante ${d.horas} h` : '';
      switch (d.tipo) {
        case 'reducir_riesgo': return `Reducir el tamaño de las entradas al ${pct(d.factor, 0)}${h}.`;
        case 'pausar_activo': return `No abrir en ${etqDe(d.simbolo)}${h}.`;
        case 'pausar_mesa': return `Pausar la mesa ${nombreMesa(d.mesaId)}${h}.`;
        case 'solo_cerrar': return `Solo cerrar posiciones, sin abrir nada${h}.`;
        case 'reanudar_activo': return `Quitar la pausa del Megáfono en ${etqDe(d.simbolo)}.`;
        case 'reanudar_mesa': return `Quitar la pausa del Megáfono a la mesa ${nombreMesa(d.mesaId)}.`;
        default: return 'Directiva desconocida: no se aplica.';
      }
    }
    function respuestaMegafono(d) {
      const h = d.horas ? ` durante ${d.horas} h` : '';
      switch (d.tipo) {
        case 'reducir_riesgo': return `Entendido: recorto cada compra nueva al ${pct(d.factor, 0)} de su tamaño${h}.`;
        case 'pausar_activo': return `Entendido: no abro nada en ${etqDe(d.simbolo)}${h}. Lo que ya tengo sigue con su stop.`;
        case 'pausar_mesa': return `Entendido: la mesa ${nombreMesa(d.mesaId)} no abre nada${h}. Lo que tenemos abierto sigue con su stop.`;
        case 'solo_cerrar': return `Entendido: no se abre nada${h}; solo cerramos lo que toque.`;
        case 'reanudar_activo': return `Entendido: vuelvo a poder abrir en ${etqDe(d.simbolo)} cuando lo diga la estrategia.`;
        case 'reanudar_mesa': return `Entendido: la mesa ${nombreMesa(d.mesaId)} vuelve a abrir cuando lo diga su estrategia.`;
        default: return 'Entendido.';
      }
    }
    // Quien cumple la directiva: Riesgos en reducir y solo cerrar; el primer
    // operador de la mesa o del activo en pausas y reanudaciones.
    function afectadoPor(d) {
      if (d.tipo === 'reducir_riesgo' || d.tipo === 'solo_cerrar') return 'riesgos';
      const vivas = MESAS.filter(m => m.estado !== 'banquillo').map(m => m.id);
      const p = d.tipo === 'pausar_mesa' || d.tipo === 'reanudar_mesa'
        ? puestos.find(x => x.mesaId === d.mesaId)
        : puestos.find(x => x.simbolo === d.simbolo && vivas.includes(x.mesaId));
      return p ? p.agenteId : null;
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
          if (reunionEnCurso) { proximoComite = ahora; return { ok: true, mensaje: 'Comité convocado: empieza al acabar la reunión informativa.' }; }
          comite();
          return { ok: true, mensaje: 'Comité convocado: los jefes van a la sala.' };
        }
        case 'megafono': {
          const texto = String(c.texto || '').trim();
          if (!texto) return { ok: false, mensaje: 'Escribe qué quieres que haga la mesa.' };
          const r = interpretar(texto);
          megafonoPendiente = { id: `meg-${++nProp}`, texto, directivas: r.directivas, explicacion: r.explicacion };
          // La orden abre una conversación: la Presidenta contesta con la propuesta (§6.2).
          const orden = decir('humano', 'megafono', 'megafono', `«${texto}»`, { deNombre: 'Megáfono (humano)', importancia: 3, hilo: true, datos: { texto } });
          const prop = decir('cio', 'megafono', 'propuesta', `Propuesta: ${r.explicacion}`, { para: 'humano', respondeA: orden, importancia: 2,
            datos: { id: megafonoPendiente.id, directivas: copia(r.directivas), fuente: 'palabras_clave' } });
          megafonoConv = { ultimo: prop, propuestaId: megafonoPendiente.id };
          return { ok: true, mensaje: 'Propuesta lista: revísala y pulsa Aplicar.', datos: copia(megafonoPendiente) };
        }
        case 'megafono-aplicar': {
          if (!megafonoPendiente || c.id !== megafonoPendiente.id) return { ok: false, mensaje: 'No hay ninguna propuesta pendiente con ese id.' };
          const aplicadas = megafonoPendiente.directivas.filter(d => d.tipo !== 'sin_efecto');
          const conv = megafonoConv && megafonoConv.propuestaId === megafonoPendiente.id ? megafonoConv : null;
          let ultimo = conv ? conv.ultimo : null;
          // Cada directiva, en la conversación de su orden; le contesta al humano quien la cumple.
          for (const d of aplicadas) {
            aplicarDirectiva(d);
            const anuncio = decir('cio', 'megafono', 'directiva', textoDirectiva(d), { importancia: 3, respondeA: ultimo, datos: copia(d) });
            const quien = afectadoPor(d);
            ultimo = quien ? decir(quien, 'megafono', 'nota', respuestaMegafono(d), { para: 'humano', respondeA: anuncio, importancia: 2, datos: { directiva: copia(d) } }) : anuncio;
          }
          megafonoPendiente = null;
          megafonoConv = null;
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
          decir('riesgos', 'riesgo', 'alerta', 'Pausa pedida desde el panel: solo cerramos posiciones, no se abre nada hasta que alguien pulse Reabrir.', { importancia: 3 });
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
          reunionEnCurso = false;
          // El comité (o la reunión) que estaba reunido se disuelve: fuera sus puntos pendientes.
          for (let k = cola.length - 1; k >= 0; k--) if (cola[k].grupo === 'comite' || cola[k].grupo === 'reunion') cola.splice(k, 1);
          for (const a of agentes) moverAgente(a.id, a.sala === 'descanso' || a.sala === 'comite' ? SALA_DE[a.departamento] : a.sala, 'de_pie');
          decir('riesgos', 'riesgo', 'alerta', 'Freno de emergencia (kill switch): orden manual desde el panel. Vendo todo y bloqueo el fondo hasta que alguien pulse Reabrir.', { importancia: 3 });
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
