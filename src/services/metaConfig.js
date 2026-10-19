function publicMetaSignupConfig() {
  const appId = String(process.env.META_APP_ID || '').trim();
  const configId = String(process.env.META_EMBEDDED_SIGNUP_CONFIG_ID || '').trim();
  const graphVersion = String(process.env.META_GRAPH_VERSION || 'v22.0').replace(/^\/+|\/+$/g, '');
  return {
    configured: Boolean(appId && configId && String(process.env.META_APP_SECRET || '').trim()),
    appId,
    configId,
    graphVersion,
    featureType: 'whatsapp_business_app_onboarding',
    sessionInfoVersion: '3'
  };
}

function metaEnv() {
  return {
    appId: String(process.env.META_APP_ID || '').trim(),
    appSecret: String(process.env.META_APP_SECRET || '').trim(),
    configId: String(process.env.META_EMBEDDED_SIGNUP_CONFIG_ID || '').trim(),
    graphVersion: String(process.env.META_GRAPH_VERSION || 'v22.0').replace(/^\/+|\/+$/g, ''),
    webhookVerifyToken: String(process.env.META_WEBHOOK_VERIFY_TOKEN || '').trim(),
    businessId: String(process.env.META_BUSINESS_ID || '').trim(),
    systemUserId: String(process.env.META_SYSTEM_USER_ID || '').trim(),
    accessToken: String(process.env.META_SYSTEM_USER_TOKEN || process.env.META_ACCESS_TOKEN || '').trim()
  };
}

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

module.exports = {
  publicMetaSignupConfig,
  metaEnv,
  digitsOnly
};
