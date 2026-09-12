# NFC: qué comprar, cómo grabarlo y qué prometer

Resumen en una línea: **el NFC es el efecto sorpresa, el QR es la red de
seguridad.** Nunca se pone NFC sin QR al lado.

---

## Lo primero, porque cambia la expectativa

**El NFC no «se abre solo».** Ni en iPhone, ni en Android en 2026.

En los dos sistemas el flujo real es: acercar el móvil → sale un aviso → **la
persona tiene que tocar el aviso** → se abre el navegador. Apple lo hace así a
propósito para que nadie abra cosas sin querer, y Android hace lo mismo desde su
versión 17.

Esto hay que decírselo a ella antes del primer bolo. Si espera magia, la demo se
vive como un fallo delante de la gente.

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

Contar con que **entre un 15% y un 25% del público no lo va a poder usar al
primer intento** es prudente. Por eso el QR va siempre al lado, impreso en la
misma pieza, no escondido como plan B.

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

- **iPhone:** tercio superior de la parte de atrás, muy cerca del borde de arriba.
  Apoyando el centro, donde está el logo, **no lee**.
- **Android:** no hay una posición fija; en Samsung, Pixel y OnePlus suele ser el
  centro de la trasera.

Esto ella tiene que saber señalarlo con el dedo, no explicarlo.

**Con metal por medio** (una mesa metálica, una barra) hace falta tag on-metal
con capa de ferrita, o separar el tag al menos 5 mm de la superficie.

---

## La frase que dice ella al acercarlo

> «Desbloquea el móvil y acércalo aquí arriba. Te va a salir un aviso: tócalo.»

Tres cosas en una frase: desbloquear, dónde apoyar, y que hay que tocar el aviso.
Sin eso, la mitad de los intentos se quedan en un «no me hace nada».

---

## Un código distinto para NFC y para QR

Está en `config.js` y se genera solo. Es gratis separarlo y es imposible
recuperar el dato después: si el NFC y el QR comparten código, no hay forma de
saber si la inversión en tags merece la pena.
