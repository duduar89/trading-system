# 04 — DISEÑO ELECTRÓNICO COMPLETO — PLUMA-R

Deriva de `final_spec.md` (contrato vinculante), de `research.md` (los cinco informes) y es hermano de
`03-bom.md` (compras). **Donde la especificación vinculante contiene un error aritmético, una ambigüedad
peligrosa o una imposibilidad física, este documento lo corrige y lo señala en voz alta en la sección 12.**

Fecha de referencia: septiembre 2026. Unidades SI, precios en EUR con IVA español.

---

## ÍNDICE

0. [Resumen de decisiones](#0)
1. [¿Hace falta un ESP32? — ESP32 vs RP2040-Zero vs Arduino Nano](#1)
2. [Esquema eléctrico completo](#2)
3. [Tabla de pines](#3)
4. [Cadena de seguridad hardware](#4)
5. [Calefactor de la férula: por qué es intrínsecamente seguro](#5)
6. [Configuración del TMC2209 por UART](#6)
7. [Alimentación: presupuesto, desacoplo, brownout](#7)
8. [Microrruptor de leva del punto de reposo](#8)
9. [Interfaz de usuario](#9)
10. [BOM electrónica](#10)
11. [Lista de comprobación antes de energizar el motor](#11)
12. [Contradicciones encontradas y corregidas](#12)

---

<a name="0"></a>
## 0. RESUMEN DE DECISIONES

| Decisión | Elección | Razón en una línea |
|---|---|---|
| MCU | **RP2040-Zero** (4,50 €) | El PIO convierte el tope de 10 cm/s en un **suelo de tiempo compilado en memoria de instrucciones**, no en un `if` |
| ¿ESP32? | **No.** Innecesario | Su única ventaja real (táctil capacitivo) se compra por 0,40 € con un TTP223, y la radio hay que apagarla igualmente |
| ¿Arduino Nano? | Viable, con un parche de 1,20 € | Suficiente en cómputo; pierde el suelo hardware, que se restituye con un CD4538 |
| Driver | TMC2209 (BTT/FYSETC oficial), StealthChop2 permanente | 62 dBA → 44 dBA medidos sobre la misma máquina |
| Microstepping | 1/32 por UART, MicroPlyer a 1/256 | 2,58 µm/µpaso; el rizado de punta queda 5-60× bajo el umbral vibrotáctil |
| Paro de emergencia | **Pulsador NC enclavable en serie con el cobre del raíl del motor** | Funciona con el firmware colgado, con el MCU muerto y con el USB desenchufado |
| Temporizador 15 min | **Dos capas**: firmware (900 s) + TPL5010 hardware (**1 020 s**; no 960, porque su ventana arranca con el pulsador y el pre-warm de 60 s se come el margen entero) | Fallan por causas independientes; el hardware nunca debería llegar a disparar |
| Colgado de firmware | **P-FET con charge pump de latido**, corta en <250 ms | Sin él, unas bobinas energizadas por un bucle colgado sujetan la brocha contra el contrapeso |
| Calefactor | 120 Ω, 0,208 W, techo **de hardware** = T_amb + 17,7 K | Un MOSFET en cortocircuito no puede superarlo: la resistencia es el limitador |
| Sensor de posición | **Un microrruptor de palanca (0,40 €)**. Ni AS5600 ni hall | Homing + integridad + corrección de pasos perdidos con una pieza |
| Alimentación | **5 V USB nativo.** Ni boost ni PD trigger | Duty StealthChop del 53 % en la cresta de la senoide; el cuello de botella es el cable, no la tensión |
| Interfaz | Pulsador de silicona + LED rojo a 0,15 mA. **Nada de OLED, nada de zumbador** | El producto entero es "termina sin despertarte" |

---

<a name="1"></a>
## 1. ¿HACE FALTA UN ESP32? RESPUESTA DIRECTA

> **NO. Un ESP32 es innecesario en este proyecto, y en un par de aspectos concretos es activamente peor.**
> La alternativa más sencilla y correcta es un **RP2040-Zero** (4,50 €, más barato que el ESP32).
> Si ya tienes un **Arduino Nano** en un cajón, también sirve —con un parche de 1,20 €— y en la sección 1.5 está
> exactamente qué pierdes.

### 1.1 Qué tiene que hacer realmente el firmware

Vamos a poner la carga de trabajo sobre la mesa antes de elegir el chip:

| Tarea | Frecuencia | Coste computacional |
|---|---|---|
| Generar pulsos STEP | 730-3400 Hz | Un temporizador |
| Recalcular la velocidad (paseo de Ornstein-Uhlenbeck) | **1 vez cada ~14 s** | 3 multiplicaciones en coma flotante |
| Sortear R radial con la regla "≥6 mm de diferencia con los dos anteriores" | 1 vez cada ~14 s | Un `while` con dos comparaciones |
| Secuencia de 8 fases del 28BYJ-48 | ~64 veces por sesión, 2,5 s cada una | Una tabla de 8 bytes |
| Lazo PID del calefactor | 2 Hz | Una resta y un acumulador |
| Leer 2 ADC (NTC, raíl de 5 V) | 10 Hz | Trivial |
| Leer el microrruptor | 100 Hz | Trivial |
| Cronómetro de 900 s | Cada vuelta del bucle | Una comparación de 64 bits |
| Registros TMC2209 por UART | Al arrancar + 1 lectura/golpe | 115200 baudios, half-duplex |

**Esto cabe en cualquier microcontrolador fabricado desde 1995.** La memoria total de estado son unos 200 bytes.
No hay pantalla, no hay red, no hay ficheros, no hay audio. **La elección de MCU NO se decide por potencia de cálculo.**

Se decide por una sola pregunta: **¿dónde vive el tope de 10 cm/s?**

### 1.2 El PIO del RP2040: por qué el tope es de hardware y el firmware no lo puede saltar

La especificación vinculante dice: *"Compiled-in PIO minimum step interval caps the tip at 10 cm/s regardless of
firmware state"*. Esto no es marketing; es una propiedad estructural del periférico PIO y merece explicarse a fondo,
porque es **la única razón real** para elegir este chip.

El PIO (Programmable I/O) del RP2040 son cuatro máquinas de estados independientes con su propia memoria de
instrucciones de 32 palabras de 16 bits. Corren a su propio reloj, derivado del reloj de sistema por un divisor,
y **no ejecutan código de la CPU**. Se comunican con la CPU por una FIFO.

El generador de pasos se escribe así:

```
;-------------------------------------------------------------------------
; paso_lento.pio   —   reloj del PIO = 1 MHz  (div = 125 desde 125 MHz)
;                      1 tick = 1 µs
;
; La CPU escribe en la FIFO TX una palabra = ticks EXTRA de espera.
; La máquina emite UN pulso STEP y espera (SUELO + extra).
;-------------------------------------------------------------------------
.program paso_lento
.wrap_target
    pull  block                  ; 1 tick  — espera palabra; si no hay, SE PARA
    mov   x, osr                 ; 1 tick  — x = retardo extra
    set   pins, 1        [9]     ; 10 ticks — STEP alto, ancho de pulso 10 µs
    set   pins, 0        [4]     ; 5 ticks  — STEP bajo
    set   y, 21          [4]     ; 5 ticks  — SUELO: carga 22 iteraciones
suelo:
    jmp   y--, suelo     [9]     ; 22 × 10 = 220 ticks   <<< EL TOPE VIVE AQUÍ
extra:
    jmp   x--, extra             ; 1 tick por unidad de la FIFO — SOLO SUMA
.wrap
```

**Intervalo mínimo = 1 + 1 + 10 + 5 + 5 + 220 = 242 µs.** Redondeamos y lo llamamos **240 µs**.

Traducción a velocidad de punta, con 0,6597 mm por paso completo a R = 300 mm y microstepping 1/32:

| Radio R | mm por pulso STEP | Pulsos/s con suelo de 240 µs | **Velocidad de punta máxima** |
|---|---|---|---|
| 275 mm (mínimo) | 0,01890 mm | 4167 | **7,87 cm/s** |
| 300 mm (nominal) | 0,02062 mm | 4167 | **8,59 cm/s** |
| **325 mm (máximo)** | 0,02233 mm | 4167 | **9,30 cm/s** |

El caso peor (R máximo, brazo más largo, más mm por pulso) da **9,30 cm/s < 10 cm/s**. ✔
Y en el otro extremo, ¿queda margen para la banda de trabajo? A R = 275 mm, 7,0 cm/s exige un intervalo de
0,01890/70 = **270 µs > 240 µs**. ✔ La banda 2,0-7,0 cm/s es alcanzable en todos los radios.

**Ahora la parte que importa: por qué el firmware no puede saltárselo.**

1. `set y, 21` es un **campo inmediato de 5 bits dentro de la palabra de instrucción de 16 bits**. No es una
   variable en RAM. No es un registro de configuración. Está en la memoria de instrucciones del PIO, escrita
   una vez al arrancar desde una constante del binario.
2. `[9]` es un **campo de retardo de 5 bits dentro de la misma palabra de instrucción**. Idem.
3. `jmp x--, extra` **solo puede sumar tiempo**. Sea cual sea la palabra que llegue por la FIFO —un cero, un
   número negativo interpretado como entero sin signo enorme, basura de un puntero corrupto— el resultado es
   **igual o más lento**, nunca más rápido.
4. Si la FIFO se queda vacía (bucle principal colgado, planificador muerto, desbordamiento de pila),
   `pull block` **bloquea la máquina de estados**. El motor **se para**. Ese es el sentido correcto del fallo.

Es decir: **todos los modos de fallo del planificador de movimiento —un paseo OU desbocado, una división por
cero, un desbordamiento en la tabla de velocidad, una fase de sector perdida, un `int` que da la vuelta—
producen un movimiento igual o más lento, nunca más rápido.** Eso no es cierto en ningún esquema en el que el
periodo del pulso sea un valor que el software escribe en un registro.

**HONESTIDAD SOBRE EL ALCANCE DE ESTA GARANTÍA.** El suelo del PIO es una barrera contra **errores de diseño y
de cálculo**, que es donde vive el 99 % del riesgo real de un aparato como éste. No es una barrera contra
**ejecución de código arbitrario**: un puntero desbocado que escribiera en `PIO0->SM0.CLKDIV` podría acelerar el
reloj del PIO, y ningún microcontrolador del mercado lo impide por sí solo. Dos observaciones:

- Se puede endurecer: el Cortex-M0+ del RP2040 **sí tiene MPU**. Tras la inicialización, marca el bloque de
  registros de PIO0 (0x50200000) como solo-lectura en modo privilegiado. Cualquier escritura posterior provoca
  un HardFault, que reinicia, que desenergiza, que suelta el contrapeso. 20 líneas de código. Opcional pero barato.
- Y sobre todo: **el tope de velocidad no es la historia de seguridad de esta máquina.** La historia de seguridad
  es mecánica: 400 mN es un lastre de latón sobre un eje sin actuador, la fuerza tangencial está topada en 0,58 N
  por IRUN, y el contrapeso retira la brocha en cuanto se corta el cobre. El tope de velocidad evita que un error
  de firmware produzca un roce desagradable a 25 cm/s; **no es lo que impide que la máquina te haga daño**, porque
  la máquina no puede hacer daño aunque vaya a 25 cm/s. Quien te diga lo contrario está vendiendo el chip.

### 1.3 Comparativa a tres bandas

| Criterio | **ESP32-WROOM-32** | **RP2040-Zero** ✔ | **Arduino Nano (clon CH340)** |
|---|---|---|---|
| Precio (2026, ES) | 5-6 € | **4,50 €** | **2,20 €** |
| Núcleo | 2× Xtensa LX6 @240 MHz | 2× M0+ @133 MHz | 1× AVR 8 bits @16 MHz |
| RAM | 520 KB | 264 KB | 2 KB |
| **Generación de pasos** | RMT / MCPWM / LEDC / ISR | **PIO: 4 máquinas independientes** | Timer1 CTC + ISR |
| **¿El tope de velocidad es hardware?** | **NO** — el periodo es un registro que el software escribe | **SÍ** — inmediato en memoria de instrucciones | **NO** — es un `if` en la ISR |
| Lógica de E/S | 3,3 V — casa con TMC2209 | **3,3 V — casa con TMC2209** | 5 V — hay que alimentar VIO del módulo a 5 V |
| GPIO durante reset/arranque | **Flotantes + 4 pines de strapping (0/2/12/15)** | Limpio, entradas con pull-down por defecto | Limpio |
| Consumo (radio apagada) | 40-60 mA | **25 mA** | 19 mA |
| Radio | WiFi + BLE — **hay que apagarla** (picos de 300 mA sobre el raíl de 5 V que alimenta VM del driver) | ninguna | ninguna |
| Táctil capacitivo nativo | **10 canales** (única ventaja real) | no | no |
| EEPROM real | no (NVS en flash) | no (flash emulada) | **sí, 1 KB** |
| Watchdog hardware interno | sí | sí | sí (máx 8 s) |
| Coma flotante | rápido | aceptable | lento — irrelevante (1 cálculo cada 14 s) |

### 1.4 Qué aporta cada uno, sin adornos

**ESP32 — lo que realmente aporta y por qué no basta:**

- ✔ **Táctil capacitivo nativo.** Es una ventaja genuina: un pad de arranque sin clic en la caja de la mesilla,
  cero piezas móviles, cero ruido. Es la mejor propiedad del ESP32 para este aparato.
  **Pero** un módulo TTP223 cuesta **0,40 €** y le da lo mismo a cualquier MCU. La única ventaja exclusiva del
  ESP32 se compra por 40 céntimos.
- ✔ **WiFi/BLE para tunear la caricia desde el móvil sin reflashear.** Suena bien.
  **Pero** durante la sesión la radio tiene que estar apagada: los picos de transmisión de 250-300 mA sobre un
  raíl de 5 V del que cuelga VM del TMC2209 —cuyo mínimo absoluto es 4,75 V— son exactamente el mecanismo de
  brownout que el informe de actuadores señala. Así que tunearías **entre** sesiones, que es justamente cuando
  tienes el cable USB a mano. La ventaja se evapora.
- ✘ **Los GPIO flotan en alta impedancia durante el reset y el arranque**, y hay cuatro pines de strapping
  (GPIO0, 2, 12, 15) cuyo nivel decide el modo de arranque. En una máquina con un motor colgado esto es un
  pasivo, no un activo: obliga a auditar cada pin y a poner resistencias de fijación en todos ellos.
- ✘ **Cuesta más que el RP2040-Zero** y consume el doble.
- ✘ **No tiene PIO.** El tope de velocidad pasa a ser un `if` en el software, que es exactamente lo que se
  quería evitar.

> **Veredicto ESP32: innecesario.** No aporta nada que este aparato necesite, cuesta más, consume más, y su
> único rasgo diferencial cuesta 0,40 € en cualquier otra placa.
> **Y si aun así quieres ESP32: usa WROOM-32, NUNCA un ESP32-C3.** El silicio del C3 eliminó por completo el
> periférico táctil capacitivo, con lo que se queda sin la única razón para elegir la familia.

**RP2040-Zero — lo que aporta:**

- ✔ El PIO, y con él el suelo de 240 µs compilado (sección 1.2). Es la razón de la elección.
- ✔ Lógica de 3,3 V: casa directamente con STEP/DIR/EN/UART/DIAG del TMC2209, sin adaptar niveles en ningún sitio.
- ✔ 25 mA y sin radio: nada modula el raíl de 5 V del que cuelga el chopper.
- ✔ Es el más barato de los capaces.
- ✘ No tiene EEPROM real; PWM_OFS/PWM_GRAD se guardan en un sector de flash reservado (biblioteca estándar, 15 líneas).
- ✘ Lleva un WS2812 en placa (GP16) que **hay que anular**: incluso con valor 0 el chip consume 0,6-1 mA y su
  troquel emite un brillo tenue perfectamente visible en una habitación a oscuras. Píntalo con una gota de
  esmalte negro mate o levanta su pad de alimentación. **No es opcional en un aparato de mesilla.**

### 1.5 VARIANTE ARDUINO NANO: para quien ya lo tenga en un cajón

**Sí funciona.** Voy a ser preciso sobre qué se pierde, porque la respuesta honesta es "menos de lo que parece".

**Lo que NO se pierde (contra la creencia habitual):**

- **Cómputo.** Un paseo OU con tres multiplicaciones en coma flotante cada 14 segundos, sobre un AVR a 16 MHz,
  tarda ~120 µs. Es el 0,0009 % del tiempo. La coma flotante lenta del AVR es completamente irrelevante aquí.
- **RAM.** El estado total son ~200 bytes de los 2048 disponibles. Sobra.
- **Jitter de paso.** El intervalo nominal a 3 cm/s es de 687 µs. Una ISR de Timer1 en CTC, con `millis()` y el
  UART como únicas interrupciones competidoras, da un jitter de 4-8 µs, es decir **≤1,2 %**. Y ese jitter entra
  después por un acoplamiento de silicona con f_n = 5,2 Hz, que atenúa cualquier cosa por encima de 100 Hz en
  más de 300×. **No se nota. No mientas al usuario diciendo que sí.**
- **EEPROM.** El Nano tiene 1 KB de EEPROM real, más cómoda que la flash emulada del RP2040 para guardar
  PWM_OFS/PWM_GRAD y la constante de pasos del homing. **Esto es un punto a favor del Nano.**

**Lo que SÍ se pierde, y su coste exacto:**

| Pérdida | Consecuencia | Parche | Coste |
|---|---|---|---|
| **El suelo de paso en hardware** | El tope de 10 cm/s pasa a ser `if (t < T_MIN) t = T_MIN;` dentro de la ISR. Un puntero corrupto, una variable global pisada o un `unsigned` que da la vuelta pueden saltárselo | **CD4538 monoestable no redisparable + 74HC08** en la línea STEP: el pulso que pasa dispara un cegado de 240 µs que traga cualquier pulso posterior. El suelo vuelve a ser hardware, y esta vez **fuera del MCU**, que es todavía mejor | **1,20 €** |
| **Lógica de 5 V** | El TMC2209 no es tolerante a 5 V con VIO a 3,3 V | Alimenta el pin **VIO del módulo a 5 V**. Entonces STEP/DIR/EN/PDN_UART/DIAG trabajan todos a 5 V y encajan con el Nano. **No mezcles: o todo VIO=5 V, o divisores en las 5 líneas** | 0 € |
| Sin segundo núcleo | Ninguna: no hay nada que paralelizar | — | 0 € |
| Watchdog máx. 8 s | Suficiente (usamos 2 s) | — | 0 € |
| Menos pines analógicos libres | El Nano tiene A0-A7: sobran | — | 0 € |

**Circuito del cegador CD4538 (obligatorio en la variante Nano):**

```
                          +5V
                           |
                         [24k]          T = R·C = 24k × 10nF = 240 us
                           |
  STEP_ISR ---+--------> [ +TR ]  CD4538   /Q ------+
  (del Nano)  |          [ Cx  ]--||--GND          |
              |           10 nF                     |
              |                                     |
              |     +-------------------------------+
              |     |
              +---->| &  74HC08 (AND)  |------------> STEP  (al TMC2209)
                    +------------------+
                    Un pulso pasa -> el monoestable pone /Q = 0
                    durante 240 us -> todo pulso que llegue
                    en esa ventana se TRAGA.
                    Modo NO REDISPARABLE (CD pin a Vdd).
```

> **VEREDICTO NANO:** funciona, cuesta 2,20 € + 1,20 € de parche = **3,40 €** frente a 4,50 € del RP2040-Zero.
> **El ahorro es de 1,10 €: no cambies por precio.** Cambia solo si ya tienes el Nano y no tienes RP2040, y en
> ese caso **monta el CD4538 sí o sí** — no lo consideres opcional, porque es lo único que te devuelve la
> propiedad que justificaba el RP2040.

### 1.6 Y si te preguntan por qué no un Arduino Nano Every, un XIAO o un STM32

- **Arduino Nano Every**: 23,90 € en la tienda oficial por un ATmega4809. Cuesta diez veces un clon y no aporta
  nada aquí. Descartado.
- **XIAO ESP32C3**: placa preciosa, ~11 € en reventa europea, y el C3 **no tiene táctil capacitivo**. Descartado.
- **STM32 "Blue Pill"**: 2-3 €, timers excelentes, pero el ecosistema de clones con chips CKS/CS32 re-marcados
  es un campo de minas y no hay nada equivalente al PIO. Si lo dominas, adelante; no lo recomiendo a nadie que
  no lo domine ya.

---

<a name="2"></a>
## 2. ESQUEMA ELÉCTRICO COMPLETO

Cinco bloques. Todos comparten **un único plano de masa en estrella** cuyo punto de estrella es el terminal
negativo del condensador de 470 µF, junto a los pines VM/GND del TMC2209.

### 2.1 Bloque A — Entrada de alimentación y CADENA DE SEGURIDAD

```
 ==========================================================================================
  BLOQUE A — ALIMENTACIÓN Y CADENA DE SEGURIDAD HARDWARE
 ==========================================================================================

  Cargador USB 5 V / 2 A (IEC 62368-1, marcado CE)
        |
        |  CABLE DE CARGA CORTO:  <= 0,5 m,  20-22 AWG en los conductores de potencia
        |  (con 28 AWG y 2 m caen 0,68 V a 0,8 A y el TMC2209 hace brownout — ver 7.4)
        v
  +-----------------+
  | Conector USB-C  |  (o USB-A hembra) de panel, atornillado a la columna
  | de panel        |
  +--+-----------+--+
     |           |
    +5V         GND -------------------------------------------------+
     |                                                               |
   [F1] Polifusible 2 A hold  (MF-R200, R_typ 0,05 ohm = 40 mV a 0,8 A)
     |                                                               |
     +------> NODO  "VBUS"  (SIEMPRE VIVO mientras haya USB)         |
     |                                                               |
     +--[C1] 100 uF / 10 V electrolitico  ---------------------------+
     |                                                               |
     +--> RP2040-Zero pin 5V                                         |
     +--> CD4013B  pin 14 (VDD)      <-- el latch DEBE seguir vivo   |
     +--> divisor de sensado de rail -> GP28                          |
     |                                                               |
     |                                                               |
     v                                                               |
  ###########################################################        |
  #  S1   PARO DE EMERGENCIA                                #        |
  #                                                         #        |
  #      VBUS o---___  ___o VSW                             #        |
  #               \  \/                                     #        |
  #                \                                        #        |
  #   Pulsador seta 16 mm, contacto NORMALMENTE CERRADO,    #        |
  #   ENCLAVABLE (push-to-break, twist-to-release), 1 A.    #        |
  #                                                         #        |
  #   ESTA EN SERIE CON EL COBRE QUE ALIMENTA LOS MOTORES.  #        |
  #   No es una entrada de GPIO. No pasa por el firmware.   #        |
  #   Pulsarlo abre el circuito y SE QUEDA ABIERTO.         #        |
  ###########################################################        |
     |                                                               |
     +--> NODO "VSW"                                                 |
     |                                                               |
     +----[R1 100k]----+                                             |
     |                 |                                             |
     |   S ------------+------ G     Q1 = AO3401A  (P-MOSFET)        |
     +---|             |             Rds_on 50 mohm @ Vgs = -4,5 V   |
         |             |             R1 lo mantiene CORTADO por      |
         D             |             defecto: sin nadie que tire de  |
         |             |             la puerta, el rail esta MUERTO. |
         |            [R2 10k]                                       |
         |             |                                             |
         |             D                                             |
         |            |-|  Q2 = 2N7002  (N-MOSFET)                   |
         |             S                                             |
         |             |                                             |
         |            GND ---------------------------------------------+
         |             ^
         |             |
         |          NODO "HB"  (puerta de Q2)  <-- ver bloque A2
         |
         +--------> NODO "VMOT"  (RAIL CONMUTADO DE LOS MOTORES)
                        |
                        +--[C2] 470 uF / 10 V LOW-ESR  (patas < 10 mm a VM/GND del TMC2209)
                        +--[C3] 100 nF ceramico X7R    (junto a C2)
                        +--> TMC2209  VM
                        +--> ULN2003  COM (pin 9)  y  +5V del 28BYJ-48
                        +--> calefactor de la ferula (via fusible termico)
                        +--> calefactor de la taza de reposo
                        +--> TPL5010 VDD          <-- SE ALIMENTA DEL RAIL CONMUTADO
                        +--> divisor 10k/10k -> GP12 (RAIL_SENSE)
```

### 2.2 Bloque A2 — Charge pump de latido y latch del one-shot de 17 min

```
 ==========================================================================================
  BLOQUE A2 — LOS DOS GUARDIANES ELECTRÓNICOS DEL NODO "HB"
 ==========================================================================================

  (1) CHARGE PUMP DE LATIDO — mata el rail si el firmware se cuelga
  --------------------------------------------------------------------

   GP11 del RP2040                D1 = BAT54 (o 1N4148)
   onda cuadrada 2 kHz, 50 %      D2 = BAT54 (o 1N4148)
   generada por un slice PWM
   (hardware, NO por software)
        |
        |     C4 220 nF
        +------||------+-----|>|-----+------- NODO "HB"
                       |     D2      |
                       |             |
                      _|_           [R3] 470k        [C5] 100 nF
                      /_\ D1         |                |
                       |            GND              GND
                      GND

   Con la onda cuadrada viva:  V(HB) ~ 2 x 3,3 - 2 x 0,3 = 6,0 V  -> Q2 ON -> Q1 ON -> VMOT VIVO
   Sin onda (pin colgado ALTO, colgado BAJO, MCU en reset, MCU muerto):
        no hay bombeo -> C5 se descarga por R3
        tau = 470k x 100nF = 47 ms
        cae por debajo de Vgs(th) de Q2 (~1,5 V) en ~3 tau = 140 ms
        -> VMOT MUERTO en < 250 ms  -> las bobinas quedan ABIERTAS
        -> el contrapeso de 360 g gana y retira la brocha.

   CLAVE: un pin ATASCADO EN ALTO no mantiene nada. Solo una onda VIVA lo hace.
          Y la onda la genera un periferico PWM que el firmware tiene que
          reconfigurar en cada arranque; no sobrevive a un reset por si sola.


  (2) LATCH DE PARADA — one-shot de 17 min, brownout y fin de ciclo
  --------------------------------------------------------------------

                                  +5V (VBUS, SIEMPRE VIVO)
                                       |
                                    [pin 14]
   TPL5010 WAKE  ---|>|---+        +--------------+
   (a los 1020 s)  D3     |        |   CD4013B    |
                          |        |  1/2 flip-flop|
   GP10 MOTOR_KILL -|>|---+------->| SET (pin 6)  |
   (fin de ciclo)  D4     |        |              |
                          |        | D (pin 5) ---+-- GND
   Comparador brownout ---+        | CLK (pin 3) -+-- GND
   (< 4,60 V)      D5     |        |              |
                          |        | RESET (pin 4)|<---- pulso de ARRANQUE
                         [R4]      |              |      (diferenciador RC del
                        100k       |    Q (pin 1) |       pulsador, ver 2.5)
                          |        +------+-------+
                         GND              |
                                          |         Q = 1  ->  DISPARADO
                                          v
                                       [R5 10k]
                                          |
                                          D
                                         |-|  Q3 = 2N7002
                                          S
                                          |
                                         GND

   Q3 con la puerta a Q: cuando Q=1, Q3 CORTOCIRCUITA EL NODO "HB" A MASA.
   Da igual que el latido siga vivo: Q2 se corta, Q1 se corta, VMOT muere,
   Y SE QUEDA MUERTO hasta que alguien pulse el boton de arranque.

   POR (POWER-ON RESET) OBLIGATORIO:
        [C6 100 nF] de VBUS a SET  +  [R4 100k] de SET a GND
        -> al enchufar el USB, SET recibe un pulso -> Q = 1 -> VMOT MUERTO.
        ENCHUFAR EL APARATO NUNCA ENERGIZA EL MOTOR. Hay que pulsar el boton.
```

### 2.3 Bloque B — MCU, driver TMC2209 y NEMA 11

```
 ==========================================================================================
  BLOQUE B — RP2040-ZERO  +  TMC2209  +  NEMA 11 11HS12-0674S
 ==========================================================================================

  +-------------------------+                    +--------------------------------+
  |     RP2040-Zero         |                    |   TMC2209 V1.3 (BTT/FYSETC)    |
  |                         |                    |                                |
  |  5V  <--- VBUS          |                    |  VM   <--- VMOT (rail conmut.) |
  |  3V3 ---> (a VIO, NTC,  |                    |  GND  <--- GND                 |
  |           pull-ups)     |                    |  VIO  <--- 3V3 del RP2040      |
  |  GND ---- GND estrella  |                    |                                |
  |                         |                    |  EN   <--- GP4  [R6 10k a 3V3] |
  |  GP0 (UART0 TX) --[R7 1k]------------------->|  PDN_UART                      |
  |  GP1 (UART0 RX) ----------------------------+|  (mismo pin, half-duplex)      |
  |                         |                    |                                |
  |  GP2 (PIO0 SM0) --------------------------->|  STEP                          |
  |  GP3 -------------------------------------->|  DIR                           |
  |  GP5 <---------------------------------------|  DIAG  [R8 10k a GND]          |
  |                         |                    |                                |
  |  GP4 --> EN (ver R6)    |                    |  MS1 --- GND   } direccion     |
  |                         |                    |  MS2 --- GND   } UART = 0      |
  +-------------------------+                    |                                |
                                                 |  VREF (potenciometro)          |
   R6 = 10k de EN a 3V3 (¡PULL-UP!)              |   -> IGNORADO: ponemos         |
   EN del TMC2209 es ACTIVO A NIVEL BAJO.        |      GCONF.I_scale_analog = 0  |
   Con pull-UP, un GPIO flotante (reset,         |                                |
   arranque, MCU muerto) deja el driver          |  OA1 OA2 OB1 OB2               |
   DESHABILITADO. Ver corrección C-3.            +---+---+---+---+----------------+
                                                     |   |   |   |
                                                     |   |   |   |   par trenzado
                                                     v   v   v   v   por fase
                                                 +---------------------+
                                                 | NEMA 11 11HS12-0674S|
                                                 | 1,8 grados, 0,67 A  |
                                                 | 5,6 ohm/fase        |
                                                 | ~3,5 mH/fase        |
                                                 | negro/verde = A     |
                                                 | rojo/azul   = B     |
                                                 +---------------------+
                                                 Montado sobre amortiguador
                                                 de goma-acero, dentro de la
                                                 columna de pino forrada de fieltro.
```

### 2.4 Bloque C — Eje radial: ULN2003 + 28BYJ-48

```
 ==========================================================================================
  BLOQUE C — CARRO RADIAL  (T8 de 8 mm de paso, +/-25 mm)
 ==========================================================================================

   RP2040-Zero                        ULN2003A (DIP-16, placa de fabrica)
   +-----------+                      +---------------------------------+
   | GP13 -----|--[R9  1k]----------->| IN1 (1)              OUT1 (16) |--> bobina 1 (azul)
   | GP14 -----|--[R10 1k]----------->| IN2 (2)              OUT2 (15) |--> bobina 2 (rosa)
   | GP15 -----|--[R11 1k]----------->| IN3 (3)              OUT3 (14) |--> bobina 3 (amarillo)
   | GP26 -----|--[R12 1k]----------->| IN4 (4)              OUT4 (13) |--> bobina 4 (naranja)
   +-----------+                      |                                 |
                                      | GND (8) --- GND estrella        |
                                      | COM (9) <-- VMOT                |--> comun (rojo)
                                      +---------------------------------+
                                        Los 5 LED de la placa: DESUELDA
                                        LOS CINCO o pintalos de negro mate.
                                        Son cinco luces en la mesilla.

   Las R de 1k son opcionales (el ULN2003 lleva 2,7k en base internamente) pero
   limitan el pico de conmutacion. El ULN2003 acepta 3,3 V en las entradas sin problema.

   CONDUCCION SILENCIOSA (esto no es opcional, ver seccion 9.4):
   El 28BYJ-48 en medio paso crudo hace un "tic" audible. En su lugar, usa cuatro
   slices PWM del RP2040 a 20 kHz sobre GP13/14/15/26 y modula la secuencia de 8
   fases con una tabla senoidal de 32 puntos: microstepping pobre pero suficiente.
   El "tic" desaparece. Coste: 0 EUR, 40 lineas.

   IHOLD = 0: entre desplazamientos las CUATRO entradas quedan a nivel BAJO.
   El husillo T8 es retro-conducible pero el carro es horizontal, asi que la
   gravedad no lo mueve y la friccion de la tuerca de laton lo retiene.
```

### 2.5 Bloque D — Térmica: calefactor de férula, calefactor de taza, NTC

```
 ==========================================================================================
  BLOQUE D — CADENA TÉRMICA
 ==========================================================================================

  D1) CALEFACTOR DE LA FÉRULA  (dentro de la brocha, 30 mm detrás de las puntas)
  ------------------------------------------------------------------------------

      VMOT (5 V)
         |
      +--+------------------------+
      |  FUSIBLE TÉRMICO 45 °C    |   <-- KSD9700 NC bimetalico 45 C, o Microtemp
      |  (en serie, en la ferula) |       de un solo uso de 55 C. Ver correccion C-6.
      +--+------------------------+
         |
      [R13]  120 ohm  METAL FILM  0,6 W   <<<<< EL LIMITADOR. NO LO CAMBIES.
         |   (0,208 W disipados = 35 % de su nominal)
         |
         D
        |-|   Q4 = AO3400A (o 2N7002)   N-MOSFET logico
         S
         |
        GND

      Puerta de Q4:  GP9 --[R14 100 ohm]-- G,  y  [R15 10k] de G a GND.
      R15 garantiza que un GPIO flotante deja el calefactor APAGADO.
      PWM a 2 Hz (lento a proposito: nada acustico, nada de EMI).


  D2) NTC DE LA FÉRULA
  ---------------------

      3V3
       |
     [R16 10k, 1 %]         Divisor. Cuatro hilos separados hasta la ferula
       |                    (2 calefactor + 2 NTC). NO compartas la masa del
       +--------> GP27      calefactor con la del NTC: 42 mA sobre 0,2 ohm de
       |          (ADC1)    hilo comun serian 8 mV = 10 cuentas = 0,3 C de
     [NTC 10k B=3950]       error CORRELADO con el duty. Retorno Kelvin.
       |
       +--[C7 100 nF]--GND
       |
      GND
                            Los cuatro hilos: 0,1 mm2 silicona, BUCLE COAXIAL
                            con el eje de la charnela de cabeceo (+2 mN de error
                            de fuerza, ya presupuestado en la especificacion).


  D3) CALEFACTOR DE LA TAZA DE REPOSO (en la BASE, a >300 mm de la piel)
  -----------------------------------------------------------------------

      VMOT --[R17 120 ohm metal film 0,6 W]-- D |Q5 AO3400A| S -- GND
      (47 ohm daba 0,53 W y un regimen permanente de 57,8 C con Q5 en corto:
       ver 06-seguridad.md 9.3. Con 120 ohm el techo es T_amb + 14,8 K y ya no
       depende del TPL5010 para ser seguro.)
      Puerta: GP8 --[100 ohm]-- G,  [10k] a GND.
      NTC 10k + 10k 1 % --> GP26?  NO: GP26 esta ocupado por el ULN2003.
      Se lee por MULTIPLEXADO: un 74HC4053 o, mas simple, se cablea el
      segundo NTC al mismo GP27 a traves de un 74HC4066 (NO conmutado por GP12,
      que ya esta ocupado por RAIL_SENSE: haria falta un pin libre).
      ALTERNATIVA MAS LIMPIA Y ADOPTADA: usa GP29 (pad trasero del
      RP2040-Zero, ADC3) para el NTC de la taza. Es la que implementa el firmware
      (ADC_NTC_CUP = 29 en config.h). Ver la tabla de pines.

      0,208 W / 42 mA.  Mantiene el aire de una taza forrada de fieltro a 35 C,
      con techo de hardware en T_amb + 14,8 K aunque Q5 se quede en corto.
```

### 2.6 Bloque E — Interfaz y microrruptor

```
 ==========================================================================================
  BLOQUE E — INTERFAZ Y SENSADO DE POSICIÓN
 ==========================================================================================

  E1) PULSADOR DE ARRANQUE (silicona, 16 mm o tactil de 100-160 gf con capuchon)
  -------------------------------------------------------------------------------

      3V3
       |
     [R18 10k]
       |
       +----------------------> GP7   (BTN_START, ademas del pull-up interno)
       |
       +--[C8 100 nF]--GND      antirrebote RC: tau = 1 ms
       |
      _|_  S2  pulsador NA (normalmente abierto)
      o o
       |
      GND

      Y EN PARALELO, la rama que rearma el latch en HARDWARE:

       nodo del pulsador --[C9 100 nF]--+--> CD4013 RESET (pin 4)
                                        |
                                      [R19 100k]
                                        |
                                       GND

      El diferenciador RC convierte una pulsacion MANTENIDA en UN SOLO pulso
      de ~10 ms. Asi, si te das la vuelta y te quedas dormido encima del
      boton, el latch NO queda permanentemente rearmado.
      El firmware ademas exige 300 ms de pulsacion sostenida + 500 ms de
      soltado antes de armar nada.


  E2) MICRORRUPTOR DE LEVA DEL PUNTO DE REPOSO
  ---------------------------------------------

      3V3
       |
     [R20 10k]
       |
       +----------------------> GP6   (SW_PARK)
       |
       +--[C10 100 nF]--GND
       |
      _|_  SW2  microrruptor de palanca, contacto  N A  (normalmente abierto)
      o o      COM a GND,  NA al nodo.
       |       CERRADO = EN REPOSO = nivel BAJO.
      GND      Cable roto o conector suelto = pull-up = ALTO = "no estoy en
               reposo" = la comprobacion de integridad dispara. Fallo SEGURO.
               (Ver 8.2: por eso NA y no NC.)


  E3) SENSADO DEL PARO DE EMERGENCIA (solo para la interfaz, NO es la seguridad)
  -------------------------------------------------------------------------------

      nodo VSW --[R21 10k]--+--> GP16?  NO.  --> ver tabla: GP12 lee VMOT.
                            |
                          [R22 10k]
                            |
                           GND
      El firmware lee VMOT/2 en GP12 y sabe si el rail del motor esta vivo.
      Distingue "S1 pulsado" de "latch disparado" comparando con el estado
      que el propio firmware ha ordenado.


  E4) LED ROJO
  -------------

      3V3 --[R23 10k]--|>|-- GP17 (drenaje) ... o mas simple:

      GP17 --[R23 10k]--|>|-- GND
                        LED rojo 3 mm DIFUSO

      I = (3,3 - 1,8) / 10000 = 150 uA.
      Ademas se conduce por PWM al 5-20 % de duty para afinar.
      NADA de WS2812 (0,6-1 mA en reposo y brillo de troquel visible).
      NADA de OLED. NADA de zumbador.
```

---

<a name="3"></a>
## 3. TABLA DE PINES COMPLETA — RP2040-Zero

Pines del borde castellado (GP0-GP15, GP26-GP29) más los pads traseros.

| GPIO | Nombre | Dir. | Periférico | Conecta a | Pull-up / pull-down | Notas críticas |
|---|---|---|---|---|---|---|
| **GP0** | `TMC_TX` | Sal | UART0 TX | PDN_UART del TMC2209 vía **R7 = 1 kΩ** | — | Half-duplex. Si tu módulo BTT V1.3 ya trae la R de 1 kΩ en placa, **no pongas otra** (mide con el polímetro entre el pad UART y PDN_UART: debe dar ~1 kΩ) |
| **GP1** | `TMC_RX` | Ent | UART0 RX | PDN_UART, directo (mismo nudo que GP0) | — | 115200 baudios, 8N1. Requiere `SLAVECONF.SENDDELAY = 2` |
| **GP2** | `STEP` | Sal | **PIO0 SM0** | STEP del TMC2209 | — | **Aquí vive el tope de 10 cm/s.** Ancho de pulso 10 µs, suelo de intervalo 240 µs |
| **GP3** | `DIR` | Sal | GPIO | DIR del TMC2209 | — | Cambiar **solo** con la máquina en reposo en la meseta plana, ≥20 µs antes del flanco de STEP |
| **GP4** | `nEN` | Sal | GPIO | EN del TMC2209 | **PULL-UP 10 kΩ a 3V3 (R6)** | **EN es ACTIVO A NIVEL BAJO.** El pull-UP deja el driver deshabilitado con el pin flotante. Ver corrección **C-3** |
| **GP5** | `DIAG` | Ent | GPIO / IRQ | DIAG del TMC2209 | **pull-down 10 kΩ (R8)** | StallGuard4 + sobretemperatura. Salida push-pull activa a nivel alto. Solo fiable por encima de ~3 cm/s (ver 6.6) |
| **GP6** | `SW_PARK` | Ent | GPIO / IRQ | Microrruptor de leva, contacto NA a GND | pull-up interno **+ R20 10 kΩ externa** | **BAJO = en reposo.** Cable roto → ALTO → dispara la integridad. Antirrebote RC 1 ms + 5 ms software |
| **GP7** | `BTN_START` | Ent | GPIO | Pulsador de silicona a GND | pull-up interno **+ R18 10 kΩ** | Además va por C9/R19 al RESET del CD4013. Firmware: 300 ms sostenidos + 500 ms de soltado |
| **GP8** | `HEAT_CUP` | Sal | PWM lento por software | Puerta de Q5 (calefactor de la taza 120 Ω) | **pull-down 10 kΩ** | PWM 2 Hz. Pull-down obligatorio: pin flotante = calefactor apagado |
| **GP9** | `HEAT_FER` | Sal | PWM lento por software | Puerta de Q4 (calefactor de férula 120 Ω) | **pull-down 10 kΩ (R15)** | **PWM de 2 Hz hecho por software** (periodo 500 ms, 100 escalones): el PWM hardware del RP2040 no baja de 7,45 Hz (clkdiv 255,94 × wrap 65536). El techo es de hardware igualmente (sección 5) |
| **GP10** | `MOTOR_KILL` | Sal | GPIO | SET del CD4013 vía diodo D4 | **pull-down 100 kΩ** | Pulso alto de 10 ms = el firmware mata su propio raíl al terminar el ciclo |
| **GP11** | `HEARTBEAT` | Sal | **GPIO conmutado dentro de la ISR de 8 kHz** | Charge pump (C4/D1/D2/R3/C5) | — | **Onda cuadrada de 2 kHz al 50 %. NO se genera con un slice de PWM hardware:** un slice sigue oscilando dentro de un `while(1)`, así que un latido de hardware **no cubre el caso "firmware colgado"**, que es exactamente para lo que existe la capa 3. Se conmuta a mano en la ISR **y sólo si el bucle principal ha refrescado su testigo de vida en los últimos 150 ms**. Si para, VMOT muere en <250 ms |
| **GP12** | `RAIL_SENSE` | Ent | **GPIO digital** | Divisor 10k/10k desde VMOT | — | **El RP2040 sólo tiene ADC en GP26-GP29: GP12 NO puede leer analógico.** Se lee como entrada **digital** (VMOT/2 = 2,50 V es un VIH válido de sobra). Cruzado con `VBUS_SENSE` (GP28, ADC de verdad) distingue "S1 pulsado" de "latch disparado" de "todo bien" |
| **GP13** | `ULN_IN1` | Sal | PWM | IN1 del ULN2003 vía 1 kΩ | — | Fase 1 del 28BYJ-48, PWM 20 kHz con tabla senoidal |
| **GP14** | `ULN_IN2` | Sal | PWM | IN2 | — | Fase 2 |
| **GP15** | `ULN_IN3` | Sal | PWM | IN3 | — | Fase 3 |
| **GP16** | *(WS2812 en placa)* | — | — | **NO USAR** | — | **ANÚLALO**: esmalte negro mate sobre el chip o levanta su pad de VDD. Consume 0,6-1 mA y brilla en la oscuridad |
| **GP17** | `LED_RED` | Sal | PWM | LED rojo 3 mm vía R23 10 kΩ | — | 150 µA a duty 100 %. Se usa al 5-20 % |
| **GP26** | `ULN_IN4` | Sal | PWM (ADC0) | IN4 | — | Uso **digital** de un pin ADC: perfectamente válido. Fase 4 |
| **GP27** | `NTC_FER` | Ent | **ADC1** | Divisor 10 kΩ 1 % / NTC 10 kΩ B=3950 | — | Retorno Kelvin, hilo de masa propio. C7 = 100 nF. Media de 64 muestras |
| **GP28** | `VBUS_SENSE` | Ent | **ADC2** | Divisor 10 kΩ / 10 kΩ desde VBUS | — | 5,00 V → 2,50 V → cuenta 3102. Umbral de aborto: **4,80 V = cuenta 2978** |
| **GP29** | `NTC_CUP` | Ent | **ADC3** (pad trasero) | Divisor 10 kΩ 1 % / NTC 10 kΩ de la taza | — | Pad en la cara posterior del RP2040-Zero; hay que soldarle un hilo. Evita el multiplexor analógico del bloque D3 |
| *(pin)* | `3V3` | — | Salida del LDO | VIO del TMC2209, pull-ups, divisores NTC | — | ~100 mA disponibles; usamos <10 mA |
| *(pin)* | `5V` | — | Entrada | Nodo VBUS | — | **Antes** del pulsador de paro: el MCU sigue vivo con el motor cortado |
| *(pin)* | `GND` | — | — | Punto de estrella junto a C2 | — | Un solo punto de estrella. No hagas bucles de masa con la carcasa del motor |

**Pines del TMC2209 que se dejan sin conectar:** `INDEX` (no se usa), `SPREAD` (queda por GCONF),
`CLK` (oscilador interno de 12 MHz — dejar a masa o al aire según el módulo; en BTT V1.3 va a masa en placa).

**MS1 y MS2 a GND** → dirección UART 0. Con `GCONF.mstep_reg_select = 1`, MS1/MS2 **solo** fijan la dirección
y el microstepping lo manda el registro CHOPCONF.

> **VARIANTE ENDURECIDA (opcional, gratis).** Si quieres que los mm-por-pulso también sean de hardware —de modo
> que el tope del PIO sea un tope de **velocidad** y no solo de **frecuencia de pulsos**—, ata **MS1 = MS2 = 3V3**
> (microstepping 1/16 por pines, dirección UART = 3) y pon `GCONF.mstep_reg_select = 0`. Entonces el UART **no
> puede cambiar el microstepping**, y el suelo de 240 µs corresponde a un límite de velocidad fijo. Coste: nada.
> Pérdida: nada (la interpolación MicroPlyer a 1/256 sigue activa, así que la resolución real de 2,58 µm/µpaso
> es idéntica). Recalcula el suelo del PIO: a 1/16, el intervalo mínimo pasa a **480 µs**. Ver corrección **C-2**.

---

<a name="4"></a>
## 4. LA CADENA DE SEGURIDAD HARDWARE

### 4.1 El principio: sujetar la brocha contra la piel EXIGE trabajo activo

Toda esta sección descansa sobre una única propiedad mecánica:

```
   Sesgo permanente del contrapeso ................ 247 mN·m  hacia el reposo
   Resistencia en el peor caso:
       detente del motor reflejado (8 × 14,29) .... 114 mN·m
       max(arrastre en la piel 48, trepada 66) .....  66 mN·m
                                                   -----------
                                                     180 mN·m
   Margen ......................................... 1,37×
```

**Cortar el cobre = la brocha se va.** No hay que hacer nada, no hay que decidir nada, no hay código.
Por tanto toda la electrónica de seguridad tiene un único trabajo: **cortar el cobre**, por tantos caminos
independientes como sea razonable.

### 4.2 El dibujo de la cadena

```
 ============================================================================================
   CADENA DE SEGURIDAD — CINCO ELEMENTOS EN SERIE ELÉCTRICA SOBRE EL MISMO RAÍL
   Cualquiera de ellos que se abra, mata VMOT y suelta el contrapeso.
 ============================================================================================

  [ 5 V del cargador ]
         |
         |  (1) DESENCHUFAR EL USB
         |      Corta todo. Latencia: instantánea (C1+C2 = 570 µF se vacían con
         |      la carga del motor en unos 15 ms; con IHOLD = 0 aún antes).
         |
         v
  [ F1  polifusible 2 A ]
         |
         |  (2) S1  PARO DE EMERGENCIA — PULSADOR NC ENCLAVABLE
         |  ############################################################
         |  #                                                          #
         |  #   VBUS  o------\ \------o  VSW                           #
         |  #                 \                                        #
         |  #   Seta roja de 16 mm. Contacto NORMALMENTE CERRADO.      #
         |  #   Push-to-break / twist-to-release: se QUEDA abierto.    #
         |  #   Va atornillado al frente de la columna, al alcance     #
         |  #   de la mano desde la cama.                              #
         |  #                                                          #
         |  #   >>> ESTA EN SERIE CON EL COBRE. NO ES UNA ENTRADA <<<  #
         |  #   >>> DE GPIO. NO PASA POR EL FIRMWARE. FUNCIONA    <<<  #
         |  #   >>> CON EL MCU MUERTO, COLGADO O DESOLDADO.       <<<  #
         |  ############################################################
         |      Latencia: el tiempo del contacto (~1 ms) + descarga de C2.
         |
         v
  [ Q1  P-MOSFET AO3401A ]  <-- necesita QUE ALGUIEN TIRE DE SU PUERTA A MASA
         |                       R1 (100k) lo mantiene CORTADO por defecto.
         |
         |      Q1 conduce SOLO SI  Q2 conduce, y Q2 conduce SOLO SI:
         |
         |  (3) EL LATIDO ESTÁ VIVO
         |      GP11 emite 2 kHz conmutado en la ISR (NO por PWM hardware:
         |      un slice de PWM sobrevive a un firmware colgado) -> charge
         |      pump -> 6 V en HB.
         |      Firmware colgado / pin atascado alto / pin atascado bajo /
         |      MCU en reset / MCU muerto -> sin bombeo -> HB cae -> Q2 corta.
         |      Latencia: < 250 ms  (3 x tau, tau = 470k x 100 nF = 47 ms)
         |
         |      >>> ESTE ES EL UNICO ELEMENTO QUE CUBRE "FIRMWARE COLGADO   <<<
         |      >>> CON LAS BOBINAS ENERGIZADAS". Sin el, unas bobinas a    <<<
         |      >>> IRUN 0,33 A dan ~500 mN.m reflejados, DOS VECES el      <<<
         |      >>> sesgo del contrapeso: la brocha NO se va. Ver C-5.      <<<
         |
         |  (4) EL LATCH NO ESTÁ DISPARADO   (CD4013,  Q = 0)
         |      Q3 pone HB a masa en cuanto Q = 1. Se dispara por:
         |
         |         (4a)  TPL5010 WAKE  a los 1020 s =  17 min 00 s
         |               ONE-SHOT DE HARDWARE. Independiente del MCU,
         |               del reloj del MCU y del firmware. 35 nA.
         |
         |         (4b)  GP10 MOTOR_KILL  — el firmware mata su propio raíl
         |               al terminar el ciclo de 900 s. Esta es la salida
         |               NORMAL: el latch se dispara siempre, todas las noches.
         |
         |         (4c)  Comparador de brownout  < 4,60 V en VBUS.
         |
         |         (4d)  POR: al enchufar el USB, C6 pulsa SET.
         |               ENCHUFAR NUNCA ENERGIZA EL MOTOR.
         |
         |      El latch se rearma SOLO con el pulso RC del boton de arranque.
         |
         v
  [ VMOT ]  ---> TMC2209 VM,  ULN2003 COM,  calefactores,  TPL5010 VDD
         |
         |  (5) EL PROPIO DRIVER, cuando el rail cae por debajo de 4,75 V:
         |      undervoltage lockout del TMC2209 -> puentes en alta impedancia.
         |
         v
  [ BOBINAS DEL NEMA 11 ]  --- ABIERTAS ---> par de retencion = solo detente (8 mN.m)
         |
         v
  ############################################################################
  #  CONTRAPESO DE 360 g SOBRE TAMBOR DE 70 mm  =  247 mN.m                  #
  #  contra  180 mN.m  de resistencia en el peor caso.   MARGEN 1,37x        #
  #  La botavara camina a la taza de reposo, sobre la propia base de la      #
  #  maquina, a 400 mm del cuerpo, frenada por el amortiguador neumatico     #
  #  a 80-120 mm/s de velocidad de punta. Tarda 2-3 s. Suena a un ultimo     #
  #  golpe lento que termina en el aire.                                     #
  ############################################################################
```

### 4.3 Por qué el temporizador de 15 minutos tiene DOS capas

Este es el punto donde más gente se equivoca, así que voy a ser explícito.

| | **CAPA 1 — FIRMWARE** | **CAPA 2 — HARDWARE** |
|---|---|---|
| Quién lo cuenta | RP2040, `time_us_64()`, reloj de cristal | TPL5010, oscilador RC propio, 35 nA |
| Plazo | **900 s = 15 min 00 s** (+ 60 s de pre-warm previos) | **1 020 s = 17 min 00 s** desde el pulsador |
| Precisión | ±0,01 % (cristal) | ±5 a ±10 % (RC interno) |
| Cómo termina | **Elegante**: no programa más golpes, ejecuta un último golpe firme, retira la brocha en 2-3 s hasta la taza, apaga los calefactores, dos parpadeos lentos, y **entonces** pulsa GP10 para matar su propio raíl | **Brusco**: WAKE dispara el latch, VMOT muere, el contrapeso camina la brocha fuera de la piel |
| Modos de fallo que lo tumban | Bucle colgado, desbordamiento de pila, `time_us_64()` corrupto, un `while` sin salida, un fallo de flash | Sólo un fallo del propio TPL5010 o del latch |
| **Independencia** | Comparte reloj, alimentación de 3,3 V y código con todo lo demás | **Reloj propio, consumo propio, no ejecuta código.** Alimentado del raíl conmutado, así que su ventana empieza cuando empieza la sesión |

**El argumento en una frase:** *la capa 1 y la capa 2 no pueden fallar por la misma causa.*

Todo lo que mata el temporizador de firmware —un bucle infinito, un puntero desbocado, una pila desbordada, un
reloj corrupto— **no toca al TPL5010**, porque el TPL5010 no ejecuta código y no comparte reloj. Y al revés: si
el TPL5010 se degrada y su RC deriva un 30 %, el firmware ya habrá terminado el ciclo 60 s antes y el TPL5010
nunca llega a disparar.

**Los 60 s de margen son deliberados y son un diagnóstico.** En funcionamiento normal el TPL5010 **nunca**
dispara: el firmware siempre termina primero. Por tanto:

> **Si alguna vez notas que la sesión ha terminado con un tirón brusco en vez de con el golpe final suave,
> el TPL5010 ha disparado, y eso significa que el firmware se ha colgado. Es un síntoma, no una anécdota.
> No lo ignores.**

Y una tercera capa dentro del propio chip, gratis: el **watchdog hardware del RP2040 a 2 s**, alimentado en el
bucle principal. Cubre el caso intermedio: un bucle bloqueado que dura más de 2 s pero menos de los 250 ms del
charge pump... perdón, al revés: **el charge pump (250 ms) es más rápido que el watchdog del RP2040 (2 s)**, así
que el charge pump es el que actúa primero y el watchdog del RP2040 es el que **recupera** el aparato después
(reinicia, rehace el homing, y deja el motor apagado esperando una nueva pulsación).

### 4.4 Tabla de cobertura: qué mata qué, y en cuánto tiempo

| Escenario | Elemento que actúa | Latencia hasta cortar VMOT | La brocha sale de la piel en |
|---|---|---|---|
| Fin normal del ciclo (900 s) | Firmware → GP10 → latch | 0 (planificado) | 2-3 s, retirada suave programada |
| El usuario pulsa el paro | **S1, contacto en el cobre** | ~1 ms | 2-3 s |
| Tirón del cable USB | Corte de alimentación | ~15 ms (descarga de C1+C2) | 2-3 s |
| Brownout (cargador flojo, cable malo) | Comparador → latch, + UVLO del TMC2209 | <5 ms | 2-3 s |
| **Firmware colgado con bobinas energizadas** | **Charge pump de latido** | **<250 ms** | 2-3 s |
| Firmware colgado con el latido atascado en alto | Charge pump (¡no hay onda!) | <250 ms | 2-3 s |
| Reset espurio del MCU | Charge pump (se detiene el PWM) + pull-up de EN | <250 ms | 2-3 s |
| Firmware perdió la cuenta del tiempo y sigue | **TPL5010 a los 1 020 s** | 60 s tras el plazo (pre-warm 60 + ciclo 900 = 960) | 2-3 s |
| Microrruptor de reposo no cierra en el plazo | Firmware: para, desenergiza, 1 reintento, fin | <1 golpe | 2-3 s |
| Duvet dentro de la ranura del yugo | StallGuard4 (>3 cm/s) + fallo de integridad | 1 golpe | 2-3 s |
| Alguien tropieza y tira la máquina | Nada eléctrico. La máquina pesa 2,0 kg y está a 400 mm | — | El brazo de GRP se dobla 20 mm a 1,4 N |
| **El propio latch CD4013 falla en cerrado** | S1 sigue en serie en el cobre, aguas arriba | manual | — |
| **S1 falla en cerrado (contacto soldado)** | Latch, charge pump y TPL5010 están aguas abajo | según el caso | 2-3 s |

**Ningún elemento de la cadena es un punto único de fallo.** S1 está aguas arriba de Q1; Q1 depende de dos
condiciones independientes (latido y latch); y el TPL5010 no depende de ninguno de los dos.

---

<a name="5"></a>
## 5. EL CALEFACTOR DE LA FÉRULA — DEMOSTRACIÓN DE SEGURIDAD INTRÍNSECA

### 5.1 El circuito

```
   VMOT (5,00 V)
      |
   [ FUSIBLE TÉRMICO 45 °C ]  KSD9700 NC bimetálico, cuerpo pegado a la férula
      |
   [ R13 = 120 Ω, metal film, 0,6 W ]   <<<  EL LIMITADOR
      |
      D
     |-|  Q4  AO3400A  (N-MOSFET lógico, Rds_on 30 mΩ)
      S
      |
     GND

   Puerta:  GP9 --[100 Ω]-- G ,  [10 kΩ] de G a GND
   Control: PWM a 2 Hz, lazo PI sobre el NTC, consigna 33,0 °C
   Lectura del NTC: 20 ms dentro de la ventana OFF del PWM
```

### 5.2 La demostración: un MOSFET en cortocircuito NO puede superar el techo

Peor caso absoluto: **Q4 falla en cortocircuito drenaje-fuente** (o el firmware deja GP9 a nivel alto para
siempre, o el NTC se desconecta y el lazo pide el 100 %, o las tres cosas a la vez). El calefactor queda
conectado al 100 % de forma permanente, sin ninguna posibilidad de que el software intervenga.

```
   PASO 1 — LA POTENCIA MÁXIMA FÍSICAMENTE POSIBLE

       P_max = V² / R  =  (5,00 V)² / 120 Ω  =  25 / 120  =  0,2083 W

   No hay ninguna vía por la que entre más potencia. El MOSFET es un
   INTERRUPTOR EN SERIE: solo puede reducir el duty, nunca aumentar la
   corriente. La resistencia de 120 Ω es el limitador, y una resistencia
   de película metálica FALLA EN CIRCUITO ABIERTO, no en cortocircuito.

   PASO 2 — LA RESISTENCIA TÉRMICA DE LA FÉRULA AL AIRE

       R_th ≈ 85 K/W   (férula de silicona + haz de pelo, ~10 cm² de
                        superficie, convección natural h ≈ 8 W/m²K más
                        radiación ≈ 5 W/m²K  ->  h_tot ≈ 13 W/m²K
                        ->  R_th = 1/(13 × 1e-3) = 77 K/W;
                        85 K/W es el valor conservador)

   PASO 3 — EL INCREMENTO MÁXIMO DE TEMPERATURA

       ΔT_max = P_max × R_th = 0,2083 W × 85 K/W = 17,7 K

   PASO 4 — LA TEMPERATURA MÁXIMA ABSOLUTA DE LA FÉRULA

       T_max = T_ambiente + 17,7 K

           ambiente 18 °C  ->  35,7 °C
           ambiente 20 °C  ->  37,7 °C   <-- el "~38 °C" de la especificación
           ambiente 22 °C  ->  39,7 °C
           ambiente 24 °C  ->  41,7 °C
           ambiente 26 °C  ->  43,7 °C   <-- POR ENCIMA del umbral ISO 13732-1
```

### 5.3 La corrección que la especificación necesita: el techo depende del ambiente

**Aquí hay un problema real y lo digo claramente.** La especificación afirma un *"HARDWARE ceiling ~38 °C set by
the resistor value"* como si fuera un absoluto. **No lo es: es T_ambiente + 17,7 K.** Los 38 °C sólo salen si la
habitación está a 20 °C. En un dormitorio español en julio, a 26 °C, el techo de hardware sube a 43,7 °C, que
está justo por encima del umbral de quemadura por contacto prolongado de la ISO 13732-1 (43 °C para cualquier
material a partir de ~8 h de contacto).

**Corrección impuesta (C-7), en tres partes, y todas son gratis:**

1. **El firmware desactiva el calefactor de férula si el NTC de ambiente lee > 24 °C al arrancar.** Techo
   garantizado ≤ 41,7 °C en todos los casos permitidos. Y es que **por encima de 24 °C el calefactor no hace
   falta**: la piel está a 32-34 °C y la brocha ya llega casi neutra.
2. **El fusible térmico va PEGADO A LA FÉRULA, no al cable.** Es lo que convierte el argumento en real: cubre el
   caso en que R_th se degrada (brocha metida bajo el edredón, férula envuelta en tela).
   Cálculo del punto de disparo: `R_th_disparo = (45 − 20) / 0,2083 = 120 K/W`. Es decir, la resistencia térmica
   tendría que empeorar un **41 %** respecto a los 85 K/W nominales antes de que el fusible actúe. Ese es
   exactamente el escenario "la brocha se ha quedado tapada".
3. **Y no hay nada metálico ni conductor tocando la piel de todos modos.** El elemento está 30 mm por detrás de
   las puntas, dentro de una férula de silicona, con un haz de pelo de cabra entre medias. La piel ve las
   **puntas**, que están a T_ambiente + 5 a 8 K (25-28 °C en una habitación a 20 °C), no la férula. La férula
   sólo llegaría a tocar piel si la brocha se comprimiera 30 mm, y la compresión a 400 mN es de **6,9 mm**.

### 5.4 Los otros modos de fallo, uno a uno

| Fallo | ¿Qué pasa? | ¿Peligroso? |
|---|---|---|
| Q4 en cortocircuito D-S | 0,2083 W permanentes → T_amb + 17,7 K | **No.** Es el caso demostrado arriba |
| GP9 atascado en alto | Idéntico al anterior | **No** |
| NTC desconectado (circuito abierto) | El divisor lee 3,3 V = "muy frío" → el lazo pide 100 % | **No.** Mismo techo. Además el firmware detecta la lectura fuera de rango (<5 °C o >60 °C) y apaga |
| NTC en cortocircuito | Lee 0 V = "muy caliente" → el lazo apaga | **No**, falla al lado seguro |
| R13 en circuito abierto (fallo típico del metal film) | Sin calefacción | **No**, sólo se pierde la función |
| Cargador defectuoso a 5,5 V | P = 30,25/120 = 0,252 W → ΔT = 21,4 K → 41,4 °C a 20 °C amb. | **No** |
| Cargador defectuoso a 6,0 V | P = 0,300 W → ΔT = 25,5 K → 45,5 °C | **El fusible térmico de 45 °C dispara.** Éste es su trabajo principal |
| Férula tapada bajo el edredón | R_th sube de 85 a >120 K/W | **El fusible térmico dispara** |
| Cortocircuito de los hilos del calefactor en la charnela | El polifusible F1 (2 A) o el propio cargador limitan | **No.** 5 V no arcea |
| Se rompe un hilo del NTC durante el ciclo | Lectura fuera de rango → apagar, seguir la sesión sin calor, un parpadeo al final | **No** |

### 5.5 Por qué esto es "intrínsecamente seguro" y no sólo "seguro"

La distinción es técnica y merece nombrarse. Un sistema es **intrínsecamente seguro** cuando la seguridad no
depende de que un componente funcione, sino de que la **física del circuito** no permita el estado peligroso.

- Un control térmico convencional es *funcionalmente* seguro: hay un elemento potente, un sensor y un lazo, y la
  seguridad depende de que el lazo funcione. Si el FET se queda pegado, el elemento sigue metiendo su potencia
  nominal —que puede ser 20 W— y el resultado es una quemadura.
- Aquí el elemento está **deliberadamente infradimensionado hasta el punto en que su potencia máxima no puede
  producir el daño**. 120 Ω a 5 V son 0,208 W. Con esos 0,208 W, la férula no puede pasar de T_amb + 17,7 K
  **aunque todo lo demás del sistema esté roto**. El lazo NTC no está ahí para proteger; está ahí para **regular
  a 33 °C**, que es una función de confort. Si el lazo desaparece por completo, el sistema sigue siendo seguro,
  sólo deja de ser preciso.

Es el mismo argumento que hace segura toda la máquina: la fuerza normal es un lastre de latón de 40 g sobre un
eje sin actuador. No hay ningún camino por el que el software pueda apretar más.

### 5.6 Calibración del NTC — tabla de cuentas del ADC

NTC 10 kΩ a 25 °C, B = 3950 K, en serie con 10 kΩ al 1 % desde 3,3 V, ADC de 12 bits.

| T (°C) | R_NTC (Ω) | V en GP27 (V) | Cuenta ADC (0-4095) | Papel |
|---|---|---|---|---|
| 15 | 15 700 | 2,020 | 2506 | |
| 18 | 13 800 | 1,916 | 2378 | |
| **20** | 12 535 | 1,835 | **2277** | Ambiente de referencia |
| 22 | 11 430 | 1,764 | 2189 | |
| **24** | 10 457 | 1,687 | **2093** | **Umbral: por encima, calefactor OFF (C-7)** |
| 28 | 8 655 | 1,530 | 1899 | |
| 30 | 7 895 | 1,455 | 1806 | |
| **33** | 7 075 | 1,367 | **1696** | **CONSIGNA** |
| 36 | 6 245 | 1,270 | 1576 | |
| **38** | 5 750 | 1,205 | **1495** | **Corte por firmware** |
| 45 | 4 320 | 0,995 | 1235 | Punto del fusible térmico |

**Sensibilidad alrededor de la consigna: ~36 cuentas por °C.** El ruido del ADC del RP2040 es de ±5 LSB en
bruto, que promediando 64 muestras baja a ±0,6 LSB → **±0,02 °C**. De sobra.

**Autocalentamiento del NTC:** 3,3 V sobre 17,1 kΩ = 193 µA; disipación en el NTC = 193 µA² × 7075 Ω = 0,26 mW.
Con una constante de disipación típica de 2 mW/K, el error por autocalentamiento es **+0,13 K**. Despreciable,
pero anótalo si algún día quieres los 33,0 °C exactos.

---

<a name="6"></a>
## 6. CONFIGURACIÓN DEL TMC2209 POR UART

### 6.1 Enlace físico

- **Half-duplex de un solo hilo**: GP0 (TX) → 1 kΩ → PDN_UART; GP1 (RX) directo al mismo nudo.
- **115200 baudios, 8N1.** Es lo que usa TMCStepper por defecto y es estable con el oscilador interno del TMC2209.
- **`SLAVECONF.SENDDELAY = 2`** (registro 0x03, valor `0x00000200`) es **obligatorio**: da 8 tiempos de bit de
  guarda antes de que el driver conteste, para que el maestro tenga tiempo de soltar la línea.
- **Dirección 0** con MS1 = MS2 = GND.
- **R_SENSE = 0,11 Ω** en módulos BIGTREETECH V1.2/V1.3 y en el SilentStepStick de Watterott.
  **Comprueba el tuyo con el polímetro antes de calcular nada** — hay clones con 0,15 Ω, y eso desplaza la
  corriente real un 36 %.

### 6.2 Cálculo de IRUN

Fórmula del datasheet, con `vsense = 1` (V_fs = 0,180 V):

```
   I_rms = (CS + 1)/32 × V_fs/(R_sense + 0,02) × 1/raiz(2)
         = (CS + 1)/32 × 0,180/(0,11 + 0,02) × 0,7071
         = (CS + 1)/32 × 1,3846 × 0,7071
         = (CS + 1)/32 × 0,9791

   Objetivo 0,330 A rms:   (CS+1)/32 = 0,3370  ->  CS + 1 = 10,79  ->  CS = 10

   CS = 10  ->  I_rms = 11/32 × 0,9791 = 0,3366 A     (+2,0 % sobre 0,330)
   CS =  9  ->  I_rms = 10/32 × 0,9791 = 0,3060 A     (-7,3 %)

   ELEGIDO: IRUN = 10.
   Contingencia de la especificación (0,40 A si se pierden pasos):
   CS = 12  ->  13/32 × 0,9791 = 0,3978 A.   IRUN = 12.
```

### 6.3 Tabla completa de registros

| Reg | Dir | Valor | Campos | Por qué |
|---|---|---|---|---|
| `GCONF` | 0x00 | **0x000001C0** | `I_scale_analog=0`, `internal_Rsense=0`, `en_spreadCycle=0`, `shaft=0`, `index_otpw=0`, `index_step=0`, **`pdn_disable=1`**, **`mstep_reg_select=1`**, `multistep_filt=1` | `I_scale_analog=0` **ignora el potenciómetro VREF** de la placa: la corriente la fija el UART y sólo el UART. `pdn_disable=1` es obligatorio para hablar por UART. `en_spreadCycle=0` = StealthChop |
| `SLAVECONF` | 0x03 | **0x00000200** | `SENDDELAY=2` | Guarda de 8 bits antes de responder |
| `IHOLD_IRUN` | 0x10 | **0x000F0A00** | `IHOLD=0`, `IRUN=10`, `IHOLDDELAY=15` | IRUN = 0,337 A rms. `IHOLDDELAY=15` ≈ **330 ms de rampa** al bajar a IHOLD: la investigación es explícita en que **hay que bajar la corriente en rampa, no cortarla**, porque un corte seco es un impulso audible |
| `TPOWERDOWN` | 0x11 | **0x00000014** | 20 | 20 × 2¹⁸ / 12 MHz ≈ **0,44 s** de espera antes de empezar la rampa a IHOLD |
| `TPWMTHRS` | 0x13 | **0x000FFFFF** | máximo de 20 bits | **StealthChop2 PERMANENTE.** Con el umbral al máximo, el driver nunca entrega el control a SpreadCycle a ninguna velocidad. Es el registro que garantiza el silencio |
| `TCOOLTHRS` | 0x14 | **0x000007D0** | 2000 | Habilita StallGuard4 sólo cuando TSTEP ≤ 2000, es decir por encima de ~2,4 cm/s (ver 6.6) |
| `SGTHRS` | 0x40 | **0x00000028** | 40 | Umbral de StallGuard4. **Valor de partida; hay que ajustarlo empíricamente** con el brazo cargado |
| `CHOPCONF` | 0x6C | **0x13030044** | `TOFF=4`, `HSTRT=4`, `HEND=0`, **`TBL=2`**, **`vsense=1`**, **`MRES=3` (1/32)**, **`intpol=1`** | `TBL=2` (24 ciclos de blanking) es el ajuste silencioso recomendado. `vsense=1` para poder alcanzar 0,33 A con R_sense de 0,11 Ω sin desperdiciar resolución. `MRES=3` = 1/32. **`intpol=1` = MicroPlyer interpola a 1/256** internamente: 2,58 µm por micropaso real |
| `PWMCONF` | 0x70 | **0xC11D0024** | `PWM_LIM=12`, `PWM_REG=1`, **`freewheel=01`**, **`pwm_autograd=1`**, **`pwm_autoscale=1`**, **`pwm_freq=1`**, `PWM_GRAD`, `PWM_OFS` | Ver 6.4 y 6.5. `pwm_freq=1` = **35,1 kHz** de chopper. `freewheel=01` es la clave del fallo seguro (ver 6.4) |
| `VACTUAL` | 0x22 | **0x00000000** | 0 | Movimiento por STEP/DIR, no por el generador de rampa interno |

**Valor por defecto de PWMCONF al encender: `0xC10D0024`.** Lo único que cambiamos es `freewheel` de `00` a `01`
(bits 21:20), que es `+0x00100000` → **`0xC11D0024`**.
Si tienes perro o gato en casa, pon `pwm_freq = 2` (**46,9 kHz**, por encima de los ~45 kHz de un perro) →
**`0xC11E0024`**. Cuesta un punto porcentual de rendimiento y compra tranquilidad animal.

### 6.4 `freewheel = 01`: el registro que hace posible el contrapeso

**Esto es importante y la especificación no lo dice.** En el TMC2209, **`IHOLD = 0` NO significa corriente cero**:
`CS = 0` es simplemente el escalón más bajo de la escala, y sigue habiendo ~30 mA rms por fase. Con las bobinas
alimentadas —aunque sea poco— y sobre todo con los puentes en baja impedancia, hay **frenado por corrientes
inducidas** que se opone al contrapeso.

El campo `freewheel` (PWMCONF bits 21:20) se activa **exclusivamente cuando `IHOLD = 0`** y decide qué hacen los
puentes en parada:

| freewheel | Comportamiento | ¿Sirve aquí? |
|---|---|---|
| `00` | Normal: se mantiene IHOLD | ✘ No es corriente cero |
| **`01`** | **Rueda libre: las cuatro salidas en alta impedancia** | ✔ **ESTE.** Bobinas abiertas, corriente cero real, cero par de frenado, motor plenamente retro-conducible |
| `10` | Bobinas cortocircuitadas por los MOSFET de abajo | ✘ **PROHIBIDO**: cortocircuitar las bobinas frena por corrientes de Foucault y **se opone a la retirada del contrapeso** |
| `11` | Bobinas cortocircuitadas por los de arriba | ✘ **PROHIBIDO**, mismo motivo |

> **`PWMCONF.freewheel = 01` no es una optimización de consumo. Es parte de la cadena de seguridad.**
> Con `10` u `11` el motor se convierte en un freno magnético que pelea contra los 247 mN·m del contrapeso.
> **Compruébalo en el banco** (prueba 11.6): con VMOT vivo, IHOLD = 0 y freewheel = 01, el sector debe girar
> con el dedo con la misma facilidad que con el driver desenchufado. Si notas resistencia, tienes mal ese campo.

### 6.5 StealthChop2: el procedimiento de autotune, CORREGIDO

**Primero, el problema.** La especificación pide *"movimiento oculto de 1,2 s a 400 pasos/s con la botavara en la
cuna"*. Hay una contradicción dura entre esa frase y el resto del contrato:

- Si "400 pasos/s" son **400 pasos completos/s**, la punta va a **26,4 cm/s**. Eso es 2,6 veces el clamp
  absoluto de 10 cm/s, barre 60,5° de sector (casi todo el arco de trabajo) y, sobre todo, **el suelo del PIO no
  lo permite**. La misma especificación que exige el clamp exige un movimiento que el clamp prohíbe.
- Si son **400 pulsos STEP/s a 1/32**, son 12,5 pasos completos/s = 8,2 mm/s de punta. Seguro, sí, pero
  **completamente inútil para el AT#2**, que necesita velocidad para caracterizar la constante de la bobina.

**El procedimiento correcto, y por qué es además más seguro.** El datasheet distingue dos etapas:

- **AT#1** (mide la resistencia de bobina → `PWM_OFS`): **se hace EN PARADA**, sólo hay que habilitar el driver
  con la corriente aplicada y esperar ≥130 ms. **No necesita movimiento.** Se puede hacer en cada arranque.
- **AT#2** (mide la constante de fuerza contraelectromotriz → `PWM_GRAD`): necesita movimiento continuo a
  velocidad media (el datasheet sugiere 60-300 rpm) durante al menos **400 pasos completos**.

Puesto que AT#2 es incompatible con una máquina que nunca supera 10 cm/s, se hace **una sola vez, en el banco,
con el motor desacoplado**, y se congela el resultado:

```
 ==========================================================================================
   PROCEDIMIENTO A — PUESTA EN MARCHA (UNA SOLA VEZ, EN EL BANCO)
   Firmware de calibración separado. El motor NO está montado en la máquina,
   o está montado pero con el tendón de Dyneema DESENGANCHADO del cabrestante.
 ==========================================================================================

   1. Motor sobre la mesa, eje libre, nada acoplado.
   2. Flashea el binario "pluma-r-calib.uf2" (el suelo del PIO está en 40 µs
      en esta compilación; es un binario distinto y NO es el que duerme contigo).
   3. Escribe todos los registros de la tabla 6.3, con pwm_autoscale=1 y pwm_autograd=1.
   4. Habilita el driver (EN bajo) y espera 300 ms en parada.        <-- AT#1
   5. Mueve el motor 3,0 s a 400 pasos completos/s = 120 rpm.        <-- AT#2
      Son 1200 pasos completos, tres veces el mínimo de 400.
   6. Lee el registro PWM_AUTO (0x72):
          PWM_OFS_AUTO  = bits  7:0
          PWM_GRAD_AUTO = bits 23:16
   7. Anota los dos números. Escríbelos en la constante del firmware definitivo
      Y guárdalos también en el sector de flash reservado.
   8. Reflashea "pluma-r.uf2" (el binario real, suelo del PIO = 240 µs).

   REPITE ESTE PROCEDIMIENTO si cambias de motor, de driver o de cargador.


 ==========================================================================================
   PROCEDIMIENTO B — CADA ARRANQUE (dentro del firmware real)
 ==========================================================================================

   1. Escribe la tabla 6.3 completa.
   2. Lee IOIN (0x06); VERSION (bits 31:24) DEBE ser 0x21.  Si no, PARA y parpadea.
   3. Lee y limpia GSTAT (0x01). Se espera reset=1; si drv_err o uv_cp están
      puestos, registra el motivo.
   4. Escribe PWM_OFS y PWM_GRAD desde flash en PWMCONF.
   5. Pon  pwm_autoscale = 1  y  **pwm_autograd = 0**.
      -> autoscale sigue ajustando la AMPLITUD en tiempo real (bueno);
      -> autograd queda CONGELADO, para que el driver no intente re-medir
         el gradiente a velocidades de reptil y lo estropee.
   6. Habilita EN (bajo), espera 300 ms en parada.                  <-- AT#1 se rehace
   7. Homing contra el microrruptor (sección 8).
   8. Lee PWM_SCALE (0x71): PWM_SCALE_SUM debe estar en 10-200. Si está
      pegado a 0 o a 255, la regulación no está convergiendo -> parpadea y para.
```

**Beneficio colateral, y no es menor:** el procedimiento corregido **elimina un latigazo de 26 cm/s del arranque
de cada noche**. Un brazo de 300 mm cruzando 60° a 26 cm/s a las 23:30 no es "un movimiento oculto de 1,2 s"; es
la cosa más violenta que hace la máquina, y la hacía justo antes de tumbarse al lado de una persona. Quitarla es
una mejora de seguridad, no sólo de coherencia.

### 6.6 StallGuard4: qué es y qué no es

La especificación lo llama *"a free second trip"* y eso está bien dicho: es un **segundo** disparo, gratis,
**nunca el primero**.

```
   TSTEP en el TMC2209 = tiempo entre dos micropasos internos de 1/256, en ciclos de 12 MHz.

   A  2 cm/s:  30,3 pasos/s × 256 =  7 757 µpasos/s  ->  TSTEP = 1547
   A  3 cm/s:  45,5 pasos/s × 256 = 11 648 µpasos/s  ->  TSTEP = 1030
   A  7 cm/s: 106,1 pasos/s × 256 = 27 162 µpasos/s  ->  TSTEP =  442

   TCOOLTHRS = 2000  ->  StallGuard activo en toda la banda 2-7 cm/s.
```

**Pero la investigación es tajante:** StallGuard infiere la carga a partir de la fuerza contraelectromotriz, y a
muy baja velocidad el motor apenas genera. La literatura de fabricantes sitúa el suelo de fiabilidad en torno a
**10 rpm**. Nuestro motor gira a:

| Velocidad de punta | Pasos completos/s | **rpm del motor** | ¿StallGuard fiable? |
|---|---|---|---|
| 2,0 cm/s | 30,3 | **9,1 rpm** | **No.** Justo debajo del suelo |
| 3,0 cm/s | 45,5 | 13,6 rpm | Marginal |
| 5,0 cm/s | 75,8 | 22,7 rpm | Sí |
| 7,0 cm/s | 106,1 | 31,8 rpm | Sí |

**Conclusión honesta: StallGuard4 es útil por encima de ~3 cm/s y no sirve para nada a 2 cm/s.** Como el paseo
OU pasa una fracción apreciable del tiempo en la parte baja de la banda, **la detección primaria de bloqueo es
el microrruptor de reposo (sección 8), no StallGuard**. Actívalo, léelo, úsalo como confirmación, y **no montes
ninguna decisión de seguridad sobre él**.

### 6.7 Código de configuración (TMCStepper, Arduino/PlatformIO)

```cpp
#include <TMCStepper.h>

#define R_SENSE   0.11f       // ¡MÍDELO EN TU MÓDULO!
#define DRV_ADDR  0b00        // MS1 = MS2 = GND

TMC2209Stepper drv(&Serial1, R_SENSE, DRV_ADDR);

// Valores obtenidos en el PROCEDIMIENTO A y anotados aquí:
static const uint8_t PWM_OFS_CAL  = 0x24;   // <-- SUSTITUIR por el tuyo
static const uint8_t PWM_GRAD_CAL = 0x0E;   // <-- SUSTITUIR por el tuyo

bool configurar_tmc2209() {
  Serial1.begin(115200);
  drv.begin();

  // --- 1. Autenticidad y estado ---
  if (drv.version() != 0x21) return false;   // clon o UART muerto
  drv.GSTAT(0b111);                          // limpia flags de arranque

  // --- 2. Configuración global ---
  drv.I_scale_analog(false);   // IGNORA el potenciómetro VREF
  drv.internal_Rsense(false);
  drv.en_spreadCycle(false);   // StealthChop
  drv.pdn_disable(true);       // OBLIGATORIO para UART
  drv.mstep_reg_select(true);  // microstepping por registro
  drv.multistep_filt(true);
  drv.senddelay(2);

  // --- 3. Corriente ---
  drv.rms_current(330);        // -> CS = 10, 0,337 A rms
  drv.ihold(0);                // + freewheel = corriente CERO real
  drv.iholddelay(15);          // ~330 ms de rampa: sin "clac" al parar
  drv.TPOWERDOWN(20);          // 0,44 s antes de empezar la rampa

  // --- 4. Chopper ---
  drv.toff(4);
  drv.blank_time(24);          // TBL = 2
  drv.microsteps(32);          // MRES = 3
  drv.intpol(true);            // MicroPlyer -> 1/256 = 2,58 µm/µpaso

  // --- 5. StealthChop PERMANENTE ---
  drv.TPWMTHRS(0xFFFFF);       // nunca entrega el control a SpreadCycle
  drv.pwm_freq(1);             // 35,1 kHz  (usa 2 = 46,9 kHz si tienes perro)
  drv.pwm_autoscale(true);
  drv.pwm_autograd(false);     // CONGELADO: no re-medir a paso de tortuga
  drv.pwm_ofs(PWM_OFS_CAL);
  drv.pwm_grad(PWM_GRAD_CAL);
  drv.freewheel(1);            // 01 = RUEDA LIBRE. Parte del fallo seguro.

  // --- 6. StallGuard4 como SEGUNDO disparo ---
  drv.TCOOLTHRS(2000);
  drv.SGTHRS(40);              // ajustar empíricamente

  // --- 7. AT#1: 300 ms en parada con corriente ---
  digitalWrite(PIN_nEN, LOW);
  delay(300);

  // --- 8. Verificación de convergencia ---
  uint8_t escala = drv.pwm_scale_sum();
  return (escala > 10 && escala < 200);
}
```

---

<a name="7"></a>
## 7. ALIMENTACIÓN

### 7.1 Presupuesto de corriente a 5 V

| Carga | Condición | Duty en 900 s | I pico (mA) | I media (mA) |
|---|---|---:|---:|---:|
| NEMA 11 vía TMC2209, IRUN 0,337 A | continuo toda la sesión | 100 % | 287 | **287,0** |
| Lógica VIO del TMC2209 | continuo | 100 % | 8 | 8,0 |
| RP2040-Zero (WS2812 anulado, sin USB serie) | continuo | 100 % | 25 | 25,0 |
| Calefactor de férula 120 Ω | PWM tras alcanzar 33 °C | ~45 % | 41,7 | 18,8 |
| Calefactor de taza 120 Ω *(§9.3 de `06-seguridad.md`)* | 100 % en el pre-warm, luego ~40 % | ~44 % | 41,7 | 18,3 |
| 28BYJ-48 + ULN2003 | 16 movimientos (uno cada 4 golpes) × 4,6 s = 74 s | 8,2 % | 200 | 16,4 |
| LED rojo, pull-ups, divisores NTC, CD4013, TPL5010 | continuo | 100 % | 1,2 | 1,2 |
| | | | | |
| **MEDIA DEL SISTEMA** | | | | **375 mA — 1,87 W** |
| **PICO SIMULTÁNEO PEOR CASO** | IRUN 0,40 A + 28BYJ + ambos calefactores al 100 % | | **740 mA — 3,70 W** | |
| **PRE-WARM (60 s antes de empezar)** | motor parado, IHOLD 0, calefactores 100 % | | 118 mA | |
| **REPOSO tras el ciclo** | VMOT muerto, MCU dormido | | 12 mA | |

Cálculo del consumo del motor:

```
   Con el IRUN NOMINAL de la spec (0,33 A), que es el que usa la tabla de arriba:
   P_bobinas = 2 · I_rms² · R = 2 · (0,33)²  · 5,6 = 1,219 W
   I_entrada a 5 V con eta = 0,85:   1,219 / (5,0 · 0,85) = 0,287 A   <- fila de la tabla

   Con el escalon CS=10 realmente programado (0,337 A) son 1,272 W y 0,299 A:
   +12 mA sobre el presupuesto, dentro del redondeo. Ninguna conclusion cambia.

   Contingencia IRUN = 0,40 A:
   P = 2 · 0,16 · 5,6 = 1,792 W  ->  I = 1,792/(5·0,85) = 0,422 A
```

### 7.2 Por qué 5 V basta — la demostración correcta

La especificación dice *"coil 1,85 V against VM 5 V = 2,7× chopper headroom"*. **Ese número está inflado**,
porque usa la corriente **RMS**. El chopper tiene que llegar a la **cresta** de la senoide, y la cresta es
√2 veces mayor.

```
   I_pico por fase = I_rms · raiz(2) = 0,337 · 1,4142 = 0,477 A

   Reactancia inductiva a la velocidad máxima (clamp de 10 cm/s):
       f_electrica = pasos_completos/s / 4 = 151,6/4 = 37,9 Hz
       omega = 2·pi·37,9 = 238 rad/s
       X_L = omega·L = 238 · 0,0035 = 0,83 ohm     (frente a R = 5,6 ohm)
       -> el sistema es DOMINADO POR LA RESISTENCIA. La inductancia casi no cuenta.

   Tensión de bobina necesaria en la cresta:
       V_pico = I_pico · raiz(R² + X_L²) = 0,477 · raiz(31,36 + 0,69)
              = 0,477 · 5,662 = 2,70 V

   MARGEN REAL:  5,00 / 2,70 = 1,85x     (NO 2,70x)

   Y lo que de verdad importa con StealthChop, que es modo TENSIÓN:
       DUTY EN LA CRESTA = 2,70 / 5,00 = 54,0 %
       con VM caído a 4,85 V (cable):    2,70 / 4,85 = 55,7 %
       con IRUN subido a 0,40 A:         3,20 / 5,00 = 64,0 %

   El chopper satura al 100 % de duty. Estamos al 54 %.
   El punto en que 5 V dejaría de bastar es IRUN ~ 0,60 A rms.
```

**Conclusión: 5 V es genuinamente suficiente, con casi el doble de margen del necesario.** Pero el margen real
es **1,85×, no 2,70×**, y ése es el número que hay que usar si algún día se sube IRUN.

### 7.3 Por qué NO hace falta booster ni PD trigger — y por qué serían peores

| Opción | Coste | Qué aporta | Por qué se rechaza |
|---|---|---|---|
| **5 V USB nativo** ✔ | 0 € | Duty del 54 %, cero componentes activos añadidos, funciona con cualquier cargador de móvil | — |
| **Boost MT3608 / XL6009 a 12 V** | 1,00 € | Más margen de chopper que no necesitamos | **Descalificado.** Conmuta a 0,5-1,2 MHz con bobinas sin apantallar; el silbido **modula con la carga del motor**. Un tono variable en una habitación a 25 dBA es peor que un siseo constante: el oído se engancha a lo que cambia. El informe acústico es explícito |
| **PD trigger USB-C a 12 V** | 2,00 € | No añade ruido propio (sólo negocia por las líneas CC) | **Innecesario y contraproducente.** (a) A 12 V la misma corriente deja 9,3 V sobre la bobina: el chopper conmuta con excursiones mucho mayores y la **magnetostricción de las chapas del motor sube, no baja** — el beneficio del bus alto se cobra a velocidades altas, y aquí no las hay. (b) Ata la máquina a un cargador concreto: el aparato deja de funcionar con el cargador de la mesilla. (c) Muchos módulos llevan LED brillantes que hay que desoldar |
| **Fuente de 12 V dedicada** | 8-12 € | Idem | Idem, más un transformador extra enchufado junto a la cama |

> **Si la especificación dice "5 V USB nativo", es literal y es correcto. No lo mejores.**

### 7.4 El cuello de botella real: el cable

Ésta es la única forma verosímil de romper la alimentación de esta máquina, y no tiene nada que ver con el
cargador.

| Cable | R ida+vuelta | Caída a 0,80 A | V en el driver | Veredicto |
|---|---|---|---|---|
| 28 AWG, 2 m (cable de datos barato) | 0,85 Ω | **0,68 V** | **4,32 V** | **BROWNOUT.** Por debajo del mínimo absoluto de 4,75 V |
| 26 AWG, 1,5 m | 0,40 Ω | 0,32 V | 4,68 V | **Falla** |
| 24 AWG, 1 m | 0,17 Ω | 0,13 V | 4,87 V | Justo |
| **20-22 AWG, 0,5 m ("cable de carga rápida 3 A")** | 0,03-0,07 Ω | **0,03-0,06 V** | **4,94-4,97 V** | ✔ |

Y aún hay que restar la propia cadena de seguridad:

```
   F1 polifusible MF-R200 ........  0,05 ohm  ->  40 mV a 0,80 A
   S1 contacto NC ................  0,03 ohm  ->  24 mV
   Q1 AO3401A Rds_on .............  0,05 ohm  ->  40 mV
   cableado interno 0,3 m 22 AWG .  0,03 ohm  ->  24 mV
                                    ---------      -------
   TOTAL CADENA                     0,16 ohm       128 mV

   Con un cable de 20 AWG de 0,5 m:  VM = 5,00 - 0,05 - 0,128 = 4,82 V   ✔
   Con el cable de datos de 2 m:     VM = 5,00 - 0,68 - 0,128 = 4,19 V   ✘✘✘
```

> **CRITERIO DE ACEPTACIÓN (prueba 11.9): con el motor moviéndose, el 28BYJ-48 desplazando y los dos
> calefactores al 100 %, el polímetro entre los pines VM y GND del TMC2209 debe leer ≥ 4,80 V.**
> Si no llega: (1) cable más corto y grueso, (2) quita el polifusible F1 —el cargador ya limita—, (3) cargador
> de 5,1-5,2 V. En ese orden.

### 7.5 Desacoplo y condensadores

| Ref | Valor | Dónde | Por qué |
|---|---|---|---|
| **C2** | **470 µF / 10 V LOW-ESR** | Pines VM/GND del TMC2209, **patas < 10 mm** | Es el que absorbe los picos del chopper. Con patas largas la inductancia del bucle anula su efecto. **No es negociable** |
| C3 | 100 nF X7R cerámico | En paralelo con C2, pegado | Alta frecuencia; el electrolítico no llega |
| C1 | 100 µF / 10 V | Entrada USB, antes de S1 | Amortigua el cable y el transitorio de arranque del 28BYJ-48 |
| C11 | 10 µF cerámico + 100 nF | Pin 5V del RP2040-Zero | El LDO de la placa lo agradece |
| C12 | 100 nF | VDD del CD4013 y VDD del TPL5010 | CMOS: obligatorio, y el CD4013 aquí es un elemento de seguridad |
| C5 | 100 nF | Nodo HB, a masa | Depósito del charge pump. Fija la latencia en ~140 ms |
| C7, C13 | 100 nF | Divisores NTC a masa | Filtro anti-alias del ADC |
| C8, C10 | 100 nF | Pulsador y microrruptor | Antirrebote RC de 1 ms |

**Corriente de irrupción:** 570 µF cargándose de golpe al enchufar. Un cargador de 2 A lo aguanta sin
inmutarse, pero produce un chispazo visible en el conector si lo enchufas con el USB ya vivo. Si te molesta,
mete una NTC de irrupción de 10 Ω/2 A en serie con C1 (0,20 €). No es necesario.

### 7.6 Protección contra brownout — tres capas

```
   CAPA 1 — HARDWARE DEL PROPIO RP2040
   El RP2040 lleva detector de brownout en el núcleo digital. Reinicia limpio.
   Y al reiniciar, el PWM del latido se detiene -> el charge pump cae -> VMOT muere.
   El brownout se convierte automáticamente en una retirada de la brocha.

   CAPA 2 — UVLO DEL TMC2209
   Por debajo de ~4,75 V el driver pone los puentes en alta impedancia por su cuenta.
   Bobinas abiertas -> el contrapeso gana.

   CAPA 3 — MEDIDA POR ADC EN GP28
       VBUS --[10k]--+--[10k]-- GND ,  nodo -> GP28
       5,00 V -> 2,50 V -> cuenta 3102
       4,80 V -> 2,40 V -> cuenta 2978    <-- UMBRAL DE ABORTO
   Se muestrea a 10 Hz. Si tres lecturas consecutivas (300 ms) caen por debajo de
   2978, el firmware termina el ciclo de forma ordenada y parpadea el codigo de fallo.

   CAPA 4 — COMPARADOR DISCRETO -> LATCH  (opcional, 0,60 EUR)
   Un TL431 o un LM393 con referencia a 4,60 V dispara el SET del CD4013 directamente,
   sin pasar por el MCU. Es la unica capa que actua si el propio MCU esta muerto
   ANTES de que el latido se agote. Recomendado, no imprescindible.
```

### 7.7 Térmica del motor

```
   Disipación del NEMA 11 a IRUN 0,337 A ......... 1,27 W  (1,79 W a 0,40 A)
   R_th típica de un cuerpo de 28 mm sin aire ...  15-20 K/W
       -> carcasa del motor:  +19 a +25 K sobre el aire de la columna
   Dentro de una columna de pino de 18 mm forrada de fieltro, sin ventilación:
       -> cuerpo del motor 45-50 °C tras 15 min
       -> superficie EXTERIOR de la columna ~28 °C
```

Criterios del FMEA: superficie que puede tocar piel ≤40 °C, superficie que puede tocar ropa de cama ≤50 °C.
Se cumplen con holgura porque el motor está **dentro** de la columna y la columna está a 400 mm del cuerpo.
**Criterio de aceptación (11.13): tras un ciclo completo, la cara exterior de la columna por debajo de 35 °C.**
Si supera 40 °C, hay una fuga de corriente o IRUN está mal calculado por un R_SENSE equivocado.
**Nunca tapes la columna con ropa de cama.**

---

<a name="8"></a>
## 8. EL MICRORRUPTOR DE LEVA DEL PUNTO DE REPOSO

Una pieza de **0,40 €** que hace tres trabajos y sustituye a un AS5600, a un sensor hall y a un encoder.

### 8.1 Montaje mecánico

```
                       vista desde arriba, sector de barrido
                              _____
                          ,-''     ''-.
                      ,-''             ''-.        SECTOR de contrachapado
                    ,'                     ',      de 60 mm de radio
                   /                         \
                  |            (·) eje        |
                   \          M8 vertical    /
                    ',                     ,'
                      '-.               ,-'
                          '-._______,-'
                              |
                           [LEVA]  rampa de 8 mm de largo, 2 mm de alto,
                              |     limada en el canto del sector
                              v
                        ___________
                       |  SW2      |   microrruptor de palanca
                       |  ---o     |   (Omron D2F-01L o KW11-3Z genérico)
                       |__ /  \____|   COM -> GND ,  NA -> GP6
                          /    \
                     tornillo M2 sobre pletina en L de aluminio,
                     con RANURA para ajustar el punto de disparo.

   La leva empieza a empujar la palanca a +41 grados y el contacto cierra a +42
   grados, un grado antes del tope mecanico M4 a +43 grados. El contacto NUNCA
   soporta la fuerza del contrapeso: eso lo hace el tope M4.
```

### 8.2 Por qué contacto NA (normalmente abierto) y no NC

Es una decisión de dirección de fallo, y merece justificarse:

```
   Con NA + pull-up:    cerrado = EN REPOSO = nivel BAJO
                        cable roto / conector suelto / palanca partida
                             -> el pull-up manda -> nivel ALTO
                             -> "NO estoy en reposo"
                             -> el homing no encuentra el tope en 95 grados
                             -> LA MAQUINA SE NIEGA A ARRANCAR.        FALLO SEGURO.

   Con NC:              cable roto -> lee lo mismo que "estoy en reposo"
                             -> el homing termina de inmediato en un punto falso
                             -> toda la geometria queda desplazada
                             -> la brocha aterriza donde no debe.      FALLO PELIGROSO.
```

### 8.3 Trabajo 1 — Homing absoluto

```
   AL ARRANCAR (después de configurar el TMC2209, antes de tocar a nadie):

   1. Baja IRUN a 0,15 A (CS = 4).  Si algo está agarrotado, empuja con la
      mitad de fuerza. Un homing no tiene por qué ser fuerte.
   2. Lee GP6. Si YA está en BAJO (ya estamos en reposo), aléjate 10 grados
      del reposo primero, hasta que GP6 pase a ALTO. Esto garantiza que el
      barrido de homing empieza siempre con el contacto abierto.
      (El contrapeso empuja hacia el reposo, así que este tramo es "cuesta arriba".)
   3. Barre HACIA EL REPOSO a un equivalente de 1,0 cm/s, contando pasos.
   4. Si GP6 no ha cerrado tras 95 grados de recorrido -> PARA, desenergiza,
      parpadea 4 veces y NO ARRANQUES. Algo está bloqueado o roto.
   5. Al cerrar: retrocede 3 grados, y vuelve a acercarte a 0,3 cm/s.
      La segunda pasada da la repetibilidad: un microrruptor de palanca repite
      ±0,05 mm en el actuador, que sobre un brazo de 60 mm son ±0,05 grados,
      que en la punta a R=300 son ±0,26 mm. De sobra.
   6. Ese punto es el CERO. Todas las posiciones se cuentan desde ahí.
   7. Devuelve IRUN a 0,337 A.
```

### 8.4 Trabajo 2 — Integridad por ciclo

**Aquí hay que precisar la especificación.** Dice *"must close once per cycle"*, y "ciclo" es ambiguo: la
máquina da 52-65 golpes por sesión, pero el reposo está a +43° y los golpes sólo llegan a ±41° (ventana de inversión 35-41°).
**Los golpes normales NO pasan por el reposo.** Definición operativa:

```
   VISITAS PROGRAMADAS A LA TAZA DE REPOSO: CINCO por sesión de 15 min.

       t =   0 s   antes de empezar (pre-warm de 60 s en la taza)
       t = 225 s   fin del bloque 1
       t = 450 s   fin del bloque 2
       t = 675 s   fin del bloque 3
       t = 900 s   fin del bloque 4 = fin de la sesión

   EN CADA VISITA:
       - Se ordena un número N de pasos hasta el reposo, calculado desde
         la posición actual conocida.
       - GP6 debe cerrar dentro de N + 50 % de pasos.
       - Si NO cierra:  para -> desenergiza (el contrapeso retira la brocha)
                        -> espera 5 s -> UN reintento con amplitud reducida
                        -> si vuelve a fallar: fin de ciclo, 4 parpadeos.

   ENTRE VISITAS (por golpe), la única señal de integridad disponible es
   StallGuard4, y sólo por encima de ~3 cm/s. Dilo así en la documentación
   del firmware; no pretendas que hay verificación por golpe cuando no la hay.
```

### 8.5 Trabajo 3 — Corrección automática de pasos perdidos

```
   En cada cierre del microrruptor:

       error = pasos_ordenados_hasta_reposo  -  pasos_reales_al_cierre

   |error| <= 30 pasos completos  ->  se pone el contador a cero SILENCIOSAMENTE
                                      y se registra el valor.
                                      30 pasos = 3,78 grados de sector
                                               = 19,8 mm de arco de punta.
                                      La meseta plana mide 37 mm de aire libre,
                                      asi que 19,8 mm de deriva SIGUEN estando
                                      en el aire. La brocha no roza.

   |error| >  30 pasos completos  ->  algo va mal de verdad.
                                      Para, desenergiza, un reintento, fin de ciclo.

   POR QUE UN PASO PERDIDO ES BENIGNO AQUI:
     - El accionamiento es un tendón que solo puede TIRAR.
     - La fuerza tangencial está topada en 0,58 N por IRUN.
     - El error se acumula en el AIRE, sobre la meseta plana, no sobre la piel.
     - Y se borra CINCO VECES POR SESION contra un tope mecanico.
     Un paso perdido es un desplazamiento de unos milimetros en el punto de
     aterrizaje, no un arañazo.

   REGISTRO: guarda los 5 errores de cada sesión en flash. Si la media crece
   sesión a sesión, el tendón de Dyneema se está estirando o el cabrestante
   patina. Es tu único indicador de desgaste, y es gratis.
```

---

<a name="9"></a>
## 9. INTERFAZ DE USUARIO

### 9.1 La regla que gobierna todo

> **El aparato promete terminar sin despertarte.** Cualquier elemento de interfaz que pueda generar luz o sonido
> después de que te hayas dormido está en conflicto directo con la razón de existir del producto.
> Ante la duda, quítalo.

### 9.2 Pulsador de arranque

- **Pulsador de silicona de 16 mm**, o táctil de 6 mm de **baja fuerza (100-160 gf)** con capuchón de silicona.
- **NO un táctil de 6 mm estándar**: hace un "clic" claramente audible a 50 cm en una habitación a 25 dBA. Es un
  transitorio, y el informe acústico es explícito en que los transitorios despiertan más que el nivel medio.
- **Doble camino desde un solo contacto:**
  - A GP7 con pull-up + RC de 1 ms, para que el firmware lo lea.
  - Por C9/R19 (diferenciador) al RESET del CD4013, para que rearme el latch **en hardware**.
- **Requisito de intención deliberada (del FMEA): 300 ms sostenidos + 500 ms de soltado antes de armar.** Que te
  des la vuelta y aplastes el botón con el codo no puede reiniciar un ciclo.
- El diferenciador RC además garantiza que **mantener el botón apretado no mantiene el latch rearmado**: convierte
  una pulsación de 10 segundos en un único pulso de 10 ms.

**Alternativa sin clic:** un módulo capacitivo **TTP223** (0,40 €) pegado bajo una chapa de contrachapado de
3 mm, con salida a GP7. Cero piezas móviles, cero ruido, y funciona a través de la madera.
**Es exactamente la ventaja por la que alguien elegiría un ESP32, comprada por 40 céntimos** (sección 1.4).

### 9.3 LED rojo, y sólo eso

| Decisión | Razón |
|---|---|
| **Rojo**, no blanco ni azul ni verde | Es la longitud de onda que menos suprime la melatonina |
| **3 mm difuso**, no transparente | El transparente proyecta un punto brillante en el techo |
| **10 kΩ → 150 µA** (la resistencia típica sería 220 Ω → 15 mA, cien veces más) | Legible si lo buscas, invisible si no |
| Además **PWM al 5-20 %** | Ajuste fino sin cambiar la resistencia |
| **NADA de WS2812** | Al valor mínimo distinto de cero da 20-50 mcd (un punto brillante en la oscuridad), y **con valor 0 el propio chip consume 0,6-1 mA y el troquel emite un brillo tenue**. No se puede apagar de verdad |
| **Anula el WS2812 de la placa RP2040-Zero** (GP16) | Por lo mismo. Esmalte negro mate o levantar el pad de VDD |
| Tapa también el LED del cargador | Con un punto de esmalte negro. Es la luz más brillante de la mesilla |

**Vocabulario completo del LED, deliberadamente minúsculo:**

| Señal | Significado |
|---|---|
| **1 parpadeo largo (1 s)** al pulsar | Armado. Empieza el pre-warm de 60 s |
| **APAGADO durante toda la sesión** | Un LED fijo en una habitación a oscuras **es** una fuente de luz |
| **2 parpadeos lentos** al terminar | Fin normal del ciclo |
| **4 parpadeos rápidos + 5 s encendido** | Fallo. Y punto: no hay códigos de error que descifrar a las tres de la mañana. El diagnóstico se lee por USB al día siguiente |

### 9.4 Lo que NO lleva, y por qué

| Pieza descartada | Por qué |
|---|---|
| **Zumbador piezo** (0,20 €) | **La promesa entera del aparato es que termina sin despertarte.** Un pitido en el minuto 15 destruye el producto. No lo montes ni "por si acaso" |
| **Pantalla OLED 128×64** | Es un rectángulo luminoso en la mesilla. Incluso al brillo mínimo. Y para leerla tendrías que abrir los ojos y enfocar, que es lo contrario de lo que buscas |
| **Encoder rotativo** | Detentes que hacen clic, y el aparato tiene **un** comportamiento: no hay nada que seleccionar |
| **Relé** para cortar el motor | Un relé hace "clac" al abrir y al cerrar. Los MOSFET no |
| **Cualquier LED en el TMC2209, el ULN2003 o el PD trigger** | El ULN2003 de fábrica trae **cinco**. Desuéldalos o píntalos |
| **Ventilador** | Innecesario a 1,27 W, y sería la fuente de ruido dominante con diferencia |

### 9.5 El "tic" del 28BYJ-48 y cómo eliminarlo

Es la única fuente impulsiva de la máquina, ~64 veces por sesión, y el informe de sourcing avisa: un 28BYJ-48
sobre ULN2003 en medio paso crudo **hace tic**. Tres medidas, todas gratis o casi:

1. **Conducción PWM senoidal.** En vez de poner las entradas del ULN2003 a nivel alto/bajo, module cada fase con
   un slice PWM del RP2040 a 20 kHz siguiendo una tabla senoidal de 32 puntos. Es microstepping pobre, pero
   convierte cuatro escalones bruscos en una transición suave. **40 líneas de código, 0 €.**
2. **Enmascarado temporal (ya está en la especificación).** El desplazamiento radial se programa para que solape
   el último 20 % del golpe anterior, de modo que el rasgueo de las cerdas sobre la piel lo tapa.
3. **Desacoplo mecánico**: el 28BYJ-48 va sobre una arandela de EPDM de 2 mm dentro de una cubierta forrada de
   fieltro.

**Criterio de aceptación (11.14):** con el micrófono en la almohada, el **delta ON/OFF debe estar por debajo de
3 dB sobre el ruido de fondo de la habitación, incluyendo el desplazamiento del carro**. Si no se consigue, la
especificación ya prevé el plan B: bajar a 8 desplazamientos por sesión, con lo que la banda mojada se estrecha
de 118 mm a ~90 mm.

---

<a name="10"></a>
## 10. BOM ELECTRÓNICA

| Ref | Componente | Cant. | € ud | € tot | Notas |
|---|---|---:|---:|---:|---|
| U1 | **RP2040-Zero** (Waveshare) | 1 | 4,50 | 4,50 | Anula el WS2812 |
| U2 | **TMC2209 V1.3** BIGTREETECH/FYSETC **tienda oficial** | 1 | 5,50 | 5,50 | Compra **dos** para el A/B antifalsificación (+5,50 €) |
| U3 | **ULN2003** con placa (viene con el 28BYJ-48) | 1 | — | — | Desuelda los 5 LED |
| U4 | **TPL5010** SOT-23-6 + adaptador a DIP | 1 | 2,20 | 2,20 | One-shot de **17 min (1 020 s)**. Alternativa: **CD4060B** DIP-16 a 0,50 € |
| U5 | **CD4013B** DIP-14 (flip-flop D) | 1 | 0,40 | 0,40 | Latch de parada |
| U6 | **LM393** o TL431 (comparador de brownout) | 1 | 0,30 | 0,30 | Opcional pero recomendado |
| Q1 | **AO3401A** P-MOSFET SOT-23 | 1 | 0,20 | 0,20 | Rds_on 50 mΩ. Alternativa TO-92: **IRLML6402** o un P-FET de potencia |
| Q2, Q3 | **2N7002** N-MOSFET SOT-23 | 2 | 0,10 | 0,20 | O **2N7000** en TO-92 |
| Q4, Q5 | **AO3400A** N-MOSFET lógico | 2 | 0,15 | 0,30 | Calefactores |
| S1 | **Pulsador seta 16 mm NC ENCLAVABLE** (push-break / twist-release) | 1 | 3,00 | 3,00 | **Verifica que el contacto es NC y que enclava.** Es la pieza de seguridad más importante del documento |
| S2 | Pulsador de silicona 16 mm (o táctil 100-160 gf + capuchón) | 1 | 1,80 | 1,80 | O **TTP223** capacitivo a 0,40 € |
| SW2 | **Microrruptor de palanca** SPDT (D2F-01L / KW11-3Z) | 1 | 0,40 | 0,40 | Pack de 10 por ~2 € |
| D1-D5 | **BAT54** Schottky (o 1N4148) | 5 | 0,05 | 0,25 | |
| R13 | **120 Ω metal film 0,6 W** | 1 | 0,05 | 0,05 | **0,6 W, no 0,25 W** — ver corrección C-8 |
| R17 | **120 Ω metal film 0,6 W** | 1 | 0,40 | 0,40 | Calefactor de la taza |
| — | **NTC 10 kΩ B=3950** | 2 | 0,30 | 0,60 | Férula + taza |
| — | **Fusible térmico 45 °C** (KSD9700 NC) | 1 | 0,80 | 0,80 | Ver corrección C-6 |
| C2 | 470 µF / 10 V **low-ESR** | 1 | 0,40 | 0,40 | Patas cortas a VM/GND |
| C1 | 100 µF / 10 V | 1 | 0,15 | 0,15 | |
| — | Cerámicos 100 nF X7R | 10 | 0,03 | 0,30 | |
| C4 | 220 nF | 1 | 0,05 | 0,05 | Charge pump |
| C11 | 10 µF cerámico | 1 | 0,08 | 0,08 | |
| — | Resistencias 1 % (10k ×8, 100k ×3, 470k, 24k, 22k, 1k ×5, 100 Ω ×2) | ~22 | 0,02 | 0,45 | |
| — | LED rojo 3 mm difuso | 1 | 0,05 | 0,05 | |
| — | Placa perforada 70×50 + regletas + JST + cable 24 AWG + silicona 0,1 mm² | 1 | 4,00 | 4,00 | |
| — | Conector USB-C (o USB-A) hembra de panel | 1 | 1,20 | 1,20 | |
| — | Polifusible **MF-R200** (2 A hold) | 1 | 0,20 | 0,20 | |
| — | **Cable USB de carga 20-22 AWG, ≤0,5 m** | 1 | 3,00 | 3,00 | **Ver 7.4: el cable es el cuello de botella** |
| | | | | **≈ 30,80 €** | Sin el segundo TMC2209 ni el cargador |

**Extras muy recomendados:** segundo TMC2209 (5,50 €, prueba antifalsificación) y adaptador **USB-TTL CH340
3,3 V** (2,50 €, para leer el registro IOIN antes de montar nada).

---

<a name="11"></a>
## 11. LISTA DE COMPROBACIÓN ANTES DE ENERGIZAR EL MOTOR POR PRIMERA VEZ

**Regla de oro: los pasos 11.1 a 11.10 se hacen con el MOTOR DESCONECTADO del driver y con el TENDÓN DE
DYNEEMA DESENGANCHADO del cabrestante.** El motor no se conecta hasta el paso 11.11.

### Fase A — Con TODO desenchufado (polímetro en continuidad y en ohmios)

| # | Comprobación | Criterio |
|---|---|---|
| 11.1 | **Cortocircuito de alimentación.** Óhmetro entre VBUS y GND, y entre VMOT y GND | **> 1 kΩ en ambos.** Si lees pocos ohmios, hay un puente de soldadura. **No enchufes nada** |
| 11.2 | **Polaridad de todos los electrolíticos** (C1, C2, C11) | Banda negativa hacia GND. Un electrolítico al revés a 5 V no explota, pero se calienta y falla en meses |
| 11.3 | **Orientación de U1, U2, U4, U5** | Punto/muesca del pin 1 según el silkscreen. Un CD4013 del revés se destruye en segundos |
| 11.4 | **R_SENSE del TMC2209.** Óhmetro sobre las dos resistencias de sensado del módulo | **0,11 Ω** (BTT V1.2/V1.3). Si mides 0,15 Ω, **recalcula IRUN** o te irás un 36 % |
| 11.5 | **Continuidad de la cadena de seguridad.** Óhmetro entre VBUS y VSW, con S1 sin pulsar y luego pulsado | Sin pulsar: **< 1 Ω**. Pulsado: **circuito abierto**. Y **se queda abierto** hasta que lo gires |
| 11.6 | **Pull-up de EN.** Óhmetro entre GP4 y 3V3 | **10 kΩ.** Si mides un pull-**down** a masa, lo has cableado al revés: **corrígelo** (corrección C-3) |
| 11.7 | **Resistencia del calefactor.** Óhmetro sobre R13 en circuito | **120 Ω ± 1 %.** Cualquier otro valor cambia el techo térmico. Verifica también la continuidad del fusible térmico |
| 11.8 | **Divisores NTC.** Óhmetro sobre cada NTC a 20 °C | **~12,5 kΩ.** Si lees 10 kΩ exactos, has puesto una resistencia fija por error |
| 11.9 | **Aislamiento del calefactor.** Óhmetro entre cualquier hilo del calefactor y las cerdas / la funda de silicona | **> 20 MΩ.** Nada eléctrico puede alcanzar la piel |
| 11.10 | **Bobinas del motor (aún desconectado).** Óhmetro por pares de hilos | **5,6 Ω** entre negro-verde y entre rojo-azul; **abierto** entre pares. Si te sale un par mal, tienes las fases cruzadas y el motor vibrará sin girar |

### Fase B — Con USB enchufado, MOTOR AÚN DESCONECTADO

| # | Comprobación | Criterio |
|---|---|---|
| 11.11 | **Al enchufar el USB, ¿está VMOT muerto?** Polímetro en VMOT | **0 V.** Si hay 5 V, el POR del CD4013 (C6/R4) no funciona. **Arréglalo antes de seguir**: enchufar nunca debe energizar el motor |
| 11.12 | **Tensiones de reposo.** VBUS y 3V3 | **4,95-5,10 V** y **3,25-3,35 V** |
| 11.13 | **UART y autenticidad.** Sube el firmware, lee `IOIN` (0x06) | **VERSION = 0x21.** Si no responde o da otro valor: driver falso, UART mal cableado, o falta `pdn_disable=1`. **No sigas** |
| 11.14 | **Latido.** Osciloscopio o polímetro en AC sobre GP11; polímetro DC en el nodo HB | GP11: **onda cuadrada de 2 kHz**. HB: **5,5-6,2 V DC** |
| 11.15 | **Arma con el botón.** Pulsa 300 ms. Polímetro en VMOT | **VMOT sube a ~4,9 V** y se mantiene |
| 11.16 | **Prueba del paro de emergencia.** Con VMOT vivo, pulsa S1 | **VMOT cae a 0 V inmediatamente y SE QUEDA a 0 V.** Girar para soltar **no** debe reenergizar por sí solo: hace falta pulsar el botón de arranque otra vez |
| 11.17 | **Prueba del latido (la más importante de todas).** Con VMOT vivo, pon un puente entre GP11 y GND (simula un pin colgado en bajo). Cronometra | **VMOT muere en menos de 250 ms.** Repite con GP11 puenteado a 3V3 (pin colgado en alto): **debe morir igual**. Si sobrevive a cualquiera de los dos, el charge pump está mal |
| 11.18 | **Prueba del one-shot.** Arma y espera con un cronómetro, sin tocar nada | **VMOT muere sola entre 850 s y 1100 s.** Anota el tiempo real. El RC del TPL5010 (o del CD4060) deriva ±10 %; ajusta la resistencia si te sales de 900-1050 s. **No te fíes de la tabla del datasheet: crónometralo** |
| 11.19 | **Prueba del brownout.** Alimenta desde una fuente de laboratorio y baja de 5,0 a 4,5 V | El firmware debe abortar por debajo de 4,80 V, y VMOT debe morir por debajo de 4,60 V |
| 11.20 | **Calefactor al 100 %, 20 minutos, sin lazo NTC.** Termopar o termómetro IR pegado a la férula, en una habitación cuya temperatura hayas medido | **T_férula ≤ T_ambiente + 19 K.** Éste es **el ensayo que convierte la demostración de la sección 5.2 en un hecho**. Si sube más, tu R_th real es peor que 85 K/W: **baja a 150 Ω** (0,167 W → +14,2 K) y repite |
| 11.21 | **Puntas de las cerdas.** Con el calefactor regulando a 33 °C, termómetro IR sobre las puntas | **T_amb + 5 a 8 K.** Si es menos de 27 °C con la habitación a 20 °C, la especificación autoriza bajar a **82 Ω** (0,305 W, +25,9 K) — **pero entonces reaplica C-7 y prohíbe el calefactor por encima de 17 °C de ambiente** |

### Fase C — Motor conectado, tendón AÚN desenganchado

| # | Comprobación | Criterio |
|---|---|---|
| 11.22 | **Primer movimiento.** Con el eje libre, 200 pasos a 45 pasos/s | Gira suave, sin tirones, **prácticamente inaudible a 30 cm**. Si zumba: driver falso, `en_spreadCycle` mal, o `TPWMTHRS` no está al máximo |
| 11.23 | **Corriente real.** Amperímetro en serie con VBUS, motor moviéndose | **~0,30 A.** Si mides 0,55 A, `I_scale_analog` sigue a 1 y manda el potenciómetro VREF |
| 11.24 | **Prueba de la rueda libre (crítica para el fallo seguro).** VMOT vivo, motor parado, IHOLD=0, freewheel=01. Gira el eje con los dedos | **Debe girar tan libre como con el driver desenchufado.** Si notas frenado, tienes `freewheel` en 10 u 11, o IHOLD distinto de 0. **Corrígelo: es lo que pelea contra el contrapeso** (sección 6.4) |
| 11.25 | **Procedimiento A de autotune** (sección 6.5) con el binario de calibración | Anota PWM_OFS_AUTO y PWM_GRAD_AUTO. **Reflashea el binario definitivo antes de seguir** |
| 11.26 | **Suelo del PIO.** Osciloscopio en GP2; ordena por consola una velocidad absurda (100 cm/s) | El intervalo entre pulsos **no baja de 240 µs**, pase lo que pase. Si baja, el programa PIO no es el que crees |
| 11.27 | **Temperatura del motor.** 15 min moviéndose, termopar en la carcasa | **< 55 °C.** Fuera de la columna de pino |

### Fase D — Tendón enganchado, máquina completa

| # | Comprobación | Criterio |
|---|---|---|
| 11.28 | **Homing.** Arranca y observa | Encuentra el microrruptor en menos de 95° y hace la segunda pasada lenta |
| 11.29 | **Fallo del microrruptor.** Desconecta el cable de SW2 y arranca | **La máquina se niega a arrancar** y parpadea 4 veces (fallo seguro, sección 8.2) |
| 11.30 | **LAS TRES PRUEBAS DE LA ESPECIFICACIÓN, contra una almohada lastrada, con la brocha apoyada, en tres ciclos completos:** (a) tirón del USB a media pasada, (b) S1 a media pasada, (c) firmware colgado a media pasada (`while(1);` desde la consola) | **En los tres casos la brocha DEBE abandonar la piel en 2-3 s**, frenada por el amortiguador neumático, y terminar en la taza de reposo sobre la propia base de la máquina. **Si alguna de las tres falla, el aparato no duerme contigo. Sin excepciones.** |
| 11.31 | **Fuerza de contacto.** Báscula de cocina en cinco puntos del arco | **400 ± 25 mN** |
| 11.32 | **Ruido en la almohada.** Sonómetro (o app calibrada) sobre la almohada, ciclo completo | **Delta ON/OFF < 3 dB** sobre el fondo de la habitación, **incluyendo un desplazamiento del carro radial** |
| 11.33 | **VM bajo carga máxima.** Polímetro en VM/GND del TMC2209, con motor + 28BYJ-48 + ambos calefactores | **≥ 4,80 V.** Si no: cable más corto y grueso (sección 7.4) |
| 11.34 | **Ciclo completo de 15 min × 3**, y comprobar que el TPL5010 **no** dispara ninguna de las tres veces | Si dispara, el firmware se está colgando. **Es un síntoma, no una anécdota** (sección 4.3) |

---

<a name="12"></a>
## 12. CONTRADICCIONES ENCONTRADAS EN LA ESPECIFICACIÓN VINCULANTE

No las escondo. Las doce están corregidas dentro del documento; aquí está el resumen.

| # | Dónde | Qué dice la especificación | Qué pasa en realidad | Corrección aplicada |
|---|---|---|---|---|
| **C-1** | Autotune (6.5) | *"movimiento oculto de 1,2 s a 400 pasos/s"* junto a *"compiled-in PIO minimum step interval caps the tip at 10 cm/s"* | **Mutuamente incompatibles.** 400 pasos completos/s = **26,4 cm/s de punta**, 2,6× el clamp. Y 400 pulsos/s a 1/32 = 8,2 mm/s, inútil para el AT#2 | AT#1 en cada arranque (parado, no necesita movimiento); **AT#2 una sola vez en el banco, motor desacoplado, con un binario de calibración distinto**; PWM_OFS/PWM_GRAD congelados en flash con `pwm_autograd = 0`. **Beneficio: se elimina un latigazo de 26 cm/s del arranque de cada noche** |
| **C-2** | Clamp del PIO (1.2) | *"caps the tip at 10 cm/s regardless of firmware state"* | El suelo del PIO topa la **frecuencia de pulsos**. Es un tope de **velocidad** sólo si los mm/pulso son constantes, y el microstepping se fija por UART (`mstep_reg_select=1`), que el firmware puede cambiar | Suelo fijado en **240 µs → 9,30 cm/s en el peor radio (325 mm)**. Verificación de `CHOPCONF.MRES` antes de cada golpe. **Variante endurecida ofrecida y recomendada**: MS1/MS2 atados a 3V3 (1/16 por pines) con `mstep_reg_select = 0`, y el UART deja de poder tocar el microstepping. Y se dice claramente que el clamp es una barrera contra **errores de diseño**, no contra ejecución de código arbitraria |
| **C-3** | Habilitación del driver | El FMEA de la investigación dice *"ENABLE debe ser ACTIVO-ALTO con pull-DOWN de 10 kΩ"* | **El pin EN del TMC2209 es ACTIVO A NIVEL BAJO.** Copiar esa recomendación literalmente pone un pull-down que **habilita el driver en cada reset y durante todo el arranque** | **Pull-UP de 10 kΩ a 3V3 en GP4/EN.** Comprobación explícita en el paso 11.6 |
| **C-4** | `IHOLD = 0` | *"IHOLD = 0 ... zero standstill current, hum or heat"* | En el TMC2209, **`IHOLD = 0` no es corriente cero**: `CS=0` es el escalón más bajo (~30 mA rms) y los puentes siguen en baja impedancia, lo que **frena por corrientes inducidas y se opone al contrapeso** | **`PWMCONF.freewheel = 01` obligatorio** (bobinas en alta impedancia). Prohibidos `10` y `11` (cortocircuitan las bobinas = freno magnético contra el fallo seguro). Ensayo de aceptación 11.24 |
| **C-5** | Presupuesto del fallo seguro | *"Covers ... hung firmware"* con sólo el contrapeso, el TPL5010 y el paro | **Falso tal cual está.** Con las bobinas energizadas a IRUN 0,337 A el par de retención reflejado es de ~500 mN·m, **el doble de los 247 mN·m del contrapeso**. Un firmware colgado con las bobinas vivas mantiene la brocha sobre la piel **hasta 16 minutos** | **Se reincorpora el charge pump de latido** de las síntesis (5 componentes, ~1 €): corta VMOT en **<250 ms** si el latido se detiene. Es el único elemento que cubre ese caso. Ensayo 11.17 |
| **C-6** | Fusible térmico | *"fusible térmico de 47 °C en serie"* | **47 °C no es un valor de catálogo** en fusibles térmicos de un solo uso (la serie Microtemp empieza sobre 55-65 °C). Y 47 °C está por **encima** del umbral de quemadura por contacto prolongado de la ISO 13732-1 (43 °C) | **KSD9700 bimetálico NC de 45 °C** (comprable en Amazon.es y AliExpress, ~0,80 €), pegado **a la férula**, no al cable. Se elige por debajo de los 47 °C de la especificación, no por encima. Alternativa de un solo uso: Microtemp de 55 °C |
| **C-7** | Techo del calefactor | *"HARDWARE ceiling ~38 °C set by the resistor value"*, presentado como absoluto | **El techo es T_ambiente + 17,7 K, no 38 °C.** A 20 °C de ambiente da 37,7 °C ✔, pero a 26 °C (verano español) da **43,7 °C**, por encima del umbral ISO 13732-1 | **El firmware desactiva el calefactor de férula si el ambiente supera 24 °C** (techo garantizado ≤41,7 °C). Y por encima de 24 °C el calefactor no hace falta. Más el fusible de 45 °C pegado a la férula, y el ensayo 11.20 que mide el techo real en lugar de suponerlo |
| **C-8** | Resistencia del calefactor | *"120 ohm 0,25 W"* (y así aparece en el BOM) | 0,208 W en una resistencia de 0,25 W es el **83 % de su nominal**, dentro de una férula de silicona sin ventilación. La deriva y el envejecimiento son reales | **120 Ω metal film de 0,6 W** (mismo valor, misma potencia disipada, **35 % de su nominal**). Cuesta lo mismo y cabe en la férula (6,3 × 2,4 mm) |
| **C-9** | Margen de chopper | *"coil 1,85 V against VM 5 V = 2,7× chopper headroom"* | Usa la corriente **RMS**. El chopper tiene que alcanzar la **cresta** de la senoide: I_pico = 0,477 A → V_pico = 2,70 V → **margen real 1,85×**, no 2,70× | Recalculado en 7.2 con el criterio correcto (**duty StealthChop del 54 %** en la cresta). **La conclusión "5 V nativo" NO cambia y es correcta**, pero el número 2,70× está inflado y no debe usarse como margen de diseño si algún día se sube IRUN |
| **C-10** | Integridad por ciclo | *"must close once per cycle within commanded time +50%"* | **"Ciclo" es ambiguo.** Hay 64 golpes por sesión, pero el reposo está a +43° y los golpes sólo llegan a ±40°: **los golpes normales no pasan por el microrruptor** | Definido como **5 visitas programadas a la taza por sesión** (arranque + fin de cada uno de los 4 bloques). Y se dice explícitamente que **la integridad por golpe individual no existe**, salvo StallGuard4 por encima de 3 cm/s |
| **C-11** | StallGuard4 | *"StallGuard4 as a free second trip"* | Correcto como *segundo* disparo, pero el propio informe de actuadores lo desmonta por debajo de ~10 rpm. **A 2,0 cm/s el motor gira a 9,1 rpm: StallGuard no sirve ahí**, y 2,0 cm/s es el extremo bajo de la banda nominal | Se activa (`TCOOLTHRS = 2000`) y se documenta la tabla de fiabilidad por velocidad (6.6). **Ninguna decisión de seguridad descansa sobre él**: la detección primaria es el microrruptor |
| **C-12** | Presupuesto de corriente | *"System 0,36 A mean, 0,7 A peak, 1,8 W"* | El calefactor de la taza de reposo (llegado de la síntesis 3 y aceptado en el `final_spec`) **no está en ese presupuesto**, ni lo está el carro radial solapado con el golpe | Presupuesto rehecho en 7.1, coherente con `03-bom.md` y con el firmware (taza de **120 Ω** y **16 movimientos** de carro por sesión): media **375 mA / 1,87 W**, pico **740 mA / 3,70 W**. **No cambia ninguna conclusión**: un cargador de 5 V 2 A sigue teniendo 2,7× de margen en el pico |

**Un apunte que NO es una contradicción, para que nadie lo "corrija" por error:** la potencia de bobinas de
**1,22 W** de la especificación (`2 · I_rms² · R` con I_rms = 0,33 A) **es correcta**. Con microstepping senoidal,
la suma instantánea `I_A² + I_B²` es constante e igual a `I_pico²`, y `I_pico² · R = 2 · I_rms² · R`. Las dos vías
dan lo mismo. Si alguien te dice que hay que dividir entre dos, se está confundiendo.

---

## APÉNDICE — ORDEN DE MONTAJE RECOMENDADO

1. Placa perforada: alimentación, plano de masa en estrella, C1, C2, C3, conector USB de panel.
2. **Cadena de seguridad completa: S1, Q1, Q2, Q3, CD4013, charge pump, TPL5010.** Antes que nada.
3. Pruebas 11.1 a 11.5, y 11.11 a 11.19. **La cadena de seguridad se valida antes de que exista un motor.**
4. RP2040-Zero (anula el WS2812 ahora, antes de instalarlo) + TMC2209 + UART. Prueba 11.13.
5. Calefactores y NTC, con la brocha fuera de la máquina. Pruebas 11.20 y 11.21.
6. Motor conectado, eje libre, tendón desenganchado. Pruebas 11.22 a 11.27, incluido el Procedimiento A.
7. ULN2003 + 28BYJ-48 + carro radial.
8. Interfaz: pulsador, microrruptor, LED.
9. Tendón enganchado, contrapeso colgado, amortiguador neumático montado. Pruebas 11.28 a 11.34.
10. **Sólo entonces, tres ciclos completos contra una almohada lastrada. Y sólo entonces, tú.**

---

*Documento 04 de la serie PLUMA-R. Hermanos: `03-bom.md` (compras), `final_spec.md` (contrato vinculante).
Todo número de este documento que contradiga a `final_spec.md` está listado en la sección 12 con su justificación.*
