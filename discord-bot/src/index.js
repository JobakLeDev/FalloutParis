// Point d'entrée du bot Fallout Paris
require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Events } = require('discord.js');
const { getDb } = require('./firebase');
const { execute } = require('./commands');
const { startFicheWatcher } = require('./watchers');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,   // privilégié : nécessaire pour lire le contenu (archive)
  ],
  partials: [Partials.Channel],
});

client.once(Events.ClientReady, (c) => {
  console.log(`✅ Connecté en tant que ${c.user.tag}`);
  try {
    const db = getDb();
    startFicheWatcher(client, db);
  } catch (e) { console.error('Firestore non initialisé:', e.message); }
});

client.on(Events.InteractionCreate, execute);

if (!process.env.DISCORD_TOKEN) { console.error('DISCORD_TOKEN manquant dans .env'); process.exit(1); }
client.login(process.env.DISCORD_TOKEN);
