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
    let currentBiome = null; // tema visual del piso actual (ver BIOME_THEMES en constants.js)
    let spawnZones = []; // zonas de spawn incrementado activas en el piso actual (ver SISTEMA DE ZONAS DE SPAWN)
    // Taberna (ver SISTEMA DE TABERNA): piso especial sin enemigos/peligros,
    // accesible desde la ventana de Pisos (tecla P). floorBeforeTaberna vive
    // solo en memoria — igual que player.floor, nunca se persiste entre
    // sesiones (cada sesión arranca siempre en el Piso 1, fuera de Taberna).
    let inTaberna = false;
    let floorBeforeTaberna = null;
    let portals = []; // [{ x, y, radius, esquina, destino, tipo }] 4 esquinas ('siguiente') + 1 central ('anterior', piso>1)
    let portalsCercaHint = new Set(); // índices de portales cuyo mensaje "Portal al Piso N" ya se mostró (evita spam mientras el jugador se queda cerca)
    let portalCooldownUntil = 0; // gate breve tras cada loadFloor: el spawn del jugador puede caer justo sobre el portal central del piso nuevo
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
        UI.onUseAlteracionScroll = useAlteracionScroll;
        UI.onTeleportToFloor = teleportToFloor;
        UI.onEnterTaberna = enterTaberna;
        UI.onExitTaberna = exitTaberna;
        UI.onConfirmBossTeleport = teleportToFinalBoss;
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
        enemies.forEach(en => {
            if (!en.alive || !en.type.isBoss) return;
            if (en.type.isFinalBoss) {
                minimapCtx.font = 'bold 15px sans-serif';
                minimapCtx.fillStyle = '#ffd700';
                minimapCtx.fillText('👑', en.x * scaleX, en.y * scaleY);
            } else {
                // Minijefe más chico que Jefe (de piso o dinámico) en el mapa.
                minimapCtx.font = en.type.bossKind === 'minijefe' ? '8px sans-serif' : '11px sans-serif';
                minimapCtx.fillText(en.type.emoji, en.x * scaleX, en.y * scaleY);
            }
        });
        minimapCtx.font = '11px sans-serif';
        minimapCtx.fillStyle = '#000';
        chests.forEach(c => {
            if (!c.opened) minimapCtx.fillText(c.unlocked ? '🎁' : '🔒', c.x * scaleX, c.y * scaleY);
        });

        portals.forEach(p => {
            minimapCtx.beginPath();
            minimapCtx.arc(p.x * scaleX, p.y * scaleY, 3.5, 0, Math.PI * 2);
            minimapCtx.fillStyle = p.tipo === 'anterior' ? '#ffd27a' : '#c9a6ff';
            minimapCtx.fill();
        });

        // Zonas de Spawn: contorno de círculo sin rellenar + indicador de
        // tiempo restante (ver SPAWN_ZONE_* en constants.js).
        drawSpawnZonesOnMap(minimapCtx, scaleX, scaleY, 1);

        minimapCtx.beginPath();
        minimapCtx.arc(player.x * scaleX, player.y * scaleY, 3, 0, Math.PI * 2);
        minimapCtx.fillStyle = '#8a5cff';
        minimapCtx.fill();
        minimapCtx.lineWidth = 1;
        minimapCtx.strokeStyle = '#fff';
        minimapCtx.stroke();
    }

    // Dibuja las Zonas de Spawn activas como un círculo de color sin
    // rellenar (contorno) + el tiempo restante en minutos, reutilizado
    // tanto por el minimapa como por el mapa ampliado (ver drawMinimap /
    // drawBigMap). `scale` ajusta grosor de línea y tamaño de texto según
    // la superficie (el mapa ampliado es mucho más grande que el minimapa).
    function drawSpawnZonesOnMap(mapCtx, scaleX, scaleY, scale) {
        const now = Date.now();
        spawnZones.forEach(zone => {
            const cx = zone.x * scaleX, cy = zone.y * scaleY;
            mapCtx.beginPath();
            mapCtx.arc(cx, cy, zone.radius * scaleX, 0, Math.PI * 2);
            mapCtx.lineWidth = 1.5 * scale;
            mapCtx.strokeStyle = zone.color;
            mapCtx.stroke();

            const minutesLeft = Math.max(0, Math.ceil((zone.expiresAt - now) / 60000));
            mapCtx.font = `bold ${Math.round(9 * scale)}px sans-serif`;
            mapCtx.fillStyle = zone.color;
            mapCtx.textAlign = 'center';
            mapCtx.textBaseline = 'middle';
            mapCtx.fillText(`${minutesLeft}m`, cx, cy);
        });
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
        enemies.forEach(en => {
            if (!en.alive || !en.type.isBoss) return;
            if (en.type.isFinalBoss) {
                mapLargeCtx.font = 'bold 26px sans-serif';
                mapLargeCtx.fillStyle = '#ffd700';
                mapLargeCtx.fillText('👑', en.x * scaleX, en.y * scaleY);
            } else {
                // Minijefe más chico que Jefe (de piso o dinámico) en el mapa.
                mapLargeCtx.font = en.type.bossKind === 'minijefe' ? '14px sans-serif' : '20px sans-serif';
                mapLargeCtx.fillText(en.type.emoji, en.x * scaleX, en.y * scaleY);
            }
        });
        mapLargeCtx.font = '20px sans-serif';
        mapLargeCtx.fillStyle = '#000';
        chests.forEach(c => {
            if (!c.opened) mapLargeCtx.fillText(c.unlocked ? '🎁' : '🔒', c.x * scaleX, c.y * scaleY);
        });

        portals.forEach(p => {
            mapLargeCtx.beginPath();
            mapLargeCtx.arc(p.x * scaleX, p.y * scaleY, 7, 0, Math.PI * 2);
            mapLargeCtx.fillStyle = p.tipo === 'anterior' ? '#ffd27a' : '#c9a6ff';
            mapLargeCtx.fill();
        });

        drawSpawnZonesOnMap(mapLargeCtx, scaleX, scaleY, 2.4);

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

        // Temática de bioma por Tier (ver BIOME_THEMES en constants.js):
        // el "terreno" (piso) se pinta como fondo de la página, que es lo
        // que se ve a través de los tiles de piso (transparentes en el
        // canvas — ver renderWallsGrid en grid-dungeon.js); la
        // "iluminación" se aplica como un tinte ambiental en render().
        currentBiome = dungeon.biome;
        document.body.style.background = currentBiome.floorColor;

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

        // Zonas de spawn incrementado (ver SPAWN_ZONE_* en constants.js):
        // ninguna al arrancar el piso, se van creando con el tiempo (chance
        // chica por cada enemigo derrotado, ver handleEnemyKilled).
        spawnZones = [];

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

        // Portales (ver generarPortales en grid-dungeon.js): 4 fijos en las
        // esquinas del mapa (piso siguiente) + 1 central en el spawn del
        // jugador (piso anterior, ausente en el Piso 1).
        portals = dungeon.portales.map(p => ({ x: p.posicion.x, y: p.posicion.y, radius: 28, esquina: p.esquina, destino: p.destino, tipo: p.tipo }));
        portalsCercaHint = new Set();
        // El portal central cae exactamente sobre el spawn del jugador: sin
        // este respiro, el auto-teleport lo dispararía apenas carga el piso.
        portalCooldownUntil = Date.now() + 800;

        UI.updateFloorHUD(floorNum, enemies.filter(e => e.alive).length, finalBossAlive);
    }

    // ----- TABERNA (piso especial, ver generarTaberna en grid-dungeon.js) -----
    // Sin enemigos/cofres/nodos/zonas/portales: todos esos arrays quedan
    // vacíos, así que el resto del loop (combate, recolección, spawn
    // dinámico) queda inerte sin necesitar guardas especiales.
    function loadTaberna() {
        dungeon = generarTaberna();
        buildMinimapStatic();

        currentBiome = dungeon.biome;
        document.body.style.background = currentBiome.floorColor;

        player.x = dungeon.posicionJugadorInicio.x;
        player.y = dungeon.posicionJugadorInicio.y;
        updateCamera();

        nodes = [];
        resourceZones = [];
        spawnZones = [];
        enemies = [];
        finalBossAlive = false;
        chests = [];
        opening = null;
        gathering = null;
        portals = [];
        portalsCercaHint = new Set();

        UI.updateFloorHUD(null, 0, false);
    }

    // Entra a la Taberna desde cualquier piso (ver ventana de Pisos, tecla
    // P): no consume Pergaminos, no cuenta como "visitar" un piso nuevo
    // (maxFloorReached no cambia) y es inmediato.
    function enterTaberna() {
        if (inTaberna || dead || Combat.active) return;
        floorBeforeTaberna = player.floor;
        UI.hidePanel('floors-panel');
        UI.playTeleportFade(() => {
            inTaberna = true;
            loadTaberna();
            UI.showLevelToastText('🍺 Bienvenido a la Taberna');
        });
    }

    // Vuelve exactamente al piso donde estaba antes de entrar (se
    // regenera desde cero, como cualquier otro cambio de piso).
    function exitTaberna() {
        if (!inTaberna || dead || Combat.active) return;
        const returnFloor = floorBeforeTaberna || 1;
        UI.hidePanel('floors-panel');
        UI.playTeleportFade(() => {
            inTaberna = false;
            player.floor = returnFloor;
            loadFloor(player.floor);
            player.save();
            UI.showLevelToastText(`🌀 Regresando al Piso ${returnFloor}`);
        });
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
    // Solo crea el enemigo (sin tocar finalBossAlive/player.finalBossFloor
    // ni avisar nada) — reusado tanto por la aparición real (spawnFinalBossAt)
    // como por la re-materialización al teletransportarse a un jefe que ya
    // estaba activo en otro piso (ver teleportToFinalBoss).
    function spawnFinalBossEntity(floor) {
        const { pisoEnRango } = calcularProbabilidadNucleoAdicional(floor);
        const tierDef = BOSS_TIERS.jefe_final;
        const pool = getEnemyPoolForFloor(floor);
        const base = pool[Math.floor(Math.random() * pool.length)];
        const scaled = buildScaledEnemyType(base, floor);
        const mult = tierDef.mult * (0.5 + 0.5 * (pisoEnRango - 1) / 9);
        // Vida x10 y daño x5 respecto al balance anterior (mismo `mult` base,
        // solo se le suma un multiplicador extra a cada stat por separado).
        scaled.hp = Math.max(1, Math.round(scaled.hp * mult * 10));
        scaled.dmg = Math.max(1, Math.round(scaled.dmg * mult * 5));
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
        const enemy = new Enemy(scaled, pos.x, pos.y);
        enemies.push(enemy);
        return enemy;
    }

    function spawnFinalBossAt(floor) {
        spawnFinalBossEntity(floor);
        finalBossAlive = true;
        player.finalBossFloor = floor;
        player.save();
        UI.showLevelToastText('👑 ¡El Jefe Final apareció!');
        UI.updateFloorHUD(player.floor, enemies.filter(e => e.alive).length, finalBossAlive);
    }

    // Se llama por CADA enemigo eliminado (incluye multi-kills por AoE).
    // Tira minijefe/jefe de forma independiente. Todo enemigo suma puntos al
    // contador del Jefe Final (normal +1, minijefe +10, jefe de piso o
    // dinámico +20 — ver FINAL_BOSS_* en constants.js). Al llegar a
    // FINAL_BOSS_POINTS_TARGET queda "desbloqueado": cada kill DESPUÉS de
    // cruzar el umbral (bossHuntKills, no cuenta el que cruzó) suma
    // FINAL_BOSS_PERCENT_PER_KILL% de probabilidad de que aparezca.
    function handleEnemyKilled(target) {
        registerChestKill(target);

        if (target.type.isFinalBoss) {
            finalBossAlive = false;
            player.finalBossPoints = 0;
            player.bossHuntKills = 0;
            player.finalBossFloor = null;
            player.save();
            return;
        }

        if (Math.random() < BOSS_TIERS.minijefe.chance) spawnDynamicBoss('minijefe');
        if (Math.random() < BOSS_TIERS.jefe.chance) spawnDynamicBoss('jefe');

        if (Math.random() < SPAWN_ZONE_CREATE_CHANCE) createSpawnZone();

        const bossKind = target.type.bossKind;
        const alreadyPrimed = player.finalBossPoints >= FINAL_BOSS_POINTS_TARGET;
        if (bossKind === 'minijefe') player.finalBossPoints += FINAL_BOSS_MINIJEFE_POINTS;
        else if (bossKind === 'jefe' || bossKind === 'jefe_especial' || bossKind === 'jefe_aleatorio') player.finalBossPoints += FINAL_BOSS_JEFE_ESPECIAL_POINTS;
        else player.finalBossPoints += FINAL_BOSS_NORMAL_POINTS;

        if (!finalBossAlive && alreadyPrimed) {
            player.bossHuntKills++;
            const chancePercent = getFinalBossSpawnChancePercent(player.bossHuntKills);
            if (Math.random() * 100 < chancePercent) {
                spawnFinalBossAt(player.floor);
                player.finalBossPoints = 0;
                player.bossHuntKills = 0;
            }
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

    // ----- ZONAS DE SPAWN INCREMENTADO -----
    // Hotspot temporal en una sala aleatoria del piso: mantiene entre
    // SPAWN_ZONE_MIN_ENEMIES y SPAWN_ZONE_MAX_ENEMIES enemigos propios vivos
    // (rellenados en lotes por tickSpawnZones, ver update()) durante una
    // duración aleatoria (10/20/30 min), hasta un máximo de
    // SPAWN_ZONE_MAX_PER_FLOOR simultáneas por piso.
    function createSpawnZone() {
        const naturalCount = spawnZones.filter(z => !z.isPlayerZone).length;
        if (naturalCount >= SPAWN_ZONE_MAX_PER_FLOOR) return;
        if (!dungeon.rooms.length) return;
        const room = dungeon.rooms[Math.floor(Math.random() * dungeon.rooms.length)];
        const center = dungeon.randomPointInRoom(room, TILE_SIZE * 2);
        const durationMin = SPAWN_ZONE_DURATIONS_MIN[Math.floor(Math.random() * SPAWN_ZONE_DURATIONS_MIN.length)];
        const zone = {
            id: `zone_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
            x: center.x, y: center.y,
            radius: SPAWN_ZONE_RADIUS,
            room,
            durationMin,
            expiresAt: Date.now() + durationMin * 60000,
            nextRefillAt: 0, // 0 fuerza un lote inicial en el próximo tick
            color: SPAWN_ZONE_COLORS[naturalCount % SPAWN_ZONE_COLORS.length],
            isPlayerZone: false,
        };
        spawnZones.push(zone);
    }

    // Pergamino de Alteración (ver ☢️ en constants.js/ui.js): misma mecánica
    // que una zona natural, pero centrada en el jugador, con cupo propio
    // (SPAWN_ZONE_MAX_PLAYER_PER_FLOOR, no cuenta para el de arriba) y color
    // distintivo. `room` se sintetiza como un cuadrado alrededor del centro
    // para poder reusar dungeon.randomPointInRoom sin cambios.
    function createPlayerAlteracionZone(tierId) {
        const playerCount = spawnZones.filter(z => z.isPlayerZone).length;
        if (playerCount >= SPAWN_ZONE_MAX_PLAYER_PER_FLOOR) return null;
        const durationMin = ALTERACION_TIER_DURATIONS_MIN[tierId] || 10;
        const cx = player.x, cy = player.y;
        const zone = {
            id: `pzone_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
            x: cx, y: cy,
            radius: SPAWN_ZONE_RADIUS,
            room: { x: cx - SPAWN_ZONE_RADIUS, y: cy - SPAWN_ZONE_RADIUS, w: SPAWN_ZONE_RADIUS * 2, h: SPAWN_ZONE_RADIUS * 2 },
            durationMin,
            expiresAt: Date.now() + durationMin * 60000,
            nextRefillAt: 0,
            color: SPAWN_ZONE_PLAYER_COLOR,
            isPlayerZone: true,
        };
        spawnZones.push(zone);
        return zone;
    }

    // Enemigos vivos que pertenecen a una zona (marcados con
    // en.spawnZoneId al spawnearlos, ver más abajo).
    function countZoneEnemies(zone) {
        return enemies.filter(e => e.alive && e.spawnZoneId === zone.id).length;
    }

    const SPAWN_ZONE_REFILL_COOLDOWN = 4000; // pausa entre lotes de una misma zona

    function tickSpawnZones() {
        const now = Date.now();
        spawnZones = spawnZones.filter(z => {
            if (now < z.expiresAt) return true;
            if (z.isPlayerZone) {
                // Al expirar, se eliminan los enemigos restantes de la zona
                // (sin loot/XP — desaparecen, no se derrotan).
                enemies.forEach(e => { if (e.spawnZoneId === z.id) e.alive = false; });
                UI.showLevelToastText('☢️ Zona de Alteración expirada');
            }
            return false;
        });

        spawnZones.forEach(zone => {
            const aliveInZone = countZoneEnemies(zone);
            if (aliveInZone >= SPAWN_ZONE_REFILL_THRESHOLD) return;
            if (now < zone.nextRefillAt) return;

            // Las zonas de Alteración (pergamino, ver createPlayerAlteracionZone)
            // tienen prioridad garantizada: mantienen 20-30 SIN importar el cap
            // global del piso (ENEMIES_PER_FLOOR) — si no, con varias zonas
            // naturales + de jugador activas a la vez el piso se satura antes
            // de que le toque el turno a una zona de jugador, y se queda
            // atascada en 0 para siempre. Las naturales sí respetan el cap.
            const aliveTotal = enemies.filter(e => e.alive).length;
            const globalRoom = zone.isPlayerZone ? Infinity : Math.max(0, ENEMIES_PER_FLOOR - aliveTotal);
            const batchSize = Math.min(
                SPAWN_ZONE_BATCH_MIN + Math.floor(Math.random() * (SPAWN_ZONE_BATCH_MAX - SPAWN_ZONE_BATCH_MIN + 1)),
                SPAWN_ZONE_MAX_ENEMIES - aliveInZone,
                globalRoom,
            );
            zone.nextRefillAt = now + SPAWN_ZONE_REFILL_COOLDOWN;
            if (batchSize <= 0) return;

            const pool = getEnemyPoolForFloor(player.floor);
            for (let i = 0; i < batchSize; i++) {
                const base = pool[Math.floor(Math.random() * pool.length)];
                const type = buildScaledEnemyType(base, player.floor);
                applyMonsterRarity(type);
                let pos = dungeon.randomPointInRoom(zone.room, TILE_SIZE * 1.5);
                if (!dungeon.isWalkable(pos.x, pos.y, type.radius)) pos = { x: zone.x, y: zone.y };
                const en = new Enemy(type, pos.x, pos.y);
                en.spawnZoneId = zone.id;
                enemies.push(en);
            }
        });
    }

    // Zona en la que está parado el jugador ahora mismo (si hay alguna),
    // para el texto de HUD "Zona de Spawn: XX enemigos restantes".
    function findPlayerSpawnZone() {
        return spawnZones.find(z => Math.hypot(player.x - z.x, player.y - z.y) <= z.radius) || null;
    }

    // Viaja al piso `targetFloor` (usado por los portales, ver
    // generarPortales en grid-dungeon.js): valida el rango [1, MAX_FLOOR] y
    // hace un fundido de pantalla (ver UI.playTeleportFade) antes de cargar
    // el piso nuevo, igual que la Ventana de Pisos (tecla P).
    function travelToFloor(targetFloor) {
        targetFloor = Math.max(1, Math.min(MAX_FLOOR, targetFloor));
        if (targetFloor === player.floor) {
            addFloatingText(player.x, player.y - 40, 'Ya estás en este piso', '#ffd27a');
            return;
        }
        UI.playTeleportFade(() => {
            player.floor = targetFloor;
            loadFloor(player.floor);
            player.save();
            UI.showLevelToastText(`🌀 Piso ${player.floor}`);
        });
    }

    // Portales: NO se activan por colisión — hay que estar cerca y hacer
    // click sobre el portal (ver handleWorldClick) o presionar Espacio (ver
    // bindInput) estando en rango. Al pasar cerca se muestra "Portal al
    // Piso N" una sola vez (hasta alejarse) como aviso de que se puede
    // interactuar. portalCooldownUntil evita que el spawn del jugador (que
    // cae justo sobre el portal central del piso nuevo) dispare un
    // teleport si quedara alguna pulsación de Espacio en curso.
    const PORTAL_HINT_RADIUS = 90;
    function checkPortalCollisions() {
        if (dead || Combat.active || isAnyPanelOpen()) return;
        for (let i = 0; i < portals.length; i++) {
            const p = portals[i];
            const dist = Math.hypot(p.x - player.x, p.y - player.y);
            if (dist <= PORTAL_HINT_RADIUS) {
                if (!portalsCercaHint.has(i)) {
                    portalsCercaHint.add(i);
                    addFloatingText(p.x, p.y - p.radius - 14, `Portal al Piso ${p.destino}`, '#c9a6ff');
                }
            } else {
                portalsCercaHint.delete(i);
            }
        }
    }

    // Nearest portal to the player within interact range (click/Espacio).
    function findNearestPortalInRange() {
        let best = null, bestDist = Infinity;
        portals.forEach(p => {
            const d = Math.hypot(p.x - player.x, p.y - player.y);
            if (d <= PORTAL_HINT_RADIUS && d < bestDist) { bestDist = d; best = p; }
        });
        return best;
    }

    // Acción compartida por click y Espacio: activa el portal si el cooldown
    // post-loadFloor ya pasó (ver comentario de portalCooldownUntil arriba).
    function activatePortal(p) {
        if (Date.now() < portalCooldownUntil) return;
        travelToFloor(p.destino);
    }

    // Teletransportación vía Ventana de Pisos (tecla P): a diferencia de
    // travelToFloor (portales, sin costo, solo piso ±1), esto salta a
    // CUALQUIER piso ya alcanzado (player.maxFloorReached) a cambio de 1
    // Pergamino de Teletransportación.
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

    // Ventana de Teletransporte al Jefe Final (ver notificación ⚔️👑 en el
    // HUD): consume 1 Pergamino de Teletransportación para saltar directo
    // al piso donde hay un Jefe Final activo (aunque el jugador ya se haya
    // ido de ahí), re-materializándolo si el piso se regeneró en el camino
    // (spawnFinalBossEntity, sin re-anunciar "apareció" ni re-marcar
    // player.finalBossFloor, que ya apunta ahí).
    function teleportToFinalBoss() {
        if (dead || Combat.active || inTaberna) return;
        const targetFloor = player.finalBossFloor;
        if (targetFloor === null) {
            UI.showLevelToastText('❌ El Jefe Final ha sido derrotado.');
            UI.hideBossTeleportPanel();
            return;
        }
        if (targetFloor > player.maxFloorReached) return; // botón ya deshabilitado, defensivo
        if ((player.materials.pergamino_teletransporte || 0) < 1) return; // ídem

        if (targetFloor === player.floor) {
            UI.showLevelToastText('Ya estás en el piso del Jefe Final');
            UI.hideBossTeleportPanel();
            return;
        }

        player.materials.pergamino_teletransporte--;
        UI.hidePanel('floors-panel');
        UI.hideBossTeleportPanel();
        UI.playTeleportFade(() => {
            player.floor = targetFloor;
            loadFloor(player.floor);
            const boss = spawnFinalBossEntity(targetFloor);
            finalBossAlive = true;

            // Cerca del jefe, pero no encima.
            const angle = Math.random() * Math.PI * 2;
            const offset = boss.radius + player.radius + 60;
            let px = boss.x + Math.cos(angle) * offset;
            let py = boss.y + Math.sin(angle) * offset;
            if (!dungeon.isWalkable(px, py, player.radius)) { px = boss.x; py = boss.y; }
            player.x = px;
            player.y = py;
            updateCamera();

            player.save();
            UI.showLevelToastText(`Teletransportado al Piso ${targetFloor}`);
            UI.updateFloorHUD(player.floor, enemies.filter(e => e.alive).length, finalBossAlive);
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
        return ['inventory-panel', 'enchant-panel', 'map-panel', 'craft-panel', 'stats-panel', 'guide-panel', 'floors-panel', 'combat-panel', 'victory-panel', 'gold-panel', 'shop-panel', 'menu-panel', 'boss-teleport-panel']
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

    // Pergamino de Alteración (ver ☢️ arriba): crea una zona de spawn
    // centrada en el jugador, del mismo tier de enemigo/rareza que el piso
    // actual (reusa tickSpawnZones tal cual). No disponible en la Taberna
    // (sin enemigos que spawnear) ni durante combate.
    function useAlteracionScroll(tierId) {
        if (dead || Combat.active || inTaberna) return;
        const materialId = `pergamino_alteracion_tier${tierId}`;
        if ((player.materials[materialId] || 0) <= 0) return;

        const playerCount = spawnZones.filter(z => z.isPlayerZone).length;
        if (playerCount >= SPAWN_ZONE_MAX_PLAYER_PER_FLOOR) {
            UI.showLevelToastText('❌ Máximo de zonas de alteración alcanzado en este piso');
            return;
        }

        player.materials[materialId]--;
        const zone = createPlayerAlteracionZone(tierId);
        if (!zone) return;
        UI.showLevelToastText(`☢️ Zona de Alteración creada. Duración: ${zone.durationMin} minutos`);
        UI.renderInventory(player);
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

        // Notificación del Jefe Final (ver #final-boss-notification en
        // index.html): visible mientras haya un Jefe Final activo en
        // cualquier piso, pero no clickeable en la Taberna (sigue visible
        // igual, ver UI.updateFinalBossNotification).
        document.getElementById('final-boss-notification').addEventListener('click', () => {
            if (inTaberna || dead || Combat.active) return;
            if (player.finalBossFloor === null) return;
            UI.showBossTeleportPanel(player);
        });

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
                const portal = findNearestPortalInRange();
                if (portal) { activatePortal(portal); return; }
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
                const closablePanels = ['inventory-panel', 'enchant-panel', 'map-panel', 'craft-panel', 'stats-panel', 'guide-panel', 'floors-panel', 'gold-panel', 'shop-panel', 'menu-panel', 'boss-teleport-panel'];
                const anyOpen = closablePanels.some(id => !document.getElementById(id).classList.contains('hidden'));
                if (anyOpen) {
                    closablePanels.forEach(id => UI.hidePanel(id));
                } else if (!dead && !UI.isVictoryPanelVisible()) {
                    // Nada abierto: ESC abre el Menú (ver menu-panel en index.html).
                    UI.showMenuPanel();
                }
                return;
            }

            if (key === 'i') { UI.renderInventory(player); UI.togglePanel('inventory-panel'); }
            else if (key === 'e') { UI.renderEnchantments(player); UI.togglePanel('enchant-panel'); }
            else if (key === 'm') { teleportPending = false; UI.togglePanel('map-panel'); }
            else if (key === 'c') { UI.renderCraft(player); UI.togglePanel('craft-panel'); }
            else if (key === 'v') { UI.renderStats(player); UI.togglePanel('stats-panel'); }
            else if (key === 'p') { UI.renderFloors(player, inTaberna, floorBeforeTaberna); UI.togglePanel('floors-panel'); }
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

    const MERCHANT_INTERACT_RANGE = 140;
    const MERCHANT_CLICK_RADIUS = 44;

    function handleWorldClick(x, y) {
        if (dead || Combat.active || isAnyPanelOpen()) return;

        // -1) Taberna: ¿se hizo click sobre el Mercader? -> abre la ventana
        // de comercio si está cerca.
        if (inTaberna && dungeon.mercaderPos) {
            const mp = dungeon.mercaderPos;
            if (Math.hypot(mp.x - x, mp.y - y) <= MERCHANT_CLICK_RADIUS) {
                if (Math.hypot(mp.x - player.x, mp.y - player.y) > MERCHANT_INTERACT_RANGE) {
                    addFloatingText(mp.x, mp.y - 50, 'Muy lejos', '#ffd27a');
                    return;
                }
                UI.showShopPanel(player);
                return;
            }
        }

        // 0) ¿Se hizo click sobre un portal? -> teletransporta solo si está
        // cerca (ver PORTAL_HINT_RADIUS); si no, activatePortal no hace nada.
        const clickedPortal = portals.find(p => Math.hypot(p.x - x, p.y - y) <= p.radius + 8);
        if (clickedPortal) {
            const distToPlayer = Math.hypot(clickedPortal.x - player.x, clickedPortal.y - player.y);
            if (distToPlayer > PORTAL_HINT_RADIUS) {
                addFloatingText(clickedPortal.x, clickedPortal.y - clickedPortal.radius - 10, 'Muy lejos', '#ffd27a');
                return;
            }
            activatePortal(clickedPortal);
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
        checkPortalCollisions();
        player.tick(dt);
        updateCamera();

        nodes.forEach(n => n.update(dt));
        tickSpawnZones();
        const zoneHere = findPlayerSpawnZone();
        UI.updateSpawnZoneHUD(zoneHere ? {
            enemiesLeft: countZoneEnemies(zoneHere),
            minutesLeft: Math.max(0, Math.ceil((zoneHere.expiresAt - Date.now()) / 60000)),
            isPlayerZone: !!zoneHere.isPlayerZone,
        } : null);
        UI.updateAlteracionCounter(spawnZones.filter(z => z.isPlayerZone).length, SPAWN_ZONE_MAX_PLAYER_PER_FLOOR, inTaberna);

        floatingTexts.forEach(f => { f.y += f.vy; f.life -= dt; });
        floatingTexts = floatingTexts.filter(f => f.life > 0);

        saveTimer += dt;
        if (saveTimer > 5000) {
            saveTimer = 0;
            player.save();
        }

        UI.updateHUD(player);
        UI.updateBossCounter(player, inTaberna, finalBossAlive);
        UI.updateFinalBossNotification(player, inTaberna);
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

    // Estilo por tipo de portal (ver generarPortales en grid-dungeon.js):
    // 'siguiente' (las 4 esquinas, ascenso) vs 'anterior' (el central,
    // descenso) tienen emoji y color distintos para distinguirse de un
    // vistazo (ver INDICADORES VISUALES del diseño).
    const PORTAL_STYLE = {
        siguiente: { icon: '⬆️', fill: 'rgba(130,90,255,0.7)', stroke: '#c9a6ff' },
        anterior: { icon: '⬇️', fill: 'rgba(255,178,71,0.7)', stroke: '#ffd27a' },
    };

    // Decoración de la Taberna (ver generarTaberna en grid-dungeon.js): sin
    // sprites/imágenes (este juego entero se dibuja con canvas 2D + emoji,
    // ver drawEntity), así que mesas/mostrador/chimenea/antorchas son formas
    // simples + emoji, con una animación liviana de parpadeo en el fuego.
    const TABERNA_TABLE_COLOR = '#5a3a1e';
    const TABERNA_TABLE_POSITIONS = [
        { dx: 0.28, dy: 0.55 }, { dx: 0.5, dy: 0.55 }, { dx: 0.72, dy: 0.55 },
        { dx: 0.28, dy: 0.78 }, { dx: 0.5, dy: 0.78 }, { dx: 0.72, dy: 0.78 },
    ];

    function drawTabernaTable(cx, cy) {
        ctx.fillStyle = TABERNA_TABLE_COLOR;
        ctx.fillRect(cx - 46, cy - 30, 92, 60);
        ctx.strokeStyle = '#2e1c0d';
        ctx.lineWidth = 3;
        ctx.strokeRect(cx - 46, cy - 30, 92, 60);
        // 4 sillas (puntos alrededor de la mesa).
        ctx.fillStyle = '#3d2814';
        [[-70, 0], [70, 0], [0, -48], [0, 48]].forEach(([ox, oy]) => {
            ctx.beginPath();
            ctx.arc(cx + ox, cy + oy, 14, 0, Math.PI * 2);
            ctx.fill();
        });
    }

    function drawTabernaDecor() {
        const room = dungeon.rooms[0];
        if (!room) return;
        const cx = room.x + room.w / 2;

        // Mostrador: banda horizontal pegada a la pared superior.
        ctx.fillStyle = '#6b4423';
        ctx.fillRect(room.x + room.w * 0.25, room.y + 70, room.w * 0.5, 60);
        ctx.strokeStyle = '#2e1c0d';
        ctx.lineWidth = 3;
        ctx.strokeRect(room.x + room.w * 0.25, room.y + 70, room.w * 0.5, 60);

        // Chimenea: pegada a la pared izquierda, con un parpadeo suave.
        const fireX = room.x + 150, fireY = room.y + room.h / 2;
        const flicker = 0.85 + Math.sin(Date.now() / 180) * 0.15;
        ctx.beginPath();
        ctx.arc(fireX, fireY, 44, 0, Math.PI * 2);
        ctx.fillStyle = '#2e1c0d';
        ctx.fill();
        ctx.font = `${Math.round(40 * flicker)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🔥', fireX, fireY + 2);

        // Antorchas en las 4 esquinas del área.
        const torchFlicker = 0.8 + Math.sin(Date.now() / 220 + 1) * 0.2;
        ctx.font = `${Math.round(24 * torchFlicker)}px sans-serif`;
        [[70, 70], [room.w - 70, 70], [70, room.h - 70], [room.w - 70, room.h - 70]].forEach(([ox, oy]) => {
            ctx.fillText('🕯️', room.x + ox, room.y + oy);
        });

        // Mesas con sillas, repartidas por el piso principal.
        TABERNA_TABLE_POSITIONS.forEach(t => {
            drawTabernaTable(room.x + room.w * t.dx, room.y + room.h * t.dy);
        });

        // Mercader: detrás del mostrador.
        if (dungeon.mercaderPos) {
            drawEntity(dungeon.mercaderPos.x, dungeon.mercaderPos.y, 32, '💰', '#ffd27a');
            ctx.font = 'bold 13px sans-serif';
            ctx.fillStyle = '#ffe9b8';
            ctx.textAlign = 'center';
            ctx.fillText('Mercader', dungeon.mercaderPos.x, dungeon.mercaderPos.y + 46);
        }
    }

    function drawPortals() {
        portals.forEach(p => {
            const style = PORTAL_STYLE[p.tipo] || PORTAL_STYLE.siguiente;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            ctx.fillStyle = style.fill;
            ctx.fill();
            ctx.lineWidth = 3;
            ctx.strokeStyle = style.stroke;
            ctx.stroke();
            ctx.font = '26px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(style.icon, p.x, p.y + 1);
            ctx.font = 'bold 12px sans-serif';
            ctx.fillStyle = '#e4d9ff';
            ctx.fillText(`Piso ${p.destino}`, p.x, p.y + p.radius + 16);
        });
    }

    function render() {
        ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        ctx.save();
        ctx.translate(-camera.x, -camera.y);

        dungeon.renderWalls(ctx, camera, CANVAS_WIDTH, CANVAS_HEIGHT);
        if (inTaberna) drawTabernaDecor();
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

        // Iluminación ambiental del bioma (ver BIOME_THEMES en
        // constants.js): tinte translúcido sobre toda la vista, en espacio
        // de pantalla (fuera del translate de cámara) para cubrir el
        // viewport completo de una sola pasada.
        if (currentBiome) {
            ctx.fillStyle = currentBiome.ambientTint;
            ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        }

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
