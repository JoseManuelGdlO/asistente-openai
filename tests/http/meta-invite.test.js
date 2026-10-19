const request = require('supertest');
const { createTestApp, authHeader } = require('../helpers/createTestApp');

describe('Invite y signup Meta', () => {
  it('GET /public/meta/invite/:token 404 si no existe', async () => {
    const { app } = createTestApp({
      firebaseService: { getClientByInviteToken: jest.fn().mockResolvedValue(null) }
    });
    const res = await request(app).get('/public/meta/invite/nope');
    expect(res.status).toBe(404);
  });

  it('GET /public/meta/invite/:token 410 si venció', async () => {
    const { app } = createTestApp({
      firebaseService: {
        getClientByInviteToken: jest.fn().mockResolvedValue({
          id: 'C1',
          name: 'Bot',
          META_INVITE_TOKEN_HASH: 'x',
          META_INVITE_EXPIRES_AT: '2020-01-01T00:00:00.000Z'
        })
      }
    });
    const res = await request(app).get('/public/meta/invite/old');
    expect(res.status).toBe(410);
  });

  it('GET /public/meta/invite/:token 410 si ya está vinculado', async () => {
    const { app } = createTestApp({
      firebaseService: {
        getClientByInviteToken: jest.fn().mockResolvedValue({
          id: 'C1',
          name: 'Bot',
          META_PHONE_NUMBER_ID: '555',
          META_INVITE_TOKEN_HASH: 'x'
        })
      }
    });
    const res = await request(app).get('/public/meta/invite/used');
    expect(res.status).toBe(410);
  });

  it('GET /public/meta/invite/:token 200 pendiente', async () => {
    const { app } = createTestApp({
      firebaseService: {
        getClientByInviteToken: jest.fn().mockResolvedValue({
          id: 'C1',
          name: 'Consultorio',
          META_INVITE_TOKEN_HASH: 'x',
          META_INVITE_EXPIRES_AT: '2099-01-01T00:00:00.000Z'
        })
      }
    });
    const res = await request(app).get('/public/meta/invite/ok');
    expect(res.status).toBe(200);
    expect(res.body.botName).toBe('Consultorio');
    expect(res.body.config.appId).toBe(process.env.META_APP_ID);
    expect(res.body.config).not.toHaveProperty('appSecret');
  });

  it('POST /public/meta/signup usa el servicio inyectado', async () => {
    const completeEmbeddedSignup = jest.fn().mockResolvedValue({
      displayPhoneNumber: '+52 618',
      coexistenceEnabled: true,
      phoneNumberId: '555',
      wabaId: 'waba-1'
    });
    const { app } = createTestApp({
      metaSignup: { completeEmbeddedSignup }
    });
    const res = await request(app).post('/public/meta/signup').send({
      token: 'tok',
      code: 'code',
      wabaId: 'waba-1',
      event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'
    });
    expect(res.status).toBe(201);
    expect(res.body.coexistenceEnabled).toBe(true);
    expect(completeEmbeddedSignup).toHaveBeenCalled();
  });

  it('POST /clients/:id/meta/invite regenera el link', async () => {
    const regenerateInvite = jest.fn().mockResolvedValue({
      client: { id: 'C1', name: 'Bot' },
      invite: { token: 'newtoken', expiresAt: '2099-01-01T00:00:00.000Z' }
    });
    const { app } = createTestApp({
      metaSignup: { regenerateInvite }
    });
    const res = await request(app)
      .post('/clients/C1/meta/invite')
      .set(authHeader())
      .send();
    expect(res.status).toBe(200);
    expect(res.body.inviteUrl).toMatch(/\/vincular\/newtoken/);
  });
});
