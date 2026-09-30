'use strict';
// Intérprete de reglas para lo que contesta un paciente en la repesca. Tres usos:
//   1. Red de seguridad por delante de la IA: las bajas y lo de salud se detectan aquí SIEMPRE,
//      diga lo que diga el modelo.
//   2. Contraste: si la IA dice «mes_siguiente» y aquí sale «semana_siguiente», gana la duda: se
//      pregunta al paciente o se pasa a una persona.
//   3. Modo simulado (pruebas y demo) y respaldo si la IA no responde.
// Devuelve { intencion, plazo, franja, urgente, senales }.

const NUM = { un: 1, una: 1, uno: 1, dos: 2, par: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, diez: 10, doce: 12, quince: 15, veinte: 20 };
const MESES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
const DIAS = { lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6, domingo: 7 };
const RX_MES = Object.keys(MESES).join('|');
const RX_DIA = Object.keys(DIAS).join('|');

function normalizar(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[¡!¿]/g, ' ')
    // Abreviaturas de WhatsApp.
    .replace(/\bq\b/g, 'que').replace(/\b(xq|pq|porq)\b/g, 'porque').replace(/\btb\b/g, 'tambien')
    .replace(/\bmñn\b|\bmñana\b/g, 'manana').replace(/\bsem\b/g, 'semana')
    .replace(/\s+/g, ' ')
    .trim();
}

const numero = (s) => (/^\d+$/.test(s) ? Number(s) : NUM[s] || null);

// «no quiero», «no puedo pedir», «no me gustaría reservar»: lo que va detrás no es lo que pide.
const NO = String.raw`(?<!\bno (?:[a-z]+ ){0,2})`;
// «Voy a reservar» no está: suele ser en otro sitio («voy a reservar en otra clínica»).
const QUIERE = '(me gustaria|me encantaria|quisiera|queria|querria|quiero|necesito|necesitaria|podria|podrias|podriais|puedo|se puede|puedes|podeis|deseo|desearia|vengo a|venia a)';
const INFO = '(info|informacion|detalles|precios?)';

// Pide información o el precio: «Hola, quiero más información», «¿me das info?», «¿qué precio
// tiene?», «¿en qué consiste?», «quería saber más» (lo típico del primer mensaje de un anuncio).
const PIDE_INFORMACION = new RegExp([
  `${NO}\\b(quiero|queria|quisiera|querria|me gustaria|me encantaria|necesito|necesitaria|busco|buscaba|solicito|pido|pedia|me interesaria|me interesa)( recibir| tener| obtener| pedir| saber| conocer| consultar| preguntar| preguntaros| preguntarte)?( algo de| un poco de| alguna| el| la| los| mas)* ${INFO}\\b`,
  `${NO}\\b(me )?(das|dais|pasas|pasais|mandas|mandais|envias|enviais)( algo de| un poco de| la| los| mas)* ${INFO}\\b`,
  `${NO}\\b(me )?(podeis|puedes|podrias|podriais) (dar|darme|pasar|pasarme|mandar|mandarme|enviar|enviarme)( algo de| un poco de| la| los| mas)* ${INFO}\\b`,
  `\\b(dame|dadme|pasame|pasadme|mandame|mandadme|enviame|enviadme)( algo de| un poco de| la| los| mas)* ${INFO}\\b`,
  `${NO}\\bme (informas|informais|puedes informar|podeis informar|podrias informar|podriais informar)\\b`,
  `${NO}\\b(informarme|informacion sobre|info sobre|informacion del|informacion de|info del|info de)\\b`,
  `${NO}\\bsolo (la |el |los )?(info|informacion|precio|precios)\\b`,
  '^\\+?(mas )?(info|informacion)\\b',
  '\\b(que|cual es el|cual seria el) precio (tiene|tienen|tendria|seria|es|hace|haceis|teneis|tienes|lleva)\\b',
  '\\bcuanto (cuesta|cuestan|vale|valen|sale|salen|costaria|valdria|saldria|cobrais|cobras)\\b',
  '^(y )?(el |los )?precios?,?( por favor| porfa)?\\??$',
  `${NO}\\b(saber|conocer) (algo )?mas\\b`, '\\ben que consiste\\b',
].join('|'));

// Una duda médica: dolor, miedo, riesgos, recuperación… Aunque la pida como información («¿me das info
// sobre los efectos secundarios?», «quiero saber más de la anestesia»), la contesta el equipo médico.
const DUDA_MEDICA = /(duele|dolor|miedo|me da (mucho |un poco de )?(cosa|respeto|panico)|riesgo|efectos secundarios|es seguro|cicatriz|recuperacion|baja laboral|cuanto dura(n)? (el|los) (efecto|resultado)|anestesia|pinchazo|agujas|se nota mucho)/;

// «Me interesa», «estoy interesada en el head spa»: a secas o con el tratamiento, sin más. Si dice algo
// más («me interesa la primera», «me interesa el del martes a las 15:00», «me interesa, pero para el
// mes que viene»), manda eso: está eligiendo un hueco o dando un plazo.
const INTERES = /^(?:(?:hola|buenas|buenos dias|buenas tardes|buenas noches)[,.]? )*(?:me interesa|me interesaria|estoy interesad[oa]|estaria interesad[oa])(?: mucho| muchisimo)?((?: [a-z]+)*)(?:,? (?:gracias|muchas gracias|por favor|porfa))?[.?]*$/;
const NO_ES_UN_TRATAMIENTO = new RegExp(`\\b(pero|aunque|sino|porque|no|ni|primer[oa]?|segund[oa]|tercer[oa]?|cuart[oa]|ultim[oa]|opcion|huecos?|citas?|horas?|dias?|semanas?|mes|meses|ano|manana|tarde|tardes|noche|hoy|antes|despues|luego|pronto|ahora|verano|navidad(es)?|puente|${RX_DIA}|${RX_MES})\\b`);

function interesSinMas(t) {
  const m = INTERES.exec(t.replace(/[^\p{L}\p{N}\s,.?:]/gu, ' ').replace(/\s+/g, ' ').trim());
  return Boolean(m) && !NO_ES_UN_TRATAMIENTO.test(m[1]);
}

// Quiere cita (o una valoración): «dame cita», «quisiera pedir cita», «¿podría agendar…?»,
// «me gustaría reservar una valoración», «¿tenéis hueco el jueves?».
const RESERVAR = new RegExp([
  'dame cita', 'pideme cita', 'me apunto', 'reservame', 'reservadme', 'agendame', 'agendadme',
  `${NO}\\bquiero (una )?(cita|reservar|pedir cita)`,
  'cuando (teneis|tienes|hay) hueco', 'que huecos', 'teneis hueco', 'tienes hueco', 'si,? buscame', 'buscame (un )?hueco', 'me viene bien el',
  '(perfecto|vale|genial),? (reserva|apuntame)', '(?<!mas )(?<!para )\\badelante\\b(?! (en|con el tiempo))',
  `${NO}\\b${QUIERE} (reservar|agendar|concertar|programar)\\b`,
  `${NO}\\b${QUIERE} (pedir|coger|solicitar|sacar)(me|nos)? (una |otra |la |mi |nueva )?(cita|hora|valoracion|consulta|sesion|primera visita|primera cita)\\b`,
  `${NO}\\b(me )?(podeis|puedes|podrias|podriais) (dar|darme) (una |otra )?(cita|hora)\\b`,
  `${NO}\\bme (das|dais|darias|dariais) (una |otra )?(cita|hora)\\b`,
  `${NO}\\b(reservar|agendar|pedir|coger|concertar|sacar|solicitar) (una |otra |la |mi )?(cita|valoracion|primera visita)\\b`,
  `${NO}\\b(teneis|tienes|hay|tendriais|tendrias) (cita|citas|hueco|huecos|disponibilidad|algo libre)\\b`,
  // «Me interesa la primera», «me interesa el del martes a las 15:00»: elige uno de los huecos.
  `^((hola|vale|perfecto|genial|si),? )?me interesa(ria)? (el|la|los|las) (primer[oa]?|segund[oa]|tercer[oa]?|ultim[oa]|huecos?|de las|del|de la|${RX_DIA})\\b`,
].join('|'));
// Pide cita, pero en otro sitio: «voy a reservar cita en otra clínica», «tengo que pedir cita con mi
// dermatólogo primero». Eso no es pedirnos cita.
const OTRO_SITIO = /\b(en|con|a) (otr[oa]s? (clinicas?|sitios?|centros?|lados?|medic[oa]s?)|mi (medic[oa]|medico de cabecera|dermatolog[oa]|ginecolog[oa]|endocrin[oa]|endocrinolog[oa]|cirujan[oa]|dentista|fisio|fisioterapeuta|seguro|mutua|centro de salud)|el (centro de salud|ambulatorio|hospital|seguro|medico de cabecera)|la (seguridad social|mutua))\b/;

// «No quiero más información», «no quiero cita, gracias»: el mensaje entero. Si sigue («no necesito más
// información, quiero cita», «no quiero cita para mí sino para mi hija», «no quiero info por aquí,
// llamadme»), no es que no le interese.
const NO_QUIERE_NADA = /^(no,? )?(gracias,? )?no (quiero|necesito) (ninguna |mas |la |una )?(cita|informacion|info)(,? (gracias|muchas gracias))?\.*$/;

const INTENCIONES = [
  // El orden importa: la primera que encaja gana, y las de seguridad van primero.
  ['baja', /\b(baja|stop|no me (escribas|escribais|escriban|mandes|mandeis|envieis|envies|molestes|molesteis)|dej(a|ad|en|ar) de (escribir|mandar|enviar)(me)?|no quiero (recibir|mas mensajes|que me escrib)|borr(a|ad|ar|en) mis datos|elimin(a|ad|ar) mi (numero|telefono|contacto)|quita(me|dme) de (la lista|vuestra lista)|no vuelvas a escribir)/],
  ['salud_urgente', /(me ha salido (un|una)|bulto|muy hinchad|sigue hinchad|inflamad|se me ha puesto (morad|roj|blanc)|me duele (mucho|muchisimo|desde)|infeccion|fiebre|pus\b|no puedo (abrir|mover)|necrosis|reaccion alergica)/],
  // Labio, nariz o la zona tratada morada, blanquecina o fría: puede ser una oclusión tras un relleno.
  ['salud_urgente', /(labio|labios|nariz|frente|entrecejo|ojera|ojeras|zona|piel|mejilla|pomulo|menton|barbilla)[^.,;?]{0,25}\b(morad|amoratad|blanquecin|frio\b|fria\b)/],
  ['salud_personal', /(embarazad|lactancia|dando el pecho|dando pecho|anticoagul|sintrom|alergic|alergia|medicacion|me estoy medicando|tomo (pastillas|medicacion|antibiotico)|antibiotico|enfermedad|autoinmune|diabet|herpes|cancer|quimio|marcapasos|epilep|tiroides|operad[ao] hace|operacion|me operan|me opero|mi medic[oa] (me )?(ha dicho|dice)|estoy de baja medica)/],
  ['queja', /(queja|reclamacion|fatal|pesimo|muy mal servicio|mal atendid|indignad|estafa|vergüenza|verguenza|nadie me (contesta|coge)|no me cogeis|\btimo\b|enfadad)/],
  ['ya_hecho', /(ya me lo (he )?hecho|ya me lo hice|me lo hice en|ya me lo hicieron|ya lo tengo hecho|ya me (he )?(puesto|operado|tratado) en)/],
  ['competencia_precio', /(mas barato|mas economico|por menos (dinero)?|me lo dejan (en|por)|en otr[oa] (sitio|clinica|centro) (me lo )?(cuesta|vale|cobran|hacen por|lo tienen)|he visto (precios|ofertas|promociones) (mas|mejores)|a mejor precio|mejor precio en)/],
  ['evento', /(tengo|es) (una |la |mi )?(boda|comunion|bautizo|evento|graduacion|fiesta|cena de empresa|sesion de fotos)|quiero estar (bien|guapa|guapo|perfecta|perfecto) para/],
  ['ocupado_ahora', /(ahora no puedo|ahora mismo no puedo|(ahora |ahora mismo )?estoy (trabajando|conduciendo|en el trabajo|liad[ao]|ocupad[ao]|en una reunion|con los ninos)|luego te (digo|escribo|contesto|llamo)|en un rato te|mas tarde te (digo|escribo|contesto)|ahora no me viene bien hablar|me pillas (en mal momento|liad[ao]|trabajando|conduciendo))/],
  ['precio', /(\bcaro\b|\bcara\b|carisimo|carillo|no me llega|no me lo puedo permitir|no puedo permitirmelo|mucho dinero|se me va de presupuesto|fuera de (mi )?presupuesto|cuesta mucho|me sale caro|economicamente|no tengo (el )?dinero|ando justa|ando justo|estoy (a dos velas|pelad[ao]|en paro)|precio (alto|elevado)|(muchos|he tenido) gastos|precios? (me parece|me parecen|es|son|lo veo|los veo)( un poco| algo| muy| bastante| demasiado)? (alto|altos|elevado|elevados|excesivo))/],
  // Pide información o el precio. Antes que «pensar»: «quería consultar el precio» o «me lo pienso,
  // mándame info» piden información. Una duda médica, no: esa va después, como duda médica.
  ['informacion', { test: (t) => PIDE_INFORMACION.test(t) && !DUDA_MEDICA.test(t) }],
  ['pensar', /(pensar(lo|melo)?|lo pienso|me lo pienso|consultar(lo)?|lo consulto|hablar(lo)?|lo hablo|comentarlo|con mi (pareja|marido|mujer|novio|novia|madre|padre|familia)|decidir|no lo tengo claro|estoy dudando|tengo dudas|lo miro|lo mire|mirarlo|(mirar|ver) (mi agenda|el calendario|mis turnos)|mirando (otras|mas) (clinicas|opciones|sitios)|comparando)/],
  ['duda_medica', DUDA_MEDICA],
  // «Me interesa» a secas, después de «pensar» y de las dudas: «me interesa, pero lo tengo que pensar».
  ['informacion', { test: interesSinMas }],
  ['no_interesa', /(no me interesa|no,? gracias|ya no (me interesa|quiero|lo necesito)|he cambiado de opinion|no lo voy a hacer|lo dejo\b(?! para)|descartado|no es para mi)/],
  ['no_interesa', NO_QUIERE_NADA],
  ['reservar', { test: (t) => RESERVAR.test(t) && !OTRO_SITIO.test(t) }],
];

// «Estoy de baja médica», «te mando la foto de la baja», «baja por maternidad»: es la baja del
// trabajo, no la de los mensajes. Se quita antes de buscar la baja; «dame de baja», «quiero la baja»
// o «BAJA» siguen siendo bajas.
const BAJA_LABORAL = new RegExp([
  'baja (medica|laboral|de maternidad|de paternidad|por (maternidad|paternidad|enfermedad|embarazo|accidente|incapacidad|depresion|ansiedad))',
  '(estoy|esta|estas|estamos|estar|estaba|estuve|estare|sigo|sigue|seguir|continuo|he estado|ha estado|llevo) de baja',
  '(parte|justificante|papel|papeles|foto|informe|certificado|alta|documento) de (la )?baja',
  '(tengo|me (han|ha) dado|me dieron|cogerme|coger) la baja',
].join('|'), 'g');

function detectarFranja(t) {
  if (/(por|a|de) la tarde|\btardes\b|despues de (comer|trabajar)|a partir de las (1[5-9]|[3-8]\b)/.test(t)) return 'tarde';
  if (/(por|de) la manana|\bmananas\b|a primera hora/.test(t)) return 'manana';
  return null;
}

function detectarPlazo(t) {
  let m;
  // Fechas concretas con mes: «el 3 de noviembre», «hasta el 15 de octubre».
  const conMes = new RegExp(`\\b(\\d{1,2}) de (${RX_MES})\\b`);
  const soloDia = /\b(?:el|dia|del) (?:dia )?(\d{1,2})\b(?! de la| horas| h\b|:)/;
  const trasFecha = /(vuelvo|regreso|llego|estoy (de viaje|fuera|de vacaciones)[^.]*hasta|hasta el|a la vuelta del?|despues del (dia )?(?=\d))/;

  // «mejor el miércoles», «no, mejor el 20»: manda lo que va después de «mejor».
  const trasMejor = /\bmejor (?:el |para el )?(.*)$/.exec(t);
  if (trasMejor && /^(lunes|martes|miercoles|jueves|viernes|sabado|\d{1,2}\b)/.test(trasMejor[1])) {
    const sub = detectarPlazo(trasMejor[1].startsWith('dia') ? trasMejor[1] : `el ${trasMejor[1]}`);
    if (sub) return sub;
  }
  // «el último día de octubre».
  if ((m = new RegExp(`\\bultimo dia de (${RX_MES})\\b`).exec(t))) {
    const mes = MESES[m[1]];
    return { tipo: /hasta/.test(t) ? 'tras_fecha' : 'fecha', dia: [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mes - 1], mes };
  }
  // «finales de octubre», «principios de noviembre», «mediados de diciembre».
  if ((m = new RegExp(`\\b(principios|primeros|mediados|finales|final) de (${RX_MES})\\b`).exec(t))) {
    const dia = { principios: 1, primeros: 1, mediados: 15, finales: 25, final: 25 }[m[1]];
    return { tipo: /hasta/.test(t) ? 'tras_fecha' : 'fecha', dia, mes: MESES[m[2]] };
  }
  if ((m = new RegExp(`\\b(${RX_DIA}) de la (semana que viene|proxima semana|semana proxima)`).exec(t))) {
    return { tipo: 'dia_semana', dia: DIAS[m[1]], semanaSiguiente: true };
  }
  if ((m = conMes.exec(t))) {
    const plazo = { dia: Number(m[1]), mes: MESES[m[2]] };
    return { ...plazo, tipo: trasFecha.test(t) ? 'tras_fecha' : 'fecha' };
  }
  if (/cuando cobre|cuando me paguen|cuando (me )?(llegue|entre|reciba) la nomina|cuando tenga (el )?dinero|cuando reciba el sueldo/.test(t)) {
    const d = /cobro (el|los) (\d{1,2})/.exec(t);
    return { tipo: 'cobro', ...(d ? { dia: Number(d[2]) } : {}) };
  }
  if (/pasado manana/.test(t)) return { tipo: 'pasado_manana' };
  if ((m = /(?:dentro de|en|de aqui a) (\d+|un|una|dos|tres|cuatro|cinco|seis|diez|quince|veinte|un par de|unos|unas) ?(dias|semanas|meses|mes|semana|dia)\b/.exec(t))) {
    let n = m[1] === 'un par de' ? 2 : m[1] === 'unos' || m[1] === 'unas' ? null : numero(m[1]);
    const u = m[2];
    if (u.startsWith('dia')) return { tipo: 'dias', n: n ?? 4 };
    if (u.startsWith('semana')) return { tipo: 'semanas', n: n ?? 3 };
    return { tipo: 'meses', n: n ?? 3 };
  }
  if (/(semana que viene|proxima semana|semana proxima|la otra semana|esta semana (no|imposible|me es imposible|no puedo|la tengo))/.test(t)) return { tipo: 'semana_siguiente' };
  if (/(ano que viene|proximo ano|el ano proximo)/.test(t)) return { tipo: 'tras_hito', hito: 'navidad' };
  if (/este mes (no|imposible|me es imposible|lo tengo)/.test(t)) return { tipo: 'mes_siguiente' };
  if (/hoy (no puedo|imposible|no me viene)/.test(t)) return { tipo: 'manana' };
  if (/(principios|primeros|inicio|comienzos) de(l)? (mes|mes que viene|proximo mes)/.test(t)) return { tipo: 'inicio_mes' };
  if (/(finales|final|fin) de(l)? mes/.test(t)) return { tipo: 'fin_mes' };
  if (/(mes que viene|proximo mes|mes proximo|el otro mes|mes siguiente)/.test(t)) return { tipo: 'mes_siguiente' };
  if (/(despues|pasado|tras|a la vuelta|al volver) (del|de las|de|el) (verano|vacaciones de verano|agosto)|en verano no|despues de vacaciones de verano/.test(t)) return { tipo: 'tras_hito', hito: 'verano' };
  if (/(despues|pasad[ao]s?|tras|a la vuelta) (de )?(las |los )?(navidad(es)?|fiestas navidenas|reyes)/.test(t)) return { tipo: 'tras_hito', hito: 'navidad' };
  if (/semana santa|pascua/.test(t)) return { tipo: 'tras_hito', hito: 'semana_santa' };
  if (/(despues|tras|pasado) (del|el) puente/.test(t)) return { tipo: 'dias', n: 7 };
  if ((m = new RegExp(`\\b(?:en|para|a partir de|desde|hacia|hasta) (${RX_MES})\\b`).exec(t))) return { tipo: 'mes', mes: MESES[m[1]] };
  if ((m = soloDia.exec(t)) && Number(m[1]) >= 1 && Number(m[1]) <= 31) {
    return { tipo: trasFecha.test(t) ? 'tras_fecha' : 'fecha', dia: Number(m[1]) };
  }
  if ((m = new RegExp(`\\b(?:el |este |el proximo |el otro )?(${RX_DIA})( que viene| proximo)?\\b`).exec(t))) {
    return { tipo: 'dia_semana', dia: DIAS[m[1]] };
  }
  if (/\bmanana\b/.test(t.replace(/(por|de) la manana|mananas/g, ''))) return { tipo: 'manana' };
  if (/(esta tarde|luego|mas tarde|en un rato|a ultima hora|esta noche)/.test(t)) return { tipo: 'hoy_tarde' };
  if (/(en unos meses|dentro de unos meses|mas adelante en el ano)/.test(t)) return { tipo: 'meses', n: 3 };
  if (/(mas adelante|ya te (dire|digo|aviso|escribo)|en otro momento|mas para adelante|cuando pueda|cuando sepa|no es (el |buen |un buen )?momento|ahora no me viene bien|ahora mismo no|mas tarde en)/.test(t)) return { tipo: 'vago' };
  return null;
}

function interpretar(texto) {
  const t = normalizar(texto);
  const senales = [];
  let intencion = null;
  for (const [nombre, rx] of INTENCIONES) {
    if (rx.test(nombre === 'baja' ? t.replace(BAJA_LABORAL, ' ') : t)) { intencion = nombre; break; }
  }
  const plazo = detectarPlazo(t);
  const franja = detectarFranja(t);
  if (plazo) senales.push(`plazo:${plazo.tipo}`);

  let urgente = false;
  if (intencion === 'salud_urgente') { intencion = 'salud_personal'; urgente = true; }
  if (!intencion && plazo) intencion = plazo.tipo === 'hoy_tarde' ? 'ocupado_ahora' : 'aplazar';
  if (intencion === 'ocupado_ahora' && !plazo) return { intencion, plazo: { tipo: 'hoy_tarde' }, franja, urgente, senales };
  if (!intencion && /\?$|^(que|cuanto|cuanta|como|donde|cuando|quien|hay|se puede|puedo|teneis|tienes)\b/.test(t)) intencion = 'pregunta';
  if (!intencion && /^(vale|ok|okey|genial|perfecto|si|claro|de acuerdo)\b/.test(t)) intencion = 'acepta';
  if (!intencion && /\bprecio|cuanto (cuesta|vale|sale)|(mandame|enviame|pasame|me mandas|me envias) (la )?(informacion|info|precios|mas detalles)|\b(hacer|hacerte|haceros|tengo) una (consulta|pregunta|duda)\b/.test(t)) intencion = 'pregunta';
  if (!intencion && franja) intencion = 'preferencia_horario';
  return { intencion: intencion || 'otro', plazo, franja, urgente, senales };
}

module.exports = { interpretar, normalizar, detectarPlazo, detectarFranja };
