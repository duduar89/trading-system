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

  // ── Campaña: los utm_* de la visita (sin identificadores de clic de Google ni de Meta) ──────
  var CAMPOS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
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
  var codigoCampana = String(campana.utm_campaign || '').trim().toLowerCase().slice(0, 120);

  // WhatsApp: «(ref. web-…)» pasa a «(ref. web-… · c-…)». Va una clave corta de la campaña (su huella),
  // nunca su nombre: el mensaje pasa por Meta y queda en el móvil, y una campaña puede nombrar un
  // tratamiento íntimo. La app la guarda con el lead (utm.clave_campana); de qué campaña es se sabe
  // calculando la misma huella de su nombre. El texto se codifica como el del generador (%20, no «+»),
  // que es lo que espera wa.me.
  if (codigoCampana) {
    var clave = 'c-' + huella(codigoCampana);
    Array.prototype.forEach.call(d.querySelectorAll('a[href^="https://wa.me/"]'), function (a) {
      try {
        var u = new URL(a.href);
        var t = u.searchParams.get('text') || '';
        if (t.indexOf('(ref. web-') === -1 || t.indexOf(' · ' + clave + ')') !== -1) return;
        var nuevo = t.replace(/\(ref\. (web-[^)\s]+)\)/, '(ref. $1 · ' + clave + ')');
        a.href = 'https://wa.me' + u.pathname + '?text=' + encodeURIComponent(nuevo);
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
    // Si el foco sale con Tab, se cierra (si no, el panel tapa lo que viene detrás).
    desplegable.addEventListener('focusout', function (e) {
      if (desplegable.open && e.relatedTarget && !desplegable.contains(e.relatedTarget)) desplegable.open = false;
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

  // ── «Te llamamos» de las fichas: plegado, salvo si se llega a él ────────────────────────────
  // Sin JavaScript el formulario sale desplegado; con él se pliega al cargar y se despliega (con el
  // foco en el nombre) desde cualquier enlace «Te llamamos» o si la dirección lleva #te-llamamos.
  var plegable = d.querySelector('[data-plegable]');
  if (plegable) {
    var seccionLlamamos = d.getElementById('te-llamamos');
    var abrirLlamamos = function (enfocar) {
      plegable.open = true;
      if (!enfocar) return;
      if (seccionLlamamos) seccionLlamamos.scrollIntoView();
      var nombre = plegable.querySelector('input[name="nombre"]');
      if (nombre) nombre.focus({ preventScroll: true });
    };
    if (location.hash === '#te-llamamos') abrirLlamamos(false); else plegable.open = false;
    d.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href="#te-llamamos"]');
      if (!a) return;
      e.preventDefault();
      if (window.history.replaceState) window.history.replaceState(null, '', '#te-llamamos');
      abrirLlamamos(true);
    });
  }

  // ── Formularios «Te llamamos» ───────────────────────────────────────────────────────────────
  var WHATSAPP = '722 83 32 85';
  var MENSAJES = {
    nombre: 'Escribe tu nombre.',
    telefono: 'Revisa el teléfono: 9 cifras, o con prefijo si es de fuera de España.',
    email: 'Revisa el correo electrónico (falta la @ o el dominio).',
    emailRequerido: 'Has elegido que te contestemos por correo: escribe tu correo electrónico.',
    tratamiento: 'Elige qué te interesa (o «Otra cosa»).',
    preferencia: 'Elige cómo prefieres que te contactemos.',
    mensaje: 'El mensaje es demasiado largo.',
    privacidad: 'Para contestarte necesitamos tu consentimiento en la primera casilla.'
  };
  function validar(form) {
    var errores = {};
    var v = function (n) { var el = form.elements[n]; return el ? String(el.value || '').trim() : ''; };
    if (!v('nombre')) errores.nombre = MENSAJES.nombre;
    var tel = v('telefono').replace(/[\s.\-()]/g, '');
    if (!/^(\+|00)?\d{9,15}$/.test(tel)) errores.telefono = MENSAJES.telefono;
    var pref = form.querySelector('input[name="preferencia"]:checked');
    var correo = v('email');
    if (correo && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(correo)) errores.email = MENSAJES.email;
    else if (!correo && pref && pref.value === 'correo') errores.email = MENSAJES.emailRequerido;
    if (!v('tratamiento')) errores.tratamiento = MENSAJES.tratamiento;
    if (!pref) errores.preferencia = MENSAJES.preferencia;
    var men = form.elements.mensaje;
    if (men && men.maxLength > 0 && men.value.length > men.maxLength) errores.mensaje = MENSAJES.mensaje;
    var priv = form.elements.privacidad;
    if (priv && !priv.checked) errores.privacidad = MENSAJES.privacidad;
    return errores;
  }
  // El aviso de estado, con un enlace a WhatsApp si hace falta (el de la propia página).
  function avisar(estado, clase, texto, conWhatsapp) {
    estado.className = 'form-estado' + (clase ? ' ' + clase : '');
    estado.textContent = texto;
    if (!conWhatsapp) return;
    var wa = d.querySelector('a[href^="https://wa.me/"]');
    var enlace = d.createElement(wa ? 'a' : 'span');
    if (wa) enlace.href = wa.href;
    enlace.textContent = 'escríbenos por WhatsApp al ' + WHATSAPP;
    estado.appendChild(d.createTextNode(' '));
    estado.appendChild(enlace);
    estado.appendChild(d.createTextNode('.'));
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
  // Un identificador al azar para cada formulario: si la red falla y se vuelve a enviar, la app sabe que
  // es el mismo envío y no lo duplica. Sin él (navegador muy antiguo), la app usa lo enviado y el minuto.
  function idEnvio() {
    try {
      if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
      var b = new Uint8Array(16);
      window.crypto.getRandomValues(b);
      return Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join('');
    } catch (e) { return ''; }
  }
  Array.prototype.forEach.call(d.querySelectorAll('form[data-formulario]'), function (form) {
    // Con JavaScript, los mensajes los pinta esta página; sin él, valida el navegador.
    form.noValidate = true;
    var estado = form.querySelector('.form-estado');
    var cargada = Date.now();
    if (form.elements.envio && !form.elements.envio.value) form.elements.envio.value = idEnvio();
    var enviando = false;
    var set = function (n, v) { var el = form.elements[n]; if (el && !el.value) el.value = v; };
    CAMPOS.forEach(function (c) { if (campana[c]) set(c, campana[c]); });
    form.addEventListener('submit', function (e) {
      if (enviando) { e.preventDefault(); return; }
      // t: cuánto se ha tardado en rellenarlo (ms). Vacío = sin JavaScript: la app no lo descarta.
      if (form.elements.t) form.elements.t.value = String(Date.now() - cargada);
      if (form.elements.web && form.elements.web.value) return; // trampa: que lo decida el servidor
      var errores = validar(form);
      var primero = pintarErrores(form, errores);
      if (primero) {
        e.preventDefault();
        var n = Object.keys(errores).length;
        avisar(estado, 'mal', 'Revisa los campos marcados: ' + n + (n === 1 ? ' error.' : ' errores.'));
        primero.focus();
        return;
      }
      if (!window.fetch || !window.URLSearchParams) return; // envío normal
      e.preventDefault();
      var enviar = form.querySelector('[type="submit"]');
      // Sin «disabled»: el foco se queda en el botón (con disabled caería al principio de la página).
      enviando = true;
      enviar.setAttribute('aria-disabled', 'true');
      avisar(estado, '', 'Enviando…');
      var cuerpo = new URLSearchParams(new FormData(form));
      var fallo = function (texto) {
        enviando = false;
        enviar.removeAttribute('aria-disabled');
        avisar(estado, 'mal', texto, true);
        estado.focus();
      };
      window.fetch(form.action, {
        method: 'POST', body: cuerpo, credentials: 'omit', redirect: 'manual',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }
      }).then(function (r) {
        // Una redirección (303 a /gracias/) también es «recibido»: no se sigue, para no reintentar
        // algo que ya se ha guardado.
        if (r.type === 'opaqueredirect' || (r.status >= 300 && r.status < 400)) return { ok: true, estado: r.status, datos: { ok: true } };
        return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, estado: r.status, datos: j }; });
      }).then(function (res) {
        if (res.ok && res.datos && res.datos.ok !== false) {
          var nombre = String(form.elements.nombre.value || '').trim().split(/\s+/)[0];
          var pref = form.querySelector('input[name="preferencia"]:checked');
          var medio = pref && pref.value === 'llamada' ? 'teléfono' : pref && pref.value === 'correo' ? 'correo electrónico' : 'WhatsApp';
          var gracias = d.createElement('div');
          gracias.className = 'form-estado ok';
          gracias.setAttribute('role', 'status');
          gracias.setAttribute('tabindex', '-1');
          var fuerte = d.createElement('strong');
          fuerte.textContent = 'Gracias' + (nombre ? ', ' + nombre : '') + '. Hemos recibido tu solicitud.';
          gracias.appendChild(fuerte);
          if (medio === 'WhatsApp') {
            // La app escribe antes para confirmar que el teléfono es suyo (el formulario es anónimo); si
            // prefiere no esperar, nos escribe él desde el WhatsApp de esta página.
            gracias.appendChild(d.createTextNode(' Te escribiremos por WhatsApp desde el +34 722 83 32 85 para confirmar que la solicitud es tuya: contesta «Sí, fui yo» y seguimos por ahí. Si lo prefieres, '));
            var wa = d.querySelector('a[href^="https://wa.me/"]');
            var enlace = d.createElement(wa ? 'a' : 'span');
            if (wa) enlace.href = wa.href;
            enlace.textContent = 'escríbenos tú ahora por WhatsApp';
            gracias.appendChild(enlace);
            gracias.appendChild(d.createTextNode('.'));
          } else {
            gracias.appendChild(d.createTextNode(' Te contactaremos por ' + medio + ' en horario de la clínica. Si nos escribes por WhatsApp, verás nuestro número: +34 722 83 32 85.'));
          }
          form.replaceWith(gracias);
          gracias.focus();
          return;
        }
        if (res.estado === 429) {
          fallo('Has enviado varias solicitudes seguidas. Espera unos minutos antes de volver a enviarla o');
          return;
        }
        var errs = (res.datos && res.datos.errores) || {};
        var claves = Object.keys(errs);
        if (!claves.length) {
          fallo('No hemos podido enviar tu solicitud. Vuelve a intentarlo en un momento o');
          return;
        }
        // Los errores con hueco junto a su campo; los demás, en el aviso.
        var foco = pintarErrores(form, errs);
        var sueltos = claves.filter(function (k) { return !form.querySelector('[data-error-de="' + k + '"]'); }).map(function (k) { return String(errs[k]); });
        enviando = false;
        enviar.removeAttribute('aria-disabled');
        avisar(estado, 'mal', 'Revisa los campos marcados.' + (sueltos.length ? ' ' + sueltos.join(' ') : ''));
        (foco || estado).focus();
      }).catch(function () {
        fallo('No hemos podido enviar tu solicitud. Vuelve a intentarlo en un momento o');
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
    // Llegando con ?p=…, el chip elegido se ve aunque su fila se deslice de lado (en el móvil), sin
    // mover la página.
    var activo = filtros.querySelector('[data-p][aria-pressed="true"]');
    var fila = activo && activo.closest('.chips');
    if (fila && fila.scrollWidth > fila.clientWidth) {
      fila.scrollLeft += activo.getBoundingClientRect().left - fila.getBoundingClientRect().left - 16;
    }
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
    // El brillo del filete dorado solo corre (dos pasadas) cuando su sección está a la vista: así la
    // página queda en reposo y no repinta sin parar.
    var brillo = new IntersectionObserver(function (entradas) {
      entradas.forEach(function (en) { en.target.classList.toggle('brilla', en.isIntersecting); });
    });
    Array.prototype.forEach.call(d.querySelectorAll('.filete'), function (f) { brillo.observe(f); });
  }
  raiz.classList.add('con-js');
})();
