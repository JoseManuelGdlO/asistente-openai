const UserContextManager = require('../../src/services/userContextManager');

describe('UserContextManager', () => {
  let manager;

  beforeEach(() => {
    manager = new UserContextManager();
  });

  it('marca agenda enviada y espera confirmación', () => {
    manager.markAgendaSent('521555');
    expect(manager.isWaitingForConfirmation('521555')).toBe(true);
    const ctx = manager.getUserContext('521555');
    expect(ctx.lastMessageType).toBe('agenda_sent');
  });

  it('actualiza confirmación y deja de esperar', () => {
    manager.markAgendaSent('521555');
    manager.updateUserContext('521555', 'confirmation', 'ok');
    expect(manager.isWaitingForConfirmation('521555')).toBe(false);
    expect(manager.getUserContext('521555').confirmationCount).toBe(1);
  });

  it('limpia el contexto', () => {
    manager.markAgendaSent('521555');
    manager.clearUserContext('521555');
    expect(manager.getUserContext('521555').isWaitingForConfirmation).toBe(false);
    expect(manager.getUserContext('521555').lastMessageType).toBeNull();
  });
});
