/**
 * Haptic feedback + subtle sounds (Web Audio API, no external files).
 * Sounds are short sine/triangle tones inspired by iMessage/WhatsApp.
 */

let audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

function playTone(
  frequency: number,
  duration: number,
  type: OscillatorType = "sine",
  volume = 0.12
) {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, ctx.currentTime);
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch {
    // Audio not available — fail silently
  }
}

function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Vibration API not available
  }
}

/** Subtle "whoosh" when sending a message */
export function feedbackSend() {
  vibrate(15);
  playTone(880, 0.08, "sine", 0.1);
  setTimeout(() => playTone(1100, 0.06, "sine", 0.07), 50);
}

/** Gentle pop when a response arrives */
export function feedbackReceive() {
  vibrate([10, 30, 10]);
  playTone(660, 0.1, "triangle", 0.1);
  setTimeout(() => playTone(880, 0.08, "triangle", 0.08), 80);
}

/** Quick tap when attaching a file */
export function feedbackAttach() {
  vibrate(10);
  playTone(700, 0.06, "sine", 0.08);
}

/** Light click when removing an attachment */
export function feedbackRemove() {
  vibrate(8);
  playTone(400, 0.06, "triangle", 0.08);
}
