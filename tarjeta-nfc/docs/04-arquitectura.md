# 4 · Arquitectura

## 4.1 Las piezas

```
  web/                              servidor/
  ├── staff.html   mostrador        ├── servidor.js      HTTP + rutas
  ├── alta.html    alta             ├── db.js            esquema y consultas
  ├── tarjeta.html cliente          ├── motor-puntos.js  las reglas (función pura)
  ├── comun.js     API, NFC, cola   ├── ntag424.js       anticlonado (opcional)
  └── estilo.css                    └── semilla.js       datos iniciales
                                    config.json          reglas del negocio
                                    tarjetas.db          SQLite
```

Cero dependencias de npm. Node 22.5 o superior (por `node:sqlite`).

La decisión que más ordena el código: **las reglas viven en `motor-puntos.js` y
no tocan ni la base de datos ni la red.** Entra un objeto, sale cuántos puntos
tocan. Por eso hay 25 tests de reglas que corren en 100 ms sin levantar nada.

---

## 4.2 Modelo de datos

```
clientes ──< tarjetas ──┐
    │                   │
    └────────< movimientos >──── staff
                    (libro mayor)
```

| Tabla | Qué guarda | Nota |
|---|---|---|
| `clientes` | nombre, teléfono, email, consentimiento | mínimo imprescindible |
| `tarjetas` | `uid_hash`, `token`, estado | varias tarjetas por cliente: la perdida queda `sustituida` |
| `movimientos` | **la verdad** | solo se anexa, nunca se edita |
| `recompensas` | catálogo de premios | |
| `staff` | empleados y PIN (scrypt) | |
| `sesiones` | tokens de 12 h | |
| `ajustes` | secreto HMAC del UID | |

**No hay columna `saldo`.** Es `SUM(movimientos.puntos)`. Con mil clientes y
cincuenta mil apuntes eso se calcula en microsegundos; si algún día no, se añade
una vista materializada, pero la verdad sigue siendo el libro.

`sellos` es `saldo % objetivo`, y `canjes_disponibles` es `saldo / objetivo`. Así
los dos modos —sellos y puntos— usan la misma unidad y el mismo código.

---

## 4.3 API

Las rutas con 🔒 exigen `Authorization: Bearer <token de sesión>`.

| Método y ruta | Para qué |
|---|---|
| `POST /api/sesion` | PIN → token (12 h). Máx. 10 intentos por IP / 15 min |
| `GET /api/config` | modo, objetivo, recompensas. Público: lo lee el mostrador |
| 🔒 `POST /api/tarjetas` | alta de cliente + tarjeta → devuelve la URL a grabar |
| `GET /api/tarjeta/:token` | **público**. Saldo del cliente. Solo nombre de pila |
| 🔒 `POST /api/tap` | **el toque.** Aplica las reglas y anota |
| 🔒 `POST /api/canjear` | gasta puntos en una recompensa |
| 🔒 `GET /api/clientes/:id` | ficha y movimientos |
| 🔒 `POST /api/tarjetas/sustituir` | tarjeta perdida → nueva, mismo saldo |
| 🔒 `POST /api/tarjetas/bloquear` | solo encargado |
| 🔒 `POST /api/caducar` | pasa la caducidad. Para un cron mensual |
| 🔒 `GET /api/metricas` | solo encargado |

`/api/tap` acepta tres formas de identificar la tarjeta:

```jsonc
{ "uid": "04:A1:B2:..." }                        // lectura normal (NTAG213/215)
{ "token": "Rrb4h6a91LWsBkjytZzEHg" }            // desde el NDEF, o QR de respaldo
{ "sun": { "picc_data": "...", "cmac": "..." } } // NTAG424 firmada
```

---

## 4.4 El flujo de un toque

```
  tap ─► ¿idem ya escrito? ──sí──► devuelve lo mismo (repetido: true)
              │no
              ▼
         identificar tarjeta ──no existe──► 404 "hay que darla de alta"
              │
              ▼
         ¿activa? ──no──► 403
              │
              ▼
         motor-puntos ──rechaza──► 409 + motivo (antipassback, tope_diario…)
              │ok
              ▼
         anotar en el libro ─► 200 {sumados, saldo, sellos}
```

**La idempotencia va primero, antes que las reglas.** Es sutil y costó un fallo
descubrirlo: si la red se cae después de escribir el apunte pero antes de que el
móvil reciba la respuesta, el reintento trae la misma clave — y si las reglas se
evaluaran antes, el antipassback rechazaría una operación que **sí** contó, y el
empleado vería un error sobre algo que ya estaba hecho. Hay un test para eso.

---

## 4.5 Cuando se cae el wifi

Pasa, y pasa justo en hora punta. El mostrador:

1. Si no hay red, guarda el toque en `localStorage` con su clave de idempotencia
   y le dice al empleado que está apuntado.
2. Al volver la conexión (evento `online`), vacía la cola en orden.
3. Como cada toque lleva su clave, reenviar es seguro: el servidor devuelve el
   apunte que ya existía en vez de crear otro.

Un detalle que parece menor y no lo es: si el servidor responde 4xx (que no sea
408 o 429), el elemento **sale de la cola**. Un "esta tarjeta no existe" no se
arregla reintentando, y una cola que no avanza se atasca para siempre.

Lo que la cola offline **no** puede hacer es aplicar las reglas: el móvil no sabe
si el cliente ya sumó esta mañana en otro turno. Los toques encolados se validan
al llegar al servidor, y alguno puede rechazarse entonces.

---

## 4.6 Configuración

Todo el comportamiento del negocio está en [`../config.json`](../config.json) y
se lee al arrancar. Cambiar de sellos a puntos por euro, mover el objetivo o
añadir un multiplicador no toca código ni tarjetas: se edita el JSON y se
reinicia. Los valores y sus efectos, en
[`02-como-funcionan-los-puntos.md`](02-como-funcionan-los-puntos.md).

---

## 4.7 Tests

```bash
npm test          # 56 tests, ~0,5 s
```

| Fichero | Qué cubre |
|---|---|
| `test-motor-puntos.js` | 25 tests: los tres modos, redondeo, los cuatro frenos, multiplicadores, canje, caducidad |
| `test-ntag424.js` | 10 tests: **los cuatro vectores oficiales del RFC 4493**, truncado del MAC, replay, firma manipulada |
| `test-api.js` | 21 tests de extremo a extremo: levanta el servidor de verdad contra una base temporal y recorre alta → toques → antipassback → canje → tarjeta perdida |

Los tres tests que más valen: el de idempotencia bajo reintento, el de que el
tope diario no se puede forzar, y el que comprueba que la página pública del
cliente no filtra teléfono ni email.
