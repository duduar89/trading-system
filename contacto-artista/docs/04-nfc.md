# NFC: qué comprar, cómo grabarlo y qué prometer

Resumen en una línea: **el NFC es el efecto sorpresa, el QR es la red de
seguridad.** Nunca se pone NFC sin QR al lado.

---

## Lo primero, porque cambia la expectativa

**En iPhone, el NFC no «se abre solo».** En Android, en la mayoría de móviles, sí.

No son lo mismo, y conviene no contarlo como si lo fueran:

- **iPhone:** acercar el móvil → sale una **notificación** → **hay que tocarla** →
  se abre el navegador. Apple lo hace así desde 2018 para que nadie abra cosas sin
  querer, y no ha cambiado.
- **Android:** la inmensa mayoría del parque **abre el enlace directamente**, sin
  tocar nada. Android 16 cambió por dentro cómo se lanza, pero no añadió ningún
  paso para el usuario. Solo desde **Android 17** hay que tocar un aviso, y a
  finales de agosto de 2026 Android 17 es residual (en torno al 4% de los
  móviles). Convergerán, pero eso es 2027 o 2028, no hoy.

Esto hay que decírselo a ella antes del primer bolo. Si espera que se abra solo y
el otro tiene un iPhone, la demo se vive como un fallo delante de la gente.

Y hay más condiciones, todas reales:

- **iPhone:** solo lee sin abrir ninguna aplicación desde el **iPhone XS** (2018)
  en adelante. Los anteriores necesitan abrir el lector desde el Centro de Control.
- **iPhone:** la lectura automática se **desactiva mientras la cámara está en
  uso**. En un concierto, medio público tiene la cámara abierta grabando. Es
  justo el momento del encargo.
- **iPhone:** tiene que estar desbloqueado al menos una vez desde que se encendió,
  con la pantalla encendida. Con el móvil en el bolsillo no pasa nada.
- **Android:** lee con la pantalla desbloqueada y el NFC activado en ajustes.
- **Móviles sin NFC:** siguen saliendo al mercado en gama de entrada.

Y hay que contar los escalones enteros, que son más de los que parece: tener NFC,
tenerlo activado, pantalla encendida (y desbloqueada en Android), **no estar con
la cámara abierta grabando** —que es lo que mucha gente hace justo antes de
acercarse—, encontrar la antena, tocar el aviso si toca, y además enviar el
mensaje al final.

**Ningún porcentaje honesto sale de ahí.** Lo sensato es tratar el NFC como un
acelerador para quien ya está convencido, dejar que el QR sea el camino principal
—funciona en el 100% de los móviles con cámara— y **medir lo que pasa de verdad**
con el contador en los dos o tres primeros bolos: para eso el NFC lleva su propio
código.

Los iPhone de 2017 o anteriores (X y anteriores) tienen lector NFC manual en el
Centro de Control, pero hay que abrirlo a mano, y eso no lo va a hacer nadie en un
concierto.

---

## Qué comprar

**Chip: NTAG213.** Y no gastar más.

Tiene 144 bytes de memoria de usuario, de los que quedan unos 130 útiles. Una URL
como `https://ejemplo.es/h/?f=n1` ocupa del orden de 25-30 bytes porque el
formato NDEF comprime el `https://` a un solo byte. No hay ninguna razón técnica
para pagar NTAG215 o NTAG216: solo harían falta si se quisiera meter una vCard
dentro del tag, y eso **no se va a hacer** (ver más abajo).

**Formato principal: tarjeta PVC del tamaño de una tarjeta de crédito**, impresa
por las dos caras, con el QR impreso en una de ellas. Es la pieza que se da en
mano y la que menos falla: la antena es grande y perdona que no se apunte bien.

**Formato secundario: llavero de resina epoxi.** Para que lo lleve siempre
encima, aunque no lleve tarjetas.

**Qué NO comprar:**

- Tags diminutos de 12×19 mm porque son baratos. La antena pequeña obliga a
  apuntar con precisión, y en una sala oscura con alguien que no conoce el gesto
  eso multiplica los fallos. De 30 mm para arriba, o tarjeta.
- Pegatinas de papel o PVC fino para algo que va a vivir en un bolso o en una
  mesa de merchandising con bebidas. El chip aguanta; el encapsulado no. Silicona
  inyectada o resina epoxi.
- Chips sin fabricante especificado. El comportamiento del bloqueo y de la
  contraseña está documentado para los NTAG21x de NXP; con clones puede quedar el
  tag inservible.

**Dónde:** tiendas europeas especializadas exigiendo NTAG213 de NXP explícito
(shopnfc, nfcw-shop, etiquetas-nfc.es, nfcstock), no marketplaces genéricos.

---

## Lo que se graba dentro

**Un solo registro NDEF de tipo URI (`U`) con una URL `https`.** Nada más. Ni
texto, ni vCard, ni varios registros.

Las URL exactas están en `imprenta/urls.txt`, generadas desde `config.js`.

Dos errores que cuestan el lote entero:

**No grabar nunca `wa.me/34620591728` directamente.** Se graba la URL de su
página. Si se graba WhatsApp y luego se bloquea el tag, el día que cambie el
número o el mensaje hay que tirar todos los tags.

**No meter una vCard en el tag.** El iPhone, leyendo en segundo plano, **solo
mira registros de tipo URI**: un tag con una vCard no dispara ninguna
notificación. Se descubre cuando ya se han comprado cien NTAG215 «porque hacía
falta más memoria».

Tampoco funciona un esquema propio tipo `whatsapp://`: Apple solo admite `https`
y una lista cerrada (`mailto:`, `sms:`, `tel:`, `facetime:` y poco más).

---

## Cómo se graban, en orden

Con la aplicación **NFC Tools** (gratuita, iOS y Android):

1. **Escribir.** Añadir un registro → URL/URI → pegar la URL del soporte que toca.
2. **Leer para verificar.** Antes de nada más. Acercar otro móvil y comprobar que
   sale exactamente la URL esperada.
3. **Proteger.** Y aquí una decisión que importa:

   - **Contraseña (recomendado).** NFC Tools permite poner una contraseña de 4
     bytes. Impide que un tercero lo reescriba y **se puede quitar**.
   - **Bloqueo con lock bits: irreversible.** Una vez puesto no hay vuelta atrás,
     ni con la contraseña correcta, ni con ninguna herramienta. El tag queda como
     está para siempre.

   Se usa **contraseña**, salvo en tags que se regalen y que nunca vayan a
   cambiar.

**El orden importa: escribir → leer → proteger.** Al revés no hay segunda
oportunidad.

**Antes del primer bolo hay que probar el lote entero** con al menos un iPhone
reciente, un iPhone antiguo si se consigue, y dos Android de marcas distintas.

---

## Dónde se pega y dónde no

**Donde NO: en la parte de atrás del móvil de ella.** Es la peor ubicación
posible, por dos motivos a la vez: el chasis metálico desintoniza la antena y
reduce el alcance, y su propio teléfono detecta el tag continuamente y le llena
la pantalla de avisos de «etiqueta NFC detectada».

Si se quiere algo «en el móvil», va un tag **on-metal con ferrita pegado en la
funda**, no en el chasis, y se prueba con esa funda concreta antes de comprometerse.

**Dónde apoya el otro móvil:**

- **iPhone:** tercio superior de la parte de atrás, junto al borde de arriba y a
  las cámaras. Apoyando el centro, donde está el logo, **no lee**.
- **Android:** ya no hay una respuesta única, y esto ha cambiado hace poco.
  Antes solía estar en el centro de la trasera; los modelos nuevos la han subido
  arriba (el Pixel 11 la movió a la parte superior, y la serie Galaxy S26 también
  la tiene arriba).

**Consecuencia práctica: no se puede imprimir «apoya el centro del móvil».** La
instrucción que funciona en iPhone y en los Android nuevos es **«acerca la parte
de arriba del móvil»**, asumiendo que a alguna gente le tocará deslizarlo un poco
buscando el punto. Eso ella tiene que saber señalarlo con el dedo, no explicarlo.

**Con metal por medio** (una mesa metálica, una barra) hace falta tag on-metal
con capa de ferrita, o separar el tag al menos 5 mm de la superficie.

---

## La frase que dice ella al acercarlo

> «Desbloquea el móvil y acércame aquí la parte de arriba. Si te sale un aviso,
> tócalo.»

Tres cosas en una frase: desbloquear, qué parte del móvil acercar, y que **puede**
salir un aviso —en iPhone sale siempre, en la mayoría de Android no—. Sin esto, la
mitad de los intentos se quedan en un «no me hace nada».

---

## Un código distinto para NFC y para QR

Está en `config.js` y se genera solo. Es gratis separarlo y es imposible
recuperar el dato después: si el NFC y el QR comparten código, no hay forma de
saber si la inversión en tags merece la pena.
