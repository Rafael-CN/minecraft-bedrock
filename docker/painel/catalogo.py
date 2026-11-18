#!/usr/bin/env python3
"""
Catalogo do mundo: tudo que existe para invocar, dar ou encantar.

O autocomplete do painel vivia de uma lista de trinta itens escrita a mao,
e por isso quase nunca tinha o que o Rafael queria. Aqui a lista vem do
proprio servidor: cada behavior pack instalado declara suas entidades e
itens em JSON, e isso inclui os addons - Naturalist, Core Craft, Aether.
Sao centenas de bichos e milhares de itens que a lista a mao jamais teria.

O que NAO vem dos arquivos sao os itens vanilla classicos (espada de
diamante, TNT, ovo): esses estao compilados dentro do executavel do jogo,
sem JSON nenhum. Para eles existe a lista VANILLA abaixo, curada.

A varredura le milhares de arquivos, entao o resultado fica em cache e so
e refeito quando alguem instala ou remove um addon.
"""
import json
import os
import re
import time

CACHE = "/tmp/catalogo.json"
VALIDADE_S = 3600

# Itens vanilla que nao tem arquivo JSON no servidor - o jogo os traz
# compilados. Lista curada pelo que se usa de verdade num servidor de casa.
VANILLA = """
diamond_sword diamond_pickaxe diamond_axe diamond_shovel diamond_hoe
diamond_helmet diamond_chestplate diamond_leggings diamond_boots
netherite_sword netherite_pickaxe netherite_axe netherite_shovel netherite_hoe
netherite_helmet netherite_chestplate netherite_leggings netherite_boots
iron_sword iron_pickaxe iron_axe iron_shovel iron_hoe
iron_helmet iron_chestplate iron_leggings iron_boots
golden_sword golden_pickaxe golden_axe golden_shovel golden_hoe
golden_helmet golden_chestplate golden_leggings golden_boots
stone_sword stone_pickaxe stone_axe stone_shovel stone_hoe
wooden_sword wooden_pickaxe wooden_axe wooden_shovel wooden_hoe
leather_helmet leather_chestplate leather_leggings leather_boots
chainmail_helmet chainmail_chestplate chainmail_leggings chainmail_boots
turtle_helmet elytra shield bow crossbow arrow trident
fishing_rod flint_and_steel shears carrot_on_a_stick warped_fungus_on_a_stick
totem_of_undying enchanted_golden_apple golden_apple golden_carrot
ender_pearl ender_eye chorus_fruit firework_rocket
diamond emerald netherite_ingot netherite_scrap ancient_debris
iron_ingot gold_ingot copper_ingot coal charcoal redstone lapis_lazuli quartz
stick string leather feather gunpowder blaze_rod blaze_powder
ghast_tear magma_cream slime_ball phantom_membrane rabbit_foot
nether_star dragon_breath experience_bottle
tnt beacon conduit end_crystal respawn_anchor lodestone
shulker_box ender_chest chest barrel hopper dispenser dropper observer
piston sticky_piston redstone_block repeater comparator lever
command_block chain_command_block repeating_command_block structure_block barrier
obsidian crying_obsidian bedrock end_portal_frame spawner
diamond_block emerald_block gold_block iron_block netherite_block
oak_planks stone cobblestone dirt grass_block sand gravel glass
water_bucket lava_bucket milk_bucket bucket powder_snow_bucket
egg snowball bone bone_meal apple bread cake cookie pumpkin_pie
cooked_beef cooked_porkchop cooked_chicken golden_apple rotten_flesh
torch soul_torch lantern soul_lantern campfire soul_campfire
saddle name_tag lead compass clock spyglass map recovery_compass
book written_book writable_book enchanted_book
potion splash_potion lingering_potion glass_bottle
dragon_egg dragon_head player_head zombie_head skeleton_skull creeper_head
music_disc_pigstep music_disc_otherside music_disc_5
sponge wet_sponge slime_block honey_block scaffolding
anvil enchanting_table crafting_table furnace blast_furnace smoker
brewing_stand cauldron grindstone smithing_table loom stonecutter
bell armor_stand item_frame glow_item_frame painting flower_pot
""".split()

ENCANTAMENTOS = {
    "sharpness": 5, "smite": 5, "bane_of_arthropods": 5, "fire_aspect": 2,
    "looting": 3, "knockback": 2, "sweeping": 3, "unbreaking": 3, "mending": 1,
    "efficiency": 5, "fortune": 3, "silk_touch": 1,
    "protection": 4, "fire_protection": 4, "blast_protection": 4,
    "projectile_protection": 4, "thorns": 3, "feather_falling": 4,
    "depth_strider": 3, "frost_walker": 2, "soul_speed": 3, "swift_sneak": 3,
    "respiration": 3, "aqua_affinity": 1,
    "power": 5, "punch": 2, "flame": 1, "infinity": 1,
    "luck_of_the_sea": 3, "lure": 3,
    "impaling": 5, "riptide": 3, "loyalty": 3, "channeling": 1,
    "quick_charge": 3, "multishot": 1, "piercing": 4,
    "binding_curse": 1, "vanishing_curse": 1,
}

EFEITOS = [
    "speed", "slowness", "haste", "mining_fatigue", "strength", "instant_health",
    "instant_damage", "jump_boost", "nausea", "regeneration", "resistance",
    "fire_resistance", "water_breathing", "invisibility", "blindness",
    "night_vision", "hunger", "weakness", "poison", "wither", "health_boost",
    "absorption", "saturation", "levitation", "slow_falling", "conduit_power",
    "bad_omen", "village_hero", "darkness",
]


def _nivel_do_mundo(data="/data"):
    caminho = os.path.join(data, "server.properties")
    try:
        with open(caminho, encoding="utf-8") as f:
            for linha in f:
                if linha.startswith("level-name="):
                    return linha.split("=", 1)[1].strip()
    except OSError:
        pass
    return None


def _varrer(raizes, chave):
    """Identificadores declarados nos JSON dos packs, por tipo."""
    achados = set()
    for raiz in raizes:
        if not os.path.isdir(raiz):
            continue
        for base, _, arquivos in os.walk(raiz):
            # loot_tables e recipes tem milhares de arquivos e nunca
            # declaram entidade nem item: pular corta a varredura pela metade.
            if os.sep + "loot_tables" in base or os.sep + "recipes" in base:
                continue
            for nome in arquivos:
                if not nome.endswith(".json"):
                    continue
                try:
                    with open(os.path.join(base, nome), encoding="utf-8", errors="ignore") as f:
                        texto = f.read(4000)
                except OSError:
                    continue
                if chave not in texto:
                    continue
                m = re.search(r'"identifier"\s*:\s*"([a-z0-9_.:]+)"', texto)
                if m:
                    achados.add(m.group(1))
    return achados


def montar(data="/data"):
    nivel = _nivel_do_mundo(data)
    raizes = [os.path.join(data, "behavior_packs")]
    if nivel:
        raizes.append(os.path.join(data, "worlds", nivel, "behavior_packs"))

    mobs = _varrer(raizes, '"minecraft:entity"')
    itens = _varrer(raizes, '"minecraft:item"')

    # O prefixo minecraft: e opcional em comando, e digitar sem ele e mais
    # rapido - entao guardamos a forma curta para o vanilla e a completa
    # para os addons, que precisam do namespace.
    def curto(x):
        return x[len("minecraft:"):] if x.startswith("minecraft:") else x

    itens_todos = sorted({curto(i) for i in itens} | set(VANILLA))
    mobs_todos = sorted({curto(m) for m in mobs})

    return {
        "mobs": mobs_todos,
        "itens": itens_todos,
        "encantamentos": ENCANTAMENTOS,
        "efeitos": EFEITOS,
        "mundo": nivel,
        "gerado": int(time.time()),
    }


def obter(data="/data", forcar=False):
    if not forcar:
        try:
            st = os.stat(CACHE)
            if time.time() - st.st_mtime < VALIDADE_S:
                with open(CACHE, encoding="utf-8") as f:
                    return json.load(f)
        except (OSError, ValueError):
            pass
    catalogo = montar(data)
    try:
        with open(CACHE, "w", encoding="utf-8") as f:
            json.dump(catalogo, f)
    except OSError:
        pass
    return catalogo


if __name__ == "__main__":
    c = montar()
    print(f"mobs: {len(c['mobs'])}  itens: {len(c['itens'])}  mundo: {c['mundo']}")
