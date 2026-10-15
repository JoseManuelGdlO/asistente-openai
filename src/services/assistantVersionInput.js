function versionInputError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseAssistantVersionBody(body) {
  const data = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const parsed = {};

  if (data.label === undefined) {
    parsed.label = '';
  } else if (typeof data.label !== 'string') {
    throw versionInputError('label debe ser texto', 'INVALID_LABEL');
  } else {
    const label = data.label.trim();
    if (label.length > 120) {
      throw versionInputError('La nota no puede pasar de 120 caracteres', 'LABEL_TOO_LONG');
    }
    parsed.label = label;
  }

  if (data.prompt !== undefined) {
    if (typeof data.prompt !== 'string') {
      throw versionInputError('prompt debe ser texto', 'INVALID_PROMPT');
    }
    parsed.prompt = data.prompt;
  }

  if (data.tools !== undefined) {
    if (!Array.isArray(data.tools)) {
      throw versionInputError('Tools debe ser un array', 'INVALID_TOOLS');
    }
    parsed.tools = data.tools;
  }

  if (data.config !== undefined) {
    if (!isPlainObject(data.config)) {
      throw versionInputError('config debe ser un objeto', 'INVALID_CONFIG');
    }
    parsed.config = data.config;
  }

  if (data.responseSchema !== undefined) {
    if (!isPlainObject(data.responseSchema)) {
      throw versionInputError('responseSchema debe ser un objeto', 'INVALID_SCHEMA');
    }
    parsed.responseSchema = data.responseSchema;
  }

  return parsed;
}

function promptExcerpt(prompt) {
  return String(prompt || '').replace(/\r?\n/g, ' ').trim().slice(0, 160);
}

module.exports = {
  parseAssistantVersionBody,
  promptExcerpt
};
