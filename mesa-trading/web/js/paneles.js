// Paneles HTML alrededor del lienzo: barra superior, panel de departamentos con
// el feed, tarjeta de detalle, botonera con sus modales, franja de conexión y
// avisos. No sabe de dónde vienen los datos: app.js le pasa la instantánea y
// las funciones para mandar comandos.
(function (raiz, fabrica) {
  const esNode = typeof module === 'object' && module.exports;
  const mod = esNode ? fabrica(require('./cifras.js'), require('./caras.js')) : fabrica(raiz.Parque.cifras, raiz.Parque.caras);
  if (esNode) module.exports = mod;
  else (raiz.Parque = raiz.Parque || {}).paneles = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (cifras, caras) {
  'use strict';

  const MAX_DOM = 300;
  const MAX_MEMORIA = 600;
  const $ = (id) => document.getElementById(id);

  // Crea un elemento con atributos e hijos (texto siempre como textContent: los
  // mensajes pueden venir de un LLM y no se meten como HTML).
  function el(tag, attrs, ...hijos) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'style') e.style.cssText = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'text') e.textContent = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    return poner(e, ...hijos);
  }

  // Añade hijos saltándose null, undefined y false. Element.append(null) escribe
  // el texto «null» (salía en el modal Reabrir sin directivas vigentes): por
  // eso en los paneles nunca se llama a append directamente.
  function poner(padre, ...hijos) {
    for (const h of hijos.flat()) {
      if (h === null || h === undefined || h === false) continue;
      padre.appendChild(typeof h === 'string' || typeof h === 'number' ? document.createTextNode(String(h)) : h);
    }
    return padre;
  }

  const ICONOS = {
    comite: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.4"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><path d="M15 14.2c2.6-.3 4.8 1.2 5.5 4.3"/>',
    megafono: '<path d="M4 10v4h3l7 4V6L7 10H4z"/><path d="M17.5 9a4 4 0 0 1 0 6"/><path d="M8 14l1.2 4.5"/>',
    prueba: '<path d="M9 3h6"/><path d="M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3"/><path d="M7.5 15h9"/>',
    pausar: '<rect x="6.5" y="5" width="3.6" height="14" rx="1"/><rect x="13.9" y="5" width="3.6" height="14" rx="1"/>',
    reabrir: '<path d="M7 5l12 7-12 7z"/>',
    kill: '<path d="M12 3v8"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/>',
    resultados: '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M3 20h18"/><path d="M20 7l-3.5 3.5-2-2L12 11"/>',
    ajustes: '<path d="M4 7h10"/><path d="M18 7h2"/><circle cx="16" cy="7" r="2"/><path d="M4 17h4"/><path d="M12 17h8"/><circle cx="10" cy="17" r="2"/><path d="M4 12h2"/><path d="M10 12h10"/><circle cx="8" cy="12" r="2"/>',
    izq: '<path d="M15 6l-6 6 6 6"/>', der: '<path d="M9 6l6 6-6 6"/>', arriba: '<path d="M6 15l6-6 6 6"/>', abajo: '<path d="M6 9l6 6 6-6"/>',
    mas: '<path d="M12 5v14M5 12h14"/>', menos: '<path d="M5 12h14"/>',
    encuadrar: '<path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/>',
    cerrar: '<path d="M6 6l12 12M18 6L6 18"/>',
  };
  function icono(nombre) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('class', 'icono');
    s.innerHTML = ICONOS[nombre] || '';
    return s;
  }

  const MODELOS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-haiku-4-5'];
  const NOMBRE_MARCO = { '1Hour': '1H', '4Hour': '4H', '1Day': '1D' };
  const ESTADO_AGENTE = { trabajando: 'Trabajando', reunion: 'En comité', descanso: 'En descanso', de_pie: 'De pie', banquillo: 'En el banquillo' };
  const NOMBRE_SALA = { parque: 'Parqué', direccion: 'Dirección', macro: 'Macro', analisis: 'Análisis', laboratorio: 'Laboratorio',
    riesgos: 'Riesgos · Operaciones', comite: 'Sala de comité', descanso: 'Descanso' };
  const TIPO_DESTACADO = { veto: 'VETO', alerta: 'ALERTA', decision: 'DECISIÓN', ejecucion: 'EJECUCIÓN', cierre: 'CIERRE', megafono: 'MEGÁFONO',
    directiva: 'DIRECTIVA', contratacion: 'CONTRATACIÓN', despido: 'DESPIDO', propuesta: 'PROPUESTA' };

  const ROTULOS_LIMITES = {
    maxPesoPorActivo: ['Peso máximo por activo', 'pct'], maxExposicionBruta: ['Exposición bruta máxima', 'pct'],
    maxExposicionCripto: ['Exposición cripto máxima', 'pct'], riesgoPorOperacion: ['Riesgo por operación', 'pct'],
    maxPosiciones: ['Posiciones abiertas máximas', 'num'], perdidaDiariaSoloCerrar: ['Pérdida del día → solo cerrar', 'pct'],
    perdidaDiariaKill: ['Pérdida del día → kill switch', 'pct'], caidaReducir: ['Caída → entradas a la mitad', 'pct'],
    caidaKill: ['Caída → kill switch', 'pct'], maxOrdenesMinuto: ['Órdenes por minuto', 'num'],
    maxOrdenesMesaHora: ['Órdenes por mesa y hora', 'num'], minNocionalOrden: ['Orden mínima', 'usd'],
    maxAntiguedadPrecioSegCripto: ['Antigüedad máx. precio cripto', 'seg'], maxAntiguedadPrecioSegAcciones: ['Antigüedad máx. precio acciones', 'seg'],
    desvioMaxPrecio: ['Desvío máximo de precio', 'pct'], penalizacionPapel: ['Penalización de papel por lado', 'pct'],
  };

  function valorLimite(v, tipo) {
    if (tipo === 'pct') return cifras.pct(v, { decimales: v < 0.01 ? 2 : v < 0.1 ? 1 : 0 });
    if (tipo === 'usd') return cifras.usd(v);
    if (tipo === 'seg') return `${cifras.numero(v)} s`;
    return cifras.numero(v, Number.isInteger(v) ? 0 : 2);
  }

  const etq = s => String(s || '').split('/')[0];

  // Texto acotado (un motivo escrito por un LLM no puede llenar el modal).
  function frase(texto, max) {
    const t = String(texto || '').replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
    return t.length > max ? t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : t;
  }

  // Nombre de una mesa para las personas («Reversión RSI», no «reversion»).
  function nombreMesa(id, mesas) {
    const m = (mesas || []).find(x => x.id === id);
    return (m && m.nombre) || id || '—';
  }

  // Una directiva del Megáfono en castellano (lista cerrada de §6.5).
  function textoDirectiva(d, mesas) {
    const h = Number.isFinite(d.horas) ? ` durante ${cifras.numero(d.horas)} h` : '';
    switch (d.tipo) {
      case 'reducir_riesgo': return `Reducir el tamaño de las entradas al ${cifras.pct(d.factor, { decimales: 0 })}${h}.`;
      case 'pausar_activo': return `No abrir en ${etq(d.simbolo)}${h}.`;
      case 'pausar_mesa': return `Pausar la mesa ${nombreMesa(d.mesaId, mesas)}${h}.`;
      case 'solo_cerrar': return `Solo cerrar posiciones, sin abrir nada${h}.`;
      case 'reanudar_activo': return `Quitar la pausa del Megáfono en ${etq(d.simbolo)}.`;
      case 'reanudar_mesa': return `Quitar la pausa del Megáfono a la mesa ${nombreMesa(d.mesaId, mesas)}.`;
      case 'sin_efecto': return `Sin efecto: ${frase(d.motivo, 160) || 'no hay nada que aplicar'}.`;
      default: return 'Directiva desconocida: no se aplica.';
    }
  }

  function iniciales(nombre) {
    const p = String(nombre || '?').trim().split(/\s+/);
    return ((p[0] || '?')[0] + ((p[1] || '')[0] || '')).toUpperCase();
  }

  // ---------- estado del panel ----------
  const est = {
    departamentos: [],
    filtro: 'todos',
    mensajes: [],
    vistos: new Set(),
    nuevosSinVer: 0,
    manejadores: {},
    tarjeta: null,
    ultimoFoco: null,
    conexion: { ok: true, motivo: null, hasta: null, reintento: false },
    viejo: null,
    porId: new Map(),            // id → mensaje de los que hay en memoria (conversaciones)
    pestana: 'mensajes',         // pestaña del panel lateral: 'mensajes' | 'equipo' | la que se añada
    busqueda: '',                // lo escrito en el buscador del equipo
    firmaEquipo: '',
    feedAbajo: true,             // ¿estaba el feed abajo del todo al cambiar de pestaña?
    detalleAbierto: new Set(),   // fichas de agente con «Detalle técnico» desplegado (sobrevive al refresco)
    cacheAgentes: { lista: null, mapa: new Map() },
    explica: null,               // la cifra del capital cuya explicación se ve ('invertido', 'tipo:cripto'…)
    explicaT: 0,                 // cuándo se escribió (se refresca como mucho cada 30 s: es role=status)
    repartoClave: '',            // tipos de la barra del reparto (se rehace si cambian)
    reproduciendo: null,         // la reunión que el reproductor está soltando: { nombre, vistos, total } o null
  };

  function colorDep(id) {
    const d = est.departamentos.find(x => x.id === id);
    return d ? d.color : '#8a93b0';
  }
  function nombreDep(id) {
    const d = est.departamentos.find(x => x.id === id);
    return d ? d.nombre : '';
  }

  // Plantilla de la última instantánea, por id (para la cara, el rol y el
  // «→ Marta» de cada mensaje).
  function agentesPorId() {
    const inst = est.manejadores.instantanea ? est.manejadores.instantanea() : null;
    const lista = inst && Array.isArray(inst.agentes) ? inst.agentes : null;
    if (lista !== est.cacheAgentes.lista) est.cacheAgentes = { lista, mapa: new Map((lista || []).map(a => [a.id, a])) };
    return est.cacheAgentes.mapa;
  }

  // Cara de un agente (o del humano, o del sistema) del tamaño pedido.
  function cara(quien, tam, etiqueta) {
    if (quien === 'humano' || quien === 'sistema') return caras.nodoCara(quien, { tam, etiqueta });
    return caras.nodoCara(quien, { tam, color: colorDep(quien && quien.departamento), etiqueta });
  }

  // Etiqueta del departamento con su color (el color va en una variable CSS:
  // la CSP no deja atributos style, pero sí fijarla desde JS).
  function etiquetaDep(depId, texto) {
    const e = el('span', { class: 'dep-etq', text: texto || nombreDep(depId) || depId });
    e.style.setProperty('--dep', colorDep(depId));
    return e;
  }

  // Abre la ficha de un agente (desde una cara del feed, del equipo o de un puesto).
  function abrirFichaAgente(id) {
    if (est.manejadores.alSeleccionar) est.manejadores.alSeleccionar({ tipo: 'agente', id });
  }

  // ---------- inicio ----------
  function iniciar(opciones) {
    est.manejadores = opciones || {};
    est.departamentos = (opciones && opciones.departamentos) || [];
    construirBotonera();
    construirChips();
    construirPestanas();
    construirBuscadorEquipo();
    for (const id of ['pildoras', 'acciones']) { const n = $(id); if (n) n.addEventListener('scroll', marcarDesborde, { passive: true }); }
    // Cifras del capital: al tocarlas, una línea dice de dónde salen.
    for (const id of ['barra', 'capital']) {
      const n = $(id);
      if (n) n.addEventListener('click', (e) => {
        const b = e.target && e.target.closest ? e.target.closest('[data-explica]') : null;
        if (b) alternarExplicacion(b.getAttribute('data-explica'));
      });
    }
    const feed = $('feed');
    feed.addEventListener('scroll', () => {
      if (pegadoAbajo()) { est.nuevosSinVer = 0; $('nuevos').hidden = true; }
    });
    $('nuevos').addEventListener('click', () => { bajarDelTodo(); });
    const asa = $('asa');
    asa.addEventListener('click', () => {
      const lat = $('lateral');
      const abierta = lat.classList.toggle('abierta');
      asa.setAttribute('aria-expanded', String(abierta));
      if (abierta && est.pestana === 'mensajes') bajarDelTodo();
    });
    window.addEventListener('resize', () => { marcarDesborde(); ajustarModoTarjeta(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && est.explica && !$('modal').open && !est.tarjeta) { alternarExplicacion(null); return; }
      if (e.key === 'Escape' && !$('modal').open && est.tarjeta) {
        ocultarTarjeta();
        if (est.manejadores.alCerrarTarjeta) est.manejadores.alCerrarTarjeta();
      }
    });
  }

  function fijarDepartamentos(deps) {
    if (!Array.isArray(deps) || !deps.length) return;
    const antes = est.departamentos.map(d => d.id + d.color).join();
    est.departamentos = deps;
    if (antes !== deps.map(d => d.id + d.color).join()) construirChips();
  }

  function construirChips() {
    const cont = $('chips');
    cont.textContent = '';
    const chips = [{ id: 'todos', nombre: 'Todos', color: null }].concat(est.departamentos, [{ id: 'megafono', nombre: 'Megáfono', color: '#f59e0b' }]);
    for (const c of chips) {
      const b = el('button', { class: 'chip' + (est.filtro === c.id ? ' activa' : ''), type: 'button', 'aria-pressed': String(est.filtro === c.id), 'data-filtro': c.id },
        c.color ? el('span', { class: 'punto', style: `background:${c.color}` }) : null, c.nombre);
      b.addEventListener('click', () => {
        est.filtro = c.id;
        for (const x of cont.querySelectorAll('.chip')) {
          const a = x.getAttribute('data-filtro') === c.id;
          x.classList.toggle('activa', a);
          x.setAttribute('aria-pressed', String(a));
        }
        repintarFeed();
      });
      cont.appendChild(b);
    }
  }

  // ---------- pestañas del panel lateral (Mensajes, Equipo…) ----------
  // Cada [role=tab] de #pestanas-lateral enseña su panel (aria-controls) y
  // esconde los demás. Otra pestaña se añade en index.html con el mismo
  // patrón, sin tocar esto. Flechas, Inicio y Fin mueven entre pestañas
  // (tabindex itinerante); en el móvil, elegir una abre la hoja inferior.
  function pestanas() {
    const lista = $('pestanas-lateral');
    return lista ? Array.from(lista.querySelectorAll('[role="tab"]')) : [];
  }

  function construirPestanas() {
    const tabs = pestanas();
    tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => elegirPestana(tab.getAttribute('data-pestana'), { abrirHoja: true }));
      tab.addEventListener('keydown', (e) => {
        const n = tabs.length;
        const ir = { ArrowRight: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, Home: 0, End: n - 1 }[e.key];
        if (ir === undefined) return;
        e.preventDefault();
        const destino = tabs[ir];
        elegirPestana(destino.getAttribute('data-pestana'), { abrirHoja: true });
        destino.focus();
      });
    });
  }

  function elegirPestana(id, opciones) {
    const tabs = pestanas();
    if (!tabs.length || !tabs.some(t => t.getAttribute('data-pestana') === id)) return;
    const antes = est.pestana;
    // Si el feed estaba abajo del todo al irse, al volver sigue abajo.
    if (antes === 'mensajes' && id !== 'mensajes') est.feedAbajo = pegadoAbajo();
    est.pestana = id;
    for (const t of tabs) {
      const activa = t.getAttribute('data-pestana') === id;
      t.setAttribute('aria-selected', String(activa));
      t.setAttribute('tabindex', activa ? '0' : '-1');
      t.classList.toggle('activa', activa);
      const panel = $(t.getAttribute('aria-controls'));
      if (panel) panel.hidden = !activa;
    }
    if (opciones && opciones.abrirHoja) {
      const lat = $('lateral');
      if (lat && !lat.classList.contains('abierta') && esMovil()) {
        lat.classList.add('abierta');
        const asa = $('asa');
        if (asa) asa.setAttribute('aria-expanded', 'true');
      }
    }
    if (id === 'equipo') { est.firmaEquipo = ''; actualizarEquipo(); }
    if (id === 'mensajes' && antes !== 'mensajes' && est.feedAbajo !== false) bajarDelTodo();
  }

  function construirBuscadorEquipo() {
    const input = $('buscar-equipo');
    if (!input) return;
    input.addEventListener('input', () => {
      est.busqueda = input.value || '';
      est.firmaEquipo = '';
      actualizarEquipo();
    });
    // Escape en el buscador borra lo escrito (y no cierra la ficha abierta).
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && input.value) {
        e.stopPropagation();
        input.value = '';
        est.busqueda = '';
        est.firmaEquipo = '';
        actualizarEquipo();
      }
    });
  }

  function construirBotonera() {
    const acc = $('acciones');
    acc.textContent = '';
    const botones = [
      ['comite', 'Comité'], ['megafono', 'Megáfono'], ['resultados', 'Resultados'], ['prueba', 'Prueba'], ['pausar', 'Pausar todo'],
      ['reabrir', 'Reabrir'], ['kill', 'Kill switch'], ['ajustes', 'Ajustes'],
    ];
    // aria-label y title iguales al texto: entre 768 y 1100 px solo se ven los
    // iconos y sin ellos un lector de pantalla decía siete veces «botón».
    for (const [id, texto] of botones) {
      acc.appendChild(el('button', { class: 'boton' + (id === 'kill' ? ' peligro' : ''), type: 'button', 'data-accion': id,
        'aria-label': texto, title: texto, onclick: () => abrirModal(id) }, icono(id), el('span', { text: texto })));
    }
    const cam = $('camara');
    cam.textContent = '';
    const mandos = [['izq', 'Mover a la izquierda'], ['arriba', 'Mover arriba'], ['abajo', 'Mover abajo'], ['der', 'Mover a la derecha'],
      ['menos', 'Alejar'], ['mas', 'Acercar'], ['encuadrar', 'Ver toda la oficina']];
    for (const [id, etiqueta] of mandos) {
      cam.appendChild(el('button', { class: 'boton-icono', type: 'button', 'aria-label': etiqueta, title: etiqueta,
        onclick: () => est.manejadores.alCamara && est.manejadores.alCamara(id) }, icono(id)));
    }
  }

  // Filas que se deslizan sin barra (píldoras, botonera): si no caben, se
  // desvanecen por la derecha para que se vea que hay más.
  // Si la fila de píldoras no cabe (a 1440 px, «DEFENSIVO + MEGÁFONO ×0,25»
  // cortaba la última), primero se compacta: sin la palabra del F&G, que dice
  // su título. Solo si aun así no cabe, se desliza con el borde desvanecido.
  function marcarDesborde() {
    const pild = $('pildoras');
    if (pild) {
      pild.classList.remove('compacta');
      if (pild.scrollWidth > pild.clientWidth + 1) pild.classList.add('compacta');
    }
    for (const id of ['pildoras', 'acciones']) {
      const n = $(id);
      if (n) n.classList.toggle('desborda', n.scrollWidth > n.clientWidth + 1 && n.scrollLeft + n.clientWidth < n.scrollWidth - 1);
    }
  }

  // ---------- barra superior ----------
  function actualizarBarra(inst, o) {
    if (!inst) return;
    const cab = inst.cabecera || {};
    cifras.animar($('v-patrimonio'), cab.patrimonio, x => cifras.usd(x));
    const vr = $('v-resultado');
    cifras.animar(vr, cab.pnlDia, x => cifras.usd(x, { signo: true }));
    vr.className = 'valor ' + cifras.claseSigno(cab.pnlDia, 0.005);
    const sub = $('v-resultado-pct');
    sub.textContent = `(${cifras.pct(cab.pnlDiaPct, { signo: true })})`;
    sub.className = 'sub ' + cifras.claseSigno(cab.pnlDia, 0.005);
    const caida = Number.isFinite(cab.caida) ? -Math.abs(cab.caida) : null;
    const vc = $('v-caida');
    cifras.animar(vc, caida, x => cifras.pct(x));
    vc.className = 'valor ' + (caida !== null && caida < -0.0001 ? 'neg' : '');
    $('v-exposicion').textContent = `${cifras.pct(cab.exposicionBrutaPct, { decimales: 0 })} bruta · ${cifras.pct(cab.exposicionCriptoPct, { decimales: 0 })} cripto`;
    cifras.animar($('v-posiciones'), cab.posiciones, x => cifras.numero(Math.round(x)));

    const reg = (cab.regimen && cab.regimen.valor) || '—';
    const pr = $('p-regimen');
    pr.textContent = reg;
    pr.className = 'pildora ' + (reg === 'RISK-ON' ? 'verde' : reg === 'RISK-OFF' ? 'roja' : 'gris');
    pr.title = (cab.regimen && cab.regimen.detalle) || '';

    const fg = cab.miedoCodicia;
    const pf = $('p-fg');
    if (fg && Number.isFinite(fg.valor)) {
      // La palabra («· Miedo») va aparte: es lo que se esconde si la fila no
      // cabe (marcarDesborde); el color y el título la siguen diciendo.
      pf.textContent = '';
      poner(pf, `F&G ${fg.valor}`, el('span', { class: 'largo', text: ` · ${fg.etiqueta}` }));
      const h = Math.round(Math.max(0, Math.min(100, fg.valor)) * 1.2);
      pf.style.setProperty('--tono', `hsl(${h} 70% 55%)`);
      pf.className = 'pildora fg';
      pf.title = `${fg.sintetico ? 'Valor sintético (modo sin datos reales)' : 'Índice de miedo y codicia'}: ${fg.valor} · ${fg.etiqueta}`;
    } else {
      pf.textContent = 'F&G —';
      pf.className = 'pildora gris';
    }

    // Estado de verdad del fondo: además del nivel (vigilante, pausa, kill),
    // el «solo cerrar» del comité o del Megáfono y, si se puede abrir, el
    // tamaño REAL de las posiciones nuevas (DEFENSIVO, reducción del Megáfono y
    // caída, multiplicados: con DEFENSIVO y «a la mitad», ×0,25).
    const n = cifras.nivelEfectivo(inst, inst.ahora);
    const pn = $('p-nivel');
    let textoNivel = '';
    if (n.nivel === 'bloqueado') textoNivel = 'BLOQUEADO';
    else if (n.nivel === 'pausado') textoNivel = 'PAUSADO';
    else if (n.nivel === 'solo_cerrar') textoNivel = n.origen === 'Megáfono' ? `SOLO CERRAR hasta ${cifras.cuando(n.hasta, n.ahora)} · Megáfono` : n.origen === 'comité' ? 'SOLO CERRAR · comité' : 'SOLO CERRAR';
    else textoNivel = cifras.rotuloTamano(n.tamano);
    const tamano = n.nivel === 'normal' ? cifras.explicacionTamano(n.tamano) : '';
    pn.hidden = !textoNivel;
    pn.textContent = textoNivel;
    pn.className = 'pildora ' + (n.nivel === 'bloqueado' ? 'roja fuerte' : 'ambar');
    pn.title = n.nivel === 'normal' ? tamano : (n.motivo || '');
    pn.setAttribute('aria-label', textoNivel ? `Estado del fondo: ${textoNivel}. ${pn.title}` : '');

    const pm = $('p-modo');
    const modo = inst.modo;
    pm.textContent = modo === 'alpaca' ? 'PAPEL ALPACA' : modo === 'sintetico' ? `SINTÉTICO${inst.velocidad > 1 ? ' ×' + cifras.numero(inst.velocidad) : ''}` : 'SIMULADO';
    pm.className = 'pildora ' + (modo === 'alpaca' ? 'ambar' : modo === 'sintetico' ? 'lila' : 'azul');

    const llm = inst.llm || {};
    const pl = $('p-llm');
    if (llm.activo) {
      pl.textContent = `LLM ${cifras.usd(llm.gastoHoyUsd)} / ${cifras.usd(llm.presupuestoDiaUsd)}`;
      const uso = llm.presupuestoDiaUsd > 0 ? llm.gastoHoyUsd / llm.presupuestoDiaUsd : 0;
      pl.className = 'pildora ' + (uso > 0.9 ? 'roja' : uso > 0.7 ? 'ambar' : 'gris');
      pl.title = `Comité: ${llm.modeloComite || '—'} · Agentes: ${llm.modeloAgentes || '—'}`;
    } else {
      pl.textContent = 'LLM apagado';
      pl.className = 'pildora gris';
      pl.title = 'Sin clave o desactivado: los agentes hablan con plantillas.';
    }
    $('p-maqueta').hidden = !(o && o.maqueta);
    actualizarCapital(inst);
    actualizarComite(inst, o && o.ahoraServidor);
    actualizarEquipo(inst);          // la pestaña Equipo, si se ve y ha cambiado alguien
    marcarDesborde();
    const avisos = $('avisos');
    // El recorte de tamaño va delante: con el fondo abierto es lo que más limita
    // (el servidor no lo cuenta en `avisos`).
    const delServidor = Array.isArray(inst.avisos) ? inst.avisos : [];
    const lista = tamano && !delServidor.includes(tamano) ? [tamano].concat(delServidor) : delServidor;
    const clave = lista.join('|');
    if (avisos.dataset.clave !== clave) {
      avisos.dataset.clave = clave;
      avisos.textContent = '';
      for (const a of lista) avisos.appendChild(el('div', { class: 'aviso', text: a }));
    }
  }

  // ---------- capital (§7, cabecera.capital) ----------
  // Debajo de la barra: invertido (importe y %), efectivo, el margen que dejan
  // los límites (no lo que el fondo va a comprar: las mesas solo invierten su
  // parte; revisión del 30-sep-2026) y el reparto por tipo de activo (barra apilada que crece desde
  // la izquierda y, debajo, cada tipo con su nombre, importe y %). Todo sale de
  // la instantánea; un servidor sin el campo no pinta la franja.
  let instCapital = null;
  function actualizarCapital(inst) {
    const sec = $('capital');
    if (!sec) return;
    const cap = inst && inst.cabecera && inst.cabecera.capital;
    sec.hidden = !cap;
    instCapital = cap ? inst : null;
    if (!cap) return;
    cifras.animar($('v-invertido'), cap.invertido, x => cifras.usd(x));
    $('v-invertido-pct').textContent = `(${cifras.pct(cap.invertidoPct, { decimales: 0 })})`;
    cifras.animar($('v-efectivo'), cap.efectivo, x => cifras.usd(x));
    cifras.animar($('v-disponible'), cap.disponible, x => cifras.usd(x));
    // El margen de los límites no es lo que el fondo va a comprar: con el
    // fondo parado (kill, pausa, solo cerrar) no compra nada, y se marca.
    const parado = cifras.nivelEfectivo(inst, inst.ahora).nivel !== 'normal';
    const nota = $('v-disponible-nota');
    if (nota) nota.textContent = parado ? '(no compra)' : '';
    const boton = $('c-disponible');
    if (boton) boton.classList.toggle('no-compra', parado);
    pintarReparto(cap);
    if (est.explica && Date.now() - est.explicaT > 30000) escribirExplicacion();
  }

  function pintarReparto(cap) {
    const barra = $('reparto-barra');
    const tipos = $('reparto-tipos');
    if (!barra || !tipos) return;
    const P = cap.patrimonio > 0 ? cap.patrimonio : 0;
    const lista = (cap.porTipo || []);
    const clave = lista.map(t => t.tipo).join('|');
    const ancho = x => `${P > 0 ? Math.max(0, Math.min(100, (x / P) * 100)).toFixed(3) : 0}%`;
    if (clave !== est.repartoClave) {
      est.repartoClave = clave;
      barra.textContent = '';
      tipos.textContent = '';
      lista.forEach((t, k) => {
        const seg = el('span', { class: 'reparto-seg', 'data-tipo': t.tipo });
        seg.style.setProperty('--c', cifras.colorTipo(t.tipo));
        seg.style.setProperty('--retraso', `${k * 35}ms`);
        barra.appendChild(seg);
        const punto = el('span', { class: 'punto', 'aria-hidden': 'true' });
        punto.style.setProperty('--c', cifras.colorTipo(t.tipo));
        tipos.appendChild(el('button', { class: 'reparto-tipo', type: 'button', 'data-explica': `tipo:${t.tipo}`, 'data-tipo': t.tipo,
          'aria-controls': 'capital-explica', 'aria-expanded': 'false' },
        punto, el('span', { class: 'reparto-nombre', text: t.nombre }), el('span', { class: 'reparto-importe' }), el('span', { class: 'reparto-pct' })));
      });
      const ef = el('span', { class: 'reparto-seg efectivo', 'data-tipo': 'efectivo' });
      ef.style.setProperty('--retraso', `${lista.length * 35}ms`);
      barra.appendChild(ef);
      tipos.appendChild(el('span', { class: 'reparto-tipo leyenda-efectivo', 'aria-hidden': 'true' }, el('span', { class: 'punto efectivo' }), el('span', { class: 'reparto-nombre', text: 'Efectivo' })));
      barra.classList.remove('entra');
      void barra.offsetWidth;   // reinicia la animación de entrada
      barra.classList.add('entra');
      marcarExplicando();
    }
    for (const t of lista) {
      const seg = barra.querySelector(`.reparto-seg[data-tipo="${t.tipo}"]`);
      if (seg) { seg.style.setProperty('--w', ancho(t.importe)); seg.title = `${t.nombre}: ${cifras.usd(t.importe)} (${cifras.pct(t.pct, { decimales: 1 })})`; }
      const b = tipos.querySelector(`.reparto-tipo[data-tipo="${t.tipo}"]`);
      if (b) {
        const cero = !(t.importe > 0);
        b.classList.toggle('cero', cero);
        // Sin nada invertido: «0 $», sin céntimos ni «0 %» (el tipo sale porque lo opera una mesa).
        b.querySelector('.reparto-importe').textContent = cero ? '0 $' : cifras.usd(t.importe);
        b.querySelector('.reparto-pct').textContent = cero ? '' : cifras.pct(t.pct, { decimales: 0 });
        b.setAttribute('aria-label', `${t.nombre}: ${cifras.usd(t.importe)}, ${cifras.pct(t.pct, { decimales: 1 })} del patrimonio. Toca para ver de dónde sale.`);
      }
    }
    const ef = barra.querySelector('.reparto-seg.efectivo');
    if (ef) { ef.style.setProperty('--w', ancho(cap.efectivo)); ef.title = `Efectivo: ${cifras.usd(cap.efectivo)}`; }
  }

  // Toca una cifra: su línea; la misma otra vez (o Escape), se quita.
  function alternarExplicacion(clave) {
    est.explica = clave && clave !== est.explica ? clave : null;
    escribirExplicacion();
  }

  function escribirExplicacion() {
    const p = $('capital-explica');
    if (!p) return;
    // «50.255 $» no se parte entre dos líneas.
    const texto = est.explica ? (cifras.explicarCapital(est.explica, instCapital) || '').replace(/ ([$%])/g, '\u00a0$1') || null : null;
    if (!texto) est.explica = null;
    p.hidden = !texto;
    if (p.textContent !== (texto || '')) p.textContent = texto || '';
    est.explicaT = Date.now();
    marcarExplicando();
  }

  function marcarExplicando() {
    document.querySelectorAll('[data-explica]').forEach(b => b.setAttribute('aria-expanded', String(b.getAttribute('data-explica') === est.explica)));
  }

  function actualizarComite(inst, ahoraServidor) {
    const pc = $('p-comite');
    const cab = (inst && inst.cabecera) || {};
    if (!Number.isFinite(cab.proximoComite) || !Number.isFinite(ahoraServidor)) { pc.textContent = 'Comité —'; return; }
    const resta = cab.proximoComite - ahoraServidor;
    const reunido = (inst.agentes || []).some(a => a.sala === 'comite');
    // Los jefes también van a la sala de comité en las reuniones de las 9:00 y
    // las 22:15 (§6.9): la píldora dice cuál de las dos es.
    const reunion = reunido ? reunionEnCurso(est.mensajes.length ? est.mensajes : (inst.mensajes || [])) : null;
    // Modo web: convocado desde el panel, se celebra en el latido siguiente.
    const pedido = !reunido && cab.comitePedido === true;
    // Mientras el feed la reproduce, la píldora lo dice (con los jefes en la sala o no).
    const rep = est.reproduciendo;
    pc.textContent = rep ? `${rep.nombre} en curso` : reunion ? reunion.nombre : reunido ? 'Comité reunido' : pedido ? 'Comité convocado' : resta > 0 ? `Comité en ${cifras.cuentaAtras(resta)}` : 'Comité pendiente';
    pc.className = 'pildora ' + (rep || reunido || pedido ? 'ambar' : 'gris');
    pc.title = rep ? `El feed la cuenta punto por punto: ${cifras.numero(Math.min(rep.vistos, rep.total))} de ${cifras.numero(rep.total)}.`
      : reunion ? `Reunión informativa: cuenta cómo va el fondo y no cambia nada. Modo del comité: ${cifras.modoComite(cab.modoComite)}`
        : pedido ? 'Convocado: empieza en el próximo latido.' : `Modo del comité: ${cifras.modoComite(cab.modoComite)}`;
  }

  // «Reunión en curso» encima del feed mientras el reproductor (app.js) suelta
  // una reunión que llegó de golpe; r = { nombre, vistos, total } o null.
  function reunionEnCursoFeed(r) {
    const antes = est.reproduciendo;
    est.reproduciendo = r || null;
    const n = $('en-curso');
    const clave = r ? `${r.nombre}|${r.vistos}|${r.total}` : '';
    if (n && n.getAttribute('data-clave') !== clave) {
      n.setAttribute('data-clave', clave);
      n.hidden = !r;
      n.textContent = '';
      if (r) {
        poner(n, el('span', { class: 'punto-vivo', 'aria-hidden': 'true' }), el('b', { text: `${r.nombre} en curso` }),
          el('span', { class: 'en-curso-n', text: `${cifras.numero(Math.min(r.vistos, r.total))} de ${cifras.numero(r.total)}` }));
      }
    }
    if ((antes ? antes.nombre + antes.vistos : '') !== (r ? r.nombre + r.vistos : '') && est.manejadores.instantanea) {
      const inst = est.manejadores.instantanea();
      if (inst) actualizarComite(inst, typeof est.manejadores.ahoraServidor === 'function' ? est.manejadores.ahoraServidor() : null);
    }
  }

  // ¿Los jefes están en la sala por una reunión informativa y no por un
  // comité? Lo dice lo último que se abrió en la sala: la apertura de una
  // reunión (canal 'direccion', tipo 'reunion', fase 'apertura') o la de un
  // comité (canal 'comite', tipo 'comite'). En el modo latido los jefes se
  // quedan unos minutos en la sala tras acabar: sigue siendo esa reunión.
  // Devuelve { reunion: 'manana'|'cierre', nombre } o null.
  const NOMBRE_REUNION = { manana: 'Reunión de la mañana', cierre: 'Cierre del día' };   // los de src/agentes/reuniones.js (CITAS)
  function reunionEnCurso(mensajes) {
    for (let k = (mensajes || []).length - 1; k >= 0; k--) {
      const m = mensajes[k];
      if (!m) continue;
      if (m.canal === 'comite' && m.tipo === 'comite') return null;
      if (m.canal === 'direccion' && m.tipo === 'reunion' && m.datos && m.datos.fase === 'apertura') {
        const tipo = m.datos.reunion === 'cierre' ? 'cierre' : 'manana';
        const nombre = typeof m.datos.nombre === 'string' && m.datos.nombre.trim() ? m.datos.nombre.trim().slice(0, 40) : NOMBRE_REUNION[tipo];
        return { reunion: tipo, nombre };
      }
    }
    return null;
  }

  // ---------- feed ----------
  const pasaFiltro = (m) => {
    if (est.filtro === 'todos') return true;
    if (est.filtro === 'megafono') return m.canal === 'megafono' || m.tipo === 'megafono' || m.tipo === 'directiva';
    return m.departamento === est.filtro;
  };

  function pegadoAbajo() {
    const f = $('feed');
    return f.scrollTop + f.clientHeight >= f.scrollHeight - 40;
  }
  function bajarDelTodo() {
    const f = $('feed');
    f.scrollTop = f.scrollHeight;
    est.nuevosSinVer = 0;
    $('nuevos').hidden = true;
  }

  // Reloj de la mesa para decidir qué es «hoy» (nunca Date.now(): en sintético no coinciden).
  function ahoraMesa() {
    const f = est.manejadores.ahoraServidor;
    const v = typeof f === 'function' ? f() : null;
    if (Number.isFinite(v)) return v;
    const inst = est.manejadores.instantanea ? est.manejadores.instantanea() : null;
    return inst && Number.isFinite(inst.ahora) ? inst.ahora : null;
  }

  // Un mensaje del feed: cara, nombre, departamento (con su color), rol, a
  // quién va y el texto. `o.respuestas`: las respuestas de su conversación,
  // que van sangradas debajo (más pequeñas). `o.raiz`: si este mensaje es una
  // respuesta, el que abre la conversación.
  function nodoMensaje(m, o) {
    const opc = o || {};
    const esRespuesta = Boolean(opc.raiz);
    const agentes = agentesPorId();
    const ag = agentes.get(m.de) || null;
    const humano = !m.departamento;
    const delHumano = m.de === 'humano' || (humano && m.canal === 'megafono');
    const megafono = m.canal === 'megafono';
    const tam = esRespuesta ? 24 : 40;
    // Cara: la del agente (la misma que su muñeco); el humano, con el icono
    // del Megáfono; los avisos del sistema, con el cubo gris.
    const quien = delHumano ? 'humano' : humano ? 'sistema' : (ag || { id: m.de, nombre: m.deNombre, departamento: m.departamento });
    const nombre = delHumano ? 'Megáfono' : humano ? (m.deNombre || 'Sistema') : (m.deNombre || (ag && ag.nombre) || m.de);
    const laCara = cara(quien, tam);
    // Solo un agente de la plantilla tiene ficha: su cara es el botón que la abre.
    const avatar = ag
      ? el('button', { class: 'cara-boton', type: 'button', 'aria-label': `Ficha de ${ag.nombre}`, title: `Ficha de ${ag.nombre}`,
        'data-msg': m.id, onclick: () => abrirFichaAgente(ag.id) }, laCara)
      : laCara;
    const destacado = TIPO_DESTACADO[m.tipo];
    const para = caras.textoPara(m, agentes, est.porId, opc.raiz || null);
    // El rol, solo en el mensaje que abre (en una respuesta ya se sabe quién es).
    const rol = !humano && !esRespuesta && ag && ag.rol ? ag.rol : null;
    const n = el('article', { class: 'msg' + (esRespuesta ? ' respuesta' : '') + (megafono ? ' megafono' : '') + (m.tipo === 'veto' || m.tipo === 'alerta' ? ' alerta' : ''),
      'data-id': m.id },
    avatar,
    el('div', { class: 'cuerpo' },
      el('div', { class: 'cab' },
        el('b', { text: nombre }),
        delHumano ? el('span', { class: 'dep-etq humano', text: 'Humano' }) : humano ? null : etiquetaDep(m.departamento),
        destacado && !(delHumano && m.tipo === 'megafono') ? el('span', { class: 'tipo tipo-' + m.tipo, text: destacado }) : null,
        el('time', { text: cifras.hora(m.t), datetime: Number.isFinite(m.t) ? new Date(m.t).toISOString() : null })),
      rol || para ? el('div', { class: 'rol' }, rol ? el('span', { class: 'rol-texto', text: rol }) : null,
        para ? el('span', { class: 'para', text: para }) : null) : null,
      el('p', { text: m.texto }),
      opc.respuestas && opc.respuestas.length
        ? el('div', { class: 'respuestas', role: 'group', 'aria-label': `Respuestas a ${nombre}` }, opc.respuestas.map(r => nodoMensaje(r, { raiz: m })))
        : null));
    n.dataset.t = m.t;
    n.dataset.dia = cifras.dia(m.t) || '';
    return n;
  }

  // Nodo de una conversación entera (la raíz con sus respuestas). Se ordena y
  // se separa por días por su ÚLTIMO mensaje: una respuesta nueva la trae abajo.
  function nodoBloque(b) {
    const n = nodoMensaje(b.raiz, { respuestas: b.respuestas });
    n.dataset.clave = b.clave;
    if (b.respuestas.length) {
      n.dataset.t = b.ultimoT;
      n.dataset.dia = cifras.dia(b.ultimoT) || '';
      n.classList.add('conversacion');
    }
    return n;
  }

  // Separador de día en el feed: la hora de cada mensaje va sin fecha, así que
  // al cambiar de día (o tras un reinicio con mensajes de otros días) se dice.
  function separadorDia(t) {
    const hoy = cifras.dia(ahoraMesa());
    const d = cifras.dia(t);
    const texto = d && d === hoy ? `Hoy · ${cifras.fechaCorta(t)}` : cifras.fechaCorta(t);
    const s = el('div', { class: 'separador-dia', role: 'separator', 'aria-label': texto }, el('span', { text: texto }));
    s.dataset.dia = d || '';
    return s;
  }

  function ultimoDiaDelFeed(feed) {
    for (let n = feed.lastElementChild; n; n = n.previousElementSibling) if (n.classList.contains('msg')) return n.dataset.dia || null;
    return null;
  }

  // El primero del feed siempre dice de qué día es (aunque se hayan podado los de arriba).
  function asegurarSeparadorArriba(feed) {
    const primero = feed.firstElementChild;
    if (primero && primero.classList.contains('msg')) feed.insertBefore(separadorDia(Number(primero.dataset.t)), primero);
  }

  // El bloque de una conversación en el feed (buscando desde abajo: casi
  // siempre es de las últimas), o null.
  function bloqueEnFeed(feed, clave) {
    for (let n = feed.lastElementChild; n; n = n.previousElementSibling) if (n.dataset && n.dataset.clave === clave) return n;
    return null;
  }

  // Una conversación entera desde la memoria del feed (est.mensajes), o null.
  function bloqueDe(clave) {
    const ms = est.mensajes.filter(x => caras.claveHilo(x, est.porId) === clave);
    return ms.length ? caras.organizarHilos(ms, est.porId)[0] : null;
  }

  // Saca un nodo del feed sin dejar arriba un separador de día que ya no
  // separa nada (sin mensajes debajo hasta el siguiente separador).
  function sacarDelFeed(feed, n) {
    const antes = n.previousElementSibling;
    feed.removeChild(n);
    if (antes && antes.classList.contains('separador-dia')) {
      const despues = antes.nextElementSibling;
      if (!despues || despues.classList.contains('separador-dia')) feed.removeChild(antes);
    }
  }

  // Al final del feed, con su separador si cambia el día.
  function alFinalDelFeed(feed, n) {
    if (n.dataset.dia !== ultimoDiaDelFeed(feed)) feed.appendChild(separadorDia(Number(n.dataset.t)));
    feed.appendChild(n);
  }

  // Un mensaje nuevo en su sitio, por orden de LLEGADA (revisión del
  // 30-sep-2026). Una respuesta a una conversación que está en el feed entra
  // dentro de ella (por su hora) y la conversación baja al final: es lo último
  // que ha pasado. Una raíz nueva, o una respuesta cuya conversación no está
  // (podada, filtrada, o su raíz llegó después), entra con su conversación
  // entera al final. → true si entra algo que se ve.
  function colocarMensaje(feed, m) {
    const clave = caras.claveHilo(m, est.porId);
    const actual = bloqueEnFeed(feed, clave);
    if (actual && clave !== String(m.id)) {
      const raiz = est.porId.get(actual.getAttribute('data-id')) || null;
      let resp = actual.querySelector('.respuestas');
      if (!resp) {
        const cuerpo = actual.querySelector('.cuerpo');
        if (!cuerpo) return false;
        resp = el('div', { class: 'respuestas', role: 'group', 'aria-label': `Respuestas a ${(raiz && raiz.deNombre) || 'este mensaje'}` });
        cuerpo.appendChild(resp);
        actual.classList.add('conversacion');
      }
      const nodo = nodoMensaje(m, { raiz: raiz || m });
      let antesDe = null;
      for (const r of resp.children) if (Number(r.dataset.t) > m.t) { antesDe = r; break; }
      resp.insertBefore(nodo, antesDe);
      const t = Math.max(Number(actual.dataset.t) || -Infinity, m.t);
      actual.dataset.t = t;
      actual.dataset.dia = cifras.dia(t) || '';
      if (actual !== feed.lastElementChild) { sacarDelFeed(feed, actual); alFinalDelFeed(feed, actual); }
      return true;
    }
    const bloque = bloqueDe(clave);
    if (!bloque || !(pasaFiltro(bloque.raiz) || bloque.respuestas.some(pasaFiltro))) return false;
    if (actual) sacarDelFeed(feed, actual);
    alFinalDelFeed(feed, nodoBloque(bloque));
    return true;
  }

  // Añade mensajes nuevos (sin repetir: se quitan los duplicados por id, también
  // los que vuelven a llegar con la instantánea o al reconectar). Devuelve los nuevos.
  //
  // Sin rehacer el feed (revisión del 30-sep-2026): con el reproductor, cada
  // mensaje soltado llegaba «fuera de orden» (su hora es anterior a la del
  // último) o era la respuesta a una conversación de más arriba, y se rehacía
  // el feed entero, hasta 300 bloques con sus caras: en el móvil, cientos de ms
  // de hilo principal por mensaje. Ahora cada uno va a su sitio
  // (colocarMensaje). Solo se rehace entero con muchos de golpe (más de 60: la
  // primera instantánea), con `historia` (mensajes viejos que llegan tras una
  // reconexión y van en su sitio por hora) y al cambiar de filtro.
  function anadirMensajes(lista, opciones) {
    const o = opciones || {};
    const nuevos = [];
    for (const m of lista || []) {
      if (!m || !m.id || est.vistos.has(m.id)) continue;
      est.vistos.add(m.id);
      est.mensajes.push(m);
      est.porId.set(m.id, m);
      nuevos.push(m);
    }
    if (!nuevos.length) return nuevos;
    est.mensajes.sort((a, b) => a.t - b.t);
    if (est.mensajes.length > MAX_MEMORIA) {
      for (const m of est.mensajes.splice(0, est.mensajes.length - MAX_MEMORIA)) { est.vistos.delete(m.id); est.porId.delete(m.id); }
    }
    const feed = $('feed');
    const abajo = pegadoAbajo();
    const ultimo = feed.lastElementChild;
    if (o.historia || nuevos.length > 60
      || (ultimo && !ultimo.classList.contains('msg') && !ultimo.classList.contains('separador-dia'))) {
      repintarFeed(abajo);
    } else {
      for (const m of nuevos) if (colocarMensaje(feed, m) && !abajo) est.nuevosSinVer++;
      while (feed.childElementCount > MAX_DOM) feed.removeChild(feed.firstElementChild);
      asegurarSeparadorArriba(feed);
      if (abajo) feed.scrollTop = feed.scrollHeight;
      else if (est.nuevosSinVer > 0) {
        const b = $('nuevos');
        b.hidden = false;
        b.textContent = `${est.nuevosSinVer} nuevo${est.nuevosSinVer === 1 ? '' : 's'} ↓`;
      }
    }
    $('contador').textContent = cifras.numero(est.mensajes.length);
    return nuevos;
  }

  // El feed entero, por conversaciones (caras.organizarHilos): un mensaje
  // suelto es una conversación de uno. Con un filtro de departamento, una
  // conversación sale entera si alguno de sus mensajes es de ese departamento.
  function repintarFeed(bajar) {
    const feed = $('feed');
    feed.textContent = '';
    const bloques = caras.organizarHilos(est.mensajes, est.porId)
      .filter(b => pasaFiltro(b.raiz) || b.respuestas.some(pasaFiltro))
      .slice(-MAX_DOM);
    const frag = document.createDocumentFragment();
    let dia = null;
    for (const b of bloques) {
      const n = nodoBloque(b);
      if (n.dataset.dia !== dia) { frag.appendChild(separadorDia(Number(n.dataset.t))); dia = n.dataset.dia; }
      frag.appendChild(n);
    }
    feed.appendChild(frag);
    if (!bloques.length) feed.appendChild(el('p', { class: 'vacio', text: 'Sin mensajes de este departamento todavía.' }));
    if (bajar !== false) bajarDelTodo();
  }

  // Los últimos `n` mensajes de un agente (del más nuevo al más viejo).
  function ultimosMensajesDe(agenteId, n) {
    const salida = [];
    for (let k = est.mensajes.length - 1; k >= 0 && salida.length < n; k--) if (est.mensajes[k].de === agenteId) salida.push(est.mensajes[k]);
    return salida;
  }

  function ultimoMensajeDe(agenteId) {
    for (let k = est.mensajes.length - 1; k >= 0; k--) if (est.mensajes[k].de === agenteId) return est.mensajes[k];
    return null;
  }

  // ---------- pestaña Equipo ----------
  // Los agentes por departamento (con su color y una frase de qué hace), con
  // cara, nombre, rol y qué hace; al pulsar, su ficha. Se rehace cuando cambia
  // la plantilla, el estado de alguien o lo buscado, y solo si se ve.
  function firmaEquipo(inst) {
    const ags = (inst && inst.agentes) || [];
    return `${est.busqueda}|${est.departamentos.map(d => d.id + d.color).join()}|`
      + ags.map(a => `${a.id}:${a.nombre}:${a.estado}:${a.rol}:${a.mesaId || ''}`).join(';')
      + '|' + ((inst && inst.mesas) || []).map(m => `${m.id}:${m.nombre}:${m.estado}`).join(';');
  }

  function actualizarEquipo(instParam) {
    const cont = $('equipo');
    if (!cont) return;
    const inst = instParam || (est.manejadores.instantanea ? est.manejadores.instantanea() : null);
    const total = ((inst && inst.agentes) || []).length;
    const cuenta = $('contador-equipo');
    if (cuenta) cuenta.textContent = total ? cifras.numero(total) : '';
    if (est.pestana !== 'equipo') return;
    const firma = firmaEquipo(inst);
    if (firma === est.firmaEquipo) return;
    est.firmaEquipo = firma;
    pintarEquipo(cont, inst);
  }

  function pintarEquipo(cont, inst) {
    // Si el foco estaba en una fila, vuelve a la misma persona después de rehacer.
    const activo = document.activeElement;
    const focoEn = activo && cont.contains(activo) ? activo.getAttribute('data-agente') : null;
    cont.textContent = '';
    if (!inst || !Array.isArray(inst.agentes) || !inst.agentes.length) {
      cont.appendChild(el('p', { class: 'vacio', text: 'Todavía no ha llegado la plantilla de la mesa.' }));
      return;
    }
    const grupos = caras.agruparEquipo(inst.agentes, est.departamentos, { busqueda: est.busqueda, mesas: inst.mesas });
    if (!grupos.length) {
      cont.appendChild(el('p', { class: 'vacio', text: `Nadie del equipo se llama «${est.busqueda.trim()}».` }));
      return;
    }
    const mesas = new Map((inst.mesas || []).map(m => [m.id, m]));
    const frag = document.createDocumentFragment();
    for (const g of grupos) {
      const titulo = `equipo-dep-${g.id}`;
      const sec = el('section', { class: 'equipo-dep', 'aria-labelledby': titulo });
      sec.style.setProperty('--dep', g.color);
      const cuantos = g.agentes.length === g.total ? cifras.numero(g.total) : `${cifras.numero(g.agentes.length)} de ${cifras.numero(g.total)}`;
      sec.appendChild(el('header', { class: 'equipo-dep-cab' },
        el('h3', { id: titulo }, el('span', { class: 'punto', 'aria-hidden': 'true' }), g.nombre,
          el('span', { class: 'cuantos', text: cuantos })),
        g.frase ? el('p', { text: g.frase }) : null));
      const lista = el('ul', { class: 'equipo-lista' });
      let mesaActual;
      for (const a of g.agentes) {
        // En Mesas, un rótulo por mesa: cada operador con sus compañeros.
        if (g.id === 'mesas' && a.mesaId !== mesaActual) {
          mesaActual = a.mesaId;
          const m = mesas.get(a.mesaId);
          lista.appendChild(el('li', { class: 'equipo-mesa', 'aria-hidden': 'true',
            text: m ? `${m.nombre || m.id} · ${cifras.estadoMesa(m.estado)}` : (a.mesaId || 'Sin mesa') }));
        }
        const estado = a.estado && a.estado !== 'trabajando' ? ESTADO_AGENTE[a.estado] || a.estado : null;
        // Sin aria-label: el lector lee lo que se ve (nombre, estado, rol y qué hace).
        const b = el('button', { class: 'equipo-persona', type: 'button', 'data-agente': a.id,
          onclick: () => abrirFichaAgente(a.id) },
        cara(a, 40),
        el('span', { class: 'equipo-texto' },
          el('span', { class: 'equipo-nombre' }, el('b', { text: a.nombre }), estado ? el('span', { class: 'estado-agente estado-' + a.estado, text: estado }) : null),
          el('span', { class: 'equipo-rol', text: a.rol || '' }),
          a.queHace ? el('span', { class: 'equipo-hace', text: a.queHace }) : null));
        lista.appendChild(el('li', {}, b));
      }
      sec.appendChild(lista);
      frag.appendChild(sec);
    }
    cont.appendChild(frag);
    if (focoEn) {
      const b = cont.querySelector(`[data-agente="${focoEn}"]`);
      if (b) { try { b.focus({ preventScroll: true }); } catch (_) { b.focus(); } }
    }
  }

  // ---------- tarjeta de detalle ----------
  function fila(nombre, valor, clase) {
    return [el('dt', { text: nombre }), el('dd', { class: clase || null, text: valor })];
  }

  const esMovil = () => Boolean(window.matchMedia && window.matchMedia('(max-width: 767px)').matches);
  const FONDO_TARJETA = ['barra', 'lateral', 'lienzo', 'botonera'];

  // En el móvil la tarjeta tapa la pantalla entera: es un diálogo y lo de
  // detrás queda inerte (Tab no se escapa a los botones tapados).
  function fijarInerte(activo) {
    for (const id of FONDO_TARJETA) {
      const n = $(id);
      if (!n) continue;
      if (activo) n.setAttribute('inert', ''); else n.removeAttribute('inert');
    }
  }

  // Diálogo a pantalla completa en el móvil; panel no modal en escritorio. Se
  // vuelve a decidir al cambiar el tamaño con la tarjeta abierta.
  function ajustarModoTarjeta() {
    const t = $('tarjeta');
    if (!t || t.hidden || !est.tarjeta) { fijarInerte(false); return; }
    if (esMovil()) {
      t.setAttribute('role', 'dialog');
      t.setAttribute('aria-modal', 'true');
      fijarInerte(true);
    } else {
      t.removeAttribute('role');
      t.removeAttribute('aria-modal');
      fijarInerte(false);
    }
  }

  // `opciones.origen`: lo que la abrió (el lienzo, con un toque o un clic):
  // al cerrarla, el foco vuelve ahí. Un toque en el lienzo no lo enfoca
  // (preventDefault, app.js) y el foco volvía a <body>: sin origen y con el
  // foco en <body>, también al lienzo.
  function mostrarTarjeta(sel, inst, opciones) {
    est.tarjeta = sel;
    const t = $('tarjeta');
    const primera = t.hidden;
    const focoDentro = !primera && t.contains(document.activeElement);
    t.hidden = false;
    if (primera) {
      const activo = document.activeElement;
      est.ultimoFoco = (opciones && opciones.origen) || (activo && activo !== document.body ? activo : $('lienzo'));
    }
    rellenarTarjeta(sel, inst);
    if (focoDentro && !esMovil()) { const c = t.querySelector('.cerrar'); if (c) c.focus(); }
    ajustarModoTarjeta();
    if (esMovil()) { const cerrar = t.querySelector('.cerrar'); if (cerrar) cerrar.focus(); }
  }

  const botonCerrar = () => el('button', { class: 'cerrar boton-icono', type: 'button', 'aria-label': 'Cerrar ficha', title: 'Cerrar ficha',
    onclick: () => { ocultarTarjeta(); if (est.manejadores.alCerrarTarjeta) est.manejadores.alCerrarTarjeta(); } }, icono('cerrar'));

  const irA = (sel, texto) => el('button', { class: 'boton enlace', type: 'button', text: texto,
    onclick: () => { if (est.manejadores.alSeleccionar) est.manejadores.alSeleccionar(sel); } });

  function rellenarTarjeta(sel, inst) {
    const t = $('tarjeta');
    t.textContent = '';
    if (!sel || !inst) return;
    const cerrar = botonCerrar();
    t.classList.toggle('ficha-agente', sel.tipo === 'agente');
    if (sel.tipo === 'puesto') rellenarPuesto(t, sel, inst, cerrar);
    else if (sel.tipo === 'mesa') rellenarMesa(t, sel, inst, cerrar);
    else rellenarAgente(t, sel, inst, cerrar);
  }

  function rellenarPuesto(t, sel, inst, cerrar) {
    const p = (inst.puestos || []).find(x => x.id === sel.id);
    if (!p) { t.appendChild(el('p', { class: 'vacio', text: 'Este puesto ya no existe.' })); t.appendChild(cerrar); return; }
    const mesa = (inst.mesas || []).find(m => m.id === p.mesaId) || {};
    const ag = (inst.agentes || []).find(a => a.id === p.agenteId);
    const cot = (inst.cotizaciones || []).find(c => c.simbolo === p.simbolo);
    const pos = p.posicion;
    const precio = cot ? cot.precio : null;
    const edad = cot ? cifras.precioViejo(cot, inst.ahora, inst.limites) : null;
    const situacion = mesa.estado === 'banquillo' ? 'banquillo' : pos ? 'comprado' : 'sin posición';
    const distStop = pos && precio && pos.stop ? (precio - pos.stop) / precio : null;
    const ultimo = ultimoMensajeDe(p.agenteId);
    const bloqueos = cifras.bloqueosPuesto(inst, p, inst.ahora);
    t.appendChild(el('header', { class: 'tarjeta-cab' },
      el('div', { class: 'tarjeta-titulo', id: 'tarjeta-titulo' },
        el('span', { class: 'etq', text: p.etiqueta }), ` · ${mesa.nombre || p.mesaId}`),
      el('div', { class: 'tarjeta-sub', text: `${p.simbolo} · ${mesa.familia || ''} ${NOMBRE_MARCO[mesa.marco] || mesa.marco || ''} · ${cifras.estadoMesa(mesa.estado)}` }),
      cerrar));
    if (ag) {
      // Quién lleva el puesto: su cara y, al pulsar, su ficha.
      t.appendChild(el('button', { class: 'tarjeta-persona con-ficha', type: 'button', 'aria-label': `Ficha de ${ag.nombre}: ${ag.rol}`,
        onclick: () => abrirFichaAgente(ag.id) },
      cara(ag, 40),
      el('div', {}, el('b', { text: ag.nombre }), el('span', { text: `${ag.rol} · ${ESTADO_AGENTE[ag.estado] || ag.estado}` })),
      el('span', { class: 'ir', 'aria-hidden': 'true', text: '›' })));
    }
    for (const b of bloqueos) t.appendChild(el('p', { class: 'bloqueo', text: b.texto }));
    const precioTexto = precio === null || precio === undefined ? '—'
      : `${cifras.precio(precio)}${edad && edad.viejo ? ` (${edad.edadMs === null ? 'sin hora' : cifras.hace(edad.edadMs)})` : ''}`;
    const dl = el('dl', { class: 'tabla' },
      fila('Situación', situacion, pos ? 'pos' : ''),
      fila('Nocional', pos ? cifras.usd(pos.nocional) : '—'),
      fila('Cantidad', pos ? `${cifras.cantidad(pos.cantidad)} ${p.etiqueta}` : '—'),
      fila('Entrada', pos ? cifras.precio(pos.entrada) : '—'),
      fila('Stop', pos ? `${cifras.precio(pos.stop)}${distStop !== null ? ` (a ${cifras.pct(distStop, { decimales: 1 })})` : ''}` : '—'),
      fila('Objetivo', pos && Number.isFinite(pos.objetivo) ? cifras.precio(pos.objetivo) : '—'),
      fila('Abierto', pos ? `${cifras.usd(pos.pnlAbierto, { signo: true })} (${cifras.pct(pos.pnlAbiertoPct, { signo: true })})` : '—',
        pos ? cifras.claseSigno(pos.pnlAbierto, 0.005) : ''),
      fila('P&L del día', cifras.usd(p.pnlDia, { signo: true }), cifras.claseSigno(p.pnlDia, 0.005)),
      fila('Operaciones', cifras.numero(p.operaciones)),
      fila('Acierto', cifras.pct(p.acierto, { decimales: 0 })),
      fila('Adherencia', cifras.pct(p.adherencia, { decimales: 0 })),
      fila('Factor', Number.isFinite(p.factorBeneficio) ? cifras.numero(p.factorBeneficio, 2) : '—'),
      fila('Precio', precioTexto, edad && edad.viejo ? 'viejo' : ''),
      fila('Última señal', p.ultimaSenal ? `${cifras.accionSenal(p.ultimaSenal.accion)} · ${cifras.momento(p.ultimaSenal.t, inst.ahora)}` : '—'));
    t.appendChild(dl);
    if (Array.isArray(p.chispa) && p.chispa.length > 1) t.appendChild(chispaSvg(p.chispa, pos ? (pos.pnlAbierto >= 0 ? '#22c55e' : '#ef4444') : '#8a93b0'));
    if (p.estadoTexto) t.appendChild(el('p', { class: 'estado-texto', text: p.estadoTexto }));
    // La mesa del puesto: estado, peso y la nota de Dirección (por qué está así).
    if (mesa.id) {
      t.appendChild(el('div', { class: 'bloque-mesa' },
        el('h3', { text: 'Mesa' }),
        el('p', {}, `${mesa.nombre} · ${cifras.estadoMesa(mesa.estado)} · peso ${cifras.pct(mesa.peso, { decimales: 0 })}`),
        mesa.nota ? el('p', { class: 'nota-mesa', text: mesa.nota }) : null,
        irA({ tipo: 'mesa', id: mesa.id }, 'Ver la mesa')));
    }
    t.appendChild(bloqueUltimo(ultimo, inst.ahora));
  }

  function rellenarMesa(t, sel, inst, cerrar) {
    const m = (inst.mesas || []).find(x => x.id === sel.id);
    if (!m) { t.appendChild(el('p', { class: 'vacio', text: 'Esta mesa ya no existe.' })); t.appendChild(cerrar); return; }
    const met = m.metricas || {};
    const puestos = (inst.puestos || []).filter(p => p.mesaId === m.id);
    t.appendChild(el('header', { class: 'tarjeta-cab' },
      el('div', { class: 'tarjeta-titulo', id: 'tarjeta-titulo', text: m.nombre || m.id }),
      el('div', { class: 'tarjeta-sub', text: `${m.familia || ''} ${NOMBRE_MARCO[m.marco] || m.marco || ''} · ${cifras.estadoMesa(m.estado)}` }),
      cerrar));
    if (m.nota) t.appendChild(el('p', { class: 'estado-texto', text: m.nota }));
    for (const b of cifras.bloqueosMesa(inst, m.id, inst.ahora)) t.appendChild(el('p', { class: 'bloqueo', text: b.texto }));
    const n2 = x => (Number.isFinite(x) ? cifras.numero(x, 2) : '—');
    t.appendChild(el('dl', { class: 'tabla' },
      fila('Estado', cifras.estadoMesa(m.estado)),
      fila('Peso', cifras.pct(m.peso, { decimales: 0 })),
      fila('Capital', cifras.usd(m.capital)),
      fila('Multiplicador del comité', Number.isFinite(m.multiplicador) ? `×${cifras.numero(m.multiplicador, m.multiplicador % 1 ? 1 : 0)}` : '—'),
      fila('P&L del día', cifras.usd(m.pnlDia, { signo: true }), cifras.claseSigno(m.pnlDia, 0.005)),
      fila('P&L total', cifras.usd(met.pnlTotal, { signo: true }), cifras.claseSigno(met.pnlTotal, 0.005)),
      fila('Operaciones', cifras.numero(met.operaciones)),
      fila('Acierto', cifras.pct(met.acierto, { decimales: 0 })),
      fila('Factor', n2(met.factorBeneficio)),
      fila('Sharpe', n2(met.sharpe)),
      fila('Sharpe ajustado', n2(met.sharpeAjustado)),
      fila('Caída máxima', cifras.pct(met.maxDD, { decimales: 1 })),
      fila('Adherencia', cifras.pct(met.adherencia, { decimales: 0 })),
      fila('Universo', (m.universo || []).join(', ') || '—')));
    if (puestos.length) {
      t.appendChild(el('div', { class: 'que-decide' }, el('h3', { text: 'Puestos' }),
        el('div', { class: 'lista-puestos' }, puestos.map(p => irA({ tipo: 'puesto', id: p.id },
          `${p.etiqueta}${p.posicion ? ` · ${cifras.pct(p.posicion.pnlAbiertoPct, { signo: true, decimales: 1 })}` : ''}`)))));
    }
  }

  function rellenarAgente(t, sel, inst, cerrar) {
    const ag = (inst.agentes || []).find(a => a.id === sel.id);
    if (!ag) { t.appendChild(el('p', { class: 'vacio', text: 'Este agente ya no está en la plantilla.' })); t.appendChild(cerrar); return; }
    const llm = inst.llm || {};
    const modelo = ag.id === 'cio' ? llm.modeloComite : llm.modeloAgentes;
    const estado = ESTADO_AGENTE[ag.estado] || ag.estado || '—';
    const sala = NOMBRE_SALA[ag.sala] || ag.sala || '—';
    // Quién es: la cara grande (la de su muñeco), su nombre, su departamento y su rol.
    t.appendChild(el('header', { class: 'tarjeta-cab ficha-agente-cab' },
      cara(ag, 96),
      el('div', { class: 'ficha-agente-quien' },
        el('div', { class: 'tarjeta-titulo', id: 'tarjeta-titulo', text: ag.nombre }),
        el('div', { class: 'ficha-agente-etiquetas' }, etiquetaDep(ag.departamento),
          el('span', { class: 'estado-agente estado-' + (ag.estado || 'trabajando'), text: estado })),
        el('div', { class: 'tarjeta-sub', text: ag.rol || '—' })),
      cerrar));
    // Qué hace, en llano (el texto técnico va en «Detalle técnico»).
    if (ag.queHace) t.appendChild(el('div', { class: 'que-hace' }, el('h3', { text: 'Qué hace' }), el('p', { text: ag.queHace })));
    // Si es operador: su mesa y su posición.
    const puesto = ag.puestoId ? (inst.puestos || []).find(p => p.id === ag.puestoId) : null;
    const mesa = ag.mesaId ? (inst.mesas || []).find(m => m.id === ag.mesaId) : null;
    if (puesto || mesa) t.appendChild(bloqueOperador(puesto, mesa));
    t.appendChild(el('dl', { class: 'tabla' },
      fila('Ahora', `${estado} · ${sala}`),
      ag.etiqueta && !puesto ? fila('Sigue', ag.etiqueta) : null));
    t.appendChild(bloqueUltimos(ultimosMensajesDe(ag.id, 5), inst.ahora));
    // Sus decisiones apuntadas (vista Decisiones filtrada por él o ella).
    if (est.manejadores.alVerDecisiones) {
      t.appendChild(el('div', { class: 'lista-puestos' },
        el('button', { class: 'boton enlace', type: 'button', text: 'Ver sus decisiones', 'aria-label': `Ver las decisiones de ${ag.nombre}`,
          onclick: () => est.manejadores.alVerDecisiones(ag.id) })));
    }
    // Detalle técnico: se queda desplegado aunque la ficha se rehaga con cada dato.
    const det = el('details', { class: 'detalle-tecnico' },
      el('summary', { text: 'Detalle técnico' }),
      el('div', { class: 'que-decide' }, el('h3', { text: 'Qué decide' }), el('p', { text: ag.queDecide || '—' })),
      el('dl', { class: 'tabla' },
        fila('Usa LLM', ag.usaLLM ? (llm.activo ? `Sí · ${modelo || '—'}` : 'Sí, pero el LLM está apagado: plantillas') : 'No: reglas y plantillas'),
        fila('Identificador', ag.id)));
    if (est.detalleAbierto.has(ag.id)) det.open = true;
    det.addEventListener('toggle', () => { if (det.open) est.detalleAbierto.add(ag.id); else est.detalleAbierto.delete(ag.id); });
    t.appendChild(det);
  }

  // La mesa y la posición de un operador, con las cifras de la instantánea.
  function bloqueOperador(p, mesa) {
    const pos = p && p.posicion;
    return el('div', { class: 'bloque-mesa' },
      el('h3', { text: 'Su mesa y su posición' }),
      mesa ? el('p', {}, el('b', { text: mesa.nombre || mesa.id }), ` · ${cifras.estadoMesa(mesa.estado)} · peso ${cifras.pct(mesa.peso, { decimales: 0 })}`) : null,
      pos
        ? el('dl', { class: 'tabla' },
          fila('Posición', `${cifras.cantidad(pos.cantidad)} ${p.etiqueta}`),
          fila('Nocional', cifras.usd(pos.nocional)),
          fila('Entrada', cifras.precio(pos.entrada)),
          fila('Stop', Number.isFinite(pos.stop) ? cifras.precio(pos.stop) : '—'),
          fila('Abierto', `${cifras.usd(pos.pnlAbierto, { signo: true })} (${cifras.pct(pos.pnlAbiertoPct, { signo: true })})`, cifras.claseSigno(pos.pnlAbierto, 0.005)))
        : p ? el('p', { class: 'nota-mesa', text: mesa && mesa.estado === 'banquillo' ? 'En el banquillo: sin posición.' : 'Sin posición abierta.' }) : null,
      p && p.estadoTexto ? el('p', { class: 'estado-texto', text: p.estadoTexto }) : null,
      el('div', { class: 'lista-puestos' },
        p ? irA({ tipo: 'puesto', id: p.id }, 'Ver su puesto') : null,
        mesa ? irA({ tipo: 'mesa', id: mesa.id }, 'Ver la mesa') : null));
  }

  function bloqueUltimos(lista, ahora) {
    return el('div', { class: 'ultimo' }, el('h3', { text: 'Últimos mensajes' }),
      lista.length
        ? el('ul', { class: 'ultimos' }, lista.map(m => el('li', {}, el('time', { text: cifras.momento(m.t, ahora) + ' · ' }), m.texto)))
        : el('p', { class: 'vacio', text: 'Todavía no ha dicho nada.' }));
  }

  function bloqueUltimo(m, ahora) {
    return el('div', { class: 'ultimo' }, el('h3', { text: 'Último mensaje' }),
      m ? el('p', {}, el('time', { text: cifras.momento(m.t, ahora) + ' · ' }), m.texto) : el('p', { class: 'vacio', text: 'Todavía no ha dicho nada.' }));
  }

  function chispaSvg(serie, color) {
    const W = 260; const H = 38;
    let min = Infinity; let max = -Infinity;
    for (const v of serie) { if (v < min) min = v; if (v > max) max = v; }
    const r = max - min || 1;
    const pts = serie.map((v, k) => `${(k / (serie.length - 1) * (W - 4) + 2).toFixed(1)},${(H - 3 - (v - min) / r * (H - 6)).toFixed(1)}`).join(' ');
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', `0 0 ${W} ${H}`);
    s.setAttribute('class', 'chispa');
    s.setAttribute('role', 'img');
    s.setAttribute('aria-label', 'Últimos 16 cierres');
    s.innerHTML = `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    return s;
  }

  function ocultarTarjeta() {
    est.tarjeta = null;
    const t = $('tarjeta');
    t.hidden = true;
    // Siempre, mire lo que mire el ancho: si la ventana cambió de tamaño con la
    // tarjeta abierta, no puede quedar la página inerte.
    fijarInerte(false);
    t.removeAttribute('role');
    t.removeAttribute('aria-modal');
    const destino = equivalenteVivo(est.ultimoFoco);
    if (destino && destino.focus) {
      try { destino.focus({ preventScroll: true }); } catch (_) { /* nada */ }
    }
  }

  // Lo que abrió la ficha, o su equivalente si mientras tanto se rehízo (la
  // fila del equipo de esa persona, o la cara de ese mensaje en el feed).
  function equivalenteVivo(n) {
    if (!n) return null;
    if (document.contains(n)) return n;
    const agente = n.getAttribute && n.getAttribute('data-agente');
    const msgId = n.getAttribute && n.getAttribute('data-msg');
    if (agente && $('equipo')) return $('equipo').querySelector(`[data-agente="${agente}"]`);
    if (msgId && $('feed')) return $('feed').querySelector(`[data-msg="${msgId}"]`);
    return null;
  }

  // La tarjeta se rehace con cada estado, mensaje o movimiento de un agente.
  // Si el foco estaba dentro, vuelve a su botón equivalente (si no, caía a
  // <body> varias veces por segundo y el lector de pantalla empezaba de nuevo).
  function refrescarTarjeta(inst) {
    const t = $('tarjeta');
    if (!est.tarjeta || t.hidden) return;
    const activo = document.activeElement;
    const teniaFoco = t.contains(activo);
    let indice = -1;
    // «Detalle técnico» (summary) también recibe el foco: cuenta como un botón más.
    if (teniaFoco) indice = Array.from(t.querySelectorAll('button, summary')).indexOf(activo);
    const scroll = t.scrollTop;
    rellenarTarjeta(est.tarjeta, inst);
    t.scrollTop = scroll;
    if (teniaFoco) {
      const botones = t.querySelectorAll('button, summary');
      const destino = (indice >= 0 && botones[indice]) || t.querySelector('.cerrar');
      if (destino) { try { destino.focus({ preventScroll: true }); } catch (_) { destino.focus(); } }
    }
  }

  // ---------- conexión, avisos, tostadas ----------
  // Franja de arriba: roja sin conexión (diciendo por qué, si se sabe) y ámbar
  // con conexión pero sin datos nuevos desde hace demasiado.
  // Partes del texto sin conexión: `cuenta` es « en N s» (o '') y va aparte
  // para poder contar hacia atrás sin rehacer lo demás. `reintento`: si se
  // dice que se reintenta (con un motivo, solo si hay espera).
  function partesConexion(motivo, reintento, segundos) {
    const cuenta = segundos > 0 ? ` en ${cifras.numero(segundos)} s` : '';
    if (motivo === 'token') return { antes: 'Falta el token del panel: abre la URL con ?token=… (el valor de PANEL_TOKEN).', cuenta: '', despues: '' };
    if (motivo === 'token-malo') return { antes: 'El token del panel no vale: revisa el ?token=… de la URL (tiene que ser el de PANEL_TOKEN).', cuenta: '', despues: '' };
    const conMotivo = motivo === 'lleno' ? 'Hay demasiados paneles abiertos contra la mesa: cierra alguna pestaña.'
      : motivo === 'arrancando' ? 'La mesa está arrancando (histórico, órdenes a medias y conciliación).' : null;
    if (conMotivo) return reintento ? { antes: `${conMotivo} Reintentando`, cuenta, despues: '…' } : { antes: conMotivo, cuenta: '', despues: '' };
    return { antes: 'Sin conexión con la mesa, reintentando', cuenta, despues: '…' };
  }
  const segundosDe = ms => (ms > 0 ? Math.ceil(ms / 1000) : 0);

  function textoConexion(espera, motivo) {
    const p = partesConexion(motivo, Boolean(espera), segundosDe(espera));
    return p.antes + p.cuenta + p.despues;
  }

  // La cuenta atrás («reintentando en 16 s…» → 15 → … → «reintentando…») va
  // en un <span aria-hidden> aparte: la franja es role=status y un lector de
  // pantalla la releería cada segundo; así solo se anuncia el cambio de motivo.
  // `ahoraMs`: reloj de PANTALLA (la reconexión es de verdad, no de la mesa).
  function pintarFranja(ahoraMs) {
    const f = $('franja');
    const c = est.conexion;
    if (!c.ok) {
      f.hidden = false;
      f.className = 'franja';
      const ahora = Number.isFinite(ahoraMs) ? ahoraMs : Date.now();
      const p = partesConexion(c.motivo, c.reintento, segundosDe(c.hasta ? c.hasta - ahora : 0));
      const base = `${p.antes}|${p.despues}`;
      let cuenta = f.querySelector('.cuenta');
      if (f.dataset.base !== base || !cuenta) {
        f.dataset.base = base;
        f.textContent = '';
        cuenta = el('span', { class: 'cuenta', 'aria-hidden': 'true' });
        poner(f, p.antes, cuenta, p.despues || null);
      }
      cuenta.textContent = p.cuenta;
    } else if (est.viejo) {
      f.hidden = false;
      f.className = 'franja ambar';
      f.dataset.base = '';
      f.textContent = est.viejo;
    } else {
      f.hidden = true;
      f.dataset.base = '';
    }
  }

  // `espera`: ms hasta el próximo intento (0 si se está intentando ya).
  function conexion(ok, espera, motivo, ahoraMs) {
    const ahora = Number.isFinite(ahoraMs) ? ahoraMs : Date.now();
    est.conexion = ok ? { ok: true, motivo: null, hasta: null, reintento: false }
      : { ok: false, motivo: motivo || null, hasta: espera > 0 ? ahora + espera : null, reintento: espera > 0 };
    pintarFranja(ahora);
  }

  // Cada segundo (app.js): la cuenta atrás de la franja, si la hay.
  function refrescarFranja(ahoraMs) {
    if (!est.conexion.ok && est.conexion.hasta) pintarFranja(ahoraMs);
  }

  function datosViejos(texto) {
    if ((texto || null) === est.viejo) return;
    est.viejo = texto || null;
    pintarFranja();
  }

  function tostada(texto, tipo) {
    const cont = $('tostadas');
    const t = el('div', { class: 'tostada ' + (tipo || ''), role: 'status', text: texto });
    cont.appendChild(t);
    setTimeout(() => t.classList.add('fuera'), 4200);
    setTimeout(() => t.remove(), 4700);
  }

  // ---------- modales ----------
  function abrirModal(tipo) {
    const d = $('modal');
    const cuerpo = $('modal-cuerpo');
    cuerpo.textContent = '';
    d.className = 'modal' + (tipo === 'kill' ? ' peligro' : '') + (tipo === 'resultados' ? ' ancho' : '');
    const fn = MODALES[tipo];
    if (!fn) return;
    fn(cuerpo);
    if (!d.open) d.showModal();
    // El foco va a lo primero que hay que tocar (el campo o el botón principal),
    // salvo en los modales que se leen (Resultados): ahí va al título, para que
    // se abran por arriba. Con el «Cerrar» del pie, Resultados se abría
    // desplazado hasta el laboratorio y «¿Aporta algo el comité?» quedaba fuera.
    const primero = cuerpo.querySelector('[data-foco-inicial]') || cuerpo.querySelector('textarea, input:not([disabled]), select, button.primario');
    if (primero) { try { primero.focus({ preventScroll: true }); } catch (_) { primero.focus(); } }
    d.scrollTop = 0;
    cuerpo.scrollTop = 0;
  }

  function cerrarModal() { const d = $('modal'); if (d.open) d.close(); }

  // Con { lectura: true } el foco inicial va al título (modal que se lee, no se rellena).
  function cabModal(titulo, texto, opciones) {
    const lectura = Boolean(opciones && opciones.lectura);
    return [
      el('header', { class: 'modal-cab' }, el('h2', { id: 'modal-titulo', text: titulo, tabindex: lectura ? '-1' : null, 'data-foco-inicial': lectura }),
        el('button', { class: 'boton-icono', type: 'button', 'aria-label': 'Cerrar', onclick: cerrarModal }, icono('cerrar'))),
      texto ? el('p', { class: 'modal-texto', text: texto }) : null,
    ];
  }

  function zonaResultado() { return el('div', { class: 'resultado', role: 'status', 'aria-live': 'polite' }); }

  function pintarResultado(zona, r) {
    zona.textContent = '';
    if (!r) return;
    zona.className = 'resultado ' + (r.ok ? 'ok' : 'error');
    zona.appendChild(el('p', { text: r.mensaje || (r.ok ? 'Hecho.' : 'No se pudo.') }));
    const comp = r.datos && Array.isArray(r.datos.comprobaciones) ? r.datos.comprobaciones : null;
    if (comp) {
      zona.appendChild(el('ul', { class: 'comprobaciones' }, comp.map(c => el('li', { class: c.ok ? 'ok' : 'error' },
        el('b', { text: c.nombre }), el('span', { text: c.detalle || (c.ok ? 'bien' : 'falla') })))));
    } else if (r.datos && typeof r.datos === 'object' && !Array.isArray(r.datos) && r.datos.comprobaciones === undefined && r.mostrarDatos) {
      zona.appendChild(el('pre', { text: JSON.stringify(r.datos, null, 2) }));
    }
  }

  async function ejecutar(boton, zona, nombre, cuerpo) {
    if (!est.manejadores.comando) return null;
    boton.disabled = true;
    boton.classList.add('ocupado');
    zona.className = 'resultado';
    zona.textContent = 'Enviando…';
    let r;
    try { r = await est.manejadores.comando(nombre, cuerpo); } catch (e) { r = { ok: false, mensaje: 'Sin conexión con la mesa.' }; }
    boton.disabled = false;
    boton.classList.remove('ocupado');
    pintarResultado(zona, r);
    if (r && r.mensaje) tostada(r.mensaje, r.ok ? 'ok' : 'error');
    return r;
  }

  function pieModal(...botones) { return el('div', { class: 'modal-pie' }, el('button', { class: 'boton', type: 'button', onclick: cerrarModal, text: 'Cancelar' }), ...botones); }

  // Campo de confirmación: el botón solo se habilita al escribir la palabra exacta.
  function confirmacion(palabra, boton) {
    const input = el('input', { class: 'campo', type: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false',
      'aria-label': `Escribe ${palabra} para confirmar`, placeholder: palabra });
    boton.disabled = true;
    input.addEventListener('input', () => { boton.disabled = input.value.trim() !== palabra; });
    return { input, valor: () => input.value.trim(), campo: el('label', { class: 'confirmar' }, el('span', {}, 'Escribe ', el('b', { text: palabra }), ' para confirmar'), input) };
  }

  // ---------- resultados: ¿listo para real?, sombras, mejora, mesas, capital sin asignar, laboratorio ----------

  const ESTADO_HIPOTESIS = { pendiente: 'Pendiente', evaluando: 'Evaluando', aprobada: 'Aprobada', rechazada: 'Rechazada' };
  const QUE_COMPARA_COMITE = 'Mismas mesas, mismos límites y mismas órdenes tuyas (kill, pausa, Megáfono); solo cambia lo que decide el comité.';
  const n2 = x => (Number.isFinite(x) ? cifras.numero(x, 2) : '—');
  const conSigno = (texto, x) => (x > 0 && /[1-9]/.test(texto) ? '+' + texto : texto);

  function valorCriterio(c, v) {
    if (!Number.isFinite(v)) return '—';
    if (/maxDD|caída|ventanas/i.test(c.nombre || '')) return cifras.pct(v, { decimales: 0 });
    if (Number.isInteger(v)) return cifras.numero(v);
    return cifras.numero(v, 2);
  }

  // Capital de partida sin mirar la configuración: todas las sombras empiezan
  // con él, así que sale de cualquiera (valor / (1 + rentabilidad)).
  function capitalDe(inst) {
    for (const b of inst.benchmarks || []) {
      if (Number.isFinite(b.valor) && Number.isFinite(b.rentabilidad) && b.rentabilidad > -1) return b.valor / (1 + b.rentabilidad);
    }
    return null;
  }

  // Semáforo «¿Listo para dinero real?» (§5.8): los criterios a-g con su
  // valor, su umbral y si pasan, la nota del comité y lo que NO hace. Va el
  // primero: es la pregunta que Eduardo se hace al abrir Resultados.
  function seccionListoParaReal(lr) {
    const criterios = Array.isArray(lr.criterios) ? lr.criterios : [];
    const veredicto = lr.listo
      ? 'Sí: cumple todos'
      : `Todavía no: ${cifras.numero(lr.cumplidos)} de ${cifras.numero(lr.total || criterios.length)}`;
    return el('section', { class: 'bloque listo-real ' + (lr.listo ? 'listo-si' : 'listo-no'), 'aria-labelledby': 'res-real' },
      el('div', { class: 'listo-cab' },
        el('h3', { id: 'res-real', text: '¿Listo para dinero real?' }),
        el('span', { class: 'listo-veredicto', text: veredicto })),
      el('ul', { class: 'criterios-real' }, criterios.map(k => el('li', { class: k.ok ? 'ok' : 'error' },
        el('span', { class: 'marca', 'aria-hidden': 'true', text: k.ok ? '✓' : '✗' }),
        el('div', { class: 'criterio-cuerpo' },
          el('div', { class: 'criterio-fila' },
            el('b', {}, el('span', { class: 'criterio-letra', text: `${k.id}) ` }), k.nombre || k.id,
              el('span', { class: 'visualmente-oculto', text: k.ok ? ': cumple.' : ': no cumple.' })),
            el('span', { class: 'criterio-valor' }, el('span', { text: k.valorTexto || '—' }), el('span', { class: 'criterio-umbral', text: k.umbralTexto || '' }))),
          k.detalle ? el('p', { class: 'criterio-detalle', text: k.detalle }) : null)))),
      lr.comite && lr.comite.texto ? el('p', { class: 'listo-comite' + (lr.comite.bate === false ? ' sin-comite' : ''), text: lr.comite.texto }) : null,
      lr.nota ? el('p', { class: 'nota listo-nota', text: lr.nota }) : null);
  }

  function construirResultados(c, inst) {
    poner(c, ...cabModal('Resultados', `Lo que gana el fondo frente a sus carteras sombra, todas con costes. Datos de las ${inst ? cifras.hora(inst.ahora) : '—'}.`, { lectura: true }));
    if (!inst) { poner(c, el('p', { class: 'vacio', text: 'Todavía no hay datos de la mesa.' }), el('div', { class: 'modal-pie' }, el('button', { class: 'boton primario', type: 'button', text: 'Cerrar', onclick: cerrarModal }))); return; }
    const cab = inst.cabecera || {};
    const mejora = inst.mejora || {};
    const capital = capitalDe(inst);
    const rentFondo = Number.isFinite(capital) && capital > 0 && Number.isFinite(cab.patrimonio) ? cab.patrimonio / capital - 1 : null;

    if (inst.listoParaReal) poner(c, seccionListoParaReal(inst.listoParaReal));

    // ¿Aporta algo el comité? (principio 7: se mide contra las mismas mesas sin él).
    const dif = Number.isFinite(mejora.sharpe90Fondo) && Number.isFinite(mejora.sharpe90SinComite) ? mejora.sharpe90Fondo - mejora.sharpe90SinComite : null;
    // La sombra «sin comité» sufre lo mismo que el fondo salvo el comité: así la
    // diferencia no le carga al comité un kill, una pausa o un Megáfono tuyos.
    poner(c, el('section', { class: 'bloque resultados-mejora', 'aria-labelledby': 'res-mejora' },
      el('h3', { id: 'res-mejora', text: '¿Aporta algo el comité?' }),
      el('p', { class: 'nota que-compara', text: QUE_COMPARA_COMITE }),
      el('dl', { class: 'tabla' },
        fila('Sharpe 90 d del fondo', n2(mejora.sharpe90Fondo)),
        fila('Sharpe 90 d sin comité', n2(mejora.sharpe90SinComite)),
        fila('Sharpe 90 d de BTC', n2(mejora.sharpe90Btc)),
        fila('Fondo − sin comité', dif === null ? '—' : conSigno(cifras.numero(dif, 2), dif), cifras.claseSigno(dif, 0.005))),
      mejora.texto ? el('p', { class: 'nota', text: mejora.texto }) : null));

    // Sombras.
    const filas = [{ id: 'fondo', nombre: 'El fondo', valor: cab.patrimonio, rentabilidad: rentFondo, sharpe90: mejora.sharpe90Fondo, fondo: true }]
      .concat(inst.benchmarks || []);
    poner(c, el('section', { class: 'bloque', 'aria-labelledby': 'res-sombras' },
      el('h3', { id: 'res-sombras', text: 'Frente a las carteras sombra' }),
      el('div', { class: 'tabla-scroll' }, el('table', { class: 'resultados' },
        el('thead', {}, el('tr', {}, ['Cartera', 'Valor', 'Rentab.', 'Sharpe 90 d', 'Fondo − esta'].map(x => el('th', { scope: 'col', text: x })))),
        el('tbody', {}, filas.map(b => el('tr', { class: b.fondo ? 'fila-fondo' : (b.id === 'sin-comite' ? 'fila-sin-comite' : null) },
          el('th', { scope: 'row', text: b.nombre || b.id }),
          el('td', { text: cifras.usd(b.valor) }),
          el('td', { class: cifras.claseSigno(b.rentabilidad, 0.00005), text: cifras.pct(b.rentabilidad, { signo: true }) }),
          el('td', { text: n2(b.sharpe90) }),
          el('td', { class: b.fondo ? null : cifras.claseSigno(cab.patrimonio - b.valor, 0.005),
            text: b.fondo ? '' : (Number.isFinite(b.valor) && Number.isFinite(cab.patrimonio) ? cifras.usd(cab.patrimonio - b.valor, { signo: true }) : '—') }))))))));

    // Mesas y capital sin asignar.
    const sa = cifras.sinAsignar(inst);
    poner(c, el('section', { class: 'bloque', 'aria-labelledby': 'res-mesas' },
      el('h3', { id: 'res-mesas', text: 'Mesas' }),
      sa && sa.fraccion > 0.0005 ? el('p', { class: 'aviso-sin-asignar',
        text: `Sin asignar: ${cifras.pct(sa.fraccion, { decimales: 0 })} del patrimonio${Number.isFinite(sa.usd) ? ` (${cifras.usd(sa.usd)})` : ''}. Queda en efectivo: solo las titulares han probado ventaja y el resto está en prueba; mejor efectivo que capital en estrategias sin ventaja.` }) : null,
      el('div', { class: 'tabla-scroll' }, el('table', { class: 'resultados' },
        el('thead', {}, el('tr', {}, ['Mesa', 'Estado', 'Peso', 'Sharpe', 'P&L total'].map(x => el('th', { scope: 'col', text: x })))),
        el('tbody', {}, (inst.mesas || []).map(m => el('tr', {},
          el('th', { scope: 'row' }, el('button', { class: 'boton enlace', type: 'button', text: m.nombre || m.id,
            onclick: () => { cerrarModal(); if (est.manejadores.alSeleccionar) est.manejadores.alSeleccionar({ tipo: 'mesa', id: m.id }); } })),
          el('td', { text: cifras.estadoMesa(m.estado) }),
          el('td', { text: cifras.pct(m.peso, { decimales: 0 }) }),
          el('td', { text: n2(m.metricas && m.metricas.sharpe) }),
          el('td', { class: cifras.claseSigno(m.metricas && m.metricas.pnlTotal, 0.005), text: cifras.usd(m.metricas && m.metricas.pnlTotal, { signo: true }) })))))),
      (inst.mesas || []).filter(m => m.nota).map(m => el('p', { class: 'nota' }, el('b', { text: `${m.nombre}: ` }), m.nota))));

    // Laboratorio.
    const lab = inst.laboratorio || {};
    const hip = Array.isArray(lab.hipotesis) ? lab.hipotesis : [];
    poner(c, el('section', { class: 'bloque', 'aria-labelledby': 'res-lab' },
      el('h3', { id: 'res-lab', text: 'Laboratorio' }),
      el('p', { class: 'nota', text: `${cifras.numero(lab.ensayosTotales)} ensayos acumulados (cuentan para el Sharpe deflactado). Próxima revisión: ${cifras.momento(lab.proximaRevision, inst.ahora)}.` }),
      hip.length ? el('ul', { class: 'hipotesis' }, hip.map(h => el('li', { class: 'hip-' + h.estado },
        el('div', { class: 'hip-cab' }, el('span', { class: 'hip-estado', text: ESTADO_HIPOTESIS[h.estado] || h.estado || '—' }),
          el('time', { text: cifras.momento(h.t, inst.ahora) })),
        el('p', { text: h.descripcion || h.id }),
        (h.criterios || []).length ? el('ul', { class: 'criterios' }, h.criterios.map(k => el('li', { class: k.ok ? 'ok' : 'error' },
          el('b', { text: k.nombre }), el('span', { text: `${valorCriterio(k, k.valor)} (${k.ok ? 'pasa' : 'no pasa'}: ${valorCriterio(k, k.umbral)})` })))) : null)))
        : el('p', { class: 'vacio', text: 'Sin hipótesis todavía.' })));
    poner(c, el('div', { class: 'modal-pie' }, el('button', { class: 'boton primario', type: 'button', text: 'Cerrar', onclick: cerrarModal })));
  }

  const MODALES = {
    resultados(c) {
      construirResultados(c, est.manejadores.instantanea ? est.manejadores.instantanea() : null);
    },
    comite(c) {
      const res = zonaResultado();
      const b = el('button', { class: 'boton primario', type: 'button', text: 'Convocar ahora' });
      b.addEventListener('click', () => ejecutar(b, res, 'comite', {}));
      poner(c, ...cabModal('Convocar el comité', 'Reúne ahora a Dirección, Macro, Riesgos, el Controller y el Laboratorio. La Presidenta decide el modo del fondo; el voto DEFENSIVO de Riesgos es veto.'), res, pieModal(b));
    },
    megafono(c) {
      const inst = est.manejadores.instantanea ? est.manejadores.instantanea() : null;
      const res = zonaResultado();
      const area = el('textarea', { class: 'campo', rows: '3', maxlength: '500', 'aria-label': 'Qué quieres que haga la mesa',
        placeholder: 'Ej.: pausa SOL 6 h · reduce el riesgo a la mitad · solo cerrar hasta el comité' });
      const propuesta = el('div', { class: 'propuesta', hidden: true });
      const interpretar = el('button', { class: 'boton primario', type: 'button', text: 'Interpretar' });
      const aplicar = el('button', { class: 'boton primario', type: 'button', text: 'Aplicar', hidden: true });
      let id = null;
      const verPropuesta = (p) => {
        id = p && p.id;
        propuesta.textContent = '';
        if (!p) { propuesta.hidden = true; aplicar.hidden = true; return; }
        propuesta.hidden = false;
        poner(propuesta, el('h3', { text: 'Propuesta' }), el('p', { class: 'explicacion', text: p.explicacion || '' }),
          el('ul', {}, (p.directivas || []).map(d => el('li', { class: d.tipo === 'sin_efecto' ? 'sin-efecto' : '', text: textoDirectiva(d, inst && inst.mesas) }))));
        const util = (p.directivas || []).some(d => d.tipo !== 'sin_efecto');
        aplicar.hidden = false;
        aplicar.disabled = !util;
        // Con una propuesta delante, lo principal es Aplicar; reinterpretar pasa a segundo plano.
        interpretar.classList.toggle('primario', !util);
        if (!util) poner(propuesta, el('p', { class: 'nota', text: 'No hay nada que aplicar. Reescribe la orden con otras palabras.' }));
      };
      interpretar.addEventListener('click', async () => {
        const texto = area.value.trim();
        if (!texto) { area.focus(); return; }
        const r = await ejecutar(interpretar, res, 'megafono', { texto });
        // §7: la propuesta viene en `datos`; si llega en el primer nivel también vale.
        const prop = r && r.ok ? (r.datos && r.datos.directivas ? r.datos : (r.directivas ? r : null)) : null;
        if (prop) verPropuesta(prop);
      });
      aplicar.addEventListener('click', async () => {
        if (!id) return;
        const r = await ejecutar(aplicar, res, 'megafono-aplicar', { id });
        if (r && r.ok) { aplicar.hidden = true; propuesta.hidden = true; interpretar.classList.add('primario'); }
      });
      poner(c, ...cabModal('Megáfono', 'Dile a la mesa qué quieres con tus palabras. Se traduce a directivas de una lista cerrada que solo aprietan y caducan solas; no entra nada hasta que pulses Aplicar.'),
        el('label', { class: 'etiqueta-campo', text: 'Orden' }), area, propuesta, res, pieModal(interpretar, aplicar));
      if (inst && inst.megafonoPendiente) { area.value = inst.megafonoPendiente.texto || ''; verPropuesta(inst.megafonoPendiente); }
    },
    prueba(c) {
      const res = zonaResultado();
      const comprobar = el('button', { class: 'boton primario', type: 'button', text: 'Comprobar' });
      comprobar.addEventListener('click', () => ejecutar(comprobar, res, 'prueba', {}));
      const orden = el('button', { class: 'boton', type: 'button', text: 'Hacer la orden mínima' });
      const conf = confirmacion('PRUEBA', orden);
      orden.addEventListener('click', () => ejecutar(orden, res, 'prueba', { ordenMinima: true, confirmacion: conf.valor() }));
      poner(c, ...cabModal('Prueba', 'Comprueba que responden el bróker, los datos de mercado, el índice de miedo y codicia y el LLM. No toca la cartera.'),
        el('div', { class: 'bloque' }, el('h3', { text: 'Orden mínima (opcional)' }),
          el('p', { class: 'modal-texto', text: 'Compra y vende 15 $ de BTC en la cuenta de papel para ver el circuito completo de una orden.' }), conf.campo, orden),
        res, pieModal(comprobar));
    },
    pausar(c) {
      const res = zonaResultado();
      const b = el('button', { class: 'boton primario ambar', type: 'button', text: 'Pausar todo' });
      b.addEventListener('click', () => ejecutar(b, res, 'pausar', {}));
      poner(c, ...cabModal('Pausar todo', 'Pasa el fondo a «solo cerrar» hasta que alguien pulse Reabrir: no se abre nada nuevo; las salidas y los stops siguen funcionando.'), res, pieModal(b));
    },
    reabrir(c) {
      const inst = est.manejadores.instantanea ? est.manejadores.instantanea() : null;
      const res = zonaResultado();
      const b = el('button', { class: 'boton primario', type: 'button', text: 'Reabrir' });
      const conf = confirmacion('REABRIR', b);
      b.addEventListener('click', () => ejecutar(b, res, 'reabrir', { confirmacion: conf.valor() }));
      const notas = [];
      const nivel = inst && inst.fondo && inst.fondo.nivel;
      if (nivel === 'solo_cerrar') notas.push('Ahora el fondo está en «solo cerrar» por la pérdida del día: eso no se reabre a mano, dura hasta las 00:00 UTC.');
      const n = inst ? cifras.nivelEfectivo(inst, inst.ahora) : null;
      const d = (inst && inst.directivas) || {};
      if (d.modo === 'SOLO_CERRAR') notas.push('El comité tiene el fondo en SOLO CERRAR: Reabrir no lo quita; lo cambia el próximo comité.');
      if (Number.isFinite(d.soloCerrarHasta) && n && (n.origen === 'Megáfono' || d.soloCerrarHasta > inst.ahora)) notas.push(`El Megáfono tiene «solo cerrar» hasta las ${cifras.hora(d.soloCerrarHasta)}: Reabrir no lo quita.`);
      poner(c, ...cabModal('Reabrir', 'Vuelve a nivel normal si la conciliación con el bróker está limpia. Es la única salida de una pausa o de un kill switch. No quita las directivas del Megáfono ni las del comité.'),
        notas.length ? el('ul', { class: 'notas-reabrir' }, notas.map(x => el('li', { text: x }))) : null, conf.campo, res, pieModal(b));
    },
    kill(c) {
      const res = zonaResultado();
      const b = el('button', { class: 'boton primario peligro', type: 'button', text: 'Activar kill switch' });
      const conf = confirmacion('KILL', b);
      b.addEventListener('click', () => ejecutar(b, res, 'kill', { confirmacion: conf.valor() }));
      poner(c, ...cabModal('Kill switch', 'Cancela todas las órdenes, cierra TODAS las posiciones a mercado y bloquea el fondo. Solo sale con Reabrir.'),
        el('p', { class: 'advertencia', text: 'Las ventas a mercado pueden salir peor que el último precio.' }), conf.campo, res, pieModal(b));
    },
    async ajustes(c) {
      const inst = est.manejadores.instantanea ? est.manejadores.instantanea() : null;
      const res = zonaResultado();
      poner(c, ...cabModal('Ajustes', 'Los límites duros se ven pero no se cambian desde aquí: viven en config.js.'), el('p', { class: 'cargando', text: 'Cargando…' }));
      let r = null;
      try { r = est.manejadores.ajustes ? await est.manejadores.ajustes() : null; } catch (_) { r = null; }
      const a = Object.assign({
        modo: inst && inst.modo, presupuestoDiaUsd: inst && inst.llm && inst.llm.presupuestoDiaUsd,
        modeloComite: inst && inst.llm && inst.llm.modeloComite, modeloAgentes: inst && inst.llm && inst.llm.modeloAgentes,
        velocidad: inst && inst.velocidad, limites: inst && inst.limites,
      }, (r && r.datos) || {});
      const cargando = c.querySelector('.cargando');
      if (cargando) cargando.remove();
      if (r && !r.ok) pintarResultado(res, r);
      const modelos = Array.from(new Set([].concat(a.modelosDisponibles || MODELOS, [a.modeloComite, a.modeloAgentes].filter(Boolean))));
      const selector = (valor, etiqueta) => el('select', { class: 'campo', 'aria-label': etiqueta }, modelos.map(m => el('option', { value: m, selected: m === valor, text: m })));
      const presupuesto = el('input', { class: 'campo', type: 'number', min: '0', max: '100', step: '0.5', value: String(a.presupuestoDiaUsd ?? ''), 'aria-label': 'Presupuesto diario de LLM en dólares' });
      const mComite = selector(a.modeloComite, 'Modelo del comité');
      const mAgentes = selector(a.modeloAgentes, 'Modelo de los agentes');
      const sintetico = (a.modo || (inst && inst.modo)) === 'sintetico';
      const velocidad = el('input', { class: 'campo', type: 'number', min: '1', max: '3600', step: '1', value: String(a.velocidad ?? 1), disabled: !sintetico, 'aria-label': 'Velocidad del reloj sintético' });
      const form = el('div', { class: 'formulario' },
        el('label', {}, el('span', { text: 'Modo' }), el('output', { text: a.modo === 'alpaca' ? 'Papel Alpaca' : a.modo === 'sintetico' ? 'Sintético' : 'Simulado' })),
        el('label', {}, el('span', { text: 'Presupuesto LLM al día ($)' }), presupuesto),
        el('label', {}, el('span', { text: 'Modelo del comité' }), mComite),
        el('label', {}, el('span', { text: 'Modelo de los agentes' }), mAgentes),
        el('label', {}, el('span', { text: sintetico ? 'Velocidad (×)' : 'Velocidad (solo sintético)' }), velocidad));
      const lim = a.limites || {};
      const tabla = el('table', { class: 'limites' }, el('caption', { text: 'Límites duros (solo lectura)' }),
        el('tbody', {}, Object.keys(lim).map(k => {
          const [nombre, tipo] = ROTULOS_LIMITES[k] || [k, 'num'];
          return el('tr', {}, el('th', { scope: 'row', text: nombre }), el('td', { text: valorLimite(lim[k], tipo) }));
        })));
      const guardar = el('button', { class: 'boton primario', type: 'button', text: 'Guardar' });
      guardar.addEventListener('click', () => {
        const cambios = {};
        const pres = Number(presupuesto.value);
        if (presupuesto.value !== '' && pres !== a.presupuestoDiaUsd) cambios.presupuestoDiaUsd = pres;
        if (mComite.value !== a.modeloComite) cambios.modeloComite = mComite.value;
        if (mAgentes.value !== a.modeloAgentes) cambios.modeloAgentes = mAgentes.value;
        if (sintetico && Number(velocidad.value) !== a.velocidad) cambios.velocidad = Number(velocidad.value);
        if (!Object.keys(cambios).length) { pintarResultado(res, { ok: true, mensaje: 'No has cambiado nada.' }); return; }
        ejecutar(guardar, res, 'ajustes', cambios).then(rr => {
          if (rr && rr.ok) Object.assign(a, cambios, (rr.datos && typeof rr.datos === 'object') ? rr.datos : {});
        });
      });
      // Modo web: quién ha entrado y «Cerrar sesión» (en el modo local no hay login).
      let sesion = null;
      if (inst && inst.web && inst.sesion && est.manejadores.cerrarSesion) {
        const resSesion = zonaResultado();
        const salir = el('button', { class: 'boton', type: 'button', text: 'Cerrar sesión' });
        salir.addEventListener('click', () => { ejecutarSesion(salir, resSesion); });
        sesion = el('section', { class: 'sesion-ajustes', 'aria-label': 'Sesión' },
          el('p', { class: 'modal-texto' }, 'Has entrado como ', el('b', { text: inst.sesion.usuario || 'usuario' }), '. En este dispositivo la sesión dura 30 días.'),
          salir, resSesion);
      }
      poner(c, form, sesion, tabla, res, pieModal(guardar));
    },
  };

  async function ejecutarSesion(boton, zona) {
    boton.disabled = true;
    zona.className = 'resultado';
    zona.textContent = 'Cerrando sesión…';
    let r;
    try { r = await est.manejadores.cerrarSesion(); } catch (_) { r = { ok: false, mensaje: 'Sin conexión con la mesa.' }; }
    boton.disabled = false;
    pintarResultado(zona, r);
  }

  return {
    iniciar, fijarDepartamentos, actualizarBarra, actualizarComite, marcarDesborde, anadirMensajes, repintarFeed, ultimoMensajeDe,
    mostrarTarjeta, ocultarTarjeta, refrescarTarjeta, conexion, refrescarFranja, datosViejos, textoConexion, tostada, abrirModal, cerrarModal,
    textoDirectiva, nombreMesa, frase, valorCriterio, capitalDe, iniciales, get tarjeta() { return est.tarjeta; }, _est: est,
    elegirPestana, actualizarEquipo, ultimosMensajesDe, reunionEnCurso, get pestana() { return est.pestana; },
    actualizarCapital, alternarExplicacion, reunionEnCursoFeed, yaVisto: id => est.vistos.has(id),
  };
});
