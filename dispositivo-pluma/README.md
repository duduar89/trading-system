# PLUMA-R

**Dispositivo DIY de caricia lenta para conciliar el sueño.**
Ciclo de 15 minutos exactos · silencioso · fallo seguro puramente mecánico · ~113–157 €

---

## Qué es

Un brazo contrapesado que arrastra una brocha ancha y tibia sobre la piel a 3 cm/s, con movimiento pseudoaleatorio, para usar tumbado en la cama antes de dormir. Se para solo a los 15 minutos.

```
      ╔═══════╗ NEMA 11 + TMC2209        contrapeso 360 g
      ║columna║ StealthChop2                    │
      ╚═══╤═══╝ cabrestante Dyneema 14,29:1     ▼
          │                              ┌───────────┐
          └── sector ── carro radial ±25 mm │ amortig. │
                          │                └───────────┘
                  bisagra de cabeceo LIBRE
                          │
      ════════════════════════════════════  botavara carbono
       lastre 40 g   patín PTFE      kabuki 60 mm · R=300 mm
                          │                    ↓
                 ╱▔▔╲ riel de leva fijo   ~~~~~~~~~~ PIEL · 400 mN
```

**Un solo motor mueve la brocha.** La fuerza la pone la gravedad, el despegue lo pone una rampa de contrachapado, y la retirada de emergencia la pone un peso colgando de una cuerda.

---

## ⚠️ Lee esto antes que nada

**Una pluma real no sirve.** Pesa 0,3 mN, unas mil veces menos que el óptimo medido de placer (400 mN), y ese régimen es *knismesis*: el cosquilleo tipo insecto que te hace apartar el brazo. Si construyes literalmente «una pluma rozando la piel», el resultado **irrita en lugar de relajar**.

Este diseño consigue la sensación de pluma como **percepto** — contacto ancho de 52 mm, muchas fibras finas, lento, tibio, con llegada suave — y no minimizando la fuerza.

> **Veredicto honesto:** no se sentirá como una pluma. Se sentirá como una brocha de maquillaje grande y suave arrastrada lentamente por una mano paciente y algo mecánica. Realismo **8/10 los primeros cinco minutos, y no demostrado a partir del minuto 8**. El razonamiento completo y las carencias, en [`docs/01-concepto.md`](docs/01-concepto.md) §4.

---

## Parámetros de diseño

| Parámetro | Valor | Fuente |
|---|---|---|
| Fuerza de contacto | **400 mN** (261–523 ajustable) | Faresse 2026 · Trotter 2023 |
| Velocidad de punta | **2–7 cm/s**, nominal 3 | Löken 2009 |
| Temperatura de contacto | ~32 °C objetivo | Ackerley 2014 |
| Anchura de contacto | 52 mm cargada | Antídoto contra la knismesis |
| Pasada sobre la piel | 199 mm | |
| Hueco sin contacto | 2,6–5,2 s | Medido en simulación |
| Ruido | ≤ 26 dBA a 50 cm | |
| Alimentación | 5 V USB 2 A (pico 740 mA) | Sin booster |

---

## Documentación

| Documento | Contenido |
|---|---|
| [`01-concepto.md`](docs/01-concepto.md) | **Empieza aquí.** Concepto, comparativa de 7 arquitecturas, diagramas, veredicto honesto |
| [`02-mecanica.md`](docs/02-mecanica.md) | Lista de corte, planos, tabla del riel grado a grado, 32 pasos de montaje |
| [`03-bom.md`](docs/03-bom.md) | BOM completa, alternativas, presupuesto eléctrico, tres presupuestos |
| [`04-electronica.md`](docs/04-electronica.md) | Esquema, pines, cadena de seguridad hardware, registros del TMC2209 |
| [`05-algoritmo-movimiento.md`](docs/05-algoritmo-movimiento.md) | Ornstein‑Uhlenbeck, los 6 ejes de variación, pseudocódigo, 3 presets |
| [`06-seguridad.md`](docs/06-seguridad.md) | FMEA, las 5 capas de parada, contraindicaciones, advertencias |
| [`07-parametros-ajuste.md`](docs/07-parametros-ajuste.md) | Guía rápida: síntoma → qué tocar |
| [`08-v2.md`](docs/08-v2.md) | Qué haría distinto una versión 2 |

**Firmware:** [`firmware/pluma_relax/`](firmware/pluma_relax/) — RP2040‑Zero, Arduino IDE, librería TMCStepper.
**Simulación:** [`simulacion/`](simulacion/) — banco de pruebas del algoritmo, compila y corre en el PC.

---

## Verificación

El algoritmo de movimiento **se compila y se ejecuta en el PC**, sin hardware:

```bash
cd simulacion
g++ -O2 -Wall -Wextra -std=c++17 -o test_movimiento test_movimiento.cpp
./test_movimiento
```

Simula 200 sesiones con semillas distintas y 10⁶ sorteos del proceso OU, y comprueba con `assert` que la velocidad nunca sale de banda, que el tope duro de 10 cm/s nunca se supera, que los huecos y la regla de ≥ 6 mm entre radios se cumplen siempre, y que queda reserva para la retirada. **Ejecuta esto después de cualquier cambio de parámetros.**

Resultado actual: `TODAS LAS COMPROBACIONES HAN PASADO`.

---

## Seguridad — resumen

**Cinco capas de parada**, en orden de independencia:

1. **Contrapeso mecánico** — retira la brocha sin electrónica de por medio. Margen 1,37×
2. **Pulsador NC enclavable** — en serie con la alimentación del motor
3. **TPL5010** — one‑shot hardware independiente a 1020 s
4. **Temporizador de firmware** — 900 s
5. **Watchdog**

**El reposo del sistema es «retirado», no «apoyado».** Mantener la brocha sobre la piel exige que el motor tire activamente contra el peso: cualquier fallo la retira.

**Contraindicaciones:** no lo usen niños ni bebés; ni personas con movilidad reducida que no puedan accionar el paro; ni personas con alergia a plumas o pelo animal (advertencia destacada en [`06-seguridad.md`](docs/06-seguridad.md) §9); ni con mascotas sueltas en la habitación. **La base nunca va sobre el colchón.**

Lee [`06-seguridad.md`](docs/06-seguridad.md) **entero** antes de usarlo sobre la piel, incluido el procedimiento de puesta en marcha y las pruebas que hay que superar antes del primer uso.

---

## Estado

Diseño completo y verificado sobre el papel. **Ningún prototipo se ha construido ni se ha probado sobre piel humana.** Los precios de la BOM son estimaciones calibradas con cuatro anclas verificadas por búsqueda web; las fichas de producto no pudieron leerse directamente, así que **contrasta los precios antes de comprar**.

Dos cosas hay que **medir antes de cortar nada**, y están marcadas como pasos bloqueantes en [`02-mecanica.md`](docs/02-mecanica.md):

- **El par de detente del motor.** Todo el fallo seguro depende de él y no aparece en ninguna hoja de datos.
- **La rigidez de las cerdas `k_brush`.** La altura del taper del riel es `(0,400/k_brush)/2,67` y no se puede cortar antes de conocerla.
