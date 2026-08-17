// ===== SISTEMA DE ALIMENTOS (CAMPESINO) =====
// Cada tier tiene un recurso base (cultivo_tier_N, ver getGatherMaterialId en
// constants.js) y varios alimentos crafteables con ese recurso + un núcleo
// de monstruo (misma mecánica que las pociones: costo fijo de
// FOOD_CULTIVO_COST del recurso, sin importar el tier). La rareza del
// núcleo elegido determina la versión (Común..Mítico) del alimento, cada
// una con su propio efecto/duración (ver player.useFood).
//
// stat: 'vida' (+maxHP temporal) | 'defensa' | 'potencia' | 'destreza' |
//       'suerte' | 'pa' (Puntos de Acción) | 'regen_time' (regen
//       fuera de combate, real-time).
// duration = combates (para todos los stats de combate) o minutos (para
// regen_time). `regen` (opcional, solo en algunos alimentos de tier 5+) =
// HP restaurados al empezar cada turno propio en combate, mientras el buff
// esté activo (misma duración en combates que `duration`).

const FOOD_TIERS = [
    { id: 1, resourceName: 'Trigo', resourceEmoji: '🌾' },
    { id: 2, resourceName: 'Maíz', resourceEmoji: '🌽' },
    { id: 3, resourceName: 'Papa', resourceEmoji: '🥔' },
    { id: 4, resourceName: 'Ajo Ardiente', resourceEmoji: '🌶️' },
    { id: 5, resourceName: 'Champiñón Mágico', resourceEmoji: '✨' },
    { id: 6, resourceName: 'Néctar Divino', resourceEmoji: '🌟' },
    { id: 7, resourceName: 'Esencia Primordial', resourceEmoji: '💎' },
    { id: 8, resourceName: 'Fruto de las Sombras', resourceEmoji: '🍇' },
    { id: 9, resourceName: 'Semilla Celestial', resourceEmoji: '🌻' },
    { id: 10, resourceName: 'Núcleo de Energía Pura', resourceEmoji: '⚛️' },
];

FOOD_TIERS.forEach(t => {
    MATERIAL_INFO[`cultivo_tier_${t.id}`] = { name: t.resourceName, emoji: t.resourceEmoji };
});

const FOOD_CULTIVO_COST = 10;

const FOOD_STAT_LABELS = {
    vida: { icon: '❤️', name: 'Vida' },
    defensa: { icon: '🛡️', name: 'Defensa' },
    potencia: { icon: '💪', name: 'Potencia' },
    destreza: { icon: '🏃', name: 'Destreza' },
    suerte: { icon: '🍀', name: 'Suerte' },
    pa: { icon: '⚡', name: 'PA' },
};

const FOODS = {
    1: [
        { id: 'hogaza_semillas', name: 'Hogaza con Semillas', emoji: '🥖', stat: 'vida', versions: {
            comun: { amount: 10, duration: 3 }, poco_comun: { amount: 15, duration: 3 }, raro: { amount: 22, duration: 4 },
            epico: { amount: 35, duration: 5 }, legendario: { amount: 50, duration: 6 }, mitico: { amount: 75, duration: 8 },
        } },
        { id: 'croissant', name: 'Croissant', emoji: '🥐', stat: 'defensa', versions: {
            comun: { amount: 2, duration: 3 }, poco_comun: { amount: 3, duration: 3 }, raro: { amount: 5, duration: 4 },
            epico: { amount: 7, duration: 5 }, legendario: { amount: 10, duration: 6 }, mitico: { amount: 14, duration: 8 },
        } },
        { id: 'pan_integral', name: 'Pan Integral', emoji: '🍞', stat: 'regen_time', versions: {
            comun: { amount: 2, duration: 10 }, poco_comun: { amount: 3, duration: 12 }, raro: { amount: 4, duration: 15 },
            epico: { amount: 6, duration: 20 }, legendario: { amount: 8, duration: 25 }, mitico: { amount: 10, duration: 30 },
        } },
        { id: 'papilla_avena', name: 'Papilla de Avena', emoji: '🥛', stat: 'potencia', versions: {
            comun: { amount: 10, duration: 2 }, poco_comun: { amount: 15, duration: 2 }, raro: { amount: 22, duration: 3 },
            epico: { amount: 32, duration: 4 }, legendario: { amount: 45, duration: 5 }, mitico: { amount: 60, duration: 6 },
        } },
        { id: 'galleta_miel', name: 'Galleta de Miel', emoji: '🧁', stat: 'destreza', versions: {
            comun: { amount: 5, duration: 2 }, poco_comun: { amount: 8, duration: 2 }, raro: { amount: 12, duration: 3 },
            epico: { amount: 18, duration: 4 }, legendario: { amount: 25, duration: 5 }, mitico: { amount: 35, duration: 6 },
        } },
    ],
    2: [
        { id: 'polenta', name: 'Polenta', emoji: '🌽', stat: 'vida', versions: {
            comun: { amount: 20, duration: 4 }, poco_comun: { amount: 28, duration: 4 }, raro: { amount: 38, duration: 5 },
            epico: { amount: 55, duration: 6 }, legendario: { amount: 75, duration: 7 }, mitico: { amount: 110, duration: 9 },
        } },
        { id: 'huevos_revueltos', name: 'Huevos Revueltos', emoji: '🍳', stat: 'defensa', versions: {
            comun: { amount: 4, duration: 4 }, poco_comun: { amount: 6, duration: 4 }, raro: { amount: 8, duration: 5 },
            epico: { amount: 12, duration: 6 }, legendario: { amount: 16, duration: 7 }, mitico: { amount: 22, duration: 9 },
        } },
        { id: 'granola_fortificada', name: 'Granola Fortificada', emoji: '🥣', stat: 'regen_time', versions: {
            comun: { amount: 4, duration: 15 }, poco_comun: { amount: 5, duration: 18 }, raro: { amount: 7, duration: 22 },
            epico: { amount: 9, duration: 25 }, legendario: { amount: 12, duration: 30 }, mitico: { amount: 15, duration: 35 },
        } },
        { id: 'carne_asada', name: 'Carne Asada', emoji: '🍖', stat: 'potencia', versions: {
            comun: { amount: 20, duration: 3 }, poco_comun: { amount: 28, duration: 3 }, raro: { amount: 38, duration: 4 },
            epico: { amount: 52, duration: 5 }, legendario: { amount: 70, duration: 6 }, mitico: { amount: 95, duration: 7 },
        } },
        { id: 'tarta_cereal', name: 'Tarta de Cereal', emoji: '🧈', stat: 'destreza', versions: {
            comun: { amount: 15, duration: 3 }, poco_comun: { amount: 22, duration: 3 }, raro: { amount: 30, duration: 4 },
            epico: { amount: 42, duration: 5 }, legendario: { amount: 55, duration: 6 }, mitico: { amount: 75, duration: 7 },
        } },
    ],
    3: [
        { id: 'estofado', name: 'Estofado', emoji: '🥘', stat: 'vida', versions: {
            comun: { amount: 35, duration: 4 }, poco_comun: { amount: 45, duration: 4 }, raro: { amount: 55, duration: 5 },
            epico: { amount: 80, duration: 6 }, legendario: { amount: 100, duration: 7 }, mitico: { amount: 150, duration: 10 },
        } },
        { id: 'papas_doradas', name: 'Papas Doradas', emoji: '🍠', stat: 'defensa', versions: {
            comun: { amount: 6, duration: 5 }, poco_comun: { amount: 8, duration: 5 }, raro: { amount: 11, duration: 6 },
            epico: { amount: 15, duration: 7 }, legendario: { amount: 20, duration: 8 }, mitico: { amount: 28, duration: 10 },
        } },
        { id: 'ensalada_verduras', name: 'Ensalada de Verduras', emoji: '🥗', stat: 'regen_time', versions: {
            comun: { amount: 6, duration: 20 }, poco_comun: { amount: 8, duration: 23 }, raro: { amount: 10, duration: 27 },
            epico: { amount: 13, duration: 30 }, legendario: { amount: 16, duration: 35 }, mitico: { amount: 20, duration: 40 },
        } },
        { id: 'caldo_fortalecedor', name: 'Caldo Fortalecedor', emoji: '🍲', stat: 'potencia', versions: {
            comun: { amount: 30, duration: 4 }, poco_comun: { amount: 40, duration: 4 }, raro: { amount: 52, duration: 5 },
            epico: { amount: 72, duration: 6 }, legendario: { amount: 95, duration: 7 }, mitico: { amount: 130, duration: 9 },
        } },
        { id: 'sopa_cebolla', name: 'Sopa de Cebolla', emoji: '🧅', stat: 'destreza', versions: {
            comun: { amount: 25, duration: 4 }, poco_comun: { amount: 33, duration: 4 }, raro: { amount: 42, duration: 5 },
            epico: { amount: 58, duration: 6 }, legendario: { amount: 75, duration: 7 }, mitico: { amount: 105, duration: 9 },
        } },
    ],
    4: [
        { id: 'sopa_ardiente', name: 'Sopa Ardiente', emoji: '🔥', stat: 'vida', versions: {
            comun: { amount: 50, duration: 5 }, poco_comun: { amount: 65, duration: 5 }, raro: { amount: 82, duration: 6 },
            epico: { amount: 115, duration: 7 }, legendario: { amount: 150, duration: 8 }, mitico: { amount: 210, duration: 11 },
        } },
        { id: 'chiles_rellenos', name: 'Chiles Rellenos', emoji: '🌶️', stat: 'defensa', versions: {
            comun: { amount: 8, duration: 5 }, poco_comun: { amount: 11, duration: 5 }, raro: { amount: 14, duration: 6 },
            epico: { amount: 19, duration: 7 }, legendario: { amount: 25, duration: 8 }, mitico: { amount: 34, duration: 10 },
        } },
        { id: 'curry_fuego', name: 'Curry de Fuego', emoji: '🍛', stat: 'regen_time', versions: {
            comun: { amount: 8, duration: 25 }, poco_comun: { amount: 10, duration: 28 }, raro: { amount: 13, duration: 32 },
            epico: { amount: 16, duration: 35 }, legendario: { amount: 20, duration: 40 }, mitico: { amount: 25, duration: 45 },
        } },
        { id: 'carne_picante', name: 'Carne Picante', emoji: '🔥', stat: 'potencia', versions: {
            comun: { amount: 40, duration: 5 }, poco_comun: { amount: 52, duration: 5 }, raro: { amount: 66, duration: 6 },
            epico: { amount: 90, duration: 7 }, legendario: { amount: 120, duration: 8 }, mitico: { amount: 165, duration: 10 },
        } },
        { id: 'pimienta_negra', name: 'Pimienta Negra Tostada', emoji: '🌡️', stat: 'destreza', versions: {
            comun: { amount: 35, duration: 5 }, poco_comun: { amount: 46, duration: 5 }, raro: { amount: 58, duration: 6 },
            epico: { amount: 78, duration: 7 }, legendario: { amount: 100, duration: 8 }, mitico: { amount: 140, duration: 10 },
        } },
    ],
    5: [
        { id: 'risotto_magico', name: 'Risotto Mágico', emoji: '✨', stat: 'vida', versions: {
            comun: { amount: 75, duration: 6 }, poco_comun: { amount: 98, duration: 6 }, raro: { amount: 125, duration: 7 },
            epico: { amount: 175, duration: 8 }, legendario: { amount: 230, duration: 9 }, mitico: { amount: 320, duration: 12 },
        } },
        { id: 'champinones_estelares', name: 'Champiñones Estelares', emoji: '🍄', stat: 'defensa', versions: {
            comun: { amount: 10, duration: 6, regen: 3 }, poco_comun: { amount: 13, duration: 6, regen: 4 }, raro: { amount: 16, duration: 7, regen: 5 },
            epico: { amount: 22, duration: 8, regen: 6 }, legendario: { amount: 28, duration: 9, regen: 8 }, mitico: { amount: 38, duration: 11, regen: 10 },
        } },
        { id: 'postre_magico', name: 'Postre Mágico', emoji: '🧙', stat: 'regen_time', versions: {
            comun: { amount: 10, duration: 30 }, poco_comun: { amount: 13, duration: 34 }, raro: { amount: 16, duration: 38 },
            epico: { amount: 20, duration: 42 }, legendario: { amount: 25, duration: 45 }, mitico: { amount: 32, duration: 50 },
        } },
        { id: 'filete_celestial', name: 'Filete Celestial', emoji: '💫', stat: 'potencia', versions: {
            comun: { amount: 50, duration: 6 }, poco_comun: { amount: 65, duration: 6 }, raro: { amount: 82, duration: 7 },
            epico: { amount: 115, duration: 8 }, legendario: { amount: 150, duration: 9 }, mitico: { amount: 210, duration: 11 },
        } },
        { id: 'pastel_lunar', name: 'Pastel Lunar', emoji: '🌙', stat: 'destreza', versions: {
            comun: { amount: 45, duration: 6 }, poco_comun: { amount: 58, duration: 6 }, raro: { amount: 72, duration: 7 },
            epico: { amount: 98, duration: 8 }, legendario: { amount: 130, duration: 9 }, mitico: { amount: 180, duration: 11 },
        } },
        { id: 'bebida_sabiduria', name: 'Bebida de Sabiduría', emoji: '⭐', stat: 'suerte', versions: {
            comun: { amount: 30, duration: 5 }, poco_comun: { amount: 40, duration: 5 }, raro: { amount: 52, duration: 6 },
            epico: { amount: 72, duration: 7 }, legendario: { amount: 95, duration: 8 }, mitico: { amount: 130, duration: 10 },
        } },
    ],
    6: [
        { id: 'ambrosia_celestial', name: 'Ambrosia Celestial', emoji: '🌟', stat: 'vida', versions: {
            comun: { amount: 100, duration: 7 }, poco_comun: { amount: 130, duration: 7 }, raro: { amount: 165, duration: 8 },
            epico: { amount: 230, duration: 9 }, legendario: { amount: 300, duration: 10 }, mitico: { amount: 420, duration: 13 },
        } },
        { id: 'manjar_real', name: 'Manjar Real', emoji: '👑', stat: 'defensa', versions: {
            comun: { amount: 12, duration: 7, regen: 5 }, poco_comun: { amount: 16, duration: 7, regen: 6 }, raro: { amount: 20, duration: 8, regen: 8 },
            epico: { amount: 27, duration: 9, regen: 10 }, legendario: { amount: 35, duration: 10, regen: 12 }, mitico: { amount: 48, duration: 12, regen: 15 },
        } },
        { id: 'vino_divino', name: 'Vino Divino', emoji: '🍷', stat: 'regen_time', versions: {
            comun: { amount: 12, duration: 35 }, poco_comun: { amount: 15, duration: 39 }, raro: { amount: 19, duration: 43 },
            epico: { amount: 24, duration: 47 }, legendario: { amount: 30, duration: 50 }, mitico: { amount: 38, duration: 55 },
        } },
        { id: 'filete_dioses', name: 'Filete de Dioses', emoji: '💎', stat: 'potencia', versions: {
            comun: { amount: 60, duration: 7 }, poco_comun: { amount: 78, duration: 7 }, raro: { amount: 98, duration: 8 },
            epico: { amount: 135, duration: 9 }, legendario: { amount: 175, duration: 10 }, mitico: { amount: 245, duration: 12 },
        } },
        { id: 'torta_arcoiris', name: 'Torta del Arcoíris', emoji: '🌈', stat: 'destreza', versions: {
            comun: { amount: 55, duration: 7 }, poco_comun: { amount: 72, duration: 7 }, raro: { amount: 90, duration: 8 },
            epico: { amount: 122, duration: 9 }, legendario: { amount: 160, duration: 10 }, mitico: { amount: 225, duration: 12 },
        } },
        { id: 'elixir_ascension', name: 'Elixir de Ascensión', emoji: '✨', stat: 'suerte', versions: {
            comun: { amount: 40, duration: 6 }, poco_comun: { amount: 52, duration: 6 }, raro: { amount: 65, duration: 7 },
            epico: { amount: 88, duration: 8 }, legendario: { amount: 115, duration: 9 }, mitico: { amount: 160, duration: 11 },
        } },
        { id: 'sopa', name: 'Sopa', emoji: '🔱', stat: 'pa', versions: {
            comun: { amount: 3, duration: 4 }, poco_comun: { amount: 4, duration: 4 }, raro: { amount: 5, duration: 5 },
            epico: { amount: 6, duration: 6 }, legendario: { amount: 7, duration: 7 }, mitico: { amount: 9, duration: 9 },
        } },
    ],
    7: [
        { id: 'manjar_dioses_supremos', name: 'Manjar de Dioses Supremos', emoji: '💎', stat: 'vida', versions: {
            comun: { amount: 150, duration: 8 }, poco_comun: { amount: 195, duration: 8 }, raro: { amount: 245, duration: 9 },
            epico: { amount: 340, duration: 10 }, legendario: { amount: 440, duration: 11 }, mitico: { amount: 600, duration: 14 },
        } },
        { id: 'festin_eterno', name: 'Festín Eterno', emoji: '👑', stat: 'defensa', versions: {
            comun: { amount: 15, duration: 8, regen: 7 }, poco_comun: { amount: 20, duration: 8, regen: 9 }, raro: { amount: 25, duration: 9, regen: 11 },
            epico: { amount: 34, duration: 10, regen: 14 }, legendario: { amount: 44, duration: 11, regen: 18 }, mitico: { amount: 60, duration: 13, regen: 23 },
        } },
        { id: 'bebida_cosmos', name: 'Bebida del Cosmos', emoji: '🌌', stat: 'regen_time', versions: {
            comun: { amount: 15, duration: 40 }, poco_comun: { amount: 19, duration: 44 }, raro: { amount: 24, duration: 48 },
            epico: { amount: 30, duration: 52 }, legendario: { amount: 37, duration: 55 }, mitico: { amount: 48, duration: 60 },
        } },
        { id: 'carne_dragon_antiguo', name: 'Carne de Dragón Antiguo', emoji: '⚡', stat: 'potencia', versions: {
            comun: { amount: 80, duration: 8 }, poco_comun: { amount: 104, duration: 8 }, raro: { amount: 130, duration: 9 },
            epico: { amount: 180, duration: 10 }, legendario: { amount: 235, duration: 11 }, mitico: { amount: 330, duration: 13 },
        } },
        { id: 'postre_destino', name: 'Postre del Destino', emoji: '✨', stat: 'destreza', versions: {
            comun: { amount: 70, duration: 8 }, poco_comun: { amount: 91, duration: 8 }, raro: { amount: 114, duration: 9 },
            epico: { amount: 156, duration: 10 }, legendario: { amount: 205, duration: 11 }, mitico: { amount: 290, duration: 13 },
        } },
        { id: 'elixir_supremo', name: 'Elixir Supremo', emoji: '🔮', stat: 'suerte', versions: {
            comun: { amount: 50, duration: 7 }, poco_comun: { amount: 65, duration: 7 }, raro: { amount: 82, duration: 8 },
            epico: { amount: 112, duration: 9 }, legendario: { amount: 145, duration: 10 }, mitico: { amount: 205, duration: 12 },
        } },
        { id: 'energia_pura', name: 'Energía Pura', emoji: '⚡', stat: 'pa', versions: {
            comun: { amount: 5, duration: 5 }, poco_comun: { amount: 6, duration: 5 }, raro: { amount: 7, duration: 6 },
            epico: { amount: 8, duration: 7 }, legendario: { amount: 9, duration: 8 }, mitico: { amount: 11, duration: 10 },
        } },
        { id: 'nectar_infinito', name: 'Néctar del Infinito', emoji: '🌟', stat: 'pa', versions: {
            comun: { amount: 6, duration: 6, regen: 10 }, poco_comun: { amount: 7, duration: 6, regen: 12 }, raro: { amount: 8, duration: 7, regen: 15 },
            epico: { amount: 9, duration: 8, regen: 18 }, legendario: { amount: 10, duration: 9, regen: 22 }, mitico: { amount: 12, duration: 11, regen: 28 },
        } },
    ],
    8: [
        { id: 'banquete_sombras', name: 'Banquete de las Sombras', emoji: '🌑', stat: 'vida', versions: {
            comun: { amount: 210, duration: 9 }, poco_comun: { amount: 273, duration: 9 }, raro: { amount: 343, duration: 10 },
            epico: { amount: 476, duration: 11 }, legendario: { amount: 616, duration: 12 }, mitico: { amount: 840, duration: 14 },
        } },
        { id: 'coraza_sombras', name: 'Coraza de Sombras', emoji: '🖤', stat: 'defensa', versions: {
            comun: { amount: 20, duration: 9, regen: 9 }, poco_comun: { amount: 27, duration: 9, regen: 12 }, raro: { amount: 34, duration: 10, regen: 14 },
            epico: { amount: 46, duration: 11, regen: 18 }, legendario: { amount: 59, duration: 12, regen: 23 }, mitico: { amount: 81, duration: 14, regen: 30 },
        } },
        { id: 'te_medianoche', name: 'Té de Medianoche', emoji: '🌙', stat: 'regen_time', versions: {
            comun: { amount: 20, duration: 45 }, poco_comun: { amount: 26, duration: 49 }, raro: { amount: 32, duration: 53 },
            epico: { amount: 41, duration: 57 }, legendario: { amount: 50, duration: 60 }, mitico: { amount: 65, duration: 65 },
        } },
        { id: 'carne_vacio', name: 'Carne del Vacío', emoji: '🕳️', stat: 'potencia', versions: {
            comun: { amount: 110, duration: 9 }, poco_comun: { amount: 142, duration: 9 }, raro: { amount: 178, duration: 10 },
            epico: { amount: 247, duration: 11 }, legendario: { amount: 322, duration: 12 }, mitico: { amount: 452, duration: 14 },
        } },
        { id: 'pastel_nocturno', name: 'Pastel Nocturno', emoji: '🌃', stat: 'destreza', versions: {
            comun: { amount: 96, duration: 9 }, poco_comun: { amount: 125, duration: 9 }, raro: { amount: 156, duration: 10 },
            epico: { amount: 214, duration: 11 }, legendario: { amount: 281, duration: 12 }, mitico: { amount: 397, duration: 14 },
        } },
        { id: 'elixir_tinieblas', name: 'Elixir de las Tinieblas', emoji: '🔮', stat: 'suerte', versions: {
            comun: { amount: 69, duration: 8 }, poco_comun: { amount: 89, duration: 8 }, raro: { amount: 112, duration: 9 },
            epico: { amount: 153, duration: 10 }, legendario: { amount: 199, duration: 11 }, mitico: { amount: 281, duration: 13 },
        } },
        { id: 'esencia_oscura', name: 'Esencia Oscura', emoji: '⚫', stat: 'pa', versions: {
            comun: { amount: 7, duration: 6 }, poco_comun: { amount: 8, duration: 6 }, raro: { amount: 9, duration: 7 },
            epico: { amount: 10, duration: 8 }, legendario: { amount: 12, duration: 9 }, mitico: { amount: 14, duration: 11 },
        } },
        { id: 'nectar_sombrio', name: 'Néctar Sombrío', emoji: '🌫️', stat: 'pa', versions: {
            comun: { amount: 8, duration: 7, regen: 13 }, poco_comun: { amount: 9, duration: 7, regen: 16 }, raro: { amount: 11, duration: 8, regen: 20 },
            epico: { amount: 12, duration: 9, regen: 23 }, legendario: { amount: 13, duration: 10, regen: 29 }, mitico: { amount: 16, duration: 12, regen: 36 },
        } },
    ],
    9: [
        { id: 'festin_estrellas', name: 'Festín de las Estrellas', emoji: '🌠', stat: 'vida', versions: {
            comun: { amount: 294, duration: 10 }, poco_comun: { amount: 382, duration: 10 }, raro: { amount: 480, duration: 11 },
            epico: { amount: 666, duration: 12 }, legendario: { amount: 862, duration: 13 }, mitico: { amount: 1176, duration: 15 },
        } },
        { id: 'aura_celestial', name: 'Aura Celestial', emoji: '💫', stat: 'defensa', versions: {
            comun: { amount: 27, duration: 10, regen: 12 }, poco_comun: { amount: 36, duration: 10, regen: 15 }, raro: { amount: 46, duration: 11, regen: 19 },
            epico: { amount: 62, duration: 12, regen: 24 }, legendario: { amount: 80, duration: 13, regen: 30 }, mitico: { amount: 109, duration: 15, regen: 39 },
        } },
        { id: 'rocio_estelar', name: 'Rocío Estelar', emoji: '💧', stat: 'regen_time', versions: {
            comun: { amount: 27, duration: 50 }, poco_comun: { amount: 35, duration: 54 }, raro: { amount: 44, duration: 58 },
            epico: { amount: 55, duration: 62 }, legendario: { amount: 67, duration: 65 }, mitico: { amount: 87, duration: 70 },
        } },
        { id: 'carne_titan', name: 'Carne de Titán', emoji: '💪', stat: 'potencia', versions: {
            comun: { amount: 150, duration: 10 }, poco_comun: { amount: 195, duration: 10 }, raro: { amount: 244, duration: 11 },
            epico: { amount: 338, duration: 12 }, legendario: { amount: 441, duration: 13 }, mitico: { amount: 619, duration: 15 },
        } },
        { id: 'torta_estelar', name: 'Torta Estelar', emoji: '🌌', stat: 'destreza', versions: {
            comun: { amount: 131, duration: 10 }, poco_comun: { amount: 171, duration: 10 }, raro: { amount: 214, duration: 11 },
            epico: { amount: 293, duration: 12 }, legendario: { amount: 385, duration: 13 }, mitico: { amount: 544, duration: 15 },
        } },
        { id: 'elixir_astral', name: 'Elixir Astral', emoji: '🔭', stat: 'suerte', versions: {
            comun: { amount: 94, duration: 9 }, poco_comun: { amount: 122, duration: 9 }, raro: { amount: 154, duration: 10 },
            epico: { amount: 210, duration: 11 }, legendario: { amount: 272, duration: 12 }, mitico: { amount: 385, duration: 14 },
        } },
        { id: 'chispa_celestial', name: 'Chispa Celestial', emoji: '⚡', stat: 'pa', versions: {
            comun: { amount: 8, duration: 7 }, poco_comun: { amount: 10, duration: 7 }, raro: { amount: 12, duration: 8 },
            epico: { amount: 14, duration: 9 }, legendario: { amount: 15, duration: 10 }, mitico: { amount: 19, duration: 12 },
        } },
        { id: 'rayo_luz_pura', name: 'Rayo de Luz Pura', emoji: '☀️', stat: 'pa', versions: {
            comun: { amount: 11, duration: 8, regen: 17 }, poco_comun: { amount: 12, duration: 8, regen: 20 }, raro: { amount: 14, duration: 9, regen: 25 },
            epico: { amount: 16, duration: 10, regen: 30 }, legendario: { amount: 18, duration: 11, regen: 37 }, mitico: { amount: 21, duration: 13, regen: 47 },
        } },
    ],
    10: [
        { id: 'manjar_creacion', name: 'Manjar de la Creación', emoji: '🌌', stat: 'vida', versions: {
            comun: { amount: 412, duration: 11 }, poco_comun: { amount: 535, duration: 11 }, raro: { amount: 672, duration: 12 },
            epico: { amount: 933, duration: 13 }, legendario: { amount: 1207, duration: 14 }, mitico: { amount: 1646, duration: 16 },
        } },
        { id: 'escudo_absoluto', name: 'Escudo Absoluto', emoji: '⚛️', stat: 'defensa', versions: {
            comun: { amount: 37, duration: 11, regen: 15 }, poco_comun: { amount: 49, duration: 11, regen: 20 }, raro: { amount: 62, duration: 12, regen: 24 },
            epico: { amount: 84, duration: 13, regen: 31 }, legendario: { amount: 108, duration: 14, regen: 40 }, mitico: { amount: 148, duration: 16, regen: 51 },
        } },
        { id: 'elixir_infinito', name: 'Elixir del Infinito', emoji: '♾️', stat: 'regen_time', versions: {
            comun: { amount: 37, duration: 55 }, poco_comun: { amount: 47, duration: 59 }, raro: { amount: 59, duration: 63 },
            epico: { amount: 74, duration: 67 }, legendario: { amount: 91, duration: 70 }, mitico: { amount: 118, duration: 75 },
        } },
        { id: 'esencia_poder_absoluto', name: 'Esencia de Poder Absoluto', emoji: '💥', stat: 'potencia', versions: {
            comun: { amount: 206, duration: 11 }, poco_comun: { amount: 267, duration: 11 }, raro: { amount: 334, duration: 12 },
            epico: { amount: 463, duration: 13 }, legendario: { amount: 604, duration: 14 }, mitico: { amount: 849, duration: 16 },
        } },
        { id: 'postre_eternidad', name: 'Postre de la Eternidad', emoji: '⏳', stat: 'destreza', versions: {
            comun: { amount: 180, duration: 11 }, poco_comun: { amount: 234, duration: 11 }, raro: { amount: 293, duration: 12 },
            epico: { amount: 401, duration: 13 }, legendario: { amount: 527, duration: 14 }, mitico: { amount: 746, duration: 16 },
        } },
        { id: 'sabiduria_absoluta', name: 'Sabiduría Absoluta', emoji: '🧠', stat: 'suerte', versions: {
            comun: { amount: 129, duration: 10 }, poco_comun: { amount: 167, duration: 10 }, raro: { amount: 211, duration: 11 },
            epico: { amount: 288, duration: 12 }, legendario: { amount: 373, duration: 13 }, mitico: { amount: 527, duration: 15 },
        } },
        { id: 'energia_infinita', name: 'Energía Infinita', emoji: '🔆', stat: 'pa', versions: {
            comun: { amount: 11, duration: 8 }, poco_comun: { amount: 13, duration: 8 }, raro: { amount: 15, duration: 9 },
            epico: { amount: 18, duration: 10 }, legendario: { amount: 20, duration: 11 }, mitico: { amount: 24, duration: 13 },
        } },
        { id: 'fuente_vida_eterna', name: 'Fuente de Vida Eterna', emoji: '🌟', stat: 'pa', versions: {
            comun: { amount: 14, duration: 9, regen: 22 }, poco_comun: { amount: 16, duration: 9, regen: 26 }, raro: { amount: 19, duration: 10, regen: 33 },
            epico: { amount: 21, duration: 11, regen: 40 }, legendario: { amount: 24, duration: 12, regen: 48 }, mitico: { amount: 28, duration: 14, regen: 62 },
        } },
    ],
};

function getFoodDef(foodId) {
    for (const tierId in FOODS) {
        const food = FOODS[tierId].find(f => f.id === foodId);
        if (food) return { tierId: parseInt(tierId, 10), food };
    }
    return null;
}

function buildFoodEffectLabel(food, version) {
    if (food.stat === 'regen_time') {
        return `💚 Regenera ${version.amount} HP/min x ${version.duration} min`;
    }
    const label = FOOD_STAT_LABELS[food.stat];
    let text = `+${version.amount} ${label.icon} ${label.name} (${version.duration} combates)`;
    if (version.regen) text += ` + ${version.regen} HP/turno`;
    return text;
}

// Registra nombre/emoji de cada versión de cada alimento (alimento + rareza)
// para mostrarlo en el inventario, igual que las pociones. La cantidad
// stackeable se guarda en player.materials bajo la clave
// `food_<foodId>__<rarityId>` (doble guion bajo: ni los ids de alimento ni
// los de rareza lo usan, así que separar por ahí siempre es inambiguo).
Object.keys(FOODS).forEach(tierId => {
    FOODS[tierId].forEach(food => {
        MONSTER_RARITIES.forEach(rarity => {
            MATERIAL_INFO[`food_${food.id}__${rarity.id}`] = { name: `${food.name} (${rarity.name})`, emoji: food.emoji };
        });
    });
});
