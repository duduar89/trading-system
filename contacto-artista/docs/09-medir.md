# Qué se mide y qué números mirar

## Qué se guarda

Una línea por visita en `hola/datos/escaneos.csv`:

```
fecha,origen,dispositivo
2026-09-20 23:41:02,tarjeta,movil
```

Y nada más. **Ni IP, ni cookie, ni identificador.** Por eso no hace falta banner
de cookies ni pedir consentimiento: es un recuento agregado, no un seguimiento de
personas. Es también la razón de que no haya píxel de Meta ni Analytics en esta
página; si algún día se quisieran, cambiaría el marco legal entero y haría falta
banner.

## El embudo, en tres tramos

Hay que mirarlos separados, porque cada caída significa una cosa distinta:

| Tramo | De dónde sale | Qué significa si cae |
|---|---|---|
| **1. Escaneos** | `escaneos.csv` | El soporte no se ve, o nadie entiende para qué es |
| **2. Abren WhatsApp** | Restar: escaneos menos los que no pulsan | La página no convence o el botón no se ve |
| **3. Mensajes recibidos** | Su WhatsApp | **El tramo importante.** La gente abre el chat y no pulsa enviar |

El salto del 2 al 3 es donde se pierde la mayoría, y es invisible si solo se
cuentan escaneos. Todo el material dice «dale a enviar» precisamente por esto.

## Las tres preguntas que contesta esto

1. **¿Qué soporte funciona?** Comparar el `origen` de las líneas. Si la pulsera
   NFC tiene 3 y la tarjeta 40, la pulsera no merece la pena.
2. **¿Qué sala trae gente?** El mensaje que recibe ella lleva el nombre de la
   sala escrito. Contarlos por sala dice dónde volver a tocar, que es la decisión
   de negocio real.
3. **¿Se pierde gente entre el escaneo y el mensaje?** Escaneos frente a mensajes
   recibidos, de la misma noche.

## Cómo se mira

Desde el móvil, descargando el CSV por FTP y abriéndolo. O, más rápido, por SSH:

```bash
# Cuántos por soporte
cut -d, -f2 escaneos.csv | sort | uniq -c | sort -rn

# Los de una noche
grep '^2026-09-20' escaneos.csv | wc -l
```

Un recuento a mano después de cada bolo es suficiente. Montar un panel para esto
antes de saber si el sistema funciona es gastar tiempo en la parte bonita.

## Lo que hay que apuntar a mano

Lo que el servidor no puede saber, y es justo lo que decide si esto funciona:

- Cuánta gente había en el bolo.
- Cuántos mensajes le llegaron esa noche y al día siguiente.
- Cuántos guardó con nombre.
- Cuántos contestaron cuando les escribió para el bolo siguiente.

Tres columnas en una hoja. La cuarta es la única que importa de verdad a los tres
meses.
