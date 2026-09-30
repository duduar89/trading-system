'use strict';
// Las comprobaciones de las pruebas del panel pillan lo que tienen que pillar (y no lo que no): texto
// gris claro sobre blanco, un botón sin contorno de foco, uno sin nombre y algo que se sale a lo ancho;
// lo decorativo, lo que se lee bien y el foco de serie del navegador, no. Sin navegador, se salta.
const test = require('node:test');
const assert = require('node:assert/strict');
const { lanzarNavegador, revisarPantalla } = require('./ayuda-navegador');

const PAGINA = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Prueba</title></head>
<body style="margin:0;padding:8px;background:#fff;color:#1f232b;font:16px/1.4 sans-serif">
  <p style="color:#9a9a9a">Gris claro que no se lee</p>
  <p style="color:#595959">Gris que sí se lee</p>
  <p style="color:#e5e5e5" aria-hidden="true">Adorno</p>
  <p style="background:#123f3e;color:#fff;padding:4px">Blanco sobre terciopelo</p>
  <p><button type="button" style="outline:none">Sin contorno</button> <button type="button">Con el de serie</button>
  <button type="button"><svg width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="6"/></svg></button></p>
  <div style="width:520px">Una tabla que no cabe</div>
</body></html>`;

test('las comprobaciones de las pruebas del panel pillan lo que tienen que pillar', async (t) => {
  const navegador = await lanzarNavegador();
  if (!navegador) { t.skip('sin Chromium para Playwright'); return; }
  try {
    const pagina = await navegador.newPage({ viewport: { width: 390, height: 600 }, reducedMotion: 'reduce' });
    await pagina.setContent(PAGINA);
    const r = await revisarPantalla(pagina);
    assert.equal(r.contraste.length, 1, r.contraste.join('\n'));
    assert.match(r.contraste[0], /«Gris claro que no se lee»: 2\.\d\d:1 \(#9a9a9a sobre #ffffff; hace falta 4\.5:1\)$/);
    assert.equal(r.foco.length, 1, r.foco.join('\n'));
    assert.match(r.foco[0], /^<button> «Sin contorno»: el foco apenas se ve/);
    assert.equal(r.sinNombre.length, 1, r.sinNombre.join('\n'));
    assert.match(r.sinNombre[0], /^button: <button type="button"><svg/);
    assert.match(r.desbordes[0], /^la página mide \d+ px de ancho en 390 px$/);
    assert.ok(r.desbordes.some((d) => /^<div class=""> hasta 528 px$/.test(d)), r.desbordes.join('\n'));
  } finally {
    await navegador.close();
  }
});
