// Écoute Firestore /joueurs → poste les changements de fiche dans #fiches-live
const { EmbedBuilder } = require('discord.js');
const { diffFiche, factionLabel } = require('./fiche');

function startFicheWatcher(client, db) {
  const channelId = process.env.FICHES_CHANNEL_ID;
  if (!channelId) { console.warn('[watcher] FICHES_CHANNEL_ID absent → notifications désactivées'); return; }

  const cache = new Map();   // id -> data
  let seeded = false;

  db.collection('joueurs').onSnapshot(async (snap) => {
    // 1er snapshot : on amorce le cache sans notifier (sinon spam au démarrage)
    if (!seeded) {
      snap.forEach(doc => cache.set(doc.id, doc.data()));
      seeded = true;
      console.log(`[watcher] amorcé sur ${cache.size} fiche(s)`);
      return;
    }
    for (const ch of snap.docChanges()) {
      if (ch.type === 'removed') { cache.delete(ch.doc.id); continue; }
      const id = ch.doc.id;
      const next = ch.doc.data();
      const prev = cache.get(id);
      cache.set(id, next);
      if (ch.type !== 'modified') continue;
      const lines = diffFiche(prev, next);
      if (!lines.length) continue;   // ex. seul lastUpdate a bougé
      try {
        const channel = await client.channels.fetch(channelId);
        const e = new EmbedBuilder()
          .setColor(0x5dbe5d)
          .setAuthor({ name: (next.nom || id) + ' — ' + factionLabel(next.faction) })
          .setDescription(lines.join('\n'))
          .setTimestamp(new Date());
        await channel.send({ embeds: [e] });
      } catch (err) { console.error('[watcher] envoi KO:', err.message); }
    }
  }, (err) => console.error('[watcher] Firestore KO:', err.message));
}

module.exports = { startFicheWatcher };
