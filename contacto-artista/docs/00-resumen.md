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

Y una cosa más, sobre el NFC: **no «se abre solo»**. Ni en iPhone ni en Android.
Siempre sale un aviso que hay que tocar. Y en iPhone la lectura automática **se
desactiva mientras la cámara está en uso**, que es lo que medio público está
haciendo en un concierto. El NFC es el efecto sorpresa; **el QR es el que
funciona siempre** y va impreso al lado, no escondido como plan B.

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

## Lo que necesito de ti para que esto funcione

Son cinco cosas. Cuatro son datos; una es una decisión que no puedo tomar yo.

**1. El subdominio.** Dónde está publicada su landing. Va en `config.sitio`.

**2. Su nombre.** Nombre, apellidos y nombre artístico tal y como quiere que
aparezca en la agenda de quien la guarde. Va en `config.artista`.

**3. Los enlaces que existan:** canal de WhatsApp, Instagram, Spotify, página de
fechas. Lo que esté vacío sencillamente no se pinta.

**4. Comprobar que el número tiene cuenta activa de WhatsApp.** Abrir
`https://wa.me/34620591728` desde un móvil que no sea el suyo. Es el primer sitio
donde puede fallar todo.

**5. La decisión que es tuya y de ella — el aviso legal.** La ley obliga a
publicar en la web nombre o razón social, NIF, domicilio a efectos de
notificaciones y un correo (artículo 10 de la LSSI). En cuanto se lo expliques es
probable que no quiera publicar su nombre civil ni su dirección particular. Se
resuelve con su sociedad, con su management o con un domicilio a efectos de
notificaciones, **y hay que resolverlo antes de publicar**. Está en `08-legal.md`
y marcado como `RELLENAR` en `web/privacidad.html`.

Con lo primero, un `node herramientas/construir.js` deja todo listo para subir.

---

## Lo que ya está comprobado

- **180 comprobaciones** sobre el generador de QR: contra el vector de referencia
  publicado de la norma, contra las tablas de formato, y 300 idas y vueltas
  leídas por un decodificador escrito aparte a propósito.
- **Cada QR que se genera se vuelve a leer antes de escribirse en disco.** Lo que
  llega a la imprenta ha sido leído, no solo dibujado. Y hay una prueba que
  estropea un código a posta para confirmar que esa red salta.
- **42 comprobaciones en un navegador de verdad** sobre la página: el enlace y el
  número, la sala dentro del mensaje, que nunca sale un `{sala}` a medias, el
  aviso dentro de Instagram con salida por `intent://`, que no pide nada a
  servidores externos, que no se sale de la pantalla a 320 px de ancho, y que la
  ficha de contacto aguanta un apellido con punto y coma.

```bash
node herramientas/probar-qr.js
node herramientas/probar-web.js
```

## Lo que NO está comprobado, y hay que comprobar en el mundo real

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
