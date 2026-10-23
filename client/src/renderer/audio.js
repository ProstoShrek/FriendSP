// Аудиодвижок: один и тот же звук играет сразу в два устройства —
// «мне» (наушники) и «в Discord» (виртуальный кабель). В кабель же
// подмешивается микрофон, чтобы друзья слышали и голос, и звуки.

const decoded = new Map(); // hash -> AudioBuffer

class Output {
  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.sinkId = '';
  }

  async setSink(deviceId) {
    // '' = системное устройство по умолчанию; 'none' = выключено
    const id = deviceId || '';
    if (id === this.sinkId) return;
    this.sinkId = id;
    if (id === 'none') {
      this.master.disconnect();
      return;
    }
    try { this.master.connect(this.ctx.destination); } catch { /* уже подключён */ }
    await this.ctx.setSinkId(id);
  }

  setVolume(v) {
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }
}

export class AudioEngine {
  constructor() {
    this.monitor = new Output();
    this.cable = new Output();
    this.playing = new Map(); // playId -> { soundId, nodes, startedAt, duration }
    this.nextId = 1;
    this.mic = null;
    this.micGain = this.cable.ctx.createGain();
    this.micGain.connect(this.cable.master);
    this.overlap = true;
    this.onChange = () => {};
  }

  async listDevices() {
    let devices = await navigator.mediaDevices.enumerateDevices();
    // Без разрешения на микрофон имена устройств пустые — просим один раз
    if (devices.some((d) => !d.label)) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach((t) => t.stop());
        devices = await navigator.mediaDevices.enumerateDevices();
      } catch { /* микрофона нет — просто без имён */ }
    }
    const clean = (d) => ({ id: d.deviceId, label: d.label || 'Устройство' });
    return {
      outputs: devices.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'communications').map(clean),
      inputs: devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications').map(clean),
    };
  }

  /** Пытается найти VB-Cable или похожий виртуальный кабель. */
  static guessCable(outputs) {
    const re = /cable input|vb-audio|voicemeeter input|virtual audio/i;
    return outputs.find((d) => re.test(d.label) && d.id !== 'default')?.id ?? '';
  }

  static guessCableMic(inputs) {
    return inputs.find((d) => /cable output/i.test(d.label))?.id ?? '';
  }

  async configure({ monitorDevice, cableDevice, monitorVolume, cableVolume, micDevice, micEnabled, micVolume, overlap }) {
    await this.monitor.setSink(monitorDevice);
    await this.cable.setSink(cableDevice || 'none');
    this.monitor.setVolume(monitorVolume ?? 0.6);
    this.cable.setVolume(cableVolume ?? 0.8);
    this.micGain.gain.value = micVolume ?? 1;
    this.overlap = overlap ?? true;
    await this.setMic(micEnabled && cableDevice ? micDevice || 'default' : null);
  }

  async setMic(deviceId) {
    const key = deviceId ?? null;
    if (this.mic?.key === key) return;
    if (this.mic) {
      this.mic.source.disconnect();
      this.mic.stream.getTracks().forEach((t) => t.stop());
      this.mic = null;
    }
    if (!key) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: key === 'default' ? undefined : { exact: key },
        // Обработку голоса оставляем Discord, иначе звук «дважды» обработается
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    const source = this.cable.ctx.createMediaStreamSource(stream);
    source.connect(this.micGain);
    this.mic = { key, stream, source };
  }

  async decode(sound, loadBytes) {
    if (decoded.has(sound.hash)) return decoded.get(sound.hash);
    const bytes = await loadBytes(sound);
    const buf = await this.monitor.ctx.decodeAudioData(bytes);
    decoded.set(sound.hash, buf);
    return buf;
  }

  forget(hashes) {
    for (const h of decoded.keys()) if (!hashes.has(h)) decoded.delete(h);
  }

  async play(sound, loadBytes, { volume = 1 } = {}) {
    for (const ctx of [this.monitor.ctx, this.cable.ctx]) if (ctx.state === 'suspended') await ctx.resume();
    const buffer = await this.decode(sound, loadBytes);
    if (!this.overlap) this.stopAll();

    const id = this.nextId++;
    const nodes = [];
    const gainValue = (sound.volume ?? 1) * volume;
    for (const out of [this.monitor, this.cable]) {
      if (out.sinkId === 'none') continue;
      const src = out.ctx.createBufferSource();
      src.buffer = buffer;
      const g = out.ctx.createGain();
      g.gain.value = gainValue;
      src.connect(g).connect(out.master);
      src.start();
      nodes.push({ src, g });
    }
    const entry = { id, soundId: sound.id, nodes, startedAt: performance.now(), duration: buffer.duration * 1000 };
    this.playing.set(id, entry);
    nodes[0]?.src.addEventListener('ended', () => {
      this.playing.delete(id);
      this.onChange();
    });
    this.onChange();
    return id;
  }

  stop(soundId) {
    for (const [id, p] of this.playing) {
      if (p.soundId !== soundId) continue;
      p.nodes.forEach(({ src }) => { try { src.stop(); } catch { /* уже остановлен */ } });
      this.playing.delete(id);
    }
    this.onChange();
  }

  stopAll() {
    for (const p of this.playing.values()) {
      p.nodes.forEach(({ src }) => { try { src.stop(); } catch { /* уже остановлен */ } });
    }
    this.playing.clear();
    this.onChange();
  }

  isPlaying(soundId) {
    for (const p of this.playing.values()) if (p.soundId === soundId) return true;
    return false;
  }

  /** Прогресс самого свежего проигрывания звука, 0..1 */
  progress(soundId) {
    let best = null;
    for (const p of this.playing.values()) if (p.soundId === soundId && (!best || p.startedAt > best.startedAt)) best = p;
    if (!best) return 0;
    return Math.min(1, (performance.now() - best.startedAt) / best.duration);
  }
}
