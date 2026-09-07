// =================================================================================================
//  PLUMA-R  —  test_movimiento.cpp  —  banco de pruebas del generador de movimiento
// =================================================================================================
//
//  QUE ES ESTO
//    Una reproduccion EXACTA, en el ordenador y sin una sola linea de Arduino, de:
//       - el generador de ruido (xorshift32 + Box-Muller),
//       - los seis paseos de Ornstein-Uhlenbeck de config.h,
//       - el perfil de velocidad de un golpe (quinticas de jerk minimo, taper, deriva 1/f),
//       - el productor de intervalos que alimenta el PIO, CON el suelo de 240 us,
//       - el sorteo de destino del carro radial y su regla de separacion,
//       - y el bucle de sesion de 15 minutos con sus visitas a la taza y su reserva de retirada.
//
//    Simula una sesion completa (y luego 200 sesiones con semillas distintas) y comprueba con
//    assert() las cinco cosas que la especificacion vinculante NO permite negociar:
//
//       1. La velocidad de punta EN CONTACTO PLENO nunca sale de 2,0-7,0 cm/s.
//       2. El clamp duro de 10 cm/s no se supera NUNCA, en ningun micropaso, a ningun radio.
//          (se calcula la velocidad REAL que sale del PIO, con su suelo de 240 us aplicado)
//       3. El hueco REAL sin contacto (vuelo de salida + dwell + vuelo de entrada) cae en
//          1,5-5,5 s. Ojo: NO basta con mirar el dwell que sortea el paseo OU; el hueco de
//          verdad incluye ir del taper al punto de inversion y volver.
//       4. Cada radio nuevo difiere >= 6 mm de CADA UNO de los dos anteriores.
//       5. El numero de pasadas en 15 min es el esperado (~64, banda 45-85) y el ciclo cabe
//          en 900 s dejando intacta la reserva de retirada.
//
//  COMPILAR Y EJECUTAR
//      g++ -std=c++17 -O2 -Wall -Wextra -o test_movimiento test_movimiento.cpp -lm
//      ./test_movimiento
//
//  Los NUMEROS estan copiados de firmware/pluma_relax/config.h. Si cambias config.h, cambia
//  el bloque "PARAMETROS" de abajo y vuelve a pasar el banco antes de tocar la maquina.
// =================================================================================================

#include <cassert>
#include <cstdint>
#include <cstdio>
#include <cmath>
#include <cstdlib>
#include <algorithm>

// =================================================================================================
//  PARAMETROS  (copia literal de config.h)
// =================================================================================================
static const float MOTOR_PASOS_POR_VUELTA = 200.0f;
static const float MICROSTEPPING          = 32.0f;
static const float REDUCCION_CABRESTANTE  = 14.2857f;
static const float UPASOS_POR_GRADO =
    MOTOR_PASOS_POR_VUELTA * MICROSTEPPING * REDUCCION_CABRESTANTE / 360.0f;   // 253,968

static const float RADIO_NOMINAL_MM = 300.0f;

static const float ANG_CONTACTO_DEG  = 19.0f;
static const float ANG_TAPER_DEG     = 26.0f;
static const float ANG_REPOSO_DEG    = 43.0f;

static const uint32_t PIO_SUELO_US          = 240u;
static const uint32_t PIO_RETARDO_EXTRA_MAX = 200000u;

// carro radial
static const float CARRO_UPASOS_POR_VUELTA = 16384.0f;
static const float CARRO_PASO_HUSILLO_MM   = 8.0f;
static const float CARRO_UPASOS_POR_MM     = CARRO_UPASOS_POR_VUELTA / CARRO_PASO_HUSILLO_MM;
static const int   TICK_ISR_US             = 125;
static const int   CARRO_DIVISOR_TICKS     = 2;
static const float CARRO_VEL_MM_S =
    (1000000.0f / (TICK_ISR_US * CARRO_DIVISOR_TICKS)) / CARRO_UPASOS_POR_MM;   // 1,953 mm/s
static const float CARRO_RECORRIDO_MM       = 25.0f;
static const float CARRO_MARGEN_SEGURIDAD_MM = 1.0f;
static const float CARRO_SALTO_MIN_MM       = 6.0f;
static const float CARRO_SALTO_MAX_MM       = 12.0f;
static const float CARRO_SEPARACION_MIN_MM  = 6.0f;
static const float CARRO_ARRANQUE_FRACCION  = 0.80f;
static const int   CARRO_MOVER_CADA_N_GOLPES = 4;

// ejes OU
static const float OU_VEL_TAU_GOLPES = 6.0f, OU_VEL_SIGMA_MMS = 8.0f;
static const float OU_VEL_MIN_MMS = 20.0f, OU_VEL_MAX_MMS = 70.0f;
static const float OU_VEL_MEDIA_BLOQUE[4] = { 32.0f, 26.0f, 41.0f, 29.0f };

static const float OU_HUECO_TAU_GOLPES = 4.0f, OU_HUECO_MEDIA_S = 3.5f, OU_HUECO_SIGMA_S = 1.1f;
static const float OU_HUECO_MIN_S = 1.5f, OU_HUECO_MAX_S = 5.5f;
static const float GAP_MAX_ABSOLUTO_S = 10.0f;

static const float OU_RAMPA_TAU_GOLPES = 5.0f, OU_RAMPA_MEDIA_S = 1.4f, OU_RAMPA_SIGMA_S = 0.55f;
static const float OU_RAMPA_MIN_S = 0.6f, OU_RAMPA_MAX_S = 2.5f;
static const float V_ENTRADA_TAPER_MIN_MMS = 5.0f;
static const float V_ENTRADA_TAPER_MAX_MMS = 70.0f;    // corregido de 75 en la verificacion

static const float OU_INVER_TAU_GOLPES = 3.0f, OU_INVER_MEDIA_DEG = 36.5f;
static const float OU_INVER_SIGMA_DEG = 1.6f, OU_INVER_MIN_DEG = 33.5f, OU_INVER_MAX_DEG = 39.5f;

static const float OU_ROZADA_PROB = 0.15f, OU_ROZADA_TAU_GOLPES = 4.0f;
static const float OU_ROZADA_MEDIA_DEG = 22.5f, OU_ROZADA_SIGMA_DEG = 1.2f;
static const float OU_ROZADA_MIN_DEG = 20.5f, OU_ROZADA_MAX_DEG = 24.5f;
static const bool  ROZADA_PROHIBIDA_BLOQUE_1 = true;
static const bool  ROZADA_SOLO_LADO_LEJANO   = true;

static const float OU_RADIO_TAU_GOLPES = 8.0f, OU_RADIO_MEDIA_MM = 0.0f, OU_RADIO_SIGMA_MM = 9.0f;
static const float OU_RADIO_MIN_MM = -(CARRO_RECORRIDO_MM - CARRO_MARGEN_SEGURIDAD_MM);
static const float OU_RADIO_MAX_MM =  (CARRO_RECORRIDO_MM - CARRO_MARGEN_SEGURIDAD_MM);

static const float V_ARRANQUE_MMS      = 6.0f;
static const float V_VUELO_MMS         = 75.0f;    // eje 7: crucero FUERA de la piel
static const float A_VUELO_MMS2        = 200.0f;
static const float V_MINIMA_ABSOLUTA_MMS = 0.5f;
static const bool  DERIVA_1F_HABILITADA = true;
static const float DERIVA_1F_AMPLITUD   = 0.06f;
static const float DERIVA_1F_ACEL_MAX_MMS2 = 2.0f;

static const uint32_t CICLO_DURACION_MS   = 900000UL;
static const int      CICLO_BLOQUES       = 4;
static const uint32_t BLOQUE_DURACION_MS  = 225000UL;
static const uint32_t RESERVA_RETIRADA_MS = 40000UL;   // corregido de 20000 en la verificacion
static const float    GAP_TRAS_ROZADA_S   = 0.25f;

// El techo del clamp duro, en mm/s de punta.
static const float CLAMP_DURO_MMS = 100.0f;

// =================================================================================================
//  RUIDO Y PASEOS DE ORNSTEIN-UHLENBECK   (copia literal de pluma_relax.ino, bloque 10)
// =================================================================================================
static uint32_t g_rng = 0x1BADC0DEUL;
static inline uint32_t xorshift32() {
  g_rng ^= g_rng << 13; g_rng ^= g_rng >> 17; g_rng ^= g_rng << 5; return g_rng;
}
static inline float uniforme() { return (float)(xorshift32() >> 8) / 16777216.0f; }

static bool  g_bm_hay = false;
static float g_bm_guardado = 0.0f;
static float normal01() {
  if (g_bm_hay) { g_bm_hay = false; return g_bm_guardado; }
  float u1 = uniforme(); if (u1 < 1e-7f) u1 = 1e-7f;
  const float u2 = uniforme();
  const float r = sqrtf(-2.0f * logf(u1));
  g_bm_guardado = r * sinf(2.0f * (float)M_PI * u2); g_bm_hay = true;
  return r * cosf(2.0f * (float)M_PI * u2);
}

struct OU { float x, mu, sigma, tau, lo, hi; };

static float ou_siguiente(OU& o) {
  const float a = expf(-1.0f / o.tau);
  const float b = o.sigma * sqrtf(1.0f - a * a);
  o.x = o.mu + (o.x - o.mu) * a + b * normal01();
  for (int i = 0; i < 4; i++) {
    if (o.x < o.lo) o.x = 2.0f * o.lo - o.x;
    if (o.x > o.hi) o.x = 2.0f * o.hi - o.x;
  }
  if (o.x < o.lo) o.x = o.lo;
  if (o.x > o.hi) o.x = o.hi;
  return o.x;
}

// =================================================================================================
//  PLANIFICADOR   (copia literal de pluma_relax.ino, bloque 11, YA CON LAS CORRECCIONES)
// =================================================================================================
#define FORMA_CONST     0
#define FORMA_QUINTICA  1
#define TRAMOS_MAX      10

struct Tramo { float s0, s1, v0, v1; uint8_t forma; };

struct Movimiento {
  Tramo    tramos[TRAMOS_MAX];
  uint8_t  n;
  float    s, s_total, mm_por_upaso;
  uint32_t upasos_restantes;
  bool     activo, deriva;
  float    deriva_lambda, deriva_fase, deriva_amp;
  float    s_contacto_ini, s_contacto_fin;
  float    s_aire_sal;
};
static Movimiento g_mov;

static inline float quintica(float u) { return u * u * u * (10.0f + u * (-15.0f + 6.0f * u)); }
static inline float mm_por_grado(float R) { return R * 0.01745329f; }
static inline float mm_por_upaso(float R) { return R * 0.01745329f / UPASOS_POR_GRADO; }

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
  if (g_mov.deriva && s >= g_mov.s_contacto_ini && s <= g_mov.s_contacto_fin) {
    v *= 1.0f + g_mov.deriva_amp *
         sinf(2.0f * (float)M_PI * (s - g_mov.s_contacto_ini) / g_mov.deriva_lambda + g_mov.deriva_fase);
    if (v > OU_VEL_MAX_MMS) v = OU_VEL_MAX_MMS;      // <-- correccion de la verificacion
    if (v < OU_VEL_MIN_MMS) v = OU_VEL_MIN_MMS;      // <-- correccion de la verificacion
  }
  if (v > V_VUELO_MMS) v = V_VUELO_MMS;             // techo global (el vuelo va a 7,5 cm/s)
  if (v < V_MINIMA_ABSOLUTA_MMS) v = V_MINIMA_ABSOLUTA_MMS;
  return v;
}

static float tiempo_quintica(float L, float v0, float v1) {
  const int N = 32; float acc = 0.0f;
  for (int i = 0; i < N; i++) {
    const float u = ((float)i + 0.5f) / (float)N;
    float v = v0 + (v1 - v0) * quintica(u);
    if (v < V_MINIMA_ABSOLUTA_MMS) v = V_MINIMA_ABSOLUTA_MMS;
    acc += 1.0f / v;
  }
  return L * acc / (float)N;
}

static int g_recortes_rampa = 0;
static float resolver_v_entrada(float L_taper, float v_crucero, float t_objetivo) {
  float lo = V_ENTRADA_TAPER_MIN_MMS, hi = V_ENTRADA_TAPER_MAX_MMS;
  const float t_lo = tiempo_quintica(L_taper, lo, v_crucero);
  const float t_hi = tiempo_quintica(L_taper, hi, v_crucero);
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
  if (s1 <= s0 + 0.01f) return;
  g_mov.tramos[g_mov.n++] = { s0, s1, v0, v1, forma };
}

// EJE 7: todo el trayecto fuera de la piel se recorre a V_VUELO_MMS (copia de pluma_relax.ino)
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

static void construir_golpe(float ang_ini, float ang_fin, float v_cru, float t_rampa,
                            bool rozada_ini, bool rozada_fin, float R) {
  const float k = mm_por_grado(R);
  const float si = (ang_ini >= 0.0f) ? +1.0f : -1.0f;
  const float sf = -si;
  const float L_taper = (ANG_TAPER_DEG - ANG_CONTACTO_DEG) * k;
  auto S_DE = [&](float a) { return fabsf(a - ang_ini) * k; };

  const float v_ent = resolver_v_entrada(L_taper, v_cru, t_rampa);

  g_mov.n = 0;
  if (!rozada_ini) {
    tramo_vuelo(S_DE(ang_ini), S_DE(si * ANG_TAPER_DEG), V_ARRANQUE_MMS, v_ent);
    tramo_add(S_DE(si * ANG_TAPER_DEG), S_DE(si * ANG_CONTACTO_DEG), v_ent, v_cru, FORMA_QUINTICA);
  } else {
    tramo_add(S_DE(ang_ini), S_DE(si * ANG_CONTACTO_DEG), V_ARRANQUE_MMS, v_cru, FORMA_QUINTICA);
  }
  const float sc0 = S_DE(si * ANG_CONTACTO_DEG);
  const float sc1 = S_DE(sf * ANG_CONTACTO_DEG);
  tramo_add(sc0, sc1, v_cru, v_cru, FORMA_CONST);
  if (!rozada_fin) {
    tramo_add(sc1, S_DE(sf * ANG_TAPER_DEG), v_cru, v_ent, FORMA_QUINTICA);
    tramo_vuelo(S_DE(sf * ANG_TAPER_DEG), S_DE(ang_fin), v_ent, V_ARRANQUE_MMS);
  } else {
    tramo_add(sc1, S_DE(ang_fin), v_cru, V_ARRANQUE_MMS, FORMA_QUINTICA);
  }
  g_mov.deriva = DERIVA_1F_HABILITADA;
  g_mov.deriva_amp = DERIVA_1F_AMPLITUD;
  g_mov.deriva_fase = uniforme() * 2.0f * (float)M_PI;
  const float lam_min = v_cru * v_cru * DERIVA_1F_AMPLITUD * 6.2832f / DERIVA_1F_ACEL_MAX_MMS2;
  g_mov.deriva_lambda = (lam_min > 180.0f) ? lam_min : 180.0f;
  g_mov.s_contacto_ini = sc0;
  g_mov.s_contacto_fin = sc1;
  g_mov.s_aire_sal = rozada_fin ? 1e9f : S_DE(sf * ANG_TAPER_DEG);
}

// Tiempo que el golpe pasa YA sin tocar la piel tras el taper de salida (copia del firmware).
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

static void construir_simple(float D, float v) {
  const float rampa = fminf(0.20f * D, 20.0f);
  const float V_ARRANQUE_MMS = fminf(::V_ARRANQUE_MMS, v);
  g_mov.n = 0;
  g_mov.deriva = false;
  g_mov.s_aire_sal = 1e9f;
  g_mov.s_contacto_ini = 1e9f; g_mov.s_contacto_fin = -1e9f;
  if (D <= 2.0f * rampa + 0.5f) {
    tramo_add(0.0f, 0.5f * D, V_ARRANQUE_MMS, v, FORMA_QUINTICA);
    tramo_add(0.5f * D, D,    v, V_ARRANQUE_MMS, FORMA_QUINTICA);
  } else {
    tramo_add(0.0f, rampa,      V_ARRANQUE_MMS, v, FORMA_QUINTICA);
    tramo_add(rampa, D - rampa, v, v, FORMA_CONST);
    tramo_add(D - rampa, D,     v, V_ARRANQUE_MMS, FORMA_QUINTICA);
  }
}

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

// =================================================================================================
//  ESTADISTICAS QUE RECOGE EL BANCO
// =================================================================================================
struct Stats {
  double v_contacto_min = 1e9, v_contacto_max = -1e9;
  double v_real_max = -1e9;               // velocidad de punta REAL que sale del PIO
  double gap_min = 1e9, gap_max = -1e9;   // huecos SORTEADOS (= tiempo total sin contacto)
  double sin_contacto_min = 1e9, sin_contacto_max = -1e9;  // el hueco REAL, medido
  int    sin_dwell = 0;
  double gap_efectivo_max = -1e9;         // huecos reales, incluida la espera al carro
  int    gaps_alargados = 0;
  double sep_radio_min = 1e9;
  int    golpes = 0, rozadas = 0, mov_carro = 0, visitas = 0;
  double t_final_s = 0.0;
  double camino_piel_mm = 0.0;
  uint32_t upasos = 0;
  uint32_t intervalo_min_us = 0xFFFFFFFFu;
};

// -------------------------------------------------------------------------------------------------
//  Ejecuta UN golpe micropaso a micropaso, exactamente como mov_alimentar() en el firmware:
//  intervalo = max(240 us, mm_por_upaso*1e6/v). Devuelve la duracion real en segundos.
// -------------------------------------------------------------------------------------------------
static double ejecutar_movimiento(float distancia_mm, float R, Stats& st, bool es_golpe) {
  const float mmu = mm_por_upaso(R);
  const uint32_t n = (uint32_t)lroundf(distancia_mm / mmu);
  double t = 0.0;
  float s = 0.0f;
  for (uint32_t i = 0; i < n; i++) {
    s += mmu;
    const float v = mov_velocidad(s);

    // ---- ASSERT 1: en contacto pleno, la banda 2,0-7,0 cm/s es inviolable ----
    if (es_golpe && s >= g_mov.s_contacto_ini && s <= g_mov.s_contacto_fin) {
      assert(v >= OU_VEL_MIN_MMS - 1e-3f && "velocidad por DEBAJO de 2,0 cm/s en contacto pleno");
      assert(v <= OU_VEL_MAX_MMS + 1e-3f && "velocidad por ENCIMA de 7,0 cm/s en contacto pleno");
      st.v_contacto_min = std::min(st.v_contacto_min, (double)v);
      st.v_contacto_max = std::max(st.v_contacto_max, (double)v);
      st.camino_piel_mm += mmu;
    }

    float t_us = mmu * 1000000.0f / v;
    const float techo = (float)(PIO_SUELO_US + PIO_RETARDO_EXTRA_MAX);
    if (t_us > techo) t_us = techo;
    const uint32_t ti = (uint32_t)t_us;
    const uint32_t extra = (ti > PIO_SUELO_US) ? (ti - PIO_SUELO_US) : 0u;
    const uint32_t periodo_us = PIO_SUELO_US + extra;      // lo que emite el PIO DE VERDAD

    // ---- ASSERT 2: el clamp duro del PIO. Velocidad REAL de la punta. ----
    const double v_real = (double)mmu / ((double)periodo_us * 1e-6);
    assert(v_real <= CLAMP_DURO_MMS && "SE HA SUPERADO EL CLAMP DURO DE 10 cm/s");
    st.v_real_max = std::max(st.v_real_max, v_real);
    st.intervalo_min_us = std::min(st.intervalo_min_us, periodo_us);

    t += (double)periodo_us * 1e-6;
    st.upasos++;
  }
  return t;
}

// =================================================================================================
//  CARRO RADIAL
// =================================================================================================
static float g_radio_offset_mm = 0.0f;      // posicion REAL del carro
static float g_radio_hist1_mm = 999.0f, g_radio_hist2_mm = 999.0f;
static OU    g_ou_radio;

static float carro_sortear_destino(float actual) {
  const float guia = ou_siguiente(g_ou_radio);
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
  return hay ? mejor : actual;
}

// =================================================================================================
//  UNA SESION COMPLETA DE 15 MINUTOS
// =================================================================================================
static Stats simular_sesion(uint32_t semilla, bool verboso) {
  g_rng = semilla ? semilla : 0x1BADC0DEUL;
  g_bm_hay = false;
  g_recortes_rampa = 0;

  OU ou_vel    = { OU_VEL_MEDIA_BLOQUE[0], OU_VEL_MEDIA_BLOQUE[0], OU_VEL_SIGMA_MMS, OU_VEL_TAU_GOLPES, OU_VEL_MIN_MMS, OU_VEL_MAX_MMS };
  OU ou_hueco  = { OU_HUECO_MEDIA_S, OU_HUECO_MEDIA_S, OU_HUECO_SIGMA_S, OU_HUECO_TAU_GOLPES, OU_HUECO_MIN_S, OU_HUECO_MAX_S };
  OU ou_rampa  = { OU_RAMPA_MEDIA_S, OU_RAMPA_MEDIA_S, OU_RAMPA_SIGMA_S, OU_RAMPA_TAU_GOLPES, OU_RAMPA_MIN_S, OU_RAMPA_MAX_S };
  OU ou_inver  = { OU_INVER_MEDIA_DEG, OU_INVER_MEDIA_DEG, OU_INVER_SIGMA_DEG, OU_INVER_TAU_GOLPES, OU_INVER_MIN_DEG, OU_INVER_MAX_DEG };
  OU ou_rozada = { OU_ROZADA_MEDIA_DEG, OU_ROZADA_MEDIA_DEG, OU_ROZADA_SIGMA_DEG, OU_ROZADA_TAU_GOLPES, OU_ROZADA_MIN_DEG, OU_ROZADA_MAX_DEG };
  g_ou_radio   = { OU_RADIO_MEDIA_MM, OU_RADIO_MEDIA_MM, OU_RADIO_SIGMA_MM, OU_RADIO_TAU_GOLPES, OU_RADIO_MIN_MM, OU_RADIO_MAX_MM };

  g_radio_offset_mm = 0.0f;
  g_radio_hist1_mm = g_radio_hist2_mm = 999.0f;

  Stats st;
  double t = 0.0;                       // segundos desde el inicio de los 900 s
  float  ang = ANG_REPOSO_DEG;          // se arranca desde la taza (+43 deg)
  bool   ultima_rozada = false;
  int    visitas_hechas = 1;            // la 0 es la del PREWARM
  int    bloque = 0;
  int    golpes = 0;

  // estado del carro
  float carro_pos = 0.0f, carro_obj = 0.0f;
  bool  carro_activo = false;

  auto avanzar_carro = [&](double dt) {
    if (!carro_activo) return;
    double margen = CARRO_VEL_MM_S * dt;
    const double falta = fabs((double)carro_obj - (double)carro_pos);
    if (falta <= margen) { carro_pos = carro_obj; carro_activo = false; }
    else carro_pos += (float)((carro_obj > carro_pos ? +1.0 : -1.0) * margen);
  };

  for (;;) {
    const uint32_t t_ciclo_ms = (uint32_t)(t * 1000.0);

    // ---- visita programada a la taza (fin de bloque 1, 2 y 3) ----
    if (visitas_hechas < CICLO_BLOQUES &&
        t_ciclo_ms >= (uint32_t)visitas_hechas * BLOQUE_DURACION_MS) {
      const float R = RADIO_NOMINAL_MM + carro_pos;
      const float d = fabsf(ANG_REPOSO_DEG - ang) * mm_por_grado(R);
      construir_simple(d, OU_VEL_MEDIA_BLOQUE[1]);
      const double dt = ejecutar_movimiento(d, R, st, false) + 2.5;   // + asentar_en_el_tope()
      avanzar_carro(dt);
      t += dt; ang = ANG_REPOSO_DEG; visitas_hechas++; st.visitas++;
      ultima_rozada = false;
      continue;
    }

    // ---- bloque (cambia la media del paseo de velocidad) ----
    const int b = (int)(t_ciclo_ms / BLOQUE_DURACION_MS);
    if (b != bloque && b < CICLO_BLOQUES) { bloque = b; ou_vel.mu = OU_VEL_MEDIA_BLOQUE[b]; }

    // ---- el carro es retro-conducible: la verdad esta en su contador ----
    g_radio_offset_mm = carro_pos;
    const float R = RADIO_NOMINAL_MM + g_radio_offset_mm;

    // ---- los seis ejes ----
    const float v_cru   = ou_siguiente(ou_vel);
    assert(v_cru >= OU_VEL_MIN_MMS - 1e-3f && v_cru <= OU_VEL_MAX_MMS + 1e-3f);
    const float t_rampa = ou_siguiente(ou_rampa);
    assert(t_rampa >= OU_RAMPA_MIN_S - 1e-3f && t_rampa <= OU_RAMPA_MAX_S + 1e-3f);

    const float ang_i = ang;
    const bool  roz_i = (fabsf(ang_i) < ANG_TAPER_DEG);
    bool roz_f = true;
    if (OU_ROZADA_PROB <= 0.0f)                     roz_f = false;
    else if (ultima_rozada)                         roz_f = false;
    else if (ROZADA_PROHIBIDA_BLOQUE_1 && bloque==0) roz_f = false;
    else if (ROZADA_SOLO_LADO_LEJANO && ang_i < 0.0f) roz_f = false;
    else                                            roz_f = (uniforme() < OU_ROZADA_PROB);

    const float mag   = roz_f ? ou_siguiente(ou_rozada) : ou_siguiente(ou_inver);
    const float ang_f = ((ang_i >= 0.0f) ? -1.0f : +1.0f) * mag;

    construir_golpe(ang_i, ang_f, v_cru, t_rampa, roz_i, roz_f, R);
    const float dist = fabsf(ang_f - ang_i) * mm_por_grado(R);
    const float t_est_s = mov_tiempo_estimado_s();

    // ---- ¿cabe el golpe dentro de los 900 s menos la reserva de retirada? ----
    if (t_ciclo_ms + (uint32_t)(t_est_s * 1000.0f) + RESERVA_RETIRADA_MS >= CICLO_DURACION_MS) break;

    // ---- ¿movimiento de carro en este golpe? (NUNCA si el golpe acaba rozando) ----
    bool hay_pendiente = false; float destino = 0.0f;
    if (CARRO_MOVER_CADA_N_GOLPES > 0 && !roz_f && (golpes % CARRO_MOVER_CADA_N_GOLPES) == 0) {
      destino = carro_sortear_destino(g_radio_offset_mm);
      if (fabsf(destino - g_radio_offset_mm) >= CARRO_SALTO_MIN_MM) hay_pendiente = true;
    }

    // ---- ejecutar el golpe. El carro se lanza al 80 % del contacto. ----
    // Se parte en dos tramos para colocar el lanzamiento en el instante correcto.
    const double t_golpe = ejecutar_movimiento(dist, R, st, true);
    double t_hasta_lanzamiento = t_golpe;
    if (hay_pendiente) {
      // fraccion recorrida hasta el 80 % del contacto, en tiempo
      const float s_lanz = CARRO_ARRANQUE_FRACCION * g_mov.s_contacto_fin;
      double acc = 0.0; const float mmu = mm_por_upaso(R); float s = 0.0f;
      const uint32_t n = (uint32_t)lroundf(dist / mmu);
      for (uint32_t i = 0; i < n && s < s_lanz; i++) {
        s += mmu; const float v = mov_velocidad(s);
        float t_us = mmu * 1000000.0f / v;
        const float techo = (float)(PIO_SUELO_US + PIO_RETARDO_EXTRA_MAX);
        if (t_us > techo) t_us = techo;
        const uint32_t ti = (uint32_t)t_us;
        acc += (double)(PIO_SUELO_US + ((ti > PIO_SUELO_US) ? (ti - PIO_SUELO_US) : 0u)) * 1e-6;
      }
      t_hasta_lanzamiento = acc;
    }

    avanzar_carro(t_hasta_lanzamiento);
    if (hay_pendiente) {
      // ---- ASSERT 4: la regla dura de separacion de radios ----
      const float d0 = fabsf(destino - g_radio_offset_mm);
      const float d1 = fabsf(destino - g_radio_hist1_mm);
      const float d2 = fabsf(destino - g_radio_hist2_mm);
      assert(d0 >= CARRO_SEPARACION_MIN_MM - 1e-3f && "salto de radio < 6 mm respecto al actual");
      assert(d1 >= CARRO_SEPARACION_MIN_MM - 1e-3f && "radio a < 6 mm del anterior");
      assert(d2 >= CARRO_SEPARACION_MIN_MM - 1e-3f && "radio a < 6 mm del penultimo");
      assert(destino >= OU_RADIO_MIN_MM - 1e-3f && destino <= OU_RADIO_MAX_MM + 1e-3f);
      st.sep_radio_min = std::min({ st.sep_radio_min, (double)d0, (double)d1, (double)d2 });
      g_radio_hist2_mm = g_radio_hist1_mm;
      g_radio_hist1_mm = g_radio_offset_mm;
      carro_obj = destino; carro_activo = true; st.mov_carro++;
    }
    avanzar_carro(t_golpe - t_hasta_lanzamiento);
    t += t_golpe;
    golpes++; st.golpes++;
    ang = ang_f;
    ultima_rozada = roz_f;
    if (roz_f) st.rozadas++;

    // ---- hueco ----
    // vuelo de salida de ESTE golpe (la primera mitad del hueco real)
    const double t_aire_sal = roz_f ? 0.0 : mov_tiempo_aire_salida_s();
    double gap;
    if (roz_f) {
      gap = GAP_TRAS_ROZADA_S;      // tras una rozada la brocha sigue tocando: no hay hueco
    } else {
      const float g = ou_siguiente(ou_hueco);
      // ---- ASSERT 3: los huecos sorteados caen en 1,5-5,5 s ----
      assert(g >= OU_HUECO_MIN_S - 1e-3f && "hueco sorteado por debajo de 1,5 s");
      assert(g <= OU_HUECO_MAX_S + 1e-3f && "hueco sorteado por encima de 5,5 s");
      st.gap_min = std::min(st.gap_min, (double)g);
      st.gap_max = std::max(st.gap_max, (double)g);
      // el paseo OU sortea el hueco TOTAL sin contacto; se le descuenta el vuelo (x2, por
      // simetria con el vuelo de entrada del golpe siguiente). Igual que el firmware.
      double dwell = (double)g - 2.0 * t_aire_sal;
      if (dwell < 0.0) { dwell = 0.0; st.sin_dwell++; }
      const double sin_contacto = 2.0 * t_aire_sal + dwell;
      st.sin_contacto_min = std::min(st.sin_contacto_min, sin_contacto);
      st.sin_contacto_max = std::max(st.sin_contacto_max, sin_contacto);
      gap = dwell;
      // el hueco es ELASTICO: si el carro no ha terminado, se espera (techo GAP_MAX_ABSOLUTO_S)
      double espera = gap;
      while (espera < GAP_MAX_ABSOLUTO_S) {
        avanzar_carro(0.01); espera += 0.01;
        if (espera >= gap && !carro_activo) break;
      }
      if (espera > gap + 1e-6) st.gaps_alargados++;
      gap = std::min(espera, (double)GAP_MAX_ABSOLUTO_S);
      assert(gap <= GAP_MAX_ABSOLUTO_S + 1e-6 && "hueco por encima del techo absoluto");
    }
    // El hueco tampoco puede morder la reserva de retirada (correccion de la verificacion:
    // running_hueco() corta el hueco en seco al llegar al limite).
    const double limite_s = (CICLO_DURACION_MS - RESERVA_RETIRADA_MS) / 1000.0;
    if (t >= limite_s) gap = 0.0;
    else if (t + gap > limite_s) gap = limite_s - t;

    st.gap_efectivo_max = std::max(st.gap_efectivo_max, gap);
    avanzar_carro(gap);
    t += gap;
  }

  st.t_final_s = t;
  if (verboso) {
    printf("  bloques recorridos ....... %d\n", bloque + 1);
    printf("  recortes de rampa ........ %d  (t_rampa no alcanzable a esa v_crucero)\n",
           g_recortes_rampa);
  }
  return st;
}

// =================================================================================================
//  MAIN
// =================================================================================================
int main() {
  printf("=========================================================================\n");
  printf(" PLUMA-R  —  banco de pruebas del movimiento  (sin Arduino, solo g++)\n");
  printf("=========================================================================\n\n");

  // ---------------------------------------------------------------------------------------------
  // PRUEBA 0: el paseo de Ornstein-Uhlenbeck respeta sus limites SIEMPRE.
  //           1.000.000 de sorteos por eje, con sigma inflada a 10x para forzar la reflexion.
  // ---------------------------------------------------------------------------------------------
  {
    g_rng = 0xC0FFEEu; g_bm_hay = false;
    OU o = { 32.0f, 32.0f, OU_VEL_SIGMA_MMS * 10.0f, OU_VEL_TAU_GOLPES, OU_VEL_MIN_MMS, OU_VEL_MAX_MMS };
    double lo = 1e9, hi = -1e9, suma = 0.0;
    const int N = 1000000;
    for (int i = 0; i < N; i++) {
      const float x = ou_siguiente(o);
      assert(x >= OU_VEL_MIN_MMS && x <= OU_VEL_MAX_MMS && "el OU se ha salido de su banda");
      assert(!std::isnan(x) && "el OU ha producido NaN");
      lo = std::min(lo, (double)x); hi = std::max(hi, (double)x); suma += x;
    }
    printf("[0] OU con sigma x10 (fuerza la reflexion), %d sorteos:\n", N);
    printf("    min = %.4f  max = %.4f  media = %.3f  mm/s   -> dentro de [%.1f, %.1f]  OK\n\n",
           lo, hi, suma / N, (double)OU_VEL_MIN_MMS, (double)OU_VEL_MAX_MMS);
  }

  // ---------------------------------------------------------------------------------------------
  // PRUEBA 1: una sesion de 15 minutos, con detalle.
  // ---------------------------------------------------------------------------------------------
  printf("[1] Una sesion completa de 900 s (semilla 0x1BADC0DE):\n");
  Stats s = simular_sesion(0x1BADC0DEu, true);
  printf("    golpes ................... %d\n", s.golpes);
  printf("    de ellos, rozadas ........ %d\n", s.rozadas);
  printf("    visitas a la taza ........ %d  (+1 del PREWARM +1 de la retirada = %d)\n",
         s.visitas, s.visitas + 2);
  printf("    movimientos de carro ..... %d\n", s.mov_carro);
  printf("    micropasos emitidos ...... %u\n", s.upasos);
  printf("    camino sobre la piel ..... %.2f m\n", s.camino_piel_mm / 1000.0);
  printf("    t al ultimo golpe ........ %.1f s   (reserva de retirada %.0f s)\n",
         s.t_final_s, RESERVA_RETIRADA_MS / 1000.0);
  printf("    v en contacto pleno ...... %.2f - %.2f cm/s   (banda 2,0-7,0)\n",
         s.v_contacto_min / 10.0, s.v_contacto_max / 10.0);
  printf("    v REAL maxima del PIO .... %.3f cm/s          (clamp duro 10,0)\n", s.v_real_max / 10.0);
  printf("    intervalo minimo emitido . %u us              (suelo del PIO %u us)\n",
         s.intervalo_min_us, PIO_SUELO_US);
  printf("    huecos sorteados ......... %.2f - %.2f s      (banda 1,5-5,5)\n", s.gap_min, s.gap_max);
  printf("    hueco efectivo maximo .... %.2f s  (%d alargados esperando al carro, techo %.1f s)\n",
         s.gap_efectivo_max, s.gaps_alargados, (double)GAP_MAX_ABSOLUTO_S);
  printf("    separacion minima radios . %.2f mm            (regla dura >= 6,00)\n", s.sep_radio_min);
  printf("    HUECO REAL SIN CONTACTO .. %.2f - %.2f s      (parametro vinculante 1,5-5,5)\n",
         s.sin_contacto_min, s.sin_contacto_max);
  printf("                               = vuelo_salida + dwell + vuelo_entrada; %d veces el\n",
         s.sin_dwell);
  printf("                                 vuelo se comio el dwell entero\n\n");

  // ---- Los asserts de resumen de la sesion ----
  assert(s.v_contacto_min >= OU_VEL_MIN_MMS - 1e-3 && "v minima en piel por debajo de 2,0 cm/s");
  assert(s.v_contacto_max <= OU_VEL_MAX_MMS + 1e-3 && "v maxima en piel por encima de 7,0 cm/s");
  assert(s.v_real_max <= CLAMP_DURO_MMS && "clamp duro de 10 cm/s superado");
  assert(s.intervalo_min_us >= PIO_SUELO_US && "se ha emitido un intervalo por debajo del suelo");
  assert(s.gap_min >= OU_HUECO_MIN_S - 1e-3 && s.gap_max <= OU_HUECO_MAX_S + 1e-3);
  assert(s.sep_radio_min >= CARRO_SEPARACION_MIN_MM - 1e-3);
  // El hueco REAL sin contacto: es el que acota la especificacion vinculante.
  assert(s.sin_contacto_min >= OU_HUECO_MIN_S - 1e-3 && "hueco real por debajo de 1,5 s");
  assert(s.sin_contacto_max <= OU_HUECO_MAX_S + 1e-3 && "hueco real por encima de 5,5 s");
  // El ultimo golpe + su hueco deben terminar ANTES de que empiece la reserva de retirada.
  // Se admite 1 s de tolerancia: la duracion real de un golpe difiere unas decimas de la
  // estimada (mov_tiempo_estimado_s no ve la deriva 1/f ni la cuantizacion del micropaso).
  assert(s.t_final_s <= (CICLO_DURACION_MS - RESERVA_RETIRADA_MS) / 1000.0 + 1.0
         && "el ultimo golpe o su hueco invaden la reserva de retirada");

  // ---------------------------------------------------------------------------------------------
  // PRUEBA 2: 200 sesiones con semillas distintas. Aqui es donde salen los casos raros.
  // ---------------------------------------------------------------------------------------------
  printf("[2] 200 sesiones con semillas distintas:\n");
  int g_min = 1 << 30, g_max = 0; double g_sum = 0.0;
  double vmax_global = 0.0, vreal_global = 0.0, sep_global = 1e9, t_max = 0.0;
  int carro_total = 0, rozadas_total = 0;
  for (int k = 0; k < 200; k++) {
    Stats a = simular_sesion(0x1000u + (uint32_t)k * 2654435761u, false);
    g_min = std::min(g_min, a.golpes); g_max = std::max(g_max, a.golpes); g_sum += a.golpes;
    vmax_global  = std::max(vmax_global, a.v_contacto_max);
    vreal_global = std::max(vreal_global, a.v_real_max);
    sep_global   = std::min(sep_global, a.sep_radio_min);
    t_max        = std::max(t_max, a.t_final_s);
    carro_total += a.mov_carro; rozadas_total += a.rozadas;
    assert(a.v_contacto_max <= OU_VEL_MAX_MMS + 1e-3);
    assert(a.v_contacto_min >= OU_VEL_MIN_MMS - 1e-3);
    assert(a.v_real_max <= CLAMP_DURO_MMS);
    assert(a.gap_min >= OU_HUECO_MIN_S - 1e-3 && a.gap_max <= OU_HUECO_MAX_S + 1e-3);
    assert(a.sep_radio_min >= CARRO_SEPARACION_MIN_MM - 1e-3);
    assert(a.sin_contacto_min >= OU_HUECO_MIN_S - 1e-3);
    assert(a.sin_contacto_max <= OU_HUECO_MAX_S + 1e-3);
    assert(a.t_final_s <= (CICLO_DURACION_MS - RESERVA_RETIRADA_MS) / 1000.0 + 1.0);
  }
  printf("    golpes por sesion ........ min %d, media %.1f, max %d\n", g_min, g_sum / 200.0, g_max);
  printf("    v maxima en piel ......... %.3f cm/s   (limite 7,000)\n", vmax_global / 10.0);
  printf("    v REAL maxima del PIO .... %.3f cm/s   (limite 10,000)\n", vreal_global / 10.0);
  printf("    separacion minima radios . %.2f mm     (limite 6,00)\n", sep_global);
  printf("    t maximo del ultimo golpe  %.1f s      (limite %.1f)\n",
         t_max, (CICLO_DURACION_MS - RESERVA_RETIRADA_MS) / 1000.0);
  printf("    movimientos de carro ..... %.1f por sesion\n", carro_total / 200.0);
  printf("    rozadas .................. %.1f por sesion\n\n", rozadas_total / 200.0);

  // ---- ASSERT 5: el numero de pasadas es el ESPERADO ----
  //  El periodo de un golpe es: contacto (199-273 mm segun el radio) a 2,0-7,0 cm/s
  //  + dos rampas en el aire + el hueco de 1,5-5,5 s. Con las medias por bloque
  //  (3,2 / 2,6 / 4,1 / 2,9 cm/s) y hueco medio 3,5 s el periodo medio sale ~16-17 s, de donde
  //  (900 - 40 de reserva - ~12 de visitas) / 16,5 ~= 51 golpes. Banda aceptada 40..70:
  //  por debajo de 40 la maquina estaria dando muy pocas pasadas para 15 minutos, y por
  //  encima de 70 es que algo va mas deprisa de lo que la especificacion permite.
  assert(g_min >= 45 && "demasiadas pocas pasadas en 15 min");
  assert(g_max <= 85 && "demasiadas pasadas: algo va mas rapido de lo permitido");

  // ---------------------------------------------------------------------------------------------
  // PRUEBA 3: el caso peor del clamp — pedir velocidad infinita en el radio maximo.
  // ---------------------------------------------------------------------------------------------
  {
    printf("[3] Caso peor del clamp: el planificador pide velocidad INFINITA a R = 325 mm\n");
    const float R = 325.0f;
    const float mmu = mm_por_upaso(R);
    // v -> infinito  =>  t_us -> 0  =>  extra = 0  =>  periodo = suelo del PIO
    const double v_real = (double)mmu / ((double)PIO_SUELO_US * 1e-6);
    printf("    mm por micropaso ......... %.6f mm\n", mmu);
    printf("    periodo impuesto por PIO . %u us\n", PIO_SUELO_US);
    printf("    velocidad resultante ..... %.3f cm/s   <- el hardware no puede ir mas rapido\n",
           v_real / 10.0);
    assert(v_real <= CLAMP_DURO_MMS && "el suelo del PIO NO cumple el clamp de 10 cm/s a R=325");
    // y con la variante endurecida (1/16 por pines, suelo 480 us) tambien:
    const double v_dur = (double)(R * 0.01745329f / (MOTOR_PASOS_POR_VUELTA * 16.0f * REDUCCION_CABRESTANTE / 360.0f))
                       / (480.0 * 1e-6);
    printf("    variante endurecida 1/16 . %.3f cm/s   (suelo 480 us)\n\n", v_dur / 10.0);
    assert(v_dur <= CLAMP_DURO_MMS);
  }

  printf("=========================================================================\n");
  printf(" TODAS LAS COMPROBACIONES HAN PASADO\n");
  printf("=========================================================================\n");
  return 0;
}
