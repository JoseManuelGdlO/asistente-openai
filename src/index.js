const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');
const axios = require('axios');
require('dotenv').config();

const GoogleCalendarService = require('./calendar');
const googleCalendarService = new GoogleCalendarService();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Store thread IDs per user
const userThreads = new Map();

// Cache para mensajes procesados
const processedMessages = new Set();

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

// WhatsApp Webhook for receiving messages
app.post('/webhook', async (req, res) => {
  try {
    const { body } = req;
    console.log('=== Nueva petición recibida ===');
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
        if (change.value && change.value.messages && change.value.messages[0]) {
          const message = change.value.messages[0];
          console.log('Mensaje recibido de:', message.from);
          console.log('ID del mensaje:', message.id);
          console.log('Tipo de mensaje:', message.type);
          
          // Verificar si ya procesamos este mensaje
          if (processedMessages.has(message.id)) {
            console.log('Mensaje ya procesado, ignorando:', message.id);
            return res.sendStatus(200);
          }

          // Verificar si es un mensaje de texto
          if (message.type === 'text') {
            const phone_number_id = change.value.metadata.phone_number_id;
            const from = message.from;
            const msg_body = message.text.body;

            // Marcar mensaje como procesado
            processedMessages.add(message.id);

            // Limpiar mensajes antiguos (mantener solo los últimos 1000)
            if (processedMessages.size > 1000) {
              const oldestMessages = Array.from(processedMessages).slice(0, processedMessages.size - 1000);
              oldestMessages.forEach(id => processedMessages.delete(id));
            }

            // Obtener o crear thread para el usuario
            let threadId = userThreads.get(from);
            if (!threadId) {
              const thread = await openai.beta.threads.create();
              threadId = thread.id;
              userThreads.set(from, threadId);
            }

            // Esperar a que no haya runs activos en el thread
            let hasActiveRun = true;
            while (hasActiveRun) {
              const runs = await openai.beta.threads.runs.list(threadId, { limit: 20 });
              hasActiveRun = runs.data.some(run =>
                ["in_progress", "queued", "cancelling", "requires_action"].includes(run.status)
              );
              if (hasActiveRun) {
                await new Promise(r => setTimeout(r, 1500));
              }
            }

            // Ahora sí, puedes agregar el mensaje y crear el run
            await openai.beta.threads.messages.create(threadId, {
              role: "user",
              content: msg_body
            });

            const run = await openai.beta.threads.runs.create(threadId, {
              assistant_id: process.env.ASISTENTE_ID
            });

            // Esperar a que termine el run (polling)
            let runStatus;
            do {
              await new Promise(r => setTimeout(r, 1500));
              runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);

              // Si requiere acción, manejar tool_calls
              if (runStatus.status === "requires_action") {
                await handleRequiredAction({ runStatus, threadId, run, openai });
              }
            } while (runStatus.status !== "completed" && runStatus.status !== "failed");

            let aiResponse = "No response from assistant.";
            if (runStatus.status === "completed") {
              // Obtener la respuesta del assistant
              const messages = await openai.beta.threads.messages.list(threadId);
              // Tomar el último mensaje del assistant
              const lastMsg = messages.data.reverse().find(m => m.role === "assistant");
              aiResponse = lastMsg ? lastMsg.content[0].text.value : aiResponse;
            } else {
              aiResponse = "Hubo un error procesando tu mensaje. Intenta de nuevo.";
            }

            // Enviar respuesta a WhatsApp
            await axios({
              method: 'POST',
              url: `https://graph.facebook.com/v17.0/${phone_number_id}/messages`,
              headers: {
                'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
                'Content-Type': 'application/json',
              },
              data: {
                messaging_product: 'whatsapp',
                to: from,
                text: { body: aiResponse }
              }
            });
          } else {
            console.log('Mensaje no es de tipo texto, ignorando');
          }
        } else {
          console.log('No hay mensajes en la petición');
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

    if (functionName === "consultar_disponibilidad") {
        output = await googleCalendarService.consultarDisponibilidad(args.fecha_inicio, args.fecha_fin);
      } else if (functionName === "crear_evento") {
        output = await googleCalendarService.crearEvento(args);
      } else {
        output = { error: `Función ${functionName} no implementada.` };
      }
  

    tool_outputs.push({
      tool_call_id: toolCall.id,
      output: JSON.stringify(output)
    });
  }
  return tool_outputs;
}

app.listen(port, () => {
    console.log('=== SERVER STARTED ===');
    console.log(`Server is running on port ${port}`);
    console.log(`Webhook URL: http://localhost:${port}/webhook`);
  // No logs salvo error
}); 