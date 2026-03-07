# Arquitectura HLS Streaming — Stream-In

## Visión General

Esta arquitectura implementa un pipeline completo de transcodificación de video con HLS
(HTTP Live Streaming) multi-bitrate, usando Backblaze B2 como almacenamiento, BullMQ
como sistema de colas, FFmpeg para transcodificación y Redis como broker de mensajes.

---

## Diagrama de Flujo Completo

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          FLUJO DE UPLOAD Y TRANSCODIFICACIÓN                │
└─────────────────────────────────────────────────────────────────────────────┘

  CLIENTE (React)
      │
      │ 1. POST /api/upload/generate-presigned-url
      │    { fileName, contentType, fileSize }
      ▼
  BACKEND (Express)
      │
      │ 2. Genera presigned URL firmada (15 min TTL)
      │    Retorna: { uploadUrl, fileKey, videoId (pendiente) }
      ▼
  CLIENTE (React)
      │
      │ 3. PUT {uploadUrl} — sube MP4 directamente a B2
      │    (sin pasar por el servidor → 0 CPU/RAM del backend)
      ▼
  BACKBLAZE B2
      │
      │ 4. Archivo MP4 almacenado en: raw/{userId}/{uuid}.mp4
      ▼
  CLIENTE (React)
      │
      │ 5. POST /api/transcode/enqueue
      │    { fileKey, videoId, title, description, tags }
      ▼
  BACKEND (Express)
      │
      │ 6. Valida JWT, crea registro Video en MongoDB (status: "pending")
      │    Encola job en BullMQ → Redis
      ▼
  REDIS (BullMQ Queue: "transcode")
      │
      │ 7. Job disponible en cola
      ▼
  WORKER (transcodeWorker.js — proceso separado)
      │
      │ 8. Descarga MP4 desde B2 → /tmp/{jobId}/input.mp4
      │
      │ 9. FFmpeg genera HLS multi-bitrate:
      │    /tmp/{jobId}/
      │    ├── 1080p/  → stream_0.m3u8 + *.ts
      │    ├── 720p/   → stream_1.m3u8 + *.ts
      │    ├── 480p/   → stream_2.m3u8 + *.ts
      │    └── master.m3u8
      │
      │ 10. Sube todos los segmentos HLS a B2:
      │     hls/{videoId}/master.m3u8
      │     hls/{videoId}/1080p/stream.m3u8
      │     hls/{videoId}/1080p/seg000.ts ... segN.ts
      │     hls/{videoId}/720p/...
      │     hls/{videoId}/480p/...
      │
      │ 11. Elimina MP4 original de B2 (raw/{userId}/{uuid}.mp4)
      │
      │ 12. Limpia /tmp/{jobId}/ del disco local
      │
      │ 13. Actualiza MongoDB:
      │     Video.status = "ready"
      │     Video.hlsMasterUrl = "https://cdn.../hls/{videoId}/master.m3u8"
      │     Video.qualities = ["1080p", "720p", "480p"]
      │     Video.duration = 3600 (segundos)
      ▼
  CLIENTE (React)
      │
      │ 14. Polling GET /api/videos/{videoId}/status
      │     o WebSocket para notificación en tiempo real
      │
      │ 15. Cuando status = "ready":
      │     Reproduce master.m3u8 con hls.js
      │     ABR automático según ancho de banda del usuario
      └──────────────────────────────────────────────────────
```

---

## Estructura de Directorios del Servidor

```
server/
├── index.js                    # Entry point Express
├── package.json                # Dependencias
├── .env                        # Variables de entorno
│
├── config/
│   ├── b2.js                   # Cliente S3 para Backblaze B2
│   ├── redis.js                # Conexión Redis (BullMQ)
│   └── ffmpeg.js               # Configuración FFmpeg
│
├── models/
│   └── Video.js                # Schema MongoDB (actualizado con campos HLS)
│
├── queues/
│   └── transcodeQueue.js       # Definición de cola BullMQ
│
├── workers/
│   └── transcodeWorker.js      # Worker de transcodificación (proceso separado)
│
├── controllers/
│   ├── upload.js               # Presigned URLs para subida directa
│   ├── transcode.js            # Encolar jobs, consultar estado
│   └── video.js                # CRUD videos
│
├── routes/
│   ├── upload.js               # /api/upload/*
│   ├── transcode.js            # /api/transcode/*
│   └── videos.js               # /api/videos/*
│
└── scripts/
    ├── setup-b2-cors.js        # Configurar CORS en B2
    └── cleanup.js              # Limpieza de archivos temporales huérfanos
```

---

## Estructura de Archivos en Backblaze B2

```
streamin-videos/
├── raw/                        # MP4 originales (temporales, se eliminan post-transcode)
│   └── {userId}/
│       └── {uuid}.mp4
│
├── hls/                        # Segmentos HLS (permanentes)
│   └── {videoId}/
│       ├── master.m3u8         ← URL que consume el frontend
│       ├── 1080p/
│       │   ├── stream.m3u8
│       │   ├── seg000.ts
│       │   └── seg001.ts ...
│       ├── 720p/
│       │   ├── stream.m3u8
│       │   └── seg*.ts
│       └── 480p/
│           ├── stream.m3u8
│           └── seg*.ts
│
└── thumbnails/                 # Miniaturas de video
    └── {userId}/
        └── {uuid}.jpg
```

---

## Schema MongoDB — Video (Actualizado)

```javascript
{
  // Identificación
  _id: ObjectId,
  userId: String,               // Propietario del video

  // Metadata del video
  title: String,
  description: String,
  tags: [String],
  duration: Number,             // Duración en segundos

  // Thumbnail
  imgUrl: String,               // URL pública de la miniatura
  imgKey: String,               // Key en B2

  // Estado de transcodificación
  status: {
    type: String,
    enum: ['pending', 'processing', 'ready', 'error'],
    default: 'pending'
  },

  // Archivo original (temporal)
  rawKey: String,               // raw/{userId}/{uuid}.mp4 — se elimina post-transcode

  // HLS Output
  hlsMasterUrl: String,         // URL pública del master.m3u8
  hlsBaseKey: String,           // hls/{videoId}/ — prefijo en B2
  qualities: [String],          // ['1080p', '720p', '480p']

  // Metadata de procesamiento
  transcodeJobId: String,       // ID del job en BullMQ
  transcodeError: String,       // Mensaje de error si falló
  transcodedAt: Date,           // Fecha de finalización

  // Estadísticas
  views: Number,
  likes: [String],
  dislikes: [String],

  // Timestamps
  createdAt: Date,
  updatedAt: Date
}
```

---

## Configuración FFmpeg — Perfiles de Calidad

```
┌──────────┬──────────────┬──────────┬──────────────┬──────────────────┐
│ Calidad  │ Resolución   │ Bitrate  │ Audio        │ Segmento HLS     │
├──────────┼──────────────┼──────────┼──────────────┼──────────────────┤
│ 1080p    │ 1920x1080    │ 4000k    │ 192k AAC     │ 6 segundos       │
│ 720p     │ 1280x720     │ 2500k    │ 128k AAC     │ 6 segundos       │
│ 480p     │ 854x480      │ 1000k    │ 96k AAC      │ 6 segundos       │
└──────────┴──────────────┴──────────┴──────────────┴──────────────────┘
```

### Comando FFmpeg Optimizado

```bash
ffmpeg -i input.mp4 \
  # Stream 1080p
  -map 0:v -map 0:a \
  -c:v:0 libx264 -b:v:0 4000k -maxrate:v:0 4400k -bufsize:v:0 8000k \
  -vf:0 "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2" \
  -c:a:0 aac -b:a:0 192k \
  \
  # Stream 720p
  -map 0:v -map 0:a \
  -c:v:1 libx264 -b:v:1 2500k -maxrate:v:1 2750k -bufsize:v:1 5000k \
  -vf:1 "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2" \
  -c:a:1 aac -b:a:1 128k \
  \
  # Stream 480p
  -map 0:v -map 0:a \
  -c:v:2 libx264 -b:v:2 1000k -maxrate:v:2 1100k -bufsize:v:2 2000k \
  -vf:2 "scale=854:480:force_original_aspect_ratio=decrease,pad=854:480:(ow-iw)/2:(oh-ih)/2" \
  -c:a:2 aac -b:a:2 96k \
  \
  # Opciones globales de optimización
  -preset fast \          # Balance velocidad/compresión
  -g 48 \                 # GOP size = 2 * framerate (24fps)
  -sc_threshold 0 \       # Deshabilitar scene change detection
  -keyint_min 48 \        # Keyframe mínimo
  \
  # Output HLS
  -f hls \
  -hls_time 6 \           # Segmentos de 6 segundos
  -hls_playlist_type vod \
  -hls_flags independent_segments \
  -hls_segment_type mpegts \
  -hls_segment_filename "output/%v/seg%03d.ts" \
  -master_pl_name "master.m3u8" \
  -var_stream_map "v:0,a:0 v:1,a:1 v:2,a:2" \
  "output/%v/stream.m3u8"
```

---

## Sistema de Colas — BullMQ

### Configuración de la Cola

```javascript
// Prioridades de jobs
const JOB_OPTIONS = {
  attempts: 3,              // Reintentos en caso de fallo
  backoff: {
    type: 'exponential',
    delay: 5000             // 5s, 10s, 20s entre reintentos
  },
  removeOnComplete: {
    age: 86400,             // Mantener jobs completados 24h
    count: 100              // Máximo 100 jobs completados en memoria
  },
  removeOnFail: {
    age: 604800             // Mantener jobs fallidos 7 días para debug
  }
}
```

### Estados del Job

```
pending → processing → ready
                    ↘ error (con reintentos automáticos)
```

### Concurrencia del Worker

```javascript
// Un worker puede procesar N jobs simultáneos
// Ajustar según CPU disponible:
// - 1 vCPU:  concurrency: 1
// - 2 vCPU:  concurrency: 2
// - 4 vCPU:  concurrency: 3 (dejar 1 para el sistema)
const worker = new Worker('transcode', processor, {
  connection: redisConnection,
  concurrency: parseInt(process.env.WORKER_CONCURRENCY) || 1,
  limiter: {
    max: 10,                // Máximo 10 jobs por minuto
    duration: 60000
  }
})
```

---

## Optimización de Recursos

### CPU
- `preset fast` en FFmpeg: 40% menos CPU vs `slow`, calidad aceptable
- Concurrencia configurable del worker (1 job por defecto)
- Workers en proceso separado → no bloquean el servidor Express

### RAM
- Descarga MP4 a disco temporal (`/tmp/`) → no en memoria
- Streaming de upload a B2 con `fs.createReadStream()` → no carga todo en RAM
- BullMQ usa Redis como broker → estado de jobs fuera de memoria del proceso

### Storage
- MP4 original eliminado inmediatamente después de transcodificar
- Archivos temporales en `/tmp/{jobId}/` eliminados al finalizar el job
- Solo persisten los segmentos HLS en B2

### Egress Bandwidth
- Subida directa cliente→B2 (presigned URL) → 0 bytes pasan por el servidor
- Descarga worker→B2 es interna (mismo datacenter si el worker está en el mismo proveedor)
- Frontend consume HLS desde B2 directamente (o Cloudflare CDN)

---

## Integración con Cloudflare CDN

### Configuración Recomendada

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────┐
│   Cliente   │────▶│  Cloudflare CDN  │────▶│ Backblaze B2 │
│  (hls.js)  │     │  (cache HLS)     │     │  (origin)    │
└─────────────┘     └──────────────────┘     └──────────────┘
```

1. **Configurar dominio personalizado** en Cloudflare apuntando al bucket B2
2. **Cache Rules** para segmentos `.ts`: `Cache-Control: public, max-age=31536000`
3. **Cache Rules** para playlists `.m3u8`: `Cache-Control: public, max-age=5` (VOD puede ser más largo)
4. **Cloudflare Stream** como alternativa si el volumen crece mucho

### Variables de Entorno para CDN

```env
# Sin CDN (directo a B2)
HLS_BASE_URL=https://f005.backblazeb2.com/file/streamin-videos

# Con Cloudflare CDN
HLS_BASE_URL=https://cdn.tudominio.com
```

---

## Estrategia de Escalabilidad

### Horizontal Scaling

```
┌─────────────────────────────────────────────────────────┐
│                    LOAD BALANCER                        │
└──────────────┬──────────────────────────────────────────┘
               │
    ┌──────────┴──────────┐
    ▼                     ▼
┌────────┐           ┌────────┐
│ API 1  │           │ API 2  │    ← Express servers (stateless)
└────────┘           └────────┘
    │                     │
    └──────────┬──────────┘
               ▼
         ┌──────────┐
         │  REDIS   │              ← Cola compartida BullMQ
         └──────────┘
               │
    ┌──────────┴──────────┐
    ▼                     ▼
┌────────┐           ┌────────┐
│Worker 1│           │Worker 2│   ← Workers independientes
└────────┘           └────────┘
    │                     │
    └──────────┬──────────┘
               ▼
         ┌──────────┐
         │    B2    │              ← Almacenamiento compartido
         └──────────┘
```

### Recomendaciones por Volumen

| Usuarios/día | API Servers | Workers | Redis | Concurrencia |
|-------------|-------------|---------|-------|--------------|
| < 100       | 1           | 1       | 1     | 1            |
| 100-1000    | 1-2         | 1-2     | 1     | 2            |
| 1000-10000  | 2-4         | 2-4     | 1 HA  | 3            |
| > 10000     | 4+          | 4+      | Cluster | 4+         |

---

## Seguridad

- **Presigned URLs**: TTL de 15 minutos, solo para el archivo específico
- **fileKey validation**: El worker verifica que el `rawKey` pertenezca al `userId`
- **Job ownership**: Solo el propietario puede encolar transcodificación de su video
- **Bucket privado**: Los archivos `raw/` son privados; solo `hls/` es público
- **Rate limiting**: BullMQ limiter previene abuso de la cola

---

## Monitoreo

### Bull Board (Dashboard de Colas)

```javascript
import { createBullBoard } from '@bull-board/api'
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter'
import { ExpressAdapter } from '@bull-board/express'

// Accesible en: http://localhost:5000/admin/queues
```

### Métricas Clave a Monitorear

- Jobs en cola (waiting)
- Jobs en proceso (active)
- Jobs fallidos (failed) — alertar si > 5%
- Tiempo promedio de transcodificación
- Espacio en `/tmp/` del worker
- Egress de B2 (costo)

---

## Variables de Entorno Requeridas

```env
# Base de datos
DB_URI=mongodb+srv://...
JWT_SECRET=...

# Backblaze B2
B2_KEY_ID=...
B2_APP_KEY=...
B2_BUCKET_NAME=streamin-videos
B2_REGION=us-east-005
B2_ENDPOINT=https://s3.us-east-005.backblazeb2.com
B2_PUBLIC_URL=https://f005.backblazeb2.com/file/streamin-videos

# Redis (BullMQ)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Worker
WORKER_CONCURRENCY=1
TEMP_DIR=/tmp/transcode
FFMPEG_PATH=/usr/bin/ffmpeg

# CDN (opcional)
HLS_BASE_URL=https://f005.backblazeb2.com/file/streamin-videos
```

---

## Dependencias a Instalar

```bash
# En el servidor
npm install bullmq ioredis fluent-ffmpeg @ffmpeg-installer/ffmpeg

# Opcional: Dashboard de monitoreo
npm install @bull-board/api @bull-board/express
```

---

## Checklist de Implementación

- [ ] Instalar Redis (local o Redis Cloud)
- [ ] Instalar FFmpeg en el servidor worker
- [ ] Actualizar `server/models/Video.js` con campos HLS
- [ ] Crear `server/config/redis.js`
- [ ] Crear `server/queues/transcodeQueue.js`
- [ ] Crear `server/workers/transcodeWorker.js`
- [ ] Crear `server/controllers/transcode.js`
- [ ] Crear `server/routes/transcode.js`
- [ ] Registrar ruta en `server/index.js`
- [ ] Actualizar `front/src/components/Upload.jsx` para flujo presigned URL
- [ ] Crear `front/src/components/HLSPlayer.jsx` con hls.js
- [ ] Configurar CORS en B2 para subida directa
- [ ] Configurar Cloudflare (opcional, fase 2)
