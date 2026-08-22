// ===== CLASE PLAYER =====

class Player {
    constructor() {
        this.x = WORLD_WIDTH / 2;
        this.y = WORLD_HEIGHT / 2;
        // Reducido de 22 a 16 (ver isWalkableGrid en grid-dungeon.js: chequea
        // 4 puntos a `radius` del centro) para que quepa con margen por un
        // pasillo de 1 tile (TILE_SIZE=40px) — con 22 el jugador quedaba
        // trabado en huecos/pasajes angostos de las salas decoradas nuevas.
        // `radius` sigue siendo el usado para colisión/movimiento; el
        // círculo que se DIBUJA usa visualRadius (22, el tamaño de antes)
        // para no achicar al jugador en pantalla — ver drawPlayerEntity en
        // game.js.
        this.radius = 16;
        this.visualRadius = 22;
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

        this.craftedItems = []; // armas: {id, kind:'weapon', profId, tierId, rarityId, damage}; armaduras: {id, kind:'armor', slot, subtype, tierId, rarityId, defense, dmgBonusPercent, hpBonusPercent}
        this.equippedCraftedByProf = {}; // profId -> craftedItem.id (arma, o null = usar el arma automática por nivel)

        // Armadura (ver ARMOR_SLOTS en constants.js): 3 casilleros
        // independientes (casco/pechera/botas), cada uno con su propia
        // pieza crafteada (o null = ese casillero va vacío, sin bono — la
        // armadura "automática" de respaldo solo aplica si los 3 están
        // vacíos a la vez, ver getArmorInfo).
        this.equippedArmorBySlot = { casco: null, pechera: null, botas: null };

        // Monturas (ver mounts.js): solo 1 equipada a la vez.
        this.mounts = []; // [{id, tierId, rarityId, speedPercent, createdAt}]
        this.equippedMountId = null;

        // Buffs de alimentos del campesino (ver foods.js): antes duraban N
        // combates (turno a turno); en combate en tiempo real no hay un
        // límite de encuentro fijo, así que ahora expiran por tiempo real
        // (expiresAt), igual que regenBuffs — ver tick().
        this.foodBuffs = []; // [{foodId, name, emoji, stat, amount, expiresAt, turnRegen}]
        this.regenBuffs = []; // [{foodId, name, emoji, hpPerMin, expiresAt}]

        // Efectos de estado que le pueden aplicar los enemigos en combate
        // (ver Combat.performEnemyAttackRT): quemadura con tick real-time
        // (1/seg, ver tick()) y penalización de XP con vencimiento propio.
        this.burn = null;   // { dmg, expiresAt, lastTickAt }
        this.xpPenalty = 1;
        this.xpPenaltyUntil = 0;

        // Escudo del Tanque (Golpe de Escudo / especiales por tier, ver
        // weapon-attacks.js y combat.js): absorbe daño entrante antes de
        // tocar la vida real. amount = HP restantes por absorber, expiresAt
        // = cuándo vence (aunque no lo hayan roto antes). Los campos
        // opcionales (armorBonusPercent, enemyDmgReducePercent,
        // reflectPercent, burnAttacker, healPercentPerTurn,
        // blockBonusPercent, dodgeBonusChance) vienen de los especiales
        // únicos de cada Tier (Ataque 3). Nunca se persiste (combate-only,
        // como burn).
        this.shield = null;

        // Invisibilidad de Doble Sombra del Pícaro (ver
        // RT_SKILL3_ABILITIES.picaro/Combat.performEnemyAttackRT): mientras
        // dure, ningún enemigo lo ataca. Combate-only, no se persiste.
        this.invisibleUntil = 0;

        // Ralentización (ver Terremoto de las habilidades de jefe,
        // Combat.tickEarthquakes/BOSS_ABILITIES) — mismo formato que
        // Enemy.speedMod. Combate-only, no se persiste.
        this.slowMod = null; // { percent, expiresAt }

        this.levelUpFlashes = []; // {professionId, until}
        this._foodTurnRegenTickAt = 0; // ver getFoodTurnRegen/tick(): antes curaba 1 vez por turno, ahora 1 vez/seg

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
        // Las armaduras VIEJAS (1 sola pieza, profId 'armadura', sin
        // slot/subtype) también se descartan acá: son de un esquema
        // incompatible con el nuevo sistema de 3 piezas, no hay migración.
        if (Array.isArray(data.craftedItems)) {
            this.craftedItems = data.craftedItems.filter(it =>
                it.kind === 'armor'
                    ? (ARMOR_SLOTS.some(s => s.id === it.slot) && ARMOR_PIECE_VARIANTS[it.subtype])
                    : getProfession(it.profId)
            );
        }
        if (data.equippedCraftedByProf) {
            this.equippedCraftedByProf = {};
            Object.keys(data.equippedCraftedByProf).forEach(profId => {
                if (getProfession(profId)) this.equippedCraftedByProf[profId] = data.equippedCraftedByProf[profId];
            });
        }
        if (data.equippedArmorBySlot) {
            ARMOR_SLOTS.forEach(s => {
                const itemId = data.equippedArmorBySlot[s.id];
                if (itemId && this.craftedItems.some(it => it.id === itemId)) this.equippedArmorBySlot[s.id] = itemId;
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
        const baseMaxHp = 100 + this.level * 10 + this.stats.constitucion * STAT_CONSTITUCION_HP + foodVida;
        // Tanque: +10%/stack de "Gigante" mientras el Círculo del Gigante
        // (tecla "3") esté activo (ver RT_SKILL3_ABILITIES.tanque/
        // Combat.getTanqueGiantMaxHpBonusPercent) — multiplicador, no un
        // monto plano, para no romper la fórmula de vida base existente.
        const giantBonus = Combat.getTanqueGiantMaxHpBonusPercent(this.activeProfession);
        // Armadura: suma de %vida extra de las 3 piezas equipadas (ver
        // getArmorHpBonusPercent/ARMOR_PIECE_VARIANTS) — se combina de
        // forma ADITIVA con el bono de Gigante (no multiplicativa entre
        // sí), mismo criterio que el resto de bonos porcentuales del juego.
        const armorHpBonus = this.getArmorHpBonusPercent();
        this.maxHp = Math.round(baseMaxHp * (1 + giantBonus + armorHpBonus));
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
        const now = Date.now();

        if (this.arrows < this.maxArrows) {
            this.arrowRegenTimer += dt;
            if (this.arrowRegenTimer > 1800) {
                this.arrowRegenTimer = 0;
                this.arrows++;
            }
        }

        // Regeneración de vida: 1 HP/seg por nivel (a nivel 600, 600 HP/seg).
        if (this.hp > 0 && this.hp < this.maxHp && now - this.lastDamageTime > 4000) {
            this.heal((dt / 1000) * this.level);
        }

        // Regeneración extra de alimentos (real-time, independiente del gate
        // de 4s sin recibir daño): se suma mientras el buff no haya expirado.
        if (this.regenBuffs.length) {
            this.regenBuffs = this.regenBuffs.filter(b => b.expiresAt > now);
            const extraHpPerMin = this.regenBuffs.reduce((s, b) => s + b.hpPerMin, 0);
            if (extraHpPerMin > 0 && this.hp > 0 && this.hp < this.maxHp) {
                this.heal((extraHpPerMin / 60000) * dt);
            }
        }

        // Quemadura propia (ver Combat.performEnemyAttackRT): 1 tick/seg.
        if (this.burn) {
            if (now >= this.burn.expiresAt) {
                this.burn = null;
            } else if (now - this.burn.lastTickAt >= 1000) {
                this.burn.lastTickAt += 1000;
                this.takeDamage(this.burn.dmg);
            }
        }

        // Escudo del Tanque: vencimiento por tiempo real (antes por turnos)
        // + curación pasiva mientras esté activo (Bulwark Estelar+, 1 tick/seg).
        if (this.shield) {
            if (now >= this.shield.expiresAt) {
                this.shield = null;
            } else if (this.shield.healPercentPerTurn) {
                if (!this.shield.lastHealTickAt) this.shield.lastHealTickAt = now;
                if (now - this.shield.lastHealTickAt >= 1000) {
                    this.shield.lastHealTickAt += 1000;
                    this.heal(Math.round(this.maxHp * this.shield.healPercentPerTurn));
                }
            }
        }

        // Buffs de alimentos (antes "N combates", ahora vencen por tiempo real).
        if (this.foodBuffs.length) {
            const hadVidaBuff = this.foodBuffs.some(b => b.expiresAt <= now && b.stat === 'vida');
            this.foodBuffs = this.foodBuffs.filter(b => b.expiresAt > now);
            if (hadVidaBuff) this.recalcMaxHp();

            // Regeneración "por turno" de ciertos alimentos: antes curaba al
            // empezar el turno del jugador, ahora 1 vez por segundo real.
            const turnRegenTotal = this.getFoodTurnRegen();
            if (turnRegenTotal > 0 && this.hp > 0 && now - this._foodTurnRegenTickAt >= 1000) {
                this._foodTurnRegenTickAt = now;
                this.heal(turnRegenTotal);
            }
        }

        this.levelUpFlashes = this.levelUpFlashes.filter(f => f.until > now);
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

    // Pieza de armadura equipada en un casillero (o null si está vacío).
    getEquippedArmorPiece(slot) {
        const itemId = this.equippedArmorBySlot[slot];
        if (!itemId) return null;
        return this.craftedItems.find(it => it.id === itemId && it.kind === 'armor') || null;
    }

    getEquippedArmorPieces() {
        return ARMOR_SLOTS.map(s => this.getEquippedArmorPiece(s.id)).filter(Boolean);
    }

    // Suma de defensa de las 3 piezas equipadas (0 si un casillero está
    // vacío — sin relleno automático por casillero, ver getArmorInfo para
    // el único respaldo "automático" que existe: cuando los 3 están vacíos).
    getArmorInfo() {
        const buffDefense = this.foodBuffs.filter(b => b.stat === 'defensa').reduce((s, b) => s + b.amount, 0);
        const enchantDefense = this.getActiveEnchantEffects().flatDefenseBonus;
        const pieces = ARMOR_SLOTS.map(s => this.getEquippedArmorPiece(s.id));
        const anyEquipped = pieces.some(p => p);
        const baseDefense = anyEquipped
            ? pieces.reduce((sum, p) => sum + (p ? p.defense : 0), 0)
            : Math.round(this.level * 0.056 + getTierForLevel(this.level).id * 3);
        const info = { defense: baseDefense + buffDefense + enchantDefense, pieces };

        // Bono de armadura del Tanque: Resistencia (cargas activas, +10%
        // c/u, ver Combat.classCharge) + el escudo activo (armorBonusPercent
        // de los especiales por Tier, ver weapon-attacks.js). Multiplicativo
        // sobre la defensa ya calculada arriba.
        const armorBonusPercent = this.getTanqueArmorBonusPercent();
        if (armorBonusPercent) info.defense = Math.round(info.defense * (1 + armorBonusPercent) * 10) / 10;
        return info;
    }

    // % de daño extra otorgado por TODAS las piezas de armadura equipadas
    // (suma de cada pieza — ver ARMOR_PIECE_VARIANTS) — leído por el resto
    // de fórmulas de daño del jugador (ver Player.getDamage y la cadena
    // universal de bonos en combat.js).
    getArmorDamageBonusPercent() {
        return this.getEquippedArmorPieces().reduce((sum, it) => sum + (it.dmgBonusPercent || 0), 0);
    }

    // % de vida máxima extra otorgado por TODAS las piezas de armadura
    // equipadas — leído por recalcMaxHp.
    getArmorHpBonusPercent() {
        return this.getEquippedArmorPieces().reduce((sum, it) => sum + (it.hpBonusPercent || 0), 0);
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
    // Armas de combate (mago/guerrero/picaro/tanque/arquero/barbaro, ver
    // WEAPON_PIECE_TYPES): costo FIJO — WEAPON_CRAFT_ORE_COST (25) de mena
    // + WEAPON_CRAFT_WOOD_COST (25) de madera del tier + WEAPON_CRAFT_PIECE_COST
    // (5) piezas de esa MISMA profesión/rareza/tier (dropeadas por
    // enemigos, ver getWeaponPieceId/Combat.onEnemyDefeated) — mismo
    // criterio que craftArmorPiece, ya NO usa núcleos. Herramientas de
    // recolección (leñador/minero/campesino, sin pieza propia): SIN
    // cambios, siguen con el costo escalado por tier + 1 núcleo de la
    // rareza elegida (getCraftMaterialCost/CRAFT_CORE_COST).
    craftItem(profId, tierId, rarityId) {
        const oreId = `mat_tier_${tierId}`;
        const woodId = `madera_tier_${tierId}`;
        const isCombatWeapon = !!WEAPON_PIECE_TYPES[profId];

        if (isCombatWeapon) {
            const pieceId = getWeaponPieceId(profId, rarityId, tierId);
            if ((this.materials[oreId] || 0) < WEAPON_CRAFT_ORE_COST) return null;
            if ((this.materials[woodId] || 0) < WEAPON_CRAFT_WOOD_COST) return null;
            if ((this.materials[pieceId] || 0) < WEAPON_CRAFT_PIECE_COST) return null;
            this.materials[oreId] -= WEAPON_CRAFT_ORE_COST;
            this.materials[woodId] -= WEAPON_CRAFT_WOOD_COST;
            this.materials[pieceId] -= WEAPON_CRAFT_PIECE_COST;
        } else {
            const totalCost = getCraftMaterialCost(tierId);
            const woodCost = Math.round(totalCost / 2);
            const oreCost = totalCost - woodCost;
            const coreId = getNucleoId(rarityId, tierId);
            if ((this.materials[oreId] || 0) < oreCost) return null;
            if ((this.materials[woodId] || 0) < woodCost) return null;
            if ((this.materials[coreId] || 0) < CRAFT_CORE_COST) return null;
            this.materials[oreId] -= oreCost;
            this.materials[woodId] -= woodCost;
            this.materials[coreId] -= CRAFT_CORE_COST;
        }

        const prof = getProfession(profId);
        const tier = TIERS.find(t => t.id === tierId);
        const rarity = getMonsterRarity(rarityId);

        const item = {
            id: 'itm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            kind: 'weapon',
            profId, tierId, rarityId,
            damage: Math.round(prof.baseDamage * tier.mult * rarity.mult * 10) / 10,
            createdAt: Date.now(),
        };
        this.craftedItems.push(item);
        return item;
    }

    equipCraftedItem(itemId) {
        const item = this.craftedItems.find(it => it.id === itemId);
        if (!item || item.kind !== 'weapon') return;
        const prof = getProfession(item.profId);
        const isCombatWeapon = prof.type !== 'gather';

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
        // Las herramientas de recolección se equipan en su propio
        // "casillero" (profId), sin afectar el arma de combate ni la
        // profesión activa.
        this.equippedCraftedByProf[item.profId] = item.id;
    }

    // ----- ARMADURA (3 piezas: casco/pechera/botas, ver ARMOR_SLOTS) -----
    // Craftea 1 pieza de armadura terminada: consume ARMOR_CRAFT_ORE_COST
    // (30) del material del tier elegido + ARMOR_CRAFT_PIECE_COST (5)
    // piezas CRUDAS de esa MISMA variante/rareza/tier (dropeadas por
    // enemigos, ver getArmorPieceId/Combat.onEnemyDefeated) — costo FIJO,
    // no escala con tier/rareza como las armas. El jugador elige el
    // casillero (slot) al craftear.
    craftArmorPiece(slot, subtype, tierId, rarityId) {
        if (!ARMOR_SLOTS.some(s => s.id === slot)) return null;
        const stats = getArmorPieceStats(subtype, rarityId);
        if (!stats) return null;
        const oreId = `mat_tier_${tierId}`;
        const pieceId = getArmorPieceId(subtype, rarityId, tierId);
        if ((this.materials[oreId] || 0) < ARMOR_CRAFT_ORE_COST) return null;
        if ((this.materials[pieceId] || 0) < ARMOR_CRAFT_PIECE_COST) return null;

        this.materials[oreId] -= ARMOR_CRAFT_ORE_COST;
        this.materials[pieceId] -= ARMOR_CRAFT_PIECE_COST;

        const item = {
            id: 'itm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            kind: 'armor', slot, subtype, tierId, rarityId,
            defense: stats.defense, dmgBonusPercent: stats.dmgBonusPercent, hpBonusPercent: stats.hpBonusPercent,
            createdAt: Date.now(),
        };
        this.craftedItems.push(item);
        return item;
    }

    // Nivel mínimo requerido (ver getArmorEquipMinLevel) — no permite
    // equipar una pieza demasiado avanzada para el nivel actual.
    equipArmorPiece(itemId) {
        const item = this.craftedItems.find(it => it.id === itemId && it.kind === 'armor');
        if (!item) return false;
        if (this.level < getArmorEquipMinLevel(item.tierId, item.rarityId)) return false;
        this.equippedArmorBySlot[item.slot] = item.id;
        this.recalcMaxHp();
        return true;
    }

    unequipArmorSlot(slot) {
        if (!(slot in this.equippedArmorBySlot)) return;
        this.equippedArmorBySlot[slot] = null;
        this.recalcMaxHp();
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
        // Pícaro/Arquero: +velocidad% por stack de su habilidad toggle
        // activa (ver RT_TOGGLE_SKILLS.speedPctPerStack/speedPctMax en
        // constants.js) — 0 si no aplica. Arquero: +20% temporal al lanzar
        // Retirada Certera (ver RT_SKILL1_ABILITIES.arquero/
        // Combat.getSkill1SpeedBonusPercent) — 0 si no aplica.
        const skillSpeedBonus = Combat.getSkill2SpeedBonusPercent(this.activeProfession) + Combat.getSkill1SpeedBonusPercent(this.activeProfession);
        const slowPenalty = (this.slowMod && Date.now() < this.slowMod.expiresAt) ? this.slowMod.percent : 0;
        return this.baseSpeed * (1 + (mount ? mount.speedPercent : 0) / 100) * (1 + skillSpeedBonus) * (1 - slowPenalty);
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
    // los de "regen_time" son un buff de regeneración en tiempo real; el
    // resto (defensa/fuerza/destreza/inteligencia/pa) se acumulan en
    // foodBuffs. `version.duration` era "N combates" en el viejo sistema
    // por turnos; ahora que no hay un límite de encuentro fijo se traduce a
    // minutos reales (ver FOOD_BUFF_MINUTES_PER_UNIT), y expiran solos en
    // tick() como cualquier otro buff temporal. No se acumula el mismo
    // alimento: si ya hay uno activo, solo se puede reemplazar por una
    // versión de efecto ESTRICTAMENTE mayor (ni siquiera se consume si no lo
    // es). Máximo FOOD_BUFF_MAX_ACTIVE alimentos DISTINTOS activos a la vez
    // (entre foodBuffs y regenBuffs); al comerse uno nuevo que supere el
    // límite, se descarta el efecto más viejo (el primero que se comió).
    useFood(foodId, rarityId) {
        const key = `food_${foodId}__${rarityId}`;
        if ((this.materials[key] || 0) <= 0) return null;
        const def = getFoodDef(foodId);
        if (!def) return null;
        const version = def.food.versions[rarityId];
        if (!version) return null;

        const isRegen = def.food.stat === 'regen_time';
        const targetArray = isRegen ? this.regenBuffs : this.foodBuffs;
        const strengthOf = b => isRegen ? b.hpPerMin : b.amount;

        const existingIdx = targetArray.findIndex(b => b.foodId === foodId);
        if (existingIdx >= 0) {
            if (version.amount <= strengthOf(targetArray[existingIdx])) return null;
            const removed = targetArray.splice(existingIdx, 1)[0];
            if (removed.stat === 'vida') this.recalcMaxHp();
        } else if (this.foodBuffs.length + this.regenBuffs.length >= FOOD_BUFF_MAX_ACTIVE) {
            this.evictOldestFoodEffect();
        }

        this.materials[key]--;

        if (isRegen) {
            this.regenBuffs.push({
                foodId, name: def.food.name, emoji: def.food.emoji,
                hpPerMin: version.amount, expiresAt: Date.now() + version.duration * 60000,
                acquiredAt: Date.now(),
            });
        } else {
            this.foodBuffs.push({
                foodId, name: def.food.name, emoji: def.food.emoji, stat: def.food.stat,
                amount: version.amount, expiresAt: Date.now() + version.duration * FOOD_BUFF_MINUTES_PER_UNIT * 60000, turnRegen: version.regen || 0,
                acquiredAt: Date.now(),
            });
            if (def.food.stat === 'vida') {
                this.recalcMaxHp(); // sube maxHp con el nuevo buff antes de curar, para no perder el HP extra
                this.heal(version.amount);
            }
        }
        return { name: def.food.name, emoji: def.food.emoji, rarity: getMonsterRarity(rarityId) };
    }

    // Descarta el efecto de alimento más viejo (menor acquiredAt) entre
    // foodBuffs y regenBuffs combinados — ver useFood, límite de
    // FOOD_BUFF_MAX_ACTIVE activos. Las entradas de guardados viejos sin
    // acquiredAt (previas a este límite) se tratan como las más viejas.
    evictOldestFoodEffect() {
        let oldest = null, oldestArr = null, oldestIdx = -1;
        const consider = (arr) => arr.forEach((b, i) => {
            const at = b.acquiredAt || 0;
            if (!oldest || at < (oldest.acquiredAt || 0)) { oldest = b; oldestArr = arr; oldestIdx = i; }
        });
        consider(this.foodBuffs);
        consider(this.regenBuffs);
        if (!oldestArr) return;
        const removed = oldestArr.splice(oldestIdx, 1)[0];
        if (removed.stat === 'vida') this.recalcMaxHp();
    }

    getDamage() {
        const weapon = this.getCurrentWeapon();
        const eff = this.getActiveEnchantEffects();
        const potencia = this.getEffectiveStats().potencia;
        let dmg = weapon.damage * (1 + potencia * STAT_POTENCIA_DMG_PERCENT) * (1 + eff.dmgBonusPercent);
        dmg *= (1 + this.getArmorDamageBonusPercent());
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
        if (id === 'pergamino_guia') {
            this.materials[id] = Math.min(this.materials[id], MAX_PERGAMINOS_GUIA);
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
        if (item.kind === 'armor') {
            if (this.equippedArmorBySlot[item.slot] === item.id) {
                this.equippedArmorBySlot[item.slot] = null;
                this.recalcMaxHp();
            }
        } else if (this.equippedCraftedByProf[item.profId] === item.id) {
            this.equippedCraftedByProf[item.profId] = null;
        }
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

    buyGuiaScroll() {
        if ((this.materials.pergamino_guia || 0) >= MAX_PERGAMINOS_GUIA) return false;
        if (this.gold < SHOP_GUIA_SCROLL_PRICE) return false;
        this.gold -= SHOP_GUIA_SCROLL_PRICE;
        this.gainMaterial('pergamino_guia', 1);
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
        // Tanque: +mitigación% por stack de su habilidad toggle activa (ver
        // RT_TOGGLE_SKILLS.defPctPerStack/defPctMax en constants.js) — 0 si
        // no aplica; multiplica la defensa EFECTIVA usada en la reducción.
        // Tanque: +50% de mitigación mientras esté parado dentro de su
        // propio Bastión (ver RT_SKILL1_ABILITIES.tanque/
        // Combat.getPlayerZoneDefenseBonusPercent) — 0 si no aplica.
        // Tanque: +3%/stack de "Gigante" del Círculo del Gigante (tecla "3",
        // ver RT_SKILL3_ABILITIES.tanque/Combat.getTanqueGiantDefenseBonusPercent)
        // — mismo mecanismo que defPctPerStack, se suma a los demás bonos.
        const skillDefBonus = Combat.getSkill2DefenseBonusPercent(this.activeProfession) + Combat.getPlayerZoneDefenseBonusPercent() + Combat.getTanqueGiantDefenseBonusPercent(this.activeProfession);
        dmg = Math.max(1, dmg - armor.defense * (1 + skillDefBonus) * 0.15);

        // Reducción de daño de encantamientos (ej. Fortaleza Marcial,
        // Reparación Divina nivel 3 — ver enchantments.js). El Círculo del
        // Gigante del Tanque (tecla "3") suma su -30% acá también: es una
        // reducción DIRECTA sobre el daño final, no un bono de mitigación
        // de armadura (ver RT_SKILL3_ABILITIES.tanque.damageReducePercent).
        const damageReducePercent = this.getActiveEnchantEffects().damageReducePercent + Combat.getSkill3TanqueDamageReducePercent(this.activeProfession);
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
