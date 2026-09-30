'use strict';
// Acceso del personal con passkeys, con peticiones de verdad al puerto y un autenticador simulado que
// firma como el del móvil: alta por invitación, entrar sin escribir el correo, el contador, la
// credencial de otro, retos caducados o repetidos, enlaces usados o caducados, usuarios desactivados,
// varias passkeys y borrar una perdida, y cuánto dura la sesión. Personas y correos, inventados.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');
const { execFileSync } = require('child_process');
const { prepararBdDePrueba, BD_PRUEBAS } = require('./ayuda-bd');
const acceso = require('../servidor/acceso');
const { firmar } = require('../servidor/sesion');
const {
  ORIGEN, ENTORNO, ponerEntorno, conServidor, appConReloj, cliente, tokenDe, darDeAlta, entrar, personaConSesion, Autenticador,
} = require('./ayuda-acceso');

const T0 = new Date('2026-10-06T08:00:00Z'); // martes, 10:00 en Madrid
const mas = (min) => new Date(T0.getTime() + min * 60000);
const json = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

test('passkeys del personal', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const restaurar = ponerEntorno(ENTORNO);
  const reloj = { ahora: T0 };
  const q = async (sql, a = []) => (await pool.query(sql, a))[0];
  const eventos = async (tipo) => q('SELECT * FROM eventos WHERE tipo = ? ORDER BY id', [tipo]);
  try {
    await conServidor(appConReloj(pool, reloj), async (base) => {
      // Dirección, la primera: se da de alta desde el servidor (scripts/invitar.js) y abre su enlace.
      const alta = await acceso.crearUsuario(pool, { email: 'Direccion@Ejemplo.com ', nombre: ' Dirección  Prueba', rol: 'direccion', actor: 'consola', ahora: T0 });
      const token = tokenDe(alta.enlace);
      const dir = { c: cliente(base), aut: new Autenticador({ origen: ORIGEN }), id: alta.usuario.id };
      // Cada prueba empieza a las 10:00 y con dirección dentro (si su sesión caducó en la anterior, entra).
      t.beforeEach(async () => {
        reloj.ahora = T0;
        if (dir.c.cookie && (await dir.c.pedir('/api/sesion')).status !== 200) assert.equal((await entrar(dir.c, dir.aut)).status, 200);
      });

      await t.test('alta por invitación: el enlace dice quién es, se registra la passkey y queda dentro', async () => {
        assert.match(alta.enlace, /^http:\/\/localhost:3004\/#alta\/[A-Za-z0-9_-]{43}$/);
        assert.deepEqual([alta.usuario.email, alta.usuario.nombre], ['direccion@ejemplo.com', 'Dirección Prueba']);
        assert.equal(alta.caduca.getTime(), mas(24 * 60).getTime(), 'caduca a las 24 horas');
        // En la base, solo la huella del token.
        const [inv] = await q('SELECT * FROM invitaciones WHERE usuario_id = ?', [dir.id]);
        assert.equal(inv.token_huella, crypto.createHash('sha256').update(token).digest('hex'));
        assert.ok(!JSON.stringify(Object.values(inv)).includes(token), 'el token no se guarda');

        assert.equal((await dir.c.pedir('/api/sesion')).status, 401, 'sin sesión todavía');
        const ver = await dir.c.pedir('/api/acceso/invitacion', { metodo: 'POST', cuerpo: { token } });
        assert.equal(ver.status, 200);
        assert.deepEqual([ver.json.nombre, ver.json.email, ver.json.rol], ['Dirección Prueba', 'direccion@ejemplo.com', 'direccion']);

        const op = await dir.c.pedir('/api/acceso/alta/opciones', { metodo: 'POST', cuerpo: { token } });
        assert.equal(op.status, 200);
        assert.equal(op.json.rp.id, 'localhost', 'el RP ID sale de URL_PUBLICA');
        assert.equal(op.json.user.name, 'direccion@ejemplo.com');
        assert.equal(op.json.attestation, 'none', 'sin atestación');
        assert.deepEqual([op.json.authenticatorSelection.residentKey, op.json.authenticatorSelection.userVerification], ['required', 'preferred']);
        assert.deepEqual(op.json.excludeCredentials, []);
        const [u] = await q('SELECT id_webauthn FROM usuarios WHERE id = ?', [dir.id]);
        assert.equal(op.json.user.id, u.id_webauthn, 'el userHandle es aleatorio, ni el id ni el correo');

        const r = await dir.c.pedir('/api/acceso/alta', { metodo: 'POST', cuerpo: { token, respuesta: dir.aut.registrar(op.json), dispositivo: '  iPhone\u0000 de Dirección  ' } });
        assert.equal(r.status, 201, JSON.stringify(r.json));
        assert.deepEqual([r.json.nombre, r.json.rol, r.json.rolNombre, r.json.emergencia], ['Dirección Prueba', 'direccion', 'dirección', false]);
        assert.ok(r.json.permisos.includes('usuarios.gestionar'));
        assert.match(dir.c.cookie, /^iemec_sesion=/);
        const s = await dir.c.pedir('/api/sesion');
        assert.deepEqual([s.status, s.json.email], [200, 'direccion@ejemplo.com']);
        assert.equal((await dir.c.pedir('/api/panel/hoy')).status, 200);

        const [pk] = await q('SELECT * FROM passkeys WHERE usuario_id = ?', [dir.id]);
        assert.deepEqual([pk.dispositivo, pk.contador, json(pk.transportes), Boolean(pk.sincronizada)], ['iPhone de Dirección', 0, ['internal', 'hybrid'], false]);
        assert.equal(pk.credencial_id, dir.aut.credenciales[0].id);
        assert.deepEqual((await q("SELECT tipo FROM eventos WHERE entidad = 'usuario' AND entidad_id = ? ORDER BY id", [String(dir.id)])).map((e) => e.tipo),
          ['usuario_creado', 'invitacion_creada', 'passkey_registrada', 'sesion_iniciada']);
      });

      await t.test('el enlace ya usado no vale otra vez', async () => {
        const c = cliente(base);
        for (const ruta of ['/api/acceso/invitacion', '/api/acceso/alta/opciones']) {
          const r = await c.pedir(ruta, { metodo: 'POST', cuerpo: { token } });
          assert.deepEqual([r.status, r.json.codigo], [410, 'INVITACION_USADA'], ruta);
          assert.match(r.json.error, /ya se ha usado/);
        }
      });

      await t.test('entrar: el navegador ofrece la passkey (sin correo), se comprueba la firma y avanza el contador', async () => {
        const c = cliente(base);
        const op = await c.pedir('/api/acceso/entrar/opciones', { metodo: 'POST', cuerpo: {} });
        assert.equal(op.status, 200);
        assert.equal(op.json.rpId, 'localhost');
        assert.equal(op.json.userVerification, 'preferred');
        assert.ok(!op.json.allowCredentials?.length, 'sin lista de credenciales: no se pregunta el correo');
        reloj.ahora = mas(4); // lo que tarda en sacar el móvil
        const r = await c.pedir('/api/acceso/entrar', { metodo: 'POST', cuerpo: { respuesta: dir.aut.firmar(op.json) } });
        assert.equal(r.status, 200, JSON.stringify(r.json));
        assert.equal(r.json.nombre, 'Dirección Prueba');
        assert.equal((await c.pedir('/api/sesion')).json.rol, 'direccion');
        const [pk] = await q('SELECT contador, ultimo_uso_en FROM passkeys WHERE usuario_id = ?', [dir.id]);
        assert.deepEqual([pk.contador, pk.ultimo_uso_en.getTime()], [1, mas(4).getTime()]);
        assert.equal((await q('SELECT ultimo_acceso_en FROM usuarios WHERE id = ?', [dir.id]))[0].ultimo_acceso_en.getTime(), mas(4).getTime());
        assert.equal((await eventos('sesion_iniciada')).length, 2);

        const salir = await c.pedir('/api/sesion/salir', { metodo: 'POST' });
        assert.equal(salir.status, 200);
        assert.equal(c.cookie, null, 'salir borra la cookie');
        assert.equal((await c.pedir('/api/sesion')).status, 401);
        reloj.ahora = T0;
      });

      await t.test('reto caducado, repetido, inventado o de otra web: no entra', async () => {
        const c = cliente(base);
        // Caducado: a los 5 minutos ya no vale.
        const op = await c.pedir('/api/acceso/entrar/opciones', { metodo: 'POST', cuerpo: {} });
        const respuesta = dir.aut.firmar(op.json);
        reloj.ahora = mas(6);
        const tarde = await c.pedir('/api/acceso/entrar', { metodo: 'POST', cuerpo: { respuesta } });
        assert.deepEqual([tarde.status, tarde.json.codigo], [400, 'RETO_CADUCADO']);
        assert.equal(c.cookie, null);
        // Repetido: la misma respuesta dos veces, la segunda no.
        const buena = await entrar(c, dir.aut);
        assert.equal(buena.status, 200);
        const op2 = await c.pedir('/api/acceso/entrar/opciones', { metodo: 'POST', cuerpo: {} });
        const una = dir.aut.firmar(op2.json);
        assert.equal((await c.pedir('/api/acceso/entrar', { metodo: 'POST', cuerpo: { respuesta: una } })).status, 200);
        const otra = await c.pedir('/api/acceso/entrar', { metodo: 'POST', cuerpo: { respuesta: una } });
        assert.deepEqual([otra.status, otra.json.codigo], [400, 'RETO_NO_VALE'], 'el reto se gasta al usarlo');
        // Un reto que el servidor no ha dado, y uno de alta usado para entrar.
        const inventado = dir.aut.firmar({ challenge: crypto.randomBytes(32).toString('base64url'), rpId: 'localhost' });
        assert.equal((await c.pedir('/api/acceso/entrar', { metodo: 'POST', cuerpo: { respuesta: inventado } })).json.codigo, 'RETO_NO_VALE');
        const otraAlta = await acceso.crearUsuario(pool, { email: 'reto@ejemplo.com', nombre: 'Reto Prueba', rol: 'recepcion', actor: 'pruebas', ahora: reloj.ahora });
        const opAlta = await c.pedir('/api/acceso/alta/opciones', { metodo: 'POST', cuerpo: { token: tokenDe(otraAlta.enlace) } });
        const cruzado = await c.pedir('/api/acceso/entrar', { metodo: 'POST', cuerpo: { respuesta: dir.aut.firmar({ challenge: opAlta.json.challenge, rpId: 'localhost' }) } });
        assert.equal(cruzado.json.codigo, 'RETO_NO_VALE', 'un reto de alta no sirve para entrar');
        // Firmada para otra web (otro origen u otro RP ID): la firma es buena, pero no es para aquí.
        for (const torcer of [{ origen: 'https://iemec.malicioso.example' }, { rpId: 'malicioso.example' }]) {
          const op3 = await c.pedir('/api/acceso/entrar/opciones', { metodo: 'POST', cuerpo: {} });
          const r = await c.pedir('/api/acceso/entrar', { metodo: 'POST', cuerpo: { respuesta: dir.aut.firmar(op3.json, torcer) } });
          assert.deepEqual([r.status, r.json.codigo], [401, 'PASSKEY_NO_VALE'], JSON.stringify(torcer));
        }
        // El cron se lleva los retos caducados.
        await c.pedir('/api/acceso/entrar/opciones', { metodo: 'POST', cuerpo: {} });
        assert.ok((await acceso.purgar(pool, mas(60))) >= 1);
        assert.equal((await q('SELECT COUNT(*) AS n FROM retos_webauthn'))[0].n, 0);
        reloj.ahora = T0;
      });

      await t.test('el contador que no avanza (una posible copia) no entra y queda en eventos', async () => {
        const c = cliente(base);
        const [antes] = await q('SELECT id, contador FROM passkeys WHERE usuario_id = ?', [dir.id]);
        const igual = await entrar(c, dir.aut, { contador: antes.contador });
        assert.deepEqual([igual.status, igual.json.codigo], [401, 'CONTADOR']);
        assert.match(igual.json.error, /podría ser una copia/);
        const menor = await entrar(c, dir.aut, { contador: antes.contador - 1 });
        assert.equal(menor.json.codigo, 'CONTADOR');
        const [ev] = await eventos('passkey_contador_no_avanza');
        assert.deepEqual(json(ev.datos), { passkey: antes.id, guardado: antes.contador, recibido: antes.contador });
        assert.equal(ev.actor, 'direccion@ejemplo.com');
        assert.equal((await q('SELECT contador FROM passkeys WHERE id = ?', [antes.id]))[0].contador, antes.contador, 'el contador guardado no cambia');
        // Sin firma buena no hay alarma: con otra clave y el contador viejo, solo «no vale».
        const sinClave = await entrar(c, dir.aut, { contador: 0, clave: crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey });
        assert.equal(sinClave.json.codigo, 'PASSKEY_NO_VALE');
        assert.equal((await eventos('passkey_contador_no_avanza')).length, 2);
        assert.equal(c.cookie, null);
        assert.equal((await entrar(c, dir.aut, { contador: antes.contador + 5 })).status, 200, 'si avanza, entra');
      });

      await t.test('las passkeys sincronizadas (contador siempre 0) entran siempre', async () => {
        const alta2 = await acceso.crearUsuario(pool, { email: 'sincronizada@ejemplo.com', nombre: 'Sincronizada Prueba', rol: 'medico', actor: 'pruebas', ahora: reloj.ahora });
        const c = cliente(base);
        const aut = new Autenticador({ origen: ORIGEN });
        assert.equal((await darDeAlta(c, aut, tokenDe(alta2.enlace))).status, 201);
        for (let i = 0; i < 3; i++) assert.equal((await entrar(cliente(base), aut, { contador: 0 })).status, 200);
      });

      await t.test('la credencial de otra persona no vale', async () => {
        const rec = await personaConSesion(pool, base, { email: 'recepcion@ejemplo.com', nombre: 'Recepción Prueba', rol: 'recepcion', ahora: reloj.ahora });
        const c = cliente(base);
        // La passkey de dirección diciendo que es de recepción (userHandle de otra).
        const cambiada = await entrar(c, dir.aut, { userHandle: rec.aut.credenciales[0].userHandle });
        assert.deepEqual([cambiada.status, cambiada.json.codigo], [401, 'PASSKEY_DE_OTRO']);
        // El id de la credencial de dirección, firmado con la clave de recepción.
        const ajena = await entrar(c, dir.aut, { clave: rec.aut.credenciales[0].clave });
        assert.deepEqual([ajena.status, ajena.json.codigo], [401, 'PASSKEY_NO_VALE']);
        assert.equal(c.cookie, null);
        // Una credencial que no está dada de alta: el panel recibe el RP ID para que el navegador la olvide.
        const suelta = new Autenticador({ origen: ORIGEN });
        suelta.registrar({ challenge: 'x'.repeat(43), rp: { id: 'localhost' }, user: { id: 'y'.repeat(22) } });
        const desconocida = await entrar(c, suelta);
        assert.deepEqual([desconocida.status, desconocida.json.codigo, desconocida.json.rpID], [401, 'CREDENCIAL_DESCONOCIDA', 'localhost']);
        // Registrar como propia la credencial de otra persona: no (y el enlace sigue sirviendo).
        const alta3 = await acceso.crearUsuario(pool, { email: 'copia@ejemplo.com', nombre: 'Copia Prueba', rol: 'estetica', actor: 'pruebas', ahora: reloj.ahora });
        const autCopia = new Autenticador({ origen: ORIGEN });
        const repe = await darDeAlta(cliente(base), autCopia, tokenDe(alta3.enlace), { id: Buffer.from(dir.aut.credenciales[0].id, 'base64url') });
        assert.deepEqual([repe.status, repe.json.codigo], [409, 'CREDENCIAL_EN_USO']);
        assert.equal((await darDeAlta(cliente(base), autCopia, tokenDe(alta3.enlace))).status, 201, 'el enlace no se ha gastado');
      });

      await t.test('enlace caducado, sustituido por otro o de mentira', async () => {
        const c = cliente(base);
        const a = await acceso.crearUsuario(pool, { email: 'marketing@ejemplo.com', nombre: 'Marketing Prueba', rol: 'marketing', actor: 'pruebas', ahora: T0 });
        const viejo = tokenDe(a.enlace);
        reloj.ahora = mas(24 * 60 + 1);
        for (const ruta of ['/api/acceso/invitacion', '/api/acceso/alta/opciones']) {
          const r = await c.pedir(ruta, { metodo: 'POST', cuerpo: { token: viejo } });
          assert.deepEqual([r.status, r.json.codigo], [410, 'INVITACION_CADUCADA'], ruta);
        }
        assert.equal((await entrar(dir.c, dir.aut)).status, 200, 'dirección entra al día siguiente');
        // Dirección le manda otro: el viejo deja de valer y el nuevo sí vale.
        const nuevo = await dir.c.pedir(`/api/panel/equipo/${a.usuario.id}/invitacion`, { metodo: 'POST' });
        assert.equal(nuevo.status, 201, JSON.stringify(nuevo.json));
        assert.equal((await c.pedir('/api/acceso/invitacion', { metodo: 'POST', cuerpo: { token: viejo } })).json.codigo, 'INVITACION_NO_VALE');
        const token2 = tokenDe(nuevo.json.enlace);
        assert.equal((await c.pedir('/api/acceso/invitacion', { metodo: 'POST', cuerpo: { token: token2 } })).status, 200);
        // Caduca mientras la persona está con el móvil: tampoco.
        const op = await c.pedir('/api/acceso/alta/opciones', { metodo: 'POST', cuerpo: { token: token2 } });
        const respuesta = new Autenticador({ origen: ORIGEN }).registrar(op.json);
        reloj.ahora = mas(2 * 24 * 60 + 2);
        const tarde = await c.pedir('/api/acceso/alta', { metodo: 'POST', cuerpo: { token: token2, respuesta } });
        assert.deepEqual([tarde.status, tarde.json.codigo], [410, 'INVITACION_CADUCADA']);
        for (const falso of ['', 'x'.repeat(43), '../../etc/passwd', null, 42]) {
          assert.equal((await cliente(base, { ip: '192.0.2.50' }).pedir('/api/acceso/invitacion', { metodo: 'POST', cuerpo: { token: falso } })).json.codigo, 'INVITACION_NO_VALE');
        }
        reloj.ahora = T0;
      });

      await t.test('desactivar a alguien: no entra y la sesión que tenía deja de valer al momento', async () => {
        const est = await personaConSesion(pool, base, { email: 'estetica@ejemplo.com', nombre: 'Estética Prueba', rol: 'estetica', ahora: reloj.ahora });
        assert.equal((await est.c.pedir('/api/panel/hoy')).status, 200);
        const off = await dir.c.pedir(`/api/panel/equipo/${est.usuario.id}`, { metodo: 'PATCH', cuerpo: { activo: false } });
        assert.equal(off.status, 200, JSON.stringify(off.json));
        assert.equal((await est.c.pedir('/api/panel/hoy')).status, 401, 'la misma cookie, en la petición siguiente');
        assert.equal((await est.c.pedir('/api/sesion')).status, 401);
        const otra = await entrar(cliente(base), est.aut);
        assert.deepEqual([otra.status, otra.json.codigo], [403, 'ACCESO_DESACTIVADO']);
        assert.equal((await eventos('acceso_desactivado')).length, 1);
        assert.equal((await eventos('usuario_desactivado')).at(-1).actor, 'direccion@ejemplo.com');
        // Un enlace nuevo para alguien desactivado, no; al reactivarla, vuelve a entrar.
        assert.equal((await dir.c.pedir(`/api/panel/equipo/${est.usuario.id}/invitacion`, { metodo: 'POST' })).json.codigo, 'USUARIO_INACTIVO');
        assert.equal((await dir.c.pedir(`/api/panel/equipo/${est.usuario.id}`, { metodo: 'PATCH', cuerpo: { activo: true } })).status, 200);
        assert.equal((await entrar(cliente(base), est.aut)).status, 200);
      });

      await t.test('varias passkeys por persona; borrar una perdida corta las sesiones que se abrieron con ella', async () => {
        // Dirección añade la de su ordenador desde su sesión (la del móvil queda excluida).
        const pc = new Autenticador({ origen: ORIGEN });
        const op = await dir.c.pedir('/api/panel/passkeys/opciones', { metodo: 'POST', cuerpo: {} });
        assert.equal(op.status, 200);
        assert.deepEqual(op.json.excludeCredentials.map((x) => x.id), [dir.aut.credenciales[0].id]);
        const nueva = await dir.c.pedir('/api/panel/passkeys', { metodo: 'POST', cuerpo: { respuesta: pc.registrar(op.json), dispositivo: 'Ordenador de dirección' } });
        assert.equal(nueva.status, 201, JSON.stringify(nueva.json));
        const mias = await dir.c.pedir('/api/panel/passkeys');
        assert.deepEqual(mias.json.passkeys.map((p) => p.dispositivo), ['iPhone de Dirección', 'Ordenador de dirección']);
        // Entra con la del ordenador en otro navegador… y el ordenador se pierde: la borra desde el móvil.
        const enPc = cliente(base);
        assert.equal((await entrar(enPc, pc)).status, 200);
        assert.equal((await enPc.pedir('/api/panel/hoy')).status, 200);
        const borrar = await dir.c.pedir(`/api/panel/passkeys/${nueva.json.id}`, { metodo: 'DELETE' });
        assert.deepEqual([borrar.status, borrar.json.sesionCerrada], [200, false]);
        assert.equal((await enPc.pedir('/api/panel/hoy')).status, 401, 'la sesión del ordenador perdido se acaba');
        assert.equal((await entrar(cliente(base), pc)).json.codigo, 'CREDENCIAL_DESCONOCIDA');
        assert.equal((await dir.c.pedir('/api/panel/hoy')).status, 200, 'la del móvil sigue');
        assert.equal((await eventos('passkey_borrada')).at(-1).actor, 'direccion@ejemplo.com');
        // Las de otra persona no se borran desde «Mis passkeys»; desde el equipo, sí.
        const [suya] = await q("SELECT p.id, p.usuario_id FROM passkeys p JOIN usuarios u ON u.id = p.usuario_id WHERE u.email = 'recepcion@ejemplo.com'");
        assert.equal((await dir.c.pedir(`/api/panel/passkeys/${suya.id}`, { metodo: 'DELETE' })).status, 404);
        assert.equal((await dir.c.pedir(`/api/panel/equipo/${dir.id}/passkeys/${suya.id}`, { metodo: 'DELETE' })).status, 404, 'con la persona equivocada, tampoco');
        assert.equal((await dir.c.pedir(`/api/panel/equipo/${suya.usuario_id}/passkeys/${suya.id}`, { metodo: 'DELETE' })).status, 200);
        assert.equal((await q('SELECT COUNT(*) AS n FROM passkeys WHERE id = ?', [suya.id]))[0].n, 0);
        // El reto de una passkey nueva es de quien lo pidió: otra persona no lo puede usar.
        const med = await personaConSesion(pool, base, { email: 'medico@ejemplo.com', nombre: 'Médico Prueba', rol: 'medico', ahora: reloj.ahora });
        const opDir = await dir.c.pedir('/api/panel/passkeys/opciones', { metodo: 'POST', cuerpo: {} });
        const robada = await med.c.pedir('/api/panel/passkeys', { metodo: 'POST', cuerpo: { respuesta: new Autenticador({ origen: ORIGEN }).registrar(opDir.json) } });
        assert.deepEqual([robada.status, robada.json.codigo], [400, 'RETO_NO_VALE']);
        // Borrar la passkey con la que se ha entrado cierra esta sesión.
        const [propia] = await q('SELECT id FROM passkeys WHERE usuario_id = ?', [med.usuario.id]);
        const fin = await med.c.pedir(`/api/panel/passkeys/${propia.id}`, { metodo: 'DELETE' });
        assert.deepEqual([fin.status, fin.json.sesionCerrada, med.c.cookie], [200, true, null]);
      });

      await t.test('la sesión caduca sin uso, se renueva usándola y dura como mucho una jornada', async () => {
        reloj.ahora = T0;
        const c = cliente(base);
        assert.equal((await entrar(c, dir.aut)).status, 200);
        reloj.ahora = mas(10);
        assert.equal((await c.pedir('/api/panel/hoy')).renovada, false, 'a los 10 minutos no hace falta cookie nueva');
        reloj.ahora = mas(16);
        const r = await c.pedir('/api/panel/hoy');
        assert.deepEqual([r.status, r.renovada], [200, true], 'al cuarto de hora se renueva');
        reloj.ahora = mas(16 + 119);
        assert.equal((await c.pedir('/api/panel/hoy')).status, 200, 'dos horas desde la última renovación: aún vale');
        reloj.ahora = mas(16 + 119 + 121);
        assert.equal((await c.pedir('/api/panel/hoy')).status, 401, 'dos horas sin usarla: caducada');
        // Usándola cada hora y media, llega hasta las 12 horas y ahí se acaba.
        reloj.ahora = T0;
        const d = cliente(base);
        assert.equal((await entrar(d, dir.aut)).status, 200);
        for (let min = 90; min < 12 * 60; min += 90) {
          reloj.ahora = mas(min);
          assert.equal((await d.pedir('/api/panel/hoy')).status, 200, `a los ${min} minutos`);
        }
        reloj.ahora = mas(12 * 60 + 1);
        assert.equal((await d.pedir('/api/panel/hoy')).status, 401, 'pasada la jornada, a entrar otra vez');
        // Una cookie retocada o firmada con otro secreto no vale.
        reloj.ahora = T0;
        const e = cliente(base);
        assert.equal((await entrar(e, dir.aut)).status, 200);
        const [cuerpo, firma] = decodeURIComponent(e.cookie.split('=')[1]).split('.');
        const datos = JSON.parse(Buffer.from(cuerpo, 'base64url').toString());
        const retocada = `${Buffer.from(JSON.stringify({ ...datos, rol: 'admin', hasta: datos.hasta + 1e9 })).toString('base64url')}.${firma}`;
        for (const valor of [retocada, 'basura', `${cuerpo}.${'A'.repeat(firma.length)}`]) {
          assert.equal((await cliente(base).pedir('/api/sesion', { cabeceras: { Cookie: `iemec_sesion=${encodeURIComponent(valor)}` } })).status, 401);
        }
        // Firmada de verdad pero con el reloj de hace dos jornadas (inicio viejo): tampoco.
        const vieja = firmar({ ...datos, inicio: mas(-25 * 60).getTime(), hasta: mas(60).getTime() });
        assert.equal((await cliente(base).pedir('/api/sesion', { cabeceras: { Cookie: `iemec_sesion=${encodeURIComponent(vieja)}` } })).status, 401);
      });

      await t.test('cerrar las sesiones de los demás aparatos, y el rol que cuenta es el de la base', async () => {
        reloj.ahora = T0;
        const movil = cliente(base);
        const tablet = cliente(base);
        assert.equal((await entrar(movil, dir.aut)).status, 200);
        assert.equal((await entrar(tablet, dir.aut)).status, 200);
        const cerrar = await movil.pedir('/api/panel/sesiones/cerrar-otras', { metodo: 'POST' });
        assert.deepEqual([cerrar.status, cerrar.renovada], [200, true]);
        assert.equal((await movil.pedir('/api/panel/hoy')).status, 200, 'esta sigue');
        assert.equal((await tablet.pedir('/api/panel/hoy')).status, 401, 'la de la tablet, no');
        assert.equal((await eventos('sesiones_cerradas')).length, 1);
        assert.equal((await dir.c.pedir('/api/sesion')).status, 401, 'ni la del navegador de antes');
        // Dirección (desde el móvil) cambia el rol de recepción a marketing: su sesión abierta pasa a
        // marketing ya.
        const [rec] = await q("SELECT id FROM usuarios WHERE email = 'recepcion@ejemplo.com'");
        const aut = new Autenticador({ origen: ORIGEN });
        const nuevo = await movil.pedir(`/api/panel/equipo/${rec.id}/invitacion`, { metodo: 'POST' });
        const suya = cliente(base);
        assert.equal((await darDeAlta(suya, aut, tokenDe(nuevo.json.enlace))).status, 201);
        assert.equal((await suya.pedir('/api/sesion')).json.rol, 'recepcion');
        assert.equal((await movil.pedir(`/api/panel/equipo/${rec.id}`, { metodo: 'PATCH', cuerpo: { rol: 'marketing' } })).status, 200);
        const ahora = await suya.pedir('/api/sesion');
        assert.deepEqual([ahora.json.rol, ahora.renovada], ['marketing', true], 'la cookie se rehace con el rol nuevo');
        assert.ok(ahora.json.permisos.includes('resenas.aprobar'));
        assert.deepEqual(json((await eventos('usuario_rol_cambiado')).at(-1).datos), { de: 'recepcion', a: 'marketing' });
      });

      await t.test('a la vez: el mismo enlace en dos pestañas o la misma respuesta dos veces, solo una vale', async () => {
        const a = await acceso.crearUsuario(pool, { email: 'pestanas@ejemplo.com', nombre: 'Pestañas Prueba', rol: 'recepcion', actor: 'pruebas', ahora: T0 });
        const token = tokenDe(a.enlace);
        const [c1, c2] = [cliente(base), cliente(base)];
        const [o1, o2] = [await c1.pedir('/api/acceso/alta/opciones', { metodo: 'POST', cuerpo: { token } }), await c2.pedir('/api/acceso/alta/opciones', { metodo: 'POST', cuerpo: { token } })];
        const [aut1, aut2] = [new Autenticador({ origen: ORIGEN }), new Autenticador({ origen: ORIGEN })];
        const altas = await Promise.all([
          c1.pedir('/api/acceso/alta', { metodo: 'POST', cuerpo: { token, respuesta: aut1.registrar(o1.json) } }),
          c2.pedir('/api/acceso/alta', { metodo: 'POST', cuerpo: { token, respuesta: aut2.registrar(o2.json) } }),
        ]);
        assert.deepEqual(altas.map((r) => r.status).sort(), [201, 410]);
        assert.equal(altas.find((r) => r.status === 410).json.codigo, 'INVITACION_USADA');
        assert.equal((await q('SELECT COUNT(*) AS n FROM passkeys WHERE usuario_id = ?', [a.usuario.id]))[0].n, 1, 'una sola passkey');
        // La misma respuesta de entrar, mandada dos veces a la vez: una sesión.
        const aut = altas[0].status === 201 ? aut1 : aut2;
        const op = await cliente(base).pedir('/api/acceso/entrar/opciones', { metodo: 'POST', cuerpo: {} });
        const respuesta = aut.firmar(op.json);
        const dos = await Promise.all([1, 2].map(() => cliente(base).pedir('/api/acceso/entrar', { metodo: 'POST', cuerpo: { respuesta } })));
        assert.deepEqual(dos.map((r) => r.status).sort(), [200, 400]);
      });

      await t.test('el primer enlace, desde la terminal del servidor (scripts/invitar.js)', async () => {
        reloj.ahora = new Date(); // el script trabaja con la hora de verdad
        const script = path.join(__dirname, '..', 'scripts', 'invitar.js');
        const correr = (...args) => execFileSync(process.execPath, [script, ...args], { env: { ...process.env, DB_NAME: BD_PRUEBAS.database }, encoding: 'utf8' });
        const salida = correr('--email', 'Primera@Ejemplo.com', '--nombre', 'Primera Directora', '--rol', 'direccion');
        assert.match(salida, /✓ Alta de Primera Directora \(direccion\)/);
        const enlace = /(http:\/\/\S+)/.exec(salida)[1];
        assert.match(salida, /caduca el \d{4}-\d{2}-\d{2} a las \d{2}:\d{2} \(hora de Madrid\)/);
        assert.equal((await cliente(base).pedir('/api/acceso/invitacion', { metodo: 'POST', cuerpo: { token: tokenDe(enlace) } })).json.nombre, 'Primera Directora');
        // Otra vez con el mismo correo: enlace nuevo, y el anterior deja de valer.
        const otra = correr('--email', 'primera@ejemplo.com');
        assert.match(otra, /✓ Enlace nuevo de Primera Directora/);
        assert.equal((await cliente(base).pedir('/api/acceso/invitacion', { metodo: 'POST', cuerpo: { token: tokenDe(enlace) } })).json.codigo, 'INVITACION_NO_VALE');
        const [ev] = await q("SELECT actor FROM eventos WHERE tipo = 'usuario_creado' AND entidad_id = (SELECT id FROM usuarios WHERE email = 'primera@ejemplo.com')");
        assert.match(ev.actor, /^consola:/);
        assert.throws(() => correr(), /Uso: node scripts\/invitar\.js/);
      });
    });
  } finally {
    restaurar();
    await pool.end();
  }
});
