/**
 * Escapa caracteres especiales de expresiones regulares en strings de usuario.
 * Previene ReDoS e inyección de operadores regex en consultas MongoDB $regex.
 * @param {string} s
 * @returns {string}
 */
export function escapeRegex(s) {
  if (typeof s !== 'string') return ''
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
