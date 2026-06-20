// Enregistre les commandes slash sur le serveur (guild) — exécuter : npm run deploy
require('dotenv').config();
const { REST, Routes } = require('discord.js');
const { definitions } = require('./commands');

(async () => {
  const { DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID } = process.env;
  if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID || !DISCORD_GUILD_ID) {
    console.error('Manque DISCORD_TOKEN / DISCORD_CLIENT_ID / DISCORD_GUILD_ID dans .env');
    process.exit(1);
  }
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID), { body: definitions });
    console.log(`✅ ${definitions.length} commande(s) enregistrée(s) sur le serveur ${DISCORD_GUILD_ID}.`);
  } catch (e) { console.error('Échec enregistrement:', e); process.exit(1); }
})();
