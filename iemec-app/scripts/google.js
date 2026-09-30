#!/usr/bin/env node
'use strict';
// Dar de alta Google y DataForSEO en el servidor, con el .env de producción (ver docs/GOOGLE.md):
//   node scripts/google.js cuentas       a qué cuentas y fichas llega el token → GOOGLE_CUENTA y GOOGLE_UBICACION
//   node scripts/google.js ficha         comprueba el acceso: la ficha (place ID, enlace para reseñar) y las reseñas
//   node scripts/google.js avisos projects/<proyecto>/topics/<tema>
//                                        da de alta los avisos al momento de la cuenta (Pub/Sub)
//   node scripts/google.js posiciones    lo que cuesta una pasada de la malla y el saldo de DataForSEO
// Solo lee (salvo el ajuste de avisos, que es de la cuenta). No guarda nada en la base ni publica nada.
require('../servidor/config'); // carga el .env
const { crearGoogle } = require('../servidor/integraciones/google');
const { crearDataForSeo } = require('../servidor/integraciones/dataforseo');
const posiciones = require('../servidor/posiciones');
const M = require('../motor/posiciones/malla');

const USO = `Uso:
  node scripts/google.js cuentas
  node scripts/google.js ficha
  node scripts/google.js avisos projects/<proyecto>/topics/<tema>
  node scripts/google.js posiciones`;

async function main([orden, argumento]) {
  if (orden === 'cuentas') {
    const g = crearGoogle('real');
    const cuentas = await g.listarCuentas();
    if (!cuentas.length) console.log('El token no llega a ninguna cuenta: ¿la clínica ha añadido a la cuenta de la app como gestora de la ficha?');
    for (const c of cuentas) {
      console.log(`Cuenta ${c.id} · ${c.nombre || '—'} (${c.tipo || '—'}, ${c.rol || '—'})`);
      for (const u of await g.listarUbicaciones(c.id)) console.log(`  Ficha ${u.id} · ${u.nombre || '—'} · ${u.direccion || '—'} · place ID ${u.placeId || '—'}`);
    }
    console.log('\nEn el .env: GOOGLE_CUENTA=<la cuenta> y GOOGLE_UBICACION=<la ficha de la clínica>.');
  } else if (orden === 'ficha') {
    const g = crearGoogle('real');
    const f = await g.obtenerFicha({ refrescar: true });
    console.log(`Ficha (${f.origen}): ${f.nombre || '—'}`);
    console.log(`  place ID: ${f.placeId || '—'}`);
    console.log(`  enlace para reseñar: ${f.newReviewUri || '—'}`);
    if (f.origen === 'perfil') {
      console.log(`  categoría: ${f.categoriaPrincipal || '—'}${f.categoriasAdicionales.length ? ` (+ ${f.categoriasAdicionales.join(', ')})` : ''}`);
      console.log(`  control de la ficha: ${f.conVoz ? 'sí' : 'NO'} · cambios de Google sin revisar: ${f.googleHaCambiado ? 'SÍ' : 'no'}`);
      const p = await g.paginaResenas();
      console.log(`  reseñas: ${p.total ?? '—'} · nota media: ${p.notaMedia ?? '—'}`);
    }
    if (g.capacidades.places) {
      const p = await g.fichaPlaces();
      console.log(`Places: nota ${p.nota ?? '—'} con ${p.total ?? '—'} reseñas${p.avisoConsumidor ? ' · ⚠ Google muestra un aviso de reseñas sospechosas' : ''}`);
    }
  } else if (orden === 'avisos') {
    const r = await crearGoogle('real').configurarAvisos(argumento);
    console.log(`✓ Avisos de la cuenta hacia ${r.tema}: ${r.tipos.join(', ')}`);
  } else if (orden === 'posiciones') {
    const a = posiciones.ajustes();
    const puntos = a.lado ** 2 + (a.municipios ? M.MUNICIPIOS.length : 0);
    const tareas = puntos * a.palabras.length;
    const coste = tareas * M.costeTarea({ profundidad: a.profundidad, precioPagina: posiciones.PRECIO_PAGINA });
    console.log(`Malla de ${a.lado}×${a.lado} puntos a ${a.pasoKm} km${a.municipios ? ' + 4 municipios' : ''}: ${puntos} puntos × ${a.palabras.length} búsquedas = ${tareas} tareas`);
    console.log(`Una pasada: ${coste.toFixed(4)} $ · al mes (unas 4,3 pasadas): ${(coste * 4.35).toFixed(2)} $ · tope del mes: ${a.topeMesUsd} $`);
    if (process.env.DATAFORSEO_LOGIN) console.log(`Saldo en DataForSEO: ${(await crearDataForSeo('real').saldo()).saldo ?? '—'} $`);
  } else {
    console.log(USO);
    process.exitCode = 1;
  }
}

main(process.argv.slice(2)).catch((err) => {
  console.error(`✗ ${err.message}`);
  process.exitCode = 1;
});
