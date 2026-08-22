// ===== SÍMBOLOS GEOMÉTRICOS DE CLASE =====
// Dibuja el símbolo de una de las 6 clases de combate (Arquero/Pícaro/Mago/
// Guerrero/Bárbaro/Tanque), reemplazando el emoji de arma que se dibujaba
// antes en el círculo interior del jugador (ver drawPlayerEntity en
// game.js). Geometría provista por el usuario (personajes-geometricos.html);
// acá se separó el símbolo puro del círculo/borde de fondo porque esos ya
// existen en el juego con el color de RAREZA del arma/armadura equipada (no
// un color fijo por clase) — ver la decisión "símbolo reemplaza solo el
// emoji" tomada explícitamente por el usuario.
const CLASS_SYMBOL_COLOR = '#000';

// El color del símbolo es el color de clase que YA usa el juego (mismo que
// el de sus habilidades y el de los círculos de cooldown, ver
// RT_TOGGLE_SKILLS en constants.js — ej. Mago = azul neón #00ffff) — no un
// color nuevo inventado.
function getClassSymbolColor(classId) {
    const cfg = RT_TOGGLE_SKILLS[classId];
    return (cfg && cfg.color) || CLASS_SYMBOL_COLOR;
}

function drawArqueroSymbol(ctx) {
    ctx.beginPath();
    ctx.moveTo(0, -20); ctx.lineTo(-8, -8); ctx.lineTo(8, -8);
    ctx.closePath(); ctx.fill();

    ctx.beginPath();
    ctx.moveTo(-15, -5); ctx.lineTo(15, -5); ctx.lineTo(0, 15);
    ctx.closePath(); ctx.fill();

    ctx.beginPath();
    ctx.moveTo(0, 18); ctx.lineTo(-6, 8); ctx.lineTo(6, 8);
    ctx.closePath(); ctx.fill();

    ctx.beginPath();
    ctx.moveTo(-20, -10); ctx.lineTo(-10, -10); ctx.lineTo(-15, 10);
    ctx.closePath(); ctx.fill();

    ctx.beginPath();
    ctx.moveTo(20, -10); ctx.lineTo(10, -10); ctx.lineTo(15, 10);
    ctx.closePath(); ctx.fill();
}

function drawPicaroSymbol(ctx) {
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-20, -20); ctx.lineTo(20, 20); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(20, -20); ctx.lineTo(-20, 20); ctx.stroke();

    ctx.beginPath(); ctx.moveTo(0, -20); ctx.lineTo(-5, -12); ctx.lineTo(5, -12); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, 20); ctx.lineTo(-5, 12); ctx.lineTo(5, 12); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-20, 0); ctx.lineTo(-12, -5); ctx.lineTo(-12, 5); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(20, 0); ctx.lineTo(12, -5); ctx.lineTo(12, 5); ctx.closePath(); ctx.fill();

    ctx.beginPath(); ctx.moveTo(-14, -14); ctx.lineTo(-8, -18); ctx.lineTo(-12, -8); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(14, -14); ctx.lineTo(8, -18); ctx.lineTo(12, -8); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-14, 14); ctx.lineTo(-8, 18); ctx.lineTo(-12, 8); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(14, 14); ctx.lineTo(8, 18); ctx.lineTo(12, 8); ctx.closePath(); ctx.fill();

    ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(7, 0); ctx.lineTo(0, 7); ctx.lineTo(-7, 0); ctx.closePath(); ctx.fill();
}

function drawMagoSymbol(ctx) {
    for (let i = 0; i < 8; i++) {
        const angle = (i * Math.PI * 2) / 8;
        const nextAngle = ((i + 1) * Math.PI * 2) / 8;
        const x1 = Math.cos(angle) * 6, y1 = Math.sin(angle) * 6;
        const x2 = Math.cos(nextAngle) * 6, y2 = Math.sin(nextAngle) * 6;
        const x3 = Math.cos(angle + 0.5) * 24, y3 = Math.sin(angle + 0.5) * 24;
        ctx.beginPath();
        ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3);
        ctx.closePath(); ctx.fill();
    }
    ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill();
}

// holeColor: el punto central funciona como un "agujero" que muestra el
// color del círculo de fondo detrás (mismo truco visual de la referencia
// original), en vez de un color de clase fijo que ya no aplica acá.
function drawGuerreroSymbol(ctx, holeColor, mainColor) {
    ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(12, 0); ctx.lineTo(0, 16); ctx.lineTo(-12, 0); ctx.closePath(); ctx.fill();

    ctx.beginPath(); ctx.moveTo(-6, -14); ctx.lineTo(6, -14); ctx.lineTo(0, -24); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-6, 14); ctx.lineTo(6, 14); ctx.lineTo(0, 24); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-14, -6); ctx.lineTo(-14, 6); ctx.lineTo(-24, 0); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(14, -6); ctx.lineTo(14, 6); ctx.lineTo(24, 0); ctx.closePath(); ctx.fill();

    ctx.beginPath(); ctx.moveTo(-10, -10); ctx.lineTo(-14, -14); ctx.lineTo(-6, -14); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(10, -10); ctx.lineTo(14, -14); ctx.lineTo(6, -14); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-10, 10); ctx.lineTo(-14, 14); ctx.lineTo(-6, 14); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(10, 10); ctx.lineTo(14, 14); ctx.lineTo(6, 14); ctx.closePath(); ctx.fill();

    ctx.fillStyle = holeColor || CLASS_SYMBOL_COLOR;
    ctx.beginPath(); ctx.arc(0, 0, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = mainColor || CLASS_SYMBOL_COLOR;
}

function drawBarbaroSymbol(ctx) {
    ctx.beginPath(); ctx.moveTo(0, -22); ctx.lineTo(-8, -8); ctx.lineTo(8, -8); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, 22); ctx.lineTo(-8, 8); ctx.lineTo(8, 8); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-22, 0); ctx.lineTo(-8, -8); ctx.lineTo(-8, 8); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(22, 0); ctx.lineTo(8, -8); ctx.lineTo(8, 8); ctx.closePath(); ctx.fill();

    ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(8, 0); ctx.lineTo(0, 8); ctx.lineTo(-8, 0); ctx.closePath(); ctx.fill();

    ctx.beginPath(); ctx.moveTo(-12, -12); ctx.lineTo(-16, -18); ctx.lineTo(-8, -16); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(12, -12); ctx.lineTo(16, -18); ctx.lineTo(8, -16); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-12, 12); ctx.lineTo(-16, 18); ctx.lineTo(-8, 16); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(12, 12); ctx.lineTo(16, 18); ctx.lineTo(8, 16); ctx.closePath(); ctx.fill();
}

function drawTanqueSymbol(ctx) {
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        const angle = (i * Math.PI) / 3;
        const px = Math.cos(angle) * 22, py = Math.sin(angle) * 22;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.stroke();

    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        const angle = (i * Math.PI) / 3;
        const px = Math.cos(angle) * 14, py = Math.sin(angle) * 14;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.stroke();

    ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(-5, -2); ctx.lineTo(5, -2); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, 10); ctx.lineTo(-5, 2); ctx.lineTo(5, 2); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(-2, -5); ctx.lineTo(-2, 5); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(2, -5); ctx.lineTo(2, 5); ctx.closePath(); ctx.fill();

    ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill();
}

const CLASS_SYMBOL_DRAWERS = {
    arquero: drawArqueroSymbol,
    picaro: drawPicaroSymbol,
    mago: drawMagoSymbol,
    guerrero: drawGuerreroSymbol,
    barbaro: drawBarbaroSymbol,
    tanque: drawTanqueSymbol,
};

// scale = radio_destino / 40 (la geometría de arriba está diseñada para un
// círculo de radio 40, ver referencia del usuario). Devuelve false si la
// clase no tiene símbolo definido (profesiones de recolección/desarmado),
// para que el llamador pueda usar un respaldo (el emoji de siempre).
function drawClassSymbol(ctx, classId, x, y, scale, holeColor) {
    const drawer = CLASS_SYMBOL_DRAWERS[classId];
    if (!drawer) return false;
    const color = getClassSymbolColor(classId);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    drawer(ctx, holeColor, color);
    ctx.restore();
    return true;
}
