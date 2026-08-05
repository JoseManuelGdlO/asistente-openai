const fs = require('fs').promises;
const path = require('path');

class DocumentStore {
  constructor(baseDir = null) {
    this.baseDir = baseDir || process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads');
  }

  /**
   * Normaliza un documento_id a slug seguro [a-z0-9_]
   * @param {string} documentoId
   * @returns {string}
   */
  normalizeId(documentoId) {
    if (!documentoId || typeof documentoId !== 'string') {
      throw new Error('documento_id inválido');
    }
    const normalized = documentoId
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '');

    if (!normalized || !/^[a-z0-9_]+$/.test(normalized)) {
      throw new Error('documento_id inválido. Usa solo letras, números y guion bajo.');
    }
    return normalized;
  }

  /**
   * Ruta del directorio de un cliente
   * @param {string} clientId
   * @returns {string}
   */
  getClientDir(clientId) {
    if (!clientId || /[^a-zA-Z0-9_]/.test(clientId)) {
      throw new Error('clientId inválido');
    }
    return path.join(this.baseDir, clientId);
  }

  /**
   * Ruta del archivo PDF de un documento
   * @param {string} clientId
   * @param {string} documentoId
   * @returns {string}
   */
  getFilePath(clientId, documentoId) {
    const id = this.normalizeId(documentoId);
    return path.join(this.getClientDir(clientId), `${id}.pdf`);
  }

  /**
   * Asegura que exista el directorio base y el del cliente
   * @param {string} clientId
   */
  async ensureClientDir(clientId) {
    await fs.mkdir(this.getClientDir(clientId), { recursive: true });
  }

  /**
   * Valida que el buffer sea un PDF
   * @param {Buffer} buffer
   * @param {string} [originalFilename]
   * @param {string} [mediaMime]
   */
  assertPdf(buffer, originalFilename = '', mediaMime = '') {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new Error('Archivo vacío o inválido');
    }

    const mime = (mediaMime || '').toLowerCase();
    const filename = (originalFilename || '').toLowerCase();
    const isPdfMime = !mime || mime === 'application/pdf' || mime.includes('pdf');
    const isPdfExt = !filename || filename.endsWith('.pdf');
    const hasPdfMagic = buffer.slice(0, 5).toString('ascii') === '%PDF-';

    if (!isPdfMime || !isPdfExt || !hasPdfMagic) {
      throw new Error('Solo se permiten archivos PDF');
    }
  }

  /**
   * Guarda un PDF para un cliente
   * @param {string} clientId
   * @param {string} documentoId
   * @param {Buffer} buffer
   * @param {string} [originalFilename]
   * @param {string} [mediaMime]
   * @returns {Promise<{documentoId: string, filename: string, path: string, size: number}>}
   */
  async save(clientId, documentoId, buffer, originalFilename = '', mediaMime = '') {
    this.assertPdf(buffer, originalFilename, mediaMime);
    const id = this.normalizeId(documentoId);
    await this.ensureClientDir(clientId);

    const filePath = this.getFilePath(clientId, id);
    await fs.writeFile(filePath, buffer);

    return {
      documentoId: id,
      filename: `${id}.pdf`,
      path: filePath,
      size: buffer.length
    };
  }

  /**
   * Lista documentos de un cliente
   * @param {string} clientId
   * @returns {Promise<Array<{documentoId: string, filename: string, size: number, uploadedAt: Date}>>}
   */
  async list(clientId) {
    const clientDir = this.getClientDir(clientId);
    try {
      const entries = await fs.readdir(clientDir);
      const docs = [];

      for (const entry of entries) {
        if (!entry.toLowerCase().endsWith('.pdf')) continue;
        const documentoId = entry.slice(0, -4);
        const filePath = path.join(clientDir, entry);
        const stat = await fs.stat(filePath);
        docs.push({
          documentoId,
          filename: entry,
          size: stat.size,
          uploadedAt: stat.mtime
        });
      }

      return docs.sort((a, b) => a.documentoId.localeCompare(b.documentoId));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  /**
   * Obtiene un documento por id
   * @param {string} clientId
   * @param {string} documentoId
   * @returns {Promise<{documentoId: string, filename: string, path: string, buffer: Buffer, size: number}|null>}
   */
  async get(clientId, documentoId) {
    const id = this.normalizeId(documentoId);
    const filePath = this.getFilePath(clientId, id);

    try {
      const buffer = await fs.readFile(filePath);
      return {
        documentoId: id,
        filename: `${id}.pdf`,
        path: filePath,
        buffer,
        size: buffer.length
      };
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  /**
   * Elimina un documento
   * @param {string} clientId
   * @param {string} documentoId
   * @returns {Promise<boolean>}
   */
  async delete(clientId, documentoId) {
    const id = this.normalizeId(documentoId);
    const filePath = this.getFilePath(clientId, id);

    try {
      await fs.unlink(filePath);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }
}

module.exports = DocumentStore;
