/* IEMEC · web pública. Sin dependencias. Todo es mejora progresiva: sin JavaScript la web se lee y
   se usa entera (el menú lleva al del pie, el formulario se envía y la API contesta 303 a /gracias/). */
(function () {
  'use strict';
  var d = document;
  var raiz = d.documentElement;

  // ── Almacenamiento de sesión (puede fallar: modo privado, cookies bloqueadas…) ──────────────
  function leer(clave) { try { return window.sessionStorage.getItem(clave); } catch (e) { return null; } }
  function guardar(clave, valor) { try { window.sessionStorage.setItem(clave, valor); } catch (e) { /* sin almacenamiento */ } }

  // Huella FNV-1a de 32 bits en base 36: la misma que web/lib/modelo.js.
  function huella(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(36);
  }

  // ── Anclas de la web anterior (/facial#relleno-de-labios…): van a su página nueva ────────────
  (function () {
    var bloque = d.getElementById('anclas-antiguas');
    if (!bloque || !location.hash) return;
    var frag;
    try { frag = decodeURIComponent(location.hash.slice(1)); } catch (e) { frag = location.hash.slice(1); }
    try {
      var mapa = JSON.parse(bloque.textContent);
      var destino = mapa[huella(frag)];
      if (destino && destino.charAt(0) === '/') location.replace(destino);
    } catch (e) { /* mapa roto: se queda en la página */ }
  })();

  // ── Campaña: utm_* y los identificadores de clic de la visita ───────────────────────────────
  var CAMPOS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'];
  var campana = {};
  (function () {
    var guardada = leer('iemec-campana');
    if (guardada) { try { campana = JSON.parse(guardada) || {}; } catch (e) { campana = {}; } }
    var q = new URLSearchParams(location.search);
    var nueva = false;
    CAMPOS.forEach(function (c) {
      var v = q.get(c);
      if (v) { campana[c] = v.slice(0, 120); nueva = true; }
    });
    if (nueva) guardar('iemec-campana', JSON.stringify(campana));
  })();
  var codigoCampana = (campana.utm_campaign || '').replace(/[^\w.\-áéíóúñü ]/gi, '').trim().slice(0, 40);

  // WhatsApp: «(ref. web-…)» pasa a «(ref. web-… · campaña)».
  if (codigoCampana) {
    Array.prototype.forEach.call(d.querySelectorAll('a[href^="https://wa.me/"]'), function (a) {
      try {
        var u = new URL(a.href);
        var t = u.searchParams.get('text') || '';
        if (t.indexOf('(ref. web-') === -1 || t.indexOf(' · ' + codigoCampana + ')') !== -1) return;
        u.searchParams.set('text', t.replace(/\(ref\. (web-[^)\s]+)\)/, '(ref. $1 · ' + codigoCampana + ')'));
        a.href = u.toString();
      } catch (e) { /* URL rara: se deja */ }
    });
  }

  // ── Cabecera que se compacta al bajar ───────────────────────────────────────────────────────
  var cabecera = d.querySelector('.cabecera');
  if (cabecera) {
    var pendiente = false;
    var compactar = function () {
      pendiente = false;
      cabecera.classList.toggle('compacta', window.scrollY > 24);
    };
    window.addEventListener('scroll', function () {
      if (!pendiente) { pendiente = true; window.requestAnimationFrame(compactar); }
    }, { passive: true });
    compactar();
  }

  // ── Desplegable de tratamientos (escritorio): se cierra al salir o con Escape ────────────────
  var desplegable = d.querySelector('.desplegable');
  if (desplegable) {
    d.addEventListener('click', function (e) {
      if (desplegable.open && !desplegable.contains(e.target)) desplegable.open = false;
    });
    desplegable.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && desplegable.open) {
        desplegable.open = false;
        desplegable.querySelector('summary').focus();
      }
    });
  }

  // ── Menú a pantalla completa (móvil): aria-expanded, foco atrapado y Escape ────────────────
  var boton = d.getElementById('boton-menu');
  var menu = d.getElementById('menu-movil');
  if (boton && menu) {
    boton.setAttribute('role', 'button');
    boton.setAttribute('aria-expanded', 'false');
    boton.setAttribute('aria-controls', 'menu-movil');
    var cerrar = menu.querySelector('.cerrar-menu');
    var enfocables = function () {
      return Array.prototype.filter.call(menu.querySelectorAll('a[href], button:not([disabled])'), function (el) { return el.offsetParent !== null; });
    };
    var abrir = function () {
      menu.hidden = false;
      boton.setAttribute('aria-expanded', 'true');
      d.body.classList.add('menu-abierto');
      Array.prototype.forEach.call(d.querySelectorAll('body > header, body > main, body > footer, body > nav.barra-movil'), function (el) { el.setAttribute('inert', ''); });
      (cerrar || enfocables()[0]).focus();
    };
    var cerrarMenu = function (devolverFoco) {
      if (menu.hidden) return;
      menu.hidden = true;
      boton.setAttribute('aria-expanded', 'false');
      d.body.classList.remove('menu-abierto');
      Array.prototype.forEach.call(d.querySelectorAll('[inert]'), function (el) { el.removeAttribute('inert'); });
      if (devolverFoco !== false) boton.focus();
    };
    boton.addEventListener('click', function (e) {
      e.preventDefault();
      if (menu.hidden) abrir(); else cerrarMenu();
    });
    boton.addEventListener('keydown', function (e) {
      if (e.key === ' ') { e.preventDefault(); abrir(); }
    });
    if (cerrar) cerrar.addEventListener('click', function () { cerrarMenu(); });
    menu.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('a[href]')) cerrarMenu(false);
    });
    d.addEventListener('keydown', function (e) {
      if (menu.hidden) return;
      if (e.key === 'Escape') { e.preventDefault(); cerrarMenu(); return; }
      if (e.key !== 'Tab') return;
      var lista = enfocables();
      if (!lista.length) return;
      var primero = lista[0];
      var ultimo = lista[lista.length - 1];
      if (e.shiftKey && d.activeElement === primero) { e.preventDefault(); ultimo.focus(); } else if (!e.shiftKey && d.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
    });
    window.addEventListener('resize', function () { if (window.innerWidth >= 1024) cerrarMenu(false); });
  }

  // ── Formularios «Te llamamos» ───────────────────────────────────────────────────────────────
  var MENSAJES = {
    nombre: 'Escribe tu nombre.',
    telefono: 'Revisa el teléfono: 9 cifras, o con prefijo si es de fuera de España.',
    email: 'Revisa el correo electrónico (falta la @ o el dominio).',
    tratamiento: 'Elige qué te interesa (o «Otra cosa»).',
    preferencia: 'Elige cómo prefieres que te contactemos.',
    privacidad: 'Para contestarte necesitamos tu consentimiento en la primera casilla.'
  };
  function validar(form) {
    var errores = {};
    var v = function (n) { var el = form.elements[n]; return el ? String(el.value || '').trim() : ''; };
    if (!v('nombre')) errores.nombre = MENSAJES.nombre;
    var tel = v('telefono').replace(/[\s.\-()]/g, '');
    if (!/^(\+|00)?\d{9,15}$/.test(tel)) errores.telefono = MENSAJES.telefono;
    var correo = v('email');
    if (correo && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(correo)) errores.email = MENSAJES.email;
    if (!v('tratamiento')) errores.tratamiento = MENSAJES.tratamiento;
    var pref = form.querySelector('input[name="preferencia"]:checked');
    if (!pref) errores.preferencia = MENSAJES.preferencia;
    var priv = form.elements.privacidad;
    if (priv && !priv.checked) errores.privacidad = MENSAJES.privacidad;
    return errores;
  }
  function pintarErrores(form, errores) {
    var primero = null;
    Array.prototype.forEach.call(form.querySelectorAll('[data-error-de]'), function (p) {
      var campo = p.getAttribute('data-error-de');
      var el = form.querySelector('[name="' + campo + '"]');
      var msg = errores[campo];
      p.textContent = msg || '';
      p.hidden = !msg;
      if (el && el.type !== 'radio') {
        if (msg) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid');
      }
      if (msg && !primero) primero = el;
    });
    return primero;
  }
  Array.prototype.forEach.call(d.querySelectorAll('form[data-formulario]'), function (form) {
    var estado = form.querySelector('.form-estado');
    var set = function (n, v) { var el = form.elements[n]; if (el && !el.value) el.value = v; };
    set('t', String(Date.now()));
    CAMPOS.forEach(function (c) { if (campana[c]) set(c, campana[c]); });
    form.addEventListener('submit', function (e) {
      if (form.elements.web && form.elements.web.value) return; // trampa: que lo decida el servidor
      var errores = validar(form);
      var primero = pintarErrores(form, errores);
      if (primero) {
        e.preventDefault();
        estado.className = 'form-estado mal';
        estado.textContent = 'Revisa los campos marcados: ' + Object.keys(errores).length + (Object.keys(errores).length === 1 ? ' error.' : ' errores.');
        primero.focus();
        return;
      }
      if (!window.fetch || !window.URLSearchParams) return; // envío normal
      e.preventDefault();
      var enviar = form.querySelector('[type="submit"]');
      enviar.disabled = true;
      estado.className = 'form-estado';
      estado.textContent = 'Enviando…';
      var cuerpo = new URLSearchParams(new FormData(form));
      window.fetch(form.action, {
        method: 'POST', body: cuerpo, credentials: 'omit',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, datos: j }; });
      }).then(function (res) {
        if (res.ok && res.datos && res.datos.ok !== false) {
          var nombre = String(form.elements.nombre.value || '').trim().split(/\s+/)[0];
          var pref = form.querySelector('input[name="preferencia"]:checked');
          var medio = pref && pref.value === 'llamada' ? 'teléfono' : 'WhatsApp';
          var gracias = d.createElement('div');
          gracias.className = 'form-estado ok';
          gracias.setAttribute('role', 'status');
          gracias.setAttribute('tabindex', '-1');
          var fuerte = d.createElement('strong');
          fuerte.textContent = 'Gracias' + (nombre ? ', ' + nombre : '') + '. Hemos recibido tu solicitud.';
          gracias.appendChild(fuerte);
          gracias.appendChild(d.createTextNode(' Te contactaremos por ' + medio + ' en horario de la clínica. Si nos escribes por WhatsApp, verás nuestro número: +34 722 83 32 85.'));
          form.replaceWith(gracias);
          gracias.focus();
          return;
        }
        var errs = (res.datos && res.datos.errores) || {};
        var foco = pintarErrores(form, errs);
        estado.className = 'form-estado mal';
        estado.textContent = Object.keys(errs).length ? 'Revisa los campos marcados.' : 'No hemos podido enviar tu solicitud. Vuelve a intentarlo o escríbenos por WhatsApp al 722 83 32 85.';
        enviar.disabled = false;
        if (foco) foco.focus();
      }).catch(function () {
        estado.className = 'form-estado mal';
        estado.textContent = 'No hemos podido enviar tu solicitud. Vuelve a intentarlo o escríbenos por WhatsApp al 722 83 32 85.';
        enviar.disabled = false;
      });
    });
  });

  // ── Filtros de /tratamientos/: buscador, especialidad y preocupación (respeta ?q=, ?e= y ?p=) ─
  var filtros = d.querySelector('[data-filtros]');
  if (filtros) {
    var buscar = d.getElementById('buscar');
    var selEsp = d.getElementById('filtro-especialidad');
    var chips = filtros.querySelectorAll('[data-p]');
    var grupos = d.querySelectorAll('[data-grupo]');
    var items = d.querySelectorAll('[data-item]');
    var recuento = d.getElementById('recuento');
    var vacio = d.getElementById('sin-resultados');
    var normal = function (s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); };
    var textos = Array.prototype.map.call(items, function (li) { return normal(li.textContent); });
    var params = new URLSearchParams(location.search);
    var p = params.get('p') || '';
    buscar.value = params.get('q') || '';
    if (selEsp) selEsp.value = params.get('e') || '';
    var aplicar = function (actualizarUrl) {
      var palabras = normal(buscar.value).split(/\s+/).filter(Boolean);
      var esp = selEsp ? selEsp.value : '';
      var total = 0;
      Array.prototype.forEach.call(items, function (li, i) {
        var ok = (!esp || li.getAttribute('data-e') === esp)
          && (!p || (' ' + li.getAttribute('data-p') + ' ').indexOf(' ' + p + ' ') !== -1)
          && palabras.every(function (w) { return textos[i].indexOf(w) !== -1; });
        li.hidden = !ok;
        if (ok) total++;
      });
      Array.prototype.forEach.call(grupos, function (g) { g.hidden = !g.querySelector('[data-item]:not([hidden])'); });
      Array.prototype.forEach.call(chips, function (c) { c.setAttribute('aria-pressed', c.getAttribute('data-p') === p ? 'true' : 'false'); });
      recuento.textContent = total === 1 ? '1 tratamiento' : total + ' tratamientos';
      vacio.hidden = total !== 0;
      if (actualizarUrl && window.history.replaceState) {
        var q = new URLSearchParams();
        if (buscar.value.trim()) q.set('q', buscar.value.trim());
        if (esp) q.set('e', esp);
        if (p) q.set('p', p);
        var s = q.toString();
        window.history.replaceState(null, '', location.pathname + (s ? '?' + s : ''));
      }
    };
    buscar.addEventListener('input', function () { aplicar(true); });
    if (selEsp) selEsp.addEventListener('change', function () { aplicar(true); });
    Array.prototype.forEach.call(chips, function (c) {
      c.addEventListener('click', function () { p = p === c.getAttribute('data-p') ? '' : c.getAttribute('data-p'); aplicar(true); });
    });
    filtros.hidden = false;
    aplicar(false);
  }

  // ── Aparición suave de las secciones que aún no se ven ──────────────────────────────────────
  var calma = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!calma && 'IntersectionObserver' in window) {
    var obs = new IntersectionObserver(function (entradas) {
      entradas.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.remove('espera'); obs.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px' });
    Array.prototype.forEach.call(d.querySelectorAll('[data-aparece]'), function (el) {
      if (el.getBoundingClientRect().top > window.innerHeight) {
        el.classList.add('aparece', 'espera');
        obs.observe(el);
      }
    });
  }
  raiz.classList.add('con-js');
})();
