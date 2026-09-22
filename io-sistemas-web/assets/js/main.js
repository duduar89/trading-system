/* ==========================================================================
   IO Sistemas Audiovisuales — interacción
   Todo lo que depende del scroll se calcula a partir de la posición actual,
   así que funciona igual al bajar que al subir.
   ========================================================================== */
(function () {
  "use strict";

  var doc = document.documentElement;
  var reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  var reduceMotion = reduceMotionQuery.matches;
  if (reduceMotion) doc.classList.add("reduced-motion");

  var clamp = function (v, min, max) {
    return Math.min(max, Math.max(min, v));
  };

  /* ---------- Bucle de scroll compartido (un único rAF por frame) ---------- */
  var scrollHandlers = [];
  var resizeHandlers = [];
  var ticking = false;
  var lastY = window.scrollY;
  var scrollDir = 1; // 1 = bajando, -1 = subiendo

  function runScrollHandlers() {
    ticking = false;
    var y = window.scrollY;
    if (y !== lastY) scrollDir = y > lastY ? 1 : -1;
    var dy = y - lastY;
    lastY = y;
    for (var i = 0; i < scrollHandlers.length; i++) scrollHandlers[i](y, dy);
  }

  function requestScrollUpdate() {
    if (!ticking) {
      ticking = true;
      window.requestAnimationFrame(runScrollHandlers);
    }
  }

  window.addEventListener("scroll", requestScrollUpdate, { passive: true });

  var resizeTimer;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      for (var i = 0; i < resizeHandlers.length; i++) resizeHandlers[i]();
      requestScrollUpdate();
    }, 120);
  });

  /* ======================================================================
     Cabecera: fondo al hacer scroll, se oculta al bajar y reaparece al subir
     ====================================================================== */
  var header = document.querySelector(".site-header");
  var nav = document.getElementById("menu");
  var menuToggle = document.querySelector(".menu-toggle");
  var menuOpen = false;

  if (header) {
    var hideAcc = 0;
    scrollHandlers.push(function (y, dy) {
      header.classList.toggle("is-scrolled", y > 24);
      if (menuOpen || header.contains(document.activeElement)) {
        header.classList.remove("is-hidden");
        return;
      }
      // Pequeño umbral para que no parpadee con desplazamientos mínimos
      hideAcc = dy > 0 === hideAcc > 0 ? hideAcc + dy : dy;
      if (y < 120 || hideAcc < -12) header.classList.remove("is-hidden");
      else if (hideAcc > 24) header.classList.add("is-hidden");
    });
    header.addEventListener("focusin", function () {
      header.classList.remove("is-hidden");
    });
  }

  /* ---------- Menú móvil ---------- */
  function setMenu(open) {
    if (!nav || !menuToggle) return;
    menuOpen = open;
    nav.classList.toggle("is-open", open);
    menuToggle.setAttribute("aria-expanded", String(open));
    menuToggle.setAttribute("aria-label", open ? "Cerrar menú" : "Abrir menú");
    document.body.classList.toggle("menu-open", open);
    if (header) header.classList.toggle("menu-is-open", open);
    if (open) {
      var first = nav.querySelector("a");
      if (first) first.focus();
    }
  }

  if (menuToggle && nav) {
    menuToggle.addEventListener("click", function () {
      setMenu(!menuOpen);
    });
    nav.addEventListener("click", function (e) {
      if (e.target.closest("a")) setMenu(false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && menuOpen) {
        setMenu(false);
        menuToggle.focus();
      }
    });
    // Mantener el foco dentro del menú abierto (móvil)
    document.addEventListener("keydown", function (e) {
      if (!menuOpen || e.key !== "Tab") return;
      var focusables = [menuToggle].concat(Array.prototype.slice.call(nav.querySelectorAll("a")));
      var firstEl = focusables[0];
      var lastEl = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    });
    resizeHandlers.push(function () {
      if (window.innerWidth > 960 && menuOpen) setMenu(false);
    });
  }

  /* ======================================================================
     HERO: película controlada por el scroll (canvas + secuencia de fotogramas)
     ====================================================================== */
  var hero = document.querySelector(".hero");

  function initHero() {
    if (!hero) return;
    var canvas = hero.querySelector(".hero__canvas");
    var ctx = canvas && canvas.getContext("2d");
    var chapters = Array.prototype.slice.call(hero.querySelectorAll(".chapter"));
    var faderEl = hero.querySelector(".fader");
    var faderValue = hero.querySelector(".fader__value");
    var faderButtons = Array.prototype.slice.call(hero.querySelectorAll(".fader__labels button"));

    // Rango de scroll de cada capítulo (0–1)
    var starts = chapters.map(function (c) {
      return parseFloat(c.getAttribute("data-start")) || 0;
    });

    function progressToChapter(p) {
      var idx = 0;
      for (var i = 0; i < starts.length; i++) if (p >= starts[i] - 0.0001) idx = i;
      return idx;
    }

    var heroTop = 0;
    var scrollLen = 1;
    function measure() {
      var rect = hero.getBoundingClientRect();
      heroTop = rect.top + window.scrollY;
      scrollLen = Math.max(1, hero.offsetHeight - window.innerHeight);
    }
    measure();
    resizeHandlers.push(measure);
    window.addEventListener("load", measure);

    function currentProgress() {
      return clamp((window.scrollY - heroTop) / scrollLen, 0, 1);
    }

    function scrollToProgress(p) {
      window.scrollTo({ top: heroTop + p * scrollLen + 2, behavior: reduceMotion ? "auto" : "smooth" });
    }

    faderButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var target = parseFloat(btn.getAttribute("data-go")) || 0;
        scrollToProgress(target);
      });
    });

    var activeChapter = -1;
    function setChapter(idx) {
      if (idx === activeChapter) return;
      activeChapter = idx;
      chapters.forEach(function (c, i) {
        var active = i === idx;
        c.classList.toggle("is-active", active);
        c.classList.toggle("is-before", i < idx);
        // Los enlaces de capítulos ocultos no deben recibir foco
        Array.prototype.forEach.call(c.querySelectorAll("a, button"), function (el) {
          if (active) el.removeAttribute("tabindex");
          else el.setAttribute("tabindex", "-1");
        });
      });
      faderButtons.forEach(function (b, i) {
        b.classList.toggle("is-active", i === idx);
        if (i === idx) b.setAttribute("aria-current", "step");
        else b.removeAttribute("aria-current");
      });
    }

    // Si alguien tabula a un enlace de un capítulo, llevamos el scroll hasta él
    chapters.forEach(function (c, i) {
      c.addEventListener("focusin", function () {
        if (activeChapter !== i) scrollToProgress(starts[i] + 0.02);
      });
    });

    if (reduceMotion || !ctx) {
      // Sin película: todos los capítulos visibles y legibles en orden
      chapters.forEach(function (c) {
        c.classList.add("is-active");
      });
      return;
    }

    /* --- Secuencia de fotogramas --- */
    var portrait = window.innerWidth / window.innerHeight < 0.9;
    var set = portrait ? "m" : "d";
    var count = parseInt(hero.getAttribute(portrait ? "data-frames-mobile" : "data-frames"), 10) || 1;
    var basePath = hero.getAttribute("data-frames-path") || "assets/frames/";
    var frames = new Array(count);
    var loaded = new Uint8Array(count);
    var loadedCount = 0;

    // Correspondencia scroll → fotograma (tramos lineales, en fracción de la película)
    var stops = JSON.parse(hero.getAttribute("data-stops") || "[[0,0],[1,1]]");
    function progressToFrame(p) {
      for (var i = 1; i < stops.length; i++) {
        if (p <= stops[i][0]) {
          var a = stops[i - 1];
          var b = stops[i];
          var t = (p - a[0]) / (b[0] - a[0] || 1);
          return (a[1] + (b[1] - a[1]) * t) * (count - 1);
        }
      }
      return count - 1;
    }

    function frameSrc(i) {
      var n = String(i + 1);
      while (n.length < 3) n = "0" + n;
      return basePath + set + "/f" + n + ".webp";
    }

    // Orden de carga: primero una pasada "gruesa" (cada 8), luego se rellena
    var order = [];
    var seen = new Uint8Array(count);
    [8, 4, 2, 1].forEach(function (step) {
      for (var i = 0; i < count; i += step) {
        if (!seen[i]) {
          seen[i] = 1;
          order.push(i);
        }
      }
    });
    if (!seen[count - 1]) order.push(count - 1);

    var loaderBar = hero.querySelector(".hero__loader");
    var cursor = 0;
    var inflight = 0;
    var MAX_INFLIGHT = 6;

    function pump() {
      while (inflight < MAX_INFLIGHT && cursor < order.length) {
        (function (idx) {
          inflight++;
          var img = new Image();
          img.decoding = "async";
          img.onload = function () {
            inflight--;
            frames[idx] = img;
            loaded[idx] = 1;
            loadedCount++;
            if (loaderBar) loaderBar.style.setProperty("--loaded", (loadedCount / count).toFixed(3));
            if (loadedCount === 1 || idx === Math.round(currentFrame)) needsDraw = true;
            if (!hero.classList.contains("is-ready") && loaded[0]) {
              hero.classList.add("is-ready");
              needsDraw = true;
            }
            if (loadedCount === count) hero.classList.add("is-loaded");
            startLoop();
            pump();
          };
          img.onerror = function () {
            inflight--;
            pump();
          };
          img.src = frameSrc(idx);
        })(order[cursor++]);
      }
    }

    /* --- Dibujo en canvas (ajuste tipo "cover") --- */
    var cw = 0;
    var ch = 0;
    function sizeCanvas() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var w = canvas.clientWidth;
      var h = canvas.clientHeight;
      cw = Math.round(w * dpr);
      ch = Math.round(h * dpr);
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      needsDraw = true;
      startLoop();
    }

    function nearestLoaded(i) {
      if (loaded[i]) return i;
      for (var d = 1; d < count; d++) {
        if (i - d >= 0 && loaded[i - d]) return i - d;
        if (i + d < count && loaded[i + d]) return i + d;
      }
      return -1;
    }

    var drawnIndex = -1;
    function draw(index) {
      var i = nearestLoaded(index);
      if (i < 0) return;
      if (i === drawnIndex && !needsDraw) return;
      var img = frames[i];
      var iw = img.naturalWidth;
      var ih = img.naturalHeight;
      var scale = Math.max(cw / iw, ch / ih);
      var dw = iw * scale;
      var dh = ih * scale;
      var dx = (cw - dw) / 2;
      var dy = (ch - dh) * 0.55;
      ctx.drawImage(img, dx, dy, dw, dh);
      drawnIndex = i;
      needsDraw = false;
    }

    /* --- Bucle con inercia suave: el fotograma "persigue" al scroll --- */
    var currentFrame = progressToFrame(currentProgress());
    var targetFrame = currentFrame;
    var needsDraw = true;
    var looping = false;

    function loop() {
      var diff = targetFrame - currentFrame;
      if (Math.abs(diff) < 0.05) currentFrame = targetFrame;
      else currentFrame += diff * 0.22;
      draw(Math.round(currentFrame));
      if (currentFrame !== targetFrame || needsDraw) {
        window.requestAnimationFrame(loop);
      } else {
        looping = false;
      }
    }

    function startLoop() {
      if (!looping) {
        looping = true;
        window.requestAnimationFrame(loop);
      }
    }

    function onScroll() {
      var p = currentProgress();
      targetFrame = progressToFrame(p);
      setChapter(progressToChapter(p));
      if (faderEl) faderEl.style.setProperty("--p", p.toFixed(4));
      if (faderValue) faderValue.textContent = Math.round(p * 100) + "%";
      hero.classList.toggle("is-scrolled", p > 0.015);
      startLoop();
    }

    scrollHandlers.push(onScroll);
    resizeHandlers.push(sizeCanvas);
    sizeCanvas();
    onScroll();
    pump();
  }

  /* ======================================================================
     Declaración: las palabras se "encienden" según el scroll
     ====================================================================== */
  function initStatement() {
    var el = document.querySelector("[data-words]");
    if (!el || reduceMotion) return;
    var accent = (el.getAttribute("data-accent") || "").toLowerCase().split(",");
    var text = el.textContent.trim().replace(/\s+/g, " ");
    el.setAttribute("aria-label", text);
    el.textContent = "";
    var words = text.split(" ").map(function (w, i, arr) {
      var span = document.createElement("span");
      span.className = "w";
      span.setAttribute("aria-hidden", "true");
      span.textContent = w;
      var clean = w.toLowerCase().replace(/[^a-záéíóúñü]/g, "");
      if (accent.indexOf(clean) !== -1) span.classList.add("is-accent");
      el.appendChild(span);
      if (i < arr.length - 1) el.appendChild(document.createTextNode(" "));
      return span;
    });
    var lit = -1;
    scrollHandlers.push(function () {
      var r = el.getBoundingClientRect();
      var vh = window.innerHeight;
      if (r.bottom < -vh || r.top > vh * 2) return;
      var p = clamp((vh * 0.85 - r.top) / (r.height + vh * 0.35), 0, 1);
      var n = Math.round(p * words.length);
      if (n === lit) return;
      lit = n;
      for (var i = 0; i < words.length; i++) words[i].classList.toggle("is-lit", i < n);
    });
  }

  /* ======================================================================
     Cinta: se mueve sola y acelera / cambia de sentido con el scroll
     ====================================================================== */
  function initMarquee() {
    var track = document.querySelector(".marquee__track");
    if (!track || reduceMotion) return;
    var group = track.querySelector(".marquee__group");
    var groupW = group.offsetWidth;
    var offset = 0;
    var velocity = 0;
    var visible = false;
    var running = false;
    var lastT = 0;

    resizeHandlers.push(function () {
      groupW = group.offsetWidth;
    });

    scrollHandlers.push(function (y, dy) {
      velocity += dy * 0.35;
    });

    function frame(t) {
      var dt = lastT ? Math.min(64, t - lastT) : 16;
      lastT = t;
      var base = 0.045 * dt * scrollDir; // el sentido sigue al del scroll
      velocity *= 0.9;
      offset -= base + velocity * 0.12;
      if (groupW > 0) {
        offset = offset % groupW;
        if (offset > 0) offset -= groupW;
      }
      track.style.transform = "translate3d(" + offset.toFixed(2) + "px,0,0)";
      if (visible) window.requestAnimationFrame(frame);
      else running = false;
    }

    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
      if (visible && !running) {
        running = true;
        lastT = 0;
        window.requestAnimationFrame(frame);
      }
    }).observe(track);
  }

  /* ======================================================================
     Galería de eventos: desplazamiento horizontal anclado (escritorio)
     ====================================================================== */
  function initEvents() {
    var section = document.querySelector(".events");
    if (!section) return;
    var pin = section.querySelector(".events__pin");
    var track = section.querySelector(".events__track");
    var viewport = section.querySelector(".events__viewport");
    var desktop = window.matchMedia("(min-width: 900px)");
    var distance = 0;
    var pinTop = 0;

    function setup() {
      var enable = desktop.matches && !reduceMotion;
      section.classList.toggle("is-pinned", enable);
      if (!enable) {
        track.style.transform = "";
        pin.style.removeProperty("--pin-h");
        return;
      }
      distance = Math.max(0, track.scrollWidth - viewport.clientWidth);
      pin.style.setProperty("--pin-h", window.innerHeight + distance + "px");
      pinTop = pin.getBoundingClientRect().top + window.scrollY;
    }

    setup();
    resizeHandlers.push(setup);
    window.addEventListener("load", setup);

    scrollHandlers.push(function (y) {
      if (!section.classList.contains("is-pinned")) return;
      var p = clamp((y - pinTop) / (distance || 1), 0, 1);
      track.style.transform = "translate3d(" + (-p * distance).toFixed(1) + "px,0,0)";
      section.style.setProperty("--hp", p.toFixed(4));
    });

    // Teclado: con la galería enfocada, las flechas recorren las tarjetas
    viewport.addEventListener("keydown", function (e) {
      if (!section.classList.contains("is-pinned")) return;
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      var step = viewport.clientWidth * 0.45 * (e.key === "ArrowRight" ? 1 : -1);
      window.scrollTo({ top: window.scrollY + step, behavior: reduceMotion ? "auto" : "smooth" });
    });
  }

  /* ======================================================================
     Pasos: la línea se llena al bajar y se vacía al subir
     ====================================================================== */
  function initSteps() {
    var list = document.querySelector(".steps");
    if (!list) return;
    var rail = list.querySelector(".steps__rail");
    var steps = Array.prototype.slice.call(list.querySelectorAll(".step"));
    if (reduceMotion) {
      steps.forEach(function (s) {
        s.classList.add("is-lit");
      });
      return;
    }
    scrollHandlers.push(function () {
      var vh = window.innerHeight;
      var r = list.getBoundingClientRect();
      if (r.bottom < -vh || r.top > vh * 2) return;
      var line = vh * 0.62;
      var p = clamp((line - r.top) / r.height, 0, 1);
      rail.style.setProperty("--sp", p.toFixed(4));
      steps.forEach(function (s) {
        s.classList.toggle("is-lit", s.getBoundingClientRect().top < line);
      });
    });
  }

  /* ======================================================================
     Parallax suave en imágenes
     ====================================================================== */
  function initParallax() {
    if (reduceMotion) return;
    var items = Array.prototype.slice.call(document.querySelectorAll("[data-parallax]"));
    if (!items.length) return;
    scrollHandlers.push(function () {
      var vh = window.innerHeight;
      items.forEach(function (el) {
        var r = el.parentElement.getBoundingClientRect();
        if (r.bottom < 0 || r.top > vh) return;
        var factor = parseFloat(el.getAttribute("data-parallax")) || 0.1;
        var center = r.top + r.height / 2 - vh / 2;
        el.style.setProperty("--parallax", (-center * factor).toFixed(1) + "px");
      });
    });
  }

  /* ======================================================================
     Aparición de bloques (entran al bajar y también al volver a subir)
     ====================================================================== */
  function initReveal() {
    var els = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window) || reduceMotion) {
      Array.prototype.forEach.call(els, function (el) {
        el.classList.add("is-in");
      });
      return;
    }
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          var el = entry.target;
          if (entry.isIntersecting) {
            el.classList.toggle("from-top", entry.boundingClientRect.top < 0);
            // Forzar el estado inicial antes de animar
            void el.offsetWidth;
            el.classList.add("is-in");
          } else {
            el.classList.remove("is-in");
            el.classList.toggle("from-top", entry.boundingClientRect.top < 0);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" }
    );
    Array.prototype.forEach.call(els, function (el) {
      io.observe(el);
    });
  }

  /* ======================================================================
     Menú: marcar la sección visible
     ====================================================================== */
  function initActiveNav() {
    var links = Array.prototype.slice.call(document.querySelectorAll(".nav a[href^='#']"));
    var map = {};
    links.forEach(function (a) {
      var id = a.getAttribute("href").slice(1);
      var sec = document.getElementById(id);
      if (sec) map[id] = { link: a, sec: sec };
    });
    scrollHandlers.push(function () {
      var mid = window.innerHeight * 0.4;
      var current = null;
      Object.keys(map).forEach(function (id) {
        var r = map[id].sec.getBoundingClientRect();
        if (r.top <= mid && r.bottom > mid) current = id;
      });
      links.forEach(function (a) {
        if (current && a.getAttribute("href") === "#" + current) a.setAttribute("aria-current", "true");
        else a.removeAttribute("aria-current");
      });
    });
  }

  /* ======================================================================
     Volver arriba
     ====================================================================== */
  function initToTop() {
    var btn = document.querySelector(".to-top");
    if (!btn) return;
    scrollHandlers.push(function (y) {
      btn.classList.toggle("is-visible", y > window.innerHeight * 1.5);
    });
    btn.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
      var brand = document.querySelector(".brand");
      if (brand) brand.focus({ preventScroll: true });
    });
  }

  /* ======================================================================
     Copiar email al portapapeles
     ====================================================================== */
  function initCopy() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-copy]"), function (btn) {
      btn.addEventListener("click", function () {
        var value = btn.getAttribute("data-copy");
        var label = btn.querySelector("[data-copy-label]") || btn;
        var original = label.textContent;
        function done(ok) {
          label.textContent = ok ? "¡Copiado!" : "Copia: " + value;
          setTimeout(function () {
            label.textContent = original;
          }, 2200);
        }
        if (navigator.clipboard && window.isSecureContext) {
          navigator.clipboard.writeText(value).then(
            function () {
              done(true);
            },
            function () {
              done(fallbackCopy(value));
            }
          );
        } else {
          done(fallbackCopy(value));
        }
      });
    });
  }

  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (e) {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }

  /* ======================================================================
     Formulario de presupuesto → abre el correo con el mensaje preparado
     ====================================================================== */
  function initForm() {
    var form = document.getElementById("form-presupuesto");
    if (!form) return;
    var status = form.querySelector(".form__status");
    var to = form.getAttribute("data-mailto");

    var date = form.querySelector("input[type='date']");
    if (date) {
      var d = new Date();
      var iso = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      date.min = iso;
    }

    var messages = {
      valueMissing: "Este campo es obligatorio.",
      typeMismatch: "Revisa el formato (ejemplo: nombre@correo.com).",
      patternMismatch: "Revisa el formato del teléfono.",
      rangeUnderflow: "La fecha no puede ser anterior a hoy.",
      rangeOverflow: "Revisa el número indicado.",
      tooShort: "Añade un poco más de detalle."
    };

    function fieldError(input) {
      var v = input.validity;
      for (var key in messages) if (v[key]) return messages[key];
      return input.validationMessage || "";
    }

    function showError(input) {
      var field = input.closest(".field");
      var err = field && field.querySelector(".field__error");
      var msg = input.checkValidity() ? "" : fieldError(input);
      if (field) field.classList.toggle("has-error", !!msg);
      if (err) err.textContent = msg;
      input.setAttribute("aria-invalid", msg ? "true" : "false");
      return !msg;
    }

    Array.prototype.forEach.call(form.querySelectorAll("input, select, textarea"), function (input) {
      input.addEventListener("blur", function () {
        if (input.value) showError(input);
      });
      input.addEventListener("input", function () {
        if (input.closest(".field.has-error")) showError(input);
      });
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var inputs = Array.prototype.slice.call(form.querySelectorAll("input, select, textarea"));
      var firstInvalid = null;
      inputs.forEach(function (input) {
        if (!showError(input) && !firstInvalid) firstInvalid = input;
      });
      if (firstInvalid) {
        status.textContent = "Revisa los campos marcados, por favor.";
        status.classList.add("is-error");
        firstInvalid.focus();
        return;
      }

      var data = new FormData(form);
      var get = function (k) {
        return String(data.get(k) || "").trim();
      };
      var fecha = get("fecha");
      if (fecha) {
        var parts = fecha.split("-");
        if (parts.length === 3) fecha = parts[2] + "/" + parts[1] + "/" + parts[0];
      }

      var subject = "Solicitud de presupuesto · " + get("tipo") + (fecha ? " · " + fecha : "");
      var lines = [
        "Hola, equipo de IO Sistemas Audiovisuales:",
        "",
        get("mensaje"),
        "",
        "— Datos del evento —",
        "Tipo de evento: " + get("tipo"),
        "Fecha: " + (fecha || "Por concretar"),
        "Lugar: " + (get("lugar") || "Por concretar"),
        "Asistentes aproximados: " + (get("asistentes") || "Por concretar"),
        "",
        "— Contacto —",
        "Nombre: " + get("nombre"),
        "Email: " + get("email"),
        "Teléfono: " + (get("telefono") || "—")
      ];

      var href = "mailto:" + to + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(lines.join("\n"));
      status.classList.remove("is-error");
      status.textContent =
        "Abriendo tu aplicación de correo con el mensaje preparado… Si no se abre, escríbenos directamente a " + to + ".";
      form.setAttribute("data-last-mailto", href);
      window.location.href = href;
    });
  }

  /* ---------- Año del pie ---------- */
  Array.prototype.forEach.call(document.querySelectorAll("[data-year]"), function (el) {
    el.textContent = String(new Date().getFullYear());
  });

  /* ---------- Arranque ---------- */
  initHero();
  initStatement();
  initMarquee();
  initEvents();
  initSteps();
  initParallax();
  initReveal();
  initActiveNav();
  initToTop();
  initCopy();
  initForm();
  requestScrollUpdate();

  // Si el usuario cambia la preferencia de movimiento, recargamos para aplicarla
  if (reduceMotionQuery.addEventListener) {
    reduceMotionQuery.addEventListener("change", function () {
      window.location.reload();
    });
  }
})();
