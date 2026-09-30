'use strict';
// Caso conocido del motor por latido (docs/ARQUITECTURA-WEB.md W2): la demo
// sintética corrida en un proceso continuo y reconstruyendo el orquestador
// desde disco en cada paso deja EXACTAMENTE lo mismo en disco (estado,
// bróker, operaciones, órdenes, comités, mensajes, instantánea), salvo las
// marcas de sesión y de publicación. Aquí 8 días (cruza la revisión semanal
// del lunes 8 y el laboratorio fuera de banda); los 20 días de la demo van en
// scripts/probar-latido.js (npm run probar).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { compararLatido, comparar } = require('../scripts/probar-latido');
const { leerJSON, escribirJSON } = require('../src/util/almacen');

test('latido a latido = proceso continuo: 8 días de demo, con comandos del panel y laboratorio fuera de banda', { timeout: 300_000 }, async () => {
  const r = await compararLatido({ dias: 8, semilla: 42, conLaboratorio: true, conservar: true });
  try {
    assert.deepEqual(r.mercado, []);
    assert.deepEqual(r.diferencias, [], `difiere: ${JSON.stringify(r.diferencias.slice(0, 3))}`);
    assert.equal(r.respuestasDistintas, null);
    assert.equal(r.continuo.pasos, 8 * 288);
    assert.equal(r.latido.pasos, 8 * 288);
    // Pasó de verdad lo que se compara.
    assert.ok(r.latido.operaciones > 0, 'hubo operaciones');
    assert.equal(r.latido.operaciones, r.continuo.operaciones);
    assert.ok(r.latido.comites >= 8 * 6, `comités: ${r.latido.comites}`);
    assert.equal(r.latido.comites, r.continuo.comites);
    assert.ok(r.latido.comitesDemanda >= 1, 'el comité convocado desde el panel se celebró');
    assert.equal(r.latido.mensajes, r.continuo.mensajes);
    assert.ok(r.latido.laboratorios >= 1 && r.latido.incorporados >= 1, 'el laboratorio fuera de banda evaluó e incorporó');
    assert.equal(r.latido.incorporados, r.continuo.incorporados);
    assert.ok(r.respuestas.some(x => x.nombre === 'megafono-aplicar' && x.ok));
    assert.deepEqual(r.cerrojos, []);
    assert.equal(r.resultadoLabSinBorrar, false);

    // La comparación no es vacía: un cambio en cualquier fichero se ve.
    const dirB = path.join(r.carpeta, 'latido');
    const rutaEstado = path.join(dirB, 'estado.json');
    const estado = leerJSON(rutaEstado);
    estado.contadores.vetos += 1;
    escribirJSON(rutaEstado, estado);
    const d = comparar(path.join(r.carpeta, 'continuo'), dirB);
    assert.equal(d.length, 1);
    assert.equal(d[0].fichero, 'estado.json');
    assert.equal(d[0].ruta, 'contadores.vetos');
    fs.appendFileSync(path.join(dirB, 'mensajes.jsonl'), `${JSON.stringify({ t: 1, texto: 'de más' })}\n`);
    assert.ok(comparar(path.join(r.carpeta, 'continuo'), dirB).some(x => x.fichero === 'mensajes.jsonl'));
  } finally {
    fs.rmSync(r.carpeta, { recursive: true, force: true });
  }
});
