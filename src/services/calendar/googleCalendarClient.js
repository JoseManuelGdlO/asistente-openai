const axios = require('axios');

const SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events'
];

class GoogleCalendarError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = 'GoogleCalendarError';
    this.code = code;
    this.status = status || 0;
  }
}

function errorMessage(data) {
  if (!data) return '';
  if (typeof data.error_description === 'string') return data.error_description;
  if (typeof data.error === 'string') return data.error;
  if (data.error && typeof data.error.message === 'string') return data.error.message;
  return '';
}

function errorReason(data) {
  if (!data) return '';
  if (typeof data.error === 'string') return data.error;
  if (typeof data.error?.status === 'string') return data.error.status;
  return '';
}

function mapAxiosError(error) {
  const status = error.response?.status || 0;
  const reason = errorReason(error.response?.data);
  const message = errorMessage(error.response?.data) || error.message || 'Error de Google Calendar';
  if (reason === 'invalid_grant' || status === 401) {
    return new GoogleCalendarError('La autorización de Google venció o fue revocada.', 'revoked', status);
  }
  if (status === 403) {
    return new GoogleCalendarError('Google rechazó el acceso al calendario.', 'denied', status);
  }
  return new GoogleCalendarError(message, 'temporary', status);
}

class GoogleCalendarClient {
  constructor(env = process.env) {
    this.clientId = env.GOOGLE_CALENDAR_CLIENT_ID || '';
    this.clientSecret = env.GOOGLE_CALENDAR_CLIENT_SECRET || '';
  }

  configured() {
    return Boolean(this.clientId && this.clientSecret);
  }

  authorizationUrl({ redirectUri, state }) {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async exchangeCode(code, redirectUri) {
    try {
      const body = new URLSearchParams({
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      });
      const res = await axios.post('https://oauth2.googleapis.com/token', body.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15000
      });
      return res.data;
    } catch (error) {
      throw mapAxiosError(error);
    }
  }

  async refresh(refreshToken) {
    try {
      const body = new URLSearchParams({
        refresh_token: refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'refresh_token'
      });
      const res = await axios.post('https://oauth2.googleapis.com/token', body.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15000
      });
      return res.data;
    } catch (error) {
      throw mapAxiosError(error);
    }
  }

  async userEmail(token) {
    try {
      const res = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15000
      });
      return res.data?.email || '';
    } catch (error) {
      throw mapAxiosError(error);
    }
  }

  async listCalendars(token) {
    try {
      const res = await axios.get('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
        headers: { Authorization: `Bearer ${token}` },
        params: { minAccessRole: 'writer' },
        timeout: 15000
      });
      return (res.data?.items || []).map((item) => ({
        id: item.id,
        summary: item.summary || item.id,
        primary: Boolean(item.primary),
        timeZone: item.timeZone || ''
      }));
    } catch (error) {
      throw mapAxiosError(error);
    }
  }

  async freeBusy(token, { calendarId, timeMin, timeMax, timeZone }) {
    try {
      const res = await axios.post('https://www.googleapis.com/calendar/v3/freeBusy', {
        timeMin,
        timeMax,
        timeZone,
        items: [{ id: calendarId }]
      }, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15000
      });
      const calendar = res.data?.calendars?.[calendarId];
      if (calendar?.errors?.length) {
        throw new GoogleCalendarError(calendar.errors[0].reason || 'No se pudo consultar disponibilidad', 'temporary');
      }
      return (calendar?.busy || []).map((item) => ({ start: item.start, end: item.end }));
    } catch (error) {
      if (error instanceof GoogleCalendarError) throw error;
      throw mapAxiosError(error);
    }
  }

  async createEvent(token, calendarId, event) {
    try {
      const res = await axios.post(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
        event,
        { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
      );
      return res.data;
    } catch (error) {
      throw mapAxiosError(error);
    }
  }

  async updateEvent(token, calendarId, eventId, event) {
    try {
      const res = await axios.patch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
        event,
        { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
      );
      return res.data;
    } catch (error) {
      throw mapAxiosError(error);
    }
  }

  async deleteEvent(token, calendarId, eventId) {
    try {
      await axios.delete(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
        { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
      );
    } catch (error) {
      if (error.response?.status === 404 || error.response?.status === 410) return;
      throw mapAxiosError(error);
    }
  }
}

module.exports = {
  GoogleCalendarClient,
  GoogleCalendarError,
  SCOPES
};
