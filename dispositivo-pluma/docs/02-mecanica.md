# PLUMA-R — 02 · DISEÑO MECÁNICO Y MONTAJE

**Documento 2 de la serie. Contrato numérico: `final_spec.md`.**
Todo lo que sigue es constructivo: cotas en mm, masas en g, fuerzas en mN, ángulos en grados, precios en EUR (España, 2026).

---

## 0. CÓMO USAR ESTE DOCUMENTO

Lee las secciones 1, 2 y 3 enteras antes de comprar nada. Después sigue la sección 5 (montaje) en orden estricto. Hay **dos mediciones que bloquean el resto del trabajo** y que van en la sección 5 como pasos 3 y 13:

1. **Medir la resistencia del tren de barrido** (par de detente del motor reflejado + rozamientos) antes de comprar el contrapeso. Determina si el lastre son 250 g o 600 g.
2. **Medir `k_brush`** (rigidez del pelo de la brocha) antes de cortar el riel. Determina la altura de la rampa de descarga. Si cortas el riel antes de medir, tendrás que cortarlo otra vez.

**Regla de oro del proyecto:** ninguna pieza de este documento puede aumentar la fuerza sobre la piel. El eje de fuerza no tiene actuador: es un lastre de latón de 40 g y la gravedad. Si dudas entre dos soluciones, elige la que descargue.

### 0.1 Correcciones a la especificación vinculante

Encontré ocho puntos en `final_spec.md` que no cierran aritméticamente o no son construibles tal cual. Los corrijo aquí de forma explícita en vez de esconderlos. El detalle está en el **Anexo D**.

| # | Dice la spec | Problema | Corrección adoptada |
|---|---|---|---|
| C1 | Riel sube a 11 mm entre 40 y 43° para entrar en la cuna | Pendiente de 27°; el contrapeso necesitaría 113 mN·m sólo para trepar → margen 1,09× y el fallo seguro se queda corto del tope | **Meseta plana 34–43°** a altura constante. La cuna se sube con su propio pedestal ajustable |
| C2 | Zona de despegue 26–33° (7°) | Pendiente 13,6° → trepada 70,5 mN·m, no los 61 supuestos | **26–34° (8°)**, pendiente 11,9°, trepada 66 mN·m. Meseta 34–43° (31,4 mm de arco) |
| C3 | Margen de fallo seguro 1,41× | Con la trepada real es **1,37×** | Se acepta 1,37×; el contrapeso se dimensiona por medición, no por catálogo (tabla §8.4) |
| C4 | Dos costillas de arco **idénticas** de UNA plantilla | Están a r=125 y r=175: 1° son 2,182 mm en una y 3,054 mm en la otra. No pueden ser idénticas | Una **sola tabla h(φ)**, dos desarrollos impresos a escalas distintas. Las alturas sí son idénticas grado a grado |
| C5 | Tolerancia bisagra 5°, fuerza 400 ±12 mN | 5° ya generan ±13,9 mN por sí solos | **Objetivo de montaje 3° (±8,4 mN), límite de rechazo 5°** |
| C6 | Rampa de aterrizaje 0,6–2,5 s | 37 mm de arco a 2–7 cm/s dan **0,52–1,83 s** | Se declara 0,52–1,83 s. Para 2,5 s haría falta un bloque a 1,5 cm/s |
| C7 | Amortiguador: tubo PVC 25 mm | En Ø int. 21 mm no caben 360 g de acero (haría falta un tubo de 286 mm, fuera del gálibo de 260 mm) | **PVC de 32 mm** (Ø int. 29), orificio **0,75 mm**. Fórmula paramétrica en §8.3 |
| C8 | Columna 80×80×200, gálibo 260 mm | Con 200 mm de columna la tuerca superior del perno queda a 268 mm | **Columna 80×80×130** (laterales 112 + tapa 18). Punto más alto: 222 mm |

Además, dos **adiciones** que la spec no contempla y sin las cuales la máquina no funciona:

- **A1 · Patín de altura regulable.** El riel está fijo a la máquina, pero la piel no. Un brazo apoyado 10 mm más bajo baja el patín 3,75 mm, que se come una rampa de descarga de 2,58 mm entera. El patín va sobre un tornillo M4 con escala, ±12 mm. Es el ajuste de puesta a punto de cada sesión (§5, paso 22 y §11).
- **A2 · Varilla del lastre.** El lastre de 40 g y el patín se pelean por la misma estación x=90 mm de la botavara. El lastre corre sobre una varilla de carbono de 3 mm montada 14 mm **por encima** del eje de la botavara; el patín cuelga por debajo. Coste: k_tip pasa de 0 a 0,096 N/m (±2,4 mN sobre ±25 mm de flotación). Sigue dentro del presupuesto de error.

---

## 1. CONVENIO DE EJES Y COTAS MAESTRAS

```
                        Z (arriba)
                         |
                         |        Y (hacia el cuerpo / hacia delante)
                         |      /
                         |    /
                         |  /
   ----------------------O------------------ X (lateral)
                    eje de barrido
                    (vertical, tilt beta = 0 exacto)
```

- **z = 0** es la **cara superior de la base**. El "plano de la base" del gálibo (260 mm) es la cara inferior: suma 18 mm a todas las cotas z.
- **φ** = ángulo de barrido. φ = 0 apunta hacia delante (+Y). φ positivo = hacia el lado del aparcamiento (a la derecha vista desde la máquina). Recorrido mecánico: **−43° a +43° = 86°**.
- **r** = radio desde el eje de barrido, en planta.
- **x** = distancia a lo largo de la botavara desde el eje de la bisagra de cabeceo, hacia la brocha.

### 1.1 Cotas maestras (memorízalas)

| Símbolo | Valor | Qué es |
|---|---|---|
| R | **300 mm** | eje de barrido → punta de la brocha (nominal; 275–325 con el carro) |
| L | **240 mm** | bisagra de cabeceo → punta de la brocha |
| x_patín | **90 mm** | bisagra → patín PTFE |
| Relación de elevación | **240/90 = 2,67** | 1 mm de riel = 2,67 mm de punta |
| r_yugo | **60 mm** | eje de barrido → bisagra (nominal; 35–85 con el carro) |
| r_patín | **150 mm** | eje de barrido → patín (nominal; 125–175 con el carro) |
| r_sector | **60 mm** | garganta del tendón de arrastre |
| r_tambor | **70 mm** | garganta del cable del contrapeso |
| r_cabrestante | **4,2 mm** | vástago M8 (Ø8) + 0,4 mm de Dyneema |
| Reducción | **14,29:1** | 60 / 4,2 |
| Paso de punta | **0,6597 mm** por paso completo del motor | 1,8° / 14,29 × R |
| Separación rodamientos | **50 mm** | 608ZZ #1 a z=140, #2 a z=190 |
| Plano de contacto nominal | **z ≈ 150 mm** | (168 sobre el plano de base) |
| Datum del riel | **z = 145 mm** | cara superior del fieltro con h = 0 |
| Punto más alto de la máquina | **z = 204 mm** (222 sobre el plano de base) | cabeza del perno M8 |
| Masa total | **≈ 2,0 kg** | con lastre trasero de 400 g |

### 1.2 Mapa de zonas del barrido (el corazón de la máquina)

```
 φ = -43   -34  -26  -19        0        +19  +26  +34   +43
     |      |    |    |         |         |    |    |     |
 [MESETA][DESP][TAPER]|<--- CONTACTO --->|[TAPER][DESP][MESETA]
  plana  rampa  rampa |    400 mN pleno  | rampa  rampa  plana
  h=hf   ht->hf 0->ht |     SIN RIEL     | 0->ht ht->hf   h=hf
                      |   199 mm de arco |
        tope M4 <-----|                  |-----> tope M4 + FINAL DE CARRERA
                                                 + CUNA CALIENTE (aparcamiento)

  Arco de contacto total = 37 + 199 + 37 = 273 mm      <-- la tarjeta de colocación
  Flecha del arco (sagita) = 16,3 mm
```

El riel **no existe** entre −19° y +19°. Ahí la fuerza es un lastre de latón y nada más: ninguna tolerancia del riel, ningún espesor de fieltro y ningún error de corte pueden tocar la meseta de 400 mN. Ésa es la razón estructural por la que este diseño es construible a mano.

---

## 2. LISTA DE CORTE

### 2.1 Pino macizo de 18 mm

Compra **un tablero de pino de 18 × 200 × 1200 mm** (Leroy Merlin / Bricomart, 6–9 EUR). Te sobrará casi la mitad. El servicio de corte de la tienda te hace los cortes rectos gratis; pídelos con las cotas de la columna "Corte en tienda".

| Cód. | Pieza | Largo × Ancho × Grueso (mm) | Cant. | Corte en tienda | Notas |
|---|---|---|---|---|---|
| **B1** | Base | 300 × 200 × 18 | 1 | sí | canto delantero redondeado r=3 |
| **C1** | Lateral de columna | 112 × 62 × 18 | 2 | sí | grano vertical |
| **C2** | Trasera de columna | 112 × 80 × 18 | 1 | sí | cierra el canto de C1 |
| **C3** | Tapa de columna (plataforma de rodamientos) | 80 × 80 × 18 | 1 | sí | pieza de precisión: escuadra a 90° |
| **C4** | Soporte inferior del perno | 44 × 62 × 18 | 1 | no | encolado dentro de la columna |
| **C5** | Cuna del motor NEMA11 | 44 × 62 × 18 | 1 | no | rebaje de 30×30 para el cuerpo del motor |
| **P1** | Pedestal de rampa izquierda | 115 × 40 × 18 | 2 | no | apilar 2 → poste de 40×36; ver nota |
| **P2** | Pedestal de rampa derecha | 115 × 40 × 18 | 2 | no | ídem |
| **P3** | Zócalo del contrapeso (soporte del tubo) | 90 × 60 × 18 | 1 | no | trasera de la columna |
| **P4** | Pie de la cuna caliente (outrigger) | 100 × 100 × 18 | 1 | no | pie independiente, ver §4.7 |
| **P5** | Poste de la cuna caliente | 150 × 40 × 18 | 1 | no | |
| **W1** | Lastre trasero (contrapeso de vuelco) | 120 × 80 × 18 | 1 | no | se atornilla bajo B1 con 400 g de arandelas |

> **Nota sobre P1/P2:** los pedestales de rampa se hacen apilando **dos** piezas de 18 mm a testa (18+18 = 36 mm de sección) para que no vibren. Altura final tras ajuste: **115 mm ± calzos**. No los cortes a medida definitiva hasta el paso 21.

Superficie total de pino: ≈ 0,135 m². Un tablero de 200 × 1200 son 0,24 m². Sobra.

### 2.2 Contrachapado de abedul de 4 mm

Un retal de **4 × 300 × 600 mm** (o dos de 300×300) basta. Coste 3–6 EUR, o gratis del cubo de retales.

| Cód. | Pieza | Forma y cotas (mm) | Cant. | Taladro central | Notas |
|---|---|---|---|---|---|
| **D-F** | Disco tambor, brida inferior | Ø 148 | 1 | Ø 24 (holgado) | |
| **D-D** | Disco tambor, fondo de garganta | Ø 140 | 1 | Ø 24 (holgado) | forma la garganta r=70 |
| **D-E** | Disco central, **agarra rodamiento #2** | Ø 148 | 1 | **Ø 22 H8 (ajustado)** | única cota de precisión de la pila |
| **D-A** | Disco sector, fondo de garganta | Ø 120 | 1 | Ø 24 (holgado) | forma la garganta r=60 |
| **D-B** | Disco sector, brida superior | Ø 128 | 1 | Ø 24 (holgado) | |
| **Y1** | Brazo del yugo, **agarra rodamiento #1** | 200 × 80 | 1 | **Ø 22 H8**, centro a 40 mm del extremo trasero | rigidizado con listones |
| **Y2** | Mejilla de unión yugo↔pila | 60 × 70 | 2 | — | separan Y1 de la pila 50 mm |
| **Y3** | Testera de varillas del carro (trasera) | 70 × 30 | 1 | 2 × Ø 6 H8 | |
| **Y4** | Testera de varillas del carro (delantera) | 70 × 30 | 1 | 2 × Ø 6 H8 | mismo utillaje que Y3 |
| **K1** | Cuerpo del carro radial | 60 × 55 | 2 (encolados = 8 mm) | 2 × Ø 8 (para casquillo PTFE) + Ø 8,2 tuerca T8 | |
| **K2** | Mejilla de bisagra de cabeceo | 45 × 40 | 2 | Ø 3,2 | par de precisión: taladrar juntas |
| **K3** | Bloque de bisagra (dado de la botavara) | 24 × 20 | 1, **en madera dura o 3 capas de ply** | Ø 4,1 pasante + Ø 6 transversal | ver §7 |
| **R1** | Costilla de rampa, radio interior (r=125) | perfil desarrollado, ≈ 100 × 30 | 2 (una por rampa) | — | de la tabla §4.3 |
| **R2** | Costilla de rampa, radio exterior (r=175) | perfil desarrollado, ≈ 140 × 30 | 2 | — | mismas alturas, base 1,4× más larga |
| **R3** | Base de rampa | sector anular r=118→182, 30° de arco | 2 | — | soporta las costillas |
| **R4** | Refuerzo transversal de rampa | 50 × 25 | 6 | — | 3 por rampa |
| **T1** | Torre del cabrestante, laterales | 75 × 40 | 2 | Ø 8,2 a 63 mm de la base | par de precisión |
| **T2** | Torre del cabrestante, techo | 40 × 30 | 1 | — | |
| **L1** | Tapa frontal de la columna | 112 × 80 | 1 | — | forrada de fieltro, 2 tornillos de nylon |
| **L2** | Tapa del carro (cubre el 28BYJ-48) | 120 × 70 | 1 | — | forrada de fieltro |
| **S1** | Escala del lastre (tira impresa sobre ply) | 180 × 12 | 1 | — | opcional |

### 2.3 Contrachapado de 0,8 mm (forro / *skin* de las rampas)

| Cód. | Pieza | Cotas (mm) | Cant. |
|---|---|---|---|
| **SK1** | Forro de rampa | 150 × 65, se recorta al montar | 2 |

Contrachapado aeromodelista de 0,8 mm (chopo o abedul), 1–2 EUR la plancha de 100×1000 en cualquier tienda de aeromodelismo o AliExpress. **Sustituto válido:** dos capas de cartulina gris de 0,4 mm encoladas con cola blanca y barnizadas, o una lata de refresco abierta y aplanada (0,1 mm de aluminio) sobre una capa de cartulina.

### 2.4 Perfiles, tubos y varillas

| Pieza | Especificación | Largo (mm) | Cant. | EUR |
|---|---|---|---|---|
| Botavara, tramo proximal | tubo de carbono Ø4 × Ø2,5 | 250 (x = −90 a +160) | 1 | 2,50 |
| Botavara, tramo distal (**fusible**) | varilla GRP maciza Ø2 (larguero de cometa) | 90 (x = 155 a 245, solape 5 mm) | 1 | 1,00 |
| Varilla del lastre (**adición A2**) | varilla de carbono Ø3 maciza | 200 | 1 | 1,00 |
| Montantes de la varilla del lastre | ply 4 mm, 20 × 14, ranurados | — | 2 | — |
| Varillas del carro radial | acero rectificado Ø6 h6 | 130 | 2 | 3,00 |
| Husillo radial | **T8, paso 8 mm/vuelta** (1 entrada × 8 mm o 4 entradas × 2 mm) + tuerca de latón | 120 | 1 | 3,00 |
| Casquillos del carro | tubo PTFE Ø8 ext / Ø6 int | 20 (2 × 10) | 1 | 0,50 |
| Casquillo de bisagra | tubo de latón Ø5 ext / Ø3 int | 22 | 1 | 0,60 |
| Cojinete de bisagra | tubo PTFE Ø6 ext / Ø5 int | 20 | 1 | 0,50 |
| Acoplamiento torsional | tubo de silicona Ø10 ext / Ø6 int | 25 | 1 | 0,60 |
| Portabrocha | tubo de silicona Ø10 ext / Ø6 int | 30 | 2 | 0,60 |
| Tubo del amortiguador | **PVC evacuación Ø32 ext (Ø29 int)** | 240 | 1 | 1,50 |
| Tapón inferior del amortiguador | tapón PVC Ø32 | — | 1 | 0,80 |
| Separador de rodamientos | tubo de aluminio o latón Ø10 ext / Ø8,2 int | 43 | 1 | 0,50 |
| Separador columna (perno) | tubo Ø10 / Ø8,2 | 40 | 1 | 0,30 |
| Listones rigidizadores del yugo | pino 10 × 10 | 190 (2 uds) | 2 | 0,50 |

### 2.5 Rodamientos, tornillería y consumibles

| Pieza | Espec. | Cant. | EUR |
|---|---|---|---|
| Rodamiento de barrido | **608ZZ** (8×22×7) | 2 | 1,00 |
| Cabrestante y polea de reenvío | **623ZZ** (3×10×4) | 3 | 0,90 |
| Perno del eje de barrido | **M8 × 160 DIN 931** (vástago liso ≥ 130) | 1 | 0,80 |
| Perno del cabrestante | **M8 × 60 DIN 931** | 1 | 0,40 |
| Perno de bisagra | M3 × 30 + tuerca autoblocante | 1 | 0,20 |
| Arandelas PTFE Ø3 | juego de 50 | 1 | 3,00 |
| Topes captivos de barrido | M4 × 25 cabeza cilíndrica + tuerca | 2 | 0,30 |
| Tornillo de altura del patín (**A1**) | M4 × 40 + 2 tuercas M4 + tuerca ciega | 1 | 0,30 |
| Prisionero de nylon del lastre | M3 × 6 punta nylon | 1 | 0,30 |
| Tornillos de nylon M2,5 (motor) | M2,5 × 12 + arandelas nylon | 4 | 0,80 |
| Tornillos de madera | 3,5 × 30 y 3,5 × 16 | 30 | 1,50 |
| Cuerda Dyneema | trenzado 0,4 mm, ≥ 25 kg | 10 m | 3,00 |
| **Lastre de fuerza** | latón, **40,0 g exactos** (ver §9.3) | 1 | 2,00 |
| **Contrapeso** | acero, valor de la tabla §8.4 (250–600 g) | 1 | 3,00 |
| Lastre de vuelco W1 | 400 g de arandelas M10 o plomo de pesca | — | 1,00 |
| **Lastre de base** (A-27 del BOM) | arena+cola o chapa de acero, ~640 g, hasta los 1,6 kg de base que exige la spec | — | 3,00 |
| Brocha kabuki pelo de cabra Ø60 | 2 uds (recortes desiguales) | 2 | 12,00 |
| Bridas de nylon 2,5 mm | — | 20 | 0,50 |
| Patín PTFE | disco Ø12 × 4 (de barra o de arandelas apiladas) | 1 | 0,80 |
| Fieltro autoadhesivo de lana, 1 mm | lámina A4 | 2 | 4,00 |
| Fieltro grueso 3 mm (forro de columna) | lámina A4 | 1 | 2,50 |
| Junta EPDM autoadhesiva 3 mm | rollo 6 m | 1 | 4,50 |
| Corcho 6 mm (pies + suela) | lámina A4 | 1 | 2,00 |
| Spray de PTFE seco | 400 ml | 1 | 7,00 |
| Cola blanca D3 + cianoacrilato + epoxi 5 min | — | — | 8,00 |

**Subtotal mecánica ≈ 81 EUR** sin electrónica ni motores. Con NEMA11 (9), TMC2209 (5), RP2040-Zero (4,5) y 28BYJ-48+ULN2003 (2) → **≈ 101 EUR**. Coincide con la horquilla 52–110 de la spec una vez que se añaden las dos brochas, el amortiguador y el silenciado completo.

### 2.6 Herramientas

**Imprescindibles:** taladro de mano o atornillador con brocas 2, 3, 3,2, 4,1, 6, 8,2 y 12 mm; **broca de pala o Forstner de 22 mm**; sierra de marquetería (segueta) con hojas de dientes finos para madera; caladora o serrucho de costilla; escuadra; regla de acero de 300 mm; lima plana bastarda y lima de media caña; papel de lija 120/240/400; sargentos (mínimo 4); punzón de marcar; **calibre pie de rey digital** (12 EUR, no es opcional); **báscula de cocina con resolución de 1 g** (mejor 0,1 g); compás de puntas; termómetro IR barato (opcional, 12 EUR).

**Muy recomendable:** un taladro de columna barato o un soporte de taladro (25–40 EUR). Los tres agujeros de 22 mm y el par de mejillas de la bisagra salen mucho mejor.

**No necesitas:** impresora 3D, torno, fresadora, ni cortadora láser (hay camino alternativo para las tres, §5.0 y Anexo B).

---

## 3. PLANOS ACOTADOS

### 3.1 Base B1 — planta (vista desde arriba)

```
 <------------------------------ 300 ------------------------------>
 +-----------------------------------------------------------------+  ^
 |  o pie corcho                                     pie corcho o   |  |
 |                       +-------------+                           |  |
 |                       |   COLUMNA   |  <-- 80 x 80              |  |
 |                       |   80 x 80   |                           |  | 
 |          ...........  |      O      |  ...........              | 200
 |         .             +------|------+             .             |  |
 |        .    RAMPA IZQ        |         RAMPA DCHA  .            |  |
 |       .   (pedestal P1)      |        (pedestal P2) .           |  |
 |      .                       |                       .          |  |
 |  o  .                        |                        .      o  |  v
 +-----------------------------------------------------------------+
        <--- 150 --->    EJE DE BARRIDO O    <--- 150 --->
                         a 60 mm del borde trasero,
                         centrado en el lado de 300

  Cotas del eje de barrido O sobre B1:
     desde el borde trasero (superior en el dibujo): 60 mm
     desde el borde izquierdo:                      150 mm

  Centros de los pedestales de rampa (cara superior 115 mm):
     P1: r = 150, phi = -30 deg  ->  x = -75,0   y = +129,9   (mm desde O)
     P2: r = 150, phi = +30 deg  ->  x = +75,0   y = +129,9

  Aviso de vuelco: y = +129,9 + 60 = 189,9 mm desde el borde trasero,
  o sea 10 mm dentro del borde delantero de la base. Los pedestales
  APENAS caben. El borde delantero de las rampas (r=182 a phi=+/-43)
  vuela 35 mm fuera de la base. Es correcto y previsto.

  Lastre de vuelco W1: 400 g atornillados bajo la base, centrados
  en x=0, y = -55 mm desde O (parte trasera). Sin él la maquina
  vuelca hacia delante con un empujon de 4,5 N. Con el, aguanta 9 N.

  NOTA DE COHERENCIA (06-seguridad.md 8.3, correccion S-14): con una
  tabla de masas explicita esas dos cifras salen 8,8 N y 12,7 N. Los
  dos calculos discrepan un factor ~1,7 porque suponen alturas de
  empuje distintas. LA CONCLUSION ES LA MISMA EN LOS DOS Y ES LA QUE
  MANDA: con el analisis mas conservador, SIN W1 no se llega al
  minimo de 5 N. W1 NO es una carga masica acustica opcional: es una
  PIEZA DE SEGURIDAD. El criterio real es el ensayo 4.8 de
  06-seguridad.md, no la cuenta.

  LASTRE DE BASE, ADEMAS DE W1: la especificacion vinculante pide una
  base de 1,6 kg lastrada. El pino de 300x200x18 son 562 g, asi que
  faltan ~1040 g, de los cuales W1 aporta 400. Los ~640 g restantes
  van como arena+cola o chapa de acero repartida bajo B1 (linea A-27
  del BOM). Masa total de proyecto: 3,06 kg (03-bom.md 12.4).
```

**Taladros en B1:** 4 × Ø3 avellanados para los pies de corcho (25 × 25 × 6 en las cuatro esquinas, a 15 mm de los bordes); 4 × Ø4 para atornillar la columna desde abajo; 4 × Ø3,5 por pedestal; 2 × Ø4 para el zócalo P3 del amortiguador; 2 × Ø4 para el tirante del outrigger de la cuna.

### 3.2 Columna — alzado en sección (mirando desde el frente, +Y hacia el lector)

```
   z (mm)
   ^
 222|                                      <-- gálibo: NADA por encima de 260
    |                                          (referido al plano de base = z + 18)
 204|          [_] cabeza M8 x 160
 199|        =====  B  Ø128  ply 4        \
 195|        =====  A  Ø120  ply 4         |  garganta del TENDÓN, r = 60
 191|      =========  E  Ø148  ply 4       |  <-- E lleva el Ø22 H8 (rodam. #2)
 187|      =========  D  Ø140  ply 4       |  garganta del CONTRAPESO, r = 70
 183|      =========  F  Ø148  ply 4      /
    |            ||  608ZZ #2  (z 186-193, centro 190)
    |            ||
    |            ||   tubo separador 43 mm
    |            ||
 142|   =====================  Y1  brazo del yugo, ply 4 (200 x 80)
 138|   =====================        Ø22 H8 sobre 608ZZ #1 (z 136-143, c. 140)
 136|            ||  casquillo 6 mm
 130| +----------++----------+   <-- C3 tapa de columna 80x80x18
    | |          ||          |
 112| +--- ------++----------+
    | |   [NEMA11 vertical]  |   C1/C1/C2 laterales y trasera
    | |    eje hacia arriba  |
  72| |  +----C4----+        |   soporte inferior del perno (44x62x18)
  54| |  +----------+        |   tuerca M8 + arandela debajo
    | |                      |
    | |  [TMC2209 + MCU]     |
   0| +----------------------+  <=== cara superior de la base B1
   
       <--- 80 --->
```

**La torre del cabrestante T1/T2** va atornillada sobre C3 **detrás** del eje (φ = 180°), con el eje del cabrestante a **r = 100 mm, z = 193 mm**, alineado con la garganta del tendón. Altura de la torre: 63 mm sobre C3.

### 3.3 Eje de barrido — despiece de la pila (de abajo arriba)

Esto es la pieza clave del "cero mecanizados de precisión": **la coaxialidad la da el perno, no un agujero**.

| z (mm) | Elemento | Ø del taladro |
|---|---|---|
| 44–54 | tuerca M8 autoblocante + arandela | — |
| 54–72 | **C4** soporte inferior (pino 18) | Ø 8,5 holgado |
| 72–112 | tubo separador de 40 mm sobre el vástago | Ø int. 8,2 |
| 112–130 | **C3** tapa de columna (pino 18) | Ø 8,5 holgado |
| 130–136 | casquillo/arandelas de 6 mm | — |
| 136–143 | **608ZZ #1** (pista interior sobre el vástago) | — |
| 138–142 | **Y1**, brazo del yugo, sobre la **pista exterior** | **Ø 22 H8** |
| 143–186 | tubo separador de 43 mm | Ø int. 8,2 |
| 186–193 | **608ZZ #2** | — |
| 187–191 | disco **E**, sobre la **pista exterior** | **Ø 22 H8** |
| 193–199 | arandela + cabeza del M8 × 160 | — |

Apretar la tuerca inferior comprime toda la pila contra la cabeza. El yugo (Y1 + mejillas Y2 + pila de discos) queda como **un solo cuerpo rígido girando sobre dos rodamientos separados 50 mm**. Los únicos dos agujeros que importan son los dos Ø22 H8, y los haces con la misma broca Forstner de 22 mm en la misma sesión.

```
 CORTE POR EL EJE DE BARRIDO (ampliado)

        cabeza M8
          [___]
        __|  |__          <-- disco B (Ø128)
       |__|  |__|         <-- disco A (Ø120)   garganta tendón r=60
    ___|__|  |__|___      <-- disco E (Ø148)   *** Ø22 H8, va sobre 608ZZ#2
   |___|##|  |##|___|     <-- disco D (Ø140)   garganta contrapeso r=70
   |___|##|  |##|___|     <-- disco F (Ø148)
        |##|  |##|
        |  |  |  |        608ZZ #2  (## = pista exterior)
        |  |  |  |
        |  |__|  |
        |        |        tubo separador 43
        |  ____  |
        |_|####|_|        608ZZ #1
    ____|_|####|_|____
   |____|_|##|_|_|____|   <-- Y1  *** Ø22 H8, va sobre 608ZZ#1
        |      |
       [casquillo 6]
   =====================  <-- C3 tapa de columna
```

### 3.4 Yugo y carro radial — planta

```
  eje de barrido O
       |
       v
  +----O------------------------------------------------+     ^
  |    .                                                 |     |
  | ()=|=[28BYJ-48]=[acopl.]===T8 husillo 8 mm/vuelta====|     | 80
  |    .        ||                            ||         |     |
  |  --+--------||----------------------------||-------  |  varilla 6 mm (sup.)
  |    .     [ CARRO K1 ]                      |         |     |
  |  --+--------||----------------------------||-------  |  varilla 6 mm (inf.)
  |    .        ||                                       |     v
  +----+--------||---------------------------------------+
       |        ||
       |    mejillas K2 -> BISAGRA DE CABECEO (eje M3 horizontal)
       |
       |<--35-->|                     r del carro: 35 (dentro) a 85 (fuera)
       |<---------60----------|       centro nominal r = 60
       |<--------------85------------>|

  Recorrido del carro: +/- 25 mm  ->  R de la brocha 275 ... 325 mm
  Husillo T8, 8 mm/vuelta:  5 mm = 0,625 vuelta = 2,5 s a 15 rpm
  Separacion entre varillas: 40 mm (una arriba, una abajo del husillo)
  Longitud util de varilla: 130 mm, montadas en las testeras Y3 (r=15) e Y4 (r=145)
```

### 3.5 Bisagra de cabeceo pasiva — sección (mirando a lo largo de la botavara)

Éste es el **único** cojinete en el camino de la fuerza. Todo su error acaba en la piel.

```
        mejilla K2          bloque K3          mejilla K2
        (ply 4)          (madera dura)          (ply 4)
       ______             ____________             ______
      |      |           |            |           |      |
      |  o---|===========|=====O======|===========|---o  |
      |______|  ^        |     ^      |        ^  |______|
                |        |     |      |        |
        arandela PTFE    |  cojinete  |    arandela PTFE
        Ø3 (0,5 mm)      |  PTFE Ø6/5 |    Ø3 (0,5 mm)
                         |____________|
                              |
        CASQUILLO DE LATÓN Ø5 ext / Ø3 int, largo 21,2 mm
        <----------------------------------------------->
        El perno M3 aprieta MEJILLA-arandela-CASQUILLO-arandela-MEJILLA.
        El precarga NUNCA toca el bloque K3: el bloque gira libre
        sobre el cojinete PTFE que va calado sobre el casquillo.

        Largo del casquillo = ancho de K3 (20,0) + 2 x arandela (1,0) + 0,2 holgura
                            = 21,2 mm  (medir el tuyo y ajustar a lima)

  Par de arranque medido en la punta:  ~1,0 mN  (mu_PTFE 0,06, F 1,5 N, r 2,5 mm)
  Sin el cojinete PTFE (latón contra madera, mu 0,2): 3,1 mN. Ponlo.
```

**El eje del M3 debe quedar horizontal y TANGENCIAL a ±3° (rechazo a 5°).** Método de verificación en §6.

### 3.6 Botavara — alzado (x = 0 en la bisagra)

```
 x = -90        0        60      90     125          160      240
     |          |         |       |      |            |        |
  [COLA]======[BISAGRA]===+=======+======+============+========[BROCHA]
     ^          ^         ^       ^      ^            ^          ^
     |          |         |       |      |            |          |
   contrapeso  eje M3   montante  |    LASTRE      empalme    ferrula
   de la cola  horizontal  varilla|    40 g        carbono/GRP  Ø60 kabuki
   (equilibra   tangencial  lastre |   (sobre la varilla        52 mm cargada
    la cabeza)             (14 mm  |    de 3 mm, 14 mm arriba)
                            arriba)|
                                   |
                          PATÍN PTFE Ø12 colgando
                          por debajo, tornillo M4 de altura +/-12 mm

  ALZADO REAL (proporciones verticales exageradas):

              varilla lastre Ø3 carbono, +14 mm
        ______[####LASTRE 40 g####]__________________
       |      |                   |                  |
  =====|======O===================|==================|=========( BROCHA
  cola |    bisagra          montante            empalme        Ø60
       |______|                   |               carbono/GRP
              |                   |
              |              [ M4 altura ]
              |                   |
              |               (o) PATÍN PTFE Ø12       <-- rueda sobre el riel
              |
        <---- 90 ---->

  Tramos:   carbono Ø4x2,5 de x=-90 a x=+160   (250 mm)
            GRP macizo Ø2  de x=+155 a x=+245  (90 mm, 5 mm de solape con epoxi)
            El GRP es el FUSIBLE de sobrecarga: k = 70 N/m, 20 mm de flecha a 1,4 N
```

### 3.7 Sección del riel — perfil de una rampa (desarrollo a r = 150)

```
  altura h (mm)
  ^
  |                                        MESETA PLANA (34-43 deg)
 7|                                    ________________________
  |                                   /                        
  |                        RAMPA DE  /  pendiente 11,9 deg
  |                        DESPEGUE /   (26-34 deg)
 3|                                /
  |         RAMPA DE DESCARGA   __/     <- codo a h = h_t (2,58 nominal)
  |         (19-26 deg)      __/
 0|________________________-/                                   
  |     .                  ^ 19 deg: el patín TOCA aquí y en ningún sitio antes
-2|.....'  rampa de aproximación (12-19 deg), NO toca
-3|
  +----+----+----+----+----+----+----+----+----+---> phi (grados)
  0   5   10   15   20   25   30   35   40   43

  Fuerza sobre la piel:
  400 mN |------------------\
         |                   \
         |                    \
       0 |                     \______________________________
         0                19    26                          43
```

---

## 4. LA RAMPA / RIEL — LA PIEZA CRÍTICA

### 4.1 Qué hace y por qué es así

El riel es el **segundo actuador de la máquina**, hecho de madera. Convierte el barrido (un motor) en cuatro cosas que normalmente exigen un segundo eje motorizado:

1. **Rampa geométrica de fuerza** al aterrizar (0 → 400 mN en 0,5–1,8 s), que es el antídoto directo contra la señal temporal de "insecto que aterriza".
2. **Despegue completo** (11,8 mm de aire real) antes de cada inversión.
3. **Huecos programables** de 1,5–5,5 s de contacto cero, por simple permanencia en la meseta.
4. **Todas las aceleraciones, deceleraciones e inversiones fuera de la piel.**

Y no hace una cosa, deliberadamente: **no toca la meseta de 400 mN**, porque entre −19° y +19° el riel no existe. Una tolerancia de ±0,5 mm en el riel mueve *dónde* ocurre la rampa, nunca *cuánta* fuerza hay en la caricia.

### 4.2 Construcción rib-and-skin (costilla y forro)

La superficie del riel es una **superficie reglada**: a cada ángulo φ le corresponde una altura h(φ) **idéntica en todo el ancho radial** (de r=125 a r=175). Es decir, la generatriz es una recta horizontal radial. Eso es lo que permite construirla como un ala de avión:

```
  SECCIÓN TRANSVERSAL DE UNA RAMPA (corte radial, a un phi cualquiera)

        <-------------- 60 mm de ancho de forro -------------->
        <-5-><----------- 50 mm entre costillas ---------><-5->
         ___________________________________________________
        |  fieltro 1 mm                                      |   <- superficie útil
        |____________________________________________________|
        | forro ply 0,8 mm curvado en el sentido del arco    |
        +----+---------------------------------------+-------+
             |                                       |
             | COSTILLA R1                  COSTILLA R2      |
             | (r = 125)                    (r = 175)        |
             | ply 4 mm                     ply 4 mm         |
             |  altura = h(phi) + 20 mm de talón             |
        +----+---------------------------------------+-------+
        |          BASE DE RAMPA R3 (sector anular, ply 4)    |
        +-----------------------------------------------------+
                          ||   refuerzos R4 (3 uds)
                     PEDESTAL P1/P2 (pino 36 x 40 x 115)
                          ||
        ==================||===================================  base B1
```

- Las dos costillas se pegan **exactamente a 50 mm** (r=125 y r=175), sus líneas de φ alineadas radialmente. Si las alturas coinciden grado a grado, la superficie sale reglada y sin alabeo **por construcción**, sin medir nada.
- El forro de 0,8 mm se curva **sólo en el sentido del arco** (curvatura simple). Sube 9,5 mm en 81 mm de arco: se dobla con los dedos. No lo mojes, no lo fuerces radialmente.
- El fieltro de 1 mm autoadhesivo va **encima del forro, no debajo**. Comprime ~0,2 mm bajo 1,07 N, uniformemente, y esos 0,2 mm los absorbe el ajuste de altura del patín (§A1).

> **CORRECCIÓN C4 — las dos costillas NO son idénticas.** La spec dice "dos costillas de arco idénticas cortadas de UNA plantilla". Geométricamente es imposible: en el desarrollo, 1° son **2,182 mm** a r=125 y **3,054 mm** a r=175, un 40 % de diferencia. Lo que sí es único es la **tabla h(φ)**. Se imprimen dos desarrollos a partir de la misma tabla, con la misma columna de alturas y distinta columna de abscisas. Las §4.3 y §4.4 dan ambas columnas.

### 4.3 Tabla de alturas del riel, grado a grado (nominal, k_brush = 58 N/m)

`h` es la altura de la **cara superior del fieltro** sobre el datum (z = 145 mm).
`x125` y `x175` son las abscisas en el desarrollo impreso de cada costilla, medidas desde φ = 0.
`F` es la fuerza sobre la piel. `Aire` es la separación real punta–piel (viaje de punta **menos** compresión del pelo, que es lo que la spec exige medir bien). `Pend.` es la pendiente local de la superficie del riel.

| φ (°) | h (mm) | x125 (mm) | x175 (mm) | F (mN) | Aire (mm) | Pend. (°) | Zona |
|---:|---:|---:|---:|---:|---:|---:|---|
| 0 | −2,50 | 0,0 | 0,0 | 400 | 0,0 | 0,0 | sin riel |
| 1 | −2,50 | 2,2 | 3,1 | 400 | 0,0 | 0,0 | sin riel |
| 2 | −2,50 | 4,4 | 6,1 | 400 | 0,0 | 0,0 | sin riel |
| 3 | −2,50 | 6,5 | 9,2 | 400 | 0,0 | 0,0 | sin riel |
| 4 | −2,50 | 8,7 | 12,2 | 400 | 0,0 | 0,0 | sin riel |
| 5 | −2,50 | 10,9 | 15,3 | 400 | 0,0 | 0,0 | sin riel |
| 6 | −2,50 | 13,1 | 18,3 | 400 | 0,0 | 0,0 | sin riel |
| 7 | −2,50 | 15,3 | 21,4 | 400 | 0,0 | 0,0 | sin riel |
| 8 | −2,50 | 17,5 | 24,4 | 400 | 0,0 | 0,0 | sin riel |
| 9 | −2,50 | 19,6 | 27,5 | 400 | 0,0 | 0,0 | sin riel |
| 10 | −2,50 | 21,8 | 30,5 | 400 | 0,0 | 0,0 | sin riel |
| 11 | −2,50 | 24,0 | 33,6 | 400 | 0,0 | 0,0 | sin riel |
| 12 | −2,50 | 26,2 | 36,7 | 400 | 0,0 | 0,7 | inicio aproximación |
| 13 | −2,38 | 28,4 | 39,7 | 400 | 0,0 | 5,3 | aproximación |
| 14 | −2,03 | 30,5 | 42,8 | 400 | 0,0 | 9,4 | aproximación |
| 15 | −1,53 | 32,7 | 45,8 | 400 | 0,0 | 11,7 | aproximación |
| 16 | −0,97 | 34,9 | 48,9 | 400 | 0,0 | 11,7 | aproximación |
| 17 | −0,47 | 37,1 | 51,9 | 400 | 0,0 | 9,4 | aproximación |
| 18 | −0,12 | 39,3 | 55,0 | 400 | 0,0 | 5,3 | aproximación |
| **19** | **0,00** | **41,5** | **58,0** | **400** | 0,0 | 1,4 | **CONTACTO DEL PATÍN** |
| 20 | 0,13 | 43,6 | 61,1 | 380 | 0,0 | 5,4 | descarga |
| 21 | 0,49 | 45,8 | 64,1 | 325 | 0,0 | 9,7 | descarga |
| 22 | 1,00 | 48,0 | 67,2 | 245 | 0,0 | 12,1 | descarga |
| 23 | 1,58 | 50,2 | 70,2 | 155 | 0,0 | 12,1 | descarga |
| 24 | 2,09 | 52,4 | 73,3 | 75 | 0,0 | 9,7 | descarga |
| 25 | 2,45 | 54,5 | 76,4 | 20 | 0,0 | 5,4 | descarga |
| **26** | **2,58** | **56,7** | **79,4** | **0** | **0,0** | 6,7 | **PIEL LIBRE** |
| 27 | 3,13 | 58,9 | 82,5 | 0 | 1,5 | 11,9 | despegue |
| 28 | 3,69 | 61,1 | 85,5 | 0 | 3,0 | 11,9 | despegue |
| 29 | 4,24 | 63,3 | 88,6 | 0 | 4,4 | 11,9 | despegue |
| 30 | 4,79 | 65,4 | 91,6 | 0 | 5,9 | 11,9 | despegue |
| 31 | 5,34 | 67,6 | 94,7 | 0 | 7,4 | 11,9 | despegue |
| 32 | 5,89 | 69,8 | 97,7 | 0 | 8,9 | 11,9 | despegue |
| 33 | 6,45 | 72,0 | 100,8 | 0 | 10,3 | 11,9 | despegue |
| **34** | **7,00** | **74,2** | **103,8** | **0** | **11,8** | 6,0 | **inicio meseta** |
| 35 | 7,00 | 76,4 | 106,9 | 0 | 11,8 | 0,0 | meseta (inversión OK) |
| 36 | 7,00 | 78,5 | 110,0 | 0 | 11,8 | 0,0 | meseta (inversión OK) |
| 37 | 7,00 | 80,7 | 113,0 | 0 | 11,8 | 0,0 | meseta (inversión OK) |
| 38 | 7,00 | 82,9 | 116,1 | 0 | 11,8 | 0,0 | meseta (inversión OK) |
| 39 | 7,00 | 85,1 | 119,1 | 0 | 11,8 | 0,0 | meseta (inversión OK) |
| 40 | 7,00 | 87,3 | 122,2 | 0 | 11,8 | 0,0 | meseta (fin de inversiones) |
| 41 | 7,00 | 89,4 | 125,2 | 0 | 11,8 | 0,0 | sólo aparcamiento |
| 42 | 7,00 | 91,6 | 128,3 | 0 | 11,8 | 0,0 | microrruptor cierra |
| **43** | **7,00** | **93,8** | **131,3** | **0** | **11,8** | 0,0 | **TOPE M4 + CUNA** |

**Ecuaciones que generan la tabla** (φ en grados, S(u) = ½(1 − cos πu), la S de coseno alzado):

```
  h(phi) = -2,50                                          para  0 <= phi < 12
  h(phi) = -2,50 + 2,50 * S((phi-12)/7)                   para 12 <= phi < 19
  h(phi) =  h_t * S((phi-19)/7)                           para 19 <= phi < 26
  h(phi) =  h_t + 4,42 * (phi-26)/8                       para 26 <= phi < 34
  h(phi) =  h_t + 4,42                                    para 34 <= phi <= 43

  con  h_t = (0,400 / k_brush) / 2,67   [m]  =  c_pelo / 2,67   [mm]
```

**Por qué coseno alzado y no una recta.** Con una rampa recta, la fuerza empieza a caer con un escalón de 328 mN/s en el instante mismo en que el patín toca. Ese escalón *es* un evento perceptible. Con S(u), la derivada de la fuerza vale cero en los dos extremos: la descarga entra y sale suavemente, con un pico de 514 mN/s en el centro, donde ya no hay ningún borde temporal que detectar. Es la misma razón por la que se usan perfiles cicloidales en las levas.

### 4.4 Plantilla paramétrica — corta el TAPER SÓLO DESPUÉS de medir k_brush

**Fórmula vinculante:**

```
        subida del taper   h_t  =  (0,400 / k_brush) / 2,67       [m, N/m]

  equivalente y mucho más fácil de medir en casa:

        h_t (mm)  =  compresión del pelo a 400 mN (mm) / 2,67
```

Es decir: **mides cuántos milímetros se hunde el pelo cuando la báscula marca 41 g, y divides entre 2,67.** Eso es todo. Procedimiento completo en §11.2.

Sólo la **amplitud del taper** depende de `k_brush`. La rampa de despegue son **siempre 4,42 mm en 8°** (pendiente 11,9°, trepada 66 mN·m) y la meseta es siempre `h_t + 4,42`. Por eso el resto de la máquina no cambia.

**Tabla paramétrica completa** — elige la columna de tu brocha medida e interpola si hace falta:

| k_brush (N/m) → | 30 | 40 | 50 | **58** | 70 | 90 |
|---|---:|---:|---:|---:|---:|---:|
| Compresión a 400 mN (mm) | 13,33 | 10,00 | 8,00 | **6,90** | 5,71 | 4,44 |
| **h_t** (mm) | **4,99** | **3,75** | **3,00** | **2,58** | **2,14** | **1,66** |
| **h meseta** (mm) | **9,41** | **8,17** | **7,42** | **7,00** | **6,56** | **6,08** |

| φ (°) | k=30 | k=40 | k=50 | **k=58** | k=70 | k=90 |
|---:|---:|---:|---:|---:|---:|---:|
| ≤12 | −2,50 | −2,50 | −2,50 | −2,50 | −2,50 | −2,50 |
| 13 | −2,38 | −2,38 | −2,38 | −2,38 | −2,38 | −2,38 |
| 14 | −2,03 | −2,03 | −2,03 | −2,03 | −2,03 | −2,03 |
| 15 | −1,53 | −1,53 | −1,53 | −1,53 | −1,53 | −1,53 |
| 16 | −0,97 | −0,97 | −0,97 | −0,97 | −0,97 | −0,97 |
| 17 | −0,47 | −0,47 | −0,47 | −0,47 | −0,47 | −0,47 |
| 18 | −0,12 | −0,12 | −0,12 | −0,12 | −0,12 | −0,12 |
| 19 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 |
| 20 | 0,25 | 0,19 | 0,15 | 0,13 | 0,11 | 0,08 |
| 21 | 0,94 | 0,71 | 0,56 | 0,49 | 0,40 | 0,31 |
| 22 | 1,94 | 1,46 | 1,16 | 1,00 | 0,83 | 0,65 |
| 23 | 3,05 | 2,29 | 1,83 | 1,58 | 1,31 | 1,02 |
| 24 | 4,05 | 3,04 | 2,43 | 2,10 | 1,74 | 1,35 |
| 25 | 4,75 | 3,56 | 2,85 | 2,46 | 2,03 | 1,58 |
| 26 | 4,99 | 3,75 | 3,00 | 2,58 | 2,14 | 1,66 |
| 27 | 5,55 | 4,30 | 3,55 | 3,14 | 2,69 | 2,22 |
| 28 | 6,10 | 4,85 | 4,10 | 3,69 | 3,25 | 2,77 |
| 29 | 6,65 | 5,40 | 4,65 | 4,24 | 3,80 | 3,32 |
| 30 | 7,20 | 5,96 | 5,21 | 4,79 | 4,35 | 3,87 |
| 31 | 7,76 | 6,51 | 5,76 | 5,35 | 4,90 | 4,43 |
| 32 | 8,31 | 7,06 | 6,31 | 5,90 | 5,46 | 4,98 |
| 33 | 8,86 | 7,61 | 6,86 | 6,45 | 6,01 | 5,53 |
| 34–43 | 9,41 | 8,17 | 7,42 | 7,00 | 6,56 | 6,08 |

**Regla de corte:** córtalo **0,5 mm bajo** de línea en la zona del taper y calza con tiras de fieltro fino o cinta de carrocero hasta la altura buena. Un riel que sólo descarga hasta 280 mN antes de la zona empinada da un colapso final de fuerza 3× más rápido y un despegue duro y perceptible. Al revés (taper demasiado alto) sólo acortas la meseta, que es un error benigno.

### 4.5 Cómo se dibujan las costillas (sin ordenador)

1. Coge una tira de papel milimetrado de **150 × 40 mm** para R1 y otra de **190 × 40 mm** para R2.
2. Traza una **línea base** longitudinal a 20 mm del borde inferior. Ésa es la referencia h = 0.
3. **R1 (r = 125):** marca la escala horizontal con la columna `x125`. Es decir, φ=12 en x=26,2 mm; φ=19 en 41,5; φ=26 en 56,7; φ=34 en 74,2; φ=43 en 93,8.
4. **R2 (r = 175):** misma operación con la columna `x175`: φ=12 en 36,7; φ=19 en 58,0; φ=26 en 79,4; φ=34 en 103,8; φ=43 en 131,3.
5. En cada φ levanta la **misma altura h** en las dos tiras. Une los puntos a mano alzada con un junquillo flexible (una regla de plástico fino sujeta con dedos) — no con segmentos rectos.
6. **Añade 20 mm de talón** por debajo de la línea base y ciérralo. Ese talón es lo que se pega a la base R3.
7. Pega las tiras a ply de 4 mm con **spray adhesivo reposicionable** (no cola blanca: deforma el papel).
8. Sierra 1 mm por fuera de la línea con la segueta, y **lima hasta la línea**. Comprueba con el calibre en φ=19, 26 y 34: tolerancia **±0,3 mm** en esos tres puntos, ±0,5 mm en el resto.
9. Repite para la segunda rampa (son espejo; puedes voltear la plantilla).

> **Comprobación imprescindible antes de encolar:** pon R1 y R2 juntas, alinea sus marcas de φ=19 y φ=34, y mira a contraluz. Las alturas deben coincidir en cada φ aunque las longitudes sean distintas. Si en φ=26 una mide 2,6 y la otra 3,1, la superficie saldrá alabeada y el patín balanceará al migrar el carro.

### 4.6 Variante fácil sin cortar curvas: costillas radiales

Si la segueta no es lo tuyo, esta versión da la misma superficie y es más tolerante:

- Corta **12 tacos rectangulares** de ply de 4 mm, de **60 mm de largo (radial)** y altura `h(φ) + 20 mm de talón`, para φ = 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 41, 43.
- Pégalos **radialmente** (apuntando al eje de barrido) sobre la base de rampa R3, en sus ángulos.
- Forra con el ply de 0,8 mm. Entre tacos hay 7,9 mm de arco a r=150: el forro no cede.
- Precisión igual o mejor, porque cada altura es un corte recto que mides con el calibre.

Alturas de los tacos, columna nominal k=58: **12 → −2,50 · 15 → −1,53 · 18 → −0,12 · 21 → 0,49 · 24 → 2,09 · 27 → 3,13 · 30 → 4,79 · 33 → 6,45 · 36 → 7,00 · 39 → 7,00 · 41 → 7,00 · 43 → 7,00**.

### 4.7 Cuna caliente de reposo (aparcamiento)

> **ACLARACIÓN.** La spec dice que la cuna va "sobre la propia base de la máquina". A φ=+43° y R=300 la punta está en **x = +205, y = +219 mm** desde el eje de barrido — a 55 mm por fuera del borde delantero de una base de 300×200. **La cuna necesita su propio pie.** El argumento de seguridad se mantiene intacto: sigue estando a 400 mm del cuerpo y sobre estructura de la máquina, no sobre la cama.

```
  PIE OUTRIGGER DE LA CUNA (planta)

     BASE B1                          tirante ply 4 mm
   +-----------+========================+
   |     O     |                        | P4 100x100x18
   +-----------+                        |    +--------+
                                        |    | (cuna) |
                                        +----+--------+
                                              ^
                                    centro de la cuna en
                                    x = +205, y = +219 desde O
```

- **Cuna:** un tapón de PVC de Ø63 o la tapa de un bote de cristal, Ø interior **65–70 mm**, profundidad **20 mm**, forrada por dentro con fieltro de 1 mm.
- **Poste P5** de 150 × 40 × 18 con **dos ranuras verticales de 25 mm** y dos tornillos M4 con palomilla: la altura de la cuna se ajusta ±12 mm.
- **Ajuste:** con la botavara en el tope de +43° (meseta, punta a +11,8 mm sobre el datum de piel), sube la cuna hasta que **los pelos entren 12 mm** y el borde de la ferrula quede 8 mm sobre el borde de la cuna. La brocha nunca debe apoyar su peso en la cuna: sólo se sumerge en un ambiente cerrado y templado.
- **Calefacción:** una resistencia de 220 Ω / 0,25 W pegada por fuera del fondo de la cuna, 0,11 W desde 5 V, con NTC de 10 k. Objetivo **35 °C** en el aire del interior de la cuna. Techo hardware ~40 °C por el valor de la resistencia. En serie, **fusible térmico de 47 °C**.
- El tirante que une P4 a B1 es ply de 4 mm de 40 mm de ancho, atornillado; impide que alguien mueva la cuna sin mover toda la máquina.

---

## 5. MONTAJE PASO A PASO

**Tiempo total: 9–12 horas repartidas en tres sesiones** (los encolados tienen que secar). No es un fin de semana ajustado; es un fin de semana tranquilo.

- **Sesión A (3–4 h):** pasos 1–10. Carpintería gruesa y la medición del tren.
- **Sesión B (3–4 h):** pasos 11–20. Yugo, carro, botavara, riel.
- **Sesión C (3–4 h):** pasos 21–32. Cabrestante, contrapeso, amortiguador, silenciado, puesta en marcha.

### 5.0 Tres caminos para las piezas de contrachapado

| Camino | Herramienta | Tiempo piezas ply | Precisión típica | Coste |
|---|---|---|---|---|
| **A · Manual** (recomendado) | segueta + limas + broca Forstner 22 | 3–4 h | ±0,3 mm | 0 EUR extra |
| **B · Corte láser** | servicio online (Anexo B) | 20 min de dibujo + 3–7 días | ±0,1 mm | 18–28 EUR |
| **C · Mixto** | láser sólo para discos y costillas; resto a mano | 1,5 h | ±0,1 / ±0,3 | 12–15 EUR |

Los **discos** (Ø120–148) se cortan a mano con un compás de puntas + segueta + lija sobre un taco girando: 15 min cada uno y quedan redondos. Los **Ø22 H8** se hacen con broca Forstner de 22 mm en taladro de columna, o con broca de pala + lija de tambor si vas a mano (mide con el calibre contra la pista exterior del 608ZZ: debe entrar a presión de dedo fuerte, sin martillo).

---

### PASO 1 — Cortar el pino (30 min)
Corta B1, C1×2, C2, C3 en la tienda. En casa corta C4, C5, P1–P5, W1. Lija todos los cantos a 240 y **redondea a r≈3 mm el canto delantero de la base** (es lo que roza una mano dormida).

### PASO 2 — Ensamblar la columna en seco (30 min)
Monta C1+C1+C2 en U con sargentos, sin cola. Comprueba escuadra en las dos diagonales (± 0,5 mm). Marca por dentro la posición de C4 (**cara superior a 72 mm** desde z=0) y de C5 (cuna del motor). Desmonta.

### PASO 3 — ⚠ MEDIR EL PAR DE DETENTE (45 min) — BLOQUEANTE
No compres el contrapeso hasta terminar este paso. Detalle completo en **§11.1**. Necesitas: el NEMA11, el TMC2209 **sin alimentar**, un hilo, una taza y monedas. Salida: **T_resist máximo en mN·m** referido al eje de barrido. Con él eliges la masa del contrapeso en la tabla §8.4.

### PASO 4 — Taladrar C3 y C4 (30 min)
Apila C3 sobre C4 con cinta de doble cara, marca el centro **(40, 40)** en C3, y **taladra Ø8,5 las dos a la vez**. Ese es todo el secreto de la alineación del perno de barrido: los dos agujeros son coaxiales porque los hiciste en la misma pasada. Separa, y avellana la cara inferior de C4 para la tuerca.

### PASO 5 — Encolar la columna (45 min + 4 h de secado)
Cola D3 en las juntas. Mete C4 a su cota (72 mm) y C5 (cuna del motor). **No pongas C3 todavía.** Sargentos, escuadra, deja secar. Antes de que fragüe, pasa el perno M8 por C3+C4 en seco para confirmar que baja sin forzar.

### PASO 6 — Forrar el interior de la columna (20 min)
Fieltro de 3 mm autoadhesivo en las **cuatro caras interiores**, incluida la cara inferior de C3. Recorta huecos para el motor y la electrónica. Esto es lo que impide que la columna sea una caja de resonancia (§9).

### PASO 7 — Montar C3 (20 min)
Encola y atornilla C3 sobre la columna con 4 tornillos de 3,5×30 desde arriba, avellanados. Comprueba con el nivel de burbuja del móvil que la cara superior queda **horizontal en las dos direcciones a menos de 0,5°**. Si no, calza bajo la columna. Esta cara define la verticalidad del eje de barrido, y la verticalidad es lo que hace que **v_punta = R·ω exactamente**, sin error de cono.

### PASO 8 — Montar el motor NEMA11 (30 min)
Motor **vertical, eje hacia arriba**, atornillado a C5 con **4 tornillos M2,5 de nylon y arandelas de nylon**, sobre una junta de EPDM de 3 mm. Ni un tornillo metálico: el camino estructural motor→madera tiene que ser elastómero. El eje sale por un pasamuros de Ø12 en C3 con **arandela de fieltro** (no debe rozar).

### PASO 9 — Montar la base y la columna (30 min)
Atornilla la columna a B1 desde abajo, con 4 tornillos de 4×40 y **cola blanca**, con el eje de barrido a **(150, 60)** desde el borde trasero izquierdo. Pega la suela de corcho de 6 mm bajo la huella de la columna y los 4 pies de corcho de 25×25×6. Atornilla el lastre de vuelco W1 con 400 g de arandelas.

### PASO 10 — Torre del cabrestante (45 min)
T1×2 + T2. Los **dos agujeros de Ø8,2 de T1 se taladran juntos** (apiladas con cinta). Eje del cabrestante a **z = 193 mm** (63 mm sobre C3), a **r = 100 mm, φ = 180°**. Atornilla la torre a C3. Mete el M8×60 con los dos 623ZZ y comprueba que gira libre y sin juego axial (una arandela ondulada o un poco de cinta de teflón en un extremo).

---

### PASO 11 — Cortar los discos de la pila (60 min)
D-F (Ø148), D-D (Ø140), D-E (Ø148), D-A (Ø120), D-B (Ø128). Marca el centro con punzón **antes** de cortar. Taladra el centro **primero**: Ø24 en F, D, A y B; **Ø22 H8 en E**. Luego corta las circunferencias.

### PASO 12 — Encolar la pila de discos (30 min + secado)
Orden de abajo arriba: **F(148) · D(140) · E(148) · A(120) · B(128)**. Ensarta las cinco por un trozo de varilla M8 con dos arandelas grandes y aprieta: eso las centra solas. Cola blanca. Deja secar 4 h.
Al terminar tendrás:
- garganta del **contrapeso** en r = 70, 4 mm de ancho, entre F y E;
- garganta del **tendón** en r = 60, 4 mm de ancho, entre E y B.
Repasa las dos gargantas con lija de 400 enrollada en un lápiz hasta que estén lisas.

### PASO 13 — ⚠ MEDIR k_brush (20 min) — BLOQUEANTE
Detalle en **§11.2**. Salida: la **compresión del pelo a 400 mN** en mm, y por tanto `h_t = compresión / 2,67`. **No cortes el riel antes de este paso.**

### PASO 14 — Brazo del yugo Y1 (45 min)
Corta Y1 (200 × 80), taladra el **Ø22 H8** con el centro a 40 mm del extremo trasero. Encola los dos listones de pino 10×10×190 a lo largo de los cantos: convierten una lámina de 4 mm en un perfil en U rígido. Encola las testeras Y3 e Y4 en sus posiciones (r = 15 y r = 145 medidos desde el centro del Ø22). **Taladra los cuatro Ø6 H8 de Y3 e Y4 apilándolas** para que las varillas queden paralelas.

### PASO 15 — Unir Y1 a la pila (30 min)
Las dos mejillas Y2 (60 × 70, ply 4) unen la cara superior de Y1 con la cara inferior del disco F, dejando **exactamente 41 mm de hueco** (para que los centros de los rodamientos queden a 50 mm). Encola y refuerza con escuadras de ply. Este conjunto —Y1 + Y2 + pila— es una sola pieza a partir de ahora.

### PASO 16 — Montar el eje de barrido (30 min)
Sigue la tabla de §3.3 de abajo arriba. Mete los 608ZZ **a mano, con presión de dedo**, sobre el vástago liso del M8×160. Cuela primero Y1 sobre el rodamiento #1 y luego el disco E sobre el #2. Aprieta la tuerca inferior hasta que la pila esté firme, **no más**: si aprietas demasiado, precargas los rodamientos y añades par de arranque.
**Prueba:** empuja el yugo con un dedo. Debe girar los 86° enteros y seguir libre. Un yugo que se para solo está mal montado.

### PASO 17 — Topes captivos de barrido (30 min)
Dos taladros **ciegos** de Ø4 × 10 mm en la cara superior de C3, en las posiciones que topan con un saliente del yugo a **φ = ±43,0°**. Tornillos M4×25 con tuerca por debajo (no pueden caerse). Pega un **taco de EPDM de 3 mm** en la cara de contacto. Comprueba con transportador: la excursión total tiene que ser **86° ± 1°**.

### PASO 18 — Carro radial (60 min)
1. Corta y encola K1 (dos capas de ply de 4 = 8 mm).
2. Taladra los **dos Ø8** para los casquillos de PTFE, separados **40 mm**, y el **Ø8,2** central para la tuerca de latón del T8.
3. Pega los casquillos de PTFE (tubo 8/6) con cianoacrilato; pasa un escariador o la propia varilla de 6 mm con lija hasta que deslice **suave y sin juego perceptible**.
4. Atornilla la tuerca de latón del T8 a K1 con dos M3.
5. Mete las varillas de Ø6 en Y3/Y4 y fíjalas con una gota de epoxi en las testeras.
6. Monta el husillo T8 y acóplalo al 28BYJ-48 con **25 mm de tubo de silicona** (o un acoplador de aluminio 5×8).
7. Atornilla el 28BYJ-48 a Y1 sobre una junta de EPDM, con tornillos de nylon.
8. **Prueba:** el carro debe recorrer los 50 mm (r=35 a r=85) sin agarrotarse en ningún punto, empujado a mano con dos dedos.

### PASO 19 — Bisagra de cabeceo (60 min) — **la operación crítica**
1. Corta las **dos mejillas K2 apiladas con cinta de doble cara** y taladra el Ø3,2 **de una sola pasada**. Esto garantiza que los dos agujeros son coaxiales.
2. Corta el bloque K3 en madera dura (haya, roble) o tres capas de ply. Taladra el **Ø4,1 pasante longitudinal** para la botavara y, **perpendicular a él y en el mismo plano**, el **Ø6 transversal** para el cojinete de PTFE.
3. **La perpendicularidad de esos dos taladros ES la alineación tangencial.** Hazlo con un taladro de columna o con una escuadra apoyada. Un error de 3° aquí es ±8,4 mN de fuerza; 10° son ±27,8 mN y cambian de signo con el sentido de la pasada.
4. Pega el cojinete de PTFE (tubo 6/5) en el Ø6 con cianoacrilato. Corta el casquillo de latón (5/3) a **ancho de K3 + 1,2 mm**.
5. Monta: mejilla · arandela PTFE · K3(sobre casquillo) · arandela PTFE · mejilla, y aprieta el M3 con tuerca autoblocante **hasta que el casquillo esté firme entre las mejillas**. K3 debe seguir girando con el peso de un dedo.
6. Atornilla las mejillas K2 al carro K1 con dos M3, con el **eje del M3 horizontal y perpendicular al radio**.
7. **Verifica ahora mismo con el método de §6.** Si sale >5°, afloja las mejillas, calza con una tira de papel de 0,1 mm en un lado y repite. No sigas montando con la bisagra mal.

### PASO 20 — Botavara (60 min + secado del epoxi)
1. Corta el tubo de carbono Ø4 a **250 mm** y la varilla GRP Ø2 a **90 mm**. Corta el carbono con un disco de Dremel o un cúter fino rodando; **no lo serres a lo bruto** (delamina). Ponte mascarilla: el polvo de carbono es desagradable.
2. **Empalme fusible:** epoxi de 5 min, mete 15 mm de GRP dentro del carbono, dejando 75 mm fuera. La transición queda en x = +160.
3. Marca en el carbono, con rotulador indeleble y regla: **x = 0** (centro de la bisagra), **x = 90** (patín), **x = 240** (cara de la ferrula), y una **escala de mm de x = 40 a x = 200** para el lastre.
4. Encola los dos montantes de la varilla del lastre (ply 4 mm, ranurados) a **x = 30 y x = 190**, con la ranura a **+14 mm sobre el eje del carbono**. Pega la varilla de carbono Ø3 × 200 mm en las ranuras con epoxi. Comprueba que queda **paralela** al tubo principal (±0,5 mm en los dos extremos).
5. Encola la cola de 90 mm (ya viene: el tubo va de x=−90 a x=+160).
6. Mete la botavara en el Ø4,1 de K3 con **cola epoxi**, con x=0 justo en el eje del M3. **Deja curar antes de tocar nada.**

### PASO 21 — Patín PTFE con ajuste de altura (45 min) — **adición A1**
```
            botavara Ø4
      ========================
            |    |
            | [] |   abrazadera de ply 4 mm x 2, atornillada con M3
            |    |
           [ M4 tuerca superior ]   <- bloqueo
            |    |
            |    |   VÁSTAGO M4 x 40
            |    |
           [ M4 tuerca inferior ]   <- ajuste, 0,7 mm por vuelta
            |    |
          __|____|__
         |__PTFE____|   disco Ø12 x 4, canto biselado 1 mm a 45 deg
```
1. Abrazadera de dos mitades de ply de 4 mm en **x = 90**, con el Ø4,1 semicircular en cada mitad, apretada con dos M3. **Roscar M4** en la mitad inferior (o pegar una tuerca M4 con epoxi).
2. Disco de PTFE Ø12 × 4 mm: sale de una barra de PTFE o de apilar 4 arandelas de PTFE Ø12 pegadas. **Bisela el canto a 45° y 1 mm** para que suba a la rampa de aproximación sin engancharse.
3. Pégalo a una tuerca ciega M4 con cianoacrilato, o taladra el disco Ø4,2 y pásale el M4 con tuerca a cada lado.
4. Marca una **escala** en el vástago M4: cada vuelta = 0,70 mm = 1,9 mm de aire en la punta ≈ 2° de desplazamiento del inicio del taper. Rango útil: **±12 mm** (±17 vueltas).
5. Puesta a cero de fábrica: con la botavara horizontal y la brocha apoyada en un plano a z = 150, el disco de PTFE debe quedar a **z = 145,0 mm**, es decir tocando el datum del riel.

### PASO 22 — Cortar y montar las rampas (2 h)
1. Dibuja las costillas con la tabla de **§4.3/4.4** y tu `h_t` medido (§4.5), o usa la variante de costillas radiales (§4.6).
2. Corta R3 (base de rampa): sector anular de **r = 118 a 182, 30° de arco** centrado en φ = ±31°. Compás grande, segueta, lija.
3. Encola R1 y R2 sobre R3 a **exactamente 50 mm** (r=125 y r=175), alineando las marcas de φ radialmente. Escuadra. Añade los tres refuerzos R4.
4. Corta SK1 (ply 0,8 mm) generoso, encólalo sobre las costillas con cola blanca, sujeta con pinzas de la ropa y cinta de carrocero mientras seca. **Curva sólo en el sentido del arco.**
5. Recorta el sobrante al ras con un cúter afilado. Lija los cantos.
6. **Pega el fieltro de 1 mm** por encima. Rocía **PTFE seco** sobre el fieltro y deja evaporar 30 min.
7. Encola/atornilla cada rampa sobre su pedestal P1/P2 y estos sobre la base, en **r = 150, φ = ±30°**.
8. **Ajuste de altura de la rampa:** afloja, calza con arandelas o cartulina hasta que la cara del fieltro quede a **z = 145,0 ± 0,3 mm** en φ = 19°. Comprueba con el calibre de profundidades apoyado en una regla que puentea desde C3.
9. Aprieta y **verifica el recorrido completo a mano**: empuja la botavara de −43 a +43 y escucha. Debe ser un siseo continuo, sin ningún clic, sin escalones y sin puntos duros. Cualquier clic es una junta del forro: rellénala con cola y lija.

---

### PASO 23 — Cabrestante y tendón de Dyneema (45 min)
Ver **§7** completo.

### PASO 24 — Tambor, cable del contrapeso y polea de reenvío (30 min)
Ver **§8.1**.

### PASO 25 — Tubo amortiguador (60 min)
Ver **§8.2 y §8.3**.

### PASO 26 — Final de carrera de aparcamiento (20 min)
Microrruptor de palanca en C3, actuado por el mismo saliente del yugo que toca el tope de +43°, **cerrando 2° antes del tope** (a φ = +41°). Pega la palanca a un taco de EPDM para que el cierre no suene. Cablea NA + común, dos hilos hasta la electrónica.

### PASO 27 — Cuna caliente (45 min)
Ver **§4.7**.

### PASO 28 — Cableado y bucles de servicio (45 min)
- Manguera de 9 hilos (28 AWG siliconado) desde la columna hasta el carro: 5 del 28BYJ-48, 2 de la resistencia calefactora, 2 del NTC.
- **Bucle coaxial obligatorio:** la manguera sube desde C3 en **hélice floja alrededor del perno M8**, 3 vueltas de Ø30 mm, antes de ir al yugo. Así el par que introduce en el barrido es despreciable.
- Los dos hilos que van a la ferrula suben **por dentro** del tubo de carbono y salen por un agujero de Ø2 en x = 230, y cruzan la bisagra **en bucle coaxial con el eje del M3** (los dos hilos trenzados, formando una espira de Ø8 mm centrada en el eje). Eso los convierte en +2 mN de error en vez de +30.
- Sujeta con **abrazaderas P forradas de fieltro**, nunca con bridas apretadas contra la madera.

### PASO 29 — Silenciado completo (60 min)
Ver **§9**.

### PASO 30 — Montaje de las brochas (15 min)
Ver **§10** completo (portabrocha, cabezales A/B, línea de asiento).

### PASO 31 — Puesta en marcha con báscula (60 min)
Ver **§11** completo. No duermas al lado de la máquina hasta terminar los 9 pasos de §11.5.

### PASO 32 — Tres ciclos de validación contra almohada lastrada
Obligatorio antes del primer uso real. En cada uno de los tres ciclos de 15 min, provoca deliberadamente: **(a)** tirón del USB a mitad de pasada, **(b)** pulsación del paro de emergencia a mitad de pasada, **(c)** firmware colgado (bucle infinito en una compilación de prueba). En los tres, la brocha **tiene que abandonar la piel**. 10 de 10 o no duermes con ella.

---

## 6. ALINEACIÓN CRÍTICA: EL EJE DE LA BISAGRA TANGENCIAL

### 6.1 Por qué importa tanto (y por qué nadie lo había calculado)

La brocha arrastra. A 400 mN de normal y μ_piel ≈ 0,4, el arrastre tangencial es **F_d ≈ 160 mN**, y siempre está en el plano horizontal, alineado con la dirección de la pasada.

Si el eje de la bisagra estuviese **perfectamente tangencial** (perpendicular al radio y horizontal), ese arrastre sería paralelo al eje y no generaría ningún par de cabeceo. Cero efecto.

Si el eje está girado **e grados** fuera de tangencial, el arrastre tiene una componente **F_d · sen(e)** perpendicular al eje de la bisagra. Esa componente actúa sobre el mismo brazo de 240 mm que la fuerza de contacto, así que su efecto en la punta es **exactamente**:

```
        ΔN  =  F_arrastre · sen(e)  =  160 · sen(e)   [mN]
```

y —esto es lo grave— **cambia de signo cuando la pasada cambia de sentido**, porque el arrastre cambia de sentido. Como esta máquina alterna dirección en **cada** pasada, el resultado es que las pasadas pares y las impares se hacen con fuerzas distintas. El cerebro es muy bueno detectando alternancias regulares.

| e (°) | ΔN (mN) | Diferencia entre las dos direcciones | Deriva lateral en la prueba de §6.2 (100 mm) |
|---:|---:|---:|---:|
| 1 | ±2,8 | 0,57 g | 1,7 mm |
| 2 | ±5,6 | 1,14 g | 3,5 mm |
| **3** | **±8,4** | **1,71 g** | **5,2 mm** ← objetivo de montaje |
| 4 | ±11,2 | 2,28 g | 7,0 mm |
| **5** | **±13,9** | **2,84 g** | **8,7 mm** ← límite de rechazo |
| 7 | ±19,5 | 3,98 g | 12,3 mm |
| 10 | ±27,8 | 5,66 g | 17,6 mm |

> **CORRECCIÓN C5.** La spec pide simultáneamente "5° de tolerancia" y "estado estacionario 400 ±12 mN". No se puede tener las dos: 5° ya son ±13,9 mN por sí solos. **Objetivo de montaje: 3°.** Con 3° el presupuesto cierra exactamente:
> ±8,4 (bisagra) + 1,0 (par de arranque PTFE) + 2,0 (hilos del calefactor) ≈ **±11,4 mN**, dentro de ±12.

### 6.2 Verificación casera nº 1 — la prueba del lápiz (5 min, sin electrónica)

Se basa en que un cuerpo articulado sobre un eje se mueve **en un plano perpendicular a ese eje**. Si el eje está girado e grados en planta, la punta de la botavara, al subir y bajar, se desplaza lateralmente `h · tan(e)`.

```
  MONTAJE DE LA PRUEBA

              botavara
   O=======================================( )   <-- rotulador pegado
   ^bisagra                                 |        con cinta a la ferrula
                                            |
                                        ____|____
                                       |  hoja   |   hoja A4 sujeta a una
                                       |  A4     |   tabla, VERTICAL,
                                       |_________|   perpendicular al radio

   1. Sin brocha, sin lastre. Un rotulador fino pegado en x = 240.
   2. Hoja A4 vertical, tocando apenas la punta del rotulador.
   3. Sube la punta 50 mm y bájala 50 mm despacio, DOS veces.
   4. El rotulador dibuja una línea de 100 mm de alto.
   5. Mide su DESVIACIÓN LATERAL total con el calibre.
```

| Deriva lateral en 100 mm | e | Veredicto |
|---:|---:|---|
| ≤ 3,5 mm | ≤ 2° | excelente |
| ≤ 5,2 mm | ≤ 3° | **aceptado** |
| ≤ 8,7 mm | ≤ 5° | límite; corrige si puedes |
| > 8,7 mm | > 5° | **RECHAZADO — desmonta y repite el paso 19** |

**Corrección:** afloja los dos M3 que fijan las mejillas K2 al carro K1 y mete una tira de papel (0,1 mm) o de aluminio de lata (0,1 mm) bajo **un** tornillo. Las mejillas están separadas ~35 mm, así que 0,1 mm de calzo giran el eje 0,16°. Para corregir 2° necesitas ~1,2 mm de calzo — mejor volver a taladrar K3.

### 6.3 Verificación casera nº 2 — la prueba de inversión con báscula (10 min, con la máquina viva)

Es la prueba **funcional definitiva**, porque mide exactamente el efecto que nos importa.

1. Báscula de cocina sobre un montón de libros, plato a la altura del plano de trabajo (z ≈ 150 mm).
2. Máquina colocada de modo que la brocha pase **por el centro del plato** en φ = 0.
3. Modo de prueba del firmware: pasada continua a **3 cm/s**, sin despegue (topes desactivados o riel bajado).
4. Anota la lectura media con la brocha moviéndose **hacia +φ** durante 5 s. Repite **hacia −φ**.
5. **La diferencia entre las dos lecturas no debe superar 2 g** (≈ 3,5°).

Con báscula de 1 g de resolución distingues hasta ~3°. Con una de 0,1 g (joyería, 12 EUR) llegas a 0,5°, y merece la pena si vas a construir esto de verdad.

### 6.4 El otro error de la bisagra: que no esté horizontal

Un eje tangencial pero **inclinado** (roll) no cambia la fuerza normal —el coseno del cabeceo se cancela igual—, pero hace que la brocha se **incline lateralmente** y apoye más de un lado. Se detecta a ojo: pon la brocha sobre una hoja de papel con un poco de polvo de talco y mira la huella. Debe ser un óvalo simétrico de **52 × 20 mm**. Si es una media luna, nivela el carro con calzos bajo Y3/Y4.

---

## 7. EL CABRESTANTE DE DYNEEMA

### 7.1 Por qué un cabrestante y no una polea dentada

Un tendón enrollado sobre un vástago liso **no tiene frecuencia de engrane**. No hay dientes, no hay paso, no hay ruido tonal, y el juego es exactamente cero mientras el cable esté tenso — y lo está siempre, porque el contrapeso lo pretensa con **4,12 N** de forma permanente (247 mN·m / 60 mm). Ésa es la razón de que no haga falta el par de tendones opuestos que usaban las arquitecturas anteriores: **el contrapeso es el segundo tendón**.

### 7.2 Números

| Magnitud | Valor |
|---|---|
| Cabrestante | vástago liso M8 (Ø8,00) en 2 × 623ZZ |
| Cuerda | Dyneema trenzada **0,40 mm**, ≥ 25 kg de rotura |
| Radio eficaz r_eff | 4,00 + 0,20 = **4,20 mm** |
| Sector | r = 60 mm, garganta de 4 mm entre discos E y B |
| Reducción | 60 / 4,2 = **14,29 : 1** |
| Recorrido del tendón en 86° | 60 × 1,5010 rad = **90,1 mm** |
| Vueltas del cabrestante en 86° | 90,1 / (2π × 4,2) = **3,41 vueltas** |
| Vueltas en reposo | **6** (varía de 2,6 a 9,4 según el ángulo) |
| Agarre por capstan con 2,6 vueltas (μ=0,25) | e^4,08 = **59×** |
| Tensión permanente | **4,12 N** |
| Margen a rotura | 235 N / 4,12 = **57×** |
| Longitud útil del cabrestante | **15 mm** (usa 3,8) |

### 7.3 Cómo enrollar las 6 vueltas

```
   VISTA DESDE ARRIBA

     TORRE DEL CABRESTANTE (r=100, phi=180)
            ___
           |o o|  623ZZ
           | | |
           | # |  <-- cabrestante Ø8, 6 vueltas de Dyneema
           |_|_|
             |
             |  tendón
             |
        .----+----.
      .'           '.
     |    SECTOR    |   r = 60
     |    r = 60    |
      '.           .'
        '---------'
             |
     ancla del tendón: taladro Ø1 en el disco A,
     nudo por dentro de la garganta + gota de cianoacrilato
```

**Procedimiento (25 min):**

1. **Taladra el ancla del cabrestante:** un Ø0,8 mm **transversal** en el vástago del M8, a 4 mm del extremo superior. Desbarba con lija de 400 (una rebaba corta la Dyneema).
2. **Taladra el ancla del sector:** un Ø1,0 mm radial en el disco A (Ø120), en el fondo de la garganta, en el punto que quedará *opuesto* al cabrestante cuando el yugo esté en φ = +43°.
3. **Coloca el yugo en φ = +43°** (contra el tope de aparcamiento) y **el cabrestante en su posición media** (haz una marca de rotulador en la cabeza del M8 y en la torre).
4. **Ancla en el cabrestante:** pasa la cuerda por el Ø0,8, haz un **nudo de ocho** doble por el lado ciego y aplasta con unas pinzas. Gota de cianoacrilato.
5. **Enrolla 6 vueltas** en el sentido correcto (el que, al girar el motor en sentido horario visto desde arriba, tira del sector hacia −φ). Las vueltas deben quedar **juntas pero sin montarse**, avanzando 0,4 mm por vuelta hacia arriba: es una **hélice de una sola capa**. Si las apilas, r_eff cambia y pierdes pasos.
6. **Pasa el tendón por el guiacabos:** un **623ZZ como polea de reenvío** atornillado a C3 a mitad de camino (r ≈ 78, φ = 180°), o simplemente un agujero de Ø1,5 mm en una pestaña de ply. Su función es fijar el punto de salida para que el ángulo de entrada al cabrestante no varíe cuando el sector gire 86°. **Sin guiacabos, el cable se monta.**
7. **Al sector:** mete el cabo por el Ø1,0 desde fuera, tira de él hasta dejar el tendón **tenso a mano** (unos 5 N, el yugo no debe moverse del tope), y ata **as de guía + tres cotes**. Corta a 15 mm y sella la punta con mechero (Dyneema funde a 145 °C; quema lo justo para formar una bolita).
8. **Gota de cianoacrilato** en el nudo del sector.

### 7.4 Tensado

**No se tensa el tendón.** Ésta es la ventaja de la arquitectura: cuando cuelgues el contrapeso (paso 24), él pone los 4,12 N permanentes. Lo único que tienes que garantizar es que **no quede flojo con el yugo en el tope de +43°**, porque ése es el punto de máxima longitud de tendón.

Prueba: con el contrapeso puesto y el motor sin corriente, empuja el yugo hacia −φ y suéltalo. Debe volver al tope de +43° **sin dar tirones ni chasquear**. Un chasquido = una vuelta montada sobre otra.

### 7.5 Cómo evitar que se monte (los cinco fallos reales)

| Fallo | Síntoma | Solución |
|---|---|---|
| Sin guiacabos | el ángulo de entrada varía 86° y el cable se apila | 623ZZ o agujero-guía a r≈78 (paso 6) |
| Cabrestante demasiado corto | las 6 vueltas + 3,41 de recorrido no caben en una capa | vástago liso de **≥ 15 mm** |
| Vueltas iniciales apretadas unas contra otras sin hélice | la primera vuelta trepa sobre la segunda | separa 0,4 mm por vuelta al montar; empuja con la uña |
| Cuerda sin encerar | se agarra a sí misma | pasa la Dyneema por **cera de vela** antes de enrollar |
| Rebaba en el taladro del ancla | rotura por fatiga a las 2–3 semanas | lija 400 + revisar a las 10 h de uso |

**Revisión mensual:** mira las vueltas del cabrestante con una linterna. Deben seguir en una sola capa. Si ves una montada, desenrolla y repite el paso 5; te llevará 10 minutos.

---

## 8. EL CONTRAPESO Y SU AMORTIGUADOR NEUMÁTICO

### 8.1 El contrapeso: qué es y qué hace

Un peso colgando de un cable es el **único** sistema de descarga de este campo que no tiene trinquete, ni uña, ni solenoide, ni supercondensador, ni lógica discreta, ni una sola línea de código. No se puede atascar, no pierde carga, no se descalibra y no lo puede anular el firmware. **Mantener la brocha sobre la piel exige que el motor tire activamente contra el peso.** Todo lo demás — botón de paro, temporizador, USB desenchufado, subtensión, MCU colgado, driver enclavado, fin del ciclo — es "soltar", y soltar significa que la brocha se va.

```
   RECORRIDO DEL CABLE DE RETORNO

        pila de discos
         (r = 70)
          .-----.
        .'  ###  '.          ### = garganta del contrapeso
       |     O     |
        '.  ###  .'
          '--|--'
             |  cable Dyneema 0,4 mm
             |
         (o) <-- polea de reenvío 623ZZ en la trasera de C3
             |
             |     TRASERA DE LA COLUMNA
             |
       ______|______
      |      |      |
      |   [PISTÓN]  |   espuma EVA 28,5 mm en tubo PVC Ø32 (int. 29)
      |      |      |
      |  [ CONTRA-  |
      |  [  PESO ]  |   barra de acero Ø25 (masa según tabla 8.4)
      |      |      |
      |______|______|
      |___ o ___|         <-- tapón inferior con ORIFICIO DE PURGA
                              (0,75 mm nominal)

   Recorrido del peso en los 86°:  70 mm x 1,5010 rad = 105,1 mm
```

**Montaje del cable (paso 24):**
1. Ancla en el disco D (Ø140), en la garganta de r=70: taladro radial Ø1,0, nudo de ocho, cianoacrilato.
2. Con el yugo en el tope de **−43°** (peso arriba del todo), enrolla el cable en la garganta en el sentido correcto — **el peso al caer tiene que llevar el yugo hacia +43°**. Comprueba esto con el dedo antes de cortar nada.
3. Polea de reenvío 623ZZ atornillada en la cara trasera de C3, tangente a la garganta.
4. Baja el cable por el eje del tubo, con una **arandela de fieltro** de guía en la boca del tubo.
5. Ata al pistón con un nudo de ocho por un Ø2 en el centro del disco de espuma, con arandela grande de reparto.

### 8.2 El amortiguador neumático — construcción

Sin amortiguador, el retroceso alcanza **~300 mm/s en la punta**: un latigazo sobre la piel, no una última pasada. El amortiguador de aire cuesta 2,50 EUR y hace absolutamente cero ruido.

```
  DESPIECE (de arriba abajo)

   +----------------------+  <-- boca abierta, arandela de fieltro para el cable
   |                      |
   |     (aire libre)     |
   |                      |      TUBO PVC EVACUACIÓN Ø32 ext / Ø29 int
   |======================|      largo 240 mm
   |   PISTÓN de espuma   |      EVA de célula cerrada, 12 mm de grueso,
   |   Ø28,5 x 12         |      cortado con sacabocados/vaso a Ø28,5
   |======================|      + arandela de ply Ø26 por cada cara, M4 central
   |                      |
   |   [ ] CONTRAPESO     |      barra de acero Ø25 x L (tabla 8.4),
   |   [ ] envuelto en    |      forrada con fieltro de 1 mm, colgada del
   |   [ ] fieltro 1 mm   |      pistón por un M4 x 60 y dos tuercas
   |                      |
   |     (aire            |      <-- CÁMARA COMPRIMIDA (105 mm de carrera)
   |      comprimido)     |
   |______________________|
   |    tope EPDM 6 mm    |      <-- amortigua el aterrizaje del peso
   |___________o__________|      <-- TAPÓN + ORIFICIO DE PURGA Ø 0,75
```

**Sentido de funcionamiento (importante y no obvio):**
- **Retroceso / fallo seguro:** el peso **baja**, el pistón comprime el aire de abajo, el aire escapa por el orificio. **Amortigua.** ✓
- **Marcha normal:** el motor sube el peso a **7 mm/s** (0,2333 × 30 mm/s de punta). A esa velocidad el orificio genera sólo **0,08 N** = 5,8 mN·m referidos al barrido, frente a los 247 del sesgo: **despreciable**. No hace falta válvula antirretorno. Ése es el motivo de que el amortiguador sea gratis en términos de par motor.

**Estanqueidad del pistón (lo que hace o rompe el invento):** la fuga por el borde del pistón tiene que ser **mucho menor** que el orificio. Espuma EVA de célula cerrada de 12 mm cortada a **Ø28,5 en un tubo de Ø29** = 0,25 mm de interferencia por lado. Engrasa levemente con **grasa de silicona** (no vaselina: se seca).

> **PRUEBA DE FUGA — obligatoria.** Tapa el orificio con un dedo o un trozo de cinta y suelta el peso desde arriba. Debe tardar **más de 30 s** en recorrer 100 mm. Si baja en 5 s, el pistón fuga y el orificio no controla nada: pon dos discos de espuma en serie separados 15 mm, o sube a Ø29,0 de pistón.

### 8.3 Calibración del orificio — la parte cuantitativa

**Ecuación de diseño** (orificio de canto vivo, C_d = 0,62, ρ_aire = 1,2 kg/m³):

```
      v_peso  =  C_d · A_o · sqrt(2·F / ρ)  /  A_tubo^1,5

      v_punta =  v_peso / 0,2333            (0,2333 = r_tambor/R = 70/300)

  con F = fuerza neta que el amortiguador debe absorber:
      F = (sesgo − detente reflejada − arrastre) / r_tambor
        = (247 − 114 − 48) mN·m / 0,070 m = 1,214 N   (caso nominal)
```

**Diámetro del orificio para 100 mm/s de punta**, según el tubo que consigas:

| Tubo | Ø interior (mm) | A_tubo (mm²) | A_orificio (mm²) | **Ø orificio (mm)** |
|---|---:|---:|---:|---:|
| PVC presión 20 | 17 | 227 | 0,090 | **0,34** |
| PVC presión 25 | 21 | 346 | 0,170 | **0,47** ← el "0,5 mm" de la spec |
| PVC evacuación 25 | 25 | 491 | 0,287 | **0,60** |
| **PVC evacuación 32** | **29** | **661** | **0,449** | **0,75** ← recomendado |
| PVC evacuación 40 | 36 | 1018 | 0,858 | **1,05** |

> **CORRECCIÓN C7.** El "tubo de 25 mm con orificio de 0,5 mm" de la spec es **numéricamente correcto** (yo obtengo 0,47 mm), pero **no cabe el peso**: 360 g de acero en un Ø int. de 21 mm son 146 mm de barra, y el tubo tendría que medir 286 mm — por encima del gálibo de 260 mm. Con **PVC de evacuación de 32 mm** el peso mide 86 mm, el tubo 240 mm, y el orificio pasa a **0,75 mm**.

**Sensibilidad (tubo Ø int. 29 mm):**

| Ø orificio (mm) | v_peso (mm/s) | **v_punta (mm/s)** | Veredicto |
|---:|---:|---:|---|
| 0,55 | 12,3 | 53 | demasiado lento, retroceso de 6 s |
| 0,60 | 14,7 | 63 | lento pero válido |
| 0,65 | 17,2 | 74 | |
| **0,70** | **20,0** | **86** | **en banda** |
| **0,75** | **23,0** | **98** | **óptimo** |
| **0,80** | **26,1** | **112** | **en banda** |
| 0,90 | 33,0 | 142 | fuera de banda |
| 1,00 | 40,8 | 175 | demasiado rápido |

**Procedimiento de calibración (20 min):**
1. Taladra el tapón inferior a **0,60 mm** (broca de PCB o una aguja de coser girada a mano). Empieza **pequeño**: agrandar es fácil, cerrar no.
2. Monta todo, brocha puesta, **apoyada sobre una almohada** con la máquina en φ = 0.
3. Corta la alimentación y **cronometra** hasta que el yugo llegue al tope de +43°.
4. Compara con la tabla de tiempos:

| φ de partida | Arco de punta hasta +43° | t a 86 mm/s | **t a 98 mm/s** | t a 112 mm/s |
|---:|---:|---:|---:|---:|
| −19° (extremo lejano) | 324,6 mm | 3,8 s | **3,3 s** | 2,9 s |
| −10° | 277,5 mm | 3,2 s | **2,8 s** | 2,5 s |
| 0° | 225,1 mm | 2,6 s | **2,3 s** | 2,0 s |
| +10° | 172,8 mm | 2,0 s | **1,8 s** | 1,5 s |
| +19° | 125,7 mm | 1,5 s | **1,3 s** | 1,1 s |
| +26° (ya sin contacto) | 89,0 mm | 1,0 s | **0,9 s** | 0,8 s |
| +34° (meseta) | 47,1 mm | 0,5 s | **0,5 s** | 0,4 s |

5. **Objetivo desde φ = 0: entre 2,0 y 2,6 s.** Si tardas más, agranda el orificio 0,05 mm y repite. Si tardas menos, tapa con una gota de cianoacrilato y vuelve a taladrar más fino.
6. **Criterio perceptivo, que manda sobre el cronómetro:** el retroceso debe leerse como **una última pasada firme**, no como un latigazo ni como un arrastre que no acaba nunca. Pruébalo sobre tu propio antebrazo despierto antes de darlo por bueno.
7. **Prueba de repetibilidad:** 10 cortes de corriente en 10 ángulos distintos. Los 10 tienen que llegar al tope. **10 de 10, o añades peso.**

### 8.4 Dimensionado del contrapeso a partir de la medición

**No copies los 360 g de la spec.** Los 360 g salen de suponer un detente de 8 mN·m, que **no aparece en ninguna hoja de datos**. Mide (§11.1) y usa esta tabla. La regla es **bias = 1,4 × resistencia máxima medida**, con la resistencia de trepada de riel (66 mN·m) ya incluida.

| Detente medido T_d (mN·m) | Reflejado ×14,29 | + trepada 66 | Sesgo necesario ×1,4 | **Masa (drum r=70) g** | I_RUN necesaria |
|---:|---:|---:|---:|---:|---|
| 4 | 57 | 123 | 172 | **251** | 0,33 A |
| 6 | 86 | 152 | 212 | **309** | 0,33 A |
| **8** | **114** | **180** | **252** | **368** | **0,33 A** |
| 10 | 143 | 209 | 292 | **426** | 0,40 A |
| 12 | 172 | 238 | 332 | **484** | 0,40 A |
| 14 | 200 | 266 | 373 | **542** | 0,40 A |
| 16 | 229 | 295 | 412 | **601** | 0,40 A + revisar margen |

**Longitud de la barra de acero Ø25 (7,85 g/cm³, 3,85 g/mm):**
251 g → 65 mm · 309 g → 80 mm · 368 g → 96 mm · 426 g → 111 mm · 484 g → 126 mm · 542 g → 141 mm.
Ajusta el último gramo con arandelas M8 apiladas sobre el tornillo del pistón.

**Si T_d > 16 mN·m:** tienes un motor distinto del previsto, o el tren tiene un rozamiento que no debería estar. Antes de poner 600 g, revisa: rodamientos de barrido precargados (paso 16), tendón montado sobre sí mismo (§7.5), patín arrastrando en la zona sin riel (baja el patín), cables sin bucle coaxial (paso 28).

### 8.5 Presupuesto del fallo seguro, recalculado

| Escenario | Resistencia (mN·m) | Sesgo (mN·m) | Margen |
|---|---:|---:|---:|
| Sobre piel, φ ∈ (−19, +19): detente 114 + arrastre 48 | 162 | 247 | **1,52×** |
| En el taper, φ ∈ (19, 26): detente 114 + trepada parcial 33 + arrastre 24 | 171 | 247 | **1,44×** |
| **Trepando el despegue, φ ∈ (26, 34): detente 114 + trepada 66** | **180** | **247** | **1,37×** ← caso limitante |
| En la meseta, φ ∈ (34, 43): detente 114 + rozamiento plano 32 | 146 | 247 | **1,69×** |

> **CORRECCIÓN C3.** El margen real de la geometría es **1,37×**, no 1,41×. La spec suponía 61 mN·m de trepada, que corresponde a una pendiente de riel de 10,3°; repartir los 4,42 mm de despegue en 8° obliga a 11,9° y da 66 mN·m. 1,37× sigue por encima del suelo de 1,3× que exige el análisis FMEA, pero **no hay margen para un detente mayor del medido**: por eso la tabla §8.4 es obligatoria y no orientativa.

---

## 9. SILENCIADO

**Techo:** 26 dBA continuos a 50 cm. **Criterio de aceptación real:** el **incremento ON/OFF medido en la almohada** por debajo de **3 dB** sobre el ruido de fondo de la habitación, incluyendo el movimiento del carro. Una lectura absoluta con el móvil no vale para nada; la diferencia sí.

### 9.1 Mapa de materiales, pieza por pieza

| Ubicación | Material | Cantidad | Por qué ahí |
|---|---|---|---|
| Bajo el motor NEMA11 | **EPDM 3 mm** + 4 tornillos y arandelas de **nylon M2,5** | 1 taco 30×30 | corta el único camino estructural motor→madera. Ni un tornillo metálico |
| Interior de la columna (4 caras + techo) | **fieltro 3 mm** autoadhesivo | 1 lámina A4 | mata el modo de caja de la columna; sin esto la columna amplifica el chopper |
| Bajo la huella de la columna | **corcho 6 mm** | 80×80 | desacopla columna↔base |
| Pies de la base | **corcho 6 mm** 25×25 | 4 | desacopla base↔mesilla |
| Cara inferior de la base | **corcho 2 mm** o EPDM, toda la superficie | 300×200 | **amortiguamiento por capa restringida**: sin esto un tablero de pino de 300×200×18 es un tambor |
| Trasera de la base | **lastre W1 400 g** atornillado | 1 | carga másica: baja el modo fundamental del tablero fuera de la banda audible, y además evita el vuelco |
| Superficie del riel | **fieltro 1 mm** + **PTFE seco** en spray | 2 rampas | PTFE sobre fieltro: μ_estático = μ_cinético → **no hay chirrido de stick-slip** |
| Patín | **PTFE macizo**, canto biselado | 1 disco | ídem |
| Bisagra de cabeceo | cojinete **PTFE**, seco (sin grasa) | 1 | grasa = pegajosidad = par de arranque variable |
| Casquillos del carro radial | **tubo PTFE 8/6** | 2 | los LM6UU con bolas hacen "grrr" a 2 mm/s |
| Tope de barrido ±43° | **EPDM 3 mm** pegado a la cara de choque | 2 | el único impacto duro de la máquina |
| Palanca del microrruptor | **EPDM 1 mm** sobre la leva | 1 | el "clic" del microrruptor es el evento más audible que queda |
| Tubo del amortiguador | **2 abrazaderas de ply forradas de EPDM** | 2 | el PVC suena como una campana si lo atornillas seco |
| Contrapeso de acero | envuelto en **fieltro 1 mm** | 1 | nunca toca el PVC directamente |
| Fondo del tubo amortiguador | **tope EPDM 6 mm** | 1 | aterrizaje del peso al final del retroceso |
| Tapa frontal de columna L1 | ply 4 mm forrado de fieltro, **2 palomillas de nylon con arandela EPDM** | 1 | tapa desacoplada, no atornillada a tope |
| Tapa del carro L2 | ply 4 mm forrado de fieltro | 1 | encierra el 28BYJ-48, que es el evento impulsivo del diseño |
| Manguera de 9 hilos | **abrazaderas P forradas de fieltro** | 4 | una brida apretada contra madera zumba |
| Ferrula de la brocha | **tubo de silicona** | 2 | y de paso es el cambio en 10 s |

### 9.2 Cómo evitar que la caja haga de caja de resonancia

Tres mecanismos, y hay que atacar los tres:

1. **Modo de placa de la base.** 18 mm de pino de 300×200 libre resuena en torno a 180–250 Hz con un Q alto. Se mata con **(a)** la capa de corcho/EPDM en toda la cara inferior (amortiguamiento por capa restringida), **(b)** los 400 g de W1 atornillados en el tercio trasero (carga másica), y **(c)** apoyar sobre 4 pies de corcho pequeños y no sobre toda la superficie.
2. **Modo de caja de la columna.** Un cajón cerrado de 44×62×152 mm tiene una resonancia de aire hacia 1,1 kHz y modos de panel más arriba. Se mata con el forro interior de fieltro de 3 mm y con **no cerrar la tapa a presión**: las dos palomillas de nylon con arandela de EPDM dejan la tapa "flotando".
3. **Acoplamiento a la mesilla.** Es el más grande de todos y el más fácil de estropear. **Atornillar la base a la mesilla añade 6–9 dB** — más que todas las decisiones de componente juntas. La máquina va **suelta sobre sus cuatro pies de corcho**. Si la mesilla resuena (típico en tableros huecos de melamina), pon una toalla doblada debajo: son 4 dB gratis.

### 9.3 Lo que ya es silencioso por construcción

- **Ni correa, ni engranajes, ni husillo en el camino de la fuerza.** El único husillo (T8) sólo se mueve 2,5 s cada varias pasadas, y va dentro de una tapa forrada.
- **Cabrestante de cuerda: no existe la frecuencia de engrane.** Velocidad superficial 1,1–3,9 mm/s.
- **5 V nativos:** sin convertidor elevador, sin trigger PD, así que no hay ningún regulador conmutado cuyo silbido se module con la carga del motor.
- **I_HOLD = 0** en todos los huecos: el contrapeso sostiene la botavara contra el tope, no el motor. Cero zumbido y cero calor en reposo.
- **Todas las inversiones ocurren a velocidad cero, en el aire, sobre fieltro**, con rampa en S sobre 3° de eje.

### 9.4 Los dos ruidos que quedan y qué hacer con ellos

1. **El 28BYJ-48 del carro radial.** Es el único evento impulsivo, ~64 por sesión. Mitigación de diseño: la orden de movimiento se **programa para solaparse con el último 20 % de la pasada anterior**, de modo que el roce de las fibras lo enmascara. Si aun así se oye en la almohada por encima de 3 dB, baja a **8 movimientos por sesión** y la banda barrida cae de 118 a ~90 mm. Es un intercambio explícito, no un fallo.
2. **El microrruptor de aparcamiento.** Un clic mecánico a 400 mm de la cabeza. Actúalo con **una leva de EPDM y sobrerrecorrido corto**, y colócalo mirando hacia abajo, hacia la base.

### 9.5 Protocolo de medición (15 min)

1. Móvil con una app de SPL, **en la almohada**, en el sitio donde estará tu oreja.
2. 60 s con la habitación en silencio y la máquina desenchufada → **L_fondo**.
3. 60 s con la máquina funcionando a 3 cm/s, incluyendo al menos dos movimientos del carro → **L_on**.
4. **L_on − L_fondo < 3 dB.** Si no, ataca en este orden: (1) toalla bajo la base, (2) revisar que ninguna tapa esté apretada, (3) más fieltro en la columna, (4) reducir movimientos del carro, (5) bajar I_RUN.
5. Repite con la máquina sobre la mesilla real, no sobre la mesa del taller. La mesilla es parte del instrumento.

---

## 10. MONTAJE DE LA BROCHA

### 10.1 El portabrocha de 10 segundos

```
        botavara: GRP Ø2 macizo (el fusible)
   ==========================
                       |
                  [ casquillo de nylon Ø2 int / Ø6 ext, 12 mm, epoxi ]
                       |
             ,---------+---------,
            |  TUBO DE SILICONA  |   Ø6 int / Ø10 ext, 30 mm
            |                    |
            '---------+---------'
                      |
                 [ mango recortado de la brocha, Ø8, 20 mm ]
                      |
                  ((BRIDA de nylon 2,5 mm))   <-- 1 sola, apretada a mano
                      |
                 [ FERRULA ]  <- resistencia 120 Ω + NTC 10 k dentro
                      |
                 ||||||||||||   pelo de cabra, 30 mm libres
                 <-- 52 mm -->  ancho cargado
```

**Preparación de cada cabezal (15 min):**
1. Sierra el mango de la kabuki dejando **20 mm** de espiga por detrás de la ferrula. Lija a Ø8 mm si hace falta.
2. Mete la resistencia de **120 Ω / 0,25 W** y el **NTC de 10 k** por detrás, dentro de la ferrula, a **30 mm de las puntas del pelo**. Fíjalos con una gota de silicona neutra. Ni metal, ni corriente, ni conductor a menos de 30 mm de la piel.
3. Suelda los cuatro hilos de 30 AWG y sella con termorretráctil.
4. **Pesa el cabezal completo. Anota el peso.** Nominal 18 g.
5. Marca **A** o **B** con rotulador en la espiga.

**Cambio de cabezal (10 s):** corta la brida, saca la espiga del tubo de silicona, mete la otra, brida nueva. Los conectores del calefactor son dos **pines Dupont de 2 vías**.

### 10.2 Los dos cabezales de recorte desigual

Es irregularidad mecánica gratis, sin firmware y sin piezas móviles.

| | **Cabezal A** | **Cabezal B** |
|---|---|---|
| Recorte | tal como viene, plano | **domo suave**: recorta 3 mm en el borde y deja el centro, con tijeras de peluquería |
| Largo libre de pelo | 30 mm | **27 mm** |
| Ancho cargado | 52 mm | ~48 mm |
| k_brush esperado | ~58 N/m | **~70 N/m** (más corto = más rígido) |
| Sensación | lavado ancho | línea más definida |
| Uso | sesiones impares | sesiones pares |

> **Cada cabezal tiene su propia posición de lastre y su propia altura de taper.** Mide `k_brush` de **los dos** (§11.2). Si difieren mucho, corta el taper para el **más blando** (h_t mayor) y acepta que con el más rígido la descarga termina un poco antes: eso da una pasada ligeramente más corta, que es el error benigno.
> Marca en la escala de la botavara **dos posiciones del lastre**, "A" y "B", para que la báscula siga marcando 41 g con cualquiera de los dos.

### 10.3 La posición axial de la brocha importa

Con la cabeza a **240 mm** y 18 g de masa, un error de asiento de 5 mm cambia la fuerza en **3,7 mN**. Marca en el GRP una **línea de asiento** y comprueba que la cara trasera de la ferrula la toca cada vez que cambies de cabezal.

### 10.4 Mantenimiento — no es opcional

El fallo más insidioso del diseño: el pelo se apelmaza con la grasa de la piel, `k_tip = 0` mantiene la fuerza en 400 mN mientras la **huella se encoge**, y el percepto deriva a lo largo de semanas de caricia ancha a cosquilleo puntual. El usuario lo nota como "la máquina va peor", no como "hay que lavar la brocha".

- **Semanal:** lavado con champú suave a **40 °C**, aclarado, secado colgando boca abajo 12 h. Nunca a 60 °C (el pelo de cabra se estropea; los 60 °C del FMEA aplican a fibras sintéticas).
- **Autocomprobación mensual (2 min):** apoya la brocha en la báscula hasta **41 g** y mide la compresión. Debe seguir entre **6 y 12 mm**. Si baja de 6 mm, el pelo se ha apelmazado o se ha caído: cambia de cabezal y lava el otro.
- **Sustitución:** cada 6–12 meses o cuando la compresión a 41 g no vuelva a su valor tras un lavado.

---

## 11. PUESTA EN MARCHA CON BÁSCULA DE COCINA

Todo lo que sigue se hace con una **báscula de cocina de 1 g** (mejor 0,1 g), una regla y un rotulador. No hay ningún sensor de fuerza en la máquina, y no lo va a haber: la fuerza es geometría, y la geometría se verifica con una báscula.

**Equivalencias que vas a usar todo el rato:** `400 mN = 40,8 gf ≈ 41 g` · `±25 mN = ±2,5 g` · `±12 mN = ±1,2 g`.

### 11.1 · PASO 3 — Medir la resistencia del tren de barrido (45 min) 🔒 BLOQUEANTE

Lo que necesitas conocer no es el detente del motor aislado: es la **resistencia total referida al eje de barrido**, que es lo que el contrapeso tiene que vencer. Se mide directamente, y sale mejor así.

**Requisitos previos:** yugo montado (paso 16), pila de discos, cabrestante y tendón montados (paso 23), motor conectado al TMC2209 pero **con la alimentación de potencia cortada** (bobinas en circuito abierto o en cortocircuito según cómo quede tu driver sin VM; anota cuál, porque un stepper con las bobinas cortocircuitadas frena mucho más).

```
   MONTAJE DE LA MEDICIÓN

     pila de discos (garganta r = 70)
          .-----.
        .'  ###  '.
       |     O     |------- botavara --------( brocha, SIN lastre )
        '.  ###  .'
          '--|--'
             | hilo
             |
            (o) polea 623ZZ
             |
            [ ] taza de plástico
             |
             +--- vas echando monedas de 1 y 2 céntimos (2,30 y 3,06 g)
```

**Procedimiento:**
1. Coloca el yugo en **φ = −43°** (el extremo opuesto al aparcamiento) y suéltalo. No debe moverse.
2. Añade monedas a la taza **de una en una**, esperando 3 s entre cada una.
3. Anota la masa total **m** en el instante en que el yugo empieza a moverse solo. Vacía y repite.
4. Repite en **10 ángulos**: −43, −34, −26, −19, −10, 0, +10, +19, +26, +34. Anota los 10.
5. Repite todo **con la brocha apoyada en una almohada a 400 mN** para los ángulos entre −19 y +19 (añade el arrastre real).

**Cálculo:**
```
   T_resist [mN·m]  =  m [g] × 9,81 × 0,070 / 1000 × 1000  =  m × 0,687

   Ejemplo: si la peor lectura son 250 g  ->  T_resist = 172 mN·m
            Sesgo necesario = 1,4 × 172 = 241 mN·m
            Masa del contrapeso = 241 / (9,81 × 0,070) = 351 g
```

**Atajo:** la masa del contrapeso es simplemente **1,4 × la peor masa medida en la taza**, porque la taza cuelga del mismo radio de 70 mm. 250 g medidos → **350 g de contrapeso**. Así de directo.

**Descomposición diagnóstica (opcional pero útil):**
- Resistencia medida **en la meseta (φ=+34)** ≈ detente reflejada + rozamiento plano.
- Resistencia medida **en el despegue (φ=+30)** ≈ lo anterior + trepada de riel.
- La diferencia entre las dos te da tu trepada real; compárala con los 66 mN·m calculados.
- Divide la resistencia de la meseta entre 14,29 para estimar el **detente del motor** y contrástalo con la tabla §8.4.

**Bandera roja:** si la lectura varía más de un 40 % entre ángulos, hay algo mecánicamente mal (tendón montado, patín arrastrando, rodamiento precargado). Arréglalo antes de comprar hierro.

### 11.2 · PASO 13 — Medir k_brush (20 min) 🔒 BLOQUEANTE

```
   MONTAJE

      |  brocha sujeta en la mano o en un sargento,
      |  con la ferrula VERTICAL
      v
    |||||||   pelo
   ___________
  |  BÁSCULA  |  sobre la mesa, tarada a 0
  |___________|

   Regla de acero apoyada en la mesa junto a la ferrula,
   con un rotulador para marcar la altura de la cara de la ferrula.
```

1. Tara la báscula.
2. Baja la brocha hasta que la báscula marque **1 g**. Ése es el **contacto cero**. Marca la altura de la cara trasera de la ferrula contra la regla → **z₀**.
3. Sigue bajando hasta **41 g** (= 400 mN). Marca de nuevo → **z₁**.
4. **c = z₀ − z₁**, la compresión del pelo a 400 mN, en mm.
5. Resultados:
```
        k_brush [N/m]  =  400 / c          (con c en mm)
        h_t     [mm]   =  c / 2,67          <-- LA ALTURA DEL TAPER
```
6. Repite **3 veces** y promedia. Repite para el cabezal B.

**Valores esperados:** c entre 5 y 11 mm para una kabuki de Ø60 de pelo de cabra con 30 mm libres. Si sale c < 4 mm la brocha es demasiado dura para este proyecto (busca otra); si sale c > 14 mm, el pelo se dobla en vez de comprimirse y el ancho cargado no será 52 mm — mira la huella con talco.

**Tabla rápida:**

| c medido (mm) | 5 | 6 | 7 | 8 | 9 | 10 | 11 |
|---|---:|---:|---:|---:|---:|---:|---:|
| k_brush (N/m) | 80 | 67 | 57 | 50 | 44 | 40 | 36 |
| **h_t (mm)** | **1,87** | **2,25** | **2,62** | **3,00** | **3,37** | **3,75** | **4,12** |
| h meseta (mm) | 6,29 | 6,67 | 7,04 | 7,42 | 7,79 | 8,17 | 8,54 |

### 11.3 Ajustar el lastre a 400 mN (15 min)

1. Báscula sobre una pila de libros de forma que **el plato quede a z = 150 mm** sobre la base de la máquina (usa el calibre o una regla).
2. Máquina colocada de modo que la brocha caiga en el centro del plato con el yugo en **φ = 0**.
3. Patín **retirado del riel** (baja el tornillo M4 o quita las rampas): en φ=0 no debe haber riel, pero comprueba que efectivamente el patín está en el aire.
4. Cabezal montado, hilos del calefactor colocados **en bucle coaxial**, todo como en funcionamiento normal.
5. Afloja el prisionero de nylon y **desliza el lastre por la varilla de Ø3** hasta que la báscula marque **41 g**.
6. Aprieta el prisionero. Marca la posición en la escala.

**Tabla de referencia (lastre de 40,0 g, momento estático 4785 g·mm, L = 240 mm):**

| x (mm) | 40 | 60 | 80 | 100 | 110 | 120 | **125** | 130 | 140 | 160 | 180 | 200 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| gf | 26,6 | 29,9 | 33,3 | 36,6 | 38,3 | 39,9 | **40,8** | 41,6 | 43,3 | 46,6 | 49,9 | 53,3 |
| **mN** | **261** | **294** | **326** | **359** | **375** | **392** | **400** | **408** | **424** | **457** | **490** | **523** |

Sensibilidad: **1,635 mN por mm** de desplazamiento del lastre. Un milímetro de error son 1,6 mN: irrelevante. Diez milímetros son 16 mN: ya se sale de la tolerancia estacionaria.

> Si tu momento estático real no es 4785 g·mm (porque tu botavara pesa distinto), **no importa**: la báscula es la referencia, no la tabla. La tabla sólo te dice hacia dónde mover y cuánto.

### 11.4 Verificación en cinco puntos del arco (20 min) — tolerancia ±25 mN

Éste es el **criterio de aceptación** de la spec: `400 ± 25 mN` en cinco puntos del arco = **38,3 a 43,3 g**.

| Punto | φ | Cómo llegar | Lectura admisible | La tuya |
|---|---:|---|---|---|
| 1 | **−19°** | báscula desplazada al extremo del arco | 38,3–43,3 g | ____ |
| 2 | **−10°** | | 38,3–43,3 g | ____ |
| 3 | **0°** | (aquí ajustaste el lastre: debe dar 41) | 39,5–42,0 g | ____ |
| 4 | **+10°** | | 38,3–43,3 g | ____ |
| 5 | **+19°** | justo antes de que el patín toque el riel | 38,3–43,3 g | ____ |

**Cómo desplazar el punto de medida:** lo más cómodo es **girar la máquina** (no la báscula) sobre la mesa, dejando el plato quieto, para que la brocha caiga en el plato con el yugo en el ángulo que quieres. Bloquea el yugo con un calzo de espuma.

**Qué significa cada tipo de desviación:**

| Patrón | Causa | Arreglo |
|---|---|---|
| Todas altas o todas bajas por igual | lastre mal puesto | recolocar el lastre (§11.3) |
| Simétrico, cae en los extremos ±19 | el patín ya está tocando el riel antes de tiempo | **baja el patín** (§5 paso 21) o baja las rampas |
| Asimétrico: +19 alto y −19 bajo | **la máquina no está nivelada** | nivela con calzos bajo la base |
| Varía al azar ±5 g | el plato de la báscula no está a la altura correcta, o hay un cable tirando | revisa el bucle coaxial de los hilos del calefactor |
| Diferencia grande entre las dos direcciones de pasada | **eje de la bisagra fuera de tangencial** | §6 |

### 11.5 Lista completa de puesta en marcha (haz las nueve)

| # | Prueba | Criterio | ✔ |
|---|---|---|---|
| 1 | Resistencia del tren (§11.1) | 10 ángulos, dispersión < 40 % | ☐ |
| 2 | k_brush (§11.2) | c entre 5 y 11 mm, 3 medidas coherentes | ☐ |
| 3 | Fuerza en φ=0 (§11.3) | 41 g | ☐ |
| 4 | Cinco puntos del arco (§11.4) | 38,3–43,3 g en los cinco | ☐ |
| 5 | Inversión de sentido (§6.3) | diferencia ≤ 2 g | ☐ |
| 6 | Aire en la meseta | ≥ 10 mm de hueco visible entre pelo y plato, a ojo y con una galga de 10 mm | ☐ |
| 7 | Retroceso del fallo seguro (§8.3) | llega al tope 10 de 10, 2,0–2,6 s desde φ=0 | ☐ |
| 8 | Fuga del pistón (§8.2) | con el orificio tapado, > 30 s para 100 mm | ☐ |
| 9 | Ruido en la almohada (§9.5) | ON − OFF < 3 dB | ☐ |

Y sólo después, **paso 32**: tres ciclos completos de 15 min contra almohada lastrada, con tirón de USB, paro de emergencia y firmware colgado provocados a propósito.

---

## 12. TABLA DE REPOSICIONAMIENTO Y TARJETA DE COLOCACIÓN

### 12.1 La tarjeta de colocación de 273 mm

El arco de contacto **total** son **273 mm** (37 de taper + 199 a fuerza plena + 37 de taper). La spec es explícita: si sólo colocas los 199 mm sobre el miembro, la brocha llega al borde del brazo **ya a 400 mN**, que es exactamente el ataque abrupto que dispara la knismesis. **La tarjeta marca los 273, no los 199.**

```
  TARJETA DE COLOCACIÓN — imprimir a escala 1:1 sobre cartulina, 273 x 130 mm

  +--------------------------------------------------------------------------+
  |<-37->|<---------------------- 199 mm ----------------------->|<-37->|     |
  |TAPER |                 FUERZA PLENA 400 mN                   |TAPER |     |
  |......|=======================================================|......|     |
  |  ,---'                                                        '---,       |
  |,'         curva del arco: flecha (sagita) 16,3 mm                  ',     |  130
  |                                                                          |
  | - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -  |  banda
  |          banda radial del carro: +/- 25 mm  ->  118 mm en total          |  barrida
  | - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -  |
  |                                                                          |
  |    (X) marca de 12 deg de oblicuidad      [O] <- eje de barrido a 300 mm  |
  +--------------------------------------------------------------------------+

  Marcas obligatorias en la tarjeta:
   - los dos extremos del arco de 273 mm, con ticks gruesos
   - los dos codos de 199 mm, con ticks finos
   - la línea de sagita de 16,3 mm
   - los bordes de la banda de 118 mm
   - una flecha a 12 grados: es la oblicuidad con la que hay que colocar
     la base respecto al eje del miembro
   - un punto [O] a 300 mm del centro del arco, sobre la perpendicular:
     ahí va el EJE DE BARRIDO, no la esquina de la base
```

**Uso (30 s, despierto):**
1. Pon la tarjeta sobre el miembro desnudo, con el arco siguiendo el eje del miembro y la marca de 12° apuntando como en el dibujo.
2. Si el arco de **273 mm** se sale por los dos extremos, el sitio es demasiado corto: usa la tabla §12.2 para elegir otro, o corre la tarjeta de modo que **sólo el taper del lado del codo/rodilla se salga**. Nunca dejes que se salga el taper de los dos lados.
3. Marca en la sábana dónde cae el punto [O] y coloca ahí el eje de barrido de la máquina.
4. Retira la tarjeta, coloca la brocha en contacto y arranca el precalentamiento de 60 s.

### 12.2 Tabla de reposicionamiento

Alturas de "plano de piel" medidas desde la **cara superior de la base** de la máquina. La máquina se apoya sobre una mesilla o silla; la **altura gruesa** se ajusta con libros o un tablero bajo la base, y la **fina** con el tornillo del patín (§5 paso 21).

| Sitio | Postura | Dónde va la máquina | Altura del plano de piel sobre la base | Ajuste grueso | Vueltas del patín desde 0 | R del carro (centro) | Lastre | Arco útil |
|---|---|---|---|---|---|---|---|---|
| **Antebrazo dorsal/lateral** (sitio primario) | supino, brazo al costado, palma abajo | mesilla, al lado de la almohada, arco cruzando el antebrazo a 12° | 150 mm | ninguno | 0 | **300 mm** (banda 275–325) | 125 mm | 273 mm cabe justo en un antebrazo adulto largo; si no, deja salir el taper por el codo |
| **Brazo superior dorsal** | supino o de lado, brazo relajado | mesilla, arco cruzando el tríceps | 165 mm | tablero de 15 mm bajo la base | +2 (−1,4 mm) | 300 mm | 125 mm | 200–240 mm útiles; reduce el arco de contacto en firmware si sobra |
| **Muslo externo** | de lado, pierna arriba estirada | silla a la altura de la cadera, en el borde de la cama | 190 mm | tablero de 40 mm | +6 (−4,2 mm) | **310 mm** | 128 mm (+5 mN, compensa) | 273 mm entran de sobra: es el mejor sitio para el arco completo |
| **Espinilla / gemelo lateral** | de lado o supino | silla a los pies de la cama | 175 mm | tablero de 25 mm | +4 | 300 mm | 125 mm | 250 mm; deja salir un taper por el tobillo |
| **Espalda alta / hombro** | **de lado**, cerca del borde del colchón | mesilla, arco cruzando el trapecio y el deltoides | 200 mm | tablero de 50 mm | +8 | **325 mm** (carro al máximo) | 132 mm | 273 mm; **la espalda media en supino queda fuera de alcance y no lo disimulo** |
| **Torso lateral (flanco bajo)** | de lado | mesilla a la altura del pecho | 185 mm | tablero de 35 mm | +5 | 290 mm | 122 mm | ⚠ ver aviso abajo |

**Notas y avisos por sitio:**

- **Antebrazo** es el sitio de referencia: máxima densidad de aferentes CT, bajo en el mapa universal de cosquillas, y el arco de 273 mm cabe casi exacto. Empieza aquí.
- **Muslo externo** es el sitio donde el arco completo entra con holgura. Si vas a hacer una única sesión larga, es el mejor compromiso.
- **Torso lateral:** el hueco de despegue son **11,8 mm**, y la excursión respiratoria del tórax son **5–10 mm**. En el flanco bajo y el abdomen lateral el margen se come casi entero, así que los "huecos" pueden no ser contacto cero de verdad. **Mide antes** (mira si el pelo roza durante la meseta) o restringe el uso del torso al abdomen lateral. **Nunca** costillas, axila, cintura ni abdomen central: son los sitios universalmente más cosquillosos.
- **Prohibido siempre:** axilas, plantas de los pies, cuello, cara, cara interna del muslo, hueco poplíteo, abdomen central. Y nada por encima del plano del esternón, en ninguna postura.

### 12.3 Índice radial entre sitios y entre noches

El carro radial da ±25 mm **dentro** de la sesión (regla dura: cada pasada difiere ≥ 6 mm de las dos anteriores). Entre **noches**, cambia además:
- el **cabezal** (A ↔ B),
- el **centro del carro** (275 / 300 / 325 mm), lo que traslada toda la banda 50 mm,
- el **sitio** según la tabla.

Con eso la banda de piel trabajada pasa de 118 mm en una sesión a **~170 mm a lo largo de cuatro noches**, que es lo que el análisis de desgaste del estrato córneo pide.

### 12.4 Ritual de colocación (2 min, despierto)

1. Elige sitio y pon la máquina donde dice la tabla; **nunca sobre el colchón**.
2. Tarjeta de 273 mm sobre la piel desnuda; marca el punto [O]; retira la tarjeta.
3. Ajusta el tornillo del patín según la tabla y comprueba a ojo: con el yugo en la meseta, hueco de un dedo (~12 mm) entre pelo y piel.
4. Coloca la brocha **en contacto** con la piel en φ = 0.
5. Arranca el **precalentamiento de 60 s** con la brocha ya apoyada. La primera sensación de la noche es contacto templado, establecido y esperado.
6. Pulsa START (mantener 300 ms).

---

## ANEXO A — TABLA MAESTRA DE TALADROS

| Pieza | Ø | Cant. | Tolerancia | Cómo |
|---|---:|---:|---|---|
| C3 + C4 (eje de barrido) | 8,5 | 1+1 | holgado | **apiladas y a la vez** |
| Y1 (rodamiento #1) | **22** | 1 | **H8, ajuste de dedo** | Forster 22 en taladro de columna |
| Disco E (rodamiento #2) | **22** | 1 | **H8** | ídem, misma sesión |
| Discos F, D, A, B | 24 | 4 | holgado | broca de pala |
| Y3 + Y4 (varillas del carro) | 6 | 2+2 | H8 | **apiladas y a la vez** |
| K1 (casquillos PTFE) | 8 | 2 | ligero | separación 40,0 ±0,2 |
| K1 (tuerca T8) | 8,2 | 1 | holgado | |
| K2 × 2 (eje de bisagra) | 3,2 | 1 | H8 | **apiladas y a la vez** |
| K3 longitudinal (botavara) | 4,1 | 1 | ajuste + epoxi | |
| K3 transversal (cojinete) | 6 | 1 | H8, **perpendicular al anterior ±1°** | operación más crítica del proyecto |
| T1 × 2 (cabrestante) | 8,2 | 1 | H8 | **apiladas y a la vez** |
| Cabrestante M8 (ancla) | 0,8 | 1 | desbarbar | broca de PCB |
| Disco A (ancla del tendón) | 1,0 | 1 | desbarbar | |
| Disco D (ancla del cable) | 1,0 | 1 | desbarbar | |
| Tapón del amortiguador | **0,60 → ajustar** | 1 | ver §8.3 | broca de PCB o aguja |
| C3 (topes ±43°) | 4 | 2 | **ciegos, 10 mm** | |
| Abrazadera del patín (rosca) | M4 | 1 | | macho de roscar o tuerca embutida |
| Botavara (salida de hilos) | 2,0 | 1 | x = 230 | lima, no broca (el carbono astilla) |

**Regla general del proyecto:** *cualquier par de agujeros que deban ser coaxiales o paralelos se taladra con las dos piezas apiladas y pegadas con cinta de doble cara.* Eso sustituye a un taladro de columna caro en todas las operaciones menos una (K3).

---

## ANEXO B — CAMINO DE CORTE LÁSER (DXF)

Si prefieres encargar el corte, éstas son las piezas que merece la pena externalizar y las que no.

**Encargar (ply 4 mm, un solo panel de 300 × 400 mm):**

| DXF | Pieza | Geometría |
|---|---|---|
| `01_disco_F.dxf` | D-F | círculo Ø148, taladro Ø24 concéntrico |
| `02_disco_D.dxf` | D-D | círculo Ø140, taladro Ø24 |
| `03_disco_E.dxf` | D-E | círculo Ø148, taladro **Ø21,90** (kerf: pide Ø22 acabado) |
| `04_disco_A.dxf` | D-A | círculo Ø120, taladro Ø24 |
| `05_disco_B.dxf` | D-B | círculo Ø128, taladro Ø24 |
| `06_yugo_Y1.dxf` | Y1 | rectángulo 200×80, taladro **Ø21,90** con centro a (40, 40) |
| `07_testeras.dxf` | Y3, Y4 | 2 × rectángulo 70×30, 2 taladros Ø5,90 separados 40,0, centrados |
| `08_carro_K1.dxf` | K1 | 2 × rectángulo 60×55, 2×Ø7,90 sep. 40,0 + 1×Ø8,2 central |
| `09_mejillas_K2.dxf` | K2 | 2 × 45×40 con Ø3,10 a (10, 20) |
| `10_base_rampa_R3.dxf` | R3 | 2 × sector anular r=118→182, arco 30° centrado, más 4 taladros Ø3,5 |
| `11_costilla_R1.dxf` | R1 | 2 × perfil, **generar con la tabla §4.4 usando TU h_t** |
| `12_costilla_R2.dxf` | R2 | 2 × perfil, ídem con la columna x175 |
| `13_torre_T1.dxf` | T1, T2 | 2 × 75×40 con Ø7,90 a 63 mm de la base + 1 × 40×30 |

**Cómo generar los DXF de las costillas sin CAD:** las columnas `x125`/`x175` y `h` de §4.3–4.4 son literalmente una polilínea. En cualquier editor (LibreCAD, Inkscape, incluso una hoja de cálculo exportada a CSV y convertida) introduce los pares (x, h+20) de φ=8 a φ=46 en pasos de 1°, cierra el contorno por la línea base y por los dos extremos verticales. **No suavices con splines**: la interpolación de la tabla ya es suave.

**Importante:** dale al servicio láser el **kerf**. Un láser de CO₂ en ply de 4 mm quita 0,15–0,25 mm. Los agujeros de Ø22 hay que dibujarlos a **Ø21,80–21,90** para que salgan a 22,0.

**No externalizar:** las piezas de pino de 18 mm (te las corta la tienda gratis), el forro de 0,8 mm (se recorta al montar), y **el patín, el bloque de bisagra K3 y la botavara** (son ajustes, no cortes).

**Coste:** un panel de 300 × 400 en ply de 4 mm cortado en un servicio español, 18–28 EUR + 5–8 de envío, 3–7 días laborables.

---

## ANEXO C — PARES DE APRIETE Y ADHESIVOS

| Unión | Apriete / adhesivo |
|---|---|
| Tuerca inferior del perno M8 de barrido | **a mano con llave corta, hasta que la pila deje de moverse y ni una vuelta más.** Si los rodamientos chirrían al girar, has apretado de más |
| Perno M3 de la bisagra | apretar hasta que el casquillo de latón esté firme entre mejillas; K3 debe girar con el peso de un dedo |
| Tornillos M2,5 de nylon del NEMA11 | firme a dedo + 1/4 de vuelta con destornillador. Se rompen fácil |
| Tornillos de madera 3,5 mm | pretaladrar siempre Ø2,5 en pino y Ø2,0 en ply |
| Discos de la pila | **cola blanca D3**, prensados con varilla M8 + arandelas, 4 h |
| Costillas a base de rampa | cola blanca D3, escuadra, 2 h |
| Forro 0,8 mm a costillas | cola blanca D3 fina, pinzas de la ropa, 4 h |
| Botavara carbono ↔ GRP | **epoxi 5 min**, 15 mm de solape, lijar ambas superficies antes |
| Botavara ↔ bloque K3 | **epoxi 5 min**; alinear x=0 con el eje del M3 antes de que cure |
| Varilla del lastre a montantes | epoxi 5 min |
| Casquillo PTFE en K3, casquillos PTFE en K1 | **cianoacrilato**, poca cantidad, no en la superficie de deslizamiento |
| Nudos de Dyneema | **cianoacrilato** una gota después de tensar |
| Fieltro, EPDM, corcho | autoadhesivos; si no agarran, **contacto de neopreno** |
| Resistencia y NTC en la ferrula | **silicona neutra** (la acética corroe) |

---

## ANEXO D — CONTRADICCIONES ENCONTRADAS EN `final_spec.md`, EN DETALLE

**D1 · La rampa de aparcamiento de 40–43° no la puede subir el contrapeso.**
La spec pide que el riel suba de 7,0 a 11,0 mm entre 40° y 43°. Son 4,00 mm en 3°, es decir 1,333 mm/grado, que a r=150 (2,618 mm de arco por grado) es una **pendiente de 0,509 = 27,0°**. Con N_riel = 1,066 N y μ = 0,2 la trepada exige `1,066 × (0,509 + 0,2) × 0,150 = 113 mN·m`; sumada a la detente reflejada de 114 da 227 frente a un sesgo de 247: **margen 1,09×**. El fallo seguro se pararía a mitad de la rampa de aparcamiento con la brocha ya fuera de la piel (benigno) pero sin cerrar el microrruptor (rompe la integridad por ciclo y el homing). **Corrección:** meseta plana de 34° a 43°, altura constante; la cuna se sube con su pedestal ajustable. No se pierde nada: los 4 mm extra de riel sólo servían para meter la brocha en la cuna, y eso lo hace mejor un poste con dos ranuras.

**D2 · La zona de despegue de 7° obliga a una pendiente mayor de la supuesta.**
La spec da a la vez "26–33° con el riel de 2,6 a 7,0 mm" y "trepada de riel 61 mN·m". 4,42 mm en 7° son 0,631 mm/grado = pendiente 0,241 = 13,6°, que da **70,5 mN·m**, no 61. Los 61 mN·m corresponden a 10,3°. **Corrección:** despegue 26–34° (8°), pendiente 11,9°, trepada **66 mN·m**, meseta 34–43° (31,4 mm de arco en lugar de 37). El precio es 5,3 mm menos de jitter de inversión.

**D3 · El margen del fallo seguro es 1,37×, no 1,41×.** Consecuencia directa de D2. Sigue por encima de 1,3.

**D4 · Las dos costillas de arco no pueden ser idénticas.** A r=125 un grado son 2,182 mm; a r=175, 3,054 mm. Una plantilla única daría una superficie que no es reglada y que alabearía el patín al migrar el carro. Lo que es único es la **tabla h(φ)**.

**D5 · 5° de error de bisagra son incompatibles con ±12 mN.** ΔN = 160·sen(e) mN; a 5° eso ya son ±13,9 mN. **Objetivo 3°, rechazo 5°.**

**D6 · La rampa de aterrizaje no llega a 2,5 s.** 37 mm de arco de taper a 2–7 cm/s dan **1,83–0,52 s**. Para 2,5 s harían falta 1,5 cm/s, por debajo del suelo de la banda CT. La spec dice "0,6–2,5 s". Lo correcto es **0,52–1,83 s**, y sigue cubriendo de sobra la exigencia de "rampa de al menos 0,5 s" de la psicofísica.

**D7 · En un tubo de 25 mm no caben 360 g.** Ver §8.3. Se pasa a PVC de 32 mm y orificio de 0,75 mm. El "0,5 mm" de la spec es correcto para un Ø int. de 21 mm; mi cálculo independiente da 0,47 mm, así que la física de la spec está bien y sólo falla el empaquetado.

**D8 · Con la columna de 200 mm se rompe el gálibo de 260 mm.** Perno + 2 × 608ZZ + separador de 43 + tuerca son 68 mm por encima de la tapa de la columna. 18 (base) + 200 (columna) + 68 = 286 mm. **Columna de 130 mm** → punto más alto 222 mm.

**D9 · El tambor de 70 mm es un RADIO, no un diámetro.** 0,360 × 9,81 × 0,070 = 247 mN·m ✓ (con 35 mm de radio saldrían 124). Lo confirma la coherencia con la síntesis rechazada: 320 g × 45 mm = 141 mN·m, que es exactamente lo que la spec cita. **El tambor mide Ø140 mm.** El documento lo asume así en todas partes.

**D10 · El cable del contrapeso no pasa "del sector a un tambor".** Tal como está escrito ("segundo cable del borde opuesto del sector, sobre una polea 623ZZ, hasta un tambor de 70 mm"), un tambor intercalado en mitad de un cable no hace nada. La lectura mecánicamente coherente, y la única que da los 247 mN·m, es: **el tambor de r=70 está en el propio eje de barrido**, el cable sale tangencialmente de su garganta, pasa por la polea de reenvío y baja al peso.

**D11 · La cuna caliente no cae sobre la base.** A φ=+43° y R=300 la punta está a (205, 219) mm del eje. Necesita su propio pie, unido a la base por un tirante. El argumento de seguridad (400 mm del cuerpo, sobre estructura propia) se conserva íntegro.

**D12 · El lastre de fuerza y el patín se disputan la estación x=90.** Un lastre de latón de 40 g ocupa 25–75 mm de botavara según cómo se haga; el patín está en x=90 y la posición nominal del lastre es x=125. Se solapan en gran parte del recorrido útil. **Solución (adición A2):** varilla de carbono de Ø3 a +14 mm sobre el eje, sólo para el lastre. Coste: k_tip pasa de 0 exacto a **0,096 N/m** (±2,4 mN sobre ±25 mm), que sigue siendo 40 veces mejor que cualquier muelle.

**D13 · Menor: el ciclo de 13,9 s no cuadra con huecos de 1,5–5,5 s.** A 3 cm/s el movimiento son 6,63 (pasada) + 2,44 (dos tapers) + 2,79 (dos traslados de despegue) = **11,86 s**. Con huecos de 1,5–5,5 s el periodo es 13,4–17,4 s, es decir **52–67 pasadas** en 15 min. Los "64 strokes / 13,9 s" corresponden a un hueco medio de 2,1 s, en el extremo corto de la banda. No es un problema mecánico; es una nota para el firmware.

---

## ANEXO E — LO QUE HAY QUE VOLVER A MEDIR AL CABO DE UN MES

| Cada | Qué | Criterio |
|---|---|---|
| Semana | lavado del cabezal a 40 °C | — |
| Mes | compresión del pelo a 41 g | 6–12 mm |
| Mes | vueltas del cabrestante, con linterna | una sola capa, sin montar |
| Mes | fuerza en φ=0 con la báscula | 41 ± 1 g |
| Mes | retroceso del fallo seguro desde φ=0 | 2,0–2,6 s, llega al tope |
| 3 meses | cinco puntos del arco | 38,3–43,3 g |
| 3 meses | ruido ON/OFF en la almohada | < 3 dB |
| 6 meses | nudos de Dyneema y ancla del cabrestante | sin deshilachado |
| 6–12 meses | cambio de cabezales | — |

---

## ANEXO F — RESUMEN DE UNA PÁGINA (para llevar al taller)

```
  COTAS QUE NO SE NEGOCIAN
  R = 300   L = 240   x_patin = 90   relacion 2,67   r_yugo = 60
  r_sector = 60   r_tambor = 70   r_cabrestante = 4,2   reduccion 14,29:1
  rodamientos 608ZZ a z = 140 y z = 190   columna 80x80x130
  datum del riel z = 145   plano de contacto z = 150

  ZONAS DE BARRIDO (por lado)
  0-19  sin riel, 400 mN, 199 mm de arco
  19-26 taper, riel 0 -> h_t, fuerza 400 -> 0, 37 mm de arco
  26-34 despegue, riel h_t -> h_t+4,42, pendiente 11,9 deg
  34-43 meseta plana, 11,8 mm de aire, 31,4 mm de arco
  43    tope M4 captivo + microrruptor + cuna caliente

  LA FORMULA
        h_t (mm) = compresion del pelo a 41 g (mm) / 2,67
        h meseta = h_t + 4,42

  LOS DOS BLOQUEOS
  1. Medir la resistencia del tren ANTES de comprar el contrapeso.
     contrapeso (g) = 1,4 x (masa en gramos que hace ceder el yugo,
                             colgada del tambor de r=70)
  2. Medir k_brush ANTES de cortar el riel.

  LAS TRES COSAS QUE SE ROMPEN SI TE DESPISTAS
  - Eje de bisagra fuera de tangencial: 3 deg = +/-8,4 mN, y CAMBIA DE SIGNO
  - Cabrestante sin guiacabos: el cable se monta y pierde pasos
  - Piston del amortiguador con fuga: el orificio no controla nada

  LA REGLA QUE LO RESUME TODO
  Ninguna pieza de esta maquina puede aumentar la fuerza sobre la piel.
```

---

*Fin del documento 02. Siguiente: `03-electronica.md` (TMC2209, RP2040, cadena de seguridad hardware) y `04-firmware.md` (paseo OU, generador PIO, maquina de estados del sector).*
