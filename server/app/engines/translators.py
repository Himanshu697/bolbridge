"""Text translation engines.

* M2M100 (Meta, MIT licence): 100 languages, runs on CPU, no extra service.
* Ollama + an open LLM (e.g. Qwen2.5-7B-Instruct, Apache-2.0): better at
  Hinglish / code-mixed speech and respects a glossary. Needs Ollama running.

Do NOT swap in NLLB-200: its weights are CC-BY-NC (non-commercial only).
"""
from __future__ import annotations

import logging
from pathlib import Path

import httpx

from ..languages import get_language

log = logging.getLogger(__name__)


def _torch_device(device: str) -> str:
    if device != "auto":
        return device
    try:
        import torch

        return "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:  # pragma: no cover
        return "cpu"


class M2M100Translator:
    name = "m2m100"

    def __init__(self, model_name: str = "facebook/m2m100_418M", device: str = "auto") -> None:
        import torch
        from transformers import M2M100ForConditionalGeneration, M2M100Tokenizer

        self._torch = torch
        self.device = _torch_device(device)
        log.info("Loading %s on %s", model_name, self.device)
        self.tokenizer = M2M100Tokenizer.from_pretrained(model_name)
        self.model = M2M100ForConditionalGeneration.from_pretrained(model_name).to(self.device).eval()

    def translate(self, text: str, src: str, tgt: str, glossary: dict[str, str] | None = None) -> str:
        if src == tgt or not text.strip():
            return text
        s, t = get_language(src), get_language(tgt)
        if s is None or t is None:
            raise ValueError(f"Unsupported language pair {src}->{tgt}")
        self.tokenizer.src_lang = s.m2m
        enc = self.tokenizer(text, return_tensors="pt", truncation=True, max_length=256).to(self.device)
        # A spoken sentence rarely needs more than about twice its own length.
        # The cap stops the model rambling on noise, which costs seconds on a CPU.
        limit = min(256, 2 * int(enc["input_ids"].shape[-1]) + 16)
        with self._torch.no_grad():
            out = self.model.generate(
                **enc,
                forced_bos_token_id=self.tokenizer.get_lang_id(t.m2m),
                max_new_tokens=limit,
                num_beams=2,
            )
        result = self.tokenizer.batch_decode(out, skip_special_tokens=True)[0].strip()
        return apply_glossary(result, glossary)


class M2M100CT2Translator:
    """M2M100 run by CTranslate2 (MIT), int8: same translations, ~4x less memory, several times faster on a CPU.

    Weights: jncraton/m2m100_418M-ct2-int8 (MIT, converted from facebook/m2m100_418M).
    On a GPU, michaelfeil/ct2fast-m2m100_1.2B gives better translations.
    """

    name = "m2m100-ct2"

    def __init__(
        self,
        model_id: str = "jncraton/m2m100_418M-ct2-int8",
        tokenizer_id: str = "facebook/m2m100_418M",
        device: str = "auto",
        threads: int = 0,
    ) -> None:
        import ctranslate2
        from transformers import M2M100Tokenizer

        if Path(model_id).is_dir():
            path = model_id
        else:
            from huggingface_hub import snapshot_download

            path = snapshot_download(model_id)
        if device == "auto":
            device = "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
        log.info("Loading %s with CTranslate2 on %s (%s threads)", model_id, device, threads or "auto")
        self.translator = ctranslate2.Translator(path, device=device, compute_type="auto", inter_threads=1, intra_threads=threads)
        self.tokenizer = M2M100Tokenizer.from_pretrained(tokenizer_id)

    def translate(self, text: str, src: str, tgt: str, glossary: dict[str, str] | None = None) -> str:
        if src == tgt or not text.strip():
            return text
        s, t = get_language(src), get_language(tgt)
        if s is None or t is None:
            raise ValueError(f"Unsupported language pair {src}->{tgt}")
        self.tokenizer.src_lang = s.m2m
        ids = self.tokenizer.encode(text, truncation=True, max_length=256)
        source = self.tokenizer.convert_ids_to_tokens(ids)
        limit = min(256, 2 * len(ids) + 16)  # stop rambling on noise
        out = self.translator.translate_batch(
            [source], target_prefix=[[f"__{t.m2m}__"]], beam_size=2, max_decoding_length=limit
        )
        tokens = out[0].hypotheses[0][1:]  # drop the language token
        result = self.tokenizer.decode(self.tokenizer.convert_tokens_to_ids(tokens), skip_special_tokens=True).strip()
        return apply_glossary(result, glossary)


class OllamaTranslator:
    name = "ollama"

    def __init__(self, url: str = "http://localhost:11434", model: str = "qwen2.5:7b-instruct", timeout: float = 30.0):
        self.url = url.rstrip("/")
        self.model = model
        self.client = httpx.Client(timeout=timeout)

    def translate(self, text: str, src: str, tgt: str, glossary: dict[str, str] | None = None) -> str:
        if src == tgt or not text.strip():
            return text
        s, t = get_language(src), get_language(tgt)
        if s is None or t is None:
            raise ValueError(f"Unsupported language pair {src}->{tgt}")
        rules = ""
        if glossary:
            pairs = "; ".join(f"{k} -> {v}" for k, v in glossary.items())
            rules = f" Always use these term translations: {pairs}."
        system = (
            "You are a live phone-call interpreter. Translate what the speaker said "
            f"from {s.name} to {t.name}. The speaker may mix languages (for example "
            "Hinglish: Hindi with English words, written in Devanagari or Latin script). "
            "Keep it short and natural, the way people talk. Keep names, numbers, prices "
            f"and units exactly.{rules} Reply with the translation only, no notes."
        )
        resp = self.client.post(
            f"{self.url}/api/chat",
            json={
                "model": self.model,
                "stream": False,
                "options": {"temperature": 0.2},
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": text},
                ],
            },
        )
        resp.raise_for_status()
        return resp.json()["message"]["content"].strip().strip('"')


def apply_glossary(text: str, glossary: dict[str, str] | None) -> str:
    if not glossary:
        return text
    for src_term, tgt_term in glossary.items():
        text = text.replace(src_term, tgt_term)
    return text
