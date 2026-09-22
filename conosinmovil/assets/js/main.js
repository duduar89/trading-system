/* ==========================================================================
   Con o sin móvil — interacción
   - Película del hero y clips de servicios controlados por el scroll
     (avanzan al bajar y retroceden al subir)
   - Cabecera, menú móvil, navegación activa, apariciones y contadores
   - Precios: pestañas accesibles + buscador de modelos
   - Formulario de contacto (validación + correo) y mapa con consentimiento
   ========================================================================== */
(function () {
  "use strict";

  window.__cosmReady = true;
  var root = document.documentElement;
  root.classList.add("js");

  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reducedMotion) root.classList.add("reduced-motion");
  var isMobile = window.matchMedia("(max-width: 767px)").matches;

  // H.264 (MP4) donde se pueda —Safari/iOS lo necesita—; si no, VP9 (WebM)
  var probe = document.createElement("video");
  var useWebm = !probe.canPlayType('video/mp4; codecs="avc1.640028"') &&
    !!probe.canPlayType('video/webm; codecs="vp9"');

  function clamp(v, min, max) { return v < min ? min : v > max ? max : v; }
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  /* ------------------------------------------------------------------
     Vídeo controlado por el scroll
     ------------------------------------------------------------------ */
  function ScrubVideo(video, smoothing) {
    this.video = video;
    this.smoothing = smoothing || 0.18;
    this.target = 0;      // progreso deseado 0..1
    this.current = 0;     // tiempo suavizado (s)
    this.duration = 0;
    this.ready = false;
    this.loading = false;

    if (isMobile && video.dataset.posterMobile) video.poster = video.dataset.posterMobile;
  }

  ScrubVideo.prototype.load = function () {
    if (this.loading || reducedMotion) return;
    this.loading = true;
    var self = this;
    var v = this.video;
    var src = isMobile && v.dataset.srcMobile ? v.dataset.srcMobile : v.dataset.src;
    if (useWebm) src = src.replace(/\.mp4$/, ".webm");

    function attach(url) {
      v.addEventListener("loadedmetadata", function () {
        self.duration = v.duration || 0;
        self.ready = self.duration > 0;
        // Prepara el decodificador (iOS) sin reproducir de verdad
        var p = v.play();
        if (p && p.then) {
          p.then(function () { v.pause(); self.video.currentTime = self.current; requestTick(); })
           .catch(function () { requestTick(); });
        } else {
          v.pause();
        }
        requestTick();
      }, { once: true });
      v.addEventListener("seeked", requestTick);
      v.preload = "auto";
      v.src = url;
      v.load();
    }

    // Se descarga entero como Blob para que el avance/retroceso sea fluido
    if (window.fetch && location.protocol !== "file:") {
      fetch(src)
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.blob(); })
        .then(function (blob) { attach(URL.createObjectURL(blob)); })
        .catch(function () { attach(src); });
    } else {
      attach(src);
    }
  };

  // Devuelve true mientras siga necesitando fotogramas (suavizado o búsqueda)
  ScrubVideo.prototype.tick = function () {
    if (!this.ready) return false;
    var v = this.video;
    var goal = this.target * Math.max(0, this.duration - 0.05);
    var diff = goal - this.current;
    this.current = Math.abs(diff) < 0.004 ? goal : this.current + diff * this.smoothing;
    if (v.seeking) return true;
    if (Math.abs(v.currentTime - this.current) > 0.012) {
      try { v.currentTime = this.current; } catch (e) { /* aún no se puede buscar */ }
      return true;
    }
    return Math.abs(goal - this.current) > 0.004;
  };

  /* ------------------------------------------------------------------
     Hero
     ------------------------------------------------------------------ */
  var heroEl = $("[data-hero]");
  var hero = null;
  if (heroEl) {
    hero = {
      el: heroEl,
      top: 0,
      height: 0,
      progress: 0,
      scrub: new ScrubVideo($("[data-hero-video]", heroEl), 0.16),
      chapters: $$("[data-chapter]", heroEl).map(function (el) {
        return { el: el, from: parseFloat(el.dataset.from), to: parseFloat(el.dataset.to) };
      }),
      rail: $("[data-hero-rail]", heroEl),
      cue: $("[data-scroll-cue]", heroEl),
      active: -1
    };
    hero.measure = function () {
      var r = heroEl.getBoundingClientRect();
      hero.top = r.top + window.scrollY;
      hero.height = heroEl.offsetHeight;
    };
    hero.scrollFor = function (p) {
      return hero.top + p * Math.max(1, hero.height - window.innerHeight);
    };
    hero.frame = function (y, vh) {
      var p = clamp((y - hero.top) / Math.max(1, hero.height - vh), 0, 1);
      hero.progress = p;
      // La película termina un poco antes para dejar leer el último capítulo
      hero.scrub.target = clamp(p / 0.9, 0, 1);

      var idx = -1;
      for (var i = 0; i < hero.chapters.length; i++) {
        var c = hero.chapters[i];
        if (p >= c.from && p < c.to) { idx = i; break; }
      }
      if (idx !== hero.active) {
        hero.active = idx;
        hero.chapters.forEach(function (c, j) {
          var on = j === idx;
          c.el.classList.toggle("is-active", on);
          c.el.classList.toggle("is-above", !on && p >= c.to);
        });
      }
      if (hero.rail) hero.rail.style.setProperty("--p", p.toFixed(4));
      if (hero.cue) hero.cue.classList.toggle("is-hidden", p > 0.04);
      if (reducedMotion) heroEl.classList.toggle("show-end", p > 0.5);
      return hero.scrub.tick();
    };

    hero.measure();
    hero.scrub.load();

    // El aviso "Desliza" recorre la película en lugar de saltársela
    if (hero.cue) {
      hero.cue.addEventListener("click", function (e) {
        e.preventDefault();
        window.scrollTo({ top: hero.scrollFor(0.97), behavior: reducedMotion ? "auto" : "smooth" });
      });
    }
    // Accesibilidad: al tabular dentro de un capítulo oculto, se lleva el scroll hasta él
    hero.chapters.forEach(function (c) {
      c.el.addEventListener("focusin", function () {
        if (!c.el.classList.contains("is-active")) {
          window.scrollTo({ top: hero.scrollFor((c.from + Math.min(c.to, 1)) / 2), behavior: "auto" });
        }
      });
    });
  }

  /* ------------------------------------------------------------------
     Clips de servicios (se reproducen al pasar por ellos)
     ------------------------------------------------------------------ */
  var cards = $$("[data-scrub-card]").map(function (el) {
    return { el: el, scrub: new ScrubVideo($("video", el), 0.2), visible: false };
  });
  var parallaxEls = $$("[data-parallax]").map(function (el) {
    return { el: el, img: $("img", el), visible: false };
  });

  function traversal(rect, vh) {
    // 0 cuando asoma por abajo · 1 cuando sale por arriba
    return clamp((vh - rect.top) / (vh + rect.height), 0, 1);
  }

  if ("IntersectionObserver" in window) {
    var loader = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var card = cards.filter(function (c) { return c.el === en.target; })[0];
        if (card) card.scrub.load();
        loader.unobserve(en.target);
      });
    }, { rootMargin: "800px 0px" });

    var visibility = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        cards.concat(parallaxEls).forEach(function (c) {
          if (c.el === en.target) c.visible = en.isIntersecting;
        });
      });
      requestTick();
    });

    cards.forEach(function (c) { loader.observe(c.el); visibility.observe(c.el); });
    parallaxEls.forEach(function (p) { visibility.observe(p.el); });
  } else {
    cards.forEach(function (c) { c.visible = true; c.scrub.load(); });
    parallaxEls.forEach(function (p) { p.visible = true; });
  }

  /* ------------------------------------------------------------------
     Bucle de animación (solo corre cuando hace falta)
     ------------------------------------------------------------------ */
  var header = $("[data-header]");
  var progressBar = $(".scroll-progress span");
  var rafId = 0;

  function requestTick() {
    if (!rafId) rafId = window.requestAnimationFrame(frame);
  }

  function frame() {
    rafId = 0;
    var y = window.scrollY;
    var vh = window.innerHeight;
    var busy = false;

    if (header) header.classList.toggle("is-scrolled", y > 24);
    if (progressBar) {
      var max = Math.max(1, document.documentElement.scrollHeight - vh);
      progressBar.style.setProperty("--p", clamp(y / max, 0, 1).toFixed(4));
    }

    if (hero && y < hero.top + hero.height + vh) {
      if (hero.frame(y, vh)) busy = true;
    }

    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      if (!c.visible && !c.scrub.ready) continue;
      if (c.visible) {
        var t = traversal(c.el.getBoundingClientRect(), vh);
        // Completa la animación cuando la tarjeta llega al centro de la pantalla
        c.scrub.target = clamp((t - 0.12) / 0.42, 0, 1);
      }
      if (c.scrub.tick()) busy = true;
    }

    for (var k = 0; k < parallaxEls.length; k++) {
      var pe = parallaxEls[k];
      if (!pe.visible || reducedMotion) continue;
      var tp = traversal(pe.el.getBoundingClientRect(), vh);
      pe.img.style.setProperty("--zoom", (1.14 - tp * 0.12).toFixed(4));
    }

    if (busy) requestTick();
  }

  window.addEventListener("scroll", requestTick, { passive: true });
  window.addEventListener("resize", function () {
    if (hero) hero.measure();
    requestTick();
  });
  window.addEventListener("load", function () {
    if (hero) hero.measure();
    requestTick();
  });
  requestTick();

  /* ------------------------------------------------------------------
     Menú móvil
     ------------------------------------------------------------------ */
  var toggle = $("[data-menu-toggle]");
  var menu = $("[data-menu]");
  var toggleLabel = toggle ? $(".visually-hidden", toggle) : null;

  function setMenu(open, returnFocus) {
    if (!toggle || !menu) return;
    toggle.setAttribute("aria-expanded", String(open));
    if (toggleLabel) toggleLabel.textContent = open ? "Cerrar menú" : "Abrir menú";
    document.body.classList.toggle("menu-open", open);
    if (open) {
      menu.hidden = false;
      window.requestAnimationFrame(function () { menu.classList.add("is-open"); });
      var first = $("a", menu);
      if (first) first.focus({ preventScroll: true });
    } else {
      menu.classList.remove("is-open");
      window.setTimeout(function () {
        if (toggle.getAttribute("aria-expanded") === "false") menu.hidden = true;
      }, 260);
      if (returnFocus) toggle.focus();
    }
  }

  if (toggle && menu) {
    toggle.addEventListener("click", function () {
      setMenu(toggle.getAttribute("aria-expanded") !== "true");
    });
    $$("[data-menu-link]", menu).forEach(function (a) {
      a.addEventListener("click", function () { setMenu(false); });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") setMenu(false, true);
    });
    window.addEventListener("resize", function () {
      if (window.innerWidth > 1080 && toggle.getAttribute("aria-expanded") === "true") setMenu(false);
    });
  }

  /* ------------------------------------------------------------------
     Enlace activo en la navegación
     ------------------------------------------------------------------ */
  var navLinks = $$("[data-nav]");
  if (navLinks.length && "IntersectionObserver" in window) {
    var sectionObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var id = "#" + en.target.id;
        navLinks.forEach(function (a) {
          var on = a.getAttribute("href") === id;
          a.classList.toggle("is-active", on);
          if (on) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current");
        });
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    ["inicio", "cifras", "servicios", "precios", "nosotros", "contacto"].forEach(function (id) {
      var s = document.getElementById(id);
      if (s) sectionObserver.observe(s);
    });
  }

  /* ------------------------------------------------------------------
     Apariciones al hacer scroll (se repiten al subir y volver a bajar)
     ------------------------------------------------------------------ */
  var counters = $$("[data-count]");

  function formatCount(el, n) {
    return (el.dataset.prefix || "") + n + (el.dataset.suffix || "");
  }
  function runCounter(el) {
    var end = parseInt(el.dataset.count, 10);
    if (reducedMotion || !end) { el.textContent = formatCount(el, end); return; }
    var start = null;
    var dur = 1100;
    function step(ts) {
      if (start === null) start = ts;
      var t = clamp((ts - start) / dur, 0, 1);
      var eased = 1 - Math.pow(1 - t, 3);
      el.textContent = formatCount(el, Math.round(end * eased));
      if (t < 1) window.requestAnimationFrame(step);
    }
    window.requestAnimationFrame(step);
  }

  var revealEls = $$("[data-reveal]");
  if ("IntersectionObserver" in window && !reducedMotion) {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var el = en.target;
        if (en.isIntersecting) {
          if (!el.classList.contains("is-visible")) {
            el.classList.add("is-visible");
            $$("[data-count]", el).forEach(runCounter);
          }
        } else if (en.boundingClientRect.top > 0) {
          // Salió por abajo (el usuario sube): se prepara para volver a aparecer
          el.classList.remove("is-visible");
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    revealEls.forEach(function (el) { revealObserver.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add("is-visible"); });
    counters.forEach(function (el) { el.textContent = formatCount(el, el.dataset.count); });
  }

  /* ------------------------------------------------------------------
     Precios: pestañas + buscador
     ------------------------------------------------------------------ */
  var tabs = $$(".tab");
  var tablist = $(".tabs");
  var panels = $$(".price-panel");
  var search = $("[data-price-search]");
  var empty = $("[data-price-empty]");
  var selectedTab = tabs[0];

  function normalize(s) {
    return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
  }

  function selectTab(tab, focus) {
    selectedTab = tab;
    tabs.forEach(function (t) {
      var on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
    });
    panels.forEach(function (p) {
      p.hidden = p.id !== tab.getAttribute("aria-controls");
      $$(".price-card", p).forEach(function (card) { card.hidden = false; });
    });
    if (empty) empty.hidden = true;
    if (focus) tab.focus();
  }

  tabs.forEach(function (tab, i) {
    tab.addEventListener("click", function () {
      if (search && search.value) { search.value = ""; tablist.classList.remove("is-searching"); }
      selectTab(tab);
    });
    tab.addEventListener("keydown", function (e) {
      var next = null;
      if (e.key === "ArrowRight") next = tabs[(i + 1) % tabs.length];
      else if (e.key === "ArrowLeft") next = tabs[(i - 1 + tabs.length) % tabs.length];
      else if (e.key === "Home") next = tabs[0];
      else if (e.key === "End") next = tabs[tabs.length - 1];
      if (next) {
        e.preventDefault();
        if (search && search.value) { search.value = ""; tablist.classList.remove("is-searching"); }
        selectTab(next, true);
      }
    });
  });

  if (search) {
    search.addEventListener("input", function () {
      var q = normalize(search.value);
      if (!q) {
        tablist.classList.remove("is-searching");
        selectTab(selectedTab);
        return;
      }
      tablist.classList.add("is-searching");
      var total = 0;
      panels.forEach(function (p) {
        var brand = normalize(p.dataset.brand || "");
        var count = 0;
        $$(".price-card", p).forEach(function (card) {
          var text = normalize(brand + " " + $(".model", card).textContent);
          var match = text.indexOf(q) !== -1 || normalize($(".model", card).textContent).indexOf(q) !== -1;
          card.hidden = !match;
          if (match) count++;
        });
        p.hidden = count === 0;
        total += count;
      });
      if (empty) empty.hidden = total !== 0;
    });
    search.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && search.value) {
        search.value = "";
        search.dispatchEvent(new Event("input"));
      }
    });
  }

  /* ------------------------------------------------------------------
     Formulario de contacto
     ------------------------------------------------------------------ */
  var form = $("[data-contact-form]");
  var EMAIL = "conosinmovil@gmail.com";

  if (form) {
    var result = $("[data-form-result]", form);
    var copyBtn = $("[data-copy-message]", form);
    var againLink = $("[data-mailto-again]", form);
    var lastMessage = "";

    var rules = {
      nombre: function (el) { return el.value.trim().length > 1; },
      contacto: function (el) {
        var v = el.value.trim();
        var isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
        var digits = v.replace(/[\s().+-]/g, "");
        var isPhone = /^\d{9,15}$/.test(digits);
        return isEmail || isPhone;
      },
      mensaje: function (el) { return el.value.trim().length > 2; },
      consentimiento: function (el) { return el.checked; }
    };

    function setError(el, invalid) {
      var field = el.closest(".field");
      var msg = document.getElementById(el.getAttribute("aria-describedby"));
      if (field) field.classList.toggle("has-error", invalid);
      if (msg) msg.hidden = !invalid;
      if (invalid) el.setAttribute("aria-invalid", "true"); else el.removeAttribute("aria-invalid");
    }

    Object.keys(rules).forEach(function (name) {
      var el = form.elements[name];
      if (!el) return;
      var ev = el.type === "checkbox" ? "change" : "input";
      el.addEventListener(ev, function () {
        if (el.getAttribute("aria-invalid") === "true") setError(el, !rules[name](el));
      });
      el.addEventListener("blur", function () {
        if (el.type !== "checkbox" && el.value.trim()) setError(el, !rules[name](el));
      });
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var firstInvalid = null;
      Object.keys(rules).forEach(function (name) {
        var el = form.elements[name];
        var ok = rules[name](el);
        setError(el, !ok);
        if (!ok && !firstInvalid) firstInvalid = el;
      });
      if (firstInvalid) { firstInvalid.focus(); return; }

      var nombre = form.elements.nombre.value.trim();
      var contacto = form.elements.contacto.value.trim();
      var dispositivo = form.elements.dispositivo.value;
      var mensaje = form.elements.mensaje.value.trim();

      var subject = "Solicitud de reparación: " + dispositivo + " (" + nombre + ")";
      lastMessage =
        "Nombre: " + nombre + "\r\n" +
        "Contacto: " + contacto + "\r\n" +
        "Dispositivo: " + dispositivo + "\r\n\r\n" +
        mensaje + "\r\n\r\n" +
        "Enviado desde la web conosinmovil.com";

      var href = "mailto:" + EMAIL + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(lastMessage);
      if (againLink) againLink.href = href;
      if (result) {
        result.hidden = false;
        result.focus({ preventScroll: true });
        result.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "nearest" });
      }
      window.location.href = href;
    });

    if (copyBtn) {
      copyBtn.addEventListener("click", function () {
        var text = "Para: " + EMAIL + "\r\n" + lastMessage;
        var label = $("span", copyBtn);
        function done(ok) {
          if (!label) return;
          label.textContent = ok ? "¡Copiado!" : "No se pudo copiar";
          window.setTimeout(function () { label.textContent = "Copiar mensaje"; }, 2200);
        }
        if (navigator.clipboard && window.isSecureContext) {
          navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(fallbackCopy(text)); });
        } else {
          done(fallbackCopy(text));
        }
      });
    }
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
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  /* ------------------------------------------------------------------
     Mapa de Google (solo con consentimiento)
     ------------------------------------------------------------------ */
  var map = $("[data-map]");
  var MAP_KEY = "cosm-map-consent";

  function loadMap() {
    if (!map || $("iframe", map)) return;
    var iframe = document.createElement("iframe");
    iframe.src = "https://www.google.com/maps?q=" +
      encodeURIComponent("Calle Juan Carlos I 41, 28660 Boadilla del Monte, Madrid") + "&z=16&output=embed";
    iframe.title = "Mapa: Calle Juan Carlos I, 41, Boadilla del Monte";
    iframe.loading = "lazy";
    iframe.referrerPolicy = "no-referrer-when-downgrade";
    iframe.setAttribute("allowfullscreen", "");
    map.appendChild(iframe);
    var consent = $("[data-map-consent]", map);
    if (consent) consent.remove();
  }

  if (map) {
    var mapBtn = $("[data-map-load]", map);
    if (mapBtn) {
      mapBtn.addEventListener("click", function () {
        try { localStorage.setItem(MAP_KEY, "1"); } catch (e) { /* almacenamiento no disponible */ }
        loadMap();
      });
    }
    try { if (localStorage.getItem(MAP_KEY) === "1") loadMap(); } catch (e) { /* sin almacenamiento */ }
  }

  /* ------------------------------------------------------------------
     Año actual en el pie
     ------------------------------------------------------------------ */
  $$("[data-year]").forEach(function (el) { el.textContent = String(new Date().getFullYear()); });
})();
