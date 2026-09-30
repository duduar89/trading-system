'use strict';
// Crea un usuario del panel web (o le cambia la contraseña). ARQUITECTURA-WEB W4.
//
//   node scripts/crear-usuario.js                      pregunta usuario y contraseña (dos veces, sin eco)
//   node scripts/crear-usuario.js --usuario=eduardo    pregunta solo la contraseña
//   node scripts/crear-usuario.js --usuario=eduardo --clave-desde-entorno=MESA_CLAVE_NUEVA
//       sin teclado (por SSH o desde un script): la contraseña sale de esa
//       variable de entorno. Nunca se imprime, ni se pide dos veces.
//   --cambiar   si el usuario ya existe, le cambia la contraseña (y cierra sus
//               sesiones). Sin --cambiar, con teclado se pregunta; sin
//               teclado, sale con error.
//   npm run crear-usuario
//
// En la base solo se guarda el hash (scrypt). La contraseña no se escribe en
// ningún sitio: ni en pantalla, ni en ficheros, ni en el historial de la
// terminal (por eso no hay --clave=…). Al usar --clave-desde-entorno, pon la
// variable solo para esa orden y bórrala después (ver docs/06-app-web.md).

const { cargarEnv, leerArgs } = require('../src/config');
const { configuracionBD, obtenerPool, cerrarPool } = require('../src/bd/conexion');
const usuarios = require('../src/bd/usuarios');

// Una línea de la terminal, con eco (visible) o sin él (contraseñas).
function leerLinea(texto, { oculto = false } = {}) {
  return new Promise((resolver, rechazar) => {
    const entrada = process.stdin;
    process.stdout.write(texto);
    if (!oculto) {
      const readline = require('readline');
      const rl = readline.createInterface({ input: entrada, output: process.stdout, terminal: true });
      rl.once('line', l => { rl.close(); resolver(l); });
      rl.once('SIGINT', () => { rl.close(); rechazar(new Error('Cancelado.')); });
      return;
    }
    let valor = '';
    entrada.setRawMode(true);
    entrada.resume();
    entrada.setEncoding('utf8');
    const alTeclear = trozo => {
      for (const c of trozo) {
        if (c === '\r' || c === '\n' || c === '\u0004') { terminar(); resolver(valor); return; }
        if (c === '\u0003') { terminar(); rechazar(new Error('Cancelado.')); return; }
        if (c === '\u007f' || c === '\b') { valor = [...valor].slice(0, -1).join(''); continue; }
        if (c >= ' ') valor += c;
      }
    };
    function terminar() {
      entrada.removeListener('data', alTeclear);
      entrada.setRawMode(false);
      entrada.pause();
      process.stdout.write('\n');
    }
    entrada.on('data', alTeclear);
  });
}

async function main() {
  cargarEnv();
  const args = leerArgs();
  const cfg = configuracionBD(process.env);
  if (!cfg) {
    console.error('Faltan DB_USUARIO y DB_NOMBRE en el .env. Ver docs/06-app-web.md.');
    return 1;
  }
  const hayTeclado = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const variable = typeof args['clave-desde-entorno'] === 'string' ? args['clave-desde-entorno'].trim() : '';
  if (args['clave-desde-entorno'] !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable)) {
    console.error('--clave-desde-entorno necesita el NOMBRE de una variable: --clave-desde-entorno=MESA_CLAVE_NUEVA');
    return 1;
  }
  if (!variable && !hayTeclado) {
    console.error('Sin terminal no se puede pedir la contraseña: usa --usuario=… --clave-desde-entorno=VARIABLE.');
    return 1;
  }

  let usuario = typeof args.usuario === 'string' ? args.usuario : '';
  if (!usuario) {
    if (!hayTeclado) { console.error('Falta --usuario=…'); return 1; }
    usuario = await leerLinea('Usuario: ');
  }
  usuario = usuarios.validarUsuario(usuario);

  let clave;
  if (variable) {
    clave = process.env[variable];
    if (clave === undefined || clave === '') {
      console.error(`La variable ${variable} no está puesta o está vacía.`);
      return 1;
    }
  } else {
    clave = await leerLinea(`Contraseña para ${usuario} (al menos ${usuarios.CLAVE_MINIMA} caracteres; no se ve al escribir): `, { oculto: true });
    usuarios.validarClave(clave);
    const otra = await leerLinea('Repítela: ', { oculto: true });
    if (otra !== clave) {
      console.error('Las dos contraseñas no coinciden. No se ha guardado nada.');
      return 1;
    }
  }
  usuarios.validarClave(clave);

  const pool = obtenerPool(cfg);
  try {
    if (await usuarios.existeUsuario(pool, usuario)) {
      let cambiar = Boolean(args.cambiar);
      if (!cambiar && hayTeclado && !variable) {
        const r = (await leerLinea(`El usuario «${usuario}» ya existe. ¿Cambiarle la contraseña? Escribe «si»: `)).trim().toLowerCase();
        cambiar = r === 'si' || r === 'sí' || r === 's';
      }
      if (!cambiar) {
        console.error(`El usuario «${usuario}» ya existe. Para cambiarle la contraseña, añade --cambiar.`);
        return 1;
      }
      await usuarios.cambiarClave(pool, { usuario, clave });
      console.log(`OK contraseña de «${usuario}» cambiada. Sus sesiones abiertas se han cerrado.`);
      return 0;
    }
    const { usuarioId } = await usuarios.crearUsuario(pool, { usuario, clave });
    console.log(`OK usuario «${usuario}» creado (id ${usuarioId}). En la base solo está el hash de la contraseña.`);
    return 0;
  } finally {
    clave = null;
    await cerrarPool();
  }
}

main().then(c => process.exit(c), e => {
  // El mensaje de error nunca lleva la contraseña: solo textos propios o de la base.
  console.error(`FALLO: ${e.message}`);
  process.exit(1);
});
