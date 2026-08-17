// ===== CLASE PLAYER =====

class Player {
    constructor() {
        this.x = WORLD_WIDTH / 2;
        this.y = WORLD_HEIGHT / 2;
        this.radius = 22;
        this.baseSpeed = 5.1; // 1.5x la velocidad base (3.4); la montura equipada suma un % encima (ver getEffectiveSpeed)

        this.maxHp = 100;
        this.hp = 100;

        // Nivel único del jugador (1-1000): reemplaza el viejo nivel por arma.
        // Determina el tier de TODAS las armas/armadura por igual.
        this.level = 1;
        this.xp = 0;
        // 5 estadísticas (ver constants.js): Potencia, Destreza, Suerte,
        // Constitución, Agilidad. Orden fijo mostrado en la ventana de
        // estadísticas (tecla V).
        this.stats = { potencia: 0, destreza: 0, suerte: 0, constitucion: 0, agilidad: 0 };
        this.statPoints = 0; // puntos sin repartir (ventana de estadísticas, tecla V)

        this.activeProfession = 'picaro';

        this.arrows = 20;
        this.maxArrows = 20;
        this.arrowRegenTimer = 0;

        this.lastDamageTime = 0;

        this.materials = {}; // materialId -> cantidad (drops de enemigos)
        this.gold = 0; // moneda ganada al derrotar enemigos (ver getEnemyGoldReward en constants.js)

        // Mercader de la Taberna (ver SISTEMA DE TABERNA en game.js/shop.js):
        // lotes vendidos por el jugador, disponibles para recomprar.
        // [{id, type:'material'|'weapon'|'armor'|'mount', materialId?, qty?, item?, price, listedAt}]
        this.merchantListings = [];

        this.floor = 1; // piso actual de la mazmorra (1-1000); NUNCA se persiste (ver ventana de Pisos, tecla P) — cada sesión arranca siempre en el piso 1
        this.maxFloorReached = 1; // piso más alto alcanzado alguna vez; persiste entre sesiones y define qué se puede teletransportar
        this.defeatedFloorBosses = {}; // floor -> true, para saber si el portal está desbloqueado

        // Jefe Final: puntos acumulados hacia FINAL_BOSS_POINTS_TARGET (ver
        // constants.js y game.js/handleEnemyKilled). Persiste entre pisos;
        // se reinicia a 0 apenas aparece. bossHuntKills cuenta las muertes
        // DESPUÉS de llegar a 100/100 (para el % de aparición del contador,
        // ver getFinalBossSpawnChancePercent), se reinicia junto con los puntos.
        this.finalBossPoints = 0;
        this.bossHuntKills = 0;

        // Piso donde hay un Jefe Final activo ahora mismo (null = ninguno),
        // ver SISTEMA DE NOTIFICACIÓN Y TELETRANSPORTE AL JEFE FINAL en
        // game.js. Persiste aunque el jugador se vaya de ese piso — el
        // enemigo en sí se descarta como cualquier otro (ver loadFloor),
        // pero se re-materializa al volver vía teletransporte al jefe.
        this.finalBossFloor = null;

        this.craftedItems = []; // [{id, kind:'weapon'|'armor', profId, tierId, rarityId, damage|defense}]
        this.equippedCraftedByProf = {}; // profId -> craftedItem.id (o null = usar el arma/armadura automática por nivel)

        // Monturas (ver mounts.js): solo 1 equipada a la vez.
        this.mounts = []; // [{id, tierId, rarityId, speedPercent, createdAt}]
        this.equippedMountId = null;

        // Buffs de alimentos del campesino (ver foods.js): los de duración
        // en combates se listan en foodBuffs y se decrementan al terminar
        // cada combate (ver tickFoodBuffsOnCombatEnd); los de regeneración
        // en tiempo real viven en regenBuffs y expiran solos (ver tick()).
        this.foodBuffs = []; // [{foodId, name, emoji, stat, amount, combatsLeft, turnRegen}]
        this.regenBuffs = []; // [{foodId, name, emoji, hpPerMin, expiresAt}]

        // Efectos de estado que le pueden aplicar los jefes en combate.
        this.burn = null;   // { dmg, turnsLeft }
        this.frozenNextTurn = false; // el próximo turno empieza con la mitad de PA

        // Escudo del Tanque (Golpe de Escudo / especiales por tier, ver
        // weapon-attacks.js y combat.js): absorbe daño entrante antes de
        // tocar la vida real. amount = HP restantes por absorber, turnsLeft
        // = turnos hasta que expire (aunque no lo hayan roto). Los campos
        // opcionales (armorBonusPercent, enemyDmgReducePercent,
        // reflectPercent, burnAttacker, healPercentPerTurn,
        // blockBonusPercent, dodgeBonusChance) vienen de los especiales
        // únicos de cada Tier (Ataque 3). Nunca se persiste (combate-only,
        // como burn/frozenNextTurn).
        this.shield = null;

        this.levelUpFlashes = []; // {professionId, until}

        this.loadFromSave();
    }

    loadFromSave() {
        const data = loadGame();
        if (!data) return;
        if (typeof data.level === 'number') this.level = data.level;
        if (typeof data.xp === 'number') this.xp = data.xp;
        if (typeof data.statPoints === 'number') this.statPoints = data.statPoints;
        if (data.stats) {
            // Migración desde el viejo esquema (Fuerza/Destreza/Inteligencia,
            // ver STR_DAMAGE_PROFESSIONS previo a este rediseño): "destreza"
            // existe en ambos esquemas pero significa algo distinto ahora
            // (penetración de armadura, no daño), así que no se puede
            // trasladar directamente. Se reembolsan todos los puntos viejos
            // para repartir en el sistema nuevo, en vez de heredar valores
            // con un significado distinto.
            if ('fuerza' in data.stats || 'inteligencia' in data.stats) {
                const refund = (data.stats.fuerza || 0) + (data.stats.destreza || 0) + (data.stats.inteligencia || 0);
                this.statPoints += refund;
            } else {
                this.stats = { ...this.stats, ...data.stats };
            }
        }
        if (data.activeProfession && getProfession(data.activeProfession)) {
            this.activeProfession = data.activeProfession;
        }
        if (typeof data.arrows === 'number') this.arrows = data.arrows;
        if (data.materials) this.materials = data.materials;
        if (typeof data.gold === 'number') this.gold = data.gold;
        if (Array.isArray(data.merchantListings)) this.merchantListings = data.merchantListings;
        if (typeof data.maxFloorReached === 'number') this.maxFloorReached = data.maxFloorReached;
        if (data.defeatedFloorBosses) this.defeatedFloorBosses = data.defeatedFloorBosses;
        if (typeof data.finalBossPoints === 'number') this.finalBossPoints = data.finalBossPoints;
        if (typeof data.bossHuntKills === 'number') this.bossHuntKills = data.bossHuntKills;
        if (typeof data.finalBossFloor === 'number') this.finalBossFloor = data.finalBossFloor;
        // Objetos crafteados de profesiones eliminadas (ej. Segador) se
        // descartan directamente en vez de quedar huérfanos en el bolso.
        if (Array.isArray(data.craftedItems)) {
            this.craftedItems = data.craftedItems.filter(it => getProfession(it.profId));
        }
        if (data.equippedCraftedByProf) {
            this.equippedCraftedByProf = {};
            Object.keys(data.equippedCraftedByProf).forEach(profId => {
                if (getProfession(profId)) this.equippedCraftedByProf[profId] = data.equippedCraftedByProf[profId];
            });
        }
        if (Array.isArray(data.mounts)) this.mounts = data.mounts;
        if (data.equippedMountId) this.equippedMountId = data.equippedMountId;
        if (Array.isArray(data.foodBuffs)) this.foodBuffs = data.foodBuffs;
        if (Array.isArray(data.regenBuffs)) this.regenBuffs = data.regenBuffs;
        // maxHp no se guarda directamente: se reconstruye desde el nivel +
        // Constitución + los buffs de "vida" activos, así queda consistente
        // tras recargar (ver recalcMaxHp).
        this.recalcMaxHp();
        this.hp = this.maxHp;
    }

    // HP máximo = 100 (base) + Nivel×10 + Constitución×5 + buffs de "vida"
    // de alimentos activos. Se recalcula cada vez que cambia alguno de esos
    // factores (level up, +/- Constitución, useFood/expiración de buffs),
    // en vez de mutar maxHp incrementalmente, para que quede siempre
    // consistente con el estado actual. Sube/baja `hp` solo lo necesario
    // para no exceder el nuevo máximo (no cura de más al subir Constitución).
    recalcMaxHp() {
        const foodVida = this.foodBuffs.filter(b => b.stat === 'vida').reduce((s, b) => s + b.amount, 0);
        this.maxHp = 100 + this.level * 10 + this.stats.constitucion * STAT_CONSTITUCION_HP + foodVida;
        this.hp = Math.min(this.hp, this.maxHp);
    }

    save() { saveGame(this); }

    // Movimiento con teclado (AWSD / flechas). dirX/dirY en rango [-1,1].
    // isWalkable(x, y, radius) -> bool, para respetar las paredes de la mazmorra.
    move(dirX, dirY, dt, isWalkable) {
        if (!dirX && !dirY) return;
        const len = Math.hypot(dirX, dirY) || 1;
        const step = this.getEffectiveSpeed() * (dt / 16);
        const nx = this.x + (dirX / len) * step;
        const ny = this.y + (dirY / len) * step;

        // Mover en X e Y por separado para poder "deslizar" contra paredes.
        if (!isWalkable || isWalkable(nx, this.y, this.radius)) this.x = nx;
        if (!isWalkable || isWalkable(this.x, ny, this.radius)) this.y = ny;

        this.x = Math.max(this.radius, Math.min(WORLD_WIDTH - this.radius, this.x));
        this.y = Math.max(this.radius, Math.min(WORLD_HEIGHT - this.radius, this.y));
    }

    // Ticks pasivos (regeneración). Se pausa mientras haya un panel/combate abierto.
    tick(dt) {
        if (this.arrows < this.maxArrows) {
            this.arrowRegenTimer += dt;
            if (this.arrowRegenTimer > 1800) {
                this.arrowRegenTimer = 0;
                this.arrows++;
            }
        }

        // Regeneración de vida: 1 HP/seg por nivel (a nivel 600, 600 HP/seg).
        if (this.hp > 0 && this.hp < this.maxHp && Date.now() - this.lastDamageTime > 4000) {
            this.heal((dt / 1000) * this.level);
        }

        // Regeneración extra de alimentos (real-time, independiente del gate
        // de 4s sin recibir daño): se suma mientras el buff no haya expirado.
        if (this.regenBuffs.length) {
            const now = Date.now();
            this.regenBuffs = this.regenBuffs.filter(b => b.expiresAt > now);
            const extraHpPerMin = this.regenBuffs.reduce((s, b) => s + b.hpPerMin, 0);
            if (extraHpPerMin > 0 && this.hp > 0 && this.hp < this.maxHp) {
                this.heal((extraHpPerMin / 60000) * dt);
            }
        }

        this.levelUpFlashes = this.levelUpFlashes.filter(f => f.until > Date.now());
    }

    getActiveProfessionDef() {
        return getProfession(this.activeProfession);
    }

    getActiveLevel() {
        return this.level;
    }

    getEquippedCraftedItem(profId) {
        const itemId = this.equippedCraftedByProf[profId];
        if (!itemId) return null;
        return this.craftedItems.find(it => it.id === itemId) || null;
    }

    getCurrentWeapon() {
        const crafted = this.getEquippedCraftedItem(this.activeProfession);
        if (crafted) {
            const tier = TIERS.find(t => t.id === crafted.tierId);
            const rarity = getMonsterRarity(crafted.rarityId);
            return {
                professionId: this.activeProfession,
                name: `${getWeaponName(this.activeProfession, crafted.tierId)} (${rarity.name})`,
                emoji: tier.emoji,
                tier,
                rarity,
                damage: crafted.damage,
                range: getProfession(this.activeProfession).range || 55,
                craftedItemId: crafted.id,
            };
        }
        return getWeaponForLevel(this.activeProfession, this.getActiveLevel());
    }

    // Encantamientos activos del arma CRAFTEADA equipada (ver enchantments.js
    // y applyEnchant más abajo). El arma "automática" por nivel nunca tiene
    // Rareza propia, así que nunca se puede encantar.
    getActiveWeaponEnchants() {
        const item = this.getEquippedCraftedItem(this.activeProfession);
        if (!item || item.kind !== 'weapon' || !item.enchants) return [];
        return Object.keys(item.enchants)
            .map(id => ({ id, def: findEnchantment(id), level: item.enchants[id] }))
            .filter(e => e.def && e.level > 0);
    }

    // Suma los `effects` de TODOS los encantamientos activos del arma
    // equipada (cada nivel ya incluye la potencia total de ese nivel, no
    // son acumulativos entre niveles). Ver combat.js para cómo se consume.
    getActiveEnchantEffects() {
        const sums = {
            dmgBonusPercent: 0, ignoreDefensePercent: 0, critChanceBonus: 0, critMultiplier: 1,
            lifestealPercent: 0, onHitHeal: 0, onCritHeal: 0, apCostReduction: 0, paRestoreOnHit: 0,
            flatDefenseBonus: 0, damageReducePercent: 0, secondAttackBonusPercent: 0, bonusVsHigherHP: 0,
            counterChance: 0, counterDamagePercent: 0, counterIgnoreDefensePercent: 0,
            burns: [], bleeds: [], defenseDownOnHits: [], enemyDmgDownOnHits: [], chains: [], aoeAlls: [], extraAttacksList: [],
        };
        this.getActiveWeaponEnchants().forEach(({ def, level }) => {
            const eff = def.levels[level - 1].effects;
            if (eff.dmgBonusPercent) sums.dmgBonusPercent += eff.dmgBonusPercent;
            if (eff.ignoreDefensePercent) sums.ignoreDefensePercent += eff.ignoreDefensePercent;
            if (eff.critChanceBonus) sums.critChanceBonus += eff.critChanceBonus;
            if (eff.critMultiplier) sums.critMultiplier = Math.max(sums.critMultiplier, eff.critMultiplier);
            if (eff.lifestealPercent) sums.lifestealPercent += eff.lifestealPercent;
            if (eff.onHitHeal) sums.onHitHeal += eff.onHitHeal;
            if (eff.onCritHeal) sums.onCritHeal += eff.onCritHeal;
            if (eff.apCostReduction) sums.apCostReduction += eff.apCostReduction;
            if (eff.paRestoreOnHit) sums.paRestoreOnHit += eff.paRestoreOnHit;
            if (eff.flatDefenseBonus) sums.flatDefenseBonus += eff.flatDefenseBonus;
            if (eff.damageReducePercent) sums.damageReducePercent += eff.damageReducePercent;
            if (eff.secondAttackBonusPercent) sums.secondAttackBonusPercent += eff.secondAttackBonusPercent;
            if (eff.bonusVsHigherHP) sums.bonusVsHigherHP += eff.bonusVsHigherHP;
            if (eff.counterChance) {
                sums.counterChance += eff.counterChance;
                sums.counterDamagePercent = Math.max(sums.counterDamagePercent, eff.counterDamagePercent || 0);
                if (eff.counterIgnoreDefensePercent) sums.counterIgnoreDefensePercent = Math.max(sums.counterIgnoreDefensePercent, eff.counterIgnoreDefensePercent);
            }
            if (eff.burn) sums.burns.push(eff.burn);
            if (eff.bleed) sums.bleeds.push(eff.bleed);
            if (eff.defenseDownOnHit) sums.defenseDownOnHits.push(eff.defenseDownOnHit);
            if (eff.enemyDmgDownOnHit) sums.enemyDmgDownOnHits.push(eff.enemyDmgDownOnHit);
            if (eff.chain) sums.chains.push(eff.chain);
            if (eff.aoeAll) sums.aoeAlls.push(eff.aoeAll);
            if (eff.extraAttacks) sums.extraAttacksList.push(eff.extraAttacks);
        });
        return sums;
    }

    getArmorInfo() {
        const buffDefense = this.foodBuffs.filter(b => b.stat === 'defensa').reduce((s, b) => s + b.amount, 0);
        const enchantDefense = this.getActiveEnchantEffects().flatDefenseBonus;
        const crafted = this.getEquippedCraftedItem('armadura');
        const info = crafted
            ? { tier: TIERS.find(t => t.id === crafted.tierId), defense: crafted.defense + buffDefense + enchantDefense, rarity: getMonsterRarity(crafted.rarityId), craftedItemId: crafted.id }
            : { tier: getTierForLevel(this.level), defense: Math.round(this.level * 0.056 + getTierForLevel(this.level).id * 3) + buffDefense + enchantDefense };

        // Bono de armadura del Tanque: Resistencia (cargas activas, +10%
        // c/u, ver Combat.classCharge) + el escudo activo (armorBonusPercent
        // de los especiales por Tier, ver weapon-attacks.js). Multiplicativo
        // sobre la defensa ya calculada arriba.
        const armorBonusPercent = this.getTanqueArmorBonusPercent();
        if (armorBonusPercent) info.defense = Math.round(info.defense * (1 + armorBonusPercent) * 10) / 10;
        return info;
    }

    getTanqueArmorBonusPercent() {
        let bonus = 0;
        if (typeof Combat !== 'undefined' && Combat.classCharge && Combat.classCharge.prof === 'tanque') {
            bonus += Combat.classCharge.count * 0.10;
        }
        if (this.shield && this.shield.armorBonusPercent) bonus += this.shield.armorBonusPercent;
        return bonus;
    }

    // Daño entrante: primero lo absorbe el escudo activo (si hay), luego el
    // remanente (si sobra) pasa por takeDamage normal (armadura, reducción
    // de daño de encantamientos, etc.). Devuelve el daño REAL aplicado a la
    // vida (0 si el escudo absorbió todo el golpe).
    absorbDamage(amount) {
        if (!this.shield || this.shield.amount <= 0) return this.takeDamage(amount);
        const absorbed = Math.min(this.shield.amount, amount);
        this.shield.amount -= absorbed;
        if (this.shield.amount <= 0) this.shield = null; // escudo roto
        const remainder = amount - absorbed;
        return remainder > 0 ? this.takeDamage(remainder) : 0;
    }

    // Estadísticas efectivas: base + bonos temporales de alimentos activos
    // (ver foods.js / useFood). Usado para calcular el bono de daño por
    // estadística (getStatDamageBonus) en vez de this.stats directamente.
    getEffectiveStats() {
        const eff = { ...this.stats };
        this.foodBuffs.forEach(b => {
            if (eff[b.stat] !== undefined) eff[b.stat] += b.amount;
        });
        return eff;
    }

    getFoodPABonus() {
        return this.foodBuffs.filter(b => b.stat === 'pa').reduce((s, b) => s + b.amount, 0);
    }

    getFoodTurnRegen() {
        return this.foodBuffs.reduce((s, b) => s + (b.turnRegen || 0), 0);
    }

    // ----- CRAFTEO -----
    // Consume `getCraftMaterialCost(tierId)` del material de ese tier +
    // CRAFT_CORE_COST núcleos de la rareza elegida. La rareza del núcleo
    // determina la rareza (y el bono de fuerza) del objeto resultante.
    // Las armas (y herramientas) piden la mitad del costo en madera de ESE
    // tier y la otra mitad en mena del mismo tier; la armadura sigue
    // pidiendo solo mena.
    craftItem(profId, tierId, rarityId) {
        const isArmor = profId === 'armadura';
        const oreId = `mat_tier_${tierId}`;
        const woodId = `madera_tier_${tierId}`;
        const totalCost = getCraftMaterialCost(tierId);
        const woodCost = isArmor ? 0 : Math.round(totalCost / 2);
        const oreCost = totalCost - woodCost;
        const coreId = getNucleoId(rarityId, tierId);
        const haveOre = this.materials[oreId] || 0;
        const haveWood = this.materials[woodId] || 0;
        const haveCore = this.materials[coreId] || 0;
        if (haveOre < oreCost || (!isArmor && haveWood < woodCost) || haveCore < CRAFT_CORE_COST) return null;

        this.materials[oreId] -= oreCost;
        if (!isArmor) this.materials[woodId] -= woodCost;
        this.materials[coreId] -= CRAFT_CORE_COST;

        const prof = getProfession(profId);
        const tier = TIERS.find(t => t.id === tierId);
        const rarity = getMonsterRarity(rarityId);

        const item = {
            id: 'itm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            kind: isArmor ? 'armor' : 'weapon',
            profId, tierId, rarityId,
            createdAt: Date.now(),
        };
        if (isArmor) {
            item.defense = Math.round(tier.id * 4 * rarity.mult);
        } else {
            item.damage = Math.round(prof.baseDamage * tier.mult * rarity.mult * 10) / 10;
        }
        this.craftedItems.push(item);
        return item;
    }

    equipCraftedItem(itemId) {
        const item = this.craftedItems.find(it => it.id === itemId);
        if (!item) return;
        const prof = getProfession(item.profId);
        const isCombatWeapon = item.kind === 'weapon' && prof.id !== 'armadura' && prof.type !== 'gather';

        if (isCombatWeapon) {
            // Solo se puede llevar un arma de combate equipada a la vez: al
            // equipar una nueva, se desequipa cualquier otra automáticamente.
            PROFESSIONS.forEach(p => {
                if (p.type === 'combat' || p.type === 'combat_ranged' || p.type === 'combat_block') {
                    this.equippedCraftedByProf[p.id] = null;
                }
            });
            this.activeProfession = item.profId;
        }
        // La armadura y las herramientas de recolección se equipan en su
        // propio "casillero" (profId), sin afectar el arma de combate ni la
        // profesión activa.
        this.equippedCraftedByProf[item.profId] = item.id;
    }

    // ----- POCIONES -----
    // Craftea una poción de curación: consume POTION_HERB_COST de hierba del
    // tier elegido (costo fijo, no escala con el tier) + 1 núcleo de la
    // rareza elegida. La rareza del núcleo determina cuánto cura la poción.
    craftPotion(tierId, rarityId) {
        const matId = `hierba_tier_${tierId}`;
        const matCost = POTION_HERB_COST;
        const coreId = getNucleoId(rarityId, tierId);
        const haveMat = this.materials[matId] || 0;
        const haveCore = this.materials[coreId] || 0;
        if (haveMat < matCost || haveCore < CRAFT_CORE_COST) return null;

        this.materials[matId] -= matCost;
        this.materials[coreId] -= CRAFT_CORE_COST;
        this.gainMaterial(`pocion_${rarityId}`, 1);
        return { rarityId, healAmount: getPotionHealAmount(rarityId) };
    }

    // Consume 1 poción de esa rareza y cura al jugador. Devuelve la cantidad
    // curada real (0 si no tenía pociones).
    usePotion(rarityId) {
        const id = `pocion_${rarityId}`;
        if ((this.materials[id] || 0) <= 0) return 0;
        this.materials[id]--;
        const before = this.hp;
        this.heal(getPotionHealAmount(rarityId));
        return Math.round((this.hp - before) * 10) / 10;
    }

    unequipCrafted(profId) {
        this.equippedCraftedByProf[profId] = null;
    }

    // ----- MONTURAS (ver mounts.js) -----
    // Consume mena + madera del Tier de la montura (cantidad exacta, igual
    // que crafteo de armas/armadura) + núcleos de esa misma Rareza y Tier
    // (la Rareza del núcleo elegido determina el bono de velocidad extra).
    craftMount(tierId, rarityId) {
        const def = getMountDef(tierId);
        if (!def) return null;
        const cost = getMountCraftCost(tierId);
        const oreId = `mat_tier_${tierId}`;
        const woodId = `madera_tier_${tierId}`;
        const nucleoId = getNucleoId(rarityId, tierId);
        if ((this.materials[oreId] || 0) < cost.ore) return null;
        if ((this.materials[woodId] || 0) < cost.wood) return null;
        if ((this.materials[nucleoId] || 0) < cost.nucleo) return null;

        this.materials[oreId] -= cost.ore;
        this.materials[woodId] -= cost.wood;
        this.materials[nucleoId] -= cost.nucleo;

        const mount = {
            id: 'mnt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            tierId, rarityId,
            speedPercent: getMountSpeedPercent(tierId, rarityId),
            createdAt: Date.now(),
        };
        this.mounts.push(mount);
        return mount;
    }

    getEquippedMount() {
        return this.mounts.find(m => m.id === this.equippedMountId) || null;
    }

    // Solo se puede llevar 1 montura equipada a la vez.
    equipMount(mountId) {
        if (this.mounts.some(m => m.id === mountId)) this.equippedMountId = mountId;
    }

    unequipMount() {
        this.equippedMountId = null;
    }

    getEffectiveSpeed() {
        const mount = this.getEquippedMount();
        return this.baseSpeed * (1 + (mount ? mount.speedPercent : 0) / 100);
    }

    // ----- BANCO DE NÚCLEOS (craftear/descraftear rareza, mismo Tier) -----
    // Craftear: 10 núcleos de una rareza -> 1 núcleo de la rareza siguiente
    // (mismo Tier). No existe para Mítico (no hay rareza superior).
    craftNucleoUp(tierId, rarityId) {
        const idx = MONSTER_RARITIES.findIndex(r => r.id === rarityId);
        if (idx < 0 || idx >= MONSTER_RARITIES.length - 1) return null;
        const fromId = getNucleoId(rarityId, tierId);
        const toRarity = MONSTER_RARITIES[idx + 1];
        if ((this.materials[fromId] || 0) < 10) return null;
        this.materials[fromId] -= 10;
        this.gainMaterial(getNucleoId(toRarity.id, tierId), 1);
        return { fromRarityId: rarityId, toRarityId: toRarity.id, tierId };
    }

    // Descraftear: 1 núcleo de una rareza -> 10 núcleos de la rareza
    // anterior (mismo Tier). No existe para Común (no hay rareza inferior).
    craftNucleoDown(tierId, rarityId) {
        const idx = MONSTER_RARITIES.findIndex(r => r.id === rarityId);
        if (idx <= 0) return null;
        const fromId = getNucleoId(rarityId, tierId);
        const toRarity = MONSTER_RARITIES[idx - 1];
        if ((this.materials[fromId] || 0) < 1) return null;
        this.materials[fromId] -= 1;
        this.gainMaterial(getNucleoId(toRarity.id, tierId), 10);
        return { fromRarityId: rarityId, toRarityId: toRarity.id, tierId };
    }

    // ----- ALIMENTOS (ver foods.js) -----
    // Craftea 1 alimento: consume FOOD_CULTIVO_COST del cultivo de ese tier
    // (costo fijo, igual que las pociones) + 1 núcleo de la rareza elegida.
    // La rareza del núcleo determina la versión (y potencia) del alimento.
    craftFood(tierId, foodId, rarityId) {
        const matId = `cultivo_tier_${tierId}`;
        const matCost = FOOD_CULTIVO_COST;
        const coreId = getNucleoId(rarityId, tierId);
        const haveMat = this.materials[matId] || 0;
        const haveCore = this.materials[coreId] || 0;
        if (haveMat < matCost || haveCore < CRAFT_CORE_COST) return null;

        this.materials[matId] -= matCost;
        this.materials[coreId] -= CRAFT_CORE_COST;
        this.gainMaterial(`food_${foodId}__${rarityId}`, 1);
        return { foodId, rarityId };
    }

    // Consume 1 alimento de esa versión y aplica su buff. Los de "vida"
    // suben el máximo de HP (y curan esa cantidad) mientras estén activos;
    // los de "regen_time" son un buff de regeneración fuera de combate en
    // tiempo real; el resto (defensa/fuerza/destreza/inteligencia/pa) se
    // acumulan en foodBuffs y se descuentan combate a combate (ver
    // tickFoodBuffsOnCombatEnd, llamado desde Combat.finish).
    useFood(foodId, rarityId) {
        const key = `food_${foodId}__${rarityId}`;
        if ((this.materials[key] || 0) <= 0) return null;
        const def = getFoodDef(foodId);
        if (!def) return null;
        const version = def.food.versions[rarityId];
        if (!version) return null;
        this.materials[key]--;

        if (def.food.stat === 'regen_time') {
            this.regenBuffs.push({
                foodId, name: def.food.name, emoji: def.food.emoji,
                hpPerMin: version.amount, expiresAt: Date.now() + version.duration * 60000,
            });
        } else {
            this.foodBuffs.push({
                foodId, name: def.food.name, emoji: def.food.emoji, stat: def.food.stat,
                amount: version.amount, combatsLeft: version.duration, turnRegen: version.regen || 0,
            });
            if (def.food.stat === 'vida') {
                this.recalcMaxHp(); // sube maxHp con el nuevo buff antes de curar, para no perder el HP extra
                this.heal(version.amount);
            }
        }
        return { name: def.food.name, emoji: def.food.emoji, rarity: getMonsterRarity(rarityId) };
    }

    // Se llama una vez por combate resuelto (ver Combat.finish). Descuenta
    // 1 combate a cada buff activo; al llegar a 0, se retira (revirtiendo
    // el maxHp extra si era un buff de "vida").
    tickFoodBuffsOnCombatEnd() {
        let hadVidaBuff = false;
        this.foodBuffs = this.foodBuffs.filter(b => {
            b.combatsLeft--;
            if (b.combatsLeft > 0) return true;
            if (b.stat === 'vida') hadVidaBuff = true;
            return false;
        });
        if (hadVidaBuff) this.recalcMaxHp();
    }

    getDamage() {
        const weapon = this.getCurrentWeapon();
        const eff = this.getActiveEnchantEffects();
        const potencia = this.getEffectiveStats().potencia;
        let dmg = weapon.damage * (1 + potencia * STAT_POTENCIA_DMG_PERCENT) * (1 + eff.dmgBonusPercent);
        return Math.round(dmg * 10) / 10;
    }

    // ----- BANCO DE ENCANTAMIENTOS (ver enchantments.js) -----
    // Solo se pueden encantar armas CRAFTEADAS (tienen Rareza + Tier propios).
    getEnchantLevel(itemId, enchantId) {
        const item = this.craftedItems.find(it => it.id === itemId);
        return (item && item.enchants && item.enchants[enchantId]) || 0;
    }

    // Info del próximo nivel de `enchantId` para el arma `itemId`: costo en
    // núcleos (de la Rareza del arma) y null si ya está al máximo nivel.
    getEnchantUpgradeInfo(itemId, enchantId) {
        const item = this.craftedItems.find(it => it.id === itemId);
        if (!item || item.kind !== 'weapon') return null;
        const def = findEnchantment(enchantId);
        if (!def) return null;
        const currentLevel = (item.enchants && item.enchants[enchantId]) || 0;
        if (currentLevel >= def.maxLevel) return null;
        const nextLevel = currentLevel + 1;
        return { item, def, currentLevel, nextLevel, cost: getEnchantCost(item.rarityId, nextLevel), rarityId: item.rarityId, tierId: item.tierId };
    }

    // Núcleos que el jugador tiene, compatibles con un arma de esa Rareza y
    // Tier (misma Rareza, Tier igual o superior), agrupados por tier.
    getCompatibleNucleos(rarityId, tierId) {
        const result = [];
        for (let t = tierId; t <= TIERS.length; t++) {
            const qty = this.materials[getNucleoId(rarityId, t)] || 0;
            if (qty > 0) result.push({ tierId: t, qty });
        }
        return result;
    }

    // Sube `enchantId` en `itemId` un nivel, pagando el costo con núcleos
    // del tier elegido (debe ser >= al tier del arma, misma rareza).
    applyEnchant(itemId, enchantId, nucleoTierId) {
        const info = this.getEnchantUpgradeInfo(itemId, enchantId);
        if (!info || nucleoTierId < info.tierId) return null;
        const nucleoId = getNucleoId(info.rarityId, nucleoTierId);
        if ((this.materials[nucleoId] || 0) < info.cost) return null;

        this.materials[nucleoId] -= info.cost;
        if (!info.item.enchants) info.item.enchants = {};
        info.item.enchants[enchantId] = info.nextLevel;
        return { enchantId, level: info.nextLevel, cost: info.cost, nucleoTierId };
    }

    hasArrows() { return this.arrows > 0; }
    useArrow() { if (this.arrows > 0) this.arrows--; }

    gainMaterial(id, qty) {
        this.materials[id] = (this.materials[id] || 0) + qty;
        if (id === 'pergamino_teletransporte') {
            this.materials[id] = Math.min(this.materials[id], MAX_PERGAMINOS_TELETRANSPORTE);
        }
    }

    gainGold(amount) {
        this.gold += amount;
    }

    // ----- MERCADER DE LA TABERNA (ver shop.js) -----
    // Vende `qty` unidades de un material (núcleo/mena/madera/hierba/
    // cultivo) apilable: crea UN lote en merchantListings por la cantidad
    // total (no uno por unidad), consistente con "Vender Todo".
    sellMaterial(materialId, qty) {
        const have = this.materials[materialId] || 0;
        qty = Math.min(qty, have);
        if (qty <= 0 || !isMaterialSellable(materialId)) return null;
        const price = getMaterialUnitSellPrice(materialId) * qty;
        this.materials[materialId] -= qty;
        this.gold += price;
        const listing = {
            id: 'lst_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            type: 'material', materialId, qty, price, listedAt: Date.now(),
        };
        this.merchantListings.push(listing);
        return listing;
    }

    sellCraftedItem(itemId) {
        const idx = this.craftedItems.findIndex(it => it.id === itemId);
        if (idx === -1) return null;
        const item = this.craftedItems[idx];
        if (this.equippedCraftedByProf[item.profId] === item.id) this.equippedCraftedByProf[item.profId] = null;
        const price = getCraftedItemSellPrice(item);
        this.craftedItems.splice(idx, 1);
        this.gold += price;
        const listing = {
            id: 'lst_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            type: item.kind, item, price, listedAt: Date.now(),
        };
        this.merchantListings.push(listing);
        return listing;
    }

    sellMount(mountId) {
        const idx = this.mounts.findIndex(m => m.id === mountId);
        if (idx === -1) return null;
        const mount = this.mounts[idx];
        if (this.equippedMountId === mount.id) this.equippedMountId = null;
        const price = getMountSellPrice(mount);
        this.mounts.splice(idx, 1);
        this.gold += price;
        const listing = {
            id: 'lst_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            type: 'mount', item: mount, price, listedAt: Date.now(),
        };
        this.merchantListings.push(listing);
        return listing;
    }

    // Pergaminos: stock infinito, no vienen de merchantListings.
    buyScroll() {
        if ((this.materials.pergamino_teletransporte || 0) >= MAX_PERGAMINOS_TELETRANSPORTE) return false;
        if (this.gold < SHOP_SCROLL_PRICE) return false;
        this.gold -= SHOP_SCROLL_PRICE;
        this.gainMaterial('pergamino_teletransporte', 1);
        return true;
    }

    // Recompra un lote vendido (propio o de otra sesión, ver persistencia
    // en storage.js): devuelve exactamente lo que se vendió y borra el lote.
    buyListing(listingId) {
        const idx = this.merchantListings.findIndex(l => l.id === listingId);
        if (idx === -1) return false;
        const listing = this.merchantListings[idx];
        if (this.gold < listing.price) return false;
        this.gold -= listing.price;
        if (listing.type === 'material') {
            this.gainMaterial(listing.materialId, listing.qty);
        } else if (listing.type === 'weapon' || listing.type === 'armor') {
            this.craftedItems.push(listing.item);
        } else if (listing.type === 'mount') {
            this.mounts.push(listing.item);
        }
        this.merchantListings.splice(idx, 1);
        return true;
    }

    // XP unificada: un único nivel de jugador (no uno por arma). Cada level
    // up otorga STAT_POINTS_PER_LEVEL puntos de estadística para repartir,
    // +10 de vida máxima permanente, y cura al jugador al 100%.
    gainXP(amount) {
        if (this.level >= MAX_LEVEL) return;
        this.xp += amount;
        let leveledUp = false;
        while (this.level < MAX_LEVEL) {
            const required = getXPRequiredForLevel(this.level + 1);
            if (this.xp < required) break;
            this.xp -= required;
            this.level++;
            this.statPoints += STAT_POINTS_PER_LEVEL;
            leveledUp = true;
        }
        if (this.level >= MAX_LEVEL) this.xp = 0;
        if (leveledUp) {
            this.recalcMaxHp();
            this.hp = this.maxHp;
            this.levelUpFlashes.push({
                text: `⬆ Nivel ${this.level} (+${STAT_POINTS_PER_LEVEL} puntos de estadística)`,
                until: Date.now() + 2500,
            });
        }
    }

    addStatPoint(statId, amount) {
        if (!(statId in this.stats)) return;
        const n = Math.max(1, Math.min(amount || 1, this.statPoints));
        this.stats[statId] += n;
        this.statPoints -= n;
        if (statId === 'constitucion') this.recalcMaxHp();
    }

    removeStatPoint(statId, amount) {
        if (!(statId in this.stats)) return;
        const n = Math.max(1, Math.min(amount || 1, this.stats[statId]));
        this.stats[statId] -= n;
        this.statPoints += n;
        if (statId === 'constitucion') this.recalcMaxHp();
    }

    // El bloqueo/esquiva (probabilidad por Constitución/Agilidad, ver
    // constants.js) ya se resuelve ANTES de llamar a esto (ver
    // Combat.performEnemyAttack: orden Bloqueo -> Esquiva -> daño ->
    // Contraataque); `amount` ya viene reducido al 50% si bloqueó.
    takeDamage(amount) {
        let dmg = amount;
        const armor = this.getArmorInfo();
        dmg = Math.max(1, dmg - armor.defense * 0.15);

        // Reducción de daño de encantamientos (ej. Fortaleza Marcial,
        // Reparación Divina nivel 3 — ver enchantments.js).
        const damageReducePercent = this.getActiveEnchantEffects().damageReducePercent;
        if (damageReducePercent) dmg *= (1 - Math.min(0.9, damageReducePercent));

        dmg = Math.round(dmg * 10) / 10;
        this.hp = Math.max(0, this.hp - dmg);
        this.lastDamageTime = Date.now();

        this.gainXP(Math.max(1, Math.round(dmg * 0.5)));
        return dmg;
    }

    heal(amount) {
        this.hp = Math.min(this.maxHp, this.hp + amount);
    }

    // Equipa el arma "inicial" (automática por nivel) de una profesión de
    // combate. Igual que equipCraftedItem, desequipa cualquier arma
    // crafteada de OTRA profesión de combate: solo un arma puede estar
    // "equipada" (crafteada o no) a la vez (bug fix: antes esto no limpiaba
    // equippedCraftedByProf, dejando el arma crafteada anterior marcada
    // como equipada — mostraba "Quitar" — aunque ya no fuera la activa).
    setActiveProfession(id) {
        const prof = getProfession(id);
        if (!prof) return;
        if (prof.type === 'combat' || prof.type === 'combat_ranged' || prof.type === 'combat_block') {
            PROFESSIONS.forEach(p => {
                if (p.type === 'combat' || p.type === 'combat_ranged' || p.type === 'combat_block') {
                    this.equippedCraftedByProf[p.id] = null;
                }
            });
        }
        this.activeProfession = id;
    }
}
