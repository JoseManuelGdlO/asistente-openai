const request = require('supertest');
const { createTestApp, authHeader, ADMIN_TOKEN } = require('../helpers/createTestApp');

describe('Auth admin', () => {
  let app;

  beforeEach(() => {
    ({ app } = createTestApp());
  });

  it('GET /clients sin token → 401', async () => {
    const res = await request(app).get('/clients');
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it('GET /sessions con token inválido → 401', async () => {
    const res = await request(app).get('/sessions').set(authHeader('wrong'));
    expect(res.status).toBe(401);
  });

  it('GET /clients con Bearer válido → 200', async () => {
    const res = await request(app).get('/clients').set(authHeader(ADMIN_TOKEN));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('acepta x-admin-token', async () => {
    const res = await request(app)
      .get('/sessions')
      .set('x-admin-token', ADMIN_TOKEN);
    expect(res.status).toBe(200);
  });
});
