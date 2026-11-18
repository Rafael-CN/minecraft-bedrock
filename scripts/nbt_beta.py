#!/usr/bin/env python3
"""
nbt_beta.py — leitor/escritor de NBT little-endian (Bedrock level.dat), stdlib only.

Formato do level.dat do Bedrock:
  cabecalho de 8 bytes: int32 LE versao, int32 LE tamanho do payload NBT
  payload: NBT little-endian, SEM compressao (nao é a variante gzip do Java).

Tipos de tag NBT:
  0  End            (sem nome, sem payload)
  1  Byte           1 byte, signed
  2  Short          2 bytes LE, signed
  3  Int            4 bytes LE, signed
  4  Long           8 bytes LE, signed
  5  Float          4 bytes LE
  6  Double         8 bytes LE
  7  Byte Array     int32 LE len + bytes
  8  String         uint16 LE len + utf-8
  9  List           1 byte tipo-do-elemento + int32 LE len + payloads (sem nome)
  10 Compound       sequencia de tags nomeadas ate uma tag End
  11 Int Array      int32 LE len + int32 LE ints
  12 Long Array     int32 LE len + int64 LE longs

Uma "tag nomeada" (usada dentro de Compound) é: id (1 byte) + nome (string,
so quando id != 0) + payload. Dentro de List os elementos NAO tem id nem nome
(o tipo é fixo pelo cabecalho da lista).

Este modulo preserva ORDEM e todos os bytes originais para permitir
round-trip byte-a-byte identico (usado como teste de sanidade do parser).
"""

import hashlib
import shutil
import struct
import sys

END, BYTE, SHORT, INT, LONG, FLOAT, DOUBLE = 0, 1, 2, 3, 4, 5, 6
BYTE_ARRAY, STRING, LIST, COMPOUND, INT_ARRAY, LONG_ARRAY = 7, 8, 9, 10, 11, 12


class CompoundTag:
    """Compound preserva ordem e permite nomes duplicados: lista de (nome, tag_id, valor)."""

    def __init__(self, entries=None):
        self.entries = entries if entries is not None else []

    def get(self, name):
        for n, tid, val in self.entries:
            if n == name:
                return tid, val
        return None, None

    def set_byte(self, name, value):
        """Define (criando se preciso) um TAG_Byte com o nome dado, valor 0/1."""
        for i, (n, tid, val) in enumerate(self.entries):
            if n == name:
                if tid != BYTE:
                    raise ValueError(f"tag '{name}' existe mas nao e Byte (id={tid})")
                self.entries[i] = (n, BYTE, value)
                return
        self.entries.append((name, BYTE, value))


class ListTag:
    def __init__(self, elem_type, values):
        self.elem_type = elem_type
        self.values = values


class Reader:
    def __init__(self, data: bytes):
        self.data = data
        self.pos = 0

    def _take(self, n):
        if self.pos + n > len(self.data):
            raise ValueError(f"EOF inesperado em pos={self.pos}, pedindo {n} bytes")
        b = self.data[self.pos:self.pos + n]
        self.pos += n
        return b

    def u8(self):
        return self._take(1)[0]

    def i8(self):
        return struct.unpack('<b', self._take(1))[0]

    def u16(self):
        return struct.unpack('<H', self._take(2))[0]

    def i16(self):
        return struct.unpack('<h', self._take(2))[0]

    def i32(self):
        return struct.unpack('<i', self._take(4))[0]

    def i64(self):
        return struct.unpack('<q', self._take(8))[0]

    def f32(self):
        return struct.unpack('<f', self._take(4))[0]

    def f64(self):
        return struct.unpack('<d', self._take(8))[0]

    def string(self):
        n = self.u16()
        raw = self._take(n)
        return raw.decode('utf-8')

    def payload(self, tag_id):
        if tag_id == BYTE:
            return self.i8()
        if tag_id == SHORT:
            return self.i16()
        if tag_id == INT:
            return self.i32()
        if tag_id == LONG:
            return self.i64()
        if tag_id == FLOAT:
            return self.f32()
        if tag_id == DOUBLE:
            return self.f64()
        if tag_id == BYTE_ARRAY:
            n = self.i32()
            return bytes(self._take(n))
        if tag_id == STRING:
            return self.string()
        if tag_id == LIST:
            elem_type = self.u8()
            n = self.i32()
            values = [self.payload(elem_type) for _ in range(n)]
            return ListTag(elem_type, values)
        if tag_id == COMPOUND:
            entries = []
            while True:
                tid = self.u8()
                if tid == END:
                    break
                name = self.string()
                val = self.payload(tid)
                entries.append((name, tid, val))
            return CompoundTag(entries)
        if tag_id == INT_ARRAY:
            n = self.i32()
            return [self.i32() for _ in range(n)]
        if tag_id == LONG_ARRAY:
            n = self.i32()
            return [self.i64() for _ in range(n)]
        raise ValueError(f"tag id desconhecido: {tag_id} em pos={self.pos}")

    def named_tag(self):
        """Le uma tag raiz completa: id + nome + payload. Retorna (id, nome, valor)."""
        tid = self.u8()
        if tid == END:
            return tid, None, None
        name = self.string()
        val = self.payload(tid)
        return tid, name, val


class Writer:
    def __init__(self):
        self.buf = bytearray()

    def u8(self, v):
        self.buf += struct.pack('<B', v)

    def i8(self, v):
        self.buf += struct.pack('<b', v)

    def u16(self, v):
        self.buf += struct.pack('<H', v)

    def i16(self, v):
        self.buf += struct.pack('<h', v)

    def i32(self, v):
        self.buf += struct.pack('<i', v)

    def i64(self, v):
        self.buf += struct.pack('<q', v)

    def f32(self, v):
        self.buf += struct.pack('<f', v)

    def f64(self, v):
        self.buf += struct.pack('<d', v)

    def string(self, s):
        raw = s.encode('utf-8')
        self.u16(len(raw))
        self.buf += raw

    def payload(self, tag_id, value):
        if tag_id == BYTE:
            self.i8(value)
        elif tag_id == SHORT:
            self.i16(value)
        elif tag_id == INT:
            self.i32(value)
        elif tag_id == LONG:
            self.i64(value)
        elif tag_id == FLOAT:
            self.f32(value)
        elif tag_id == DOUBLE:
            self.f64(value)
        elif tag_id == BYTE_ARRAY:
            self.i32(len(value))
            self.buf += value
        elif tag_id == STRING:
            self.string(value)
        elif tag_id == LIST:
            assert isinstance(value, ListTag)
            self.u8(value.elem_type)
            self.i32(len(value.values))
            for v in value.values:
                self.payload(value.elem_type, v)
        elif tag_id == COMPOUND:
            assert isinstance(value, CompoundTag)
            for name, tid, val in value.entries:
                self.u8(tid)
                self.string(name)
                self.payload(tid, val)
            self.u8(END)
        elif tag_id == INT_ARRAY:
            self.i32(len(value))
            for v in value:
                self.i32(v)
        elif tag_id == LONG_ARRAY:
            self.i32(len(value))
            for v in value:
                self.i64(v)
        else:
            raise ValueError(f"tag id desconhecido ao escrever: {tag_id}")

    def named_tag(self, tag_id, name, value):
        self.u8(tag_id)
        if tag_id != END:
            self.string(name)
            self.payload(tag_id, value)


def parse_level_dat(data: bytes):
    """Retorna (versao, tamanho_payload_declarado, tag_id, nome, valor, payload_bytes_originais)."""
    if len(data) < 8:
        raise ValueError("arquivo menor que o cabecalho de 8 bytes")
    version, payload_size = struct.unpack('<ii', data[0:8])
    payload_bytes = data[8:8 + payload_size]
    if len(payload_bytes) != payload_size:
        raise ValueError(
            f"tamanho declarado no cabecalho ({payload_size}) nao bate com "
            f"bytes disponiveis ({len(payload_bytes)})")
    r = Reader(payload_bytes)
    tid, name, value = r.named_tag()
    if r.pos != len(payload_bytes):
        raise ValueError(
            f"sobraram {len(payload_bytes) - r.pos} bytes nao consumidos no payload")
    trailer = data[8 + payload_size:]
    return version, tid, name, value, trailer


def serialize_level_dat(version: int, tag_id: int, name: str, value, trailer: bytes = b'') -> bytes:
    w = Writer()
    w.named_tag(tag_id, name, value)
    payload = bytes(w.buf)
    header = struct.pack('<ii', version, len(payload))
    return header + payload + trailer


def roundtrip_test(path: str) -> bool:
    with open(path, 'rb') as f:
        original = f.read()
    version, tid, name, value, trailer = parse_level_dat(original)
    rebuilt = serialize_level_dat(version, tid, name, value, trailer)
    md5_orig = hashlib.md5(original).hexdigest()
    md5_new = hashlib.md5(rebuilt).hexdigest()
    ok = (original == rebuilt)
    print(f"arquivo: {path}")
    print(f"  tamanho original: {len(original)}  tamanho reserializado: {len(rebuilt)}")
    print(f"  md5 original:      {md5_orig}")
    print(f"  md5 reserializado: {md5_new}")
    print(f"  ROUND-TRIP {'OK' if ok else 'FALHOU'}")
    return ok


def apply_beta_apis(src: str, dst: str):
    """Le src, liga os 3 bytes do experimento, escreve em dst, e reverifica dst."""
    with open(src, 'rb') as f:
        original = f.read()
    version, tid, name, root, trailer = parse_level_dat(original)
    if tid != COMPOUND:
        raise ValueError(f"tag raiz nao e compound (id={tid})")

    exp_tid, exp_val = root.get('experiments')
    if exp_tid != COMPOUND:
        raise ValueError(f"compound 'experiments' nao encontrado ou tipo errado (id={exp_tid})")

    before = {k: exp_val.get(k)[1] for k in
              ('gametest', 'experiments_ever_used', 'saved_with_toggled_experiments')}
    print(f"experiments ANTES: {before}")

    exp_val.set_byte('gametest', 1)
    exp_val.set_byte('experiments_ever_used', 1)
    exp_val.set_byte('saved_with_toggled_experiments', 1)

    new_bytes = serialize_level_dat(version, tid, name, root, trailer)
    with open(dst, 'wb') as f:
        f.write(new_bytes)

    # Reverificacao lendo de volta o arquivo gravado.
    with open(dst, 'rb') as f:
        check_data = f.read()
    c_version, c_payload_size = struct.unpack('<ii', check_data[0:8])
    real_payload_len = len(check_data) - 8 - len(trailer)
    if c_payload_size != real_payload_len:
        raise ValueError(
            f"FALHA: header diz payload={c_payload_size}, real={real_payload_len}")

    c_version2, c_tid, c_name, c_root, c_trailer = parse_level_dat(check_data)
    c_exp_tid, c_exp_val = c_root.get('experiments')
    got = {k: c_exp_val.get(k)[1] for k in
           ('gametest', 'experiments_ever_used', 'saved_with_toggled_experiments')}
    print(f"experiments DEPOIS (relido do disco): {got}")
    for k, v in got.items():
        if v != 1:
            raise ValueError(f"FALHA: '{k}' = {v}, esperado 1")
    print(f"header payload_size (gravado)={c_payload_size}  real={real_payload_len}  OK")
    print(f"escrito: {dst}  ({len(check_data)} bytes)")


def cmd_roundtrip(argv):
    path = argv[0]
    ok = roundtrip_test(path)
    sys.exit(0 if ok else 1)


def cmd_apply(argv):
    src, dst = argv[0], argv[1]
    apply_beta_apis(src, dst)


def cmd_dump_experiments(argv):
    path = argv[0]
    with open(path, 'rb') as f:
        data = f.read()
    version, tid, name, root, trailer = parse_level_dat(data)
    exp_tid, exp_val = root.get('experiments')
    if exp_tid != COMPOUND:
        print("compound 'experiments' nao encontrado")
        sys.exit(1)
    print(f"versao header={version}")
    for n, t, v in exp_val.entries:
        print(f"  {n} (tag {t}) = {v}")


def main():
    if len(sys.argv) < 2:
        print("uso: nbt_beta.py roundtrip <level.dat>")
        print("     nbt_beta.py apply <src level.dat> <dst level.dat>")
        print("     nbt_beta.py dump <level.dat>")
        sys.exit(2)
    cmd, rest = sys.argv[1], sys.argv[2:]
    if cmd == 'roundtrip':
        cmd_roundtrip(rest)
    elif cmd == 'apply':
        cmd_apply(rest)
    elif cmd == 'dump':
        cmd_dump_experiments(rest)
    else:
        print(f"comando desconhecido: {cmd}")
        sys.exit(2)


if __name__ == '__main__':
    main()
