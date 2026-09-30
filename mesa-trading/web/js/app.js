// Arranque del parqué: fuente de datos (servidor por SSE o maqueta), estado,
// bucle de pintado y entrada (arrastrar, rueda, pellizco, clic).
//
// Orden de pintado (propuesta-visual §4.1): capa estática (edificio, suelos,
// paredes del fondo) → pantallas del fondo → muebles, tabiques y personas
// ordenados por profundidad → cristal delantero → etiquetas y bocadillos.
(function (raiz) {
  'use strict';
  if (typeof document === 'undefined') return;   // cargado desde Node: nada que arrancar
  const PQ = raiz.Parque;
  const { cifras, iso, dibujo, personajes: pers, paneles } = PQ;
  const mapaMod = PQ.mapa;

  const params = new URLSearchParams(location.search);
  const ES_MAQUETA = params.get('maqueta') === '1' || location.protocol === 'file:';
  const TOKEN = params.get('token') || '';
  const PASO_MS = 1000 / 30;                      // tope de 30 fps
  // Sin nadie andando ni nada que animar, basta con 12 fps para el tecleo y
  // los giros de cabeza (en el móvil, menos CPU); con movimiento reducido, 5.
  const PASO_QUIETO_MS = 1000 / 12;
  const PASO_REDUCIDO_MS = 1000 / 5;
  const DESTELLO_MS = 2000;

  const escena = document.getElementById('escena');
  const lienzo = document.getElementById('lienzo');
  const ctx = lienzo.getContext('2d');
  const capa = document.createElement('canvas');
  const cctx = capa.getContext('2d');

  const camara = new iso.Camara({ zoomMin: 0.5, zoomMax: 2 });
  let reducir = cifras.reducirMovimiento();
  try {
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => { reducir = e.matches; });
  } catch (_) { /* navegador antiguo */ }

  const est = {
    inst: null, recibido: 0, mapa: null, firma: null, asignacion: new Map(), elenco: pers.crearElenco(), items: [],
    seleccion: null, destellos: new Map(), puestos: new Map(), mesas: new Map(), deps: new Map(),
    ancho: 0, alto: 0, dpr: 1, encuadrada: false, camaraTocada: false, capaClave: '', etiquetasPintadas: [],
    texturasSucias: true, animPatr: null, patrMostrado: null, ultimoPintado: 0, parado: false,
    rotulosPintados: [], cursor: -1, activoHasta: 0, llegadas: [], relojesClave: '', ventanasClave: '',
    stats: { frames: 0, msPintar: 0, maxMs: 0 },
    // Operadores de pie junto al Ejecutor mientras se reproduce su operación
    // (la propuesta ya salió y la ejecución aún no): agenteId → { texto, hilo, desde }.
    enEjecucion: new Map(),
  };

  // Reproductor (reproductor.js): lo que llega de golpe (un comité, una
  // operación entera dentro de un latido) entra en el feed uno a uno.
  const repro = PQ.reproductor ? PQ.reproductor.crearReproductor({
    ahora: () => performance.now(),
    ventana: () => PQ.reproductor.ventanaReunionMs(est.inst),
  }) : null;
  const ESPERA_MAX_MS = 120000;   // la espera de pie de una operación reproducida nunca dura más

  function lienzoTex(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  const texturas = {
    gigante: lienzoTex(1800, 340), limites: lienzoTex(480, 270), regimen: lienzoTex(340, 140), comite: lienzoTex(340, 140),
    laboratorio: lienzoTex(200, 100), analisis: lienzoTex(200, 100),
    relojes: lienzoTex(dibujo.TEX_RELOJES.w * 2, dibujo.TEX_RELOJES.h * 2),
    ventanas: new Map(),   // una por ventana: cada una tiene su propia silueta de edificios
  };
  dibujo.pintarPizarra(texturas.laboratorio, 'laboratorio');
  dibujo.pintarPizarra(texturas.analisis, 'analisis');

  const ahoraServidor = () => {
    const i = est.inst;
    if (!i || !Number.isFinite(i.ahora)) return Date.now();
    const factor = i.modo === 'sintetico' && Number.isFinite(i.velocidad) ? i.velocidad : 1;
    return i.ahora + (Date.now() - est.recibido) * factor;
  };

  // ---------- plano y lista de pintado ----------

  function construir(inst) {
    est.mapa = mapaMod.construirMapa(inst || {});
    const items = [];
    const margen = 8;
    const caja = (c0, f0, c1, f1, z0, z1) => {
      const b = iso.cajaMundo(c0, f0, c1, f1, z0, z1);
      return { x0: b.x0 - margen, y0: b.y0 - margen, x1: b.x1 + margen, y1: b.y1 + margen };
    };
    for (const m of est.mapa.muebles) {
      if (m.tipo === 'alfombra') continue;
      const extra = m.tipo === 'planta' ? 30 : m.tipo === 'cafetera' ? 18 : 6;
      items.push({ clave: m.clave, tipo: 'mueble', m, caja: caja(m.c0, m.f0, m.c1, m.f1, m.z || 0, (m.z || 0) + (m.alto || 10) + extra) });
    }
    // Una pantalla colgada de un tabique se pinta a trozos, con cada trozo de
    // pared que cubre: así hereda su orden y ningún trozo vecino la tapa.
    for (const w of est.mapa.trozosPared) {
      const enCol = w.c1 - w.c0 < w.f1 - w.f0;
      const linea = enCol ? (w.c0 + w.c1) / 2 : (w.f0 + w.f1) / 2;
      const a = enCol ? w.f0 : w.c0; const b = enCol ? w.f1 : w.c1;
      const pantallas = est.mapa.pantallasPared.filter(pp => (pp.eje === 'col') === enCol && Math.abs(pp.en - linea) < 1e-6
        && pp.desde < b && pp.hasta > a).map(pp => ({ pp, desde: Math.max(a, pp.desde - 0.1), hasta: Math.min(b, pp.hasta + 0.1) }));
      const alto = Math.max(w.alto, ...pantallas.map(x => x.pp.z1 + 4));
      items.push({ clave: w.clave, tipo: 'pared', w, pantallas, caja: caja(w.c0, w.f0, w.c1, w.f1, 0, alto + 6) });
    }
    items.sort((a, b) => a.clave - b.clave);
    est.items = items;
    est.capaClave = '';
  }

  function cajaEdificio() {
    return iso.cajaMundo(-0.3, -0.3, mapaMod.COLS, mapaMod.FILAS, -18, mapaMod.ALTO_PARED_EXTERIOR + 26);
  }

  function encuadrar() {
    const caja = cajaEdificio();
    const movil = est.ancho < 768;
    camara.zoomMin = 0.5;
    const z = camara.encuadrar(caja, est.ancho, est.alto, movil ? 10 : 28);
    if (movil && z < 0.5) {
      // En el móvil se empieza cerca del parqué; pellizcando se ve la oficina entera.
      camara.zoom = 0.5;
      const centro = iso.proyectar(10, 8, 20);
      camara.x = est.ancho / 2 - centro.x * camara.zoom + desplazamientoParque();
      camara.y = est.alto * 0.34 - centro.y * camara.zoom;
      camara.version++;
    }
    est.encuadrada = true;
    est.camaraTocada = false;
  }

  // En el móvil el principio de las filas del parqué cae en el borde izquierdo
  // y sus rótulos (lo que se toca para abrir la ficha de la mesa) no cabían. Se
  // corre la vista a la derecha lo que haga falta para uno corto (~120 px),
  // pero solo lo que deje la etiqueta del último puesto dentro de la pantalla.
  function desplazamientoParque() {
    if (!est.mapa || !est.mapa.rotulosFila.length) return 0;
    const centro = iso.proyectar(10, 8, 20);
    const x0 = est.ancho / 2 - centro.x * 0.5;
    const enPantalla = (col, fila, zz) => x0 + iso.proyectar(col, fila, zz).x * 0.5;
    const inicio = Math.min(...est.mapa.rotulosFila.map(r => enPantalla(r.col, r.fila, r.z || 52)));
    const fin = Math.max(...Array.from(est.mapa.puestos.values()).map(g => enPantalla(g.ancla.col, g.ancla.fila, g.ancla.z)));
    return Math.max(0, Math.min(120 - inicio, est.ancho - 26 - fin));   // media etiqueta (~20 px) y 6 de margen
  }

  // Que la oficina no se pierda de vista: siempre queda un trozo dentro.
  function limitarCamara() {
    const c = cajaEdificio();
    const a = camara.mundoAPantalla(c.x0, c.y0);
    const b = camara.mundoAPantalla(c.x1, c.y1);
    const m = 140;
    let dx = 0; let dy = 0;
    if (b.x < m) dx = m - b.x; else if (a.x > est.ancho - m) dx = est.ancho - m - a.x;
    if (b.y < m) dy = m - b.y; else if (a.y > est.alto - m) dy = est.alto - m - a.y;
    if (dx || dy) camara.mover(dx, dy);
  }

  function redimensionar() {
    const r = escena.getBoundingClientRect();
    const dpr = Math.min(2.5, raiz.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    const centroMundo = est.ancho ? camara.pantallaAMundo(est.ancho / 2, est.alto / 2) : null;
    est.ancho = w; est.alto = h; est.dpr = dpr;
    for (const c of [lienzo, capa]) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    if (!est.encuadrada || !est.camaraTocada) encuadrar();
    else if (centroMundo) {
      camara.x = w / 2 - centroMundo.x * camara.zoom;
      camara.y = h / 2 - centroMundo.y * camara.zoom;
      camara.version++;
    }
    est.capaClave = '';
  }

  // ---------- datos entrantes ----------

  function alEstado(inst) {
    if (!inst || typeof inst !== 'object') return;
    const anterior = est.inst;
    est.inst = inst;
    // Modo web: la instantánea la publicó el último latido hace `edadSeg`; el
    // dato es de entonces, no de cuando llega al panel.
    const edadMs = inst.web && Number.isFinite(inst.edadSeg) ? Math.max(0, inst.edadSeg * 1000) : 0;
    est.recibido = Date.now() - edadMs;
    if (inst.web && !est.pwa && raiz.MesaPWA) { est.pwa = true; raiz.MesaPWA.activar(); }
    est.llegadas.push(est.recibido);
    if (est.llegadas.length > 8) est.llegadas.shift();
    paneles.datosViejos(null);
    est.puestos = new Map((inst.puestos || []).map(p => [p.id, p]));
    est.mesas = new Map((inst.mesas || []).map(m => [m.id, m]));
    const deps = mapaMod.departamentosDe(inst.departamentos);
    est.deps = new Map(deps.map(d => [d.id, d]));
    paneles.fijarDepartamentos(deps);
    const firma = mapaMod.firmaEstructura(inst);
    if (firma !== est.firma) {
      construir(inst);
      est.firma = firma;
      // El encuadre del móvil depende de las filas del parqué: se rehace con
      // la primera instantánea (y al contratar o despedir mesas) mientras nadie
      // haya movido la cámara.
      if (!est.camaraTocada) encuadrar();
    }
    sincronizarPersonas(!anterior);
    programarActividad(inst);
    // Bocadillos que trae la instantánea (p. ej. al conectar a mitad de una
    // frase), salvo los de quien tiene un mensaje esperando en el reproductor:
    // su bocadillo sale cuando sale su mensaje.
    const tServ = inst.ahora;
    for (const a of inst.agentes || []) {
      const p = est.elenco.personajes.get(a.id);
      if (repro && repro.esperaDe(a.id)) continue;
      if (p && a.bocadillo && a.bocadillo.texto && a.bocadillo.hasta > tServ && a.bocadillo.texto !== p.textoVisto) {
        p.textoVisto = a.bocadillo.texto;
        p.decir(a.bocadillo.texto, 2, performance.now());
      }
    }
    entrarMensajes(inst.mensajes || [], { primera: !anterior, desdeInstantanea: true });
    // El patrimonio de la pantalla gigante cuenta hacia arriba, como la barra.
    const patr = inst.cabecera && inst.cabecera.patrimonio;
    if (Number.isFinite(patr)) {
      const desde = Number.isFinite(est.patrMostrado) ? est.patrMostrado : 0;
      if (desde !== patr && !reducir) est.animPatr = { desde, hasta: patr, t0: performance.now() };
      else est.patrMostrado = patr;
    }
    est.texturasSucias = true;
    paneles.actualizarBarra(inst, { maqueta: ES_MAQUETA, ahoraServidor: ahoraServidor() });
    if (est.seleccion) {
      const s = est.seleccion;
      const existe = s.tipo === 'puesto' ? est.puestos.has(s.id) : s.tipo === 'mesa' ? est.mesas.has(s.id) : (inst.agentes || []).some(a => a.id === s.id);
      if (!existe) deseleccionar(); else paneles.refrescarTarjeta(inst);
    }
  }

  function sincronizarPersonas(primera) {
    const inst = est.inst;
    if (!inst || !est.mapa) return;
    est.asignacion = mapaMod.asignarSitios(est.mapa, inst.agentes || [], inst.departamentos);
    // Mientras se reproduce su operación, el operador que propuso espera de pie
    // junto al Ejecutor (como dice el servidor cuando la orden espera de verdad).
    const agentes = (inst.agentes || []).map(a => (est.enEjecucion.has(a.id) && a.estado === 'trabajando' ? Object.assign({}, a, { estado: 'ejecucion' }) : a));
    est.elenco.sincronizar(agentes, est.mapa, est.asignacion, {
      instantaneo: primera || reducir,
      forzarDePie: inst.fondo && inst.fondo.nivel === 'bloqueado',
    });
  }

  // Actividad del último paso (§7): cada agente va a mirar lo que de verdad
  // hizo. Una vez por paso (dedupe por actividad.t: en local llegan varias
  // instantáneas por paso), repartida en el tiempo que queda hasta el siguiente.
  function programarActividad(inst) {
    const act = inst.actividad;
    if (!act || !Number.isFinite(act.t) || !est.mapa) return;
    const factor = inst.modo === 'sintetico' && Number.isFinite(inst.velocidad) ? Math.max(1, inst.velocidad) : 1;
    const edadWeb = inst.web && Number.isFinite(inst.edadSeg) ? inst.edadSeg * 1000 : 0;
    const edad = edadWeb + Math.max(0, (Number.isFinite(inst.ahora) ? inst.ahora : act.t) - act.t) / factor;
    est.elenco.programarActividad(act, {
      mapa: est.mapa, agentes: inst.agentes || [], asignacion: est.asignacion, departamentos: inst.departamentos,
      ventanaMs: pers.ventanaActividad(inst, edad), ahora: performance.now(), ritmoBase: ritmoAndar(),
      reducir: reducir || (inst.fondo && inst.fondo.nivel === 'bloqueado'),
    });
  }

  function alMensaje(m) {
    if (!m || !m.id) return;
    entrarMensajes([m]);
  }

  // Todo mensaje nuevo pasa por aquí (el SSE y la instantánea). El reproductor
  // decide cuáles entran ya y cuáles esperan su turno (una reunión o una
  // operación que llegó de golpe). En la primera instantánea el feed es
  // historia y entra entero, salvo una reunión que acaba de celebrarse: esa se
  // reproduce desde su apertura.
  //
  // Después, lo que llega y es más viejo que lo que dura una reproducción (en
  // tiempo de la mesa) también es historia: entra ya, en su sitio por hora y
  // sin bocadillos ni operadores de pie. Pasa al volver la red o al despertar
  // el móvil: la instantánea trae lo que no se vio, y un comité de hace 3 h
  // se reproducía como si fuera en directo («Reunión de la mañana en curso,
  // 2 de 7»; revisión del 30-sep-2026). Mismo criterio que reunionReciente.
  function entrarMensajes(lista, opciones) {
    const o = opciones || {};
    const nuevos = (lista || []).filter(m => m && m.id && !paneles.yaVisto(m.id) && !(repro && repro.retenido(m.id)));
    if (!nuevos.length) return;
    if (!repro) { mostrarMensajes(nuevos, { silencio: o.desdeInstantanea }); return; }
    if (o.primera) {
      const reciente = reunionReciente(nuevos);
      const resto = reciente ? nuevos.filter(m => String(m.hilo || m.id) !== reciente) : nuevos;
      mostrarMensajes(resto, { silencio: true });
      if (reciente) repro.recibir(nuevos.filter(m => String(m.hilo || m.id) === reciente), { retener: true });
      return;
    }
    const { viejos, recientes } = PQ.reproductor.separarViejos(nuevos, limiteReproduccion());
    if (viejos.length) mostrarMensajes(viejos, { silencio: true, historia: true });
    if (recientes.length) mostrarMensajes(repro.recibir(recientes), {});
  }

  // Lo más viejo que aún se reproduce (reloj de la mesa), o null sin instantánea.
  function limiteReproduccion() {
    const inst = est.inst;
    if (!inst || !Number.isFinite(inst.ahora)) return null;
    return PQ.reproductor.limiteHistoria(inst, ahoraServidor());
  }

  // Hilo de la reunión (comité o informativa) cuya apertura es de hace menos
  // de lo que dura su reproducción (en tiempo de la mesa), o null.
  function reunionReciente(lista) {
    const limite = limiteReproduccion();
    if (!Number.isFinite(limite)) return null;
    let hilo = null;
    for (const m of lista) {
      const apertura = (m.canal === 'comite' && m.tipo === 'comite') || (m.canal === 'direccion' && m.tipo === 'reunion' && m.datos && m.datos.fase === 'apertura');
      if (apertura && m.t >= limite) hilo = String(m.hilo || m.id);
    }
    return hilo;
  }

  // Al feed, con sus efectos: bocadillo de quien habla, destello del puesto
  // y, en una operación, el operador de pie junto al Ejecutor desde su
  // propuesta hasta la ejecución (o el veto). `silencio`: historia, sin efectos.
  function mostrarMensajes(lista, opciones) {
    const o = opciones || {};
    const nuevos = paneles.anadirMensajes(lista || [], { historia: Boolean(o.historia) });
    if (!nuevos.length) return;
    if (est.inst) {
      const ids = new Set((est.inst.mensajes || []).map(m => m.id));
      est.inst.mensajes = (est.inst.mensajes || []).concat(nuevos.filter(m => !ids.has(m.id))).slice(-150);
    }
    if (o.silencio) return;
    const ahora = performance.now();
    let mover = false;
    for (const m of nuevos) {
      const p = est.elenco.personajes.get(m.de);
      if (p) { p.textoVisto = m.texto; p.decir(m.texto, m.importancia, ahora); }
      const puestoId = m.datos && m.datos.puestoId;
      if (puestoId && (m.tipo === 'orden' || m.tipo === 'veto')) {
        est.destellos.set(puestoId, { tipo: m.tipo === 'veto' ? 'veto' : 'orden', hasta: ahora + DESTELLO_MS });
      }
      if (PQ.reproductor && PQ.reproductor.abreEspera(m)) {
        est.enEjecucion.set(m.de, { texto: m.texto, hilo: String(m.hilo || m.id), desde: ahora });
        mover = true;
      } else if (PQ.reproductor && PQ.reproductor.cierraEspera(m)) {
        for (const [id, x] of est.enEjecucion) if (x.hilo === String(m.hilo || m.id)) { est.enEjecucion.delete(id); mover = true; }
      }
    }
    if (mover) sincronizarPersonas(false);
    if (est.seleccion) paneles.refrescarTarjeta(est.inst);
  }

  // Cada 250 ms: lo que el reproductor suelta, la píldora de «en curso» y las
  // esperas que ya no tienen quien las cierre.
  function ticReproductor() {
    if (!repro) return;
    const sale = repro.tic();
    if (sale.length) mostrarMensajes(sale, {});
    const ahora = performance.now();
    let mover = false;
    for (const [id, x] of est.enEjecucion) if (ahora - x.desde > ESPERA_MAX_MS) { est.enEjecucion.delete(id); mover = true; }
    if (mover) sincronizarPersonas(false);
    paneles.reunionEnCursoFeed(repro.reunionEnCurso());
  }
  setInterval(ticReproductor, 250);
  document.addEventListener('visibilitychange', () => {
    // Tras mucho rato con la pestaña oculta no se reproduce lo viejo: entra de golpe.
    if (!document.hidden && repro && repro.pendientes > 0 && est.ocultaDesde && performance.now() - est.ocultaDesde > 5 * 60000) mostrarMensajes(repro.vaciar(), {});
    est.ocultaDesde = document.hidden ? performance.now() : null;
  });

  function alAgente(ev) {
    if (!ev || !ev.id || !est.inst) return;
    const a = (est.inst.agentes || []).find(x => x.id === ev.id);
    if (!a) return;
    if (ev.sala) a.sala = ev.sala;
    if (ev.estado) a.estado = ev.estado;
    if ('bocadillo' in ev) a.bocadillo = ev.bocadillo;
    sincronizarPersonas(false);
    const p = est.elenco.personajes.get(a.id);
    if (p && ev.bocadillo && ev.bocadillo.texto && ev.bocadillo.texto !== p.textoVisto) {
      p.textoVisto = ev.bocadillo.texto;
      p.decir(ev.bocadillo.texto, 2, performance.now());
    }
    if (est.seleccion) paneles.refrescarTarjeta(est.inst);
  }

  function alEjecucion(ej) {
    if (!ej) return;
    if (ej.puestoId) est.destellos.set(ej.puestoId, { tipo: 'orden', hasta: performance.now() + DESTELLO_MS });
    if (est.inst) est.inst.ejecuciones = [ej].concat(est.inst.ejecuciones || []).slice(0, 30);
    est.texturasSucias = true;
  }

  function alConexion(ok, espera, motivo) {
    paneles.conexion(ok, espera, motivo);
    if (!ok) est.llegadas = [];
  }

  // ¿Llevamos demasiado sin una instantánea nueva? El 'ping' mantiene viva la
  // conexión aunque el latido esté colgado (red caída con Alpaca: cada petición
  // tarda minutos en fallar), así que la franja roja no sale y las cifras se
  // quedan congeladas como si fueran de ahora. Se compara con el ritmo al que
  // llegan (mediana de los últimos intervalos): 2,5 latidos, nunca menos de 20 s.
  function comprobarDatosParados() {
    if (ES_MAQUETA || !est.inst) return;
    // En modo web la instantánea llega una vez por latido (del cron): el
    // límite es 2,5 × latidoMs, el ritmo que declara la propia instantánea.
    const latidoMs = est.inst.web && Number.isFinite(est.inst.latidoMs) ? est.inst.latidoMs : null;
    const r = cifras.datosParados(est.llegadas, Date.now(), latidoMs);
    // Texto que cambia como mucho una vez por minuto: la franja es role=status
    // y un lector de pantalla la leería cada segundo.
    const min = Math.floor((r.pasadoMs || 0) / 60000);
    const cuando = min < 1 ? 'hace menos de un minuto' : min < 90 ? `hace ${min} min` : cifras.hace(r.pasadoMs);
    paneles.datosViejos(r.parado
      ? `Cifras sin actualizar: el último dato de la mesa llegó ${cuando} (¿red o datos caídos?). Precios y patrimonio pueden no ser los de ahora.`
      : null);
  }

  // ---------- fuente real: GET /api/estado + SSE con reconexión creciente ----------

  function fuenteReal(man) {
    const cabeceras = () => (TOKEN ? { 'x-panel-token': TOKEN } : {});
    const conToken = (ruta) => (TOKEN ? `${ruta}${ruta.includes('?') ? '&' : '?'}token=${encodeURIComponent(TOKEN)}` : ruta);
    let es = null;
    let espera = 1000;
    let temporizador = null;
    let ultimoLatido = Date.now();
    let abierto = false;
    // Por qué no hay conexión, si se sabe: 'token' (falta), 'token-malo',
    // 'lleno' (el servidor ya tiene el máximo de paneles), 'arrancando' (la
    // API responde 503 mientras el orquestador arranca). Sin motivo: red.
    let motivo = null;
    let proximoIntento = 0;
    // Lo que falta de verdad para el próximo intento (0 si ya se está intentando):
    // la franja cuenta hacia atrás desde ahí, no desde la espera entera.
    const falta = () => (temporizador ? Math.max(0, proximoIntento - Date.now()) : 0);
    let reintentando = false;
    let inicioConexion = 0;
    let avisoLento = null;

    // Tiempos máximos. Con el proceso de la mesa colgado (vivo pero sin
    // contestar), fetch y EventSource esperaban para siempre: la franja se
    // quedaba en «reintentando en 1 s…» sin reintentar ni alargar la espera.
    const TOPE_ESTADO_MS = 15000;          // GET /api/estado entero (cabeceras y cuerpo)
    const TOPE_ABRIR_SSE_MS = 20000;       // EventSource que no llega a abrirse
    const TOPE_SONDEO_MS = 10000;

    // fetch con tope: aborta (también la lectura del cuerpo) si no ha acabado a tiempo.
    function conTope(ruta, opciones, ms, leer) {
      const ac = typeof AbortController === 'function' ? new AbortController() : null;
      const reloj = ac ? setTimeout(() => ac.abort(), ms) : null;
      return fetch(ruta, Object.assign({}, opciones, ac ? { signal: ac.signal } : {}))
        .then(leer)
        .finally(() => { if (reloj) clearTimeout(reloj); });
    }

    // Modo web: sin sesión (caducada o cerrada en otro sitio) la API responde
    // 401 con { login } y el panel se va al login.
    function aLogin(j) {
      if (TOKEN || !j || typeof j.login !== 'string' || !j.login.startsWith('/')) return false;
      location.replace(j.login);
      return true;
    }

    function traerEstado() {
      return conTope('/api/estado', { headers: cabeceras(), cache: 'no-store' }, TOPE_ESTADO_MS, r => {
        if (r.status === 401) {
          return r.json().catch(() => null).then(j => { aLogin(j); const e = new Error('HTTP 401'); e.codigo = 401; throw e; });
        }
        if (r.status === 403) { const e = new Error(`HTTP ${r.status}`); e.codigo = r.status; throw e; }
        if (r.status === 503) {
          return r.json().catch(() => null).then(j => {
            const e = new Error('HTTP 503'); e.codigo = 503; e.motivo = cifras.motivo503(j); throw e;
          });
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      });
    }

    // EventSource no enseña el código HTTP: si falla antes de abrir con la API
    // respondiendo bien, se pregunta una vez a /api/eventos para saber si es un
    // 503 (demasiados paneles abiertos) y se corta en cuanto llegan las cabeceras.
    function sondearEventos() {
      if (typeof AbortController !== 'function') return;
      const ac = new AbortController();
      const reloj = setTimeout(() => ac.abort(), TOPE_SONDEO_MS);
      fetch(conToken('/api/eventos'), { headers: cabeceras(), cache: 'no-store', signal: ac.signal })
        .then(r => {
          // Un 503 trae un JSON corto (no es el SSE): se lee para saber si es
          // «arrancando» o «lleno» antes de cortar.
          const cuerpo = r.status === 503 ? r.json().catch(() => null) : Promise.resolve(null);
          return cuerpo.then(j => {
            ac.abort();
            const antes = motivo;
            if (r.status === 503) motivo = cifras.motivo503(j);
            else if (r.status === 401 || r.status === 403) motivo = TOKEN ? 'token-malo' : 'token';
            if (motivo !== antes && !abierto) man.conexion(false, falta(), motivo);
          });
        })
        .catch(() => { /* sin red: ya lo dice la franja */ })
        .finally(() => clearTimeout(reloj));
    }

    function conectar() {
      temporizador = null;
      let apiBien = false;
      let sseFallo = false;
      inicioConexion = Date.now();
      // Si el intento tarda (mesa colgada), la franja deja de prometer «en N s».
      if (avisoLento) clearTimeout(avisoLento);
      avisoLento = reintentando ? setTimeout(() => { avisoLento = null; if (!abierto) man.conexion(false, 0, motivo); }, 3000) : null;
      traerEstado().then(i => {
        apiBien = true;
        if (motivo === 'token' || motivo === 'token-malo' || motivo === 'arrancando') motivo = null;
        man.estado(i);
        if (sseFallo && !abierto) sondearEventos();
      })
        .catch((e) => {
          if (e && (e.codigo === 401 || e.codigo === 403)) {
            motivo = TOKEN ? 'token-malo' : 'token';
            man.conexion(false, falta(), motivo);
          } else if (e && e.codigo === 503) {
            motivo = e.motivo;
            man.conexion(false, falta(), motivo);
          }
          if (!abierto) reintentar();
        });
      try {
        es = new EventSource(conToken('/api/eventos'));
      } catch (_) { reintentar(); return; }
      es.onopen = () => {
        abierto = true; reintentando = false; espera = 1000; motivo = null; ultimoLatido = Date.now();
        if (avisoLento) { clearTimeout(avisoLento); avisoLento = null; }
        man.conexion(true);
      };
      es.onerror = () => {
        // Falla antes de abrir: si la API ya respondió bien, se pregunta por qué
        // (si aún no, lo hará ella al responder).
        if (!abierto) { sseFallo = true; if (apiBien) sondearEventos(); }
        reintentar();
      };
      // Modo web: el servidor avisa si la sesión caduca con el panel abierto.
      es.addEventListener('sesion', () => { location.replace('/login'); });
      for (const tipo of ['estado', 'mensaje', 'agente', 'ejecucion', 'ping']) {
        es.addEventListener(tipo, (ev) => {
          ultimoLatido = Date.now();
          if (tipo === 'ping') return;
          let d;
          try { d = JSON.parse(ev.data); } catch (_) { return; }
          if (man[tipo]) man[tipo](d);
        });
      }
    }

    function reintentar() {
      if (es) { es.onerror = null; es.onopen = null; es.close(); es = null; }
      abierto = false;
      reintentando = true;
      if (avisoLento) { clearTimeout(avisoLento); avisoLento = null; }
      if (temporizador) return;
      const e = espera;
      espera = Math.min(30000, espera * 2);
      proximoIntento = Date.now() + e;
      temporizador = setTimeout(conectar, e);
      man.conexion(false, e, motivo);
    }

    // Sin ningún evento (ni ping) en 45 s: la conexión está muerta aunque no lo
    // diga. Y un EventSource que no llega a abrirse en 20 s (mesa colgada) se
    // da por fallido: así la espera crece en lugar de quedarse colgada.
    setInterval(() => {
      if (es && abierto && Date.now() - ultimoLatido > 45000) reintentar();
      else if (es && !abierto && !temporizador && Date.now() - inicioConexion > TOPE_ABRIR_SSE_MS) reintentar();
    }, 5000);
    conectar();

    async function pedir(metodo, ruta, cuerpo) {
      try {
        const r = await fetch(ruta, {
          method: metodo, cache: 'no-store',
          headers: Object.assign(metodo === 'POST' ? { 'content-type': 'application/json' } : {}, cabeceras()),
          body: metodo === 'POST' ? JSON.stringify(cuerpo || {}) : undefined,
        });
        let datos = null;
        try { datos = await r.json(); } catch (_) { datos = null; }
        if (r.status === 401 && aLogin(datos)) return { ok: false, mensaje: 'La sesión ha caducado: vuelve a entrar.' };
        if (datos && typeof datos === 'object' && 'ok' in datos) return datos;
        return { ok: r.ok, mensaje: r.ok ? 'Hecho.' : `El servidor respondió ${r.status}.`, datos };
      } catch (_) {
        return { ok: false, mensaje: 'Sin conexión con la mesa.' };
      }
    }

    return {
      nombre: 'servidor',
      comando: (nombre, cuerpo) => pedir('POST', `/api/comando/${nombre}`, cuerpo),
      ajustes: () => pedir('GET', '/api/comando/ajustes'),
      // Modo web: cierra la sesión en el servidor (borra la cookie) y al login.
      cerrarSesion: async () => {
        const r = await pedir('POST', '/api/logout', {});
        if (r && r.ok) location.replace('/login');
        return r;
      },
    };
  }

  // ---------- pintado ----------

  function repintarCapa() {
    const clave = `${camara.version}|${est.firma}|${est.ancho}x${est.alto}@${est.dpr}`;
    if (clave === est.capaClave) return;
    est.capaClave = clave;
    const Z = camara.zoom * est.dpr;
    cctx.setTransform(1, 0, 0, 1, 0, 0);
    cctx.clearRect(0, 0, capa.width, capa.height);
    cctx.setTransform(Z, 0, 0, Z, camara.x * est.dpr, camara.y * est.dpr);
    dibujo.pintarEdificio(cctx, est.mapa, { escalaSombra: Z });
  }

  function repintarTexturas(t) {
    const inst = est.inst;
    let patrAnim = null;
    if (est.animPatr) {
      const p = (t - est.animPatr.t0) / 600;
      patrAnim = p >= 1 ? est.animPatr.hasta : est.animPatr.desde + (est.animPatr.hasta - est.animPatr.desde) * cifras.suavizar(p);
      est.patrMostrado = patrAnim;
      if (p >= 1) est.animPatr = null;
      est.texturasSucias = true;
    }
    repintarReloj();
    if (!est.texturasSucias) return;
    est.texturasSucias = false;
    dibujo.pintarPantallaGigante(texturas.gigante, inst, { patrimonioAnimado: patrAnim });
    dibujo.pintarLimites(texturas.limites, inst);
    dibujo.pintarPantallaRegimen(texturas.regimen, inst);
    dibujo.pintarPantallaComite(texturas.comite, inst, ahoraServidor());
  }

  // Relojes de pared y cielo de las ventanas con la hora de la MESA (simulada
  // en sintético), como el resto de la pantalla. Solo se repintan si cambia el
  // minuto (relojes) o el tramo del cielo (ventanas).
  const claveVentana = d => `${d.pared}|${d.desde}|${d.hasta}`;
  function repintarReloj() {
    const ahora = ahoraServidor();
    const minuto = String(Math.floor(ahora / 60000));
    if (minuto !== est.relojesClave) {
      est.relojesClave = minuto;
      dibujo.pintarRelojesTex(texturas.relojes, ahora);
    }
    const cielo = dibujo.colorCielo(dibujo.horaDe(ahora))[0] + '|' + est.firma;
    if (cielo !== est.ventanasClave && est.mapa) {
      est.ventanasClave = cielo;
      for (const d of est.mapa.decoraciones) {
        if (d.tipo !== 'ventana') continue;
        let tex = texturas.ventanas.get(claveVentana(d));
        if (!tex) { tex = lienzoTex(dibujo.TEX_VENTANA.w * 2, dibujo.TEX_VENTANA.h * 2); texturas.ventanas.set(claveVentana(d), tex); }
        dibujo.pintarVentanaTex(tex, d, ahora);
      }
    }
  }

  const COLOR_ETIQUETA = {
    verde: '#22c55e', rojo: '#ef4444', sin: '#64748b', plano: '#22d3ee', orden: '#f59e0b', ordenApagado: '#f59e0b',
    veto: '#ff3b52', apagado: '#475569',
  };

  function pintar(t) {
    const inicio = performance.now();
    const W = est.ancho; const H = est.alto; const dpr = est.dpr;
    const Z = camara.zoom * dpr;
    repintarCapa();
    repintarTexturas(t);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, lienzo.width, lienzo.height);
    ctx.drawImage(capa, 0, 0);
    ctx.setTransform(Z, 0, 0, Z, camara.x * dpr, camara.y * dpr);

    // Pantallas colgadas de las paredes del fondo.
    for (const d of est.mapa.decoraciones) {
      if (d.tipo === 'pantallaGigante') dibujo.pegarTextura(ctx, d, texturas.gigante);
      else if (d.tipo === 'limites') dibujo.pegarTextura(ctx, d, texturas.limites);
      else if (d.tipo === 'relojes') dibujo.pegarTextura(ctx, d, texturas.relojes);
      else if (d.tipo === 'ventana') dibujo.pegarTextura(ctx, d, texturas.ventanas.get(claveVentana(d)));
    }

    // Ventana visible en mundo, para no pintar lo que cae fuera.
    const v0 = camara.pantallaAMundo(0, 0);
    const v1 = camara.pantallaAMundo(W, H);
    const inst = est.inst;
    const fondoBloqueado = !!(inst && inst.fondo && inst.fondo.nivel === 'bloqueado');
    const regimen = inst && inst.cabecera && inst.cabecera.regimen && inst.cabecera.regimen.valor;
    const mov = !reducir;
    const datos = { t, puesto: null, destello: null, banquillo: false, regimen, fondoBloqueado, movimiento: mov };
    const seleccionPuesto = est.seleccion && est.seleccion.tipo === 'puesto' ? est.seleccion.id : null;
    const seleccionAgente = est.seleccion && est.seleccion.tipo === 'agente' ? est.seleccion.id : null;

    const pjs = est.elenco.lista().sort((a, b) => a.clave - b.clave);
    const items = est.items;
    let i = 0; let j = 0;
    while (i < items.length || j < pjs.length) {
      const usarPj = j < pjs.length && (i >= items.length || pjs[j].clave < items[i].clave);
      if (usarPj) {
        const p = pjs[j++];
        const b = pers.cajaPersonaje(p);
        if (b.x1 < v0.x || b.x0 > v1.x || b.y1 < v0.y || b.y0 > v1.y) continue;
        const dep = est.deps.get(p.agente.departamento);
        pers.pintarPersonaje(ctx, p, {
          t, ahora: t, color: dep ? dep.color : '#3b82f6', movimiento: mov,
          seleccionado: p.id === seleccionAgente || (seleccionPuesto && p.agente.puestoId === seleccionPuesto),
        });
        continue;
      }
      const it = items[i++];
      const c = it.caja;
      if (c.x1 < v0.x || c.x0 > v1.x || c.y1 < v0.y || c.y0 > v1.y) continue;
      if (it.tipo === 'mueble') {
        const m = it.m;
        if (m.tipo === 'monitor' && m.puestoId) {
          datos.puesto = est.puestos.get(m.puestoId) || null;
          datos.destello = est.destellos.get(m.puestoId) || null;
          const mesa = datos.puesto ? est.mesas.get(datos.puesto.mesaId) : null;
          datos.banquillo = !!(mesa && mesa.estado === 'banquillo');
        } else {
          datos.puesto = null; datos.destello = null; datos.banquillo = false;
        }
        dibujo.pintarMueble(ctx, m, datos);
      } else {
        dibujo.pintarTrozoPared(ctx, it.w);
        for (const x of it.pantallas) dibujo.pintarPantallaPared(ctx, x.pp, texturas[x.pp.contenido], x.desde, x.hasta);
      }
    }
    dibujo.pintarBordeDelantero(ctx, est.mapa);

    // Capa de rótulos en píxeles CSS.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    pintarEtiquetas(t, seleccionPuesto);
    pintarRotulosFila(inst);
    pintarBocadillos(t, pjs);
    pintarCursor();

    const ms = performance.now() - inicio;
    est.stats.frames++;
    est.stats.msPintar += ms;
    est.stats.maxMs = Math.max(est.stats.maxMs, ms);
  }

  function pillRedonda(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
  }

  function pintarEtiquetas(t, seleccionPuesto) {
    est.etiquetasPintadas = [];
    if (!est.mapa) return;
    const escala = Math.max(0.8, Math.min(1.15, camara.zoom * 1.25));
    const fuente = Math.round(10.5 * escala * 10) / 10;
    const verPnl = camara.zoom >= 0.45;
    for (const g of est.mapa.puestos.values()) {
      const p = est.puestos.get(g.puestoId);
      if (!p) continue;
      const a = camara.aPantalla(g.ancla.col, g.ancla.fila, g.ancla.z);
      if (a.x < -60 || a.x > est.ancho + 60 || a.y < -30 || a.y > est.alto + 30) continue;
      const mesa = est.mesas.get(p.mesaId);
      const estado = dibujo.estadoMonitor(p, est.destellos.get(p.id), t, mesa && mesa.estado === 'banquillo');
      // Un puesto que no puede abrir (activo vetado, mesa en pausa o a ×0) lleva
      // borde ámbar; si es su activo el vetado, lo dice la etiqueta.
      const bloqueos = cifras.bloqueosPuesto(est.inst, p, est.inst && est.inst.ahora);
      const color = bloqueos.length ? '#f59e0b' : (COLOR_ETIQUETA[estado] || '#64748b');
      const texto = bloqueos.some(b => b.tipo === 'activo') ? `${p.etiqueta} · VETADO` : p.etiqueta;
      const pnl = verPnl && p.posicion && Number.isFinite(p.posicion.pnlAbiertoPct) ? cifras.pct(p.posicion.pnlAbiertoPct, { signo: true, decimales: 1 }) : '';
      ctx.font = `800 ${fuente}px ${dibujo.FUENTE}`;
      const w1 = ctx.measureText(texto).width;
      ctx.font = `700 ${fuente - 1}px ${dibujo.FUENTE}`;
      const w2 = pnl ? ctx.measureText(pnl).width + 6 : 0;
      const w = Math.ceil(w1 + w2 + 12);
      const h = Math.round(fuente + 8);
      const x = Math.round(a.x - w / 2);
      const y = Math.round(a.y - h);
      const sel = seleccionPuesto === p.id;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      pillRedonda(x + 1, y + 2, w, h, 5); ctx.fill();
      ctx.fillStyle = sel ? 'rgba(40, 32, 8, 0.95)' : 'rgba(11, 16, 32, 0.88)';
      pillRedonda(x, y, w, h, 5); ctx.fill();
      ctx.lineWidth = sel ? 2 : 1.4;
      ctx.strokeStyle = sel ? '#fbbf24' : color;
      ctx.stroke();
      // Pico hacia el puesto.
      ctx.fillStyle = sel ? '#fbbf24' : color;
      ctx.beginPath(); ctx.moveTo(a.x - 3.5, y + h); ctx.lineTo(a.x, y + h + 4); ctx.lineTo(a.x + 3.5, y + h); ctx.closePath(); ctx.fill();
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#f1f4fb';
      ctx.font = `800 ${fuente}px ${dibujo.FUENTE}`;
      ctx.fillText(texto, x + 6, y + h / 2 + 0.5);
      if (pnl) {
        ctx.font = `700 ${fuente - 1}px ${dibujo.FUENTE}`;
        ctx.fillStyle = p.posicion.pnlAbiertoPct >= 0 ? '#4ade80' : '#f87171';
        ctx.fillText(pnl, x + 6 + w1 + 6, y + h / 2 + 0.5);
      }
      ctx.textBaseline = 'alphabetic';
      est.etiquetasPintadas.push({ x, y, w, h: h + 4, puestoId: p.id });
    }
  }

  function pintarRotulosFila(inst) {
    est.rotulosPintados = [];
    if (!est.mapa || camara.zoom < 0.42) return;
    const escala = Math.max(0.85, Math.min(1.1, camara.zoom * 1.2));
    ctx.font = `800 ${Math.round(9.5 * escala * 10) / 10}px ${dibujo.FUENTE}`;
    ctx.textBaseline = 'middle';
    const h = Math.round(16 * escala);
    // A la altura de las etiquetas de puesto y a la izquierda de la fila: la
    // fila de delante queda más abajo y la de detrás más a la derecha. Si la
    // fila la comparten varias mesas, sus rótulos se apilan hacia abajo. Dónde
    // cabe cada uno (sin salirse del lienzo ni pisar lo ya pintado, y por peso
    // de la mesa) lo decide dibujo.colocarRotulos.
    const selMesa = est.seleccion && est.seleccion.tipo === 'mesa' ? est.seleccion.id : null;
    const porId = new Map();
    const items = est.mapa.rotulosFila.map(r => {
      const mesa = est.mesas.get(r.mesaId) || {};
      const estado = mesa.estado || r.estado;
      const a = camara.aPantalla(r.col, r.fila, r.z || 52);
      const f = !r.compartida && Number.isFinite(r.colFin) ? camara.aPantalla(r.colFin, r.fila, r.z || 52) : null;
      const formas = dibujo.formasRotulo(r, mesa, inst, texto => ctx.measureText(texto).width);
      porId.set(r.mesaId, { mesa, estado });
      return {
        id: r.mesaId, formas, seleccionado: selMesa === r.mesaId,
        prioridad: estado === 'banquillo' ? -1 : (Number.isFinite(mesa.peso) ? mesa.peso : 0),
        inicio: { x: Math.round(a.x - 4), y: Math.round(a.y - h + (r.orden || 0) * (h + 2)) },
        fin: f ? { x: Math.round(f.x + 4), y: Math.round(f.y - h) } : null,
      };
    });
    const colocados = dibujo.colocarRotulos(items, { ancho: est.ancho, alto: est.alto, h, ocupado: est.etiquetasPintadas });
    for (const c of colocados) {
      const { x, y, w, texto } = c;
      const { estado } = porId.get(c.id);
      const sel = selMesa === c.id;
      const bloqueada = cifras.bloqueosMesa(inst, c.id, inst && inst.ahora).length > 0;
      ctx.fillStyle = sel ? 'rgba(40, 32, 8, 0.95)' : 'rgba(20, 27, 50, 0.82)';
      pillRedonda(x, y, w, h, h / 2); ctx.fill();
      if (sel || bloqueada) { ctx.lineWidth = 1.4; ctx.strokeStyle = sel ? '#fbbf24' : '#f59e0b'; ctx.stroke(); }
      ctx.fillStyle = bloqueada ? '#f59e0b' : estado === 'incubacion' ? '#22d3ee' : estado === 'banquillo' ? '#64748b' : '#3b82f6';
      ctx.beginPath(); ctx.arc(x + 8, y + h / 2, 2.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = bloqueada ? '#fcd34d' : estado === 'incubacion' ? '#67e8f9' : estado === 'banquillo' ? '#94a3b8' : '#dbe3f5';
      ctx.fillText(texto, x + 14, y + h / 2 + 0.5);
      est.rotulosPintados.push({ x, y, w, h, mesaId: c.id });
    }
    ctx.textBaseline = 'alphabetic';
  }

  // Recorrido con el teclado: puestos (en el orden del parqué) y después las
  // personas que no tienen puesto. n / AvPág avanza, p / RePág retrocede,
  // Intro abre la ficha. El elegido lleva un anillo y se anuncia.
  function recorrido() {
    const lista = [];
    if (!est.mapa) return lista;
    for (const g of est.mapa.puestos.values()) if (est.puestos.has(g.puestoId)) lista.push({ tipo: 'puesto', id: g.puestoId });
    for (const a of (est.inst && est.inst.agentes) || []) if (!a.puestoId) lista.push({ tipo: 'agente', id: a.id });
    return lista;
  }

  function nombreDe(sel) {
    if (!sel) return '';
    if (sel.tipo === 'puesto') {
      const p = est.puestos.get(sel.id);
      const m = p && est.mesas.get(p.mesaId);
      if (!p) return '';
      const pos = p.posicion ? `comprado, ${cifras.pct(p.posicion.pnlAbiertoPct, { signo: true })}` : 'sin posición';
      return `Puesto ${p.etiqueta} de ${m ? m.nombre : p.mesaId}: ${pos}.`;
    }
    const a = ((est.inst && est.inst.agentes) || []).find(x => x.id === sel.id);
    return a ? `${a.nombre}, ${a.rol}.` : '';
  }

  function moverCursor(paso) {
    const lista = recorrido();
    if (!lista.length) return;
    est.cursor = ((est.cursor < 0 ? (paso > 0 ? -1 : 0) : est.cursor) + paso + lista.length) % lista.length;
    const sel = lista[est.cursor];
    const pto = puntoDe(sel);
    if (pto) {
      est.camaraTocada = true;
      camara.x += est.ancho / 2 - pto.x;
      camara.y += est.alto / 2 - pto.y;
      camara.version++;
      limitarCamara();
    }
    const anuncio = document.getElementById('anuncio');
    if (anuncio) anuncio.textContent = `${nombreDe(sel)} Intro para ver la ficha.`;
  }

  // Punto de pantalla (px CSS) de un puesto o de una persona.
  function puntoDe(sel) {
    if (!sel || !est.mapa) return null;
    if (sel.tipo === 'puesto') {
      const g = est.mapa.puestos.get(sel.id);
      return g ? camara.aPantalla(g.ancla.col, g.ancla.fila, g.ancla.z) : null;
    }
    const p = est.elenco.personajes.get(sel.id);
    if (!p) return null;
    const c = pers.cabeza(p);
    return camara.mundoAPantalla(c.x, c.y);
  }

  function pintarCursor() {
    if (est.cursor < 0 || document.activeElement !== lienzo) return;
    const sel = recorrido()[est.cursor];
    const p = puntoDe(sel);
    if (!p) return;
    ctx.save();
    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.arc(p.x, p.y - (sel.tipo === 'puesto' ? 10 : 0), 26, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function pintarBocadillos(t, pjs) {
    const candidatos = [];
    for (const p of pjs) {
      let b = p.bocadillo && p.bocadillo.hasta > t ? p.bocadillo : null;
      // Quien espera de pie junto al Ejecutor sigue diciendo qué espera.
      if (!b && p.agente && p.agente.estado === 'ejecucion') {
        const e = est.enEjecucion.get(p.id);
        const texto = e ? e.texto : (p.agente.bocadillo && p.agente.bocadillo.texto);
        if (texto) b = { texto, importancia: 2, desde: e ? e.desde : t - 1000, hasta: t + 1000 };
      }
      if (!b) continue;
      const cab = pers.cabeza(p);
      const s = camara.mundoAPantalla(cab.x, cab.y);
      if (s.x < -20 || s.x > est.ancho + 20 || s.y < -20 || s.y > est.alto + 40) continue;
      const dep = est.deps.get(p.agente.departamento);
      candidatos.push({ x: s.x, y: s.y, texto: b.texto, importancia: b.importancia, desde: b.desde, hasta: b.hasta, color: dep ? dep.color : '#3b82f6' });
    }
    const elegidos = pers.elegirBocadillos(candidatos, pers.MAX_BOCADILLOS);
    pers.pintarBocadillos(ctx, elegidos, { ancho: est.ancho, ahora: t, movimiento: !reducir, fuente: dibujo.FUENTE });
  }

  // ---------- bucle ----------

  // En sintético muy acelerado un comité dura un par de segundos reales: a paso
  // normal los jefes no llegaban nunca a la sala. Se anda más rápido cuanto más
  // corre el reloj (×600 → ×2, ×3.000 → ×10, tope ×12).
  function ritmoAndar() {
    const i = est.inst;
    if (!i || i.modo !== 'sintetico' || !Number.isFinite(i.velocidad)) return 1;
    return Math.min(12, Math.max(1, i.velocidad / 300));
  }

  let ultimaActualizacion = performance.now();
  // Ritmo de pintado: 30 fps si algo se mueve (alguien anda, la cifra de la
  // pantalla cuenta, un destello, el dedo en la pantalla); si no, 12 (o 5 con
  // movimiento reducido): el adorno no necesita más.
  function pasoPintado(t) {
    const activo = t < est.activoHasta || est.elenco.hayMovimiento() || est.animPatr || est.destellos.size > 0;
    if (activo) return PASO_MS;
    return reducir ? PASO_REDUCIDO_MS : PASO_QUIETO_MS;
  }
  function despertar() { est.activoHasta = performance.now() + 1500; }
  for (const ev of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart']) {
    raiz.addEventListener(ev, despertar, { passive: true, capture: true });
  }

  function bucle(t) {
    if (document.hidden) { est.parado = true; return; }
    requestAnimationFrame(bucle);
    if (t - est.ultimoPintado < pasoPintado(t) - 1) return;
    est.ultimoPintado = t;
    // Con los informes abiertos el parqué no se ve: no se pinta (batería del móvil).
    if (PQ.vistas && PQ.vistas.abierta()) { ultimaActualizacion = t; return; }
    const dt = Math.min(0.1, (t - ultimaActualizacion) / 1000);
    ultimaActualizacion = t;
    est.elenco.actualizar(dt * ritmoAndar(), t);
    for (const [id, d] of est.destellos) if (d.hasta < t) est.destellos.delete(id);
    try { pintar(t); } catch (e) { console.error(e); }
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && est.parado) {
      est.parado = false;
      ultimaActualizacion = performance.now();
      requestAnimationFrame(bucle);
    }
  });
  setInterval(() => {
    if (est.inst) {
      paneles.actualizarComite(est.inst, ahoraServidor());
      est.texturasSucias = true;
    }
    comprobarDatosParados();
    paneles.refrescarFranja();          // «reintentando en N s…» cuenta hacia atrás
  }, 1000);

  // ---------- selección ----------

  // `opciones.origen`: lo que abre la ficha (el lienzo), para devolverle el foco al cerrarla.
  function seleccionar(sel, opciones) {
    est.seleccion = sel;
    if (sel) paneles.mostrarTarjeta(sel, est.inst, opciones); else paneles.ocultarTarjeta();
  }
  function deseleccionar() { est.seleccion = null; paneles.ocultarTarjeta(); }

  function buscarEn(px, py) {
    for (const r of est.rotulosPintados) {
      if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return { tipo: 'mesa', id: r.mesaId };
    }
    for (const e of est.etiquetasPintadas) {
      if (px >= e.x && px <= e.x + e.w && py >= e.y && py <= e.y + e.h) return { tipo: 'puesto', id: e.puestoId };
    }
    const pjs = est.elenco.lista().sort((a, b) => b.clave - a.clave);
    for (const p of pjs) {
      const b = pers.cajaPersonaje(p);
      const a = camara.mundoAPantalla(b.x0, b.y0);
      const c = camara.mundoAPantalla(b.x1, b.y1);
      if (px >= a.x && px <= c.x && py >= a.y && py <= c.y) {
        if (p.agente.puestoId && est.puestos.has(p.agente.puestoId) && p.agente.sala === 'parque') return { tipo: 'puesto', id: p.agente.puestoId };
        return { tipo: 'agente', id: p.id };
      }
    }
    if (est.mapa) {
      // Sobre el plano del tablero (z = 18): el puesto más cercano dentro de su mesa, monitores y silla.
      const g = camara.pantallaARejilla(px, py, 18);
      let mejor = null; let dMejor = Infinity;
      for (const q of est.mapa.puestos.values()) {
        if (g.col < q.c0 - 0.4 || g.col > q.c1 + 0.1 || g.fila < q.f0 - 0.8 || g.fila > q.f1 + 0.9) continue;
        const d = Math.hypot(g.col - (q.c0 + q.c1) / 2, g.fila - (q.f0 + q.f1) / 2);
        if (d < dMejor) { dMejor = d; mejor = q; }
      }
      if (mejor) return { tipo: 'puesto', id: mejor.puestoId };
    }
    return null;
  }

  // ---------- entrada ----------

  const punteros = new Map();
  let arrastre = null;
  let pellizco = null;

  function posEvento(e) {
    const r = lienzo.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  lienzo.addEventListener('pointerdown', (e) => {
    // Con el dedo (o el lápiz), sin los eventos de ratón de compatibilidad: su
    // mousedown llegaba después de abrir la ficha, caía sobre el lienzo ya
    // inerte y se llevaba el foco de «Cerrar» a <body>. El pellizco y el
    // arrastre no dependen de ellos (touch-action: none y eventos pointer).
    if (e.pointerType && e.pointerType !== 'mouse') e.preventDefault();
    lienzo.setPointerCapture(e.pointerId);
    const p = posEvento(e);
    punteros.set(e.pointerId, p);
    if (punteros.size === 1) arrastre = { x: p.x, y: p.y, movido: false };
    else if (punteros.size === 2) {
      const [a, b] = Array.from(punteros.values());
      pellizco = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      arrastre = null;
    }
  });
  lienzo.addEventListener('pointermove', (e) => {
    const p = posEvento(e);
    if (!punteros.has(e.pointerId)) {
      if (e.pointerType === 'mouse') lienzo.classList.toggle('sobre', !!buscarEn(p.x, p.y));
      return;
    }
    punteros.set(e.pointerId, p);
    if (pellizco && punteros.size >= 2) {
      const [a, b] = Array.from(punteros.values());
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2; const cy = (a.y + b.y) / 2;
      camara.mover(cx - pellizco.cx, cy - pellizco.cy);
      if (pellizco.d > 0) camara.zoomEn(cx, cy, d / pellizco.d);
      est.camaraTocada = true;
      pellizco = { d, cx, cy };
      limitarCamara();
    } else if (arrastre) {
      const dx = p.x - arrastre.x; const dy = p.y - arrastre.y;
      if (!arrastre.movido && Math.hypot(dx, dy) > 4) { arrastre.movido = true; lienzo.classList.add('arrastrando'); }
      if (arrastre.movido) {
        est.camaraTocada = true;
        camara.mover(dx, dy);
        limitarCamara();
        arrastre.x = p.x; arrastre.y = p.y;
      }
    }
  });
  const soltar = (e) => {
    const p = posEvento(e);
    if (arrastre && !arrastre.movido && punteros.size === 1 && e.type === 'pointerup') {
      const sel = buscarEn(p.x, p.y);
      if (sel) seleccionar(sel, { origen: lienzo }); else deseleccionar();
    }
    punteros.delete(e.pointerId);
    if (punteros.size < 2) pellizco = null;
    if (!punteros.size) { arrastre = null; lienzo.classList.remove('arrastrando'); }
  };
  lienzo.addEventListener('pointerup', soltar);
  lienzo.addEventListener('pointercancel', soltar);
  lienzo.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = posEvento(e);
    const k = e.ctrlKey ? 0.012 : 0.0016;
    camara.zoomEn(p.x, p.y, Math.exp(-e.deltaY * k));
    est.camaraTocada = true;
    limitarCamara();
  }, { passive: false });
  lienzo.addEventListener('keydown', (e) => {
    const paso = 80;
    const mapaTeclas = {
      ArrowLeft: () => camara.mover(paso, 0), ArrowRight: () => camara.mover(-paso, 0),
      ArrowUp: () => camara.mover(0, paso), ArrowDown: () => camara.mover(0, -paso),
      '+': () => camara.zoomEn(est.ancho / 2, est.alto / 2, 1.2), '=': () => camara.zoomEn(est.ancho / 2, est.alto / 2, 1.2),
      '-': () => camara.zoomEn(est.ancho / 2, est.alto / 2, 1 / 1.2), 0: () => encuadrar(),
    };
    const recorrer = { n: 1, N: 1, PageDown: 1, p: -1, P: -1, PageUp: -1 };
    if (recorrer[e.key]) { e.preventDefault(); moverCursor(recorrer[e.key]); return; }
    if ((e.key === 'Enter' || e.key === ' ') && est.cursor >= 0) {
      const sel = recorrido()[est.cursor];
      if (sel) { e.preventDefault(); seleccionar(sel); }
      return;
    }
    const fn = mapaTeclas[e.key];
    if (fn) { e.preventDefault(); fn(); if (e.key !== '0') est.camaraTocada = true; limitarCamara(); }
  });

  function mandoCamara(id) {
    const paso = 140;
    const acciones = {
      izq: () => camara.mover(paso, 0), der: () => camara.mover(-paso, 0), arriba: () => camara.mover(0, paso), abajo: () => camara.mover(0, -paso),
      mas: () => camara.zoomEn(est.ancho / 2, est.alto / 2, 1.25), menos: () => camara.zoomEn(est.ancho / 2, est.alto / 2, 1 / 1.25),
      encuadrar: () => encuadrar(),
    };
    if (acciones[id]) { acciones[id](); if (id !== 'encuadrar') est.camaraTocada = true; limitarCamara(); }
  }

  // ---------- arranque ----------

  const manejadores = { estado: alEstado, mensaje: alMensaje, agente: alAgente, ejecucion: alEjecucion, conexion: alConexion };
  let fuente = null;
  paneles.iniciar({
    departamentos: mapaMod.DEPARTAMENTOS_POR_DEFECTO,
    comando: (nombre, cuerpo) => (fuente ? fuente.comando(nombre, cuerpo) : Promise.resolve({ ok: false, mensaje: 'Sin conexión con la mesa.' })),
    ajustes: () => (fuente ? fuente.ajustes() : Promise.resolve(null)),
    cerrarSesion: () => (fuente && fuente.cerrarSesion ? fuente.cerrarSesion() : Promise.resolve({ ok: false, mensaje: 'Sin sesión que cerrar.' })),
    instantanea: () => est.inst,
    alCamara: mandoCamara,
    alCerrarTarjeta: () => { est.seleccion = null; },
    alSeleccionar: (sel) => seleccionar(sel),
    ahoraServidor: () => ahoraServidor(),
    // Ficha de un agente → sus decisiones (vista Decisiones filtrada por él).
    alVerDecisiones: PQ.vistas ? (id) => { deseleccionar(); PQ.vistas.abrir('decisiones', { quien: id }); } : null,
  });
  // Informes (Evolución, Estrategias, Noticias, Decisiones, Laboratorio): web/js/vistas.js.
  if (PQ.vistas) {
    PQ.vistas.iniciar({
      instantanea: () => est.inst, ahoraServidor: () => ahoraServidor(), token: TOKEN, maqueta: ES_MAQUETA,
      alCambiar: (abierta) => { if (!abierta) { est.capaClave = ''; est.texturasSucias = true; redimensionar(); } },
      // La cara de quien decidió → su ficha en el parqué; al cerrarla, el foco vuelve a «Informes».
      alVerAgente: (id) => seleccionar({ tipo: 'agente', id }, { origen: document.getElementById('abrir-vistas') }),
    });
  }
  construir(null);
  redimensionar();
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => redimensionar()).observe(escena);
  else raiz.addEventListener('resize', redimensionar);
  fuente = ES_MAQUETA ? PQ.maqueta.fuente(manejadores) : fuenteReal(manejadores);
  requestAnimationFrame(bucle);

  // Ganchos para depurar y para las comprobaciones con navegador.
  raiz.__parque = {
    est, camara, seleccionar, deseleccionar, encuadrar, fuente: () => fuente,
    anclaPuesto(id) {
      const g = est.mapa && est.mapa.puestos.get(id);
      if (!g) return null;
      const a = camara.aPantalla((g.c0 + g.c1) / 2, g.f0 + 0.45, 18);
      const r = lienzo.getBoundingClientRect();
      return { x: a.x + r.left, y: a.y + r.top };
    },
    rendimiento() {
      const s = est.stats;
      return { frames: s.frames, mediaMs: s.frames ? s.msPintar / s.frames : 0, maxMs: s.maxMs };
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
