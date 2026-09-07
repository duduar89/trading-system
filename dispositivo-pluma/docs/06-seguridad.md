# 06 · DOSIER DE SEGURIDAD — PLUMA-R

**Documento 06 de la serie PLUMA-R.**
Hermanos: `02-mecanica.md` (geometría, pares, montaje) · `03-bom.md` (compras) · `04-electronica.md` (cadena de seguridad eléctrica) · `05-algoritmo-movimiento.md` (firmware) · `final_spec.md` (contrato vinculante).

> **Este documento es el que decide si el aparato duerme contigo.**
> Los otros cinco dicen cómo construirlo. Éste dice bajo qué condiciones tienes derecho a encenderlo y perder la consciencia a 300 mm de él. Si algo de este documento no se cumple, el aparato no se usa. No hay versión "casi".

---

## ÍNDICE

| § | Contenido |
|---|---|
| [0](#0) | Resumen ejecutivo y las diez reglas que no se negocian |
| [1](#1) | Marco del FMEA: escalas, umbrales y qué significa cada número |
| [2](#2) | FMEA completo — 39 modos, y la enumeración cerrada de todos los caminos hacia "la brocha sobre la piel" |
| [3](#3) | Fichas ampliadas de los diez modos de mayor RPN |
| [4](#4) | LAS CAPAS DE PARADA (son seis, no cinco), su independencia real y los cuatro recursos que SÍ comparten |
| [5](#5) | Por qué el fallo seguro es MECÁNICO — presupuesto de pares y verificación en casa |
| [6](#6) | Enredo de pelo: por qué esta geometría no puede acumular vueltas |
| [7](#7) | Riesgo ocular: pandeo de un pelo de cabra y la regla de colocación |
| [8](#8) | Vuelco: masa, centro de gravedad, fuerza de vuelco |
| [9](#9) | Límites térmicos y la demostración del techo de hardware |
| [10](#10) | Higiene, alergias y el fallo insidioso del apelmazamiento |
| [11](#11) | Contraindicaciones: quién NO debe usarlo |
| [12](#12) | Etiquetas de advertencia para pegar en el aparato |
| [13](#13) | Puesta en marcha segura, paso a paso |
| [14](#14) | Contradicciones encontradas en la especificación vinculante |
| [15](#15) | Calendario de mantenimiento y hojas de comprobación |

---

<a name="0"></a>
## 0. RESUMEN EJECUTIVO

### 0.1 La tesis de seguridad en un párrafo

PLUMA-R es seguro **por construcción, no por vigilancia**. La fuerza normal sobre la piel es un lastre de latón de 40 g sobre un eje que **no tiene actuador**: ningún fallo de software, ningún enclavamiento del driver y ninguna condición de carrera pueden apretar más de 400 mN, porque no existe ningún camino físico para hacerlo. La retirada de la brocha es un peso de 360 g colgando de un cordón: no tiene trinquete que se atasque, ni condensador que se descargue, ni lógica que se cuelgue, ni código que se ejecute mal. Y el elemento más peligroso de todo el campo de arquitecturas candidatas —un tambor de fibra girando continuamente sobre una persona dormida— **no existe aquí**: el barrido oscila ±43° y se invierte, así que no hay ningún elemento que pueda acumular vueltas de pelo.

Lo que **no** es intrínsecamente seguro, y por eso este documento existe, es el intervalo entre "el firmware se cuelga" y "las bobinas se apagan". Con las bobinas energizadas a I_RUN 0,337 A el par de retención reflejado al sector es de **~500 mN·m**, el **doble** de los 247 mN·m del contrapeso. Un firmware colgado con las bobinas vivas **mantiene la brocha sobre la piel**. La especificación vinculante afirma que el contrapeso "cubre firmware colgado" y **eso es falso tal como está escrito**. Lo cubre la **charge pump de latido**, que corta VMOT en menos de 250 ms. Es la corrección C-5 de `04-electronica.md` y es la razón por la que en este documento hay **seis** capas de parada y no las cinco del guion.

### 0.2 Las diez reglas que no se negocian

```
 ┌───────────────────────────────────────────────────────────────────────────┐
 │  1. LA BASE NUNCA VA SOBRE EL COLCHÓN. Mesilla, silla o tabla rígida.     │
 │     Todos los modos de fallo de vuelco, arrastre de ropa de cama y        │
 │     cargador-bajo-el-edredón empiezan por romper esta regla.              │
 │                                                                           │
 │  2. NADA DEL APARATO PUEDE ALCANZAR LA CABEZA. El disco barrido es de     │
 │     Ø650 mm. Ningún punto de la cabeza o el cuello a menos de 475 mm      │
 │     del eje de barrido. Esto NO lo garantiza la altura: lo garantiza      │
 │     dónde pones la máquina.                                               │
 │                                                                           │
 │  3. EL LASTRE TRASERO W1 (400 g) ES UNA PIEZA DE SEGURIDAD, no un         │
 │     accesorio acústico. Sin él el aparato vuelca hacia la cama.           │
 │                                                                           │
 │  4. NADIE DUERME CON ESTO HASTA QUE PASE LAS TRES PRUEBAS × 10 ÁNGULOS:   │
 │     tirón del USB, pulsador de paro, y firmware colgado a propósito.      │
 │     La brocha debe abandonar la piel en 2-3 s. 10 de 10. Sin excepciones. │
 │                                                                           │
 │  5. EL CONTRAPESO SE DIMENSIONA MIDIENDO, NO COPIANDO. Los 360 g de la    │
 │     spec suponen un detente de 8 mN·m que no está en ninguna hoja de      │
 │     datos. Mide (§5.4) y usa la tabla. Si mides 12 mN·m, son 484 g.       │
 │                                                                           │
 │  6. DOS CABEZALES, LAVADO SEMANAL, AUTOCOMPROBACIÓN CON BÁSCULA. El       │
 │     apelmazamiento es el único fallo que degrada la caricia hasta         │
 │     convertirla en cosquilleo SIN QUE TE DES CUENTA.                      │
 │                                                                           │
 │  7. CARGADOR USB DE MARCA CON MARCADO IEC 62368-1, SOBRE SUPERFICIE       │
 │     DURA, NUNCA BAJO ROPA DE CAMA. CERO BATERÍAS DE LITIO en el aparato.  │
 │                                                                           │
 │  8. ADULTOS. Sin niños, sin bebés, sin mascotas en la habitación, sin     │
 │     nadie que no pueda pulsar el paro o apartarse por sí mismo.           │
 │                                                                           │
 │  9. LA EXTREMIDAD SE APOYA EN EL COLCHÓN, NUNCA SOBRE UNA ALMOHADA,       │
 │     UN COJÍN NI UN BRAZO DOBLADO. Si la piel queda más de 25 mm por       │
 │     encima de lo previsto, la charnela topa y el techo de 400 mN —que     │
 │     es la tesis de seguridad entera— DEJA DE EXISTIR (F-35).              │
 │                                                                           │
 │ 10. SÓLO 5 V USB. Nunca una fuente de portátil, un cargador PD de         │
 │     9/12/20 V ni un jack de 12 V. El techo del calefactor escala con      │
 │     el CUADRADO de la tensión (F-36).                                     │
 └───────────────────────────────────────────────────────────────────────────┘
```

### 0.3 Los tres números que resumen la seguridad de la máquina

| Magnitud | Valor | Por qué basta |
|---|---:|---|
| Fuerza normal máxima físicamente posible sobre la piel | **400 mN** (transitorio 580 mN) | Es un lastre de latón. No hay actuador en ese eje. 0,19 kPa = 1,4 mmHg sobre 2120 mm², frente a los 32 mmHg de presión de cierre capilar. **⚠️ PRECONDICIÓN, y es nueva: esto sólo es cierto mientras la piel quede dentro de la banda de flotación de cabeceo de ±25 mm.** Si la extremidad está más alta —mesilla baja, brazo apoyado sobre una almohada— la charnela topa, la botavara pasa a ser rígida y la fuerza deja de ser un lastre de latón para pasar a ser una interferencia geométrica contra 2,26 kg de máquina. Ver **F-35** |
| Fuerza tangencial máxima | **0,58 N** hacia el lado lejano · **2,2 N** hacia el reposo | El brazo distal de GRP de 2 mm (k = 70 N/m) se dobla 20 mm a 1,4 N antes de transmitir nada. Y los 2,2 N sólo actúan en la dirección que termina sobre la propia base de la máquina |
| Potencia máxima del calefactor de férula | **0,2083 W** *(con VBUS = 5,00 V)* | V²/R con una resistencia de 120 Ω que **falla en circuito abierto**. Un MOSFET en corto no puede meter más. Techo = T_ambiente + 17,7 K. **⚠️ El techo escala con V²**: con una fuente equivocada de 9 V serían 0,675 W y una férula a 77 °C. Quien garantiza el caso de sobretensión no es la resistencia, es el **KSD9700 de 45 °C**. Ver **F-36** |

---

<a name="1"></a>
## 1. MARCO DEL FMEA

### 1.1 Escalas

**SEVERIDAD (S) — qué pasa si ocurre, suponiendo que no hay mitigación.**

| S | Nombre | Definición operativa para este aparato |
|:-:|---|---|
| 1 | Insignificante | Molestia o pérdida de función. La sesión se estropea, la persona no |
| 2 | Menor | Incomodidad, despertar, marca en la piel que desaparece en minutos |
| 3 | Moderada | Irritación cutánea, foliculitis, eritema persistente, quemadura superficial de primer grado, contacto sostenido toda la noche |
| 4 | Grave | Lesión que requiere atención médica: quemadura de segundo grado, abrasión corneal, contusión, laceración |
| 5 | Crítica | Lesión permanente o riesgo vital: rotura del globo ocular, avulsión del cuero cabelludo, estrangulamiento, incendio |

**PROBABILIDAD (P) — frecuencia esperada en un uso nocturno, 350 sesiones al año.**

| P | Nombre | Definición operativa |
|:-:|---|---|
| 1 | Remota | Menos de una vez en la vida del aparato (< 1 en 3500 sesiones) |
| 2 | Baja | Una vez cada varios años (~1 en 1000 sesiones) |
| 3 | Media | Una vez al año (~1 en 350 sesiones) |
| 4 | Alta | Una vez al mes (~1 en 30 sesiones) |
| 5 | Muy alta | Prácticamente en cada sesión, o degradación continua garantizada |

**DETECCIÓN (D) — cómo de fácil es que el sistema o la persona se enteren ANTES de que haya daño.**

| D | Nombre | Definición operativa |
|:-:|---|---|
| 1 | Evidente | El propio mecanismo lo hace imposible o lo delata al instante (corte de raíl, tope físico) |
| 2 | Detectado por la máquina | El microrruptor, StallGuard, el NTC o el firmware lo capturan dentro del mismo ciclo |
| 3 | Detectado por la persona | Se ve, se oye o se nota en la comprobación semanal |
| 4 | Difícil | Sólo aparece con una prueba deliberada o midiendo con instrumento |
| 5 | Insidioso | Progresa en semanas sin ninguna señal, o su síntoma se confunde con otra cosa |

**RPN = S × P × D**, máximo 125.

### 1.2 Umbrales de acción — y son vinculantes

| RPN | Acción exigida |
|---:|---|
| **≥ 60** | **BLOQUEANTE.** No se monta ni se enciende nada hasta que la mitigación esté puesta Y verificada con un ensayo |
| **40 – 59** | Mitigación obligatoria, incorporada al diseño, con ensayo de aceptación documentado |
| **20 – 39** | Mitigación obligatoria; el ensayo puede ser una comprobación de la lista de mantenimiento |
| **10 – 19** | Mitigación recomendada o advertencia escrita |
| **< 10** | Se acepta el riesgo y se documenta |

**Regla adicional que se aplica por encima del RPN:** cualquier modo con **S = 5** lleva mitigación obligatoria aunque su RPN sea 10, porque la severidad crítica no se compensa con probabilidad baja. En este aparato eso afecta a cinco filas: enredo de pelo (dos), lazo de cable, incendio del cargador y rotura del tendón del contrapeso.

### 1.3 Cómo leer la columna "RPN después"

La columna **RPN antes** es el riesgo de la arquitectura desnuda. La columna **RPN después** es el riesgo con la mitigación **ya incorporada al diseño que vas a construir** — no con una mitigación propuesta. Todo lo que aparece en la columna "mitigación" está en `02-mecanica.md`, `03-bom.md`, `04-electronica.md` o `05-algoritmo-movimiento.md`, con su número de ensayo. Si no está construido, el RPN que corre es el de "antes".

---

<a name="2"></a>
## 2. FMEA COMPLETO — 39 MODOS

Ordenado por **RPN antes**, de mayor a menor.

| # | Modo de fallo | Causa | Efecto sobre la persona | S | P | D | **RPN** | Mitigación CONCRETA ya incorporada | S' | P' | D' | **RPN'** |
|:-:|---|---|---|:-:|:-:|:-:|:-:|---|:-:|:-:|:-:|:-:|
| **F-01** | **Contrapeso atascado**: el pistón se agarrota en el tubo de PVC o se obstruye el orificio de purga de 0,5 mm | Espuma hinchada por humedad, pelusa de fieltro en la purga, tubo sin desengrasar, pistón tocando fondo y quedándose pegado | **Se pierde el fallo seguro completo.** Brocha inmóvil sobre la piel toda la noche a 400 mN, con las bobinas apagadas y sin ninguna capa eléctrica capaz de arreglarlo | 5 | 3 | 5 | **75** | Purga de 0,5 mm taladrada en la **tapa rígida del tubo**, no en el pistón. Ranura de fuga 0,5 × 0,5 mm en los últimos 15 mm del tubo, para que el pistón nunca cierre contra el fondo. Pistón de espuma Ø24 en tubo Ø25 ID, con una vuelta de fieltro adhesivo y PTFE seco en el tubo. **Prueba de caída libre semanal** (§15.2). Homing falla si el yugo no llega al reposo → el firmware se niega a arrancar | 5 | 2 | 2 | **20** |
| **F-02** | **Freewheel mal configurado**: al cortar VMOT las bobinas quedan en cortocircuito en vez de en alta impedancia | `PWMCONF.freewheel = 10` o `11` en el TMC2209, o `IHOLD = 0` interpretado como "corriente cero" | Frenado magnético por corrientes inducidas que se opone al contrapeso. La botavara se para a mitad de la retirada, con la brocha **todavía sobre la piel** | 4 | 3 | 5 | **60** | `PWMCONF.freewheel = 01` **obligatorio** (alta impedancia). Los valores `10` y `11` están prohibidos por escrito en `04-electronica.md` (C-4). Ensayo 11.24: cortar VMOT y comprobar que el eje gira libre con dos dedos | 4 | 1 | 2 | **8** |
| **F-03** | **Apelmazamiento de la brocha** — el fallo insidioso | Sebo cutáneo semana a semana. `k_tip = 0` mantiene la fuerza clavada en 400 mN mientras la huella se encoge | La caricia deriva de "ancha y suave" a "puntual". Es decir, **de caricia a knismesis**: exactamente el cosquilleo irritante que el aparato existe para evitar. Y el síntoma se lee como "el aparato se ha estropeado", no como "hay que lavar la brocha" | 2 | 5 | 5 | **50** | **DOS cabezales** (A-37, 16,00 €), alternados entre sesiones, cambio en 10 s con tubo de silicona y brida. Lavado semanal a 40 °C con champú neutro sin siliconas (D-01). **Autocomprobación con báscula de cocina impresa en la base**: apretar hasta 41 g, la compresión del pelo debe ser 5,5–9,0 mm; por debajo de 5,0 mm está apelmazada. Verificación de huella: ≥ 50 mm de diámetro a 41 g | 2 | 3 | 2 | **12** |
| **F-04** | **Cuelgue del firmware con las bobinas energizadas** | Bucle infinito, desbordamiento de pila, puntero desbocado, `time_us_64()` corrupto, fallo de flash | El par de retención reflejado (~500 mN·m a I_RUN 0,337 A) **duplica** el sesgo del contrapeso (247 mN·m). La brocha se queda quieta sobre la piel **hasta 16 minutos** | 4 | 3 | 4 | **48** | **Charge pump de latido** (5 componentes, ~1 €): GP11 emite 2 kHz por hardware, se rectifica a la puerta de Q2. Firmware colgado, pin atascado alto, pin atascado bajo, MCU en reset o muerto → sin bombeo → **VMOT cae en < 250 ms** (τ = 470k × 100 nF = 47 ms, 3τ). Ensayo 11.17 y 11.30(c) | 4 | 2 | 1 | **8** |
| **F-05** | **Motor calado** contra un obstáculo, en silencio | Ropa de cama en la ranura del yugo, patín atascado en el riel, cordón fuera de la garganta | StealthChop cala **sin hacer ruido**: no hay seguidor que caiga, así que el aparato no "tictaquea mientras falla". La brocha queda parada sobre la piel, y las bobinas siguen disipando 1,22 W | 3 | 4 | 4 | **48** | **Microrruptor de reposo**, 5 visitas programadas a la taza por sesión (arranque + fin de cada bloque de 3,75 min): si no cierra dentro del tiempo comandado +50 % → parar, desenergizar (el contrapeso retira), 5 s, un reintento, fin de ciclo. **StallGuard4** como segundo disparo por encima de 3 cm/s. Límite tangencial de 0,58 N. Fusible de GRP de 2 mm | 3 | 3 | 2 | **18** |
| **F-06** | **Pelo enredado en el husillo T8 del carro radial** | El carro está en el yugo, es decir en el lado de la piel. El husillo T8 gira 0,63 vueltas por movimiento y el 28BYJ-48 lleva reductora 1:64 | Un 28BYJ-48 calado da hasta 0,3 N·m en su salida; sobre un husillo T8 de 8 mm de paso son **~70 N de tracción**. Bastante para arrancar pelo (umbral 50–100 N) | 5 | 2 | 4 | **40** | **Cubierta forrada de fieltro sobre todo el carro**, con todas las holguras **< 1 mm**. El husillo, la tuerca de latón y los dos ejes de 6 mm quedan encerrados. `I_HOLD = 0`, husillo retro-conducible, 10 movimientos de 2,5 s por sesión. **Ensayo obligatorio**: sujetar un mechón de pelo largo contra la cubierta durante un ciclo completo de 15 min y demostrar que no entra nada | 5 | 1 | 2 | **10** |
| **F-07** | **Tendón de Dyneema del contrapeso roto** | Abrasión contra la polea de reenvío, nudo que corre, corte por un canto vivo del tambor, degradación UV | **Punto único de fallo del fallo seguro entero.** Sin sesgo, la botavara se queda donde esté al perder alimentación: brocha sobre la piel indefinidamente | 5 | 2 | 4 | **40** | Dyneema de 0,4 mm ≈ 200 N de rotura frente a 4,12 N de trabajo = **48×**. **Sin nudos en el camino de carga**: gaza cosida o 5 vueltas + 3 cotes sobre un poste liso. Polea 623ZZ con radio de garganta ≥ 3 mm y cantos redondeados. **CORDÓN SECUNDARIO REDUNDANTE** de la misma Dyneema, montado con 2 mm de holgura, que toma la carga si el principal parte (coste 0,20 €). Inspección mensual, sustitución anual. Si aun así falla: homing no encuentra el reposo → el firmware se niega a arrancar | 5 | 1 | 2 | **10** |
| **F-08** | **Cargador USB falsificado o degradado** | 92 % de 116 muestras de cargadores falsificados suspendieron ensayos críticos de aislamiento (Electrical Safety First) | Incendio o descarga junto a ropa de cama, con la persona dormida | 5 | 2 | 4 | **40** | Cargador de **marca reconocida con marcado IEC 62368-1**, ≥ 2 A, comprado en tienda, no en marketplace. Sobre superficie dura, **nunca bajo almohada, edredón ni sobre el colchón**. Enchufe conmutado o desenchufar. **Cero celdas de litio en el aparato** (los bomberos advierten explícitamente contra cargar litio en camas). Detector de humo operativo en la habitación | 5 | 1 | 3 | **15** |
| **F-09** | **Tornillos de tope M4 aflojados o perdidos** | Vibración, o alguien los aflojó para ajustar el barrido y no los volvió a apretar | El barrido supera ±43°. Al lado del reposo el cordón del contrapeso se sale de la garganta del tambor y la botavara cae; al lado lejano el gálibo crece hacia la cama | 4 | 3 | 3 | **36** | Topes M4 **cautivos en agujeros ciegos** en el sector de contrachapado: aunque se aflojen del todo **no pueden salirse**. **Segunda barrera independiente**: la ranura del yugo en la tapa de la columna, de 100°, que no se puede quitar sin desmontar la máquina. **Tercera**: orejas de contrachapado en los extremos de las rampas, para que el patín no pueda abandonar el riel. **Cuarta**: el homing se niega a arrancar si no encuentra el reposo dentro de 95° de recorrido | 4 | 2 | 1 | **8** |
| **F-10** | **Brocha atrapada** bajo el cuerpo, bajo el edredón o enganchada en un pliegue | La persona se mueve; el edredón se desplaza | El contrapeso tira hacia el reposo con hasta 2,2 N tangenciales (contrapeso + motor). Sobre 2120 mm² de pelo son 1,0 kPa de cizalla: no lesivo, pero se percibe como un raspado | 3 | 4 | 3 | **36** | El **fusible de sobrecarga de GRP de 2 mm** (k = 70 N/m) se dobla 20 mm a 1,4 N y 40 mm a 2,8 N **antes** de transmitir nada. La flotación de cabeceo de ±25 mm a `k_tip = 0` absorbe el primer desplazamiento sin cambiar la fuerza. El microrruptor de integridad detecta que no se llega al reposo y termina el ciclo. El amortiguador neumático limita el latigazo a 80–120 mm/s cuando la persona se aparta | 3 | 3 | 2 | **18** |
| **F-11** | **Brownout / caída del raíl de 5 V** | Corriente de arranque del motor sobre un cable USB fino, cargador flojo, contacto sucio | Resets repetidos del MCU. Si el `EN` del driver no está bien polarizado, el motor da tirones en cada arranque: bucle reset-tirón autosostenido sobre una persona dormida | 3 | 3 | 3 | **27** | Comparador de brownout que dispara el latch por debajo de **4,60 V** en VBUS. **UVLO del propio TMC2209** a 4,75 V → puentes en alta impedancia. **`EN` del TMC2209 con pull-UP de 10 kΩ a 3V3** (es activo a nivel bajo — ver C-3; copiar el "pull-down" del informe de investigación **energiza el motor en cada reset**). 470 µF en el raíl del motor + 100 µF en el del MCU. **Arranque siempre en estado PARADO**, nunca reanudar un ciclo tras un reset, negarse a arrancar tras 3 resets en un minuto | 3 | 2 | 2 | **12** |
| **F-12** | **Calefactor de la taza de reposo desbocado** | Q5 en cortocircuito D-S, GP8 atascado alto, NTC de la taza desconectado | *(Mitigado en la raíz: R17 = **120 Ω**, techo de hardware 34,8 °C. Lo que sigue es el análisis del 47 Ω descartado.)* Con R17 = 47 Ω la taza disipa 0,532 W. Con R_th ≈ 71 K/W el **régimen permanente sería T_amb + 37,8 K = 58 °C**: quemadura por contacto y superficie caliente cerca de ropa de cama | 3 | 2 | 4 | **24** | **Ver la corrección C-13 en §14.** El calefactor de taza es seguro **sólo por transitorio**: el TPL5010 mata VMOT a los 960 s y la constante térmica de la taza es τ ≈ 1800 s, así que el techo real a los 16 min es T_amb + 15,6 K = **35,6 °C a 20 °C de ambiente**. Se exige: (a) alimentarlo **siempre desde VMOT, jamás desde VBUS**; (b) **KSD9700 NC de 45 °C** pegado a la taza en serie; (c) ensayo 11.20-bis, 16 min al 100 % de duty con el lazo NTC desactivado y termómetro IR: **≤ 40 °C o se sube R17 a 120 Ω** | 3 | 1 | 2 | **6** |
| **F-13** | **Calefactor de férula desbocado** | Q4 en cortocircuito, GP9 atascado alto, NTC de férula abierto pidiendo 100 % | Calor sostenido a 30 mm de las puntas del pelo, durante 15 min | 3 | 2 | 4 | **24** | **Techo de hardware, no de software**: P_max = 5²/120 = **0,2083 W**, y una resistencia de película metálica **falla en circuito abierto**, nunca en corto. R_th ≈ 85 K/W → **ΔT_max = 17,7 K**. Firmware desactiva el calefactor si el ambiente supera 24 °C (techo garantizado ≤ 41,7 °C). **KSD9700 NC de 45 °C pegado a la férula**, no al cable. Nada metálico ni conductor toca la piel: 30 mm de pelo y una férula de silicona por medio, y la compresión a 400 mN es de sólo 6,9 mm | 3 | 1 | 1 | **3** |
| **F-14** | **El lastre de latón de 40 g se desliza en la botavara** | Vibración, prisionero mal apretado, choque | La fuerza de contacto deriva 1,63 mN por mm. 30 mm de deslizamiento = 49 mN = 12 % | 3 | 2 | 4 | **24** | Prisionero **con punta de nailon** (no metal contra carbono) sobre escala impresa en mm. **Marca testigo de rotulador** a caballo entre el lastre y la botavara: si se ha movido, se ve. Comprobación mensual con báscula de cocina: 41 ± 2,5 g. Y aunque se fuera al extremo (x = 200 mm) la fuerza sería 523 mN, todavía por debajo del techo de 1 N del FMEA | 3 | 1 | 2 | **6** |
| **F-15** | **Microrruptor de reposo pegado en cerrado** | Contacto soldado, muelle vencido, suciedad | El firmware cree que está en el reposo estando en cualquier otro sitio: homing falso, integridad por ciclo falsamente satisfecha. Se pierde la única detección primaria de calado | 3 | 2 | 4 | **24** | El firmware exige que el microrruptor **ABRA** al salir del reposo en el primer golpe de la sesión. Si nunca abre → fallo de arranque, dos parpadeos, no se energiza el motor. Comprobación en la lista mensual: pulsar y soltar la palanca oyendo los dos clics. El contrapeso y las capas eléctricas no dependen de este contacto | 3 | 1 | 2 | **6** |
| **F-16** | **La persona se gira encima del brazo** | Sueño. Es un suceso esperado, no un accidente | Aplasta la botavara contra el colchón. Riesgo de rotura del tubo de carbono y de astilla | 3 | 4 | 2 | **24** | Cadena de cesión en tres etapas: **(1)** flotación de cabeceo ±25 mm a `k_tip = 0` — la botavara sube 25 mm sin que la fuerza cambie; **(2)** el GRP distal se dobla 20 mm a 1,4 N; **(3)** el tubo de carbono se rompe. **Todo el brazo va forrado con macarrón termorretráctil de punta a punta**, de modo que una rotura no puede producir una astilla libre de carbono o de fibra de vidrio. La máquina está a 400 mm y pesa 2,26 kg: el brazo se rompe antes de que la máquina se mueva. **Regla escrita: brazo doblado o roto = no se usa hasta sustituirlo**, porque cambia el momento estático y por tanto la fuerza de contacto | 3 | 3 | 1 | **9** |
| **F-17** | **Reinicio espurio que rearranca el ciclo** | Glitch de alimentación, botón pulsado al girarse encima | Un ciclo de 15 min no deseado a las 4 de la mañana, o encadenar ciclos toda la noche | 3 | 2 | 3 | **18** | El latch CD4013 se **rearma sólo con el pulso RC del botón de arranque**; un POR al enchufar el USB dispara SET, es decir **enchufar nunca energiza el motor**. Pulsación deliberada de **300 ms** para arrancar. Estado de arranque siempre PARADO. El pulsador de arranque va en la base, en el borde cercano, protegido por un reborde de 3 mm para que no se pueda pulsar apoyando la mano | 3 | 1 | 2 | **6** |
| **F-18** | **NTC desconectado** (circuito abierto) | Hilo roto en la charnela por fatiga de flexión | El divisor lee 3,3 V = "muy frío" → el lazo pide 100 % de duty indefinidamente | 2 | 3 | 3 | **18** | El techo sigue siendo de hardware: 0,2083 W → T_amb + 17,7 K, **pase lo que pase con el lazo**. Además el firmware detecta lectura fuera de rango (< 5 °C o > 60 °C) y apaga el calefactor, sigue la sesión sin calor y hace un parpadeo al terminar. Los hilos del calefactor y del NTC van **en bucle coaxial con el eje de la charnela** (lo cual también evita el error de +2 mN en la fuerza) | 2 | 2 | 1 | **4** |
| **F-19** | **Amortiguador neumático sin freno** (fuga total, purga demasiado grande, pistón que ya no roza) | Espuma degradada, tubo rayado, purga agrandada al limpiar | La retirada llega a ~300 mm/s en punta en vez de 80–120 mm/s. Un golpe brusco al final de la retirada — **fuera de la piel**, pero ruidoso y capaz de despertar | 2 | 3 | 3 | **18** | El fallo es **benigno por dirección**: un amortiguador que no frena sigue permitiendo la retirada; el que se agarrota (F-01) es el peligroso. Prueba de caída libre semanal: la botavara debe tardar **2–3 s** desde +30° hasta el reposo. Menos de 1,5 s → purga demasiado grande o pistón gastado; más de 5 s → F-01 en curso | 2 | 2 | 2 | **8** |
| **F-20** | **Cuelgue del firmware con las bobinas ya desenergizadas** | Igual que F-04, pero durante un hueco con `freewheel` activo | Nada inmediato: el contrapeso ya está retirando. Pero el ciclo no termina y el aparato queda vivo | 2 | 3 | 3 | **18** | El contrapeso lleva la brocha al reposo en 2–3 s. La charge pump corta VMOT en < 250 ms de todos modos. El **watchdog hardware del RP2040 a 2 s** reinicia el MCU, rehace el homing y deja el motor apagado esperando una pulsación nueva | 2 | 2 | 1 | **4** |
| **F-21** | **Alergia a pelo animal, plumas o ácaros; asma** | El pelo de cabra es proteína animal. El lavado a 40 °C **no mata ácaros** (hacen falta 60 °C) | Rinitis, crisis asmática nocturna. La exposición es **nocturna, repetida y cerca de la zona respiratoria** | 4 | 2 | 2 | **16** | **Advertencia destacada** en §10.1 y en la etiqueta de la base. **Fallback documentado**: kabuki de taklon sintético de 60 mm (B, 3–8 €), hipoalergénico, sin antígeno aviar, lavable a 60 °C. Se pierde algo de suavidad percibida por filamento y se gana lavabilidad. **No se usa pluma natural real en ningún caso** — el "pulmón del edredón de plumas" es una neumonitis por hipersensibilidad documentada, con casos fibróticos, y hay una serie española de 28 pacientes | 4 | 1 | 2 | **8** |
| **F-22** | **Enredo de pelo en el cabrestante** | El cabrestante gira ±3,41 vueltas por barrido completo. Tres vueltas multiplican la tensión ×300 por la ecuación del cabrestante | Si un pelo llegara al cabrestante, la tensión de 4,12 N se convertiría en cientos de newtons | 5 | 1 | 4 | **20** | **Inaccesible por construcción**: el cabrestante está dentro de la columna de pino de 18 mm, bajo una **tapa de contrachapado atornillada**, a **200 mm de altura y a 400 mm de cualquier piel**. La única abertura es la ranura del yugo de 100° × 10 mm, con **limpiaparabrisas de fieltro adhesivo**. Ensayo obligatorio con un mechón de pelo largo, ciclo completo de 15 min | 5 | 1 | 1 | **5** |
| **F-23** | **Lazo de cable / estrangulamiento** | Cable USB con holgura junto a una cama. El escenario que mata en las persianas de cordón es siempre **un lazo** | Estrangulamiento. Catastrófico y no recuperable por la propia persona | 5 | 1 | 2 | **20** | **Cero lazos por construcción**: cable tendido recto y grapado, sin recogidos, sin bridas dejadas en anillo. **≤ 300 mm de cable libre por encima del nivel del colchón**; el resto baja por la cara exterior de la mesilla. **Conector USB magnético de desenganche a < 10 N** en el aparato. Ningún cordón del mecanismo es accesible: el tendón está bajo la tapa y el cordón del contrapeso dentro de la columna. **Contraindicación dura** con niños o mascotas en la habitación | 5 | 1 | 1 | **5** |
| **F-24** | **El aparato vuelca hacia la cama** | Empujón al girarse, tropiezo, tirón del cable, mesilla inestable | 2,26 kg cayendo 300 mm = 6,6 J sobre lo que haya debajo | 4 | 2 | 1 | **8** | **Lastre W1 de 400 g** atornillado bajo la parte trasera de la base: sube la fuerza de vuelco frontal de 8,8 N a **12,7 N** (§8). Base 300 × 200 con CdG a **69 mm** → relación base/altura = 2,9× frente al 1,2× exigido. Ángulo de vuelco 46–66° frente a los 10° exigidos. Pies de corcho. **Regla 1: nunca sobre el colchón.** El cable entra a z ≤ 40 mm, así que un tirón necesitaría 40 N para volcarla y el desenganche magnético actúa a 10 N | 4 | 1 | 1 | **4** |
| **F-25** | **Tirón del cable USB** | Alguien pasa, la persona se gira arrastrando el cable | Corte de alimentación en pleno golpe; posible arrastre del aparato | 2 | 3 | 1 | **6** | Desenganche magnético a < 10 N. Alivio de tracción en los dos extremos. La alimentación muere en ~15 ms (descarga de C1+C2) y **el contrapeso retira la brocha en 2–3 s**. Es exactamente el mismo camino que el fin normal del ciclo | 2 | 3 | 1 | **6** |
| **F-26** | **Corte de corriente / apagón** | Red, magnetotérmico, cargador que muere | Ninguno | 1 | 2 | 1 | **2** | Es el estado seguro por definición. Sin VMOT no hay par, y el contrapeso hace su trabajo. **Ninguna función de seguridad de este aparato necesita electricidad para actuar** | 1 | 2 | 1 | **2** |
| **F-27** | **Tendón de accionamiento (motor→sector) roto** | Abrasión en el cabrestante, corte | El contrapeso gana inmediatamente y lleva la botavara al reposo, frenada por el amortiguador | 1 | 2 | 1 | **2** | Fallo **benigno por dirección**: la rotura del tendón de accionamiento produce exactamente la retirada de seguridad. El homing falla en el ciclo siguiente y el aparato no arranca | 1 | 2 | 1 | **2** |
| **F-28** | **Fluencia (creep) de la Dyneema** | Carga permanente de 4,12 N durante meses | El punto de toque se desplaza unos milímetros. Ninguna consecuencia de seguridad | 1 | 4 | 3 | **12** | Retensar a la semana y al mes. El homing contra un tope duro **corrige la deriva en cada ciclo** por construcción | 1 | 3 | 1 | **3** |
| **F-29** | **Atrapamiento de un dedo, una oreja o un pliegue de piel en el yugo** | Una mano dormida busca el aparato | Pellizco | 2 | 2 | 2 | **8** | Ninguna holgura accesible en la banda 5–25 mm que se cierre durante el ciclo: la ranura del yugo mide **10 mm y no se cierra** (es una ranura de paso, no un par de tijera). Sin articulaciones en tijera. Cantos redondeados, sin tornillos salientes en la botavara. Y **la fuerza tangencial está limitada a 0,58 N / 2,2 N**, así que un dedo atrapado no puede aplastarse | 2 | 1 | 1 | **2** |
| **F-30** | **Ropa de cama arrastrada al mecanismo** | El edredón se mueve cada vez que la persona se mueve | Tela contra el motor caliente, o tirón del edredón | 3 | 3 | 2 | **18** | **Regla: se usa sobre una extremidad descubierta, con el mecanismo fuera del edredón.** Gálibo pequeño (nada por encima de 260 mm del plano de base). Botavara lisa, sin ganchos, ranuras, cabezas de tornillo ni ángulos en V. La fuerza tangencial de 0,58 N **no puede mover un edredón**. Detección de calado termina el ciclo | 3 | 2 | 2 | **12** |
| **F-31** | **Q1 (P-MOSFET del raíl) en cortocircuito D-S** | Sobretensión, defecto de fabricación | VMOT queda vivo permanentemente: se anulan de golpe el latch, la charge pump y el TPL5010 | 4 | 1 | 4 | **16** | **S1 está aguas arriba, físicamente en el cobre**, y no depende de Q1. Ensayo semestral: con el latch disparado, VMOT debe leer **< 0,1 V**; si lee 5 V, Q1 está en corto y el aparato queda fuera de servicio. **Doble fallo Q1 + S1 soldado** = desenchufar es la última capa; por eso el enchufe conmutado de la regla 7 no es decorativo | 4 | 1 | 2 | **8** |
| **F-32** | **Golpe/sobresalto al inicio o al final de la sesión** (jerk hipnagógico, despertar al terminar) | Toque no anticipado, parada brusca | Se despierta a la persona. Derrota el propósito entero del aparato | 1 | 3 | 2 | **6** | La brocha se coloca **apoyada en la piel durante la preparación**, con la persona despierta y atendiendo, y hace 60 s de precalentamiento antes de pulsar arranque: **la sesión no contiene ningún toque no anticipado**. Rampa de aterrizaje geométrica de 0,6–2,5 s. Cierre con un último golpe firme y retirada suave de 2–3 s. Sin pitidos. LED rojo tenue en la base, orientado en dirección contraria a la almohada, apagado durante el ciclo | 1 | 2 | 1 | **2** |

### 2.0-bis AMPLIACIÓN ADVERSARIAL — siete modos que faltaban

Estas siete filas salen de una revisión adversarial posterior: cotejo uno a uno contra los 16 peligros del informe de investigación original, y trazado de **todos** los caminos por los que la brocha puede quedarse sobre la piel. **Tres de ellas son caminos abiertos hacia "brocha sobre la piel toda la noche" que el FMEA original no contemplaba** (F-33, F-34, F-37) y una anula el techo de fuerza de 400 mN que es la tesis de seguridad entera (F-35).

| # | Modo de fallo | Causa | Efecto sobre la persona | S | P | D | **RPN** | Mitigación CONCRETA exigida | S' | P' | D' | **RPN'** |
|:-:|---|---|---|:-:|:-:|:-:|:-:|---|:-:|:-:|:-:|:-:|
| **F-33** | **Pistón topado y pegado en el EXTREMO SUPERIOR del tubo** | El recorrido del cordón es de 0,070 m × 1,501 rad = **105 mm**. Si el tubo útil es corto, o el conjunto se monta 20 mm alto, el pistón llega a la **tapa rígida** en el extremo lejano (φ = −43°) de **cada** barrido. La tapa es justo donde está la purga de 0,5 mm: el pistón la sella y se queda pegado por depresión, exactamente el mecanismo que F-01 teme abajo | **Se pierde el fallo seguro completo, sin previo aviso y a mitad de sesión.** El motor lleva la botavara al lado lejano, el pistón se pega arriba, el sesgo desaparece, se desenergiza y **la brocha se queda sobre la piel**. Las seis capas eléctricas cortan VMOT correctamente y no sirve de nada | 5 | 3 | 4 | **60** | **(a)** Recorrido útil del tubo ≥ **105 mm + 20 mm de reserva**, verificado con el cordón montado llevando la botavara a los dos topes a mano. **(b)** **Ranura de fuga 0,5 × 0,5 mm también en los ÚLTIMOS 15 mm SUPERIORES**, simétrica a la de abajo. **(c)** **Collar tope en el cordón**, 10 mm por debajo de la tapa, para que el pistón **no pueda tocarla nunca**. **(d)** La prueba de caída libre semanal se hace **desde el tope lejano (−43°), no desde +30°**: sólo así recorre el tramo superior del tubo donde vive este fallo | 5 | 1 | 2 | **10** |
| **F-34** | **El cordón del contrapeso se descarrila de la garganta del tambor o se monta sobre sí mismo, tras quedar flojo** | El contrapeso baja frenado a 80–120 mm/s. Cualquier suceso que empuje la botavara hacia el reposo **más deprisa que eso** —la persona girándose encima, mover el aparato con la mano, transportarlo— deja el cordón **flojo** sobre un tambor de Ø140 sin pestañas. Un cordón flojo de Dyneema (escurridiza) salta la garganta, se monta sobre la vuelta anterior o se mete entre el tambor y su vecino | **Se pierde el fallo seguro completo.** Si sólo se afloja, no hay sesgo y la botavara se queda donde esté. Si además se agarrota entre el tambor y una cara vecina, la botavara queda **bloqueada** sobre la piel. **El cordón secundario redundante NO cubre esto**: sólo cubre la rotura, y sigue flojo con sus 2 mm | 5 | 3 | 4 | **60** | **(a)** Garganta del tambor con **dos pestañas de contrachapado de 4 mm**, 3 mm más altas que el diámetro del cordón, a los dos lados: el cordón no puede salirse aunque quede flojo. **(b)** **Guía de retención**: una arandela o un pasador de M3 a 2 mm de la garganta, en el punto de salida tangencial, que capture el cordón. **(c)** Una sola capa de arrollamiento: 105 mm sobre Ø140 son 0,24 vueltas, así que **el cordón nunca se monta sobre sí mismo si la garganta es de una sola calle**. **(d)** Comprobación **antes de cada sesión** añadida a la etiqueta A: *"el cordón del contrapeso, tenso y en su garganta"*. **(e)** Homing: si el cordón se salió, la botavara no llega al reposo y el firmware se niega a arrancar | 5 | 1 | 2 | **10** |
| **F-35** | **Colocación con la piel POR ENCIMA de la banda de flotación de cabeceo** | Mesilla más baja que el colchón, extremidad **apoyada sobre una almohada o un cojín**, persona que duerme sobre un colchón muy blando y se hunde menos de lo previsto | La flotación es de **±25 mm con k_tip = 0**. Si la piel obliga a la botavara a subir más de 25 mm, **la charnela topa** y la botavara pasa a ser rígida. A partir de ahí la fuerza normal ya **no** es un lastre de latón: es la interferencia geométrica contra la estructura de una máquina de 2,26 kg, y puede llegar a varios newton sobre 2120 mm². **Es el único escenario en que la frase "400 mN es el máximo físicamente posible" deja de ser cierta**, y el propio contrato numérico lo insinúa al admitir un transitorio de 580 mN ante un desplazamiento de 30 mm — que ya topa la flotación | 4 | 3 | 4 | **48** | **(a) Se declara en §0.3 que el techo de 400 mN tiene una PRECONDICIÓN**: la piel debe quedar dentro de la banda de ±25 mm de flotación. **(b) Tope superior de cabeceo BLANDO**: taco de silicona o espuma EVA de 5 mm en el tope, para que la subida de fuerza sea progresiva y no un impacto rígido. **(c) Galga de altura** de cartón: se apoya en la base, y su marca superior es la altura de piel correcta. **(d) Regla escrita en las etiquetas A y B: la extremidad se apoya en el colchón, NUNCA sobre una almohada, un cojín ni un brazo doblado.** **(e)** La comprobación de 41 ± 2,5 g de la báscula se repite **en el sitio real de uso**, no sólo en la mesa de trabajo | 4 | 1 | 2 | **8** |
| **F-36** | **Sobretensión en VBUS**: cargador averiado, cargador equivocado (fuente PD/portátil de 9, 12 o 20 V), o alguien alimenta el aparato por un jack de 12 V | El aparato no tiene **ni fusible, ni polyfuse, ni TVS, ni diodo de bloqueo** en la entrada de 5 V | **El "techo de hardware" del calefactor escala con V²**: 0,208 W a 5 V son **0,675 W a 9 V** (ΔT = 57 K → férula a 77 °C) y **1,20 W a 12 V** (ΔT = 102 K). El argumento de §9.2 —*"no hay ninguna vía por la que entre más potencia"*— **supone que VBUS son 5,00 V y no lo dice**. Quemadura por contacto y riesgo de ignición junto a ropa de cama | 4 | 2 | 4 | **32** | **(a)** **TVS de 5,6 V (SMBJ5.0A) + polyfuse de 1,1 A** en la entrada, 0,60 €. Recorta la sobretensión y abre el raíl. **(b)** Los **dos KSD9700 NC de 45 °C** ya especificados son la barrera térmica real y **cubren este caso**: se dice explícitamente, porque hasta ahora se justificaban sólo como defensa en profundidad. **(c)** El comparador de brownout se amplía a **ventana**: dispara el latch por debajo de 4,60 V **y por encima de 5,50 V**. **(d)** Etiqueta: *"5 V USB solamente. Nunca una fuente de portátil ni un jack de 12 V."* **(e)** Se corrige §9.2 y §0.3 para que el techo se escriba como **"0,2083 W siempre que VBUS = 5 V"** | 4 | 1 | 2 | **8** |
| **F-37** | **Botavara inmovilizada por el propio cuerpo o enganchada en la ropa de cama, ya desenergizada** | La persona se gira y **atrapa la botavara bajo el brazo, el costado o el muslo**; o las cerdas se enganchan en un botón, un encaje, una costura o una etiqueta del edredón | El contrapeso da 247 mN·m sobre un radio de 0,300 m = **0,82 N en la punta**. Eso **no puede levantar una extremidad** ni desenganchar un botón: la brocha se queda sobre la piel **hasta que la persona se mueva sola**. Es el camino a "brocha sobre la piel toda la noche" que **ninguna capa eléctrica cubre**, porque las seis funcionan correctamente y aun así no pasa nada | 3 | 4 | 3 | **36** | **Se acepta explícitamente y se argumenta por qué es benigno, en vez de fingir que está cerrado:** la máquina **no aporta ni un newton** a esa situación — la carga es el propio cuerpo de la persona, exactamente igual que si se durmiera sobre su propio brazo, y la fuerza de la máquina en esa condición es **cero** (el motor está muerto y el contrapeso tira en la otra dirección). Mitigaciones que sí reducen P: **(a)** botavara lisa y forrada de termorretráctil, **sin ganchos, ranuras ni cabezas de tornillo**; **(b)** regla de extremidad **descubierta y mecanismo fuera del edredón**; **(c)** el microrruptor de integridad detecta que no se llega al reposo y termina el ciclo a los ≤ 3,75 min; **(d)** la brocha se lava semanalmente, así que un cabezal enganchado no es un cabezal sucio contra la piel; **(e)** etiqueta: *"si te despiertas con el brazo atrapado, apártalo: la máquina está apagada y no tira de ti"* | 3 | 3 | 2 | **18** |
| **F-38** | **Pieza pequeña suelta ingerida** por un niño o una mascota | Se cae el **imán N42 de 10 × 3 mm** (supresor de resonancia), el **lastre de latón de 40 g**, un **tope M4**, la brida del cabezal o el propio cabezal, al manipular o al transportar | El informe de investigación lo marca explícitamente (peligro 16) y **el FMEA original no lo recogía**. Dos imanes de neodimio ingeridos perforan intestino; el cilindro de piezas pequeñas de la CPSC es de 31,7 × 57,1 mm y **el imán, el lastre y los tornillos pasan por él** | 5 | 1 | 3 | **15** | **(a)** El imán N42 va **encapsulado en epoxi dentro de la columna**, bajo la tapa atornillada: no puede separarse ni caerse. **(b)** El lastre de latón lleva **prisionero con punta de nailon y marca testigo**; se comprueba mensualmente (F-14). **(c)** Los topes M4 son **cautivos en agujeros ciegos**: aflojados del todo, no se salen (F-09). **(d)** El cabezal kabuki de 60 mm **supera el cilindro de piezas pequeñas**; la brida cortada se tira al momento. **(e)** La contraindicación absoluta de niños y mascotas (§11.2) es la mitigación primaria. **Por la regla de §1.2, S = 5 exige mitigación aunque el RPN sea 15** | 5 | 1 | 1 | **5** |
| **F-39** | **Pinzamiento entre el patín de PTFE y la rampa del riel** | El patín converge contra la rampa en la zona 19–34° de cada barrido: es una **holgura que se cierra**, y el informe de investigación prohíbe expresamente cualquier holgura accesible que se cierre en la banda **5–25 mm** | Un dedo, una oreja, un pliegue o un mechón apoyados sobre la rampa en el instante en que llega el patín. Pellizco, y una **V convergente** que es la geometría clásica de arrastre de pelo y tela | 2 | 2 | 3 | **12** | **(a) Tapa de contrachapado sobre las dos rampas**, dejando sólo una ranura de paso de **≤ 8 mm** para la botavara: la holgura que se cierra queda **por debajo de 4 mm y es inaccesible**, que es la regla del informe. **(b)** Cantos de entrada de las rampas **redondeados a R ≥ 3 mm**, nunca en cuña. **(c)** La fuerza normal sobre el riel es de **1,066 N** y la tangencial de 0,58 N: un dedo atrapado no puede aplastarse. **(d)** El ensayo del mechón de pelo (§6.3) **añade un sexto punto: la entrada de las dos rampas**, 3 minutos cada una | 2 | 1 | 1 | **2** |


### 2.1 Lectura del FMEA en una frase

**Todos los riesgos residuales reales de esta máquina son mecánicos y silenciosos, y son CUATRO, no dos: que el amortiguador se agarrote abajo (F-01), que el pistón se pegue arriba (F-33), que el cordón del contrapeso se rompa (F-07) y que ese cordón se descarrile del tambor tras quedar flojo (F-34).** Los cuatro anulan el fallo seguro completo, los cuatro son invisibles hasta que hacen falta, y ninguno tiene una capa eléctrica que lo pueda suplir — porque el sesgo del contrapeso **es** lo que las capas eléctricas activan. Y hay que decir una cosa incómoda: **el cordón secundario redundante sólo cubre uno de los cuatro** (la rotura). No cubre el descarrilamiento, ni el agarrotamiento abajo, ni el pegado arriba. Por eso la prueba de caída libre semanal (§15.2) —que **a partir de ahora se hace desde el tope lejano de −43°, no desde +30°**, para que recorra el tubo entero— es la única mitigación que los cubre los cuatro, y es la comprobación más importante del aparato.

### 2.2 TODOS LOS CAMINOS HACIA "LA BROCHA SE QUEDA SOBRE LA PIEL TODA LA NOCHE"

Ésta es la pregunta que decide el aparato, y hasta esta revisión **no estaba contestada de forma exhaustiva en ningún sitio**: había mitigaciones sueltas, pero no una enumeración cerrada. Aquí está, y se enumera de la única forma que demuestra algo: **partiendo del efecto y recorriendo hacia atrás todas sus causas posibles**.

Para que la brocha siga sobre la piel hace falta **exactamente una** de estas tres cosas: **(A)** que el motor siga sujetando; **(B)** que el contrapeso no pueda tirar; **(C)** que algo distinto del motor esté sujetando la botavara.

```
   BROCHA SOBRE LA PIEL TODA LA NOCHE
     |
     +-- (A) EL MOTOR SIGUE SUJETANDO  (necesita VMOT vivo Y bobinas en baja Z)
     |     A1  firmware colgado con bobinas vivas ......... CERRADO  charge pump, 141 ms (F-04)
     |     A2  freewheel = 10 u 11 (freno magnetico) ...... CERRADO  freewheel=01 obligatorio, ensayo 3.1 (F-02)
     |     A3  temporizador de firmware que no dispara .... CERRADO  TPL5010 a 1020 s (C4)
     |     A4  MCU en reset / muerto / desoldado .......... CERRADO  EN con pull-UP -> driver deshabilitado; y sin bombeo, VMOT muere
     |     A5  Q1 en corto (VMOT permanentemente vivo) .... PARCIAL  ver abajo, es el unico fallo unico electrico
     |     A6  fin de ciclo normal con Q1 en corto ........ CERRADO  el firmware pone freewheel=01: alta Z, el contrapeso gana
     |
     +-- (B) EL CONTRAPESO NO PUEDE TIRAR
     |     B1  piston agarrotado ABAJO ................... CERRADO  purga en la tapa, ranura de fuga, prueba semanal (F-01)
     |     B2  piston pegado ARRIBA contra la tapa ....... >>> ERA UN AGUJERO <<<  ahora F-33
     |     B3  tendon del contrapeso roto ................ CERRADO  cordon secundario redundante (F-07)
     |     B4  cordon descarrilado del tambor tras aflojarse >>> ERA UN AGUJERO <<<  ahora F-34
     |     B5  el peso apoya en algo antes de llegar al tope  CERRADO por F-33(a): recorrido util >= 105+20 mm, y fondo abierto
     |     B6  rozamiento del riel subido (fieltro sucio) . CERRADO  margen 1,37x, limpieza trimestral, prueba de caida libre
     |     B7  detente real mayor que el medido .......... CERRADO  §5.4 obligatorio y tabla §5.5; margen 1,4x sobre lo MEDIDO
     |
     +-- (C) ALGO DISTINTO SUJETA LA BOTAVARA
           C1  cuerpo de la persona encima de la botavara . ABIERTO Y BENIGNO  -> F-37
           C2  cerdas enganchadas en ropa de cama ......... ABIERTO Y BENIGNO  -> F-37
           C3  edredon encajado en la ranura del yugo ..... ABIERTO  -> F-37 + regla de extremidad descubierta (F-30)
           C4  botavara rota y apoyada sobre la piel ...... BENIGNO  -> el cabezal suelto pesa 18 g y no tiene actuador (F-16)
           C5  piel por encima de la banda de flotacion ... >>> NO ES ESTE FALLO, ES PEOR <<<  -> F-35, anula el techo de fuerza
```

**Los tres caminos que quedan abiertos, dichos sin adornos:**

**1 · A5 — Q1 en cortocircuito drenador-fuente, combinado con un cuelgue de firmware que deje las bobinas vivas.** Q1 es el elemento final compartido por las capas 3, 4 y 5: la bomba de carga, el TPL5010 y el MOTOR_KILL del firmware **actúan todos sobre la misma puerta**. Un Q1 en corto las anula a las tres de golpe. **No es un fallo único** porque quedan dos caminos: el watchdog del RP2040 reinicia el MCU y el `EN` con pull-UP deshabilita el driver **sin pasar por Q1** —que es la razón real por la que la capa 6 no es decorativa, y no estaba escrito—, y S1 corta el cobre aguas arriba. Pero S1 **exige una persona consciente**, que es justo lo que no hay. Respuesta: ensayo semestral de Q1 (VMOT < 0,1 V con el latch disparado), **alimentar el watchdog SÓLO en el bucle principal** (nunca desde una interrupción, o un bucle colgado seguiría alimentándolo), y enchufe conmutado como capa 0.

**2 · B2 y B4 — los dos agujeros mecánicos nuevos (F-33 y F-34).** Eran caminos reales, sin ninguna capa detrás, y por eso son **BLOQUEANTES**: el aparato no se monta hasta que la garganta del tambor tenga pestañas y el tubo tenga tope de pistón, ranura de fuga superior y recorrido verificado. Nótese que **el cordón secundario redundante no cubría ninguno de los dos**: sólo cubre la rotura del cordón, no que se salga ni que el pistón se pegue.

**3 · C1/C2/C3 — la persona o la ropa de cama inmovilizan la botavara (F-37).** Este camino **no se puede cerrar y no se va a fingir que sí**. Un contrapeso que da 0,82 N en la punta no levanta un brazo dormido ni desengancha un botón. Lo que sí se puede demostrar es que es **benigno**: en ese estado la máquina está desenergizada, el contrapeso tira en la dirección de retirada, y **la fuerza que la máquina aporta a la piel es cero**. La carga es el propio cuerpo, exactamente como dormirse sobre el propio brazo. Es la misma clase de riesgo que un pijama arrugado, y se acepta como tal.

> **Conclusión honesta:** de los quince caminos, **doce están cerrados por construcción**, **dos lo están a partir de esta revisión** (F-33 y F-34, que antes estaban abiertos), y **tres se aceptan como abiertos-y-benignos** porque en ellos la máquina no aporta fuerza. El cuarto, F-35, no es un camino a "brocha sobre la piel" sino algo peor —anula el techo de fuerza— y por eso lleva mitigación propia y regla de colocación nueva.

---

<a name="3"></a>
## 3. FICHAS AMPLIADAS DE LOS DIEZ MODOS DE MAYOR RPN

### F-01 · El contrapeso atascado — RPN 75, el más alto de la máquina

```
   EL MECANISMO, EN SECCIÓN (dentro de la columna)

        tambor r = 70 en el eje de barrido
             .-----.
           .' ##### '.
          |     O     |
           '. ##### .'
             '--|--'
                |  cordon principal 0,4 mm Dyneema
                |  + CORDON SECUNDARIO con 2 mm de holgura   <-- F-07
               (o) polea 623ZZ, radio de garganta >= 3 mm
                |
        ________|________
       |        |        |   tubo PVC 25 mm ID, VERTICAL
       |   [ TAPA ]      |   <-- PURGA DE 0,5 mm AQUI, en la tapa rigida
       |        |        |       (NO en el piston: el fieltro la obstruye)
       |   ,---------,   |
       |   | PISTON  |   |   espuma D24 + una vuelta de fieltro adhesivo
       |   |  360 g  |   |   holgura radial nominal 0,5 mm
       |   '---------'   |
       |        |        |
       |        |        |   ranura de fuga 0,5 x 0,5 mm en los
       |        |        |   ULTIMOS 15 mm  --->  ||   el piston nunca
       |________|________|                         ||   cierra contra el fondo
                |                                  ||
             fondo ABIERTO, tapado con fieltro
             (si el fondo es estanco, el tubo se vuelve
              un muelle neumatico y el fallo seguro muere)
```

**Por qué es el peor modo de la máquina.** Todas las demás capas de seguridad terminan en la misma frase: *"...y entonces el contrapeso retira la brocha"*. Si el contrapeso no puede bajar, esa frase deja de ser cierta **para las seis capas a la vez**. Es el único fallo de modo común del sistema, junto con F-07.

**Los cuatro mecanismos concretos de agarrotamiento, y su antídoto:**

| Mecanismo | Cómo ocurre | Antídoto de diseño |
|---|---|---|
| Purga obstruida | Pelusa de fieltro del propio pistón migra al orificio de 0,5 mm | La purga va en la **tapa rígida** del tubo, no en el pistón, y mira hacia arriba. La pelusa cae, no sube |
| Pistón hinchado | La espuma absorbe humedad ambiente y crece 2–3 % | Espuma Ø24 en tubo Ø25 = **0,5 mm de holgura radial nominal**, más de lo que puede crecer. Una sola vuelta de fieltro adhesivo hace el barrido, no el ajuste |
| Pistón pegado al fondo | Baja hasta el final y la depresión lo mantiene ahí | **Ranura de fuga de 0,5 × 0,5 mm en los últimos 15 mm** del tubo. En esa zona el amortiguador deja de amortiguar, que es exactamente lo que quieres al final del recorrido |
| Tubo con volumen cerrado | Se tapa el fondo "para que no entre polvo" | **El fondo va abierto**, cubierto sólo con fieltro. Está escrito en el montaje. Un tubo estanco convierte el amortiguador en un muelle neumático que empuja hacia arriba |

**Ensayo de aceptación (§15.2, semanal, 20 segundos):** levanta la botavara a mano hasta φ = +30°, suéltala y cronometra. **2–3 s hasta el reposo.** Menos de 1,5 s → el amortiguador ya no frena (F-19, benigno pero ruidoso). Más de 5 s → agarrotamiento en curso: **no se usa esa noche.**

---

### F-02 · Freewheel mal configurado — RPN 60, bloqueante

Éste es el fallo que se cuela por escribir la especificación en lenguaje natural. La spec dice `IHOLD = 0` y añade *"zero standstill current, hum or heat"*. En el TMC2209 **`IHOLD = 0` no es corriente cero**: `CS = 0` es el escalón más bajo de la escala (~30 mA rms) y, lo que importa de verdad, **los puentes siguen en baja impedancia**. Un motor paso a paso con las bobinas cerradas sobre una baja impedancia es un **freno de corrientes inducidas**, y ese freno se opone directamente al contrapeso.

```
   PWMCONF.freewheel   Estado de las bobinas al parar   Efecto sobre el fallo seguro
   ------------------  ------------------------------   ----------------------------
        00              corriente normal IHOLD           el motor SUJETA. Prohibido
        01              ALTA IMPEDANCIA                  <<< EL UNICO ACEPTABLE >>>
        10              cortocircuito por LS             freno magnetico. PROHIBIDO
        11              cortocircuito por HS             freno magnetico. PROHIBIDO
```

**Ensayo 11.24, y es de los que no se saltan:** con el aparato armado y la botavara a φ = 0°, corta VMOT. Con dos dedos, gira el eje del motor. **Debe girar libre, con la sola resistencia del detente.** Si notas un frenado viscoso que aumenta con la velocidad, `freewheel` está mal y el contrapeso está peleando contra un freno que no aparece en ningún presupuesto de pares.

---

### F-03 · El apelmazamiento — RPN 50, y es el fallo que más probablemente sufras

Es el único modo de fallo de esta lista que **ocurrirá con certeza** si no haces nada, y el único cuyo síntoma se interpreta mal de forma sistemática.

```
   LA MECANICA DEL FALLO

   Semana 0:  400 mN  /  2120 mm2  =  0,19 kPa  =  1,4 mmHg   -> CARICIA
   Semana 6:  400 mN  /  1100 mm2  =  0,36 kPa  =  2,7 mmHg   -> "raro"
   Semana 12: 400 mN  /   450 mm2  =  0,89 kPa  =  6,7 mmHg   -> KNISMESIS

   La fuerza NO CAMBIA NUNCA, porque k_tip = 0 y es un lastre de laton.
   Lo que se encoge es la HUELLA. Y nada en la maquina lo mide.
```

**El síntoma se lee al revés.** La persona percibe *"esto se ha vuelto más ticklish, el aparato se está estropeando"*, cuando lo que ha pasado es que la brocha necesita un lavado. Por eso la autocomprobación va **impresa en la base del aparato**, no en un manual:

```
  +---------------------------------------------------------------+
  |  AUTOCOMPROBACION DE LA BROCHA - hazla cada domingo            |
  |                                                               |
  |  1. Bascula de cocina tarada a 0. Ferula VERTICAL.             |
  |  2. Baja hasta 1 g  -> marca la altura de la ferula     (z0)   |
  |  3. Baja hasta 41 g -> marca otra vez                   (z1)   |
  |  4. COMPRESION c = z0 - z1                                    |
  |                                                               |
  |       c = 5,5 a 9,0 mm  ->  OK    (nominal 6,9 mm)            |
  |       c = 5,0 a 5,5 mm  ->  LAVAR ESTA SEMANA                 |
  |       c < 5,0 mm        ->  APELMAZADA. Lavar y repetir.      |
  |                             Si sigue < 5,0 -> CAMBIAR CABEZAL |
  |                                                               |
  |  5. HUELLA: aprieta a 41 g contra un espejo.                  |
  |     El disco de contacto debe medir >= 50 mm de diametro.     |
  +---------------------------------------------------------------+
```

Nominal: `c = 400 mN / 58 N/m = 6,9 mm`. Una brocha apelmazada se comporta como un haz más rígido: `k` sube, `c` baja. Por debajo de 5,0 mm, `k > 80 N/m` y has perdido un tercio de la huella.

---

### F-04 · Cuelgue del firmware con las bobinas energizadas — RPN 48

**Éste es el agujero de la especificación vinculante y merece que se diga sin rodeos.** `final_spec.md` afirma:

> *"FAIL-SAFE BUDGET: bias 247 mN.m vs worst resistance 175 ... Covers hard stop, USB pull, brownout, watchdog, TPL5010 16 min one-shot, **hung firmware**, end of cycle"*

**Es falso para el caso "hung firmware".** El presupuesto de 175 mN·m usa el **detente** del motor (8 × 14,29 = 114 mN·m), que es la resistencia con las **bobinas abiertas**. Con las bobinas **energizadas** a I_RUN 0,337 A la resistencia no es el detente sino el **par de retención**:

```
   Par de retencion del 11HS12-0674S:  70 mN.m a 0,67 A
   A 0,337 A (49 % de la nominal):     ~34,5 mN.m
   Reflejado al sector, x 14,29:       ~493 mN.m           <-- casi 500
   Sesgo del contrapeso:                247 mN.m

   493  >  247.   El contrapeso PIERDE, por un factor de 2.
```

Un firmware colgado que deje las bobinas vivas mantiene la brocha exactamente donde estaba, hasta que dispare el TPL5010 a los 17 minutos. **Quince minutos de brocha inmóvil sobre la piel de alguien dormido** no es catastrófico (0,19 kPa está muy por debajo de los 32 mmHg de cierre capilar), pero es una violación directa del requisito de que el fallo seguro retire la brocha, y perceptualmente deja un objeto muerto sobre la piel.

**La corrección, que ya está en `04-electronica.md` como C-5:** la **charge pump de latido**. GP11 emite una onda cuadrada de 2 kHz generada por hardware (PWM del RP2040, no un bucle de software); dos diodos, 100 nF, 1 µF y 470 kΩ la rectifican a la puerta de Q2. Cinco componentes, ~1 €.

```
   FIRMWARE VIVO      -> GP11 conmuta -> bomba carga -> HB = 6 V -> Q2 ON -> Q1 ON -> VMOT
   FIRMWARE COLGADO   -> GP11 quieto  -> sin bombeo  -> HB cae   -> Q2 OFF -> Q1 OFF -> VMOT muere
   PIN ATASCADO ALTO  -> sin ONDA     -> sin bombeo  -> idem.  <-- clave: un nivel fijo NO bombea
   PIN ATASCADO BAJO  -> idem
   MCU EN RESET       -> GPIO en alta impedancia -> idem
   MCU DESOLDADO      -> idem

   Latencia: 3 tau = 3 x (470 k x 100 nF) = 3 x 47 ms = 141 ms.  Especificado < 250 ms.
```

**Lo que hace especial a esta capa** es que **no existe ningún estado del MCU que la mantenga cerrada**. Un pin atascado en alto no bombea, y un pin atascado en bajo tampoco. Sólo un bucle de firmware **en ejecución** puede mantener el motor vivo. Es la única capa con esa propiedad.

**Ensayo 11.17 y 11.30(c):** desde la consola, ejecuta `while(1);` en pleno golpe con la brocha apoyada en una almohada lastrada a 400 mN. VMOT debe morir en menos de 250 ms y la brocha debe estar fuera de la almohada en 2–3 s.

---

### F-05 · Motor calado en silencio — RPN 48

Esta arquitectura tiene una propiedad acústica excelente que es, a la vez, un problema de detección: **cala sin hacer ruido**. No hay seguidor de leva que se levante y caiga, así que a diferencia de una máquina de leva, PLUMA-R **no tictaquea mientras falla**. Un edredón metido en la ranura del yugo produce silencio absoluto y una brocha parada sobre la piel.

**La detección primaria es el microrruptor de reposo, y su definición hay que precisarla.** La spec dice *"must close once per cycle within commanded time +50%"*, y "ciclo" es ambiguo: hay 64 golpes por sesión, pero **el reposo está a +43° y los golpes normales sólo llegan a ±40°, así que los golpes no pasan por el microrruptor**. La definición operativa (corrección C-10 de `04-electronica.md`) es:

| Visita | Cuándo | Ventana |
|---|---|---|
| 1 | Homing de arranque | 95° de recorrido máximo |
| 2 | Fin del bloque 1 (t ≈ 225 s) | tiempo comandado + 50 % |
| 3 | Fin del bloque 2 (t ≈ 450 s) | ídem |
| 4 | Fin del bloque 3 (t ≈ 675 s) | ídem |
| 5 | Fin del bloque 4 / fin de sesión (t = 900 s) | ídem |

**Latencia peor caso: 3,75 minutos.** Es el tiempo máximo que la brocha puede estar calada sobre la piel antes de que la máquina lo sepa. Se acepta porque durante ese tiempo la fuerza es de 400 mN sobre 2120 mm² y no está pasando nada malo — sólo no está pasando nada bueno.

**Segundo disparo, gratis pero limitado: StallGuard4.** El propio informe de actuadores lo desmonta por debajo de ~10 rpm. A 2,0 cm/s el motor gira a 9,1 rpm, así que **StallGuard no sirve en el extremo bajo de la banda nominal**. Se activa (`TCOOLTHRS = 2000`) y se usa por encima de 3 cm/s. **Ninguna decisión de seguridad descansa sobre él.**

---

### F-06 · Pelo enredado en el husillo T8 del carro — RPN 40, S = 5

Es el **único elemento del lado de la piel capaz de acumular vueltas**, y su motor es el que más par bruto tiene de toda la máquina.

```
   EL CALCULO QUE OBLIGA A LA CUBIERTA

   28BYJ-48 con reductora 1:64, par de salida calado:  hasta 0,30 N.m
   Husillo T8, paso 8 mm, rendimiento ~0,30 (trapecial, sin lubricar)

   F = 2 . pi . T . eta / paso  =  2 x 3,1416 x 0,30 x 0,30 / 0,008
                                =  70,7 N de traccion axial

   Umbral de arrancamiento de un cabello del cuero cabelludo: 50-100 N.
   La conclusion se escribe sola: si el pelo entra, el husillo gana.
```

**La mitigación no es un limitador de par: es una caja.** Todas las holguras de la cubierta del carro **< 1 mm**, forrada de fieltro, encerrando el husillo T8, la tuerca de latón y los dos ejes guía de 6 mm. Es exactamente la regla (b) del informe de investigación: *"total enclosure of every rotating part with all openings <1 mm"*.

**Atenuantes reales, que reducen P pero no S:** `I_HOLD = 0` fuera de los movimientos; husillo retro-conducible (se puede girar a mano); ~10 movimientos de 2,5 s por sesión, es decir **25 segundos de rotación por noche** frente a los 900 s de la sesión; y la dirección alterna. Pero la severidad sigue siendo 5, y por la regla de §1.2 la mitigación es obligatoria aunque el RPN cayera a 10.

**Ensayo obligatorio antes de la primera noche:** sujeta un mechón de pelo largo (o un manojo de hilo de 0,1 mm, que es peor caso) contra la cubierta del carro y contra la raíz del yugo durante un ciclo completo de 15 minutos. **Nada debe ser arrastrado hacia dentro.**

---

### F-07 · Rotura del tendón del contrapeso — RPN 40, S = 5

El segundo fallo de modo común, junto con F-01. El cordón que sostiene el sesgo **es** el fallo seguro.

**Los números de resistencia son cómodos y no es ahí donde está el riesgo:**

```
   Dyneema 0,4 mm trenzada:  carga de rotura ~200 N
   Tension de trabajo:        247 mN.m / 0,060 m = 4,12 N
   Margen:                    48x

   El riesgo NO es la traccion. Es:
     (a) el NUDO. Un nudo en Dyneema reduce la resistencia un 50-70 %
         Y ADEMAS CORRE, porque el material es escurridizo.
     (b) la ABRASION en la garganta de la polea de reenvio.
     (c) el CANTO VIVO del tambor de contrachapado sin redondear.
```

**Mitigaciones incorporadas:**

1. **Sin nudos en el camino de carga.** Gaza cosida con hilo de poliéster encerado, o —más sencillo— **5 vueltas muertas + 3 cotes** sobre un poste liso de M4: la fricción de las vueltas soporta la carga y el nudo sólo evita que se desenrolle.
2. **Polea 623ZZ con radio de garganta ≥ 3 mm** y todos los cantos del tambor redondeados con lija de 240.
3. **CORDÓN SECUNDARIO REDUNDANTE.** Un segundo tramo de la misma Dyneema, del mismo tambor al mismo peso, montado con **2 mm de holgura** para que no comparta carga en operación normal pero la tome íntegra si el principal parte. Coste: 0,20 € y cinco minutos. **Es la única redundancia real de todo el aparato y por eso está aquí.**
4. **Detección:** si el sesgo desaparece, la botavara no llega al reposo → el homing falla en el arranque siguiente → el aparato se niega a funcionar. No es prevención, pero garantiza que el fallo se descubra **antes** de una sesión, no durante.
5. **Inspección mensual** con lupa en tres puntos: salida del tambor, garganta de la polea, amarre al peso. **Sustitución anual incondicional**, cueste lo que cueste (10 m de Dyneema son 3,00 €).

---

### F-09 · Topes de barrido aflojados — RPN 36

La objeción fatal más citada contra la arquitectura ganadora del jurado (PolarStroke) era: *"el gálibo hacia una cara dormida está defendido por dos tornillos M4 que ajusta a las tantas de la noche una persona con sueño"*. PLUMA-R responde con **cuatro barreras**, de las cuales sólo la primera es un tornillo:

```
   BARRERA 1 (tornillo, ajustable):  topes M4 CAUTIVOS en agujeros CIEGOS
                                     del sector de contrachapado.
                                     Aflojados del todo, siguen en el agujero.
                                     No pueden caerse ni liberar el recorrido.

   BARRERA 2 (no ajustable):         la RANURA DEL YUGO de 100 grados en la
                                     tapa de la columna. Para eliminarla hay
                                     que desmontar la maquina entera.

   BARRERA 3 (no ajustable):         OREJAS de contrachapado en los dos
                                     extremos de las rampas. El patin no
                                     puede abandonar el riel por el extremo.

   BARRERA 4 (firmware):             el homing se niega a arrancar si no
                                     encuentra el microrruptor de reposo
                                     dentro de 95 grados de recorrido.

   Ninguna de las cuatro depende de que alguien apriete nada esta noche.
```

---

### F-12 · El calefactor de la taza — RPN 24, pero con una corrección importante

Ver §9.3 y la corrección **C-13** en §14. Resumen: con R17 = 47 Ω el régimen permanente de la taza sería de **58 °C**, muy por encima del límite de 40 °C para superficie que puede tocar piel y del de 50 °C para superficie que puede tocar ropa de cama; y con el plazo REAL del one-shot (1 020 s, no 960) el transitorio ya llega a **40,3 °C a 24 °C de ambiente**, es decir tampoco salva. **Por eso R17 = 120 Ω (0,208 W) es el valor de proyecto y no una variante**: techo de hardware en T_amb + 14,8 K, sin depender de ninguna capa de seguridad.

**Ésa es una dependencia entre una función de confort y una capa de seguridad, y hay que escribirla para que nadie la rompa "mejorando" el diseño:**

> ⚠️ **El calefactor de la taza se alimenta de VMOT y JAMÁS de VBUS** *mientras R17 sea de 47 Ω*: en el raíl permanente el techo pasa de 35,6 °C a 58 °C y se convierte en una quemadura. **Con el R17 = 120 Ω del BOM final** el techo permanente es T_amb + 14,8 K = 34,8 °C, así que la alimentación desde el raíl continuo pasa a ser admisible y la taza puede estar lista desde el momento de enchufar. Se mantiene VMOT por defecto como defensa en profundidad.

---

### F-16 · La persona se gira encima — RPN 24

No es un accidente: es un suceso **esperado**. La cadena de cesión tiene tres etapas y hay que conocerlas para no asustarse:

```
   ETAPA 1   Flotacion de cabeceo, +/-25 mm, k_tip = 0
             La botavara SUBE 25 mm sin que la fuerza cambie NADA.
             Coste: 0 N adicionales. Absorbe respiracion, giros lentos,
             y buena parte de un cambio de postura.

   ETAPA 2   Fusible de GRP de 2 mm, k = 70 N/m
             Se dobla 20 mm a 1,4 N;  40 mm a 2,8 N.
             Coste: nada se rompe. Se recupera solo.

   ETAPA 3   Rotura del tubo de carbono de 4 mm
             Ocurre por encima de ~20 N. La maquina no puede generarla:
             la genera el cuerpo de la persona.
             >>> POR ESO TODA LA BOTAVARA VA FORRADA CON MACARRON
             >>> TERMORRETRACTIL DE PUNTA A PUNTA: una rotura no puede
             >>> producir una astilla libre de carbono ni de fibra de vidrio.
```

**Regla escrita, y va en la etiqueta:** *brazo doblado o roto = el aparato no se usa hasta sustituirlo*. No es sólo por la astilla: el momento estático `4785 g·mm` depende de la geometría del brazo, y un brazo deformado cambia la fuerza de contacto sin avisar.

---

<a name="4"></a>
## 4. LAS CAPAS DE PARADA

### 4.0 Son SEIS, no cinco, y la que falta en el guion es la decisiva

El guion de este documento pide cinco capas: contrapeso, pulsador NC, TPL5010, temporizador de firmware y watchdog. **Ese conjunto tiene un agujero**, y es el que se demuestra en F-04: entre "el firmware se cuelga" y "el TPL5010 dispara a los 16 minutos" no hay nada, porque el contrapeso pierde 2 a 1 contra unas bobinas energizadas. La **charge pump de latido** se inserta como capa 3 y es la única que cubre ese hueco.

```
 ORDEN DE INDEPENDENCIA  (de mas independiente a menos)

 CAPA 1  CONTRAPESO MECANICO ............. cero electronica, cero semiconductores
 CAPA 2  PULSADOR NC EN EL COBRE ......... cero semiconductores, cero firmware
 CAPA 3  CHARGE PUMP DE LATIDO ........... semiconductores, cero firmware "correcto"
 CAPA 4  TPL5010 ONE-SHOT 1020 s ......... semiconductores + reloj propio, cero codigo
 CAPA 5  TEMPORIZADOR DE FIRMWARE 900 s .. codigo + reloj de cristal
 CAPA 6  WATCHDOG DEL RP2040 A 2 s ....... codigo + reloj + el propio nucleo

 REGLA DE DIRECCION, y es la que hace que el conjunto funcione:
 TODAS las capas 2 a 6 actuan de la misma manera: CORTANDO VMOT.
 Y cortar VMOT es el estado seguro, porque entonces actua la CAPA 1.
 Es decir: cualquier fallo de cualquier capa electronica que la haga
 "fallar" produce un corte de VMOT, no un fallo peligroso.
 El unico fallo peligroso posible es que algo MANTENGA VMOT vivo.
```

### 4.1 CAPA 1 — Contrapeso mecánico de 360 g sobre tambor de r = 70 mm

| | |
|---|---|
| **Qué es** | Una masa de acero de 360 g colgando de un cordón de Dyneema que sale tangencialmente de la garganta de r = 70 mm del tambor solidario al eje de barrido |
| **Qué aporta** | Un sesgo **constante** de 0,360 × 9,81 × 0,070 = **247 mN·m** hacia el tope de aparcamiento de +43°, donde la brocha está 11,8 mm en el aire y sobre la propia base de la máquina |
| **De qué depende** | De la gravedad y de que el cordón esté entero. Nada más |
| **De qué NO depende** | De electricidad, de semiconductores, de firmware, de un reloj, de un condensador cargado, de un trinquete, de un solenoide, de un muelle que se pueda fatigar, ni de que nadie haya pulsado nada |
| **Latencia** | 2–3 s de retirada, frenada por el amortiguador neumático a 80–120 mm/s de velocidad de punta |
| **Modos de fallo propios** | F-01 (amortiguador agarrotado), F-07 (cordón roto). **Sus únicos dos modos de fallo son los dos modos de fallo de modo común del sistema entero**, y por eso tienen el RPN más alto del FMEA |
| **Cómo se verifica** | Prueba de caída libre semanal + las 10 pruebas de corte de corriente en 10 ángulos |

**Su independencia es absoluta hacia arriba:** ninguna de las otras cinco capas puede impedir que actúe. Lo único que puede impedirlo es que las bobinas estén energizadas — y de eso se ocupan exactamente las capas 2 a 6.

### 4.2 CAPA 2 — Pulsador enclavable NC en serie con la alimentación del motor

| | |
|---|---|
| **Qué es** | Un pulsador de seta de 16 mm, **enclavable, contacto normalmente cerrado**, insertado **físicamente en la pista de cobre** del raíl de alimentación del motor. No es una entrada de GPIO |
| **Qué aporta** | Corte galvánico de VMOT en el tiempo del contacto (~1 ms) |
| **De qué depende** | De que la persona lo pulse, y de que el contacto no esté soldado |
| **De qué NO depende** | Del MCU, del firmware, del TMC2209, del latch CD4013, de Q1, de Q2, de la charge pump, del TPL5010 ni del reloj de nadie. **Funciona con el microcontrolador desoldado de la placa** |
| **Dónde va** | En la base, en el borde cercano a la cama, con capuchón de silicona grande, encontrable a tientas y a oscuras. Rebordeado 3 mm para que no se pueda pulsar apoyando la mano |
| **Por qué enclavable y no momentáneo** | Porque una persona medio dormida no mantiene un pulsador apretado. Enclavado, se queda cortado hasta que alguien lo desenclave deliberadamente por la mañana |

**Independencia respecto de la capa 1:** la capa 2 no *retira* la brocha; **habilita** que la capa 1 la retire. Son complementarias, no redundantes, y ésa es la relación correcta: la capa mecánica hace el trabajo y la eléctrica quita el obstáculo.

**Independencia respecto de las capas 3–6:** S1 está **aguas arriba de Q1**. Todo lo demás (latch, charge pump, TPL5010, firmware) vive aguas abajo. Si toda la electrónica de seguridad se funde a la vez en el estado "conducir", S1 sigue cortando el cobre.

**Su modo de fallo propio:** contacto soldado en cerrado. **No importa**, porque entonces siguen operativas las cuatro capas que hay aguas abajo. Es el ejemplo de manual de una arquitectura sin punto único de fallo.

### 4.3 CAPA 3 — Charge pump de latido (~1 €, cinco componentes)

| | |
|---|---|
| **Qué es** | GP11 emite 2 kHz **por hardware** (bloque PWM del RP2040, no un bucle). Dos diodos + 100 nF + 1 µF + 470 kΩ rectifican esa onda a ~6 V en el nodo HB, que abre Q2, que tira de la puerta de Q1, que deja pasar VMOT |
| **Qué aporta** | **La única cobertura del caso "firmware colgado con las bobinas energizadas"** (F-04) |
| **Latencia** | 3τ = 3 × (470 kΩ × 100 nF) = **141 ms**. Especificado < 250 ms |
| **De qué depende** | De que el bloque PWM del RP2040 siga oscilando, es decir de que el chip esté vivo y alimentado |
| **De qué NO depende** | **De que el firmware sea correcto.** Y ésta es la propiedad clave |

**El argumento de independencia, que es sutil y merece detallarse.** Un enclavamiento por nivel (un pin en alto habilita el motor) **no** protege contra un firmware colgado, porque un pin atascado en alto es indistinguible de un pin conducido correctamente. Una bomba de carga sólo funciona con **transiciones**:

| Estado del MCU | GP11 | ¿Bombea? | VMOT |
|---|---|:-:|---|
| Firmware sano, bucle corriendo | 2 kHz | Sí | Vivo |
| Firmware colgado en `while(1)` | nivel congelado | **No** | Muere en 141 ms |
| Pin atascado en alto (fallo de silicio) | 3,3 V fijo | **No** | Muere en 141 ms |
| Pin atascado en bajo | 0 V fijo | **No** | Muere en 141 ms |
| MCU en reset | alta impedancia | **No** | Muere en 141 ms |
| MCU desoldado | nada | **No** | Muere en 141 ms |
| Firmware corrupto ejecutando basura | improbable que genere 2 kHz limpios | **No** | Muere en 141 ms |

**No existe ningún estado estático del microcontrolador que mantenga el motor vivo.** Ni el TPL5010 ni el watchdog ni el temporizador de firmware tienen esa propiedad: los tres pueden ser burlados por un pin congelado en el estado equivocado. Por eso esta capa es irremplazable y por eso se reincorpora aunque el guion no la pidiera.

**Independencia respecto de las capas 1 y 2:** total. Actúa sin que nadie pulse nada y sin depender de la gravedad.
**Independencia respecto de la capa 4 (TPL5010):** son ramas distintas de la misma puerta lógica. La charge pump controla Q2 por HB; el TPL5010 controla Q3, que pone HB a masa. Una falla abierta y la otra sigue.

### 4.4 CAPA 4 — TPL5010, one-shot de hardware a 1 020 s

| | |
|---|---|
| **Qué es** | Un temporizador nanopower SOT-23-6 de 35 nA con **oscilador RC propio**, alimentado del raíl conmutado, cuya salida WAKE dispara el latch CD4013 a los **1 020 s = 17 min 00 s**. **No 960 s:** el TPL5010 se alimenta del raíl conmutado, así que su ventana arranca con el pulsador, y `pre-warm 60 s + ciclo 900 s = 960 s` dejaría margen **cero**. 1 020 s devuelve los 60 s de margen de diagnóstico |
| **Qué aporta** | Un plazo absoluto que **no ejecuta código** y **no comparte reloj con nadie** |
| **Precisión** | ±5 a ±10 % (RC interno). Es de sobra: la ventana útil es 900–1100 s |
| **De qué depende** | De su propio oscilador RC y de su propia alimentación |
| **De qué NO depende** | Del cristal del RP2040, del firmware, del bucle principal, de `time_us_64()`, de la charge pump ni del pulsador |

**El argumento de independencia respecto de la capa 5 (temporizador de firmware), en una frase:** *todo lo que mata al temporizador de firmware —un bucle infinito, un puntero desbocado, una pila desbordada, un reloj corrupto, un fallo de flash— **no toca al TPL5010**, porque el TPL5010 no ejecuta código y no comparte reloj.* Y al revés: si el RC del TPL5010 deriva un 30 %, el firmware ya habrá terminado 60 s antes y el TPL5010 nunca llega a disparar.

**Los 60 s de margen son deliberados y son un diagnóstico:**

> **En operación normal el TPL5010 NUNCA dispara.** Si alguna noche notas que la sesión ha terminado con un tirón brusco en vez de con el último golpe suave y la retirada de 2–3 s, **el TPL5010 ha disparado, y eso significa que el firmware se colgó**. Es un síntoma, no una anécdota. Anótalo y revisa el firmware antes de volver a dormir con el aparato.

**Ensayo 11.18:** arma el latch y espera con un cronómetro **sin tocar nada**. VMOT debe morir sola entre 850 s y 1100 s. **Cronométralo; no te fíes de la tabla del datasheet**, porque el RC deriva ±10 % y la resistencia externa puede necesitar ajuste.

### 4.5 CAPA 5 — Temporizador de firmware a 900 s

| | |
|---|---|
| **Qué es** | El ciclo de 15 min 00 s contado por el RP2040 con su cristal, comprobado **en cada iteración del bucle**, nunca con una sola comparación de `millis()` |
| **Qué aporta** | El **final elegante**, que es lo que hace que el aparato sea usable y no sólo seguro |
| **Secuencia de cierre** | (1) no programa más golpes → (2) ejecuta un último golpe firme → (3) retira la brocha en 2–3 s hasta la taza → (4) apaga los dos calefactores → (5) dos parpadeos lentos del LED → (6) **y entonces** pulsa GP10 (MOTOR_KILL) para **matar su propio raíl** |
| **Precisión** | ±0,01 % (cristal) |

**El punto que lo hace una capa de seguridad y no sólo una función:** el paso (6). **El firmware dispara el latch todas las noches.** La salida normal del ciclo usa exactamente el mismo camino que la salida de emergencia. Eso significa que la cadena de seguridad se **ejercita 350 veces al año** en vez de quedarse dormida esperando un fallo que nunca se ensaya. Un enclavamiento que sólo se prueba cuando hace falta no es un enclavamiento, es una esperanza.

**Independencia respecto de la capa 6 (watchdog):** el temporizador de 900 s cuenta hacia adelante y termina; el watchdog cuenta hacia atrás y se realimenta. Un bucle que se cuelga **detiene** la realimentación del watchdog pero **no** detiene el reloj del temporizador. Cubren casos distintos: el temporizador cubre "el firmware funciona pero la sesión acabó"; el watchdog cubre "el firmware no funciona".

### 4.6 CAPA 6 — Watchdog hardware del RP2040 a 2 s

| | |
|---|---|
| **Qué es** | El watchdog integrado en el silicio del RP2040, realimentado en el bucle principal, con plazo de 2 s |
| **Qué aporta** | **Recuperación**, no parada. Reinicia el MCU, rehace el homing y deja el motor apagado esperando una pulsación nueva |
| **Latencia** | 2 s — **ocho veces más lento que la charge pump** |

**Y aquí hay que ser honesto sobre el orden:** el watchdog **no** es la capa que salva a la persona en un cuelgue de firmware. La charge pump actúa en 141 ms y el watchdog en 2 s; para cuando el watchdog reinicia, VMOT lleva 1,86 s muerto y el contrapeso ya está a mitad de la retirada. **El watchdog es la capa de recuperación**: lo que hace es dejar el aparato en un estado limpio y conocido después del incidente, en vez de dejarlo colgado hasta que alguien lo desenchufe.

**Regla firme:** tras un reinicio por watchdog el firmware **nunca reanuda el ciclo**. Arranca en estado PARADO, exige una pulsación deliberada de 300 ms, y si cuenta **3 resets en un minuto se niega a arrancar** y hace tres parpadeos.

### 4.7 Matriz de independencia — la prueba de que ninguna depende de la anterior

Para cada par de capas, la pregunta es: **¿existe una causa única que las tumbe a las dos?**

| | C1 Contrapeso | C2 Pulsador NC | C3 Charge pump | C4 TPL5010 | C5 Firmware | C6 Watchdog |
|---|---|---|---|---|---|---|
| **C1** | — | Sin recurso común: uno es acero y gravedad, el otro es cobre | Sin recurso común | Sin recurso común | Sin recurso común | Sin recurso común |
| **C2** | | — | S1 está **aguas arriba** de Q1/Q2; la charge pump aguas abajo | S1 aguas arriba del latch | Sin recurso común | Sin recurso común |
| **C3** | | | — | Ramas separadas de la misma puerta: HB lo sube la bomba, lo baja Q3 del latch. Un fallo abierto en una no afecta a la otra | La bomba **no depende de que el firmware sea correcto**, sólo de que el PWM oscile | Relojes distintos, plazos distintos (141 ms vs 2 s) |
| **C4** | | | | — | **Oscilador RC propio vs cristal del MCU. No comparten reloj ni código** | Ídem |
| **C5** | | | | | — | Comparten núcleo y reloj. **Son la única pareja con recurso común** |
| **C6** | | | | | | — |

**Ojo: esta matriz compara FUNCIONES, no hardware. Trazando el hardware hasta el final aparecen cuatro recursos compartidos más, y están en §4.9.** Comparando sólo funciones, la única pareja con recurso común es C5–C6 (temporizador de firmware y watchdog): comparten el RP2040, su cristal y su alimentación de 3,3 V. Y precisamente por eso **son las dos capas menos independientes y las dos últimas de la lista**. Todo lo que las tumba a las dos —una caída del 3,3 V, un fallo del cristal, un fallo del propio chip— **detiene la charge pump**, y VMOT muere en 141 ms.

### 4.8 El único fallo que mantiene VMOT vivo, y su respuesta

Recorriendo la cadena hacia atrás: para que la brocha se quede sobre la piel hace falta que VMOT siga vivo. ¿Qué fallo único lo consigue?

```
   Q1 EN CORTOCIRCUITO DRENADOR-FUENTE.
   Anula de golpe:  el latch (C4), la charge pump (C3) y el MOTOR_KILL (C5).
   NO anula:        S1 (C2), que esta aguas arriba, en el cobre.

   -> No es un punto unico de fallo, pero exige una accion humana.
   -> Y si ademas S1 esta soldado en cerrado (doble fallo), la unica
      respuesta que queda es DESENCHUFAR. Por eso la regla 7 pide un
      ENCHUFE CONMUTADO: es literalmente la capa 0.

   ENSAYO SEMESTRAL, 30 segundos:
      Con el latch disparado (sesion terminada), mide VMOT.
      DEBE leer < 0,1 V.  Si lee 5 V, Q1 esta en corto:
      el aparato queda FUERA DE SERVICIO hasta cambiarlo.
```

### 4.9 TRAZADO ADVERSARIAL: los recursos que SÍ se comparten, y que §4.7 no listaba

La matriz de §4.7 responde a *"¿existe una causa única que tumbe a dos capas?"* comparando **funciones**. Trazando en cambio el **hardware** hasta el final, aparecen cuatro recursos compartidos que allí no figuraban. Ninguno convierte la arquitectura en insegura, pero **la frase "seis capas independientes" es demasiado generosa y hay que sustituirla por otra más exacta**.

| Recurso compartido | Quién lo comparte | Qué pasa si falla | Veredicto |
|---|---|---|---|
| **Q1, el P-MOSFET del raíl** | **C3 (charge pump), C4 (TPL5010) y C5 (MOTOR_KILL del firmware)**. Las tres actúan sobre la **misma puerta**: la bomba sube HB, el latch lo baja por Q3, el firmware dispara el mismo latch | Q1 en corto D-S anula **las tres a la vez** (F-31). Quedan **C6** —el watchdog reinicia el MCU y el `EN` con pull-UP deshabilita el driver **sin pasar por Q1**— y **C2**, que exige una persona consciente | **Recurso común real, de tres capas.** No es punto único porque C6 y C2 no pasan por él, pero la matriz de §4.7 lo omitía |
| **El raíl de 3V3** | **C3, C5, C6** y, lo que nadie había escrito, **la resistencia de pull-UP de 10 kΩ del `EN` del TMC2209** | Un colapso del 3V3 (regulador en corto, condensador de desacoplo perforado) deja el `EN` **sin pull-up: flota o cae a masa, y `EN` es ACTIVO A NIVEL BAJO, así que el driver queda HABILITADO** justo cuando el MCU acaba de morir. Lo salva C3: sin MCU no hay bombeo, y VMOT muere en 141 ms | **Aceptable en fallo único, pero hay que decirlo:** el estado seguro del `EN` depende del **mismo raíl** que el MCU. Es la razón por la que C3 no es opcional |
| **La masa común del sistema** | **Todas las capas electrónicas** (C2 a C6): un solo plano de masa, un solo retorno de VBUS | Masa abierta entre la placa del MCU y la del driver: el 3V3 flota, `EN` queda indefinido, **pero también se para la bomba de carga** → VMOT muere. **La rotura de masa es benigna por dirección** | **Compartido, y analizado: falla hacia seguro** |
| **VBUS y su cargador** | **Todas** | Cargador muerto → estado seguro (F-26). Cargador en **sobretensión** → nuevo modo **F-36**, que no estaba | **Compartido. La sobretensión era el hueco** |

> ### LA FRASE CORRECTA, QUE SUSTITUYE A "SEIS CAPAS INDEPENDIENTES"
> **Este aparato tiene UN actuador de seguridad y CINCO habilitadores.** El actuador es el contrapeso (C1): es lo único que **mueve** la brocha fuera de la piel. C2 a C6 no retiran nada — se limitan a **quitarle el obstáculo**, y todas lo hacen del mismo modo, cortando VMOT, tres de ellas por el mismo transistor.
>
> De ahí salen las dos consecuencias que gobiernan el mantenimiento de esta máquina:
> 1. **Cinco habilitadores no compensan un actuador averiado.** Si el contrapeso no puede bajar (F-01, F-33, F-07, F-34), las seis capas funcionan perfectamente y la brocha se queda donde está. **Por eso las cuatro comprobaciones mecánicas semanales y mensuales pesan más que toda la electrónica de seguridad junta.**
> 2. **La redundancia eléctrica real es menor de lo que parece:** ante Q1 en corto quedan C6 (automática, vía `EN`, y ésta es su justificación de existir) y C2 (manual, y la persona está dormida). El ensayo semestral de Q1 no es burocracia: es lo que mantiene tres capas vivas.

---

<a name="5"></a>
## 5. POR QUÉ EL FALLO SEGURO ES MECÁNICO Y NO ELECTRÓNICO

### 5.1 El argumento, y las cuatro alternativas que se descartaron

La pregunta de diseño no era *"¿cómo retiro la brocha?"* sino *"¿qué tiene que seguir funcionando para que la brocha se retire?"*. La respuesta condiciona todo lo demás.

| Solución | Qué tiene que seguir funcionando | Modos de fallo propios | Veredicto |
|---|---|---|---|
| **Muelle precargado con trinquete y solenoide biestable** (Síntesis 3) | El trinquete templado limado a mano, el solenoide, el supercondensador, cinco caminos de disparo discretos, y el propio motor de barrido para rearmarlo | Trinquete atascado, muelle fatigado, supercondensador con fuga, rearme fallido, disparo espurio. **La propia Síntesis 3 admite que un atasco del trinquete a mitad de sesión deja la brocha sobre la piel** | **RECHAZADO.** Es el dispositivo de seguridad más complejo, más ajustado a mano y más propenso a fallo de todo el campo, y está a 25 mm de piel dormida |
| **Supercondensador + lógica discreta** (NE555 + CD4538 + CD4053) | Que el supercondensador tenga carga, que el Schottky no fugue, que el comparador dispare, que la lógica no se cuelgue | Fuga de carga tras meses sin uso, deriva del comparador, latch-up de CMOS | **RECHAZADO.** Con una descarga puramente mecánica no hay nada que la energía almacenada pueda hacer. Ahorra 8 € y una placa |
| **Freno de corrientes inducidas / imán** | Que el imán no se despegue | Es 2–3 órdenes de magnitud demasiado débil: se necesitan 0,245 N·m·s/rad y un N42 de 10×3 mm sobre un disco de 60 mm da ~1e-3 | **RECHAZADO como freno.** Se conserva únicamente como supresor de la resonancia de la botavara |
| **Que el motor retire la brocha al detectar el fallo** | El motor, el driver, el MCU y el firmware. Es decir: **exactamente lo que ha fallado** | Todos | **RECHAZADO por circular.** Pedirle al sistema que falló que ejecute la respuesta al fallo |
| **PESO COLGANDO DE UN CORDÓN** | La gravedad y un cordón entero | F-01, F-07 | **ELEGIDO** |

**La frase que resume la decisión:** *un peso en una cuerda no se puede atascar, no puede perder carga, no se puede rearmar mal y no lo puede desactivar el firmware.* Y sobre todo: **mantener la brocha sobre la piel EXIGE que el motor tire activamente contra el peso.** El estado desenergizado —que es el estado al que llegan todos los fallos— es el estado retirado. Eso no es una mitigación: es una inversión de la carga de la prueba.

```
   LA PROPIEDAD ESTRUCTURAL, EN UN DIAGRAMA

   ARQUITECTURA CONVENCIONAL          PLUMA-R
   ------------------------           -------

   [energia] --> retirar              [energia] --> MANTENER APOYADO
                                                          |
   Si falla la energia,                                   v
   NO se retira.                      Si falla la energia, se RETIRA.
   Hay que ANADIR una capa            El fallo seguro no es una capa:
   para cubrirlo.                     es la DIRECCION del sistema.
```

### 5.2 El presupuesto de pares — y la corrección que hay que aplicarle

**Lo que dice la especificación vinculante:**

> *"bias 247 mN·m vs worst resistance = reflected detent (8 × 14.29 = 114) + max(skin drag 48, rail climb 61) = 175. **Margen 1,41×**"*

**Lo que sale al recalcularlo con la geometría real de la rampa** (`02-mecanica.md` §8.5, corrección C3): los 61 mN·m de trepada corresponden a una pendiente de riel de 10,3°. Pero repartir los 4,42 mm de despegue en los 8° de la zona 26–34° obliga a una pendiente de **11,9°**, y con `N_riel = 1,066 N` y `µ = 0,2` (PTFE sobre fieltro) la trepada real es de **66 mN·m**, no 61.

```
   TREPADA DE RIEL, RECALCULADA

     T_trepada = N_riel x (tan(alpha) + mu) x r_riel
               = 1,066 N x (tan 11,9 + 0,20) x 0,150 m
               = 1,066 x (0,2107 + 0,20) x 0,150
               = 1,066 x 0,4107 x 0,150
               = 0,0657 N.m  =  65,7 mN.m       -> 66, no 61
```

**Presupuesto completo, los cuatro regímenes del barrido:**

| Régimen | φ | Detente reflejada | Arrastre en piel | Trepada de riel | Rozamiento plano | **Resistencia** | Sesgo | **Margen** |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Sobre piel | −19° … +19° | 114 | 48 | 0 | 0 | **162** | 247 | **1,52×** |
| En el taper | 19° … 26° | 114 | 24 | 33 | 0 | **171** | 247 | **1,44×** |
| **Trepando el despegue** | **26° … 34°** | **114** | **0** | **66** | **0** | **180** | **247** | **1,37×** ← **limitante** |
| En la meseta | 34° … 43° | 114 | 0 | 0 | 32 | **146** | 247 | **1,69×** |

> ### ⚠️ CORRECCIÓN AL CONTRATO NUMÉRICO
> **El margen real es 1,37×, no 1,41×, y el peor caso es 180 mN·m, no 175 mN·m.** La diferencia viene de la trepada de riel (66 en vez de 61 mN·m) y es consecuencia directa de repartir 4,42 mm de despegue en 8° de barrido. **1,37× sigue por encima del suelo de 1,3× que exige este FMEA**, así que la arquitectura no cambia. Pero **no queda margen para un detente mayor que el medido**, y por eso el procedimiento de §5.4 es obligatorio y no orientativo.

**Y el detalle que la spec confunde y hay que dejar fijado:** *"contrapeso de 360 g en tambor de 70 mm"*. **70 mm es el RADIO, no el diámetro.**

```
   0,360 kg x 9,81 m/s2 x 0,070 m = 0,247 N.m  =  247 mN.m   <-- CORRECTO
   0,360 kg x 9,81 m/s2 x 0,035 m = 0,124 N.m  =  124 mN.m   <-- si fuera diametro

   El tambor mide Ø140 mm. Lo confirma la coherencia con la sintesis
   rechazada: 320 g x 45 mm = 141 mN.m, que es exactamente lo que la
   spec cita al rechazarla.
```

### 5.3 El margen de accionamiento, que es el otro lado de la misma moneda

Poner más contrapeso no es gratis: el motor tiene que **vencerlo** para llevar la brocha a la piel.

```
   DEMANDA DE ACCIONAMIENTO (hacia el lado lejano)
     = sesgo del contrapeso + arrastre de la brocha
     = 247 + 48  =  295 mN.m en el sector

   CAPACIDAD del NEMA11 11HS12-0674S a I_RUN = 0,337 A
     par de retencion a 0,67 A ......... 70 mN.m
     escalado a 0,337 A (49 %) ......... ~34,5 mN.m
     x reduccion 14,29 ................. 493 mN.m
     x rendimiento del cabrestante 0,85 . 419 mN.m

   MARGEN DE ACCIONAMIENTO = 419 / 295 = 1,42x
   Con una brocha apelmazada (mu 0,7, arrastre 70 mN.m): 419/317 = 1,32x

   >>> El aparato vive entre dos margenes que se mueven en sentidos
   >>> OPUESTOS. Mas contrapeso = mas seguro al fallar, menos margen
   >>> para funcionar. La regla de 1,4x es el punto donde los dos
   >>> se equilibran, y por eso no es un numero arbitrario.
```

**Y la consecuencia benigna, que es lo que hace aceptable un margen de 1,32×:** si el motor se queda corto, **pierde pasos**. Perder pasos aquí no produce ningún suceso sobre la piel: el tendón sólo puede tirar, la fuerza tangencial está limitada a 0,58 N y cualquier error de posición se recoge en aire libre sobre la meseta. El microrruptor no cierra, el ciclo termina y el contrapeso descarga la piel. **La respuesta al fallo del margen de accionamiento es el fallo seguro.**

### 5.4 PROCEDIMIENTO DE VERIFICACIÓN EN CASA — el que decide si el margen existe de verdad

> 🔒 **BLOQUEANTE.** Este procedimiento se ejecuta **antes de comprar el hierro del contrapeso**. Los 360 g de la especificación salen de suponer un detente de 8 mN·m que **no aparece en ninguna hoja de datos del 11HS12-0674S**. No copies el número: mídelo.

**Lo que se mide no es el detente del motor aislado.** Se mide la **resistencia total referida al eje de barrido**, que es exactamente lo que el contrapeso tiene que vencer, y sale mejor así porque incluye el rozamiento del cabrestante, de los rodamientos y del patín sin tener que estimarlos.

**Requisitos previos:** yugo montado, pila de discos, cabrestante y tendón montados, motor conectado al TMC2209 pero **con la alimentación de potencia cortada**. Anota si las bobinas te quedan abiertas o cortocircuitadas, porque un paso a paso con las bobinas cerradas frena mucho más (ver F-02).

```
   MONTAJE DE LA MEDICION

     pila de discos (garganta r = 70)
          .-----.
        .'  ###  '.
       |     O     |------- botavara --------( brocha, SIN lastre de laton )
        '.  ###  .'
          '--|--'
             | hilo, SALIENDO TANGENCIALMENTE de la garganta de r=70
             |
            (o) polea 623ZZ
             |
            [ ] taza de plastico ligera, tarada
             |
             +--- vas echando monedas de UNA EN UNA
                    1 centimo = 2,30 g     2 centimos = 3,06 g
                    5 centimos = 3,92 g    (pesalas si dudas)
```

**Procedimiento:**

| Paso | Acción | Criterio |
|:-:|---|---|
| 1 | Coloca el yugo en **φ = −43°** (el extremo opuesto al aparcamiento) y suéltalo | No debe moverse solo |
| 2 | Añade monedas a la taza **de una en una**, esperando 3 s entre cada una | — |
| 3 | Anota la masa total **m** en el instante en que el yugo empieza a moverse solo | Vacía la taza y repite. Toma la **peor** de tres lecturas |
| 4 | Repite en **10 ángulos**: −43, −34, −26, −19, −10, 0, +10, +19, +26, +34 | Anota los 10. El peor manda |
| 5 | Repite entre −19° y +19° **con la brocha apoyada en una almohada a 400 mN** | Esto añade el arrastre real de piel |
| 6 | Repite el paso 4 **con el amortiguador neumático ya montado** | Añade la estricción del pistón, que ningún cálculo predice |

**Cálculo — y es trivial a propósito, porque la taza cuelga del mismo radio de 70 mm que el contrapeso:**

```
   T_resistencia [mN.m]  =  m [g] x 9,81 x 0,070

   ATAJO QUE ELIMINA LA ARITMETICA:

        MASA DEL CONTRAPESO  =  1,4  x  LA PEOR MASA MEDIDA EN LA TAZA

   Ejemplo:  peor lectura 258 g  ->  contrapeso 361 g.  Asi de directo.
```

**Descomposición diagnóstica (opcional, pero te dice si tienes un problema mecánico):**

| Lectura | Qué contiene | Contraste |
|---|---|---|
| En la meseta (φ = +34°) | detente reflejada + rozamiento plano | ÷ 14,29 ≈ el detente del motor. Contrástalo con la tabla §5.5 |
| En el despegue (φ = +30°) | lo anterior + trepada de riel | La diferencia con la meseta es tu trepada **real**. Compárala con los 66 mN·m calculados |
| Sobre piel (φ = 0°) | detente + arrastre de brocha | La diferencia con la meseta es tu arrastre **real**. Compárala con los 48 mN·m |

> 🚩 **Bandera roja:** si la lectura varía **más de un 40 %** entre ángulos, hay algo mecánicamente mal — rodamientos de barrido precargados, tendón montado sobre sí mismo, patín arrastrando en la zona sin riel, cables sin bucle coaxial. **Arréglalo antes de comprar hierro.** Añadir peso para tapar un rozamiento parásito es la forma más cara y más peligrosa de resolverlo, porque el mismo rozamiento también se come el margen de accionamiento.

### 5.5 QUÉ HACER SI EL DETENTE MEDIDO ES 12 mN·m EN VEZ DE 8

Es la pregunta correcta, porque es el escenario que la propia síntesis identifica como el que puede tumbar la arquitectura. **Con 12 mN·m y un contrapeso de 360 g el margen sobre piel cae a 1,03× y la brocha se pararía a mitad de la piel.** La respuesta no es "aceptarlo": es la tabla siguiente.

| Detente medido T_d | Reflejado ×14,29 | + trepada 66 | **Resistencia** | Sesgo necesario ×1,4 | **Masa (tambor r = 70)** | **Longitud de barra Ø25 acero** | I_RUN necesaria |
|---:|---:|---:|---:|---:|---:|---:|---|
| 4 mN·m | 57 | 123 | 123 | 172 | **251 g** | 65 mm | 0,33 A |
| 6 mN·m | 86 | 152 | 152 | 212 | **309 g** | 80 mm | 0,33 A |
| **8 mN·m** *(supuesto de la spec)* | **114** | **180** | **180** | **252** | **368 g** | **96 mm** | **0,33 A** |
| 10 mN·m | 143 | 209 | 209 | 292 | **426 g** | 111 mm | **0,40 A** |
| **12 mN·m** | **172** | **238** | **238** | **332** | **484 g** | **126 mm** | **0,40 A** |
| 14 mN·m | 200 | 266 | 266 | 373 | **542 g** | 141 mm | 0,40 A |
| 16 mN·m | 229 | 295 | 295 | 412 | **601 g** | 156 mm | 0,40 A + revisar margen |

*(Barra de acero Ø25, densidad 7,85 g/cm³ → 3,85 g por mm de longitud. El último gramo se ajusta con arandelas M8 apiladas sobre el tornillo del pistón.)*

**Las CINCO cosas que cambian si mides 12 mN·m, y ninguna es opcional:**

**1 · El contrapeso pasa de 360 g a 484 g.** Barra de acero Ø25 × 126 mm. Coste: ~1,00 € más.

**2 · I_RUN sube de 0,337 A a 0,40 A**, porque el margen de accionamiento se recalcula:

```
   Demanda a 12 mN.m:  sesgo 332 + arrastre 48  =  380 mN.m
   Capacidad a 0,337 A:                             419 mN.m  ->  1,10x  INSUFICIENTE
   Capacidad a 0,400 A:  41,8 x 14,29 x 0,85    =   508 mN.m  ->  1,34x  OK

   Consecuencias de subir a 0,40 A:
     Potencia de bobinas: 2 x 0,40^2 x 5,6 = 1,79 W  (era 1,22 W)
     Margen de chopper: I_pico = 0,566 A -> V_pico = 3,17 V frente a 5 V
       = 1,58x.  Sigue siendo 5 V nativo, pero el margen se estrecha
       (recuerda C-9: el margen se calcula con la CRESTA, no con el rms)
     Temperatura de la columna: 1,79 W sobre 0,0704 m2 de pino con
       h ~ 8 W/m2K = +3,2 K en la superficie exterior. Irrelevante.
```

**3 · El amortiguador neumático hay que reajustarlo.** La velocidad terminal de un amortiguador de orificio escala con la raíz de la fuerza:

```
   v_nueva = v_vieja x sqrt(484/360) = v_vieja x 1,16
   80-120 mm/s  ->  93-139 mm/s        (por encima del techo de 120)

   CORRECCION: taladra la purga a 0,45 mm en vez de 0,50 mm.
   Area x 0,81  ->  velocidad x 0,81  ->  75-113 mm/s.  Dentro.
   Y VUELVE A CRONOMETRAR LA CAIDA LIBRE: 2-3 s desde +30 grados.
```

**4 · La fuerza tangencial hacia el reposo sube.** Contrapeso 1,11 N + motor 1,69 N = **2,80 N** en la punta (era 2,2 N). El fusible de GRP se dobla 40 mm en vez de 20 mm antes de transmitirla. **Sigue por debajo del techo de 1 N... no: lo supera.** Hay que decirlo con claridad: *el techo de 1 N del informe de investigación se refiere a la fuerza NORMAL sobre la piel, que aquí sigue siendo 400 mN por construcción.* La tangencial de 2,80 N actúa **en la dirección que termina sobre la propia base de la máquina**, sobre 2120 mm² de pelo = 1,32 kPa de cizalla, y está limitada por el pandeo del GRP. Se acepta y se documenta.

**5 · El presupuesto de corriente y el cargador.** Pico simultáneo con calefactores: ~0,87 A. Un cargador de 5 V 2 A sigue teniendo 2,3× de margen. **No cambies a un cargador más pequeño.**

> **Y si mides más de 16 mN·m: para.** Tienes un motor distinto del previsto, o un rozamiento parásito que no debería estar. Antes de poner 600 g de acero, revisa rodamientos de barrido precargados, tendón montado sobre sí mismo, patín arrastrando y cables sin bucle coaxial. Un contrapeso de 600 g convierte la retirada en un suceso de energía apreciable y estrecha el margen de accionamiento hasta lo indefendible.

### 5.6 LA PRUEBA QUE CIERRA EL ARGUMENTO — 10 cortes de corriente en 10 ángulos

Todo lo anterior es aritmética. Esto es la prueba.

```
   PREPARACION
     - Maquina completamente montada, con el amortiguador puesto,
       el contrapeso definitivo colgado y la brocha instalada.
     - Almohada lastrada sobre la mesa, brocha apoyada a 400 mN
       (comprueba con la bascula: 41 g).
     - Cronometro.

   PROCEDIMIENTO, x10
     1. Arranca un ciclo.
     2. Cuando el yugo pase por el angulo objetivo, CORTA VMOT.
        Angulos objetivo: -19, -10, 0, +10, +19, +22, +26, +30, +34, +38
        Metodo de corte: alterna entre los tres caminos reales -
           (a) tiron del cable USB
           (b) pulsador S1
           (c) firmware colgado (`while(1);` desde la consola)
     3. Cronometra hasta que el yugo toque el tope de aparcamiento.

   CRITERIO DE ACEPTACION
     >>> LOS 10 LLEGAN AL TOPE, SIN AYUDA, EN MENOS DE 15 SEGUNDOS.
     >>> 10 DE 10. Si falla UNO, anades peso y vuelves a empezar
     >>> desde el ensayo 1. No hay "9 de 10 esta bien".

   LO QUE VERAS, para que no te asustes:
     La botavara arrastra la brocha por hasta 199 mm de almohada a
     unos 3-10 cm/s durante 2-3 s, luego trepa la rampa y se para
     11,8 mm en el aire, sobre la propia base. Se lee como un ultimo
     golpe firme que termina en el aire. Es correcto y es intencionado.
```

---

<a name="6"></a>
## 6. RIESGO DE ENREDO DE PELO

### 6.1 La física: por qué el pelo es un peligro de severidad crítica

El enredo de pelo no es un pellizco: es un **multiplicador exponencial de tensión**. La ecuación del cabrestante (Euler–Eytelwein) dice que una cuerda —o un pelo— enrollada sobre un cilindro multiplica su tensión con el ángulo de abrazamiento:

```
                 T = T0 . e^(mu . theta)

   con mu = 0,3 (pelo sobre metal o sobre plastico) y 3 vueltas
   completas, theta = 3 x 2pi = 18,85 rad:

        T / T0  =  e^(0,3 x 18,85)  =  e^5,65  =  285

   >>> TRES VUELTAS MULTIPLICAN LA TENSION POR ~300. <<<

   Una tension trivial de 0,2 N en el lado flojo se convierte en
   57 N en el cuero cabelludo. El umbral de arrancamiento de un
   cabello esta en 50-100 N, y el de un mechon, mucho mas abajo
   por cabello individual.

   Y el motor NO CALA, porque lo que ve el motor es el lado FLOJO.
```

**Ése es el argumento completo por el que se rechazó el Carrusel.** El Carrusel es un tambor de fibra girando **continuamente** en contacto directo con una persona dormida, y su única defensa contra el enredo era un embrague de fricción de silicona sobre madera cuyo umbral de 41 mN·m **deriva con el polvo y la humedad** y que su autor reconocía que necesita una comprobación mensual con dinamómetro. Un elemento de seguridad que se degrada en silencio entre revisiones es exactamente lo que no puede haber al lado de alguien que va a perder la consciencia. Y con un tambor que gira sin límite, las vueltas **se acumulan**: no hay ningún número de revoluciones que el sistema no pueda alcanzar.

### 6.2 Por qué esta geometría no puede acumular vueltas

La regla estructural del informe de investigación es: *"an OSCILLATING output whose total travel is <360° and which reverses — hair cannot accumulate turns because every winding stroke is followed by an unwinding stroke"*. PLUMA-R la cumple en el eje que toca a la persona, y encierra los que no la cumplen.

| Elemento | ¿Gira? | Recorrido | ¿Puede acumular vueltas? | ¿Accesible desde la piel? |
|---|---|---|---|---|
| **Eje de barrido / sector / yugo** | Oscila | **±43°, total 86°** | **NO.** Cada vuelta de ida se deshace en la vuelta de vuelta | Sí, es el brazo |
| **Charnela de cabeceo** | Oscila | ±6°, pasivo | **NO** | Sí |
| **Cabrestante** | Oscila | ±3,41 vueltas (86° × 14,29) | **Podría, dentro de un solo barrido** | **NO** — dentro de la columna, bajo tapa atornillada, a 400 mm de la piel |
| **Husillo T8 del carro radial** | Gira | 0,63 vueltas por movimiento, dirección alterna, ~25 s totales por sesión | **Podría** | **NO** — dentro de la cubierta forrada de fieltro, holguras < 1 mm |
| **Eje del 28BYJ-48** | Gira | Reductora 1:64 → 40 vueltas por movimiento | **SÍ, y con mucho par** | **NO** — dentro de la misma cubierta |
| **Poleas 623ZZ (tendón, contrapeso)** | Giran | Pocos grados | No relevante | **NO** — dentro de la columna |
| **Brocha** | No gira | — | **NO.** Es un haz de pelo suelto que se desliza | Sí, es lo que toca |

```
   EL DIAGRAMA QUE RESUME LA DEFENSA

   +===========================================================+
   |  COLUMNA DE PINO 18 mm, TAPA DE CONTRACHAPADO ATORNILLADA |
   |                                                           |
   |   [NEMA11]--[tubo silicona]--[CABRESTANTE +-3,41 vueltas] |   TODO LO QUE
   |                                     |                     |   PUEDE ACUMULAR
   |   [polea 623ZZ]---[cordon contrapeso]---[TAMBOR r=70]     |   VUELTAS VIVE
   |                                     |                     |   AQUI DENTRO
   |   [TMC2209] [RP2040] [cadena de seguridad]                |
   +==============================|============================+
                                  |
                       RANURA DEL YUGO 100 deg x 10 mm
                       + LIMPIAPARABRISAS DE FIELTRO ADHESIVO
                                  |
                                  v
   +--- YUGO ---[CUBIERTA DE FIELTRO: husillo T8 + 28BYJ-48]---+
   |            holguras < 1 mm en TODO el perimetro           |
   +-----------------------------|-----------------------------+
                                 |
                    charnela M3 (oscila +/-6 grados)
                                 |
        ===== BOTAVARA: tubo liso, forrado de termorretractil =====
                 sin ganchos, sin ranuras, sin cabezas de tornillo
                                 |
                            [ BROCHA ]  <-- lo unico que toca a la persona
                                            y no gira en absoluto
```

### 6.3 El ensayo obligatorio del mechón de pelo

> 🔒 **BLOQUEANTE antes de la primera noche.**

```
   1. Consigue un mechon de pelo largo (30 cm o mas). Si no lo tienes,
      un manojo de 20 hilos de coser de 0,1 mm es PEOR CASO: mas fino,
      mas flexible y se enreda mejor que el pelo.
   2. Arranca un ciclo completo de 15 minutos.
   3. Durante los 15 minutos, sujeta el mechon con la mano y presiona
      deliberadamente contra, en este orden y 3 minutos cada uno:
        (a) la ranura del yugo en la tapa de la columna
        (b) la raiz del yugo, donde entra el brazo
        (c) el perimetro de la cubierta del carro radial
        (d) la charnela de cabeceo
        (e) la brocha misma
   4. CRITERIO: NADA es arrastrado hacia dentro en ninguno de los cinco.
      Si un solo hilo entra, la holgura de ese punto es demasiado grande.

   >>> Este ensayo se REPITE cada vez que abras la maquina para
   >>> mantenimiento, porque una tapa mal cerrada es una holgura nueva.
```

### 6.4 La regla del pelo largo, que sí es responsabilidad de la persona

**Recógete el pelo largo antes de encender.** El pelo del propio usuario suelto sobre la almohada es la fuente más probable de un incidente, y ninguna cubierta lo cubre si la persona apoya la cabeza sobre la brocha. Es una regla de uso, va en la etiqueta, y se apoya en la regla 2 (nada del aparato alcanza la cabeza): **si respetas la distancia de 475 mm, tu pelo no puede llegar a la máquina.**

---

<a name="7"></a>
## 7. RIESGO OCULAR

### 7.1 Por qué se toma en serio aunque la punta sea un haz de pelo

Un párpado cerrado **no** protege contra una punta rígida, y una persona somnolienta puede tener los ojos abiertos. Una abrasión corneal necesita mucha menos energía que los umbrales de proyectil de juguete, y **la persona está inconsciente: no parpadea, no se aparta y no se defiende**. La ISO/TS 15066 asigna a la cara 65 N de fuerza cuasi-estática máxima y, en la práctica, **excluye el contacto con cabeza y cara del ámbito colaborativo**: es decir, la respuesta normativa al contacto con la cabeza es *"no lo diseñes"*.

Este dosier adopta esa postura: **la mitigación primaria del riesgo ocular no es la punta, es el gálibo.** La punta es la segunda línea.

### 7.2 La geometría de la punta

```
   CORTE LONGITUDINAL DEL CABEZAL (esquematico, escala aprox 1:1)

     <--------------- 60 mm de diametro de penacho --------------->

     ||||||||||||||||||||||||||||||||||||||||||||||||||||||||||     ^
     ||||||||||||||||||||||||||||||||||||||||||||||||||||||||||     |
     ||||||||||||||||||||||||||||||||||||||||||||||||||||||||||   30 mm de
     |||||||||||||||||| PELO DE CABRA SUELTO |||||||||||||||||||   pelo LIBRE
     ||||||||||||||||||||||||||||||||||||||||||||||||||||||||||     |
     ||||||||||||||||||||||||||||||||||||||||||||||||||||||||||     v
    +==========================================================+   ^
    |  FERULA DE SILICONA   [R13 120 ohm]   [NTC 10k]          |   |  la ferula
    |                        30 mm POR DETRAS de las puntas    |   |  esta AQUI
    +==========================================================+   v
                        ||  tubo de silicona + brida
                    ====||====  BOTAVARA (GRP 2 mm, forrada
                                de termorretractil)

    NO HAY NINGUN ELEMENTO RIGIDO EN LOS ULTIMOS 30 mm.
    NO HAY CANUTO, NI RAQUIS, NI ALAMBRE, NI VARILLA.
    Nada metalico, conductor ni caliente puede alcanzar la piel:
    la compresion del pelo a 400 mN es de 6,9 mm, y la ferula
    esta a 30 mm.  Margen 4,3x.
```

### 7.3 La demostración: un pelo de cabra no puede lesionar un ojo

**Argumento 1 — un solo filamento pandea a 11 microNewtons.** Un pelo de cabra tratado como columna empotrada-libre:

```
   d = 70 um     L_libre = 30 mm     E (queratina) = 3,5 GPa

   I = pi.d^4/64 = pi x (70e-6)^4 / 64 = 1,179e-18 m^4

   P_critica = pi^2 . E . I / (4 L^2)
             = 9,8696 x 3,5e9 x 1,179e-18 / (4 x 0,030^2)
             = 4,0728e-8 / 3,6e-3
             = 1,13e-5 N
             = 11,3 microN  =  0,0113 mN

   >>> UN PELO DE CABRA SE DOBLA CON 11 MILLONESIMAS DE NEWTON. <<<
   >>> No puede transmitir fuerza a una cornea. Se dobla antes.  <<<
```

**Argumento 2 — el haz completo trabaja justo en el punto de pandeo, y por eso es suave.** Para sostener 400 mN hacen falta `400 / 0,0113 = 35 400` filamentos trabajando **cada uno en su carga crítica**. Un kabuki de 60 mm tiene del orden de 25 000–40 000 pelos. **La brocha no es blanda por casualidad: está dimensionada para que el haz entero viva en el umbral de pandeo.** Cualquier filamento que reciba más carga que sus vecinos simplemente se dobla y transfiere la carga al de al lado.

**Argumento 3 — la presión de contacto es una décima parte de la presión interna del propio ojo.**

```
   Presion de la brocha:  400 mN / 2120 mm2 = 0,19 kPa = 1,4 mmHg
   Presion intraocular normal:                            10-21 mmHg
   Presion de un parpadeo sobre la cornea:                  1-4 kPa

   >>> La brocha aprieta el ojo SIETE A QUINCE VECES MENOS que la
   >>> propia presion interna del globo, y de tres a veinte veces
   >>> menos que tu propio parpado al parpadear.
```

**Argumento 4 — no hay ningún elemento rígido que pueda llegar.** El requisito del informe de investigación es *"the distal 30 mm must be feather VANE or soft fibre only; the quill/rachis must be cut back and buried inside the holder"*. Aquí se cumple literalmente: **los últimos 30 mm son exclusivamente pelo suelto**. Y el elemento semirrígido más cercano —el brazo de GRP de 2 mm— **pandea a 1,4 N con 20 mm de flecha**, muy por debajo de cualquier umbral de lesión ocular, y termina en la férula de silicona, no en un canto.

### 7.4 Y AUN ASÍ: LA REGLA DE COLOCACIÓN, QUE ES LA MITIGACIÓN PRIMARIA

Los cuatro argumentos anteriores dicen que **si** la brocha llegara a un ojo no lo lesionaría. La regla de colocación dice que **no puede llegar**.

> ### ⚠️ AVISO IMPORTANTE Y CONTRAINTUITIVO
> **El gálibo VERTICAL de esta máquina NO protege la cara.** La especificación dice *"nothing above 260 mm from the base plane"*, y con la base a la altura del colchón el plano de trabajo de la punta queda a ~140 mm sobre el colchón — que es justo la altura a la que está una cabeza sobre una almohada. **La única cosa que impide que el brazo alcance la cabeza es DÓNDE PONES LA MÁQUINA.** No hay tope mecánico que lo garantice, y este documento no va a fingir que lo hay.

```
   LA REGLA DE COLOCACION, EN PLANTA

                              CABEZA
                          .-'''''''''-.
                         (   ALMOHADA  )
                          '-.........-'
                               |
                               |    >= 475 mm  desde el EJE DE BARRIDO
                               |    hasta el punto MAS CERCANO de la
                               v    cabeza o el cuello
        - - - - - - - - - - - - - - - - - - - - - - - - - - -
                     ,-''''''''''''''-,
                  ,-'                  '-,
                 /    DISCO BARRIDO       \      R_max = 325 mm
                |      diametro 650 mm     |     + 60 mm de brocha
                |            O             |     = envolvente Ø710 mm
                 \        eje de           /
                  '-,     barrido       ,-'
                     '-,,,,,,,,,,,,,,-'
                          [ MESILLA ]
                        base NUNCA sobre
                          el colchon

   475 mm = 325 (radio maximo) + 150 (margen de seguridad).
   Se mide con una CUERDA DE 475 mm atada al perno del eje de barrido:
   haz un barrido completo con la cuerda tensa. Si la cuerda toca la
   almohada en algun punto, LA MAQUINA ESTA MAL COLOCADA.
```

**Cómo se materializa la regla, para que no dependa de que alguien la recuerde con sueño:**

1. **Galga de colocación de 475 mm** — y aquí hay una corrección adversarial que hay que hacer, porque la versión anterior de este documento pedía **un cordón de 475 mm atado permanentemente al perno del eje de barrido**, y eso **contradice frontalmente a F-23**: es un cordón flexible de medio metro, con un nudo en el extremo, permanentemente sujeto a un aparato que duerme al lado de una cabeza. Es literalmente la geometría de lazo que F-23 prohíbe *"por construcción"*, y ninguna otra parte del aparato la tiene. **Corregido así:** la galga es **una varilla rígida de 475 mm** (una caña de bambú, un listón de 6 mm o un tubo de PVC de 8 mm), **guardada en el cajón, NO atada a la máquina**. Se apoya sobre el perno del eje y se barre el círculo con ella antes de acostarse; después se retira. Coste 0,20 €, misma función, y **cero cordón junto a la cama**. Si aun así prefieres un cordón, sólo vale uno **suelto, guardado fuera del dormitorio y nunca atado a la máquina**.
2. **Plantilla de papel 1:1** que marca el arco de contacto **completo de 273 mm** (no sólo los 199 mm de fuerza plena) y la obicuidad de colocación. Si sólo marcas los 199 mm, la brocha llega al borde de la extremidad ya a 400 mN — un arranque abrupto, que es el disparador exacto de la knismesis.
3. **Huella de base asimétrica**, de modo que la máquina se apoya de forma natural con el barrido apuntando en la dirección correcta.
4. **Regla de sitio de uso, escrita en la etiqueta:** antebrazo, brazo, muslo exterior, pantorrilla, flanco y —para quien duerme de lado cerca del borde— hombro y espalda alta. **Nunca cabeza, cuello, cara, ni sobre la columna vertebral, ni sobre prominencias óseas (codo, tobillo, clavícula).**

---

<a name="8"></a>
## 8. VUELCO

### 8.1 Por qué importa más de lo que parece

Un aparato de 2,26 kg cayendo 300 mm entrega **6,6 J** a lo que haya debajo. Para comparar: una córnea se lesiona con fracciones de julio y un globo ocular se rompe con unos pocos julios. Y una cama es, por definición, **una superficie blanda, compresible y en movimiento**: la persona que duerme mueve el colchón toda la noche. Por eso la regla 1 no es un consejo:

> ## 🚫 LA BASE NUNCA VA SOBRE EL COLCHÓN.
> Mesilla, silla rígida o tabla apoyada en el somier. **Todos** los modos de fallo de vuelco, arrastre de ropa de cama y cargador-bajo-el-edredón empiezan por romper esta regla, normalmente con la frase *"sólo por esta noche, para probar"*.

### 8.2 Balance de masas y centro de gravedad

Coordenadas: **O** = eje de barrido. **y** positivo hacia la cama (hacia el borde delantero de la base). **z** medido desde la mesa, con los pies de corcho de 6 mm incluidos.

| Elemento | m (g) | y (mm) | z (mm) | m·y | m·z |
|---|---:|---:|---:|---:|---:|
| Base B1, pino 300×200×18 + pies de corcho | 490 | +40 | 15 | +19 600 | 7 350 |
| **Lastre trasero W1** (bloque + 400 g de arandelas) | **460** | **−55** | **8** | **−25 300** | 3 680 |
| Columna de pino 18 mm + tapa + fieltro | 400 | 0 | 124 | 0 | 49 600 |
| NEMA 11 + amortiguador de goma | 110 | 0 | 95 | 0 | 10 450 |
| Contrapeso 360 g + pistón + tubo PVC | 400 | 0 | 70 | 0 | 28 000 |
| Pila de discos, perno M8, 2× 608ZZ, cabrestante | 120 | 0 | 190 | 0 | 22 800 |
| Electrónica, cableado, pulsadores | 60 | 0 | 60 | 0 | 3 600 |
| Rampas P1/P2 + pedestales | 120 | +130 | 80 | +15 600 | 9 600 |
| Botavara + charnela + carro + lastre + brocha (en reposo, φ = +43°) | 101 | +160 | 210 | +16 160 | 21 210 |
| **TOTAL** | **2 261** | | | **+26 060** | **156 290** |

```
   y_CdG = 26 060 / 2 261 =  +11,5 mm   (11,5 mm hacia la cama desde el eje)
   z_CdG = 156 290 / 2 261 =  69,1 mm   (ALTURA DEL CENTRO DE GRAVEDAD)
```

> **Nota honesta sobre la masa.** La especificación dice *"MASS 2.0 kg total"*. Sumando pieza a pieza salen **2,26 kg**. La diferencia es del 13 % y **no cambia ninguna conclusión de seguridad** (más masa = más estable), pero afecta a la afirmación de que "se mueve con una mano": se mueve, pero pesa lo que pesa. Se documenta como corrección menor C-16 en §14.
>
> **Y esta tabla es deliberadamente la COTA INFERIOR, no la masa de proyecto.** Lleva sólo los **460 g** de W1, que es el lastre mínimo antivuelco, y pino a 0,45 g/cm³. La especificación exige además una **base lastrada a 1,6 kg**, es decir **1 038 g de lastre** (línea A-27 del BOM), con lo que la masa de proyecto es **3,06 kg** (`03-bom.md` §12.4). Se usa aquí la cota inferior a propósito: **menos masa = menos fuerza de vuelco = peor caso**, y es sobre ese peor caso sobre el que hay que demostrar los 5 N de §8.3. Con la base completa a 1,6 kg todas las fuerzas de vuelco **suben**. Las dos cifras describen la misma máquina.

### 8.3 Fuerza necesaria para volcarlo

Se vuelca girando alrededor del canto correspondiente de la base. Empuje horizontal aplicado en **lo alto de la columna, z = 224 mm** (el punto más desfavorable al que llega una mano).

```
   CANTO DELANTERO (hacia la cama), y = +140 mm
     brazo:  d = 140 - 11,5 = 128,5 mm
     momento resistente = 2,261 x 9,81 x 0,1285 = 2,850 N.m
     F_vuelco = 2,850 / 0,224 = 12,7 N        <-- 2,5x el minimo de 5 N
     angulo de vuelco = atan(128,5 / 69,1) = 61,7 grados

   CANTO TRASERO (lado contrario), y = -60 mm
     brazo:  d = 11,5 + 60 = 71,5 mm
     momento resistente = 2,261 x 9,81 x 0,0715 = 1,586 N.m
     F_vuelco = 1,586 / 0,224 = 7,1 N         <-- direccion mas debil
     angulo de vuelco = atan(71,5 / 69,1) = 46,0 grados

   CANTO LATERAL, x = +/-150 mm
     brazo:  d = 150 mm
     momento resistente = 2,261 x 9,81 x 0,150 = 3,327 N.m
     F_vuelco = 3,327 / 0,224 = 14,9 N
     angulo de vuelco = atan(150 / 69,1) = 65,3 grados
```

**Sin el lastre W1** (m = 1 801 g, y_CdG = +28,5 mm, z_CdG = 84,7 mm):

```
   CANTO DELANTERO:  d = 111,5 mm -> F = 8,8 N   (era 12,7)
   CANTO TRASERO:    d =  88,5 mm -> F = 7,0 N
   angulo delantero: atan(111,5/84,7) = 52,8 grados
```

### 8.4 Contraste con `02-mecanica.md`, y por qué la discrepancia importa

`02-mecanica.md` §3.1 da **4,5 N sin lastre y 9 N con lastre**. El cálculo de arriba da **8,8 N y 12,7 N**. La diferencia (factor ~1,7) viene de las hipótesis de reparto de masa y de la altura del punto de empuje, que no están explicitadas allí.

**No intento decidir cuál es la buena. La conclusión de seguridad es la misma en las dos y es ésta:**

| | `02-mecanica.md` | Este documento | Mínimo exigido por el FMEA |
|---|---:|---:|---:|
| **Sin lastre W1** | **4,5 N** ❌ | 8,8 N ✔ | **5 N** |
| **Con lastre W1** | 9,0 N ✔ | 12,7 N ✔ | **5 N** |

> **Con el análisis más conservador de los dos, la máquina SIN el lastre trasero NO cumple el mínimo de 5 N.** Por tanto:
>
> ## ⚠️ EL LASTRE W1 DE 400 g ES UNA PIEZA DE SEGURIDAD, NO UN ACCESORIO ACÚSTICO.
> Aparece en `02-mecanica.md` como carga másica para bajar el modo fundamental del tablero. **También es lo que impide que el aparato vuelque hacia la cama.** No se omite, no se reduce y no se sustituye por "algo pesado que tenía por casa" sin volver a pesar.

**Y como los dos cálculos discrepan, el criterio real es un ENSAYO, no una cuenta:**

```
   ENSAYO DE VUELCO, 2 minutos, con un peso de cocina o un dinamometro
   de maleta atado con un cordel:

   1. Maquina completa, montada, sobre la mesilla donde se va a usar.
   2. Ata el cordel a lo alto de la columna (z = 224 mm).
   3. Tira HORIZONTALMENTE hacia la cama, aumentando despacio.
   4. Anota la fuerza a la que los pies traseros se despegan.

      CRITERIO:  >= 5,0 N     Si sale menos, ANADE LASTRE hasta pasarlo.

   5. Repite tirando hacia atras y hacia los dos lados.
   6. PRUEBA DE INCLINACION: calza un lado de la mesilla hasta 10 grados
      (una cuna de 35 mm bajo una pata de 200 mm). La maquina NO debe
      volcar ni deslizarse. Los pies de corcho hacen este trabajo.
```

### 8.5 Vuelco por tirón de cable

Es un caso aparte porque el cable entra **muy abajo**, y eso cambia el brazo de palanca por completo.

```
   Entrada del cable USB:  z <= 40 mm (conector de panel en la base)

   F_vuelco por tiron trasero = momento resistente / altura de entrada
                              = 1,586 N.m / 0,040 m
                              = 39,6 N

   Desenganche magnetico del conector: < 10 N

   >>> El conector se suelta a 10 N, cuatro veces por debajo de los
   >>> 39,6 N necesarios para volcar la maquina con el cable.
   >>> Un tiron del cable NUNCA puede tumbarla: se desconecta antes.
   >>> Y desconectarse ES el estado seguro (F-25).
```

**Requisito de montaje asociado, y hay que respetarlo:** el conector USB va **en la base, a z ≤ 40 mm**. Si alguien lo monta arriba en la columna "porque queda mejor", el brazo de palanca pasa de 40 a 224 mm y la fuerza de vuelco por tirón cae de 39,6 N a **7,1 N**, por debajo de los 10 N del desenganche. La máquina volcaría antes de que el imán soltara.

### 8.6 Resumen de estabilidad frente a los criterios del FMEA

| Criterio del informe de investigación | Exigido | PLUMA-R | Estado |
|---|---|---|:-:|
| Anchura de base ≥ 1,2 × altura del CdG | ≥ 83 mm | 200 mm (dimensión menor) = **2,9×** | ✔ |
| Sobrevive a 10° de inclinación | 10° | Vuelca a 46–66° | ✔ |
| Sobrevive a 5 N de empuje horizontal | 5 N | 7,1 N (peor dirección) … 14,9 N | ✔ |
| Toda la masa en la base | — | z_CdG = 69 mm sobre un gálibo de 260 mm = **26 %** | ✔ |
| Masa móvil en la punta < 20 g | < 20 g | Cabezal 18 g (inercia referida a punta 30 g) | ✔ |
| Masa total del aparato | ideal < 500 g | **2 261 g** | ✖ **No cumple** — y es deliberado: la masa está en la base y es lo que da la estabilidad y el silencio. Se acepta porque la máquina **no está sobre la persona ni por encima de ella** |
| Nada por encima del plano del esternón | — | Gálibo 260 mm sobre la base, y la base a altura de colchón | ✔ **con la regla de colocación de §7.4**, no por geometría |

---

<a name="9"></a>
## 9. LÍMITES TÉRMICOS

### 9.1 Los umbrales, y de dónde salen

| Superficie | Límite | Origen |
|---|---|---|
| Cualquier superficie que pueda tocar la piel | **≤ 40 °C** | ISO 13732-1: por encima de **43 °C** se produce quemadura para contactos largos **con cualquier material**; 43 °C es también el umbral práctico de dolor. 40 °C es el margen |
| Cualquier superficie que pueda tocar ropa de cama | **≤ 50 °C** | Mismo origen, más el riesgo de ignición diferida |
| Temperatura de contacto **objetivo** (no de seguridad) | **32–33 °C** | Ackerley 2014: el pico de la matriz velocidad × temperatura está en 3 cm/s **a 32 °C**; tanto más frío como más caliente reducen la descarga CT **y** el placer valorado |
| Subida de ambiente en la habitación | ≤ 15 K | Presupuesto general |

### 9.2 El calefactor de la férula — demostración de que no puede superar el techo

**Peor caso absoluto simultáneo:** Q4 falla en cortocircuito drenador-fuente **y** GP9 se queda en alto **y** el NTC se desconecta y el lazo pide el 100 %. El calefactor queda conectado permanentemente y ningún software puede intervenir. *(El peor caso con VBUS fuera de tolerancia es distinto y peor: se trata aparte, abajo y en F-36.)*

```
   PASO 1 - LA POTENCIA MAXIMA FISICAMENTE POSIBLE

       P_max = V^2 / R = (5,00)^2 / 120 = 0,2083 W

   No hay ninguna via INTERNA por la que entre mas potencia:
     - el MOSFET es un INTERRUPTOR EN SERIE. Solo puede REDUCIR el
       duty. Nunca puede aumentar la corriente.
     - la resistencia de 120 ohm es EL LIMITADOR, y una resistencia
       de pelicula metalica FALLA EN CIRCUITO ABIERTO, no en corto.
       Su modo de fallo es "deja de calentar", no "calienta mas".

   >>> PERO HAY UNA VIA EXTERNA, Y ES LA CORRECCION ADVERSARIAL <<<
     El techo escala con el CUADRADO de VBUS, y el aparato no lleva
     ni fusible, ni polyfuse, ni TVS en la entrada de 5 V:

         VBUS = 5 V   ->  0,208 W  ->  dT = 17,7 K  ->  38 C
         VBUS = 9 V   ->  0,675 W  ->  dT = 57,4 K  ->  77 C
         VBUS = 12 V  ->  1,200 W  ->  dT = 102 K   ->  122 C

     Un cargador PD averiado, o simplemente el cargador equivocado,
     rompe el argumento entero. Ver F-36. Quien salva ese caso NO es
     la resistencia: es el KSD9700 NC de 45 C en serie, mas el TVS de
     5,6 V y el polyfuse de 1,1 A que F-36 anade al BOM por 0,60 EUR.
     La frase correcta es: "0,2083 W SIEMPRE QUE VBUS SEAN 5 V".

   PASO 2 - RESISTENCIA TERMICA DE LA FERULA AL AIRE

       ~10 cm2 de superficie, conveccion natural h ~ 8 W/m2K mas
       radiacion ~ 5 W/m2K  ->  h_tot ~ 13 W/m2K
       R_th = 1/(13 x 1e-3) = 77 K/W.  Se toma 85 K/W, conservador.

   PASO 3 - INCREMENTO MAXIMO DE TEMPERATURA

       dT_max = 0,2083 W x 85 K/W = 17,7 K

   PASO 4 - TEMPERATURA MAXIMA ABSOLUTA DE LA FERULA

       T_max = T_ambiente + 17,7 K

           ambiente 18 C  ->  35,7 C   OK
           ambiente 20 C  ->  37,7 C   OK   <-- el "~38 C" de la spec
           ambiente 22 C  ->  39,7 C   OK
           ambiente 24 C  ->  41,7 C   limite aceptado
           ambiente 26 C  ->  43,7 C   POR ENCIMA del umbral ISO 13732-1
```

> ### ⚠️ CORRECCIÓN AL CONTRATO NUMÉRICO — el techo NO es 38 °C, es T_amb + 17,7 K
> `final_spec.md` dice *"HARDWARE ceiling ~38 °C set by the resistor value (a shorted FET cannot exceed it)"* como si fuera un absoluto. **No lo es.** Los 38 °C sólo salen si la habitación está a 20 °C. En un dormitorio español en julio, a 26 °C, el techo sube a **43,7 °C**, justo por encima del umbral de quemadura por contacto prolongado.
>
> **Corrección impuesta, en tres partes, todas gratis:**
> 1. **El firmware desactiva el calefactor de férula si el NTC de ambiente lee > 24 °C al arrancar.** Techo garantizado **≤ 41,7 °C** en todos los casos permitidos. Y por encima de 24 °C **el calefactor no hace falta**: la piel está a 32–34 °C y la brocha llega casi neutra.
> 2. **El fusible térmico va PEGADO A LA FÉRULA, no al cable.** Es lo que convierte el argumento en real, porque cubre el caso en que R_th se degrada (brocha bajo el edredón, férula envuelta en tela). Punto de disparo: `R_th_disparo = (45 − 20)/0,2083 = 120 K/W`, es decir la resistencia térmica tendría que empeorar un **41 %**. Ése es exactamente el escenario "la brocha se ha quedado tapada".
> 3. **El fusible es un KSD9700 bimetálico NC de 45 °C**, no el "fusible térmico de 47 °C" de la spec. Razón doble: **47 °C no es un valor de catálogo** en fusibles térmicos de un solo uso (la serie Microtemp empieza sobre 55–65 °C), y **47 °C está por encima del umbral ISO de 43 °C**. Se elige por debajo del valor de la spec, no por encima. Alternativa de un solo uso: Microtemp de 55 °C, peor.

**Y el argumento que cierra el caso: la piel no ve la férula.**

```
   ferula a 37,7 C          puntas del pelo a T_amb + 5 a 8 K
        |                              |
        |<------- 30 mm de pelo ------>|      = 25-28 C en una
        |         de cabra             |        habitacion a 20 C
        |                              |
   [ R13 ][ NTC ]                   [ PIEL ]

   Compresion del pelo a 400 mN = 6,9 mm.  Distancia = 30 mm.
   MARGEN 4,3x.  La ferula solo tocaria piel si la brocha se
   comprimiera 30 mm, lo que exigiria 1,74 N: cuatro veces la
   fuerza que la maquina puede aplicar.

   Nada metalico, conductor ni caliente puede alcanzar la piel.
```

### 9.3 El calefactor de la taza de reposo — y aquí hay un hallazgo

La taza lleva **R17 = 120 Ω metal film de 0,6 W**, es decir **0,208 W**, para mantener el aire de una taza forrada de fieltro a 35 °C. **Ése es el valor final del BOM (A-12), y llegar a él es el hallazgo de esta sección.** El candidato original era 47 Ω / 0,532 W; el análisis que sigue es por qué se descartó.

```
   INFERENCIA DE LA RESISTENCIA TERMICA DE LA TAZA

   Si mantiene 35 C (dT = 15 K sobre 20 C de ambiente) con un
   duty de regimen del ~40 %:

       P_regimen = 0,40 x 0,532 = 0,213 W
       R_th = 15 K / 0,213 W = 70,5 K/W          -> se toma 71 K/W

   TECHO EN REGIMEN PERMANENTE, con Q5 EN CORTOCIRCUITO (100 % de duty):

       dT = 0,532 W x 71 K/W = 37,8 K
       T = 20 + 37,8 = 57,8 C     <<<  QUEMADURA. Y por encima
                                       del limite de 50 C para
                                       superficie que toca ropa de cama.
```

> ### ⚠️ HALLAZGO — el calefactor de la taza es seguro SÓLO POR TRANSITORIO
> No lo es por potencia, como el de la férula. Lo sería sólo porque **nunca llega al régimen permanente**: la constante térmica de la taza es `τ = R_th × C_th ≈ 71 K/W × 25 J/K ≈ 1 800 s`, y el TPL5010 mata VMOT antes.
>
> ```
>    Subida real a los 960 s (peor caso, Q5 en corto, todo el rato):
>        dT = 37,8 x (1 - e^(-960/1800)) = 37,8 x 0,413 = 15,6 K
>        T = 20 + 15,6 = 35,6 C   a 20 C de ambiente     OK
>        T = 24 + 15,6 = 39,6 C   a 24 C de ambiente     OK, al limite
> ```
>
> **Es decir: una función de confort (la taza caliente) dependería para su seguridad de una capa de seguridad (el one-shot).** Esa dependencia hay que escribirla o alguien la romperá al "mejorar" el diseño. Requisitos, los tres obligatorios:
>
> 1. **El calefactor de la taza se alimenta de VMOT y JAMÁS de VBUS.** Si alguien lo conecta al raíl permanente "para que la taza esté siempre caliente", el techo pasa de 35,6 °C a **57,8 °C**.
> 2. **Segundo KSD9700 NC de 45 °C**, en serie, pegado a la taza. Coste 0,80 €.
> 3. **Ensayo 11.20-bis:** 17 minutos al 100 % de duty con el lazo NTC desactivado, midiendo con termómetro IR. **≤ 40 °C.**
>
> ### 🔴 Y ESE ARGUMENTO YA NO SE SOSTIENE CON EL PLAZO REAL DEL ONE-SHOT
>
> El one-shot **no dispara a los 960 s sino a los 1 020 s**: la ventana del TPL5010 arranca con el pulsador, y `pre-warm 60 s + ciclo 900 s = 960 s` dejaría **margen cero** al respaldo (corrección adoptada del firmware). Rehaciendo la cuenta con el plazo real:
>
> ```
>    dT = 37,8 x (1 - e^(-1020/1800)) = 37,8 x 0,432 = 16,3 K
>        T = 20 + 16,3 = 36,3 C   a 20 C de ambiente
>        T = 24 + 16,3 = 40,3 C   a 24 C de ambiente  <<< POR ENCIMA DE 40 C
> ```
>
> **Con 47 Ω, el ensayo 11.20-bis está predicho para FALLAR.** Por eso el valor de proyecto **es 120 Ω y no es opcional**: P = 0,2083 W → techo en **régimen permanente** de T_amb + 14,8 K = **34,8 °C a 20 °C de ambiente y 38,8 °C a 24 °C**, seguro con cualquier plazo y con Q5 en corto indefinidamente. La taza deja de depender del TPL5010 para su seguridad, que era el problema de fondo, y el BOM pierde un componente distinto (misma referencia que la férula). Los requisitos 1 y 2 (VMOT y no VBUS, segundo KSD9700) **se mantienen igualmente** como defensa en profundidad.

### 9.4 Calor del motor y del driver

```
   NEMA 11 a I_RUN = 0,337 A:   P = 2 x 0,337^2 x 5,6 = 1,27 W
   (a 0,40 A, si el detente lo obliga:                  1,79 W)

   PERO: la columna es 30 VECES mas grande que el motor.

     Superficie exterior de la columna:
       4 x 80 x 200 + 80 x 80 = 70 400 mm2 = 0,0704 m2
     Conveccion natural h ~ 8 W/m2K:

       dT_superficie = 1,27 / (8 x 0,0704) = 2,3 K    a 0,337 A
       dT_superficie = 1,79 / (8 x 0,0704) = 3,2 K    a 0,400 A

   >>> LA SUPERFICIE EXTERIOR DE LA COLUMNA SUBE 2-3 K. Punto.
   >>> No hay ningun escenario en el que una superficie que pueda
   >>> tocar ropa de cama se acerque a los 50 C, ni siquiera con
   >>> el motor calado durante los 17 minutos completos.
```

**El interior del motor sí se calienta**, y por eso: `IHOLD = 0` con `freewheel = 01` en todos los huecos largos (el contrapeso sujeta la botavara contra el tope, no el motor), duty de movimiento ~60 %, y una constante térmica de un NEMA 11 de 10–20 minutos que hace que un calado detectado en ≤ 3,75 min sólo produzca una fracción de la subida en régimen. **Comprobación en la puesta en marcha (ensayo 11.34):** tras tres ciclos completos consecutivos, la carcasa del motor debe estar **por debajo de 35 °C**. Si supera 40 °C, hay una fuga de corriente en algún sitio o I_RUN está mal calculada.

### 9.5 Resumen térmico: qué puede tocar qué

| Superficie | Máximo posible | Límite | Quién lo garantiza | Estado |
|---|---:|---:|---|:-:|
| Puntas del pelo (tocan piel 15 min) | T_amb + 8 K = **28 °C** | 40 °C | Conducción pobre a lo largo de 30 mm de pelo | ✔ |
| Férula (no toca piel: 30 mm de margen) | T_amb + 17,7 K = **41,7 °C** con corte a 24 °C | 43 °C | **Valor de la resistencia (0,2083 W)** + KSD9700 45 °C | ✔ |
| Taza de reposo (no toca piel; toca la base) | **34,8 °C** en régimen permanente con R17 = 120 Ω (con 47 Ω serían 40,3 °C a los 1 020 s: descartado) | 40 °C | **R17 = 120 Ω** (techo de hardware) + KSD9700 45 °C | ✔ con las 3 condiciones de §9.3 |
| Exterior de la columna (puede tocar ropa de cama) | T_amb + 3,2 K = **27 °C** | 50 °C | Relación superficie/potencia 30:1 | ✔ |
| Carcasa del motor (dentro de la columna) | < 35 °C tras 3 ciclos | — | IHOLD = 0, duty 60 % | ✔ medir |
| Cargador USB (fuera del aparato) | según fabricante | — | **Marca + IEC 62368-1 + superficie dura + nunca bajo ropa de cama** | ✔ regla 7 |

---

<a name="10"></a>
## 10. HIGIENE Y ALERGIAS

### 10.1 ⚠️ ADVERTENCIA DESTACADA — ALERGIA A PLUMAS Y PELO ANIMAL, Y ASMA

```
 ╔═══════════════════════════════════════════════════════════════════════════╗
 ║                                                                           ║
 ║   ⚠️  NO USES ESTE APARATO SI TÚ, O CUALQUIERA QUE DUERMA EN ESTA         ║
 ║       HABITACIÓN, TIENE ALERGIA A PLUMAS, A PLUMÓN, A PELO ANIMAL         ║
 ║       O A LOS ÁCAROS DEL POLVO, O TIENE ASMA.                             ║
 ║                                                                           ║
 ║   El cabezal es PELO DE CABRA NATURAL. Es proteína animal, y la           ║
 ║   exposición no es ocasional: es NOCTURNA, REPETIDA, y a menos de         ║
 ║   medio metro de tu zona respiratoria, durante quince minutos, todas      ║
 ║   las noches, durante meses.                                              ║
 ║                                                                           ║
 ║   ESTE APARATO NO USA NUNCA UNA PLUMA NATURAL REAL, Y NO DEBES            ║
 ║   MODIFICARLO PARA QUE LA USE. El "pulmón del edredón de plumas"          ║
 ║   (feather duvet lung) es una neumonitis por hipersensibilidad de         ║
 ║   origen aviar reconocida, con casos documentados de progresión a         ║
 ║   FIBROSIS PULMONAR. Hay una serie del Hospital Vall d'Hebron con         ║
 ║   28 pacientes diagnosticados entre 2004 y 2011, incluidos casos          ║
 ║   pediátricos. No es una molestia: es una enfermedad.                     ║
 ║                                                                           ║
 ║   SI TIENES CUALQUIERA DE ESAS CONDICIONES Y AUN ASÍ QUIERES EL           ║
 ║   APARATO:  monta el cabezal KABUKI DE TAKLON SINTÉTICO de 60 mm          ║
 ║   (3–8 €, línea B-xx del BOM). Es hipoalergénico, sin antígeno            ║
 ║   aviar, lava a 60 °C y seca en minutos. Pierdes algo de suavidad         ║
 ║   percibida por filamento. Es un intercambio razonable y está             ║
 ║   documentado como el fallback oficial del diseño.                        ║
 ║                                                                           ║
 ║   Y SI YA ESTÁS USÁNDOLO Y APARECEN tos seca nocturna, opresión en        ║
 ║   el pecho, disnea, sibilancias, rinitis o congestión que mejora los      ║
 ║   días que no lo usas: PARA, cambia a taklon, y si no remite, ve al       ║
 ║   médico y dile exactamente a qué te has estado exponiendo.               ║
 ║                                                                           ║
 ╚═══════════════════════════════════════════════════════════════════════════╝
```

### 10.2 El problema de los ácaros, y una contradicción que hay que resolver a la cara

El informe de investigación es tajante: **60 °C es la temperatura que mata los ácaros del polvo**, y entre el 10 y el 20 % de la población es alérgica a ellos. La especificación y el BOM de este proyecto piden **lavado semanal a 40 °C con champú neutro sin siliconas**.

**Las dos cosas no son compatibles, y no se puede simplemente subir la temperatura:**

| | Lavado a 40 °C | Lavado a 60 °C |
|---|---|---|
| Pelo de cabra | ✔ Sobrevive. Es prácticamente el máximo que aguanta sin encresparse, perder rizo y volverse quebradizo | ✖ **Lo destruye.** La queratina se degrada, el haz se abre y se apelmaza permanentemente |
| Taklon sintético | ✔ | ✔ Sobrevive perfectamente |
| ¿Mata ácaros? | ✖ **No** | ✔ Sí |
| ¿Elimina alérgeno de ácaro ya presente? | ✔ Parcialmente (el lavado arrastra el alérgeno aunque no mate al ácaro) | ✔ Sí |

> ### RESOLUCIÓN, y se escribe explícitamente porque es una decisión, no un olvido
> **El protocolo por defecto es 40 °C semanal con pelo de cabra**, porque el cabezal no es un edredón: es un objeto de 18 g, se lava entero cada semana, se seca al aire en horas y **no acumula reservorio interno de ácaros como sí lo hace un relleno de plumas**. El lavado semanal a 40 °C arrastra el alérgeno aunque no mate al ácaro, y ése es el mecanismo relevante para un objeto tan pequeño y tan frecuentemente lavado.
>
> **PERO si eres alérgico a los ácaros, el pelo de cabra no es para ti**: monta el taklon y lávalo a **60 °C**. No hay una tercera opción y no voy a fingir que la hay.

### 10.3 Protocolo de lavado semanal

```
   CADA DOMINGO, 5 MINUTOS DE TRABAJO + UNA NOCHE DE SECADO
   (por eso hay DOS cabezales: uno se lava mientras el otro trabaja)

   1. Suelta el cabezal: corta la brida, saca el tubo de silicona. 10 s.
   2. Lavabo con agua a 40 C (tibia, no caliente: si te quema la mano,
      esta demasiado caliente para el pelo de cabra).
   3. Una gota de CHAMPU NEUTRO SIN SILICONAS (linea D-01 del BOM).
      >>> LAS SILICONAS APELMAZAN EL PELO DE CABRA. No uses
      >>> acondicionador, ni champu "con keratina", ni jabon de manos
      >>> hidratante. Champu neutro y ya.
   4. Masajea el penacho EN EL SENTIDO DEL PELO, de la ferula hacia
      las puntas. NUNCA en circulos ni contra el pelo: eso enreda
      la cuticula y es lo que produce el apelmazamiento permanente.
   5. Aclara hasta que el agua salga limpia. Aprieta suavemente para
      escurrir, sin retorcer.
   6. Da forma al penacho con los dedos y DEJA SECAR BOCA ABAJO O EN
      HORIZONTAL, colgado del borde de una mesa.
      >>> NUNCA de pie con las puntas hacia arriba: el agua baja a
      >>> la ferula, disuelve el adhesivo del haz y el cabezal suelta
      >>> pelo a las pocas semanas. Este es EL error clasico.
   7. Secado al aire, 8-12 h. NUNCA secador, NUNCA radiador, NUNCA
      sol directo. Hay una resistencia de 120 ohm y un NTC dentro
      de esa ferula.
   8. A la semana siguiente, cuando este completamente seco, se monta
      y se lava el otro.
```

### 10.4 Por qué DOS cabezales, y no es por comodidad

Cuatro razones, y las cuatro son de seguridad o de función:

1. **El lavado tarda 12 h de secado.** Con un solo cabezal, o te saltas una semana o duermes con la brocha húmeda. Una brocha húmeda contra piel durante 15 min, noche tras noche, es maceración y foliculitis.
2. **Es la única forma de detectar el apelmazamiento por comparación.** Un cabezal se degrada tan despacio que no lo notas. Dos cabezales de recorte desigual, alternados, te dan una **referencia**: el día que uno se sienta claramente distinto del otro, ése es el que hay que lavar o tirar.
3. **Irregularidad mecánica gratis.** Dos haces de recorte y longitud ligeramente distintos, alternados entre sesiones, hacen que no haya dos noches idénticas sin escribir una sola línea de firmware. Es anti-habituación de coste cero.
4. **Redundancia funcional.** Si un cabezal suelta pelo, se moja o se cae al suelo, tienes el otro. 8,00 € frente a quedarte sin aparato.

> **Del BOM (`03-bom.md`, línea A-37): "**2**, no una". La segunda brocha está marcada como CRÍTICA, no como opcional. Este documento lo confirma.**

### 10.5 Cuándo reemplazar el cabezal

| Señal | Qué hacer |
|---|---|
| La compresión a 41 g baja de **5,0 mm** y no se recupera tras un lavado | **Reemplazar.** Está apelmazado de forma permanente |
| La huella a 41 g mide **menos de 50 mm** de diámetro tras el lavado | **Reemplazar** |
| Suelta pelo: al pasar los dedos por el penacho salen **más de 3 pelos** | **Reemplazar.** Un pelo suelto en la cama es inocuo, pero indica que el adhesivo del haz se está soltando |
| Olor, manchas amarillas en la base del haz, tacto pegajoso | **Reemplazar inmediatamente.** Es sebo oxidado y es un sustrato bacteriano |
| Ha tocado piel con eccema, herida abierta, acné inflamado o quemadura solar | **Reemplazar, y no reutilizar** |
| Se ha caído al suelo | Lavar antes de usar. Si es un suelo de baño o hay mascotas, reemplazar |
| **Ninguna de las anteriores** | **Reemplazar de todos modos al año.** Dos cabezales al año son 16,00 €. Es el consumible del aparato, como una cuchilla de afeitar |

### 10.6 EL FALLO INSIDIOSO: cómo detectar que la brocha se ha apelmazado

Ya está en F-03, pero merece repetirse porque es **el fallo más probable de todo el aparato** y el único cuyo síntoma se interpreta al revés.

```
   POR QUE ES INVISIBLE

   La fuerza es un lastre de laton y k_tip = 0.
   Eso significa que la maquina mantiene 400 mN EXACTOS pase lo
   que pase con la brocha. No hay ningun sensor. No hay ninguna
   alarma. La fuerza no cambia NUNCA.

   Lo unico que cambia es la SUPERFICIE sobre la que se reparte:

     2120 mm2  ->  0,19 kPa  ->  caricia ancha        SEMANA 0
     1100 mm2  ->  0,36 kPa  ->  "hoy esta raro"      SEMANA 6
      450 mm2  ->  0,89 kPa  ->  cosquilleo           SEMANA 12

   Y LA PERSONA CONCLUYE: "el aparato se ha estropeado".
   LO QUE HA PASADO: hay que lavar la brocha.
```

**Las cuatro señales, en orden de aparición:**

| Orden | Señal | Cómo se comprueba |
|:-:|---|---|
| 1 | **El penacho no vuelve a su forma** tras apretarlo con la mano: se queda con una "cara plana" | Visual, 2 segundos, cada noche al montarlo |
| 2 | **La compresión baja.** 6,9 mm nominal → por debajo de 5,5 mm es aviso, por debajo de 5,0 mm es fallo | Báscula de cocina, 60 segundos, cada domingo |
| 3 | **La huella se encoge.** ≥ 50 mm de diámetro a 41 g contra un espejo | Espejo + regla, 30 segundos, cada domingo |
| 4 | **El tacto cambia de "ancho" a "puntual"**, y la sesión empieza a hacer cosquillas en vez de relajar | Subjetivo. **Si llegas aquí, llevas seis semanas de retraso** |

> **La regla de oro:** *si el aparato te empieza a hacer cosquillas, no está roto: está sucio.* Lava la brocha antes de tocar nada del firmware, del riel o del lastre. Está impreso en la base.

### 10.7 Higiene del resto del aparato

| Elemento | Frecuencia | Cómo |
|---|---|---|
| Cuerpo, columna, base | Semanal | Paño con alcohol isopropílico. **Evita la zona del fieltro** (se lo lleva el adhesivo) |
| Taza de reposo (forro de fieltro) | Mensual | Aspirar con la boquilla fina. Sustituir el fieltro anualmente |
| Ranura del yugo y limpiaparabrisas de fieltro | Mensual | Aspirar. Es donde se acumula la pelusa que puede llegar al mecanismo |
| Cubierta del carro radial | Trimestral | Abrir, aspirar, **volver a comprobar que todas las holguras siguen < 1 mm al cerrar** |
| Riel de las rampas (fieltro) | Trimestral | Aspirar y repasar con PTFE seco. Fieltro sucio = µ mayor = trepada mayor = margen del fallo seguro menor |
| **Nunca** | | **No uses el aparato sobre piel con herida abierta, eccema, psoriasis, acné inflamado, quemadura solar, tatuaje reciente o piel frágil.** El roce repetido en el mismo sitio produce foliculitis |

---

<a name="11"></a>
## 11. CONTRAINDICACIONES — QUIÉN NO DEBE USARLO

### 11.1 El principio que las genera todas

> **Este aparato es seguro para una persona adulta que, en cualquier momento, puede alcanzar el pulsador de paro o simplemente apartarse. Las contraindicaciones son, literalmente, la lista de quien no puede hacer una de esas dos cosas.**

Y hay un precedente que conviene tener presente: Target retiró del mercado ~204 000 mantas lastradas Pillowfort tras **dos muertes por asfixia de menores** y cuatro informes de atrapamiento. Los productos de "confort para dormir" pensados para relajar **han matado niños**. Ésta no es una lista defensiva.

### 11.2 CONTRAINDICACIONES ABSOLUTAS — el aparato no se usa, punto

| Grupo | Por qué | Qué falla exactamente |
|---|---|---|
| **Bebés y niños** de cualquier edad | No pueden pulsar el paro, no pueden apartarse, no entienden qué es, y su piel y su vía aérea son más frágiles | Todas las capas de seguridad suponen una persona que puede retirarse. Ninguna lo suple |
| **Personas con movilidad reducida** que no puedan alcanzar y accionar el pulsador de paro por sí mismas | Parálisis, postoperatorio, inmovilización, contención, sedación fuerte, intoxicación | El pulsador NC es la **capa 2** entera. Sin alguien capaz de pulsarlo, quedan cinco capas en vez de seis y desaparece la única que no depende de semiconductores |
| **Personas que no puedan apartarse por sí mismas** | Mismo motivo. La respuesta natural a "esto no me gusta" es rodar 20 cm | El aparato está diseñado suponiendo que la persona es el actuador final de su propia seguridad |
| **Demencia moderada o grave** | No puede evaluar la situación ni recordar cómo pararlo | Ídem |
| **Alergia a plumas, plumón, pelo animal o ácaros; asma** | Ver §10.1. Exposición nocturna repetida en la zona respiratoria | El cabezal de pelo de cabra. **Con taklon, deja de ser absoluta y pasa a relativa** |
| **Mascotas en la habitación** | Gatos que se estrangulan con cordones, perros que muerden cables, ambos que tiran la máquina. Y ninguno puede pulsar el paro | Cable, vuelco, y una máquina de 2,26 kg junto a una cama |
| **Neuropatía periférica o sensibilidad reducida en la zona de contacto** | No pueden notar que se está produciendo un daño | Toda la seguridad cutánea de este aparato descansa en que 0,19 kPa se siente y 0,89 kPa también |
| **Uso sobre otra persona dormida sin su consentimiento previo dado en vigilia** | No es un problema técnico. Es el más importante de la lista | — |

### 11.3 CONTRAINDICACIONES RELATIVAS — consulta antes, o cambia algo

| Situación | Qué hacer |
|---|---|
| Piel frágil o fina: uso prolongado de corticoides, edad muy avanzada, eccema, psoriasis | **No usar sobre la zona afectada.** Elegir un sitio de piel sana. Si no hay ninguno, no usar |
| Piel rota, herida, quemadura solar, tatuaje reciente, acné inflamado | **No usar sobre esa zona hasta que cure.** El roce repetido produce foliculitis |
| Trastorno del procesamiento sensorial, TEPT, defensividad táctil | El toque inesperado puede resultar angustioso. Probar **despierto**, en sesiones de 3 minutos, con la mano en el paro, antes de plantearse dormir con él |
| Embarazo | Sin contraindicación conocida. Evitar el abdomen. Sitios recomendados: antebrazo y pantorrilla |
| Marcapasos o dispositivo implantado | No hay campos magnéticos apreciables (el único imán es el supresor de resonancia de la botavara, un N42 de 10×3 mm dentro de la columna). Sin restricción, pero mantén el imán a más de 150 mm del implante si alguna vez manipulas la máquina abierta |
| Pelo largo | **Recógetelo antes de encender.** Y respeta la distancia de 475 mm de §7.4 |
| Compartes cama | La otra persona **también** tiene que poder pulsar el paro y **también** cuenta para las contraindicaciones de alergia. Coloca la máquina de tu lado, con el pulsador hacia ti |
| Habitación a más de 24 °C | El firmware desactiva los calefactores solo (§9.2). No los fuerces |
| **La extremidad no se puede apoyar plana en el colchón** (hombro dolorido, escayola, brazo que hay que elevar, colchón muy hundido) | **No lo uses en esa postura.** Si la piel queda más de 25 mm por encima de lo previsto, la charnela de cabeceo topa y **el techo de 400 mN desaparece** (F-35). Elige otro sitio de contacto en el que la extremidad descanse plana, o no uses el aparato esa noche |
| **Sólo tienes una fuente de portátil, un cargador PD o un jack de 12 V a mano** | **No lo enchufes.** El techo térmico del calefactor escala con el cuadrado de la tensión (F-36). Un cargador USB de 5 V y 2 A de marca, o nada |

---

<a name="12"></a>
## 12. ADVERTENCIAS PARA PEGAR EN EL APARATO

Tres etiquetas. Se imprimen, se plastifican con cinta transparente y se pegan **donde dice cada una**. No en un manual: en el aparato.

### 12.1 ETIQUETA A — cara superior de la base, junto al pulsador de arranque

```
 ┌─────────────────────────────────────────────────────────────────────┐
 │  PLUMA-R          ANTES DE CADA SESIÓN — 30 SEGUNDOS                │
 │                                                                     │
 │  □ La base NO está sobre el colchón                                 │
 │  □ El cordón de 475 mm no toca la almohada en ningún punto          │
 │  □ Pelo largo recogido                                              │
 │  □ Cable recto, sin lazos, ≤ 300 mm libres sobre el colchón         │
 │  □ Cargador sobre superficie dura, NO bajo ropa de cama             │
 │  □ La brocha ya está APOYADA en la piel antes de pulsar arranque    │
 │  □ Extremidad DESCUBIERTA, mecanismo fuera del edredón              │
 │                                                                     │
 │  PARO: pulsa la seta roja. Funciona con el aparato muerto.          │
 │  ARRANQUE: mantén pulsado 300 ms. Ciclo de 15 min. Se apaga solo.   │
 │                                                                     │
 │  SI TE HACE COSQUILLAS, NO ESTÁ ROTO: ESTÁ SUCIO. Lava la brocha.   │
 └─────────────────────────────────────────────────────────────────────┘
```

### 12.2 ETIQUETA B — cara frontal de la columna, bien visible

```
 ┌─────────────────────────────────────────────────────────────────────┐
 │  ⚠️  ADVERTENCIAS — LÉELAS UNA VEZ Y RECUÉRDALAS                    │
 │                                                                     │
 │  SÓLO ADULTOS. Nunca cerca de bebés, niños o mascotas.              │
 │                                                                     │
 │  NO LO USES si no puedes alcanzar el paro o apartarte tú solo.      │
 │  NO LO USES si tienes ALERGIA a pelo animal, plumas o ácaros,       │
 │     o si tienes ASMA. (Existe cabezal de taklon sintético.)         │
 │  NO LO USES si tienes sensibilidad reducida en la zona (neuropatía).│
 │  NO LO USES sobre piel rota, con eccema, quemada por el sol,        │
 │     con tatuaje reciente o acné inflamado.                          │
 │  NO LO USES sobre cabeza, cuello, cara, columna vertebral, ni       │
 │     sobre codo, tobillo o clavícula.                                │
 │  NO LO USES sobre otra persona sin su permiso, dado despierta.      │
 │                                                                     │
 │  LA BASE NUNCA SOBRE EL COLCHÓN. Mesilla o tabla rígida.            │
 │  NADA DEL APARATO A MENOS DE 475 mm DE TU CABEZA.                   │
 │  CARGADOR DE MARCA CON MARCADO IEC 62368-1. NUNCA una batería.      │
 │  SÓLO 5 V USB. Nunca una fuente de portátil ni un jack de 12 V.     │
 │  NO APOYES EL BRAZO SOBRE UNA ALMOHADA NI UN COJÍN: sobre el        │
 │     colchón. Si la piel queda muy alta, la máquina aprieta de más.  │
 │  DETECTOR DE HUMO OPERATIVO EN LA HABITACIÓN.                       │
 │                                                                     │
 │  PARA Y DESENCHUFA SI: algo está caliente al tacto, el brazo se     │
 │  atasca, el brazo está doblado o roto, la brocha suelta pelo, o     │
 │  la sesión termina con un tirón brusco en vez de suavemente.        │
 └─────────────────────────────────────────────────────────────────────┘
```

### 12.3 ETIQUETA C — cara lateral de la base (la del mantenimiento)

```
 ┌─────────────────────────────────────────────────────────────────────┐
 │  AUTOCOMPROBACIÓN DE LA BROCHA — CADA DOMINGO                       │
 │    Báscula de cocina a 0. Férula VERTICAL.                          │
 │    Baja a 1 g → marca (z0).  Baja a 41 g → marca (z1).              │
 │    COMPRESIÓN c = z0 − z1                                           │
 │       5,5 – 9,0 mm  OK  (nominal 6,9)                               │
 │       5,0 – 5,5 mm  lava esta semana                                │
 │       < 5,0 mm      apelmazada → lava y repite → si sigue, CAMBIA   │
 │    HUELLA a 41 g contra un espejo: ≥ 50 mm de diámetro              │
 │                                                                     │
 │  PRUEBA DE CAÍDA LIBRE — CADA DOMINGO, 30 SEGUNDOS                  │
 │    Sin corriente. Lleva el brazo a mano al TOPE LEJANO (−43°),      │
 │    NO sólo a +30°: sólo así el pistón recorre el tubo ENTERO y se   │
 │    detecta que se pegue ARRIBA contra la tapa (F-33). Suelta.       │
 │       El día 1 CRONOMETRA Y APUNTA AQUÍ tu tiempo base: ____ s      │
 │       (recorrido completo 86°, esperado 4 – 6 s)                    │
 │       Dentro de ±30 % de tu base   → OK                             │
 │       Bastante más rápido          → amortiguador gastado (F-19)    │
 │       Más del doble, o no llega    → ⚠️ NO DUERMAS CON ÉL ESTA      │
 │                                      NOCHE. F-01 o F-33 en curso.   │
 │                                                                     │
 │  LAVADO SEMANAL: 40 °C, champú neutro SIN siliconas, en el sentido  │
 │  del pelo, secado BOCA ABAJO 12 h. Nunca secador. Nunca 60 °C.      │
 │                                                                     │
 │  MENSUAL: tendón del contrapeso con lupa (3 puntos) · lastre de     │
 │  latón en su marca · limpiar ranura y fieltros                      │
 │  ANUAL: cambiar los 2 cabezales · cambiar el cordón del contrapeso  │
 └─────────────────────────────────────────────────────────────────────┘
```

---

<a name="13"></a>
## 13. PUESTA EN MARCHA SEGURA — PROCEDIMIENTO PASO A PASO

> **Regla que gobierna todo este capítulo:** cada fase tiene una **puerta**. No se pasa a la fase siguiente hasta que la puerta se abre. Y **la piel humana no aparece hasta la fase 7**.

```
   MAPA DE FASES

   F0  MEDIR ................. antes de comprar hierro       BLOQUEANTE
   F1  CADENA DE SEGURIDAD ... sin motor, sin mecanica        BLOQUEANTE
   F2  TERMICA ............... brocha fuera de la maquina
   F3  MOTOR ................. tendon desenganchado
   F4  MECANICA COMPLETA ..... contrapeso y amortiguador
   F5  LAS TRES PRUEBAS ...... x 10 angulos                   BLOQUEANTE
   F6  RUIDO Y ENREDO ........ en la almohada, con pelo       BLOQUEANTE
   F7  PRIMERA PIEL .......... 3 min, despierto, mano en el paro
   F8  CICLO COMPLETO ........ 15 min, despierto
   F9  PRIMERA NOCHE ......... y no antes
```

### 13.1 FASE 0 — Medir antes de comprar (🔒 bloqueante)

| # | Acción | Puerta |
|:-:|---|---|
| 0.1 | **Medir la resistencia referida al eje de barrido** en 10 ángulos, con y sin brocha apoyada, con el amortiguador montado. Procedimiento completo en §5.4 | Variación entre ángulos **< 40 %**. Si es mayor, hay un rozamiento parásito: arreglarlo antes de seguir |
| 0.2 | Elegir la masa del contrapeso con la tabla de §5.5: **1,4 × la peor lectura** | Masa anotada por escrito. No se copian los 360 g de la spec |
| 0.3 | **Medir k_brush** en la báscula de cocina: bajar a 1 g (z₀), bajar a 41 g (z₁), c = z₀ − z₁ | c anotado. Nominal 6,9 mm. **De este número sale la altura del taper del riel:** `subida = (0,400/k_brush)/2,67` |
| 0.4 | Verificar el TMC2209: leer `IOIN.VERSION` por UART | Debe valer **0x21**. Si no, es falsificado: devuélvelo |

### 13.2 FASE 1 — Cadena de seguridad, en la mesa, sin motor (🔒 bloqueante)

**La cadena de seguridad se valida ANTES de que exista un motor.** Es la inversión del orden natural de montaje y es deliberada: si la cadena no funciona, no quieres haber conectado nunca un motor.

| # | Prueba | Criterio |
|:-:|---|---|
| 1.1 | Alimentar. Medir VMOT **antes** de pulsar arranque | **0 V.** Enchufar nunca energiza el motor (POR dispara SET del latch) |
| 1.2 | Pulsar arranque 300 ms. Medir VMOT | 5,00 V ±0,1 |
| 1.3 | Pulsación corta (< 100 ms) | **No arranca.** Evita el rearranque por apoyar la mano |
| 1.4 | **Pulsar S1** (la seta) con VMOT vivo | VMOT a **0 V en ~1 ms**. Y se queda enclavado |
| 1.5 | Con S1 enclavado, pulsar arranque | **No arranca.** S1 está aguas arriba |
| 1.6 | Verificar `EN` del TMC2209 | **Pull-UP de 10 kΩ a 3V3.** El pin es activo a nivel BAJO. Un pull-DOWN energizaría el motor en cada reset |
| 1.7 | **Detener el latido**: parar el PWM de GP11 desde la consola | VMOT muere en **< 250 ms**. Cronometrar con osciloscopio o LED |
| 1.8 | **Atascar GP11 en alto** (nivel fijo, sin onda) | VMOT muere igualmente en < 250 ms. **Ésta es la prueba clave** |
| 1.9 | Atascar GP11 en bajo | Ídem |
| 1.10 | Desconectar el MCU de la placa con VMOT vivo | VMOT muere en < 250 ms |
| 1.11 | **One-shot:** armar y esperar con cronómetro, sin tocar nada | VMOT muere sola entre **920 y 1 130 s** (1 020 s nominal ±10 %). Anotar el tiempo real. Si te sales, ajustar la resistencia del TPL5010. **No te fíes del datasheet: cronométralo** |
| 1.12 | Brownout: bajar VBUS con una fuente de laboratorio | El latch dispara **por debajo de 4,60 V** |
| 1.13 | Con el latch disparado, medir VMOT | **< 0,1 V.** Si lee 5 V, **Q1 está en cortocircuito**: no continúes |
| **1.14** | **F-36.** Verificar **TVS de 5,6 V + polyfuse de 1,1 A** montados en la entrada de VBUS, y el comparador configurado **en ventana** | Subir la fuente de laboratorio a **5,60 V**: el latch debe disparar. Sin esta protección, el "techo de hardware" del calefactor no existe fuera de los 5 V |
| **1.15** | **§4.9.** Cortar el 3V3 del MCU con VMOT vivo (simula regulador en corto) | VMOT muere en < 250 ms. Confirma que el `EN` sin pull-up **no puede** dejar el motor energizado |

> 🚪 **PUERTA 1: las trece pasan. Si una sola falla, no se monta el motor.**

### 13.3 FASE 2 — Térmica, con la brocha fuera de la máquina

| # | Prueba | Criterio |
|:-:|---|---|
| 2.1 | Calefactor de férula al **100 % de duty durante 30 min**, lazo NTC desactivado, termómetro IR sobre la férula | **≤ T_ambiente + 18 K.** Anota el ambiente. A 20 °C debe dar ≤ 38 °C |
| 2.2 | Medir las **puntas del pelo** en la misma condición | T_amb + 5 a 8 K. Si están por debajo de 27 °C, considera 82 Ω (0,30 W) |
| 2.3 | **Ensayo 11.20-bis: calefactor de taza (R17 = 120 Ω) al 100 % durante 17 min**, lazo NTC desactivado | **≤ 40 °C.** Con 120 Ω el techo en régimen permanente es 34,8 °C, así que debe pasar con holgura; si no pasa, la R_th real de tu taza es peor que los 71 K/W supuestos (§9.3) |
| 2.4 | Verificar que ambos KSD9700 de 45 °C están **pegados a la férula y a la taza**, no al cable | Visual + tirón suave |
| 2.5 | Desconectar el NTC de férula durante el calentamiento | El firmware detecta lectura fuera de rango, apaga el calefactor y sigue |
| 2.6 | Cortocircuitar el NTC | Falla al lado frío: el lazo apaga |
| 2.7 | Verificar que el calefactor de taza está en **VMOT**, no en VBUS | Con el latch disparado, la taza no debe recibir corriente |

### 13.4 FASE 3 — Motor, con el tendón desenganchado

| # | Prueba | Criterio |
|:-:|---|---|
| 3.1 | `PWMCONF.freewheel = 01`. Cortar VMOT y girar el eje con dos dedos | **Gira libre**, sólo con el detente. Si notas frenado viscoso, `freewheel` está mal (F-02) |
| 3.2 | Verificar el suelo del PIO | 240 µs → **9,30 cm/s en el peor radio (325 mm)**. Comprobar `CHOPCONF.MRES` antes de cada golpe |
| 3.3 | Autotune StealthChop: AT#1 en cada arranque (parado); **AT#2 una sola vez en el banco, motor desacoplado**, con binario de calibración | PWM_OFS y PWM_GRAD congelados en flash con `pwm_autograd = 0`. **Nunca un movimiento oculto de 400 pasos/s con el brazo montado: son 26 cm/s de punta** |
| 3.4 | Tres ciclos completos de movimiento, medir la carcasa del motor | **< 35 °C.** Si supera 40 °C, hay una fuga o I_RUN está mal |
| **3.5** | **S-22, y esto no se había medido nunca:** bloquear el sector a mano y dejar el motor **calado 4 minutos** (la latencia peor caso de detección de F-05), con la columna cerrada | Carcasa del motor **< 45 °C** y exterior de la columna **< 40 °C**. Si se pasa, el **NTC de 0,30 € en el soporte del motor con corte a 45 °C deja de ser opcional** y se monta |

### 13.5 FASE 4 — Mecánica completa

| # | Prueba | Criterio |
|:-:|---|---|
| 4.1 | Montar contrapeso, amortiguador y tendón. **Cordón secundario redundante con 2 mm de holgura** | Visual |
| 4.2 | **Prueba de caída libre**: brazo a +30° a mano, soltar | **2–3 s** hasta el tope |
| 4.3 | **Prueba de k = 0**: apoyar la brocha en la báscula, empujar el brazo hacia arriba 20 mm | **La lectura NO se mueve.** Si se mueve, la charnela roza o el eje no es tangencial |
| 4.4 | **Fuerza en cinco puntos del arco** con la báscula | **41 ± 2,5 g** (400 ± 25 mN) en los cinco |
| 4.5 | Homing: buscar el microrruptor de reposo | Lo encuentra en **< 95°** de recorrido |
| 4.6 | Verificar que el microrruptor **ABRE** al salir del reposo | Si no abre nunca, está pegado (F-15) |
| 4.7 | Topes M4 en agujeros ciegos; orejas en los extremos de las rampas; ranura del yugo de 100° | Visual: **aflojados del todo, los tornillos siguen en el agujero** |
| 4.8 | **Prueba de vuelco** (§8.4): tirar horizontalmente a z = 224 mm en cuatro direcciones | **≥ 5,0 N** en todas. Si no, añade lastre |
| 4.9 | **Prueba de inclinación**: calzar la mesilla a 10° | No vuelca ni desliza |
| 4.10 | Botavara **forrada de termorretráctil de punta a punta** | Visual |
| 4.11 | Cubierta del carro radial cerrada, **todas las holguras < 1 mm** | Galga de 1 mm: no entra por ningún sitio |
| **4.12** | 🔒 **F-33. Recorrido del pistón.** Lleva la botavara a mano a los **dos** topes y observa el tubo | El pistón **no llega a tocar la tapa superior** en ningún punto. Recorrido útil ≥ **105 + 20 mm**. **Collar tope** montado a 10 mm de la tapa. **Ranura de fuga también en los 15 mm superiores** |
| **4.13** | 🔒 **F-34. Retención del cordón del contrapeso.** Afloja el cordón a mano llevando la botavara al reposo deprisa, y mira la garganta | **El cordón no se sale ni se monta sobre sí mismo, ni con holgura total.** Dos pestañas de 4 mm y guía de retención montadas. Repítelo cinco veces |
| **4.14** | 🔒 **S-17. Envolvente del tambor y del tubo.** ¿Caben dentro de la columna? | Si **no** caben: carcasa propia atornillada, holguras < 1 mm, y se añade como sexto punto del ensayo del mechón. **Un tambor de Ø140 con cordón cargado no puede quedar a la vista junto a la cama** |
| **4.15** | **F-35. Ensayo de altura en el sitio real de uso** | Con la brocha sobre la extremidad, la charnela queda **a media flotación**, con margen arriba y abajo. Tope superior de cabeceo **blando** (silicona o EVA de 5 mm) montado |
| **4.16** | **F-39.** Tapa sobre las dos rampas, ranura de paso ≤ 8 mm, cantos de entrada a R ≥ 3 mm | Galga: la holgura que se cierra queda inaccesible |
| **4.17** | **F-38.** Imán N42 encapsulado en epoxi dentro de la columna | Tirón suave: no se mueve |

### 13.6 FASE 5 — LAS TRES PRUEBAS × 10 ÁNGULOS (🔒 bloqueante, y es LA prueba)

**Contra una almohada lastrada, con la brocha apoyada a 400 mN comprobados en la báscula.**

```
   ANGULOS:  -19, -10, 0, +10, +19, +22, +26, +30, +34, +38

   Y en cada uno, alternando los tres metodos de corte:
     (a) TIRON DEL CABLE USB a media pasada
     (b) PULSADOR S1 a media pasada
     (c) FIRMWARE COLGADO a media pasada  ->  `while(1);` desde consola

   CRITERIO, SIN NEGOCIACION POSIBLE:

     >>> LA BROCHA ABANDONA LA ALMOHADA EN 2-3 s
     >>> Y LLEGA AL TOPE DE APARCAMIENTO EN MENOS DE 15 s
     >>> LAS 10 VECES. 10 DE 10.

   Si falla UNA, anades peso y vuelves a empezar la serie entera.
   No existe "9 de 10 esta bien".
```

> 🚪 **PUERTA 5.** `04-electronica.md` lo dice con la frase correcta y la repito literalmente: **"Si alguna de las tres falla, el aparato no duerme contigo. Sin excepciones."**

### 13.7 FASE 6 — Ruido y enredo (🔒 bloqueante)

| # | Prueba | Criterio |
|:-:|---|---|
| 6.1 | **Ruido en la almohada**, no a 50 cm. Móvil con app de SPL apoyado donde va tu oreja. Medir el suelo de la habitación, luego un ciclo completo | **Incremento ON/OFF < 3 dB** sobre el suelo, **con el movimiento del carro incluido**. Una lectura absoluta no vale para nada; la diferencia sí |
| 6.2 | Si no baja de 3 dB: reducir a 8 movimientos de carro por sesión | La banda mojada cae de 118 a ~90 mm. Es el precio |
| 6.3 | **Ensayo del mechón de pelo**, 15 min, cinco puntos (§6.3) | **Nada es arrastrado hacia dentro en ninguno** |
| 6.4 | Filmar la punta a **240 fps a 2 cm/s** (el peor caso de stick-slip) | Sin saltos periódicos de ~1 mm. Si los hay, alargar el tubo de silicona a 35 mm y luego a 45 mm |
| 6.5 | Filmar un aterrizaje a 240 fps | **Un solo toque monotónico**, sin dos o tres golpecitos |

### 13.8 FASE 7 — La primera vez sobre piel: 3 minutos, despierto

```
   1. Sientate. NO te tumbes. Luz encendida.
   2. Apoya el ANTEBRAZO en la mesa, dentro del arco marcado en la
      plantilla de papel. Marca los 273 mm COMPLETOS de arco de
      contacto, no solo los 199 mm de fuerza plena.
   3. Coloca la brocha APOYADA sobre la piel, a mano.
      (Asi la sesion no contiene ningun toque no anticipado.)
   4. LA MANO SOBRE EL PULSADOR DE PARO. Todo el rato.
   5. Arranca. Cuenta TRES MINUTOS. Para tu mismo.

   QUE OBSERVAR, y anotalo por escrito:
     - Se siente como una caricia ancha, o como cosquilleo?
       (si es cosquilleo, revisa la anchura de huella y k_brush)
     - Notas vibracion, zumbido o un temblor fino?
       (si si: es ripple de microstep. Prueba a 1 cm/s: si empeora,
        confirmado. Alarga el tubo de silicona)
     - El aterrizaje es un toque suave o un golpecito?
     - Notas el momento del despegue, o la brocha "desaparece"?
     - Notas el movimiento del carro radial? Lo oyes?
     - Al terminar: hay marca, enrojecimiento o picor?
       (no deberia haber NADA a los 5 minutos)
```

> 🚪 **PUERTA 7:** ninguna marca, ningún picor, ninguna vibración perceptible. Si hay enrojecimiento persistente, la fuerza está mal calibrada o la huella se ha encogido.

### 13.9 FASE 8 — Ciclo completo de 15 minutos, despierto

Repite la fase 7 pero dejando correr los **900 segundos completos**, tumbado, con luz tenue, **sin dormirte** y con la mano cerca del paro. Tres noches distintas.

| Qué comprobar | Criterio |
|---|---|
| El ciclo **termina solo** a los 900 s, con un último golpe firme y retirada suave de 2–3 s | Si termina con un tirón brusco, **ha disparado el TPL5010 y el firmware se colgó**. Es un síntoma, no una anécdota |
| El aparato queda desenergizado al terminar | VMOT a 0 V |
| Carcasa del motor tras tres ciclos consecutivos | **< 35 °C** |
| ¿La sensación se aplana a partir del minuto 8? | Si se aplana, la respuesta honesta es un tercer eje, no más firmware. Anótalo |
| ¿Sigue habiendo huecos reales de no-contacto sobre un torso que respira? | En brazos y piernas sobra con 11,8 mm. En el flanco, **mídelo o limita el uso al abdomen lateral** |

### 13.10 FASE 9 — La primera noche

```
   Y SOLO ENTONCES.

   □ Las nueve puertas anteriores, abiertas y anotadas por escrito
   □ Etiquetas A, B y C pegadas en el aparato
   □ Cordon de colocacion de 475 mm atado al perno del eje
   □ Detector de humo de la habitacion, probado esta semana
   □ Cargador de marca, marcado IEC 62368-1, sobre superficie dura
   □ Enchufe conmutado accesible desde la cama
   □ Nadie mas en la habitacion que entre en las contraindicaciones
   □ Sin mascotas
   □ Pelo recogido
   □ Segunda brocha limpia y seca, lista

   LA PRIMERA NOCHE: usa el antebrazo. Es el sitio con mas margen,
   el mas lejos de la cabeza y el mas facil de apartar.
   No empieces por el torso ni por la espalda.
```

---

<a name="14"></a>
## 14. CONTRADICCIONES ENCONTRADAS EN LA ESPECIFICACIÓN VINCULANTE

No las escondo. Todas están corregidas dentro del documento; aquí está el resumen. Las que ya habían sido detectadas por `02-mecanica.md` o `04-electronica.md` se marcan como tales, porque la coincidencia entre documentos independientes es en sí misma una verificación.

| # | Dónde | Qué dice la especificación | Qué pasa en realidad | Corrección aplicada en este documento |
|---|---|---|---|---|
| **S-1** | Presupuesto del fallo seguro | *"Covers hard stop, USB pull, brownout, watchdog, TPL5010, **hung firmware**, end of cycle"* — con sólo el contrapeso | **Falso para "hung firmware".** El presupuesto usa el **detente** (bobinas abiertas, 114 mN·m reflejados). Con las bobinas **energizadas** a I_RUN 0,337 A el par de retención reflejado es de **~493 mN·m**, el doble de los 247 mN·m del contrapeso. Un firmware colgado con bobinas vivas deja la brocha sobre la piel hasta 16 min | **Se añade la CHARGE PUMP DE LATIDO como capa 3** (§4.3): corta VMOT en 141 ms si el latido se detiene, y es la única capa que ningún estado estático del MCU puede burlar. **Por eso este documento tiene SEIS capas de parada y no las cinco del guion.** *(Coincide con C-5 de `04-electronica.md`)* |
| **S-2** | Margen del fallo seguro | *"bias 247 mN·m vs worst resistance 175 mN·m = margen **1,41×**"* | La trepada de riel de 61 mN·m corresponde a una pendiente de 10,3°. Repartir los 4,42 mm de despegue en 8° obliga a **11,9°** y da **66 mN·m**. Resistencia peor caso = 114 + 66 = **180 mN·m** | **Margen real 1,37×**, no 1,41×. Sigue por encima del suelo de 1,3× de este FMEA, así que la arquitectura no cambia — pero **no queda margen para un detente mayor que el medido**, y eso convierte el procedimiento de §5.4 en obligatorio *(coincide con C3 de `02-mecanica.md`)* |
| **S-3** | Techo del calefactor de férula | *"HARDWARE ceiling ~38 °C set by the resistor value"*, presentado como absoluto | **El techo es T_ambiente + 17,7 K, no 38 °C.** A 20 °C da 37,7 °C ✔, pero a 26 °C (julio español) da **43,7 °C**, por encima del umbral ISO 13732-1 | Firmware **desactiva el calefactor si el ambiente supera 24 °C** (techo garantizado ≤ 41,7 °C), y por encima de 24 °C el calefactor no hace falta. Más el KSD9700 pegado a la férula y el ensayo 2.1 *(coincide con C-7 de `04-electronica.md`)* |
| **S-4** | Fusible térmico | *"47 C thermal fuse in series"* | **47 °C no es un valor de catálogo** en fusibles térmicos de un solo uso (Microtemp empieza sobre 55–65 °C). Y **47 °C está por encima del umbral de quemadura por contacto prolongado de la ISO 13732-1 (43 °C)** | **KSD9700 bimetálico NC de 45 °C**, pegado a la férula (no al cable). Se elige **por debajo** del valor de la spec, no por encima *(coincide con C-6 de `04-electronica.md`)* |
| **S-5** | Calefactor de la taza de reposo | La spec adopta la taza calentada a 35 °C sin darle ningún análisis térmico propio | **Hallazgo nuevo de este documento.** Con R17 = 47 Ω y Q5 en cortocircuito, el **régimen permanente sería T_amb + 37,8 K = 57,8 °C**: por encima del límite de 40 °C para superficie que puede tocar piel **y** del de 50 °C para superficie que puede tocar ropa de cama. Es seguro **sólo porque el TPL5010 corta a los 960 s y τ ≈ 1800 s** (llega a 35,6 °C) | Tres requisitos obligatorios (§9.3): **(a)** alimentación **siempre desde VMOT, jamás desde VBUS**; **(b)** segundo KSD9700 de 45 °C pegado a la taza; **(c)** ensayo 2.3 de 16 min al 100 % de duty. **Variante recomendada: R17 = 120 Ω**, que la hace segura en régimen permanente y permite precalentarla del raíl continuo |
| **S-6** | `IHOLD = 0` | *"IHOLD 0 at the park side ... zero standstill current, hum or heat"* | En el TMC2209 **`IHOLD = 0` no es corriente cero**: `CS = 0` es el escalón más bajo (~30 mA rms) **y los puentes siguen en baja impedancia**, lo que produce un **freno de corrientes inducidas que se opone directamente al contrapeso** | **`PWMCONF.freewheel = 01` obligatorio** (alta impedancia). `10` y `11` **prohibidos** (cortocircuitan las bobinas). Es el modo de fallo F-02, RPN 60, bloqueante. Ensayo 3.1 *(coincide con C-4 de `04-electronica.md`)* |
| **S-7** | Habilitación del driver | El FMEA de la investigación dice *"ENABLE debe ser ACTIVO-ALTO con pull-DOWN de 10 kΩ"*, y la spec lo hereda | **El pin `EN` del TMC2209 es ACTIVO A NIVEL BAJO.** Copiar esa recomendación literalmente pone un pull-down que **habilita el driver en cada reset y durante todo el arranque** | **Pull-UP de 10 kΩ a 3V3.** Comprobación explícita en el ensayo 1.6 *(coincide con C-3 de `04-electronica.md`)* |
| **S-8** | Integridad por ciclo | *"one lever microswitch ... must close once per cycle within commanded time +50%"* | **"Ciclo" es ambiguo.** Hay 64 golpes por sesión, pero **el reposo está a +43° y los golpes sólo llegan a ±40°: los golpes normales no pasan por el microrruptor** | Definido como **5 visitas programadas a la taza por sesión** (arranque + fin de cada bloque). **Latencia peor caso de detección de calado: 3,75 minutos**, y se documenta como tal en F-05 *(coincide con C-10 de `04-electronica.md`)* |
| **S-9** | StallGuard4 | *"StallGuard4 as a free second trip"* | A 2,0 cm/s el motor gira a **9,1 rpm**, y StallGuard4 no es fiable por debajo de ~10 rpm. **Es decir, no funciona en el extremo bajo de la banda nominal** | Se activa como segundo disparo por encima de 3 cm/s y **ninguna decisión de seguridad descansa sobre él**. La detección primaria es el microrruptor *(coincide con C-11 de `04-electronica.md`)* |
| **S-10** | Gálibo y riesgo ocular | *"nothing above 260 mm from the base plane at any point in the cycle"*, usado como argumento de que nada llega a la cabeza | **El gálibo vertical NO protege la cara.** Con la base a altura de colchón, el plano de trabajo queda a ~140 mm sobre el colchón, que es justo la altura de una cabeza sobre una almohada. **La única protección real es horizontal** | Se declara explícitamente en §7.4 que la mitigación primaria es **la regla de colocación**, no la geometría, y se materializa con un **cordón de 475 mm atado al perno del eje** para convertir la instrucción en un instrumento |
| **S-11** | Lavado y ácaros | La spec y el BOM piden **lavado semanal a 40 °C**; el informe de investigación exige **60 °C** para matar ácaros | **Son incompatibles y no se puede subir la temperatura**: 60 °C destruye el pelo de cabra | Se resuelve explícitamente en §10.2: **40 °C por defecto** (el cabezal es de 18 g, se lava entero cada semana y el lavado arrastra el alérgeno aunque no mate al ácaro), y **si eres alérgico a ácaros, taklon lavado a 60 °C**. No hay tercera opción |
| **S-12** | Tambor del contrapeso | *"a 70 mm ply drum"* | Ambiguo entre radio y diámetro. **Sólo con r = 70 mm salen los 247 mN·m**: 0,360 × 9,81 × 0,070 = 0,247 N·m. Con 35 mm saldrían 124 mN·m | **70 mm es el RADIO. El tambor mide Ø140 mm.** Lo confirma la coherencia con la síntesis rechazada (320 g × 45 mm = 141 mN·m, exactamente lo que la spec cita) *(coincide con D9 de `02-mecanica.md`)* |
| **S-13** | Masa total | *"MASS 2.0 kg total"* | Sumando pieza a pieza salen **2,26 kg** (§8.2) | **No cambia ninguna conclusión de seguridad** (más masa = más estable) y sí mejora los márgenes de vuelco. Se documenta porque afecta a la afirmación de que "se mueve con una mano" |
| **S-14** | Fuerza de vuelco | La spec no da ninguna; `02-mecanica.md` da **4,5 N sin lastre / 9 N con lastre** | Recalculando con una tabla de masas explícita salen **8,8 N / 12,7 N**. Los dos análisis discrepan por un factor ~1,7 | **La conclusión de seguridad es la misma en los dos y es la que importa:** con el análisis más conservador, **la máquina SIN el lastre W1 NO llega al mínimo de 5 N**. Por eso W1 se reclasifica de "carga másica acústica" a **pieza de seguridad**, y el criterio real pasa a ser el **ensayo 4.8**, no la cuenta |
| **S-15** | Fuerza tangencial hacia el reposo | *"tangential force ... toward the park 2.2 N"*, junto al techo de 1 N del informe FMEA | Los 2,2 N (y 2,8 N si el detente obliga a un contrapeso de 484 g) **superan el techo de 1 N** que el informe de investigación fija para la fuerza de punta | Se aclara que **el techo de 1 N se refiere a la fuerza NORMAL**, que aquí sigue siendo 400 mN por construcción. La tangencial actúa en la dirección que **termina sobre la propia base de la máquina**, se reparte sobre 2120 mm² (1,0–1,3 kPa de cizalla) y está limitada por el pandeo del fusible de GRP. **Se acepta y se documenta**, no se oculta |
| **S-16** | Autotune de StealthChop | *"hidden 1.2 s tuning move at 400 fs/s at power-up"* junto a *"PIO minimum step interval caps the tip at 10 cm/s"* | **Mutuamente incompatibles.** 400 pasos completos/s = **26,4 cm/s de punta**, 2,6× el clamp — y con el brazo montado eso es un latigazo real | AT#1 en cada arranque (parado, no necesita movimiento); **AT#2 una sola vez en el banco, con el motor desacoplado**. Ensayo 3.3. *Beneficio colateral: se elimina un latigazo de 26 cm/s del arranque de cada noche* *(coincide con C-1 de `04-electronica.md`)* |
| **S-17** | Geometría del tambor del contrapeso frente a la columna | §5.2 de este mismo documento fija **r = 70 mm → tambor de Ø140 mm**, y §6.2 lo dibuja **dentro de la columna de pino**, que mide **80 × 80 × 200 mm** | **Un tambor de Ø140 no cabe en una columna de 80 × 80.** Y el tubo del amortiguador necesita ≥ 105 mm de recorrido de pistón + ~100 mm de barra de acero + tapas ≈ **230–250 mm**, que tampoco caben en 200 mm de columna. §8.2 lo confirma sin querer al listar el tambor dentro de la *"pila de discos"* a z = 190 mm, es decir **sobre la tapa de la columna, a la intemperie**. **Consecuencia de seguridad, y es la que importa:** si el tambor y su cordón quedan fuera, se cae el argumento de F-22 y F-23 (*"ningún cordón del mecanismo es accesible"*) y reaparecen el enredo de pelo y el lazo junto a la cama | **Se declara BLOQUEANTE para `02-mecanica.md`:** o el conjunto tambor + tubo cabe realmente dentro de una envolvente cerrada, o **se le pone una carcasa propia de contrachapado, atornillada, con todas las holguras < 1 mm**, y el ensayo del mechón de pelo (§6.3) **añade esa carcasa como sexto punto**. No se acepta un tambor de Ø140 con un cordón cargado a la vista al lado de una almohada |
| **S-18** | Transitorio de fuerza frente a la flotación de cabeceo | El contrato dice *"Transient ceiling 580 mN under a 30 mm-in-0.1 s body shift"* y a la vez *"k_tip = 0 (±25 mm float)"* | **Se contradicen.** Un desplazamiento de 30 mm **agota los ±25 mm de flotación** y topa la charnela. En cuanto topa, `k_tip` deja de ser 0 y la fuerza no es 580 mN: es lo que dé la interferencia contra la estructura. Los 580 mN sólo valen **hasta 25 mm** | **Nuevo modo F-35** con tope superior blando, galga de altura y regla escrita de no apoyar la extremidad sobre almohada. Y **§0.3 pasa a declarar la precondición** del techo de 400 mN en vez de presentarlo como absoluto |
| **S-19** | Velocidad de retirada frente al tiempo de retirada | El contrato dice a la vez *"80–120 mm/s"* de velocidad de punta y *"2–3 s"* de retirada; §5.6 acepta *"menos de 15 s"* y §15.2 exigía *"2–3 s"* | **Los tres números no son compatibles.** Los 86° completos a R = 300 son **450 mm de arco**: a 80–120 mm/s salen **4–6 s**, no 2–3. Los 2–3 s corresponden a una retirada **parcial**, y el criterio semanal de 2–3 s medido desde +30° estaba midiendo **13° de los 86°** | Se separan los dos ensayos y se les da criterio propio: la **prueba semanal pasa a hacerse desde el tope lejano**, con **tiempo base anotado el día 1** y tolerancia ±30 %, precisamente porque así recorre el tubo entero y detecta F-33. El criterio de aceptación de §5.6 (< 15 s) se mantiene, porque es un techo, no una medida |
| **S-20** | Peligro 16 del informe de investigación (piezas pequeñas / ingestión) | El FMEA original **no tenía ninguna fila** para él, pese a que el informe lo enumera explícitamente y a que el aparato lleva un imán de neodimio de 10 × 3 mm, un lastre de 40 g y tornillos M4 | Omisión pura: era el único de los 16 peligros del informe sin fila propia | **Nuevo modo F-38**, con el imán encapsulado en epoxi dentro de la columna y comprobación mensual de piezas sueltas |
| **S-21** | Peligro 11 del informe (holguras que se cierran) frente a la rampa del riel | El informe prohíbe *"a closing gap in the 5–25 mm band"*; F-29 lo daba por resuelto mirando sólo la ranura del yugo | **El par patín/rampa es una holgura accesible que se cierra en cada barrido**, y además una V convergente, que es la geometría de arrastre de pelo y tela. No estaba analizado | **Nuevo modo F-39**: tapa sobre las dos rampas con ranura de paso ≤ 8 mm, cantos de entrada a R ≥ 3 mm, y las entradas de rampa añadidas como sexto punto del ensayo del mechón |
| **S-22** | Peligro 7 del informe (NTC en el soporte del motor) | El informe pide *"an NTC on the motor bracket that stops the cycle at 45 °C"*; el dosier sólo tiene una medida **de puesta en marcha** (< 35 °C tras tres ciclos) | No hay **ninguna** vigilancia térmica del motor **en marcha**. Con un calado no detectado durante hasta 3,75 min (F-05) las bobinas siguen disipando 1,22–1,79 W dentro de una columna forrada de fieltro | Se acepta la desviación **y se argumenta**: la superficie exterior de la columna sube 2–3 K (§9.4), el techo de bobinas está acotado por I_RUN y el TPL5010 corta a los 1 020 s pase lo que pase. **Pero se añade al ensayo 3.4 la exigencia de repetirlo con el motor deliberadamente calado 4 min**, que es lo que el dosier nunca había medido. Si la carcasa supera 45 °C, el NTC del soporte del motor **deja de ser opcional** |
| **S-23** | Peligro 2 del informe (pandeo del brazo) | El informe exige un brazo que *"elastically buckles at < 0,5 N"*; PLUMA-R usa un fusible de GRP que se dobla **20 mm a 1,4 N** | Es **2,8× más rígido** de lo que el informe pide para el argumento ocular. El dosier lo citaba en §7.3 como si cumpliera | **Desviación consciente y aceptada, ahora declarada como tal.** Es admisible porque en PLUMA-R la mitigación ocular primaria **no es el brazo sino el gálibo horizontal** (§7.4), y porque los últimos 30 mm son pelo suelto que pandea a 11 µN. Un fusible a 0,5 N no soportaría los 2,2–2,8 N tangenciales de la retirada, así que **no se puede bajar sin romper el fallo seguro**: es un compromiso real, no un descuido |

**Las siete filas S-17 a S-23 son de la revisión adversarial posterior**: las seis primeras salen de trazar la geometría y los números hasta el final, y S-20 a S-23 de cotejar **uno a uno** los 16 peligros del informe de investigación original contra las 32 filas del FMEA. De ese cotejo, **doce peligros estaban bien cubiertos, uno faltaba entero (el 16) y tres estaban cubiertos sólo en parte (el 7, el 11 y una desviación consciente en el 2).**

### 14.1 Lo que NO es una contradicción, para que nadie lo "corrija" por error

- **La potencia de bobinas de 1,22 W es correcta.** `2·I_rms²·R` con I_rms = 0,337 A. Con microstepping senoidal, `I_A² + I_B²` es constante e igual a `I_pico²`, y `I_pico²·R = 2·I_rms²·R`. Las dos vías dan lo mismo. Quien diga que hay que dividir entre dos, se confunde.
- **La afirmación "5 V nativo" es correcta**, aunque el margen de chopper de la spec (2,70×) esté inflado por usar el rms en vez de la cresta (real: 1,85×). La conclusión no cambia.
- **`k_tip = 0` es correcto y es un teorema, no una aproximación.** Para una botavara rígida sobre una charnela horizontal con fuerza de contacto vertical, tanto el brazo de la gravedad como el del contacto escalan con `cos(cabeceo)`, así que `N = Σ(mᵢ·g·xᵢ)/L` es independiente del ángulo de cabeceo.
- **La retirada arrastra la brocha por hasta 199 mm de piel antes de despegar.** No es un fallo: es una consecuencia conocida y aceptada de usar el contrapeso como fallo seguro. Se lee como un último golpe firme. Está declarado en la spec y no hay nada que corregir.

---

<a name="15"></a>
## 15. MANTENIMIENTO Y HOJAS DE COMPROBACIÓN

### 15.1 Antes de cada sesión — 30 segundos (etiqueta A)

```
   □ Base NO sobre el colchon
   □ El cordon de 475 mm no toca la almohada en ningun punto del barrido
   □ Pelo largo recogido
   □ Cable recto, sin lazos, <= 300 mm libres sobre el colchon
   □ Cargador sobre superficie dura, fuera de la ropa de cama
   □ Extremidad DESCUBIERTA, mecanismo fuera del edredon
   □ El penacho recupera su forma al apretarlo con la mano
   □ Brocha ya APOYADA sobre la piel antes de pulsar arranque
```

### 15.2 Cada domingo — 5 minutos (etiqueta C)

| Comprobación | Criterio | Si falla |
|---|---|---|
| **Prueba de caída libre, RECORRIDO COMPLETO.** Sin corriente, brazo a mano hasta el **tope lejano (−43°)**, soltar. *(Corrección adversarial: hacerla desde +30° recorre sólo 13° de los 86° y **no visita el tramo superior del tubo**, que es donde vive F-33.)* | **Dentro de ±30 % del tiempo base anotado el día 1** (86° completos, esperado 4–6 s) | **Bastante más rápido** → amortiguador gastado (F-19, benigno). **Más del doble, o no llega solo** → ⚠️ **F-01 O F-33 EN CURSO. NO DUERMAS CON ÉL.** Desmonta el pistón, limpia purga, ranuras de fuga y tubo, PTFE seco |
| **El cordón del contrapeso, en su garganta y tenso** (F-34) | Dentro de la garganta, entre las dos pestañas, sin montarse sobre sí mismo, sin holgura | **Recolócalo y busca por qué se aflojó.** Si el aparato se movió o alguien forzó la botavara a mano, es normal; si pasa solo, la retención está mal hecha |
| **Ensayo de altura en el sitio real de uso** (F-35) | Con la brocha apoyada en la extremidad donde vas a usarla, la charnela debe quedar **a media flotación**, con margen visible arriba y abajo | Si topa arriba: baja la extremidad o sube la máquina. **No la uses así** |
| **Compresión de la brocha** a 41 g | 5,5 – 9,0 mm | 5,0–5,5 → lavar. < 5,0 → lavar y repetir; si sigue, cambiar cabezal |
| **Huella** a 41 g contra un espejo | ≥ 50 mm de diámetro | Lavar; si no se recupera, cambiar |
| **Lavado del cabezal en reposo** a 40 °C, secado boca abajo 12 h | — | — |
| **Limpieza del cuerpo** con alcohol isopropílico (evitando los fieltros) | — | — |

### 15.3 Cada mes — 15 minutos

| Comprobación | Criterio | Si falla |
|---|---|---|
| **Tendón del contrapeso con lupa**, en 3 puntos: salida del tambor, garganta de la polea, amarre al peso | Sin deshilachado, sin aplastamiento, sin nudo corrido | **Sustituir inmediatamente.** Y comprobar que el cordón secundario sigue con sus 2 mm de holgura |
| **Cordón secundario redundante** | Presente, con 2 mm de holgura, sin carga | Rehacerlo |
| **Lastre de latón en su marca testigo** | La marca de rotulador sigue alineada | Recolocar en la escala impresa y **volver a verificar 41 ± 2,5 g en la báscula** |
| **Topes M4** | Apretados, y en agujeros ciegos | Apretar. Si un agujero se ha pasado, taponar con espiga de madera y volver a taladrar |
| **Pestañas y retención de la garganta del tambor** (F-34) | Presentes, sin holgura lateral, cordón capturado | Rehacer antes de volver a usarlo |
| **Recorrido del pistón** (F-33): llevar la botavara a los dos topes a mano y mirar el tubo | El pistón **nunca toca la tapa superior**; el collar tope hace de límite | Reposicionar el collar. **Es un fallo seguro perdido, no un ajuste** |
| **Imán N42 encapsulado y piezas pequeñas** (F-38) | Imán en su epoxi dentro de la columna; lastre, topes y brida en su sitio | Reencapsular. Ninguna pieza suelta menor que 32 × 57 mm puede quedar accesible |
| **Microrruptor de reposo**: pulsar y soltar la palanca | Se oyen los **dos** clics | Sustituir (0,30 €) |
| **Ranura del yugo, fieltros, cubierta del carro** | Sin pelusa acumulada | Aspirar con boquilla fina |
| **Fuerza en cinco puntos del arco** | 41 ± 2,5 g | Recalibrar el lastre |
| **Tensión del tendón de accionamiento** (los dos primeros meses) | Sin holgura | Retensar (creep de la Dyneema, F-28) |

### 15.4 Cada trimestre — 30 minutos

| Comprobación | Criterio |
|---|---|
| Abrir la cubierta del carro, aspirar, **volver a verificar todas las holguras < 1 mm al cerrar** | Galga de 1 mm |
| Riel de las rampas: aspirar el fieltro y repasar con PTFE seco | Fieltro sucio = µ mayor = trepada mayor = **menos margen de fallo seguro** |
| **Repetir el ensayo del mechón de pelo** (§6.3), 15 min | Nada entra |
| **Repetir las tres pruebas × 3 ángulos** (−10, 0, +30) | 3 de 3 |

### 15.5 Cada semestre

| Comprobación | Criterio |
|---|---|
| **Q1 no está en cortocircuito**: con el latch disparado, medir VMOT | **< 0,1 V.** Si lee 5 V, el aparato queda **fuera de servicio** hasta cambiar Q1 |
| **One-shot del TPL5010**: armar y cronometrar sin tocar nada | Dispara entre 850 y 1100 s |
| **Charge pump**: parar GP11 desde consola | VMOT muere en < 250 ms |
| **Prueba de vuelco** en cuatro direcciones | ≥ 5,0 N |

### 15.6 Anual — sustituciones incondicionales

| Pieza | Coste | Por qué incondicional |
|---|---:|---|
| **Los dos cabezales kabuki** | 16,00 € | Es el consumible del aparato. Aunque pasen la autocomprobación, un año de sebo y lavados degrada el haz |
| **El cordón del contrapeso (principal y secundario)** | 3,00 € (10 m) | Es el punto único de fallo del fallo seguro (F-07). 3 € al año es el seguro más barato del proyecto |
| **Fieltro de la taza de reposo y del limpiaparabrisas de la ranura** | ~1,00 € | Fieltro compactado deja de limpiar y empieza a soltar pelusa hacia el mecanismo |
| **Pistón de espuma del amortiguador** | ~0,50 € | La espuma envejece, se endurece y cambia el frenado. Y F-01 es el RPN más alto de la máquina |
| **TOTAL** | **~20,50 €/año** | |

### 15.7 Cuándo dejar de usarlo inmediatamente y no volver a encenderlo hasta arreglarlo

```
 ┌───────────────────────────────────────────────────────────────────────┐
 │  PARA, DESENCHUFA Y NO LO USES SI:                                    │
 │                                                                       │
 │  · La prueba de caída libre tarda más de 5 s, o el brazo no llega     │
 │    al reposo por sí solo.               ← EL FALLO SEGURO NO EXISTE   │
 │  · El brazo está doblado, agrietado o roto.                           │
 │  · Cualquier parte está caliente al tacto.                            │
 │  · El tendón del contrapeso muestra deshilachado en cualquier punto.  │
 │  · La sesión ha terminado con un tirón brusco en vez de con el        │
 │    último golpe suave.                  ← EL FIRMWARE SE COLGÓ        │
 │  · Con el latch disparado, VMOT lee 5 V. ← Q1 EN CORTOCIRCUITO        │
 │  · El brazo se ha atascado durante una sesión.                        │
 │  · El cordón del contrapeso está fuera de su garganta o flojo.        │
 │  · El pistón del amortiguador toca la tapa de arriba del tubo.        │
 │  · Has enchufado el aparato a algo que no es un cargador de 5 V.      │
 │  · La brocha suelta pelo, huele o tiene tacto pegajoso.               │
 │  · Aparece cualquier síntoma respiratorio nocturno.                   │
 │  · Ha aparecido un bebé, un niño o una mascota en la habitación.      │
 └───────────────────────────────────────────────────────────────────────┘
```

---

## CIERRE

Este aparato es defendible por una razón y sólo una: **la mayoría de sus propiedades de seguridad no son funciones, son geometría.** La fuerza normal es un trozo de latón sobre un eje sin actuador. La retirada es un peso colgando de una cuerda. La inmunidad al enredo de pelo es que el eje oscila y se invierte. El techo del calefactor es el valor de una resistencia que falla en circuito abierto. Ninguna de esas cuatro cosas puede ejecutar mal un algoritmo, porque ninguna ejecuta nada.

Lo que sí puede fallar en silencio es lo mecánico, y la revisión adversarial ha subido la cuenta de dos a **cuatro**: **un pistón que se agarrota abajo (F-01), un pistón que se pega arriba contra la tapa (F-33), un cordón que se rompe (F-07) y un cordón que se sale del tambor tras quedar flojo (F-34)**. Ésos son los cuatro fallos de modo común del sistema, y ninguna capa eléctrica puede suplirlos, porque lo que las capas eléctricas hacen es **habilitar** al contrapeso, no sustituirlo. El cordón redundante de veinte céntimos sólo cubre uno de los cuatro. Lo que los cubre todos es **la prueba de caída libre semanal, hecha desde el tope lejano y no desde +30°**, que es medio minuto de trabajo y la comprobación más importante del aparato.

Y una última corrección de honestidad sobre la arquitectura: **esto no son seis capas independientes. Es un actuador de seguridad y cinco habilitadores** — el contrapeso es lo único que mueve la brocha, y las capas 2 a 6 se limitan a cortar VMOT, tres de ellas a través del mismo transistor. Está escrito así en §4.9 porque la versión anterior de este documento se lo ponía demasiado fácil a sí misma, y un dosier de seguridad que se engaña sobre su propia redundancia es peor que no tenerlo.

Y la última: **si empieza a hacerte cosquillas, no está roto. Está sucio.**

---

*Documento 06 de la serie PLUMA-R. Todo número de este documento que contradiga a `final_spec.md` está listado en §14 con su justificación aritmética.*
