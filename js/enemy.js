// ===== CLASE ENEMY =====
// Combate en tiempo real: los enemigos detectan al jugador dentro de
// ENEMY_VISUAL_RANGE, lo persiguen caminando, se detienen a
// ENEMY_ATTACK_RANGE y atacan con su propio timer (ver Combat.updateRealtime
// en combat.js, que llama a update() cada frame y dispara el ataque cuando
// corresponde). Los efectos de estado (quemadura/sangrado/debuffs/aturdido)
// ahora son real-time: expiresAt (timestamp) en vez de turnsLeft, y las
// quemaduras/sangrados tickean 1 vez por segundo (ver tickStatusEffects).

class Enemy {
    constructor(typeDef, x, y) {
        this.type = typeDef;
        this.x = x;
        this.y = y;
        this.hp = typeDef.hp;
        this.maxHp = typeDef.hp;
        this.radius = typeDef.radius;
        this.alive = true;

        // Velocidad de persecución: enemigos livianos (radio chico) son más
        // rápidos, los pesados/grandes (jefes) más lentos.
        this.speed = Math.max(1.2, Math.min(3.2, 3.6 - this.radius * 0.03));

        // IA en tiempo real (ver Combat.updateRealtime).
        this.aiState = 'idle'; // 'idle' | 'chasing' | 'attacking' | 'stunned'
        this.nextAttackAt = 0;
        this._deathHandled = false; // evita otorgar loot dos veces si muere por DoT

        // Efectos de estado (real-time, ver tickStatusEffects).
        this.burn = null;        // { dmgPerSec, expiresAt, lastTickAt }
        this.bleed = null;       // { dmgPerSec, expiresAt, lastTickAt }
        this.stunUntil = 0;      // Date.now() hasta el cual no se mueve ni ataca
        this.defenseMod = null;  // { percent, flat, expiresAt }
        this.attackMod = null;   // { flat, expiresAt }

        // Estado de habilidad de jefe (ver Combat.tickBossAbility): contador
        // de ataques propios desde el último uso (reemplaza "turnos desde
        // el último uso"), y escudo temporal de daño reducido.
        this.abilityState = { attacksSinceUse: 0, shieldUntil: 0 };
    }

    // flatPenetration: reducción PLANA de defensa (ver estadística Destreza,
    // +0.1 por punto, constants.js), aplicada DESPUÉS del % de penetración.
    getEffectiveDefense(penetratePercent, flatPenetration) {
        let defense = this.type.defense || 0;
        if (this.defenseMod && Date.now() < this.defenseMod.expiresAt) {
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
        if (Date.now() < this.abilityState.shieldUntil) dmg *= 0.5; // ej. Espectro Oscuro / Sombra del Abismo
        const defense = this.getEffectiveDefense(penetrate, flatPenetration);
        const finalDmg = Math.max(1, Math.round((dmg - defense) * 10) / 10);
        this.hp = Math.max(0, this.hp - finalDmg);
        if (this.hp <= 0) this.alive = false;
        return finalDmg;
    }

    // Tickea quemadura/sangrado (1 daño de tick por segundo real) y limpia
    // stun/debuffs vencidos. Llamado cada frame desde update().
    tickStatusEffects() {
        const now = Date.now();
        [['burn'], ['bleed']].forEach(([key]) => {
            const dot = this[key];
            if (!dot) return;
            if (now >= dot.expiresAt) { this[key] = null; return; }
            if (now - dot.lastTickAt >= 1000) {
                dot.lastTickAt += 1000;
                this.hp = Math.max(0, this.hp - dot.dmgPerSec);
                if (this.hp <= 0) this.alive = false;
            }
        });
        if (this.defenseMod && now >= this.defenseMod.expiresAt) this.defenseMod = null;
        if (this.attackMod && now >= this.attackMod.expiresAt) this.attackMod = null;
    }

    // Movimiento + estado de IA. No dispara el ataque en sí (eso lo hace
    // Combat.updateRealtime chequeando aiState==='attacking' y nextAttackAt).
    update(dt, player, isWalkable) {
        if (!this.alive) return;
        this.tickStatusEffects();
        if (!this.alive) return; // pudo morir por DoT en este mismo frame

        const now = Date.now();
        if (now < this.stunUntil) {
            this.aiState = 'stunned';
            return;
        }

        const dist = Math.hypot(player.x - this.x, player.y - this.y);

        if (dist > ENEMY_LEASH_RANGE) {
            this.aiState = 'idle';
            return;
        }
        if (dist <= ENEMY_ATTACK_RANGE) {
            this.aiState = 'attacking';
            return;
        }
        if (dist <= ENEMY_VISUAL_RANGE || this.aiState === 'chasing' || this.aiState === 'attacking') {
            this.aiState = 'chasing';
            const dirX = player.x - this.x, dirY = player.y - this.y;
            const len = Math.hypot(dirX, dirY) || 1;
            const step = this.speed * (dt / 16);
            const nx = this.x + (dirX / len) * step;
            const ny = this.y + (dirY / len) * step;
            if (!isWalkable || isWalkable(nx, this.y, this.radius)) this.x = nx;
            if (!isWalkable || isWalkable(this.x, ny, this.radius)) this.y = ny;
        } else {
            this.aiState = 'idle';
        }
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
// Nodos que no reaparecen. Están custodiados por una población de
// guardianes escalada por piso (ver rollChestGuardTarget en constants.js);
// solo cuentan las muertes DENTRO de la zona (CHEST_ZONE_RADIUS) — un
// guardián atraído lejos y matado ahí no suma progreso pero sí se repone
// (ver spawnChestGuard/registerChestKill en game.js). Se abren con una
// carga corta, como recolectar, una vez desbloqueados.
class Chest {
    constructor(x, y, rarity, guardTarget) {
        this.x = x;
        this.y = y;
        this.radius = 22;
        this.rarity = rarity;
        this.guardTarget = guardTarget; // población objetivo de guardianes Y denominador del progreso
        this.zoneKills = 0; // enemigos derrotados DENTRO de la zona (progreso de desbloqueo)
        this.unlocked = false;
        this.opened = false;
        this.pendingSpawns = []; // timestamps (ms epoch) de reposiciones de guardianes en curso
    }

    registerZoneKill() {
        if (this.unlocked || this.opened) return;
        this.zoneKills = Math.min(this.guardTarget, this.zoneKills + 1);
        if (this.zoneKills >= this.guardTarget) this.unlocked = true;
    }
}
