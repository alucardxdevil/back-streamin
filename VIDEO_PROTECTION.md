# Sistema de Protección de Video — Stream-In

## Resumen Ejecutivo

Este documento describe el sistema de protección multicapa implementado para garantizar que los videos almacenados en Backblaze B2 solo puedan reproducirse dentro del reproductor integrado de la aplicación.

**Principio fundamental:** Ninguna URL de B2 es accesible directamente por el cliente. Todo el contenido de video pasa a través del proxy backend, que actúa como intermediario transparente.

---

## Arquitectura de Capas

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENTE (Navegador)                       │
│  - Solicita /api/stream/video/:id (nunca URLs de B2)            │
│  - Token de sesión en memoria (no en localStorage)              │
│  - hls.js inyecta X-Session-Token en cada solicitud XHR         │
└─────────────────────────┬───────────────────────────────────────┘
                          │ HTTPS
┌─────────────────────────▼───────────────────────────────────────┐
│                    BACKEND (Express.js)                          │
│                                                                  │
│  ┌─ Capa 2: Validación de Origen ──────────────────────────┐   │
│  │  middleware/originValidator.js                           │   │
│  │  → Verifica Origin y Referer headers                     │   │
│  │  → Rechaza 403 si no es dominio autorizado               │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─ Capa 3: Token de Sesión Anónimo ───────────────────────┐   │
│  │  middleware/sessionToken.js                              │   │
│  │  → Verifica JWT de sesión (X-Session-Token header)       │   │
│  │  → Rechaza 401 si token inválido o expirado              │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─ Capa 6: Rate Limiting ─────────────────────────────────┐   │
│  │  middleware/rateLimiter.js                               │   │
│  │  → 120 req/15min por IP para streaming                   │   │
│  │  → 20 req/15min por IP para emisión de sesiones          │   │
│  │  → Rechaza 429 si se excede el límite                    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─ Capa 1+4: Proxy + URLs Firmadas ───────────────────────┐   │
│  │  controllers/streamProxy.js                              │   │
│  │  → Genera URL firmada temporal (20 min) para B2          │   │
│  │  → Hace fetch a B2 y hace pipe al cliente                │   │
│  │  → Reescribe .m3u8 para que apunten al proxy             │   │
│  │  → La URL de B2 NUNCA llega al cliente                   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─ Capa 7: Logging y Monitoreo ───────────────────────────┐   │
│  │  config/logger.js                                        │   │
│  │  → Registra cada intento de acceso                       │   │
│  │  → IP, timestamp, recurso, token válido, origen          │   │
│  │  → Resultado: autorizado o rechazado + razón             │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────┬───────────────────────────────────────┘
                          │ URL firmada temporal (interna)
┌─────────────────────────▼───────────────────────────────────────┐
│                    BACKBLAZE B2                                   │
│                                                                  │
│  ┌─ Capa 5: CORS Restrictivo ──────────────────────────────┐   │
│  │  scripts/setup-b2-cors.js                                │   │
│  │  → Solo permite solicitudes del dominio autorizado       │   │
│  │  → Bloquea acceso directo desde otros dominios           │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Descripción de Cada Capa

### Capa 1: URLs Firmadas con Expiración Corta

**Archivo:** [`server/controllers/streamProxy.js`](./controllers/streamProxy.js)

**Amenaza cubierta:** Reutilización de URLs de B2 fuera de la aplicación.

**Implementación:**
- El proxy genera URLs firmadas con TTL de 20 minutos usando `@aws-sdk/s3-request-presigner`
- Las URLs firmadas son de uso interno del proxy — **nunca se envían al cliente**
- Cada solicitud de video genera una nueva URL firmada
- Configurable via `SIGNED_URL_TTL_SECONDS` en `.env`

**Flujo:**
```
Cliente → /api/stream/video/:id → Proxy genera URL firmada → Fetch a B2 → Pipe al cliente
```

---

### Capa 2: Validación de Origen (Origin/Referer)

**Archivo:** [`server/middleware/originValidator.js`](./middleware/originValidator.js)

**Amenaza cubierta:** Acceso desde navegadores externos, aplicaciones de terceros, gestores de descarga.

**Implementación:**
- Verifica el header `Origin` en cada solicitud de video
- Si no hay `Origin`, verifica `Referer` como fallback
- Rechaza con `403 Forbidden` si el origen no está en `ALLOWED_ORIGINS`
- En producción, rechaza solicitudes sin `Origin` ni `Referer`
- En desarrollo, permite solicitudes de `localhost` automáticamente

**Configuración:**
```env
ALLOWED_ORIGINS=https://tudominio.com,https://www.tudominio.com
```

**Limitación conocida:** Los headers `Origin` y `Referer` pueden ser falsificados por herramientas avanzadas. Esta capa es efectiva contra usuarios casuales y herramientas básicas, pero no contra atacantes sofisticados. Las capas 3 y 4 cubren este vector.

---

### Capa 3: Tokens de Sesión Anónimos

**Archivos:**
- Backend: [`server/middleware/sessionToken.js`](./middleware/sessionToken.js)
- Frontend: [`front/src/hooks/useStreamSession.js`](../front/src/hooks/useStreamSession.js)

**Amenaza cubierta:** Solicitudes realizadas fuera del contexto de la aplicación (incluso con headers falsificados).

**Implementación:**
- Al cargar la aplicación, el frontend solicita un token de sesión: `GET /api/stream/session`
- El backend emite un JWT firmado con vida de 30 minutos
- El token se almacena **en memoria de React** (no en `localStorage` ni `sessionStorage`)
- hls.js inyecta el token en cada solicitud XHR via `xhrSetup`
- El backend valida el token antes de procesar cualquier solicitud de video
- Los tokens se renuevan automáticamente 5 minutos antes de expirar

**Flujo del token:**
```
App carga → GET /api/stream/session → Token en memoria → 
hls.js adjunta X-Session-Token → Backend valida → Acceso permitido
```

**Por qué es efectivo:**
- Un atacante que copie una URL del proxy no tendrá un token válido
- Los tokens expiran en 30 minutos — copiar y reusar es impráctivo
- El token no está en `localStorage`, por lo que no es accesible via XSS básico
- Cada sesión tiene un ID único (`sid`) para auditoría

**Configuración:**
```env
SESSION_SECRET=valor_aleatorio_largo_y_seguro
SESSION_TOKEN_TTL_SECONDS=1800
```

---

### Capa 4: Proxy de Streaming Backend

**Archivo:** [`server/controllers/streamProxy.js`](./controllers/streamProxy.js)

**Amenaza cubierta:** Exposición directa de URLs de Backblaze B2.

**Implementación:**
- El cliente **nunca** recibe URLs de B2 — ni en respuestas JSON, ni en el código fuente
- Todos los videos se sirven a través de `/api/stream/video/:videoId`
- Los fragmentos HLS se sirven a través de `/api/stream/hls?key=...`
- Los archivos `.m3u8` se reescriben en tiempo real para que todas las URLs apunten al proxy
- El proxy hace `pipe` del stream de B2 al cliente de forma transparente

**Reescritura de .m3u8:**
```
# Original (nunca llega al cliente):
https://f005.backblazeb2.com/file/bucket/hls/abc/720p/index.m3u8

# Reescrito (lo que ve el cliente):
/api/stream/hls?key=hls%2Fabc%2F720p%2Findex.m3u8&vid=abc
```

**Validación de keys:**
- Solo se permiten keys que empiecen con `hls/` o `thumbnails/`
- Se bloquean path traversal (`..`, `//`)
- Solo extensiones válidas: `.m3u8`, `.ts`, `.jpg`, `.png`, `.webp`

---

### Capa 5: CORS en Backblaze B2

**Archivo:** [`server/scripts/setup-b2-cors.js`](./scripts/setup-b2-cors.js)

**Amenaza cubierta:** Acceso directo al bucket de B2 desde dominios no autorizados.

**Implementación:**
- Configura reglas CORS en el bucket de B2 via la API de Backblaze
- Solo permite solicitudes de los dominios en `ALLOWED_ORIGINS`
- Modo `proxy-only`: Solo permite uploads (PUT/POST), no lecturas (GET)
- Modo `upload-only`: Permite uploads y lecturas desde dominios autorizados

**Uso:**
```bash
# Modo proxy-only (máxima seguridad — usar cuando el proxy esté funcionando)
node server/scripts/setup-b2-cors.js --mode=proxy-only

# Modo upload-only (durante transición)
node server/scripts/setup-b2-cors.js --mode=upload-only
```

**Nota:** Esta es una capa de defensa secundaria. El proxy backend es la protección principal. CORS en B2 bloquea acceso desde el navegador, pero no desde herramientas de línea de comandos (curl, wget).

---

### Capa 6: Rate Limiting

**Archivo:** [`server/middleware/rateLimiter.js`](./middleware/rateLimiter.js)

**Amenaza cubierta:** Scraping automatizado, extracción masiva de contenido.

**Límites configurados:**

| Endpoint | Límite | Ventana | Variable de entorno |
|----------|--------|---------|---------------------|
| `/api/stream/video/*` | 120 req/IP | 15 min | `STREAM_RATE_MAX` |
| `/api/stream/hls` | 120 req/IP | 15 min | `STREAM_RATE_MAX` |
| `/api/stream/session` | 20 req/IP | 15 min | `SESSION_RATE_MAX` |
| Metadata de video | 200 req/IP | 15 min | `VIDEO_META_RATE_MAX` |

**Justificación de límites:**
- Un usuario legítimo viendo un video HLS genera ~1 solicitud por fragmento (cada 6s)
- En 15 minutos: ~150 fragmentos para 1 video
- El límite de 120 permite reproducción normal pero bloquea scraping masivo
- Para múltiples videos simultáneos, ajustar `STREAM_RATE_MAX`

**Configuración:**
```env
STREAM_RATE_WINDOW_MS=900000
STREAM_RATE_MAX=120
SESSION_RATE_WINDOW_MS=900000
SESSION_RATE_MAX=20
DISABLE_RATE_LIMIT=false
```

---

### Capa 7: Logging y Monitoreo

**Archivo:** [`server/config/logger.js`](./config/logger.js)

**Amenaza cubierta:** Detección tardía de abuso, extracción sistemática.

**Datos registrados por cada acceso:**

```json
{
  "event": "video_access",
  "ip": "192.168.1.1",
  "resource": "videoId_o_key",
  "authorized": true,
  "reason": null,
  "origin": "https://tudominio.com",
  "referer": "https://tudominio.com/video/abc",
  "tokenValid": true,
  "sessionId": "a1b2c3d4",
  "userAgent": "Mozilla/5.0...",
  "statusCode": 200,
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

**Eventos registrados:**
- `video_access` — Cada intento de acceso a video (autorizado o rechazado)
- `rate_limit` — Cuando se excede el límite de tasa
- `session_issued` — Cuando se emite un nuevo token de sesión

**Archivos de log (producción):**
- `server/logs/app-YYYY-MM-DD.log` — Log general
- `server/logs/video-access-YYYY-MM-DD.log` — Log de accesos a video

**Consultas útiles para detectar abuso:**
```bash
# IPs con más rechazos en las últimas 24h
cat server/logs/video-access-*.log | jq 'select(.authorized == false)' | jq -r '.ip' | sort | uniq -c | sort -rn | head -20

# Solicitudes sin token válido
cat server/logs/video-access-*.log | jq 'select(.tokenValid == false and .authorized == false)'

# Picos de tráfico por hora
cat server/logs/video-access-*.log | jq -r '.timestamp' | cut -c1-13 | sort | uniq -c
```

---

## Configuración de Variables de Entorno

Agregar al archivo `server/.env`:

```env
# ─── Protección de Video ──────────────────────────────────────────────────────
ALLOWED_ORIGINS=https://tudominio.com,https://www.tudominio.com
SESSION_SECRET=<generar con: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))">
SESSION_TOKEN_TTL_SECONDS=1800
SIGNED_URL_TTL_SECONDS=1200

# ─── Rate Limiting ────────────────────────────────────────────────────────────
STREAM_RATE_WINDOW_MS=900000
STREAM_RATE_MAX=120
SESSION_RATE_WINDOW_MS=900000
SESSION_RATE_MAX=20
VIDEO_META_RATE_MAX=200
DISABLE_RATE_LIMIT=false

# ─── Logging ──────────────────────────────────────────────────────────────────
LOG_LEVEL=info
```

---

## Endpoints del Sistema de Protección

### `GET /api/stream/session`
Emite un token de sesión anónimo.

**Rate limit:** 20 req/15min por IP

**Respuesta:**
```json
{
  "success": true,
  "data": {
    "sessionToken": "eyJhbGciOiJIUzI1NiJ9...",
    "expiresIn": 1800,
    "renewBefore": 1500
  }
}
```

### `GET /api/stream/video/:videoId`
Proxy del master.m3u8 o video directo.

**Headers requeridos:**
- `X-Session-Token: <token>` (o cookie `stream_session`)
- `Origin: https://tudominio.com`

**Rate limit:** 120 req/15min por IP

### `GET /api/stream/hls?key=<b2Key>&vid=<videoId>`
Proxy de fragmentos HLS (.ts) y playlists de calidad (.m3u8).

**Headers requeridos:** Mismos que el endpoint anterior.

**Rate limit:** 120 req/15min por IP (compartido con el endpoint anterior)

---

## Instalación de Dependencias

```bash
cd server
npm install express-rate-limit winston winston-daily-rotate-file
```

---

## Guía de Despliegue

### 1. Configurar variables de entorno
```bash
cp server/.env.example server/.env
# Editar server/.env con los valores reales
```

### 2. Generar SESSION_SECRET
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 3. Configurar CORS en B2
```bash
# Durante transición (permite lecturas directas como fallback)
node server/scripts/setup-b2-cors.js --mode=upload-only

# Cuando el proxy esté completamente funcional
node server/scripts/setup-b2-cors.js --mode=proxy-only
```

### 4. Crear directorio de logs
```bash
mkdir -p server/logs
```

### 5. Verificar funcionamiento
```bash
# Solicitar token de sesión
curl http://localhost:5000/api/stream/session

# Intentar acceso sin token (debe retornar 401)
curl http://localhost:5000/api/stream/video/VIDEO_ID

# Acceso con token (debe retornar el video)
TOKEN=$(curl -s http://localhost:5000/api/stream/session | jq -r '.data.sessionToken')
curl -H "X-Session-Token: $TOKEN" -H "Origin: http://localhost:3000" \
  http://localhost:5000/api/stream/video/VIDEO_ID
```

---

## Limitaciones y Consideraciones

### Lo que este sistema NO previene:
1. **Screen recording:** Un usuario puede grabar la pantalla mientras reproduce el video.
2. **Ataques sofisticados:** Un atacante con acceso al código fuente puede replicar el flujo de autenticación.
3. **Acceso desde el servidor:** Las URLs firmadas de B2 son accesibles desde cualquier servidor.

### Recomendaciones adicionales:
1. **Watermarking invisible:** Incrustar un identificador único en cada stream para rastrear filtraciones.
2. **DRM (Widevine/FairPlay):** Para contenido de alto valor, implementar DRM completo.
3. **CDN con token auth:** Usar Cloudflare con Token Authentication para una capa adicional.
4. **Monitoreo activo:** Revisar los logs de `video-access` regularmente para detectar patrones de abuso.

---

## Mantenimiento

### Rotar SESSION_SECRET
Al rotar el `SESSION_SECRET`, todos los tokens de sesión activos se invalidan. Los usuarios necesitarán recargar la aplicación para obtener un nuevo token.

```bash
# Generar nuevo secret
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
# Actualizar SESSION_SECRET en .env
# Reiniciar el servidor
```

### Ajustar límites de rate limiting
Si los usuarios legítimos reportan errores 429, aumentar `STREAM_RATE_MAX`:
```env
STREAM_RATE_MAX=200  # Aumentar si hay usuarios con conexiones lentas que necesitan más reintentos
```

### Agregar nuevos dominios autorizados
```env
ALLOWED_ORIGINS=https://dominio1.com,https://dominio2.com,https://app.dominio3.com
```
Luego re-ejecutar el script de CORS de B2:
```bash
node server/scripts/setup-b2-cors.js --mode=proxy-only
```
