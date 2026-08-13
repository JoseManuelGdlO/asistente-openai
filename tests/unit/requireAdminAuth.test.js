const requireAdminAuth = require('../../src/middleware/requireAdminAuth');

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
  return res;
}

describe('requireAdminAuth', () => {
  const original = process.env.ADMIN_API_TOKEN;

  afterEach(() => {
    process.env.ADMIN_API_TOKEN = original;
  });

  it('responde 503 si ADMIN_API_TOKEN no está configurado', () => {
    delete process.env.ADMIN_API_TOKEN;
    const res = mockRes();
    const next = jest.fn();
    requireAdminAuth({ headers: {} }, res, next);
    expect(res.statusCode).toBe(503);
    expect(res.body.ok).toBe(false);
    expect(next).not.toHaveBeenCalled();
  });

  it('responde 401 con token inválido', () => {
    process.env.ADMIN_API_TOKEN = 'secret';
    const res = mockRes();
    const next = jest.fn();
    requireAdminAuth({ headers: { authorization: 'Bearer wrong' } }, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('acepta Authorization Bearer válido', () => {
    process.env.ADMIN_API_TOKEN = 'secret';
    const res = mockRes();
    const next = jest.fn();
    requireAdminAuth({ headers: { authorization: 'Bearer secret' } }, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('acepta header x-admin-token válido', () => {
    process.env.ADMIN_API_TOKEN = 'secret';
    const res = mockRes();
    const next = jest.fn();
    requireAdminAuth({ headers: { 'x-admin-token': 'secret' } }, res, next);
    expect(next).toHaveBeenCalled();
  });
});
