const Scheduler = require('../src/services/scheduler');
require('dotenv').config();

async function testScheduler() {
  console.log('=== PRUEBA DEL SCHEDULER ===');
  
  const scheduler = new Scheduler();
  
  try {
    // 1. Inicializar el scheduler
    console.log('\n1. Inicializando scheduler...');
    scheduler.init();
    
    // 2. Verificar estado de las tareas
    console.log('\n2. Estado de las tareas:');
    const status = scheduler.getTasksStatus();
    console.log(JSON.stringify(status, null, 2));
    
    // 3. Probar ejecución manual de agenda diaria
    console.log('\n3. Probando ejecución manual de agenda diaria...');
    await scheduler.runTaskManually('dailyAgenda');
    
    // 4. Probar verificación de estado
    console.log('\n4. Probando verificación de estado...');
    await scheduler.runTaskManually('statusCheck');
    
    // 5. Probar limpieza semanal
    console.log('\n5. Probando limpieza semanal...');
    await scheduler.runTaskManually('weeklyCleanup');
    
    console.log('\n✅ Todas las pruebas completadas exitosamente');
    
  } catch (error) {
    console.error('❌ Error en las pruebas:', error.message);
  } finally {
    // Detener el scheduler
    scheduler.stop();
    console.log('\n🛑 Scheduler detenido');
  }
}

// Ejecutar si se llama directamente
if (require.main === module) {
  testScheduler();
}

module.exports = { testScheduler }; 