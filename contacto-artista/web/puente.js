/*
 * puente.js — la lógica de la página puente.
 *
 * Hace cuatro cosas y ninguna más:
 *  1. Monta el enlace de WhatsApp con el mensaje ya escrito, metiendo el nombre
 *     de la sala si viene en la URL.
 *  2. Detecta los navegadores embebidos de Instagram, TikTok y Facebook, que
 *     ignoran a propósito los enlaces universales: ahí el botón de WhatsApp no
 *     abre la aplicación y la persona acaba en una pantalla de inicio de sesión
 *     de WhatsApp Web sin entender qué ha pasado. Cuando detecta uno, avisa y
 *     ofrece copiar el número.
 *  3. Avisa al servidor de que ha habido una visita, sin cookies y sin guardar
 *     nada que identifique a nadie.
 *  4. Pinta los botones secundarios que existan.
 *
 * Nada de esto bloquea la página: si el JavaScript falla, el HTML ya trae un
 * botón de WhatsApp utilizable.
 */
(function () {
  'use strict';

  var A = window.AJUSTES;
  if (!A) return;

  // ------------------------------------------------------ parámetros de la URL
  var parametros = new URLSearchParams(window.location.search);
  var origen = (parametros.get('f') || 'directo').slice(0, 24);
  var sala = (parametros.get('sala') || '').slice(0, 60);

  // ------------------------------------------------------------- los textos
  document.getElementById('nombre').textContent = A.nombre;
  document.getElementById('saludo').textContent = A.saludo;
  document.getElementById('textoWhatsapp').textContent = A.botonWhatsapp;
  document.getElementById('avisoEnviar').textContent = A.avisoEnviar;
  document.getElementById('guardar').textContent = A.botonGuardar;
  document.title = A.nombre;

  var nota = document.getElementById('nota');
  nota.textContent = A.privacidad;
  if (A.enlacePrivacidad) {
    nota.insertAdjacentHTML('beforeend', ' <a href="' + A.enlacePrivacidad + '">Más información</a>.');
  }

  // -------------------------------------------------------- enlace WhatsApp
  // Sin sala se usa el texto alternativo entero, no una sustitución a medias:
  // un «Vengo de verte en {sala}» enviado tal cual rompe el hechizo en el primer
  // segundo y se lleva por delante todo el trabajo.
  var mensaje = sala ? A.mensaje.replace('{sala}', sala) : A.mensajeSinSala;
  var enlaceWa = 'https://wa.me/' + A.telefono + '?text=' + encodeURIComponent(mensaje);
  var boton = document.getElementById('whatsapp');
  boton.setAttribute('href', enlaceWa);

  // ----------------------------------------------------- navegador embebido
  function esNavegadorEmbebido(ua) {
    return /Instagram|FBAN|FBAV|FB_IAB|TikTok|musical_ly|BytedanceWebview|Trill|Snapchat|LinkedInApp|Line\//i.test(ua);
  }
  var ua = navigator.userAgent || '';
  var esAndroid = /Android/i.test(ua);

  if (esNavegadorEmbebido(ua)) {
    document.getElementById('aviso').classList.add('visible');

    // En Android hay una salida limpia: el enlace intent:// sí despierta la
    // aplicación aunque estemos dentro de la webview de otra app.
    if (esAndroid) {
      boton.setAttribute(
        'href',
        'intent://send?phone=' + A.telefono + '&text=' + encodeURIComponent(mensaje) +
        '#Intent;scheme=whatsapp;package=com.whatsapp;S.browser_fallback_url=' +
        encodeURIComponent(enlaceWa) + ';end'
      );
    }
  }

  var copiar = document.getElementById('copiar');
  copiar.addEventListener('click', function () {
    var numero = A.telefonoLegible;
    var aviso = document.getElementById('copiado');
    function hecho() { aviso.classList.add('visible'); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(numero).then(hecho, respaldo);
    } else {
      respaldo();
    }
    function respaldo() {
      var campo = document.createElement('textarea');
      campo.value = numero;
      campo.setAttribute('readonly', '');
      campo.style.position = 'fixed';
      campo.style.opacity = '0';
      document.body.appendChild(campo);
      campo.select();
      try { document.execCommand('copy'); hecho(); } catch (e) { window.prompt('Copia el número:', numero); }
      document.body.removeChild(campo);
    }
  });

  // ------------------------------------------------------ botones de apoyo
  var canal = document.getElementById('canal');
  if (A.canal) {
    canal.setAttribute('href', A.canal);
    canal.textContent = A.textoCanal || 'Sígueme en mi canal';
    canal.hidden = false;
  }

  var secundarios = document.getElementById('secundarios');
  (A.enlaces || []).forEach(function (e) {
    if (!e.url) return;
    var a = document.createElement('a');
    a.className = 'suave';
    a.href = e.url;
    a.textContent = e.nombre;
    a.rel = 'noopener';
    secundarios.appendChild(a);
  });

  // ------------------------------------------------------------- recuento
  // Solo un número por soporte. Ni cookie, ni identificador, ni IP guardada:
  // por eso no hace falta ni banner ni consentimiento.
  if (A.medir && A.rutaMedicion) {
    var url = A.rutaMedicion + '?f=' + encodeURIComponent(origen) + '&modo=aviso';
    try {
      if (navigator.sendBeacon) navigator.sendBeacon(url);
      else new Image().src = url;
    } catch (e) { /* que no se mida nunca puede romper la página */ }
  }

  // ------------------------------------------- apertura automática opcional
  // Apagado por defecto. Ver docs/01-analisis-metodos.md.
  if (A.abrirAutomatico && !esNavegadorEmbebido(ua)) {
    setTimeout(function () { window.location.href = enlaceWa; }, 350);
  }
})();
