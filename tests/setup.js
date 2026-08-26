process.env.NODE_ENV = 'test';
process.env.ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN || 'test-admin-token';
process.env.ULTRAMSG_WEBHOOK_TOKEN = process.env.ULTRAMSG_WEBHOOK_TOKEN || 'test-webhook-token';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test-openai-key';
process.env.OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
process.env.FIREBASE_CREDENTIALS = process.env.FIREBASE_CREDENTIALS || JSON.stringify({
  type: 'service_account',
  project_id: 'test-project',
  private_key_id: 'test',
  private_key: '-----BEGIN PRIVATE KEY-----\nMIIBOgIBAAJBAK8=\n-----END PRIVATE KEY-----\n',
  client_email: 'test@test-project.iam.gserviceaccount.com',
  client_id: '123',
  auth_uri: 'https://accounts.google.com/o/oauth2/auth',
  token_uri: 'https://oauth2.googleapis.com/token'
});
process.env.MESSAGE_DEBOUNCE_MS = process.env.MESSAGE_DEBOUNCE_MS || '0';
process.env.MESSAGE_DEBOUNCE_MAX_MS = process.env.MESSAGE_DEBOUNCE_MAX_MS || '8000';
