# 2 · Cómo se hacen los puntos

Esta es la parte que no es técnica y es la que decide si el programa funciona.
El NFC es media tarde de trabajo. Esto es el negocio.

---

## 2.1 Los tres modelos que existen

| | **Sellos por visita** | **Puntos por euro** | **Híbrido** |
|---|---|---|---|
| Qué cuenta | que vengas | cuánto gastas | las dos cosas |
| En el mostrador | 1 toque | teclear importe + toque | teclear importe + toque |
| Lo entiende el cliente | a la primera | hay que explicarlo | regular |
| Premia a | al que viene mucho | al que gasta mucho | mezcla |
| Riesgo | el que se gasta 4 € y el que se gasta 40 € suman igual | el ocasional no llega nunca | complejidad |
| Encaja en | cafetería, bar, peluquería, gimnasio, club | restaurante de ticket alto, tienda | cadenas |

**Empieza por sellos.** No por simplicidad técnica: por el mostrador. Teclear el
importe con cinco personas esperando es la razón número uno por la que el
empleado deja de pedir la tarjeta, y un programa que no se usa a las tres semanas
no existe. Con sellos el gesto es: acercar y ya está.

En `config.json` se cambia de modelo con una línea. Puedes empezar por sellos y
pasarte a puntos por euro en enero sin tocar código ni cambiar las tarjetas.

---

## 2.2 Cuánto cuesta esto de verdad

La pregunta buena no es "¿cuántos puntos doy?" sino **"¿qué porcentaje de mi
facturación estoy regalando?"**. Se calcula así:

```
   coste real del premio   =  precio de venta  ×  food cost
   coste del programa (%)  =  ─────────────────────────────────────────
                               ticket medio  ×  visitas para el premio
```

Ejemplo con la configuración que viene puesta (10 sellos → plato gratis):

| Dato | Valor |
|---|---|
| Ticket medio | 15 € |
| Precio del premio | 12 € |
| Food cost del premio | 30 % → **3,60 € de coste real** |
| Visitas hasta el premio | 10 |
| Facturación en esas 10 visitas | 150 € |
| **Coste del programa** | 3,60 / 150 = **2,4 %** |

Un 2–3 % es el rango sano en hostelería. Por encima del 5 % estás regalando el
margen; por debajo del 1,5 % el cliente no se molesta en sacar la tarjeta.

**Y encima cuesta menos de lo que dice ese número**, porque entre un 20 % y un
40 % de los sellos no se canjean nunca — la gente pierde la tarjeta, se muda, se
olvida. En el sector lo llaman *breakage*. No lo metas en las cuentas para
justificar ser más generoso: si un año se canjea todo de golpe, te come.

---

## 2.3 El error que mata estos programas: la cadencia

> **Regla:** un cliente habitual tiene que poder completar la tarjeta en **4 a 8 semanas**.

Si tu cliente medio viene dos veces al mes, una tarjeta de 10 sellos tarda
**cinco meses**. Nadie aguanta cinco meses mirando una tarjeta a medias. La
abandona en el sello 3 y el programa muere.

| Frecuencia del cliente habitual | Sellos para el premio |
|---|---|
| Casi a diario (cafetería, gimnasio) | 10 |
| 2 veces por semana | 8 |
| 1 vez por semana | 6 |
| 2 veces al mes | 4–5 |
| 1 vez al mes o menos | **no uses sellos** — usa puntos por euro, o no hagas programa |

Antes de elegir el número, mira cuánta gente repite. Si no lo sabes, ese es el
primer dato que te va a dar este sistema: ponlo a funcionar un mes con un
objetivo conservador y luego ajusta.

---

## 2.4 Premios: mejor uno bueno que cuatro flojos

Lo que viene configurado son tres escalones (5 / 8 / 10 puntos) para que veas el
mecanismo, pero para arrancar **un solo premio claro funciona mejor**: "diez
cafés y el once te lo invitamos" se explica en cinco segundos y se cuenta a un
amigo. Tres niveles obligan a decidir, y decidir en la barra es fricción.

Dos cosas que sí merecen la pena:

- **Premio que traiga otra visita**, no descuento en efectivo. Un café gratis te
  devuelve al cliente a la tienda; 2 € de descuento no.
- **Un premio pequeño pronto.** Un detalle al tercer sello (el típico "cortesía
  de bienvenida") sube muchísimo la probabilidad de llegar al décimo. El efecto
  se llama *endowed progress*: por eso `config.json` regala 1 punto en el alta —
  la tarjeta no nace vacía, nace con uno.

---

## 2.5 Multiplicadores: para mover el negocio, no para regalar

Los multiplicadores existen para llenar los huecos, no para ser generoso:

```json
"multiplicadores": [
  { "tipo": "dia_semana", "dia": 2, "factor": 2, "etiqueta": "Martes x2" },
  { "tipo": "franja", "desde": "16:00", "hasta": "18:30", "factor": 2 },
  { "tipo": "cumpleanos", "margen_dias": 3, "factor": 2 }
]
```

- **Día flojo x2** — si el martes está muerto, ahí va el x2. No el viernes.
- **Franja valle x2** — media tarde, entre comidas.
- **Cumpleaños x2** — barato, se recuerda, y es la única excusa decente para
  pedirle la fecha de nacimiento a alguien.

Ojo: las franjas van en **hora UTC** en la configuración. En horario de verano
peninsular, las 16:00 locales son las `"14:00"`.

---

## 2.6 Caducidad

Los puntos caducan a los **12 meses sin actividad** (`caducidad_meses`), no en
una fecha fija. Es decir: mientras vengas, no pierdes nada; si desapareces un
año, se borra el saldo.

Esto no es tacañería, es contabilidad. Sin caducidad, los puntos en circulación
crecen para siempre y un día alguien aparece con tres años de saldo acumulado.
La caducidad cierra ese pasivo.

Tiene que estar escrito en las bases del programa y avisado antes de aplicarla.
Ver [`05-seguridad-y-fraude.md`](05-seguridad-y-fraude.md) §5.6.

La caducidad **no borra el histórico**: escribe un apunte negativo visible en el
libro mayor, como todo lo demás.

---

## 2.7 Los números que hay que mirar cada mes

`GET /api/metricas` devuelve esto; el que importa es el tercero.

| Métrica | Qué te dice | Señal de alarma |
|---|---|---|
| `altas_30d` | si el mostrador sigue dando de alta | cae a cero → el equipo dejó de pedirlo |
| `taps_30d / altas` | si las tarjetas se usan o se quedan en el cajón | < 1,5 → tarjetas muertas |
| **`clientes_recurrentes_30d`** | **cuántos vinieron ≥ 2 veces** | es el único número que mide si el programa hace algo |
| `canjes_30d` | si alguien llega al premio | 0 tras dos meses → objetivo demasiado alto |
| `puntos_en_circulacion` | tu pasivo: lo que debes en premios | crece sin parar → falta caducidad |

El experimento honesto para saber si funciona: compara la frecuencia de visita
de los que se apuntaron **antes y después** de apuntarse. Comparar socios contra
no socios no vale — los que se apuntan ya eran tus mejores clientes.
