'use strict';
// Seguridad del acceso: PANEL_CLAVE solo como emergencia de dirección (con cada uso en eventos y aviso
// al arrancar en producción), CSRF (origen de lo que cambia cosas), cabeceras de seguridad, la cookie,
// el límite de intentos y MODO_DEMO. Personas, correos e IP inventados (IP de documentación).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const express = require('express');
const { prepararBdDePrueba } = require('./ayuda-bd');
const acceso = require('../servidor/acceso');
const { crearApp } = require('../servidor/index');
const { CSP_PANEL } = require('../servidor/seguridad');
const { ORIGEN, ENTORNO, ponerEntorno, conServidor, appConReloj, cliente, personaConSesion, entrar } = require('./ayuda-acceso');

const T0 = new Date('2026-10-06T08:00:00Z');
const mas = (min) => new Date(T0.getTime() + min * 60000);
const CLAVE = 'clave-de-emergencia-de-pruebas-0123';
const SECRETO = 'secreto-de-sesion-de-pruebas-0123456789abcdef';
const json = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

test('avisos al arrancar', () => {
  const avisos = (entorno) => acceso.avisosDeArranque(entorno).join('\n');
  const prod = { NODE_ENV: 'production', URL_PUBLICA: 'https://agenda.ejemplo.com' };
  assert.equal(avisos(prod), '', 'sin PANEL_CLAVE, nada que avisar');
  assert.match(avisos({ ...prod, PANEL_CLAVE: CLAVE }), /PANEL_CLAVE está puesta: solo vale como acceso de emergencia de dirección/);
  assert.equal(avisos({ PANEL_CLAVE: CLAVE, URL_PUBLICA: 'http://localhost:3004' }), '', 'en el portátil no se avisa');
  assert.match(avisos({ PANEL_CLAVE: 'corta' }), /menos de 16 caracteres: el acceso de emergencia está desactivado/);
  assert.match(avisos({ ...prod, URL_PUBLICA: 'http://agenda.ejemplo.com' }), /URL_PUBLICA no es https/);
  assert.match(avisos({ ...prod, MODO_DEMO: '1' }), /MODO_DEMO=1 no hace nada en producción/);
});

test('el servidor avisa al arrancar en producción si PANEL_CLAVE está puesta', { timeout: 20000 }, async () => {
  const hijo = spawn(process.execPath, [path.join(__dirname, '..', 'servidor', 'index.js')], {
    env: { ...process.env, NODE_ENV: 'production', PORT: '0', PANEL_CLAVE: CLAVE, SESION_SECRETO: SECRETO, URL_PUBLICA: 'https://agenda.ejemplo.com', MODO_DEMO: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let salida = '';
  try {
    await new Promise((ok, mal) => {
      hijo.stdout.on('data', (d) => { salida += d; if (/escuchando/.test(salida)) ok(); });
      hijo.stderr.on('data', (d) => { salida += d; });
      hijo.once('exit', (codigo) => mal(new Error(`el servidor ha salido (${codigo}): ${salida}`)));
    });
  } finally { hijo.kill(); }
  assert.match(salida, /⚠ PANEL_CLAVE está puesta/);
  assert.doesNotMatch(salida, new RegExp(CLAVE), 'la clave no sale en el registro');
});

test('seguridad del acceso', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const restaurar = ponerEntorno(ENTORNO);
  const reloj = { ahora: T0 };
  const q = async (sql, a = []) => (await pool.query(sql, a))[0];
  try {
    await conServidor(appConReloj(pool, reloj), async (base) => {
      const dir = await personaConSesion(pool, base, { email: 'direccion@ejemplo.com', nombre: 'Dirección Prueba', rol: 'direccion', ahora: T0, ip: '203.0.113.1' });
      const rec = await personaConSesion(pool, base, { email: 'recepcion@ejemplo.com', nombre: 'Recepción Prueba', rol: 'recepcion', ahora: T0, ip: '203.0.113.2' });
      t.beforeEach(() => { reloj.ahora = T0; });

      await t.test('PANEL_CLAVE: sin configurar (o corta) no hay acceso de emergencia', async () => {
        const c = cliente(base, { ip: '203.0.113.10' });
        assert.deepEqual((await c.pedir('/api/acceso')).json, { emergencia: false, demo: false });
        const r = await c.pedir('/api/acceso/emergencia', { metodo: 'POST', cuerpo: { email: 'direccion@ejemplo.com', clave: 'lo-que-sea' } });
        assert.deepEqual([r.status, r.json.codigo], [404, 'EMERGENCIA_NO_CONFIGURADA']);
        const corta = ponerEntorno({ PANEL_CLAVE: 'corta-12345' });
        try {
          assert.equal((await c.pedir('/api/acceso/emergencia', { metodo: 'POST', cuerpo: { email: 'direccion@ejemplo.com', clave: 'corta-12345' } })).status, 404);
        } finally { corta(); }
        assert.equal((await c.pedir('/api/sesion', { metodo: 'POST', cuerpo: { email: 'direccion@ejemplo.com', clave: 'x' } })).status, 404, 'la entrada vieja con clave ya no existe');
      });

      await t.test('PANEL_CLAVE: solo dirección, cada uso en eventos y la sesión dura una hora', async () => {
        const fuera = ponerEntorno({ PANEL_CLAVE: CLAVE });
        try {
          const c = cliente(base, { ip: '203.0.113.11' });
          assert.equal((await c.pedir('/api/acceso')).json.emergencia, true);
          const r = await c.pedir('/api/acceso/emergencia', { metodo: 'POST', cuerpo: { email: ' Direccion@Ejemplo.com', clave: CLAVE } });
          assert.equal(r.status, 200, JSON.stringify(r.json));
          assert.deepEqual([r.json.rol, r.json.emergencia], ['direccion', true]);
          const s = await c.pedir('/api/sesion');
          assert.deepEqual([s.status, s.json.emergencia], [200, true]);
          const [ev] = await q("SELECT * FROM eventos WHERE tipo = 'acceso_emergencia'");
          assert.deepEqual([ev.actor, ev.entidad_id, json(ev.datos).ip], ['direccion@ejemplo.com', String(dir.usuario.id), '203.0.113.11']);
          assert.ok(!JSON.stringify(ev).includes(CLAVE), 'la clave no se guarda');
          // Una hora como mucho, aunque se use.
          for (const min of [20, 40, 59]) { reloj.ahora = mas(min); assert.equal((await c.pedir('/api/panel/hoy')).status, 200); }
          reloj.ahora = mas(61);
          assert.equal((await c.pedir('/api/panel/hoy')).status, 401);
          // Con la sesión de emergencia puede crearse su passkey nueva.
          reloj.ahora = T0;
          assert.equal((await c.pedir('/api/acceso/emergencia', { metodo: 'POST', cuerpo: { email: 'direccion@ejemplo.com', clave: CLAVE } })).status, 200);
          assert.equal((await c.pedir('/api/panel/passkeys/opciones', { metodo: 'POST', cuerpo: {} })).status, 200);

          // Lo demás, la misma respuesta: no se sabe si el correo existe ni de quién es.
          const intentos = [
            { email: 'recepcion@ejemplo.com', clave: CLAVE },
            { email: 'nadie@ejemplo.com', clave: CLAVE },
            { email: 'direccion@ejemplo.com', clave: `${CLAVE}x` },
            { email: 'direccion@ejemplo.com', clave: null },
          ];
          for (const [i, cuerpo] of intentos.entries()) {
            const m = await cliente(base, { ip: `203.0.113.${20 + i}` }).pedir('/api/acceso/emergencia', { metodo: 'POST', cuerpo });
            assert.deepEqual([m.status, m.json], [401, { error: 'Correo o clave incorrectos.', codigo: 'CLAVE_INCORRECTA' }], JSON.stringify(cuerpo));
          }
          const fallidos = await q("SELECT actor, entidad_id, datos FROM eventos WHERE tipo = 'acceso_emergencia_fallido' ORDER BY id");
          assert.deepEqual(fallidos.map((e) => json(e.datos).email), ['recepcion@ejemplo.com', 'nadie@ejemplo.com', 'direccion@ejemplo.com', 'direccion@ejemplo.com']);
          assert.ok(fallidos.every((e) => e.actor === 'desconocido'));
          // Dirección desactivada tampoco entra con la clave.
          await pool.query('UPDATE usuarios SET activo = FALSE WHERE id = ?', [dir.usuario.id]);
          assert.equal((await cliente(base, { ip: '203.0.113.30' }).pedir('/api/acceso/emergencia', { metodo: 'POST', cuerpo: { email: 'direccion@ejemplo.com', clave: CLAVE } })).status, 401);
          await pool.query('UPDATE usuarios SET activo = TRUE WHERE id = ?', [dir.usuario.id]);
          // Cinco intentos por IP y cuarto de hora; el sexto, 429 aunque la clave sea buena.
          const insistente = cliente(base, { ip: '203.0.113.31' });
          for (let i = 0; i < 5; i++) await insistente.pedir('/api/acceso/emergencia', { metodo: 'POST', cuerpo: { email: 'direccion@ejemplo.com', clave: i < 4 ? 'mala-clave-de-prueba-000' : CLAVE } });
          const sexto = await insistente.pedir('/api/acceso/emergencia', { metodo: 'POST', cuerpo: { email: 'direccion@ejemplo.com', clave: CLAVE } });
          assert.deepEqual([sexto.status, sexto.json.codigo], [429, 'DEMASIADOS_INTENTOS']);
          assert.ok(Number(sexto.cabeceras.get('retry-after')) > 0);
        } finally { fuera(); }
      });

      await t.test('CSRF: lo que cambia cosas tiene que venir del panel', async () => {
        const [tarea] = await pool.query("INSERT INTO tareas (tipo, titulo, vence_en) VALUES ('llamar', 'Llamar a la paciente inventada', ?)", [mas(60)]);
        const cerrar = (cabeceras) => rec.c.pedir(`/api/panel/tareas/${tarea.insertId}`, { metodo: 'POST', cuerpo: { estado: 'hecha' }, cabeceras });
        const [r1, r2, r3, r4] = [
          await cerrar({ Origin: 'https://malicioso.example' }),
          await cerrar({ Origin: 'null' }),
          await cerrar({ Origin: '', 'Sec-Fetch-Site': 'cross-site' }),
          await cerrar({ Origin: '', 'Sec-Fetch-Site': 'same-site' }),
        ];
        for (const r of [r1, r2, r3, r4]) assert.deepEqual([r.status, r.json.codigo], [403, 'ORIGEN']);
        assert.equal((await q('SELECT estado FROM tareas WHERE id = ?', [tarea.insertId]))[0].estado, 'abierta', 'no ha cambiado nada');
        // Entrar desde otra web tampoco (ni pedir el reto).
        assert.equal((await cliente(base).pedir('/api/acceso/entrar/opciones', { metodo: 'POST', cuerpo: {}, cabeceras: { Origin: 'https://malicioso.example' } })).status, 403);
        // Leer no cambia nada: un GET con otro origen pasa (lo frena la cookie SameSite y CORS).
        assert.equal((await rec.c.pedir('/api/panel/hoy', { cabeceras: { Origin: 'https://malicioso.example' } })).status, 200);
        // Desde el panel, sí: con el origen de URL_PUBLICA, con Sec-Fetch-Site same-origin, o sin
        // ninguna de las dos cabeceras (no es un navegador).
        assert.equal((await cerrar({ 'Sec-Fetch-Site': 'same-origin', Origin: '' })).status, 200);
        await pool.query("UPDATE tareas SET estado = 'abierta' WHERE id = ?", [tarea.insertId]);
        const ok = await cerrar({ Origin: ORIGEN });
        assert.deepEqual([ok.status, ok.json.ok], [200, true]);
        await pool.query("UPDATE tareas SET estado = 'abierta' WHERE id = ?", [tarea.insertId]);
        assert.equal((await cerrar({ Origin: base })).status, 200, 'el origen de la propia petición también vale');
        // Fuera de producción vale el de Vite (npm run dev); en producción, no.
        await pool.query("UPDATE tareas SET estado = 'abierta' WHERE id = ?", [tarea.insertId]);
        assert.equal((await cerrar({ Origin: 'http://localhost:5174' })).status, 200);
        const prod = ponerEntorno({ NODE_ENV: 'production', SESION_SECRETO: SECRETO });
        try {
          assert.equal((await cerrar({ Origin: 'http://localhost:5174' })).status, 403);
        } finally { prod(); }
      });

      await t.test('cabeceras de seguridad y la cookie', async () => {
        const r = await fetch(`${base}/api/version`);
        const h = (n) => r.headers.get(n);
        assert.deepEqual(
          [h('x-content-type-options'), h('x-frame-options'), h('referrer-policy'), h('cross-origin-opener-policy'), h('content-security-policy')],
          ['nosniff', 'DENY', 'same-origin', 'same-origin', "default-src 'none'; frame-ancestors 'none'"]);
        assert.match(h('permissions-policy'), /camera=\(\)/);
        assert.equal(h('strict-transport-security'), null, 'HSTS solo en producción');
        const c = cliente(base, { ip: '203.0.113.40' });
        const r2 = await fetch(`${base}/api/acceso/entrar`, { method: 'POST' });
        assert.equal(r2.headers.get('x-frame-options'), 'DENY');
        const prod = ponerEntorno({ NODE_ENV: 'production', SESION_SECRETO: SECRETO });
        try {
          assert.equal((await fetch(`${base}/api/version`)).headers.get('strict-transport-security'), 'max-age=31536000');
          // La cookie: httpOnly, SameSite estricta, para todo el sitio, Secure en producción y lo que
          // queda hasta caducar sin uso (2 h).
          const op = await c.pedir('/api/acceso/entrar/opciones', { metodo: 'POST', cuerpo: {} });
          const res = await fetch(`${base}/api/acceso/entrar`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGEN, 'X-Forwarded-For': '203.0.113.40' }, body: JSON.stringify({ respuesta: dir.aut.firmar(op.json) }),
          });
          assert.equal(res.status, 200);
          const galleta = res.headers.get('set-cookie');
          for (const trozo of ['HttpOnly', 'SameSite=Strict', 'Path=/', 'Secure', 'Max-Age=7200']) assert.ok(galleta.includes(trozo), `${trozo} en ${galleta}`);
        } finally { prod(); }
        // El panel compilado lleva su política de contenido; la página «Tu cita», las cabeceras generales.
        const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'iemec-panel-'));
        fs.writeFileSync(path.join(carpeta, 'index.html'), '<!doctype html><title>Panel</title>');
        const app = express();
        app.use(crearApp({ pool, publico: carpeta }));
        try {
          await conServidor(app, async (otra) => {
            for (const ruta of ['/', '/index.html', '/#hoy', '/cualquier/cosa']) {
              assert.equal((await fetch(`${otra}${ruta}`)).headers.get('content-security-policy'), CSP_PANEL, ruta);
            }
            const cita = await fetch(`${otra}/c/${'x'.repeat(43)}`);
            assert.deepEqual([cita.status, cita.headers.get('x-frame-options'), cita.headers.get('content-security-policy')], [404, 'DENY', null]);
          });
        } finally { fs.rmSync(carpeta, { recursive: true, force: true }); }
      });

      await t.test('límite de intentos: diez fallos por IP y cuarto de hora; luego ni la passkey buena', async () => {
        const ip = '203.0.113.50';
        for (let i = 0; i < 10; i++) {
          const r = await cliente(base, { ip }).pedir('/api/acceso/invitacion', { metodo: 'POST', cuerpo: { token: `falso-${i}` } });
          assert.equal(r.status, 410);
        }
        const bloqueada = await entrar(cliente(base, { ip }), dir.aut).catch((err) => err);
        assert.match(String(bloqueada.message), /429/, 'ni siquiera da el reto');
        const directa = await cliente(base, { ip }).pedir('/api/acceso/entrar', { metodo: 'POST', cuerpo: { respuesta: {} } });
        assert.deepEqual([directa.status, directa.json.codigo], [429, 'DEMASIADOS_INTENTOS']);
        assert.equal((await entrar(cliente(base, { ip: '203.0.113.51' }), dir.aut)).status, 200, 'otra IP entra');
        const claves = await q("SELECT clave FROM limites_acceso WHERE clave LIKE 'fallos:%'");
        assert.ok(claves.every((f) => !f.clave.includes('203.0.113')), 'de la IP solo se guarda una huella');
        reloj.ahora = mas(16);
        assert.equal((await entrar(cliente(base, { ip }), dir.aut)).status, 200, 'pasado el cuarto de hora, vuelve a entrar');
        // Retos: sesenta por IP y cuarto de hora.
        const glotona = cliente(base, { ip: '203.0.113.52' });
        for (let i = 0; i < 60; i++) assert.equal((await glotona.pedir('/api/acceso/entrar/opciones', { metodo: 'POST', cuerpo: {} })).status, 200);
        assert.equal((await glotona.pedir('/api/acceso/entrar/opciones', { metodo: 'POST', cuerpo: {} })).status, 429);
        // El cron borra las ventanas pasadas.
        await acceso.purgar(pool, mas(60));
        assert.equal((await q('SELECT COUNT(*) AS n FROM limites_acceso'))[0].n, 0);
      });

      await t.test('MODO_DEMO entra solo fuera de producción', async () => {
        const demo = ponerEntorno({ MODO_DEMO: '1' });
        try {
          assert.equal((await cliente(base).pedir('/api/sesion')).json.nombre, 'Demostración');
          assert.equal((await cliente(base).pedir('/api/acceso')).json.demo, true);
          const prod = ponerEntorno({ NODE_ENV: 'production', SESION_SECRETO: SECRETO });
          try {
            assert.equal((await cliente(base).pedir('/api/sesion')).status, 401);
            assert.equal((await cliente(base).pedir('/api/panel/hoy')).status, 401);
          } finally { prod(); }
        } finally { demo(); }
      });
    });
  } finally {
    restaurar();
    await pool.end();
  }
});
