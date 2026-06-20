// Définition + exécution des commandes slash : /fiche, /archive-session
const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const { getDb } = require('./firebase');
const { ficheEmbed } = require('./fiche');

// Époque de campagne (CLAUDE.md) : 14 juillet 2189 00:00. time = minutes écoulées.
const CAMP_EPOCH = Date.UTC(2189, 6, 14, 0, 0, 0);
function igDate(min) {
  const d = new Date(CAMP_EPOCH + (min || 0) * 60000);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
const TYPE_EMO = { pnj: '👤', lieu: '📍', quete: '📜', info: 'ℹ️' };

// ---- Définitions ----
const definitions = [
  new SlashCommandBuilder()
    .setName('fiche')
    .setDescription("Affiche la fiche synthétique d'un personnage")
    .addStringOption(o => o.setName('personnage').setDescription('Nom ou id du personnage').setRequired(true).setAutocomplete(true))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('archive-session')
    .setDescription("Archive dans Discord les nouvelles entrées du journal de l'app (depuis la dernière archive)")
    .addStringOption(o => o.setName('nom').setDescription('Nom de la session (optionnel)').setRequired(false))
    .addStringOption(o => o.setName('campagne').setDescription('Campagne (défaut : Campagne 1)').setRequired(false).setAutocomplete(true))
    .toJSON(),
];

// ---- /fiche ----
async function handleFiche(interaction) {
  const db = getDb();
  const key = interaction.options.getString('personnage');
  let doc = await db.collection('joueurs').doc(key).get();
  if (!doc.exists) {
    const all = await db.collection('joueurs').get();
    const match = all.docs.find(d => (d.data().nom || '').toLowerCase() === key.toLowerCase())
              || all.docs.find(d => (d.data().nom || '').toLowerCase().includes(key.toLowerCase()));
    if (match) doc = match;
  }
  if (!doc || !doc.exists) { await interaction.reply({ content: `Personnage introuvable : « ${key} »`, ephemeral: true }); return; }
  await interaction.reply({ embeds: [ficheEmbed(doc.id, doc.data())] });
}

async function handleFicheAutocomplete(interaction) {
  try {
    const db = getDb();
    const focused = (interaction.options.getFocused() || '').toLowerCase();
    const snap = await db.collection('joueurs').get();
    const choices = snap.docs
      .map(d => ({ id: d.id, nom: d.data().nom || d.id, campaign: d.data().campaign || 'data' }))
      .filter(c => !focused || c.nom.toLowerCase().includes(focused) || c.id.toLowerCase().includes(focused))
      .slice(0, 25)
      .map(c => ({ name: `${c.nom}${c.campaign !== 'data' ? ' [' + c.campaign + ']' : ''}`, value: c.id }));
    await interaction.respond(choices);
  } catch (e) { try { await interaction.respond([]); } catch (_) {} }
}

async function handleCampAutocomplete(interaction) {
  try {
    const db = getDb();
    const focused = (interaction.options.getFocused() || '').toLowerCase();
    const snap = await db.collection('campaigns').get();
    const list = [{ id: 'data', name: 'Campagne 1' }];
    snap.docs.forEach(d => { if (d.id !== 'data') list.push({ id: d.id, name: (d.data().name || d.id) }); });
    await interaction.respond(
      list.filter(c => !focused || c.name.toLowerCase().includes(focused)).slice(0, 25)
          .map(c => ({ name: c.name, value: c.id }))
    );
  } catch (e) { try { await interaction.respond([]); } catch (_) {} }
}

// ---- /archive-session : archive les NOUVELLES entrées du journal de la campagne ----
async function handleArchive(interaction) {
  const db = getDb();
  const archivesId = process.env.ARCHIVES_CHANNEL_ID;
  if (!archivesId) { await interaction.reply({ content: 'ARCHIVES_CHANNEL_ID non configuré.', ephemeral: true }); return; }
  await interaction.deferReply({ ephemeral: true });

  const camp = interaction.options.getString('campagne') || 'data';
  const nom = interaction.options.getString('nom') || ('Session ' + new Date().toLocaleDateString('fr-FR'));
  const archivesChannel = await interaction.client.channels.fetch(archivesId);

  // Entrées du journal
  const jSnap = await db.collection('journal').doc(camp).get();
  const entries = (jSnap.exists && Array.isArray(jSnap.data().entries)) ? jSnap.data().entries : [];

  // Repère d'archivage (ids déjà archivés) par campagne
  const stateRef = db.collection('discordBot').doc('state');
  const stateSnap = await stateRef.get();
  const st = stateSnap.exists ? stateSnap.data() : {};
  const archivedMap = st.journalArchived || {};
  const archived = new Set(archivedMap[camp] || []);

  const fresh = entries.filter(e => e && e.id && !archived.has(e.id));
  if (!fresh.length) { await interaction.editReply("Aucune nouvelle entrée de journal à archiver pour cette campagne."); return; }
  fresh.sort((a, b) => (a.time || 0) - (b.time || 0));

  // Noms des joueurs (pour afficher l'audience de chaque entrée)
  const jAll = await db.collection('joueurs').get();
  const nameOf = {}; jAll.forEach(d => { nameOf[d.id] = d.data().nom || d.id; });
  const audience = (e) => {
    if (e.revealed === true) return 'Tous';
    const ids = Array.isArray(e.revealedFor) ? e.revealedFor : [];
    if (!ids.length) return 'non révélé';
    return ids.map(id => nameOf[id] || id).join(', ');
  };

  const lines = fresh.map(e => {
    const emo = TYPE_EMO[e.type] || '•';
    return `${emo} **${igDate(e.time || 0)}** — ${e.title || ''}  · 👁 _${audience(e)}_${e.text ? `\n    ${e.text}` : ''}`;
  });

  // Comptage par type
  const counts = fresh.reduce((o, e) => { o[e.type] = (o[e.type] || 0) + 1; return o; }, {});
  const countStr = Object.entries(counts).map(([t, n]) => `${TYPE_EMO[t] || '•'} ${n}`).join('  ') || '—';

  const header = new EmbedBuilder()
    .setColor(0xe8a820)
    .setTitle('🗂 ' + nom)
    .setDescription(`Journal de campagne — **${camp === 'data' ? 'Campagne 1' : camp}**`)
    .addFields(
      { name: 'Entrées', value: '' + fresh.length, inline: true },
      { name: 'Types', value: countStr, inline: true },
      { name: 'Période (in-game)', value: `${igDate(fresh[0].time || 0)} → ${igDate(fresh[fresh.length - 1].time || 0)}` },
    )
    .setTimestamp(new Date());

  // En-tête + thread transcript dans #archives-sessions
  let target = archivesChannel, thread = null;
  if (archivesChannel.type === ChannelType.GuildText) {
    const head = await archivesChannel.send({ embeds: [header] });
    thread = await head.startThread({ name: nom.slice(0, 90), autoArchiveDuration: 10080 }).catch(() => null);
    target = thread || archivesChannel;
  } else {
    await archivesChannel.send({ embeds: [header] });
  }
  let buf = '';
  for (const ln of lines) {
    if ((buf + ln + '\n').length > 1900) { await target.send(buf); buf = ''; }
    buf += ln + '\n';
  }
  if (buf) await target.send(buf);

  // Mémorise les ids archivés
  const newIds = [...(archivedMap[camp] || []), ...fresh.map(e => e.id)];
  await stateRef.set({ journalArchived: { ...archivedMap, [camp]: newIds } }, { merge: true });

  await interaction.editReply(`✅ ${fresh.length} entrée(s) de journal archivée(s) dans <#${archivesId}>${thread ? ' (thread « ' + nom + ' »)' : ''}.`);
}

async function execute(interaction) {
  if (interaction.isAutocomplete()) {
    if (interaction.commandName === 'fiche') return handleFicheAutocomplete(interaction);
    if (interaction.commandName === 'archive-session') return handleCampAutocomplete(interaction);
    return;
  }
  if (!interaction.isChatInputCommand()) return;
  try {
    if (interaction.commandName === 'fiche') return await handleFiche(interaction);
    if (interaction.commandName === 'archive-session') return await handleArchive(interaction);
  } catch (e) {
    console.error('[command] erreur:', e);
    const msg = { content: 'Erreur : ' + e.message, ephemeral: true };
    if (interaction.deferred || interaction.replied) interaction.editReply(msg).catch(() => {});
    else interaction.reply(msg).catch(() => {});
  }
}

module.exports = { definitions, execute };
