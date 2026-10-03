const request = require('supertest');
const { createTestApp } = require('../helpers/createTestApp');

describe('Panel y endpoints públicos', () => {
  let app;

  beforeEach(() => {
    ({ app } = createTestApp());
  });

  it('GET /health', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'OK' });
  });

  it('POST /test', async () => {
    const res = await request(app).post('/test').send({ ping: 1 });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('OK');
    expect(res.body.body).toEqual({ ping: 1 });
  });

  it('POST /auth/login acepta el correo configurado', async () => {
    process.env.LOGIN_EMAIL = 'admin@asistente.local';
    process.env.LOGIN_PASSWORD = 'clave-segura';

    const ok = await request(app).post('/auth/login').send({
      email: 'Admin@asistente.local',
      password: 'clave-segura'
    });
    expect(ok.status).toBe(200);
    expect(ok.body.ok).toBe(true);
    expect(ok.body.token).toBe(process.env.ADMIN_API_TOKEN);

    const bad = await request(app).post('/auth/login').send({
      email: 'admin@asistente.local',
      password: 'incorrecta'
    });
    expect(bad.status).toBe(401);
    expect(bad.body.token).toBeUndefined();
  });

  it('POST /auth/login/confirm guarda la confirmación en Firebase', async () => {
    process.env.LOGIN_EMAIL = 'admin@asistente.local';
    process.env.LOGIN_PASSWORD = 'clave-segura';
    const confirmPanelLogin = jest.fn(async ({ email }) => ({
      id: 'confirm-1',
      email,
      confirmedAt: '2026-10-02T00:00:00.000Z'
    }));
    const { app: confirmApp } = createTestApp({
      firebaseService: { confirmPanelLogin }
    });

    const res = await request(confirmApp).post('/auth/login/confirm').send({
      email: 'admin@asistente.local',
      password: 'clave-segura'
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.token).toBe(process.env.ADMIN_API_TOKEN);
    expect(res.body.confirmation.email).toBe('admin@asistente.local');
    expect(confirmPanelLogin).toHaveBeenCalledWith({ email: 'admin@asistente.local' });
  });

  it('POST /auth/login/confirm acepta un usuario de Firebase Auth', async () => {
    process.env.LOGIN_EMAIL = 'admin@asistente.local';
    process.env.LOGIN_PASSWORD = 'clave-segura';
    const verifyPanelUser = jest.fn(async () => ({
      email: 'admin2@asistente.local',
      uid: 'uid-1'
    }));
    const confirmPanelLogin = jest.fn(async ({ email }) => ({
      id: 'confirm-2',
      email,
      confirmedAt: '2026-10-02T00:00:00.000Z'
    }));
    const { app: confirmApp } = createTestApp({
      firebaseService: { verifyPanelUser, confirmPanelLogin }
    });

    const res = await request(confirmApp).post('/auth/login/confirm').send({
      email: 'admin2@asistente.local',
      password: 'otra-clave'
    });

    expect(res.status).toBe(200);
    expect(res.body.confirmation.email).toBe('admin2@asistente.local');
    expect(verifyPanelUser).toHaveBeenCalledWith({
      email: 'admin2@asistente.local',
      password: 'otra-clave'
    });
  });

  it('GET / sirve el panel con nav Sesiones', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/Intelekia Chatbot/);
    expect(res.text).toMatch(/#\/sessions/);
    expect(res.text).toMatch(/js\/api\.js/);
    expect(res.text).toMatch(/href="\/terminos"/);
    expect(res.text).toMatch(/Términos y Condiciones/);
    expect(res.text).toMatch(/href="\/privacidad"/);
    expect(res.text).toMatch(/Aviso de Privacidad/);
  });

  it('GET /terminos es público', async () => {
    const res = await request(app).get('/terminos');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/Términos y Condiciones/);
    expect(res.text).toMatch(/Volver al panel/);
    expect(res.text).toMatch(/Embedded Signup/);
  });

  it('GET /privacidad menciona Meta', async () => {
    const res = await request(app).get('/privacidad');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/Meta Platforms/);
    expect(res.text).toMatch(/eliminar-datos/);
  });

  it('GET /eliminar-datos es público', async () => {
    const res = await request(app).get('/eliminar-datos');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/Eliminación de datos/);
  });

  it('GET /vincular/:token sirve la página', async () => {
    const res = await request(app).get('/vincular/abc123');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/Vincular WhatsApp/);
    expect(res.text).toMatch(/js\/vincular\.js/);
  });

  it('sirve estáticos del panel', async () => {
    await request(app).get('/js/api.js').expect(200);
    await request(app).get('/js/app.js').expect(200);
    await request(app).get('/styles.css').expect(200);
  });

  it('GET /group-settings', async () => {
    const res = await request(app).get('/group-settings');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.groupBehavior.respondInGroups).toBe(false);
  });
});
