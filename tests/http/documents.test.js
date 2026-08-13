const request = require('supertest');
const { createTestApp, authHeader } = require('../helpers/createTestApp');

describe('Documentos', () => {
  it('GET lista PDFs', async () => {
    const { app, deps } = createTestApp({
      firebaseService: {
        getClientById: jest.fn().mockResolvedValue({ id: 'C1' })
      },
      documentStore: {
        list: jest.fn().mockResolvedValue([{ documentoId: 'lista_precios' }])
      }
    });
    const res = await request(app).get('/clients/C1/documents').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(deps.documentStore.list).toHaveBeenCalledWith('C1');
  });

  it('POST sube PDF', async () => {
    const { app, deps } = createTestApp({
      firebaseService: {
        getClientById: jest.fn().mockResolvedValue({ id: 'C1' })
      },
      documentStore: {
        save: jest.fn().mockResolvedValue({
          documentoId: 'lista_precios',
          filename: 'lista_precios.pdf',
          size: 12
        })
      }
    });
    const pdf = Buffer.from('%PDF-1.4\n%');
    const res = await request(app)
      .post('/clients/C1/documents')
      .set(authHeader())
      .field('documento_id', 'lista_precios')
      .attach('file', pdf, { filename: 'lista.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(201);
    expect(res.body.document.documentoId).toBe('lista_precios');
    expect(deps.documentStore.save).toHaveBeenCalled();
  });

  it('POST rechaza no-PDF', async () => {
    const { app } = createTestApp({
      firebaseService: {
        getClientById: jest.fn().mockResolvedValue({ id: 'C1' })
      }
    });
    const res = await request(app)
      .post('/clients/C1/documents')
      .set(authHeader())
      .field('documento_id', 'x')
      .attach('file', Buffer.from('hello'), { filename: 'nota.txt', contentType: 'text/plain' });

    expect(res.status).toBe(400);
  });

  it('DELETE documento', async () => {
    const { app } = createTestApp({
      firebaseService: {
        getClientById: jest.fn().mockResolvedValue({ id: 'C1' })
      },
      documentStore: { delete: jest.fn().mockResolvedValue(true) }
    });
    const res = await request(app)
      .delete('/clients/C1/documents/lista_precios')
      .set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
