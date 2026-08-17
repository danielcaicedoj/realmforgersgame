// ===== CLASE ENEMY =====
// Los enemigos son estáticos en el mundo: no persiguen ni atacan hasta que
// el jugador hace click sobre ellos e inicia un combate por turnos.

class Enemy {
    constructor(typeDef, x, y) {
        this.type = typeDef;
        this.x = x;
        this.y = y;
        this.hp = typeDef.hp;
        this.maxHp = typeDef.hp;
        this.radius = typeDef.radius;
        this.alive = true;

        // Efectos de estado (combate por turnos)
        this.burn = null;        // { dmg, turnsLeft }
        this.bleed = null;       // { dmg, turnsLeft }
        this.stunned = false;    // pierde su próximo turno
        this.defenseMod = null;  // { percent, flat, turnsLeft }
        this.attackMod = null;   // { flat, turnsLeft }

        // Estado de habilidad de jefe (turnos desde la última invocación, escudo activo, etc.)
        this.abilityState = { turnsSinceUse: 0, shieldTurnsLeft: 0 };
    }

    // flatPenetration: reducción PLANA de defensa (ver estadística Destreza,
    // +0.1 por punto, constants.js), aplicada DESPUÉS del % de penetración.
    getEffectiveDefense(penetratePercent, flatPenetration) {
        let defense = this.type.defense || 0;
        if (this.defenseMod && this.defenseMod.turnsLeft > 0) {
            defense = defense * (1 - this.defenseMod.percent) - this.defenseMod.flat;
        }
        defense = Math.max(0, defense);
        if (penetratePercent) defense *= (1 - penetratePercent);
        if (flatPenetration) defense = Math.max(0, defense - flatPenetration);
        return defense;
    }

    // opts: { penetratePercent, flatPenetration }. Devuelve el daño real aplicado.
    takeDamage(amount, opts) {
        const penetrate = (opts && opts.penetratePercent) || 0;
        const flatPenetration = (opts && opts.flatPenetration) || 0;
        let dmg = amount;
        if (this.abilityState.shieldTurnsLeft > 0) dmg *= 0.5; // ej. Espectro Oscuro / Sombra del Abismo
        const defense = this.getEffectiveDefense(penetrate, flatPenetration);
        const finalDmg = Math.max(1, Math.round((dmg - defense) * 10) / 10);
        this.hp = Math.max(0, this.hp - finalDmg);
        if (this.hp <= 0) this.alive = false;
        return finalDmg;
    }
}

// Coloca un enemigo en un punto caminable aleatorio dentro de alguna sala
// del dungeon (nunca dentro de una pared).
function spawnEnemyInDungeon(typeDef, dungeon, excludeRoom) {
    const rooms = excludeRoom ? dungeon.rooms.filter(r => r !== excludeRoom) : dungeon.rooms;
    const room = rooms[Math.floor(Math.random() * rooms.length)];
    const pos = dungeon.randomPointInRoom(room, TILE_SIZE * 1.5);
    return new Enemy(typeDef, pos.x, pos.y);
}

// ===== NODOS DE RECURSOS =====

class ResourceNode {
    constructor(type, x, y, special) {
        this.type = type; // 'tree' | 'rock' | 'plant' | 'herb'
        this.def = RESOURCE_TYPES[type];
        this.x = x;
        this.y = y;
        this.special = !!special; // 1 por zona: más lento pero rinde mucho más
        this.radius = this.special ? 26 : 18;
        this.depleted = false;
        this.respawnAt = 0;
    }

    // Recolección instantánea al completar la carga (ver GATHER_TIME en game.js).
    collect() {
        if (this.depleted) return false;
        this.depleted = true;
        this.respawnAt = Date.now() + 8000;
        return true;
    }

    update(dt) {
        if (this.depleted && Date.now() >= this.respawnAt) {
            this.depleted = false;
        }
    }
}

function spawnResourceNodeInDungeon(type, dungeon, excludeRoom) {
    const rooms = excludeRoom ? dungeon.rooms.filter(r => r !== excludeRoom) : dungeon.rooms;
    const room = rooms[Math.floor(Math.random() * rooms.length)];
    const pos = dungeon.randomPointInRoom(room, TILE_SIZE * 1.5);
    return new ResourceNode(type, pos.x, pos.y);
}

// ===== COFRES =====
// Nodos que no reaparecen. Se desbloquean venciendo enemigos cerca (ver
// CHEST_REQUIRED_KILLS) y luego se abren con una carga corta, como recolectar.
class Chest {
    constructor(x, y, rarity) {
        this.x = x;
        this.y = y;
        this.radius = 22;
        this.rarity = rarity;
        this.kills = 0;
        this.requiredKills = CHEST_REQUIRED_KILLS;
        this.unlocked = false;
        this.opened = false;
    }

    registerNearbyKill() {
        if (this.unlocked || this.opened) return;
        this.kills = Math.min(this.requiredKills, this.kills + 1);
        if (this.kills >= this.requiredKills) this.unlocked = true;
    }
}
