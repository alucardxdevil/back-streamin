/**
 * Filtro Mongo para listados públicos: excluye vídeos ocultos por moderación (`visibility: 'hidden'`).
 * Documentos sin campo `visibility` se consideran públicos (compatibilidad).
 */
export function publicVideoVisibilityFilter() {
  return { $nor: [{ visibility: 'hidden' }] };
}
