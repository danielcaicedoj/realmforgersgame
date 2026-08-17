// ===== GENERACIÓN DE PISOS: GRID-BASED DUNGEON =====
// Reemplaza el viejo sistema BSP (bsp.js/dungeon.js). Cada piso es un grid
// de hasta 12x10 celdas; cada celda activa recibe una sala de tamaño
// variable, las salas vecinas pueden fusionarse (sin corredor entre ellas)
// o conectarse con un corredor proporcional a su tamaño. El jugador
// siempre aparece en el centro exacto del mapa y hay 4 portales fijos en
// las esquinas.
//
// NOTA sobre el tilemap: la especificación describe un array por pixel
// (19200x12000 = 230 millones de celdas), inviable en un navegador. Igual
// que el sistema anterior, se usa una grilla de TILE_SIZE px (40px, ya
// definida en constants.js) para las colisiones: 480x300 = 144.000 celdas.
//
// NOTA sobre robustez: dado que cada sala se posiciona con un offset
// aleatorio dentro de su celda, dos salas vecinas no siempre quedan
// perfectamente alineadas para un corredor recto de un solo tramo. Además
// de pintar el corredor "bonito" (tamaño proporcional, ver
// generarTamañoCorredor/generarPosicionCorredor), SIEMPRE se talla también
// un conector en L de grosor mínimo entre los centros de ambas salas, y lo
// mismo para el punto de aparición del jugador y los 4 portales. Así el
// piso queda garantizado 100% transitable sin importar el azar, algo no
// negociable para que el juego sea jugable.

const MAX_GRID_ANCHO = 12;
const MAX_GRID_ALTO = 10;
const MAX_SALAS_TOTALES = MAX_GRID_ANCHO * MAX_GRID_ALTO; // 120
const TAMAÑO_CELDA_ANCHO = 1600;
const TAMAÑO_CELDA_ALTO = 1200;
const TAMAÑO_SALA_MIN = 300;
const TAMAÑO_SALA_MAX_ANCHO = 1600;
const TAMAÑO_SALA_MAX_ALTO = 1200;
const TAMAÑO_CORREDOR_MIN = 80;
const TAMAÑO_JUGADOR = 100; // referencia de diseño; la colisión real usa player.radius
const POSICION_JUGADOR_INICIO = { x: 9600, y: 6000 };

// ----- DENSIDAD DE SALAS POR PISO -----
// Misma densidad máxima en todos los pisos (piso 1 igual que piso 1000):
// siempre se generan las 120 salas del grid completo.
function calcularDensidad(piso) {
    return { porcentaje: 1.0, cantidadSalas: MAX_SALAS_TOTALES };
}

// ----- TAMAÑO Y POSICIÓN DE SALA -----
// Factor de escalabilidad: en pisos altos el mínimo posible sube (25%..75%
// del máximo), sesgando las salas a ser más grandes en promedio.
function generarTamañoSala(pisoActual) {
    const minPct = 0.25 + Math.min(0.5, ((pisoActual - 1) / (MAX_FLOOR - 1)) * 0.5);
    const anchoPct = minPct + Math.random() * (1 - minPct);
    const altoPct = minPct + Math.random() * (1 - minPct);
    const ancho = Math.min(TAMAÑO_SALA_MAX_ANCHO, Math.max(TAMAÑO_SALA_MIN, Math.round(TAMAÑO_SALA_MAX_ANCHO * anchoPct)));
    const alto = Math.min(TAMAÑO_SALA_MAX_ALTO, Math.max(TAMAÑO_SALA_MIN, Math.round(TAMAÑO_SALA_MAX_ALTO * altoPct)));
    return { ancho, alto };
}

function generarPosicionSala(gridX, gridY, tamaño) {
    const baseX = gridX * TAMAÑO_CELDA_ANCHO;
    const baseY = gridY * TAMAÑO_CELDA_ALTO;
    const margen = 20;
    const espacioX = Math.max(0, TAMAÑO_CELDA_ANCHO - tamaño.ancho - margen * 2);
    const espacioY = Math.max(0, TAMAÑO_CELDA_ALTO - tamaño.alto - margen * 2);
    const x = baseX + margen + Math.random() * espacioX;
    const y = baseY + margen + Math.random() * espacioY;
    return { x, y };
}

// Pequeña (<600x600, ~25%) / Mediana (600-1000, ~50%) / Grande (1000-1600x1200, ~25%).
function clasificarSala(tamaño) {
    if (tamaño.ancho < 600 && tamaño.alto < 600) return 'pequeña';
    if (tamaño.ancho >= 1000 && tamaño.alto >= 1000) return 'grande';
    return 'mediana';
}

function esSalaMaxima(sala) {
    return sala.tamaño.ancho >= TAMAÑO_SALA_MAX_ANCHO * 0.9 && sala.tamaño.alto >= TAMAÑO_SALA_MAX_ALTO * 0.9;
}

// ----- SELECCIÓN DE CELDAS ACTIVAS -----
// Crece desde el centro del grid hacia afuera (BFS aleatorio) para
// garantizar que las celdas elegidas formen un bloque contiguo por
// adyacencia, evitando salas completamente aisladas del resto.
function seleccionarCeldasActivas(cantidadSalas) {
    const total = MAX_GRID_ANCHO * MAX_GRID_ALTO;
    if (cantidadSalas >= total) {
        const todas = [];
        for (let gy = 0; gy < MAX_GRID_ALTO; gy++) {
            for (let gx = 0; gx < MAX_GRID_ANCHO; gx++) todas.push({ gx, gy });
        }
        return todas;
    }

    const centro = { gx: Math.floor(MAX_GRID_ANCHO / 2), gy: Math.floor(MAX_GRID_ALTO / 2) };
    const key = c => `${c.gx},${c.gy}`;
    const visitado = new Set([key(centro)]);
    const activas = [centro];
    const frontera = [centro];

    while (activas.length < cantidadSalas && frontera.length) {
        const idx = Math.floor(Math.random() * frontera.length);
        const actual = frontera[idx];
        const vecinos = [
            { gx: actual.gx - 1, gy: actual.gy }, { gx: actual.gx + 1, gy: actual.gy },
            { gx: actual.gx, gy: actual.gy - 1 }, { gx: actual.gx, gy: actual.gy + 1 },
        ].filter(v => v.gx >= 0 && v.gx < MAX_GRID_ANCHO && v.gy >= 0 && v.gy < MAX_GRID_ALTO && !visitado.has(key(v)));

        if (!vecinos.length) { frontera.splice(idx, 1); continue; }
        const next = vecinos[Math.floor(Math.random() * vecinos.length)];
        visitado.add(key(next));
        activas.push(next);
        frontera.push(next);
    }
    return activas;
}

function generarSalas(pisoActual, celdasActivas) {
    const salas = [];
    const porCelda = {};
    celdasActivas.forEach(({ gx, gy }) => {
        const tamaño = generarTamañoSala(pisoActual);
        const posicion = generarPosicionSala(gx, gy, tamaño);
        const sala = {
            gridX: gx, gridY: gy, tamaño, posicion,
            vecinos: { arriba: null, abajo: null, izquierda: null, derecha: null },
            fusionado: { arriba: false, abajo: false, izquierda: false, derecha: false },
            enemigos: [], jefe: null, portal: null,
        };
        salas.push(sala);
        porCelda[`${gx},${gy}`] = sala;
    });
    salas.forEach(s => {
        s.vecinos.arriba = porCelda[`${s.gridX},${s.gridY - 1}`] || null;
        s.vecinos.abajo = porCelda[`${s.gridX},${s.gridY + 1}`] || null;
        s.vecinos.izquierda = porCelda[`${s.gridX - 1},${s.gridY}`] || null;
        s.vecinos.derecha = porCelda[`${s.gridX + 1},${s.gridY}`] || null;
    });
    return salas;
}

// ----- FUSIONES -----
function deben_fusionarse(sala1, sala2) {
    const max1 = esSalaMaxima(sala1), max2 = esSalaMaxima(sala2);
    if (max1 && max2) return true;
    if (max1 || max2) return Math.random() < 0.45;
    return false;
}

// Evalúa cada par de vecinos una sola vez (derecha/abajo) para no decidir
// la fusión dos veces sobre el mismo par.
function determinarFusiones(salas) {
    salas.forEach(sala => {
        ['derecha', 'abajo'].forEach(dir => {
            const vecino = sala.vecinos[dir];
            if (!vecino) return;
            const fusiona = deben_fusionarse(sala, vecino);
            sala.fusionado[dir] = fusiona;
            vecino.fusionado[dir === 'derecha' ? 'izquierda' : 'arriba'] = fusiona;
        });
    });
}

// ----- CORREDORES -----
// direccion: hacia dónde está sala2 respecto de sala1 ('derecha' o 'abajo';
// generarCorredores solo evalúa esos dos sentidos por par para no duplicar).
function generarTamañoCorredor(sala1, sala2, direccion) {
    if (direccion === 'izquierda' || direccion === 'derecha') {
        const maxAncho = Math.max(TAMAÑO_CORREDOR_MIN, Math.min(sala1.tamaño.ancho, sala2.tamaño.ancho));
        const ancho = Math.round(TAMAÑO_CORREDOR_MIN + Math.random() * (maxAncho - TAMAÑO_CORREDOR_MIN));
        return { ancho, alto: TAMAÑO_CORREDOR_MIN };
    }
    const maxAlto = Math.max(TAMAÑO_CORREDOR_MIN, Math.min(sala1.tamaño.alto, sala2.tamaño.alto));
    const alto = Math.round(TAMAÑO_CORREDOR_MIN + Math.random() * (maxAlto - TAMAÑO_CORREDOR_MIN));
    return { ancho: TAMAÑO_CORREDOR_MIN, alto };
}

function conexionesRequeridas(sala) {
    return Object.keys(sala.vecinos).filter(dir => sala.vecinos[dir] && !sala.fusionado[dir]);
}

function generarPosicionCorredor(sala1, sala2, direccion, tamañoCorredor) {
    if (direccion === 'derecha' || direccion === 'izquierda') {
        const izq = direccion === 'derecha' ? sala1 : sala2;
        const der = direccion === 'derecha' ? sala2 : sala1;
        const x = izq.posicion.x + izq.tamaño.ancho;
        const overlapTop = Math.max(izq.posicion.y, der.posicion.y);
        const overlapBottom = Math.min(izq.posicion.y + izq.tamaño.alto, der.posicion.y + der.tamaño.alto);
        const centroY = overlapBottom > overlapTop
            ? (overlapTop + overlapBottom) / 2
            : (izq.posicion.y + izq.tamaño.alto / 2 + der.posicion.y + der.tamaño.alto / 2) / 2;
        return { x, y: centroY - tamañoCorredor.alto / 2 };
    }
    const arriba = direccion === 'abajo' ? sala1 : sala2;
    const abajo = direccion === 'abajo' ? sala2 : sala1;
    const y = arriba.posicion.y + arriba.tamaño.alto;
    const overlapLeft = Math.max(arriba.posicion.x, abajo.posicion.x);
    const overlapRight = Math.min(arriba.posicion.x + arriba.tamaño.ancho, abajo.posicion.x + abajo.tamaño.ancho);
    const centroX = overlapRight > overlapLeft
        ? (overlapLeft + overlapRight) / 2
        : (arriba.posicion.x + arriba.tamaño.ancho / 2 + abajo.posicion.x + abajo.tamaño.ancho / 2) / 2;
    return { x: centroX - tamañoCorredor.ancho / 2, y };
}

function generarCorredores(salas) {
    const corredores = [];
    salas.forEach(sala => {
        ['derecha', 'abajo'].forEach(dir => {
            const vecino = sala.vecinos[dir];
            if (!vecino || sala.fusionado[dir]) return;
            const tamaño = generarTamañoCorredor(sala, vecino, dir);
            const posicion = generarPosicionCorredor(sala, vecino, dir, tamaño);
            corredores.push({ sala1: sala, sala2: vecino, direccion: dir, tamaño, posicion });
        });
    });
    return corredores;
}

// ----- TILEMAP -----
function crearTilemap() {
    const cols = Math.ceil(WORLD_WIDTH / TILE_SIZE);
    const rows = Math.ceil(WORLD_HEIGHT / TILE_SIZE);
    return { cols, rows, tiles: new Uint8Array(cols * rows) };
}

function tileIndexTM(tm, cx, cy) { return cy * tm.cols + cx; }

// Pinta (marca walkable) un rectángulo en coordenadas de MUNDO.
function pintarRectEnTilemap(tm, x, y, w, h) {
    const c1 = Math.max(0, Math.floor(x / TILE_SIZE));
    const c2 = Math.min(tm.cols - 1, Math.floor((x + w) / TILE_SIZE));
    const r1 = Math.max(0, Math.floor(y / TILE_SIZE));
    const r2 = Math.min(tm.rows - 1, Math.floor((y + h) / TILE_SIZE));
    for (let cy = r1; cy <= r2; cy++) {
        for (let cx = c1; cx <= c2; cx++) tm.tiles[tileIndexTM(tm, cx, cy)] = 1;
    }
}

function pintarSalaEnTilemap(tm, sala) {
    pintarRectEnTilemap(tm, sala.posicion.x, sala.posicion.y, sala.tamaño.ancho, sala.tamaño.alto);
}

function pintarCorredorEnTilemap(tm, corredor) {
    pintarRectEnTilemap(tm, corredor.posicion.x, corredor.posicion.y, corredor.tamaño.ancho, corredor.tamaño.alto);
}

// Conector de seguridad entre CADA par de salas vecinas del grid, sin
// importar si están fusionadas o unidas por corredor. Las salas fusionadas
// asumen que se tocan por ser máximas (o casi), pero como cada sala se
// posiciona con jitter independiente dentro de su celda eso no está 100%
// garantizado; este conector barato asegura que ningún par de vecinas
// quede nunca aislado (ver nota de robustez al inicio del archivo).
function conectarVecinosDelGrid(tm, salas) {
    salas.forEach(sala => {
        ['derecha', 'abajo'].forEach(dir => {
            const vecino = sala.vecinos[dir];
            if (!vecino) return;
            conectarPuntos(tm, sala1CentroX(sala), sala1CentroY(sala), sala1CentroX(vecino), sala1CentroY(vecino));
        });
    });
}

function sala1CentroX(sala) { return sala.posicion.x + sala.tamaño.ancho / 2; }
function sala1CentroY(sala) { return sala.posicion.y + sala.tamaño.alto / 2; }

// Talla un conector en L (2 tramos rectos, grosor TAMAÑO_CORREDOR_MIN) entre
// dos puntos cualesquiera del mundo. Usado como red de seguridad para
// garantizar conectividad (salas, spawn del jugador, portales).
function conectarPuntos(tm, x1, y1, x2, y2) {
    const half = TAMAÑO_CORREDOR_MIN / 2;
    pintarRectEnTilemap(tm, Math.min(x1, x2) - half, y1 - half, Math.abs(x2 - x1) + TAMAÑO_CORREDOR_MIN, TAMAÑO_CORREDOR_MIN);
    pintarRectEnTilemap(tm, x2 - half, Math.min(y1, y2) - half, TAMAÑO_CORREDOR_MIN, Math.abs(y2 - y1) + TAMAÑO_CORREDOR_MIN);
}

// Conecta un punto (spawn del jugador, un portal) con la sala más cercana,
// para que nunca quede aislado.
function garantizarConexion(tm, salas, punto) {
    if (!salas.length) { pintarRectEnTilemap(tm, punto.x - 100, punto.y - 100, 200, 200); return; }
    let mejor = null, mejorDist = Infinity;
    salas.forEach(s => {
        const cx = sala1CentroX(s), cy = sala1CentroY(s);
        const d = Math.hypot(cx - punto.x, cy - punto.y);
        if (d < mejorDist) { mejorDist = d; mejor = { x: cx, y: cy }; }
    });
    pintarRectEnTilemap(tm, punto.x - 100, punto.y - 100, 200, 200);
    conectarPuntos(tm, punto.x, punto.y, mejor.x, mejor.y);
}

// ----- PORTALES (4 esquinas fijas) -----
function generarPortales(pisoActual) {
    return [
        { posicion: { x: 100, y: 100 }, esquina: 'arriba-izquierda', destino: Math.max(1, pisoActual - 1) },
        { posicion: { x: 19100, y: 100 }, esquina: 'arriba-derecha', destino: Math.min(MAX_FLOOR, pisoActual + 1) },
        { posicion: { x: 100, y: 11900 }, esquina: 'abajo-izquierda', destino: 1 },
        { posicion: { x: 19100, y: 11900 }, esquina: 'abajo-derecha', destino: 'aleatorio' },
    ];
}

// ----- JEFES -----
// Jefe especial: 100 nombres únicos (10 títulos x 10 epítetos), uno cada 10
// pisos (numeroJefe = piso/10, 1..100).
const JEFE_TITULOS = ['Señor', 'Guardián', 'Verdugo', 'Heraldo', 'Devorador', 'Tirano', 'Centinela', 'Azote', 'Emperador', 'Espectro'];
const JEFE_EPITETOS = ['de las Sombras', 'del Abismo', 'Eterno', 'del Caos', 'de Sangre', 'Cósmico', 'del Vacío', 'Primordial', 'de Cristal', 'del Olvido'];
const JEFE_EMOJIS = ['👑', '💀', '🐉', '👹', '😈', '🔥', '⚡', '🌑', '🌟', '💎'];

function obtenerNombreJefe(numeroJefe) {
    const idx = ((numeroJefe - 1) % 100 + 100) % 100;
    return `${JEFE_TITULOS[Math.floor(idx / 10)]} ${JEFE_EPITETOS[idx % 10]}`;
}

function obtenerEmojiJefeEspecial(numeroJefe) {
    return JEFE_EMOJIS[(numeroJefe - 1) % JEFE_EMOJIS.length];
}

function calcularHPJefe(numeroJefe) { return Math.round(500 * numeroJefe * (1 + (numeroJefe - 1) * 0.08)); }
function calcularDamageJefe(numeroJefe) { return Math.round(40 * numeroJefe * (1 + (numeroJefe - 1) * 0.05)); }
function calcularDefensaJefe(numeroJefe) { return Math.round(numeroJefe * 4); }
function calcularXPJefe(numeroJefe) { return Math.round(300 * numeroJefe * (1 + (numeroJefe - 1) * 0.1)); }

// Probabilidad de jefe aleatorio (enemigo normal x3) por bracket de piso.
const JEFE_ALEATORIO_BRACKETS = [
    { min: 1,   max: 10,   chance: 0.02 },
    { min: 11,  max: 20,   chance: 0.05 },
    { min: 21,  max: 50,   chance: 0.10 },
    { min: 51,  max: 100,  chance: 0.15 },
    { min: 101, max: 200,  chance: 0.20 },
    { min: 201, max: 1000, chance: 0.25 },
];
function calcularProbabilidadJefeAleatorio(piso) {
    const b = JEFE_ALEATORIO_BRACKETS.find(x => piso >= x.min && piso <= x.max) || JEFE_ALEATORIO_BRACKETS[0];
    return b.chance;
}

// Decide y arma el jefe de este piso (especial cada 10 pisos, garantizado;
// si no, tirada de jefe aleatorio según la probabilidad del bracket).
// Reutiliza los pools/escalado de enemigos normales ya existentes
// (getEnemyPoolForFloor/getScaledEnemyStats, ver constants.js/floors.js)
// para el jefe aleatorio, en vez de duplicar esa lógica.
function generarJefePiso(piso, salas) {
    const salaGrande = salas.reduce((best, s) => {
        const area = s.tamaño.ancho * s.tamaño.alto;
        const bestArea = best ? best.tamaño.ancho * best.tamaño.alto : -1;
        return area > bestArea ? s : best;
    }, null);
    const posicionFallback = salaGrande ? { x: sala1CentroX(salaGrande), y: sala1CentroY(salaGrande) } : { ...POSICION_JUGADOR_INICIO };

    if (piso % 10 === 0) {
        const numero = piso / 10;
        const hp = calcularHPJefe(numero);
        const xpFlat = calcularXPJefe(numero);
        return {
            tipo: 'jefe_especial',
            nombre: obtenerNombreJefe(numero),
            numero,
            emoji: obtenerEmojiJefeEspecial(numero),
            hp, hpMax: hp,
            damage: calcularDamageJefe(numero),
            defensa: calcularDefensaJefe(numero),
            xp: { min: Math.round(xpFlat * 0.9), max: Math.round(xpFlat * 1.1) },
            xpFlat,
            loot: [],
            habilidad_especial: {},
            posicion: posicionFallback,
        };
    }

    if (Math.random() < calcularProbabilidadJefeAleatorio(piso)) {
        const pool = getEnemyPoolForFloor(piso);
        const base = pool[Math.floor(Math.random() * pool.length)];
        const escalado = getScaledEnemyStats(base, piso);
        const hp = Math.round(escalado.hp * 3);
        const dmg = Math.round(escalado.dmg * 3);
        const xpFlat = Math.round(escalado.xp * 3);
        const salaAleatoria = salas[Math.floor(Math.random() * salas.length)] || salaGrande;
        return {
            tipo: 'jefe_aleatorio',
            nombre: `${base.name} Ancestral`,
            emoji: base.emoji,
            hp, hpMax: hp,
            damage: dmg,
            defensa: Math.round(escalado.defense),
            xp: { min: Math.round(xpFlat * 0.9), max: Math.round(xpFlat * 1.1) },
            xpFlat,
            loot: [],
            habilidad_especial: {},
            posicion: salaAleatoria ? { x: sala1CentroX(salaAleatoria), y: sala1CentroY(salaAleatoria) } : posicionFallback,
        };
    }

    return null;
}

// ----- INTERFAZ COMPATIBLE CON EL VIEJO Dungeon (isWalkable/renderWalls/...) -----
function isWalkableGrid(tm, x, y, radius) {
    const points = [[x, y], [x - radius, y], [x + radius, y], [x, y - radius], [x, y + radius]];
    for (const [px, py] of points) {
        const cx = Math.floor(px / TILE_SIZE), cy = Math.floor(py / TILE_SIZE);
        if (cx < 0 || cy < 0 || cx >= tm.cols || cy >= tm.rows) return false;
        if (tm.tiles[tileIndexTM(tm, cx, cy)] === 0) return false;
    }
    return true;
}

function randomPointInRoomGrid(room, margin) {
    margin = margin || TILE_SIZE;
    const x = room.x + margin + Math.random() * Math.max(1, room.w - margin * 2);
    const y = room.y + margin + Math.random() * Math.max(1, room.h - margin * 2);
    return { x, y };
}

function renderWallsGrid(tm, ctx, camera, canvasWidth, canvasHeight) {
    const c1 = Math.max(0, Math.floor(camera.x / TILE_SIZE));
    const r1 = Math.max(0, Math.floor(camera.y / TILE_SIZE));
    const c2 = Math.min(tm.cols - 1, Math.floor((camera.x + canvasWidth) / TILE_SIZE));
    const r2 = Math.min(tm.rows - 1, Math.floor((camera.y + canvasHeight) / TILE_SIZE));
    ctx.fillStyle = '#0d0b14';
    for (let cy = r1; cy <= r2; cy++) {
        for (let cx = c1; cx <= c2; cx++) {
            if (tm.tiles[tileIndexTM(tm, cx, cy)] === 0) {
                ctx.fillRect(cx * TILE_SIZE, cy * TILE_SIZE, TILE_SIZE, TILE_SIZE);
            }
        }
    }
}

// ----- ORQUESTADOR PRINCIPAL -----
function generarPiso(pisoActual) {
    const { porcentaje, cantidadSalas } = calcularDensidad(pisoActual);
    const celdas = seleccionarCeldasActivas(cantidadSalas);
    const salas = generarSalas(pisoActual, celdas);
    determinarFusiones(salas);
    const corredores = generarCorredores(salas);

    const tm = crearTilemap();
    salas.forEach(s => pintarSalaEnTilemap(tm, s));
    corredores.forEach(c => pintarCorredorEnTilemap(tm, c));
    conectarVecinosDelGrid(tm, salas);

    // Garantías de conectividad (ver nota de robustez al inicio del archivo).
    garantizarConexion(tm, salas, POSICION_JUGADOR_INICIO);
    const portales = generarPortales(pisoActual);
    portales.forEach(p => garantizarConexion(tm, salas, p.posicion));

    const jefe = generarJefePiso(pisoActual, salas);

    return {
        numeroDelPiso: pisoActual,
        tilemap: tm,
        grid: { anchoceldas: MAX_GRID_ANCHO, altoceldas: MAX_GRID_ALTO, celdaAncho: TAMAÑO_CELDA_ANCHO, celdaAlto: TAMAÑO_CELDA_ALTO },
        salas,
        corredores,
        enemigos: [], // el spawn real de enemigos normales lo hace game.js (sistema de rareza existente) usando `rooms`
        jefe,
        portales,
        posicionJugadorInicio: { ...POSICION_JUGADOR_INICIO },
        estadisticas: {
            totalSalas: salas.length,
            totalCorredores: corredores.length,
            totalEnemigos: ENEMIES_PER_FLOOR,
            densidad: porcentaje,
        },
    };
}

// Punto de entrada usado por game.js (mismo nombre que el viejo sistema, así
// el resto del juego cambia lo mínimo posible). Devuelve el resultado de
// generarPiso() enriquecido con la interfaz compatible del viejo Dungeon
// (rooms/cols/rows/tiles/tileIndex/isWalkable/randomPointInRoom/
// getLargestRoom/renderWalls) para que el resto de game.js siga
// funcionando sin reescribirse por completo.
function generateDungeon(pisoActual) {
    const piso = generarPiso(pisoActual);
    const tm = piso.tilemap;

    piso.cols = tm.cols;
    piso.rows = tm.rows;
    piso.tiles = tm.tiles;
    piso.tileIndex = (cx, cy) => tileIndexTM(tm, cx, cy);
    piso.rooms = piso.salas.map(s => ({ x: s.posicion.x, y: s.posicion.y, w: s.tamaño.ancho, h: s.tamaño.alto }));
    piso.isWalkable = (x, y, radius) => isWalkableGrid(tm, x, y, radius);
    piso.randomPointInRoom = (room, margin) => randomPointInRoomGrid(room, margin);
    piso.getLargestRoom = () => piso.rooms.reduce((best, r) => (r.w * r.h > best.w * best.h ? r : best), piso.rooms[0]);
    piso.renderWalls = (ctx, camera, w, h) => renderWallsGrid(tm, ctx, camera, w, h);

    return piso;
}
