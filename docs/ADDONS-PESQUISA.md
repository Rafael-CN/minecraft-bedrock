# Pesquisa: Addons de Comandos Avançados e Explosivos (Pacote G)

Data: 2 de setembro de 2026  
Servidor: Minecraft Bedrock 1.26.45  
Objetivo: Avaliar addons para bomba nuclear via `/summon` e comandos avançados com valor agregado

---

## Tabela Comparativa

| Addon | Versão | Data Atualiz. | Compatível | RP Size | Experimento | Comando/Uso | Valor Agregado |
|-------|--------|---------------|-----------|---------|-------------|-------------|----------------|
| **Nuke clear Warhead** | 1.0 | 23/04/2026 | 26.3 | N/A (74 KB) | Não | Nametag com coords x,y,z | Simples, direto, sem overhead |
| **Atomic Destruction: Nuclear Bombs** | 26.30 | 31/07/2026 | 26.30 | 5.9 MB | Não | Detonador por item (4 tipos) | 4 nukes (Atomic, Thermo, Apocalypse, Doomsday) + visual/sons |
| **Thermonuclear Expansion** | 1.1.0 | 21/02/2026 | 26.0.02, 1.21 | N/A | Não | Crafting (Uranium → Plutonium) | Progressão realista, uranio + reator |
| **Nuclear Block** | 2.0 | 12/08/2026 | 26.30+ | 262 KB | Script API* | Right-click (empty hand) | Explosão 200-blocos, mushroom cloud cinemática |
| **Nikolais Orbital Strike Cannon V2** | 26.12 | 14/08/2026 | 26.12 | N/A | Beta APIs | Menu confirm (sem commands) | 5 armas (Nuke Shot, Stab, Wolf, Arrow, Wither) |
| **Bombs of Glory** | 26.30 | 13/07/2026 | 26.30 | N/A | Não | Crafting (Iron → Netherite Atom) | Weapons + Uranium ore, crafting variado |
| **Turbo Commands** | 1.1.28 | 08/08/2026 | 26.40+ | N/A | **Sim (Beta APIs)** | Item menu `/function sirob_turbo...` | Save/execute/repeat/delay comandos, 512K+ DLs |
| **Advance Command Block Addon** | 1.3.1 | 17/06/2026 | 26.30 | 17.6 KB | Não | Bloco interativo (10 comandos) | Store/repeat/chain, 9 cores, proteção op |
| **Java Essentials** | 1.4.1 | 21/03/2026 | 26.3 | N/A | Não | 20+ novos comandos | Controle voo, teams, world borders, item manip. |
| **Server UI: Warps, Kits & Homes** | Latest | 2026 | 1.21+ | N/A | **Scripts API** | UI menu interativo | Warps/Kits/Homes/Rules/Announcements all-in-one |
| **COMMAND CRAFT** | Latest | 2026 | Múltiplas | N/A | Scripts API | Chat commands (!, prefix) | Economy, homes, warps, kits, moderation, leaderboards |
| **Master Warps Core** | Latest | 2026 | Múltiplas | N/A | Scripts API | Compass/Clock/Stick ou `/scriptevent` | Warp system stável, pessoal + public |

*Script API: requer Beta APIs ou experimentos similares

---

## Análise por Categoria

### 1. **Nukes via `/summon` (Objetivo primário)**

#### ✅ Recomendado: **Atomic Destruction: Nuclear Bombs** (EL SANDO)
- **Por quê:** 4 tipos de bomba com progressão (Atomic → Doomsday), efeitos cinemáticos (mushroom cloud, shockwave, radiation), detonador por item (não comando), 26.30 compatível, **sem experimento**, 13.6K+ downloads, atualizado 31/07/2026
- **Como usar:** Place bomb → use remote detonator → massive explosion
- **Peso:** 5.9 MB (moderado para RP)
- **Risco:** Nenhum documentado; addon estável

#### ⚠️ Alternativa: **Nuclear Block V2**
- **Por quê:** Explosão devastadora (200-blocos), visual épico, direcionamento mais simples (right-click)
- **Desvantagem:** Requer Script API (possivelmente Beta APIs), atualizado recentemente (12/08/2026)
- **Como usar:** Place block → right-click empty hand → 10s countdown → detonation

#### ℹ️ Secundário: **Nuke clear Warhead**
- **Vantagem:** Ultra-simples (só nametag com coords), 74 KB, compatível 26.3
- **Desvantagem:** Sem customização, sem visual épico, menos intuitivo que detonador

#### ❌ Não recomendado:
- **Thermonuclear Expansion:** Crafting longo (Uranium → Refiner → Plutonium); melhor para progressão SMP que "bomba rápida"
- **Bombs of Glory:** Crafting intensivo, requer Netherite; não é summon, é crafting
- **Nikolais Orbital Strike Cannon:** Requer Beta APIs (experimento); 5 armas (overhead desnecessário para nuke)

---

### 2. **Comandos Avançados com Valor Real**

#### ✅ **Turbo Commands** (Execução de batch)
- **Versão:** 1.1.28+ (compatível 26.40+)
- **O que faz:** Item menu para executar/salvar/repetir/editar comandos; delay ajustável entre repeats
- **Valor:** Exatamente o que Pacote B (console) vai entregar, mas já existe
- **⚠️ Desvantagem:** **Requer Beta APIs** (experimento obrigatório)
- **Peso:** Não especificado (provavelmente pequeno)

#### ✅ **Advance Command Block Addon** (Bloco reutilizável)
- **Versão:** 1.3.1 (26.30)
- **O que faz:** Bloco interativo com 10 slots de comando, repeat/chain/run-count, proteção op
- **Valor:** Alternativa ao vanilla command block; 9 cores para organização; cooldown customizável
- **Vantagem:** Sem experimento, direto no mundo
- **Peso:** 17.6 KB (mínimo)

#### ⚠️ **Java Essentials** (Expansão de comandos)
- **Versão:** 1.4.1 (compatível 26.3)
- **O que faz:** 20+ novos comandos (voo, teams, borders, items)
- **Valor:** Complementa melhorias de comando, não substitui
- **Limite:** Comandos individuais, não batching

#### ❌ Não viável (requerem script complexo):
- **Server UI: Warps, Kits & Homes** — all-in-one, mas overkill para escopo Pacote D
- **COMMAND CRAFT** — economia + moderation, fora do escopo
- **Master Warps Core** — warp system, não comando avançado genérico

---

## Recomendação Final

### Para Pacote G (Pesquisa concluída):

**Instalar na bancada e testar:**
1. **Atomic Destruction: Nuclear Bombs** — **PRIMEIRO CANDIDATO** para bomba nuclear
   - Comando: Place `Atomic Bomb` block → use `Atomic Detonator`
   - Teste: Criar in creative, detonar, medir destruição (deverá ser > 200 blocos)
   - Esperado: ✅ Funcionar sem experimento

2. **Advance Command Block Addon** — **Comandos avançados de valor**
   - Teste: Colocar bloco, armazenar 3 comandos, executar, verificar repeat
   - Esperado: ✅ Rodar sem experimento, parecido com vanilla mas extensível

**Não instalar (fora de escopo ou bloqueados):**
- Thermonuclear Expansion (crafting longo, não summon direto)
- Turbo Commands (requer Beta APIs; Pacote B entrega equivalente sem addon)
- Nikolais Orbital Strike Cannon (experimento + overhead)

---

## Fontes de Download

| Addon | Fonte Principal | URL |
|-------|-----------------|-----|
| Atomic Destruction | CurseForge | https://www.curseforge.com/minecraft-bedrock/addons/atomic-destruction-nuclear-bombs-el-sando |
| | MCPEDL | https://mcpedl.com/atomic-destruction-nuclear-bombs-el-sando/ |
| Nuclear Block | CurseForge | https://www.curseforge.com/minecraft-bedrock/addons/nuclear-block |
| Advance Command Block | CurseForge | https://www.curseforge.com/minecraft-bedrock/addons/advance-command-block-addon |
| Turbo Commands | CurseForge | https://www.curseforge.com/minecraft-bedrock/addons/turbo-commands-cf |
| | MCPEDL | https://mcpedl.com/turbo-commands/ |
| Java Essentials | CurseForge | https://www.curseforge.com/minecraft-bedrock/addons/java-essentials |
| Nuke clear Warhead | CurseForge | https://www.curseforge.com/minecraft-bedrock/addons/nuke-clear-warhead |

---

## Observações Técnicas

1. **Tamanho de RP:** Atomic Destruction (5.9 MB) + Advance Command Block (17.6 KB) = ~6 MB total. O Xbox já carrega 123 MB de RP (servidor bom); impacto mínimo.

2. **Experimentos:** Nenhum dos recomendados requer experimento. Beta APIs é obrigatório só para Turbo Commands (descartado em favor do Pacote B).

3. **Compatibilidade 1.26.45:** Todos os recomendados foram testados em 26.30–26.40; versão 45 é patch minor, sem breaking changes esperados.

4. **Validação:** Requer teste prático em bancada com `/summon` e batch commands para confirmar efeitos visuais e magnitude de destruição.

---

## Próximas Etapas

- [ ] Instalar **Atomic Destruction** na bancada
- [ ] Craftar bombs, testar detonação, medir área destruída
- [ ] Instalar **Advance Command Block** na bancada
- [ ] Testar armazenamento e execução de batch de 3 comandos
- [ ] Se ambos passarem: recomendação final = Atomic Destruction + Advance Command Block
- [ ] Se falharem: fallback = Nuke clear Warhead + Java Essentials (menor overhead)
