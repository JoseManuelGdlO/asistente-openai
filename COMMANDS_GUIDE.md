# 🎮 Guía de Comandos del Sistema

## 📋 Descripción General

El sistema de comandos permite controlar remotamente los bots de cada cliente/consultorio mediante mensajes de WhatsApp. Cada cliente tiene su propio código de acceso y puede gestionar su bot independientemente.

## 🔑 Formato de Comandos

### **Sintaxis Básica**
```
#CLIENTE001 /comando
```

### **Ejemplos**
```
#CLIENTE001 /off      - Apagar bot del Cliente 001
#CLIENTE002 /on       - Encender bot del Cliente 002
#CLIENTE001 /status   - Ver estado del bot del Cliente 001
```

## 📱 Comandos Disponibles

### **🤖 Control del Bot**

| Comando | Descripción | Autorización |
|---------|-------------|--------------|
| `/off` | Apagar bot | ✅ Requerida |
| `/on` | Encender bot | ✅ Requerida |
| `/restart` | Reiniciar bot | ✅ Requerida |
| `/status` | Ver estado del bot | ✅ Requerida |

### **📋 Información**

| Comando | Descripción | Autorización |
|---------|-------------|--------------|
| `/help` | Ver comandos disponibles | ❌ No requerida |
| `/info` | Información del consultorio | ❌ No requerida |

### **🛑 Lista de bloqueados (blacklist)**

| Comando | Descripción | Autorización |
|---------|-------------|--------------|
| `/blacklist` | Gestionar números a los que el bot no responde | ✅ Requerida (solo admin) |

Los números en la blacklist de un cliente no reciben respuesta del bot (ni siquiera a comandos). Solo el número administrador del cliente puede gestionar la lista.

**Subcomandos:**

- `#ID /blacklist list` — Ver todos los números bloqueados.
- `#ID /blacklist add 521234567890` — Añadir un número a la lista.
- `#ID /blacklist remove 521234567890` — Quitar un número de la lista.

**Ejemplos:**
```
#CLIENTE001 /blacklist list
#CLIENTE001 /blacklist add 5216189999999
#CLIENTE001 /blacklist remove 5216189999999
```

## 🔐 Sistema de Autorización

### **Números Autorizados**
- Solo el número configurado para cada cliente puede ejecutar comandos que requieren autorización
- Los comandos `/help` e `/info` están disponibles para cualquier número
- La autenticación compara solo el número sin `@c.us`

## 🏥 Detección Automática de Clientes

### **Cómo Funciona**
El sistema detecta automáticamente qué cliente es basándose en el **número de teléfono del asistente** (destinatario):

1. **Mensaje llega** → Sistema extrae el campo `to` del mensaje
2. **Busca cliente** → Compara con `CLIENTE001_ASSISTANT_PHONE`, `CLIENTE002_ASSISTANT_PHONE`, etc.
3. **Identifica cliente** → Encuentra el código del cliente (CLIENTE001, CLIENTE002, etc.)
4. **Usa asistente correcto** → Obtiene el `CLIENTE001_ASSISTANT` correspondiente
5. **Procesa mensaje** → Usa el asistente específico del cliente

### **Configuración de Números**
- **`CLIENTE001_PHONE`**: Número del administrador (quien puede enviar comandos)
- **`CLIENTE001_ASSISTANT_PHONE`**: Número donde llegan los mensajes del asistente
- **`CLIENTE001_ASSISTANT`**: ID del asistente de OpenAI para este cliente

### **Ejemplo Práctico**
```
Mensaje llega a: 6182191002
Sistema busca: CLIENTE001_ASSISTANT_PHONE=6182191002 ✓
Cliente detectado: CLIENTE001
Asistente usado: asst-abc123
Thread guardado: usuario_CLIENTE001
```

## 📱 Envío de Respuestas

### **Respuestas Automáticas**
- ✅ **Todas las respuestas de comandos se envían automáticamente por WhatsApp**
- ✅ **Respuestas inmediatas**: El bot responde instantáneamente al comando
- ✅ **Logging detallado**: Se registra el envío de cada respuesta
- ✅ **Manejo de errores**: Si falla el envío, se registra el error

### **Flujo de Respuesta**
1. **Usuario envía comando**: `#CLIENTE001 /status`
2. **Sistema procesa comando**: Valida autorización y ejecuta acción
3. **Genera respuesta**: Crea mensaje con el resultado
4. **Envía por WhatsApp**: Usa UltraMsg para enviar la respuesta
5. **Confirma envío**: Registra en logs el resultado

### **Configuración de Clientes**
```env
# Cliente 1
CLIENTE001_PHONE=5216181344331@c.us          # Número del administrador
CLIENTE001_ASSISTANT_PHONE=6182191002        # Número donde llegan los mensajes del asistente
CLIENTE001_NAME=Consultorio Dr. García
CLIENTE001_ASSISTANT=asst-abc123

# Cliente 2
CLIENTE002_PHONE=5216182191002@c.us          # Número del administrador
CLIENTE002_ASSISTANT_PHONE=6181344331        # Número donde llegan los mensajes del asistente
CLIENTE002_NAME=Clínica Dental Sonrisa
CLIENTE002_ASSISTANT=asst-def456
```

## 📊 Estados del Bot

### **🟢 ACTIVO**
- El bot responde normalmente a todos los mensajes
- Procesa consultas con IA
- Envía confirmaciones automáticas

### **🔴 INACTIVO**
- El bot no responde a mensajes normales
- Solo responde a comandos
- Muestra mensaje: "Bot está apagado. Escribe #CLIENTE001 /on para encenderlo."

## 🎯 Ejemplos de Uso

### **Apagar Bot**
```
Usuario: #CLIENTE001 /off
Bot: 🤖 Bot de Consultorio Dr. García APAGADO
     Ya no responderá a mensajes normales.
```
*La respuesta se envía automáticamente por WhatsApp*

### **Ver Estado**
```
Usuario: #CLIENTE001 /status
Bot: 📊 Estado del bot de Consultorio Dr. García:
     🟢 ACTIVO
     Asistente: asst-abc123
```
*La respuesta se envía automáticamente por WhatsApp*

### **Obtener Ayuda**
```
Usuario: #CLIENTE001 /help
Bot: 📋 Comandos disponibles para Consultorio Dr. García:

     /off - Apagar bot (Solo autorizados)
     /on - Encender bot (Solo autorizados)
     /status - Ver estado del bot (Solo autorizados)
     /restart - Reiniciar bot (Solo autorizados)
     /help - Ver comandos disponibles
     /info - Información del consultorio

     💡 Uso: #CLIENTE001 /comando
```
*La respuesta se envía automáticamente por WhatsApp*

### **Información del Consultorio**
```
Usuario: #CLIENTE001 /info
Bot: 🏥 Información de Consultorio Dr. García:

     📞 Admin: 5216181344331@c.us
     📱 Asistente: 6182191002
     🤖 ID Asistente: asst-abc123
     📊 Estado: 🟢 ACTIVO
     🔑 Código: CLIENTE001
```
*La respuesta se envía automáticamente por WhatsApp*

## ❌ Casos de Error

### **Cliente No Encontrado**
```
Usuario: #CLIENTE999 /status
Bot: ❌ Cliente no encontrado: CLIENTE999
     Verifica el código del cliente.
```

### **No Autorizado**
```
Usuario: #CLIENTE001 /off (desde número no autorizado)
Bot: ❌ No autorizado para controlar el bot de Consultorio Dr. García.
     Solo el número 5216181344331@c.us puede ejecutar este comando.
```

### **Formato Incorrecto**
```
Usuario: CLIENTE001 /status
Bot: ❌ Formato de comando incorrecto.
     Uso: #CLIENTE001 /comando
```

### **Comando No Reconocido**
```
Usuario: #CLIENTE001 /invalid
Bot: ❌ Comando no reconocido: /invalid
     Escribe #CLIENTE001 /help para ver comandos disponibles.
```

## 🔧 Configuración Avanzada

### **Agregar Nuevo Cliente**
1. Agregar variables de entorno en `.env`:
```env
CLIENTE003_PHONE=5216189999999@c.us
CLIENTE003_NAME=Centro Médico Integral
CLIENTE003_ASSISTANT=asst-ghi789
```

2. Reiniciar el servidor
3. El cliente estará disponible automáticamente

### **Cambiar Número Autorizado**
1. Modificar la variable `CLIENTE001_PHONE` en `.env`
2. Reiniciar el servidor
3. El nuevo número tendrá acceso inmediato

## 📡 Endpoints de API

### **Ver Estado de Todos los Bots**
```bash
GET /bots/status
```

### **Ver Configuración de Clientes**
```bash
GET /clients
```

### **Ejecutar Comando Manualmente**
```bash
POST /bots/command
{
  "clientCode": "CLIENTE001",
  "command": "/status",
  "phoneNumber": "5216181344331@c.us"
}
```

## 🧪 Testing

### **Probar Comandos**
```bash
npm run test-commands
```

### **Probar Manualmente**
1. Enviar mensaje: `#CLIENTE001 /help`
2. Verificar que la respuesta llegue por WhatsApp
3. Probar otros comandos
4. Revisar logs del servidor para confirmar envío

## 🔒 Seguridad

### **Características de Seguridad**
- ✅ **Autenticación por número**: Solo números autorizados pueden controlar bots
- ✅ **Validación de clientes**: Verifica que el cliente exista
- ✅ **Logging detallado**: Registra todos los comandos ejecutados
- ✅ **Respuestas informativas**: Mensajes claros sobre errores

### **Buenas Prácticas**
- 🔐 Mantener los números de teléfono seguros
- 📝 Documentar cambios en la configuración
- 🔍 Revisar logs regularmente
- 🔄 Hacer respaldos de la configuración

## 🚀 Flujo de Trabajo Típico

### **1. Configuración Inicial**
```
1. Configurar variables de entorno
2. Reiniciar servidor
3. Verificar clientes: GET /clients
4. Probar comando: #CLIENTE001 /help
```

### **2. Uso Diario**
```
1. Cliente apaga bot: #CLIENTE001 /off
2. Bot no responde a mensajes normales
3. Cliente enciende bot: #CLIENTE001 /on
4. Bot responde normalmente
```

### **3. Monitoreo**
```
1. Verificar estado: #CLIENTE001 /status
2. Revisar logs del servidor
3. Usar endpoint: GET /bots/status
```

## 📞 Soporte

### **Comandos de Diagnóstico**
```
#CLIENTE001 /status  - Ver estado actual
#CLIENTE001 /info    - Ver configuración
#CLIENTE001 /help    - Ver comandos disponibles
```

### **Logs del Servidor**
- Buscar mensajes que empiecen con `🎮 Comando ejecutado:`
- Verificar `Enviando respuesta de comando via UltraMsg a:`
- Confirmar `Respuesta de comando enviada:`
- Revisar errores de autorización o envío

---

**¡El sistema de comandos está listo para usar! 🎉** 