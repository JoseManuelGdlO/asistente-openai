const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const DocumentStore = require('../../src/services/documentStore');

describe('DocumentStore', () => {
  let tmpDir;
  let store;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'docs-'));
    store = new DocumentStore(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('normaliza documento_id', () => {
    expect(store.normalizeId('Lista Precios')).toBe('lista_precios');
    expect(() => store.normalizeId('')).toThrow(/inválido/);
    expect(() => store.normalizeId('***')).toThrow(/inválido/);
  });

  it('rechaza clientId inválido', () => {
    expect(() => store.getClientDir('../hack')).toThrow(/clientId inválido/);
  });

  it('assertPdf exige magic bytes %PDF-', () => {
    expect(() => store.assertPdf(Buffer.from('not a pdf'))).toThrow(/PDF/);
    expect(() => store.assertPdf(Buffer.from('%PDF-1.4\n%'))).not.toThrow();
    expect(() => store.assertPdf(Buffer.from('%PDF-1.4'), 'file.txt')).toThrow(/PDF/);
  });

  it('guarda, lista y borra PDFs', async () => {
    const pdf = Buffer.from('%PDF-1.4\n%test');
    const saved = await store.save('CLIENTE001', 'lista_precios', pdf, 'lista.pdf', 'application/pdf');
    expect(saved.documentoId).toBe('lista_precios');

    const listed = await store.list('CLIENTE001');
    expect(listed).toHaveLength(1);
    expect(listed[0].documentoId).toBe('lista_precios');

    const got = await store.get('CLIENTE001', 'lista_precios');
    expect(got.buffer.equals(pdf)).toBe(true);

    await expect(store.delete('CLIENTE001', 'lista_precios')).resolves.toBe(true);
    await expect(store.list('CLIENTE001')).resolves.toEqual([]);
  });
});
