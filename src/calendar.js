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
        const zona = 'America/Mexico_City';
        const hoy = DateTime.now().setZone(zona).startOf('day');
        let inicio = DateTime.fromISO(fecha_inicio, { zone: zona });
        let fin = DateTime.fromISO(fecha_fin, { zone: zona });
    
        if (inicio < hoy) {
          inicio = hoy;
          fin = hoy.plus({ days: 14}); // Buscar disponibilidad para el próximo mes
        }

        // Obtener eventos existentes
        const res = await this.calendar.events.list({
          calendarId: 'primary',
          timeMin: inicio.toISO(),
          timeMax: fin.toISO(),
          singleEvents: true,
          orderBy: 'startTime',
          maxResults: 100
        });

        // Crear mapa de disponibilidad
        const disponibilidad = new Map();
        let fechaActual = inicio;
        
        while (fechaActual <= fin) {
          if (fechaActual.weekday <= 5) { // Solo días laborables (lunes a viernes)
            const fechaStr = fechaActual.toFormat('yyyy-MM-dd');
            // Inicializar con todos los horarios posibles para ese día
            const horarios = new Set();
            for (let hora = 8; hora <= 18; hora++) {
              horarios.add(`${hora.toString().padStart(2, '0')}:00`);
              horarios.add(`${hora.toString().padStart(2, '0')}:30`);
            }
            disponibilidad.set(fechaStr, horarios);
          }
          fechaActual = fechaActual.plus({ days: 1 });
        }

        // Marcar horarios ocupados basado en eventos existentes
        res.data.items.forEach(evento => {
          const inicioEvento = DateTime.fromISO(evento.start.dateTime);
          const finEvento = DateTime.fromISO(evento.end.dateTime);
          const fechaStr = inicioEvento.toFormat('yyyy-MM-dd');
          
          if (disponibilidad.has(fechaStr)) {
            const horarios = disponibilidad.get(fechaStr);
            let horaActual = inicioEvento;
            
            // Marcar como ocupados todos los intervalos de 30 minutos dentro del evento
            while (horaActual < finEvento) {
              const horaStr = horaActual.toFormat('HH:mm');
              horarios.delete(horaStr);
              horaActual = horaActual.plus({ minutes: 30 });
            }
          }
        });

        // Formatear disponibilidad y limitar a las próximas 4 fechas disponibles
        const fechasDisponibles = [];
        const diasUnicos = new Set(); // Para asegurar que no se repitan días

        // Primero ordenamos las fechas por proximidad
        const fechasOrdenadas = Array.from(disponibilidad.entries())
          .sort(([fechaA], [fechaB]) => {
            const dtA = DateTime.fromFormat(fechaA, 'yyyy-MM-dd');
            const dtB = DateTime.fromFormat(fechaB, 'yyyy-MM-dd');
            return dtA - dtB;
          });

        // Luego seleccionamos las 4 fechas más cercanas con días diferentes
        for (const [fecha, horarios] of fechasOrdenadas) {
          if (horarios.size > 0) {
            const fechaObj = DateTime.fromFormat(fecha, 'yyyy-MM-dd');
            const diaSemana = fechaObj.weekday;
            
            if (fechasDisponibles.length < 4 && !diasUnicos.has(diaSemana)) {
              diasUnicos.add(diaSemana);
              fechasDisponibles.push({
                fecha: fechaObj.toFormat('dd/MM/yyyy'),
                horarios: Array.from(horarios).sort()
              });
            }
          }
        }

        if (fechasDisponibles.length === 0) {
          return { 
            disponible: false, 
            mensaje: "No hay horarios disponibles en los próximos días. ¿Te gustaría consultar para más adelante?",
            fechas: []
          };
        }

        return { 
          disponible: true, 
          mensaje: "¡Excelente! Tenemos varias fechas y horarios disponibles para tu cita con la doctora Xóchitl. Aquí te muestro algunas opciones:",
          fechas: fechasDisponibles
        };
    } catch (error) {
        console.error('Error en consultarDisponibilidad:', error);
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