const { createApp } = require('../../src/app');

const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN || 'test-admin-token';

function fnAsync(value) {
  const impl = typeof value === 'function' ? value : async () => value;
  return jest.fn(impl);
}

function createStubDeps(overrides = {}) {
  const firebaseService = {
    getClientById: fnAsync(null),
    getClientStats: fnAsync({ total: 0 }),
    ...overrides.firebaseService
  };

  const commandManager = {
    getAllBotsStatus: jest.fn(() => ({})),
    getClientConfig: jest.fn(() => ({})),
    executeCommand: fnAsync('ok'),
    createClient: fnAsync({ client: { id: 'C1' }, assistant: { clientId: 'C1' } }),
    updateClient: fnAsync({ id: 'C1' }),
    deleteClient: fnAsync({ id: 'C1' }),
    listAssistants: fnAsync([]),
    getAssistantConfig: fnAsync(null),
    updateAssistant: fnAsync({ clientId: 'C1' }),
    reloadClients: fnAsync(),
    firebaseService,
    ...overrides.commandManager
  };

  const webhookManager = {
    verifyWebhookToken: jest.fn((token) => token === process.env.ULTRAMSG_WEBHOOK_TOKEN),
    handleWebhook: fnAsync({ processed: false, reason: 'invalid_message_format' }),
    handleOwnWebhook: fnAsync({ processed: false, reason: 'invalid_message_format' }),
    commandManager,
    ...overrides.webhookManager
  };

  const openAIManager = {
    resetSessions: fnAsync(0),
    listSessions: fnAsync([]),
    deleteSessionsByUserId: fnAsync(0),
    deleteSessionsByClientCode: fnAsync(0),
    deleteSession: fnAsync(true),
    firebaseService,
    ...overrides.openAIManager
  };

  const userContextManager = {
    markAgendaSent: jest.fn(),
    getUserContext: jest.fn((userId) => ({
      lastMessageType: null,
      lastMessageTime: null,
      confirmationCount: 0,
      isWaitingForConfirmation: false,
      userId
    })),
    clearUserContext: jest.fn(),
    ...overrides.userContextManager
  };

  const schedulerController = {
    getTasksStatus: jest.fn(() => ({ ok: true, tasks: {} })),
    runTaskManually: fnAsync({ ok: true }),
    stopAllTasks: jest.fn(() => ({ ok: true })),
    restartTasks: jest.fn(() => ({ ok: true })),
    ...overrides.schedulerController
  };

  const documentStore = {
    list: fnAsync([]),
    save: fnAsync({ documentoId: 'lista_precios', filename: 'lista_precios.pdf', size: 10 }),
    delete: fnAsync(true),
    ...overrides.documentStore
  };

  const ultraMsgManager = {
    getAllInstances: jest.fn(() => []),
    getAllInstancesStatus: fnAsync({}),
    getInstance: jest.fn(() => null),
    getInstanceInfo: fnAsync({}),
    getInstanceStatus: fnAsync({}),
    isConnected: fnAsync(false),
    sendMessage: fnAsync({ sent: true }),
    instances: new Map(),
    ...overrides.ultraMsgManager
  };

  return {
    ultraMsgManager,
    openAIManager,
    webhookManager,
    userContextManager,
    schedulerController,
    documentStore,
    reinitUltraMsgInstances: overrides.reinitUltraMsgInstances || fnAsync(),
    firebaseService,
    commandManager
  };
}

function createTestApp(overrides = {}) {
  const deps = createStubDeps(overrides);
  const app = createApp(deps);
  return { app, deps, adminToken: ADMIN_TOKEN };
}

function authHeader(token = ADMIN_TOKEN) {
  return { Authorization: `Bearer ${token}` };
}

module.exports = {
  ADMIN_TOKEN,
  createStubDeps,
  createTestApp,
  authHeader
};
