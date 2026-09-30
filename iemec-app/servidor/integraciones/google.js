'use strict';
// Google detrás de un adaptador: la ficha de la clínica en Google Business Profile (reseñas, nuestras
// respuestas, datos de la ficha, métricas y publicaciones) y Places (New), este solo para la ficha
// propia (en el EEE su contenido no se puede usar para vigilar a la competencia).
//   · simulado (por defecto): trabaja con lo que se le da (reseñas, ficha, métricas) y guarda lo que
//     publicaría. Nunca sale a internet: pruebas y demo.
//   · real: las APIs de Google con OAuth 2.0 (el token de refresco de una cuenta gestora de la ficha,
//     scope business.manage) y, para Places, una clave de API. Google tiene que aprobar antes el acceso
//     a la API (puerta ⛔ 6). Pasos y variables: docs/GOOGLE.md.
//
// Lo que ofrece (los dos modos):
//   listarResenas({ desde })          las reseñas, 50 por página, de la última tocada hacia atrás; con
//                                     «desde», solo las tocadas desde entonces
//   paginaResenas({ pagina })         una página, con la nota media y el total de la ficha
//   obtenerResena(googleId)           una reseña (la de un aviso de Pub/Sub); null si no tiene nota
//   responderResena(googleId, texto)  crea o cambia nuestra respuesta → { ok, estado, actualizadaEn }
//   borrarRespuesta(googleId)         quita nuestra respuesta (la reseña no se puede borrar por API)
//   obtenerFicha({ refrescar })       { placeId, newReviewUri, … } de Business Information (o, sin
//                                     ella, de Places); se guarda unas horas en memoria
//   metricasDiarias({ desde, hasta }) Performance API → [{ fecha, metrica, valor }]
//   palabrasDelMes('AAAA-MM')         las búsquedas con las que salió la ficha → [{ palabra,
//                                     impresiones, umbral }] (umbral: Google solo da «menos de N»)
//   publicarNovedad({ texto, botonUrl, aprobadaPor })  un post de la ficha, solo si lo aprueba una
//                                     persona y pasa el filtro de publicidad sanitaria
//   fichaPlaces()                     Places, SIEMPRE nuestra ficha: nota, total, enlace para reseñar y
//                                     el aviso de reseñas sospechosas. No admite otro lugar
// Una reseña, en la app: { googleId, autor, nota 1-5, texto, publicadaEn, actualizadaEn, respuesta,
// respondidaEn, estadoRespuesta ('pendiente' | 'aprobada' | 'rechazada' | null), motivoRechazo }. Ni la
// foto de quien la escribe ni sus fotos o vídeos: no hacen falta.
const crypto = require('crypto');
const { revisar } = require('../../motor/repesca/filtro-legal');
const { conReintentos, crearCuota, errorExterno, leerJson, esperarDeVerdad } = require('./llamadas');

const URL_TOKEN = 'https://oauth2.googleapis.com/token';
const V4 = 'https://mybusiness.googleapis.com/v4';
const INFORMACION = 'https://mybusinessbusinessinformation.googleapis.com/v1';
const CUENTAS = 'https://mybusinessaccountmanagement.googleapis.com/v1';
const RENDIMIENTO = 'https://businessprofileperformance.googleapis.com/v1';
const AVISOS = 'https://mybusinessnotifications.googleapis.com/v1';
const PLACES = 'https://places.googleapis.com/v1';
const CERTIFICADOS = 'https://www.googleapis.com/oauth2/v3/certs';

// Cuotas: 300 consultas por minuto por API; las ediciones, 10 por minuto por ficha. Se deja margen.
const CUOTAS = { porMinuto: 250, escriturasPorMinuto: 10 };
const MAX_BYTES_RESPUESTA = 4096;
const MAX_TEXTO_POST = 1500;
const LECTURA_FICHA = 'name,title,categories,regularHours,latlng,metadata,phoneNumbers,websiteUri';
const CAMPOS_PLACES = ['id', 'rating', 'userRatingCount', 'googleMapsLinks', 'consumerAlert'];
// Los avisos que interesan (los de preguntas y respuestas están cerrados desde 2025).
const TIPOS_AVISO = ['NEW_REVIEW', 'UPDATED_REVIEW', 'GOOGLE_UPDATE', 'NEW_CUSTOMER_MEDIA', 'DUPLICATE_LOCATION', 'VOICE_OF_MERCHANT_UPDATED'];

const ESTRELLAS = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
const ESTADOS_RESPUESTA = { PENDING: 'pendiente', APPROVED: 'aprobada', REJECTED: 'rechazada' };
// Por qué Google rechaza una respuesta (enum PolicyViolation): los que más pueden pasar en una clínica.
const MOTIVOS_RECHAZO = {
  PERSONAL_INFO: 'Datos personales (entre ellos, datos de salud)',
  REGULATED_GOODS_AND_SERVICES: 'Productos o servicios regulados',
  ADVERTISING_AND_SOLICITATION: 'Publicidad o captación',
  REPETITIVE: 'Respuesta repetida: demasiado parecida a otras',
  FAKE_ENGAGEMENT: 'Interacción falsa',
};
const ESTADOS_POST = { LIVE: 'publicada', PROCESSING: 'en_revision', REJECTED: 'rechazada', SCHEDULED: 'programada', RECURRING: 'recurrente' };
// Métricas diarias de la Performance API, con su nombre en la app (metricas_gbp.metrica).
const METRICAS = {
  BUSINESS_IMPRESSIONS_MOBILE_MAPS: 'impresiones_maps_movil',
  BUSINESS_IMPRESSIONS_DESKTOP_MAPS: 'impresiones_maps_ordenador',
  BUSINESS_IMPRESSIONS_MOBILE_SEARCH: 'impresiones_busqueda_movil',
  BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: 'impresiones_busqueda_ordenador',
  CALL_CLICKS: 'llamadas',
  WEBSITE_CLICKS: 'clics_web',
  BUSINESS_DIRECTION_REQUESTS: 'rutas',
  BUSINESS_CONVERSATIONS: 'conversaciones',
  BUSINESS_BOOKINGS: 'reservas_google',
};
const DIAS = { MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4, FRIDAY: 5, SATURDAY: 6, SUNDAY: 7 };
const FICHA_VACIA = {
  origen: null, placeId: null, newReviewUri: null, mapsUri: null, nombre: null, categoriaPrincipal: null,
  categoriasAdicionales: [], horario: [], latitud: null, longitud: null, telefono: null, web: null,
  conVoz: null, googleHaCambiado: null, puedePublicar: null,
};

// ── De Google a la app ─────────────────────────────────────────────────────────────────────

function isoDe(valor) {
  if (!valor) return null;
  const t = new Date(valor);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

function aResena(g = {}) {
  const r = g.reviewReply || null;
  const motivo = r?.policyViolation && r.policyViolation !== 'POLICY_VIOLATION_UNSPECIFIED' ? String(r.policyViolation) : null;
  return {
    googleId: g.reviewId || String(g.name || '').split('/').pop() || null,
    autor: g.reviewer?.isAnonymous ? null : (g.reviewer?.displayName || null),
    nota: ESTRELLAS[g.starRating] || null,
    texto: g.comment || null,
    publicadaEn: isoDe(g.createTime),
    actualizadaEn: isoDe(g.updateTime),
    respuesta: r?.comment || null,
    respondidaEn: isoDe(r?.updateTime),
    estadoRespuesta: r ? ESTADOS_RESPUESTA[r.reviewReplyState] || null : null,
    motivoRechazo: motivo,
    motivoRechazoTexto: motivo ? MOTIVOS_RECHAZO[motivo] || 'Incumple las normas de Google' : null,
  };
}

const hora = (t = {}) => `${String(t.hours || 0).padStart(2, '0')}:${String(t.minutes || 0).padStart(2, '0')}`;

function aFicha(l = {}) {
  const m = l.metadata || {};
  return {
    ...FICHA_VACIA,
    origen: 'perfil',
    placeId: m.placeId || null,
    newReviewUri: m.newReviewUri || null,
    mapsUri: m.mapsUri || null,
    nombre: l.title || null,
    categoriaPrincipal: l.categories?.primaryCategory?.displayName || null,
    categoriasAdicionales: (l.categories?.additionalCategories || []).map((c) => c.displayName).filter(Boolean),
    horario: (l.regularHours?.periods || []).filter((p) => DIAS[p.openDay])
      .map((p) => ({ dia: DIAS[p.openDay], abre: hora(p.openTime), cierra: hora(p.closeTime) })),
    latitud: l.latlng?.latitude ?? null,
    longitud: l.latlng?.longitude ?? null,
    telefono: l.phoneNumbers?.primaryPhone || null,
    web: l.websiteUri || null,
    conVoz: m.hasVoiceOfMerchant ?? null,
    googleHaCambiado: m.hasGoogleUpdated ?? null,
    puedePublicar: m.canOperateLocalPost ?? null,
  };
}

function aFichaPlaces(p = {}) {
  return {
    ...FICHA_VACIA,
    origen: 'places',
    placeId: p.id || null,
    newReviewUri: p.googleMapsLinks?.writeAReviewUri || null,
    mapsUri: p.googleMapsLinks?.placeUri || null,
    nota: p.rating ?? null,
    total: p.userRatingCount ?? null,
    avisoConsumidor: Boolean(p.consumerAlert),
  };
}

const fechaDe = (d = {}) => `${String(d.year).padStart(4, '0')}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;

function aMetricas(d = {}) {
  const filas = [];
  for (const m of d.multiDailyMetricTimeSeries || []) {
    for (const s of m.dailyMetricTimeSeries || []) {
      const metrica = METRICAS[s.dailyMetric] || String(s.dailyMetric || '').toLowerCase();
      if (!metrica) continue;
      // Google no manda el valor de los días con 0.
      for (const v of s.timeSeries?.datedValues || []) if (v.date?.year) filas.push({ fecha: fechaDe(v.date), metrica, valor: Number(v.value || 0) });
    }
  }
  return filas;
}

const numeroONulo = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
const aPalabra = (x = {}) => ({
  palabra: String(x.searchKeyword || '').slice(0, 160),
  impresiones: numeroONulo(x.insightsValue?.value),
  umbral: x.insightsValue?.threshold != null ? String(x.insightsValue.threshold).slice(0, 20) : null,
});

// ── Comprobaciones comunes a los dos modos ─────────────────────────────────────────────────

// El identificador de una reseña va en la ruta de la URL: solo letras, números, «_», «-» y «=».
function idResena(googleId) {
  const id = String(googleId ?? '');
  if (!/^[A-Za-z0-9_=-]{1,300}$/.test(id)) throw errorExterno(`Identificador de reseña no válido: ${id.slice(0, 40)}`, { permanente: true });
  return id;
}

function comprobarRespuesta(texto) {
  const t = String(texto ?? '').trim();
  if (!t) throw errorExterno('La respuesta está vacía', { permanente: true });
  const bytes = Buffer.byteLength(t, 'utf8');
  if (bytes > MAX_BYTES_RESPUESTA) throw errorExterno(`La respuesta ocupa ${bytes} bytes y Google admite ${MAX_BYTES_RESPUESTA}: hay que acortarla`, { permanente: true });
  return t;
}

// Un post es publicidad al público: lo aprueba una persona, pasa el filtro de publicidad sanitaria
// (nada de medicamentos con receta, marcas de productos sanitarios ni promesas) y el botón lleva a
// una dirección https (la reserva de la app o WhatsApp con su código de origen).
function comprobarNovedad({ texto, botonUrl = null, aprobadaPor }) {
  if (!aprobadaPor || !String(aprobadaPor).trim()) throw errorExterno('Una publicación en Google solo sale si la aprueba una persona', { permanente: true });
  const t = String(texto ?? '').trim();
  if (!t) throw errorExterno('La publicación está vacía', { permanente: true });
  if (t.length > MAX_TEXTO_POST) throw errorExterno(`La publicación tiene ${t.length} caracteres y Google admite ${MAX_TEXTO_POST}`, { permanente: true });
  const legal = revisar(t, { tipo: 'marketing', tieneBaja: true });
  if (!legal.ok) throw errorExterno(`La publicación no pasa el filtro de publicidad sanitaria: ${legal.errores.join(' ')}`, { permanente: true });
  if (botonUrl != null) {
    let u = null;
    try { u = new URL(botonUrl); } catch { /* se dice abajo */ }
    if (!u || u.protocol !== 'https:') throw errorExterno('El botón de la publicación tiene que llevar a una dirección https', { permanente: true });
  }
  return t;
}

// ── Aviso de Pub/Sub ───────────────────────────────────────────────────────────────────────

const RX_RESENA = /^accounts\/(\d+)\/locations\/(\d+)\/reviews\/([A-Za-z0-9_=-]+)$/;
const RX_FICHA = /^(?:accounts\/(\d+)\/)?locations\/(\d+)$/;

/**
 * Lo que trae un aviso push de Pub/Sub: { message: { data: base64(JSON), attributes, messageId,
 * publishTime }, subscription }. Google no publica un ejemplo del JSON de dentro: la referencia dice
 * «review_name» y «location_name» (v1) o «reviewName» y «locationName» (v4). Se aceptan esas
 * variantes y, si no, se busca un nombre de reseña o de ficha en cualquier campo de texto.
 * @returns {{ idMensaje, tipo, resena: {cuenta, ubicacion, id}|null, ficha: {cuenta, ubicacion}|null, publicadoEn }}
 */
function leerAvisoPubSub(cuerpo) {
  const m = cuerpo && typeof cuerpo.message === 'object' && cuerpo.message ? cuerpo.message : {};
  let datos = {};
  try {
    const v = JSON.parse(Buffer.from(String(m.data || ''), 'base64').toString('utf8'));
    if (v && typeof v === 'object') datos = v;
  } catch { /* sin datos: se mira en los atributos */ }
  const campos = { ...(m.attributes && typeof m.attributes === 'object' ? m.attributes : {}), ...datos };
  const textos = Object.values(campos).filter((v) => typeof v === 'string');
  const primero = (claves, rx) => claves.map((k) => campos[k]).find((v) => typeof v === 'string' && rx.test(v)) || textos.find((t) => rx.test(t)) || null;
  const nombreResena = primero(['review_name', 'reviewName', 'review'], RX_RESENA);
  const nombreFicha = primero(['location_name', 'locationName', 'location'], RX_FICHA);
  const r = nombreResena ? RX_RESENA.exec(nombreResena) : null;
  const f = nombreFicha ? RX_FICHA.exec(nombreFicha) : null;
  const tipo = String(campos.type || campos.notificationType || campos.notification_type || '').toUpperCase().replace(/[^A-Z_]/g, '').slice(0, 60);
  return {
    idMensaje: String(m.messageId || m.message_id || '').slice(0, 100) || null,
    tipo: tipo || null,
    resena: r ? { cuenta: r[1], ubicacion: r[2], id: r[3] } : null,
    ficha: r ? { cuenta: r[1], ubicacion: r[2] } : f ? { cuenta: f[1] || null, ubicacion: f[2] } : null,
    publicadoEn: isoDe(m.publishTime || m.publish_time),
  };
}

/**
 * Comprueba el token OIDC que Pub/Sub pone en «Authorization: Bearer …» de cada aviso push: firma
 * RS256 con las claves públicas de Google, emisor, caducidad, audiencia y la cuenta de servicio de la
 * suscripción (con el correo verificado). Las claves se guardan en memoria lo que diga Cache-Control;
 * una clave desconocida vuelve a pedirlas (Google las rota), como mucho una vez por minuto. Se
 * descargan una sola vez aunque lleguen varios avisos a la vez; si Google no las da, las de antes
 * siguen valiendo y se vuelve a probar a los 30 s; sin ninguna, el error no es del token (503).
 */
function crearVerificadorPubSub({ fetch = globalThis.fetch, reloj = () => new Date(), url = CERTIFICADOS, margenS = 300 } = {}) {
  let claves = new Map();
  let caducan = 0;
  let ultimaCarga = -Infinity;
  let ultimoError = null;
  let cargando = null;
  const fallo = (motivo) => Object.assign(new Error(`Token de Google no válido: ${motivo}`), { motivo });

  async function descargar() {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`No se pudieron leer las claves públicas de Google (${r.status})`);
    const d = await r.json();
    const nuevas = new Map();
    for (const k of d?.keys || []) {
      if (k?.kty !== 'RSA' || !k.kid) continue;
      try {
        nuevas.set(k.kid, crypto.createPublicKey({ key: k, format: 'jwk' }));
      } catch { /* una clave que no se entiende no vale para nada */ }
    }
    if (!nuevas.size) throw new Error('Las claves públicas de Google han llegado vacías');
    const edad = /max-age=(\d+)/.exec(r.headers?.get?.('cache-control') || '');
    return { nuevas, segundos: edad ? Number(edad[1]) : 3600 };
  }

  function cargar() {
    if (!cargando) {
      ultimaCarga = reloj().getTime();
      cargando = descargar()
        .then(({ nuevas, segundos }) => {
          claves = nuevas;
          caducan = reloj().getTime() + segundos * 1000;
          ultimoError = null;
        })
        .catch((err) => {
          caducan = reloj().getTime() + 30000;
          ultimoError = err;
        })
        .finally(() => { cargando = null; });
    }
    return cargando;
  }

  async function clave(kid) {
    const ahora = reloj().getTime();
    if (ahora >= caducan || (!claves.has(kid) && ahora - ultimaCarga > 60000)) await cargar();
    if (!claves.size && ultimoError) throw ultimoError;
    return claves.get(kid) || null;
  }

  return async function verificar(token, { audiencia, email } = {}) {
    const partes = String(token || '').split('.');
    if (partes.length !== 3) throw fallo('no es un JWT');
    const [h, c, firma] = partes;
    let cabecera;
    let carga;
    try {
      cabecera = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
      carga = JSON.parse(Buffer.from(c, 'base64url').toString('utf8'));
    } catch {
      throw fallo('no se puede leer');
    }
    if (cabecera?.alg !== 'RS256' || !cabecera.kid) throw fallo('algoritmo o clave no admitidos');
    const k = await clave(String(cabecera.kid));
    if (!k) throw fallo('clave desconocida');
    if (!crypto.verify('RSA-SHA256', Buffer.from(`${h}.${c}`), k, Buffer.from(firma, 'base64url'))) throw fallo('la firma no cuadra');
    const ahora = Math.floor(reloj().getTime() / 1000);
    if (!['https://accounts.google.com', 'accounts.google.com'].includes(carga.iss)) throw fallo('no lo emite Google');
    if (typeof carga.exp !== 'number' || carga.exp + margenS < ahora) throw fallo('caducado');
    if (typeof carga.iat === 'number' && carga.iat - margenS > ahora) throw fallo('emitido en el futuro');
    if (!audiencia || carga.aud !== audiencia) throw fallo('otra audiencia');
    if (!email || carga.email !== email || carga.email_verified !== true) throw fallo('otra cuenta de servicio');
    return carga;
  };
}

// ── Modo simulado ──────────────────────────────────────────────────────────────────────────

function crearSimulado({ resenas = [], ficha = {}, placeId = null, newReviewUri = null, metricas = [], palabras = {}, places = null } = {}) {
  const almacen = new Map(resenas.map((r) => [String(r.googleId), { ...r }]));
  const publicadas = [];
  const borradas = [];
  const novedades = [];
  const laFicha = { ...FICHA_VACIA, origen: 'simulado', placeId, newReviewUri, ...ficha };
  const lista = () => [...almacen.values()];
  const tocada = (r) => new Date(r.actualizadaEn || r.publicadaEn);
  return {
    modo: 'simulado',
    capacidades: { perfil: true, ficha: true, places: true },
    cuenta: null,
    ubicacion: null,
    publicadas,
    borradas,
    novedades,
    async listarResenas({ desde = null } = {}) {
      return desde ? lista().filter((r) => tocada(r) >= new Date(desde)) : lista();
    },
    async paginaResenas() {
      const l = lista();
      const media = l.length ? Math.round((l.reduce((s, r) => s + r.nota, 0) / l.length) * 10) / 10 : null;
      return { resenas: l, siguiente: null, notaMedia: media, total: l.length };
    },
    async obtenerResena(googleId) { return almacen.get(String(googleId)) || null; },
    async responderResena(googleId, texto) {
      const t = comprobarRespuesta(texto);
      publicadas.push({ googleId, texto: t });
      return { ok: true, estado: 'pendiente', actualizadaEn: new Date().toISOString() };
    },
    async borrarRespuesta(googleId) {
      borradas.push(String(googleId));
      return { ok: true };
    },
    async obtenerFicha() { return { ...laFicha }; },
    async metricasDiarias() { return metricas.map((m) => ({ ...m })); },
    async palabrasDelMes(mes) { return (palabras[mes] || []).map((p) => ({ ...p })); },
    async publicarNovedad(p) {
      const texto = comprobarNovedad(p);
      const googleId = `localPosts/SIM${crypto.randomBytes(6).toString('hex')}`;
      novedades.push({ googleId, texto, botonUrl: p.botonUrl || null, aprobadaPor: p.aprobadaPor });
      return { googleId, estado: 'en_revision', url: null };
    },
    async fichaPlaces() {
      return { ...FICHA_VACIA, origen: 'simulado', placeId: laFicha.placeId, newReviewUri: laFicha.newReviewUri, nota: null, total: null, avisoConsumidor: false, ...(places || {}) };
    },
    async listarCuentas() { return []; },
    async listarUbicaciones() { return []; },
    async configurarAvisos(tema) { return { tema, tipos: TIPOS_AVISO }; },
  };
}

// ── Modo real ──────────────────────────────────────────────────────────────────────────────

const soloId = (v, prefijo) => String(v || '').trim().replace(new RegExp(`^${prefijo}/`), '');

// Qué hay configurado. OAuth son las tres variables o ninguna; la ficha, además, cuenta y ubicación
// (se sacan con `node scripts/google.js cuentas`). Places, su clave.
function credenciales(env) {
  const oauth = { GOOGLE_CLIENTE_ID: env.GOOGLE_CLIENTE_ID, GOOGLE_CLIENTE_SECRETO: env.GOOGLE_CLIENTE_SECRETO, GOOGLE_REFRESH_TOKEN: env.GOOGLE_REFRESH_TOKEN };
  const faltan = Object.entries(oauth).filter(([, v]) => !v).map(([k]) => k);
  if (faltan.length && faltan.length < 3) throw new Error(`Google real: faltan ${faltan.join(', ')} (OAuth va con las tres; ver docs/GOOGLE.md)`);
  const cuenta = soloId(env.GOOGLE_CUENTA, 'accounts');
  const ubicacion = soloId(env.GOOGLE_UBICACION, 'locations');
  if (cuenta && !/^\d{1,30}$/.test(cuenta)) throw new Error('Google real: GOOGLE_CUENTA tiene que ser «accounts/123…» o el número');
  if (ubicacion && !/^\d{1,30}$/.test(ubicacion)) throw new Error('Google real: GOOGLE_UBICACION tiene que ser «locations/123…» o el número');
  const placeId = String(env.GOOGLE_PLACE_ID || '').trim();
  if (placeId && !/^[A-Za-z0-9_-]{10,300}$/.test(placeId)) throw new Error('Google real: GOOGLE_PLACE_ID no tiene forma de place ID');
  const c = {
    oauth: faltan.length ? null : { clienteId: env.GOOGLE_CLIENTE_ID, secreto: env.GOOGLE_CLIENTE_SECRETO, refresco: env.GOOGLE_REFRESH_TOKEN },
    cuenta: cuenta || null,
    ubicacion: ubicacion || null,
    placesClave: env.GOOGLE_PLACES_CLAVE || null,
    placeId: placeId || null,
  };
  if (!c.oauth && !c.placesClave) {
    throw new Error('Google real: faltan las credenciales (GOOGLE_CLIENTE_ID, GOOGLE_CLIENTE_SECRETO y GOOGLE_REFRESH_TOKEN, o al menos GOOGLE_PLACES_CLAVE). Hace falta la aprobación de Google: puerta ⛔ 6 y docs/GOOGLE.md');
  }
  return c;
}

const PISTAS = {
  401: 'las credenciales no valen: revisar GOOGLE_CLIENTE_ID, GOOGLE_CLIENTE_SECRETO y GOOGLE_REFRESH_TOKEN',
  403: 'sin permiso: la cuenta de la app tiene que ser gestora de la ficha y la API estar habilitada y aprobada',
  404: 'no existe: revisar GOOGLE_CUENTA y GOOGLE_UBICACION (o ya no está en Google)',
  429: 'cuota agotada; si no se pasa nunca, Google aún no ha aprobado el acceso (0 consultas por minuto)',
};

// Un error de Google, claro y sin datos: el estado, el mensaje de Google (recortado) y qué mirar.
function errorDeGoogle(r, d, servicio = 'Google') {
  const e = d?.error && typeof d.error === 'object' ? d.error : {};
  const detalle = [e.status, e.message].filter(Boolean).join(': ').slice(0, 200);
  const reintentable = r.status === 429 || r.status >= 500;
  const pista = PISTAS[r.status] || (r.status >= 500 ? 'falla en Google: se reintenta' : null);
  return errorExterno(`${servicio} ${r.status}${detalle ? ` ${detalle}` : ''}${pista ? ` (${pista})` : ''}`, { estado: r.status, permanente: !reintentable, reintentable });
}

function crearReal(env = process.env, {
  fetch = globalThis.fetch, esperar = esperarDeVerdad, reloj = () => new Date(), azar = Math.random,
  cuotas = {}, horasFicha = 12, reintentos = 3,
} = {}) {
  const c = credenciales(env);
  const limites = { ...CUOTAS, ...cuotas };
  const reintentar = { reintentos, esperar, azar, reloj, nombre: 'Google' };
  const porServicio = new Map();
  const cuotaDe = (url) => {
    const host = new URL(url).host;
    if (!porServicio.has(host)) porServicio.set(host, crearCuota(limites.porMinuto, { reloj, esperar, nombre: host }));
    return porServicio.get(host);
  };
  const cuotaEscrituras = crearCuota(limites.escriturasPorMinuto, { reloj, esperar, nombre: 'la ficha (ediciones)' });

  // ── Token de acceso: se pide con el de refresco y se reutiliza hasta un minuto antes de caducar.
  let token = null;
  let pidiendo = null;
  async function pedirToken() {
    const cuerpo = new URLSearchParams({ client_id: c.oauth.clienteId, client_secret: c.oauth.secreto, refresh_token: c.oauth.refresco, grant_type: 'refresh_token' });
    const r = await conReintentos(() => fetch(URL_TOKEN, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: cuerpo.toString(), signal: AbortSignal.timeout(15000),
    }), reintentar);
    const d = await leerJson(r);
    if (r.ok && d.access_token) {
      token = { valor: d.access_token, caduca: reloj().getTime() + (Number(d.expires_in) || 3600) * 1000 };
      return token.valor;
    }
    if (d.error === 'invalid_grant') {
      throw errorExterno('Google: el token de refresco ha caducado o se ha revocado (GOOGLE_REFRESH_TOKEN). Hay que volver a autorizar la app (docs/GOOGLE.md, «OAuth»); si la pantalla de consentimiento sigue en «Testing», caduca a los 7 días', { estado: r.status, permanente: true });
    }
    if (d.error === 'invalid_client' || d.error === 'unauthorized_client') {
      throw errorExterno('Google: el cliente OAuth no vale (GOOGLE_CLIENTE_ID o GOOGLE_CLIENTE_SECRETO)', { estado: r.status, permanente: true });
    }
    const reintentable = r.status === 429 || r.status >= 500;
    throw errorExterno(`Google OAuth ${r.status}${d.error ? `: ${String(d.error).slice(0, 80)}` : ''}`, { estado: r.status, permanente: !reintentable, reintentable });
  }
  async function tokenDeAcceso() {
    if (token && token.caduca - 60000 > reloj().getTime()) return token.valor;
    if (!pidiendo) pidiendo = pedirToken().finally(() => { pidiendo = null; });
    return pidiendo;
  }

  // ── Una llamada a las APIs de la ficha: cuota, token, reintentos y, si Google dice 401 (el token ha
  // caducado antes de tiempo o se ha revocado), un token nuevo y otra vez.
  const sinPerfil = () => errorExterno('Google: falta el acceso a la API de Business Profile (GOOGLE_CLIENTE_ID, GOOGLE_CLIENTE_SECRETO y GOOGLE_REFRESH_TOKEN): puerta ⛔ 6', { permanente: true });
  async function api(metodo, url, { cuerpo = null, escritura = false } = {}) {
    if (!c.oauth) throw sinPerfil();
    await cuotaDe(url)();
    if (escritura) await cuotaEscrituras();
    for (let renovado = false; ; renovado = true) {
      const acceso = await tokenDeAcceso();
      const r = await conReintentos(() => fetch(url, {
        method: metodo,
        headers: { Authorization: `Bearer ${acceso}`, Accept: 'application/json', ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
        signal: AbortSignal.timeout(20000),
      }), reintentar);
      if (r.status === 401 && !renovado) {
        token = null;
        continue;
      }
      const d = await leerJson(r);
      if (r.ok) return d;
      throw errorDeGoogle(r, d);
    }
  }

  function rutaFicha() {
    if (!c.oauth) throw sinPerfil();
    if (!c.cuenta || !c.ubicacion) throw errorExterno('Google: faltan GOOGLE_CUENTA y GOOGLE_UBICACION (salen con `node scripts/google.js cuentas`)', { permanente: true });
    return `accounts/${c.cuenta}/locations/${c.ubicacion}`;
  }
  // La Performance API y Business Information van por la ubicación sola (locations/…).
  const ubicacionFicha = () => rutaFicha() && c.ubicacion;
  const consulta = (q) => new URLSearchParams(q).toString().replace(/\+/g, '%20');

  // ── Places (New), solo la ficha propia: el place ID es el de la configuración (o el que da la
  // propia ficha); no hay forma de pedir otro lugar.
  let fichaGuardada = null;
  async function places(campos) {
    if (!c.placesClave) throw errorExterno('Google: falta GOOGLE_PLACES_CLAVE para Places', { permanente: true });
    const placeId = c.placeId || fichaGuardada?.valor?.placeId;
    if (!placeId) throw errorExterno('Google: falta GOOGLE_PLACE_ID (el place ID de la ficha de la clínica)', { permanente: true });
    const url = `${PLACES}/places/${encodeURIComponent(placeId)}?${consulta({ languageCode: 'es', regionCode: 'ES' })}`;
    await cuotaDe(url)();
    const r = await conReintentos(() => fetch(url, {
      headers: { 'X-Goog-Api-Key': c.placesClave, 'X-Goog-FieldMask': campos.join(','), Accept: 'application/json' }, signal: AbortSignal.timeout(15000),
    }), reintentar);
    const d = await leerJson(r);
    if (!r.ok) throw errorDeGoogle(r, d, 'Google Places');
    return d;
  }

  async function paginaResenas({ pagina = null } = {}) {
    const q = { pageSize: '50', orderBy: 'updateTime desc' };
    if (pagina) q.pageToken = pagina;
    const d = await api('GET', `${V4}/${rutaFicha()}/reviews?${consulta(q)}`);
    return {
      resenas: (d.reviews || []).map(aResena).filter((r) => r.googleId && r.nota),
      siguiente: d.nextPageToken || null,
      notaMedia: d.averageRating ?? null,
      total: d.totalReviewCount ?? null,
    };
  }

  const partesFecha = (f) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(f));
    if (!m) throw errorExterno(`Fecha no válida: ${f}`, { permanente: true });
    return m.slice(1).map(Number);
  };

  return {
    modo: 'real',
    capacidades: { perfil: Boolean(c.oauth), ficha: Boolean(c.oauth && c.cuenta && c.ubicacion), places: Boolean(c.placesClave) },
    cuenta: c.cuenta,
    ubicacion: c.ubicacion,
    paginaResenas,

    async listarResenas({ desde = null, maxPaginas = 200 } = {}) {
      const lista = [];
      const limite = desde ? new Date(desde).getTime() : null;
      let pagina = null;
      for (let i = 0; i < maxPaginas; i++) {
        const p = await paginaResenas({ pagina });
        for (const r of p.resenas) {
          // Vienen de la última tocada a la más antigua: al pasar de «desde», ya no hay más.
          if (limite != null && new Date(r.actualizadaEn || r.publicadaEn).getTime() < limite) return lista;
          lista.push(r);
        }
        if (!p.siguiente || p.siguiente === pagina) return lista;
        pagina = p.siguiente;
      }
      return lista;
    },

    async obtenerResena(googleId) {
      const r = aResena(await api('GET', `${V4}/${rutaFicha()}/reviews/${idResena(googleId)}`));
      return r.googleId && r.nota ? r : null;
    },

    async responderResena(googleId, texto) {
      const t = comprobarRespuesta(texto);
      const d = await api('PUT', `${V4}/${rutaFicha()}/reviews/${idResena(googleId)}/reply`, { cuerpo: { comment: t }, escritura: true });
      return { ok: true, estado: ESTADOS_RESPUESTA[d.reviewReplyState] || null, actualizadaEn: isoDe(d.updateTime) };
    },

    async borrarRespuesta(googleId) {
      await api('DELETE', `${V4}/${rutaFicha()}/reviews/${idResena(googleId)}/reply`, { escritura: true });
      return { ok: true };
    },

    async obtenerFicha({ refrescar = false } = {}) {
      const ahora = reloj().getTime();
      if (!refrescar && fichaGuardada && fichaGuardada.hasta > ahora) return { ...fichaGuardada.valor };
      try {
        const valor = c.oauth && c.cuenta && c.ubicacion
          ? aFicha(await api('GET', `${INFORMACION}/locations/${ubicacionFicha()}?${consulta({ readMask: LECTURA_FICHA })}`))
          : aFichaPlaces(await places(['id', 'googleMapsLinks']));
        fichaGuardada = { valor, hasta: reloj().getTime() + horasFicha * 3600000 };
        return { ...valor };
      } catch (err) {
        // Mejor la de hace unas horas que nada (el enlace para reseñar no cambia cada día).
        if (!refrescar && fichaGuardada) return { ...fichaGuardada.valor };
        throw err;
      }
    },

    async metricasDiarias({ desde, hasta, metricas = Object.keys(METRICAS) } = {}) {
      const [a1, m1, d1] = partesFecha(desde);
      const [a2, m2, d2] = partesFecha(hasta);
      const q = new URLSearchParams();
      for (const m of metricas) q.append('dailyMetrics', m);
      Object.entries({
        'dailyRange.start_date.year': a1, 'dailyRange.start_date.month': m1, 'dailyRange.start_date.day': d1,
        'dailyRange.end_date.year': a2, 'dailyRange.end_date.month': m2, 'dailyRange.end_date.day': d2,
      }).forEach(([k, v]) => q.set(k, String(v)));
      return aMetricas(await api('GET', `${RENDIMIENTO}/locations/${ubicacionFicha()}:fetchMultiDailyMetricsTimeSeries?${q}`));
    },

    async palabrasDelMes(mes, { maxPaginas = 50 } = {}) {
      const m = /^(\d{4})-(\d{2})$/.exec(String(mes));
      if (!m) throw errorExterno(`Mes no válido: ${mes}`, { permanente: true });
      const ubicacion = ubicacionFicha();
      const base = {
        'monthlyRange.start_month.year': m[1], 'monthlyRange.start_month.month': String(Number(m[2])),
        'monthlyRange.end_month.year': m[1], 'monthlyRange.end_month.month': String(Number(m[2])), pageSize: '100',
      };
      const filas = [];
      let pagina = null;
      for (let i = 0; i < maxPaginas; i++) {
        const d = await api('GET', `${RENDIMIENTO}/locations/${ubicacion}/searchkeywords/impressions/monthly?${consulta(pagina ? { ...base, pageToken: pagina } : base)}`);
        filas.push(...(d.searchKeywordsCounts || []).map(aPalabra).filter((x) => x.palabra));
        if (!d.nextPageToken || d.nextPageToken === pagina) break;
        pagina = d.nextPageToken;
      }
      return filas;
    },

    async publicarNovedad(p) {
      const texto = comprobarNovedad(p);
      const cuerpo = { languageCode: 'es', topicType: 'STANDARD', summary: texto, ...(p.botonUrl ? { callToAction: { actionType: 'BOOK', url: p.botonUrl } } : {}) };
      const d = await api('POST', `${V4}/${rutaFicha()}/localPosts`, { cuerpo, escritura: true });
      return { googleId: d.name || null, estado: ESTADOS_POST[d.state] || 'en_revision', url: d.searchUrl || null };
    },

    async fichaPlaces() {
      return aFichaPlaces(await places(CAMPOS_PLACES));
    },

    // Para dar de alta la app (scripts/google.js): a qué cuentas y fichas llega el token.
    async listarCuentas() {
      const d = await api('GET', `${CUENTAS}/accounts?${consulta({ pageSize: '20' })}`);
      return (d.accounts || []).map((a) => ({ id: soloId(a.name, 'accounts'), nombre: a.accountName || null, tipo: a.type || null, rol: a.role || null }));
    },
    async listarUbicaciones(cuenta = c.cuenta) {
      const id = soloId(cuenta, 'accounts');
      if (!/^\d{1,30}$/.test(id)) throw errorExterno('Cuenta no válida', { permanente: true });
      const d = await api('GET', `${INFORMACION}/accounts/${id}/locations?${consulta({ readMask: 'name,title,storefrontAddress,metadata', pageSize: '100' })}`);
      return (d.locations || []).map((l) => ({
        id: soloId(l.name, 'locations'), nombre: l.title || null, direccion: (l.storefrontAddress?.addressLines || []).join(', ') || null, placeId: l.metadata?.placeId || null,
      }));
    },
    // Los avisos al momento: un único ajuste por cuenta, con el tema de Pub/Sub y los tipos de aviso.
    async configurarAvisos(tema, tipos = TIPOS_AVISO) {
      if (!/^projects\/[a-z][a-z0-9-]{4,29}\/topics\/[A-Za-z][\w.~+%-]{2,254}$/.test(String(tema))) {
        throw errorExterno('El tema de Pub/Sub tiene que ser projects/<proyecto>/topics/<tema>', { permanente: true });
      }
      if (!c.cuenta) throw errorExterno('Google: falta GOOGLE_CUENTA', { permanente: true });
      const nombre = `accounts/${c.cuenta}/notificationSetting`;
      const d = await api('PATCH', `${AVISOS}/${nombre}?${consulta({ updateMask: 'pubsubTopic,notificationTypes' })}`, {
        cuerpo: { name: nombre, pubsubTopic: tema, notificationTypes: tipos }, escritura: true,
      });
      return { tema: d.pubsubTopic || tema, tipos: d.notificationTypes || tipos };
    },
  };
}

function crearGoogle(modo = 'simulado', opciones = {}) {
  return modo === 'real' ? crearReal(opciones.env || process.env, opciones) : crearSimulado(opciones);
}

module.exports = {
  crearGoogle, crearVerificadorPubSub, leerAvisoPubSub, aResena, aFicha, aMetricas,
  METRICAS, TIPOS_AVISO, MOTIVOS_RECHAZO, MAX_BYTES_RESPUESTA,
};
