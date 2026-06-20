// Helpers de synthèse d'une fiche personnage (structure Firestore /joueurs/{id})
const { EmbedBuilder } = require('discord.js');

const FACTION_LABELS = {
  republique: 'République', reseau: 'Réseau', commune: 'Commune', nnfp: 'NNFP',
  zazous: 'Zazous', ultras: 'Ultras', vault: 'Abri 74', settlement: 'Bourg-de-Bois',
};
const FACTION_COLORS = {
  republique: 0x4a7ba6, reseau: 0x7d3c98, commune: 0xb03a2e, nnfp: 0xd68910,
  zazous: 0xf1c40f, ultras: 0x5d6d7e, vault: 0x3a78c2, settlement: 0x8a6d3b,
};
const SKILL_LABELS = {
  en_weapon: 'Armes énergie', cac_weapon: 'Armes de CàC', light_weapon: 'Armes légères',
  heavy_weapon: 'Armes lourdes', athletics: 'Athlétisme', lockpick: 'Crochetage',
  speech: 'Discours', sneak: 'Discrétion', explosives: 'Explosifs', barehand: 'Mains nues',
  medicine: 'Médecine', pilot: 'Pilotage', throwing: 'Projectiles', repair: 'Réparation',
  science: 'Sciences', survival: 'Survie', barter: 'Troc',
};

function factionLabel(f) { return FACTION_LABELS[f] || f || '—'; }

// PV max approximatif (base RAW : LCK + END + niveau-1). Les perks (Life Giver…) ne sont pas calculés ici.
function hpMaxApprox(d) {
  const sp = d.special || {};
  return (sp.L || 0) + (sp.E || 0) + Math.max(0, (d.niveau || 1) - 1);
}
function equippedWeapons(d) {
  return (d.inventory || []).filter(it => it && it.equipped && it.type === 'WEAPON').map(it => it.name);
}
function equippedArmor(d) {
  return (d.inventory || []).filter(it => it && it.equipped && (it.type === 'ARMOR' || it.type === 'CLOTHING')).map(it => it.name);
}
function imageUrl(d) {
  const u = d.image || d.portrait || d.img || d.avatar || '';
  return (/^https?:\/\//i.test(u)) ? u : '';
}
function specialLine(d) {
  const sp = d.special || {};
  return ['S', 'P', 'E', 'C', 'I', 'A', 'L'].map(k => `${k} **${sp[k] != null ? sp[k] : '?'}**`).join(' · ');
}

// Embed synthétique d'une fiche
function ficheEmbed(id, d) {
  const titre = (d.nom || id) + (d.customTitle ? ` « ${d.customTitle} »` : '');
  const weaps = equippedWeapons(d);
  const armor = equippedArmor(d);
  const tagged = (d.taggedSkills || []).map(k => SKILL_LABELS[k] || k);
  const e = new EmbedBuilder()
    .setColor(FACTION_COLORS[d.faction] != null ? FACTION_COLORS[d.faction] : 0x5dbe5d)
    .setTitle('☢ ' + titre)
    .addFields(
      { name: 'Faction', value: factionLabel(d.faction), inline: true },
      { name: 'Niveau', value: `${d.niveau || 1} (${d.xp || 0} XP)`, inline: true },
      { name: 'PV', value: `${d.hp != null ? d.hp : '?'}/${hpMaxApprox(d)}`, inline: true },
      { name: 'Radiations', value: `${d.rad || 0}`, inline: true },
      { name: 'Caps', value: `${d.caps || 0}`, inline: true },
      { name: 'Power Armor', value: d.powerArmor ? 'Oui' : 'Non', inline: true },
      { name: 'S.P.E.C.I.A.L', value: specialLine(d), inline: false },
    );
  if (tagged.length) e.addFields({ name: 'Compétences tag', value: tagged.join(', '), inline: false });
  e.addFields(
    { name: '🔫 Armes équipées', value: weaps.length ? weaps.join(', ') : '—', inline: false },
    { name: '🛡 Armure / tenue', value: armor.length ? armor.join(', ') : '—', inline: false },
  );
  const img = imageUrl(d);
  if (img) e.setThumbnail(img);
  const camp = d.campaign && d.campaign !== 'data' ? d.campaign : 'Campagne 1';
  e.setFooter({ text: `id: ${id} · ${camp}` });
  return e;
}

// Diff synthétique entre deux états de fiche (pour #fiches-live)
const WATCHED = [
  ['nom', 'Nom'], ['faction', 'Faction', factionLabel], ['niveau', 'Niveau'], ['xp', 'XP'],
  ['hp', 'PV'], ['rad', 'Rad'], ['caps', 'Caps'], ['powerArmor', 'Power Armor'], ['customTitle', 'Surnom'],
];
function fmt(v) { return typeof v === 'boolean' ? (v ? 'Oui' : 'Non') : (v == null || v === '' ? '—' : '' + v); }
function diffFiche(prev, next) {
  const lines = [];
  for (const [key, label, mapper] of WATCHED) {
    const a = prev ? prev[key] : undefined, b = next ? next[key] : undefined;
    if (a !== b) {
      const fa = mapper ? mapper(a) : fmt(a), fb = mapper ? mapper(b) : fmt(b);
      lines.push(`**${label}** : ${fmt(fa)} → ${fmt(fb)}`);
    }
  }
  // Armes équipées (ensemble)
  const wa = new Set(equippedWeapons(prev || {})), wb = new Set(equippedWeapons(next || {}));
  const added = [...wb].filter(x => !wa.has(x)), removed = [...wa].filter(x => !wb.has(x));
  if (added.length) lines.push(`🔫 équipe : ${added.join(', ')}`);
  if (removed.length) lines.push(`🔻 retire : ${removed.join(', ')}`);
  return lines;
}

module.exports = { ficheEmbed, diffFiche, factionLabel, FACTION_COLORS, SKILL_LABELS };
