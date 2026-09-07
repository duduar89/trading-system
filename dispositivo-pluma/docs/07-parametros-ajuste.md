# PLUMA-R — 07 · GUÍA RÁPIDA DE AJUSTE

> Tarjeta de operador. Los tres presets completos, con todos sus valores, están en
> **`05-algoritmo-movimiento.md` §7**. Este documento es el mapa práctico:
> *qué toco cuando la sensación no es la que quiero.*

---

## 1. LA REGLA DE ORO

**Hay un solo mando que cambia la fuerza, y no está en el software: es el lastre de latón.**

Todo lo demás — velocidad, huecos, rampas, radios — modula el *ritmo* y la *variedad*, no la presión. Si la sensación es «demasiado fuerte» o «demasiado floja», mueve el lastre. Si es «demasiado repetitiva», «demasiado rápida» o «demasiado presente», toca el firmware.

```
   ┌──────────────────────────────────────────────────────────────┐
   │  ESCALA DEL LASTRE (impresa en la botavara, en mm)          │
   │                                                              │
   │  40      76        125        168        200                 │
   │  ├───────┼──────────┼──────────┼──────────┤                 │
   │  261    320        400        470        523   mN            │
   │  mín   suave      BASE      intenso     máx                  │
   │                                                              │
   │  Sensibilidad: 1,635 mN por mm                               │
   │  N = (4785 + 40·x) / 240   gramos-fuerza                     │
   └──────────────────────────────────────────────────────────────┘

   ⚠  NUNCA por debajo de 261 mN: entras en régimen de knismesis
      (cosquilleo de insecto), que es justo lo que el proyecto evita.
   ⚠  NUNCA por encima de 523 mN: deja de ser caricia y es masaje.
```

**Para cambiarlo:** afloja el prisionero de punta de nylon, desliza el lastre a la marca, aprieta. 20 segundos. Verifica con la báscula de cocina (`02-mecanica.md` §10) la primera vez que uses una posición nueva.

---

## 2. DIAGNÓSTICO: SÍNTOMA → QUÉ TOCAR

| Lo que sientes | Causa probable | Qué tocar | Dónde |
|---|---|---|---|
| **«Me da cosquillas, me irrita»** | Fuerza demasiado BAJA (contraintuitivo) o brocha apelmazada | Lastre **hacia arriba** a 140–168 mm. Si no mejora, **lava o cambia el cabezal** | §1 · `02` §10 |
| **«Se nota como un masaje, pesa»** | Fuerza demasiado alta | Lastre a 100–110 mm | §1 |
| **«Es agradable pero deja de notarse a los 5–8 min»** | Habituación | `DR_MIN_MM` 6 → 7, `DR_CAP_MM` 12 → 14, `OU_SIGMA_INF` 0,8 → 1,0 | `05` §6 |
| **«Va demasiado rápido, me activa»** | Velocidad alta | Preset **MÁS LENTO** completo | `05` §7.5 |
| **«Va tan lento que se me hace raro»** | Por debajo de la banda CT | Sube `BLOCK_MU` +0,4 cm/s. No bajes de 2,0 cm/s | `05` §6.2 |
| **«El primer contacto me sobresalta»** | Aterrizaje corto o piel fría | `V0_CMS` 2,2 → 2,0 (alarga las rampas), y **usa el pre-warm de 60 s** | `05` §4.2 |
| **«Se siente mecánico, predecible»** | σ baja o τ alto | `OU_SIGMA_INF` → 1,0 y `OU_TAU_STROKES` → 5. Activa `log_mode` | `05` §2.7 |
| **«Los huecos rompen la continuidad»** | Huecos largos | `GAP_MAX_S` 5,5 → 4,0 | `05` §6.3 |
| **«Quiero que desaparezca a ratos»** | — | `PARK_MIN/MAX_S` → 12/30. Máquina en silencio absoluto, IHOLD = 0 | `05` §6.4 |
| **«Oigo el carro»** | 28BYJ‑48 | `OVERLAP_FRAC` 0,20 → 0,30, y baja la frecuencia del carro | `04` §9 |
| **«Se nota una vibración fina»** | Rizado de microstepping o stick‑slip | Verifica el acoplamiento de silicona; graba a 240 fps a 2 cm/s buscando saltos periódicos de 1 mm | `02` §7 |
| **«Me llega frío»** | Sin cuna calefactada, o pre-warm saltado | Instala la cuna (B‑01). Sube `T_OBJETIVO` a 34 °C (**techo firmware 38 °C**) | `04` §5 |

---

## 3. LOS TRES PRESETS EN UNA LÍNEA

| Preset | Lastre | Velocidad media | Huecos | Impulso relativo | Para qué |
|---|---|---|---|---|---|
| **BASE** | 125 mm · 400 mN | 3,38 cm/s | 1,5–5,5 s | 1,00 | El punto de diseño |
| **MÁS SUAVE** | 76 mm · 320 mN | 2,98 cm/s | 2,5–6,5 s | **0,61** | Piel sensible; «demasiado máquina» |
| **MÁS INTENSO** | 168 mm · 470 mN | 3,80 cm/s | 1,5–4,0 s | **1,48** | No se nota lo suficiente |
| **MÁS LENTO** | 125 mm · 400 mN | 2,72 cm/s | 3,5–7,0 s | 0,68 | Hipnótico. El más silencioso |

⚠️ **«MÁS INTENSO» no es para todas las noches.** Entrega un 48 % más de impulso y 23 m de recorrido sobre la piel en vez de 18,3. Úsalo en noches alternas y revisa la piel a la semana; si aparece enrojecimiento, vuelve a BASE. Los valores completos están en `05` §7.4.

---

## 4. QUÉ **NO** PUEDES AJUSTAR (y por qué)

Es importante que lo sepas antes de perder tiempo buscando el parámetro:

| No ajustable | Por qué |
|---|---|
| **La forma del arco** | Es geometría fija: R = 300 mm, flecha 16,3 mm. Cambiarla es rehacer el riel |
| **La dirección de la pasada** | Alterna siempre, porque no hay riel sobre el centro del barrido. Una persona repite en el mismo sentido; esta máquina no puede |
| **La presión dentro de una pasada** | La fuerza es un lastre de latón. Lo único que existe son las pasadas rozadas, que invierten dentro del taper |
| **La longitud de la pasada** | 199 mm a fuerza plena. Se mueve un poco (182–216 mm) con el radio del carro |
| **El tope de 10 cm/s** | Está compilado en el PIO del RP2040. **Es deliberado que no se pueda tocar desde el firmware** |
| **Los 15 minutos** | Dos capas independientes (firmware + TPL5010). Cambiar una sin la otra rompe la seguridad |

---

## 5. ORDEN RECOMENDADO PARA EXPERIMENTAR

No cambies cinco cosas a la vez: no sabrás cuál funcionó.

1. **Noche 1–3: BASE sin tocar nada.** Necesitas una referencia. Anota cómo se siente al minuto 2, al 8 y al 14.
2. **Noche 4: solo el lastre.** ±25 mm arriba o abajo según el diagnóstico de §2. Es el 80 % del efecto.
3. **Noche 5–6: solo el ritmo.** Uno de los tres presets completos, sin mezclar.
4. **Noche 7+: afina un parámetro cada vez.** `OU_SIGMA_INF` y `DR_CAP_MM` son los dos que más cambian la percepción de «variedad».
5. **Prueba los dos cabezales.** Están recortados distinto a propósito. El cambio son 10 segundos y la diferencia es mayor de lo que esperas.

**Después de cada cambio de firmware**, ejecuta el banco de pruebas antes de subirlo:

```bash
cd simulacion && g++ -O2 -Wall -Wextra -std=c++17 -o test_movimiento test_movimiento.cpp && ./test_movimiento
```

Si algún `assert` falla, tu combinación de parámetros **viola el contrato numérico**. El banco simula 200 sesiones y comprueba las bandas de velocidad, el tope duro, los huecos, la regla de ≥ 6 mm entre radios y la reserva de retirada.

---

## 6. COMPROBACIÓN MENSUAL (5 minutos)

| Comprobación | Cómo | Criterio |
|---|---|---|
| **Fuerza** | Báscula de cocina de 1 g bajo la brocha, a mitad del arco | 400 ± 25 mN (40,8 ± 2,5 g) |
| **Apelmazamiento** | Mira la huella al posarse sobre papel oscuro | Debe seguir siendo de ~52 mm de ancho |
| **Retirada** | Desenchufa a mitad de ciclo | La brocha debe salir de la piel y aparcar sola |
| **Amortiguador** | Cronometra la retirada desde +30° | 2–3 s. Si es instantánea, el pistón está descolgado; si no baja, está agarrotado |
| **Cordón** | Inspecciona el Dyneema en el tambor | Sin deshilachado, sin descarrilar de las pestañas |

La comprobación de la fuerza es **la más importante** y la que más gente se salta: es la única forma de detectar el fallo insidioso descrito en `01-concepto.md` §4, en el que la brocha se apelmaza y el percepto deriva hacia el cosquilleo sin que nada parezca roto.
