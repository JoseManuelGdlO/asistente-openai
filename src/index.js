require('dotenv').config();

const pkg = require('../package.json');
const APP_VERSION = pkg.version;

const { createApp } = require('./app');
const UltraMsgManager = require('./managers/ultramsgManager');
const Scheduler = require('./services/scheduler');
const ConfirmationManager = require('./services/confirmationManager');
const UserContextManager = require('./services/userContextManager');
const OpenAIManager = require('./managers/openAIManager');
const WebhookManager = require('./controllers/webhookManager');
const SchedulerController = require('./controllers/schedulerController');
const DocumentStore = require('./services/documentStore');

const port = process.env.PORT || 3000;

const ultraMsgManager = new UltraMsgManager();
const scheduler = new Scheduler();
const confirmationManager = new ConfirmationManager();
const userContextManager = new UserContextManager();
const documentStore = new DocumentStore();
const openAIManager = new OpenAIManager();
const webhookManager = new WebhookManager(
  ultraMsgManager,
  openAIManager,
  confirmationManager,
  userContextManager,
  documentStore
);
const schedulerController = new SchedulerController(scheduler);
webhookManager.debounceManager.startSweep();

async function reinitUltraMsgInstances() {
  console.log('🔄 Re-inicializando instancias UltraMsg...');
  await ultraMsgManager.initializeInstances(true);
}

const app = createApp({
  ultraMsgManager,
  openAIManager,
  webhookManager,
  userContextManager,
  schedulerController,
  documentStore,
  reinitUltraMsgInstances
});

async function autoReloadClients() {
  try {
    console.log('🔄 Recarga automática de clientes iniciada...');
    await webhookManager.commandManager.reloadClients();
    console.log('✅ Recarga automática completada');
  } catch (error) {
    console.error('❌ Error en recarga automática:', error);
  }
}

const AUTO_RELOAD_INTERVAL = 30 * 60 * 1000;
setInterval(autoReloadClients, AUTO_RELOAD_INTERVAL);
autoReloadClients();

app.listen(port, async () => {
    console.log('=== SERVER STARTED ===');
    console.log(`Versión: ${APP_VERSION}`);
    console.log(`Server is running on port ${port}`);
    console.log(`Webhook URL: http://localhost:${port}/webhook`);
    console.log(`Test URL: http://localhost:${port}/test`);
    console.log(`Health URL: http://localhost:${port}/health`);
    console.log(`Panel admin: http://localhost:${port}/`);
    console.log('Variables de entorno:');
    console.log('- OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? 'Configurado' : 'NO CONFIGURADO');
    console.log('- OPENAI_MODEL:', process.env.OPENAI_MODEL || 'gpt-4o-mini (default)');
    console.log('- ULTRAMSG_TOKEN:', process.env.ULTRAMSG_TOKEN ? 'Configurado' : 'NO CONFIGURADO');
    console.log('- ULTRAMSG_INSTANCE_ID:', process.env.ULTRAMSG_INSTANCE_ID ? 'Configurado' : 'NO CONFIGURADO');
    console.log('- ULTRAMSG_WEBHOOK_TOKEN:', process.env.ULTRAMSG_WEBHOOK_TOKEN ? 'Configurado' : 'NO CONFIGURADO');
    console.log('- ADMIN_API_TOKEN:', process.env.ADMIN_API_TOKEN ? 'Configurado' : 'NO CONFIGURADO');
    console.log('- MESSAGE_DEBOUNCE_MS:', process.env.MESSAGE_DEBOUNCE_MS || '2500 (default)');
    console.log('- MESSAGE_DEBOUNCE_MAX_MS:', process.env.MESSAGE_DEBOUNCE_MAX_MS || '8000 (default)');
    console.log(`📄 Documentos: GET/POST http://localhost:${port}/clients/:clientId/documents`);

    try {
      console.log('🔄 Inicializando instancias UltraMsg desde Firebase...');
      await ultraMsgManager.initializeInstances();

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

    scheduler.init();

    console.log('=== SERVER READY ===');
    console.log('📱 Configuración de grupos: Los mensajes de grupos son ignorados automáticamente');
    console.log(`🔗 Endpoint de configuración: http://localhost:${port}/group-settings`);
    console.log(`🔗 Endpoint de panel admin: http://localhost:${port}/`);
});
