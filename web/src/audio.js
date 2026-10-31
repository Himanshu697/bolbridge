// Browser audio helpers: microphone capture, 16 kHz PCM, WAV files, playback.
import { wsUrl } from './api.js';

export const TARGET_RATE = 16000;

export function downsampleTo16k(input, inRate) {
  const ratio = inRate / TARGET_RATE;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = end > start ? sum / (end - start) : 0;
  }
  return out;
}

export function floatToInt16(samples) {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out;
}

export function encodeWav(samples, sampleRate) {
  const pcm = floatToInt16(samples);
  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);
  const write = (offset, text) => [...text].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)));
  write(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length * 2, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, pcm.length * 2, true);
  new Int16Array(buffer, 44).set(pcm);
  return new Blob([buffer], { type: 'audio/wav' });
}

function rms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / (samples.length || 1));
}

/** Records the microphone and returns a 16 kHz WAV blob. */
export class VoiceRecorder {
  constructor(onLevel) {
    this.onLevel = onLevel;
    this.chunks = [];
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    this.ctx = new AudioContext();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.proc = this.ctx.createScriptProcessor(4096, 1, 1);
    const sink = this.ctx.createGain();
    sink.gain.value = 0;
    src.connect(this.proc);
    this.proc.connect(sink);
    sink.connect(this.ctx.destination);
    this.proc.onaudioprocess = (e) => {
      const data = e.inputBuffer.getChannelData(0);
      this.chunks.push(downsampleTo16k(data, this.ctx.sampleRate));
      if (this.onLevel) this.onLevel(Math.min(1, rms(data) * 6));
    };
  }

  get seconds() {
    return this.chunks.reduce((n, c) => n + c.length, 0) / TARGET_RATE;
  }

  async stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    if (this.proc) this.proc.onaudioprocess = null;
    await this.ctx?.close();
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const all = new Float32Array(total);
    let offset = 0;
    for (const c of this.chunks) {
      all.set(c, offset);
      offset += c.length;
    }
    return encodeWav(all, TARGET_RATE);
  }
}

/**
 * Talks to the translation server from the browser: your microphone goes in,
 * translated text and speech come back and are played on your speakers.
 * While the translation plays, the mic is paused so it does not translate itself.
 */
export class LiveTranslator {
  constructor({ src, tgt, speak = true, onEvent }) {
    this.opts = { src, tgt, speak };
    this.onEvent = onEvent || (() => {});
    this.nextStart = 0;
    this.pendingAudio = null;
    this.pending = 0; // sentences the server is still translating
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    this.ctx = new AudioContext();
    const params = { src: this.opts.src, tgt: this.opts.tgt, direction: 'out', platform: 'web-test', speak: this.opts.speak ? '1' : '0' };
    this.ws = new WebSocket(wsUrl(params));
    this.ws.binaryType = 'arraybuffer';
    this.ws.onmessage = (ev) => this.handle(ev.data);
    this.ws.onclose = (ev) => {
      clearTimeout(this.closeTimer);
      this.closeAudio();
      this.onEvent({ type: 'closed', code: ev.code });
    };
    this.ws.onerror = () => this.onEvent({ type: 'error', message: "Can't reach the translation server. Is it running?" });

    const src = this.ctx.createMediaStreamSource(this.stream);
    this.proc = this.ctx.createScriptProcessor(4096, 1, 1);
    const sink = this.ctx.createGain();
    sink.gain.value = 0;
    src.connect(this.proc);
    this.proc.connect(sink);
    sink.connect(this.ctx.destination);
    this.proc.onaudioprocess = (e) => {
      const data = e.inputBuffer.getChannelData(0);
      this.onEvent({ type: 'level', value: Math.min(1, rms(data) * 6) });
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const playing = this.ctx.currentTime < this.nextStart + 0.25;
      const chunk = playing ? new Float32Array(Math.floor(data.length * TARGET_RATE / this.ctx.sampleRate)) : downsampleTo16k(data, this.ctx.sampleRate);
      this.ws.send(floatToInt16(chunk).buffer);
    };
  }

  handle(data) {
    if (typeof data !== 'string') {
      const header = this.pendingAudio || { sample_rate: 24000 };
      this.pendingAudio = null;
      this.play(new Int16Array(data), header.sample_rate);
      return;
    }
    const msg = JSON.parse(data);
    if (msg.type === 'audio') {
      this.pendingAudio = msg;
      return;
    }
    if (msg.type === 'status') this.pending = msg.pending || 0;
    if (msg.type === 'pong') this.flushed = true;
    this.onEvent(msg);
    this.maybeClose();
  }

  play(pcm, rate) {
    if (!pcm.length || !this.ctx) return;
    const buf = this.ctx.createBuffer(1, pcm.length, rate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
    const node = this.ctx.createBufferSource();
    node.buffer = buf;
    node.connect(this.ctx.destination);
    const at = Math.max(this.ctx.currentTime + 0.02, this.nextStart);
    node.start(at);
    this.nextStart = at + buf.duration;
  }

  setLanguages(src, tgt) {
    this.opts.src = src;
    this.opts.tgt = tgt;
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'config', src, tgt }));
  }

  async stop() {
    if (this.stopping) return;
    this.stopping = true;
    if (this.proc) this.proc.onaudioprocess = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    if (this.ws?.readyState === WebSocket.OPEN) {
      // Translate what was said last, then close once every sentence is back.
      // The pong arrives after the server has handled the flush.
      this.ws.send(JSON.stringify({ type: 'flush' }));
      this.ws.send(JSON.stringify({ type: 'ping' }));
      this.closeTimer = setTimeout(() => this.ws?.close(), 90000); // slow CPUs
    } else {
      this.closeAudio();
    }
  }

  maybeClose() {
    if (this.stopping && this.flushed && this.pending === 0 && this.ws?.readyState === WebSocket.OPEN) this.ws.close();
  }

  /** Close the audio output after the last translation has finished playing. */
  closeAudio() {
    const ctx = this.ctx;
    if (!ctx || this.audioClosing) return;
    this.audioClosing = true;
    const wait = Math.max(0, this.nextStart - ctx.currentTime) + 1;
    setTimeout(() => ctx.close().catch(() => {}), wait * 1000);
  }
}
