// Définition + exécution des commandes slash : /fiche, /archive-session
const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const { getDb } = require('./firebase');
const { ficheEmbed } = require('./fiche');

// ---- Définitions (pour l'enregistrement et le runtime) ----
const definitions = [
  new SlashCommandBuilder()
    .setName('fiche')
    .setDescription("Affiche la fiche synthétique d'un personnage")
    .addStringOption(o => o.setName('personnage').setDescription('Nom ou id du personnage').setRequired(true).setAutocomplete(true))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('archive-session')
    .setDescription("Archive les messages de la session en cours depuis la dernière archive")
    .addStringOption(o => o.setName('nom').setDescription("Nom de la session (optionnel)").setRequired(false))
    .toJSON(),
];

// ---- /fiche ----
async function handleFiche(interaction) {
  const db = getDb();
  const key = interaction.options.getString('personnage');
  let doc = await db.collection('joueurs').doc(key).get();
  if (!doc.exists) {
    // Recherche par nom (insensible à la casse)
    const all = await db.collection('joueurs').get();
    const match = all.docs.find(d => (d.data().nom || '').toLowerCase() === key.toLowerCase())
              || all.docs.find(d => (d.data().nom || '').toLowerCase().includes(key.toLowerCase()));
    if (match) doc = match;
  }
  if (!doc || !doc.exists) { await interaction.reply({ content: `Personnage introuvable : « ${key} »`, ephemeral: true }); return; }
  await interaction.reply({ embeds: [ficheEmbed(doc.id, doc.data())] });
}

// Autocomplétion du nom de personnage
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

// ---- /archive-session ----
async function handleArchive(interaction) {
  const db = getDb();
  const archivesId = process.env.ARCHIVES_CHANNEL_ID;
  const sessionId = process.env.SESSION_CHANNEL_ID || interaction.channelId;
  if (!archivesId) { await interaction.reply({ content: 'ARCHIVES_CHANNEL_ID non configuré.', ephemeral: true }); return; }

  await interaction.deferReply({ ephemeral: true });
  const nom = interaction.options.getString('nom') || ('Session ' + new Date().toLocaleDateString('fr-FR'));

  const sessionChannel = await interaction.client.channels.fetch(sessionId);
  const archivesChannel = await interaction.client.channels.fetch(archivesId);

  // Dernier point d'archive pour ce salon
  const stateRef = db.collection('discordBot').doc('state');
  const stateSnap = await stateRef.get();
  const lastArchive = (stateSnap.exists && stateSnap.data().lastArchive) || {};
  const afterId = lastArchive[sessionId] || null;

  // Récupération paginée des messages postérieurs à afterId (ordre chronologique)
  const collected = [];
  let after = afterId;
  for (let i = 0; i < 20; i++) { // garde-fou : 20 × 100 = 2000 messages max
    const batch = await sessionChannel.messages.fetch({ limit: 100, after: after || '0' });
    if (!batch.size) break;
    const arr = [...batch.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    collected.push(...arr);
    after = arr[arr.length - 1].id;
    if (batch.size < 100) break;
  }
  const msgs = collected.filter(m => !m.author.bot);
  if (!msgs.length) { await interaction.editReply('Aucun nouveau message à archiver depuis la dernière archive.'); return; }

  // Transcript + participants
  const participants = new Set();
  const lines = msgs.map(m => {
    participants.add(m.member?.displayName || m.author.username);
    const t = new Date(m.createdTimestamp).toLocaleString('fr-FR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
    let content = m.content || '';
    if (m.attachments.size) content += (content ? ' ' : '') + [...m.attachments.values()].map(a => a.url).join(' ');
    return `[${t}] ${m.member?.displayName || m.author.username}: ${content}`;
  });

  const first = msgs[0], last = msgs[msgs.length - 1];
  const header = new EmbedBuilder()
    .setColor(0xe8a820)
    .setTitle('🗂 ' + nom)
    .setDescription(`Archive de **#${sessionChannel.name}**`)
    .addFields(
      { name: 'Messages', value: '' + msgs.length, inline: true },
      { name: 'Participants', value: '' + participants.size, inline: true },
      { name: 'Période', value: `${new Date(first.createdTimestamp).toLocaleString('fr-FR')} → ${new Date(last.createdTimestamp).toLocaleString('fr-FR')}` },
      { name: 'Présents', value: [...participants].join(', ').slice(0, 1024) },
    )
    .setTimestamp(new Date());

  // Thread dans #archives-sessions + transcript en morceaux
  let target = archivesChannel;
  let thread = null;
  if (archivesChannel.type === ChannelType.GuildText) {
    const head = await archivesChannel.send({ embeds: [header] });
    thread = await head.startThread({ name: nom.slice(0, 90), autoArchiveDuration: 10080 }).catch(() => null);
    target = thread || archivesChannel;
  } else {
    await archivesChannel.send({ embeds: [header] });
  }
  // Découpe le transcript en blocs < 1900 caractères
  let buf = '';
  for (const ln of lines) {
    if ((buf + ln + '\n').length > 1900) { await target.send('```\n' + buf + '```'); buf = ''; }
    buf += ln + '\n';
  }
  if (buf) await target.send('```\n' + buf + '```');

  // Mémorise le nouveau point d'archive
  await stateRef.set({ lastArchive: { ...lastArchive, [sessionId]: last.id } }, { merge: true });

  await interaction.editReply(`✅ ${msgs.length} message(s) archivé(s) dans <#${archivesId}>${thread ? ' (thread « ' + nom + ' »)' : ''}.`);
}

async function execute(interaction) {
  if (interaction.isAutocomplete()) {
    if (interaction.commandName === 'fiche') return handleFicheAutocomplete(interaction);
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
