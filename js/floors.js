// ===== SISTEMA DE PISOS: ESCALADO DE ENEMIGOS =====
// Los jefes (minijefe/jefe/jefe final) ya no se generan acá: aparecen de
// forma dinámica al matar enemigos (ver BOSS_TIERS en constants.js y el
// hook Combat.onKillHook / spawnDynamicBoss en game.js).

// Fórmulas: HP*(1+(piso-1)*0.15) — SIN CAMBIOS, el pedido no dio una
// fórmula de vida. Defensa+(piso-1)*0.5, XP*piso — sin cambios tampoco. Al
// XP resultante se le da un rango aleatorio ±15% para que se sienta como
// botín variable (los ejemplos del diseño mostraban rangos, ej. "10-15" en
// vez de un número fijo).
//
// Daño: reemplaza la vieja fórmula lineal sobre baseType.dmg (el dmg propio
// de cada ENEMY_TYPES ya NO se usa para el daño real) por el pedido
// explícito del usuario — ver getCommonEnemyDamageForFloor en constants.js:
// el daño de un enemigo COMÚN es la vida teórica del jugador en ese piso
// entre los golpes que le toma matarlo (20 golpes hasta el piso 100, -1
// golpe cada 100 pisos después). La rareza multiplica esto DESPUÉS (ver
// applyMonsterRarity en game.js, usa rarity.dmgMult, no rarity.mult).
function getScaledEnemyStats(baseType, floor) {
    const hp = Math.round(baseType.hp * (1 + (floor - 1) * 0.15));
    const dmg = Math.round(getCommonEnemyDamageForFloor(floor));
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
