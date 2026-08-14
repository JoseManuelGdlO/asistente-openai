const ConfirmationManager = require('../../src/services/confirmationManager');

describe('ConfirmationManager', () => {
  const manager = new ConfirmationManager();

  it('detecta agradecimientos (acknowledgement)', () => {
    expect(manager.isAcknowledgementMessage('gracias')).toBe(true);
    expect(manager.isAcknowledgementMessage('Muchas gracias')).toBe(true);
    expect(manager.isAcknowledgementMessage('gracias!')).toBe(true);
    expect(manager.isAcknowledgementMessage('Gracias 💕')).toBe(true);
    expect(manager.isAcknowledgementMessage('ok gracias')).toBe(true);
    expect(manager.isAcknowledgementMessage('perfecto gracias')).toBe(true);
    expect(manager.isAcknowledgementMessage('mil gracias')).toBe(true);
    expect(manager.isAcknowledgementMessage('thanks')).toBe(true);
  });

  it('no trata preguntas o pedidos como agradecimiento', () => {
    expect(manager.isAcknowledgementMessage('¿Cuánto cuesta?')).toBe(false);
    expect(manager.isAcknowledgementMessage('quiero info del curso')).toBe(false);
    expect(manager.isAcknowledgementMessage('gracias, cuánto cuesta?')).toBe(false);
  });

  it('trata sí/ok como confirmación, no como acknowledgement', () => {
    expect(manager.isConfirmationMessage('sí')).toBe(true);
    expect(manager.isConfirmationMessage('ok')).toBe(true);
    expect(manager.isConfirmationMessage('vale')).toBe(true);
    expect(manager.isConfirmationMessage('claro')).toBe(true);
    expect(manager.isConfirmationMessage('Perfecto')).toBe(true);

    expect(manager.isAcknowledgementMessage('sí')).toBe(false);
    expect(manager.isAcknowledgementMessage('ok')).toBe(false);
    expect(manager.isAcknowledgementMessage('vale')).toBe(false);
    expect(manager.isAcknowledgementMessage('claro')).toBe(false);
  });

  it('no trata preguntas largas como confirmación', () => {
    expect(manager.isConfirmationMessage('¿Cuánto cuesta la consulta?')).toBe(false);
    expect(manager.isConfirmationMessage('Quiero agendar una cita mañana')).toBe(false);
  });

  it('gracias no es confirmación (va por acknowledgement)', () => {
    expect(manager.isConfirmationMessage('gracias')).toBe(false);
    expect(manager.isConfirmationMessage('muchas gracias')).toBe(false);
  });

  it('devuelve plantillas distintas', () => {
    expect(manager.getConfirmationResponse()).toMatch(/Perfecto/);
    expect(manager.getAcknowledgementResponse()).toMatch(/Con gusto/);
  });
});
