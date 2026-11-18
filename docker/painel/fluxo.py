#!/usr/bin/env python3
"""
Fluxo: o log do servidor lido continuamente, em vez de consultado.

O painel antes perguntava o log ao Docker depois de cada comando e dormia
1,5 s esperando a resposta aparecer. Isso custava dois segundos em toda
acao e tornava impossivel mostrar a posicao de alguem em tempo real - a
informacao ja nascia velha.

Aqui uma thread mantem UMA conexao aberta com a API do Docker no socket
unix e recebe cada linha do servidor no instante em que ela e escrita.
Tudo o que interessa (posicoes, eventos, respostas de comando) e separado
na hora e guardado em memoria. As rotas do painel passam a ler memoria, o
que responde em microssegundos.

O formato do stream: sem TTY, o Docker multiplexa stdout e stderr em
quadros com cabecalho de 8 bytes - primeiro byte diz o canal, os quatro
ultimos dizem o tamanho em big-endian. Ler ingenuamente como texto traz
lixo binario no meio das linhas, e foi por isso que este arquivo existe
em vez de um simples subprocess.
"""
import http.client
import json
import os
import re
import socket
import struct
import threading
import time
from collections import deque

SOCKET_DOCKER = "/var/run/docker.sock"

# Quanto tempo uma posicao continua valendo. O addon manda assim que a
# pessoa se move e, parada, manda um pulso a cada 4 s. Dez segundos de
# silencio, portanto, significa mesmo que ela saiu - ou que o script morreu.
VALIDADE_POSICAO_S = 10.0


class _ConexaoUnix(http.client.HTTPConnection):
    """HTTPConnection falando com o Docker pelo socket de arquivo."""

    def __init__(self, caminho=SOCKET_DOCKER, timeout=None):
        super().__init__("localhost", timeout=timeout)
        self._caminho = caminho

    def connect(self):
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        if self.timeout:
            s.settimeout(self.timeout)
        s.connect(self._caminho)
        self.sock = s


class Fluxo:
    """Estado vivo do servidor, alimentado pelo log em tempo real."""

    def __init__(self, container):
        self.container = container
        self._trava = threading.Lock()

        self.posicoes = {}        # nome -> {x, y, z, dim, ts}
        self.eventos = deque(maxlen=400)
        self.linhas = deque(maxlen=1200)   # log cru, para a aba de log
        self.placar = {}          # nome -> {blocos, mortes, segundos}
        self.casas = {}           # nome -> {x, y, z, dim}

        # Respostas de comando esperando quem as pediu. A chave e a etiqueta
        # que o painel colou no comando; sem ela nao da para saber qual
        # resposta e de quem quando dois comandos saem juntos.
        self._respostas = {}
        self._avisos = {}

        self.conectado = False
        # O que a varredura do mundo viu na ultima passada. Lista curta e
        # sempre inteira: a linha nova apaga a antiga.
        self.mobs = []
        self.mobs_ts = 0.0
        self.desde = 0
        self.recebidas = 0

        t = threading.Thread(target=self._laco, name="fluxo-log", daemon=True)
        t.start()

    # ---------------------------------------------------------- leitura

    def _laco(self):
        espera = 1
        while True:
            try:
                self._ler_stream()
                espera = 1
            except Exception:
                # Container reiniciando, socket sumindo, Docker ocupado: nada
                # disso pode derrubar o painel. Espera e tenta de novo, com
                # recuo ate 15 s para nao martelar o daemon.
                self.conectado = False
                time.sleep(espera)
                espera = min(15, espera * 2)

    def _ler_stream(self):
        # Sem timeout de socket: um servidor quieto e normal, e derrubar a
        # conexao por silencio so faria o painel perder o inicio das linhas
        # a cada reconexao.
        conexao = _ConexaoUnix()
        caminho = (
            f"/containers/{self.container}/logs"
            "?follow=1&stdout=1&stderr=1&tail=200&timestamps=0"
        )
        conexao.request("GET", caminho)
        resposta = conexao.getresponse()
        if resposta.status != 200:
            raise RuntimeError(f"docker respondeu {resposta.status}")

        # O Docker entrega o log de duas formas, e a escolha nao e nossa:
        # container com TTY manda texto cru; sem TTY, manda quadros com
        # cabecalho de 8 bytes dizendo canal e tamanho. Este container roda
        # com TTY (o send-command precisa do stdin aberto), entao cai no
        # primeiro caso - e tentar ler cabecalho onde nao ha travava tudo,
        # esperando encher um buffer que nunca enchia.
        cru = "raw-stream" in (resposta.getheader("Content-Type") or "")

        self.conectado = True
        self.desde = time.time()

        if cru:
            self._ler_cru(resposta)
        else:
            self._ler_quadros(resposta)

    def _ler_cru(self, resposta):
        """Texto direto: uma linha por vez, entregue assim que chega."""
        while True:
            linha = resposta.readline()
            if not linha:
                break
            self._processar(linha.decode("utf-8", "replace").rstrip("\r\n"))

    def _ler_quadros(self, resposta):
        """Quadros multiplexados: cabecalho de 8 bytes e depois o texto."""
        restos = b""
        while True:
            cabecalho = self._ler_exato(resposta, 8)
            if len(cabecalho) < 8:
                break
            tamanho = struct.unpack(">I", cabecalho[4:8])[0]
            bloco = self._ler_exato(resposta, tamanho)
            if not bloco:
                break
            restos += bloco
            *prontas, restos = restos.split(b"\n")
            for bruta in prontas:
                self._processar(bruta.decode("utf-8", "replace").rstrip("\r"))

    @staticmethod
    def _ler_exato(resposta, quantos):
        pedacos = b""
        while len(pedacos) < quantos:
            novo = resposta.read(quantos - len(pedacos))
            if not novo:
                return pedacos
            pedacos += novo
        return pedacos

    # ------------------------------------------------------- separacao

    def _processar(self, linha):
        if not linha:
            return
        self.recebidas += 1
        agora = time.time()

        with self._trava:
            self.linhas.append({"t": agora, "txt": linha})

        # POS|Nome|x,y,z|dim|ts|hp=a/b  (o "|hp=" e opcional - servidor
        # antigo, ou getComponent que falhou no mundo, manda sem ele)
        m = re.search(
            r"POS\|([^|]+)\|(-?\d+),(-?\d+),(-?\d+)\|(\w+)\|\d+(?:\|hp=(\d+)/(\d+))?",
            linha,
        )
        if m:
            with self._trava:
                pos = {
                    "x": int(m.group(2)), "y": int(m.group(3)), "z": int(m.group(4)),
                    "dim": m.group(5), "ts": agora,
                }
                if m.group(6) is not None:
                    pos["vida"] = int(m.group(6))
                    pos["vidaMax"] = int(m.group(7))
                self.posicoes[m.group(1)] = pos
            return

        # MOBS|hzombie:12,-30;ncow:40,8
        #
        # Uma linha inteira a cada varredura, e ela SUBSTITUI a anterior -
        # inclusive quando vem vazia. Acumular seria pior do que nao ter:
        # o mapa encheria de pontos de bicho que ja morreu.
        if linha.startswith("MOBS|") or "] MOBS|" in linha:
            corpo = linha[linha.index("MOBS|") + 5:].strip()
            if corpo.startswith("caro|"):
                # A varredura avisou que esta cara e vai se calar um pouco.
                # Nao e erro, e o freio funcionando - so nao mexe na lista.
                return
            achados = []
            for pedaco in corpo.split(";"):
                if not pedaco:
                    continue
                try:
                    cabeca, coords = pedaco.split(":", 1)
                    x, z = coords.split(",")
                    achados.append({
                        "tipo": cabeca[1:],
                        "hostil": cabeca[:1] == "h",
                        "x": int(x), "z": int(z),
                    })
                except (ValueError, IndexError):
                    continue
            with self._trava:
                self.mobs = achados
                self.mobs_ts = agora
            return

        # EVT|tipo|Nome|dados|ts
        m = re.search(r"EVT\|(\w+)\|([^|]+)\|(.*)$", linha)
        if m:
            with self._trava:
                self.eventos.append({
                    "tipo": m.group(1), "nome": m.group(2),
                    "dados": m.group(3), "ts": agora,
                })
                if m.group(1) == "saiu":
                    self.posicoes.pop(m.group(2), None)
            return

        m = re.search(r"STAT\|([^|]+)\|blocos=(\d+)\|mortes=(\d+)\|segundos=(\d+)", linha)
        if m:
            with self._trava:
                self.placar[m.group(1)] = {
                    "blocos": int(m.group(2)), "mortes": int(m.group(3)),
                    "segundos": int(m.group(4)),
                }
            return

        m = re.search(r"HOME\|([^|]+)\|(-?\d+),(-?\d+),(-?\d+)\|(\w+)", linha)
        if m:
            with self._trava:
                self.casas[m.group(1)] = {
                    "x": int(m.group(2)), "y": int(m.group(3)), "z": int(m.group(4)),
                    "dim": m.group(5),
                }
            return

        # Resposta etiquetada: qualquer sinal nosso que carregue #etiqueta.
        #
        # Aqui havia uma lista fixa de marcadores conhecidos - FORJA, INVOCA,
        # ADM, BOOM, TP, RESP. Todo tipo de resposta novo caia fora dela em
        # silencio: o script respondia certo e no prazo, e o painel dizia "o
        # script nao respondeu a tempo". Foi exatamente o que aconteceu com
        # MUNDO, e ia acontecer com o proximo tipo tambem.
        #
        # A etiqueta ja e prova suficiente de que a linha e nossa: ela e um
        # numero aleatorio que ESTE painel gerou e mandou ha instantes. Basta
        # exigir que a linha tenha a cara do nosso protocolo - um marcador em
        # maiusculas seguido de barra.
        m = re.search(r"#([a-z0-9]{4,12})\b", linha)
        if m and re.search(r"\b[A-Z][A-Z_]{1,14}\|", linha):
            etiqueta = m.group(1)
            with self._trava:
                self._respostas.setdefault(etiqueta, []).append(linha)
                aviso = self._avisos.get(etiqueta)
            if aviso:
                aviso.set()

    # ------------------------------------------------------- consultas

    def esperar_resposta(self, etiqueta, prazo_s=4.0):
        """Bloqueia ate a resposta daquela etiqueta chegar, ou o prazo vencer.

        Sem isto a unica saida era dormir um tempo fixo e torcer. Aqui o
        painel acorda no instante em que o servidor responde - na pratica
        entre 50 e 300 ms em vez de 1,6 s cravado.
        """
        aviso = threading.Event()
        with self._trava:
            if etiqueta in self._respostas:
                return list(self._respostas.pop(etiqueta))
            self._avisos[etiqueta] = aviso

        aviso.wait(prazo_s)

        with self._trava:
            self._avisos.pop(etiqueta, None)
            return list(self._respostas.pop(etiqueta, []))

    def esperar_linha(self, padrao, desde_ts, prazo_s=3.0, passo_s=0.02):
        """Espera uma linha que case com o padrao aparecer no log.

        Serve para comando vanilla, que nao carrega etiqueta nossa: manda-se
        o comando e espera-se a resposta caracteristica dele. Como o stream
        chega no instante da escrita, isso costuma resolver em menos de
        200 ms - o codigo antigo dormia 1,2 s cravado.
        """
        alvo = re.compile(padrao)
        limite = time.time() + prazo_s
        while time.time() < limite:
            with self._trava:
                for l in reversed(self.linhas):
                    if l["t"] < desde_ts:
                        break
                    if alvo.search(l["txt"]):
                        return l["txt"]
            time.sleep(passo_s)
        return None

    def esperar_par(self, padrao, desde_ts, prazo_s=3.0, passo_s=0.02):
        """Como esperar_linha, mas devolve tambem a linha logo depois dela.

        O comando list responde em duas linhas: a contagem numa, os nomes na
        seguinte. Procurar os nomes "nas ultimas linhas do log" parava de
        funcionar quando a posicao dos jogadores passou a sair quatro vezes
        por segundo e empurrou tudo para cima.

        Devolve (primeiro grupo do padrao, linha seguinte) ou None.
        """
        alvo = re.compile(padrao)
        limite = time.time() + prazo_s
        while time.time() < limite:
            with self._trava:
                linhas = [l for l in self.linhas if l["t"] >= desde_ts]
            for i, l in enumerate(linhas):
                m = alvo.search(l["txt"])
                if m:
                    seguinte = linhas[i + 1]["txt"] if i + 1 < len(linhas) else None
                    # A linha dos nomes vem no mesmo instante da contagem; se
                    # ainda nao chegou, espera mais um passo antes de desistir.
                    if seguinte is None and time.time() < limite - passo_s:
                        break
                    return (m.group(1) if m.groups() else m.group(0)), seguinte
            time.sleep(passo_s)
        return None

    def posicoes_vivas(self):
        corte = time.time() - VALIDADE_POSICAO_S
        with self._trava:
            return {
                nome: dict(p) for nome, p in self.posicoes.items()
                if p["ts"] >= corte
            }

    def quem_esta_no_mundo(self):
        return sorted(self.posicoes_vivas().keys())

    def ultimos_eventos(self, horas=24):
        corte = time.time() - horas * 3600
        with self._trava:
            return [dict(e) for e in self.eventos if e["ts"] >= corte]

    def log(self, quantas=200, filtro=None):
        with self._trava:
            linhas = [l["txt"] for l in self.linhas]
        if filtro:
            linhas = [l for l in linhas if filtro in l]
        return linhas[-quantas:]

    def saida_recente(self, desde_ts, quantas=15, ignorar=("DEBU[",)):
        """Linhas do servidor desde um instante - resposta de comando vanilla."""
        with self._trava:
            brutas = [l for l in self.linhas if l["t"] >= desde_ts]
        limpas = []
        for l in brutas:
            txt = re.sub(r"^\[[^\]]*\]\s*", "", l["txt"]).strip()
            if not txt or any(x in l["txt"] for x in ignorar):
                continue
            limpas.append(txt)
        return limpas[-quantas:]

    def diagnostico(self):
        with self._trava:
            return {
                "conectado": self.conectado,
                "linhas_recebidas": self.recebidas,
                "desde": self.desde,
                "jogadores_com_posicao": len(self.posicoes),
                "eventos_guardados": len(self.eventos),
            }
