(function () {
  const root = document.getElementById('vincular-root');
  const FB_ORIGINS = new Set(['https://www.facebook.com', 'https://web.facebook.com']);

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function tokenFromPath() {
    const parts = window.location.pathname.split('/').filter(Boolean);
    const idx = parts.indexOf('vincular');
    return idx >= 0 ? decodeURIComponent(parts[idx + 1] || '') : '';
  }

  function parseEmbeddedSignupMessage(data) {
    let parsed = data;
    if (typeof data === 'string') {
      try {
        parsed = JSON.parse(data);
      } catch {
        return null;
      }
    }
    if (!parsed || typeof parsed !== 'object' || parsed.type !== 'WA_EMBEDDED_SIGNUP') return null;
    const info = parsed.data && typeof parsed.data === 'object' ? parsed.data : {};
    const asId = (value) => (typeof value === 'string' || typeof value === 'number' ? String(value) : null);
    return {
      event: parsed.event ? String(parsed.event) : null,
      wabaId: asId(info.waba_id),
      phoneNumberId: asId(info.phone_number_id),
      businessId: asId(info.business_id)
    };
  }

  function loadFacebookSdk(appId, version) {
    return new Promise((resolve, reject) => {
      if (window.FB) {
        window.FB.init({ appId, cookie: true, xfbml: false, version, autoLogAppEvents: true });
        resolve();
        return;
      }
      window.fbAsyncInit = () => {
        window.FB.init({ appId, cookie: true, xfbml: false, version, autoLogAppEvents: true });
        resolve();
      };
      if (document.getElementById('facebook-jssdk')) return;
      const script = document.createElement('script');
      script.id = 'facebook-jssdk';
      script.async = true;
      script.defer = true;
      script.crossOrigin = 'anonymous';
      script.src = 'https://connect.facebook.net/es_LA/sdk.js';
      script.onerror = () => reject(new Error('No se pudo cargar el SDK de Facebook.'));
      document.body.appendChild(script);
    });
  }

  function launchEmbeddedSignup(opts) {
    return new Promise((resolve, reject) => {
      if (!window.FB) {
        reject(new Error('El SDK de Facebook no está listo. Recarga la página.'));
        return;
      }
      let session = null;
      const onMessage = (event) => {
        if (!FB_ORIGINS.has(event.origin)) return;
        const parsed = parseEmbeddedSignupMessage(event.data);
        if (parsed) session = parsed;
      };
      window.addEventListener('message', onMessage);
      window.FB.login(
        (response) => {
          window.removeEventListener('message', onMessage);
          const code = String(response?.authResponse?.code || '').trim();
          if (!code) {
            reject(new Error('El flujo de WhatsApp se canceló o no devolvió un código.'));
            return;
          }
          resolve({ code, session });
        },
        {
          config_id: opts.configId,
          response_type: 'code',
          override_default_response_type: true,
          extras: {
            setup: {},
            featureType: opts.featureType,
            sessionInfoVersion: opts.sessionInfoVersion || '3'
          }
        }
      );
    });
  }

  function renderError(message) {
    root.innerHTML = `
      <h1>No se puede vincular</h1>
      <p class="error">${escapeHtml(message)}</p>
      <p class="muted">Si el link venció, pide uno nuevo a quien administra el bot.</p>
    `;
  }

  function renderSuccess(data) {
    root.innerHTML = `
      <h1>WhatsApp vinculado</h1>
      <div class="card vincular-card stack">
        <p>El número <strong>${escapeHtml(data.displayPhoneNumber || 'conectado')}</strong> ya puede usar el chatbot.</p>
        <p class="muted">${data.coexistenceEnabled
          ? 'Coexistencia activa: puedes seguir usando WhatsApp Business en el teléfono y el bot por Cloud API.'
          : 'La cuenta quedó conectada a la Cloud API.'}</p>
      </div>
    `;
  }

  async function start() {
    const token = tokenFromPath();
    if (!token) {
      renderError('Falta el token del link.');
      return;
    }

    let invite;
    try {
      const res = await fetch(`/public/meta/invite/${encodeURIComponent(token)}`);
      invite = await res.json();
      if (!res.ok) throw new Error(invite.error || 'Link inválido');
    } catch (error) {
      renderError(error.message);
      return;
    }

    if (!invite.configured || !invite.config?.appId || !invite.config?.configId) {
      root.innerHTML = `
        <h1>Falta configurar Meta</h1>
        <p>El link es válido, pero el servidor no tiene Embedded Signup. Quien administra el panel debe poner en el <code>.env</code> y reiniciar:</p>
        <ul class="legal-body">
          <li><code>META_APP_ID</code></li>
          <li><code>META_APP_SECRET</code></li>
          <li><code>META_EMBEDDED_SIGNUP_CONFIG_ID</code></li>
          <li><code>META_WEBHOOK_VERIFY_TOKEN</code></li>
        </ul>
        <p class="muted">Son las mismas credenciales de la app de Meta / Embedded Signup que ya usas en el otro proyecto. El dueño del WhatsApp no puede completar la vinculación hasta que eso esté en el servidor.</p>
      `;
      return;
    }

    root.innerHTML = `
      <h1>Vincular WhatsApp</h1>
      <p class="muted">Vas a conectar el número del bot <strong>${escapeHtml(invite.botName)}</strong>.</p>
      <form id="vincular-form" class="card vincular-card stack">
        <p>Usa la cuenta de Facebook que administra ese WhatsApp Business. El mismo número puede seguir usándose en la app de WhatsApp Business.</p>
        <label class="check">
          <input type="checkbox" id="accept-legal" required>
          <span>Acepto los <a href="/terminos" target="_blank" rel="noopener">Términos</a> y el <a href="/privacidad" target="_blank" rel="noopener">Aviso de Privacidad</a>.</span>
        </label>
        <p id="vincular-error" class="error" hidden></p>
        <div class="actions">
          <button type="submit" id="connect-btn">Conectar WhatsApp</button>
        </div>
      </form>
    `;

    const form = document.getElementById('vincular-form');
    const errorEl = document.getElementById('vincular-error');
    const button = document.getElementById('connect-btn');

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      errorEl.hidden = true;
      if (!document.getElementById('accept-legal').checked) {
        errorEl.textContent = 'Debes aceptar los términos y el aviso de privacidad.';
        errorEl.hidden = false;
        return;
      }
      button.disabled = true;
      button.textContent = 'Conectando…';
      try {
        await loadFacebookSdk(invite.config.appId, invite.config.graphVersion);
        const { code, session } = await launchEmbeddedSignup({
          configId: invite.config.configId,
          featureType: invite.config.featureType,
          sessionInfoVersion: invite.config.sessionInfoVersion
        });
        const res = await fetch('/public/meta/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token,
            code,
            wabaId: session?.wabaId || null,
            phoneNumberId: session?.phoneNumberId || null,
            businessId: session?.businessId || null,
            event: session?.event || null
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'No se pudo completar la vinculación');
        renderSuccess(data);
      } catch (error) {
        errorEl.textContent = error.message;
        errorEl.hidden = false;
        button.disabled = false;
        button.textContent = 'Conectar WhatsApp';
      }
    });
  }

  start();
})();
