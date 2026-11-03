// Звуковые сигналы через Web Audio — без файлов.
// Браузер разрешает звук только после касания экрана, поэтому контекст «будим» при первом касании.

let ctx: AudioContext | undefined

function audio(): AudioContext | undefined {
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return undefined
    ctx = new Ctor()
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

for (const type of ['pointerdown', 'keydown'] as const) document.addEventListener(type, () => audio(), { capture: true, passive: true })

/** Конец матча: три коротких громких сигнала. */
export function beepFinal() {
  const ac = audio()
  if (!ac) return
  const start = ac.currentTime + 0.05
  for (let i = 0; i < 3; i++) {
    const t = start + i * 0.35
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    osc.type = 'square'
    osc.frequency.value = 1000
    // плавные края, чтобы не щёлкало
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(0.25, t + 0.01)
    gain.gain.setValueAtTime(0.25, t + (i === 2 ? 0.6 : 0.2))
    gain.gain.linearRampToValueAtTime(0, t + (i === 2 ? 0.62 : 0.22))
    osc.connect(gain).connect(ac.destination)
    osc.start(t)
    osc.stop(t + 0.7)
  }
}
