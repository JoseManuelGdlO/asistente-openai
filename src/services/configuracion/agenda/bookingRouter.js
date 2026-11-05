/**
 * Enruta tools de agenda al motor v1 (Calendar) o v2 (Agenda) según agendaEngine del assistant.
 */
class BookingRouter {
  constructor({ v1, v2, resolveEngine }) {
    this.v1 = v1;
    this.v2 = v2;
    this.resolveEngine = resolveEngine;
  }

  async serviceFor(clientId) {
    const engine = typeof this.resolveEngine === 'function'
      ? await this.resolveEngine(clientId)
      : 'v1';
    if (engine === 'v2' && this.v2) return this.v2;
    return this.v1;
  }

  isCalendarTool(name) {
    if (this.v2 && this.v2.isCalendarTool(name)) return true;
    if (this.v1 && this.v1.isCalendarTool(name)) return true;
    return false;
  }

  toolDefinitions() {
    if (this.v2) return this.v2.toolDefinitions();
    return this.v1 ? this.v1.toolDefinitions() : [];
  }

  mergeTools(storedTools, calendarTools) {
    const svc = this.v2 || this.v1;
    return svc ? svc.mergeTools(storedTools, calendarTools) : (storedTools || []);
  }

  buildInstructions(runtime) {
    const svc = this.v2 || this.v1;
    return svc ? svc.buildInstructions(runtime) : '';
  }

  async loadRuntime(clientId) {
    const svc = await this.serviceFor(clientId);
    if (!svc) return null;
    return svc.loadRuntime(clientId);
  }

  async execute(name, args, context = {}) {
    const svc = await this.serviceFor(context.clientId);
    if (!svc) {
      return { success: false, error: 'Agenda no disponible.', instruction: 'No confirmes la cita.' };
    }
    return svc.execute(name, args, context);
  }

  async publicSummary(clientId) {
    const svc = await this.serviceFor(clientId);
    if (!svc?.publicSummary) return null;
    return svc.publicSummary(clientId);
  }

  async processSyncQueue(options) {
    if (!this.v2?.processSyncQueue) return [];
    return this.v2.processSyncQueue(options);
  }
}

module.exports = { BookingRouter };
