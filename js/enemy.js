// ===== CLASE ENEMY =====
// Combate en tiempo real: los enemigos detectan al jugador dentro de
// ENEMY_VISUAL_RANGE, lo persiguen caminando, se detienen a
// ENEMY_ATTACK_RANGE y atacan con su propio timer (ver Combat.updateRealtime
// en combat.js, que llama a update() cada frame y dispara el ataque cuando
// corresponde). Los efectos de estado (quemadura/sangrado/debuffs/aturdido)
// ahora son real-time: expiresAt (timestamp) en vez de turnsLeft, y las
// quemaduras/sangrados tickean 1 vez por segundo (ver tickStatusEffects).

// ===== PATHFINDING (A*) =====
// La especificación pedía generar una grilla de navegación nueva desde
// cero (escaneando "paredes" como rectángulos). Este juego YA tiene una
// grilla de tiles por piso (ver grid-dungeon.js: dungeon.tiles, un
// Uint8Array de dungeon.cols×dungeon.rows a TILE_SIZE=40px, 1=caminable/
// 0=pared, con dungeon.tileIndex(cx,cy) para indexar) — se reutiliza
// DIRECTAMENTE esa grilla como grilla de navegación en vez de duplicarla.
const PATHFINDING_MAX_ITERATIONS = 800; // tope de nodos expandidos por búsqueda: si se excede, fallback a línea recta (evita picos de frame en laberintos sin salida)

function worldToTile(dungeon, x, y) {
    return {
        cx: Math.max(0, Math.min(dungeon.cols - 1, Math.floor(x / TILE_SIZE))),
        cy: Math.max(0, Math.min(dungeon.rows - 1, Math.floor(y / TILE_SIZE))),
    };
}

function isTileWalkable(dungeon, cx, cy) {
    if (cx < 0 || cy < 0 || cx >= dungeon.cols || cy >= dungeon.rows) return false;
    return dungeon.tiles[dungeon.tileIndex(cx, cy)] === 1;
}

// Distancia "octile" (heurística admisible para movimiento en 8 direcciones
// con costo diagonal √2 — subestima o iguala el costo real, nunca lo supera).
function pathHeuristic(a, b) {
    const dx = Math.abs(a.cx - b.cx), dy = Math.abs(a.cy - b.cy);
    return (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy);
}

const PATH_NEIGHBOR_OFFSETS = [
    { dx: 0, dy: -1, cost: 1 }, { dx: 1, dy: 0, cost: 1 }, { dx: 0, dy: 1, cost: 1 }, { dx: -1, dy: 0, cost: 1 },
    { dx: 1, dy: -1, cost: Math.SQRT2 }, { dx: 1, dy: 1, cost: Math.SQRT2 }, { dx: -1, dy: 1, cost: Math.SQRT2 }, { dx: -1, dy: -1, cost: Math.SQRT2 },
];

// A* simplificado sobre la grilla de tiles del piso. Devuelve una lista de
// waypoints en píxeles (ya simplificada, ver simplifyPath) o null si no hay
// camino / la búsqueda se volvió demasiado costosa (el llamador debe caer
// de vuelta a movimiento en línea recta, ver Enemy.chaseTowardPlayer).
function findPath(dungeon, startX, startY, targetX, targetY) {
    const start = worldToTile(dungeon, startX, startY);
    const goal = worldToTile(dungeon, targetX, targetY);
    if (!isTileWalkable(dungeon, start.cx, start.cy) || !isTileWalkable(dungeon, goal.cx, goal.cy)) return null;
    if (start.cx === goal.cx && start.cy === goal.cy) return [];

    const key = (cx, cy) => cy * dungeon.cols + cx;
    const gScore = new Map([[key(start.cx, start.cy), 0]]);
    const fScore = new Map([[key(start.cx, start.cy), pathHeuristic(start, goal)]]);
    const cameFrom = new Map();
    const closed = new Set();
    const open = [start];

    let iterations = 0;
    while (open.length > 0) {
        if (++iterations > PATHFINDING_MAX_ITERATIONS) return null;

        let bestIdx = 0, bestF = fScore.get(key(open[0].cx, open[0].cy));
        for (let i = 1; i < open.length; i++) {
            const f = fScore.get(key(open[i].cx, open[i].cy));
            if (f < bestF) { bestF = f; bestIdx = i; }
        }
        const current = open.splice(bestIdx, 1)[0];
        const currentKey = key(current.cx, current.cy);

        if (current.cx === goal.cx && current.cy === goal.cy) {
            return simplifyPath(dungeon, reconstructPath(cameFrom, current, key));
        }
        closed.add(currentKey);

        for (const off of PATH_NEIGHBOR_OFFSETS) {
            const ncx = current.cx + off.dx, ncy = current.cy + off.dy;
            if (!isTileWalkable(dungeon, ncx, ncy)) continue;
            // Evita "cortar esquinas" en diagonal atravesando el borde de una pared.
            if (off.dx !== 0 && off.dy !== 0) {
                if (!isTileWalkable(dungeon, current.cx + off.dx, current.cy) || !isTileWalkable(dungeon, current.cx, current.cy + off.dy)) continue;
            }
            const nKey = key(ncx, ncy);
            if (closed.has(nKey)) continue;
            const tentativeG = gScore.get(currentKey) + off.cost;
            if (tentativeG < (gScore.has(nKey) ? gScore.get(nKey) : Infinity)) {
                cameFrom.set(nKey, current);
                gScore.set(nKey, tentativeG);
                fScore.set(nKey, tentativeG + pathHeuristic({ cx: ncx, cy: ncy }, goal));
                if (!open.some(n => n.cx === ncx && n.cy === ncy)) open.push({ cx: ncx, cy: ncy });
            }
        }
    }
    return null; // sin camino posible
}

function reconstructPath(cameFrom, endNode, key) {
    const cells = [endNode];
    let currentKey = key(endNode.cx, endNode.cy);
    while (cameFrom.has(currentKey)) {
        const prev = cameFrom.get(currentKey);
        cells.unshift(prev);
        currentKey = key(prev.cx, prev.cy);
    }
    return cells.map(c => ({ x: (c.cx + 0.5) * TILE_SIZE, y: (c.cy + 0.5) * TILE_SIZE }));
}

// "String pulling": si hay línea de vista directa entre dos waypoints no
// adyacentes, se descartan los intermedios — evita el zigzag de seguir la
// grilla al pie de la letra y deja un camino más suave/diagonal.
function simplifyPath(dungeon, waypoints) {
    if (waypoints.length <= 2) return waypoints;
    const simplified = [waypoints[0]];
    let anchor = 0;
    for (let i = 1; i < waypoints.length - 1; i++) {
        if (!hasLineOfSight(dungeon, waypoints[anchor], waypoints[i + 1])) {
            simplified.push(waypoints[i]);
            anchor = i;
        }
    }
    simplified.push(waypoints[waypoints.length - 1]);
    return simplified;
}

function hasLineOfSight(dungeon, a, b) {
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(dist / (TILE_SIZE * 0.5)));
    for (let i = 1; i < steps; i++) {
        const t = i / steps;
        if (!dungeon.isWalkable(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, 4)) return false;
    }
    return true;
}

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

        // Pathfinding (ver findPath más arriba): waypoints en píxeles hacia
        // el jugador, recalculados periódicamente (no cada frame). El
        // intervalo lleva un jitter propio por enemigo (500-800ms) para que
        // no todos recalculen en el mismo frame cuando hay muchos persiguiendo
        // a la vez.
        this.path = [];
        this.pathIndex = 0;
        this.lastPathAt = 0;
        this.pathRecalcIntervalMs = 500 + Math.random() * 300;
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
    // Recibe el `dungeon` completo (no solo un callback isWalkable): el
    // pathfinding necesita la grilla de tiles (dungeon.tiles/cols/rows), no
    // solo un chequeo puntual de un punto.
    update(dt, player, dungeon) {
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
            this.path = [];
            return;
        }
        // Alcance de ataque propio del tipo (70-100px, cada uno distinto;
        // Jefe Final 150px fijo — ver ENEMY_TYPES/spawnFinalBossEntity),
        // con ENEMY_ATTACK_RANGE como respaldo si algún tipo no lo define.
        if (dist <= (this.type.attackRange || ENEMY_ATTACK_RANGE)) {
            this.aiState = 'attacking';
            this.path = [];
            return;
        }
        if (dist <= ENEMY_VISUAL_RANGE || this.aiState === 'chasing' || this.aiState === 'attacking') {
            this.aiState = 'chasing';
            this.chaseTowardPlayer(dt, player, dungeon, now);
        } else {
            this.aiState = 'idle';
            this.path = [];
        }
    }

    // Sigue los waypoints de `this.path` (ver findPath) en vez de caminar
    // en línea recta hacia el jugador — evita que se quede empujando contra
    // una pared cuando el jugador está detrás de un obstáculo. El camino se
    // recalcula cada `pathRecalcIntervalMs` (no cada frame, ver constructor);
    // sin `dungeon` (no debería pasar en juego real, solo defensivo) o sin
    // camino encontrado, cae de vuelta al movimiento directo de antes.
    chaseTowardPlayer(dt, player, dungeon, now) {
        if (!dungeon) {
            this.stepToward(player.x, player.y, dt, null);
            return;
        }

        if (now - this.lastPathAt >= this.pathRecalcIntervalMs) {
            this.lastPathAt = now;
            const newPath = findPath(dungeon, this.x, this.y, player.x, player.y);
            this.path = newPath || [];
            this.pathIndex = 0;
        }

        let targetX = player.x, targetY = player.y;
        if (this.path.length > 0) {
            while (this.pathIndex < this.path.length && Math.hypot(this.path[this.pathIndex].x - this.x, this.path[this.pathIndex].y - this.y) < TILE_SIZE * 0.5) {
                this.pathIndex++;
            }
            if (this.pathIndex < this.path.length) {
                targetX = this.path[this.pathIndex].x;
                targetY = this.path[this.pathIndex].y;
            }
            // Si ya se consumieron todos los waypoints, sigue directo al
            // jugador para el último tramo (targetX/Y ya quedaron así arriba).
        }
        this.stepToward(targetX, targetY, dt, dungeon);
    }

    // Un paso de movimiento hacia (targetX,targetY), con el mismo
    // "wall-slide" de siempre como red de seguridad (permite deslizar por
    // un eje aunque el otro esté bloqueado) incluso siguiendo un waypoint.
    stepToward(targetX, targetY, dt, dungeon) {
        const dirX = targetX - this.x, dirY = targetY - this.y;
        const len = Math.hypot(dirX, dirY) || 1;
        const step = this.speed * (dt / 16);
        const nx = this.x + (dirX / len) * step;
        const ny = this.y + (dirY / len) * step;
        if (!dungeon || dungeon.isWalkable(nx, this.y, this.radius)) this.x = nx;
        if (!dungeon || dungeon.isWalkable(this.x, ny, this.radius)) this.y = ny;
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
    constructor(x, y, rarity, guardTarget, opts = {}) {
        this.x = x;
        this.y = y;
        this.isBossChest = !!opts.isBossChest; // ver spawnFinalBossChest en game.js: sin guardianes, se desbloquea al morir el Jefe Final
        this.radius = this.isBossChest ? CHEST_BOSS_RADIUS : 22;
        this.rarity = rarity;
        this.guardTarget = guardTarget; // población objetivo de guardianes Y denominador del progreso
        this.zoneKills = 0; // enemigos derrotados DENTRO de la zona (progreso de desbloqueo)
        this.unlocked = false;
        this.opened = false;
        this.pendingSpawns = []; // timestamps (ms epoch) de reposiciones de guardianes en curso
        this.customLoot = null; // botín pre-armado (Jefe Final, ver Combat.onEnemyDefeated); si es null se genera con generateChestLoot al abrir
        this.customGold = 0; // oro pre-armado (Jefe Final)
    }

    registerZoneKill() {
        if (this.unlocked || this.opened) return;
        this.zoneKills = Math.min(this.guardTarget, this.zoneKills + 1);
        if (this.zoneKills >= this.guardTarget) this.unlocked = true;
    }
}
