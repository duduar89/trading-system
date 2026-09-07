// =================================================================================================
//
//   PPPP  L     U   U M   M  AAA        RRRR
//   P   P L     U   U MM MM A   A  ---  R   R
//   PPPP  L     U   U M M M AAAAA  ---  RRRR
//   P     L     U   U M   M A   A  ---  R  R
//   P     LLLLL  UUU  M   M A   A       R   R
//
//   PLUMA-R  —  firmware completo  —  pluma_relax.ino
//   Ver PLUMA_VERSION_FIRMWARE en config.h
//
// =================================================================================================
//  QUE ES ESTA MAQUINA, EN UN PARRAFO
// =================================================================================================
//
//  Un motor NEMA 11 barre una botavara de fibra de carbono de 300 mm a traves de 86 grados,
//  tirando de un tendon de Dyneema sobre un cabrestante (reduccion 14,29:1). En la punta hay una
//  brocha kabuki de pelo de cabra de 60 mm que apoya sobre la piel con 400 mN, fuerza que NO fija
//  ningun sensor ni ningun actuador: la fija un lastre de laton de 40 g deslizando sobre la
//  botavara. Un RAIL fijo con forma de rampa, bajo un patin de PTFE, convierte el barrido en
//  elevacion: la brocha aterriza con una rampa de fuerza geometrica de 0,6-2,5 s, recorre 199 mm
//  a fuerza plena, y se despega 11,8 mm ANTES de cada inversion. Un contrapeso de 360 g colgado
//  de un tambor de 70 mm (RADIO 70 mm = disco de 140 mm) tira permanentemente hacia el reposo
//  con 247 mN.m contra 180 mN.m de
//  resistencia en el peor caso: SIEMPRE QUE EL MOTOR SE DESENERGIZA, LA BROCHA SE VA SOLA.
//  Un carro radial motorizado por un 28BYJ-48 traslada toda la bisagra +/-25 mm entre golpes,
//  para que ninguna fibra nerviosa reciba dos veces el mismo estimulo. El ciclo dura 15 minutos
//  exactos y termina desenergizando su propio rail.
//
// =================================================================================================
//  ADVERTENCIAS DE SEGURIDAD  —  LEELAS ENTERAS ANTES DE DORMIR CON ESTO PUESTO
// =================================================================================================
//
//  1. ESTE FIRMWARE NO ES LA SEGURIDAD DE LA MAQUINA. La seguridad es un peso de 360 g colgado
//     de una cuerda. El firmware solo intenta no estorbarle. Si compilas este codigo y lo pones
//     en una maquina SIN el contrapeso, o con el tendon de retorno flojo, o con el amortiguador
//     neumatico sin montar, has construido un aparato distinto y peligroso. No lo hagas.
//
//  2. VALIDACION OBLIGATORIA ANTES DE DORMIR AL LADO. Tres ciclos completos de 15 minutos
//     contra una almohada lastrada, y en cada uno, deliberadamente:
//        (a) tira del cable USB a mitad de golpe,
//        (b) pulsa la seta de paro a mitad de golpe,
//        (c) cuelga el firmware a mitad de golpe (hay un comando por USB para eso: 'H').
//     En los TRES casos la brocha debe abandonar la piel en 2-3 s. Si alguno falla, el aparato
//     no esta terminado.
//
//  3. PWMCONF.freewheel DEBE VALER 01. Con 10 u 11 el driver cortocircuita las bobinas al parar
//     y el motor se convierte en un freno magnetico que PELEA CONTRA EL CONTRAPESO. Prueba de
//     banco: con VMOT vivo, la maquina en reposo y el driver configurado, el sector debe girar
//     con el dedo igual de facil que con el driver desenchufado.
//
//  4. EL PIN EN DEL TMC2209 ES ACTIVO A NIVEL BAJO y necesita un PULL-UP externo de 10k a 3V3.
//     Con un pull-DOWN, el driver queda HABILITADO durante todo el arranque y en cada reset.
//
//  5. NUNCA TAPES LA COLUMNA CON ROPA DE CAMA. Dentro hay un motor disipando 1,27 W.
//
//  6. EL CALEFACTOR SE APAGA POR ENCIMA DE 24 C DE AMBIENTE. El "techo hardware de 38 C" en
//     realidad es T_ambiente + 17,7 K. A 26 C de ambiente daria 43,7 C, por encima del umbral
//     de quemadura por contacto prolongado de la ISO 13732-1.
//
//  7. LO QUE ESTE FIRMWARE **NO** PROMETE:
//       - NO detecta obstrucciones golpe a golpe. StallGuard4 no vale por debajo de 3 cm/s
//         (el motor gira a 9-13 rpm y apenas genera fuerza contraelectromotriz). La deteccion
//         PRIMARIA de bloqueo es la verificacion de integridad del microrruptor, y ocurre
//         CINCO VECES POR SESION, no una vez por golpe. Ver vigilar_stallguard().
//       - NO controla la fuerza de contacto. No puede: no hay actuador en ese eje. Eso es
//         una decision de diseno, y es la razon por la que el aparato es seguro.
//       - NO sabe donde esta el carro radial en el arranque. Lo asume centrado.
//
// =================================================================================================
//  COMO COMPILARLO
// =================================================================================================
//  Core:     arduino-pico de Earle Philhower >= 3.9.x (probado con 4.6.1)
//  Placa:    "Waveshare RP2040 Zero", 125 MHz, Flash 2MB con FS de 64 KB, USB Stack "Pico SDK"
//  Libreria: TMCStepper >= 0.7.3 (la unica externa)
//  Ficheros: pluma_relax.ino  +  config.h   en la MISMA carpeta llamada "pluma_relax"
//  Todos los ajustes estan en config.h. Aqui no hay ni un solo numero magico.
//
// =================================================================================================
//  MAQUINA DE ESTADOS
// =================================================================================================
//
//    ( power-on / reset del watchdog )
//              |
//              v
//        +-----------+   TMC no contesta, VERSION != 0x21, GSTAT.drv_err
//        |   BOOT    |------------------------------------------------------+
//        +-----------+                                                      |
//              | pines, watchdog, EEPROM, UART, registros del TMC           |
//              v                                                            |
//        +-----------+   PWM_SCALE_SUM pegado a 0 o 255                     |
//        | AUTOTUNE  |------------------------------------------------------+
//        +-----------+                                                      |
//              | AT#1: 300 ms EN PARADA. PWM_OFS/PWM_GRAD desde flash.      |
//              | (el AT#2 NO se hace aqui: ver config.h seccion 12)         |
//              v                                                            |
//        +-----------+   el microrruptor no cierra en 95 grados             |
//        |  HOMING   |------------------------------------------------------+
//        +-----------+                                                      |
//              | cero absoluto establecido contra el tope mecanico          |
//              v                                                            |
//        +-----------+                                                      |
//   +--->|   IDLE    |  IHOLD=0 + freewheel. Corriente cero. LED: destello   |
//   |    +-----------+  de 30 ms cada 4 s. Espera el boton.                 |
//   |          | boton: 300 ms sostenidos + 500 ms soltado                  |
//   |          v                                                            |
//   |    +-----------+                                                      |
//   |    |  PREWARM  |  60 s en la taza caliente. Motor desenergizado.      |
//   |    +-----------+  Calefactores a consigna. LED: respiracion lenta.    |
//   |          |                                                            |
//   |          v                                                            |
//   |    +-----------+   fallo de integridad tras el reintento              |
//   |    |  RUNNING  |---------------------------------------+              |
//   |    +-----------+   NTC roto / sobretemperatura         |              |
//   |       |      ^     rail muerto (paro de emergencia)    |              |
//   |       |      |     brownout / StallGuard en tramo rapido|             |
//   |       |      |                                          |             |
//   |       |      +--- 4 bloques x 225 s, ~64 golpes,        |             |
//   |       |           5 visitas a la taza                   |             |
//   |       | t = 900000 ms exactos                           |             |
//   |       v                                                 v             v
//   |  +-----------+                                    +-----------+       |
//   |  |  RETREAT  |  ultimo golpe firme, luego         |   FAULT   |<------+
//   |  +-----------+  DESENERGIZA y deja que el         +-----------+
//   |       |         contrapeso retire la brocha            |
//   |       |         (2-3 s, amortiguador neumatico)        | nEN alto, freewheel,
//   |       |         Calefactores fuera. 2 parpadeos.       | calefactores fuera,
//   |       |         Pulso en MOTOR_KILL: mata su rail.     | LATIDO CORTADO -> VMOT
//   |       |                                                | muere en <300 ms.
//   |       v                                                | 4 parpadeos + 5 s.
//   +-------+                                                | Se queda aqui. Solo
//                                                            | sale con un reset.
//                                                            v
//                                                        ( fin )
//
//  TRANSICIONES QUE NO EXISTEN, A PROPOSITO:
//    - No hay FAULT -> IDLE automatico. Un fallo termina la noche. Se sale con el boton
//      (que rearma el latch del CD4013 por hardware) o desenchufando.
//    - No hay RUNNING -> IDLE. Un ciclo empezado se termina o se aborta a FAULT.
//    - No hay forma de volver a energizar el motor sin pasar por HOMING.
//
// =================================================================================================

#include <Arduino.h>
#include <TMCStepper.h>
#include <EEPROM.h>
#include <hardware/pio.h>
#include <hardware/pwm.h>
#include <hardware/clocks.h>
#include <hardware/gpio.h>
#include <hardware/watchdog.h>
#include <pico/time.h>
#include <string.h>
#include <stdlib.h>
#include <math.h>

#include "config.h"


// =================================================================================================
//  BLOQUE 1 — EL GENERADOR DE PASOS POR PIO Y EL CLAMP DURO DE VELOCIDAD
// =================================================================================================
//
//  ###############################################################################################
//  #                                                                                             #
//  #   EL TOPE DE 10 cm/s NO ES UN "if". ESTA EN LA MEMORIA DE INSTRUCCIONES DEL PIO.            #
//  #                                                                                             #
//  ###############################################################################################
//
//  El programa que sigue esta escrito instruccion a instruccion, en hexadecimal, porque el IDE
//  de Arduino no trae pioasm. Cada palabra lleva su desensamblado al lado. El reloj del PIO se
//  divide para que UN CICLO DE PIO SEA EXACTAMENTE UN MICROSEGUNDO.
//
//     dir  hex     instruccion            ciclos   que hace
//     ---  ------  ---------------------  ------   ---------------------------------------------
//      0   0x80A0  pull block                1     espera un dato del firmware = retardo EXTRA
//      1   0xA027  mov x, osr                1     x = retardo extra, en microsegundos
//      2   0xE901  set pins, 1 [9]          10     STEP a nivel ALTO durante 10 us
//      3   0xE000  set pins, 0               1     STEP a nivel BAJO
//      4   0xE046  set y, 6                  1     carga el contador del SUELO
//      5   0x1F85  jmp y--, 5 [31]         224     <<<<<<<<  SUELO COMPILADO  >>>>>>>>
//                                                  7 vueltas x (1 + 31 de retardo) = 224 ciclos
//      6   0x0046  jmp x--, 6              x+1     el retardo adicional que pidio el firmware
//      7   0x0000  jmp 0                     1     vuelta a empezar
//                                          -----
//                              FIJO         240 us   +  x us
//
//  PERIODO MINIMO ABSOLUTO = 240 us. El firmware solo puede escribir x, y x es un entero SIN
//  SIGNO: no existe ningun valor de x que RESTE tiempo. Aunque el planificador se vuelva loco
//  y pida x = 0 en todos los micropasos:
//
//         4166,7 pulsos/s  /  32 micropasos  =  130,2 pasos completos/s
//         a R = 300 mm  ->  130,2 x 0,65964 mm/paso  =  85,9 mm/s  =  8,59 cm/s
//         a R = 325 mm  ->  130,2 x 0,71462 mm/paso  =  93,0 mm/s  =  9,30 cm/s   <- peor caso
//
//  9,30 cm/s < 10 cm/s en TODO el recorrido del carro radial. El tope se cumple.
//
//  ---------------------------------------------------------------------------------------------
//  HONESTIDAD SOBRE EL ALCANCE DE ESTE TOPE  (correccion C-2 de docs/04-electronica.md)
//  ---------------------------------------------------------------------------------------------
//  CONTRA QUE PROTEGE DE VERDAD, y esto es lo que importa en un aparato con el que se duerme:
//     - un signo cambiado en el planificador,
//     - una division por cero que devuelva un intervalo minusculo,
//     - un bucle que se dispare y vacie el buffer a toda velocidad,
//     - una tabla mal indexada,
//     - un desbordamiento de un entero en el calculo del intervalo.
//  Todos esos son ERRORES DE DISENO, son los que de verdad ocurren, y contra todos ellos el
//  suelo del PIO es una barrera fisica que no se puede saltar desde el codigo de aplicacion.
//
//  CONTRA QUE **NO** PROTEGE, dicho sin adornos:
//     - el divisor de reloj del PIO lo escribe la CPU en pio_sm_set_clkdiv(). Codigo arbitrario
//       podria bajarlo y acelerar el suelo.
//     - el microstepping (CHOPCONF.MRES) va por UART. Bajarlo de 1/32 a 1/8 multiplicaria por
//       cuatro los mm por pulso sin tocar el PIO.
//  Esto es una barrera contra errores, NO un sandbox contra codigo malicioso.
//
//  DOS MITIGACIONES, UNA IMPLEMENTADA Y OTRA GRATIS:
//     (a) IMPLEMENTADA: antes de cada golpe se RELEE CHOPCONF por UART y se comprueba que MRES
//         sigue siendo el que pedimos. Si ha cambiado -> FALLO_TMC_MRES -> FAULT. Ver
//         verificar_microstepping().
//     (b) GRATIS, RECOMENDADA: la "variante endurecida". Ata MS1 = MS2 = 3V3 (microstepping
//         1/16 fijado POR PINES, direccion UART = 3), pon GCONF.mstep_reg_select = 0, y el UART
//         DEJA DE PODER cambiar el microstepping. Entonces hay que subir PIO_SUELO_US a 480.
//         Coste: cero. Perdida: cero (MicroPlyer sigue interpolando a 1/256).
//
static const uint16_t g_pio_instrucciones[] = {
  0x80A0,  // 0: pull block
  0xA027,  // 1: mov x, osr
  0xE901,  // 2: set pins, 1 [9]
  0xE000,  // 3: set pins, 0
  0xE046,  // 4: set y, 6
  0x1F85,  // 5: jmp y--, 5 [31]      <<< SUELO COMPILADO: 7 x 32 = 224 ciclos >>>
  0x0046,  // 6: jmp x--, 6
  0x0000,  // 7: jmp 0
};

// origin = PIO_ORIGEN (0) es OBLIGATORIO: los jmp de arriba son direcciones ABSOLUTAS y no
// usamos pioasm, asi que no hay tabla de reubicacion. Si el programa se cargase en otro
// offset, los saltos apuntarian a instrucciones equivocadas.
static const struct pio_program g_pio_programa = {
  .instructions = g_pio_instrucciones,
  .length       = (uint8_t)(sizeof(g_pio_instrucciones) / sizeof(g_pio_instrucciones[0])),
  .origin       = PIO_ORIGEN,
};

static void pio_arrancar_generador_de_pasos() {
  pio_gpio_init(PIO_INSTANCIA, PIN_STEP);
  pio_sm_set_consecutive_pindirs(PIO_INSTANCIA, PIO_SM, PIN_STEP, 1, true);
  pio_add_program(PIO_INSTANCIA, &g_pio_programa);  // se carga en la direccion PIO_ORIGEN

  pio_sm_config c = pio_get_default_sm_config();
  sm_config_set_set_pins(&c, PIN_STEP, 1);
  sm_config_set_wrap(&c, PIO_ORIGEN, PIO_ORIGEN + g_pio_programa.length - 1);
  sm_config_set_out_shift(&c, false, false, 32);      // sin autopull: usamos pull block
  sm_config_set_fifo_join(&c, PIO_FIFO_JOIN_TX);      // FIFO de TX de 8 palabras en vez de 4

  // Un ciclo de PIO = 1 microsegundo, sea cual sea el reloj de sistema.
  const float divisor = (float)clock_get_hz(clk_sys) * PIO_TICK_US / 1000000.0f;
  sm_config_set_clkdiv(&c, divisor);

  pio_sm_init(PIO_INSTANCIA, PIO_SM, PIO_ORIGEN, &c);
  pio_sm_set_enabled(PIO_INSTANCIA, PIO_SM, true);
}


// =================================================================================================
//  BLOQUE 2 — VARIABLES GLOBALES
// =================================================================================================

// ---- Estados de la maquina --------------------------------------------------------------------
enum Estado : uint8_t {
  EST_BOOT = 0, EST_HOMING, EST_AUTOTUNE, EST_IDLE,
  EST_PREWARM, EST_RUNNING, EST_RETREAT, EST_FAULT
};
static const char* const NOMBRE_ESTADO[] = {
  "BOOT", "HOMING", "AUTOTUNE", "IDLE", "PREWARM", "RUNNING", "RETREAT", "FAULT"
};
static Estado g_estado = EST_BOOT;

// ---- Subestados de RUNNING ---------------------------------------------------------------------
enum SubRun : uint8_t { SR_PLANIFICAR = 0, SR_GOLPE, SR_HUECO, SR_VISITA_TAZA, SR_REINTENTO };
static SubRun g_subrun = SR_PLANIFICAR;

// ---- Buffer circular de intervalos: bucle principal (productor) -> ISR (consumidor) ------------
static volatile uint32_t g_buf[BUFFER_PASOS_N];
static volatile uint16_t g_buf_cab = 0;      // escribe el bucle principal
static volatile uint16_t g_buf_cola = 0;     // lee la ISR
static volatile int8_t   g_dir_signo = +1;   // +1 hacia el reposo, -1 hacia el lado lejano
static volatile int32_t  g_pos_upasos = 0;   // posicion ORDENADA, en micropasos, 0 = angulo 0
static volatile uint32_t g_ultimo_intervalo_us = PIO_SUELO_US;
static volatile uint32_t g_ultimo_push_us = 0;

// ---- Microrruptor (antirrebote y captura de posicion, dentro de la ISR) -------------------------
static volatile uint16_t g_sw_cuenta = 0;
static volatile int32_t  g_sw_pos_instantanea = 0;
static volatile int32_t  g_sw_pos_capturada = 0;
static volatile bool     g_sw_capturado = false;
static volatile bool     g_sw_cerrado_ahora = false;

// ---- Latido de seguridad ------------------------------------------------------------------------
static volatile uint32_t g_bucle_vivo_ms = 0;    // lo refresca el bucle principal
static volatile bool     g_latido_permitido = true;
static volatile uint8_t  g_latido_div = 0;
static volatile bool     g_latido_nivel = false;

// ---- Carro radial (28BYJ-48) --------------------------------------------------------------------
static uint16_t g_tabla_carro[CARRO_TABLA_N][4];
static volatile int32_t  g_carro_pos_upasos = 0;
static volatile int32_t  g_carro_obj_upasos = 0;
static volatile bool     g_carro_activo = false;
static volatile uint8_t  g_carro_div = 0;
static volatile uint8_t  g_carro_fase = 0;
static float             g_radio_offset_mm = 0.0f;      // desplazamiento actual respecto a R=300
static float             g_radio_hist1_mm = 999.0f;     // los dos anteriores, para la regla >= 6 mm
static float             g_radio_hist2_mm = 999.0f;

// ---- Driver -------------------------------------------------------------------------------------
static TMC2209Stepper g_drv(&Serial1, TMC_R_SENSE, TMC_DIRECCION);
static uint8_t g_pwm_ofs  = PWM_OFS_DEFECTO;
static uint8_t g_pwm_grad = PWM_GRAD_DEFECTO;
static bool    g_calibracion_valida = false;

// ---- Ciclo --------------------------------------------------------------------------------------
static uint32_t g_t_ciclo_ini_ms = 0;
static uint32_t g_t_estado_ini_ms = 0;
static uint8_t  g_bloque = 0;
static uint16_t g_golpes_dados = 0;
static uint8_t  g_visitas_hechas = 0;
static bool     g_ultimo_golpe_rozada = false;
static uint8_t  g_reintentos_integridad = 0;

// ---- Termica ------------------------------------------------------------------------------------
static float   g_temp_ferula_c = 20.0f;
static float   g_temp_taza_c   = 20.0f;
static float   g_temp_ambiente_c = 20.0f;
static bool    g_calef_ferula_permitido = true;
static bool    g_calefactores_on = false;
static uint8_t g_duty_ferula = 0, g_duty_taza = 0;
static float   g_integral_ferula = 0.0f, g_integral_taza = 0.0f;
static uint8_t g_fallos_ntc_fer = 0, g_fallos_ntc_taza = 0;

// ---- Diagnostico y fallo -------------------------------------------------------------------------
static CodigoFallo g_fallo = FALLO_NINGUNO;
static uint8_t     g_sg_disparos = 0;
static uint8_t     g_vbus_malas  = 0;
static uint8_t     g_rail_muertas = 0;
static uint16_t    g_recortes_rampa = 0;
static uint16_t    g_huecos_sin_dwell = 0;   // huecos en los que el vuelo ya se comio el hueco    // cuantas veces hubo que recortar t_rampa
static int16_t     g_err_homing[5] = {0,0,0,0,0};

// ---- Estructura guardada en flash -----------------------------------------------------------------
struct __attribute__((packed)) Persistencia {
  uint32_t magia;
  uint8_t  pwm_ofs;
  uint8_t  pwm_grad;
  uint8_t  sgthrs;
  uint8_t  irun_cs;
  int16_t  err_homing[5];
  uint16_t sesiones;
  uint16_t fallos;
  uint8_t  ultimo_fallo;
  uint8_t  reservado;
  uint32_t suma;
};
static Persistencia g_nvm;


// =================================================================================================
//  BLOQUE 3 — PWM POR SLICES (sin analogWrite, para poder tener frecuencias distintas por pin)
// =================================================================================================
//  analogWrite() del core de Philhower fija UNA frecuencia global para todos los pines.
//  Aqui hacen falta tres frecuencias distintas (LED 1 kHz, carro 20 kHz, y los calefactores
//  por software), asi que se configura cada slice a mano con la API del SDK.

static void pwm_configurar_pin(uint8_t pin, uint32_t frecuencia_hz, uint16_t wrap) {
  gpio_set_function(pin, GPIO_FUNC_PWM);
  const uint slice = pwm_gpio_to_slice_num(pin);
  const float div = (float)clock_get_hz(clk_sys) / ((float)frecuencia_hz * (float)(wrap + 1));
  pwm_set_clkdiv(slice, div);
  pwm_set_wrap(slice, wrap);
  pwm_set_gpio_level(pin, 0);
  pwm_set_enabled(slice, true);
}

// -------------------------------------------------------------------------------------------------
//  Tabla senoidal del 28BYJ-48. Unipolar: cada una de las cuatro fases lleva la mitad positiva
//  de un seno desfasado 90 grados. Un ULN2003 solo sabe tirar a masa, asi que las mitades
//  negativas las hace la fase opuesta. Convierte cuatro escalones bruscos en una transicion
//  suave: es microstepping pobre, pero elimina el "tic" que es la unica fuente impulsiva de
//  toda la maquina.
// -------------------------------------------------------------------------------------------------
static void carro_construir_tabla() {
  for (int i = 0; i < CARRO_TABLA_N; i++) {
    const float th = 2.0f * (float)M_PI * (float)i / (float)CARRO_TABLA_N;
    const float s = sinf(th), c = cosf(th);
    g_tabla_carro[i][0] = (uint16_t)(CARRO_PWM_AMPLITUD * fmaxf(0.0f,  s));  // IN1
    g_tabla_carro[i][1] = (uint16_t)(CARRO_PWM_AMPLITUD * fmaxf(0.0f,  c));  // IN2
    g_tabla_carro[i][2] = (uint16_t)(CARRO_PWM_AMPLITUD * fmaxf(0.0f, -s));  // IN3
    g_tabla_carro[i][3] = (uint16_t)(CARRO_PWM_AMPLITUD * fmaxf(0.0f, -c));  // IN4
  }
}

static inline void carro_escribir_fase(uint8_t f) {
  pwm_set_gpio_level(PIN_ULN_IN1, g_tabla_carro[f][0]);
  pwm_set_gpio_level(PIN_ULN_IN2, g_tabla_carro[f][1]);
  pwm_set_gpio_level(PIN_ULN_IN3, g_tabla_carro[f][2]);
  pwm_set_gpio_level(PIN_ULN_IN4, g_tabla_carro[f][3]);
}

// El ULN2003 COMPLETAMENTE DESENERGIZADO. Es el estado por defecto y el estado durante el
// 96 % de la sesion: cero corriente, cero calor, cero zumbido, y el husillo T8 es
// retro-conducible, asi que no hace falta par de retencion para nada.
static inline void carro_desenergizar() {
  pwm_set_gpio_level(PIN_ULN_IN1, 0);
  pwm_set_gpio_level(PIN_ULN_IN2, 0);
  pwm_set_gpio_level(PIN_ULN_IN3, 0);
  pwm_set_gpio_level(PIN_ULN_IN4, 0);
}


// =================================================================================================
//  BLOQUE 4 — LA ISR DE 8 kHz
// =================================================================================================
//  Un unico temporizador hardware a 125 us hace tres trabajos, y ninguno de los tres tolera
//  el jitter del bucle principal:
//     1. Alimenta el FIFO del PIO con los intervalos que ha precalculado el bucle principal.
//     2. Genera el LATIDO de 2 kHz, y SOLO si el bucle principal sigue vivo.
//     3. Da un micropaso al carro radial cuando toca.
//  Ademas hace el antirrebote del microrruptor y captura la posicion exacta del cierre.
//
//  Coste: a 8 kHz, con unas pocas decenas de instrucciones por vuelta, esta ISR se come
//  alrededor del 2 % del RP2040. No usa float en ningun sitio.

static bool tick_isr(struct repeating_timer* t) {
  (void)t;

  // ---- 1. LATIDO DE SEGURIDAD -------------------------------------------------------------------
  //  Se conmuta GP11 a mano, no con un slice de PWM. Esta es LA diferencia que hace que el
  //  latido cubra de verdad el caso "firmware colgado": un slice de PWM seguiria oscilando
  //  dentro de un while(1), y el charge pump seguiria manteniendo VMOT vivo con las bobinas
  //  energizadas y la brocha sobre la piel. Ver config.h seccion 10.
  const uint32_t ahora = millis();
  const bool bucle_vivo = ((uint32_t)(ahora - g_bucle_vivo_ms) < LATIDO_VENTANA_MS);
  if (bucle_vivo && g_latido_permitido) {
    if (++g_latido_div >= LATIDO_TICKS_POR_SEMIPERIODO) {
      g_latido_div = 0;
      g_latido_nivel = !g_latido_nivel;
      gpio_put(PIN_HEARTBEAT, g_latido_nivel);
    }
  } else {
    // Latido muerto: el charge pump se descarga (tau = 47 ms) y VMOT cae en <250 ms.
    gpio_put(PIN_HEARTBEAT, 0);
  }

  // ---- 2. ANTIRREBOTE Y CAPTURA DEL MICRORRUPTOR --------------------------------------------------
  //  Contacto NA a GND con pull-up: BAJO = EN REPOSO. Se exigen SW_ANTIRREBOTE_TICKS lecturas
  //  bajas seguidas (5 ms) sobre el RC de 1 ms de la placa. La posicion que se guarda es la de
  //  la PRIMERA lectura baja, no la de la confirmacion: a 4166 micropasos/s, 5 ms serian
  //  21 micropasos = 0,08 grados de error si se guardara la de la confirmacion.
  if (digitalRead(PIN_SW_PARK) == SW_NIVEL_EN_REPOSO) {
    if (g_sw_cuenta == 0) g_sw_pos_instantanea = g_pos_upasos;
    if (g_sw_cuenta < SW_ANTIRREBOTE_TICKS) {
      g_sw_cuenta++;
      if (g_sw_cuenta >= SW_ANTIRREBOTE_TICKS) {
        g_sw_cerrado_ahora = true;
        if (!g_sw_capturado) { g_sw_capturado = true; g_sw_pos_capturada = g_sw_pos_instantanea; }
      }
    }
  } else {
    g_sw_cuenta = 0;
    g_sw_cerrado_ahora = false;
  }

  // ---- 3. ALIMENTAR EL FIFO DEL PIO ---------------------------------------------------------------
  //  Cada palabra que se empuja ES un micropaso ordenado, asi que aqui se lleva la cuenta de
  //  la posicion. La emision real va como mucho 8 palabras por detras (2 ms al ritmo maximo);
  //  esa diferencia se borra cinco veces por sesion contra el tope mecanico.
  for (uint8_t k = 0; k < ISR_PUSH_MAX_POR_TICK; k++) {
    if (g_buf_cola == g_buf_cab) break;                                  // buffer vacio
    if (pio_sm_is_tx_fifo_full(PIO_INSTANCIA, PIO_SM)) break;            // FIFO lleno
    const uint32_t extra = g_buf[g_buf_cola];
    g_buf_cola = (uint16_t)((g_buf_cola + 1) & BUFFER_PASOS_MASCARA);
    pio_sm_put(PIO_INSTANCIA, PIO_SM, extra);
    g_pos_upasos += g_dir_signo;
    g_ultimo_intervalo_us = PIO_SUELO_US + extra;
    g_ultimo_push_us = micros();
  }

  // ---- 4. CARRO RADIAL -----------------------------------------------------------------------------
  if (g_carro_activo) {
    if (++g_carro_div >= CARRO_DIVISOR_TICKS) {
      g_carro_div = 0;
      if (g_carro_pos_upasos != g_carro_obj_upasos) {
        const int8_t paso = (g_carro_obj_upasos > g_carro_pos_upasos) ? +1 : -1;
        g_carro_pos_upasos += paso;
        g_carro_fase = (uint8_t)((g_carro_fase + (paso > 0 ? 1 : (CARRO_TABLA_N - 1))) % CARRO_TABLA_N);
        carro_escribir_fase(g_carro_fase);
      } else {
        g_carro_activo = false;
        carro_desenergizar();     // ULN2003 completamente fuera el resto del tiempo
      }
    }
  }
  return true;
}
static struct repeating_timer g_temporizador;


// =================================================================================================
//  BLOQUE 5 — LED ROJO
// =================================================================================================
//  Un LED de 3 mm con 10 kOhm: 150 uA a duty 100 %. Se usa al 5-20 %.
//  Vocabulario deliberadamente minusculo. DURANTE LA SESION EL LED ESTA APAGADO: un LED fijo
//  en una habitacion a oscuras ES una fuente de luz, y la promesa del aparato es no despertarte.

static void led_nivel(uint16_t v) { pwm_set_gpio_level(PIN_LED_RED, v); }

// Patron generico no bloqueante: rafagas de <reps> parpadeos, luego una pausa.
static void led_patron(uint32_t on_ms, uint32_t off_ms, uint8_t reps, uint32_t pausa_ms, uint16_t brillo) {
  if (on_ms == 0) { led_nivel(0); return; }
  const uint32_t ciclo = on_ms + off_ms;
  const uint32_t rafaga = (reps == 0) ? ciclo : (ciclo * reps + pausa_ms);
  const uint32_t t = millis() % rafaga;
  if (reps != 0 && t >= ciclo * reps) { led_nivel(0); return; }
  led_nivel(((t % ciclo) < on_ms) ? brillo : 0);
}

// Respiracion lenta (pre-warm): una senoide elevada al cuadrado, para que el ojo la vea lineal.
static void led_respirar(uint32_t periodo_ms, uint16_t brillo_max) {
  const float u = (float)(millis() % periodo_ms) / (float)periodo_ms;
  const float s = 0.5f - 0.5f * cosf(2.0f * (float)M_PI * u);
  led_nivel((uint16_t)(brillo_max * s * s));
}

static void led_por_estado() {
  switch (g_estado) {
    case EST_BOOT:     led_nivel(LED_BRILLO_TENUE); break;
    case EST_HOMING:   led_patron(LED_HOMING_ON_MS,   LED_HOMING_OFF_MS,   0, 0, LED_BRILLO_NORMAL); break;
    case EST_AUTOTUNE: led_patron(LED_AUTOTUNE_ON_MS, LED_AUTOTUNE_OFF_MS,
                                  LED_AUTOTUNE_REPS,  LED_AUTOTUNE_PAUSA_MS, LED_BRILLO_NORMAL); break;
    case EST_IDLE:     led_patron(LED_IDLE_ON_MS,     LED_IDLE_OFF_MS,     0, 0, LED_BRILLO_TENUE); break;
    case EST_PREWARM:  led_respirar(LED_PREWARM_RESPIRA_MS, LED_BRILLO_TENUE); break;
    case EST_RUNNING:  led_nivel(0); break;                    // <<< APAGADO. Es lo importante.
    case EST_RETREAT:  led_patron(LED_FIN_ON_MS, LED_FIN_OFF_MS, LED_FIN_REPS,
                                  LED_FIN_OFF_MS, LED_BRILLO_TENUE); break;
    case EST_FAULT: {
      // 4 parpadeos rapidos + 5 s encendido, repetido cada 30 s. Sin codigos que descifrar
      // a las tres de la manana: el diagnostico se lee por USB al dia siguiente.
      const uint32_t ciclo = LED_FALLO_ON_MS + LED_FALLO_OFF_MS;
      const uint32_t t = millis() % LED_FALLO_PAUSA_MS;
      if (t < ciclo * LED_FALLO_REPS)              led_nivel(((t % ciclo) < LED_FALLO_ON_MS) ? LED_BRILLO_FALLO : 0);
      else if (t < ciclo * LED_FALLO_REPS + LED_FALLO_FIJO_MS) led_nivel(LED_BRILLO_FALLO);
      else                                          led_nivel(0);
      break;
    }
  }
}


// =================================================================================================
//  BLOQUE 6 — TERMICA: NTC Y CALEFACTORES
// =================================================================================================

static uint16_t adc_leer_promedio(uint8_t gpio) {
  uint32_t suma = 0;
  for (int i = 0; i < NTC_MUESTRAS; i++) suma += analogRead(gpio);
  return (uint16_t)(suma / NTC_MUESTRAS);
}

// Ecuacion Beta. Divisor: R_SERIE de 3V3 al nudo, NTC del nudo a GND.
//    cuenta = 4095 * R_ntc / (R_SERIE + R_ntc)   ->   R_ntc = R_SERIE * cuenta / (4095 - cuenta)
static float ntc_cuenta_a_celsius(uint16_t cuenta) {
  if (cuenta >= (uint16_t)ADC_CUENTAS_MAX) return -273.0f;
  if (cuenta == 0) return 999.0f;
  const float r = NTC_R_SERIE_OHM * (float)cuenta / (ADC_CUENTAS_MAX - (float)cuenta);
  const float inv = 1.0f / NTC_T_NOMINAL_K + logf(r / NTC_R_NOMINAL_OHM) / NTC_BETA;
  return (1.0f / inv) - 273.15f;
}

// Devuelve true si la lectura es CREIBLE. Un NTC del que no te fias no calienta nada.
//   ABIERTO (cable partido, conector suelto): el nudo sube a 3V3 -> cuenta cerca de 4095
//   EN CORTO (pinzado, soldadura puenteada):  el nudo cae a 0    -> cuenta cerca de 0
static bool ntc_leer(uint8_t gpio, float* dest, float anterior, uint32_t dt_ms, uint8_t* fallos) {
  const uint16_t cuenta = adc_leer_promedio(gpio);
  bool ok = true;
  if (cuenta >= NTC_CUENTA_ABIERTO_MIN) ok = false;   // desconectado
  if (cuenta <= NTC_CUENTA_CORTO_MAX)   ok = false;   // en corto
  const float t = ntc_cuenta_a_celsius(cuenta);
  if (ok && dt_ms > 0) {
    const float pendiente = fabsf(t - anterior) * 1000.0f / (float)dt_ms;
    // Una ferula de silicona con 0,21 W no puede cambiar 3 C en un segundo. Si lo hace, el
    // sensor esta suelto y dando golpes, o hay un falso contacto.
    if (pendiente > NTC_SALTO_MAX_C_POR_S && anterior > -100.0f) ok = false;
  }
  if (ok) { *fallos = 0; *dest = t; return true; }
  if (*fallos < 255) (*fallos)++;
  return (*fallos < NTC_FALLOS_SEGUIDOS);
}

// Regulador P+I con anti-windup. La constante termica de una ferula de silicona son decenas
// de segundos: no hace falta nada mas sofisticado, y un derivativo solo amplificaria el
// ruido del ADC.
static uint8_t calef_regular(float temp, float objetivo, float* integral, bool permitido) {
  if (!permitido) { *integral = 0.0f; return 0; }
  if (temp >= TEMP_LIMITE_FIRMWARE_C) { *integral = 0.0f; return 0; }     // corte duro
  if (temp >= objetivo + TEMP_HISTERESIS_C) { return 0; }
  const float err = objetivo - temp;
  *integral += err * CALEF_KI * ((float)CALEF_PERIODO_MS / 1000.0f);
  if (*integral > CALEF_I_MAX) *integral = CALEF_I_MAX;
  if (*integral < 0.0f)        *integral = 0.0f;
  float duty = err * CALEF_KP + *integral;
  if (duty < 0.0f) duty = 0.0f;
  if (duty > (float)CALEF_DUTY_MAX) duty = (float)CALEF_DUTY_MAX;
  return (uint8_t)duty;
}

// PWM lento POR SOFTWARE a 2 Hz. El PWM hardware del RP2040 no baja de 7,45 Hz
// (125 MHz / (clkdiv 255,94 x wrap 65536)), asi que 2 Hz hay que hacerlo a mano.
// Conmutar un MOSFET sobre una resistencia a 2 Hz no hace ni ruido ni EMI.
static void calef_pwm_lento() {
  const uint32_t fase = millis() % CALEF_PERIODO_MS;
  const uint32_t umbral_fer = (uint32_t)g_duty_ferula * CALEF_PERIODO_MS / CALEF_RESOLUCION;
  const uint32_t umbral_taz = (uint32_t)g_duty_taza   * CALEF_PERIODO_MS / CALEF_RESOLUCION;
  digitalWrite(PIN_HEAT_FER, (g_calefactores_on && fase < umbral_fer) ? HIGH : LOW);
  digitalWrite(PIN_HEAT_CUP, (g_calefactores_on && fase < umbral_taz) ? HIGH : LOW);
}

static void calefactores_fuera() {
  g_calefactores_on = false;
  g_duty_ferula = g_duty_taza = 0;
  g_integral_ferula = g_integral_taza = 0.0f;
  digitalWrite(PIN_HEAT_FER, LOW);
  digitalWrite(PIN_HEAT_CUP, LOW);
}


// =================================================================================================
//  BLOQUE 7 — SEGURIDAD: RAIL DEL MOTOR, BROWNOUT, PARO DE EMERGENCIA
// =================================================================================================

static void driver_desenergizar() {
  digitalWrite(PIN_nEN, HIGH);        // EN es ACTIVO A NIVEL BAJO: alto = driver fuera
  pio_sm_clear_fifos(PIO_INSTANCIA, PIO_SM);
  noInterrupts(); g_buf_cab = g_buf_cola = 0; interrupts();
}

static void driver_energizar() {
  digitalWrite(PIN_nEN, LOW);
}

// IHOLD depende de DONDE nos hayamos parado. Ver el comentario largo de config.h seccion 4:
// con IHOLD = 0 fuera del reposo, el contrapeso (17,3 mN.m referidos al motor) se lleva la
// botavara por delante. En el reposo, en cambio, el que aguanta es el tope mecanico M4 y ahi
// si se puede (y se debe) ir a corriente CERO DE VERDAD con freewheel = 01.
static void fijar_ihold_por_posicion(bool en_reposo) {
  g_drv.ihold(en_reposo ? TMC_IHOLD_CS_REPOSO : TMC_IHOLD_CS_FUERA);
  g_drv.freewheel(en_reposo ? TMC_FREEWHEEL : 0);
}

// ---- Deteccion del paro de emergencia y del latch --------------------------------------------
//  S1 es un pulsador NC enclavable EN SERIE CON EL COBRE. No es una entrada de GPIO y no pasa
//  por el firmware: funciona con el MCU muerto, colgado o desoldado. Lo unico que hace el
//  firmware es DARSE CUENTA, para poder terminar limpiamente (apagar calefactores, escribir el
//  log, poner el LED de fallo) en vez de quedarse dando vueltas mandando pasos a un driver
//  que ya no tiene alimentacion.
//
//  GP12 (RAIL_SENSE) lee el divisor 10k/10k desde VMOT como ENTRADA DIGITAL:
//      VMOT 5,0 V -> nudo 2,5 V -> ALTO   (VIH del RP2040 = 2,0 V)
//      VMOT   0 V -> nudo   0 V -> BAJO
//  Cruzandolo con VBUS (GP28, ADC de verdad) se distingue el caso:
//      rail BAJO + VBUS bien  ->  S1 pulsado, o el latch CD4013 disparado
//      rail BAJO + VBUS bajo  ->  brownout o cable USB fuera
static bool rail_motor_vivo() { return digitalRead(PIN_RAIL_SENSE_DIG) == HIGH; }

static bool vbus_ok() {
  return analogRead(ADC_VBUS_SENSE) >= UMBRAL_VBUS_ABORTO_CUENTAS;
}


// =================================================================================================
//  BLOQUE 8 — MEMORIA NO VOLATIL
// =================================================================================================

static uint32_t nvm_suma(const Persistencia& p) {
  const uint8_t* b = (const uint8_t*)&p;
  uint32_t h = 2166136261UL;                       // FNV-1a
  for (size_t i = 0; i < sizeof(Persistencia) - sizeof(uint32_t); i++) { h ^= b[i]; h *= 16777619UL; }
  return h;
}

static void nvm_cargar() {
  EEPROM.get(EEPROM_DIRECCION, g_nvm);
  if (g_nvm.magia == EEPROM_MAGIA && g_nvm.suma == nvm_suma(g_nvm)) {
    g_pwm_ofs  = g_nvm.pwm_ofs;
    g_pwm_grad = g_nvm.pwm_grad;
    g_calibracion_valida = true;
  } else {
    memset(&g_nvm, 0, sizeof(g_nvm));
    g_nvm.magia    = EEPROM_MAGIA;
    g_nvm.pwm_ofs  = PWM_OFS_DEFECTO;
    g_nvm.pwm_grad = PWM_GRAD_DEFECTO;
    g_nvm.sgthrs   = TMC_SGTHRS;
    g_nvm.irun_cs  = TMC_IRUN_CS;
    g_pwm_ofs  = PWM_OFS_DEFECTO;
    g_pwm_grad = PWM_GRAD_DEFECTO;
    g_calibracion_valida = false;    // no hay Procedimiento A hecho: se usan los de fabrica
  }
}

// Se escribe UNA VEZ POR NOCHE, al terminar. El flash aguanta ~100.000 borrados: 270 anos.
static void nvm_guardar() {
  g_nvm.magia    = EEPROM_MAGIA;
  g_nvm.pwm_ofs  = g_pwm_ofs;
  g_nvm.pwm_grad = g_pwm_grad;
  for (int i = 0; i < 5; i++) g_nvm.err_homing[i] = g_err_homing[i];
  g_nvm.sesiones++;
  if (g_fallo != FALLO_NINGUNO) { g_nvm.fallos++; g_nvm.ultimo_fallo = (uint8_t)g_fallo; }
  g_nvm.suma = nvm_suma(g_nvm);
  EEPROM.put(EEPROM_DIRECCION, g_nvm);
  EEPROM.commit();
}


// =================================================================================================
//  BLOQUE 9 — CONFIGURACION DEL TMC2209
// =================================================================================================

static bool tmc_configurar() {
  Serial1.setTX(PIN_TMC_TX);
  Serial1.setRX(PIN_TMC_RX);
  Serial1.begin(TMC_BAUDIOS);
  delay(20);
  g_drv.begin();

  // --- 1. Autenticidad. IOIN.VERSION debe ser 0x21. Si no, es un clon o el UART esta muerto ---
  const uint8_t ver = g_drv.version();
  if (ver != TMC_VERSION_ESPERADA) { g_fallo = FALLO_TMC_VERSION; return false; }

  // --- 2. Estado de arranque. Se espera reset=1; drv_err o uv_cp indican problema real ---
  const uint8_t gstat = g_drv.GSTAT();
  g_drv.GSTAT(0b111);                                  // limpia los tres flags
  if (gstat & 0b010) { g_fallo = FALLO_DRIVER_ERROR; return false; }

  // --- 3. Configuracion global ---
  g_drv.senddelay(TMC_SENDDELAY);      // 8 tiempos de bit de guarda. OBLIGATORIO en half-duplex.
  g_drv.I_scale_analog(false);         // IGNORA el potenciometro VREF de la placa
  g_drv.internal_Rsense(false);
  g_drv.en_spreadCycle(false);         // StealthChop
  g_drv.pdn_disable(true);             // obligatorio para hablar por UART
  g_drv.mstep_reg_select(TMC_MSTEP_POR_REGISTRO);
  g_drv.multistep_filt(true);

  // --- 4. Corriente. Se escribe CS directamente en vez de rms_current(), para que el numero
  //        del datasheet y el numero del codigo sean el mismo y no dependan de la aritmetica
  //        interna de la libreria. Ver la tabla de config.h seccion 4. ---
  g_drv.vsense(TMC_VSENSE);            // V_fs = 0,180 V
  g_drv.irun(TMC_IRUN_CS);             // CS = 10 -> 0,337 A rms
  g_drv.ihold(TMC_IHOLD_CS_REPOSO);    // arrancamos en el reposo: corriente cero
  g_drv.iholddelay(TMC_IHOLDDELAY);    // ~330 ms de rampa. Bajar la corriente de golpe se OYE.
  g_drv.TPOWERDOWN(TMC_TPOWERDOWN);

  // --- 5. Chopper ---
  g_drv.toff(TMC_TOFF);
  g_drv.blank_time(TMC_BLANK_TIME);
  g_drv.microsteps((uint16_t)MICROSTEPPING);
  g_drv.intpol(TMC_INTPOL);            // MicroPlyer: interpola a 1/256 = 2,58 um/micropaso

  // --- 6. StealthChop2 PERMANENTE ---
  g_drv.TPWMTHRS(TMC_TPWMTHRS);        // con el umbral al maximo nunca cede a SpreadCycle
  g_drv.pwm_freq(TMC_PWM_FREQ);
  g_drv.pwm_autoscale(true);           // sigue ajustando la AMPLITUD en tiempo real: bien
  g_drv.pwm_autograd(false);           // CONGELADO: no re-medir el gradiente a paso de tortuga
  g_drv.pwm_ofs(g_pwm_ofs);            // desde flash (Procedimiento A) o valor de fabrica
  g_drv.pwm_grad(g_pwm_grad);

  // --- 7. freewheel = 01. NO es ahorro de consumo: es parte de la cadena de fallo seguro.
  //        Con 10 u 11 las bobinas quedan cortocircuitadas y el motor frena magneticamente
  //        contra los 247 mN.m del contrapeso. Con 01 quedan en alta impedancia. ---
  g_drv.freewheel(TMC_FREEWHEEL);

  // --- 8. StallGuard4 como SEGUNDO disparo. Nunca el primero. ---
  g_drv.TCOOLTHRS(TMC_TCOOLTHRS);
  g_drv.SGTHRS(g_nvm.sgthrs ? g_nvm.sgthrs : TMC_SGTHRS);

  return true;
}

// Se relee CHOPCONF antes de cada golpe. Si MRES ha cambiado, los milimetros por pulso han
// cambiado, y entonces el suelo del PIO ya no corresponde a la velocidad que creemos.
// Es la unica manera de que el clamp siga significando lo que dice que significa.
static bool verificar_microstepping() {
  return (g_drv.microsteps() == (uint16_t)MICROSTEPPING);
}

// -------------------------------------------------------------------------------------------------
//  StallGuard4 — QUE ES Y QUE NO ES. LEE ESTO ANTES DE FIARTE DE EL.
// -------------------------------------------------------------------------------------------------
//  StallGuard4 deduce la carga a partir de la fuerza contraelectromotriz que genera el motor.
//  A muy baja velocidad el motor apenas genera, asi que la medida se degrada hasta ser ruido.
//  La literatura de Trinamic situa el suelo de fiabilidad en torno a 10 rpm. Nuestro motor gira a:
//
//      velocidad de punta   pasos completos/s   rpm del motor   StallGuard?
//      -----------------    -----------------   -------------   -----------------------------
//         2,0 cm/s                30,3               9,1        NO. Justo debajo del suelo.
//         3,0 cm/s                45,5              13,6        Marginal.
//         5,0 cm/s                75,8              22,7        Si.
//         7,0 cm/s               106,1              31,8        Si.
//
//  Y el paseo OU pasa una fraccion apreciable de la sesion en la parte baja de la banda.
//
//  POR TANTO, Y SIN ADORNOS:
//     - LA DETECCION PRIMARIA DE OBSTRUCCION ES LA VERIFICACION DE INTEGRIDAD DEL
//       MICRORRUPTOR (funcion visita_taza), y ocurre CINCO VECES POR SESION.
//     - StallGuard4 es una red SECUNDARIA y solo se consulta en los tramos RAPIDOS y FUERA
//       DE LA PIEL: las rampas de aceleracion y deceleracion sobre la meseta plana, donde
//       la brocha esta 11,8 mm en el aire.
//     - NO existe verificacion golpe a golpe sobre la piel. No se promete lo que no hay.
//     - Ninguna decision de seguridad de este aparato descansa sobre StallGuard4. La
//       seguridad es un peso de 360 g colgado de una cuerda.
//
//  Que hace cuando dispara: termina el ciclo ordenadamente. Ni siquiera es un FAULT duro,
//  porque la probabilidad de falso positivo a estas velocidades es alta.
static bool vigilar_stallguard(float v_actual_mms, float ang_actual_deg) {
  const bool fuera_de_la_piel = (fabsf(ang_actual_deg) > ANG_TAPER_DEG);
  const bool suficientemente_rapido = (v_actual_mms >= SG_VELOCIDAD_MIN_FIABLE_MMS);
  if (!fuera_de_la_piel || !suficientemente_rapido) { g_sg_disparos = 0; return false; }
  if (digitalRead(PIN_DIAG) == HIGH) {
    if (++g_sg_disparos >= SG_DISPAROS_SEGUIDOS) return true;
  } else {
    g_sg_disparos = 0;
  }
  return false;
}


// =================================================================================================
//  BLOQUE 10 — RUIDO ALEATORIO Y LOS SEIS PASEOS DE ORNSTEIN-UHLENBECK
// =================================================================================================
//  Un paseo OU es ruido que vuelve a su media: irregular pero acotado, que es exactamente lo
//  que hace falta aqui. Un ruido blanco puro daria saltos de 2 a 7 cm/s entre golpes
//  consecutivos y eso se percibe como averia, no como espontaneidad.
//
//  VEREDICTO HONESTO, copiado de la especificacion vinculante: esto es estadisticamente
//  irregular pero ESTRUCTURALMENTE PREDECIBLE. Un cerebro lo habra modelado en diez minutos.
//  Seis palancas no son agencia. Si a partir del minuto 8 la sensacion se aplana, la respuesta
//  honesta es un tercer eje mecanico, no mas firmware.

static uint32_t g_rng = 0x1BADC0DEUL;
static inline uint32_t xorshift32() {
  g_rng ^= g_rng << 13; g_rng ^= g_rng >> 17; g_rng ^= g_rng << 5; return g_rng;
}
static inline float uniforme() { return (float)(xorshift32() >> 8) / 16777216.0f; }   // [0,1)

// Box-Muller con el segundo valor cacheado.
static float normal01() {
  static bool hay = false; static float guardado = 0.0f;
  if (hay) { hay = false; return guardado; }
  float u1 = uniforme(); if (u1 < 1e-7f) u1 = 1e-7f;
  const float u2 = uniforme();
  const float r = sqrtf(-2.0f * logf(u1));
  guardado = r * sinf(2.0f * (float)M_PI * u2); hay = true;
  return r * cosf(2.0f * (float)M_PI * u2);
}

struct OU { float x, mu, sigma, tau, lo, hi; };

// x[n+1] = mu + (x[n]-mu)*exp(-1/tau) + sigma*sqrt(1-exp(-2/tau))*N(0,1)
// En los bordes se REFLEJA, no se recorta. Recortar hace que el paseo se quede PEGADO al
// limite, y una racha de golpes identicos al minimo de la banda se nota enseguida.
static float ou_siguiente(OU& o) {
  const float a = expf(-1.0f / o.tau);
  const float b = o.sigma * sqrtf(1.0f - a * a);
  o.x = o.mu + (o.x - o.mu) * a + b * normal01();
  for (int i = 0; i < 4; i++) {                    // reflexion (varias veces por si se pasa mucho)
    if (o.x < o.lo) o.x = 2.0f * o.lo - o.x;
    if (o.x > o.hi) o.x = 2.0f * o.hi - o.x;
  }
  if (o.x < o.lo) o.x = o.lo;
  if (o.x > o.hi) o.x = o.hi;
  return o.x;
}

static OU g_ou_vel    = { OU_VEL_MEDIA_BLOQUE_1, OU_VEL_MEDIA_BLOQUE_1, OU_VEL_SIGMA_MMS,  OU_VEL_TAU_GOLPES,    OU_VEL_MIN_MMS,    OU_VEL_MAX_MMS   };
static OU g_ou_hueco  = { OU_HUECO_MEDIA_S,      OU_HUECO_MEDIA_S,      OU_HUECO_SIGMA_S,  OU_HUECO_TAU_GOLPES,  OU_HUECO_MIN_S,    OU_HUECO_MAX_S   };
static OU g_ou_rampa  = { OU_RAMPA_MEDIA_S,      OU_RAMPA_MEDIA_S,      OU_RAMPA_SIGMA_S,  OU_RAMPA_TAU_GOLPES,  OU_RAMPA_MIN_S,    OU_RAMPA_MAX_S   };
static OU g_ou_inver  = { OU_INVER_MEDIA_DEG,    OU_INVER_MEDIA_DEG,    OU_INVER_SIGMA_DEG,OU_INVER_TAU_GOLPES,  OU_INVER_MIN_DEG,  OU_INVER_MAX_DEG };
static OU g_ou_rozada = { OU_ROZADA_MEDIA_DEG,   OU_ROZADA_MEDIA_DEG,   OU_ROZADA_SIGMA_DEG,OU_ROZADA_TAU_GOLPES,OU_ROZADA_MIN_DEG, OU_ROZADA_MAX_DEG};
static OU g_ou_radio  = { OU_RADIO_MEDIA_MM,     OU_RADIO_MEDIA_MM,     OU_RADIO_SIGMA_MM, OU_RADIO_TAU_GOLPES,  OU_RADIO_MIN_MM,   OU_RADIO_MAX_MM  };

static void ou_fijar_media_de_bloque(uint8_t bloque) {
  static const float medias[CICLO_BLOQUES] = {
    OU_VEL_MEDIA_BLOQUE_1, OU_VEL_MEDIA_BLOQUE_2, OU_VEL_MEDIA_BLOQUE_3, OU_VEL_MEDIA_BLOQUE_4
  };
  if (bloque < CICLO_BLOQUES) g_ou_vel.mu = medias[bloque];
}


// =================================================================================================
//  BLOQUE 11 — PLANIFICADOR DE MOVIMIENTO
// =================================================================================================
//  PERFIL TRAPEZOIDAL LIMITADO EN JERK.
//
//  La rampa no es una recta de velocidad (trapecio clasico) sino la QUINTICA DE JERK MINIMO
//
//        f(u) = u^3 (10 - 15u + 6u^2),      f(0)=0, f(1)=1, f'(0)=f'(1)=0, f''(0)=f''(1)=0
//
//  que llega a la meseta con ACELERACION CERO Y JERK CERO. Un trapecio tiene jerk infinito en
//  las cuatro esquinas; sobre un tendon de Dyneema con un acoplamiento de silicona de 5,2 Hz,
//  esas esquinas son exactamente lo que excita el modo torsional y produce el tiron audible.
//
//  DONDE OCURRE CADA COSA (esto es la parte importante):
//
//     |phi|  40      33         26        19          0          19       26        33      40
//            |-------|----------|---------|-----------|-----------|--------|---------|-------|
//            | MESETA| ELEVACION|  TAPER  |        CONTACTO A 400 mN      |  TAPER  |ELEVAC.|
//            |       |          |         |                              |         |       |
//     zona   |<---- AIRE, 11,8 mm de holgura ---->|<-- PIEL -->|<-- AIRE, 11,8 mm ---------->|
//            |                            |       |            |         |                   |
//     perfil |<==== ACELERACION ========>|<ramp>|<== v CONSTANTE ==>|<ramp>|<== DECELERACION ==>|
//                                          de                        de
//                                        fuerza                    fuerza
//
//  TODA la aceleracion y TODA la deceleracion del golpe caen en la meseta plana y la zona de
//  elevacion, con la brocha en el aire. Lo unico que varia dentro del taper es la transicion
//  v_entrada -> v_crucero, y ahi la fuerza aun esta subiendo de 0 a 400 mN: el cambio de
//  velocidad queda enmascarado por la propia rampa geometrica de fuerza.
//  Sobre la piel a fuerza plena, la velocidad es CONSTANTE (salvo la deriva 1/f opcional,
//  acotada a 2 mm/s^2 de aceleracion).

#define FORMA_CONST     0
#define FORMA_QUINTICA  1
#define TRAMOS_MAX      10

struct Tramo { float s0, s1, v0, v1; uint8_t forma; };

struct Movimiento {
  Tramo    tramos[TRAMOS_MAX];
  uint8_t  n;
  float    s, s_total, mm_por_upaso;
  uint32_t upasos_restantes;
  bool     activo;
  bool     deriva;
  float    deriva_lambda, deriva_fase, deriva_amp;
  float    s_contacto_ini, s_contacto_fin;
  float    s_aire_sal;      // arco a partir del cual la brocha ya NO toca (fin del taper de salida)
};
static Movimiento g_mov;

static inline float quintica(float u) { return u * u * u * (10.0f + u * (-15.0f + 6.0f * u)); }
static inline float mm_por_grado(float R) { return R * 0.01745329f; }
static inline float radio_actual() { return RADIO_NOMINAL_MM + g_radio_offset_mm; }
static inline int32_t ang_a_upasos(float a) { return (int32_t)lroundf(a * UPASOS_POR_GRADO); }
static inline float upasos_a_ang(int32_t u) { return (float)u / UPASOS_POR_GRADO; }
static inline float ang_actual_deg() { return upasos_a_ang(g_pos_upasos); }

static float mov_velocidad(float s) {
  float v = V_ARRANQUE_MMS;
  for (uint8_t i = 0; i < g_mov.n; i++) {
    const Tramo& T = g_mov.tramos[i];
    if (s <= T.s1 || i == (uint8_t)(g_mov.n - 1)) {
      if (T.forma == FORMA_CONST) { v = T.v0; }
      else {
        const float L = T.s1 - T.s0;
        float u = (L > 0.001f) ? ((s - T.s0) / L) : 1.0f;
        if (u < 0.0f) u = 0.0f;
        if (u > 1.0f) u = 1.0f;
        v = T.v0 + (T.v1 - T.v0) * quintica(u);
      }
      break;
    }
  }
  // Deriva 1/f: SOLO dentro de la zona de contacto pleno, y con la longitud de onda calculada
  // para que la aceleracion nunca pase de DERIVA_1F_ACEL_MAX_MMS2 (2 mm/s^2).
  if (g_mov.deriva && s >= g_mov.s_contacto_ini && s <= g_mov.s_contacto_fin) {
    v *= 1.0f + g_mov.deriva_amp *
         sinf(2.0f * (float)M_PI * (s - g_mov.s_contacto_ini) / g_mov.deriva_lambda + g_mov.deriva_fase);
    // #### CORRECCION DE VERIFICACION ####
    // La banda 2,0-7,0 cm/s es un PARAMETRO VINCULANTE, no una sugerencia, y la deriva 1/f
    // se sumaba POR ENCIMA del paseo OU: con v_cru = 70,0 mm/s (el maximo que el OU puede
    // sortear) y +6 % de deriva, la punta iba a 74,2 mm/s = 7,42 cm/s SOBRE LA PIEL A FUERZA
    // PLENA. Y por abajo, 20,0 mm/s con -6 % daba 18,8 mm/s = 1,88 cm/s.
    // La deriva modula DENTRO de la banda; no la ensancha.
    if (v > OU_VEL_MAX_MMS) v = OU_VEL_MAX_MMS;
    if (v < OU_VEL_MIN_MMS) v = OU_VEL_MIN_MMS;
  }
  // Techo global. OJO CON EL VALOR: la banda 2,0-7,0 cm/s es la banda de LA CARICIA, y por eso
  // se aplica arriba dentro de la zona de contacto pleno. Fuera de la piel manda el tramo de
  // VUELO (V_VUELO_MMS = 7,5 cm/s), que es lo unico que hace geometricamente posible el hueco
  // minimo de 1,5 s. Recortar aqui a OU_VEL_MAX_MMS destrozaria el vuelo Y descuadraria el
  // estimador de tiempo (tiempo_quintica no recorta), asi que el techo global es V_VUELO_MMS.
  // El taper, que SI es contacto (a fuerza parcial), queda acotado aparte por
  // V_ENTRADA_TAPER_MAX_MMS = 70 mm/s. Y por encima de todo esto sigue el suelo del PIO.
  if (v > V_VUELO_MMS) v = V_VUELO_MMS;
  if (v < V_MINIMA_ABSOLUTA_MMS) v = V_MINIMA_ABSOLUTA_MMS;
  return v;
}

// Tiempo de recorrido de un tramo quintico, por integracion numerica (regla del punto medio).
// Se usa para resolver "que velocidad de entrada al taper da una rampa de exactamente t segundos".
static float tiempo_quintica(float L, float v0, float v1) {
  const int N = 32; float acc = 0.0f;
  for (int i = 0; i < N; i++) {
    const float u = ((float)i + 0.5f) / (float)N;
    float v = v0 + (v1 - v0) * quintica(u);
    // Suelo NUMERICO, no de movimiento: si aqui se usara V_ARRANQUE_MMS (6,0 mm/s) el
    // estimador mentiria en los movimientos mas lentos que eso — la pasada FINA de homing va
    // a 3,0 mm/s — y daria la mitad del tiempo real. Tiene que ser el mismo suelo que aplica
    // mov_velocidad(), o el tiempo estimado y el tiempo real dejan de ser la misma cosa.
    if (v < V_MINIMA_ABSOLUTA_MMS) v = V_MINIMA_ABSOLUTA_MMS;
    acc += 1.0f / v;
  }
  return L * acc / (float)N;
}

// Resuelve v_entrada por biseccion. El tiempo decrece monotonamente con v_entrada.
// Si el objetivo no es alcanzable, se recorta y se lleva la cuenta (g_recortes_rampa),
// porque es informacion util: dice que la banda 0,6-2,5 s de la spec no cabe entera en
// un taper de longitud fija a todas las velocidades de crucero.
static float resolver_v_entrada(float L_taper, float v_crucero, float t_objetivo) {
  float lo = V_ENTRADA_TAPER_MIN_MMS, hi = V_ENTRADA_TAPER_MAX_MMS;
  const float t_lo = tiempo_quintica(L_taper, lo, v_crucero);   // el mas lento posible
  const float t_hi = tiempo_quintica(L_taper, hi, v_crucero);   // el mas rapido posible
  if (t_objetivo >= t_lo) { g_recortes_rampa++; return lo; }
  if (t_objetivo <= t_hi) { g_recortes_rampa++; return hi; }
  for (int i = 0; i < 20; i++) {
    const float m = 0.5f * (lo + hi);
    if (tiempo_quintica(L_taper, m, v_crucero) > t_objetivo) lo = m; else hi = m;
  }
  return 0.5f * (lo + hi);
}

static void tramo_add(float s0, float s1, float v0, float v1, uint8_t forma) {
  if (g_mov.n >= TRAMOS_MAX) return;
  if (s1 <= s0 + 0.01f) return;                 // tramo degenerado: se descarta
  g_mov.tramos[g_mov.n++] = { s0, s1, v0, v1, forma };
}

// -------------------------------------------------------------------------------------------------
//  TRAMO DE VUELO (EJE 7, adicion A-01 de 05-algoritmo-movimiento.md).
//  Todo el trayecto FUERA DE LA PIEL (meseta plana + zona de despegue) se recorre a
//  V_VUELO_MMS, no a la velocidad de pasada. Sin esto, cruzar la zona de despegue ida y
//  vuelta a 2 cm/s cuesta 4,7 s y el hueco minimo de 1,5 s de la spec es imposible.
//  Distancias de aceleracion con aceleracion constante A_VUELO_MMS2; si no caben en el
//  tramo disponible (caso tipico: tras una inversion rozada) se degrada al perfil simple.
// -------------------------------------------------------------------------------------------------
static void tramo_vuelo(float s0, float s1, float v0, float v1) {
  const float L = s1 - s0;
  if (L <= 0.01f) return;
  const float vf = V_VUELO_MMS;
  if (v0 >= vf && v1 >= vf) { tramo_add(s0, s1, v0, v1, FORMA_QUINTICA); return; }
  const float d0 = (vf * vf - v0 * v0) / (2.0f * A_VUELO_MMS2);
  const float d1 = (vf * vf - v1 * v1) / (2.0f * A_VUELO_MMS2);
  if (d0 + d1 >= L) { tramo_add(s0, s1, v0, v1, FORMA_QUINTICA); return; }
  tramo_add(s0,      s0 + d0, v0, vf, FORMA_QUINTICA);
  tramo_add(s0 + d0, s1 - d1, vf, vf, FORMA_CONST);
  tramo_add(s1 - d1, s1,      vf, v1, FORMA_QUINTICA);
}

// -------------------------------------------------------------------------------------------------
//  Construye el perfil de UN GOLPE completo, de ang_ini a ang_fin (signos opuestos).
//  rozada_ini es cierto si el golpe ARRANCA dentro del taper (porque el anterior invirtio ahi).
//  rozada_fin es cierto si el golpe TERMINA dentro del taper (inversion rozada).
// -------------------------------------------------------------------------------------------------
static void construir_golpe(float ang_ini, float ang_fin, float v_cru, float t_rampa,
                            bool rozada_ini, bool rozada_fin) {
  const float R = radio_actual();
  const float k = mm_por_grado(R);
  const float si = (ang_ini >= 0.0f) ? +1.0f : -1.0f;
  const float sf = -si;
  const float L_taper = (ANG_TAPER_DEG - ANG_CONTACTO_DEG) * k;

  // Coordenada de arco: 0 en ang_ini, creciente hacia ang_fin.
  #define S_DE(a) (fabsf((a) - ang_ini) * k)

  const float v_ent = resolver_v_entrada(L_taper, v_cru, t_rampa);

  g_mov.n = 0;
  if (!rozada_ini) {
    // Aceleracion completa en el aire: meseta plana + zona de elevacion.
    tramo_vuelo(S_DE(ang_ini), S_DE(si * ANG_TAPER_DEG), V_ARRANQUE_MMS, v_ent);
    // Taper de entrada = LA RAMPA DE ATERRIZAJE. La forma de la fuerza la da el rail; el
    // firmware solo la escala en el tiempo eligiendo v_ent.
    tramo_add(S_DE(si * ANG_TAPER_DEG), S_DE(si * ANG_CONTACTO_DEG), v_ent, v_cru, FORMA_QUINTICA);
  } else {
    // Arranque dentro del taper (venimos de una inversion rozada): no hay meseta que usar,
    // asi que la aceleracion ocurre sobre piel a fuerza parcial (150-300 mN). Es exactamente
    // lo que la spec llama "grazing turnaround". Ver config.h eje 5.
    tramo_add(S_DE(ang_ini), S_DE(si * ANG_CONTACTO_DEG), V_ARRANQUE_MMS, v_cru, FORMA_QUINTICA);
  }

  // Zona de contacto pleno: velocidad CONSTANTE. Aqui no se acelera nunca.
  const float sc0 = S_DE(si * ANG_CONTACTO_DEG);
  const float sc1 = S_DE(sf * ANG_CONTACTO_DEG);
  tramo_add(sc0, sc1, v_cru, v_cru, FORMA_CONST);

  if (!rozada_fin) {
    tramo_add(sc1, S_DE(sf * ANG_TAPER_DEG), v_cru, v_ent, FORMA_QUINTICA);   // taper de salida
    tramo_vuelo(S_DE(sf * ANG_TAPER_DEG), S_DE(ang_fin), v_ent, V_ARRANQUE_MMS);
  } else {
    tramo_add(sc1, S_DE(ang_fin), v_cru, V_ARRANQUE_MMS, FORMA_QUINTICA);     // inversion rozada
  }

  // Deriva 1/f dentro del contacto. lambda se elige para respetar el techo de aceleracion:
  //     a = v^2 * A * 2pi / lambda  <=  DERIVA_1F_ACEL_MAX_MMS2
  g_mov.deriva = DERIVA_1F_HABILITADA;
  g_mov.deriva_amp = DERIVA_1F_AMPLITUD;
  g_mov.deriva_fase = uniforme() * 2.0f * (float)M_PI;
  const float lam_min = v_cru * v_cru * DERIVA_1F_AMPLITUD * 6.2832f / DERIVA_1F_ACEL_MAX_MMS2;
  g_mov.deriva_lambda = (lam_min > 180.0f) ? lam_min : 180.0f;
  g_mov.s_contacto_ini = sc0;
  g_mov.s_contacto_fin = sc1;
  // Donde empieza el VERDADERO tiempo sin contacto de este golpe: al terminar el taper de
  // salida, es decir al pasar de 26 grados. Tras una inversion rozada no hay taper de salida
  // ni despegue, asi que no hay tramo de aire en absoluto.
  g_mov.s_aire_sal = rozada_fin ? 1e9f : S_DE(sf * ANG_TAPER_DEG);
  #undef S_DE
}

// Perfil sencillo para movimientos que no tocan la piel (homing, visitas a la taza, retirada):
// acelerar, crucero, decelerar. Mismas quinticas de jerk minimo.
static void construir_simple(float D, float v) {
  const float rampa = fminf(0.20f * D, 20.0f);
  // El arranque no puede ser MAS RAPIDO que el crucero pedido: el homing fino va a 3,0 mm/s y
  // V_ARRANQUE_MMS son 6,0. Sin este fminf, la pasada fina de homing se haria al doble de
  // velocidad de la que da la repetibilidad de +/-0,05 mm del microrruptor de palanca.
  const float v0 = fminf(V_ARRANQUE_MMS, v);
  g_mov.n = 0;
  g_mov.deriva = false;
  g_mov.s_aire_sal = 1e9f;                // un movimiento simple no tiene tramo de vuelo propio
  if (D <= 2.0f * rampa + 0.5f) {
    tramo_add(0.0f, 0.5f * D, v0, v, FORMA_QUINTICA);
    tramo_add(0.5f * D, D,    v, v0, FORMA_QUINTICA);
  } else {
    tramo_add(0.0f, rampa,      v0, v, FORMA_QUINTICA);
    tramo_add(rampa, D - rampa, v, v, FORMA_CONST);
    tramo_add(D - rampa, D,     v, v0, FORMA_QUINTICA);
  }
}

// -------------------------------------------------------------------------------------------------
//  Tiempo que este golpe pasa YA SIN TOCAR LA PIEL despues del taper de salida, es decir la
//  primera mitad del hueco real. Hace falta porque el parametro vinculante ("huecos de 1,5-5,5 s
//  SIN CONTACTO") no acota el dwell en la meseta: acota el intervalo entero en el que la brocha
//  no toca, y ese intervalo es  vuelo_de_salida + dwell + vuelo_de_entrada_del_siguiente.
// -------------------------------------------------------------------------------------------------
static float mov_tiempo_aire_salida_s() {
  float t = 0.0f;
  for (uint8_t i = 0; i < g_mov.n; i++) {
    const Tramo& T = g_mov.tramos[i];
    if (T.s1 <= g_mov.s_aire_sal + 0.01f) continue;
    const float s0 = fmaxf(T.s0, g_mov.s_aire_sal);
    const float L  = T.s1 - s0;
    if (L <= 0.01f) continue;
    t += (T.forma == FORMA_CONST) ? (L / fmaxf(T.v0, V_MINIMA_ABSOLUTA_MMS))
                                  : tiempo_quintica(L, T.v0, T.v1);
  }
  return t;
}

// DIR solo se cambia con el PIO vacio y parado, y con DIR_SETUP_US de guarda antes del
// primer flanco de STEP. Cambiar DIR con pulsos en vuelo es la receta clasica de perder pasos.
static void mov_arrancar(int8_t dir, float distancia_mm) {
  g_dir_signo = dir;
  digitalWrite(PIN_DIR, (dir > 0) ? DIR_HACIA_REPOSO : DIR_HACIA_LEJOS);
  delayMicroseconds(DIR_SETUP_US);
  g_mov.mm_por_upaso   = MM_POR_UPASO(radio_actual());
  g_mov.s              = 0.0f;
  g_mov.s_total        = distancia_mm;
  g_mov.upasos_restantes = (uint32_t)lroundf(distancia_mm / g_mov.mm_por_upaso);
  g_mov.activo         = true;
}

// Productor: rellena el buffer circular con intervalos EXTRA para el PIO.
// El valor que se escribe es (intervalo - 240 us) y NUNCA puede ser negativo: si el
// planificador pidiera una velocidad imposible, el resultado es 0 y el PIO impone su suelo.
static void mov_alimentar() {
  if (!g_mov.activo) return;
  while (g_mov.upasos_restantes > 0) {
    const uint16_t sig = (uint16_t)((g_buf_cab + 1) & BUFFER_PASOS_MASCARA);
    if (sig == g_buf_cola) break;                        // buffer lleno
    g_mov.s += g_mov.mm_por_upaso;
    const float v = mov_velocidad(g_mov.s);
    float t_us = g_mov.mm_por_upaso * 1000000.0f / v;
    const float techo = (float)(PIO_SUELO_US + PIO_RETARDO_EXTRA_MAX);
    if (t_us > techo) t_us = techo;
    const uint32_t ti = (uint32_t)t_us;
    g_buf[g_buf_cab] = (ti > PIO_SUELO_US) ? (ti - PIO_SUELO_US) : 0u;
    g_buf_cab = sig;
    g_mov.upasos_restantes--;
  }
}

static bool mov_terminado() {
  if (!g_mov.activo) return true;
  if (g_mov.upasos_restantes > 0) return false;
  noInterrupts();
  const uint16_t cab = g_buf_cab, cola = g_buf_cola;
  const uint32_t tp = g_ultimo_push_us, ui = g_ultimo_intervalo_us;
  interrupts();
  if (cab != cola) return false;
  if (!pio_sm_is_tx_fifo_empty(PIO_INSTANCIA, PIO_SM)) return false;
  if ((uint32_t)(micros() - tp) < ui + 2u * PIO_SUELO_US) return false;   // el ultimo pulso, emitido
  g_mov.activo = false;
  return true;
}

static void mov_abortar() {
  g_mov.activo = false;
  g_mov.upasos_restantes = 0;
  noInterrupts(); g_buf_cab = g_buf_cola = 0; interrupts();
  pio_sm_clear_fifos(PIO_INSTANCIA, PIO_SM);
}


// =================================================================================================
//  BLOQUE 12 — CARRO RADIAL: SORTEO DEL DESTINO Y LANZAMIENTO ENMASCARADO
// =================================================================================================
//  POR QUE ESTE EJE NO ES OPCIONAL. El arco de 300 mm de radio da ANCHURA (16,3 mm de sagita),
//  no MIGRACION: cada golpe traza el MISMO perfil lateral de dosis, asi que la misma poblacion
//  de fibras C-tactiles recibe el mismo estimulo 64 veces seguidas y se habitua. Solo un
//  desplazamiento lateral REAL entre golpes deshabitua.
//
//  Y por que traslada la bisagra entera en vez de deslizar la botavara: porque asi la bisagra
//  y el lastre de laton viajan JUNTOS, y la fuerza de contacto queda EXACTAMENTE invariante.

// Elige el destino del carro. Reglas, en orden de dureza:
//   1. (dura, de la spec) el nuevo R difiere >= 6 mm de CADA UNO de los dos anteriores.
//   2. (dura, de la spec) el salto tampoco baja de 6 mm respecto al actual.
//   3. (acotada por el tiempo real del 28BYJ-48) el salto no pasa de 12 mm.
//   4. entre los candidatos validos, gana el mas cercano al paseo OU.
static float carro_sortear_destino() {
  const float actual = g_radio_offset_mm;
  const float guia   = ou_siguiente(g_ou_radio);       // el paseo OU avanza UNA vez por hueco
  float mejor = actual; float mejor_score = 1e9f; bool hay = false;
  for (int signo = -1; signo <= 1; signo += 2) {
    for (float d = CARRO_SALTO_MIN_MM; d <= CARRO_SALTO_MAX_MM + 0.01f; d += 0.5f) {
      const float cand = actual + signo * d;
      if (cand < OU_RADIO_MIN_MM || cand > OU_RADIO_MAX_MM) continue;
      if (fabsf(cand - g_radio_hist1_mm) < CARRO_SEPARACION_MIN_MM) continue;
      if (fabsf(cand - g_radio_hist2_mm) < CARRO_SEPARACION_MIN_MM) continue;
      const float score = fabsf(cand - guia);
      if (score < mejor_score) { mejor_score = score; mejor = cand; hay = true; }
    }
  }
  return hay ? mejor : actual;    // sin candidato valido: mejor no moverse que romper la regla
}

// Lanza el movimiento. Se llama cuando el golpe en curso lleva CARRO_ARRANQUE_FRACCION de su
// contacto, para que el RASGUEO DE LAS CERDAS SOBRE LA PIEL ENMASCARE el unico evento
// impulsivo de toda la maquina. El movimiento puede continuar durante el hueco, donde la
// brocha esta 11,8 mm en el aire y lo unico en juego es el ruido, no el tacto.
static void carro_lanzar(float destino_mm) {
  const int32_t obj = (int32_t)lroundf(destino_mm * CARRO_UPASOS_POR_MM);
  noInterrupts();
  g_carro_obj_upasos = obj;
  g_carro_div = 0;
  g_carro_activo = true;
  interrupts();
  g_radio_hist2_mm = g_radio_hist1_mm;
  g_radio_hist1_mm = g_radio_offset_mm;
  g_radio_offset_mm = destino_mm;      // R del PROXIMO golpe = 300 + destino
}

static bool carro_ocupado() { bool a; noInterrupts(); a = g_carro_activo; interrupts(); return a; }

static void carro_ir_al_centro() {
  carro_lanzar(0.0f);
}


// =================================================================================================
//  BLOQUE 13 — SERVICIO PERIODICO
// =================================================================================================
//  TODO bucle de espera de este firmware llama a esta funcion. Si alguna vez escribes un
//  while() que no la llame, has creado el fallo exacto que el latido esta ahi para cubrir.

static uint32_t g_t_temp_ms = 0, g_t_rail_ms = 0;

static void servicio_periodico() {
  // 1. TESTIGO DE VIDA. Es lo que mantiene el latido, y por tanto VMOT, y por tanto el motor.
  g_bucle_vivo_ms = millis();
  // 2. WATCHDOG hardware del RP2040 (2 s). Cubre el caso de que hasta la ISR este muerta.
  rp2040.wdt_reset();
  // 3. Productor de pasos.
  mov_alimentar();
  // 4. Indicador.
  led_por_estado();
  // 5. PWM lento de los calefactores.
  calef_pwm_lento();

  const uint32_t ahora = millis();

  // 6. Cadena de seguridad, a 20 Hz. VMOT muerto con VBUS vivo = seta pulsada o latch disparado.
  if ((uint32_t)(ahora - g_t_rail_ms) >= RAIL_PERIODO_MUESTREO_MS) {
    g_t_rail_ms = ahora;
    if (g_estado == EST_RUNNING || g_estado == EST_PREWARM || g_estado == EST_RETREAT) {
      if (!rail_motor_vivo()) { if (g_rail_muertas < 255) g_rail_muertas++; } else g_rail_muertas = 0;
      if (!vbus_ok())         { if (g_vbus_malas   < 255) g_vbus_malas++;   } else g_vbus_malas = 0;
    }
  }

  // 7. Termica, a 2 Hz. Un NTC del que no te fias no calienta nada.
  if ((uint32_t)(ahora - g_t_temp_ms) >= CALEF_PERIODO_MS) {
    const uint32_t dt = ahora - g_t_temp_ms;
    g_t_temp_ms = ahora;
    const bool ok_f = ntc_leer(ADC_NTC_FER, &g_temp_ferula_c, g_temp_ferula_c, dt, &g_fallos_ntc_fer);
    const bool ok_t = ntc_leer(ADC_NTC_CUP, &g_temp_taza_c,   g_temp_taza_c,   dt, &g_fallos_ntc_taza);
    if (!ok_f) { calefactores_fuera(); g_fallo = FALLO_NTC_FERULA; }
    if (!ok_t) { calefactores_fuera(); g_fallo = FALLO_NTC_TAZA;   }
    if (g_temp_ferula_c > TEMP_LIMITE_FIRMWARE_C || g_temp_taza_c > TEMP_LIMITE_FIRMWARE_C) {
      calefactores_fuera(); g_fallo = FALLO_SOBRETEMPERATURA;
    }
    if (g_calefactores_on) {
      g_duty_ferula = calef_regular(g_temp_ferula_c, TEMP_OBJETIVO_FERULA_C,
                                    &g_integral_ferula, g_calef_ferula_permitido);
      g_duty_taza   = calef_regular(g_temp_taza_c,   TEMP_OBJETIVO_TAZA_C,
                                    &g_integral_taza,   true);
    }
  }
}

// Consulta si algo de la cadena de seguridad ha saltado. Devuelve el codigo, o FALLO_NINGUNO.
static CodigoFallo comprobar_seguridad() {
  if (g_rail_muertas >= RAIL_MUERTO_LECTURAS_SEGUIDAS)      return FALLO_RAIL_MUERTO;
  if (g_vbus_malas   >= VBUS_LECTURAS_MALAS_SEGUIDAS)       return FALLO_BROWNOUT;
  if (g_fallo == FALLO_NTC_FERULA || g_fallo == FALLO_NTC_TAZA ||
      g_fallo == FALLO_SOBRETEMPERATURA)                    return g_fallo;
  return FALLO_NINGUNO;
}


// =================================================================================================
//  BLOQUE 14 — MOVIMIENTOS BLOQUEANTES CON SERVICIO (homing, visitas, retirada)
// =================================================================================================

enum ResMov : uint8_t { MOV_OK = 0, MOV_SWITCH, MOV_TIMEOUT };

static ResMov mover_bloqueante(int8_t dir, float dist_mm, float v_mms, bool parar_en_switch) {
  if (dist_mm < 0.1f) return MOV_OK;
  construir_simple(dist_mm, v_mms);
  noInterrupts(); g_sw_capturado = false; interrupts();
  mov_arrancar(dir, dist_mm);
  const uint32_t t0 = millis();
  // Techo de tiempo generoso: 3x el teorico + 4 s. Aritmetica sin signo en la resta,
  // asi que el desbordamiento de millis() (cada 49,7 dias) no lo rompe.
  const uint32_t limite_ms = (uint32_t)(dist_mm / fmaxf(v_mms, 1.0f) * 3000.0f) + 4000UL;
  while (!mov_terminado()) {
    servicio_periodico();
    if (parar_en_switch) { bool c; noInterrupts(); c = g_sw_capturado; interrupts();
                           if (c) { mov_abortar(); return MOV_SWITCH; } }
    if ((uint32_t)(millis() - t0) > limite_ms) { mov_abortar(); return MOV_TIMEOUT; }
  }
  bool c; noInterrupts(); c = g_sw_capturado; interrupts();
  return (parar_en_switch && c) ? MOV_SWITCH : MOV_OK;
}

static bool switch_en_reposo() { return digitalRead(PIN_SW_PARK) == SW_NIVEL_EN_REPOSO; }

// Deja la maquina apoyada en el tope mecanico M4 SIN gastar corriente: se desenergiza y el
// contrapeso hace el ultimo grado. Es el mismo camino que usa el fallo seguro, asi que se
// ejercita CINCO VECES POR SESION en vez de solo el dia que algo va mal.
static void asentar_en_el_tope() {
  fijar_ihold_por_posicion(true);        // IHOLD = 0 + freewheel = 01
  driver_desenergizar();
  const uint32_t t0 = millis();
  while ((uint32_t)(millis() - t0) < 2500UL) servicio_periodico();
  noInterrupts(); g_pos_upasos = ang_a_upasos(ANG_REPOSO_DEG); interrupts();
}


// =================================================================================================
//  BLOQUE 15 — HOMING
// =================================================================================================
//  El microrruptor es contacto NA a GND con pull-up. BAJO = EN REPOSO.
//  Cable roto -> pull-up -> ALTO -> "no estoy en reposo" -> el homing no encuentra el tope en
//  95 grados -> LA MAQUINA SE NIEGA A ARRANCAR. Eso es fallo SEGURO, y es la razon de elegir
//  NA y no NC: con NC, un cable roto se lee igual que "estoy en reposo", el homing termina de
//  inmediato en un punto falso, toda la geometria queda desplazada y la brocha aterriza donde
//  no debe.

static bool homing() {
  g_drv.irun(TMC_IRUN_CS_HOMING);        // 0,153 A: un homing no tiene por que empujar fuerte
  g_drv.ihold(TMC_IHOLD_CS_FUERA);
  g_drv.freewheel(0);
  driver_energizar();
  delay(20);

  const float k = mm_por_grado(radio_actual());

  for (uint8_t intento = 0; intento <= HOMING_REINTENTOS; intento++) {
    // 1. Si ya estamos en reposo, alejarse primero, para que el barrido de homing empiece
    //    SIEMPRE con el contacto abierto. Este tramo va cuesta arriba contra el contrapeso.
    if (switch_en_reposo()) {
      mover_bloqueante(-1, HOMING_SEPARACION_DEG * k, HOMING_VEL_GRUESA_MMS, false);
      if (switch_en_reposo()) { g_fallo = FALLO_HOMING; return false; }   // pegado: leva o cable
    }
    // 2. Pasada gruesa hacia el reposo, contando pasos.
    const ResMov r1 = mover_bloqueante(+1, HOMING_BARRIDO_MAX_DEG * k, HOMING_VEL_GRUESA_MMS, true);
    if (r1 != MOV_SWITCH) { if (intento == HOMING_REINTENTOS) { g_fallo = FALLO_HOMING; return false; }
                            continue; }
    // 3. Retroceder 3 grados y volver a acercarse despacio. La SEGUNDA pasada es la que da la
    //    repetibilidad: un microrruptor de palanca repite +/-0,05 mm en el actuador, que sobre
    //    un brazo de 60 mm son +/-0,05 grados = +/-0,26 mm en la punta a R=300. De sobra.
    mover_bloqueante(-1, HOMING_RETROCESO_DEG * k, HOMING_VEL_GRUESA_MMS, false);
    const ResMov r2 = mover_bloqueante(+1, (HOMING_RETROCESO_DEG + 2.0f) * k,
                                       HOMING_VEL_FINA_MMS, true);
    if (r2 != MOV_SWITCH) { if (intento == HOMING_REINTENTOS) { g_fallo = FALLO_HOMING; return false; }
                            continue; }
    // 4. ESE es el cero absoluto.
    noInterrupts(); g_pos_upasos = ang_a_upasos(ANG_SW_CIERRA_DEG); interrupts();
    g_drv.irun(TMC_IRUN_CS);
    asentar_en_el_tope();
    return true;
  }
  g_fallo = FALLO_HOMING;
  return false;
}


// =================================================================================================
//  BLOQUE 16 — VISITA A LA TAZA: INTEGRIDAD POR CICLO Y CORRECCION DE PASOS PERDIDOS
// =================================================================================================
//  PRECISION NECESARIA SOBRE LA ESPECIFICACION. "El switch debe cerrar una vez por ciclo" es
//  ambiguo: hay 52-65 golpes por sesion, pero el reposo esta a +43 grados y los golpes solo
//  llegan a +/-41 (ventana de inversion 35-41). LOS GOLPES NORMALES NO PASAN POR EL MICRORRUPTOR, asi que no puede haber
//  verificacion por golpe. La definicion operativa son CINCO VISITAS PROGRAMADAS por sesion:
//  t = 0 (pre-warm), 225 s, 450 s, 675 s y 900 s (fin).
//
//  Se ordena un numero N de micropasos hasta el reposo. El switch DEBE cerrar antes de N*1,5.
//  Si no cierra: parar, desenergizar (el contrapeso retira la brocha), esperar 5 s, UN
//  reintento con amplitud reducida, y si vuelve a fallar, fin de ciclo y 4 parpadeos.

static bool visita_taza(float amplitud) {
  const float k = mm_por_grado(radio_actual());
  const float ang = ang_actual_deg();
  const float recorrido_deg = (ANG_REPOSO_DEG - ang) * amplitud;

  //  #### CORRECCION DE VERIFICACION: LA PRIMERA VISITA NO VERIFICABA NADA ####
  //  Antes, si el contador decia que ya estabamos en el reposo, esto era
  //      if (recorrido_deg <= 0.2f) { asentar_en_el_tope(); return true; }
  //  es decir: devolvia EXITO sin mirar el microrruptor. Y la visita numero 0, la del
  //  PREWARM, cae SIEMPRE en ese caso, porque homing() deja g_pos_upasos justo en
  //  ANG_REPOSO_DEG. O sea: de las "cinco verificaciones de integridad por sesion" que
  //  promete la especificacion, la primera era literalmente un return true.
  //
  //  Ademas hay una razon de la ISR para tratar este caso aparte: el antirrebote captura
  //  en el FLANCO de cierre confirmado, asi que si el switch YA esta cerrado al empezar el
  //  movimiento no puede volver a capturar sin abrirse antes, y mover_bloqueante(...,true)
  //  devolveria MOV_TIMEOUT en vez de MOV_SWITCH. Aqui se resuelve leyendolo directamente.
  if (switch_en_reposo()) {
    int32_t pos; noInterrupts(); pos = g_pos_upasos; interrupts();
    const int32_t error0 = pos - ang_a_upasos(ANG_SW_CIERRA_DEG);
    if (g_visitas_hechas < 5) g_err_homing[g_visitas_hechas] = (int16_t)(error0 / (int32_t)MICROSTEPPING);
    if ((uint32_t)labs(error0) > DERIVA_TOLERADA_UPASOS) { g_fallo = FALLO_DERIVA; return false; }
    asentar_en_el_tope();
    return true;
  }
  // El contador dice "estoy en el reposo" pero el microrruptor dice que NO. O la botavara
  // esta atascada fuera del tope, o la leva/el cable del switch han fallado. Integridad KO.
  if (recorrido_deg <= 0.2f) return false;

  const float dist_ordenada = recorrido_deg * k;
  const float dist_permitida = dist_ordenada * INTEGRIDAD_MARGEN;     // "tiempo comandado + 50 %"

  g_drv.ihold(TMC_IHOLD_CS_FUERA);
  g_drv.freewheel(0);
  driver_energizar();

  const ResMov r = mover_bloqueante(+1, dist_permitida, OU_VEL_MEDIA_BLOQUE_2, true);
  if (r != MOV_SWITCH) return false;                                   // NO cerro. Integridad KO.

  // ---- Correccion automatica de pasos perdidos ------------------------------------------------
  //  error = posicion contada al cerrar  -  posicion teorica del cierre (ANG_SW_CIERRA_DEG)
  int32_t capturada; noInterrupts(); capturada = g_sw_pos_capturada; interrupts();
  const int32_t esperada = ang_a_upasos(ANG_SW_CIERRA_DEG);
  const int32_t error = capturada - esperada;
  const int16_t error_pasos = (int16_t)(error / (int32_t)MICROSTEPPING);
  if (g_visitas_hechas < 5) g_err_homing[g_visitas_hechas] = error_pasos;

  if ((uint32_t)labs(error) > DERIVA_TOLERADA_UPASOS) {
    // 30 pasos completos = 960 micropasos = 3,78 grados de sector = 19,8 mm de arco de punta.
    // Por debajo de eso la deriva SIGUE cayendo dentro de los 36,7 mm de meseta plana: la
    // brocha sigue en el aire y no roza. Por encima, algo va mal de verdad.
    g_fallo = FALLO_DERIVA;
    return false;
  }
  noInterrupts(); g_pos_upasos -= error; interrupts();                 // correccion SILENCIOSA
  asentar_en_el_tope();
  return true;
}

// Protocolo de fallo de integridad, literal segun la especificacion:
// parar -> desenergizar -> esperar 5 s -> UN reintento con amplitud reducida -> si falla, fin.
static bool integridad_con_reintento() {
  if (visita_taza(1.0f)) { g_reintentos_integridad = 0; return true; }
  mov_abortar();
  driver_desenergizar();                    // el contrapeso retira la brocha de la piel AHORA
  fijar_ihold_por_posicion(true);
  const uint32_t t0 = millis();
  while ((uint32_t)(millis() - t0) < INTEGRIDAD_ESPERA_MS) servicio_periodico();
  if (g_reintentos_integridad >= HOMING_REINTENTOS) { g_fallo = FALLO_INTEGRIDAD; return false; }
  g_reintentos_integridad++;
  if (visita_taza(INTEGRIDAD_AMPLITUD_REINTENTO)) {
    // CORRECCION DE VERIFICACION: si el primer intento fallo por deriva y el reintento sale
    // bien, hay que BORRAR el codigo de fallo. Antes se quedaba pegado en g_fallo, y como
    // estado_retreat() solo espera a los 900 s exactos cuando g_fallo == FALLO_NINGUNO, un
    // reintento con exito truncaba el ciclo en silencio: la sesion se acababa antes de
    // tiempo sin que nada lo dijera. Ademas enmascaraba el motivo real de un FAULT posterior,
    // porque entrar_en_fault() respeta el g_fallo que ya hubiera.
    if (g_fallo == FALLO_DERIVA) g_fallo = FALLO_NINGUNO;
    return true;
  }
  g_fallo = FALLO_INTEGRIDAD;
  return false;
}


// =================================================================================================
//  BLOQUE 17 — LA MAQUINA DE ESTADOS
// =================================================================================================

static uint32_t g_hueco_ms = 0, g_t_hueco_ms = 0;
static uint32_t g_t_golpe_ms = 0, g_golpe_techo_ms = 0;
static float    g_carro_destino_pendiente = 0.0f;
static bool     g_carro_hay_pendiente = false;
static bool     g_rozada_de_este_golpe = false;

static void cambiar_estado(Estado nuevo) {
  g_estado = nuevo;
  g_t_estado_ini_ms = millis();
  if (Serial) { Serial.print(F("[estado] -> ")); Serial.println(NOMBRE_ESTADO[nuevo]); }
}

static void pulso_motor_kill() {
  digitalWrite(PIN_MOTOR_KILL, HIGH);
  delay(MOTOR_KILL_PULSO_MS);
  digitalWrite(PIN_MOTOR_KILL, LOW);
}

// Tiempo estimado del golpe planificado, sumando tramo a tramo. Se usa para no empezar nunca
// un golpe que no quepa dentro de los 900 s. Es como se consigue que el ciclo sea EXACTO en
// vez de "900 s mas lo que dure el ultimo golpe".
static float mov_tiempo_estimado_s() {
  float t = 0.0f;
  for (uint8_t i = 0; i < g_mov.n; i++) {
    const Tramo& T = g_mov.tramos[i];
    const float L = T.s1 - T.s0;
    t += (T.forma == FORMA_CONST) ? (L / fmaxf(T.v0, V_MINIMA_ABSOLUTA_MMS))
                                  : tiempo_quintica(L, T.v0, T.v1);
  }
  return t;
}

// Intencion deliberada: 300 ms sostenidos + 500 ms de soltado. Que te des la vuelta y
// aplastes el boton con el codo no puede reiniciar un ciclo.
//
//  #### CORRECCION DE VERIFICACION: EL ANTIRREBOTE NO EXISTIA ####
//  La version anterior leia el pin crudo y BOTON_ANTIRREBOTE_MS estaba definido en config.h
//  pero no se usaba en ninguna parte. El fallo concreto: un solo rebote AL SOLTAR
//  (LOW -> HIGH -> LOW -> HIGH, tipico de un pulsador de silicona, 1-10 ms) hacia esto:
//     1er flanco de subida -> estaba=false, pendiente = (mantenido >= 300 ms) = true
//     rebote a LOW         -> estaba=true, t_bajo = AHORA   (se pierde el tiempo mantenido)
//     2o flanco de subida  -> pendiente = (ahora - t_bajo >= 300) = FALSE
//  y la pulsacion se perdia entera. El usuario apretaba, no pasaba nada, y volvia a apretar.
//  Ahora el nivel se filtra: solo se acepta un cambio de nivel que se haya mantenido
//  BOTON_ANTIRREBOTE_MS. Los rebotes de menos de 20 ms son invisibles para la maquina.
static bool boton_armado() {
  static bool nivel_estable = true;          // true = suelto (pull-up)
  static bool nivel_crudo   = true;
  static uint32_t t_cambio = 0;
  static bool pendiente = false;
  static uint32_t t_bajo = 0, t_alto = 0;

  const uint32_t ahora = millis();
  const bool suelto_ahora = (digitalRead(PIN_BTN_START) != LOW);

  if (suelto_ahora != nivel_crudo) { nivel_crudo = suelto_ahora; t_cambio = ahora; }

  if (nivel_crudo != nivel_estable && (uint32_t)(ahora - t_cambio) >= BOTON_ANTIRREBOTE_MS) {
    nivel_estable = nivel_crudo;
    if (!nivel_estable) {                    // flanco de bajada CONFIRMADO: se acaba de pulsar
      t_bajo = t_cambio;
    } else {                                 // flanco de subida CONFIRMADO: se acaba de soltar
      t_alto = t_cambio;
      pendiente = ((uint32_t)(t_alto - t_bajo) >= BOTON_MANTENER_MS);
    }
  }

  if (nivel_estable && pendiente && (uint32_t)(ahora - t_alto) >= BOTON_SOLTAR_MS) {
    pendiente = false;
    return true;
  }
  return false;
}

static bool decidir_rozada(float ang_ini) {
  if (OU_ROZADA_PROB <= 0.0f)                        return false;   // desactivadas por config
  if (g_ultimo_golpe_rozada)                         return false;   // nunca dos seguidas
  if (ROZADA_PROHIBIDA_BLOQUE_1 && g_bloque == 0)    return false;   // no en el bloque de entrada
  if (ROZADA_SOLO_LADO_LEJANO && ang_ini < 0.0f)     return false;   // el destino seria el reposo
  return (uniforme() < OU_ROZADA_PROB);
}

// -------------------------------------------------------------------------------------------------
//  ENTRADA A FAULT. Es un camino de una sola direccion.
//  Lo primero que hace es lo unico que importa: dejar de sujetar la brocha contra la piel.
// -------------------------------------------------------------------------------------------------
static void entrar_en_fault(CodigoFallo motivo) {
  if (g_fallo == FALLO_NINGUNO) g_fallo = motivo;
  mov_abortar();
  driver_desenergizar();               // nEN alto: puentes en alta impedancia
  fijar_ihold_por_posicion(true);      // IHOLD 0 + freewheel 01
  calefactores_fuera();
  carro_desenergizar();
  nvm_guardar();
  if (Serial) { Serial.print(F("[FALLO] codigo ")); Serial.println((int)g_fallo); }
  // Y AHORA SE CORTA EL LATIDO. El charge pump se descarga, Q2 corta, Q1 corta, VMOT muere
  // en menos de 300 ms, y el contrapeso de 360 g se lleva la brocha lejos de la piel en 2-3 s
  // frenado por el amortiguador neumatico. El firmware no "retira" nada: deja de estorbar.
  g_latido_permitido = false;
  pulso_motor_kill();                  // y por si el charge pump fallara, el latch tambien
  cambiar_estado(EST_FAULT);
}

// -------------------------------------------------------------------------------------------------
//  BOOT
// -------------------------------------------------------------------------------------------------
static void estado_boot() {
  // config.h dice que el reloj de sistema "se comprueba en el arranque y se avisa por USB".
  // No se comprobaba en ninguna parte. Se comprueba aqui. No es un FAULT: el divisor del PIO
  // se calcula en tiempo de ejecucion con clock_get_hz(), asi que el tick de 1 us (y con el
  // el suelo de 240 us y el tope de 10 cm/s) se mantiene sea cual sea el reloj. Es un aviso.
  if (clock_get_hz(clk_sys) != PLUMA_RELOJ_ESPERADO_HZ && Serial) {
    Serial.print(F("[aviso] reloj de sistema ")); Serial.print(clock_get_hz(clk_sys));
    Serial.print(F(" Hz, se esperaba ")); Serial.println(PLUMA_RELOJ_ESPERADO_HZ);
  }

  // El ambiente se estima con el NTC de la taza ANTES de encender nada. Ver correccion C-7:
  // el "techo hardware de 38 C" en realidad es T_ambiente + 17,7 K, asi que a 26 C de
  // ambiente el calefactor de ferula podria llegar a 43,7 C, por encima del umbral de
  // quemadura por contacto prolongado de la ISO 13732-1 (43 C).
  g_temp_ambiente_c = ntc_cuenta_a_celsius(adc_leer_promedio(ADC_NTC_CUP));
  g_temp_taza_c = g_temp_ferula_c = g_temp_ambiente_c;
  g_calef_ferula_permitido = (g_temp_ambiente_c <= TEMP_AMBIENTE_MAX_CALEF_C);

  if (!tmc_configurar()) { entrar_en_fault(g_fallo); return; }
  cambiar_estado(EST_AUTOTUNE);
}

// -------------------------------------------------------------------------------------------------
//  AUTOTUNE  —  SOLO AT#1, Y ES A PROPOSITO
// -------------------------------------------------------------------------------------------------
//  El datasheet del TMC2209 distingue dos etapas de calibracion de StealthChop2:
//     AT#1 mide la RESISTENCIA de bobina -> PWM_OFS.  Se hace EN PARADA, con corriente
//          aplicada, esperando >= 130 ms. NO NECESITA MOVIMIENTO. Se rehace en cada arranque.
//     AT#2 mide la constante de fuerza contraelectromotriz -> PWM_GRAD. Necesita movimiento
//          continuo a velocidad media (60-300 rpm) durante al menos 400 pasos completos.
//
//  400 pasos completos/s en esta maquina son 26,4 cm/s de punta: 2,6 veces el clamp absoluto
//  de 10 cm/s, y el suelo del PIO lo PROHIBE FISICAMENTE. La especificacion pide a la vez el
//  clamp y un movimiento que el clamp no permite. No se puede tener las dos cosas.
//
//  Asi que el AT#2 se hace UNA SOLA VEZ EN EL BANCO, con el motor desacoplado y un binario de
//  calibracion aparte (Procedimiento A de docs/04-electronica.md 6.5), y aqui se REAPLICAN
//  PWM_OFS/PWM_GRAD desde flash con pwm_autograd = 0 (congelado), para que el driver no
//  intente re-medir el gradiente a velocidad de reptil y lo estropee.
//
//  BENEFICIO COLATERAL, Y NO ES MENOR: se elimina un latigazo de 26 cm/s del arranque de cada
//  noche. Un brazo de 300 mm cruzando 60 grados a 26 cm/s a las 23:30, justo antes de que te
//  tumbes al lado, es la cosa mas violenta que haria la maquina. Quitarla es una mejora de
//  seguridad, no solo de coherencia.
static void estado_autotune() {
  g_drv.pwm_ofs(g_pwm_ofs);
  g_drv.pwm_grad(g_pwm_grad);
  g_drv.pwm_autoscale(true);
  g_drv.pwm_autograd(false);
  g_drv.ihold(TMC_IHOLD_CS_FUERA);      // hace falta corriente para que el AT#1 mida algo
  g_drv.freewheel(0);
  driver_energizar();

  const uint32_t t0 = millis();
  while ((uint32_t)(millis() - t0) < AT1_ESPERA_MS) servicio_periodico();   // AT#1: quieto

  const uint8_t escala = g_drv.pwm_scale_sum();
  if (Serial) { Serial.print(F("[autotune] PWM_SCALE_SUM = ")); Serial.print(escala);
                Serial.print(F("  OFS=")); Serial.print(g_pwm_ofs);
                Serial.print(F("  GRAD=")); Serial.print(g_pwm_grad);
                Serial.println(g_calibracion_valida ? F("  (desde flash)") : F("  (SIN CALIBRAR)")); }
  if (escala < PWM_SCALE_SUM_MIN || escala > PWM_SCALE_SUM_MAX) {
    entrar_en_fault(FALLO_TMC_CONVERGENCIA); return;    // la regulacion no converge
  }
  cambiar_estado(EST_HOMING);
}

// -------------------------------------------------------------------------------------------------
//  HOMING
// -------------------------------------------------------------------------------------------------
static void estado_homing() {
  if (!homing()) { entrar_en_fault(FALLO_HOMING); return; }
  carro_desenergizar();
  g_carro_pos_upasos = 0;      // se ASUME centrado. El carro no tiene final de carrera.
  g_radio_offset_mm = 0.0f;
  g_radio_hist1_mm = g_radio_hist2_mm = 999.0f;
  cambiar_estado(EST_IDLE);
}

// -------------------------------------------------------------------------------------------------
//  IDLE  —  corriente cero de verdad, esperando el boton
// -------------------------------------------------------------------------------------------------
static void estado_idle() {
  driver_desenergizar();
  fijar_ihold_por_posicion(true);
  calefactores_fuera();
  if (boton_armado()) {
    // Un parpadeo largo de 1 s: "armado, empieza el pre-warm".
    led_nivel(LED_BRILLO_NORMAL);
    const uint32_t t0 = millis();
    while ((uint32_t)(millis() - t0) < LED_ARMADO_ON_MS) { g_bucle_vivo_ms = millis(); rp2040.wdt_reset(); }
    g_golpes_dados = 0; g_visitas_hechas = 0; g_bloque = 0; g_recortes_rampa = 0;
    g_reintentos_integridad = 0; g_ultimo_golpe_rozada = false; g_huecos_sin_dwell = 0;
    g_fallo = FALLO_NINGUNO;
    g_rail_muertas = g_vbus_malas = 0;
    ou_fijar_media_de_bloque(0);
    cambiar_estado(EST_PREWARM);
  }
}

// -------------------------------------------------------------------------------------------------
//  PREWARM  —  60 s en la taza caliente
// -------------------------------------------------------------------------------------------------
//  ACLARACION DE UNA CONTRADICCION DE LA ESPECIFICACION: dice a la vez "60 s de pre-warm con
//  la brocha YA APOYADA SOBRE LA PIEL" y "la taza calefactada va exactamente en el tope
//  exterior, donde el contrapeso ya aparca la botavara". La brocha no puede estar en los dos
//  sitios. Se implementa EN LA TAZA, siguiendo docs/04-electronica.md 8.4 ("t = 0 s antes de
//  empezar, pre-warm de 60 s en la taza"), porque ademas es lo unico compatible con el fallo
//  seguro: durante el pre-warm el motor esta DESENERGIZADO y no hay nada que sujete la brocha
//  sobre nadie. El primer contacto de la noche llega igual de caliente.
static void estado_prewarm() {
  if (g_visitas_hechas == 0) {
    if (!integridad_con_reintento()) { entrar_en_fault(FALLO_INTEGRIDAD); return; }
    g_visitas_hechas = 1;                       // esta es la visita numero 0 de las cinco
    g_t_estado_ini_ms = millis();
    g_calefactores_on = true;
  }
  const CodigoFallo f = comprobar_seguridad();
  if (f != FALLO_NINGUNO) { entrar_en_fault(f); return; }
  if ((uint32_t)(millis() - g_t_estado_ini_ms) >= PREWARM_DURACION_MS) {
    g_t_ciclo_ini_ms = millis();                // <<< AQUI empiezan los 900 s exactos
    g_subrun = SR_PLANIFICAR;
    cambiar_estado(EST_RUNNING);
  }
}

// -------------------------------------------------------------------------------------------------
//  RUNNING
// -------------------------------------------------------------------------------------------------
static void running_planificar(uint32_t t_ciclo) {
  // ¿toca visita programada a la taza? (fin de bloque 1, 2 y 3)
  if (g_visitas_hechas < CICLO_BLOQUES &&
      t_ciclo >= (uint32_t)g_visitas_hechas * BLOQUE_DURACION_MS) {
    g_subrun = SR_VISITA_TAZA; return;
  }

  // El clamp de velocidad solo significa algo si los milimetros por pulso son los que creemos.
  if (!verificar_microstepping()) { entrar_en_fault(FALLO_TMC_MRES); return; }

  // El carro es retro-conducible: la verdad esta en su contador, no en lo que ordenamos.
  noInterrupts(); const int32_t cp = g_carro_pos_upasos; interrupts();
  g_radio_offset_mm = (float)cp / CARRO_UPASOS_POR_MM;

  // --- Los seis ejes de variacion se sortean AQUI, una vez por golpe ---
  const float v_cru   = ou_siguiente(g_ou_vel);        // eje 1: velocidad
  const float t_rampa = ou_siguiente(g_ou_rampa);      // eje 3: rampa de aterrizaje
  const float ang_i   = ang_actual_deg();
  const bool  roz_i   = (fabsf(ang_i) < ANG_TAPER_DEG);
  const bool  roz_f   = decidir_rozada(ang_i);         // eje 5: pasadas rozadas
  const float mag     = roz_f ? ou_siguiente(g_ou_rozada)     // profundidad de la rozada
                              : ou_siguiente(g_ou_inver);     // eje 4: punto de inversion
  const float ang_f   = ((ang_i >= 0.0f) ? -1.0f : +1.0f) * mag;

  construir_golpe(ang_i, ang_f, v_cru, t_rampa, roz_i, roz_f);
  const float dist = fabsf(ang_f - ang_i) * mm_por_grado(radio_actual());
  const float t_est_s = mov_tiempo_estimado_s();

  // Si el golpe no cabe entero dentro de los 900 s menos la reserva de retirada, NO se
  // empieza. Asi el ciclo termina EXACTAMENTE a los 900 s y no "a los 900 s mas lo que dure
  // el ultimo golpe".
  if (t_ciclo + (uint32_t)(t_est_s * 1000.0f) + RESERVA_RETIRADA_MS >= CICLO_DURACION_MS) {
    cambiar_estado(EST_RETREAT); return;
  }

  g_drv.irun(TMC_IRUN_CS);
  g_drv.ihold(TMC_IHOLD_CS_FUERA);       // fuera del reposo hay que sujetar el contrapeso
  g_drv.freewheel(0);
  driver_energizar();
  mov_arrancar((ang_f > ang_i) ? +1 : -1, dist);

  // eje 6: radio. Se sortea el destino ahora y se LANZA mas tarde, dentro del golpe.
  //
  //  #### CORRECCION DE VERIFICACION: NUNCA EN UN GOLPE QUE TERMINA ROZANDO ####
  //  Un golpe que acaba en inversion rozada deja la brocha TOCANDO la piel a 150-300 mN.
  //  Detras de el, running_hueco() esperaba a que el carro terminase (hasta
  //  GAP_MAX_ABSOLUTO_S = 10 s), y un salto de 12 mm tarda 6,15 s de los que solo ~1,8 s
  //  caben en la cola del golpe. Resultado real: la brocha QUIETA SOBRE LA PIEL, con el
  //  motor sujetando a IHOLD = 7, durante varios segundos. Eso es exactamente el "dead
  //  turnaround dwell" que la especificacion prohibe, y encima con el motor energizado.
  //  Solucion: en un golpe con rozada no se programa movimiento de carro. Se pierde como
  //  mucho un movimiento de los 16 de la sesion.
  g_carro_hay_pendiente = false;
  if (CARRO_MOVER_CADA_N_GOLPES > 0 && !roz_f &&
      (g_golpes_dados % CARRO_MOVER_CADA_N_GOLPES) == 0) {
    const float destino = carro_sortear_destino();
    if (fabsf(destino - g_radio_offset_mm) >= CARRO_SALTO_MIN_MM) {
      g_carro_destino_pendiente = destino; g_carro_hay_pendiente = true;
    }
  }
  g_rozada_de_este_golpe = roz_f;
  // Techo de tiempo del golpe. Si el golpe no termina en 3x lo estimado + 5 s, algo tiene
  // agarrada la botavara: se termina la noche por el camino ordenado en vez de quedarse en
  // SR_GOLPE para siempre con el motor energizado y la brocha en la piel. (El latido y el
  // contrapeso cubren el caso duro, pero un bucle sin techo no se deja escrito.)
  g_t_golpe_ms      = millis();
  g_golpe_techo_ms  = (uint32_t)(t_est_s * 3000.0f) + 5000UL;
  g_subrun = SR_GOLPE;
}

static void running_golpe() {
  // Lanzamiento ENMASCARADO del carro: al 80 % del contacto, para que el rasgueo de las
  // cerdas tape el unico evento impulsivo de la maquina.
  if (g_carro_hay_pendiente && g_mov.s >= CARRO_ARRANQUE_FRACCION * g_mov.s_contacto_fin) {
    carro_lanzar(g_carro_destino_pendiente);
    g_carro_hay_pendiente = false;
  }
  // StallGuard4: SOLO en los tramos rapidos y fuera de la piel. Ver vigilar_stallguard().
  if (vigilar_stallguard(mov_velocidad(g_mov.s), ang_actual_deg())) {
    g_fallo = FALLO_STALLGUARD;
    cambiar_estado(EST_RETREAT);           // terminar ordenadamente, no un FAULT duro:
    return;                                // a estas velocidades el falso positivo es probable
  }
  // Techo de tiempo del golpe: ningun camino puede quedarse aqui indefinidamente.
  if ((uint32_t)(millis() - g_t_golpe_ms) > g_golpe_techo_ms) {
    mov_abortar();
    g_fallo = FALLO_STALLGUARD;            // "el golpe no avanza": misma familia que un bloqueo
    cambiar_estado(EST_RETREAT);
    return;
  }
  if (mov_terminado()) {
    g_golpes_dados++;
    g_ultimo_golpe_rozada = g_rozada_de_este_golpe;
    // eje 2: hueco. Tras una rozada NO hay hueco: la brocha sigue tocando (ver config.h).
    if (g_rozada_de_este_golpe) {
      g_hueco_ms = (uint32_t)(GAP_TRAS_ROZADA_S * 1000.0f);
    } else {
      //  #### CORRECCION DE VERIFICACION: EL HUECO SORTEADO NO ERA EL HUECO REAL ####
      //  La spec acota el TIEMPO SIN CONTACTO, y el firmware lo estaba aplicando al DWELL en
      //  la meseta, olvidando que ir del taper al punto de inversion y volver son otros
      //  1,3-1,7 s POR LADO. El hueco real era dwell + 2 x vuelo = 4,1-8,9 s en vez de
      //  1,5-5,5 s. Ahora el paseo OU sortea el hueco TOTAL y se le descuenta el vuelo.
      //  El vuelo de entrada del proximo golpe todavia no esta planificado; se estima igual
      //  al de salida, que es correcto por simetria (misma longitud, mismas velocidades,
      //  recorrido al reves) salvo por la diferencia entre los dos angulos de inversion.
      const float t_aire = mov_tiempo_aire_salida_s();
      float dwell = ou_siguiente(g_ou_hueco) - 2.0f * t_aire;
      if (dwell < 0.0f) { dwell = 0.0f; g_huecos_sin_dwell++; }
      g_hueco_ms = (uint32_t)(dwell * 1000.0f);
    }
    g_t_hueco_ms = millis();
    fijar_ihold_por_posicion(false);       // parados FUERA del reposo: hay que sujetar
    g_subrun = SR_HUECO;
  }
}

static void running_hueco() {
  //  #### CORRECCION DE VERIFICACION: EL HUECO SE COMIA LA RESERVA DE RETIRADA ####
  //  running_planificar() comprueba que el GOLPE cabe dentro de (900 s - reserva), pero el
  //  HUECO viene DESPUES del golpe y no lo comprobaba nadie. Camino real: ultimo golpe que
  //  cabe justo, + hasta 5,5 s de hueco (o hasta 10 s si el carro se retrasa), y RETREAT
  //  arrancaba con la reserva ya mordida. El banco de pruebas del host lo caza en cuanto se
  //  prueban 200 semillas. Aqui el hueco se corta en seco al llegar al limite: la brocha ya
  //  esta en el aire, asi que cortar un hueco no se nota, y la retirada conserva sus 40 s.
  if ((uint32_t)(millis() - g_t_ciclo_ini_ms) >= CICLO_DURACION_MS - RESERVA_RETIRADA_MS) {
    noInterrupts(); g_carro_obj_upasos = g_carro_pos_upasos; interrupts();
    g_subrun = SR_PLANIFICAR; return;      // planificar vera que no cabe y pasara a RETREAT
  }
  const uint32_t dt = (uint32_t)(millis() - g_t_hueco_ms);
  // Tras una inversion rozada la brocha SIGUE TOCANDO: aqui no se espera a nadie, y menos
  // al carro. Ver la correccion en running_planificar(). Doble red: aunque un carro se
  // hubiera quedado en marcha por cualquier via, el hueco de 0,25 s no se alarga.
  if (g_ultimo_golpe_rozada) {
    if (dt >= g_hueco_ms) g_subrun = SR_PLANIFICAR;
    return;
  }
  if (dt >= (uint32_t)(GAP_MAX_ABSOLUTO_S * 1000.0f)) {
    // El carro se ha retrasado demasiado. Se para donde este; el contador de posicion del
    // carro sigue siendo valido y el proximo golpe usara el R real.
    noInterrupts(); g_carro_obj_upasos = g_carro_pos_upasos; interrupts();
    g_subrun = SR_PLANIFICAR; return;
  }
  if (dt >= g_hueco_ms && !carro_ocupado()) g_subrun = SR_PLANIFICAR;
}

static void estado_running() {
  const uint32_t t_ciclo = (uint32_t)(millis() - g_t_ciclo_ini_ms);   // resta sin signo:
                                                                      // inmune al desbordamiento
  if (t_ciclo >= CICLO_TIMEOUT_DURO_MS) { g_fallo = FALLO_RELOJ; cambiar_estado(EST_RETREAT); return; }
  const CodigoFallo f = comprobar_seguridad();
  if (f != FALLO_NINGUNO) { entrar_en_fault(f); return; }

  const uint8_t bloque = (uint8_t)(t_ciclo / BLOQUE_DURACION_MS);
  if (bloque != g_bloque && bloque < CICLO_BLOQUES) { g_bloque = bloque; ou_fijar_media_de_bloque(bloque); }

  switch (g_subrun) {
    case SR_PLANIFICAR:  running_planificar(t_ciclo); break;
    case SR_GOLPE:       running_golpe();  break;
    case SR_HUECO:       running_hueco();  break;
    case SR_VISITA_TAZA:
      if (integridad_con_reintento()) { g_visitas_hechas++; g_subrun = SR_PLANIFICAR; }
      else                            { entrar_en_fault(FALLO_INTEGRIDAD); }
      break;
    default: g_subrun = SR_PLANIFICAR; break;
  }
}

// -------------------------------------------------------------------------------------------------
//  RETREAT  —  el final normal de todas las noches
// -------------------------------------------------------------------------------------------------
//  Y AQUI ESTA LA MEJOR PROPIEDAD DE TODO EL DISENO: el final normal usa EXACTAMENTE EL MISMO
//  CAMINO FISICO que el fallo seguro. No hay una "retirada de firmware" separada que solo se
//  ejercite el dia que algo va mal. El firmware da un ultimo golpe firme, vuelve a la taza,
//  DESENERGIZA, y el contrapeso de 360 g hace el resto frenado por el amortiguador neumatico.
//  Eso significa que la cadena de seguridad se prueba ~365 veces al ano.
static void estado_retreat() {
  // 1. Un ultimo golpe firme hacia el lado del reposo, si no estamos ya alli.
  const float ang_i = ang_actual_deg();
  if (ang_i < 0.0f) {
    const float ang_f = OU_INVER_MEDIA_DEG;
    construir_golpe(ang_i, ang_f, OU_VEL_MEDIA_BLOQUE_4, OU_RAMPA_MEDIA_S,
                    (fabsf(ang_i) < ANG_TAPER_DEG), false);
    const float dist = fabsf(ang_f - ang_i) * mm_por_grado(radio_actual());
    g_drv.irun(TMC_IRUN_CS); g_drv.ihold(TMC_IHOLD_CS_FUERA); g_drv.freewheel(0);
    driver_energizar();
    mov_arrancar(+1, dist);
    // Con techo de tiempo: era el UNICO while() del firmware sin salida, y encima con el
    // motor energizado. Si el golpe no termina, se aborta y se sigue con la retirada, que
    // es justo lo que hay que hacer.
    const uint32_t t_lim = (uint32_t)(dist / fmaxf(OU_VEL_MEDIA_BLOQUE_4, 1.0f) * 3000.0f) + 5000UL;
    const uint32_t t_g0 = millis();
    while (!mov_terminado()) {
      servicio_periodico();
      if ((uint32_t)(millis() - t_g0) > t_lim) { mov_abortar(); break; }
    }
    g_golpes_dados++;
  }
  // 2. Quinta y ultima visita a la taza. Si falla, ya da igual: igualmente vamos a desenergizar.
  visita_taza(1.0f);
  // 3. Calefactores fuera y carro al centro (para que la proxima noche empiece centrado).
  calefactores_fuera();
  carro_ir_al_centro();
  while (carro_ocupado()) servicio_periodico();
  carro_desenergizar();
  // 4. DESENERGIZAR. El contrapeso asienta la botavara en el tope M4. Esto ya lo hizo
  //    asentar_en_el_tope() dentro de visita_taza(), pero se insiste por si acaso.
  driver_desenergizar();
  fijar_ihold_por_posicion(true);
  // 5. Esperar hasta que se cumplan los 900 s EXACTOS desde el inicio del ciclo.
  //    SOLO en el final normal. Si venimos aqui por un disparo de StallGuard o por el reloj
  //    duro, la brocha ya esta fuera y no tiene ningun sentido quedarse 800 s esperando.
  if (g_fallo == FALLO_NINGUNO) {
    while ((uint32_t)(millis() - g_t_ciclo_ini_ms) < CICLO_DURACION_MS) servicio_periodico();
  }
  // 6. Dos parpadeos lentos.
  const uint32_t t0 = millis();
  while ((uint32_t)(millis() - t0) < (uint32_t)(LED_FIN_REPS * (LED_FIN_ON_MS + LED_FIN_OFF_MS))) {
    servicio_periodico();
  }
  led_nivel(0);
  // 7. Log a flash.
  if (Serial) {
    Serial.print(F("[fin] golpes=")); Serial.print(g_golpes_dados);
    Serial.print(F("  recortes_rampa=")); Serial.print(g_recortes_rampa);
    Serial.print(F("  huecos_sin_dwell=")); Serial.print(g_huecos_sin_dwell);
    Serial.print(F("  err_homing(pasos)="));
    for (int i = 0; i < 5; i++) { Serial.print(g_err_homing[i]); Serial.print(' '); }
    Serial.println();
  }
  nvm_guardar();
  // 8. El firmware mata su propio rail. Esta es la salida NORMAL: el latch se dispara
  //    todas las noches. A partir de aqui el motor no puede moverse aunque el firmware quiera.
  pulso_motor_kill();
  cambiar_estado(EST_IDLE);
}


// =================================================================================================
//  BLOQUE 18 — DIAGNOSTICO POR USB  (solo se lee al dia siguiente, con luz)
// =================================================================================================
static void imprimir_info() {
  if (!Serial) return;
  Serial.println(F("--------------------------------------------------------"));
  Serial.println(F(PLUMA_VERSION_FIRMWARE));
  Serial.print(F("estado ............ ")); Serial.println(NOMBRE_ESTADO[g_estado]);
  Serial.print(F("reloj sistema ..... ")); Serial.print(clock_get_hz(clk_sys)); Serial.println(F(" Hz"));
  Serial.print(F("suelo PIO ......... ")); Serial.print(PIO_SUELO_US); Serial.println(F(" us"));
  Serial.print(F("v max a R=325 ..... "));
  Serial.print(1000000.0f / PIO_SUELO_US * MM_POR_UPASO(RADIO_MAX_MM) / 10.0f); Serial.println(F(" cm/s"));
  Serial.print(F("upasos por grado .. ")); Serial.println(UPASOS_POR_GRADO);
  Serial.print(F("R actual .......... ")); Serial.print(radio_actual()); Serial.println(F(" mm"));
  Serial.print(F("angulo actual ..... ")); Serial.print(ang_actual_deg()); Serial.println(F(" deg"));
  Serial.print(F("T ferula / taza ... ")); Serial.print(g_temp_ferula_c); Serial.print(F(" / "));
  Serial.print(g_temp_taza_c); Serial.println(F(" C"));
  Serial.print(F("T ambiente boot ... ")); Serial.print(g_temp_ambiente_c);
  Serial.println(g_calef_ferula_permitido ? F(" C  (calef ferula PERMITIDO)")
                                          : F(" C  (calef ferula BLOQUEADO, >24 C)"));
  Serial.print(F("PWM_OFS / GRAD .... ")); Serial.print(g_pwm_ofs); Serial.print('/');
  Serial.print(g_pwm_grad); Serial.println(g_calibracion_valida ? F("  (flash)") : F("  (defecto)"));
  Serial.print(F("sesiones / fallos . ")); Serial.print(g_nvm.sesiones); Serial.print('/');
  Serial.println(g_nvm.fallos);
  Serial.print(F("ultimo fallo ...... ")); Serial.println(g_nvm.ultimo_fallo);
  Serial.print(F("err homing ult ses  "));
  for (int i = 0; i < 5; i++) { Serial.print(g_nvm.err_homing[i]); Serial.print(' '); }
  Serial.println(F(" pasos completos"));
  Serial.println(F("Comandos: i=info  H=colgar firmware (PRUEBA DE SEGURIDAD)  Z=borrar log"));
  Serial.println(F("--------------------------------------------------------"));
}

static void atender_usb() {
  if (!Serial || !Serial.available()) return;
  const char c = (char)Serial.read();
  if (c == 'i') imprimir_info();
  else if (c == 'Z') { memset(&g_nvm, 0, sizeof(g_nvm)); nvm_guardar(); Serial.println(F("log borrado")); }
  else if (c == 'H') {
    // PRUEBA DE SEGURIDAD (c) del protocolo de validacion: colgar el firmware a proposito.
    // El bucle deja de refrescar g_bucle_vivo_ms -> la ISR corta el latido -> el charge pump
    // se descarga -> VMOT muere en <300 ms -> el contrapeso retira la brocha.
    // Ademas el watchdog del RP2040 reinicia el MCU a los 2 s.
    Serial.println(F("colgando el firmware a proposito. La brocha DEBE salir de la piel."));
    Serial.flush();
    for (;;) { /* nada. Ni watchdog, ni latido, ni pasos. */ }
  }
}


// =================================================================================================
//  BLOQUE 19 — setup() Y loop()
// =================================================================================================

void setup() {
  // ---- 1. LO PRIMERO DE TODO: dejar el motor y los calefactores APAGADOS ----------------------
  //  El pin EN del TMC2209 es ACTIVO A NIVEL BAJO y lleva pull-UP externo de 10k. Aqui se
  //  refuerza por software antes de que exista ninguna otra cosa.
  pinMode(PIN_nEN, OUTPUT);        digitalWrite(PIN_nEN, HIGH);
  pinMode(PIN_HEAT_FER, OUTPUT);   digitalWrite(PIN_HEAT_FER, LOW);
  pinMode(PIN_HEAT_CUP, OUTPUT);   digitalWrite(PIN_HEAT_CUP, LOW);
  pinMode(PIN_MOTOR_KILL, OUTPUT); digitalWrite(PIN_MOTOR_KILL, LOW);
  pinMode(PIN_DIR, OUTPUT);        digitalWrite(PIN_DIR, DIR_HACIA_REPOSO);
  pinMode(PIN_HEARTBEAT, OUTPUT);  digitalWrite(PIN_HEARTBEAT, LOW);

  pinMode(PIN_SW_PARK,   INPUT_PULLUP);
  pinMode(PIN_BTN_START, INPUT_PULLUP);
  pinMode(PIN_DIAG,      INPUT);
  pinMode(PIN_RAIL_SENSE_DIG, INPUT);

  analogReadResolution(ADC_BITS);

  // ---- 2. PWM: LED y carro. Frecuencias distintas por slice, asi que nada de analogWrite ----
  pwm_configurar_pin(PIN_LED_RED,  LED_PWM_HZ,   LED_PWM_WRAP);
  pwm_configurar_pin(PIN_ULN_IN1, CARRO_PWM_HZ, CARRO_PWM_WRAP);
  pwm_configurar_pin(PIN_ULN_IN2, CARRO_PWM_HZ, CARRO_PWM_WRAP);
  pwm_configurar_pin(PIN_ULN_IN3, CARRO_PWM_HZ, CARRO_PWM_WRAP);
  pwm_configurar_pin(PIN_ULN_IN4, CARRO_PWM_HZ, CARRO_PWM_WRAP);
  carro_construir_tabla();
  carro_desenergizar();
  led_nivel(LED_BRILLO_TENUE);

  // ---- 3. Generador de pasos por PIO (el clamp de 10 cm/s vive aqui) ---------------------------
  pio_arrancar_generador_de_pasos();

  // ---- 4. Memoria no volatil -------------------------------------------------------------------
  EEPROM.begin(EEPROM_TAMANO);
  nvm_cargar();

  // ---- 5. Semilla del generador de ruido. Sin esto, todas las noches serian identicas. --------
  g_rng = rp2040.hwrand32() ^ (uint32_t)micros();
  if (g_rng == 0) g_rng = 0x1BADC0DEUL;   // el cero se comprueba DESPUES del xor: xorshift32
                                          // con estado 0 se queda en 0 para siempre y todas
                                          // las noches serian identicas. (Antes se comprobaba
                                          // antes del xor, que es donde podia aparecer el 0.)

  // ---- 6. USB de diagnostico. NO bloquea si no hay ordenador al otro lado (un cargador). ------
  Serial.begin(115200);

  // ---- 7. La ISR de 8 kHz: alimenta el PIO, genera el latido y mueve el carro ------------------
  g_bucle_vivo_ms = millis();
  add_repeating_timer_us(-TICK_ISR_US, tick_isr, NULL, &g_temporizador);

  // ---- 8. Watchdog. Un cuelgue reinicia el MCU, y un reinicio deja el motor desenergizado
  //         (pull-up de EN) y la maquina esperando una pulsacion. El contrapeso hace el resto. --
  if (watchdog_caused_reboot()) g_nvm.ultimo_fallo = (uint8_t)FALLO_WATCHDOG;
  rp2040.wdt_begin(WATCHDOG_MS);

  cambiar_estado(EST_BOOT);
}

void loop() {
  // ESTA LLAMADA ES LA QUE MANTIENE VIVO EL MOTOR. Si el bucle se cuelga, deja de ejecutarse,
  // la ISR deja de conmutar el latido, el charge pump se descarga y VMOT muere en <300 ms.
  servicio_periodico();
  atender_usb();

  switch (g_estado) {
    case EST_BOOT:     estado_boot();     break;
    case EST_AUTOTUNE: estado_autotune(); break;
    case EST_HOMING:   estado_homing();   break;
    case EST_IDLE:     estado_idle();     break;
    case EST_PREWARM:  estado_prewarm();  break;
    case EST_RUNNING:  estado_running();  break;
    case EST_RETREAT:  estado_retreat();  break;
    case EST_FAULT:
      // Aqui se acaba la noche. El latido esta cortado, VMOT esta muerto, el motor esta
      // desenergizado y el contrapeso ya se ha llevado la brocha. Se sigue alimentando el
      // watchdog a proposito, para NO reiniciar y volver a intentarlo solo: un fallo tiene
      // que ser visible por la manana. Se sale con el boton (que rearma el latch por
      // hardware) o desenchufando.
      break;
  }
}

// =================================================================================================
//  FIN. Si has leido hasta aqui: la seguridad de este aparato no esta en este fichero.
//  Esta en un peso de 360 g colgado de una cuerda de Dyneema. Cuelgalo bien.
// =================================================================================================
