'use strict';
// El CSV propio (sin dependencias): separador adivinado, comillas, saltos de línea dentro de un campo
// y las codificaciones que deja Excel. Con los ficheros INVENTADOS de test/fixtures/flowww y con
// trozos escritos aquí.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { leerCsv, ErrorCsv } = require('./csv');

const FIXTURES = path.join(__dirname, '..', '..', 'test', 'fixtures', 'flowww');
const bytes1252 = (texto) => Buffer.from([...texto].map((c) => (c === '€' ? 0x80 : c.charCodeAt(0))));

test('«;» con comillas: el separador y los saltos de línea dentro de un campo, y "" dentro de comillas', () => {
  const r = leerCsv('Nombre;Observaciones;Móvil\nAna;"Prefiere tardes; nada de látex";611000001\nBea;"Dos\r\nlíneas y ""comillas""";611000002\n');
  assert.equal(r.separador, ';');
  assert.deepEqual(r.cabeceras, ['Nombre', 'Observaciones', 'Móvil']);
  assert.deepEqual(r.filas.map((f) => f.valores.Observaciones), ['Prefiere tardes; nada de látex', 'Dos\nlíneas y "comillas"']);
  assert.deepEqual(r.filas.map((f) => [f.fila, f.linea]), [[2, 2], [3, 3]]);
});

test('«,» se adivina aunque haya comas dentro de las comillas', () => {
  const r = leerCsv('Cliente,Fecha,Servicio\n"Ruiz, Ana",15/10/2026,Higiene facial\n"Gil, Eva",16/10/2026,"Presoterapia, 45 min"\n');
  assert.equal(r.separador, ',');
  assert.deepEqual(r.filas.map((f) => f.valores.Cliente), ['Ruiz, Ana', 'Gil, Eva']);
  assert.equal(r.filas[1].valores.Servicio, 'Presoterapia, 45 min');
});

test('tabulador, «sep=» de Excel, líneas vacías y cabeceras repetidas o vacías', () => {
  const t = leerCsv('Nombre\tTeléfono\tTeléfono\t\nAna\t611000001\t916320000\tx\n\n\nEva\t611000002\t\t\n');
  assert.equal(t.separador, '\t');
  assert.deepEqual(t.cabeceras, ['Nombre', 'Teléfono', 'Teléfono (2)', 'Columna 4']);
  assert.deepEqual(t.filas.map((f) => f.fila), [2, 5], 'la fila de la hoja de cálculo, contando las vacías');
  const s = leerCsv('sep=,\r\nNombre;x,Móvil\r\nAna;y,611000001\r\n');
  assert.equal(s.separador, ',', 'manda la línea «sep=»');
  assert.deepEqual(s.cabeceras, ['Nombre;x', 'Móvil']);
  assert.equal(s.filas[0].fila, 2);
  const sobran = leerCsv('A;B\n1;2;3\n');
  assert.equal(sobran.filas[0].sobran, true, 'una fila con más columnas que la cabecera se avisa');
});

test('codificaciones: UTF-8 con BOM, Windows-1252 (el € es 0x80) y UTF-16 de Excel', () => {
  const bom = leerCsv(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Código;Año\n1;2026\n')]));
  assert.equal(bom.codificacion, 'UTF-8 con BOM');
  assert.deepEqual(bom.cabeceras, ['Código', 'Año'], 'el BOM no se pega a la primera cabecera');
  const w = leerCsv(bytes1252('Nombre;Observaciones\nNúria;Señal de 30 €\n'));
  assert.equal(w.codificacion, 'Windows-1252');
  assert.equal(w.filas[0].valores.Nombre, 'Núria');
  assert.equal(w.filas[0].valores.Observaciones, 'Señal de 30 €');
  const u16 = leerCsv(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Nombre\tMóvil\r\nÁngela\t611000003\r\n', 'utf16le')]));
  assert.equal(u16.codificacion, 'UTF-16');
  assert.deepEqual(u16.filas[0].valores, { Nombre: 'Ángela', Móvil: '611000003' });
  assert.equal(leerCsv(Buffer.from('Nombre;Móvil\nÍñigo;611000004\n')).codificacion, 'UTF-8');
});

test('comillas sin cerrar o fichero vacío: error claro, con la línea', () => {
  assert.throws(() => leerCsv('Nombre;Notas\nAna;"sin cerrar\nEva;bien\n'), (e) => e instanceof ErrorCsv && /comillas sin cerrar desde la línea 2/.test(e.message));
  assert.throws(() => leerCsv('\n\n'), (e) => e instanceof ErrorCsv && /vacío/.test(e.message));
});

test('los ficheros de prueba de Flowww: BOM y «;» con CRLF, y Windows-1252 con «,»', () => {
  const p = leerCsv(fs.readFileSync(path.join(FIXTURES, 'pacientes.csv')));
  assert.deepEqual([p.codificacion, p.separador, p.filas.length], ['UTF-8 con BOM', ';', 11]);
  assert.equal(p.cabeceras[0], 'Código');
  const sergio = p.filas.find((f) => f.valores.Código === '1005');
  assert.equal(sergio.fila, 6);
  assert.equal(sergio.valores.Observaciones, 'Paciente con\ndos líneas de nota y "comillas"');
  assert.equal(p.filas.find((f) => f.valores.Código === '1006').fila, 7, 'la nota de dos líneas es una sola fila');
  const c = leerCsv(fs.readFileSync(path.join(FIXTURES, 'citas.csv')));
  assert.deepEqual([c.codificacion, c.separador, c.filas.length], ['Windows-1252', ',', 18]);
  assert.equal(c.cabeceras[0], 'Nº cita');
  assert.equal(c.filas[0].valores.Cliente, 'Ruiz Soler, Carmen');
  assert.equal(c.filas[0].valores.Observaciones, 'Trae su crema, 30 €');
});
