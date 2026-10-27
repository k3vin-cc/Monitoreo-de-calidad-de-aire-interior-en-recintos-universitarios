# Auditoría de ventanas ESP32 v1.0.8 — 26 de octubre de 2026

## Alcance

Se amplió el paquete MQTT, la ingesta FastAPI y la hipertabla `telemetria` sin cambiar su clave primaria `(salaId, timestamp)` ni borrar datos anteriores. La migración [2026-10-26-telemetry-audit.sql](k8s/migrations/2026-10-26-telemetry-audit.sql) añade diez columnas opcionales y un índice no único por nodo/secuencia. Se aplicó a la base activa. Las filas anteriores quedan con `NULL` en esas columnas. `telemetria_tiempo_incierto` ya conserva el paquete original JSON y, por tanto, conserva los campos nuevos cuando el reloj no está verificado.

| Columna nueva | Contenido |
| --- | --- |
| `ventanaId`, `ordenRegistro` | Identidad `nodoId:secuencia` y secuencia persistida en NVS. |
| `ventanaInicio`, `ventanaFinReal` | Tiempos UTC reales a precisión de segundo si NTP está verificado. `timestamp` sigue siendo el fin alineado a cinco minutos para la clave y las alertas. |
| `firmwareVersion` | Versión incluida en el paquete de cada ventana; independiente de la versión de reglas y del estado actual del nodo. |
| `mediasClasificacion` | Las cinco medias `float` usadas por el clasificador, serializadas con ocho decimales en lugar de dos. Los campos físicos principales del paquete también usan ocho decimales. |
| `subniveles` | Severidad 0–4 de CO₂, PM₂.₅, PM₁₀, temperatura y humedad; `null` cuando la variable no alcanza el mínimo de muestras. |
| `persistencia` | ID de la ventana anterior usada, resultado, causas coincidentes y motivo (`sin_ventana_anterior`, `anterior_incompleta`, `anterior_sin_alerta`, `causa_no_coincidente`, `causa_confirmada`, `actual_incompleta` o `actual_sin_datos`). |
| `invalidaciones` | Por variable: ticks sin lectura fresca y fuera de rango. Para partículas también cuenta tramas inválidas; además registra fallos de lectura SCD40. |
| `calibracion` | Versión de configuración, ausencia de compensación térmica explícita en el firmware y estado `no_leida` de la calibración interna del sensor. **No afirma que la calibración de fábrica sea cero ni que se haya verificado.** |

El API acepta los nuevos campos opcionales y sigue aceptando paquetes del firmware anterior. Comprueba la coherencia de `ventanaId` con nodo/secuencia, el orden de inicio y fin y el rango de los subniveles. Los registra en `telemetria` con sus tipos originales `JSONB`; el API no recalcula los índices. La pantalla y el flujo USB de aprovisionamiento no se modificaron. El nuevo firmware se compiló para ESP32 clásico con Arduino-ESP32 3.3.12 y `DISPLAY_VARIANT=154`.

## Publicación y validación

- Compilación exitosa: `1.142.384` bytes, cabecera ESP32 `0xE9`, SHA-256 `c5362044a01230eed17c22319f3828714bbe3a517a842298394559a566ff4d7e`.
- Versión `v1.0.8` registrada en el catálogo de la página como **prueba**; el binario completo quedó en PostgreSQL y su SHA-256 fue comprobado de nuevo en la base. El registro no tenía nodos asociados antes de incorporar la última corrección del binario. Durante la verificación final apareció un nodo asociado a v1.0.8, pero todavía no había telemetría con `firmwareVersion='v1.0.8'`; la asociación no confirma por sí sola el flasheo físico.
- Migración aplicada; se confirmaron las diez columnas en la base activa.
- `python -m py_compile api/main.py` y `scripts/test_telemetry_audit.py` pasaron. La prueba valida paquete nuevo y antiguo y ejecuta `EXPLAIN` del `INSERT` real del API sin crear telemetría de prueba.
- El API desplegado respondió `{"status":"ok","database":"ok","mqtt":true}` a través del proxy interno.

## Primera ventana real verificada

El 26 de octubre de 2026 a las 23:25 h de Chile (27 de octubre 02:25 UTC) se guardó una ventana real del nodo asociado a v1.0.8. `firmwareVersion='v1.0.8'`, `ventanaId` terminó en `:1343` y `ordenRegistro=1343`. Los cinco valores de `mediasClasificacion` y los cinco `subniveles` llegaron completos; `icgEstado='completo'` e `icgScore=3`. También se guardaron inicio y fin real, persistencia, invalidaciones y calibración. Los contadores de invalidación de esta ventana fueron cero. La persistencia indicó `sin_ventana_anterior`, coherente con la primera ventana de la sesión. La ingesta del API no mostró rechazos recientes.

Esta comprobación confirma la publicación e ingesta de una ventana, pero todavía no valida la comparación de persistencia entre dos ventanas v1.0.8 consecutivas ni una retransmisión tras desconexión.

## Límites conocidos

Los tiempos de inicio y fin real tienen resolución de un segundo; el inicio se calcula con la duración observada de la ventana. Si NTP no está verificado, ambos tiempos son `null` y el paquete se guarda en `telemetria_tiempo_incierto`. El dato de calibración sólo describe los ajustes conocidos por este firmware; para verificar la compensación interna y la calibración del SCD40 habría que añadir lectura o configuración explícita de esos parámetros. Las medias reflejan el valor `float` usado en la clasificación con ocho decimales de serialización, no las muestras crudas individuales.

## Revisión para GitHub (sin push)

El remoto `origin` apunta a `https://github.com/k3vin-cc/Monitoreo-de-calidad-de-aire-interior-en-recintos-universitarios.git`. `git ls-remote` confirmó que `main` remoto sigue en `1ad4fb8`, igual que el HEAD local. `git push --dry-run origin HEAD:refs/heads/main` respondió `Everything up-to-date`; esa simulación sólo comprueba el estado actual y **no prueba permisos para publicar un commit nuevo**. No se creó commit ni se hizo push. `gh` no está instalado en este equipo. El binario compilado y `secrets.h` están ignorados y no deben añadirse al repositorio.

Para que los generadores sirvan tanto al repositorio público como a otras instalaciones, conservan `aira` por defecto y aceptan `AIRA_K8S_NAMESPACE` al desplegar en otro clúster. Los ConfigMaps generados permanecen ignorados por Git.

Mensaje de commit propuesto: `feat: guardar trazabilidad de cada ventana ESP32 en telemetria`.

Descripción propuesta para la revisión: «El firmware v1.0.8 publica las medias usadas por el clasificador, subniveles, identidad y tiempos de ventana, persistencia, motivos de invalidez y estado de calibración conocido. Una migración aditiva y FastAPI conservan esos datos por ventana sin afectar la ingesta del firmware anterior. Se compiló el binario, se validó el contrato SQL y se publicó como versión de prueba. La primera ventana real llegó con todos los campos de auditoría; quedan por comprobar una persistencia entre ventanas consecutivas y una retransmisión».

Antes de un push futuro conviene revisar el diff, incluir esta migración y el test, y confirmar que no se agreguen secretos ni el binario. La publicación en GitHub queda pendiente de una instrucción explícita del usuario.
