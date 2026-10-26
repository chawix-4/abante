let sharedAudioContext: AudioContext | null = null;

/**
 * Plays a gentle, non-jarring two-tone civic chime when a new queue number is called
 * on the Public Display (only when explicitly unmuted by the display operator).
 */
export function playCivicTurnChime(): void {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    if (!sharedAudioContext) {
      sharedAudioContext = new AudioCtx();
    }
    if (sharedAudioContext.state === 'suspended') {
      void sharedAudioContext.resume();
    }

    const now = sharedAudioContext.currentTime;

    const playTone = (freq: number, startOffset: number, duration: number) => {
      if (!sharedAudioContext) return;
      const osc = sharedAudioContext.createOscillator();
      const gain = sharedAudioContext.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + startOffset);

      gain.gain.setValueAtTime(0.0001, now + startOffset);
      gain.gain.exponentialRampToValueAtTime(0.14, now + startOffset + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + startOffset + duration);

      osc.connect(gain);
      gain.connect(sharedAudioContext.destination);

      osc.start(now + startOffset);
      osc.stop(now + startOffset + duration + 0.02);
    };

    // Calm major-third chime (E5 -> G#5)
    playTone(659.25, 0, 0.35);
    playTone(830.61, 0.22, 0.5);
  } catch {
    // Audio playback blocked or unsupported; visual display remains primary
  }
}
