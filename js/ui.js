// ===== INTERFAZ DE USUARIO (HUD + PANELES) =====

// HTML con el daño (y costo) de cada ataque del arma de ese tier, para
// mostrarlo en el inventario junto al arma equipada. `mult` aplica el bono
// de rareza de un objeto crafteado (1 = sin bono, arma automática por nivel).
function buildAttacksHTML(profId, tierId, mult) {
    const base = getWeaponAttacksForTier(profId, tierId);
    if (base) {
        const real = scaleAttacksByMult(base, mult || 1);
        return [...real.basic, real.special].map((atk, idx) => {
            const isSpecial = idx === 2;
            let dmgLabel = `${atk.damage} dmg`;
            if (atk.hits) dmgLabel = `${atk.damage} dmg x${atk.hits}`;
            if (atk.aoe) dmgLabel += ' (AoE)';
            let costLabel = `${atk.apCost} PA`;
            if (isSpecial) costLabel += ` · Carga ${atk.chargeRequired}`;
            return `<div class="atk-line">${atk.emoji} <b>${atk.name}</b> — ${dmgLabel} · ${costLabel}</div>`;
        }).join('');
    }
    const fallback = getAttacksForProfession(profId);
    if (!fallback.length) return '';
    return fallback.map(atk => `<div class="atk-line">${atk.emoji} <b>${atk.name}</b> — ${atk.desc || 'Por definir'}</div>`).join('');
}

const UI = {
    els: {},

    init() {
        this.els.profEmoji = document.getElementById('hud-prof-emoji');
        this.els.profName = document.getElementById('hud-prof-name');
        this.els.profLevel = document.getElementById('hud-prof-level');
        this.els.xpFill = document.getElementById('hud-xp-fill');
        this.els.xpText = document.getElementById('hud-xp-text');
        this.els.hpFill = document.getElementById('hud-hp-fill');
        this.els.hpText = document.getElementById('hud-hp-text');
        this.els.weapon = document.getElementById('hud-weapon');
        this.els.enchant = document.getElementById('hud-enchant');
        this.els.arrows = document.getElementById('hud-arrows');
        this.els.toastContainer = document.getElementById('level-up-toast-container');
        this.els.gameOver = document.getElementById('game-over');
        this.els.floorNumber = document.getElementById('floor-number');
        this.els.floorEnemyCount = document.getElementById('floor-enemy-count');
        this.els.floorBossIcon = document.getElementById('floor-boss-icon');

        this.els.inventoryPanel = document.getElementById('inventory-panel');
        this.els.enchantPanel = document.getElementById('enchant-panel');

        document.querySelectorAll('[data-close]').forEach(btn => {
            btn.addEventListener('click', () => this.hidePanel(btn.dataset.close));
        });

        document.getElementById('combat-endturn-btn').addEventListener('click', () => Combat.playerEndTurn());
        document.getElementById('victory-continue-btn').addEventListener('click', () => this.triggerVictoryContinue());

        // Menú (tecla ESC sin ninguna otra ventana abierta, ver game.js):
        // por ahora un solo item, acceso directo a la Guía.
        document.getElementById('menu-guide-btn').addEventListener('click', () => {
            this.hideMenuPanel();
            this.renderGuide();
            this.togglePanel('guide-panel');
        });

        // Ventana de Teletransporte al Jefe Final (ver notificación en el HUD).
        document.getElementById('boss-teleport-confirm-btn').addEventListener('click', () => {
            if (this.onConfirmBossTeleport) this.onConfirmBossTeleport();
        });
        document.getElementById('boss-teleport-cancel-btn').addEventListener('click', () => this.hideBossTeleportPanel());
    },

    isVictoryPanelVisible() {
        const panel = document.getElementById('victory-panel');
        return !!panel && !panel.classList.contains('hidden');
    },

    // Acción de "Continuar" de la ventana de Victoria: compartida por el
    // click del botón y por la tecla Espacio (ver game.js). El propio
    // ocultamiento del panel funciona como debounce — una vez oculto, una
    // segunda pulsación de Espacio ya no encuentra el panel visible.
    triggerVictoryContinue() {
        if (!this.isVictoryPanelVisible()) return;
        const btn = document.getElementById('victory-continue-btn');
        btn.classList.add('key-pressed');
        setTimeout(() => btn.classList.remove('key-pressed'), 150);
        this.hideVictoryPanel();
        Combat.finish('victory');
    },

    hidePanel(id) {
        document.getElementById(id).classList.add('hidden');
    },

    togglePanel(id) {
        const el = document.getElementById(id);
        const willShow = el.classList.contains('hidden');
        ['inventory-panel', 'enchant-panel', 'map-panel', 'craft-panel', 'stats-panel', 'guide-panel', 'floors-panel'].forEach(p => document.getElementById(p).classList.add('hidden'));
        if (willShow) el.classList.remove('hidden');
    },

    updateHUD(player) {
        const prof = player.getActiveProfessionDef();
        this.els.profEmoji.textContent = prof.emoji;
        this.els.profName.textContent = prof.name;
        this.els.profLevel.textContent = `LVL ${player.level}${player.level >= MAX_LEVEL ? ' (MAX)' : ''}`;

        const xpRequired = player.level >= MAX_LEVEL ? 0 : getXPRequiredForLevel(player.level + 1);
        const xpPct = player.level >= MAX_LEVEL ? 100 : (player.xp / xpRequired) * 100;
        this.els.xpFill.style.width = xpPct + '%';
        this.els.xpText.textContent = player.level >= MAX_LEVEL ? 'MAX' : `${Math.floor(player.xp)}/${xpRequired}`;

        const hpPct = (player.hp / player.maxHp) * 100;
        this.els.hpFill.style.width = hpPct + '%';
        this.els.hpText.textContent = `${Math.round(player.hp)}/${player.maxHp}`;

        if (prof.type === 'passive') {
            this.els.weapon.textContent = `🛡️ ${getWeaponName('armadura', player.getArmorInfo().tier.id)}`;
        } else if (prof.baseDamage > 0 || prof.type === 'combat_block') {
            const w = player.getCurrentWeapon();
            this.els.weapon.textContent = `${w.emoji} ${w.name} (⚔ ${player.getDamage()})`;
        } else {
            this.els.weapon.textContent = `${prof.emoji} ${prof.weaponLabel}`;
        }

        const activeEnchants = player.getActiveWeaponEnchants();
        this.els.enchant.textContent = activeEnchants.length
            ? activeEnchants.map(e => `${e.def.emoji}${e.level}`).join(' ')
            : '';

        if (player.activeProfession === 'arquero') {
            this.els.arrows.classList.remove('hidden');
            this.els.arrows.textContent = `🏹 ${player.arrows}/${player.maxArrows}`;
        } else {
            this.els.arrows.classList.add('hidden');
        }
    },

    showLevelToasts(player) {
        player.levelUpFlashes.forEach(f => {
            if (f.shown) return;
            f.shown = true;
            const div = document.createElement('div');
            div.className = 'level-toast';
            div.textContent = `⬆ ${f.text}`;
            this.els.toastContainer.appendChild(div);
            setTimeout(() => div.remove(), 2500);
        });
    },

    // Texto de HUD mientras el jugador está parado dentro de una Zona de
    // Spawn (ver findPlayerSpawnZone en game.js). `info` es null si no está
    // en ninguna.
    updateSpawnZoneHUD(info) {
        const el = document.getElementById('spawn-zone-hud');
        if (!info) {
            el.classList.add('hidden');
            return;
        }
        el.classList.remove('hidden');
        el.classList.toggle('spawn-zone-hud-player', !!info.isPlayerZone);
        el.textContent = info.isPlayerZone
            ? `☢️ Zona de Alteración: ${info.enemiesLeft} enemigos, ${info.minutesLeft} minutos restantes`
            : `🌀 Zona de Spawn: ${info.enemiesLeft} enemigos restantes · ${info.minutesLeft} min`;
    },

    updateFloorHUD(floor, aliveEnemyCount, finalBossAlive) {
        const biomeNameEl = document.getElementById('floor-biome-name');
        if (floor === null) {
            // Taberna (ver SISTEMA DE TABERNA en game.js): no es un piso
            // numerado, no muestra "N/1000".
            this.els.floorNumber.textContent = 'TABERNA';
            if (biomeNameEl) { biomeNameEl.textContent = TABERNA_THEME.bioma; biomeNameEl.dataset.floor = 'taberna'; }
        } else {
            this.els.floorNumber.textContent = `${floor}/${MAX_FLOOR}`;
            if (biomeNameEl && biomeNameEl.dataset.floor !== String(floor)) {
                biomeNameEl.textContent = getBiomeForFloor(floor).bioma;
                biomeNameEl.dataset.floor = String(floor);
            }
        }
        this.els.floorEnemyCount.textContent = aliveEnemyCount;
        this.els.floorBossIcon.classList.toggle('hidden', !finalBossAlive);
    },

    // Contador del Jefe Final (esquina superior derecha, ver
    // FINAL_BOSS_* en constants.js): oculto en la Taberna. Antes de
    // llegar a 100/100 muestra el puntaje crudo; a partir de ahí muestra
    // el % de probabilidad de aparición (ver getFinalBossSpawnChancePercent),
    // y mientras está vivo muestra un estado propio en vez del contador.
    updateBossCounter(player, inTaberna, finalBossAlive) {
        const el = document.getElementById('boss-counter');
        if (!el) return;
        if (inTaberna) { el.classList.add('hidden'); return; }
        el.classList.remove('hidden');

        if (finalBossAlive) {
            el.textContent = '👑 ¡Jefe Final Activo!';
            el.className = 'boss-counter boss-counter-active';
            return;
        }

        const points = player.finalBossPoints;
        if (points < FINAL_BOSS_POINTS_TARGET) {
            el.textContent = `⚔️ ${points}/${FINAL_BOSS_POINTS_TARGET}`;
            el.className = 'boss-counter boss-counter-charging';
        } else {
            const percent = getFinalBossSpawnChancePercent(player.bossHuntKills);
            el.textContent = `⚔️ ${FINAL_BOSS_POINTS_TARGET}/${FINAL_BOSS_POINTS_TARGET} - ${percent}%`;
            el.className = 'boss-counter boss-counter-primed';
        }
    },

    // Contador de Zonas de Alteración activas (ver SISTEMA DE ZONAS DE
    // JUGADOR en game.js): oculto en la Taberna.
    updateAlteracionCounter(count, max, inTaberna) {
        const el = document.getElementById('alteracion-counter');
        if (!el) return;
        el.classList.toggle('hidden', !!inTaberna);
        el.textContent = `☢️ ${count}/${max}`;
    },

    // Notificación del Jefe Final activo (ver player.finalBossFloor en
    // player.js): visible en CUALQUIER piso mientras haya uno activo en
    // algún lado (no solo el actual) — a diferencia de boss-counter/
    // alteracion-counter, NO se oculta en la Taberna, solo deja de ser
    // clickeable (ver el listener en game.js/bindInput).
    updateFinalBossNotification(player, inTaberna) {
        const el = document.getElementById('final-boss-notification');
        if (!el) return;
        if (player.finalBossFloor === null) {
            el.classList.add('hidden');
            return;
        }
        el.classList.remove('hidden');
        el.classList.toggle('final-boss-notification-disabled', !!inTaberna);
        el.textContent = `👑 ¡Jefe Final Activo! - Piso ${player.finalBossFloor}`;
        el.title = inTaberna ? '' : 'Click para teletransportarte';
    },

    // Ventana de Teletransporte al Jefe Final (click en la notificación).
    showBossTeleportPanel(player) {
        const floor = player.finalBossFloor;
        if (floor === null) { this.hideBossTeleportPanel(); return; }

        const unlocked = floor <= player.maxFloorReached;
        const scrollCount = player.materials.pergamino_teletransporte || 0;
        const hasScroll = scrollCount >= 1;
        const tierId = getMaterialTierForFloor(floor);
        const tier = TIERS.find(t => t.id === tierId);

        document.getElementById('boss-teleport-info').innerHTML = `
            <div class="boss-teleport-row">
                <div class="item-emoji">👑</div>
                <div class="item-info">
                    <div class="item-name">Jefe Final</div>
                    <div class="item-sub">Ubicación: Piso ${floor}</div>
                </div>
            </div>
            <div class="boss-teleport-details">
                <div>Tier ${tier.id} (${tier.name}) del Piso ${floor}</div>
                <div>Tienes: ${scrollCount}/${MAX_PERGAMINOS_TELETRANSPORTE} Pergaminos de Teletransportación 📜</div>
                <div>Estado: <span class="boss-teleport-state-active">Activo</span></div>
                <div class="panel-note">Se teletransportará directamente al jefe final. Costo: 1x Pergamino de Teletransportación 📜</div>
            </div>
        `;

        const warnings = [];
        if (!unlocked) warnings.push(`❌ Piso no desbloqueado — Todavía no has visitado este piso. Debes llegar al Piso ${floor} primero.`);
        if (!hasScroll) warnings.push('❌ Pergaminos insuficientes — Necesitás 1 Pergamino de Teletransportación. No tenés.');

        const warnEl = document.getElementById('boss-teleport-warning');
        if (warnings.length) {
            warnEl.classList.remove('hidden');
            warnEl.innerHTML = warnings.map(w => `<div>${w}</div>`).join('');
        } else {
            warnEl.classList.add('hidden');
            warnEl.innerHTML = '';
        }

        document.getElementById('boss-teleport-confirm-btn').disabled = !(unlocked && hasScroll);
        document.getElementById('boss-teleport-panel').classList.remove('hidden');
    },

    hideBossTeleportPanel() {
        document.getElementById('boss-teleport-panel').classList.add('hidden');
    },

    showLevelToastText(text) {
        const div = document.createElement('div');
        div.className = 'level-toast';
        div.textContent = text;
        this.els.toastContainer.appendChild(div);
        setTimeout(() => div.remove(), 2500);
    },

    showGameOver(show) {
        this.els.gameOver.classList.toggle('hidden', !show);
    },

    renderInventory(player) {
        const list = document.getElementById('inventory-list');
        list.innerHTML = '';

        // ----- EQUIPADO (arma activa + armadura, siempre puesta) -----
        const equippedSection = document.createElement('div');
        equippedSection.className = 'inv-section';
        const equippedTitle = document.createElement('div');
        equippedTitle.className = 'inv-section-title';
        equippedTitle.textContent = '⚔️ Equipado';
        equippedSection.appendChild(equippedTitle);

        const activeProf = player.getActiveProfessionDef();
        const craftedWeapon = player.getEquippedCraftedItem(activeProf.id);
        const weaponTier = craftedWeapon ? TIERS.find(t => t.id === craftedWeapon.tierId) : getTierForLevel(player.level);
        const weaponRarity = craftedWeapon ? getMonsterRarity(craftedWeapon.rarityId) : null;
        const weaponDiv = document.createElement('div');
        weaponDiv.className = 'inv-item active';
        const attacksHTML = buildAttacksHTML(activeProf.id, weaponTier.id, weaponRarity ? weaponRarity.mult : 1);
        weaponDiv.innerHTML = `
            <div class="item-emoji">${activeProf.emoji}</div>
            <div class="item-info">
                <div class="item-name"${weaponRarity ? ` style="color:${weaponRarity.color}"` : ''}>${getWeaponName(activeProf.id, weaponTier.id)} · Tier ${weaponTier.id}${weaponRarity ? ` · ${getRarityEmoji(weaponRarity.id)}` : ''}</div>
                <div class="item-sub">${activeProf.emoji} ${activeProf.name} · Nivel ${player.level} · Tier ${weaponTier.id} ${weaponTier.name}${craftedWeapon ? ' · Crafteado' : ''}</div>
                ${attacksHTML ? `<div class="item-attacks">${attacksHTML}</div>` : ''}
            </div>
            <span class="passive-tag">Arma equipada</span>
        `;
        equippedSection.appendChild(weaponDiv);

        const armorInfo = player.getArmorInfo();
        const craftedArmor = player.getEquippedCraftedItem('armadura');
        const armorTier = craftedArmor ? TIERS.find(t => t.id === craftedArmor.tierId) : getTierForLevel(player.level);
        const armorRarity = craftedArmor ? getMonsterRarity(craftedArmor.rarityId) : null;
        const armorDiv = document.createElement('div');
        armorDiv.className = 'inv-item active';
        armorDiv.innerHTML = `
            <div class="item-emoji">🛡️</div>
            <div class="item-info">
                <div class="item-name"${armorRarity ? ` style="color:${armorRarity.color}"` : ''}>${getWeaponName('armadura', armorTier.id)} · Tier ${armorTier.id}${armorRarity ? ` · ${getRarityEmoji(armorRarity.id)}` : ''}</div>
                <div class="item-sub">🛡️ ARMADURA · Nivel ${player.level} · DEF ${armorInfo.defense}${craftedArmor ? ' · Crafteado' : ''}</div>
            </div>
            <span class="passive-tag">Armadura equipada</span>
        `;
        equippedSection.appendChild(armorDiv);
        list.appendChild(equippedSection);

        // ----- BUFFS ACTIVOS (alimentos del campesino, ver foods.js) -----
        if (player.foodBuffs.length || player.regenBuffs.length) {
            const buffsSection = document.createElement('div');
            buffsSection.className = 'inv-section';
            const buffsTitle = document.createElement('div');
            buffsTitle.className = 'inv-section-title';
            buffsTitle.textContent = '🍽️ Buffs Activos';
            buffsSection.appendChild(buffsTitle);

            player.foodBuffs.forEach(b => {
                const label = FOOD_STAT_LABELS[b.stat];
                const div = document.createElement('div');
                div.className = 'inv-item';
                div.innerHTML = `
                    <div class="item-emoji">${b.emoji}</div>
                    <div class="item-info">
                        <div class="item-name">${b.name}</div>
                        <div class="item-sub">+${b.amount} ${label.icon} ${label.name}${b.turnRegen ? ` · +${b.turnRegen} HP/turno` : ''} · ${b.combatsLeft} combate${b.combatsLeft === 1 ? '' : 's'} restante${b.combatsLeft === 1 ? '' : 's'}</div>
                    </div>
                `;
                buffsSection.appendChild(div);
            });
            player.regenBuffs.forEach(b => {
                const minsLeft = Math.max(0, Math.ceil((b.expiresAt - Date.now()) / 60000));
                const div = document.createElement('div');
                div.className = 'inv-item';
                div.innerHTML = `
                    <div class="item-emoji">${b.emoji}</div>
                    <div class="item-info">
                        <div class="item-name">${b.name}</div>
                        <div class="item-sub">💚 +${b.hpPerMin} HP/min · ${minsLeft} min restante${minsLeft === 1 ? '' : 's'}</div>
                    </div>
                `;
                buffsSection.appendChild(div);
            });
            list.appendChild(buffsSection);
        }

        // ----- BOLSO (recursos + armas/armaduras no equipadas) -----
        const bagSection = document.createElement('div');
        bagSection.className = 'inv-section';
        const bagTitle = document.createElement('div');
        bagTitle.className = 'inv-section-title';
        bagTitle.textContent = '🎒 Bolso';
        bagSection.appendChild(bagTitle);

        // Oro: moneda ganada al derrotar enemigos (ver getEnemyGoldReward en
        // constants.js). Se muestra abreviado (K/M, ver formatGold) y al
        // hacer click abre un panel con el valor exacto (ver formatGoldExact).
        const goldGrid = document.createElement('div');
        goldGrid.className = 'resource-grid';
        goldGrid.innerHTML = `
            <div class="resource-chip resource-chip-gold" id="inv-gold-chip" data-open-gold="1" title="Ver valor exacto">
                <span class="resource-emoji">🪙</span><span class="resource-name">Oro</span><span class="resource-qty">${formatGold(player.gold)}</span>
            </div>
        `;
        bagSection.appendChild(goldGrid);

        // Un ítem es "Consumible" (poción/pergamino/alimento); todo lo demás
        // (núcleos, mena, madera, hierba, cultivo) es "Recurso".
        const isConsumableMaterial = id => id.startsWith('pocion_') || id === 'pergamino_teletransporte' || id.startsWith('pergamino_alteracion_') || id.startsWith('food_');

        const renderMaterialGrid = (ids, emptyText) => {
            if (ids.length === 0) {
                const note = document.createElement('div');
                note.className = 'panel-note';
                note.textContent = emptyText;
                bagSection.appendChild(note);
                return;
            }
            const grid = document.createElement('div');
            grid.className = 'resource-grid';
            ids.forEach(id => {
                const info = getMaterialInfo(id);
                const isPotion = id.startsWith('pocion_');
                const isScroll = id === 'pergamino_teletransporte';
                const isAlteracion = id.startsWith('pergamino_alteracion_');
                const isFood = id.startsWith('food_');
                const chip = document.createElement('div');
                chip.className = 'resource-chip' + (isPotion || isScroll || isAlteracion || isFood ? ' resource-chip-potion' : '');
                chip.innerHTML = `
                    <span class="resource-emoji">${info.emoji}</span><span class="resource-name">${info.name}</span><span class="resource-qty">x${player.materials[id]}</span>
                    ${isPotion ? `<button class="use-potion-btn" data-use-potion="${id.slice('pocion_'.length)}">Usar</button>` : ''}
                    ${isScroll ? `<button class="use-potion-btn" data-use-scroll="1">Usar</button>` : ''}
                    ${isAlteracion ? `<button class="use-potion-btn" data-use-alteracion="${id.slice('pergamino_alteracion_tier'.length)}">Usar</button>` : ''}
                    ${isFood ? `<button class="use-potion-btn" data-use-food="${id.slice('food_'.length)}">Usar</button>` : ''}
                `;
                grid.appendChild(chip);
            });
            bagSection.appendChild(grid);
        };

        const materialIds = Object.keys(player.materials).filter(id => player.materials[id] > 0);
        const resourceIds = materialIds.filter(id => !isConsumableMaterial(id));
        const consumableIds = materialIds.filter(isConsumableMaterial);

        const resourcesTitle = document.createElement('div');
        resourcesTitle.className = 'inv-subsection-title';
        resourcesTitle.textContent = '📦 Recursos';
        bagSection.appendChild(resourcesTitle);
        renderMaterialGrid(resourceIds, 'Sin recursos recolectados.');

        const consumablesTitle = document.createElement('div');
        consumablesTitle.className = 'inv-subsection-title';
        consumablesTitle.textContent = '🧪 Consumibles';
        bagSection.appendChild(consumablesTitle);
        renderMaterialGrid(consumableIds, 'Sin consumibles.');

        const itemsTitle = document.createElement('div');
        itemsTitle.className = 'inv-subsection-title';
        itemsTitle.textContent = 'Armas y armaduras';
        bagSection.appendChild(itemsTitle);

        // Fila de un objeto crafteado (arma o armadura), reutilizada para
        // cada profesión más abajo — así quedan mezclados con el resto del
        // inventario en vez de una sección aparte.
        const appendCraftedRow = (item) => {
            const itemProf = getProfession(item.profId);
            const tier = TIERS.find(t => t.id === item.tierId);
            const rarity = getMonsterRarity(item.rarityId);
            const isEquipped = player.equippedCraftedByProf[item.profId] === item.id;
            const statLabel = item.kind === 'armor' ? `DEF ${item.defense}` : `⚔ ${item.damage}`;

            const div = document.createElement('div');
            div.className = 'inv-item' + (isEquipped ? ' active' : '');
            div.innerHTML = `
                <div class="item-emoji">${itemProf.emoji}</div>
                <div class="item-info">
                    <div class="item-name" style="color:${rarity.color}">${getWeaponName(item.profId, item.tierId)} · Tier ${tier.id} · ${getRarityEmoji(rarity.id)}</div>
                    <div class="item-sub">${itemProf.emoji} ${itemProf.name} · Tier ${tier.id} ${tier.name} · ${statLabel}${isEquipped ? ' · Equipado' : ''}</div>
                </div>
                ${isEquipped
                    ? `<button class="equip-btn" data-unequip-craft="${item.profId}">Quitar</button>`
                    : `<button class="equip-btn" data-equip-craft="${item.id}">Equipar</button>`}
            `;
            bagSection.appendChild(div);
        };

        // Objetos crafteados de la armadura (no tiene fila "automática" acá,
        // esa ya se ve arriba en Equipado). getProfession() puede devolver
        // undefined para profId huérfanos de clases eliminadas/renombradas
        // en partidas guardadas antes de un rebalanceo (ver constants.js).
        player.craftedItems.filter(it => it.profId === 'armadura' && getProfession(it.profId)).forEach(appendCraftedRow);

        // Objetos crafteados de la profesión activa (alternativas al arma
        // que ya se ve arriba en Equipado).
        player.craftedItems.filter(it => it.profId === activeProf.id && getProfession(it.profId)).forEach(appendCraftedRow);

        PROFESSIONS.filter(prof => prof.id !== 'armadura' && prof.id !== activeProf.id).forEach(prof => {
            const tier = getTierForLevel(player.level);
            const canEquip = prof.type !== 'passive' && prof.type !== 'gather';

            const div = document.createElement('div');
            div.className = 'inv-item';
            div.innerHTML = `
                <div class="item-emoji">${prof.emoji}</div>
                <div class="item-info">
                    <div class="item-name">${getWeaponName(prof.id, tier.id)}</div>
                    <div class="item-sub">${prof.emoji} ${prof.name} · Nivel ${player.level} · Tier ${tier.id} ${tier.name}</div>
                </div>
                ${canEquip ? `<button class="equip-btn" data-equip="${prof.id}">Equipar</button>` : `<span class="passive-tag">${prof.type === 'gather' ? 'Siempre disponible' : 'Sin equipar'}</span>`}
            `;
            bagSection.appendChild(div);

            player.craftedItems.filter(it => it.profId === prof.id).forEach(appendCraftedRow);
        });

        list.appendChild(bagSection);

        list.querySelectorAll('[data-equip]').forEach(btn => {
            btn.addEventListener('click', () => {
                player.setActiveProfession(btn.dataset.equip);
                this.renderInventory(player);
                this.updateHUD(player);
            });
        });
        list.querySelectorAll('[data-equip-craft]').forEach(btn => {
            btn.addEventListener('click', () => {
                player.equipCraftedItem(btn.dataset.equipCraft);
                this.renderInventory(player);
                this.updateHUD(player);
            });
        });
        list.querySelectorAll('[data-unequip-craft]').forEach(btn => {
            btn.addEventListener('click', () => {
                player.unequipCrafted(btn.dataset.unequipCraft);
                this.renderInventory(player);
                this.updateHUD(player);
            });
        });
        list.querySelectorAll('[data-use-potion]').forEach(btn => {
            btn.addEventListener('click', () => {
                const healed = player.usePotion(btn.dataset.usePotion);
                if (healed > 0) this.showLevelToastText(`❤️ +${healed} HP`);
                this.renderInventory(player);
                this.updateHUD(player);
            });
        });
        list.querySelectorAll('[data-use-scroll]').forEach(btn => {
            btn.addEventListener('click', () => {
                if (this.onUseTeleportScroll) this.onUseTeleportScroll();
            });
        });
        list.querySelectorAll('[data-use-alteracion]').forEach(btn => {
            btn.addEventListener('click', () => {
                if (this.onUseAlteracionScroll) this.onUseAlteracionScroll(parseInt(btn.dataset.useAlteracion, 10));
            });
        });
        const goldChip = list.querySelector('[data-open-gold]');
        if (goldChip) {
            goldChip.addEventListener('click', () => this.showGoldPanel(player));
        }
        list.querySelectorAll('[data-use-food]').forEach(btn => {
            btn.addEventListener('click', () => {
                const [foodId, rarityId] = btn.dataset.useFood.split('__');
                const result = player.useFood(foodId, rarityId);
                if (result) this.showLevelToastText(`🍽️ ${result.name} (${result.rarity.name}) consumido`);
                this.renderInventory(player);
                this.updateHUD(player);
            });
        });
    },

    // Banco de encantamientos: solo se pueden encantar armas CRAFTEADAS
    // (tienen Rareza + Tier propios, ver player.craftItem). Se elige el
    // arma, y para cada uno de sus encantamientos disponibles (7 generales
    // + los 3 específicos de su categoría, ver enchantments.js) se puede
    // subir de nivel pagando con núcleos de esa Rareza y Tier igual o
    // superior al del arma.
    renderEnchantments(player) {
        const container = document.getElementById('enchant-list');
        container.innerHTML = '';

        const weapons = player.craftedItems.filter(it => it.kind === 'weapon');
        if (!weapons.length) {
            container.innerHTML = '<div class="panel-note">Todavía no crafteaste ningún arma. Solo las armas crafteadas (con Rareza y Tier propios) se pueden encantar — el arma automática por nivel no tiene Rareza.</div>';
            return;
        }
        if (!this._enchantItemId || !weapons.some(w => w.id === this._enchantItemId)) {
            this._enchantItemId = weapons[0].id;
        }

        const selectorEl = document.createElement('div');
        selectorEl.className = 'craft-prof-selector';
        weapons.forEach(w => {
            const wProf = getProfession(w.profId);
            const wRarity = getMonsterRarity(w.rarityId);
            const wTier = TIERS.find(t => t.id === w.tierId);
            const btn = document.createElement('button');
            btn.className = 'craft-prof-btn' + (w.id === this._enchantItemId ? ' active' : '');
            btn.style.borderColor = wRarity.color;
            btn.innerHTML = `${wTier.emoji} ${wProf.name} · ${wRarity.name} T${wTier.id}`;
            btn.addEventListener('click', () => {
                this._enchantItemId = w.id;
                this.renderEnchantments(player);
            });
            selectorEl.appendChild(btn);
        });
        container.appendChild(selectorEl);

        const item = weapons.find(w => w.id === this._enchantItemId);
        const prof = getProfession(item.profId);
        const rarity = getMonsterRarity(item.rarityId);
        const tier = TIERS.find(t => t.id === item.tierId);

        const infoDiv = document.createElement('div');
        infoDiv.className = 'panel-note';
        infoDiv.style.textAlign = 'center';
        infoDiv.innerHTML = `Encantando: <b style="color:${rarity.color}">${getWeaponName(item.profId, item.tierId)} (${rarity.name})</b> · Tier ${tier.id} — requiere Núcleos ${rarity.name} Tier ${tier.id} o superior`;
        container.appendChild(infoDiv);

        const { general, specific } = getEnchantmentsForProfession(item.profId);

        const renderGroup = (title, list) => {
            if (!list.length) return;
            const groupTitle = document.createElement('div');
            groupTitle.className = 'inv-subsection-title';
            groupTitle.textContent = title;
            container.appendChild(groupTitle);
            list.forEach(def => this.renderEnchantRow(player, item, def, rarity, tier, container));
        };
        renderGroup('✨ Generales (cualquier arma)', general);
        renderGroup(specific.length ? `${prof.emoji} Específicos de ${prof.name}` : '', specific);
    },

    // Una fila del banco: nivel actual, descripción del próximo nivel (o del
    // máximo si ya está al tope), selector de tier de núcleo (entre los que
    // el jugador tiene, compatibles) y botón de aplicar/mejorar.
    renderEnchantRow(player, item, def, rarity, tier, container) {
        const currentLevel = player.getEnchantLevel(item.id, def.id);
        const upgrade = player.getEnchantUpgradeInfo(item.id, def.id);
        const levelLabel = currentLevel > 0 ? `Nivel ${currentLevel}/${def.maxLevel}` : `Sin encantar · máx. nivel ${def.maxLevel}`;
        const shownLevel = upgrade ? def.levels[upgrade.nextLevel - 1] : def.levels[def.maxLevel - 1];
        const compatible = player.getCompatibleNucleos(rarity.id, tier.id);

        const row = document.createElement('div');
        row.className = 'enchant-item';

        let controlsHtml;
        if (!upgrade) {
            controlsHtml = '<span class="passive-tag">MAX</span>';
        } else if (!compatible.length) {
            controlsHtml = `<span class="passive-tag">Sin núcleos ${rarity.name} T${tier.id}+</span>`;
        } else {
            const options = compatible.map(c => `<option value="${c.tierId}">Núcleo T${c.tierId} (x${c.qty})</option>`).join('');
            controlsHtml = `
                <select class="craft-rarity-select" data-nucleo-select>${options}</select>
                <button class="apply-btn craft-btn" data-apply-enchant>${currentLevel > 0 ? 'Mejorar' : 'Aplicar'} (${upgrade.cost})</button>
            `;
        }

        row.innerHTML = `
            <div class="item-emoji">${def.emoji}</div>
            <div class="item-info">
                <div class="item-name">${def.name} <span style="opacity:.6;font-weight:normal">— ${levelLabel}</span></div>
                <div class="enchant-desc">${shownLevel.desc}</div>
            </div>
            <div class="enchant-controls">${controlsHtml}</div>
        `;
        container.appendChild(row);

        if (upgrade && compatible.length) {
            const select = row.querySelector('[data-nucleo-select]');
            const applyBtn = row.querySelector('[data-apply-enchant]');
            const affordable = compatible.some(c => c.qty >= upgrade.cost);
            if (!affordable) {
                applyBtn.disabled = true;
                applyBtn.textContent = `Faltan núcleos (${upgrade.cost})`;
            }
            applyBtn.addEventListener('click', () => {
                const nucleoTierId = parseInt(select.value, 10);
                const result = player.applyEnchant(item.id, def.id, nucleoTierId);
                if (!result) return;
                this.showLevelToastText(`✨ ${def.name} nivel ${result.level} aplicado`);
                this.renderEnchantments(player);
                this.renderInventory(player);
                this.updateHUD(player);
            });
        }
    },

    // Selector de categorías del panel de Crafteo: dos grupos visuales
    // separados — Clases de Combate (armas/armadura/monturas) arriba y
    // Clases de Recolección (materias primas/alimentos/pociones/núcleos)
    // abajo, con un separador entre ambos (ver CSS .craft-prof-separator).
    renderCraft(player) {
        if (!this._craftProf) this._craftProf = 'picaro'; // id de profesión, o '__potion__'/'__food__'/'__mount__'/'__nucleo__'

        const selectorEl = document.getElementById('craft-prof-selector');
        selectorEl.innerHTML = '';

        const makeBtn = (key, label) => {
            const btn = document.createElement('button');
            btn.className = 'craft-prof-btn' + (key === this._craftProf ? ' active' : '');
            btn.innerHTML = label;
            btn.addEventListener('click', () => {
                this._craftProf = key;
                this.renderCraft(player);
            });
            return btn;
        };

        const combatGroup = document.createElement('div');
        combatGroup.className = 'craft-prof-group';
        ['picaro', 'guerrero', 'barbaro', 'mago', 'arquero', 'tanque', 'armadura'].forEach(id => {
            const prof = getProfession(id);
            if (prof) combatGroup.appendChild(makeBtn(prof.id, `${prof.emoji} ${prof.name}`));
        });
        combatGroup.appendChild(makeBtn('__mount__', '🐴 MONTURAS'));
        selectorEl.appendChild(combatGroup);

        const separator = document.createElement('div');
        separator.className = 'craft-prof-separator';
        selectorEl.appendChild(separator);

        const gatherGroup = document.createElement('div');
        gatherGroup.className = 'craft-prof-group';
        const GATHER_BTN_EMOJI = { lenador: '🪵' }; // override puntual solo para este selector (ver PROFESSIONS para el emoji "oficial")
        ['lenador', 'minero', 'campesino'].forEach(id => {
            const prof = getProfession(id);
            if (prof) gatherGroup.appendChild(makeBtn(prof.id, `${GATHER_BTN_EMOJI[id] || prof.emoji} ${prof.name}`));
        });
        gatherGroup.appendChild(makeBtn('__food__', '🥘 ALIMENTOS'));
        gatherGroup.appendChild(makeBtn('__potion__', '💊 POCIONES'));
        gatherGroup.appendChild(makeBtn('__nucleo__', '💎 NÚCLEOS'));
        selectorEl.appendChild(gatherGroup);

        const listEl = document.getElementById('craft-list');
        listEl.innerHTML = '';

        if (this._craftProf === '__food__') {
            this.renderFoodCraft(player, listEl);
            return;
        }
        if (this._craftProf === '__mount__') {
            this.renderMountCraft(player, listEl);
            return;
        }
        if (this._craftProf === '__nucleo__') {
            this.renderNucleoCraft(player, listEl);
            return;
        }

        const isPotion = this._craftProf === '__potion__';
        const prof = isPotion ? null : getProfession(this._craftProf);
        const isArmor = !isPotion && prof.id === 'armadura';
        const isTool = !isPotion && prof.type === 'gather';

        const tierSource = isPotion ? HERB_TIERS : TIERS;
        tierSource.forEach(tier => {
            // Pociones: solo hierba. Armadura: solo mena. Armas/herramientas:
            // mitad del costo en madera, mitad en mena del tier (ver punto 9).
            const oreId = isPotion ? null : `mat_tier_${tier.id}`;
            const woodId = `madera_tier_${tier.id}`;
            const totalCost = isPotion ? POTION_HERB_COST : getCraftMaterialCost(tier.id);
            const woodCost = (!isPotion && !isArmor) ? Math.round(totalCost / 2) : 0;
            const oreCost = totalCost - woodCost;
            const matId = isPotion ? `hierba_tier_${tier.id}` : oreId;
            const haveMat = player.materials[matId] || 0;
            const haveWood = player.materials[woodId] || 0;
            const woodInfo = getMaterialInfo(woodId);
            const matInfo = getMaterialInfo(matId);

            const row = document.createElement('div');
            row.className = 'craft-row';

            const info = document.createElement('div');
            info.className = 'craft-row-info';
            info.innerHTML = `
                <div class="item-name">${tier.emoji} ${tier.name}</div>
                <div class="item-sub">${matInfo.emoji} ${matInfo.name}: ${haveMat}/${oreCost}${woodCost ? ` · ${woodInfo.emoji} ${woodInfo.name}: ${haveWood}/${woodCost}` : ''}</div>
            `;
            row.appendChild(info);

            const raritySelect = document.createElement('select');
            raritySelect.className = 'craft-rarity-select';
            MONSTER_RARITIES.forEach(rarity => {
                const coreId = getNucleoId(rarity.id, tier.id);
                const haveCore = player.materials[coreId] || 0;
                const opt = document.createElement('option');
                opt.value = rarity.id;
                opt.textContent = `${rarity.name} (núcleos T${tier.id}: ${haveCore})`;
                raritySelect.appendChild(opt);
            });
            row.appendChild(raritySelect);

            const preview = document.createElement('div');
            preview.className = 'craft-preview';
            row.appendChild(preview);

            const craftBtn = document.createElement('button');
            craftBtn.className = 'apply-btn craft-btn';
            row.appendChild(craftBtn);

            const updatePreview = () => {
                const rarityId = raritySelect.value;
                const rarity = getMonsterRarity(rarityId);
                const coreId = getNucleoId(rarityId, tier.id);
                const haveCore = player.materials[coreId] || 0;
                let statPreview;
                if (isPotion) statPreview = `❤️ +${getPotionHealAmount(rarityId)}`;
                else if (isArmor) statPreview = `DEF ${Math.round(tier.id * 4 * rarity.mult)}`;
                else if (isTool) statPreview = `📦 ${GATHER_YIELD_MIN}-${getGatherYieldMax(rarityId)}`;
                else statPreview = `⚔ ${Math.round(prof.baseDamage * tier.mult * rarity.mult * 10) / 10}`;
                preview.innerHTML = `<span style="color:${rarity.color}">${statPreview}</span>`;
                const affordable = haveMat >= oreCost && haveWood >= woodCost && haveCore >= CRAFT_CORE_COST;
                craftBtn.disabled = !affordable;
                craftBtn.textContent = affordable ? 'Craftear'
                    : (haveMat < oreCost ? `Falta ${matInfo.name}`
                    : (haveWood < woodCost ? `Falta ${woodInfo.name}` : `Falta núcleo ${rarity.name}`));
            };
            raritySelect.addEventListener('change', updatePreview);
            updatePreview();

            craftBtn.addEventListener('click', () => {
                if (isPotion) {
                    const result = player.craftPotion(tier.id, raritySelect.value);
                    if (!result) return;
                    this.showLevelToastText(`🧪 Crafteada: Poción de Curación (${getMonsterRarity(result.rarityId).name}) — cura ${result.healAmount}`);
                } else {
                    const item = player.craftItem(prof.id, tier.id, raritySelect.value);
                    if (!item) return;
                    this.showLevelToastText(`🛠️ Crafteado: ${getWeaponName(prof.id, tier.id)} (${getMonsterRarity(item.rarityId).name})`);
                }
                this.renderCraft(player);
                this.renderInventory(player);
                this.updateHUD(player);
            });

            listEl.appendChild(row);
        });
    },

    // Modo "🍽️ ALIMENTOS" del panel de crafteo: primero se elige el tier
    // (define el cultivo base y qué alimentos hay disponibles), luego se
    // craftea cada alimento de ese tier como una fila con selector de
    // rareza, igual que las pociones.
    renderFoodCraft(player, listEl) {
        if (!this._craftFoodTier) this._craftFoodTier = 1;

        const tierSelEl = document.createElement('div');
        tierSelEl.className = 'craft-prof-selector food-tier-selector';
        FOOD_TIERS.forEach(t => {
            const btn = document.createElement('button');
            btn.className = 'craft-prof-btn' + (this._craftFoodTier === t.id ? ' active' : '');
            btn.innerHTML = `${t.resourceEmoji} T${t.id} ${t.resourceName}`;
            btn.addEventListener('click', () => {
                this._craftFoodTier = t.id;
                this.renderCraft(player);
            });
            tierSelEl.appendChild(btn);
        });
        listEl.appendChild(tierSelEl);

        const cultivoId = `cultivo_tier_${this._craftFoodTier}`;
        const haveCultivo = player.materials[cultivoId] || 0;
        const cultivoInfo = getMaterialInfo(cultivoId);

        FOODS[this._craftFoodTier].forEach(food => {
            const row = document.createElement('div');
            row.className = 'craft-row';

            const info = document.createElement('div');
            info.className = 'craft-row-info';
            info.innerHTML = `
                <div class="item-name">${food.emoji} ${food.name}</div>
                <div class="item-sub">${cultivoInfo.emoji} ${cultivoInfo.name}: ${haveCultivo}/${FOOD_CULTIVO_COST}</div>
            `;
            row.appendChild(info);

            const raritySelect = document.createElement('select');
            raritySelect.className = 'craft-rarity-select';
            MONSTER_RARITIES.forEach(rarity => {
                const coreId = getNucleoId(rarity.id, this._craftFoodTier);
                const haveCore = player.materials[coreId] || 0;
                const opt = document.createElement('option');
                opt.value = rarity.id;
                opt.textContent = `${rarity.name} (núcleos T${this._craftFoodTier}: ${haveCore})`;
                raritySelect.appendChild(opt);
            });
            row.appendChild(raritySelect);

            const preview = document.createElement('div');
            preview.className = 'craft-preview food-preview';
            row.appendChild(preview);

            const craftBtn = document.createElement('button');
            craftBtn.className = 'apply-btn craft-btn';
            row.appendChild(craftBtn);

            const updatePreview = () => {
                const rarityId = raritySelect.value;
                const rarity = getMonsterRarity(rarityId);
                const coreId = getNucleoId(rarityId, this._craftFoodTier);
                const haveCore = player.materials[coreId] || 0;
                const version = food.versions[rarityId];
                preview.innerHTML = `<span style="color:${rarity.color}">${buildFoodEffectLabel(food, version)}</span>`;
                const affordable = haveCultivo >= FOOD_CULTIVO_COST && haveCore >= CRAFT_CORE_COST;
                craftBtn.disabled = !affordable;
                craftBtn.textContent = affordable ? 'Craftear' : (haveCultivo < FOOD_CULTIVO_COST ? `Falta ${cultivoInfo.name}` : `Falta núcleo ${rarity.name}`);
            };
            raritySelect.addEventListener('change', updatePreview);
            updatePreview();

            craftBtn.addEventListener('click', () => {
                const result = player.craftFood(this._craftFoodTier, food.id, raritySelect.value);
                if (!result) return;
                this.showLevelToastText(`🍽️ Crafteado: ${food.name} (${getMonsterRarity(result.rarityId).name})`);
                this.renderCraft(player);
                this.renderInventory(player);
                this.updateHUD(player);
            });

            listEl.appendChild(row);
        });
    },

    // Modo "🐴 MONTURAS" del panel de crafteo: 1 fila por tier, con selector
    // de rareza de núcleo (determina el bono extra de velocidad) y, si el
    // jugador ya tiene monturas de ese tier, una fila de Equipar/Quitar por
    // cada una debajo. Solo 1 montura puede estar equipada a la vez.
    renderMountCraft(player, listEl) {
        MOUNTS.forEach(def => {
            const tierId = def.tierId;
            const cost = getMountCraftCost(tierId);
            const oreId = `mat_tier_${tierId}`;
            const woodId = `madera_tier_${tierId}`;
            const haveOre = player.materials[oreId] || 0;
            const haveWood = player.materials[woodId] || 0;
            const oreInfo = getMaterialInfo(oreId);
            const woodInfo = getMaterialInfo(woodId);

            const row = document.createElement('div');
            row.className = 'craft-row';

            const info = document.createElement('div');
            info.className = 'craft-row-info';
            info.innerHTML = `
                <div class="item-name">${def.emoji} ${def.name}</div>
                <div class="item-sub">${oreInfo.emoji} ${oreInfo.name}: ${haveOre}/${cost.ore} · ${woodInfo.emoji} ${woodInfo.name}: ${haveWood}/${cost.wood}</div>
            `;
            row.appendChild(info);

            const raritySelect = document.createElement('select');
            raritySelect.className = 'craft-rarity-select';
            MONSTER_RARITIES.forEach(rarity => {
                const coreId = getNucleoId(rarity.id, tierId);
                const haveCore = player.materials[coreId] || 0;
                const opt = document.createElement('option');
                opt.value = rarity.id;
                opt.textContent = `${rarity.name} (núcleos T${tierId}: ${haveCore}/${cost.nucleo})`;
                raritySelect.appendChild(opt);
            });
            row.appendChild(raritySelect);

            const preview = document.createElement('div');
            preview.className = 'craft-preview';
            row.appendChild(preview);

            const craftBtn = document.createElement('button');
            craftBtn.className = 'apply-btn craft-btn';
            row.appendChild(craftBtn);

            const updatePreview = () => {
                const rarityId = raritySelect.value;
                const rarity = getMonsterRarity(rarityId);
                const coreId = getNucleoId(rarityId, tierId);
                const haveCore = player.materials[coreId] || 0;
                const speedPercent = getMountSpeedPercent(tierId, rarityId);
                preview.innerHTML = `<span style="color:${rarity.color}">🏃 +${speedPercent}%</span>`;
                const affordable = haveOre >= cost.ore && haveWood >= cost.wood && haveCore >= cost.nucleo;
                craftBtn.disabled = !affordable;
                craftBtn.textContent = affordable ? 'Craftear'
                    : (haveOre < cost.ore ? `Falta ${oreInfo.name}`
                    : (haveWood < cost.wood ? `Falta ${woodInfo.name}` : `Falta núcleo ${rarity.name}`));
            };
            raritySelect.addEventListener('change', updatePreview);
            updatePreview();

            craftBtn.addEventListener('click', () => {
                const mount = player.craftMount(tierId, raritySelect.value);
                if (!mount) return;
                this.showLevelToastText(`🐴 Crafteada: ${def.name} (+${mount.speedPercent}% velocidad)`);
                this.renderCraft(player);
                this.renderInventory(player);
            });

            listEl.appendChild(row);

            player.mounts.filter(m => m.tierId === tierId).forEach(m => {
                const rarity = getMonsterRarity(m.rarityId);
                const isEquipped = player.equippedMountId === m.id;
                const ownedRow = document.createElement('div');
                ownedRow.className = 'inv-item' + (isEquipped ? ' active' : '');
                ownedRow.innerHTML = `
                    <div class="item-emoji">${MOUNT_INVENTORY_EMOJI}</div>
                    <div class="item-info">
                        <div class="item-name" style="color:${rarity.color}">${def.name} · Tier ${tierId} · ${getRarityEmoji(rarity.id)}</div>
                        <div class="item-sub">🏃 +${m.speedPercent}% velocidad${isEquipped ? ' · Equipada' : ''}</div>
                    </div>
                    ${isEquipped
                        ? '<button class="equip-btn" data-unequip-mount="1">Quitar</button>'
                        : `<button class="equip-btn" data-equip-mount="${m.id}">Equipar</button>`}
                `;
                listEl.appendChild(ownedRow);
            });
        });

        listEl.querySelectorAll('[data-equip-mount]').forEach(btn => {
            btn.addEventListener('click', () => {
                player.equipMount(btn.dataset.equipMount);
                this.renderCraft(player);
            });
        });
        listEl.querySelectorAll('[data-unequip-mount]').forEach(btn => {
            btn.addEventListener('click', () => {
                player.unequipMount();
                this.renderCraft(player);
            });
        });
    },

    // Modo "💠 NÚCLEOS" del panel de crafteo: banco de crafteo/descrafteo de
    // núcleos por rareza dentro del Tier elegido (Ascender: 10 de una rareza
    // -> 1 de la siguiente; Descender: 1 de una rareza -> 10 de la anterior;
    // el Tier nunca cambia). Común no tiene Descender, Mítico no tiene
    // Ascender.
    renderNucleoCraft(player, listEl) {
        if (!this._craftNucleoTier) this._craftNucleoTier = 1;

        const tierSelEl = document.createElement('div');
        tierSelEl.className = 'craft-prof-selector food-tier-selector';
        TIERS.forEach(t => {
            const btn = document.createElement('button');
            btn.className = 'craft-prof-btn' + (this._craftNucleoTier === t.id ? ' active' : '');
            btn.innerHTML = `${t.emoji} T${t.id} ${t.name}`;
            btn.addEventListener('click', () => {
                this._craftNucleoTier = t.id;
                this.renderCraft(player);
            });
            tierSelEl.appendChild(btn);
        });
        listEl.appendChild(tierSelEl);

        const tierId = this._craftNucleoTier;

        MONSTER_RARITIES.forEach((rarity, idx) => {
            const coreId = getNucleoId(rarity.id, tierId);
            const have = player.materials[coreId] || 0;
            const nextRarity = idx < MONSTER_RARITIES.length - 1 ? MONSTER_RARITIES[idx + 1] : null;
            const prevRarity = idx > 0 ? MONSTER_RARITIES[idx - 1] : null;

            const row = document.createElement('div');
            row.className = 'craft-row';

            const info = document.createElement('div');
            info.className = 'craft-row-info';
            info.innerHTML = `
                <div class="item-name" style="color:${rarity.color}">💠 ${rarity.name}</div>
                <div class="item-sub">Tienes: ${have}</div>
            `;
            row.appendChild(info);

            if (nextRarity) {
                const upBtn = document.createElement('button');
                upBtn.className = 'apply-btn craft-btn';
                const affordUp = have >= 10;
                upBtn.disabled = !affordUp;
                upBtn.textContent = `⬆️ 10→1 ${nextRarity.name}`;
                upBtn.addEventListener('click', () => {
                    if (!window.confirm(`¿Craftear 10 Núcleos ${rarity.name} T${tierId} en 1 Núcleo ${nextRarity.name} T${tierId}?`)) return;
                    const result = player.craftNucleoUp(tierId, rarity.id);
                    if (!result) return;
                    this.showLevelToastText(`💠 Crafteado: 1 Núcleo ${nextRarity.name} T${tierId}`);
                    this.renderCraft(player);
                    this.updateHUD(player);
                });
                row.appendChild(upBtn);
            }

            if (prevRarity) {
                const downBtn = document.createElement('button');
                downBtn.className = 'apply-btn craft-btn';
                const affordDown = have >= 1;
                downBtn.disabled = !affordDown;
                downBtn.textContent = `⬇️ 1→10 ${prevRarity.name}`;
                downBtn.addEventListener('click', () => {
                    if (!window.confirm(`¿Descraftear 1 Núcleo ${rarity.name} T${tierId} en 10 Núcleos ${prevRarity.name} T${tierId}?`)) return;
                    const result = player.craftNucleoDown(tierId, rarity.id);
                    if (!result) return;
                    this.showLevelToastText(`💠 Descrafteado: 10 Núcleos ${prevRarity.name} T${tierId}`);
                    this.renderCraft(player);
                    this.updateHUD(player);
                });
                row.appendChild(downBtn);
            }

            listEl.appendChild(row);
        });
    },

    showCombatPanel() {
        ['inventory-panel', 'enchant-panel', 'map-panel', 'craft-panel', 'stats-panel', 'guide-panel'].forEach(p => document.getElementById(p).classList.add('hidden'));
        document.getElementById('combat-panel').classList.remove('hidden');
    },

    hideCombatPanel() {
        document.getElementById('combat-panel').classList.add('hidden');
    },

    renderCombat(combat) {
        const enemiesEl = document.getElementById('combat-enemies');
        enemiesEl.innerHTML = '';
        combat.enemies.forEach(en => {
            const pct = Math.max(0, (en.hp / en.maxHp) * 100);
            const isDead = !en.alive;
            const isSelected = !isDead && combat.selectedTarget === en;
            const statusIcons = [
                en.burn ? '🔥' : '',
                en.bleed ? '🩸' : '',
                en.stunned ? '😵' : '',
                en.defenseMod && en.defenseMod.turnsLeft > 0 ? '🛡️⬇️' : '',
                en.attackMod && en.attackMod.turnsLeft > 0 ? '⚔️⬇️' : '',
            ].filter(Boolean).join(' ');

            const div = document.createElement('div');
            div.className = 'combat-enemy-card' + (isSelected ? ' selected' : '') + (isDead ? ' dead' : '');
            const rarity = en.type.rarity;
            if (rarity && !isDead && !isSelected) div.style.borderColor = rarity.color;
            div.innerHTML = `
                <div class="combat-enemy-emoji">${isDead ? '💀' : en.type.emoji}</div>
                <div class="combat-enemy-name">${en.type.name}</div>
                ${rarity ? `<div class="combat-rarity-tag" style="color:${rarity.color}">${rarity.name}</div>` : ''}
                <div class="mini-bar-track"><div class="mini-bar-fill hp-fill" style="width:${pct}%"></div></div>
                <div class="combat-hp-text">${Math.round(en.hp)}/${en.maxHp} HP</div>
                ${statusIcons ? `<div class="combat-status-icons">${statusIcons}</div>` : ''}
            `;
            if (!isDead) div.addEventListener('click', () => Combat.selectTarget(en));
            enemiesEl.appendChild(div);
        });

        const playerEl = document.getElementById('combat-player');
        const player = combat.player;
        const prof = player.getActiveProfessionDef();
        const hpPct = Math.max(0, (player.hp / player.maxHp) * 100);
        const shieldTag = player.shield ? ` · 🛡️+${Math.round(player.shield.amount)} (${player.shield.turnsLeft}t)` : '';
        const resistenciaCharges = combat.classCharge.prof === 'tanque' ? combat.classCharge.count : 0;
        const resistenciaTag = resistenciaCharges > 0 ? ` · 🔰x${resistenciaCharges}` : '';
        const tauntTag = combat.tauntTurnsLeft > 0 ? ` · 😤Taunt (${combat.tauntTurnsLeft}t)` : '';
        playerEl.innerHTML = `
            <div class="combat-enemy-emoji">🟣</div>
            <div class="combat-player-info">
                <div class="combat-enemy-name">${prof.emoji} ${prof.name} (Tú)</div>
                <div class="mini-bar-track"><div class="mini-bar-fill hp-fill" style="width:${hpPct}%"></div></div>
                <div class="combat-hp-text">${Math.round(player.hp)}/${player.maxHp} HP${shieldTag}${resistenciaTag}${tauntTag}</div>
            </div>
        `;

        const orderEl = document.getElementById('combat-turn-order');
        orderEl.innerHTML = combat.order.map((entry, i) => {
            const isCurrent = i === combat.turnIndex && combat.active;
            const isDeadEnemy = entry.kind === 'enemy' && !entry.ref.alive;
            const emoji = entry.kind === 'player' ? prof.emoji : entry.ref.type.emoji;
            return `<span class="turn-chip${isCurrent ? ' current' : ''}${isDeadEnemy ? ' dead' : ''}" title="Iniciativa ${entry.initiative}">${emoji}</span>`;
        }).join('');

        const logEl = document.getElementById('combat-log');
        logEl.innerHTML = combat.log.map(l => `<div>${l}</div>`).join('');
        logEl.scrollTop = logEl.scrollHeight;

        const isPlayerTurn = combat.active && combat.isPlayerTurn();

        // Pociones: no gastan PA, máximo 1 por turno y 3 por combate (aunque
        // el bolso tenga más).
        const potionsEl = document.getElementById('combat-potions');
        potionsEl.innerHTML = '';
        const potionIds = combat.active
            ? Object.keys(combat.player.materials).filter(id => id.startsWith('pocion_') && combat.player.materials[id] > 0)
            : [];
        if (potionIds.length) {
            const info = document.createElement('div');
            info.className = 'combat-potion-info';
            info.textContent = `🧪 Pociones disponibles este combate: ${combat.potionUsesLeft}/3`;
            potionsEl.appendChild(info);

            const row = document.createElement('div');
            row.className = 'combat-potion-row';
            potionIds.forEach(id => {
                const rarityId = id.slice('pocion_'.length);
                const rarity = getMonsterRarity(rarityId);
                const qty = combat.player.materials[id];
                const btn = document.createElement('button');
                btn.className = 'combat-btn potion-btn';
                btn.style.borderColor = rarity.color;
                btn.disabled = !isPlayerTurn || combat.usedPotionThisTurn || combat.potionUsesLeft <= 0;
                btn.innerHTML = `🧪 ${rarity.name} (x${qty})<span class="attack-cost">+${getPotionHealAmount(rarityId)} HP</span>`;
                btn.addEventListener('click', () => Combat.usePotionInCombat(rarityId));
                row.appendChild(btn);
            });
            potionsEl.appendChild(row);
        }

        const weaponAttacks = combat.active ? combat.getActiveWeaponAttacks() : null;
        const apInfoEl = document.getElementById('combat-ap-info');

        const attacksEl = document.getElementById('combat-attacks');
        attacksEl.innerHTML = '';

        if (weaponAttacks) {
            apInfoEl.classList.remove('hidden');
            const maxAP = BASE_AP + combat.player.getFoodPABonus();
            // El especial del Pícaro no tiene chargeRequired (solo PA, ver
            // weapon-attacks.js), así que el chip de Carga se omite para él.
            const chargeInfo = weaponAttacks.special.chargeRequired
                ? `   ✨ Carga: ${combat.playerCharge}/${weaponAttacks.special.chargeRequired}` : '';
            apInfoEl.textContent = `⚡ PA: ${combat.playerAP}/${maxAP}${chargeInfo}`;

            [...weaponAttacks.basic, weaponAttacks.special].forEach((atk, idx) => {
                const isSpecial = idx === 2;
                const hasArrows = !atk.arrowCost || combat.player.arrows >= atk.arrowCost;
                const affordable = combat.playerAP >= atk.apCost && hasArrows && (!isSpecial || !atk.chargeRequired || combat.playerCharge >= atk.chargeRequired);
                const btn = document.createElement('button');
                btn.className = 'combat-btn attack-btn' + (isSpecial ? ' special-btn' : '');
                btn.disabled = !isPlayerTurn || !affordable;
                let costLabel = `${atk.apCost} PA`;
                if (isSpecial && atk.chargeRequired) costLabel += ` · Carga ${combat.playerCharge}/${atk.chargeRequired}`;
                if (atk.arrowCost) costLabel += ` · 🏹${atk.arrowCost}`;
                btn.innerHTML = `${atk.emoji} ${atk.name}<span class="attack-cost">${costLabel}</span>`;
                btn.addEventListener('click', () => Combat.playerAttack(idx));
                attacksEl.appendChild(btn);
            });
        } else {
            apInfoEl.classList.add('hidden');
            getAttacksForProfession(prof.id).forEach((atk, idx) => {
                const btn = document.createElement('button');
                btn.className = 'combat-btn attack-btn';
                btn.disabled = !isPlayerTurn;
                btn.innerHTML = `${atk.emoji} ${atk.name}`;
                btn.title = atk.desc || '';
                btn.addEventListener('click', () => Combat.playerAttack(idx));
                attacksEl.appendChild(btn);
            });
        }

        document.getElementById('combat-endturn-btn').disabled = !isPlayerTurn;

        const statusEl = document.getElementById('combat-status');
        if (!combat.active) {
            statusEl.textContent = '';
        } else if (isPlayerTurn) {
            statusEl.textContent = '👉 Tu turno — elige una acción';
        } else {
            const entry = combat.order[combat.turnIndex];
            statusEl.textContent = entry.kind === 'enemy' ? `${entry.ref.type.emoji} Turno de ${entry.ref.type.name}...` : '';
        }
    },

    showVictoryPanel(loot) {
        document.getElementById('combat-panel').classList.add('hidden');

        const summaryEl = document.getElementById('victory-summary');
        summaryEl.innerHTML = loot.defeated.map(d => `<span class="victory-chip">${d.emoji} ${d.name}</span>`).join('');

        document.getElementById('victory-xp').textContent = `+${loot.xp} XP` + (loot.gold ? `   +${loot.gold} 🪙` : '');

        const dropsEl = document.getElementById('victory-drops');
        const materialIds = Object.keys(loot.materials);
        if (materialIds.length === 0) {
            dropsEl.innerHTML = '<div class="panel-note">Sin objetos recolectados.</div>';
        } else {
            dropsEl.innerHTML = materialIds.map(id => {
                const m = loot.materials[id];
                return `
                    <div class="combat-enemy-card drop-card">
                        <div class="combat-enemy-emoji">${m.emoji}</div>
                        <div class="combat-enemy-name">${m.name}</div>
                        <div class="combat-hp-text">x${m.qty}</div>
                    </div>
                `;
            }).join('');
        }

        document.getElementById('victory-panel').classList.remove('hidden');
    },

    hideVictoryPanel() {
        document.getElementById('victory-panel').classList.add('hidden');
    },

    // Panel de precisión de Oro: se abre al hacer click en el chip de Oro
    // del inventario y muestra el valor exacto (sin abreviar K/M).
    showGoldPanel(player) {
        document.getElementById('gold-exact-value').textContent = `🪙 ${formatGoldExact(player.gold)}`;
        document.getElementById('gold-panel').classList.remove('hidden');
    },

    hideGoldPanel() {
        document.getElementById('gold-panel').classList.add('hidden');
    },

    // Menú (tecla ESC cuando no hay ninguna otra ventana abierta, ver game.js).
    showMenuPanel() {
        document.getElementById('menu-panel').classList.remove('hidden');
    },

    hideMenuPanel() {
        document.getElementById('menu-panel').classList.add('hidden');
    },

    // ----- MERCADER DE LA TABERNA (ver SISTEMA DE TABERNA, shop.js) -----
    // Etiqueta legible de un lote vendido por el jugador (bloque derecho,
    // "Comprar") o de un objeto en el inventario del jugador (bloque
    // izquierdo, "Vender"): reusa los mismos helpers de nombre que el resto
    // del inventario (getMaterialInfo/getWeaponName/getMountDef).
    getShopItemLabel(entry) {
        // entry: { type, materialId?, item? }
        if (entry.type === 'material') {
            const info = getMaterialInfo(entry.materialId);
            return { name: info.name, emoji: info.emoji, sub: '' };
        }
        const item = entry.item;
        const rarity = getMonsterRarity(item.rarityId);
        const tier = TIERS.find(t => t.id === item.tierId);
        if (entry.type === 'weapon' || entry.type === 'armor') {
            const prof = getProfession(item.profId);
            const statLabel = item.kind === 'armor' ? `DEF ${item.defense}` : `⚔ ${item.damage}`;
            return {
                name: `${getWeaponName(item.profId, item.tierId)} · Tier ${tier.id} · ${getRarityEmoji(rarity.id)}`,
                emoji: prof ? prof.emoji : '❔',
                sub: `${statLabel} · ${rarity.name}`,
                color: rarity.color,
            };
        }
        // mount
        const def = getMountDef(item.tierId);
        return {
            name: `${def ? def.name : 'Montura'} · Tier ${tier.id} · ${getRarityEmoji(rarity.id)}`,
            emoji: MOUNT_INVENTORY_EMOJI,
            sub: `🏃 +${item.speedPercent}% velocidad · ${rarity.name}`,
            color: rarity.color,
        };
    },

    showShopPanel(player) {
        this.renderShopPanel(player);
        document.getElementById('shop-panel').classList.remove('hidden');
    },

    hideShopPanel() {
        document.getElementById('shop-panel').classList.add('hidden');
    },

    renderShopPanel(player) {
        document.getElementById('shop-gold').textContent = `🪙 ${formatGoldExact(player.gold)}`;

        // ----- BLOQUE IZQUIERDO: inventario del jugador (vender) -----
        const sellEl = document.getElementById('shop-sell-list');
        sellEl.innerHTML = '';

        const sellableMaterialIds = Object.keys(player.materials).filter(id => player.materials[id] > 0 && isMaterialSellable(id));
        sellableMaterialIds.forEach(id => {
            const info = getMaterialInfo(id);
            const qty = player.materials[id];
            const unitPrice = getMaterialUnitSellPrice(id);
            const row = document.createElement('div');
            row.className = 'shop-row';
            row.innerHTML = `
                <div class="item-emoji">${info.emoji}</div>
                <div class="item-info">
                    <div class="item-name">${info.name}</div>
                    <div class="item-sub">x${qty} · ${unitPrice} 🪙 c/u</div>
                </div>
                <button class="shop-btn" data-sell-material="${id}" data-sell-qty="1">Vender</button>
                <button class="shop-btn shop-btn-alt" data-sell-material="${id}" data-sell-qty="${qty}">Vender Todo</button>
            `;
            sellEl.appendChild(row);
        });

        player.craftedItems.forEach(item => {
            const label = this.getShopItemLabel({ type: item.kind, item });
            const price = getCraftedItemSellPrice(item);
            const row = document.createElement('div');
            row.className = 'shop-row';
            row.innerHTML = `
                <div class="item-emoji">${label.emoji}</div>
                <div class="item-info">
                    <div class="item-name" style="color:${label.color}">${label.name}</div>
                    <div class="item-sub">${label.sub} · ${price} 🪙</div>
                </div>
                <button class="shop-btn" data-sell-item="${item.id}">Vender</button>
            `;
            sellEl.appendChild(row);
        });

        player.mounts.forEach(mount => {
            const label = this.getShopItemLabel({ type: 'mount', item: mount });
            const price = getMountSellPrice(mount);
            const row = document.createElement('div');
            row.className = 'shop-row';
            row.innerHTML = `
                <div class="item-emoji">${label.emoji}</div>
                <div class="item-info">
                    <div class="item-name" style="color:${label.color}">${label.name}</div>
                    <div class="item-sub">${label.sub} · ${price} 🪙</div>
                </div>
                <button class="shop-btn" data-sell-mount="${mount.id}">Vender</button>
            `;
            sellEl.appendChild(row);
        });

        if (!sellableMaterialIds.length && !player.craftedItems.length && !player.mounts.length) {
            sellEl.innerHTML = '<div class="panel-note">No tenés nada vendible.</div>';
        }

        // ----- BLOQUE DERECHO: tienda del Mercader (comprar) -----
        const buyEl = document.getElementById('shop-buy-list');
        buyEl.innerHTML = '';

        const scrollInfo = getMaterialInfo('pergamino_teletransporte');
        const scrollRow = document.createElement('div');
        scrollRow.className = 'shop-row';
        scrollRow.innerHTML = `
            <div class="item-emoji">${scrollInfo.emoji}</div>
            <div class="item-info">
                <div class="item-name">${scrollInfo.name}</div>
                <div class="item-sub">Infinito · ${SHOP_SCROLL_PRICE} 🪙</div>
            </div>
            <button class="shop-btn" data-buy-scroll="1">Comprar</button>
        `;
        buyEl.appendChild(scrollRow);

        player.merchantListings.forEach(listing => {
            const label = this.getShopItemLabel(listing);
            const qtyLabel = listing.type === 'material' ? `x${listing.qty} · ` : '';
            const row = document.createElement('div');
            row.className = 'shop-row';
            row.innerHTML = `
                <div class="item-emoji">${label.emoji}</div>
                <div class="item-info">
                    <div class="item-name" style="color:${label.color || ''}">${label.name}</div>
                    <div class="item-sub">${qtyLabel}${listing.price} 🪙</div>
                </div>
                <button class="shop-btn" data-buy-listing="${listing.id}">Comprar</button>
            `;
            buyEl.appendChild(row);
        });

        // ----- Handlers (re-atados en cada render, como el resto de los paneles) -----
        sellEl.querySelectorAll('[data-sell-material]').forEach(btn => {
            btn.addEventListener('click', () => {
                player.sellMaterial(btn.dataset.sellMaterial, parseInt(btn.dataset.sellQty, 10));
                this.renderShopPanel(player);
                this.renderInventory(player);
                this.updateHUD(player);
            });
        });
        sellEl.querySelectorAll('[data-sell-item]').forEach(btn => {
            btn.addEventListener('click', () => {
                player.sellCraftedItem(btn.dataset.sellItem);
                this.renderShopPanel(player);
                this.renderInventory(player);
                this.updateHUD(player);
            });
        });
        sellEl.querySelectorAll('[data-sell-mount]').forEach(btn => {
            btn.addEventListener('click', () => {
                player.sellMount(btn.dataset.sellMount);
                this.renderShopPanel(player);
                this.renderInventory(player);
                this.updateHUD(player);
            });
        });
        buyEl.querySelectorAll('[data-buy-scroll]').forEach(btn => {
            btn.addEventListener('click', () => {
                if (!player.buyScroll()) { this.showLevelToastText('❌ Oro insuficiente o pergaminos al máximo'); return; }
                this.renderShopPanel(player);
                this.renderInventory(player);
                this.updateHUD(player);
            });
        });
        buyEl.querySelectorAll('[data-buy-listing]').forEach(btn => {
            btn.addEventListener('click', () => {
                if (!player.buyListing(btn.dataset.buyListing)) { this.showLevelToastText('❌ Oro insuficiente'); return; }
                this.renderShopPanel(player);
                this.renderInventory(player);
                this.updateHUD(player);
            });
        });
    },

    // Ventana de estadísticas (tecla V): Potencia/Destreza/Suerte/
    // Constitución/Agilidad, con
    // botones +/- para repartir los puntos ganados en cada level up.
    renderStats(player) {
        const list = document.getElementById('stats-list');
        list.innerHTML = '';

        const pointsDiv = document.createElement('div');
        pointsDiv.className = 'panel-note stats-points-note';
        pointsDiv.innerHTML = `<b style="color:#ffd27a">${player.statPoints}</b> puntos disponibles · Nivel ${player.level}`;
        list.appendChild(pointsDiv);

        // Info de dificultad de XP: Rango actual (1-indexado para mostrar,
        // 0-indexado en la fórmula, ver constants.js) y una estimación de
        // cuántos enemigos Comunes normales del piso actual hacen falta
        // para completar el nivel en curso.
        if (player.level < MAX_LEVEL) {
            const rango = Math.floor((player.level - 1) / 100);
            const xpRequired = getXPRequiredForLevel(player.level + 1);
            const xpRemaining = Math.max(0, xpRequired - player.xp);
            const avgEnemyXP = getEnemyXPReward(player.floor, 'comun', undefined) || 1;
            const enemiesNeeded = Math.ceil(xpRemaining / avgEnemyXP);
            const difficultyDiv = document.createElement('div');
            difficultyDiv.className = 'panel-note stats-points-note';
            difficultyDiv.innerHTML = `Rango <b style="color:#ffd27a">${rango + 1}</b> de 10 · ~<b style="color:#ffd27a">${enemiesNeeded}</b> enemigos comunes del piso ${player.floor} para subir de nivel`;
            list.appendChild(difficultyDiv);
        }

        const STAT_DEFS = [
            { id: 'potencia', name: 'Potencia', emoji: '💪', desc: '+0.1% de daño de arma por punto (multiplicativo)' },
            { id: 'destreza', name: 'Destreza', emoji: '🗡️', desc: '+0.1 de penetración de armadura por punto (ignora defensa enemiga)' },
            { id: 'suerte', name: 'Suerte', emoji: '🍀', desc: '+0.01% de probabilidad de crítico por punto (críticos hacen x1.5 daño)' },
            { id: 'constitucion', name: 'Constitución', emoji: '🛡️', desc: '+0.01% de bloquear por punto (máx 40%, -50% daño recibido) + 5 HP máx por punto' },
            { id: 'agilidad', name: 'Agilidad', emoji: '💨', desc: '+0.01% de esquivar por punto (máx 40%) + 0.01% de contraatacar (máx 100%)' },
        ];

        STAT_DEFS.forEach(def => {
            const value = player.stats[def.id];
            const row = document.createElement('div');
            row.className = 'stat-row';
            row.innerHTML = `
                <div class="item-emoji">${def.emoji}</div>
                <div class="item-info">
                    <div class="item-name">${def.name}: ${value}</div>
                    <div class="item-sub">${def.desc}</div>
                </div>
                <div class="stat-controls">
                    <button class="stat-btn" data-stat-minus="${def.id}" data-amount="10" ${value <= 0 ? 'disabled' : ''}>−10</button>
                    <button class="stat-btn" data-stat-minus="${def.id}" data-amount="1" ${value <= 0 ? 'disabled' : ''}>−</button>
                    <button class="stat-btn" data-stat-plus="${def.id}" data-amount="1" ${player.statPoints <= 0 ? 'disabled' : ''}>+</button>
                    <button class="stat-btn" data-stat-plus="${def.id}" data-amount="10" ${player.statPoints <= 0 ? 'disabled' : ''}>+10</button>
                </div>
            `;
            list.appendChild(row);
        });

        list.querySelectorAll('[data-stat-plus]').forEach(btn => {
            btn.addEventListener('click', () => {
                player.addStatPoint(btn.dataset.statPlus, parseInt(btn.dataset.amount, 10));
                this.renderStats(player);
                this.updateHUD(player);
            });
        });
        list.querySelectorAll('[data-stat-minus]').forEach(btn => {
            btn.addEventListener('click', () => {
                player.removeStatPoint(btn.dataset.statMinus, parseInt(btn.dataset.amount, 10));
                this.renderStats(player);
                this.updateHUD(player);
            });
        });
    },

    // Guía estática (tecla P): explica el sistema de niveles/tiers, cómo se
    // reparten los pisos, cada cuánto sube el tier de núcleos/recursos, las
    // rarezas, y cómo se conectan monturas/encantamientos con todo eso. El
    // contenido se arma a partir de las mismas tablas que usa el resto del
    // juego (TIERS, MATERIAL_TIER_BRACKETS, HERB_TIERS, etc.), así que se
    // mantiene al día automáticamente si esos datos cambian.
    // Ventana de Pisos (tecla P): navegación jerárquica de 3 niveles
    // (rangos de 100 -> rangos de 10 -> piso individual) sobre los pisos que
    // el jugador ya alcanzó (player.maxFloorReached), para teletransportarse
    // con un Pergamino de Teletransportación. El estado de navegación
    // (_floorsLevel/_floorsTier/_floorsRango) persiste entre aperturas del
    // panel, igual que el modo del panel de Crafteo.
    renderFloors(player, inTaberna, floorBeforeTaberna) {
        if (!this._floorsLevel) this._floorsLevel = 1;

        const bodyEl = document.getElementById('floors-body');
        bodyEl.innerHTML = '';

        const pergaminos = player.materials.pergamino_teletransporte || 0;
        const info = document.createElement('div');
        info.className = 'floors-info';
        info.innerHTML = `
            <div class="floors-info-row">📜 Pergaminos: <b>${pergaminos}</b></div>
            <div class="floors-info-row">Piso Máximo: <b>${player.maxFloorReached}</b></div>
        `;
        bodyEl.appendChild(info);

        // Taberna (ver SISTEMA DE TABERNA en game.js): acceso directo sin
        // costo desde cualquier piso, o botón de regreso si ya se está
        // adentro. Siempre visible arriba de todo, en cualquier nivel de
        // navegación (rangos/pisos individuales).
        const tabernaBtn = document.createElement('button');
        tabernaBtn.className = 'floors-taberna-btn';
        if (inTaberna) {
            tabernaBtn.textContent = `⬅ Volver al Piso ${floorBeforeTaberna || 1}`;
            tabernaBtn.addEventListener('click', () => { if (this.onExitTaberna) this.onExitTaberna(); });
        } else {
            tabernaBtn.textContent = '🍺 TABERNA';
            tabernaBtn.addEventListener('click', () => { if (this.onEnterTaberna) this.onEnterTaberna(); });
        }
        bodyEl.appendChild(tabernaBtn);

        if (this._floorsLevel !== 1) {
            const backBtn = document.createElement('button');
            backBtn.className = 'floors-back-btn';
            backBtn.textContent = '← Atrás';
            backBtn.addEventListener('click', () => {
                this._floorsLevel -= 1;
                this.renderFloors(player);
            });
            bodyEl.appendChild(backBtn);
        }

        const grid = document.createElement('div');
        grid.className = 'floors-grid';
        bodyEl.appendChild(grid);

        // ----- Nivel 1: rangos de 100 pisos -----
        if (this._floorsLevel === 1) {
            for (let start = 1; start <= player.maxFloorReached && start <= MAX_FLOOR; start += 100) {
                const end = Math.min(start + 99, MAX_FLOOR);
                const isCurrent = player.floor >= start && player.floor <= end;
                const isPartial = player.maxFloorReached < end;
                const btn = document.createElement('button');
                btn.className = 'floors-btn' + (isCurrent ? ' current' : '') + (isPartial ? ' partial' : '');
                btn.textContent = `${start} - ${end}`;
                btn.addEventListener('click', () => {
                    this._floorsTier = start;
                    this._floorsLevel = 2;
                    this.renderFloors(player);
                });
                grid.appendChild(btn);
            }
            return;
        }

        // ----- Nivel 2: rangos de 10 pisos dentro del Tier elegido -----
        if (this._floorsLevel === 2) {
            const tierStart = this._floorsTier;
            const tierEnd = Math.min(tierStart + 99, MAX_FLOOR);
            for (let start = tierStart; start <= tierEnd && start <= player.maxFloorReached; start += 10) {
                const end = Math.min(start + 9, tierEnd);
                const isCurrent = player.floor >= start && player.floor <= end;
                const isPartial = player.maxFloorReached < end;
                const btn = document.createElement('button');
                btn.className = 'floors-btn' + (isCurrent ? ' current' : '') + (isPartial ? ' partial' : '');
                btn.textContent = `${start} - ${end}`;
                btn.addEventListener('click', () => {
                    this._floorsRango = start;
                    this._floorsLevel = 3;
                    this.renderFloors(player);
                });
                grid.appendChild(btn);
            }
            return;
        }

        // ----- Nivel 3: pisos individuales dentro del rango elegido -----
        const rangoStart = this._floorsRango;
        const rangoEnd = Math.min(rangoStart + 9, this._floorsTier + 99, MAX_FLOOR);
        for (let floor = rangoStart; floor <= rangoEnd && floor <= player.maxFloorReached; floor++) {
            const isCurrent = floor === player.floor;
            const btn = document.createElement('button');
            btn.className = 'floors-btn floors-btn-single' + (isCurrent ? ' current' : '');
            btn.textContent = isCurrent ? `${floor} ★` : `${floor}`;
            btn.addEventListener('click', () => {
                if (this.onTeleportToFloor) this.onTeleportToFloor(floor);
            });
            grid.appendChild(btn);
        }
    },

    // Fundido de pantalla (fade out -> fade in) para la teletransportación
    // entre pisos: ejecuta `onMidFade` (el cambio real de piso) mientras la
    // pantalla está en negro, después se desvanece de nuevo.
    playTeleportFade(onMidFade) {
        const overlay = document.getElementById('teleport-fade');
        overlay.classList.remove('hidden', 'fade-in');
        overlay.classList.add('fade-out');
        setTimeout(() => {
            if (onMidFade) onMidFade();
            overlay.classList.remove('fade-out');
            overlay.classList.add('fade-in');
            setTimeout(() => {
                overlay.classList.add('hidden');
                overlay.classList.remove('fade-in');
            }, 300);
        }, 300);
    },

    renderGuide() {
        const el = document.getElementById('guide-list');

        const section = (title, bodyHTML) => `
            <div class="guide-section">
                <div class="guide-section-title">${title}</div>
                ${bodyHTML}
            </div>
        `;

        // ----- 0) Controles (antes en la barra inferior, ver #hint-bar) -----
        const controlesHTML = `
            <div class="guide-controls-list">
                <div class="guide-control-row"><b>WASD / Flechas</b><span>Mover</span></div>
                <div class="guide-control-row"><b>Click / Espacio</b><span>Combate / Recolectar</span></div>
                <div class="guide-control-row"><b>Click / Espacio</b><span>cerca del Portal 🌀</span></div>
                <div class="guide-control-row"><b>I</b><span>Inventario</span></div>
                <div class="guide-control-row"><b>E</b><span>Encantar</span></div>
                <div class="guide-control-row"><b>M</b><span>Mapa</span></div>
                <div class="guide-control-row"><b>C</b><span>Crafteo</span></div>
                <div class="guide-control-row"><b>V</b><span>Estadísticas</span></div>
                <div class="guide-control-row"><b>P</b><span>Pisos</span></div>
                <div class="guide-control-row"><b>G</b><span>Guía</span></div>
                <div class="guide-control-row"><b>ESC</b><span>Menú (o cerrar la ventana abierta)</span></div>
                <div class="guide-control-row"><b>1-3 / Espacio</b><span>Ataques / Pasar turno (en combate)</span></div>
                <div class="guide-control-row"><b>G</b><span>Poción (en combate)</span></div>
            </div>
        `;

        // ----- 1) Niveles del jugador y sus 10 Tiers -----
        const tierRows = TIERS.map(t => `
            <tr>
                <td>${t.id}</td>
                <td><span style="color:${t.color}">${t.emoji} ${t.name}</span></td>
                <td>${t.levelMin}-${t.levelMax}</td>
                <td>x${t.mult}</td>
            </tr>
        `).join('');
        const nivelesHTML = `
            <div class="guide-text">
                El nivel del jugador va de 1 a ${MAX_LEVEL} (XP unificada: combate, recolección, encantamiento). Cada nivel otorga ${STAT_POINTS_PER_LEVEL} puntos de estadística y +10 de vida máxima, curando al 100%.
                El nivel determina el <b>Tier</b> del arma/armadura "automática" (sin craftear): 10 tiers de exactamente 100 niveles cada uno.
            </div>
            <div class="guide-table-wrap">
                <table class="guide-table">
                    <tr><th>Tier</th><th>Nombre</th><th>Niveles</th><th>Multiplicador daño/def.</th></tr>
                    ${tierRows}
                </table>
            </div>
        `;

        // ----- 2) Pisos y Tiers de recursos (mena / madera / hierba / cultivo) -----
        const recursoRows = MATERIAL_TIER_BRACKETS.map(b => {
            const tier = TIERS.find(t => t.id === b.tierId);
            const wood = WOOD_TIERS.find(w => w.id === b.tierId);
            const herb = HERB_TIERS.find(h => h.id === b.tierId);
            const food = FOOD_TIERS.find(f => f.id === b.tierId);
            return `
                <tr>
                    <td>${b.tierId}</td>
                    <td>${b.min}-${b.max}</td>
                    <td><span style="color:${tier.color}">${tier.emoji} ${tier.name.charAt(0) + tier.name.slice(1).toLowerCase()}</span></td>
                    <td>🌳 ${wood.name.replace('Madera de ', '')}</td>
                    <td>${herb.emoji} ${herb.name}</td>
                    <td>${food.resourceEmoji} ${food.resourceName}</td>
                </tr>
            `;
        }).join('');
        const pisosHTML = `
            <div class="guide-text">
                La mazmorra tiene ${MAX_FLOOR} pisos. Cada 100 pisos sube el <b>Tier de Material</b> del piso (mena, madera, hierba medicinal y cultivo para alimentos), en los mismos 10 tiers de arriba — solo que acá el disparador es el PISO en vez del nivel.
                Los nodos de recolección de ese piso siempre dan el material del Tier correspondiente.
            </div>
            <div class="guide-table-wrap">
                <table class="guide-table">
                    <tr><th>Tier</th><th>Pisos</th><th>Mena</th><th>Madera</th><th>Hierba</th><th>Cultivo</th></tr>
                    ${recursoRows}
                </table>
            </div>
        `;

        // ----- 3) Núcleos de monstruo: rareza x tier + drop progresivo -----
        const rangoRows = [];
        for (let rango = 1; rango <= 10; rango++) {
            const floorStart = (rango - 1) * 10 + 1;
            const floorEnd = rango * 10;
            const maxAdicionales = rango - 1;
            rangoRows.push(`
                <tr>
                    <td>${floorStart}-${floorEnd}</td>
                    <td>${maxAdicionales === 0 ? '—' : `hasta ${maxAdicionales}, prob. escalando 10%→100%`}</td>
                    <td>1-${1 + maxAdicionales}</td>
                </tr>
            `);
        }
        const nucleosHTML = `
            <div class="guide-text">
                Cada enemigo derrotado suelta <b>Núcleos de Monstruo</b>, con la misma Rareza que el enemigo y el Tier de material del piso actual (ej. "Núcleo Raro Tier 3"). El drop se reinicia cada 100 pisos junto con el Tier:
                dentro de cada bloque de 100 pisos hay 10 "rangos" de 10 pisos; en el rango N se pueden dropear hasta N-1 núcleos adicionales (además de 1 garantizado), cada uno con una probabilidad independiente que escala 10%..100% según qué tan adentro del rango esté el piso.
                En el último piso de cada Tier (100, 200, 300... ${MAX_FLOOR}) cada enemigo suelta 10 núcleos garantizados.
            </div>
            <div class="guide-table-wrap">
                <table class="guide-table">
                    <tr><th>Rango (relativo al Tier)</th><th>Núcleos adicionales</th><th>Rango total por enemigo</th></tr>
                    ${rangoRows.join('')}
                </table>
            </div>
        `;

        // ----- 4) Rarezas -----
        const rarezaRows = MONSTER_RARITIES.map(r => `
            <tr>
                <td><span style="color:${r.color}">${r.name}</span></td>
                <td>${r.chance}%</td>
                <td>x${Math.round(r.mult * 1000) / 1000}</td>
            </tr>
        `).join('');
        const rarezasHTML = `
            <div class="guide-text">
                Cada enemigo (y sus núcleos, ítems crafteados, monturas, etc.) tiene una de estas 6 Rarezas, sorteada al generarse. A mayor rareza, más fuerte el enemigo y mejor el objeto resultante.
            </div>
            <div class="guide-table-wrap">
                <table class="guide-table">
                    <tr><th>Rareza</th><th>Probabilidad</th><th>Multiplicador</th></tr>
                    ${rarezaRows}
                </table>
            </div>
        `;

        // ----- 5) Monturas -----
        const monturaRows = MOUNTS.map(m => {
            const cost = getMountCraftCost(m.tierId);
            return `
                <tr>
                    <td>${m.tierId}</td>
                    <td>${m.emoji} ${m.name}</td>
                    <td>+${m.baseSpeedPercent}% (hasta +${m.baseSpeedPercent + 10}% con núcleo Mítico)</td>
                    <td>${cost.ore} mena + ${cost.wood} madera + ${cost.nucleo} núcleos (Tier ${m.tierId})</td>
                </tr>
            `;
        }).join('');
        const monturasHTML = `
            <div class="guide-text">
                Las monturas (panel de Crafteo, tecla C) se craftean con mena + madera del mismo Tier, más núcleos de ESE Tier — la Rareza del núcleo elegido suma velocidad extra (Común +0% .. Mítico +10%, de a 2% por escalón). Solo se puede equipar 1 a la vez; se ve como un anillo del color del Tier alrededor del jugador.
            </div>
            <div class="guide-table-wrap">
                <table class="guide-table">
                    <tr><th>Tier</th><th>Montura</th><th>Velocidad</th><th>Costo</th></tr>
                    ${monturaRows}
                </table>
            </div>
        `;

        // ----- 6) Encantamientos -----
        const encantamientosHTML = `
            <div class="guide-text">
                Solo las armas CRAFTEADAS (tienen Rareza y Tier propios) se pueden encantar (banco de encantamientos, tecla E). El núcleo usado para pagar el encantamiento debe ser de la MISMA Rareza que el arma, y de Tier igual o superior al Tier del arma (a Tier 10 solo sirven núcleos Tier 10). El costo en núcleos por nivel de encantamiento es menor cuanto más rara es el arma.
            </div>
        `;

        el.innerHTML =
            section('🎮 Controles', controlesHTML) +
            section('📊 Niveles y Tiers del jugador', nivelesHTML) +
            section('🏰 Pisos y Tiers de recursos', pisosHTML) +
            section('💠 Núcleos de Monstruo', nucleosHTML) +
            section('🌈 Rarezas', rarezasHTML) +
            section('🐴 Monturas', monturasHTML) +
            section('✨ Encantamientos', encantamientosHTML);
    },
};
