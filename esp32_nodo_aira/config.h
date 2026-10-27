#pragma once

// =============================================================================
// CONFIGURACION DE HARDWARE Y PARAMETROS METODOLOGICOS DEL NODO ESP32 (AIRA)
// Basado en main.tex (Secciones 6.5 y 6.7) y conexiado validado de esp32_prueba
// =============================================================================

// 154 = 1,54 pulgadas (240x240); 190 = 1,9 pulgadas (170x320).
#ifndef DISPLAY_VARIANT
#define DISPLAY_VARIANT 154
#endif

// Identificacion y trazabilidad de reglas (RF-12)
#define FIRMWARE_VERSION "v1.0.8"
#define VERSION_REGLAS   "reglas-2026.1"

// MODO DE PRUEBA RAPIDA:
//   0 = Operacion oficial segun main.tex: muestreo cada 10 s (N=30), ventana de 5 min (300 s), n_min=24 (80 %)
//   1 = Prueba rapida de laboratorio: muestreo cada 2 s (N=6), ventana cada 12 s, n_min=5
#ifndef MODO_PRUEBA_RAPIDA
#define MODO_PRUEBA_RAPIDA 0
#endif

#if MODO_PRUEBA_RAPIDA == 1
constexpr unsigned long SAMPLE_INTERVAL_MS  = 2000UL;
constexpr unsigned long WINDOW_DURATION_MS  = 12000UL;
constexpr int           WINDOW_MAX_SAMPLES  = 6;
constexpr int           WINDOW_MIN_VALID    = 5;
#else
constexpr unsigned long SAMPLE_INTERVAL_MS  = 10000UL;   // T_s = 10 s (Eq. 6.1)
constexpr unsigned long WINDOW_DURATION_MS  = 300000UL;  // T_w = 5 min = 300 s
constexpr int           WINDOW_MAX_SAMPLES  = 30;        // N = 300 / 10 = 30 muestras
constexpr int           WINDOW_MIN_VALID    = 24;        // n_min = 0.8 * N = 24 muestras (Eq. 6.2)
#endif

// Temporizadores no bloqueantes del ciclo principal (Seccion 6.7.1)
constexpr unsigned long DISPLAY_REFRESH_MS  = 5000UL;    // Refresco de pantalla TFT cada 5 s
constexpr unsigned long NTP_SYNC_INTERVAL_MS = 3600000UL;// Resincronizacion NTP cada 1 hora (RF-11)
constexpr unsigned long SENSOR_STALE_MS     = 30000UL;   // Antiguedad maxima de lectura cruda

// Parametros de la FSM de Conectividad y Resiliencia (Seccion 6.7.2)
constexpr unsigned long WIFI_BACKOFF_MIN_MS = 2000UL;    // Backoff inicial: 2 s
constexpr unsigned long WIFI_BACKOFF_MAX_MS = 30000UL;   // Backoff maximo: 30 s
constexpr int           WIFI_MAX_RETRIES    = 5;         // Maximo 5 intentos antes de DEGRADED_BUFFER
constexpr unsigned long DEGRADED_RETRY_MS   = 60000UL;   // Reintento de reconexion cada 60 s en modo degradado
constexpr unsigned long MQTT_ACK_TIMEOUT_MS = 15000UL;   // Timeout de espera de PUBACK QoS 1

// Buffer circular persistente en LittleFS (RF-09, RNF-02)
// Capacidad >= 12 ventanas de 5 min (60 min); se reservan 24 ranuras (2 horas)
constexpr int           BUFFER_CAPACITY     = 24;

// Servidor NTP institucional / global (RF-11)
#define NTP_SERVER_1 "ntp.shoa.cl"
#define NTP_SERVER_2 "pool.ntp.org"
#define NTP_SERVER_3 "time.google.com"

// Tipos compartidos para evitar errores de auto-prototipado del preprocesador Arduino
enum FsmState {
  INIT_SYS = 0,
  CONNECTING_WIFI,
  NTP_SYNC,
  MQTT_STREAMING,
  DEGRADED_BUFFER
};

struct WindowEvaluation {
  bool hasWindow = false;
  bool horaVerificada = false;
  String timestampIso = "";
  uint32_t ordenRegistro = 0;
  String ventanaInicioIso = "";
  String ventanaFinRealIso = "";
  String ventanaAnteriorId = "";
  bool persistenciaConfirmada = false;
  String motivoPersistencia = "sin_ventana_anterior";
  String causasConfirmadas[5];
  int numCausasConfirmadas = 0;
  uint16_t sinLecturaScd = 0;
  uint16_t sinLecturaPms = 0;
  uint16_t fueraRangoScd = 0;
  uint16_t fueraRangoCo2 = 0;
  uint16_t fueraRangoTemp = 0;
  uint16_t fueraRangoRh = 0;
  uint32_t tramasPmsInvalidas = 0;
  uint32_t lecturasScdFallidas = 0;

  bool validCo2 = false;
  bool validPm25 = false;
  bool validPm10 = false;
  bool validTemp = false;
  bool validRh = false;

  float meanCo2 = 0.0f;
  float meanPm25 = 0.0f;
  float meanPm10 = 0.0f;
  float meanTemp = 0.0f;
  float meanRh = 0.0f;

  int nCo2 = 0;
  int nPm25 = 0;
  int nPm10 = 0;
  int nTemp = 0;
  int nRh = 0;

  int sCo2 = -1;
  int sPm25 = -1;
  int sPm10 = -1;
  int sTemp = -1;
  int sRh = -1;

  int icaiScore = -1;
  String icaiCategoria = "";
  String icaiEstado = "dato_insuficiente";
  String causasICAI[3];
  int numCausasICAI = 0;

  int ictScore = -1;
  String ictCategoria = "";
  String ictEstado = "dato_insuficiente";
  String causasICT[2];
  int numCausasICT = 0;

  int icgScore = -1;
  String icgCategoria = "";
  String icgEstado = "dato_insuficiente";
  String causasICG[5];
  int numCausasICG = 0;

  String celdaMatriz = "";
  String recomendaciones[6];
  int numRecomendaciones = 0;
};

