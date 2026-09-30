'use strict';
// Lo común a los trabajos del cron con servicios de fuera (Google en servidor/ficha-google.js y
// DataForSEO en servidor/posiciones.js): qué adaptador se usa, la tarea para una persona cuando algo
// falla y las marcas de «una vez al día o a la semana».
const cola = require('./cola');

const DOS_HORAS = 2 * 3600000;
const QUINCE_MIN = 15 * 60000;

// Con `node --test` nunca se crea un adaptador real a partir del entorno: una prueba no puede llamar a
// un servicio de verdad aunque el .env del portátil tenga claves (las pruebas pasan el suyo, con un
// fetch falso). Aquí el cron ni lo intenta (no está en real); además, un adaptador real sin el fetch
// de la prueba no sale a internet (llamadas.fetchDe), lo cree quien lo cree.
const bajoPruebas = (env) => env === process.env && Boolean(process.env.NODE_TEST_CONTEXT);

/**
 * El adaptador real para el cron: el que venga en deps[clave] (las pruebas), si está en real, o el de
 * la configuración si env[variable] es «real». null si no toca. Sin credenciales, crear() lanza y el
 * error sale en el informe del cron.
 */
function adaptadorReal(deps, { clave, variable, crear }, env = process.env) {
  if (deps[clave]) return deps[clave].modo === 'real' ? deps[clave] : null;
  if (env[variable] !== 'real' || bajoPruebas(env)) return null;
  deps[clave] = crear(env);
  return deps[clave];
}

const enReal = (deps, { clave, variable }, env = process.env) => (deps[clave] ? deps[clave].modo === 'real' : env[variable] === 'real' && !bajoPruebas(env));

// Una tarea para una persona, una sola abierta por asunto; si llega urgente, la abierta pasa a urgente.
async function tareaUnica(pool, { titulo, urgente = false, ahora = new Date() }) {
  const t = titulo.slice(0, 200);
  const [[abierta]] = await pool.query("SELECT id FROM tareas WHERE estado = 'abierta' AND titulo = ? LIMIT 1", [t]);
  if (abierta) {
    if (urgente) await pool.query('UPDATE tareas SET urgente = TRUE WHERE id = ?', [abierta.id]);
    return abierta.id;
  }
  const [r] = await pool.query("INSERT INTO tareas (tipo, titulo, urgente, vence_en) VALUES ('otro', ?, ?, ?)",
    [t, urgente, new Date(ahora.getTime() + (urgente ? QUINCE_MIN : DOS_HORAS))]);
  return r.insertId;
}

// El trabajo de la cola y, si falla sin arreglo (credenciales, permisos, configuración) o en su último
// intento, una tarea para que una persona lo sepa ya (una por asunto). La cola lo reintenta igual: si
// alguien lo arregla entre medias, sale solo.
function conAviso(pool, ahora, que, fn) {
  return async (carga, extra = {}) => {
    try {
      return await fn(carga, extra);
    } catch (err) {
      const t = extra.trabajo;
      if (err.permanente || (t && t.intentos >= t.max_intentos)) {
        await tareaUnica(pool, { titulo: `${que} (${String(err.message).slice(0, 100)}). Ver docs/GOOGLE.md`, ahora });
      }
      throw err;
    }
  };
}

// cola.unaVez, pero si lo de dentro falla (la base, un momento), la marca se quita y la vuelta
// siguiente lo vuelve a intentar: lo que ya se hubiera encolado no se duplica (va con clave única).
async function unaVez(pool, clave, hasta, fn) {
  try {
    return await cola.unaVez(pool, clave, hasta, fn);
  } catch (err) {
    await pool.query('DELETE FROM candados WHERE nombre = ?', [clave]).catch(() => {});
    throw err;
  }
}

module.exports = { bajoPruebas, adaptadorReal, enReal, tareaUnica, conAviso, unaVez };
