# 1 · Concepto

## 1.1 Qué es

Una tarjeta física con chip NFC que el cliente lleva en la cartera. En el
mostrador, el empleado la acerca a un móvil Android y suma. Cuando el cliente
acerca la misma tarjeta a **su** móvil, ve sus puntos en una página web.

```
   CLIENTE                     MOSTRADOR                    SERVIDOR
   ┌────────┐                ┌───────────┐               ┌──────────┐
   │ tarjeta│ ──── tap ────► │ Android   │ ── HTTPS ───► │ reglas   │
   │ NTAG213│                │ Chrome    │               │ + libro  │
   └───┬────┘                │ (Web NFC) │ ◄── saldo ─── │   mayor  │
       │                     └───────────┘               └────┬─────┘
       │ tap en su propio móvil                                │
       └──────────► https://…/t/<token> ──────────────────────►┘
                    "Hola Ana · 7 de 10 sellos"
```

Tres pantallas, ningún componente más:

| Pantalla | Quién | Para qué |
|---|---|---|
| [`web/staff.html`](../web/staff.html) | empleado | acercar tarjeta, sumar, canjear |
| [`web/alta.html`](../web/alta.html) | empleado | dar de alta una tarjeta nueva |
| [`web/tarjeta.html`](../web/tarjeta.html) | cliente | ver su saldo, sin instalar nada |

---

## 1.2 Veredicto honesto

**Lo difícil no es el NFC.** El NFC funciona a la primera: son cuarenta líneas de
JavaScript y un chip de veinte céntimos. Si este proyecto fracasa, fracasará por
una de estas tres razones, ninguna técnica:

1. **El empleado deja de pedir la tarjeta.** Con cola en la barra, cualquier paso
   que sume más de dos segundos se abandona a la tercera semana. Por eso el modo
   por defecto es de un solo toque, sin teclear nada.
2. **El cliente no la lleva encima.** Una tarjeta más en una cartera llena. Por
   eso hay que dejarle acercar la tarjeta a su móvil y guardarse la página: a
   partir de ahí, la tarjeta puede quedarse en casa para consultar el saldo,
   aunque siga haciendo falta para sumar.
3. **El premio está demasiado lejos.** Ver [`02`](02-como-funcionan-los-puntos.md) §2.3.

Dicho de otra forma: el 80 % del trabajo de que esto funcione ocurre en el
mostrador, no en el código.

**¿Y una cartulina con un sello de tinta?** Cuesta cero y funciona. Es
competencia seria y conviene reconocerlo. Lo que compras con el NFC:

- **saber quién repite** — sin datos, el programa es fe;
- **que no se falsifique** — un sello de goma se compra en cualquier papelería;
- **recuperar tarjetas perdidas** — el saldo vive en el servidor, no en el cartón;
- **poder avisar** de que quedan dos sellos para el premio.

Si no vas a mirar los datos ni a escribir a nadie, la cartulina es mejor
decisión. En serio.

---

## 1.3 Decisiones de diseño y por qué

| Decisión | Alternativa descartada | Por qué |
|---|---|---|
| **Tarjeta física NFC** | app propia | nadie instala una app para un bar. Una tarjeta se entiende sola |
| **Web NFC en el navegador** | app nativa Android | cero instalación, cero tienda de aplicaciones, se actualiza sola. A cambio: el mostrador tiene que ser Android ([`03`](03-hardware.md) §3.1) |
| **Sellos por visita** por defecto | puntos por euro | un toque contra toque + teclear importe. Se cambia en `config.json` |
| **Libro mayor de solo anexado** | columna `saldo` editable | no se pueden pintar puntos sin dejar rastro ([`05`](05-seguridad-y-fraude.md) §5.4) |
| **Autoriza el empleado, no la tarjeta** | que el cliente sume solo | hace irrelevante el clonado del UID ([`05`](05-seguridad-y-fraude.md) §5.2) |
| **Clave de idempotencia en cada toque** | reintento a pelo | el wifi del local se cae. Reintentar no puede duplicar puntos |
| **SQLite + cero dependencias** | Postgres, Supabase, Firebase | mil clientes caben de sobra, se hace copia con `cp`, y no hay `npm install` que se rompa en dos años |

---

## 1.4 Qué sirve y qué no

Sirve tal cual para: un bar, una cafetería, una peluquería, una tienda de barrio,
un gimnasio o un club (donde el "sello" es una sesión o un entrenamiento).

**No** sirve tal cual si:

- Tienes **varios locales** y quieres saldo compartido: funciona, pero falta el
  campo `local` bien usado y consolidar informes.
- Quieres **integrarlo con el TPV** para que el importe llegue solo: no hay
  integración; hoy el importe se teclea (o no se usa, en modo sellos).
- Quieres **tarjetas en Apple Wallet o Google Wallet**: es otro proyecto. Apple
  exige un certificado NFC que solo concede a programas aprobados, y Google
  Smart Tap necesita terminales certificados. Con tarjeta física te ahorras esa
  pelea entera.
- Esperas **miles de taps por minuto**: SQLite en un solo proceso no es el
  problema —aguanta de sobra— pero el diseño asume un local, no una cadena.

---

## 1.5 Documentación

| Documento | Contenido |
|---|---|
| [`02-como-funcionan-los-puntos.md`](02-como-funcionan-los-puntos.md) | **Lee esto antes que el código.** Modelos de puntos, cuánto cuesta, cadencia, premios, métricas |
| [`03-hardware.md`](03-hardware.md) | Qué tarjetas y qué lector comprar, el problema del iPhone, presupuesto |
| [`04-arquitectura.md`](04-arquitectura.md) | Modelo de datos, API, flujos, offline |
| [`05-seguridad-y-fraude.md`](05-seguridad-y-fraude.md) | Clonado, frenos antifraude, RGPD, lo que falta |
| [`06-puesta-en-marcha.md`](06-puesta-en-marcha.md) | Plan de piloto de dos semanas y guion para el equipo |
