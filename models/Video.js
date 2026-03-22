import mongoose from "mongoose";

const VideoSchema = new mongoose.Schema({
    // ─── Identificación ───────────────────────────────────────────────────────
    userId: {
        type: String,
        required: true,
    },

    // ─── Metadata del video ───────────────────────────────────────────────────
    title: {
        type: String,
        required: true,
    },
    description: {
        type: String,
        required: true,
    },
    tags: {
        type: [String],
        default: []
    },
    // Duración en segundos (extraída por FFmpeg durante transcodificación)
    duration: {
        type: Number,
        default: 0
    },

    // ─── Thumbnail ────────────────────────────────────────────────────────────
    // URL pública de la miniatura
    imgUrl: {
        type: String,
        required: true,
    },
    // Key del archivo de imagen en B2 (thumbnails/{userId}/{uuid}.jpg)
    imgKey: {
        type: String,
        default: null
    },

    // ─── Estado de transcodificación ──────────────────────────────────────────
    /**
     * pending    → Video encolado, esperando worker
     * processing → Worker descargando/transcodificando
     * ready      → HLS disponible para reproducción
     * error      → Falló la transcodificación (ver transcodeError)
     */
    status: {
        type: String,
        enum: ['pending', 'processing', 'ready', 'error'],
        default: 'pending',
        index: true
    },

    // ─── Archivo original (temporal) ──────────────────────────────────────────
    // Key del MP4 original en B2: raw/{userId}/{uuid}.mp4
    // Se elimina automáticamente después de transcodificar exitosamente
    rawKey: {
        type: String,
        default: null
    },

    // ─── HLS Output ───────────────────────────────────────────────────────────
    // URL pública del master.m3u8 (lo que consume el frontend)
    // Ejemplo: https://cdn.example.com/hls/{videoId}/master.m3u8
    hlsMasterUrl: {
        type: String,
        default: null
    },
    // Prefijo base en B2: hls/{videoId}/
    hlsBaseKey: {
        type: String,
        default: null
    },
    // Calidades disponibles generadas por FFmpeg
    qualities: {
        type: [String],
        enum: ['1080p', '720p', '480p', '360p', '240p'],
        default: []
    },

    // ─── Metadata de procesamiento ────────────────────────────────────────────
    // ID del job en BullMQ (para consultar estado en tiempo real)
    transcodeJobId: {
        type: String,
        default: null
    },
    // Mensaje de error si status === 'error'
    transcodeError: {
        type: String,
        default: null
    },
    // Fecha en que finalizó la transcodificación
    transcodedAt: {
        type: Date,
        default: null
    },
    // Tamaño del archivo original en bytes
    fileSize: {
        type: Number,
        default: 0
    },
    // Usuario que subió el archivo (redundante con userId, útil para auditoría)
    uploadedBy: {
        type: String,
        default: null
    },
    // Fecha de upload del archivo original a B2
    uploadedAt: {
        type: Date,
        default: null
    },

    // ─── Estadísticas ─────────────────────────────────────────────────────────
    views: {
        type: Number,
        default: 0,
    },
    likes: {
        type: [String],
        default: []
    },
    dislikes: {
        type: [String],
        default: [],
    },

    // ─── Campos legacy (mantener compatibilidad) ──────────────────────────────
    // videoUrl y videoKey se mantienen por compatibilidad con código existente
    // En el nuevo flujo, usar hlsMasterUrl en su lugar
    videoUrl: {
        type: String,
        default: null
    },
    videoKey: {
        type: String,
        default: null
    },
    fileType: {
        type: String,
        enum: ['video', 'image', null],
        default: null
    },
},
{
    timestamps: true
})

// ─── Índices para rendimiento ─────────────────────────────────────────────────
VideoSchema.index({ userId: 1 })
VideoSchema.index({ views: -1 })
VideoSchema.index({ createdAt: -1 })
VideoSchema.index({ tags: 1 })
VideoSchema.index({ status: 1 })                    // Para consultas de estado
VideoSchema.index({ transcodeJobId: 1 }, { sparse: true }) // Para lookup por jobId

export default mongoose.model('Video', VideoSchema)
