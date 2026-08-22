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

// Punto más cercano en el SEGMENTO (x1,y1)-(x2,y2) al punto (px,py) — usado
// por el barrido de daño de los dashes/saltos/proyectiles de las teclas
// "1"/"3" para no saltearse enemigos entre frames (Combat.updateRealtime),
// y por la Flecha Certera del Arquero para saber EXACTAMENTE dónde a lo
// largo del camino ocurrió el impacto (no la posición final del frame, que
// puede estar mucho más adelante si el salto de tiempo entre frames es
// grande — importa porque su daño depende de cuánto había recorrido en ese
// punto, ver getArqueroArrowDamage).
function closestPointOnSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq > 0 ? ((px - x1) * dx + (py - y1) * dy) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    return { x: x1 + t * dx, y: y1 + t * dy };
}

// Distancia de un punto (px,py) al SEGMENTO (x1,y1)-(x2,y2).
function distancePointToSegment(px, py, x1, y1, x2, y2) {
    const p = closestPointOnSegment(px, py, x1, y1, x2, y2);
    return Math.hypot(px - p.x, py - p.y);
}

// ¿El ángulo `targetAngle` quedó DENTRO del arco barrido de `fromAngle` a
// `toAngle` (SIEMPRE creciente/horario, en radianes, sin normalizar)? Usado
// por el Torbellino de Espadas del Bárbaro para detectar qué enemigos tocó
// cada espada este frame — mismo espíritu que closestPointOnSegment: barre
// el segmento angular ENTRE frames (no solo el ángulo puntual actual) para
// no saltearse enemigos con un dt grande.
function isAngleInSweep(targetAngle, fromAngle, toAngle) {
    const sweep = toAngle - fromAngle;
    if (sweep <= 0) return false;
    if (sweep >= Math.PI * 2) return true;
    const twoPi = Math.PI * 2;
    const rel = ((targetAngle - fromAngle) % twoPi + twoPi) % twoPi;
    return rel <= sweep;
}

// ¿El punto (px,py) cae dentro del "canal" rectangular del Rayo Arcano de
// un jefe: un rayo que sale de (originX,originY) en dirección (dirX,dirY)
// normalizada, de longitud `range` y ancho total `width` (halfWidth a cada
// lado del eje central)? Proyecta el punto sobre el eje del rayo (along) y
// mide su distancia perpendicular al eje (perp).
function isPointInBeam(px, py, originX, originY, dirX, dirY, range, halfWidth) {
    const relX = px - originX, relY = py - originY;
    const along = relX * dirX + relY * dirY;
    if (along < 0 || along > range) return false;
    const perpX = relX - dirX * along, perpY = relY - dirY * along;
    return Math.hypot(perpX, perpY) <= halfWidth;
}

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

    // Ataque 2: habilidad toggle por clase (ver RT_TOGGLE_SKILLS en
    // constants.js). `stacks` se gana por CADA enemigo muerto mientras está
    // activa y se pierde al desactivar o cambiar de profesión activa.
    skill2: { active: false, profId: null, stacks: 0, activateCooldownUntil: 0, lastTickAt: 0, orbitStartAt: 0 },

    // Hechizo nuevo de tecla "1" (ver RT_SKILL1_ABILITIES): `aiming` es el
    // modo "manteniendo 1" (dibuja vista previa, ver renderSkill1Aim);
    // `cooldownUntil` es único (no por clase, mismo patrón que
    // cooldownUntil[0..2] — cambiar de clase no lo resetea). El resto son
    // estados propios de cada clase (Bárbaro/Mago/Arquero).
    // `picaroDashCritStacks` (0-6): +5%/stack de crítico PERMANENTE, +1 por
    // cada kill con la Estocada Fantasma (tecla "1") — sin duración/decay
    // (no se pidió que expire), solo se APLICA mientras Pícaro sea la
    // clase activa (ver getPicaroDashCritBonusPercent), igual que el resto
    // de bonos de clase, aunque el contador en sí no se resetea al cambiar.
    skill1: { aiming: false, barbaroActive: false, barbaroActiveUntil: 0, mageDmgBuffUntil: 0, archerSpeedBuffUntil: 0, picaroDashCritStacks: 0 },
    skill1CooldownUntil: 0,
    leap: null, // dash/salto/teletransporte en curso (ver startLeap) — { kind, startX/Y, endX/Y, startAt, durationMs, hitSet, onHitEnemy?, onComplete? }
    zones: [],  // áreas persistentes en el suelo (ver RT_SKILL1_ABILITIES.guerrero/tanque) — [{ kind, x, y, radius, expiresAt, ... }]
    dungeon: null, // referencia viva al dungeon del piso actual (se refresca cada updateRealtime) — usada para clampear destinos de dash/salto/teletransporte a zonas caminables

    // Hechizo nuevo de tecla "3" (ver RT_SKILL3_ABILITIES): mismo patrón de
    // "mantener para apuntar, soltar para lanzar" que la tecla "1" (ver
    // skill1.aiming). `skill3CooldownUntil` es único, mismo patrón que
    // skill1CooldownUntil. `arrowKillDmgBuffUntil`: +10% de daño temporal
    // del Arquero tras matar con la Flecha Certera (ver
    // getSkill3DamageBuffPercent). `guerreroExecuteDmgStacks`: +2%/kill de
    // daño permanente del Golpe de Ejecución (máx 10). `picaroExplosionCritStacks`:
    // +2%/kill de crítico permanente de la explosión de Doble Sombra (máx 10).
    // `tanqueActive`/`tanqueActiveUntil`: Círculo del Gigante activo (8s).
    // `tanqueGiantStacks` (0-10): a diferencia de los stacks del Pícaro, se
    // RESETEAN a 0 en cada lanzamiento y sólo valen mientras la habilidad
    // esté activa (ver RT_SKILL3_ABILITIES.tanque).
    skill3: { aiming: false, arrowKillDmgBuffUntil: 0, guerreroExecuteDmgStacks: 0, picaroExplosionCritStacks: 0, tanqueActive: false, tanqueActiveUntil: 0, tanqueGiantStacks: 0 },
    skill3CooldownUntil: 0,
    vortex: null, // Mago: { profId, cfg, x, y, startX/Y, endX/Y, startAt, travelDurationMs, currentRadius, finalRadius, phase: 'traveling'|'static', hitSet, staticUntil, lastStaticTickAt, tierMult, rarityMult, rotationStartAt }
    arrow3: null, // Arquero: { profId, cfg, x, y, startX/Y, endX/Y, dirX, dirY, startAt, travelDurationMs, tierMult, rarityMult }
    dash3: null,  // Guerrero (Golpe de Ejecución, transplantado del Pícaro): { profId, cfg, x, y, startX/Y, endX/Y, dirX, dirY, startAt, travelDurationMs, tierMult, rarityMult } — se detiene en el primer enemigo tocado (ver updateRealtime)
    picaroClone: null, // Pícaro (Doble Sombra): { x, y, radius, hp, maxHp, skill2Active, lastTickAt } — señuelo sin bloqueo/esquiva/escudo; explota al morir o al ser atravesado por la Estocada Fantasma (ver explodePicaroClone)
    barbaroSpin: null, // Bárbaro (Torbellino de Espadas): { startAt, durationMs, lastOffset, hitSet, reducedMs } — 2 espadas giran 360° alrededor del jugador (ver applyBarbaroSpinHits/renderBarbaroSpin)

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
        this.skill2 = { active: false, profId: null, stacks: 0, activateCooldownUntil: 0, lastTickAt: 0, orbitStartAt: 0 };
        this.skill1 = { aiming: false, barbaroActive: false, barbaroActiveUntil: 0, mageDmgBuffUntil: 0, archerSpeedBuffUntil: 0, picaroDashCritStacks: 0 };
        this.skill1CooldownUntil = 0;
        this.leap = null;
        this.zones = [];
        this.dungeon = null;
        this.skill3 = { aiming: false, arrowKillDmgBuffUntil: 0, guerreroExecuteDmgStacks: 0, picaroExplosionCritStacks: 0, tanqueActive: false, tanqueActiveUntil: 0, tanqueGiantStacks: 0 };
        this.skill3CooldownUntil = 0;
        this.vortex = null;
        this.arrow3 = null;
        this.dash3 = null;
        this.picaroClone = null;
        this.barbaroSpin = null;
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
        this.dungeon = dungeon;
        const now = Date.now();

        // Anillo de carga del Ataque 3: se dispara solo al completarse,
        // aunque el jugador siga manteniendo R (ver bindInput en game.js).
        if (this.charging && now - this.chargeStartAt >= RT_CHARGE_RING_MS) {
            this.fireCharge();
        }

        // Dash/salto/teletransporte en curso del hechizo de tecla "1" (ver
        // startLeap): interpola la posición del jugador cada frame y, si
        // `sweep` está activo, va detectando enemigos recién tocados a lo
        // largo del camino (una sola vez cada uno, ver hitSet).
        if (this.leap) {
            // Barrido por SEGMENTO (posición previa -> nueva), no solo un
            // chequeo puntual en la posición actual: con dashes de 100ms a
            // 400px, cada frame puede avanzar decenas de píxeles, así que un
            // chequeo puntual puede "saltearse" enemigos parados entre dos
            // frames consecutivos. Point-to-segment en vez de point-to-point.
            const prevX = this.player.x, prevY = this.player.y;
            const t = Math.min(1, (now - this.leap.startAt) / this.leap.durationMs);
            this.player.x = this.leap.startX + (this.leap.endX - this.leap.startX) * t;
            this.player.y = this.leap.startY + (this.leap.endY - this.leap.startY) * t;
            if (this.leap.sweep && this.leap.onHitEnemy) {
                this.enemies.forEach(en => {
                    if (!en.alive || this.leap.hitSet.has(en)) return;
                    const dist = distancePointToSegment(en.x, en.y, prevX, prevY, this.player.x, this.player.y);
                    if (dist <= this.player.radius + en.radius) {
                        this.leap.hitSet.add(en);
                        this.leap.onHitEnemy(en);
                    }
                });
            }
            // Doble Sombra: si la Estocada Fantasma (dash de tecla "1" del
            // Pícaro) atraviesa al clon, este explota INSTANTÁNEAMENTE con
            // el 100% del daño (mismo explodePicaroClone que si muriera por
            // enemigos) — ver RT_SKILL3_ABILITIES.picaro.
            if (this.leap.kind === 'picaro_dash' && this.picaroClone) {
                const clone = this.picaroClone;
                const dist = distancePointToSegment(clone.x, clone.y, prevX, prevY, this.player.x, this.player.y);
                if (dist <= this.player.radius + clone.radius) {
                    this.explodePicaroClone(clone);
                }
            }
            if (t >= 1) {
                const onComplete = this.leap.onComplete;
                this.leap = null;
                if (onComplete) onComplete();
            }
        }

        // Furia Sangrienta del Bárbaro (ver RT_SKILL1_ABILITIES.barbaro):
        // si no se canceló antes con un dash, al vencer su duración arranca
        // recién ACÁ el cooldown normal (no al activarla).
        if (this.skill1.barbaroActive && now >= this.skill1.barbaroActiveUntil) {
            this.skill1.barbaroActive = false;
            this.skill1CooldownUntil = now + RT_SKILL1_ABILITIES.barbaro.cooldownMs;
            if (this.spawnFloatingText) {
                this.spawnFloatingText(this.player.x, this.player.y - this.player.radius - 30, `${RT_SKILL1_ABILITIES.barbaro.name} terminada`, '#a0a0a0');
            }
        }

        // Zonas persistentes en el suelo (Salto Sísmico del Guerrero /
        // Bastión del Tanque): poda las vencidas.
        if (this.zones.length) this.zones = this.zones.filter(z => now < z.expiresAt);

        // Vórtice Arcano del Mago (tecla "3", ver RT_SKILL3_ABILITIES): fase
        // 'traveling' interpola su posición (velocidad constante) mientras
        // crece el radio proporcional a lo recorrido, con barrido por
        // SEGMENTO igual que this.leap (ver distancePointToSegment) para no
        // saltearse enemigos entre frames; al llegar pasa a 'static' y
        // tickea daño por segundo hasta vencer su duración.
        if (this.vortex) {
            const v = this.vortex;
            if (v.phase === 'traveling') {
                const prevX = v.x, prevY = v.y;
                const t = Math.min(1, (now - v.startAt) / v.travelDurationMs);
                v.x = v.startX + (v.endX - v.startX) * t;
                v.y = v.startY + (v.endY - v.startY) * t;
                const traveledSoFar = Math.hypot(v.x - v.startX, v.y - v.startY);
                v.currentRadius = v.cfg.minRadius + Math.max(0, (traveledSoFar - v.cfg.growthStartDist) / v.cfg.growthDivisor);

                this.enemies.forEach(en => {
                    if (!en.alive || v.hitSet.has(en)) return;
                    const dist = distancePointToSegment(en.x, en.y, prevX, prevY, v.x, v.y);
                    if (dist <= v.currentRadius + en.radius) {
                        v.hitSet.add(en);
                        const dmg = this.computeVortexDamage(v, v.cfg.dmgOnTouch);
                        const dealt = en.takeDamage(dmg, {});
                        this.spawnImpactFlash(en.x, en.y, v.cfg.color);
                        this.floatDamage(en, dealt, false);
                        if (!en.alive && !en._deathHandled) { en._deathHandled = true; this.onEnemyDefeated(en); }
                    }
                });

                if (t >= 1) {
                    v.phase = 'static';
                    v.currentRadius = v.finalRadius;
                    v.staticUntil = now + v.cfg.staticDurationMs;
                    v.lastStaticTickAt = now;
                }
            } else {
                if (now - v.lastStaticTickAt >= v.cfg.staticTickMs) {
                    v.lastStaticTickAt += v.cfg.staticTickMs;
                    const targets = this.getEnemiesInCircle(v.x, v.y, v.currentRadius);
                    targets.forEach(en => {
                        const dmg = this.computeVortexDamage(v, v.cfg.staticTickDmg);
                        const dealt = en.takeDamage(dmg, {});
                        this.spawnImpactFlash(en.x, en.y, v.cfg.color);
                        this.floatDamage(en, dealt, false);
                        if (!en.alive && !en._deathHandled) { en._deathHandled = true; this.onEnemyDefeated(en); }
                    });
                }
                if (now >= v.staticUntil) this.vortex = null;
            }
        }

        // Flecha Certera del Arquero (tecla "3", ver RT_SKILL3_ABILITIES):
        // vuela en línea recta a velocidad constante hasta el PRIMER
        // enemigo que toque (barrido por segmento, se detiene ahí — a
        // diferencia del vórtice, no sigue golpeando a más de uno) o hasta
        // agotar su alcance. El daño depende de cuántos píxeles ya voló al
        // momento del impacto (ver getArqueroArrowDamage). Si mata,
        // reinicia el cooldown por completo y otorga el buff de daño.
        if (this.arrow3) {
            const a = this.arrow3;
            const prevX = a.x, prevY = a.y;
            const t = Math.min(1, (now - a.startAt) / a.travelDurationMs);
            a.x = a.startX + (a.endX - a.startX) * t;
            a.y = a.startY + (a.endY - a.startY) * t;

            let hitEnemy = null, hitPoint = null;
            for (const en of this.enemies) {
                if (!en.alive) continue;
                const cp = closestPointOnSegment(en.x, en.y, prevX, prevY, a.x, a.y);
                const dist = Math.hypot(en.x - cp.x, en.y - cp.y);
                if (dist <= 15 + en.radius) { hitEnemy = en; hitPoint = cp; break; }
            }

            if (hitEnemy) {
                // Distancia recorrida HASTA EL PUNTO DE IMPACTO real, no la
                // posición final del frame (con saltos de tiempo grandes
                // podría estar mucho más adelante que donde realmente pegó).
                const traveledDist = Math.hypot(hitPoint.x - a.startX, hitPoint.y - a.startY);
                const baseDmg = getArqueroArrowDamage(traveledDist);
                const dmg = this.computeArrow3Damage(a, baseDmg);
                const dealt = hitEnemy.takeDamage(dmg, { flatPenetration: this.player.stats.destreza * STAT_DESTREZA_ARMOR_PEN });
                this.spawnImpactFlash(hitEnemy.x, hitEnemy.y, a.cfg.color);
                this.floatDamage(hitEnemy, dealt, false);
                if (!hitEnemy.alive) {
                    if (!hitEnemy._deathHandled) { hitEnemy._deathHandled = true; this.onEnemyDefeated(hitEnemy); }
                    this.skill3CooldownUntil = now; // reinicio COMPLETO del cooldown (no solo reducción)
                    this.skill3.arrowKillDmgBuffUntil = now + a.cfg.killDmgBuffDurationMs;
                    if (this.spawnFloatingText) {
                        this.spawnFloatingText(this.player.x, this.player.y - this.player.radius - 40, `+${Math.round(a.cfg.killDmgBuffPercent * 100)}% daño`, a.cfg.color, 1000);
                    }
                }
                this.arrow3 = null;
            } else if (t >= 1) {
                this.arrow3 = null;
            }
        }

        // Golpe de Ejecución del Guerrero (tecla "3", ver
        // RT_SKILL3_ABILITIES — transplantado del Pícaro a pedido del
        // usuario): dash de 150px que, a diferencia de TODOS los demás
        // dashes/proyectiles (que atraviesan/golpean a todo lo que tocan),
        // se DETIENE en el PRIMER enemigo encontrado — el jugador queda
        // reposicionado justo frente a él (no se superponen), dispara un
        // cono pequeño + golpe único según su % de vida actual (ver
        // getGuerreroExecuteDamage; `null` = ejecución, mata directo). Si
        // mata, reinicia el cooldown por completo (mismo patrón que la
        // Flecha Certera del Arquero) y suma +2%/kill de daño permanente
        // (reemplazó la curación que tenía como habilidad del Pícaro).
        if (this.dash3) {
            const d = this.dash3;
            const prevX = d.x, prevY = d.y;
            const t = Math.min(1, (now - d.startAt) / d.travelDurationMs);
            const candX = d.startX + (d.endX - d.startX) * t;
            const candY = d.startY + (d.endY - d.startY) * t;

            let hitEnemy = null;
            for (const en of this.enemies) {
                if (!en.alive) continue;
                const cp = closestPointOnSegment(en.x, en.y, prevX, prevY, candX, candY);
                const dist = Math.hypot(en.x - cp.x, en.y - cp.y);
                if (dist <= this.player.radius + en.radius) { hitEnemy = en; break; }
            }

            if (hitEnemy) {
                // Detenerse "frente al enemigo": retrocede desde su centro
                // la suma de ambos radios, a lo largo de la dirección del
                // dash, para no terminar superpuesto con él.
                const backDist = this.player.radius + hitEnemy.radius;
                d.x = hitEnemy.x - d.dirX * backDist;
                d.y = hitEnemy.y - d.dirY * backDist;
                this.player.x = d.x;
                this.player.y = d.y;

                this.effects.push({ kind: 'cone', followPlayer: true, dirX: d.dirX, dirY: d.dirY, range: d.cfg.coneRange, angle: d.cfg.coneAngle, color: d.cfg.color, createdAt: now, duration: 250 });

                const hpPercent = hitEnemy.hp / hitEnemy.maxHp;
                const baseDmg = getGuerreroExecuteDamage(hpPercent);
                let dmgDealtForHeal = 0;
                if (baseDmg === null) {
                    // Ejecución: mata directo, ignora defensa/mitigación. El
                    // "daño realizado" para la curación se toma como la vida
                    // que tenía antes de morir (no hay `dealt` real porque
                    // no pasa por takeDamage) — siempre cura 100% (ver abajo).
                    dmgDealtForHeal = hitEnemy.hp;
                    hitEnemy.hp = 0;
                    hitEnemy.alive = false;
                    if (this.spawnFloatingText) this.spawnFloatingText(hitEnemy.x, hitEnemy.y - hitEnemy.radius - 20, '💀 ¡Ejecutado!', d.cfg.color, 1200);
                } else {
                    const dmg = this.computeDash3Damage(d, baseDmg);
                    const flatPenetration = this.player.stats.destreza * STAT_DESTREZA_ARMOR_PEN;
                    const dealt = hitEnemy.takeDamage(dmg, { flatPenetration });
                    this.floatDamage(hitEnemy, dealt, false);
                    dmgDealtForHeal = dealt;
                }
                this.spawnImpactFlash(hitEnemy.x, hitEnemy.y, d.cfg.color);
                // Cura 50% del daño realizado con esta habilidad, o 100% si
                // el golpe mató al enemigo (ver RT_SKILL3_ABILITIES.guerrero).
                if (dmgDealtForHeal > 0) {
                    const healPercent = hitEnemy.alive ? d.cfg.healOnHitPercent : d.cfg.healOnKillPercent;
                    this.player.heal(dmgDealtForHeal * healPercent);
                }
                if (!hitEnemy.alive) {
                    if (!hitEnemy._deathHandled) { hitEnemy._deathHandled = true; this.onEnemyDefeated(hitEnemy); }
                    this.skill3CooldownUntil = now; // reinicio COMPLETO del cooldown
                    this.skill3.guerreroExecuteDmgStacks = Math.min(d.cfg.dmgStackMaxStacks, this.skill3.guerreroExecuteDmgStacks + 1);
                    if (this.spawnFloatingText) {
                        this.spawnFloatingText(this.player.x, this.player.y - this.player.radius - 30, `+${Math.round(d.cfg.dmgStackPerKillPercent * 100)}% daño`, d.cfg.color, 900);
                    }
                }
                this.dash3 = null;
            } else if (t >= 1) {
                this.player.x = d.endX;
                this.player.y = d.endY;
                this.dash3 = null;
            } else {
                this.player.x = candX;
                this.player.y = candY;
                d.x = candX;
                d.y = candY;
            }
        }

        // Torbellino de Espadas del Bárbaro (ver RT_SKILL3_ABILITIES.barbaro):
        // avanza el ángulo acumulado de 0 a 2π a lo largo de durationMs y
        // aplica los golpes del arco recién barrido este frame (ver
        // applyBarbaroSpinHits) — barrido incremental, no puntual, mismo
        // motivo que closestPointOnSegment: no saltearse enemigos entre frames.
        if (this.barbaroSpin) {
            const spin = this.barbaroSpin;
            const t = Math.min(1, (now - spin.startAt) / spin.durationMs);
            const currOffset = t * Math.PI * 2;
            if (currOffset > spin.lastOffset) {
                this.applyBarbaroSpinHits(spin.lastOffset, currOffset);
                spin.lastOffset = currOffset;
            }
            if (t >= 1) this.barbaroSpin = null;
        }

        // Círculo del Gigante del Tanque (ver RT_SKILL3_ABILITIES.tanque):
        // se apaga sola al cumplirse la duración (8s) o si el jugador
        // cambió de clase activa (mismo criterio que el resto de buffs de
        // clase) — al apagarse, los stacks de Gigante se resetean a 0
        // (son "de la habilidad", no permanentes) y se recalcula la vida
        // máxima para quitar el bono.
        if (this.skill3.tanqueActive && (player.activeProfession !== 'tanque' || now >= this.skill3.tanqueActiveUntil)) {
            this.skill3.tanqueActive = false;
            this.skill3.tanqueGiantStacks = 0;
            player.recalcMaxHp();
        }

        // Habilidad toggle del Ataque 2 (ver RT_TOGGLE_SKILLS): se apaga
        // sola si el jugador cambió de clase activa (los orbitales son
        // propios de esa clase/arma), y dispara su pulso automático cada
        // `cfg.tickMs` (PROPIO de cada clase, ver RT_TOGGLE_SKILLS) mientras
        // esté activa.
        if (this.skill2.active && this.skill2.profId !== player.activeProfession) {
            this.skill2.active = false;
            this.skill2.stacks = 0;
        }
        if (this.skill2.active) {
            const skill2Cfg = RT_TOGGLE_SKILLS[this.skill2.profId];
            const tickMs = (skill2Cfg && skill2Cfg.tickMs) || 500;
            if (now - this.skill2.lastTickAt >= tickMs) {
                this.skill2.lastTickAt = now;
                this.tickToggleSkill();
            }
        }

        // Pulso de la Dagas Orbitales del CLON de Doble Sombra (ver
        // fireSkill3PicaroCloneDash/tickPicaroCloneToggleSkill) — sigue
        // corriendo de forma independiente al toggle real del jugador,
        // según la "foto" tomada al crear el clon.
        if (this.picaroClone && this.picaroClone.skill2Active) {
            const cloneTickMs = RT_TOGGLE_SKILLS.picaro.tickMs;
            if (now - this.picaroClone.lastTickAt >= cloneTickMs) {
                this.picaroClone.lastTickAt = now;
                this.tickPicaroCloneToggleSkill(this.picaroClone);
            }
        }

        // Doble Sombra del Pícaro (ver RT_SKILL3_ABILITIES.picaro): mientras
        // el clon exista Y la invisibilidad SIGA activa, la IA de TODOS los
        // enemigos (persecución, rango de ataque, todo) apunta a ÉL en vez
        // del jugador real — así "no lo ven" sin tener que tocar Enemy.js.
        // Bug corregido: antes esto solo dependía de que el clon existiera,
        // así que si sobrevivía más allá de los 3s de invisibilidad (no
        // tiene expiración propia, solo muere por daño), los enemigos
        // seguían "atacando" al clon indefinidamente aunque el jugador ya
        // fuera visible de nuevo — ahora, en cuanto pasan los 3s, la IA
        // vuelve a apuntar al jugador real sin importar si el clon sigue
        // vivo (queda como un señuelo inerte, ya no redirige nada).
        const clonActivo = this.picaroClone && player.invisibleUntil && now < player.invisibleUntil;
        const aiTarget = clonActivo
            ? { x: this.picaroClone.x, y: this.picaroClone.y, radius: this.picaroClone.radius }
            : player;

        enemies.forEach(en => {
            if (!en.alive) return;

            // Disponibilidad inicial de habilidades de jefe (ver
            // BOSS_ABILITIES): arranca a contar 3s recién cuando el
            // enemigo "detecta" al jugador (deja de estar 'idle'); si
            // vuelve a perderlo de vista, el timer se reinicia.
            if (en.type.bossAbilityIds && en.type.bossAbilityIds.length) {
                if (en.aiState === 'idle') en.combatStartAt = null;
                else if (en.combatStartAt == null) en.combatStartAt = now;
            }

            // Mientras haya un cast en curso (cargando o dasheando), el
            // enemigo NO usa su IA normal (ni se mueve por su cuenta ni
            // ataca) — ver tickBossCast.
            if (en.bossCast) {
                this.tickBossCast(en, now, dungeon);
                if (!en.alive && !en._deathHandled) { en._deathHandled = true; this.onEnemyDefeated(en); }
                return;
            }

            // Impenetrable (habilidad #2): "durante 3 segundos se queda
            // quieto" — mismo criterio de congelar el update() normal que
            // bossCast de arriba, ver tickBossShield.
            if (en.bossShield && now < en.bossShield.expiresAt) {
                this.tickBossShield(en, now);
                return;
            }

            // Frenesí Sangriento (habilidad #2): mientras dure, ataca al
            // enemigo MÁS CERCANO (no al jugador) — reemplaza por
            // completo su IA normal, ver tickFrenzy.
            if (en.frenzy && now < en.frenzy.expiresAt) {
                this.tickFrenzy(en, dt, now, dungeon);
                return;
            }

            en.update(dt, aiTarget, dungeon);
            if (!en.alive) {
                if (!en._deathHandled) { en._deathHandled = true; this.onEnemyDefeated(en); }
                return;
            }
            // Círculo del Gigante del Tanque: arrastra a todo enemigo
            // dentro del radio hacia el jugador cada frame, ADEMÁS de su
            // movimiento normal de IA de arriba (ver RT_SKILL3_ABILITIES.tanque).
            if (this.skill3.tanqueActive && player.activeProfession === 'tanque') {
                this.tickTanqueCirclePull(en, dt, player, dungeon);
            }
            if (en.aiState === 'attacking' && now >= en.nextAttackAt) {
                this.performEnemyAttackRT(en);
                if (!en.alive) { en._deathHandled = true; return; }
                // Velocidad de ataque por RAREZA (no por piso/nivel, ver
                // MONSTER_RARITIES.attackIntervalMs): Común 1s .. Mítico
                // 0.5s (2 ataques/seg), fija — sin el rango aleatorio viejo.
                const intervalMs = (en.type.rarity && en.type.rarity.attackIntervalMs) || 1000;
                en.nextAttackAt = now + intervalMs;
            }

            this.tryStartBossCast(en, now);
        });
    },

    // Intenta iniciar una habilidad de jefe (ver BOSS_ABILITIES): elige
    // una al azar entre las asignadas a este enemigo (por ahora siempre 1
    // sola, ver spawnDynamicBoss en game.js) y entra en fase "cargando".
    // El delay inicial de 3s se mide con la config de la PRIMERA habilidad
    // asignada (hoy es la única — si en el futuro hay varias con delays
    // distintos, esto habría que revisarlo).
    // Tickea el escudo de Impenetrable activo: cura healPercentPerTick
    // (5%) cada healTickMs (0.5s) — el enemigo queda "quieto" porque este
    // método reemplaza por completo a en.update() mientras dure (ver
    // updateRealtime). El daño-cero desde fuera del radio y la
    // cancelación por golpe letal desde dentro ya se resuelven en
    // Enemy.takeDamage — acá solo se maneja la curación.
    tickBossShield(en, now) {
        const cfg = BOSS_ABILITIES_2.impenetrable;
        const shield = en.bossShield;
        if (now - shield.lastHealTickAt >= cfg.healTickMs) {
            shield.lastHealTickAt += cfg.healTickMs;
            const healAmt = Math.round(en.maxHp * cfg.healPercentPerTick);
            en.hp = Math.min(en.maxHp, en.hp + healAmt);
            if (this.spawnFloatingText) this.spawnFloatingText(en.x, en.y - en.radius - 20, `+${healAmt}`, cfg.color, 800);
        }
        if (now >= shield.expiresAt) en.bossShield = null;
    },

    // Tickea Frenesí Sangriento activo: busca el enemigo vivo más cercano
    // (nunca al jugador) y lo persigue/ataca en su lugar — reutiliza
    // en.update()/stepToward pasándole un "objetivo" falso con la
    // posición del otro enemigo (mismo truco que el clon de Doble Sombra
    // con aiTarget, sin tocar la firma de Enemy.update). Bug reportado
    // por el usuario: si NO hay ningún otro enemigo cerca, se quedaba
    // parado sin hacer nada (el pedido no aclaraba este caso) — ahora
    // cae de vuelta a atacar al jugador normalmente, con los mismos
    // bonos de daño/robo de vida (ver performEnemyAttackRT, que ya los
    // aplica si enemy.frenzy está activo).
    tickFrenzy(en, dt, now, dungeon) {
        const cfg = BOSS_ABILITIES_2.frenesi;
        let nearest = null, nearestDist = Infinity;
        this.enemies.forEach(other => {
            if (other === en || !other.alive) return;
            const d = Math.hypot(other.x - en.x, other.y - en.y);
            if (d < nearestDist) { nearestDist = d; nearest = other; }
        });

        if (nearest && nearestDist <= cfg.detectRange) {
            if (nearestDist <= cfg.attackRange) {
                en.aiState = 'attacking';
                if (now >= en.nextAttackAt) {
                    this.performFrenzyAttack(en, nearest, cfg);
                    en.nextAttackAt = now + ((en.type.rarity && en.type.rarity.attackIntervalMs) || 1000);
                }
            } else {
                en.aiState = 'chasing';
                en.update(dt, { x: nearest.x, y: nearest.y, radius: nearest.radius }, dungeon);
            }
            return;
        }

        const player = this.player;
        const distToPlayer = Math.hypot(player.x - en.x, player.y - en.y);
        if (distToPlayer <= (en.type.attackRange || ENEMY_ATTACK_RANGE)) {
            en.aiState = 'attacking';
            if (now >= en.nextAttackAt) {
                this.performEnemyAttackRT(en);
                if (!en.alive) return;
                en.nextAttackAt = now + ((en.type.rarity && en.type.rarity.attackIntervalMs) || 1000);
            }
        } else {
            en.aiState = 'chasing';
            en.update(dt, player, dungeon);
        }
    },

    // Un golpe de Frenesí Sangriento contra OTRO enemigo (no el jugador):
    // +dmgBonusPercent de daño, +lifestealPercent de robo de vida sobre
    // el daño repartido. Si mata: cura killHealPercent de su vida máxima
    // y reduce el cooldown en curso killCooldownReduceMs.
    performFrenzyAttack(en, target, cfg) {
        let baseDmg = en.type.dmg;
        if (en.attackMod && Date.now() < en.attackMod.expiresAt) baseDmg = Math.max(1, baseDmg - en.attackMod.flat);
        const dmg = Math.round(baseDmg * (1 + cfg.dmgBonusPercent));
        const dealt = target.takeDamage(dmg, {});
        this.spawnImpactFlash(target.x, target.y, cfg.color);
        this.floatDamage(target, dealt, false);
        if (dealt > 0) en.hp = Math.min(en.maxHp, en.hp + Math.round(dealt * cfg.lifestealPercent));
        if (!target.alive) {
            if (!target._deathHandled) { target._deathHandled = true; this.onEnemyDefeated(target); }
            en.hp = Math.min(en.maxHp, en.hp + Math.round(en.maxHp * cfg.killHealPercent));
            en.frenzyCooldownUntil = Math.max(Date.now(), en.frenzyCooldownUntil - cfg.killCooldownReduceMs);
        }
    },

    tryStartBossCast(en, now) {
        if (en.aiState === 'idle') return;
        if (en.combatStartAt == null) return;
        // Si el jugador está invisible (Doble Sombra del Pícaro) el
        // enemigo "no lo ve" — mismo criterio que performEnemyAttackRT
        // para el ataque normal, evita que Embestida (o cualquier
        // habilidad de jefe) lo embista/apunte mientras dure. Ojo: NO
        // basta con chequear si hay un clon vivo (el clon no expira solo,
        // puede sobrevivir mucho más que los 3s de invisibilidad — mismo
        // bug que se corrigió en el aiTarget/performEnemyAttackRT), lo que
        // importa es el timestamp invisibleUntil en sí.
        if (this.player.invisibleUntil && now < this.player.invisibleUntil) return;

        // Habilidad #3 (solo jefe final, ver BOSS_ABILITIES_3) tiene
        // PRIORIDAD sobre la #1 cuando está disponible — comparten el
        // mismo casillero en.bossCast (solo una activa a la vez) pero
        // cooldowns independientes, así que la #1 sigue llenando los
        // huecos mientras la #3 (la "ultimate") está en cooldown.
        const ability3Ids = en.type.bossAbility3Ids;
        if (ability3Ids && ability3Ids.length) {
            const gate3Cfg = BOSS_ABILITIES_3[ability3Ids[0]];
            if (now >= en.combatStartAt + gate3Cfg.initialDelayMs && now >= en.bossCast3CooldownUntil) {
                const ability3Id = ability3Ids[Math.floor(Math.random() * ability3Ids.length)];
                this.startBossCast3(en, ability3Id, now);
                return;
            }
        }

        const abilityIds = en.type.bossAbilityIds;
        if (!abilityIds || !abilityIds.length) return;
        const gateCfg = BOSS_ABILITIES[abilityIds[0]];
        if (now < en.combatStartAt + gateCfg.initialDelayMs) return;
        if (now < en.bossCastCooldownUntil) return;
        const abilityId = abilityIds[Math.floor(Math.random() * abilityIds.length)];
        if (abilityId === 'rayo') {
            const player = this.player;
            let dirX = player.x - en.x, dirY = player.y - en.y;
            const len = Math.hypot(dirX, dirY) || 1;
            en.bossCast = { abilityId, phase: 'charging', startAt: now, repeatIndex: 0, dirX: dirX / len, dirY: dirY / len };
            return;
        }
        en.bossCast = { abilityId, phase: 'charging', startAt: now };
    },

    // Arranca una habilidad #3 (solo Caos Dimensional por ahora) — ver
    // tickCaosDimensional para el resto del ciclo de vida.
    startBossCast3(en, abilityId, now) {
        if (abilityId === 'caos_dimensional') {
            const player = this.player;
            let dirX = player.x - en.x, dirY = player.y - en.y;
            const len = Math.hypot(dirX, dirY) || 1;
            const zcfg = BOSS_ABILITIES_3.caos_dimensional.zona;
            en.bossCast = {
                abilityId, startAt: now, lastHealTickAt: now,
                rayo: { phase: 'charging', startAt: now, repeatIndex: 0, dirX: dirX / len, dirY: dirY / len, done: false },
                zona: { phase: 'growing', startAt: now, repeatIndex: 0, x: player.x, y: player.y, radius: zcfg.growStartRadius, done: false },
            };
        }
    },

    // Tickea un cast de jefe en curso (cargando, dasheando, o resolviendo
    // un Terremoto) — llamado en vez de en.update() mientras dure, así el
    // enemigo queda "quieto" durante toda la duración de la habilidad
    // (incluida la fase 'earthquake', por pedido explícito del usuario) y
    // se mueve SOLO por el dash durante la fase 'dashing'.
    tickBossCast(en, now, dungeon) {
        const cast = en.bossCast;

        // Caos Dimensional (habilidad #3, solo jefe final): vive en su
        // propia tabla (BOSS_ABILITIES_3, no BOSS_ABILITIES) y tiene su
        // propio manejo completo — ver tickCaosDimensional.
        if (cast.abilityId === 'caos_dimensional') {
            this.tickCaosDimensional(en, now, dungeon);
            return;
        }

        const cfg = BOSS_ABILITIES[cast.abilityId];
        const player = this.player;

        // Rayo Arcano: fases propias (charging/firing/gap), NO comparte el
        // manejo genérico de abajo porque su carga necesita ACTUALIZAR la
        // dirección cada frame (sigue al jugador), a diferencia de
        // Embestida/Terremoto donde la dirección/posición se fija recién
        // al terminar la carga.
        if (cast.abilityId === 'rayo') {
            if (cast.phase === 'charging') {
                let dirX = player.x - en.x, dirY = player.y - en.y;
                const len = Math.hypot(dirX, dirY) || 1;
                cast.dirX = dirX / len; cast.dirY = dirY / len;
                if (now - cast.startAt < cfg.chargeMs) return;
                cast.phase = 'firing';
                cast.startAt = now;
                return;
            }
            if (cast.phase === 'firing') {
                if (now - cast.startAt < cfg.fireMs) return;
                // El "disparo" se resuelve al TERMINAR de reabrirse (fin de
                // la animación de 0.5s) — un solo golpe por repetición,
                // mismo criterio de "hit puntual" que Embestida/Terremoto.
                const playerHittable = !(player.invisibleUntil && now < player.invisibleUntil);
                if (playerHittable && isPointInBeam(player.x, player.y, en.x, en.y, cast.dirX, cast.dirY, cfg.range, cfg.lineSeparation / 2 + player.radius)) {
                    const dealt = player.takeDamage(cfg.dmg);
                    if (this.spawnFloatingText) this.spawnFloatingText(player.x, player.y - player.radius - 12, `-${dealt}`, cfg.color);
                }
                // Tras el golpe, el rayo se queda visible (titilando)
                // lingerMs (0.2s) antes de pasar a la pausa entre
                // repeticiones — pedido explícito del usuario.
                cast.phase = 'lingering';
                cast.startAt = now;
                return;
            }
            if (cast.phase === 'lingering') {
                if (now - cast.startAt < cfg.lingerMs) return;
                if (cast.repeatIndex >= cfg.repeats - 1) {
                    en.bossCast = null;
                    en.bossCastCooldownUntil = now + cfg.cooldownMs;
                } else {
                    cast.repeatIndex++;
                    cast.phase = 'gap';
                    cast.startAt = now;
                }
                return;
            }
            if (cast.phase === 'gap') {
                if (now - cast.startAt < cfg.gapMs) return;
                cast.phase = 'charging';
                cast.startAt = now;
                let dirX = player.x - en.x, dirY = player.y - en.y;
                const len = Math.hypot(dirX, dirY) || 1;
                cast.dirX = dirX / len; cast.dirY = dirY / len;
                return;
            }
            return;
        }

        if (cast.phase === 'charging') {
            if (now - cast.startAt < cfg.chargeMs) return;
            if (cast.abilityId === 'embestida') {
                let dirX = player.x - en.x, dirY = player.y - en.y;
                const len = Math.hypot(dirX, dirY) || 1;
                dirX /= len; dirY /= len;
                const dest = this.computeWalkableDestination(en.x, en.y, dirX, dirY, cfg.dashRange, en.radius);
                en.bossCast = {
                    abilityId: cast.abilityId, phase: 'dashing', startAt: now, durationMs: cfg.dashDurationMs,
                    startX: en.x, startY: en.y, endX: dest.x, endY: dest.y, hitPlayer: false,
                };
            } else if (cast.abilityId === 'terremoto') {
                // Corrección del usuario: el enemigo se queda QUIETO EN EL
                // CENTRO durante TODA la secuencia (no solo la carga) —
                // sigue en bossCast (fase 'earthquake') hasta que las 4
                // bandas terminen de activarse, ver más abajo.
                en.bossCast = {
                    abilityId: cast.abilityId, phase: 'earthquake', startAt: now,
                    x: en.x, y: en.y, firedRings: [false, false, false, false], lastFlash: null,
                };
            }
            return;
        }

        if (cast.phase === 'dashing') {
            const prevX = en.x, prevY = en.y;
            const t = Math.min(1, (now - cast.startAt) / cast.durationMs);
            en.x = cast.startX + (cast.endX - cast.startX) * t;
            en.y = cast.startY + (cast.endY - cast.startY) * t;

            // Chequeo defensivo por si el jugador se vuelve invisible A
            // MITAD del dash (ya en curso) — el trigger de arriba
            // (tryStartBossCast) solo cubre el caso de arrancar la
            // habilidad estando ya invisible. Solo importa invisibleUntil
            // (no la existencia del clon, que puede sobrevivir mucho más
            // que la invisibilidad — mismo bug corregido arriba).
            const playerHittable = !(this.player.invisibleUntil && now < this.player.invisibleUntil);
            if (!cast.hitPlayer && playerHittable) {
                const cp = closestPointOnSegment(player.x, player.y, prevX, prevY, en.x, en.y);
                const dist = Math.hypot(player.x - cp.x, player.y - cp.y);
                if (dist <= player.radius + en.radius) {
                    cast.hitPlayer = true;
                    const dealt = player.takeDamage(cfg.dashDmg);
                    if (this.spawnFloatingText) this.spawnFloatingText(player.x, player.y - player.radius - 12, `-${dealt}`, cfg.color);
                }
            }

            if (t >= 1) {
                en.bossCast = null;
                en.bossCastCooldownUntil = now + cfg.cooldownMs;
            }
            return;
        }

        if (cast.phase === 'earthquake') {
            const elapsed = now - cast.startAt;
            cfg.ringActivateDelaysMs.forEach((delay, i) => {
                if (cast.firedRings[i] || elapsed < delay) return;
                cast.firedRings[i] = true;
                cast.lastFlash = { ringIndex: i, firedAt: now };
                const innerR = i === 0 ? 0 : cfg.ringRadii[i - 1];
                const outerR = cfg.ringRadii[i];
                const dist = Math.hypot(player.x - cast.x, player.y - cast.y);
                if (dist <= outerR && (i === 0 || dist > innerR)) {
                    const dealt = player.takeDamage(cfg.ringDmg);
                    if (this.spawnFloatingText) this.spawnFloatingText(player.x, player.y - player.radius - 12, `-${dealt}`, cfg.color);
                    player.slowMod = { percent: cfg.slowPercent, expiresAt: now + cfg.slowDurationMs };
                }
            });
            // Se libera recién EARTHQUAKE_RELEASE_DELAY_MS después del
            // último destello, para que el jugador alcance a ver el
            // último pulso antes de que el enemigo vuelva a moverse.
            if (cast.firedRings.every(Boolean) && now - cast.lastFlash.firedAt >= 300) {
                en.bossCast = null;
                en.bossCastCooldownUntil = now + cfg.cooldownMs;
            }
        }
    },

    // Caos Dimensional (habilidad #3, ver BOSS_ABILITIES_3): cura
    // healPercentPerSec cada healTickMs durante TODA la duración, mientras
    // corren en paralelo la sub-secuencia de Rayo Arcano (x2 velocidad, 5
    // repeticiones) y la de Zonas Arcanas (5 repeticiones) — termina
    // recién cuando AMBAS marcan `done`.
    tickCaosDimensional(en, now, dungeon) {
        const cast = en.bossCast;
        const cfg = BOSS_ABILITIES_3.caos_dimensional;

        if (now - cast.lastHealTickAt >= cfg.healTickMs) {
            cast.lastHealTickAt += cfg.healTickMs;
            const healAmt = Math.round(en.maxHp * cfg.healPercentPerSec);
            en.hp = Math.min(en.maxHp, en.hp + healAmt);
            if (this.spawnFloatingText) this.spawnFloatingText(en.x, en.y - en.radius - 20, `+${healAmt}`, cfg.color, 800);
        }

        if (!cast.rayo.done) this.tickCaosRayoSub(en, cast.rayo, cfg.rayo, now);
        if (!cast.zona.done) this.tickCaosZonaSub(en, cast.zona, cfg.zona, now);

        if (cast.rayo.done && cast.zona.done) {
            en.bossCast = null;
            en.bossCast3CooldownUntil = now + cfg.cooldownMs;
        }
    },

    // Sub-secuencia de Rayo Arcano dentro de Caos Dimensional — MISMA
    // lógica que el Rayo Arcano de habilidad #1 (ver tickBossCast, rama
    // 'rayo'), adaptada para operar sobre un sub-estado propio (`sub`,
    // cast.rayo) en vez de en.bossCast directamente, y marcar `done` en
    // vez de liberar al enemigo (Caos Dimensional lo libera recién cuando
    // TAMBIÉN termina la sub-secuencia de zonas).
    tickCaosRayoSub(en, sub, rcfg, now) {
        const player = this.player;
        if (sub.phase === 'charging') {
            let dirX = player.x - en.x, dirY = player.y - en.y;
            const len = Math.hypot(dirX, dirY) || 1;
            sub.dirX = dirX / len; sub.dirY = dirY / len;
            if (now - sub.startAt < rcfg.chargeMs) return;
            sub.phase = 'firing';
            sub.startAt = now;
            return;
        }
        if (sub.phase === 'firing') {
            if (now - sub.startAt < rcfg.fireMs) return;
            const playerHittable = !(player.invisibleUntil && now < player.invisibleUntil);
            if (playerHittable && isPointInBeam(player.x, player.y, en.x, en.y, sub.dirX, sub.dirY, rcfg.range, rcfg.lineSeparation / 2 + player.radius)) {
                const dealt = player.takeDamage(rcfg.dmg);
                if (this.spawnFloatingText) this.spawnFloatingText(player.x, player.y - player.radius - 12, `-${dealt}`, rcfg.color);
            }
            sub.phase = 'lingering';
            sub.startAt = now;
            return;
        }
        if (sub.phase === 'lingering') {
            if (now - sub.startAt < rcfg.lingerMs) return;
            if (sub.repeatIndex >= rcfg.repeats - 1) {
                sub.done = true;
            } else {
                sub.repeatIndex++;
                sub.phase = 'gap';
                sub.startAt = now;
            }
            return;
        }
        if (sub.phase === 'gap') {
            if (now - sub.startAt < rcfg.gapMs) return;
            sub.phase = 'charging';
            sub.startAt = now;
            let dirX = player.x - en.x, dirY = player.y - en.y;
            const len = Math.hypot(dirX, dirY) || 1;
            sub.dirX = dirX / len; sub.dirY = dirY / len;
        }
    },

    // Sub-secuencia de Zonas Arcanas dentro de Caos Dimensional: crece
    // (50->150px, 1s, sigue al jugador) -> estática + titila (0.5s) ->
    // se retrae (150->30px, 0.1s) -> explota (300px, misma animación de
    // círculo creciente que el Ataque 3 del jugador) -> pausa (1s) ->
    // repite sobre la posición ACTUAL del jugador, hasta `repeats` (5) veces.
    tickCaosZonaSub(en, sub, zcfg, now) {
        const player = this.player;
        if (sub.phase === 'growing') {
            sub.x = player.x; sub.y = player.y;
            const t = Math.min(1, (now - sub.startAt) / zcfg.growMs);
            sub.radius = zcfg.growStartRadius + (zcfg.growEndRadius - zcfg.growStartRadius) * t;
            if (t < 1) return;
            sub.phase = 'flicker';
            sub.startAt = now;
            return;
        }
        if (sub.phase === 'flicker') {
            if (now - sub.startAt < zcfg.flickerMs) return;
            sub.phase = 'retracting';
            sub.startAt = now;
            return;
        }
        if (sub.phase === 'retracting') {
            const t = Math.min(1, (now - sub.startAt) / zcfg.retractMs);
            sub.radius = zcfg.growEndRadius + (zcfg.retractRadius - zcfg.growEndRadius) * t;
            if (t < 1) return;
            const dist = Math.hypot(player.x - sub.x, player.y - sub.y);
            const playerHittable = !(player.invisibleUntil && now < player.invisibleUntil);
            if (playerHittable && dist <= zcfg.explosionRadius + player.radius) {
                const dealt = player.takeDamage(zcfg.explosionDmg);
                if (this.spawnFloatingText) this.spawnFloatingText(player.x, player.y - player.radius - 12, `-${dealt}`, zcfg.color);
            }
            this.effects.push({ kind: 'circle', x: sub.x, y: sub.y, followPlayer: false, range: zcfg.explosionRadius, startRange: 0, color: zcfg.color, createdAt: now, duration: 400 });
            sub.phase = 'exploded';
            sub.startAt = now;
            return;
        }
        if (sub.phase === 'exploded') {
            if (now - sub.startAt < zcfg.gapAfterExplosionMs) return;
            if (sub.repeatIndex >= zcfg.repeats - 1) {
                sub.done = true;
            } else {
                sub.repeatIndex++;
                sub.phase = 'growing';
                sub.startAt = now;
                sub.x = player.x; sub.y = player.y;
                sub.radius = zcfg.growStartRadius;
            }
        }
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
        let cdMs = getAttackCooldownMs(profId, slot, this.player.level);
        // Pícaro/Arquero: la habilidad toggle activa reduce el cooldown del
        // Ataque 1 por stack (ver RT_TOGGLE_SKILLS.cdMsPerStack/cdMsMax).
        if (slot === 0) cdMs = Math.max(100, cdMs - this.getSkill2CooldownReductionMs(profId));
        this.cooldownUntil[slot] = now + cdMs;
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

    // ----- ATAQUE 2: HABILIDAD TOGGLE (ver RT_TOGGLE_SKILLS) -----
    // Click derecho ya no dispara un golpe: activa/desactiva la habilidad de
    // objetos orbitales/círculo de la clase activa. Reactivar tras
    // desactivar exige esperar `activateCooldownMs`; los stacks se pierden
    // al desactivar.
    toggleSkill2() {
        if (!this.player || this.player.hp <= 0) return false;
        const profId = this.player.activeProfession;
        const now = Date.now();

        if (this.skill2.active && this.skill2.profId === profId) {
            const cfg = RT_TOGGLE_SKILLS[profId];
            this.skill2.active = false;
            this.skill2.stacks = 0;
            if (this.spawnFloatingText && cfg) {
                this.spawnFloatingText(this.player.x, this.player.y - this.player.radius - 30, `${cfg.name} desactivada`, '#a0a0a0');
            }
            return true;
        }

        if (now < this.skill2.activateCooldownUntil) return false;
        const cfg = RT_TOGGLE_SKILLS[profId];
        if (!cfg) return false;

        this.skill2 = { active: true, profId, stacks: 0, activateCooldownUntil: now + cfg.activateCooldownMs, lastTickAt: now, orbitStartAt: now };
        if (this.spawnFloatingText) {
            this.spawnFloatingText(this.player.x, this.player.y - this.player.radius - 30, `${cfg.name} activada`, cfg.color);
        }
        return true;
    },

    // Pulso automático de daño mientras la habilidad toggle está activa:
    // golpea a todos los enemigos dentro de `cfg.radius`. El daño es PROPIO
    // de la habilidad (cfg.dmgBase, calibrado a Tier 1 por diseño — ver
    // RT_TOGGLE_SKILLS), ya no lee weaponAttacks.basic[1] (dato muerto).
    // Escala con el arma igual que cualquier otro ataque (tier.mult ×
    // rareza.mult, mismo patrón que getWeaponForLevel). No consume flechas
    // ni ningún otro recurso — es un aura ambiental mientras dure el toggle.
    tickToggleSkill() {
        const player = this.player;
        const profId = this.skill2.profId;
        const cfg = RT_TOGGLE_SKILLS[profId];
        if (!cfg) return;

        const effRadius = this.getSkill2EffectiveRadius(profId);
        const targets = this.getEnemiesInCircle(player.x, player.y, effRadius);
        if (!targets.length) return;

        const eff = player.getActiveEnchantEffects();
        const weapon = player.getCurrentWeapon();
        const tierMult = weapon.tier ? weapon.tier.mult : 1;
        const rarityMult = weapon.rarity ? weapon.rarity.mult : 1;
        const baseDamage = cfg.dmgBase * tierMult * rarityMult;
        const potenciaMult = 1 + player.stats.potencia * STAT_POTENCIA_DMG_PERCENT;
        let dmg = baseDamage * potenciaMult * (1 + eff.dmgBonusPercent);
        dmg *= (1 + this.getSkill2DamageBonusPercent(profId));
        dmg *= (1 + this.getSkill1DamageBuffPercent(profId));
        dmg *= (1 + this.getSkill3DamageBuffPercent(profId));
        dmg *= (1 + this.getSkill3GuerreroDmgBonusPercent(profId));
        dmg *= (1 + this.getPlayerZoneDamageBonusPercent());
        dmg *= (1 + this.player.getArmorDamageBonusPercent());

        const critBase = getWeaponCritBase(profId) + player.stats.suerte * STAT_SUERTE_CRIT_CHANCE
            + this.getSkill2CritChanceBonusPercent(profId) + this.getPicaroDashCritBonusPercent(profId) + this.getPicaroExplosionCritBonusPercent(profId);
        const flatPenetration = player.stats.destreza * STAT_DESTREZA_ARMOR_PEN;
        const effectiveAtk = {
            damage: dmg,
            critChance: critBase + eff.critChanceBonus,
            critMultiplier: Math.max(1.5, eff.critMultiplier),
            penetratePercent: Math.min(0.95, eff.ignoreDefensePercent),
            flatPenetration,
        };

        const { totalDamage } = this.resolveAttackDamage(effectiveAtk, targets, eff);

        const lifestealPct = (eff.lifestealPercent || 0) + this.getSkill2LifestealBonusPercent(profId) + this.getSkill1LifestealBonusPercent(profId);
        if (lifestealPct > 0 && totalDamage > 0) {
            const healAmt = Math.round(totalDamage * lifestealPct);
            if (healAmt > 0) player.heal(healAmt);
        }

        // Anillo breve marcando el pulso (radio casi fijo: startRange muy
        // cerca de range, así se ve como un destello del círculo entero en
        // vez de una onda que crece desde el centro).
        this.effects.push({ kind: 'circle', followPlayer: true, range: effRadius, startRange: effRadius * 0.85, color: cfg.color, createdAt: Date.now(), duration: 200 });
    },

    // Bonos por stack de la habilidad toggle activa (0 si no está activa o
    // si `profId` no coincide con la clase activa de la habilidad, ver
    // RT_TOGGLE_SKILLS para qué clase usa cada campo `*PerStack`/`*Max`).
    _skill2Active(profId) {
        return this.skill2.active && this.skill2.profId === profId;
    },
    getSkill2DamageBonusPercent(profId) {
        const cfg = RT_TOGGLE_SKILLS[profId];
        if (!this._skill2Active(profId) || !cfg || !cfg.dmgPctPerStack) return 0;
        return Math.min(cfg.dmgPctMax, cfg.dmgPctPerStack * this.skill2.stacks);
    },
    getSkill2SpeedBonusPercent(profId) {
        const cfg = RT_TOGGLE_SKILLS[profId];
        if (!this._skill2Active(profId) || !cfg || !cfg.speedPctPerStack) return 0;
        return Math.min(cfg.speedPctMax, cfg.speedPctPerStack * this.skill2.stacks);
    },
    getSkill2CooldownReductionMs(profId) {
        const cfg = RT_TOGGLE_SKILLS[profId];
        if (!this._skill2Active(profId) || !cfg || !cfg.cdMsPerStack) return 0;
        return Math.min(cfg.cdMsMax, cfg.cdMsPerStack * this.skill2.stacks);
    },
    getSkill2LifestealBonusPercent(profId) {
        const cfg = RT_TOGGLE_SKILLS[profId];
        if (!this._skill2Active(profId) || !cfg || !cfg.lifestealPctPerStack) return 0;
        return Math.min(cfg.lifestealPctMax, cfg.lifestealPctPerStack * this.skill2.stacks);
    },
    getSkill2DefenseBonusPercent(profId) {
        const cfg = RT_TOGGLE_SKILLS[profId];
        if (!this._skill2Active(profId) || !cfg || !cfg.defPctPerStack) return 0;
        return Math.min(cfg.defPctMax, cfg.defPctPerStack * this.skill2.stacks);
    },
    // Pícaro: +2%/stack de probabilidad de crítico (máx 20% a 10 stacks) —
    // reemplazó la reducción de cooldown del Ataque 1 que tenía antes, a
    // pedido del usuario.
    getSkill2CritChanceBonusPercent(profId) {
        const cfg = RT_TOGGLE_SKILLS[profId];
        if (!this._skill2Active(profId) || !cfg || !cfg.critPctPerStack) return 0;
        return Math.min(cfg.critPctMax, cfg.critPctPerStack * this.skill2.stacks);
    },

    // Radio efectivo del círculo exterior/alcance de la habilidad toggle:
    // el `radius` base de RT_TOGGLE_SKILLS escala +3% por Tier del arma
    // equipada (Bronce=+0%, Hierro=+3%, ... Absoluto=+27%) y +3% por nivel
    // de rareza (Común=+0%, Poco Común=+3%, ... Mítico=+15%) — ambos
    // aditivos, se multiplican entre sí. El arma "automática" (sin
    // craftear) no tiene rareza propia, cuenta como Común (+0%).
    getSkill2EffectiveRadius(profId) {
        const cfg = RT_TOGGLE_SKILLS[profId];
        if (!cfg || !this.player) return cfg ? cfg.radius : 0;
        const weapon = this.player.getCurrentWeapon();
        const tierId = weapon.tier ? weapon.tier.id : 1;
        const rarityIdx = weapon.rarity ? Math.max(0, MONSTER_RARITIES.findIndex(r => r.id === weapon.rarity.id)) : 0;
        const tierMult = 1 + 0.03 * (tierId - 1);
        const rarityMult = 1 + 0.03 * rarityIdx;
        return cfg.radius * tierMult * rarityMult;
    },

    // Dibuja los objetos orbitales/círculo de la habilidad toggle activa
    // (llamado desde game.js/render(), DENTRO del translate de cámara).
    // Implementado en canvas (no <div>/CSS, como sugería la especificación)
    // para quedar consistente con el resto del pipeline visual del juego
    // (mismo ctx.translate de cámara, mismo z-order que enemigos/efectos) —
    // ver nota en el resumen de esta tarea.
    renderSkill2(ctx) {
        if (!this.skill2.active || !this.player) return;
        const cfg = RT_TOGGLE_SKILLS[this.skill2.profId];
        if (!cfg) return;
        const player = this.player;
        const now = Date.now();
        const rotation = cfg.orbitMs > 0 ? ((now - this.skill2.orbitStartAt) % cfg.orbitMs) / cfg.orbitMs * Math.PI * 2 : 0;
        const effRadius = this.getSkill2EffectiveRadius(this.skill2.profId);

        ctx.beginPath();
        ctx.arc(player.x, player.y, effRadius, 0, Math.PI * 2);
        ctx.globalAlpha = 0.12;
        ctx.strokeStyle = cfg.color;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Los objetos se dibujan sobre el círculo EXTERIOR (radio efectivo,
        // el mismo anillo tenue de arriba) — es el mismo radio que el
        // alcance real del pulso de daño automático.
        for (let i = 0; i < cfg.objectCount; i++) {
            const angle = rotation + (i / cfg.objectCount) * Math.PI * 2;
            const ox = player.x + Math.cos(angle) * effRadius;
            const oy = player.y + Math.sin(angle) * effRadius;
            ctx.save();
            ctx.translate(ox, oy);
            ctx.rotate(angle); // apunta hacia AFUERA del círculo (radiante)
            ctx.globalAlpha = 0.9;
            ctx.fillStyle = cfg.color;
            ctx.shadowColor = cfg.color;
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.moveTo(-4, -12);
            ctx.lineTo(4, -12);
            ctx.lineTo(2, 12);
            ctx.lineTo(-2, 12);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        }
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
        // El conteo de stacks ya no se dibuja sobre la cabeza del jugador
        // (redundante con #effects-hud, ver UI.updateEffectsHUD).
    },

    // ----- HECHIZO DE TECLA "1" (ver RT_SKILL1_ABILITIES) -----
    // Mecánica de disparo compartida por las 6 clases: keydown "1" entra en
    // modo "apuntando" (ver startAimSkill1), keyup "1" lanza el hechizo
    // hacia donde apuntaba el mouse en ese instante (ver releaseSkill1 →
    // fireSkill1 → fireSkill1<Clase>). Bárbaro es la única excepción: su
    // primera pulsación activa el aura al instante sin apuntar (ver
    // activateBarbaroFury) — solo la segunda (aura ya activa) entra en modo
    // apuntando, para el dash de cancelación.
    startAimSkill1() {
        if (!this.player || this.player.hp <= 0) return;
        const profId = this.player.activeProfession;
        if (profId === 'barbaro' && !this.skill1.barbaroActive) {
            this.activateBarbaroFury();
            return;
        }
        if (Date.now() < this.skill1CooldownUntil) return;
        this.skill1.aiming = true;
    },

    // Soltar la ventana/perder foco mientras se apunta: cancela sin lanzar
    // (ver blur en game.js/bindInput).
    cancelAimSkill1() {
        this.skill1.aiming = false;
    },

    releaseSkill1(aimWorldPos) {
        if (!this.skill1.aiming) return;
        this.skill1.aiming = false;
        this.fireSkill1(aimWorldPos);
    },

    fireSkill1(aimWorldPos) {
        if (!this.player || this.player.hp <= 0) return;
        const profId = this.player.activeProfession;
        const cfg = RT_SKILL1_ABILITIES[profId];
        if (!cfg) return;

        // `aimDist` = distancia real al mouse (Infinity si no hay posición
        // de mouse todavía, para que el salto/teletransporte caiga al rango
        // máximo configurado por defecto) — Guerrero/Mago lo usan para
        // elegir dónde caer DENTRO de su rango en vez de siempre caer al
        // máximo (ver fireSkill1Guerrero/fireSkill1Mago).
        let dirX = 0, dirY = -1, aimDist = Infinity;
        if (aimWorldPos) {
            dirX = aimWorldPos.x - this.player.x;
            dirY = aimWorldPos.y - this.player.y;
            aimDist = Math.hypot(dirX, dirY);
            const len = aimDist || 1;
            dirX /= len; dirY /= len;
        }

        if (profId === 'picaro') this.fireSkill1Picaro(cfg, dirX, dirY);
        else if (profId === 'guerrero') this.fireSkill1Guerrero(cfg, dirX, dirY, aimDist);
        else if (profId === 'barbaro') this.fireSkill1BarbaroDash(cfg, dirX, dirY);
        else if (profId === 'tanque') this.fireSkill1Tanque(cfg);
        else if (profId === 'mago') this.fireSkill1Mago(cfg, dirX, dirY, aimDist);
        else if (profId === 'arquero') this.fireSkill1Arquero(cfg, dirX, dirY);
    },

    // Punto furthest caminable en línea recta desde (fromX,fromY) hacia
    // (dirX,dirY) hasta `maxDist` (ver dungeon.isWalkable) — usado por todo
    // dash/salto/teletransporte para no atravesar paredes. Sin `dungeon`
    // (no debería pasar en juego real), devuelve el destino sin clampear.
    computeWalkableDestination(fromX, fromY, dirX, dirY, maxDist, radius) {
        const dungeon = this.dungeon;
        if (!dungeon) return { x: fromX + dirX * maxDist, y: fromY + dirY * maxDist };
        const steps = Math.max(1, Math.round(maxDist / 10));
        let best = { x: fromX, y: fromY };
        for (let i = 1; i <= steps; i++) {
            const d = (i / steps) * maxDist;
            const cx = fromX + dirX * d, cy = fromY + dirY * d;
            if (dungeon.isWalkable(cx, cy, radius)) best = { x: cx, y: cy };
            else break;
        }
        return best;
    },

    // Teletransporte que SÍ puede atravesar paredes (Parpadeo Arcano del
    // Mago, pedido explícito del usuario: "puede pasar paredes, si el
    // rango lo permite") — a diferencia de computeWalkableDestination
    // (dashes/saltos "físicos", se detienen en la primera pared), acá solo
    // importa que el punto de LLEGADA sea caminable, no el camino entre
    // medio. Si el punto exacto a `dist` cae dentro de una pared (ej. el
    // mouse apuntaba justo ahí), busca hacia atrás — desde el destino
    // hacia el jugador — el punto caminable más cercano, en vez de
    // simplemente no teletransportar.
    computeTeleportDestination(fromX, fromY, dirX, dirY, dist, radius) {
        const dungeon = this.dungeon;
        const targetX = fromX + dirX * dist, targetY = fromY + dirY * dist;
        if (!dungeon || dungeon.isWalkable(targetX, targetY, radius)) return { x: targetX, y: targetY };
        const steps = Math.max(1, Math.round(dist / 10));
        for (let i = steps - 1; i >= 0; i--) {
            const d = (i / steps) * dist;
            const cx = fromX + dirX * d, cy = fromY + dirY * d;
            if (dungeon.isWalkable(cx, cy, radius)) return { x: cx, y: cy };
        }
        return { x: fromX, y: fromY };
    },

    // Arranca un dash/salto animado (ver tick en updateRealtime): interpola
    // player.x/y de start a end durante `durationMs`. `sweep:true` +
    // `onHitEnemy` detecta enemigos tocados a lo largo del camino (una vez
    // cada uno); `onComplete` corre al llegar (ej. el golpe de área del
    // Guerrero al aterrizar).
    startLeap(kind, endX, endY, durationMs, opts) {
        const player = this.player;
        this.leap = {
            kind, startX: player.x, startY: player.y, endX, endY,
            startAt: Date.now(), durationMs, hitSet: new Set(),
            sweep: !!(opts && opts.sweep),
            onHitEnemy: opts && opts.onHitEnemy,
            onComplete: opts && opts.onComplete,
        };
    },

    // Pícaro — Estocada Fantasma: ver RT_SKILL1_ABILITIES.picaro.
    fireSkill1Picaro(cfg, dirX, dirY) {
        this.skill1CooldownUntil = Date.now() + cfg.cooldownMs;
        const dest = this.computeWalkableDestination(this.player.x, this.player.y, dirX, dirY, cfg.dashRange, this.player.radius);
        const weapon = this.player.getCurrentWeapon();
        const baseDmg = cfg.dmgBase * (weapon.tier ? weapon.tier.mult : 1) * (weapon.rarity ? weapon.rarity.mult : 1);
        const flatPenetration = this.player.stats.destreza * STAT_DESTREZA_ARMOR_PEN;
        this.startLeap('picaro_dash', dest.x, dest.y, cfg.dashDurationMs, {
            sweep: true,
            onHitEnemy: (enemy) => {
                // El bono de zona se evalúa en el momento del golpe (no al
                // lanzar): la posición del jugador cambia frame a frame
                // durante el dash (ver getPlayerZoneDamageBonusPercent).
                const dmg = baseDmg * (1 + this.getPlayerZoneDamageBonusPercent());
                const dealt = enemy.takeDamage(dmg, { flatPenetration });
                this.spawnImpactFlash(enemy.x, enemy.y, cfg.color);
                this.floatDamage(enemy, dealt, false);
                if (!enemy.alive && !enemy._deathHandled) {
                    enemy._deathHandled = true;
                    this.skill1CooldownUntil = Math.max(Date.now(), this.skill1CooldownUntil - cfg.cdReductionPerKillMs);
                    this.skill1.picaroDashCritStacks = Math.min(cfg.critPerKillMaxStacks, this.skill1.picaroDashCritStacks + 1);
                    this.onEnemyDefeated(enemy);
                }
            },
        });
    },

    // Guerrero — Salto Sísmico: ver RT_SKILL1_ABILITIES.guerrero.
    fireSkill1Guerrero(cfg, dirX, dirY, aimDist) {
        this.skill1CooldownUntil = Date.now() + cfg.cooldownMs;
        // Cae donde apuntaba el mouse si estaba MÁS CERCA que el rango
        // máximo (ver aimDist en fireSkill1) — no siempre salta al tope.
        const jumpDist = Math.min(cfg.jumpRange, aimDist);
        const dest = this.computeWalkableDestination(this.player.x, this.player.y, dirX, dirY, jumpDist, this.player.radius);
        this.startLeap('guerrero_jump', dest.x, dest.y, cfg.jumpDurationMs, {
            onComplete: () => {
                // La zona se crea ANTES de calcular el golpe de aterrizaje:
                // el jugador cae justo en el centro, así que su propio
                // impacto también se beneficia del +25% (ver
                // getPlayerZoneDamageBonusPercent).
                this.zones.push({ kind: 'guerrero_vuln', x: dest.x, y: dest.y, radius: cfg.slamRadius, dmgBonusPercent: cfg.zoneDmgBonusPercent, createdAt: Date.now(), expiresAt: Date.now() + cfg.zoneDurationMs, color: cfg.color });

                const weapon = this.player.getCurrentWeapon();
                let dmg = cfg.dmgBase * (weapon.tier ? weapon.tier.mult : 1) * (weapon.rarity ? weapon.rarity.mult : 1);
                dmg *= (1 + this.getSkill3GuerreroDmgBonusPercent('guerrero'));
                dmg *= (1 + this.getPlayerZoneDamageBonusPercent());
                dmg *= (1 + this.player.getArmorDamageBonusPercent());
                const flatPenetration = this.player.stats.destreza * STAT_DESTREZA_ARMOR_PEN;
                const targets = this.getEnemiesInCircle(dest.x, dest.y, cfg.slamRadius);
                targets.forEach(t => {
                    const dealt = t.takeDamage(dmg, { flatPenetration });
                    this.spawnImpactFlash(t.x, t.y, cfg.color);
                    this.floatDamage(t, dealt, false);
                    if (!t.alive && !t._deathHandled) { t._deathHandled = true; this.onEnemyDefeated(t); }
                });
                this.effects.push({ kind: 'circle', x: dest.x, y: dest.y, followPlayer: false, range: cfg.slamRadius, startRange: 0, color: cfg.color, createdAt: Date.now(), duration: 300 });
            },
        });
    },

    // Bárbaro — Furia Sangrienta: primera pulsación (ver startAimSkill1).
    activateBarbaroFury() {
        const cfg = RT_SKILL1_ABILITIES.barbaro;
        this.skill1.barbaroActive = true;
        this.skill1.barbaroActiveUntil = Date.now() + cfg.baseDurationMs;
        if (this.spawnFloatingText) {
            this.spawnFloatingText(this.player.x, this.player.y - this.player.radius - 30, `${cfg.emoji} ${cfg.name} activada`, cfg.color);
        }
    },

    // Bárbaro — dash de cancelación (segunda pulsación, con el aura ya
    // activa): ver RT_SKILL1_ABILITIES.barbaro/getBarbaroDashDamage.
    fireSkill1BarbaroDash(cfg, dirX, dirY) {
        this.skill1.barbaroActive = false;
        this.skill1CooldownUntil = Date.now() + cfg.cancelCooldownMs;
        const dest = this.computeWalkableDestination(this.player.x, this.player.y, dirX, dirY, cfg.dashRange, this.player.radius);
        const hpPercent = this.player.hp / this.player.maxHp;
        const baseDmg = getBarbaroDashDamage(hpPercent);
        const flatPenetration = this.player.stats.destreza * STAT_DESTREZA_ARMOR_PEN;
        this.startLeap('barbaro_dash', dest.x, dest.y, cfg.dashDurationMs, {
            sweep: true,
            onHitEnemy: (enemy) => {
                const dmg = baseDmg * (1 + this.getPlayerZoneDamageBonusPercent());
                const dealt = enemy.takeDamage(dmg, { flatPenetration });
                this.spawnImpactFlash(enemy.x, enemy.y, cfg.color);
                this.floatDamage(enemy, dealt, false);
                if (!enemy.alive && !enemy._deathHandled) {
                    enemy._deathHandled = true;
                    this.player.heal(this.player.maxHp * cfg.dashKillHealPercent);
                    this.onEnemyDefeated(enemy);
                }
            },
        });
    },

    // Tanque — Bastión: círculo estático en la posición actual del jugador
    // al soltar "1" (ver RT_SKILL1_ABILITIES.tanque).
    fireSkill1Tanque(cfg) {
        this.skill1CooldownUntil = Date.now() + cfg.cooldownMs;
        this.zones.push({
            kind: 'tanque_bastion', x: this.player.x, y: this.player.y, radius: cfg.radius,
            allyDefBonusPercent: cfg.allyDefenseBonusPercent, enemyDmgReducePercent: cfg.enemyDamageReducePercent,
            createdAt: Date.now(), expiresAt: Date.now() + cfg.durationMs, color: cfg.color,
        });
        this.effects.push({ kind: 'circle', x: this.player.x, y: this.player.y, followPlayer: false, range: cfg.radius, startRange: cfg.radius * 0.9, color: cfg.color, createdAt: Date.now(), duration: 300 });
    },

    // Mago — Parpadeo Arcano: teletransporte instantáneo, sin animación de
    // vuelo (ver RT_SKILL1_ABILITIES.mago).
    fireSkill1Mago(cfg, dirX, dirY, aimDist) {
        this.skill1CooldownUntil = Date.now() + cfg.cooldownMs;
        // Se teletransporta hasta donde apuntaba el mouse si estaba MÁS
        // CERCA que el rango máximo (ver aimDist en fireSkill1) — no
        // siempre salta al tope. Puede ATRAVESAR paredes (pedido
        // explícito): usa computeTeleportDestination, no
        // computeWalkableDestination (esa es para dashes físicos).
        const teleportDist = Math.min(cfg.teleportRange, aimDist);
        const dest = this.computeTeleportDestination(this.player.x, this.player.y, dirX, dirY, teleportDist, this.player.radius);
        this.player.x = dest.x;
        this.player.y = dest.y;
        this.skill1.mageDmgBuffUntil = Date.now() + cfg.dmgBuffDurationMs;
        this.effects.push({ kind: 'flash', x: dest.x, y: dest.y, color: cfg.color, createdAt: Date.now(), duration: 300 });
        if (this.spawnFloatingText) {
            this.spawnFloatingText(dest.x, dest.y - this.player.radius - 20, `+${Math.round(cfg.dmgBuffPercent * 100)}% daño`, cfg.color, 1000);
        }
    },

    // Arquero — Retirada Certera: salto hacia atrás (opuesto al mouse) +
    // ataque frontal (misma geometría del Ataque 1) que ralentiza en vez de
    // solo dañar, + velocidad de movimiento temporal (ver
    // RT_SKILL1_ABILITIES.arquero).
    fireSkill1Arquero(cfg, dirX, dirY) {
        this.skill1CooldownUntil = Date.now() + cfg.cooldownMs;
        this.skill1.archerSpeedBuffUntil = Date.now() + cfg.speedBuffDurationMs;

        const geometry = getAttackGeometry('arquero', 0);
        const targets = this.getEnemiesInCone(this.player.x, this.player.y, dirX, dirY, geometry.range, geometry.angle);
        this.spawnAttackEffect(0, dirX, dirY, geometry);
        const weaponAttacks = this.getActiveWeaponAttacks();
        const atk = weaponAttacks ? weaponAttacks.basic[0] : null;
        if (atk) {
            const eff = this.player.getActiveEnchantEffects();
            const potenciaMult = 1 + this.player.stats.potencia * STAT_POTENCIA_DMG_PERCENT;
            const dmg = atk.damage * potenciaMult * (1 + eff.dmgBonusPercent) * (1 + this.getSkill3DamageBuffPercent('arquero')) * (1 + this.getPlayerZoneDamageBonusPercent());
            const flatPenetration = this.player.stats.destreza * STAT_DESTREZA_ARMOR_PEN;
            targets.forEach(t => {
                const dealt = t.takeDamage(dmg, { flatPenetration });
                this.spawnImpactFlash(t.x, t.y, cfg.color);
                this.floatDamage(t, dealt, false);
                t.speedMod = { percent: cfg.slowPercent, expiresAt: Date.now() + cfg.slowDurationMs };
                if (!t.alive && !t._deathHandled) { t._deathHandled = true; this.onEnemyDefeated(t); }
            });
        }

        const dest = this.computeWalkableDestination(this.player.x, this.player.y, -dirX, -dirY, cfg.jumpRange, this.player.radius);
        this.startLeap('arquero_jump', dest.x, dest.y, cfg.jumpDurationMs, {});
    },

    // ----- BONOS/DEBUFFS DEL HECHIZO DE TECLA "1" (ver RT_SKILL1_ABILITIES) -----
    // +25% de daño de SALIDA del jugador mientras esté parado dentro de la
    // zona del Salto Sísmico del Guerrero — no importa dónde estén los
    // enemigos, solo dónde está el jugador (ver fireSkill1Guerrero). Se
    // suma a `dmg` en cada sitio donde el jugador calcula daño (mismo
    // patrón que getSkill1DamageBuffPercent del Mago, pero por posición en
    // vez de por timestamp).
    getPlayerZoneDamageBonusPercent() {
        if (!this.player) return 0;
        let bonus = 0;
        const now = Date.now();
        this.zones.forEach(z => {
            if (z.kind !== 'guerrero_vuln' || now >= z.expiresAt) return;
            if (Math.hypot(this.player.x - z.x, this.player.y - z.y) <= z.radius) bonus += z.dmgBonusPercent;
        });
        return bonus;
    },

    // Multiplicador de daño de ATAQUE de un enemigo por el Bastión del
    // Tanque (-30% mientras esté parado adentro) — llamado desde
    // performEnemyAttackRT.
    getEnemyZoneDamageMultiplier(enemy) {
        let mult = 1;
        const now = Date.now();
        this.zones.forEach(z => {
            if (z.kind !== 'tanque_bastion' || now >= z.expiresAt) return;
            if (Math.hypot(enemy.x - z.x, enemy.y - z.y) <= z.radius) mult *= (1 - z.enemyDmgReducePercent);
        });
        return Math.max(0, mult);
    },

    // +50% de mitigación de armadura mientras el jugador esté parado dentro
    // de un Bastión activo (el suyo, es el único jugador) — llamado desde
    // Player.takeDamage.
    getPlayerZoneDefenseBonusPercent() {
        if (!this.player) return 0;
        let bonus = 0;
        const now = Date.now();
        this.zones.forEach(z => {
            if (z.kind !== 'tanque_bastion' || now >= z.expiresAt) return;
            if (Math.hypot(this.player.x - z.x, this.player.y - z.y) <= z.radius) bonus += z.allyDefBonusPercent;
        });
        return bonus;
    },

    // Mago: +20% de daño temporal tras Parpadeo Arcano — 0 si no aplica.
    getSkill1DamageBuffPercent(profId) {
        if (profId === 'mago' && Date.now() < this.skill1.mageDmgBuffUntil) return RT_SKILL1_ABILITIES.mago.dmgBuffPercent;
        return 0;
    },

    // Arquero: +20% de velocidad temporal tras Retirada Certera — 0 si no aplica.
    getSkill1SpeedBonusPercent(profId) {
        if (profId === 'arquero' && Date.now() < this.skill1.archerSpeedBuffUntil) return RT_SKILL1_ABILITIES.arquero.speedBuffPercent;
        return 0;
    },

    // Bárbaro: +20% de robo de vida mientras Furia Sangrienta esté activa — 0 si no aplica.
    getSkill1LifestealBonusPercent(profId) {
        if (profId === 'barbaro' && this.skill1.barbaroActive) return RT_SKILL1_ABILITIES.barbaro.lifestealPercent;
        return 0;
    },
    // Pícaro: +5%/kill con la Estocada Fantasma de probabilidad de crítico,
    // PERMANENTE (máx 30% a 6 stacks, ver skill1.picaroDashCritStacks) —
    // el contador no se resetea al cambiar de clase, pero solo se APLICA
    // mientras Pícaro sea la clase activa, igual que el resto de bonos.
    getPicaroDashCritBonusPercent(profId) {
        if (profId !== 'picaro') return 0;
        const cfg = RT_SKILL1_ABILITIES.picaro;
        return Math.min(cfg.critPerKillMaxStacks * cfg.critPerKillPercent, this.skill1.picaroDashCritStacks * cfg.critPerKillPercent);
    },

    // Vista previa mientras se mantiene "1" (ver startAimSkill1): línea de
    // dirección + círculo de destino/área, según la clase — llamado desde
    // game.js/render() con la posición de mouse más reciente.
    renderSkill1Aim(ctx, aimWorldPos) {
        if (!this.skill1.aiming || !this.player) return;
        const profId = this.player.activeProfession;
        const cfg = RT_SKILL1_ABILITIES[profId];
        if (!cfg) return;
        const player = this.player;

        let dirX = 0, dirY = -1, aimDist = Infinity;
        if (aimWorldPos) {
            dirX = aimWorldPos.x - player.x; dirY = aimWorldPos.y - player.y;
            aimDist = Math.hypot(dirX, dirY);
            const len = aimDist || 1;
            dirX /= len; dirY /= len;
        }

        const drawLine = (dx, dy, dist, color) => {
            ctx.beginPath();
            ctx.moveTo(player.x, player.y);
            ctx.lineTo(player.x + dx * dist, player.y + dy * dist);
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.setLineDash([8, 6]);
            ctx.globalAlpha = 0.85;
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.globalAlpha = 1;
        };
        const drawPreviewCircle = (cx, cy, r, color) => {
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.strokeStyle = color;
            ctx.globalAlpha = 0.6;
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.globalAlpha = 0.12;
            ctx.fillStyle = color;
            ctx.fill();
            ctx.globalAlpha = 1;
        };

        if (profId === 'picaro') {
            const dest = this.computeWalkableDestination(player.x, player.y, dirX, dirY, cfg.dashRange, player.radius);
            drawLine(dirX, dirY, Math.hypot(dest.x - player.x, dest.y - player.y), cfg.color);
        } else if (profId === 'guerrero') {
            const jumpDist = Math.min(cfg.jumpRange, aimDist);
            const dest = this.computeWalkableDestination(player.x, player.y, dirX, dirY, jumpDist, player.radius);
            drawLine(dirX, dirY, Math.hypot(dest.x - player.x, dest.y - player.y), cfg.color);
            drawPreviewCircle(dest.x, dest.y, cfg.slamRadius, cfg.color);
        } else if (profId === 'barbaro') {
            // Solo se llega acá con el aura YA activa (ver startAimSkill1) —
            // vista previa del dash de cancelación.
            const dest = this.computeWalkableDestination(player.x, player.y, dirX, dirY, cfg.dashRange, player.radius);
            drawLine(dirX, dirY, Math.hypot(dest.x - player.x, dest.y - player.y), cfg.color);
        } else if (profId === 'tanque') {
            drawPreviewCircle(player.x, player.y, cfg.radius, cfg.color);
        } else if (profId === 'mago') {
            const teleportDist = Math.min(cfg.teleportRange, aimDist);
            const dest = this.computeTeleportDestination(player.x, player.y, dirX, dirY, teleportDist, player.radius);
            drawLine(dirX, dirY, Math.hypot(dest.x - player.x, dest.y - player.y), cfg.color);
            drawPreviewCircle(dest.x, dest.y, player.radius, cfg.color);
        } else if (profId === 'arquero') {
            const geometry = getAttackGeometry('arquero', 0);
            drawLine(dirX, dirY, geometry.range, cfg.color);
            const backDest = this.computeWalkableDestination(player.x, player.y, -dirX, -dirY, cfg.jumpRange, player.radius);
            drawPreviewCircle(backDest.x, backDest.y, player.radius, cfg.color);
        }
    },

    // Zonas persistentes en el suelo (Salto Sísmico del Guerrero / Bastión
    // del Tanque) + aura del Bárbaro mientras Furia Sangrienta esté activa —
    // llamado desde game.js/render(), dentro del translate de cámara.
    renderSkill1(ctx) {
        const now = Date.now();
        this.zones.forEach(z => {
            if (now >= z.expiresAt) return;
            ctx.beginPath();
            ctx.arc(z.x, z.y, z.radius, 0, Math.PI * 2);
            ctx.globalAlpha = 0.35;
            ctx.strokeStyle = z.color;
            ctx.lineWidth = 3;
            ctx.stroke();
            ctx.globalAlpha = 0.08;
            ctx.fillStyle = z.color;
            ctx.fill();
            ctx.globalAlpha = 1;
        });
        if (this.skill1.barbaroActive && this.player) {
            const cfg = RT_SKILL1_ABILITIES.barbaro;
            ctx.beginPath();
            ctx.arc(this.player.x, this.player.y, cfg.auraRadius, 0, Math.PI * 2);
            ctx.globalAlpha = 0.5;
            ctx.strokeStyle = cfg.color;
            ctx.lineWidth = 3;
            ctx.stroke();
            ctx.globalAlpha = 1;
        }
    },

    // ----- HECHIZO DE TECLA "3" (ver RT_SKILL3_ABILITIES) -----
    // Mismo patrón que la tecla "1": mantener "3" entra en modo "apuntando"
    // (dibuja línea guía, ver renderSkill3Aim), soltarla lo lanza hacia
    // donde apuntaba el mouse en ese instante. No-opea si la clase activa
    // todavía no tiene una entrada en RT_SKILL3_ABILITIES.
    startAimSkill3() {
        if (!this.player || this.player.hp <= 0) return;
        const profId = this.player.activeProfession;
        if (!RT_SKILL3_ABILITIES[profId]) return;
        if (Date.now() < this.skill3CooldownUntil) return;
        this.skill3.aiming = true;
    },

    cancelAimSkill3() {
        this.skill3.aiming = false;
    },

    releaseSkill3(aimWorldPos) {
        if (!this.skill3.aiming) return;
        this.skill3.aiming = false;
        this.fireSkill3(aimWorldPos);
    },

    fireSkill3(aimWorldPos) {
        if (!this.player || this.player.hp <= 0) return;
        const profId = this.player.activeProfession;
        const cfg = RT_SKILL3_ABILITIES[profId];
        if (!cfg) return;

        let dirX = 0, dirY = -1, aimDist = Infinity;
        if (aimWorldPos) {
            dirX = aimWorldPos.x - this.player.x;
            dirY = aimWorldPos.y - this.player.y;
            aimDist = Math.hypot(dirX, dirY);
            const len = aimDist || 1;
            dirX /= len; dirY /= len;
        }

        if (profId === 'mago') this.fireSkill3MagoVortex(cfg, dirX, dirY, aimDist);
        else if (profId === 'arquero') this.fireSkill3ArqueroArrow(cfg, dirX, dirY);
        else if (profId === 'guerrero') this.fireSkill3GuerreroExecute(cfg, dirX, dirY);
        else if (profId === 'picaro') this.fireSkill3PicaroCloneDash(cfg, dirX, dirY, aimDist);
        else if (profId === 'tanque') this.fireSkill3TanqueCircle(cfg);
        else if (profId === 'barbaro') this.fireSkill3BarbaroSpin(cfg);
    },

    // Tanque — Círculo del Gigante: sin dirección/aim real (círculo
    // centrado en el propio jugador, sigue al pedido "un círculo alrededor
    // del jugador"), pero mantiene el mismo flujo de mantener/soltar "3"
    // que el resto de hechizos para no romper la UX establecida (ver
    // renderSkill3Aim para la vista previa). Reinicia los stacks de
    // Gigante de cualquier lanzamiento anterior.
    fireSkill3TanqueCircle(cfg) {
        this.skill3CooldownUntil = Date.now() + cfg.cooldownMs;
        this.skill3.tanqueActive = true;
        this.skill3.tanqueActiveUntil = Date.now() + cfg.durationMs;
        this.skill3.tanqueGiantStacks = 0;
        this.player.recalcMaxHp();
        this.effects.push({ kind: 'circle', x: this.player.x, y: this.player.y, followPlayer: true, range: cfg.radius, startRange: cfg.radius * 0.85, color: cfg.color, createdAt: Date.now(), duration: 400 });
    },

    // Arrastra UN enemigo hacia el jugador (mismo patrón que
    // Enemy.stepToward, respeta paredes) — llamado desde updateRealtime
    // para cada enemigo vivo dentro del radio del Círculo del Gigante.
    tickTanqueCirclePull(en, dt, player, dungeon) {
        const cfg = RT_SKILL3_ABILITIES.tanque;
        const dist = Math.hypot(en.x - player.x, en.y - player.y);
        if (dist > cfg.radius || dist < 1) return;
        // Cap el paso a la distancia restante para no "pasarse" del jugador
        // en un frame con dt grande (salto de rendimiento/timejump).
        const step = Math.min(dist, cfg.pullSpeedPxPerSec * (dt / 1000));
        const dx = (player.x - en.x) / dist, dy = (player.y - en.y) / dist;
        const nx = en.x + dx * step, ny = en.y + dy * step;
        if (!dungeon || dungeon.isWalkable(nx, en.y, en.radius)) en.x = nx;
        if (!dungeon || dungeon.isWalkable(en.x, ny, en.radius)) en.y = ny;
    },

    // Tanque: -30% de daño recibido mientras el Círculo del Gigante esté
    // activo — reducción DIRECTA (ver Player.takeDamage), no un bono de
    // mitigación de armadura.
    getSkill3TanqueDamageReducePercent(profId) {
        if (profId !== 'tanque' || !this.skill3.tanqueActive) return 0;
        return RT_SKILL3_ABILITIES.tanque.damageReducePercent;
    },
    // Tanque: +3%/stack de "Gigante" de resistencias (máx 10 stacks/30%) —
    // mismo mecanismo que defPctPerStack (bono de mitigación de armadura).
    getTanqueGiantDefenseBonusPercent(profId) {
        if (profId !== 'tanque' || !this.skill3.tanqueActive) return 0;
        const cfg = RT_SKILL3_ABILITIES.tanque;
        return Math.min(cfg.giantMaxStacks * cfg.giantDefPerStackPercent, this.skill3.tanqueGiantStacks * cfg.giantDefPerStackPercent);
    },
    // Tanque: +10%/stack de "Gigante" de vida máxima (máx 10 stacks/100%) —
    // multiplicador leído desde Player.recalcMaxHp.
    getTanqueGiantMaxHpBonusPercent(profId) {
        if (profId !== 'tanque' || !this.skill3.tanqueActive) return 0;
        const cfg = RT_SKILL3_ABILITIES.tanque;
        return Math.min(cfg.giantMaxStacks * cfg.giantHpPerStackPercent, this.skill3.tanqueGiantStacks * cfg.giantHpPerStackPercent);
    },

    // Bárbaro — Torbellino de Espadas: sin dirección/aim (mismo criterio
    // "sin apuntar" que el Círculo del Gigante del Tanque). `lastOffset`
    // arranca en 0 — el primer tick de updateRealtime ya aplica el primer
    // tramo de barrido, no hace falta un golpe inicial aparte.
    fireSkill3BarbaroSpin(cfg) {
        this.skill3CooldownUntil = Date.now() + cfg.cooldownMs;
        this.barbaroSpin = { startAt: Date.now(), durationMs: cfg.durationMs, lastOffset: 0, hitSet: new Set(), reducedMs: 0 };
    },

    // Daño de golpe FIJO (no escala con arma/tier, ver RT_SKILL3_ABILITIES.
    // barbaro.dmgPerHit) multiplicado por la misma cadena universal de
    // bonos de daño que el resto de hechizos de tecla "3".
    computeBarbaroSpinDamage() {
        const cfg = RT_SKILL3_ABILITIES.barbaro;
        const profId = this.player.activeProfession;
        let dmg = cfg.dmgPerHit;
        dmg *= (1 + this.getSkill2DamageBonusPercent(profId));
        dmg *= (1 + this.getSkill1DamageBuffPercent(profId));
        dmg *= (1 + this.getSkill3DamageBuffPercent(profId));
        dmg *= (1 + this.getSkill3GuerreroDmgBonusPercent(profId));
        dmg *= (1 + this.getPlayerZoneDamageBonusPercent());
        dmg *= (1 + this.player.getArmorDamageBonusPercent());
        return Math.round(dmg);
    },

    // Robo de vida TOTAL actual del Bárbaro (encantamiento + Furia
    // Sangrienta + stacks de Hachas Orbitales) — mismo cálculo combinado
    // que ya usan tickToggleSkill/resolvePlayerAttack para el robo de vida
    // normal, reutilizado acá como base para el x2 del Torbellino de Espadas.
    getBarbaroCurrentLifestealPercent() {
        const player = this.player;
        if (!player) return 0;
        const eff = player.getActiveEnchantEffects();
        return (eff.lifestealPercent || 0) + this.getSkill2LifestealBonusPercent('barbaro') + this.getSkill1LifestealBonusPercent('barbaro');
    },

    // Aplica los golpes de las 2 espadas para el tramo angular recién
    // barrido este frame (prevOffset -> currOffset, ver updateRealtime).
    // Cada espada arranca 180° opuesta a la otra (0 y π); con el tiempo
    // ambas terminan pasando por todos los ángulos (una a mitad de la
    // animación, la otra al otro extremo) — hitSet es lo que garantiza que
    // cada enemigo sólo sea tocado UNA vez por lanzamiento, sin importar
    // cuál de las dos llegue primero a su ángulo.
    applyBarbaroSpinHits(prevOffset, currOffset) {
        const spin = this.barbaroSpin;
        if (!spin) return;
        const player = this.player;
        const cfg = RT_SKILL3_ABILITIES.barbaro;
        const innerR = player.radius;
        const outerR = player.radius + cfg.bladeLength;
        const dmg = this.computeBarbaroSpinDamage();
        const lifestealPct = this.getBarbaroCurrentLifestealPercent() * cfg.lifestealMultiplier;
        const flatPenetration = player.stats.destreza * STAT_DESTREZA_ARMOR_PEN;
        let totalHeal = 0;
        [0, Math.PI].forEach(baseAngle => {
            const from = prevOffset + baseAngle, to = currOffset + baseAngle;
            this.enemies.forEach(en => {
                if (!en.alive || spin.hitSet.has(en)) return;
                const dist = Math.hypot(en.x - player.x, en.y - player.y);
                if (dist < innerR - en.radius || dist > outerR + en.radius) return;
                const angleTo = Math.atan2(en.y - player.y, en.x - player.x);
                if (!isAngleInSweep(angleTo, from, to)) return;
                spin.hitSet.add(en);
                const dealt = en.takeDamage(dmg, { flatPenetration });
                this.spawnImpactFlash(en.x, en.y, cfg.color);
                this.floatDamage(en, dealt, false);
                if (lifestealPct > 0) totalHeal += Math.round(dmg * lifestealPct);
                if (!en.alive) {
                    if (!en._deathHandled) { en._deathHandled = true; this.onEnemyDefeated(en); }
                    const reduceMs = Math.min(cfg.cdReductionPerKillMs, cfg.cdReductionMaxMs - spin.reducedMs);
                    if (reduceMs > 0) {
                        this.skill3CooldownUntil = Math.max(Date.now(), this.skill3CooldownUntil - reduceMs);
                        spin.reducedMs += reduceMs;
                    }
                }
            });
        });
        if (totalHeal > 0) player.heal(totalHeal);
    },

    // Mago — Vórtice Arcano: ver RT_SKILL3_ABILITIES.mago para la fórmula
    // de crecimiento/velocidad. `aimDist` (distancia real al mouse, ver
    // fireSkill3) determina cuánto viaja realmente el vórtice — no siempre
    // llega al máximo, igual que el salto/teletransporte de la tecla "1".
    fireSkill3MagoVortex(cfg, dirX, dirY, aimDist) {
        this.skill3CooldownUntil = Date.now() + cfg.cooldownMs;
        const player = this.player;
        const aimedDist = Math.min(cfg.maxTravelDist, aimDist);
        // Radio pequeño y fijo (no el del jugador) para el chequeo de
        // paredes: el vórtice es un proyectil, no un dash del propio jugador.
        const dest = this.computeWalkableDestination(player.x, player.y, dirX, dirY, aimedDist, 10);
        const actualTravelDist = Math.hypot(dest.x - player.x, dest.y - player.y);
        const finalRadius = cfg.minRadius + Math.max(0, (actualTravelDist - cfg.growthStartDist) / cfg.growthDivisor);
        const travelDurationMs = Math.max(1, (actualTravelDist / cfg.travelSpeedPxPerSec) * 1000);

        const weapon = player.getCurrentWeapon();
        this.vortex = {
            profId: 'mago', cfg,
            startX: player.x, startY: player.y,
            endX: dest.x, endY: dest.y,
            x: player.x, y: player.y,
            startAt: Date.now(), travelDurationMs,
            currentRadius: cfg.minRadius, finalRadius,
            phase: 'traveling', hitSet: new Set(),
            staticUntil: 0, lastStaticTickAt: 0,
            tierMult: weapon.tier ? weapon.tier.mult : 1,
            rarityMult: weapon.rarity ? weapon.rarity.mult : 1,
            rotationStartAt: Date.now(),
        };
    },

    // Daño de un golpe del vórtice: escala con el arma equipada AL
    // LANZARLO (tier.mult × rareza.mult, mismo patrón que el resto de
    // hechizos) y con los bonos de daño del jugador EVALUADOS EN EL
    // MOMENTO del golpe (buff de Parpadeo Arcano si sigue activo, zona del
    // Salto Sísmico si el jugador está parado en ella ahora) — igual que el
    // dash del Pícaro/Bárbaro.
    computeVortexDamage(vortex, baseDamage) {
        let dmg = baseDamage * vortex.tierMult * vortex.rarityMult;
        dmg *= (1 + this.getSkill1DamageBuffPercent(vortex.profId));
        dmg *= (1 + this.getSkill3DamageBuffPercent(vortex.profId));
        dmg *= (1 + this.getPlayerZoneDamageBonusPercent());
        dmg *= (1 + this.player.getArmorDamageBonusPercent());
        return dmg;
    },

    // Arquero — Flecha Certera: ver RT_SKILL3_ABILITIES.arquero. A
    // diferencia de los demás hechizos con viaje, el alcance NO se acorta
    // por la distancia al mouse (ver comentario en la config) — siempre
    // apunta al máximo posible en la dirección elegida (pared o 1200px).
    fireSkill3ArqueroArrow(cfg, dirX, dirY) {
        this.skill3CooldownUntil = Date.now() + cfg.cooldownMs;
        const player = this.player;
        const dest = this.computeWalkableDestination(player.x, player.y, dirX, dirY, cfg.maxTravelDist, 5);
        const actualDist = Math.hypot(dest.x - player.x, dest.y - player.y);
        const travelDurationMs = Math.max(1, (actualDist / cfg.travelSpeedPxPerSec) * 1000);

        const weapon = player.getCurrentWeapon();
        this.arrow3 = {
            profId: 'arquero', cfg,
            startX: player.x, startY: player.y,
            endX: dest.x, endY: dest.y,
            x: player.x, y: player.y,
            dirX, dirY,
            startAt: Date.now(), travelDurationMs,
            tierMult: weapon.tier ? weapon.tier.mult : 1,
            rarityMult: weapon.rarity ? weapon.rarity.mult : 1,
        };
    },

    // Daño de un golpe de la Flecha Certera: mismo patrón que
    // computeVortexDamage (arma al lanzar + bonos de daño evaluados en el
    // momento del golpe).
    computeArrow3Damage(arrow, baseDamage) {
        let dmg = baseDamage * arrow.tierMult * arrow.rarityMult;
        dmg *= (1 + this.getSkill1DamageBuffPercent(arrow.profId));
        dmg *= (1 + this.getSkill3DamageBuffPercent(arrow.profId));
        dmg *= (1 + this.getPlayerZoneDamageBonusPercent());
        dmg *= (1 + this.player.getArmorDamageBonusPercent());
        return dmg;
    },

    // Arquero: +10% de daño temporal tras matar con la Flecha Certera — 0 si no aplica.
    getSkill3DamageBuffPercent(profId) {
        if (profId === 'arquero' && Date.now() < this.skill3.arrowKillDmgBuffUntil) {
            return RT_SKILL3_ABILITIES.arquero.killDmgBuffPercent;
        }
        return 0;
    },
    // Guerrero: +2%/kill de daño PERMANENTE con el Golpe de Ejecución (máx
    // 10 stacks/20%, ver skill3.guerreroExecuteDmgStacks) — reemplazó la
    // curación que tenía cuando era una habilidad del Pícaro.
    getSkill3GuerreroDmgBonusPercent(profId) {
        if (profId !== 'guerrero') return 0;
        const cfg = RT_SKILL3_ABILITIES.guerrero;
        return Math.min(cfg.dmgStackMaxStacks * cfg.dmgStackPerKillPercent, this.skill3.guerreroExecuteDmgStacks * cfg.dmgStackPerKillPercent);
    },
    // Pícaro: +2%/kill de crítico PERMANENTE con la explosión del clon de
    // Doble Sombra (máx 10 stacks/20%, ver skill3.picaroExplosionCritStacks).
    getPicaroExplosionCritBonusPercent(profId) {
        if (profId !== 'picaro') return 0;
        const cfg = RT_SKILL3_ABILITIES.picaro;
        return Math.min(cfg.explosionCritMaxStacks * cfg.explosionCritPerKillPercent, this.skill3.picaroExplosionCritStacks * cfg.explosionCritPerKillPercent);
    },

    // Guerrero — Golpe de Ejecución: ver RT_SKILL3_ABILITIES.guerrero. Dash
    // corto de duración FIJA (100ms, no viaja "a velocidad constante" como
    // el vórtice/flecha) — mismo estilo que la Estocada Fantasma del
    // Pícaro de tecla "1" (de donde se transplantó esta habilidad). No se
    // acorta por la distancia al mouse (mismo criterio que el resto de
    // dashes de este tipo).
    fireSkill3GuerreroExecute(cfg, dirX, dirY) {
        this.skill3CooldownUntil = Date.now() + cfg.cooldownMs;
        const player = this.player;
        const dest = this.computeWalkableDestination(player.x, player.y, dirX, dirY, cfg.dashRange, player.radius);
        const weapon = player.getCurrentWeapon();
        this.dash3 = {
            profId: 'guerrero', cfg,
            startX: player.x, startY: player.y,
            endX: dest.x, endY: dest.y,
            x: player.x, y: player.y,
            dirX, dirY,
            startAt: Date.now(), travelDurationMs: cfg.dashDurationMs,
            tierMult: weapon.tier ? weapon.tier.mult : 1,
            rarityMult: weapon.rarity ? weapon.rarity.mult : 1,
        };
    },

    // Daño de un golpe del Golpe de Ejecución (tiers 50/60/70, NO se llama
    // para la ejecución — esa mata directo, ver updateRealtime): mismo
    // patrón que computeArrow3Damage/computeVortexDamage.
    computeDash3Damage(dash, baseDamage) {
        let dmg = baseDamage * dash.tierMult * dash.rarityMult;
        dmg *= (1 + this.getSkill1DamageBuffPercent(dash.profId));
        dmg *= (1 + this.getSkill3DamageBuffPercent(dash.profId));
        dmg *= (1 + this.getSkill3GuerreroDmgBonusPercent(dash.profId));
        dmg *= (1 + this.getPlayerZoneDamageBonusPercent());
        dmg *= (1 + this.player.getArmorDamageBonusPercent());
        return dmg;
    },

    // Pícaro — Doble Sombra: ver RT_SKILL3_ABILITIES.picaro. El dash en sí
    // NO hace daño (sweep desactivado) y SÍ se acorta por la distancia al
    // mouse (aimDist, como el Salto Sísmico/Parpadeo Arcano) — el jugador
    // elige dónde caer dentro del rango. Deja el clon en la posición de
    // ORIGEN (antes de moverse) con la vida actual del jugador, y una
    // "foto" de si la Dagas Orbitales estaba activa (ver
    // tickPicaroCloneToggleSkill) — la invisibilidad arranca YA, no al
    // terminar el dash.
    fireSkill3PicaroCloneDash(cfg, dirX, dirY, aimDist) {
        this.skill3CooldownUntil = Date.now() + cfg.cooldownMs;
        const player = this.player;
        const travelDist = Math.min(cfg.dashRange, aimDist);
        const dest = this.computeWalkableDestination(player.x, player.y, dirX, dirY, travelDist, player.radius);

        this.picaroClone = {
            x: player.x, y: player.y, radius: player.radius,
            hp: player.hp, maxHp: player.hp,
            skill2Active: this.skill2.active && this.skill2.profId === 'picaro',
            lastTickAt: Date.now(),
        };

        this.startLeap('picaro_clone_dash', dest.x, dest.y, cfg.dashDurationMs, {});
        player.invisibleUntil = Date.now() + cfg.invisibleDurationMs;
    },

    // Pulso automático del clon (mismas fórmulas que Combat.tickToggleSkill,
    // pero centrado en el clon en vez del jugador) — solo corre mientras
    // `clone.skill2Active` (fotografiado al crear el clon, ver
    // fireSkill3PicaroCloneDash) siga siendo true.
    tickPicaroCloneToggleSkill(clone) {
        const player = this.player;
        const cfg = RT_TOGGLE_SKILLS.picaro;
        const effRadius = this.getSkill2EffectiveRadius('picaro');
        const targets = this.getEnemiesInCircle(clone.x, clone.y, effRadius);
        if (!targets.length) return;

        const eff = player.getActiveEnchantEffects();
        const weapon = player.getCurrentWeapon();
        const tierMult = weapon.tier ? weapon.tier.mult : 1;
        const rarityMult = weapon.rarity ? weapon.rarity.mult : 1;
        const baseDamage = cfg.dmgBase * tierMult * rarityMult;
        const potenciaMult = 1 + player.stats.potencia * STAT_POTENCIA_DMG_PERCENT;
        let dmg = baseDamage * potenciaMult * (1 + eff.dmgBonusPercent);
        dmg *= (1 + this.getSkill2DamageBonusPercent('picaro'));
        dmg *= (1 + this.getSkill1DamageBuffPercent('picaro'));
        dmg *= (1 + this.getSkill3DamageBuffPercent('picaro'));
        dmg *= (1 + this.getPlayerZoneDamageBonusPercent());
        dmg *= (1 + this.player.getArmorDamageBonusPercent());

        const critBase = getWeaponCritBase('picaro') + player.stats.suerte * STAT_SUERTE_CRIT_CHANCE
            + this.getSkill2CritChanceBonusPercent('picaro') + this.getPicaroDashCritBonusPercent('picaro') + this.getPicaroExplosionCritBonusPercent('picaro');
        const flatPenetration = player.stats.destreza * STAT_DESTREZA_ARMOR_PEN;
        const effectiveAtk = {
            damage: dmg,
            critChance: critBase + eff.critChanceBonus,
            critMultiplier: Math.max(1.5, eff.critMultiplier),
            penetratePercent: Math.min(0.95, eff.ignoreDefensePercent),
            flatPenetration,
        };
        this.resolveAttackDamage(effectiveAtk, targets, eff);

        this.effects.push({ kind: 'circle', x: clone.x, y: clone.y, followPlayer: false, range: effRadius, startRange: effRadius * 0.85, color: cfg.color, createdAt: Date.now(), duration: 200 });
    },

    // Explota el clon del Pícaro (por perder toda su vida, o por ser
    // atravesado por la Estocada Fantasma — ver updateRealtime en ambos
    // casos): círculos expansivos + daño a todo enemigo en el radio. Cada
    // enemigo que muere suma stacks de crítico permanente y reduce el
    // cooldown (ver RT_SKILL3_ABILITIES.picaro/getPicaroExplosionCritBonusPercent).
    explodePicaroClone(clone) {
        const cfg = RT_SKILL3_ABILITIES.picaro;
        const player = this.player;
        const weapon = player.getCurrentWeapon();
        const tierMult = weapon.tier ? weapon.tier.mult : 1;
        const rarityMult = weapon.rarity ? weapon.rarity.mult : 1;
        const dmg = cfg.cloneExplosionDamage * tierMult * rarityMult
            * (1 + this.getSkill1DamageBuffPercent('picaro'))
            * (1 + this.getSkill3DamageBuffPercent('picaro'))
            * (1 + this.getPlayerZoneDamageBonusPercent());

        const targets = this.getEnemiesInCircle(clone.x, clone.y, cfg.cloneExplosionRadius);
        let kills = 0;
        targets.forEach(en => {
            const dealt = en.takeDamage(dmg, {});
            this.spawnImpactFlash(en.x, en.y, cfg.color);
            this.floatDamage(en, dealt, false);
            if (!en.alive) {
                if (!en._deathHandled) { en._deathHandled = true; this.onEnemyDefeated(en); }
                kills++;
            }
        });
        if (kills > 0) {
            this.skill3.picaroExplosionCritStacks = Math.min(cfg.explosionCritMaxStacks, this.skill3.picaroExplosionCritStacks + kills);
            const reduceKills = Math.min(kills, cfg.cdReductionMaxKills);
            this.skill3CooldownUntil = Math.max(Date.now(), this.skill3CooldownUntil - reduceKills * cfg.cdReductionPerKillMs);
        }
        const now = Date.now();
        [0, 70, 140].forEach(delay => {
            this.effects.push({ kind: 'circle', x: clone.x, y: clone.y, followPlayer: false, range: cfg.cloneExplosionRadius, startRange: 0, color: cfg.color, createdAt: now + delay, duration: 400 });
        });
        if (this.picaroClone === clone) this.picaroClone = null;
    },

    // Vista previa mientras se mantiene "3" (ver startAimSkill3): línea
    // guía hacia donde se lanzaría el hechizo — llamado desde game.js/
    // render() con la posición de mouse más reciente, mismo patrón que
    // renderSkill1Aim. Por ahora solo dibuja la línea (largo = distancia
    // REAL que recorrería, ya clampeada al rango máximo de la clase).
    renderSkill3Aim(ctx, aimWorldPos) {
        if (!this.skill3.aiming || !this.player) return;
        const profId = this.player.activeProfession;
        const cfg = RT_SKILL3_ABILITIES[profId];
        if (!cfg) return;
        const player = this.player;

        let dirX = 0, dirY = -1, aimDist = Infinity;
        if (aimWorldPos) {
            dirX = aimWorldPos.x - player.x; dirY = aimWorldPos.y - player.y;
            aimDist = Math.hypot(dirX, dirY);
            const len = aimDist || 1;
            dirX /= len; dirY /= len;
        }

        // Tanque: sin dirección — círculo de vista previa centrado en el
        // jugador (mismo dibujo que Bastión, tecla "1"), no una línea.
        if (profId === 'tanque') {
            ctx.beginPath();
            ctx.arc(player.x, player.y, cfg.radius, 0, Math.PI * 2);
            ctx.strokeStyle = cfg.color;
            ctx.globalAlpha = 0.6;
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.globalAlpha = 0.12;
            ctx.fillStyle = cfg.color;
            ctx.fill();
            ctx.globalAlpha = 1;
            return;
        }
        // Bárbaro: sin dirección tampoco — círculo de vista previa mostrando
        // el radio de barrido de las espadas (player.radius + bladeLength).
        if (profId === 'barbaro') {
            const r = player.radius + cfg.bladeLength;
            ctx.beginPath();
            ctx.arc(player.x, player.y, r, 0, Math.PI * 2);
            ctx.strokeStyle = cfg.color;
            ctx.globalAlpha = 0.6;
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.globalAlpha = 0.12;
            ctx.fillStyle = cfg.color;
            ctx.fill();
            ctx.globalAlpha = 1;
            return;
        }

        const maxRange = cfg.maxTravelDist || cfg.dashRange || 0;
        // Arquero/Guerrero: ninguno de los dos dashes/proyectiles se acorta
        // por la distancia al mouse (ver fireSkill3ArqueroArrow/
        // fireSkill3GuerreroExecute) — la vista previa muestra siempre el
        // alcance máximo real (pared o maxRange), no aimDist. Pícaro (Doble
        // Sombra) SÍ se acorta (ver fireSkill3PicaroCloneDash), cae en la
        // rama `else` como el resto de los hechizos con aimDist.
        let lineDist;
        if (profId === 'arquero' || profId === 'guerrero') {
            const dest = this.computeWalkableDestination(player.x, player.y, dirX, dirY, maxRange, 5);
            lineDist = Math.hypot(dest.x - player.x, dest.y - player.y);
        } else {
            lineDist = Math.min(maxRange, aimDist);
        }
        ctx.beginPath();
        ctx.moveTo(player.x, player.y);
        ctx.lineTo(player.x + dirX * lineDist, player.y + dirY * lineDist);
        ctx.strokeStyle = cfg.color;
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 6]);
        ctx.globalAlpha = 0.85;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
    },

    // Dibuja el Vórtice Arcano (llamado desde game.js/render(), dentro del
    // translate de cámara): círculo externo relleno + borde + runas
    // rotando en el borde (mismo glyph que los objetos orbitales del
    // Ataque 2 del Mago, ver renderSkill2), más 1-2 anillos internos solo
    // de borde según el radio actual (ver spec del pedido). Todos los
    // anillos rotan, cada uno a su propia velocidad/dirección.
    renderVortex(ctx) {
        const v = this.vortex;
        if (!v) return;
        const cfg = v.cfg;
        const elapsed = Date.now() - v.rotationStartAt;

        const drawRing = (radius, filled, runes, revolutionMs, dirSign) => {
            if (radius <= 0) return;
            const angle = dirSign * ((elapsed % revolutionMs) / revolutionMs) * Math.PI * 2;
            ctx.beginPath();
            ctx.arc(v.x, v.y, radius, 0, Math.PI * 2);
            if (filled) {
                ctx.globalAlpha = 0.18;
                ctx.fillStyle = cfg.color;
                ctx.fill();
            }
            ctx.globalAlpha = 0.9;
            ctx.strokeStyle = cfg.color;
            ctx.lineWidth = 2.5;
            ctx.stroke();
            ctx.globalAlpha = 1;

            if (runes) {
                const runeCount = 8;
                for (let i = 0; i < runeCount; i++) {
                    const a = angle + (i / runeCount) * Math.PI * 2;
                    const ox = v.x + Math.cos(a) * radius;
                    const oy = v.y + Math.sin(a) * radius;
                    ctx.save();
                    ctx.translate(ox, oy);
                    ctx.rotate(a);
                    ctx.globalAlpha = 0.9;
                    ctx.fillStyle = cfg.color;
                    ctx.shadowColor = cfg.color;
                    ctx.shadowBlur = 6;
                    ctx.beginPath();
                    ctx.moveTo(-3, -8);
                    ctx.lineTo(3, -8);
                    ctx.lineTo(1.5, 8);
                    ctx.lineTo(-1.5, 8);
                    ctx.closePath();
                    ctx.fill();
                    ctx.restore();
                }
                ctx.shadowBlur = 0;
            }
        };

        const R = v.currentRadius;
        if (R >= 130) {
            drawRing(R, true, true, 3000, 1);          // externo: runas, rápido
            drawRing(R * 0.7, false, false, 6000, -1); // medio 70%: el más lento, dirección opuesta
            drawRing(R * 0.5, false, false, 1500, 1);  // interno 50%: rápido, misma dirección que el externo
        } else if (R >= 70) {
            drawRing(R, true, true, 3000, 1);
            drawRing(R * 0.6, false, false, 1500, -1); // interno 60%: rápido, dirección opuesta
        } else {
            drawRing(R, true, true, 3000, 1);
        }
    },

    // Dibuja la Flecha Certera del Arquero en vuelo (llamado desde
    // game.js/render(), dentro del translate de cámara): trazo + punta
    // triangular apuntando en la dirección de vuelo — dibujada en canvas
    // (no CSS/DOM) para quedar consistente con el resto del pipeline
    // visual del juego (mismo criterio que el resto de efectos, ver
    // encabezado de este archivo).
    renderArquero3Arrow(ctx) {
        const a = this.arrow3;
        if (!a) return;
        const shaftLen = 26;
        const backX = a.x - a.dirX * shaftLen, backY = a.y - a.dirY * shaftLen;
        ctx.strokeStyle = a.cfg.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(backX, backY);
        ctx.lineTo(a.x, a.y);
        ctx.stroke();

        const headAngle = Math.atan2(a.dirY, a.dirX);
        const headSize = 10;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(a.x - Math.cos(headAngle - 0.4) * headSize, a.y - Math.sin(headAngle - 0.4) * headSize);
        ctx.lineTo(a.x - Math.cos(headAngle + 0.4) * headSize, a.y - Math.sin(headAngle + 0.4) * headSize);
        ctx.closePath();
        ctx.fillStyle = a.cfg.color;
        ctx.fill();
    },

    // Dibuja el clon de Doble Sombra (llamado desde game.js/render(),
    // dentro del translate de cámara): círculo semitransparente + emoji +
    // barra de vida propia (para distinguirlo del jugador real, ver
    // RT_SKILL3_ABILITIES.picaro).
    renderPicaroClone(ctx) {
        const clone = this.picaroClone;
        if (!clone) return;
        const cfg = RT_SKILL3_ABILITIES.picaro;

        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.arc(clone.x, clone.y, clone.radius, 0, Math.PI * 2);
        ctx.fillStyle = cfg.color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.stroke();
        ctx.font = `${Math.round(clone.radius * 1.3)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(cfg.emoji, clone.x, clone.y + 1);
        ctx.globalAlpha = 1;

        const w = clone.radius * 2.2, h = 5;
        const pct = Math.max(0, clone.hp / clone.maxHp);
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(clone.x - w / 2, clone.y - clone.radius - 14, w, h);
        ctx.fillStyle = '#a0e0ff';
        ctx.fillRect(clone.x - w / 2, clone.y - clone.radius - 14, w * pct, h);
    },

    // Círculo del Gigante del Tanque: anillo PERSISTENTE mientras esté
    // activo (a diferencia del resto de efectos, que son transitorios vía
    // `effects`) — sigue al jugador cada frame, ver RT_SKILL3_ABILITIES.tanque.
    renderTanqueCircle(ctx) {
        if (!this.skill3.tanqueActive || !this.player) return;
        const cfg = RT_SKILL3_ABILITIES.tanque;
        ctx.beginPath();
        ctx.arc(this.player.x, this.player.y, cfg.radius, 0, Math.PI * 2);
        ctx.globalAlpha = 0.08;
        ctx.fillStyle = cfg.color;
        ctx.fill();
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = cfg.color;
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 6]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
    },

    // Torbellino de Espadas del Bárbaro: 2 hojas dibujadas como polígono
    // (ancho en el mango, angosto en la punta) rotadas alrededor del
    // jugador — mango en el radio del jugador (cerca de él), punta a
    // bladeLength px hacia afuera, exactamente igual que la geometría de
    // colisión de applyBarbaroSpinHits.
    renderBarbaroSpin(ctx) {
        const spin = this.barbaroSpin;
        if (!spin || !this.player) return;
        const cfg = RT_SKILL3_ABILITIES.barbaro;
        const player = this.player;
        const t = Math.min(1, (Date.now() - spin.startAt) / spin.durationMs);
        const offset = t * Math.PI * 2;
        [0, Math.PI].forEach(baseAngle => {
            const angle = baseAngle + offset;
            ctx.save();
            ctx.translate(player.x, player.y);
            ctx.rotate(angle);
            ctx.translate(player.radius, 0);
            ctx.fillStyle = cfg.color;
            ctx.shadowColor = cfg.color;
            ctx.shadowBlur = 6;
            ctx.beginPath();
            ctx.moveTo(0, -5);
            ctx.lineTo(0, 5);
            ctx.lineTo(cfg.bladeLength * 0.85, 2);
            ctx.lineTo(cfg.bladeLength, 0);
            ctx.lineTo(cfg.bladeLength * 0.85, -2);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        });
        ctx.shadowBlur = 0;
    },

    // Telegrafiado de las habilidades de jefe (ver BOSS_ABILITIES), 2 fases:
    // - 'charging': círculo que empieza en radio(enemigo)+telegraphExtraRadius
    //   y se achica hasta tocar al enemigo (radio(enemigo)) durante chargeMs
    //   — "un círculo externo que se hace pequeño... hasta rodear y tocar
    //   el enemigo", pedido explícito del usuario.
    // - 'earthquake' (Terremoto): en vez de anillos estáticos, un único
    //   círculo de "carga" que CRECE continuamente desde el borde interior
    //   hasta el borde exterior de la banda que está resolviendo en ese
    //   momento — al llegar al borde, esa banda se activa (ver
    //   tickBossCast) y el círculo arranca de nuevo para la banda
    //   siguiente. Corrección del usuario: un solo color (cfg.color,
    //   carmesí oscuro) para las 4, más un destello breve justo al
    //   activarse cada una.
    // Habilidades #2 de jefe (ver BOSS_ABILITIES_2): Impenetrable dibuja
    // 2 círculos punteados (para que la rotación se note — un círculo
    // sólido y perfectamente simétrico no se vería girar) — uno a 195px
    // SOLO visual girando horario, otro a 200px (el límite real) girando
    // antihorario, pedido explícito. Frenesí Sangriento dibuja un aura
    // simple (no se pidió un visual específico).
    renderBossAbility2Effects(ctx) {
        const now = Date.now();
        this.enemies.forEach(en => {
            if (!en.alive) return;
            if (en.bossShield && now < en.bossShield.expiresAt) {
                const cfg = BOSS_ABILITIES_2.impenetrable;
                const elapsed = now - en.bossShield.startAt;
                const rotSpeed = Math.PI; // una vuelta completa cada 2s
                [
                    { r: cfg.visualInnerRadius, angle: (elapsed / 1000) * rotSpeed },   // 195px, horario, solo visual
                    { r: cfg.radius, angle: -(elapsed / 1000) * rotSpeed },              // 200px, antihorario, límite real
                ].forEach(({ r, angle }) => {
                    ctx.save();
                    ctx.translate(en.x, en.y);
                    ctx.rotate(angle);
                    ctx.strokeStyle = cfg.color;
                    ctx.lineWidth = 3;
                    ctx.globalAlpha = 0.75;
                    ctx.setLineDash([20, 15]);
                    ctx.beginPath();
                    ctx.arc(0, 0, r, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    ctx.globalAlpha = 1;
                    ctx.restore();
                });
            }
            if (en.frenzy && now < en.frenzy.expiresAt) {
                const cfg = BOSS_ABILITIES_2.frenesi;
                ctx.beginPath();
                ctx.arc(en.x, en.y, en.radius + 6, 0, Math.PI * 2);
                ctx.strokeStyle = cfg.color;
                ctx.lineWidth = 3;
                ctx.globalAlpha = 0.8;
                ctx.stroke();
                ctx.globalAlpha = 1;
            }
        });
    },

    renderBossCastTelegraphs(ctx) {
        const now = Date.now();
        this.enemies.forEach(en => {
            if (!en.alive || !en.bossCast) return;
            const cast = en.bossCast;
            if (cast.abilityId === 'caos_dimensional') {
                this.renderCaosDimensional(ctx, en, cast, now);
                return;
            }
            const cfg = BOSS_ABILITIES[cast.abilityId];
            if (cast.abilityId === 'rayo') {
                this.renderRayoArcano(ctx, en, cast, cfg, now);
            } else if (cast.phase === 'charging') {
                const t = Math.min(1, (now - cast.startAt) / cfg.chargeMs);
                const r = en.radius + cfg.telegraphExtraRadius * (1 - t);
                ctx.beginPath();
                ctx.arc(en.x, en.y, r, 0, Math.PI * 2);
                ctx.strokeStyle = cfg.color;
                ctx.lineWidth = 3;
                ctx.globalAlpha = 0.85;
                ctx.stroke();
                ctx.globalAlpha = 1;
            } else if (cast.phase === 'earthquake') {
                this.renderEarthquakeGrowth(ctx, cast, cfg, now);
            }
        });
    },

    // Caos Dimensional: dibuja las 2 sub-secuencias en paralelo — el Rayo
    // Arcano reutiliza EXACTAMENTE renderRayoArcano (el sub-estado
    // cast.rayo tiene la misma forma que un cast normal de 'rayo': phase/
    // startAt/dirX/dirY) y la Zona Arcana su propio render.
    renderCaosDimensional(ctx, en, cast, now) {
        const cfg = BOSS_ABILITIES_3.caos_dimensional;
        if (!cast.rayo.done) this.renderRayoArcano(ctx, en, cast.rayo, cfg.rayo, now);
        if (!cast.zona.done) this.renderCaosZona(ctx, cast.zona, cfg.zona, now);
    },

    // Zona Arcana: círculo que crece/está estático/titila/se retrae según
    // su fase (ver tickCaosZonaSub) — el titileo usa el mismo patrón que
    // el titileo del Rayo Arcano (alternar opacidad cada 50ms).
    renderCaosZona(ctx, sub, zcfg, now) {
        if (sub.phase === 'exploded') return;
        let alpha = 0.7;
        if (sub.phase === 'flicker') {
            alpha = Math.floor((now - sub.startAt) / 50) % 2 === 0 ? 0.85 : 0.2;
        }
        ctx.beginPath();
        ctx.arc(sub.x, sub.y, sub.radius, 0, Math.PI * 2);
        ctx.strokeStyle = zcfg.color;
        ctx.lineWidth = 3;
        ctx.globalAlpha = alpha;
        ctx.stroke();
        ctx.globalAlpha = 0.15 * alpha;
        ctx.fillStyle = zcfg.color;
        ctx.fill();
        ctx.globalAlpha = 1;
    },

    // Rayo Arcano: 2 líneas de `range` px que se van CERRANDO (30px -> 0)
    // durante la carga (1s) y luego reabriendo (0 -> 30px) durante el
    // disparo (0.5s), con un relleno semitransparente entre ellas durante
    // el disparo (creciendo junto con la separación). Tras dispararse, el
    // rayo se queda totalmente abierto TITILANDO (alternando opacidad)
    // durante lingerMs (0.2s) — pedido explícito del usuario. Nada
    // visible durante la pausa entre repeticiones.
    renderRayoArcano(ctx, en, cast, cfg, now) {
        if (cast.phase === 'gap') return;
        const elapsed = now - cast.startAt;
        const maxHalfSep = cfg.lineSeparation / 2;
        let halfSep, flickerAlpha = 1;
        if (cast.phase === 'charging') {
            const t = Math.min(1, elapsed / cfg.chargeMs);
            halfSep = maxHalfSep * (1 - t);
        } else if (cast.phase === 'firing') {
            const t = Math.min(1, elapsed / cfg.fireMs);
            halfSep = maxHalfSep * t;
        } else { // 'lingering'
            halfSep = maxHalfSep;
            flickerAlpha = Math.floor(elapsed / 50) % 2 === 0 ? 1 : 0.2;
        }
        ctx.save();
        ctx.translate(en.x, en.y);
        ctx.rotate(Math.atan2(cast.dirY, cast.dirX));
        if ((cast.phase === 'firing' || cast.phase === 'lingering') && halfSep > 0.5) {
            ctx.fillStyle = cfg.color;
            ctx.globalAlpha = 0.25 * flickerAlpha;
            ctx.fillRect(0, -halfSep, cfg.range, halfSep * 2);
        }
        ctx.strokeStyle = cfg.color;
        ctx.lineWidth = 3;
        ctx.globalAlpha = 0.9 * flickerAlpha;
        [halfSep, -halfSep].forEach(offset => {
            ctx.beginPath();
            ctx.moveTo(0, offset);
            ctx.lineTo(cfg.range, offset);
            ctx.stroke();
        });
        ctx.globalAlpha = 1;
        ctx.restore();
    },

    // Dibuja la banda actualmente "cargando" de un Terremoto (ver
    // renderBossCastTelegraphs) más el destello de la última banda activada.
    renderEarthquakeGrowth(ctx, cast, cfg, now) {
        const elapsed = now - cast.startAt;
        const delays = cfg.ringActivateDelaysMs, radii = cfg.ringRadii;
        let bandIndex = -1;
        for (let i = 0; i < delays.length; i++) {
            if (elapsed < delays[i]) { bandIndex = i; break; }
        }
        if (bandIndex !== -1) {
            const bandStart = bandIndex === 0 ? 0 : radii[bandIndex - 1];
            const bandEnd = radii[bandIndex];
            const prevDelay = bandIndex === 0 ? 0 : delays[bandIndex - 1];
            const progress = Math.min(1, (elapsed - prevDelay) / (delays[bandIndex] - prevDelay));
            const r = bandStart + (bandEnd - bandStart) * progress;
            ctx.beginPath();
            ctx.arc(cast.x, cast.y, r, 0, Math.PI * 2);
            ctx.strokeStyle = cfg.color;
            ctx.lineWidth = 4;
            ctx.globalAlpha = 0.9;
            ctx.stroke();
            ctx.globalAlpha = 0.15;
            ctx.fillStyle = cfg.color;
            ctx.fill();
            ctx.globalAlpha = 1;
        }
        if (cast.lastFlash && now - cast.lastFlash.firedAt < 300) {
            const i = cast.lastFlash.ringIndex;
            const innerR = i === 0 ? 0 : radii[i - 1];
            const outerR = radii[i];
            ctx.beginPath();
            ctx.arc(cast.x, cast.y, outerR, 0, Math.PI * 2);
            if (innerR > 0) ctx.arc(cast.x, cast.y, innerR, 0, Math.PI * 2, true);
            ctx.fillStyle = cfg.color;
            ctx.globalAlpha = 0.4 * (1 - (now - cast.lastFlash.firedAt) / 300);
            ctx.fill();
            ctx.globalAlpha = 1;
        }
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
        let waveMultipliers = null;
        if (slot === 2 || geometry.hitShape === 'circle') {
            targets = this.getEnemiesInCircle(player.x, player.y, geometry.range);
        } else if (geometry.hitShape === 'offsetCircle') {
            // Área desplazada frente al jugador (Lluvia de Flechas del
            // Arquero): golpea a todos dentro, no solo al más cercano.
            const offX = player.x + dirX * geometry.offsetRange;
            const offY = player.y + dirY * geometry.offsetRange;
            targets = this.getEnemiesInCircle(offX, offY, geometry.range);
        } else if (geometry.waveOffsets) {
            // Triple onda en abanico (-45°/0°/+45°, ver RT_WAVE_FAN_OFFSETS):
            // cada onda es un cono independiente; un enemigo alcanzado por
            // varias recibe daño multiplicado UNA sola vez (no repetido),
            // ver waveMultipliers más abajo y en resolveAttackDamage.
            const hitCounts = new Map();
            geometry.waveOffsets.forEach(offsetDeg => {
                const rad = offsetDeg * Math.PI / 180;
                const rDirX = dirX * Math.cos(rad) - dirY * Math.sin(rad);
                const rDirY = dirX * Math.sin(rad) + dirY * Math.cos(rad);
                this.getEnemiesInCone(player.x, player.y, rDirX, rDirY, geometry.range, geometry.angle).forEach(en => {
                    hitCounts.set(en, (hitCounts.get(en) || 0) + 1);
                });
            });
            targets = Array.from(hitCounts.keys());
            waveMultipliers = hitCounts;
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
        // Guerrero/Mago: +daño% por stack de su habilidad toggle activa
        // (ver RT_TOGGLE_SKILLS.dmgPctPerStack/dmgPctMax) — 0 si no aplica.
        dmg *= (1 + this.getSkill2DamageBonusPercent(profId));
        // Mago: +20% de daño temporal tras lanzar Parpadeo Arcano (ver
        // RT_SKILL1_ABILITIES.mago) — 0 si no aplica.
        dmg *= (1 + this.getSkill1DamageBuffPercent(profId));
        // Arquero: +10% de daño temporal tras matar con la Flecha Certera
        // (ver RT_SKILL3_ABILITIES.arquero) — 0 si no aplica.
        dmg *= (1 + this.getSkill3DamageBuffPercent(profId));
        dmg *= (1 + this.getSkill3GuerreroDmgBonusPercent(profId));
        // +25% mientras el jugador esté parado en la zona del Salto Sísmico
        // del Guerrero (ver RT_SKILL1_ABILITIES.guerrero) — 0 si no aplica.
        dmg *= (1 + this.getPlayerZoneDamageBonusPercent());
        dmg *= (1 + this.player.getArmorDamageBonusPercent());

        const critBase = getWeaponCritBase(profId) + player.stats.suerte * STAT_SUERTE_CRIT_CHANCE
            + this.getSkill2CritChanceBonusPercent(profId) + this.getPicaroDashCritBonusPercent(profId) + this.getPicaroExplosionCritBonusPercent(profId);
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

        // Bárbaro: +robo de vida% por stack de su habilidad toggle activa
        // (ver RT_TOGGLE_SKILLS.lifestealPctPerStack/lifestealPctMax) y +20%
        // fijo mientras Furia Sangrienta esté activa (ver
        // RT_SKILL1_ABILITIES.barbaro) — 0 si no aplica; se suma a lo que
        // gane la rama `barbaro` más abajo.
        let extraLifestealPercent = this.getSkill2LifestealBonusPercent(profId) + this.getSkill1LifestealBonusPercent(profId);
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

        const { totalDamage, hadCrit } = this.resolveAttackDamage(effectiveAtk, targets, eff, waveMultipliers);

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
    // adicionales, ver getActiveEnchantEffects en player.js). waveMultipliers:
    // Map opcional (enemy -> nº de ondas del abanico que lo alcanzaron, ver
    // 'waveOffsets' en resolvePlayerAttack) — el daño se multiplica UNA vez
    // por ese conteo, nunca se aplica el golpe repetido por onda.
    resolveAttackDamage(atk, targets, extraEffects, waveMultipliers) {
        const player = this.player;
        const hits = atk.hits || 1;
        let totalDamage = 0;
        let hadCrit = false;
        const extra = extraEffects || {};

        targets.forEach(target => {
            const waveMult = waveMultipliers ? (waveMultipliers.get(target) || 1) : 1;
            for (let h = 0; h < hits; h++) {
                if (!target.alive) break;

                let dmg = atk.damage * waveMult;
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
    // Ningún ataque emite partículas viajeras (limpieza visual acordada):
    // solo el trazo/proyectil principal de cada visual, más el destello de
    // impacto de cada golpe (spawnImpactFlash, ver resolveAttackDamage).
    spawnAttackEffect(slot, dirX, dirY, geometry) {
        const player = this.player;
        const now = Date.now();
        const visual = geometry.visual || (geometry.hitShape === 'circle' ? 'circle' : 'cone');
        const duration = geometry.duration || (visual === 'circle' ? 400 : 220);

        if (visual === 'circle') {
            this.effects.push({ kind: 'circle', followPlayer: true, range: geometry.range, startRange: geometry.startRange || 0, color: geometry.color, createdAt: now, duration });
        } else if (visual === 'wave') {
            // Onda(s) expansiva(s) direccional(es): arco(s) angosto(s) que
            // crecen desde `startRange` hasta `range` sobre toda la
            // duración, con alpha decreciente. `waveOffsets` (ej. [-45,0,45])
            // lanza varias en abanico simultáneo en vez de una sola — ver
            // RT_WAVE_FAN_OFFSETS y el cálculo de hitCounts en
            // resolvePlayerAttack para el daño multiplicado por solape.
            // `waveStaggerMs`: cada onda del abanico se dibuja
            // `index * waveStaggerMs` más tarde (createdAt futuro) en vez de
            // todas a la vez — renderEffects las ignora hasta que su
            // createdAt llega, creando el efecto de "3 golpes rápidos" en
            // vez de una onda ancha única.
            const offsets = geometry.waveOffsets || [0];
            const stagger = geometry.waveStaggerMs || 0;
            offsets.forEach((offsetDeg, i) => {
                const rad = offsetDeg * Math.PI / 180;
                const rDirX = dirX * Math.cos(rad) - dirY * Math.sin(rad);
                const rDirY = dirX * Math.sin(rad) + dirY * Math.cos(rad);
                this.effects.push({ kind: 'wave', followPlayer: true, dirX: rDirX, dirY: rDirY, range: geometry.range, startRange: geometry.startRange || 0, angle: geometry.angle, lineWidth: geometry.lineWidth || 3, color: geometry.color, createdAt: now + i * stagger, duration });
            });
        } else if (visual === 'slash') {
            // Corte/golpe direccional: arco trazado (no relleno), distinto
            // del "cono" translúcido original. Sin uso actual (las 4 clases
            // cuerpo a cuerpo usan 'wave'), se deja disponible por si se
            // reutiliza para otra clase.
            this.effects.push({ kind: 'slash', followPlayer: true, dirX, dirY, range: geometry.range, angle: geometry.angle, color: geometry.color, createdAt: now, duration });
        } else if (visual === 'arrow') {
            // Flecha recta (Arquero A1/A3); A3 usa `wide` para el trazo/
            // punta más gruesos (flecha "gigante").
            this.effects.push({ kind: 'arrow', followPlayer: true, dirX, dirY, range: geometry.range, wide: !!geometry.fragments, color: geometry.color, createdAt: now, duration });
        } else if (visual === 'arrowRain') {
            // Área desplazada frente al jugador (ver hitShape:'offsetCircle'
            // en resolvePlayerAttack): flechas cayendo desde arriba sobre
            // la zona, NO centrada en el jugador.
            const cx = player.x + dirX * geometry.offsetRange, cy = player.y + dirY * geometry.offsetRange;
            this.effects.push({ kind: 'arrowRain', x: cx, y: cy, range: geometry.range, color: geometry.color, createdAt: now, duration });
        } else if (visual === 'coneArrows') {
            // Arquero A1: mismo cono relleno que 'cone', más un abanico de
            // flechas cortas DENTRO del arco — lo distingue del cono liso
            // del Mago sin necesitar un render nuevo (reusa 'cone'+'arrow').
            this.effects.push({ kind: 'cone', followPlayer: true, dirX, dirY, range: geometry.range, angle: geometry.angle, color: geometry.color, createdAt: now, duration });
            const dirAngle = Math.atan2(dirY, dirX);
            const fanCount = 5;
            for (let i = 0; i < fanCount; i++) {
                const spread = (i / (fanCount - 1)) - 0.5; // -0.5..0.5
                const a = dirAngle + spread * (geometry.angle * Math.PI / 180) * 0.8;
                this.effects.push({ kind: 'arrow', followPlayer: true, dirX: Math.cos(a), dirY: Math.sin(a), range: geometry.range * 0.9, wide: false, color: geometry.color, createdAt: now, duration });
            }
        } else { // 'cone': relleno translúcido original (Mago y, desde este rediseño, las 4 clases cuerpo a cuerpo)
            this.effects.push({ kind: 'cone', followPlayer: true, dirX, dirY, range: geometry.range, angle: geometry.angle, color: geometry.color, createdAt: now, duration });
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
            if (now < e.createdAt) return; // onda escalonada (waveStaggerMs): aún no le toca aparecer
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
            } else if (e.kind === 'wave') {
                // Onda expansiva (Pícaro/Guerrero A1/A2): arco de ancho
                // angular FIJO cuyo radio crece de startRange a range —
                // a diferencia de 'slash', que barre el ángulo a radio ~fijo.
                const ox = e.followPlayer ? player.x : e.x, oy = e.followPlayer ? player.y : e.y;
                const halfAngle = (e.angle / 2) * Math.PI / 180;
                const dirAngle = Math.atan2(e.dirY, e.dirX);
                const startR = e.startRange || 0;
                const r = startR + (e.range - startR) * t;
                ctx.beginPath();
                ctx.arc(ox, oy, r, dirAngle - halfAngle, dirAngle + halfAngle);
                ctx.globalAlpha = alpha;
                ctx.strokeStyle = e.color;
                ctx.lineWidth = e.lineWidth || 3;
                ctx.lineCap = 'round';
                ctx.stroke();
                ctx.lineCap = 'butt';
                ctx.lineWidth = 1;
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
        // Golpe de Ejecución del Guerrero: invulnerable durante el dash
        // (0.1s fijos, ver RT_SKILL3_ABILITIES.guerrero/
        // fireSkill3GuerreroExecute) — el golpe no conecta con nada
        // mientras dure.
        if (this.dash3 && this.dash3.profId === 'guerrero') {
            return;
        }
        // Doble Sombra del Pícaro: con clon vivo Y la invisibilidad TODAVÍA
        // activa, el golpe va contra ÉL (ver performEnemyAttackOnClone);
        // sin clon pero todavía invisible, el jugador real no es
        // alcanzable — el golpe no conecta con nada. Mismo bug corregido
        // que en el aiTarget de arriba: un clon que sobrevive más de 3s ya
        // NO debe seguir absorbiendo golpes una vez pasa la invisibilidad.
        if (this.picaroClone && this.player.invisibleUntil && Date.now() < this.player.invisibleUntil) {
            this.performEnemyAttackOnClone(enemy);
            return;
        }
        if (this.player.invisibleUntil && Date.now() < this.player.invisibleUntil) {
            return;
        }

        this.spawnEnemyBolt(enemy);

        let baseDmg = enemy.type.dmg;
        if (enemy.attackMod && Date.now() < enemy.attackMod.expiresAt) {
            baseDmg = Math.max(1, baseDmg - enemy.attackMod.flat);
        }
        if (enemy.type.ability === 'damageMultiplier') baseDmg = Math.round(baseDmg * 1.6);
        // Bastión del Tanque (ver RT_SKILL1_ABILITIES.tanque): -30% de daño
        // mientras el enemigo esté parado dentro del círculo.
        baseDmg = Math.round(baseDmg * this.getEnemyZoneDamageMultiplier(enemy));
        // Frenesí Sangriento (habilidad #2 de jefe, ver BOSS_ABILITIES_2):
        // +dmgBonusPercent también cuando, a falta de otros enemigos
        // cerca, cae de vuelta a atacar al jugador (ver Combat.tickFrenzy).
        if (enemy.frenzy && Date.now() < enemy.frenzy.expiresAt) {
            baseDmg = Math.round(baseDmg * (1 + BOSS_ABILITIES_2.frenesi.dmgBonusPercent));
        }

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
            if (enemy.frenzy && Date.now() < enemy.frenzy.expiresAt && dmg > 0) {
                const healAmt = Math.round(dmg * BOSS_ABILITIES_2.frenesi.lifestealPercent);
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
            // Círculo del Gigante del Tanque: el enemigo recibe el 100% de
            // su daño BASE como reflejo — usa `baseDmg` (antes de
            // bloqueo/reducción), tal como pide el pedido ("el daño base
            // del ataque"), NO `incomingRaw` (que ya tiene el -50% del
            // bloqueo aplicado, a diferencia del reflejo de escudo de arriba).
            if (this.skill3.tanqueActive && player.activeProfession === 'tanque' && enemy.alive) {
                const tCfg = RT_SKILL3_ABILITIES.tanque;
                const reflectDmg = baseDmg * tCfg.reflectPercent;
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

    // Golpe de un enemigo contra el clon de Doble Sombra (ver
    // performEnemyAttackRT): el clon es un señuelo simple, sin bloqueo/
    // esquiva/escudo — recibe el golpe de lleno. Si su vida llega a 0, explota.
    performEnemyAttackOnClone(enemy) {
        const clone = this.picaroClone;
        if (!clone) return;
        let baseDmg = enemy.type.dmg;
        if (enemy.attackMod && Date.now() < enemy.attackMod.expiresAt) {
            baseDmg = Math.max(1, baseDmg - enemy.attackMod.flat);
        }
        if (enemy.type.ability === 'damageMultiplier') baseDmg = Math.round(baseDmg * 1.6);
        baseDmg = Math.round(baseDmg * this.getEnemyZoneDamageMultiplier(enemy));

        clone.hp = Math.max(0, clone.hp - baseDmg);
        if (this.spawnFloatingText) this.spawnFloatingText(clone.x, clone.y - clone.radius - 12, `-${baseDmg}`, '#ff5c5c');
        this.spawnImpactFlash(clone.x, clone.y, '#ff5c5c');

        if (clone.hp <= 0) this.explodePicaroClone(clone);
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

    // Aplica el drop de piezas de EQUIPO (armadura o arma, mismo mecanismo
    // para ambas, ver EQUIPMENT_PIECE_DROP_CONFIG) para todas las rarezas
    // <= `rarityIdx` (la del enemigo muerto). `idFn(rarityId)` genera el id
    // de material concreto a otorgar (ya resuelve al azar el subtipo/
    // profesión, ver getArmorPieceId/getWeaponPieceId) — se llama una vez
    // por CADA unidad individual que sale.
    rollEquipmentPieceDrops(rarityIdx, floor, grant, idFn) {
        const dropBonus = getPieceDropBonusPercent(floor);
        for (let ri = 0; ri <= rarityIdx; ri++) {
            const dropRarityId = MONSTER_RARITIES[ri].id;
            const dropCfg = EQUIPMENT_PIECE_DROP_CONFIG[dropRarityId];
            if (!dropCfg) continue;
            let pieceCount = 0;
            if (dropCfg.guaranteed) {
                pieceCount += dropCfg.guaranteed;
                for (let i = 0; i < dropCfg.extraRolls; i++) {
                    if (Math.random() < Math.min(1, dropCfg.chancePerRoll + dropBonus)) pieceCount++;
                }
            } else if (Math.random() < Math.min(1, dropCfg.chance + dropBonus)) {
                pieceCount = dropCfg.min + Math.floor(Math.random() * (dropCfg.max - dropCfg.min + 1));
            }
            for (let i = 0; i < pieceCount; i++) {
                grant(idFn(dropRarityId), 1);
            }
        }
    },

    // División Celular (ver BOSS_ABILITIES_2.division_celular): crea los 2
    // fragmentos que reemplazan a `target` (que "murió" pero en realidad
    // se divide, ver Enemy.takeDamage). tier1 (mitad, 50% de la vida
    // máxima ORIGINAL) retiene la habilidad #1 asignada Y división
    // celular (para poder volver a dividirse); tier2 (cuarto, 25%, YA no
    // se divide más) pierde la habilidad #1 pero gana +50% de velocidad
    // (ver Enemy.stepToward). Los 4 tier2 finales comparten un contador
    // (`divisionGroup`) creado acá, en el PRIMER split — se propaga por
    // referencia a través de ambas generaciones para que
    // Combat.onEnemyDefeated sepa cuándo otorgar el loot real.
    spawnDivisionClones(target) {
        const cfg = BOSS_ABILITIES_2.division_celular;
        const newTier = target.divisionTier + 1;
        const isTier2 = newTier >= 2;
        const hpPercent = isTier2 ? cfg.tier2HpPercent : cfg.tier1HpPercent;
        const newMaxHp = Math.max(1, Math.round(target.originalMaxHp * hpPercent));
        const radiusScale = isTier2 ? 0.6 : 0.8;
        const group = target.divisionGroup || { remaining: 4 };

        for (let i = 0; i < 2; i++) {
            const angle = Math.random() * Math.PI * 2;
            const offset = 30 + Math.random() * 20;
            const newRadius = Math.max(6, Math.round(target.type.radius * radiusScale));
            let px = target.x + Math.cos(angle) * offset, py = target.y + Math.sin(angle) * offset;
            if (this.dungeon && !this.dungeon.isWalkable(px, py, newRadius)) { px = target.x; py = target.y; }

            const cloneType = {
                ...target.type,
                hp: newMaxHp,
                radius: newRadius,
                bossAbilityIds: isTier2 ? [] : target.type.bossAbilityIds,
                bossAbility2Id: isTier2 ? null : target.type.bossAbility2Id,
                name: `${target.type.name} (fragmento)`,
            };
            const clone = new Enemy(cloneType, px, py);
            clone.originalMaxHp = target.originalMaxHp;
            clone.divisionTier = newTier;
            // El grupo se crea UNA vez (en el split tier0->tier1) y se
            // propaga sin cambios a través de tier1 hasta llegar a los 4
            // tier2 finales — si solo se lo diera a los tier2, cada
            // tier1 crearía su PROPIO grupo de 4 en vez de compartir el
            // mismo entre las dos ramas (bug real, encontrado al revisar
            // esta misma función antes de probarla).
            clone.divisionGroup = group;
            clone.linkedChest = target.linkedChest;
            this.enemies.push(clone);
        }
    },

    onEnemyDefeated(target) {
        // División Celular (habilidad #2 de jefe, ver BOSS_ABILITIES_2):
        // el jefe (tier0) o sus mitades (tier1) NO mueren de verdad —
        // Enemy.takeDamage ya marcó pendingDivision en vez de matarlo del
        // todo. Reemplaza por completo el resto de esta función (nada de
        // loot/XP todavía).
        if (target.pendingDivision) {
            this.spawnDivisionClones(target);
            return;
        }
        // Los 4 fragmentos tier2 finales comparten un contador (ver
        // spawnDivisionClones): recién cuando muere el ÚLTIMO se cae al
        // flujo normal de abajo y se otorga el loot/XP completo, UNA sola
        // vez, como si fuera 1 sola muerte del jefe original.
        if (target.divisionGroup) {
            target.divisionGroup.remaining--;
            if (target.divisionGroup.remaining > 0) return;
        }

        const player = this.player;
        const rarity = target.type.rarity || MONSTER_RARITIES[0];
        const bossKind = target.type.bossKind;
        const isFinalBoss = bossKind === 'jefe_final';
        // El Jefe Final no suelta nada directo salvo la XP: todo lo demás
        // (oro, materiales, núcleos, pergaminos) se acumula en su cofre
        // vinculado (ver spawnFinalBossChest/handleEnemyKilled en game.js) y
        // se entrega recién cuando el jugador lo abre, sin importar la
        // distancia a la que haya muerto el jefe.
        const chestLoot = (isFinalBoss && target.linkedChest) ? {} : null;

        // Carga universal de Ataque 3 (Espacio, ver RT_CHARGE_MAX): +1 carga
        // por CADA enemigo muerto, sin importar qué lo mató — antes cargaba
        // por golpe conectado (targets.length de Ataque1/2), a pedido del
        // usuario ahora carga por muerte en vez de por golpe.
        this.charge = Math.min(RT_CHARGE_MAX, this.charge + 1);

        // Habilidad toggle (Ataque 2): +1 stack por CADA enemigo muerto
        // mientras está activa, sin importar qué lo mató (golpe, DoT, etc.).
        if (this.skill2.active) {
            this.skill2.stacks = Math.min(RT_TOGGLE_STACK_MAX, this.skill2.stacks + 1);
        }

        // Furia Sangrienta del Bárbaro (ver RT_SKILL1_ABILITIES.barbaro):
        // cada muerte mientras está activa cura 5% de vida máxima y extiende
        // la duración +1s, sin importar qué la mató.
        if (this.skill1.barbaroActive && player.activeProfession === 'barbaro') {
            const cfg = RT_SKILL1_ABILITIES.barbaro;
            player.heal(player.maxHp * cfg.killHealPercent);
            this.skill1.barbaroActiveUntil += cfg.durationPerKillMs;
        }

        // Círculo del Gigante del Tanque (ver RT_SKILL3_ABILITIES.tanque):
        // cada muerte mientras está activa cura 10% de vida máxima y suma 1
        // stack de "Gigante" (+10% vida máxima / +3% resistencias por
        // stack, máx 10), sin importar qué mató al enemigo (reflejo,
        // ataque normal, etc.).
        if (this.skill3.tanqueActive && player.activeProfession === 'tanque') {
            const cfg = RT_SKILL3_ABILITIES.tanque;
            player.heal(player.maxHp * cfg.killHealPercent);
            if (this.skill3.tanqueGiantStacks < cfg.giantMaxStacks) {
                this.skill3.tanqueGiantStacks++;
                player.recalcMaxHp();
                if (this.spawnFloatingText) {
                    this.spawnFloatingText(player.x, player.y - player.radius - 30, `🗿 Gigante x${this.skill3.tanqueGiantStacks}`, cfg.color, 1000);
                }
            }
        }

        // Tamaño de "grupo": enemigos vivos cerca del que acaba de morir,
        // en ESTE instante (ver RT_ENGAGE_GROUP_RADIUS) — no hay más un
        // "combate" con composición fija que recordar.
        const groupSize = 1 + this.enemies.filter(en => en !== target && en.alive
            && Math.hypot(en.x - target.x, en.y - target.y) <= RT_ENGAGE_GROUP_RADIUS).length;
        const groupMult = getGroupMultiplier(groupSize);
        const gm = qty => Math.max(1, Math.round(qty * groupMult));

        // La XP siempre se otorga directo, incluso al Jefe Final.
        const xpPenalty = (player.xpPenaltyUntil && Date.now() < player.xpPenaltyUntil) ? player.xpPenalty : 1;
        const xpGain = Math.round(getEnemyXPReward(player.floor, rarity.id, bossKind) * xpPenalty);
        player.gainXP(xpGain);
        if (this.spawnFloatingText) {
            this.spawnFloatingText(target.x, target.y - target.radius - 26, `+${xpGain} XP`, rarity.color, 1200);
        }

        const grant = (id, qty) => {
            if (chestLoot) chestLoot[id] = (chestLoot[id] || 0) + qty;
            else this.grantMaterial(id, qty);
        };

        const goldGain = getEnemyGoldReward(player.floor, rarity.id, bossKind, groupSize);
        if (chestLoot) {
            target.linkedChest.customGold = (target.linkedChest.customGold || 0) + goldGain;
        } else {
            player.gainGold(goldGain);
            if (this.spawnFloatingText) this.spawnFloatingText(target.x, target.y - target.radius - 44, `+${goldGain} 🪙`, '#ffd700', 1200);
        }

        const materialTierId = getMaterialTierForFloor(player.floor);
        const rarityIdx = MONSTER_RARITIES.findIndex(r => r.id === rarity.id);

        if (rarityIdx >= 1 && Math.random() < 0.08) {
            grant('pergamino_teletransporte', 1);
        }

        const alteracion = getAlteracionDropInfo(rarity.id, bossKind);
        if (alteracion.guaranteed || Math.random() < alteracion.chance) {
            const qty = alteracion.guaranteed ? (1 + Math.floor(Math.random() * 3)) : 1;
            grant(`pergamino_alteracion_tier${alteracion.tier}`, qty);
        }

        const { tierId: nucleoTierId, count: nucleoCount } = rollNucleoDrops(player.floor);
        grant(getNucleoId(rarity.id, nucleoTierId), gm(nucleoCount));

        // Piezas de equipo (armadura Y arma, ver rollEquipmentPieceDrops —
        // "todo el % de drop y funcionamiento es exactamente igual" para
        // ambas, pedido explícito): cada rareza <= la del enemigo muerto se
        // evalúa de forma INDEPENDIENTE — una pieza épica solo puede salir
        // de un enemigo épico o superior, y un enemigo mítico puede soltar
        // piezas de VARIAS rarezas a la vez en la misma muerte (lectura
        // literal del pedido: "solo pueden ser soltadas por enemigos con
        // esa rareza o superior", no "solo 1 rareza por muerte"). El nivel
        // de la pieza es el tier de material del piso (mismo bracket que
        // mena/núcleos); el subtipo/profesión se sortea al azar por CADA
        // unidad individual (no se especificó cómo elegirlo). Cantidades
        // SIN el multiplicador de grupo (gm) — se respetan los números
        // exactos pedidos por el usuario, sin otro escalado encima.
        const armorSubtypeIds = Object.keys(ARMOR_PIECE_VARIANTS);
        this.rollEquipmentPieceDrops(rarityIdx, player.floor, grant,
            dropRarityId => getArmorPieceId(armorSubtypeIds[Math.floor(Math.random() * armorSubtypeIds.length)], dropRarityId, materialTierId));

        const weaponProfIds = Object.keys(WEAPON_PIECE_TYPES);
        this.rollEquipmentPieceDrops(rarityIdx, player.floor, grant,
            dropRarityId => getWeaponPieceId(weaponProfIds[Math.floor(Math.random() * weaponProfIds.length)], dropRarityId, materialTierId));

        if (isFinalBoss) {
            const pisoEnRango = target.type.pisoEnRango || 10;
            const resourceQty = gm(Math.round(50 + ((pisoEnRango - 1) / 9) * 150));
            grant(`mat_tier_${materialTierId}`, resourceQty);
            grant(`madera_tier_${materialTierId}`, resourceQty);
            grant(getNucleoId('comun', materialTierId), gm(45));
            grant(getNucleoId('poco_comun', materialTierId), gm(30));
            grant(getNucleoId('raro', materialTierId), gm(15));
            grant(getNucleoId('mitico', materialTierId), gm(1));
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
                grant(getNucleoId(chosen, materialTierId), gm(1));
            }
            if (chestLoot) target.linkedChest.customLoot = chestLoot;
            if (this.spawnFloatingText) this.spawnFloatingText(target.x, target.y - target.radius - 60, '👑 ¡Su botín quedó en el cofre!', '#ffd700', 1600);
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
