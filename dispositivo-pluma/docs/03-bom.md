# 03 — LISTA DE MATERIALES (BOM) — PLUMA-R

Documento de compra del dispositivo PLUMA-R (barrido de brazo con contrapeso, carril de leva fija y carro radial de migración).
Deriva directamente de `final_spec.md`. Donde la especificación vinculante contiene un error aritmético o una imposibilidad
física, este documento **lo corrige y lo señala** en la sección 12; no lo esconde.

**Fecha de referencia de precios: septiembre 2026. Moneda: EUR, IVA español (21 %) incluido.**

---

## 0. CÓMO USAR ESTE DOCUMENTO

Lee en este orden:

1. **Sección 1 — Advertencias de compra críticas.** Cinco de las piezas de esta lista se venden mayoritariamente en una
   variante que **no sirve** para este proyecto. Si compras sin leer esta sección vas a recibir un husillo cuatro veces
   más lento, un driver falsificado que zumba, y una brocha de 40 mm vendida como "grande".
2. **Sección 2 — BOM A (núcleo).** Lo que hay que comprar sí o sí.
3. **Secciones 3-5 — B (calidad), C (herramientas), D (consumibles).**
4. **Sección 6 — Alternativas línea a línea.** Qué hacer si la pieza X está agotada.
5. **Sección 7 — Camino sin impresora 3D.** Este diseño **no necesita impresora en ningún punto**; aquí está el detalle.
6. **Sección 8 — Los tres presupuestos.**
7. **Sección 10 — Presupuesto eléctrico**, que es lo que justifica el cargador de 5 V 2 A.

### Nivel de confianza de los precios

El informe de sourcing de la investigación fue elaborado con `WebFetch` bloqueado por el proxy de salida: **ninguna
página de producto de Amazon.es ni de AliExpress pudo ser leída directamente**. Los precios de este BOM proceden de
fragmentos de búsqueda y de calibración de mercado. He verificado en esta sesión, por búsqueda, cuatro anclas:

| Ancla verificada | Dato | Uso en el BOM |
|---|---|---|
| StepperOnline 11HS12-0674S | 9,78 USD, NEMA 11, 28×28×31-33 mm, 1,8°, 0,67 A, 3,8 V, 7 N·cm, 4 hilos, almacén DE | línea A-01 a 9,00 € |
| BIGTREETECH TMC2209 V1.3 | ~6,95 USD/ud suelto, más barato en pack de 5 | línea A-02 a 5,50 € |
| T8: existen listados "Lead 2mm" y "Lead 8mm (Pitch 2mm, 4 starts)" | el listado por defecto es Lead 2 mm | advertencia 1.3 |
| Brocha kabuki pelo de cabra | se vende en tiendas de estética españolas (Produpel, Perfect Beauty, Clips Hair), no solo Amazon | línea A-37 |

Marco cada línea con una etiqueta de confianza:
**[V]** verificado por búsqueda · **[C]** calibrado de mercado, ±25 % · **[E]** estimación, ±40 %, revísalo al comprar.

> **AliExpress oscila ±40 % con las campañas.** Trata todos los números como presupuesto, no como presupuesto cerrado.

---

## 1. ADVERTENCIAS DE COMPRA CRÍTICAS

### 1.1 TMC2209 FALSIFICADO — la compra que puede arruinar el proyecto entero

El proyecto entero depende de un driver que sea **realmente** un Trinamic/Analog Devices TMC2209 corriendo StealthChop2.
Un clon re-marcado mueve el motor perfectamente en el banco y solo se delata a la una de la mañana, como un zumbido que
cruza la habitación a oscuras. Habrás pagado por silencio y habrás recibido un A4988. La diferencia medida sobre la
misma máquina es **62 dBA (A4988) → 44 dBA (TMC2209 StealthChop)**: 18 dB, un factor ~4 de sonoridad percibida.

**Reglas de compra (en orden de fuerza):**

1. Compra en la **BIGTREETECH Official Store** de AliExpress, la **FYSETC Official Store**, o en **Watterott** (DE, la
   casa original del SilentStepStick). Nunca a un vendedor genérico con foto de catálogo.
2. **Compra DOS.** Cuestan 5,50 € cada uno. Con dos puedes hacer A/B: montas uno, mueves el motor a 45 pasos/s con
   StealthChop activo; el auténtico es prácticamente inaudible, el falso zumba como un A4988.
3. Marcado: el chip auténtico dice **TMC2209-LA** con el logo Trinamic/ADI y un código de lote legible, grabado por
   láser. Sospecha de: serigrafía en vez de láser, letras borrosas o mal espaciadas, superficie con marcas finas de
   lijado (marca antigua rebajada), o una etiqueta genérica "Stepper Driver Module" en la cara inferior.

**PRUEBA DEFINITIVA — lectura del registro IOIN por UART.** Es la prueba más barata que existe y no necesita
microscopio. El campo `VERSION` (bits 31:24 del registro `IOIN`, dirección 0x06) **debe leer 0x21**.

```cpp
// TMCStepper — RP2040-Zero, UART a 115200
#include <TMCStepper.h>
#define R_SENSE 0.11f          // <-- BIGTREETECH V1.2/V1.3 = 0.11 ohm.  Watterott = 0.11.  VER 1.2 ABAJO.
#define DRIVER_ADDRESS 0b00
TMC2209Stepper driver(&Serial1, R_SENSE, DRIVER_ADDRESS);

void setup() {
  Serial.begin(115200);
  Serial1.begin(115200);
  driver.begin();

  uint8_t conn = driver.test_connection();      // 0 = OK
  uint32_t ioin = driver.IOIN();
  uint8_t  ver  = (ioin >> 24) & 0xFF;          // <-- DEBE SER 0x21

  Serial.printf("test_connection=%u  IOIN=0x%08lX  VERSION=0x%02X\n", conn, ioin, ver);
  if (ver != 0x21) Serial.println("### DRIVER SOSPECHOSO: DEVUELVELO ###");
}
```

Un clon sin UART funcional se desenmascara en una línea. Si `test_connection()` devuelve distinto de 0, revisa primero
el cableado (TX del MCU al pin PDN_UART a través de una resistencia de 1 kΩ, masa común) antes de acusar al driver.

### 1.2 TMC2209 — la resistencia de sensado cambia la corriente real un 36 %

`R_SENSE` **no es la misma en todas las placas**:

| Placa | R_sense | Si declaras 0,11 y es 0,15 |
|---|---|---|
| BIGTREETECH TMC2209 V1.2 / V1.3 | 0,11 Ω | — |
| Watterott SilentStepStick TMC2209 | 0,11 Ω | — |
| Algunos clones y placas antiguas | 0,15 Ω | corriente real **+36 %** sobre la pedida |

La especificación fija **IRUN = 0,33 A rms (49 % del nominal de 0,67 A)**. Con `R_SENSE = 0,11` y VSENSE=1 (V_fs = 0,180 V):

```
I_rms = (CS+1)/32 · V_fs/(R_sense + 0,02) · 1/raiz(2)
      = (CS+1)/32 · 0,180/0,13 · 0,7071 = (CS+1)/32 · 0,9791
CS = 10  ->  I_rms = 11/32 · 0,9791 = 0,337 A   (correcto)
```

Con TMCStepper basta `driver.rms_current(330);` **si y solo si** `R_SENSE` está declarado correctamente.
Comprueba además la corriente real: 0,33 A rms por fase sobre 5,6 Ω = **1,22 W** en el motor; mide la caída de 5 V con
una pinza o con el multímetro en serie y comprueba **~0,29 A de entrada** (ver sección 10).

Config obligatoria además: `TPWMTHRS = 0xFFFFF` (StealthChop permanente), microstep 1/32 con MicroPlyer,
y la **maniobra oculta de sintonía AT#2 al arrancar**: 1,2 s a 400 pasos/s con el brazo parado contra el tope exterior,
guardando `PWM_OFS`/`PWM_GRAD` en flash y reaplicándolos en cada arranque. StealthChop2 **nunca completa AT#2** a
30-106 pasos/s, que es todo el rango de trabajo, y sin AT#2 aparece un siseo fino.

### 1.3 HUSILLO T8 — tiene que ser de AVANCE 8 mm, y el que se vende por defecto es de 2 mm

Este es el error de compra más probable de toda la lista, porque la nomenclatura de los vendedores es confusa y el
listado por defecto en AliExpress es el equivocado.

| Lo que dice el listado | Paso | Entradas | Avance por vuelta | ¿Sirve? |
|---|---|---|---|---|
| "T8 Lead Screw OD 8mm **Pitch 2mm Lead 2mm**" | 2 mm | 1 | **2 mm** | **NO** |
| "T8 Lead Screw OD 8mm Pitch 2mm **Lead 4mm**" | 2 mm | 2 | 4 mm | NO |
| "T8 / Tr8x8 **Pitch 2mm, 4 Starts, Lead 8mm**" | 2 mm | **4** | **8 mm** | **SÍ** |

**Por qué importa, con números:**

- Con avance 8 mm: mover el carro 5 mm = 0,625 vuelta. A ~15 rpm de salida del 28BYJ-48 = **2,5 s**. Correcto.
- Con avance 2 mm: 5 mm = 2,5 vueltas = **10 s**. La migración radial ya no cabe en el solape con la cola del golpe
  anterior, y el ruido del 28BYJ-48 deja de estar enmascarado por el raspado de la fibra.
- Peor aún: el ángulo de hélice cae de 17,7° a 4,55°. Con µ≈0,15 (φ=8,5°) el husillo de 2 mm es **autoblocante**, y el
  de 8 mm es **retro-conducible**, que es lo que permite `IHOLD = 0` en el eje radial. Cambiar el avance cambia la
  historia de seguridad, no solo la velocidad.

Verificación al recibirlo: **una vuelta completa a mano = 8,0 mm de desplazamiento de la tuerca**. Mídelo con el calibre.
A ojo: el husillo de 4 entradas tiene una hélice visiblemente inclinada y cuatro surcos que entran en paralelo.

Compra el conjunto **husillo + tuerca de latón juntos**; una tuerca T8 genérica puede ser de 2 mm y no engranará.

### 1.4 28BYJ-48 — tiene que venir con su ULN2003, y tiene que ser el de 5 V

- El 28BYJ-48 se vende también en **versión 12 V** (marcado `28BYJ-48-12V`). En este proyecto la alimentación es 5 V
  nativa: si compras el de 12 V dará poco par y se saltará pasos. Comprueba el marcado en el lateral azul: **`28BYJ-48-5V`**.
- **Debe venir con la placa ULN2003** (5 LEDs, conector blanco de 5 vías, cuatro entradas IN1-IN4). Se venden por
  separado y la placa suelta cuesta casi lo mismo que el conjunto. El listado correcto se anuncia como
  "28BYJ-48 5V Stepper Motor + ULN2003 Driver Board".
- La especificación **no** convierte este motor a bipolar (esa modificación existe, cortando la pista de toma central
  bajo la tapa azul, y permitiría driverlo con un segundo TMC2209). Aquí no hace falta: el motor solo se mueve 2,5 s por
  desplazamiento, ~12 veces por sesión, y siempre con la brocha a 11,8 mm de la piel. Se queda con el ULN2003.
- Compra un pack de 5 (~7 €) en lugar de una unidad (~1,80 €) si quieres repuestos: la caja reductora de plástico es
  la pieza más frágil de todo el aparato.

### 1.5 BROCHA KABUKI — pelo de cabra NATURAL, 60 mm, y "grande" no significa 60 mm

La anchura de contacto de 52 mm cargados es **la principal defensa estructural contra la knismesis** (el cosquilleo
irritante). Es la línea del BOM en la que menos conviene ahorrar.

Especificación de compra:
- **Pelo de cabra natural** (no taklon sintético, salvo alergia). La rigidez por filamento del pelo de cabra es la más
  baja disponible a este precio, y la rigidez de la cerda influye en el placer percibido **más que ninguna otra
  variable de la piel**.
- **Diámetro del penacho ≥ 58 mm** medido en la virola, sin cargar. El diámetro cargado a 400 mN sale ~52 mm.
- **Longitud libre de cerda ≥ 30 mm** desde la virola. Es lo que da los 6,9 mm de compresión a 400 mN con k≈58 N/m,
  y lo que hace que el carril funcione: `subida de la rampa = (0,400/k_brocha)/2,67`.
- **Compra DOS**, y de recorte distinto si puedes. No es opcional. El modo de fallo insidioso del aparato es que la
  brocha se apelmaza con sebo cutáneo, la fuerza sigue clavada en 400 mN porque `k_tip = 0`, la huella se encoge, y
  la sensación deriva en semanas desde caricia amplia hacia cosquilleo puntual **sin que lo notes**.

**Trampa de listado.** Muchas fichas de Amazon.es llaman "kabuki grande" a una brocha de 40 mm, y muchas dan el
diámetro de la **base de la virola**, no del penacho. Filtra por la foto con una regla al lado o compra en tienda de
suministros de peluquería/estética española, donde el producto se cataloga como "Brocha Kabuki Grande / pelo cabra"
(Produpel, Perfect Beauty nº22, Clips Hair) y puedes preguntar la medida. Precio realista **6-12 €**.

Verificación al recibirla: apóyala en la báscula de cocina hasta que marque **41 g** (= 402 mN) y mide la compresión
de la cerda. Debe estar entre **8 y 13 mm**. Ese número es el que hay que meter en la fórmula de la rampa del carril,
y **no cortes el carril antes de medirlo**.

### 1.6 EL CABRESTANTE NO CABE EN UN 623ZZ — corrección obligatoria

La especificación dice *"cabrestante de vástago de tornillo M8 en 2× 623ZZ, r_eff 4,2 mm"*. **Es imposible: el 623ZZ
tiene 3 mm de diámetro interior.** Un tornillo M8 (vástago Ø8,0 mm) no entra.

El r_eff de 4,2 mm (= 4,0 mm de vástago + 0,2 mm de medio diámetro de cordón) **es correcto y es el que da la reducción
de 14,29:1** (sector 60 mm / 4,2 mm). Lo que hay que cambiar es el rodamiento:

| Opción | Rodamiento | Ø interior | Comentario |
|---|---|---|---|
| **Elegida** | **688ZZ (8×16×5)** ×2 | 8 mm | Pequeño, barato, silencioso. |
| Alternativa | 608ZZ (8×22×7) ×2 | 8 mm | Sirve igual, ocupa más y ya lo compras para el eje de barrido. |
| **Descartada** | 623ZZ (3×10×4) | 3 mm | No entra el M8. Con eje de 3 mm r_eff=1,7 mm y la reducción sube a 35:1, rompiendo todo el contrato numérico. |

El **623ZZ sigue en el BOM**, pero solo como **polea de reenvío del cordón del contrapeso** sobre un tornillo M3, que
es el uso para el que sí vale.

### 1.7 CARGADOR USB — el único riesgo de incendio del aparato está aquí

Los 5 V DC son SELV e intrínsecamente seguros al tacto. El riesgo vive entero en el lado de red. Electrical Safety First
ensayó 116 cargadores falsificados o imitación: **107 (92 %) fallaron ensayos críticos de aislamiento**.

- Compra un cargador **de marca, con marcado IEC 62368-1**, en un establecimiento serio. Nunca una imitación de
  marketplace, nunca "el que venía con algo".
- **5 V 2 A** es de sobra (ver sección 10: pico 0,80 A). Un 5 V 1 A también funcionaría, pero 2 A da margen contra la
  caída del cargador barato bajo carga.
- El cargador va sobre superficie dura, **nunca bajo la almohada, el edredón ni sobre el colchón**.
- **Nada de LiPo ni 18650.** Los bomberos advierten explícitamente contra colocar o cargar celdas de litio en una cama.
  Aquí no aportarían nada.

### 1.8 CABLE USB — un cable malo provoca brownout del TMC2209

El TMC2209 exige **VM ≥ 4,75 V**. A 0,80 A de pico:

| Cable | R ida+vuelta | Caída a 0,80 A | V en el driver | Veredicto |
|---|---|---|---|---|
| 28 AWG, 2 m (cable de datos barato) | 0,85 Ω | **0,68 V** | **4,32 V** | **BROWNOUT** |
| 26 AWG, 1,5 m | 0,40 Ω | 0,32 V | 4,68 V | Al límite, falla |
| 24 AWG, 1 m | 0,17 Ω | 0,13 V | 4,87 V | Justo |
| **20-22 AWG, 0,5 m (cable de carga)** | 0,03-0,07 Ω | **0,03-0,06 V** | **4,94-4,97 V** | **Correcto** |

Compra un cable **corto (0,5 m) y de carga** (20-22 AWG en los conductores de potencia; los "cable de carga rápida
3 A" lo son). Además: **condensador de 470 µF/10 V low-ESR con patas cortas a los pines VM/GND del driver**, obligatorio.
Verificación de puesta en marcha: multímetro en VM del TMC2209 con el motor moviéndose y el 28BYJ-48 en marcha; **debe
mantenerse ≥ 4,85 V**.

### 1.9 ALIEXPRESS — IVA, aduanas y el umbral de 150 €

- Desde 2021 AliExpress **cobra el 21 % de IVA español en el checkout** para envíos con valor intrínseco ≤ 150 €.
  Ese IVA ya está incluido en los precios de este BOM.
- **Por encima de 150 € de valor intrínseco por envío**, el IVA y los aranceles los liquida el transportista en
  destino y añade una **tasa de gestión de despacho de ~12-18 €**. Consecuencia práctica: **divide el pedido en dos
  envíos de menos de 150 €** en vez de hacer uno de 200 €. Es más barato, aunque parezca lo contrario.
- Filtra por **"Envío desde España"** en las piezas que lo tengan: 3-7 días en lugar de 10-20, con un sobreprecio del
  10-20 % que aquí compensa.
- Consolida: el envío se cobra **por pedido**. Tres pedidos separados triplican el envío y pueden añadir semanas.

### 1.10 PLOMO — manipulación

El contrapeso (360-484 g) y opcionalmente el lastre de 40 g son de plomo. Encapsúlalos en termorretráctil o cinta
antes de montarlos, lávate las manos después de manipularlos, y no los limes en interiores. Alternativas sin plomo en
la sección 6.

---

## 2. BOM A — NÚCLEO IMPRESCINDIBLE

### A.1 Electrónica y control

| Ref | Descripción | Cant | €/ud | € tot | Proveedor | Nota de compra | Conf |
|---|---|---:|---:|---:|---|---|:--:|
| A-01 | Motor paso a paso **NEMA 11 11HS12-0674S** — 28×28×31 mm, 1,8°, 0,67 A/fase, 3,8 V, 5,6 Ω, 3,6 mH, 7 N·cm, eje Ø5 mm, 4 hilos | 1 | 9,00 | 9,00 | StepperOnline (almacén DE/FR) o AliExpress *OMC-StepperOnline Official Store* | La referencia exacta. **No** el 11HS12-0956S (0,95 A) ni el 11HS20 (cuerpo largo). Comprueba **4 hilos** (bipolar), no 6. | **[V]** |
| A-02 | Driver **TMC2209 V1.3 BIGTREETECH** con disipador | 1 | 5,50 | 5,50 | AliExpress **BIGTREETECH Official Store** / Watterott (DE) | Ver 1.1 y 1.2. Anota si R_sense es 0,11 Ω. El pack de 5 sale a ~4 €/ud si tienes otros proyectos. | **[V]** |
| A-03 | MCU **RP2040-Zero** (Waveshare) | 1 | 4,50 | 4,50 | AliExpress / Amazon.es | **No sustituible por un Arduino Nano**: la especificación exige un límite de velocidad de punta a 10 cm/s implementado como **intervalo mínimo entre pasos compilado en el PIO**. Eso es hardware del RP2040. | **[C]** |
| A-04 | **28BYJ-48-5V + placa ULN2003** | 1 | 1,80 | 1,80 | AliExpress / Amazon.es | Ver 1.4. Verifica el marcado `-5V`. | **[V]** |
| A-05 | **TPL5010** (SOT-23-6) + placa adaptadora SOT23→DIP | 1 | 2,20 | 2,20 | AliExpress / Mouser ES | Temporizador nanopower independiente, 100 ms-7200 s, 35 nA. Es el **one-shot absoluto de 16 min** que corta la alimentación del motor pase lo que pase con el firmware. | **[C]** |
| A-06 | Kit *heartbeat*: P-MOSFET AO3401 (o IRF9540N) + 2× 1N4148 + 100 nF + 1 µF + 1 MΩ + 10 kΩ | 1 | 1,20 | 1,20 | AliExpress (surtido) | Bomba de carga rectificada desde un GPIO en cuadrada de ~1 kHz. Si el MCU se cuelga, se resetea o el pin se queda fijo (alto **o** bajo), el condensador se descarga en ~200 ms y **quita la alimentación del motor**. Un pin pegado no puede mantener el motor encendido. | **[C]** |
| A-07 | Pulsador **enclavado 16 mm, contacto NC**, para parada dura | 1 | 3,00 | 3,00 | AliExpress / Amazon.es | Va **físicamente en serie con el raíl de alimentación del motor**, no solo leído por GPIO. Debe funcionar con el firmware muerto. | **[C]** |
| A-08 | Pulsador de arranque **de cúpula de silicona** (o módulo TTP223 capacitivo) | 1 | 1,00 | 1,00 | AliExpress | **No un táctil de 6 mm estándar**: hace clic audible, y lo pulsa alguien que ya está intentando dormirse. Exige pulsación deliberada de 300 ms en firmware. | **[C]** |
| A-09 | **Microrruptor de palanca** SPDT (tipo Omron D2F / KW11) | 1 | 0,40 | 0,40 | AliExpress (pack de 10 ~2 €) | Hace tres trabajos: homing absoluto, integridad por ciclo, y corrección automática de pasos perdidos. Sustituye a un AS5600 por 0,40 €. | **[C]** |
| A-10 | LED rojo 3 mm difuso + resistencia 22 kΩ | 1 | 0,15 | 0,15 | ferretería / AliExpress | Rojo, **deliberadamente subalimentado a 0,15-0,3 mA**. Nada de WS2812 (no baja lo suficiente y brilla incluso a 0) ni OLED. **Ningún zumbador.** | **[C]** |
| A-11 | Calefactor de férula: resistencia **120 Ω 0,6 W** metal film + NTC 10k B3950 + 2N7000 + **termostato bimetálico NC KSD9700 45 °C** | 1 | 2,60 | 2,60 | AliExpress / tienda de electrónica | **Dos correcciones respecto de la especificación** (C-6/C-8 de `04-electronica.md`, S-4 de `06-seguridad.md`): (a) **0,6 W, no 0,25 W** — 0,208 W dentro de silicona sin ventilación es el 83 % de una de 0,25 W; (b) **KSD9700 de 45 °C, no un fusible térmico de 47 °C** — 47 °C no es valor de catálogo en fusibles de un solo uso y además está **por encima** del umbral de 43 °C de la ISO 13732-1. Va **en serie con el calefactor**, no con el raíl. 120 Ω a 5 V = 0,208 W: el techo (T_amb + 17,7 K) es **de hardware**. | **[C]** |
| A-12 | Calefactor de la taza de reposo: **120 Ω 0,6 W** metal film + NTC 10k B3950 + 2N7000 + KSD9700 45 °C | 1 | 1,30 | 1,30 | AliExpress | **Dos correcciones encadenadas.** (1) Las síntesis proponían 10 Ω (= 2,5 W, 500 mA), que se sale del presupuesto de corriente. (2) El paso intermedio de 47 Ω (0,53 W, 106 mA) **tampoco vale**: con Q5 en cortocircuito la taza llega a **57,8 °C en régimen permanente** y sólo es segura porque el one-shot corta antes (§9.3 de `06-seguridad.md`) — una función de confort cuya seguridad depende de una capa de seguridad. **120 Ω → 0,208 W / 42 mA**, techo de hardware T_amb + 14,8 K = **34,8 °C**, seguro pase lo que pase y **misma referencia que A-11**. | **[C]** |
| A-13 | Pasivos y montaje: 470 µF/10 V low-ESR + 5× 100 nF + placa perforada 70×50 + cable 24 AWG + regletas + conector JST | 1 | 4,00 | 4,00 | AliExpress / tienda local | El 470 µF va con **patas cortas** a VM/GND del TMC2209. | **[C]** |
| A-14 | Conector **USB-C hembra de panel** + cable USB **0,5 m 20-22 AWG** | 1 | 3,50 | 3,50 | Amazon.es / AliExpress | Ver 1.8. Sujeta el cable mecánicamente a la base (alivio de tracción). | **[C]** |
| A-15 | **Cargador USB 5 V 2 A** con marcado IEC 62368-1 | 1 | 8,00 | 8,00 | tienda local / Amazon.es (marca) | Ver 1.7. **0 € si reutilizas uno de marca que ya tengas.** | **[C]** |
| | **Subtotal A.1** | | | **48,15** | | | |

### A.2 Transmisión, ejes y rodamientos

| Ref | Descripción | Cant | €/ud | € tot | Proveedor | Nota de compra | Conf |
|---|---|---:|---:|---:|---|---|:--:|
| A-16 | Rodamiento **608ZZ** (8×22×7) — eje de barrido | 2 | 0,55 | 1,10 | AliExpress (pack 10 ~4 €) | Los dos van sobre **el mismo tornillo M8**, separados 50 mm. La coaxialidad la da el tornillo, **no** un mandrinado. Este es el truco que elimina toda operación de precisión del proyecto. | **[C]** |
| A-17 | Rodamiento **688ZZ** (8×16×5) — cabrestante | 2 | 0,60 | 1,20 | AliExpress | **Corrección de la especificación**, ver 1.6. Alternativa directa: 608ZZ. | **[C]** |
| A-18 | Rodamiento **623ZZ** (3×10×4) — polea de reenvío del contrapeso | 1 | 0,40 | 0,40 | AliExpress | Sobre un tornillo M3. Este sí es el uso correcto del 623ZZ. | **[C]** |
| A-19 | Tornillo **M8×120** de acero (vástago liso ≥60 mm) + 6 tuercas M8 + 8 arandelas | 1 | 1,20 | 1,20 | ferretería | **Eje de barrido.** Elige uno con vástago liso largo (rosca parcial): los 608ZZ ruedan sobre el liso, no sobre la rosca. | **[C]** |
| A-20 | Tornillo **M8×60** de acero, vástago liso (cabrestante) + 2 tuercas + tuerca de apriete | 1 | 0,80 | 0,80 | ferretería | El **vástago Ø8,0 mm es el cabrestante**. Con cordón de 0,4 mm: r_eff = 4,0 + 0,2 = **4,2 mm**. 6 vueltas de Dyneema. | **[C]** |
| A-21 | Tubo de **silicona 6/10 mm × 200 mm** (acoplamiento torsional) | 1 | 0,60 | 0,60 | AliExpress / tienda de acuarios | 25 mm de tubo entre motor y cabrestante = k_t 0,024 N·m/rad, f_n 5,2 Hz. **Ojo**: el eje del NEMA11 es de **5 mm** y el ID del tubo es 6 mm — pon dos capas de termorretráctil 3:1 sobre el eje, o un casquillo de latón 5/6. Sobre el M8 del cabrestante el tubo estira y agarra solo. | **[C]** |
| A-22 | Trenza **Dyneema / PE 0,4 mm × 10 m** (30-40 kg) | 1 | 3,00 | 3,00 | tienda de pesca / AliExpress | **Trenzado de PE, no monofilamento** (el nylon fluye y la reducción se descalibra en semanas), **ni hilo de acero** (chirría y se fatiga). | **[C]** |
| A-23 | **Husillo T8, AVANCE 8 mm (paso 2 mm, 4 entradas) × 150 mm + tuerca de latón** | 1 | 3,50 | 3,50 | AliExpress | **Ver 1.3. La advertencia más importante de esta lista.** | **[V]** |
| A-24 | Varilla rectificada **Ø6 mm × 150 mm** (guías del carro) | 2 | 1,20 | 2,40 | AliExpress / ferretería | Alternativa gratis: una broca de 6 mm sacrificada, o un eje de impresora vieja. | **[C]** |
| A-25 | Casquillos lisos **6×8×10 mm** (SF-1 / bronce sinterizado / POM) | 4 | 0,60 | 2,40 | AliExpress | **Casquillo liso, NO LM6UU de bolas.** Los rodamientos lineales de bolas traquetean audiblemente a 2 mm/s; el casquillo de polímero o bronce es silencioso. Es el euro mejor gastado de todo el sistema de movimiento. | **[C]** |
| | **Subtotal A.2** | | | **16,60** | | | |

### A.3 Estructura, masas y fallo seguro

| Ref | Descripción | Cant | €/ud | € tot | Proveedor | Nota de compra | Conf |
|---|---|---:|---:|---:|---|---|:--:|
| A-26 | **Pino macizo 18 mm**: tablero de 18 × 200 × 1200 mm — de él salen la base 300×200 y las cinco piezas de la **columna en cajón 80×80×130** (C1 ×2 de 112×62, C2 112×80, C3 tapa 80×80, C4 44×62) | 1 | 7,50 | 7,50 | Leroy Merlin / Bricodepot | **Pide el corte gratis en tienda.** **La columna NO es un taco macizo de 200 mm**: con 200 mm el punto más alto queda en 268 mm y **rompe el gálibo de 260 mm** de la especificación (corrección C8 de `02-mecanica.md`). Es un cajón de 130 mm de alto; punto más alto 222 mm. La lista de corte completa está en `02-mecanica.md` §2. La masa y el amortiguamiento interno son lo que hace silenciosa una máquina: 1,6 kg de pino baten a cualquier armazón impreso. El camino sin impresora aquí no es un compromiso, es una mejora acústica. | **[C]** |
| A-27 | **Lastre de base ~1,0 kg** — arena de sílice + cola blanca en un hueco fresado, o chapa de acero 3 mm 250×150 atornillada bajo la base | 1 | 3,00 | 3,00 | ferretería / tienda de acuarios | Necesario para llegar a los **1,6 kg de base** de la especificación. La chapa es más limpia; la arena es más barata y amortigua mejor. | **[E]** |
| A-28 | **Contrachapado de abedul 4 mm, 300×600 mm** | 1 | 6,50 | 6,50 | Leroy Merlin / tienda de modelismo | De aquí salen: 2 costillas del carril, sector de 60 mm, manguito de horquilla, mejillas de la bisagra, bloque del carro, tambor Ø140, tapa. | **[C]** |
| A-29 | **Contrachapado 0,8 mm** (o cartón pluma 1 mm) 300×250 mm — piel del carril | 1 | 2,50 | 2,50 | tienda de modelismo | Se curva sobre las dos costillas y forma la rampa reglada de 60 mm de ancho radial. | **[C]** |
| A-30 | **Plomo de pesca 500 g** (contrapeso: 360 g nominal, hasta 484 g de contingencia) | 1 | 4,00 | 4,00 | Decathlon / tienda de pesca | Compra **500 g**, no 360 g. La especificación misma advierte: si el par de retención (*detent*) medido del motor sale 12 mN·m en vez de 8, el contrapeso sube a **484 g** (tabla §5.4 de `06-seguridad.md`). Ver 1.10 y sección 12.2. | **[C]** |
| A-31 | **Tubo rígido de PVC Ø25 mm** (ID ~21 mm) × 250 mm + 1 tapón | 1 | 2,50 | 2,50 | Leroy Merlin (electricidad) | Cuerpo del **amortiguador neumático**. Ver sección 11 para el dimensionado del orificio de sangrado. | **[C]** |
| A-32 | Espuma EVA 20 mm (pistón) + fieltro para el labio | 1 | 1,50 | 1,50 | bazar / ferretería | Pistón de espuma forrado de fieltro. No busques estanqueidad perfecta: el orificio se ajusta empíricamente. | **[E]** |
| A-33 | **Tubo de carbono 4 mm OD / 3 mm ID × 400 mm** | 1 | 3,00 | 3,00 | tienda de modelismo / AliExpress | **Tubo, no varilla maciza.** La varilla pesa el triple y el fusible de GRP tiene que entrar dentro. | **[C]** |
| A-34 | **Varilla maciza de GRP Ø2 mm × 1 m** (larguero de cometa) — fusible de sobrecarga | 1 | 2,00 | 2,00 | tienda de cometas / AliExpress | Se epoxia dentro del carbono de 160 a 240 mm. k = 70 N/m: flexa 20 mm a 1,4 N. Es el límite mecánico duro del extremo distal. | **[C]** |
| A-35 | **Lastre de 40 g**: plomo "oliva" de 40 g taladrado a Ø4,2 mm (o barra de latón Ø12) | 1 | 2,50 | 2,50 | tienda de pesca / AliExpress | El plomo es blando: el taladro de 4,2 mm entra a mano. Encapsúlalo en termorretráctil. Ver alternativas en 6. | **[E]** |
| A-36 | Tornillería: **M2.5×8 ×4** (motor), surtido M3, **M4×20 ×4** (topes cautivos en agujeros ciegos), casquillo de latón 4/6 mm (manguito de la bisagra), prisionero **M4 con punta de nylon** | 1 | 5,50 | 5,50 | ferretería / AliExpress | **El NEMA 11 usa M2.5 en cuadro de 23 mm con resalte Ø22 mm.** Es el tornillo que todo el mundo olvida: no es M3. | **[C]** |
| | **Subtotal A.3** | | | **40,50** | | | |

### A.4 Cabezal y contacto

| Ref | Descripción | Cant | €/ud | € tot | Proveedor | Nota de compra | Conf |
|---|---|---:|---:|---:|---|---|:--:|
| A-37 | **Brocha kabuki de pelo de cabra natural, penacho ≥58 mm** | **2** | 8,00 | 16,00 | Amazon.es / Produpel / Perfect Beauty (nº22) / Clips Hair | **Ver 1.5. Dos, no una.** De recorte desigual si es posible, para alternarlas entre sesiones. | **[V]** |
| A-38 | Tubo de silicona **12/16 mm × 60 mm** + bridas 2,5 mm | 1 | 1,20 | 1,20 | AliExpress / tienda de acuarios | Portabrochas: cambio de cabezal en **10 segundos**. Sin metal, sin tornillos, nada conductor a menos de 300 mm de la piel. | **[C]** |
| A-39 | Lámina de **PTFE 1 mm 100×100 mm** (patín de 12 mm) + arandelas PTFE M3 ×4 | 1 | 4,00 | 4,00 | AliExpress | PTFE sobre fieltro tiene **µ_estático = µ_cinético**: no hay chirrido de stick-slip en el carril. Las arandelas van en la bisagra de cabeceo (rozamiento de arranque 1,5 mN en la punta). | **[C]** |
| | **Subtotal A.4** | | | **21,20** | | | |

### A.5 Silenciado, acabado y adhesivos

| Ref | Descripción | Cant | €/ud | € tot | Proveedor | Nota de compra | Conf |
|---|---|---:|---:|---:|---|---|:--:|
| A-40 | **Fieltro autoadhesivo 2 mm**, hoja A4 | 1 | 4,00 | 4,00 | ferretería / bazar | Forro del carril, forro interior de la columna, forro de la taza de reposo, forro del tubo del contrapeso, tapa del carro radial. | **[C]** |
| A-41 | Pies de **corcho 8 mm** o EPDM ×4 | 1 | 3,00 | 3,00 | ferretería | **Atornillar la base a la mesilla añade 6-9 dB**: más que todas las decisiones de componente juntas. Que quede apoyada sobre corcho. | **[C]** |
| A-42 | **Spray de PTFE SECO** 400 ml | 1 | 7,50 | 7,50 | ferretería / Amazon.es | **SECO, obligatoriamente.** Cualquier lubricante húmedo migra a la brocha, y de ahí a la piel y a la cama. Una brocha engrasada está arruinada. | **[C]** |
| A-43 | Epoxi 5 min 2×12 ml + cola blanca D3 + cianoacrilato | 1 | 4,50 | 4,50 | ferretería | El epoxi es para el GRP dentro del carbono y para la virola. La cola blanca para las costillas del carril. | **[C]** |
| | **Subtotal A.5** | | | **19,00** | | | |

### TOTAL NÚCLEO A

| Bloque | € |
|---|---:|
| A.1 Electrónica y control | 48,15 |
| A.2 Transmisión, ejes y rodamientos | 16,60 |
| A.3 Estructura, masas y fallo seguro | 40,50 |
| A.4 Cabezal y contacto | 21,20 |
| A.5 Silenciado, acabado y adhesivos | 19,00 |
| **TOTAL A (material, IVA incl., sin envío)** | **145,45** |

Los **cuatro costes irreducibles** son: motor 9,00 + driver 5,50 + dos brochas 16,00 + husillo T8 3,50 = **34,00 €**.
Todo lo demás es madera, cuerda, tuercas y plomo.

---

## 3. BOM B — OPCIONALES DE CALIDAD

Ninguno de estos es necesario para que el aparato funcione y sea seguro. Están ordenados por relación
mejora/euro para este proyecto concreto.

| Ref | Descripción | Cant | €/ud | € tot | Proveedor | Qué compra exactamente | Conf |
|---|---|---:|---:|---:|---|---|:--:|
| B-01 | **Segundo TMC2209 BIGTREETECH** | 1 | 5,50 | 5,50 | BTT Official Store | La prueba A/B de falsificación. Si eres capaz de oír la diferencia entre los dos, uno es falso. **Es el mejor 5,50 € de esta lista.** | **[V]** |
| B-02 | **Termómetro IR** (o termopar tipo K + multímetro con entrada TC) | 1 | 12,00 | 12,00 | Amazon.es / AliExpress | Sin esto no puedes cerrar el criterio de aceptación térmico: **30-34 °C en las puntas a los 2,0 s de contacto**. Si sale <27 °C hay que bajar a 82 Ω (0,30 W) en la férula. | **[C]** |
| B-03 | **Amortiguador NEMA17 de goma-acero + placa adaptadora 28→42 mm** (o lámina de silicona 3 mm + arandelas de nylon M2.5) | 1 | 8,00 | 8,00 | AliExpress | Rompe el camino estructural de la magnetostricción del motor hacia el armazón. **Los amortiguadores NEMA11 son raros y caros**; la vía práctica es una placa adaptadora o simplemente una junta de silicona de 3 mm con arandelas de nylon. | **[C]** |
| B-04 | **Tercera brocha kabuki de 50 mm** | 1 | 6,00 | 6,00 | Amazon.es / tienda de estética | Para el A/B de 50 vs 60 mm que la especificación deja como pregunta abierta. Más ancho es más suave y más anti-cosquillas, pero puede leerse como un lavado amplio en vez de una línea trazada. El cambio son 10 s. | **[C]** |
| B-05 | **Juego cortado a láser en contrachapado/acrílico 4 mm**: 2 costillas del carril, sector 60 mm, manguito de horquilla, bloque del carro, tambor Ø140, taza de reposo | 1 | 22,00 | 22,00 | servicio láser español (2-3 días laborables + 24 h de envío) | Sustituye ~4 h de segueta y lima. **Las dos costillas del carril salen idénticas**, que es lo único que la mano hace mal. | **[E]** |
| B-06 | **Butilo insonorizante**, 4 planchas 250×375 | 1 | 12,00 | 12,00 | Amazon.es (audio de coche) | Sobre cualquier panel plano de más de ~100 mm. Los paneles planos son lo que radia al aire; el butilo mata la resonancia del panel. | **[C]** |
| B-07 | **Cable USB magnético breakaway** | 1 | 7,00 | 7,00 | Amazon.es / AliExpress | Peligro 5 del FMEA (enredo de cable): un tirón >~10 N desconecta en vez de arrastrar el aparato. Y desconectar = el contrapeso retira la brocha. | **[C]** |
| B-08 | **Lámina de silicona 3 mm A5** (pies) o media pelota de squash ×4 | 1 | 8,00 | 8,00 | Amazon.es / tienda de deportes | Media pelota de squash es un aislador de baja frecuencia genuinamente bueno y cuesta 1 €. Sorbothane 50A-70A es mejor y cuesta 15-25 €: no compensa aquí. | **[C]** |
| B-09 | Imanes **N42 10×3 mm ×2** + chapa de aluminio 2 mm 60×60 | 1 | 3,50 | 3,50 | AliExpress | **Solo como supresor de resonancia (*ringing*) del modo del brazo.** La especificación **rechaza explícitamente** el freno de corrientes de Foucault como control de velocidad de retirada: haría falta 0,245 N·m·s/rad y esto da ~1e-3, dos o tres órdenes de magnitud corto. Esa función la hace el amortiguador neumático. | **[C]** |
| B-10 | Varillas GRP Ø2 mm de repuesto ×3 | 1 | 2,50 | 2,50 | tienda de cometas | El fusible de sobrecarga es un consumible por diseño. | **[C]** |
| B-11 | Tubo de carbono 4 mm **× 600 mm** (brazo largo alternativo, R hasta 400 mm) | 1 | 3,00 | 3,00 | tienda de modelismo | Para experimentar con R mayor si el barrido de 273 mm no cubre el antebrazo. | **[C]** |
| B-12 | Segundo 28BYJ-48 + ULN2003 de repuesto | 1 | 1,50 | 1,50 | AliExpress | La reductora de plástico es la pieza más frágil. | **[C]** |
| B-13 | Tarjeta de colocación plastificada + plantillas 1:1 impresas en copistería | 1 | 3,00 | 3,00 | copistería | La tarjeta debe marcar **los 273 mm completos de arco de contacto**, no solo los 199 mm de fuerza plena. Si la rampa cae fuera del miembro, la brocha llega al borde ya a 400 mN — arranque abrupto, que es el gatillo exacto de la knismesis. | **[C]** |
| B-14 | **Interruptor de red con piloto** para el cargador | 1 | 6,00 | 6,00 | ferretería | El consumo en espera del cargador (~0,1 W, 0,88 kWh/año) **cuesta 5 veces más que el propio aparato funcionando cada noche**. Ver 10.4. | **[C]** |
| | **TOTAL B** | | | **100,00** | | | |

---

## 4. BOM C — HERRAMIENTAS NECESARIAS

Este diseño **no tiene ni un solo mandrinado de precisión**: la coaxialidad del eje de barrido la da un tornillo M8 que
lleva los dos 608ZZ, y la bisagra de cabeceo es un tornillo pasante M3 sobre un manguito de latón. **No hace falta
taladro de columna, ni torno, ni fresadora.** Solo agujeros pasantes de holgura y una lima.

| Ref | Herramienta | € | ¿Imprescindible? | Nota |
|---|---|---:|---|---|
| C-01 | Taladro 500 W + brocas HSS 1-10 mm | 25,00 | Sí | Agujeros pasantes. Un taladro de columna es cómodo pero no necesario. |
| C-02 | Broca de corona / fresa plana **Ø22 mm** + broca larga Ø8 mm | 5,00 | Sí | El Ø22 es el alojamiento del resalte del NEMA 11. |
| C-03 | Segueta de marquetería + 12 hojas | 10,00 | Sí | Costillas del carril, sector, tambor Ø140. |
| C-04 | Sierra de arco para metal + hojas | 8,00 | Sí | Tubo de carbono, varilla de 6 mm, husillo T8, tornillos M8. |
| C-05 | Juego de limas (plana, redonda, media caña, cola de ratón) | 10,00 | Sí | Las dos costillas del carril se liman a la línea del patrón 1:1. |
| C-06 | Calibre digital 150 mm | 10,00 | Sí | Verificar el avance del T8 (8,0 mm/vuelta), el diámetro del penacho, r_eff del cabrestante. |
| C-07 | **Báscula de cocina 0,1 g / 3 kg** | 12,00 | **Sí, crítica** | Tres usos obligatorios: (a) medir k_brocha antes de cortar la rampa del carril; (b) **medir el par de retención del motor** colgando pesos conocidos del sector de 60 mm acabado, que es de lo que depende todo el fallo seguro; (c) el autochequeo semanal impreso en la base (41 g → compresión 8-13 mm). |
| C-08 | Soldador 60 W con control de temperatura + soporte | 18,00 | Sí | |
| C-09 | Pelacables + alicates de corte + pinzas | 8,00 | Sí | |
| C-10 | Sargentos 100 mm ×2 | 8,00 | Sí | Encolado de costillas y de la columna. |
| C-11 | Multímetro con medida de corriente DC | 12,00 | Sí | Verificar VM ≥ 4,85 V en el driver bajo carga y la corriente media de 0,37 A. |
| C-12 | Adaptador **USB-TTL CH340 3,3 V** | 2,50 | Recomendado | Leer el registro IOIN del TMC2209 antes de montar nada. También se puede hacer con el propio RP2040. |
| C-13 | Regla metálica 300 mm + escuadra | 6,00 | Sí | |
| C-14 | Móvil: cámara **240 fps** + app de SPL | 0,00 | Sí | 240 fps para filmar la punta a 2 cm/s y buscar saltos periódicos de ~1 mm (stick-slip torsional, la incógnita sin resolver de la especificación). La app de SPL basta porque **el criterio de aceptación es un delta ON/OFF en la almohada**, no una lectura absoluta: un error de calibración de ±5 dB se cancela en la resta. |
| | **TOTAL C** | **134,50** | | Si ya tienes taladro, soldador, multímetro y calibre: **~50 €**. |

---

## 5. BOM D — CONSUMIBLES

### Compra inicial

| Ref | Descripción | € | Para qué |
|---|---|---:|---|
| D-01 | Champú neutro sin siliconas 250 ml | 3,00 | Lavado semanal de la brocha a 40 °C. Las siliconas apelmazan el pelo de cabra. |
| D-02 | Alcohol isopropílico 99 % 250 ml | 5,00 | Limpieza de la virola y de la taza de reposo. **Nunca sobre las cerdas.** |
| D-03 | Lija 120/240/400 (3 hojas) | 3,00 | |
| D-04 | Cinta de carrocero 25 mm | 2,00 | Pegar las plantillas 1:1, y la válvula de lengüeta del dashpot. |
| D-05 | Bridas 2,5×100 ×100 | 2,00 | Portabrochas y cableado. **Ningún bucle de cable en ningún sitio** (peligro 5 del FMEA). |
| D-06 | Termorretráctil surtido 3:1 | 4,00 | Encapsular el plomo, calzar el eje de 5 mm a 6 mm. |
| D-07 | Estaño 0,8 mm 60 g + malla desoldadora | 6,00 | |
| D-08 | Spray adhesivo reposicionable 200 ml | 7,00 | Pegar las plantillas 1:1 al contrachapado. Reposicionable: se despega sin dejar residuo. |
| D-09 | Papel A4 (100 h) | 1,50 | Plantillas 1:1 y la escala milimetrada del lastre. |
| | **TOTAL D inicial** | **33,50** | |

### Recurrentes

| Concepto | Frecuencia | €/año |
|---|---|---:|
| 2 brochas kabuki de repuesto | anual (con lavado semanal) | 16,00 |
| Spray de PTFE seco | anual | 7,50 |
| Champú | semestral | 6,00 |
| Varilla GRP (si se rompe el fusible) | según uso | 0-2,50 |
| **Coste de propiedad** | | **~30 €/año** |

Electricidad: **0,03 €/año** de funcionamiento (ver 10.4). Es despreciable frente a las brochas.

---

## 6. ALTERNATIVAS LÍNEA A LÍNEA

Formato: **si no encuentras X → usa Y → coste en prestaciones.**

### Electrónica

| Ref | Si no encuentras… | Usa… | Coste en prestaciones |
|---|---|---|---|
| A-01 | NEMA 11 11HS12-0674S | **NEMA 17 pancake 17HS08-1004S** (8,09 € verificado, hotend.eu) a IRUN 0,25 A | Cuerpo de 42 mm en vez de 28: **radia más ruido** y añade ~120 g. Sirve, pero pierdes parte de la ventaja acústica del armazón pequeño. Reajusta IRUN (el pancake tiene menos par por amperio). |
| A-01 | Ninguno de los dos | **28BYJ-48 convertido a bipolar** (corta la pista de toma central bajo la tapa azul) + TMC2209 | El más silencioso por euro, pero la reductora de plástico tiene juego audible y un tic característico. **Además rompe la reducción 14,29:1**: el 1/64 interno la lleva a ~900:1, hay que rehacer todo el cálculo de pasos. No recomendado en el eje de barrido. |
| A-02 | TMC2209 BTT | **TMC2208 BTT** (2,50-4 €) | Pierdes StallGuard4 (el segundo disparo gratuito) y, en modelos antiguos, el UART, con lo que **pierdes la prueba de autenticidad**. Silencio prácticamente igual. |
| A-02 | Nada Trinamic disponible | **NO compres A4988/DRV8825** | 62 dBA frente a 44. Rompe el requisito raíz del proyecto. Espera a que llegue el TMC. |
| A-03 | RP2040-Zero | **RP2040 Pico / Pico 2** (4-6 €) | Ninguno, solo tamaño. Sigue teniendo PIO, que es lo que exige la especificación. |
| A-03 | Cualquier RP2040 | ESP32-WROOM-32 (5-6 €) | **Pierdes el PIO**, y con él el tope de 10 cm/s implementado en hardware. Habría que implementarlo con un timer y aceptar que es firmware. Ganas 10 canales táctiles capacitivos nativos (arranque sin clic) y BLE para tunear sin reflashear. **No uses ESP32-C3: el silicio no tiene periférico táctil.** |
| A-04 | 28BYJ-48 con ULN2003 | Segundo TMC2209 + un NEMA 8/11 pequeño | +12 €, y añades un segundo chopper. Innecesario: el eje radial se mueve 30 s por sesión en total. |
| A-05 | TPL5010 | **CD4060B (DIP-16) con oscilador RC a ~16,4 Hz, salida Q14** | 16384/16,4 = 1000 s = 16,7 min. Deriva ±20 % del RC: perfectamente aceptable para un respaldo de 16 min. Cuesta 0,50 €, es DIP y se suelda a mano sin adaptador. **Es una alternativa igual de buena, no peor.** |
| A-05 | Nada | **NE555 monoestable** | A 16 min necesita 10 MΩ × 100 µF; la corriente de fuga del electrolítico domina y el tiempo es irrepetible. **No lo uses para una función de seguridad.** |
| A-07 | Pulsador enclavado 16 mm NC | Interruptor **basculante SPST** en el raíl del motor | Igual de válido eléctricamente; peor ergonómicamente a oscuras (no notas por tacto en qué posición está). |
| A-11/12 | Fusible térmico de 47 °C | **NTC + corte por firmware a 38 °C, solo** | Pierdes el techo independiente del software. El techo de hardware por valor de resistencia (0,21 W en la férula) **sigue existiendo**, así que la pérdida es menor de lo que parece. Aun así, el fusible cuesta 0,40 €. |
| A-15 | Cargador 5 V 2 A | Cualquier cargador de marca de ≥1 A + cable corto grueso | Pico de 0,80 A sobre 1 A = 80 % de carga. Funciona, pero el margen contra la caída de tensión desaparece. |

### Mecánica

| Ref | Si no encuentras… | Usa… | Coste en prestaciones |
|---|---|---|---|
| A-16/17 | 688ZZ | **608ZZ** ×2 en el cabrestante | Ninguno funcional, solo volumen (Ø22 vs Ø16) y ~20 g. Simplifica la compra: 4× 608ZZ y ya. |
| A-19 | Tornillo M8 de vástago liso largo | **Varilla de plata Ø8 mm** + collares de eje | Mejor acabado superficial, +3 €. Necesitas los collares para fijar axialmente. |
| A-22 | Dyneema 0,4 mm | **Dyneema 0,3 mm** | r_eff baja a 4,15 mm; la reducción sube a 14,46:1 (+1,2 %). Rehaz la constante de pasos. |
| A-22 | Dyneema | **Hilo de kevlar de cometa 0,5 mm** | Menos resistente a la fatiga por flexión sobre Ø8; cámbialo cada 6 meses. Aceptable. |
| A-22 | — | **NO uses monofilamento de nylon** | Fluye (creep) bajo el sesgo constante de 247 mN·m. La reducción se descalibra sola en semanas. |
| A-23 | T8 avance 8 mm | **Husillo T5 de 4 entradas (avance 10 mm)** | 5 mm = 0,5 vuelta = 2,0 s. Mejor aún. Menos común. |
| A-23 | Ningún husillo de avance rápido | **T8 avance 2 mm + reducir a 4 desplazamientos por sesión** | 10 s por movimiento, autoblocante. La banda mojada cae de 118 mm a ~90 mm. Es exactamente la degradación que la especificación ya contempla como plan B para el ruido del 28BYJ-48. |
| A-24/25 | Varilla de 6 mm + casquillos | **Cola de milano de contrachapado con fieltro y PTFE seco** | Coste 0 €, más juego lateral. Como el carro solo se mueve con la brocha a 11,8 mm de la piel, el juego no llega a la piel. Viable. |
| A-25 | Casquillos SF-1 | **LM6UU de bolas** | Traqueteo audible a 2 mm/s en una habitación silenciosa. Es la degradación acústica más barata de evitar de toda la lista. |
| A-26 | Pino 18 mm | **DM/MDF 19 mm** | Densidad 750 kg/m³ frente a 520: la base pasa de 562 g a 810 g **gratis**, y necesitas 250 g menos de lastre. Acústicamente igual o mejor. Peor a la humedad y da más polvo al cortar. |
| A-26 | Cualquier tablero nuevo | **Tablero recuperado / estante viejo** | Ninguno. Ahorro de 7,50 €. |
| A-27 | Arena o chapa | **Bolsa de monedas, tornillos viejos, una baldosa de 20×20** | Ninguno. Una baldosa de gres de 20×20×1 cm pesa ~900 g. Gratis. |
| A-30 | Plomo de pesca | **Arandelas M8 de acero** (~1,9 g/ud → 190 uds) o **arena en un bote de película** | El acero necesita casi 3× el volumen (7,8 vs 11,3 g/cm³). Cabe en el tubo de Ø21 si el pistón se alarga; la carrera del pistón manda. |
| A-30 | — | **Monedas de 20 céntimos** (5,74 g, Ø22,25 mm) | 63 monedas = 361,6 g y encajan casi exactamente en un tubo de Ø21-22 mm ID. Apiladas ocupan 135 mm: demasiado alto para el tubo de 250 mm con 105 mm de carrera. Solo si alargas el tubo. |
| A-31 | Tubo de PVC Ø25 | **Tubo de cartón de papel de aluminio** forrado interiormente con cinta de embalar | Funciona; se deforma con la humedad. 0 €. |
| A-33 | Tubo de carbono 4 mm | **Varilla de carbono maciza 4 mm** | Pesa ~2,5× (7,5 g vs 3,0 g) y **cambia el momento estático de 4785 g·mm**, por lo que hay que recalcular la posición del lastre. Y el fusible de GRP ya no entra dentro: habría que unirlo a tope. Evítalo. |
| A-33 | Carbono | **Tubo de aluminio 4/3 mm** | Más pesado y con menos amortiguamiento interno: el brazo resuena más (por eso existe el imán supresor B-09). Aceptable con el imán. |
| A-35 | Plomo oliva / latón Ø12 | **8 tuercas M8 de acero ensartadas en un tubo de latón 6/4 mm, con epoxi** (41,6 g + 3 g de tubo) | Ninguno; hay que recortar a 7 tuercas + una arandela para clavar los 40 g. Todo de ferretería, 1,50 €. |
| A-35 | — | **Bobina de hilo de estaño enrollada sobre el brazo + termorretráctil** | 40 g de estaño sobre 40 mm del tubo de 4 mm = Ø14 mm de bobina. **Ventaja real: la masa se ajusta en pasos de 1 g** añadiendo o quitando vueltas, lo que permite afinar la fuerza sin mover la posición. |
| A-37 | Kabuki de pelo de cabra 60 mm | **Kabuki de taklon sintético 60 mm** (3-8 €) | Más rígido por filamento → se percibe menos suave. A cambio: lavable, seca en minutos, hipoalergénico, sin antígeno aviar. **Es el fallback si hay alergia, si se apelmaza rápido o si suelta pelo.** |
| A-37 | Cualquier brocha de 60 mm | **Kabuki de 50 mm** | Ancho cargado ~44 mm en vez de 52. Sigue dentro de la banda de 44-70 mm de la literatura. Pierdes anti-cosquilleo. |
| A-37 | — | **NO uses pluma real** (marabú, avestruz, plumero) | El peso propio de una pluma real es **0,3 mN**, mil veces por debajo del óptimo de placer de 0,4 N, y ese régimen es knismesis pura. Además el marabú es plumón: suelta continuamente en la cama y no se puede lavar. |
| A-37 | — | **NO uses limpiapipas / chenille** | Alma de alambre de acero: riesgo real de arañazo y punción contra piel desnuda. |
| A-39 | Lámina de PTFE | **Patín de nylon/POM + PTFE seco** | µ_est > µ_cin: reaparece el riesgo de chirrido de stick-slip en el carril. Es justo lo que el PTFE evita. |
| A-42 | Spray de PTFE seco | **Grafito en polvo / cera de vela** | Aceptables. **NUNCA aceite ni grasa**: migran a la brocha, a la piel y a la cama. |

---

## 7. CAMINO SIN IMPRESORA 3D — PIEZA POR PIEZA

**Este diseño ya está concebido para construirse sin impresora.** La especificación es de pino, contrachapado, cuerda y
tuercas. Aun así, quien venga de un diseño impreso esperará una pieza impresa en cada uno de estos puntos. Aquí está
el sustituto y su veredicto.

| Pieza que normalmente se imprimiría | Sustituto sin impresora | Veredicto |
|---|---|---|
| **Base y armazón** | Pino macizo 18 mm (o DM 19 mm) cortado gratis en Leroy Merlin | **MEJOR que impreso.** La masa y el amortiguamiento interno son lo que hace silenciosa una máquina; 1,6 kg de pino baten a 60 g de PLA. No es un compromiso, es una mejora. |
| **Soporte del motor NEMA 11** | (a) Escuadra de aluminio 20×20×2 mm cortada a 40 mm con sierra de arco, 4 agujeros M2.5 en cuadro de 23 mm + Ø22 mm de alojamiento del resalte; (b) placa de contrachapado 4 mm con los mismos agujeros, atornillada a la pared interior de la columna | Equivalente. La escuadra de aluminio es más rígida; el contrachapado amortigua más. Con el amortiguador de goma-acero (B-03) da igual cuál elijas. |
| **Sector de barrido Ø60 mm** | Contrachapado 4 mm: compás, segueta, lima. Ranura para el cordón hecha con una lima cola de ratón | Equivalente. El sector **solo fija la reducción**: un error de ±0,5 mm en el radio es un ±0,8 % en la constante de pasos, que el homing por microrruptor corrige en cada ciclo. |
| **Costillas del carril (×2)** | **Imprime el perfil 1:1 en papel A4**, pégalo con spray reposicionable sobre el contrachapado de 4 mm, corta 1 mm por fuera con segueta, lima a la línea. **Corta las dos apiladas y encoladas con dos gotas de cianoacrilato**, y sepáralas después: salen idénticas | Equivalente **si cortas las dos juntas**. El carril **no es una leva**: solo fija la altura de elevación, y ±0,5 mm de error de carril = ±1,3 mm de elevación de la brocha, que es inocuo. La ley de velocidad vive en el motor, no en un perfil. Esto es exactamente lo que hace que este diseño no tenga ninguna pieza de precisión subcontratada. |
| **Piel del carril (rampa reglada de 60 mm de ancho radial)** | Contrachapado de 0,8 mm curvado sobre las dos costillas y encolado, forrado con fieltro autoadhesivo. Alternativa gratis: cartón de caja de cereales de 0,5 mm en dos capas | Equivalente. El fieltro es la superficie de trabajo real; el sustrato solo tiene que mantener la forma. |
| **Manguito de la horquilla (sobre las pistas exteriores de los 608ZZ)** | Dos discos de contrachapado 4 mm con agujero de Ø22 mm hecho con broca de corona, encolados a 50 mm de separación sobre una banda de contrachapado | Equivalente. **La coaxialidad la da el tornillo M8, no el agujero**, así que un agujero de Ø22,3 mm en vez de Ø22,0 no rompe nada: se rellena con una vuelta de cinta. |
| **Mejillas de la bisagra de cabeceo** | Dos placas de contrachapado 4 mm, un tornillo M3 pasante, un **casquillo de latón** que recibe el apriete (para que el par de apriete no cargue nunca la bisagra), 2 arandelas de PTFE | Equivalente y **es el diseño oficial**. La única exigencia: el eje debe quedar **horizontal y tangencial dentro de 5°**. Un eje girado 10° fuera de tangencial mete un error de fuerza de ±27 mN **que cambia de signo con el sentido del golpe**. Comprueba con escuadra. |
| **Bloque del carro radial** | Taco de contrachapado 4 mm de 4 capas encoladas (16 mm), 2 agujeros de Ø8 para los casquillos + hueco para la tuerca de latón T8 fijada con 2 tornillos M3 | Equivalente. |
| **Tambor del contrapeso (radio 70 mm → Ø140 mm)** | Disco de contrachapado 4 mm trazado con compás y cortado con segueta; ranura para el cordón limada en el canto. Alternativa: **tapa de bote de pintura de 140 mm**, o un aro de bordar de 140 mm | Equivalente. Es un disco: la tolerancia es milimétrica. |
| **Taza de reposo calefactada** | **Tapón de PVC de Ø60-75 mm** forrado de fieltro por dentro, con la resistencia de 120 Ω y el NTC pegados en la pared exterior con epoxi. Alternativa: lata de conservas pequeña, tarro de cristal pequeño | Equivalente. Va **atornillada a la base**, a más de 300 mm de la piel: nada calefactado se acerca a la persona. |
| **Portabrochas / virola** | **Tubo de silicona 12/16 mm + 2 bridas.** Cambio en 10 s | **MEJOR que impreso.** Sin metal, sin tornillos, blando, y desmontable a oscuras. |
| **Escala milimetrada del lastre** | Impresa en papel 1:1 y pegada con spray al tubo de carbono, sellada con una tira de cinta transparente | Equivalente. |
| **Pies** | Corcho de 8 mm, o **media pelota de squash** por esquina | **MEJOR que impreso.** El TPU a ajustes típicos de impresión es mal aislador; media pelota de squash es un aislador de baja frecuencia genuinamente bueno. |
| **Clips de cable / alivio de tracción** | Bridas + clips adhesivos de cable | Equivalente. **Sin bucles**, nunca. |
| **Tapas de pulsador** | La cúpula de silicona que viene con el pulsador, o una gota de termofusible alisada con el dedo mojado | Equivalente. |
| **Caja de la electrónica** | El interior de la propia columna de pino en cajón 80×80×**130** (corrección C8 de `02-mecanica.md`), forrado de fieltro, con una tapa de contrachapado 4 mm atornillada | **MEJOR que impreso** (masa + sellado acústico). |

**Si aun así quieres piezas cortadas:** un servicio láser español entrega el juego completo en contrachapado o acrílico
de 4 mm por ~22 € en 2-3 días laborables + 24 h de envío peninsular (línea B-05). Un servicio de impresión 3D
española cotiza piezas pequeñas de PLA desde 6 € y una caja pequeña por 5-12 €. **Si imprimes, usa PETG, no PLA**:
el PLA fluye bajo carga sostenida y en un dormitorio español en verano una pieza precargada se deforma en semanas.

---

## 8. LOS TRES PRESUPUESTOS

### 8.1 Resumen

| | Material | Envío | **Total** | Qué obtienes |
|---|---:|---:|---:|---|
| **MÍNIMO** | 105,05 | 8,00 | **113,05** | Funciona, es seguro y cumple el contrato numérico. Sin taza calefactada, sin repuestos, sin comodidades. |
| **RECOMENDADO** | 145,45 | 12,00 | **157,45** | El núcleo A completo, todo nuevo, con cargador nuevo. Es el que yo construiría. |
| **COMPLETO** | 278,95 | 18,00 | **296,95** | A + B + D. Todos los extras, todos los repuestos, los dos A/B experimentales, insonorización completa. |
| *Herramientas* | *134,50* | — | *+134,50* | *Solo si partes de cero. Con taladro, soldador, multímetro y calibre ya en casa: ~50 €.* |

### 8.2 Presupuesto MÍNIMO — desglose de los recortes

Partiendo de los 145,45 € del núcleo:

| Recorte | −€ | Qué pierdes exactamente |
|---|---:|---|
| Reutilizar un cargador de marca que ya tengas (A-15) | 8,00 | Nada, **si y solo si** es de marca y tiene marcado IEC 62368-1. |
| Tablero recuperado en vez de pino nuevo (A-26) | 7,50 | Nada. |
| Lastre de base con material de casa: baldosa, monedas, tornillos (A-27) | 3,00 | Nada. |
| Brochas de AliExpress a 5,00 € en vez de 8,00 (A-37) | 6,00 | Riesgo de recibir 40 mm en vez de 60. **Mide el penacho al recibirla y devuélvela si no llega.** |
| Piel del carril con cartón de cereales + fieltro (A-29) | 2,50 | Nada mientras esté seco. |
| Spray de PTFE de 100 ml, o el que ya tengas (A-42) | 4,00 | Nada. |
| Adhesivos que ya tengas (A-43) | 4,50 | Nada. |
| **Aplazar la taza calefactada (A-12)** | 1,30 | El primer contacto de la noche llega a temperatura ambiente en vez de a 31-33 °C. Se añade después, cuando el termómetro IR diga que las puntas no llegan a 30 °C. **Es 1,30 €: aplazarlo es casi absurdo.** |
| CD4060 + RC en vez de TPL5010 (A-05) | 1,60 | Deriva del one-shot de ±20 % (16,7 min ± 3). Irrelevante para un respaldo. |
| Soldar el cable USB directo, sin conector de panel (A-14) | 2,00 | Peor alivio de tracción. Compénsalo con dos bridas y un clip. |
| **TOTAL RECORTADO** | **40,40** | |
| **MATERIAL MÍNIMO** | **105,05** | |

**Lo que NO se recorta en el presupuesto mínimo, y por qué:**

- **La segunda brocha (8,00 €).** El modo de fallo insidioso —apelmazamiento invisible que convierte la caricia en
  cosquilleo puntual a lo largo de semanas— solo se detecta alternando dos cabezales y con el autochequeo de báscula.
  No es un extra.
- **El TMC2209 de BIGTREETECH (5,50 €).** Comprar un genérico es tirar el proyecto.
- **El RP2040-Zero (4,50 €).** El tope de 10 cm/s de la especificación es un intervalo mínimo entre pasos compilado
  en el PIO. Un Arduino Nano de 2,20 € no puede darlo.
- **El pulsador enclavado NC (3,00 €), el TPL5010/CD4060 y el kit heartbeat.** Son las tres capas de fallo seguro
  eléctrico. Cada una cuesta menos de lo que cuesta la brocha.
- **El plomo de 500 g (4,00 €).** El fallo seguro **mecánico** es lo único que garantiza que la brocha se va de la piel
  si te duermes con el aparato puesto.
- **El husillo T8 de avance 8 mm (3,50 €).**
- **El spray de PTFE seco.** Sin él aparece stick-slip en el carril, que es ruido *y* percepción de tirones.

### 8.3 Presupuesto RECOMENDADO

Núcleo A completo = **145,45 €** + envío 12 € = **157,45 €**.

Si quieres subir de ahí, el orden de prioridad de los extras es:

1. **B-01 segundo TMC2209 (5,50 €)** — la prueba A/B de falsificación.
2. **B-02 termómetro IR (12,00 €)** — sin él no puedes cerrar el criterio térmico.
3. **B-03 amortiguador/desacoplo del motor (8,00 €)** — el mejor euro/dB después del propio driver.
4. **B-14 interruptor de red (6,00 €)** — el consumo en espera del cargador domina el coste energético.

Eso da un **"recomendado plus" de 189 €**, que es lo que de verdad recomiendo si el presupuesto lo permite.

### 8.4 Presupuesto COMPLETO

| Bloque | € |
|---|---:|
| A — Núcleo | 145,45 |
| B — Opcionales de calidad | 100,00 |
| D — Consumibles (compra inicial) | 33,50 |
| **Material** | **278,95** |
| Envíos (2 pedidos AliExpress + 1 local) | 18,00 |
| **TOTAL** | **296,95** |
| (+ C herramientas, si partes de cero) | +134,50 |

### 8.5 Comparación honesta con lo que decían las arquitecturas

Las tres síntesis del proyecto cotizaron el núcleo entre **52 y 96,50 €**. Este BOM sale en **145,45 €**. La diferencia
**no es inflación de la lista**, es esto:

| Concepto | Síntesis | Aquí | Por qué |
|---|---:|---:|---|
| Cargador nuevo | 0 (reutilizado) | 8,00 | El FMEA dice que el 92 % de los cargadores falsificados fallan los ensayos de aislamiento. Si el que tienes es de marca, réstalo. |
| Madera nueva + lastre | 5-9 | 10,50 | La base **de 1,6 kg** exige ~1 kg de lastre que ninguna síntesis presupuestó. |
| Dos brochas de **60 mm** | 6-12 | 16,00 | La especificación final subió de 40/50 a 60 mm y exige dos. |
| PTFE seco, fieltro, corcho, epoxi, tornillería | 6-8 | 19,00 + 5,50 | Precios de ferretería reales, no de "surtido que ya tienes". |
| Carro radial completo (T8 8 mm + varillas + casquillos) | 8,00 | 8,30 | Coincide. |
| Cadena de fallo seguro eléctrico (NC + TPL5010 + heartbeat) | 5-7 | 6,40 | Coincide. |

**Conclusión honesta: el aparato cuesta ~145 € comprando todo nuevo, y ~105 € reutilizando cargador, madera y
adhesivos. Ninguna de las cifras de 52 € era alcanzable con esta especificación final.**

---

## 9. ENVÍOS, PLAZOS, IVA Y ADUANAS

### 9.1 Reparto de proveedores recomendado

```
PEDIDO 1 — ALIEXPRESS (consolidado, filtrar "Envio desde Espana" donde exista)
  A-02 TMC2209 BTT (tienda oficial)     A-16..A-18 rodamientos
  A-03 RP2040-Zero                      A-21 tubo silicona 6/10
  A-04 28BYJ-48 + ULN2003               A-22 Dyneema
  A-05 TPL5010 + adaptador              A-23 HUSILLO T8 AVANCE 8 mm
  A-06 kit heartbeat                    A-24 varillas 6 mm
  A-07 pulsador enclavado NC            A-25 casquillos SF-1
  A-08 pulsador silicona                A-33 tubo de carbono
  A-09 microrruptor                     A-34 varilla GRP
  A-11/A-12 calefactores + NTC + FET     A-38 tubo silicona 12/16
  A-13 pasivos                          A-39 PTFE
  Valor tipico: ~55 EUR  ->  bajo el umbral de 150 EUR, IVA en checkout
  Plazo: 10-20 dias estandar / 3-7 dias desde almacen ES
  Envio: 0-6 EUR

PEDIDO 2 — STEPPERONLINE (almacen DE/FR) o la misma tienda oficial en AliExpress
  A-01 NEMA 11 11HS12-0674S
  Plazo: 3-6 dias.  Envio: ~5 EUR (o 0 si va en el pedido 1)

PEDIDO 3 — LOCAL, MISMO DIA (Leroy Merlin / ferreteria / tienda de estetica / pesca)
  A-14 cable USB corto        A-30 plomo de pesca 500 g
  A-15 cargador 5 V 2 A       A-31 tubo PVC + tapon
  A-19/A-20 tornillos M8      A-32 espuma EVA
  A-26 pino 18 mm (corte gratis)   A-35 plomo oliva 40 g
  A-27 lastre                 A-36 tornilleria M2,5/M3/M4
  A-28 contrachapado 4 mm     A-37 DOS brochas kabuki pelo de cabra
  A-29 contrachapado 0,8 mm   A-40..A-43 fieltro, corcho, PTFE seco, adhesivos
  Envio: 0.  Plazo: hoy.
```

### 9.2 Plazos realistas

| Ruta | Plazo | Coste de envío |
|---|---|---:|
| AliExpress estándar a España | **10-20 días** | 0-6 € |
| AliExpress, almacén ES/EU ("Envío desde España") | **3-7 días** | 2-8 € |
| StepperOnline almacén DE/FR | 3-6 días | ~5 € |
| Amazon.es Prime | 1-2 días | 0 € |
| Leroy Merlin / ferretería / tienda local | Mismo día | 0 € |
| Servicio láser español (B-05) | 2-3 días laborables + 24 h envío | incluido |

**Camino crítico: pide el TMC2209, el motor y el husillo T8 el primer día.** Todo lo demás lo puedes comprar mientras
esperas, y la construcción mecánica (pino, contrachapado, carril) se puede hacer entera antes de que llegue nada
electrónico.

### 9.3 Reglas de aduana

- **≤ 150 € de valor intrínseco por envío**: AliExpress cobra el 21 % de IVA en el checkout vía IOSS. Sin sorpresas.
- **> 150 €**: el transportista liquida IVA + aranceles en destino y cobra **12-18 € de gestión de despacho**.
  **Divide en dos envíos.**
- El envío y el seguro **no** cuentan para el umbral de 150 € (es valor intrínseco), pero sí para la base del IVA.

### 9.4 Coste total realista, con envíos

| Escenario | Material | Envíos | **Total puerta** |
|---|---:|---:|---:|
| MÍNIMO, todo AliExpress + local, reutilizando cargador y madera | 105,05 | 8,00 | **113,05** |
| RECOMENDADO, núcleo completo nuevo | 145,45 | 12,00 | **157,45** |
| RECOMENDADO PLUS (+ B-01, B-02, B-03, B-14) | 176,95 | 12,00 | **188,95** |
| COMPLETO (A+B+D) | 278,95 | 18,00 | **296,95** |
| COMPLETO + herramientas desde cero | 413,45 | 18,00 | **431,45** |

---

## 10. CONSUMO ELÉCTRICO Y PRESUPUESTO DE CORRIENTE A 5 V

### 10.1 Árbol de corriente

```
                 CARGADOR USB 5 V 2 A  (IEC 62368-1)
                            |
                   cable 0,5 m 20-22 AWG   (caida 0,03-0,06 V a 0,8 A)
                            |
                      CONECTOR USB-C DE PANEL
                            |
              +-------------+-------------------+
              |                                 |
   [PULSADOR ENCLAVADO NC 16 mm]          RAIL DE LOGICA 5 V
   (parada dura, en serie fisicamente)     |
              |                            +-- RP2040-Zero .............  25 mA
   [P-FET heartbeat AO3401]                +-- VIO del TMC2209 .........   8 mA
   (se abre en <200 ms si el MCU muere)    +-- LED rojo 3 mm ..........   0,2 mA
              |                            +-- pull-ups / microrruptor .   1 mA
   [TPL5010 one-shot 16 min]               |
   (corta pase lo que pase)                +-- N-FET -> 120 ohm ferula .  41,7 mA pico
              |                            |         (fusible termico 47 C en serie)
        RAIL DE POTENCIA 5 V (VM)          +-- N-FET -> 120 ohm taza ...   42 mA pico
              |
              +-- 470 uF low-ESR (patas cortas a VM/GND)
              |
              +-- TMC2209 -> NEMA 11 ....................  287 mA (IRUN 0,33 A)
              |                                           420 mA (IRUN 0,40 A)
              |
              +-- ULN2003 -> 28BYJ-48 ...................  200 mA (solo 2,5 s x ~12/sesion)
```

### 10.2 Cálculo del consumo del motor

El TMC2209 es un chopper: la corriente de bobina **no** se toma directamente del raíl; el driver se comporta como un
convertidor reductor y la corriente de entrada es aproximadamente `P_bobinas / (V_in · η)`.

```
Potencia en las bobinas, IRUN = 0,33 A rms/fase, R = 5,6 ohm/fase:
    P = 2 · I^2 · R = 2 · (0,33)^2 · 5,6 = 2 · 0,1089 · 5,6 = 1,219 W

Tension de bobina:  V = 0,33 · 5,6 = 1,85 V
Margen de chopper:  VM/V = 5,00/1,85 = 2,70x   -> genuinamente nativo de 5 V,
                                                   sin boost y sin PD trigger

Corriente de entrada a 5 V, eta = 0,85:
    I_in = 1,219 / (5,0 · 0,85) = 0,287 A

Contingencia IRUN = 0,40 A (si se pierden pasos):
    P = 2 · 0,16 · 5,6 = 1,792 W  ->  I_in = 1,792/(5·0,85) = 0,422 A
```

### 10.3 Tabla de presupuesto de corriente

| Carga | Condición | Duty en 900 s | I pico (mA) | I media (mA) | P media (W) |
|---|---|---:|---:|---:|---:|
| NEMA 11 vía TMC2209 (IRUN 0,33 A) | continuo durante toda la sesión | 100 % | 287 | **287,0** | 1,435 |
| VIO / lógica del TMC2209 | continuo | 100 % | 8 | 8,0 | 0,040 |
| RP2040-Zero (133 MHz, LED off, sin USB serie) | continuo | 100 % | 25 | 25,0 | 0,125 |
| LED rojo (22 kΩ) | continuo | 100 % | 0,2 | 0,2 | 0,001 |
| Calefactor de férula 120 Ω | PWM tras alcanzar 33 °C | ~45 % | 41,7 | 18,8 | 0,094 |
| Calefactor de taza 120 Ω *(ver 12.6)* | 100 % en el pre-warm de 60 s, luego ~40 % | ~44 % | 41,7 | 18,3 | 0,092 |
| 28BYJ-48 + ULN2003 | 16 movimientos (uno cada 4 golpes) × 4,6 s = 74 s | 8,2 % | 200 | 16,4 | 0,082 |
| Pull-ups, microrruptor, divisores NTC | continuo | 100 % | 1 | 1,0 | 0,005 |
| | | | | | |
| **MEDIA DEL SISTEMA** | | | | **374,7 mA** | **1,87 W** |
| **PICO SIMULTÁNEO PEOR CASO** | IRUN 0,40 A + 28BYJ moviéndose + ambos calefactores al 100 % | | **740 mA** | | **3,70 W** |
| **PRE-WARM (60 s previos, motor parado, IHOLD = 0)** | | | 118 mA | | 0,59 W |
| **REPOSO tras el ciclo** (motor desenergizado, calefactores off, MCU dormido) | | | 12 mA | | 0,06 W |

**Desglose del pico peor caso (740 mA):**

```
  NEMA 11 a IRUN 0,40 A ........... 422 mA
  28BYJ-48 en movimiento .......... 200 mA   (solape con la cola del golpe anterior)
  Calefactor de taza al 100 % ...... 42 mA   (120 ohm, ver 12.6)
  Calefactor de ferula al 100 % .... 42 mA   (120 ohm)
  RP2040-Zero ...................... 25 mA
  VIO del TMC2209 ................... 8 mA
  Logica varia ...................... 1 mA
                                    -------
                                     740 mA  ->  3,70 W
```

### 10.4 Por qué basta un cargador de 5 V 2 A

| Criterio | Valor | Margen |
|---|---|---|
| Pico peor caso frente a 2,0 A | 0,74 A | **2,7×** |
| Media frente a 2,0 A | 0,37 A | **5,3×** |
| Potencia pico frente a 10 W | 3,7 W | **2,7×** |
| VM en el driver con cable 20 AWG 0,5 m a 0,80 A *(redondeo conservador del pico)* | 4,97 V | **0,22 V sobre el mínimo de 4,75 V** |
| VM con cable 28 AWG 2 m a 0,80 A | **4,32 V** | **BROWNOUT — ver 1.8** |

**El cuello de botella no es el cargador, es el cable.** Un 5 V **1 A** también funcionaría (80 % de carga en el pico),
pero 2 A da margen contra la caída del propio cargador barato bajo carga y contra el transitorio de arranque del
28BYJ-48.

**Ningún boost, ningún PD trigger.** El informe de sourcing recomendaba subir a 12 V con un PD trigger porque un
chopper con más tensión de bus da una senoide de corriente más limpia. **Aquí no hace falta y sería contraproducente:**
a IRUN 0,33 A sobre 5,6 Ω la tensión de bobina es 1,85 V y el margen de chopper ya es 2,7×. Un módulo boost MT3608
añadiría un silbido de bobina que **modula con la carga del motor**, y un tono variable en una habitación silenciosa
es mucho peor que un siseo constante. El requisito de "5 V USB nativo" de la especificación es literal y es correcto.

### 10.5 Energía y coste

```
Energia por sesion de 15 min:  0,375 A · 5,0 V · 900 s = 1687 J = 0,469 Wh
365 sesiones/ano:              179 Wh = 0,179 kWh
A 0,15 EUR/kWh:                0,027 EUR/ano   <-- coste de FUNCIONAMIENTO

Consumo en espera del cargador enchufado (~0,1 W):
    0,1 W · 24 h · 365 = 876 Wh = 0,876 kWh = 0,131 EUR/ano
```

**El cargador enchufado sin hacer nada cuesta 5 veces más que el aparato funcionando cada noche del año.** De ahí la
línea B-14 (interruptor de red con piloto, 6 €), que se amortiza en 46 años en electricidad — es decir, **cómprala por
la seguridad, no por el ahorro**: es también la forma de garantizar que el cargador no queda enchufado junto a la cama
las 24 horas.

### 10.6 Presupuesto térmico del motor

```
Disipacion del NEMA 11 a IRUN 0,33 A: 1,22 W  (1,79 W a 0,40 A)
Resistencia termica tipica de un cuerpo de 28 mm sin flujo de aire: ~15-20 K/W
    -> incremento de la carcasa del motor: +18 a +25 K
Dentro de una columna de pino de 18 mm forrada de fieltro, sin ventilacion:
    -> cuerpo del motor 45-50 C tras 15 min, superficie EXTERIOR de la columna ~28 C
```

**Criterios del FMEA:** superficie que puede tocar la piel ≤ 40 °C, superficie que puede tocar ropa de cama ≤ 50 °C.
El motor está **dentro** de la columna, y la columna está a 400 mm del cuerpo, sobre la mesilla. Se cumple con holgura.

**Verificación de puesta en marcha:** tras un ciclo completo de 15 min, la **cara exterior de la columna de pino debe
estar por debajo de 35 °C**. Si supera 40 °C, hay una fuga de corriente en algún sitio (o IRUN está mal calculado por
un R_SENSE equivocado — ver 1.2). **Nunca cubras la columna con ropa de cama.**

### 10.7 Nota sobre el consumo del contrapeso: no lo hay, y ese es el argumento

El sesgo constante de 247 mN·m del contrapeso **no consume nada**, pero sí consume par del motor durante toda la sesión:

```
Reflejado al motor:  247 mN·m / 14,29 / 0,85 (perdidas del cabrestante) = 20,3 mN·m
Trepada del carril:   61 mN·m / 14,29 / 0,85 =  5,0 mN·m
Arrastre en la piel:  48 mN·m / 14,29 / 0,85 =  4,0 mN·m   (nunca coincide con la trepada)

Par disponible a IRUN 0,33 A:  70 mN·m · (0,33/0,67) = 34,5 mN·m
Peor caso (sesgo + trepada):   25,3 mN·m  =  73 % del disponible
```

**Esto es lo que explica por qué IRUN es 0,33 A y no los 0,10 A que proponía la arquitectura base CBS-2**: el
contrapeso se comió el margen. Es el precio del fallo seguro puramente mecánico, y es el precio correcto: 1,22 W
frente a 0,11 W, ambos irrelevantes para un cargador de 2 A, a cambio de un dispositivo de seguridad que no se puede
atascar, no puede perder carga, no se puede armar mal y no puede ser anulado por firmware.

---

## 11. DIMENSIONADO DEL AMORTIGUADOR NEUMÁTICO (línea A-31/A-32)

Este componente cuesta ~4 € y es el que impide que la retirada de fallo seguro llegue a ~300 mm/s en la punta.
La especificación pide **80-120 mm/s de velocidad de punta** y **2-3 s** de retirada. El orificio de sangrado depende
del diámetro interior del tubo que consigas, así que aquí está la fórmula y una tabla.

```
Velocidad terminal del piston (regimen inercial, Cd = 0,6, rho_aire = 1,2 kg/m3):

           Cd · A_h            2 · m · g
  v_p  =  ---------- · raiz( ------------- )
             A_p               rho · A_p

Velocidad de la punta:   v_punta = v_p · (R_brazo / r_tambor) = v_p · (300/70) = 4,29 · v_p
```

| Tubo | ID | A_p | ΔP a 3,53 N | d_orificio para v_punta ≈ 100 mm/s | v_p resultante |
|---|---:|---:|---:|---:|---:|
| PVC evacuación Ø32 | 29 mm | 660 mm² | 5,35 kPa | 0,47 mm | 23,3 mm/s |
| **PVC rígido Ø25 (elegido)** | **21 mm** | **346 mm²** | **10,2 kPa** | **0,36 mm** | **23,3 mm/s** |
| PVC rígido Ø20 | 16,5 mm | 214 mm² | 16,5 kPa | 0,29 mm | 23,3 mm/s |

**Procedimiento práctico (no intentes acertar a la primera):**

1. Taladra **0,3 mm** (broca de PCB o aguja de jeringuilla de calibre 30).
2. Suelta el brazo desde el extremo lejano y **cronometra la retirada**. Objetivo: **2-3 s**.
3. ¿Demasiado lento? Agranda en pasos de 0,05 mm. ¿Demasiado rápido? El pistón de espuma fuga: añade un labio de
   fieltro más.

**Válvula de lengüeta — mejora de 0 €, y es importante.** En la subida (el motor lleva el brazo al lado lejano) el
pistón tiene que **aspirar** aire por el mismo orificio, lo que carga al motor. A 3 cm/s de punta la velocidad del
cordón es 7 mm/s y la fuerza de amortiguamiento es `3,53 · (7/23,3)² = 0,32 N` → **22 mN·m** de par extra que el motor
tiene que vencer, sobre un presupuesto ya al 73 %.

Solución: **taladra un segundo agujero de 2 mm y tápalo con una lengüeta de PET** (recortada de un blíster) pegada por
un solo borde con cinta. Abre al aspirar, cierra al comprimir. El amortiguamiento solo actúa en la retirada, que es
exactamente lo que se quiere.

**Carrera necesaria:** el barrido mecánico es de 86° (±43°). Sobre un tambor de radio 70 mm eso son
`1,501 rad · 70 mm = 105 mm` de cordón. Con un pistón de 25 mm y holgura: **tubo de 200-250 mm**, montado vertical
junto a la columna. Cabe dentro del envolvente de 260 mm de altura.

---

## 12. CONTRADICCIONES Y ERRORES DETECTADOS EN LA ESPECIFICACIÓN VINCULANTE

No las oculto. Las siete están corregidas en el BOM de arriba; aquí está el razonamiento.

### 12.1 [CRÍTICA] El cabrestante M8 no cabe en un 623ZZ

**Dice la especificación:** *"cabrestante de vástago de tornillo M8 en 2× 623ZZ, r_eff 4,2 mm"*.
**Problema:** el 623ZZ es 3×10×4 mm. Diámetro interior **3 mm**. Un vástago M8 mide 8,0 mm.
**Corrección:** el r_eff de 4,2 mm y la reducción de 14,29:1 son correctos y se conservan; lo que cambia es el
rodamiento: **688ZZ (8×16×5) ×2** (o 608ZZ). El 623ZZ permanece en el BOM como polea de reenvío del cordón del
contrapeso sobre un tornillo M3, que sí es un uso válido. Ver línea A-17 y advertencia 1.6.

### 12.2 [CRÍTICA] "Tambor de 70 mm" tiene que significar RADIO 70 mm, no diámetro

**Dice la especificación:** *"contrapeso de 360 g en tambor de 70 mm... Constante 247 mN·m de sesgo... Margen 1,41×"*.
*(El margen real es **1,37×**: la trepada de riel son 66 mN·m, no 61 — ver C3 de `02-mecanica.md`. Lo que aquí se
comprueba es el radio del tambor, y esa conclusión no cambia.)*
**Comprobación:**

```
Si 70 mm = DIAMETRO (r = 0,035 m):   0,360 · 9,81 · 0,035 = 123,6 mN·m
                                      Margen = 123,6/180 = 0,69x   -> EL FALLO SEGURO NO CIERRA
Si 70 mm = RADIO   (r = 0,070 m):    0,360 · 9,81 · 0,070 = 247,2 mN·m   ✓ coincide con 247
                                      Margen = 247,2/180 = 1,37x         ✓ (la spec decia 1,41x
                                                                            usando 61 mN.m de trepada;
                                                                            la real es 66 -> ver C3 de
                                                                            02-mecanica.md y S-2 de
                                                                            06-seguridad.md)
```

**Corrección:** es **radio**. El tambor es un **disco de Ø140 mm**. Es coherente con el resto del documento, que llama
"sector de 60 mm" a un sector de **radio** 60 mm. Un disco de Ø140 mm sobre una base de 300×200 cabe sin problema,
pero hay que saberlo antes de cortarlo.

**Ambigüedad relacionada, sin resolver en la especificación:** el texto dice *"segundo cordón desde el borde opuesto
del sector sobre una polea 623ZZ hasta un tambor de 70 mm"*. Si el cordón sale del **borde del sector (r=60 mm)** y va
directo al peso, el radio efectivo es 60 mm y hacen falta **420 g**, no 360. Si el tambor es una pieza aparte y coaxial
con el eje de barrido, son 360 g a r=70 mm. **Ambas soluciones son válidas y dan el mismo par.** Por eso el BOM compra
**500 g de plomo** (línea A-30) y no 360: cubre las dos topologías y también la contingencia de la sección 12.3.

### 12.3 El par de retención del motor es una suposición, no un dato

La especificación reconoce esto en sus preguntas abiertas, pero conviene subrayarlo aquí porque **afecta a la lista de
la compra**: los 8 mN·m de *detent* del NEMA 11 **no están en ninguna hoja de características**. Todo el presupuesto
de fallo seguro descansa sobre ellos.

```
Si detent = 8 mN·m:   resistencia = 8·14,29 + 66 = 180 mN·m   -> contrapeso 360 g, margen 1,37x
Si detent = 12 mN·m:  resistencia = 12·14,29 + 66 = 238 mN·m  -> hace falta 333 mN·m de sesgo
                                                                -> contrapeso 484 g,  IRUN a 0,40 A
```

**Acción antes de cortar nada:** monta el sector de 60 mm sobre el eje, cuelga pesos conocidos del borde y encuentra
qué peso lo retro-conduce **desde cualquier ángulo** (el detent varía con la posición del rotor: prueba al menos 8
posiciones y quédate con la peor). Dimensiona el contrapeso a **1,4× el valor medido**. Por eso el BOM lleva 500 g.

### 12.4 La masa total no son 2,0 kg, son ~3,06 kg

**Dice la especificación:** *"base de pino 300×200×18 (1,6 kg lastrada)"* y *"MASA 2,0 kg en total"*. Las dos cosas no
pueden ser ciertas a la vez.

| Elemento | g |
|---|---:|
| Base de pino 300×200×18 (0,52 g/cm³) | 562 |
| Lastre para llegar a los 1,6 kg de base | 1038 |
| Columna de pino, cajón 80×80×130 (C1×2 + C2 + C3 + C4, 576 cm³) + tapa L1 + fieltro | 330 |
| NEMA 11 | 110 |
| Contrapeso + pistón | 375 |
| Tubo de PVC + tapón | 60 |
| Contrachapado (carril, sector, horquilla, carro, tambor, taza, tapa) | 200 |
| Brazo + cabezal + lastre de 40 g | 61 |
| 28BYJ-48 + husillo T8 + varillas + casquillos | 120 |
| Rodamientos, tornillería, electrónica, cableado | 200 |
| **TOTAL** | **3056 g ≈ 3,06 kg** |

**Corrección: ~3,06 kg.** Es un error **benigno** —más masa es mejor acústicamente y mejor contra el vuelco— pero
hay que saberlo para el envío, para la mesilla y porque **el lastre de ~1 kg es una línea de BOM que ninguna síntesis
presupuestó** (A-27). El vuelco sigue holgadísimo: el par de vuelco por la reacción de contacto es
`0,4 N · 0,325 m = 0,13 N·m` contra un par de restitución de `3,06 kg · 9,81 · 0,10 m = 3,00 N·m` → **margen 23×**.

> **Conciliación con `06-seguridad.md` §8.2, que suma 2 261 g.** Los dos números son de la **misma máquina con dos
> niveles de lastre distintos**, y ninguno está mal:
>
> | | `06-seguridad.md` §8.2 | Esta tabla |
> |---|---:|---:|
> | Lastre bajo la base | **460 g** (sólo W1, el mínimo antivuelco) | **1 038 g** (los que exige la spec para una base de 1,6 kg) |
> | Densidad del pino | 0,45 g/cm³ | 0,52 g/cm³ |
> | Total | 2 261 g | 3 056 g |
>
> `06-seguridad.md` calcula deliberadamente la **cota inferior** —menos masa = menos fuerza de vuelco = peor caso— y
> sobre ella demuestra que **sin W1 la máquina no llega al mínimo de 5 N**. Esa conclusión no cambia y es la que manda.
> El valor de proyecto para envío, mesilla y compra de lastre es **3,06 kg**, porque la especificación fija la base
> lastrada en 1,6 kg (562 g de pino + 1 038 g de lastre, línea A-27). Con esa base todas las fuerzas de vuelco de
> `06-seguridad.md` §8.3 **mejoran**, así que usar 2,26 kg allí es conservador y correcto.

### 12.5 El pico de corriente de 0,7 A no incluye un movimiento del carro radial

**Dice la especificación:** *"Sistema 0,36 A de media, 0,7 A de pico, 1,8 W"*.
**Problema:** la especificación **también** dice que el movimiento radial *"se programa para solapar el último 20 % del
golpe anterior, para que el raspado de la fibra lo enmascare"*. Es decir, el 28BYJ-48 (200 mA) **está diseñado para
funcionar exactamente cuando el NEMA 11 también está funcionando**. Ese caso no está en los 0,7 A.

**Corrección:** el pico real es **0,80 A** (desglose en 10.3). **No cambia ninguna conclusión** —sigue siendo el 40 %
de un cargador de 2 A— pero sí cambia el cálculo de caída de tensión en el cable, que es donde el margen sí es
estrecho (sección 1.8). La media medida sale **0,37 A**, no 0,36; la diferencia es el calefactor de la taza, que
tampoco estaba presupuestado. *(Cifras finales tras redimensionar la taza a 120 Ω —12.6— y fijar el carro radial en
16 movimientos por sesión, que es lo que implementa el firmware: media **375 mA**, pico **740 mA**.)*

### 12.6 El calefactor de la taza de reposo heredado de la Síntesis 3 se sale del presupuesto de corriente

**Dice la Síntesis 3 (cuyo elemento la especificación final adopta):** *"un elemento bobinado de 10 Ω y un NTC de 10k
mantienen el aire de la taza a 35 °C"*.
**Problema:** 10 Ω a 5 V = **500 mA, 2,5 W**. Por sí solo se lleva el 25 % de un cargador de 2 A, y con el motor a
IRUN 0,40 A y el 28BYJ-48 moviéndose el pico llegaría a **1,20 A**.
**Corrección:** una taza pequeña forrada de fieltro tiene una resistencia térmica al ambiente de ~30 K/W; mantener
+15 K sobre un dormitorio a 20 °C pide **~0,5 W**, no 2,5 W. Pero 47 Ω (0,53 W, 106 mA) **tampoco vale**: con el FET
en cortocircuito el régimen permanente de la taza es de 57,8 °C (§9.3 de `06-seguridad.md`). El valor final es
**120 Ω 0,6 W → 0,208 W, 42 mA**, con techo de hardware en T_amb + 14,8 K = 34,8 °C (línea A-12). Es además la misma
referencia que el calefactor de la férula, así que el BOM pierde un componente distinto.

### 12.7 Erratas menores, corregidas en silencio en el resto del documento

| Dónde | Qué dice | Qué debe decir |
|---|---|---|
| Retirada de fallo seguro | *"un último golpe firme a 80-120 mN/s... 80-120 mm/s"* | **80-120 mm/s**. La especificación se autocorrige en la misma frase; la unidad correcta es velocidad. |
| Fuerza a x=125 mm | "400 mN nominal" | Correcto y verificado: `(4785 + 40·125)/240 = 40,77 gf = 400,0 mN`. También verificados los extremos: 261 mN a x=40 y 523 mN a x=200, y la sensibilidad de 1,63 mN/mm. **No hay error aquí.** |
| Acoplamiento del motor | "tubo de silicona 6/10 mm" sobre el NEMA 11 | El eje del NEMA 11 es de **Ø5 mm**, no 6. Hace falta un calce (dos capas de termorretráctil 3:1 o un casquillo de latón 5/6). Sobre el M8 del cabrestante el tubo estira y agarra bien. |
| Carga del amortiguador en la subida | no contemplada | +22 mN·m de par sobre el motor, sobre un presupuesto ya al 73 %. Solución de 0 €: válvula de lengüeta (sección 11). |

**Lo que SÍ he verificado y está correcto** (para que quede constancia de que las correcciones son puntuales, no un
desmontaje de la especificación):

```
Reduccion:        60 mm / 4,2 mm = 14,286                        OK
Paso de punta:    2·pi·300/(200·14,29) = 0,6595 mm/paso completo  OK (spec: 0,6597)
Cadencia:         3 cm/s -> 45,5 pasos/s -> 13,65 rpm             OK
Arco de contacto: +-19 deg a R=300 -> 198,9 mm                    OK (spec: 199)
Sagita:           300·(1-cos19) = 16,34 mm                        OK (spec: 16,3)
Rampa y meseta:   7 deg a R=300 -> 36,65 mm cada una              OK (spec: 37)
Arco total:       199 + 2·37 = 273 mm                             OK
R=275..325:       182,4 .. 215,5 mm de fuerza plena               OK (spec: 182-216)
Compresion:       0,400/58 = 6,90 mm                              OK
Rampa del carril: 6,90/2,67 = 2,58 mm                             OK (spec: 2,6)
Aire en meseta:   7,0·2,67 - 6,9 = 11,79 mm                       OK (spec: 11,8)
Presion:          0,400 N / 2120 mm2 = 189 Pa = 1,42 mmHg         OK (spec: 0,19 kPa)
Potencia motor:   2·0,33^2·5,6 = 1,219 W                          OK (spec: 1,22)
Margen chopper:   5,00/1,85 = 2,70x                               OK
Fuerza tangencial:(34,5·14,29·0,85 - 247)/300 mm = 0,573 N        OK (spec: 0,58)
Hacia el parking: (34,5·14,29·0,85 + 247)/300 mm = 2,22 N         OK (spec: 2,2)
Fusible GRP:      1,4 N / 70 N/m = 20 mm                          OK
Filtro torsional: J_reflejada = (0,030·0,09 + 0,360·0,0049)/14,29^2
                             = 2,18e-5 kg·m2
                  f_n = (1/2pi)·raiz(0,024/2,18e-5) = 5,28 Hz     OK (spec: 5,2)
Carro radial:     5 mm / 8 mm-vuelta = 0,625 rev a 15 rpm = 2,5 s OK
Dashpot 0,5 mm:   con ID 25 mm -> v_punta = 112 mm/s              OK, dentro de 80-120
```

---

## 13. ORDEN DE COMPRA Y CHECKLIST DE RECEPCIÓN

### 13.1 Qué comprar primero

1. **TMC2209 BIGTREETECH ×2** — plazo largo y es la pieza que puede llegar falsificada. Verifica `IOIN.VERSION = 0x21`
   **antes de comprar nada más**. Si falla, devuélvelo y reinicia el reloj.
2. **NEMA 11 11HS12-0674S** — plazo largo. Al recibirlo, **mide el par de retención** (sección 12.3) antes de cortar
   el tambor del contrapeso.
3. **Husillo T8 avance 8 mm** — plazo largo y alto riesgo de recibir el modelo equivocado.
4. **Las dos brochas kabuki** — hay que **medir k_brocha antes de cortar la rampa del carril**, y la rampa es lo
   primero que se construye.
5. Todo lo demás, en paralelo. La construcción mecánica completa (base, columna, carril, sector, horquilla, carro,
   tambor, taza) se puede hacer sin ningún componente electrónico.

### 13.2 Checklist de recepción — 12 comprobaciones, 20 minutos

| # | Pieza | Comprobación | Criterio |
|---|---|---|---|
| 1 | TMC2209 | Lectura UART del registro IOIN | `VERSION = 0x21` |
| 2 | TMC2209 | Valor de R_sense en la serigrafía | 0,11 Ω (si es 0,15, corrige el firmware) |
| 3 | TMC2209 ×2 | Prueba A/B de sonido a 45 pasos/s con StealthChop | Los dos igual de silenciosos |
| 4 | NEMA 11 | Contar hilos; medir R entre pares | **4 hilos**; ~5,6 Ω por fase |
| 5 | NEMA 11 | Par de retención con pesos sobre el sector, 8 posiciones | Anotar el peor; contrapeso = 1,4× |
| 6 | Husillo T8 | Una vuelta a mano, medir con calibre | **8,0 mm** exactos |
| 7 | Husillo T8 | Contar los surcos que entran en paralelo | **4 entradas** |
| 8 | 28BYJ-48 | Marcado del lateral azul | `28BYJ-48-5V` |
| 9 | 28BYJ-48 | ¿Viene la placa ULN2003? | 5 LEDs + conector de 5 vías |
| 10 | Brochas ×2 | Diámetro del penacho sin cargar, con calibre | **≥ 58 mm** |
| 11 | Brochas ×2 | Longitud libre de cerda desde la virola | **≥ 30 mm** |
| 12 | Brochas ×2 | Compresión a 41 g en la báscula de cocina | **8-13 mm** → anota k_brocha, con él cortas la rampa |
| 13 | Cable USB | Marcado del calibre / medir la caída a 0,8 A | ≥ 4,85 V en VM del driver |
| 14 | Cargador | Marcado IEC 62368-1 y marca reconocible | Presente y legible |
| 15 | Rodamientos | ID del cabrestante | **8 mm** (688ZZ/608ZZ), NO 623ZZ |

### 13.3 Antes de dormir con él puesto (recordatorio de la especificación)

Tres ciclos completos de 15 min contra una almohada lastrada, y en cada uno, deliberadamente: **(a)** tirar del USB a
mitad de golpe, **(b)** pulsar la parada dura a mitad de golpe, **(c)** colgar el firmware a mitad de golpe.
**En los tres casos la brocha tiene que abandonar la piel.** Después, medir la fuerza en cinco puntos del arco:
**400 ± 25 mN**.

---

## 14. RESUMEN DE UNA PÁGINA

```
+-------------------------------------------------------------------------+
|  PLUMA-R — RESUMEN DE COMPRA                                            |
+-------------------------------------------------------------------------+
|  MINIMO ....... 113 EUR   (reutilizando cargador, madera y adhesivos)   |
|  RECOMENDADO .. 157 EUR   (nucleo A completo, todo nuevo)               |
|  REC. PLUS .... 189 EUR   (+ 2o TMC2209, termometro IR, amortiguador,   |
|                            interruptor de red)                          |
|  COMPLETO ..... 297 EUR   (A + B + D)                                   |
|  Herramientas .. +135 EUR (solo si partes de cero; ~50 si ya tienes     |
|                            taladro, soldador, multimetro y calibre)     |
+-------------------------------------------------------------------------+
|  COSTES IRREDUCIBLES:  motor 9,00 + driver 5,50 + 2 brochas 16,00       |
|                        + husillo T8 3,50 = 34,00 EUR                    |
|                        Todo lo demas es madera, cuerda, tuercas y plomo.|
+-------------------------------------------------------------------------+
|  LAS CINCO COMPRAS QUE PUEDEN ARRUINAR EL PROYECTO:                     |
|   1. TMC2209 falsificado ......... IOIN.VERSION debe leer 0x21          |
|   2. T8 de avance 2 mm ........... exige "Pitch 2mm, 4 Starts, Lead 8mm"|
|   3. Brocha de 40 mm ............. mide el penacho: >= 58 mm            |
|   4. 28BYJ-48 sin ULN2003 / 12 V . marcado "28BYJ-48-5V" + placa        |
|   5. Cable USB de 2 m y 28 AWG ... brownout a 4,32 V; usa 0,5 m 20 AWG  |
+-------------------------------------------------------------------------+
|  CORRECCIONES A LA ESPECIFICACION (seccion 12):                         |
|   - Cabrestante M8 -> 688ZZ/608ZZ, NO 623ZZ (3 mm de ID)                |
|   - Tambor del contrapeso: 70 mm de RADIO (disco de 140 mm)             |
|   - Masa total: 3,06 kg, no 2,0 (falta ~1 kg de lastre en la base)      |
|   - Pico de corriente: 0,74 A, no 0,70 (falta el carro radial)          |
|   - Calefactor de la taza: 120 ohm (0,21 W), no 10 ohm (2,5 W)          |
|   - Compra 500 g de plomo, no 360: el detent no esta en la hoja de datos|
+-------------------------------------------------------------------------+
|  ALIMENTACION:  5 V USB NATIVO. Media 0,37 A / 1,87 W.  Pico 0,74 A.    |
|  Un cargador de 5 V 2 A da 2,5x de margen en el pico y 5,1x en la media.|
|  NADA de boost, NADA de PD trigger a 12 V: margen de chopper ya 2,7x.   |
|  Coste electrico: 0,03 EUR/ano de funcionamiento.                       |
|  (El cargador enchufado en vacio cuesta 0,13 EUR/ano: usa un            |
|   interruptor de red.)                                                  |
+-------------------------------------------------------------------------+
```

---

*Fin de 03-bom.md. Documento siguiente: guía de construcción y puesta en marcha.*
