jest.mock('axios', () => ({
  post: jest.fn()
}));

const axios = require('axios');
const MetaWhatsappManager = require('../../src/managers/metaWhatsappManager');
const UltraMsgManager = require('../../src/managers/ultramsgManager');
const OwnSystemManager = require('../../src/managers/ownSystemManager');

describe('presencia por canal', () => {
  const prevOwnUrl = process.env.OWN_API_BASE_URL;

  beforeEach(() => {
    axios.post.mockResolvedValue({ data: { ok: true } });
  });

  afterEach(() => {
    process.env.OWN_API_BASE_URL = prevOwnUrl;
  });

  it('Meta marca leído y typing con el wamid', async () => {
    const graphClient = { sendCloudMessage: jest.fn().mockResolvedValue({ success: true }) };
    const manager = new MetaWhatsappManager(graphClient);
    const client = { META_PHONE_NUMBER_ID: 'pn-1', META_ACCESS_TOKEN: 'tok-1' };

    await manager.markRead('wamid.1', client);
    await manager.showTyping('wamid.1', client);

    expect(graphClient.sendCloudMessage).toHaveBeenNthCalledWith(1, {
      phoneNumberId: 'pn-1',
      token: 'tok-1',
      payload: {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: 'wamid.1'
      }
    });
    expect(graphClient.sendCloudMessage).toHaveBeenNthCalledWith(2, {
      phoneNumberId: 'pn-1',
      token: 'tok-1',
      payload: {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: 'wamid.1',
        typing_indicator: { type: 'text' }
      }
    });
  });

  it('UltraMsg marca el chat como leído', async () => {
    const manager = new UltraMsgManager({});
    manager.instances.set('inst-1', { token: 'tok', instanceId: 'inst-1', name: 'n' });

    await manager.markChatRead('521555', 'inst-1');

    expect(axios.post).toHaveBeenCalledWith(
      'https://api.ultramsg.com/inst-1/chats/read?token=tok',
      { token: 'tok', chatId: '521555@c.us' },
      expect.objectContaining({ headers: { 'Content-Type': 'application/json' } })
    );
  });

  it('UltraMsg pide typing al chat', async () => {
    const manager = new UltraMsgManager({});
    manager.instances.set('inst-1', { token: 'tok', instanceId: 'inst-1', name: 'n' });

    await manager.showTyping('521555@c.us', 'inst-1');

    expect(axios.post).toHaveBeenCalledWith(
      'https://api.ultramsg.com/inst-1/chats/typing?token=tok',
      { token: 'tok', chatId: '521555@c.us' },
      expect.objectContaining({ headers: { 'Content-Type': 'application/json' } })
    );
  });

  it('el sistema propio marca leído y presencia', async () => {
    process.env.OWN_API_BASE_URL = 'https://own.example';
    const manager = new OwnSystemManager();
    const auth = {
      deviceId: 'dev 1',
      tenantId: 'ten-1',
      apiKey: 'key-1',
      to: '521555@s.whatsapp.net'
    };

    await manager.markRead(auth);
    await manager.setPresence({ ...auth, presence: 'composing' });

    expect(axios.post).toHaveBeenNthCalledWith(
      1,
      'https://own.example/devices/dev%201/chats/read',
      { to: '521555@s.whatsapp.net' },
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-api-key': 'key-1',
          'x-tenant-id': 'ten-1'
        })
      })
    );
    expect(axios.post).toHaveBeenNthCalledWith(
      2,
      'https://own.example/devices/dev%201/presence',
      { to: '521555@s.whatsapp.net', presence: 'composing' },
      expect.any(Object)
    );
  });
});
