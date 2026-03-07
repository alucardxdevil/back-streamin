import mongoose from "mongoose";

const VideoSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true,
    },
    title: {
        type: String,
        required: true,
    },
    description: {
        type: String,
        required: true,
    },
    // === Campos para Backblaze B2 ===
    
    // URL pública de la imagen(miniatura)
    imgUrl: {
        type: String,
        required: true,
    },
    // URL pública del video
    videoUrl: {
        type: String,
        required: true,
    },
    // === Nuevos campos para B2 ===
    
    // Clave única del archivo de imagen en B2
    imgKey: {
        type: String,
        default: null
    },
    // Clave única del archivo de video en B2
    videoKey: {
        type: String,
        default: null
    },
    // Tipo de archivo: 'video' o 'image'
    fileType: {
        type: String,
        enum: ['video', 'image', null],
        default: null
    },
    // Tamaño del archivo en bytes
    fileSize: {
        type: Number,
        default: 0
    },
    // Usuario que subió el archivo
    uploadedBy: {
        type: String,
        default: null
    },
    // Fecha de upload a B2
    uploadedAt: {
        type: Date,
        default: null
    },
    // === Campos existentes ===
    
    views: {
        type: Number,
        default: 0,
    },
    tags: {
        type: [String],
        default: []
    },
    likes: {
        type: [String],
        default: []
    },
    dislikes: {
        type: [String],
        default: [],
    },
    duration: {
        type: String
    }
},
{
    timestamps: true
}
)

// Índices para mejorar rendimiento
VideoSchema.index({ userId: 1 })
VideoSchema.index({ views: -1 })
VideoSchema.index({ createdAt: -1 })
VideoSchema.index({ tags: 1 })

export default mongoose.model('Video', VideoSchema)
