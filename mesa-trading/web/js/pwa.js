// La mesa como app (PWA) en modo web: registra el service worker y, en el
// Safari del iPhone, enseña UNA vez la pista «Compartir → Añadir a pantalla de
// inicio» (iOS no ofrece instalar solo). En el modo local no se llama.
(function (raiz) {
  'use strict';
  const CLAVE_PISTA = 'mesa.pistaIosVista';

  function esIOS() {
    const n = raiz.navigator || {};
    return /iPad|iPhone|iPod/.test(n.userAgent || '') || (n.platform === 'MacIntel' && n.maxTouchPoints > 1);
  }
  function esSafari() {
    const ua = (raiz.navigator && raiz.navigator.userAgent) || '';
    return /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua);
  }
  function instalada() {
    try { if (raiz.matchMedia && raiz.matchMedia('(display-mode: standalone)').matches) return true; } catch (_) { /* viejo */ }
    return raiz.navigator && raiz.navigator.standalone === true;
  }
  function leer(k) { try { return raiz.localStorage.getItem(k); } catch (_) { return null; } }
  function guardar(k, v) { try { raiz.localStorage.setItem(k, v); } catch (_) { /* privado */ } }

  function registrar() {
    const n = raiz.navigator;
    if (!n || !('serviceWorker' in n) || !raiz.isSecureContext) return Promise.resolve(null);
    return n.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => null);
  }

  function pista(el, cerrar) {
    if (!el || instalada() || !esIOS() || !esSafari() || leer(CLAVE_PISTA)) return false;
    el.hidden = false;
    const fuera = () => { el.hidden = true; guardar(CLAVE_PISTA, '1'); };
    if (cerrar) cerrar.addEventListener('click', fuera);
    return true;
  }

  let activada = false;
  function activar({ pista: el = null, cerrar = null } = {}) {
    if (activada) return;
    activada = true;
    if (raiz.document && raiz.document.readyState === 'complete') registrar();
    else raiz.addEventListener('load', registrar, { once: true });
    pista(el, cerrar);
  }

  raiz.MesaPWA = { activar, registrar, esIOS, esSafari, instalada };
}(typeof globalThis !== 'undefined' ? globalThis : this));
