const ConfirmationManager = require('../../src/services/confirmationManager');

describe('ConfirmationManager', () => {
  const manager = new ConfirmationManager();

  it('detecta confirmaciones cortas', () => {
    expect(manager.isConfirmationMessage('ok')).toBe(true);
    expect(manager.isConfirmationMessage('gracias')).toBe(true);
    expect(manager.isConfirmationMessage('Perfecto')).toBe(true);
    expect(manager.isConfirmationMessage('sí')).toBe(true);
  });

  it('no trata preguntas largas como confirmación', () => {
    expect(manager.isConfirmationMessage('¿Cuánto cuesta la consulta?')).toBe(false);
    expect(manager.isConfirmationMessage('Quiero agendar una cita mañana')).toBe(false);
  });

  it('devuelve una respuesta automática', () => {
    expect(manager.getConfirmationResponse()).toMatch(/Perfecto/);
  });
});
