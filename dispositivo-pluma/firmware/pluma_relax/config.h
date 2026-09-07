#ifndef CONFIG_H
#define CONFIG_H
// =============================================================================================
//  PLUMA-R  —  config.h  —  TODOS los parametros ajustables del aparato
// =============================================================================================
//
//  Este fichero es el UNICO sitio donde hay numeros. En pluma_relax.ino no debe quedar
//  ni una sola constante magica. Si quieres cambiar el comportamiento de la maquina,
//  se cambia aqui, se recompila y ya esta.
//
//  ORGANIZACION
//    0. Placa, entorno y compilacion
//    1. Pines
//    2. Geometria y cinematica  (de aqui salen todos los pasos/mm)
//    3. Generador de pasos por PIO  y  CLAMP DURO DE VELOCIDAD
//    4. TMC2209 / NEMA 11
//    5. Carro radial  (28BYJ-48 + ULN2003 + husillo T8)
//    6. Perfil de movimiento y los SEIS EJES DE VARIACION (Ornstein-Uhlenbeck)
//    7. Tiempos del ciclo de 15 minutos
//    8. Homing e integridad del microrruptor
//    9. Termica: calefactores y NTC
//   10. Seguridad: latido, watchdog, paro de emergencia, brownout
//   11. LED
//   12. Memoria no volatil (EEPROM emulada)
//
//  CONVENIO DE UNIDADES: milimetros, milisegundos, microsegundos, grados, mN, mA, Celsius.
//  Los nombres llevan sufijo de unidad cuando hay riesgo de confusion (_MM, _S, _MS, _US, _DEG).
//
// =============================================================================================


// =============================================================================================
//  0. PLACA, ENTORNO Y COMPILACION
// =============================================================================================
//
//  DESTINO:  Waveshare RP2040-Zero
//  CORE:     arduino-pico de Earle Philhower  ->  https://github.com/earlephilhower/arduino-pico
//            Probado con la 4.6.1. Cualquier 3.9.x o 4.x vale. Con la 2.x NO compila
//            (cambio de la API de EEPROM y de rp2040.wdt_*).
//
//  Gestor de tarjetas (Arduino IDE -> Preferencias -> URLs adicionales):
//      https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json
//
//  SELECCION DE PLACA Y OPCIONES  (Arduino IDE -> Herramientas). Copialo tal cual:
//      Placa .................... "Waveshare RP2040 Zero"          (familia Raspberry Pi Pico/RP2040)
//      Flash Size ............... "2MB (Sketch: 1984KB, FS: 64KB)"  <- hace falta FS para la EEPROM
//      CPU Speed ................ "125 MHz"                         <- OBLIGATORIO: ver PIO_RELOJ_HZ
//      Optimize ................. "Small (-Os) (standard)"          (tambien vale -O2)
//      USB Stack ................ "Pico SDK"
//      Debug Port ............... "Disabled"
//      Debug Level .............. "None"
//      C++ Exceptions ........... "Disabled"
//      Stack Protector .......... "Disabled"
//      IP/IPv6 Stack ............ "IPv4 Only"  (da igual, no hay radio)
//      Upload Method ............ "Default (UF2)"
//
//  LIBRERIAS (Gestor de librerias). SOLO UNA. Nada exotico:
//      TMCStepper  by teemuatlut   >= 0.7.3
//  Todo lo demas (PIO, PWM, EEPROM emulada, watchdog, temporizador hardware) viene en el core.
//
//  ADVERTENCIA SOBRE LA VELOCIDAD DE RELOJ: el suelo de tiempo del PIO (seccion 3) se calcula
//  a partir del reloj de sistema. El codigo lo lee en tiempo de ejecucion con clock_get_hz(),
//  asi que si cambias el reloj el suelo se mantiene en microsegundos. Aun asi, DEJALO EN 125 MHz.
//
#define PLUMA_VERSION_FIRMWARE   "PLUMA-R 1.0.0"
#define PLUMA_RELOJ_ESPERADO_HZ  125000000UL   // se comprueba en el arranque y se avisa por USB


// =============================================================================================
//  1. PINES  —  identicos a la tabla 3 de docs/04-electronica.md
// =============================================================================================
//  Ojo: son numeros de GPIO del RP2040, que en el RP2040-Zero coinciden con la serigrafia.

#define PIN_TMC_TX          0    // UART0 TX -> 1 kOhm -> PDN_UART del TMC2209 (half-duplex)
#define PIN_TMC_RX          1    // UART0 RX <- mismo nudo
#define PIN_STEP            2    // >>> lo genera el PIO0 SM0. NO lo toques con digitalWrite <<<
#define PIN_DIR             3    // solo se cambia con la maquina parada y el PIO vacio
#define PIN_nEN             4    // ACTIVO A NIVEL BAJO. Pull-UP externo de 10k (correccion C-3)
#define PIN_DIAG            5    // StallGuard4 + sobretemperatura. Activo ALTO. Pull-down externo
#define PIN_SW_PARK         6    // microrruptor de leva. Contacto NA a GND: BAJO = EN REPOSO
#define PIN_BTN_START       7    // pulsador de silicona a GND, pull-up
#define PIN_HEAT_CUP        8    // MOSFET del calefactor de la taza (47 ohm). PWM lento por software
#define PIN_HEAT_FER        9    // MOSFET del calefactor de la ferula (120 ohm). PWM lento por software
#define PIN_MOTOR_KILL     10    // pulso alto de 10 ms -> SET del CD4013 -> el firmware mata su rail
#define PIN_HEARTBEAT      11    // latido de 2 kHz hacia el charge pump. Ver seccion 10
#define PIN_ULN_IN1        13    // 28BYJ-48 fase A   (PWM 20 kHz, slice 6B)
#define PIN_ULN_IN2        14    // 28BYJ-48 fase B   (PWM 20 kHz, slice 7A)
#define PIN_ULN_IN3        15    // 28BYJ-48 fase C   (PWM 20 kHz, slice 7B)
#define PIN_ULN_IN4        26    // 28BYJ-48 fase D   (PWM 20 kHz, slice 5A)  — pin ADC usado como digital
#define PIN_LED_RED        17    // unico indicador luminoso (PWM 1 kHz, slice 0B)

// Entradas analogicas. En el core de Philhower, A0=GP26, A1=GP27, A2=GP28, A3=GP29.
#define ADC_NTC_FER        27    // GP27 = A1, divisor 10k / NTC de la ferula
#define ADC_VBUS_SENSE     28    // GP28 = A2, divisor 10k/10k desde VBUS
#define ADC_NTC_CUP        29    // GP29 = A3, divisor 10k / NTC de la taza (pad trasero, soldar hilo)
//
//  NOTA IMPORTANTE SOBRE GP12: el RP2040 SOLO tiene ADC en GP26..GP29. GP12 NO puede leer
//  analogico. La tabla de 04-electronica.md pide "GP12 RAIL_SENSE (ADC)" y eso es IMPOSIBLE.
//  CORRECCION APLICADA: RAIL_SENSE se lee como ENTRADA DIGITAL en GP12, con el divisor
//  10k/10k desde VMOT. Con VMOT = 5,0 V el nudo esta a 2,5 V (nivel ALTO seguro para el
//  RP2040, cuyo VIH es 2,0 V); con VMOT = 0 el nudo esta a 0 V (BAJO). Eso basta y sobra
//  para lo unico que necesitamos: saber si el rail del motor esta vivo o muerto.
//  Perdemos la distincion fina "S1 pulsado" vs "latch disparado", que se recupera cruzando
//  RAIL_SENSE (GP12, digital) con VBUS_SENSE (GP28, analogico de verdad).
//
#define PIN_RAIL_SENSE_DIG 12
#define UMBRAL_VBUS_ABORTO_CUENTAS  2978   // 4,80 V con divisor 10k/10k y ADC de 12 bits
#define VBUS_LECTURAS_MALAS_SEGUIDAS   3   // 3 lecturas a 20 Hz = 150 ms antes de abortar

#define ADC_BITS            12   // analogReadResolution(12): 0..4095
#define ADC_CUENTAS_MAX   4095.0f
#define ADC_VREF_V           3.3f


// =============================================================================================
//  2. GEOMETRIA Y CINEMATICA
// =============================================================================================
//  De estos ocho numeros sale absolutamente todo lo demas. Si mides tu maquina y algo
//  no cuadra, cambialo AQUI y no toques nada mas.

#define MOTOR_PASOS_POR_VUELTA   200.0f   // NEMA 11 de 1,8 grados
#define MICROSTEPPING             32.0f   // CHOPCONF.MRES = 3. MicroPlyer interpola a 1/256
#define REDUCCION_CABRESTANTE  14.2857f   // sector de 60 mm / radio efectivo del cabrestante 4,2 mm

// Micropasos por grado de BARRIDO del sector:
//   200 x 32 x 14,2857 / 360 = 253,968
#define UPASOS_POR_GRADO  ( MOTOR_PASOS_POR_VUELTA * MICROSTEPPING * REDUCCION_CABRESTANTE / 360.0f )

// Radio de la punta al eje de barrido. El carro radial lo mueve +/-25 mm.
#define RADIO_NOMINAL_MM     300.0f
#define RADIO_MIN_MM         275.0f
#define RADIO_MAX_MM         325.0f

// Milimetros de arco de punta por micropaso, a un radio dado:
//   mm = R * (pi/180) / UPASOS_POR_GRADO
//   a R=300 -> 0,020614 mm/upaso  (= 0,65964 mm por paso completo)
#define MM_POR_UPASO(R)   ( (R) * 0.01745329f / UPASOS_POR_GRADO )

// ---- ZONAS DEL RAIL, por angulo de barrido |phi| en grados -----------------------------------
//  0 .. 19    SIN RAIL. Brocha en la piel a 400 mN. 199 mm de arco a R=300.
// 19 .. 26    TAPER. El rail sube 0 -> 2,6 mm. La fuerza baja 400 -> 0 mN. 36,7 mm de arco.
// 26 .. 34    ELEVACION. Rail h_t -> h_t+4,42 mm, pendiente 11,9 grados. La punta queda
//             11,8 mm en el aire.  (CORRECCION C2/D2 de 02-mecanica.md: la spec decia 26-33,
//             que son 13,6 grados de pendiente y 70,5 mN.m de trepada, y el fallo seguro no
//             cerraba. Con 26-34 la trepada es 66 mN.m y el margen 1,37x.)
// 34 .. 43    MESETA PLANA, 47,1 mm de arco a R=300. La taza de reposo caliente esta al final
//             de la meseta, sobre un pedestal, NO al final de una rampa de subida
//             (CORRECCION D1 de 02-mecanica.md: la rampa 40-43 a 11 mm exigia 113 mN.m de
//             trepada y dejaba el fallo seguro en 1,09x).
//             VENTANA UTILIZABLE DE INVERSION: 35 .. 41 grados = 31,42 mm = +/-15,7 mm,
//             con 1 grado de guarda contra el tope y 2 contra la zona de despegue
//             (05-algoritmo-movimiento.md C-08).
#define ANG_CONTACTO_DEG      19.0f
#define ANG_TAPER_DEG         26.0f
#define ANG_ELEVACION_DEG     34.0f
#define ANG_MESETA_FIN_DEG    43.0f
#define ANG_REPOSO_DEG        43.0f   // tope mecanico M4 en agujero ciego
#define ANG_SW_CIERRA_DEG     42.0f   // el microrruptor cierra 1 grado antes del tope

//  SIGNO: los angulos POSITIVOS van hacia el REPOSO (donde tira el contrapeso).
//  El lado NEGATIVO (-43 grados) es el "lado lejano", cuesta arriba contra el contrapeso.
//  El reposo y la taza caliente estan SOLO en el lado positivo.

// ---- Direccion de giro -----------------------------------------------------------------------
//  COMO AVERIGUARLO (hazlo antes del primer montaje del tendon):
//    1. Deja el tendon DESENGANCHADO del cabrestante.
//    2. Compila con DIR_HACIA_REPOSO = HIGH y ejecuta el homing.
//    3. Mira hacia donde gira el eje del motor. Si enrolla el tendon en el sentido que
//       SUBIRIA el contrapeso, tienes el signo cambiado: pon LOW y recompila.
//  Alternativa sin recompilar: intercambia los dos hilos de UNA bobina del motor.
#define DIR_HACIA_REPOSO   HIGH
#define DIR_HACIA_LEJOS    LOW
#define DIR_SETUP_US        50   // microsegundos entre cambiar DIR y el primer flanco de STEP
                                 // (el TMC2209 pide >= 20 ns; damos 50 us por pura holgura)


// =============================================================================================
//  3. GENERADOR DE PASOS POR PIO  Y  EL CLAMP DURO DE VELOCIDAD
// =============================================================================================
//
//  ############################################################################################
//  #  EL SUELO DE 240 us ES EL TOPE DE 10 cm/s. LEE ESTO ANTES DE TOCAR NADA AQUI.            #
//  ############################################################################################
//
//  El programa del PIO (esta escrito instruccion a instruccion en pluma_relax.ino) tiene esta
//  forma, con un tick de PIO de 1 microsegundo exacto:
//
//      0: pull block          ; 1 us   espera un dato del firmware = "retardo EXTRA en us"
//      1: mov x, osr          ; 1 us   x = retardo extra
//      2: set pins, 1 [9]     ;10 us   STEP a nivel ALTO durante 10 us
//      3: set pins, 0         ; 1 us   STEP a nivel BAJO   (0xE000: SIN retardo. La tabla
//                                      anterior decia "[1] ; 2 us" y no cuadraba con el opcode)
//      4: set y, 6            ; 1 us
//      5: jmp y--, 5 [31]     ;224 us  <<<<<< SUELO COMPILADO: 7 vueltas x 32 ciclos
//      6: jmp x--, 6          ;x+1 us  retardo adicional que pide el firmware (x saltos + 1 caida)
//      7: jmp 0               ; 1 us
//                             --------
//                 FIJO         240 us   +  x
//
//  El firmware SOLO puede escribir x. x es un entero sin signo: no existe un x que reste.
//  Aunque el planificador se vuelva loco y pida x = 0 en cada micropaso, el PIO no puede
//  emitir mas de 1/240us = 4166,7 pulsos por segundo. Traducido a velocidad de punta:
//
//      4166,7 pulsos/s / 32 = 130,2 pasos completos/s
//      a R = 300 mm:  130,2 x 0,65964 mm =  85,9 mm/s  =  8,59 cm/s
//      a R = 325 mm:  130,2 x 0,71462 mm =  93,0 mm/s  =  9,30 cm/s   <- PEOR CASO
//
//  9,30 cm/s < 10 cm/s.  El tope se cumple en TODO el rango del carro radial.
//
//  HONESTIDAD SOBRE LO QUE ESTE TOPE **NO** ES (correccion C-2 de 04-electronica.md):
//    - El suelo esta en la MEMORIA DE INSTRUCCIONES del PIO, no en una variable. Un bucle
//      colgado, un puntero desbocado o un planificador con un signo cambiado no lo pueden
//      mover. Contra ESO protege, y protege de verdad.
//    - Pero el divisor de reloj del PIO y el microstepping del TMC2209 (CHOPCONF.MRES, que
//      va por UART) SI son escribibles por la CPU. Codigo arbitrario y malicioso podria
//      subir la velocidad. Esto es una barrera contra ERRORES DE DISENO, no un sandbox.
//    - Mitigacion que SI cierra el agujero del microstepping, y es gratis (ver la
//      "VARIANTE ENDURECIDA" de 04-electronica.md seccion 3): ata MS1 = MS2 = 3V3, pon
//      TMC_MSTEP_POR_REGISTRO = false y MICROSTEPPING = 16. Entonces el UART no puede
//      cambiar los mm/pulso y hay que subir el suelo a 480 us (ver PIO_SUELO_US).
//    - Mitigacion parcial que SI esta implementada: antes de cada golpe se relee CHOPCONF
//      por UART y se comprueba que MRES sigue siendo el que pedimos. Si no, FAULT.
//
//  TECHO REAL DEL PIO EN LOS TRES RADIOS (calculado, no estimado):
//      R = 275 mm (carro al fondo)  ->  0,60476 mm/paso  ->  7,87 cm/s
//      R = 300 mm (centro)          ->  0,65974 mm/paso  ->  8,59 cm/s
//      R = 325 mm (carro al frente) ->  0,71471 mm/paso  ->  9,31 cm/s   <- peor caso
//  Los tres estan por debajo de los 10 cm/s. Fijate en que en el radio INTERIOR el techo
//  (7,87 cm/s) queda muy cerca del extremo alto de la banda nominal (7,0 cm/s): es
//  deliberado. Significa que no queda margen para que un error de planificacion pase
//  inadvertido, porque cualquier peticion por encima de 7,87 cm/s a ese radio la recorta el
//  hardware y el golpe tarda mas de lo previsto, que es una senal observable.
//
#define PIO_TICK_US            1.0f    // 1 tick de PIO = 1 microsegundo
#define PIO_SUELO_US            240u   // <<< con MICROSTEPPING = 32 (1/32)
// #define PIO_SUELO_US         480u   // <<< con la VARIANTE ENDURECIDA a 1/16 por pines
#define PIO_ANCHO_PULSO_US       10u   // solo informativo: esta compilado en la instruccion 2
#define PIO_RETARDO_EXTRA_MAX 200000u  // 200 ms de intervalo maximo = 0,10 mm/s. Reptar, no parar.

#define PIO_INSTANCIA         pio0
#define PIO_SM                   0
#define PIO_ORIGEN               0     // el programa DEBE cargarse en la direccion 0 de la
                                       // memoria de instrucciones, porque los jmp son absolutos
                                       // (no usamos pioasm, asi que no hay reubicacion)

// Buffer circular productor/consumidor entre el bucle principal y la ISR de 8 kHz.
// A 4166 pulsos/s, 256 huecos son 61 ms de holgura para el bucle principal.
#define BUFFER_PASOS_N          256    // POTENCIA DE DOS OBLIGATORIA (se usa mascara)
#define BUFFER_PASOS_MASCARA  (BUFFER_PASOS_N - 1)

// Temporizador hardware que alimenta el FIFO del PIO, genera el latido y mueve el carro.
#define TICK_ISR_US             125    // 8 kHz. Comodo margen sobre los 4166 pulsos/s maximos.
#define ISR_PUSH_MAX_POR_TICK     4    // cuantas palabras empuja al FIFO del PIO en cada tick


// =============================================================================================
//  4. TMC2209 / NEMA 11 11HS12-0674S
// =============================================================================================

#define TMC_BAUDIOS          115200
#define TMC_DIRECCION          0b00   // MS1 = MS2 = GND
#define TMC_R_SENSE            0.11f  // >>> MIDELO CON EL POLIMETRO EN TU MODULO <<<
                                      //     Hay clones con 0,15 ohm: eso desplaza la
                                      //     corriente real un 36 %.
#define TMC_VERSION_ESPERADA   0x21   // IOIN bits 31:24. Si no es 0x21, es un clon o el UART esta muerto
#define TMC_MSTEP_POR_REGISTRO true   // GCONF.mstep_reg_select. false en la VARIANTE ENDURECIDA
#define TMC_TIMEOUT_UART_MS      50

//  ---- CORRIENTES, en unidades CS (0..31) del registro IHOLD_IRUN --------------------------
//  Formula del datasheet con vsense = 1 (V_fs = 0,180 V) y R_sense = 0,11 ohm:
//        I_rms = (CS+1)/32 * 0,180/(0,11+0,02) * 1/raiz(2) = (CS+1)/32 * 0,9791 A
//
//     CS =  0  ->  0,0306 A        CS =  7  ->  0,2448 A
//     CS =  1  ->  0,0612 A        CS = 10  ->  0,3366 A   <- IRUN nominal
//     CS =  4  ->  0,1530 A        CS = 12  ->  0,3978 A   <- contingencia de la spec
//
#define TMC_IRUN_CS              10   // 0,337 A rms  = 49 % del nominal de 0,67 A
#define TMC_IRUN_CS_CONTINGENCIA 12   // 0,398 A. Sube a esto SOLO si pierdes pasos de verdad
#define TMC_IRUN_CS_HOMING        4   // 0,153 A. Un homing no tiene por que empujar fuerte

//  ---- IHOLD: AQUI HAY UNA CORRECCION IMPORTANTE DE LA ESPECIFICACION ----------------------
//
//  La especificacion vinculante dice: "IHOLD 0 at the park side, 0.05 A for short far-side
//  dwells". La segunda mitad NO SE SOSTIENE, y este es el calculo:
//
//      Sesgo permanente del contrapeso, referido al SECTOR ......... 247 mN.m
//      Referido al EJE DEL MOTOR (dividido por 14,2857) ............ 17,3 mN.m
//
//      Par de retencion del NEMA 11 (70 mN.m a 0,67 A, aprox. lineal):
//          a 0,050 A  ->  70 x 0,050/0,67 =  5,2 mN.m     <- NO SUJETA. Se escapa.
//          a 0,061 A  ->                     6,4 mN.m     <- NO SUJETA.
//          a 0,153 A  ->                    16,0 mN.m     <- justito, sin margen
//          a 0,245 A  ->                    25,6 mN.m     <- 1,48x. ELEGIDO.
//          a 0,337 A  ->                    35,2 mN.m     <- 2,04x
//
//  El detente (8 mN.m) ayuda, pero apoyarse en el detente para sujetar un peso encima de
//  una persona dormida es exactamente el tipo de margen que no se coge.
//
//  REGLA IMPLEMENTADA, y es distinta segun DONDE se pare la maquina:
//
//     EN EL REPOSO (+43 grados, contra el tope mecanico M4):
//         IHOLD = 0  +  PWMCONF.freewheel = 01  ->  bobinas en ALTA IMPEDANCIA, corriente
//         CERO DE VERDAD, cero zumbido, cero calor, cero par de frenado. El tope M4 aguanta
//         el contrapeso, no el motor. Estados IDLE, PREWARM, visitas a la taza, RETREAT, FAULT.
//
//     FUERA DEL REPOSO (cualquier pausa entre golpes, en la meseta plana de cualquier lado):
//         IHOLD = 7 (0,245 A). El motor TIENE que sujetar activamente contra el contrapeso.
//         Con IHOLDDELAY = 15 la bajada de corriente es una rampa de ~330 ms, no un corte
//         seco: sin "clac" audible. StealthChop2 a 35 kHz en parada es inaudible.
//
//  Consecuencia honesta: durante los ~64 huecos entre golpes el motor SI disipa (0,67 W a
//  0,245 A). Ya estaba contemplado en el presupuesto de 04-electronica.md, que cuenta el
//  motor al 100 % de duty. No cambia ninguna conclusion termica ni de alimentacion.
//
#define TMC_IHOLD_CS_REPOSO       0   // + freewheel = 01  ->  corriente cero real
#define TMC_IHOLD_CS_FUERA        7   // 0,245 A: sujeta el contrapeso con 1,48x de margen
#define TMC_IHOLDDELAY           15   // ~330 ms de rampa al bajar a IHOLD. Silencio.
#define TMC_TPOWERDOWN           20   // 20 * 2^18 / 12 MHz = 0,44 s antes de empezar la rampa

//  ---- Chopper y StealthChop ----------------------------------------------------------------
#define TMC_TOFF                  4
#define TMC_BLANK_TIME           24   // TBL = 2, el ajuste silencioso recomendado
#define TMC_VSENSE             true   // V_fs = 0,180 V
#define TMC_INTPOL             true   // MicroPlyer: interpola 1/32 -> 1/256 = 2,58 um/upaso
#define TMC_TPWMTHRS       0xFFFFFUL  // StealthChop2 PERMANENTE. Nunca cede a SpreadCycle.
#define TMC_PWM_FREQ              1   // 1 = 35,1 kHz.  Pon 2 (46,9 kHz) si tienes perro o gato.
#define TMC_SENDDELAY             2   // SLAVECONF: 8 tiempos de bit de guarda. OBLIGATORIO.

//  ---- freewheel: NO es una optimizacion de consumo, es parte del fallo seguro --------------
//  En el TMC2209, IHOLD = 0 NO es corriente cero: CS = 0 es el escalon mas bajo (~30 mA) y
//  los puentes siguen en BAJA IMPEDANCIA, lo que FRENA POR CORRIENTES INDUCIDAS y se opone
//  a los 247 mN.m del contrapeso.
//      01 = rueda libre, cuatro salidas en alta impedancia   <- ESTE, obligatorio
//      10 y 11 = bobinas cortocircuitadas = FRENO MAGNETICO  <- PROHIBIDOS
#define TMC_FREEWHEEL             1

//  ---- StallGuard4: red SECUNDARIA, nunca la primera ----------------------------------------
//  Ver el comentario largo en pluma_relax.ino, funcion vigilar_stallguard().
#define TMC_TCOOLTHRS          2000   // SG activo cuando TSTEP <= 2000, es decir > ~2,4 cm/s
#define TMC_SGTHRS               40   // >>> AJUSTALO EMPIRICAMENTE con el brazo cargado <<<
#define SG_VELOCIDAD_MIN_FIABLE_MMS 30.0f  // por debajo de 3,0 cm/s el motor gira a menos de
                                           // 13,6 rpm y StallGuard deja de valer. Se IGNORA.
#define SG_DISPAROS_SEGUIDOS      3   // 3 lecturas seguidas de DIAG antes de creerselo

//  ---- Convergencia de la regulacion StealthChop --------------------------------------------
#define PWM_SCALE_SUM_MIN        10   // si PWM_SCALE_SUM se pega a 0 o a 255 la regulacion
#define PWM_SCALE_SUM_MAX       200   // no esta convergiendo -> FAULT


// =============================================================================================
//  5. CARRO RADIAL  (28BYJ-48 + ULN2003 + husillo T8 de 8 mm de paso)
// =============================================================================================
//
//  El carro traslada TODA la bisagra de cabeceo +/-25 mm en radio. Como la bisagra y el
//  lastre de laton viajan juntos, la fuerza de contacto es EXACTAMENTE invariante.
//
//  Numeros del 28BYJ-48:
//      motor interno: 32 pasos completos/vuelta, reductora 63,684:1
//      -> 2048 pasos completos por vuelta de SALIDA (redondeo habitual)
//      microstepping senoidal por PWM: 8 micropasos por paso completo (tabla de 32 puntos
//      sobre un ciclo electrico = 4 pasos completos)
//      -> 16384 micropasos por vuelta de salida
//      husillo T8 de 8 mm de paso -> 2048 micropasos por milimetro
//
#define CARRO_UPASOS_POR_VUELTA  16384.0f
#define CARRO_PASO_HUSILLO_MM        8.0f
#define CARRO_UPASOS_POR_MM   ( CARRO_UPASOS_POR_VUELTA / CARRO_PASO_HUSILLO_MM )  // 2048
#define CARRO_TABLA_N                 32    // puntos de la tabla senoidal por ciclo electrico
#define CARRO_PWM_HZ              20000     // 20 kHz: por encima del oido, y suaviza los escalones
#define CARRO_PWM_WRAP              999     // resolucion de 1000 niveles
#define CARRO_PWM_AMPLITUD          999     // amplitud maxima de la senoide (0..CARRO_PWM_WRAP)

//  Velocidad: la ISR de 8 kHz avanza un micropaso cada CARRO_DIVISOR_TICKS ticks.
//      divisor 2 -> 4000 upasos/s -> 1,95 mm/s -> 14,6 rpm de salida
//  14,6 rpm es el TECHO REAL de un 28BYJ-48 a 5 V. Si el tuyo pierde pasos o suena,
//  sube el divisor a 3 (2667 upasos/s, 1,30 mm/s, 9,8 rpm). Es mas lento pero mas silencioso.
#define CARRO_DIVISOR_TICKS           2
#define CARRO_VEL_MM_S  ( (1000000.0f / (TICK_ISR_US * CARRO_DIVISOR_TICKS)) / CARRO_UPASOS_POR_MM )

#define CARRO_RECORRIDO_MM         25.0f   // +/- respecto al centro (R = 300 mm)
#define CARRO_MARGEN_SEGURIDAD_MM   1.0f   // no se acerca mas que esto a los topes mecanicos

//  ---- La regla del "nunca repetir" y por que el salto va acotado --------------------------
//
//  CORRECCION ARITMETICA DE LA ESPECIFICACION. La spec dice "2,5 s por movimiento de 5 mm"
//  Y TAMBIEN "movimiento programado para solaparse con el ultimo 20 % del golpe anterior".
//  Las dos cosas no caben juntas:
//      a 1,95 mm/s, un salto de  5 mm tarda  2,56 s
//      un salto de 12 mm tarda  6,15 s
//      un salto de 25 mm tarda 12,8 s
//  y el ultimo 20 % de un golpe de 273 mm de contacto a 3 cm/s son 1,82 s = 3,5 mm.
//  Solo caben 3,5 mm dentro de la ventana de enmascarado.
//
//  SOLUCION IMPLEMENTADA (y es honesta, no un apano):
//    1. El salto va ACOTADO a [6, 12] mm. El 6 viene de la regla dura de la spec
//       ("cada golpe difiere >= 6 mm de cada uno de los dos anteriores"); el 12 es el
//       maximo que cabe en la ventana de enmascarado + un hueco de duracion razonable.
//    2. El movimiento ARRANCA con el golpe al 80 % de su contacto (parte enmascarada por
//       el rasgueo de las cerdas) y PUEDE CONTINUAR durante el hueco, donde la brocha
//       esta 11,8 mm en el aire y lo unico en juego es el ruido, no el tacto.
//    3. El hueco es ELASTICO: si el carro no ha terminado, el siguiente golpe espera,
//       hasta GAP_MAX_ABSOLUTO_S. Nunca se arranca un golpe con el carro moviendose.
//
#define CARRO_SALTO_MIN_MM          6.0f
#define CARRO_SALTO_MAX_MM         12.0f
#define CARRO_SEPARACION_MIN_MM     6.0f   // regla dura: >= 6 mm respecto a los DOS anteriores
#define CARRO_INTENTOS_SORTEO         40   // si no encuentra hueco, relaja el tope de salto
#define CARRO_ARRANQUE_FRACCION     0.80f  // arranca al 80 % del contacto del golpe anterior

//  ---- Cada cuantos golpes se mueve el carro -----------------------------------------------
//  TRES DOCUMENTOS DICEN TRES COSAS DISTINTAS y hay que elegir una:
//     final_spec.md ..... "R re-drawn each gap"          -> 64 movimientos por sesion
//     04-electronica ..... presupuesto con "12 movimientos"
//     final_spec (acustica) "plan B: 8 moves per session"
//  ELEGIDO: uno cada 4 golpes = 16 por sesion. Razones:
//     - la propia investigacion pide "un movimiento lateral cada 6-10 golpes" para
//       deshabituar; cada 4 va sobrado.
//     - 16 eventos impulsivos por noche, cada uno enmascarado, es defendible frente al
//       criterio de aceptacion (delta ON/OFF en la almohada por debajo de 3 dB).
//     - si el criterio de la almohada no se cumple, sube a 8 (plan B de la spec).
#define CARRO_MOVER_CADA_N_GOLPES     4
#define CARRO_HOMING_AL_ARRANCAR  false  // el carro NO tiene final de carrera. Se asume que
                                         // arranca centrado (marca de lapiz en la varilla) y
                                         // el firmware lleva la cuenta. Es back-drivable: si
                                         // lo empujas con el dedo, la cuenta se pierde.
                                         // Al terminar la sesion vuelve al centro por si acaso.


// =============================================================================================
//  6. PERFIL DE MOVIMIENTO Y LOS SEIS EJES DE VARIACION (ORNSTEIN-UHLENBECK)
// =============================================================================================
//
//  Un paseo de Ornstein-Uhlenbeck es un ruido que vuelve a su media. Discretizado por golpe:
//
//      x[n+1] = mu + (x[n] - mu) * exp(-1/tau)  +  sigma * sqrt(1 - exp(-2/tau)) * N(0,1)
//
//  tau esta en GOLPES. sigma es la desviacion tipica estacionaria (no la del escalon).
//  En los bordes se REFLEJA (no se recorta): recortar hace que el paseo se quede pegado
//  al limite, y eso se percibe como una sucesion de golpes identicos.
//
//  Los seis ejes son los que exige la especificacion vinculante. Ni uno mas ni uno menos.

// --- EJE 1: VELOCIDAD DE CRUCERO (mm/s de punta) --------------------------------------------
//  Banda 2,0-7,0 cm/s. La media cambia por bloque (estructura de sesion de la spec).
#define OU_VEL_TAU_GOLPES        6.0f
#define OU_VEL_SIGMA_MMS         8.0f      // 0,8 cm/s
#define OU_VEL_MIN_MMS          20.0f      // 2,0 cm/s
#define OU_VEL_MAX_MMS          70.0f      // 7,0 cm/s
#define OU_VEL_MEDIA_BLOQUE_1   32.0f      // 3,2 cm/s
#define OU_VEL_MEDIA_BLOQUE_2   26.0f      // 2,6 cm/s
#define OU_VEL_MEDIA_BLOQUE_3   41.0f      // 4,1 cm/s
#define OU_VEL_MEDIA_BLOQUE_4   29.0f      // 2,9 cm/s

// --- EJE 2: HUECO SIN CONTACTO (segundos) ----------------------------------------------------
#define OU_HUECO_TAU_GOLPES      4.0f
#define OU_HUECO_MEDIA_S         3.5f
#define OU_HUECO_SIGMA_S         1.1f
#define OU_HUECO_MIN_S           1.5f
#define OU_HUECO_MAX_S           5.5f
#define GAP_MAX_ABSOLUTO_S      10.0f      // techo duro si el carro se retrasa

// --- EJE 3: DURACION DE LA RAMPA DE ATERRIZAJE (segundos) ------------------------------------
//  La forma de la rampa de fuerza es GEOMETRICA (la da el rail). El firmware solo la
//  escala en el tiempo: elige a que velocidad se atraviesa el taper de 36,7 mm.
//
//  LIMITACION FISICA QUE LA SPEC NO MENCIONA: con un taper de longitud fija y una
//  velocidad de salida ya comprometida (la de crucero), la duracion alcanzable es
//        t_rampa ~= 2 * L_taper / (v_entrada + v_crucero)
//  asi que 2,5 s SOLO es alcanzable a velocidades de crucero bajas:
//        v_crucero 20 mm/s, v_entrada 5 mm/s  ->  t = 73,3/25 = 2,93 s   OK
//        v_crucero 30 mm/s, v_entrada 5 mm/s  ->  t = 73,3/35 = 2,09 s   <2,5
//        v_crucero 70 mm/s, v_entrada 5 mm/s  ->  t = 73,3/75 = 0,98 s   <2,5
//  El firmware sortea t_rampa del paseo OU y luego lo RECORTA a la banda alcanzable
//  para esa v_crucero. Se registra por USB cuantas veces se ha tenido que recortar.
#define OU_RAMPA_TAU_GOLPES      5.0f
#define OU_RAMPA_MEDIA_S         1.4f
#define OU_RAMPA_SIGMA_S         0.55f
#define OU_RAMPA_MIN_S           0.6f
#define OU_RAMPA_MAX_S           2.5f
#define V_ENTRADA_TAPER_MIN_MMS  5.0f      // mas lento que esto y el aterrizaje "se para"
#define V_ENTRADA_TAPER_MAX_MMS 70.0f      // CORRECCION DE VERIFICACION (era 75): el taper NO es
                                           // aire, es contacto a fuerza parcial, asi que la punta
                                           // tampoco puede pasar ahi de los 7,0 cm/s de la banda
                                           // vinculante. Ademas 75 desbordaba el recorte que
                                           // mov_velocidad() aplica ahora a OU_VEL_MAX_MMS, y el
                                           // estimador de tiempo (tiempo_quintica) no lo veia:
                                           // el golpe habria durado mas de lo planificado.

// --- EJE 4: PUNTO DE INVERSION EN LA MESETA PLANA (grados) -----------------------------------
//  La meseta FISICA va de 34 a 43 grados (47,1 mm de arco). La ventana UTILIZABLE de
//  inversion es 35-41 grados = 31,42 mm = +/-15,7 mm, que es el "+/-16 mm" de la spec.
#define OU_INVER_TAU_GOLPES      3.0f
#define OU_INVER_MEDIA_DEG      38.0f     // centro de la ventana utilizable 35-41 grados
#define OU_INVER_SIGMA_DEG       1.6f
#define OU_INVER_MIN_DEG        35.0f     // 2 grados de guarda sobre el fin del despegue (34)
#define OU_INVER_MAX_DEG        41.0f     // 2 grados de guarda bajo el tope M4 (43)

// --- EJE 5: PASADAS ROZADAS (turnaround dentro del taper) ------------------------------------
//
//  #### CONTRADICCION DE LA ESPECIFICACION, DECLARADA EN VOZ ALTA ####
//  Los PARAMETROS VINCULANTES dicen: "Despegue completo antes de cada inversion".
//  La seccion MOTION de la MISMA especificacion dice: "turnaround anywhere in the 37 mm
//  flat top OR INSIDE THE TAPER for 150-300 mN grazing strokes".
//  Son incompatibles: invertir dentro del taper es, por definicion, invertir CON LA BROCHA
//  TOCANDO (a fuerza parcial). Y la spec exige ademas las "pasadas rozadas" como uno de los
//  seis ejes de variacion.
//
//  DECISION: se implementan, porque son un eje obligatorio, pero:
//     - con probabilidad baja y configurable (por defecto 15 %),
//     - NUNCA dos seguidas,
//     - NUNCA durante el bloque 1 (el bloque de entrada, donde la spec pide el aterrizaje
//       mas suave posible),
//     - NUNCA en el lado del reposo (para no comprometer nunca el camino de retirada),
//     - y con OU_ROZADA_PROB = 0.0 se desactivan del todo y se recupera literalmente el
//       "despegue completo antes de cada inversion". Es una linea de config.
//
//  Profundidad de la rozada = angulo al que se invierte, DENTRO del taper (19..26 grados).
//  Cuanto mas cerca de 19, mas fuerza queda en la brocha al invertir:
//      26,0 grados -> ~0 mN     (equivale a no rozar)
//      23,5 grados -> ~150 mN
//      21,5 grados -> ~250 mN
//      20,5 grados -> ~300 mN   <- tope: no bajamos de aqui
#define OU_ROZADA_PROB           0.15f
#define OU_ROZADA_TAU_GOLPES     4.0f
//  Modelo lineal de 05-algoritmo-movimiento.md:  F = 400 * (26 - phi) / 7  [mN]
//  La banda que fija la spec es 150-300 mN  ->  phi entre 20,75 y 23,40 grados.
#define OU_ROZADA_MEDIA_DEG     22.5f     // 200 mN
#define OU_ROZADA_SIGMA_DEG      0.8f
#define OU_ROZADA_MIN_DEG       20.75f    // 300 mN, el maximo que permite la spec
#define OU_ROZADA_MAX_DEG       23.40f    // 150 mN, el minimo que permite la spec
#define ROZADA_PROHIBIDA_BLOQUE_1 true
#define ROZADA_SOLO_LADO_LEJANO   true

// --- EJE 6: RADIO (carro radial) --------------------------------------------------------------
//  Aqui el paseo OU sortea el DESTINO, y luego la regla dura de separacion y el tope de
//  salto lo filtran. Ver seccion 5.
#define OU_RADIO_TAU_GOLPES      8.0f
#define OU_RADIO_MEDIA_MM        0.0f     // centro = R 300 mm
#define OU_RADIO_SIGMA_MM        9.0f
#define OU_RADIO_MIN_MM        (-CARRO_RECORRIDO_MM + CARRO_MARGEN_SEGURIDAD_MM)
#define OU_RADIO_MAX_MM        ( CARRO_RECORRIDO_MM - CARRO_MARGEN_SEGURIDAD_MM)

// --- Perfil trapezoidal limitado en jerk ------------------------------------------------------
//  Todas las aceleraciones y deceleraciones ocurren entre el punto de inversion y el
//  principio del taper, es decir en la MESETA PLANA y la ZONA DE ELEVACION, con la brocha
//  11,8 mm en el aire. Nunca sobre la piel.
//
//  La forma de la rampa es una QUINTICA DE JERK MINIMO:  f(u) = u^3 (10 - 15u + 6u^2)
//  que vale 0 en u=0, 1 en u=1, y tiene DERIVADA PRIMERA Y SEGUNDA NULAS en ambos extremos.
//  Traducido: aceleracion cero y JERK CERO al arrancar y al terminar la rampa. Un trapecio
//  clasico tiene jerk infinito en las esquinas y eso se oye (y en un tendon de Dyneema, se
//  nota como un tirón).
//
//  ###############################################################################################
//  #  CORRECCION MAYOR DE LA VERIFICACION: V_ARRANQUE_MMS = 0,6 mm/s COSTABA 2,3 s POR LADO.     #
//  ###############################################################################################
//
//  El tramo de vuelo (eje 7) arregla el CRUCERO por el aire, pero no el arranque: la rampa de
//  aceleracion sigue siendo una quintica, y una quintica es PLANISIMA cerca de u = 0. Con
//  V_ARRANQUE_MMS = 0,6 mm/s, en el primer 11 % de los 14,1 mm de rampa la punta va todavia por
//  debajo de 1,2 mm/s, y eso son 2,3 segundos de reptar. Medido en simulacion/test_movimiento.cpp:
//
//      v_arranque |  t_vuelo por lado (L = 55 mm, v_ent 8..70 mm/s)  |  2 x t = hueco MINIMO
//         0,6     |            3,93 .. 3,50 s                        |     7,0 .. 7,9 s
//         2,0     |            2,38 .. 1,95 s                        |     3,9 .. 4,8 s
//         6,0     |            1,71 .. 1,28 s                        |     2,6 .. 3,4 s
//        12,0     |            1,46 .. 1,03 s                        |     2,1 .. 2,9 s
//
//  Con 0,6 mm/s el tiempo SIN CONTACTO entre dos pasadas era 7,0-7,9 s ANTES de sumarle el dwell
//  sorteado: el "hueco de 1,5-5,5 s" de los parametros vinculantes era inalcanzable por
//  geometria, y la sesion se quedaba en ~40 pasadas y 8,2 m de piel (la spec pide ~64 y ~19 m).
//
//  6,0 mm/s = 0,6 cm/s, muy por debajo del suelo de 2,0 cm/s de la banda de caricia: no es una
//  velocidad de caricia, es la velocidad a la que la botavara arranca y se para, SIEMPRE en la
//  meseta plana, con la brocha 11,8 mm en el aire y a 400 mm del cuerpo, sobre la propia base de
//  la maquina. El escalon de 6 mm/s en la inversion, pasado por el acoplamiento de silicona de
//  5,2 Hz, da un transitorio de punta de 6/32,7 = 0,18 mm que se amortigua mucho antes de que la
//  brocha aterrice, 55 mm mas alla. Sobre la piel no cambia absolutamente nada.
#define V_ARRANQUE_MMS           6.0f     // arranque/parada de cada golpe, SIEMPRE en el aire

//  SUELO NUMERICO, que NO es un parametro de movimiento. mov_velocidad() no puede devolver
//  cero (seria un intervalo infinito) ni un negativo (seria un uint32 gigante al castear).
//  Antes se usaba V_ARRANQUE_MMS para las dos cosas a la vez; separarlas permite mover el
//  arranque del perfil sin romper el homing fino, que va a 3,0 mm/s, por debajo de el.
#define V_MINIMA_ABSOLUTA_MMS    0.5f

//  ---- EJE 7 (ADICION A-01 de 05-algoritmo-movimiento.md): VELOCIDAD DE VUELO ---------------
//  Fuera de la piel (zona de despegue + meseta) la botavara NO tiene por que ir a la
//  velocidad de pasada. Si va, cruzar la zona de despegue ida y vuelta cuesta 4,7 s a
//  2 cm/s y el hueco minimo de 1,5 s de la spec es GEOMETRICAMENTE IMPOSIBLE. Con una
//  velocidad de vuelo propia el hueco vuelve a ser independiente de la velocidad de pasada.
//
//  POR QUE 75 mm/s Y NO LOS 80 QUE PIDE 05-algoritmo-movimiento.md: el suelo compilado del
//  PIO son 240 us, que a R = 275 mm topan la punta en 78,7 mm/s. Pedir 80 dejaria que el
//  hardware recortara el vuelo por su cuenta en el radio interior. 75 mm/s = 7,5 cm/s deja
//  margen a los tres radios (7,87 / 8,59 / 9,31 cm/s) y sigue muy por debajo del clamp de 10.
#define V_VUELO_MMS             75.0f
#define A_VUELO_MMS2           200.0f     // aceleracion de vuelo; solo actua fuera de la piel
#define BLEND_TAPER_A_CRUCERO    true     // el cambio v_entrada -> v_crucero ocurre DENTRO del
                                          // taper, donde la fuerza aun esta subiendo de 0 a 400 mN,
                                          // NUNCA en la zona de contacto pleno.

// --- Deriva 1/f opcional dentro del golpe ------------------------------------------------------
#define DERIVA_1F_HABILITADA     true
#define DERIVA_1F_AMPLITUD       0.06f    // +/-6 % sobre la velocidad de crucero
#define DERIVA_1F_ACEL_MAX_MMS2  2.0f     // techo de aceleracion de la deriva, sobre la piel


// =============================================================================================
//  7. TIEMPOS DEL CICLO DE 15 MINUTOS
// =============================================================================================
//  CAPA 1 (firmware): 900 s exactos, medidos con millis() y aritmetica sin signo.
//  CAPA 2 (hardware): TPL5010 a 960 s, reloj RC propio, no ejecuta codigo. Los 60 s de
//                     margen son deliberados: en funcionamiento normal el TPL5010 NUNCA
//                     dispara. Si dispara, es el sintoma de que el firmware se colgo.
#define CICLO_DURACION_MS      900000UL   // 15 min 00 s EXACTOS
#define CICLO_BLOQUES                 4
#define BLOQUE_DURACION_MS     225000UL   // 3 min 45 s. 4 x 225000 = 900000, exacto.
#define PREWARM_DURACION_MS     60000UL   // 60 s en la taza caliente antes de empezar
#define GAP_TRAS_ROZADA_S          0.25f   // ver nota "inversion rozada" mas abajo
#define RESERVA_RETIRADA_MS     40000UL   // tiempo que se reserva al final para el ultimo golpe
                                          // firme + la retirada. No se planifica ningun golpe
                                          // que no quepa dentro de (900 s - esta reserva).
                                          //
                                          //  CORRECCION DE VERIFICACION (era 20000). Con 20 s el
                                          //  ciclo NO era de 900 s exactos: la secuencia de
                                          //  RETREAT no cabia en la reserva y el bucle de espera
                                          //  final salia ya vencido. Presupuesto del PEOR caso,
                                          //  sumado de verdad:
                                          //      ultimo golpe -39,5 -> +36,5 deg a R=325 mm
                                          //        = 432 mm a 29 mm/s con rampas ....... ~18 s
                                          //      quinta visita a la taza + asentar ......  ~4 s
                                          //      carro al centro, 24 mm a 1,95 mm/s .... ~12,3 s
                                          //      dos parpadeos de cierre ................  ~2 s
                                          //                                             --------
                                          //                                              ~36,3 s
                                          //  40 s deja 3,7 s de margen. Cuesta ~2 golpes de los
                                          //  ~55 de la sesion, y a cambio los 900 s son exactos.

//  ---- NOTA SOBRE EL "HUECO" DESPUES DE UNA INVERSION ROZADA -----------------------------------
//  Una inversion rozada invierte DENTRO del taper, con la brocha todavia tocando a 150-300 mN.
//  Por definicion NO hay hueco sin contacto detras de ella. Fingir un hueco de 1,5-5,5 s ahi
//  seria dejar la brocha parada sobre la piel, que es justo el "dead turnaround dwell" que la
//  especificacion quiere evitar. Asi que tras una rozada el hueco es minimo (0,25 s: lo justo
//  para vaciar el FIFO y cambiar DIR con garantias) y el golpe siguiente arranca enseguida.

//  ####  CONTRADICCION DE PLAZOS ENTRE LAS DOS CAPAS DEL TEMPORIZADOR  ####
//
//  docs/04-electronica.md fija el TPL5010 en 960 s (16 min) y argumenta que deja 60 s de
//  margen sobre los 900 s del firmware. ESO SOLO ES CIERTO SI EL PRE-WARM NO CUENTA, y si
//  cuenta (que es lo que pasa: el TPL5010 se alimenta del RAIL CONMUTADO, asi que su ventana
//  arranca cuando el usuario pulsa el boton y el latch se rearma), la cuenta real es:
//
//      pulsacion del boton  ->  PREWARM 60 s  ->  CICLO 900 s  =  960 s
//      TPL5010                                                 =  960 s
//      MARGEN                                                  =    0 s     <-- COLISION
//
//  El TPL5010 dispararia exactamente a la vez que el firmware termina, todas las noches, y
//  se perderia por completo su valor diagnostico (que es: "si dispara, el firmware se colgo").
//
//  CORRECCION: hay que ajustar R_EXT del TPL5010 para 1020 s (17 min), no 960 s. Es un solo
//  resistor y su valor se saca de la tabla de intervalos del datasheet del TPL5010.
//  Asi vuelven a quedar los 60 s de margen deliberados. La alternativa (meter el pre-warm
//  DENTRO de los 900 s) se descarta porque la especificacion dice "ciclo de 15 minutos
//  EXACTOS" y el pre-warm es con la brocha en la taza, no sobre la piel: no es caricia.
#define TPL5010_PLAZO_MS      1020000UL   // 17 min. Lo cuenta el chip, no el firmware.

//  Ventana de tolerancia del reloj: si el firmware detecta que ha pasado mas de esto,
//  algo ha ido muy mal con el temporizador y termina el ciclo inmediatamente.
#define CICLO_TIMEOUT_DURO_MS  930000UL   // 15 min 30 s


// =============================================================================================
//  8. HOMING E INTEGRIDAD DEL MICRORRUPTOR
// =============================================================================================
//  El microrruptor es contacto NA a GND con pull-up: BAJO = EN REPOSO.
//  Cable roto -> el pull-up manda -> ALTO -> "no estoy en reposo" -> el homing falla ->
//  LA MAQUINA SE NIEGA A ARRANCAR. Fallo seguro, y por eso NA y no NC.

#define SW_ANTIRREBOTE_TICKS         40   // 40 ticks de 125 us = 5 ms (mas el RC de 1 ms)
#define SW_NIVEL_EN_REPOSO          LOW

#define HOMING_VEL_GRUESA_MMS     10.0f   // 1,0 cm/s en la primera pasada
#define HOMING_VEL_FINA_MMS        3.0f   // 0,3 cm/s en la segunda: la que da la repetibilidad
#define HOMING_RETROCESO_DEG       3.0f   // retrocede 3 grados entre las dos pasadas
#define HOMING_SEPARACION_DEG     10.0f   // si arranca ya en reposo, se aleja 10 grados primero
#define HOMING_BARRIDO_MAX_DEG    95.0f   // si no encuentra el tope en 95 grados -> FAULT
#define HOMING_REINTENTOS             1   // exactamente UNO, como pide la especificacion

//  ---- Integridad por ciclo ------------------------------------------------------------------
//  PRECISION NECESARIA SOBRE LA SPEC: "el switch debe cerrar una vez por ciclo" es ambiguo,
//  porque hay 52-65 golpes por sesion pero el reposo esta a +43 grados y los golpes solo
//  llegan a +/-41 (ventana de inversion 35-41). LOS GOLPES NORMALES NO PASAN POR EL MICRORRUPTOR.
//
//  DEFINICION OPERATIVA IMPLEMENTADA: CINCO visitas programadas a la taza por sesion:
//      t =   0 s  (pre-warm)   t = 225 s   t = 450 s   t = 675 s   t = 900 s (fin)
//  En cada una: se ordenan N micropasos hasta el reposo; el switch DEBE cerrar antes de
//  N * 1,5. Si no cierra -> parar, desenergizar, esperar 5 s, UN reintento con amplitud
//  reducida; si vuelve a fallar -> fin de ciclo y 4 parpadeos.
//
//  Y SE DICE CLARO: entre visitas NO HAY verificacion por golpe. Lo unico disponible es
//  StallGuard4, y solo por encima de 3 cm/s. No se promete lo que no hay.
#define INTEGRIDAD_MARGEN         1.50f   // "tiempo comandado + 50 %"
#define INTEGRIDAD_ESPERA_MS      5000UL  // desenergizado antes del reintento
#define INTEGRIDAD_AMPLITUD_REINTENTO 0.7f // el reintento barre el 70 % de la amplitud

//  ---- Correccion automatica de pasos perdidos ------------------------------------------------
//  error = upasos_ordenados_hasta_reposo - upasos_reales_al_cierre
//  |error| <= 30 pasos completos (= 960 micropasos = 3,78 grados = 19,8 mm de arco de punta):
//      se pone el contador a cero EN SILENCIO. 19,8 mm de deriva siguen cayendo dentro de
//      los 36,7 mm de meseta plana: la brocha sigue en el aire, no roza.
//  |error| > 30 pasos completos: algo va mal de verdad -> mismo protocolo que la integridad.
#define DERIVA_TOLERADA_PASOS        30
#define DERIVA_TOLERADA_UPASOS  ( (uint32_t)(DERIVA_TOLERADA_PASOS * MICROSTEPPING) )


// =============================================================================================
//  9. TERMICA: CALEFACTORES Y NTC
// =============================================================================================
//  Ferula: resistencia de 120 ohm 0,6 W, 30 mm por detras de las puntas de las cerdas.
//  Taza de reposo: resistencia de 47 ohm.
//  Ambos van por MOSFET de canal N con pull-down de 10k en la puerta (pin flotante = apagado).

//  ---- PWM lento por SOFTWARE, y por que no es hardware --------------------------------------
//  04-electronica.md pide "PWM 2 Hz". El PWM hardware del RP2040 NO PUEDE dar 2 Hz:
//      f_min = 125 MHz / (clkdiv_max 255,94 x wrap_max 65536) = 7,45 Hz
//  Asi que los dos calefactores van con un PWM lento hecho a mano en el bucle principal:
//  periodo de 500 ms (2 Hz exactos) y resolucion de 100 escalones (5 ms). Conmutar un
//  MOSFET sobre una resistencia a 2 Hz no genera ni ruido audible ni EMI.
#define CALEF_PERIODO_MS           500UL   // 2 Hz
#define CALEF_RESOLUCION            100    // escalones de duty (1 % = 5 ms)

#define TEMP_OBJETIVO_FERULA_C     33.0f
#define TEMP_OBJETIVO_TAZA_C       35.0f
#define TEMP_LIMITE_FIRMWARE_C     38.0f   // corte duro por firmware. Ademas hay:
                                           //   - techo intrinseco por el valor de la resistencia
                                           //   - KSD9700 bimetalico NC de 45 C pegado a la ferula
#define TEMP_HISTERESIS_C           0.5f
#define CALEF_KP                   18.0f   // % de duty por grado de error
#define CALEF_KI                    0.25f  // % de duty por grado.segundo
#define CALEF_I_MAX                40.0f   // techo del integrador, en % de duty
#define CALEF_DUTY_MAX              100

//  ---- Regla del ambiente (correccion C-7 de 04-electronica.md) -------------------------------
//  El "techo hardware de 38 C" de la spec en realidad es T_ambiente + 17,7 K. A 20 C da
//  37,7 C (bien), pero a 26 C de un verano espanol da 43,7 C, por encima del umbral de
//  quemadura por contacto prolongado de la ISO 13732-1 (43 C).
//  El ambiente se estima leyendo el NTC de la TAZA en el arranque, con el calefactor apagado.
#define TEMP_AMBIENTE_MAX_CALEF_C  24.0f   // por encima de esto, el calefactor de ferula NO se
                                           // enciende. Y por encima de 24 C tampoco hace falta.

//  ---- NTC 10k B=3950. Divisor: 10k desde 3V3 al nudo, NTC del nudo a GND ---------------------
//      cuenta ADC (12 bits) = 4095 * R_ntc / (10000 + R_ntc)
//      25 C -> R 10000 -> 2048       33 C -> R  7073 -> 1697
//      38 C -> R  5748 -> 1495       45 C -> R  4348 -> 1241
#define NTC_R_NOMINAL_OHM       10000.0f
#define NTC_T_NOMINAL_K           298.15f  // 25 C
#define NTC_BETA                 3950.0f
#define NTC_R_SERIE_OHM         10000.0f
#define NTC_MUESTRAS                 64    // media de 64 lecturas: quita el ruido del ADC

//  ---- Deteccion de NTC desconectado o en corto ------------------------------------------------
//      NTC ABIERTO (cable partido, conector suelto): el nudo sube a 3V3 -> cuenta -> 4095
//      NTC EN CORTO (pinzado, soldadura puenteada): el nudo cae a 0 -> cuenta -> 0
//  Ambos casos: calefactor FUERA y FAULT. Nunca se calienta con un sensor del que no te fias.
#define NTC_CUENTA_ABIERTO_MIN     3900    // R > ~150k  ->  T < -25 C. Imposible en un dormitorio.
#define NTC_CUENTA_CORTO_MAX        200    // R < ~515 ohm ->  T > 90 C. Imposible sin fuego.
#define NTC_SALTO_MAX_C_POR_S      3.0f    // una ferula de silicona no puede cambiar mas rapido.
                                           // Si lo hace, el sensor esta suelto y golpeando.
#define NTC_FALLOS_SEGUIDOS           3    // 3 lecturas malas seguidas antes de creerselo


// =============================================================================================
// 10. SEGURIDAD: LATIDO, WATCHDOG, PARO DE EMERGENCIA, BROWNOUT
// =============================================================================================
//
//  ####  CORRECCION DE FONDO SOBRE EL LATIDO. LEELA. ####
//
//  04-electronica.md describe el latido como "onda cuadrada de 2 kHz al 50 %, GENERADA POR
//  HARDWARE PWM" y a la vez afirma que cubre el caso "firmware colgado".
//  ESAS DOS COSAS NO PUEDEN SER CIERTAS A LA VEZ: un slice de PWM del RP2040 sigue
//  oscilando alegremente aunque el nucleo este metido en un while(1). El charge pump
//  seguiria bombeando, VMOT seguiria vivo y la brocha seguiria sobre la piel.
//
//  LO QUE HACE ESTE FIRMWARE:
//     - El latido se genera CONMUTANDO GP11 A MANO dentro de la ISR de 8 kHz
//       (un cambio de nivel cada 2 ticks = 250 us = 2,000 kHz exactos).
//     - La ISR SOLO conmuta si el bucle principal ha puesto el testigo de vida
//       (g_bucle_vivo) en los ultimos LATIDO_VENTANA_MS. El bucle principal lo pone
//       en cada vuelta.
//  Cobertura resultante, caso por caso:
//     bucle principal colgado  -> la ISR deja de conmutar -> VMOT muere en <250 ms   OK
//     ISR muerta (IRQ deshabilitadas, nucleo colgado en seccion critica) -> no conmuta OK
//     MCU en reset o muerto    -> el pin queda quieto -> no conmuta                   OK
//     ambos nucleos colgados con IRQ vivas -> watchdog del RP2040 a 2 s -> reset -> OK
//  El unico coste es una ISR a 8 kHz que ya teniamos que tener para alimentar el PIO.
//
#define LATIDO_TICKS_POR_SEMIPERIODO   2   // 2 ticks de 125 us = 250 us -> 2,000 kHz
#define LATIDO_VENTANA_MS            150UL // si el bucle principal no da senales en 150 ms,
                                           // la ISR corta el latido. El charge pump tarda
                                           // ~140 ms mas en caer: VMOT muere en <300 ms.
#define WATCHDOG_MS                 2000UL // watchdog hardware del RP2040. Un reset deja el
                                           // motor desenergizado y la maquina esperando boton.

#define MOTOR_KILL_PULSO_MS           10   // pulso alto en GP10 -> SET del CD4013
#define BOTON_MANTENER_MS            300UL // intencion deliberada: 300 ms sostenidos...
#define BOTON_SOLTAR_MS              500UL // ...mas 500 ms de soltado antes de armar
#define BOTON_ANTIRREBOTE_MS          20UL

//  ---- Paro de emergencia (S1) ------------------------------------------------------------------
//  S1 es un pulsador NC ENCLAVABLE de 16 mm EN SERIE CON EL COBRE del rail del motor.
//  No es una entrada de GPIO. No pasa por el firmware. Funciona con el MCU muerto.
//  El firmware solo lo DETECTA, leyendo GP12 (RAIL_SENSE): si VMOT esta muerto y VBUS vivo,
//  o S1 esta pulsado o el latch se ha disparado. En los dos casos: FAULT limpio.
#define RAIL_MUERTO_LECTURAS_SEGUIDAS   3  // a 20 Hz = 150 ms
#define RAIL_PERIODO_MUESTREO_MS       50UL


// =============================================================================================
// 11. LED ROJO  —  el unico indicador
// =============================================================================================
//  Rojo de 3 mm difuso, con 10 kOhm en serie: 150 uA a duty 100 %. Se usa al 5-20 %.
//  Legible si lo buscas, invisible si no. NADA de WS2812 (anula el de la placa, GP16).
//
//  El vocabulario de 04-electronica.md es deliberadamente minusculo (4 senales). La tarea
//  pide un patron por estado. Se concilian asi: se anaden patrones para los estados que
//  solo existen ANTES de que te acuestes (BOOT, HOMING, AUTOTUNE), y se respeta a rajatabla
//  lo que importa: DURANTE LA SESION EL LED ESTA APAGADO. Un LED fijo en una habitacion a
//  oscuras ES una fuente de luz.
#define LED_PWM_HZ                 1000
#define LED_PWM_WRAP                999
#define LED_BRILLO_NORMAL           120   // 12 % de 999
#define LED_BRILLO_TENUE             50   // 5 %
#define LED_BRILLO_FALLO            200   // 20 %: el fallo si quiere que lo veas

//  Patrones: {ms encendido, ms apagado, repeticiones por rafaga, ms de pausa entre rafagas}
//  (repeticiones = 0 significa "para siempre", pausa = 0 significa "sin pausa")
#define LED_BOOT_ON_MS             1000
#define LED_HOMING_ON_MS            100
#define LED_HOMING_OFF_MS           900
#define LED_AUTOTUNE_ON_MS           80
#define LED_AUTOTUNE_OFF_MS         120
#define LED_AUTOTUNE_REPS             2
#define LED_AUTOTUNE_PAUSA_MS      1800
#define LED_IDLE_ON_MS               30    // destello casi invisible cada 4 s
#define LED_IDLE_OFF_MS            3970
#define LED_ARMADO_ON_MS           1000    // 1 parpadeo largo al pulsar el boton
#define LED_PREWARM_RESPIRA_MS     8000    // respiracion lenta durante el pre-warm
#define LED_FIN_ON_MS               500    // 2 parpadeos lentos al terminar
#define LED_FIN_OFF_MS              500
#define LED_FIN_REPS                  2
#define LED_FALLO_ON_MS             120    // 4 parpadeos rapidos...
#define LED_FALLO_OFF_MS            120
#define LED_FALLO_REPS                4
#define LED_FALLO_FIJO_MS          5000    // ...+ 5 s encendido
#define LED_FALLO_PAUSA_MS        30000    // y se repite cada 30 s


// =============================================================================================
// 12. MEMORIA NO VOLATIL (EEPROM emulada en flash)
// =============================================================================================
//  El core de Philhower emula la EEPROM en el ultimo sector de flash. Hay que llamar a
//  EEPROM.begin(n) y a EEPROM.commit() para que se escriba de verdad.
//  SOLO SE ESCRIBE AL TERMINAR EL CICLO (una vez por noche): el flash aguanta ~100.000
//  ciclos de borrado, asi que son ~270 anos.
#define EEPROM_TAMANO               256
#define EEPROM_MAGIA         0x504C5231UL  // 'PLR1'
#define EEPROM_DIRECCION              0

//  Valores de PWM_OFS / PWM_GRAD del PROCEDIMIENTO A (banco, motor desacoplado).
//  Se usan SOLO si la EEPROM esta vacia o corrupta. Ponlos a mano tras hacer el
//  Procedimiento A de 04-electronica.md seccion 6.5, y ademas quedaran guardados en flash.
//
//  #### POR QUE ESTE FIRMWARE NO HACE EL AT#2 AL ARRANCAR (correccion C-1) ####
//  La spec pide "movimiento oculto de 1,2 s a 400 pasos/s". 400 pasos COMPLETOS/s son
//  26,4 cm/s de punta: 2,6 veces el clamp absoluto, y el suelo del PIO lo prohibe fisicamente.
//  Y 400 PULSOS/s a 1/32 son 8,2 mm/s, inutiles para el AT#2, que necesita velocidad para
//  medir la constante de fuerza contraelectromotriz.
//  El AT#2 se hace UNA SOLA VEZ en el banco, con el motor desacoplado, con un binario de
//  calibracion aparte. Aqui solo se hace el AT#1 (300 ms EN PARADA, sin mover nada) y se
//  reaplican PWM_OFS/PWM_GRAD desde flash con pwm_autograd = 0 (congelado).
//  Beneficio colateral que no es menor: se elimina un latigazo de 26 cm/s del arranque de
//  cada noche, a las 23:30, justo antes de que te tumbes al lado.
#define PWM_OFS_DEFECTO            0x24
#define PWM_GRAD_DEFECTO           0x0E
#define AT1_ESPERA_MS               300UL  // AT#1: 300 ms energizado y quieto. Sin movimiento.

//  Codigos de fallo que se guardan en flash y se leen por USB al dia siguiente.
enum CodigoFallo : uint8_t {
  FALLO_NINGUNO            = 0,
  FALLO_TMC_VERSION        = 1,   // IOIN.VERSION != 0x21: clon o UART muerto
  FALLO_TMC_UART           = 2,   // no contesta
  FALLO_TMC_CONVERGENCIA   = 3,   // PWM_SCALE_SUM pegado a 0 o a 255
  FALLO_TMC_MRES           = 4,   // CHOPCONF.MRES ha cambiado por debajo del firmware
  FALLO_HOMING             = 5,   // el microrruptor no cierra en 95 grados
  FALLO_INTEGRIDAD         = 6,   // no cerro en el plazo comandado + 50 %, ni en el reintento
  FALLO_DERIVA             = 7,   // pasos perdidos por encima de la tolerancia
  FALLO_STALLGUARD         = 8,   // obstruccion detectada por SG4 en tramo rapido
  FALLO_NTC_FERULA         = 9,   // abierto, en corto o con salto imposible
  FALLO_NTC_TAZA           = 10,
  FALLO_SOBRETEMPERATURA   = 11,  // por encima del limite de firmware
  FALLO_RAIL_MUERTO        = 12,  // paro de emergencia o latch disparado
  FALLO_BROWNOUT           = 13,  // VBUS por debajo de 4,80 V
  FALLO_RELOJ              = 14,  // el ciclo paso del timeout duro
  FALLO_DRIVER_ERROR       = 15,  // GSTAT.drv_err
  FALLO_WATCHDOG           = 16,  // el arranque viene de un reset por watchdog
};

#endif // CONFIG_H
