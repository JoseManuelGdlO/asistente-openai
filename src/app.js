const express = require('express');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const requireAdminAuth = require('./middleware/requireAdminAuth');

const ULTRAMSG_FIELD_KEYS = ['ULTRAMSG_TOKEN', 'ULTRAMSG_INSTANCE_ID', 'ULTRAMSG_WEBHOOK_TOKEN'];

function hasUltraMsgFields(data) {
  if (!data || typeof data !== 'object') return false;
  return ULTRAMSG_FIELD_KEYS.some((key) => typeof data[key] === 'string' && data[key].trim() !== '');
}

function stripEmptyUltraMsgFields(data) {
  const next = { ...data };
  ULTRAMSG_FIELD_KEYS.forEach((key) => {
    if (next[key] === '' || next[key] == null) {
      delete next[key];
    }
  });
  return next;
}

function createUploadPdf() {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const mime = (file.mimetype || '').toLowerCase();
      const name = (file.originalname || '').toLowerCase();
      if (mime.includes('pdf') || name.endsWith('.pdf')) {
        return cb(null, true);
      }
      return cb(new Error('Solo se permiten archivos PDF'));
    }
  });
}

/**
 * Crea la app Express con dependencias inyectadas (sin listen ni intervalos).
 * @param {Object} deps
 */
function createApp(deps = {}) {
  const {
    ultraMsgManager,
    openAIManager,
    webhookManager,
    userContextManager,
    schedulerController,
    documentStore,
    reinitUltraMsgInstances = async () => {}
  } = deps;

  const app = express();
  const uploadPdf = createUploadPdf();

  app.use(cors());
  app.use(express.json());

  // ==================== ENDPOINTS DE WEBHOOK ====================

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
        } else if (result.reason === 'blacklisted') {
          console.log('[BLACKLIST] Mensaje ignorado por contacto bloqueado (UltraMsg)');
        } else if (result.reason === 'document_ignored') {
          console.log('📎 Documento recibido sin /upload; ignorado (UltraMsg)');
        } else if (result.reason === 'empty_message') {
          console.log('Mensaje vacío ignorado (UltraMsg)');
        } else if (result.reason === 'confirmation_processed') {
          console.log('Mensaje de confirmación procesado (UltraMsg)');
        } else if (result.reason === 'client_not_found') {
          console.log('Consultorio no identificado; se envió aviso (UltraMsg)');
        } else if (result.reason === 'bot_inactive') {
          console.log('Bot inactivo; se envió aviso (UltraMsg)');
        } else if (result.reason === 'assistant_missing') {
          console.log('Assistant faltante; se envió aviso (UltraMsg)');
        } else if (result.reason === 'media_download_failed') {
          console.log('Error descargando adjunto; se envió aviso (UltraMsg)');
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
        } else if (result.reason === 'blacklisted') {
          console.log('[BLACKLIST] Mensaje ignorado por contacto bloqueado (own system)');
        } else if (result.reason === 'not_text_message') {
          console.log('📎 Mensaje no textual (imagen/audio/etc.) — se envió aviso al usuario (own system)');
        } else if (result.reason === 'confirmation_processed') {
          console.log('Mensaje de confirmación procesado (own system)');
        } else if (result.reason === 'bot_inactive') {
          console.log('Bot inactivo; se envió aviso (own system)');
        } else if (result.reason === 'assistant_missing') {
          console.log('Assistant faltante; se envió aviso (own system)');
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

  // ==================== ENDPOINTS DE GESTIÓN DE SESIONES ====================

  app.post('/reset_sessions', requireAdminAuth, async (req, res) => {
    try {
      const deleted = await openAIManager.resetSessions();
      res.json({
        ok: true,
        message: 'Todas las sesiones de usuario han sido reseteadas.',
        deleted
      });
    } catch (error) {
      console.error('Error reseteando sesiones:', error);
      res.status(500).json({
        ok: false,
        error: 'Error reseteando sesiones',
        details: error.message
      });
    }
  });

  app.get('/sessions', requireAdminAuth, async (req, res) => {
    try {
      const filters = {};
      if (req.query.userId) filters.userId = String(req.query.userId);
      if (req.query.clientCode) filters.clientCode = String(req.query.clientCode);

      const sessions = await openAIManager.listSessions(filters);
      res.json({
        ok: true,
        count: sessions.length,
        sessions
      });
    } catch (error) {
      console.error('Error listando sesiones:', error);
      res.status(500).json({
        ok: false,
        error: 'Error listando sesiones',
        details: error.message
      });
    }
  });

  app.delete('/sessions/user/:userId', requireAdminAuth, async (req, res) => {
    try {
      const { userId } = req.params;
      const deleted = await openAIManager.deleteSessionsByUserId(userId);
      res.json({
        ok: true,
        message: `Sesiones eliminadas para usuario: ${userId}`,
        deleted
      });
    } catch (error) {
      console.error('Error eliminando sesiones del usuario:', error);
      res.status(500).json({
        ok: false,
        error: 'Error eliminando sesiones del usuario',
        details: error.message
      });
    }
  });

  app.delete('/sessions/client/:clientCode', requireAdminAuth, async (req, res) => {
    try {
      const { clientCode } = req.params;
      const deleted = await openAIManager.deleteSessionsByClientCode(clientCode);
      res.json({
        ok: true,
        message: `Sesiones eliminadas para consultorio: ${clientCode}`,
        deleted
      });
    } catch (error) {
      console.error('Error eliminando sesiones del consultorio:', error);
      res.status(500).json({
        ok: false,
        error: 'Error eliminando sesiones del consultorio',
        details: error.message
      });
    }
  });

  app.delete('/sessions/:userId/:clientCode', requireAdminAuth, async (req, res) => {
    try {
      const { userId, clientCode } = req.params;
      await openAIManager.deleteSession(userId, clientCode);
      res.json({
        ok: true,
        message: `Sesión eliminada: ${userId}_${clientCode}`
      });
    } catch (error) {
      console.error('Error eliminando sesión:', error);
      res.status(500).json({
        ok: false,
        error: 'Error eliminando sesión',
        details: error.message
      });
    }
  });

  // ==================== ENDPOINTS DE CONTEXTO DE USUARIO ====================

  app.post('/mark-agenda-sent', (req, res) => {
    try {
      const { userId } = req.body;

      if (!userId) {
        return res.status(400).json({
          ok: false,
          error: 'userId es requerido'
        });
      }

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

  app.get('/scheduler/status', requireAdminAuth, (req, res) => {
    try {
      const result = schedulerController.getTasksStatus();
      res.json(result);
    } catch (error) {
      res.status(500).json(error);
    }
  });

  app.post('/scheduler/run/:taskName', requireAdminAuth, async (req, res) => {
    try {
      const { taskName } = req.params;
      const result = await schedulerController.runTaskManually(taskName);
      res.json(result);
    } catch (error) {
      res.status(500).json(error);
    }
  });

  app.post('/scheduler/stop', requireAdminAuth, (req, res) => {
    try {
      const result = schedulerController.stopAllTasks();
      res.json(result);
    } catch (error) {
      res.status(500).json(error);
    }
  });

  app.post('/scheduler/restart', requireAdminAuth, (req, res) => {
    try {
      const result = schedulerController.restartTasks();
      res.json(result);
    } catch (error) {
      res.status(500).json(error);
    }
  });

  // ==================== ENDPOINTS DE CONFIGURACIÓN DE GRUPOS ====================

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

  app.get('/bots/status', requireAdminAuth, (req, res) => {
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

  app.get('/clients', requireAdminAuth, (req, res) => {
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

  app.post('/bots/command', requireAdminAuth, async (req, res) => {
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

  app.post('/clients', requireAdminAuth, async (req, res) => {
    try {
      const {
        id,
        name,
        adminPhone,
        assistantPhone,
        prompt,
        tools,
        config,
        responseSchema,
        botStatus,
        ULTRAMSG_TOKEN,
        ULTRAMSG_INSTANCE_ID,
        ULTRAMSG_WEBHOOK_TOKEN
      } = req.body;

      if (!name || !adminPhone || !assistantPhone) {
        return res.status(400).json({
          ok: false,
          error: 'name, adminPhone y assistantPhone son requeridos'
        });
      }

      const normalizedPrompt = typeof prompt === 'string' ? prompt : '';

      const clientPayload = stripEmptyUltraMsgFields({
        id,
        name,
        adminPhone,
        assistantPhone,
        botStatus: botStatus || 'active',
        prompt: normalizedPrompt,
        tools,
        config,
        responseSchema,
        ULTRAMSG_TOKEN,
        ULTRAMSG_INSTANCE_ID,
        ULTRAMSG_WEBHOOK_TOKEN
      });

      const result = await webhookManager.commandManager.createClient(
        clientPayload,
        { prompt: normalizedPrompt, tools, config, responseSchema }
      );

      if (hasUltraMsgFields(clientPayload)) {
        await reinitUltraMsgInstances();
      }

      res.status(201).json({
        ok: true,
        client: result.client,
        assistant: result.assistant,
        message: 'Cliente y Assistant creados exitosamente'
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

  app.put('/clients/:clientId', requireAdminAuth, async (req, res) => {
    try {
      const { clientId } = req.params;
      const updateData = stripEmptyUltraMsgFields(req.body);

      const updatedClient = await webhookManager.commandManager.updateClient(clientId, updateData);

      if (hasUltraMsgFields(updateData)) {
        await reinitUltraMsgInstances();
      }

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

  app.delete('/clients/:clientId', requireAdminAuth, async (req, res) => {
    try {
      const { clientId } = req.params;

      const result = await webhookManager.commandManager.deleteClient(clientId);

      res.json({
        ok: true,
        result: result,
        message: 'Cliente y Assistant eliminados exitosamente'
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

  app.get('/assistants', requireAdminAuth, async (req, res) => {
    try {
      const assistants = await webhookManager.commandManager.listAssistants();
      res.json({
        ok: true,
        assistants,
        count: assistants.length
      });
    } catch (error) {
      console.error('Error listando Assistants:', error);
      res.status(500).json({
        ok: false,
        error: 'Error listando Assistants',
        details: error.message
      });
    }
  });

  app.get('/assistants/:clientId', requireAdminAuth, async (req, res) => {
    try {
      const { clientId } = req.params;
      const assistant = await webhookManager.commandManager.getAssistantConfig(clientId);

      if (!assistant) {
        return res.status(404).json({
          ok: false,
          error: 'Assistant no encontrado'
        });
      }

      res.json({
        ok: true,
        assistant
      });
    } catch (error) {
      console.error('Error obteniendo Assistant:', error);
      res.status(500).json({
        ok: false,
        error: 'Error obteniendo Assistant',
        details: error.message
      });
    }
  });

  app.put('/assistants/:clientId', requireAdminAuth, async (req, res) => {
    try {
      const { clientId } = req.params;
      const { prompt, tools, config, responseSchema } = req.body;

      const updated = await webhookManager.commandManager.updateAssistant(clientId, {
        prompt,
        tools,
        config,
        responseSchema
      });

      res.json({
        ok: true,
        assistant: updated,
        message: 'Assistant actualizado exitosamente'
      });
    } catch (error) {
      console.error('Error actualizando Assistant:', error);
      const status = error.code === 'CLIENT_NOT_FOUND' || error.code === 'ASSISTANT_NOT_FOUND'
        ? 404
        : 500;
      res.status(status).json({
        ok: false,
        error: status === 404 ? error.message : 'Error actualizando Assistant',
        details: error.message
      });
    }
  });

  app.get('/clients/status', requireAdminAuth, async (req, res) => {
    try {
      const currentClients = webhookManager.commandManager.getClientConfig();
      const clientsInfo = Object.entries(currentClients).map(([id, client]) => ({
        id: id,
        name: client.name,
        adminPhone: client.adminPhone,
        assistantPhone: client.assistantPhone,
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

  app.get('/clients/stats/overview', requireAdminAuth, async (req, res) => {
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

  app.post('/clients/reload', requireAdminAuth, async (req, res) => {
    try {
      console.log('🔄 Iniciando recarga de clientes desde Firebase...');

      const beforeCount = Object.keys(webhookManager.commandManager.getClientConfig()).length;
      const beforeClients = Object.keys(webhookManager.commandManager.getClientConfig());

      await webhookManager.commandManager.reloadClients();

      const afterCount = Object.keys(webhookManager.commandManager.getClientConfig()).length;
      const afterClients = Object.keys(webhookManager.commandManager.getClientConfig());

      const addedClients = afterClients.filter(id => !beforeClients.includes(id));
      const removedClients = beforeClients.filter(id => !afterClients.includes(id));

      console.log('✅ Recarga completada:');
      console.log(`- Antes: ${beforeCount} clientes`);
      console.log(`- Después: ${afterCount} clientes`);
      console.log(`- Agregados: ${addedClients.length}`);
      console.log(`- Removidos: ${removedClients.length}`);

      const currentClients = webhookManager.commandManager.getClientConfig();
      const clientsInfo = Object.entries(currentClients).map(([id, client]) => ({
        id: id,
        name: client.name,
        adminPhone: client.adminPhone,
        assistantPhone: client.assistantPhone,
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

  app.get('/clients/:clientId', requireAdminAuth, async (req, res) => {
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

  // ==================== ENDPOINTS DE DOCUMENTOS (ADMIN) ====================

  app.get('/clients/:clientId/documents', requireAdminAuth, async (req, res) => {
    try {
      const { clientId } = req.params;

      const client = await webhookManager.commandManager.firebaseService.getClientById(clientId);
      if (!client) {
        return res.status(404).json({
          ok: false,
          error: 'Cliente no encontrado'
        });
      }

      const documents = await documentStore.list(clientId);

      res.json({
        ok: true,
        clientId,
        count: documents.length,
        documents
      });
    } catch (error) {
      console.error('Error listando documentos:', error);
      res.status(500).json({
        ok: false,
        error: 'Error listando documentos',
        details: error.message
      });
    }
  });

  app.post(
    '/clients/:clientId/documents',
    requireAdminAuth,
    (req, res, next) => {
      uploadPdf.single('file')(req, res, (err) => {
        if (err) {
          const status = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
          return res.status(status).json({
            ok: false,
            error: err.message || 'Error al procesar el archivo'
          });
        }
        return next();
      });
    },
    async (req, res) => {
      try {
        const { clientId } = req.params;
        const documentoId = req.body?.documento_id || req.body?.documentoId;

        if (!documentoId) {
          return res.status(400).json({
            ok: false,
            error: 'documento_id es requerido (campo form)'
          });
        }

        if (!req.file || !req.file.buffer) {
          return res.status(400).json({
            ok: false,
            error: 'Archivo PDF requerido (campo multipart "file")'
          });
        }

        const client = await webhookManager.commandManager.firebaseService.getClientById(clientId);
        if (!client) {
          return res.status(404).json({
            ok: false,
            error: 'Cliente no encontrado'
          });
        }

        const saved = await documentStore.save(
          clientId,
          documentoId,
          req.file.buffer,
          req.file.originalname,
          req.file.mimetype
        );

        res.status(201).json({
          ok: true,
          message: 'Documento subido exitosamente',
          clientId,
          document: {
            documentoId: saved.documentoId,
            filename: saved.filename,
            size: saved.size
          }
        });
      } catch (error) {
        console.error('Error subiendo documento:', error);
        const status = /inválido|Solo se permiten|vacío/i.test(error.message) ? 400 : 500;
        res.status(status).json({
          ok: false,
          error: 'Error subiendo documento',
          details: error.message
        });
      }
    }
  );

  app.delete('/clients/:clientId/documents/:documentoId', requireAdminAuth, async (req, res) => {
    try {
      const { clientId, documentoId } = req.params;

      const client = await webhookManager.commandManager.firebaseService.getClientById(clientId);
      if (!client) {
        return res.status(404).json({
          ok: false,
          error: 'Cliente no encontrado'
        });
      }

      const deleted = await documentStore.delete(clientId, documentoId);
      if (!deleted) {
        return res.status(404).json({
          ok: false,
          error: `Documento no encontrado: ${documentoId}`
        });
      }

      res.json({
        ok: true,
        message: 'Documento eliminado exitosamente',
        clientId,
        documentoId
      });
    } catch (error) {
      console.error('Error eliminando documento:', error);
      const status = /inválido/i.test(error.message) ? 400 : 500;
      res.status(status).json({
        ok: false,
        error: 'Error eliminando documento',
        details: error.message
      });
    }
  });

  // ==================== ENDPOINTS DE GESTIÓN DE INSTANCIAS ULTRAMSG ====================

  app.get('/ultramsg/instances', requireAdminAuth, async (req, res) => {
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

  app.get('/ultramsg/instances/:instanceId', requireAdminAuth, async (req, res) => {
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

  app.post('/ultramsg/instances/:instanceId/send', requireAdminAuth, async (req, res) => {
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

  app.get('/health', (req, res) => {
    res.json({ status: 'OK' });
  });

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

  // ==================== PANEL ADMIN (SPA) ====================

  const publicDir = path.join(__dirname, '../public');
  app.use(express.static(publicDir));
  app.get('/', (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  return app;
}

module.exports = {
  createApp,
  hasUltraMsgFields,
  stripEmptyUltraMsgFields
};
