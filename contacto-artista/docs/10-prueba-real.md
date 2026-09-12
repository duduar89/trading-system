# La prueba de media hora antes del primer bolo

Todo lo de estos documentos está comprobado contra documentación, contra la norma
del QR y contra un navegador. **Nada está comprobado en un móvil de verdad**, y
este sistema vive o muere en un móvil de verdad, de noche, en una sala llena.

Media hora con dos teléfonos cierra ese agujero. Es lo único de todo el proyecto
que no puedo hacer yo.

---

## Lo que hace falta

- **Un iPhone** y **un Android**. Cuanto más viejo el Android, mejor: es el que
  va a fallar y el que hay que conocer.
- Un tercer móvil o el de alguien, para probar el mensaje de bienvenida (solo
  salta con un número que no le haya escrito nunca).
- La tarjeta ya impresa —la de la imprenta, no una impresión de casa— y un tag
  NFC ya grabado.

---

## La matriz

Se marca lo que pasa de verdad, no lo que debería pasar.

| # | Qué se prueba | iPhone | Android | Si falla |
|---|---|---|---|---|
| 1 | Abrir `wa.me/34620591728` a pelo. ¿Abre su chat? | | | Si dice «número no válido», **no sigas**: el número no tiene cuenta activa o está mal puesto. `03-montaje-web.md` |
| 2 | Escanear el QR de la **tarjeta impresa** con la cámara normal, con luz | | | `05-qr-imprenta.md`, lista de antes de imprimir |
| 3 | El mismo, **en penumbra** | | | Subir el tamaño del QR |
| 4 | El mismo, **en ángulo de 45°** | | | Igual |
| 5 | El mismo, **con un foco encima** (reflejo) | | | Acabado mate, no brillo |
| 6 | Escanear el QR de **su pantalla** (`qr.html`) desde otro móvil | | | Brillo, autobloqueo: `07-guion-bolo.md` |
| 7 | Acercar el **tag NFC**. ¿Sale aviso? ¿Se abre solo? | | | `04-nfc.md`. En iPhone el aviso es normal; en Android suele abrir directo |
| 8 | Lo mismo **con la cámara abierta** en el iPhone | | | Es de esperar que **no** funcione: es la limitación conocida |
| 9 | Desde el botón, ¿se abre **la aplicación** de WhatsApp o la web? | | | Si abre la web, probar tocando el enlace y no dejando que salte solo |
| 10 | ¿Llega el mensaje **con el nombre de la sala** dentro? | | | Comprobar el `?sala=` de la URL |
| 11 | Abrir la página desde **dentro de Instagram** (mándate el enlace por mensaje y púlsalo) | | | Tiene que salir el aviso de «estás dentro de otra aplicación» |
| 12 | Pulsar **«Guardar mi número»**. ¿Se añade el contacto? | | | Tipo MIME del `.vcf`: `03-montaje-web.md` |
| 13 | Escribir desde un número **que nunca le haya escrito**. ¿Salta la bienvenida? | | | Horario «Siempre» y que el número esté en WhatsApp Business: `06-whatsapp-business.md` |
| 14 | Mirar `datos/escaneos.csv`. ¿Están las visitas con **el soporte correcto**? | | | `09-medir.md` |
| 15 | Abrir `datos/escaneos.csv` **desde el navegador**. Tiene que dar error 403 | | | Falta el `.htaccess` |
| 16 | **En modo avión**, escanear `qr-contacto.svg`. ¿Ofrece guardar el contacto? | | | Si no lo ofrece en algún móvil, ese soporte no sirve para ese sistema: apúntalo. `05-qr-imprenta.md` |
| 17 | **En modo avión**, escanear el QR normal. Confirmar que **no hace nada** | | | Es lo esperado, y es justo por lo que existe la fila 16 |

---

## Y una prueba que no es de móvil: la sala

Antes del primer bolo en una sala nueva, **mirar si hay cobertura donde va a estar
la mesa de merchandising.** Muchos locales son sótanos. Si no la hay:

- El QR de contacto sin conexión (fila 16) pasa a ser el soporte principal de esa
  noche.
- Pedir al promotor la clave del WiFi junto con la ficha técnica. Es gratis y
  nadie lo pide.

## Lo que se aprende, más allá del sí o no

Tres cosas que solo salen probando y que hay que apuntar:

1. **Cuántos segundos** tarda de verdad desde que apunta la cámara hasta que el
   chat está abierto. Si pasa de cinco, en un bolo la gente se va.
2. **Dónde apoya cada móvil** para que el NFC lea. Es lo que ella tiene que saber
   señalar con el dedo, y cambia entre modelos.
3. **Qué hace un móvil viejo.** Es el que marca el suelo del sistema.

---

## El primer bolo es la segunda prueba

Con el sistema ya puesto, el primer bolo se trata como una prueba:

- Apuntar cuánta gente había.
- Mirar el contador al día siguiente: cuántos escaneos y de qué soporte.
- Contar cuántos mensajes llegaron de verdad.

**La distancia entre los escaneos y los mensajes es el número que importa.** Es la
gente que abrió el chat y no le dio a enviar, y se corrige con una frase dicha en
voz alta, no con código.
