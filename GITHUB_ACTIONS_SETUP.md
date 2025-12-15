# Guía de Setup: GitHub Actions + Gemini AI

Esta guía te ayudará a configurar el procesamiento automático de órdenes de compra usando GitHub Actions y Google Gemini AI.

## Índice

1. [Resumen](#resumen)
2. [Requisitos Previos](#requisitos-previos)
3. [Configuración de Google Gemini](#configuración-de-google-gemini)
4. [Configuración de GitHub](#configuración-de-github)
5. [Ejecución](#ejecución)
6. [Monitoreo](#monitoreo)
7. [Troubleshooting](#troubleshooting)

---

## Resumen

**Arquitectura**:
```
GitHub Actions (cada hora)
    ↓
1. Leer pending.json (50 códigos)
2. Scrape con Playwright + xvfb
3. Procesar PDFs con Gemini AI
4. Comparar datos → marca
5. Guardar en processed.json
6. Eliminar archivos temporales
7. Commit cambios
```

**Costos**: $0/mes (todo gratis)
- GitHub Actions: Ilimitado (repo público)
- Gemini AI: 1,500 requests/día gratis

**Timeline**: ~38 días para 54k órdenes

---

## Requisitos Previos

### 1. Repositorio GitHub

- **Opción A (Recomendada)**: Repo público → minutos ilimitados
- **Opción B**: Repo privado → 2,000 minutos/mes gratis

### 2. Cuenta Google Cloud

Necesitas una cuenta de Google para obtener la API key de Gemini (gratis).

---

## Configuración de Google Gemini

### Paso 1: Ir a Google AI Studio

1. Visita [Google AI Studio](https://aistudio.google.com/)
2. Inicia sesión con tu cuenta de Google

### Paso 2: Crear API Key

1. En la página principal, haz clic en "Get API key"
2. Selecciona "Create API key"
3. **IMPORTANTE**: Copia la API key inmediatamente (solo se muestra una vez)

Ejemplo de API key:
```
AIzaSyC1234567890abcdefghijklmnopqrstuvwx
```

### Paso 3: Verificar Límites

En Google AI Studio puedes ver tus límites:
- **Requests/día**: 1,500 (gratis)
- **Requests/minuto**: 15

---

## Configuración de GitHub

### Paso 1: Configurar Secret

1. Ve a tu repositorio en GitHub
2. Settings → Secrets and variables → Actions
3. Clic en "New repository secret"
4. Nombre: `GOOGLE_AI_API_KEY`
5. Value: Tu API key de Gemini
6. Clic en "Add secret"

### Paso 2: Verificar GitHub Actions está Habilitado

1. Settings → Actions → General
2. Verificar que "Allow all actions and reusable workflows" esté seleccionado
3. **Nota**: Los permisos de escritura ya están configurados en los workflows (`permissions: contents: write`), no necesitas cambiar nada aquí

### Paso 3: Instalar Dependencias Localmente (Primera vez)

```bash
cd /path/to/RindeChile/analysis
pnpm install
```

Esto instalará:
- `@google/generative-ai` (nueva dependencia)
- `playwright`
- `p-limit`
- `tsx`

---

## Ejecución

### Paso 1: Carga Inicial (Solo una vez)

Este paso carga todos los códigos del CSV a `data/pending.json`.

1. Ve a tu repo en GitHub
2. Actions → "Load Initial Codes"
3. Clic en "Run workflow"
4. Espera ~30 segundos

**Resultado**: Se creará `data/pending.json` con ~54k códigos

### Paso 2: Primera Ejecución de Prueba

Antes de activar el cron, prueba manualmente:

1. Actions → "Process Orders"
2. Clic en "Run workflow"
3. Batch size: `5` (para testing)
4. Espera ~5-10 minutos

**Qué verificar**:
- ✅ Workflow completado exitosamente
- ✅ Se creó `data/processed.json` con resultados
- ✅ Códigos removidos de `data/pending.json`
- ✅ Marca correcta (sobreprecio/falta_datos/normal)

### Paso 3: Activar Procesamiento Automático

El workflow `process-orders.yml` ya tiene configurado un cron:

```yaml
schedule:
  - cron: '0 * * * *' # Cada hora
```

**Acciones**:
- Se ejecutará automáticamente cada hora
- Procesará 50 códigos por ejecución (configurable)
- ~38 días para completar 54k órdenes

**Modificar batch size** (opcional):

Edita [.github/workflows/process-orders.yml](.github/workflows/process-orders.yml):

```yaml
env:
  BATCH_SIZE: ${{ github.event.inputs.batch_size || '60' }} # Cambiar de 50 a 60
```

---

## Monitoreo

### Ver Logs de Ejecución

1. GitHub → Actions
2. Selecciona workflow "Process Orders"
3. Clic en la ejecución más reciente
4. Ver logs en tiempo real

### Ver Progreso

**Opción A**: Revisar commits

Los commits automáticos muestran el progreso:
```
chore: update processed orders [skip ci]
```

**Opción B**: Leer archivos de datos

En tu repo, navega a:
- `data/pending.json` → Códigos pendientes
- `data/processed.json` → Órdenes procesadas
- `data/failed.json` → Códigos fallidos

**Opción C**: Script local

```bash
node -e "
const pending = require('./data/pending.json');
const processed = require('./data/processed.json');
const failed = require('./data/failed.json');

console.log('Pending:', pending.totalPending);
console.log('Processed:', processed.totalProcessed);
console.log('Failed:', failed.totalFailed);
console.log('Completion:', (processed.totalProcessed / (pending.totalPending + processed.totalProcessed + failed.totalFailed) * 100).toFixed(2) + '%');
"
```

---

## Troubleshooting

### Error: "GOOGLE_AI_API_KEY is not set"

**Causa**: El secret no está configurado

**Solución**:
1. Verifica que el secret existe en Settings → Secrets
2. El nombre debe ser exactamente `GOOGLE_AI_API_KEY`

### Error: "Rate limit exceeded"

**Causa**: Excediste 1,500 requests/día de Gemini

**Soluciones**:
1. **Esperar 24 horas**: El límite se resetea diariamente
2. **Reducir batch size**: Cambiar de 50 a 30 códigos
3. **Crear múltiples API keys**: Usa diferentes proyectos de Google Cloud

### Error: "Failed to navigate to purchase order"

**Causa**: Mercado Público bloqueó el scraping

**Soluciones**:
1. Verificar que xvfb esté funcionando
2. Agregar más delays aleatorios
3. Reducir concurrencia

### Workflow no se ejecuta automáticamente

**Causa**: Cron deshabilitado o repo inactivo

**Soluciones**:
1. Verifica que Actions esté habilitado
2. Repos sin actividad por 60 días desactivan workflows → hacer un commit dummy

### Error: "Permission denied" al hacer commit

**Causa**: Permisos insuficientes para el GITHUB_TOKEN

**Solución**:

Los workflows ya tienen `permissions: contents: write` configurado. Si aún así falla:

1. Verifica que Actions esté habilitado en Settings → Actions
2. Si el repo es de una organización, verifica que la org permita workflows con permisos de escritura
3. Como último recurso, usa un Personal Access Token (PAT):
   - Crea un PAT en GitHub Settings → Developer settings → Personal access tokens
   - Agrégalo como secret: `GITHUB_TOKEN_CUSTOM`
   - Modifica el step de commit para usar: `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN_CUSTOM }}`

---

## Estructura de Datos

### `data/pending.json`

```json
{
  "codes": ["3506-434-SE25", "2564-169-SE25", ...],
  "lastUpdated": "2025-12-15T10:00:00Z",
  "totalPending": 54298
}
```

### `data/processed.json`

```json
{
  "orders": [
    {
      "code": "3506-434-SE25",
      "marca": "sobreprecio",
      "items": [
        {
          "descripcion": "Equipo de computo",
          "cantidad": 1,
          "precio_unitario": 15042016
        }
      ],
      "total_orden": 15042016,
      "processedAt": "2025-12-15T10:30:00Z",
      "confidence": "alta",
      "filesProcessed": 3
    }
  ],
  "totalProcessed": 28
}
```

### `data/failed.json`

```json
{
  "codes": [
    {
      "code": "1234-567-SE25",
      "error": "Failed to navigate",
      "attempts": 2,
      "lastAttempt": "2025-12-15T11:00:00Z"
    }
  ],
  "totalFailed": 5
}
```

---

## Comandos Útiles

### Ejecutar localmente (testing)

```bash
# Instalar dependencias
pnpm install

# Procesar un código individual
pnpm tsx docs/scraper-single.ts "3506-434-SE25"

# Procesar un batch completo
export GOOGLE_AI_API_KEY="tu_api_key"
export BATCH_SIZE=5
pnpm tsx scripts/process-batch.ts
```

### Reintentar códigos fallidos

Crea un nuevo workflow o ejecuta manualmente:

```bash
node -e "
const { getRetryableFailed } = require('./scripts/data-manager.js');
const codes = getRetryableFailed(3);
console.log('Codes to retry:', codes);
"
```

---

## Optimizaciones

### Procesar Más Rápido

**Opción 1**: Aumentar batch size
```yaml
BATCH_SIZE: '60' # De 50 a 60
```

**Opción 2**: Ejecutar más frecuentemente
```yaml
schedule:
  - cron: '0 */2 * * *' # Cada 2 horas (en vez de cada hora)
```

**Opción 3**: Múltiples API keys

Crea 3-5 proyectos en Google Cloud, cada uno con su API key:
- `GOOGLE_AI_API_KEY`
- `GOOGLE_AI_API_KEY_2`
- `GOOGLE_AI_API_KEY_3`

Luego modifica `gemini-processor.ts` para rotar entre keys.

---

## Resumen de Costos

| Servicio | Costo |
|----------|-------|
| GitHub Actions (público) | $0 |
| Google Gemini (1500/día) | $0 |
| **Total** | **$0/mes** |

---

## Siguientes Pasos

1. ✅ Obtener API key de Gemini
2. ✅ Configurar secret en GitHub
3. ✅ Ejecutar "Load Initial Codes"
4. ⬜ Ejecutar prueba con 5 códigos
5. ⬜ Verificar resultados
6. ⬜ Activar cron automático
7. ⬜ Monitorear progreso

¡Listo! El sistema procesará automáticamente todas las órdenes en ~38 días. 🚀
