/* ==========================================================================
   IO Sistemas Audiovisuales — interacción
   Todo lo que depende del scroll se calcula a partir de la posición actual,
   así que funciona igual al bajar que al subir.
   ========================================================================== */
(function () {
  "use strict";

  var doc = document.documentElement;
  // Si este archivo llega tarde y la página ya había pasado al modo sin JS, volvemos
  doc.classList.remove("no-js");
  doc.classList.add("js");

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

  function runResizeHandlers() {
    for (var i = 0; i < resizeHandlers.length; i++) resizeHandlers[i]();
    requestScrollUpdate();
  }

  var resizeTimer;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(runResizeHandlers, 120);
  });
  // Las medidas cambian cuando terminan de cargar las tipografías y la página
  window.addEventListener("load", runResizeHandlers);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(runResizeHandlers);

  function isKeyboardFocus(el) {
    try {
      return el.matches(":focus-visible");
    } catch (e) {
      return true;
    }
  }

  /* ======================================================================
     Cabecera: fondo al hacer scroll, se oculta al bajar y reaparece al subir
     ====================================================================== */
  var header = document.querySelector(".site-header");
  var nav = document.getElementById("menu");
  var menuToggle = document.querySelector(".menu-toggle");
  var menuOpen = false;

  function initHeader() {
    if (!header) return;
    var hideAcc = 0;
    scrollHandlers.push(function (y, dy) {
      header.classList.toggle("is-scrolled", y > 24);
      var ae = document.activeElement;
      if (menuOpen || (ae && header.contains(ae) && isKeyboardFocus(ae))) {
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
  var inertTargets = ["main", "footer", ".to-top", ".skip-link", ".brand"];

  function setMenu(open) {
    if (!nav || !menuToggle) return;
    menuOpen = open;
    nav.classList.toggle("is-open", open);
    menuToggle.setAttribute("aria-expanded", String(open));
    menuToggle.setAttribute("aria-label", open ? "Cerrar menú" : "Abrir menú");
    document.body.classList.toggle("menu-open", open);
    if (header) header.classList.toggle("menu-is-open", open);
    // Con el menú abierto, el resto de la página queda fuera de alcance
    inertTargets.forEach(function (sel) {
      var n = document.querySelector(sel);
      if (!n) return;
      if (open) n.setAttribute("inert", "");
      else n.removeAttribute("inert");
    });
    if (open) {
      var first = nav.querySelector("a");
      if (first) first.focus();
    }
  }

  function initMenu() {
    if (!menuToggle || !nav) return;
    menuToggle.addEventListener("click", function () {
      setMenu(!menuOpen);
    });
    nav.addEventListener("click", function (e) {
      if (e.target.closest("a")) setMenu(false);
    });
    document.addEventListener("keydown", function (e) {
      if (!menuOpen) return;
      if (e.key === "Escape") {
        setMenu(false);
        menuToggle.focus();
        return;
      }
      if (e.key !== "Tab") return;
      // Trampa de foco en el orden visual: enlaces del menú y botón de cerrar
      var f = Array.prototype.slice.call(nav.querySelectorAll("a")).concat(menuToggle);
      var i = f.indexOf(document.activeElement);
      if (i === -1) {
        e.preventDefault();
        f[0].focus();
      } else if (e.shiftKey && i === 0) {
        e.preventDefault();
        f[f.length - 1].focus();
      } else if (!e.shiftKey && i === f.length - 1) {
        e.preventDefault();
        f[0].focus();
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
    var loaderBar = hero.querySelector(".hero__loader");

    // Pantallas muy bajas (móvil en horizontal con zoom, zoom del 200 %…): texto apilado
    var STATIC_MAX_HEIGHT = 340;
    var staticMode = false;

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

    function currentProgress() {
      return clamp((window.scrollY - heroTop) / scrollLen, 0, 1);
    }

    function scrollToProgress(p) {
      window.scrollTo({ top: heroTop + p * scrollLen + 2, behavior: reduceMotion ? "auto" : "smooth" });
    }

    faderButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        scrollToProgress(parseFloat(btn.getAttribute("data-go")) || 0);
      });
    });

    var activeChapter = -1;
    function setChapter(idx, force) {
      if (idx === activeChapter && !force) return;
      activeChapter = idx;
      chapters.forEach(function (c, i) {
        var active = i === idx;
        c.classList.toggle("is-active", active);
        c.classList.toggle("is-before", i < idx);
        // Los enlaces de capítulos ocultos no deben recibir foco (salvo en modo apilado)
        Array.prototype.forEach.call(c.querySelectorAll("a, button"), function (el) {
          if (active || staticMode) el.removeAttribute("tabindex");
          else el.setAttribute("tabindex", "-1");
        });
      });
      faderButtons.forEach(function (b, i) {
        b.classList.toggle("is-active", i === idx);
        if (i === idx) b.setAttribute("aria-current", "step");
        else b.removeAttribute("aria-current");
      });
    }

    if (reduceMotion || !ctx) {
      // Sin película: todos los capítulos visibles y legibles en orden
      chapters.forEach(function (c) {
        c.classList.add("is-active");
      });
      return;
    }

    // Si alguien tabula a un enlace de un capítulo, llevamos el scroll hasta él
    chapters.forEach(function (c, i) {
      c.addEventListener("focusin", function () {
        if (!staticMode && activeChapter !== i) scrollToProgress(starts[i] + 0.02);
      });
    });

    function applyStaticMode() {
      var s = window.innerHeight < STATIC_MAX_HEIGHT;
      if (s === staticMode) return;
      staticMode = s;
      doc.classList.toggle("hero-static", s);
      measure();
      setChapter(progressToChapter(currentProgress()), true);
    }

    /* --- Correspondencia scroll → fotograma (tramos lineales, en fracción de la película) --- */
    var stops;
    try {
      stops = JSON.parse(hero.getAttribute("data-stops") || "");
    } catch (e) {
      stops = [[0, 0], [1, 1]];
    }

    /* --- Secuencia de fotogramas ---
       Se descargan como archivos comprimidos y se decodifican fuera del hilo
       principal (createImageBitmap). Solo se mantienen decodificados los
       fotogramas cercanos a la posición actual, para no disparar la memoria. */
    var basePath = hero.getAttribute("data-frames-path") || "assets/frames/";
    var useBitmaps =
      typeof window.fetch === "function" && typeof window.createImageBitmap === "function" && location.protocol !== "file:";
    var saveData = !!(navigator.connection && navigator.connection.saveData);
    var MAX_INFLIGHT = 6;
    var WINDOW = 12; // fotogramas decodificados a cada lado del actual
    var MAX_DECODING = 4;
    var decodingCount = 0;
    var S = null; // estado del juego de fotogramas activo
    var started = false;

    function isPortrait() {
      return window.innerWidth / window.innerHeight < 0.9;
    }

    function progressToFrame(p) {
      var last = S ? S.count - 1 : 0;
      for (var i = 1; i < stops.length; i++) {
        if (p <= stops[i][0]) {
          var a = stops[i - 1];
          var b = stops[i];
          var t = (p - a[0]) / (b[0] - a[0] || 1);
          return (a[1] + (b[1] - a[1]) * t) * last;
        }
      }
      return last;
    }

    function releaseSet(s) {
      if (!s) return;
      for (var k in s.bmps) if (s.bmps[k] && s.bmps[k].close) s.bmps[k].close();
      s.bmps = {};
    }

    function newSet(portrait) {
      releaseSet(S);
      var count = parseInt(hero.getAttribute(portrait ? "data-frames-mobile" : "data-frames"), 10) || 1;
      S = {
        portrait: portrait,
        dir: portrait ? "m" : "d",
        count: count,
        blobs: new Array(count),
        imgs: new Array(count),
        bmps: {},
        decoding: {},
        state: new Uint8Array(count), // 0 pendiente, 1 descargando, 2 listo, 3 fallido
        tries: new Uint8Array(count),
        coarse: [],
        coarseIdx: 0,
        done: 0,
        failed: 0,
        inflight: 0
      };
      for (var i = 0; i < count; i += 8) S.coarse.push(i);
      if (S.coarse[S.coarse.length - 1] !== count - 1) S.coarse.push(count - 1);
      hero.classList.remove("is-loaded");
      if (loaderBar) loaderBar.style.setProperty("--loaded", "0");
      currentFrame = targetFrame = progressToFrame(currentProgress());
      drawnIndex = -1;
      needsDraw = true;
    }

    function frameSrc(s, i) {
      var n = String(i + 1);
      while (n.length < 3) n = "0" + n;
      return basePath + s.dir + "/f" + n + ".webp";
    }

    function pickNext() {
      var s = S;
      // 1) pasada gruesa (uno de cada 8) para poder recorrer toda la película enseguida
      while (s.coarseIdx < s.coarse.length) {
        var c = s.coarse[s.coarseIdx++];
        if (s.state[c] === 0) return c;
      }
      // Reintentos de la pasada gruesa
      for (var j = 0; j < s.coarse.length; j++) if (s.state[s.coarse[j]] === 0) return s.coarse[j];
      if (saveData) return -1;
      // 2) después, lo más cercano a donde está mirando el visitante
      var t = Math.round(targetFrame);
      var best = -1;
      var bd = 1e9;
      for (var i = 0; i < s.count; i++) {
        if (s.state[i] === 0) {
          var d = Math.abs(i - t);
          if (d < bd) {
            bd = d;
            best = i;
          }
        }
      }
      return best;
    }

    function updateProgressBar() {
      var s = S;
      if (loaderBar) loaderBar.style.setProperty("--loaded", ((s.done + s.failed) / s.count).toFixed(3));
      if (s.done + s.failed >= s.count) hero.classList.add("is-loaded");
    }

    function pump() {
      if (!started) return;
      var s = S;
      while (s.inflight < MAX_INFLIGHT) {
        var idx = pickNext();
        if (idx < 0) break;
        load(s, idx);
      }
      if (s.inflight === 0 && pickNext() < 0) hero.classList.add("is-loaded");
    }

    function load(s, idx) {
      s.state[idx] = 1;
      s.inflight++;
      var url = frameSrc(s, idx);
      function ok() {
        if (s !== S) return;
        s.inflight--;
        s.state[idx] = 2;
        s.done++;
        updateProgressBar();
        if (useBitmaps) {
          if (drawnIndex < 0 || Math.abs(idx - targetFrame) <= WINDOW) ensureDecoded(idx);
        } else if (drawnIndex < 0 || Math.abs(idx - targetFrame) < Math.abs(drawnIndex - targetFrame)) {
          needsDraw = true;
          startLoop();
        }
        pump();
      }
      function fail() {
        if (s !== S) return;
        s.inflight--;
        s.tries[idx]++;
        if (s.tries[idx] < 2) {
          s.state[idx] = 0; // se reintenta una vez
        } else {
          s.state[idx] = 3;
          s.failed++;
          updateProgressBar();
        }
        pump();
      }
      if (useBitmaps) {
        fetch(url)
          .then(function (r) {
            if (!r.ok) throw new Error("HTTP " + r.status);
            return r.blob();
          })
          .then(function (blob) {
            if (s !== S) return;
            s.blobs[idx] = blob;
            ok();
          })
          .catch(fail);
      } else {
        var img = new Image();
        img.decoding = "async";
        img.onload = function () {
          if (s !== S) return;
          s.imgs[idx] = img;
          ok();
        };
        img.onerror = fail;
        img.src = url;
      }
    }

    function ensureDecoded(i) {
      var s = S;
      if (!useBitmaps || i < 0 || i >= s.count || s.bmps[i] || s.decoding[i] || !s.blobs[i]) return;
      s.decoding[i] = true;
      decodingCount++;
      createImageBitmap(s.blobs[i]).then(
        function (bmp) {
          decodingCount--;
          if (s !== S) {
            if (bmp.close) bmp.close();
            return;
          }
          delete s.decoding[i];
          s.bmps[i] = bmp;
          needsDraw = true;
          startLoop();
          fillWindow();
        },
        function () {
          decodingCount--;
          delete s.decoding[i];
        }
      );
    }

    // Decodifica los fotogramas cercanos al objetivo y libera los lejanos
    function fillWindow() {
      if (!useBitmaps || !S) return;
      var s = S;
      var t = Math.round(targetFrame);
      for (var d = 0; d <= WINDOW && decodingCount < MAX_DECODING; d++) {
        ensureDecoded(t + d);
        if (d) ensureDecoded(t - d);
      }
      for (var k in s.bmps) {
        var ki = +k;
        if (Math.abs(ki - t) > WINDOW + 6 && ki !== drawnIndex) {
          if (s.bmps[k].close) s.bmps[k].close();
          delete s.bmps[k];
        }
      }
    }

    function drawable(s, i) {
      return useBitmaps ? !!s.bmps[i] : s.state[i] === 2;
    }

    function nearestDrawable(i) {
      var s = S;
      if (!s) return -1;
      if (drawable(s, i)) return i;
      for (var d = 1; d < s.count; d++) {
        if (i - d >= 0 && drawable(s, i - d)) return i - d;
        if (i + d < s.count && drawable(s, i + d)) return i + d;
      }
      return -1;
    }

    /* --- Dibujo en canvas (ajuste tipo "cover") --- */
    var cw = 0;
    var ch = 0;
    var drawnIndex = -1;
    var needsDraw = true;

    function sizeCanvas() {
      // La película es 720p: por encima de 1,5x no se gana nitidez y se gasta memoria
      var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      cw = Math.max(1, Math.round(canvas.clientWidth * dpr));
      ch = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      needsDraw = true;
      startLoop();
    }

    function draw(index) {
      var i = nearestDrawable(index);
      if (i < 0) return;
      if (i === drawnIndex && !needsDraw) return;
      var src = useBitmaps ? S.bmps[i] : S.imgs[i];
      var iw = src.naturalWidth || src.width;
      var ih = src.naturalHeight || src.height;
      if (!iw || !ih) return;
      var scale = Math.max(cw / iw, ch / ih);
      var dw = iw * scale;
      var dh = ih * scale;
      ctx.drawImage(src, (cw - dw) / 2, (ch - dh) * 0.55, dw, dh);
      drawnIndex = i;
      needsDraw = false;
      if (!hero.classList.contains("is-ready")) hero.classList.add("is-ready");
    }

    /* --- Bucle con inercia suave: el fotograma "persigue" al scroll --- */
    var currentFrame = 0;
    var targetFrame = 0;
    var looping = false;

    function loop() {
      var diff = targetFrame - currentFrame;
      if (Math.abs(diff) < 0.05) currentFrame = targetFrame;
      else currentFrame += diff * (Math.abs(diff) > 12 ? 0.45 : 0.22); // saltos grandes, más rápido
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
      fillWindow();
      startLoop();
    }

    function onResize() {
      applyStaticMode();
      measure();
      // Al girar el móvil cambiamos al juego de fotogramas adecuado
      if (S && isPortrait() !== S.portrait) {
        newSet(isPortrait());
        pump();
      }
      sizeCanvas();
    }

    function start() {
      if (started) return;
      started = true;
      pump();
    }

    measure();
    applyStaticMode();
    newSet(isPortrait());
    scrollHandlers.push(onScroll);
    resizeHandlers.push(onResize);
    sizeCanvas();
    onScroll();

    // Los fotogramas se piden cuando la página ya ha cargado (o al primer scroll)
    if (document.readyState === "complete") start();
    else {
      window.addEventListener("load", start, { once: true });
      window.addEventListener("scroll", start, { once: true, passive: true });
      setTimeout(start, 2500);
    }
  }

  /* ======================================================================
     Declaración: las palabras se "encienden" según el scroll
     ====================================================================== */
  function initStatement() {
    var el = document.querySelector("[data-words]");
    if (!el || reduceMotion) return;
    var accent = (el.getAttribute("data-accent") || "").toLowerCase().split(",");
    var text = el.textContent.trim().replace(/\s+/g, " ");
    el.textContent = "";
    // Una copia para lectores de pantalla y otra, palabra a palabra, solo visual
    var sr = document.createElement("span");
    sr.className = "sr-only";
    sr.textContent = text;
    var vis = document.createElement("span");
    vis.setAttribute("aria-hidden", "true");
    el.appendChild(sr);
    el.appendChild(vis);
    var words = text.split(" ").map(function (w, i, arr) {
      var span = document.createElement("span");
      span.className = "w";
      span.textContent = w;
      var clean = w.toLowerCase().replace(/[^a-záéíóúñü]/g, "");
      if (accent.indexOf(clean) !== -1) span.classList.add("is-accent");
      vis.appendChild(span);
      if (i < arr.length - 1) vis.appendChild(document.createTextNode(" "));
      return span;
    });
    var lit = -1;
    scrollHandlers.push(function () {
      var r = el.getBoundingClientRect();
      var vh = window.innerHeight;
      if (r.bottom < -vh || r.top > vh * 2) return;
      // Termina de encenderse mientras el texto aún está entero en pantalla
      var p = clamp((vh * 0.9 - r.top) / (r.height * 0.6 + vh * 0.15), 0, 1);
      var n = Math.round(p * words.length);
      if (n === lit) return;
      lit = n;
      for (var i = 0; i < words.length; i++) words[i].classList.toggle("is-lit", i < n);
    });
  }

  /* ======================================================================
     Cinta: se desplaza con el scroll y cambia de sentido al subir.
     Se detiene sola cuando no se hace scroll (y al pasar el ratón por encima).
     ====================================================================== */
  function initMarquee() {
    var track = document.querySelector(".marquee__track");
    if (!track || reduceMotion || !("IntersectionObserver" in window)) return;
    var group = track.querySelector(".marquee__group");
    var groupW = group.offsetWidth;
    var offset = 0;
    var velocity = 0;
    var visible = false;
    var running = false;
    var hovered = false;
    var lastT = 0;
    var lastScrollT = -1e9;

    function remeasure() {
      groupW = group.offsetWidth;
    }
    resizeHandlers.push(remeasure);
    if ("ResizeObserver" in window) new ResizeObserver(remeasure).observe(group);

    scrollHandlers.push(function (y, dy) {
      if (!visible) return;
      lastScrollT = performance.now();
      velocity = clamp(velocity + dy * 0.35, -60, 60);
    });

    track.parentElement.addEventListener("mouseenter", function () {
      hovered = true;
    });
    track.parentElement.addEventListener("mouseleave", function () {
      hovered = false;
    });

    function frame(t) {
      var dt = lastT ? Math.min(64, t - lastT) : 16;
      lastT = t;
      var drifting = !hovered && t - lastScrollT < 3500;
      var base = drifting ? 0.045 * dt * scrollDir : 0; // el sentido sigue al del scroll
      velocity *= 0.9;
      if (hovered) velocity = 0;
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
        velocity = 0;
        running = true;
        lastT = 0;
        window.requestAnimationFrame(frame);
      }
    }).observe(track);
  }

  /* ======================================================================
     Galería de eventos: desplazamiento horizontal anclado
     (escritorio con altura suficiente; si no, carrusel nativo)
     ====================================================================== */
  function initEvents() {
    var section = document.querySelector(".events");
    if (!section) return;
    var pin = section.querySelector(".events__pin");
    var track = section.querySelector(".events__track");
    var viewport = section.querySelector(".events__viewport");
    var canPin = window.matchMedia("(min-width: 900px) and (min-height: 700px)");
    var distance = 0;

    function measureDistance() {
      var last = track.lastElementChild;
      if (!last) return 0;
      var padR = parseFloat(getComputedStyle(track).paddingRight) || 0;
      // Ambos rectángulos llevan la misma transformación: la diferencia no depende de ella
      var right = last.getBoundingClientRect().right - track.getBoundingClientRect().left + padR;
      return Math.max(0, Math.ceil(right - viewport.clientWidth));
    }

    function setup() {
      var enable = canPin.matches && !reduceMotion;
      section.classList.toggle("is-pinned", enable);
      if (enable) {
        distance = measureDistance();
        if (distance <= 0) enable = false;
      }
      if (!enable) {
        section.classList.remove("is-pinned");
        track.style.transform = "";
        pin.style.removeProperty("--pin-h");
        return;
      }
      pin.style.setProperty("--pin-h", window.innerHeight + distance + "px");
      update();
    }

    function update() {
      if (!section.classList.contains("is-pinned")) return;
      var p = clamp(-pin.getBoundingClientRect().top / (distance || 1), 0, 1);
      track.style.transform = "translate3d(" + (-p * distance).toFixed(1) + "px,0,0)";
      section.style.setProperty("--hp", p.toFixed(4));
    }

    setup();
    resizeHandlers.push(setup);
    scrollHandlers.push(update);

    // Teclado: con la galería anclada y enfocada, las flechas recorren las tarjetas
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
     Parallax suave en imágenes (con límite para no dejar huecos)
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
        var max = r.height * 0.085; // margen sobrante de la imagen arriba y abajo
        var center = r.top + r.height / 2 - vh / 2;
        el.style.setProperty("--parallax", clamp(-center * factor, -max, max).toFixed(1) + "px");
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
            void el.offsetWidth; // fija el estado inicial antes de animar
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
    // Si el foco llega a un bloque aún oculto, lo mostramos al momento
    document.addEventListener("focusin", function (e) {
      var r = e.target.closest && e.target.closest(".reveal");
      if (r) r.classList.add("is-in");
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
      if (sec) map[id] = sec;
    });
    scrollHandlers.push(function () {
      var mid = window.innerHeight * 0.4;
      var current = null;
      Object.keys(map).forEach(function (id) {
        var r = map[id].getBoundingClientRect();
        if (r.top <= mid && r.bottom > mid) current = id;
      });
      links.forEach(function (a) {
        if (current && a.getAttribute("href") === "#" + current) a.setAttribute("aria-current", "true");
        else a.removeAttribute("aria-current");
      });
    });
  }

  /* ======================================================================
     Volver arriba (aparece al terminar la película)
     ====================================================================== */
  function initToTop() {
    var btn = document.querySelector(".to-top");
    if (!btn) return;
    scrollHandlers.push(function (y) {
      var min = hero ? hero.offsetTop + hero.offsetHeight - window.innerHeight : 0;
      btn.classList.toggle("is-visible", y > Math.max(window.innerHeight * 1.5, min));
    });
    btn.addEventListener("click", function (e) {
      window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
      // Solo movemos el foco si se ha pulsado con el teclado
      if (e.detail === 0) {
        var brand = document.querySelector(".brand");
        if (brand) brand.focus({ preventScroll: true });
      }
    });
  }

  /* ======================================================================
     Copiar email al portapapeles
     ====================================================================== */
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

  function initCopy() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-copy]"), function (btn) {
      var label = btn.querySelector("[data-copy-label]") || btn;
      var original = label.textContent;
      var timer;
      btn.addEventListener("click", function () {
        var value = btn.getAttribute("data-copy");
        function done(ok) {
          label.textContent = ok ? "¡Copiado!" : "Copia: " + value;
          clearTimeout(timer);
          timer = setTimeout(function () {
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
      date.min = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    }

    var messages = {
      valueMissing: "Este campo es obligatorio.",
      typeMismatch: "Revisa el formato (ejemplo: nombre@correo.com).",
      patternMismatch: "Revisa el formato del teléfono.",
      rangeUnderflow: "La fecha no puede ser anterior a hoy.",
      rangeOverflow: "Revisa el número indicado.",
      stepMismatch: "Indica un número entero.",
      badInput: "Revisa el valor introducido.",
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
  function initYear() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-year]"), function (el) {
      el.textContent = String(new Date().getFullYear());
    });
  }

  /* ---------- Arranque: un fallo en un bloque no rompe los demás ---------- */
  [
    initHeader,
    initMenu,
    initHero,
    initStatement,
    initMarquee,
    initEvents,
    initSteps,
    initParallax,
    initReveal,
    initActiveNav,
    initToTop,
    initCopy,
    initForm,
    initYear
  ].forEach(function (fn) {
    try {
      fn();
    } catch (err) {
      if (window.console) console.error(err);
    }
  });
  window.__ioReady = true;
  requestScrollUpdate();

  // Si el usuario cambia la preferencia de movimiento, recargamos para aplicarla
  if (reduceMotionQuery.addEventListener) {
    reduceMotionQuery.addEventListener("change", function () {
      window.location.reload();
    });
  }
})();
