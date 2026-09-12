# Lo legal, en cristiano

No es un dictamen jurídico: es lo que hay que tener montado para que esto no dé
problemas, y está escrito para poder decidir. Las referencias están verificadas
contra fuentes secundarias concordantes, no contra el BOE (la máquina donde se
preparó esto no tenía acceso a boe.es). **Antes de publicar, el aviso legal
conviene que lo revise quien lleve lo jurídico.**

---

## Lo único que hay que entender: son cuatro cosas distintas

Ella las va a confundir, y de esa confusión sale el 90% del riesgo.

| Qué hace | ¿Necesita permiso previo? |
|---|---|
| **1. Contestar** a quien le escribe primero | **No.** No es comunicación comercial. Solo hay deber de informar. |
| **2. Mandarle luego una promoción** (uno a uno) | **Sí.** Es comunicación comercial por medio electrónico. Sin permiso, infracción. |
| **3. Meterlo en una lista de difusión** | **Sí, y peor.** Entra en «envío masivo» y salta de leve a grave. |
| **4. Publicar en un canal al que él se suscribió** | **No hace falta pedir nada más:** suscribirse ya es la petición previa. |

El marco es el **artículo 21.1 de la Ley 34/2002 (LSSI)**: prohíbe enviar
comunicaciones publicitarias por correo electrónico «u otro medio de comunicación
electrónica equivalente» que no hayan sido **previamente solicitadas o
expresamente autorizadas**. WhatsApp es medio equivalente.

**La excepción de «relación contractual previa» (art. 21.2) no sirve aquí.**
Exige un contrato previo y que lo promocionado sea similar a lo contratado. Un fan
que se acercó a hablar después de un bolo no ha contratado nada. Solo valdría con
quien le haya comprado entradas o contratado un concierto directamente.

**Y el salto de importe:** el artículo 38.3.c) convierte en infracción **grave**
(30.001 a 150.000 €) el envío masivo o **más de tres comunicaciones comerciales
al mismo destinatario en un año** sin cumplir el artículo 21. Lo que no llega a
grave es leve, hasta 30.000 €. Una campaña mensual de conciertos cruza ese umbral
en el cuarto mes.

---

## Dónde está el permiso en este sistema

**En el propio mensaje que envía el fan.**

> ¡Hola! Vengo de verte en Sala Clamores 🙌 **Avísame de los próximos bolos.**

Esas cuatro últimas palabras son una **petición expresa del destinatario**,
escrita por él, con su número y con la fecha y hora que pone WhatsApp. Es
exactamente lo que el artículo 21.1 llama «previamente solicitadas».

**Esta es una decisión de diseño, y tiene una alternativa más defensible sobre el
papel:** poner en la página una casilla sin premarcar («Quiero recibir por
WhatsApp avisos de conciertos») y guardar en base de datos el teléfono, la fecha,
el texto exacto mostrado y el estado de la casilla. Eso es lo más sólido si algún
día hay una reclamación.

**No se ha hecho, y conviene saber por qué:** un formulario con casilla, en un
local, a la una de la madrugada, con el móvil en una mano, hunde la conversión.
Y un sistema que nadie usa no protege a nadie. El mensaje del fan es una petición
expresa real y queda registrada en el chat; lo que hay que hacer es **conservar la
prueba**, que es lo que dice el punto siguiente.

**Y hay que saber por dónde se rompe, porque se rompe por un sitio concreto:** el
texto prerellenado **el fan lo puede borrar**. Puede quitar la frase y enviar un
«hola» pelado, y ella no tiene forma de saber qué decía el texto original ni de
demostrarlo. Además un hilo de WhatsApp no es un registro: no se exporta, no
tiene versión del texto aceptado, y desaparece si se pierde el móvil.

De ahí sale la regla operativa del punto siguiente, que no es burocracia:
**se apunta lo que la persona escribió de verdad, no lo que se suponía que iba a
escribir.** Quien mandó la frase entera tiene permiso registrado; quien mandó un
«hola» pelado **no lo tiene**, y con esa persona solo se puede hacer una cosa:
contestarle.

Si en algún momento se empieza a hacer promoción de verdad —tres o cuatro envíos
al año, entradas de pago— merece la pena añadir la casilla. El sitio para ponerla
está: la página puente.

---

## Lo que hay que guardar (y hoy no se guarda solo)

El **artículo 7.1 del RGPD** pone la carga de la prueba en ella: tiene que poder
demostrar que consintieron. Recordar que «se acercó en un concierto» no vale.

Mínimo viable, en la hoja o en el CRM, al guardar cada contacto:

| Campo | Ejemplo |
|---|---|
| Teléfono | +34 6XX XXX XXX |
| Fecha y hora del mensaje | 2026-09-20 23:41 |
| De dónde salió | `tarjeta` / `pulsera`, y la sala |
| **Qué escribió de verdad** | copiar el mensaje tal cual llegó |
| ¿Pidió que le avisen? | sí / no — si no, **no se le escribe promoción** |
| Baja | vacío / fecha |

Lo sensato es hacerlo al día siguiente, cuando se guardan los números (ver
`07-guion-bolo.md`). Y si algún día esto pasa a hacer envíos de verdad, merece la
pena mover el permiso al sitio sólido: una casilla en la página y una fila en la
base de datos con el teléfono, la fecha, la **versión del texto aceptado** y el
código de origen. Eso convierte un argumento discutible en un expediente que se
puede enseñar. Si esto se lleva al CRM del portal, **la casilla de baja
tiene que filtrar en la consulta SQL que genera cada campaña**, no solo verse en
la ficha: una sola reincidencia sobre alguien que ya pidió la baja es lo que
multiplica el importe de una sanción.

**La baja** ya está ofrecida por adelantado en la página («Escribe BAJA cuando
quieras y desapareces»), que es lo que el artículo 21.2 llama procedimiento
sencillo y gratuito. Hay que respetarla de verdad: cualquier mensaje entrante con
BAJA o STOP marca el contacto y lo saca de todo.

---

## La página: qué hace falta y qué no

**No hace falta banner de cookies.** La página no instala nada en el móvil de
nadie: ni cookies, ni almacenamiento local, ni píxeles, ni fuentes ni librerías de
terceros. El artículo 22.2 de la LSSI habla de «equipos terminales», y aquí no se
toca ninguno. El conteo se hace en el servidor y es agregado.

> Esto se rompe en el momento en que alguien meta el píxel de Meta o Google
> Analytics «solo para ver cuánta gente escanea». Eso convierte una página sin
> banner en una que necesita un gestor de consentimiento completo, con rechazar
> igual de fácil que aceptar. Y dispararlo antes del consentimiento es la
> infracción de cookies más sancionada que hay.

**Sí hace falta decir la verdad sobre los registros del servidor.** Apache y nginx
guardan la IP por defecto, y una IP —aunque sea dinámica— es dato personal
(sentencia Breyer del TJUE). Poner «no guardamos tu IP» mientras el servidor la
registra es una declaración falsa en un documento legal. Por eso
`web/privacidad.html` lo dice tal cual: el contador no guarda IP, y los registros
de acceso del servidor se conservan 30 días por interés legítimo. **Hay que
ajustar ese plazo al que de verdad tenga configurado el hosting.**

**Sí hace falta aviso legal (artículo 10 de la LSSI).** Y esto es lo único de todo
el proyecto que no se puede resolver sin ella:

> La ley obliga a publicar, de forma permanente y accesible, **nombre o razón
> social, NIF, domicilio a efectos de notificaciones y un correo de contacto**.

Aplica aunque sea autónoma y aunque la página sea una sola pantalla, porque
promocionar conciertos de pago es actividad económica. Y en cuanto se le explique,
lo más probable es que no quiera publicar su nombre civil ni su dirección
particular. **Se resuelve antes de publicar, no después**, por una de estas vías:

1. A través de su sociedad, si tiene.
2. A través de su management o representante.
3. Con un domicilio a efectos de notificaciones (una gestoría, un apartado).

Está marcado como `RELLENAR` en `web/privacidad.html`.

---

## Menores

En un bolo hay gente de 14 a 17 años, y a veces menos. Conviene tenerlo decidido
antes de que pase:

- La LOPDGDD fija en **14 años** la edad a partir de la cual un menor puede
  consentir por sí mismo el tratamiento de sus datos. *(Confirmar el artículo con
  quien lleve lo jurídico: no he podido consultar el texto oficial.)* Por debajo
  de esa edad hace falta consentimiento de quien tenga la patria potestad.
- **Qué significa en la práctica:** a quien sea evidentemente muy joven, se le
  contesta como a cualquiera, pero **no entra en ninguna lista** para escribirle
  después.
- Recoger teléfonos de menores de 14 en una base de fans no es un problema del
  mismo tipo que el del artículo 21: es cualitativamente peor, y no se arregla a
  posteriori.

## Entre ella y Brainstormers

Si el CRM, el contador o los datos viven en el hosting de Brainstormers, ella es
**responsable** del tratamiento y Brainstormers **encargado**: hace falta un
contrato de encargo de tratamiento (**artículo 28 del RGPD**). Es de una página y
es lo primero que se pide si alguna vez hay una inspección.

Y un registro de actividades de tratamiento (**artículo 30**) con dos entradas:
«atención de contactos entrantes» y «comunicaciones comerciales a suscriptores».
La exención para quien tiene menos de 250 empleados **no cubre esto**: decae en
cuanto el tratamiento deja de ser ocasional, y un CRM que se alimenta en cada
concierto es habitual por definición.

---

## Antes de la primera campaña

- [ ] Que todos los contactos tengan su petición registrada.
- [ ] Que la baja funcione y filtre en la consulta.
- [ ] **Consultar la Lista Robinson** (Adigital) si se va a escribir a alguien sin
      consentimiento expreso documentado, y guardar prueba de la consulta. Lo pide
      el artículo 23 de la LOPDGDD. No hace falta con quien sí dio permiso expreso
      a ella.
- [ ] Que el mensaje se lea claramente como suyo y como promoción.
- [ ] Que no se hayan mandado más de tres promociones en el año a la misma persona
      sin cumplir el artículo 21.

---

## El riesgo que de verdad importa

No es la multa. Es **perder el número**.

WhatsApp bloquea de forma automática cuando un número acumula bloqueos y reportes
en poco tiempo, o cuando detecta herramientas de envío masivo. Ese número es a la
vez su teléfono personal, el que lleva impreso en las tarjetas y por el que la
llaman de las salas para contratarla. **No hay copia de seguridad que recupere una
cuenta bloqueada.**

Todo lo de arriba —el permiso en el mensaje, la baja, la cadencia de un mensaje al
mes con algo dentro, no usar envío masivo— es lo que evita llegar ahí.
