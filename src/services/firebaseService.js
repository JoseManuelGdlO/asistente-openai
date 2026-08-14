const admin = require('firebase-admin');
const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);

const DEFAULT_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' }
  },
  required: ['reply'],
  additionalProperties: false
};

// Responses API + strict: required debe incluir todas las keys de properties.
// Campos opcionales se modelan como string|null.
const DEFAULT_ENVIAR_PDF_TOOL = {
  type: 'function',
  name: 'enviar_pdf',
  description:
    'Envía un PDF del consultorio al usuario por WhatsApp. Usa solo documento_id de la lista de documentos disponibles.',
  parameters: {
    type: 'object',
    properties: {
      documento_id: {
        type: 'string',
        description: 'Identificador del PDF'
      },
      caption: {
        type: ['string', 'null'],
        description: 'Texto opcional que acompaña el archivo'
      }
    },
    required: ['documento_id', 'caption'],
    additionalProperties: false
  },
  strict: true
};

class FirebaseService {
  constructor() {
    // Inicializar Firebase Admin SDK
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: `https://${serviceAccount.project_id}.firebaseio.com`
      });
    }
    
    this.db = admin.firestore();
    this.clientsCollection = this.db.collection('clients');
    this.assistantsCollection = this.db.collection('Assistants');
    this.botSessionsCollection = this.db.collection('bot_sessions');
    this.blacklistCollection = this.db.collection('blacklist-phone');
    this.webhookDedupCollection = this.db.collection('webhook_dedup');
  }

  /**
   * Normaliza un número de teléfono (quita @c.us, espacios)
   * @param {string} phone - Número a normalizar
   * @returns {string} - Número normalizado
   */
  _normalizePhone(phone) {
    if (!phone || typeof phone !== 'string') return '';
    return phone.replace('@c.us', '').trim();
  }

  /**
   * Comprueba si un número está en la blacklist de una empresa
   * @param {string} id_empresa - ID del cliente (colección clients)
   * @param {string} phone - Número de teléfono
   * @returns {Promise<boolean>} - True si está bloqueado
   */
  async isPhoneBlacklisted(id_empresa, phone) {
    try {
      const normalized = this._normalizePhone(phone);
      if (!normalized || !id_empresa) return false;
      const snapshot = await this.blacklistCollection
        .where('id_empresa', '==', id_empresa)
        .where('phone', '==', normalized)
        .limit(1)
        .get();
      return !snapshot.empty;
    } catch (error) {
      console.error('❌ Error comprobando blacklist:', error);
      return false;
    }
  }

  /**
   * Obtiene la lista de números bloqueados de una empresa
   * @param {string} id_empresa - ID del cliente
   * @returns {Promise<Array<{id: string, phone: string}>>} - Lista de { id, phone }
   */
  async getBlacklist(id_empresa) {
    try {
      const snapshot = await this.blacklistCollection
        .where('id_empresa', '==', id_empresa)
        .get();
      return snapshot.docs.map(doc => ({ id: doc.id, phone: doc.data().phone }));
    } catch (error) {
      console.error('❌ Error obteniendo blacklist:', error);
      throw error;
    }
  }

  /**
   * Añade un número a la blacklist de una empresa (evita duplicados)
   * @param {string} id_empresa - ID del cliente
   * @param {string} phone - Número a bloquear
   * @returns {Promise<Object>} - Documento creado o existente
   */
  async addToBlacklist(id_empresa, phone) {
    try {
      const normalized = this._normalizePhone(phone);
      if (!normalized || !id_empresa) {
        throw new Error('id_empresa y phone son requeridos');
      }
      const already = await this.isPhoneBlacklisted(id_empresa, normalized);
      if (already) {
        return { added: false, message: 'El número ya estaba en la lista' };
      }
      const docRef = await this.blacklistCollection.add({ id_empresa, phone: normalized });
      console.log('✅ Número añadido a blacklist:', id_empresa, normalized);
      return { added: true, id: docRef.id };
    } catch (error) {
      console.error('❌ Error añadiendo a blacklist:', error);
      throw error;
    }
  }

  /**
   * Quita un número de la blacklist de una empresa
   * @param {string} id_empresa - ID del cliente
   * @param {string} phone - Número a desbloquear
   * @returns {Promise<boolean>} - True si se eliminó al menos un documento
   */
  async removeFromBlacklist(id_empresa, phone) {
    try {
      const normalized = this._normalizePhone(phone);
      if (!normalized || !id_empresa) return false;
      const snapshot = await this.blacklistCollection
        .where('id_empresa', '==', id_empresa)
        .where('phone', '==', normalized)
        .get();
      const batch = this.db.batch();
      snapshot.docs.forEach(doc => batch.delete(doc.ref));
      if (snapshot.empty) return false;
      await batch.commit();
      console.log('✅ Número quitado de blacklist:', id_empresa, normalized);
      return true;
    } catch (error) {
      console.error('❌ Error quitando de blacklist:', error);
      throw error;
    }
  }

  /**
   * Obtiene todos los clientes activos
   * @returns {Promise<Array>} - Lista de clientes
   */
  async getAllClients() {
    try {
      const snapshot = await this.clientsCollection
        .where('status', '==', 'active')
        .get();
      
      const clients = {};
      snapshot.forEach(doc => {
        const clientData = doc.data();
        clients[doc.id] = {
          id: doc.id,
          ...clientData,
          createdAt: clientData.createdAt?.toDate(),
          updatedAt: clientData.updatedAt?.toDate()
        };
      });
      
      console.log('📋 Clientes cargados desde Firebase:', Object.keys(clients));
      return clients;
    } catch (error) {
      console.error('❌ Error cargando clientes desde Firebase:', error);
      throw error;
    }
  }

  /**
   * Obtiene un cliente por ID
   * @param {string} clientId - ID del cliente
   * @returns {Promise<Object|null>} - Cliente o null si no existe
   */
  async getClientById(clientId) {
    try {
      const doc = await this.clientsCollection.doc(clientId).get();
      
      if (doc.exists) {
        const clientData = doc.data();
        return {
          id: doc.id,
          ...clientData,
          createdAt: clientData.createdAt?.toDate(),
          updatedAt: clientData.updatedAt?.toDate()
        };
      }
      
      return null;
    } catch (error) {
      console.error('❌ Error obteniendo cliente:', error);
      throw error;
    }
  }

  /**
   * Obtiene un cliente por número de teléfono del asistente
   * @param {string} assistantPhone - Número de teléfono del asistente
   * @returns {Promise<Object|null>} - Cliente o null si no existe
   */
  async getClientByAssistantPhone(assistantPhone) {
    try {
      const cleanPhone = assistantPhone?.split('@')[0];
      
      const snapshot = await this.clientsCollection
        .where('assistantPhone', '==', cleanPhone)
        .where('status', '==', 'active')
        .limit(1)
        .get();
      
      if (!snapshot.empty) {
        const doc = snapshot.docs[0];
        const clientData = doc.data();
        return {
          id: doc.id,
          ...clientData,
          createdAt: clientData.createdAt?.toDate(),
          updatedAt: clientData.updatedAt?.toDate()
        };
      }
      
      return null;
    } catch (error) {
      console.error('❌ Error obteniendo cliente por teléfono:', error);
      throw error;
    }
  }

  /**
   * Crea un nuevo cliente
   * @param {Object} clientData - Datos del cliente
   * @returns {Promise<Object>} - Cliente creado
   */
  async createClient(clientData) {
    try {
      const client = {
        ...clientData,
        status: 'active',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };
      
      const docRef = await this.clientsCollection.add(client);
      const createdClient = await this.getClientById(docRef.id);
      
      console.log('✅ Cliente creado:', createdClient.id);
      return createdClient;
    } catch (error) {
      console.error('❌ Error creando cliente:', error);
      throw error;
    }
  }

  /**
   * Actualiza un cliente existente
   * @param {string} clientId - ID del cliente
   * @param {Object} updateData - Datos a actualizar
   * @returns {Promise<Object>} - Cliente actualizado
   */
  async updateClient(clientId, updateData) {
    try {
      const existing = await this.getClientById(clientId);
      if (!existing) {
        throw new Error(`Cliente no encontrado: ${clientId}`);
      }

      const update = {
        ...updateData,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };
      
      await this.clientsCollection.doc(clientId).update(update);
      const updatedClient = await this.getClientById(clientId);
      
      console.log('✅ Cliente actualizado:', clientId);
      return updatedClient;
    } catch (error) {
      console.error('❌ Error actualizando cliente:', error);
      throw error;
    }
  }

  /**
   * Elimina un cliente (soft delete)
   * @param {string} clientId - ID del cliente
   * @returns {Promise<boolean>} - True si se eliminó correctamente
   */
  async deleteClient(clientId) {
    try {
      await this.clientsCollection.doc(clientId).update({
        status: 'deleted',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      console.log('✅ Cliente eliminado:', clientId);
      return true;
    } catch (error) {
      console.error('❌ Error eliminando cliente:', error);
      throw error;
    }
  }

  /**
   * Cambia el estado de un bot
   * @param {string} clientId - ID del cliente
   * @param {string} botStatus - Estado del bot ('active' o 'inactive')
   * @returns {Promise<Object>} - Cliente actualizado
   */
  async updateBotStatus(clientId, botStatus) {
    try {
      await this.clientsCollection.doc(clientId).update({
        botStatus: botStatus,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      const updatedClient = await this.getClientById(clientId);
      console.log('✅ Estado del bot actualizado:', clientId, '->', botStatus);
      return updatedClient;
    } catch (error) {
      console.error('❌ Error actualizando estado del bot:', error);
      throw error;
    }
  }

  /**
   * Obtiene estadísticas de clientes
   * @returns {Promise<Object>} - Estadísticas
   */
  async getClientStats() {
    try {
      const activeSnapshot = await this.clientsCollection
        .where('status', '==', 'active')
        .get();
      
      const inactiveSnapshot = await this.clientsCollection
        .where('botStatus', '==', 'inactive')
        .where('status', '==', 'active')
        .get();
      
      return {
        total: activeSnapshot.size,
        active: activeSnapshot.size - inactiveSnapshot.size,
        inactive: inactiveSnapshot.size
      };
    } catch (error) {
      console.error('❌ Error obteniendo estadísticas:', error);
      throw error;
    }
  }

  // ==================== Assistants (1:1 con clients) ====================

  /**
   * Lista todos los Assistants (excluye soft-deleted)
   * @returns {Promise<Array>}
   */
  async getAllAssistants() {
    try {
      const snapshot = await this.assistantsCollection.get();
      const assistants = [];

      snapshot.forEach((doc) => {
        const data = doc.data();
        if (data.status === 'deleted') {
          return;
        }
        assistants.push({
          id: doc.id,
          ...data,
          createdAt: data.createdAt?.toDate?.() || data.createdAt,
          updatedAt: data.updatedAt?.toDate?.() || data.updatedAt
        });
      });

      return assistants;
    } catch (error) {
      console.error('❌ Error listando Assistants:', error);
      throw error;
    }
  }

  /**
   * Obtiene la config del Assistant de un consultorio
   * @param {string} clientId
   * @returns {Promise<Object|null>}
   */
  async getAssistantByClientId(clientId) {
    try {
      const doc = await this.assistantsCollection.doc(clientId).get();
      if (!doc.exists) {
        return null;
      }
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() || data.createdAt,
        updatedAt: data.updatedAt?.toDate?.() || data.updatedAt
      };
    } catch (error) {
      console.error('❌ Error obteniendo Assistant:', error);
      throw error;
    }
  }

  /**
   * Normaliza datos de Assistant con defaults
   * @param {string} clientId
   * @param {Object} assistantData
   * @returns {Object}
   */
  _buildAssistantDoc(clientId, assistantData = {}) {
    return {
      clientId,
      prompt: assistantData.prompt || '',
      tools: Array.isArray(assistantData.tools) ? assistantData.tools : [],
      config: assistantData.config || {},
      responseSchema: assistantData.responseSchema || DEFAULT_RESPONSE_SCHEMA,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
  }

  /**
   * Crea Assistants/{clientId} si falta (idempotente; no sobrescribe).
   * @param {string} clientId
   * @param {Object} [assistantData] - prompt, tools, config, responseSchema
   * @returns {Promise<{created: boolean, assistant: Object}>}
   */
  async ensureAssistantForClient(clientId, assistantData = {}) {
    try {
      const client = await this.getClientById(clientId);
      if (!client) {
        const err = new Error(`Cliente no encontrado: ${clientId}`);
        err.code = 'CLIENT_NOT_FOUND';
        throw err;
      }

      const existing = await this.getAssistantByClientId(clientId);
      if (existing) {
        return { created: false, assistant: existing };
      }

      const assistantRef = this.assistantsCollection.doc(clientId);
      const assistantDoc = this._buildAssistantDoc(clientId, assistantData);
      await assistantRef.set(assistantDoc);

      const assistant = await this.getAssistantByClientId(clientId);
      console.log('✅ Assistant creado para cliente existente:', clientId);
      return { created: true, assistant };
    } catch (error) {
      console.error('❌ Error en ensureAssistantForClient:', error);
      throw error;
    }
  }

  /**
   * Crea client + Assistant en batch atómico (mismo ID)
   * @param {Object} clientData - Datos del consultorio (puede incluir id opcional)
   * @param {Object} assistantData - prompt, tools, config, responseSchema
   * @returns {Promise<{client: Object, assistant: Object}>}
   */
  async createClientWithAssistant(clientData, assistantData = {}) {
    try {
      const { id: requestedId, prompt, tools, config, responseSchema, ...restClient } = clientData;
      const assistantPayload = {
        prompt: assistantData.prompt ?? prompt,
        tools: assistantData.tools ?? tools,
        config: assistantData.config ?? config,
        responseSchema: assistantData.responseSchema ?? responseSchema
      };

      const clientRef = requestedId
        ? this.clientsCollection.doc(requestedId)
        : this.clientsCollection.doc();
      const clientId = clientRef.id;
      const assistantRef = this.assistantsCollection.doc(clientId);

      const existingClient = await clientRef.get();
      if (existingClient.exists) {
        throw new Error(`Ya existe un cliente con id ${clientId}`);
      }

      const clientDoc = {
        ...restClient,
        status: restClient.status || 'active',
        botStatus: restClient.botStatus || 'active',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      const assistantDoc = this._buildAssistantDoc(clientId, assistantPayload);

      const batch = this.db.batch();
      batch.set(clientRef, clientDoc);
      batch.set(assistantRef, assistantDoc);
      await batch.commit();

      const client = await this.getClientById(clientId);
      const assistant = await this.getAssistantByClientId(clientId);
      console.log('✅ Par client+Assistant creado:', clientId);
      return { client, assistant };
    } catch (error) {
      console.error('❌ Error creando par client+Assistant:', error);
      throw error;
    }
  }

  /**
   * Actualiza Assistant; exige que exista el cliente
   * @param {string} clientId
   * @param {Object} data
   * @returns {Promise<Object>}
   */
  async updateAssistant(clientId, data) {
    try {
      const client = await this.getClientById(clientId);
      if (!client) {
        const err = new Error(`Cliente no encontrado: ${clientId}`);
        err.code = 'CLIENT_NOT_FOUND';
        throw err;
      }

      const assistantRef = this.assistantsCollection.doc(clientId);
      const existing = await assistantRef.get();
      if (!existing.exists) {
        const err = new Error(`Assistant no encontrado para cliente: ${clientId}`);
        err.code = 'ASSISTANT_NOT_FOUND';
        throw err;
      }

      const allowed = {};
      if (data.prompt !== undefined) allowed.prompt = data.prompt;
      if (data.tools !== undefined) allowed.tools = data.tools;
      if (data.config !== undefined) allowed.config = data.config;
      if (data.responseSchema !== undefined) allowed.responseSchema = data.responseSchema;
      allowed.updatedAt = admin.firestore.FieldValue.serverTimestamp();

      await assistantRef.update(allowed);
      const updated = await this.getAssistantByClientId(clientId);
      console.log('✅ Assistant actualizado:', clientId);
      return updated;
    } catch (error) {
      console.error('❌ Error actualizando Assistant:', error);
      throw error;
    }
  }

  /**
   * Soft-delete del par client + Assistant
   * @param {string} clientId
   * @returns {Promise<boolean>}
   */
  async deleteClientWithAssistant(clientId) {
    try {
      const clientRef = this.clientsCollection.doc(clientId);
      const assistantRef = this.assistantsCollection.doc(clientId);
      const clientSnap = await clientRef.get();
      if (!clientSnap.exists) {
        throw new Error(`Cliente no encontrado: ${clientId}`);
      }

      const batch = this.db.batch();
      batch.update(clientRef, {
        status: 'deleted',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      const assistantSnap = await assistantRef.get();
      if (assistantSnap.exists) {
        batch.update(assistantRef, {
          status: 'deleted',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }

      await batch.commit();
      console.log('✅ Par client+Assistant eliminado:', clientId);
      return true;
    } catch (error) {
      console.error('❌ Error eliminando par client+Assistant:', error);
      throw error;
    }
  }

  // ==================== bot_sessions ====================

  sessionId(userId, clientCode) {
    return `${userId}_${clientCode}`;
  }

  /**
   * Obtiene una sesión de conversación
   * @param {string} userId
   * @param {string} clientCode
   * @returns {Promise<Object|null>}
   */
  async getBotSession(userId, clientCode) {
    try {
      const id = this.sessionId(userId, clientCode);
      const doc = await this.botSessionsCollection.doc(id).get();
      if (!doc.exists) {
        return null;
      }
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() || data.createdAt,
        updatedAt: data.updatedAt?.toDate?.() || data.updatedAt,
        lockedUntil: data.lockedUntil?.toDate?.() || data.lockedUntil
      };
    } catch (error) {
      console.error('❌ Error obteniendo bot_session:', error);
      throw error;
    }
  }

  /**
   * Crea o obtiene sesión
   * @param {string} userId
   * @param {string} clientCode
   * @returns {Promise<Object>}
   */
  async getOrCreateBotSession(userId, clientCode) {
    const existing = await this.getBotSession(userId, clientCode);
    if (existing) {
      return existing;
    }

    const id = this.sessionId(userId, clientCode);
    const doc = {
      userId,
      clientCode,
      items: [],
      lockedUntil: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    await this.botSessionsCollection.doc(id).set(doc);
    console.log('✅ bot_session creada:', id);
    return this.getBotSession(userId, clientCode);
  }

  /**
   * Guarda items y metadatos de sesión
   * @param {string} userId
   * @param {string} clientCode
   * @param {Object} data
   * @returns {Promise<Object>}
   */
  async saveBotSession(userId, clientCode, data) {
    try {
      const id = this.sessionId(userId, clientCode);
      const update = {
        ...data,
        userId,
        clientCode,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };
      await this.botSessionsCollection.doc(id).set(update, { merge: true });
      return this.getBotSession(userId, clientCode);
    } catch (error) {
      console.error('❌ Error guardando bot_session:', error);
      throw error;
    }
  }

  /**
   * Intenta adquirir lock de sesión
   * @param {string} userId
   * @param {string} clientCode
   * @param {number} lockMs
   * @returns {Promise<boolean>}
   */
  async tryLockBotSession(userId, clientCode, lockMs = 180000) {
    const id = this.sessionId(userId, clientCode);
    const ref = this.botSessionsCollection.doc(id);
    const now = Date.now();
    const lockedUntil = new Date(now + lockMs);

    try {
      await this.db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) {
          tx.set(ref, {
            userId,
            clientCode,
            items: [],
            lockedUntil,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
          return;
        }
        const data = snap.data();
        const currentLock = data.lockedUntil?.toDate?.() || data.lockedUntil;
        if (currentLock && new Date(currentLock).getTime() > now) {
          throw new Error('SESSION_LOCKED');
        }
        tx.update(ref, {
          lockedUntil,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      });
      return true;
    } catch (error) {
      if (error.message === 'SESSION_LOCKED') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Renueva el lock de sesión (heartbeat durante loops de tools)
   * @param {string} userId
   * @param {string} clientCode
   * @param {number} lockMs
   */
  async refreshBotSessionLock(userId, clientCode, lockMs = 180000) {
    const id = this.sessionId(userId, clientCode);
    const lockedUntil = new Date(Date.now() + lockMs);
    await this.botSessionsCollection.doc(id).set(
      {
        lockedUntil,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );
  }

  /**
   * Libera lock de sesión
   * @param {string} userId
   * @param {string} clientCode
   */
  async unlockBotSession(userId, clientCode) {
    const id = this.sessionId(userId, clientCode);
    await this.botSessionsCollection.doc(id).set(
      {
        lockedUntil: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );
  }

  /**
   * Resume una sesión para listados (sin items completos)
   * @param {FirebaseFirestore.QueryDocumentSnapshot|FirebaseFirestore.DocumentSnapshot} doc
   * @returns {Object}
   */
  summarizeBotSession(doc) {
    const data = doc.data() || {};
    const lockedUntil = data.lockedUntil?.toDate?.() || data.lockedUntil || null;
    const lockedUntilMs = lockedUntil ? new Date(lockedUntil).getTime() : 0;
    return {
      id: doc.id,
      userId: data.userId || null,
      clientCode: data.clientCode || null,
      itemsCount: Array.isArray(data.items) ? data.items.length : 0,
      lockedUntil,
      isLocked: Boolean(lockedUntilMs && lockedUntilMs > Date.now()),
      createdAt: data.createdAt?.toDate?.() || data.createdAt || null,
      updatedAt: data.updatedAt?.toDate?.() || data.updatedAt || null
    };
  }

  /**
   * Lista sesiones (resumen). Filtros opcionales: userId, clientCode.
   * @param {{ userId?: string, clientCode?: string }} [filters]
   * @returns {Promise<Object[]>}
   */
  async listBotSessions(filters = {}) {
    try {
      let query = this.botSessionsCollection;
      if (filters.userId) {
        query = query.where('userId', '==', filters.userId);
      }
      if (filters.clientCode) {
        query = query.where('clientCode', '==', filters.clientCode);
      }
      const snapshot = await query.get();
      return snapshot.docs.map((doc) => this.summarizeBotSession(doc));
    } catch (error) {
      console.error('❌ Error listando bot_sessions:', error);
      throw error;
    }
  }

  /**
   * Borra una sesión concreta
   * @param {string} userId
   * @param {string} clientCode
   * @returns {Promise<boolean>}
   */
  async deleteBotSession(userId, clientCode) {
    try {
      const id = this.sessionId(userId, clientCode);
      await this.botSessionsCollection.doc(id).delete();
      console.log('✅ bot_session eliminada:', id);
      return true;
    } catch (error) {
      console.error('❌ Error eliminando bot_session:', error);
      throw error;
    }
  }

  /**
   * Borra docs de bot_sessions en batches de 400
   * @param {FirebaseFirestore.QueryDocumentSnapshot[]} docs
   * @returns {Promise<number>}
   */
  async deleteBotSessionDocs(docs) {
    if (!docs.length) return 0;
    const batchSize = 400;
    let deleted = 0;
    let batch = this.db.batch();
    let ops = 0;

    for (const doc of docs) {
      batch.delete(doc.ref);
      ops += 1;
      deleted += 1;
      if (ops >= batchSize) {
        await batch.commit();
        batch = this.db.batch();
        ops = 0;
      }
    }
    if (ops > 0) {
      await batch.commit();
    }
    return deleted;
  }

  /**
   * Borra todas las sesiones de un usuario (todos los clientCode)
   * @param {string} userId
   * @returns {Promise<number>}
   */
  async deleteBotSessionsByUserId(userId) {
    try {
      const snapshot = await this.botSessionsCollection.where('userId', '==', userId).get();
      const deleted = await this.deleteBotSessionDocs(snapshot.docs);
      console.log(`✅ bot_sessions eliminadas para usuario ${userId}: ${deleted}`);
      return deleted;
    } catch (error) {
      console.error('❌ Error eliminando bot_sessions por userId:', error);
      throw error;
    }
  }

  /**
   * Borra todas las sesiones de un consultorio
   * @param {string} clientCode
   * @returns {Promise<number>}
   */
  async deleteBotSessionsByClientCode(clientCode) {
    try {
      const snapshot = await this.botSessionsCollection.where('clientCode', '==', clientCode).get();
      const deleted = await this.deleteBotSessionDocs(snapshot.docs);
      console.log(`✅ bot_sessions eliminadas para consultorio ${clientCode}: ${deleted}`);
      return deleted;
    } catch (error) {
      console.error('❌ Error eliminando bot_sessions por clientCode:', error);
      throw error;
    }
  }

  /**
   * Borra todas las sesiones
   * @returns {Promise<number>} - Cantidad borrada
   */
  async resetAllBotSessions() {
    try {
      const snapshot = await this.botSessionsCollection.get();
      const deleted = await this.deleteBotSessionDocs(snapshot.docs);
      console.log(`✅ bot_sessions reseteadas: ${deleted}`);
      return deleted;
    } catch (error) {
      console.error('❌ Error reseteando bot_sessions:', error);
      throw error;
    }
  }

  /**
   * Intenta reclamar un mensaje de webhook para dedup (multi-instancia)
   * @param {string} key - p.ej. ultra:{id} / own:{id}
   * @param {number} ttlMs - TTL del claim en processing
   * @returns {Promise<boolean>} - false si ya está claimed o completed vigente
   */
  async tryClaimWebhookMessage(key, ttlMs = 5 * 60 * 1000) {
    const ref = this.webhookDedupCollection.doc(String(key));
    const now = Date.now();
    const expiresAt = new Date(now + ttlMs);

    try {
      await this.db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists) {
          const data = snap.data() || {};
          const existingExpires = data.expiresAt?.toDate?.() || data.expiresAt;
          const expiresMs = existingExpires ? new Date(existingExpires).getTime() : 0;
          const stillValid = expiresMs > now;
          if (stillValid && (data.status === 'completed' || data.status === 'processing')) {
            throw new Error('WEBHOOK_ALREADY_CLAIMED');
          }
        }
        tx.set(ref, {
          status: 'processing',
          expiresAt,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      });
      return true;
    } catch (error) {
      if (error.message === 'WEBHOOK_ALREADY_CLAIMED') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Marca un mensaje de webhook como completado (evita reintentos tardíos)
   * @param {string} key
   * @param {number} ttlMs
   */
  async markWebhookMessageCompleted(key, ttlMs = 24 * 60 * 60 * 1000) {
    await this.webhookDedupCollection.doc(String(key)).set(
      {
        status: 'completed',
        expiresAt: new Date(Date.now() + ttlMs),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );
  }

  /**
   * Libera el claim para que UltraMsg/Own puedan reintentar
   * @param {string} key
   */
  async releaseWebhookMessage(key) {
    await this.webhookDedupCollection.doc(String(key)).delete();
  }

  /**
   * Verifica la conexión con Firebase
   * @returns {Promise<boolean>} - True si la conexión es exitosa
   */
  async testConnection() {
    try {
      await this.db.collection('test').doc('connection').get();
      console.log('✅ Conexión con Firebase exitosa');
      return true;
    } catch (error) {
      console.error('❌ Error de conexión con Firebase:', error);
      return false;
    }
  }
}

FirebaseService.DEFAULT_RESPONSE_SCHEMA = DEFAULT_RESPONSE_SCHEMA;
FirebaseService.DEFAULT_ENVIAR_PDF_TOOL = DEFAULT_ENVIAR_PDF_TOOL;

module.exports = FirebaseService;