'use strict';
// Permisos por rol: la tabla (servidor/permisos.js) y cómo se aplica en las rutas del panel, con una
// sesión de verdad para cada rol. Y la gestión del equipo: dar de alta, cambiar el rol, desactivar,
// sin quedarse nunca sin nadie que pueda gestionarlo. Personas y correos, inventados.
const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararBdDePrueba } = require('./ayuda-bd');
const acceso = require('../servidor/acceso');
const { ROLES, PERMISOS, puede, permisosDe, exige } = require('../servidor/permisos');
const {
  ORIGEN, ENTORNO, ponerEntorno, conServidor, appConReloj, personaConSesion, tokenDe, cliente, entrar, darDeAlta, Autenticador,
} = require('./ayuda-acceso');

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
      // La alerta clínica de una reseña la marca el servicio de reseñas (su columna llega con la migración
      // de las reseñas con las normas de Google); si esta base aún no la tiene, se añade aquí para probar
      // la regla.
      await pool.query('ALTER TABLE resenas ADD COLUMN IF NOT EXISTS alerta_clinica BOOLEAN NOT NULL DEFAULT FALSE');
      const resena = async ({ alerta = false } = {}) => (await pool.query(
        "INSERT INTO resenas (google_id, autor, nota, texto, publicada_en, borrador_respuesta, estado, alerta_clinica) VALUES (UUID(), 'Autora Inventada', ?, 'Muy bien', ?, '¡Gracias por tu reseña!', 'borrador', ?)",
        [alerta ? 2 : 5, T0, alerta]))[0].insertId;
      const [conv] = await pool.query("INSERT INTO conversaciones (telefono, estado) VALUES ('+34611000901', 'espera_persona')");

      // Una ruta por cada permiso de la tabla. Con el permiso, la ruta sigue y responde lo suyo (404 si la
      // cita no existe, 400 si falta algo…); sin él, 403. Sale de PERMISOS: un permiso nuevo necesita aquí
      // su ruta, y si la tabla cambia, cambia lo que se comprueba.
      const RUTAS = {
        'citas.estado': (c) => c.pedir('/api/panel/citas/999999/estado', { metodo: 'POST', cuerpo: { estado: 'llegada' } }),
        'citas.reservar': (c) => c.pedir('/api/panel/citas', { metodo: 'POST', cuerpo: { tratamientoId: 'no-existe' } }),
        'conversaciones.atender': (c) => c.pedir(`/api/panel/conversaciones/${conv.insertId}`),
        'tareas.cerrar': (c) => c.pedir('/api/panel/tareas/999999', { metodo: 'POST', cuerpo: { estado: 'hecha' } }),
        'seguimientos.editar': (c) => c.pedir('/api/panel/seguimientos/999999', { metodo: 'PATCH', cuerpo: {} }),
        'resenas.aprobar': async (c) => c.pedir(`/api/panel/resenas/${await resena()}/publicar`, { metodo: 'POST', cuerpo: {} }),
        'resenas.alerta_clinica': async (c) => c.pedir(`/api/panel/resenas/${await resena({ alerta: true })}/publicar`, { metodo: 'POST', cuerpo: {} }),
        'salas.editar': (c) => c.pedir('/api/panel/ajustes/salas-tratamientos/limpieza-facial', { metodo: 'PUT', cuerpo: { salas: [1] } }),
        'usuarios.gestionar': (c) => c.pedir('/api/panel/equipo'),
      };
      const SIN_RUTA = ['ofertas.gestionar']; // su pantalla está por hacer
      const comprobar = (r, rol, permiso, tiene) => {
        const que = `${permiso} · ${rol}: ${r.status} ${JSON.stringify(r.json)}`;
        if (tiene) return assert.ok(r.status !== 403 && r.status < 500, que);
        assert.deepEqual([r.status, r.json.codigo, r.json.permiso], [403, 'SIN_PERMISO', permiso], que);
        return assert.match(r.json.error, /^Con el rol de .+ no se puede .+: lo hace .+\.$/);
      };

      await t.test('cada rol ve en su sesión lo que puede hacer', async () => {
        for (const rol of ROLES) {
          const s = await equipo[rol].c.pedir('/api/sesion');
          assert.deepEqual(s.json.permisos, permisosDe(rol), rol);
        }
      });

      await t.test('cada permiso de la tabla en su ruta: pasa quien lo tiene y el resto recibe un 403 claro', async () => {
        assert.deepEqual(Object.keys(PERMISOS).sort(), [...Object.keys(RUTAS), ...SIN_RUTA].sort(), 'cada permiso con su ruta en esta prueba');
        for (const [permiso, pedir] of Object.entries(RUTAS)) {
          for (const rol of ROLES) comprobar(await pedir(equipo[rol].c), rol, permiso, puede(rol, permiso));
        }
        const id = await resena();
        const r = await equipo.recepcion.c.pedir(`/api/panel/resenas/${id}/publicar`, { metodo: 'POST', cuerpo: {} });
        assert.equal(r.json.error, 'Con el rol de recepción no se puede aprobar y publicar respuestas a reseñas: lo hace dirección o marketing.');
        assert.equal((await pool.query('SELECT estado FROM resenas WHERE id = ?', [id]))[0][0].estado, 'borrador', 'no ha cambiado nada');
        const [ev] = await pool.query("SELECT actor FROM eventos WHERE tipo = 'ajuste_salas_tratamiento' ORDER BY id DESC LIMIT 1");
        assert.equal(ev[0].actor, 'admin@ejemplo.com', 'queda quién fue');
      });

      // La reseña con alerta clínica (una posible complicación, una reclamación) la contesta dirección médica,
      // no marketing; las demás, dirección o marketing.
      await t.test('la reseña con alerta clínica la contesta dirección médica', async () => {
        const quien = async (alerta) => {
          const pasan = [];
          for (const rol of ROLES) if ((await equipo[rol].c.pedir(`/api/panel/resenas/${await resena({ alerta })}/publicar`, { metodo: 'POST', cuerpo: {} })).status !== 403) pasan.push(rol);
          return pasan;
        };
        assert.deepEqual(await quien(true), ['direccion', 'medico', 'admin']);
        assert.deepEqual(await quien(false), ['direccion', 'marketing']);
        const r = await equipo.marketing.c.pedir(`/api/panel/resenas/${await resena({ alerta: true })}/publicar`, { metodo: 'POST', cuerpo: {} });
        assert.equal(r.json.error, 'Con el rol de marketing no se puede contestar reseñas con alerta clínica: lo hace dirección, médico o administración.');
      });

      // Si la tabla le quita un permiso a un rol, el servidor se lo niega en ese momento (no solo el panel deja
      // de enseñarlo): p. ej., si el DPO decide que marketing no atienda conversaciones, ni las lee ni contesta.
      await t.test('la tabla manda: quitarle un permiso a un rol se lo niega en el servidor', async () => {
        for (const [permiso, pedir] of Object.entries(RUTAS)) {
          const antes = PERMISOS[permiso].roles;
          try {
            for (const rol of antes) {
              PERMISOS[permiso].roles = antes.filter((x) => x !== rol);
              comprobar(await pedir(equipo[rol].c), rol, permiso, false);
            }
          } finally { PERMISOS[permiso].roles = antes; }
        }
        const antes = PERMISOS['conversaciones.atender'].roles;
        PERMISOS['conversaciones.atender'].roles = antes.filter((x) => x !== 'marketing');
        try {
          const c = equipo.marketing.c;
          const intentos = [
            await c.pedir('/api/panel/conversaciones'),
            await c.pedir(`/api/panel/conversaciones/${conv.insertId}`),
            await c.pedir(`/api/panel/conversaciones/${conv.insertId}/tomar`, { metodo: 'POST', cuerpo: {} }),
            await c.pedir(`/api/panel/conversaciones/${conv.insertId}/enviar`, { metodo: 'POST', cuerpo: { texto: 'Hola' } }),
          ];
          for (const r of intentos) assert.deepEqual([r.status, r.json.permiso], [403, 'conversaciones.atender']);
          assert.ok(!(await c.pedir('/api/sesion')).json.permisos.includes('conversaciones.atender'), 'y el panel deja de enseñárselas');
          assert.equal((await equipo.recepcion.c.pedir(`/api/panel/conversaciones/${conv.insertId}`)).status, 200, 'recepción, sí');
        } finally { PERMISOS['conversaciones.atender'].roles = antes; }
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

      // Administración ve los enlaces que crea: si la persona pasa después a dirección, ese enlace no puede
      // servir para dejar una passkey en una cuenta de dirección.
      let dir;
      await t.test('al pasar a dirección, los enlaces que dio administración dejan de valer', async () => {
        dir = await personaConSesion(pool, base, { email: 'tercera.direccion@ejemplo.com', nombre: 'Tercera Dirección', rol: 'direccion', ahora: T0, ip: '198.51.100.30' });
        const adm = equipo.admin;
        const alta = await adm.c.pedir('/api/panel/equipo', { metodo: 'POST', cuerpo: { email: 'codir@ejemplo.com', nombre: 'Codirectora Prueba', rol: 'recepcion' } });
        assert.equal(alta.status, 201, JSON.stringify(alta.json));
        const { id } = alta.json.usuario;
        const token = tokenDe(alta.json.enlace);
        // Administración abre el enlace antes de tiempo y se guarda la respuesta firmada para después.
        const suya = cliente(base, { ip: '198.51.100.40' });
        const op = await suya.pedir('/api/acceso/alta/opciones', { metodo: 'POST', cuerpo: { token } });
        const preparada = new Autenticador({ origen: ORIGEN }).registrar(op.json);
        // Dirección la asciende: los enlaces de administración se anulan en ese momento.
        const sube = await dir.c.pedir(`/api/panel/equipo/${id}`, { metodo: 'PATCH', cuerpo: { rol: 'direccion' } });
        assert.equal(sube.status, 200, JSON.stringify(sube.json));
        const [ev] = (await pool.query("SELECT datos FROM eventos WHERE tipo = 'usuario_rol_cambiado' AND entidad_id = ?", [String(id)]))[0];
        assert.deepEqual(typeof ev.datos === 'string' ? JSON.parse(ev.datos) : ev.datos, { de: 'recepcion', a: 'direccion', enlacesAnulados: 1, passkeys: [] });
        assert.equal((await adm.c.pedir(`/api/panel/equipo/${id}/invitacion`, { metodo: 'POST' })).json.codigo, 'SOLO_DIRECCION');
        for (const ruta of ['/api/acceso/invitacion', '/api/acceso/alta/opciones']) {
          const r = await suya.pedir(ruta, { metodo: 'POST', cuerpo: { token } });
          assert.deepEqual([r.status, r.json.codigo], [410, 'INVITACION_ANULADA'], ruta);
        }
        const tarde = await suya.pedir('/api/acceso/alta', { metodo: 'POST', cuerpo: { token, respuesta: preparada } });
        assert.deepEqual([tarde.status, tarde.json.codigo], [410, 'INVITACION_ANULADA']);
        assert.equal((await suya.pedir('/api/sesion')).status, 401);
        assert.equal((await pool.query('SELECT COUNT(*) AS n FROM passkeys WHERE usuario_id = ?', [id]))[0][0].n, 0, 'ninguna passkey en su cuenta');
        // Aunque un enlace de administración siguiera vivo (puesto a mano en la base), no estrena una cuenta
        // de dirección.
        await pool.query('UPDATE invitaciones SET anulada_en = NULL WHERE usuario_id = ?', [id]);
        assert.equal((await suya.pedir('/api/acceso/invitacion', { metodo: 'POST', cuerpo: { token } })).json.codigo, 'INVITACION_ANULADA');
        await pool.query('UPDATE invitaciones SET anulada_en = ? WHERE usuario_id = ?', [T0, id]);
        // El enlace que da dirección sí vale, y también sobrevive a un ascenso.
        const bueno = await dir.c.pedir(`/api/panel/equipo/${id}/invitacion`, { metodo: 'POST' });
        assert.equal(bueno.status, 201);
        const codir = cliente(base, { ip: '198.51.100.41' });
        assert.equal((await darDeAlta(codir, new Autenticador({ origen: ORIGEN }), tokenDe(bueno.json.enlace))).status, 201);
        assert.equal((await codir.pedir('/api/sesion')).json.rol, 'direccion');
        const otra = await dir.c.pedir('/api/panel/equipo', { metodo: 'POST', cuerpo: { email: 'futura@ejemplo.com', nombre: 'Futura Directora', rol: 'medico' } });
        assert.equal((await dir.c.pedir(`/api/panel/equipo/${otra.json.usuario.id}`, { metodo: 'PATCH', cuerpo: { rol: 'direccion' } })).status, 200);
        assert.equal((await cliente(base).pedir('/api/acceso/invitacion', { metodo: 'POST', cuerpo: { token: tokenDe(otra.json.enlace) } })).status, 200, 'el de dirección sigue valiendo');
      });

      // Dos cambios a la vez sobre personas de dirección se esperan el uno al otro: MariaDB no tiene que
      // deshacer ninguno por un bloqueo cruzado (que llegaba al panel como un 500).
      await t.test('dos personas de dirección que se quitan la una a la otra a la vez: una se queda', async () => {
        const [a, b] = [dir.usuario.id, (await pool.query("SELECT id FROM usuarios WHERE email = 'codir@ejemplo.com'"))[0][0].id];
        await pool.query("UPDATE usuarios SET activo = FALSE WHERE rol = 'direccion' AND id NOT IN (?, ?)", [a, b]);
        try {
          for (const cambio of [{ activo: false }, { rol: 'recepcion' }]) {
            for (let ronda = 0; ronda < 8; ronda++) {
              const r = await Promise.allSettled([
                acceso.cambiarUsuario(pool, { id: b, ...cambio, actor: 'a@ejemplo.com', actorId: a, actorRol: 'direccion' }),
                acceso.cambiarUsuario(pool, { id: a, ...cambio, actor: 'b@ejemplo.com', actorId: b, actorRol: 'direccion' }),
              ]);
              const fallos = r.filter((x) => x.status === 'rejected').map((x) => x.reason.codigo || x.reason.code || x.reason.message);
              assert.deepEqual(fallos, ['ULTIMA_DIRECCION'], `${JSON.stringify(cambio)}, ronda ${ronda}`);
              const [[n]] = await pool.query("SELECT COUNT(*) AS n FROM usuarios WHERE rol = 'direccion' AND activo AND id IN (?, ?)", [a, b]);
              assert.equal(n.n, 1);
              await pool.query("UPDATE usuarios SET activo = TRUE, rol = 'direccion' WHERE id IN (?, ?)", [a, b]);
            }
          }
        } finally {
          await pool.query("UPDATE usuarios SET activo = TRUE WHERE rol = 'direccion'");
        }
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
