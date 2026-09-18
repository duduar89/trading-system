# 5 · Seguridad, fraude y datos personales

---

## 5.1 De quién te estás defendiendo

Hay que decirlo claro porque cambia todo el diseño:

| Amenaza | ¿Real? | Respuesta |
|---|---|---|
| Un cliente clona su propia tarjeta | **No importa.** Sumaría sus propios puntos | — |
| Un cliente clona la tarjeta de otro y gasta su saldo | Poco probable, pero es el robo real | tope diario, canje con empleado, saldos pequeños |
| Un cliente acerca su tarjeta cinco veces seguidas | **Sí, es lo que pasa de verdad** | antipassback |
| Un empleado regala sellos a sus amigos | **Sí, y es el más caro** | libro mayor con autor, tope diario no forzable, revisión mensual |
| Alguien saca la base de datos de clientes | Sí, y aquí hay multa | minimizar datos, UID pseudonimizado |

El resumen incómodo: **en un programa de puntos de un local pequeño, el fraude
caro es interno, no del cliente.** Un cliente listo te roba tres cafés. Un
empleado que le sella la tarjeta a sus colegas cada día te cuesta bastante más y
no se nota nunca si no lo miras.

---

## 5.2 El UID no es una credencial

El número de serie de una NTAG213 se lee con cualquier móvil y se copia a una
tarjeta "mágica" de dos euros. Así que aquí el UID es **un número de socio**, no
una contraseña. Vale para decir *quién eres*, no para autorizar nada.

Lo que sostiene el sistema es otra cosa: **quien autoriza cada suma es un
empleado con sesión abierta**. Sin sesión no hay `POST /api/tap` posible. Clonar
una tarjeta no te da puntos, porque los puntos no los da la tarjeta: los da el
mostrador.

Por eso, para un local normal, NTAG213 está bien. Si algún día quieres que el
cliente sume solo, sin empleado delante, entonces sí necesitas el §5.5.

---

## 5.3 Los cuatro frenos que van puestos

Están en [`../servidor/motor-puntos.js`](../servidor/motor-puntos.js), son función
pura y tienen test cada uno.

| Freno | Config | Qué para | ¿Lo puede forzar el encargado? |
|---|---|---|---|
| **Antipassback** | `antipassback_minutos: 90` | acercar la tarjeta dos veces en la misma consumición | **Sí** — a veces alguien sí vuelve |
| **Tope diario** | `max_acumulaciones_dia: 2` | regalar sellos a puñados | **No.** A propósito |
| **Importe máximo** | `importe_maximo_cents` | un cero de más al teclear | Sí |
| **Tope por operación** | `tope_puntos_por_operacion` | que un error de config vacíe la caja | No |

El **tope diario no es forzable ni siendo encargado**, y es deliberado: es el
único freno que sigue puesto cuando el que hace el fraude es el que tiene el PIN
de encargado. Si de verdad hace falta dar más puntos, se hace un apunte de tipo
`ajuste`, que aparece en el libro con otra etiqueta y con nombre y apellidos.
Regalar puntos tiene que ser posible; tiene que ser posible **y visible**.

---

## 5.4 El libro mayor

No existe una columna `saldo` que se pueda editar. El saldo es
`SUM(movimientos.puntos)` y ya está. Cada apunte guarda quién, cuándo, cuánto y
por qué, y nunca se borra ni se modifica: una corrección es otro apunte, de signo
contrario.

Consecuencia práctica: **cualquier punto que exista tiene un responsable con
nombre.** La revisión mensual es una consulta:

```sql
SELECT s.nombre, COUNT(*) AS apuntes, SUM(m.puntos) AS puntos
FROM movimientos m JOIN staff s ON s.id = m.staff_id
WHERE m.ts >= date('now', '-30 days') AND m.tipo IN ('acumular','ajuste')
GROUP BY s.id ORDER BY puntos DESC;
```

Si un empleado da el triple de puntos que el resto, o no está trabajando el doble
de horas, o hay algo que mirar. Que el equipo sepa que esa consulta se ejecuta
hace más que cualquier medida técnica.

---

## 5.5 Subir a NTAG424 DNA (cuando haga falta)

La NTAG424 firma cada lectura. Emite una URL distinta cada vez:

```
https://puntos.tulocal.es/t/XXXX?picc_data=<UID+contador cifrados>&cmac=<firma>
```

El contador solo sube, y la firma solo la puede calcular quien tenga la clave
AES que va dentro del chip. Una copia del mensaje anterior se detecta como
repetida; una tarjeta clonada no sabe firmar. Eso sí permite que el cliente sume
solo, sin empleado delante.

Está implementado en [`../servidor/ntag424.js`](../servidor/ntag424.js) y el
endpoint `/api/tap` lo acepta en el campo `sun`.

> **Estado honesto.** El AES-CMAC está verificado contra los vectores oficiales
> del RFC 4493 (cuatro casos, en los tests). La parte SUN está escrita siguiendo
> la nota de aplicación NXP AN12196 y probada en ida y vuelta contra el
> codificador de este mismo repositorio — es decir, **es coherente consigo misma,
> no está probada contra una tarjeta real**. Antes de depender de ella:
> personaliza una NTAG424 de verdad y comprueba que `verificarSun` acepta su
> primera lectura. Si no coincide, lo que falla casi seguro es el orden de los
> bytes del contador o qué datos cubre el MAC, no la criptografía.

Y una advertencia: personalizar una NTAG424 significa escribir claves AES en el
chip. **Si pierdes esas claves, la tarjeta es un ladrillo.** Guárdalas fuera del
servidor, con copia.

---

## 5.6 Datos personales (RGPD)

No soy abogado y esto no es asesoramiento legal, pero estas son las piezas que
hay que tener y que el código ya contempla:

**Pide lo mínimo.** El nombre para saludar y el teléfono para recuperar una
tarjeta perdida bastan para que el programa funcione. Email y fecha de nacimiento
son opcionales en el formulario, y deben seguir siéndolo.

**Separa los dos consentimientos.** Participar en el programa es una cosa;
recibir ofertas es otra. En [`../web/alta.html`](../web/alta.html) la casilla de
marketing va aparte y **desmarcada** — una casilla premarcada no es
consentimiento válido. La columna es `consentimiento_marketing` y no se usa para
nada más.

**Informa en el alta.** Hay que decir quién es el responsable, para qué se usan
los datos, cuánto se guardan y cómo se ejercen los derechos. Un cartel en el
mostrador con un QR a la política de privacidad cumple y no molesta.

**Escribe las bases del programa** y tenlas accesibles: cuántos puntos por qué,
cuándo caducan, que no son canjeables por dinero, que no son transferibles, y que
pueden modificarse avisando. Sin esto, la caducidad del §2.6 es discutible.

**Derecho de supresión.** Está la columna `anonimizado_ts` para lo que toca
hacer: vaciar nombre, teléfono y email del cliente y **conservar el libro mayor**
sin datos personales. Borrar los apuntes rompería la contabilidad de un pasivo
real; anonimizarlos, no.

**UID pseudonimizado.** En `tarjetas` no se guarda el número de serie del chip,
sino `HMAC(secreto, UID)`. Si un CSV se exporta por error, no lleva UIDs
clonables dentro. Un test lo comprueba.

**El token de la tarjeta es un secreto.** Los 128 bits aleatorios de la URL son
lo único que protege la página del cliente — no hay contraseña. Por eso esa
página solo devuelve nombre de pila, saldo y últimos movimientos: **ni teléfono,
ni email, ni apellidos**. Hay un test que lo verifica, y conviene que siga ahí.

---

## 5.7 Lo que falta antes de producción

Honestamente, lo que este repositorio **no** trae y hay que resolver:

- [ ] **Copias de seguridad.** Un `cp tarjetas.db` diario a otra máquina. Sin
      esto, un disco muerto borra el saldo de todos tus clientes y no hay forma
      de reconstruirlo.
- [ ] **HTTPS de verdad**, con certificado válido (§3.5).
- [ ] **Los PIN son de cuatro dígitos.** Hay límite de 10 intentos por IP cada 15
      minutos, que es suficiente contra la fuerza bruta remota pero no contra un
      compañero mirando por encima del hombro. Cambia los PIN cuando alguien deja
      el equipo: `UPDATE staff SET activo = 0 WHERE id = ?`.
- [ ] **Bases del programa y política de privacidad** redactadas y publicadas.
- [ ] **Sin límite de peticiones en `/api/tap`.** Un empleado con sesión puede
      hacer llamadas a mano. El tope diario lo acota, pero conviene un límite por
      IP antes de exponerlo a internet.
