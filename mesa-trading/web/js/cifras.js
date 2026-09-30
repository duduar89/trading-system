// Cifras del parqué: formato en español y números que cuentan hacia arriba.
//
// El navegador no puede cargar src/util/formato.js (es CommonJS del servidor),
// así que aquí se reproducen sus MISMAS reglas; test/parque-cifras.test.js
// compara las dos salidas con una batería de valores para que no se separen.
// Script clásico (window.Parque.cifras) y a la vez módulo CommonJS para las pruebas.
(function (raiz, fabrica) {
  const mod = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (raiz.Parque = raiz.Parque || {}).cifras = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const cacheNf = new Map();
  function nf(min, max) {
    const clave = min + '|' + max;
    if (!cacheNf.has(clave)) {
      cacheNf.set(clave, new Intl.NumberFormat('es-ES', {
        minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: true,
      }));
    }
    return cacheNf.get(clave);
  }

  // es-ES no agrupa los números de 4 cifras (1234); en dinero se quiere 1.234.
  // El signo menos solo se escribe si queda algún dígito distinto de cero: un
  // −0,00001 redondeado es «0,00 %», no «-0,00 %» (se leía como una pérdida).
  function agrupar(texto) {
    const partes = texto.split(',');
    const ent = partes[0];
    const dec = partes[1];
    const signo = ent.startsWith('-') && /[1-9]/.test(texto) ? '-' : '';
    const digitos = ent.replace(/^-/, '').replace(/\./g, '');
    const conPuntos = digitos.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return signo + conPuntos + (dec !== undefined ? ',' + dec : '');
  }

  const valido = x => typeof x === 'number' && Number.isFinite(x);

  // Dólares: sin decimales a partir de 1.000, con dos por debajo (igual que formato.usd).
  function usd(x, opciones) {
    const signo = Boolean(opciones && opciones.signo);
    if (!valido(x)) return '—';
    const abs = Math.abs(x);
    const cuerpo = agrupar(abs >= 1000 ? nf(0, 0).format(x) : nf(2, 2).format(x));
    return (signo && x > 0 && /[1-9]/.test(cuerpo) ? '+' : '') + cuerpo + ' $';
  }

  // Fracción → porcentaje: 0.0125 → «1,25 %».
  function pct(fraccion, opciones) {
    const decimales = opciones && Number.isInteger(opciones.decimales) ? opciones.decimales : 2;
    const signo = Boolean(opciones && opciones.signo);
    if (!valido(fraccion)) return '—';
    const v = fraccion * 100;
    const cuerpo = agrupar(nf(decimales, decimales).format(v));
    return (signo && v > 0 && /[1-9]/.test(cuerpo) ? '+' : '') + cuerpo + ' %';
  }

  // Precio de un activo: más decimales cuanto más barato (DOGE 0,1234; BTC 83.547).
  function precio(x) {
    if (!valido(x)) return '—';
    const abs = Math.abs(x);
    const dec = abs >= 1000 ? 0 : abs >= 10 ? 2 : abs >= 1 ? 3 : 4;
    return agrupar(nf(dec, dec).format(x));
  }

  function cantidad(x, maxDecimales) {
    if (!valido(x)) return '—';
    return agrupar(nf(0, maxDecimales === undefined ? 6 : maxDecimales).format(x));
  }

  function numero(x, decimales) {
    if (!valido(x)) return '—';
    const d = decimales === undefined ? 0 : decimales;
    return agrupar(nf(d, d).format(x));
  }

  // Zona de todas las horas del panel: la misma que usan los textos del
  // servidor (src/util/formato.js). Con la del navegador, un portátil en UTC
  // decía «12:00 · Abro el comité de las 14:00».
  const ZONA = 'Europe/Madrid';
  const cacheDtf = new Map();
  function dtf(op, zona) {
    const clave = JSON.stringify(op) + '|' + zona;
    if (!cacheDtf.has(clave)) cacheDtf.set(clave, new Intl.DateTimeFormat('es-ES', Object.assign({ timeZone: zona }, op)));
    return cacheDtf.get(clave);
  }

  // Hora HH:MM en la zona del panel (Madrid salvo que se diga otra).
  function hora(t, zona) {
    if (!valido(t)) return '—';
    return dtf({ hour: '2-digit', minute: '2-digit' }, zona || ZONA).format(new Date(t));
  }

  // Día de calendario «AAAA-MM-DD» de un instante en la zona dada.
  function dia(t, zona) {
    if (!valido(t)) return null;
    const partes = {};
    for (const p of dtf({ year: 'numeric', month: '2-digit', day: '2-digit' }, zona || ZONA).formatToParts(new Date(t))) partes[p.type] = p.value;
    return `${partes.year}-${partes.month}-${partes.day}`;
  }

  // «5 oct»: fecha corta para separar días en el feed.
  function fechaCorta(t, zona) {
    if (!valido(t)) return '—';
    return dtf({ day: 'numeric', month: 'short' }, zona || ZONA).format(new Date(t)).replace(/\.$/, '');
  }

  // Un instante del pasado contado para quien mira «ahora» (el reloj de la
  // mesa, nunca Date.now(): en sintético no coinciden): «10:00» si es del
  // mismo día y «5 oct 10:00» si no, para que una ejecución de hace tres días
  // no se lea como de esta mañana.
  function momento(t, ahora, zona) {
    if (!valido(t)) return '—';
    if (valido(ahora) && dia(t, zona) === dia(ahora, zona)) return hora(t, zona);
    return `${fechaCorta(t, zona)} ${hora(t, zona)}`;
  }

  // Lo que va detrás de «hasta»: «las 21:55» si acaba hoy y «el 3 oct 21:55»
  // si no (el formato de momento): una directiva de 72 h «hasta las 21:55»
  // se leía como de hoy y parecía caducada. Sin `ahora`, solo la hora.
  function hastaLas(t, ahora, zona) {
    if (!valido(t)) return '—';
    if (!valido(ahora) || dia(t, zona) === dia(ahora, zona)) return `las ${hora(t, zona)}`;
    return `el ${momento(t, ahora, zona)}`;
  }
  // Lo mismo sin artículo, para las píldoras: «21:55» o «3 oct 21:55».
  const cuando = (t, ahora) => (valido(ahora) ? momento(t, ahora) : hora(t));

  // «hace 3 min», «hace 2 h», «hace 4 d» (antigüedad en ms).
  function hace(ms) {
    if (!valido(ms)) return '—';
    const s = Math.max(0, ms / 1000);
    if (s < 90) return `hace ${Math.round(s)} s`;
    if (s < 90 * 60) return `hace ${Math.round(s / 60)} min`;
    if (s < 36 * 3600) return `hace ${Math.round(s / 3600)} h`;
    return `hace ${Math.round(s / 86400)} d`;
  }

  // Cuenta atrás «HH:MM» (redondeando hacia arriba: con 30 s quedan «00:01», no «00:00»).
  function cuentaAtras(ms) {
    if (!valido(ms) || ms <= 0) return '00:00';
    const minutos = Math.ceil(ms / 60000);
    const h = Math.floor(minutos / 60);
    const m = minutos % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }

  // Clase de color de una cifra con signo.
  function claseSigno(x, umbral) {
    const u = umbral || 0;
    if (!valido(x)) return 'cero';
    if (x > u) return 'pos';
    if (x < -u) return 'neg';
    return 'cero';
  }

  // Curva ease-out cúbica: monótona y sin pasarse de 1 (en cifras de negocio un
  // número que se pasa y vuelve se lee como un error de cálculo).
  function suavizar(p) {
    const q = Math.min(1, Math.max(0, p));
    return 1 - Math.pow(1 - q, 3);
  }

  function reducirMovimiento() {
    try {
      return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (_) {
      return false;
    }
  }

  // Anima el texto de un elemento desde su último valor (0 la primera vez) hasta
  // `valor`, en `duracion` ms. Con movimiento reducido, salta al final.
  function animar(el, valor, formatear, opciones) {
    if (!el) return;
    const duracion = (opciones && opciones.duracion) || 500;
    const fmt = formatear || (x => numero(x));
    if (!valido(valor)) {
      el.textContent = fmt(valor);
      el._cifra = { valor: null };
      return;
    }
    const previo = el._cifra && valido(el._cifra.valor) ? el._cifra.valor : 0;
    if (el._cifra && el._cifra.raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(el._cifra.raf);
    const estado = { valor, raf: 0 };
    el._cifra = estado;
    if (previo === valor || reducirMovimiento() || typeof requestAnimationFrame !== 'function') {
      el.textContent = fmt(valor);
      return;
    }
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const paso = (ahora) => {
      if (el._cifra !== estado) return;
      const p = (ahora - t0) / duracion;
      const v = p >= 1 ? valor : previo + (valor - previo) * suavizar(p);
      el.textContent = fmt(v);
      if (p < 1) estado.raf = requestAnimationFrame(paso);
    };
    estado.raf = requestAnimationFrame(paso);
  }

  // ---------- lectura de la instantánea (común a barra, lienzo y tarjeta) ----------

  // Rótulos con tilde: el dato viaja como id («incubacion»), la pantalla dice la palabra.
  const ESTADO_MESA = { titular: 'Titular', incubacion: 'Incubación', banquillo: 'Banquillo' };
  const MODO_COMITE = { NORMAL: 'NORMAL', DEFENSIVO: 'DEFENSIVO', SOLO_CERRAR: 'SOLO CERRAR' };
  const estadoMesa = e => ESTADO_MESA[e] || (e ? String(e) : '');
  const modoComite = m => MODO_COMITE[m] || (m ? String(m).replace(/_/g, ' ') : '—');

  const vigente = (hasta, ahora) => hasta === null || hasta === undefined || !valido(ahora) || hasta > ahora;

  // Factor «×0,25»: hasta tres decimales, sin ceros de más.
  const factorTexto = f => `×${agrupar(nf(0, 3).format(f))}`;

  // Tamaño real de las posiciones nuevas frente al normal. Se multiplican tres
  // recortes del fondo entero: el modo DEFENSIVO del comité, la reducción del
  // Megáfono y la de la caída desde el máximo. Van sobre el nocional FINAL de
  // cada apertura, después de todos los topes de dimensionar()
  // (mesas.tamanoApertura; Riesgos lo comprueba sin volver a multiplicar): así
  // «×0,5 del tamaño normal» es ×0,5 aunque mande el riesgo por operación o el
  // tope por activo. Con DEFENSIVO y «reduce a la mitad» sale ×0,25. El
  // multiplicador por mesa del comité también multiplica, pero es de cada mesa
  // (su ficha): aquí no entra. `ahora` (reloj de la mesa) pone la fecha al
  // «hasta» del Megáfono si no es hoy.
  const FACTOR_DEFENSIVO = 0.5;
  function tamanoEntradas(defensivo, reduccion, multiplicadorCaida, ahora) {
    const partes = [];
    if (defensivo) {
      partes.push({ origen: 'comité', rotulo: 'DEFENSIVO', factor: FACTOR_DEFENSIVO, hasta: null,
        texto: `modo DEFENSIVO del comité (${factorTexto(FACTOR_DEFENSIVO)})` });
    }
    if (reduccion && valido(reduccion.factor) && reduccion.factor < 1) {
      partes.push({ origen: 'Megáfono', rotulo: 'MEGÁFONO', factor: reduccion.factor, hasta: valido(reduccion.hasta) ? reduccion.hasta : null,
        texto: `reducción del Megáfono (${factorTexto(reduccion.factor)}${valido(reduccion.hasta) ? ` hasta ${hastaLas(reduccion.hasta, ahora)}` : ''})` });
    }
    if (valido(multiplicadorCaida) && multiplicadorCaida < 1) {
      partes.push({ origen: 'vigilante', rotulo: 'CAÍDA', factor: multiplicadorCaida, hasta: null,
        texto: `caída desde el máximo (${factorTexto(multiplicadorCaida)})` });
    }
    const factor = partes.reduce((f, p) => f * p.factor, 1);
    return { factor, partes, ahora: valido(ahora) ? ahora : null };
  }

  // El mismo recorte a partir del `fondo.factorTamano` del servidor (§7), que
  // es el que se aplica de verdad: manda él y la interfaz no lo recalcula.
  // `reduccion` (directivas) solo pone el «hasta» del Megáfono.
  function tamanoDelServidor(ft, reduccion, ahora) {
    const f = x => (valido(x) ? x : 1);
    const t = tamanoEntradas(f(ft.comite) < 1, f(ft.megafono) < 1 ? { factor: f(ft.megafono), hasta: reduccion ? reduccion.hasta : null } : null, f(ft.caida), ahora);
    const comite = t.partes.find(p => p.origen === 'comité');
    if (comite && f(ft.comite) !== FACTOR_DEFENSIVO) {
      comite.factor = f(ft.comite);
      comite.texto = `modo DEFENSIVO del comité (${factorTexto(comite.factor)})`;
    }
    t.factor = valido(ft.total) ? ft.total : t.partes.reduce((x, p) => x * p.factor, 1);
    return t;
  }

  // Píldora del tamaño: «DEFENSIVO ×0,5», «RIESGO ×0,5 hasta 11:40 · Megáfono»,
  // «CAÍDA ×0,5» o, con varios, «DEFENSIVO + MEGÁFONO ×0,25». '' si no hay recorte.
  function rotuloTamano(tam) {
    const partes = (tam && tam.partes) || [];
    if (!partes.length) return '';
    if (partes.length === 1) {
      const p = partes[0];
      if (p.origen === 'Megáfono') return `RIESGO ${factorTexto(p.factor)}${valido(p.hasta) ? ` hasta ${cuando(p.hasta, tam.ahora)}` : ''} · Megáfono`;
      return `${p.rotulo} ${factorTexto(p.factor)}`;
    }
    return `${partes.map(p => p.rotulo).join(' + ')} ${factorTexto(tam.factor)}`;
  }

  // La frase entera, para el aviso y el título de la píldora.
  function explicacionTamano(tam) {
    const partes = (tam && tam.partes) || [];
    if (!partes.length) return '';
    const causas = partes.map(p => p.texto);
    const lista = causas.length > 1 ? `${causas.slice(0, -1).join(', ')} y ${causas[causas.length - 1]}` : causas[0];
    return `Posiciones nuevas a ${factorTexto(tam.factor)} del tamaño normal: ${lista}.`;
  }

  // Qué puede hacer de verdad el fondo ahora. `fondo.nivel` solo cuenta el
  // vigilante, la pausa y el kill; el SOLO_CERRAR del comité y el «solo cerrar»
  // del Megáfono también bloquean aperturas (src/riesgo/limites.js) sin tocarlo.
  // `ahora` es el reloj de la mesa (inst.ahora o su proyección), nunca Date.now().
  // `tamano`: el recorte real de las posiciones nuevas (tamanoEntradas).
  function nivelEfectivo(inst, ahora) {
    const i = inst || {};
    const fondo = i.fondo || {};
    const d = i.directivas || {};
    const modo = d.modo || (i.cabecera && i.cabecera.modoComite) || 'NORMAL';
    const t = valido(ahora) ? ahora : i.ahora;
    const reduccion = d.reduccion && Number.isFinite(d.reduccion.factor) && vigente(d.reduccion.hasta, t) ? d.reduccion : null;
    const ft = fondo.factorTamano;
    const tamano = ft && typeof ft === 'object' ? tamanoDelServidor(ft, reduccion, t) : tamanoEntradas(modo === 'DEFENSIVO', reduccion, fondo.multiplicadorCaida, t);
    const base = { defensivo: modo === 'DEFENSIVO', reduccion, tamano, ahora: valido(t) ? t : null };
    if (fondo.nivel && fondo.nivel !== 'normal') return Object.assign(base, { nivel: fondo.nivel, origen: 'fondo', motivo: fondo.motivo || null, hasta: null });
    if (modo === 'SOLO_CERRAR') return Object.assign(base, { nivel: 'solo_cerrar', origen: 'comité', motivo: 'Decisión del comité: solo cerrar.', hasta: null });
    if (valido(d.soloCerrarHasta) && vigente(d.soloCerrarHasta, t)) {
      return Object.assign(base, { nivel: 'solo_cerrar', origen: 'Megáfono', motivo: `Directiva del Megáfono: solo cerrar hasta ${hastaLas(d.soloCerrarHasta, t)}.`, hasta: d.soloCerrarHasta });
    }
    return Object.assign(base, { nivel: 'normal', origen: null, motivo: null, hasta: null });
  }

  // Por qué una mesa no abre nada: pausa del Megáfono o ×0 del comité.
  function bloqueosMesa(inst, mesaId, ahora) {
    const i = inst || {};
    const d = i.directivas || {};
    const t = valido(ahora) ? ahora : i.ahora;
    const salida = [];
    for (const p of d.mesasPausadas || []) {
      if (p.mesaId !== mesaId || !vigente(p.hasta, t)) continue;
      salida.push({ tipo: 'mesa', corto: 'PAUSADA', hasta: p.hasta ?? null, origen: 'Megáfono',
        texto: `No abre: mesa en pausa${valido(p.hasta) ? ` hasta ${momento(p.hasta, t)}` : ''} (Megáfono).` });
    }
    const mult = d.multiplicadores ? d.multiplicadores[mesaId] : undefined;
    if (mult === 0) salida.push({ tipo: 'multiplicador', corto: '×0', hasta: null, origen: 'comité', texto: 'No abre: el comité tiene la mesa a ×0.' });
    return salida;
  }

  // Por qué un puesto no puede abrir aunque su estrategia lo pida: vetos de
  // activo (Megáfono, comité, noticias) y lo que bloquea a su mesa.
  function bloqueosPuesto(inst, puesto, ahora) {
    const i = inst || {};
    const d = i.directivas || {};
    const t = valido(ahora) ? ahora : i.ahora;
    const salida = [];
    if (!puesto) return salida;
    for (const v of d.activosVetados || []) {
      if (v.simbolo !== puesto.simbolo || !vigente(v.hasta, t)) continue;
      salida.push({ tipo: 'activo', corto: 'VETADO', hasta: v.hasta ?? null, origen: v.motivo || null,
        texto: `No abre ${String(puesto.etiqueta || puesto.simbolo)}: vetado${valido(v.hasta) ? ` hasta ${momento(v.hasta, t)}` : ''}${v.motivo ? ` (${v.motivo})` : ''}.` });
    }
    return salida.concat(bloqueosMesa(inst, puesto.mesaId, t));
  }

  // Última señal de la estrategia de un puesto (§4.3: la acción viaja como id).
  const ACCION_SENAL = { abrir: 'Comprar', mantener: 'Mantener', cerrar: 'Vender', nada: 'Esperar' };
  const accionSenal = a => ACCION_SENAL[a] || (a ? String(a).replace(/_/g, ' ') : '—');

  // Capital que ninguna mesa tiene asignado (queda en efectivo). Manda el
  // cabecera.sinAsignar del servidor (§7); sin él (servidor viejo), 1 − Σ pesos
  // de las mesas que no están en el banquillo.
  function sinAsignar(inst) {
    const mesas = (inst && Array.isArray(inst.mesas)) ? inst.mesas : [];
    const cab = (inst && inst.cabecera) || {};
    let suma = 0;
    for (const m of mesas) if (m.estado !== 'banquillo' && valido(m.peso)) suma += m.peso;
    const s = cab.sinAsignar;
    if (s && valido(s.fraccion)) return { fraccion: s.fraccion, usd: valido(s.usd) ? s.usd : null, asignado: 1 - s.fraccion };
    if (!mesas.length) return null;
    const fraccion = Math.max(0, 1 - suma);
    const patr = cab.patrimonio;
    return { fraccion, usd: valido(patr) ? patr * fraccion : null, asignado: suma };
  }

  // Un 503 del servidor puede ser «la mesa está arrancando» (la API aún no
  // tiene instantánea) o «ya hay 20 paneles» (solo el SSE). Se distinguen por
  // el mensaje del cuerpo, { ok: false, mensaje }.
  function motivo503(cuerpo) {
    const m = String((cuerpo && cuerpo.mensaje) || '');
    return /arrancando/i.test(m) ? 'arrancando' : 'lleno';
  }

  // Barras de LÍMITES: lo que mide el vigilante (cabecera.vigilancia, §7), que
  // tras reabrir un kill cuenta desde la reapertura; sin ella, las cifras de la
  // cabecera. { perdida, caida } en fracciones positivas (null si aún no hay
  // referencia del día) y si se miden desde la reapertura.
  function medidaLimites(inst) {
    const cab = (inst && inst.cabecera) || {};
    const v = cab.vigilancia;
    const perdidaPct = v ? v.perdidaDiaPct : cab.pnlDiaPct;
    const caidaPct = v ? v.caidaPct : cab.caida;
    return {
      perdida: valido(perdidaPct) ? Math.max(0, -perdidaPct) : null,
      caida: valido(caidaPct) ? Math.abs(Math.min(0, caidaPct)) : null,
      desdeReapertura: Boolean(v && v.desdeReapertura),
    };
  }

  // ¿Está parado este precio? Límite de antigüedad de §5.3 (cripto o acciones).
  function precioViejo(q, ahora, limites) {
    if (!q) return null;
    const lim = limites || {};
    const cripto = String(q.simbolo || '').includes('/');
    const tope = cripto ? lim.maxAntiguedadPrecioSegCripto : lim.maxAntiguedadPrecioSegAcciones;
    if (!valido(q.t) || !valido(ahora)) return { edadMs: null, viejo: true };
    const edadMs = ahora - q.t;
    return { edadMs, viejo: valido(tope) ? edadMs > tope * 1000 : false };
  }

  // Rótulo de una fila de mesas en el parqué: «TENDENCIA SMA · 4H · INCUBACIÓN
  // · PAUSADA». `r` es el rótulo del plano (mapa.js) y `mesa` la de la instantánea.
  const MARCO_CORTO = { '1Hour': '1H', '4Hour': '4H', '1Day': '1D' };
  // Con { compacto: true }, solo el nombre y lo que la bloquea (para cuando no
  // cabe); con { minimo: true }, además solo la primera palabra del nombre
  // («RUPTURA»): el último recurso para que una mesa no se quede sin rótulo
  // en el móvil (la ficha, al tocarlo, dice el nombre entero).
  function rotuloMesa(r, mesa, inst, opciones) {
    const m = mesa || {};
    const minimo = Boolean(opciones && opciones.minimo);
    const compacto = minimo || Boolean(opciones && opciones.compacto);
    const estado = m.estado || r.estado;
    const nombre = String(m.nombre || r.nombre || r.mesaId || '').toUpperCase();
    const partes = [minimo ? nombre.split(/\s+/)[0] : nombre];
    if (!compacto) partes.push(MARCO_CORTO[m.marco || r.marco] || '');
    if (!compacto && estado && estado !== 'titular') partes.push(estadoMesa(estado).toUpperCase());
    for (const b of bloqueosMesa(inst, r.mesaId, inst && inst.ahora)) partes.push(b.corto);
    // En una fila compartida el rótulo dice de qué activo a qué activo va su tramo.
    if (!compacto && r.compartida && r.desde) partes.push(r.desde === r.hasta ? r.desde : `${r.desde}–${r.hasta}`);
    return partes.filter(Boolean).join(' · ');
  }

  // ¿Se han parado los datos? `llegadas`: instantes (ms del navegador) en que
  // llegaron las últimas instantáneas. Límite: 2,5 veces el intervalo típico
  // (mediana; los de menos de 1 s son la instantánea doble de conectar), nunca
  // menos de 20 s; sin historia suficiente se supone un latido de 60 s.
  function datosParados(llegadas, ahoraMs) {
    const l = Array.isArray(llegadas) ? llegadas : [];
    if (!l.length || !valido(ahoraMs)) return { parado: false, pasadoMs: null, limiteMs: null };
    const intervalos = [];
    for (let k = 1; k < l.length; k++) { const d = l[k] - l[k - 1]; if (d >= 1000) intervalos.push(d); }
    intervalos.sort((a, b) => a - b);
    const tipico = intervalos.length >= 2 ? intervalos[Math.floor(intervalos.length / 2)] : 60000;
    const limiteMs = Math.max(20000, 2.5 * tipico);
    const pasadoMs = ahoraMs - l[l.length - 1];
    return { parado: pasadoMs > limiteMs, pasadoMs, limiteMs };
  }

  return {
    rotuloMesa, datosParados, MARCO_CORTO,
    usd, pct, precio, cantidad, numero, hora, dia, fechaCorta, momento, hastaLas, cuando, hace, cuentaAtras, claseSigno, suavizar, reducirMovimiento, animar, agrupar,
    ZONA, ESTADO_MESA, MODO_COMITE, estadoMesa, modoComite, nivelEfectivo, bloqueosMesa, bloqueosPuesto, sinAsignar, medidaLimites, motivo503, precioViejo,
    FACTOR_DEFENSIVO, tamanoEntradas, rotuloTamano, explicacionTamano, factorTexto, ACCION_SENAL, accionSenal,
  };
});
