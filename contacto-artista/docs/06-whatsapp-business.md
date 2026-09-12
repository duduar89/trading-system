# WhatsApp Business: qué cambia y cómo se configura

## Por qué merece la pena pasarse

Con el **mismo número**, gratis, y sin que el fan note nada raro:

- **Mensaje de bienvenida automático.** Salta solo cuando alguien escribe por
  primera vez (y después de 14 días sin hablar). Es lo que hace que el encuentro
  de treinta segundos funcione **sin que ella toque el móvil**: el fan recibe
  respuesta inmediata mientras ella sigue hablando con la siguiente persona.
- **Etiquetas.** Un CRM mínimo dentro de la propia aplicación: una etiqueta por
  bolo, por ciudad, por «ya le he escrito».
- **Respuestas rápidas** con `/`: para contestar lo mismo veinte veces sin
  reescribirlo.
- **Mensaje de ausencia** fuera de horario.
- **Perfil** con descripción, horario y enlaces.

Y una razón que no es de comodidad: **usar la cuenta personal como canal de
promoción incumple las condiciones de uso de WhatsApp**, que prohíben el uso no
personal del servicio.

## Antes de tocar nada: la migración es de una sola dirección

Tres cosas que hay que saber antes, no después:

1. **El mismo número no puede estar en las dos aplicaciones a la vez.** Al
   verificar el número en Business, deja de funcionar en WhatsApp normal.
2. **Hay que hacer copia de seguridad antes** (Google Drive en Android, iCloud en
   iPhone). Con la copia hecha, la aplicación detecta el número y ofrece
   transferir cuenta, historial y archivos.
3. **No se hace la tarde antes de un bolo.** Se hace un martes por la mañana, con
   calma y con la copia comprobada.

## Configuración, por orden

**1. Mensaje de bienvenida**
Ajustes → Herramientas para empresas → Mensaje de bienvenida. Activarlo, pegar el
texto de `02-mensajes.md` (empezando por la versión corta) y elegir a quién se
envía: **«Todos los que no están en la libreta de direcciones»** es la opción
correcta, porque es exactamente la gente nueva del bolo.

> **Al probarlo:** solo salta la **primera vez** que alguien escribe, o tras 14
> días sin hablar. Probándolo dos veces seguidas con el mismo móvil parecerá que
> no funciona. Hay que probarlo con un número que nunca le haya escrito.

**2. Etiquetas**
Crear de entrada: `bolo-<sala>-<mes>`, `guardado`, `le he escrito`, `responde`,
`baja`. La etiqueta `baja` es obligatoria y se explica en `08-legal.md`.

**3. Respuestas rápidas**
Al menos dos:

- `/gracias` → el agradecimiento personal para responder a mano al día siguiente.
- `/fechas` → las próximas fechas con enlace.

**4. Perfil**
Nombre artístico, descripción de una línea, y el enlace a la web. Aquí es donde
el fan comprueba que ha escrito a quien creía.

## El enlace corto propio (`wa.me/message/CÓDIGO`)

WhatsApp Business genera un enlace corto propio con su QR. Es útil y conviene
tenerlo apuntado, pero **no es el destino del material impreso**, por dos motivos:

- No se puede medir ni redirigir.
- **Si algún día se restablece el código, muere al instante todo el material
  impreso y todos los NFC que lo lleven**, sin aviso y sin arreglo.

Se guarda como plan B documentado, por ejemplo para pegarlo en la biografía de
Instagram mientras se monta lo demás.

## El Canal de WhatsApp

Merece la pena crearlo, como **segundo carril**:

- **Seguidores ilimitados** y no hace falta que nadie guarde ningún número.
- El teléfono de ella **no se le muestra** a los seguidores.
- Riesgo de bloqueo por spam prácticamente nulo: el que lo sigue se ha suscrito.

Con una contrapartida que hay que tener clara: **los seguidores son anónimos para
ella.** No puede saber quién la sigue, ni escribirle a uno, ni avisar solo a los
de Valencia de un bolo en Valencia, ni llevárselos si un día pierde la cuenta.

Por eso: **el canal es para anunciar, el chat es para tener.** El enlace del
canal va en la página puente como enlace secundario y en el mensaje de bienvenida.

## Listas de difusión: para qué sirven de verdad

Aquí está el malentendido más caro de WhatsApp, y conviene decírselo a ella con
estas palabras:

> Una lista de difusión **solo le llega a quien te tenga guardada en su agenda.**
> A quien no te tenga guardada, el mensaje **no le llega y no hay ningún aviso**:
> se queda en un tick.

Es decir: se puede mandar un aviso a 250 personas y que lo lean 60, sin enterarse.
Y encima el límite es de 256 contactos por lista.

Consecuencia práctica:

- **No se construye el sistema sobre listas de difusión.**
- Sí se usan, pero solo con la gente que sí la guardó, y sabiendo que son una
  parte.
- La frase «guárdame, que si no te pierdo» dicha en el bolo es lo que desbloquea
  esto más adelante.

## Lo que no se hace nunca

- **Herramientas no oficiales de envío masivo** (WhatsApp Web automatizado,
  extensiones de Chrome, APIs no autorizadas). El bloqueo por eso suele ser
  automático, sin aviso y a veces permanente.
- **Promoción en bloque a gente que no tiene guardado su número.** Es el patrón
  exacto que dispara la detección de spam.

Y una advertencia que conviene que ella entienda del todo: el número que se
bloquearía es **su número personal**, el mismo que lleva impreso en las tarjetas y
por el que la llaman de las salas para contratarla. No hay copia de seguridad que
recupere una cuenta bloqueada.

Si algún día quiere hacer envíos a escala de verdad, eso se hace con la
plataforma de WhatsApp Business (la API), con plantillas aprobadas, permiso
documentado y **un número distinto del personal**.
