// ===== BASE DE DATOS DE ARMAS =====
// Genera el arma actual de una profesión según el tier alcanzado.

function getWeaponName(professionId, tierId) {
    if (professionId === 'arquero') return BOW_NAMES[tierId];
    const prof = getProfession(professionId);
    const tier = TIERS.find(t => t.id === tierId);
    return `${prof.weaponLabel} de ${tier.name}`;
}

function getWeaponForLevel(professionId, level) {
    const prof = getProfession(professionId);
    const tier = getTierForLevel(level);
    const damage = Math.round(prof.baseDamage * tier.mult * 10) / 10;
    return {
        professionId,
        name: getWeaponName(professionId, tier.id),
        emoji: tier.emoji,
        tier,
        damage,
        range: prof.range || 55,
    };
}

function getNextTierPreview(professionId, level) {
    const tier = getTierForLevel(level);
    const nextTier = TIERS.find(t => t.id === tier.id + 1);
    if (!nextTier) return null;
    return {
        name: getWeaponName(professionId, nextTier.id),
        emoji: nextTier.emoji,
        levelRequired: nextTier.levelMin,
    };
}
