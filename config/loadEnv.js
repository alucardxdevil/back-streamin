/**
 * Carga variables de entorno antes que el resto de módulos.
 * - `.env` — configuración base (no versionar secretos).
 * - `.env.local` — overrides para tu máquina (puerto, NODE_ENV, Redis local).
 *   Debe estar en .gitignore.
 */
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, '..')

dotenv.config({ path: path.join(rootDir, '.env') })
dotenv.config({ path: path.join(rootDir, '.env.local'), override: true })
