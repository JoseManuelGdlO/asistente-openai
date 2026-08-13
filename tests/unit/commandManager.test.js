const CommandManager = require('../../src/services/commandManager');

const TEST_CLIENTS = {
  CLIENTE001: {
    id: 'CLIENTE001',
    name: 'Consultorio Test',
    adminPhone: '5216181344331@c.us',
    assistantPhone: '6182191002',
    botStatus: 'active'
  }
};

async function createManager() {
  const firebaseService = {
    getAllClients: jest.fn().mockResolvedValue(TEST_CLIENTS),
    updateBotStatus: jest.fn().mockResolvedValue(undefined),
    getBlacklist: jest.fn().mockResolvedValue([]),
    addToBlacklist: jest.fn(),
    removeFromBlacklist: jest.fn()
  };
  const manager = new CommandManager({ list: jest.fn() }, firebaseService);
  await manager.loadClientsFromFirebase();
  return { manager, firebaseService };
}

describe('CommandManager', () => {
  it('detecta y parsea comandos', async () => {
    const { manager } = await createManager();
    expect(manager.isCommand('#CLIENTE001 /on')).toBe(true);
    expect(manager.isCommand('hola')).toBe(false);
    expect(manager.extractCommandInfo('#CLIENTE001 /off')).toEqual({
      clientId: 'CLIENTE001',
      command: '/off',
      args: '',
      arg: null
    });
    expect(manager.extractCommandInfo('#CLIENTE001 /upload lista_precios').arg).toBe('lista_precios');
  });

  it('autoriza solo al adminPhone', async () => {
    const { manager } = await createManager();
    expect(manager.isAuthorizedNumber('5216181344331@c.us', 'CLIENTE001')).toBe(true);
    expect(manager.isAuthorizedNumber('5210000000000@c.us', 'CLIENTE001')).toBe(false);
  });

  it('/help no requiere auth', async () => {
    const { manager } = await createManager();
    const result = await manager.processMessage('#CLIENTE001 /help', '521000@c.us');
    expect(result.isCommand).toBe(true);
    expect(result.response).toMatch(/Comandos/);
  });

  it('/off rechaza a no-admin', async () => {
    const { manager } = await createManager();
    const result = await manager.processMessage('#CLIENTE001 /off', '521000@c.us');
    expect(result.response).toMatch(/No autorizado/);
  });

  it('/on enciende el bot si es admin', async () => {
    const { manager, firebaseService } = await createManager();
    manager.botStatus.set('CLIENTE001', 'inactive');
    const result = await manager.processMessage('#CLIENTE001 /on', '5216181344331@c.us');
    expect(result.response).toMatch(/ENCENDIDO|encend/i);
    expect(firebaseService.updateBotStatus).toHaveBeenCalledWith('CLIENTE001', 'active');
    expect(manager.isBotActive('CLIENTE001')).toBe(true);
  });
});
