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

  async consultarDisponibilidad(fecha_inicio) {
    try {
        if (!this.calendar) await this.init();
    
        // Validar y corregir fechas
        const zona = 'America/Mexico_City';
        const hoy = DateTime.now().setZone(zona).startOf('day');
        // let inicio = DateTime.fromISO(fecha_inicio, { zone: zona });
        let inicio = DateTime.fromISO(fecha_inicio);
        
        if (inicio < hoy) {
          inicio = hoy;
        }

        // Buscar eventos en un rango de 30 días para asegurar encontrar disponibilidad
        const fechaFin = inicio.plus({ days: 30 });
        
        // Obtener eventos existentes
        const res = await this.calendar.events.list({
          calendarId: 'primary',
          timeMin: inicio.toISO(),
          timeMax: fechaFin.toISO(),
          singleEvents: true,
          orderBy: 'startTime',
          maxResults: 100
        });

        // Crear mapa de disponibilidad
        const disponibilidad = new Map();
        let fechaActual = inicio;
        
        while (fechaActual <= fechaFin) {
          if (fechaActual.weekday <= 5) { // Solo días laborables (lunes a viernes)
            const fechaStr = fechaActual.toFormat('yyyy-MM-dd');
            // Inicializar con todos los horarios posibles para ese día
            const horarios = new Map();
            for (let hora = 8; hora <= 19; hora++) {
              const horaStr = `${hora.toString().padStart(2, '0')}:00`;
              const mediaHoraStr = `${hora.toString().padStart(2, '0')}:30`;
              horarios.set(horaStr, 2); // 2 citas disponibles por horario
              horarios.set(mediaHoraStr, 2);
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
            
            // Reducir disponibilidad para cada intervalo de 30 minutos dentro del evento
            while (horaActual < finEvento) {
              const horaStr = horaActual.toFormat('HH:mm');
              if (horarios.has(horaStr)) {
                const disponibilidadActual = horarios.get(horaStr);
                if (disponibilidadActual > 0) {
                  horarios.set(horaStr, disponibilidadActual - 1);
                }
              }
              horaActual = horaActual.plus({ minutes: 30 });
            }
          }
        });

        // Recolectar todos los horarios disponibles
        const todosLosHorarios = [];
        
        for (const [fecha, horarios] of disponibilidad.entries()) {
          const fechaObj = DateTime.fromFormat(fecha, 'yyyy-MM-dd');
          
          for (const [hora, disponibilidad] of horarios.entries()) {
            if (disponibilidad > 0) {
              const fechaHora = fechaObj.set({
                hour: parseInt(hora.split(':')[0]),
                minute: parseInt(hora.split(':')[1])
              });
              
              todosLosHorarios.push({
                fecha: fechaObj.toFormat('dd/MM/yyyy'),
                hora: hora,
                disponibilidad: disponibilidad,
                fechaHora: fechaHora
              });
            }
          }
        }

        // Ordenar por fecha y hora más cercana
        todosLosHorarios.sort((a, b) => a.fechaHora - b.fechaHora);

        // Tomar los 3 horarios más próximos
        const horariosDisponibles = todosLosHorarios.slice(0, 3);

        if (horariosDisponibles.length === 0) {
          return { 
            disponible: false, 
            mensaje: "No hay horarios disponibles en los próximos días. ¿Te gustaría consultar para más adelante?",
            horarios: []
          };
        }

        return { 
          disponible: true, 
          mensaje: "¡Excelente! Aquí están los 3 horarios más próximos disponibles:",
          horarios: horariosDisponibles.map(h => ({
            fecha: h.fecha,
            hora: h.hora,
            disponibilidad: h.disponibilidad
          }))
        };
    } catch (error) {
        console.error('Error en consultarDisponibilidad:', error);
        return { error: error.message };
    }
  }

  async crearEvento({ fecha_inicio, horario, paciente, descripcion, tutor, subSecuente, mensaje, telefono }) {
    try {
      if (!this.calendar) await this.init();

      // Crear fecha y hora de inicio
      const [hora, minutos] = horario.split(':');
      const fechaInicio = DateTime.fromFormat(fecha_inicio, 'yyyy-MM-dd')
        .set({ hour: parseInt(hora), minute: parseInt(minutos) });
      
      // La cita dura 30 minutos
      const fechaFin = fechaInicio.plus({ minutes: 30 });

      // Crear descripción detallada
      const descripcionCompleta = `
          Paciente: ${paciente}
          ${tutor ? `Tutor: ${tutor}` : ''}
          ${subSecuente ? 'Cita Subsecuente' : 'Cita Nueva'}
          ${mensaje ? `Mensaje: ${mensaje}` : ''}
          ${telefono ? `Teléfono: ${telefono}` : ''}
          ${descripcion ? `Notas adicionales: ${descripcion}` : ''}
      `.trim();

      const event = {
        summary: `Cita con ${paciente}`,
        description: descripcionCompleta,
        start: {
          dateTime: fechaInicio.toISO(),
          timeZone: 'America/Mexico_City'
        },
        end: {
          dateTime: fechaFin.toISO(),
          timeZone: 'America/Mexico_City'
        }
      };

      // Verificar disponibilidad antes de crear el evento
      const disponibilidad = await this.consultarDisponibilidad(fecha_inicio);
      if (!disponibilidad.disponible) {
        return { 
          error: true, 
          mensaje: "Lo sentimos, este horario ya no está disponible. Por favor, selecciona otro horario." 
        };
      }

      // Verificar si el horario específico está disponible
      const horarioDisponible = disponibilidad.horarios.find(h => 
        h.fecha === fechaInicio.toFormat('dd/MM/yyyy') && 
        h.hora === horario
      );

      if (!horarioDisponible || horarioDisponible.disponibilidad <= 0) {
        return { 
          error: true, 
          mensaje: "Lo sentimos, este horario ya no está disponible. Por favor, selecciona otro horario." 
        };
      }

      const res = await this.calendar.events.insert({
        calendarId: 'primary',
        resource: event
      });

      return { 
        exito: true, 
        mensaje: "Cita agendada exitosamente",
        evento: res.data 
      };
    } catch (error) {
      console.error('Error al crear evento:', error);
      return { 
        error: true, 
        mensaje: "Hubo un error al agendar la cita. Por favor, intenta nuevamente." 
      };
    }
  }

  async cancelarEvento({ fecha, paciente }) {
    try {
      if (!this.calendar) await this.init();

      // Convertir la fecha al formato correcto
      const fechaObj = DateTime.fromFormat(fecha, 'yyyy-MM-dd');
      const fechaInicio = fechaObj.startOf('day');
      const fechaFin = fechaObj.endOf('day');

      // Buscar eventos en el día especificado
      const res = await this.calendar.events.list({
        calendarId: 'primary',
        timeMin: fechaInicio.toISO(),
        timeMax: fechaFin.toISO(),
        singleEvents: true,
        orderBy: 'startTime',
        q: paciente // Buscar por nombre del paciente
      });

      if (!res.data.items || res.data.items.length === 0) {
        return {
          error: true,
          mensaje: "No se encontró ninguna cita para el paciente en la fecha especificada."
        };
      }

      // Filtrar eventos que coincidan exactamente con el nombre del paciente
      const eventosCoincidentes = res.data.items.filter(evento => 
        evento.summary.toLowerCase().includes(paciente.toLowerCase())
      );

      if (eventosCoincidentes.length === 0) {
        return {
          error: true,
          mensaje: "No se encontró ninguna cita para el paciente en la fecha especificada."
        };
      }

      // Cancelar todos los eventos encontrados
      const resultados = await Promise.all(
        eventosCoincidentes.map(async (evento) => {
          try {
            await this.calendar.events.delete({
              calendarId: 'primary',
              eventId: evento.id
            });
            return {
              id: evento.id,
              exito: true,
              fecha: DateTime.fromISO(evento.start.dateTime).toFormat('dd/MM/yyyy HH:mm')
            };
          } catch (error) {
            return {
              id: evento.id,
              exito: false,
              error: error.message
            };
          }
        })
      );

      const exitosos = resultados.filter(r => r.exito);
      const fallidos = resultados.filter(r => !r.exito);

      if (fallidos.length > 0) {
        return {
          error: true,
          mensaje: "Algunas citas no pudieron ser canceladas.",
          detalles: {
            exitosos,
            fallidos
          }
        };
      }

      return {
        exito: true,
        mensaje: "Cita(s) cancelada(s) exitosamente",
        detalles: exitosos
      };

    } catch (error) {
      console.error('Error al cancelar evento:', error);
      return {
        error: true,
        mensaje: "Hubo un error al cancelar la cita. Por favor, intenta nuevamente."
      };
    }
  }
}

module.exports = GoogleCalendarService;