const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');
const axios = require('axios');
const UltraMsgManager = require('./ultramsgManager');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Initialize UltraMsg Manager
const ultraMsgManager = new UltraMsgManager();

// Store thread IDs per user
const userThreads = new Map();

// Cache para mensajes procesados
const processedMessages = new Set();

// Mapa para guardar el estado de los runs por thread
const threadRuns = new Map();

// Mapa para guardar el contexto de conversación por usuario
const userContext = new Map();

// Patrones de mensajes de confirmación
const confirmationPatterns = [
  /^(muy bien|perfecto|ok|okay|vale|genial|excelente|perfecto|gracias|thank you|thanks)$/i,
  /^(muy bien gracias|perfecto gracias|ok gracias|vale gracias|genial gracias|excelente gracias)$/i,
  /^(está bien|esta bien|está perfecto|esta perfecto)$/i,
  /^(confirmado|confirmo|acepto|aceptado)$/i,
  /^(👍|✅|👌|😊|🙏)$/,
  /^(si|sí|yes|yep|yeah|claro|por supuesto)$/i
];

// Función para detectar si un mensaje es de confirmación
function isConfirmationMessage(message) {
  const cleanMessage = message.trim().toLowerCase();
  
  // Verificar patrones de confirmación
  for (const pattern of confirmationPatterns) {
    if (pattern.test(cleanMessage)) {
      return true;
    }
  }
  
  // Verificar si el mensaje es muy corto (menos de 10 caracteres) y contiene palabras de confirmación
  if (cleanMessage.length < 10) {
    const confirmationWords = ['bien', 'ok', 'vale', 'si', 'sí', 'yes', 'gracias', 'thanks', 'perfecto'];
    const words = cleanMessage.split(/\s+/);
    const hasConfirmationWord = words.some(word => confirmationWords.includes(word));
    
    if (hasConfirmationWord && words.length <= 3) {
      return true;
    }
  }
  
  return false;
}

// Función para obtener el contexto del usuario
function getUserContext(userId) {
  if (!userContext.has(userId)) {
    userContext.set(userId, {
      lastMessageType: null,
      lastMessageTime: null,
      confirmationCount: 0,
      isWaitingForConfirmation: false
    });
  }
  return userContext.get(userId);
}

// Función para actualizar el contexto del usuario
function updateUserContext(userId, messageType, messageContent) {
  const context = getUserContext(userId);
  const now = new Date();
  
  context.lastMessageType = messageType;
  context.lastMessageTime = now;
  
  if (messageType === 'confirmation') {
    context.confirmationCount++;
    context.isWaitingForConfirmation = false;
  } else if (messageType === 'agenda_sent') {
    context.isWaitingForConfirmation = true;
    context.confirmationCount = 0;
  }
  
  userContext.set(userId, context);
}

// UltraMsg Webhook verification
app.get('/webhook', (req, res) => {
  const token = req.query['token'];
  
  if (token === process.env.ULTRAMSG_WEBHOOK_TOKEN) {
    console.log('UltraMsg webhook verified successfully');
    res.status(200).send('OK');
  } else {
    console.log('UltraMsg webhook verification failed');
    res.sendStatus(403);
  }
});

app.post('/reset_threads', (req, res) => {
  userThreads.clear();
  console.log('=== Threads reseteados ===');
  res.json({ ok: true, message: 'Todos los threads de usuario han sido reseteados.' });
});

// Endpoint para marcar que se envió la agenda del día a un usuario
app.post('/mark-agenda-sent', (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ 
        ok: false, 
        error: 'userId es requerido' 
      });
    }
    
    // Marcar que se envió la agenda y estamos esperando confirmación
    updateUserContext(userId, 'agenda_sent', 'Agenda del día enviada');
    
    console.log(`=== Agenda marcada como enviada para usuario: ${userId} ===`);
    
    res.json({ 
      ok: true, 
      message: `Usuario ${userId} marcado como agenda enviada`,
      context: getUserContext(userId)
    });
  } catch (error) {
    console.error('Error al marcar agenda enviada:', error);
    res.status(500).json({ 
      ok: false, 
      error: 'Error al marcar agenda enviada',
      details: error.message 
    });
  }
});

// Endpoint para ver el contexto de un usuario
app.get('/user-context/:userId', (req, res) => {
  try {
    const { userId } = req.params;
    const context = getUserContext(userId);
    
    res.json({
      ok: true,
      userId: userId,
      context: context
    });
  } catch (error) {
    console.error('Error al obtener contexto del usuario:', error);
    res.status(500).json({ 
      ok: false, 
      error: 'Error al obtener contexto del usuario',
      details: error.message 
    });
  }
});

// Endpoint para limpiar el contexto de un usuario
app.post('/clear-user-context/:userId', (req, res) => {
  try {
    const { userId } = req.params;
    userContext.delete(userId);
    
    console.log(`=== Contexto limpiado para usuario: ${userId} ===`);
    
    res.json({ 
      ok: true, 
      message: `Contexto limpiado para usuario ${userId}`
    });
  } catch (error) {
    console.error('Error al limpiar contexto del usuario:', error);
    res.status(500).json({ 
      ok: false, 
      error: 'Error al limpiar contexto del usuario',
      details: error.message 
    });
  }
});

// UltraMsg Webhook for receiving messages
app.post('/webhook', async (req, res) => {
  try {
    const { body } = req;
    console.log('=== Nueva petición recibida de UltraMsg ===');
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Body completo:', JSON.stringify(body, null, 2));
    console.log('Timestamp:', new Date().toISOString());
    
    // Verificar si es un mensaje de UltraMsg
    if (body && body.key && body.message) {
      const message = body;
      console.log('Mensaje recibido de:', message.key.remoteJid);
      console.log('ID del mensaje:', message.key.id);
      console.log('Tipo de mensaje:', message.message.messageType);
      
      // Verificar si ya procesamos este mensaje
      if (processedMessages.has(message.key.id)) {
        console.log('Mensaje ya procesado, ignorando:', message.key.id);
        return res.sendStatus(200);
      }

      // Marcar mensaje como procesado ANTES de procesarlo
      processedMessages.add(message.key.id);

      // Verificar si es un mensaje de texto
      if (message.message.messageType !== 'conversation' && 
          message.message.messageType !== 'extendedTextMessage') {
        console.log('Mensaje no es de tipo texto, ignorando');
        return res.sendStatus(200);
      }

      const from = message.key.remoteJid.replace('@s.whatsapp.net', '');
      const msg_body = message.message.conversation || 
                      message.message.extendedTextMessage?.text || '';

      // Limpiar mensajes antiguos (mantener solo los últimos 1000)
      if (processedMessages.size > 1000) {
        const oldestMessages = Array.from(processedMessages).slice(0, processedMessages.size - 1000);
        oldestMessages.forEach(id => processedMessages.delete(id));
      }

      // === DETECCIÓN DE MENSAJES DE CONFIRMACIÓN ===
      const userCtx = getUserContext(from);
      const isConfirmation = isConfirmationMessage(msg_body);
      
      console.log('Mensaje del usuario:', msg_body);
      console.log('¿Es confirmación?', isConfirmation);
      console.log('Contexto del usuario:', userCtx);
      
      // Si es un mensaje de confirmación y estamos esperando confirmación, responder sin procesar con IA
      if (isConfirmation && userCtx.isWaitingForConfirmation) {
        console.log('Mensaje de confirmación detectado, respondiendo automáticamente');
        
        const confirmationResponse = "¡Perfecto! Me alegra saber que todo está bien. Si necesitas algo más, no dudes en preguntarme. 😊";
        
        try {
          console.log('Enviando respuesta de confirmación a UltraMsg');
          
          const response = await ultraMsgManager.sendMessage(from, confirmationResponse);
          console.log('Respuesta de confirmación enviada:', response);
          
          // Actualizar contexto del usuario
          updateUserContext(from, 'confirmation', msg_body);
          
          return res.sendStatus(200);
        } catch (error) {
          console.error('Error al enviar respuesta de confirmación:', error.response?.data || error.message);
          return res.sendStatus(500);
        }
      }
      
      // Si es confirmación pero no estamos esperando confirmación, procesar normalmente
      if (isConfirmation) {
        updateUserContext(from, 'confirmation', msg_body);
      }

      // Obtener o crear thread para el usuario
      let threadId = userThreads.get(from);
      if (!threadId) {
        console.log('Creando nuevo thread para usuario:', from);
        const thread = await openai.beta.threads.create();
        threadId = thread.id;
        userThreads.set(from, threadId);
      } else {
        console.log('Usando thread existente:', threadId);
      }

      // === CONTROL DE RUN ACTIVO ===
      let runStatus = threadRuns.get(threadId);
      if (runStatus && runStatus !== 'completed' && runStatus !== 'failed') {
        console.log('Run activo para este thread, pidiendo al usuario que espere.');
        return res.status(429).json({ error: 'Por favor espera a que termine la respuesta anterior.' });
      }
      
      // Agregar el mensaje al thread
      const threadMessage = await openai.beta.threads.messages.create(threadId, {
        role: "user",
        content: msg_body
      });
      console.log('Mensaje agregado al thread:', threadMessage.id);

      // Listar mensajes anteriores para contexto
      const previousMessages = await openai.beta.threads.messages.list(threadId, {
        order: 'desc',
        limit: 5
      });
      console.log('Mensajes anteriores en el thread:', JSON.stringify(previousMessages.data, null, 2));

      console.log('Creando run con asistente:', process.env.ASISTENTE_ID);
      // Crear y ejecutar el run
      const run = await openai.beta.threads.runs.create(threadId, {
        assistant_id: process.env.ASISTENTE_ID
      });
      console.log('Run creado:', run.id);

      // Guardar estado del run como in_progress
      threadRuns.set(threadId, 'in_progress');

      // Esperar a que termine el run (polling)
      let runStatusObj;
      let retryCount = 0;
      const maxRetries = 150; // Aumentado a 150 (5 minutos total)
      
      do {
        await new Promise(r => setTimeout(r, 2000)); // 2 segundos entre intentos
        runStatusObj = await openai.beta.threads.runs.retrieve(threadId, run.id);
        threadRuns.set(threadId, runStatusObj.status);
        console.log(`Estado del run: ${runStatusObj.status} (intento ${retryCount + 1}/${maxRetries})`);
        
        if (runStatusObj.status === 'failed') {
          console.error('Error en el run:', runStatusObj.last_error);
          break;
        }

        // Si requiere acción, manejar tool_calls
        if (runStatusObj.status === "requires_action") {
          console.log('El run requiere acción, procesando tool_calls...');
          console.log('Tool calls:', JSON.stringify(runStatusObj.required_action.submit_tool_outputs.tool_calls, null, 2));
          await handleRequiredAction({ runStatus: runStatusObj, threadId, run, openai });
        }

        retryCount++;
        if (retryCount >= maxRetries) {
          console.error(`Se alcanzó el máximo número de reintentos (${maxRetries}). El asistente está tardando más de lo esperado.`);
          console.error(`Tiempo total esperado: ${(maxRetries * 2)} segundos (${Math.round((maxRetries * 2) / 60)} minutos)`);
          break;
        }
      } while (runStatusObj.status !== "completed" && runStatusObj.status !== "failed");

      // Guardar estado final del run
      threadRuns.set(threadId, runStatusObj.status);

      let aiResponse = "No response from assistant.";
      if (runStatusObj.status === "completed") {
        console.log('Run completado, obteniendo mensajes...');
        // Obtener la respuesta del assistant
        const messages = await openai.beta.threads.messages.list(threadId, {
          order: 'desc',
          limit: 1
        });
        
        console.log('Mensajes obtenidos:', JSON.stringify(messages.data[0], null, 2));
        
        // Verificar que el mensaje sea del asistente y tenga contenido
        const lastMsg = messages.data[0];
        if (lastMsg && lastMsg.role === "assistant" && lastMsg.content && lastMsg.content[0]) {
          aiResponse = lastMsg.content[0].text.value;
          console.log('Respuesta del asistente:', aiResponse);
        } else {
          console.error('No se encontró una respuesta válida del asistente');
          aiResponse = "Lo siento, hubo un error procesando tu solicitud. ¿Podrías intentarlo de nuevo?";
        }
      } else {
        console.error('El run falló o no se completó:', runStatusObj.status);
        if (runStatusObj.last_error) {
          console.error('Error del run:', runStatusObj.last_error);
        }
        aiResponse = "Hubo un error procesando tu mensaje. Intenta de nuevo.";
      }

      // Enviar respuesta via UltraMsg
      try {
        console.log('Enviando mensaje via UltraMsg a:', from);
        console.log('Mensaje:', aiResponse);
        
        const response = await ultraMsgManager.sendMessage(from, aiResponse);
        console.log('Respuesta de UltraMsg:', response);
      } catch (error) {
        console.error('Error al enviar mensaje via UltraMsg:', error.response?.data || error.message);
        throw error;
      }
    }

    // Enviar una única respuesta al final
    return res.sendStatus(200);
  } catch (error) {
    console.error('Error processing webhook:', error);
    console.error('Error details:', error.response?.data || error.message);
    return res.sendStatus(500);
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK' });
});

// Test endpoint para verificar que el servidor recibe peticiones
app.post('/test', (req, res) => {
  console.log('=== Test endpoint recibido ===');
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Body:', JSON.stringify(req.body, null, 2));
  res.json({ 
    status: 'OK', 
    message: 'Test endpoint working',
    timestamp: new Date().toISOString(),
    body: req.body
  });
});

// Función para manejar required_action y tool_calls
async function handleRequiredAction({ runStatus, threadId, run, openai }) {
  const toolCalls = runStatus.required_action.submit_tool_outputs.tool_calls;
  const tool_outputs = await processToolCalls(toolCalls);

  // Enviar los resultados a OpenAI
  await openai.beta.threads.runs.submitToolOutputs(
    threadId,
    run.id,
    { tool_outputs }
  );
}

// Función para mapear y ejecutar tool_calls
async function processToolCalls(toolCalls) {
  const tool_outputs = [];
  for (const toolCall of toolCalls) {
    const functionName = toolCall.function.name;
    const args = JSON.parse(toolCall.function.arguments);
    let output = null;

    // Por ahora no hay funciones implementadas
    output = { error: `Función ${functionName} no implementada.` };

    tool_outputs.push({
      tool_call_id: toolCall.id,
      output: JSON.stringify(output)
    });
  }
  return tool_outputs;
}

app.listen(port, async () => {
    console.log('=== SERVER STARTED ===');
    console.log(`Server is running on port ${port}`);
    console.log(`Webhook URL: http://localhost:${port}/webhook`);
    console.log(`Test URL: http://localhost:${port}/test`);
    console.log(`Health URL: http://localhost:${port}/health`);
    console.log('Variables de entorno:');
    console.log('- OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? 'Configurado' : 'NO CONFIGURADO');
    console.log('- ASISTENTE_ID:', process.env.ASISTENTE_ID ? 'Configurado' : 'NO CONFIGURADO');
    console.log('- ULTRAMSG_TOKEN:', process.env.ULTRAMSG_TOKEN ? 'Configurado' : 'NO CONFIGURADO');
    console.log('- ULTRAMSG_INSTANCE_ID:', process.env.ULTRAMSG_INSTANCE_ID ? 'Configurado' : 'NO CONFIGURADO');
    console.log('- ULTRAMSG_WEBHOOK_TOKEN:', process.env.ULTRAMSG_WEBHOOK_TOKEN ? 'Configurado' : 'NO CONFIGURADO');
    
    // Verificar conexión con UltraMsg
    try {
      const isConnected = await ultraMsgManager.isConnected();
      console.log('- UltraMsg conectado:', isConnected ? '✅ SÍ' : '❌ NO');
      
      if (isConnected) {
        const info = await ultraMsgManager.getInstanceInfo();
        console.log('- Número de UltraMsg:', info.wid || 'No disponible');
      }
    } catch (error) {
      console.log('- UltraMsg conectado: ❌ Error verificando conexión');
      console.log('Error:', error.message);
    }

    console.log('=== SERVER READY ===');
}); 