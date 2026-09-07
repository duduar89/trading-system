# PLUMA-R — 05 · ALGORITMO DE MOVIMIENTO NATURAL

**Documento 5 de la serie. Contrato numérico: `final_spec.md`. Hermanos: `02-mecanica.md`, `03-bom.md`, `04-electronica.md`.**

Este es el corazón perceptual del proyecto. La mecánica decide *cuánta fuerza* y *qué forma* tiene el arco; este documento decide **cuándo, a qué velocidad, dónde y con qué irregularidad** se aplica. Es el único subsistema que puede hacer que la máquina siga siendo agradable en el minuto 12.

Unidades: mm, s, cm/s para velocidad de punta, mN para fuerza, grados para ángulo de barrido φ. Decimales con coma. El código va en punto decimal porque es código.

---

## ÍNDICE

0. [Resumen ejecutivo y correcciones a la especificación](#0)
1. [Por qué izquierda-derecha-izquierda-derecha destruye el efecto](#1)
2. [El proceso de Ornstein-Uhlenbeck como generador](#2)
3. [Los seis ejes de variación](#3)
4. [Estructura de sesión: 4 bloques de 3,75 min](#4)
5. [Pseudocódigo completo del generador](#5)
6. [Tabla maestra de parámetros ajustables](#6)
7. [Tres presets: más suave, más intenso, más lento](#7)
8. [Lo que esta mecánica NO puede variar](#8)
9. [Semilla aleatoria: por qué y cómo](#9)
10. [Puesta en marcha y verificación del algoritmo](#10)
11. [Contradicciones encontradas en la especificación vinculante](#11)

---

<a name="0"></a>
## 0. RESUMEN EJECUTIVO Y CORRECCIONES

### 0.1 Qué hace el algoritmo, en cinco líneas

Cada pasada dura entre 3,9 y 13,6 s y se ejecuta a **velocidad constante**. Entre pasadas hay un hueco de 1,4–5,5 s **sin ningún contacto**. Antes de cada pasada, un proceso de Ornstein-Uhlenbeck (OU) sortea la velocidad de la siguiente; un sorteo uniforme acotado elige el hueco; una regla dura de separación mínima elige el nuevo radio del carro; y un Bernoulli decide si la pasada será completa (400 mN, 273 mm de contacto) o **rozada** (150–300 mN, 27–55 mm, confinada en la zona de descarga del riel). La sesión son 4 bloques de 3,75 min con medias de velocidad distintas, con rampa de entrada y de salida construidas con pasadas rozadas y con la propia reversión a la media del OU.

### 0.2 Cifras de salida verificadas por simulación

He simulado 400 sesiones completas de 900 s con la geometría del contrato (script en `scratchpad/sim5.py`). Resultados medios:

| Magnitud | Simulado | Contrato (`final_spec.md`) | Veredicto |
|---|---|---|---|
| Pasadas completas por sesión | **65,4** (rango 55–76) | 64 | ✅ coincide |
| Pasadas rozadas por sesión | **12,1** | no cuantificado | — |
| Periodo entre pasadas completas | **13,76 s** | 13,9 s | ✅ coincide |
| Periodo entre eventos (completas + rozadas) | **11,6 s** | — | — |
| Camino recorrido sobre piel | **18,3 m** | «~19 m» | ✅ dentro del 4 % |
| Hueco medio real | **3,57 s** (p10 2,29 · p50 3,50 · p90 5,09) | banda 1,5–5,5 s | ✅ |
| Velocidad media de punta | **3,38 cm/s** | nominal 3,0 (media OU) | ⚠️ ver C-04 |
| Salto radial medio \|ΔR\| | **7,70 mm** | ≥ 6 mm de regla dura | ✅ |
| Banda de piel mojada | **118 mm** | 118 mm | ✅ |
| Uniformidad del histograma de R | máx 1,17× media, mín 0,72× media | «histograma de cobertura» | ✅ dentro de 1,6× |

Que el periodo de pasada completa simulado (13,76 s) reproduzca el 13,9 s del contrato **sin haberlo forzado** es la mejor validación cruzada que tiene este documento: sale de sumar arco de contacto, tiempo de vuelo por el riel y el tiempo que tarda el carro radial en moverse. La coincidencia también resuelve una aparente contradicción del contrato (ver C-01).

### 0.3 Correcciones a la especificación vinculante

He encontrado **ocho** puntos de `final_spec.md` que no cierran. Los corrijo aquí en voz alta, como hizo `02-mecanica.md` en su §0.1.

| # | Dice la spec | Problema | Corrección adoptada |
|---|---|---|---|
| **C-01** | «Ciclo 13,9 s a 3 cm/s, 64 pasadas» y a la vez huecos de 1,5–5,5 s (media 3,5 s) | 272,3 mm de contacto a 3 cm/s son 9,08 s; +3,5 s de hueco = **12,6 s**, no 13,9 s | Los 13,9 s son correctos **una vez se incluye el estiramiento del hueco por el movimiento del carro radial**. Hueco medio real 3,57 s pero con suelo dinámico. §3.6 |
| **C-02** | «Rampa de aterrizaje 0,6–2,5 s» | 36,65 mm de zona de descarga (19–26°) recorridos a 2,0–7,0 cm/s dan **0,52–1,83 s**. Para 2,5 s harían falta 1,47 cm/s, por debajo del suelo de 2,0 cm/s del propio contrato | **La rampa es una magnitud DERIVADA, no un eje independiente: t_rampa = 36,65 / v.** Rango real **0,52–1,83 s**. Coincide con la corrección C6 de `02-mecanica.md` |
| **C-03** | «El punto de inversión mueve el segmento de fuerza plena ±16 mm a lo largo del arco» | **Falso.** El riel está atornillado a la columna: las zonas de contacto están definidas por el ángulo φ, que es fijo respecto a la máquina. Invertir a 35° o a 41° no mueve ni un milímetro la huella sobre la piel | El jitter de inversión se conserva porque es gratis y **desordena el ritmo**, pero **NO aporta migración de trayectoria**. La única migración real es el carro radial. §3.4 |
| **C-04** | «Velocidad nominal 3,0 cm/s (media OU)» y bloques a 3,2 / 2,6 / 4,1 / 2,9 | Media aritmética de los bloques 3,20; y con reflexión en el suelo de 2,0 cm/s la media realizada sube otros ~0,1 → **3,38 cm/s medidos** | Se declara la media de sesión real: **3,3–3,4 cm/s**. Si se quiere clavar 3,0, usar el preset «más lento» o bajar las medias de bloque a 3,0/2,4/3,7/2,5 (§7) |
| **C-05** | «Hueco fijado puramente por el dwell en la meseta, totalmente desacoplado de la velocidad de pasada» | Si la zona de despegue (26–34°, 41,9 mm) se recorre a la velocidad de pasada, cruzarla ida y vuelta cuesta **4,7 s a 2 cm/s**: el hueco mínimo de 1,5 s es imposible y el desacoplo es falso | Se introduce una **velocidad de vuelo `v_fly` independiente (8 cm/s por defecto)** para todo el trayecto fuera de la piel. Con ella el suelo geométrico del hueco baja a **1,40 s** y el desacoplo sí es real. §3.2 |
| **C-06** | «IHOLD 0,05 A para dwells cortos en el lado lejano» | El contrapeso tira siempre hacia +43°. Sostener la botavara en la meseta lejana pide 247 mN·m / 14,29 = **17,3 mN·m en el motor**; 0,05 A dan ~5,2 mN·m. La botavara **se escaparía hacia la piel durante el hueco** | **IHOLD_lejano = 0,18 A** (≈11,7 mN·m, más los ~8 mN·m de detente = 1,1× de margen). Y regla de algoritmo: **todos los parkings largos (>6 s) se programan en el lado del reposo**, nunca en el lejano. §3.2 y §4.4 |
| **C-07** | «Precalentamiento de 60 s con la brocha ya apoyada en la piel antes de empezar» | Mantener la botavara a φ=0 contra el contrapeso exige ~0,25 A durante 60 s: zumbido permanente, 1,2 W, y un contacto estático de 400 mN cuya señal aferente CT **cae a cero en 5 s**. Perceptualmente muerto y eléctricamente caro | **El precalentamiento se hace en la cuna calefactada a 35 °C**, motor desenergizado, fuera de los 900 s. Es exactamente para eso que existe la cuna. Contacto estático sobre piel: máximo 10 s, opcional. §4.2 |
| **C-08** | «Meseta 33–40°, 37 mm, inversión en cualquier punto (±16 mm)» vs `02-mecanica.md` C2 «meseta 34–43°, 31,4 mm» | A R=300 mm, 9° son 47,1 mm, no 31,4. Los dos documentos parecían contradecirse | **Se reconcilian:** la meseta física es 34–43° (47,1 mm), pero la **ventana utilizable de inversión** es 35–41° (6° = **31,42 mm = ±15,7 mm ≈ ±16 mm**), dejando 1° de guarda contra el tope y 2° contra la zona de despegue. Los dos documentos dicen lo mismo |

Además, **dos adiciones** que la especificación no contempla:

- **A-01 · Velocidad de vuelo `v_fly`.** Séptimo grado de libertad, invisible para la piel, imprescindible para que el hueco sea de verdad independiente de la velocidad de pasada (C-05). Por defecto **7,5 cm/s** (`V_VUELO_MMS`), porque el techo real no es el clamp nominal de 10 cm/s sino el suelo compilado del PIO de 240 µs, que a R = 275 mm son 7,87 cm/s.
- **A-02 · Planificador del carro radial acoplado al hueco.** El 28BYJ-48 mueve 2 mm/s. Un salto de R de 25 mm tardaría 12,5 s: más que cualquier hueco. Sin un cap dinámico de ΔR el sistema **se bloquea o se sale del gálibo temporal**. §3.6 da el planificador exacto.

---

<a name="1"></a>
## 1. POR QUÉ IZQUIERDA-DERECHA-IZQUIERDA-DERECHA DESTRUYE EL EFECTO

Es tentador escribir el firmware más simple posible: barrer de +19° a −19° a 3 cm/s, esperar 3 s, volver. Ese firmware cabe en 40 líneas y **produce una máquina que deja de sentirse a los dos minutos**. Hay tres mecanismos independientes que la matan, y los tres están medidos en la literatura.

### 1.1 Mecanismo 1 — Habituación afectiva («touch satiety»), medible en ~2 minutos

La investigación es inusualmente concreta aquí:

- La habituación a la caricia continua **«ocurre rápidamente, con reducciones significativas de placer/intensidad percibidos dentro de los dos primeros minutos»**.
- Triscoli et al. (2014, PLOS ONE, 50 min de caricia en antebrazo) encontraron saciedad táctil: a los 40–50 min la misma caricia se puntúa neutra o ligeramente desagradable. Y el dato decisivo: **el declive fue significativo SÓLO a 3 cm/s**. A 0,3 cm/s y a 30 cm/s no hubo declive.
- Schienle et al. (2025, n=81, 10 min continuos, valoración cada 100 s) confirman el declive con una **varianza interindividual enorme**; menos de la mitad de las personas habitúan de forma significativa.

Léelo despacio: **la velocidad exacta a la que la caricia es más placentera (3 cm/s) es también la única a la que se midió saciedad significativa.** Una máquina que barre eternamente a 3,0 cm/s clavados está ejecutando literalmente el protocolo experimental de la saciedad táctil. Los 15 min están dentro de la ventana buena, pero sólo si el estímulo no es el mismo estímulo 64 veces.

El corolario de diseño no es estético, es funcional: **la irregularidad es carga estructural del diseño, no decoración.** Y hay una consecuencia concreta que casi nadie deduce: como el declive se midió a 3 cm/s y *no* a 0,3 ni a 30, **excursiones programadas fuera de la banda de 3 cm/s son terapéuticas**, no un compromiso. El bloque 3 a 4,1 cm/s de media existe por esto.

### 1.2 Mecanismo 2 — El cerebro modela el estímulo y lo atenúa

Aquí hay que ser preciso, porque la explicación popular es incorrecta.

**Lo que NO pasa:** la cancelación por copia eferente. Ese mecanismo (el que hace que no puedas hacerte cosquillas a ti mismo, Blakemore et al.) requiere que tú generes el movimiento. Una máquina externa no produce copia eferente, así que **el estímulo llega a ganancia completa**. Esto es bueno: no hay atenuación motora.

**Lo que SÍ pasa:** codificación predictiva sobre un estímulo *externo periódico*. Un tren de eventos isócronos se vuelve predecible en cuanto el sistema tiene unas pocas repeticiones: los intervalos entre inicios de pasada de un firmware ingenuo tienen **entropía cero**. El sistema nervioso construye un modelo temporal directo del estímulo, y la respuesta cortical a un evento perfectamente predicho se atenúa (supresión por repetición, adaptación específica de estímulo). En un ciclo fijo de 12,0 s, los dos primeros minutos son 10 ciclos: más que de sobra.

Y hay una tensión que el algoritmo debe respetar, no ignorar. Blakemore también establece que **la cosquilla es proporcional al error de predicción**. Es decir:

```
  poca sorpresa  ──────────────────────────────────►  mucha sorpresa
  ─────────────────────────────────────────────────────────────────
  aburrimiento          ZONA ÚTIL                cosquilleo (knismesis)
  habituación      "irregular pero benigno"      sobresalto, despertar
  ─────────────────────────────────────────────────────────────────
        ▲                    ▲                          ▲
   L-D-L-D fijo      lo que queremos            ruido blanco puro
```

De ahí la regla maestra de todo este documento, que sale directamente del informe de investigación:

> **Varía los parámetros ENTRE pasadas y mantenlos casi constantes DENTRO de cada pasada.**

Una pasada es un evento con onset, cuerpo y offset. Dentro de la pasada el cerebro tiene que poder predecir sin esfuerzo (velocidad constante, fuerza constante, sin escalones). Entre pasadas, no.

### 1.3 Mecanismo 3 — Abrasión de una única franja de piel y alloknesis

Este es el que menos se anticipa y el que peor envejece.

Con un firmware de trayectoria fija, la sesión son ~75 pasadas × 273 mm = **20,5 m de frotamiento sobre una única franja de 52 mm de ancho**, es decir sobre unos 14 000 mm² de piel. La literatura de desgaste (Wear, 2016) mide las consecuencias del contacto friccional repetido: delaminación progresiva del estrato córneo, **descenso del módulo de Young de la piel, aumento de la pérdida transepidérmica de agua, aumento del flujo sanguíneo y enrojecimiento**.

Y luego el remate: la revisión de alloknesis (picor mecánico) dice que **en piel normal la caricia ligera produce cosquilla pero no picor, mientras que sobre piel seca, sensibilizada o irritada la misma caricia ligera evoca picor**. O sea: la máquina de trayectoria fija **se fabrica a sí misma, noche a noche, la piel sobre la que dejará de funcionar**. Empieza como caricia y acaba como picor. Es un fallo lento, acumulativo y difícil de diagnosticar porque no hay ningún componente roto.

Y hay un tercer efecto en la misma franja: la **adaptación del propio aferente CT**. Los datos son duros. A una indentación estática, el CT responde con una ráfaga inicial y **cae a cero en menos de 5 s**; la adaptación empieza hacia los 4 s; hay post-descarga de **1–5 s** tras retirar el estímulo; y con cepillado repetido a velocidades lentas las respuestas disminuyen con el tiempo. De aquí salen dos números del contrato que ahora se entienden:

- **La brocha no puede quedarse quieta sobre la piel más de ~4 s.** Un dwell estático largo no es una pausa, es tiempo tirado y aferentes agotados.
- **El hueco de 1,5–5,5 s no es arbitrario:** es exactamente la ventana de post-descarga y recuperación del CT. Menos de 1,5 s y el aferente aún no se ha recuperado; más de 5,5 s y la post-descarga se ha extinguido y la siguiente pasada llega a un lienzo frío (que a veces es lo que quieres, de ahí los parkings largos programados).

### 1.4 Cuánto compra realmente la migración lateral — con honestidad

Aquí hay que dar un número incómodo. El carro radial mueve la trayectoria ±25 mm, o sea una banda de 50 mm. **La brocha carga 52 mm de ancho.** Como la brocha es más ancha que la banda de migración, las líneas de piel centrales **siguen siendo tocadas por casi todas las pasadas**. El carro no reduce el número de contactos en el centro.

Lo que sí hace, y es lo que importa:

1. **Mueve el pico de presión.** Una kabuki redonda no aplica presión uniforme sobre sus 52 mm: el perfil es abombado, con el máximo en el centro y prácticamente cero en los bordes. Ponderando la dosis por ese perfil parabólico, la dosis en la línea central pasa de N a **0,69·N**: un factor **1,45×** de alivio. Y si miras sólo el decil de presión más alta (los ~20 mm centrales de la huella), la dosis cae de N a **0,40·N**: un factor **2,5×**.
2. **Cambia la población de aferentes que ve el pico.** Un campo receptor CT mide **1–35 mm²** (1–9 puntos sensibles), es decir de ~1 a ~6,7 mm de diámetro. **Un salto de 6 mm mueve el pico de presión aproximadamente un campo receptor entero.** Ese es el origen físico del número «6 mm» de la regla dura, y es la razón de que no sea 3 mm ni 15 mm.
3. **Ensancha la banda mojada de 68 a 118 mm** (52 de brocha + 16,3 de sagita + 50 de carro), repartiendo el desgaste del estrato córneo sobre un 74 % más de superficie.
4. **Cambia la longitud de la pasada** de 182 a 216 mm (porque el arco es φ·R y R varía), así que también los extremos longitudinales de la huella se mueven ±8,5 mm.

**Conclusión honesta:** el carro radial es imprescindible y es la única migración real que tiene la máquina, pero su beneficio cuantificado es un factor 1,45–2,5× sobre la dosis ponderada, no un factor 10. Si en las pruebas la sensación se aplana en el minuto 8, la respuesta correcta es ampliar el carro a ±40 mm o añadir un tercer eje, **no** más firmware.

### 1.5 Las cinco reglas que salen de todo esto

| # | Regla | De dónde sale |
|---|---|---|
| R1 | Velocidad **constante dentro** de cada pasada; sorteada **entre** pasadas | Blakemore (error de predicción) + adaptación CT |
| R2 | La media de velocidad debe **pasear por la banda 2–7 cm/s**, no clavarse en 3,0 | Triscoli: la saciedad se midió sólo a 3 cm/s |
| R3 | **Cero contacto** durante 1,4–5,5 s entre pasadas; nunca dwell estático sobre piel > 4 s | Adaptación CT: 0 en 5 s, post-descarga 1–5 s |
| R4 | La huella debe **migrar ≥ 6 mm** cada pasada respecto a las dos anteriores | Campo receptor CT 1–35 mm² ≈ 1–6,7 mm |
| R5 | El **ritmo** (periodo entre pasadas) no puede ser isócrono | Codificación predictiva / entropía cero |

Ninguna de las cinco es opcional y ninguna cuesta hardware. Las cinco caben en el generador de la §5.

---

<a name="2"></a>
## 2. EL PROCESO DE ORNSTEIN-UHLENBECK COMO GENERADOR

### 2.1 La ecuación

El proceso de Ornstein-Uhlenbeck es la ecuación diferencial estocástica

```
    dv = θ · (μ − v) · dt  +  σ · dW
         └──────┬──────┘     └──┬──┘
         reversión a la media   ruido
```

donde:

| Símbolo | Significado | Valor PLUMA-R |
|---|---|---|
| `v` | velocidad de punta de la próxima pasada | cm/s |
| `μ` | media de largo plazo hacia la que revierte | 2,6–4,1 cm/s según bloque |
| `θ` | tasa de reversión (1/tiempo) | `1/τ` = 1/6 por pasada = 0,1667 |
| `τ` | tiempo de correlación = `1/θ` | **6 pasadas** (~75 s) |
| `σ` | intensidad del ruido | ver §2.4: se parametriza por σ_∞ |
| `dW` | incremento de Wiener (ruido blanco gaussiano) | — |
| `dt` | paso de tiempo | **1 pasada** (el tiempo se mide en pasadas, no en segundos) |

**Punto crítico de implementación: aquí el tiempo se mide en PASADAS, no en segundos.** Es la decisión de modelado más importante del documento. Si midieras τ en segundos, una pasada rápida (3,9 s) y una lenta (13,6 s) avanzarían el proceso de forma distinta y la variabilidad dependería de la velocidad, que es justo la variable que estás sorteando. Con `dt = 1 pasada`, τ = 6 significa literalmente «la velocidad se olvida de dónde venía al cabo de unas 6 pasadas», que es una afirmación perceptual limpia y verificable.

### 2.2 Interpretación física

El OU es lo que obtienes si pones una partícula en un muelle dentro de un fluido viscoso y le pegas patadas aleatorias. El término `θ(μ−v)` es el muelle: siempre tira hacia μ, y tira más fuerte cuanto más lejos está. El término `σ·dW` son las patadas.

```
   v (cm/s)
   7 ┤ · · · · · · · · · · · · · · · · · · · ·  techo (reflexión)
     │                    ╭─╮
   5 ┤          ╭╮   ╭────╯ ╰╮      ╭──╮
     │    ╭─────╯╰───╯       ╰─╮  ╭─╯  ╰──╮
   3 ┤────╯ μ ..........................╰──╯     ╰────  ← reversión a μ
     │                                        ╰╮  ╭──
   2 ┤ · · · · · · · · · · · · · · · · · · · ·╰──╯      suelo (reflexión)
     └────────────────────────────────────────────────► nº de pasada
       0        10        20        30       40
       │←── τ=6 ──→│  correlación 0,85 con la pasada anterior
```

Tiene exactamente las dos propiedades que necesitamos a la vez, y es el proceso más simple que las tiene:

- **Deriva.** Dos pasadas consecutivas se parecen (ρ = 0,846), así que no hay saltos bruscos. La sensación es de una mano que va cambiando de ritmo, no de un conmutador.
- **Pero nunca se escapa.** La reversión a la media garantiza una distribución estacionaria acotada. No hace falta recortar, no hace falta vigilar, no hay deriva secular.

De hecho, por el teorema de Doob, **el OU es el único proceso gaussiano-markoviano estacionario**. Es decir: si quieres algo que sea a la vez suave (markoviano, sin memoria más allá del presente), estacionario (no deriva sin límite) y gaussiano, el OU no es *una* opción — es *la* opción. No hay que justificarlo más allá de eso.

### 2.3 Por qué NO ruido blanco y por qué NO un random walk puro

Esta es la comparación que justifica todo el capítulo.

| Propiedad | Ruido blanco (i.i.d. por pasada) | Random walk puro (Wiener) | **Ornstein-Uhlenbeck** |
|---|---|---|---|
| Ecuación | `v_n ~ U(2,7)` | `v_{n+1} = v_n + σ·N(0,1)` | `dv = θ(μ−v)dt + σdW` |
| Autocorrelación ρ(1) | **0** | ~1 (a corto plazo) | **0,846** |
| Salto típico entre pasadas | **1,67 cm/s** (56 % de la media) | 0,43 cm/s | **0,34 cm/s** (11 %) |
| Salto máximo posible | **5,0 cm/s** (2,0 → 7,0: un factor 3,5 de golpe) | ilimitado | ~1,3 cm/s (3σ del incremento) |
| Varianza a largo plazo | acotada, fija | **crece como σ²·n** → satura | **acotada y estacionaria** |
| Tras 64 pasadas | igual que al principio | desviación típica **3,4 cm/s** → pegado a los topes | idéntica distribución |
| Comportamiento en los topes | nunca los toca de forma correlada | **se queda pegado en 2,0 o en 7,0 durante decenas de pasadas** | los roza el 3–9 % de las veces y se despega |
| Espectro de potencia | plano (blanco) hasta Nyquist | 1/f² puro | **Lorentziano**: plano por debajo de 1/τ, 1/f² por encima |
| Modelo mental | dado de 6 caras | borracho sin farola | mano que cambia de ritmo poco a poco |
| Veredicto perceptual | error de predicción máximo → salience, cosquilla, sobresalto | **acaba siendo velocidad constante en un tope** = exactamente el fallo de Triscoli | ✅ |

Tres observaciones que merecen desarrollarse:

**El ruido blanco es peor de lo que parece.** Sortear cada pasada independientemente de U(2,7) da un salto medio de 1,67 cm/s entre pasadas consecutivas. Una pasada a 6,8 cm/s seguida de otra a 2,1 cm/s es un cambio de factor 3,2 en el ritmo, aterrizando sobre la misma piel 3 s después. Eso no se lee como «orgánico»: se lee como *avería*. Y por la ley de Blakemore, error de predicción alto = cosquilla, que es exactamente la percepción que estamos intentando evitar.

**El random walk puro se autodestruye.** Sin reversión a la media, la varianza crece linealmente con el número de pasos: σ_n = σ_paso·√n. Con σ_paso = 0,43 cm/s, tras las 64 pasadas de una sesión la desviación típica acumulada sería 0,43·√64 = **3,4 cm/s**, más ancha que toda la banda útil. En la práctica el paseo se pega a un tope y se queda ahí, y una vez pegado al tope el recorte lo convierte en **velocidad constante durante decenas de pasadas** — que es literalmente la condición experimental de la saciedad táctil. El random walk no es «más aleatorio»: es una máquina de fabricar constancia.

**El OU tiene el espectro correcto.** El informe de investigación pedía «un paseo aleatorio suave (Ornstein-Uhlenbeck / deriva 1/f)». El espectro de potencia del OU es Lorentziano: `S(f) ∝ 1/(θ² + 4π²f²)`. Por debajo de la frecuencia de esquina `f_c = θ/2π` (aquí, 1 cada 37,7 pasadas) es plano; por encima cae como 1/f². Eso significa que hay deriva lenta *real* en la escala de decenas de segundos —que es la escala en la que se nota— y suavidad en la escala de pasada a pasada. Es lo más cerca de 1/f que se consigue con dos líneas de código y sin memoria.

### 2.4 Discretización exacta (coma flotante)

El OU es una de las pocas SDE con solución exacta en tiempo discreto. **No uses Euler-Maruyama: cuesta lo mismo y es peor.**

Con paso `Δt = 1` pasada y `τ = 6`:

```
    a = exp(−Δt/τ) = exp(−1/6) = 0,846482
    b = sqrt(1 − a²) = sqrt(1 − 0,716532) = 0,532417

    v_{n+1} = μ + a·(v_n − μ) + σ_∞ · b · N(0,1)
```

donde **`σ_∞` es la desviación típica ESTACIONARIA del proceso**, no la intensidad del ruido de la SDE. Es la parametrización que hay que usar porque es la única que tiene significado perceptual directo: σ_∞ = 0,8 cm/s significa «el 68 % de las pasadas caen a ±0,8 cm/s de la media del bloque». La relación con la σ de la SDE es `σ_∞ = σ·sqrt(τ/2)`, o sea `σ = 0,8/sqrt(3) = 0,462`.

Con los valores del contrato (σ_∞ = 0,8 cm/s, τ = 6):

```
    v_{n+1} = μ + 0,846482·(v_n − μ) + 0,425933·N(0,1)
```

**Ese es todo el generador de velocidad.** Una línea.

Comparación con Euler-Maruyama, que sería `v_{n+1} = v_n + (1/6)(μ−v_n) + 0,8·sqrt(2/6)·N(0,1)` = `... + 0,461880·N(0,1)`: el coeficiente de ruido es un **8,4 % mayor**, la σ_∞ realizada sale un 4 % alta y la autocorrelación un poco baja. Es un error pequeño pero completamente gratuito de evitar.

**Propiedades derivadas, todas útiles para verificar la implementación:**

| Magnitud | Fórmula | Valor (σ_∞=0,8, τ=6) |
|---|---|---|
| Autocorrelación a k pasadas | `ρ(k) = a^k` | ρ(1)=0,846 · ρ(2)=0,717 · ρ(3)=0,607 · ρ(6)=0,368 · ρ(12)=0,135 |
| Desv. típica del incremento | `σ_∞·sqrt(2(1−a))` | **0,443 cm/s** |
| Salto medio \|Δv\| entre pasadas | `σ_∞·sqrt(2(1−a))·sqrt(2/π)` | **0,354 cm/s** (medido: 0,34) |
| Semivida de la desviación | `τ·ln2` | 4,16 pasadas ≈ 52 s |
| Frecuencia de esquina | `1/(2πτ)` | 1 cada 37,7 pasadas |
| Tiempo hasta olvidar el arranque | `3τ` | 18 pasadas ≈ 3,7 min |

Esa última fila tiene una consecuencia de diseño preciosa: **si arrancas el OU en `v_0 = 2,2 cm/s`, la propia reversión a la media te construye la rampa de entrada de la sesión gratis.** Llega al 63 % del camino hacia μ en 6 pasadas (~75 s) y al 95 % en 18. No hace falta programar una rampa: es el proceso.

### 2.5 Discretización en enteros (punto fijo, sin FPU)

El RP2040 no tiene FPU en hardware. La versión float funciona (la SDK usa rutinas software y esto se ejecuta **una vez por pasada**, o sea ~0,08 Hz — el coste es irrelevante), pero doy también la versión entera porque es determinista bit a bit, lo que hace que una semilla dada reproduzca **exactamente** la misma sesión en cualquier compilador. Eso importa para la reproducibilidad de las pruebas.

**Unidades:** velocidad en centésimas de cm/s, es decir en **décimas de mm/s**. `v = 300` ⇒ 3,00 cm/s. Banda: 200 … 700.

```
    a_q     = round(0.846482 × 65536) = 55476      // Q16
    s_q     = round(0.425933 × 100)   = 43         // en unidades de v, por σ=1
```

Gaussiana entera por Irwin-Hall (suma de 12 uniformes), que da media 6 y varianza 1 exactas:

```
    // 12 sorteos uniformes en [0, 4096) → suma S con media 24576, varianza 4096²
    // N(0,1) ≈ (S − 24576) / 4096
    int32_t S = 0;
    for (int i = 0; i < 12; i++) S += (rng_next() >> 20) & 0xFFF;   // 12 bits altos
    int32_t g = S - 24576;                                          // ≈ 4096·N(0,1)

    // OU exacto en Q16:
    int32_t dv = v - mu;                            // centésimas de cm/s
    v_next = mu + (int32_t)(((int64_t)a_q * dv) >> 16)
                + (int32_t)(((int64_t)s_q * g) >> 12);
```

Notas de implementación que evitan bugs reales:

- Usa los **bits altos** del PRNG (`>> 20`), nunca los bajos. Los bits bajos de un LCG son casi periódicos; los de xoshiro no, pero coger los altos es gratis y te protege si algún día cambias de generador.
- El `>> 12` de la última línea divide por 4096, que es exactamente el factor de escala de Irwin-Hall. Combinado con `s_q = 43` (que son 0,43 cm/s ×100) da el ruido correcto.
- Irwin-Hall recorta la gaussiana en ±6σ. Irrelevante: a ±6σ estás a 2,6 cm/s de la media, muy fuera de la banda, y la reflexión ya actúa mucho antes.
- Coste: 12 llamadas al PRNG + 2 multiplicaciones de 64 bits, **una vez por pasada**. Del orden de 3 µs. Nada.

Verificación obligatoria en banco: ejecuta 100 000 iteraciones del generador entero y comprueba media = μ ± 0,02, desviación típica = 0,80 ± 0,02 y ρ(1) = 0,846 ± 0,005. Si ρ(1) sale ~0,5 tienes un `>>` mal puesto.

### 2.6 Reflexión, no recorte — y por qué importa mucho más de lo que parece

La banda útil es 2,0–7,0 cm/s. Con μ = 3,2 y σ_∞ = 0,8, el suelo está a sólo 1,5σ. El proceso lo va a tocar. Hay dos formas de tratarlo y **una de ellas arruina el diseño**:

```
  RECORTE (mal):                      REFLEXIÓN (bien):
    if (v < 2.0) v = 2.0;               while (v < 2.0) v = 4.0 − v;
                                        while (v > 7.0) v = 14.0 − v;

  v                                    v
  3 ┤╮                                 3 ┤╮      ╭
  2 ┤╰────────────╮  ← 6 pasadas       2 ┤╰╮  ╭──╯  ← rebota y sigue
    │  a 2,00 EXACTOS                    │ ╰──╯       variando
    └──────────────►                     └──────────►
```

El recorte produce **series de pasadas consecutivas a exactamente 2,00 cm/s**. Con μ=2,6 eso ocurre en el 9 % de los sorteos, y como el proceso está correlado (ρ=0,846) los toques vienen en rachas: tres, cuatro, cinco pasadas seguidas a velocidad idéntica. Es decir, **el recorte reintroduce justamente la constancia que todo el OU existe para evitar**, y lo hace en el sitio más visible.

La reflexión no tiene ese problema: el valor rebota a `2·límite − v`, que es un valor distinto cada vez, y el proceso sigue paseando. Cuesta un `while` de dos líneas.

**Efecto medido de la reflexión** (120 000 pasadas simuladas por caso):

| μ nominal | Media realizada | σ realizada | \|Δv\| medio | % de toques de borde |
|---|---|---|---|---|
| 2,6 | 2,895 | 0,600 | 0,325 | **9,1 %** |
| 2,9 | 3,074 | 0,661 | 0,334 | 5,8 % |
| 3,0 | 3,157 | 0,681 | 0,338 | 4,8 % |
| 3,2 | 3,304 | 0,711 | 0,342 | 3,3 % |
| 4,1 | 4,112 | 0,785 | 0,353 | 0,3 % |

Lee la primera columna con cuidado: **la reflexión sesga la media hacia arriba**, entre +0,01 y +0,30 cm/s, porque el suelo (2,0) está mucho más cerca que el techo (7,0). Es el origen de la corrección C-04. Si necesitas clavar una media de sesión, **pon μ unos 0,15–0,30 cm/s por debajo del objetivo** en los bloques lentos. La tabla de arriba es la tabla de calibración.

### 2.7 Modo logarítmico (opcional, recomendado si vas a experimentar)

La banda 2–7 cm/s es asimétrica alrededor de 3: hay 1,0 cm/s de margen por abajo y 4,0 por arriba. Una gaussiana simétrica no encaja bien en eso, y por eso los bloques lentos rebotan el 9 % de las veces.

La percepción de velocidad es aproximadamente logarítmica (Weber), así que la solución elegante es correr el OU en `u = ln(v)`:

```
    u_{n+1} = ln(μ) + a·(u_n − ln μ) + σ_u · b · N(0,1)
    v_{n+1} = exp(u_{n+1})                    // reflexión en ln(2,0) y ln(7,0)
```

Con **σ_u = 0,25** (25 % relativo). La calibración es exacta en el punto nominal: 0,25 × 3,2 cm/s = **0,80 cm/s**, o sea el modo log coincide con el contrato en el punto de trabajo y degrada mejor en los extremos.

| μ | Modo lineal σ=0,8: media / σ / bordes | Modo log σ_u=0,25: media / σ / bordes |
|---|---|---|
| 2,6 | 2,895 / 0,600 / 9,1 % | **2,825 / 0,607 / 6,2 %** |
| 3,2 | 3,304 / 0,711 / 3,3 % | **3,347 / 0,810 / 1,8 %** |
| 4,1 | 4,112 / 0,785 / 0,3 % | 4,189 / 0,989 / 1,1 % |

El modo log toca los bordes la mitad de veces, mantiene una variabilidad *relativa* constante en todos los bloques (que es lo que se percibe) y respeta la σ del contrato en el punto nominal. **Por defecto se deja el modo lineal porque es lo que dice el contrato; el modo log está implementado y se activa con un flag.** Si el usuario nota que el bloque 2 «se atasca en lento», el modo log es la primera cosa que probar.


---

<a name="3"></a>
## 3. LOS SEIS EJES DE VARIACIÓN

### 3.0 El mapa de zonas: sin esto no se entiende nada

Todo el algoritmo vive sobre esta geometría, que es **fija y mecánica**. El ángulo de barrido φ se mide desde el centro; la máquina es simétrica, así que hay una copia de estas zonas a cada lado.

```
  φ =  0°        19°       26°       34°          43°
       │          │         │         │            │
  ─────┼──────────┼─────────┼─────────┼────────────┼──────────►  φ
       │  ZONA A  │ ZONA B  │ ZONA C  │   ZONA D   │  tope M4
       │  PLENA   │ DESCARGA│ DESPEGUE│   MESETA   │  + cuna 35°C
       │          │ (taper) │         │            │
  N =  │  400 mN  │400→0 mN │   0     │     0      │     0
  arco │ 99,48 mm │36,65 mm │41,89 mm │  47,12 mm  │
  desde│          │         │         │            │
  φ=0  0 ──── 99,48 ─── 136,14 ─── 178,02 ──── 225,15 mm   (a R=300)

  aire   0        0        0→11,8   11,8 mm    → dentro de la cuna
  libre                     mm       (constante)

                            ├──── ventana de inversión ────┤
                                  35°  ──────────  41°
                                   6° = 31,42 mm = ±15,7 mm
```

Cifras que se usan a lo largo de todo el documento (R = 300 mm nominal):

| Magnitud | Fórmula | Valor |
|---|---|---|
| Arco de fuerza plena (ida y vuelta) | `2·19°·π/180·R` | **198,97 ≈ 199 mm** |
| Arco de una zona de descarga | `7°·π/180·R` | **36,65 mm** |
| Arco de contacto total por pasada | `199 + 2×36,65` | **272,3 ≈ 273 mm** |
| Arco de una zona de despegue | `8°·π/180·R` | **41,89 mm** |
| Meseta completa | `9°·π/180·R` | 47,12 mm |
| Ventana útil de inversión (35–41°) | `6°·π/180·R` | **31,42 mm (±15,7 mm)** |
| Sagita del arco | `R·(1−cos 19°)` | **16,34 mm** |
| Fuerza dentro de la descarga | `400·(26−φ)/7` mN | 400 mN en 19°, 0 en 26° |

Y las cifras que cambian con el carro radial:

| R (mm) | Arco fuerza plena | Arco de contacto | Sagita | mm por paso completo |
|---|---|---|---|---|
| 275 (carro a −25) | 182,4 mm | 249,6 mm | 14,98 mm | 0,6047 |
| 300 (centro) | 198,97 mm | 272,3 mm | 16,34 mm | 0,6597 |
| 325 (carro a +25) | 215,6 mm | 295,0 mm | 17,71 mm | 0,7147 |

**Consecuencia para el firmware:** `ω = v_punta / R`. Cada vez que cambia R hay que reescalar la velocidad angular, o el usuario notará que la punta va un 8 % más rápida en un extremo del carro que en el otro.

---

### 3.1 EJE 1 — Velocidad de pasada (OU, τ = 6 pasadas, σ = 0,8)

| | |
|---|---|
| **Rango** | 2,0 – 7,0 cm/s (banda CT útil) |
| **Distribución** | Ornstein-Uhlenbeck gaussiano, estacionario, con reflexión en los bordes |
| **Parámetros** | μ = por bloque (2,6 / 2,9 / 3,2 / 4,1) · σ_∞ = 0,8 cm/s · τ = 6 pasadas |
| **Cuándo se sortea** | Una vez, justo antes de arrancar cada pasada |
| **Dentro de la pasada** | **CONSTANTE.** Cero aceleración sobre piel. Innegociable |
| **Tope duro** | 10 cm/s por suelo de tiempo compilado en el PIO (§5.7) |

**Cómo se realiza físicamente.** La velocidad de punta se convierte en frecuencia de paso:

```
    pasos_completos/s = v_punta [mm/s] / (0,6597 · R/300)
```

| v (cm/s) | Pasos comp./s | µpasos/s (1/32) | rpm motor | t rampa aterrizaje | t contacto | Rizado residual de punta |
|---|---|---|---|---|---|---|
| 2,0 | 30,3 | 970 | 9,1 | **1,83 s** | 13,62 s | 0,96 µm |
| 2,5 | 37,9 | 1 213 | 11,4 | 1,47 s | 10,89 s | ~0,65 µm |
| **3,0** | **45,5** | **1 455** | **13,6** | **1,22 s** | **9,08 s** | **0,43 µm** |
| 4,0 | 60,6 | 1 939 | 18,2 | 0,92 s | 6,81 s | ~0,25 µm |
| 5,0 | 75,8 | 2 424 | 22,7 | 0,73 s | 5,45 s | ~0,16 µm |
| 6,0 | 91,0 | 2 911 | 27,3 | 0,61 s | 4,54 s | ~0,11 µm |
| 7,0 | 106,1 | 3 395 | 31,8 | **0,52 s** | 3,89 s | 0,08 µm |
| 7,5 (`v_fly`) | 113,7 | 3 638 | 34,1 | — (fuera de piel) | — | — |
| 10,0 (tope PIO) | 151,6 | 4 851 | 45,5 | — | — | — |

El rizado residual de punta tras el filtro de silicona de 5,2 Hz está **entre 5× y 60× por debajo del umbral vibrotáctil de 5–20 µm** en toda la banda. Es decir: el microstepping es perceptualmente invisible a cualquier velocidad programable. No hay que preocuparse por esto.

**Por qué constante dentro de la pasada.** Es la regla R1 y tiene tres justificaciones que apuntan al mismo sitio: (a) un cambio de velocidad sobre piel es un error de predicción, y el error de predicción es cosquilla; (b) la curva de placer contra velocidad es una U invertida, así que barrer velocidades dentro de una pasada te saca del óptimo la mitad del tiempo; (c) la aceleración implica par variable, y par variable implica ruido variable.

**Opción desactivada por defecto: deriva 1/f intra-pasada de ±6 %.** El informe de investigación la menciona como «temblor de mano humana» con aceleración limitada a < 2 mm/s². A 3 cm/s eso son ±1,8 mm/s repartidos sobre 9 s. Está implementada tras el flag `INTRA_STROKE_DRIFT`, pero **apagada**: es la primera cosa que probar si la máquina se siente «demasiado de máquina», y la primera que apagar si se siente inestable.

---

### 3.2 EJE 2 — Hueco entre pasadas (1,5–5,5 s de contacto CERO)

| | |
|---|---|
| **Rango nominal** | 1,5 – 5,5 s (suelo geométrico real con `v_fly` = 75 mm/s: **1,47 s**) |
| **Distribución** | Uniforme, con suelo dinámico impuesto por el carro radial (§3.6) |
| **Realizado (simulado)** | media 3,57 s · p10 2,29 · p50 3,50 · p90 5,09 · máx 5,43 |
| **Mecanismo** | Dwell en la meseta del riel, brocha a 11,8 mm de aire libre |
| **Parkings largos** | 8–20 s, sólo en el lado del reposo, uno por bloque |

**Anatomía del hueco.** Aquí es donde la especificación tenía un agujero (C-05). El «hueco» no es sólo el dwell: es todo el tiempo sin contacto, y eso incluye cruzar la zona de despegue dos veces.

```
   fin de contacto                                   inicio de contacto
        φ=26°                                              φ=26°
          │                                                  │
          ▼                                                  ▼
   ───────┬────────────┬──────────────┬────────────┬─────────────
          │ DESPEGUE   │   MESETA     │  MESETA    │ DESPEGUE
          │ 41,89 mm   │  d mm hasta  │  d mm de   │ 41,89 mm
          │ acelera a  │  la inversión│  vuelta    │ frena a
          │ v_fly      │              │            │ v_stroke
          │            │   ┌──────┐   │            │
          │            │   │ DWELL│   │            │
          └────────────┴───┴──────┴───┴────────────┴─────────────
           (41,89+d)/v_fly    t_dwell    (41,89+d)/v_fly   + 0,30 s
                                                            de acomodo

   t_hueco = 2·(41,89 + d)/v_fly  +  t_dwell  +  0,30
```

Con `v_fly = 75 mm/s` y profundidad de meseta `d` entre 2 y 33 mm:

| t_hueco pedido | d (mm) | Tiempo de vuelo (ida+vuelta) | t_dwell resultante | ¿Viable? |
|---|---|---|---|---|
| 1,47 s | 2 | 1,17 s | **0,00 s** | límite absoluto |
| 1,50 s | 2 | 1,17 s | 0,03 s | ✅ justo |
| 2,50 s | 10 | 1,38 s | 0,82 s | ✅ |
| 3,50 s | 16 | 1,54 s | 1,66 s | ✅ |
| 4,50 s | 24 | 1,76 s | 2,44 s | ✅ |
| 5,50 s | 30 | 1,92 s | 3,28 s | ✅ |

**Y si NO existiera `v_fly`** (es decir, si se cruzase la zona de despegue a la velocidad de pasada, como dice literalmente la especificación):

| v pasada | Tiempo de vuelo ida+vuelta | Hueco mínimo posible |
|---|---|---|
| 2,0 cm/s | 4,39 s | **4,69 s** ❌ imposible cumplir 1,5 s |
| 3,0 cm/s | 2,93 s | 3,23 s ❌ |
| 7,0 cm/s | 1,25 s | 1,55 s ✅ a duras penas |

Queda demostrado: **sin `v_fly` el hueco no es independiente de la velocidad de pasada, y a velocidades lentas es imposible bajar de 4,7 s.** La adición A-01 no es un lujo.

`v_fly` se limita a **7,5 cm/s** (`V_VUELO_MMS = 75.0f` en `config.h`) y no a los 10,0 del tope nominal, por tres razones: (a) el techo real no son 10 cm/s sino el que impone el suelo compilado del PIO, **240 µs**, que a R = 275 mm topa la punta en **7,87 cm/s** — pedir 8,0 cm/s sería físicamente inalcanzable en el radio interior y dejaría que el hardware recortase el vuelo por su cuenta; (b) 7,5 deja margen a los tres radios (7,87 / 8,59 / 9,31 cm/s); (c) la aceleración desde 3 a 7,5 cm/s con `a_fly = 200 mm/s²` consume 11,8 mm, que cabe holgadamente en los 41,89 mm de la zona de despegue.

**Aceleración fuera de piel.** `a_fly = 200 mm/s²` (0,02 g). La inercia referida a punta son 30 g, así que la fuerza inercial es 30 g × 0,2 m/s² = **6 mN**, un 1,5 % de la fuerza de contacto — y además ocurre con la brocha en el aire. Perfil con jerk limitado (S-curve) sobre 3° de barrido. Acústicamente irrelevante.

**Dónde ponemos los dwells: consecuencia del fallo seguro (C-06).** El contrapeso tira siempre hacia el reposo (+43°). Eso hace que las dos mesetas NO sean equivalentes:

| | Meseta del lado del reposo (+34…43°) | Meseta del lado lejano (−34…43°) |
|---|---|---|
| ¿Quién sostiene la botavara? | El tope M4 cautivo + el contrapeso | **Sólo el motor** |
| Corriente de mantenimiento | **IHOLD = 0.** Cero zumbido, cero calor | **IHOLD = 0,18 A** (11,7 mN·m; con los ~8 mN·m de detente, margen 1,1×) |
| Si se va la alimentación aquí | La brocha ya está fuera; no pasa nada | El contrapeso barre la piel entera a 80–120 mm/s durante ~2,7 s |
| Dwell máximo permitido | **20 s** (parking largo) | **5,5 s** |

De aquí sale una regla del algoritmo: **`t_dwell` largo sólo en el lado del reposo.** El generador conoce en todo momento el signo del lado en que está (variable `side`) y sortea el hueco de la distribución larga sólo cuando `side = +1`.

**Por qué 1,5–5,5 s y no otra cosa.** El aferente CT tiene post-descarga de 1–5 s tras retirar el estímulo y su respuesta a indentación estática cae a cero en menos de 5 s. Un hueco dentro de 1,5–5,5 s deja al aferente recuperarse **sin** que la traza se extinga del todo, de modo que las pasadas se encadenan perceptualmente en vez de leerse como eventos aislados. Los parkings largos de 8–20 s hacen lo contrario a propósito: **rompen** la cadena, y esa ruptura es en sí misma una variación estructural que ningún jitter de parámetro puede imitar. Uno por bloque, cuatro por sesión.

---

### 3.3 EJE 3 — Duración de la rampa de aterrizaje (0,52–1,83 s)

| | |
|---|---|
| **Rango real** | **0,52 – 1,83 s** (la spec decía 0,6–2,5 s: ver C-02) |
| **Distribución** | **DERIVADA**, no sorteada: `t_rampa = 36,65 mm / v_pasada` |
| **Mecanismo** | Geometría del riel. El firmware sólo la escala en el tiempo |
| **Perfil de fuerza** | Lineal en el ángulo: `N(φ) = 400·(26−φ)/7` mN |

Este es el eje que **no es un eje**. Y hay que decirlo claro porque la especificación lo lista como parámetro independiente.

La rampa de fuerza está tallada en madera contrachapada. La brocha entra en contacto a φ = 26° con N = 0 y alcanza los 400 mN a φ = 19°, recorriendo 36,65 mm de arco. Si la pasada va a v cm/s, la rampa dura 36,65/v segundos y **no hay nada que el firmware pueda hacer al respecto sin acelerar sobre piel**, que es exactamente lo que la regla R1 prohíbe.

| v (cm/s) | t_rampa | dN/dt medio | ¿Cumple el mínimo de ~0,5 s de la investigación? |
|---|---|---|---|
| 2,0 | 1,833 s | 218 mN/s | ✅ con muchísimo margen |
| 3,0 | 1,222 s | 327 mN/s | ✅ |
| 5,0 | 0,733 s | 546 mN/s | ✅ |
| 7,0 | **0,524 s** | 764 mN/s | ✅ justo en el límite |

Es una buena noticia disfrazada de limitación: **la rampa está garantizada por geometría en toda la banda de velocidad**, incluso con el firmware colgado. La investigación pide rampar la fuerza durante ~0,5 s para que el aterrizaje nunca sea el «insecto que se posa», y la máquina cumple eso mecánicamente en el peor caso.

Los 2,5 s de la especificación son **inalcanzables**: harían falta 36,65/2,5 = 14,7 mm/s = 1,47 cm/s, por debajo del suelo de 2,0 cm/s del propio contrato y por debajo del suelo de la banda CT. Si de verdad quieres un aterrizaje de 2,5 s hay dos caminos, ambos de hardware: alargar la zona de descarga de 7° a 12° (rampa de 62,8 mm ⇒ 2,51 s a 2,5 cm/s), o bajar la velocidad mínima a 1,5 cm/s aceptando salir de la banda CT. **Ninguno se recomienda.** Se declara el rango real 0,52–1,83 s.

**Palanca indirecta que sí existe.** Como `t_rampa = 36,65/v` y v viene del OU, **bajar μ alarga las rampas**. El preset «más suave» de §7 usa exactamente eso: μ bajo ⇒ rampas de 1,4–1,7 s ⇒ aterrizajes notablemente más blandos. Es el eje 3 controlado a través del eje 1.

---

### 3.4 EJE 4 — Punto de inversión (±16 mm en la meseta) — y su corrección honesta

| | |
|---|---|
| **Rango** | φ_inv ∈ [35°, 41°] = 31,42 mm = **±15,7 mm** alrededor de 38° |
| **Distribución** | Uniforme, independiente en cada extremo |
| **Qué aporta de verdad** | Desorden del ritmo, reparto del desgaste en la meseta, aleatorización del instante del cambio de DIR |
| **Qué NO aporta** | **Migración de la huella sobre la piel. Cero.** |

La especificación afirma que «desplazar la inversión dentro de la meseta mueve el segmento de fuerza plena ±16 mm a lo largo del arco». **Eso es falso** y conviene entender por qué, porque el error es intuitivo.

```
   El riel está ATORNILLADO A LA COLUMNA. Las zonas están definidas por φ.

   Inversión a 35°:          Inversión a 41°:
   ────┬────┬───┬──┐         ────┬────┬───┬──────┐
    A  │ B  │ C │D◄┘          A  │ B  │ C │  D  ◄┘
   ────┴────┴───┴──          ────┴────┴───┴──────
   contacto: 0…26°           contacto: 0…26°
             ▲                         ▲
             └── IDÉNTICO ──────────────┘
```

La brocha deja la piel a φ = 26° y vuelve a tocarla a φ = 26°, siempre, invierta donde invierta. El segmento de fuerza plena es **siempre los mismos 199 mm de arco**. Lo único que cambia es cuánto vuela por el aire.

Entonces, ¿por qué se conserva el eje? Por tres razones honestas y una cuarta que es la buena:

1. **Es gratis.** Un sorteo uniforme más.
2. **Reparte el desgaste del patín de PTFE y del fieltro de la meseta** sobre 31 mm en vez de sobre un punto. Aumenta la vida del riel.
3. **Aleatoriza el instante exacto del cambio de DIR** y de la recogida de holgura del tendón, que son los dos únicos eventos mecánicos discretos del ciclo.
4. **Y la buena: rompe la isocronía.** El tiempo de vuelo varía entre 1,10 y 1,80 s según d (§3.2). Aunque el dwell se fijara constante, el hueco total ya variaría 0,7 s. Combinado con el sorteo del dwell, el periodo entre pasadas queda con una desviación típica de ~1,2 s sobre una media de 12–14 s, o sea ~9 % de jitter rítmico. Esa es la regla R5, y es la única función perceptual real del eje 4.

**Sé honesto con este eje en las expectativas: es el más débil de los seis.** Se queda porque es gratis, no porque sea potente.

---

### 3.5 EJE 5 — Pasadas rozadas (grazing): 150–300 mN

| | |
|---|---|
| **Rango de fuerza pico** | 150 – 300 mN |
| **Ángulo de inversión** | φ_g = 26 − 7·F_pico/400 ⇒ **20,75° … 23,375°** |
| **Arco de contacto (ida+vuelta)** | 27,5 – 55,0 mm a R=300 |
| **Duración** | 0,92 – 1,83 s a 3 cm/s |
| **Probabilidad por defecto** | p = 0,15 en régimen; 0,70 en rampa de entrada; 0,80 en rampa de salida |
| **Distribución de F_pico** | Uniforme(150, 300) en régimen; rampa monótona en entrada/salida |

Una pasada rozada es una pasada que **invierte dentro de la zona de descarga** y por tanto **nunca entra en la zona de fuerza plena**. Es corta, es suave, y —esto es lo importante— es **el único momento en que esta máquina modula la fuerza a lo largo de una pasada**.

```
   Pasada COMPLETA (400 mN)                 Pasada ROZADA (F_pico = 250 mN)

  N                                        N
 400┤   ┌──────────────────┐              400┤
    │  ╱                    ╲                 │
 200┤ ╱                      ╲             200┤      ╱╲
    │╱                        ╲               │     ╱  ╲
   0┴──────────────────────────╲──►φ         0┴────╱────╲────────►φ
    26  19        0        19  26             26  22,6  26
    └─────── 272,3 mm ──────┘                 └─ 35,6 mm ─┘
       9,08 s a 3 cm/s                          1,19 s a 3 cm/s
```

Fuerza pico contra ángulo de inversión, a R = 300 mm:

| F_pico objetivo | φ_g | Arco de ida | Arco ida+vuelta | Duración a 3 cm/s | Impulso relativo* |
|---|---|---|---|---|---|
| 150 mN | 23,375° | 13,7 mm | 27,5 mm | 0,92 s | 2,6 % |
| 200 mN | 22,500° | 18,3 mm | 36,7 mm | 1,22 s | 4,6 % |
| 250 mN | 21,625° | 22,9 mm | 45,8 mm | 1,53 s | 7,2 % |
| 300 mN | 20,750° | 27,5 mm | 55,0 mm | 1,83 s | 10,4 % |

\* Impulso (∫N·ds) relativo al de una pasada completa. Una rozada de 300 mN entrega el 10 % de la «dosis» de una pasada completa.

**Cuatro cosas que hay que entender de este eje:**

**(a) Modula la fuerza *dentro* de la pasada, y es lo único que lo hace.** Como N(φ) = 400·(26−φ)/7, una pasada confinada en la descarga tiene un perfil triangular: entra a 0 mN, sube hasta F_pico, y baja a 0. Es una caricia que **aparece y desaparece**, no una que enciende y apaga. Perceptualmente es lo más parecido a un roce humano que la máquina sabe hacer, y sale gratis de la geometría del riel.

**(b) Ocurre en el EXTREMO de la extremidad, no en el centro.** La zona de descarga está a 19–26°, o sea en los últimos 36,65 mm de cada extremo del arco de contacto. Sobre un antebrazo colocado según la plantilla, eso es cerca de la muñeca o cerca del codo. **Las rozadas no acarician el centro del antebrazo.** Es una limitación geométrica real y hay que decirla.

**(c) No cambia de lado.** Una rozada entra y sale por el mismo extremo, así que la botavara vuelve a la meseta de la que salió. Como una pasada completa **sí** cambia de lado, la secuencia natural es alternar:

```
   completa (+→−) · rozada en − · completa (−→+) · rozada en + · completa (+→−) · …
```

Así las rozadas también alternan extremo de la extremidad, sin coste ninguno. El generador lleva la variable `side` y lo hace solo.

**(d) Es el mecanismo de rampa de entrada y de salida de la sesión.** No hay otro: la fuerza es un lastre de latón y no se puede programar. Los primeros ~50 s de la sesión son rozadas con F_pico creciendo de 150 a 300 mN; los últimos ~60 s son rozadas con F_pico decreciendo de 300 a 150 mN. Detalle en §4.

**Una advertencia honesta.** La primera pasada *completa* de la sesión cruza la zona de fuerza plena a 400 mN, y eso no se puede evitar: **no hay riel sobre el centro del barrido, así que no se puede cambiar de lado sin tocar la piel a fuerza plena**. Lo que sí protege el aterrizaje es la rampa geométrica de 1,2–1,8 s. Las rozadas previas preparan la piel y al usuario, pero no eliminan ese primer cruce.

---

### 3.6 EJE 6 — Radio R del carro radial, con la regla dura de ≥ 6 mm

| | |
|---|---|
| **Rango** | R = 300 ± 25 mm (banda de 50 mm) |
| **Regla dura** | \|R_n − R_{n−1}\| ≥ 6 mm **y** \|R_n − R_{n−2}\| ≥ 6 mm |
| **Cap dinámico** | \|R_n − R_{n−1}\| ≤ ΔR_max(hueco), como máximo 12 mm |
| **Distribución** | Uniforme sobre el conjunto permitido (aritmética de intervalos, no rechazo) |
| **Realizado** | \|ΔR\| medio **7,70 mm** · histograma 0,72×…1,17× la media |
| **Hardware** | 28BYJ-48 + ULN2003 + husillo T8 de 8 mm de paso, **K_rad = 0,50 s/mm** |
| **Cuándo se mueve** | Solapado con el último 20 % de la pasada anterior + el hueco |

Este es el eje potente, el único que produce migración real, y también el único que puede **bloquear el algoritmo** si se implementa mal. Vamos por partes.

#### 3.6.1 Por qué ≥ 6 mm y por qué contra las DOS anteriores

Los 6 mm salen del tamaño del campo receptor CT: 1–35 mm², es decir de 1,1 a 6,7 mm de diámetro. Un salto de 6 mm mueve el pico de presión de la brocha **aproximadamente un campo receptor completo**, de modo que la población de aferentes que recibe el máximo de estimulación es sustancialmente distinta.

La condición contra las **dos** anteriores (no sólo la última) impide el patrón A→B→A→B, que sería un ping-pong de 6 mm perfectamente periódico: exactamente el fallo que estamos evitando, sólo que a escala milimétrica. Con la regla contra dos anteriores, el ciclo más corto posible es de longitud 3, y con el cap de 12 mm la práctica es que no se repiten posiciones.

**Verificación de que la regla siempre tiene solución.** Cada exclusión ocupa 12 mm de la banda de 50 mm. Dos exclusiones ocupan como máximo 24 mm, así que **siempre quedan ≥ 26 mm disponibles**. La regla nunca puede quedarse sin conjunto factible… *salvo que también impongas un máximo*, y ahí está la trampa.

#### 3.6.2 La trampa del cap superior: el bloqueo por rechazo

El muestreo ingenuo por rechazo (sortear R uniforme y repetir hasta que cumpla) **funciona con sólo la regla de ≥ 6 mm** (1,76 sorteos por aceptación de media) pero **se cuelga en un bucle infinito en cuanto añades un máximo**. Ejemplo concreto: si R_{n−1} = −25 mm y ΔR_max = 12, el conjunto permitido por el cap es [−19, −13]; si además R_{n−2} = −16, la exclusión de ±6 mm borra [−22, −10] y **el conjunto permitido queda vacío**. El bucle no termina nunca. Esto me ocurrió literalmente durante la simulación de este documento.

**La solución correcta es aritmética de intervalos, no rechazo**, con una jerarquía explícita de relajación:

```
   1. Empieza con el intervalo [−25, +25].
   2. Intersécalo con [R₁ − ΔR_max, R₁ + ΔR_max]      (cap superior)
   3. Réstale (R₁ − 6, R₁ + 6)                         (regla dura, anterior)
   4. Réstale (R₂ − 6, R₂ + 6)                         (regla dura, anteanterior)
   5. Si el resultado es vacío → deshaz el paso 4 (la penúltima es menos importante)
   6. Si sigue vacío → ensancha ΔR_max en +4 mm y vuelve al paso 2
   7. Sortea uniforme sobre la longitud total de los intervalos supervivientes.
```

Nunca relajes el mínimo de 6 mm: es la regla perceptual. Relaja primero la restricción contra la penúltima, y luego el cap superior (que es una restricción de *tiempo*, no de percepción — y su coste es sólo un hueco un poco más largo).

#### 3.6.3 El planificador: el hueco manda, ΔR se adapta

El 28BYJ-48 con husillo T8 mueve **2 mm/s** (8 mm/rev × 15 rpm ÷ 60), o sea **K_rad = 0,50 s por mm**. Ese número gobierna todo el eje:

| Salto | Tiempo de movimiento |
|---|---|
| 6 mm | 3,0 s |
| 12 mm | 6,0 s |
| 25 mm | 12,5 s |
| 50 mm (extremo a extremo) | **25 s** ❌ |

Un salto libre puede ser de hasta 50 mm y tardar 25 s, mucho más que cualquier hueco. Y el salto medio **sin cap** sale de 20,7 mm = 10,3 s (medido en simulación). Sin cap dinámico esto no funciona.

La ventana disponible para mover el carro es:

```
   T_ventana = overlap · t_contacto  +  t_hueco  −  0,40 s de acomodo
               └──── 0,20 por defecto ────┘
```

El solape con el último 20 % de la pasada anterior es la idea del contrato: **el raspado de las fibras sobre la piel enmascara el ruido del 28BYJ-48**, que es el único evento impulsivo de la máquina. Nunca se mueve el carro en silencio.

Y el orden de las operaciones importa. Probé las dos:

| Orden | Resultado simulado |
|---|---|
| **(a) Sortear ΔR y estirar el hueco para que quepa** | Hueco medio 4,06 s, p10 = 3,09 s. **Se pierden todos los huecos cortos**: la distribución 1,5–5,5 s se convierte de facto en 3,1–5,5 s |
| **(b) Sortear el hueco y adaptar ΔR a lo que quepa** ✅ | Hueco medio 3,57 s, p10 = 2,29 s, p50 3,50 s. La distribución sobrevive casi intacta |

**Se adopta (b).** El hueco es el eje perceptualmente más valioso de los dos y no se le sacrifica.

```
   ΔR_max_dyn = (overlap·t_contacto + t_hueco − 0,40) / K_rad,  limitado a 12 mm

   si ΔR_max_dyn < 6 mm:
       # estira el hueco lo mínimo imprescindible para un salto de 6 mm
       t_hueco = max(t_hueco, 6·K_rad + 0,40 − overlap·t_contacto)
       ΔR_max_dyn = 6
```

Números concretos con overlap = 0,20 y K_rad = 0,50 s/mm:

| v (cm/s) | t_contacto | hueco 1,5 s → ΔR_max | hueco 3,5 s → ΔR_max | hueco 5,5 s → ΔR_max |
|---|---|---|---|---|
| 2,0 | 13,62 s | 7,6 mm | **12 mm** (cap) | 12 mm |
| 3,0 | 9,08 s | 5,8 → estira a 1,58 s | 9,8 mm | 12 mm |
| 5,0 | 5,45 s | 4,4 → estira a 2,22 s | 8,4 mm | 12 mm |
| 7,0 | 3,89 s | 3,8 → estira a 2,62 s | 7,8 mm | 11,8 mm |

El estiramiento sólo se activa con huecos cortos, y sólo añade décimas. Ese es el origen exacto de la corrección C-01: es lo que convierte el ciclo teórico de 12,6 s en los **13,76 s** medidos, que es el 13,9 s del contrato.

#### 3.6.4 Cobertura conseguida

Histograma agregado de R sobre **400 sesiones simuladas** (bandas de 5 mm, en % del total):

```
  R (mm):  −25  −20  −15  −10   −5    0    +5  +10  +15  +20  +25
           ├────┼────┼────┼────┼────┼────┼────┼────┼────┼────┤
     %:     7,5  9,8 11,0 11,6 10,5 11,7 10,8 11,0  9,0  7,2
           ▁▁▁▁ ▃▃▃▃ ▅▅▅▅ ▆▆▆▆ ▅▅▅▅ ▆▆▆▆ ▅▅▅▅ ▅▅▅▅ ▃▃▃▃ ▁▁▁▁
           └── media 10,0 % ── máx 1,17× ── mín 0,72× ──┘
```

Hay un sesgo suave hacia el centro (los extremos reciben un 72 % de la dosis media) porque el cap de 12 mm hace que el paseo se comporte como un random walk acotado. **Está muy dentro del criterio de aceptación de 1,6×** que fija el contrato. Se puede corregir del todo con un sorteo ponderado por cobertura (peso 1/(1+visitas) por bin de 1 mm, implementado y desactivado por defecto), pero en la simulación mejora poco (0,78 → 0,78 en la relación borde/centro) porque la restricción domina sobre el peso. **No merece la complejidad.**

Banda mojada total resultante: **118 mm**, exactamente la cifra del contrato (50 de carro + 16,3 de sagita + 52 de brocha). Anchura a media altura de la dosis: 69 mm.

---

### 3.7 Tabla resumen de los seis ejes

| # | Eje | Rango | Distribución | ¿Independiente? | Potencia perceptual |
|---|---|---|---|---|---|
| 1 | **Velocidad de pasada** | 2,0–7,0 cm/s | OU gaussiano, τ=6, σ_∞=0,8, reflexión | Sí | ★★★★★ |
| 2 | **Hueco** | 1,4–5,5 s (+ parkings 8–20 s) | Uniforme con suelo dinámico | Sí (gracias a `v_fly`) | ★★★★☆ |
| 3 | **Rampa de aterrizaje** | 0,52–1,83 s | **Derivada**: 36,65/v | **No** | ★★★☆☆ |
| 4 | **Punto de inversión** | ±15,7 mm (35–41°) | Uniforme | Sí | ★☆☆☆☆ (no migra huella) |
| 5 | **Pasadas rozadas** | 150–300 mN, p=0,15 | Bernoulli + Uniforme | Sí | ★★★★☆ |
| 6 | **Radio R** | ±25 mm, ΔR ∈ [6,12] mm | Uniforme sobre conjunto restringido | Acoplado al hueco | ★★★★★ |

Y un séptimo, invisible pero necesario:

| 7 | **`v_fly`** (adición A-01) | 3–10 cm/s, def. 8,0 | Constante | Sí | ☆ (nunca toca la piel) |


---

<a name="4"></a>
## 4. ESTRUCTURA DE SESIÓN: 4 BLOQUES DE 3,75 MIN

### 4.1 El cronograma completo

```
  t = −60 s ─────────── 0 ────────── 225 ───────── 450 ───────── 675 ──────── 900 s
      │                 │             │             │             │            │
  ┌───┴────┐  ┌─────────┴───┐  ┌──────┴──────┐  ┌───┴─────────┐  ┌┴──────────┐ │
  │ CUNA   │  │  BLOQUE 1   │  │  BLOQUE 2   │  │  BLOQUE 3   │  │ BLOQUE 4  │ │
  │ 35 °C  │  │  μ=3,2 cm/s │  │  μ=2,6 cm/s │  │  μ=4,1 cm/s │  │μ=2,9 cm/s │ │
  │ motor  │  │  "entrada"  │  │  "el fondo" │  │  "despierta"│  │ "salida"  │ │
  │ OFF    │  │             │  │             │  │             │  │           │ │
  └────────┘  └─────────────┘  └─────────────┘  └─────────────┘  └───────────┘ │
   precalen-   ├─50 s─┤                                            ├──60 s──┤   │
   tamiento    rampa de                                            rampa de     │
   térmico     entrada                                             salida       │
                                                                                ▼
                                                                      desenergizar,
                                                                      el contrapeso
                                                                      lleva a la cuna

  p_graze:     0,70→0,15      0,15           0,10          0,15 →0,80
  v inicial:   OU arranca en v₀ = 2,2 cm/s (la reversión ES la rampa)
  parking largo:   1×             1×            1×             1×    (siempre en +)
```

Los 4 × 225 s = 900 s exactos. El precalentamiento en la cuna queda **fuera** de la ventana de 900 s, de modo que el TPL5010 de 960 s conserva sus 60 s de margen íntegros (ver C-07).

### 4.2 Precalentamiento: en la cuna, no sobre la piel (C-07)

La especificación pedía «60 s de precalentamiento con la brocha ya apoyada en la piel». No se hace, por tres razones aritméticas:

1. **Cuesta corriente permanente.** El contrapeso ejerce 247 mN·m hacia el reposo. Sostener la botavara a φ = 0 exige 247/14,29 = 17,3 mN·m en el motor, o sea ~0,25 A durante 60 s: 1,2 W y un zumbido de chopper continuo a 40 cm de la almohada, justo antes de dormir.
2. **Es perceptualmente muerto.** El aferente CT responde a indentación estática con una ráfaga y **cae a cero en menos de 5 s**. Los otros 55 s no transmiten nada.
3. **La cuna ya existe para esto.** La cuna calefactada a 35 °C, forrada de fieltro, está en la base de la máquina y es donde el contrapeso aparca la brocha por defecto. Con el motor **desenergizado**. Sesenta segundos ahí y las puntas de las cerdas salen a 32–35 °C, que es exactamente el objetivo térmico.

**Procedimiento adoptado:** pulsar el botón enciende el calefactor de la férula y arranca una cuenta de 60 s con el motor apagado y la brocha en la cuna. Al terminar, arranca el ciclo de 900 s. Si de verdad se quiere un contacto estático inicial sobre piel, **máximo 10 s** y con la corriente asumida.

### 4.3 Rampa de entrada (primeros ~50 s del bloque 1)

Tres mecanismos superpuestos, ninguno de los cuales necesita código especial más allá de fijar tres variables:

1. **El OU arranca abajo.** `v₀ = 2,2 cm/s` en lugar de μ. La reversión a la media hace el resto: llega al 63 % del camino hacia 3,2 cm/s en 6 pasadas (~75 s) y al 95 % en 18. **La rampa de velocidad es el propio proceso.** Y como `t_rampa = 36,65/v`, arrancar lento significa además que los primeros aterrizajes duran 1,6–1,8 s: los más suaves de toda la sesión.
2. **p_graze arranca en 0,70 y decae exponencialmente a 0,15** con constante de 6 pasadas. Las primeras pasadas son mayoritariamente rozadas.
3. **F_pico de las rozadas rampa de 150 a 300 mN linealmente** a lo largo de los primeros 50 s.

Secuencia típica de los primeros 60 s (semilla concreta, sólo ilustrativa):

| # | Tipo | v (cm/s) | F pico | Arco | t contacto | Hueco | t acumulado |
|---|---|---|---|---|---|---|---|
| 1 | rozada + | 2,20 | 150 mN | 27,5 mm | 1,25 s | 4,4 s | 5,7 s |
| 2 | rozada + | 2,31 | 175 mN | 32,1 mm | 1,39 s | 3,9 s | 11,0 s |
| 3 | **completa** +→− | 2,44 | 400 mN | 272,3 mm | **11,16 s** | 3,2 s | 25,4 s |
| 4 | rozada − | 2,58 | 225 mN | 41,2 mm | 1,60 s | 4,8 s | 31,8 s |
| 5 | **completa** −→+ | 2,71 | 400 mN | 272,3 mm | 10,05 s | 3,6 s | 45,4 s |
| 6 | rozada + | 2,86 | 275 mN | 50,4 mm | 1,76 s | 2,9 s | 50,1 s |
| 7 | **completa** +→− | 2,95 | 400 mN | 272,3 mm | 9,23 s | 4,1 s | 63,4 s |

Obsérvese: **la primera pasada completa llega en el segundo 14**, con un aterrizaje de 1,50 s (36,65/2,44). Es lo más blando que la mecánica sabe hacer.

### 4.4 Los cuatro bloques

| Bloque | t | μ nominal | μ realizado | v media | Pasadas completas | Rozadas | Papel perceptual |
|---|---|---|---|---|---|---|---|
| 1 | 0–225 s | **3,2** | 3,30 | 3,3 cm/s | ~14 | ~5 | Entrada. Lento al principio, se asienta en el óptimo CT |
| 2 | 225–450 s | **2,6** | 2,90 | 2,9 cm/s | ~15 | ~3 | El fondo lento. Pasadas largas (9,4 s), rampas de 1,3 s |
| 3 | 450–675 s | **4,1** | 4,11 | 4,1 cm/s | ~20 | ~3 | **Sale de la banda de saciedad de 3 cm/s a propósito** |
| 4 | 675–900 s | **2,9** | 3,07 | 3,1 cm/s | ~16 | ~6 | Vuelta a lento + rampa de salida |
| | **Total** | | | **3,38** | **~65** | **~12** | 18,3 m de camino sobre piel |

**Por qué el bloque 3 es rápido.** No es un capricho de variedad. Triscoli midió declive significativo de placer **sólo a 3 cm/s**, y no a 0,3 ni a 30. La estructura de bloques está diseñada para que el sistema **no pase 15 minutos en la velocidad exacta en la que se midió la saciedad**. El bloque 3 lleva la media a 4,1 cm/s durante 3,75 min, que es un 37 % por encima del punto de saciedad, y lo hace justo en el intervalo temporal (minutos 7,5–11,25) donde la habituación acumulada sería peor.

**Por qué el 2 y el 4 son lentos.** Porque a menor velocidad el arco de contacto tarda más (9,4 s a 2,9 cm/s frente a 6,6 s a 4,1) y las rampas de aterrizaje son más largas (1,26 s frente a 0,89 s). El bloque 2 es la parte «densa» de la sesión y el bloque 4 la lleva hacia la salida.

**Transición entre bloques.** El OU **no se reinicia**: se cambia μ y el proceso reverte solo. La transición del bloque 2 al 3 (2,6 → 4,1 cm/s) tarda ~6 pasadas en cubrir el 63 %, o sea ~75 s. Eso es deliberado: un salto instantáneo de velocidad media sería un evento detectable. La transición es una deriva.

**Parking largo, uno por bloque.** En un punto aleatorio de cada bloque (uniforme sobre el 60 % central), el hueco siguiente se sustituye por un parking de 8–20 s **en la meseta del lado del reposo**, con IHOLD = 0. Rompe la cadena de post-descarga CT deliberadamente. Nunca en el lado lejano (C-06).

### 4.5 Rampa de salida (últimos ~60 s) y final del ciclo

1. En t = 840 s: `μ ← 2,2 cm/s` y `τ ← 3` (para que baje rápido), `p_graze ← 0,80`, `F_pico` rampa descendente de 300 a 150 mN, huecos sorteados de U(4,0 · 5,5).
2. La última pasada completa termina, la brocha sale por la descarga, sube por el despegue y llega a la meseta del **lado del reposo**.
3. El firmware la conduce a 43°, cierra el microrruptor de reposo (comprobación de integridad final), la deposita en la cuna y **desenergiza el motor**.
4. A partir de ahí el contrapeso la mantiene ahí sin corriente. La máquina queda muda y fría.

**Nota importante sobre el final abrupto (fallo, no fin normal).** Si se corta la alimentación mientras la botavara está en el lado *lejano*, el contrapeso la arrastra hacia el reposo cruzando toda la zona de contacto a 80–120 mm/s (el amortiguador de aire lo limita): **una última pasada firme de ~2,7 s a ~10 cm/s a 400 mN**. Es seguro y es infinitamente mejor que dejar la brocha apoyada, pero es brusca. Por eso el fin *normal* del ciclo se programa siempre desde el lado del reposo, y por eso todos los dwells largos van en ese lado.


---

<a name="5"></a>
## 5. PSEUDOCÓDIGO COMPLETO DEL GENERADOR

Estilo C, comentado en español. Son unas 260 líneas. Se ejecuta en el core 0 del RP2040; el PIO del core 1 genera los pulsos de paso con el suelo de tiempo compilado (§5.7). Nada de lo que hay aquí puede aumentar la fuerza sobre la piel: la fuerza es un lastre de latón.

### 5.1 Constantes de geometría y del algoritmo

```c
/* ---------- GEOMETRÍA (de 02-mecanica.md, NO tocar sin recortar el riel) ---------- */
#define R_NOM_MM        300.0f   // radio nominal eje de barrido → centro de brocha
#define R_SPAN_MM        25.0f   // recorrido del carro radial, ±
#define PHI_PLENA_DEG    19.0f   // 0..19°  fuerza plena 400 mN
#define PHI_TAPER_DEG    26.0f   // 19..26° zona de descarga, 400 → 0 mN
#define PHI_LIFT_DEG     34.0f   // 26..34° zona de despegue, aire 0 → 11,8 mm
#define PHI_REV_LO_DEG   35.0f   // ventana de inversión: guarda de 1° tras el despegue
#define PHI_REV_HI_DEG   41.0f   // guarda de 2° antes del tope M4 de 43°
#define PHI_PARK_DEG     43.0f   // tope cautivo + cuna calefactada
#define N_PLENA_MN       400.0f  // fuerza en la zona plena (lastre de 40 g a x=125 mm)

/* ---------- BANDAS DEL ALGORITMO ---------- */
#define V_MIN_CMS         2.0f   // suelo de la banda CT
#define V_MAX_CMS         7.0f   // techo útil
#define V_HARD_CMS       10.0f   // tope duro: lo impone el PIO, esto es sólo espejo
#define V_FLY_CMS         8.0f   // adición A-01: velocidad fuera de piel
#define A_FLY_MMS2      200.0f   // aceleración fuera de piel (0,02 g)
#define GAP_MIN_S         1.5f
#define GAP_MAX_S         5.5f
#define PARK_MIN_S        8.0f   // parking largo, sólo lado del reposo
#define PARK_MAX_S       20.0f
#define SETTLE_S          0.30f  // acomodo de DIR + recogida de holgura del tendón

/* ---------- ORNSTEIN-UHLENBECK ---------- */
#define OU_TAU_STROKES    6.0f
#define OU_SIGMA_INF      0.8f   // desviación típica ESTACIONARIA, en cm/s
static const float OU_A = 0.846482f;   // exp(-1/6)
static const float OU_B = 0.532417f;   // sqrt(1 - a²)

/* ---------- CARRO RADIAL ---------- */
#define DR_MIN_MM         6.0f   // regla dura contra las DOS anteriores
#define DR_CAP_MM        12.0f   // cap superior por tiempo de movimiento
#define K_RAD_S_PER_MM    0.50f  // 28BYJ-48 + T8: 2 mm/s. MEDIR en banco (§10.3)
#define OVERLAP_FRAC      0.20f  // solape con el final de la pasada (enmascarado)
#define RAD_MARGIN_S      0.40f

/* ---------- PASADAS ROZADAS ---------- */
#define GRAZE_F_MIN_MN  150.0f
#define GRAZE_F_MAX_MN  300.0f
#define P_GRAZE_RUN       0.15f
#define P_GRAZE_IN        0.70f
#define P_GRAZE_OUT       0.80f

/* ---------- SESIÓN ---------- */
#define BLOCK_S         225.0f   // 3,75 min
#define N_BLOCKS           4
#define SESSION_S       900.0f
static const float BLOCK_MU[N_BLOCKS] = { 3.2f, 2.6f, 4.1f, 2.9f };
#define RAMP_IN_S        50.0f
#define RAMP_OUT_S       60.0f
#define V0_CMS            2.2f   // el OU arranca abajo: la reversión ES la rampa
```

### 5.2 PRNG y gaussiana

```c
/* xoshiro128starstar — 128 bits de estado, periodo 2^128−1, ~10 líneas.
   NO uses rand(): en muchas libc es un LCG de 15 bits cuyos bits bajos
   son casi periódicos, y rand()%50 produce valores de R visiblemente en bandas. */
static uint32_t s[4];

static inline uint32_t rotl(uint32_t x, int k){ return (x << k) | (x >> (32-k)); }

uint32_t rng_next(void) {
    uint32_t r = rotl(s[1]*5u, 7) * 9u;
    uint32_t t = s[1] << 9;
    s[2] ^= s[0];  s[3] ^= s[1];  s[1] ^= s[2];  s[0] ^= s[3];  s[2] ^= t;
    s[3] = rotl(s[3], 11);
    return r;
}

/* uniforme en [0,1): usa los 24 bits ALTOS, nunca los bajos */
static inline float rnd_u(void) { return (rng_next() >> 8) * (1.0f/16777216.0f); }

/* uniforme en [a,b] */
static inline float rnd_range(float a, float b){ return a + (b-a)*rnd_u(); }

/* Bernoulli */
static inline bool rnd_bern(float p){ return rnd_u() < p; }

/* N(0,1) por Irwin-Hall de 12 uniformes: media 6, varianza 1 EXACTAS.
   Se recorta a ±6σ, lo cual es irrelevante aquí (la reflexión actúa mucho antes).
   Coste: 12 llamadas al PRNG, UNA VEZ POR PASADA (~0,08 Hz). */
static float rnd_gauss(void) {
    float sum = 0.0f;
    for (int i = 0; i < 12; i++) sum += rnd_u();
    return sum - 6.0f;
}
```

### 5.3 El generador de velocidad (Ornstein-Uhlenbeck)

```c
typedef struct { float v; float mu; float sigma; float a; float b; bool log_mode; } ou_t;

void ou_init(ou_t *o, float v0, float mu, float sigma, float tau) {
    o->a = expf(-1.0f/tau);
    o->b = sqrtf(1.0f - o->a*o->a);
    o->v = v0;  o->mu = mu;  o->sigma = sigma;  o->log_mode = false;
}

/* Reflexión, NUNCA recorte. El recorte produce rachas de pasadas a
   exactamente 2,00 cm/s, que es la constancia que todo el OU existe para evitar. */
static float reflect(float x, float lo, float hi) {
    while (x < lo || x > hi) {
        if (x < lo) x = 2.0f*lo - x;
        if (x > hi) x = 2.0f*hi - x;
    }
    return x;
}

float ou_step(ou_t *o) {
    if (!o->log_mode) {
        /* discretización EXACTA (Gillespie), no Euler-Maruyama:
           Euler daría un coeficiente de ruido un 8,4 % alto por nada. */
        o->v = o->mu + o->a*(o->v - o->mu) + o->sigma * o->b * rnd_gauss();
        o->v = reflect(o->v, V_MIN_CMS, V_MAX_CMS);
    } else {
        /* modo logarítmico (§2.7): sigma relativa constante, mejor en los extremos.
           sigma_u = 0,25 equivale a 0,80 cm/s en el punto nominal de 3,2 cm/s. */
        float u  = logf(o->v), mu_u = logf(o->mu);
        u = mu_u + o->a*(u - mu_u) + o->sigma * o->b * rnd_gauss();
        u = reflect(u, logf(V_MIN_CMS), logf(V_MAX_CMS));
        o->v = expf(u);
    }
    return o->v;
}
```

### 5.4 Sorteo del radio: aritmética de intervalos (NO rechazo)

```c
/* Un conjunto de intervalos disjuntos y ordenados sobre [-25, +25]. */
typedef struct { float lo[8], hi[8]; int n; } ivset_t;

static void iv_init(ivset_t *S, float lo, float hi){ S->n=1; S->lo[0]=lo; S->hi[0]=hi; }

static void iv_intersect(ivset_t *S, float lo, float hi) {
    ivset_t T = {.n=0};
    for (int i=0;i<S->n;i++) {
        float a = fmaxf(S->lo[i],lo), b = fminf(S->hi[i],hi);
        if (b-a > 1e-4f){ T.lo[T.n]=a; T.hi[T.n]=b; T.n++; }
    }
    *S = T;
}

static void iv_subtract(ivset_t *S, float lo, float hi) {
    ivset_t T = {.n=0};
    for (int i=0;i<S->n;i++) {
        float a=S->lo[i], b=S->hi[i];
        if (hi<=a || lo>=b){ T.lo[T.n]=a; T.hi[T.n]=b; T.n++; continue; }
        if (lo>a && lo-a>1e-4f){ T.lo[T.n]=a; T.hi[T.n]=fminf(lo,b); T.n++; }
        if (hi<b && b-hi>1e-4f){ T.lo[T.n]=fmaxf(hi,a); T.hi[T.n]=b; T.n++; }
    }
    *S = T;
}

static float iv_sample(const ivset_t *S) {
    float tot=0; for (int i=0;i<S->n;i++) tot += S->hi[i]-S->lo[i];
    float x = rnd_u()*tot;
    for (int i=0;i<S->n;i++){ float w=S->hi[i]-S->lo[i]; if (x<=w) return S->lo[i]+x; x-=w; }
    return S->hi[S->n-1];
}

/* Sorteo de R con:
     - regla dura: >= DR_MIN_MM respecto a las DOS anteriores  (perceptual, NUNCA se relaja)
     - cap dinámico: <= dr_cap                                  (temporal, se relaja si hace falta)
   El muestreo por rechazo NO sirve aquí: con un cap superior puede quedarse
   en bucle infinito (p.ej. r1=-25, cap=12, r2=-16 → conjunto vacío). */
float draw_R(float r1, float r2, float dr_cap) {
    for (float grow = 0.0f; grow <= 100.0f; grow += 4.0f) {
        ivset_t S; iv_init(&S, -R_SPAN_MM, +R_SPAN_MM);
        iv_intersect(&S, r1 - (dr_cap+grow), r1 + (dr_cap+grow));   // cap
        iv_subtract (&S, r1 - DR_MIN_MM,     r1 + DR_MIN_MM);       // vs anterior
        ivset_t T = S;
        iv_subtract (&T, r2 - DR_MIN_MM,     r2 + DR_MIN_MM);       // vs anteanterior
        if (T.n > 0) return iv_sample(&T);   // caso normal
        if (S.n > 0) return iv_sample(&S);   // relaja SÓLO la penúltima
        /* ni con eso: ensancha el cap y repite. El mínimo de 6 mm nunca se toca. */
    }
    return -r1;   // inalcanzable en la práctica; espejo como último recurso
}
```

### 5.5 Planificador de hueco y de movimiento radial

```c
typedef struct {
    float v_cms;        // velocidad de esta pasada
    float R_mm;         // radio actual
    float t_contact_s;  // duración del contacto
    float gap_s;        // hueco pedido (sin contacto)
    float dwell_s;      // dwell en la meseta (parte del hueco)
    float phi_rev_deg;  // punto de inversión
    float dR_mm;        // salto radial a ejecutar
    float R_next_mm;
    bool  is_graze;
    float graze_F_mn;
    int   side;         // +1 lado del reposo, −1 lado lejano
} stroke_t;

static float arc_mm(float deg, float R){ return deg * 0.0174532925f * R; }

/* Tiempo de vuelo: cruzar la zona de despegue (26→34°) más d mm de meseta,
   ida y vuelta, a v_fly, más el acomodo. Sin v_fly esto sería imposible (C-05). */
static float flight_time(float R, float d_mm) {
    float lift = arc_mm(PHI_LIFT_DEG - PHI_TAPER_DEG, R);   // 41,89 mm a R=300
    return 2.0f*(lift + d_mm)/(V_FLY_CMS*10.0f) + SETTLE_S;
}

void plan_gap_and_radial(stroke_t *k, float r1, float r2, bool long_park) {
    /* 1. punto de inversión: uniforme en la ventana útil de 35..41° */
    k->phi_rev_deg = rnd_range(PHI_REV_LO_DEG, PHI_REV_HI_DEG);
    float d_mm = arc_mm(k->phi_rev_deg - PHI_LIFT_DEG, k->R_mm);   // 2..33 mm

    /* 2. hueco: el hueco MANDA, ΔR se adapta. El orden inverso destruiría
          los huecos cortos (media 4,06 s y p10 3,09 s en simulación). */
    float t_flight = flight_time(k->R_mm, d_mm);
    if (long_park && k->side > 0)          // parkings largos SÓLO en el lado del reposo
        k->gap_s = rnd_range(PARK_MIN_S, PARK_MAX_S);
    else
        k->gap_s = rnd_range(GAP_MIN_S, GAP_MAX_S);
    if (k->gap_s < t_flight) k->gap_s = t_flight;   // suelo geométrico (~1,47 s)

    /* 3. cuánto salto radial cabe en la ventana disponible */
    float window = OVERLAP_FRAC*k->t_contact_s + k->gap_s - RAD_MARGIN_S;
    float dr_cap = window / K_RAD_S_PER_MM;
    if (dr_cap < DR_MIN_MM) {
        /* estira el hueco lo MÍNIMO imprescindible para un salto de 6 mm */
        float need = DR_MIN_MM*K_RAD_S_PER_MM + RAD_MARGIN_S
                     - OVERLAP_FRAC*k->t_contact_s;
        k->gap_s = fmaxf(k->gap_s, need);
        dr_cap   = DR_MIN_MM;
    }
    if (dr_cap > DR_CAP_MM) dr_cap = DR_CAP_MM;

    /* 4. sortea el nuevo radio y recalcula el dwell que queda */
    k->R_next_mm = draw_R(r1, r2, dr_cap);
    k->dR_mm     = fabsf(k->R_next_mm - r1);
    k->dwell_s   = k->gap_s - t_flight;
    if (k->dwell_s < 0.0f) k->dwell_s = 0.0f;
}
```

### 5.6 Ejecución de una pasada

```c
/* Convierte velocidad de punta a frecuencia de paso. ω = v/R: al cambiar R
   HAY que reescalar, o la punta va un 8 % más rápida en un extremo del carro. */
static float steps_per_s(float v_cms, float R_mm) {
    float mm_per_fullstep = 0.6597f * (R_mm / R_NOM_MM);
    return (v_cms*10.0f) / mm_per_fullstep;
}

void run_stroke(stroke_t *k) {
    float phi0 = k->side * PHI_LIFT_DEG;   // arranca en el borde de la meseta

    /* --- A) descenso hacia la piel, EN EL AIRE, a v_fly --- */
    move_to_angle(-k->side * PHI_TAPER_DEG * 0.0f + k->side*PHI_TAPER_DEG,
                  V_FLY_CMS, A_FLY_MMS2);   // llega a ±26° YA a v_stroke
    decel_to(k->v_cms, A_FLY_MMS2);         // toda la aceleración ocurre fuera de piel

    /* --- B) contacto. VELOCIDAD CONSTANTE. Ni una aceleración sobre piel. --- */
    if (k->is_graze) {
        /* rozada: invierte DENTRO de la descarga; nunca entra en la zona plena.
           Perfil de fuerza triangular 0 → F_pico → 0: la única modulación
           de fuerza intra-pasada que esta máquina sabe hacer. */
        float phi_g = PHI_TAPER_DEG - 7.0f*k->graze_F_mn/N_PLENA_MN;
        sweep_const_v(k->side*PHI_TAPER_DEG, k->side*phi_g,          k->v_cms, k->R_mm);
        sweep_const_v(k->side*phi_g,         k->side*PHI_TAPER_DEG,  k->v_cms, k->R_mm);
        /* la rozada NO cambia de lado */
    } else {
        /* completa: cruza al otro lado. 273 mm de contacto, 199 de ellos a 400 mN.
           Aterrizaje geométrico de 36,65/v segundos: 0,52..1,83 s. */
        sweep_const_v(k->side*PHI_TAPER_DEG, -k->side*PHI_TAPER_DEG, k->v_cms, k->R_mm);
        k->side = -k->side;
    }

    /* --- C) subida por el despegue y arranque del movimiento radial --- */
    /* El carro se mueve solapado con el ÚLTIMO 20 % de la pasada: el raspado de
       las fibras enmascara el 28BYJ-48, que es el único evento impulsivo del ciclo.
       (Aquí se lanza asíncrono; el arranque real va dentro de sweep_const_v.) */
    radial_move_async(k->R_next_mm);

    accel_to(V_FLY_CMS, A_FLY_MMS2);
    move_to_angle(k->side * k->phi_rev_deg, V_FLY_CMS, A_FLY_MMS2);

    /* --- D) dwell en la meseta. Aquí es donde vive el hueco. --- */
    if (k->side > 0) driver_set_ihold(0.00f);   // el tope cautivo la sostiene: 0 A
    else             driver_set_ihold(0.18f);   // C-06: 0,05 A NO basta; se escaparía
    wait_s(k->dwell_s);
    radial_wait();                              // por si el carro aún no ha llegado
    driver_set_irun();
}
```

### 5.7 El tope de 10 cm/s: en el PIO, no en un `if`

```c
/* El techo de velocidad NO es una comprobación de firmware. Es un SUELO DE TIEMPO
   compilado en la memoria de instrucciones del PIO: el programa no puede emitir
   dos pulsos separados por menos de T_MIN, aunque el core 0 esté colgado en un
   bucle infinito escribiendo periodos de cero.

   0,6597 mm/paso completo a R=300 → /32 = 20,62 µm por µpaso de 1/32.
   A 10 cm/s: 20,62 µm / 100 mm/s = 206 µs.
   Pero a R=325 el paso vale 0,7147 mm → 22,33 µm → 223 µs.
   223 µs sería el valor JUSTO (10,00 cm/s a R=325, cero margen). El programa PIO
   realmente compilado —04-electronica.md §2 y el firmware— usa 240 µs, que deja el
   techo en 9,30 cm/s a R=325, 8,59 a R=300 y 7,87 a R=275, todos bajo el clamp de 10.
   USA 240. */
#define PIO_T_MIN_US   240
```

### 5.8 El lazo principal

```c
void session(void) {
    /* ---- 0. semilla: sin esto, todas las noches son la misma noche (§9) ---- */
    uint32_t seed = harvest_entropy();      // ROSC + ADC + botón + contador NVS
    seed_prng(seed);
    log_printf("PLUMA-R semilla = %08lX\n", seed);
    nvs_push_seed(seed);                    // anillo de las últimas 16

    /* ---- 1. precalentamiento en la cuna, motor APAGADO (C-07) ---- */
    heater_on(33.0f);
    driver_disable();
    wait_s(60.0f);                          // FUERA de los 900 s: el TPL5010 conserva su margen

    /* ---- 2. homing contra el microrruptor de reposo ---- */
    driver_enable();
    home_to_park_switch();

    /* ---- 3. estado inicial ---- */
    ou_t ou; ou_init(&ou, V0_CMS, BLOCK_MU[0], OU_SIGMA_INF, OU_TAU_STROKES);
    float r1 = 0.0f, r2 = 13.0f;            // "previas" ficticias, separadas > 6 mm
    float R  = R_NOM_MM;
    int   side = +1;                        // arranca en el lado del reposo
    float t = 0.0f;
    int   block = 0;
    bool  park_used[N_BLOCKS] = {0};

    while (t < SESSION_S) {

        /* ---- 4. ¿toca cambiar de bloque? El OU NO se reinicia: sólo cambia μ,
                  y la reversión hace la transición en ~6 pasadas (~75 s). ---- */
        int nb = (int)(t / BLOCK_S); if (nb > N_BLOCKS-1) nb = N_BLOCKS-1;
        if (nb != block) { block = nb; ou.mu = BLOCK_MU[block]; }

        /* ---- 5. rampas de entrada y de salida ---- */
        float p_graze = P_GRAZE_RUN, F_lo = GRAZE_F_MIN_MN, F_hi = GRAZE_F_MAX_MN;
        if (t < RAMP_IN_S) {
            float x = t / RAMP_IN_S;
            p_graze = P_GRAZE_IN + (P_GRAZE_RUN - P_GRAZE_IN)*x;
            F_hi    = 150.0f + 150.0f*x;    F_lo = 150.0f;
        } else if (t > SESSION_S - RAMP_OUT_S) {
            float x = (t - (SESSION_S - RAMP_OUT_S)) / RAMP_OUT_S;
            p_graze = P_GRAZE_RUN + (P_GRAZE_OUT - P_GRAZE_RUN)*x;
            ou.mu   = 2.2f;  ou.a = expf(-1.0f/3.0f); ou.b = sqrtf(1-ou.a*ou.a);
            F_hi    = 300.0f - 150.0f*x;    F_lo = fmaxf(150.0f, F_hi - 50.0f);
        }

        /* ---- 6. sortear la pasada ---- */
        stroke_t k = {0};
        k.side       = side;
        k.R_mm       = R;
        k.v_cms      = ou_step(&ou);
        k.is_graze   = rnd_bern(p_graze);
        k.graze_F_mn = rnd_range(F_lo, F_hi);

        float contact_mm = k.is_graze
              ? 2.0f*arc_mm(7.0f*k.graze_F_mn/N_PLENA_MN, R)
              : 2.0f*arc_mm(PHI_TAPER_DEG, R);          // 272,3 mm a R=300
        k.t_contact_s = contact_mm / (k.v_cms*10.0f);

        /* un parking largo por bloque, en un punto aleatorio del 60 % central */
        bool want_park = (!park_used[block]) && (side > 0)
                       && rnd_u() < 0.08f
                       && (t - block*BLOCK_S) > 0.2f*BLOCK_S
                       && (t - block*BLOCK_S) < 0.8f*BLOCK_S;
        if (want_park) park_used[block] = true;

        plan_gap_and_radial(&k, R, r2, want_park);

        /* ---- 7. ejecutar ---- */
        if (!safety_ok()) { abort_cycle(); return; }    // microrruptor, StallGuard, NTC
        run_stroke(&k);

        /* ---- 8. avanzar el estado ---- */
        r2 = r1;  r1 = k.R_next_mm;  R = R_NOM_MM + k.R_next_mm;
        side = k.side;
        t += k.t_contact_s + k.gap_s;
        coverage_log(k.R_next_mm);        // histograma de cobertura (§10.4)
    }

    /* ---- 9. fin normal: SIEMPRE desde el lado del reposo ---- */
    if (side < 0) {                        // una última pasada de cruce, controlada
        stroke_t k = {0}; k.side = side; k.R_mm = R; k.v_cms = 2.5f;
        k.t_contact_s = 2.0f*arc_mm(PHI_TAPER_DEG,R)/25.0f;
        k.phi_rev_deg = 38.0f; k.dwell_s = 0.0f; k.R_next_mm = R - R_NOM_MM;
        run_stroke(&k);
    }
    move_to_angle(PHI_PARK_DEG, 4.0f, A_FLY_MMS2);   // entra en la cuna despacio
    require_park_switch_closed();                    // integridad final
    driver_disable();                                // el contrapeso la sostiene sin corriente
    heater_off();
}
```

### 5.9 Contadores y coste

| | |
|---|---|
| Líneas de código del generador | ~260 (de las ~450 del firmware completo) |
| Llamadas al PRNG por pasada | 12 (gaussiana) + 5 (hueco, inversión, rozada, F, parking) ≈ **17** |
| Llamadas al PRNG por sesión | ~1 300 |
| Operaciones en coma flotante por pasada | ~80, una vez cada ~12 s → **irrelevante** |
| RAM del generador | 4 words de PRNG + 1 ou_t + 1 stroke_t + histograma de 50 bytes ≈ **120 B** |


---

<a name="6"></a>
## 6. TABLA MAESTRA DE PARÁMETROS AJUSTABLES

Cuatro grupos. El primero es **mecánico** (destornillador, no teclado) y es el único que puede cambiar la fuerza. Los otros tres son firmware.

### 6.1 Parámetros mecánicos (los únicos que tocan la fuerza)

| Parámetro | Por defecto | Rango seguro | Subirlo | Bajarlo |
|---|---|---|---|---|
| **`x_lastre`** — posición del lastre de latón de 40 g sobre la botavara | **125 mm** | 40 – 200 mm | Más fuerza. `N = 0,040875·(4785 + 40·x)` mN. Sensibilidad **1,635 mN/mm**. A 200 mm son 523 mN: más «presencia», más rozamiento, más abrasión | Menos fuerza. A 40 mm son 261 mN: se acerca al régimen de knismesis. **Por debajo de ~250 mN empieza a sentirse como cosquilla, no como caricia** |
| **`h_patín`** — tornillo M4 de altura del patín | mitad del recorrido | ±12 mm | Sube el riel efectivo: la brocha despega antes, la zona de fuerza plena se acorta | Baja el riel: la descarga se come parte de la meseta y **la brocha puede no despegar del todo**. Es el ajuste de puesta a punto de cada sesión |
| **Brocha** | kabuki cabra 60 mm | 50 o 60 mm | 60 mm: 52 mm de contacto, 0,19 kPa. Más antitickle | 50 mm: más «línea dibujada», menos «lavado ancho». Cambio en 10 s |

Estos tres **no están en el firmware a propósito**. La fuerza normal no tiene actuador; ningún bug puede subirla.

### 6.2 Parámetros del generador de velocidad

| Parámetro | Por defecto | Rango seguro | Efecto de SUBIRLO | Efecto de BAJARLO |
|---|---|---|---|---|
| `BLOCK_MU[i]` | 3,2 / 2,6 / 4,1 / 2,9 cm/s | 2,2 – 6,0 | Pasadas más cortas y frecuentes, aterrizajes más rápidos (rampa = 36,65/v), sensación más «viva» y menos hipnótica. Por encima de ~5 cm/s se sale del pico de placer CT | Pasadas largas y densas, rampas de hasta 1,83 s, más hipnótico. Por debajo de 2,4 cm/s la reflexión en el suelo empieza a dominar (>20 % de rebotes) |
| `OU_SIGMA_INF` | **0,8 cm/s** | 0,3 – 1,6 | Más variedad entre pasadas, menos habituación… pero más error de predicción: por encima de ~1,3 la sensación empieza a leerse como errática | Más previsible y más calmado. **A 0 el algoritmo se convierte en el firmware ingenuo del §1 y habitúa en 2 min** |
| `OU_TAU_STROKES` | **6 pasadas** | 2 – 20 | La velocidad deriva más despacio: rachas largas de ritmo parecido (~ τ·12 s de «humor» constante). Por encima de 15 se parece a bloques fijos | Deriva más rápido; con τ < 3 la velocidad salta casi independientemente entre pasadas y se acerca al ruido blanco |
| `V_MIN_CMS` / `V_MAX_CMS` | 2,0 / 7,0 | 1,5–3,0 / 5,0–9,0 | Banda más ancha = más variedad, pero se sale de la banda óptima CT (1–10 cm/s) | Banda estrecha = más constancia = más saciedad |
| `log_mode` | **false** | true/false | Modo logarítmico: σ relativa constante, la mitad de rebotes en los bloques lentos, variabilidad más «natural» a todas las velocidades | Modo lineal (contrato). Más rebotes con μ bajo |
| `V0_CMS` | **2,2 cm/s** | 2,0 – 3,5 | Arranque más rápido: menos rampa de entrada natural | Arranque más lento y suave. Es la rampa de entrada gratis |
| `INTRA_STROKE_DRIFT` | **off** | off / ±6 % | «Temblor de mano»: deriva de ±6 % dentro de la pasada con a < 2 mm/s². Puede quitar el sabor a máquina… o meter cosquilla | Velocidad estrictamente constante dentro de la pasada (regla R1) |

### 6.3 Parámetros del hueco y del vuelo

| Parámetro | Por defecto | Rango seguro | Efecto de SUBIRLO | Efecto de BAJARLO |
|---|---|---|---|---|
| `GAP_MIN_S` | **1,5 s** | 1,4 – 3,5 | Huecos siempre generosos: más recuperación del aferente CT, sensación más espaciada | Por debajo de **1,47 s es geométricamente imposible** (tiempo de vuelo). Y por debajo de ~1,2 s el CT no se recupera: las pasadas se funden en una sola sensación continua = habituación |
| `GAP_MAX_S` | **5,5 s** | 3,0 – 8,0 | Más allá de ~5,5 s la post-descarga CT se extingue y cada pasada llega «en frío»: rompe la continuidad. A veces es exactamente lo que quieres (ver preset lento) | Huecos cortos: más denso, más dosis, más abrasión. Además reduce el margen para el carro radial |
| `PARK_MIN_S` / `PARK_MAX_S` | 8 / 20 s | 5 – 30 s | Rupturas más marcadas de la cadena perceptual. Con IHOLD = 0: silencio total | Menos ruptura; con 0 parkings la sesión se vuelve monótona en su macroestructura |
| **`V_VUELO_MMS`** (A-01) | **7,5 cm/s** | 3,0 – 7,8 | Vuelos más cortos ⇒ el hueco es casi todo dwell ⇒ más margen para el carro radial. Nunca toca la piel, así que no hay coste perceptual | Vuelos largos: por debajo de ~4 cm/s el suelo del hueco sube por encima de 2,5 s y se pierden los huecos cortos. Ventaja: menos ruido de motor |
| `A_FLY_MMS2` | 200 mm/s² | 60 – 400 | Transiciones más rápidas fuera de piel. Por encima de ~400 la aceleración no cabe en los 41,89 mm de la zona de despegue | Más suave mecánicamente, pero alarga el vuelo |
| `SETTLE_S` | 0,30 s | 0,15 – 0,60 | Margen para el cambio de DIR y la recogida de holgura del tendón. Subirlo si oyes un «tac» al invertir | Bajarlo aprieta el suelo del hueco |
| `PHI_REV_LO/HI_DEG` | 35 / 41° | 34,5 – 42 | Ventana de inversión más ancha = más jitter rítmico. **No aporta migración de huella** (C-03) | Ventana estrecha = ritmo más isócrono = regla R5 más débil |

### 6.4 Parámetros de rozadas, radio y sesión

| Parámetro | Por defecto | Rango seguro | Efecto de SUBIRLO | Efecto de BAJARLO |
|---|---|---|---|---|
| `P_GRAZE_RUN` | **0,15** | 0,00 – 0,40 | Más roces cortos y suaves en los extremos de la extremidad; menos dosis total y menos abrasión; más textura. Por encima de 0,4 la sesión se vuelve «picoteo» y se pierde la caricia larga | A 0 desaparece la única modulación de fuerza intra-pasada de la máquina |
| `GRAZE_F_MIN/MAX` | 150 / 300 mN (= 0,375 / 0,75 × N_plena) | 0,25 – 0,85 × N_plena | Roces más marcados, más cerca de la pasada completa | Roces más leves. **Por debajo de ~0,3 × N_plena entras en el régimen de cosquilleo** |
| `DR_MIN_MM` | **6,0 mm** | 4,0 – 10,0 | Migración más agresiva entre pasadas. Por encima de 10 mm el conjunto factible se estrecha y el paseo se vuelve casi determinista (ping-pong) | Por debajo de ~4 mm el salto es menor que un campo receptor CT y **deja de des-habituar**: es el número que justifica todo el eje 6 |
| `DR_CAP_MM` | **12,0 mm** | 8 – 20 | Saltos más grandes, cobertura más rápida… pero exige huecos más largos (0,50 s por mm) y por tanto estira el ciclo | Saltos pequeños: el carro tarda menos, caben huecos cortos, pero la cobertura de la banda de 50 mm es más lenta |
| `K_RAD_S_PER_MM` | **0,50 s/mm** | 0,45 – 0,70 | **NO es un ajuste: es una medida.** Mídelo en banco (§10.3). Si tu 28BYJ-48 va a 12 rpm en vez de 15, son 0,63 s/mm y todo el planificador se recalibra solo |
| `OVERLAP_FRAC` | **0,20** | 0,10 – 0,40 | Más ventana para el carro ⇒ saltos mayores con los mismos huecos. **Efecto secundario interesante:** con 0,40 el carro se mueve durante el último 40 % de la pasada, lo que sesga la trayectoria hasta ~3,8°: la única forma que tiene la máquina de dibujar una diagonal (§8.1) | Menos enmascaramiento del ruido del 28BYJ-48 si baja mucho; por debajo de 0,10 el motorcillo suena aislado en el silencio |
| `BLOCK_S` / `N_BLOCKS` | 225 s × 4 | 180–300 s × 3–5 | Bloques largos: más carácter por bloque, más habituación dentro de cada uno | Bloques cortos: más variedad macro, pero el OU (τ ≈ 75 s) no llega a asentarse en la nueva μ |
| `RAMP_IN_S` / `RAMP_OUT_S` | 50 / 60 s | 30 – 120 s | Entradas y salidas más graduales; menos sobresalto al empezar y menos «corte» al acabar | Por debajo de ~30 s la primera pasada completa llega antes de que la piel se haya acostumbrado |

---

<a name="7"></a>
## 7. TRES PRESETS COMPLETOS

El usuario pidió explícitamente poder conseguir **«más suave»**, **«más intenso»** y **«más lento»**. Aquí están los tres, con **todos** los valores. Cada uno tiene un componente mecánico (mover el lastre) y uno de firmware.

### 7.1 Tabla comparativa de los tres presets

| Parámetro | **BASE** | **MÁS SUAVE** | **MÁS INTENSO** | **MÁS LENTO** |
|---|---|---|---|---|
| **`x_lastre` (mm)** | **125** | **76** | **168** | **125** (sin cambio) |
| **Fuerza plena resultante** | **400 mN** | **320 mN** | **470 mN** | **400 mN** |
| `BLOCK_MU` (cm/s) | 3,2 / 2,6 / 4,1 / 2,9 | 2,9 / 2,5 / 3,3 / 2,7 | 3,6 / 3,0 / 4,6 / 3,4 | 2,6 / 2,3 / 3,0 / 2,4 |
| Media de bloques | 3,20 | 2,85 | 3,65 | 2,58 |
| `OU_SIGMA_INF` (cm/s) | 0,80 | **0,50** | **1,00** | **0,45** |
| `OU_TAU_STROKES` | 6 | **8** | **5** | **9** |
| `log_mode` | false | **true** | false | **true** |
| `V0_CMS` | 2,2 | 2,0 | 2,8 | 2,0 |
| `GAP_MIN_S` / `GAP_MAX_S` | 1,5 / 5,5 | **2,5 / 6,5** | **1,5 / 4,0** | **3,5 / 7,0** |
| `PARK_MIN_S` / `PARK_MAX_S` | 8 / 20 | 10 / 25 | 6 / 14 | **12 / 30** |
| `V_FLY_CMS` | 8,0 | 7,0 | 9,0 | **5,0** |
| `P_GRAZE_RUN` | 0,15 | **0,30** | **0,05** | 0,15 |
| `GRAZE_F` (× N_plena) | 0,375 – 0,75 | **0,375 – 0,70** | **0,50 – 0,85** | 0,375 – 0,75 |
| `DR_MIN_MM` / `DR_CAP_MM` | 6 / 12 | 6 / 10 | **7 / 14** | 6 / 12 |
| `OVERLAP_FRAC` | 0,20 | 0,20 | **0,30** | 0,20 |
| `RAMP_IN_S` / `RAMP_OUT_S` | 50 / 60 | **90 / 90** | 40 / 50 | **90 / 100** |
| `INTRA_STROKE_DRIFT` | off | off | ±6 % | off |

### 7.2 Consecuencias calculadas de cada preset

*Cifras obtenidas con el mismo modelo temporal de la §0.2 (arco de contacto / v + tiempo de vuelo + planificador del carro). La fila BASE está validada contra 400 sesiones simuladas; las otras tres son propagación analítica del mismo modelo y hay que confirmarlas en banco (§10.5).*

| Magnitud | BASE | MÁS SUAVE | MÁS INTENSO | MÁS LENTO |
|---|---|---|---|---|
| Velocidad media realizada | 3,38 cm/s | **2,98 cm/s** | **3,80 cm/s** | **2,72 cm/s** |
| Duración de una pasada completa | 8,06 s | 9,14 s | 7,17 s | **10,01 s** |
| Rampa de aterrizaje media | 1,08 s | **1,23 s** | 0,96 s | **1,35 s** |
| Hueco medio realizado | 3,57 s | **4,60 s** | **2,85 s** | **5,35 s** |
| Periodo entre pasadas completas | 13,8 s | 16,3 s | **10,4 s** | **19,0 s** |
| Pasadas completas por sesión | ~65 | **~48** | **~82** | **~44** |
| Pasadas rozadas por sesión | ~12 | **~21** | **~4** | ~8 |
| Camino sobre piel | 18,3 m | **13,9 m** | **23,0 m** | **12,4 m** |
| Impulso total (∫N·ds) relativo | 1,00 | **0,61** | **1,48** | 0,68 |
| Movimientos del carro por sesión | ~77 | ~69 | ~86 | ~52 |
| Ruido: eventos del 28BYJ-48 por minuto | 5,1 | 4,6 | 5,7 | **3,5** |

### 7.3 «MÁS SUAVE» — para cuando la sensación resulta demasiado presente

**Qué se cambia y por qué:**

1. **Lastre a x = 76 mm ⇒ 320 mN.** Es el cambio dominante: baja la fuerza un 20 %. **No bajes más de 260–280 mN**: por debajo de ~250 mN estás entrando en el régimen de knismesis (cosquilla de insecto) que todo el proyecto existe para evitar. 320 mN sigue estando dentro de la meseta de placer medida.
2. **Velocidades medias bajas (2,85 cm/s) y σ pequeña (0,50).** Menos sorpresa entre pasadas, aterrizajes más largos (1,23 s de media), pasadas más lentas y más envolventes.
3. **Modo logarítmico activado.** Con μ = 2,5 y σ lineal habría un 25 % de rebotes en el suelo; el modo log lo baja a ~10 %.
4. **Huecos largos (2,5–6,5 s).** Más recuperación aferente, menos densidad.
5. **`p_graze = 0,30`.** Casi un tercio de las pasadas son roces de 120–224 mN en los extremos. Baja el impulso total un 39 % respecto a la base.
6. **Rampas de 90 s.** La sesión tarda un minuto y medio en llegar a su intensidad de crucero.

**Resultado:** dosis total un 39 % menor, cada evento individual más suave y más largo, y la mitad de la abrasión. Es el preset para noches en que la piel está sensible o en que 400 mN se sienten «demasiado máquina».

### 7.4 «MÁS INTENSO» — cuando no se nota lo suficiente

**Qué se cambia y por qué:**

1. **Lastre a x = 168 mm ⇒ 470 mN.** Un 18 % por encima del óptimo medido de 400 mN. **No pases de 523 mN** (x = 200 mm, tope físico de la escala): más allá deja de ser caricia y empieza a ser masaje.
2. **Velocidades más altas (media 3,80 cm/s) y σ = 1,0.** Más variedad, ritmo más vivo.
3. **Huecos cortos (1,5–4,0 s).** La sesión se vuelve densa: 82 pasadas completas frente a 65.
4. **`p_graze = 0,05` y roces más profundos (0,50–0,85 × N_plena).** Casi todo son pasadas completas.
5. **`OVERLAP_FRAC = 0,30` y `DR_CAP = 14 mm`.** Saltos radiales mayores para compensar el aumento de dosis. **Esto es obligatorio en este preset**, no opcional: con un 26 % más de camino sobre piel, la migración tiene que ir más rápida o la abrasión se dispara.
6. **`INTRA_STROKE_DRIFT` activado a ±6 %.** Es el preset donde el riesgo de que suene a cosquilla es menor (más fuerza ⇒ menos knismesis), así que es donde tiene sentido probar el temblor intra-pasada.

**Advertencia honesta:** este preset entrega un **48 % más de impulso** sobre la piel que el base y 23 m de camino en vez de 18,3 m. La literatura de desgaste del estrato córneo es explícita sobre lo que ocurre con el frotamiento repetido, y la alloknesis convierte piel irritada en piel que pica con la caricia ligera. **Úsalo en noches alternas, no todas las noches, y revisa la piel al cabo de una semana.** Si aparece enrojecimiento, vuelve a la base.

### 7.5 «MÁS LENTO» — el preset hipnótico

**Qué se cambia y por qué:**

1. **El lastre NO se toca.** 400 mN sigue siendo el óptimo de placer. «Lento» no es «flojo».
2. **Velocidades muy bajas (media 2,72 cm/s), σ = 0,45, τ = 9 pasadas.** El humor de la máquina cambia muy despacio: 9 pasadas son casi tres minutos.
3. **Huecos de 3,5–7,0 s.** Esto **extiende deliberadamente la banda de 5,5 s del contrato.** Justificación: el hueco es tiempo fuera de la piel y no puede hacer daño; y por encima de ~5 s la post-descarga CT se extingue, de modo que **cada pasada llega como un evento nuevo en vez de como continuación de la anterior**. Es exactamente lo que se busca en un preset hipnótico. El techo se pone en 7,0 s porque más allá la sesión se rompe en eventos inconexos.
4. **`V_FLY = 5,0 cm/s`.** Como los huecos son largos, no hace falta volar rápido — y volar despacio significa menos ruido de motor. Es el preset más silencioso: **3,5 eventos de carro por minuto** frente a 5,1 del base.
5. **Parkings de 12–30 s.** Silencios largos con IHOLD = 0: la máquina literalmente desaparece durante medio minuto.
6. **Rampas de 90 y 100 s.** Entrada y salida muy graduales.

**Resultado:** sólo 44 pasadas completas y 12,4 m de camino, pero cada una dura 10 s con una rampa de aterrizaje de 1,35 s. Es el preset con menos dosis, menos ruido y menos abrasión de los cuatro, y probablemente el mejor candidato para uso nocturno diario.

### 7.6 Cómo se seleccionan

Tres opciones, por orden de sencillez:

1. **Pulsación larga del botón de arranque:** 1 pulsación = BASE, 2 = SUAVE, 3 = INTENSO, 4 = LENTO, indicado por parpadeos del LED rojo. Cero hardware adicional.
2. **Un jumper de 2 bits** en dos GPIO con pull-up: 4 combinaciones.
3. **Consola serie** por USB: `preset suave`, `set sigma 0.6`, `seed 4A2F91C0`. Es lo que se usa durante la puesta a punto.

**El lastre hay que moverlo a mano en los presets suave e intenso.** Es deliberado y es la garantía de seguridad de todo el proyecto: **ningún preset de firmware puede cambiar la fuerza sobre la piel.** Si el firmware pudiera moverla, no habría techo de fuerza mecánico, y el techo mecánico es la razón por la que puedes dormirte con esto puesto.


---

<a name="8"></a>
## 8. LO QUE ESTA MECÁNICA NO PUEDE VARIAR

Esta sección existe porque el documento sería deshonesto sin ella. Ningún firmware arregla nada de lo que sigue.

### 8.1 La forma del arco es fija

La punta describe **siempre** un arco de circunferencia de radio 275–325 mm que se comba 15,0–17,7 mm respecto a su cuerda. Es la geometría de una botavara rígida girando sobre un eje vertical. Punto.

```
        lo que hace la máquina                 lo que hace una mano
        ──────────────────────                 ────────────────────
         ╭───────────────────╮                    ╭─╮   ╭──╮
        ╱                     ╲                  ╱   ╲ ╱    ╲___
       ╱   arco fijo, sagita   ╲                ╱     V         ╲
      ╱    16,3 mm, siempre     ╲              ╱  S, diagonales,  ╲
     ╱      el mismo dibujo      ╲            ╱  espirales, sigue  ╲
    ╱                             ╲          ╱     el contorno      ╲
```

**No hay:** curvas en S, diagonales, espirales, círculos, trazos que sigan el contorno del cuerpo, ni trayectorias que cambien de forma. Sólo cambia el *radio* del arco (±25 mm) y con él su longitud (182–216 mm) y su comba (15,0–17,7 mm).

**La única excepción, y es pequeña.** Si `OVERLAP_FRAC` se sube a 0,40, el carro radial se mueve durante el último 40 % de la pasada, a 2 mm/s radiales mientras la punta avanza a 30 mm/s tangenciales. Eso inclina la trayectoria **3,8°** durante ese tramo: una diagonal muy leve sobre los últimos ~109 mm. Es literalmente la única forma que tiene esta máquina de dibujar algo que no sea su arco, y no es gran cosa. Está disponible como experimento.

**Consecuencia adicional del arco.** La comba de 16,3 mm hace rodar el contacto unos 24° alrededor de un antebrazo a mitad de pasada, lo que baja la fuerza normal efectiva un ~9 % y añade un pequeño barrido lateral de las cerdas en el centro de la pasada. No es desagradable, pero no es lo que hace una mano.

### 8.2 La dirección alterna en TODAS las pasadas completas

Una persona repite en la misma dirección: acaricia hacia abajo, levanta la mano, vuelve arriba por el aire, acaricia hacia abajo otra vez. **Esta máquina no puede.**

La razón es puramente geométrica: **no hay riel sobre el centro del barrido**. El riel sólo existe entre 19° y 43° a cada lado. Entre −19° y +19° la brocha está siempre a 400 mN sobre la piel porque no hay nada que la levante. Por tanto, para volver al punto de partida hay que cruzar la piel otra vez.

```
   perfil del riel (altura del patín contra φ)

   11,8mm ┤        ╭─────╮                     ╭─────╮
          │       ╱       ╲                   ╱       ╲
    2,6mm ┤     ╱           ╲               ╱           ╲
          │   ╱               ╲___________╱               ╲
      0   ┼──┴──────────────────────────────────────────────┴──►φ
        −43 −34 −26 −19        0        +19 +26 +34 +43
                    └────── SIN RIEL: 199 mm ──────┘
                         no se puede volar por encima
```

Poner riel en el centro significaría levantar la brocha 12 mm por encima de la piel en la zona de contacto, es decir **eliminar la zona de contacto**. No es un problema de firmware ni de dinero: es que la única superficie que puede levantar la brocha es la misma sobre la que tiene que apoyarse.

**Magnitud del coste perceptual: desconocida.** La literatura no lo dice. Es una de las preguntas abiertas del proyecto y sólo se resuelve construyéndolo.

### 8.3 No hay modulación de presión dentro de una pasada completa

La fuerza normal es **un lastre de latón de 40 g y la gravedad**. Ese eje no tiene actuador, no tiene sensor y no tiene código. `k_tip = 0` sobre ±25 mm de flotación, así que la fuerza tampoco cambia con la respiración ni con el movimiento del cuerpo.

Lo que eso significa en la práctica:

| Lo que una mano hace | Lo que esta máquina hace |
|---|---|
| Aprieta un poco más en el centro del trazo | 400 mN constantes de −19° a +19° |
| Suaviza al llegar al codo | Sí — pero por geometría del riel, no por decisión: la descarga de 36,65 mm es fija |
| Cambia la presión según cómo respiras | Nada. `k_tip = 0`: la fuerza es la misma con el brazo 25 mm más arriba o más abajo |
| Hace un roce apenas perceptible y luego uno firme | Sí, pero sólo con **pasadas rozadas**, y sólo en los extremos (§3.5) |

**Las dos únicas modulaciones de fuerza que existen** son (a) la rampa geométrica de 0→400→0 mN en las zonas de descarga, idéntica en todas las pasadas, y (b) el perfil triangular 0→F_pico→0 de una pasada rozada. Nada más.

**Y esto es a propósito.** Es la razón por la que puedes dormirte con el aparato puesto: la fuerza máxima que esta máquina puede aplicar sobre una persona dormida es un lastre de 40 g, y ningún fallo de firmware, ningún enganche del driver ni ninguna carrera del watchdog puede subirla, porque ese eje no tiene actuador. Renunciar a la modulación de presión es el precio del techo mecánico, y es un buen negocio.

### 8.4 Lo que tampoco varía

| Cosa | Por qué es fija |
|---|---|
| **Anchura de contacto: 52 mm** | Es la brocha. Cambiarla es cambiar de cabezal (10 s), no un parámetro |
| **Puntos de entrada y salida sobre la piel: ±26° siempre** | El riel está atornillado a la columna. Ni el jitter de inversión ni nada más los mueve (C-03) |
| **Temperatura de contacto** | La constante térmica de la férula de silicona es de minutos; no hay control por pasada. La cuna a 35 °C y el elemento de 120 Ω lo mantienen en 32–33 °C y ya está |
| **Longitud de la pasada, salvo por R** | 249,6 / 272,3 / 295,0 mm según R = 275 / 300 / 325. Nada más |
| **Colocación y oblicuidad de 12°** | Es una plantilla impresa y una decisión manual del usuario cada noche |
| **La aceleración al inicio y al final de cada pasada** | No existe: toda la aceleración ocurre en el aire, en la zona de despegue. La brocha aterriza ya a velocidad de crucero |

### 8.5 El límite honesto de todo el algoritmo

Hay que decirlo tal cual: **la irregularidad de esta máquina es un paseo de Ornstein-Uhlenbeck sobre cinco parámetros. Es estadísticamente irregular pero estructuralmente predecible.** Un cerebro que dedique atención sostenida a modelarla tiene, al cabo de diez minutos, un modelo bastante bueno: sabe que las pasadas duran entre 4 y 14 s, que van de un extremo al otro y vuelven, que el hueco está entre 1,5 y 5,5 s, y que la forma del trazo no cambia nunca.

Lo que el algoritmo compra de verdad es esto:

- **No hay isocronía** (regla R5), así que no hay entrenamiento rítmico.
- **No hay velocidad constante** (regla R2), así que no se ejecuta el protocolo de saciedad de Triscoli.
- **No hay repetición de huella** (regla R4), así que el pico de presión cambia de población aferente cada pasada.
- **No hay dwell estático** (regla R3), así que el CT nunca se agota del todo.

Los cuatro son necesarios. Ninguno es suficiente para simular una mano. **Si a los ocho minutos la sensación se aplana igualmente, la respuesta correcta no es más firmware: es un tercer eje** que mueva la trayectoria de verdad (por ejemplo un carro que también gire la base, o un carro radial de ±40 mm en vez de ±25). Esto está escrito aquí para que, si ocurre, no se pierdan tres semanas retocando parámetros.

---

<a name="9"></a>
## 9. SEMILLA ALEATORIA: POR QUÉ Y CÓMO

### 9.1 Por qué NO puede haber una semilla fija

Un PRNG con semilla constante es **determinista**. Si el firmware arranca siempre con `seed = 12345`, entonces:

1. **Todas las noches son literalmente la misma noche.** La misma secuencia de 65 velocidades, los mismos 65 huecos, los mismos 65 radios, en el mismo orden. La sesión es irregular *dentro* de sí misma pero **idéntica entre noches**, y el argumento de habituación del §1 se aplica entonces a escala de días en vez de a escala de minutos. Es el mismo fallo, sólo que más lento y más difícil de diagnosticar.
2. **El histograma de cobertura es el mismo cada noche.** Las mismas líneas de piel reciben el pico de presión noche tras noche. Todo el argumento de abrasión y alloknesis del §1.3 se vuelve **acumulativo entre sesiones**, que es peor que dentro de una sesión, porque no hay recuperación de por medio.
3. **No se puede hacer A/B.** No hay forma de saber si un cambio de parámetro mejoró algo, porque no hay repetición independiente.

Es el error más barato de cometer y uno de los más caros de detectar: la máquina funciona perfectamente y simplemente deja de gustar al cabo de dos semanas.

### 9.2 De dónde sacar entropía en un RP2040

Cuatro fuentes, todas gratis, todas independientes. **Se usan las cuatro y se mezclan**, porque cada una tiene un modo de fallo distinto.

| Fuente | Bits útiles | Cómo | Modo de fallo |
|---|---|---|---|
| **Oscilador en anillo (ROSC)** | ~100 | Leer `rosc_hw->randombit` con ≥ 1 µs entre lecturas, 128 veces, con desesgo de Von Neumann | Puede quedar enganchado a la frecuencia del sistema. Detectable: cuenta de 0/1 fuera de 45–55 % |
| **Ruido del ADC** | ~30 | 256 lecturas del sensor de temperatura interno (canal 4) a 500 kS/s, quedarse con el bit 0 de cada una, plegar por XOR | Un pin de ADC flotante puede engancharse a un valor estable. **Usa el sensor de temperatura interno, no un pin flotante** |
| **Instante del pulsador** | ~17 + ~10 | `time_us_32()` en el flanco de bajada del botón de arranque + la duración de la pulsación en ms + el tiempo transcurrido desde el arranque | Sólo falla si el arranque es automático (no lo es: siempre lo pulsa una persona) |
| **Contador NVS** | 32 (garantizados únicos) | Un entero de 32 bits en flash que se incrementa y se guarda en cada arranque | Ninguno. **Es la red de seguridad**: aunque las tres anteriores devolvieran ceros, dos sesiones nunca serían iguales |

El instante del pulsador merece un comentario. La variabilidad humana al pulsar un botón es de ±100 ms como poco; el campo de microsegundos de `time_us_32()` tiene por tanto ~17 bits de entropía real. Es una fuente excelente y no cuesta nada, y tiene la propiedad bonita de que **la aleatoriedad de la noche la aporta literalmente el usuario al apretar el botón**.

### 9.3 Cosecha y mezcla

```c
uint32_t harvest_entropy(void) {
    uint64_t h = 0xCBF29CE484222325ULL;                 // FNV-1a de 64 bits
    #define MIX(x) do { h ^= (uint64_t)(x); h *= 0x100000001B3ULL; } while (0)

    /* 1) ROSC: 128 bits crudos, con >= 1 µs entre lecturas */
    for (int i = 0; i < 128; i++) { MIX(rosc_hw->randombit); busy_wait_us(1); }

    /* 2) ADC: sensor de TEMPERATURA INTERNO (nunca un pin flotante) */
    adc_set_temp_sensor_enabled(true); adc_select_input(4);
    for (int i = 0; i < 256; i++) MIX(adc_read() & 1u);

    /* 3) el usuario: microsegundo del flanco, duración de la pulsación, uptime */
    MIX(g_button_edge_us);          // capturado en la ISR del botón
    MIX(g_button_hold_ms);
    MIX(time_us_32());

    /* 4) red de seguridad: contador persistente. Garantiza unicidad SIEMPRE. */
    uint32_t n = nvs_read_u32("boot_count"); nvs_write_u32("boot_count", n+1);
    MIX(n);

    /* SplitMix64 final para difundir los bits antes de sembrar */
    h += 0x9E3779B97F4A7C15ULL;
    h = (h ^ (h >> 30)) * 0xBF58476D1CE4E5B9ULL;
    h = (h ^ (h >> 27)) * 0x94D049BB133111EBULL;
    return (uint32_t)(h ^ (h >> 31));
}

void seed_prng(uint32_t seed) {
    /* xoshiro128starstar necesita 128 bits de estado y NO puede arrancar todo a cero.
       Se expande la semilla con SplitMix32, que es lo que recomiendan sus autores. */
    uint32_t z = seed ? seed : 0xA5A5A5A5u;
    for (int i = 0; i < 4; i++) {
        z += 0x9E3779B9u;
        uint32_t t = z;
        t = (t ^ (t >> 16)) * 0x21F0AAADu;
        t = (t ^ (t >> 15)) * 0x735A2D97u;
        s[i] = t ^ (t >> 15);
    }
    for (int i = 0; i < 20; i++) rng_next();   // calentamiento
}
```

### 9.4 Qué generador usar y cuál NO

**Usa `xoshiro128starstar`** (o PCG32). Estado de 128 bits, periodo 2¹²⁸−1, ~10 líneas, pasa BigCrush.

**No uses `rand()`.** En muchas implementaciones de libc es un LCG de 15 o 31 bits cuyos **bits bajos son casi periódicos**: el bit 0 alterna con periodo 2, el bit 1 con periodo 4, y así. La consecuencia práctica en este proyecto sería visible: `rand() % 50` para sortear R produce **valores en bandas**, y el histograma de cobertura de §3.6.4 saldría con dientes de sierra en vez de plano. Es un fallo real, no una preocupación teórica.

Presupuesto: ~1 300 llamadas al PRNG por sesión, unas 475 000 al año. Cualquier generador decente sobra por muchos órdenes de magnitud; el problema nunca es el periodo, siempre es la calidad de los bits bajos.

### 9.5 Registrar y poder repetir la semilla

Dos requisitos que parecen contradictorios y no lo son:

1. **Cada sesión debe ser distinta** (por todo lo anterior).
2. **Debes poder repetir exactamente una sesión concreta** — porque si una noche funciona especialmente bien, quieres saber por qué, y porque sin reproducibilidad no puedes depurar.

Solución: la semilla se **imprime** por la consola serie al arrancar (`PLUMA-R semilla = 4A2F91C0`) y se guarda en un **anillo de las últimas 16 semillas en NVS**. Un comando `seed 4A2F91C0` fuerza esa semilla en la siguiente sesión. Con la versión entera del OU (§2.5), la reproducción es **exacta bit a bit** en cualquier compilador.

### 9.6 Prueba de aceptación de la entropía

En la puesta en marcha, tres comprobaciones (§10.6 las repite como checklist):

1. **Arranca la máquina 20 veces seguidas** y anota las semillas. Ninguna puede repetirse, y no puede haber una relación evidente entre ellas (por ejemplo, incrementos constantes: eso significaría que sólo funciona el contador NVS).
2. **Compara los 10 primeros valores de R** de 20 sesiones. No puede haber dos secuencias iguales.
3. **Prueba de sesgo del ROSC:** cuenta 4 096 bits crudos y comprueba que la proporción de unos está entre el 45 % y el 55 %. Si está fuera, el ROSC está enganchado; no pasa nada grave (quedan las otras tres fuentes), pero conviene saberlo y quitarlo de la mezcla.

---

<a name="10"></a>
## 10. PUESTA EN MARCHA Y VERIFICACIÓN DEL ALGORITMO

Esto se hace **antes** de dormir con el aparato y **después** de las pruebas mecánicas y de seguridad de `02-mecanica.md` y `04-electronica.md`.

### 10.1 Orden de las pruebas

| # | Prueba | Qué se comprueba | Criterio |
|---|---|---|---|
| 1 | Estadística del OU en banco (sin motor) | Generador de velocidad | media = μ ±0,02 · σ = 0,80 ±0,02 · ρ(1) = 0,846 ±0,005 sobre 100 000 iteraciones |
| 2 | Prueba de la regla de 6 mm (sin motor) | `draw_R` no se cuelga y respeta la regla | 100 000 sorteos: **cero** violaciones de \|ΔR\| ≥ 6, cero bucles > 10 ms |
| 3 | Medida de `K_RAD_S_PER_MM` | El 28BYJ-48 real | Cronometrar 10 movimientos de 10 mm. Meter el valor medido en el firmware |
| 4 | Tope del PIO | Suelo de tiempo compilado | Forzar por consola un periodo de 0 µs; la punta no debe pasar de 10 cm/s medidos con vídeo |
| 5 | Ciclo en seco de 15 min sobre almohada lastrada | Tiempos, cobertura, ausencia de contacto en los huecos | §10.4 |
| 6 | Prueba de la semilla | Entropía | §9.6 |
| 7 | Ruido del carro en la almohada | Enmascaramiento | Δ ON/OFF < 3 dB sobre el ruido de fondo |

### 10.2 Prueba 1 — Estadística del OU

Compila el generador como un programa de PC (es C puro, sin dependencias del RP2040) y ejecuta 100 000 iteraciones para cada μ de bloque. Compara con la tabla de §2.6. **Si ρ(1) sale cerca de 0,5 en vez de 0,846, tienes un desplazamiento mal puesto en la versión entera.** Si σ sale 0,83 en vez de 0,80, has implementado Euler-Maruyama en vez de la discretización exacta.

### 10.3 Prueba 3 — Medir `K_RAD_S_PER_MM`, que NO es un parámetro sino una medida

El 28BYJ-48 nominal da 15 rpm en el eje de salida, lo que con un husillo T8 de 8 mm de paso son 2 mm/s y `K_RAD = 0,50 s/mm`. **Pero eso es el máximo de catálogo con poca carga y 5 V limpios.** Un ejemplar real con el carro montado puede quedarse en 12 rpm, es decir 1,6 mm/s y `K_RAD = 0,63 s/mm`, un 26 % peor.

Procedimiento: con el carro montado y la botavara puesta, cronometra diez movimientos de 10 mm de extremo a extremo y toma la media. Si el valor sale por encima de **0,70 s/mm**, el planificador se queda sin margen y hay dos salidas: bajar `DR_CAP_MM` a 8 mm, o subir `OVERLAP_FRAC` a 0,30.

Todo el planificador de §3.6.3 está escrito en función de esta constante, así que cambiar un número basta.

### 10.4 Prueba 5 — El ciclo en seco de 15 minutos

Con la máquina apuntando a una almohada lastrada, con un folio marcado bajo la brocha, y con la consola serie grabando.

**Qué debe registrar el firmware** (una línea por pasada, CSV):

```
   n, t, tipo, v_cms, R_mm, dR_mm, F_pico_mN, t_contacto_s, hueco_s, dwell_s, phi_rev, lado
```

**Qué se comprueba en ese registro:**

| Comprobación | Criterio |
|---|---|
| Número total de pasadas completas | 55 – 76 |
| Duración total | 900 ± 5 s |
| \|ΔR\| ≥ 6 mm respecto a las **dos** anteriores | **100 % de las pasadas**, sin excepción |
| Histograma de R en 10 bandas de 5 mm | ninguna banda > 1,6× la media ni < 0,5× la media |
| Hueco: mínimo, mediana, máximo | ≥ 1,47 s · ~3,5 s · ≤ 5,5 s (salvo parkings) |
| Parkings largos | exactamente 4, todos con `lado = +1` |
| Velocidad: histograma | dentro de 2,0–7,0, sin acumulación en los bordes (si hay un pico exactamente en 2,00 **has implementado recorte en vez de reflexión**) |
| Periodo entre pasadas: desviación típica | ≥ 1,0 s (si es ~0, el ritmo es isócrono y falla la regla R5) |

**Y la comprobación visual, que es la que de verdad importa:** filma el ciclo. En cada hueco la brocha debe estar **completamente separada** del folio. Si en algún hueco roza, el patín está mal ajustado (`h_patín`, §6.1) o la almohada está demasiado alta.

### 10.5 Prueba de los presets

Los tres presets de §7 tienen números calculados, no simulados. Ejecuta un ciclo en seco de cada uno y anota las cuatro cifras clave: pasadas completas, camino total, hueco medio y periodo medio. Si alguna se desvía más de un 15 % de la tabla de §7.2, corrige la tabla — **no el preset**.

### 10.6 Checklist final antes de dormir con ello

- [ ] Estadística del OU verificada (prueba 1)
- [ ] `draw_R` sin violaciones ni bloqueos en 100 000 sorteos (prueba 2)
- [ ] `K_RAD_S_PER_MM` **medido** y metido en el firmware (prueba 3)
- [ ] Tope del PIO verificado con vídeo, no con un `printf` (prueba 4)
- [ ] Tres ciclos en seco completos con registro CSV (prueba 5)
- [ ] En los tres ciclos, cero contacto durante los huecos, comprobado en vídeo
- [ ] 20 arranques con 20 semillas distintas (prueba 6)
- [ ] Δ de ruido en la almohada < 3 dB con el carro moviéndose (prueba 7)
- [ ] Y las pruebas de seguridad de `02-mecanica.md`: tirón de USB, paro de emergencia y firmware colgado a mitad de pasada, **en las tres la brocha debe abandonar la piel**

---

<a name="11"></a>
## 11. CONTRADICCIONES ENCONTRADAS EN LA ESPECIFICACIÓN VINCULANTE

Recopilación de todo lo corregido, con la aritmética a la vista. El detalle está en §0.3.

| # | Contradicción | Aritmética | Corrección |
|---|---|---|---|
| C-01 | Ciclo de 13,9 s / 64 pasadas contra huecos de media 3,5 s | 272,3/30 = 9,08 s + 3,5 = **12,6 s**, no 13,9 | Los 13,9 s son correctos **una vez se incluye el estiramiento del hueco por el carro radial**. Simulado: 13,76 s y 65,4 pasadas |
| C-01b | «~19 m de camino sobre piel» | 64 × 0,273 = **17,5 m** | Con las 65,4 pasadas completas + 12 rozadas simuladas salen **18,3 m**. Los 19 m son un 4 % optimistas |
| C-02 | Rampa de aterrizaje 0,6–2,5 s | 36,65 mm ÷ (20…70 mm/s) = **0,52–1,83 s**. Para 2,5 s harían falta 1,47 cm/s, por debajo del suelo del propio contrato | Rango real 0,52–1,83 s. **Magnitud derivada, no eje independiente.** Coincide con C6 de `02-mecanica.md` |
| C-03 | «El punto de inversión mueve el segmento de fuerza plena ±16 mm» | El riel está fijo a la columna; el contacto empieza y acaba en φ = ±26° **siempre** | **Falso.** El jitter de inversión no migra la huella. Se conserva sólo por el jitter rítmico |
| C-04 | «Velocidad nominal 3,0 cm/s (media OU)» | Bloques 3,2/2,6/4,1/2,9 → media 3,20; la reflexión en el suelo de 2,0 añade +0,1…+0,3 → **3,38 cm/s medidos** | Se declara la media real 3,3–3,4 cm/s. Tabla de calibración en §2.6 |
| C-05 | «Hueco totalmente desacoplado de la velocidad de pasada» | Cruzar la zona de despegue (41,89 mm × 2) a 2 cm/s cuesta 4,39 s: **el hueco mínimo de 1,5 s es imposible** | Adición A-01: velocidad de vuelo `v_fly` independiente (8 cm/s). Con ella el suelo baja a 1,40 s y el desacoplo es real |
| C-06 | «IHOLD 0,05 A para dwells cortos en el lado lejano» | Sostener contra el contrapeso pide 247/14,29 = **17,3 mN·m**; 0,05 A dan ~5,2 mN·m | **IHOLD_lejano = 0,18 A.** Y regla: todos los parkings largos (>6 s) en el lado del reposo |
| C-07 | «60 s de precalentamiento con la brocha apoyada en la piel» | ~0,25 A durante 60 s + señal CT que cae a cero en 5 s | Precalentamiento **en la cuna calefactada a 35 °C**, motor desenergizado, fuera de los 900 s |
| C-08 | Meseta «33–40°, 37 mm» (spec) contra «34–43°, 31,4 mm» (`02-mecanica.md`) | 9° a R=300 son 47,1 mm, no 31,4 | **No hay contradicción real:** la meseta física es 34–43° (47,1 mm) y la ventana **utilizable** de inversión es 35–41° = 6° = **31,42 mm = ±15,7 mm ≈ ±16 mm**. Los dos documentos dicen lo mismo |
| C-09 | «El carro radial reduce la habituación» sin cuantificar | La brocha carga **52 mm** y la banda de migración es de **50 mm**: la brocha es más ancha que la migración | El carro **no reduce el número de contactos** en las líneas centrales. Reduce la dosis ponderada por presión un **1,45×**, y la dosis de pico de presión un **2,5×**. Sigue siendo imprescindible, pero el beneficio es ese y no más (§1.4) |
| C-10 | «Movimiento radial de 2,5 s por cada 5 mm» sin cap de salto | Un salto libre dentro de ±25 mm promedia **20,7 mm = 10,3 s**, más que cualquier hueco | Adición A-02: cap dinámico `ΔR_max = (0,20·t_contacto + hueco − 0,40)/K_rad`, limitado a 12 mm. \|ΔR\| medio realizado: **7,70 mm** |
| C-11 | La regla de ≥6 mm con muestreo por rechazo | Con un cap superior el conjunto factible puede quedar **vacío** (p.ej. R₁=−25, cap=12, R₂=−16) → bucle infinito | **Aritmética de intervalos con relajación jerárquica** (§3.6.2). El mínimo de 6 mm nunca se relaja; se relajan primero la penúltima y luego el cap |

**Ninguna de estas correcciones cambia la arquitectura, la seguridad ni el presupuesto.** Todas son de aritmética temporal o de implementación, y todas empujan en la misma dirección: la máquina real es un poco más lenta y un poco menos ambiciosa de lo que decía el papel, y hay que decirlo.

---

## APÉNDICE A — RESUMEN DE UNA PÁGINA

```
  GEOMETRÍA (fija, en madera)
    contacto 0..±26°  ·  plena 0..±19° (199 mm, 400 mN)  ·  descarga 19..26° (36,65 mm, 400→0)
    despegue 26..34° (41,89 mm)  ·  meseta 34..43°  ·  inversión útil 35..41° (±15,7 mm)
    R = 300 ± 25 mm  ·  arco de contacto 249,6 / 272,3 / 295,0 mm  ·  sagita 15,0 / 16,3 / 17,7 mm

  LOS SIETE EJES
    1. v pasada        2,0–7,0 cm/s   OU exacto, τ=6 pasadas, σ_∞=0,8, REFLEXIÓN (no recorte)
                                      v_{n+1} = μ + 0,846482(v_n−μ) + 0,425933·N(0,1)
    2. hueco           1,4–5,5 s      uniforme, suelo geométrico, parkings 8–20 s sólo en +
    3. rampa           0,52–1,83 s    DERIVADA = 36,65/v. No es un eje
    4. inversión       ±15,7 mm       uniforme. Jitter rítmico, NO migración
    5. rozadas         0,375–0,75×N   p=0,15. Única modulación de fuerza intra-pasada
    6. radio R         ±25 mm         ΔR ∈ [6, 12] mm, ≥6 contra las DOS anteriores
    7. v_fly           7,5 cm/s       fuera de piel; sin esto el hueco no se desacopla

  SESIÓN
    −60 s cuna a 35 °C (motor OFF)  →  4 bloques × 225 s, μ = 3,2 / 2,6 / 4,1 / 2,9 cm/s
    rampa entrada 50 s (OU arranca en 2,2 + p_graze 0,70)  ·  rampa salida 60 s (p_graze 0,80)
    1 parking largo por bloque, siempre en el lado del reposo

  SALIDA ESPERADA
    65 pasadas completas + 12 rozadas  ·  13,76 s de periodo  ·  18,3 m sobre piel
    hueco medio 3,57 s  ·  v media 3,38 cm/s  ·  |ΔR| medio 7,70 mm  ·  banda mojada 118 mm

  LO QUE NUNCA CAMBIA
    la forma del arco  ·  la alternancia de dirección  ·  la presión dentro de la pasada
    los puntos de entrada y salida (±26°)  ·  la anchura de contacto (52 mm)

  SEMILLA
    ROSC + ADC interno + microsegundo del pulsador + contador NVS → FNV-1a → SplitMix64
    → xoshiro128starstar  ·  se imprime y se guarda: `seed 4A2F91C0` repite una noche exacta
```
