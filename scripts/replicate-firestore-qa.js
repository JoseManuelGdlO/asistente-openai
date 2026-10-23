/**
 * Copia las colecciones de la base Firestore (default) a la base qa-db.
 * Solo lee producción. Escribe únicamente en qa-db, con prefijo QA_.
 *
 *   npm run replicate-qa
 *   npm run replicate-qa -- --dry-run
 */
require('dotenv').config();

const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const {
  QA_DATABASE_ID,
  QA_COLLECTION_PREFIX,
  ROOT_COLLECTIONS
} = require('../src/services/firestoreEnv');

const PAGE = 200;
const dryRun = process.argv.includes('--dry-run');

function credentials() {
  if (!process.env.FIREBASE_CREDENTIALS) {
    throw new Error('Falta FIREBASE_CREDENTIALS en el .env. No se copió nada.');
  }
  return JSON.parse(process.env.FIREBASE_CREDENTIALS);
}

async function accessToken() {
  const token = await admin.app().options.credential.getAccessToken();
  if (!token?.access_token) {
    throw new Error('No pude obtener un token de acceso de Firebase.');
  }
  return token.access_token;
}

async function firestoreApi(path, { method = 'GET', body } = {}) {
  const token = await accessToken();
  const response = await fetch(`https://firestore.googleapis.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch (error) {
      json = { raw: text };
    }
  }
  return { ok: response.ok, status: response.status, json };
}

async function waitOperation(name) {
  const started = Date.now();
  while (Date.now() - started < 180000) {
    const op = await firestoreApi(name);
    if (!op.ok) {
      throw new Error(`No pude consultar la operación de creación: ${op.status} ${JSON.stringify(op.json)}`);
    }
    if (op.json?.done) {
      if (op.json.error) {
        throw new Error(op.json.error.message || JSON.stringify(op.json.error));
      }
      return op.json;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error('La creación de la base qa-db no terminó a tiempo.');
}

async function ensureQaDatabase(projectId) {
  const existing = await firestoreApi(`projects/${projectId}/databases/${QA_DATABASE_ID}`);
  if (existing.ok) {
    console.log(`Base ${QA_DATABASE_ID} ya existe. Producción sigue en (default).`);
    return;
  }
  if (existing.status !== 404) {
    throw new Error(
      `No pude leer la base ${QA_DATABASE_ID}: ${existing.status} ${JSON.stringify(existing.json)}`
    );
  }

  const source = await firestoreApi(`projects/${projectId}/databases/${encodeURIComponent('(default)')}`);
  if (!source.ok) {
    throw new Error(
      `No pude leer la región de (default): ${source.status} ${JSON.stringify(source.json)}`
    );
  }

  const locationId = source.json.locationId;
  console.log(`Creando la base ${QA_DATABASE_ID} en ${locationId}. (default) no se modifica.`);
  const payload = {
    locationId,
    type: source.json.type || 'FIRESTORE_NATIVE'
  };
  if (source.json.databaseEdition) {
    payload.databaseEdition = source.json.databaseEdition;
  }

  const created = await firestoreApi(
    `projects/${projectId}/databases?databaseId=${QA_DATABASE_ID}`,
    { method: 'POST', body: payload }
  );
  if (!created.ok) {
    const message = created.json?.error?.message || JSON.stringify(created.json);
    throw new Error(
      `No pude crear la base ${QA_DATABASE_ID} (${created.status}): ${message}\n` +
      `Créala a mano en Firebase Console → Firestore → Crear base de datos, ` +
      `con id "${QA_DATABASE_ID}" y región ${locationId}. Luego vuelve a correr npm run replicate-qa.`
    );
  }
  if (created.json?.name && created.json.done !== true) {
    await waitOperation(created.json.name);
  }
  console.log(`Base ${QA_DATABASE_ID} lista.`);
}

async function copyCollection(srcCol, destCol) {
  let copied = 0;
  let last = null;

  for (;;) {
    let query = srcCol.orderBy(admin.firestore.FieldPath.documentId()).limit(PAGE);
    if (last) query = query.startAfter(last);
    const snap = await query.get();
    if (snap.empty) break;

    if (!dryRun) {
      let batch = destCol.firestore.batch();
      let pending = 0;
      for (const doc of snap.docs) {
        batch.set(destCol.doc(doc.id), doc.data());
        pending += 1;
        if (pending === 400) {
          await batch.commit();
          batch = destCol.firestore.batch();
          pending = 0;
        }
      }
      if (pending) await batch.commit();
    }

    for (const doc of snap.docs) {
      copied += 1;
      if (srcCol.id === 'Assistants') {
        copied += await copyCollection(
          doc.ref.collection('versions'),
          destCol.doc(doc.id).collection('versions')
        );
      }
    }

    last = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE) break;
  }

  return copied;
}

async function copyIndexes(projectId, rootNames) {
  const listed = await firestoreApi(
    `projects/${projectId}/databases/${encodeURIComponent('(default)')}/collectionGroups/-/indexes`
  );
  if (!listed.ok) {
    console.log(
      `No pude listar índices (${listed.status}). ` +
      'Las consultas compuestas en QA pueden pedir crear el índice la primera vez que se usen.'
    );
    return;
  }

  for (const index of listed.json?.indexes || []) {
    const fields = (index.fields || []).filter((field) => field.fieldPath !== '__name__');
    if (fields.length < 2) continue;
    const match = String(index.name || '').match(/collectionGroups\/([^/]+)\/indexes\//);
    if (!match) continue;
    const group = decodeURIComponent(match[1]);
    const destGroup = rootNames.has(group) ? `${QA_COLLECTION_PREFIX}${group}` : group;
    if (dryRun) {
      console.log(`índice ${group} → ${destGroup} (${fields.map((field) => field.fieldPath).join(', ')})`);
      continue;
    }
    const created = await firestoreApi(
      `projects/${projectId}/databases/${QA_DATABASE_ID}/collectionGroups/${encodeURIComponent(destGroup)}/indexes`,
      {
        method: 'POST',
        body: {
          queryScope: index.queryScope || 'COLLECTION',
          fields
        }
      }
    );
    const message = created.json?.error?.message || '';
    if (created.ok || created.status === 409 || /already exists/i.test(message)) {
      console.log(`índice ${group} → ${destGroup}`);
    } else {
      console.log(`índice ${group} no creado: ${created.status} ${message}`);
    }
  }
}

async function main() {
  const serviceAccount = credentials();
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  }

  console.log(dryRun ? 'Vista previa de la réplica QA' : 'Réplica de Firestore hacia QA');
  console.log('Origen (solo lectura): base (default), colecciones sin prefijo');
  console.log(`Destino (escritura):   base ${QA_DATABASE_ID}, colecciones ${QA_COLLECTION_PREFIX}*`);
  console.log('Las subcolecciones, como versions, conservan su nombre dentro del documento QA.');
  console.log('');

  if (dryRun) {
    const existing = await firestoreApi(`projects/${serviceAccount.project_id}/databases/${QA_DATABASE_ID}`);
    console.log(existing.ok
      ? `Base ${QA_DATABASE_ID} ya existe.`
      : `Base ${QA_DATABASE_ID} todavía no existe. Sin --dry-run se intentaría crear.`);
  } else {
    await ensureQaDatabase(serviceAccount.project_id);
  }

  const source = getFirestore(admin.app(), '(default)');
  const target = getFirestore(admin.app(), QA_DATABASE_ID);
  const discovered = await source.listCollections();
  const names = [...new Set([...ROOT_COLLECTIONS, ...discovered.map((col) => col.id)])]
    .filter((name) => !name.startsWith(QA_COLLECTION_PREFIX))
    .sort();

  const summary = [];
  for (const name of names) {
    const destName = `${QA_COLLECTION_PREFIX}${name}`;
    const copied = await copyCollection(source.collection(name), target.collection(destName));
    summary.push({ from: name, to: destName, docs: copied });
    console.log(`(default)/${name} → ${QA_DATABASE_ID}/${destName}: ${copied} documentos${dryRun ? ' (sin escribir)' : ''}`);
  }

  console.log('');
  await copyIndexes(serviceAccount.project_id, new Set(names));

  console.log('');
  console.log(dryRun ? 'Vista previa terminada. No se escribió nada.' : 'Réplica terminada. La base (default) no se modificó.');
  console.log('Para trabajar en local contra QA, agrega esto solo a tu .env (no lo pongas en EasyPanel):');
  console.log(`FIRESTORE_DATABASE_ID=${QA_DATABASE_ID}`);
  console.log(`FIRESTORE_COLLECTION_PREFIX=${QA_COLLECTION_PREFIX}`);
  console.log(`Colecciones copiadas: ${summary.length}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
