// ===== COMBATE POR TURNOS =====
// Se inicia al hacer click sobre un enemigo cercano en el mundo. Usa
// iniciativa (d20) para ordenar los turnos. En su turno, el jugador puede
// encadenar varios ataques básicos mientras le alcancen los Puntos de Acción
// (se reinician a BASE_AP al empezar su turno), y una vez acumulada suficiente
// carga puede usar el ataque especial del arma, o terminar el turno
// manualmente. Los enemigos responden automáticamente.

const Combat = {
    active: false,
    player: null,
    enemies: [],       // enemigos participantes en este combate
    order: [],          // [{kind:'player'|'enemy', ref?, initiative}]
    turnIndex: 0,
    selectedTarget: null,
    log: [],
    loot: null,          // { xp, defeated: [{emoji,name}], materials: {id: {name,emoji,qty}} }
    onResolve: null,
    onKillHook: null,     // (enemyInstance) => void; lo setea game.js para el spawn dinámico de jefes
    xpPenalty: 1,         // maldición de jefe (curseXpDown) reduce esto durante el combate

    playerAP: 0,
    playerCharge: 0,
    potionUsesLeft: 0,     // máximo 3 pociones por combate, sin importar cuántas tenga en el bolso
    usedPotionThisTurn: false, // máximo 1 poción por turno
    basicAttacksThisTurn: 0, // ataques básicos (0/1) usados en el turno actual, para Golpe Devastador

    // ----- CARGAS DE CLASE (Ataque 1 otorga, Ataque 2 consume) -----
    // Guerrero=PODER, Bárbaro=SED DE SANGRE, Arquero=ENFOQUE, Mago=
    // AMPLIFICACIÓN ARCANA. Máximo 3, se resetea cada combate nuevo. Es un
    // recurso DISTINTO del viejo playerCharge/chargeRequired (que sigue
    // gateando el Ataque 3 especial de esas mismas clases sin cambios).
    classCharge: { prof: null, count: 0 },

    classChargeGain(profId) {
        if (this.classCharge.prof !== profId) this.classCharge = { prof: profId, count: 0 };
        this.classCharge.count = Math.min(3, this.classCharge.count + 1);
        return this.classCharge.count;
    },

    classChargeConsume(profId) {
        if (this.classCharge.prof !== profId) return 0;
        const count = this.classCharge.count;
        this.classCharge = { prof: profId, count: 0 };
        return count;
    },

    start(player, enemyList, onResolve) {
        this.player = player;
        this.enemies = enemyList;
        this.onResolve = onResolve;
        this.log = [];
        this.loot = { xp: 0, gold: 0, defeated: [], materials: {} };
        this.xpPenalty = 1;
        this.player.shield = null;
        this.playerAP = BASE_AP + this.player.getFoodPABonus();
        this.playerCharge = 0;
        this.potionUsesLeft = 3;
        this.usedPotionThisTurn = false;
        this.basicAttacksThisTurn = 0;
        this.classCharge = { prof: null, count: 0 };
        this.tauntTurnsLeft = 0;

        const entries = [{ kind: 'player', initiative: rollD20() }];
        enemyList.forEach(e => entries.push({ kind: 'enemy', ref: e, initiative: rollD20() }));
        entries.sort((a, b) => b.initiative - a.initiative);

        this.order = entries;
        this.turnIndex = 0;
        this.selectedTarget = enemyList[0] || null;
        this.active = true;

        this.addLog('⚔️ ¡Combate iniciado!');
        entries.forEach(e => {
            if (e.kind === 'player') this.addLog(`🎲 Tu iniciativa: ${e.initiative}`);
            else this.addLog(`🎲 ${e.ref.type.emoji} ${e.ref.type.name} iniciativa: ${e.initiative}`);
        });
        if (enemyList.some(e => e.type.isBoss)) {
            this.addLog('👑 ¡JEFE DETECTADO!');
        }

        UI.showCombatPanel();
        this.processNext();
    },

    addLog(text) {
        this.log.push(text);
        if (this.log.length > 60) this.log.shift();
    },

    isPlayerTurn() {
        return this.active && this.order[this.turnIndex].kind === 'player';
    },

    getAliveEnemies() {
        return this.enemies.filter(e => e.alive);
    },

    ensureValidTarget() {
        const alive = this.getAliveEnemies();
        if (!this.selectedTarget || !this.selectedTarget.alive) {
            this.selectedTarget = alive[0] || null;
        }
    },

    selectTarget(enemyRef) {
        if (!this.active || !this.isPlayerTurn()) return;
        if (!enemyRef.alive) return;
        this.selectedTarget = enemyRef;
        UI.renderCombat(this);
    },

    getActiveWeaponAttacks() {
        const player = this.player;
        const prof = player.getActiveProfessionDef();
        const crafted = player.getEquippedCraftedItem(prof.id);
        if (crafted) {
            const base = getWeaponAttacksForTier(prof.id, crafted.tierId);
            if (!base) return null;
            return scaleAttacksByMult(base, getMonsterRarity(crafted.rarityId).mult);
        }
        return resolveWeaponAttacks(prof.id, player.level);
    },

    checkEnd() {
        if (this.player.hp <= 0) return 'defeat';
        if (this.getAliveEnemies().length === 0) return 'victory';
        return null;
    },

    advanceTurnPointer() {
        let guard = 0;
        do {
            this.turnIndex = (this.turnIndex + 1) % this.order.length;
            guard++;
        } while (this.order[this.turnIndex].kind === 'enemy' && !this.order[this.turnIndex].ref.alive && guard <= this.order.length);
    },

    processNext() {
        const result = this.checkEnd();
        if (result) { this.end(result); return; }

        this.ensureValidTarget();
        const entry = this.order[this.turnIndex];

        if (entry.kind === 'player') {
            this.usedPotionThisTurn = false;
            this.basicAttacksThisTurn = 0;
            let apBase = BASE_AP;

            if (this.player.burn && this.player.burn.turnsLeft > 0) {
                const burnDmg = this.player.burn.dmg;
                this.player.hp = Math.max(0, this.player.hp - burnDmg);
                this.player.burn.turnsLeft--;
                if (this.player.burn.turnsLeft <= 0) this.player.burn = null;
                this.addLog(`🔥 Sufrís ${burnDmg} HP de quemadura.`);
                const rBurn = this.checkEnd();
                if (rBurn) { this.end(rBurn); return; }
            }

            // Escudo del Tanque: cuenta regresiva por turno propio + curación
            // pasiva (Bulwark Estelar) mientras esté activo; expira solo si
            // no lo rompieron antes por absorción total (ver Player.absorbDamage).
            if (this.player.shield) {
                if (this.player.shield.healPercentPerTurn) {
                    const healAmt = Math.round(this.player.maxHp * this.player.shield.healPercentPerTurn);
                    this.player.heal(healAmt);
                    this.addLog(`💚 Tu escudo restaura ${healAmt} HP.`);
                }
                this.player.shield.turnsLeft--;
                if (this.player.shield.turnsLeft <= 0) {
                    this.player.shield = null;
                    this.addLog('🛡️ Tu escudo se desvanece.');
                }
            }
            if (this.player.frozenNextTurn) {
                apBase = Math.ceil(BASE_AP / 2);
                this.player.frozenNextTurn = false;
                this.addLog('🧊 Tus Puntos de Acción están congelados a la mitad este turno.');
            }
            apBase += this.player.getFoodPABonus();

            const turnRegen = this.player.getFoodTurnRegen();
            if (turnRegen > 0 && this.player.hp > 0) {
                this.player.heal(turnRegen);
                this.addLog(`🍽️ Regeneración de alimentos: +${turnRegen} HP.`);
            }

            this.playerAP = apBase;
            UI.renderCombat(this);
            return;
        }

        UI.renderCombat(this);
        setTimeout(() => {
            if (!this.active) return;
            this.resolveEnemyTurn(entry.ref);
            const r2 = this.checkEnd();
            if (r2) { this.end(r2); return; }
            this.advanceTurnPointer();
            this.processNext();
        }, 900);
    },

    resolveEnemyTurn(enemy) {
        // Tick de efectos de estado (quemadura / sangrado) al empezar su turno.
        const dotParts = [];
        [['burn', '🔥 quemadura'], ['bleed', '🩸 sangrado']].forEach(([key, label]) => {
            const dot = enemy[key];
            if (dot && dot.turnsLeft > 0) {
                enemy.hp = Math.max(0, enemy.hp - dot.dmg);
                dot.turnsLeft--;
                dotParts.push(`${label} -${dot.dmg} HP`);
                if (dot.turnsLeft <= 0) enemy[key] = null;
                if (enemy.hp <= 0) enemy.alive = false;
            }
        });
        if (dotParts.length) this.addLog(`${enemy.type.emoji} ${enemy.type.name}: ${dotParts.join(', ')}`);

        if (!enemy.alive) {
            this.addLog(`💀 ${enemy.type.name} sucumbe a sus heridas.`);
            this.onEnemyDefeated(enemy);
            return;
        }

        if (enemy.defenseMod && enemy.defenseMod.turnsLeft > 0) {
            enemy.defenseMod.turnsLeft--;
            if (enemy.defenseMod.turnsLeft <= 0) enemy.defenseMod = null;
        }

        if (enemy.stunned) {
            enemy.stunned = false;
            this.addLog(`😵 ${enemy.type.name} está aturdido y no puede atacar.`);
            return;
        }

        if (enemy.type.ability) this.tickBossAbility(enemy);
        if (!enemy.alive) return; // por si la habilidad lo mató (no debería, pero por seguridad)

        this.performEnemyAttack(enemy);
        if (enemy.type.ability === 'doubleAttack' && enemy.alive && this.player.hp > 0) {
            this.performEnemyAttack(enemy);
        }

        // Taunt de Golpe de Escudo (ver weapon-attacks.js/playerAttackWithAP):
        // cuenta 3 turnos ENEMIGOS. Este juego no tiene aliados del jugador,
        // así que hoy no cambia a quién atacan (ya solo pueden atacarte a
        // vos); se trackea igual para que el efecto quede correctamente
        // acotado a 3 turnos si en el futuro se agregan aliados.
        if (this.tauntTurnsLeft > 0) {
            this.tauntTurnsLeft--;
            if (this.tauntTurnsLeft <= 0) this.addLog('😤 El Taunt del Tanque termina.');
        }
    },

    // Ejecuta un golpe del enemigo contra el jugador (usado también por
    // doubleAttack). Orden de evaluación defensiva (ver constants.js):
    // 1) Bloqueo (Constitución, máx 40%, -50% daño si se activa)
    // 2) si no bloqueó: Esquiva (Agilidad, máx 40%, evita el daño por completo)
    // 3) si no esquivó: recibe daño
    // 4) INDEPENDIENTEMENTE de lo anterior: Contraataque (Agilidad, máx
    //    100%), evaluado después de recibir (o evitar) el daño.
    performEnemyAttack(enemy) {
        let baseDmg = enemy.type.dmg;
        if (enemy.attackMod && enemy.attackMod.turnsLeft > 0) {
            baseDmg = Math.max(1, baseDmg - enemy.attackMod.flat);
            enemy.attackMod.turnsLeft--;
            if (enemy.attackMod.turnsLeft <= 0) enemy.attackMod = null;
        }
        if (enemy.type.ability === 'damageMultiplier') baseDmg = Math.round(baseDmg * 1.6);

        const player = this.player;
        const shield = player.shield;
        // Resistencia del Tanque (cargas activas, ver Combat.classCharge):
        // +5% bloqueo por carga, acumulativo mientras no se consuman.
        const resistenciaCharges = (this.classCharge.prof === 'tanque') ? this.classCharge.count : 0;
        const blockChance = Math.min(MAX_BLOCK_CHANCE,
            player.stats.constitucion * STAT_CONSTITUCION_BLOCK_CHANCE
            + resistenciaCharges * 0.05
            + (shield && shield.blockBonusPercent ? shield.blockBonusPercent : 0));
        const dodgeChance = Math.min(MAX_DODGE_CHANCE,
            player.stats.agilidad * STAT_AGILIDAD_DODGE_CHANCE
            + (shield && shield.dodgeBonusChance ? shield.dodgeBonusChance : 0));

        let dmg = 0, blocked = false, dodged = false, incomingRaw = 0;
        if (Math.random() < blockChance) {
            blocked = true;
            incomingRaw = baseDmg * (1 - BLOCK_DAMAGE_REDUCTION);
        } else if (Math.random() < dodgeChance) {
            dodged = true;
        } else {
            incomingRaw = baseDmg;
        }

        if (!dodged) {
            // Fortaleza de Hierro+ (ver weapon-attacks.js): reduce el daño
            // enemigo un % adicional mientras el escudo esté activo.
            if (shield && shield.enemyDmgReducePercent) incomingRaw *= (1 - shield.enemyDmgReducePercent);
            dmg = player.absorbDamage(incomingRaw);
        }

        const note = blocked ? ` (¡bloqueado! -${Math.round(BLOCK_DAMAGE_REDUCTION * 100)}%)` : dodged ? ' (¡esquivado!)' : '';
        this.addLog(`${enemy.type.emoji} ${enemy.type.name} ataca: -${dmg} HP${note}`);

        // Habilidades on-hit del enemigo: solo si el golpe realmente conectó.
        if (!dodged) {
            if (enemy.type.ability === 'lifesteal') {
                const healAmt = Math.round(dmg * 0.2);
                enemy.hp = Math.min(enemy.maxHp, enemy.hp + healAmt);
                this.addLog(`🩸 ${enemy.type.name} absorbe ${healAmt} HP.`);
            }
            if (enemy.type.ability === 'burnOnHit') {
                this.player.burn = { dmg: Math.max(1, Math.round(enemy.type.dmg * 0.1)), turnsLeft: 2 };
                this.addLog('🔥 Quedás quemado.');
            }
            if (enemy.type.ability === 'freezeHalfAP') {
                this.player.frozenNextTurn = true;
                this.addLog('🧊 Sentís que tus movimientos se congelan.');
            }

            // Muralla de Acero+: refleja un % del golpe recibido (antes de
            // absorción/armadura) de vuelta al atacante.
            if (shield && shield.reflectPercent && enemy.alive) {
                const reflectDmg = incomingRaw * shield.reflectPercent;
                const dealt = enemy.takeDamage(reflectDmg, { flatPenetration: player.stats.destreza * STAT_DESTREZA_ARMOR_PEN });
                this.addLog(`🪞 Tu escudo refleja: -${dealt} HP a ${enemy.type.name}.`);
                if (!enemy.alive) this.onEnemyDefeated(enemy);
            }
            // Escudo Infernal: quema a quien te ataque mientras esté activo.
            if (shield && shield.burnAttacker && enemy.alive) {
                enemy.burn = { dmg: shield.burnAttacker.dmg, turnsLeft: shield.burnAttacker.turns };
                this.addLog(`🔥 Tu escudo infernal quema a ${enemy.type.name}.`);
            }
        }

        // Contraataque: Agilidad (base) + Contrataque Mortal (encantamiento,
        // ver enchantments.js) se suman en una sola tirada.
        if (enemy.alive) {
            const eff = player.getActiveEnchantEffects();
            const counterChance = Math.min(MAX_COUNTER_CHANCE, player.stats.agilidad * STAT_AGILIDAD_COUNTER_CHANCE + eff.counterChance);
            if (Math.random() < counterChance) {
                const counterPercent = Math.max(DEFAULT_COUNTER_DAMAGE_PERCENT, eff.counterDamagePercent || 0);
                const counterDmg = player.getDamage() * counterPercent;
                const dealt = enemy.takeDamage(counterDmg, {
                    penetratePercent: eff.counterIgnoreDefensePercent || 0,
                    flatPenetration: player.stats.destreza * STAT_DESTREZA_ARMOR_PEN,
                });
                this.addLog(`↩️ Contraataque: -${dealt} HP a ${enemy.type.name}.`);
                if (!enemy.alive) this.onEnemyDefeated(enemy);
            }
        }
    },

    // Habilidades que se activan al INICIO del turno del jefe (antes de atacar).
    tickBossAbility(enemy) {
        const ability = enemy.type.ability;
        enemy.abilityState.turnsSinceUse = (enemy.abilityState.turnsSinceUse || 0) + 1;

        if (ability === 'regen' && enemy.hp < enemy.maxHp) {
            const healAmt = Math.max(1, Math.round(enemy.maxHp * 0.05));
            enemy.hp = Math.min(enemy.maxHp, enemy.hp + healAmt);
            this.addLog(`💚 ${enemy.type.name} regenera ${healAmt} HP.`);
        }
        if (ability === 'summonMinions' && enemy.abilityState.turnsSinceUse % 3 === 0) {
            this.spawnMinion(enemy);
        }
        if (ability === 'damageShield') {
            if (enemy.abilityState.shieldTurnsLeft > 0) {
                enemy.abilityState.shieldTurnsLeft--;
            } else if (enemy.abilityState.turnsSinceUse % 3 === 0) {
                enemy.abilityState.shieldTurnsLeft = 2;
                this.addLog(`🛡️ ${enemy.type.name} se protege (-50% daño por 2 turnos).`);
            }
        }
        if (ability === 'curseXpDown' && enemy.abilityState.turnsSinceUse === 1) {
            this.xpPenalty = 0.5;
            this.addLog(`💀 ${enemy.type.name} te maldice: -50% XP ganado en este combate.`);
        }
    },

    spawnMinion(boss) {
        const count = 1 + Math.floor(Math.random() * 3); // 1-3
        for (let i = 0; i < count; i++) {
            const minionType = {
                id: 'esbirro', name: 'Esbirro', emoji: '👤',
                hp: Math.max(5, Math.round(boss.maxHp * 0.08)),
                dmg: Math.max(1, Math.round(boss.type.dmg * 0.3)),
                xp: Math.max(1, Math.round(boss.type.xp * 0.05)),
                defense: 0, radius: 12, color: '#666666',
            };
            const minion = new Enemy(minionType, boss.x + (Math.random() - 0.5) * 40, boss.y + (Math.random() - 0.5) * 40);
            this.enemies.push(minion);
            this.order.splice(this.turnIndex + 1, 0, { kind: 'enemy', ref: minion, initiative: 0 });
        }
        this.addLog(`👤 ${boss.type.name} invoca ${count} esbirro(s)!`);
        UI.renderCombat(this);
    },

    // Aplica un ataque (con sus posibles golpes múltiples / AoE / efectos) y
    // devuelve { totalDamage, lines, hadCrit } para el registro de combate.
    // `extraEffects` (opcional, ver getActiveEnchantEffects en player.js):
    // quemadura/sangrado/reducción de defensa/reducción de daño enemigo
    // ADICIONALES de encantamientos, que se suman a las propias del ataque
    // (cada una con su propia tirada de chance).
    resolveAttackDamage(atk, primaryTarget, extraEffects) {
        const player = this.player;
        const hits = atk.hits || 1;
        const targets = atk.aoe ? this.getAliveEnemies() : [primaryTarget];
        let totalDamage = 0;
        let hadCrit = false;
        const lines = [];
        const extra = extraEffects || {};

        targets.forEach(target => {
            for (let h = 0; h < hits; h++) {
                if (!target.alive) break;

                let dmg = atk.damage;
                let crit = false;
                if (atk.critChance && Math.random() < atk.critChance) {
                    dmg = dmg * (atk.critMultiplier || 1.5);
                    crit = true;
                    hadCrit = true;
                }
                if (extra.bonusVsHigherHP && target.hp > player.hp) {
                    dmg *= (1 + extra.bonusVsHigherHP);
                }

                const dealt = target.takeDamage(dmg, { penetratePercent: atk.penetratePercent || 0, flatPenetration: atk.flatPenetration || 0 });
                totalDamage += dealt;
                lines.push(`${crit ? '💢crít ' : ''}${target.type.name} -${dealt} HP`);

                if (atk.burn && (atk.burn.chance === undefined || Math.random() < atk.burn.chance)) {
                    target.burn = { dmg: atk.burn.dmg, turnsLeft: atk.burn.turns };
                    lines.push(`🔥${target.type.name} quemado`);
                }
                if (atk.bleed && (atk.bleed.chance === undefined || Math.random() < atk.bleed.chance)) {
                    target.bleed = { dmg: atk.bleed.dmg, turnsLeft: atk.bleed.turns };
                    lines.push(`🩸${target.type.name} sangrando`);
                }
                if (atk.stun && (atk.stun.chance === undefined || Math.random() < atk.stun.chance)) {
                    target.stunned = true;
                    lines.push(`😵${target.type.name} aturdido`);
                }
                if (atk.defenseDownPercent || atk.defenseDownFlat) {
                    target.defenseMod = { percent: atk.defenseDownPercent || 0, flat: atk.defenseDownFlat || 0, turnsLeft: atk.defenseDownTurns || 1 };
                    lines.push(`🛡️⬇️${target.type.name}`);
                }
                if (atk.attackDownFlat) {
                    target.attackMod = { flat: atk.attackDownFlat, turnsLeft: atk.attackDownTurns || 1 };
                    lines.push(`⚔️⬇️${target.type.name}`);
                }
                if (atk.attackDownPercent) {
                    target.attackMod = { flat: Math.round(target.type.dmg * atk.attackDownPercent), turnsLeft: atk.attackDownTurns || 1 };
                    lines.push(`⚔️⬇️${target.type.name}`);
                }

                // Encantamientos: quemadura/sangrado/debuffs adicionales.
                (extra.burns || []).forEach(b => {
                    if (Math.random() < (b.chance === undefined ? 1 : b.chance)) {
                        target.burn = { dmg: b.dmg, turnsLeft: b.turns };
                        lines.push(`🔥${target.type.name} quemado`);
                    }
                });
                (extra.bleeds || []).forEach(b => {
                    if (Math.random() < (b.chance === undefined ? 1 : b.chance)) {
                        target.bleed = { dmg: b.dmg, turnsLeft: b.turns };
                        lines.push(`🩸${target.type.name} sangrando`);
                    }
                });
                (extra.defenseDownOnHits || []).forEach(d => {
                    if (Math.random() < (d.chance === undefined ? 1 : d.chance)) {
                        target.defenseMod = { percent: d.percent || 0, flat: 0, turnsLeft: d.turns || 1 };
                        lines.push(`🛡️⬇️${target.type.name}`);
                    }
                });
                (extra.enemyDmgDownOnHits || []).forEach(d => {
                    if (Math.random() < (d.chance === undefined ? 1 : d.chance)) {
                        target.attackMod = { flat: Math.round(target.type.dmg * (d.percent || 0)), turnsLeft: d.turns || 1 };
                        lines.push(`⚔️⬇️${target.type.name}`);
                    }
                });
                if (extra.onHitHeal) player.heal(extra.onHitHeal);
                if (extra.onCritHeal && crit) player.heal(extra.onCritHeal);

                if (!target.alive) {
                    this.onEnemyDefeated(target);
                } else if (target.type.ability === 'counterattack') {
                    const counterDmg = this.player.takeDamage(Math.round(target.type.dmg * 0.5));
                    lines.push(`↩️ ${target.type.name} contraataca: -${counterDmg} HP (vos)`);
                }
            }
        });

        if (atk.extraRandomHit) {
            const alive = this.getAliveEnemies();
            if (alive.length) {
                const randomTarget = alive[Math.floor(Math.random() * alive.length)];
                const dealt = randomTarget.takeDamage(atk.extraRandomHit.damage, { flatPenetration: atk.flatPenetration || 0 });
                totalDamage += dealt;
                lines.push(`🌠extra ${randomTarget.type.name} -${dealt} HP`);
                if (!randomTarget.alive) this.onEnemyDefeated(randomTarget);
            }
        }

        if (atk.heal) {
            player.heal(atk.heal);
            lines.push(`+${atk.heal} HP`);
        }

        return { totalDamage, lines, hadCrit };
    },

    // Encantamientos de "golpe extra" (ver enchantments.js): cadena a
    // enemigos cercanos, AoE a todos, o ataques adicionales repetidos sobre
    // el mismo objetivo. Cada uno tira su propia chance; el daño es un %
    // del daño base del ataque (`atkDamage`, ya con los bonos aplicados).
    // Golpes simples, sin re-disparar efectos de estado para no encadenar
    // recursivamente encantamientos sobre sí mismos.
    applyEnchantBonusHits(eff, atkDamage, primaryTarget) {
        let totalDamage = 0;
        const lines = [];

        (eff.chains || []).forEach(c => {
            if (Math.random() >= c.chance) return;
            const others = this.getAliveEnemies().filter(e => e !== primaryTarget);
            others.slice(0, c.count).forEach(t => {
                const dealt = t.takeDamage(atkDamage * c.damagePercent);
                totalDamage += dealt;
                lines.push(`⚡cadena ${t.type.name} -${dealt} HP`);
                if (!t.alive) this.onEnemyDefeated(t);
            });
        });

        (eff.aoeAlls || []).forEach(a => {
            if (Math.random() >= a.chance) return;
            this.getAliveEnemies().filter(e => e !== primaryTarget).forEach(t => {
                const dealt = t.takeDamage(atkDamage * a.damagePercent);
                totalDamage += dealt;
                lines.push(`💥AoE ${t.type.name} -${dealt} HP`);
                if (!t.alive) this.onEnemyDefeated(t);
            });
        });

        (eff.extraAttacksList || []).forEach(ex => {
            if (Math.random() >= ex.chance) return;
            for (let i = 0; i < ex.count; i++) {
                if (!primaryTarget.alive) break;
                const dealt = primaryTarget.takeDamage(atkDamage * ex.damagePercent);
                totalDamage += dealt;
                lines.push(`🔁extra ${primaryTarget.type.name} -${dealt} HP`);
                if (!primaryTarget.alive) this.onEnemyDefeated(primaryTarget);
            }
        });

        return { totalDamage, lines };
    },

    // attackIndex: 0 y 1 son los ataques básicos (encadenables con PA),
    // 2 es el especial del arma (requiere carga acumulada).
    playerAttack(attackIndex) {
        if (!this.active || !this.isPlayerTurn()) return;
        this.ensureValidTarget();
        const target = this.selectedTarget;
        if (!target) return;

        const weaponAttacks = this.getActiveWeaponAttacks();
        if (weaponAttacks) {
            this.playerAttackWithAP(attackIndex, weaponAttacks, target);
        } else {
            this.playerAttackLegacy(attackIndex, target);
        }
    },

    playerAttackWithAP(attackIndex, weaponAttacks, target) {
        const player = this.player;
        const atk = attackIndex < 2 ? weaponAttacks.basic[attackIndex] : weaponAttacks.special;
        if (!atk) return;

        const eff = player.getActiveEnchantEffects();
        const apCost = Math.max(1, atk.apCost - eff.apCostReduction);
        if (this.playerAP < apCost) return;
        // chargeRequired es opcional: el Pícaro no tiene gate de carga en su
        // especial (ver weapon-attacks.js), solo costo de PA.
        if (attackIndex === 2 && atk.chargeRequired && this.playerCharge < atk.chargeRequired) return;
        if (atk.arrowCost && player.arrows < atk.arrowCost) return;

        this.playerAP -= apCost;
        if (atk.arrowCost) {
            for (let i = 0; i < atk.arrowCost; i++) player.useArrow();
        }

        // Golpe Devastador (Espada, ex-Claymore): bono al segundo ataque básico del
        // turno. attackIndex 2 (especial) no cuenta como básico.
        if (attackIndex < 2) this.basicAttacksThisTurn++;
        const isSecondAttack = attackIndex < 2 && this.basicAttacksThisTurn === 2;

        // Martillazo (Tanque): daño base + Vida_Máxima × coeficiente (ver
        // weapon-attacks.js maxHpDamageCoeff), antes de aplicar Potencia.
        const baseDamage = atk.damage + (atk.maxHpDamageCoeff ? player.maxHp * atk.maxHpDamageCoeff : 0);

        const potenciaMult = 1 + player.stats.potencia * STAT_POTENCIA_DMG_PERCENT;
        let dmg = baseDamage * potenciaMult * (1 + eff.dmgBonusPercent);
        if (isSecondAttack && eff.secondAttackBonusPercent) dmg *= (1 + eff.secondAttackBonusPercent);

        const critBase = getWeaponCritBase(player.activeProfession) + player.stats.suerte * STAT_SUERTE_CRIT_CHANCE;
        const flatPenetration = player.stats.destreza * STAT_DESTREZA_ARMOR_PEN;

        const effectiveAtk = {
            ...atk,
            damage: dmg,
            critChance: critBase + (atk.critChance || 0) + eff.critChanceBonus,
            critMultiplier: Math.max(atk.critMultiplier || 1.5, eff.critMultiplier),
            penetratePercent: Math.min(0.95, (atk.penetratePercent || 0) + eff.ignoreDefensePercent),
            flatPenetration,
        };

        // ----- Cargas de clase: Guerrero=PODER, Bárbaro=SED DE SANGRE,
        // Arquero=ENFOQUE, Mago=AMPLIFICACIÓN ARCANA (ver constants.js /
        // weapon-attacks.js). Ataque 1 (grantsClassCharge) otorga 1 carga
        // (máx 3); Ataque 2 (consumesClassCharge) consume TODAS para un
        // bono propio de cada clase. No afecta el chargeGain/chargeRequired
        // viejo que sigue gateando el Ataque 3 especial (heredado).
        const profId = player.activeProfession;
        let chargeGranted = 0, chargeConsumed = 0;
        if (atk.grantsClassCharge) chargeGranted = this.classChargeGain(profId);
        if (atk.consumesClassCharge) chargeConsumed = this.classChargeConsume(profId);

        let extraLifestealPercent = 0;
        let classNote = '';

        if (profId === 'guerrero' && atk.consumesClassCharge) {
            const mult = [1, 1.25, 1.5, 2.0][chargeConsumed];
            effectiveAtk.damage = dmg * mult;
            classNote = ` · 💪PODER x${chargeConsumed} (+${Math.round((mult - 1) * 100)}% daño)`;
        } else if (profId === 'barbaro') {
            // Potenciador: por debajo del 30% HP, cada carga de Sed de
            // Sangre ACTIVA (antes de otorgar/consumir esta) suma bonos
            // pasivos, sin importar qué ataque se use.
            const activeStacks = this.classCharge.prof === 'barbaro' ? this.classCharge.count : 0;
            if (activeStacks > 0 && player.hp < player.maxHp * 0.3) {
                effectiveAtk.damage += activeStacks;
                effectiveAtk.critChance += activeStacks * 0.001;
                extraLifestealPercent += activeStacks * 0.05;
                classNote += ` · 🔥Potenciado x${activeStacks} (HP<30%)`;
            }
            if (atk.consumesClassCharge) {
                const lifestealPercent = 0.15 + 0.5 * chargeConsumed;
                extraLifestealPercent += lifestealPercent;
                classNote += ` · 🩸SED DE SANGRE x${chargeConsumed} (${Math.round(lifestealPercent * 100)}% robo)`;
            } else if (atk.grantsClassCharge) {
                extraLifestealPercent += 0.15;
            }
        } else if (profId === 'arquero') {
            if (atk.grantsClassCharge && chargeGranted > 0 && Math.random() < chargeGranted * 0.20) {
                this.playerAP += 1;
                classNote = ` · 🎯ENFOQUE x${chargeGranted} (+1 PA devuelto)`;
            } else if (atk.consumesClassCharge) {
                const table = [
                    { mult: 1, targets: 1, armorDown: 0, armorTurns: 0 },
                    { mult: 1, targets: 2, armorDown: 0.10, armorTurns: 2 },
                    { mult: 1.25, targets: 3, armorDown: 0.15, armorTurns: 2 },
                    { mult: 1.5, targets: 4, armorDown: 0.20, armorTurns: 3 },
                ][chargeConsumed];
                effectiveAtk.damage = dmg * table.mult;
                // La AoE del motor golpea a TODOS los enemigos vivos; se usa
                // como aproximación de "N objetivos" (exacta con grupos de
                // hasta 4, que es el tamaño típico de combate).
                if (table.targets > 1) effectiveAtk.aoe = true;
                if (table.armorDown) {
                    effectiveAtk.defenseDownPercent = table.armorDown;
                    effectiveAtk.defenseDownTurns = table.armorTurns;
                }
                classNote = ` · 🎯ENFOQUE x${chargeConsumed} (${table.targets} objetivo${table.targets > 1 ? 's' : ''})`;
            }
        } else if (profId === 'mago') {
            if (atk.grantsClassCharge) {
                effectiveAtk.damage = dmg * (1 + chargeGranted * 0.25);
                if (chargeGranted > 0 && Math.random() < chargeGranted * 0.20) {
                    effectiveAtk._magoReboundCount = chargeGranted;
                    classNote = ` · 📚AMPLIFICACIÓN x${chargeGranted} (rebote)`;
                }
            } else if (atk.consumesClassCharge) {
                effectiveAtk.damage = dmg * (1 + chargeConsumed * 0.25);
                if (chargeConsumed > 0) effectiveAtk._magoReboundCount = chargeConsumed;
                classNote = ` · 📚AMPLIFICACIÓN x${chargeConsumed} (${chargeConsumed + 1} objetivo${chargeConsumed > 0 ? 's' : ''})`;
            }
        } else if (profId === 'tanque' && atk.consumesClassCharge) {
            // Golpe de Escudo: consume RESISTENCIA para más daño + un escudo
            // (% vida máxima, con bono por Tier del arma y por Nivel, ver
            // weapon-attacks.js) + Taunt de 3 turnos. Martillazo
            // (grantsClassCharge) no necesita rama propia: su daño ya
            // incluye el término de Vida Máxima (ver baseDamage arriba).
            const mult = [1, 1.25, 1.5, 2.0][chargeConsumed];
            effectiveAtk.damage = dmg * mult;

            const shieldPercentByCharge = [0.20, 0.25, 0.30, 0.40][chargeConsumed];
            const weaponTierId = player.getCurrentWeapon().tier.id;
            const tierBonus = weaponTierId <= 3 ? 0.05 : (weaponTierId <= 6 ? 0.10 : 0.15);
            const totalPercent = (shieldPercentByCharge + tierBonus) * (1 + player.level * 0.005);
            const shieldAmount = Math.round(player.maxHp * totalPercent);
            player.shield = { amount: shieldAmount, turnsLeft: 3 };
            this.tauntTurnsLeft = 3;
            classNote = ` · 🔰RESISTENCIA x${chargeConsumed} (Escudo +${shieldAmount} HP, Taunt 3 turnos)`;
        }

        // Especiales únicos por Tier del Tanque (Ataque 3, ver
        // weapon-attacks.js "grantsShield"): otorgan su propio escudo,
        // reemplazando cualquier escudo activo. enemyStatsDownPercent
        // (Defensa Divina) se aplica una sola vez, al elenco de enemigos
        // vivos en este momento.
        if (atk.grantsShield) {
            const g = atk.grantsShield;
            player.shield = {
                amount: Math.round(player.maxHp * g.percent),
                turnsLeft: g.turns,
                armorBonusPercent: g.armorBonusPercent,
                enemyDmgReducePercent: g.enemyDmgReducePercent,
                reflectPercent: g.reflectPercent,
                burnAttacker: g.burnAttacker,
                healPercentPerTurn: g.healPercentPerTurn,
                blockBonusPercent: g.blockBonusPercent,
                dodgeBonusChance: g.dodgeBonusChance,
            };
            if (g.enemyStatsDownPercent) {
                this.getAliveEnemies().forEach(en => {
                    en.defenseMod = { percent: g.enemyStatsDownPercent, flat: 0, turnsLeft: 3 };
                    en.attackMod = { flat: Math.round(en.type.dmg * g.enemyStatsDownPercent), turnsLeft: 3 };
                });
            }
            classNote = ` · 🛡️Escudo +${player.shield.amount} HP (${g.turns} turnos)`;
        }

        const { totalDamage, lines, hadCrit } = this.resolveAttackDamage(effectiveAtk, target, eff);

        // Rebote de Amplificación Arcana (Mago): golpea N enemigos vivos
        // adicionales con el mismo daño ya calculado del hechizo principal.
        if (effectiveAtk._magoReboundCount && target.alive !== undefined) {
            const others = this.getAliveEnemies().filter(e => e !== target);
            others.slice(0, effectiveAtk._magoReboundCount).forEach(t => {
                const dealt = t.takeDamage(effectiveAtk.damage, { flatPenetration });
                lines.push(`🌀rebote ${t.type.name} -${dealt} HP`);
                if (!t.alive) this.onEnemyDefeated(t);
            });
        }

        // Salpicadura (Pícaro, ver weapon-attacks.js "splashCount/
        // splashPercent"): golpea N enemigos cercanos adicionales a un % del
        // daño del golpe principal, con el mismo sangrado/quemadura si el
        // ataque los define (mismo chance, tirada independiente por objetivo).
        if (atk.splashCount) {
            const others = this.getAliveEnemies().filter(e => e !== target);
            others.slice(0, atk.splashCount).forEach(t => {
                const splashDmg = effectiveAtk.damage * (atk.splashPercent || 1);
                const dealt = t.takeDamage(splashDmg, { flatPenetration, penetratePercent: effectiveAtk.penetratePercent || 0 });
                lines.push(`💫${t.type.name} -${dealt} HP`);
                if (atk.bleed && (atk.bleed.chance === undefined || Math.random() < atk.bleed.chance)) {
                    t.bleed = { dmg: atk.bleed.dmg, turnsLeft: atk.bleed.turns };
                    lines.push(`🩸${t.type.name} sangrando`);
                }
                if (atk.burn && (atk.burn.chance === undefined || Math.random() < atk.burn.chance)) {
                    t.burn = { dmg: atk.burn.dmg, turnsLeft: atk.burn.turns };
                    lines.push(`🔥${t.type.name} quemado`);
                }
                if (!t.alive) this.onEnemyDefeated(t);
            });
        }

        let bonusTotal = 0;
        if (target.alive) {
            const bonusHits = this.applyEnchantBonusHits(eff, effectiveAtk.damage, target);
            bonusTotal = bonusHits.totalDamage;
            lines.push(...bonusHits.lines);
        }

        // Efectos únicos por ataque (Pícaro, ver weapon-attacks.js): curación
        // propia con probabilidad, restaurar PA al crítico, chance de no
        // consumir PA, y debuff de defensa con probabilidad propia (además
        // del defenseDownPercent normal, que ya aplica siempre en cada hit).
        if (atk.selfHealChance && Math.random() < atk.selfHealChance) {
            player.heal(atk.selfHealAmount || 0);
            lines.push(`+${atk.selfHealAmount} HP`);
        }
        if (hadCrit && atk.critPaRestoreChance && Math.random() < atk.critPaRestoreChance) {
            this.playerAP += atk.critPaRestoreAmount || 1;
            lines.push(`⚡+${atk.critPaRestoreAmount || 1} PA`);
        }
        if (atk.noCostChance && Math.random() < atk.noCostChance) {
            this.playerAP += apCost;
            lines.push('🎁PA gratis');
        }
        if (atk.bonusDefenseDownChance && target.alive && Math.random() < atk.bonusDefenseDownChance) {
            target.defenseMod = { percent: atk.bonusDefenseDownPercent || 0, flat: 0, turnsLeft: atk.bonusDefenseDownTurns || 1 };
            lines.push(`🛡️⬇️${target.type.name}`);
        }

        const arrowNote = atk.arrowCost ? ` · 🏹-${atk.arrowCost}` : '';

        if (attackIndex === 2) {
            this.playerCharge = 0;
            const chargeNote = atk.chargeRequired ? ', carga consumida' : '';
            this.addLog(`💥 ${atk.name} (-${apCost} PA${chargeNote}${arrowNote}${classNote}): ${lines.join(', ')}`);
        } else {
            this.playerCharge += atk.chargeGain || 0;
            const chargeGainNote = atk.chargeGain ? `, +${atk.chargeGain} carga` : '';
            this.addLog(`${atk.emoji} ${atk.name} (-${apCost} PA${chargeGainNote}${arrowNote}${classNote}): ${lines.join(', ')}`);
        }

        const totalDealt = totalDamage + bonusTotal;
        if (eff.lifestealPercent || extraLifestealPercent) {
            const healAmt = Math.round(totalDealt * (eff.lifestealPercent + extraLifestealPercent));
            if (healAmt > 0) {
                player.heal(healAmt);
                this.addLog(`🩸 Robo de vida: recuperas ${healAmt} HP.`);
            }
        }
        if (eff.paRestoreOnHit) this.playerAP += eff.paRestoreOnHit;

        const result = this.checkEnd();
        if (result) { this.end(result); return; }

        // El turno continúa: el jugador puede seguir atacando, bloquear,
        // huir o terminar el turno mientras le alcancen los PA.
        UI.renderCombat(this);
    },

    // Comportamiento anterior para armas que todavía no tienen ataques
    // definidos: un solo ataque termina el turno automáticamente.
    playerAttackLegacy(attackIndex, target) {
        const player = this.player;
        const prof = player.getActiveProfessionDef();
        const attack = getAttacksForProfession(prof.id)[attackIndex];
        let dmg = player.getDamage();
        let note = '';

        if (prof.id === 'arquero') {
            if (player.hasArrows()) {
                player.useArrow();
                note = ' (🏹 -1 flecha)';
            } else {
                dmg = Math.round(dmg * 0.5 * 10) / 10;
                note = ' (sin flechas, golpe débil)';
            }
        }

        const dealt = target.takeDamage(dmg);
        this.addLog(`${attack ? attack.emoji : prof.emoji} ${attack ? attack.name : 'Atacas'} a ${target.type.name}: -${dealt} HP${note}`);

        const lifestealPercent = player.getActiveEnchantEffects().lifestealPercent;
        if (lifestealPercent) {
            const healAmt = Math.round(dealt * lifestealPercent);
            if (healAmt > 0) {
                player.heal(healAmt);
                this.addLog(`🩸 Vampirismo: recuperas ${healAmt} HP.`);
            }
        }

        if (!target.alive) {
            this.onEnemyDefeated(target);
        } else if (target.type.ability === 'counterattack') {
            const counterDmg = this.player.takeDamage(Math.round(target.type.dmg * 0.5));
            this.addLog(`↩️ ${target.type.name} contraataca: -${counterDmg} HP`);
        }

        this.advanceTurnPointer();
        this.processNext();
    },

    // Suma `qty` del material `id` al jugador y al resumen de loot de este combate.
    grantMaterial(id, qty) {
        this.player.gainMaterial(id, qty);
        const info = getMaterialInfo(id);
        if (!this.loot.materials[id]) this.loot.materials[id] = { name: info.name, emoji: info.emoji, qty: 0 };
        this.loot.materials[id].qty += qty;
    },

    // Reparte `totalQty` unidades al azar entre TODOS los recursos del Tier
    // de este piso (mena, madera, hierba, cultivo) en vez de darlas todas
    // del mismo tipo. Usado para el botín de jefes (ver onEnemyDefeated).
    grantRandomTierMaterials(totalQty, tierId) {
        const pool = [`mat_tier_${tierId}`, `madera_tier_${tierId}`, `hierba_tier_${tierId}`, `cultivo_tier_${tierId}`];
        for (let i = 0; i < totalQty; i++) {
            this.grantMaterial(pool[Math.floor(Math.random() * pool.length)], 1);
        }
    },

    onEnemyDefeated(target) {
        const player = this.player;
        const rarity = target.type.rarity || MONSTER_RARITIES[0];
        const bossKind = target.type.bossKind; // undefined | 'minijefe'|'jefe'|'jefe_final'|'jefe_especial'|'jefe_aleatorio'

        // Tamaño de "grupo" (ver GROUP_LOOT_MULT en constants.js): la
        // cantidad de enemigos con la que arrancó ESTE combate
        // (this.enemies no se achica al morir, solo cambia `.alive`), no se
        // recalcula si alguno muere antes que este.
        const groupSize = this.enemies.length;
        const groupMult = getGroupMultiplier(groupSize);
        const gm = qty => Math.max(1, Math.round(qty * groupMult));

        // XP por enemigo: 10 × Piso × Multiplicador_Rareza × Escala_Minijefe_Jefe
        // (ver getEnemyXPReward en constants.js) — reemplaza el viejo
        // target.type.xp escalado por piso.
        const xpGain = Math.round(getEnemyXPReward(player.floor, rarity.id, bossKind) * (this.xpPenalty || 1));
        player.gainXP(xpGain);
        this.loot.xp += xpGain;
        this.loot.defeated.push({ emoji: target.type.emoji, name: target.type.name });

        // Oro: Piso × Multiplicador_Tier ±10% × Tipo × Rareza × Grupo (ver
        // getEnemyGoldReward en constants.js). El multiplicador de grupo ya
        // está incluido adentro de esta función (no se aplica `gm` de nuevo).
        const goldGain = getEnemyGoldReward(player.floor, rarity.id, bossKind, groupSize);
        player.gainGold(goldGain);
        this.loot.gold = (this.loot.gold || 0) + goldGain;

        const materialTierId = getMaterialTierForFloor(player.floor);
        const rarityIdx = MONSTER_RARITIES.findIndex(r => r.id === rarity.id);

        // Pergaminos de teletransportación: solo los sueltan enemigos de
        // rareza Poco Común o superior (probabilidad binaria, no escala con grupo).
        if (rarityIdx >= 1 && Math.random() < 0.08) {
            this.grantMaterial('pergamino_teletransporte', 1);
            this.addLog('📜 ¡Consigues un Pergamino de Teletransportación!');
        }

        // Pergaminos de Alteración: chance por rareza/tipo de enemigo (ver
        // getAlteracionDropInfo en constants.js); el Jefe Final SIEMPRE
        // dropa 1-3 (no escala con grupo, igual que el de teletransportación).
        const alteracion = getAlteracionDropInfo(rarity.id, bossKind);
        if (alteracion.guaranteed || Math.random() < alteracion.chance) {
            const qty = alteracion.guaranteed ? (1 + Math.floor(Math.random() * 3)) : 1;
            this.grantMaterial(`pergamino_alteracion_tier${alteracion.tier}`, qty);
            this.addLog(`☢️ ¡Consigues ${qty > 1 ? qty + ' ' : ''}Pergamino${qty > 1 ? 's' : ''} de Alteración Tier ${alteracion.tier}!`);
        }

        // Núcleos de monstruo: drop progresivo según el piso (se reinicia
        // cada 100 pisos con un nuevo Tier — ver rollNucleoDrops en
        // enchantments.js), de la misma Rareza que el enemigo y el Tier de
        // material del piso actual. Los jefes suman bonus adicional encima.
        const { tierId: nucleoTierId, count: nucleoCount } = rollNucleoDrops(player.floor);
        this.grantMaterial(getNucleoId(rarity.id, nucleoTierId), gm(nucleoCount));
        if (nucleoCount > 1) this.addLog(`💠 +${gm(nucleoCount)} Núcleos ${rarity.name} Tier ${nucleoTierId}`);

        if (bossKind === 'jefe_final') {
            // Loot fijo y masivo, del Tier donde apareció (ver
            // spawnFinalBossAt en game.js): la cantidad de mena/madera
            // escala 50-200 según qué tan adentro de su rango de 10 pisos
            // haya aparecido (pisoEnRango 1 = más débil/menos loot, 10 =
            // más fuerte/más loot); los núcleos son cantidad fija.
            const pisoEnRango = target.type.pisoEnRango || 10;
            const resourceQty = gm(Math.round(50 + ((pisoEnRango - 1) / 9) * 150));
            this.grantMaterial(`mat_tier_${materialTierId}`, resourceQty);
            this.grantMaterial(`madera_tier_${materialTierId}`, resourceQty);

            // 90 núcleos Común/Poco Común/Raro (reparto fijo 45/30/15).
            this.grantMaterial(getNucleoId('comun', materialTierId), gm(45));
            this.grantMaterial(getNucleoId('poco_comun', materialTierId), gm(30));
            this.grantMaterial(getNucleoId('raro', materialTierId), gm(15));

            // 10 núcleos Épico o superior, con garantía de 1 Mítico; los
            // otros 9 se sortean entre Épico/Legendario/Mítico según peso.
            this.grantMaterial(getNucleoId('mitico', materialTierId), gm(1));
            const altoPool = [
                { id: 'epico', weight: 5 },
                { id: 'legendario', weight: 1.5 },
                { id: 'mitico', weight: 0.5 },
            ];
            const totalWeight = altoPool.reduce((s, p) => s + p.weight, 0);
            for (let i = 0; i < 9; i++) {
                let roll = Math.random() * totalWeight;
                let chosen = altoPool[altoPool.length - 1].id;
                for (const p of altoPool) {
                    if (roll < p.weight) { chosen = p.id; break; }
                    roll -= p.weight;
                }
                this.grantMaterial(getNucleoId(chosen, materialTierId), gm(1));
            }

            this.addLog(`👑 ¡Jefe Final derrotado! Botín masivo obtenido (Tier ${materialTierId}, piso ${pisoEnRango}/10 del rango).`);
        } else if (bossKind === 'jefe') {
            this.grantMaterial(getNucleoId(rarity.id, nucleoTierId), gm(5));
            this.grantRandomTierMaterials(gm(30), materialTierId);
            if (rarityIdx >= 0 && rarityIdx < MONSTER_RARITIES.length - 1 && Math.random() < 0.10) {
                this.grantMaterial(getNucleoId(MONSTER_RARITIES[rarityIdx + 1].id, nucleoTierId), gm(1));
                this.addLog('✨ ¡Drop especial: núcleo de rareza superior!');
            }
        } else if (bossKind === 'minijefe') {
            this.grantMaterial(getNucleoId(rarity.id, nucleoTierId), gm(5));
            this.grantRandomTierMaterials(gm(10), materialTierId);
        } else if (bossKind === 'jefe_especial' || bossKind === 'jefe_aleatorio') {
            // Jefes de generación de piso (ver grid-dungeon.js).
            this.grantMaterial(getNucleoId(rarity.id, nucleoTierId), gm(5));
            this.grantRandomTierMaterials(gm(20), materialTierId);
        }

        // El XP y el oro ganados se resaltan con color (Rareza del enemigo
        // para XP, dorado para oro; negrita desde Épico) para que se note
        // de un vistazo en el log de combate, que funciona como el
        // "flotante" de XP/oro en este panel modal por turnos (ver
        // INTERFAZ Y FEEDBACK).
        const boldIfRare = rarityIdx >= 3 ? 'font-weight:bold' : '';
        const xpStyle = `color:${rarity.color};${boldIfRare}`;
        const goldStyle = `color:#ffd700;${boldIfRare}`;
        this.addLog(`💀 ${target.type.name} derrotado. <span style="${xpStyle}">+${xpGain} XP</span> <span style="${goldStyle}">+${goldGain} 🪙</span>`);
        if (this.onKillHook) this.onKillHook(target);
    },

    playerEndTurn() {
        if (!this.active || !this.isPlayerTurn()) return;
        this.addLog('⏭️ Terminás tu turno.');
        this.advanceTurnPointer();
        this.processNext();
    },

    // Usar una poción no cuesta PA ni gasta el turno: máximo 1 por turno y
    // 3 en total por combate (aunque el jugador tenga más en el bolso).
    usePotionInCombat(rarityId) {
        if (!this.active || !this.isPlayerTurn()) return;
        if (this.usedPotionThisTurn || this.potionUsesLeft <= 0) return;
        const healed = this.player.usePotion(rarityId);
        if (healed <= 0) return;
        this.usedPotionThisTurn = true;
        this.potionUsesLeft--;
        this.addLog(`🧪 Usás una Poción de Curación (${getMonsterRarity(rarityId).name}): +${healed} HP.`);
        UI.renderCombat(this);
    },

    end(result) {
        this.active = false;
        if (result === 'victory') {
            UI.showVictoryPanel(this.loot);
            return;
        }
        this.finish(result);
    },

    // Se llama al cerrar la ventana de victoria (o directamente en derrota/huida).
    // Único punto terminal de todo combate: acá se descuenta 1 combate a
    // los buffs de alimentos activos (ver Player.tickFoodBuffsOnCombatEnd).
    finish(result) {
        if (this.player) this.player.tickFoodBuffsOnCombatEnd();
        const cb = this.onResolve;
        this.onResolve = null;
        UI.renderCombat(this);
        if (cb) cb(result);
    },
};
