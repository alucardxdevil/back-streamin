# Integración de Backblaze B2 - Documentación

## Resumen

Este documento describe la integración de Backblaze B2 como reemplazo de Firebase Storage en el backend de stream-in.

---

## Archivos Creados/Modificados

| Archivo | Descripción |
|---------|-------------|
| [`config/b2.js`](config/b2.js) | Configuración del cliente S3 para Backblaze B2 |
| [`controllers/upload.js`](controllers/upload.js) | Lógica de negocio para uploads |
| [`routes/upload.js`](routes/upload.js) | Endpoints de la API |
| [`models/Video.js`](models/Video.js) | Modelo actualizado con campos B2 |
| [`.env.example`](.env.example) | Variables de entorno requeridas |

---

## Flujo de Upload

### 1. Cliente solicita URL de upload

```javascript
// Frontend: Solicitar URL firmada
const response = await fetch('/api/upload/generate-upload-url', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${firebaseToken}`
  },
  body: JSON.stringify({
    fileName: 'mi-video.mp4',
    contentType: 'video/mp4',
    fileSize: 52428800  // 50MB (opcional)
  })
});

const { uploadUrl, fileKey, publicUrl, fileType } = await response.json();
```

### 2. Cliente sube archivo directamente a B2

```javascript
// Frontend: Subir archivo directamente (NO pasa por servidor)
await fetch(uploadUrl, {
  method: 'PUT',
  headers: {
    'Content-Type': 'video/mp4'
  },
  body: archivoLocal  // File o Blob
});
```

### 3. Cliente guarda referencia en MongoDB

```javascript
// Frontend: Guardar video en MongoDB
const videoResponse = await fetch('/api/videos', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${firebaseToken}`
  },
  body: JSON.stringify({
    title: 'Mi Video',
    description: 'Descripción',
    imgUrl: imagenPublicUrl,    // URL pública de la miniatura
    videoUrl: publicUrl,         // URL pública del video
    imgKey: imagenFileKey,      // Clave B2 de imagen
    videoKey: fileKey,          // Clave B2 de video
    fileType: 'video',
    fileSize: 52428800,
    tags: ['video', 'test']
  })
});
```

---

## Endpoints de la API

### POST /api/upload/generate-upload-url

Genera una URL pre-firmada para upload directo a B2.

**Headers:**
- `Authorization`: Token Firebase JWT

**Body:**
```json
{
  "fileName": "video.mp4",
  "contentType": "video/mp4",
  "fileSize": 50000000
}
```

**Respuesta:**
```json
{
  "success": true,
  "data": {
    "uploadUrl": "https://s3.us-east-005.backblazeb2.com/streamin-videos/uploads/...",
    "fileKey": "uploads/user123/1234567890-uuid.mp4",
    "publicUrl": "https://f005.backblazeb2.com/file/streamin-videos/uploads/user123/...",
    "fileType": "video",
    "expiresIn": 3600,
    "maxFileSize": 524288000,
    "contentType": "video/mp4"
  }
}
```

### POST /api/upload/confirm

Confirma que el archivo fue subido y retorna datos para guardar en Mongo.

### DELETE /api/upload/file

Elimina un archivo de B2.

---

## Configuración del Bucket en Backblaze

### 1. Crear Bucket

1. Ve a [Backblaze B2](https://www.backblaze.com/cloud-storage)
2. Crea un nuevo bucket llamado `stream-videos`
3. Selecciona la región `us-east-005`
4. **Configura como Público** (no privado)

### 2. Obtener Credenciales

1. Ve a **Application Keys**
2. Crea una nueva key con acceso al bucket
3. Copia el `Key ID` y `App Key`

### 3. Configurar CORS (Importante)

Para que el upload directo funcione desde el navegador, configura CORS en el bucket:

```json
[
    {
        "AllowedHeaders": [
            "*"
        ],
        "AllowedMethods": [
            "PUT",
            "POST",
            "GET"
        ],
        "AllowedOrigins": [
            "http://localhost:3000",
            "https://tu-dominio.com"
        ],
        "ExposeHeaders": [
            "ETag"
        ],
        "MaxAgeSeconds": 3600
    }
]
```

Para configurar CORS, usa el CLI de B2:
```bash
b2 update-bucket --cors-rules-file cors.json stream-videos public
```

O desde el panel de B2: Bucket Settings > CORS Rules

---

## Validaciones Implementadas

| Validación | Código de Error | Descripción |
|------------|-----------------|-------------|
| Token inválido | 401 | Usuario no autenticado |
| MIME inválido | 400 | Solo `image/*` y `video/*` |
| Tamaño excedido | 400 | Límite configurable (500MB por defecto) |
| Error S3 | 500 | Error de configuración |

---

## Variables de Entorno

Copia `.env.example` a `.env` y completa los valores:

```env
B2_KEY_ID=your_key_id
B2_APP_KEY=your_app_key
B2_BUCKET=streamin-videos
B2_REGION=us-east-005
B2_ENDPOINT=https://s3.us-east-005.backblazeb2.com
B2_PUBLIC_URL=https://f005.backblazeb2.com/file/streamin-videos
MAX_UPLOAD_SIZE_MB=500
```

---

## Cambios en el Frontend

### Actualizar componente de Upload

El componente [`front/src/components/Upload.jsx`](front/src/components/Upload.jsx) debe actualizarse para:

1. Solicitar URL de upload al endpoint `/api/upload/generate-upload-url`
2. Subir archivo directamente a la URL retornada
3. Usar la `publicUrl` para guardar en MongoDB

### Actualizar modelo de Video

El modelo ahora incluye:
- `imgKey`: Clave de imagen en B2
- `videoKey`: Clave de video en B2
- `fileType`: Tipo de archivo
- `fileSize`: Tamaño en bytes
- `uploadedBy`: ID del usuario
- `uploadedAt`: Fecha de upload

---

## Notas de Seguridad

1. **No exponer credenciales**: Las credenciales B2 solo existen en el servidor
2. **URLs firmadas**: Solo se firman para upload (no download)
3. **Bucket público**: Los archivos son accesibles públicamente
4. **Validación de usuario**: El `fileKey` incluye el ID del usuario
5. **Sanitización**: Nombres de archivo son sanitizados

---

## Troubleshooting

### Error: "Access Denied" en upload
- Verificar que el bucket sea público
- Verificar CORS configurado correctamente

### Error: "SignatureDoesNotMatch"
- Verificar credenciales en `.env`
- Verificar que `B2_KEY_ID` y `B2_APP_KEY` sean correctos

### Error: "No such bucket"
- Verificar que el bucket exista en B2
- Verificar nombre del bucket en `B2_BUCKET`

### URL pública no funciona
- Verificar que el bucket sea público
- Verificar `B2_PUBLIC_URL` con el ID correcto del bucket

---

## Límites de Backblaze B2

- **Upload**: Hasta 10GB por archivo (configurado a 500MB por defecto)
- **Descarga**: Ilimitado
- **Ancho de banda**: Ilimitado
- **Costo**:~$0.006/GB almacenado,~$0.01/GB descarga

Más info: [Precios de Backblaze B2](https://www.backblaze.com/cloud-storage/pricing)
