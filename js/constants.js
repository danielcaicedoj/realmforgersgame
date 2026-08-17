// ===== CONSTANTES GLOBALES =====

// El canvas ocupa toda la pantalla; estos valores se actualizan en tiempo
// real desde game.js (resizeCanvas) cuando cambia el tamaño de la ventana.
let CANVAS_WIDTH = window.innerWidth;
let CANVAS_HEIGHT = window.innerHeight;

// El mundo es un piso de mazmorra generado proceduralmente (BSP), 10x más
// grande que el mundo abierto anterior. La cámara sigue al jugador.
const WORLD_WIDTH = 19200;
const WORLD_HEIGHT = 12000;

// ----- SISTEMA DE PISOS -----
const MAX_FLOOR = 1000;
const MAX_PERGAMINOS_TELETRANSPORTE = 10; // cap de inventario para pergamino_teletransporte (ver Player.gainMaterial)
const ENEMIES_PER_FLOOR = 240; // cap de enemigos vivos simultáneos por piso
const INITIAL_SPAWN_RATIO = 0.75; // el piso arranca con este % del cap; el resto se rellena con el respawn dinámico

// ----- ZONAS DE RECURSOS -----
// Cada piso tiene varias "zonas" (una sala completa) densas en un solo tipo
// de recurso, en vez de nodos sueltos repartidos por todo el piso.
const RESOURCE_ZONES_PER_TYPE = 4; // zonas por tipo (árbol/roca/tierra/cultivo/hierba), por piso
const RESOURCE_ZONE_MIN_NODES = 5;
const RESOURCE_ZONE_MAX_NODES = 15;

// ----- COFRES -----
// Nodos que no reaparecen: hay que vencer varios enemigos cerca para
// desbloquearlos, y después se abren con una carga corta (como recolectar).
const CHESTS_PER_FLOOR = 5;
const CHEST_REQUIRED_KILLS = 5;
const CHEST_KILL_RADIUS = 320; // "cerca" del cofre, para contar la muerte de un enemigo
const CHEST_GUARD_INITIAL = 2; // enemigos que aparecen apenas se genera el cofre
const CHEST_INTERACT_RANGE = 90;
const CHEST_OPEN_TIME = 1000; // 1 segundo, igual que recolectar por ahora (GATHER_TIME)

// Genera el contenido de un cofre: núcleos de su propia rareza, 1-2 recursos
// variados (del tier del piso) y, desde Poco Común, alguna poción. A mayor
// rareza, más cantidad de todo.
function generateChestLoot(rarity, floor) {
    const idx = MONSTER_RARITIES.findIndex(r => r.id === rarity.id);
    const scale = 1 + idx; // comun:1 .. mitico:6
    const loot = {};

    const matTierId = getMaterialTierForFloor(floor);
    loot[getNucleoId(rarity.id, matTierId)] = 1 + idx;

    const herbTierId = getHerbTierForFloor(floor).id;
    const pool = [`mat_tier_${matTierId}`, `hierba_tier_${herbTierId}`, `madera_tier_${matTierId}`, `cultivo_tier_${matTierId}`];
    const rolls = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < rolls; i++) {
        const id = pool[Math.floor(Math.random() * pool.length)];
        loot[id] = (loot[id] || 0) + (2 + Math.floor(Math.random() * 3)) * scale;
    }

    if (idx >= 1) loot[`pocion_${rarity.id}`] = (loot[`pocion_${rarity.id}`] || 0) + Math.ceil(idx / 2);

    // Pergaminos de teletransportación: solo en cofres de Poco Común o superior.
    if (idx >= 1 && Math.random() < 0.25) loot.pergamino_teletransporte = (loot.pergamino_teletransporte || 0) + 1;

    return loot;
}

// ----- GENERACIÓN DE PISOS -----
// Grid-based (ver grid-dungeon.js): TILE_SIZE sigue siendo la resolución
// del tilemap de colisiones.
const TILE_SIZE = 40;

// El nivel ya no es por arma/profesión: es un único nivel de jugador (1-1000)
// que sube con toda la XP ganada (combate, recolección, encantamiento) y
// determina el tier de TODAS las armas/armadura por igual.
const MAX_LEVEL = 1000;
const XP_PER_LEVEL = 100;
const STAT_POINTS_PER_LEVEL = 10; // puntos de estadística otorgados en cada level up

const SAVE_KEY = 'rpg_weapon_progression_save_v3';

// ----- TIERS DE MATERIAL (10 niveles, 100 niveles de jugador cada uno) -----
// Mismos 10 tiers que el Material de ore/madera (ver MATERIAL_TIER_BRACKETS/
// WOOD_TIERS más abajo, y el sistema de núcleos de encantamiento en
// enchantments.js): Bronce..Absoluto. Acá el tier se deriva del NIVEL del
// jugador (arma automática); allá se deriva del PISO (qué se recolecta).
// `color` identifica visualmente el tier (ej. el anillo de la montura
// equipada, ver drawPlayerEntity en game.js).
const TIERS = [
    { id: 1,  name: 'BRONCE',      emoji: '🟤', levelMin: 1,   levelMax: 100,  mult: 1.0,  color: '#cd7f32' },
    { id: 2,  name: 'HIERRO',      emoji: '⚪', levelMin: 101, levelMax: 200,  mult: 1.35, color: '#c0c0c0' },
    { id: 3,  name: 'ACERO',       emoji: '⚙️', levelMin: 201, levelMax: 300,  mult: 1.75, color: '#71797e' },
    { id: 4,  name: 'INFERNITA',   emoji: '🔥', levelMin: 301, levelMax: 400,  mult: 2.2,  color: '#ff5a1f' },
    { id: 5,  name: 'MITHRIL',     emoji: '✨', levelMin: 401, levelMax: 500,  mult: 2.75, color: '#8ecfff' },
    { id: 6,  name: 'ORICHALCUM',  emoji: '🔱', levelMin: 501, levelMax: 600,  mult: 3.4,  color: '#ffb347' },
    { id: 7,  name: 'ADAMANTITE',  emoji: '💎', levelMin: 601, levelMax: 700,  mult: 4.2,  color: '#6fe3d9' },
    { id: 8,  name: 'SOMBRÍO',     emoji: '🌑', levelMin: 701, levelMax: 800,  mult: 5.1,  color: '#5b2a86' },
    { id: 9,  name: 'CELESTIAL',   emoji: '🌟', levelMin: 801, levelMax: 900,  mult: 6.2,  color: '#ffe066' },
    { id: 10, name: 'ABSOLUTO',    emoji: '⚡', levelMin: 901, levelMax: 1000, mult: 7.5,  color: '#7df9ff' },
];

function getTierForLevel(level) {
    for (const t of TIERS) {
        if (level >= t.levelMin && level <= t.levelMax) return t;
    }
    return TIERS[TIERS.length - 1];
}

function getTierProgress(level) {
    const tier = getTierForLevel(level);
    const span = tier.levelMax - tier.levelMin + 1;
    const into = level - tier.levelMin;
    return { tier, into, span };
}

// ----- PROFESIONES (13) -----
// type: combat | combat_ranged | combat_block | gather | passive | craft
// Las profesiones de tipo "gather" nunca se equipan: suben de nivel y están
// siempre disponibles para recolectar, sin importar el arma de combate activa.
const PROFESSIONS = [
    { id: 'picaro',     name: 'PÍCARO',     emoji: '🗡️', type: 'combat',        weaponLabel: 'Daga',              desc: 'Alta probabilidad de crítico, penetración de armadura', baseDamage: 9 },
    { id: 'guerrero',   name: 'GUERRERO',   emoji: '⚔️', type: 'combat',        weaponLabel: 'Espada',            desc: 'Daño muy alto, acumula Poder',    baseDamage: 16 },
    { id: 'herrero',    name: 'HERRERO',    emoji: '🪛', type: 'combat',        weaponLabel: 'Martillo',          desc: 'Herramienta y arma',              baseDamage: 10 },
    { id: 'barbaro',    name: 'BÁRBARO',    emoji: '🪓', type: 'combat',        weaponLabel: 'Hacha de Batalla',  desc: 'Daño medio-alto, Sed de Sangre',  baseDamage: 13 },
    { id: 'mago',       name: 'MAGO',       emoji: '🧙', type: 'combat',        weaponLabel: 'Báculo',            desc: 'Amplificación Arcana a distancia', baseDamage: 12 },
    { id: 'lenador',    name: 'LEÑADOR',    emoji: '🌲', type: 'gather',        weaponLabel: 'Hacha de Leña',     desc: 'Recolección: madera',             baseDamage: 6,  resource: 'tree' },
    { id: 'arquero',    name: 'ARQUERO',    emoji: '🏹', type: 'combat_ranged', weaponLabel: 'Arco',              desc: 'Requiere flechas, sistema de Enfoque', baseDamage: 8,  range: 320 },
    { id: 'minero',     name: 'MINERO',     emoji: '⛏️', type: 'gather',        weaponLabel: 'Pico',              desc: 'Recolección: minerales',          baseDamage: 6,  resource: 'rock' },
    { id: 'segador',    name: 'SEGADOR',    emoji: '🌾', type: 'combat',        weaponLabel: 'Azada de Guerra',   desc: 'Daño bajo-medio',                 baseDamage: 8 },
    { id: 'campesino',  name: 'CAMPESINO',  emoji: '👨‍🌾', type: 'gather',      weaponLabel: 'Azada',             desc: 'Recolección: cultivos',           baseDamage: 6,  resource: 'plant' },
    { id: 'armadura',   name: 'ARMADURA',   emoji: '🛡️', type: 'passive',      weaponLabel: 'Armadura',          desc: 'Defensa pasiva',                  baseDamage: 0 },
    { id: 'tanque',     name: 'TANQUE',     emoji: '🛡️', type: 'combat_block', weaponLabel: 'Espada y Escudo',   desc: 'Máxima defensa',                  baseDamage: 6 },
    { id: 'encantador', name: 'ENCANTADOR', emoji: '✨', type: 'craft',         weaponLabel: 'Libro Mágico',      desc: 'Mejorador de equipamiento',       baseDamage: 0 },
    { id: 'desarmado',  name: 'DESARMADO',  emoji: '👊', type: 'combat',        weaponLabel: 'Puños',             desc: 'Combate sin armas: Golpe, Patada y Cabezazo', baseDamage: 5 },
];

function getProfession(id) { return PROFESSIONS.find(p => p.id === id); }

// Cada nodo de recurso está atado a una única profesión de recolección, para
// saber qué herramienta crafteada equipada mejora su rendimiento.
// La hierba medicinal (para pociones) también la recolecta el campesino.
const RESOURCE_TO_PROFESSION = { tree: 'lenador', rock: 'minero', plant: 'campesino', herb: 'campesino' };

// ----- ESTADÍSTICAS (Potencia / Destreza / Suerte / Constitución / Agilidad) -----
// Cada nivel del jugador otorga STAT_POINTS_PER_LEVEL puntos para repartir
// libremente (ventana de estadísticas, tecla V). A diferencia del viejo
// sistema (bonos planos por profesión), estos 5 stats son universales: se
// aplican igual sin importar la clase activa (ver player.js: getDamage,
// resolveDefense; combat.js: playerAttackWithAP, performEnemyAttack).
//
// Potencia:     +0.1% de daño de arma por punto (multiplicativo).
// Destreza:     +0.1 de penetración de armadura PLANA por punto (ignora
//               defensa enemiga; ver Enemy.getEffectiveDefense/flatPenetration).
// Suerte:       +0.01% de probabilidad de crítico por punto (se suma a la
//               base de la clase, ver WEAPON_CRIT_BASE, y al bono del ataque).
// Constitución: +0.01% de probabilidad de bloquear por punto (máx 40%) +
//               +5 HP máx por punto. Al bloquear, -50% del daño recibido.
// Agilidad:     +0.01% de probabilidad de esquivar por punto (máx 40%, daño
//               evitado por completo) + +0.01% de contraatacar (máx 100%).
const STAT_POTENCIA_DMG_PERCENT = 0.001;      // por punto
const STAT_DESTREZA_ARMOR_PEN = 0.1;          // por punto (plano)
const STAT_SUERTE_CRIT_CHANCE = 0.0001;       // por punto
const STAT_CONSTITUCION_BLOCK_CHANCE = 0.0001; // por punto
const STAT_CONSTITUCION_HP = 5;               // por punto
const STAT_AGILIDAD_DODGE_CHANCE = 0.0001;    // por punto
const STAT_AGILIDAD_COUNTER_CHANCE = 0.0001;  // por punto
const MAX_BLOCK_CHANCE = 0.40;
const MAX_DODGE_CHANCE = 0.40;
const MAX_COUNTER_CHANCE = 1.0;
const BLOCK_DAMAGE_REDUCTION = 0.5;
const DEFAULT_COUNTER_DAMAGE_PERCENT = 0.5; // sin encantamiento de contraataque

// Probabilidad de crítico BASE (inherente al tipo de arma, antes de Suerte,
// del ataque específico o de encantamientos). Las clases sin mención en el
// diseño (Tanque, Desarmado) no tienen bono de clase (0%).
const WEAPON_CRIT_BASE = {
    arquero: 0.15,   // Arcos
    picaro: 0.12,    // Dagas
    barbaro: 0.08,   // Hachas
    segador: 0.06,   // Azadas
    mago: 0.05,      // Báculos
    herrero: 0.04,   // Martillos
    guerrero: 0.03,  // Claymores/Espadas
};
function getWeaponCritBase(profId) { return WEAPON_CRIT_BASE[profId] || 0; }

// ----- ATAQUES POR ARMA (3 por arma de combate) -----
// Placeholder hasta que se definan los efectos reales de cada ataque
// (para las profesiones que todavía no tienen datos en WEAPON_ATTACKS).
const ATTACKS_BY_PROFESSION = {};
PROFESSIONS.forEach(p => {
    if (p.type === 'combat' || p.type === 'combat_ranged' || p.type === 'combat_block') {
        ATTACKS_BY_PROFESSION[p.id] = [
            { id: 'ataque1', name: 'Ataque 1', emoji: '⚔️', desc: 'Por definir' },
            { id: 'ataque2', name: 'Ataque 2', emoji: '⚔️', desc: 'Por definir' },
            { id: 'ataque3', name: 'Ataque 3', emoji: '⚔️', desc: 'Por definir' },
        ];
    }
});

function getAttacksForProfession(id) {
    return ATTACKS_BY_PROFESSION[id] || [];
}

// ----- SISTEMA DE PUNTOS DE ACCIÓN (PA) -----
// Cada turno del jugador se reinicia a este valor. Los ataques básicos
// (1 y 2) se pueden encadenar en un mismo turno mientras alcancen los PA.
// El tercer ataque es un especial que además requiere haber acumulado
// puntos de carga (chargeGain de los ataques básicos) hasta su umbral.
// Los datos completos de cada arma (WEAPON_ATTACKS) viven en weapon-attacks.js.
const BASE_AP = 6;

// ----- ARCOS ESPECIALES (nombres por tier) -----
const BOW_NAMES = {
    1: 'Arco de Roble',
    2: 'Arco de Haya',
    3: 'Arco de Fresno',
    4: 'Arco de Fuego',
    5: 'Arco de Starlight',
    6: 'Arco de Celestial',
    7: 'Arco de Eternidad',
};

// ----- ENEMIGOS (estáticos en el mundo, no atacan hasta iniciar combate) -----
// defense: mitigación plana contra el daño recibido (0 por ahora en todos;
// ya la usan los efectos de "reducir/ignorar defensa" cuando se agreguen valores).
// hp/dmg/xp son valores base para PISO 1; enemy-scaling.js los escala según
// el piso actual con la fórmula dada por el usuario.
const ENEMY_TYPES = [
    // --- Piso 1-10 ---
    { id: 'esqueleto', name: 'Esqueleto', emoji: '💀', hp: 30, dmg: 8, xp: 12, color: '#d8d3c0', radius: 16, defense: 0 },
    { id: 'zombie', name: 'Zombie', emoji: '🧟', hp: 38, dmg: 7, xp: 12, color: '#5a7a4a', radius: 17, defense: 0 },
    { id: 'goblin', name: 'Goblin', emoji: '👺', hp: 24, dmg: 9, xp: 11, color: '#6a8a3a', radius: 15, defense: 0 },
    { id: 'lobo', name: 'Lobo', emoji: '🐺', hp: 22, dmg: 5, xp: 8, color: '#8b6f47', radius: 16, defense: 0 },

    // --- Piso 11-20 ---
    { id: 'vampiro', name: 'Vampiro', emoji: '🧛', hp: 50, dmg: 12, xp: 25, color: '#7a1f3d', radius: 17, defense: 0 },
    { id: 'troll', name: 'Troll', emoji: '👹', hp: 75, dmg: 16, xp: 30, color: '#3d6b2f', radius: 22, defense: 0 },
    { id: 'fantasma', name: 'Fantasma', emoji: '👻', hp: 28, dmg: 11, xp: 20, color: '#c9c9e8', radius: 16, defense: 0 },

    // --- Piso 21-30 ---
    { id: 'demonio', name: 'Demonio', emoji: '😈', hp: 140, dmg: 26, xp: 55, color: '#8a1f1f', radius: 19, defense: 0 },
    { id: 'hombre_lobo', name: 'Hombre Lobo', emoji: '🐗', hp: 120, dmg: 30, xp: 55, color: '#5a4a3a', radius: 20, defense: 0 },
    { id: 'sombra', name: 'Sombra', emoji: '🌑', hp: 100, dmg: 28, xp: 50, color: '#2a1a3a', radius: 17, defense: 0 },

    // --- Piso 31-50 ---
    { id: 'lich', name: 'Lich', emoji: '🧙', hp: 220, dmg: 40, xp: 90, color: '#3a2f5a', radius: 19, defense: 0 },
    { id: 'espectro', name: 'Espectro', emoji: '🌫️', hp: 190, dmg: 42, xp: 85, color: '#8a9ac9', radius: 17, defense: 0 },
    { id: 'wyvern', name: 'Wyvern', emoji: '🐲', hp: 260, dmg: 38, xp: 95, color: '#2f6b4a', radius: 23, defense: 0 },

    // --- Piso 51-100 ---
    { id: 'archilich', name: 'Archilich', emoji: '☠️', hp: 450, dmg: 70, xp: 180, color: '#4a1f6a', radius: 20, defense: 0 },
    { id: 'entidad_vacio', name: 'Entidad del Vacío', emoji: '🕳️', hp: 420, dmg: 75, xp: 190, color: '#0a0a1a', radius: 19, defense: 0 },
    { id: 'leviatan', name: 'Leviatán', emoji: '🐋', hp: 600, dmg: 65, xp: 200, color: '#1a4a6a', radius: 26, defense: 0 },

    // --- Piso 101-200 ---
    { id: 'dragon_antiguo', name: 'Dragón Antiguo', emoji: '🐉', hp: 900, dmg: 130, xp: 400, color: '#6a1f1f', radius: 27, defense: 0 },
    { id: 'elemental_caos', name: 'Elemental del Caos', emoji: '🌀', hp: 850, dmg: 140, xp: 420, color: '#8a2f8a', radius: 21, defense: 0 },
    { id: 'abominacion', name: 'Abominación', emoji: '🧟‍♂️', hp: 1000, dmg: 120, xp: 410, color: '#4a5a2a', radius: 24, defense: 0 },

    // --- Piso 201-1000 (entidades cósmicas) ---
    { id: 'heraldo_cosmico', name: 'Heraldo Cósmico', emoji: '✨', hp: 1600, dmg: 220, xp: 800, color: '#2a2a6a', radius: 22, defense: 0 },
    { id: 'devorador_estrellas', name: 'Devorador de Estrellas', emoji: '🌠', hp: 1700, dmg: 230, xp: 820, color: '#1a1a3a', radius: 23, defense: 0 },
    { id: 'guardian_vacio', name: 'Guardián del Vacío', emoji: '🌌', hp: 1650, dmg: 210, xp: 810, color: '#0a0a2a', radius: 24, defense: 0 },
    { id: 'entidad_primordial', name: 'Entidad Primordial', emoji: '🔮', hp: 1800, dmg: 240, xp: 850, color: '#4a1a4a', radius: 25, defense: 0 },
];

function getEnemyType(id) { return ENEMY_TYPES.find(e => e.id === id); }

// ----- RAREZA DE MONSTRUOS (6 niveles) -----
// Se sortea una vez por enemigo al generarlo (ver loadFloor en game.js).
// Cada nivel es 10% más fuerte (hp/dmg) que el anterior, en cadena (1.10^n).
const MONSTER_RARITIES = [
    { id: 'comun',       name: 'Común',       color: '#9a9a9a', chance: 50,  mult: 1 },
    { id: 'poco_comun',  name: 'Poco Común',  color: '#3ecf5e', chance: 30,  mult: 1.1 },
    { id: 'raro',        name: 'Raro',        color: '#3f9dff', chance: 13,  mult: 1.1 ** 2 },
    { id: 'epico',       name: 'Épico',       color: '#a64fff', chance: 5,   mult: 1.1 ** 3 },
    { id: 'legendario',  name: 'Legendario',  color: '#ffcf3f', chance: 1.5, mult: 1.1 ** 4 },
    { id: 'mitico',      name: 'Mítico',      color: '#e93cff', chance: 0.5, mult: 1.1 ** 5 },
];

function rollMonsterRarity() {
    const roll = Math.random() * 100;
    let acc = 0;
    for (const r of MONSTER_RARITIES) {
        acc += r.chance;
        if (roll < acc) return r;
    }
    return MONSTER_RARITIES[0];
}

function getMonsterRarity(id) { return MONSTER_RARITIES.find(r => r.id === id) || MONSTER_RARITIES[0]; }

// ----- JEFES DINÁMICOS (aparecen al matar enemigos, no al generar el piso) -----
// mult: multiplicador de hp/dmg sobre el enemigo base ya escalado al piso.
// radiusMult: qué tan grande es el círculo respecto a un enemigo normal.
// chance: probabilidad de aparecer cada vez que se elimina 1 enemigo (minijefe/jefe).
const BOSS_TIERS = {
    minijefe:   { label: 'Minijefe',           rarities: ['poco_comun', 'raro'], mult: 2,  chance: 0.20, radiusMult: 1.5 },
    jefe:       { label: 'Jefe',               rarities: ['epico', 'legendario'], mult: 4,  chance: 0.10, radiusMult: 2 },
    jefe_final: { label: 'Jefe Final',          rarities: ['mitico'],              mult: 10, radiusMult: 3 },
};

// ----- JEFE FINAL: sistema de puntos (desbloqueo) -----
// Derrotar un minijefe suma 10 puntos, un jefe especial de piso (ver
// grid-dungeon.js) suma 20. Al llegar a FINAL_BOSS_POINTS_TARGET queda
// "desbloqueada" la posibilidad de que aparezca: cada enemigo derrotado a
// partir de ahí tiene FINAL_BOSS_SPAWN_CHANCE de hacerlo aparecer en el
// piso actual del jugador (que siempre cae dentro de "su" rango de 10
// pisos). El contador se reinicia a 0 recién cuando se lo derrota.
const FINAL_BOSS_POINTS_TARGET = 100;
const FINAL_BOSS_MINIJEFE_POINTS = 10;
const FINAL_BOSS_JEFE_ESPECIAL_POINTS = 20;
const FINAL_BOSS_SPAWN_CHANCE = 0.15;

// Info (nombre/emoji) de cada material recolectable, para mostrarlo en el
// bolso del inventario a partir de `player.materials` (que solo guarda id->cantidad).
const MATERIAL_INFO = {};
MATERIAL_INFO.oro = { name: 'Oro', emoji: '💰' };
MATERIAL_INFO.gema_poder = { name: 'Gema de Poder', emoji: '💎' };

// Núcleos de monstruo: todo enemigo suelta al menos 1 garantizado, con la
// misma Rareza que el enemigo y el Tier del piso donde cayó (ver el sistema
// de drop progresivo y el banco de encantamientos en enchantments.js).
// Nomenclatura: Núcleo [Rareza] Tier [Número].
const CORE_EMOJI = { comun: '🔘', poco_comun: '🟢', raro: '🔵', epico: '🟣', legendario: '🟡', mitico: '💠' };
function getNucleoId(rarityId, tierId) { return `nucleo_${rarityId}_tier${tierId}`; }
MONSTER_RARITIES.forEach(r => {
    TIERS.forEach(t => {
        MATERIAL_INFO[getNucleoId(r.id, t.id)] = { name: `Núcleo ${r.name} Tier ${t.id}`, emoji: CORE_EMOJI[r.id] };
    });
});

// Materiales de crafteo por tier (Bronce..Adamantite), obtenidos recolectando
// nodos de recursos: el piso actual determina qué tier de material sueltan.
TIERS.forEach(t => {
    MATERIAL_INFO[`mat_tier_${t.id}`] = { name: t.name.charAt(0) + t.name.slice(1).toLowerCase(), emoji: t.emoji };
});

function getMaterialInfo(id) {
    return MATERIAL_INFO[id] || { name: id, emoji: '📦' };
}

// Bracket de piso -> tier de material de crafteo: 10 tiers de 100 pisos
// cada uno (Tier 1 = pisos 1-100 ... Tier 10 = pisos 901-1000), igual que
// los núcleos de encantamiento (ver enchantments.js).
const MATERIAL_TIER_BRACKETS = [
    { min: 1,   max: 100,  tierId: 1 },
    { min: 101, max: 200,  tierId: 2 },
    { min: 201, max: 300,  tierId: 3 },
    { min: 301, max: 400,  tierId: 4 },
    { min: 401, max: 500,  tierId: 5 },
    { min: 501, max: 600,  tierId: 6 },
    { min: 601, max: 700,  tierId: 7 },
    { min: 701, max: 800,  tierId: 8 },
    { min: 801, max: 900,  tierId: 9 },
    { min: 901, max: 1000, tierId: 10 },
];

function getMaterialTierForFloor(floor) {
    const bracket = MATERIAL_TIER_BRACKETS.find(b => floor >= b.min && floor <= b.max);
    return (bracket || MATERIAL_TIER_BRACKETS[0]).tierId;
}

// La madera tiene su propia escala de 10 tiers (mismos rangos de piso que la
// mena), con nombre propio por tier; el emoji es el mismo en las 10 (dado así
// por el diseño). El cultivo (base de los alimentos del campesino, ver
// foods.js) usa esos mismos 10 rangos de piso vía cultivo_tier_N.
const WOOD_TIERS = [
    { id: 1,  name: 'Madera de Roble' },
    { id: 2,  name: 'Madera de Haya' },
    { id: 3,  name: 'Madera de Fresno' },
    { id: 4,  name: 'Madera de Olmo Ardiente' },
    { id: 5,  name: 'Madera de Cerezo Mágico' },
    { id: 6,  name: 'Madera de Nogal Celestial' },
    { id: 7,  name: 'Madera de Tejo Eterno' },
    { id: 8,  name: 'Madera de Sombra Eterna' },
    { id: 9,  name: 'Madera de Luz Cósmica' },
    { id: 10, name: 'Madera de Esencia Pura' },
];
WOOD_TIERS.forEach(t => {
    MATERIAL_INFO[`madera_tier_${t.id}`] = { name: t.name, emoji: '🌳' };
});

// Pergaminos de teletransportación: objeto de 1 solo uso, aparecen en cofres
// (Poco Común+) o los sueltan enemigos de esa rareza o superior (ver
// Combat.onEnemyDefeated). Al usarse abren el mapa; el próximo click ahí
// teletransporta al jugador (ver game.js).
MATERIAL_INFO.pergamino_teletransporte = { name: 'Pergamino de Teletransportación', emoji: '📜' };

// La hierba medicinal tiene su propia escala de 10 tiers por rango de piso
// (independiente de los 7 tiers de mena/armas), con nombre y emoji propios.
const HERB_TIERS = [
    { id: 1,  min: 1,   max: 100,  name: 'Hoja de Menta',            emoji: '🌿' },
    { id: 2,  min: 101, max: 200,  name: 'Hoja de Morena',           emoji: '🌱' },
    { id: 3,  min: 201, max: 300,  name: 'Rosa de Acero',            emoji: '🌺' },
    { id: 4,  min: 301, max: 400,  name: 'Flor de Lava',             emoji: '🔴' },
    { id: 5,  min: 401, max: 500,  name: 'Flor del Crepúsculo',      emoji: '🩵' },
    { id: 6,  min: 501, max: 600,  name: 'Corona de Oro',            emoji: '👑' },
    { id: 7,  min: 601, max: 700,  name: 'Gema de Cristal Vivo',     emoji: '💎' },
    { id: 8,  min: 701, max: 800,  name: 'Flor del Océano Profundo', emoji: '🌊' },
    { id: 9,  min: 801, max: 900,  name: 'Flor del Arcoíris',        emoji: '🌈' },
    { id: 10, min: 901, max: 1000, name: 'Sombra Primordial',        emoji: '🌑' },
];
HERB_TIERS.forEach(t => {
    MATERIAL_INFO[`hierba_tier_${t.id}`] = { name: t.name, emoji: t.emoji };
});

function getHerbTierForFloor(floor) {
    return HERB_TIERS.find(t => floor >= t.min && floor <= t.max) || HERB_TIERS[0];
}

// Pociones de curación: crafteadas con hierba + núcleo (ver player.craftPotion).
// La rareza del núcleo determina cuánto curan; el costo de hierba es fijo,
// no depende del tier (ver POTION_HERB_COST).
const POTION_BASE_HEAL = 40;
const POTION_HERB_COST = 10;
MONSTER_RARITIES.forEach(r => {
    MATERIAL_INFO[`pocion_${r.id}`] = { name: `Poción de Curación (${r.name})`, emoji: '🧪' };
});
function getPotionHealAmount(rarityId) {
    return Math.round(POTION_BASE_HEAL * getMonsterRarity(rarityId).mult);
}

// Devuelve el id del material que se gana al recolectar un nodo de este tipo.
function getGatherMaterialId(resourceType, floor) {
    if (resourceType === 'rock') return `mat_tier_${getMaterialTierForFloor(floor)}`;
    if (resourceType === 'herb') return `hierba_tier_${getHerbTierForFloor(floor).id}`;
    if (resourceType === 'tree') return `madera_tier_${getMaterialTierForFloor(floor)}`;
    if (resourceType === 'plant') return `cultivo_tier_${getMaterialTierForFloor(floor)}`;
    return null;
}

// ----- CRAFTEO -----
// Costo de un objeto crafteado de un tier dado: más material cuanto más alto
// el tier, más 1 núcleo (de la rareza elegida) sin importar el tier.
function getCraftMaterialCost(tierId) { return (3 + (tierId - 1) * 2) * 10; }
const CRAFT_CORE_COST = 1;

// Pools de tipos de enemigo por rango de piso.
const FLOOR_ENEMY_POOLS = [
    { min: 1,   max: 10,   ids: ['esqueleto', 'zombie', 'goblin', 'lobo'] },
    { min: 11,  max: 20,   ids: ['vampiro', 'troll', 'fantasma'] },
    { min: 21,  max: 30,   ids: ['demonio', 'hombre_lobo', 'sombra'] },
    { min: 31,  max: 50,   ids: ['lich', 'espectro', 'wyvern'] },
    { min: 51,  max: 100,  ids: ['archilich', 'entidad_vacio', 'leviatan'] },
    { min: 101, max: 200,  ids: ['dragon_antiguo', 'elemental_caos', 'abominacion'] },
    { min: 201, max: 1000, ids: ['heraldo_cosmico', 'devorador_estrellas', 'guardian_vacio', 'entidad_primordial'] },
];

function getEnemyPoolForFloor(floor) {
    const bracket = FLOOR_ENEMY_POOLS.find(b => floor >= b.min && floor <= b.max);
    return (bracket || FLOOR_ENEMY_POOLS[0]).ids.map(getEnemyType);
}

// ----- COMBATE POR TURNOS -----
const ENGAGE_RANGE = 110;      // distancia máxima para hacer click o Espacio e iniciar combate
const ENGAGE_GROUP_RADIUS = 90; // enemigos cercanos al objetivo que se suman al combate
const FLEE_SUCCESS_CHANCE = 0.6;
const INITIATIVE_DIE = 20;

function rollD20() {
    return 1 + Math.floor(Math.random() * INITIATIVE_DIE);
}

// ----- RECURSOS (nodos de recolección) -----
const RESOURCE_TYPES = {
    tree: { emoji: '🌳', name: 'Árbol', hp: 30, xp: 6, color: '#2f5d34' },
    rock: { emoji: '🪨', name: 'Roca',  hp: 40, xp: 7, color: '#6b6b6b' },
    plant:{ emoji: '🌾', name: 'Cultivo', hp: 15, xp: 5, color: '#a9a832' },
    herb: { emoji: '🌿', name: 'Hierba Medicinal', hp: 15, xp: 5, color: '#3f9d5c' },
};

// Recolección por "carga": mantener el nodo objetivo X segundos para recolectar
// (en vez de clickear varias veces). Por ahora todos los tiempos son 1 segundo.
const GATHER_TIME_SEC = 1;
const GATHER_TIME = GATHER_TIME_SEC * 1000;
const GATHER_RANGE = 90; // distancia máxima para iniciar recolección (click o Espacio)

// Nodo especial: 1 por zona, 10x más lento pero rinde mucho más que uno normal.
const SPECIAL_NODE_TIME_MULT = 10;
const SPECIAL_NODE_YIELD_MIN = 10;
const SPECIAL_NODE_YIELD_MAX_BASE = 20;

// Rendimiento base de un nodo normal: cantidad aleatoria entre estos valores.
// La herramienta de recolección equipada (crafteada) puede subir el máximo:
// cada nivel de rareza multiplica el máximo por (1 + índice*0.4), así que
// Común no cambia nada y Mítico lo triplica (ej. Pico Mítico: 1-3 -> 1-9).
const GATHER_YIELD_MIN = 1;
const GATHER_YIELD_MAX_BASE = 3;

function getGatherYieldMax(rarityId) {
    if (!rarityId) return GATHER_YIELD_MAX_BASE;
    const idx = MONSTER_RARITIES.findIndex(r => r.id === rarityId);
    if (idx <= 0) return GATHER_YIELD_MAX_BASE;
    return Math.round(GATHER_YIELD_MAX_BASE * (1 + idx * 0.4));
}

// Igual que getGatherYieldMax pero para el máximo (mayor) de un nodo especial.
function getSpecialNodeYieldMax(rarityId) {
    if (!rarityId) return SPECIAL_NODE_YIELD_MAX_BASE;
    const idx = MONSTER_RARITIES.findIndex(r => r.id === rarityId);
    if (idx <= 0) return SPECIAL_NODE_YIELD_MAX_BASE;
    return Math.round(SPECIAL_NODE_YIELD_MAX_BASE * (1 + idx * 0.4));
}
