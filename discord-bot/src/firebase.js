// Initialisation Firebase Admin (lecture/écriture Firestore, ignore les security rules)
const path = require('path');
const admin = require('firebase-admin');

let _db = null;
function getDb() {
  if (_db) return _db;
  let credential;
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    credential = admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON));
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    const p = path.resolve(process.cwd(), process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
    credential = admin.credential.cert(require(p));
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    credential = admin.credential.applicationDefault();
  } else {
    throw new Error('Aucune credential Firebase. Renseigne FIREBASE_SERVICE_ACCOUNT_PATH ou FIREBASE_SERVICE_ACCOUNT_JSON dans .env');
  }
  admin.initializeApp({ credential, projectId: process.env.FIREBASE_PROJECT_ID || 'fallout-paris' });
  _db = admin.firestore();
  return _db;
}

module.exports = { getDb };
