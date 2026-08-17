// ===== LOOP PRINCIPAL DEL JUEGO =====

(function () {
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');

    const minimapCanvas = document.getElementById('minimap');
    const minimapCtx = minimapCanvas.getContext('2d');
    const minimapStatic = document.createElement('canvas'); // capa pre-renderizada de salas/pasillos del piso actual

    const mapLargeCanvas = document.getElementById('map-large');
    const mapLargeCtx = mapLargeCanvas.getContext('2d');
    const mapPanelEl = document.getElementById('map-panel');

    let player;
    let dungeon;
    let portals = []; // [{ x, y, radius, esquina, destino }] las 4 esquinas del mapa
    let enemies = [];
    let nodes = [];
    let resourceZones = []; // [{ type, x, y }] centros de las zonas densas de recursos, para el minimapa
    let chests = [];
    let floatingTexts = []; // {x,y,text,color,life,vy}
    let gathering = null; // { node, elapsed }
    let opening = null; // { chest, elapsed } — abriendo un cofre
    let dead = false;
    let teleportPending = false; // esperando un click en el mapa para usar un pergamino de teletransportación

    // El Jefe Final vivo NO persiste entre pisos (el enemigo en sí se
    // descarta al cambiar de piso, como cualquier otro); esto se resetea en
    // cada loadFloor. El progreso hacia desbloquearlo SÍ persiste entre
    // pisos (ver player.finalBossPoints, sistema de puntos en constants.js).
    let finalBossAlive = false;
    const camera = { x: 0, y: 0 }; // esquina superior-izquierda de la cámara, en coordenadas del mundo

    let lastTime = performance.now();
    let saveTimer = 0;

    const keys = new Set();
    const MOVE_KEYS = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];

    // El canvas ocupa toda la pantalla; se recalcula al redimensionar la ventana.
    function resizeCanvas() {
        CANVAS_WIDTH = window.innerWidth;
        CANVAS_HEIGHT = window.innerHeight;
        canvas.width = CANVAS_WIDTH;
        canvas.height = CANVAS_HEIGHT;
    }

    function init() {
        resizeCanvas();
        UI.init();
        player = new Player();
        Combat.onKillHook = handleEnemyKilled;
        UI.onUseTeleportScroll = requestTeleport;
        UI.onTeleportToFloor = teleportToFloor;
        loadFloor(player.floor);
        bindInput();
        window.addEventListener('resize', () => {
            resizeCanvas();
            updateCamera();
        });
        UI.updateHUD(player);
        UI.renderInventory(player);
        UI.renderEnchantments(player);
        requestAnimationFrame(loop);
    }

    // Pre-renderiza la distribución de salas/pasillos del piso a una capa
    // offscreen de baja resolución (1px por tile), para dibujar el minimapa
    // sin recorrer miles de tiles en cada frame.
    function buildMinimapStatic() {
        minimapStatic.width = dungeon.cols;
        minimapStatic.height = dungeon.rows;
        const sctx = minimapStatic.getContext('2d');
        const img = sctx.createImageData(dungeon.cols, dungeon.rows);
        for (let cy = 0; cy < dungeon.rows; cy++) {
            for (let cx = 0; cx < dungeon.cols; cx++) {
                const idx = (cy * dungeon.cols + cx) * 4;
                if (dungeon.tiles[dungeon.tileIndex(cx, cy)] === 1) {
                    img.data[idx] = 176; img.data[idx + 1] = 168; img.data[idx + 2] = 214; img.data[idx + 3] = 235;
                }
            }
        }
        sctx.putImageData(img, 0, 0);
    }

    function drawMinimap() {
        minimapCtx.clearRect(0, 0, minimapCanvas.width, minimapCanvas.height);
        minimapCtx.drawImage(minimapStatic, 0, 0, minimapCanvas.width, minimapCanvas.height);

        const scaleX = minimapCanvas.width / (dungeon.cols * TILE_SIZE);
        const scaleY = minimapCanvas.height / (dungeon.rows * TILE_SIZE);

        minimapCtx.textAlign = 'center';
        minimapCtx.textBaseline = 'middle';
        minimapCtx.font = '9px sans-serif';
        resourceZones.forEach(z => {
            minimapCtx.fillText(RESOURCE_TYPES[z.type].emoji, z.x * scaleX, z.y * scaleY);
        });
        minimapCtx.font = '11px sans-serif';
        enemies.forEach(en => {
            if (en.alive && en.type.isBoss) minimapCtx.fillText(en.type.emoji, en.x * scaleX, en.y * scaleY);
        });
        chests.forEach(c => {
            if (!c.opened) minimapCtx.fillText(c.unlocked ? '🎁' : '🔒', c.x * scaleX, c.y * scaleY);
        });

        portals.forEach(p => {
            minimapCtx.beginPath();
            minimapCtx.arc(p.x * scaleX, p.y * scaleY, 3.5, 0, Math.PI * 2);
            minimapCtx.fillStyle = '#c9a6ff';
            minimapCtx.fill();
        });

        minimapCtx.beginPath();
        minimapCtx.arc(player.x * scaleX, player.y * scaleY, 3, 0, Math.PI * 2);
        minimapCtx.fillStyle = '#8a5cff';
        minimapCtx.fill();
        minimapCtx.lineWidth = 1;
        minimapCtx.strokeStyle = '#fff';
        minimapCtx.stroke();
    }

    // Versión ampliada del minimapa, mostrada en el panel de mapa (tecla M).
    function drawBigMap() {
        mapLargeCtx.clearRect(0, 0, mapLargeCanvas.width, mapLargeCanvas.height);
        mapLargeCtx.drawImage(minimapStatic, 0, 0, mapLargeCanvas.width, mapLargeCanvas.height);

        const scaleX = mapLargeCanvas.width / (dungeon.cols * TILE_SIZE);
        const scaleY = mapLargeCanvas.height / (dungeon.rows * TILE_SIZE);

        mapLargeCtx.textAlign = 'center';
        mapLargeCtx.textBaseline = 'middle';
        mapLargeCtx.font = '16px sans-serif';
        resourceZones.forEach(z => {
            mapLargeCtx.fillText(RESOURCE_TYPES[z.type].emoji, z.x * scaleX, z.y * scaleY);
        });
        mapLargeCtx.font = '20px sans-serif';
        enemies.forEach(en => {
            if (en.alive && en.type.isBoss) mapLargeCtx.fillText(en.type.emoji, en.x * scaleX, en.y * scaleY);
        });
        chests.forEach(c => {
            if (!c.opened) mapLargeCtx.fillText(c.unlocked ? '🎁' : '🔒', c.x * scaleX, c.y * scaleY);
        });

        portals.forEach(p => {
            mapLargeCtx.beginPath();
            mapLargeCtx.arc(p.x * scaleX, p.y * scaleY, 7, 0, Math.PI * 2);
            mapLargeCtx.fillStyle = '#c9a6ff';
            mapLargeCtx.fill();
        });

        mapLargeCtx.beginPath();
        mapLargeCtx.arc(player.x * scaleX, player.y * scaleY, 6, 0, Math.PI * 2);
        mapLargeCtx.fillStyle = '#8a5cff';
        mapLargeCtx.fill();
        mapLargeCtx.lineWidth = 2;
        mapLargeCtx.strokeStyle = '#fff';
        mapLargeCtx.stroke();
    }

    // Sortea una rareza para el tipo de enemigo (6 niveles, ver MONSTER_RARITIES)
    // y aplica su bono de fuerza (+10% acumulativo por nivel) a hp/dmg.
    function applyMonsterRarity(type) {
        const rarity = rollMonsterRarity();
        type.rarity = rarity;
        type.hp = Math.max(1, Math.round(type.hp * rarity.mult));
        type.dmg = Math.max(1, Math.round(type.dmg * rarity.mult));
    }

    // Baraja un array in-place (Fisher-Yates).
    function shuffleArray(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    // Convierte el descriptor de jefe generado por grid-dungeon.js
    // (jefe_especial cada 10 pisos, o jefe_aleatorio según probabilidad) en
    // un Enemy real, reusando toda la maquinaria existente de combate/UI
    // (health bar dorada, detección de jefe, drop de núcleo, etc. — todo
    // eso ya funciona con cualquier enemigo que tenga type.isBoss).
    function spawnJefeDelPiso(jefe) {
        if (!jefe) return;
        const rarityId = jefe.tipo === 'jefe_especial' ? 'mitico' : 'legendario';
        const type = {
            id: `jefe_${jefe.tipo}_${jefe.numero || 0}`,
            name: jefe.nombre,
            emoji: jefe.emoji,
            hp: jefe.hp, dmg: jefe.damage, xp: jefe.xpFlat,
            color: '#3a2f1a', radius: jefe.tipo === 'jefe_especial' ? 34 : 26,
            defense: jefe.defensa,
            isBoss: true, bossKind: jefe.tipo,
            rarity: getMonsterRarity(rarityId),
        };
        enemies.push(new Enemy(type, jefe.posicion.x, jefe.posicion.y));
    }

    function loadFloor(floorNum) {
        if (floorNum > player.maxFloorReached) {
            player.maxFloorReached = floorNum;
            player.save();
        }

        dungeon = generateDungeon(floorNum);
        buildMinimapStatic();

        // El jugador siempre aparece en el centro exacto del mapa (ver
        // POSICION_JUGADOR_INICIO en grid-dungeon.js), no en una sala.
        player.x = dungeon.posicionJugadorInicio.x;
        player.y = dungeon.posicionJugadorInicio.y;
        updateCamera();

        // Zonas de recursos: salas completas densas en un solo tipo de
        // recurso, en vez de nodos sueltos repartidos por todo el piso.
        // Cada zona tiene además 1 nodo especial: 10x más lento pero rinde 10.
        nodes = [];
        resourceZones = [];
        const zoneRooms = shuffleArray(dungeon.rooms.slice());
        let roomCursor = 0;
        ['tree', 'rock', 'plant', 'herb'].forEach(type => {
            for (let z = 0; z < RESOURCE_ZONES_PER_TYPE; z++) {
                const room = zoneRooms[roomCursor++];
                if (!room) break; // sin más salas libres
                const nodeCount = RESOURCE_ZONE_MIN_NODES + Math.floor(Math.random() * (RESOURCE_ZONE_MAX_NODES - RESOURCE_ZONE_MIN_NODES + 1));
                const center = dungeon.randomPointInRoom(room, TILE_SIZE * 2);
                const specialIndex = Math.floor(Math.random() * nodeCount);
                for (let i = 0; i < nodeCount; i++) {
                    const pos = dungeon.randomPointInRoom(room, TILE_SIZE * 1.5);
                    nodes.push(new ResourceNode(type, pos.x, pos.y, i === specialIndex));
                }
                resourceZones.push({ type, x: center.x, y: center.y });
            }
        });

        // El piso arranca por debajo del cap; el respawn dinámico (al matar
        // enemigos) va rellenando el resto con el tiempo.
        enemies = [];
        const pool = getEnemyPoolForFloor(floorNum);
        const initialCount = Math.round(ENEMIES_PER_FLOOR * INITIAL_SPAWN_RATIO);
        for (let i = 0; i < initialCount; i++) {
            const base = pool[Math.floor(Math.random() * pool.length)];
            const type = buildScaledEnemyType(base, floorNum);
            applyMonsterRarity(type);
            enemies.push(spawnEnemyInDungeon(type, dungeon));
        }

        // Jefe del piso (especial garantizado cada 10 pisos, o aleatorio con
        // probabilidad creciente): decidido/ubicado por grid-dungeon.js.
        spawnJefeDelPiso(dungeon.jefe);

        finalBossAlive = false;

        // Cofres: no reaparecen, hay que vencer enemigos cerca para abrirlos.
        chests = [];
        opening = null;
        const chestRooms = shuffleArray(dungeon.rooms.slice());
        for (let i = 0; i < CHESTS_PER_FLOOR; i++) {
            const room = chestRooms[i];
            if (!room) break;
            const pos = dungeon.randomPointInRoom(room, TILE_SIZE * 2);
            const chest = new Chest(pos.x, pos.y, rollMonsterRarity());
            chests.push(chest);
            for (let g = 0; g < CHEST_GUARD_INITIAL; g++) spawnChestGuard(chest);
        }

        // 4 portales fijos en las esquinas del mapa (ver generarPortales en
        // grid-dungeon.js): arriba-izq = piso anterior, arriba-der = piso
        // siguiente, abajo-izq = reset a piso 1, abajo-der = piso aleatorio
        // (no hay menú principal en este juego).
        portals = dungeon.portales.map(p => ({ x: p.posicion.x, y: p.posicion.y, radius: 28, esquina: p.esquina, destino: p.destino }));

        UI.updateFloorHUD(floorNum, enemies.filter(e => e.alive).length, finalBossAlive);
    }

    // ----- JEFES DINÁMICOS (minijefe/jefe, aparecen al matar enemigos) -----
    function spawnDynamicBoss(kind) {
        const tierDef = BOSS_TIERS[kind];
        const pool = getEnemyPoolForFloor(player.floor);
        const base = pool[Math.floor(Math.random() * pool.length)];
        const scaled = buildScaledEnemyType(base, player.floor);
        const rarity = getMonsterRarity(tierDef.rarities[Math.floor(Math.random() * tierDef.rarities.length)]);

        scaled.hp = Math.max(1, Math.round(scaled.hp * tierDef.mult));
        scaled.dmg = Math.max(1, Math.round(scaled.dmg * tierDef.mult));
        scaled.xp = Math.round(scaled.xp * tierDef.mult);
        scaled.rarity = rarity;
        scaled.radius = Math.round(base.radius * tierDef.radiusMult);
        scaled.isBoss = true;
        scaled.bossKind = kind;
        scaled.name = `${tierDef.label}: ${scaled.name}`;

        const room = dungeon.rooms[Math.floor(Math.random() * dungeon.rooms.length)];
        const pos = dungeon.randomPointInRoom(room, TILE_SIZE * 2);
        enemies.push(new Enemy(scaled, pos.x, pos.y));

        const label = kind === 'jefe' ? '💀 ¡Un Jefe apareció en el piso!' : '⚔️ ¡Un Minijefe apareció en el piso!';
        UI.showLevelToastText(label);
        UI.updateFloorHUD(player.floor, enemies.filter(e => e.alive).length, finalBossAlive);
    }

    // ----- JEFE FINAL (sistema de puntos, ver constants.js) -----
    // Aparece en el piso ACTUAL del jugador (que siempre cae dentro de su
    // propio rango de 10 pisos). Su fuerza y el tamaño del loot escalan
    // según qué tan adentro del rango esté ese piso (pisoEnRango 1-10:
    // piso X1 = más débil/menos loot, piso X0 = más fuerte/más loot).
    function spawnFinalBossAt(floor) {
        const { pisoEnRango } = calcularProbabilidadNucleoAdicional(floor);
        const tierDef = BOSS_TIERS.jefe_final;
        const pool = getEnemyPoolForFloor(floor);
        const base = pool[Math.floor(Math.random() * pool.length)];
        const scaled = buildScaledEnemyType(base, floor);
        const mult = tierDef.mult * (0.5 + 0.5 * (pisoEnRango - 1) / 9);

        scaled.hp = Math.max(1, Math.round(scaled.hp * mult));
        scaled.dmg = Math.max(1, Math.round(scaled.dmg * mult));
        scaled.xp = Math.round(scaled.xp * mult);
        scaled.rarity = getMonsterRarity('mitico');
        scaled.radius = Math.round(base.radius * tierDef.radiusMult);
        scaled.isBoss = true;
        scaled.isFinalBoss = true;
        scaled.bossKind = 'jefe_final';
        scaled.pisoEnRango = pisoEnRango; // ver Combat.onEnemyDefeated: escala el loot de ore/madera
        scaled.name = `${tierDef.label}: ${scaled.name}`;

        const room = dungeon.rooms[Math.floor(Math.random() * dungeon.rooms.length)];
        const pos = dungeon.randomPointInRoom(room, TILE_SIZE * 2);
        enemies.push(new Enemy(scaled, pos.x, pos.y));

        finalBossAlive = true;
        UI.showLevelToastText('👑 ¡El Jefe Final apareció!');
        UI.updateFloorHUD(player.floor, enemies.filter(e => e.alive).length, finalBossAlive);
    }

    // Se llama por CADA enemigo eliminado (incluye multi-kills por AoE).
    // Tira minijefe/jefe de forma independiente. Derrotar un minijefe suma
    // FINAL_BOSS_MINIJEFE_POINTS al contador del Jefe Final, y un jefe
    // especial de piso suma FINAL_BOSS_JEFE_ESPECIAL_POINTS; al llegar a
    // FINAL_BOSS_POINTS_TARGET, cada enemigo derrotado tiene
    // FINAL_BOSS_SPAWN_CHANCE de hacerlo aparecer en el piso actual.
    function handleEnemyKilled(target) {
        registerChestKill(target);

        if (target.type.isFinalBoss) {
            finalBossAlive = false;
            player.finalBossPoints = 0;
            return;
        }

        if (Math.random() < BOSS_TIERS.minijefe.chance) spawnDynamicBoss('minijefe');
        if (Math.random() < BOSS_TIERS.jefe.chance) spawnDynamicBoss('jefe');

        if (target.type.bossKind === 'minijefe') player.finalBossPoints += FINAL_BOSS_MINIJEFE_POINTS;
        else if (target.type.bossKind === 'jefe_especial') player.finalBossPoints += FINAL_BOSS_JEFE_ESPECIAL_POINTS;

        if (!finalBossAlive && player.finalBossPoints >= FINAL_BOSS_POINTS_TARGET && Math.random() < FINAL_BOSS_SPAWN_CHANCE) {
            spawnFinalBossAt(player.floor);
        }
    }

    // ----- COFRES -----
    function spawnChestGuard(chest) {
        const pool = getEnemyPoolForFloor(player.floor);
        const base = pool[Math.floor(Math.random() * pool.length)];
        const type = buildScaledEnemyType(base, player.floor);
        applyMonsterRarity(type);
        let pos = { x: chest.x + (Math.random() - 0.5) * 140, y: chest.y + (Math.random() - 0.5) * 140 };
        if (!dungeon.isWalkable(pos.x, pos.y, type.radius)) pos = { x: chest.x, y: chest.y };
        enemies.push(new Enemy(type, pos.x, pos.y));
    }

    // Si el enemigo eliminado estaba cerca de un cofre todavía bloqueado,
    // cuenta para su desbloqueo y le manda un guardia de reemplazo rápido
    // (hasta llegar al requisito; después deja de reponer).
    function registerChestKill(target) {
        chests.forEach(chest => {
            if (chest.unlocked || chest.opened) return;
            if (Math.hypot(target.x - chest.x, target.y - chest.y) > CHEST_KILL_RADIUS) return;
            chest.registerNearbyKill();
            if (chest.unlocked) {
                addFloatingText(chest.x, chest.y - chest.radius - 16, '🔓 ¡Cofre desbloqueado!', '#ffd27a');
            } else {
                spawnChestGuard(chest);
            }
        });
    }

    function findNearestChest() {
        let best = null, bestDist = Infinity;
        chests.forEach(c => {
            if (c.opened) return;
            const d = Math.hypot(c.x - player.x, c.y - player.y);
            if (d <= CHEST_INTERACT_RANGE && d < bestDist) { bestDist = d; best = c; }
        });
        return best;
    }

    function startOpenChest(chest) {
        if (dead || Combat.active || isAnyPanelOpen() || chest.opened) return;
        if (!chest.unlocked) {
            addFloatingText(chest.x, chest.y - chest.radius - 16, `Cofre bloqueado: ${chest.kills}/${chest.requiredKills}`, '#ff8585');
            return;
        }
        if (opening && opening.chest === chest) return; // ya en progreso
        gathering = null;
        opening = { chest, elapsed: 0 };
    }

    const CHEST_LOOT_TEXT_LIFE = 900 * 3; // el texto de lo que suelta el cofre dura 3x más que el resto

    function completeOpenChest(chest) {
        chest.opened = true;
        const loot = generateChestLoot(chest.rarity, player.floor);
        const ids = Object.keys(loot);
        ids.forEach((id, i) => {
            const qty = loot[id];
            player.gainMaterial(id, qty);
            const info = getMaterialInfo(id);
            addFloatingText(chest.x, chest.y - 30 - i * 16, `+${qty} ${info.emoji} ${info.name}`, '#ffd27a', CHEST_LOOT_TEXT_LIFE);
        });
        addFloatingText(chest.x, chest.y - 30 - ids.length * 16, `🎁 ¡Cofre ${chest.rarity.name} abierto!`, chest.rarity.color, CHEST_LOOT_TEXT_LIFE);
    }

    // Rendimiento de un nodo normal: 1-3 de base; un nodo especial: 10-20 de
    // base. Una herramienta de recolección crafteada equipada sube el máximo
    // según su rareza (en ambos casos).
    function getGatherYieldRange(node) {
        const gatherProfId = RESOURCE_TO_PROFESSION[node.type];
        const tool = player.getEquippedCraftedItem(gatherProfId);
        if (node.special) {
            const max = tool ? getSpecialNodeYieldMax(tool.rarityId) : SPECIAL_NODE_YIELD_MAX_BASE;
            return { min: SPECIAL_NODE_YIELD_MIN, max };
        }
        const max = tool ? getGatherYieldMax(tool.rarityId) : GATHER_YIELD_MAX_BASE;
        return { min: GATHER_YIELD_MIN, max };
    }

    // Rellena el piso con nuevos enemigos (hasta el cap) tras un combate.
    // Si el grupo derrotado era un enemigo solitario, el reemplazo aparece
    // acompañado (2-3 enemigos, posiblemente de otra especie/rareza).
    function spawnReplacementEnemies(count) {
        const aliveCount = enemies.filter(e => e.alive).length;
        const spawnCount = Math.min(count, Math.max(0, ENEMIES_PER_FLOOR - aliveCount));
        if (spawnCount <= 0) return;

        if (!dungeon.rooms.length) return;
        const room = dungeon.rooms[Math.floor(Math.random() * dungeon.rooms.length)];
        const anchor = dungeon.randomPointInRoom(room, TILE_SIZE * 2);
        const pool = getEnemyPoolForFloor(player.floor);

        for (let i = 0; i < spawnCount; i++) {
            const base = pool[Math.floor(Math.random() * pool.length)];
            const type = buildScaledEnemyType(base, player.floor);
            applyMonsterRarity(type);
            let pos = { x: anchor.x + (Math.random() - 0.5) * 70, y: anchor.y + (Math.random() - 0.5) * 70 };
            if (!dungeon.isWalkable(pos.x, pos.y, type.radius)) pos = anchor;
            enemies.push(new Enemy(type, pos.x, pos.y));
        }
    }

    // Viaja al piso `targetFloor` (usado por los 4 portales de esquina, ver
    // generarPortales en grid-dungeon.js). `destino: 'aleatorio'` (portal
    // abajo-derecha) se resuelve acá mismo, ya que no hay menú principal en
    // este juego.
    function travelToFloor(targetFloor) {
        if (targetFloor === 'aleatorio') targetFloor = 1 + Math.floor(Math.random() * MAX_FLOOR);
        targetFloor = Math.max(1, Math.min(MAX_FLOOR, targetFloor));
        if (targetFloor === player.floor) {
            addFloatingText(player.x, player.y - 40, 'Ya estás en este piso', '#ffd27a');
            return;
        }
        player.floor = targetFloor;
        loadFloor(player.floor);
        player.save();
        UI.showLevelToastText(`🌀 Piso ${player.floor}`);
    }

    // Teletransportación vía Ventana de Pisos (tecla P): a diferencia de
    // travelToFloor (portales, sin costo, solo piso ±1/reset/aleatorio),
    // esto salta a CUALQUIER piso ya alcanzado (player.maxFloorReached) a
    // cambio de 1 Pergamino de Teletransportación.
    function teleportToFloor(targetFloor) {
        if (dead || Combat.active) return;
        if (targetFloor === player.floor) {
            UI.showLevelToastText('Ya estás en este piso');
            return;
        }
        if ((player.materials.pergamino_teletransporte || 0) < 1) {
            UI.showLevelToastText('❌ No tenés Pergaminos de Teletransportación');
            return;
        }
        player.materials.pergamino_teletransporte--;
        UI.hidePanel('floors-panel');
        UI.playTeleportFade(() => {
            player.floor = targetFloor;
            loadFloor(player.floor);
            player.save();
            UI.showLevelToastText(`📜 ¡Teletransportado al Piso ${targetFloor}!`);
            UI.renderInventory(player);
        });
    }

    function getCanvasCoords(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY,
        };
    }

    // Convierte una coordenada del viewport (canvas) a coordenadas del mundo.
    function toWorldCoords(canvasX, canvasY) {
        return { x: canvasX + camera.x, y: canvasY + camera.y };
    }

    function updateCamera() {
        camera.x = Math.max(0, Math.min(WORLD_WIDTH - CANVAS_WIDTH, player.x - CANVAS_WIDTH / 2));
        camera.y = Math.max(0, Math.min(WORLD_HEIGHT - CANVAS_HEIGHT, player.y - CANVAS_HEIGHT / 2));
    }

    function isAnyPanelOpen() {
        return ['inventory-panel', 'enchant-panel', 'map-panel', 'craft-panel', 'stats-panel', 'guide-panel', 'floors-panel', 'combat-panel', 'victory-panel']
            .some(id => !document.getElementById(id).classList.contains('hidden'));
    }

    // Pergaminos de teletransportación (1 solo uso): al usarse desde el
    // inventario, se abre el mapa y el próximo click ahí teletransporta.
    function requestTeleport() {
        if (dead || Combat.active) return;
        if ((player.materials.pergamino_teletransporte || 0) <= 0) return;
        teleportPending = true;
        UI.hidePanel('inventory-panel');
        document.getElementById('map-panel').classList.remove('hidden');
        UI.showLevelToastText('🗺️ Tocá el mapa para teletransportarte');
    }

    function bindInput() {
        canvas.addEventListener('click', e => {
            const canvasPos = getCanvasCoords(e.clientX, e.clientY);
            const { x, y } = toWorldCoords(canvasPos.x, canvasPos.y);
            handleWorldClick(x, y);
        });

        canvas.addEventListener('touchstart', e => {
            const t = e.touches[0];
            const canvasPos = getCanvasCoords(t.clientX, t.clientY);
            const { x, y } = toWorldCoords(canvasPos.x, canvasPos.y);
            handleWorldClick(x, y);
        }, { passive: true });

        // Click sobre el mapa ampliado: solo hace algo mientras se está
        // usando un pergamino de teletransportación (ver requestTeleport).
        mapLargeCanvas.addEventListener('click', e => {
            if (!teleportPending) return;
            const rect = mapLargeCanvas.getBoundingClientRect();
            const cx = (e.clientX - rect.left) * (mapLargeCanvas.width / rect.width);
            const cy = (e.clientY - rect.top) * (mapLargeCanvas.height / rect.height);
            const scaleX = mapLargeCanvas.width / (dungeon.cols * TILE_SIZE);
            const scaleY = mapLargeCanvas.height / (dungeon.rows * TILE_SIZE);
            const wx = cx / scaleX;
            const wy = cy / scaleY;
            if (!dungeon.isWalkable(wx, wy, player.radius)) {
                UI.showLevelToastText('❌ No se puede teletransportar ahí, probá otro punto');
                return;
            }
            player.materials.pergamino_teletransporte--;
            player.x = wx;
            player.y = wy;
            updateCamera();
            teleportPending = false;
            UI.hidePanel('map-panel');
            UI.showLevelToastText('📜 ¡Teletransportado!');
            UI.renderInventory(player);
        });
        document.querySelector('#map-panel .close-btn').addEventListener('click', () => { teleportPending = false; });

        window.addEventListener('keydown', e => {
            const key = e.key.toLowerCase();

            // Ventana de Victoria: Espacio equivale a click en "Continuar".
            // e.repeat descarta el auto-repeat del SO al mantener apretada
            // la tecla; el propio ocultamiento del panel (ver
            // UI.triggerVictoryContinue) evita activaciones múltiples.
            if (key === ' ' && UI.isVictoryPanelVisible()) {
                e.preventDefault();
                if (!e.repeat) UI.triggerVictoryContinue();
                return;
            }

            if (Combat.active) {
                if (key === '1' || key === '2' || key === '3') {
                    e.preventDefault();
                    Combat.playerAttack(parseInt(key, 10) - 1);
                } else if (key === 'g') {
                    e.preventDefault();
                    useFirstAvailablePotionInCombat();
                } else if (key === ' ') {
                    e.preventDefault();
                    Combat.playerEndTurn();
                }
                return;
            }

            if (MOVE_KEYS.includes(key)) {
                keys.add(key);
                e.preventDefault();
                return;
            }

            if (key === ' ') {
                e.preventDefault();
                if (dead || isAnyPanelOpen()) return;
                const enemy = findNearestEnemyInRange();
                if (enemy) { engageEnemy(enemy); return; }
                const chest = findNearestChest();
                if (chest) { startOpenChest(chest); return; }
                const node = findNearestGatherNode();
                if (node) startGather(node);
                return;
            }

            if (key === 'escape') {
                e.preventDefault();
                teleportPending = false;
                ['inventory-panel', 'enchant-panel', 'map-panel', 'craft-panel', 'stats-panel', 'guide-panel', 'floors-panel'].forEach(id => UI.hidePanel(id));
                return;
            }

            if (key === 'i') { UI.renderInventory(player); UI.togglePanel('inventory-panel'); }
            else if (key === 'e') { UI.renderEnchantments(player); UI.togglePanel('enchant-panel'); }
            else if (key === 'm') { teleportPending = false; UI.togglePanel('map-panel'); }
            else if (key === 'c') { UI.renderCraft(player); UI.togglePanel('craft-panel'); }
            else if (key === 'v') { UI.renderStats(player); UI.togglePanel('stats-panel'); }
            else if (key === 'p') { UI.renderFloors(player); UI.togglePanel('floors-panel'); }
            else if (key === 'g') { UI.renderGuide(); UI.togglePanel('guide-panel'); }
            else if (key === 'r') { if (dead) respawn(); }
        });

        window.addEventListener('keyup', e => {
            keys.delete(e.key.toLowerCase());
        });
    }

    // Tecla G en combate: usa la primera poción disponible (rareza más común
    // primero, para conservar las mejores) respetando los límites de Combat.
    function useFirstAvailablePotionInCombat() {
        for (const rarity of MONSTER_RARITIES) {
            if ((player.materials[`pocion_${rarity.id}`] || 0) > 0) {
                Combat.usePotionInCombat(rarity.id);
                return;
            }
        }
    }

    function respawn() {
        dead = false;
        gathering = null;
        player.hp = player.maxHp;
        player.x = dungeon.posicionJugadorInicio.x;
        player.y = dungeon.posicionJugadorInicio.y;
        updateCamera();
        player.lastDamageTime = Date.now();
        UI.showGameOver(false);
    }

    function addFloatingText(x, y, text, color, life) {
        const maxLife = life || 900;
        floatingTexts.push({ x, y, text, color, life: maxLife, maxLife, vy: -0.7 });
    }

    function onCombatResolved(result) {
        keys.clear();
        UI.hideCombatPanel();
        if (result === 'victory') {
            // Un grupo de un solo enemigo (peleado en solitario) se reemplaza
            // por 2-3 nuevos, para que el piso tienda a formar más grupos.
            const wasSolitary = Combat.enemies.length === 1;
            enemies = enemies.filter(en => en.alive);
            spawnReplacementEnemies(wasSolitary ? 2 + Math.floor(Math.random() * 2) : 1);
        } else if (result === 'defeat') {
            dead = true;
            UI.showGameOver(true);
            player.save();
        }
        UI.updateHUD(player);
        UI.updateFloorHUD(player.floor, enemies.filter(e => e.alive).length, finalBossAlive);
    }

    // Enemigo vivo más cercano al jugador dentro del rango de combate.
    function findNearestEnemyInRange() {
        let best = null, bestDist = Infinity;
        enemies.forEach(en => {
            if (!en.alive) return;
            const d = Math.hypot(en.x - player.x, en.y - player.y);
            if (d <= ENGAGE_RANGE && d < bestDist) { bestDist = d; best = en; }
        });
        return best;
    }

    // Nodo de recurso no agotado más cercano al jugador dentro del rango de recolección.
    function findNearestGatherNode() {
        let best = null, bestDist = Infinity;
        nodes.forEach(n => {
            if (n.depleted) return;
            const d = Math.hypot(n.x - player.x, n.y - player.y);
            if (d <= GATHER_RANGE && d < bestDist) { bestDist = d; best = n; }
        });
        return best;
    }

    function engageEnemy(target) {
        if (dead || Combat.active || isAnyPanelOpen()) return;
        gathering = null;
        const group = enemies.filter(en => en.alive &&
            Math.hypot(en.x - target.x, en.y - target.y) <= ENGAGE_GROUP_RADIUS);
        keys.clear();
        Combat.start(player, group, onCombatResolved);
    }

    function startGather(node) {
        if (dead || Combat.active || isAnyPanelOpen() || node.depleted) return;
        if (gathering && gathering.node === node) return; // ya en progreso
        gathering = { node, elapsed: 0 };
    }

    function getGatherDuration(node) {
        return node.special ? GATHER_TIME * SPECIAL_NODE_TIME_MULT : GATHER_TIME;
    }

    function completeGather(node) {
        node.collect();
        addFloatingText(node.x, node.y - 20, `+${RESOURCE_TYPES[node.type].xp}`, '#a685ff');
        addFloatingText(node.x, node.y - 36, '¡Recolectado!', '#ffd27a');
        player.gainXP(RESOURCE_TYPES[node.type].xp);

        // Además de XP, cada recolección da material: la roca da el mineral
        // por tier (Bronce..Adamantite) y la hierba su propio tier, el resto
        // da su recurso (Madera, Cultivo). El nodo especial (1 por zona)
        // rinde 10-20 de una; el resto rinde una cantidad aleatoria menor
        // (más en ambos casos si hay una herramienta crafteada equipada).
        const matId = getGatherMaterialId(node.type, player.floor);
        const range = getGatherYieldRange(node);
        const qty = range.min + Math.floor(Math.random() * (range.max - range.min + 1));
        player.gainMaterial(matId, qty);
        const matInfo = getMaterialInfo(matId);
        addFloatingText(node.x, node.y - 52, `+${qty} ${matInfo.emoji} ${matInfo.name}`, '#ffd27a');
    }

    function handleWorldClick(x, y) {
        if (dead || Combat.active || isAnyPanelOpen()) return;

        // 0) ¿Se hizo click sobre alguno de los 4 portales de esquina?
        const clickedPortal = portals.find(p => Math.hypot(p.x - x, p.y - y) <= p.radius + 8);
        if (clickedPortal) {
            const distToPlayer = Math.hypot(clickedPortal.x - player.x, clickedPortal.y - player.y);
            if (distToPlayer > ENGAGE_RANGE) {
                addFloatingText(clickedPortal.x, clickedPortal.y - clickedPortal.radius - 12, 'Acercate al portal', '#ffd27a');
                return;
            }
            travelToFloor(clickedPortal.destino);
            return;
        }

        // 1) ¿Se hizo click sobre un enemigo? -> iniciar combate si está cerca
        let clickedEnemy = null, bestDist = Infinity;
        enemies.forEach(en => {
            if (!en.alive) return;
            const d = Math.hypot(en.x - x, en.y - y);
            if (d <= en.radius + 6 && d < bestDist) { bestDist = d; clickedEnemy = en; }
        });

        if (clickedEnemy) {
            const distToPlayer = Math.hypot(clickedEnemy.x - player.x, clickedEnemy.y - player.y);
            if (distToPlayer > ENGAGE_RANGE) {
                addFloatingText(clickedEnemy.x, clickedEnemy.y - clickedEnemy.radius - 10, 'Muy lejos', '#ffd27a');
                return;
            }
            engageEnemy(clickedEnemy);
            return;
        }

        // 2) ¿Se hizo click sobre un cofre?
        const clickedChest = chests.find(c => !c.opened && Math.hypot(c.x - x, c.y - y) <= c.radius + 8);
        if (clickedChest) {
            const distToPlayer = Math.hypot(clickedChest.x - player.x, clickedChest.y - player.y);
            if (distToPlayer > CHEST_INTERACT_RANGE) {
                addFloatingText(clickedChest.x, clickedChest.y - clickedChest.radius - 10, 'Muy lejos', '#ffd27a');
                return;
            }
            startOpenChest(clickedChest);
            return;
        }

        // 3) ¿Se hizo click sobre un nodo de recurso? Las profesiones de
        // recolección siempre están disponibles, sin importar el arma equipada.
        const node = nodes.find(n => !n.depleted &&
            Math.hypot(n.x - x, n.y - y) <= n.radius + 8);
        if (!node) return;

        if (Math.hypot(node.x - player.x, node.y - player.y) > GATHER_RANGE) {
            addFloatingText(node.x, node.y - node.radius - 10, 'Muy lejos', '#ffd27a');
            return;
        }

        startGather(node);
    }

    function update(dt) {
        if (dead || isAnyPanelOpen()) return;

        let dirX = 0, dirY = 0;
        if (keys.has('w') || keys.has('arrowup')) dirY -= 1;
        if (keys.has('s') || keys.has('arrowdown')) dirY += 1;
        if (keys.has('a') || keys.has('arrowleft')) dirX -= 1;
        if (keys.has('d') || keys.has('arrowright')) dirX += 1;

        if (gathering) {
            if (dirX !== 0 || dirY !== 0) {
                addFloatingText(gathering.node.x, gathering.node.y - gathering.node.radius - 10, 'Recolección cancelada', '#ffd27a');
                gathering = null;
            } else if (gathering.node.depleted) {
                gathering = null;
            } else {
                gathering.elapsed += dt;
                if (gathering.elapsed >= getGatherDuration(gathering.node)) {
                    completeGather(gathering.node);
                    gathering = null;
                }
            }
        }

        if (opening) {
            if (dirX !== 0 || dirY !== 0) {
                addFloatingText(opening.chest.x, opening.chest.y - opening.chest.radius - 10, 'Apertura cancelada', '#ffd27a');
                opening = null;
            } else if (opening.chest.opened) {
                opening = null;
            } else {
                opening.elapsed += dt;
                if (opening.elapsed >= CHEST_OPEN_TIME) {
                    completeOpenChest(opening.chest);
                    opening = null;
                }
            }
        }

        player.move(dirX, dirY, dt, (x, y, r) => dungeon.isWalkable(x, y, r));
        player.tick(dt);
        updateCamera();

        nodes.forEach(n => n.update(dt));

        floatingTexts.forEach(f => { f.y += f.vy; f.life -= dt; });
        floatingTexts = floatingTexts.filter(f => f.life > 0);

        saveTimer += dt;
        if (saveTimer > 5000) {
            saveTimer = 0;
            player.save();
        }

        UI.updateHUD(player);
        UI.showLevelToasts(player);
    }

    function drawEntity(x, y, radius, emoji, color) {
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.stroke();
        ctx.font = `${Math.round(radius * 1.3)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(emoji, x, y + 1);
    }

    const NEUTRAL_COLOR = '#e4e4e2'; // blanco/gris: sin armadura o arma crafteada equipada

    // El jugador es un círculo dentro de otro: el exterior es del color de
    // rareza de la armadura equipada (o gris si no tiene ninguna crafteada),
    // el interior es del color de rareza del arma equipada y muestra su
    // emoji (o los puños, si está desarmado).
    function drawPlayerEntity() {
        const weapon = player.getCurrentWeapon();
        const armorInfo = player.getArmorInfo();
        const weaponColor = weapon.rarity ? weapon.rarity.color : NEUTRAL_COLOR;
        const armorColor = armorInfo.rarity ? armorInfo.rarity.color : NEUTRAL_COLOR;
        const weaponEmoji = player.getActiveProfessionDef().emoji;

        ctx.beginPath();
        ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2);
        ctx.fillStyle = armorColor;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.stroke();

        // Montura equipada (ver mounts.js): anillo alrededor del círculo
        // grande, del color del Tier de la montura.
        const mount = player.getEquippedMount();
        if (mount) {
            const mountTier = TIERS.find(t => t.id === mount.tierId);
            drawRarityRing(player.x, player.y, player.radius, mountTier.color);
        }

        const innerRadius = player.radius * 0.6;
        ctx.beginPath();
        ctx.arc(player.x, player.y, innerRadius, 0, Math.PI * 2);
        ctx.fillStyle = weaponColor;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.stroke();

        ctx.font = `${Math.round(innerRadius * 1.3)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(weaponEmoji, player.x, player.y + 1);
    }

    function drawRarityRing(x, y, radius, color) {
        ctx.beginPath();
        ctx.arc(x, y, radius + 4, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.stroke();
    }

    function drawEngageRing(x, y, radius) {
        ctx.beginPath();
        ctx.setLineDash([4, 3]);
        ctx.arc(x, y, radius + 6, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,107,107,0.65)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);
    }

    function drawHealthBar(x, y, radius, pct, color) {
        const w = radius * 2.2, h = 5;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(x - w / 2, y - radius - 14, w, h);
        ctx.fillStyle = color;
        ctx.fillRect(x - w / 2, y - radius - 14, w * Math.max(0, pct), h);
    }

    function drawChest(chest) {
        if (chest.opened) return;
        drawEntity(chest.x, chest.y, chest.radius, chest.unlocked ? '🎁' : '🔒', '#5a4a2a');
        drawRarityRing(chest.x, chest.y, chest.radius, chest.rarity.color);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (!chest.unlocked) {
            ctx.font = 'bold 13px sans-serif';
            ctx.fillStyle = '#fff';
            ctx.fillText(`${chest.kills}/${chest.requiredKills}`, chest.x, chest.y + chest.radius + 16);
        } else if (opening && opening.chest === chest) {
            drawHealthBar(chest.x, chest.y, chest.radius, opening.elapsed / CHEST_OPEN_TIME, '#ffd27a');
            ctx.font = 'bold 12px sans-serif';
            ctx.fillStyle = '#ffd27a';
            ctx.fillText('Abriendo...', chest.x, chest.y - chest.radius - 20);
        }
    }

    // Emoji/etiqueta según a dónde lleva cada portal de esquina (ver
    // generarPortales en grid-dungeon.js).
    const PORTAL_ICONS = { 'arriba-izquierda': '⬅️', 'arriba-derecha': '➡️', 'abajo-izquierda': '🔄', 'abajo-derecha': '🎲' };

    function drawPortals() {
        portals.forEach(p => {
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(130,90,255,0.7)';
            ctx.fill();
            ctx.lineWidth = 3;
            ctx.strokeStyle = '#c9a6ff';
            ctx.stroke();
            ctx.font = '26px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(PORTAL_ICONS[p.esquina] || '🌀', p.x, p.y + 1);
            ctx.font = 'bold 12px sans-serif';
            ctx.fillStyle = '#e4d9ff';
            const label = p.destino === 'aleatorio' ? 'Piso al azar' : `Piso ${p.destino}`;
            ctx.fillText(label, p.x, p.y + p.radius + 16);
        });
    }

    function render() {
        ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        ctx.save();
        ctx.translate(-camera.x, -camera.y);

        dungeon.renderWalls(ctx, camera, CANVAS_WIDTH, CANVAS_HEIGHT);
        drawPortals();
        chests.forEach(drawChest);

        nodes.forEach(n => {
            if (n.depleted) return;
            drawEntity(n.x, n.y, n.radius, n.def.emoji, n.def.color);
            if (n.special) drawRarityRing(n.x, n.y, n.radius, '#ffd27a');
            if (gathering && gathering.node === n) {
                drawHealthBar(n.x, n.y, n.radius, gathering.elapsed / getGatherDuration(n), '#ffd27a');
            }
        });

        enemies.forEach(en => {
            if (!en.alive) return;
            const engageable = Math.hypot(en.x - player.x, en.y - player.y) <= ENGAGE_RANGE;
            if (engageable) drawEngageRing(en.x, en.y, en.radius);
            drawEntity(en.x, en.y, en.radius, en.type.emoji, en.type.color);
            if (en.type.rarity) drawRarityRing(en.x, en.y, en.radius, en.type.rarity.color);
            drawHealthBar(en.x, en.y, en.radius, en.hp / en.maxHp, en.type.isBoss ? '#ffd27a' : '#ff5c5c');
        });

        drawPlayerEntity();

        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        floatingTexts.forEach(f => {
            ctx.globalAlpha = Math.max(0, f.life / f.maxLife);
            ctx.fillStyle = f.color;
            ctx.fillText(f.text, f.x, f.y);
        });
        ctx.globalAlpha = 1;

        ctx.restore();

        drawMinimap();
        if (!mapPanelEl.classList.contains('hidden')) drawBigMap();
    }

    function loop(time) {
        const dt = Math.min(50, time - lastTime);
        lastTime = time;
        update(dt);
        render();
        requestAnimationFrame(loop);
    }

    window.addEventListener('beforeunload', () => { if (player) player.save(); });

    init();
})();
