// Login de la mesa en modo web (ARQUITECTURA-WEB W3): POST /api/login con
// { usuario, clave } en JSON. La cookie de sesión la pone el servidor
// (HttpOnly: esta página no la ve). Dentro, al panel.
(function () {
  'use strict';
  const form = document.getElementById('formulario');
  const usuario = document.getElementById('usuario');
  const clave = document.getElementById('clave');
  const error = document.getElementById('error');
  const boton = document.getElementById('entrar');
  let cuentaAtras = null;

  function mostrarError(texto) {
    error.textContent = texto;
    error.hidden = !texto;
  }

  // Frenado (429): el botón no vuelve hasta que pase la espera.
  function frenar(seg) {
    if (cuentaAtras) clearInterval(cuentaAtras);
    let queda = Math.max(1, Math.ceil(seg));
    boton.disabled = true;
    const pintar = () => { boton.textContent = queda > 90 ? `Espera ${Math.ceil(queda / 60)} min` : `Espera ${queda} s`; };
    pintar();
    cuentaAtras = setInterval(() => {
      queda -= 1;
      if (queda <= 0) { clearInterval(cuentaAtras); cuentaAtras = null; boton.disabled = false; boton.textContent = 'Entrar'; return; }
      pintar();
    }, 1000);
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (boton.disabled) return;
    const u = usuario.value.trim();
    const c = clave.value;
    if (!u || !c) { mostrarError('Escribe el usuario y la contraseña.'); (u ? clave : usuario).focus(); return; }
    mostrarError('');
    boton.disabled = true;
    boton.textContent = 'Entrando…';
    let r = null;
    let datos = null;
    try {
      r = await fetch('/api/login', {
        method: 'POST', cache: 'no-store', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ usuario: u, clave: c }),
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
    boton.disabled = false;
    boton.textContent = 'Entrar';
    if (!r) mostrarError('Sin conexión con la mesa: comprueba la red y vuelve a intentarlo.');
    else if (r.status === 429) { mostrarError((datos && datos.mensaje) || 'Demasiados intentos fallidos: espera un poco.'); frenar((datos && datos.esperaSeg) || Number(r.headers.get('retry-after')) || 60); }
    else mostrarError((datos && datos.mensaje) || `La mesa respondió ${r.status}.`);
    if (r && r.status === 401) { clave.value = ''; clave.focus(); }
  });

  usuario.focus();
  if (window.MesaPWA) window.MesaPWA.activar({ pista: document.getElementById('pista-ios'), cerrar: document.getElementById('cerrar-pista') });
}());
