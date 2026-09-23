/* Formulario de diagnóstico por pasos.
   Las preguntas vienen de window.DIAG (preguntas.js). Guarda el progreso en el
   navegador, valida cada paso y envía las respuestas a enviar.php. */
(function () {
  "use strict";

  var DIAG = window.DIAG;
  if (!DIAG) return;
  var Q = DIAG.questionnaire;
  var CFG = DIAG.config || {};
  var STORE_KEY = "diag-io-" + (CFG.version || "1");

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var el = function (tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else if (attrs[k] !== false && attrs[k] != null) n.setAttribute(k, attrs[k] === true ? "" : attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  };

  var state = { answers: {}, step: 0, startedAt: null };
  var DEFAULT_SCALE = ["1", "2", "3", "4", "5"];

  /* ---------- Persistencia (solo en este navegador) ---------- */
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      var s = $("#saved");
      if (s) s.textContent = "Progreso guardado en este dispositivo";
    } catch (e) { /* modo privado o almacenamiento bloqueado: seguimos sin guardar */ }
  }
  var saveTimer;
  function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 300); }
  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return false;
      var s = JSON.parse(raw);
      if (s && s.answers) { state = s; return Object.keys(s.answers).length > 0; }
    } catch (e) {}
    return false;
  }
  function clearSaved() { try { localStorage.removeItem(STORE_KEY); } catch (e) {} }

  /* ---------- Portada: resumen del estudio ---------- */
  function renderIntro() {
    var st = DIAG.study || {};
    $("#intro").textContent = Q.intro || "";
    $("#minutes").textContent = "≈ " + (Q.estimated_minutes || 12) + " minutos";
    $("#qcount").textContent = countQuestions() + " preguntas";
    var list = $("#ideas-list");
    var opps = st.opportunities || [];
    $("#ideas-count").textContent = opps.length;
    if (st.summary) list.appendChild(el("p", { class: "ideas-summary", text: st.summary }));
    if (CFG.study_url) {
      list.appendChild(el("p", null, [el("a", { href: CFG.study_url, text: "Leer el estudio completo, con detalles y fuentes →" })]));
    }
    opps.forEach(function (o) {
      list.appendChild(el("article", { class: "idea" }, [
        el("div", { class: "idea-top" }, [
          el("span", { class: "tag", text: o.category }),
          el("span", { class: "tag soft", text: "Esfuerzo " + (o.effort || "").toLowerCase() }),
          el("span", { class: "tag soft", text: "Impacto " + (o.impact || "").toLowerCase() })
        ]),
        el("h3", { text: o.title }),
        el("p", { text: o.solution })
      ]));
    });
  }

  function countQuestions() {
    return Q.sections.reduce(function (n, s) { return n + s.questions.length; }, 0);
  }

  /* ---------- Preguntas ---------- */
  function qId(q) { return "q-" + q.id; }

  function labelFor(q, isGroup) {
    var kids = [q.label];
    if (q.max) kids.push(el("span", { class: "opt", text: "(máximo " + q.max + ")" }));
    if (q.required) kids.push(el("span", { class: "req", "aria-hidden": "true", text: "*" }));
    else kids.push(el("span", { class: "opt", text: "(opcional)" }));
    return isGroup ? el("legend", null, kids) : el("label", { class: "q-label", for: qId(q) }, kids);
  }

  function renderQuestion(q) {
    var group = ["single", "multi", "scale", "matrix"].indexOf(q.type) !== -1;
    var box = el(group ? "fieldset" : "div", { class: "q", "data-q": q.id });
    box.appendChild(labelFor(q, group));
    var errId = qId(q) + "-err";
    var helpId = qId(q) + "-help";
    if (q.help) box.appendChild(el("p", { class: "help", id: helpId, text: q.help }));
    var body = el("div", { class: "q-body" });
    var described = (q.help ? helpId + " " : "") + errId;
    if (group) box.setAttribute("aria-describedby", described);
    var val = state.answers[q.id];

    if (["text", "email", "tel", "number"].indexOf(q.type) !== -1) {
      var attrs = { id: qId(q), name: q.id, type: q.type, "aria-describedby": described };
      if (q.type === "email") { attrs.autocomplete = "email"; attrs.inputmode = "email"; }
      if (q.type === "tel") { attrs.autocomplete = "tel"; attrs.inputmode = "tel"; }
      if (q.type === "number") { attrs.inputmode = "numeric"; attrs.min = "0"; }
      if (/nombre/.test(q.id) && q.type === "text") attrs.autocomplete = "name";
      var inp = el("input", attrs);
      if (val != null) inp.value = val;
      inp.addEventListener("input", function () { setAnswer(q, inp.value); });
      body.appendChild(inp);
    } else if (q.type === "textarea") {
      var ta = el("textarea", { id: qId(q), name: q.id, rows: "4", "aria-describedby": described });
      if (val != null) ta.value = val;
      ta.addEventListener("input", function () { setAnswer(q, ta.value); });
      body.appendChild(ta);
    } else if (q.type === "select") {
      var sel = el("select", { id: qId(q), name: q.id, "aria-describedby": described }, [el("option", { value: "", text: "Elige una opción" })]);
      (q.options || []).forEach(function (o) { sel.appendChild(el("option", { value: o, text: o })); });
      if (val != null) sel.value = val;
      sel.addEventListener("change", function () { setAnswer(q, sel.value); });
      body.appendChild(sel);
    } else if (q.type === "single" || q.type === "multi") {
      body.appendChild(renderChoices(q, val));
    } else if (q.type === "scale") {
      body.appendChild(renderScale(q, q.id, q.options, val, function (v) { setAnswer(q, v); }));
    } else if (q.type === "matrix") {
      var cur = val && typeof val === "object" ? val : {};
      (q.rows || []).forEach(function (row, i) {
        var rid = q.id + "__" + i;
        var wrap = el("div", { class: "matrix-row", role: "group", "aria-labelledby": rid + "-l" }, [
          el("span", { class: "row-label", id: rid + "-l", text: row })
        ]);
        wrap.appendChild(renderScale(q, rid, q.options, cur[row], function (v) {
          var m = Object.assign({}, state.answers[q.id] || {});
          m[row] = v;
          setAnswer(q, m);
        }));
        body.appendChild(wrap);
      });
    }
    box.appendChild(body);
    box.appendChild(el("p", { class: "err", id: errId, "aria-live": "polite" }));
    return box;
  }

  function renderChoices(q, val) {
    var multi = q.type === "multi";
    var opts = (q.options || []).slice();
    var wrap = el("div", { class: "choices" + (opts.length > 5 ? " cols-2" : "") });
    var current = multi ? (Array.isArray(val) ? val : []) : val;
    var otherKey = q.id + "__otro";
    var otherInput;
    function update() {
      var inputs = wrap.querySelectorAll("input[name='" + q.id + "']");
      var v = multi ? [] : "";
      Array.prototype.forEach.call(inputs, function (i) { if (i.checked) { if (multi) v.push(i.value); else v = i.value; } });
      setAnswer(q, v);
      if (multi && q.max) {
        Array.prototype.forEach.call(inputs, function (i) { i.disabled = !i.checked && v.length >= q.max; });
      }
      if (otherInput) {
        var on = multi ? v.indexOf("Otro") !== -1 : v === "Otro";
        otherInput.hidden = !on;
        if (!on) { otherInput.value = ""; delete state.answers[otherKey]; }
      }
    }
    if (q.allow_other && opts.indexOf("Otro") === -1) opts.push("Otro");
    opts.forEach(function (o, i) {
      var id = qId(q) + "-" + i;
      var inp = el("input", { type: multi ? "checkbox" : "radio", name: q.id, id: id, value: o });
      if (multi ? current.indexOf(o) !== -1 : current === o) inp.checked = true;
      inp.addEventListener("change", update);
      wrap.appendChild(el("label", { class: "choice", for: id }, [inp, el("span", { text: o })]));
    });
    if (multi && q.max && current.length >= q.max) {
      Array.prototype.forEach.call(wrap.querySelectorAll("input"), function (i) { i.disabled = !i.checked; });
    }
    if (q.allow_other) {
      otherInput = el("input", { type: "text", class: "other-input", "aria-label": "Especifica «Otro»", placeholder: "Especifica…" });
      otherInput.value = state.answers[otherKey] || "";
      otherInput.hidden = !(multi ? current.indexOf("Otro") !== -1 : current === "Otro");
      otherInput.addEventListener("input", function () { state.answers[otherKey] = otherInput.value; saveSoon(); });
      var frag = el("div", null, [wrap, otherInput]);
      return frag;
    }
    return wrap;
  }

  function renderScale(q, name, options, val, onChange) {
    var opts = options && options.length ? options : DEFAULT_SCALE;
    var numeric = opts === DEFAULT_SCALE;
    var wrap = el("div", null);
    var scale = el("div", { class: "scale" });
    scale.style.setProperty("--n", opts.length);
    opts.forEach(function (o, i) {
      var id = "s-" + name + "-" + i;
      var inp = el("input", { type: "radio", name: name, id: id, value: o });
      if (val === o) inp.checked = true;
      inp.addEventListener("change", function () { onChange(o); });
      scale.appendChild(el("label", { for: id }, [inp, numeric ? el("b", { text: o }) : el("span", { text: o })]));
    });
    wrap.appendChild(scale);
    if (numeric) wrap.appendChild(el("div", { class: "scale-legend", "aria-hidden": "true" }, [el("span", { text: "1 · Nada" }), el("span", { text: "5 · Mucho" })]));
    return wrap;
  }

  function setAnswer(q, v) {
    state.answers[q.id] = v;
    var box = document.querySelector(".q[data-q='" + q.id + "']");
    if (box && box.classList.contains("has-error")) validateQuestion(q);
    saveSoon();
  }

  /* ---------- Validación ---------- */
  function isEmpty(q, v) {
    if (v == null) return true;
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === "object") return (q.rows || []).some(function (r) { return !v[r]; });
    return String(v).trim() === "";
  }

  function validateQuestion(q) {
    var v = state.answers[q.id];
    var msg = "";
    if (q.required && isEmpty(q, v)) {
      msg = q.type === "matrix" ? "Responde todas las filas, por favor." : (q.type === "multi" ? "Elige al menos una opción." : "Esta pregunta es obligatoria.");
    } else if (q.type === "multi" && q.max && Array.isArray(v) && v.length > q.max) {
      msg = "Elige como máximo " + q.max + ".";
    } else if (q.type === "email" && v && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v).trim())) {
      msg = "Revisa el correo (por ejemplo, nombre@empresa.com).";
    } else if (q.type === "tel" && v && !/^[0-9+()\s.\-]{9,20}$/.test(String(v).trim())) {
      msg = "Revisa el teléfono.";
    } else if (q.allow_other) {
      var other = state.answers[q.id + "__otro"];
      var picked = Array.isArray(v) ? v.indexOf("Otro") !== -1 : v === "Otro";
      if (picked && (!other || !other.trim())) msg = "Especifica qué es «Otro».";
    }
    var box = document.querySelector(".q[data-q='" + q.id + "']");
    if (box) {
      box.classList.toggle("has-error", !!msg);
      var err = box.querySelector(".err");
      if (err) err.textContent = msg;
      var field = box.querySelector("input, select, textarea");
      if (field && !box.matches("fieldset")) field.setAttribute("aria-invalid", msg ? "true" : "false");
    }
    return !msg;
  }

  function validateStep(i) {
    var sec = Q.sections[i];
    var firstBad = null;
    sec.questions.forEach(function (q) {
      if (!validateQuestion(q) && !firstBad) firstBad = q;
    });
    if (firstBad) {
      var box = document.querySelector(".q[data-q='" + firstBad.id + "']");
      if (box) {
        box.scrollIntoView({ block: "center", behavior: "smooth" });
        var f = box.querySelector("input, select, textarea");
        if (f) setTimeout(function () { f.focus({ preventScroll: true }); }, 250);
      }
      return false;
    }
    return true;
  }

  /* ---------- Pasos ---------- */
  var steps = [];
  function buildSteps() {
    var host = $("#steps");
    Q.sections.forEach(function (sec, i) {
      var head = el("div", { class: "step-head" }, [
        el("h2", { tabindex: "-1", text: sec.title }),
        sec.description ? el("p", { text: sec.description }) : null
      ]);
      var step = el("section", { class: "step", "data-step": i, hidden: true, "aria-labelledby": "h-" + i }, [head]);
      head.querySelector("h2").id = "h-" + i;
      sec.questions.forEach(function (q) { step.appendChild(renderQuestion(q)); });
      step.appendChild(navFor(i));
      host.appendChild(step);
      steps.push(step);
    });
    // Paso final: resumen y envío
    var review = el("section", { class: "step", "data-step": Q.sections.length, hidden: true, "aria-labelledby": "h-review" }, [
      el("div", { class: "step-head" }, [
        el("h2", { id: "h-review", tabindex: "-1", text: "Revisa y envía" }),
        el("p", { text: "Comprueba tus respuestas. Puedes volver a cualquier sección para cambiar algo." })
      ]),
      el("div", { id: "review" }),
      el("label", { class: "consent", for: "consent" }, [
        el("input", { type: "checkbox", id: "consent" }),
        el("span", { text: CFG.consent_text || "Acepto que se usen estas respuestas solo para preparar una propuesta." })
      ]),
      el("div", { class: "hp", "aria-hidden": "true" }, [el("label", { for: "website", text: "No rellenar" }), el("input", { type: "text", id: "website", tabindex: "-1", autocomplete: "off" })]),
      el("p", { class: "status", id: "status", role: "status", "aria-live": "polite" }),
      el("div", { id: "fallback" }),
      el("div", { class: "nav" }, [
        el("button", { class: "btn btn-ghost", type: "button", "data-go": "prev", text: "Anterior" }),
        el("button", { class: "btn btn-primary", type: "button", id: "send", text: "Enviar respuestas" })
      ])
    ]);
    host.appendChild(review);
    steps.push(review);
  }

  function navFor(i) {
    return el("div", { class: "nav" }, [
      i > 0 ? el("button", { class: "btn btn-ghost", type: "button", "data-go": "prev", text: "Anterior" }) : el("span"),
      el("button", { class: "btn btn-primary", type: "button", "data-go": "next", text: i === Q.sections.length - 1 ? "Revisar respuestas" : "Siguiente" })
    ]);
  }

  function showStep(i, focus) {
    state.step = i;
    steps.forEach(function (s, k) { s.hidden = k !== i; });
    var total = steps.length;
    $("#step-label").textContent = i < Q.sections.length ? "Paso " + (i + 1) + " de " + Q.sections.length : "Último paso";
    $("#step-title").textContent = i < Q.sections.length ? Q.sections[i].title : "Revisar y enviar";
    $("#bar").style.width = Math.round(((i + 1) / total) * 100) + "%";
    if (i === Q.sections.length) renderReview();
    window.scrollTo({ top: $("#form").offsetTop - 4, behavior: "auto" });
    if (focus !== false) { var h = steps[i].querySelector("h2"); if (h) h.focus({ preventScroll: true }); }
    save();
  }

  function formatAnswer(q) {
    var v = state.answers[q.id];
    if (isEmpty(q, v) && q.type !== "matrix") return "";
    if (q.type === "matrix") {
      var m = v || {};
      return (q.rows || []).map(function (r) { return r + ": " + (m[r] || "—"); }).join("\n");
    }
    var out = Array.isArray(v) ? v.join(", ") : String(v);
    var other = state.answers[q.id + "__otro"];
    if (other && other.trim()) out = out.replace("Otro", "Otro (" + other.trim() + ")");
    return out;
  }

  function renderReview() {
    var host = $("#review");
    host.innerHTML = "";
    Q.sections.forEach(function (sec, i) {
      var dl = el("dl");
      sec.questions.forEach(function (q) {
        var a = formatAnswer(q);
        dl.appendChild(el("div", null, [el("dt", { text: q.label }), el("dd", { text: a || "Sin responder" })]));
      });
      var edit = el("button", { type: "button", text: "Editar" });
      edit.setAttribute("aria-label", "Editar " + sec.title);
      edit.addEventListener("click", function () { showStep(i); });
      host.appendChild(el("div", { class: "review-group" }, [el("h3", null, [el("span", { text: sec.title }), edit]), dl]));
    });
  }

  /* ---------- Envío ---------- */
  function findByType(type, re) {
    var found = null;
    Q.sections.forEach(function (s) { s.questions.forEach(function (q) { if (!found && q.type === type && (!re || re.test(q.id))) found = q; }); });
    return found;
  }

  function buildPayload() {
    var items = [];
    Q.sections.forEach(function (sec) {
      sec.questions.forEach(function (q) { items.push({ section: sec.title, id: q.id, question: q.label, answer: formatAnswer(q) }); });
    });
    var nameQ = findByType("text", /nombre/);
    var emailQ = findByType("email");
    return {
      form: CFG.form_id || "diagnostico-io",
      version: CFG.version || "1",
      respondent: { name: nameQ ? state.answers[nameQ.id] || "" : "", email: emailQ ? state.answers[emailQ.id] || "" : "" },
      started_at: state.startedAt,
      submitted_at: new Date().toISOString(),
      website: $("#website").value,
      items: items,
      answers: state.answers
    };
  }

  function asText(p) {
    var lines = ["Diagnóstico · " + (CFG.title || "IO Sistemas Audiovisuales"), "Enviado: " + new Date().toLocaleString("es-ES"), ""];
    var cur = "";
    p.items.forEach(function (it) {
      if (it.section !== cur) { cur = it.section; lines.push("", "== " + cur + " =="); }
      lines.push("• " + it.question, "  " + (it.answer || "Sin responder").replace(/\n/g, "\n  "));
    });
    return lines.join("\n");
  }

  function download(name, text) {
    var blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    var a = el("a", { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function showFallback(p) {
    var box = $("#fallback");
    box.innerHTML = "";
    var text = asText(p);
    var to = CFG.fallback_email || "";
    var mail = "mailto:" + to + "?subject=" + encodeURIComponent("Diagnóstico IA · " + (p.respondent.name || "IO Sistemas Audiovisuales")) +
      "&body=" + encodeURIComponent(text.length > 1800 ? text.slice(0, 1800) + "\n\n[…] Adjunto el archivo con todas las respuestas." : text);
    var dl = el("button", { class: "btn btn-primary", type: "button", text: "Descargar mis respuestas" });
    dl.addEventListener("click", function () { download("diagnostico-io-respuestas.txt", text); });
    box.appendChild(el("div", { class: "fallback" }, [
      el("p", { text: "No hemos podido enviarlo automáticamente. No pasa nada: tus respuestas siguen guardadas. Descárgalas y mándalas por correo" + (to ? " a " + to : "") + "." }),
      dl, " ",
      to ? el("a", { class: "btn btn-ghost", href: mail, text: "Abrir el correo" }) : null
    ]));
  }

  function send() {
    var btn = $("#send");
    var status = $("#status");
    if (!$("#consent").checked) {
      status.textContent = "Marca la casilla de aceptación para enviar.";
      status.classList.add("is-error");
      $("#consent").focus();
      return;
    }
    for (var i = 0; i < Q.sections.length; i++) {
      var ok = true;
      Q.sections[i].questions.forEach(function (q) { if (q.required && isEmpty(q, state.answers[q.id])) ok = false; });
      if (!ok) {
        status.textContent = "Falta alguna respuesta obligatoria en «" + Q.sections[i].title + "».";
        status.classList.add("is-error");
        showStep(i);
        validateStep(i);
        return;
      }
    }
    var payload = buildPayload();
    btn.disabled = true;
    btn.textContent = "Enviando…";
    status.classList.remove("is-error");
    status.textContent = "";
    $("#fallback").innerHTML = "";
    fetch(CFG.endpoint || "enviar.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false }; }).then(function (j) { return { http: r.status, body: j }; });
    }).then(function (res) {
      if (!res.body || !res.body.ok) throw new Error((res.body && res.body.error) || "HTTP " + res.http);
      clearSaved();
      document.body.setAttribute("data-sent", "1");
      $("#form").hidden = true;
      $("#portada").hidden = true;
      var done = $("#done");
      done.hidden = false;
      var h = done.querySelector("h2");
      if (h) h.focus();
      $("#done-copy").onclick = function () { download("diagnostico-io-respuestas.txt", asText(payload)); };
      window.scrollTo(0, 0);
    }).catch(function (err) {
      status.textContent = "No se ha podido enviar (" + err.message + ").";
      status.classList.add("is-error");
      showFallback(payload);
    }).then(function () {
      btn.disabled = false;
      btn.textContent = "Enviar respuestas";
    });
  }

  /* ---------- Arranque ---------- */
  function start(fresh) {
    if (fresh) { state = { answers: {}, step: 0, startedAt: new Date().toISOString() }; clearSaved(); }
    if (!state.startedAt) state.startedAt = new Date().toISOString();
    if (!steps.length) buildSteps();
    $("#form").hidden = false;
    showStep(Math.min(state.step || 0, steps.length - 1));
  }

  renderIntro();
  var restored = load();
  var startBtn = $("#start");
  var restartBtn = $("#restart");
  if (restored) {
    startBtn.textContent = "Continuar donde lo dejé";
    restartBtn.hidden = false;
    $("#restore-note").hidden = false;
  }
  startBtn.addEventListener("click", function () { start(false); });
  restartBtn.addEventListener("click", function () {
    if (window.confirm("¿Seguro que quieres empezar de cero? Se borrarán las respuestas guardadas.")) {
      if (steps.length) { steps.forEach(function (s) { s.remove(); }); steps = []; }
      start(true);
    }
  });

  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-go]");
    if (!b) return;
    if (b.getAttribute("data-go") === "next") {
      if (validateStep(state.step)) showStep(state.step + 1);
    } else showStep(Math.max(0, state.step - 1));
  });
  document.addEventListener("click", function (e) { if (e.target.id === "send") send(); });
})();
