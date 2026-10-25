// =============================================================================
// FIRMWARE NODO DE MONITOREO AMBIENTAL AIRA (ESP32 + PMS5003 + SCD40 + ST7789)
// Proyecto abierto de monitoreo ambiental
//
// Implementa fielmente la especificacion de main.tex (Secciones 6.5 y 6.7):
//   1. Capa HAL reutilizando el conexionado fisico validado de esp32_prueba:
//      - PMS5003 en UART2 (RX=16, TX=17, 9600 bps, checksum de 32 bytes, CF atm).
//      - SCD40 en I2C (SDA=21, SCL=22, addr 0x62, 100 kHz, CRC-8 0x31).
//      - Pantalla TFT ST7789 en SPI (SCK=18, MOSI=23, RST=25, DC=26, CS=27).
//   2. Motor de Procesamiento Metrologico Local (Seccion 6.5, RF-01, RF-12):
//      - Muestreo cada 10 s (N=30 por ventana de 5 min), completitud >= 24 (80%).
//      - Calculo local de ICAI, ICT e ICG, Matriz 5x5 ('O', 'A1'..'A4',
//        'T1'..'T4', 'M1'..'M4'), conjuntos causales con empates y recomendaciones
//        con escalamiento por persistencia de K=2 ventanas consecutivas.
//   3. Maquina de Estados Finitos (FSM) de 6 estados (Seccion 6.7.2):
//      - INIT_SYS -> CONNECTING_WIFI -> NTP_SYNC ->
//        MQTT_STREAMING <-> DEGRADED_BUFFER.
//      - Sincronizacion horaria UTC via NTP cada 1 h (RF-11) con redondeo de fin
//        de ventana a multiplos exactos de 5 minutos para el trigger SQL.
//      - Resiliencia offline en LittleFS (buffer circular persistente >= 12
//        ventanas) y retransmision ordenada con confirmacion PUBACK QoS 1 (RF-09).
// =============================================================================

#include <Arduino.h>
#include <WiFi.h>
#include <Preferences.h>
#include <LittleFS.h>
#include <Wire.h>
#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7789.h>
#include <mqtt_client.h>
#include <time.h>
#include <math.h>

#include "config.h"
#include "secrets.h"

#if DISPLAY_VARIANT != 154 && DISPLAY_VARIANT != 190
#error "DISPLAY_VARIANT debe ser 154 o 190"
#endif

// -----------------------------------------------------------------------------
// 1. DEFINICION DE PINES (CONEXIONADO FISICO VERIFICADO DE esp32_prueba)
// -----------------------------------------------------------------------------
// El ESP32 recibe 5,0 V regulados en el pin fisico 5V/VIN verificado.
// PMS5003 recibe otra rama de la misma barra de 5 V. Todos comparten GND.
// SCD40 y TFT reciben 3,3 V de una fuente cuya capacidad fue verificada.
constexpr int PMS_RX_ESP = 16;  // PMS TXD pin 5 -> ESP GPIO16/RX2
constexpr int PMS_TX_ESP = 17;  // ESP GPIO17/TX2 -> PMS RXD pin 4
constexpr int SCD_SDA    = 21;
constexpr int SCD_SCL    = 22;
constexpr int TFT_SCK    = 18;
constexpr int TFT_MOSI   = 23;
constexpr int TFT_RST    = 25;
constexpr int TFT_DC     = 26;
constexpr int TFT_CS     = 27;
constexpr uint8_t SCD_ADDR = 0x62;

Adafruit_ST7789 tft(TFT_CS, TFT_DC, TFT_RST);
Preferences prefs;

// -----------------------------------------------------------------------------
// 2. ESTRUCTURAS DE DATOS Y ESTADOS DE LA FSM
// -----------------------------------------------------------------------------
const char* fsmStateName(FsmState s) {
  switch (s) {
    case INIT_SYS:        return "INIT_SYS";
    case CONNECTING_WIFI: return "WIFI_CONN";
    case NTP_SYNC:        return "NTP_SYNC";
    case MQTT_STREAMING:  return "ONLINE";
    case DEGRADED_BUFFER: return "BUFFER_FS";
    default:              return "UNKNOWN";
  }
}

FsmState fsmState = INIT_SYS;

// Configuracion cargada desde NVS (con respaldo en secrets.h)
struct NodeConfig {
  String wifiSsid;
  String wifiPass;
  String nodoId;
  String salaId;
  String mqttUri;
  String mqttToken;
} cfg;

// Lecturas instantaneas de los sensores (actualizadas de forma continua)
struct PmsData {
  bool valid = false;
  uint16_t pm1 = 0;
  uint16_t pm25 = 0;
  uint16_t pm10 = 0;
  unsigned long atMs = 0;
} pms;

struct ScdData {
  bool valid = false;
  uint16_t co2 = 0;
  float tempC = 0.0f;
  float rh = 0.0f;
  unsigned long atMs = 0;
} scd;

// Acumulador de muestras validas de la ventana activa de 5 minutos (Seccion 6.5.2)
struct WindowAccumulator {
  double sumCo2 = 0.0;
  double sumPm25 = 0.0;
  double sumPm10 = 0.0;
  double sumTemp = 0.0;
  double sumRh = 0.0;
  int nCo2 = 0;
  int nPm25 = 0;
  int nPm10 = 0;
  int nTemp = 0;
  int nRh = 0;
  int totalTicks = 0;

  void reset() {
    sumCo2 = sumPm25 = sumPm10 = sumTemp = sumRh = 0.0;
    nCo2 = nPm25 = nPm10 = nTemp = nRh = 0;
    totalTicks = 0;
  }
} winAcc;

// Resultado calculado para la ultima ventana de 5 minutos (definido en config.h)
WindowEvaluation lastEval;

// Memoria de la ventana inmediatamente anterior para persistencia K=2 (Tabla 6.7)
struct PreviousWindowState {
  bool validCompleto = false;
  int icgScore = -1;
  String causasICG[5];
  int numCausasICG = 0;
} prevWin;

// Estado de tiempos, errores y buffer circular LittleFS
bool scdRunning = false;
uint8_t pmsFrame[32];
uint8_t pmsIndex = 0;
unsigned long pmsChecksumErrors = 0;
unsigned long scdReadErrors = 0;

unsigned long lastScdPollMs      = 0;
unsigned long lastScdRetryMs     = 0;
unsigned long lastSampleTickMs   = 0;
unsigned long lastWindowCloseMs  = 0;
unsigned long lastDisplayMs      = 0;
unsigned long lastNtpSyncMs      = 0;

// Variables de conectividad Wi-Fi / Backoff exponencial
int wifiRetryCount               = 0;
unsigned long wifiBackoffMs      = WIFI_BACKOFF_MIN_MS;
unsigned long lastWifiAttemptMs  = 0;
unsigned long lastDegradedTryMs  = 0;

// Estado de sincronizacion NTP
bool ntpSynced                   = false;

// Estado del cliente MQTTS / WSS (ESP-IDF esp_mqtt_client)
esp_mqtt_client_handle_t mqttClient = nullptr;
volatile bool mqttConnected      = false;
volatile int  pendingMsgId       = -1;
volatile bool pendingAckReceived = false;
unsigned long pendingPublishAtMs = 0;
bool pendingFromBuffer           = false;

// Metadatos del buffer circular en LittleFS y secuencia monotonica en NVS
bool littleFsReady               = false;
uint32_t seqOrdenRegistro        = 0;
uint32_t ventanasDescartadas     = 0;
uint32_t duplicadosObservados    = 0;
int bufHead                      = 0; // Indice de la ventana mas antigua
int bufTail                      = 0; // Indice de la siguiente escritura
int bufCount                     = 0; // Cantidad de ventanas retenidas

// -----------------------------------------------------------------------------
// 3. UTILIDADES DE CODIFICACION Y VALIDACION FISICA
// -----------------------------------------------------------------------------
bool fresh(unsigned long atMs, unsigned long now) {
  return static_cast<unsigned long>(now - atMs) < SENSOR_STALE_MS;
}

uint16_t wordBE(const uint8_t *p) {
  return (static_cast<uint16_t>(p[0]) << 8) | p[1];
}

// Categorias operacionales uniformes (Tabla 6.3 de main.tex y CHECK SQL de 01_schema.sql)
// Nota: En la base de datos SQL las categorias se almacenan sin tilde ('Optimo', etc.)
const char* severityCategorySql(int score) {
  switch (score) {
    case 0: return "Optimo";
    case 1: return "Precaucion";
    case 2: return "Deficiente";
    case 3: return "Malo";
    case 4: return "Critico";
    default: return "";
  }
}

String jsonEscape(const String &s) {
  String out;
  out.reserve(s.length() + 8);
  for (size_t i = 0; i < s.length(); ++i) {
    char c = s[i];
    if (c == '\"') out += "\\\"";
    else if (c == '\\') out += "\\\\";
    else if (c == '\n') out += "\\n";
    else if (c == '\r') out += "\\r";
    else out += c;
  }
  return out;
}

// -----------------------------------------------------------------------------
// 4. CAPA HAL: SENSORES PMS5003 (UART2) Y SCD40 (I2C)
//    Reutiliza integramente las rutinas verificadas en esp32_prueba.ino
// -----------------------------------------------------------------------------
void acceptPmsFrame() {
  if (pmsFrame[2] != 0x00 || pmsFrame[3] != 0x1C) return;
  uint16_t checksum = 0;
  for (int i = 0; i < 30; ++i) checksum += pmsFrame[i];
  if (checksum != wordBE(&pmsFrame[30])) {
    ++pmsChecksumErrors;
    return;
  }
  // Campos "atmospheric environment"; no los valores CF=1.
  uint16_t pm1  = wordBE(&pmsFrame[10]);
  uint16_t pm25 = wordBE(&pmsFrame[12]);
  uint16_t pm10 = wordBE(&pmsFrame[14]);

  // Validacion de rango fisico
  if (pm25 <= 2000 && pm10 <= 3000) {
    pms.pm1   = pm1;
    pms.pm25  = pm25;
    pms.pm10  = pm10;
    pms.atMs  = millis();
    pms.valid = true;
  }
}

void pollPms() {
  while (Serial2.available()) {
    uint8_t b = static_cast<uint8_t>(Serial2.read());
    if (pmsIndex == 0) {
      if (b == 0x42) pmsFrame[pmsIndex++] = b;
    } else if (pmsIndex == 1) {
      if (b == 0x4D) {
        pmsFrame[pmsIndex++] = b;
      } else {
        pmsIndex = 0;
        if (b == 0x42) pmsFrame[pmsIndex++] = b;
      }
    } else {
      pmsFrame[pmsIndex++] = b;
      if (pmsIndex == sizeof(pmsFrame)) {
        acceptPmsFrame();
        pmsIndex = 0;
      }
    }
  }
}

uint8_t scdCrc(const uint8_t *data, size_t len) {
  uint8_t crc = 0xFF;
  for (size_t i = 0; i < len; ++i) {
    crc ^= data[i];
    for (uint8_t bit = 0; bit < 8; ++bit) {
      crc = (crc & 0x80) ? static_cast<uint8_t>((crc << 1) ^ 0x31)
                         : static_cast<uint8_t>(crc << 1);
    }
  }
  return crc;
}

bool scdCommand(uint16_t command) {
  Wire.beginTransmission(SCD_ADDR);
  Wire.write(static_cast<uint8_t>(command >> 8));
  Wire.write(static_cast<uint8_t>(command));
  return Wire.endTransmission() == 0;
}

bool scdReadBytes(uint8_t *out, size_t n) {
  if (Wire.requestFrom(static_cast<uint8_t>(SCD_ADDR), static_cast<uint8_t>(n)) != n) {
    while (Wire.available()) Wire.read();
    return false;
  }
  for (size_t i = 0; i < n; ++i) out[i] = static_cast<uint8_t>(Wire.read());
  for (size_t i = 0; i < n; i += 3) {
    if (scdCrc(&out[i], 2) != out[i + 2]) return false;
  }
  return true;
}

void startScd() {
  // Recupera un SCD40 que siga midiendo tras reiniciar solo el ESP32.
  scdCommand(0x3F86);  // stop_periodic_measurement
  delay(500);
  scdRunning = scdCommand(0x21B1);  // start_periodic_measurement
  lastScdRetryMs = millis();
  Serial.println(scdRunning ? "[HAL] SCD40: modo periodico iniciado" : "[HAL] SCD40: no responde");
}

void pollScd(unsigned long now) {
  if (!scdRunning) {
    if (now - lastScdRetryMs >= 10000UL) startScd();
    return;
  }
  if (now - lastScdPollMs < 1000UL) return;
  lastScdPollMs = now;
  if (!scdCommand(0xE4B8)) {
    ++scdReadErrors;
    scdRunning = false;
    lastScdRetryMs = now;
    return;
  }
  delay(2);  // ficha: 1 ms maximo para get_data_ready_status
  uint8_t status[3];
  if (!scdReadBytes(status, sizeof(status))) {
    ++scdReadErrors;
    return;
  }
  if ((wordBE(status) & 0x07FF) == 0) return;
  if (!scdCommand(0xEC05)) {
    ++scdReadErrors;
    return;
  }
  delay(2);  // ficha: 1 ms maximo para read_measurement
  uint8_t data[9];
  if (!scdReadBytes(data, sizeof(data))) {
    ++scdReadErrors;
    return;
  }
  uint16_t rawCo2 = wordBE(&data[0]);
  float tempC     = -45.0f + 175.0f * wordBE(&data[3]) / 65535.0f;
  float rh        = 100.0f * wordBE(&data[6]) / 65535.0f;

  // Controles de rango fisico (Seccion 6.5.2 y CHECK SQL)
  if (rawCo2 > 0 && rawCo2 <= 40000 && tempC >= -20.0f && tempC <= 60.0f && rh >= 0.0f && rh <= 100.0f) {
    scd.co2   = rawCo2;
    scd.tempC = tempC;
    scd.rh    = rh;
    scd.atMs  = millis();
    scd.valid = true;
  }
}

// -----------------------------------------------------------------------------
// 5. MOTOR DE PROCESAMIENTO METROLOGICO E INDICES AMBIENTALES (SECCION 6.5)
// -----------------------------------------------------------------------------

// Tabla 6.4: Bandas operacionales propuestas para CO2 (ppm)
int calcSeverityCo2(float co2) {
  if (co2 < 800.0f)  return 0;
  if (co2 < 1000.0f) return 1;
  if (co2 < 1500.0f) return 2;
  if (co2 < 2000.0f) return 3;
  return 4;
}

// Ecuaciones (6.4)-(6.5) y Tabla 6.5: Material particulado (G_PM2.5=15, G_PM10=45)
int calcSeverityPm(float c5m, float gRef) {
  float r = c5m / gRef;
  if (r < 0.5f) return 0;
  if (r < 1.0f) return 1;
  if (r < 2.0f) return 2;
  if (r < 4.0f) return 3;
  return 4;
}

// Ecuaciones (6.8)-(6.9) y Tabla 6.6: Temperatura del aire (banda 20-24 C)
int calcSeverityTemp(float ta) {
  float dt = 0.0f;
  if (20.0f - ta > dt) dt = 20.0f - ta;
  if (ta - 24.0f > dt) dt = ta - 24.0f;
  if (dt <= 0.0f) return 0;
  if (dt <= 2.0f) return 1;
  if (dt <= 4.0f) return 2;
  if (dt <= 6.0f) return 3;
  return 4;
}

// Ecuaciones (6.10)-(6.11) y Tabla 6.7: Humedad relativa (banda 30-60 %)
int calcSeverityRh(float rh) {
  float drh = 0.0f;
  if (30.0f - rh > drh) drh = 30.0f - rh;
  if (rh - 60.0f > drh) drh = rh - 60.0f;
  if (drh <= 0.0f)  return 0;
  if (drh <= 10.0f) return 1;
  if (drh <= 20.0f) return 2;
  if (drh <= 30.0f) return 3;
  return 4;
}

// Tabla 6.8: Matriz diagnostica operacional del ICG (5x5)
String calcMatrixCell(int sAire, int sTermico) {
  if (sAire == 0 && sTermico == 0) return "O";
  int sGlobal = (sAire > sTermico) ? sAire : sTermico;
  if (sAire > sTermico)  return "A" + String(sGlobal);
  if (sTermico > sAire)  return "T" + String(sGlobal);
  return "M" + String(sGlobal);
}

// Muestreo cada 10 segundos (Eq. 6.1)
void sampleSensorsTick(unsigned long now) {
  if (now - lastSampleTickMs < SAMPLE_INTERVAL_MS) return;
  lastSampleTickMs = now;
  winAcc.totalTicks++;

  if (scd.valid && fresh(scd.atMs, now)) {
    if (scd.co2 >= 0 && scd.co2 <= 40000) {
      winAcc.sumCo2 += scd.co2;
      winAcc.nCo2++;
    }
    if (scd.tempC >= -20.0f && scd.tempC <= 60.0f) {
      winAcc.sumTemp += scd.tempC;
      winAcc.nTemp++;
    }
    if (scd.rh >= 0.0f && scd.rh <= 100.0f) {
      winAcc.sumRh += scd.rh;
      winAcc.nRh++;
    }
  }

  if (pms.valid && fresh(pms.atMs, now)) {
    winAcc.sumPm25 += pms.pm25;
    winAcc.nPm25++;
    winAcc.sumPm10 += pms.pm10;
    winAcc.nPm10++;
  }
}

// Obtiene marca de tiempo UTC verificada por NTP y redondeada al borde de 5 minutos
// para cumplir con el trigger SQL `trg_confirmar_aviso_ambiental` (INTERVAL '5 minutes')
bool getVerifiedWindowIsoTimestamp(String &outIso) {
  if (!ntpSynced) return false;
  time_t nowEpoch = time(nullptr);
  if (nowEpoch < 1700000000L) { // Anterior a Nov 2023 -> reloj RTC aun no valido
    ntpSynced = false;
    return false;
  }
#if MODO_PRUEBA_RAPIDA == 0
  // Alineacion al multiplo de 300 s (5 minutos) mas cercano
  time_t aligned = ((nowEpoch + 150) / 300) * 300;
#else
  time_t aligned = nowEpoch;
#endif
  struct tm timeinfo;
  gmtime_r(&aligned, &timeinfo);
  char buf[32];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &timeinfo);
  outIso = String(buf);
  return true;
}

void addUniqueRecommendation(WindowEvaluation &ev, const String &msg) {
  if (msg.length() == 0 || ev.numRecomendaciones >= 6) return;
  for (int i = 0; i < ev.numRecomendaciones; ++i) {
    if (ev.recomendaciones[i] == msg) return;
  }
  ev.recomendaciones[ev.numRecomendaciones++] = msg;
}

bool causeInPrevWindow(const String &cause) {
  if (!prevWin.validCompleto || prevWin.icgScore < 3) return false;
  for (int i = 0; i < prevWin.numCausasICG; ++i) {
    if (prevWin.causasICG[i] == cause) return true;
  }
  return false;
}

// Evalua la ventana de 5 minutos conforme a la Seccion 6.5 de main.tex
WindowEvaluation evaluateCurrentWindow() {
  WindowEvaluation ev;
  ev.hasWindow = true;

  // Incrementar secuencia monotonica persistente en NVS (para ordenRegistro)
  seqOrdenRegistro++;
  prefs.putUInt("seq_order", seqOrdenRegistro);
  ev.ordenRegistro = seqOrdenRegistro;

  // Verificar hora UTC via NTP
  ev.horaVerificada = getVerifiedWindowIsoTimestamp(ev.timestampIso);

  // Conteos validos por serie
  ev.nCo2  = winAcc.nCo2;
  ev.nPm25 = winAcc.nPm25;
  ev.nPm10 = winAcc.nPm10;
  ev.nTemp = winAcc.nTemp;
  ev.nRh   = winAcc.nRh;

  // Regla del 80% de completitud (Eq. 6.2 y 6.3: n >= WINDOW_MIN_VALID = 24)
  if (ev.nCo2 >= WINDOW_MIN_VALID) {
    ev.validCo2 = true;
    ev.meanCo2  = static_cast<float>(winAcc.sumCo2 / ev.nCo2);
    ev.sCo2     = calcSeverityCo2(ev.meanCo2);
  }
  if (ev.nPm25 >= WINDOW_MIN_VALID) {
    ev.validPm25 = true;
    ev.meanPm25  = static_cast<float>(winAcc.sumPm25 / ev.nPm25);
    ev.sPm25     = calcSeverityPm(ev.meanPm25, 15.0f);
  }
  if (ev.nPm10 >= WINDOW_MIN_VALID) {
    ev.validPm10 = true;
    ev.meanPm10  = static_cast<float>(winAcc.sumPm10 / ev.nPm10);
    ev.sPm10     = calcSeverityPm(ev.meanPm10, 45.0f);
  }
  if (ev.nTemp >= WINDOW_MIN_VALID) {
    ev.validTemp = true;
    ev.meanTemp  = static_cast<float>(winAcc.sumTemp / ev.nTemp);
    ev.sTemp     = calcSeverityTemp(ev.meanTemp);
  }
  if (ev.nRh >= WINDOW_MIN_VALID) {
    ev.validRh = true;
    ev.meanRh  = static_cast<float>(winAcc.sumRh / ev.nRh);
    ev.sRh     = calcSeverityRh(ev.meanRh);
  }

  // ---------------------------------------------------------------------------
  // Dominio 1: ICAI (Subseccion 6.5.3, Ecuaciones 6.6 y 6.7)
  // ---------------------------------------------------------------------------
  int validAirCount = (ev.validCo2 ? 1 : 0) + (ev.validPm25 ? 1 : 0) + (ev.validPm10 ? 1 : 0);
  if (validAirCount == 0) {
    ev.icaiEstado    = "dato_insuficiente";
    ev.icaiScore     = -1;
    ev.icaiCategoria = "";
  } else {
    ev.icaiEstado = (validAirCount == 3) ? "completo" : "parcial";
    int maxAir = -1;
    if (ev.validCo2  && ev.sCo2  > maxAir) maxAir = ev.sCo2;
    if (ev.validPm25 && ev.sPm25 > maxAir) maxAir = ev.sPm25;
    if (ev.validPm10 && ev.sPm10 > maxAir) maxAir = ev.sPm10;
    ev.icaiScore     = maxAir;
    ev.icaiCategoria = severityCategorySql(maxAir);

    // Conservar todas las causas que empatan en el maximo (cuando maxAir > 0)
    if (maxAir > 0) {
      if (ev.validCo2  && ev.sCo2  == maxAir) ev.causasICAI[ev.numCausasICAI++] = "CO2";
      if (ev.validPm25 && ev.sPm25 == maxAir) ev.causasICAI[ev.numCausasICAI++] = "PM2.5";
      if (ev.validPm10 && ev.sPm10 == maxAir) ev.causasICAI[ev.numCausasICAI++] = "PM10";
    }
  }

  // ---------------------------------------------------------------------------
  // Dominio 2: ICT (Subseccion 6.5.4, Ecuaciones 6.12 y 6.13)
  // ---------------------------------------------------------------------------
  int validThermCount = (ev.validTemp ? 1 : 0) + (ev.validRh ? 1 : 0);
  if (validThermCount == 0) {
    ev.ictEstado    = "dato_insuficiente";
    ev.ictScore     = -1;
    ev.ictCategoria = "";
  } else {
    ev.ictEstado = (validThermCount == 2) ? "completo" : "parcial";
    int maxTherm = -1;
    if (ev.validTemp && ev.sTemp > maxTherm) maxTherm = ev.sTemp;
    if (ev.validRh   && ev.sRh   > maxTherm) maxTherm = ev.sRh;
    ev.ictScore     = maxTherm;
    ev.ictCategoria = severityCategorySql(maxTherm);

    if (maxTherm > 0) {
      if (ev.validTemp && ev.sTemp == maxTherm) ev.causasICT[ev.numCausasICT++] = "Temperatura";
      if (ev.validRh   && ev.sRh   == maxTherm) ev.causasICT[ev.numCausasICT++] = "Humedad";
    }
  }

  // ---------------------------------------------------------------------------
  // Dominio Global: ICG, Matriz 5x5 y Recomendaciones (Subseccion 6.5.5)
  // Ecuacion (6.17):
  //   - Ambos dominios validos ('completo'): ICG = max(S_aire, S_termico)
  //   - Un dominio valido o parcial: 'parcial'
  //   - Ningun dominio con datos: 'dato_insuficiente'
  // ---------------------------------------------------------------------------
  if (ev.icaiEstado == "completo" && ev.ictEstado == "completo") {
    ev.icgEstado    = "completo";
    ev.icgScore     = (ev.icaiScore > ev.ictScore) ? ev.icaiScore : ev.ictScore;
    ev.icgCategoria = severityCategorySql(ev.icgScore);
    ev.celdaMatriz  = calcMatrixCell(ev.icaiScore, ev.ictScore);

    if (ev.icgScore > 0) {
      if (ev.icaiScore == ev.icgScore) {
        for (int i = 0; i < ev.numCausasICAI; ++i) {
          ev.causasICG[ev.numCausasICG++] = ev.causasICAI[i];
        }
      }
      if (ev.ictScore == ev.icgScore) {
        for (int i = 0; i < ev.numCausasICT; ++i) {
          ev.causasICG[ev.numCausasICG++] = ev.causasICT[i];
        }
      }

      // Generacion de mensajes breves segun Tablas 6.9 y 6.10 de main.tex
      bool persistedCause = false;
      for (int i = 0; i < ev.numCausasICG; ++i) {
        String c = ev.causasICG[i];
        if (ev.icgScore >= 3 && causeInPrevWindow(c)) {
          persistedCause = true;
        }
        if (c == "CO2") {
          addUniqueRecommendation(ev, ev.icgScore == 1
            ? "Considere mejorar la ventilación."
            : "Revise la ventilación de la sala.");
        } else if (c == "PM2.5" || c == "PM10") {
          addUniqueRecommendation(ev, ev.icgScore == 1
            ? "Observe si hay polvo o humo."
            : "Revise si hay polvo o humo.");
        } else if (c == "Temperatura") {
          if (ev.meanTemp < 20.0f) {
            addUniqueRecommendation(ev, ev.icgScore == 1
              ? "Observe si la sala sigue fría."
              : "Sala fría. Revise la calefacción.");
          } else {
            addUniqueRecommendation(ev, ev.icgScore == 1
              ? "Observe si la sala sigue calurosa."
              : "Sala calurosa. Revise la climatización.");
          }
        } else if (c == "Humedad") {
          if (ev.meanRh < 30.0f) {
            addUniqueRecommendation(ev, ev.icgScore == 1
              ? "Observe si el aire sigue seco."
              : "Aire seco. Solicite revisar la humedad.");
          } else {
            addUniqueRecommendation(ev, ev.icgScore == 1
              ? "Observe si persiste la humedad."
              : "Humedad alta. Revise posibles fuentes de humedad.");
          }
        }
      }

      // Cautela instrumental cuando PM10 es la unica causa de un nivel alto (Seccion 6.5.5.4)
      if (ev.icgScore >= 2 && ev.numCausasICG == 1 && ev.causasICG[0] == "PM10") {
        addUniqueRecommendation(ev, "Verifique la lectura de PM10 antes de adoptar medidas de control.");
      }

      // Escalamiento tras dos ventanas validas consecutivas (K=2) con nivel >= 3 y misma causa (Tabla 6.9)
      if (ev.icgScore == 3 && persistedCause) {
        addUniqueRecommendation(ev, "Si continúa, avise al encargado.");
      } else if (ev.icgScore == 4 && persistedCause) {
        addUniqueRecommendation(ev, "Avise al encargado para una revisión prioritaria.");
      }
    }

    // Actualizar memoria de persistencia K=2 para la siguiente ventana
    prevWin.validCompleto = true;
    prevWin.icgScore      = ev.icgScore;
    prevWin.numCausasICG  = ev.numCausasICG;
    for (int i = 0; i < ev.numCausasICG; ++i) {
      prevWin.causasICG[i] = ev.causasICG[i];
    }
  } else if (ev.icaiEstado != "dato_insuficiente" || ev.ictEstado != "dato_insuficiente") {
    // Estado parcial: no se publica una severidad global comparable con un ICG completo (Eq. 6.17)
    ev.icgEstado    = "parcial";
    ev.icgScore     = -1;
    ev.icgCategoria = "";
    ev.celdaMatriz  = "";
    addUniqueRecommendation(ev, "Falta información para una recomendación global.");
    prevWin.validCompleto = false;
  } else {
    // Ningun dominio valido
    ev.icgEstado    = "dato_insuficiente";
    ev.icgScore     = -1;
    ev.icgCategoria = "";
    ev.celdaMatriz  = "";
    prevWin.validCompleto = false;
  }

  return ev;
}

// Serializa el paquete JSON exactamente con el esquema esperado por `TelemetryPacket` en api/main.py
String buildTelemetryJson(const WindowEvaluation &ev, bool esRetransmision) {
  String p;
  p.reserve(1024);
  p += "{";
  p += "\"nodoId\":\"" + jsonEscape(cfg.nodoId) + "\",";
  p += "\"salaId\":\"" + jsonEscape(cfg.salaId) + "\",";
  p += "\"horaVerificada\":" + String(ev.horaVerificada ? "true" : "false") + ",";
  if (ev.horaVerificada && ev.timestampIso.length() > 0) {
    p += "\"timestamp\":\"" + ev.timestampIso + "\",";
  } else {
    p += "\"timestamp\":null,";
  }
  p += "\"ordenRegistro\":" + String(ev.ordenRegistro) + ",";
  p += "\"conteosValidos\":{";
  p += "\"co2\":" + String(ev.nCo2) + ",";
  p += "\"pm25\":" + String(ev.nPm25) + ",";
  p += "\"pm10\":" + String(ev.nPm10) + ",";
  p += "\"temperatura\":" + String(ev.nTemp) + ",";
  p += "\"humedad\":" + String(ev.nRh);
  p += "},";
  p += "\"versionReglas\":\"" + String(VERSION_REGLAS) + "\",";
  p += "\"ventanasDescartadas\":" + String(ventanasDescartadas) + ",";
  p += "\"esRetransmision\":" + String(esRetransmision ? "true" : "false") + ",";

  // Medias fisicas de 5 minutos (null si n < 24)
  p += "\"co2\":" + (ev.validCo2 ? String(ev.meanCo2, 2) : String("null")) + ",";
  p += "\"pm25\":" + (ev.validPm25 ? String(ev.meanPm25, 2) : String("null")) + ",";
  p += "\"pm10\":" + (ev.validPm10 ? String(ev.meanPm10, 2) : String("null")) + ",";
  p += "\"temperatura\":" + (ev.validTemp ? String(ev.meanTemp, 2) : String("null")) + ",";
  p += "\"humedad\":" + (ev.validRh ? String(ev.meanRh, 2) : String("null")) + ",";

  // ICAI
  p += "\"icaiScore\":" + (ev.icaiScore >= 0 ? String(ev.icaiScore) : String("null")) + ",";
  p += "\"icaiCategoria\":" + (ev.icaiCategoria.length() > 0 ? ("\"" + ev.icaiCategoria + "\"") : String("null")) + ",";
  p += "\"icaiEstado\":\"" + ev.icaiEstado + "\",";
  if (ev.icaiEstado == "dato_insuficiente") {
    p += "\"causasICAI\":null,";
  } else {
    p += "\"causasICAI\":[";
    for (int i = 0; i < ev.numCausasICAI; ++i) {
      if (i > 0) p += ",";
      p += "\"" + ev.causasICAI[i] + "\"";
    }
    p += "],";
  }

  // ICT
  p += "\"ictScore\":" + (ev.ictScore >= 0 ? String(ev.ictScore) : String("null")) + ",";
  p += "\"ictCategoria\":" + (ev.ictCategoria.length() > 0 ? ("\"" + ev.ictCategoria + "\"") : String("null")) + ",";
  p += "\"ictEstado\":\"" + ev.ictEstado + "\",";
  if (ev.ictEstado == "dato_insuficiente") {
    p += "\"causasICT\":null,";
  } else {
    p += "\"causasICT\":[";
    for (int i = 0; i < ev.numCausasICT; ++i) {
      if (i > 0) p += ",";
      p += "\"" + ev.causasICT[i] + "\"";
    }
    p += "],";
  }

  // ICG
  p += "\"icgScore\":" + (ev.icgScore >= 0 ? String(ev.icgScore) : String("null")) + ",";
  p += "\"icgCategoria\":" + (ev.icgCategoria.length() > 0 ? ("\"" + ev.icgCategoria + "\"") : String("null")) + ",";
  p += "\"icgEstado\":\"" + ev.icgEstado + "\",";
  if (ev.icgEstado != "completo") {
    p += "\"causasICG\":null,";
    p += "\"celdaMatriz\":null,";
  } else {
    p += "\"causasICG\":[";
    for (int i = 0; i < ev.numCausasICG; ++i) {
      if (i > 0) p += ",";
      p += "\"" + ev.causasICG[i] + "\"";
    }
    p += "],";
    p += "\"celdaMatriz\":\"" + ev.celdaMatriz + "\",";
  }

  // Recomendaciones
  p += "\"recomendaciones\":[";
  for (int i = 0; i < ev.numRecomendaciones; ++i) {
    if (i > 0) p += ",";
    p += "\"" + jsonEscape(ev.recomendaciones[i]) + "\"";
  }
  p += "]";
  p += "}";
  return p;
}

// -----------------------------------------------------------------------------
// 6. BUFFER CIRCULAR PERSISTENTE EN LITTLEFS (SECCION 6.7.2 Y 6.7.3)
// -----------------------------------------------------------------------------
String slotFilePath(int slot) {
  return "/q_" + String(slot) + ".json";
}

void saveBufferMeta() {
  prefs.putInt("buf_head", bufHead);
  prefs.putInt("buf_tail", bufTail);
  prefs.putInt("buf_count", bufCount);
  prefs.putUInt("win_drop", ventanasDescartadas);
}

void loadConfigAndBufferMeta() {
  prefs.begin("aira_cfg", false);
  cfg.wifiSsid  = prefs.getString("wifi_ssid", DEFAULT_WIFI_SSID);
  cfg.wifiPass  = prefs.getString("wifi_pass", DEFAULT_WIFI_PASSWORD);
  cfg.nodoId    = prefs.getString("nodo_id",   DEFAULT_NODO_ID);
  cfg.salaId    = prefs.getString("sala_id",   DEFAULT_SALA_ID);
  cfg.mqttUri   = prefs.getString("mqtt_uri",  DEFAULT_MQTT_URI);
  cfg.mqttToken = prefs.getString("mqtt_tok",  DEFAULT_MQTT_TOKEN);

  seqOrdenRegistro    = prefs.getUInt("seq_order", 0);
  ventanasDescartadas = prefs.getUInt("win_drop",  0);
  bufHead             = prefs.getInt("buf_head",   0);
  bufTail             = prefs.getInt("buf_tail",   0);
  bufCount            = prefs.getInt("buf_count",  0);

  if (bufCount < 0 || bufCount > BUFFER_CAPACITY ||
      bufHead < 0  || bufHead >= BUFFER_CAPACITY ||
      bufTail < 0  || bufTail >= BUFFER_CAPACITY) {
    bufHead = bufTail = bufCount = 0;
    saveBufferMeta();
  }
}

void enqueueWindowToLittleFS(const String &jsonPayload) {
  if (!littleFsReady) {
    ventanasDescartadas++;
    prefs.putUInt("win_drop", ventanasDescartadas);
    Serial.println("[BUFFER] LittleFS no disponible; ventana descartada.");
    return;
  }

  // Si el buffer circular esta lleno, sustituye la ventana mas antigua (Seccion 6.7.2 Estado 6)
  if (bufCount >= BUFFER_CAPACITY) {
    LittleFS.remove(slotFilePath(bufHead));
    bufHead = (bufHead + 1) % BUFFER_CAPACITY;
    bufCount--;
    ventanasDescartadas++;
    Serial.printf("[BUFFER] Buffer lleno (%d). Se descarta ventana mas antigua. Total descartadas=%lu\n",
                  BUFFER_CAPACITY, static_cast<unsigned long>(ventanasDescartadas));
  }

  File f = LittleFS.open(slotFilePath(bufTail), "w");
  if (!f) {
    ventanasDescartadas++;
    saveBufferMeta();
    Serial.println("[BUFFER] Error al escribir archivo en LittleFS.");
    return;
  }
  f.print(jsonPayload);
  f.close();

  bufTail = (bufTail + 1) % BUFFER_CAPACITY;
  bufCount++;
  saveBufferMeta();
  Serial.printf("[BUFFER] Ventana guardada en LittleFS (pendientes=%d/%d)\n", bufCount, BUFFER_CAPACITY);
}

bool peekOldestBufferedWindow(String &outPayload) {
  if (!littleFsReady || bufCount <= 0) return false;
  File f = LittleFS.open(slotFilePath(bufHead), "r");
  if (!f) {
    // Ranura corrupta o inexistente: avanzar puntero
    bufHead = (bufHead + 1) % BUFFER_CAPACITY;
    bufCount--;
    saveBufferMeta();
    return false;
  }
  outPayload = f.readString();
  f.close();
  return outPayload.length() > 10;
}

void markOldestBufferedWindowAsRetransmission() {
  if (!littleFsReady || bufCount <= 0) return;
  const String path = slotFilePath(bufHead);
  File f = LittleFS.open(path, "r");
  if (!f) return;
  String payload = f.readString();
  f.close();
  if (payload.indexOf("\"esRetransmision\":false") < 0) return;
  payload.replace("\"esRetransmision\":false", "\"esRetransmision\":true");
  f = LittleFS.open(path, "w");
  if (!f) return;
  f.print(payload);
  f.close();
}

void popOldestBufferedWindow() {
  if (bufCount <= 0) return;
  if (littleFsReady) {
    LittleFS.remove(slotFilePath(bufHead));
  }
  bufHead = (bufHead + 1) % BUFFER_CAPACITY;
  bufCount--;
  saveBufferMeta();
  Serial.printf("[BUFFER] Ventana retransmitida confirmada por PUBACK y eliminada de LittleFS (restantes=%d)\n", bufCount);
}

// -----------------------------------------------------------------------------
// 7. GESTOR MQTTS / WSS CON CONFIRMACION PUBACK QoS 1
// -----------------------------------------------------------------------------
String getMqttTopic() {
  return "telemetria/" + cfg.nodoId + "/datos";
}

static void mqttEventHandler(void *handler_args, esp_event_base_t base, int32_t event_id, void *event_data) {
  esp_mqtt_event_handle_t event = static_cast<esp_mqtt_event_handle_t>(event_data);
  switch (static_cast<esp_mqtt_event_id_t>(event_id)) {
    case MQTT_EVENT_CONNECTED:
      mqttConnected = true;
      Serial.println("[MQTT] Conectado exitosamente al broker institucional (WSS/TLS).");
      break;

    case MQTT_EVENT_DISCONNECTED:
      mqttConnected = false;
      Serial.println("[MQTT] Desconectado del broker.");
      break;

    case MQTT_EVENT_PUBLISHED:
      if (event->msg_id == pendingMsgId) {
        pendingAckReceived = true;
      } else {
        duplicadosObservados++;
      }
      Serial.printf("[MQTT] PUBACK recibido (msg_id=%d)\n", event->msg_id);
      break;

    case MQTT_EVENT_ERROR:
      Serial.println("[MQTT] Evento de error en transporte/autenticacion.");
      if (event->error_handle != nullptr) {
        Serial.printf("[MQTT] Diagnostico TLS: tipo=%d, esp_err=0x%x, tls_stack=0x%x, cert_flags=0x%x, socket_errno=%d\n",
                      static_cast<int>(event->error_handle->error_type),
                      static_cast<unsigned int>(event->error_handle->esp_tls_last_esp_err),
                      static_cast<unsigned int>(event->error_handle->esp_tls_stack_err),
                      static_cast<unsigned int>(event->error_handle->esp_tls_cert_verify_flags),
                      event->error_handle->esp_transport_sock_errno);
      }
      break;

    default:
      break;
  }
}

void startMqttClient() {
  if (mqttClient != nullptr) {
    esp_mqtt_client_stop(mqttClient);
    esp_mqtt_client_destroy(mqttClient);
    mqttClient = nullptr;
  }
  mqttConnected = false;
  pendingMsgId  = -1;

  esp_mqtt_client_config_t mqttCfg = {};
  mqttCfg.broker.address.uri                       = cfg.mqttUri.c_str();
  mqttCfg.broker.verification.certificate          = PROJECT_ROOT_CA;
  // Leave hostname verification enabled: ESP-TLS also uses the hostname for SNI.
  mqttCfg.broker.verification.skip_cert_common_name_check = false;
  mqttCfg.credentials.username                     = cfg.nodoId.c_str();
  mqttCfg.credentials.client_id                    = cfg.nodoId.c_str();
  mqttCfg.credentials.authentication.password      = cfg.mqttToken.c_str();
  mqttCfg.session.keepalive                        = 30;
  mqttCfg.network.reconnect_timeout_ms             = 5000;
  mqttCfg.network.timeout_ms                       = 10000;
  mqttCfg.buffer.size                              = 2048;
  mqttCfg.buffer.out_size                          = 2048;

  mqttClient = esp_mqtt_client_init(&mqttCfg);
  if (mqttClient != nullptr) {
    esp_mqtt_client_register_event(mqttClient, MQTT_EVENT_ANY, mqttEventHandler, nullptr);
    esp_mqtt_client_start(mqttClient);
    Serial.printf("[MQTT] Iniciando cliente hacia %s como '%s'...\n", cfg.mqttUri.c_str(), cfg.nodoId.c_str());
  }
}

void stopMqttClient() {
  if (mqttClient != nullptr) {
    esp_mqtt_client_stop(mqttClient);
    esp_mqtt_client_destroy(mqttClient);
    mqttClient = nullptr;
  }
  mqttConnected = false;
  pendingMsgId  = -1;
}

bool publishQos1Packet(const String &payload, bool fromBuffer) {
  if (!mqttConnected || mqttClient == nullptr || pendingMsgId != -1) return false;
  String topic = getMqttTopic();
  int msgId = esp_mqtt_client_publish(mqttClient, topic.c_str(), payload.c_str(), payload.length(), 1, 0);
  if (msgId < 0) {
    Serial.println("[MQTT] Fallo al encolar publicacion QoS 1.");
    return false;
  }
  pendingMsgId       = msgId;
  pendingAckReceived = false;
  pendingPublishAtMs = millis();
  pendingFromBuffer  = fromBuffer;
  Serial.printf("[MQTT] Publicando ventana en %s (msg_id=%d, buffer=%d)...\n",
                topic.c_str(), msgId, fromBuffer ? 1 : 0);
  return true;
}

// -----------------------------------------------------------------------------
// 8. APROVISIONAMIENTO POR PUERTO SERIE USB
// -----------------------------------------------------------------------------
// Extrae el valor de una clave string en un objeto JSON simple {"key":"val"}
String extractJsonStringField(const String &json, const char *key, bool &found) {
  found = false;
  String pattern = "\"" + String(key) + "\"";
  int kPos = json.indexOf(pattern);
  if (kPos < 0) return "";
  int colonPos = json.indexOf(':', kPos + pattern.length());
  if (colonPos < 0) return "";
  int qStart = json.indexOf('\"', colonPos + 1);
  if (qStart < 0) return "";
  String out;
  for (size_t i = qStart + 1; i < json.length(); ++i) {
    char c = json[i];
    if (c == '\\' && i + 1 < json.length()) {
      char next = json[++i];
      if (next == 'n') out += '\n';
      else if (next == 'r') out += '\r';
      else out += next;
    } else if (c == '\"') {
      found = true;
      return out;
    } else {
      out += c;
    }
  }
  return "";
}

// Aprovisionamiento por puerto serie USB (Web Serial API desde /nodos):
//   - "SET_CONFIG {\"ssid\":\"...\",\"pass\":\"...\",\"nodo\":\"...\",\"sala\":\"...\",\"uri\":\"...\",\"tok\":\"...\"}"
//   - "STATUS"
void pollSerialProvisioning() {
  while (Serial.available()) {
    String line = Serial.readStringUntil('\n');
    line.trim();
    if (line.length() == 0) continue;

    if (line == "STATUS") {
      Serial.printf("AIRA_STATUS {\"ok\":true,\"nodoId\":\"%s\",\"salaId\":\"%s\",\"wifiSsid\":\"%s\",\"mac\":\"%s\",\"firmware\":\"%s\",\"fsm\":\"%s\",\"buffer\":%d}\n",
                    cfg.nodoId.c_str(), cfg.salaId.c_str(), cfg.wifiSsid.c_str(),
                    WiFi.macAddress().c_str(), FIRMWARE_VERSION, fsmStateName(fsmState), bufCount);
    } else if (line.startsWith("SET_CONFIG")) {
      String body = line.substring(10);
      body.trim();
      bool found = false;
      String vSsid = extractJsonStringField(body, "ssid", found);
      if (found && vSsid.length() > 0) { cfg.wifiSsid = vSsid; prefs.putString("wifi_ssid", cfg.wifiSsid); }

      String vPass = extractJsonStringField(body, "pass", found);
      if (found) { cfg.wifiPass = vPass; prefs.putString("wifi_pass", cfg.wifiPass); }

      String vNodo = extractJsonStringField(body, "nodo", found);
      if (found && vNodo.length() > 0) { cfg.nodoId = vNodo; prefs.putString("nodo_id", cfg.nodoId); }

      String vSala = extractJsonStringField(body, "sala", found);
      if (found && vSala.length() > 0) { cfg.salaId = vSala; prefs.putString("sala_id", cfg.salaId); }

      String vUri = extractJsonStringField(body, "uri", found);
      if (found && vUri.length() > 0) { cfg.mqttUri = vUri; prefs.putString("mqtt_uri", cfg.mqttUri); }

      String vTok = extractJsonStringField(body, "tok", found);
      if (found && vTok.length() > 0) { cfg.mqttToken = vTok; prefs.putString("mqtt_tok", cfg.mqttToken); }

      Serial.printf("AIRA_CONFIG_OK {\"ok\":true,\"nodoId\":\"%s\",\"salaId\":\"%s\",\"wifiSsid\":\"%s\",\"mac\":\"%s\",\"firmware\":\"%s\"}\n",
                    cfg.nodoId.c_str(), cfg.salaId.c_str(), cfg.wifiSsid.c_str(),
                    WiFi.macAddress().c_str(), FIRMWARE_VERSION);

      // Reiniciar conexion inalambrica con las nuevas credenciales guardadas en NVS
      stopMqttClient();
      WiFi.disconnect(true);
      WiFi.mode(WIFI_STA);
      WiFi.setSleep(false);
      wifiRetryCount    = 0;
      wifiBackoffMs     = WIFI_BACKOFF_MIN_MS;
      lastWifiAttemptMs = 0;
      fsmState          = CONNECTING_WIFI;
    }
  }
}

// -----------------------------------------------------------------------------
// 9. INTERFAZ GRAFICA EN PANTALLA TFT ST7789 (REFRESCO CADA 5 SEGUNDOS)
// -----------------------------------------------------------------------------
uint16_t displayRgb565(uint8_t r, uint8_t g, uint8_t b) {
  return static_cast<uint16_t>(((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3));
}

uint16_t colorForScore(int score, const String &estado) {
  if (estado != "completo" || score < 0) return displayRgb565(156, 182, 190); // Parcial / sin datos
  switch (score) {
    case 0: return displayRgb565(55, 212, 155);  // Optimo: verde
    case 1: return displayRgb565(246, 211, 101); // Precaucion: amarillo
    case 2: return displayRgb565(255, 193, 90);  // Deficiente: ambar
    case 3: return displayRgb565(255, 107, 107); // Malo: rojo
    case 4: return displayRgb565(232, 121, 249); // Critico: magenta
    default: return displayRgb565(243, 250, 249);
  }
}

void drawDisplay(unsigned long now) {
  if (now - lastDisplayMs < DISPLAY_REFRESH_MS) return;
  lastDisplayMs = now;

  const uint16_t bgColor      = displayRgb565(7, 20, 28);
  const uint16_t cardColor    = displayRgb565(16, 35, 46);
  const uint16_t mutedColor   = displayRgb565(156, 182, 190);
  const uint16_t textColor    = displayRgb565(243, 250, 249);
  const uint16_t dividerColor = displayRgb565(35, 65, 77);
  const uint16_t amberColor   = displayRgb565(255, 193, 90);

  tft.fillScreen(bgColor);
  tft.setTextWrap(false);
  tft.fillRect(0, 0, 240, 4, amberColor);

  // Encabezado compacto: el UUID no cabe en la pantalla; la sala se identifica en la pagina.
  tft.setTextSize(1);
  tft.setTextColor(mutedColor);
  tft.setCursor(12, 11);
  tft.print("AIRA | NODO");
  uint16_t linkColor = mqttConnected ? colorForScore(0, "completo")
                     : WiFi.status() == WL_CONNECTED ? amberColor
                     : displayRgb565(255, 107, 107);
  tft.fillCircle(218, 15, 3, linkColor);

  // Tarjeta principal ICG: el score metodologico vigente va de 0 a 4.
  uint16_t badgeColor = colorForScore(lastEval.icgScore, lastEval.icgEstado);
  tft.fillRoundRect(10, 34, 220, 62, 5, cardColor);
  tft.fillRoundRect(10, 34, 5, 62, 2, badgeColor);
  tft.setTextSize(1);
  tft.setTextColor(mutedColor);
  tft.setCursor(22, 41);
  tft.print("ESTADO GENERAL | ICG");

  tft.setTextColor(textColor);
  tft.setTextSize(4);
  tft.setCursor(20, 53);
  if (!lastEval.hasWindow) {
    tft.print("--");
  } else if (lastEval.icgEstado == "completo") {
    tft.print(lastEval.icgScore);
  } else {
    tft.print("--");
  }

  tft.setTextSize(2);
  tft.setTextColor(badgeColor);
  tft.setCursor(91, 61);
  if (!lastEval.hasWindow) {
    tft.print("MUESTREO");
  } else if (lastEval.icgEstado == "completo") {
    tft.print(lastEval.icgCategoria);
  } else if (lastEval.icgEstado == "parcial") {
    tft.print("PARCIAL");
  } else {
    tft.print("SIN DATOS");
  }
  if (lastEval.icgEstado == "completo" && lastEval.celdaMatriz.length() > 0) {
    tft.setTextSize(1);
    tft.setTextColor(mutedColor);
    tft.setCursor(190, 83);
    tft.print("M:");
    tft.print(lastEval.celdaMatriz);
  }

  // ICAI y ICT muestran su score y categoria actuales con el color de severidad.
  tft.setTextSize(1);
  tft.setCursor(14, 103);
  tft.setTextColor(lastEval.icaiScore >= 0 ? colorForScore(lastEval.icaiScore, "completo") : mutedColor);
  tft.print("AIRE | ICAI ");
  if (lastEval.icaiScore >= 0) {
    tft.print(lastEval.icaiScore);
    tft.print(" ");
    tft.print(lastEval.icaiCategoria);
  } else {
    tft.print("-- SIN DATOS");
  }
  tft.setCursor(14, 123);
  tft.setTextColor(lastEval.ictScore >= 0 ? colorForScore(lastEval.ictScore, "completo") : mutedColor);
  tft.print("CONFORT | ICT ");
  if (lastEval.ictScore >= 0) {
    tft.print(lastEval.ictScore);
    tft.print(" ");
    tft.print(lastEval.ictCategoria);
  } else {
    tft.print("-- SIN DATOS");
  }
  tft.drawFastHLine(12, 148, 216, dividerColor);

  // Lecturas instantaneas; los sensores desconectados se muestran como n/d.
  tft.setTextSize(1);
  tft.setTextColor(mutedColor);
  tft.setCursor(14, 157);
  tft.print("CO2");
  const bool scdFresh = scd.valid && fresh(scd.atMs, now);
  tft.setTextColor(scdFresh ? colorForScore(calcSeverityCo2(scd.co2), "completo") : mutedColor);
  tft.setCursor(75, 157);
  if (scdFresh) {
    tft.print(scd.co2);
    tft.print(" ppm");
  } else {
    tft.print("n/d");
  }

  tft.setTextColor(mutedColor);
  tft.setCursor(14, 178);
  tft.print("PM2.5 / PM10");
  const bool pmsFresh = pms.valid && fresh(pms.atMs, now);
  tft.setCursor(109, 178);
  if (pmsFresh) {
    tft.setTextColor(colorForScore(calcSeverityPm(pms.pm25, 15.0f), "completo"));
    tft.print(pms.pm25);
    tft.setTextColor(mutedColor);
    tft.print(" / ");
    tft.setTextColor(colorForScore(calcSeverityPm(pms.pm10, 45.0f), "completo"));
    tft.print(pms.pm10);
    tft.setTextColor(mutedColor);
    tft.print(" ug/m3");
  } else {
    tft.setTextColor(mutedColor);
    tft.print("n/d - sin sensor");
  }

  tft.setTextColor(mutedColor);
  tft.setCursor(14, 199);
  tft.print("TEMP / HR");
  tft.setTextColor(scdFresh ? colorForScore(calcSeverityTemp(scd.tempC), "completo") : mutedColor);
  tft.setCursor(98, 199);
  if (scdFresh) {
    tft.print(scd.tempC, 1);
    tft.setTextColor(mutedColor);
    tft.print(" C / ");
    tft.setTextColor(colorForScore(calcSeverityRh(scd.rh), "completo"));
    tft.print(scd.rh, 0);
    tft.setTextColor(mutedColor);
    tft.print(" %");
  } else {
    tft.print("n/d");
  }

  // Pie: avance de muestras y estado MQTT.
  tft.fillRect(0, 223, 240, 17, cardColor);
  tft.setTextSize(1);
  tft.setCursor(12, 226);
  tft.setTextColor(mutedColor);
  tft.printf("MUESTRAS %d/%d  BUF %d", winAcc.totalTicks, WINDOW_MAX_SAMPLES, bufCount);
  tft.setCursor(170, 226);
  tft.setTextColor(mqttConnected ? colorForScore(0, "completo") : amberColor);
  tft.print(mqttConnected ? "MQTT OK" : "MQTT...");
}

// -----------------------------------------------------------------------------
// 10. EJECUCION DE LA MAQUINA DE ESTADOS FINITOS (SECCION 6.7.2)
// -----------------------------------------------------------------------------
void runConnectivityFsm(unsigned long now) {
  switch (fsmState) {
    case INIT_SYS: {
      if (cfg.wifiSsid.length() == 0) {
        Serial.println("[WIFI] SSID no configurado; espera aprovisionamiento por USB.");
        fsmState = DEGRADED_BUFFER;
        lastDegradedTryMs = now;
      } else {
        WiFi.mode(WIFI_STA);
        WiFi.setSleep(false);
        wifiRetryCount    = 0;
        wifiBackoffMs     = WIFI_BACKOFF_MIN_MS;
        lastWifiAttemptMs = 0;
        fsmState          = CONNECTING_WIFI;
        Serial.println("[FSM] INIT_SYS -> CONNECTING_WIFI");
      }
      break;
    }

    case CONNECTING_WIFI: {
      if (WiFi.status() == WL_CONNECTED) {
        Serial.print("[WIFI] Conectado. IP: ");
        Serial.println(WiFi.localIP());
        wifiRetryCount = 0;
        wifiBackoffMs  = WIFI_BACKOFF_MIN_MS;
        configTime(0, 0, NTP_SERVER_1, NTP_SERVER_2, NTP_SERVER_3);
        lastNtpSyncMs  = now;
        fsmState       = NTP_SYNC;
        Serial.println("[FSM] CONNECTING_WIFI -> NTP_SYNC");
        break;
      }

      if (lastWifiAttemptMs == 0 || (now - lastWifiAttemptMs >= wifiBackoffMs)) {
        if (wifiRetryCount >= WIFI_MAX_RETRIES) {
          Serial.println("[WIFI] Maximo de 5 reintentos alcanzado. Conmutando a DEGRADED_BUFFER.");
          lastDegradedTryMs = now;
          fsmState          = DEGRADED_BUFFER;
          break;
        }
        lastWifiAttemptMs = now;
        wifiRetryCount++;
        Serial.printf("[WIFI] Intento %d/%d hacia '%s' (backoff=%lu ms)...\n",
                      wifiRetryCount, WIFI_MAX_RETRIES, cfg.wifiSsid.c_str(), wifiBackoffMs);
        WiFi.disconnect();
        WiFi.begin(cfg.wifiSsid.c_str(), cfg.wifiPass.c_str());
        wifiBackoffMs = (wifiBackoffMs * 2UL > WIFI_BACKOFF_MAX_MS) ? WIFI_BACKOFF_MAX_MS : (wifiBackoffMs * 2UL);
      }
      break;
    }

    case NTP_SYNC: {
      struct tm timeinfo;
      if (getLocalTime(&timeinfo, 200)) {
        time_t epoch = time(nullptr);
        if (epoch >= 1700000000L) {
          ntpSynced     = true;
          lastNtpSyncMs = now;
          Serial.printf("[NTP] Reloj UTC sincronizado: %04d-%02d-%02d %02d:%02d:%02dZ\n",
                        timeinfo.tm_year + 1900, timeinfo.tm_mon + 1, timeinfo.tm_mday,
                        timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec);
          startMqttClient();
          fsmState = MQTT_STREAMING;
          Serial.println("[FSM] NTP_SYNC -> MQTT_STREAMING");
          break;
        }
      }
      // Si tras 10 segundos no responde NTP, pasa a DEGRADED_BUFFER marcando hora incierta (Seccion 6.7.2 Estado 4)
      if (now - lastNtpSyncMs >= 10000UL) {
        Serial.println("[NTP] No disponible tras 10 s; pasando a DEGRADED_BUFFER (horaVerificada=false).");
        lastDegradedTryMs = now;
        fsmState = DEGRADED_BUFFER;
      }
      break;
    }

    case MQTT_STREAMING: {
      if (WiFi.status() != WL_CONNECTED) {
        Serial.println("[FSM] Perdida de enlace Wi-Fi; conmutando a DEGRADED_BUFFER.");
        stopMqttClient();
        lastDegradedTryMs = now;
        fsmState = DEGRADED_BUFFER;
        break;
      }

      // Verificar confirmacion PUBACK pendiente
      if (pendingMsgId != -1) {
        if (pendingAckReceived) {
          if (pendingFromBuffer) {
            popOldestBufferedWindow();
          }
          pendingMsgId       = -1;
          pendingAckReceived = false;
        } else if (now - pendingPublishAtMs >= MQTT_ACK_TIMEOUT_MS) {
          Serial.println("[MQTT] ACK Timeout esperando PUBACK; conmutando a DEGRADED_BUFFER.");
          if (pendingFromBuffer) markOldestBufferedWindowAsRetransmission();
          pendingMsgId = -1;
          stopMqttClient();
          lastDegradedTryMs = now;
          fsmState = DEGRADED_BUFFER;
          break;
        }
      }

      // Si hay ventanas retenidas en LittleFS y el canal esta libre, retransmitir en orden FIFO (RF-09)
      if (mqttConnected && pendingMsgId == -1 && bufCount > 0) {
        String oldestJson;
        if (peekOldestBufferedWindow(oldestJson)) {
          publishQos1Packet(oldestJson, true);
        }
      }

      // Resincronizacion horaria NTP cada 1 hora (RF-11)
      if (now - lastNtpSyncMs >= NTP_SYNC_INTERVAL_MS) {
        lastNtpSyncMs = now;
        configTime(0, 0, NTP_SERVER_1, NTP_SERVER_2, NTP_SERVER_3);
      }
      break;
    }

    case DEGRADED_BUFFER: {
      // Cada DEGRADED_RETRY_MS intenta restablecer Wi-Fi, NTP y MQTTS sin detener el muestreo
      if (now - lastDegradedTryMs >= DEGRADED_RETRY_MS) {
        lastDegradedTryMs = now;
        if (WiFi.status() == WL_CONNECTED) {
          configTime(0, 0, NTP_SERVER_1, NTP_SERVER_2, NTP_SERVER_3);
          lastNtpSyncMs = now;
          fsmState      = NTP_SYNC;
          Serial.println("[FSM] DEGRADED_BUFFER -> NTP_SYNC");
        } else {
          wifiRetryCount    = 0;
          wifiBackoffMs     = WIFI_BACKOFF_MIN_MS;
          lastWifiAttemptMs = 0;
          fsmState          = CONNECTING_WIFI;
          Serial.println("[FSM] DEGRADED_BUFFER -> CONNECTING_WIFI");
        }
      }
      break;
    }
  }
}

// -----------------------------------------------------------------------------
// 11. CIERRE DE VENTANA DE 5 MINUTOS Y DESPACHO MQTTS / LITTLEFS
// -----------------------------------------------------------------------------
void processFiveMinuteWindow(unsigned long now) {
  if (now - lastWindowCloseMs < WINDOW_DURATION_MS) return;
  lastWindowCloseMs = now;

  WindowEvaluation ev = evaluateCurrentWindow();
  lastEval = ev;
  winAcc.reset();

  const bool deferred = !(fsmState == MQTT_STREAMING && mqttConnected && pendingMsgId == -1 && bufCount == 0);
  String payload = buildTelemetryJson(ev, deferred);
  Serial.println("[VENTANA 5M] Paquete generado:");
  Serial.println(payload);

  // Persistir primero: una publicación aceptada por el cliente MQTT todavía
  // puede terminar sin PUBACK. La ventana sólo sale de LittleFS al confirmarse.
  enqueueWindowToLittleFS(payload);
}

// -----------------------------------------------------------------------------
// 12. SETUP Y LOOP PRINCIPAL ASINCRONO NO BLOQUEANTE
// -----------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=======================================================");
  Serial.println("  NODO DE MONITOREO AMBIENTAL AIRA (ESP32)");
  Serial.printf("  Firmware: %s | Reglas: %s\n", FIRMWARE_VERSION, VERSION_REGLAS);
  Serial.println("=======================================================");

  // 1. Inicializar buses de hardware (identico a esp32_prueba.ino)
  Serial2.setRxBufferSize(512);
  Serial2.begin(9600, SERIAL_8N1, PMS_RX_ESP, PMS_TX_ESP);
  Wire.begin(SCD_SDA, SCD_SCL);
  Wire.setClock(100000);
  startScd();

  SPI.begin(TFT_SCK, -1, TFT_MOSI, TFT_CS);
#if DISPLAY_VARIANT == 154
  tft.init(240, 240);
#else
  tft.init(170, 320);
#endif
  tft.setRotation(0);
  tft.fillScreen(ST77XX_BLACK);

  // 2. Montar particion LittleFS para el buffer circular persistente
  littleFsReady = LittleFS.begin(true);
  Serial.println(littleFsReady ? "[FS] LittleFS montado correctamente" : "[FS] Error montando LittleFS");

  // 3. Cargar configuracion NVS y metadatos del buffer
  loadConfigAndBufferMeta();
  Serial.printf("[CFG] Nodo='%s', Sala='%s', SSID='%s', Buffer=%d/%d\n",
                cfg.nodoId.c_str(), cfg.salaId.c_str(), cfg.wifiSsid.c_str(), bufCount, BUFFER_CAPACITY);

  unsigned long now = millis();
  lastSampleTickMs  = now;
  lastWindowCloseMs = now;
  lastDisplayMs     = 0;
  fsmState          = INIT_SYS;
}

void loop() {
  unsigned long now = millis();

  // 1. Adquisicion continua de buses fisicos (UART2 PMS5003 e I2C SCD40)
  pollPms();
  pollScd(now);
  pollSerialProvisioning();

  // 2. Tarea temporizada: Muestreo sensorial cada 10 s (Eq. 6.1)
  sampleSensorsTick(now);

  // 3. Tarea temporizada: Cierre de ventana de 5 minutos, calculo de ICAI/ICT/ICG y envio/buffer
  processFiveMinuteWindow(now);

  // 4. Maquina de Estados Finitos de Conectividad y Resiliencia
  runConnectivityFsm(now);

  // 5. Tarea temporizada: Refresco de pantalla TFT cada 5 s
  drawDisplay(now);

  delay(10);
}
