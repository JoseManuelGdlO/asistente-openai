const { completeEmbeddedSignup } = require('../../src/services/metaSignupService');
const { createInviteToken, hashInviteToken } = require('../../src/services/metaInviteService');

function pendingClient() {
  const invite = createInviteToken();
  return {
    invite,
    client: {
      id: 'C1',
      name: 'Bot',
      status: 'active',
      META_INVITE_TOKEN_HASH: invite.hash,
      META_INVITE_EXPIRES_AT: invite.expiresAt
    }
  };
}

describe('metaSignupService', () => {
  it('completa signup, marca coexistencia y dispara smb_app_data', async () => {
    const { invite, client } = pendingClient();
    const graphClient = {
      exchangeEmbeddedSignupCode: jest.fn().mockResolvedValue({ accessToken: 'tok' }),
      inspectGraphToken: jest.fn().mockResolvedValue({ type: 'USER' }),
      subscribeWabaApp: jest.fn().mockResolvedValue({}),
      ensurePlatformCanManageWaba: jest.fn().mockResolvedValue({ skipped: true }),
      listWabaPhoneNumbers: jest.fn().mockResolvedValue([{ id: '555', display_phone_number: '+52 618 111 2222' }]),
      getPhoneNumberDetails: jest.fn().mockResolvedValue({
        id: '555',
        display_phone_number: '+52 618 111 2222',
        is_on_biz_app: true,
        platform_type: 'CLOUD_API'
      }),
      initiateCoexistenceSync: jest.fn().mockResolvedValue({})
    };
    const updateClient = jest.fn(async (_id, patch) => ({ ...client, ...patch }));
    const result = await completeEmbeddedSignup({
      firebaseService: {
        getClientByInviteToken: jest.fn().mockResolvedValue(client),
        getClientByMetaPhoneNumberId: jest.fn().mockResolvedValue(null),
        updateClient
      },
      commandManager: { reloadClients: jest.fn() },
      token: invite.token,
      code: 'oauth-code',
      wabaId: 'waba-1',
      event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
      graphClient
    });

    expect(result.coexistenceEnabled).toBe(true);
    expect(result.phoneNumberId).toBe('555');
    expect(graphClient.initiateCoexistenceSync).toHaveBeenCalledWith({
      phoneNumberId: '555',
      token: 'tok',
      syncType: 'smb_app_state_sync'
    });
    expect(updateClient).toHaveBeenCalled();
    const saved = updateClient.mock.calls[0][1];
    expect(saved.META_WABA_ID).toBe('waba-1');
    expect(saved.assistantPhone).toBe('526181112222');
    expect(saved.META_ACCESS_TOKEN).toContain('"v":1');
  });

  it('rechaza un phone_number_id ya usado por otro bot', async () => {
    const { invite, client } = pendingClient();
    await expect(completeEmbeddedSignup({
      firebaseService: {
        getClientByInviteToken: jest.fn().mockResolvedValue(client),
        getClientByMetaPhoneNumberId: jest.fn().mockResolvedValue({ id: 'OTHER' }),
        updateClient: jest.fn()
      },
      token: invite.token,
      code: 'oauth-code',
      wabaId: 'waba-1',
      graphClient: {
        exchangeEmbeddedSignupCode: jest.fn().mockResolvedValue({ accessToken: 'tok' }),
        inspectGraphToken: jest.fn().mockResolvedValue({}),
        subscribeWabaApp: jest.fn().mockResolvedValue({}),
        ensurePlatformCanManageWaba: jest.fn().mockResolvedValue({}),
        listWabaPhoneNumbers: jest.fn().mockResolvedValue([{ id: '555' }]),
        getPhoneNumberDetails: jest.fn().mockResolvedValue({ id: '555' }),
        initiateCoexistenceSync: jest.fn()
      }
    })).rejects.toMatchObject({ status: 409 });
  });

  it('hash del token coincide con el invite', () => {
    const invite = createInviteToken();
    expect(hashInviteToken(invite.token)).toBe(invite.hash);
  });
});
