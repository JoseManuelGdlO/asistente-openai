# Sistema de Refresh Automático de Token de Facebook

Este sistema implementa un refresh automático del token de acceso de Facebook para evitar errores de expiración en WhatsApp Business API.

## 🚀 Características

- **Refresh automático**: Renueva el token cada 50 días automáticamente
- **Refresh manual**: Permite renovar el token manualmente cuando sea necesario
- **Persistencia**: Guarda el token en un archivo local para mantenerlo entre reinicios
- **Fallback**: Si falla el refresh, usa el token actual como respaldo
- **Monitoreo**: Endpoints para verificar el estado del token

## 📋 Configuración

### 1. Variables de Entorno

Agrega estas variables a tu archivo `.env`:

```env
# Facebook App Configuration (para refresh automático de token)
FB_APP_ID=tu-facebook-app-id
FB_APP_SECRET=tu-facebook-app-secret

# WhatsApp Configuration (token actual)
WHATSAPP_TOKEN=tu-whatsapp-access-token-actual
```

### 2. Obtener FB_APP_ID y FB_APP_SECRET

1. Ve a [Facebook Developers](https://developers.facebook.com/)
2. Crea una nueva app o selecciona una existente
3. En la configuración de la app, encuentra:
   - **App ID**: Es tu `FB_APP_ID`
   - **App Secret**: Es tu `FB_APP_SECRET`

## 🔧 Uso

### Refresh Automático

El sistema se inicializa automáticamente cuando arranca el servidor. Cada 50 días renovará el token automáticamente.

### Refresh Manual

#### Usando el script independiente:

```bash
npm run refresh-token
```

#### Usando el endpoint HTTP:

```bash
curl -X POST http://localhost:3000/refresh-token
```

### Verificar Estado del Token

```bash
curl http://localhost:3000/token-status
```

Respuesta ejemplo:
```json
{
  "ok": true,
  "hasToken": true,
  "tokenLength": 200,
  "lastRefresh": "2024-07-14T10:30:00.000Z",
  "expiresAt": "2024-09-02T10:30:00.000Z",
  "daysUntilExpiry": 45
}
```

## 📁 Archivos del Sistema

- `src/facebookTokenManager.js`: Clase principal que maneja el refresh
- `refresh-token.js`: Script independiente para refresh manual
- `token.json`: Archivo donde se guarda el token (se crea automáticamente)

## 🔄 Flujo de Funcionamiento

1. **Inicio del servidor**: Se inicializa el sistema de refresh automático
2. **Primera petición**: Se carga el token guardado o se usa el de entorno
3. **Verificación**: Antes de cada uso, se verifica si el token está próximo a expirar
4. **Refresh automático**: Si faltan menos de 5 días para expirar, se renueva automáticamente
5. **Refresh programado**: Cada 50 días se ejecuta un refresh automático

## 🛠️ Solución de Problemas

### Error: "Session has expired"

Si recibes este error, significa que tu token actual ha expirado. Para solucionarlo:

1. **Refresh inmediato**:
   ```bash
   npm run refresh-token
   ```

2. **Verificar configuración**:
   - Asegúrate de que `FB_APP_ID` y `FB_APP_SECRET` estén configurados
   - Verifica que `WHATSAPP_TOKEN` sea válido

3. **Reiniciar servidor**:
   ```bash
   npm start
   ```

### Error: "FB_APP_ID y FB_APP_SECRET deben estar configurados"

Agrega estas variables a tu archivo `.env`:

```env
FB_APP_ID=tu-app-id-de-facebook
FB_APP_SECRET=tu-app-secret-de-facebook
```

### El token no se está renovando automáticamente

1. Verifica que el servidor esté corriendo
2. Revisa los logs del servidor para ver si hay errores
3. Ejecuta un refresh manual para verificar la configuración

## 📊 Monitoreo

### Logs del Servidor

El sistema registra automáticamente:
- Inicialización del sistema de refresh
- Refresh automático ejecutado
- Errores durante el refresh
- Estado del token

### Endpoints de Monitoreo

- `GET /token-status`: Estado actual del token
- `POST /refresh-token`: Refresh manual del token

## 🔒 Seguridad

- El token se guarda en un archivo local (`token.json`)
- No se expone el token en los endpoints de estado
- Se usa HTTPS para las comunicaciones con Facebook
- El token se renueva antes de que expire para evitar interrupciones

## 📝 Notas Importantes

- El token de Facebook tiene una validez de 60 días
- El sistema renueva cada 50 días para tener margen de seguridad
- Si falla el refresh, se mantiene el token actual como fallback
- El archivo `token.json` se crea automáticamente en la raíz del proyecto 