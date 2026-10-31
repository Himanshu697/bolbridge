import numpy as np

from app.realtime.segmenter import UtteranceSegmenter
from conftest import silence, tone


def feed(seg, audio, chunk=1600):
    out = []
    for i in range(0, len(audio), chunk):
        out.extend(seg.push(audio[i : i + chunk]))
    return out


def test_one_sentence_then_pause():
    seg = UtteranceSegmenter(end_silence_ms=400)
    out = feed(seg, np.concatenate([silence(0.5), tone(1.0), silence(0.8)]))
    assert len(out) == 1
    # about 1 s of speech plus pre-roll and a short tail
    assert 0.9 < len(out[0]) / 16000 < 1.6


def test_two_sentences():
    seg = UtteranceSegmenter(end_silence_ms=400)
    audio = np.concatenate([tone(0.8), silence(0.7), tone(0.6), silence(0.7)])
    assert len(feed(seg, audio)) == 2


def test_long_talker_is_cut_into_chunks():
    seg = UtteranceSegmenter(max_utterance_s=2.0)
    out = feed(seg, tone(5.0))
    out += seg.flush()
    assert len(out) >= 2
    assert all(len(u) / 16000 <= 2.4 for u in out)


def test_clicks_are_ignored():
    seg = UtteranceSegmenter(end_silence_ms=300, min_utterance_ms=350)
    audio = np.concatenate([silence(0.3), tone(0.08), silence(0.6)])
    assert feed(seg, audio) == []


def test_flush_returns_unfinished_sentence():
    seg = UtteranceSegmenter()
    assert feed(seg, tone(1.0)) == []
    assert len(seg.flush()) == 1


def test_steady_background_noise_is_not_speech():
    rng = np.random.default_rng(0)
    noise = (rng.standard_normal(16000 * 3) * 0.003).astype(np.float32)  # about -50 dBFS hiss
    seg = UtteranceSegmenter()
    assert feed(seg, noise) == []
