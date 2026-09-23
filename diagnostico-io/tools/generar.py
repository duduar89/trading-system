#!/usr/bin/env python3
"""Genera preguntas.js y estudio.html a partir del JSON del estudio.

Uso: python3 tools/generar.py estudio.json
El JSON tiene dos claves: "study" (oportunidades) y "questionnaire" (secciones y preguntas).
"""
import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

CONFIG = {
    "version": "1",
    "form_id": "diagnostico-io",
    "endpoint": "enviar.php",
    "fallback_email": "info@brainstormersagency.es",
    "title": "IO Sistemas Audiovisuales",
    "study_url": "estudio.html",
    "consent_text": (
        "He leído la información de protección de datos del paso «Contacto» y acepto que "
        "Brain Stormers use estas respuestas solo para preparar una propuesta para IO."
    ),
}

VALID_TYPES = {"text", "textarea", "email", "tel", "number", "single", "multi", "scale", "matrix", "select"}


def clean_questionnaire(q):
    seen = set()
    for sec in q["sections"]:
        for item in sec["questions"]:
            qid = re.sub(r"[^a-z0-9_]", "_", item["id"].lower())
            base, n = qid, 2
            while qid in seen:
                qid = f"{base}_{n}"
                n += 1
            seen.add(qid)
            item["id"] = qid
            if item["type"] not in VALID_TYPES:
                raise SystemExit(f"Tipo no válido en {qid}: {item['type']}")
            if item["type"] in {"single", "multi", "select"} and not item.get("options"):
                raise SystemExit(f"{qid}: faltan opciones")
            if item["type"] == "matrix" and not item.get("rows"):
                raise SystemExit(f"{qid}: faltan filas de la matriz")
            item.setdefault("required", False)
    return q


def write_js(data):
    payload = {"config": CONFIG, "study": data["study"], "questionnaire": data["questionnaire"]}
    # El estudio público no incluye las notas internas
    payload["study"] = {k: v for k, v in data["study"].items() if k != "internal_notes_for_brainstormers"}
    js = "/* Generado por tools/generar.py — no editar a mano */\nwindow.DIAG = " + json.dumps(payload, ensure_ascii=False, indent=1) + ";\n"
    (ROOT / "preguntas.js").write_text(js, encoding="utf-8")


def e(s):
    return html.escape(str(s or ""))


def short_url(u):
    return re.sub(r"^https?://(www\.)?", "", u)[:70]


def write_study(data):
    st = data["study"]
    cards = []
    for o in st["opportunities"]:
        srcs = "".join(
            '<li><a href="{0}" target="_blank" rel="noopener noreferrer">{1}</a></li>'.format(e(u), e(short_url(u)))
            for u in (o.get("sources") or [])[:4]
        )
        cards.append(f"""
      <article class="idea study-card">
        <div class="idea-top"><span class="tag">{e(o['category'])}</span><span class="tag soft">Esfuerzo {e(o['effort']).lower()}</span><span class="tag soft">Impacto {e(o['impact']).lower()}</span></div>
        <h3>{e(o['title'])}</h3>
        <dl>
          <dt>Qué pasa hoy</dt><dd>{e(o['problem'])}</dd>
          <dt>Qué proponemos</dt><dd>{e(o['solution'])}</dd>
          <dt>Qué necesitaríamos de vosotros</dt><dd>{e(o['what_we_need'])}</dd>
          <dt>A tener en cuenta</dt><dd>{e(o['caveats'])}</dd>
        </dl>
        {f'<details class="src"><summary>Fuentes</summary><ul>{srcs}</ul></details>' if srcs else ''}
      </article>""")
    wins = "".join(f"<li>{e(w)}</li>" for w in st.get("quick_wins", []))
    page = f"""<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Estudio preliminar · IA y tecnología para IO Sistemas Audiovisuales</title>
  <meta name="robots" content="noindex, nofollow">
  <meta name="theme-color" content="#0b0d12">
  <link rel="icon" type="image/png" href="assets/img/favicon-32.png">
  <link rel="stylesheet" href="assets/form.css?v=1">
  <style>
    .study-card dl {{ margin: 12px 0 0; display: grid; gap: 10px; }}
    .study-card dt {{ color: var(--peach); font-size: 0.8rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; }}
    .study-card dd {{ margin: 2px 0 0; color: var(--text-soft); }}
    .src {{ margin-top: 12px; font-size: 0.85rem; color: var(--muted); }}
    .src summary {{ cursor: pointer; }}
    .src ul {{ margin: 8px 0 0; padding-left: 18px; }}
    .wins {{ margin-top: 28px; padding: 20px; border: 1px solid var(--line); border-radius: var(--radius); background: rgba(17,21,28,.78); }}
    .wins h2 {{ font-size: 1.4rem; }}
    .wins ul {{ margin: 12px 0 0; padding-left: 20px; color: var(--text-soft); display: grid; gap: 8px; }}
    .list {{ display: grid; gap: 14px; margin-top: 28px; }}
    @media print {{ .study-card, .wins {{ break-inside: avoid; border-color: #ccc; }} .study-card dd, .wins ul {{ color: #222; }} .tag {{ color: #000; }} }}
  </style>
</head>
<body>
  <div class="wrap">
    <header class="top">
      <img src="assets/img/logo-io-blanco.webp" width="600" height="461" alt="IO Sistemas Audiovisuales">
      <span class="x" aria-hidden="true">×</span><span class="bs">Brain Stormers</span>
    </header>
    <main>
      <section class="hero">
        <p class="eyebrow">Estudio preliminar · IO Sistemas Audiovisuales</p>
        <h1>{e(st['title'])}</h1>
        <p class="lead">{e(st['summary'])}</p>
        <div class="start"><a class="btn btn-primary" href="index.html">Rellenar el cuestionario</a><button class="btn btn-ghost" type="button" onclick="window.print()">Imprimir o guardar en PDF</button></div>
      </section>
      <section class="wins" aria-labelledby="wins-t"><h2 id="wins-t">Por dónde empezaríamos</h2><ul>{wins}</ul></section>
      <section class="list" aria-label="Oportunidades">{''.join(cards)}
      </section>
      <div class="start" style="margin:40px 0"><a class="btn btn-primary" href="index.html">Rellenar el cuestionario</a></div>
    </main>
    <footer class="foot"><p>Documento preparado por Brain Stormers para IO Sistemas Audiovisuales. Es un análisis preliminar: las propuestas concretas dependen de vuestras respuestas al cuestionario.</p></footer>
  </div>
</body>
</html>
"""
    (ROOT / "estudio.html").write_text(page, encoding="utf-8")


def main():
    data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    data["questionnaire"] = clean_questionnaire(data["questionnaire"])
    write_js(data)
    write_study(data)
    n = sum(len(s["questions"]) for s in data["questionnaire"]["sections"])
    print(f"preguntas.js: {len(data['questionnaire']['sections'])} secciones, {n} preguntas")
    print(f"estudio.html: {len(data['study']['opportunities'])} oportunidades")


if __name__ == "__main__":
    main()
