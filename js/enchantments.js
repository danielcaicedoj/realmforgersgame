// ===== SISTEMA DE ENCANTAMIENTOS =====
// 28 encantamientos (7 generales, aplicables a cualquier arma de combate
// crafteada + 3 específicos por cada una de las 7 categorías de arma), cada
// uno con hasta 4 niveles. Solo se pueden encantar ARMAS CRAFTEADAS (el
// arma "automática" por nivel no tiene Rareza propia, ver player.js), y el
// Tanque solo tiene acceso a los 7 generales (no hay categoría específica
// de escudo en este sistema). El Desarmado nunca es un objeto crafteado,
// así que no se puede encantar.
//
// NOTA DE IMPLEMENTACIÓN — motor de efectos genérico: en vez de programar
// una mecánica de combate distinta y aislada para cada uno de los 34
// encantamientos (algunos de los cuales piden máquinas de estado complejas:
// contadores que se acumulan y decaen turno a turno, habilidades con
// enfriamiento, escudos que se regeneran, detectar "tu segundo ataque del
// combo"), cada nivel se define con un objeto `effects` que combina un
// pequeño vocabulario de primitivas reutilizables (dmgBonusPercent, burn,
// bleed, defenseDownOnHit, chain, aoeAll, extraAttacks, lifestealPercent,
// critChanceBonus, etc. — ver combat.js: getActiveEnchantEffects/
// applyEnchantEffectsToAttack). Esto mantiene el texto/costo/nivel de cada
// encantamiento fiel al diseño, y su efecto numérico fiel al valor descrito,
// aunque algunas mecánicas muy específicas (acumulación por turnos con
// decaimiento, recarga por turnos, escudos regenerables) se aproximan a su
// equivalente numérico más cercano dentro de ese vocabulario en vez de
// simularse turno a turno con total fidelidad.

// ----- COSTO DE ENCANTAMIENTO POR RAREZA DEL ARMA -----
// Índice 0-3 = nivel 1-4. Los núcleos deben ser de la Rareza del arma y de
// Tier igual o superior al Tier del arma (ver isNucleoCompatibleConArma).
const ENCHANT_COST_TABLE = {
    comun:      [10, 20, 40, 80],
    poco_comun: [10, 20, 40, 80],
    raro:       [10, 20, 40, 80],
    epico:      [5, 10, 20, 40],
    legendario: [5, 10, 20, 40],
    mitico:     [3, 6, 12, 24],
};
function getEnchantCost(rarityId, level) {
    const table = ENCHANT_COST_TABLE[rarityId] || ENCHANT_COST_TABLE.comun;
    return table[level - 1];
}

// El núcleo debe ser de la MISMA Rareza que el arma, y de Tier >= al Tier
// del arma (a Tier 10 solo sirven núcleos Tier 10, ya que no hay superior).
function isNucleoCompatibleConArma(nucleoRarityId, nucleoTierId, armaRarityId, armaTierId) {
    return nucleoRarityId === armaRarityId && nucleoTierId >= armaTierId;
}

// ----- 7 ENCANTAMIENTOS GENERALES (cualquier arma) -----
const ENCHANTS_GENERAL = [
    {
        id: 'fuego', name: 'Fuego', emoji: '🔥', maxLevel: 4,
        levels: [
            { desc: 'Tus ataques causan quemadura (1 daño/turno x 2 turnos)', effects: { burn: { dmg: 1, turns: 2, chance: 1 } } },
            { desc: 'Quemadura más fuerte (2 daño/turno x 3 turnos)', effects: { burn: { dmg: 2, turns: 3, chance: 1 } } },
            { desc: 'Quemadura intensa (3 daño/turno x 4 turnos)', effects: { burn: { dmg: 3, turns: 4, chance: 1 } } },
            { desc: 'Infierno total (4 daño/turno x 5 turnos + 10% daño extra al impacto)', effects: { burn: { dmg: 4, turns: 5, chance: 1 }, dmgBonusPercent: 0.10 } },
        ],
    },
    {
        id: 'hielo', name: 'Hielo', emoji: '❄️', maxLevel: 4,
        levels: [
            { desc: 'Tus ataques reducen defensa enemiga (10% menos defensa x 2 turnos)', effects: { defenseDownOnHit: { percent: 0.10, turns: 2, chance: 1 } } },
            { desc: 'Reducción de defensa más fuerte (15% menos defensa x 3 turnos)', effects: { defenseDownOnHit: { percent: 0.15, turns: 3, chance: 1 } } },
            { desc: 'Defensa quebrada (20% menos defensa x 4 turnos)', effects: { defenseDownOnHit: { percent: 0.20, turns: 4, chance: 1 } } },
            { desc: 'Defensa aniquilada (25% menos defensa x 5 turnos + 5% daño directo adicional)', effects: { defenseDownOnHit: { percent: 0.25, turns: 5, chance: 1 }, dmgBonusPercent: 0.05 } },
        ],
    },
    {
        id: 'rayo', name: 'Rayo', emoji: '⚡', maxLevel: 4,
        levels: [
            { desc: 'Tus ataques saltan a +1 enemigo cercano (distribuye 30% del daño)', effects: { chain: { chance: 1, count: 1, damagePercent: 0.30 } } },
            { desc: 'Saltan a +2 enemigos (distribuye 40% del daño a cada uno)', effects: { chain: { chance: 1, count: 2, damagePercent: 0.40 } } },
            { desc: 'Saltan a +3 enemigos (distribuye 50% del daño a cada uno)', effects: { chain: { chance: 1, count: 3, damagePercent: 0.50 } } },
            { desc: 'Saltan a +4 enemigos (distribuye 60% del daño a cada uno)', effects: { chain: { chance: 1, count: 4, damagePercent: 0.60 } } },
        ],
    },
    {
        id: 'veneno', name: 'Veneno', emoji: '💚', maxLevel: 4,
        levels: [
            { desc: 'Tus ataques envenenan (1 daño/turno x 3 turnos)', effects: { bleed: { dmg: 1, turns: 3, chance: 1 } } },
            { desc: 'Veneno potente (2 daño/turno x 4 turnos)', effects: { bleed: { dmg: 2, turns: 4, chance: 1 } } },
            { desc: 'Veneno letal (3 daño/turno x 5 turnos + reduce daño enemigo 5%)', effects: { bleed: { dmg: 3, turns: 5, chance: 1 }, enemyDmgDownOnHit: { percent: 0.05, turns: 2, chance: 1 } } },
            { desc: 'Veneno supremo (4 daño/turno x 6 turnos + reduce daño enemigo 15%)', effects: { bleed: { dmg: 4, turns: 6, chance: 1 }, enemyDmgDownOnHit: { percent: 0.15, turns: 2, chance: 1 } } },
        ],
    },
    {
        id: 'filo', name: 'Filo / Afilado', emoji: '💪', maxLevel: 4,
        levels: [
            { desc: '+10% daño total', effects: { dmgBonusPercent: 0.10 } },
            { desc: '+20% daño total', effects: { dmgBonusPercent: 0.20 } },
            { desc: '+30% daño total + ignora 5% defensa', effects: { dmgBonusPercent: 0.30, ignoreDefensePercent: 0.05 } },
            { desc: '+40% daño total + ignora 10% defensa', effects: { dmgBonusPercent: 0.40, ignoreDefensePercent: 0.10 } },
        ],
    },
    {
        id: 'vampirismo', name: 'Robo de Vida / Vampirismo', emoji: '✨', maxLevel: 4,
        levels: [
            { desc: 'Restauras 5% del daño causado como HP', effects: { lifestealPercent: 0.05 } },
            { desc: 'Restauras 10% del daño causado como HP', effects: { lifestealPercent: 0.10 } },
            { desc: 'Restauras 15% del daño causado como HP + debilita enemigo', effects: { lifestealPercent: 0.15, enemyDmgDownOnHit: { percent: 0.05, turns: 2, chance: 1 } } },
            { desc: 'Restauras 20% del daño causado como HP + debilita enemigo significativamente', effects: { lifestealPercent: 0.20, enemyDmgDownOnHit: { percent: 0.10, turns: 2, chance: 1 } } },
        ],
    },
    {
        id: 'precision', name: 'Precisión', emoji: '🎯', maxLevel: 4,
        levels: [
            { desc: '+10% crítico', effects: { critChanceBonus: 0.10 } },
            { desc: '+20% crítico', effects: { critChanceBonus: 0.20 } },
            { desc: '+30% crítico + críticos hacen 150% daño', effects: { critChanceBonus: 0.30, critMultiplier: 1.5 } },
            { desc: '+40% crítico + críticos hacen 175% daño + restaura 1 HP por crítico', effects: { critChanceBonus: 0.40, critMultiplier: 1.75, onCritHeal: 1 } },
        ],
    },
];

// ----- 27 ENCANTAMIENTOS ESPECÍFICOS (3 por categoría x 9 categorías) -----
const ENCHANTS_SPECIFIC = {
    daga: [
        {
            id: 'contraataque_mortal', name: 'Contrataque Mortal', emoji: '⚔️', maxLevel: 3,
            levels: [
                { desc: 'Cuando recibes daño, 10% chance de contraatacar (50% daño)', effects: { counterChance: 0.10, counterDamagePercent: 0.50 } },
                { desc: '15% chance de contraatacar (75% daño)', effects: { counterChance: 0.15, counterDamagePercent: 0.75 } },
                { desc: '20% chance de contraatacar (100% daño + ignora 10% defensa)', effects: { counterChance: 0.20, counterDamagePercent: 1.0, counterIgnoreDefensePercent: 0.10 } },
            ],
        },
        {
            id: 'sed_de_sangre', name: 'Sed de Sangre', emoji: '🩸', maxLevel: 4,
            levels: [
                { desc: 'Cada golpe crítico aumenta tu daño en 5% (acumula hasta 5 veces, durará 2 turnos)', effects: { dmgBonusPercent: 0.08 } },
                { desc: 'Cada golpe crítico aumenta tu daño en 7% (acumula hasta 7 veces, durará 2 turnos)', effects: { dmgBonusPercent: 0.12 } },
                { desc: 'Cada golpe crítico aumenta tu daño en 10% (acumula hasta 10 veces, durará 3 turnos + restaura 2 HP)', effects: { dmgBonusPercent: 0.18, onHitHeal: 2 } },
                { desc: 'Cada golpe crítico aumenta tu daño en 12% (acumula hasta 15 veces, durará 3 turnos + restaura 3 HP + próximo crítico 100% asegurado)', effects: { dmgBonusPercent: 0.25, onHitHeal: 3, critChanceBonus: 0.15 } },
            ],
        },
        {
            id: 'tormenta_cortante', name: 'Tormenta Cortante', emoji: '🌪️', maxLevel: 3,
            levels: [
                { desc: '15% chance de generar una onda de choque que golpea +1 enemigo cercano (80% daño)', effects: { chain: { chance: 0.15, count: 1, damagePercent: 0.80 } } },
                { desc: '20% chance, golpea +2 enemigos cercanos (100% daño cada uno)', effects: { chain: { chance: 0.20, count: 2, damagePercent: 1.0 } } },
                { desc: '25% chance, golpea +3 enemigos cercanos (120% daño) + reduce defensa de todos por 1 turno', effects: { chain: { chance: 0.25, count: 3, damagePercent: 1.2 }, defenseDownOnHit: { percent: 0.10, turns: 1, chance: 1 } } },
            ],
        },
    ],
    claymore: [
        {
            id: 'golpe_devastador', name: 'Golpe Devastador', emoji: '💥', maxLevel: 3,
            levels: [
                { desc: 'Tu segundo ataque en combo hace 150% daño', effects: { secondAttackBonusPercent: 0.50 } },
                { desc: 'Tu segundo ataque hace 180% daño + reduce defensa enemiga', effects: { secondAttackBonusPercent: 0.80, defenseDownOnHit: { percent: 0.10, turns: 1, chance: 1 } } },
                { desc: 'Tu segundo ataque hace 200% daño + reduce defensa enemiga fuertemente + ignora 10% defensa', effects: { secondAttackBonusPercent: 1.0, defenseDownOnHit: { percent: 0.15, turns: 1, chance: 1 }, ignoreDefensePercent: 0.10 } },
            ],
        },
        {
            id: 'terremoto', name: 'Terremoto', emoji: '🌍', maxLevel: 4,
            levels: [
                { desc: '20% chance de crear terremoto (golpea todos los enemigos en 120% daño)', effects: { aoeAll: { chance: 0.20, damagePercent: 1.2 } } },
                { desc: '25% chance, terremoto hace 150% daño a todos', effects: { aoeAll: { chance: 0.25, damagePercent: 1.5 } } },
                { desc: '30% chance, terremoto hace 180% daño + reduce defensa a todos por 1 turno', effects: { aoeAll: { chance: 0.30, damagePercent: 1.8 }, defenseDownOnHit: { percent: 0.10, turns: 1, chance: 1 } } },
                { desc: '35% chance, terremoto hace 200% daño + reduce defensa y daño de todos por 2 turnos', effects: { aoeAll: { chance: 0.35, damagePercent: 2.0 }, defenseDownOnHit: { percent: 0.15, turns: 2, chance: 1 }, enemyDmgDownOnHit: { percent: 0.10, turns: 2, chance: 1 } } },
            ],
        },
        {
            id: 'fortaleza_marcial', name: 'Fortaleza Marcial', emoji: '🛡️', maxLevel: 3,
            levels: [
                { desc: '+5 defensa mientras el arma está equipada', effects: { flatDefenseBonus: 5 } },
                { desc: '+10 defensa + cada ataque aumenta tu defensa en 2% (acumula hasta 5 veces, durará 2 turnos)', effects: { flatDefenseBonus: 10 } },
                { desc: '+15 defensa + cada ataque aumenta tu defensa en 3% (acumula hasta 8 veces, durará 3 turnos) + absorbe 10% del daño en escudo', effects: { flatDefenseBonus: 15, damageReducePercent: 0.10 } },
            ],
        },
    ],
    arco: [
        {
            id: 'lluvia_de_flechas', name: 'Lluvia de Flechas', emoji: '🎯', maxLevel: 4,
            levels: [
                { desc: '20% chance de disparar 2 flechas extras (80% daño cada una)', effects: { extraAttacks: { chance: 0.20, count: 2, damagePercent: 0.80 } } },
                { desc: '25% chance de 3 flechas extras (100% daño cada una)', effects: { extraAttacks: { chance: 0.25, count: 3, damagePercent: 1.0 } } },
                { desc: '30% chance de 4 flechas extras (120% daño) + golpea AoE', effects: { extraAttacks: { chance: 0.30, count: 4, damagePercent: 1.2 }, aoeAll: { chance: 0.30, damagePercent: 0.50 } } },
                { desc: '35% chance de 5 flechas extras (150% daño) + golpea AoE + todos los enemigos cercanos toman daño', effects: { extraAttacks: { chance: 0.35, count: 5, damagePercent: 1.5 }, aoeAll: { chance: 0.35, damagePercent: 0.75 } } },
            ],
        },
        {
            id: 'flecha_certera', name: 'Flecha Certera', emoji: '📍', maxLevel: 3,
            levels: [
                { desc: 'Tus flechas nunca fallan + ignoras 10% defensa', effects: { ignoreDefensePercent: 0.10 } },
                { desc: 'Ignoras 20% defensa + cada flecha restaura 1 HP', effects: { ignoreDefensePercent: 0.20, onHitHeal: 1 } },
                { desc: 'Ignoras 30% defensa + cada flecha restaura 2 HP + 10% chance de penetrar (golpea 2 enemigos)', effects: { ignoreDefensePercent: 0.30, onHitHeal: 2, chain: { chance: 0.10, count: 1, damagePercent: 1.0 } } },
            ],
        },
        {
            id: 'velocidad_del_arco', name: 'Velocidad del Arco', emoji: '💨', maxLevel: 4,
            levels: [
                { desc: '+20% daño por ataque', effects: { dmgBonusPercent: 0.20 } },
                { desc: '+35% daño por ataque + -1 costo PA', effects: { dmgBonusPercent: 0.35, apCostReduction: 1 } },
                { desc: '+50% daño por ataque + -2 costo PA + aumenta crítico en 10%', effects: { dmgBonusPercent: 0.50, apCostReduction: 2, critChanceBonus: 0.10 } },
                { desc: '+65% daño por ataque + -3 costo PA + aumenta crítico en 20% + cada ataque restaura 1 PA', effects: { dmgBonusPercent: 0.65, apCostReduction: 3, critChanceBonus: 0.20, paRestoreOnHit: 1 } },
            ],
        },
    ],
    hacha: [
        {
            id: 'sangria_mortal', name: 'Sangría Mortal', emoji: '🔪', maxLevel: 4,
            levels: [
                { desc: 'Tus ataques causan sangría (3 daño/turno x 3 turnos)', effects: { bleed: { dmg: 3, turns: 3, chance: 1 } } },
                { desc: 'Sangría más fuerte (5 daño/turno x 4 turnos)', effects: { bleed: { dmg: 5, turns: 4, chance: 1 } } },
                { desc: 'Sangría severa (7 daño/turno x 5 turnos + acumula con más ataques)', effects: { bleed: { dmg: 7, turns: 5, chance: 1 } } },
                { desc: 'Sangría letal (10 daño/turno x 6 turnos + reabre heridas previas + 100% acumula + reduce defensa)', effects: { bleed: { dmg: 10, turns: 6, chance: 1 }, defenseDownOnHit: { percent: 0.10, turns: 2, chance: 1 } } },
            ],
        },
        {
            id: 'remolino_destructivo', name: 'Remolino Destructivo', emoji: '🌪️', maxLevel: 3,
            levels: [
                { desc: '20% chance de hacer ataque AoE a todos (120% daño)', effects: { aoeAll: { chance: 0.20, damagePercent: 1.2 } } },
                { desc: '25% chance de AoE (150% daño) + reduce defensa a todos', effects: { aoeAll: { chance: 0.25, damagePercent: 1.5 }, defenseDownOnHit: { percent: 0.10, turns: 1, chance: 1 } } },
                { desc: '30% chance de AoE (180% daño) + reduce defensa y daño de todos por 2 turnos', effects: { aoeAll: { chance: 0.30, damagePercent: 1.8 }, defenseDownOnHit: { percent: 0.15, turns: 2, chance: 1 }, enemyDmgDownOnHit: { percent: 0.10, turns: 2, chance: 1 } } },
            ],
        },
        {
            id: 'furia_desatada', name: 'Furia Desatada', emoji: '💢', maxLevel: 4,
            levels: [
                { desc: 'Cada ataque aumenta tu daño en 5% (acumula hasta 5 veces, durará 2 turnos)', effects: { dmgBonusPercent: 0.10 } },
                { desc: 'Cada ataque aumenta tu daño en 7% (acumula hasta 8 veces, durará 2 turnos + restaura 1 HP)', effects: { dmgBonusPercent: 0.16, onHitHeal: 1 } },
                { desc: 'Cada ataque aumenta tu daño en 10% (acumula hasta 12 veces, durará 3 turnos + restaura 2 HP + defensa reducida)', effects: { dmgBonusPercent: 0.24, onHitHeal: 2, defenseDownOnHit: { percent: 0.05, turns: 1, chance: 0.3 } } },
                { desc: 'Cada ataque aumenta tu daño en 12% (acumula hasta 15 veces, durará 3 turnos + restaura 3 HP + al alcanzar 10 acumulaciones: daño +25% adicional por 1 turno)', effects: { dmgBonusPercent: 0.32, onHitHeal: 3 } },
            ],
        },
    ],
    martillo: [
        {
            id: 'reparacion_divina', name: 'Reparación Divina', emoji: '🔧', maxLevel: 3,
            levels: [
                { desc: 'Restauras 5 HP por golpe a ti mismo', effects: { onHitHeal: 5 } },
                { desc: 'Restauras 8 HP por golpe + curas debuffs cada 3 ataques', effects: { onHitHeal: 8 } },
                { desc: 'Restauras 10 HP por golpe + curas todos los debuffs + escudo absorbente (absorbe daño)', effects: { onHitHeal: 10, damageReducePercent: 0.10 } },
            ],
        },
        {
            id: 'forja_magica', name: 'Forja Mágica', emoji: '🌟', maxLevel: 3,
            levels: [
                { desc: 'Tu siguiente ataque hace 130% daño (recarga cada 3 turnos)', effects: { dmgBonusPercent: 0.10 } },
                { desc: 'Siguiente ataque 160% daño (recarga cada 2 turnos + ilumina aumentando crítico)', effects: { dmgBonusPercent: 0.20, critChanceBonus: 0.10 } },
                { desc: 'Siguiente ataque 200% daño (recarga cada turno + ilumina + +2 PA siguiente turno)', effects: { dmgBonusPercent: 0.35, critChanceBonus: 0.15, paRestoreOnHit: 1 } },
            ],
        },
        {
            id: 'choque_magnetico', name: 'Choque Magnético', emoji: '⚡', maxLevel: 3,
            levels: [
                { desc: '15% chance de generar escudo magnético (+5 defensa x 2 turnos)', effects: { flatDefenseBonus: 3 } },
                { desc: '20% chance de escudo más fuerte (+10 defensa x 3 turnos + refleja daño)', effects: { flatDefenseBonus: 6, counterChance: 0.10, counterDamagePercent: 0.20 } },
                { desc: '25% chance de escudo supremo (+15 defensa x 4 turnos + refleja 20% del daño + aumenta defensa de aliados)', effects: { flatDefenseBonus: 9, counterChance: 0.15, counterDamagePercent: 0.30 } },
            ],
        },
    ],
    azada: [
        {
            id: 'cosecha_abundante', name: 'Cosecha Abundante', emoji: '🌾', maxLevel: 4,
            levels: [
                { desc: '15% chance de golpear +1 enemigo adicional', effects: { chain: { chance: 0.15, count: 1, damagePercent: 1.0 } } },
                { desc: '20% chance de golpear +2 enemigos (100% daño cada uno)', effects: { chain: { chance: 0.20, count: 2, damagePercent: 1.0 } } },
                { desc: '25% chance de golpear +3 enemigos (120% daño) + reduce defensa de todos', effects: { chain: { chance: 0.25, count: 3, damagePercent: 1.2 }, defenseDownOnHit: { percent: 0.10, turns: 1, chance: 1 } } },
                { desc: '30% chance de golpear +4 enemigos (150% daño) + reduce defensa y daño de todos', effects: { chain: { chance: 0.30, count: 4, damagePercent: 1.5 }, defenseDownOnHit: { percent: 0.15, turns: 1, chance: 1 }, enemyDmgDownOnHit: { percent: 0.10, turns: 1, chance: 1 } } },
            ],
        },
        {
            id: 'maldicion_oscura', name: 'Maldición Oscura', emoji: '🌑', maxLevel: 3,
            levels: [
                { desc: '20% chance de maldecir al enemigo (reduce stats en 10% x 2 turnos)', effects: { defenseDownOnHit: { percent: 0.10, turns: 2, chance: 0.20 }, enemyDmgDownOnHit: { percent: 0.10, turns: 2, chance: 0.20 } } },
                { desc: '25% chance de maldición mayor (reduce stats en 15% x 3 turnos + reduce regeneración)', effects: { defenseDownOnHit: { percent: 0.15, turns: 3, chance: 0.25 }, enemyDmgDownOnHit: { percent: 0.15, turns: 3, chance: 0.25 } } },
                { desc: '30% chance de maldición total (reduce stats en 20% x 4 turnos + silencia habilidades especiales + anula bonificaciones)', effects: { defenseDownOnHit: { percent: 0.20, turns: 4, chance: 0.30 }, enemyDmgDownOnHit: { percent: 0.20, turns: 4, chance: 0.30 } } },
            ],
        },
        {
            id: 'bonificacion_multiples', name: 'Bonificación por Múltiples', emoji: '📈', maxLevel: 3,
            levels: [
                { desc: 'Cada enemigo golpeado en combo aumenta daño en 10% (hasta 3)', effects: { dmgBonusPercent: 0.10 } },
                { desc: 'Cada enemigo aumenta daño en 15% (hasta 5)', effects: { dmgBonusPercent: 0.15 } },
                { desc: 'Cada enemigo aumenta daño en 20% (hasta 8) + crítico automático al máximo + restaura 1 PA', effects: { dmgBonusPercent: 0.20, critChanceBonus: 0.15, paRestoreOnHit: 1 } },
            ],
        },
    ],
    baculo: [
        {
            id: 'amplificacion_arcana', name: 'Amplificación Arcana', emoji: '📚', maxLevel: 4,
            levels: [
                { desc: 'Tus hechizos hacen +15% daño', effects: { dmgBonusPercent: 0.15 } },
                { desc: 'Tus hechizos hacen +30% daño + consumen -1 PA', effects: { dmgBonusPercent: 0.30, apCostReduction: 1 } },
                { desc: 'Tus hechizos hacen +50% daño + consumen -2 PA + golpean AoE', effects: { dmgBonusPercent: 0.50, apCostReduction: 2, aoeAll: { chance: 0.25, damagePercent: 0.50 } } },
                { desc: 'Tus hechizos hacen +75% daño + consumen -3 PA + golpean AoE + cada hechizo restaura 2 PA', effects: { dmgBonusPercent: 0.75, apCostReduction: 3, aoeAll: { chance: 0.30, damagePercent: 0.60 }, paRestoreOnHit: 2 } },
            ],
        },
        {
            id: 'magia_encadenada', name: 'Magia Encadenada', emoji: '🌀', maxLevel: 3,
            levels: [
                { desc: '20% chance de que hechizo salta a +1 enemigo (80% daño)', effects: { chain: { chance: 0.20, count: 1, damagePercent: 0.80 } } },
                { desc: '25% chance de salto a +2 enemigos (100% daño)', effects: { chain: { chance: 0.25, count: 2, damagePercent: 1.0 } } },
                { desc: '30% chance de salto a +3 enemigos (120% daño) + cada salto restaura 1 PA', effects: { chain: { chance: 0.30, count: 3, damagePercent: 1.2 }, paRestoreOnHit: 1 } },
            ],
        },
        {
            id: 'escudo_arcano', name: 'Escudo Arcano', emoji: '🔮', maxLevel: 3,
            levels: [
                { desc: 'Creas escudo (absorbe 20% de tu HP máximo)', effects: { flatDefenseBonus: 4 } },
                { desc: 'Escudo más fuerte (absorbe 30% HP máximo + regenera 5% por turno)', effects: { flatDefenseBonus: 8 } },
                { desc: 'Escudo supremo (absorbe 40% HP máximo + regenera 10% por turno + contraataca con magia + reduce daño enemigo)', effects: { flatDefenseBonus: 12, counterChance: 0.10, counterDamagePercent: 0.20 } },
            ],
        },
    ],
};

// profId -> clave de ENCHANTS_SPECIFIC. El Tanque (Espada y Escudo) y el
// Desarmado no tienen categoría específica: el Tanque solo accede a los 7
// generales, y el Desarmado nunca es un objeto crafteado (no se encanta).
const WEAPON_ENCHANT_CATEGORY = {
    picaro: 'daga', guerrero: 'claymore', arquero: 'arco',
    barbaro: 'hacha', herrero: 'martillo', segador: 'azada', mago: 'baculo',
};

// Devuelve { general, specific } para la profesión de un arma crafteada.
function getEnchantmentsForProfession(profId) {
    const category = WEAPON_ENCHANT_CATEGORY[profId];
    return { general: ENCHANTS_GENERAL, specific: category ? (ENCHANTS_SPECIFIC[category] || []) : [] };
}

function findEnchantment(id) {
    const inGeneral = ENCHANTS_GENERAL.find(e => e.id === id);
    if (inGeneral) return inGeneral;
    for (const key in ENCHANTS_SPECIFIC) {
        const found = ENCHANTS_SPECIFIC[key].find(e => e.id === id);
        if (found) return found;
    }
    return null;
}

// ----- DROP DE NÚCLEOS POR PISO -----
// Se reinicia cada 100 pisos (nuevo Tier de material). Dentro de cada Tier,
// 10 "rangos" de 10 pisos: en el rango N se pueden dropear hasta (N-1)
// núcleos adicionales (además del garantizado), cada uno con una
// probabilidad independiente que escala 10%..100% según qué tan adentro del
// rango esté el piso actual (ver rollNucleoDrops).
function calcularProbabilidadNucleoAdicional(numeroPiso) {
    const tierActual = Math.floor((numeroPiso - 1) / 100) + 1;
    const pisoEnTier = ((numeroPiso - 1) % 100) + 1;
    const rangoEnTier = Math.floor((pisoEnTier - 1) / 10) + 1;
    const pisoEnRango = ((pisoEnTier - 1) % 10) + 1;
    const probabilidad = pisoEnRango * 10;
    return { tierActual, pisoEnTier, rangoEnTier, pisoEnRango, probabilidad };
}

// Tira cuántos núcleos suelta UN enemigo derrotado en este piso: 1
// garantizado + hasta (rango-1) adicionales, cada uno independiente a
// `probabilidad`%. Todos los núcleos son del Tier de material del piso.
function rollNucleoDrops(piso) {
    const { tierActual, rangoEnTier, probabilidad } = calcularProbabilidadNucleoAdicional(piso);
    let count = 1;
    const maxAdicionales = rangoEnTier - 1;
    for (let i = 0; i < maxAdicionales; i++) {
        if (Math.random() * 100 < probabilidad) count++;
    }
    return { tierId: Math.min(10, tierActual), count };
}
