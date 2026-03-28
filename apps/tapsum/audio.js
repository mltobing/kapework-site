let ctx = null;

export function toggleAmbience(btn) {
  if (!ctx) {
    ctx = new (window.AudioContext ?? window.webkitAudioContext)();

    const gain = ctx.createGain();
    gain.gain.value = 0.03;
    gain.connect(ctx.destination);

    const o1 = ctx.createOscillator();
    o1.type = 'sine'; o1.frequency.value = 220; o1.detune.value = -6;
    o1.connect(gain); o1.start();

    const o2 = ctx.createOscillator();
    o2.type = 'sine'; o2.frequency.value = 220; o2.detune.value = +6;
    o2.connect(gain); o2.start();

    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 12;
    const lfo = ctx.createOscillator();
    lfo.type = 'sine'; lfo.frequency.value = 0.08;
    lfo.connect(lfoGain);
    lfoGain.connect(o1.detune);
    lfoGain.connect(o2.detune);
    lfo.start();

    btn.textContent = '🎧 On';
    return;
  }

  if (ctx.state === 'running') {
    ctx.suspend();
    btn.textContent = '🎧';
  } else {
    ctx.resume();
    btn.textContent = '🎧 On';
  }
}
