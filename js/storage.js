// ===== PERSISTENCIA CON LOCALSTORAGE =====

function saveGame(player) {
    const data = {
        level: player.level,
        xp: player.xp,
        stats: player.stats,
        statPoints: player.statPoints,
        activeProfession: player.activeProfession,
        arrows: player.arrows,
        materials: player.materials,
        gold: player.gold,
        merchantListings: player.merchantListings,
        maxFloorReached: player.maxFloorReached,
        defeatedFloorBosses: player.defeatedFloorBosses,
        finalBossPoints: player.finalBossPoints,
        bossHuntKills: player.bossHuntKills,
        finalBossFloor: player.finalBossFloor,
        craftedItems: player.craftedItems,
        equippedCraftedByProf: player.equippedCraftedByProf,
        mounts: player.mounts,
        equippedMountId: player.equippedMountId,
        foodBuffs: player.foodBuffs,
        regenBuffs: player.regenBuffs,
        savedAt: Date.now(),
    };
    try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch (e) {
        console.warn('No se pudo guardar la partida:', e);
    }
}

function loadGame() {
    try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (e) {
        console.warn('No se pudo cargar la partida:', e);
        return null;
    }
}

function clearSave() {
    localStorage.removeItem(SAVE_KEY);
}
