const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');
const axios = require('axios');
const FacebookTokenManager = require('./facebookTokenManager');
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

// Initialize Facebook Token Manager
const facebookTokenManager = new FacebookTokenManager();

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

// WhatsApp Webhook verification
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      console.log('Webhook verified successfully');
      res.status(200).send(challenge);
    } else {
      console.log('Webhook verification failed');
      res.sendStatus(403);
    }
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

// Endpoint para refrescar manualmente el token de Facebook
app.post('/refresh-token', async (req, res) => {
  try {
    console.log('=== Refresh manual de token solicitado ===');
    const currentToken = await facebookTokenManager.getValidToken();
    const newToken = await facebookTokenManager.refreshAndSaveToken(currentToken);
    
    res.json({ 
      ok: true, 
      message: 'Token refrescado exitosamente',
      refreshDate: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error en refresh manual:', error);
    res.status(500).json({ 
      ok: false, 
      error: 'Error al refrescar token',
      details: error.message 
    });
  }
});

// Endpoint para ver el estado del token
app.get('/token-status', async (req, res) => {
  try {
    const token = await facebookTokenManager.getValidTokenWithAutoRefresh();
    const tokenData = await facebookTokenManager.loadToken();
    
    let daysUntilExpiry = null;
    let needsRefresh = false;
    
    if (tokenData?.expiresAt) {
      const expiresAt = new Date(tokenData.expiresAt);
      const now = new Date();
      daysUntilExpiry = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));
      needsRefresh = daysUntilExpiry < 5;
    }
    
    res.json({
      ok: true,
      hasToken: !!token,
      tokenLength: token ? token.length : 0,
      lastRefresh: facebookTokenManager.lastRefreshDate,
      expiresAt: tokenData?.expiresAt,
      daysUntilExpiry: daysUntilExpiry,
      needsRefresh: needsRefresh,
      autoRefreshEnabled: true
    });
  } catch (error) {
    console.error('Error al obtener estado del token:', error);
    res.status(500).json({ 
      ok: false, 
      error: 'Error al obtener estado del token',
      details: error.message 
    });
  }
});



// WhatsApp Webhook for receiving messages
app.post('/webhook', async (req, res) => {
  try {
    const { body } = req;
    console.log('=== Nueva petición recibida ===');
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Body completo:', JSON.stringify(body, null, 2));
    console.log('Tipo de petición:', body.object);
    console.log('Timestamp:', new Date().toISOString());
    
    // Verificar si es una petición de verificación
    if (body.object === 'whatsapp_business_account') {
      if (body.entry && body.entry[0].changes) {
        const change = body.entry[0].changes[0];
        console.log('Tipo de cambio:', change.field);
        
        // Si es un cambio de estado, solo responder OK
        if (change.field === 'status') {
          console.log('Cambio de estado recibido');
          return res.sendStatus(200);
        }

        // Verificar si hay mensajes
        if (!change.value?.messages?.[0]) {
          console.log('No hay mensajes en la petición');
          return res.sendStatus(200);
        }

        const message = change.value.messages[0];
        console.log('Mensaje recibido de:', message.from);
        console.log('ID del mensaje:', message.id);
        console.log('Tipo de mensaje:', message.type);
        
        // Verificar si ya procesamos este mensaje
        if (processedMessages.has(message.id)) {
          console.log('Mensaje ya procesado, ignorando:', message.id);
          return res.sendStatus(200);
        }

        // Marcar mensaje como procesado ANTES de procesarlo
        processedMessages.add(message.id);

        // Verificar si es un mensaje de texto
        if (message.type !== 'text') {
          console.log('Mensaje no es de tipo texto, ignorando');
          return res.sendStatus(200);
        }

        const phone_number_id = change.value.metadata.phone_number_id;
        const from = message.from;
        const msg_body = message.text.body;

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
            const messageData = {
              messaging_product: 'whatsapp',
              to: from,
              text: { 
                body: confirmationResponse 
              }
            };
            
            console.log('Enviando respuesta de confirmación a WhatsApp');
            
            const validToken = await facebookTokenManager.getValidTokenWithAutoRefresh();
            
            const response = await axios({
              method: 'POST',
              url: `https://graph.facebook.com/v17.0/${phone_number_id}/messages`,
              headers: {
                'Authorization': `Bearer ${validToken}`,
                'Content-Type': 'application/json',
              },
              data: messageData
            });
            
            console.log('Respuesta de confirmación enviada:', response.data);
            
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
          // Opcional: puedes enviar un mensaje a WhatsApp aquí avisando que espere
          // O simplemente responder 429
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

        // Enviar respuesta a WhatsApp
        try {
          const messageData = {
            messaging_product: 'whatsapp',
            to: from,
            text: { 
              body: aiResponse 
            }
          };
          
          console.log('Enviando mensaje a WhatsApp:', JSON.stringify(messageData, null, 2));
          console.log('=== Verificando caducidad del token antes de enviar mensaje ===');
          
          // Obtener token válido de Facebook con verificación automática de caducidad
          const validToken = await facebookTokenManager.getValidTokenWithAutoRefresh();
          
          const response = await axios({
            method: 'POST',
            url: `https://graph.facebook.com/v17.0/${phone_number_id}/messages`,
            headers: {
              'Authorization': `Bearer ${validToken}`,
              'Content-Type': 'application/json',
            },
            data: messageData
          });
          
          console.log('Respuesta de WhatsApp:', response.data);
        } catch (error) {
          console.error('Error al enviar mensaje a WhatsApp:', error.response?.data || error.message);
          throw error;
        }
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
    console.log('- WHATSAPP_TOKEN:', process.env.WHATSAPP_TOKEN ? 'Configurado' : 'NO CONFIGURADO');
    console.log('- WHATSAPP_VERIFY_TOKEN:', process.env.WHATSAPP_VERIFY_TOKEN ? 'Configurado' : 'NO CONFIGURADO');
    console.log('- FB_APP_ID:', process.env.FB_APP_ID ? 'Configurado' : 'NO CONFIGURADO');
    console.log('- FB_APP_SECRET:', process.env.FB_APP_SECRET ? 'Configurado' : 'NO CONFIGURADO');
    
    
    console.log('=== SERVER READY ===');
}); 