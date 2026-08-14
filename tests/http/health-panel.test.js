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

  it('GET / sirve el panel con nav Sesiones', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/Panel admin/);
    expect(res.text).toMatch(/#\/sessions/);
    expect(res.text).toMatch(/js\/api\.js/);
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
