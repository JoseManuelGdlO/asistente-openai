# 🔄 Guía del Servicio de Reseteo de Threads

## 📋 Descripción General

El `ThreadResetService` es un servicio dedicado para gestionar el reseteo de hilos de conversación (threads) de OpenAI y el contexto de usuarios. Proporciona una interfaz unificada y robusta para manejar estas operaciones con validación, logging y manejo de errores.

## 🏗️ Arquitectura

```
ThreadResetService
├── OpenAIManager (gestión de threads de OpenAI)
├── UserContextManager (gestión de contexto de usuarios)
└── Validación y manejo de errores
```

## 🚀 Características Principales

- ✅ **Reseteo granular**: Threads específicos por usuario y cliente
- ✅ **Reseteo masivo**: Todos los threads de un usuario o del sistema
- ✅ **Validación robusta**: Parámetros y formatos de entrada
- ✅ **Logging detallado**: Registro de todas las operaciones
- ✅ **Manejo de errores**: Respuestas estructuradas con códigos de error
- ✅ **Búsqueda avanzada**: Filtros por criterios específicos
- ✅ **Estadísticas**: Métricas del servicio en tiempo real

## 📡 Endpoints Disponibles

### 1. **Resetear Thread Específico**
```http
POST /reset_thread/:userId/:clientCode
```

**Parámetros:**
- `userId`: Número de teléfono del usuario (ej: `5216181344331@c.us`)
- `clientCode`: Código del cliente (ej: `CLIENTE001`)

**Body (opcional):**
```json
{
  "resetUserContext": true
}
```

**Ejemplo:**
```bash
curl -X POST http://localhost:3000/reset_thread/5216181344331@c.us/CLIENTE001 \
  -H "Content-Type: application/json" \
  -d '{"resetUserContext": true}'
```

**Respuesta:**
```json
{
  "ok": true,
  "message": "Thread reseteado exitosamente",
  "result": {
    "success": true,
    "userId": "5216181344331@c.us",
    "clientCode": "CLIENTE001",
    "timestamp": "2024-01-15T10:30:00.000Z",
    "operations": [
      {
        "type": "openai_thread_reset",
        "success": true,
        "message": "Thread de OpenAI reseteado para 5216181344331@c.us en CLIENTE001"
      },
      {
        "type": "user_context_reset",
        "success": true,
        "message": "Contexto de usuario reseteado para 5216181344331@c.us"
      }
    ]
  }
}
```

### 2. **Resetear Todos los Threads de un Usuario**
```http
POST /reset_user_threads/:userId
```

**Parámetros:**
- `userId`: Número de teléfono del usuario

**Body (opcional):**
```json
{
  "resetUserContext": true
}
```

**Ejemplo:**
```bash
curl -X POST http://localhost:3000/reset_user_threads/5216181344331@c.us \
  -H "Content-Type: application/json" \
  -d '{"resetUserContext": true}'
```

### 3. **Resetear Todos los Threads del Sistema**
```http
POST /reset_all_threads
```

**Body (opcional):**
```json
{
  "resetUserContext": true
}
```

**Ejemplo:**
```bash
curl -X POST http://localhost:3000/reset_all_threads \
  -H "Content-Type: application/json" \
  -d '{"resetUserContext": true}'
```

### 4. **Obtener Información de Threads**
```http
GET /threads/info
```

**Ejemplo:**
```bash
curl http://localhost:3000/threads/info
```

**Respuesta:**
```json
{
  "ok": true,
  "success": true,
  "totalThreads": 3,
  "totalUserContexts": 2,
  "threads": [
    {
      "threadKey": "5216181344331@c.us_CLIENTE001",
      "threadId": "thread_abc123",
      "userId": "5216181344331@c.us",
      "clientCode": "CLIENTE001",
      "hasActiveRun": false,
      "userContext": {
        "lastMessageType": "confirmation",
        "lastMessageTime": "2024-01-15T10:25:00.000Z",
        "confirmationCount": 1,
        "isWaitingForConfirmation": false
      },
      "hasUserContext": true
    }
  ],
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### 5. **Buscar Threads por Criterios**
```http
POST /threads/search
```

**Body:**
```json
{
  "userId": "5216181344331@c.us",
  "clientCode": "CLIENTE001",
  "hasActiveRun": false
}
```

**Ejemplo:**
```bash
curl -X POST http://localhost:3000/threads/search \
  -H "Content-Type: application/json" \
  -d '{"userId": "5216181344331@c.us"}'
```

### 6. **Obtener Estadísticas del Servicio**
```http
GET /threads/stats
```

**Ejemplo:**
```bash
curl http://localhost:3000/threads/stats
```

**Respuesta:**
```json
{
  "ok": true,
  "success": true,
  "stats": {
    "totalThreads": 5,
    "totalUserContexts": 3,
    "threadsByClient": {
      "CLIENTE001": 2,
      "CLIENTE002": 3
    },
    "threadsByUser": {
      "5216181344331@c.us": 2,
      "5216182191002@c.us": 3
    },
    "activeRuns": 1
  },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

## 🔧 Opciones de Configuración

### **resetUserContext**
- **Tipo**: `boolean`
- **Default**: `true`
- **Descripción**: Si se debe resetear también el contexto del usuario

```json
{
  "resetUserContext": false  // Solo resetea threads de OpenAI
}
```

## 📊 Códigos de Error

| Código | Descripción |
|--------|-------------|
| `VALIDATION_ERROR` | Error en la validación de parámetros |
| `SERVICE_ERROR` | Error interno del servicio |

## 🧪 Pruebas

### **Ejecutar Pruebas Completas**
```bash
node test-thread-reset-service.js
```

### **Pruebas Específicas**
```bash
# Solo pruebas básicas
node -e "require('./test-thread-reset-service').testThreadResetService()"

# Solo validaciones
node -e "require('./test-thread-reset-service').testValidations()"
```

## 📝 Casos de Uso

### **1. Usuario con Problemas de Conversación**
```bash
# Resetear thread específico del usuario
curl -X POST http://localhost:3000/reset_thread/5216181344331@c.us/CLIENTE001
```

### **2. Usuario Cambia de Cliente**
```bash
# Resetear todos los threads del usuario
curl -X POST http://localhost:3000/reset_user_threads/5216181344331@c.us
```

### **3. Limpieza General del Sistema**
```bash
# Resetear todos los threads
curl -X POST http://localhost:3000/reset_all_threads
```

### **4. Debugging y Monitoreo**
```bash
# Ver estadísticas
curl http://localhost:3000/threads/stats

# Buscar threads específicos
curl -X POST http://localhost:3000/threads/search \
  -H "Content-Type: application/json" \
  -d '{"hasActiveRun": true}'
```

## ⚠️ Consideraciones Importantes

1. **Pérdida de Contexto**: Al resetear un thread, se pierde todo el historial de conversación
2. **Runs Activos**: No se pueden resetear threads con runs activos
3. **Validación de Teléfonos**: Los números deben tener formato válido
4. **Logging**: Todas las operaciones se registran en la consola
5. **Atomicidad**: Las operaciones son atómicas (todo o nada)

## 🔍 Monitoreo

### **Logs del Servicio**
```
=== THREAD RESET SERVICE ===
Usuario: 5216181344331@c.us
Cliente: CLIENTE001
Thread reseteado: true
Contexto reseteado: true
Timestamp: 2024-01-15T10:30:00.000Z
```

### **Métricas Disponibles**
- Total de threads activos
- Threads por cliente
- Threads por usuario
- Runs activos
- Contextos de usuario

## 🚀 Integración

El servicio se integra automáticamente con:
- **OpenAIManager**: Para gestión de threads de OpenAI
- **UserContextManager**: Para gestión de contexto de usuarios
- **Endpoints REST**: Para acceso via HTTP
- **Sistema de Logging**: Para monitoreo y debugging

## 📚 Referencias

- [OpenAI API Documentation](https://platform.openai.com/docs/api-reference)
- [Express.js Documentation](https://expressjs.com/)
- [Guía de Comandos del Sistema](./COMMANDS_GUIDE.md)
