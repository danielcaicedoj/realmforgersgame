// ===== SISTEMA DE TABERNA — PRECIOS DEL MERCADER =====
// Todo lo que necesita el Mercader para tasar objetos vendidos por el
// jugador (núcleos, mena/madera/hierba/cultivo, armas/armaduras/monturas
// crafteadas con sus encantamientos). Los objetos de consumo (pociones,
// pergaminos, comida) no tienen precio: no son vendibles.

const SHOP_TIER_MULT = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16, 6: 32, 7: 64, 8: 128, 9: 256, 10: 512 };
const SHOP_RARITY_MULT = { comun: 1, poco_comun: 2, raro: 3, epico: 6, legendario: 9, mitico: 12 };
const SHOP_SCROLL_PRICE = 10; // pergamino de teletransportación, stock infinito
const SHOP_GUIA_SCROLL_PRICE = 10; // pergamino guía, stock infinito (ver Player.buyGuiaScroll)

function getNucleoSellPrice(tierId, rarityId) {
    return (SHOP_TIER_MULT[tierId] || 1) * (SHOP_RARITY_MULT[rarityId] || 1);
}

// Mena/madera/hierba/cultivo: tienen Tier pero no Rareza. Se tasan igual
// que un núcleo Común de su mismo Tier (única referencia de precio que da
// el diseño para un material con Tier y sin Rareza).
function getTieredResourceSellPrice(tierId) {
    return SHOP_TIER_MULT[tierId] || 1;
}

// Reconoce materiales con Tier a partir de su id: núcleos
// (nucleo_<rareza>_tier<N>) o recursos crudos (mat|madera|hierba|cultivo)_tier_<N>.
function parseTieredMaterialId(id) {
    let m = id.match(/^nucleo_([a-z_]+)_tier(\d+)$/);
    if (m) return { kind: 'nucleo', rarityId: m[1], tierId: parseInt(m[2], 10) };
    m = id.match(/^(mat|madera|hierba|cultivo)_tier_(\d+)$/);
    if (m) return { kind: 'resource', tierId: parseInt(m[2], 10) };
    return null;
}

function getMaterialUnitSellPrice(materialId) {
    const parsed = parseTieredMaterialId(materialId);
    if (!parsed) return 0;
    return parsed.kind === 'nucleo'
        ? getNucleoSellPrice(parsed.tierId, parsed.rarityId)
        : getTieredResourceSellPrice(parsed.tierId);
}

function isMaterialSellable(materialId) {
    return getMaterialUnitSellPrice(materialId) > 0;
}

// Arma/Armadura: Multiplicador_Tier × Multiplicador_Rareza × núcleos usados
// al craftearla (ver CRAFT_CORE_COST en constants.js), + el precio de cada
// encantamiento activo (mismos multiplicadores × el costo en PA de SU nivel
// actual — ver ENCHANT_COST_TABLE en enchantments.js, no acumulado).
function getCraftedItemSellPrice(item) {
    const tierMult = SHOP_TIER_MULT[item.tierId] || 1;
    const rarityMult = SHOP_RARITY_MULT[item.rarityId] || 1;
    let price = tierMult * rarityMult * CRAFT_CORE_COST;
    if (item.enchants) {
        Object.keys(item.enchants).forEach(encId => {
            price += tierMult * rarityMult * getEnchantCost(item.rarityId, item.enchants[encId]);
        });
    }
    return Math.round(price);
}

// Montura: mismo esquema que un arma sin encantamientos, con sus propios
// núcleos de crafteo (ver getMountCraftCost en mounts.js).
function getMountSellPrice(mount) {
    const tierMult = SHOP_TIER_MULT[mount.tierId] || 1;
    const rarityMult = SHOP_RARITY_MULT[mount.rarityId] || 1;
    const cost = getMountCraftCost(mount.tierId);
    return Math.round(tierMult * rarityMult * cost.nucleo);
}
