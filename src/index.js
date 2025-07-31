const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Importar todas las clases
const UltraMsgManager = require('./managers/ultramsgManager');
const Scheduler = require('./services/scheduler');
const ConfirmationManager = require('./services/confirmationManager');
const UserContextManager = require('./services/userContextManager');
const OpenAIManager = require('./managers/openAIManager');
const WebhookManager = require('./controllers/webhookManager');
const SchedulerController = require('./controllers/schedulerController');

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
    // Obtener el token del webhook desde los headers o query params
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
    console.error('Error processing webhook:', error);
    console.error('Error details:', error.response?.data || error.message);
    return res.sendStatus(500);
  }
});

// ==================== ENDPOINTS DE GESTIÓN DE THREADS ====================

app.post('/reset_threads', (req, res) => {
  openAIManager.resetThreads();
  res.json({ ok: true, message: 'Todos los threads de usuario han sido reseteados.' });
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