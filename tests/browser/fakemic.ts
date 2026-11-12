// Injected into the page before the app: replaces the microphone with a Web Audio "violin" we control from tests.
export const FAKE_MIC = () => {
  const AC = window.AudioContext;
  let ctx: AudioContext | null = null;
  let dest: MediaStreamAudioDestinationNode | null = null;
  const ensure = () => {
    if (!ctx) {
      ctx = new AC();
      dest = ctx.createMediaStreamDestination();
    }
    return { ctx, dest: dest! };
  };
  const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);
  const fm = {
    follow: null as null | { cents: number; shift: number; skip: number[] },
    scheduled: new Set<number>(),
    lastJudge: null as unknown,
    tone(midi: number, dur: number, at = 0, cents = 0) {
      const { ctx, dest } = ensure();
      const t = Math.max(ctx.currentTime + 0.005, at || ctx.currentTime + 0.005);
      const g = ctx.createGain();
      g.connect(dest);
      const f = hz(midi) * 2 ** (cents / 1200);
      for (let k = 1; k <= 8; k++) {
        if (f * k > 8000) break;
        const o = ctx.createOscillator();
        o.frequency.value = f * k;
        const og = ctx.createGain();
        og.gain.value = (k === 1 ? 1 : 0.8 / k) * 0.25;
        o.connect(og).connect(g);
        o.start(t);
        o.stop(t + dur + 0.05);
      }
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.5, t + 0.02);
      g.gain.setValueAtTime(0.5, t + Math.max(0.03, dur - 0.04));
      g.gain.linearRampToValueAtTime(0, t + dur);
    },
    /** play a WAV so that its time 0 lands on performance.now() == perfMs */
    async wav(url: string, perfMs: number) {
      const { ctx, dest } = ensure();
      const buf = await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.connect(dest);
      const at = ctx.currentTime + (perfMs - performance.now()) / 1000;
      if (at >= ctx.currentTime) s.start(at);
      else s.start(ctx.currentTime, ctx.currentTime - at);
    },
    /** auto-player: plays whatever the app expects next (normal mode: on time; wait mode: as soon as it waits) */
    startFollow(opts: { cents?: number; shift?: number; skip?: number[] } = {}) {
      fm.follow = { cents: opts.cents ?? 0, shift: opts.shift ?? 0, skip: opts.skip ?? [] };
      fm.scheduled.clear();
    },
    stop() {
      fm.follow = null;
    },
  };
  setInterval(() => {
    const f = fm.follow;
    const gs = (window as unknown as { __gs?: { play?: { view(): { state: string; waiting: boolean; spb: number }; judge: { notes: { midi: number; start: number; dur: number }[]; index: number } | null; perfOfBeat(b: number): number } } }).__gs;
    const p = gs?.play;
    if (!f || !p || !p.judge) return;
    const v = p.view();
    if (v.state === "ready" || v.state === "done" || v.state === "paused") return;
    const { ctx } = ensure();
    if (p.judge !== fm.lastJudge) {
      fm.lastJudge = p.judge;
      fm.scheduled.clear();
    }
    const notes = p.judge.notes;
    for (let i = p.judge.index; i < Math.min(notes.length, p.judge.index + 4); i++) {
      const n = notes[i];
      const key = n.start * 1000 + n.midi;
      if (fm.scheduled.has(key)) continue;
      if (v.waiting && i > p.judge.index) break;
      const due = v.waiting ? performance.now() : p.perfOfBeat(n.start);
      if (due - performance.now() > 150) break;
      fm.scheduled.add(key);
      if (f.skip.includes(i)) continue;
      const at = ctx.currentTime + Math.max(0, due - performance.now()) / 1000;
      fm.tone(n.midi + f.shift, Math.max(0.12, n.dur * v.spb - 0.05), at, f.cents);
    }
  }, 15);
  (window as unknown as { __fakeMic: typeof fm }).__fakeMic = fm;
  navigator.mediaDevices.getUserMedia = async () => {
    const { ctx, dest } = ensure();
    await ctx.resume();
    return dest.stream;
  };
};
