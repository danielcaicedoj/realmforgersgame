// ===== SISTEMA DE PISOS: ESCALADO DE ENEMIGOS =====
// Los jefes (minijefe/jefe/jefe final) ya no se generan acá: aparecen de
// forma dinámica al matar enemigos (ver BOSS_TIERS en constants.js y el
// hook Combat.onKillHook / spawnDynamicBoss en game.js).

// Fórmulas dadas: HP*(1+(piso-1)*0.15), Daño*(1+(piso-1)*0.10),
// Defensa+(piso-1)*0.5, XP*piso. Al XP resultante se le da un rango
// aleatorio ±15% para que se sienta como botín variable (los ejemplos del
// diseño mostraban rangos, ej. "10-15" en vez de un número fijo).
function getScaledEnemyStats(baseType, floor) {
    const hp = Math.round(baseType.hp * (1 + (floor - 1) * 0.15));
    const dmg = Math.round(baseType.dmg * (1 + (floor - 1) * 0.10));
    const defense = (baseType.defense || 0) + (floor - 1) * 0.5;
    const xpBase = baseType.xp * floor;
    const xp = Math.round(xpBase * (0.85 + Math.random() * 0.3));
    return { hp, dmg, defense, xp };
}

// Crea un "tipo" de enemigo ya escalado para este piso (mismo formato que
// ENEMY_TYPES, listo para pasarle a `new Enemy(scaledType, x, y)`).
function buildScaledEnemyType(baseType, floor) {
    const s = getScaledEnemyStats(baseType, floor);
    return { ...baseType, hp: s.hp, dmg: s.dmg, defense: s.defense, xp: s.xp, baseId: baseType.id };
}
