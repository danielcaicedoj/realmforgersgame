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
const ENEMIES_PER_FLOOR = 480; // cap de enemigos vivos simultáneos por piso (duplicado a pedido, el mapa se sentía vacío)
const INITIAL_SPAWN_RATIO = 0.75; // el piso arranca con este % del cap; el resto se rellena con el respawn dinámico

// ----- ZONAS DE RECURSOS -----
// Cada piso tiene varias "zonas" (una sala completa) densas en un solo tipo
// de recurso, en vez de nodos sueltos repartidos por todo el piso.
const RESOURCE_ZONES_PER_TYPE = 4; // zonas por tipo (árbol/roca/tierra/cultivo/hierba), por piso
const RESOURCE_ZONE_MIN_NODES = 5;
const RESOURCE_ZONE_MAX_NODES = 15;

// ----- ZONAS DE SPAWN INCREMENTADO -----
// Hotspots temporales de enemigos en una sala: mantienen 20-30 enemigos
// vivos propios (se rellenan por debajo de 20 en lotes de 3-8) durante una
// duración aleatoria, y desaparecen al expirar. Máximo 3 simultáneas por
// piso; cada muerte de enemigo tiene una chance chica de crear una nueva.
const SPAWN_ZONE_MIN_ENEMIES = 20;
const SPAWN_ZONE_MAX_ENEMIES = 30;
const SPAWN_ZONE_REFILL_THRESHOLD = 20; // rellena si caen por debajo de esto
const SPAWN_ZONE_BATCH_MIN = 3;
const SPAWN_ZONE_BATCH_MAX = 8;
const SPAWN_ZONE_DURATIONS_MIN = [10, 20, 30]; // minutos, una se sortea al crear la zona
const SPAWN_ZONE_MAX_PER_FLOOR = 3;
const SPAWN_ZONE_CREATE_CHANCE = 0.005; // 0.5% por enemigo derrotado
const SPAWN_ZONE_RADIUS = 260; // px: pertenencia a la zona + radio del círculo dibujado
const SPAWN_ZONE_COLORS = ['#ff5c5c', '#5cc8ff', '#ffd25c'];

// Zonas creadas por el jugador (Pergamino de Alteración, ver
// ALTERACION_TIER_DURATIONS_MIN más abajo): misma mecánica de refill que las
// naturales de arriba, pero en un array/cupo aparte (no cuentan para
// SPAWN_ZONE_MAX_PER_FLOOR) y con color propio para distinguirlas.
const SPAWN_ZONE_MAX_PLAYER_PER_FLOOR = 3;
const SPAWN_ZONE_PLAYER_COLOR = '#d63cff';

// ----- COFRES -----
// Nodos que no reaparecen: hay que vencer varios enemigos cerca para
// desbloquearlos, y después se abren con una carga corta (como recolectar).
const CHESTS_PER_FLOOR = 5;
const CHEST_ZONE_RADIUS = 750; // "cerca" del cofre: enemigos guardianes + conteo de progreso (triplicado a pedido)
const CHEST_INTERACT_RANGE = 90;
const CHEST_OPEN_TIME = 1000; // 1 segundo, igual que recolectar por ahora (GATHER_TIME)
const CHEST_BOSS_RADIUS = 40; // cofre del Jefe Final: bastante más grande que un cofre normal (22)

// Población de guardianes por cofre, escalada por rango de piso (más pisos
// avanzados = cofre mejor custodiado). Se sortea un objetivo puntual dentro
// del rango [min,max] una sola vez, al crear el cofre.
const CHEST_GUARD_TARGET_BRACKETS = [
    { maxFloor: 50, min: 8, max: 12 },
    { maxFloor: 100, min: 12, max: 16 },
    { maxFloor: 200, min: 15, max: 20 },
    { maxFloor: 300, min: 18, max: 25 },
    { maxFloor: 400, min: 22, max: 30 },
    { maxFloor: 500, min: 25, max: 35 },
    { maxFloor: 600, min: 30, max: 40 },
    { maxFloor: 700, min: 35, max: 45 },
    { maxFloor: 800, min: 40, max: 50 },
    { maxFloor: 900, min: 45, max: 55 },
    { maxFloor: 1000, min: 50, max: 60 },
];
function rollChestGuardTarget(floor) {
    const bracket = CHEST_GUARD_TARGET_BRACKETS.find(b => floor <= b.maxFloor) || CHEST_GUARD_TARGET_BRACKETS[CHEST_GUARD_TARGET_BRACKETS.length - 1];
    return bracket.min + Math.floor(Math.random() * (bracket.max - bracket.min + 1));
}
// Reemplazo de guardianes: si mueren atraídos LEJOS del cofre (no cuentan
// para el progreso), reaparecen rápido; si mueren DENTRO de la zona (sí
// cuentan) y aún falta población, reaparecen más lento.
const CHEST_GUARD_REPLACE_DELAY_OUTSIDE_MS = [2000, 3000];
const CHEST_GUARD_REPLACE_DELAY_INSIDE_MS = [5000, 10000];

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
const STAT_POINTS_PER_LEVEL = 10; // puntos de estadística otorgados en cada level up

// ----- XP REQUERIDO POR NIVEL (dificultad escalante) -----
// XP_Requerido_Nivel = 100 × Multiplicador_Rango × Nivel^1.2, donde "Nivel"
// es el nivel AL QUE SE SUBE (ej. "Nivel 50→51" usa Nivel=51). El Rango
// (0-indexado) agrupa de a 100 niveles y sube el multiplicador +0.5 cada
// uno: Rango 0 (niveles 1-100) = x1.0, Rango 1 (101-200) = x1.5, ...,
// Rango 9 (901-1000) = x5.5. _xpFormulaForLevel es la fórmula "cruda", sin
// la excepción del Nivel 1000 (para poder usarla al precalcular el total).
function _xpFormulaForLevel(level) {
    const rango = Math.floor((level - 1) / 100);
    const rangoMult = 1.0 + rango * 0.5;
    return Math.round(100 * rangoMult * Math.pow(level, 1.2));
}

// Precalculado una sola vez al cargar el script: suma del XP requerido para
// las 998 transiciones de Nivel 1 a Nivel 999 (Nivel 2 hasta Nivel 999; no
// existe una transición "a" Nivel 1, ahí arranca el jugador). El Nivel 1000
// exige exactamente este mismo total (ver getXPRequiredForLevel más abajo),
// haciendo del último nivel el salto más difícil del juego por lejos.
const TOTAL_XP_LEVELS_1_TO_999 = (() => {
    let total = 0;
    for (let level = 2; level <= 999; level++) total += _xpFormulaForLevel(level);
    return total;
})();

function getXPRequiredForLevel(level) {
    if (level >= MAX_LEVEL) return TOTAL_XP_LEVELS_1_TO_999;
    return _xpFormulaForLevel(level);
}

// ----- XP OTORGADO POR ENEMIGO -----
// XP_por_enemigo = 10 × Piso × Multiplicador_Rareza × Escala_Minijefe_Jefe.
// XP_RARITY_MULT es una escala PROPIA para XP (distinta del `.mult` de
// MONSTER_RARITIES, que se usa para daño/vida de combate). "Jefe de Piso"
// (x3.0) cubre tanto al jefe dinámico (BOSS_TIERS.jefe) como al jefe
// generado al crear el piso (jefe_especial/jefe_aleatorio, ver
// grid-dungeon.js) — el diseño solo distingue 4 categorías, no 5.
const XP_RARITY_MULT = {
    comun: 1.0, poco_comun: 1.2, raro: 1.4, epico: 1.6, legendario: 1.8, mitico: 2.0,
};
const BOSS_XP_SCALE = {
    minijefe: 2.0, jefe: 3.0, jefe_especial: 3.0, jefe_aleatorio: 3.0, jefe_final: 5.0,
};
function getEnemyXPReward(floor, rarityId, bossKind) {
    const rarityMult = XP_RARITY_MULT[rarityId] || 1.0;
    const bossMult = BOSS_XP_SCALE[bossKind] || 1.0;
    return Math.round(10 * floor * rarityMult * bossMult);
}

// ----- MULTIPLICADOR POR TAMAÑO DE GRUPO (compartido: loot y oro) -----
// El "grupo" es la cantidad de enemigos vivos cerca del que se derrota en
// ESE instante (ver RT_ENGAGE_GROUP_RADIUS más abajo), recalculado en cada
// muerte ya que en combate en tiempo real no existe un "combate" con
// composición fija. 1-2 enemigos no reciben bono.
const GROUP_LOOT_MULT = { 3: 1.6, 4: 1.6, 5: 1.7, 6: 1.8, 7: 1.9, 8: 2.0 };
function getGroupMultiplier(groupSize) {
    if (groupSize >= 8) return 2.0;
    return GROUP_LOOT_MULT[groupSize] || 1.0;
}

// ----- ORO OTORGADO POR ENEMIGO -----
// Oro_Base = Piso_Actual × Multiplicador_Tier ± 10% (el Multiplicador_Tier
// se duplica cada 100 pisos: Tier1=x1 .. Tier10=x512, ver
// getMaterialTierForFloor más abajo, mismos 10 brackets de 100 pisos).
// Oro_Final = Oro_Base × Multiplicador_Tipo × Multiplicador_Rareza ×
// Multiplicador_Grupo. "Jefe de Piso" (x50) cubre jefe/jefe_especial/
// jefe_aleatorio, igual que en getEnemyXPReward. La Rareza reusa
// XP_RARITY_MULT (mismos valores 1.0-2.0 para XP y oro).
const GOLD_TYPE_MULT = {
    minijefe: 10, jefe: 50, jefe_especial: 50, jefe_aleatorio: 50, jefe_final: 100,
};
function getGoldTierMultiplier(floor) {
    return Math.pow(2, Math.floor((floor - 1) / 100));
}
function getEnemyGoldReward(floor, rarityId, bossKind, groupSize) {
    const base = floor * getGoldTierMultiplier(floor);
    const rolled = base * (0.9 + Math.random() * 0.2); // ±10%
    const typeMult = GOLD_TYPE_MULT[bossKind] || 1.0;
    const rarityMult = XP_RARITY_MULT[rarityId] || 1.0;
    const groupMult = getGroupMultiplier(groupSize || 1);
    return Math.max(1, Math.round(rolled * typeMult * rarityMult * groupMult));
}

// Formato abreviado para mostrar oro en la UI (0-999 exacto, K desde 1000,
// M desde 1,000,000; sin decimales si el K/M cae en un número redondo).
function formatGold(amount) {
    amount = Math.floor(amount);
    if (amount < 1000) return String(amount);
    const suffix = amount < 1000000 ? 'K' : 'M';
    const divisor = amount < 1000000 ? 1000 : 1000000;
    const value = amount / divisor;
    const rounded = Math.round(value * 10) / 10;
    return (Number.isInteger(rounded) ? rounded : rounded.toFixed(1)) + suffix;
}

// Valor exacto con separador de miles (para la ventana de precisión, ver
// ui.js renderGoldPrecision).
function formatGoldExact(amount) {
    return Math.floor(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

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

// ----- TEMÁTICA DE BIOMAS POR TIER (identidad visual de piso) -----
// Un tier por cada 100 pisos (mismo bracket que MATERIAL_TIER_BRACKETS).
// Alcance: color, terreno (piso) e iluminación (tinte ambiental) son
// directamente renderizables con el motor actual (canvas, sin sprites);
// la "decoración" (props/estructuras únicas) NO se implementa — requeriría
// un sistema nuevo de colocación de props que este juego no tiene.
const BIOME_THEMES = [
    { tierId: 1,  bioma: 'Cavernas de Bronce',      terreno: 'Piedra parda y tierra',       iluminacion: 'Antorchas cálidas y tenues', wallColor: '#2b1f14', floorColor: '#3E5927', ambientTint: 'rgba(205,127,50,0.05)' },
    { tierId: 2,  bioma: 'Minas de Hierro',         terreno: 'Roca gris y vetas metálicas',  iluminacion: 'Luz fría de faroles',        wallColor: '#24262b', floorColor: '#33363d', ambientTint: 'rgba(192,192,192,0.05)' },
    { tierId: 3,  bioma: 'Fortaleza de Acero',      terreno: 'Losas de acero pulido',        iluminacion: 'Luz industrial azulada',     wallColor: '#1f2225', floorColor: '#2c3034', ambientTint: 'rgba(113,121,126,0.05)' },
    { tierId: 4,  bioma: 'Abismo Infernal',         terreno: 'Roca volcánica y ceniza',      iluminacion: 'Resplandor rojizo de lava',  wallColor: '#2a0f08', floorColor: '#451708', ambientTint: 'rgba(255,90,31,0.08)' },
    { tierId: 5,  bioma: 'Grutas de Mithril',       terreno: 'Cristal azulado y escarcha',   iluminacion: 'Brillo helado y difuso',     wallColor: '#10202b', floorColor: '#16303f', ambientTint: 'rgba(142,207,255,0.07)' },
    { tierId: 6,  bioma: 'Templo de Orichalcum',    terreno: 'Mármol dorado tallado',        iluminacion: 'Luz cálida ceremonial',      wallColor: '#2b1d08', floorColor: '#3d2a0c', ambientTint: 'rgba(255,179,71,0.06)' },
    { tierId: 7,  bioma: 'Bóveda Adamantina',       terreno: 'Placas turquesa reforzadas',   iluminacion: 'Resplandor cian estable',    wallColor: '#082825', floorColor: '#0e3c37', ambientTint: 'rgba(111,227,217,0.07)' },
    { tierId: 8,  bioma: 'Dominio Sombrío',         terreno: 'Piedra negra veteada',         iluminacion: 'Penumbra violeta',           wallColor: '#150a22', floorColor: '#1f1033', ambientTint: 'rgba(91,42,134,0.10)' },
    { tierId: 9,  bioma: 'Santuario Celestial',     terreno: 'Mármol blanco luminoso',       iluminacion: 'Luz dorada radiante',        wallColor: '#2b2607', floorColor: '#3d3610', ambientTint: 'rgba(255,224,102,0.08)' },
    { tierId: 10, bioma: 'Vacío Absoluto',          terreno: 'Superficie cristalina cian',   iluminacion: 'Resplandor cian pulsante',   wallColor: '#08272b', floorColor: '#0d3a40', ambientTint: 'rgba(125,249,255,0.10)' },
];

// Piso especial (ver SISTEMA DE TABERNA en game.js/grid-dungeon.js): no
// sigue la progresión de Tier del piso, tiene su propia temática fija
// (madera cálida, luz de fogata) reusando la misma forma que BIOME_THEMES
// para que currentBiome funcione sin cambios en render()/loadFloor().
const TABERNA_THEME = {
    tierId: 0,
    bioma: 'La Taberna del Descanso',
    terreno: 'Tablones de madera pulida',
    iluminacion: 'Luz cálida de fogata y antorchas',
    wallColor: '#241608',
    floorColor: '#3a2410',
    ambientTint: 'rgba(255,166,64,0.10)',
};

function getBiomeForFloor(floor) {
    const tierId = getMaterialTierForFloor(floor);
    return BIOME_THEMES.find(b => b.tierId === tierId) || BIOME_THEMES[0];
}

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

// ----- PROFESIONES (11) -----
// type: combat | combat_ranged | combat_block | gather | passive | craft
// Las profesiones de tipo "gather" nunca se equipan: suben de nivel y están
// siempre disponibles para recolectar, sin importar el arma de combate activa.
const PROFESSIONS = [
    { id: 'picaro',     name: 'PÍCARO',     emoji: '🗡️', type: 'combat',        weaponLabel: 'Daga',              desc: 'Alta probabilidad de crítico, penetración de armadura', baseDamage: 9 },
    { id: 'guerrero',   name: 'GUERRERO',   emoji: '⚔️', type: 'combat',        weaponLabel: 'Espada',            desc: 'Daño muy alto, acumula Poder',    baseDamage: 16 },
    { id: 'barbaro',    name: 'BÁRBARO',    emoji: '🪓', type: 'combat',        weaponLabel: 'Hacha de Batalla',  desc: 'Daño medio-alto, Sed de Sangre',  baseDamage: 13 },
    { id: 'mago',       name: 'MAGO',       emoji: '🧙', type: 'combat',        weaponLabel: 'Báculo',            desc: 'Amplificación Arcana a distancia', baseDamage: 12 },
    { id: 'lenador',    name: 'LEÑADOR',    emoji: '🌲', type: 'gather',        weaponLabel: 'Hacha de Leña',     desc: 'Recolección: madera',             baseDamage: 6,  resource: 'tree' },
    { id: 'arquero',    name: 'ARQUERO',    emoji: '🏹', type: 'combat_ranged', weaponLabel: 'Arco',              desc: 'Requiere flechas, sistema de Enfoque', baseDamage: 8,  range: 320 },
    { id: 'minero',     name: 'MINERO',     emoji: '⛏️', type: 'gather',        weaponLabel: 'Pico',              desc: 'Recolección: minerales',          baseDamage: 6,  resource: 'rock' },
    { id: 'campesino',  name: 'CAMPESINO',  emoji: '👨‍🌾', type: 'gather',      weaponLabel: 'Azada',             desc: 'Recolección: cultivos',           baseDamage: 6,  resource: 'plant' },
    { id: 'armadura',   name: 'ARMADURA',   emoji: '🛡️', type: 'passive',      weaponLabel: 'Armadura',          desc: 'Defensa pasiva',                  baseDamage: 0 },
    { id: 'tanque',     name: 'TANQUE',     emoji: '🔨', type: 'combat_block', weaponLabel: 'Martillo y Escudo', desc: 'Defensa y control, sistema de Resistencia', baseDamage: 6 },
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
// diseño (Desarmado) no tienen bono de clase (0%).
const WEAPON_CRIT_BASE = {
    arquero: 0.15,   // Arcos
    picaro: 0.12,    // Dagas
    barbaro: 0.08,   // Hachas
    mago: 0.05,      // Báculos
    tanque: 0.04,    // Martillos (Tanque)
    guerrero: 0.03,  // Claymores/Espadas
};
function getWeaponCritBase(profId) { return WEAPON_CRIT_BASE[profId] || 0; }

// ----- EMOJIS DE INVENTARIO -----
// El ícono de cada arma/armadura en el inventario es directamente
// prof.emoji (ver PROFESSIONS) en vez del emoji de Tier; las monturas usan
// el emoji genérico 🐴 (no el propio de cada montura, ver MOUNTS en
// mounts.js) para mantener un solo ícono de categoría.
const MOUNT_INVENTORY_EMOJI = '🐴';

// Ícono por Rareza (reemplaza el texto "· Épico" en el nombre del ítem).
const RARITY_EMOJI = {
    comun: '⚪', poco_comun: '🟢', raro: '🔵', epico: '🟣', legendario: '🟠', mitico: '✨',
};
function getRarityEmoji(rarityId) { return RARITY_EMOJI[rarityId] || '⚪'; }

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
// `dmg`: reescalado para que el piso 1 (Esqueleto/Zombie/Goblin/Lobo) caiga
// en el rango pedido (15-20 de daño); el resto de los pisos se escaló por
// el MISMO factor (~2.45x) para preservar la curva de progresión original
// sin crear un salto hacia abajo al cruzar de un pool al siguiente (ver
// getScaledEnemyStats en floors.js, que sigue aplicando +10%/piso encima de
// esto). `attackRange`: alcance de ataque cuerpo a cuerpo propio de cada
// tipo (70-100px, todos distintos, ver Enemy.update en enemy.js) — el Jefe
// Final tiene su propio rango fijo de 150px (ver spawnFinalBossEntity).
const ENEMY_TYPES = [
    // --- Piso 1-10 ---
    { id: 'esqueleto', name: 'Esqueleto', emoji: '💀', hp: 30, dmg: 19, xp: 12, color: '#d8d3c0', radius: 16, defense: 0, attackRange: 80 },
    { id: 'zombie', name: 'Zombie', emoji: '🧟', hp: 38, dmg: 17, xp: 12, color: '#5a7a4a', radius: 17, defense: 0, attackRange: 75 },
    { id: 'goblin', name: 'Goblin', emoji: '👺', hp: 24, dmg: 20, xp: 11, color: '#6a8a3a', radius: 15, defense: 0, attackRange: 90 },
    { id: 'lobo', name: 'Lobo', emoji: '🐺', hp: 22, dmg: 15, xp: 8, color: '#8b6f47', radius: 16, defense: 0, attackRange: 95 },

    // --- Piso 11-20 ---
    { id: 'vampiro', name: 'Vampiro', emoji: '🧛', hp: 50, dmg: 29, xp: 25, color: '#7a1f3d', radius: 17, defense: 0, attackRange: 85 },
    { id: 'troll', name: 'Troll', emoji: '👹', hp: 75, dmg: 39, xp: 30, color: '#3d6b2f', radius: 22, defense: 0, attackRange: 70 },
    { id: 'fantasma', name: 'Fantasma', emoji: '👻', hp: 28, dmg: 27, xp: 20, color: '#c9c9e8', radius: 16, defense: 0, attackRange: 100 },

    // --- Piso 21-30 ---
    { id: 'demonio', name: 'Demonio', emoji: '😈', hp: 140, dmg: 64, xp: 55, color: '#8a1f1f', radius: 19, defense: 0, attackRange: 78 },
    { id: 'hombre_lobo', name: 'Hombre Lobo', emoji: '🐗', hp: 120, dmg: 73, xp: 55, color: '#5a4a3a', radius: 20, defense: 0, attackRange: 92 },
    { id: 'sombra', name: 'Sombra', emoji: '🌑', hp: 100, dmg: 69, xp: 50, color: '#2a1a3a', radius: 17, defense: 0, attackRange: 83 },

    // --- Piso 31-50 ---
    { id: 'lich', name: 'Lich', emoji: '🧙', hp: 220, dmg: 98, xp: 90, color: '#3a2f5a', radius: 19, defense: 0, attackRange: 97 },
    { id: 'espectro', name: 'Espectro', emoji: '🌫️', hp: 190, dmg: 103, xp: 85, color: '#8a9ac9', radius: 17, defense: 0, attackRange: 88 },
    { id: 'wyvern', name: 'Wyvern', emoji: '🐲', hp: 260, dmg: 93, xp: 95, color: '#2f6b4a', radius: 23, defense: 0, attackRange: 73 },

    // --- Piso 51-100 ---
    { id: 'archilich', name: 'Archilich', emoji: '☠️', hp: 450, dmg: 171, xp: 180, color: '#4a1f6a', radius: 20, defense: 0, attackRange: 81 },
    { id: 'entidad_vacio', name: 'Entidad del Vacío', emoji: '🕳️', hp: 420, dmg: 184, xp: 190, color: '#0a0a1a', radius: 19, defense: 0, attackRange: 94 },
    { id: 'leviatan', name: 'Leviatán', emoji: '🐋', hp: 600, dmg: 159, xp: 200, color: '#1a4a6a', radius: 26, defense: 0, attackRange: 76 },

    // --- Piso 101-200 ---
    { id: 'dragon_antiguo', name: 'Dragón Antiguo', emoji: '🐉', hp: 900, dmg: 318, xp: 400, color: '#6a1f1f', radius: 27, defense: 0, attackRange: 89 },
    { id: 'elemental_caos', name: 'Elemental del Caos', emoji: '🌀', hp: 850, dmg: 343, xp: 420, color: '#8a2f8a', radius: 21, defense: 0, attackRange: 72 },
    { id: 'abominacion', name: 'Abominación', emoji: '🧟‍♂️', hp: 1000, dmg: 294, xp: 410, color: '#4a5a2a', radius: 24, defense: 0, attackRange: 99 },

    // --- Piso 201-1000 (entidades cósmicas) ---
    { id: 'heraldo_cosmico', name: 'Heraldo Cósmico', emoji: '✨', hp: 1600, dmg: 539, xp: 800, color: '#2a2a6a', radius: 22, defense: 0, attackRange: 84 },
    { id: 'devorador_estrellas', name: 'Devorador de Estrellas', emoji: '🌠', hp: 1700, dmg: 563, xp: 820, color: '#1a1a3a', radius: 23, defense: 0, attackRange: 77 },
    { id: 'guardian_vacio', name: 'Guardián del Vacío', emoji: '🌌', hp: 1650, dmg: 514, xp: 810, color: '#0a0a2a', radius: 24, defense: 0, attackRange: 96 },
    { id: 'entidad_primordial', name: 'Entidad Primordial', emoji: '🔮', hp: 1800, dmg: 588, xp: 850, color: '#4a1a4a', radius: 25, defense: 0, attackRange: 71 },
];

function getEnemyType(id) { return ENEMY_TYPES.find(e => e.id === id); }

// ----- ESCALADO DE DAÑO DE ENEMIGOS POR PISO (pedido explícito del usuario) -----
// "Cada piso ≈ 1 nivel del jugador": el nivel TEÓRICO en el piso F es F-1
// (el jugador arranca en nivel 0 en el piso 1 — mismo criterio que
// Player.recalcMaxHp: maxHp = 100 + nivel*10). Esta es la vida TEÓRICA usada
// solo para calibrar el daño de los enemigos, sin constitución/comida/etc —
// el propio pedido aclara que en la práctica el jugador puede tener más
// vida real (constitución) y menos daño real recibido (resistencias de
// armadura/habilidades), esto es solo la vara de medir para el daño base.
function getTheoreticalPlayerMaxHp(floor) {
    return 100 + (floor - 1) * 10;
}
// Golpes que un enemigo COMÚN necesita para matar al jugador: arranca en 20
// (pisos 1-100) y baja 1 golpe cada 100 pisos (piso 901 -> 20-9=11, ejemplo
// dado por el usuario) — mínimo 1 golpe (nunca menos, evita que la fórmula
// se vuelva absurda en pisos muy altos).
function getCommonHitsToKill(floor) {
    const block = Math.floor((floor - 1) / 100);
    return Math.max(1, 20 - block);
}
// Daño de un enemigo COMÚN en este piso: la vida teórica del jugador entre
// los golpes que le toma matarlo — NO depende del tipo de monstruo (todo
// común en el mismo piso hace el mismo daño, ver getScaledEnemyStats en
// floors.js, que reemplaza la vieja fórmula lineal sobre el dmg propio de
// cada ENEMY_TYPES). El resto de rarezas/jefes son un múltiplo FIJO de este
// valor (ver MONSTER_RARITIES[].dmgMult/BOSS_TIERS.dmgMult), calibrado con
// los anclajes de piso 1 dados por el usuario: común=5, poco común=6,
// raro=7, épico=8, legendario=9, mítico=10, minijefe=11, jefe=15, jefe
// final=20 -> ratios 1.0/1.2/1.4/1.6/1.8/2.0/2.2/3.0/4.0 sobre el común.
function getCommonEnemyDamageForFloor(floor) {
    return getTheoreticalPlayerMaxHp(floor) / getCommonHitsToKill(floor);
}

// ----- RAREZA DE MONSTRUOS (6 niveles) -----
// Se sortea una vez por enemigo al generarlo (ver loadFloor en game.js).
// `mult`: bono de HP, 10% más fuerte que el anterior, en cadena (1.10^n) —
// SIN CAMBIOS, el pedido no dio una fórmula de vida, solo de daño.
// `dmgMult`: bono de DAÑO — separado de `mult` a propósito (mismo criterio
// que BOSS_TIERS.dmgMult) porque ahora sigue una curva LINEAL distinta
// (1.0/1.2/1.4/.../2.0, +20% del daño de un común por nivel de rareza),
// pedida explícitamente por el usuario, ver getCommonEnemyDamageForFloor.
// `attackIntervalMs`: cada cuánto ataca (ver Combat.updateRealtime) — NO
// depende del nivel/piso, solo de la rareza (a mayor rareza, más rápido).
const MONSTER_RARITIES = [
    { id: 'comun',       name: 'Común',       color: '#9a9a9a', chance: 50,  mult: 1,             dmgMult: 1.0, attackIntervalMs: 1000 },
    { id: 'poco_comun',  name: 'Poco Común',  color: '#3ecf5e', chance: 30,  mult: 1.1,           dmgMult: 1.2, attackIntervalMs: 900 },
    { id: 'raro',        name: 'Raro',        color: '#3f9dff', chance: 13,  mult: 1.1 ** 2,      dmgMult: 1.4, attackIntervalMs: 800 },
    { id: 'epico',       name: 'Épico',       color: '#a64fff', chance: 5,   mult: 1.1 ** 3,      dmgMult: 1.6, attackIntervalMs: 700 },
    { id: 'legendario',  name: 'Legendario',  color: '#ffcf3f', chance: 1.5, mult: 1.1 ** 4,      dmgMult: 1.8, attackIntervalMs: 600 },
    { id: 'mitico',      name: 'Mítico',      color: '#e93cff', chance: 0.5, mult: 1.1 ** 5,      dmgMult: 2.0, attackIntervalMs: 500 },
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
// mult: multiplicador de HP/XP sobre el enemigo base ya escalado al piso —
// SIN CAMBIOS, el pedido no dio una fórmula de vida para jefes.
// dmgMult: multiplicador de DAÑO sobre el daño de un COMÚN en ese piso (ver
// getCommonEnemyDamageForFloor) — recalibrado a los anclajes de piso 1
// dados por el usuario: minijefe=11 (11/5=2.2), jefe=15 (15/5=3.0), jefe
// final=20 (20/5=4.0, ver spawnFinalBossEntity: es el pico del rango de 10
// pisos, con rangeFactor 0.5-1.0 según qué tan adentro esté ese piso).
// radiusMult: qué tan grande es el círculo respecto a un enemigo normal.
// chance: probabilidad de aparecer cada vez que se elimina 1 enemigo (minijefe/jefe).
const BOSS_TIERS = {
    minijefe:   { label: 'Minijefe',           rarities: ['poco_comun', 'raro'], mult: 2,  dmgMult: 2.2, chance: 0.20, radiusMult: 1.5 },
    jefe:       { label: 'Jefe',               rarities: ['epico', 'legendario'], mult: 4,  dmgMult: 3.0, chance: 0.10, radiusMult: 2 },
    jefe_final: { label: 'Jefe Final',          rarities: ['mitico'],              mult: 10, dmgMult: 4.0, radiusMult: 3 },
};

// ===== HABILIDADES DE JEFE (minijefe/jefe/jefe final) EN TIEMPO REAL =====
// Meta final del pedido: minijefe 1 habilidad, jefe 2, jefe final 3 — pero
// por ahora solo existen 2 habilidades implementadas (embestida/terremoto),
// así que minijefes Y jefes reciben 1 sola, elegida al azar entre las 2,
// para probarlas primero (pedido explícito del usuario, ver
// spawnDynamicBoss en game.js). El jefe final todavía no recibe ninguna.
//
// Embestida Monstruosa: 1s de carga (círculo externo que se achica hasta
// tocar al enemigo, ver telegraphExtraRadius) inmóvil, luego dash de
// dashRange px hacia el jugador en dashDurationMs — SIEMPRE dura ese
// tiempo fijo (se acorta la distancia recorrida si topa con una pared
// antes, no el tiempo, mismo criterio que los dashes del jugador). A
// cualquiera que toque en el camino le hace dashDmg de daño (daño directo,
// sin bloqueo/esquiva — "a cualquier jugador que toque", no "ataque").
//
// Terremoto: misma carga de 1s inmóvil. Al terminar, el enemigo se queda
// QUIETO EN EL CENTRO (corrección del usuario: NO queda libre de moverse
// hasta que termine toda la secuencia) mientras 4 bandas concéntricas se
// activan una por una, de adentro hacia afuera: la primera a los 0.2s, y
// cada una siguiente 1s después de la anterior. Visualmente cada banda se
// ve como un círculo que CRECE desde el borde interior hasta el borde
// exterior de esa banda (una "carga" continua, no un anillo estático) —
// al tocar el borde, la banda se activa: ringDmg de daño + ralentiza
// slowPercent por slowDurationMs a quien esté dentro en ese instante (ver
// Combat.tickBossCast, fase 'earthquake'). Un solo color para las 4 (el
// usuario aclaró que los colores de la imagen de referencia eran solo
// para explicar el orden, no para usar de verdad): rojo carmesí oscuro.
// cooldownMs/initialDelayMs no se especificaron para esta habilidad — se
// reutilizaron los mismos valores que Embestida (10s/3s) por consistencia.
const BOSS_ABILITIES = {
    embestida: {
        id: 'embestida', name: 'Embestida Monstruosa', color: '#ff5c5c',
        chargeMs: 1000, telegraphExtraRadius: 60,
        dashRange: 700, dashDurationMs: 500, dashDmg: 50,
        cooldownMs: 10000, initialDelayMs: 3000,
    },
    terremoto: {
        id: 'terremoto', name: 'Terremoto', color: '#8b0000',
        chargeMs: 1000, telegraphExtraRadius: 60,
        ringRadii: [100, 200, 300, 400],
        ringActivateDelaysMs: [200, 1200, 2200, 3200],
        ringDmg: 30,
        slowPercent: 0.30, slowDurationMs: 2000,
        cooldownMs: 10000, initialDelayMs: 3000,
    },
    // Rayo Arcano: el enemigo queda INMÓVIL toda la duración (igual que
    // Terremoto). 3 repeticiones independientes de "carga (1s, el rayo
    // SIGUE la posición del jugador en cada frame) -> disparo (0.5s)",
    // con 0.5s de pausa entre cada una. Geometría: 2 líneas de `range`
    // (1000px), separadas `lineSeparation` (30px) entre sí, que se van
    // CERRANDO durante el segundo de carga (30px -> 0, "hasta tocarse") y
    // luego se vuelven a ABRIR durante los 0.5s de disparo (0 -> 30px) —
    // el daño se aplica al terminar de abrirse (fin del disparo), no
    // continuamente durante la animación (mismo criterio de "un solo
    // golpe por evento" que Embestida/Terremoto). Tras dispararse, el
    // rayo queda visible lingerMs (0.2s) más, titilando (alternando
    // opacidad), antes de pasar a la pausa entre repeticiones. El
    // relleno semitransparente entre las líneas se dibuja durante el
    // disparo Y mientras titila (creciendo junto con la separación, ya
    // totalmente abierto durante el titileo). Azul neón, pedido explícito.
    rayo: {
        id: 'rayo', name: 'Rayo Arcano', color: '#00e5ff',
        chargeMs: 1000, fireMs: 500, lingerMs: 200, gapMs: 500, repeats: 3,
        range: 1000, lineSeparation: 30, dmg: 50,
        cooldownMs: 10000, initialDelayMs: 3000,
    },
};
function getRandomBossAbilityId() {
    const ids = Object.keys(BOSS_ABILITIES);
    return ids[Math.floor(Math.random() * ids.length)];
}

// ===== HABILIDADES #2 DE JEFE (solo jefe/jefe final — "los minijefes solo
// pueden tener habilidades #1", pedido explícito) =====
//
// Impenetrable: al cruzar por DEBAJO de triggerHpPercent (40%, sin ser
// golpe letal) o al recibir un golpe que lo mataría (red de seguridad: se
// salva con safetyNetHpPercent de vida en vez de morir), activa un escudo
// de durationMs (3s): inmóvil, cura healPercentPerTick (5%) cada
// healTickMs (0.5s) — 6 tics = 30% total — y todo daño desde FUERA de
// `radius` (200px) se anula por completo (ver Enemy.takeDamage). Si
// ESTANDO el escudo activo el jugador golpea desde DENTRO del radio con
// un golpe que sería letal, el escudo se cancela y muere de verdad (evita
// inmortalidad infinita). Visual: 2 círculos — uno a radius-5 (195px,
// SOLO visual, gira horario) y otro a radius (200px, el límite real,
// gira antihorario) — pedido explícito. Tras usarse, no puede reactivarse
// hasta que la vida vuelva a superar el 40% (se "rearma", ver
// Enemy.update) Y pasen cooldownMs (10s) desde la activación.
//
// División Celular: al "morir" (tier0, el jefe original), en vez de morir
// de verdad se divide en 2 (tier1), cada uno con tier1HpPercent (50%) de
// la vida máxima ORIGINAL — retienen la habilidad #1 asignada Y división
// celular (para poder volver a dividirse). Al morir CADA tier1, se
// divide en 2 tier2 (4 en total), cada uno con tier2HpPercent (25%) de la
// vida máxima ORIGINAL — YA NO tienen habilidad #1 ni división celular
// (no se dividen más), pero ganan tier2SpeedBonusPercent (+50%) de
// velocidad de movimiento. Recién cuando MUEREN las 4 versiones tier2 se
// otorga el loot/XP real (una sola vez, como si fuera 1 kill — ver
// Combat.onEnemyDefeated/spawnDivisionClones).
//
// Frenesí Sangriento: al cruzar por debajo de triggerHpPercent (50%),
// durante durationMs (5s) ataca a los ENEMIGOS MÁS CERCANOS (no al
// jugador) con +dmgBonusPercent (50%) de daño y lifestealPercent (100%)
// de robo de vida, y se mueve +speedBonusPercent (50%) más rápido. Por
// cada enemigo que mate en este estado: cura killHealPercent (10%) de su
// vida máxima y reduce el cooldown en curso killCooldownReduceMs (0.5s).
// cooldownMs (10s) arranca a contar desde la ACTIVACIÓN (no desde que
// termina) — se resetea/rearma igual que Impenetrable, solo con su
// propio umbral (50%). detectRange/attackRange no se especificaron —
// valores AJUSTABLES, iguales a rangos ya usados en el resto del juego.
const BOSS_ABILITIES_2 = {
    impenetrable: {
        id: 'impenetrable', name: 'Impenetrable', color: '#ffd700',
        triggerHpPercent: 0.40, durationMs: 3000, radius: 200, visualInnerRadius: 195,
        healPercentPerTick: 0.05, healTickMs: 500,
        cooldownMs: 10000, safetyNetHpPercent: 0.01,
    },
    division_celular: {
        id: 'division_celular', name: 'División Celular', color: '#7cff7c',
        tier1HpPercent: 0.50, tier2HpPercent: 0.25, tier2SpeedBonusPercent: 0.50,
    },
    frenesi: {
        id: 'frenesi', name: 'Frenesí Sangriento', color: '#ff2b2b',
        triggerHpPercent: 0.50, durationMs: 5000,
        speedBonusPercent: 0.50, lifestealPercent: 1.0, dmgBonusPercent: 0.50,
        killHealPercent: 0.10, killCooldownReduceMs: 500,
        cooldownMs: 10000, detectRange: 400, attackRange: 60,
    },
};
function getRandomBossAbility2Id() {
    const ids = Object.keys(BOSS_ABILITIES_2);
    return ids[Math.floor(Math.random() * ids.length)];
}

// ===== HABILIDADES #3 DE JEFE (SOLO jefe final) =====
//
// Caos Dimensional: el jefe final queda INMÓVIL toda la duración (mismo
// mecanismo que Terremoto/Rayo Arcano — congela en.update() por completo,
// ver Combat.updateRealtime) mientras corren DOS secuencias en paralelo,
// cada una repitiéndose 5 veces:
//   1. "rayo": el MISMO Rayo Arcano de la habilidad #1 (ver BOSS_ABILITIES.
//      rayo) pero al DOBLE de velocidad (todos sus tiempos a la mitad:
//      carga, disparo, titileo, pausa) y 5 repeticiones en vez de 3 —
//      reutiliza toda la lógica/render ya hechos para Rayo Arcano, solo
//      operando sobre un sub-estado propio (cast.rayo) en vez de
//      en.bossCast directamente.
//   2. "zona": una zona arcana que aparece SOBRE el jugador, empieza en
//      growStartRadius (50px) y crece hasta growEndRadius (150px) en
//      growMs (1s) SIGUIENDO al jugador mientras crece; al llegar a
//      150px queda ESTÁTICA donde haya quedado y titila flickerMs (0.5s);
//      luego se retrae a retractRadius (30px) en retractMs (0.1s); al
//      llegar a 30px EXPLOTA en un radio de explosionRadius (300px, misma
//      animación de círculo creciente que el Ataque 3 del jugador, tecla
//      "Espacio", ver el efecto 'circle' ya usado en todo el juego) —
//      explosionDmg no se especificó, se usó 60 (más que Embestida/Rayo,
//      es la "ultimate" del jefe final — AJUSTABLE). gapAfterExplosionMs
//      (1s) después, una nueva zona arcana nace sobre el jugador otra vez.
// Ambas secuencias corren a la vez; la habilidad completa dura hasta que
// AMBAS terminen sus 5 repeticiones (la que termine antes simplemente
// espera a la otra). Cura healPercentPerSec (5%) de vida máxima cada
// healTickMs (1s) durante TODA la duración. Al terminar, cooldownMs (10s)
// — igual patrón de "disponible 3s después de entrar en combate" que el
// resto de habilidades activas (initialDelayMs). Color no especificado:
// violeta "dimensional", AJUSTABLE.
const BOSS_ABILITIES_3 = {
    caos_dimensional: {
        id: 'caos_dimensional', name: 'Caos Dimensional', color: '#b366ff',
        healPercentPerSec: 0.05, healTickMs: 1000,
        rayo: {
            ...BOSS_ABILITIES.rayo,
            chargeMs: BOSS_ABILITIES.rayo.chargeMs / 2,
            fireMs: BOSS_ABILITIES.rayo.fireMs / 2,
            lingerMs: BOSS_ABILITIES.rayo.lingerMs / 2,
            gapMs: BOSS_ABILITIES.rayo.gapMs / 2,
            repeats: 5,
        },
        zona: {
            growStartRadius: 50, growEndRadius: 150, growMs: 1000,
            flickerMs: 500,
            retractRadius: 30, retractMs: 100,
            explosionRadius: 300, explosionDmg: 60,
            gapAfterExplosionMs: 1000,
            repeats: 5,
            color: '#b366ff',
        },
        cooldownMs: 10000, initialDelayMs: 3000,
    },
};
function getRandomBossAbility3Id() {
    const ids = Object.keys(BOSS_ABILITIES_3);
    return ids[Math.floor(Math.random() * ids.length)];
}

// ----- JEFE FINAL: sistema de puntos (desbloqueo) -----
// Derrotar un enemigo normal suma 1 punto, un minijefe suma 10, un jefe (de
// piso o dinámico) suma 20. Al llegar a FINAL_BOSS_POINTS_TARGET queda
// "desbloqueada" la posibilidad de que aparezca: cada enemigo derrotado A
// PARTIR DE AHÍ (sin contar el que cruzó el umbral) suma
// FINAL_BOSS_PERCENT_PER_KILL% de probabilidad de hacerlo aparecer en el
// piso actual del jugador (que siempre cae dentro de "su" rango de 10
// pisos), hasta 100%. El contador se reinicia a 0 apenas aparece (no hace
// falta derrotarlo para que se reinicie, ver contador en el HUD).
const FINAL_BOSS_POINTS_TARGET = 100;
const FINAL_BOSS_NORMAL_POINTS = 1;
const FINAL_BOSS_MINIJEFE_POINTS = 10;
const FINAL_BOSS_JEFE_ESPECIAL_POINTS = 20;
const FINAL_BOSS_PERCENT_PER_KILL = 2; // % que suma cada kill después de llegar a 100/100
function getFinalBossSpawnChancePercent(killsSince100) {
    return Math.min(100, killsSince100 * FINAL_BOSS_PERCENT_PER_KILL);
}

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

// ===== SISTEMA DE ARMADURA (3 piezas: casco/pechera/botas) =====
// Reemplaza la vieja armadura de 1 sola pieza (profId 'armadura', que sigue
// existiendo en PROFESSIONS solo para nombrar la armadura "automática" de
// respaldo cuando no hay NINGUNA pieza equipada, ver Player.getArmorInfo).
// Cada pieza otorga sus PROPIOS bonos (no se comparten entre piezas), según
// su variante de peso y su Rareza — valores dados por el usuario (base =
// Común), escalados +1 nivel de rareza según su propia tabla explícita.
const ARMOR_SLOTS = [
    { id: 'casco', name: 'Casco', emoji: '🪖' },
    { id: 'pechera', name: 'Pechera', emoji: '🦺' },
    { id: 'botas', name: 'Botas', emoji: '🥾' },
];
const ARMOR_PIECE_VARIANTS = {
    ligera: {
        name: 'Ligera', emoji: '🍃',
        statsByRarity: {
            comun:      { defense: 1, dmgBonusPercent: 0.03, hpBonusPercent: 0 },
            poco_comun: { defense: 2, dmgBonusPercent: 0.04, hpBonusPercent: 0 },
            raro:       { defense: 2, dmgBonusPercent: 0.05, hpBonusPercent: 0 },
            epico:      { defense: 3, dmgBonusPercent: 0.06, hpBonusPercent: 0 },
            legendario: { defense: 3, dmgBonusPercent: 0.07, hpBonusPercent: 0 },
            mitico:     { defense: 4, dmgBonusPercent: 0.08, hpBonusPercent: 0 },
        },
    },
    media: {
        name: 'Media', emoji: '⚖️',
        statsByRarity: {
            comun:      { defense: 1, dmgBonusPercent: 0.01, hpBonusPercent: 0.01 },
            poco_comun: { defense: 2, dmgBonusPercent: 0.02, hpBonusPercent: 0.02 },
            raro:       { defense: 2, dmgBonusPercent: 0.03, hpBonusPercent: 0.02 },
            epico:      { defense: 3, dmgBonusPercent: 0.04, hpBonusPercent: 0.03 },
            legendario: { defense: 3, dmgBonusPercent: 0.05, hpBonusPercent: 0.03 },
            mitico:     { defense: 4, dmgBonusPercent: 0.06, hpBonusPercent: 0.04 },
        },
    },
    pesada: {
        name: 'Pesada', emoji: '🛡️',
        statsByRarity: {
            comun:      { defense: 3, dmgBonusPercent: 0, hpBonusPercent: 0.03 },
            poco_comun: { defense: 4, dmgBonusPercent: 0, hpBonusPercent: 0.04 },
            raro:       { defense: 4, dmgBonusPercent: 0, hpBonusPercent: 0.05 },
            epico:      { defense: 5, dmgBonusPercent: 0, hpBonusPercent: 0.06 },
            legendario: { defense: 5, dmgBonusPercent: 0, hpBonusPercent: 0.07 },
            mitico:     { defense: 6, dmgBonusPercent: 0, hpBonusPercent: 0.08 },
        },
    },
};
function getArmorPieceStats(subtype, rarityId) {
    const variant = ARMOR_PIECE_VARIANTS[subtype];
    return variant ? variant.statsByRarity[rarityId] : null;
}
// Costo FIJO para craftear 1 pieza de armadura terminada (casco/pechera/
// botas), sin importar tier/rareza — regla dada explícitamente por el
// usuario, a diferencia del costo de armas/monturas que sí escala con el tier.
const ARMOR_CRAFT_ORE_COST = 30;
const ARMOR_CRAFT_PIECE_COST = 5;

// Nivel MÍNIMO DEL JUGADOR (no del piso) para EQUIPAR una pieza de armadura
// de un material/rareza dados: (tierId-1)*100 + 1 + índiceDeRareza*10.
// Ejemplo dado por el usuario: hierro (tier 2) común=101, raro=121,
// épico=131, legendario=141, mítico=151 (para "poco común" el usuario
// escribió 110, pero sus propios ejemplos de raro/épico/legendario/mítico
// solo son consistentes entre sí con 111 — se usa ese valor, ver resumen).
function getArmorEquipMinLevel(tierId, rarityId) {
    const rarityIdx = Math.max(0, MONSTER_RARITIES.findIndex(r => r.id === rarityId));
    return (tierId - 1) * 100 + 1 + rarityIdx * 10;
}

// Piezas de armadura CRUDAS (materia prima, dropeada por enemigos, ver
// Combat.onEnemyDefeated): id = pieza_<subtipo>_<rareza>_tier<N>, apiladas
// como cualquier material (player.materials) — mismo patrón que los
// núcleos de monstruo. El "nivel" 1-10 de la pieza es el mismo `tierId` de
// TIERS/MATERIAL_TIER_BRACKETS (1 nivel cada 100 pisos).
const ARMOR_PIECE_EMOJI = { ligera: '🍃', media: '⚖️', pesada: '🛡️' };
function getArmorPieceId(subtype, rarityId, tierId) { return `pieza_${subtype}_${rarityId}_tier${tierId}`; }
Object.keys(ARMOR_PIECE_VARIANTS).forEach(subtype => {
    MONSTER_RARITIES.forEach(rarity => {
        TIERS.forEach(t => {
            MATERIAL_INFO[getArmorPieceId(subtype, rarity.id, t.id)] = {
                name: `Pieza ${ARMOR_PIECE_VARIANTS[subtype].name} ${rarity.name} Nv.${t.id}`,
                emoji: ARMOR_PIECE_EMOJI[subtype],
            };
        });
    });
});

// Drop de piezas de EQUIPO (armadura Y arma, ver más abajo
// WEAPON_PIECE_TYPES — "todo el % de drop y funcionamiento es exactamente
// igual" para ambas, pedido explícito) al matar un enemigo (ver
// Combat.onEnemyDefeated): una pieza de rareza R solo puede dropear de un
// enemigo de rareza R o SUPERIOR (ej. una pieza épica puede dropear de un
// enemigo épico, legendario o mítico, nunca de uno común/poco común/raro)
// — por eso se evalúan TODAS las rarezas <= la del enemigo muerto, cada
// una con su propia probabilidad/cantidad, de forma independiente (un
// enemigo mítico puede soltar piezas de varias rarezas distintas en la
// misma muerte). `comun` es un caso especial: 1 pieza GARANTIZADA + 4
// tiradas independientes adicionales al mismo % (dado explícitamente por
// el usuario); el resto es "chance% de soltar algo, y si sale, cantidad
// uniforme entre min y max".
const EQUIPMENT_PIECE_DROP_CONFIG = {
    comun:      { guaranteed: 1, extraRolls: 4, chancePerRoll: 0.40 },
    poco_comun: { chance: 0.40, min: 1, max: 5 },
    raro:       { chance: 0.50, min: 1, max: 5 },
    epico:      { chance: 0.20, min: 1, max: 3 },
    legendario: { chance: 0.20, min: 1, max: 3 },
    mitico:     { chance: 0.10, min: 1, max: 3 },
};
// +3% de probabilidad de drop (a TODAS las piezas de equipo, todas las
// rarezas) cada 10 pisos (piso 11 -> +3%, piso 21 -> +6%, piso 31 -> +9%,
// ejemplo dado por el usuario con el mítico 10%->13%->16%->19%).
function getPieceDropBonusPercent(floor) {
    return 0.03 * Math.floor((floor - 1) / 10);
}

// ===== SISTEMA DE PIEZAS DE ARMA (armas de combate: mago/guerrero/
// picaro/tanque/arquero/barbaro) — mismo patrón que las piezas de
// armadura (drop/rareza/tope por rareza del enemigo/+3% cada 10 pisos, ver
// arriba), solo cambia QUÉ se craftea con ellas: reemplaza el viejo
// crafteo de armas (costo escalado por tier + 1 núcleo) por un costo FIJO
// + piezas, igual criterio que la armadura del pedido anterior. Las
// herramientas de recolección (leñador/minero/campesino) NO tienen pieza
// propia — siguen crafteándose con el sistema viejo (núcleos), ver
// Player.craftItem.
const WEAPON_PIECE_TYPES = {
    mago: { name: 'Báculo', emoji: '🧙' },
    guerrero: { name: 'Espadas', emoji: '⚔️' },
    picaro: { name: 'Dagas', emoji: '🗡️' },
    tanque: { name: 'Martillo y Escudo', emoji: '🔨' },
    arquero: { name: 'Arco', emoji: '🏹' },
    barbaro: { name: 'Hachas', emoji: '🪓' },
};
// Piezas de arma CRUDAS (materia prima, dropeada por enemigos): id =
// pieza_arma_<profId>_<rareza>_tier<N> — el "nivel" 1-10 es el mismo
// tierId de TIERS/MATERIAL_TIER_BRACKETS que las piezas de armadura.
function getWeaponPieceId(profId, rarityId, tierId) { return `pieza_arma_${profId}_${rarityId}_tier${tierId}`; }
Object.keys(WEAPON_PIECE_TYPES).forEach(profId => {
    MONSTER_RARITIES.forEach(rarity => {
        TIERS.forEach(t => {
            MATERIAL_INFO[getWeaponPieceId(profId, rarity.id, t.id)] = {
                name: `Pieza de ${WEAPON_PIECE_TYPES[profId].name} ${rarity.name} Nv.${t.id}`,
                emoji: WEAPON_PIECE_TYPES[profId].emoji,
            };
        });
    });
});
// Costo FIJO para craftear 1 arma de combate terminada (reemplaza
// getCraftMaterialCost para las 6 profesiones de combate — las
// herramientas de recolección siguen con el costo escalado viejo): 25 de
// mena + 25 de madera del tier + 5 piezas de esa MISMA profesión/rareza/tier.
const WEAPON_CRAFT_ORE_COST = 25;
const WEAPON_CRAFT_WOOD_COST = 25;
const WEAPON_CRAFT_PIECE_COST = 5;

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

// ----- PERGAMINO DE ALTERACIÓN (ver SISTEMA DE ZONAS DE JUGADOR en game.js) -----
// Consumible que crea una zona de spawn incrementado (igual mecánica que las
// zonas naturales, ver SPAWN_ZONE_* más abajo) centrada en el jugador. 3
// tiers: la duración depende del tier, no de la rareza/piso donde se use.
const ALTERACION_TIER_DURATIONS_MIN = { 1: 10, 2: 20, 3: 30 };
for (let t = 1; t <= 3; t++) {
    MATERIAL_INFO[`pergamino_alteracion_tier${t}`] = { name: `Pergamino de Alteración Tier ${t}`, emoji: '☢️' };
}

// Chance de drop al derrotar un enemigo: prioriza el tipo (jefe final
// garantizado > jefe de piso > minijefe) sobre la rareza; un enemigo normal
// usa la tabla por rareza.
const ALTERACION_DROP_BY_RARITY = {
    comun:      { chance: 0.01, tier: 1 },
    poco_comun: { chance: 0.02, tier: 1 },
    raro:       { chance: 0.03, tier: 1 },
    epico:      { chance: 0.05, tier: 2 },
    legendario: { chance: 0.10, tier: 2 },
    mitico:     { chance: 0.15, tier: 3 },
};
function getAlteracionDropInfo(rarityId, bossKind) {
    if (bossKind === 'jefe_final') return { chance: 1, tier: 3, guaranteed: true };
    if (bossKind === 'jefe' || bossKind === 'jefe_especial' || bossKind === 'jefe_aleatorio') return { chance: 0.25, tier: 3 };
    if (bossKind === 'minijefe') return { chance: 0.15, tier: 2 };
    return ALTERACION_DROP_BY_RARITY[rarityId] || ALTERACION_DROP_BY_RARITY.comun;
}

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

// Alimentos del Campesino: `version.duration` (foods.js) era "N combates"
// en el viejo sistema por turnos; en tiempo real se traduce a minutos
// reales (ver Player.useFood/tick). 1.5 min ≈ la duración típica de un
// combate anterior.
const FOOD_BUFF_MINUTES_PER_UNIT = 1.5;

// Un mismo alimento no se acumula (ver Player.useFood): solo se puede
// reemplazar por una versión de efecto estrictamente mayor. Como máximo
// FOOD_BUFF_MAX_ACTIVE alimentos DISTINTOS activos a la vez; al comerse uno
// nuevo que supere el límite, se descarta el más viejo (FIFO).
const FOOD_BUFF_MAX_ACTIVE = 5;

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

// ----- COMBATE EN TIEMPO REAL -----
// Reemplaza el viejo combate por turnos (iniciativa/PA/carga máx 3): ahora
// cada ataque tiene su propio cooldown en ms y una carga UNIVERSAL (0-10,
// otorgada por Ataque1 al impactar) gatea el Ataque 3. La carga SECUNDARIA
// de clase (PODER/SED DE SANGRE/ENFOQUE/AMPLIFICACIÓN/RESISTENCIA, máx 3,
// ver Combat.classCharge) se mantiene sin cambios — solo cambia el
// disparador (Ataque1/2 en tiempo real en vez de en el turno).
const RT_CHARGE_MAX = 10;
const RT_CLASS_CHARGE_MAX = 3;
const RT_ENGAGE_GROUP_RADIUS = 90; // enemigos cercanos al que muere, para el multiplicador de loot por grupo

// Cooldown escalable con el nivel del arma/jugador — SOLO aplica al Ataque 1
// (el Ataque 2 ya no es un ataque con cooldown propio, ver RT_TOGGLE_SKILLS
// más abajo; el Ataque 3 no tiene cooldown de tiempo, solo requiere cargas).
// Base por clase (antes era uniforme para todas), reducido progresivamente
// entre nivel 1 (factor 1.0) y nivel MAX_LEVEL (factor 0.1, i.e. -90%).
//   ProgresionGlobal = (nivel - 1) / (MAX_LEVEL - 1)      -> 0 en nivel 1, 1 en nivel MAX_LEVEL
//   CooldownFinal = Base × [0.1 + 0.9 × (1 - ProgresionGlobal)]
const RT_ATTACK1_BASE_COOLDOWN_MS = {
    guerrero: 1000, picaro: 1500, barbaro: 1000, arquero: 1500, mago: 1000, tanque: 1000, desarmado: 1000,
};
function getAttackCooldownMs(profId, slot, level) {
    if (slot !== 0) return 0; // Ataque2: toggle (RT_TOGGLE_SKILLS); Ataque3: sin cooldown base
    const base = RT_ATTACK1_BASE_COOLDOWN_MS[profId] || 1000;
    const lvl = Math.min(Math.max(level || 1, 1), MAX_LEVEL);
    const progresionGlobal = (lvl - 1) / (MAX_LEVEL - 1);
    const factor = 0.1 + 0.9 * (1 - progresionGlobal);
    return base * factor;
}

// ----- ATAQUE 2: HABILIDADES TOGGLE (objetos orbitales/círculo) -----
// El Ataque 2 dejó de ser un ataque de un solo golpe: la tecla "2" ahora
// ACTIVA/DESACTIVA (toggle) una habilidad pasiva por clase que inflige daño
// automáticamente a los enemigos dentro de `radius` cada `tickMs` (propio de
// cada clase), con su propio `dmgBase` escalado por arma/rareza (mismo
// patrón que cualquier otro ataque — ver Combat.tickToggleSkill). Al activar
// se aplica `activateCooldownMs`; al
// desactivar (o cambiar de clase activa) se pierden los stacks.
// Stacks (0-`RT_TOGGLE_STACK_MAX`): +1 por CADA enemigo muerto mientras está
// activa (sin importar qué lo mató). Los campos `*PerStack`/`*Max` definen
// el bono por stack de cada clase (ver Combat.getSkill2*BonusPercent):
//   dmgPct        -> % de daño extra en TODOS los ataques de esa clase (Guerrero/Mago)
//   speedPct      -> % de velocidad de movimiento extra (Pícaro/Arquero)
//   cdMs          -> reducción fija (ms) del cooldown del Ataque 1 (Arquero)
//   critPct       -> % de probabilidad de crítico extra (Pícaro — reemplazó
//                     a cdMs para esta clase, a pedido del usuario)
//   lifestealPct  -> % de robo de vida extra (Bárbaro) — cura, NO aumenta el daño
//   defPct        -> % extra de mitigación de armadura (Tanque)
// La geometría/visual del viejo Ataque2 en RT_ATTACK_GEOMETRY (slot 1) ya NO
// se usa para nada (ni daño ni dibujo) — se deja sin tocar, es dato muerto.
//
// `dmgBase`/`tickMs`: daño del pulso automático y cada cuánto se dispara —
// PROPIOS de la habilidad toggle, ya NO se leen de weaponAttacks.basic[1]
// (que ahora es dato muerto por completo, ni geometría ni daño). Escala con
// el arma igual que el resto de los ataques: dmgEfectivo = dmgBase ×
// tier.mult × rareza.mult (ver Combat.tickToggleSkill), mismo patrón que el
// arma automática por nivel (getWeaponForLevel). Objetivo a Tier 1 (daño
// por segundo, calibrado explícitamente por el usuario):
//   Pícaro 3 c/500ms=6dps · Guerrero 7 c/1000ms=7dps · Bárbaro 4 c/1000ms=4dps
//   Tanque 4 c/1000ms=4dps · Mago 3 c/500ms=6dps · Arquero 3 c/500ms=6dps
const RT_TOGGLE_STACK_MAX = 10;
// `radius` = radio BASE del círculo exterior (línea/borde) alrededor del
// jugador: es tanto el alcance del pulso de daño automático como el radio
// donde se DIBUJAN los objetos orbitales/círculo (mismo círculo, sin un
// radio "visual" aparte — ver Combat.renderSkill2). El radio EFECTIVO real
// escala con el arma equipada — ver Combat.getSkill2EffectiveRadius:
// +3% por Tier (Bronce=+0% .. Absoluto=+27%) y +3% por nivel de rareza
// (Común=+0% .. Mítico=+15%), aditivos entre sí. `orbitMs` es el período
// de rotación — ahora TODAS las clases giran (antes Mago/Arquero quedaban
// fijos; se les dio la misma velocidad que Pícaro, ~2s por vuelta).
const RT_TOGGLE_SKILLS = {
    guerrero: { name: 'Espadas Orbitales', emoji: '⚔️', objectCount: 5, radius: 200, orbitMs: 3000, activateCooldownMs: 2500, color: '#ffd700', dmgBase: 7, tickMs: 1000, dmgPctPerStack: 0.02, dmgPctMax: 0.20 },
    picaro:   { name: 'Dagas Orbitales', emoji: '🗡️', objectCount: 6, radius: 180, orbitMs: 2000, activateCooldownMs: 2500, color: '#d0d0e8', dmgBase: 3, tickMs: 500, speedPctPerStack: 0.02, speedPctMax: 0.20, critPctPerStack: 0.02, critPctMax: 0.20 },
    barbaro:  { name: 'Hachas Orbitales', emoji: '🪓', objectCount: 5, radius: 150, orbitMs: 3500, activateCooldownMs: 3000, color: '#8b0000', dmgBase: 4, tickMs: 1000, lifestealPctPerStack: 0.015, lifestealPctMax: 0.15 },
    arquero:  { name: 'Círculo de Flechas', emoji: '🏹', objectCount: 8, radius: 250, orbitMs: 2000, activateCooldownMs: 2000, color: '#228b22', dmgBase: 3, tickMs: 500, speedPctPerStack: 0.02, speedPctMax: 0.20, cdMsPerStack: 100, cdMsMax: 1000 },
    mago:     { name: 'Círculo de Runas', emoji: '🧙', objectCount: 6, radius: 250, orbitMs: 2000, activateCooldownMs: 2500, color: '#00ffff', dmgBase: 3, tickMs: 500, dmgPctPerStack: 0.02, dmgPctMax: 0.20 },
    tanque:   { name: 'Círculo de Escudos', emoji: '🔨', objectCount: 6, radius: 180, orbitMs: 4000, activateCooldownMs: 3000, color: '#4169e1', dmgBase: 4, tickMs: 1000, defPctPerStack: 0.05, defPctMax: 0.50 },
};

// ----- ATAQUE 1 "NUEVO" (tecla "1"): hechizo único por clase -----
// El Ataque 1 original (golpe básico) pasó a ser SOLO click izquierdo (ver
// Combat.tryAttack/bindInput en game.js); la tecla "1" quedó libre y ahora
// dispara este hechizo propio de cada clase. Mecánica de disparo compartida
// por las 6 (ver Combat.startAimSkill1/releaseSkill1/fireSkill1): mantener
// "1" entra en modo "apuntando" (dibuja línea/círculo de vista previa, ver
// Combat.renderSkill1Aim), soltarla lanza el hechizo hacia la posición del
// mouse en ese instante — EXCEPTO Bárbaro, cuya primera pulsación activa el
// aura al instante (sin apuntado, es centrada en sí mismo) y solo la
// segunda (con el aura ya activa) entra en modo apuntando, para el dash de
// cancelación.
// El daño base de cada hechizo escala con el arma equipada igual que
// cualquier otro ataque (tier.mult × rareza.mult), mismo patrón que
// RT_TOGGLE_SKILLS — los números de acá son el valor a Tier 1/Común pedido.
// Distancias/duraciones/radios sí son fijos (no escalan con el arma).
const RT_SKILL1_ABILITIES = {
    // Pícaro — Estocada Fantasma: dash de 400px en 0.1s, daño a TODO enemigo
    // tocado en el camino (barrido continuo durante la animación, no un
    // golpe único). Cada enemigo QUE MUERE por el dash reduce el cooldown
    // restante 0.3s (puede dejarlo listo de inmediato con varias bajas) Y
    // además ahora suma +5%/6 (max 30%) de probabilidad de crítico
    // PERMANENTE (sin duración, no se pidió que decaiga — ver
    // Combat.getPicaroDashCritBonusPercent/skill1.picaroDashCritStacks).
    picaro: {
        name: 'Estocada Fantasma', emoji: '🗡️', color: '#d0d0e8',
        dashRange: 400, dashDurationMs: 100, dmgBase: 20, cooldownMs: 3000, cdReductionPerKillMs: 300,
        critPerKillPercent: 0.05, critPerKillMaxStacks: 6,
    },
    // Guerrero — Salto Sísmico: salto de HASTA 300px en 0.1s (cae donde
    // apuntaba el mouse si estaba más cerca que el rango máximo — no
    // siempre salta al tope, ver fireSkill1Guerrero/aimDist) (sin daño en
    // el aire); al aterrizar, golpe de área (radio 150) + zona que queda
    // dibujada 5s: mientras el JUGADOR esté parado adentro (no importa
    // dónde estén los enemigos), su daño de salida sube 25% contra
    // cualquier objetivo (ver Combat.getPlayerZoneDamageBonusPercent).
    guerrero: {
        name: 'Salto Sísmico', emoji: '⚔️', color: '#ffd700',
        jumpRange: 300, jumpDurationMs: 100, slamRadius: 150, dmgBase: 30, cooldownMs: 5000,
        zoneDurationMs: 5000, zoneDmgBonusPercent: 0.25,
    },
    // Bárbaro — Furia Sangrienta: aura de 100px alrededor suyo (sigue al
    // jugador, no queda fija), +20% robo de vida y +5% vida máxima curada
    // por cada muerte mientras esté activa (cada muerte también extiende la
    // duración +1s). Duración base 5s; el cooldown normal (5s) arranca
    // recién CUANDO TERMINA (por tiempo, no al activarla). Puede cancelarse
    // antes con una 2da pulsación de "1": en vez de esperar a que se acabe,
    // hace un dash de 200px (0.1s) que daña según el % de vida ACTUAL del
    // jugador al momento de lanzarlo (ver dashDmgTiers/getBarbaroDashDamage
    // — tabla ordenada de mayor a menor: el primer umbral que cumple el %
    // de vida actual define el daño) y cura 5% de vida máxima por cada
    // enemigo que mate con él; cancelar así sube el cooldown a 7s en vez de
    // los 5s normales (penalización por cortar el aura antes de tiempo).
    barbaro: {
        name: 'Furia Sangrienta', emoji: '🪓', color: '#8b0000',
        auraRadius: 100, lifestealPercent: 0.20, killHealPercent: 0.05,
        baseDurationMs: 5000, durationPerKillMs: 1000, cooldownMs: 5000,
        dashRange: 200, dashDurationMs: 100, cancelCooldownMs: 7000, dashKillHealPercent: 0.05,
        // El pedido original da 4 números (100-80%=10, 80-60%=15,
        // 40-20%=20, 20-1%=25) pero deja un hueco en 60-40%: se rellenó
        // extendiendo el tramo de 15 hasta 40% en vez de inventar un 5to
        // valor no pedido — avisado al usuario, fácil de ajustar acá.
        dashDmgTiers: [
            { minHpPercent: 0.80, dmg: 10 },
            { minHpPercent: 0.40, dmg: 15 },
            { minHpPercent: 0.20, dmg: 20 },
            { minHpPercent: 0, dmg: 25 },
        ],
    },
    // Tanque — Bastión: círculo ESTÁTICO (no sigue al jugador) de 200px de
    // radio en el punto donde se soltó "1". El jugador, mientras esté
    // parado adentro, recibe +50% de mitigación de armadura (ver
    // Combat.getPlayerZoneDefenseBonusPercent/Player.takeDamage); cualquier
    // enemigo que entre al círculo tiene su daño de ataque reducido 30%
    // mientras esté adentro (ver Combat.getEnemyZoneDamageMultiplier). No se
    // especificó cuánto dura la zona — se igualó al cooldown (7s) para que
    // quede disponible de nuevo justo cuando la anterior expira.
    tanque: {
        name: 'Bastión', emoji: '🔨', color: '#4169e1',
        radius: 200, allyDefenseBonusPercent: 0.50, enemyDamageReducePercent: 0.30,
        cooldownMs: 7000, durationMs: 7000,
    },
    // Mago — Parpadeo Arcano: teletransporte instantáneo de HASTA 400px (a
    // donde apuntaba el mouse si estaba más cerca que el rango máximo — no
    // siempre salta al tope, ver fireSkill1Mago/aimDist; sin animación de
    // vuelo, a diferencia de las clases que "saltan/dashean") + 20% de daño
    // extra en todos los ataques durante 5s.
    mago: {
        name: 'Parpadeo Arcano', emoji: '🧙', color: '#00ffff',
        teleportRange: 400, dmgBuffPercent: 0.20, dmgBuffDurationMs: 5000, cooldownMs: 5000,
    },
    // Arquero — Retirada Certera: salto de 200px (0.1s) en la dirección
    // OPUESTA al mouse (retirada) — la distancia del salto no se
    // especificó, se usó 200px por quedar en línea con el resto de
    // dashes/saltos cortos de esta tabla. Simultáneo, dispara el Ataque 1
    // normal (misma animación/geometría) HACIA el mouse, pero en vez de
    // daño normal aplica 20% de ralentización (duración no especificada,
    // se usó 3s). Al lanzar la habilidad gana +20% de velocidad de
    // movimiento (duración no especificada, se igualó al cooldown, 5s).
    arquero: {
        name: 'Retirada Certera', emoji: '🏹', color: '#228b22',
        jumpRange: 200, jumpDurationMs: 100, slowPercent: 0.20, slowDurationMs: 3000,
        speedBuffPercent: 0.20, speedBuffDurationMs: 5000, cooldownMs: 5000,
    },
};

// Daño del dash de cancelación del Bárbaro según su % de vida ACTUAL (ver
// RT_SKILL1_ABILITIES.barbaro.dashDmgTiers) — recorre la tabla de mayor a
// menor y devuelve el primer umbral que cumple.
function getBarbaroDashDamage(hpPercent) {
    const tiers = RT_SKILL1_ABILITIES.barbaro.dashDmgTiers;
    for (const t of tiers) if (hpPercent >= t.minHpPercent) return t.dmg;
    return tiers[tiers.length - 1].dmg;
}

// ----- ATAQUE 3 "NUEVO" (tecla "3", ver Combat.startAimSkill3/releaseSkill3):
// hechizo único por clase, agregado UNA clase a la vez a pedido del
// usuario. Mientras una clase no tenga entrada acá, presionar "3" no hace
// nada para ella (el viejo especial de carga universal — R/"3" original —
// ya vive en la tecla Espacio y sigue intacto para todas, ver
// RT_ATTACK_GEOMETRY[profId][2]). Mismo patrón de disparo que la tecla "1":
// mantener "3" entra en modo "apuntando" (dibuja línea guía, ver
// Combat.renderSkill3Aim), soltarla lo lanza hacia donde apuntaba el mouse
// en ese instante.
const RT_SKILL3_ABILITIES = {
    // Mago — Vórtice Arcano: círculo que viaja HASTA 300px en la dirección
    // del mouse (menos si el mouse está más cerca, mismo aimDist que
    // RT_SKILL1_ABILITIES.mago) a velocidad constante (300px en 0.5s ->
    // 600px/s, no especificado explícitamente pero consistente con "el
    // recorrido máximo dura 0.5s"). Empieza en minRadius (30) y por cada
    // `growthDivisor` px recorridos MÁS ALLÁ de `growthStartDist` (60px)
    // crece 1px de radio — con 300px de viaje llega a maxRadius (150),
    // calculado como minRadius + (maxTravelDist-growthStartDist)/growthDivisor
    // = 30 + (300-60)/2 = 150. Todo enemigo tocado mientras viaja recibe
    // dmgOnTouch UNA vez (barrido continuo, como el dash del Pícaro). Al
    // llegar, queda estático staticDurationMs (5s) haciendo staticTickDmg
    // cada staticTickMs (20 daño cada 0.5s = 40 dps) a los enemigos
    // adentro. cooldownMs no se especificó — se usaron 8s (más que el
    // ciclo de vida completo del vórtice, ~5.5s, para que no se pueda
    // solapar con uno nuevo).
    mago: {
        name: 'Vórtice Arcano', emoji: '🌀', color: '#00ffff',
        minRadius: 30, maxRadius: 150, maxTravelDist: 300,
        growthStartDist: 60, growthDivisor: 2, travelSpeedPxPerSec: 600,
        dmgOnTouch: 40, staticDurationMs: 5000, staticTickDmg: 20, staticTickMs: 500, cooldownMs: 8000,
    },
    // Arquero — Flecha Certera: proyectil ÚNICO objetivo (se detiene en el
    // PRIMER enemigo que toca, a diferencia del vórtice que barre a todos)
    // que viaja en la dirección del mouse — a diferencia del resto de
    // hechizos con viaje (Pícaro/Guerrero/Mago), NO se acorta si el mouse
    // está más cerca: siempre vuela hasta 1200px (o hasta chocar con una
    // pared/enemigo), como una flecha real — el usuario no pidió el
    // acortamiento acá y la fórmula de daño (basada en cuánto voló ANTES
    // de pegar) solo tiene sentido si el vuelo no depende del click.
    // Velocidad constante: 1200px en 2s -> 600px/s. El daño depende de
    // cuántos píxeles ya recorrió al momento de tocar al enemigo (ver
    // getArqueroArrowDamage): 0-50px=10, 50-200px=20, más allá de 200px
    // sube 0.08 por píxel adicional (a 1200px: 20+0.08*1000=100, el
    // ejemplo del pedido tenía un typo "0,04" pero el resultado final que
    // dieron —100— solo cuadra con 0.08, se usó ese). Si mata al enemigo
    // que toca, el cooldown se reinicia POR COMPLETO (no solo se reduce) y
    // el jugador gana +10% de daño 10s (ver Combat.getSkill3DamageBuffPercent).
    arquero: {
        name: 'Flecha Certera', emoji: '🏹', color: '#228b22',
        maxTravelDist: 1200, travelSpeedPxPerSec: 600,
        dmgTier1: 10, dmgTier1MaxDist: 50,
        dmgTier2: 20, dmgTier2MaxDist: 200,
        dmgScalePerPixelBeyond200: 0.08,
        cooldownMs: 6000, killDmgBuffPercent: 0.10, killDmgBuffDurationMs: 10000,
    },
    // Guerrero — Golpe de Ejecución: dash CORTO (150px, 0.1s, duración fija
    // — a diferencia del vórtice/flecha, no viaja a "velocidad constante",
    // es el mismo estilo de dash instantáneo que la Estocada Fantasma del
    // Pícaro de tecla "1" (de hecho ESTA habilidad vivía en la tecla "3"
    // del Pícaro hasta que el usuario pidió transplantarla acá — ver
    // Combat.fireSkill3GuerreroExecute). A DIFERENCIA de todos los demás
    // dashes/proyectiles con barrido (que atraviesan/golpean a TODOS los
    // que tocan), este se DETIENE en el PRIMER enemigo que encuentra — el
    // jugador queda parado justo frente a él (no se superponen) — y
    // dispara un cono pequeño + golpe único hacia ese enemigo (ver
    // getGuerreroExecuteDamage): daño base 50, sube a 60/70 si el enemigo
    // está en 60%/40% de vida o menos, y lo EJECUTA (mata directo, ignora
    // defensa) si está en 20% o menos. Si mata, el cooldown se reinicia
    // POR COMPLETO (mismo patrón que la Flecha Certera del Arquero) Y
    // otorga +2%/kill de daño PERMANENTE (máx 10 stacks/20%, mismo patrón
    // que las Dagas Orbitales del Pícaro) — REEMPLAZA la curación que
    // tenía cuando era del Pícaro, a pedido explícito del usuario ("en vez
    // de dar crítico, da 2% de daño"; la versión Pícaro nunca daba
    // crítico, pero el pedido es inequívoco sobre el reemplazo del bono
    // de kill). cooldownMs no se especificó — se usaron 4s. Durante los
    // 0.1s del dash, el Guerrero es INVULNERABLE — ningún golpe enemigo
    // conecta (ver Combat.performEnemyAttackRT, chequea this.dash3 directo).
    // healOnHitPercent/healOnKillPercent: se cura 50% del daño REALIZADO
    // (post-mitigación, el mismo valor `dealt` que ya se usa para el texto
    // flotante) con un golpe normal, o 100% si ese golpe mata al enemigo —
    // en la "ejecución" (mata directo, ignora defensa) el "daño realizado"
    // para la curación se toma como la vida que tenía el enemigo justo
    // antes de morir, porque ese camino no pasa por takeDamage/`dealt`.
    guerrero: {
        name: 'Golpe de Ejecución', emoji: '⚔️', color: '#ffd700',
        dashRange: 150, dashDurationMs: 100,
        dmgBase: 50, dmgTier60: 60, dmgTier40: 70,
        tier60HpPercent: 0.60, tier40HpPercent: 0.40, executeHpPercent: 0.20,
        coneRange: 70, coneAngle: 35,
        cooldownMs: 4000, dmgStackPerKillPercent: 0.02, dmgStackMaxStacks: 10,
        healOnHitPercent: 0.50, healOnKillPercent: 1.0,
    },
    // Pícaro — Doble Sombra: dash de HASTA 250px (el jugador elige dónde
    // caer DENTRO de ese rango, según aimDist — mismo criterio que el
    // Salto Sísmico/Parpadeo Arcano, a diferencia de los demás dashes del
    // Pícaro que siempre van al máximo) en 0.1s, SIN daño. Deja un CLON en
    // la posición de INICIO del dash, con la vida actual del Pícaro en ese
    // momento; si el Pícaro tenía la Dagas Orbitales (tecla "2") activa,
    // el clon TAMBIÉN la tiene y tickea su propio pulso de daño (mismas
    // fórmulas que el Pícaro real, ver Combat.tickPicaroCloneToggleSkill),
    // sin límite de tiempo propio. El Pícaro queda invisible
    // invisibleDurationMs (3s): mientras dure, los enemigos NUNCA lo
    // atacan (ver Combat.performEnemyAttackRT) — y si hay un clon vivo, la
    // IA de los enemigos directamente lo persigue/ataca A ÉL en vez del
    // jugador real (ver aiTarget en updateRealtime), lo que de paso logra
    // "atacar sin ser visto" sin necesitar rediseñar la IA de cero. El
    // clon NO tiene bloqueo/esquiva/escudo (recibe el golpe de lleno,
    // ni turnos de expiración propios) y persiste hasta que: (a) su vida
    // llega a 0 por los enemigos, o (b) el Pícaro lo atraviesa con su
    // propio dash de tecla "1" (Estocada Fantasma) — en AMBOS casos
    // explota: círculos expansivos + cloneExplosionDamage a todo enemigo
    // en cloneExplosionRadius. Cada enemigo que MATA la explosión suma
    // +2%/kill de crítico PERMANENTE (máx 10 stacks/20%, ver
    // Combat.getPicaroExplosionCritBonusPercent) y reduce el cooldown 1s
    // (máx 5 kills = 5s = reinicio completo, ver cdReductionMaxKills).
    picaro: {
        name: 'Doble Sombra', emoji: '🥷', color: '#d0d0e8',
        dashRange: 250, dashDurationMs: 100, invisibleDurationMs: 3000,
        cloneExplosionRadius: 200, cloneExplosionDamage: 60,
        explosionCritPerKillPercent: 0.02, explosionCritMaxStacks: 10,
        cooldownMs: 5000, cdReductionPerKillMs: 1000, cdReductionMaxKills: 5,
    },
    // Tanque — Círculo del Gigante: círculo de radio 200 que SIGUE al
    // jugador (a diferencia de Bastión, tecla "1", que queda fijo en el
    // punto de lanzamiento) — se interpretó así porque el pedido dice
    // "alrededor del jugador" y el arrastre es "hacia el jugador", lo que
    // sólo tiene sentido como un marco de referencia que se mueve con él.
    // Todo enemigo dentro del radio es arrastrado hacia el Tanque cada
    // frame (pullSpeedPxPerSec no especificado — se usó un valor algo
    // mayor a la velocidad típica de un enemigo para que el tirón se
    // sienta; respeta paredes). Mientras está activa: -30% de daño
    // recibido (reducción DIRECTA sobre el daño final, reutiliza el mismo
    // campo que el damageReducePercent de encantamientos, ver
    // Player.takeDamage — NO es un bono de mitigación de armadura) y cada
    // enemigo que golpea al Tanque recibe el 100% de su propio daño BASE
    // como reflejo ("el daño base del ataque", antes de bloqueo/reducción
    // — no lo que el Tanque terminó recibiendo). Por cada enemigo que
    // MUERE mientras la habilidad está activa (sin importar la causa:
    // reflejo, ataques normales, etc., ver Combat.onEnemyDefeated) cura
    // 10% de la vida máxima y suma 1 stack de "Gigante" (máx 10). Los
    // stacks se reinician a 0 en cada lanzamiento y sólo tienen efecto
    // MIENTRAS la habilidad está activa (se leen como parte "de la
    // habilidad", no como progreso permanente — a diferencia de los
    // stacks de crítico del Pícaro, que sí son indefinidos). Cada stack
    // da +10% de vida máxima (multiplicador sobre Player.recalcMaxHp, NO
    // cura de más — sólo el 10%-por-kill explícito cura) y +3% de
    // resistencias (mismo mecanismo que defPctPerStack del Círculo de
    // Escudos: multiplicador sobre armor.defense). Tope 10 stacks =
    // +100% vida máxima / +30% resistencias extra.
    tanque: {
        name: 'Círculo del Gigante', emoji: '🗿', color: '#c0392b',
        radius: 200, pullSpeedPxPerSec: 220,
        damageReducePercent: 0.30, reflectPercent: 1.0,
        killHealPercent: 0.10,
        giantHpPerStackPercent: 0.10, giantDefPerStackPercent: 0.03, giantMaxStacks: 10,
        durationMs: 8000, cooldownMs: 4000,
    },
    // Bárbaro — Torbellino de Espadas: 2 espadas de bladeLength px, una a
    // cada lado del jugador (relativas al mundo, no al mouse — el pedido no
    // menciona apuntar, mismo criterio "sin aim" que el Círculo del Gigante
    // del Tanque), con el mango pegado al jugador y la punta hacia afuera.
    // Cada una gira 360° en sentido horario en durationMs (0.3s) — como
    // arrancan opuestas (180°) y ambas completan la vuelta completa e
    // independiente, entre las dos barren TODO el círculo alrededor del
    // jugador (cada ángulo pasa por una espada a la mitad de la animación y
    // por la otra en el otro extremo) — el hitSet es lo que garantiza que
    // cada enemigo sólo reciba UN golpe por lanzamiento, sin importar cuál
    // de las dos espadas llegue primero a su ángulo (ver
    // Combat.applyBarbaroSpinHits/hitSet). dmgPerHit (50) es un valor
    // FIJO de la habilidad (no escala con el arma/tier, mismo criterio que
    // el resto de daños de tecla "3" de esta tabla), multiplicado por la
    // cadena universal de bonos de daño. La curación NO es el robo de vida
    // normal del Bárbaro: es una fórmula propia de esta habilidad, usa el
    // robo de vida TOTAL actual (encantamiento + Furia Sangrienta + stacks
    // de Hachas Orbitales, ver Combat.getBarbaroCurrentLifestealPercent)
    // multiplicado por 2 (lifestealMultiplier), aplicada sobre el daño de
    // ESTA habilidad (antes de la mitigación del enemigo, igual que el
    // resto de curaciones por robo de vida ya existentes en el juego). Por
    // cada enemigo asesinado por esta habilidad se reduce el cooldown
    // cdReductionPerKillMs, hasta cdReductionMaxMs (5s) de reducción total
    // por lanzamiento — igual mecanismo que Doble Sombra del Pícaro.
    barbaro: {
        name: 'Torbellino de Espadas', emoji: '🗡️', color: '#8b0000',
        bladeLength: 75, durationMs: 300, dmgPerHit: 50, lifestealMultiplier: 2,
        cooldownMs: 6000, cdReductionPerKillMs: 500, cdReductionMaxMs: 5000,
    },
};

// Daño de la Flecha Certera del Arquero según cuántos píxeles ya voló al
// momento de tocar al enemigo (ver RT_SKILL3_ABILITIES.arquero).
function getArqueroArrowDamage(pixelsTraveled) {
    const cfg = RT_SKILL3_ABILITIES.arquero;
    if (pixelsTraveled <= cfg.dmgTier1MaxDist) return cfg.dmgTier1;
    if (pixelsTraveled <= cfg.dmgTier2MaxDist) return cfg.dmgTier2;
    return cfg.dmgTier2 + cfg.dmgScalePerPixelBeyond200 * (pixelsTraveled - cfg.dmgTier2MaxDist);
}

// Daño del Golpe de Ejecución del Guerrero según el % de vida ACTUAL del
// enemigo golpeado (ver RT_SKILL3_ABILITIES.guerrero). Devuelve `null` para
// "ejecución" (mata directo, ver Combat.fireSkill3GuerreroExecute/
// updateRealtime — no es un valor de daño real, ignora defensa).
function getGuerreroExecuteDamage(enemyHpPercent) {
    const cfg = RT_SKILL3_ABILITIES.guerrero;
    if (enemyHpPercent <= cfg.executeHpPercent) return null;
    if (enemyHpPercent <= cfg.tier40HpPercent) return cfg.dmgTier40;
    if (enemyHpPercent <= cfg.tier60HpPercent) return cfg.dmgTier60;
    return cfg.dmgBase;
}

// Geometría/visual por profesión y slot. Cada entrada separa la FORMA DE
// IMPACTO (hitShape: qué enemigos son alcanzados) del ESTILO VISUAL
// (visual: cómo se dibuja), para poder rediseñar el look de cada clase sin
// tocar la detección de golpes:
//   hitShape 'cone'         -> getEnemiesInCone(range, angle) centrado en el jugador
//   hitShape 'circle'       -> getEnemiesInCircle(range) centrado en el jugador
//   hitShape 'offsetCircle' -> getEnemiesInCircle(range) centrado a offsetRange
//                               px por delante del jugador en la dirección de aim
//   visual 'cone'    -> relleno translúcido tipo cono (Mago y, desde este
//                        rediseño, TODAS las clases cuerpo a cuerpo — ver abajo)
//   visual 'coneArrows' -> igual que 'cone' + un abanico de flechas cortas
//                        dentro del arco (Arquero: lo distingue del Mago)
//   visual 'slash'   -> arco/línea tipo "corte", radio ~fijo con barrido angular
//                        (sin uso actual desde el rediseño de ondas/conos)
//   visual 'wave'    -> onda(s) expansiva(s) en abanico, con daño multiplicado
//                        por solape (sin uso actual: el Ataque 1 volvió a ser
//                        un cono único, ver RESUMEN DE CAMBIOS VISUALES; se
//                        deja implementado por si se reutiliza más adelante)
//   visual 'arrowRain' -> lluvia de flechas cayendo sobre un área (Arquero A2,
//                        dato sin uso: el Ataque 2 es ahora un toggle, ver
//                        RT_TOGGLE_SKILLS)
//   visual 'circle'  -> círculo expandible centrado en el jugador (Ataque 3,
//                        UNIFICADO: misma mecánica para las 6 clases, solo
//                        cambian radio/duración/color por clase)
// `startRange`/`duration` parametrizan la expansión del círculo especial.
// Ningún ataque emite partículas viajeras (ver spawnAttackEffect): solo el
// destello de impacto en cada golpe (spawnImpactFlash), que sí se conserva.
// Las entradas [1] (Ataque 2) de todas las clases son dato muerto: el
// Ataque 2 real es la habilidad toggle (RT_TOGGLE_SKILLS), no lee esta tabla.
// El nombre real de cada tier (weapon-attacks.js) se sigue usando en el
// texto flotante/log.
const RT_WAVE_FAN_OFFSETS = [-45, 0, 45]; // legado del abanico de triple onda (ver 'wave' arriba, sin uso actual)
const RT_WAVE_STAGGER_MS = 50;
const RT_ATTACK_GEOMETRY = {
    picaro: [ // 🗡️ Plateado/gris claro
        { hitShape: 'cone', visual: 'cone', range: 250, angle: 75, duration: 350, color: '#d0d0e8' },
        { hitShape: 'cone', visual: 'wave', range: 200, angle: 60, startRange: 40, duration: 400, lineWidth: 3, waveOffsets: RT_WAVE_FAN_OFFSETS, color: '#d0d0e8' },
        { hitShape: 'circle', visual: 'circle', range: 300, startRange: 50, duration: 500, color: '#d0d0e8' },
    ],
    guerrero: [ // ⚔️ Amarillo oro
        { hitShape: 'cone', visual: 'cone', range: 250, angle: 75, duration: 350, color: '#ffd700' },
        { hitShape: 'cone', visual: 'wave', range: 250, angle: 100, startRange: 60, duration: 450, lineWidth: 4, waveOffsets: RT_WAVE_FAN_OFFSETS, color: '#ffd700' },
        { hitShape: 'circle', visual: 'circle', range: 350, startRange: 60, duration: 550, color: '#ffd700' },
    ],
    barbaro: [ // 🪓 Rojo vinotinto
        { hitShape: 'cone', visual: 'cone', range: 250, angle: 75, duration: 350, color: '#8b0000' },
        { hitShape: 'cone', visual: 'wave', range: 230, angle: 110, startRange: 70, duration: 500, lineWidth: 6, waveOffsets: RT_WAVE_FAN_OFFSETS, color: '#8b0000' },
        { hitShape: 'circle', visual: 'circle', range: 320, startRange: 70, duration: 500, color: '#8b0000' },
    ],
    tanque: [ // 🔨 Azul oscuro royal
        { hitShape: 'cone', visual: 'cone', range: 250, angle: 75, duration: 350, color: '#4169e1' },
        { hitShape: 'cone', visual: 'wave', range: 240, angle: 130, startRange: 80, duration: 400, lineWidth: 5, waveOffsets: RT_WAVE_FAN_OFFSETS, color: '#4169e1' },
        { hitShape: 'circle', visual: 'circle', range: 350, startRange: 80, duration: 550, color: '#4169e1' },
    ],
    mago: [ // 🧙 Azul claro neon
        // Ataque básico (slot 0, primer golpe): +30% de rango (250 -> 325) a
        // cambio de un cono más angosto — no se especificó el ángulo final,
        // se reutilizó el mismo valor (40°) que ya usa el SEGUNDO ataque
        // básico de Mago (slot 1, línea de abajo), para no inventar un
        // número nuevo sin referencia en el propio juego.
        { hitShape: 'cone', visual: 'cone', range: 325, angle: 40, duration: 350, color: '#00ffff' },
        { hitShape: 'cone', visual: 'cone', range: 300, angle: 40, duration: 260, color: '#00ffff' },
        { hitShape: 'circle', visual: 'circle', range: 360, startRange: 60, duration: 600, color: '#00ffff' },
    ],
    arquero: [ // 🏹 Verde bosque — cono largo/angosto con abanico de flechas
        { hitShape: 'cone', visual: 'coneArrows', range: 350, angle: 45, duration: 350, color: '#228b22' },
        { hitShape: 'offsetCircle', visual: 'arrowRain', range: 250, offsetRange: 400, duration: 250, color: '#228b22' },
        { hitShape: 'circle', visual: 'circle', range: 330, startRange: 50, duration: 500, color: '#228b22' },
    ],
    desarmado: [ // sin especificación propia: se mantiene el look de cono original
        { hitShape: 'cone', visual: 'cone', range: 120, angle: 60, duration: 200, color: '#ffffff' },
        { hitShape: 'cone', visual: 'cone', range: 150, angle: 70, duration: 220, color: '#ffffff' },
        { hitShape: 'circle', visual: 'circle', range: 250, startRange: 60, duration: 400, color: '#ffffff' },
    ],
};
function getAttackGeometry(profId, slot) {
    const table = RT_ATTACK_GEOMETRY[profId] || RT_ATTACK_GEOMETRY.desarmado;
    return table[slot];
}

// ----- IA DE ENEMIGOS (persiguen y atacan en tiempo real) -----
const ENEMY_VISUAL_RANGE = 500;  // detectan al jugador y empiezan a perseguir
const ENEMY_LEASH_RANGE = 1300;  // dejan de perseguir si el jugador se aleja más que esto
const ENEMY_ATTACK_RANGE = 150;  // respaldo si un tipo no define su propio attackRange (ver ENEMY_TYPES)

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
