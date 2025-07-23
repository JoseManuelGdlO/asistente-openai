const axios = require('axios');
require('dotenv').config();

class UltraMsgManager {
  constructor() {
    this.token = process.env.ULTRAMSG_TOKEN;
    this.instanceId = process.env.ULTRAMSG_INSTANCE_ID;
    
    if (!this.token || !this.instanceId) {
      console.error('❌ ULTRAMSG_TOKEN y ULTRAMSG_INSTANCE_ID deben estar configurados en .env');
    }
  }

  // Enviar mensaje de texto
  async sendMessage(to, message) {
    try {
      const url = `https://api.ultramsg.com/${this.instanceId}/messages/chat?token=${this.token}`;
      
      const data = {
        to: to,
        body: message,
        priority: 10,
        referenceId: '',
        msgId: ''
      };

      const response = await axios.post(url, data, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      console.log('✅ Mensaje enviado via UltraMsg:', response.data);
      return response.data;
    } catch (error) {
      console.error('❌ Error enviando mensaje via UltraMsg:', error.response?.data || error.message);
      throw error;
    }
  }

  // Verificar estado de la instancia
  async getInstanceStatus() {
    try {
      const url = `https://api.ultramsg.com/${this.instanceId}/instance/status?token=${this.token}`;
      
      const response = await axios.get(url);

    //   console.log('📊 Estado de UltraMsg:', response.data);
      return response.data;
    } catch (error) {
      console.error('❌ Error obteniendo estado de UltraMsg:', error.response?.data || error.message);
      throw error;
    }
  }

  // Obtener información de la instancia
  async getInstanceInfo() {
    try {
      const url = `https://api.ultramsg.com/${this.instanceId}/instance/me?token=${this.token}`;
      
      const response = await axios.get(url);

    //   console.log('ℹ️ Información de UltraMsg:', response.data);
      return response.data;
    } catch (error) {
      console.error('❌ Error obteniendo info de UltraMsg:', error.response?.data || error.message);
      throw error;
    }
  }

  // Verificar si la instancia está conectada
  async isConnected() {
    try {
      const status = await this.getInstanceStatus();
      return status.status.accountStatus.substatus === 'connected';
    } catch (error) {
      return false;
    }
  }

  // Obtener mensajes (para webhook)
  async getMessages() {
    try {
      const url = `https://api.ultramsg.com/${this.instanceId}/messages?token=${this.token}`;
      
      const response = await axios.get(url);

      return response.data;
    } catch (error) {
      console.error('❌ Error obteniendo mensajes de UltraMsg:', error.response?.data || error.message);
      throw error;
    }
  }
}

module.exports = UltraMsgManager; 