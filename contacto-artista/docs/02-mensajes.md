# Los mensajes

Todo lo de aquí está escrito para pegar tal cual. Lo que está en `config.js` es
lo elegido; el resto son alternativas con su motivo.

---

## 1. El mensaje que el fan envía (el que va prerellenado)

**El elegido:**

> ¡Hola! Vengo de verte en **{sala}** 🙌 Avísame de los próximos bolos.

64 caracteres con una sala corta. Lo escribe ella, pero lo manda él: por eso va
en primera persona del fan.

**Por qué este y no otro.** Hace tres cosas a la vez, y las tres hacen falta:

1. **Dice de dónde sale el contacto.** «en Sala Clamores». La fecha no hace falta
   escribirla: el mensaje llega esa misma noche y la hora la pone WhatsApp. Sin
   esto, a los dos meses tiene doscientos números sin saber de qué noche es
   ninguno.
2. **Las últimas cuatro palabras son el permiso.** «Avísame de los próximos
   bolos» es una **petición expresa del destinatario**, escrita por él y guardada
   en el chat con su fecha. Es exactamente lo que pide el artículo 21 de la LSSI
   para poder escribirle dentro de tres meses sin que sea spam. Si se sustituye
   por un «hola» seco, el sistema sigue funcionando pero **se queda sin la única
   prueba de consentimiento que genera**.
3. **Se puede enviar sin tocar nada.** Ni huecos que rellenar, ni preguntas.

**Por qué no lleva «me ha encantado».** Es la versión que más warmth da, y estuvo
a punto de ser la elegida. Se ha quitado porque es un elogio que ella pone en
boca de alguien que a lo mejor salió tibio: quien no lo sienta lo borra, y al
borrar se lleva por delante el nombre de la sala. El 🙌 da el mismo calor sin
afirmar nada por el fan.

**Cuando no hay sala** (una tarjeta genérica, un cartel que no es de un bolo
concreto):

> ¡Hola! Vengo de verte esta noche 🙌 Avísame de los próximos bolos.

Es un texto entero aparte, no una sustitución. El fallo más visible de este tipo
de montajes es que llegue un «Vengo de verte en {sala}» literal: el fan ve que es
un formulario y el hechizo se rompe en el primer segundo. Está comprobado
automáticamente en `herramientas/probar-web.js`.

### Otras versiones, por si encajan mejor

| Cuándo | Texto |
|---|---|
| **Público mayor, teatro, auditorio, jazz, o hay gente de la industria entre el público** | «Hola. Te he escuchado esta noche en {sala} y me gustaría estar al tanto de tus próximas fechas.» *(sin emoji, a propósito)* |
| **Sala pequeña, público joven, bolo de madrugada** | «¡Hola! Soy de la gente que se ha quedado hasta el final en {sala} 😄 Apúntame para el próximo.» |
| **Ella lo enseña en caliente, justo al bajar del escenario** | «¡Qué pasada lo de esta noche en {sala}! Me has ganado. Quiero enterarme de todo lo que hagas.» *(nunca en un QR impreso que alguien escanea en frío: a quien esté tibio le dará vergüenza y lo borrará)* |
| **Lo más neutro posible** | «Hola, vengo de verte en {sala}. Avísame de los próximos bolos.» |

**Lo que no se hace:** dejar huecos tipo «Soy ____» para capturar el nombre.
Entre un tercio y la mitad lo envían sin rellenar y queda ridículo. El nombre ya
lo ve ella en el perfil de WhatsApp del fan.

---

## 2. La respuesta automática de bienvenida

Se configura en WhatsApp Business (ver `06-whatsapp-business.md`). Salta sola
cuando alguien escribe por primera vez.

**La elegida**, versión corta de 128 caracteres:

> Gracias por escribirme, de verdad 🙌 Guárdame como **[Nombre]**: si no me tienes
> guardada, mis avisos no te llegan. Fechas: **[enlace]**

**Y la versión larga**, 180 caracteres, si la aplicación admite ese tamaño:

> Gracias por escribirme, de verdad 🙌
> Guárdame como **[Nombre]** en contactos: si no me tienes guardada, mis avisos de
> bolos no te llegan.
> Aquí las próximas fechas y el último tema: **[enlace]**

**Empezar por la corta.** El límite real de caracteres del mensaje de bienvenida
no está confirmado en documentación oficial —las fuentes dan 140, 200 y 250—, y
si la aplicación corta, lo que se pierde es el enlace, que es justo lo que se
quería entregar. Se pega la corta, se mira en el móvil si el campo admite más, y
solo entonces se sube a la larga.

**Por qué pide una sola cosa.** Si pide dos («guárdame, dime tu nombre y sígueme
en Instagram») no se hace ninguna, y la que se pierde es la de guardar, que es la
que condiciona todo lo demás.

**Y por qué esa razón funciona:** «si no me tienes guardada, mis avisos no te
llegan» **es literalmente cierto** —las listas de difusión de WhatsApp solo se
entregan a quien tenga guardado el número del remitente—, así que no es un
capricho de ella, es la condición para que el fan reciba lo que acaba de pedir.

### Alternativas

**Con canción** (cuando el enlace es a un tema y no a una agenda):

> ¡Ey! Qué alegría leerte 🎤 Te dejo el tema que sonó esta noche: [enlace]
> Guárdame en contactos y eres de los primeros en saber el próximo bolo. [Nombre]

**Sobria** (repertorio serio, público profesional):

> Hola, soy [Nombre]. Gracias por venir y por escribirme.
> Guarda mi número y te escribo yo con las fechas nuevas, nada más.
> Lo último, aquí: [enlace]

---

## 3. El segundo mensaje, 24-48 horas después

**Este lo escribe ella a mano. No debe ser automático.**

> ¿Qué tal, {nombre}? Soy [Nombre], la del sábado en {sala}. Te dejo el vídeo de
> ese tema que te decía: [enlace]. La próxima es el {fecha} en {sala2}, por si te
> pilla cerca.

Es el mensaje que convierte un número en una relación. Un contacto que recibe el
automático y después nada durante tres meses está tan frío como uno que no
existe: cuando llegue la primera promoción no se acordará de quién es y la
bloqueará.

**Cadencia: como mucho uno al mes, y siempre con algo dentro** (un tema, un
vídeo, una foto del bolo, una fecha nueva). Nunca un mensaje que solo diga
«compra entrada».

Sirve además para limpiar la base: **quien contesta es un contacto vivo**, y así
hay que marcarlo.

---

## 4. La página

Ya está puesto en `config.js`.

| Sitio | Texto |
|---|---|
| Título | *(el nombre artístico)* |
| Debajo | Nos acabamos de conocer. Ábreme el WhatsApp y te aviso yo del próximo bolo. |
| Botón grande | Abrir mi WhatsApp |
| **Debajo del botón** | **El mensaje ya va escrito, solo dale a enviar.** |
| Enlace secundario | Guardar mi número en tu móvil |
| Línea de abajo | Tu número lo veo solo yo. Lo uso para avisarte de bolos y música nueva, nada más. Escribe BAJA cuando quieras y desapareces. |

La línea en negrita es la más importante de la página. El mensaje **no se envía
solo**: si el fan abre WhatsApp, lo lee y bloquea el móvil, ella no se lleva nada
y ni siquiera se entera de que ha pasado.

La línea de abajo no es relleno legal: dar la baja por adelantado es lo que el
artículo 21.2 de la LSSI llama «procedimiento sencillo y gratuito», y además es
lo que tranquiliza al que duda.

---

## 5. Lo que va impreso

**Junto al QR:**

- Encima: **Te aviso yo del próximo bolo**
- Debajo: *Apunta con la cámara. Se abre mi WhatsApp con el mensaje ya escrito.*
- Al pie, pequeño: *{sala} · {fecha}* — sirve de control interno: el papel dice
  qué código lleva.
- En un adhesivo pequeño, solo: **Apunta aquí y te aviso del próximo bolo.**

**Junto al NFC:**

- **Acerca el móvil aquí**
- Más pequeño: *Sin apps. Se abre mi WhatsApp.*
- Si cabe: *iPhone: acércalo por la parte de arriba.*

---

## 6. Reglas de estilo

Cada una tapa una forma concreta de sonar a empresa.

1. **Tuteo y primera persona del singular.** «Te aviso yo», nunca «te
   avisaremos» ni «nuestro equipo». Ella es una persona, no una marca.
2. **Un emoji por mensaje como máximo**, nunca al principio de la frase, nunca
   dos seguidos. Valen 🙌 🎤 ✨. No valen 🔥💥🎉🚀: es la firma visual del spam.
3. **Ni mayúsculas sostenidas ni «!!».** Una exclamación por mensaje.
4. **Longitudes.** Prerellenado, 60-100 caracteres. Bienvenida, por debajo de 140
   si se quiere ir seguro; tres líneas, un enlace, una petición.
5. **Cero enlaces en el prerellenado.** No aporta nada (el fan viene de la
   página) y un enlace saliendo del móvil de un desconocido es el patrón exacto
   de las estafas por WhatsApp.
6. **Vocabulario prohibido:** «información», «no dude en», «estimado/a», «le
   atenderemos», «en breve», «gracias por contactarnos», «nuestro equipo»,
   «bienvenido/a».
7. **Neutro de género para el fan.** «Qué alegría leerte», no «bienvenido».
8. **No usar el nombre del fan en el automático.** Todavía no se sabe, y un «Hola
   {nombre}» vacío delata el automatismo al instante.

---

## 7. Al cambiar cualquier texto

Se toca `config.js`, se ejecuta `node herramientas/construir.js` y se sube
`web/ajustes.js`. **No hay que reimprimir nada.** Para eso se montó así.
