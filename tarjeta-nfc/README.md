# TARJETA NFC

**Tarjeta de fidelización con NFC: el cliente acerca la tarjeta, suma puntos.**
Cero dependencias · funciona sin cobertura · ~45 € para arrancar

---

## Qué es

Una tarjeta de veinte céntimos que el cliente lleva en la cartera. El empleado la
acerca a un móvil Android y suma. Cuando el cliente acerca esa misma tarjeta a
**su** móvil, ve sus puntos en una página web. Nadie instala nada.

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

---

## ⚠️ Lee esto antes que nada

**El NFC es la parte fácil.** Son cuarenta líneas de JavaScript y funciona a la
primera. Si esto fracasa, fracasará por el mostrador: porque con cola en la barra
el empleado deja de pedir la tarjeta, o porque el premio está a cinco meses vista
y el cliente abandona en el tercer sello.

Por eso el modo por defecto es **un solo toque, sin teclear importes**, y por eso
el documento que hay que leer primero no es el de arquitectura, sino
[`docs/02-como-funcionan-los-puntos.md`](docs/02-como-funcionan-los-puntos.md).

> **Veredicto honesto:** una cartulina con un sello de tinta cuesta cero y
> funciona. Lo que compras con el NFC es *saber quién repite*, que no se
> falsifique, recuperar tarjetas perdidas y poder avisar al que le falta uno para
> el premio. Si no vas a mirar los datos ni a escribir a nadie, la cartulina es
> mejor decisión.

**Y una restricción dura:** el móvil del mostrador **tiene que ser Android**. En
iPhone el navegador no puede leer NFC — ni Safari ni Chrome, porque en iOS todos
son Safari por dentro. El móvil del *cliente* da igual.
[`docs/03-hardware.md`](docs/03-hardware.md) §3.1.

---

## Probarlo ahora

```bash
cd tarjeta-nfc
node servidor/semilla.js --demo      # empleados, premios y clientes de prueba
npm start                            # http://localhost:8080/staff.html
npm test                             # 56 tests, medio segundo
```

La semilla imprime dos PIN. En el portátil no hay NFC: el mostrador enseña el
campo para teclear el número de tarjeta y se puede recorrer el flujo entero sin
comprar nada.

---

## Decisiones

| Parámetro | Valor de partida | Dónde se cambia |
|---|---|---|
| Modelo | **sellos por visita** (1 toque, sin teclear) | `config.json` → `modo` |
| Objetivo | 10 sellos | `sellos.objetivo` |
| Consumo mínimo | 5,00 € | `sellos.importe_minimo_cents` |
| Bienvenida | 1 punto al darse de alta | `puntos_bienvenida` |
| Antipassback | 90 min entre toques | `antipassback_minutos` |
| Tope diario | 2 acumulaciones · **no forzable** | `max_acumulaciones_dia` |
| Caducidad | 12 meses sin actividad | `caducidad_meses` |
| Chip | NTAG213, 0,15–0,45 €/ud | — |

Cambiar de sellos a puntos por euro es editar una línea y reiniciar. No hay que
tocar las tarjetas.

---

## Lo que sostiene el sistema

- **El saldo no es una columna, es una suma.** `movimientos` solo se anexa: cada
  punto que existe tiene autor, fecha y motivo, y una corrección es otro apunte.
  Nadie puede pintar puntos sin dejar rastro.
- **Los puntos los da el mostrador, no la tarjeta.** Toda acumulación la autoriza
  un empleado con sesión abierta. Por eso clonar el UID de una tarjeta —que es
  trivial— no sirve de nada.
- **El tope diario no lo puede forzar ni el encargado.** Es el único freno que
  sigue en pie cuando quien defrauda es quien tiene el PIN.
- **Cada toque lleva clave de idempotencia**, y se comprueba *antes* que las
  reglas. El wifi del local se cae; reintentar no puede duplicar puntos ni dar un
  error sobre algo que sí contó.
- **El UID se guarda como HMAC**, nunca en claro. Un CSV exportado por error no
  lleva dentro números de serie clonables.

---

## Documentación

| Documento | Contenido |
|---|---|
| [`01-concepto.md`](docs/01-concepto.md) | Qué es, veredicto honesto, decisiones de diseño, qué no sirve |
| [`02-como-funcionan-los-puntos.md`](docs/02-como-funcionan-los-puntos.md) | **Empieza aquí.** Los tres modelos, cuánto cuesta de verdad, la cadencia, premios, métricas |
| [`03-hardware.md`](docs/03-hardware.md) | El problema del iPhone, qué tarjetas y lector comprar, HTTPS, presupuesto |
| [`04-arquitectura.md`](docs/04-arquitectura.md) | Datos, API, el flujo de un toque, cola offline |
| [`05-seguridad-y-fraude.md`](docs/05-seguridad-y-fraude.md) | De quién te defiendes, los cuatro frenos, NTAG424, RGPD, lo que falta |
| [`06-puesta-en-marcha.md`](docs/06-puesta-en-marcha.md) | Piloto de dos semanas, guion del mostrador, incidencias |

---

## Estado

Funciona de extremo a extremo y está probado: 56 tests, incluidos los cuatro
vectores oficiales del RFC 4493 para el AES-CMAC.

Antes de ponerlo en producción faltan cuatro cosas, todas listadas en
[`05-seguridad-y-fraude.md`](docs/05-seguridad-y-fraude.md) §5.7: copias de
seguridad, HTTPS con certificado válido, las bases del programa escritas, y un
límite de peticiones en `/api/tap`.

El módulo NTAG424 (anticlonado) está verificado contra sí mismo, **no contra una
tarjeta real**. Es opcional y no hace falta para arrancar.
