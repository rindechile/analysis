# Guía de Setup: n8n para RindeChile Analysis

Esta guía te ayudará a configurar el sistema completo de n8n para procesar órdenes de compra públicas chilenas.

## Índice

1. [Requisitos Previos](#requisitos-previos)
2. [Configuración de Google Cloud](#configuración-de-google-cloud)
3. [Setup de Infraestructura](#setup-de-infraestructura)
4. [Configuración de n8n](#configuración-de-n8n)
5. [Creación de Flujos](#creación-de-flujos)
6. [Testing](#testing)
7. [Troubleshooting](#troubleshooting)

---

## Requisitos Previos

### Software Necesario
- Docker & Docker Compose
- Cuenta de Google Cloud (gratis)
- 50GB de espacio en disco

### Conocimientos
- Básico de Docker
- Básico de Google Cloud Console
- Básico de Google Sheets

---

## Configuración de Google Cloud

### 1. Crear Proyecto en Google Cloud Console

1. Ve a [Google Cloud Console](https://console.cloud.google.com/)
2. Crea un nuevo proyecto llamado "RindeChile"
3. Anota el **Project ID**

### 2. Habilitar APIs Necesarias

Habilita las siguientes APIs en tu proyecto:

```
1. Google Sheets API
2. Google Drive API
3. Generative Language API (Gemini)
```

**Pasos:**
1. En Cloud Console, ve a "APIs & Services" > "Library"
2. Busca cada API y haz clic en "Enable"

### 3. Crear API Key para Gemini

1. Ve a "APIs & Services" > "Credentials"
2. Haz clic en "Create Credentials" > "API Key"
3. Copia la API key generada
4. **IMPORTANTE**: Restringe la API key a solo "Generative Language API"

**Opcional: Crear múltiples API keys**
Para procesar más rápido, crea 3-5 API keys con diferentes proyectos de Google Cloud. Cada una tendrá su propio límite de 1500 req/día.

### 4. Configurar OAuth2 para Sheets/Drive

1. Ve a "APIs & Services" > "OAuth consent screen"
2. Selecciona "External" y completa la información básica
3. Agrega scopes:
   - `https://www.googleapis.com/auth/spreadsheets`
   - `https://www.googleapis.com/auth/drive`
4. Crea OAuth Client ID:
   - Application type: "Web application"
   - Authorized redirect URIs: `http://localhost:5678/rest/oauth2-credential/callback`
5. Descarga el JSON de credenciales

---

## Setup de Infraestructura

### 1. Clonar y Configurar Variables de Entorno

```bash
cd /path/to/RindeChile/analysis

# Copiar archivo de ejemplo
cp .env.example .env

# Editar con tus credenciales
nano .env
```

**Configuración mínima en `.env`:**
```env
N8N_USER=admin
N8N_PASSWORD=tu_password_seguro
GOOGLE_AI_API_KEY=tu_api_key_de_gemini
```

### 2. Crear Google Sheets

Crea una nueva Google Sheet con 3 hojas:

**Hoja 1: "pendientes"**
| codigo | estado | intentos | fecha_agregado | ultimo_intento |
|--------|--------|----------|----------------|----------------|

**Hoja 2: "procesadas"**
| codigo | marca | items_json | total_orden | archivos_count | fecha_procesado | confianza |
|--------|-------|------------|-------------|----------------|-----------------|-----------|

**Hoja 3: "errores"**
| codigo | error | intentos | fecha | detalles |
|--------|-------|----------|-------|----------|

Comparte la hoja con tu cuenta de servicio o asegúrate de tener permisos de edición.

### 3. Iniciar Servicios Docker

```bash
# Construir e iniciar servicios
docker-compose up -d

# Ver logs
docker-compose logs -f

# Verificar que están corriendo
docker-compose ps
```

Deberías ver:
```
rindechile-n8n       running   0.0.0.0:5678->5678/tcp
rindechile-scraper   running
```

### 4. Acceder a n8n

1. Abre tu navegador en `http://localhost:5678`
2. Inicia sesión con las credenciales de `.env`:
   - Usuario: `admin` (o el que configuraste)
   - Contraseña: la de `N8N_PASSWORD`

---

## Configuración de n8n

### 1. Configurar Credenciales de Google

#### Google Sheets & Drive (OAuth2)

1. En n8n, ve a "Settings" > "Credentials"
2. Clic en "Add Credential" > "Google OAuth2 API"
3. Completa:
   - Client ID: del JSON descargado
   - Client Secret: del JSON descargado
   - OAuth Callback URL: `http://localhost:5678/rest/oauth2-credential/callback`
4. Clic en "Connect my account" y autoriza

#### Google AI (Gemini)

1. "Add Credential" > "Google PaLM API" (o busca "Google AI")
2. Pega tu API key de Gemini
3. Guarda como "Gemini API Key"

### 2. Test de Credenciales

Crea un workflow simple para probar:
1. Nuevo workflow
2. Agrega nodo "Google Sheets" > "Read"
3. Selecciona tu credencial
4. Selecciona tu spreadsheet
5. Ejecuta manualmente

Si funciona, tus credenciales están correctas.

---

## Creación de Flujos

### Flujo 1: Carga Inicial de Códigos

**Objetivo**: Cargar todos los códigos del CSV a Google Sheets

**Nodos:**
1. **Manual Trigger**
2. **Read Binary File**
   - File Path: `/data/purchases.csv`
3. **Spreadsheet File**
   - Operation: "Read From File"
   - File Format: CSV
4. **Code Node** (JavaScript):
```javascript
// Extraer códigos únicos
const items = $input.all();
const codes = new Set();

for (const item of items) {
  if (item.json.chilecompra_code) {
    codes.add(item.json.chilecompra_code);
  }
}

return Array.from(codes).map(code => ({
  json: {
    codigo: code,
    estado: 'pendiente',
    intentos: 0,
    fecha_agregado: new Date().toISOString(),
    ultimo_intento: ''
  }
}));
```
5. **Google Sheets**
   - Operation: "Append"
   - Range: "pendientes!A:E"

**Ejecutar solo una vez** para cargar los ~54k códigos.

---

### Flujo 2: Procesamiento Principal

**Objetivo**: Procesar órdenes de compra cada hora

**Trigger:**
- Schedule Trigger: `0 * * * *` (cada hora)

**Nodos:**

1. **Google Sheets - Leer Pendientes**
   - Operation: "Read"
   - Sheet: "pendientes"
   - Filters: `estado = "pendiente"`
   - Limit: 50

2. **IF - ¿Hay códigos?**
   - Condition: `{{ $json.length > 0 }}`

3. **SplitInBatches**
   - Batch Size: 5

4. **Google Sheets - Marcar como Procesando**
   - Operation: "Update"
   - Column to Match: "codigo"
   - Values to Update:
     - estado: "procesando"
     - ultimo_intento: `{{ $now }}`

5. **Execute Command**
   - Command: `docker exec rindechile-scraper pnpm tsx /app/docs/scraper-single.ts "{{ $json.codigo }}"`
   - Timeout: 120000

6. **Code Node - Parse Output**
```javascript
const output = $('Execute Command').first().json;
const result = JSON.parse(output.stdout);

return {
  json: {
    ...result,
    timestamp: new Date().toISOString()
  }
};
```

7. **IF - ¿Scraping exitoso?**
   - Condition: `{{ $json.success === true }}`

**Rama Éxito (SI):**

8a. **Google Drive - Listar Archivos**
    - Operation: "List"
    - Folder: `downloads/{{ $json.code }}`

9a. **Loop Over Files**
    - Use Split in Batches

10a. **HTTP Request - Gemini AI**
```json
{
  "method": "POST",
  "url": "https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent",
  "headers": {
    "Content-Type": "application/json"
  },
  "queryParameters": {
    "key": "{{ $credentials.googleAI.apiKey }}"
  },
  "body": {
    "contents": [{
      "parts": [
        {
          "text": "Analiza este documento de orden de compra chilena (Mercado Público).\n\nExtrae en formato JSON:\n{\n  \"items\": [\n    {\n      \"descripcion\": \"string\",\n      \"cantidad\": number,\n      \"precio_unitario\": number\n    }\n  ],\n  \"total_orden\": number\n}\n\nReglas:\n- Precios en CLP sin símbolos\n- Si no es legible, retorna {\"error\": \"ilegible\"}"
        },
        {
          "inline_data": {
            "mime_type": "{{ $json.mimeType }}",
            "data": "{{ $binary.data.toString('base64') }}"
          }
        }
      ]
    }]
  }
}
```

11a. **Code Node - Comparar Datos**
```javascript
// Obtener todos los datos extraídos
const allData = $input.all();
const itemsPerFile = allData.map(d => d.json.items || []);

// Función para comparar arrays
function arraysEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Determinar marca
let marca = 'normal';

// Todos coinciden en exactamente 1 item
const todosIguales = itemsPerFile.every(items =>
  arraysEqual(items, itemsPerFile[0])
);

if (todosIguales && itemsPerFile[0].length === 1) {
  marca = 'sobreprecio';
} else if (!todosIguales) {
  marca = 'falta_datos';
}

return {
  json: {
    codigo: $('Execute Command').first().json.code,
    marca: marca,
    items_json: JSON.stringify(itemsPerFile[0]),
    total_orden: allData[0].json.total_orden,
    archivos_count: allData.length,
    fecha_procesado: new Date().toISOString(),
    confianza: todosIguales ? 'alta' : 'media'
  }
};
```

12a. **Google Sheets - Guardar Resultado**
    - Operation: "Append"
    - Range: "procesadas!A:G"

13a. **Google Drive - Eliminar Archivos**
    - Operation: "Delete Folder"
    - Folder: `downloads/{{ $json.codigo }}`

**Rama Error (NO):**

8b. **Google Sheets - Registrar Error**
    - Operation: "Append"
    - Range: "errores!A:E"
    - Values:
      - codigo: `{{ $json.code }}`
      - error: `{{ $json.error }}`
      - intentos: `{{ $json.intentos + 1 }}`
      - fecha: `{{ $now }}`

9b. **IF - ¿Demasiados intentos?**
    - Condition: `{{ $json.intentos >= 3 }}`
    - SI: Marcar como "fallido_permanente"
    - NO: Dejar como "pendiente" para reintentar

---

### Flujo 3: Actualización Semanal

**Trigger:**
- Schedule: `0 9 * * 1` (Lunes 9:00 AM)

**Nodos:**
1. Manual upload de nuevo CSV o webhook
2. Procesar y agregar nuevos códigos a "pendientes"

---

## Testing

### Test 1: Scraper Single

Prueba el scraper directamente:

```bash
docker exec -it rindechile-scraper pnpm tsx /app/docs/scraper-single.ts "3506-434-SE25"
```

Deberías ver JSON con resultado.

### Test 2: Flujo de Carga

1. Ejecuta el "Flujo 1: Carga Inicial" manualmente
2. Limita a 10 códigos primero (modifica el Code Node)
3. Verifica que aparezcan en Google Sheets

### Test 3: Procesamiento End-to-End

1. Ejecuta el "Flujo 2: Procesamiento Principal" manualmente
2. Procesa solo 1 código
3. Verifica:
   - Archivos descargados
   - Gemini extrajo datos
   - Se guardó en "procesadas"
   - Archivos eliminados

---

## Troubleshooting

### Error: "Failed to navigate to purchase order"
- **Causa**: Mercado Público bloqueó la request
- **Solución**: Aumenta delays aleatorios, verifica que el navegador esté en modo headed

### Error: "Rate limit exceeded" (Gemini)
- **Causa**: Excediste 1500 req/día
- **Solución**: Usa múltiples API keys o espera 24 horas

### Error: "Permission denied" (Google Sheets)
- **Causa**: Credenciales incorrectas o sheet no compartido
- **Solución**: Re-autoriza OAuth2, comparte el sheet con tu cuenta

### Docker no inicia
```bash
# Ver logs detallados
docker-compose logs -f

# Reconstruir
docker-compose down
docker-compose up --build -d
```

### Scraper muy lento
- Aumenta CONCURRENCY en config (pero ten cuidado con detección)
- Usa múltiples instancias de scraper

---

## Monitoreo y Mantenimiento

### Ver Logs de n8n
```bash
docker-compose logs -f n8n
```

### Ver Logs de Scraper
```bash
docker-compose logs -f scraper
```

### Backup de n8n Data
```bash
docker cp rindechile-n8n:/home/node/.n8n ./backup-n8n
```

### Actualizar n8n
```bash
docker-compose pull n8n
docker-compose up -d
```

---

## Resumen de Costos

| Servicio | Costo |
|----------|-------|
| VPS (DigitalOcean/Hetzner) | $20/mes |
| Google Gemini (tier gratis) | $0 |
| Google Sheets/Drive | $0 |
| **Total** | **~$20/mes** |

---

## Siguientes Pasos

1. ✅ Configurar infraestructura
2. ✅ Crear flujos básicos
3. ⬜ Procesar batch de prueba (100 órdenes)
4. ⬜ Ajustar prompts de Gemini según resultados
5. ⬜ Iniciar procesamiento masivo (54k órdenes)
6. ⬜ Configurar alertas y monitoreo

---

## Soporte

Para issues o preguntas:
- Revisa los logs de Docker
- Verifica credenciales de Google Cloud
- Prueba manualmente cada componente

¡Buena suerte con el procesamiento! 🚀
