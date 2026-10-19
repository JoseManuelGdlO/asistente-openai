const { decryptMetaAccessToken } = require('../utils/credentialsCrypto');
const { sendCloudMessage, uploadWhatsappMedia, downloadWhatsappMedia } = require('../services/metaGraphClient');

function toWhatsappTo(to) {
  return String(to || '').replace(/@c\.us$|@s\.whatsapp\.net$/i, '').replace(/\D/g, '');
}

class MetaWhatsappManager {
  constructor(graphClient = null) {
    this.graphClient = graphClient || { sendCloudMessage, uploadWhatsappMedia, downloadWhatsappMedia };
  }

  credentialsFromClient(client) {
    const phoneNumberId = String(client?.META_PHONE_NUMBER_ID || '').trim();
    const token = decryptMetaAccessToken(client?.META_ACCESS_TOKEN);
    if (!phoneNumberId || !token) {
      throw new Error('El bot no tiene credenciales de Meta configuradas');
    }
    return { phoneNumberId, token };
  }

  async markRead(messageId, client) {
    const { phoneNumberId, token } = this.credentialsFromClient(client);
    const payload = {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: String(messageId || '')
    };
    return this.graphClient.sendCloudMessage({ phoneNumberId, token, payload });
  }

  async showTyping(messageId, client) {
    const { phoneNumberId, token } = this.credentialsFromClient(client);
    const payload = {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: String(messageId || ''),
      typing_indicator: { type: 'text' }
    };
    return this.graphClient.sendCloudMessage({ phoneNumberId, token, payload });
  }

  async sendMessage(to, message, client) {
    const { phoneNumberId, token } = this.credentialsFromClient(client);
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: toWhatsappTo(to),
      type: 'text',
      text: { preview_url: false, body: String(message || '') }
    };
    return this.graphClient.sendCloudMessage({ phoneNumberId, token, payload });
  }

  async sendDocument(to, { filename, document, caption = '' } = {}, client) {
    const { phoneNumberId, token } = this.credentialsFromClient(client);
    const mediaId = await this.graphClient.uploadWhatsappMedia({
      phoneNumberId,
      token,
      filename: filename || 'documento.pdf',
      document
    });
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: toWhatsappTo(to),
      type: 'document',
      document: {
        id: mediaId,
        filename: filename || 'documento.pdf',
        caption: caption || undefined
      }
    };
    return this.graphClient.sendCloudMessage({ phoneNumberId, token, payload });
  }

  async downloadMedia(mediaId, client) {
    const { token } = this.credentialsFromClient(client);
    return this.graphClient.downloadWhatsappMedia({ mediaId, token });
  }
}

module.exports = MetaWhatsappManager;
