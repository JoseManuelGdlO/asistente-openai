(function () {
  function mount(container, options) {
    const { onOpenAgenda, onCloseAgenda, autoOpen = false } = options || {};
    if (!container) return;

    container.innerHTML = `
      <div class="card stack configuracion-hub">
        <h2>Configuración</h2>
        <p class="muted">Ajustes del bot. La primera opción es la agenda de citas.</p>
        <div class="config-list">
          <button type="button" class="btn-secondary config-item" id="config-open-agenda" aria-expanded="false">Agendar citas</button>
        </div>
        <div id="config-agenda-slot"></div>
      </div>
    `;

    const button = container.querySelector('#config-open-agenda');
    const slot = container.querySelector('#config-agenda-slot');
    let open = false;

    function toggle() {
      open = !open;
      button.setAttribute('aria-expanded', String(open));
      if (!open) {
        if (typeof onCloseAgenda === 'function') onCloseAgenda();
        slot.innerHTML = '';
        return;
      }
      if (typeof onOpenAgenda === 'function') onOpenAgenda(slot);
    }

    button.addEventListener('click', toggle);
    if (autoOpen) toggle();
  }

  window.ConfiguracionHub = { mount };
})();
