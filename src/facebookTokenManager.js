const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

class FacebookTokenManager {
  constructor() {
    this.tokenFilePath = path.join(__dirname, '../token.json');
    this.refreshInterval = null;
    this.lastRefreshDate = null;
    this.isRefreshing = false; // Flag para evitar refreshes simultáneos
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
      // Escribir directamente al archivo (más simple y evita problemas de permisos en Windows)
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
      
      // Validar que el archivo no esté vacío
      if (!data || data.trim() === '') {
        console.log('Archivo de token vacío, usando token de entorno');
        return process.env.WHATSAPP_TOKEN;
      }
      
      const tokenData = JSON.parse(data);
      
      // Validar estructura del token
      if (!tokenData.token || !tokenData.expiresAt) {
        console.log('Estructura de token inválida, usando token de entorno');
        return process.env.WHATSAPP_TOKEN;
      }
      
      // Verificar si el token está próximo a expirar (menos de 5 días)
      const expiresAt = new Date(tokenData.expiresAt);
      const now = new Date();
      const daysUntilExpiry = (expiresAt - now) / (1000 * 60 * 60 * 24);

      if (daysUntilExpiry < 5) {
        console.log(`Token expira en ${daysUntilExpiry.toFixed(1)} días, pero no se refrescará automáticamente`);
        const newToken = await this.refreshAndSaveToken(tokenData.token);
        console.log('Token refrescado exitosamente');
        return newToken;
      }

      this.lastRefreshDate = new Date(tokenData.refreshDate);
      return tokenData.token;
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log('Archivo de token no encontrado, usando token de entorno');
        return process.env.WHATSAPP_TOKEN;
      }
      
      if (error instanceof SyntaxError) {
        console.error('Error de sintaxis JSON en token.json, eliminando archivo corrupto...');
        try {
          await fs.unlink(this.tokenFilePath);
          console.log('Archivo corrupto eliminado');
        } catch (deleteError) {
          console.error('No se pudo eliminar archivo corrupto:', deleteError.message);
        }
        return process.env.WHATSAPP_TOKEN;
      }
      
      console.error('Error al cargar token:', error);
      return process.env.WHATSAPP_TOKEN; // Fallback al token de entorno
    }
  }

  async refreshAndSaveToken(currentToken) {
    // Evitar refreshes simultáneos
    if (this.isRefreshing) {
      console.log('Refresh ya en progreso, esperando...');
      return currentToken;
    }

    this.isRefreshing = true;
    
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
    } finally {
      this.isRefreshing = false;
    }
  }

  async getCurrentToken() {
    try {
      const data = await fs.readFile(this.tokenFilePath, 'utf8');
      
      // Validar que el archivo no esté vacío
      if (!data || data.trim() === '') {
        return process.env.WHATSAPP_TOKEN;
      }
      
      const tokenData = JSON.parse(data);
      
      // Validar estructura del token
      if (!tokenData.token) {
        return process.env.WHATSAPP_TOKEN;
      }
      
      return tokenData.token;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return process.env.WHATSAPP_TOKEN;
      }
      
      if (error instanceof SyntaxError) {
        console.error('Error de sintaxis JSON en token.json, usando token de entorno');
        return process.env.WHATSAPP_TOKEN;
      }
      
      console.error('Error al obtener token actual:', error);
      return process.env.WHATSAPP_TOKEN;
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

  async getValidTokenWithAutoRefresh() {
    try {
      // Primero cargar el token actual
      const currentToken = await this.loadToken();
      
      // Verificar si el token está próximo a expirar (menos de 5 días)
      try {
        const data = await fs.readFile(this.tokenFilePath, 'utf8');
        
        if (data && data.trim() !== '') {
          const tokenData = JSON.parse(data);
          
          if (tokenData.expiresAt) {
            const expiresAt = new Date(tokenData.expiresAt);
            const now = new Date();
            const daysUntilExpiry = (expiresAt - now) / (1000 * 60 * 60 * 24);
            
            console.log(`Token expira en ${daysUntilExpiry.toFixed(1)} días`);
            
            // Si está por vencer (menos de 5 días), hacer refresh automático
            if (daysUntilExpiry < 5) {
              console.log('Token próximo a expirar, aplicando refresh automático...');
              const newToken = await this.refreshAndSaveToken(currentToken);
              console.log('Refresh automático completado');
              return newToken;
            }
          }
        }
      } catch (error) {
        console.log('No se pudo verificar la expiración del token, usando token actual');
      }
      
      return currentToken;
    } catch (error) {
      console.error('Error al obtener token válido con auto-refresh:', error);
      // Fallback al token de entorno
      return process.env.WHATSAPP_TOKEN;
    }
  }
}

module.exports = FacebookTokenManager; 