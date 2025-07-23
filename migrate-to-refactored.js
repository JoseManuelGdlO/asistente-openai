#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🔄 Iniciando migración al código refactorizado...\n');

// Verificar que estamos en el directorio correcto
if (!fs.existsSync('src/index.js')) {
  console.error('❌ Error: No se encontró src/index.js');
  console.error('Asegúrate de ejecutar este script desde el directorio raíz del proyecto');
  process.exit(1);
}

// Lista de archivos que deben existir
const requiredFiles = [
  'src/confirmationManager.js',
  'src/userContextManager.js',
  'src/openAIManager.js',
  'src/webhookManager.js',
  'src/schedulerController.js',
  'src/index-refactored.js'
];

console.log('📋 Verificando archivos requeridos...');

// Verificar que todos los archivos requeridos existan
let allFilesExist = true;
for (const file of requiredFiles) {
  if (fs.existsSync(file)) {
    console.log(`✅ ${file}`);
  } else {
    console.log(`❌ ${file} - NO ENCONTRADO`);
    allFilesExist = false;
  }
}

if (!allFilesExist) {
  console.error('\n❌ Error: Faltan archivos requeridos para la migración');
  console.error('Asegúrate de que todos los archivos de las clases estén creados');
  process.exit(1);
}

console.log('\n✅ Todos los archivos requeridos están presentes');

// Crear backup del archivo original
const backupPath = 'src/index-old.js';
if (fs.existsSync(backupPath)) {
  console.log('⚠️  Ya existe un backup anterior, sobrescribiendo...');
}

try {
  fs.copyFileSync('src/index.js', backupPath);
  console.log(`✅ Backup creado: ${backupPath}`);
} catch (error) {
  console.error('❌ Error al crear backup:', error.message);
  process.exit(1);
}

// Reemplazar el archivo principal
try {
  fs.copyFileSync('src/index-refactored.js', 'src/index.js');
  console.log('✅ Archivo principal reemplazado con la versión refactorizada');
} catch (error) {
  console.error('❌ Error al reemplazar archivo principal:', error.message);
  process.exit(1);
}

// Eliminar el archivo temporal
try {
  fs.unlinkSync('src/index-refactored.js');
  console.log('✅ Archivo temporal eliminado');
} catch (error) {
  console.log('⚠️  No se pudo eliminar el archivo temporal:', error.message);
}

console.log('\n🎉 ¡Migración completada exitosamente!');
console.log('\n📁 Estructura final:');
console.log('src/');
console.log('├── index.js                    # Archivo principal refactorizado');
console.log('├── ultramsgManager.js          # Gestor de UltraMsg');
console.log('├── scheduler.js                # Scheduler');
console.log('├── confirmationManager.js      # Gestor de confirmaciones');
console.log('├── userContextManager.js       # Gestor de contexto de usuario');
console.log('├── openAIManager.js           # Gestor de OpenAI');
console.log('├── webhookManager.js          # Gestor de webhooks');
console.log('├── schedulerController.js     # Controlador del scheduler');
console.log('└── index-old.js               # Backup del archivo original');

console.log('\n🚀 Para probar el servidor:');
console.log('npm start');

console.log('\n📖 Para más información, consulta: REFACTORING_GUIDE.md');

console.log('\n⚠️  IMPORTANTE:');
console.log('- El archivo original se guardó como src/index-old.js');
console.log('- Si algo no funciona, puedes revertir con: mv src/index-old.js src/index.js');
console.log('- Verifica que todas las variables de entorno estén configuradas'); 