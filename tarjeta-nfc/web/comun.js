// Utilidades compartidas por las tres pantallas.

export const $ = (sel) => document.querySelector(sel);

export const claveIdem = () =>
  (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export const euros = (cents) =>
  cents == null ? '' : (cents / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });

export const fecha = (iso) =>
  new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });

// --- sesion del empleado ----------------------------------------------------

export const sesion = {
  get token() { return localStorage.getItem('sesion') ?? null; },
  get quien() { try { return JSON.parse(localStorage.getItem('staff') ?? 'null'); } catch { return null; } },
  guardar(token, staff) {
    localStorage.setItem('sesion', token);
    localStorage.setItem('staff', JSON.stringify(staff));
  },
  cerrar() { localStorage.removeItem('sesion'); localStorage.removeItem('staff'); },
};

export async function api(metodo, ruta, cuerpo) {
  const res = await fetch(ruta, {
    method: metodo,
    headers: { 'content-type': 'application/json',
               ...(sesion.token ? { authorization: `Bearer ${sesion.token}` } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const datos = await res.json().catch(() => ({}));
  if (res.status === 401 && sesion.token) { sesion.cerrar(); location.reload(); }
  return { ok: res.ok, estado: res.status, datos };
}

// --- cola offline -----------------------------------------------------------
// El wifi del local se cae. Los taps se guardan y se reintentan; como cada uno
// lleva su clave de idempotencia, reenviarlos no duplica puntos.

const COLA = 'cola_pendiente';
const leerCola = () => { try { return JSON.parse(localStorage.getItem(COLA) ?? '[]'); } catch { return []; } };
const guardarCola = (c) => localStorage.setItem(COLA, JSON.stringify(c));

export const pendientes = () => leerCola().length;

export function encolar(ruta, cuerpo) {
  guardarCola([...leerCola(), { ruta, cuerpo, ts: Date.now() }]);
}

export async function vaciarCola() {
  let cola = leerCola();
  if (!cola.length || !navigator.onLine) return 0;
  let enviados = 0;
  for (const item of [...cola]) {
    const r = await api('POST', item.ruta, item.cuerpo).catch(() => null);
    // 4xx que no sea 408/429 es un no definitivo: sacarlo de la cola o se atasca.
    const definitivo = r && (r.ok || (r.estado >= 400 && r.estado < 500 && ![408, 429].includes(r.estado)));
    if (definitivo) { cola = cola.filter((x) => x !== item); enviados++; }
    else break;
  }
  guardarCola(cola);
  return enviados;
}

// --- Web NFC ----------------------------------------------------------------

export const hayNfc = () => 'NDEFReader' in window;

/**
 * Empieza a escuchar tarjetas. Devuelve una funcion para parar.
 * En iOS no existe NDEFReader: hay que usar el QR o teclear el UID (ver docs/03).
 */
export async function escuchar(alLeer, alFallar) {
  if (!hayNfc()) { alFallar?.(new Error('Este navegador no lee NFC')); return () => {}; }
  const lector = new NDEFReader();
  const abortar = new AbortController();
  try {
    await lector.scan({ signal: abortar.signal });
  } catch (e) { alFallar?.(e); return () => {}; }

  lector.onreading = ({ serialNumber, message }) => {
    let token = null;
    for (const registro of message.records ?? []) {
      if (registro.recordType !== 'url') continue;
      const url = new TextDecoder().decode(registro.data);
      const m = url.match(/\/t\/([\w-]+)/);
      if (m) token = m[1];
    }
    alLeer({ uid: serialNumber, token });
  };
  lector.onreadingerror = () => alFallar?.(new Error('Lectura fallida, vuelve a acercarla'));
  return () => abortar.abort();
}
