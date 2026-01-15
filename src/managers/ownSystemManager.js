const axios = require('axios');
require('dotenv').config();

class OwnSystemManager {
  constructor() {
    this.baseUrl = (process.env.OWN_API_BASE_URL || '').replace(/\/+$/, '');
  }

  /**
   * Envía un mensaje saliente vía tu backend WhatsApp
   * POST /devices/:deviceId/messages/send
   *
   * @param {Object} params
   * @param {string} params.deviceId
   * @param {string} params.tenantId
   * @param {string} params.apiKey - OWN_API_KEY del cliente
   * @param {string} params.to - JID destino (ej: 549...@s.whatsapp.net o @g.us)
   * @param {string} params.text - Texto a enviar
   * @param {boolean} [params.isTest]
   */
  async sendMessage({ deviceId, tenantId, apiKey, to, text, isTest = false }) {
    if (!this.baseUrl) {
      throw new Error('OWN_API_BASE_URL no está configurado');
    }
    if (!deviceId) throw new Error('deviceId es requerido');
    if (!tenantId) throw new Error('tenantId es requerido');
    if (!apiKey) throw new Error('apiKey (OWN_API_KEY) es requerido');
    if (!to) throw new Error('to es requerido');
    if (!text) throw new Error('text es requerido');

    const url = `${this.baseUrl}/devices/${encodeURIComponent(deviceId)}/messages/send`;

    const payload = { to, text };
    if (isTest) payload.isTest = true;

    try {
      const response = await axios.post(url, payload, {
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        },
        timeout: 30000
      });

      return response.data;
    } catch (error) {
      const status = error.response?.status;
      const data = error.response?.data;
      const msg = data ? JSON.stringify(data) : (error.message || 'unknown_error');
      const detail = status ? `HTTP ${status}: ${msg}` : msg;
      console.error('❌ Error enviando mensaje via OwnSystem:', detail);
      throw error;
    }
  }
}

module.exports = OwnSystemManager;

