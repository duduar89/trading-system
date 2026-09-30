// Personajes del parqué: dónde está cada agente, cómo anda entre salas y cómo
// se dibuja; y los bocadillos de lo que dice.
//
// Se mueven por dos cosas reales (§4.5 de la propuesta y §7 `actividad`):
// - cambia su `sala` o su `estado` en la instantánea o en un evento `agente`
//   (comité, descanso): van a su nuevo sitio;
// - la `actividad` del último paso (lo que de verdad hizo cada agente): se
//   levantan, van a mirar su objetivo (la pantalla de cotizaciones, las mesas,
//   el puesto de ejecución, su monitor), se quedan 3–6 s y vuelven a su silla.
//   planificarActividad() reparte la lista a lo largo del intervalo entre pasos
//   (como mucho 40 s) y nunca más allá.
// Andan a 2 teselas/s por las puertas, siguiendo la ruta del mapa. El resto
// (tecleo, algún giro de cabeza) es adorno de dibujo, sin significado.
(function (raiz, fabrica) {
  const esNode = typeof module === 'object' && module.exports;
  const mod = fabrica(esNode ? require('./mapa.js') : raiz.Parque.mapa);
  if (esNode) module.exports = mod;
  else (raiz.Parque = raiz.Parque || {}).personajes = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (mapaMod) {
  'use strict';

  const VELOCIDAD = 2;          // teselas por segundo
  const MAX_BOCADILLOS = 5;
  const MAX_CARACTERES_LINEA = 40;
  const MAX_LINEAS = 3;

  const PIELES = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#f3cfa6', '#d7a07a'];
  const PELOS = ['#2b1d14', '#4a3121', '#6b4423', '#1c1c1c', '#a0522d', '#d6b370', '#8c8c8c', '#3d2b1f'];

  function hash(texto) {
    let h = 0x811c9dc5;
    for (const c of String(texto)) {
      h ^= c.codePointAt(0);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  // Apariencia de un agente, determinista por su id: la comparten el muñeco
  // del parqué y su cara (caras.js), así la cara de Marta tiene la misma piel
  // y el mismo pelo que la Marta que anda por la oficina.
  function aspectoDe(id) {
    const h = hash(id);
    return {
      piel: PIELES[h % PIELES.length],
      pelo: PELOS[(h >>> 4) % PELOS.length],
      peinado: (h >>> 9) % 3,           // 0 corto, 1 largo, 2 moño
      desfase: (h % 1000) / 1000,       // para que no tecleen todos a la vez
    };
  }

  // ---------- bocadillos ----------

  // 6 s + 60 ms por carácter, como mucho 12 s (propuesta-visual §4.6).
  function duracionBocadillo(texto) {
    const n = String(texto || '').length;
    return Math.min(12000, 6000 + 60 * n);
  }

  // Parte en líneas de ≤ 40 caracteres, máximo 3; si sobra, la última acaba en «…».
  function partirTexto(texto, maxCar, maxLineas) {
    const mc = maxCar || MAX_CARACTERES_LINEA;
    const ml = maxLineas || MAX_LINEAS;
    const palabras = String(texto || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    const lineas = [];
    let actual = '';
    let sobra = false;
    for (let k = 0; k < palabras.length; k++) {
      let p = palabras[k];
      while (p.length > mc) {
        // Palabra más larga que una línea: se corta a pelo.
        if (actual) { lineas.push(actual); actual = ''; }
        lineas.push(p.slice(0, mc));
        p = p.slice(mc);
      }
      if (!actual) actual = p;
      else if (actual.length + 1 + p.length <= mc) actual += ' ' + p;
      else { lineas.push(actual); actual = p; }
      if (lineas.length >= ml) { sobra = true; break; }
    }
    if (actual && lineas.length < ml) lineas.push(actual);
    else if (actual) sobra = true;
    if (lineas.length > ml) { lineas.length = ml; sobra = true; }
    if (sobra) {
      let ultima = lineas[ml - 1] || '';
      if (ultima.length >= mc) ultima = ultima.slice(0, mc - 1);
      lineas[ml - 1] = ultima.replace(/[\s.,;:]+$/, '') + '…';
    }
    return lineas;
  }

  // Importancia 0: los de actividad (van detrás de cualquier mensaje real).
  const importanciaDe = x => (Number.isFinite(x.importancia) ? x.importancia : 1);

  // Como mucho 5 a la vez: primero los más importantes y, a igualdad, los más nuevos.
  function elegirBocadillos(candidatos, max) {
    return candidatos
      .slice()
      .sort((a, b) => importanciaDe(b) - importanciaDe(a) || b.desde - a.desde)
      .slice(0, max || MAX_BOCADILLOS);
  }

  // ---------- personaje ----------

  class Personaje {
    constructor(agente, sitio, mapa) {
      this.id = agente.id;
      this.agente = agente;
      this.aspecto = aspectoDe(agente.id);
      this.sitio = sitio;
      this.destino = null;
      this.ruta = [];
      this.paseo = null;          // { fase: 'ida'|'mirar'|'vuelta', punto, mirarMs, ritmo, hasta, texto, mapa }
      this.fase = 0;
      this.bocadillo = null;
      this.textoVisto = '';
      const p = this.puntoObjetivo(sitio, agente.estado, mapa);
      this.col = p.col;
      this.fila = p.fila;
      this.z = mapaMod.elevacionEn(p.col, p.fila);
      this.postura = p.postura;
      this.mira = sitio ? sitio.mira : 'S';
      this.destino = p;
    }

    get andando() { return this.ruta.length > 0; }

    // ¿Está en su sitio de casa, sentado o de pie como toca, y libre para un paseo?
    get libre() { return !this.paseo && !this.andando; }

    // Clave de orden de pintado: la posición en el suelo.
    get clave() { return this.col + this.fila; }

    puntoObjetivo(sitio, estado, mapa) {
      // Operador que espera a que el Ejecutor mande su orden: de pie a su lado.
      if (estado === 'ejecucion' && mapa) {
        const p = puntoEjecucion(mapa, this.id);
        if (p) return { col: p.col, fila: p.fila, postura: 'de_pie', mira: p.mira };
      }
      if (!sitio) return { col: this.col || 10, fila: this.fila || 10, postura: 'de_pie' };
      if (estado === 'de_pie') {
        const p = mapaMod.posicionDePie(mapa, sitio);
        return { col: p.col, fila: p.fila, postura: 'de_pie' };
      }
      return { col: sitio.col, fila: sitio.fila, postura: sitio.postura === 'sentado' ? 'sentado' : 'de_pie' };
    }

    // Nuevo sitio o estado. Si el punto cambia, calcula la ruta (o salta, con
    // movimiento reducido o en la primera carga).
    fijarDestino(sitio, agente, mapa, opciones) {
      const o = opciones || {};
      this.agente = agente;
      this.sitio = sitio;
      const p = this.puntoObjetivo(sitio, agente.estado, mapa);
      const mismo = this.destino && Math.abs(this.destino.col - p.col) < 1e-6 && Math.abs(this.destino.fila - p.fila) < 1e-6;
      this.destino = p;
      // De paseo y con el mismo sitio de vuelta: sigue su paseo. Si le llaman a
      // otro sitio (comité, descanso, kill), lo deja y va para allá.
      if (this.paseo && mismo && !o.instantaneo) return false;
      const cortado = Boolean(this.paseo);
      if (cortado) { this.paseo = null; this.ruta = []; }
      if (mismo && !cortado) {
        if (!this.andando) { this.postura = p.postura; this.mira = p.mira || (sitio ? sitio.mira : this.mira); }
        return false;
      }
      if (o.instantaneo) {
        this.col = p.col; this.fila = p.fila; this.ruta = [];
        this.z = mapaMod.elevacionEn(p.col, p.fila);
        this.postura = p.postura;
        this.mira = p.mira || (sitio ? sitio.mira : this.mira);
        return true;
      }
      const r = mapaMod.ruta(mapa, { col: this.col, fila: this.fila }, p);
      this.ruta = r.slice(1);
      this.postura = 'de_pie';
      return true;
    }

    // Empieza un paseo de actividad: ir a `punto`, mirar `mirarMs` y volver.
    // `ritmo` multiplica la velocidad de andar (para que quepa en el intervalo).
    iniciarPaseo(punto, mapa, o) {
      const op = o || {};
      if (!this.libre || !this.destino) return false;
      this.paseo = { fase: 'ida', punto, mirarMs: op.mirarMs || 3000, ritmo: op.ritmo || 1, hasta: null, texto: op.texto || null, mapa };
      const r = mapaMod.ruta(mapa, { col: this.col, fila: this.fila }, punto);
      this.ruta = r.slice(1);
      this.postura = 'de_pie';
      if (!this.ruta.length) this._llegar(op.ahora || 0);
      return true;
    }

    // Llega al final de una ruta (de paseo o de un cambio de sitio).
    _llegar(ahora) {
      const pa = this.paseo;
      if (pa && pa.fase === 'ida') {
        pa.fase = 'mirar';
        pa.hasta = ahora + pa.mirarMs;
        this.postura = 'de_pie';
        this.mira = pa.punto.mira || this.mira;
        if (pa.texto && !(this.bocadillo && this.bocadillo.hasta > ahora)) {
          this.decir(pa.texto, 0, ahora, Math.min(2600, pa.mirarMs));
        }
        return;
      }
      if (pa && pa.fase === 'vuelta') this.paseo = null;
      if (this.destino) {
        this.postura = this.destino.postura;
        if (this.destino.mira) this.mira = this.destino.mira;
        else if (this.sitio) this.mira = this.sitio.mira;
      }
    }

    actualizar(dt, ahora) {
      const pa = this.paseo;
      if (pa && pa.fase === 'mirar') {
        if (!(ahora >= pa.hasta)) return;
        pa.fase = 'vuelta';
        this.ruta = mapaMod.ruta(pa.mapa, { col: this.col, fila: this.fila }, this.destino).slice(1);
        if (!this.ruta.length) { this._llegar(ahora); return; }
      }
      if (!this.ruta.length) return;
      let resto = VELOCIDAD * (pa ? pa.ritmo : 1) * dt;
      while (resto > 0 && this.ruta.length) {
        const obj = this.ruta[0];
        const dc = obj.col - this.col;
        const df = obj.fila - this.fila;
        const d = Math.hypot(dc, df);
        if (d > 1e-6) this.mira = direccion(dc, df);
        if (d <= resto) {
          this.col = obj.col; this.fila = obj.fila;
          this.ruta.shift();
          resto -= d;
        } else {
          this.col += (dc / d) * resto;
          this.fila += (df / d) * resto;
          resto = 0;
        }
      }
      this.fase += dt * 9 * (pa ? Math.min(3, pa.ritmo) : 1);
      this.z = mapaMod.elevacionEn(this.col, this.fila);
      if (!this.ruta.length) this._llegar(ahora);
    }

    // `ms`: duración a mano (los de actividad son cortos); si no, la de siempre.
    decir(texto, importancia, ahora, ms) {
      if (!texto) return;
      const imp = importancia === 0 ? 0 : (importancia || 1);
      this.bocadillo = { texto: String(texto), importancia: imp, desde: ahora, hasta: ahora + (ms > 0 ? ms : duracionBocadillo(texto)) };
    }
  }

  // Dirección a la que mira quien se mueve (dc, df).
  function direccion(dc, df) {
    if (Math.abs(dc) >= Math.abs(df)) return dc >= 0 ? 'E' : 'O';
    return df >= 0 ? 'S' : 'N';
  }

  // ---------- elenco: todos los personajes ----------

  function crearElenco() {
    const personajes = new Map();
    let programados = [];         // paseos de actividad que aún no han empezado
    let ultimaActividadT = null;  // dedupe: cada paso se reproduce una vez
    return {
      personajes,
      get programados() { return programados.slice(); },
      get ultimaActividadT() { return ultimaActividadT; },
      // Reparte la actividad de un paso nuevo (dedupe por su t). → paseos programados.
      programarActividad(actividad, entrada) {
        if (!actividad || !Number.isFinite(actividad.t)) return [];
        if (ultimaActividadT !== null && actividad.t <= ultimaActividadT) return [];
        ultimaActividadT = actividad.t;
        const e = entrada || {};
        if (e.reducir) return [];
        const ocupados = new Set();
        for (const p of personajes.values()) if (p.paseo) ocupados.add(p.id);
        for (const x of programados) ocupados.add(x.id);
        const plan = planificarActividad(Object.assign({}, e, { actividad, ocupados, personajes }));
        programados = programados.concat(plan);
        return plan;
      },
      // Crea los nuevos donde les toca, quita a los que ya no están y manda a
      // cada uno a su sitio.
      sincronizar(agentes, mapa, asignacion, opciones) {
        const o = opciones || {};
        const vivos = new Set();
        for (const a of agentes || []) {
          vivos.add(a.id);
          const sitio = asignacion.get(a.id);
          const agente = o.forzarDePie ? Object.assign({}, a, { estado: 'de_pie' }) : a;
          let p = personajes.get(a.id);
          if (!p) {
            p = new Personaje(agente, sitio, mapa);
            personajes.set(a.id, p);
          } else {
            p.fijarDestino(sitio, agente, mapa, { instantaneo: o.instantaneo });
          }
        }
        for (const id of Array.from(personajes.keys())) if (!vivos.has(id)) personajes.delete(id);
      },
      // `ahora`: el mismo reloj que se dio a programarActividad (performance.now()).
      actualizar(dt, ahora) {
        const t = Number.isFinite(ahora) ? ahora : 0;
        if (programados.length) {
          const quedan = [];
          for (const x of programados) {
            if (x.inicio > t) { quedan.push(x); continue; }
            const p = personajes.get(x.id);
            // Si entre tanto se fue al comité, al descanso o anda por otra cosa, no sale.
            if (!p || !p.libre || !elegible(p.agente, p.sitio, x.departamentos)) continue;
            p.iniciarPaseo(x.punto, x.mapa, { mirarMs: x.mirarMs, ritmo: x.ritmo, texto: x.texto, ahora: t });
          }
          programados = quedan;
        }
        for (const p of personajes.values()) p.actualizar(dt, t);
      },
      // ¿Anda alguien? Para el ritmo de pintado (quien mira quieto no cuenta).
      hayMovimiento() {
        for (const p of personajes.values()) if (p.andando) return true;
        return false;
      },
      lista() { return Array.from(personajes.values()); },
    };
  }


  // ---------- actividad del paso: planificación de paseos ----------

  const PASO_SINTETICO_MS = 5 * 60 * 1000;
  const VENTANA_MAX_MS = 40000;
  const MIRAR_MIN_MS = 3000;
  const MIRAR_MAX_MS = 6000;

  // Intervalo real entre dos pasos: el del cron en el modo web (latidoMs); en
  // el local sintético, 5 min simulados / velocidad; en el local real, 60 s.
  function intervaloPasoMs(inst) {
    const i = inst || {};
    if (Number.isFinite(i.latidoMs) && i.latidoMs > 0) return i.latidoMs;
    if (i.modo === 'sintetico') return PASO_SINTETICO_MS / Math.max(1, Number(i.velocidad) || 1);
    return 60000;
  }

  // Cuánto tiempo real hay para reproducir la actividad: ~40 s, nunca más del
  // 90 % del intervalo entre pasos, menos lo que ya pasó desde el paso.
  function ventanaActividad(inst, edadMs) {
    const total = Math.min(VENTANA_MAX_MS, 0.9 * intervaloPasoMs(inst));
    return Math.max(0, total - Math.max(0, edadMs || 0));
  }

  // Solo sale a pasear quien trabaja en su sala de casa: ni el comité, ni el
  // descanso, ni el banquillo, ni de pie por el kill.
  function elegible(agente, sitio, departamentos) {
    if (!agente || !sitio) return false;
    const estado = agente.estado || 'trabajando';
    if (estado !== 'trabajando') return false;
    const casa = mapaMod.salaCasa(agente, departamentos);
    return mapaMod.salaDeAgente(agente, departamentos) === casa && sitio.sala === casa;
  }

  // Punto libre (sin mueble ni tabique) de la sala más cercano a (col, fila).
  function puntoLibre(mapa, col, fila, sala) {
    const rej = mapa.rejilla;
    const ok = (c, f) => {
      if (c < 0 || f < 0 || c >= mapaMod.COLS || f >= mapaMod.FILAS) return false;
      const cel = mapaMod.celdaDe(c, f);
      return mapaMod.libre(rej, cel.i, cel.j) && mapaMod.salaEn(c, f) === sala;
    };
    if (ok(col, fila)) return { col, fila };
    for (let r = 1; r <= 8; r++) {
      const d = r * mapaMod.CELDA;
      for (const [dc, df] of [[0, d], [d, 0], [-d, 0], [0, -d], [d, d], [-d, d], [d, -d], [-d, -d]]) {
        const c = Math.floor((col + dc) / mapaMod.CELDA) * mapaMod.CELDA + mapaMod.CELDA / 2;
        const f = Math.floor((fila + df) / mapaMod.CELDA) * mapaMod.CELDA + mapaMod.CELDA / 2;
        if (ok(c, f)) return { col: c, fila: f };
      }
    }
    return null;
  }

  // Junto al puesto del Ejecutor, de pie y mirándolo: donde espera el operador
  // cuya orden aún no ha salido. Hasta cuatro a la vez sin pisarse (el sitio
  // sale de un hash del id: siempre el mismo para el mismo operador).
  function puntoEjecucion(mapa, id) {
    const s = (mapa.sitios && mapa.sitios.riesgos || []).find(x => x.preferente === 'ejecutor');
    if (!s) return null;
    const k = hash(String(id || '')) % 4;
    const d = [[-1.2, 0.1], [-1.2, 0.95], [-2.0, 0.5], [-2.0, -0.4]][k];
    const p = puntoLibre(mapa, s.col + d[0], s.fila + d[1], 'riesgos');
    return p ? { col: p.col, fila: p.fila, mira: 'E' } : null;
  }

  // Punto al que va cada objetivo (y hacia dónde mira allí). null = no se mueve.
  function puntoDeObjetivo(mapa, entrada, sitio, semilla) {
    const obj = entrada.objetivo;
    if (obj === 'monitor') {
      const p = mapaMod.posicionDePie(mapa, sitio);
      return { col: p.col, fila: p.fila, mira: sitio.mira };
    }
    if (obj === 'pantalla-cotizaciones') {
      // Frente a la pantalla gigante de la pared del fondo (fila 0, cols 2–18).
      const col = 4 + (semilla % 6) * 2.2;
      const p = puntoLibre(mapa, col, 1.75, 'parque');
      return p ? { col: p.col, fila: p.fila, mira: 'N' } : null;
    }
    if (obj === 'mesas') {
      // Detrás del operador del puesto (el de la propuesta) o, si no hay, de uno al azar fijo.
      let g = entrada.puestoId && mapa.puestos.get(entrada.puestoId);
      if (!g) {
        const lista = Array.from(mapa.puestos.values());
        if (!lista.length) return null;
        g = lista[semilla % lista.length];
      }
      const p = puntoLibre(mapa, g.sitio.col + 0.6, g.sitio.fila + 0.55, 'parque');
      return p ? { col: p.col, fila: p.fila, mira: 'N' } : null;
    }
    if (obj === 'ejecucion') {
      const s = (mapa.sitios.riesgos || []).find(x => x.preferente === 'ejecutor');
      if (!s) return null;
      const p = puntoLibre(mapa, s.col - 1.2, s.fila + 0.1, 'riesgos');
      return p ? { col: p.col, fila: p.fila, mira: 'E' } : null;
    }
    if (obj === 'pantalla-regimen') {
      const p = puntoLibre(mapa, 21.75, 4.75, 'macro');
      return p ? { col: p.col, fila: p.fila, mira: 'N' } : null;
    }
    return null;   // sala-comite: al comité van por su estado (reunion), no de paseo
  }

  // Frase corta del bocadillo: de la acción, sin cifras.
  function textoActividad(x) {
    const d = x.detalle || '';
    switch (x.accion) {
      case 'precios': return 'Precios al día';
      case 'conciliacion': return 'Cuadre con el bróker';
      case 'riesgo': return d === 'propuesta' ? 'Reviso la propuesta' : 'Límites revisados';
      case 'regimen': return 'Régimen recalculado';
      case 'nota': return d ? `Nota técnica de ${d}` : 'Nota técnica';
      case 'senal': return d === 'abrir' ? 'Señal: abrir' : d === 'cerrar' ? 'Señal: cerrar' : 'Señal: sin cambio';
      case 'orden': {
        const [lado, etq] = d.split(' ');
        return lado === 'compra' || lado === 'venta' ? `Orden de ${lado}${etq ? ` de ${etq}` : ''}` : 'Orden enviada';
      }
      default: return null;
    }
  }

  function largoRuta(r) {
    let d = 0;
    for (let k = 1; k < r.length; k++) d += Math.hypot(r[k].col - r[k - 1].col, r[k].fila - r[k - 1].fila);
    return d;
  }

  // Reparte la lista de un paso en paseos a lo largo de `ventanaMs` desde
  // `ahora`. Determinista (misma entrada → mismo plan). Reglas:
  // - solo agentes elegibles (trabajando en su sala de casa) y con sitio;
  // - nadie con un paseo en marcha o pendiente (`ocupados`) sale otra vez;
  // - un mismo agente con varias entradas las hace una tras otra, sin solapar;
  //   la que no quepa en la ventana no se hace;
  // - ida + mirar (3–6 s) + vuelta caben en la ventana: si no, se anda más
  //   deprisa y se mira menos, en la misma proporción.
  // → [{ id, accion, objetivo, inicio, fin, mirarMs, ritmo, punto, texto, mapa }]
  function planificarActividad(entrada) {
    const e = entrada || {};
    const act = e.actividad;
    const mapa = e.mapa;
    const ventana = e.ventanaMs || 0;
    if (!act || !Array.isArray(act.lista) || !mapa || !(ventana >= 1500)) return [];
    const ahora = e.ahora || 0;
    const ritmoBase = Math.max(1, e.ritmoBase || 1);
    const agentes = new Map((e.agentes || []).map(a => [a.id, a]));
    const asignacion = e.asignacion || new Map();
    const ocupados = e.ocupados || new Set();
    const candidatos = [];
    for (const x of act.lista) {
      const a = agentes.get(x.agente);
      const sitio = asignacion.get(x.agente);
      if (!a || !sitio || ocupados.has(a.id) || !elegible(a, sitio, e.departamentos)) continue;
      const semilla = hash(`${act.t}|${x.agente}|${x.accion}|${x.puestoId || ''}`);
      const punto = puntoDeObjetivo(mapa, x, sitio, semilla);
      if (!punto) continue;
      const ida = largoRuta(mapaMod.ruta(mapa, { col: sitio.col, fila: sitio.fila }, punto));
      const vuelta = largoRuta(mapaMod.ruta(mapa, punto, { col: sitio.col, fila: sitio.fila }));
      // +10 %: margen para los giros de la ruta y los fotogramas.
      candidatos.push({ x, a, punto, semilla, andarMs: ((ida + vuelta) / (VELOCIDAD * ritmoBase)) * 1000 * 1.1 });
    }
    const n = candidatos.length;
    const libreDesde = new Map();   // agente → cuándo acaba su último paseo del plan
    const plan = [];
    candidatos.forEach((c, k) => {
      const mirar0 = MIRAR_MIN_MS + (c.semilla % (MIRAR_MAX_MS - MIRAR_MIN_MS + 1));
      const total = c.andarMs + mirar0;
      // Arranques repartidos por la ventana, en el orden del paso; el segundo
      // paseo de un mismo agente, cuando acaba el primero.
      const previo = libreDesde.get(c.a.id);
      const desde = previo !== undefined ? previo + 300 : 0;
      const cabe = (ventana - desde) * 0.9;
      // No cabe entero: se anda más deprisa y se mira menos, en la misma
      // proporción, hasta ×3 (más ya no parece andar); si ni así, no se hace.
      let f = 1;
      if (total > cabe) {
        f = cabe / total;
        if (previo !== undefined && f < 1 / 3) return;
      }
      const dura = total * f;
      const mirar = Math.round(mirar0 * f);
      const ritmo = 1 / f;
      let inicio = Math.min((k / Math.max(1, n)) * ventana, ventana - dura);
      inicio = Math.max(inicio, desde);
      if (inicio + dura > ventana + 1e-6) return;
      libreDesde.set(c.a.id, inicio + dura);
      plan.push({
        id: c.a.id, accion: c.x.accion, objetivo: c.x.objetivo, puestoId: c.x.puestoId || null,
        inicio: ahora + Math.round(inicio), fin: ahora + Math.round(inicio + dura), mirarMs: mirar, ritmo,
        punto: c.punto, texto: textoActividad(c.x), mapa, departamentos: e.departamentos,
      });
    });
    return plan;
  }

  // ---------- dibujo (coordenadas de mundo) ----------

  const P = (c, f, z) => ({ x: (c - f) * 32, y: (c + f) * 16 - (z || 0) });
  const ESCALA = 1.15;

  function oscurecer(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const f = x => Math.max(0, Math.min(255, Math.round(x * (1 - k))));
    return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
  }
  function aclarar(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const f = x => Math.round(x + (255 - x) * k);
    return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
  }

  function rect(ctx, x, y, w, h, r, relleno, borde) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
    ctx.fillStyle = relleno;
    ctx.fill();
    if (borde) { ctx.strokeStyle = borde; ctx.stroke(); }
  }

  // Cuadro envolvente en mundo (para saber si el ratón le toca).
  function cajaPersonaje(p) {
    const b = P(p.col, p.fila, p.z);
    const alto = (p.postura === 'sentado' ? 26 : 30) * ESCALA;
    return { x0: b.x - 8 * ESCALA, x1: b.x + 8 * ESCALA, y0: b.y - alto - 2, y1: b.y + 3 };
  }

  // Punto sobre la cabeza (para anclar el bocadillo).
  function cabeza(p) {
    const b = P(p.col, p.fila, p.z);
    return { x: b.x, y: b.y - (p.postura === 'sentado' ? 30 : 34) * ESCALA };
  }

  function pintarPersonaje(ctx, p, o) {
    const t = o.t || 0;
    const color = o.color || '#3b82f6';
    const mov = o.movimiento !== false;
    const b = P(p.col, p.fila, p.z);
    const sentado = p.postura === 'sentado' && !p.andando;
    const frente = p.mira === 'S' || p.mira === 'E';
    const volteo = p.mira === 'O' || p.mira === 'S' ? -1 : 1;
    const estado = p.agente && p.agente.estado;
    const hablando = p.bocadillo && p.bocadillo.hasta > o.ahora;

    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.scale(ESCALA, ESCALA);
    if (estado === 'banquillo') ctx.globalAlpha = 0.45;
    ctx.lineWidth = 0.9;
    const contorno = 'rgba(14, 18, 34, 0.6)';

    // Anillo de seleccionado, bajo los pies.
    if (o.seleccionado) {
      const r = 9 + (mov ? Math.sin(t / 220) * 1.2 : 0);
      ctx.fillStyle = 'rgba(251, 191, 36, 0.22)';
      ctx.beginPath(); ctx.ellipse(0, 0, r + 2, (r + 2) / 2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.ellipse(0, 0, r, r / 2, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 0.9;
    }
    // Sombra.
    if (!sentado) {
      ctx.fillStyle = 'rgba(15, 20, 40, 0.22)';
      ctx.beginPath(); ctx.ellipse(0, 0, 6.5, 3.2, 0, 0, Math.PI * 2); ctx.fill();
    }

    const andar = p.andando && mov;
    const paso = andar ? Math.sin(p.fase) : 0;
    const bote = andar ? Math.abs(Math.sin(p.fase)) * 1.1 : 0;
    const cadera = sentado ? -9.5 : -7 - bote;
    const pantalon = '#27304a';

    // Piernas.
    if (!sentado) {
      rect(ctx, -3.6, cadera, 3, 7 + (paso > 0 ? -paso * 1.4 : 0) + bote, 1, pantalon, null);
      rect(ctx, 0.6, cadera, 3, 7 + (paso < 0 ? paso * 1.4 : 0) + bote, 1, pantalon, null);
      rect(ctx, -3.9, -1.6 - (paso > 0 ? paso * 1.4 : 0), 3.6, 1.8, 0.8, '#151a2a', null);
      rect(ctx, 0.3, -1.6 - (paso < 0 ? -paso * 1.4 : 0), 3.6, 1.8, 0.8, '#151a2a', null);
    } else if (frente) {
      // Sentado de cara: se ven los muslos hacia delante.
      rect(ctx, -4, cadera - 1, 8, 3.2, 1.2, pantalon, null);
      rect(ctx, -3.6, cadera + 2, 2.8, 6, 1, pantalon, null);
      rect(ctx, 0.8, cadera + 2, 2.8, 6, 1, pantalon, null);
    }

    // Tronco con volumen: mitad clara, mitad oscura.
    const alto = 11;
    const yTronco = cadera - alto;
    rect(ctx, -5, yTronco, 10, alto + 1, 3, color, contorno);
    ctx.save();
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-5, yTronco, 10, alto + 1, 3); else ctx.rect(-5, yTronco, 10, alto + 1);
    ctx.clip();
    ctx.fillStyle = oscurecer(color, 0.22);
    ctx.fillRect(volteo > 0 ? 1 : -5, yTronco, 4, alto + 1);
    ctx.fillStyle = aclarar(color, 0.18);
    ctx.fillRect(-5, yTronco, 10, 1.6);
    ctx.restore();
    if (frente) {
      // Cuello de la camisa.
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath(); ctx.moveTo(-2, yTronco + 0.4); ctx.lineTo(0, yTronco + 2.6); ctx.lineTo(2, yTronco + 0.4); ctx.closePath(); ctx.fill();
    }

    // Brazos.
    const brazo = oscurecer(color, 0.12);
    const trabajando = sentado && (estado === 'trabajando' || !estado);
    if (trabajando && !frente) {
      // Tecleo: codos que suben y bajan a ráfagas.
      const r = mov ? rafaga(t, p.aspecto.desfase) : 0;
      const a1 = mov ? Math.sin(t / 55 + p.aspecto.desfase * 10) * r : 0;
      const a2 = mov ? Math.sin(t / 55 + 2 + p.aspecto.desfase * 10) * r : 0;
      rect(ctx, -7, yTronco + 2 + a1, 2.6, 6, 1.2, brazo, contorno);
      rect(ctx, 4.4, yTronco + 2 + a2, 2.6, 6, 1.2, brazo, contorno);
    } else if (sentado) {
      // De cara: las manos, con un vaivén pequeño si trabaja (adorno).
      const r = trabajando && mov ? rafaga(t, p.aspecto.desfase) * 0.5 : 0;
      const m1 = r ? Math.sin(t / 60 + p.aspecto.desfase * 10) * r : 0;
      const m2 = r ? Math.sin(t / 60 + 2 + p.aspecto.desfase * 10) * r : 0;
      rect(ctx, -6.8, yTronco + 2, 2.4, 7, 1.2, brazo, contorno);
      rect(ctx, 4.4, yTronco + 2, 2.4, 7, 1.2, brazo, contorno);
      ctx.fillStyle = p.aspecto.piel;
      ctx.beginPath(); ctx.arc(-5.6, yTronco + 9.4 + m1, 1.3, 0, Math.PI * 2); ctx.arc(5.6, yTronco + 9.4 + m2, 1.3, 0, Math.PI * 2); ctx.fill();
    } else {
      const s = andar ? paso * 1.8 : 0;
      rect(ctx, -7, yTronco + 1.5 + s, 2.4, 8, 1.2, brazo, contorno);
      rect(ctx, 4.6, yTronco + 1.5 - s, 2.4, 8, 1.2, brazo, contorno);
      ctx.fillStyle = p.aspecto.piel;
      ctx.beginPath(); ctx.arc(-5.8, yTronco + 10 + s, 1.3, 0, Math.PI * 2); ctx.arc(5.8, yTronco + 10 - s, 1.3, 0, Math.PI * 2); ctx.fill();
    }

    // Cabeza.
    const asiente = hablando && mov ? Math.sin(t / 140) * 0.6 : 0;
    const cy = yTronco - 4.6 + asiente;
    // Giro de cabeza de adorno (solo sentados trabajando): la cara se asoma
    // por un lado y el pelo se corre al otro. Suave, sin rebote.
    const giro = trabajando && mov ? giroCabeza(t, p.aspecto.desfase) : 0;
    const hx = giro * 0.7;
    ctx.fillStyle = p.aspecto.piel;
    ctx.beginPath(); ctx.arc(hx, cy, 4.7, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = contorno; ctx.stroke();
    ctx.fillStyle = p.aspecto.pelo;
    if (frente) {
      ctx.beginPath(); ctx.arc(hx, cy - 0.6, 4.9, Math.PI * 1.02, Math.PI * 1.98); ctx.closePath(); ctx.fill();
      if (p.aspecto.peinado === 1) { rect(ctx, hx - 5.2, cy - 2, 2, 6.5, 1, p.aspecto.pelo, null); rect(ctx, hx + 3.2, cy - 2, 2, 6.5, 1, p.aspecto.pelo, null); }
      ctx.fillStyle = '#1b1b24';
      const ojos = hx + giro * 0.9;
      ctx.fillRect(ojos - 2.2 * volteo - 0.6, cy + 0.2, 1.3, 1.5);
      ctx.fillRect(ojos + 1.2 * volteo - 0.6, cy + 0.2, 1.3, 1.5);
      if (hablando) { ctx.fillStyle = '#7a2e2e'; ctx.fillRect(ojos - 0.9, cy + 2.6, 1.8, 0.9 + Math.abs(asiente)); }
    } else {
      const px = hx - giro * 1.3;
      ctx.beginPath(); ctx.arc(px, cy - 0.3, 4.85, Math.PI * 0.92, Math.PI * 2.08); ctx.closePath(); ctx.fill();
      if (p.aspecto.peinado === 1) rect(ctx, px - 4.4, cy, 8.8, 5.5, 2, p.aspecto.pelo, null);
      if (p.aspecto.peinado === 2) { ctx.beginPath(); ctx.arc(px, cy - 4.8, 2.1, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.restore();
  }

  // Giro de cabeza: ~1,2 s cada 9–16 s (según el agente), a un lado u otro.
  // Va de 0 a ±1 y vuelve a 0 con una media onda: sin pasarse ni rebotar.
  function giroCabeza(t, desfase) {
    const periodo = 9000 + desfase * 7000;
    const tt = t + desfase * 50000;
    const x = tt % periodo;
    if (x > 1200) return 0;
    const lado = Math.floor(tt / periodo) % 2 ? 1 : -1;
    return lado * Math.sin((x / 1200) * Math.PI);
  }

  // Ráfagas de tecleo: a ratos teclea, a ratos no (si no, parece una máquina).
  function rafaga(t, desfase) {
    const x = Math.sin(t / 1300 + desfase * 17) + Math.sin(t / 530 + desfase * 5);
    return x > 0.2 ? 1.1 : 0.15;
  }

  // ---------- bocadillos (coordenadas de pantalla CSS) ----------

  function medirBocadillo(ctx, lineas) {
    let w = 0;
    for (const l of lineas) w = Math.max(w, ctx.measureText(l).width);
    return { w: Math.ceil(w) + 18, h: lineas.length * 14 + 11 };
  }

  // Coloca y pinta los bocadillos elegidos sin que se pisen: si uno choca con
  // otro ya puesto, sube.
  function pintarBocadillos(ctx, elegidos, o) {
    const puestos = [];
    ctx.font = `500 11px ${o.fuente || 'system-ui, sans-serif'}`;
    ctx.textBaseline = 'alphabetic';
    const orden = elegidos.slice().sort((a, b) => b.y - a.y);
    for (const e of orden) {
      const lineas = partirTexto(e.texto);
      const m = medirBocadillo(ctx, lineas);
      let x = Math.round(e.x - m.w / 2);
      let y = Math.round(e.y - m.h - 9);
      x = Math.max(6, Math.min(o.ancho - m.w - 6, x));
      for (let intento = 0; intento < 12; intento++) {
        const choque = puestos.find(r => x < r.x + r.w + 4 && x + m.w + 4 > r.x && y < r.y + r.h + 4 && y + m.h + 4 > r.y);
        if (!choque) break;
        y = choque.y - m.h - 6;
      }
      y = Math.max(4, y);
      puestos.push({ x, y, w: m.w, h: m.h });
      const vida = Math.min(1, (o.ahora - e.desde) / 160, (e.hasta - o.ahora) / 400);
      ctx.save();
      ctx.globalAlpha = o.movimiento === false ? 1 : Math.max(0, vida);
      // Sombra, cuerpo, cola.
      ctx.fillStyle = 'rgba(8, 12, 28, 0.28)';
      rect(ctx, x + 1, y + 2, m.w, m.h, 7, 'rgba(8, 12, 28, 0.28)', null);
      rect(ctx, x, y, m.w, m.h, 7, 'rgba(255,255,255,0.97)', 'rgba(15,20,36,0.18)');
      const colaX = Math.max(x + 10, Math.min(x + m.w - 10, e.x));
      ctx.fillStyle = 'rgba(255,255,255,0.97)';
      ctx.beginPath(); ctx.moveTo(colaX - 5, y + m.h - 0.5); ctx.lineTo(e.x, Math.min(e.y - 1, y + m.h + 8)); ctx.lineTo(colaX + 5, y + m.h - 0.5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = e.color || '#3b82f6';
      rect(ctx, x + 4, y + 5, 2.5, m.h - 10, 1.2, e.color || '#3b82f6', null);
      ctx.fillStyle = '#111827';
      lineas.forEach((l, k) => ctx.fillText(l, x + 11, y + 16 + k * 14));
      ctx.restore();
    }
    return puestos;
  }

  return {
    VELOCIDAD, MAX_BOCADILLOS, MAX_CARACTERES_LINEA, MAX_LINEAS, ESCALA,
    Personaje, crearElenco, planificarActividad, intervaloPasoMs, ventanaActividad, textoActividad, elegible, puntoDeObjetivo, puntoEjecucion,
    duracionBocadillo, partirTexto, elegirBocadillos, direccion,
    pintarPersonaje, pintarBocadillos, cajaPersonaje, cabeza, hash, giroCabeza, rafaga,
    PIELES, PELOS, aspectoDe,
  };
});
