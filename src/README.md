# 📁 Estructura del Proyecto

## Organización de Carpetas

```
src/
├── index.js                    # 🚀 Punto de entrada principal
├── managers/                   # 🔌 Gestores de servicios externos
│   ├── openAIManager.js       # 🤖 Gestor de OpenAI
│   ├── ultramsgManager.js     # 📱 Gestor de UltraMsg
│   └── facebookTokenManager.js # 🔑 Gestor de tokens Facebook
├── services/                   # ⚙️ Servicios de negocio
│   ├── confirmationManager.js  # ✅ Gestor de confirmaciones
│   ├── userContextManager.js   # 👤 Gestor de contexto de usuario
│   └── scheduler.js           # ⏰ Scheduler de tareas
├── controllers/                # 🎮 Controladores de endpoints
│   ├── webhookManager.js      # 🌐 Controlador de webhooks
│   └── schedulerController.js # 🎛️ Controlador del scheduler
└── utils/                      # 🛠️ Utilidades (futuro)
```

## 📋 Descripción de Carpetas

### 🚀 `index.js`
- **Propósito**: Punto de entrada principal de la aplicación
- **Responsabilidad**: Configuración del servidor Express, middleware y definición de endpoints
- **Dependencias**: Importa todas las clases de las otras carpetas

### 🔌 `managers/`
- **Propósito**: Gestores de servicios externos y APIs
- **Contenido**:
  - `openAIManager.js`: Maneja todas las interacciones con OpenAI
  - `ultramsgManager.js`: Gestiona la comunicación con UltraMsg
  - `facebookTokenManager.js`: Maneja tokens de Facebook (legacy)

### ⚙️ `services/`
- **Propósito**: Lógica de negocio y servicios internos
- **Contenido**:
  - `confirmationManager.js`: Detecta y maneja mensajes de confirmación
  - `userContextManager.js`: Gestiona el contexto de conversación de usuarios
  - `scheduler.js`: Programa y ejecuta tareas automáticas

### 🎮 `controllers/`
- **Propósito**: Controladores que manejan las peticiones HTTP
- **Contenido**:
  - `webhookManager.js`: Procesa webhooks de UltraMsg
  - `schedulerController.js`: Maneja endpoints del scheduler

### 🛠️ `utils/`
- **Propósito**: Utilidades y helpers (preparado para futuro)
- **Contenido**: Vacío por ahora, para futuras utilidades

## 🔄 Flujo de Dependencias

```
index.js
├── managers/
│   ├── openAIManager.js
│   ├── ultramsgManager.js
│   └── facebookTokenManager.js
├── services/
│   ├── confirmationManager.js
│   ├── userContextManager.js
│   └── scheduler.js (depende de ultramsgManager)
└── controllers/
    ├── webhookManager.js (depende de managers y services)
    └── schedulerController.js (depende de scheduler)
```

## 📝 Convenciones de Nomenclatura

- **Archivos**: camelCase (ej: `userContextManager.js`)
- **Clases**: PascalCase (ej: `UserContextManager`)
- **Carpetas**: camelCase (ej: `userContextManager`)

## 🎯 Beneficios de esta Estructura

1. **Separación de Responsabilidades**: Cada carpeta tiene un propósito específico
2. **Escalabilidad**: Fácil agregar nuevos managers, servicios o controladores
3. **Mantenibilidad**: Cambios aislados por funcionalidad
4. **Legibilidad**: Estructura clara y fácil de navegar
5. **Reutilización**: Servicios y managers pueden ser reutilizados

## 🚀 Cómo Agregar Nuevos Archivos

### Nuevo Manager
```bash
# Crear en managers/
touch src/managers/nuevoManager.js
```

### Nuevo Servicio
```bash
# Crear en services/
touch src/services/nuevoServicio.js
```

### Nuevo Controlador
```bash
# Crear en controllers/
touch src/controllers/nuevoController.js
```

### Nueva Utilidad
```bash
# Crear en utils/
touch src/utils/nuevaUtilidad.js
```

## 📚 Documentación Relacionada

- `REFACTORING_GUIDE.md` - Guía completa de la refactorización
- `REFACTORING_SUMMARY.md` - Resumen ejecutivo
- `SCHEDULER_GUIDE.md` - Documentación del scheduler 