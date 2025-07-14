const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

class FacebookTokenManager {
  constructor() {
    this.tokenFilePath = path.join(__dirname, '../token.json');
    this.refreshInterval = null;
    this.lastRefreshDate = null;
  }

  async refreshFacebookToken(longLivedToken) {
    const appId = process.env.FB_APP_ID;
    const appSecret = process.env.FB_APP_SECRET;

    if (!appId || !appSecret) {
      throw new Error('FB_APP_ID y FB_APP_SECRET deben estar configurados en las variables de entorno');
    }

    const url = `https://graph.facebook.com/v18.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${longLivedToken}`;

    try {
      const response = await axios.get(url);
      return response.data.access_token; // Nuevo token válido por 60 días
    } catch (error) {
      console.error('Error en refreshFacebookToken:', error.response?.data || error.message);
      throw new Error(`Error al renovar token de Facebook: ${error.response?.status || 'Unknown'} - ${error.response?.data?.error?.message || error.message}`);
    }
  }

  async saveToken(token) {
    const tokenData = {
      token: token,
      refreshDate: new Date().toISOString(),
      expiresAt: new Date(Date.now() + (50 * 24 * 60 * 60 * 1000)).toISOString() // 50 días
    };

    try {
      await fs.writeFile(this.tokenFilePath, JSON.stringify(tokenData, null, 2));
      console.log('Token guardado exitosamente');
      this.lastRefreshDate = new Date();
    } catch (error) {
      console.error('Error al guardar token:', error);
      throw error;
    }
  }

  async loadToken() {
    try {
      const data = await fs.readFile(this.tokenFilePath, 'utf8');
      const tokenData = JSON.parse(data);
      
      // Verificar si el token está próximo a expirar (menos de 5 días)
      const expiresAt = new Date(tokenData.expiresAt);
      const now = new Date();
      const daysUntilExpiry = (expiresAt - now) / (1000 * 60 * 60 * 24);

      if (daysUntilExpiry < 5) {
        console.log(`Token expira en ${daysUntilExpiry.toFixed(1)} días, refrescando...`);
        return await this.refreshAndSaveToken(tokenData.token);
      }

      this.lastRefreshDate = new Date(tokenData.refreshDate);
      return tokenData.token;
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log('Archivo de token no encontrado, usando token de entorno');
        return process.env.WHATSAPP_TOKEN;
      }
      console.error('Error al cargar token:', error);
      throw error;
    }
  }

  async refreshAndSaveToken(currentToken) {
    try {
      console.log('Iniciando refresh del token de Facebook...');
      const newToken = await this.refreshFacebookToken(currentToken);
      await this.saveToken(newToken);
      console.log('Token refrescado exitosamente');
      return newToken;
    } catch (error) {
      console.error('Error al refrescar token:', error);
      // Si falla el refresh, usar el token actual
      return currentToken;
    }
  }

  async startAutoRefresh() {
    // Refrescar token cada 50 días (en milisegundos)
    const refreshIntervalMs = 50 * 24 * 60 * 60 * 1000;
    
    this.refreshInterval = setInterval(async () => {
      try {
        console.log('Ejecutando refresh automático del token...');
        const currentToken = await this.loadToken();
        await this.refreshAndSaveToken(currentToken);
      } catch (error) {
        console.error('Error en refresh automático:', error);
      }
    }, refreshIntervalMs);

    console.log(`Refresh automático configurado para ejecutarse cada 50 días`);
  }

  stopAutoRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
      console.log('Refresh automático detenido');
    }
  }

  async getValidToken() {
    try {
      return await this.loadToken();
    } catch (error) {
      console.error('Error al obtener token válido:', error);
      // Fallback al token de entorno
      return process.env.WHATSAPP_TOKEN;
    }
  }
}

module.exports = FacebookTokenManager; 