'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./malla');

test('la malla de 7 × 7 puntos a 1,5 km, de norte a sur y de oeste a este (la del informe)', () => {
  const m = M.malla();
  assert.equal(m.length, 49);
  assert.equal(new Set(m.map((p) => p.id)).size, 49);
  const punto = (id) => m.find((p) => p.id === id);
  assert.deepEqual(punto('f0c0'), { id: 'f0c0', fila: 0, columna: 0, lat: 40.4066059, lng: -3.9001441 });
  // Las esquinas y un punto de la tabla del informe de Google (sección 15).
  assert.deepEqual([punto('f+3c-3').lat, punto('f+3c-3').lng], [40.447131, -3.9531569]);
  assert.deepEqual([punto('f-3c+3').lat, punto('f-3c+3').lng], [40.3660808, -3.8471313]);
  assert.equal(M.coordenada(punto('f+2c-2')), '40.4336226,-3.9354860,15z');
  assert.equal(m[0].id, 'f+3c-3');
  assert.equal(m[48].id, 'f-3c+3');
  const g = M.metrosPorGrado(40.4066059);
  assert.ok(Math.abs(g.lat - 111042) < 1 && Math.abs(g.lng - 84885) < 1);
});

test('la malla se ajusta, pero siempre con un centro y un número impar de puntos', () => {
  assert.equal(M.malla({ lado: 5, pasoKm: 2 }).length, 25);
  assert.equal(M.malla({ lado: 1 }).length, 1);
  assert.throws(() => M.malla({ lado: 6 }), /impar/);
  assert.throws(() => M.malla({ pasoKm: 0 }), /separación/);
  assert.throws(() => M.malla({ centro: { lat: 'x', lng: 1 } }), /coordenada/);
  assert.throws(() => M.coordenada({ lat: 40, lng: -3 }, 22), /zoom/);
  assert.equal(M.coordenada({ lat: 40.1, lng: -3.2 }, 13), '40.1000000,-3.2000000,13z');
});

test('lo que cuesta: una página de 20 resultados en móvil; la malla con 12 búsquedas, unos 0,35 $ por pasada', () => {
  assert.equal(M.costeTarea(), 0.0006);
  assert.equal(M.costeTarea({ profundidad: 100 }), 5 * 0.0006);
  const pasada = M.malla().length * M.PALABRAS.length * M.costeTarea();
  assert.equal(Math.round(pasada * 1e4) / 1e4, 0.3528);
  assert.equal(M.PALABRAS.length, 12);
  assert.equal(M.MUNICIPIOS.length, 4);
});

test('el puesto de la clínica por su place ID o su CID; si no sale, null', () => {
  const items = [{ puesto: 1, placeId: 'ChIJuno', cid: '111' }, { puesto: 2, placeId: 'ChIJclinica', cid: '222' }, { puesto: 3, placeId: null, cid: '333' }];
  assert.equal(M.puestoDe(items, { placeId: 'ChIJclinica' }), 2);
  assert.equal(M.puestoDe(items, { cid: 333 }), 3);
  assert.equal(M.puestoDe(items, { placeId: 'ChIJotra', cid: '999' }), null);
  assert.equal(M.puestoDe([], { placeId: 'ChIJclinica' }), null);
  assert.equal(M.puestoDe(items, {}), null);
});

test('las cifras de una pasada: dónde sale, su puesto medio, el top 3 y quién gana donde no gana ella', () => {
  const filas = [
    { palabra: 'botox', punto: 'f0c0', puesto: 1, primero: 'IEMEC' },
    { palabra: 'botox', punto: 'f+1c0', puesto: 4, primero: 'Clínica Uno' },
    { palabra: 'botox', punto: 'f-1c0', puesto: null, primero: 'Clínica Uno' },
    { palabra: 'botox', punto: 'f0c+1', puesto: 2, primero: 'Clínica Dos' },
    { palabra: 'head spa', punto: 'f0c0', puesto: null, primero: 'Head Spa de Prueba' },
  ];
  const [botox, headSpa] = M.resumirPasada(filas);
  assert.deepEqual(botox, {
    palabra: 'botox', puntos: 4, conPuesto: 3, puestoMedio: 2.3, puestoMedioTotal: 7, top3: 50, primero: 1,
    rivales: [{ nombre: 'Clínica Uno', puntos: 2 }, { nombre: 'Clínica Dos', puntos: 1 }],
  });
  assert.deepEqual([headSpa.conPuesto, headSpa.puestoMedio, headSpa.puestoMedioTotal, headSpa.top3], [0, null, 21, 0]);
  assert.deepEqual(M.resumirPasada([]), []);
});

test('la cuadrícula para pintar: filas de norte a sur, columnas de oeste a este', () => {
  const c = M.cuadricula([{ punto: 'f+1c-1', puesto: 5 }, { punto: 'f0c0', puesto: 1 }, { punto: 'f-1c+1', puesto: null }], { lado: 3 });
  assert.deepEqual(c, [[5, null, null], [null, 1, null], [null, null, null]]);
});
