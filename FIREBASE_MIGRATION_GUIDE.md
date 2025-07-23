# 🔥 Guía de Migración a Firebase

## 📋 Descripción

Esta guía te ayudará a migrar tu sistema de gestión de clientes desde variables de entorno a Firebase Firestore, permitiendo una gestión dinámica y escalable de clientes.

## 🚀 Ventajas de Firebase

- ✅ **Gestión dinámica**: Crear/editar/eliminar clientes sin reiniciar el servidor
- ✅ **Escalabilidad**: Sin límites de configuración
- ✅ **Persistencia**: Datos seguros en la nube
- ✅ **API completa**: Endpoints para gestión de clientes
- ✅ **Estadísticas**: Métricas en tiempo real
- ✅ **Backup automático**: Datos respaldados automáticamente

## 📋 Requisitos Previos

### 1. Crear Proyecto en Firebase
1. Ve a [Firebase Console](https://console.firebase.google.com/)
2. Crea un nuevo proyecto
3. Habilita Firestore Database
4. Configura las reglas de seguridad

### 2. Crear Service Account
1. Ve a **Project Settings** > **Service Accounts**
2. Haz clic en **Generate New Private Key**
3. Descarga el archivo JSON
4. Guarda las credenciales de forma segura

## ⚙️ Configuración

### 1. Variables de Entorno
Agrega estas variables a tu archivo `.env`:

```env
# Firebase Configuration
FIREBASE_PROJECT_ID=tu-proyecto-id
FIREBASE_CLIENT_EMAIL=tu-service-account@proyecto.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nTu-clave-privada-aqui\n-----END PRIVATE KEY-----\n"
FIREBASE_DATABASE_URL=https://tu-proyecto-id.firebaseio.com
```

### 2. Reglas de Firestore
Configura estas reglas en tu base de datos:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Permitir acceso completo a la colección clients
    match /clients/{clientId} {
      allow read, write: if true; // Para desarrollo
      // En producción, usa autenticación:
      // allow read, write: if request.auth != null;
    }
  }
}
```

## 🔄 Migración de Datos

### 1. Migración Automática
Ejecuta el script de migración:

```bash
npm run migrate-firebase
```

Este script:
- ✅ Verifica la conexión con Firebase
- ✅ Migra clientes existentes
- ✅ Evita duplicados
- ✅ Muestra estadísticas

### 2. Migración Manual
Si prefieres migrar manualmente, usa la API:

```bash
# Crear cliente
curl -X POST http://localhost:3000/clients \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Consultorio Dr. García",
    "adminPhone": "5216181344331@c.us",
    "assistantPhone": "6182191002",
    "assistantId": "asst-abc123",
    "botStatus": "active"
  }'
```

## 📡 API de Gestión de Clientes

### **Crear Cliente**
```bash
POST /clients
Content-Type: application/json

{
  "name": "Nombre del Consultorio",
  "adminPhone": "5216181344331@c.us",
  "assistantPhone": "6182191002",
  "assistantId": "asst-abc123",
  "botStatus": "active"
}
```

### **Listar Clientes**
```bash
GET /clients
```

### **Obtener Cliente Específico**
```bash
GET /clients/{clientId}
```

### **Actualizar Cliente**
```bash
PUT /clients/{clientId}
Content-Type: application/json

{
  "name": "Nuevo Nombre",
  "assistantId": "asst-nuevo123"
}
```

### **Eliminar Cliente**
```bash
DELETE /clients/{clientId}
```

### **Estadísticas**
```bash
GET /clients/stats/overview
```

### **Recargar Clientes**
```bash
POST /clients/reload
```

## 🧪 Testing

### 1. Probar Conexión
```bash
npm run test-firebase
```

### 2. Probar Comandos
```bash
npm run test-commands
```

### 3. Probar Webhook
```bash
npm run test-webhook
```

## 📊 Estructura de Datos

### **Colección: clients**
```javascript
{
  "clientId": {
    "name": "Consultorio Dr. García",
    "adminPhone": "5216181344331@c.us",
    "assistantPhone": "6182191002",
    "assistantId": "asst-abc123",
    "botStatus": "active", // active | inactive
    "status": "active", // active | deleted
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

## 🔧 Comandos Actualizados

Los comandos ahora usan IDs de Firebase en lugar de códigos:

```bash
# Antes (variables de entorno)
#CLIENTE001 /status

# Ahora (Firebase)
#abc123def456 /status
```

## 🚨 Cambios Importantes

### 1. IDs de Clientes
- **Antes**: `CLIENTE001`, `CLIENTE002`
- **Ahora**: IDs únicos de Firebase (`abc123def456`)

### 2. Gestión de Estados
- Los estados se guardan en Firebase
- Sincronización automática
- Persistencia entre reinicios

### 3. Detección de Clientes
- Búsqueda por número de asistente
- Cache local para rendimiento
- Recarga automática

## 🔒 Seguridad

### 1. Credenciales
- ✅ Nunca subas las credenciales a Git
- ✅ Usa variables de entorno
- ✅ Rota las claves regularmente

### 2. Reglas de Firestore
- ✅ Configura autenticación en producción
- ✅ Limita acceso por roles
- ✅ Valida datos de entrada

### 3. Validación
- ✅ Verifica números de teléfono
- ✅ Valida IDs de asistentes
- ✅ Sanitiza nombres

## 📈 Monitoreo

### 1. Logs del Sistema
```bash
# Buscar estos mensajes en los logs:
📋 Clientes cargados desde Firebase: [clientIds]
🏥 Cliente detectado: clientId para número: 6182191002
🤖 Usando asistente: asst-abc123 para cliente: clientId
```

### 2. Estadísticas
```bash
curl http://localhost:3000/clients/stats/overview
```

### 3. Estado de Bots
```bash
curl http://localhost:3000/bots/status
```

## 🚀 Despliegue

### 1. Variables de Entorno
Asegúrate de configurar todas las variables de Firebase en tu servidor de producción.

### 2. Reglas de Firestore
Configura reglas de seguridad apropiadas para producción.

### 3. Backup
Firebase hace backup automático, pero considera exportar datos regularmente.

## ❓ Troubleshooting

### **Error de Conexión**
```bash
❌ Error de conexión con Firebase
```
**Solución**: Verifica las credenciales y el project ID.

### **Cliente No Encontrado**
```bash
❌ No se pudo identificar el cliente para el número: 6182191002
```
**Solución**: Verifica que el cliente existe en Firebase.

### **Error de Autenticación**
```bash
❌ No autorizado para controlar el bot
```
**Solución**: Verifica el número de administrador en Firebase.

## 📞 Soporte

### **Comandos de Diagnóstico**
```bash
# Verificar conexión
npm run test-firebase

# Ver clientes
curl http://localhost:3000/clients

# Ver estadísticas
curl http://localhost:3000/clients/stats/overview

# Recargar clientes
curl -X POST http://localhost:3000/clients/reload
```

### **Logs Importantes**
- `📋 Clientes cargados desde Firebase`
- `🏥 Cliente detectado`
- `🤖 Usando asistente`
- `🎮 Comando ejecutado`

---

**¡La migración a Firebase está completa! 🎉**

Ahora tienes un sistema escalable y dinámico para gestionar clientes. 