# Qué se ha decidido y por qué

Este documento existe para que dentro de seis meses nadie vuelva a discutir lo
que ya está decidido, y para que si se cambia sea sabiendo qué se rompe.

---

## La pregunta de fondo: ¿hay algo mejor que «QR y aterriza en su WhatsApp»?

Sí, pero no es cambiar de canal. Es cambiar **quién se queda el dato**.

El encargo, tal y como suena, es «que la gente acabe en su WhatsApp». Eso, tal
cual, es un chat abierto. El objetivo real de ella no es abrir chats: es poder
avisar a esa gente del próximo bolo. Y ahí hay una asimetría de WhatsApp que
decide el sistema entero:

| Vía de reactivación | De quién depende |
|---|---|
| **Listas de difusión** | De que **el fan** tenga guardado el número de ella. Si no lo tiene, el mensaje **no llega** y no hay ningún aviso de error: se queda en un tick. |
| **Estados** | De que **ella** tenga guardado al fan. |
| **Canal de WhatsApp** | De nadie: seguidores ilimitados, sin guardar nada. Pero ella **no sabe quién la sigue** ni puede escribirle. |

Conclusión práctica: **montar la reactivación sobre listas de difusión es
construir sobre arena.** La mayoría de la gente nunca la va a guardar. Ella
mandará un aviso a 200 personas, verá el tick y habrá llegado a 30. Nadie le
dirá que ha fallado.

Lo que sí controla es lo otro: **que ella se quede el teléfono del fan.** Y ahí
está lo bueno del enlace de WhatsApp, que casi nadie ve: un `wa.me` no es «abrir
un chat», es **un mecanismo de captura de teléfono**. En cuanto el fan pulsa
enviar, su número aparece en la bandeja de ella aunque no esté guardado. Sin
formulario, sin escribir nada, sin fricción.

Con una condición que es el punto débil de todo el sistema:

> **El mensaje prerellenado NO se envía solo.** Aparece escrito en la caja y el
> fan tiene que pulsar enviar. Si abre WhatsApp, lo lee y bloquea el móvil, ella
> no se lleva absolutamente nada, y ni siquiera se entera de que ha pasado.

De ahí salen dos decisiones que aparecen en todo el material: la página lo dice
(«ya está escrito, solo dale a enviar») y ella lo dice en voz alta. No es un
detalle de redacción; es el único punto donde se gana o se pierde el contacto.

---

## El sistema que se monta

```
  QR  ─┐
       ├──►  página propia de una pantalla  ──►  WhatsApp con el mensaje escrito
  NFC ─┘        (subdominio de ella)                        │
                                                            ▼
                                          el fan pulsa ENVIAR  ──►  su número
                                                            │        queda en la
                                                            ▼        bandeja
                                            respuesta automática de bienvenida
                                                            │
                                                            ▼
                                        ella guarda el contacto con etiqueta del bolo
```

Cuatro piezas, y cada una está ahí por una razón concreta:

**1. El QR y el NFC no apuntan a WhatsApp, apuntan a una página de ella.**
Cuesta un toque más. Compra cuatro cosas que no se pueden comprar después:

- Cambiar el destino o el mensaje **sin reimprimir nada**. Un `wa.me` impreso es
  un destino congelado para siempre.
- Saber **qué soporte funciona**: la tarjeta, la pulsera, el cartel o la pantalla.
- Sobrevivir a un cambio de número o a una suspensión de la cuenta de WhatsApp.
- Un respaldo para quien no puede o no quiere escribir.

Y sobre todo: **no deja su número de teléfono impreso para siempre** en 500
tarjetas que acabarán tiradas por ahí.

Y hay una razón técnica más, que se descubrió al verificar y que apunta en la
misma dirección: **el enlace de WhatsApp se abre en la aplicación de forma fiable
cuando es la persona quien toca un enlace**, porque entonces el toque lo gestiona
el sistema operativo. Una redirección automática del servidor hacia `wa.me` no
siempre se comporta igual y puede acabar enseñando la página web de WhatsApp en
vez de abrir la aplicación. El botón que se pulsa no es solo mejor para la
conversión: es la forma que mejor funciona.

**2. La página tiene UN botón que manda.**
No es un Linktree. Después de un concierto, en un local, la atención dura
segundos: si hay seis botones iguales (WhatsApp, Instagram, Spotify, guardar
contacto, fechas, YouTube), la gente no elige ninguno. Un botón grande y verde, y
lo demás claramente por debajo.

**3. WhatsApp Business contesta solo.**
El mensaje de bienvenida automático se dispara cuando alguien escribe por primera
vez. Es lo que hace que el encuentro de treinta segundos funcione **sin que ella
toque el móvil**: el fan recibe respuesta inmediata mientras ella sigue hablando
con la siguiente persona.

**4. Ella guarda el contacto con una etiqueta.**
Es el único paso manual, y es el que convierte la noche en algo utilizable. Se
hace al día siguiente, con calma, no en la sala.

---

## Por qué la página puente no salta sola

Se podría hacer que la página abriese WhatsApp automáticamente, sin que el fan
pulse nada. Está preparado (`opciones.abrirAutomatico` en `config.js`) pero viene
**apagado**, por tres razones:

1. **Dentro de Instagram, TikTok o Facebook no funciona.** Esos navegadores
   ignoran a propósito los enlaces que abren aplicaciones. Un salto automático
   deja a la persona en la pantalla de inicio de sesión de WhatsApp Web, sin
   entender qué ha pasado y sin camino de vuelta. Con la página delante, al menos
   se le puede avisar y darle el número para copiar.
2. **Se pierde la frase «dale a enviar»**, que es justo donde se gana el contacto.
3. **Se pierde el respaldo** para quien no tiene WhatsApp o prefiere otra cosa.
4. **Abre peor.** Un salto hecho por JavaScript es una navegación automática, y es
   justo el caso en que los enlaces universales se disparan menos: hay más
   probabilidad de acabar en la web de WhatsApp en vez de en la aplicación. El
   botón pulsado a mano es el camino más fiable que existe.

Si algún día se quiere probar, se enciende y se compara el conteo. Está montado
para eso.

---

## Lo que se ha descartado, y por qué

**«Guárdame en contactos» como botón principal.**
Es tentador: si el fan la guarda, las listas de difusión le llegan. Pero en iPhone
el archivo se descarga primero y hay que ir a buscarlo: si sale bien, es abrirlo y
pulsar «Crear contacto nuevo»; si sale mal —y sale mal a menudo— hay que entrar en
Archivos, Compartir y Contactos. **El problema no es el número de toques, es que
el camino se bifurca y no hay forma de saber por cuál va cada uno**, y quien se
pierde se queda convencido de que ya lo ha hecho. Sigue estando en la página, pero
abajo y en segundo plano, no como acción principal.

**El Canal de WhatsApp como camino principal.**
Es cómodo y no tiene riesgo de bloqueo, pero **los seguidores son anónimos para
ella**: no puede exportarlos, no puede escribirles uno a uno, no puede avisar
solo a los de Valencia de un bolo en Valencia, y si pierde la cuenta lo pierde
todo. Se usa como respaldo y como sitio donde anunciar fechas, nunca como la base
de contactos.

**Linktree y similares.** Añaden una pantalla, le regalan los datos a un tercero
y no dan nada que su propio hosting no dé.

**Pase de Apple Wallet.** Exige cuenta de desarrollador de pago y firma
criptográfica, y aun así no captura ningún contacto.

**Telegram, SMS, captura de email en la sala.** Escribir un email en el móvil a
la una de la madrugada en un local ruidoso convierte fatal. Pulsar enviar en un
mensaje ya escrito convierte bien. El email sí merece la pena, pero se pide
**dentro de la conversación de WhatsApp unos días después**, no en la sala.

**NFC como vía única.** Ver `04-nfc.md`: no funciona para todo el mundo, y el
detalle que más duele es que en iPhone la lectura automática **se apaga mientras
la cámara está en uso**, que es exactamente lo que medio público está haciendo en
un concierto.

---

## Una divergencia consciente respecto a lo que ya existe en CIFRA

El portal ya tiene un redirector `/r/:codigo` en producción que cuenta escaneos.
La tentación es reutilizarlo, y técnicamente encaja.

**No se ha hecho, a propósito.** El material impreso de la artista quedaría
atado a que la aplicación Node del portal de restaurantes esté levantada. Si esa
aplicación se cae un sábado por la noche, se caen a la vez todos los QR y todos
los NFC de ella, en el único momento en que se usan. El sistema que se entrega
vive entero en su subdominio, con una página estática y un contador de PHP: no
depende de ningún proceso.

Si aun así se prefiere centralizar, está documentado en `03-montaje-web.md` cómo
hacerlo. Lo que no debe hacerse nunca es mezclar los dos: un código en cada sitio
y nadie sabe dónde mirar.
