// ===== SISTEMA DE MONTURAS =====
// 10 tiers (mismo Tier que la mena/madera usadas para craftearla). El
// incremento de velocidad base de cada tier se suma a un bono por Rareza
// del núcleo usado (Común +0% .. Mítico +10%, +2% por escalón de rareza).
// Solo se puede equipar 1 montura a la vez (ver player.equipMount).

const MOUNTS = [
    { tierId: 1,  name: 'Corcel de Bronce',       emoji: '🐴', baseSpeedPercent: 10 },
    { tierId: 2,  name: 'Lobo de Hierro',         emoji: '🐺', baseSpeedPercent: 15 },
    { tierId: 3,  name: 'Falcón de Acero',        emoji: '🦅', baseSpeedPercent: 20 },
    { tierId: 4,  name: 'Fénix Ardiente',         emoji: '🔥', baseSpeedPercent: 25 },
    { tierId: 5,  name: 'Dragón de Mithril',      emoji: '🐉', baseSpeedPercent: 30 },
    { tierId: 6,  name: 'Grifo Celestial',        emoji: '🦁', baseSpeedPercent: 35 },
    { tierId: 7,  name: 'Unicornio Adamantite',   emoji: '✨', baseSpeedPercent: 40 },
    { tierId: 8,  name: 'Espectro de Sombra',     emoji: '👻', baseSpeedPercent: 45 },
    { tierId: 9,  name: 'Criatura Celestial',     emoji: '🌟', baseSpeedPercent: 50 },
    { tierId: 10, name: 'Entidad Absoluta',       emoji: '⚡', baseSpeedPercent: 60 },
];

function getMountDef(tierId) { return MOUNTS.find(m => m.tierId === tierId); }

// Costo = mena y madera de ESE tier (10 * tier cada una) + núcleos de esa
// misma rareza y tier (5 * tier).
function getMountCraftCost(tierId) {
    return { ore: tierId * 10, wood: tierId * 10, nucleo: tierId * 5 };
}

// +2% de velocidad por cada escalón de rareza del núcleo usado (Común=0 .. Mítico=+10%).
function getMountSpeedPercent(tierId, rarityId) {
    const def = getMountDef(tierId);
    const idx = Math.max(0, MONSTER_RARITIES.findIndex(r => r.id === rarityId));
    return def.baseSpeedPercent + idx * 2;
}
