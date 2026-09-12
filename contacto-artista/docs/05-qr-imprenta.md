# El QR: tamaños, colores e imprenta

Todo lo que hay aquí está medido sobre las URL reales de este proyecto con el
generador que va dentro (`herramientas/qr.js`), no copiado de una guía.

---

## Antes de nada: la URL corta no es estética, es física

Cada vez que la URL crece, el código sube de versión y **cada cuadro se hace más
pequeño**. Medido con nuestras URL, a nivel Q:

| URL | Caracteres | Versión | Cuadros |
|---|---|---|---|
| `https://ana.es/h/?f=t` | 21 | 3 | 29×29 |
| `https://cantante.brainstormersagency.es/h/?f=tarjeta` | 52 | 5 | 37×37 |

En una tarjeta de 25 mm de lado eso es la diferencia entre 0,72 mm por cuadro y
0,57 mm. Por debajo de 0,5 mm se entra en terreno de fallos con impresión
comercial.

**Traducción práctica:** cuanto más corto sea el subdominio, mejor se lee el QR
en la tarjeta. Si el subdominio es largo, el QR de la tarjeta pequeña hay que
imprimirlo más grande.

Si alguna vez hace falta exprimirlo al máximo, hay un truco: una URL **sin `?` ni
`=` y en mayúsculas** (`HTTPS://ANA.ES/H/T`) entra en un modo de codificación más
compacto y sale un código bastante menor. Exige rutas de servidor en vez de
parámetros; está explicado en `03-montaje-web.md`.

---

## Nivel de corrección de errores: **Q**, no H

Contra la intuición. La H corrige un 30% en vez de un 25%, pero con la misma URL
sube la versión del código y **encoge los cuadros un 20-30%**. En el mundo real,
el tamaño del cuadro manda sobre la corrección de errores: un código con cuadros
de 0,44 mm falla por borroso mucho antes que por falta de corrección.

- **Q para todo lo impreso.**
- **H solo si va a llevar logo encima Y la URL es corta.**
- **Nunca L ni M** en nada que se imprima.

Está puesto en `config.js` (`opciones.nivelQR`).

---

## Si lleva logo

Dos reglas, y las dos están medidas por el propio generador
(`QR.analizarHueco`, con prueba automática en `herramientas/probar-qr.js`):

**1. El logo va encima de los datos, nunca encima de los tres ojos de las
esquinas ni de la línea punteada que los une.** La corrección de errores **no
protege** esos patrones, y el margen es mucho menor de lo que parece: al
comprobarlo con dos decodificadores independientes, **borrar un solo cuadro de la
esquina de un ojo ya impide la lectura**, incluso en nivel H. Un bloque de la
misma superficie en la zona de datos se lee sin problema.

El diseñador lo pondrá encima de un ojo si nadie se lo dice, porque visualmente es
el sitio «lógico» para una marca.

**2. El lado del logo, como máximo el 25% del lado del código.**

Aquí hay una confusión que está en casi todas las guías: dicen «el logo puede
tapar hasta el 25-30%» sin decir si hablan del lado o de la superficie. **Un logo
cuyo lado es el 25% del lado solo tapa el 6% de la superficie.** Si alguien
entiende «25% de superficie» pondrá un logo del 50% del lado y romperá el código.

En el brief a la imprenta hay que escribirlo así de literal:

> El lado del logo será como máximo el 25% del lado del código QR, centrado, con
> un margen blanco de 1-2 cuadros alrededor, y sin tocar en ningún caso los tres
> cuadrados de las esquinas ni la línea de puntos que los une.

Medido sobre nuestra URL corta: en nivel Q el código aguanta hasta un 35% del
lado antes de romperse, así que el 25% deja margen de sobra. En nivel M rompe ya
al 30%: otra razón para no bajar de Q.

> El cálculo que hace `QR.analizarHueco` es **conservador a propósito**: da por
> bueno el hueco solo mientras los códigos dañados de cada bloque no pasen de la
> mitad de los de corrección, que es lo que un lector puede arreglar con
> garantías sin saber dónde está el daño. Midiendo con decodificadores reales
> sale un pelín más de margen (en Q y H aguantan hasta el 40%). Que el cálculo se
> quede corto es lo que se quiere: la pieza va a una imprenta, no a una pantalla.

---

## Tamaños por soporte

La regla de bolsillo es **lado del QR ≈ distancia de lectura / 10**. Sirve para
empezar, pero tiene un defecto: **ignora cuántos cuadros tiene el código**, que es
lo que de verdad decide si se lee. El criterio bueno es el otro:

> **Que cada cuadro mida al menos 0,5 mm impreso.** `node
> herramientas/construir.js` lo calcula y lo dice; si baja de ahí, avisa.

Con eso en la cabeza, y con la zona de silencio dentro de la caja blanca:

| Soporte | Se lee desde | Lado del QR |
|---|---|---|
| Tarjeta de visita | 20-25 cm | **2,5 cm** (3 cm si la URL es larga) |
| Pegatina en la mesa de merchandising | 50-60 cm, de pie | **6 cm** |
| Funda de la guitarra | 40-60 cm | **8 cm**, en zona plana |
| Cartel o roll-up | 2,5-3 m | **25-30 cm** |
| QR de contacto sin conexión | 20-30 cm | **35 mm mínimo** (lleva más datos dentro) |
| Pantalla del móvil de ella | 20-30 cm | el ancho útil de la pantalla |

---

## La zona de silencio: cuatro cuadros, en los cuatro lados

No es decoración. Está medido: **basta con recortar un solo lado a cero**,
dejando los otros tres bien, para que el código deje de leerse.

Lo que lo rompe en la práctica:

- Sangrar el QR hasta el borde de la tarjeta. El corte de guillotina tiene
  tolerancia de 1-2 mm y se come el margen.
- Pegarlo contra una foto, un marco o un texto.

Los SVG que genera `construir.js` ya llevan los cuatro cuadros de margen dentro
del archivo. **Que nadie los recorte al maquetar.**

---

## Color: negro sobre blanco, y punto

- **Nada de QR invertido** (blanco sobre negro). Y conviene decir el motivo bien,
  porque circula mal: *no* es que un QR invertido sea ilegible. Al comprobarlo
  con dos decodificadores distintos, uno falla con el invertido y **el otro lo
  lee sin problema**. Es decir: **depende del lector que tenga delante**, que es
  justo lo que no se puede elegir cuando el código está impreso en 500 tarjetas y
  lo escanea quien sea con el móvil que sea. La norma asume módulos oscuros sobre
  fondo claro; salirse de ahí es apostar.
- Si el cartel es oscuro, el QR va **dentro de un rectángulo blanco**, no invertido.
- Nada de amarillo ni naranja: el amarillo puro sobre blanco no llega a 1,1:1 de
  contraste y el naranja se queda en 2:1. En el PDF parece que lee; en una foto de
  móvil con luz cálida y ruido, no.
- Nada de gris medio ni degradados.

---

## Para la imprenta

- **Archivo vectorial** (el SVG que genera `construir.js`). Nunca un PNG escalado:
  los bordes interpolados se comen justo el margen de lectura que hace falta
  cuando el cuadro mide 0,6 mm.
- **Negro 100% K**, no negro rico CMYK. Los cuatro canales desalinean y
  emborronan los bordes.
- **Acabado mate.** El laminado brillante y el barniz UV encima del QR son un
  fallo que solo aparece en el local: hay focos, el reflejo cae sobre el código y
  lo borra para la cámara. En la prueba de imprenta, con luz difusa, no se ve.
- Si el soporte es brillante y no hay alternativa, **aumentar el tamaño un 15-20%**.

---

## El texto que va al lado

Un QR pelado en una mesa de un bar es exactamente lo que la gente ha aprendido a
no escanear. Hace falta:

1. **El nombre de ella**, visible.
2. **Qué pasa al escanear**, concreto. «Escanea y te aviso de mis próximos
   conciertos» funciona mejor que «Escanéame».
3. **La URL escrita debajo**, legible y tecleable, para quien no pueda escanear.
   Y porque el iPhone enseña el dominio en un aviso antes de abrir nada: si
   coincide con lo que la persona acaba de leer al lado del código, lo toca.

---

## El segundo QR: el que funciona sin cobertura

`imprenta/qr-contacto.svg` no lleva una dirección: **lleva su ficha de contacto
dentro del propio dibujo**. Al escanearlo, el móvil ofrece guardar el contacto
**sin pedir nada a internet**.

Está porque hay un riesgo que ningún otro soporte cubre: **muchas salas de
conciertos son sótanos de hormigón sin cobertura.** Ahí, un QR que apunta a una
web no hace absolutamente nada, y el fallo es mudo — ni el fan ni ella saben por
qué no ha pasado nada, y encima parece que el sistema está roto.

- **Tamaño mínimo: 35 mm.** Lleva 124 bytes dentro, así que sale de versión 8
  (49×49 cuadros): necesita más sitio que los demás. El programa lo dice al
  generarlo.
- **Va separado del QR principal**, con su propio texto: «¿Sin cobertura? Escanea
  este y me guardas.» Dos QR juntos sin explicar cuál es cuál es peor que uno.
- **Lo que no hace:** no abre WhatsApp, no cuenta nada y no genera ningún
  permiso. Es una tarjeta de papel en forma de código: salva el contacto cuando
  no hay red, y ya.

> **Esto hay que probarlo en un móvil antes de imprimirlo.** Que la cámara de
> serie ofrezca «añadir contacto» al leer una ficha dentro de un QR es lo
> habitual en iPhone y en Android, pero no lo he podido comprobar en un teléfono
> real. Está en la matriz de `10-prueba-real.md`. Si en algún móvil no ofreciera
> guardar, el soporte sigue sin hacer daño: simplemente enseña el texto.

---

## El QR en la pantalla del móvil de ella

Está resuelto con `web/qr.html`: lo abre, escribe la sala, y le sale el código a
pantalla completa con la sala dentro. Funciona **sin cobertura** una vez abierta
la página, que es lo que hace falta en una sala llena.

Aun así hay que preparar el teléfono:

- **Brillo alto, pero no al máximo.** Al 100% el reflejo puede saturar la cámara
  del que escanea.
- **Autobloqueo a 2-5 minutos** durante el bolo, o se apaga la pantalla mientras
  el otro está enfocando.
- **Modo oscuro automático desactivado.** Si se activa a media noche puede
  invertir el código.
- Si se prefiere sin la página, guardar el QR como **fondo de pantalla de
  bloqueo**, no en la galería: no hay que desbloquear ni buscar nada mientras se
  mantiene una conversación.

---

## Lista de comprobación antes de tirar 500 unidades

Esto no es opcional. Es más barato hacerlo que reimprimir.

1. Imprimir 5 pruebas **en la misma imprenta, mismo papel y mismo acabado** que
   la tirada final. No en la impresora de casa.
2. Escanear con **al menos 4 móviles distintos**, incluyendo un Android de gama
   media de más de tres años.
3. Escanear a la **distancia real** de uso, y al doble.
4. Escanear **en penumbra**, no solo con luz de oficina.
5. Escanear **en ángulo** de 30-45°, no solo de frente.
6. Escanear con el código **bajo un foco directo**, para provocar reflejo.
7. Usar la **cámara nativa** de iOS y de Android, **nunca una aplicación de
   escaneo**: las apps son mucho más tolerantes y esconden códigos que en la
   calle no leen.
8. Comprobar con una regla que **el cuadro mide al menos 0,5 mm**.
9. Comprobar que la **zona de silencio está intacta en los cuatro lados en la
   pieza física**, no solo en el PDF.
10. Teclear a mano la URL impresa debajo y comprobar que funciona.
11. Comprobar que el escaneo de prueba **queda contado** con el código correcto.
12. Que lo escanee **alguien de fuera del proyecto, sin instrucciones**.
