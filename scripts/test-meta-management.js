require('dotenv').config();

const VERSION = String(process.env.META_GRAPH_VERSION || 'v22.0').replace(/^\/+|\/+$/g, '');
const TOKEN = String(
  process.env.META_TEST_ACCESS_TOKEN
  || process.env.META_SYSTEM_USER_TOKEN
  || process.env.META_ACCESS_TOKEN
  || ''
).trim();
const WABA_ID = String(process.env.META_WABA_ID || process.env.META_TEST_WABA_ID || '').trim();

async function graph(method, path, query = {}) {
  const url = new URL(`https://graph.facebook.com/${VERSION}/${String(path).replace(/^\/+/, '')}`);
  for (const [key, value] of Object.entries(query)) {
    if (value == null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/json'
    }
  });
  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  return { ok: res.ok, status: res.status, body };
}

function summarize(body) {
  if (body?.error) {
    return `error ${body.error.code || ''} ${body.error.message || ''}`.trim();
  }
  if (Array.isArray(body?.data)) return `${body.data.length} item(s)`;
  if (body?.id) return `id=${body.id}${body.name ? ` name=${body.name}` : ''}`;
  if (body?.success === true) return 'success=true';
  return 'ok';
}

async function main() {
  if (!TOKEN || !WABA_ID) {
    console.error(`Faltan variables.
Necesitas:
  META_WABA_ID            (WhatsApp Business Account ID del panel de Meta)
  META_TEST_ACCESS_TOKEN  (token temporal de WhatsApp → Configuración de la API)

Ejemplo:
  META_WABA_ID=123 META_TEST_ACCESS_TOKEN=EAAG... npm run test-meta-management
`);
    process.exit(1);
  }

  console.log(`Probando whatsapp_business_management`);
  console.log(`Graph: ${VERSION}  WABA: ${WABA_ID}  token: len=${TOKEN.length}`);
  console.log('');

  const calls = [
    {
      name: 'GET /{waba-id}',
      run: () => graph('GET', WABA_ID, {
        fields: 'id,name,account_review_status,message_template_namespace'
      })
    },
    {
      name: 'GET /{waba-id}/phone_numbers',
      run: () => graph('GET', `${WABA_ID}/phone_numbers`, {
        fields: 'id,display_phone_number,verified_name,quality_rating'
      })
    },
    {
      name: 'GET /{waba-id}/subscribed_apps',
      run: () => graph('GET', `${WABA_ID}/subscribed_apps`)
    },
    {
      name: 'GET /{waba-id}/message_templates',
      run: () => graph('GET', `${WABA_ID}/message_templates`, { limit: 5 })
    },
    {
      name: 'GET /{waba-id}/assigned_users',
      run: () => graph('GET', `${WABA_ID}/assigned_users`)
    },
    {
      name: 'POST /{waba-id}/subscribed_apps',
      run: () => graph('POST', `${WABA_ID}/subscribed_apps`)
    }
  ];

  let passed = 0;
  for (const call of calls) {
    try {
      const result = await call.run();
      const mark = result.ok ? 'OK ' : 'FAIL';
      if (result.ok) passed += 1;
      console.log(`${mark}  ${result.status}  ${call.name}  →  ${summarize(result.body)}`);
    } catch (error) {
      console.log(`FAIL  —    ${call.name}  →  ${error.message}`);
    }
  }

  console.log('');
  console.log(`${passed}/${calls.length} llamadas correctas.`);
  if (passed === 0) {
    console.log('Ninguna pasó. Revisa que el token sea de ESTA app y que el WABA esté en el mismo Business.');
    process.exit(1);
  }
  console.log('Meta suele tardar unos minutos en marcar “llamadas de prueba” en App Review.');
  console.log('Con 1 éxito de GET phone_numbers, subscribed_apps o message_templates ya cuenta el permiso.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
