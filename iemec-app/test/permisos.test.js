'use strict';
// Permisos por rol: la tabla (servidor/permisos.js) y cómo se aplica en las rutas del panel, con una
// sesión de verdad para cada rol. Y la gestión del equipo: dar de alta, cambiar el rol, desactivar,
// sin quedarse nunca sin nadie que pueda gestionarlo. Personas y correos, inventados.
const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararBdDePrueba } = require('./ayuda-bd');
const { ROLES, PERMISOS, puede, permisosDe, exige } = require('../servidor/permisos');
const { ENTORNO, ponerEntorno, conServidor, appConReloj, personaConSesion, tokenDe, cliente, entrar } = require('./ayuda-acceso');

const T0 = new Date('2026-10-06T08:00:00Z');

test('la tabla de permisos', () => {
  for (const [permiso, { roles, que }] of Object.entries(PERMISOS)) {
    assert.ok(roles.length && roles.every((r) => ROLES.includes(r)), `${permiso}: roles que existen`);
    assert.ok(que, `${permiso}: dice qué permite`);
  }
  const quien = (permiso) => ROLES.filter((r) => puede(r, permiso));
  assert.deepEqual(quien('usuarios.gestionar'), ['direccion', 'admin']);
  assert.deepEqual(quien('ofertas.gestionar'), ['direccion', 'admin']);
  assert.deepEqual(quien('resenas.aprobar'), ['direccion', 'marketing']);
  assert.deepEqual(quien('salas.editar'), ['direccion', 'admin']);
  for (const deTodos of ['citas.estado', 'conversaciones.atender']) assert.deepEqual(quien(deTodos), ROLES, deTodos);
  assert.equal(puede(undefined, 'citas.estado'), false, 'sin rol, nada');
  assert.equal(puede('direccion', 'no.existe'), false);
  assert.ok(!permisosDe('recepcion').includes('usuarios.gestionar'));
  assert.throws(() => exige('usuarios.gestinar'), /Permiso desconocido/, 'una errata salta al arrancar');
});

test('permisos por rol en las rutas del panel y gestión del equipo', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const restaurar = ponerEntorno(ENTORNO);
  const reloj = { ahora: T0 };
  try {
    await pool.query("INSERT INTO familias (codigo, nombre) VALUES ('facial', 'Facial')");
    await pool.query("INSERT INTO tratamientos (id, nombre, familia, duracion_min, regimen_legal) VALUES ('limpieza-facial', 'Limpieza facial', 'facial', 60, 'cosmetico')");
    await pool.query("INSERT INTO salas (id, codigo, nombre, tipo) VALUES (1, 'cabina-1', 'Cabina 1', 'cabina_estetica')");
    await conServidor(appConReloj(pool, reloj), async (base) => {
      const equipo = {};
      for (const [i, rol] of ROLES.entries()) {
        equipo[rol] = await personaConSesion(pool, base, { email: `${rol}@ejemplo.com`, nombre: `${rol} prueba`, rol, ahora: T0, ip: `198.51.100.${i + 1}` });
      }
      const resena = async () => (await pool.query(
        "INSERT INTO resenas (google_id, autor, nota, texto, publicada_en, borrador_respuesta, estado) VALUES (UUID(), 'Autora Inventada', 5, 'Muy bien', ?, '¡Gracias por tu reseña!', 'borrador')", [T0]))[0].insertId;

      await t.test('cada rol ve en su sesión lo que puede hacer', async () => {
        for (const rol of ROLES) {
          const s = await equipo[rol].c.pedir('/api/sesion');
          assert.deepEqual(s.json.permisos, permisosDe(rol), rol);
        }
      });

      await t.test('rutas de dirección, admin o marketing: 403 claro para el resto', async () => {
        const casos = [
          { nombre: 'aprobar una reseña', puede: ['direccion', 'marketing'], pedir: async (c) => c.pedir(`/api/panel/resenas/${await resena()}/publicar`, { metodo: 'POST', cuerpo: {} }) },
          { nombre: 'cambiar salas y tratamientos', puede: ['direccion', 'admin'], pedir: (c) => c.pedir('/api/panel/ajustes/salas-tratamientos/limpieza-facial', { metodo: 'PUT', cuerpo: { salas: [1] } }) },
          { nombre: 'ver el equipo', puede: ['direccion', 'admin'], pedir: (c) => c.pedir('/api/panel/equipo') },
          { nombre: 'dar de alta', puede: ['direccion', 'admin'], pedir: (c, rol) => c.pedir('/api/panel/equipo', { metodo: 'POST', cuerpo: { email: `nuevo-${rol}@ejemplo.com`, nombre: 'Nueva Persona', rol: 'recepcion' } }) },
        ];
        for (const caso of casos) {
          for (const rol of ROLES) {
            const r = await caso.pedir(equipo[rol].c, rol);
            if (caso.puede.includes(rol)) {
              assert.ok([200, 201].includes(r.status), `${caso.nombre} · ${rol}: ${r.status} ${JSON.stringify(r.json)}`);
            } else {
              assert.deepEqual([r.status, r.json.codigo], [403, 'SIN_PERMISO'], `${caso.nombre} · ${rol}`);
              assert.match(r.json.error, /^Con el rol de .+ no se puede .+: lo hace .+\.$/);
            }
          }
        }
        const r = await equipo.recepcion.c.pedir(`/api/panel/resenas/${await resena()}/publicar`, { metodo: 'POST', cuerpo: {} });
        assert.equal(r.json.error, 'Con el rol de recepción no se puede aprobar y publicar respuestas a reseñas: lo hace dirección o marketing.');
        const [[aprobadas]] = await pool.query("SELECT COUNT(*) AS n FROM resenas WHERE estado = 'publicada'");
        assert.equal(aprobadas.n, 2, 'solo las de dirección y marketing');
      });

      await t.test('estados de cita, conversaciones y tareas: todo el personal', async () => {
        const [conv] = await pool.query("INSERT INTO conversaciones (telefono, estado) VALUES ('+34611000901', 'espera_persona')");
        for (const rol of ROLES) {
          const c = equipo[rol].c;
          assert.equal((await c.pedir('/api/panel/citas/999999/estado', { metodo: 'POST', cuerpo: { estado: 'llegada' } })).status, 404, `${rol}: pasa (y la cita no existe)`);
          assert.equal((await c.pedir(`/api/panel/conversaciones/${conv.insertId}/tomar`, { metodo: 'POST', cuerpo: {} })).status, 200, rol);
          assert.equal((await c.pedir('/api/panel/tareas/999999', { metodo: 'POST', cuerpo: { estado: 'hecha' } })).status, 404, rol);
          assert.equal((await c.pedir('/api/panel/hoy')).status, 200, rol);
        }
        const [ev] = await pool.query("SELECT actor FROM eventos WHERE tipo = 'conversacion_tomar' ORDER BY id DESC LIMIT 1");
        assert.equal(ev[0].actor, 'admin@ejemplo.com', 'queda quién fue');
      });

      await t.test('dar de alta: el enlace sale una vez; correo repetido, rol o datos que no valen', async () => {
        const dir = equipo.direccion.c;
        const r = await dir.pedir('/api/panel/equipo', { metodo: 'POST', cuerpo: { email: 'Nueva@Ejemplo.com', nombre: 'Nueva  Recepcionista', rol: 'recepcion' } });
        assert.equal(r.status, 201, JSON.stringify(r.json));
        assert.match(r.json.enlace, /^http:\/\/localhost:3004\/#alta\/[A-Za-z0-9_-]{43}$/);
        assert.deepEqual([r.json.usuario.email, r.json.usuario.nombre], ['nueva@ejemplo.com', 'Nueva Recepcionista']);
        const lista = await dir.pedir('/api/panel/equipo');
        assert.deepEqual(lista.json.roles.map((r) => r.nombre), ['dirección', 'recepción', 'médico', 'estética', 'marketing', 'administración']);
        assert.ok(lista.json.permisos.some((p) => p.id === 'ofertas.gestionar' && p.roles.join() === 'direccion,admin'));
        const nueva = lista.json.usuarios.find((u) => u.email === 'nueva@ejemplo.com');
        assert.equal(new Date(nueva.invitacionHasta).getTime(), T0.getTime() + 24 * 3600000, 'enlace pendiente hasta mañana');
        assert.deepEqual(nueva.passkeys, []);
        assert.ok(!JSON.stringify(lista.json).includes(tokenDe(r.json.enlace)), 'el token no vuelve a salir');
        assert.equal(lista.json.yo, equipo.direccion.usuario.id);
        const direccion = lista.json.usuarios.find((u) => u.email === 'direccion@ejemplo.com');
        assert.deepEqual(direccion.passkeys.map((p) => p.dispositivo), ['Móvil de prueba']);

        const mal = async (cuerpo) => (await dir.pedir('/api/panel/equipo', { metodo: 'POST', cuerpo })).json.codigo;
        assert.equal(await mal({ email: 'nueva@ejemplo.com', nombre: 'Otra', rol: 'medico' }), 'EMAIL_EN_USO');
        assert.equal(await mal({ email: 'NUEVA@ejemplo.com ', nombre: 'Otra', rol: 'medico' }), 'EMAIL_EN_USO');
        assert.equal(await mal({ email: 'no-es-un-correo', nombre: 'Otra', rol: 'medico' }), 'EMAIL_NO_VALIDO');
        assert.equal(await mal({ email: 'otra@ejemplo.com', nombre: '   ', rol: 'medico' }), 'NOMBRE_VACIO');
        assert.equal(await mal({ email: 'otra@ejemplo.com', nombre: 'Otra', rol: 'superusuario' }), 'ROL_DESCONOCIDO');
        assert.equal((await dir.pedir('/api/panel/equipo/abc', { metodo: 'PATCH', cuerpo: { rol: 'medico' } })).status, 404);
        assert.equal((await dir.pedir('/api/panel/equipo/9999', { metodo: 'PATCH', cuerpo: { rol: 'medico' } })).json.codigo, 'USUARIO_DESCONOCIDO');
        assert.equal((await dir.pedir(`/api/panel/equipo/${nueva.id}`, { metodo: 'PATCH', cuerpo: { rol: 'jefe' } })).json.codigo, 'ROL_DESCONOCIDO');
      });

      await t.test('a dirección solo la gestiona dirección, nadie se desactiva a sí mismo y siempre queda alguien de dirección', async () => {
        const dir = equipo.direccion;
        const adm = equipo.admin;
        const cambiar = (c, u, cuerpo) => c.pedir(`/api/panel/equipo/${u.usuario.id}`, { metodo: 'PATCH', cuerpo });
        assert.equal((await cambiar(dir.c, dir, { activo: false })).json.codigo, 'NO_A_TI_MISMO');
        // La única de dirección no deja de serlo, aunque administración siga activa.
        const bajar = await cambiar(dir.c, dir, { rol: 'recepcion' });
        assert.deepEqual([bajar.status, bajar.json.codigo], [409, 'ULTIMA_DIRECCION']);
        // Administración no toca a dirección (ni rol, ni desactivarla, ni enlace nuevo, ni sus passkeys, ni
        // sus sesiones) ni da ese rol, tampoco a sí misma: sería quedarse con la cuenta de dirección.
        const [[pkDir]] = await pool.query('SELECT id FROM passkeys WHERE usuario_id = ?', [dir.usuario.id]);
        const intentos = [
          await cambiar(adm.c, dir, { activo: false }),
          await cambiar(adm.c, dir, { rol: 'recepcion' }),
          await cambiar(adm.c, adm, { rol: 'direccion' }),
          await adm.c.pedir(`/api/panel/equipo/${dir.usuario.id}/invitacion`, { metodo: 'POST' }),
          await adm.c.pedir(`/api/panel/equipo/${dir.usuario.id}/passkeys/${pkDir.id}`, { metodo: 'DELETE' }),
          await adm.c.pedir(`/api/panel/equipo/${dir.usuario.id}/cerrar-sesiones`, { metodo: 'POST' }),
          await adm.c.pedir('/api/panel/equipo', { metodo: 'POST', cuerpo: { email: 'otra.direccion@ejemplo.com', nombre: 'Otra Dirección', rol: 'direccion' } }),
        ];
        for (const r of intentos) assert.deepEqual([r.status, r.json.codigo], [403, 'SOLO_DIRECCION']);
        assert.equal(intentos[0].json.error, 'A las personas de dirección, y el rol de dirección, solo los gestiona dirección.');
        assert.equal((await dir.c.pedir('/api/panel/hoy')).status, 200, 'dirección sigue dentro, con su passkey');
        assert.equal((await adm.c.pedir('/api/sesion')).json.rol, 'admin');
        // Dirección sí gestiona a administración: la desactiva (su sesión se acaba) y la reactiva (vuelve a entrar).
        assert.equal((await cambiar(dir.c, adm, { activo: false })).status, 200);
        assert.equal((await adm.c.pedir('/api/panel/hoy')).status, 401);
        assert.equal((await cambiar(dir.c, adm, { activo: true })).status, 200);
        assert.equal((await entrar(adm.c, adm.aut)).status, 200);
        // Con otra persona de dirección, la primera ya puede dejar de serlo (y deja de gestionar el equipo).
        assert.equal((await dir.c.pedir('/api/panel/equipo', { metodo: 'POST', cuerpo: { email: 'segunda.direccion@ejemplo.com', nombre: 'Segunda Dirección', rol: 'direccion' } })).status, 201);
        assert.equal((await cambiar(dir.c, dir, { rol: 'recepcion' })).status, 200);
        assert.equal((await dir.c.pedir('/api/sesion')).json.rol, 'recepcion');
        assert.equal((await dir.c.pedir('/api/panel/equipo')).status, 403);
        // Administración, con quien no es de dirección, sí: cerrar sus sesiones.
        const med = equipo.medico;
        assert.equal((await adm.c.pedir(`/api/panel/equipo/${med.usuario.id}/cerrar-sesiones`, { metodo: 'POST' })).status, 200);
        assert.equal((await med.c.pedir('/api/panel/hoy')).status, 401);
        assert.equal((await adm.c.pedir('/api/panel/hoy')).status, 200);
      });

      await t.test('la demostración no tiene passkeys propias ni sesión que cerrar', async () => {
        const fuera = ponerEntorno({ MODO_DEMO: '1' });
        try {
          const demo = cliente(base);
          const s = await demo.pedir('/api/sesion');
          assert.deepEqual([s.status, s.json.nombre, s.json.rol, s.json.demo, s.json.id], [200, 'Demostración', 'direccion', true, null]);
          assert.equal((await demo.pedir('/api/panel/passkeys')).json.codigo, 'SIN_USUARIO');
          assert.equal((await demo.pedir('/api/panel/equipo')).status, 200, 'pero ve el equipo, como dirección');
        } finally { fuera(); }
      });
    });
  } finally {
    restaurar();
    await pool.end();
  }
});
