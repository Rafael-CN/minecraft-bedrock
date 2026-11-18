# -*- coding: utf-8 -*-
"""
TESTES DO CANAL COM O MUNDO

O painel e o script do mundo conversam por linhas de log. Duas coisas
sempre deram errado nessa costura, e as duas estão cobertas aqui:

1. A linha nunca chega limpa. O servidor põe "[timestamp WARN] [Scripting]"
   na frente, e todo código que procurava pelo COMEÇO da linha nunca casou.

2. Havia uma lista fixa de marcadores conhecidos. Um tipo de resposta novo
   caía fora dela em silêncio: o script respondia certo, no prazo, e o
   painel dizia "o script não respondeu a tempo". Aconteceu com MUNDO.

Como rodar:   python testes/fluxo.py
"""
import os
import sys
import time
import unittest

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(AQUI, "..", "docker", "painel"))

from fluxo import Fluxo  # noqa: E402


def novo_fluxo():
    """Um Fluxo sem thread nem socket: só a máquina de separar linhas."""
    f = Fluxo.__new__(Fluxo)
    Fluxo.__init__(f, "nenhum-container", iniciar=False) if _aceita_iniciar() else _montar_na_mao(f)
    return f


def _aceita_iniciar():
    import inspect
    return "iniciar" in inspect.signature(Fluxo.__init__).parameters


def _montar_na_mao(f):
    """O __init__ sobe uma thread que tenta falar com o Docker. Aqui só os
    campos interessam, então eles são montados direto."""
    import collections
    import threading
    f.container = "nenhum-container"
    f._trava = threading.RLock()
    f._respostas = {}
    f._avisos = {}
    f.linhas = collections.deque(maxlen=4000)
    f.posicoes = {}
    f.eventos = collections.deque(maxlen=400)
    f.placar = {}
    f.casas = {}
    f.mobs = []
    f.mobs_ts = 0.0
    f.conectado = False
    f.recebidas = 0
    f.desde = time.time()


# Uma linha como o servidor realmente entrega: carimbo, nível, e só então
# o que o script escreveu.
def como_o_servidor_manda(corpo):
    return "[2026-09-03 22:11:42:192 WARN] [Scripting] " + corpo


class RespostaEtiquetada(unittest.TestCase):
    def setUp(self):
        self.f = novo_fluxo()

    def test_acha_a_resposta_no_meio_da_linha(self):
        self.f._processar(como_o_servidor_manda("FORJA|ok|LentDust064|egg|na mão|#529668"))
        self.assertIn("529668", self.f._respostas)

    def test_tipo_novo_nao_precisa_estar_numa_lista(self):
        """O bug do MUNDO: marcador que ninguém cadastrou tem que passar."""
        self.f._processar(como_o_servidor_manda("MUNDO|ok|hora=8935|clima=clear|#856c79"))
        self.assertIn("856c79", self.f._respostas,
                      "marcador novo foi descartado — a lista fixa voltou")

    def test_marcador_inventado_tambem_passa(self):
        self.f._processar(como_o_servidor_manda("QUALQUER_COISA|ok|#abc123"))
        self.assertIn("abc123", self.f._respostas)

    def test_linha_de_outro_addon_nao_entra(self):
        """Sem etiqueta nossa, não é resposta nossa."""
        self.f._processar("[INFO] CoreCraft carregou 42 receitas")
        self.assertEqual(self.f._respostas, {})

    def test_esperar_resposta_pega_o_que_ja_chegou(self):
        self.f._processar(como_o_servidor_manda("TP|ok|LentDust064|-212,64,221|#b0f28c"))
        linhas = self.f.esperar_resposta("b0f28c", prazo_s=0.1)
        self.assertEqual(len(linhas), 1)
        self.assertIn("TP|ok", linhas[0])

    def test_esperar_resposta_desiste_no_prazo(self):
        comecou = time.time()
        linhas = self.f.esperar_resposta("naoexiste", prazo_s=0.15)
        self.assertEqual(linhas, [])
        self.assertLess(time.time() - comecou, 1.0)


class Posicoes(unittest.TestCase):
    def setUp(self):
        self.f = novo_fluxo()

    def test_posicao_entra(self):
        self.f._processar(como_o_servidor_manda("POS|LentDust064|-2,60,2|overworld|123"))
        self.assertEqual(self.f.posicoes["LentDust064"]["x"], -2)
        self.assertEqual(self.f.posicoes["LentDust064"]["dim"], "overworld")

    def test_quem_sai_perde_a_posicao(self):
        self.f._processar(como_o_servidor_manda("POS|LentDust064|-2,60,2|overworld|123"))
        self.f._processar(como_o_servidor_manda("EVT|saiu|LentDust064|123"))
        self.assertNotIn("LentDust064", self.f.posicoes)

    def test_linha_velha_nao_traz_vida(self):
        """Servidor antigo (ou getComponent que falhou) manda sem "|hp=" -
        tem que continuar entrando, só que sem os campos de vida."""
        self.f._processar(como_o_servidor_manda("POS|LentDust064|-2,60,2|overworld|123"))
        self.assertNotIn("vida", self.f.posicoes["LentDust064"])
        self.assertNotIn("vidaMax", self.f.posicoes["LentDust064"])

    def test_linha_nova_traz_vida(self):
        self.f._processar(como_o_servidor_manda("POS|LentDust064|-2,60,2|overworld|123|hp=14/20"))
        self.assertEqual(self.f.posicoes["LentDust064"]["vida"], 14)
        self.assertEqual(self.f.posicoes["LentDust064"]["vidaMax"], 20)


class Mobs(unittest.TestCase):
    def setUp(self):
        self.f = novo_fluxo()

    def test_le_hostil_e_neutro(self):
        self.f._processar(como_o_servidor_manda("MOBS|hzombie:12,-30;ncow:40,8"))
        self.assertEqual(len(self.f.mobs), 2)
        zumbi = next(m for m in self.f.mobs if m["tipo"] == "zombie")
        vaca = next(m for m in self.f.mobs if m["tipo"] == "cow")
        self.assertTrue(zumbi["hostil"])
        self.assertFalse(vaca["hostil"])
        self.assertEqual((zumbi["x"], zumbi["z"]), (12, -30))

    def test_a_linha_nova_apaga_a_antiga(self):
        """Acumular deixaria pontos de bicho morto no mapa para sempre."""
        self.f._processar(como_o_servidor_manda("MOBS|hzombie:12,-30;ncow:40,8"))
        self.f._processar(como_o_servidor_manda("MOBS|nsheep:1,1"))
        self.assertEqual([m["tipo"] for m in self.f.mobs], ["sheep"])

    def test_linha_vazia_limpa_a_lista(self):
        self.f._processar(como_o_servidor_manda("MOBS|hzombie:12,-30"))
        self.f._processar(como_o_servidor_manda("MOBS|"))
        self.assertEqual(self.f.mobs, [])

    def test_aviso_de_varredura_cara_nao_mexe_na_lista(self):
        """Quando o freio entra, a lista boa tem que continuar valendo."""
        self.f._processar(como_o_servidor_manda("MOBS|hzombie:12,-30"))
        self.f._processar(como_o_servidor_manda("MOBS|caro|41ms|pulando 20 ciclos"))
        self.assertEqual([m["tipo"] for m in self.f.mobs], ["zombie"])

    def test_pedaco_estragado_nao_derruba_o_resto(self):
        self.f._processar(como_o_servidor_manda("MOBS|hzombie:12,-30;lixo;ncow:40,8"))
        self.assertEqual(len(self.f.mobs), 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
