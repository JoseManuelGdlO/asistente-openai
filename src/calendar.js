const { google } = require('googleapis');
const fs = require('fs').promises;
const { DateTime } = require('luxon');

class GoogleCalendarService {
  constructor(credentialsPath = 'credentials.json', tokenPath = 'token.json') {
    this.credentialsPath = credentialsPath;
    this.tokenPath = tokenPath;
    this.calendar = null;
  }

  async init() {
    const credentials = JSON.parse(await fs.readFile(this.credentialsPath, 'utf8'));
    const { client_secret, client_id, redirect_uris } = credentials.installed;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
    const token = JSON.parse(await fs.readFile(this.tokenPath, 'utf8'));
    oAuth2Client.setCredentials(token);
    this.calendar = google.calendar({ version: 'v3', auth: oAuth2Client });
  }

  async consultarDisponibilidad(fecha_inicio, fecha_fin) {
    try {
        if (!this.calendar) await this.init();
    
        // Validar y corregir fechas
        const zona = 'America/Mexico_City'; // o la zona que uses
        const hoy = DateTime.now().setZone(zona).startOf('day').set({ hour: 8 });
        let inicio = DateTime.fromISO(fecha_inicio, { zone: zona });
        let fin = DateTime.fromISO(fecha_fin, { zone: zona });
    
        if (inicio < hoy) {
          inicio = hoy;
          fin = hoy.plus({ days: 3 }).set({ hour: 19 }); // 3 días después, 7pm
        }
    
        const res = await this.calendar.events.list({
          calendarId: 'primary',
          timeMin: inicio.toISO(),
          timeMax: fin.toISO(),
          singleEvents: true,
          orderBy: 'startTime'
        });
    
        if (res.data.items.length === 0) {
          return { disponible: true, mensaje: "No hay eventos en ese rango de fechas." };
        } else {
          return { disponible: false, mensaje: "Ya tienes eventos en ese rango.", eventos: res.data.items };
        }
      } catch (error) {
        return { error: error.message };
      }
  }

  async crearEvento({ fecha_inicio, fecha_fin, titulo, descripcion }) {
    try {
      if (!this.calendar) await this.init();
      const event = {
        summary: titulo || "Evento creado por el asistente",
        description: descripcion || "",
        start: { dateTime: fecha_inicio },
        end: { dateTime: fecha_fin }
      };
      const res = await this.calendar.events.insert({
        calendarId: 'primary',
        resource: event
      });
      return { exito: true, evento: res.data };
    } catch (error) {
      return { error: error.message };
    }
  }
}

module.exports = GoogleCalendarService;