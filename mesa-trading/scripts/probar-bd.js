'use strict';
// Caso conocido de la base de datos de la versión web (ARQUITECTURA-WEB W4).
// No necesita MariaDB: lo que se comprueba aquí tiene respuesta sabida.
//
//   node scripts/probar-bd.js
//
// 1. El hash de contraseñas es scrypt de verdad: el vector de la RFC 7914
//    (§12: «pleaseletmein», sal «SodiumChloride», N=16384, r=8, p=1, 64 bytes)
//    escrito en nuestro formato se acepta con su clave y se rechaza con otra.
// 2. El espejo numera las líneas como el fichero: un JSONL de 5 líneas (una
//    vacía, una que no es JSON y otra a medio escribir) da 3 filas con los
//    números 1, 3 y 4; copiar otra vez no añade nada; al terminar la línea a
//    medias entra como la 5. Contra una base de mentira que aplica la misma
//    regla de unicidad (fuente, linea) que mesa_registros.
// Imprime OK/FALLO por caso y sale con 1 si alguno falla.

const fs = require('fs');
const os = require('os');
const path = require('path');
const usuarios = require('../src/bd/usuarios');
const { sincronizar } = require('../src/bd/espejo');

let fallos = 0;
function caso(nombre, ok, detalle = '') {
  console.log(`${ok ? 'OK   ' : 'FALLO'} ${nombre}${detalle ? ` · ${detalle}` : ''}`);
  if (!ok) fallos += 1;
}

// Base de mentira: solo entiende los INSERT del espejo y guarda por (fuente, linea).
function poolDeMentira() {
  const registros = new Map();
  const latidos = new Map();
  return {
    registros, latidos,
    async query(sql, params) {
      if (/^INSERT INTO mesa_registros/.test(sql)) for (const [fuente, linea, t, datos] of params[0]) registros.set(`${fuente}|${linea}`, { fuente, linea, t, datos });
      else if (/^INSERT INTO mesa_latidos/.test(sql)) for (const [id, inicio, ms, ok, resumen] of params[0]) latidos.set(id, { id, inicio, ms, ok, resumen });
      else throw new Error(`consulta inesperada: ${sql.slice(0, 40)}`);
      return [{ affectedRows: params[0].length }];
    },
  };
}

async function main() {
  // 1. Vector de la RFC 7914.
  const sal = Buffer.from('SodiumChloride');
  const esperado = Buffer.from('7023bdcb3afd7348461c06cd81fd38ebfda8fbba904f8e3ea9b543f6545da1f2d5432955613f0fcf62d49705242a9af9e61e85dc0d651e40dfcf017b45575887', 'hex');
  const hashRFC = `scrypt$ln=14,r=8,p=1$${sal.toString('base64')}$${esperado.toString('base64')}`;
  caso('scrypt: el vector de la RFC 7914 se acepta con «pleaseletmein»', await usuarios.coincide(hashRFC, 'pleaseletmein'));
  caso('scrypt: y se rechaza con otra clave', !(await usuarios.coincide(hashRFC, 'pleaseletmeim')));
  const nuevo = await usuarios.hashDeClave('pleaseletmein');
  const l = usuarios.leerHash(nuevo);
  caso('hash nuevo: N=2^15, r=8, p=1, sal de 16 bytes, 64 bytes de clave', l.ln === 15 && l.r === 8 && l.p === 1 && l.sal.length === 16 && l.clave.length === 64, nuevo.slice(0, 22));

  // 2. Espejo.
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'probar-bd-'));
  try {
    const ruta = path.join(carpeta, 'mensajes.jsonl');
    fs.writeFileSync(ruta, '{"t":100,"texto":"uno"}\n\nno es json\n{"t":400,"texto":"cuatro"}\n{"t":500,"tex');
    const pool = poolDeMentira();
    const r1 = await sincronizar({ carpetaDatos: carpeta }, { pool });
    const lineas = [...pool.registros.values()].map(f => f.linea).join(',');
    caso('espejo: 3 filas con los números de línea del fichero', r1.copiados === 3 && lineas === '1,3,4', `líneas ${lineas}`);
    const r2 = await sincronizar({ carpetaDatos: carpeta }, { pool });
    caso('espejo: copiar otra vez no añade nada', r2.copiados === 0 && pool.registros.size === 3);
    fs.appendFileSync(ruta, 'to":"cinco"}\n');
    const r3 = await sincronizar({ carpetaDatos: carpeta }, { pool });
    const cinco = pool.registros.get('mensajes|5');
    caso('espejo: la línea a medias entra entera, como la 5', r3.copiados === 1 && cinco && cinco.t === 500 && JSON.parse(cinco.datos).texto === 'cinco');
    fs.unlinkSync(path.join(carpeta, 'espejo.json'));
    await sincronizar({ carpetaDatos: carpeta }, { pool });
    caso('espejo: sin espejo.json se recorre de nuevo y siguen siendo 4 filas', pool.registros.size === 4);
  } finally {
    fs.rmSync(carpeta, { recursive: true, force: true });
  }

  console.log(fallos ? `\nFALLO: ${fallos} caso(s)` : '\nOK: la base de datos cuadra con los casos conocidos');
  return fallos ? 1 : 0;
}

main().then(c => process.exit(c), e => { console.error(`FALLO: ${e.stack || e.message}`); process.exit(1); });
