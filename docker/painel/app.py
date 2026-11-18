#!/usr/bin/env python3
"""
Painel do servidor Minecraft Bedrock.

Roda em container, fala com o Docker pelo socket montado, e serve uma
página local. Só biblioteca padrão de propósito: menos dependência para
manter, e a imagem fica pequena.

Segurança: NÃO tem autenticação. Por isso o compose publica a porta em
127.0.0.1 - o painel só existe para quem já está na máquina. Se um dia
for exposto na rede, precisa de senha antes.
"""
import calendar
import json
import os
import re
import shutil
import subprocess
import threading
import sys
import time
import zipfile
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# Importar instalador se disponível
try:
    from instalador import instalar_addon, remover_addon, listar_addons_instalados, listar_addons_disponiveis
    INSTALADOR_OK = True
except ImportError:
    INSTALADOR_OK = False

try:
    import catalogo as catalogo_mod
    CATALOGO_OK = True
except ImportError:
    CATALOGO_OK = False

try:
    from fluxo import Fluxo
    FLUXO_OK = True
except ImportError:
    FLUXO_OK = False

SERVIDOR = os.environ.get("SERVER_CONTAINER", "mc-bedrock")
BACKUP_CONTAINER = os.environ.get("BACKUP_CONTAINER", "mc-backup")
TESTE = os.environ.get("TEST_CONTAINER", "mc-bedrock-teste")
BACKUPS_DIR = "/backups"
RAIZ = os.path.dirname(os.path.abspath(__file__))
PORTA = int(os.environ.get("PANEL_PORT", "8080"))

# Comandos que o painel se recusa a mandar: derrubam o servidor por vias
# tortas ou apagam mundo. Parar o servidor tem botão próprio, que avisa.
COMANDOS_BLOQUEADOS = {"stop", "shutdown"}

# Cache de jogadores online (30 s)
_cache_online = {"nomes": [], "ts": 0}

# O log do servidor lido continuamente, numa conexao so. Enquanto ele
# estiver de pe, nenhuma rota precisa chamar "docker logs" nem dormir
# esperando resposta - tudo ja esta em memoria no instante em que o
# servidor escreve. Se faltar, cada rota volta ao jeito antigo sozinha.
FLUXO = Fluxo(SERVIDOR) if FLUXO_OK else None


def etiqueta_nova():
    """Marca curta para casar um comando com a resposta dele no log."""
    return os.urandom(3).hex()


AREA_DE_FOCO = "casa_foco"


def com_pedaco_carregado(pedido, fazer):
    """Garante que o mundo existe no lugar pedido antes de mexer nele.

    Um ponto do mapa longe de todo mundo simplesmente nao esta na memoria
    do servidor: medir o terreno, invocar ou explodir ali devolve "not in
    a chunk currently loaded". A saida vanilla e uma area de tick, que faz
    o servidor manter aquele pedaco vivo.

    Por que aqui e nao no addon: o comando tickingarea exige permissao de
    console, e o script do mundo nao tem. O painel tem - ele fala pelo
    console do servidor.

    A area e sempre a mesma e sai no fim, entao nao acumula nem estoura o
    limite de dez areas do mundo.
    """
    x = pedido.get("x")
    z = pedido.get("z")
    if x is None or z is None:
        return fazer()

    enviar_comando("tickingarea", "remove", AREA_DE_FOCO, timeout=10)
    enviar_comando(
        "tickingarea", "add", "circle", str(int(x)), "64", str(int(z)), "2", AREA_DE_FOCO,
        timeout=15,
    )

    # Trazer um pedaco do mundo do disco leva de um a tres segundos - foi
    # medido. Mas quase sempre o lugar ja esta carregado (alguem por
    # perto), e ai esperar seria desperdicio. Entao a gente tenta logo e
    # so insiste quando o servidor reclama que o mundo nao esta ali.
    try:
        # As duas formas de o servidor dizer "o mundo nao esta aqui": a
        # mensagem crua do jogo e a que o addon escreve depois de tentar
        # medir o terreno algumas vezes. Procurar so a primeira fazia o
        # painel desistir sem nunca insistir.
        frio = ("not in a chunk", "nao carregou esse pedaco")

        resultado = fazer()
        texto = resultado[1] if isinstance(resultado, tuple) else str(resultado)
        if not any(f in texto for f in frio):
            return resultado

        # Mundo frio: trazer o pedaco do disco leva ate tres segundos, e
        # so entao adianta perguntar de novo.
        time.sleep(3.0)
        resultado = fazer()
        texto = resultado[1] if isinstance(resultado, tuple) else str(resultado)
        if not any(f in texto for f in frio):
            return resultado

        time.sleep(3.0)
        return fazer()
    finally:
        enviar_comando("tickingarea", "remove", AREA_DE_FOCO, timeout=10)


def falar_com_o_mundo(evento, pedido, prazo_s=5.0):
    """Manda um scriptevent para o addon da casa e espera a resposta dele.

    Cada pedido leva uma etiqueta. O addon devolve essa mesma etiqueta na
    linha que escreve, e o fluxo acorda quem estava esperando exatamente
    aquela resposta. Antes disto o painel dormia 1,6 s e depois vasculhava
    o log torcendo para achar a linha certa - o que dava errado sempre que
    dois comandos saiam juntos.

    Devolve (ok, texto).
    """
    etiqueta = etiqueta_nova()
    corpo = json.dumps({**pedido, "id": etiqueta}, separators=(",", ":"))

    if not FLUXO or not FLUXO.conectado:
        ok, _ = enviar_comando("scriptevent", evento, corpo, timeout=25)
        if not ok:
            return False, "nao consegui falar com o servidor"
        time.sleep(1.6)
        _, log = docker("logs", SERVIDOR, "--since", "4s", timeout=15)
        linhas = [
            re.sub(r"^\[[^\]]*\]\s*", "", l).strip()
            for l in log.splitlines()
            if etiqueta in l
        ]
        return True, chr(10).join(linhas[-4:]) or "(o script nao respondeu no log)"

    ok, _ = enviar_comando("scriptevent", evento, corpo, timeout=25)
    if not ok:
        return False, "nao consegui falar com o servidor"

    linhas = FLUXO.esperar_resposta(etiqueta, prazo_s)
    if not linhas:
        return True, "(o script nao respondeu a tempo)"
    limpas = [re.sub(r"^\[[^\]]*\]\s*", "", l).strip() for l in linhas]
    return True, chr(10).join(limpas[-4:])


def docker(*args, timeout=30):
    """Roda o cliente docker e devolve (ok, saída)."""
    try:
        r = subprocess.run(
            ["docker", *args],
            capture_output=True, text=True, timeout=timeout,
        )
        saida = (r.stdout or "") + (r.stderr or "")
        return r.returncode == 0, saida.strip()
    except subprocess.TimeoutExpired:
        return False, "o comando demorou demais e foi cancelado"
    except Exception as e:  # noqa: BLE001
        return False, f"falhou: {e}"


# O send-command escreve direto no stdin do servidor. Duas escritas ao
# mesmo tempo se ENTRELAÇAM no meio da linha: em 03/09 um "tp ... -130 7"
# colou com "- 141" e o servidor recebeu um "7-" que não existia em
# comando nenhum. Com o painel atendendo em varias threads e mandando
# lotes em rajada, isso deixou de ser raro. Uma fila resolve: o stdin do
# servidor recebe um comando por vez, sempre inteiro.
_fila_do_stdin = threading.Lock()


def enviar_comando(*partes, timeout=20):
    """Manda um comando ao servidor, um de cada vez."""
    with _fila_do_stdin:
        return docker("exec", SERVIDOR, "send-command", *partes, timeout=timeout)


def estado_container(nome):
    ok, saida = docker(
        "inspect", nome,
        "--format",
        "{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}"
        "|{{.State.StartedAt}}|{{.State.ExitCode}}",
    )
    if not ok:
        return {"existe": False, "status": "ausente", "saude": "none"}
    partes = saida.split("|")
    return {
        "existe": True,
        "status": partes[0],
        "saude": partes[1] if len(partes) > 1 else "none",
        "desde": partes[2] if len(partes) > 2 else "",
        "exit": partes[3] if len(partes) > 3 else "",
    }


def recursos(nome):
    ok, saida = docker(
        "stats", nome, "--no-stream",
        "--format", "{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}",
        timeout=20,
    )
    if not ok or "|" not in saida:
        return {"cpu": None, "mem": None, "mem_pct": None}
    cpu, mem, mem_pct = saida.split("|")[:3]
    return {"cpu": cpu.strip(), "mem": mem.strip(), "mem_pct": mem_pct.strip()}


def jogadores():
    ok, saida = docker(
        "exec", SERVIDOR, "mc-monitor", "status-bedrock", "--host", "127.0.0.1",
        timeout=20,
    )
    if not ok:
        return {"online": None, "max": None, "versao": None, "responde": False}
    m = re.search(r"version=(\S+)\s+online=(\d+)\s+max=(\d+)", saida)
    if not m:
        return {"online": None, "max": None, "versao": None, "responde": False}
    return {
        "versao": m.group(1),
        "online": int(m.group(2)),
        "max": int(m.group(3)),
        "responde": True,
    }


def quem_esta_online():
    """Quem esta no mundo agora.

    A fonte boa e a propria posicao: o addon manda a de cada jogador quatro
    vezes por segundo, entao quem tem posicao fresca esta jogando, ponto.
    Isso responde na hora e nao gasta um comando.

    O comando list fica como reserva para quando o addon nao estiver
    respondendo - sem ele o painel diria "ninguem online" so porque o
    script morreu, o que confundiria muito mais do que ajudaria.
    """
    global _cache_online
    agora = time.time()

    if FLUXO and FLUXO.conectado:
        pelas_posicoes = FLUXO.quem_esta_no_mundo()
        if pelas_posicoes:
            _cache_online = {"nomes": pelas_posicoes, "ts": agora}
            return pelas_posicoes

    if agora - _cache_online.get("ts", 0) < 5:
        return _cache_online.get("nomes", [])

    marco = time.time()
    ok, _ = enviar_comando("list", timeout=15)
    if not ok:
        return _cache_online.get("nomes", [])

    nomes = []
    if FLUXO and FLUXO.conectado:
        # Sem dormir: o log chega em tempo real, entao basta esperar a linha
        # da resposta - o que costuma levar menos de 200 ms.
        par = FLUXO.esperar_par(r"There are (\d+)/\d+ players online", marco, prazo_s=3.0)
        if par:
            contagem, seguinte = par
            if contagem == "0":
                _cache_online = {"nomes": [], "ts": agora}
                return []
            if seguinte:
                limpa = re.sub(r"^\[[^\]]*\]\s*", "", seguinte).strip()
                nomes = [n.strip() for n in limpa.split(",") if n.strip()]
    else:
        time.sleep(1.2)
        _, log = docker("logs", SERVIDOR, "--since", "5s", timeout=15)
        linhas = log.splitlines()
        for i, l in enumerate(linhas):
            if "players online" in l and i + 1 < len(linhas):
                limpa = re.sub(r"^\[[^\]]*\]\s*", "", linhas[i + 1]).strip()
                if limpa and "players online" not in limpa:
                    nomes = [n.strip() for n in limpa.split(",") if n.strip()]

    _cache_online = {"nomes": nomes, "ts": agora}
    return nomes


def lista_backups():
    itens = []
    try:
        for nome in sorted(os.listdir(BACKUPS_DIR), reverse=True):
            if not nome.endswith(".mcworld"):
                continue
            caminho = os.path.join(BACKUPS_DIR, nome)
            st = os.stat(caminho)
            itens.append({
                "nome": nome,
                "mb": round(st.st_size / (1024 * 1024), 1),
                "quando": time.strftime("%d/%m/%Y %H:%M", time.localtime(st.st_mtime)),
                "ts": st.st_mtime,
            })
    except FileNotFoundError:
        pass
    itens.sort(key=lambda x: x["ts"], reverse=True)
    return itens


def cron_para_horas(cron_texto):
    """Estimativa grosseira de a cada quanto tempo um cron roda.

    So serve para a aba Saude avisar quando um backup diario esta
    atrasado - nao e um parser de cron de verdade. Cobre os dois formatos
    que o .env de fato usa ("M H * * *", um horario fixo por dia, e
    "*/N * * * *"/"*/N H * * *") e cai em 24h para qualquer outro caso,
    que e o palpite mais seguro (evita gritar "atrasado" por engano).
    """
    partes = (cron_texto or "").split()
    if len(partes) != 5:
        return 24.0
    minuto, hora, dia, mes, semana = partes
    if dia != "*" or mes != "*" or semana != "*":
        return 24.0
    if minuto.startswith("*/") and hora == "*":
        try:
            return max(0.25, int(minuto[2:]) / 60)
        except ValueError:
            return 24.0
    if hora.startswith("*/"):
        try:
            return max(1.0, float(hora[2:]))
        except ValueError:
            return 24.0
    return 24.0  # "M H * * *" - um horario fixo, uma vez por dia


def montar_status():
    servidor = estado_container(SERVIDOR)
    dados = {
        "servidor": servidor,
        "recursos": recursos(SERVIDOR) if servidor["status"] == "running" else {},
        "jogadores": jogadores() if servidor["status"] == "running" else {"responde": False},
        "backup": estado_container(BACKUP_CONTAINER),
        "teste": estado_container(TESTE),
        "backups": lista_backups(),
        "agora": time.strftime("%H:%M:%S"),
        # O painel desenha o mapa num iframe. Ele roda noutro container, em
        # outra porta do mesmo host - e so o compose sabe qual e. Sem isso o
        # navegador teria que chutar 8081 e quebraria se MAP_PORT mudasse.
        "mapa_porta": os.environ.get("MAP_PORT", "8081"),
        # A aba Saude usa isto para saber se o ultimo backup passou do
        # prazo - sem virar um parser de cron completo.
        "backup_prazo_horas": cron_para_horas(os.environ.get("BACKUP_CRON", "0 5 * * *")),
    }
    return dados


# --------------------------------------------------------- render do mapa
# O render sob demanda (aba Mundo) precisa devolver a resposta na hora -
# render.sh leva minutos - entao ele roda numa thread solta e o estado fica
# aqui, para a rota de status contar o que esta acontecendo sem bloquear.
#
# Importante: "docker exec" NAO aparece em "docker logs" do container - só
# o que o PID 1 escreve (aqui, o cron) vai para lá. É por isso que o cron
# do entrypoint redireciona explicitamente para /proc/1/fd/1. Sem fazer o
# mesmo aqui, um render disparado por este botão terminava de verdade mas
# a sondagem de progresso nunca via uma linha sequer dele - só continuava
# lendo o render antigo do cron. O "tee" abaixo resolve os dois lados:
# alimenta o progresso ao vivo (lido direto do pipe) e ainda deixa rastro
# em "docker logs" (para sobreviver a um restart do painel no meio).
MAPA_RENDER_CONTAINER = os.environ.get("MAP_RENDER_CONTAINER", "mc-mapa-render")
_render_mapa = {
    "rodando": False, "iniciado": 0.0, "concluido": 0.0,
    "camadas": {}, "pronto_ts": None, "ultima_linha": "",
}
_render_mapa_trava = threading.Lock()


def _rodar_render_mapa():
    global _render_mapa
    with _render_mapa_trava:
        _render_mapa["camadas"] = {}
    try:
        processo = subprocess.Popen(
            ["docker", "exec", MAPA_RENDER_CONTAINER, "sh", "-c",
             "/usr/local/bin/render.sh 2>&1 | tee /proc/1/fd/1"],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1,
        )
        for linha in processo.stdout:
            linha = linha.rstrip("\n")
            m = re.search(r"camada '([^']+)' \(([^)]*)\)", linha)
            with _render_mapa_trava:
                if m:
                    _render_mapa["camadas"][m.group(1)] = m.group(2)
                if "mapa pronto" in linha:
                    _render_mapa["ultima_linha"] = linha.strip()
                    _render_mapa["pronto_ts"] = time.time()
        processo.wait(timeout=600)
    except Exception:  # noqa: BLE001 - render.sh que falhe nao pode travar a thread
        pass
    finally:
        with _render_mapa_trava:
            _render_mapa["rodando"] = False
            _render_mapa["concluido"] = time.time()


def status_do_render_mapa():
    """O que a aba Mundo mostra: se esta rodando, quais camadas ja saíram
    nesta passada, e quando foi a ultima vez que terminou.

    A fonte boa e a propria memoria, alimentada ao vivo por quem disparou
    o render por aqui. Só cai para "docker logs" (mais lento, e as vezes
    de um render antigo do cron) quando esta vida do painel ainda não viu
    nenhum - por exemplo, logo depois de reiniciar o container.
    """
    with _render_mapa_trava:
        rodando = _render_mapa["rodando"]
        iniciado = _render_mapa["iniciado"] or None
        camadas = dict(_render_mapa["camadas"])
        pronto_ts = _render_mapa["pronto_ts"]
        ultima_linha = _render_mapa["ultima_linha"]

    if pronto_ts is None and not camadas:
        ok, saida = docker("logs", MAPA_RENDER_CONTAINER, "--tail", "150", "--timestamps", timeout=15)
        if ok:
            for linha in saida.splitlines():
                m = re.search(r"camada '([^']+)' \(([^)]*)\)", linha)
                if m:
                    camadas[m.group(1)] = m.group(2)
                if "mapa pronto" in linha:
                    ultima_linha = linha.strip()
                    carimbo = linha.split(" ", 1)[0]
                    try:
                        pronto_ts = calendar.timegm(time.strptime(carimbo[:19], "%Y-%m-%dT%H:%M:%S"))
                    except ValueError:
                        pass

    return {
        "ok": True,
        "rodando": rodando,
        "iniciado": iniciado,
        "camadas": [{"id": k, "rotulo": v or k} for k, v in camadas.items()],
        "pronto_ts": pronto_ts,
        "ultima_linha": ultima_linha,
    }


# ---------------------------------------------------------------- dono
# O painel roda como root para poder usar o socket do docker. Tudo que ele
# escreve dentro do mundo nasce como root - e o servidor Bedrock roda como
# o dono do mount (uid 1000). Em 02/09/2026 a bancada ficou com 37.300
# arquivos de root e o servidor caiu com "Failed to open LevelDB:
# Permission denied". Qualquer rota que escreve passa por aqui no fim.
ROTAS_QUE_ESCREVEM = (
    "/api/addons/instalar", "/api/addons/remover",
    "/api/mundos/restaurar", "/api/mundos/criar", "/api/mundos/trocar",
)


def ajustar_dono(*raizes):
    """Devolve tudo abaixo de cada raiz ao uid:gid do mount de /data."""
    try:
        st = os.stat("/data")
    except FileNotFoundError:
        return
    uid, gid = st.st_uid, st.st_gid
    if uid == 0:
        return  # mount pertence a root: nada a corrigir
    for raiz in raizes:
        if not os.path.isdir(raiz):
            continue
        for base, dirs, files in os.walk(raiz):
            for n in dirs + files:
                caminho = os.path.join(base, n)
                try:
                    if os.lstat(caminho).st_uid != uid:
                        os.lchown(caminho, uid, gid)
                except OSError:
                    pass
        try:
            os.lchown(raiz, uid, gid)
        except OSError:
            pass


class Painel(BaseHTTPRequestHandler):
    server_version = "PainelBedrock/1.0"

    def log_message(self, fmt, *args):  # silencia o log de acesso
        pass

    # ---------------------------------------------------------- utilidades
    def responder(self, corpo, tipo="application/json", codigo=200, cache="no-store"):
        if isinstance(corpo, (dict, list)):
            corpo = json.dumps(corpo, ensure_ascii=False)
        if isinstance(corpo, str):
            corpo = corpo.encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", f"{tipo}; charset=utf-8")
        self.send_header("Content-Length", str(len(corpo)))
        self.send_header("Cache-Control", cache)
        self.end_headers()
        self.wfile.write(corpo)

    def corpo_json(self):
        tam = int(self.headers.get("Content-Length") or 0)
        if not tam:
            return {}
        try:
            corpo_bruto = self.rfile.read(tam)
            # Remover BOM se presente
            if corpo_bruto.startswith(b'\xef\xbb\xbf'):
                corpo_bruto = corpo_bruto[3:]
            return json.loads(corpo_bruto.decode("utf-8"))
        except Exception:  # noqa: BLE001
            return {}

    # ---------------------------------------------------------------- GET
    def do_GET(self):
        rota = urlparse(self.path)
        caminho = rota.path

        if caminho in ("/", "/index.html"):
            try:
                with open(os.path.join(RAIZ, "index.html"), "rb") as f:
                    return self.responder(f.read(), "text/html", cache="no-cache")
            except FileNotFoundError:
                return self.responder("index.html nao encontrado", "text/plain", 500)

        # CSS e JS do painel vivem em arquivos proprios agora (etapa 1 da
        # revisao de interface: um HTML de 3700 linhas nao se mantem). O
        # navegador ainda deve buscar a versao nova a cada carga - dai
        # no-cache em vez de deixar o padrao do servidor de arquivos, que
        # aqui nem existe: e tudo lido e servido a mao.
        if caminho == "/painel.css":
            try:
                with open(os.path.join(RAIZ, "painel.css"), "rb") as f:
                    return self.responder(f.read(), "text/css", cache="no-cache")
            except FileNotFoundError:
                return self.responder("painel.css nao encontrado", "text/plain", 500)

        if caminho == "/painel.js":
            try:
                with open(os.path.join(RAIZ, "painel.js"), "rb") as f:
                    return self.responder(f.read(), "text/javascript", cache="no-cache")
            except FileNotFoundError:
                return self.responder("painel.js nao encontrado", "text/plain", 500)

        if caminho == "/api/status":
            return self.responder(montar_status())

        if caminho == "/api/logs":
            n = parse_qs(rota.query).get("n", ["200"])[0]
            try:
                n = min(max(int(n), 10), 1000)
            except ValueError:
                n = 200
            if FLUXO and FLUXO.conectado:
                linhas = [
                    l for l in FLUXO.log(n + 60)
                    # O "list" que o painel dispara sozinho a cada consulta
                    # sujaria o log com contagem de jogador a cada segundos.
                    if "players online" not in l
                ]
                return self.responder({"ok": True, "texto": chr(10).join(linhas[-n:])})
            alvo = parse_qs(rota.query).get("c", [SERVIDOR])[0]
            alvo = alvo if alvo in (SERVIDOR, TESTE, BACKUP_CONTAINER) else SERVIDOR
            ok, saida = docker("logs", alvo, "--tail", str(n), timeout=25)
            return self.responder({"ok": ok, "texto": saida})

        if caminho == "/api/online":
            # Retorna jogadores online, removendo o ruído do comando "list"
            nomes = quem_esta_online()
            return self.responder({"nomes": nomes})

        if caminho == "/api/pos":
            # Direto da memoria: o fluxo recebe cada POS| no instante em que
            # o mundo escreve. Antes esta rota gastava um "docker logs" por
            # chamada e mostrava posicao de ate 20 s atras.
            if FLUXO:
                return self.responder({"ok": True, "posicoes": FLUXO.posicoes_vivas()})
            return self.responder({"ok": False, "posicoes": {}})

        if caminho == "/api/mobs":
            # As criaturas que a varredura do mundo viu perto de quem esta
            # jogando. Envelhece rapido de proposito: mob parado ha dez
            # segundos e mob que provavelmente ja saiu dali.
            if not FLUXO:
                return self.responder({"ok": True, "mobs": []})
            with FLUXO._trava:
                mobs = list(FLUXO.mobs)
                visto_em = FLUXO.mobs_ts
            if not visto_em:
                # Nunca chegou varredura nenhuma. Acontece quando nao ha
                # ninguem no mundo: o script so varre perto de quem joga.
                return self.responder({"ok": True, "mobs": [], "idade_s": None})
            idade = time.time() - visto_em
            return self.responder({
                "ok": True,
                "mobs": mobs if idade < 10 else [],
                "idade_s": round(idade, 1),
            })

        if caminho == "/api/eventos":
            horas = parse_qs(rota.query).get("horas", ["24"])[0]
            try:
                horas = max(1, min(168, int(horas)))
            except ValueError:
                horas = 24
            if FLUXO:
                return self.responder({"ok": True, "eventos": FLUXO.ultimos_eventos(horas)})
            return self.responder({"ok": False, "eventos": []})

        if caminho == "/api/placar":
            if not FLUXO:
                return self.responder({"ok": False, "placar": []})
            bruto = dict(FLUXO.placar)
            ranking = sorted(bruto.items(), key=lambda x: x[1]["segundos"], reverse=True)
            return self.responder({
                "ok": True,
                "placar": [{"nome": n, **d} for n, d in ranking],
            })

        if caminho == "/api/addons/instalados":
            if not INSTALADOR_OK:
                return self.responder({"erro": "instalador nao disponivel"}, codigo=500)
            try:
                # Obter level-name
                data_path = "/data"
                sp_path = os.path.join(data_path, "server.properties")
                level_name = None
                if os.path.exists(sp_path):
                    with open(sp_path, 'r') as f:
                        for line in f:
                            if line.startswith('level-name='):
                                level_name = line.split('=', 1)[1].strip()
                                break
                if not level_name:
                    return self.responder({"ok": False, "erro": "level-name nao definido"}, codigo=400)
                mundo_path = os.path.join(data_path, "worlds", level_name)
                addons = listar_addons_instalados(mundo_path)
                return self.responder({"ok": True, "addons": addons})
            except Exception as e:
                return self.responder({"ok": False, "erro": str(e)}, codigo=500)

        if caminho == "/api/addons/disponiveis":
            if not INSTALADOR_OK:
                return self.responder({"erro": "instalador nao disponivel"}, codigo=500)
            try:
                addons_dir = "/addons"
                disponiveis = listar_addons_disponiveis(addons_dir)
                return self.responder({"ok": True, "addons": disponiveis})
            except Exception as e:
                return self.responder({"ok": False, "erro": str(e)}, codigo=500)

        if caminho == "/api/catalogo":
            # Tudo que existe para invocar, dar ou encantar - lido dos packs
            # do proprio mundo, entao inclui os bichos e itens dos addons.
            if not CATALOGO_OK:
                return self.responder({"ok": False, "erro": "catalogo indisponivel"}, codigo=500)
            forcar = parse_qs(rota.query).get("refresh", ["0"])[0] == "1"
            try:
                return self.responder({"ok": True, **catalogo_mod.obter("/data", forcar)})
            except Exception as e:
                return self.responder({"ok": False, "erro": str(e)}, codigo=500)

        if caminho == "/api/mundo":
            # Hora, clima e gamerules como estao AGORA. O painel usa isso
            # para os controles mostrarem o estado em vez de so mandarem
            # comando no escuro - um botao "Cair a noite" que nao sabe que
            # noite ja e nao ajuda ninguem.
            #
            # Nao da para perguntar isso pelo console: "weather query" nao
            # existe no Bedrock. Quem sabe e a Script API, entao a pergunta
            # vai pelo addon da casa e volta pela mesma etiqueta dos outros.
            ok, saida = falar_com_o_mundo("casa:mundo", {}, prazo_s=4.0)
            if not ok:
                return self.responder({"ok": False, "erro": saida}, codigo=502)

            linha = next((l for l in saida.splitlines() if "MUNDO|ok" in l), "")
            if not linha:
                return self.responder({"ok": False, "erro": "o mundo nao respondeu", "cru": saida})

            campos = linha[linha.index("MUNDO|ok"):].split("|")
            dados = {"ok": True, "hora": None, "clima": "desconhecido", "regras": {}}
            for campo in campos[2:]:
                if campo.startswith("hora="):
                    try:
                        h = int(campo[5:])
                        dados["hora"] = h if h >= 0 else None
                    except ValueError:
                        pass
                elif campo.startswith("clima="):
                    dados["clima"] = campo[6:]
                elif "=" in campo and not campo.startswith("#"):
                    # O bloco das regras vem junto, separado por virgula.
                    for par in campo.split(","):
                        if "=" in par:
                            nome, valor = par.split("=", 1)
                            dados["regras"][nome.strip()] = valor.strip() == "true"
            return self.responder(dados)

        if caminho == "/api/mundos/listar":
            container = parse_qs(rota.query).get("container", [SERVIDOR])[0]
            data_base = "/data" if container == SERVIDOR else "/data-teste"
            mundos = []
            try:
                worlds_dir = os.path.join(data_base, "worlds")
                if os.path.exists(worlds_dir):
                    for pasta in os.listdir(worlds_dir):
                        caminho_mundo = os.path.join(worlds_dir, pasta)
                        if os.path.isdir(caminho_mundo) and os.path.exists(os.path.join(caminho_mundo, "level.dat")):
                            mundos.append(pasta)
                mundos.sort()
            except Exception:
                pass
            return self.responder({"ok": True, "mundos": mundos})

        if caminho == "/api/mapa/status":
            # A aba Mundo usa isto tanto para "redesenhado ha X" (pronto_ts)
            # quanto para o progresso ao vivo (camadas) enquanto um render
            # esta rodando - a mesma rota serve os dois momentos.
            return self.responder(status_do_render_mapa())

        return self.responder({"erro": "rota desconhecida"}, codigo=404)

    # --------------------------------------------------------------- POST

    def do_POST(self):
        caminho = urlparse(self.path).path
        if caminho not in ROTAS_QUE_ESCREVEM:
            return self._do_POST_impl()

        # Rotas que escrevem no mundo: a resposta e ADIADA ate o dono dos
        # arquivos estar ajustado. Sem isso o "ok" chega ao navegador antes
        # do chown terminar, e quem conferir na hora ve arquivos de root -
        # foi assim que a primeira verificacao pegou 217 arquivos "errados"
        # que estavam sendo corrigidos naquele segundo.
        pendente = {}
        original = self.responder

        def adiado(corpo, tipo="application/json", codigo=200):
            pendente.update(corpo=corpo, tipo=tipo, codigo=codigo)

        self.responder = adiado
        try:
            self._do_POST_impl()
        finally:
            self.responder = original
            # Mesmo que a rota falhe no meio, o que ja foi escrito volta ao
            # dono certo - senao o servidor nao abre o proprio mundo.
            ajustar_dono("/data/worlds", "/data-teste", "/backups")
            if pendente:
                original(pendente["corpo"], pendente["tipo"], pendente["codigo"])

    def _do_POST_impl(self):
        caminho = urlparse(self.path).path
        dados = self.corpo_json()

        if caminho == "/api/comando":
            # Aceita um comando ou uma lista deles.
            #
            # A versao antiga dormia 1,2 s DEPOIS DE CADA comando para o
            # log alcancar a resposta: mandar dez comandos custava doze
            # segundos. Agora o log chega em tempo real, entao basta marcar
            # o instante do envio e recolher o que o servidor escreveu.
            cmd = (dados.get("cmd") or "").strip()
            cmds = dados.get("cmds") or ([cmd] if cmd else [])
            intervalo_ms = dados.get("intervalo_ms")

            if not cmds:
                return self.responder({"ok": False, "saida": "comando vazio"})
            if len(cmds) > 512:
                return self.responder({"ok": False, "saida": "no maximo 512 de uma vez"})

            for c in cmds:
                if not c.strip():
                    return self.responder({"ok": False, "saida": "comando vazio na lista"})
                if c.split()[0].lower() in COMANDOS_BLOQUEADOS:
                    return self.responder({
                        "ok": False,
                        "saida": "esse comando derruba o servidor. Use o botao Desligar, "
                                 "que espera o mundo ser salvo.",
                    })

            marco = time.time()
            falhas = 0
            for i, c in enumerate(cmds):
                ok, _ = enviar_comando(*c.split(), timeout=20)
                if not ok:
                    falhas += 1
                # Sem intervalo pedido, os comandos saem em rajada - e o que
                # faz "mandar 64 vezes" parecer instantaneo em vez de fila.
                if intervalo_ms and i + 1 < len(cmds):
                    time.sleep(min(5.0, max(0, int(intervalo_ms)) / 1000))

            if FLUXO and FLUXO.conectado:
                # Uma pausa curta so para a ultima resposta alcancar o log.
                time.sleep(0.25)
                linhas = FLUXO.saida_recente(marco, quantas=20)
                saida = chr(10).join(linhas) or "(sem resposta)"
            else:
                time.sleep(1.2)
                ok2, log = docker("logs", SERVIDOR, "--since", "5s", timeout=15)
                saida = log if ok2 else "(sem resposta)"

            if falhas:
                saida = f"[{falhas} de {len(cmds)} nao foram enviados]" + chr(10) + saida
            return self.responder({"ok": falhas == 0, "saida": saida})

        if caminho == "/api/power":
            acao = (dados.get("acao") or "").strip()
            alvo = dados.get("alvo") or SERVIDOR
            if alvo not in (SERVIDOR, TESTE):
                return self.responder({"ok": False, "saida": "container invalido"})
            if acao == "start":
                ok, saida = docker("start", alvo, timeout=60)
            elif acao == "stop":
                # -t 120 casa com o stop_grace_period: o mundo precisa
                # desse tempo para ser gravado antes do processo morrer.
                ok, saida = docker("stop", "-t", "120", alvo, timeout=180)
            elif acao == "restart":
                ok, saida = docker("restart", "-t", "120", alvo, timeout=240)
            else:
                return self.responder({"ok": False, "saida": "acao invalida"})
            return self.responder({"ok": ok, "saida": saida or "pronto"})

        if caminho == "/api/backup":
            ok, saida = docker(
                "exec", BACKUP_CONTAINER, "/usr/local/bin/backup.sh", timeout=900
            )
            return self.responder({"ok": ok, "saida": saida})

        if caminho == "/api/mapa/render":
            # Roda em thread solta: render.sh leva minutos e a aba Mundo nao
            # pode ficar travada esperando. A resposta so diz que comecou -
            # o progresso de verdade vem de /api/mapa/status, por sondagem.
            with _render_mapa_trava:
                ja_rodando = _render_mapa["rodando"]
                if not ja_rodando:
                    _render_mapa["rodando"] = True
                    _render_mapa["iniciado"] = time.time()
            if ja_rodando:
                return self.responder({"ok": True, "saida": "ja_rodando"})
            threading.Thread(target=_rodar_render_mapa, daemon=True).start()
            return self.responder({"ok": True, "saida": "iniciado"})

        if caminho == "/api/addons/instalar":
            if not INSTALADOR_OK:
                return self.responder({"ok": False, "erro": "instalador nao disponivel"}, codigo=500)
            arquivo = (dados.get("arquivo") or "").strip()
            container = (dados.get("container") or SERVIDOR).strip()
            if container not in (SERVIDOR, TESTE):
                return self.responder({"ok": False, "erro": "container invalido"}, codigo=400)
            if not arquivo or not arquivo.endswith(('.mcpack', '.mcaddon')):
                return self.responder({"ok": False, "erro": "arquivo invalido"}, codigo=400)
            try:
                caminho_addon = os.path.join("/addons", arquivo)
                if not os.path.exists(caminho_addon):
                    return self.responder({"ok": False, "erro": "arquivo nao encontrado"}, codigo=404)
                # Obter level-name para o container alvo
                data_base = "/data" if container == SERVIDOR else "/data-teste"
                sp_path = os.path.join(data_base, "server.properties")
                level_name = None
                if os.path.exists(sp_path):
                    with open(sp_path, 'r') as f:
                        for line in f:
                            if line.startswith('level-name='):
                                level_name = line.split('=', 1)[1].strip()
                                break
                if not level_name:
                    return self.responder({"ok": False, "erro": "level-name nao definido"}, codigo=400)
                mundo_path = os.path.join(data_base, "worlds", level_name)
                ok, msg = instalar_addon(caminho_addon, mundo_path)
                if ok:
                    # Reiniciar container
                    docker("restart", "-t", "120", container, timeout=180)
                    return self.responder({"ok": True, "saida": msg + "\nContainer reiniciado"})
                else:
                    return self.responder({"ok": False, "saida": msg}, codigo=500)
            except Exception as e:
                return self.responder({"ok": False, "erro": str(e)}, codigo=500)

        if caminho == "/api/addons/remover":
            if not INSTALADOR_OK:
                return self.responder({"ok": False, "erro": "instalador nao disponivel"}, codigo=500)
            pack_uuid = (dados.get("uuid") or "").strip()
            container = (dados.get("container") or SERVIDOR).strip()
            if container not in (SERVIDOR, TESTE):
                return self.responder({"ok": False, "erro": "container invalido"}, codigo=400)
            if not pack_uuid:
                return self.responder({"ok": False, "erro": "uuid necessario"}, codigo=400)
            try:
                # Obter level-name
                data_base = "/data" if container == SERVIDOR else "/data-teste"
                sp_path = os.path.join(data_base, "server.properties")
                level_name = None
                if os.path.exists(sp_path):
                    with open(sp_path, 'r') as f:
                        for line in f:
                            if line.startswith('level-name='):
                                level_name = line.split('=', 1)[1].strip()
                                break
                if not level_name:
                    return self.responder({"ok": False, "erro": "level-name nao definido"}, codigo=400)
                mundo_path = os.path.join(data_base, "worlds", level_name)
                ok, msg = remover_addon(pack_uuid, mundo_path)
                if ok:
                    docker("restart", "-t", "120", container, timeout=180)
                    return self.responder({"ok": True, "saida": msg + "\nContainer reiniciado"})
                else:
                    return self.responder({"ok": False, "saida": msg}, codigo=500)
            except Exception as e:
                return self.responder({"ok": False, "erro": str(e)}, codigo=500)

        if caminho == "/api/mundos/listar":
            container = (dados.get("container") or SERVIDOR).strip()
            data_base = "/data" if container == SERVIDOR else "/data-teste"
            mundos = []
            try:
                worlds_dir = os.path.join(data_base, "worlds")
                if os.path.exists(worlds_dir):
                    for pasta in os.listdir(worlds_dir):
                        caminho_mundo = os.path.join(worlds_dir, pasta)
                        if os.path.isdir(caminho_mundo) and os.path.exists(os.path.join(caminho_mundo, "level.dat")):
                            mundos.append(pasta)
                mundos.sort()
            except Exception:
                pass
            return self.responder({"ok": True, "mundos": mundos})

        if caminho == "/api/mundos/restaurar":
            arquivo = (dados.get("arquivo") or "").strip()
            container = (dados.get("container") or SERVIDOR).strip()
            confirmacao = (dados.get("confirmacao") or "").strip()

            if container not in (SERVIDOR, TESTE):
                return self.responder({"ok": False, "erro": "container invalido"}, codigo=400)
            if not arquivo or not arquivo.endswith('.mcworld'):
                return self.responder({"ok": False, "erro": "arquivo invalido"}, codigo=400)

            try:
                # Obter level-name do server.properties
                data_base = "/data" if container == SERVIDOR else "/data-teste"
                sp_path = os.path.join(data_base, "server.properties")
                level_name = None
                if os.path.exists(sp_path):
                    with open(sp_path, 'r') as f:
                        for line in f:
                            if line.startswith('level-name='):
                                level_name = line.split('=', 1)[1].strip()
                                break

                if not level_name:
                    return self.responder({"ok": False, "erro": "level-name nao definido"}, codigo=400)

                # Validar confirmação (digitar o nome do mundo)
                if confirmacao != level_name:
                    return self.responder({"ok": False, "erro": "confirmacao incorreta"}, codigo=400)

                # Fazer backup do mundo atual
                docker("exec", "mc-backup", "/usr/local/bin/backup.sh", timeout=900)

                # Parar container
                docker("stop", "-t", "120", container, timeout=180)

                # Esvaziar pasta do mundo
                mundo_path = os.path.join(data_base, "worlds", level_name)
                if os.path.exists(mundo_path):
                    shutil.rmtree(mundo_path)
                os.makedirs(mundo_path)

                # Extrair backup
                backup_path = os.path.join("/backups", arquivo)
                if os.path.exists(backup_path):
                    with zipfile.ZipFile(backup_path, 'r') as zf:
                        zf.extractall(mundo_path)
                else:
                    return self.responder({"ok": False, "erro": "backup nao encontrado"}, codigo=404)

                # Iniciar container
                docker("start", container, timeout=60)

                return self.responder({"ok": True, "saida": f"Mundo restaurado de {arquivo}"})
            except Exception as e:
                return self.responder({"ok": False, "erro": str(e)}, codigo=500)

        if caminho == "/api/mundos/criar":
            nome = (dados.get("nome") or "").strip()
            seed = (dados.get("seed") or "").strip()
            modo = (dados.get("modo") or "survival").strip()
            dificuldade = (dados.get("dificuldade") or "normal").strip()
            container = (dados.get("container") or SERVIDOR).strip()

            if container not in (SERVIDOR, TESTE):
                return self.responder({"ok": False, "erro": "container invalido"}, codigo=400)
            if not nome or not nome.replace('_', '').replace('-', '').isalnum():
                return self.responder({"ok": False, "erro": "nome invalido"}, codigo=400)

            try:
                data_base = "/data" if container == SERVIDOR else "/data-teste"
                sp_path = os.path.join(data_base, "server.properties")

                # Criar pasta do mundo
                mundo_path = os.path.join(data_base, "worlds", nome)
                os.makedirs(mundo_path, exist_ok=True)

                # Escrever server.properties
                if os.path.exists(sp_path):
                    with open(sp_path, 'r') as f:
                        props = f.readlines()

                    novo_props = []
                    atualizadas = set()
                    for line in props:
                        if line.startswith('level-name='):
                            novo_props.append(f"level-name={nome}\n")
                            atualizadas.add('level-name')
                        elif line.startswith('level-seed='):
                            novo_props.append(f"level-seed={seed}\n")
                            atualizadas.add('level-seed')
                        elif line.startswith('gamemode='):
                            novo_props.append(f"gamemode={modo}\n")
                            atualizadas.add('gamemode')
                        elif line.startswith('difficulty='):
                            novo_props.append(f"difficulty={dificuldade}\n")
                            atualizadas.add('difficulty')
                        else:
                            novo_props.append(line)

                    if 'level-name' not in atualizadas:
                        novo_props.append(f"level-name={nome}\n")
                    if 'level-seed' not in atualizadas:
                        novo_props.append(f"level-seed={seed}\n")
                    if 'gamemode' not in atualizadas:
                        novo_props.append(f"gamemode={modo}\n")
                    if 'difficulty' not in atualizadas:
                        novo_props.append(f"difficulty={dificuldade}\n")

                    with open(sp_path, 'w') as f:
                        f.writelines(novo_props)

                # Reiniciar
                docker("restart", "-t", "120", container, timeout=240)

                return self.responder({"ok": True, "saida": f"Mundo {nome} criado"})
            except Exception as e:
                return self.responder({"ok": False, "erro": str(e)}, codigo=500)

        if caminho == "/api/mundos/trocar":
            nome = (dados.get("nome") or "").strip()
            container = (dados.get("container") or SERVIDOR).strip()
            confirmacao = (dados.get("confirmacao") or "").strip()

            if container not in (SERVIDOR, TESTE):
                return self.responder({"ok": False, "erro": "container invalido"}, codigo=400)
            if not nome:
                return self.responder({"ok": False, "erro": "nome necessario"}, codigo=400)

            try:
                data_base = "/data" if container == SERVIDOR else "/data-teste"
                sp_path = os.path.join(data_base, "server.properties")
                level_name_atual = None

                # Ler level-name atual
                if os.path.exists(sp_path):
                    with open(sp_path, 'r') as f:
                        for line in f:
                            if line.startswith('level-name='):
                                level_name_atual = line.split('=', 1)[1].strip()
                                break

                # Validar confirmação (digitar o nome do mundo atual)
                if confirmacao != level_name_atual:
                    return self.responder({"ok": False, "erro": "confirmacao incorreta"}, codigo=400)

                # Validar que o mundo novo existe
                mundo_path = os.path.join(data_base, "worlds", nome)
                if not os.path.exists(mundo_path) or not os.path.exists(os.path.join(mundo_path, "level.dat")):
                    return self.responder({"ok": False, "erro": f"mundo {nome} nao existe"}, codigo=400)

                # Atualizar server.properties
                if os.path.exists(sp_path):
                    with open(sp_path, 'r') as f:
                        props = f.readlines()

                    novo_props = []
                    for line in props:
                        if line.startswith('level-name='):
                            novo_props.append(f"level-name={nome}\n")
                        else:
                            novo_props.append(line)

                    with open(sp_path, 'w') as f:
                        f.writelines(novo_props)

                # Reiniciar
                docker("restart", "-t", "120", container, timeout=240)

                return self.responder({"ok": True, "saida": f"Mundo alterado para {nome}"})
            except Exception as e:
                return self.responder({"ok": False, "erro": str(e)}, codigo=500)

        # ============================================= ADMIN COMMANDS (Pacote I)
        if caminho == "/api/forjar":
            # O "give ... with" da linha de comando. Monta um item completo -
            # encantamento em qualquer combinacao, poder, nome, descricao -
            # e entrega pronto.
            #
            # Quem faz o trabalho e o pack "Casa do Rafael", pela Script API:
            # o /give do Bedrock aceita so 4 components e nao encanta nada.
            # Quando a combinacao e uma que o jogo recusa (Toque Suave numa
            # espada, por exemplo), o script cai para tabela de loot - e o
            # unico caminho documentado para isso no Bedrock.
            #
            # O que NAO existe: nivel acima do teto vanilla. Esta fixo no
            # motor do jogo. O painel avisa em vez de mentir, e aqui o valor
            # segue como foi pedido para o script decidir e reportar.
            item = (dados.get("item") or "").strip()
            alvo = (dados.get("alvo") or "").strip()
            qtd = dados.get("qtd", 1)
            nome = (dados.get("nome") or "").strip()
            lore = (dados.get("lore") or "").strip()
            onde = (dados.get("onde") or "mao").strip()
            livre = bool(dados.get("livre", True))
            encantes = dados.get("encantes") or {}

            if not item or " " in item:
                return self.responder({"ok": False, "saida": "item invalido"})
            if not alvo or " " in alvo:
                return self.responder({"ok": False, "saida": "alvo invalido"})
            if not isinstance(qtd, int) or qtd < 1 or qtd > 64:
                return self.responder({"ok": False, "saida": "quantidade tem que ficar entre 1 e 64"})
            if onde not in ("mao", "inv", "chao"):
                return self.responder({"ok": False, "saida": "destino invalido"})
            if not isinstance(encantes, dict) or len(encantes) > 20:
                return self.responder({"ok": False, "saida": "lista de encantamentos invalida"})
            limpos = {}
            for chave, nivel in encantes.items():
                if not re.fullmatch(r"[a-z_]{2,40}", str(chave)):
                    return self.responder({"ok": False, "saida": f"encantamento invalido: {chave}"})
                if not isinstance(nivel, int) or nivel < 1 or nivel > 255:
                    return self.responder({"ok": False, "saida": f"nivel invalido em {chave}"})
                limpos[str(chave)] = nivel
            # O payload viaja como um argumento so do send-command: aspas e
            # quebra de linha no nome quebrariam o comando no meio.
            nome = re.sub(r'["\n\r]', "", nome)[:64]
            lore = re.sub(r'["\n\r]', "", lore)[:96]

            # Poderes: o que o item faz ao acertar alguem. Sem teto de
            # proposito - e justamente por nao passarem pelo sistema de
            # encantamento que eles escapam do limite do motor.
            poderes = dados.get("poderes") or {}
            if not isinstance(poderes, dict) or len(poderes) > 12:
                return self.responder({"ok": False, "saida": "lista de poderes invalida"})
            limpos_poderes = {}
            for chave, valor in poderes.items():
                if not re.fullmatch(r"[a-z_]{3,20}", str(chave)):
                    return self.responder({"ok": False, "saida": "poder invalido: " + str(chave)})
                if chave == "efeitos":
                    if not isinstance(valor, list) or len(valor) > 8:
                        return self.responder({"ok": False, "saida": "lista de efeitos invalida"})
                    limpos_poderes["efeitos"] = [
                        {
                            "id": str(e.get("id", ""))[:40],
                            "nivel": max(1, min(255, int(e.get("nivel") or 1))),
                            "segundos": max(1, min(9999, int(e.get("segundos") or 10))),
                        }
                        for e in valor if re.fullmatch(r"[a-z_]{2,40}", str(e.get("id", "")))
                    ]
                elif isinstance(valor, bool):
                    limpos_poderes[chave] = valor
                elif isinstance(valor, (int, float)):
                    # Um milhao de teto so para nao estourar o JSON; para
                    # arremessar alguem para fora do mundo, 4000 ja basta.
                    limite = 1000000
                    # Estes viram entidades de verdade a cada disparo, e
                    # milhares delas derrubariam o servidor - o addon corta
                    # em 200 de qualquer forma, aqui o painel ja avisa.
                    if chave in ("multishot", "chuva"):
                        limite = 200
                    limpos_poderes[chave] = max(0, min(limite, int(valor)))
                else:
                    return self.responder({"ok": False, "saida": "valor invalido em " + str(chave)})

            ok, saida = falar_com_o_mundo("casa:forjar", {"item": item, "alvo": alvo, "qtd": qtd, "nome": nome, "lore": lore,
                 "onde": onde, "livre": livre, "encantes": limpos,
                 "poderes": limpos_poderes})
            return self.responder({"ok": ok, "saida": saida})

        if caminho == "/api/boom":
            # Explosao sob medida. O /summon tnt em massa trava o servidor;
            # aqui o estrago sai de uma vez, com raio de ate 1000.
            raio = dados.get("raio", 10)
            if not isinstance(raio, int) or raio < 1 or raio > 1000:
                return self.responder({"ok": False, "saida": "o raio tem que ficar entre 1 e 1000"})
            pedido = {
                "raio": raio,
                "fogo": bool(dados.get("fogo")),
                "quebra": dados.get("quebra", True) is not False,
            }
            perto = (dados.get("perto_de") or "").strip()
            if perto:
                pedido["perto_de"] = perto
            for eixo in ("x", "y", "z"):
                if isinstance(dados.get(eixo), (int, float)):
                    pedido[eixo] = int(dados[eixo])
            ok, saida = com_pedaco_carregado(
                pedido, lambda: falar_com_o_mundo("casa:boom", pedido, prazo_s=8.0)
            )
            return self.responder({"ok": ok, "saida": saida})

        if caminho == "/api/admin/give":
            alvo = (dados.get("alvo") or "").strip()
            item = (dados.get("item") or "").strip()
            qtd = dados.get("qtd", 1)
            encant = dados.get("encant", {}) or {}

            # Validações
            if not alvo:
                return self.responder({"ok": False, "saida": "erro: alvo obrigatório"})
            if not item:
                return self.responder({"ok": False, "saida": "erro: item obrigatório"})
            if not isinstance(qtd, int) or qtd < 1 or qtd > 64:
                return self.responder({"ok": False, "saida": "erro: qtd entre 1 e 64"})
            if " " in item:
                return self.responder({"ok": False, "saida": "erro: item sem espaço"})

            # Montar payload JSON para o scriptEvent
            ok, saida = falar_com_o_mundo("casa:give", {
                "alvo": alvo, "item": item, "qtd": qtd, "encant": encant,
            })
            return self.responder({"ok": ok, "saida": saida})

        if caminho == "/api/admin/summon":
            # O "summon ... with" da linha monta a criatura inteira: armadura,
            # o que ela segura em cada mao, nome flutuante, vida e efeitos.
            # O /summon do Bedrock nao faz nada disso - quem monta e a Script API.
            mob = (dados.get("mob") or "").strip()
            qtd = dados.get("qtd", 1)
            armadura = (dados.get("armadura") or "").strip() or None
            mao = (dados.get("mao") or dados.get("arma") or "").strip() or None
            mao_secundaria = (dados.get("maoSecundaria") or "").strip() or None
            nome = (dados.get("nome") or "").strip()
            vida = dados.get("vida")
            efeitos = dados.get("efeitos") or []
            perto_de = (dados.get("perto_de") or "").strip() or None

            if not mob or " " in mob:
                return self.responder({"ok": False, "saida": "criatura invalida"})
            if not isinstance(qtd, int) or qtd < 1 or qtd > 64:
                return self.responder({"ok": False, "saida": "quantidade tem que ficar entre 1 e 64"})
            for rotulo, valor in (("mao", mao), ("mao secundaria", mao_secundaria), ("armadura", armadura)):
                if valor and not re.fullmatch(r"[a-z0-9_:]{2,60}", valor):
                    return self.responder({"ok": False, "saida": f"{rotulo} invalida"})
            if vida is not None and (not isinstance(vida, int) or vida < 1 or vida > 1024):
                return self.responder({"ok": False, "saida": "vida tem que ficar entre 1 e 1024"})
            if not isinstance(efeitos, list) or len(efeitos) > 10:
                return self.responder({"ok": False, "saida": "lista de efeitos invalida"})
            limpos = []
            for e in efeitos:
                eid = str((e or {}).get("id") or "").strip()
                if not re.fullmatch(r"[a-z_]{2,40}", eid):
                    return self.responder({"ok": False, "saida": f"efeito invalido: {eid}"})
                limpos.append({
                    "id": eid,
                    "nivel": max(1, min(255, int((e or {}).get("nivel") or 1))),
                    "segundos": max(1, min(999999, int((e or {}).get("segundos") or 600))),
                })
            nome = re.sub(r'["\n\r]', "", nome)[:48]

            pedido_summon = {
                "mob": mob, "qtd": qtd, "armadura": armadura,
                "mao": mao, "maoSecundaria": mao_secundaria,
                "nome": nome, "vida": vida, "efeitos": limpos,
                "perto_de": perto_de,
            }
            # Coordenada do mapa: dois numeros bastam, a altura sai do
            # terreno. E o que faz "clicar na vila e invocar ali" funcionar.
            for eixo in ("x", "y", "z"):
                if isinstance(dados.get(eixo), (int, float)):
                    pedido_summon[eixo] = int(dados[eixo])
            if isinstance(dados.get("dim"), str) and dados["dim"] in ("overworld", "nether", "the_end"):
                pedido_summon["dim"] = dados["dim"]

            ok, saida = com_pedaco_carregado(
                pedido_summon, lambda: falar_com_o_mundo("casa:summon", pedido_summon, prazo_s=8.0)
            )
            return self.responder({"ok": ok, "saida": saida})

        if caminho == "/api/admin/tp":
            # Dois destinos possiveis: outro jogador, ou uma coordenada -
            # que e o caso do clique no mapa, onde so existem X e Z e a
            # altura e medida pelo addon para ninguem pousar dentro de
            # pedra. A versao antiga exigia "para" e recusava o clique com
            # "para obrigatorio", que foi o erro que apareceu no painel.
            quem = (dados.get("quem") or "").strip()
            para = (dados.get("para") or "").strip()
            tem_coordenada = isinstance(dados.get("x"), (int, float)) and \
                isinstance(dados.get("z"), (int, float))

            if not quem or " " in quem:
                return self.responder({"ok": False, "saida": "faltou dizer quem teleportar"})
            if not para and not tem_coordenada:
                return self.responder({
                    "ok": False,
                    "saida": "faltou o destino: outro jogador, ou X e Z",
                })
            if para and " " in para:
                return self.responder({"ok": False, "saida": "nome de destino invalido"})

            pedido = {"quem": quem}
            if tem_coordenada:
                pedido["x"] = int(dados["x"])
                pedido["z"] = int(dados["z"])
                if isinstance(dados.get("y"), (int, float)):
                    pedido["y"] = int(dados["y"])
                if isinstance(dados.get("dim"), str) and dados["dim"] in ("overworld", "nether", "the_end"):
                    pedido["dim"] = dados["dim"]
            else:
                pedido["para"] = para

            # Prazo largo de proposito: quando o destino e um canto do mapa
            # onde ninguem esteve, o addon fica ate quatro segundos so
            # esperando o terreno chegar do disco antes de medir a altura.
            # Com os cinco segundos padrao, o painel desistia antes de o
            # teleporte acontecer - e dizia "nao respondeu a tempo" para um
            # comando que ia dar certo.
            ok, saida = com_pedaco_carregado(
                pedido, lambda: falar_com_o_mundo("casa:tp", pedido, prazo_s=12.0)
            )
            return self.responder({"ok": ok, "saida": saida})

        return self.responder({"erro": "rota desconhecida"}, codigo=404)


if __name__ == "__main__":
    print(f"[painel] servindo em 0.0.0.0:{PORTA} (publicado só em 127.0.0.1)", flush=True)
    print(f"[painel] servidor alvo: {SERVIDOR}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORTA), Painel).serve_forever()
