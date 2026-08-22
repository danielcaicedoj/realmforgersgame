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

// ----- TIPO ESTRUCTURAL DE SALA (paredes internas / obstáculos, ver
// ROOM_STRUCTURE_TYPES en constants.js y decorarSala más abajo) -----
// Roll ponderado filtrado por tamaño real de la sala (mismo patrón que
// rollMonsterRarity en constants.js), renormalizado solo entre los tipos
// que caben en esta sala.
function elegirTipoEstructural(tamaño) {
    const elegibles = ROOM_STRUCTURE_TYPES.filter(t => tamaño.ancho >= t.minAncho && tamaño.alto >= t.minAlto);
    if (!elegibles.length) return 'vacia_simple';
    const pesoTotal = elegibles.reduce((sum, t) => sum + t.peso, 0);
    let roll = Math.random() * pesoTotal;
    for (const t of elegibles) {
        roll -= t.peso;
        if (roll <= 0) return t.id;
    }
    return elegibles[elegibles.length - 1].id;
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
            tipoEstructural: elegirTipoEstructural(tamaño),
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
// `esObstaculo`: marca (aparte de `tiles`, que sigue siendo el binario
// walkable/pared de siempre — no se toca para no arriesgar el pathfinding/
// colisión existente) qué tiles de pared son un obstáculo disperso (roca/
// columna/árbol, ver dispersarObstaculosCirculares) en vez de una pared
// estructural — usado solo por renderWallsGrid para pintarlos de otro color.
// `wallNoise`/`floorNoise`: textura precalculada UNA vez por piso (ver
// generarRuidoTexturaTilemap) para variar el tono de paredes/piso sin
// recalcular ruido en cada frame de render.
// `ocultoId`/`ocultoDescubierto`: salas escondidas camufladas de pared (ver
// generarSalasOcultas) — 0 = tile normal, N = pertenece a la sala oculta N.
// Esos tiles YA son walkable en `tiles` desde el principio (si no, nunca
// serían alcanzables), pero se RENDERIZAN como pared hasta que el jugador
// los pisa (ver update() en game.js/renderWallsGrid) — y nunca aparecen en
// el minimapa/mapa grande sin importar si están descubiertos o no (ver
// buildMinimapStatic en game.js).
function crearTilemap() {
    const cols = Math.ceil(WORLD_WIDTH / TILE_SIZE);
    const rows = Math.ceil(WORLD_HEIGHT / TILE_SIZE);
    return {
        cols, rows,
        tiles: new Uint8Array(cols * rows),
        esObstaculo: new Uint8Array(cols * rows),
        ocultoId: new Uint8Array(cols * rows),
        ocultoDescubierto: new Uint8Array(cols * rows),
        wallNoise: generarRuidoTexturaTilemap(cols, rows, Math.random() * 1000),
        floorNoise: generarRuidoTexturaTilemap(cols, rows, Math.random() * 1000),
    };
}

// Ruido suave (value noise bilinear, celdas de ~3 tiles => manchas de
// textura de ~120px, no "cuadritos sueltos" de un tile aislado) para dar
// variación de color natural a paredes/piso. Devuelve un byte 0-255 por
// tile; ver variarColorHex para convertirlo en una variación de color.
function generarRuidoTexturaTilemap(cols, rows, seed) {
    const cellSize = 3;
    const hash = (hx, hy) => {
        const s = Math.sin(hx * 127.1 + hy * 311.7 + seed) * 43758.5453;
        return s - Math.floor(s);
    };
    const out = new Uint8Array(cols * rows);
    for (let ty = 0; ty < rows; ty++) {
        const gy = ty / cellSize, y0 = Math.floor(gy), fy = gy - y0;
        const sy = fy * fy * (3 - 2 * fy);
        for (let tx = 0; tx < cols; tx++) {
            const gx = tx / cellSize, x0 = Math.floor(gx), fx = gx - x0;
            const sx = fx * fx * (3 - 2 * fx);
            const h00 = hash(x0, y0), h10 = hash(x0 + 1, y0), h01 = hash(x0, y0 + 1), h11 = hash(x0 + 1, y0 + 1);
            const top = h00 + (h10 - h00) * sx, bot = h01 + (h11 - h01) * sx;
            out[ty * cols + tx] = Math.round((top + (bot - top) * sy) * 255);
        }
    }
    return out;
}

// Variación de color: mezcla el hex base hacia más claro/oscuro según un
// byte de ruido 0-255 precalculado (ver generarRuidoTexturaTilemap) — así
// paredes/piso muestran varios tonos del mismo color base en vez de un
// color plano uniforme, adaptado al color REAL de cada bioma (no un color
// fijo), sin recalcular ruido en cada frame.
function variarColorHex(hex, ruido255, rango) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const delta = Math.round((ruido255 / 255 - 0.5) * 2 * rango);
    r = Math.min(255, Math.max(0, r + delta));
    g = Math.min(255, Math.max(0, g + delta));
    b = Math.min(255, Math.max(0, b + delta));
    return `rgb(${r},${g},${b})`;
}

// Deriva un tono "roca" grisáceo a partir del color de pared del bioma
// actual (mezcla hacia un gris neutro más claro), para que los obstáculos
// dispersos (rocas/columnas/árboles) se distingan de las paredes
// estructurales sin importar el bioma — ver dispersarObstaculosCirculares.
function colorRocaDesdeBiome(wallColorHex) {
    const n = parseInt(wallColorHex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const luminancia = 0.299 * r + 0.587 * g + 0.114 * b;
    const gris = Math.min(150, luminancia + 45); // gris neutro, oscuro (antes 200/+90 quedaba muy claro)
    const mezcla = 0.6; // 60% hacia gris neutro
    const rr = Math.round(r * (1 - mezcla) + gris * mezcla);
    const gg = Math.round(g * (1 - mezcla) + gris * mezcla);
    const bb = Math.round(b * (1 - mezcla) + gris * mezcla);
    return `#${((1 << 24) + (rr << 16) + (gg << 8) + bb).toString(16).slice(1)}`;
}

// Aclara (delta positivo) u oscurece (delta negativo) un color hex en un
// monto fijo por canal RGB — usado para desplazar levemente el tono base
// del piso antes de aplicarle la variación de ruido (ver renderWallsGrid).
function ajustarBrilloHex(hex, delta) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    r = Math.min(255, Math.max(0, r + delta));
    g = Math.min(255, Math.max(0, g + delta));
    b = Math.min(255, Math.max(0, b + delta));
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function tileIndexTM(tm, cx, cy) { return cy * tm.cols + cx; }

// Pinta un rectángulo en coordenadas de MUNDO con el valor dado (1=walkable,
// 0=pared) — primitiva compartida por pintarRectEnTilemap (walkable) y
// pintarRectComoParedEnTilemap (pared), ver decoradores de sala más abajo.
function pintarRectValorEnTilemap(tm, x, y, w, h, valor) {
    const c1 = Math.max(0, Math.floor(x / TILE_SIZE));
    const c2 = Math.min(tm.cols - 1, Math.floor((x + w) / TILE_SIZE));
    const r1 = Math.max(0, Math.floor(y / TILE_SIZE));
    const r2 = Math.min(tm.rows - 1, Math.floor((y + h) / TILE_SIZE));
    for (let cy = r1; cy <= r2; cy++) {
        for (let cx = c1; cx <= c2; cx++) tm.tiles[tileIndexTM(tm, cx, cy)] = valor;
    }
}

// Pinta (marca walkable) un rectángulo en coordenadas de MUNDO.
function pintarRectEnTilemap(tm, x, y, w, h) {
    pintarRectValorEnTilemap(tm, x, y, w, h, 1);
}

// Pinta (marca como pared) un rectángulo en coordenadas de MUNDO — usado
// por los decoradores de sala para tallar paredes internas/obstáculos
// rectangulares dentro de una sala ya pintada walkable.
function pintarRectComoParedEnTilemap(tm, x, y, w, h) {
    pintarRectValorEnTilemap(tm, x, y, w, h, 0);
}

// Pinta un círculo (en coordenadas de MUNDO) con el valor dado dentro de
// cualquier array del tamaño de tm.tiles — primitiva compartida por
// pintarCirculoEnTilemap y el marcado de tm.esObstaculo.
function marcarCirculoEnArray(tm, arr, cx, cy, radio, valor) {
    const c1 = Math.max(0, Math.floor((cx - radio) / TILE_SIZE));
    const c2 = Math.min(tm.cols - 1, Math.floor((cx + radio) / TILE_SIZE));
    const r1 = Math.max(0, Math.floor((cy - radio) / TILE_SIZE));
    const r2 = Math.min(tm.rows - 1, Math.floor((cy + radio) / TILE_SIZE));
    const radio2 = radio * radio;
    for (let ty = r1; ty <= r2; ty++) {
        const centroY = ty * TILE_SIZE + TILE_SIZE / 2;
        for (let tx = c1; tx <= c2; tx++) {
            const centroX = tx * TILE_SIZE + TILE_SIZE / 2;
            const dx = centroX - cx, dy = centroY - cy;
            if (dx * dx + dy * dy <= radio2) arr[tileIndexTM(tm, tx, ty)] = valor;
        }
    }
}

// Pinta un círculo en coordenadas de MUNDO con el valor dado — usado tanto
// para obstáculos circulares (rocas/columnas/árboles, valor=0) como para
// tallar cuevas orgánicas walkable (catacumbas, valor=1).
function pintarCirculoEnTilemap(tm, cx, cy, radio, valor) {
    marcarCirculoEnArray(tm, tm.tiles, cx, cy, radio, valor);
}

// Pinta como pared cualquier tile del rect dado que caiga FUERA de la
// elipse inscrita (cx,cy,rx,ry) — usado por anillo_batalla para adaptar
// una "sala circular" al rect real de la sala (que no siempre es cuadrado).
function pintarFueraDeElipseComoPared(tm, x, y, w, h, cx, cy, rx, ry) {
    const c1 = Math.max(0, Math.floor(x / TILE_SIZE));
    const c2 = Math.min(tm.cols - 1, Math.floor((x + w) / TILE_SIZE));
    const r1 = Math.max(0, Math.floor(y / TILE_SIZE));
    const r2 = Math.min(tm.rows - 1, Math.floor((y + h) / TILE_SIZE));
    for (let ty = r1; ty <= r2; ty++) {
        const centroY = ty * TILE_SIZE + TILE_SIZE / 2;
        for (let tx = c1; tx <= c2; tx++) {
            const centroX = tx * TILE_SIZE + TILE_SIZE / 2;
            const dx = (centroX - cx) / rx, dy = (centroY - cy) / ry;
            if (dx * dx + dy * dy > 1) tm.tiles[tileIndexTM(tm, tx, ty)] = 0;
        }
    }
}

// Genera huecos (puertas/aberturas) no solapados dentro de [desde,hasta],
// cada uno de ancho aleatorio entre anchoMin/anchoMax, con un margen mínimo
// respecto a los extremos del span — usado por pintarParedConHuecos.
// Degrada con gracia: si un span es muy corto para caber `cantidad` huecos,
// simplemente coloca menos (nunca lanza ni se cuelga).
function generarHuecosAleatorios(desde, hasta, cantidad, anchoMin, anchoMax, margen) {
    const huecos = [];
    const span = hasta - desde;
    if (span <= margen * 2 + anchoMin) return huecos;
    for (let i = 0; i < cantidad; i++) {
        let colocado = false;
        for (let intento = 0; intento < 20 && !colocado; intento++) {
            const ancho = anchoMin + Math.random() * (anchoMax - anchoMin);
            const centro = desde + margen + Math.random() * Math.max(1, span - margen * 2);
            const a = centro - ancho / 2, b = centro + ancho / 2;
            if (a < desde + margen || b > hasta - margen) continue;
            if (huecos.some(h => a < h[1] + 40 && b > h[0] - 40)) continue; // evita huecos pegados/solapados
            huecos.push([a, b]);
            colocado = true;
        }
    }
    return huecos.sort((a, b) => a[0] - b[0]);
}

// Pinta una pared recta con huecos (puertas) en coordenadas de MUNDO.
// orientacion 'horizontal': pared corre a lo largo de X en y=coordFija,
// span=[desde,hasta] en X. 'vertical': corre a lo largo de Y en x=coordFija,
// span=[desde,hasta] en Y. Pinta como pared el complemento de `huecos`
// dentro del span (uno o más segmentos rectangulares).
function pintarParedConHuecos(tm, orientacion, coordFija, desde, hasta, grosor, huecos) {
    const segmentos = [];
    let cursor = desde;
    huecos.forEach(([a, b]) => {
        if (a > cursor) segmentos.push([cursor, a]);
        cursor = Math.max(cursor, b);
    });
    if (cursor < hasta) segmentos.push([cursor, hasta]);

    segmentos.forEach(([s1, s2]) => {
        if (s2 <= s1) return;
        if (orientacion === 'horizontal') {
            pintarRectComoParedEnTilemap(tm, s1, coordFija - grosor / 2, s2 - s1, grosor);
        } else {
            pintarRectComoParedEnTilemap(tm, coordFija - grosor / 2, s1, grosor, s2 - s1);
        }
    });
}

// Dispersa `count` obstáculos circulares dentro de rect={x,y,w,h} con
// rejection-sampling (respeta espacio mínimo entre ellos y con los bordes
// del rect vía `inset`). SIEMPRE verifica que el punto candidato esté
// actualmente walkable antes de aceptarlo — así los obstáculos nunca quedan
// apilados sobre paredes ya pintadas por el mismo decorador (ver
// laberinto_complejo/catacumbas, que pintan paredes/cuevas ANTES de
// dispersar obstáculos). Devuelve la lista de círculos colocados.
function dispersarObstaculosCirculares(tm, rect, opts) {
    const { count, radioMin, radioMax, espacioMinimo, inset, intentosMax } = opts;
    const colocados = [];
    let intentos = 0;
    const maxIntentos = intentosMax != null ? intentosMax : count * 30;
    while (colocados.length < count && intentos < maxIntentos) {
        intentos++;
        const radio = radioMin + Math.random() * (radioMax - radioMin);
        const minX = rect.x + inset + radio, maxX = rect.x + rect.w - inset - radio;
        const minY = rect.y + inset + radio, maxY = rect.y + rect.h - inset - radio;
        if (maxX <= minX || maxY <= minY) break; // sala demasiado chica para este inset/radio
        const x = minX + Math.random() * (maxX - minX);
        const y = minY + Math.random() * (maxY - minY);

        const tileX = Math.min(tm.cols - 1, Math.max(0, Math.floor(x / TILE_SIZE)));
        const tileY = Math.min(tm.rows - 1, Math.max(0, Math.floor(y / TILE_SIZE)));
        if (tm.tiles[tileIndexTM(tm, tileX, tileY)] !== 1) continue;

        const choca = colocados.some(o => {
            const dx = o.x - x, dy = o.y - y;
            return Math.hypot(dx, dy) < o.radio + radio + espacioMinimo;
        });
        if (choca) continue;

        pintarCirculoEnTilemap(tm, x, y, radio, 0);
        marcarCirculoEnArray(tm, tm.esObstaculo, x, y, radio, 1); // solo para render (ver renderWallsGrid), no afecta colisión
        colocados.push({ x, y, radio });
    }
    return colocados;
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

// ----- DECORACIÓN ESTRUCTURAL DE SALAS (paredes internas/obstáculos según
// sala.tipoEstructural, ver ROOM_STRUCTURE_TYPES en constants.js) -----
// Cada decorador trabaja en fracciones del tamaño REAL de la sala (nunca
// píxeles absolutos), porque las salas de este motor varían entre 300x300 y
// 1600x1200 — no todas miden 1600x1200 como en la especificación original.
// Se pintan DESPUÉS de que la sala ya está walkable (pintarSalaEnTilemap) y
// ANTES de la red de seguridad (conectarVecinosDelGrid/garantizarConexion,
// ver generarPiso), que talla a través de cualquier pared/obstáculo nuevo
// si hiciera falta para garantizar transitabilidad 100%.
const DECORACION_INSET = 60; // margen sin decorar cerca del borde de la sala

function decorarVaciaGigante(tm, sala) {
    const { x, y } = sala.posicion, { ancho: w, alto: h } = sala.tamaño;
    const count = 5 + Math.floor(Math.random() * 4); // 5-8
    sala.obstaculos = dispersarObstaculosCirculares(tm, { x, y, w, h }, {
        count, radioMin: 35, radioMax: 45, espacioMinimo: 250, inset: 120, intentosMax: count * 30,
    });
}

// Paredes paralelas perpendiculares al eje más largo de la sala, cada una
// con 2-3 huecos. Compartida (con distinta densidad) por laberinto_simple y
// laberinto_complejo.
function pintarParedesLaberinto(tm, sala, numMin, numMax, divisorEspaciado) {
    const { x, y } = sala.posicion, { ancho: w, alto: h } = sala.tamaño;
    const vertical = w >= h; // paredes verticales si la sala es más ancha que alta
    const dimMayor = Math.max(w, h);
    const numParedes = Math.min(numMax, Math.max(numMin, Math.round(dimMayor / divisorEspaciado)));
    const spacing = dimMayor / (numParedes + 1);

    for (let i = 1; i <= numParedes; i++) {
        const grosor = 60;
        if (vertical) {
            const coordX = x + spacing * i;
            const desde = y + DECORACION_INSET, hasta = y + h - DECORACION_INSET;
            const huecos = generarHuecosAleatorios(desde, hasta, 2 + Math.floor(Math.random() * 2), 100, 160, 60);
            pintarParedConHuecos(tm, 'vertical', coordX, desde, hasta, grosor, huecos);
        } else {
            const coordY = y + spacing * i;
            const desde = x + DECORACION_INSET, hasta = x + w - DECORACION_INSET;
            const huecos = generarHuecosAleatorios(desde, hasta, 2 + Math.floor(Math.random() * 2), 100, 160, 60);
            pintarParedConHuecos(tm, 'horizontal', coordY, desde, hasta, grosor, huecos);
        }
    }
}

function decorarLaberintoSimple(tm, sala) {
    pintarParedesLaberinto(tm, sala, 4, 6, 280);
}

function decorarCrucero(tm, sala) {
    const { x, y } = sala.posicion, { ancho: w, alto: h } = sala.tamaño;
    const cx = x + w / 2, cy = y + h / 2;
    const clearing = Math.min(200, w * 0.18, h * 0.18);
    const grosor = 60;

    // Pared vertical con claro central
    pintarParedConHuecos(tm, 'vertical', cx, y + DECORACION_INSET, y + h - DECORACION_INSET, grosor,
        [[cy - clearing / 2, cy + clearing / 2]]);
    // Pared horizontal con claro central
    pintarParedConHuecos(tm, 'horizontal', cy, x + DECORACION_INSET, x + w - DECORACION_INSET, grosor,
        [[cx - clearing / 2, cx + clearing / 2]]);
}

function decorarCompartimentada(tm, sala) {
    const { x, y } = sala.posicion, { ancho: w, alto: h } = sala.tamaño;
    const grosor = 60;
    const xDiv = [x + w / 3, x + 2 * w / 3];
    const yBandas = [y, y + h / 3, y + 2 * h / 3, y + h];

    // 2 divisores verticales, con una puerta por cada una de las 3 bandas horizontales
    xDiv.forEach(coordX => {
        const huecos = [];
        for (let i = 0; i < 3; i++) {
            const bandaDesde = yBandas[i], bandaHasta = yBandas[i + 1];
            const centro = (bandaDesde + bandaHasta) / 2 + (Math.random() - 0.5) * 40;
            const ancho = 100 + Math.random() * 40;
            huecos.push([centro - ancho / 2, centro + ancho / 2]);
        }
        pintarParedConHuecos(tm, 'vertical', coordX, y + 10, y + h - 10, grosor, huecos.sort((a, b) => a[0] - b[0]));
    });

    // 2 divisores horizontales, con una puerta por cada una de las 3 bandas verticales
    const xBandas = [x, x + w / 3, x + 2 * w / 3, x + w];
    [y + h / 3, y + 2 * h / 3].forEach(coordY => {
        const huecos = [];
        for (let i = 0; i < 3; i++) {
            const bandaDesde = xBandas[i], bandaHasta = xBandas[i + 1];
            const centro = (bandaDesde + bandaHasta) / 2 + (Math.random() - 0.5) * 40;
            const ancho = 100 + Math.random() * 40;
            huecos.push([centro - ancho / 2, centro + ancho / 2]);
        }
        pintarParedConHuecos(tm, 'horizontal', coordY, x + 10, x + w - 10, grosor, huecos.sort((a, b) => a[0] - b[0]));
    });
}

function decorarEscombros(tm, sala) {
    const { x, y } = sala.posicion, { ancho: w, alto: h } = sala.tamaño;
    const count = 20 + Math.floor(Math.random() * 16); // 20-35
    sala.obstaculos = dispersarObstaculosCirculares(tm, { x, y, w, h }, {
        count, radioMin: 30, radioMax: 80, espacioMinimo: 100, inset: 100, intentosMax: count * 25,
    });
}

function decorarBosque(tm, sala) {
    const { x, y } = sala.posicion, { ancho: w, alto: h } = sala.tamaño;
    const count = 30 + Math.floor(Math.random() * 21); // 30-50
    sala.obstaculos = dispersarObstaculosCirculares(tm, { x, y, w, h }, {
        count, radioMin: 25, radioMax: 35, espacioMinimo: 80, inset: 55, intentosMax: count * 25,
    });
}

function decorarLaberintoComplejo(tm, sala) {
    const { x, y } = sala.posicion, { ancho: w, alto: h } = sala.tamaño;
    pintarParedesLaberinto(tm, sala, 4, 5, 350); // set reducido y más espaciado que laberinto_simple
    const count = 10 + Math.floor(Math.random() * 6); // 10-15
    // dispersarObstaculosCirculares solo acepta candidatos ya walkable, así
    // que estas rocas quedan automáticamente en los huecos que dejaron las
    // paredes recién pintadas arriba, sin lógica extra.
    sala.obstaculos = dispersarObstaculosCirculares(tm, { x, y, w, h }, {
        count, radioMin: 30, radioMax: 70, espacioMinimo: 100, inset: 90, intentosMax: count * 30,
    });
}

function decorarAnilloBatalla(tm, sala) {
    const { x, y } = sala.posicion, { ancho: w, alto: h } = sala.tamaño;
    const cx = x + w / 2, cy = y + h / 2;
    const rx = w / 2 - 20, ry = h / 2 - 20;
    pintarFueraDeElipseComoPared(tm, x, y, w, h, cx, cy, rx, ry);

    // 4 bloques de cobertura en las diagonales (NE/NW/SE/SW), con carriles
    // abiertos entre ellos — adaptación de "muros radiales" a rects
    // axis-aligned (los helpers de tilemap no rasterizan rects rotados).
    const dist = 0.65 * Math.min(rx, ry);
    const blockSize = Math.min(160, Math.max(80, Math.min(w, h) * 0.12));
    const diagonales = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    const diag = Math.SQRT1_2;
    diagonales.forEach(([sx, sy]) => {
        const bx = cx + sx * diag * dist, by = cy + sy * diag * dist;
        pintarRectComoParedEnTilemap(tm, bx - blockSize / 2, by - blockSize / 2, blockSize, blockSize);
    });
}

function decorarCatacumbas(tm, sala) {
    const { x, y } = sala.posicion, { ancho: w, alto: h } = sala.tamaño;
    const cx = x + w / 2, cy = y + h / 2;

    // Paso A: la sala entera empieza como roca sólida (pared).
    pintarRectComoParedEnTilemap(tm, x, y, w, h);

    // Paso B/C: 5-7 cuevas orgánicas, cada una un cúmulo de 3-5 círculos
    // superpuestos alrededor de un ancla distribuida angularmente.
    const numBlobs = 5 + Math.floor(Math.random() * 3);
    const anclas = [];
    for (let i = 0; i < numBlobs; i++) {
        const angulo = (i / numBlobs) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
        const distFactor = 0.25 + Math.random() * 0.5;
        const ax = cx + Math.cos(angulo) * distFactor * (w / 2 - 100);
        const ay = cy + Math.sin(angulo) * distFactor * (h / 2 - 100);
        anclas.push({ x: ax, y: ay });

        const R = Math.min(Math.min(w, h) * 0.25, 90 + Math.random() * 60);
        const numCirculos = 3 + Math.floor(Math.random() * 3);
        for (let c = 0; c < numCirculos; c++) {
            const off = Math.random() * R * 0.5, ang = Math.random() * Math.PI * 2;
            const sx = ax + Math.cos(ang) * off, sy = ay + Math.sin(ang) * off;
            const r = R * (0.6 + Math.random() * 0.4);
            pintarCirculoEnTilemap(tm, sx, sy, r, 1);
        }
    }

    // Paso D: conecta las cuevas con un árbol de expansión mínima (Prim
    // simplificado desde el ancla 0) reusando conectarPuntos (mismo
    // conector en L que la red de seguridad global).
    const conectadas = new Set([0]);
    while (conectadas.size < anclas.length) {
        let mejorDesde = -1, mejorHasta = -1, mejorDist = Infinity;
        conectadas.forEach(i => {
            anclas.forEach((a, j) => {
                if (conectadas.has(j)) return;
                const d = Math.hypot(anclas[i].x - a.x, anclas[i].y - a.y);
                if (d < mejorDist) { mejorDist = d; mejorDesde = i; mejorHasta = j; }
            });
        });
        if (mejorHasta === -1) break;
        conectarPuntos(tm, anclas[mejorDesde].x, anclas[mejorDesde].y, anclas[mejorHasta].x, anclas[mejorHasta].y);
        conectadas.add(mejorHasta);
    }

    // Paso E: unos pocos obstáculos dispersos — el chequeo de "candidato ya
    // walkable" dentro de dispersarObstaculosCirculares los confina solo a
    // las cuevas/pasajes ya tallados, nunca a la roca sólida circundante.
    const count = 3 + Math.floor(Math.random() * 4);
    sala.obstaculos = dispersarObstaculosCirculares(tm, { x, y, w, h }, {
        count, radioMin: 25, radioMax: 45, espacioMinimo: 90, inset: 40, intentosMax: count * 30,
    });
}

const DECORADORES_POR_TIPO = {
    vacia_gigante: decorarVaciaGigante,
    laberinto_simple: decorarLaberintoSimple,
    crucero: decorarCrucero,
    compartimentada: decorarCompartimentada,
    escombros: decorarEscombros,
    bosque: decorarBosque,
    laberinto_complejo: decorarLaberintoComplejo,
    anillo_batalla: decorarAnilloBatalla,
    catacumbas: decorarCatacumbas,
    // vacia_simple: sin decorador, no-op por defecto (ver decorarSala).
};

function decorarSala(tm, sala) {
    const decorador = DECORADORES_POR_TIPO[sala.tipoEstructural];
    if (decorador) decorador(tm, sala);
}

// ----- SALAS OCULTAS ("cuevas" camufladas dentro de bloques de pared) -----
// Después de que el piso ya está 100% generado y garantizado transitable
// (paredes+corredores+decoración+red de seguridad, ver generarPiso), busca
// bloques de pared sólida junto a salas reales y talla adentro una salita
// chica + un pasaje angosto hacia la sala más cercana. Esos tiles quedan
// walkable desde el principio, pero se pintan como pared (camuflaje) hasta
// que el jugador los pisa (ver ocultoId/ocultoDescubierto en crearTilemap,
// renderWallsGrid, y revelarSalaOculta/update() en game.js) y JAMÁS
// aparecen en el minimapa/mapa grande (ver buildMinimapStatic en game.js).
const TAMAÑO_SALA_OCULTA_MIN = 220;
const TAMAÑO_SALA_OCULTA_MAX = 900; // tan grande como lo permita el bloque de pared, con este tope
const MARGEN_SALA_OCULTA = 50;
const ANCHO_ENTRADA_OCULTA_MIN_TILES = 2;
const ANCHO_ENTRADA_OCULTA_MAX_TILES = 4;

function rectEsTodoPared(tm, x, y, w, h) {
    const c1 = Math.floor(x / TILE_SIZE), c2 = Math.floor((x + w) / TILE_SIZE);
    const r1 = Math.floor(y / TILE_SIZE), r2 = Math.floor((y + h) / TILE_SIZE);
    if (c1 < 0 || r1 < 0 || c2 >= tm.cols || r2 >= tm.rows) return false;
    for (let ty = r1; ty <= r2; ty++) {
        for (let tx = c1; tx <= c2; tx++) {
            if (tm.tiles[tileIndexTM(tm, tx, ty)] !== 0) return false;
        }
    }
    return true;
}

// Primer tile walkable encontrado en una búsqueda por anillos cuadrados
// crecientes desde (cx,cy) — usado para hallar por dónde "entrar" a la sala
// oculta desde el área real más cercana.
function buscarWalkableCercano(tm, cx, cy, maxDistPx) {
    const startTx = Math.floor(cx / TILE_SIZE), startTy = Math.floor(cy / TILE_SIZE);
    const maxRadio = Math.ceil(maxDistPx / TILE_SIZE);
    for (let radio = 1; radio <= maxRadio; radio++) {
        for (let dy = -radio; dy <= radio; dy++) {
            for (let dx = -radio; dx <= radio; dx++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== radio) continue; // solo el borde de este anillo
                const tx = startTx + dx, ty = startTy + dy;
                if (tx < 0 || ty < 0 || tx >= tm.cols || ty >= tm.rows) continue;
                if (tm.tiles[tileIndexTM(tm, tx, ty)] === 1) {
                    return { x: tx * TILE_SIZE + TILE_SIZE / 2, y: ty * TILE_SIZE + TILE_SIZE / 2 };
                }
            }
        }
    }
    return null;
}

// Pinta walkable un rect Y lo marca con `id` en tm.ocultoId, registrando
// cada tile tocado en `listaSalida` (para poder revelarlos todos juntos
// después, ver revelarSalaOculta en generateDungeon).
function tallarRectOculto(tm, x, y, w, h, id, listaSalida) {
    pintarRectEnTilemap(tm, x, y, w, h);
    const c1 = Math.max(0, Math.floor(x / TILE_SIZE));
    const c2 = Math.min(tm.cols - 1, Math.floor((x + w) / TILE_SIZE));
    const r1 = Math.max(0, Math.floor(y / TILE_SIZE));
    const r2 = Math.min(tm.rows - 1, Math.floor((y + h) / TILE_SIZE));
    for (let ty = r1; ty <= r2; ty++) {
        for (let tx = c1; tx <= c2; tx++) {
            const idx = tileIndexTM(tm, tx, ty);
            if (tm.ocultoId[idx] === 0) { tm.ocultoId[idx] = id; listaSalida.push(idx); }
        }
    }
}

// Pasaje en L entre dos puntos, tallado y marcado igual que arriba. `ancho`
// en px (2-4 tiles, ver ANCHO_ENTRADA_OCULTA_*), más angosto que los 80px de
// la red de seguridad para que se siga sintiendo "secreto" pero ya no un
// pasillo de un solo tile.
function tallarPasajeOculto(tm, x1, y1, x2, y2, ancho, id, listaSalida) {
    const half = ancho / 2;
    tallarRectOculto(tm, Math.min(x1, x2) - half, y1 - half, Math.abs(x2 - x1) + ancho, ancho, id, listaSalida);
    tallarRectOculto(tm, x2 - half, Math.min(y1, y2) - half, ancho, Math.abs(y2 - y1) + ancho, id, listaSalida);
}

// Busca, para un punto candidato, el tamaño de sala oculta MÁS GRANDE que
// todavía cabe entero sobre pared sólida (con margen), probando de a un
// tile más grande desde el mínimo hasta el tope — así la sala es "tan
// grande como lo permita el espacio" en vez de un tamaño fijo. Devuelve 0
// si ni el tamaño mínimo cabe (candidato inválido).
function tamañoMaxSalaOcultaEnPunto(tm, cx, cy) {
    let mejor = 0;
    for (let size = TAMAÑO_SALA_OCULTA_MIN; size <= TAMAÑO_SALA_OCULTA_MAX; size += TILE_SIZE) {
        const hx = cx - size / 2, hy = cy - size / 2;
        const m = MARGEN_SALA_OCULTA;
        if (!rectEsTodoPared(tm, hx - m, hy - m, size + m * 2, size + m * 2)) break;
        mejor = size;
    }
    return mejor;
}

// Cantidades deseadas por piso, 0-6 (ver pedido del usuario "hasta 6"), con
// cola decreciente para que sigan sintiéndose especiales — la mayoría de
// pisos tiene 0-2, encontrar las 6 en el mismo piso debería ser raro.
const SALAS_OCULTAS_POR_PISO_PESOS = [
    { cantidad: 0, peso: 0.25 }, { cantidad: 1, peso: 0.28 }, { cantidad: 2, peso: 0.20 },
    { cantidad: 3, peso: 0.13 }, { cantidad: 4, peso: 0.08 }, { cantidad: 5, peso: 0.04 }, { cantidad: 6, peso: 0.02 },
];
function elegirCantidadSalasOcultas() {
    const total = SALAS_OCULTAS_POR_PISO_PESOS.reduce((s, o) => s + o.peso, 0);
    let roll = Math.random() * total;
    for (const o of SALAS_OCULTAS_POR_PISO_PESOS) {
        roll -= o.peso;
        if (roll <= 0) return o.cantidad;
    }
    return 0;
}

// Devuelve [{id, centro:{x,y}, tileIndices:[...]}] — hasta
// SALAS_OCULTAS_POR_PISO_PESOS.length-1 salas por piso (no todos los pisos
// tienen una, y no siempre se llega a la cantidad deseada). Cada una se
// intenta en uno de los 4 lados de una sala real elegida al azar, tan
// grande como quepa entera sobre pared sólida (ver
// tamañoMaxSalaOcultaEnPunto); si ningún lado tiene espacio, esa sala real
// se descarta sin reintentar (mantiene el costo acotado, no es crítico que
// se llegue siempre a la cantidad deseada).
function generarSalasOcultas(tm, salas) {
    const numDeseadas = elegirCantidadSalasOcultas();
    if (numDeseadas === 0 || !salas.length) return [];

    const salasBarajadas = salas.slice().sort(() => Math.random() - 0.5);
    const resultado = [];

    for (const sala of salasBarajadas) {
        if (resultado.length >= numDeseadas) break;
        const { x: rx, y: ry } = sala.posicion, { ancho: rw, alto: rh } = sala.tamaño;
        const cx = rx + rw / 2, cy = ry + rh / 2;
        const offsetBase = TAMAÑO_SALA_OCULTA_MIN / 2 + MARGEN_SALA_OCULTA + 80;
        const candidatos = [
            { x: rx - offsetBase, y: cy },
            { x: rx + rw + offsetBase, y: cy },
            { x: cx, y: ry - offsetBase },
            { x: cx, y: ry + rh + offsetBase },
        ].sort(() => Math.random() - 0.5);

        for (const c of candidatos) {
            const size = tamañoMaxSalaOcultaEnPunto(tm, c.x, c.y);
            if (size === 0) continue;

            const entrada = buscarWalkableCercano(tm, c.x, c.y, 700);
            if (!entrada) continue;

            const id = resultado.length + 1;
            const tileIndices = [];
            const hx = c.x - size / 2, hy = c.y - size / 2;
            tallarRectOculto(tm, hx, hy, size, size, id, tileIndices);
            const anchoEntrada = TILE_SIZE * (ANCHO_ENTRADA_OCULTA_MIN_TILES
                + Math.floor(Math.random() * (ANCHO_ENTRADA_OCULTA_MAX_TILES - ANCHO_ENTRADA_OCULTA_MIN_TILES + 1)));
            tallarPasajeOculto(tm, c.x, c.y, entrada.x, entrada.y, anchoEntrada, id, tileIndices);
            resultado.push({ id, centro: { x: c.x, y: c.y }, tileIndices });
            break; // ya encontramos un lado válido para esta sala real, seguir con la próxima sala oculta
        }
    }
    return resultado;
}

// ----- PORTALES -----
// 4 fijos en las esquinas del mapa, todos al Piso Siguiente (Actual+1, tope
// en MAX_FLOOR) — "tipo: siguiente"/ascenso. Un 5to portal, exactamente en
// la posición de aparición del jugador (centro del mapa), al Piso Anterior
// (Actual-1) — "tipo: anterior"/descenso; no existe en el Piso 1 (no hay
// piso 0 al que bajar).
function generarPortales(pisoActual) {
    const siguiente = Math.min(MAX_FLOOR, pisoActual + 1);
    const portales = [
        { posicion: { x: 100, y: 100 }, esquina: 'arriba-izquierda', destino: siguiente, tipo: 'siguiente' },
        { posicion: { x: 19100, y: 100 }, esquina: 'arriba-derecha', destino: siguiente, tipo: 'siguiente' },
        { posicion: { x: 100, y: 11900 }, esquina: 'abajo-izquierda', destino: siguiente, tipo: 'siguiente' },
        { posicion: { x: 19100, y: 11900 }, esquina: 'abajo-derecha', destino: siguiente, tipo: 'siguiente' },
    ];
    if (pisoActual > 1) {
        portales.push({ posicion: { ...POSICION_JUGADOR_INICIO }, esquina: 'centro', destino: pisoActual - 1, tipo: 'anterior' });
    }
    return portales;
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
// Punto walkable dentro de una sala interna (sala.posicion/sala.tamaño, no
// el rect simplificado {x,y,w,h} del contrato público) — reusa
// randomPointInRoomGrid para que el jefe nunca aparezca encima de una pared
// u obstáculo interno (mismo bug que afectaba a randomPointInRoom antes de
// que chequeara walkability).
function puntoWalkableEnSala(tm, sala, margin) {
    return randomPointInRoomGrid(tm, { x: sala.posicion.x, y: sala.posicion.y, w: sala.tamaño.ancho, h: sala.tamaño.alto }, margin);
}

function generarJefePiso(piso, salas, tm) {
    const salaGrande = salas.reduce((best, s) => {
        const area = s.tamaño.ancho * s.tamaño.alto;
        const bestArea = best ? best.tamaño.ancho * best.tamaño.alto : -1;
        return area > bestArea ? s : best;
    }, null);
    const posicionFallback = salaGrande ? puntoWalkableEnSala(tm, salaGrande, 100) : { ...POSICION_JUGADOR_INICIO };

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
            posicion: salaAleatoria ? puntoWalkableEnSala(tm, salaAleatoria, 100) : posicionFallback,
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

// Punto random DENTRO de la sala que además sea walkable — antes devolvía
// cualquier punto del rect sin chequear, lo cual era seguro cuando las
// salas no tenían paredes/obstáculos internos, pero desde que se agregaron
// (ver decorarSala/ROOM_STRUCTURE_TYPES) podía caer justo encima de una
// pared u obstáculo, dejando enemigos/nodos/cofres atascados sin poder
// moverse. Reintenta unas cuantas veces; si la sala está MUY llena, cae a
// un escaneo tile por tile del área de la sala (siempre encuentra algo,
// toda sala tiene al menos 1 tile walkable por la red de seguridad de
// conectividad); el centro de la sala es la última red, nunca debería
// llegar ahí.
function randomPointInRoomGrid(tm, room, margin) {
    margin = margin || TILE_SIZE;
    for (let intento = 0; intento < 40; intento++) {
        const x = room.x + margin + Math.random() * Math.max(1, room.w - margin * 2);
        const y = room.y + margin + Math.random() * Math.max(1, room.h - margin * 2);
        if (isWalkableGrid(tm, x, y, 24)) return { x, y };
    }
    const c1 = Math.max(0, Math.floor(room.x / TILE_SIZE)), c2 = Math.min(tm.cols - 1, Math.floor((room.x + room.w) / TILE_SIZE));
    const r1 = Math.max(0, Math.floor(room.y / TILE_SIZE)), r2 = Math.min(tm.rows - 1, Math.floor((room.y + room.h) / TILE_SIZE));
    for (let ty = r1; ty <= r2; ty++) {
        for (let tx = c1; tx <= c2; tx++) {
            if (tm.tiles[tileIndexTM(tm, tx, ty)] === 1) {
                return { x: tx * TILE_SIZE + TILE_SIZE / 2, y: ty * TILE_SIZE + TILE_SIZE / 2 };
            }
        }
    }
    return { x: room.x + room.w / 2, y: room.y + room.h / 2 };
}

// Pinta paredes Y piso tile por tile (antes solo paredes; el piso quedaba
// como fondo CSS plano, ver loadFloor en game.js) con variación de color
// natural (ver variarColorHex/generarRuidoTexturaTilemap) derivada de los
// colores REALES del bioma actual — obstáculos dispersos (tm.esObstaculo)
// se pintan con un tono "roca" distinto al de las paredes estructurales.
function renderWallsGrid(tm, ctx, camera, canvasWidth, canvasHeight, biome) {
    const c1 = Math.max(0, Math.floor(camera.x / TILE_SIZE));
    const r1 = Math.max(0, Math.floor(camera.y / TILE_SIZE));
    const c2 = Math.min(tm.cols - 1, Math.floor((camera.x + canvasWidth) / TILE_SIZE));
    const r2 = Math.min(tm.rows - 1, Math.floor((camera.y + canvasHeight) / TILE_SIZE));
    const wallBase = (biome && biome.wallColor) || '#0d0b14';
    const floorBase = ajustarBrilloHex((biome && biome.floorColor) || '#141018', 18); // piso levemente más claro que el color base del bioma
    const rockBase = colorRocaDesdeBiome(wallBase);
    // Sala oculta revelada: piso bien oscurecido (ver generarSalasOcultas),
    // para que se sienta como una "cueva" distinta de una sala normal.
    const floorOcultoBase = ajustarBrilloHex(floorBase, -55);
    for (let cy = r1; cy <= r2; cy++) {
        for (let cx = c1; cx <= c2; cx++) {
            const idx = tileIndexTM(tm, cx, cy);
            if (tm.tiles[idx] === 0) {
                const base = tm.esObstaculo[idx] ? rockBase : wallBase;
                ctx.fillStyle = variarColorHex(base, tm.wallNoise[idx], 22);
            } else if (tm.ocultoId[idx] && !tm.ocultoDescubierto[idx]) {
                // Camuflada: walkable de verdad, pero se ve IGUAL que pared
                // hasta que el jugador la pisa (ver update() en game.js).
                ctx.fillStyle = variarColorHex(wallBase, tm.wallNoise[idx], 22);
            } else if (tm.ocultoId[idx]) {
                ctx.fillStyle = variarColorHex(floorOcultoBase, tm.floorNoise[idx], 14);
            } else {
                ctx.fillStyle = variarColorHex(floorBase, tm.floorNoise[idx], 14);
            }
            ctx.fillRect(cx * TILE_SIZE, cy * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        }
    }
}

// Pinta un tinte de color semi-transparente SOLO sobre tiles walkable
// (nunca sobre paredes) dentro de un radio alrededor de (cx,cy), con caída
// suave hacia el borde — usado por las zonas de recursos de trigo/mena (ver
// RESOURCE_ZONE_TINTS en constants.js, drawResourceZoneTints en game.js).
// Opera sobre el contrato PÚBLICO de dungeon (tiles/cols/rows/tileIndex),
// no necesita el tilemap interno.
function renderFloorTint(dungeon, ctx, camera, canvasWidth, canvasHeight, cx, cy, radius, colorHex, maxAlpha) {
    const c1 = Math.max(0, Math.floor((camera.x) / TILE_SIZE), Math.floor((cx - radius) / TILE_SIZE));
    const r1 = Math.max(0, Math.floor((camera.y) / TILE_SIZE), Math.floor((cy - radius) / TILE_SIZE));
    const c2 = Math.min(dungeon.cols - 1, Math.floor((camera.x + canvasWidth) / TILE_SIZE), Math.floor((cx + radius) / TILE_SIZE));
    const r2 = Math.min(dungeon.rows - 1, Math.floor((camera.y + canvasHeight) / TILE_SIZE), Math.floor((cy + radius) / TILE_SIZE));
    if (c1 > c2 || r1 > r2) return; // zona fuera de cámara, nada que pintar
    ctx.fillStyle = colorHex;
    for (let ty = r1; ty <= r2; ty++) {
        const centroY = ty * TILE_SIZE + TILE_SIZE / 2;
        for (let tx = c1; tx <= c2; tx++) {
            const idx = dungeon.tileIndex(tx, ty);
            if (dungeon.tiles[idx] !== 1) continue; // nunca sobre paredes/obstáculos
            const centroX = tx * TILE_SIZE + TILE_SIZE / 2;
            const dist = Math.hypot(centroX - cx, centroY - cy);
            if (dist > radius) continue;
            ctx.globalAlpha = maxAlpha * (1 - dist / radius);
            ctx.fillRect(tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        }
    }
    ctx.globalAlpha = 1;
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
    // Paredes/obstáculos internos según sala.tipoEstructural (ver
    // decorarSala/ROOM_STRUCTURE_TYPES) — SIEMPRE antes de la red de
    // seguridad de abajo, que talla a través de lo que haga falta para
    // garantizar transitabilidad 100% sin importar qué tipo tocó a cada sala.
    salas.forEach(s => decorarSala(tm, s));
    conectarVecinosDelGrid(tm, salas);

    // Garantías de conectividad (ver nota de robustez al inicio del archivo).
    garantizarConexion(tm, salas, POSICION_JUGADOR_INICIO);
    const portales = generarPortales(pisoActual);
    portales.forEach(p => garantizarConexion(tm, salas, p.posicion));

    const jefe = generarJefePiso(pisoActual, salas, tm);

    // Salas ocultas ("cuevas" camufladas, ver generarSalasOcultas): SIEMPRE
    // después de la red de seguridad de arriba, para tallarlas solo en
    // bloques de pared que sigan siendo sólidos en el tilemap final.
    const salasOcultas = generarSalasOcultas(tm, salas);

    return {
        numeroDelPiso: pisoActual,
        tilemap: tm,
        grid: { anchoceldas: MAX_GRID_ANCHO, altoceldas: MAX_GRID_ALTO, celdaAncho: TAMAÑO_CELDA_ANCHO, celdaAlto: TAMAÑO_CELDA_ALTO },
        salas,
        corredores,
        salasOcultas,
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
    // tipoEstructural/obstaculos: expuestos además de x/y/w/h para que
    // game.js pueda priorizar salas con obstáculos de roca al ubicar zonas
    // de recursos de mena/ore (ver loadFloor) — no rompe el contrato viejo,
    // solo agrega campos nuevos al objeto room.
    piso.rooms = piso.salas.map(s => ({
        x: s.posicion.x, y: s.posicion.y, w: s.tamaño.ancho, h: s.tamaño.alto,
        tipoEstructural: s.tipoEstructural, obstaculos: s.obstaculos || [],
    }));
    piso.isWalkable = (x, y, radius) => isWalkableGrid(tm, x, y, radius);
    piso.randomPointInRoom = (room, margin) => randomPointInRoomGrid(tm, room, margin);
    piso.getLargestRoom = () => piso.rooms.reduce((best, r) => (r.w * r.h > best.w * best.h ? r : best), piso.rooms[0]);
    const biome = getBiomeForFloor(pisoActual);
    piso.biome = biome;
    piso.renderWalls = (ctx, camera, w, h) => renderWallsGrid(tm, ctx, camera, w, h, biome);

    // Salas ocultas (ver generarSalasOcultas): exponer solo id/centro hacia
    // afuera (las listas de tiles se quedan cerradas en este closure) más
    // el array crudo ocultoId (para que game.js detecte en qué sala está
    // parado el jugador) y un método para revelarla — nunca se expone
    // ocultoDescubierto directo para forzar que solo se revele por esta vía.
    const salasOcultasInternas = piso.salasOcultas;
    piso.ocultoId = tm.ocultoId;
    piso.salasOcultas = salasOcultasInternas.map(s => ({ id: s.id, centro: s.centro }));
    piso.revelarSalaOculta = (id) => {
        const sala = salasOcultasInternas.find(s => s.id === id);
        if (!sala) return;
        sala.tileIndices.forEach(idx => { tm.ocultoDescubierto[idx] = 1; });
    };

    return piso;
}

// ----- TABERNA (piso especial de descanso y comercio, ver SISTEMA DE
// TABERNA en game.js) -----
// Un único mundo fijo (no varía entre visitas): 2x2 celdas de tamaño
// MÁXIMO (TAMAÑO_CELDA_ANCHO x TAMAÑO_CELDA_ALTO cada una, igual que
// cualquier sala máxima de un piso normal) formando un área abierta de
// ~3200x2400 sin corredores internos (las 4 quedan directamente
// adyacentes). Reusa el mismo tilemap/interfaz que generateDungeon() para
// que el resto de game.js (movimiento, cámara, minimapa) no necesite ramas
// especiales.
function generarTaberna() {
    const tm = crearTilemap();
    const anchoTotal = TAMAÑO_CELDA_ANCHO * 2;
    const altoTotal = TAMAÑO_CELDA_ALTO * 2;
    const originX = POSICION_JUGADOR_INICIO.x - anchoTotal / 2;
    const originY = POSICION_JUGADOR_INICIO.y - altoTotal / 2;
    pintarRectEnTilemap(tm, originX, originY, anchoTotal, altoTotal);

    const room = { x: originX, y: originY, w: anchoTotal, h: altoTotal };
    // Mercader detrás del "mostrador", pegado a la pared superior y
    // centrado horizontalmente (ver drawTabernaDecor en game.js). Artesano
    // (crafteo) y Hechicero (encantamientos) a los lados, misma fila.
    const mercaderPos = { x: originX + anchoTotal / 2, y: originY + 150 };
    const artesanoPos = { x: originX + anchoTotal * 0.75, y: originY + 150 };
    const hechiceroPos = { x: originX + anchoTotal * 0.25, y: originY + 150 };

    return {
        numeroDelPiso: null,
        tilemap: tm,
        cols: tm.cols,
        rows: tm.rows,
        tiles: tm.tiles,
        tileIndex: (cx, cy) => tileIndexTM(tm, cx, cy),
        rooms: [room],
        isWalkable: (x, y, radius) => isWalkableGrid(tm, x, y, radius),
        randomPointInRoom: (r, margin) => randomPointInRoomGrid(tm, r, margin),
        getLargestRoom: () => room,
        renderWalls: (ctx, camera, w, h) => renderWallsGrid(tm, ctx, camera, w, h, TABERNA_THEME),
        // La taberna no tiene salas ocultas (mundo fijo, sin decoración de
        // paredes), pero mantiene el mismo contrato para que el código
        // genérico de game.js (update/buildMinimapStatic) no necesite
        // chequear si existe.
        ocultoId: tm.ocultoId,
        salasOcultas: [],
        revelarSalaOculta: () => {},
        posicionJugadorInicio: { x: POSICION_JUGADOR_INICIO.x, y: POSICION_JUGADOR_INICIO.y },
        mercaderPos,
        artesanoPos,
        hechiceroPos,
        biome: TABERNA_THEME,
        esTaberna: true,
        portales: [],
        jefe: null,
    };
}
