'use strict';
// El adaptador de Meta. El real se prueba con un fetch de mentira: nunca sale nada a internet.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { crearMeta } = require('./meta');

test('simulado: devuelve los leads que se le dan y apunta lo que se le pide', async () => {
  const meta = crearMeta('simulado', { leads: { 900000000000001: { campaign_name: 'Prueba', field_data: [] } } });
  assert.equal(meta.modo, 'simulado');
  assert.deepEqual(await meta.obtenerLead('900000000000001'), { id: '900000000000001', campaign_name: 'Prueba', field_data: [] });
  await assert.rejects(meta.obtenerLead('900000000000002'), (err) => /no hay ningún lead/.test(err.message) && err.permanente === true);
  assert.deepEqual(meta.pedidos, ['900000000000001', '900000000000002']);
});

test('real: sin el token de la página no arranca (puerta)', () => {
  assert.throws(() => crearMeta('real', { env: {} }), /META_TOKEN_PAGINA/);
});

test('real: pide el lead a la Graph API con sus campos y la prueba del secreto', async () => {
  const pedidas = [];
  const fetch = async (url, opciones) => {
    pedidas.push({ url: new URL(url), opciones });
    return { ok: true, status: 200, json: async () => ({ id: '900000000000003', field_data: [{ name: 'full_name', values: ['Ana Prueba'] }] }) };
  };
  const env = { META_TOKEN_PAGINA: 'token-de-pruebas', META_APP_SECRET: 'secreto-de-pruebas', META_GRAPH_VERSION: 'v99.0' };
  const meta = crearMeta('real', { env, fetch });
  assert.equal(meta.modo, 'real');
  const lead = await meta.obtenerLead('900000000000003');
  assert.equal(lead.field_data[0].values[0], 'Ana Prueba');
  const { url, opciones } = pedidas[0];
  assert.equal(`${url.origin}${url.pathname}`, 'https://graph.facebook.com/v99.0/900000000000003');
  assert.match(url.searchParams.get('fields'), /field_data/);
  assert.match(url.searchParams.get('fields'), /campaign_name/);
  assert.equal(url.searchParams.get('access_token'), 'token-de-pruebas');
  assert.equal(url.searchParams.get('appsecret_proof'), crypto.createHmac('sha256', 'secreto-de-pruebas').update('token-de-pruebas').digest('hex'));
  assert.ok(opciones.signal, 'con tiempo máximo');
});

test('real: un identificador raro no se pide y un error de Meta se cuenta', async () => {
  let llamadas = 0;
  const fetch = async () => {
    llamadas++;
    return { ok: false, status: 400, json: async () => ({ error: { message: 'Unsupported get request' } }) };
  };
  const meta = crearMeta('real', { env: { META_TOKEN_PAGINA: 'token-de-pruebas' }, fetch });
  await assert.rejects(meta.obtenerLead('123/../me'), /no válido/);
  assert.equal(llamadas, 0);
  await assert.rejects(meta.obtenerLead('900000000000004'), (err) => /Meta 400: Unsupported get request/.test(err.message) && err.permanente === true);
});

test('real: lo que se arregla solo (Meta caída, límite de llamadas) se reintenta; token caducado, no', async () => {
  const respuesta = { status: 500, error: { message: 'An unknown error occurred', code: 1 } };
  const fetch = async () => ({ ok: false, status: respuesta.status, json: async () => ({ error: respuesta.error }) });
  const meta = crearMeta('real', { env: { META_TOKEN_PAGINA: 'token-de-pruebas' }, fetch });
  await assert.rejects(meta.obtenerLead('900000000000005'), (err) => err.permanente === false);
  Object.assign(respuesta, { status: 400, error: { message: 'Application request limit reached', code: 4 } });
  await assert.rejects(meta.obtenerLead('900000000000005'), (err) => err.permanente === false);
  Object.assign(respuesta, { status: 400, error: { message: 'Error validating access token: Session has expired', code: 190 } });
  await assert.rejects(meta.obtenerLead('900000000000005'), (err) => err.permanente === true);
});
