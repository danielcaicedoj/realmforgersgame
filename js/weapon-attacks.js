// ===== DATOS DE ATAQUES POR ARMA (PA + CARGA) =====
// Cada arma de combate define, por tier (1-7), 2 ataques básicos (encadenables
// con Puntos de Acción) y 1 ataque especial (requiere carga acumulada).
//
// Forma de cada ataque:
// { name, emoji, apCost, damage, hits, aoe, chargeGain, chargeRequired, arrowCost,
//   burn:{dmg,turns,chance}, bleed:{dmg,turns,chance}, stun:{chance},
//   defenseDownPercent, defenseDownFlat, defenseDownTurns,
//   attackDownFlat, attackDownTurns, heal, penetratePercent,
//   critChance, critMultiplier, extraRandomHit:{damage} }
//
// hits > 1  => golpea N veces al mismo objetivo (damage = daño por golpe).
// aoe true  => golpea una vez a CADA enemigo vivo del combate (damage = daño por enemigo).
// Los efectos (quemadura, sangrado, etc.) se aplican por cada golpe que conecta,
// salvo "heal" que se aplica una sola vez por uso del ataque.

const WEAPON_ATTACKS = {

    // ===== PÍCARO (Dagas) =====
    // Alta probabilidad de crítico base (+12%, ver WEAPON_CRIT_BASE) y
    // especialista en penetración de armadura. A diferencia de las demás
    // clases, el especial (Ataque 3) NO requiere carga acumulada: solo
    // Puntos de Acción (chargeRequired queda sin definir a propósito, ver
    // playerAttackWithAP en combat.js). "splashCount/splashPercent" golpea
    // enemigos cercanos adicionales a un % del daño del golpe principal
    // (ver el mismo mecanismo en combat.js). Simplificación de diseño: se
    // omiten dos micro-efectos del diseño original por ser inconsistentes
    // con el resto del kit (Danza Mortal tier 3 no otorga esquiva temporal
    // ni "ignora bloqueo" — el juego no modela bloqueo enemigo; y Destello
    // Estelar tier 5 no genera cargas de Enfoque, que es un recurso
    // exclusivo del Arquero).
    picaro: {
        tiers: {
            1: {
                basic: [
                    { name: 'Cuchillada', emoji: '🔪', apCost: 2, damage: 8, defenseDownPercent: 0.15, defenseDownTurns: 2 },
                    { name: 'Corte', emoji: '⚔️', apCost: 3, damage: 11, critChance: 0.05 },
                ],
                special: { name: 'Lluvia de Acero', emoji: '🗡️', apCost: 6, damage: 20, splashCount: 1, splashPercent: 0.6, bonusDefenseDownChance: 0.25, bonusDefenseDownPercent: 0.10, bonusDefenseDownTurns: 2 },
            },
            2: {
                basic: [
                    { name: 'Cuchillada', emoji: '🔪', apCost: 2, damage: 10.7, defenseDownPercent: 0.15, defenseDownTurns: 2 },
                    { name: 'Corte', emoji: '⚔️', apCost: 3, damage: 13.5, critChance: 0.05 },
                ],
                special: { name: 'Vendaval de Dagas', emoji: '🌪️', apCost: 6, damage: 25, critChance: 0.02, splashCount: 2, splashPercent: 0.6, bleed: { dmg: 2, turns: 3, chance: 0.30 } },
            },
            3: {
                basic: [
                    { name: 'Cuchillada', emoji: '🔪', apCost: 2, damage: 13.3, defenseDownPercent: 0.15, defenseDownTurns: 2 },
                    { name: 'Corte', emoji: '⚔️', apCost: 3, damage: 16.1, critChance: 0.05 },
                ],
                special: { name: 'Danza Mortal', emoji: '💃', apCost: 6, damage: 30, critChance: 0.04 },
            },
            4: {
                basic: [
                    { name: 'Cuchillada', emoji: '🔪', apCost: 2, damage: 16, defenseDownPercent: 0.15, defenseDownTurns: 2 },
                    { name: 'Corte', emoji: '⚔️', apCost: 3, damage: 18.6, critChance: 0.05 },
                ],
                special: { name: 'Puñalada Ardiente', emoji: '🔥', apCost: 6, damage: 35, penetratePercent: 0.25, burn: { dmg: 3, turns: 4, chance: 1 } },
            },
            5: {
                basic: [
                    { name: 'Cuchillada', emoji: '🔪', apCost: 2, damage: 18.7, defenseDownPercent: 0.15, defenseDownTurns: 2 },
                    { name: 'Corte', emoji: '⚔️', apCost: 3, damage: 21.2, critChance: 0.05 },
                ],
                special: { name: 'Destello Estelar', emoji: '🌠', apCost: 6, damage: 40, critChance: 0.06, selfHealChance: 0.40, selfHealAmount: 15 },
            },
            6: {
                basic: [
                    { name: 'Cuchillada', emoji: '🔪', apCost: 2, damage: 21.3, defenseDownPercent: 0.15, defenseDownTurns: 2 },
                    { name: 'Corte', emoji: '⚔️', apCost: 3, damage: 23.7, critChance: 0.05 },
                ],
                special: { name: 'Castigo Divino', emoji: '⚖️', apCost: 6, damage: 45, critChance: 0.03, defenseDownPercent: 0.20, defenseDownTurns: 3, attackDownPercent: 0.20, attackDownTurns: 3, critPaRestoreChance: 0.50, critPaRestoreAmount: 1 },
            },
            7: {
                basic: [
                    { name: 'Cuchillada', emoji: '🔪', apCost: 2, damage: 24, defenseDownPercent: 0.15, defenseDownTurns: 2 },
                    { name: 'Corte', emoji: '⚔️', apCost: 3, damage: 26.2, critChance: 0.05 },
                ],
                special: { name: 'Corte del Destino', emoji: '🌟', apCost: 6, damage: 50, critChance: 0.50, critMultiplier: 2, noCostChance: 0.30 },
            },
        },
    },

    // ===== GUERRERO (Espada, ex-Claymore) =====
    // Ataque 1 otorga carga de PODER (máx 3, se mantiene hasta consumirse);
    // Ataque 2 consume TODAS las cargas para un bono de daño (ver
    // playerAttackWithAP en combat.js). El Ataque 3 (especial) se mantiene
    // sin cambios respecto al diseño original (gate de chargeGain/
    // chargeRequired viejo, independiente de PODER).
    guerrero: {
        tiers: {
            1: {
                basic: [
                    { name: 'Estocada', emoji: '⚔️', apCost: 2, damage: 12, chargeGain: 1, grantsClassCharge: true },
                    { name: 'Corte', emoji: '🌀', apCost: 3, damage: 16, chargeGain: 2, consumesClassCharge: true },
                ],
                special: { name: 'Hendedura', emoji: '💥', apCost: 6, damage: 35, chargeRequired: 3 },
            },
            2: {
                basic: [
                    { name: 'Estocada', emoji: '⚔️', apCost: 2, damage: 14.6, chargeGain: 1, grantsClassCharge: true },
                    { name: 'Corte', emoji: '🌀', apCost: 3, damage: 18.7, chargeGain: 2, consumesClassCharge: true },
                ],
                special: { name: 'Hendedura', emoji: '💥', apCost: 6, damage: 40, chargeRequired: 3 },
            },
            3: {
                basic: [
                    { name: 'Estocada', emoji: '⚔️', apCost: 2, damage: 17.1, chargeGain: 1, grantsClassCharge: true },
                    { name: 'Corte', emoji: '🌀', apCost: 3, damage: 21.3, chargeGain: 2, consumesClassCharge: true },
                ],
                special: { name: 'Hendedura', emoji: '💥', apCost: 6, damage: 45, chargeRequired: 3 },
            },
            4: {
                basic: [
                    { name: 'Estocada', emoji: '⚔️', apCost: 2, damage: 19.7, chargeGain: 1, grantsClassCharge: true },
                    { name: 'Corte', emoji: '🌀', apCost: 3, damage: 24, chargeGain: 2, consumesClassCharge: true },
                ],
                special: { name: 'Tempestad de Fuego', emoji: '🌋', apCost: 6, damage: 20, aoe: true, chargeRequired: 4 },
            },
            5: {
                basic: [
                    { name: 'Estocada', emoji: '⚔️', apCost: 2, damage: 22.3, chargeGain: 1, grantsClassCharge: true },
                    { name: 'Corte', emoji: '🌀', apCost: 3, damage: 26.7, chargeGain: 2, consumesClassCharge: true },
                ],
                special: { name: 'Rompedor de Reyes', emoji: '👑', apCost: 6, damage: 60, chargeRequired: 4, defenseDownPercent: 0.5, defenseDownTurns: 1 },
            },
            6: {
                basic: [
                    { name: 'Estocada', emoji: '⚔️', apCost: 2, damage: 24.9, chargeGain: 1, grantsClassCharge: true },
                    { name: 'Corte', emoji: '🌀', apCost: 3, damage: 29.3, chargeGain: 2, consumesClassCharge: true },
                ],
                special: { name: 'Escisión Celestial', emoji: '🌠', apCost: 6, damage: 65, aoe: true, chargeRequired: 5, heal: 5 },
            },
            7: {
                basic: [
                    { name: 'Estocada', emoji: '⚔️', apCost: 2, damage: 27.4, chargeGain: 1, grantsClassCharge: true },
                    { name: 'Corte', emoji: '🌀', apCost: 3, damage: 32, chargeGain: 2, consumesClassCharge: true },
                ],
                special: { name: 'Cataclismo', emoji: '☄️', apCost: 6, damage: 70, aoe: true, chargeRequired: 5, stun: { chance: 1 } },
            },
        },
    },

    // ===== ARQUERO (Arco) — todos los ataques consumen flechas =====
    // Ataque 1 otorga carga de ENFOQUE (máx 3); en el propio Ataque 1, cada
    // carga da 20% de probabilidad de devolver 1 PA. Ataque 2 consume TODAS
    // las cargas: más objetivos y reducción de armadura cuantas más cargas
    // (ver playerAttackWithAP). Ataque 3 (especial) sin cambios.
    arquero: {
        tiers: {
            1: {
                basic: [
                    { name: 'Disparo Certero', emoji: '🏹', apCost: 3, damage: 9, chargeGain: 2, arrowCost: 1, grantsClassCharge: true },
                    { name: 'Lluvia de Flechas', emoji: '🎯', apCost: 4, damage: 14, chargeGain: 3, arrowCost: 2, consumesClassCharge: true },
                ],
                special: { name: 'Lluvia de Flechas', emoji: '🌧️', apCost: 6, damage: 10, aoe: true, chargeRequired: 8, arrowCost: 3 },
            },
            2: {
                basic: [
                    { name: 'Disparo Certero', emoji: '🏹', apCost: 3, damage: 12.4, chargeGain: 2, arrowCost: 1, grantsClassCharge: true },
                    { name: 'Lluvia de Flechas', emoji: '🎯', apCost: 4, damage: 21, chargeGain: 3, arrowCost: 2, consumesClassCharge: true },
                ],
                special: { name: 'Lluvia de Flechas', emoji: '🌧️', apCost: 6, damage: 13, aoe: true, chargeRequired: 8, arrowCost: 3 },
            },
            3: {
                basic: [
                    { name: 'Disparo Certero', emoji: '🏹', apCost: 3, damage: 15.8, chargeGain: 2, arrowCost: 1, grantsClassCharge: true },
                    { name: 'Lluvia de Flechas', emoji: '🎯', apCost: 4, damage: 28, chargeGain: 3, arrowCost: 2, consumesClassCharge: true },
                ],
                special: { name: 'Lluvia de Flechas', emoji: '🌧️', apCost: 6, damage: 16, aoe: true, chargeRequired: 8, arrowCost: 3 },
            },
            4: {
                basic: [
                    { name: 'Disparo Certero', emoji: '🏹', apCost: 3, damage: 19.1, chargeGain: 2, arrowCost: 1, grantsClassCharge: true },
                    { name: 'Lluvia de Flechas', emoji: '🎯', apCost: 4, damage: 35, chargeGain: 3, arrowCost: 2, consumesClassCharge: true },
                ],
                special: { name: 'Tempestad de Fuego', emoji: '🌋', apCost: 6, damage: 19, aoe: true, chargeRequired: 9, arrowCost: 3, burn: { dmg: 1, turns: 2 } },
            },
            5: {
                basic: [
                    { name: 'Disparo Certero', emoji: '🏹', apCost: 3, damage: 22.5, chargeGain: 2, arrowCost: 1, grantsClassCharge: true },
                    { name: 'Lluvia de Flechas', emoji: '🎯', apCost: 4, damage: 42, chargeGain: 3, arrowCost: 2, consumesClassCharge: true },
                ],
                special: { name: 'Constelación', emoji: '🌌', apCost: 6, damage: 22, hits: 3, chargeRequired: 9, arrowCost: 3, extraRandomHit: { damage: 22 } },
            },
            6: {
                basic: [
                    { name: 'Disparo Certero', emoji: '🏹', apCost: 3, damage: 25.9, chargeGain: 2, arrowCost: 1, grantsClassCharge: true },
                    { name: 'Lluvia de Flechas', emoji: '🎯', apCost: 4, damage: 49, chargeGain: 3, arrowCost: 2, consumesClassCharge: true },
                ],
                special: { name: 'Lluvia Celestial', emoji: '🌦️', apCost: 6, damage: 25, aoe: true, chargeRequired: 10, arrowCost: 3, heal: 3 },
            },
            7: {
                basic: [
                    { name: 'Disparo Certero', emoji: '🏹', apCost: 3, damage: 29.3, chargeGain: 2, arrowCost: 1, grantsClassCharge: true },
                    { name: 'Lluvia de Flechas', emoji: '🎯', apCost: 4, damage: 56, chargeGain: 3, arrowCost: 2, consumesClassCharge: true },
                ],
                special: { name: 'Lluvia del Destino', emoji: '💫', apCost: 6, damage: 28, hits: 3, chargeRequired: 10, arrowCost: 3, critChance: 0.30, critMultiplier: 2 },
            },
        },
    },

    // ===== BÁRBARO (Hacha de Batalla) =====
    // Ataque 1 (Tajo) roba 15% del daño como vida y otorga carga de SED DE
    // SANGRE (máx 3). Ataque 2 (Tajo Desgarrador) consume TODAS las cargas:
    // más robo de vida cuantas más cargas. Por debajo del 30% HP, cada
    // carga ACTIVA suma +1 daño / +0.1% crítico / +5% robo de vida extra a
    // CUALQUIER ataque (ver playerAttackWithAP). Ataque 3 sin cambios.
    barbaro: {
        tiers: {
            1: {
                basic: [
                    { name: 'Tajo', emoji: '🪓', apCost: 2, damage: 13, chargeGain: 1, grantsClassCharge: true },
                    { name: 'Tajo Desgarrador', emoji: '🩸', apCost: 4, damage: 18, chargeGain: 2, consumesClassCharge: true },
                ],
                special: { name: 'Furia del Hacha', emoji: '😡', apCost: 6, damage: 32, chargeRequired: 3 },
            },
            2: {
                basic: [
                    { name: 'Tajo', emoji: '🪓', apCost: 2, damage: 16.3, chargeGain: 1, grantsClassCharge: true },
                    { name: 'Tajo Desgarrador', emoji: '🩸', apCost: 4, damage: 24.8, chargeGain: 2, consumesClassCharge: true },
                ],
                special: { name: 'Furia del Hacha', emoji: '😡', apCost: 6, damage: 37, chargeRequired: 3 },
            },
            3: {
                basic: [
                    { name: 'Tajo', emoji: '🪓', apCost: 2, damage: 19.5, chargeGain: 1, grantsClassCharge: true },
                    { name: 'Tajo Desgarrador', emoji: '🩸', apCost: 4, damage: 31.5, chargeGain: 2, consumesClassCharge: true },
                ],
                special: { name: 'Furia del Hacha', emoji: '😡', apCost: 6, damage: 42, chargeRequired: 3 },
            },
            4: {
                basic: [
                    { name: 'Tajo', emoji: '🪓', apCost: 2, damage: 22.8, chargeGain: 1, grantsClassCharge: true },
                    { name: 'Tajo Desgarrador', emoji: '🩸', apCost: 4, damage: 38.3, chargeGain: 2, consumesClassCharge: true },
                ],
                special: { name: 'Inferno', emoji: '🌋', apCost: 6, damage: 22, aoe: true, chargeRequired: 4 },
            },
            5: {
                basic: [
                    { name: 'Tajo', emoji: '🪓', apCost: 2, damage: 26, chargeGain: 1, grantsClassCharge: true },
                    { name: 'Tajo Desgarrador', emoji: '🩸', apCost: 4, damage: 45, chargeGain: 2, consumesClassCharge: true },
                ],
                special: { name: 'Tormenta de Hachas', emoji: '🌪️', apCost: 6, damage: 19, hits: 3, chargeRequired: 4 },
            },
            6: {
                basic: [
                    { name: 'Tajo', emoji: '🪓', apCost: 2, damage: 29.3, chargeGain: 1, grantsClassCharge: true },
                    { name: 'Tajo Desgarrador', emoji: '🩸', apCost: 4, damage: 51.8, chargeGain: 2, consumesClassCharge: true },
                ],
                special: { name: 'Aullido Celestial', emoji: '📯', apCost: 6, damage: 62, aoe: true, chargeRequired: 5, heal: 4 },
            },
            7: {
                basic: [
                    { name: 'Tajo', emoji: '🪓', apCost: 2, damage: 32.5, chargeGain: 1, grantsClassCharge: true },
                    { name: 'Tajo Desgarrador', emoji: '🩸', apCost: 4, damage: 58.5, chargeGain: 2, consumesClassCharge: true },
                ],
                special: { name: 'Apocalipsis', emoji: '☄️', apCost: 6, damage: 67, aoe: true, chargeRequired: 5, critChance: 0.20, critMultiplier: 2 },
            },
        },
    },

    // ===== HERRERO (Martillo) =====
    // "GOLPE CON PESO": el texto original dice "reduce velocidad del enemigo
    // (ataca más lento)" sin porcentaje; se interpreta como un debuff de
    // ataque moderado (no un aturdimiento completo) para no ser demasiado
    // fuerte en un ataque básico de tier 1. Ajustable si la intención era otra.
    herrero: {
        tiers: {
            1: {
                basic: [
                    { name: 'Golpe de Martillo', emoji: '🔨', apCost: 3, damage: 10, chargeGain: 1 },
                    { name: 'Golpe con Peso', emoji: '⚖️', apCost: 4, damage: 14, chargeGain: 2, attackDownFlat: 2, attackDownTurns: 1 },
                ],
                special: { name: 'Forja', emoji: '⚒️', apCost: 6, damage: 26, chargeRequired: 3, heal: 3 },
            },
            2: {
                basic: [
                    { name: 'Golpe de Martillo', emoji: '🔨', apCost: 3, damage: 13, chargeGain: 1 },
                    { name: 'Golpe con Peso', emoji: '⚖️', apCost: 4, damage: 17, chargeGain: 2, attackDownFlat: 2, attackDownTurns: 1 },
                ],
                special: { name: 'Forja', emoji: '⚒️', apCost: 6, damage: 31, chargeRequired: 3, heal: 3 },
            },
            3: {
                basic: [
                    { name: 'Golpe de Martillo', emoji: '🔨', apCost: 3, damage: 16, chargeGain: 1 },
                    { name: 'Golpe con Peso', emoji: '⚖️', apCost: 4, damage: 20, chargeGain: 2, attackDownFlat: 2, attackDownTurns: 1 },
                ],
                special: { name: 'Forja', emoji: '⚒️', apCost: 6, damage: 36, chargeRequired: 3, heal: 3 },
            },
            4: {
                basic: [
                    { name: 'Golpe Ardiente', emoji: '🔥', apCost: 3, damage: 19, chargeGain: 1, burn: { dmg: 1, turns: 2 } },
                    { name: 'Golpe de Fragua', emoji: '⚒️', apCost: 4, damage: 23, chargeGain: 2, heal: 2, burn: { dmg: 1, turns: 2 } },
                ],
                special: { name: 'Fragua Ardiente', emoji: '🔥', apCost: 6, damage: 46, chargeRequired: 4, heal: 5 },
            },
            5: {
                basic: [
                    { name: 'Golpe Mágico', emoji: '✨', apCost: 3, damage: 22, chargeGain: 1, penetratePercent: 0.10 },
                    { name: 'Golpe Potente', emoji: '💪', apCost: 4, damage: 26, chargeGain: 2, heal: 3 },
                ],
                special: { name: 'Encantamiento', emoji: '✨', apCost: 6, damage: 51, chargeRequired: 4, heal: 6 },
            },
            6: {
                basic: [
                    { name: 'Golpe Divino', emoji: '🌟', apCost: 3, damage: 25, chargeGain: 1, heal: 3 },
                    { name: 'Golpe Celestial', emoji: '🌟', apCost: 4, damage: 29, chargeGain: 2, heal: 4 },
                ],
                special: { name: 'Bendición', emoji: '🙏', apCost: 6, damage: 56, chargeRequired: 5, heal: 8 },
            },
            7: {
                basic: [
                    { name: 'Golpe Perfecto', emoji: '🔨', apCost: 3, damage: 28, chargeGain: 1, heal: 3, critChance: 0.10, critMultiplier: 1.5 },
                    { name: 'Golpe Supremo', emoji: '💪', apCost: 4, damage: 32, chargeGain: 2, heal: 4, critChance: 0.10, critMultiplier: 1.5 },
                ],
                special: { name: 'Creación', emoji: '✨', apCost: 6, damage: 61, chargeRequired: 5, heal: 10, critChance: 0.20, critMultiplier: 2 },
            },
        },
    },

    // ===== SEGADOR (Azada) =====
    segador: {
        tiers: {
            1: {
                basic: [
                    { name: 'Cortadura', emoji: '🌾', apCost: 3, damage: 9, chargeGain: 1 },
                    { name: 'Barrida', emoji: '🌊', apCost: 4, damage: 12, aoe: true, chargeGain: 2 },
                ],
                special: { name: 'Siega', emoji: '💀', apCost: 6, damage: 24, chargeRequired: 3 },
            },
            2: {
                basic: [
                    { name: 'Cortadura', emoji: '🌾', apCost: 3, damage: 12, chargeGain: 1 },
                    { name: 'Barrida', emoji: '🌊', apCost: 4, damage: 15, aoe: true, chargeGain: 2 },
                ],
                special: { name: 'Siega', emoji: '💀', apCost: 6, damage: 29, chargeRequired: 3 },
            },
            3: {
                basic: [
                    { name: 'Cortadura', emoji: '🌾', apCost: 3, damage: 15, chargeGain: 1 },
                    { name: 'Barrida', emoji: '🌊', apCost: 4, damage: 18, aoe: true, chargeGain: 2 },
                ],
                special: { name: 'Siega', emoji: '💀', apCost: 6, damage: 34, chargeRequired: 3 },
            },
            4: {
                basic: [
                    { name: 'Cortadura Ardiente', emoji: '🔥', apCost: 3, damage: 18, chargeGain: 1, burn: { dmg: 1, turns: 2 } },
                    { name: 'Barrida Infernal', emoji: '🔥', apCost: 4, damage: 21, aoe: true, chargeGain: 2, burn: { dmg: 1, turns: 2 } },
                ],
                special: { name: 'Cosecha de Fuego', emoji: '🔥', apCost: 6, damage: 44, aoe: true, chargeRequired: 4 },
            },
            5: {
                basic: [
                    { name: 'Cortadura Mágica', emoji: '✨', apCost: 3, damage: 21, chargeGain: 1 },
                    { name: 'Barrida Mágica', emoji: '✨', apCost: 4, damage: 24, aoe: true, chargeGain: 2 },
                ],
                special: { name: 'Cosecha Mágica', emoji: '✨', apCost: 6, damage: 49, chargeRequired: 4 },
            },
            6: {
                basic: [
                    { name: 'Cortadura Celestial', emoji: '🌟', apCost: 3, damage: 24, chargeGain: 1 },
                    { name: 'Barrida Celestial', emoji: '🌟', apCost: 4, damage: 27, aoe: true, chargeGain: 2 },
                ],
                special: { name: 'Cosecha Celestial', emoji: '🌟', apCost: 6, damage: 54, chargeRequired: 5 },
            },
            7: {
                basic: [
                    { name: 'Cortadura Perfecta', emoji: '🌾', apCost: 3, damage: 27, chargeGain: 1, critChance: 0.10, critMultiplier: 1.5 },
                    { name: 'Barrida Perfecta', emoji: '🌊', apCost: 4, damage: 30, aoe: true, chargeGain: 2, critChance: 0.10, critMultiplier: 1.5 },
                ],
                special: { name: 'Cosecha del Destino', emoji: '💫', apCost: 6, damage: 59, aoe: true, chargeRequired: 5, critChance: 0.20, critMultiplier: 2 },
            },
        },
    },

    // ===== MAGO (Báculo) =====
    // Ataque 1 (Misil Mágico) otorga carga de AMPLIFICACIÓN ARCANA (máx 3);
    // cada carga suma +25% daño y una probabilidad (20%/carga) de rebotar a
    // enemigos cercanos adicionales. Ataque 2 (Cometa Arcano) consume TODAS
    // las cargas: rebote GARANTIADO a N enemigos (ver playerAttackWithAP).
    // Ataque 3 sin cambios.
    mago: {
        tiers: {
            1: {
                basic: [
                    { name: 'Misil Mágico', emoji: '✨', apCost: 3, damage: 9, chargeGain: 1, grantsClassCharge: true },
                    { name: 'Cometa Arcano', emoji: '☄️', apCost: 4, damage: 13, chargeGain: 2, consumesClassCharge: true },
                ],
                special: { name: 'Explosión Arcana', emoji: '💥', apCost: 6, damage: 24, aoe: true, chargeRequired: 3 },
            },
            2: {
                basic: [
                    { name: 'Misil Mágico', emoji: '✨', apCost: 3, damage: 12, chargeGain: 1, grantsClassCharge: true },
                    { name: 'Cometa Arcano', emoji: '☄️', apCost: 4, damage: 16, chargeGain: 2, consumesClassCharge: true },
                ],
                special: { name: 'Tormenta Mágica', emoji: '🌩️', apCost: 6, damage: 29, hits: 2, chargeRequired: 3 },
            },
            3: {
                basic: [
                    { name: 'Misil Mágico', emoji: '✨', apCost: 3, damage: 15, chargeGain: 1, grantsClassCharge: true },
                    { name: 'Cometa Arcano', emoji: '☄️', apCost: 4, damage: 19, chargeGain: 2, consumesClassCharge: true },
                ],
                special: { name: 'Vórtice Arcano', emoji: '🌀', apCost: 6, damage: 34, aoe: true, chargeRequired: 3, defenseDownPercent: 0.3, defenseDownTurns: 1 },
            },
            4: {
                basic: [
                    { name: 'Misil Mágico', emoji: '✨', apCost: 3, damage: 18, chargeGain: 1, grantsClassCharge: true },
                    { name: 'Cometa Arcano', emoji: '☄️', apCost: 4, damage: 22, chargeGain: 2, consumesClassCharge: true },
                ],
                special: { name: 'Infierno Abismal', emoji: '🌋', apCost: 6, damage: 44, aoe: true, chargeRequired: 4, burn: { dmg: 3, turns: 3 } },
            },
            5: {
                basic: [
                    { name: 'Misil Mágico', emoji: '✨', apCost: 3, damage: 21, chargeGain: 1, grantsClassCharge: true },
                    { name: 'Cometa Arcano', emoji: '☄️', apCost: 4, damage: 25, chargeGain: 2, consumesClassCharge: true },
                ],
                special: { name: 'Lluvia de Estrellas', emoji: '🌠', apCost: 6, damage: 49, aoe: true, hits: 3, chargeRequired: 4 },
            },
            6: {
                basic: [
                    { name: 'Misil Mágico', emoji: '✨', apCost: 3, damage: 24, chargeGain: 1, grantsClassCharge: true },
                    { name: 'Cometa Arcano', emoji: '☄️', apCost: 4, damage: 28, chargeGain: 2, consumesClassCharge: true },
                ],
                special: { name: 'Ascensión Divina', emoji: '🕊️', apCost: 6, damage: 54, aoe: true, chargeRequired: 5, heal: 5 },
            },
            7: {
                basic: [
                    { name: 'Misil Mágico', emoji: '✨', apCost: 3, damage: 27, chargeGain: 1, grantsClassCharge: true },
                    { name: 'Cometa Arcano', emoji: '☄️', apCost: 4, damage: 31, chargeGain: 2, consumesClassCharge: true },
                ],
                special: { name: 'Singularidad Arcana', emoji: '🕳️', apCost: 6, damage: 59, aoe: true, chargeRequired: 5, critChance: 0.25, critMultiplier: 2 },
            },
        },
    },

    // ===== TANQUE (Espada y Escudo) =====
    tanque: {
        tiers: {
            1: {
                basic: [
                    { name: 'Espadazo', emoji: '🗡️', apCost: 3, damage: 7, chargeGain: 1 },
                    { name: 'Golpe de Escudo', emoji: '🛡️', apCost: 4, damage: 10, chargeGain: 2 },
                ],
                special: { name: 'Embestida', emoji: '💥', apCost: 6, damage: 15, chargeRequired: 3 },
            },
            2: {
                basic: [
                    { name: 'Espadazo', emoji: '🗡️', apCost: 3, damage: 9, chargeGain: 1 },
                    { name: 'Golpe de Escudo', emoji: '🛡️', apCost: 4, damage: 14, chargeGain: 2 },
                ],
                special: { name: 'Embestida', emoji: '💥', apCost: 6, damage: 20, chargeRequired: 3 },
            },
            3: {
                basic: [
                    { name: 'Espadazo', emoji: '🗡️', apCost: 3, damage: 12, chargeGain: 1 },
                    { name: 'Golpe de Escudo', emoji: '🛡️', apCost: 4, damage: 18, chargeGain: 2 },
                ],
                special: { name: 'Embestida', emoji: '💥', apCost: 6, damage: 26, chargeRequired: 3 },
            },
            4: {
                basic: [
                    { name: 'Espadazo Infernal', emoji: '🔥', apCost: 3, damage: 15, chargeGain: 1, burn: { dmg: 1, turns: 2 } },
                    { name: 'Golpe de Escudo Infernal', emoji: '🔥', apCost: 4, damage: 22, chargeGain: 2, burn: { dmg: 1, turns: 2 } },
                ],
                special: { name: 'Embestida Ígnea', emoji: '🌋', apCost: 6, damage: 33, chargeRequired: 4, burn: { dmg: 2, turns: 3 } },
            },
            5: {
                basic: [
                    { name: 'Espadazo Mithril', emoji: '✨', apCost: 3, damage: 19, chargeGain: 1 },
                    { name: 'Golpe de Escudo Mithril', emoji: '✨', apCost: 4, damage: 28, chargeGain: 2 },
                ],
                special: { name: 'Embestida Radiante', emoji: '⚡', apCost: 6, damage: 41, chargeRequired: 4, defenseDownFlat: 1.5, defenseDownTurns: 1 },
            },
            6: {
                basic: [
                    { name: 'Espadazo Celestial', emoji: '🌟', apCost: 3, damage: 24, chargeGain: 1, heal: 2 },
                    { name: 'Golpe de Escudo Celestial', emoji: '🌟', apCost: 4, damage: 34, chargeGain: 2, heal: 3 },
                ],
                special: { name: 'Embestida Celestial', emoji: '🌠', apCost: 6, damage: 51, chargeRequired: 5, heal: 5 },
            },
            7: {
                basic: [
                    { name: 'Espadazo Perfecto', emoji: '🗡️', apCost: 3, damage: 29, chargeGain: 1, critChance: 0.10, critMultiplier: 1.5 },
                    { name: 'Golpe de Escudo Perfecto', emoji: '🛡️', apCost: 4, damage: 42, chargeGain: 2, critChance: 0.10, critMultiplier: 1.5 },
                ],
                special: { name: 'Embestida del Destino', emoji: '☄️', apCost: 6, damage: 63, chargeRequired: 5, critChance: 0.20, critMultiplier: 2 },
            },
        },
    },

    // ===== DESARMADO (sin ninguna arma equipada) =====
    desarmado: {
        tiers: {
            1: {
                basic: [
                    { name: 'Golpe', emoji: '👊', apCost: 3, damage: 6, chargeGain: 1 },
                    { name: 'Patada', emoji: '🦵', apCost: 4, damage: 9, chargeGain: 2 },
                ],
                special: { name: 'Cabezazo', emoji: '🤕', apCost: 6, damage: 18, chargeRequired: 3 },
            },
            2: {
                basic: [
                    { name: 'Golpe', emoji: '👊', apCost: 3, damage: 8, chargeGain: 1 },
                    { name: 'Patada', emoji: '🦵', apCost: 4, damage: 12, chargeGain: 2 },
                ],
                special: { name: 'Cabezazo', emoji: '🤕', apCost: 6, damage: 24, chargeRequired: 3 },
            },
            3: {
                basic: [
                    { name: 'Golpe', emoji: '👊', apCost: 3, damage: 11, chargeGain: 1 },
                    { name: 'Patada', emoji: '🦵', apCost: 4, damage: 16, chargeGain: 2 },
                ],
                special: { name: 'Cabezazo', emoji: '🤕', apCost: 6, damage: 32, chargeRequired: 3 },
            },
            4: {
                basic: [
                    { name: 'Golpe', emoji: '👊', apCost: 3, damage: 13, chargeGain: 1 },
                    { name: 'Patada', emoji: '🦵', apCost: 4, damage: 20, chargeGain: 2 },
                ],
                special: { name: 'Cabezazo', emoji: '🤕', apCost: 6, damage: 40, chargeRequired: 3 },
            },
            5: {
                basic: [
                    { name: 'Golpe', emoji: '👊', apCost: 3, damage: 17, chargeGain: 1 },
                    { name: 'Patada', emoji: '🦵', apCost: 4, damage: 25, chargeGain: 2 },
                ],
                special: { name: 'Cabezazo', emoji: '🤕', apCost: 6, damage: 50, chargeRequired: 3 },
            },
            6: {
                basic: [
                    { name: 'Golpe', emoji: '👊', apCost: 3, damage: 20, chargeGain: 1 },
                    { name: 'Patada', emoji: '🦵', apCost: 4, damage: 31, chargeGain: 2 },
                ],
                special: { name: 'Cabezazo', emoji: '🤕', apCost: 6, damage: 61, chargeRequired: 3 },
            },
            7: {
                basic: [
                    { name: 'Golpe', emoji: '👊', apCost: 3, damage: 25, chargeGain: 1 },
                    { name: 'Patada', emoji: '🦵', apCost: 4, damage: 38, chargeGain: 2 },
                ],
                special: { name: 'Cabezazo', emoji: '🤕', apCost: 6, damage: 76, chargeRequired: 3 },
            },
        },
    },
};

// Devuelve { basic: [ataque1, ataque2], special } para un tier concreto (1-7)
// de esa profesión, o null si esa profesión todavía no usa el sistema de
// PA/carga (Tanque, por ahora, sigue con el sistema genérico).
function getWeaponAttacksForTier(profId, tierId) {
    const set = WEAPON_ATTACKS[profId];
    if (!set) return null;
    return set.tiers[tierId] || set.tiers[1];
}

// Devuelve el set de ataques para la profesión/nivel actuales (deriva el
// tier del nivel de la profesión).
function resolveWeaponAttacks(profId, level) {
    return getWeaponAttacksForTier(profId, getTierForLevel(level).id);
}

// Clona un set de ataques {basic, special} multiplicando el daño (y curación/
// golpe extra) por `mult`. Usado para aplicar el bono de rareza de un objeto
// crafteado sobre los ataques base de su tier.
function scaleAttacksByMult(attackSet, mult) {
    if (!attackSet || mult === 1) return attackSet;
    const scaleOne = atk => {
        const clone = { ...atk };
        clone.damage = Math.round(atk.damage * mult * 10) / 10;
        if (atk.heal) clone.heal = Math.round(atk.heal * mult * 10) / 10;
        if (atk.extraRandomHit) clone.extraRandomHit = { ...atk.extraRandomHit, damage: Math.round(atk.extraRandomHit.damage * mult * 10) / 10 };
        return clone;
    };
    return { basic: attackSet.basic.map(scaleOne), special: scaleOne(attackSet.special) };
}
