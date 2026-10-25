function safeStorage(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {
    return null;
  }
  return null;
}

export class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    this.muted = safeStorage('blade-storm-muted') === '1';
    this.lastHit = 0;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.26;
    const compressor = this.ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 18;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.24;
    this.master.connect(compressor);
    compressor.connect(this.ctx.destination);

    const length = Math.floor(this.ctx.sampleRate * 0.8);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;
  }

  setMuted(muted) {
    this.muted = muted;
    safeStorage('blade-storm-muted', muted ? '1' : '0');
    if (this.master) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.setTargetAtTime(muted ? 0 : 0.26, this.ctx.currentTime, 0.04);
    }
  }

  toggleMuted() {
    this.ensure();
    this.setMuted(!this.muted);
    return this.muted;
  }

  tone(freq, duration, type = 'sine', volume = 0.2, endFreq = null, delay = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + duration);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.03);
  }

  noise(duration, volume, filterType = 'bandpass', startFreq = 900, endFreq = null, delay = 0) {
    if (!this.ctx || this.muted || !this.noiseBuffer) return;
    const t = this.ctx.currentTime + delay;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(startFreq, t);
    if (endFreq) filter.frequency.exponentialRampToValueAtTime(Math.max(40, endFreq), t + duration);
    filter.Q.value = filterType === 'bandpass' ? 1.3 : 0.6;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start(t);
    source.stop(t + duration + 0.02);
  }

  hit(strength = 1) {
    if (!this.ctx) return;
    const now = performance.now();
    if (now - this.lastHit < 55) return;
    this.lastHit = now;
    this.noise(0.09, 0.14 * strength, 'bandpass', 1500, 500);
    this.tone(110, 0.12, 'triangle', 0.15 * strength, 55);
  }

  clash() {
    if (!this.ctx) return;
    this.noise(0.06, 0.08, 'highpass', 2600);
    this.tone(1720, 0.08, 'square', 0.025, 1300);
  }

  bladeBreak() {
    if (!this.ctx) return;
    this.noise(0.24, 0.2, 'highpass', 3400, 900);
    this.tone(1960, 0.18, 'square', 0.06, 620);
    this.tone(320, 0.3, 'triangle', 0.12, 140, 0.02);
  }

  kill() {
    if (!this.ctx) return;
    this.tone(196, 0.45, 'triangle', 0.16, 98);
    this.tone(587, 0.32, 'sine', 0.06, 440, 0.03);
    this.noise(0.28, 0.09, 'lowpass', 1200, 180, 0.02);
  }

  death() {
    if (!this.ctx) return;
    this.tone(146, 0.7, 'sawtooth', 0.1, 48);
    this.tone(74, 0.9, 'sine', 0.18, 40);
    this.noise(0.5, 0.1, 'lowpass', 500, 90);
  }

  dash() {
    if (!this.ctx) return;
    this.noise(0.26, 0.15, 'bandpass', 260, 2200);
    this.tone(240, 0.18, 'sine', 0.05, 720);
  }

  pickup() {
    if (!this.ctx) return;
    this.tone(660, 0.16, 'sine', 0.09, 990);
    this.tone(990, 0.2, 'sine', 0.055, 1320, 0.05);
  }

  join() {
    if (!this.ctx) return;
    this.tone(196, 0.6, 'sine', 0.08, 196);
    this.tone(392, 0.5, 'sine', 0.035, 392, 0.04);
    this.noise(0.4, 0.035, 'lowpass', 900, 200);
  }

  ui() {
    if (!this.ctx) return;
    this.tone(880, 0.055, 'sine', 0.035, 660);
  }
}
