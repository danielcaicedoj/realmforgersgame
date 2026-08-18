// ===== COMBATE EN TIEMPO REAL =====
// Reemplaza el viejo combate por turnos (iniciativa, PA, pantalla modal):
// ahora el combate ocurre directamente en el mapa. Click izquierdo dispara
// el Ataque 1, click derecho el Ataque 2 (cada uno con su propio cooldown
// en ms, ver RT_ATTACK_COOLDOWNS en constants.js); mantener R carga el
// Ataque 3 (requiere la carga UNIVERSAL al tope, 0-10, otorgada por cada
// Ataque 1 que impacta) y soltar R lo dispara. La carga SECUNDARIA de clase
// (PODER/SED DE SANGRE/ENFOQUE/AMPLIFICACIÓN/RESISTENCIA, máx 3) se
// mantiene igual que antes — solo cambia el disparador. Todas las fórmulas
// de daño (Potencia, crítico, penetración, encantamientos) son las mismas;
// lo único nuevo es CUÁNDO y CONTRA QUIÉN se aplican (geometría de cono/
// círculo en vez de "el objetivo seleccionado", ver RT_ATTACK_GEOMETRY).
//
// Los enemigos ya no son estáticos (ver enemy.js): persiguen y atacan solos
// con su propio timer; Combat.updateRealtime() los tickea cada frame y
// resuelve sus ataques (performEnemyAttackRT), reusando la misma lógica de
// bloqueo/esquiva/contraataque de antes.
//
// Alcance acordado con el usuario para esta reescritura: los ~49 efectos
// visuales únicos por tier/clase de la especificación completa se
// consolidan en 1 tratamiento visual por clase y slot (cono para Ataque
// 1/2, círculo para el especial); Arquero/Mago pierden sus mecánicas de
// "más objetivos discretos por carga" (la geometría ya golpea varios
// enemigos por sí sola) a cambio de un multiplicador de daño más simple,
// igual que Guerrero/Tanque; el Taunt del Tanque queda solo cosmético (ya
// era mecánicamente inerte, este juego no tiene aliados); no hay sistema
// de sonido (el proyecto no tenía ninguno).

const RT_CHARGE_RING_MS = 400; // cuánto tarda en llenarse el anillo visual de carga del Ataque 3 mientras se mantiene R
const RT_POTION_COOLDOWN_MS = 2000; // reemplaza el viejo límite "3 por combate / 1 por turno"

const Combat = {
    player: null,
    enemies: [], // referencia viva al array de enemigos del piso actual (se refresca cada updateRealtime)

    cooldownUntil: [0, 0, 0], // timestamps por slot [Ataque1, Ataque2, Ataque3]
    charge: 0,                 // carga universal 0-10 (Ataque 3)
    charging: false,           // manteniendo R con 10 cargas
    chargeStartAt: 0,

    // Carga secundaria de clase: Guerrero=PODER, Bárbaro=SED DE SANGRE,
    // Arquero=ENFOQUE, Mago=AMPLIFICACIÓN ARCANA, Tanque=RESISTENCIA.
    classCharge: { prof: null, count: 0 },

    potionCooldownUntil: 0,

    onKillHook: null,       // (enemyInstance) => void; lo setea game.js para el spawn dinámico de jefes
    spawnFloatingText: null, // (x,y,text,color,life?) => void; lo setea game.js (ver addFloatingText)
    _basicStreak: 0,         // racha de ataques básicos consecutivos (Golpe Devastador, ver resolvePlayerAttack)

    effects: [], // efectos visuales activos (conos/círculos/partículas/impactos), ver renderEffects

    init(player) {
        this.player = player;
        this.enemies = [];
        this.cooldownUntil = [0, 0, 0];
        this.charge = 0;
        this.charging = false;
        this.classCharge = { prof: null, count: 0 };
        this.potionCooldownUntil = 0;
        this._basicStreak = 0;
        this.effects = [];
    },

    // "En combate" para gatear otras acciones (recolectar, abrir cofres,
    // portales, Taberna) — igual que antes, pero ahora es un valor
    // calculado en vez de un flag manual: hay al menos un enemigo
    // persiguiendo o atacando cerca.
    get active() {
        if (!this.player) return false;
        return this.enemies.some(en => en.alive
            && (en.aiState === 'attacking' || en.aiState === 'chasing')
            && Math.hypot(en.x - this.player.x, en.y - this.player.y) <= ENEMY_VISUAL_RANGE);
    },

    classChargeGain(profId) {
        if (this.classCharge.prof !== profId) this.classCharge = { prof: profId, count: 0 };
        this.classCharge.count = Math.min(RT_CLASS_CHARGE_MAX, this.classCharge.count + 1);
        return this.classCharge.count;
    },

    classChargeConsume(profId) {
        if (this.classCharge.prof !== profId) return 0;
        const count = this.classCharge.count;
        this.classCharge = { prof: profId, count: 0 };
        return count;
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

    // ----- TICK PRINCIPAL (llamado cada frame desde game.js/update, solo
    // mientras no haya paneles abiertos — mismo criterio que el resto del
    // juego) -----
    updateRealtime(dt, enemies, player, dungeon) {
        this.enemies = enemies;
        this.player = player;
        const now = Date.now();

        // Anillo de carga del Ataque 3: se dispara solo al completarse,
        // aunque el jugador siga manteniendo R (ver bindInput en game.js).
        if (this.charging && now - this.chargeStartAt >= RT_CHARGE_RING_MS) {
            this.fireCharge();
        }

        enemies.forEach(en => {
            if (!en.alive) return;
            en.update(dt, player, (x, y, r) => dungeon.isWalkable(x, y, r));
            if (!en.alive) {
                if (!en._deathHandled) { en._deathHandled = true; this.onEnemyDefeated(en); }
                return;
            }
            if (en.aiState === 'attacking' && now >= en.nextAttackAt) {
                this.performEnemyAttackRT(en);
                if (!en.alive) { en._deathHandled = true; return; }
                const [minD, maxD] = ENEMY_ATTACK_DELAY_MS;
                en.nextAttackAt = now + minD + Math.random() * (maxD - minD);
            }
        });
    },

    // ----- DISPARO DE ATAQUES DEL JUGADOR -----
    // slot: 0 (click izquierdo), 1 (click derecho), 2 (especial, vía R).
    tryAttack(slot, aimWorldPos) {
        if (!this.player || this.player.hp <= 0) return false;
        const now = Date.now();
        if (now < this.cooldownUntil[slot]) return false;
        if (slot === 2 && this.charge < RT_CHARGE_MAX) return false;

        const weaponAttacks = this.getActiveWeaponAttacks();
        if (!weaponAttacks) return false;
        const atk = slot < 2 ? weaponAttacks.basic[slot] : weaponAttacks.special;
        if (!atk) return false;
        if (atk.arrowCost && this.player.arrows < atk.arrowCost) return false;

        const profId = this.player.activeProfession;
        this.cooldownUntil[slot] = now + getAttackCooldownMs(profId, slot, this.player.level);
        if (atk.arrowCost) { for (let i = 0; i < atk.arrowCost; i++) this.player.useArrow(); }

        this.resolvePlayerAttack(slot, atk, aimWorldPos);
        return true;
    },

    // Presionar R: solo arranca la animación de carga si YA hay 10 cargas
    // (si no, "no sucede nada", ver especificación).
    startCharge() {
        if (!this.player || this.charging) return;
        if (Date.now() < this.cooldownUntil[2]) return;
        if (this.charge < RT_CHARGE_MAX) return;
        this.charging = true;
        this.chargeStartAt = Date.now();
    },

    // Soltar R: dispara inmediatamente si se estaba cargando.
    releaseCharge() {
        if (!this.charging) return;
        this.fireCharge();
    },

    fireCharge() {
        this.charging = false;
        this.tryAttack(2, null);
    },

    // Enemigos dentro de un cono frontal (usado por Ataque 1/2).
    getEnemiesInCone(originX, originY, dirX, dirY, range, angleDeg) {
        const halfAngleRad = (angleDeg / 2) * Math.PI / 180;
        const dirAngle = Math.atan2(dirY, dirX);
        return this.enemies.filter(en => {
            if (!en.alive) return false;
            const dx = en.x - originX, dy = en.y - originY;
            const dist = Math.hypot(dx, dy);
            if (dist > range + en.radius) return false;
            if (dist < 1) return true;
            const angleTo = Math.atan2(dy, dx);
            let diff = Math.abs(angleTo - dirAngle);
            if (diff > Math.PI) diff = 2 * Math.PI - diff;
            return diff <= halfAngleRad;
        });
    },

    // Enemigos dentro de un círculo (usado por el Ataque 3 / especial).
    getEnemiesInCircle(cx, cy, range) {
        return this.enemies.filter(en => en.alive && Math.hypot(en.x - cx, en.y - cy) <= range + en.radius);
    },

    resolvePlayerAttack(slot, atk, aimWorldPos) {
        const player = this.player;
        const eff = player.getActiveEnchantEffects();
        const profId = player.activeProfession;
        const geometry = getAttackGeometry(profId, slot);

        let dirX = 0, dirY = -1;
        if (aimWorldPos) {
            dirX = aimWorldPos.x - player.x;
            dirY = aimWorldPos.y - player.y;
            const len = Math.hypot(dirX, dirY) || 1;
            dirX /= len; dirY /= len;
        }

        let targets;
        if (slot === 2 || geometry.hitShape === 'circle') {
            targets = this.getEnemiesInCircle(player.x, player.y, geometry.range);
        } else if (geometry.hitShape === 'offsetCircle') {
            // Área desplazada frente al jugador (Lluvia de Flechas del
            // Arquero): golpea a todos dentro, no solo al más cercano.
            const offX = player.x + dirX * geometry.offsetRange;
            const offY = player.y + dirY * geometry.offsetRange;
            targets = this.getEnemiesInCircle(offX, offY, geometry.range);
        } else {
            const inCone = this.getEnemiesInCone(player.x, player.y, dirX, dirY, geometry.range, geometry.angle);
            if (atk.aoe) {
                targets = inCone;
            } else {
                targets = inCone.length
                    ? [inCone.reduce((a, b) => (Math.hypot(a.x - player.x, a.y - player.y) <= Math.hypot(b.x - player.x, b.y - player.y) ? a : b))]
                    : [];
            }
        }

        this.spawnAttackEffect(slot, dirX, dirY, geometry);
        const hitLanded = targets.length > 0;

        // Golpe Devastador (encantamiento "segundo ataque"): cada 2do
        // ataque básico consecutivo (0 o 1) cuenta, sin depender de turnos.
        let isSecondAttack = false;
        if (slot < 2) {
            this._basicStreak = (this._basicStreak || 0) + 1;
            isSecondAttack = this._basicStreak % 2 === 0;
        } else {
            this._basicStreak = 0;
        }

        const baseDamage = atk.damage + (atk.maxHpDamageCoeff ? player.maxHp * atk.maxHpDamageCoeff : 0);
        const potenciaMult = 1 + player.stats.potencia * STAT_POTENCIA_DMG_PERCENT;
        let dmg = baseDamage * potenciaMult * (1 + eff.dmgBonusPercent);
        if (isSecondAttack && eff.secondAttackBonusPercent) dmg *= (1 + eff.secondAttackBonusPercent);

        const critBase = getWeaponCritBase(profId) + player.stats.suerte * STAT_SUERTE_CRIT_CHANCE;
        const flatPenetration = player.stats.destreza * STAT_DESTREZA_ARMOR_PEN;

        const effectiveAtk = {
            ...atk,
            damage: dmg,
            critChance: critBase + (atk.critChance || 0) + eff.critChanceBonus,
            critMultiplier: Math.max(atk.critMultiplier || 1.5, eff.critMultiplier),
            penetratePercent: Math.min(0.95, (atk.penetratePercent || 0) + eff.ignoreDefensePercent),
            flatPenetration,
        };

        // ----- Cargas de clase: mismas fórmulas que antes, ver header. -----
        let chargeGranted = 0, chargeConsumed = 0;
        if (hitLanded && atk.grantsClassCharge) chargeGranted = this.classChargeGain(profId);
        if (hitLanded && atk.consumesClassCharge) chargeConsumed = this.classChargeConsume(profId);

        let extraLifestealPercent = 0;
        let classNote = '';

        if (profId === 'guerrero' && atk.consumesClassCharge) {
            const mult = [1, 1.25, 1.5, 2.0][chargeConsumed];
            effectiveAtk.damage = dmg * mult;
            classNote = `💪PODER x${chargeConsumed}`;
        } else if (profId === 'barbaro') {
            const activeStacks = this.classCharge.prof === 'barbaro' ? this.classCharge.count : 0;
            if (activeStacks > 0 && player.hp < player.maxHp * 0.3) {
                effectiveAtk.damage += activeStacks;
                effectiveAtk.critChance += activeStacks * 0.001;
                extraLifestealPercent += activeStacks * 0.05;
                classNote = '🔥Potenciado';
            }
            if (atk.consumesClassCharge) {
                extraLifestealPercent += 0.15 + 0.5 * chargeConsumed;
                classNote = `🩸SED DE SANGRE x${chargeConsumed}`;
            } else if (atk.grantsClassCharge) {
                extraLifestealPercent += 0.15;
            }
        } else if (profId === 'arquero' && atk.consumesClassCharge) {
            const mult = [1, 1, 1.25, 1.5][chargeConsumed];
            effectiveAtk.damage = dmg * mult;
            const armorDown = [0, 0, 0.15, 0.20][chargeConsumed];
            if (armorDown) {
                effectiveAtk.defenseDownPercent = armorDown;
                effectiveAtk.defenseDownSeconds = 2;
            }
            classNote = `🎯ENFOQUE x${chargeConsumed}`;
        } else if (profId === 'mago') {
            if (atk.grantsClassCharge) {
                effectiveAtk.damage = dmg * (1 + chargeGranted * 0.25);
            } else if (atk.consumesClassCharge) {
                effectiveAtk.damage = dmg * (1 + chargeConsumed * 0.25);
                classNote = `📚AMPLIFICACIÓN x${chargeConsumed}`;
            }
        } else if (profId === 'tanque' && atk.consumesClassCharge) {
            const mult = [1, 1.25, 1.5, 2.0][chargeConsumed];
            effectiveAtk.damage = dmg * mult;
            const shieldPercentByCharge = [0.20, 0.25, 0.30, 0.40][chargeConsumed];
            const weaponTierId = player.getCurrentWeapon().tier.id;
            const tierBonus = weaponTierId <= 3 ? 0.05 : (weaponTierId <= 6 ? 0.10 : 0.15);
            const totalPercent = (shieldPercentByCharge + tierBonus) * (1 + player.level * 0.005);
            const shieldAmount = Math.round(player.maxHp * totalPercent);
            player.shield = { amount: shieldAmount, expiresAt: Date.now() + 3000 };
            classNote = `🔰RESISTENCIA x${chargeConsumed} (+${shieldAmount} 🛡️)`;
        }

        // Especiales únicos por Tier del Tanque (Ataque 3): otorgan su
        // propio escudo, reemplazando cualquier escudo activo.
        if (atk.grantsShield) {
            const g = atk.grantsShield;
            player.shield = {
                amount: Math.round(player.maxHp * g.percent),
                expiresAt: Date.now() + g.turns * 1000,
                armorBonusPercent: g.armorBonusPercent,
                enemyDmgReducePercent: g.enemyDmgReducePercent,
                reflectPercent: g.reflectPercent,
                burnAttacker: g.burnAttacker,
                healPercentPerTurn: g.healPercentPerTurn,
                blockBonusPercent: g.blockBonusPercent,
                dodgeBonusChance: g.dodgeBonusChance,
                lastHealTickAt: Date.now(),
            };
            if (g.enemyStatsDownPercent) {
                targets.forEach(en => {
                    en.defenseMod = { percent: g.enemyStatsDownPercent, flat: 0, expiresAt: Date.now() + 3000 };
                    en.attackMod = { flat: Math.round(en.type.dmg * g.enemyStatsDownPercent), expiresAt: Date.now() + 3000 };
                });
            }
            classNote = `🛡️Escudo +${player.shield.amount} HP`;
        }

        const { totalDamage, hadCrit } = this.resolveAttackDamage(effectiveAtk, targets, eff);

        // Salpicadura (Pícaro): golpea N enemigos cercanos adicionales
        // (fuera de `targets`) a un % del daño principal.
        if (atk.splashCount && targets.length) {
            const primary = targets[0];
            const others = this.enemies.filter(en => en.alive && !targets.includes(en));
            others.sort((a, b) => Math.hypot(a.x - primary.x, a.y - primary.y) - Math.hypot(b.x - primary.x, b.y - primary.y));
            others.slice(0, atk.splashCount).forEach(t => {
                const splashDmg = effectiveAtk.damage * (atk.splashPercent || 1);
                const dealt = t.takeDamage(splashDmg, { flatPenetration, penetratePercent: effectiveAtk.penetratePercent || 0 });
                this.spawnImpactFlash(t.x, t.y, geometry.color);
                this.floatDamage(t, dealt, false);
                if (atk.bleed && (atk.bleed.chance === undefined || Math.random() < atk.bleed.chance)) {
                    t.bleed = { dmgPerSec: atk.bleed.dmg, expiresAt: Date.now() + atk.bleed.turns * 1000, lastTickAt: Date.now() };
                }
                if (atk.burn && (atk.burn.chance === undefined || Math.random() < atk.burn.chance)) {
                    t.burn = { dmgPerSec: atk.burn.dmg, expiresAt: Date.now() + atk.burn.turns * 1000, lastTickAt: Date.now() };
                }
                if (!t.alive && !t._deathHandled) { t._deathHandled = true; this.onEnemyDefeated(t); }
            });
        }

        let bonusTotal = 0;
        if (targets.length) {
            const bonusHits = this.applyEnchantBonusHits(eff, effectiveAtk.damage, targets[0]);
            bonusTotal = bonusHits.totalDamage;
        }

        if (atk.selfHealChance && Math.random() < atk.selfHealChance) player.heal(atk.selfHealAmount || 0);
        if (atk.noCostChance && Math.random() < atk.noCostChance) this.cooldownUntil[slot] = Date.now();
        if (atk.bonusDefenseDownChance && targets[0] && targets[0].alive && Math.random() < atk.bonusDefenseDownChance) {
            targets[0].defenseMod = { percent: atk.bonusDefenseDownPercent || 0, flat: 0, expiresAt: Date.now() + (atk.bonusDefenseDownTurns || 1) * 1000 };
        }

        // Ataque 1 (slot 0): +1 carga universal SI conectó.
        if (slot === 0 && hitLanded) this.charge = Math.min(RT_CHARGE_MAX, this.charge + 1);
        if (slot === 2) this.charge = 0; // el especial consume las 10 cargas

        const totalDealt = totalDamage + bonusTotal;
        if (eff.lifestealPercent || extraLifestealPercent) {
            const healAmt = Math.round(totalDealt * (eff.lifestealPercent + extraLifestealPercent));
            if (healAmt > 0) player.heal(healAmt);
        }

        if (classNote && this.spawnFloatingText && targets[0]) {
            this.spawnFloatingText(player.x, player.y - player.radius - 20, classNote, geometry.color, 700);
        }
    },

    // Aplica daño + efectos de un ataque a una LISTA de objetivos ya
    // determinada por geometría (cono/círculo, ver resolvePlayerAttack).
    // extraEffects: bonos de encantamiento (quemadura/sangrado/defensa
    // adicionales, ver getActiveEnchantEffects en player.js).
    resolveAttackDamage(atk, targets, extraEffects) {
        const player = this.player;
        const hits = atk.hits || 1;
        let totalDamage = 0;
        let hadCrit = false;
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
                if (extra.bonusVsHigherHP && target.hp > player.hp) dmg *= (1 + extra.bonusVsHigherHP);

                const dealt = target.takeDamage(dmg, { penetratePercent: atk.penetratePercent || 0, flatPenetration: atk.flatPenetration || 0 });
                totalDamage += dealt;
                this.spawnImpactFlash(target.x, target.y, crit ? '#ffd700' : '#ffffff');
                this.floatDamage(target, dealt, crit);

                if (atk.burn && (atk.burn.chance === undefined || Math.random() < atk.burn.chance)) {
                    target.burn = { dmgPerSec: atk.burn.dmg, expiresAt: Date.now() + atk.burn.turns * 1000, lastTickAt: Date.now() };
                }
                if (atk.bleed && (atk.bleed.chance === undefined || Math.random() < atk.bleed.chance)) {
                    target.bleed = { dmgPerSec: atk.bleed.dmg, expiresAt: Date.now() + atk.bleed.turns * 1000, lastTickAt: Date.now() };
                }
                if (atk.stun && (atk.stun.chance === undefined || Math.random() < atk.stun.chance)) {
                    target.stunUntil = Date.now() + 1500;
                }
                if (atk.defenseDownPercent || atk.defenseDownFlat) {
                    target.defenseMod = { percent: atk.defenseDownPercent || 0, flat: atk.defenseDownFlat || 0, expiresAt: Date.now() + (atk.defenseDownTurns || atk.defenseDownSeconds || 1) * 1000 };
                }
                if (atk.attackDownFlat) {
                    target.attackMod = { flat: atk.attackDownFlat, expiresAt: Date.now() + (atk.attackDownTurns || 1) * 1000 };
                }
                if (atk.attackDownPercent) {
                    target.attackMod = { flat: Math.round(target.type.dmg * atk.attackDownPercent), expiresAt: Date.now() + (atk.attackDownTurns || 1) * 1000 };
                }

                (extra.burns || []).forEach(b => {
                    if (Math.random() < (b.chance === undefined ? 1 : b.chance)) {
                        target.burn = { dmgPerSec: b.dmg, expiresAt: Date.now() + b.turns * 1000, lastTickAt: Date.now() };
                    }
                });
                (extra.bleeds || []).forEach(b => {
                    if (Math.random() < (b.chance === undefined ? 1 : b.chance)) {
                        target.bleed = { dmgPerSec: b.dmg, expiresAt: Date.now() + b.turns * 1000, lastTickAt: Date.now() };
                    }
                });
                (extra.defenseDownOnHits || []).forEach(d => {
                    if (Math.random() < (d.chance === undefined ? 1 : d.chance)) {
                        target.defenseMod = { percent: d.percent || 0, flat: 0, expiresAt: Date.now() + (d.turns || 1) * 1000 };
                    }
                });
                (extra.enemyDmgDownOnHits || []).forEach(d => {
                    if (Math.random() < (d.chance === undefined ? 1 : d.chance)) {
                        target.attackMod = { flat: Math.round(target.type.dmg * (d.percent || 0)), expiresAt: Date.now() + (d.turns || 1) * 1000 };
                    }
                });
                if (extra.onHitHeal) player.heal(extra.onHitHeal);
                if (extra.onCritHeal && crit) player.heal(extra.onCritHeal);

                if (!target.alive) {
                    if (!target._deathHandled) { target._deathHandled = true; this.onEnemyDefeated(target); }
                } else if (target.type.ability === 'counterattack') {
                    const counterDmg = this.player.takeDamage(Math.round(target.type.dmg * 0.5));
                    if (this.spawnFloatingText) this.spawnFloatingText(player.x, player.y - player.radius - 10, `-${counterDmg}`, '#ff5c5c');
                }
            }
        });

        if (atk.extraRandomHit && this.enemies.some(e => e.alive)) {
            const alive = this.enemies.filter(e => e.alive);
            const randomTarget = alive[Math.floor(Math.random() * alive.length)];
            const dealt = randomTarget.takeDamage(atk.extraRandomHit.damage, { flatPenetration: atk.flatPenetration || 0 });
            totalDamage += dealt;
            this.spawnImpactFlash(randomTarget.x, randomTarget.y, '#ffcc00');
            this.floatDamage(randomTarget, dealt, false);
            if (!randomTarget.alive && !randomTarget._deathHandled) { randomTarget._deathHandled = true; this.onEnemyDefeated(randomTarget); }
        }

        if (atk.heal) player.heal(atk.heal);

        return { totalDamage, hadCrit };
    },

    // Encantamientos de "golpe extra": cadena a enemigos cercanos, AoE a
    // todos, o golpes adicionales repetidos sobre el mismo objetivo.
    applyEnchantBonusHits(eff, atkDamage, primaryTarget) {
        let totalDamage = 0;

        (eff.chains || []).forEach(c => {
            if (Math.random() >= c.chance) return;
            const others = this.enemies.filter(e => e.alive && e !== primaryTarget);
            others.sort((a, b) => Math.hypot(a.x - primaryTarget.x, a.y - primaryTarget.y) - Math.hypot(b.x - primaryTarget.x, b.y - primaryTarget.y));
            others.slice(0, c.count).forEach(t => {
                const dealt = t.takeDamage(atkDamage * c.damagePercent);
                totalDamage += dealt;
                this.spawnImpactFlash(t.x, t.y, '#a0e0ff');
                this.floatDamage(t, dealt, false);
                if (!t.alive && !t._deathHandled) { t._deathHandled = true; this.onEnemyDefeated(t); }
            });
        });

        (eff.aoeAlls || []).forEach(a => {
            if (Math.random() >= a.chance) return;
            this.enemies.filter(e => e.alive && e !== primaryTarget).forEach(t => {
                const dealt = t.takeDamage(atkDamage * a.damagePercent);
                totalDamage += dealt;
                this.spawnImpactFlash(t.x, t.y, '#ffb3b3');
                this.floatDamage(t, dealt, false);
                if (!t.alive && !t._deathHandled) { t._deathHandled = true; this.onEnemyDefeated(t); }
            });
        });

        (eff.extraAttacksList || []).forEach(ex => {
            if (Math.random() >= ex.chance) return;
            for (let i = 0; i < ex.count; i++) {
                if (!primaryTarget.alive) break;
                const dealt = primaryTarget.takeDamage(atkDamage * ex.damagePercent);
                totalDamage += dealt;
                this.spawnImpactFlash(primaryTarget.x, primaryTarget.y, '#ffffff');
                this.floatDamage(primaryTarget, dealt, false);
                if (!primaryTarget.alive && !primaryTarget._deathHandled) { primaryTarget._deathHandled = true; this.onEnemyDefeated(primaryTarget); }
            }
        });

        return { totalDamage };
    },

    floatDamage(target, dealt, crit) {
        if (!this.spawnFloatingText) return;
        const text = crit ? `💢-${dealt}` : `-${dealt}`;
        this.spawnFloatingText(target.x, target.y - target.radius - 12, text, crit ? '#ffd700' : '#ffffff');
    },

    spawnImpactFlash(x, y, color) {
        this.effects.push({ kind: 'flash', x, y, color, createdAt: Date.now(), duration: 180 });
    },

    // `followPlayer: true` en el cono/círculo: en vez de clavar la posición
    // en el instante del click, se recalcula desde this.player en CADA
    // frame de renderEffects (ver más abajo) — si el jugador se sigue
    // moviendo mientras el efecto todavía está en pantalla (200-400ms), el
    // dibujo lo acompaña en vez de quedar "pegado" a donde estaba parado
    // al momento de disparar.
    spawnAttackEffect(slot, dirX, dirY, geometry) {
        const player = this.player;
        const now = Date.now();
        const visual = geometry.visual || (geometry.hitShape === 'circle' ? 'circle' : 'cone');
        const duration = geometry.duration || (visual === 'circle' ? 400 : 220);
        const particleCount = geometry.particleCount || 8;
        const dirAngle = Math.atan2(dirY, dirX);

        if (visual === 'circle') {
            this.effects.push({ kind: 'circle', followPlayer: true, range: geometry.range, startRange: geometry.startRange || 0, color: geometry.color, createdAt: now, duration });
            for (let i = 0; i < particleCount; i++) {
                const a = Math.random() * Math.PI * 2;
                const dist = geometry.range * (0.5 + Math.random() * 0.5);
                this.effects.push({ kind: 'particle', x: player.x + Math.cos(a) * dist, y: player.y + Math.sin(a) * dist, vx: Math.cos(a) * 0.6, vy: Math.sin(a) * 0.6, color: geometry.particleColor, createdAt: now, duration: 320 });
            }
        } else if (visual === 'slash') {
            // Corte/golpe direccional: arco trazado (no relleno), distinto
            // del "cono" translúcido original.
            this.effects.push({ kind: 'slash', followPlayer: true, dirX, dirY, range: geometry.range, angle: geometry.angle, color: geometry.color, createdAt: now, duration });
            for (let i = 0; i < particleCount; i++) {
                const a = dirAngle + (Math.random() - 0.5) * (geometry.angle * Math.PI / 180);
                const dist = geometry.range * (0.5 + Math.random() * 0.5);
                this.effects.push({ kind: 'particle', x: player.x + Math.cos(a) * dist, y: player.y + Math.sin(a) * dist, vx: Math.cos(a) * 0.6, vy: Math.sin(a) * 0.6, color: geometry.particleColor, createdAt: now, duration: 280 });
            }
        } else if (visual === 'arrow') {
            // Flecha recta (Arquero A1/A3); A3 usa `wide` para el trazo/
            // punta más gruesos (flecha "gigante").
            this.effects.push({ kind: 'arrow', followPlayer: true, dirX, dirY, range: geometry.range, wide: !!geometry.fragments, color: geometry.color, createdAt: now, duration });
            const tipX = player.x + dirX * geometry.range, tipY = player.y + dirY * geometry.range;
            const spread = geometry.fragments ? 40 : 12;
            const spreadAngle = geometry.fragments ? Math.PI * 0.9 : Math.PI * 0.3;
            for (let i = 0; i < particleCount; i++) {
                const a = dirAngle + (Math.random() - 0.5) * spreadAngle;
                this.effects.push({ kind: 'particle', x: tipX + Math.cos(a) * Math.random() * spread, y: tipY + Math.sin(a) * Math.random() * spread, vx: Math.cos(a) * 0.7, vy: Math.sin(a) * 0.7, color: geometry.particleColor, createdAt: now, duration: 280 });
            }
        } else if (visual === 'arrowRain') {
            // Área desplazada frente al jugador (ver hitShape:'offsetCircle'
            // en resolvePlayerAttack): flechas cayendo desde arriba sobre
            // la zona, NO centrada en el jugador.
            const cx = player.x + dirX * geometry.offsetRange, cy = player.y + dirY * geometry.offsetRange;
            this.effects.push({ kind: 'arrowRain', x: cx, y: cy, range: geometry.range, color: geometry.color, createdAt: now, duration });
            for (let i = 0; i < particleCount; i++) {
                const rx = (Math.random() - 0.5) * 2 * geometry.range;
                const rz = (Math.random() - 0.5) * 2 * geometry.range * 0.4;
                this.effects.push({ kind: 'particle', x: cx + rx, y: cy + rz - 160 - Math.random() * 80, vx: 0, vy: 3, color: geometry.particleColor, createdAt: now, duration: 380 });
            }
        } else { // 'cone': relleno translúcido original (Mago/desarmado, sin cambios)
            this.effects.push({ kind: 'cone', followPlayer: true, dirX, dirY, range: geometry.range, angle: geometry.angle, color: geometry.color, createdAt: now, duration });
            for (let i = 0; i < particleCount; i++) {
                const a = dirAngle + (Math.random() - 0.5) * (geometry.angle * Math.PI / 180);
                const dist = geometry.range * (0.3 + Math.random() * 0.6);
                this.effects.push({
                    kind: 'particle',
                    x: player.x + Math.cos(a) * dist * 0.4,
                    y: player.y + Math.sin(a) * dist * 0.4,
                    vx: Math.cos(a) * 0.8, vy: Math.sin(a) * 0.8,
                    color: geometry.particleColor, createdAt: now, duration: 320,
                });
            }
        }
    },

    // Guarda la REFERENCIA al enemigo (no sus coordenadas) para que, igual
    // que el cono/círculo del jugador, el rayo siga a ambos extremos si se
    // mueven mientras el efecto todavía está en pantalla.
    spawnEnemyBolt(enemy) {
        this.effects.push({ kind: 'bolt', enemyRef: enemy, color: '#ff5c5c', createdAt: Date.now(), duration: 180 });
    },

    // Dibuja los efectos activos (llamado desde game.js/render(), DENTRO
    // del translate de cámara para quedar en coordenadas de mundo).
    renderEffects(ctx) {
        const now = Date.now();
        this.effects = this.effects.filter(e => now - e.createdAt < e.duration);
        const player = this.player;
        this.effects.forEach(e => {
            const t = (now - e.createdAt) / e.duration;
            const alpha = Math.max(0, 1 - t);
            if (e.kind === 'cone') {
                const ox = e.followPlayer ? player.x : e.x, oy = e.followPlayer ? player.y : e.y;
                const halfAngle = (e.angle / 2) * Math.PI / 180;
                const dirAngle = Math.atan2(e.dirY, e.dirX);
                const r = e.range * (0.5 + t * 0.5);
                ctx.beginPath();
                ctx.moveTo(ox, oy);
                ctx.arc(ox, oy, r, dirAngle - halfAngle, dirAngle + halfAngle);
                ctx.closePath();
                ctx.globalAlpha = alpha * 0.3;
                ctx.fillStyle = e.color;
                ctx.fill();
                ctx.globalAlpha = alpha;
                ctx.strokeStyle = e.color;
                ctx.lineWidth = 2;
                ctx.stroke();
            } else if (e.kind === 'circle') {
                const ox = e.followPlayer ? player.x : e.x, oy = e.followPlayer ? player.y : e.y;
                const startR = e.startRange || 0;
                const r = startR + (e.range - startR) * t;
                ctx.beginPath();
                ctx.arc(ox, oy, r, 0, Math.PI * 2);
                ctx.globalAlpha = alpha;
                ctx.strokeStyle = e.color;
                ctx.lineWidth = 3;
                ctx.stroke();
            } else if (e.kind === 'slash') {
                const ox = e.followPlayer ? player.x : e.x, oy = e.followPlayer ? player.y : e.y;
                const halfAngle = (e.angle / 2) * Math.PI / 180;
                const dirAngle = Math.atan2(e.dirY, e.dirX);
                const startAngle = dirAngle - halfAngle;
                const endAngle = startAngle + halfAngle * 2 * Math.min(1, t * 1.6);
                const r = e.range * (0.85 + t * 0.15);
                ctx.beginPath();
                ctx.arc(ox, oy, r, startAngle, endAngle);
                ctx.globalAlpha = alpha;
                ctx.strokeStyle = e.color;
                ctx.lineWidth = 6;
                ctx.lineCap = 'round';
                ctx.stroke();
                ctx.lineCap = 'butt';
                ctx.lineWidth = 1;
            } else if (e.kind === 'arrow') {
                const ox = e.followPlayer ? player.x : e.x, oy = e.followPlayer ? player.y : e.y;
                const len = e.range * Math.min(1, t * 2.2);
                const tipX = ox + e.dirX * len, tipY = oy + e.dirY * len;
                const backLen = Math.max(0, len - (e.wide ? 40 : 24));
                const backX = ox + e.dirX * backLen, backY = oy + e.dirY * backLen;
                ctx.globalAlpha = alpha;
                ctx.strokeStyle = e.color;
                ctx.lineWidth = e.wide ? 5 : 3;
                ctx.beginPath();
                ctx.moveTo(backX, backY);
                ctx.lineTo(tipX, tipY);
                ctx.stroke();
                const headAngle = Math.atan2(e.dirY, e.dirX);
                const headSize = e.wide ? 16 : 8;
                ctx.beginPath();
                ctx.moveTo(tipX, tipY);
                ctx.lineTo(tipX - Math.cos(headAngle - 0.4) * headSize, tipY - Math.sin(headAngle - 0.4) * headSize);
                ctx.lineTo(tipX - Math.cos(headAngle + 0.4) * headSize, tipY - Math.sin(headAngle + 0.4) * headSize);
                ctx.closePath();
                ctx.fillStyle = e.color;
                ctx.fill();
            } else if (e.kind === 'arrowRain') {
                const r = e.range * (0.6 + t * 0.4);
                ctx.globalAlpha = alpha * 0.5;
                ctx.beginPath();
                ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
                ctx.strokeStyle = e.color;
                ctx.lineWidth = 2;
                ctx.stroke();
                ctx.globalAlpha = alpha * 0.15;
                ctx.fillStyle = e.color;
                ctx.fill();
            } else if (e.kind === 'particle') {
                e.x += e.vx * 16;
                e.y += e.vy * 16;
                ctx.globalAlpha = alpha;
                ctx.beginPath();
                ctx.arc(e.x, e.y, 3, 0, Math.PI * 2);
                ctx.fillStyle = e.color;
                ctx.fill();
            } else if (e.kind === 'flash') {
                ctx.globalAlpha = alpha;
                ctx.beginPath();
                ctx.arc(e.x, e.y, 12 * (1 + t), 0, Math.PI * 2);
                ctx.fillStyle = e.color;
                ctx.fill();
            } else if (e.kind === 'bolt') {
                ctx.globalAlpha = alpha;
                ctx.strokeStyle = e.color;
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(e.enemyRef.x, e.enemyRef.y);
                ctx.lineTo(player.x, player.y);
                ctx.stroke();
            }
        });
        ctx.globalAlpha = 1;
    },

    // ----- ATAQUES DE ENEMIGOS (ver Enemy.update en enemy.js: llama acá
    // cuando el enemigo está en rango y su cooldown propio terminó) -----
    // Mismo orden de evaluación defensiva que antes: Bloqueo -> Esquiva ->
    // daño -> Contraataque (independiente de si bloqueó/esquivó).
    performEnemyAttackRT(enemy) {
        this.spawnEnemyBolt(enemy);

        let baseDmg = enemy.type.dmg;
        if (enemy.attackMod && Date.now() < enemy.attackMod.expiresAt) {
            baseDmg = Math.max(1, baseDmg - enemy.attackMod.flat);
        }
        if (enemy.type.ability === 'damageMultiplier') baseDmg = Math.round(baseDmg * 1.6);

        const player = this.player;
        const shield = player.shield;
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
            if (shield && shield.enemyDmgReducePercent) incomingRaw *= (1 - shield.enemyDmgReducePercent);
            dmg = player.absorbDamage(incomingRaw);
        }

        if (this.spawnFloatingText && dmg > 0) {
            this.spawnFloatingText(player.x, player.y - player.radius - 12, `-${dmg}${blocked ? ' 🛡️' : ''}`, '#ff5c5c');
        } else if (dodged && this.spawnFloatingText) {
            this.spawnFloatingText(player.x, player.y - player.radius - 12, '¡Esquivado!', '#a0ffb0');
        }

        if (!dodged) {
            if (enemy.type.ability === 'lifesteal') {
                const healAmt = Math.round(dmg * 0.2);
                enemy.hp = Math.min(enemy.maxHp, enemy.hp + healAmt);
            }
            if (enemy.type.ability === 'burnOnHit') {
                player.burn = { dmg: Math.max(1, Math.round(enemy.type.dmg * 0.1)), expiresAt: Date.now() + 2000, lastTickAt: Date.now() };
            }
            if (enemy.type.ability === 'freezeHalfAP') {
                // Sin "PA" en tiempo real: el equivalente más cercano es
                // penalizar brevemente los 3 cooldowns del jugador.
                for (let i = 0; i < 3; i++) this.cooldownUntil[i] = Math.max(this.cooldownUntil[i], Date.now() + 1000);
                if (this.spawnFloatingText) this.spawnFloatingText(player.x, player.y - player.radius - 30, '🧊 Ralentizado', '#a0e0ff');
            }

            if (shield && shield.reflectPercent && enemy.alive) {
                const reflectDmg = incomingRaw * shield.reflectPercent;
                const dealt = enemy.takeDamage(reflectDmg, { flatPenetration: player.stats.destreza * STAT_DESTREZA_ARMOR_PEN });
                this.floatDamage(enemy, dealt, false);
                if (!enemy.alive && !enemy._deathHandled) { enemy._deathHandled = true; this.onEnemyDefeated(enemy); }
            }
            if (shield && shield.burnAttacker && enemy.alive) {
                enemy.burn = { dmgPerSec: shield.burnAttacker.dmg, expiresAt: Date.now() + shield.burnAttacker.turns * 1000, lastTickAt: Date.now() };
            }
        }

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
                this.floatDamage(enemy, dealt, false);
                if (!enemy.alive && !enemy._deathHandled) { enemy._deathHandled = true; this.onEnemyDefeated(enemy); }
            }
        }

        if (enemy.type.ability) this.tickBossAbility(enemy);
    },

    // Habilidades de jefe: antes se activaban al INICIO de su turno; ahora
    // se activan cada vez que ataca (abilityState.attacksSinceUse cuenta
    // sus propios ataques, no turnos globales).
    tickBossAbility(enemy) {
        if (!enemy.alive) return;
        const ability = enemy.type.ability;
        enemy.abilityState.attacksSinceUse = (enemy.abilityState.attacksSinceUse || 0) + 1;

        if (ability === 'regen' && enemy.hp < enemy.maxHp) {
            const healAmt = Math.max(1, Math.round(enemy.maxHp * 0.05));
            enemy.hp = Math.min(enemy.maxHp, enemy.hp + healAmt);
        }
        if (ability === 'summonMinions' && enemy.abilityState.attacksSinceUse % 3 === 0) {
            this.spawnMinion(enemy);
        }
        if (ability === 'damageShield') {
            if (Date.now() < enemy.abilityState.shieldUntil) {
                // sigue activo, no hace falta nada
            } else if (enemy.abilityState.attacksSinceUse % 3 === 0) {
                enemy.abilityState.shieldUntil = Date.now() + 4000;
            }
        }
        if (ability === 'curseXpDown' && enemy.abilityState.attacksSinceUse === 1) {
            // Antes duraba "el combate" (turnos); ahora es un debuff con
            // vencimiento propio, ya que no hay un límite de encuentro fijo.
            this.player.xpPenalty = 0.5;
            this.player.xpPenaltyUntil = Date.now() + 20000;
            if (this.spawnFloatingText) this.spawnFloatingText(this.player.x, this.player.y - this.player.radius - 30, '💀 -50% XP', '#e93cff');
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
        }
    },

    // ----- POCIONES (cooldown en vez de "3 por combate / 1 por turno") -----
    usePotionRT(rarityId) {
        if (!this.player) return;
        if (Date.now() < this.potionCooldownUntil) return;
        const healed = this.player.usePotion(rarityId);
        if (healed <= 0) return;
        this.potionCooldownUntil = Date.now() + RT_POTION_COOLDOWN_MS;
        if (this.spawnFloatingText) this.spawnFloatingText(this.player.x, this.player.y - this.player.radius - 20, `+${healed} HP`, '#7bffa0');
    },

    // ----- LOOT (sin cambios de fondo respecto al sistema anterior) -----
    grantMaterial(id, qty) {
        this.player.gainMaterial(id, qty);
    },

    grantRandomTierMaterials(totalQty, tierId) {
        const pool = [`mat_tier_${tierId}`, `madera_tier_${tierId}`, `hierba_tier_${tierId}`, `cultivo_tier_${tierId}`];
        for (let i = 0; i < totalQty; i++) {
            this.grantMaterial(pool[Math.floor(Math.random() * pool.length)], 1);
        }
    },

    onEnemyDefeated(target) {
        const player = this.player;
        const rarity = target.type.rarity || MONSTER_RARITIES[0];
        const bossKind = target.type.bossKind;

        if (target.type.isFinalBoss) {
            // El manejo de puntos/reinicio del Jefe Final vive en
            // game.js/handleEnemyKilled (ver onKillHook más abajo); acá
            // solo se otorga el loot, igual que cualquier otro enemigo.
        }

        // Tamaño de "grupo": enemigos vivos cerca del que acaba de morir,
        // en ESTE instante (ver RT_ENGAGE_GROUP_RADIUS) — no hay más un
        // "combate" con composición fija que recordar.
        const groupSize = 1 + this.enemies.filter(en => en !== target && en.alive
            && Math.hypot(en.x - target.x, en.y - target.y) <= RT_ENGAGE_GROUP_RADIUS).length;
        const groupMult = getGroupMultiplier(groupSize);
        const gm = qty => Math.max(1, Math.round(qty * groupMult));

        const xpPenalty = (player.xpPenaltyUntil && Date.now() < player.xpPenaltyUntil) ? player.xpPenalty : 1;
        const xpGain = Math.round(getEnemyXPReward(player.floor, rarity.id, bossKind) * xpPenalty);
        player.gainXP(xpGain);
        if (this.spawnFloatingText) {
            const boldIfRare = MONSTER_RARITIES.findIndex(r => r.id === rarity.id) >= 3;
            this.spawnFloatingText(target.x, target.y - target.radius - 26, `+${xpGain} XP`, rarity.color, 1200);
        }

        const goldGain = getEnemyGoldReward(player.floor, rarity.id, bossKind, groupSize);
        player.gainGold(goldGain);
        if (this.spawnFloatingText) this.spawnFloatingText(target.x, target.y - target.radius - 44, `+${goldGain} 🪙`, '#ffd700', 1200);

        const materialTierId = getMaterialTierForFloor(player.floor);
        const rarityIdx = MONSTER_RARITIES.findIndex(r => r.id === rarity.id);

        if (rarityIdx >= 1 && Math.random() < 0.08) {
            this.grantMaterial('pergamino_teletransporte', 1);
        }

        const alteracion = getAlteracionDropInfo(rarity.id, bossKind);
        if (alteracion.guaranteed || Math.random() < alteracion.chance) {
            const qty = alteracion.guaranteed ? (1 + Math.floor(Math.random() * 3)) : 1;
            this.grantMaterial(`pergamino_alteracion_tier${alteracion.tier}`, qty);
        }

        const { tierId: nucleoTierId, count: nucleoCount } = rollNucleoDrops(player.floor);
        this.grantMaterial(getNucleoId(rarity.id, nucleoTierId), gm(nucleoCount));

        if (bossKind === 'jefe_final') {
            const pisoEnRango = target.type.pisoEnRango || 10;
            const resourceQty = gm(Math.round(50 + ((pisoEnRango - 1) / 9) * 150));
            this.grantMaterial(`mat_tier_${materialTierId}`, resourceQty);
            this.grantMaterial(`madera_tier_${materialTierId}`, resourceQty);
            this.grantMaterial(getNucleoId('comun', materialTierId), gm(45));
            this.grantMaterial(getNucleoId('poco_comun', materialTierId), gm(30));
            this.grantMaterial(getNucleoId('raro', materialTierId), gm(15));
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
            if (this.spawnFloatingText) this.spawnFloatingText(target.x, target.y - target.radius - 60, '👑 ¡Botín masivo!', '#ffd700', 1600);
        } else if (bossKind === 'jefe') {
            this.grantMaterial(getNucleoId(rarity.id, nucleoTierId), gm(5));
            this.grantRandomTierMaterials(gm(30), materialTierId);
            if (rarityIdx >= 0 && rarityIdx < MONSTER_RARITIES.length - 1 && Math.random() < 0.10) {
                this.grantMaterial(getNucleoId(MONSTER_RARITIES[rarityIdx + 1].id, nucleoTierId), gm(1));
            }
        } else if (bossKind === 'minijefe') {
            this.grantMaterial(getNucleoId(rarity.id, nucleoTierId), gm(5));
            this.grantRandomTierMaterials(gm(10), materialTierId);
        } else if (bossKind === 'jefe_especial' || bossKind === 'jefe_aleatorio') {
            this.grantMaterial(getNucleoId(rarity.id, nucleoTierId), gm(5));
            this.grantRandomTierMaterials(gm(20), materialTierId);
        }

        if (this.onKillHook) this.onKillHook(target);
    },
};
