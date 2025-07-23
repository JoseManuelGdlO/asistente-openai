const admin = require('firebase-admin');
// const serviceAccount = require('../../firebase-credentials.json');

class FirebaseService {
  constructor() {
    // // Inicializar Firebase Admin SDK
    // if (!admin.apps.length) {
    //   admin.initializeApp({
    //     credential: admin.credential.cert(serviceAccount),
    //     databaseURL: `https://${serviceAccount.project_id}.firebaseio.com`
    //   });
    // }
    
    // this.db = admin.firestore();
    // this.clientsCollection = this.db.collection('clients');
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

module.exports = FirebaseService; 