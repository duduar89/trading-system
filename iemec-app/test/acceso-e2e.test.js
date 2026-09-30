'use strict';
// De punta a punta, en un Chromium de verdad con su autenticador virtual (WebAuthn por CDP): dirección
// abre su enlace y crea la passkey, sale y vuelve a entrar con ella, y da de alta a recepción desde
// «Equipo»; recepción, con su enlace y su propio autenticador, entra y no ve lo que no puede usar; y
// cuando dirección la desactiva, se queda fuera. El panel se compila aparte para la prueba.
// Se salta sola si no hay navegador (en CI no se instala: npx playwright install chromium).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { prepararBdDePrueba } = require('./ayuda-bd');
const { crearApp } = require('../servidor/index');
const acceso = require('../servidor/acceso');
const { crearIa } = require('../servidor/integraciones/ia');
const { crearWhatsApp } = require('../servidor/integraciones/whatsapp');
const { crearGoogle } = require('../servidor/integraciones/google');
const { ENTORNO, ponerEntorno } = require('./ayuda-acceso');

const RAIZ = path.join(__dirname, '..');
const CHROMIUM = [process.env.CHROMIUM_RUTA, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'];

async function lanzarNavegador() {
  let chromium;
  try { ({ chromium } = require('@playwright/test')); } catch { return null; }
  for (const executablePath of [...CHROMIUM.filter((r) => r && fs.existsSync(r)), undefined]) {
    try { return await chromium.launch({ executablePath, headless: true }); } catch { /* el siguiente */ }
  }
  return null;
}

// Un navegador aparte (sin service worker) con su autenticador de plataforma: guarda passkeys
// descubribles y verifica a la persona sin preguntar.
async function contextoConAutenticador(navegador) {
  const contexto = await navegador.newContext({ serviceWorkers: 'block', locale: 'es-ES', timezoneId: 'Europe/Madrid' });
  const pagina = await contexto.newPage();
  const cdp = await contexto.newCDPSession(pagina);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  pagina.on('dialog', (d) => d.accept());
  const credenciales = async () => (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials;
  return { contexto, pagina, credenciales };
}

test('passkeys de punta a punta en Chromium', { timeout: 180000 }, async (t) => {
  const navegador = await lanzarNavegador();
  if (!navegador) { t.skip('sin Chromium para Playwright'); return; }
  const pool = await prepararBdDePrueba(t);
  if (!pool) { await navegador.close(); return; }
  const publico = fs.mkdtempSync(path.join(os.tmpdir(), 'iemec-e2e-'));
  let servidor;
  let restaurar = () => {};
  try {
    execFileSync(process.execPath, [path.join(RAIZ, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', publico, '--emptyOutDir', '--logLevel', 'error'], { cwd: RAIZ, stdio: 'pipe' });
    const app = crearApp({ pool, publico, deps: { ia: crearIa('simulado'), whatsapp: crearWhatsApp('simulado'), google: crearGoogle('simulado') } });
    servidor = app.listen(0);
    await new Promise((ok) => servidor.once('listening', ok));
    // localhost (no 127.0.0.1): una passkey necesita un dominio, y localhost cuenta como seguro sin https.
    const base = `http://localhost:${servidor.address().port}`;
    restaurar = ponerEntorno({ ...ENTORNO, URL_PUBLICA: base });
    await pool.query(
      "INSERT INTO resenas (google_id, autor, nota, texto, publicada_en, borrador_respuesta, estado) VALUES ('prueba-e2e', 'Autora Inventada', 5, 'Todo muy bien', NOW(), '¡Gracias por tu reseña!', 'borrador')");
    const alta = await acceso.crearUsuario(pool, { email: 'direccion@ejemplo.com', nombre: 'Dirección Prueba', rol: 'direccion', actor: 'pruebas' });

    const dir = await contextoConAutenticador(navegador);
    const rec = await contextoConAutenticador(navegador);
    const p = dir.pagina;
    const enlaceDeLaSeccion = (pagina, nombre) => pagina.getByRole('navigation', { name: 'Secciones' }).getByRole('link', { name: nombre, exact: true });

    await t.test('dirección abre su enlace y crea su passkey', async () => {
      await p.goto(alta.enlace);
      await p.getByRole('heading', { name: /Hola, Dirección/ }).waitFor();
      assert.ok((await p.getByLabel('Nombre de este dispositivo').inputValue()).length > 0, 'propone un nombre para el dispositivo');
      await p.getByLabel('Nombre de este dispositivo').fill('Ordenador de dirección');
      await p.getByRole('button', { name: 'Crear mi passkey' }).click();
      await p.getByRole('heading', { name: /IEMEC$/ }).waitFor();
      assert.equal(new URL(p.url()).hash, '#hoy', 'el enlace sale de la barra');
      const [cred] = await dir.credenciales();
      assert.equal(cred.isResidentCredential, true, 'passkey descubrible');
      const [fila] = (await pool.query('SELECT dispositivo, credencial_id FROM passkeys'))[0];
      assert.equal(fila.dispositivo, 'Ordenador de dirección');
      assert.equal(Buffer.from(cred.credentialId, 'base64').toString('base64url'), fila.credencial_id);
      await enlaceDeLaSeccion(p, 'Equipo').waitFor();
      await enlaceDeLaSeccion(p, 'Cabinas y tratamientos').waitFor();
    });

    await t.test('sale y vuelve a entrar con la passkey, sin escribir nada', async () => {
      await p.getByRole('button', { name: 'Salir' }).click();
      await p.getByRole('button', { name: 'Entrar con passkey' }).click();
      await p.getByRole('heading', { name: /IEMEC$/ }).waitFor();
      assert.equal(await p.getByText('Dirección Prueba', { exact: true }).isVisible(), true);
      const [cred] = await dir.credenciales();
      assert.ok(cred.signCount >= 2, 'el autenticador ha firmado otra vez');
    });

    let enlaceRecepcion;
    await t.test('dirección da de alta a recepción desde «Equipo» y le sale su enlace', async () => {
      await enlaceDeLaSeccion(p, 'Equipo').click();
      await p.getByLabel('Nombre', { exact: true }).fill('Recepción Prueba');
      await p.getByLabel('Correo', { exact: true }).fill('recepcion@ejemplo.com');
      await p.getByLabel('Rol', { exact: true }).selectOption('recepcion');
      await p.getByRole('button', { name: 'Crear enlace' }).click();
      await p.getByText('Enlace listo para Recepción Prueba').waitFor();
      enlaceRecepcion = await p.getByLabel('Enlace de alta de Recepción Prueba').inputValue();
      assert.match(enlaceRecepcion, new RegExp(`^${base}/#alta/[A-Za-z0-9_-]{43}$`));
      await p.getByText(/Enlace pendiente hasta/).waitFor();
    });

    await t.test('recepción crea su passkey y no ve lo que no puede usar', async () => {
      const r = rec.pagina;
      await r.goto(enlaceRecepcion);
      await r.getByRole('heading', { name: /Hola, Recepción/ }).waitFor();
      await r.getByRole('button', { name: 'Crear mi passkey' }).click();
      await r.getByRole('heading', { name: /IEMEC$/ }).waitFor();
      await enlaceDeLaSeccion(r, 'Mis passkeys').waitFor();
      assert.equal(await enlaceDeLaSeccion(r, 'Equipo').count(), 0);
      assert.equal(await enlaceDeLaSeccion(r, 'Cabinas y tratamientos').count(), 0);
      await enlaceDeLaSeccion(r, 'Reseñas y Google').click();
      await r.getByText('¡Gracias por tu reseña!').waitFor();
      assert.equal(await r.getByRole('button', { name: 'Aprobar y publicar' }).count(), 0);
      await r.getByText(/la aprueba dirección o marketing/).waitFor();
      // Aunque escriba la dirección de una sección que no es suya, se queda en «Hoy».
      await r.goto(`${base}/#ajustes`);
      await r.getByRole('heading', { name: /IEMEC$/ }).waitFor();
      await enlaceDeLaSeccion(r, 'Mis passkeys').click();
      await r.getByRole('heading', { name: 'Tus passkeys' }).waitFor();
      await r.getByText('con esta has entrado').waitFor();
    });

    await t.test('dirección la desactiva y recepción se queda fuera', async () => {
      await p.reload();
      const persona = p.getByRole('listitem').filter({ hasText: 'recepcion@ejemplo.com' });
      await persona.getByText('Activa', { exact: true }).waitFor();
      await persona.getByRole('button', { name: 'Desactivar' }).click();
      await persona.getByText('Desactivada', { exact: true }).waitFor();
      const r = rec.pagina;
      await r.reload();
      await r.getByRole('button', { name: 'Entrar con passkey' }).waitFor();
      await r.getByRole('button', { name: 'Entrar con passkey' }).click();
      await r.getByRole('alert').filter({ hasText: 'Tu acceso al panel está desactivado' }).waitFor();
    });

    await dir.contexto.close();
    await rec.contexto.close();
  } finally {
    restaurar();
    await navegador.close();
    if (servidor) servidor.close();
    fs.rmSync(publico, { recursive: true, force: true });
    await pool.end();
  }
});
