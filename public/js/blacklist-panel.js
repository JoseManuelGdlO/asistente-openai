(function () {
  function mount(container, options) {
    const { clientId, canEdit, api, escapeHtml, onError } = options;
    let phones = null;
    let busy = false;
    let draft = '';

    function flash(message, kind) {
      const el = document.getElementById('form-flash');
      if (!el) return;
      el.hidden = false;
      el.className = `flash flash-${kind === 'ok' ? 'ok' : 'err'}`;
      el.textContent = message;
    }

    function fail(err) {
      if (onError && onError(err)) return;
      flash(err.message || 'No se pudo actualizar la lista de bloqueados', 'err');
    }

    function render() {
      if (!phones) {
        container.innerHTML = '<section class="card blacklist-card"><p class="muted">Cargando números bloqueados…</p></section>';
        return;
      }

      const rows = phones.length
        ? phones.map((item) => `
            <li class="blacklist-row">
              <span class="blacklist-phone">${escapeHtml(item.phone)}</span>
              <button type="button" class="btn-sm btn-secondary" data-remove="${escapeHtml(item.phone)}" ${canEdit && !busy ? '' : 'disabled'}>Quitar</button>
            </li>
          `).join('')
        : '<li class="muted">No hay números bloqueados</li>';

      container.innerHTML = `
        <section class="card blacklist-card stack" aria-labelledby="blacklist-heading">
          <div>
            <h2 id="blacklist-heading">Números bloqueados</h2>
            <p class="muted">El bot no responde a estos números (ni a comandos).</p>
          </div>
          <form id="blacklist-add-form" class="blacklist-add">
            <label class="sr-only" for="blacklist-phone">Número</label>
            <input id="blacklist-phone" type="tel" inputmode="numeric" autocomplete="tel" placeholder="521234567890" value="${escapeHtml(draft)}" ${canEdit && !busy ? '' : 'disabled'}>
            <button type="submit" ${canEdit && !busy ? '' : 'disabled'}>Agregar</button>
          </form>
          <ul class="blacklist-list">${rows}</ul>
        </section>
      `;

      bind();
    }

    function bind() {
      const form = container.querySelector('#blacklist-add-form');
      const input = container.querySelector('#blacklist-phone');
      input?.addEventListener('input', () => {
        draft = input.value;
      });
      form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!canEdit || busy) return;
        const phone = String(input?.value || '').trim();
        if (!phone) {
          flash('Indica un número de teléfono', 'err');
          return;
        }
        busy = true;
        render();
        try {
          const res = await api(`/clients/${encodeURIComponent(clientId)}/blacklist`, {
            method: 'POST',
            body: { phone }
          });
          phones = Array.isArray(res.phones) ? res.phones : phones;
          draft = '';
          busy = false;
          render();
          if (res.added === false) {
            flash(res.message || 'El número ya estaba en la lista', 'ok');
          } else {
            flash('Número agregado a la lista', 'ok');
          }
        } catch (err) {
          busy = false;
          render();
          fail(err);
        }
      });

      container.querySelectorAll('[data-remove]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!canEdit || busy) return;
          const phone = btn.getAttribute('data-remove') || '';
          if (!phone) return;
          if (!window.confirm(`¿Quitar ${phone} de la lista de bloqueados?`)) return;
          busy = true;
          render();
          try {
            const res = await api(
              `/clients/${encodeURIComponent(clientId)}/blacklist/${encodeURIComponent(phone)}`,
              { method: 'DELETE' }
            );
            phones = Array.isArray(res.phones) ? res.phones : phones.filter((item) => item.phone !== phone);
            busy = false;
            render();
            flash(res.removed ? 'Número quitado de la lista' : 'El número no estaba en la lista', 'ok');
          } catch (err) {
            busy = false;
            render();
            fail(err);
          }
        });
      });
    }

    container.innerHTML = '<section class="card blacklist-card"><p class="muted">Cargando números bloqueados…</p></section>';
    api(`/clients/${encodeURIComponent(clientId)}/blacklist`)
      .then((res) => {
        phones = Array.isArray(res.phones) ? res.phones : [];
        render();
      })
      .catch((err) => {
        container.innerHTML = `<section class="card blacklist-card"><p class="error">${escapeHtml(err.message || 'No se pudo cargar la lista de bloqueados')}</p></section>`;
        fail(err);
      });
  }

  window.BlacklistPanel = { mount };
})();
