const { httpError } = require('../utils/httpError');
const { encryptCredentialsPayload, decryptMetaAccessToken } = require('../utils/credentialsCrypto');
const { publicMetaSignupConfig } = require('./metaConfig');
const {
  assertInviteUsable,
  createInviteToken,
  inviteFields,
  clearMetaCredentialFields,
  normalizeAssistantPhone
} = require('./metaInviteService');
const graph = require('./metaGraphClient');

function pickPhoneFromList(phones, preferredId) {
  if (!phones.length) return null;
  if (preferredId) {
    const match = phones.find((row) => String(row.id) === String(preferredId));
    if (match) return match;
  }
  return phones[0];
}

async function completeEmbeddedSignup({
  firebaseService,
  commandManager,
  token,
  code,
  wabaId,
  phoneNumberId,
  businessId,
  event,
  graphClient = graph
} = {}) {
  const config = publicMetaSignupConfig();
  if (!config.configured) {
    throw httpError(503, 'Embedded Signup no está configurado en el servidor.');
  }
  const exchangeCode = String(code || '').trim();
  if (!exchangeCode) throw httpError(400, 'Falta el código de Embedded Signup.');
  const inviteToken = String(token || '').trim();
  if (!inviteToken) throw httpError(400, 'Falta el token de vinculación.');

  const client = await firebaseService.getClientByInviteToken(inviteToken);
  assertInviteUsable(client);

  const coexistenceByEvent = String(event || '').toUpperCase() === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING';
  const { accessToken } = await graphClient.exchangeEmbeddedSignupCode(exchangeCode);

  try {
    await graphClient.inspectGraphToken(accessToken);
  } catch (error) {
    console.warn('embedded signup: no se pudo inspeccionar el token', error.message);
  }

  const resolvedWabaId = String(wabaId || '').trim();
  if (!resolvedWabaId) {
    throw httpError(400, 'Meta no devolvió el WABA ID. Completa de nuevo el flujo.');
  }

  await graphClient.subscribeWabaApp(resolvedWabaId, accessToken);
  await graphClient.ensurePlatformCanManageWaba({
    wabaId: resolvedWabaId,
    plannerAccessToken: accessToken
  });

  const phones = await graphClient.listWabaPhoneNumbers(resolvedWabaId, accessToken);
  let phone = pickPhoneFromList(phones, phoneNumberId);
  if (!phone && phoneNumberId) {
    phone = await graphClient.getPhoneNumberDetails(phoneNumberId, accessToken);
  }
  if (!phone?.id) {
    throw httpError(400, 'No se encontró un número de WhatsApp en la cuenta conectada.');
  }

  let details = phone;
  try {
    details = await graphClient.getPhoneNumberDetails(phone.id, accessToken);
  } catch (error) {
    console.warn('embedded signup: no se pudieron leer detalles del número', error.message);
  }

  const coexistenceEnabled =
    coexistenceByEvent || (details.is_on_biz_app === true && details.platform_type === 'CLOUD_API');
  const displayPhoneNumber = String(details.display_phone_number || phone.display_phone_number || '').trim() || null;
  const resolvedPhoneNumberId = String(phone.id);

  const owner = await firebaseService.getClientByMetaPhoneNumberId(resolvedPhoneNumberId);
  if (owner && owner.id !== client.id) {
    throw httpError(409, 'Ese número de WhatsApp ya está vinculado a otro bot.');
  }

  if (coexistenceEnabled) {
    try {
      await graphClient.initiateCoexistenceSync({
        phoneNumberId: resolvedPhoneNumberId,
        token: accessToken,
        syncType: 'smb_app_state_sync'
      });
    } catch (error) {
      console.warn('embedded signup: sync de coexistence falló', error.message);
    }
  }

  const updated = await firebaseService.updateClient(client.id, {
    META_WABA_ID: resolvedWabaId,
    META_PHONE_NUMBER_ID: resolvedPhoneNumberId,
    META_BUSINESS_ID: businessId ? String(businessId) : null,
    META_DISPLAY_PHONE: displayPhoneNumber,
    META_ACCESS_TOKEN: encryptCredentialsPayload({ accessToken }),
    META_COEXISTENCE_ENABLED: coexistenceEnabled,
    assistantPhone: normalizeAssistantPhone(displayPhoneNumber) || client.assistantPhone || '',
    META_INVITE_USED_AT: new Date().toISOString()
  });

  if (commandManager?.reloadClients) {
    await commandManager.reloadClients();
  }

  return {
    client: updated,
    displayPhoneNumber,
    coexistenceEnabled,
    phoneNumberId: resolvedPhoneNumberId,
    wabaId: resolvedWabaId
  };
}

async function disconnectMetaWhatsapp({
  firebaseService,
  commandManager,
  clientId,
  graphClient = graph
} = {}) {
  const client = await firebaseService.getClientById(clientId);
  if (!client) throw httpError(404, 'Cliente no encontrado');
  if (!client.META_PHONE_NUMBER_ID && !client.META_WABA_ID) {
    throw httpError(404, 'No hay una conexión de Meta para desconectar.');
  }

  const token = decryptMetaAccessToken(client.META_ACCESS_TOKEN);
  if (token && client.META_WABA_ID) {
    try {
      await graphClient.unsubscribeWabaApp(client.META_WABA_ID, token);
    } catch (error) {
      console.warn('disconnect: no se pudo desuscribir el WABA', error.message);
    }
  }

  const invite = createInviteToken();
  const updated = await firebaseService.updateClient(clientId, {
    ...clearMetaCredentialFields(),
    ...inviteFields(invite)
  });

  if (commandManager?.reloadClients) {
    await commandManager.reloadClients();
  }

  return { client: updated, invite };
}

async function regenerateInvite({ firebaseService, clientId } = {}) {
  const client = await firebaseService.getClientById(clientId);
  if (!client) throw httpError(404, 'Cliente no encontrado');
  if (client.META_PHONE_NUMBER_ID) {
    throw httpError(409, 'Este bot ya tiene WhatsApp vinculado. Desconéctalo para generar un link nuevo.');
  }
  const invite = createInviteToken();
  const updated = await firebaseService.updateClient(clientId, inviteFields(invite));
  return { client: updated, invite };
}

module.exports = {
  pickPhoneFromList,
  completeEmbeddedSignup,
  disconnectMetaWhatsapp,
  regenerateInvite
};
