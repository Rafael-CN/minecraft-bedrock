#!/usr/bin/env python3
"""
Instala/remove/lista addons (.mcpack, .mcaddon) no mundo Bedrock.

Portado de Install-Addons.ps1 para Python (stdlib apenas).
"""
import json
import os
import re
import shutil
import tempfile
import zipfile
from pathlib import Path


def limpar_json(texto):
    """Remove comentários e vírgulas sobrando do JSON."""
    # Remove UTF-8 BOM
    if texto.startswith('﻿'):
        texto = texto[1:]
    # Remove comentários /* ... */
    texto = re.sub(r'/\*.*?\*/', '', texto, flags=re.DOTALL)
    # Remove comentários //
    texto = re.sub(r'(?m)^\s*//.*$', '', texto)
    # Remove vírgula antes de } ou ]
    texto = re.sub(r',(\s*[\}\]])', r'\1', texto)
    return texto


def ler_json_solto(caminho):
    """Lê JSON que pode ter comentários/vírgulas extras."""
    with open(caminho, 'r', encoding='utf-8') as f:
        raw = f.read()
    clean = limpar_json(raw)
    return json.loads(clean)


def consertar_manifest(caminho):
    """Limpa e reescreve manifest.json se tiver comentários/vírgulas."""
    with open(caminho, 'r', encoding='utf-8') as f:
        raw = f.read()
    clean = limpar_json(raw)
    if clean != raw:
        with open(caminho, 'w', encoding='utf-8') as f:
            f.write(clean)
        return True
    return False


def converter_versao(vers):
    """Converte versão para tupla (major, minor, patch)."""
    if not vers:
        return (1, 0, 0)
    if isinstance(vers, str):
        partes = re.split(r'[\.\-]', vers)
    else:
        partes = vers
    nums = []
    for p in partes:
        try:
            nums.append(int(p))
        except (ValueError, TypeError):
            nums.append(0)
    while len(nums) < 3:
        nums.append(0)
    return tuple(nums[:3])


def fazer_slug(texto):
    """Transforma texto em slug para pasta."""
    s = re.sub(r'[^A-Za-z0-9\-_ ]', '', texto)
    s = ' '.join(s.split())
    s = s.replace(' ', '_')
    if len(s) > 40:
        s = s[:40]
    if not s:
        s = 'pack'
    return s


def extrair_zip(caminho_zip, destino):
    """Extrai arquivo zip."""
    destino_path = Path(destino)
    destino_path.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(caminho_zip, 'r') as zf:
        zf.extractall(destino)


def expandir_zips_aninhados(pasta):
    """Extrai .mcpack/.mcaddon dentro de pastas."""
    for _ in range(5):
        encontrados = []
        for raiz, dirs, arquivos in os.walk(pasta):
            for arquivo in arquivos:
                if arquivo.endswith(('.mcpack', '.mcaddon', '.zip')):
                    encontrados.append(os.path.join(raiz, arquivo))
        if not encontrados:
            break
        for caminho in encontrados:
            dir_pai = os.path.dirname(caminho)
            nome_base = os.path.splitext(os.path.basename(caminho))[0]
            destino = os.path.join(dir_pai, nome_base + '_x')
            try:
                extrair_zip(caminho, destino)
            except Exception:
                pass
            try:
                os.remove(caminho)
            except Exception:
                pass


def encontrar_manifests(pasta):
    """Encontra todos os diretórios com manifest.json."""
    roots = []
    manifests = []
    for raiz, dirs, arquivos in os.walk(pasta):
        if 'manifest.json' in arquivos:
            manifests.append(raiz)
    # Ordena por comprimento (mais curtos primeiro)
    manifests.sort(key=lambda x: len(x))
    # Remove os que estão dentro de outros
    for m in manifests:
        dentro = False
        for r in roots:
            if m.startswith(r.rstrip('/\\') + os.sep):
                dentro = True
                break
        if not dentro:
            roots.append(m)
    return roots


def resolver_nome_real(pasta_pack, nome_placeholder):
    """Resolve o nome real do pack a partir de texts/*.lang se for placeholder."""
    if nome_placeholder and nome_placeholder not in ('pack.name', ''):
        return nome_placeholder

    # Procurar por texts/en_US.lang, depois pt_BR.lang, depois o primeiro
    texts_dir = os.path.join(pasta_pack, 'texts')
    if os.path.exists(texts_dir):
        preferidos = ['en_US.lang', 'pt_BR.lang']
        arquivos = sorted(os.listdir(texts_dir))

        for pref in preferidos:
            if pref in arquivos:
                try:
                    with open(os.path.join(texts_dir, pref), 'r', encoding='utf-8') as f:
                        for linha in f:
                            if linha.startswith('pack.name='):
                                valor = linha.split('=', 1)[1].strip()
                                if valor:
                                    return valor
                except Exception:
                    pass

        # Fallback: primeiro arquivo .lang
        for arquivo in arquivos:
            if arquivo.endswith('.lang'):
                try:
                    with open(os.path.join(texts_dir, arquivo), 'r', encoding='utf-8') as f:
                        for linha in f:
                            if linha.startswith('pack.name='):
                                valor = linha.split('=', 1)[1].strip()
                                if valor:
                                    return valor
                except Exception:
                    pass

    return nome_placeholder


def obter_info_pack(pasta_pack):
    """Lê manifest.json e extrai info do pack."""
    manifest_path = os.path.join(pasta_pack, 'manifest.json')
    try:
        m = ler_json_solto(manifest_path)
    except Exception:
        return None

    uuid = None
    if m.get('header'):
        uuid = m['header'].get('uuid')
    if not uuid:
        return None

    tipos = []
    if m.get('modules'):
        for mod in m['modules']:
            if mod.get('type'):
                tipos.append(str(mod['type']).lower())

    kind = None
    if 'data' in tipos or 'script' in tipos or 'client_data' in tipos:
        kind = 'behavior_packs'
    elif 'resources' in tipos:
        kind = 'resource_packs'
    elif 'skin_pack' in tipos:
        kind = 'skin_pack'
    elif 'world_template' in tipos:
        kind = 'world_template'

    deps = []
    if m.get('dependencies'):
        for d in m['dependencies']:
            if d.get('uuid'):
                deps.append(str(d['uuid']))

    nome = ''
    if m.get('header') and m['header'].get('name'):
        nome = str(m['header']['name'])

    # Resolver nome real se for placeholder
    nome = resolver_nome_real(pasta_pack, nome)

    versao = m.get('header', {}).get('version', [1, 0, 0])

    return {
        'dir': pasta_pack,
        'uuid': str(uuid),
        'versao': converter_versao(versao),
        'kind': kind,
        'tipos': tipos,
        'nome': nome,
        'deps': deps,
        'tem_script': 'script' in tipos,
    }


def ler_lista_packs(caminho):
    """Lê world_*_packs.json."""
    lista = []
    if os.path.exists(caminho):
        try:
            with open(caminho, 'r', encoding='utf-8') as f:
                raw = f.read()
            clean = limpar_json(raw)
            items = json.loads(clean)
            if isinstance(items, list):
                for e in items:
                    if e.get('pack_id'):
                        lista.append({
                            'pack_id': str(e['pack_id']),
                            'versao': converter_versao(e.get('version'))
                        })
        except Exception:
            pass
    return lista


def escrever_lista_packs(caminho, lista):
    """Escreve world_*_packs.json."""
    saida = []
    for e in lista:
        saida.append({
            'pack_id': e['pack_id'],
            'version': list(e['versao'])
        })
    json_str = json.dumps(saida, indent=2, ensure_ascii=False)
    with open(caminho, 'w', encoding='utf-8') as f:
        f.write(json_str)


def instalar_addon(caminho_arquivo, dir_mundo, alvo_container=None):
    """
    Instala um arquivo .mcpack/.mcaddon no mundo.
    Retorna (sucesso, mensagem).
    """
    try:
        if not os.path.exists(dir_mundo):
            return False, f"Pasta do mundo não existe: {dir_mundo}"

        # Extrair arquivo em temp
        with tempfile.TemporaryDirectory() as tmpdir:
            try:
                extrair_zip(caminho_arquivo, tmpdir)
            except Exception as e:
                return False, f"Não consegui abrir como zip: {e}"

            # Expande zips aninhados
            expandir_zips_aninhados(tmpdir)

            # Encontra manifests
            roots = encontrar_manifests(tmpdir)
            if not roots:
                return False, "Nenhum manifest.json encontrado"

            # Processa cada pack encontrado
            bp_list = ler_lista_packs(os.path.join(dir_mundo, 'world_behavior_packs.json'))
            rp_list = ler_lista_packs(os.path.join(dir_mundo, 'world_resource_packs.json'))

            resultados = []
            for root_dir in roots:
                info = obter_info_pack(root_dir)
                if not info:
                    resultados.append(f"❌ Manifest sem uuid")
                    continue

                if info['kind'] in ('skin_pack', 'world_template'):
                    resultados.append(f"⊘ {info['nome']}: tipo não suportado")
                    continue

                if not info['kind']:
                    resultados.append(f"❌ {info['nome']}: tipo desconhecido")
                    continue

                nome_label = info['nome'] or os.path.basename(caminho_arquivo)
                folder = fazer_slug(nome_label) + '_' + info['uuid'].replace('-', '')[:8]

                kind_dir = os.path.join(dir_mundo, info['kind'])
                dest_dir = os.path.join(kind_dir, folder)

                os.makedirs(kind_dir, exist_ok=True)
                if os.path.exists(dest_dir):
                    shutil.rmtree(dest_dir)

                shutil.copytree(root_dir, dest_dir)

                # Conserta manifest se necessário
                if consertar_manifest(os.path.join(dest_dir, 'manifest.json')):
                    resultados.append(f"✓ {nome_label} instalado (manifest limpo)")
                else:
                    resultados.append(f"✓ {nome_label} instalado")

                # Atualiza listas
                target_list = bp_list if info['kind'] == 'behavior_packs' else rp_list

                # Remove entrada antiga se existir
                target_list = [e for e in target_list if e['pack_id'] != info['uuid']]
                # Adiciona entrada nova
                target_list.append({
                    'pack_id': info['uuid'],
                    'versao': info['versao']
                })

                if info['kind'] == 'behavior_packs':
                    bp_list = target_list
                else:
                    rp_list = target_list

            # Grava listas
            escrever_lista_packs(os.path.join(dir_mundo, 'world_behavior_packs.json'), bp_list)
            escrever_lista_packs(os.path.join(dir_mundo, 'world_resource_packs.json'), rp_list)

            return True, "\n".join(resultados)

    except Exception as e:
        return False, f"Erro: {str(e)}"


def remover_addon(pack_uuid, dir_mundo):
    """Remove um addon do mundo."""
    try:
        bp_list = ler_lista_packs(os.path.join(dir_mundo, 'world_behavior_packs.json'))
        rp_list = ler_lista_packs(os.path.join(dir_mundo, 'world_resource_packs.json'))

        # Remove de ambas as listas
        bp_list_novo = [e for e in bp_list if e['pack_id'] != pack_uuid]
        rp_list_novo = [e for e in rp_list if e['pack_id'] != pack_uuid]

        # Apaga pasta do pack
        for kind in ('behavior_packs', 'resource_packs'):
            kind_dir = os.path.join(dir_mundo, kind)
            if os.path.exists(kind_dir):
                for pasta in os.listdir(kind_dir):
                    if pack_uuid[:8] in pasta:
                        shutil.rmtree(os.path.join(kind_dir, pasta), ignore_errors=True)

        escrever_lista_packs(os.path.join(dir_mundo, 'world_behavior_packs.json'), bp_list_novo)
        escrever_lista_packs(os.path.join(dir_mundo, 'world_resource_packs.json'), rp_list_novo)

        return True, "Addon removido"
    except Exception as e:
        return False, f"Erro ao remover: {str(e)}"


def listar_addons_instalados(dir_mundo):
    """Lista addons atualmente instalados no mundo."""
    addons = []

    bp_list = ler_lista_packs(os.path.join(dir_mundo, 'world_behavior_packs.json'))
    rp_list = ler_lista_packs(os.path.join(dir_mundo, 'world_resource_packs.json'))

    for e in bp_list:
        nome = "Addon BP"
        # Tenta ler o nome do manifest
        bp_dir = os.path.join(dir_mundo, 'behavior_packs')
        if os.path.exists(bp_dir):
            for pasta in os.listdir(bp_dir):
                if e['pack_id'][:8] in pasta:
                    manifest_path = os.path.join(bp_dir, pasta, 'manifest.json')
                    if os.path.exists(manifest_path):
                        try:
                            info = obter_info_pack(os.path.join(bp_dir, pasta))
                            if info and info.get('nome'):
                                nome = info['nome']
                        except Exception:
                            pass
                    break
        addons.append({
            'uuid': e['pack_id'],
            'nome': nome,
            'tipo': 'BP',
            'versao': '.'.join(map(str, e['versao']))
        })

    for e in rp_list:
        nome = "Addon RP"
        # Tenta ler o nome do manifest
        rp_dir = os.path.join(dir_mundo, 'resource_packs')
        if os.path.exists(rp_dir):
            for pasta in os.listdir(rp_dir):
                if e['pack_id'][:8] in pasta:
                    manifest_path = os.path.join(rp_dir, pasta, 'manifest.json')
                    if os.path.exists(manifest_path):
                        try:
                            info = obter_info_pack(os.path.join(rp_dir, pasta))
                            if info and info.get('nome'):
                                nome = info['nome']
                        except Exception:
                            pass
                    break
        addons.append({
            'uuid': e['pack_id'],
            'nome': nome,
            'tipo': 'RP',
            'versao': '.'.join(map(str, e['versao']))
        })

    return addons


def resolver_nome_zip(caminho_zip):
    """Resolve nome real a partir de texts/*.lang dentro do zip."""
    try:
        with zipfile.ZipFile(caminho_zip, 'r') as zf:
            preferidos = ['texts/en_US.lang', 'texts/pt_BR.lang']

            # Procurar preferidos
            for caminho_preferido in preferidos:
                if caminho_preferido in zf.namelist():
                    try:
                        conteudo = zf.read(caminho_preferido).decode('utf-8')
                        for linha in conteudo.split('\n'):
                            if linha.startswith('pack.name='):
                                valor = linha.split('=', 1)[1].strip()
                                if valor:
                                    return valor
                    except Exception:
                        pass

            # Fallback: primeiro texts/*.lang
            for nome_arquivo in zf.namelist():
                if nome_arquivo.startswith('texts/') and nome_arquivo.endswith('.lang'):
                    try:
                        conteudo = zf.read(nome_arquivo).decode('utf-8')
                        for linha in conteudo.split('\n'):
                            if linha.startswith('pack.name='):
                                valor = linha.split('=', 1)[1].strip()
                                if valor:
                                    return valor
                    except Exception:
                        pass
    except Exception:
        pass

    return None


def listar_addons_disponiveis(dir_addons):
    """Lista arquivos .mcpack/.mcaddon em /addons que não estão instalados."""
    disponíveis = []

    if not os.path.exists(dir_addons):
        return disponíveis

    for arquivo in os.listdir(dir_addons):
        if arquivo.endswith(('.mcpack', '.mcaddon')):
            caminho = os.path.join(dir_addons, arquivo)
            nome_real = resolver_nome_zip(caminho)
            nome_exibicao = nome_real if nome_real else arquivo
            disponíveis.append({
                'arquivo': arquivo,
                'nome': nome_exibicao,
                'caminho': caminho,
                'tamanho_mb': os.path.getsize(caminho) / (1024 * 1024)
            })

    return disponíveis


if __name__ == '__main__':
    # Teste simples
    print("Módulo instalador carregado OK")
