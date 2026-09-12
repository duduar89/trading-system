# Resumen: qué es esto y qué hace falta de ti

## El encargo

Que después de un bolo, cuando la gente se le acerca, ella pueda enseñar un QR o
dar un toque con NFC y esa persona acabe en su WhatsApp.

## Lo que se entrega

Un sistema completo, sin dependencias y sin servicios de terceros: una página
puente, la tarjeta de contacto, el generador de QR (escrito aquí, no de una web
externa), el contador de escaneos, la tarjeta de visita lista para imprenta y la
documentación de cómo se usa en el bolo.

## Lo que se ha descubierto por el camino, y que cambia el encargo

**Abrir el chat no era el objetivo.** El objetivo de ella es poder volver a
avisar a esa gente del próximo bolo, y ahí hay tres cosas que casi nadie sabe:

1. **Las listas de difusión de WhatsApp solo llegan a quien tenga guardado su
   número.** A quien no la haya guardado, el mensaje no le llega y **no hay ningún
   aviso**. Se puede avisar a 250 personas y que lo lean 60 sin enterarse.
2. **El mensaje prerellenado no se envía solo.** Si el fan abre WhatsApp, lo lee y
   bloquea el móvil, ella no se lleva nada. Por eso todo el material dice «dale a
   enviar» y ella también lo dice en voz alta.
3. **Lo que sí controla es que ella se quede el número del fan**, y eso ocurre
   automáticamente en cuanto el fan pulsa enviar: su teléfono aparece en la
   bandeja aunque no esté guardado. El enlace de WhatsApp no es un chat, es un
   mecanismo de captura.

Y una cosa más, sobre el NFC: **en iPhone no «se abre solo»** —sale una
notificación y hay que tocarla, y eso no ha cambiado desde 2018—. En Android, en
cambio, la mayoría de móviles sí abre el enlace directamente. Además, en iPhone la
lectura automática **se desactiva mientras la cámara está en uso**, que es lo que
medio público está haciendo en un concierto.

El NFC es el efecto sorpresa; **el QR es el que funciona siempre** —en el 100% de
los móviles con cámara— y va impreso al lado, no escondido como plan B. Cuánto se
usa de verdad cada uno no lo sabe nadie de antemano: por eso cada soporte lleva su
propio código y se mide en los dos o tres primeros bolos.

**Y un riesgo que no cubría ningún soporte:** muchas salas son sótanos de hormigón
**sin cobertura**. Ahí el QR no resuelve, el NFC abre una web que no carga, y el
fallo es mudo: parece que el sistema está roto. Por eso se entrega un **segundo QR
que lleva su ficha de contacto dentro del propio dibujo** y se guarda con el móvil
en modo avión, y el teléfono va impreso en texto en la tarjeta.

## El sistema, en una línea

QR o NFC → una página suya de una pantalla → un botón grande a WhatsApp con el
mensaje ya escrito → el fan pulsa enviar → WhatsApp Business contesta solo → ella
guarda el contacto al día siguiente con la etiqueta del bolo.

El razonamiento completo, y lo que se ha descartado, en `01-analisis-metodos.md`.

## El mensaje elegido

> ¡Hola! Vengo de verte en **{sala}** 🙌 Avísame de los próximos bolos.

Las cuatro últimas palabras no son adorno: son una petición expresa del fan, y son
lo que hace legal escribirle dentro de tres meses. Ver `02-mensajes.md` y
`08-legal.md`.

---

## Qué está puesto y qué falta

**Ya en `config.js`:**

| | |
|---|---|
| Subdominio | `https://www.enlagloriaevents.brainstormersagency.es` |
| Nombre | Gloria Díez Monzones |
| Nombre artístico | **En la Gloria** |
| Teléfono | +34 620 591 728 |
| Aviso legal | Gloria Díez Monzones · Boadilla del Monte, Madrid |

> **Lo de «En la Gloria» lo he decidido yo** y conviene confirmarlo. Está puesto
> así porque es lo que el fan acaba de leer en el aviso del móvil al escanear —el
> dominio lleva `enlagloria`— y que las dos cosas coincidan es lo que hace que la
> gente toque. Si en los carteles aparece de otra forma, se cambia en `config.js`:
> es una línea, y no hay que reimprimir nada.

**Falta:**

1. **Sus enlaces**, cuando los tengas: canal de WhatsApp, Instagram, Spotify,
   página de fechas. Lo que esté vacío no se pinta, así que puede subirse ya y
   añadirlos después.
2. **NIF y un correo de contacto.** El artículo 10 de la LSSI pide nombre, NIF,
   domicilio y correo, y de momento hay dos de las cuatro. La página de privacidad
   **enseña el hueco a propósito** («FALTA POR RELLENAR: NIF, correo de
   contacto»): un hueco visible se arregla, uno silencioso se queda para siempre.
   Si no quiere dar su NIF personal, se canaliza por su sociedad o su management,
   pero hay que resolverlo antes de publicar. Ver `08-legal.md`.
3. **Comprobar que el número tiene cuenta activa de WhatsApp**: abrir
   `wa.me/34620591728` desde un móvil que no sea el suyo. Es el primer sitio donde
   puede fallar todo.
4. **¿El subdominio responde también sin el `www`?** Si sí, quitarlo de
   `config.sitio` ahorra cuatro caracteres en todos los QR. Se comprueba en dos
   segundos desde el navegador.

## Lo que cuesta este dominio, en milímetros

El subdominio es largo (67 caracteres con la ruta y el código de soporte), y eso
tiene efecto físico: el QR sale de **versión 6, 41×41 cuadros**. Consecuencia:

- La tarjeta de visita **se imprime con el QR a 30 mm**, no a 25. Lo calcula sola
  `hacer-tarjeta.js` para que cada cuadro llegue a 0,61 mm, por encima del suelo
  de la impresión comercial. Cabe de sobra en una tarjeta de 85 mm.
- En el cartel y en la pegatina no cambia nada.
- Si alguna vez hace falta un QR realmente pequeño, en `03-montaje-web.md` está
  cómo bajarlo a versión 4.

Con eso, `node herramientas/construir.js` deja todo listo para subir. Ya se ha
ejecutado: la web, la tarjeta de contacto, los siete QR y las dos caras de la
tarjeta de visita están generados.

---

## Lo que ya está comprobado

- **180 comprobaciones** sobre el generador de QR: contra el vector de referencia
  publicado de la norma, contra las tablas de formato, y 300 idas y vueltas
  leídas por un decodificador escrito aparte a propósito.
- **Cada QR que se genera se vuelve a leer antes de escribirse en disco.** Lo que
  llega a la imprenta ha sido leído, no solo dibujado. Y hay una prueba que
  estropea un código a posta para confirmar que esa red salta.
- **54 comprobaciones en un navegador de verdad** sobre la página: el enlace y el
  número, la sala dentro del mensaje, que nunca sale un `{sala}` a medias, el
  aviso dentro de Instagram con salida por `intent://`, que no pide nada a
  servidores externos, que no se sale de la pantalla a 320 px de ancho, y que la
  ficha de contacto aguanta un apellido con punto y coma, que una sala llamada
  «Rock&Blues» o «Bar; El Sol» viaja entera hasta WhatsApp, y que el contador
  **no cuenta** las visitas que hacen WhatsApp o Telegram para dibujar la vista
  previa cuando alguien pega el enlace en un chat.

```bash
node herramientas/probar-qr.js
node herramientas/probar-web.js
```

## Lo que NO está comprobado, y hay que comprobar en el mundo real

**Está todo en `10-prueba-real.md`, montado como una matriz de media hora con dos
móviles.** Es lo único del proyecto que no puedo hacer yo, y es donde este sistema
se juega si funciona:

- **Que el QR impreso se lee.** La lista de doce comprobaciones antes de tirar 500
  unidades está en `05-qr-imprenta.md`. No es opcional.
- **Que los tags NFC se leen** en iPhone y en Android reales: `04-nfc.md`.
- **Que el mensaje de bienvenida salta.** Solo lo hace la primera vez que alguien
  escribe: hay que probarlo con un número que nunca le haya escrito.
- **Que el enlace abre la aplicación y no la web de WhatsApp**, desde un móvil de
  verdad y no desde un simulador.

## Por dónde seguir

| | |
|---|---|
| `01-analisis-metodos.md` | Por qué este sistema y no otro. Qué se descartó |
| `02-mensajes.md` | Todos los textos, listos para pegar |
| `03-montaje-web.md` | Cómo se publica, paso a paso |
| `04-nfc.md` | Qué comprar y cómo grabarlo |
| `05-qr-imprenta.md` | Tamaños, colores y la lista antes de imprimir |
| `06-whatsapp-business.md` | Cómo se configura su WhatsApp |
| `07-guion-bolo.md` | Lo que dice y hace ella en la sala |
| `08-legal.md` | Lo que hay que tener montado |
| `09-medir.md` | Qué números mirar |
| `10-prueba-real.md` | **La prueba de media hora con dos móviles, antes del primer bolo** |
