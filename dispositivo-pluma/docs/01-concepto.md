# PLUMA-R — 01 · CONCEPTO FINAL Y DIAGRAMA DE FUNCIONAMIENTO

> Dispositivo de caricia lenta para conciliar el sueño.
> Ciclo de 15 minutos, silencioso, con fallo seguro puramente mecánico.

---

## 0. LA CORRECCIÓN QUE CAMBIA EL PROYECTO ENTERO

El encargo pedía «una sensación de pluma muy ligera», «ninguna presión excesiva» y «contacto extremadamente ligero». La investigación dice que **eso, tomado al pie de la letra, produce lo contrario de lo que buscas.**

| | Fuerza | Qué se siente |
|---|---|---|
| Pluma real (peso propio) | **0,3 mN** | *Knismesis*: cosquilleo tipo insecto. Irritante. Provoca el reflejo de apartarse |
| Un algodón | ~3 mN | Cosquilleo |
| **Óptimo medido de placer** | **400 mN** | **Caricia** |
| Humano acariciando sin instrucciones | 370 ± 240 mN | Caricia (aterriza solo en el óptimo) |
| Bastoncillo | ~100 mN | Roce |
| > 1000 mN | | Presión, masaje |

Las fuentes son directas y recientes:

- **Faresse et al., bioRxiv 10.64898/2026.01.15.699730 (enero 2026).** Midieron valoración perceptual a 0,2 / 0,4 / 0,8 / 1,2 / 1,6 / 2,0 N y microneurografía de C‑LTMR a 0,05 / 0,4 / 1,5 N, cruzado con 0,3 / 1 / 3 / 10 / 30 cm/s en antebrazo. **A todas las velocidades, 0,4 N resultó más agradable que 0,05 N y que 1,5 N.**
- **Trotter et al., PLOS One 2023 (PMID 37220110).** Replicación independiente: *«For all velocities, 0.4 N was preferred over 0.05 N and 1.5 N robotic touch.»*
- **Landsman & Gerling (PMC13084518).** Brocha instrumentada, 20 participantes × 5 ensayos acariciando libremente: **0,37 N ± 0,24.**

Es decir: **el óptimo no está en el límite cuando la fuerza tiende a cero. Está en una meseta alrededor de 0,4 N, y bajar de ahí empeora la sensación de forma medible.**

**Consecuencia de diseño:** «sensación de pluma» se consigue como **percepto** — contacto ancho, muchas fibras finas, suave, lento, tibio, predecible en su llegada — y **no** minimizando la fuerza. Si construyes literalmente una pluma rozando la piel, obtienes el estímulo que la evolución diseñó para avisarte de que tienes un insecto encima.

### Los seis parámetros vinculantes que salen de la investigación

| Parámetro | Objetivo | Fuente |
|---|---|---|
| **Fuerza de contacto** | **400 mN** (banda útil 261–523) | Faresse 2026, Trotter 2023 |
| **Velocidad de punta** | **1–10 cm/s, pico 3 cm/s** | Löken et al., Nat Neurosci 2009 (doi 10.1038/nn.2312) |
| **Temperatura de contacto** | **~32 °C** (18 °C y 42 °C ambos peores) | Ackerley et al., J Neurosci 2014;34(8):2879 |
| **Anchura de contacto** | **20–60 mm multifibra** | Antídoto estructural contra la knismesis |
| **Despegue entre pasadas** | **obligatorio** | Elimina el punto muerto de velocidad cero |
| **Migración de trayectoria** | **obligatoria** | Habituación medible en ~2 min; abrasión y alloknesis |

El pico absoluto de toda la matriz velocidad × temperatura publicada es **3 cm/s a 32 °C**. Ese es el punto de diseño.

---

## 1. COMPARATIVA DE ARQUITECTURAS

Se especificaron **siete** arquitecturas completas, con números, y las puntuaron **tres jueces independientes** con lentes distintas (sensación / ingeniería / constructor). Puntuación ponderada: realismo ×3, seguridad ×2, silencio ×2, construibilidad ×1, coste ×1, cobertura ×1.

| # | Arquitectura | Realismo (media) | Total | Veredicto |
|---|---|---|---|---|
| A | **Brazo oscilante contrapesado (CBS‑2)** — *tus opciones 1+2* | 8,5 (autoev.) | — | **Backbone elegido.** Falló en la ronda 1 por un error de serialización y se regeneró aparte |
| D | PolarStroke — brazo polar + eje de elevación | **8,33** | 65,8 | Ganó al juez de sensación. Dos motores: más caro, más transitorios, corriente de mantenimiento |
| — | SMC‑750 — carro magnético en tubo sellado | 8,17 | 66,0 | Excelente sensación y seguridad, pero 600 mm de tubo con un entrehierro de 2,6 mm es inconstruible a mano |
| B | Sawtooth Cam — leva espiral de velocidad constante | 7,00 | 65,3 | Ganó al juez de ingeniería. **Rechazada:** la leva es una pieza a medida no iterable cuyo error se amplifica ×5,11 |
| G | LIMPET — cápsula atada al miembro | 7,00 | 66,0 | Ganó al juez constructor. **Rechazada:** te duermes encima de ella, y 92 mm de recorrido no es «una pluma recorriéndote» |
| F | PLUMB‑LINE — pluma colgada de un hilo | 7,00 | 55,7 | Fuerza limitada por gravedad, pero voladizo sobre una persona dormida |
| E | Carousel — tambor de fibras giratorio | 5,67 | 61,3 | **Rechazada por seguridad:** elemento en rotación continua junto a una cama. Ecuación del cabrestante: 3 vueltas de pelo multiplican la tensión ~300× |

### Por qué gana el brazo oscilante (tu idea inicial)

Los tres jueces eligieron cosas distintas, así que se forzó una **síntesis**: tres diseños finales independientes con sesgos enfrentados (máxima sensación / máxima simplicidad / máxima seguridad). **Los tres convergieron en la misma máquina**: brazo contrapesado + riel de leva fijo. Esa convergencia es la señal más fuerte de todo el proceso.

El selector adversarial eligió el esqueleto más simple y le injertó el realismo. Razones decisivas:

1. **El fallo seguro es un peso colgando de una cuerda.** Es el único mecanismo de retirada del campo sin trinquete, sin solenoide, sin supercondensador, sin lógica discreta y sin código. No puede atascarse, ni perder carga, ni fallar al armarse, ni ser anulado por el firmware.
2. **Elimina todos los agujeros de precisión.** Un perno M8 lleva los dos rodamientos 608ZZ, así que la coaxialidad la da el perno y no un taladro. La bisagra es un tornillo M3 pasante entre dos mejillas de contrachapado.
3. **Cero motores en el eje de fuerza.** La fuerza normal es un lastre de latón de 40 g y la gravedad. No hay actuador que pueda empujar más fuerte, ni software que pueda ordenarlo.

---

## 2. DIAGRAMA DE FUNCIONAMIENTO

### 2.1 Alzado — la máquina completa

```
                                        ALTURA MÁXIMA 222 mm
      ┌── cordón de retorno sobre polea 623ZZ
      │
      │   ╔═══════════════╗ ← columna: cajón de pino 18 mm, 80×80×130
      │   ║  NEMA 11      ║   forrada de fieltro, amortiguador de goma
      │   ║  IRUN 0,33 A  ║
      │   ║      ↓        ║   eje de barrido VERTICAL (β = 0 deliberado,
      │   ║  silicona 6/10║   de modo que v_punta = R·ω EXACTAMENTE,
      │   ║  k=0,024 N·m/rad  sin corrección de cono ni de elipse)
      │   ║      ↓        ║
      │   ║  cabrestante  ║   perno M8 + 2× 608ZZ separados 50 mm
      │   ║  r_ef 4,2 mm  ║   (la coaxialidad la da el perno, no un taladro)
      │   ║  6 vueltas    ║
      │   ║  Dyneema 0,4  ║
      │   ╚═══╤═══════════╝
      │       │ reducción 14,29:1  (sector 60 mm / cabrestante 4,2 mm)
      │       │ 0,6597 mm de punta por paso completo
      ▼       ▼
   ┌─────┐  ╔═══════════════╗
   │peso │  ║ sector 60 mm  ║══ carro radial ±25 mm ══╗
   │360 g│  ║ + tambor r=70 ║   husillo T8 avance 8mm ║
   │  ↕  │  ╚═══════════════╝   28BYJ‑48 + ULN2003    ║
   │pistón│                                            ║
   │espuma│                          bisagra de cabeceo LIBRE (M3 + 2 PTFE)
   │ PVC  │                          eje horizontal y TANGENCIAL (±3°)
   │ 32mm │                                            ║
   │purga │        ┌───────────────────────────────────╨────────────┐
   │0,75mm│        │  lastre 40 g        patín PTFE                 │
   └─────┘         │  x = 125 mm         x = 90 mm                  │
   amortiguador    ╞══════════════════════════════════════════════╗ │
   neumático:      ║  botavara: carbono 4 mm (0–160) + GRP 2 mm    ║ │
   98 mm/s de      ║  (160–240, fusible de sobrecarga, k = 70 N/m) ║ │
   retirada        ╚══════════════════════════════════════════════╝ │
                                                          ↓ R=300 mm
                                              ╔═══════════════════╗
                                              ║ KABUKI pelo cabra ║
                                              ║ 60 mm (52 cargado)║
                                              ║ 30 mm pelo libre  ║
                                              ║ calefactor 120 Ω  ║
                                              ╚═══════════════════╝
        ╱▔▔▔▔╲ ← RIEL DE LEVA FIJO                    ↓ ↓ ↓ ↓ ↓
   ════╱══════╲═══════════════════════════════   ~~~~~~~~~~~~~~~~~ PIEL
   base de pino 300×200×18, lastrada a 1,6 kg        400 mN
   pies de corcho · NUNCA sobre el colchón
```

### 2.2 Planta — las cuatro zonas del riel

El riel de leva fijo es **la pieza clave**: es lo que consigue el despegue con **un solo motor**.

```
        φ = 0°  ─────────── centro del barrido ───────────
                │
   ┌────────────┼────────────┐  ZONA DE CONTACTO   0 – 19°
   │  SIN RIEL. Brocha sobre │  Fuerza 400 mN constante
   │  la piel a fuerza plena │  Arco de piel: 199 mm
   │  199 mm de caricia      │  Duración: 6,6 s a 3 cm/s
   └────────────┼────────────┘
                │
   ┌────────────┼────────────┐  TAPER (descarga)  19 – 26°
   │ El riel sube 0 → h_t    │  La fuerza se desvanece
   │ Perfil coseno alzado    │  GEOMÉTRICAMENTE: 400 → 0 mN
   │ (dF/dt = 0 en extremos) │  37 mm de arco, 0,52–1,83 s
   └────────────┼────────────┘  ← aquí ocurren las «pasadas rozadas»
                │
   ┌────────────┼────────────┐  DESPEGUE          26 – 34°
   │ Riel h_t → h_t + 4,42   │  Pendiente 11,9°
   │                         │  Par de trepada: 66 mN·m
   └────────────┼────────────┘
                │
   ┌────────────┼────────────┐  MESETA PLANA      34 – 43°
   │ 11,8 mm de AIRE         │  ★ TODAS las inversiones,
   │ 31,4 mm de arco         │    aceleraciones y frenadas
   │ Reposo / cuna caliente  │    ocurren AQUÍ, en el aire
   └────────────┼────────────┘
                │
              ±43°  topes M4 cautivos en agujeros ciegos
```

### 2.3 El ciclo de una pasada

```
  aterrizaje         CARICIA           descarga    despegue    meseta
  ┌────────┐  ┌──────────────────┐  ┌────────┐  ┌───────┐  ┌─────────┐
  │0→400 mN│  │   400 mN CONSTANTE│  │400→0 mN│  │ aire  │  │ inversión│
  │0,5–1,8s│  │  199 mm · 6,6 s   │  │0,5–1,8s│  │       │  │ + hueco  │
  └────────┘  └──────────────────┘  └────────┘  └───────┘  └─────────┘
       ↑                                                          ↓
       └──────────────── 2,6–5,2 s SIN CONTACTO ──────────────────┘
                  (medido en simulación, ver §3)

  Cada 4 pasadas: el carro radial mueve la bisagra ≥ 6 mm,
  solapando con el último 20 % de la pasada anterior para que
  el roce de las fibras enmascare el ruido del 28BYJ‑48.
```

### 2.4 Cadena de fallo seguro

```
   CUALQUIERA de estos eventos           →  desenergiza el motor
   ───────────────────────────              │
   · fin de los 15 min (firmware)           │
   · TPL5010 one-shot 1020 s (hardware)     ▼
   · pulsador NC enclavable          ┌──────────────────┐
   · corte de red / tirón del USB    │  Q1 corta VM del │
   · brownout                        │     TMC2209      │
   · watchdog                        └────────┬─────────┘
   · firmware colgado                         │
                                              ▼
                            El contrapeso de 360 g impone
                            247 mN·m contra 180 mN·m de
                            resistencia peor caso = 1,37×
                                              │
                                              ▼
                            La brocha se retira a 98 mm/s
                            y aparca en su cuna, fuera del cuerpo

   ★ Mantener la brocha SOBRE la piel exige que el motor
     tire ACTIVAMENTE contra el peso. El reposo del sistema
     es «retirado», no «apoyado».
```

---

## 3. CIFRAS VERIFICADAS POR SIMULACIÓN

`simulacion/test_movimiento.cpp` reproduce el generador de movimiento sin dependencias de Arduino. Compilado con `g++ -O2 -Wall -Wextra` y **ejecutado** sobre 200 sesiones con semillas distintas y 10⁶ sorteos del proceso OU:

| Magnitud | Contrato | Medido |
|---|---|---|
| Velocidad en contacto | 2,0–7,0 cm/s | **2,07–7,00 cm/s** ✅ |
| Velocidad máxima real del PIO | ≤ 10 cm/s | **7,53 cm/s** ✅ |
| Tope duro del hardware (petición infinita) | ≤ 10 cm/s | **9,31 cm/s** ✅ |
| Intervalo mínimo emitido | ≥ 240 µs | **252 µs** ✅ |
| Hueco real sin contacto | 1,5–5,5 s | **2,59–5,23 s** ⚠️ (ver §4) |
| Separación mínima entre radios | ≥ 6,00 mm | **6,00 mm** ✅ |
| Pasadas por sesión | ~64 | **51 / 64,6 / 78** (mín/media/máx) |
| Último golpe | ≤ 860 s | **856,8–860,0 s** ✅ |
| Camino sobre la piel | ~19 m | **14,15 m** |

---

## 4. VEREDICTO HONESTO

> **No va a sentirse como una pluma.** Se sentirá como una brocha de maquillaje grande y suave arrastrada lentamente por una mano paciente y algo mecánica — y ese *es* el objetivo correcto, por lo explicado en §0.

**Lo que sí entrega, y es genuinamente raro de conseguir:** contacto tibio de 52 mm a 400 mN, deslizando a 2–7 cm/s, con 0,4–1,0 µm de rizado residual contra un umbral vibrotáctil de 5–20 µm (es decir, **vibración imperceptible**), aterrizando en 0,5–1,8 s con perfil coseno alzado para que la derivada de la fuerza sea cero en los extremos (**nunca hay un contacto brusco tipo insecto**), despegando por completo antes de cada inversión, y con 2,6–5,2 s de nada real entre pasadas.

**Dónde se queda corto frente a una mano humana con una pluma, sin adornos:**

1. **Una sola forma de trayectoria, siempre.** Un arco de radio 300 mm con una flecha de 16,3 mm. Sin eses, sin diagonales, sin espirales, sin seguir tu contorno.
2. **La dirección alterna en cada pasada.** Una persona repite en el mismo sentido. Esta mecánica no puede, porque no hay riel sobre el centro del barrido.
3. **Sin modulación de presión dentro de la pasada.** La fuerza es un lastre de latón. El único control de amplitud son las pasadas rozadas que invierten dentro del taper (150–300 mN).
4. **La flecha de 16,3 mm hace rodar el contacto ~24°** alrededor de un antebrazo a mitad de pasada, lo que baja la fuerza normal ~9 % y añade un ligero arrastre lateral de las cerdas. No es desagradable, pero no es lo que hace una mano.
5. **Temperatura: 26–30 °C en las puntas, no los 32 °C del óptimo.** La cuna calefactada arregla el primer contacto de la noche; la brocha se enfría en cada hueco. Aproximadamente la mitad del déficit de Ackerley queda abierto.
6. **No hay agencia ni anticipación.** Una mano se detiene, cambia de idea, levanta y aterriza donde no esperas. La irregularidad de esta máquina es un paseo de Ornstein‑Uhlenbeck sobre seis parámetros: estadísticamente irregular pero estructuralmente predecible. **A los diez minutos, un cerebro lo habrá modelado.**

**Las dos formas en que esto falla de verdad:**

- **La insidiosa:** la brocha se apelmaza con la grasa de la piel; como la rigidez de punta es cero, la fuerza se mantiene clavada en 400 mN mientras la huella se encoge. El percepto deriva, invisiblemente y a lo largo de semanas, de caricia ancha hacia cosquilleo puntual. **Por eso los dos cabezales y la comprobación con báscula no son opcionales.**
- **La desconocida:** 64 pasadas sobre una banda de 118 mm pueden aplanarse igual en el minuto 8. La literatura no lo dice. Si pasa, el arreglo es **un tercer eje, no más firmware.**

**Realismo, puntuado con honestidad: 8/10 los primeros cinco minutos, y no demostrado a partir del minuto 8.**

---

## 5. ¿HACE FALTA UN ESP32?

**No.** Ver `04-electronica.md` §1 para el razonamiento completo. Resumen:

- **RP2040‑Zero (elegido, ~4,50 €).** Su **PIO** permite compilar un intervalo mínimo de paso de 240 µs que el código de aplicación **no puede saltarse**: es un tope de velocidad físico, no un `if` que un bug pueda esquivar. Esa es la única razón por la que se elige, y es una razón de seguridad.
- **ESP32.** Aporta WiFi y BLE, que este proyecto no usa. Más consumo, más ruido de radio junto a la cabeza, y sin PIO. **Innecesario.**
- **Arduino Nano.** Funciona, y hay una variante documentada para quien ya tenga uno. Se pierde el tope de velocidad por hardware, que pasa a ser una comprobación software.

---

## 6. ÍNDICE DE DOCUMENTOS

| Documento | Contenido |
|---|---|
| `01-concepto.md` | Este documento: concepto, comparativa, diagramas, veredicto honesto |
| `02-mecanica.md` | Lista de corte, planos, tabla del riel grado a grado, 32 pasos de montaje |
| `03-bom.md` | BOM completa con precios, alternativas, presupuesto eléctrico |
| `04-electronica.md` | Esquema, tabla de pines, cadena de seguridad hardware, registros del TMC2209 |
| `05-algoritmo-movimiento.md` | Ornstein‑Uhlenbeck, los seis ejes de variación, pseudocódigo, presets |
| `06-seguridad.md` | FMEA, las cinco capas de parada, contraindicaciones, advertencias |
| `07-parametros-ajuste.md` | Cómo hacerlo más suave / más intenso / más lento |
| `08-v2.md` | Qué haría distinto una versión 2 |
| `firmware/pluma_relax/` | Firmware completo para RP2040‑Zero |
| `simulacion/` | Banco de pruebas del algoritmo, compilable y ejecutable en el PC |
