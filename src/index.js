const express = require('express');
const cors = require('cors');
require('dotenv').config();

const pkg = require('../package.json');
const APP_VERSION = pkg.version;

// Importar todas las clases
const UltraMsgManager = require('./managers/ultramsgManager');
const Scheduler = require('./services/scheduler');
const ConfirmationManager = require('./services/confirmationManager');
const UserContextManager = require('./services/userContextManager');
const OpenAIManager = require('./managers/openAIManager');
const WebhookManager = require('./controllers/webhookManager');
const SchedulerController = require('./controllers/schedulerController');
const ThreadResetService = require('./services/threadResetService');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Inicializar todas las clases
const ultraMsgManager = new UltraMsgManager();
const scheduler = new Scheduler();
const confirmationManager = new ConfirmationManager();
const userContextManager = new UserContextManager();
const openAIManager = new OpenAIManager();
const webhookManager = new WebhookManager(ultraMsgManager, openAIManager, confirmationManager, userContextManager);
const schedulerController = new SchedulerController(scheduler);
const threadResetService = new ThreadResetService(openAIManager, userContextManager);

// ==================== RECARGA AUTOMÁTICA DE CLIENTES ====================

// Función para recargar clientes automáticamente
async function autoReloadClients() {
  try {
    console.log('🔄 Recarga automática de clientes iniciada...');
    await webhookManager.commandManager.reloadClients();
    console.log('✅ Recarga automática completada');
  } catch (error) {
    console.error('❌ Error en recarga automática:', error);
  }
}

// Recargar clientes cada 30 minutos (1800000 ms)
const AUTO_RELOAD_INTERVAL = 30 * 60 * 1000; // 30 minutos
setInterval(autoReloadClients, AUTO_RELOAD_INTERVAL);

// Recargar clientes al iniciar el servidor
autoReloadClients();

// ==================== ENDPOINTS DE WEBHOOK ====================

// UltraMsg Webhook verification
app.get('/webhook', (req, res) => {
  const token = req.query['token'];
  
  if (webhookManager.verifyWebhookToken(token)) {
    console.log('UltraMsg webhook verified successfully');
    res.status(200).send('OK');
  } else {
    console.log('UltraMsg webhook verification failed');
    res.sendStatus(403);
  }
});

// UltraMsg Webhook for receiving messages
app.post('/webhook', async (req, res) => {
  try {
    const data = req.body?.data || {};
    const from = (data.from || '?').toString().replace('@c.us', '');
    const to = (data.to || '?').toString().replace('@c.us', '');
    const bodyPreview = typeof data.body === 'string' ? (data.body.length > 60 ? data.body.slice(0, 60) + '…' : data.body) : '';
    console.log(`Origen: UltraMsg | De: ${from} | Para: ${to} | Mensaje: "${bodyPreview}"`);
    const webhookToken = req.headers['x-webhook-token'] || req.query.token;
    
    const result = await webhookManager.handleWebhook(req.body, webhookToken);
    
    if (result.processed) {
      if (result.reason === 'group_message_ignored') {
        console.log('📱 Mensaje de grupo ignorado exitosamente');
      } else {
        console.log('Mensaje procesado exitosamente');
      }
    } else {
      console.log('Mensaje no procesado:', result.reason);
    }
    
    res.sendStatus(200);
  } catch (error) {
    const errMsg = error.response?.data?.message || error.message || (typeof error.response?.data === 'object' ? JSON.stringify(error.response?.data) : error.response?.data);
    const code = error.response?.status ? ` [${error.response.status}]` : '';
    console.error('Error processing webhook:', errMsg + code);
    return res.sendStatus(500);
  }
});

// Own System Webhook for receiving messages (tu plataforma)
app.post('/webhook-own', async (req, res) => {
  try {
    const norm = req.body?.normalized || {};
    const from = (norm.from || '?').toString().replace('@s.whatsapp.net', '').split('@')[0];
    const to = (norm.to || '?').toString().replace('@s.whatsapp.net', '').split('@')[0];
    const text = norm.content?.text || '';
    const bodyPreview = typeof text === 'string' ? (text.length > 60 ? text.slice(0, 60) + '…' : text) : '';
    console.log(`Origen: Mi sistema | De: ${from} | Para: ${to} | Mensaje: "${bodyPreview}"`);
    
    const result = await webhookManager.handleOwnWebhook(req.body);
    
    if (result.processed) {
      if (result.reason === 'group_message_ignored') {
        console.log('📱 Mensaje de grupo ignorado exitosamente (own system)');
      } else if (result.reason === 'not_text_message') {
        console.log('📎 Mensaje no textual (imagen/audio/etc.) — se envió aviso al usuario (own system)');
      } else {
        console.log('Mensaje procesado exitosamente (own system)');
      }
    } else {
      console.log('Mensaje no procesado (own system):', result.reason);
    }
    
    res.sendStatus(200);
  } catch (error) {
    const errMsg = error.response?.data?.message || error.message || (typeof error.response?.data === 'object' ? JSON.stringify(error.response?.data) : error.response?.data);
    const code = error.response?.status ? ` [${error.response.status}]` : '';
    console.error('Error processing own webhook:', errMsg + code);
    return res.sendStatus(500);
  }
});



// ==================== ENDPOINTS DE GESTIÓN DE THREADS ====================

app.post('/reset_threads', (req, res) => {
  openAIManager.resetThreads();
  res.json({ ok: true, message: 'Todos los threads de usuario han sido reseteados.' });
});

// Resetear thread específico de un usuario para un cliente específico
app.post('/reset_thread/:userId/:clientCode', async (req, res) => {
  try {
    const { userId, clientCode } = req.params;
    const options = req.body || {};
    
    const result = await threadResetService.resetUserThread(userId, clientCode, options);
    
    if (result.success) {
      res.json({ 
        ok: true, 
        message: 'Thread reseteado exitosamente',
        result: result
      });
    } else {
      res.status(400).json({ 
        ok: false, 
        error: result.error,
        code: result.code
      });
    }
  } catch (error) {
    console.error('Error al resetear thread específico:', error);
    res.status(500).json({ 
      ok: false, 
      error: 'Error al resetear thread específico',
      details: error.message 
    });
  }
});

// Resetear todos los threads de un usuario específico
app.post('/reset_user_threads/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const options = req.body || {};
    
    const result = await threadResetService.resetAllUserThreads(userId, options);
    
    if (result.success) {
      res.json({ 
        ok: true, 
        message: 'Threads del usuario reseteados exitosamente',
        result: result
      });
    } else {
      res.status(400).json({ 
        ok: false, 
        error: result.error,
        code: result.code
      });
    }
  } catch (error) {
    console.error('Error al resetear threads del usuario:', error);
    res.status(500).json({ 
      ok: false, 
      error: 'Error al resetear threads del usuario',
      details: error.message 
    });
  }
});

// Obtener información de todos los threads activos
app.get('/threads/info', async (req, res) => {
  try {
    const result = await threadResetService.getThreadsInfo();
    
    if (result.success) {
      res.json({
        ok: true,
        ...result
      });
    } else {
      res.status(500).json({ 
        ok: false, 
        error: result.error,
        code: result.code
      });
    }
  } catch (error) {
    console.error('Error al obtener información de threads:', error);
    res.status(500).json({ 
      ok: false, 
      error: 'Error al obtener información de threads',
      details: error.message 
    });
  }
});

// ==================== ENDPOINTS ADICIONALES DEL SERVICIO DE THREAD RESET ====================

// Buscar threads por criterios
app.post('/threads/search', async (req, res) => {
  try {
    const criteria = req.body || {};
    const result = await threadResetService.findThreads(criteria);
    
    if (result.success) {
      res.json({
        ok: true,
        ...result
      });
    } else {
      res.status(500).json({ 
        ok: false, 
        error: result.error,
        code: result.code
      });
    }
  } catch (error) {
    console.error('Error al buscar threads:', error);
    res.status(500).json({ 
      ok: false, 
      error: 'Error al buscar threads',
      details: error.message 
    });
  }
});

// Obtener estadísticas del servicio
app.get('/threads/stats', async (req, res) => {
  try {
    const result = await threadResetService.getServiceStats();
    
    if (result.success) {
      res.json({
        ok: true,
        ...result
      });
    } else {
      res.status(500).json({ 
        ok: false, 
        error: result.error,
        code: result.code
      });
    }
  } catch (error) {
    console.error('Error al obtener estadísticas:', error);
    res.status(500).json({ 
      ok: false, 
      error: 'Error al obtener estadísticas',
      details: error.message 
    });
  }
});

// Resetear todos los threads usando el servicio
app.post('/reset_all_threads', async (req, res) => {
  try {
    const options = req.body || {};
    const result = await threadResetService.resetAllThreads(options);
    
    if (result.success) {
      res.json({ 
        ok: true, 
        message: 'Todos los threads han sido reseteados exitosamente',
        result: result
      });
    } else {
      res.status(500).json({ 
        ok: false, 
        error: result.error,
        code: result.code
      });
    }
  } catch (error) {
    console.error('Error al resetear todos los threads:', error);
    res.status(500).json({ 
      ok: false, 
      error: 'Error al resetear todos los threads',
      details: error.message 
    });
  }
});

// ==================== ENDPOINTS DE CONTEXTO DE USUARIO ====================

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
    userContextManager.markAgendaSent(userId);
    
    console.log(`=== Agenda marcada como enviada para usuario: ${userId} ===`);
    
    res.json({ 
      ok: true, 
      message: `Usuario ${userId} marcado como agenda enviada`,
      context: userContextManager.getUserContext(userId)
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
    const context = userContextManager.getUserContext(userId);
    
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
    userContextManager.clearUserContext(userId);
    
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

// ==================== ENDPOINTS DE SCHEDULER ====================

// Obtener estado de tareas programadas
app.get('/scheduler/status', (req, res) => {
  try {
    const result = schedulerController.getTasksStatus();
    res.json(result);
  } catch (error) {
    res.status(500).json(error);
  }
});

// Ejecutar tarea manualmente
app.post('/scheduler/run/:taskName', async (req, res) => {
  try {
    const { taskName } = req.params;
    const result = await schedulerController.runTaskManually(taskName);
    res.json(result);
  } catch (error) {
    res.status(500).json(error);
  }
});

// Detener todas las tareas
app.post('/scheduler/stop', (req, res) => {
  try {
    const result = schedulerController.stopAllTasks();
    res.json(result);
  } catch (error) {
    res.status(500).json(error);
  }
});

// Reiniciar tareas
app.post('/scheduler/restart', (req, res) => {
  try {
    const result = schedulerController.restartTasks();
    res.json(result);
  } catch (error) {
    res.status(500).json(error);
  }
});

// ==================== ENDPOINTS DE CONFIGURACIÓN DE GRUPOS ====================

// Endpoint para verificar configuración de grupos
app.get('/group-settings', (req, res) => {
  try {
    res.json({
      ok: true,
      groupBehavior: {
        respondInGroups: false,
        description: 'Los mensajes de grupos son ignorados automáticamente'
      },
      detection: {
        enabled: true,
        methods: [
          'Verifica si from termina en @g.us',
          'Verifica si chat.isGroup es true',
          'Verifica si chat.id termina en @g.us'
        ]
      }
    });
  } catch (error) {
    console.error('Error al obtener configuración de grupos:', error);
    res.status(500).json({ 
      ok: false, 
      error: 'Error al obtener configuración de grupos',
      details: error.message 
    });
  }
});

// ==================== ENDPOINTS DE COMANDOS ====================

// Endpoint para ver estado de todos los bots
app.get('/bots/status', (req, res) => {
  try {
    const status = webhookManager.commandManager.getAllBotsStatus();
    res.json({
      ok: true,
      bots: status,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error al obtener estado de bots:', error);
    res.status(500).json({ 
      ok: false, 
      error: 'Error al obtener estado de bots',
      details: error.message 
    });
  }
});

// Endpoint para ver configuración de clientes
app.get('/clients', (req, res) => {
  try {
    const clients = webhookManager.commandManager.getClientConfig();
    res.json({
      ok: true,
      clients: clients,
      count: Object.keys(clients).length
    });
  } catch (error) {
    console.error('Error al obtener configuración de clientes:', error);
    res.status(500).json({ 
      ok: false, 
      error: 'Error al obtener configuración de clientes',
      details: error.message 
    });
  }
});

// Endpoint para ejecutar comando manualmente
app.post('/bots/command', async (req, res) => {
  try {
    const { clientId, command, phoneNumber } = req.body;
    
    if (!clientId || !command) {
      return res.status(400).json({
        ok: false,
        error: 'clientId y command son requeridos'
      });
    }
    
    const result = await webhookManager.commandManager.executeCommand(
      clientId, 
      command, 
      phoneNumber || 'admin@system'
    );
    
    res.json({
      ok: true,
      result: result,
      clientId: clientId,
      command: command
    });
  } catch (error) {
    console.error('Error al ejecutar comando:', error);
    res.status(500).json({ 
      ok: false, 
      error: 'Error al ejecutar comando',
      details: error.message 
    });
  }
});

// ==================== ENDPOINTS DE GESTIÓN DE CLIENTES ====================

// Crear nuevo cliente
app.post('/clients', async (req, res) => {
  try {
    const { name, adminPhone, assistantPhone, assistantId } = req.body;
    
    if (!name || !adminPhone || !assistantPhone || !assistantId) {
      return res.status(400).json({
        ok: false,
        error: 'name, adminPhone, assistantPhone y assistantId son requeridos'
      });
    }
    
    const newClient = await webhookManager.commandManager.createClient({
      name,
      adminPhone,
      assistantPhone,
      assistantId,
      botStatus: 'active'
    });
    
    res.json({
      ok: true,
      client: newClient,
      message: 'Cliente creado exitosamente'
    });
  } catch (error) {
    console.error('Error creando cliente:', error);
    res.status(500).json({ 
      ok: false, 
      error: 'Error creando cliente',
      details: error.message 
    });
  }
});

// Actualizar cliente
app.put('/clients/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;
    const updateData = req.body;
    
    const updatedClient = await webhookManager.commandManager.updateClient(clientId, updateData);
    
    res.json({
      ok: true,
      client: updatedClient,
      message: 'Cliente actualizado exitosamente'
    });
  } catch (error) {
    console.error('Error actualizando cliente:', error);
    res.status(500).json({ 
      ok: false, 
      error: 'Error actualizando cliente',
      details: error.message 
    });
  }
});

// Eliminar cliente
app.delete('/clients/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;
    
    const result = await webhookManager.commandManager.deleteClient(clientId);
    
    res.json({
      ok: true,
      result: result,
      message: 'Cliente eliminado exitosamente'
    });
  } catch (error) {
    console.error('Error eliminando cliente:', error);
    res.status(500).json({ 
      ok: false, 
      error: 'Error eliminando cliente',
      details: error.message 
    });
  }
});

// Obtener cliente específico
app.get('/clients/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;
    
    const client = await webhookManager.commandManager.firebaseService.getClientById(clientId);
    
    if (!client) {
      return res.status(404).json({
        ok: false,
        error: 'Cliente no encontrado'
      });
    }
    
    res.json({
      ok: true,
      client: client
    });
  } catch (error) {
    console.error('Error obteniendo cliente:', error);
    res.status(500).json({ 
      ok: false, 
      error: 'Error obteniendo cliente',
      details: error.message 
    });
  }
});

// Obtener estadísticas de clientes
app.get('/clients/stats/overview', async (req, res) => {
  try {
    const stats = await webhookManager.commandManager.firebaseService.getClientStats();
    
    res.json({
      ok: true,
      stats: stats
    });
  } catch (error) {
    console.error('Error obteniendo estadísticas:', error);
    res.status(500).json({ 
      ok: false, 
      error: 'Error obteniendo estadísticas',
      details: error.message 
    });
  }
});

// Recargar clientes desde Firebase
app.post('/clients/reload', async (req, res) => {
  try {
    console.log('🔄 Iniciando recarga de clientes desde Firebase...');
    
    // Obtener estado antes de la recarga
    const beforeCount = Object.keys(webhookManager.commandManager.getClientConfig()).length;
    const beforeClients = Object.keys(webhookManager.commandManager.getClientConfig());
    
    // Recargar clientes
    await webhookManager.commandManager.reloadClients();
    
    // Obtener estado después de la recarga
    const afterCount = Object.keys(webhookManager.commandManager.getClientConfig()).length;
    const afterClients = Object.keys(webhookManager.commandManager.getClientConfig());
    
    // Detectar cambios
    const addedClients = afterClients.filter(id => !beforeClients.includes(id));
    const removedClients = beforeClients.filter(id => !afterClients.includes(id));
    
    console.log('✅ Recarga completada:');
    console.log(`- Antes: ${beforeCount} clientes`);
    console.log(`- Después: ${afterCount} clientes`);
    console.log(`- Agregados: ${addedClients.length}`);
    console.log(`- Removidos: ${removedClients.length}`);
    
    // Obtener información detallada de los clientes actuales
    const currentClients = webhookManager.commandManager.getClientConfig();
    const clientsInfo = Object.entries(currentClients).map(([id, client]) => ({
      id: id,
      name: client.name,
      adminPhone: client.adminPhone,
      assistantPhone: client.assistantPhone,
      assistantId: client.assistantId,
      botStatus: client.botStatus,
      status: client.status
    }));
    
    res.json({
      ok: true,
      message: 'Clientes recargados exitosamente',
      summary: {
        beforeCount: beforeCount,
        afterCount: afterCount,
        added: addedClients.length,
        removed: removedClients.length,
        changes: addedClients.length > 0 || removedClients.length > 0
      },
      changes: {
        added: addedClients,
        removed: removedClients
      },
      clients: clientsInfo,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error recargando clientes:', error);
    res.status(500).json({ 
      ok: false, 
      error: 'Error recargando clientes',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Endpoint adicional para ver el estado actual sin recargar
app.get('/clients/status', async (req, res) => {
  try {
    const currentClients = webhookManager.commandManager.getClientConfig();
    const clientsInfo = Object.entries(currentClients).map(([id, client]) => ({
      id: id,
      name: client.name,
      adminPhone: client.adminPhone,
      assistantPhone: client.assistantPhone,
      assistantId: client.assistantId,
      botStatus: client.botStatus,
      status: client.status,
      lastUpdated: client.updatedAt
    }));
    
    res.json({
      ok: true,
      count: Object.keys(currentClients).length,
      clients: clientsInfo,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error obteniendo estado de clientes:', error);
    res.status(500).json({ 
      ok: false, 
      error: 'Error obteniendo estado de clientes',
      details: error.message 
    });
  }
});

// ==================== ENDPOINTS DE GESTIÓN DE INSTANCIAS ULTRAMSG ====================

// Obtener estado de todas las instancias de UltraMsg
app.get('/ultramsg/instances', async (req, res) => {
  try {
    const instances = ultraMsgManager.getAllInstances();
    const statuses = await ultraMsgManager.getAllInstancesStatus();
    
    const instancesInfo = instances.map(instance => ({
      instanceId: instance.instanceId,
      name: instance.name,
      status: statuses[instance.instanceId] || { error: 'No se pudo obtener estado' }
    }));
    
    res.json({
      ok: true,
      instances: instancesInfo,
      total: instances.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error obteniendo estado de instancias:', error);
    res.status(500).json({ 
      ok: false, 
      error: 'Error obteniendo estado de instancias',
      details: error.message 
    });
  }
});

// Obtener información de una instancia específica
app.get('/ultramsg/instances/:instanceId', async (req, res) => {
  try {
    const { instanceId } = req.params;
    
    const instance = ultraMsgManager.getInstance(instanceId);
    if (!instance) {
      return res.status(404).json({
        ok: false,
        error: 'Instancia no encontrada'
      });
    }
    
    const info = await ultraMsgManager.getInstanceInfo(instanceId);
    const status = await ultraMsgManager.getInstanceStatus(instanceId);
    const isConnected = await ultraMsgManager.isConnected(instanceId);
    
    res.json({
      ok: true,
      instance: {
        ...instance,
        info: info,
        status: status,
        connected: isConnected
      }
    });
  } catch (error) {
    console.error('Error obteniendo información de instancia:', error);
    res.status(500).json({ 
      ok: false, 
      error: 'Error obteniendo información de instancia',
      details: error.message 
    });
  }
});

// Enviar mensaje usando una instancia específica
app.post('/ultramsg/instances/:instanceId/send', async (req, res) => {
  try {
    const { instanceId } = req.params;
    const { to, message } = req.body;
    
    if (!to || !message) {
      return res.status(400).json({
        ok: false,
        error: 'to y message son requeridos'
      });
    }
    
    const instance = ultraMsgManager.getInstance(instanceId);
    if (!instance) {
      return res.status(404).json({
        ok: false,
        error: 'Instancia no encontrada'
      });
    }
    
    const response = await ultraMsgManager.sendMessage(to, message, instanceId);
    
    res.json({
      ok: true,
      response: response,
      instanceName: instance.name
    });
  } catch (error) {
    console.error('Error enviando mensaje:', error);
    res.status(500).json({ 
      ok: false, 
      error: 'Error enviando mensaje',
      details: error.message 
    });
  }
});

// ==================== ENDPOINTS DE UTILIDAD ====================

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

// ==================== INICIALIZACIÓN DEL SERVIDOR ====================

app.listen(port, async () => {
    console.log('=== SERVER STARTED ===');
    console.log(`Versión: ${APP_VERSION}`);
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
    
    // Inicializar instancias de UltraMsg desde Firebase
    try {
      console.log('🔄 Inicializando instancias UltraMsg desde Firebase...');
      await ultraMsgManager.initializeInstances();
      
      // Verificar conexión con todas las instancias de UltraMsg
      const allStatuses = await ultraMsgManager.getAllInstancesStatus();
      console.log('- Estado de instancias UltraMsg:');
      
      for (const [instanceId, status] of Object.entries(allStatuses)) {
        const statusIcon = status.connected ? '✅' : '❌';
        const instanceName = status.instanceName || 'Sin nombre';
        console.log(`  ${statusIcon} ${instanceName} (${instanceId}): ${status.connected ? 'Conectado' : 'Desconectado'}`);
        
        if (status.connected && status.name) {
          console.log(`    📱 Número: ${status.name}`);
        }
      }
    } catch (error) {
      console.log('- UltraMsg conectado: ❌ Error verificando conexión');
      console.log('Error:', error.message);
    }

    // Inicializar tareas programadas
    scheduler.init();
    
    console.log('=== SERVER READY ===');
    console.log('📱 Configuración de grupos: Los mensajes de grupos son ignorados automáticamente');
    console.log('🔗 Endpoint de configuración: http://localhost:${port}/group-settings');
}); 