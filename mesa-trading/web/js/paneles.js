// Paneles HTML alrededor del lienzo: barra superior, panel de departamentos con
// el feed, tarjeta de detalle, botonera con sus modales, franja de conexión y
// avisos. No sabe de dónde vienen los datos: app.js le pasa la instantánea y
// las funciones para mandar comandos.
(function (raiz, fabrica) {
  const esNode = typeof module === 'object' && module.exports;
  const mod = fabrica(esNode ? require('./cifras.js') : raiz.Parque.cifras);
  if (esNode) module.exports = mod;
  else (raiz.Parque = raiz.Parque || {}).paneles = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (cifras) {
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
    for (const h of hijos.flat()) {
      if (h === null || h === undefined || h === false) continue;
      e.appendChild(typeof h === 'string' || typeof h === 'number' ? document.createTextNode(String(h)) : h);
    }
    return e;
  }

  const ICONOS = {
    comite: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.4"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><path d="M15 14.2c2.6-.3 4.8 1.2 5.5 4.3"/>',
    megafono: '<path d="M4 10v4h3l7 4V6L7 10H4z"/><path d="M17.5 9a4 4 0 0 1 0 6"/><path d="M8 14l1.2 4.5"/>',
    prueba: '<path d="M9 3h6"/><path d="M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3"/><path d="M7.5 15h9"/>',
    pausar: '<rect x="6.5" y="5" width="3.6" height="14" rx="1"/><rect x="13.9" y="5" width="3.6" height="14" rx="1"/>',
    reabrir: '<path d="M7 5l12 7-12 7z"/>',
    kill: '<path d="M12 3v8"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/>',
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

  // Una directiva del Megáfono en castellano (lista cerrada de §6.5).
  function textoDirectiva(d) {
    const h = Number.isFinite(d.horas) ? ` durante ${cifras.numero(d.horas)} h` : '';
    switch (d.tipo) {
      case 'reducir_riesgo': return `Reducir el tamaño de las entradas al ${cifras.pct(d.factor, { decimales: 0 })}${h}.`;
      case 'pausar_activo': return `No abrir en ${etq(d.simbolo)}${h}.`;
      case 'pausar_mesa': return `Pausar la mesa ${d.mesaId}${h}.`;
      case 'solo_cerrar': return `Solo cerrar posiciones, sin abrir nada${h}.`;
      case 'reanudar_activo': return `Quitar la pausa del Megáfono en ${etq(d.simbolo)}.`;
      case 'reanudar_mesa': return `Quitar la pausa del Megáfono a la mesa ${d.mesaId}.`;
      case 'sin_efecto': return `Sin efecto: ${d.motivo || 'no hay nada que aplicar'}.`;
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
  };

  function colorDep(id) {
    const d = est.departamentos.find(x => x.id === id);
    return d ? d.color : '#8a93b0';
  }
  function nombreDep(id) {
    const d = est.departamentos.find(x => x.id === id);
    return d ? d.nombre : '';
  }

  // ---------- inicio ----------
  function iniciar(opciones) {
    est.manejadores = opciones || {};
    est.departamentos = (opciones && opciones.departamentos) || [];
    construirBotonera();
    construirChips();
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
      if (abierta) bajarDelTodo();
    });
    document.addEventListener('keydown', (e) => {
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

  function construirBotonera() {
    const acc = $('acciones');
    acc.textContent = '';
    const botones = [
      ['comite', 'Comité'], ['megafono', 'Megáfono'], ['prueba', 'Prueba'], ['pausar', 'Pausar todo'],
      ['reabrir', 'Reabrir'], ['kill', 'Kill switch'], ['ajustes', 'Ajustes'],
    ];
    for (const [id, texto] of botones) {
      acc.appendChild(el('button', { class: 'boton' + (id === 'kill' ? ' peligro' : ''), type: 'button', 'data-accion': id,
        onclick: () => abrirModal(id) }, icono(id), el('span', { text: texto })));
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
      pf.textContent = `F&G ${fg.valor} · ${fg.etiqueta}`;
      const h = Math.round(Math.max(0, Math.min(100, fg.valor)) * 1.2);
      pf.style.setProperty('--tono', `hsl(${h} 70% 55%)`);
      pf.className = 'pildora fg';
      pf.title = fg.sintetico ? 'Valor sintético (modo sin datos reales)' : 'Índice de miedo y codicia';
    } else {
      pf.textContent = 'F&G —';
      pf.className = 'pildora gris';
    }

    const nivel = inst.fondo && inst.fondo.nivel;
    const pn = $('p-nivel');
    pn.hidden = !nivel || nivel === 'normal';
    pn.textContent = nivel === 'bloqueado' ? 'BLOQUEADO' : nivel === 'pausado' ? 'PAUSADO' : 'SOLO CERRAR';
    pn.className = 'pildora ' + (nivel === 'bloqueado' ? 'roja fuerte' : 'ambar');
    pn.title = (inst.fondo && inst.fondo.motivo) || '';

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
    actualizarComite(inst, o && o.ahoraServidor);
    const avisos = $('avisos');
    const lista = Array.isArray(inst.avisos) ? inst.avisos : [];
    const clave = lista.join('|');
    if (avisos.dataset.clave !== clave) {
      avisos.dataset.clave = clave;
      avisos.textContent = '';
      for (const a of lista) avisos.appendChild(el('div', { class: 'aviso', text: a }));
    }
  }

  function actualizarComite(inst, ahoraServidor) {
    const pc = $('p-comite');
    const cab = (inst && inst.cabecera) || {};
    if (!Number.isFinite(cab.proximoComite) || !Number.isFinite(ahoraServidor)) { pc.textContent = 'Comité —'; return; }
    const resta = cab.proximoComite - ahoraServidor;
    const reunido = (inst.agentes || []).some(a => a.sala === 'comite');
    pc.textContent = reunido ? 'Comité reunido' : resta > 0 ? `Comité en ${cifras.cuentaAtras(resta)}` : 'Comité pendiente';
    pc.className = 'pildora ' + (reunido ? 'ambar' : 'gris');
    pc.title = `Modo del comité: ${cab.modoComite || '—'}`;
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

  function nodoMensaje(m) {
    const humano = !m.departamento;
    const color = humano ? '#f59e0b' : colorDep(m.departamento);
    const destacado = TIPO_DESTACADO[m.tipo];
    return el('article', { class: 'msg' + (m.canal === 'megafono' ? ' megafono' : '') + (m.tipo === 'veto' || m.tipo === 'alerta' ? ' alerta' : ''),
      'data-id': m.id },
    el('div', { class: 'avatar', style: `background:${color}`, 'aria-hidden': 'true', text: humano ? 'M' : iniciales(m.deNombre) }),
    el('div', { class: 'cuerpo' },
      el('div', { class: 'cab' },
        el('b', { text: humano ? (m.canal === 'megafono' ? 'Megáfono' : (m.deNombre || 'Sistema')) : (m.deNombre || m.de) }),
        humano ? null : el('span', { class: 'dep', text: nombreDep(m.departamento) }),
        destacado && !(humano && m.tipo === 'megafono') ? el('span', { class: 'tipo tipo-' + m.tipo, text: destacado }) : null,
        el('time', { text: cifras.hora(m.t) })),
      el('p', { text: m.texto })));
  }

  // Añade mensajes nuevos (sin repetir). Devuelve los que eran nuevos.
  function anadirMensajes(lista) {
    const nuevos = [];
    for (const m of lista || []) {
      if (!m || !m.id || est.vistos.has(m.id)) continue;
      est.vistos.add(m.id);
      est.mensajes.push(m);
      nuevos.push(m);
    }
    if (!nuevos.length) return nuevos;
    est.mensajes.sort((a, b) => a.t - b.t);
    if (est.mensajes.length > MAX_MEMORIA) {
      for (const m of est.mensajes.splice(0, est.mensajes.length - MAX_MEMORIA)) est.vistos.delete(m.id);
    }
    const feed = $('feed');
    const abajo = pegadoAbajo();
    const ultimoT = feed.lastElementChild ? Number(feed.lastElementChild.dataset.t) : -Infinity;
    const enOrden = nuevos.every(m => m.t >= ultimoT);
    if (!enOrden || nuevos.length > 60) {
      repintarFeed(abajo);
    } else {
      for (const m of nuevos) {
        if (!pasaFiltro(m)) continue;
        const n = nodoMensaje(m);
        n.dataset.t = m.t;
        feed.appendChild(n);
        if (!abajo) est.nuevosSinVer++;
      }
      while (feed.childElementCount > MAX_DOM) feed.removeChild(feed.firstElementChild);
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

  function repintarFeed(bajar) {
    const feed = $('feed');
    feed.textContent = '';
    const lista = est.mensajes.filter(pasaFiltro).slice(-MAX_DOM);
    const frag = document.createDocumentFragment();
    for (const m of lista) { const n = nodoMensaje(m); n.dataset.t = m.t; frag.appendChild(n); }
    feed.appendChild(frag);
    if (!lista.length) feed.appendChild(el('p', { class: 'vacio', text: 'Sin mensajes de este departamento todavía.' }));
    if (bajar !== false) bajarDelTodo();
  }

  function ultimoMensajeDe(agenteId) {
    for (let k = est.mensajes.length - 1; k >= 0; k--) if (est.mensajes[k].de === agenteId) return est.mensajes[k];
    return null;
  }

  // ---------- tarjeta de detalle ----------
  function fila(nombre, valor, clase) {
    return [el('dt', { text: nombre }), el('dd', { class: clase || null, text: valor })];
  }

  function mostrarTarjeta(sel, inst) {
    est.tarjeta = sel;
    const t = $('tarjeta');
    const primera = t.hidden;
    t.hidden = false;
    rellenarTarjeta(sel, inst);
    if (primera) {
      est.ultimoFoco = document.activeElement;
      const cerrar = t.querySelector('.cerrar');
      if (cerrar && window.matchMedia && window.matchMedia('(max-width: 767px)').matches) cerrar.focus();
    }
  }

  function rellenarTarjeta(sel, inst) {
    const t = $('tarjeta');
    t.textContent = '';
    if (!sel || !inst) return;
    const cerrar = el('button', { class: 'cerrar boton-icono', type: 'button', 'aria-label': 'Cerrar ficha',
      onclick: () => { ocultarTarjeta(); if (est.manejadores.alCerrarTarjeta) est.manejadores.alCerrarTarjeta(); } }, icono('cerrar'));
    if (sel.tipo === 'puesto') {
      const p = (inst.puestos || []).find(x => x.id === sel.id);
      if (!p) { t.appendChild(el('p', { class: 'vacio', text: 'Este puesto ya no existe.' })); t.appendChild(cerrar); return; }
      const mesa = (inst.mesas || []).find(m => m.id === p.mesaId) || {};
      const ag = (inst.agentes || []).find(a => a.id === p.agenteId);
      const cot = (inst.cotizaciones || []).find(c => c.simbolo === p.simbolo);
      const pos = p.posicion;
      const precio = cot ? cot.precio : null;
      const situacion = mesa.estado === 'banquillo' ? 'banquillo' : pos ? 'comprado' : 'sin posición';
      const distStop = pos && precio && pos.stop ? (precio - pos.stop) / precio : null;
      const ultimo = ultimoMensajeDe(p.agenteId);
      t.appendChild(el('header', { class: 'tarjeta-cab' },
        el('div', { class: 'tarjeta-titulo', id: 'tarjeta-titulo' },
          el('span', { class: 'etq', text: p.etiqueta }), ` · ${mesa.nombre || p.mesaId}`),
        el('div', { class: 'tarjeta-sub', text: `${p.simbolo} · ${mesa.familia || ''} ${NOMBRE_MARCO[mesa.marco] || mesa.marco || ''} · ${mesa.estado || ''}` }),
        cerrar));
      if (ag) {
        t.appendChild(el('div', { class: 'tarjeta-persona' },
          el('span', { class: 'avatar', style: `background:${colorDep(ag.departamento)}`, text: iniciales(ag.nombre) }),
          el('div', {}, el('b', { text: ag.nombre }), el('span', { text: `${ag.rol} · ${ESTADO_AGENTE[ag.estado] || ag.estado}` }))));
      }
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
        fila('Precio', precio !== null ? cifras.precio(precio) : '—'),
        fila('Última señal', p.ultimaSenal ? `${p.ultimaSenal.accion} · ${cifras.hora(p.ultimaSenal.t)}` : '—'));
      t.appendChild(dl);
      if (Array.isArray(p.chispa) && p.chispa.length > 1) t.appendChild(chispaSvg(p.chispa, pos ? (pos.pnlAbierto >= 0 ? '#22c55e' : '#ef4444') : '#8a93b0'));
      if (p.estadoTexto) t.appendChild(el('p', { class: 'estado-texto', text: p.estadoTexto }));
      t.appendChild(bloqueUltimo(ultimo));
    } else {
      const ag = (inst.agentes || []).find(a => a.id === sel.id);
      if (!ag) { t.appendChild(el('p', { class: 'vacio', text: 'Este agente ya no está en la plantilla.' })); t.appendChild(cerrar); return; }
      const llm = inst.llm || {};
      const modelo = ag.id === 'cio' ? llm.modeloComite : llm.modeloAgentes;
      t.appendChild(el('header', { class: 'tarjeta-cab' },
        el('div', { class: 'tarjeta-titulo', id: 'tarjeta-titulo', text: ag.nombre }),
        el('div', { class: 'tarjeta-sub', text: `${ag.rol} · ${nombreDep(ag.departamento)}` }),
        cerrar));
      t.appendChild(el('div', { class: 'tarjeta-persona' },
        el('span', { class: 'avatar', style: `background:${colorDep(ag.departamento)}`, text: iniciales(ag.nombre) }),
        el('div', {}, el('b', { text: ESTADO_AGENTE[ag.estado] || ag.estado || '—' }), el('span', { text: NOMBRE_SALA[ag.sala] || ag.sala || '—' }))));
      t.appendChild(el('dl', { class: 'tabla' },
        fila('Rol', ag.rol || '—'),
        fila('Usa LLM', ag.usaLLM ? (llm.activo ? `Sí · ${modelo || '—'}` : 'Sí, pero el LLM está apagado: plantillas') : 'No: reglas y plantillas'),
        ag.etiqueta ? fila('Activo', ag.etiqueta) : null,
        fila('Estado', ESTADO_AGENTE[ag.estado] || ag.estado || '—'),
        fila('Sala', NOMBRE_SALA[ag.sala] || ag.sala || '—')));
      t.appendChild(el('div', { class: 'que-decide' }, el('h3', { text: 'Qué decide' }), el('p', { text: ag.queDecide || '—' })));
      t.appendChild(bloqueUltimo(ultimoMensajeDe(ag.id)));
    }
  }

  function bloqueUltimo(m) {
    return el('div', { class: 'ultimo' }, el('h3', { text: 'Último mensaje' }),
      m ? el('p', {}, el('time', { text: cifras.hora(m.t) + ' · ' }), m.texto) : el('p', { class: 'vacio', text: 'Todavía no ha dicho nada.' }));
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
    $('tarjeta').hidden = true;
    if (est.ultimoFoco && est.ultimoFoco.focus && document.contains(est.ultimoFoco)) {
      try { est.ultimoFoco.focus({ preventScroll: true }); } catch (_) { /* nada */ }
    }
  }

  function refrescarTarjeta(inst) {
    if (est.tarjeta && !$('tarjeta').hidden) {
      const t = $('tarjeta');
      const scroll = t.scrollTop;
      rellenarTarjeta(est.tarjeta, inst);
      t.scrollTop = scroll;
    }
  }

  // ---------- conexión, avisos, tostadas ----------
  function conexion(ok, espera) {
    const f = $('franja');
    f.hidden = !!ok;
    if (!ok) f.textContent = `Sin conexión con la mesa, reintentando${espera ? ` en ${cifras.numero(Math.round(espera / 1000))} s` : ''}…`;
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
    d.className = 'modal' + (tipo === 'kill' ? ' peligro' : '');
    const fn = MODALES[tipo];
    if (!fn) return;
    fn(cuerpo);
    if (!d.open) d.showModal();
    const primero = cuerpo.querySelector('textarea, input:not([disabled]), select, button.primario');
    if (primero) primero.focus();
  }

  function cerrarModal() { const d = $('modal'); if (d.open) d.close(); }

  function cabModal(titulo, texto) {
    return [
      el('header', { class: 'modal-cab' }, el('h2', { id: 'modal-titulo', text: titulo }),
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

  const MODALES = {
    comite(c) {
      const res = zonaResultado();
      const b = el('button', { class: 'boton primario', type: 'button', text: 'Convocar ahora' });
      b.addEventListener('click', () => ejecutar(b, res, 'comite', {}));
      c.append(...cabModal('Convocar el comité', 'Reúne ahora a Dirección, Macro, Riesgos, el Controller y el Laboratorio. La Presidenta decide el modo del fondo; el voto DEFENSIVO de Riesgos es veto.'), res, pieModal(b));
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
        propuesta.append(el('h3', { text: 'Propuesta' }), el('p', { class: 'explicacion', text: p.explicacion || '' }),
          el('ul', {}, (p.directivas || []).map(d => el('li', { class: d.tipo === 'sin_efecto' ? 'sin-efecto' : '', text: textoDirectiva(d) }))));
        const util = (p.directivas || []).some(d => d.tipo !== 'sin_efecto');
        aplicar.hidden = false;
        aplicar.disabled = !util;
        // Con una propuesta delante, lo principal es Aplicar; reinterpretar pasa a segundo plano.
        interpretar.classList.toggle('primario', !util);
        if (!util) propuesta.append(el('p', { class: 'nota', text: 'No hay nada que aplicar. Reescribe la orden con otras palabras.' }));
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
      c.append(...cabModal('Megáfono', 'Dile a la mesa qué quieres con tus palabras. Se traduce a directivas de una lista cerrada que solo aprietan y caducan solas; no entra nada hasta que pulses Aplicar.'),
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
      c.append(...cabModal('Prueba', 'Comprueba que responden el bróker, los datos de mercado, el índice de miedo y codicia y el LLM. No toca la cartera.'),
        el('div', { class: 'bloque' }, el('h3', { text: 'Orden mínima (opcional)' }),
          el('p', { class: 'modal-texto', text: 'Compra y vende 15 $ de BTC en la cuenta de papel para ver el circuito completo de una orden.' }), conf.campo, orden),
        res, pieModal(comprobar));
    },
    pausar(c) {
      const res = zonaResultado();
      const b = el('button', { class: 'boton primario ambar', type: 'button', text: 'Pausar todo' });
      b.addEventListener('click', () => ejecutar(b, res, 'pausar', {}));
      c.append(...cabModal('Pausar todo', 'Pasa el fondo a «solo cerrar» hasta que alguien pulse Reabrir: no se abre nada nuevo; las salidas y los stops siguen funcionando.'), res, pieModal(b));
    },
    reabrir(c) {
      const res = zonaResultado();
      const b = el('button', { class: 'boton primario', type: 'button', text: 'Reabrir' });
      const conf = confirmacion('REABRIR', b);
      b.addEventListener('click', () => ejecutar(b, res, 'reabrir', { confirmacion: conf.valor() }));
      c.append(...cabModal('Reabrir', 'Vuelve a nivel normal si la conciliación con el bróker está limpia. Es la única salida de una pausa o de un kill switch.'), conf.campo, res, pieModal(b));
    },
    kill(c) {
      const res = zonaResultado();
      const b = el('button', { class: 'boton primario peligro', type: 'button', text: 'Activar kill switch' });
      const conf = confirmacion('KILL', b);
      b.addEventListener('click', () => ejecutar(b, res, 'kill', { confirmacion: conf.valor() }));
      c.append(...cabModal('Kill switch', 'Cancela todas las órdenes, cierra TODAS las posiciones a mercado y bloquea el fondo. Solo sale con Reabrir.'),
        el('p', { class: 'advertencia', text: 'Las ventas a mercado pueden salir peor que el último precio.' }), conf.campo, res, pieModal(b));
    },
    async ajustes(c) {
      const inst = est.manejadores.instantanea ? est.manejadores.instantanea() : null;
      const res = zonaResultado();
      c.append(...cabModal('Ajustes', 'Los límites duros se ven pero no se cambian desde aquí: viven en config.js.'), el('p', { class: 'cargando', text: 'Cargando…' }));
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
      c.append(form, tabla, res, pieModal(guardar));
    },
  };

  return {
    iniciar, fijarDepartamentos, actualizarBarra, actualizarComite, anadirMensajes, repintarFeed, ultimoMensajeDe,
    mostrarTarjeta, ocultarTarjeta, refrescarTarjeta, conexion, tostada, abrirModal, cerrarModal,
    textoDirectiva, iniciales, get tarjeta() { return est.tarjeta; }, _est: est,
  };
});
