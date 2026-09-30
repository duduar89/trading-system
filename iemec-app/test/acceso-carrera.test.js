'use strict';
// El alta con el enlace y dirección que, justo a la vez, desactiva a esa persona o le manda otro
// enlace. Las dos cosas borran sus retos de alta: si pasa entre leer el enlace y gastar el reto, el
// alta tiene que decir lo que ha pasado de verdad (enlace anulado o sustituido) y no «esa respuesta ya
// se ha usado». Con la máquina cargada la prueba de concurrencia de acceso.test.js lo pillaba a veces;
// aquí se fuerza ese orden cada vez, metiendo el cambio de dirección justo antes de gastar el reto.
const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararBdDePrueba } = require('./ayuda-bd');
const acceso = require('../servidor/acceso');
const { ENTORNO, ponerEntorno, tokenDe, Autenticador, ORIGEN } = require('./ayuda-acceso');

const T0 = new Date('2026-10-06T08:00:00Z');

// Un pool que, la primera vez que se va a gastar un reto, hace antes lo que se le pida (con otra
// conexión, como otra petición que llega a la vez).
function conCambioAntesDeGastar(pool, cambio) {
  let hecho = false;
  return new Proxy(pool, {
    get(obj, prop) {
      if (prop !== 'query') return typeof obj[prop] === 'function' ? obj[prop].bind(obj) : obj[prop];
      return async (sql, ...resto) => {
        if (!hecho && typeof sql === 'string' && sql.startsWith('DELETE FROM retos_webauthn WHERE reto = ?')) {
          hecho = true;
          await cambio();
        }
        return obj.query(sql, ...resto);
      };
    },
  });
}

test('alta con el enlace mientras dirección desactiva a la persona o le manda otro enlace', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const restaurar = ponerEntorno(ENTORNO);
  try {
    const dir = await acceso.crearUsuario(pool, { email: 'direccion@ejemplo.com', nombre: 'Dirección Prueba', rol: 'direccion', actor: 'consola', ahora: T0 });

    const preparar = async (email) => {
      const x = await acceso.crearUsuario(pool, { email, nombre: 'Cruce Prueba', rol: 'recepcion', actor: 'pruebas', ahora: T0 });
      const token = tokenDe(x.enlace);
      const opciones = await acceso.opcionesAlta(pool, { token, ahora: T0 });
      return { id: x.usuario.id, token, respuesta: new Autenticador({ origen: ORIGEN }).registrar(opciones) };
    };
    const altaCon = (p, x) => acceso.completarAlta(p, { token: x.token, respuesta: x.respuesta, dispositivo: 'Prueba', ahora: T0 });

    await t.test('la desactivan entre leer su enlace y gastar su reto: «enlace anulado»', async () => {
      const x = await preparar('carrera1@ejemplo.com');
      const p = conCambioAntesDeGastar(pool, () => acceso.cambiarUsuario(pool, { id: x.id, activo: false, actor: 'direccion@ejemplo.com', actorId: dir.usuario.id, actorRol: 'direccion', ahora: T0 }));
      await assert.rejects(altaCon(p, x), (err) => err.codigo === 'INVITACION_ANULADA');
      const [[n]] = await pool.query('SELECT COUNT(*) AS n FROM passkeys WHERE usuario_id = ?', [x.id]);
      assert.equal(n.n, 0, 'no se guarda ninguna passkey');
    });

    await t.test('le mandan otro enlace entre leer el suyo y gastar su reto: «enlace sustituido»', async () => {
      const x = await preparar('carrera2@ejemplo.com');
      const p = conCambioAntesDeGastar(pool, () => acceso.invitar(pool, { usuarioId: x.id, actor: 'direccion@ejemplo.com', actorRol: 'direccion', ahora: T0 }));
      await assert.rejects(altaCon(p, x), (err) => err.codigo === 'INVITACION_SUSTITUIDA');
    });

    await t.test('sin nadie en medio, el alta sale bien; y una respuesta que no es suya sigue siendo «ya se ha usado»', async () => {
      const x = await preparar('carrera3@ejemplo.com');
      const r = await altaCon(pool, x);
      assert.equal(r.usuario.id, x.id);
      const y = await preparar('carrera4@ejemplo.com');
      await assert.rejects(acceso.completarAlta(pool, { token: y.token, respuesta: x.respuesta, dispositivo: 'Prueba', ahora: T0 }), (err) => err.codigo === 'RETO_NO_VALE');
    });
  } finally {
    restaurar();
    await pool.end();
  }
});
