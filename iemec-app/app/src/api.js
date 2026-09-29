// Llamadas a la API del panel. Si la sesión caduca, la app vuelve a la pantalla de entrada.
export async function api(ruta, { metodo = 'GET', cuerpo } = {}) {
  const r = await fetch(`/api${ruta}`, {
    method: metodo,
    headers: cuerpo ? { 'Content-Type': 'application/json' } : undefined,
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    credentials: 'same-origin',
  });
  if (r.status === 401) { window.dispatchEvent(new Event('iemec:sin-sesion')); throw new Error('Hay que entrar al panel'); }
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(datos.error || 'Algo ha fallado'); e.codigo = datos.codigo; throw e; }
  return datos;
}

export const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const fmt = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtDia = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', weekday: 'long', day: 'numeric', month: 'long' });
export const fechaHora = (d) => (d ? fmt.format(new Date(d)) : '—');
export const diaLargo = (f) => fmtDia.format(new Date(`${f}T12:00:00Z`));
export const euros = (n) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0);
export const hoyMadrid = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
export function sumarDias(f, n) { const d = new Date(`${f}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
