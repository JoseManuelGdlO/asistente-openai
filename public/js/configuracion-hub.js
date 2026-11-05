(function () {
  function mount(container, options) {
    const {
      clientId,
      canEdit,
      api,
      escapeHtml,
      onOpenAgenda,
      agendaEngine = 'v1'
    } = options;
    if (!container) return;

    container.innerHTML = `
      <div class="card stack configuracion-hub">
        <h2>Configuración</h2>
        <p class="muted">Ajustes del bot. La primera opción es la agenda de citas.</p>
        <div class="config-list">
          <button type="button" class="btn-secondary config-item" id="config-open-agenda">
            Agendar citas
            <span class="hint">${escapeHtml(agendaEngine === 'v2' ? 'Motor v2' : 'Migrar / Calendar')}</span>
          </button>
        </div>
        <div id="config-agenda-slot"></div>
      </div>
    `;

    document.getElementById('config-open-agenda')?.addEventListener('click', () => {
      if (typeof onOpenAgenda === 'function') onOpenAgenda(document.getElementById('config-agenda-slot'));
    });
  }

  window.ConfiguracionHub = { mount };
})();
