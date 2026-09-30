// Alta con el enlace de un solo uso (src/web/alta.js): el token viene detrás
// de «#» (no llega al servidor en la URL) y se manda en el cuerpo del POST.
(function () {
  'use strict';
  const token = decodeURIComponent(location.hash.slice(1));
  // Fuera de la barra de direcciones y del historial en cuanto se ha leído.
  try { history.replaceState(null, '', '/alta'); } catch (_) { /* sin historial */ }
  const form = document.getElementById('formulario');
  const usuario = document.getElementById('usuario');
  const clave = document.getElementById('clave');
  const clave2 = document.getElementById('clave2');
  const error = document.getElementById('error');
  const boton = document.getElementById('entrar');

  function mostrarError(texto) {
    error.textContent = texto;
    error.hidden = !texto;
  }

  if (!token) {
    mostrarError('Este enlace está incompleto. Ábrelo entero, tal como te llegó.');
    boton.disabled = true;
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (boton.disabled) return;
    const u = usuario.value.trim();
    const c = clave.value;
    if (!u || !c) { mostrarError('Escribe el usuario y la contraseña.'); (u ? clave : usuario).focus(); return; }
    if ([...c].length < 12) { mostrarError('La contraseña tiene que tener al menos 12 caracteres.'); clave.focus(); return; }
    if (c !== clave2.value) { mostrarError('Las dos contraseñas no coinciden.'); clave2.value = ''; clave2.focus(); return; }
    mostrarError('');
    boton.disabled = true;
    boton.textContent = 'Creando…';
    let r = null;
    let datos = null;
    try {
      r = await fetch('/api/alta', {
        method: 'POST', cache: 'no-store', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, usuario: u, clave: c }),
      });
      try { datos = await r.json(); } catch (_) { datos = null; }
    } catch (_) {
      r = null;
    }
    if (r && r.ok && datos && datos.ok) {
      boton.textContent = 'Dentro';
      location.replace('/');
      return;
    }
    boton.textContent = 'Crear y entrar';
    boton.disabled = Boolean(r && r.status === 410);
    if (!r) mostrarError('Sin conexión con la mesa: comprueba la red y vuelve a intentarlo.');
    else mostrarError((datos && datos.mensaje) || `La mesa respondió ${r.status}.`);
  });

  usuario.focus();
  if (window.MesaPWA) window.MesaPWA.activar({ pista: document.getElementById('pista-ios'), cerrar: document.getElementById('cerrar-pista') });
}());
