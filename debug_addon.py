#!/usr/bin/env python3
import json

# Simular o que o app.py recebe
texto = '{"arquivo":"Connected_Glass.mcaddon","container":"mc-bedrock-teste"}'
dados = json.loads(texto)

arquivo = (dados.get("arquivo") or "").strip()
print(f"arquivo='{arquivo}'")
print(f"len={len(arquivo)}")
print(f"Termina com .mcaddon? {arquivo.endswith('.mcaddon')}")
print(f"Termina com (.mcpack, .mcaddon)? {arquivo.endswith(('.mcpack', '.mcaddon'))}")

# Testar com espaço
texto2 = '{"arquivo":"Naturalist Add-On 26.1.mcaddon","container":"mc-bedrock-teste"}'
dados2 = json.loads(texto2)
arquivo2 = (dados2.get("arquivo") or "").strip()
print(f"\narquivo2='{arquivo2}'")
print(f"Termina com .mcaddon? {arquivo2.endswith('.mcaddon')}")
