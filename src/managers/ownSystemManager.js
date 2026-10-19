const axios = require('axios');
require('dotenv').config();

class OwnSystemManager {
  constructor() {
    this.baseUrl = (process.env.OWN_API_BASE_URL || '').replace(/\/+$/, '');
  }

  requireAuth({ deviceId, tenantId, apiKey, to }) {
    if (!this.baseUrl) {
      throw new Error('OWN_API_BASE_URL no está configurado');
    }
    if (!deviceId) throw new Error('deviceId es requerido');
    if (!tenantId) throw new Error('tenantId es requerido');
    if (!apiKey) throw new Error('apiKey (OWN_API_KEY) es requerido');
    if (!to) throw new Error('to es requerido');
  }

  async postDevice(deviceId, suffix, payload, auth, errorLabel, timeout = 30000) {
    const url = `${this.baseUrl}/devices/${encodeURIComponent(deviceId)}/${suffix}`;
    try {
      const response = await axios.post(url, payload, {
        headers: {
          'content-type': 'application/json',
          'x-api-key': auth.apiKey,
          'x-tenant-id': auth.tenantId
        },
        timeout
      });
      return response.data;
    } catch (error) {
      const status = error.response?.status;
      const data = error.response?.data;
      const msg = data ? JSON.stringify(data) : (error.message || 'unknown_error');
      const detail = status ? `HTTP ${status}: ${msg}` : msg;
      console.error(`❌ Error ${errorLabel}:`, detail);
      throw error;
    }
  }

  async sendMessage({ deviceId, tenantId, apiKey, to, text, isTest = false }) {
    this.requireAuth({ deviceId, tenantId, apiKey, to });
    if (!text) throw new Error('text es requerido');

    const payload = { to, text };
    if (isTest) payload.isTest = true;
    return this.postDevice(deviceId, 'messages/send', payload, { apiKey, tenantId }, 'enviando mensaje via OwnSystem');
  }

  /**
   * Marca el chat como leído.
   * POST /devices/:deviceId/chats/read
   */
  async markRead({ deviceId, tenantId, apiKey, to }) {
    this.requireAuth({ deviceId, tenantId, apiKey, to });
    return this.postDevice(deviceId, 'chats/read', { to }, { apiKey, tenantId }, 'marcando leído via OwnSystem', 10000);
  }

  /**
   * Presencia de escritura. presence: 'composing' | 'paused'
   * POST /devices/:deviceId/presence
   */
  async setPresence({ deviceId, tenantId, apiKey, to, presence }) {
    this.requireAuth({ deviceId, tenantId, apiKey, to });
    if (presence !== 'composing' && presence !== 'paused') {
      throw new Error('presence inválida');
    }
    return this.postDevice(
      deviceId,
      'presence',
      { to, presence },
      { apiKey, tenantId },
      'actualizando presencia via OwnSystem',
      10000
    );
  }
}

module.exports = OwnSystemManager;

