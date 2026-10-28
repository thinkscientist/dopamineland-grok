const NOTES = [293.66, 349.23, 392.0, 440.0, 523.25, 587.33, 659.25];

const MOODS = {
  drift: { a: 73.42, b: 110.0, filter: 480 },
  surge: { a: 110.0, b: 164.81, filter: 1480 },
  candy: { a: 87.31, b: 138.59, filter: 860 },
};

export class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.filter = null;
    this.analyser = null;
    this.bins = null;
    this.enabled = false;
    this.energyValue = 0;
    this.note = 0;
    this.noiseBuffer = null;
    this.mood = "drift";
  }

  unlock() {
    if (!this.ctx) this.build();
    if (this.ctx.state !== "running") this.ctx.resume();
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0.85, now + 1.4);
    this.enabled = true;
  }

  toggle() {
    if (!this.ctx || !this.enabled) {
      this.unlock();
      return true;
    }
    this.enabled = false;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(0, now, 0.03);
    return false;
  }

  setMood(name) {
    this.mood = MOODS[name] ? name : "drift";
    if (!this.ctx || !this.oscA) return;
    const mood = MOODS[this.mood];
    const now = this.ctx.currentTime;
    this.oscA.frequency.setTargetAtTime(mood.a, now, 0.4);
    this.oscB.frequency.setTargetAtTime(mood.b, now, 0.4);
    this.filter.frequency.setTargetAtTime(mood.filter, now, 0.35);
  }

  ping() {
    if (!this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    const freq = NOTES[this.note % NOTES.length];
    this.note += 1;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.04, now + 0.18);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.22, now + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
    osc.connect(gain);
    gain.connect(this.bus);
    osc.start(now);
    osc.stop(now + 0.6);

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const ng = this.ctx.createGain();
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1800;
    ng.gain.setValueAtTime(0.12, now);
    ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    noise.connect(hp);
    hp.connect(ng);
    ng.connect(this.bus);
    noise.start(now);
    noise.stop(now + 0.15);
  }

  energy() {
    if (!this.analyser || !this.enabled) return 0;
    this.analyser.getByteFrequencyData(this.bins);
    let sum = 0;
    const n = 10;
    for (let i = 1; i < n; i++) sum += this.bins[i];
    const bass = sum / (n * 255);
    this.energyValue += (bass - this.energyValue) * 0.18;
    return this.energyValue;
  }

  build() {
    const ctx = new AudioContext();
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = 0;
    this.master = master;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 18;
    comp.ratio.value = 3.2;
    comp.attack.value = 0.012;
    comp.release.value = 0.28;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.82;
    this.analyser = analyser;
    this.bins = new Uint8Array(analyser.frequencyBinCount);

    master.connect(comp);
    comp.connect(analyser);
    analyser.connect(ctx.destination);

    const bus = ctx.createGain();
    bus.gain.value = 1;
    this.bus = bus;

    const convolver = ctx.createConvolver();
    convolver.buffer = makeImpulse(ctx, 1.8, 2.4);
    const wet = ctx.createGain();
    wet.gain.value = 0.38;
    const dry = ctx.createGain();
    dry.gain.value = 0.78;
    bus.connect(dry);
    bus.connect(convolver);
    convolver.connect(wet);
    dry.connect(master);
    wet.connect(master);

    const mood = MOODS[this.mood];
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = mood.filter;
    filter.Q.value = 0.7;
    this.filter = filter;
    filter.connect(bus);

    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    const gainA = ctx.createGain();
    const gainB = ctx.createGain();
    oscA.type = "triangle";
    oscB.type = "triangle";
    oscA.frequency.value = mood.a;
    oscB.frequency.value = mood.b;
    oscB.detune.value = 8;
    gainA.gain.value = 0.07;
    gainB.gain.value = 0.05;
    oscA.connect(gainA);
    oscB.connect(gainB);
    gainA.connect(filter);
    gainB.connect(filter);
    oscA.start();
    oscB.start();
    this.oscA = oscA;
    this.oscB = oscB;

    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.07;
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();

    this.noiseBuffer = makeNoiseBurst(ctx);
  }
}

function makeImpulse(ctx, seconds, decay) {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const impulse = ctx.createBuffer(2, length, rate);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}

function makeNoiseBurst(ctx) {
  const length = Math.floor(ctx.sampleRate * 0.12);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.2);
  }
  return buffer;
}
