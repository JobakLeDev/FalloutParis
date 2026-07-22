#!/usr/bin/env node
/**
 * Charge poi.geojson dans Firebase /carte/data.pois
 * Usage: node load-poi-firebase.js
 */

const fs = require('fs');
const path = require('path');

// Firebase v9 compat
const firebase = require('firebase/app');
require('firebase/firestore');

const firebaseConfig = {
  apiKey: "AIzaSyC1-cP6zKVfkXdCvJHUW5OZ0m-fCQhfSVI",
  authDomain: "fallout-paris.firebaseapp.com",
  projectId: "fallout-paris",
  storageBucket: "fallout-paris.appspot.com",
  messagingSenderId: "835934395903",
  appId: "1:835934395903:web:ba10847eef67fd3c7ec5e2"
};

// Initialiser Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

async function loadPOIs() {
  try {
    // Lire le geojson
    const filePath = path.join(__dirname, 'map', 'poi.geojson');
    console.log(`📖 Lecture ${filePath}...`);

    const content = fs.readFileSync(filePath, 'utf8');
    const geojson = JSON.parse(content);

    // Transformer features en array simple
    const pois = geojson.features.map((feature, idx) => {
      const props = feature.properties;
      const coords = feature.geometry.coordinates;
      return {
        id: props.id || idx,
        nom: props.nom_jeu,
        type: 'other', // Sera défini par MJ
        lng: coords[0],
        lat: coords[1],
        revealedFor: [], // Vide au départ
        icon: 'pin' // Sera défini par MJ
      };
    });

    console.log(`✓ ${pois.length} POIs lus`);
    console.log('Exemple:', JSON.stringify(pois[0], null, 2));

    // Écrire dans Firebase /carte/data
    console.log('\n📡 Écriture dans Firebase /carte/data...');
    await db.collection('carte').doc('data').set({ pois }, { merge: true });
    console.log('✓ POIs écrits dans Firebase');

    // Aussi charger dans les documents scopés par campagne
    const camps = await db.collection('carte').listCollections();
    const campDocs = (await Promise.all(
      Array.from(camps).map(c => c.doc('data').get())
    )).filter(doc => doc.exists);

    for (const doc of campDocs) {
      const campId = doc.ref.parent.id;
      if (!campId.startsWith('ground__')) {
        console.log(`📡 Écriture dans /carte/${campId}...`);
        await db.collection('carte').doc(campId).set({ pois }, { merge: true });
      }
    }

    console.log('\n✅ POIs chargés dans Firebase');
    process.exit(0);
  } catch (err) {
    console.error('❌ Erreur:', err.message);
    process.exit(1);
  }
}

loadPOIs();
