import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { APP_VERSION } from "../config";
import "./startup.css";

const DURATION = 9200;
const LOGS = [
  "establishing ghost protocol …",
  "0x004B / local kernel found",
  "mounting document engine",
  "decoding glyph matrix … OK",
  "isolating workspace / OFFLINE",
  "reconstructing reality …",
  "all systems under your control",
];

function ParticleField({ reduced }: { reduced: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || reduced) return;
    let frame = 0;
    let width = 0;
    let height = 0;
    const start = performance.now();
    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);
    const draw = (now: number) => {
      const t = (now - start) / 1000;
      context.clearRect(0, 0, width, height);
      const cx = width / 2;
      const cy = height * 0.45;
      // Deterministic depth field: stars accelerate away from the central core.
      for (let i = 0; i < 220; i++) {
        const angle = i * 2.399963;
        const depth = ((i * 0.137 + t * (t > 6.7 ? 0.34 : 0.055)) % 1);
        const radius = 45 + depth ** 2 * width * 0.75;
        const x = cx + Math.cos(angle + t * 0.025) * radius;
        const y = cy + Math.sin(angle + t * 0.025) * radius * 0.65;
        context.strokeStyle = `rgba(103,255,221,${depth * 0.65})`;
        context.lineWidth = depth > 0.8 ? 1.4 : 0.7;
        context.beginPath();
        context.moveTo(x, y);
        const trail = t > 6.7 ? 0.11 : 0.012;
        context.lineTo(x + (x - cx) * trail * depth, y + (y - cy) * trail * depth);
        context.stroke();
        if (i % 17 === 0) {
          context.fillStyle = `rgba(89,211,187,${depth * 0.4})`;
          context.font = "9px monospace";
          context.fillText((i * 7919).toString(16).padStart(6, "0"), x + 8, y);
        }
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, [reduced]);
  return <canvas ref={canvasRef} className="ghost-particles" aria-hidden="true" />;
}

function Opening({ onFinish, returnFocus }: { onFinish: () => void; returnFocus: HTMLElement | null }) {
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [elapsed, setElapsed] = useState(0);
  const skipRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(preference.matches);
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const previous = returnFocus ?? document.activeElement;
    skipRef.current?.focus({ preventScroll: true });
    const start = performance.now();
    const duration = reduced ? 1000 : DURATION;
    const interval = window.setInterval(() => setElapsed(performance.now() - start), 50);
    const timer = window.setTimeout(onFinish, duration);
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onFinish();
      } else if (event.key === "Tab") {
        event.preventDefault();
        skipRef.current?.focus();
      }
    };
    window.addEventListener("keydown", escape, true);
    return () => {
      clearInterval(interval);
      clearTimeout(timer);
      window.removeEventListener("keydown", escape, true);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, [onFinish, reduced, returnFocus]);
  const progress = Math.min(100, Math.floor(elapsed / (reduced ? 1000 : 7900) * 100));
  const phase = elapsed < 2100 ? "INITIALIZING" : elapsed < 5000 ? "DECRYPTING" : elapsed < 7100 ? "IDENTITY CONFIRMED" : "WELCOME TO THE OTHER SIDE";
  return (
    <section className={`ghost-opening ${reduced ? "ghost-reduced" : ""} ${elapsed > 8350 && !reduced ? "ghost-exit" : ""}`}
      role="region" aria-label="GHOST PROTOCOL 起動演出">
      <ParticleField reduced={reduced} />
      <div className="ghost-grid" aria-hidden="true" />
      <div className="ghost-scanlines" aria-hidden="true" />
      <header className="ghost-header">
        <span className="ghost-brand"><i /> KIKKI <span>/ BLACK EDITION</span></span>
        <span className="ghost-classification">CLASSIFIED — LOCAL EYES ONLY</span>
        <span className="ghost-session">SESSION 0x004B</span>
      </header>
      <div className="ghost-edge ghost-edge-left" aria-hidden="true">35°40′35.0″N &nbsp; // &nbsp; NO SIGNAL REQUIRED</div>
      <div className="ghost-edge ghost-edge-right" aria-hidden="true">独立した思考。制限のない創造。</div>
      <div className="ghost-core" aria-hidden="true">
        <div className="ghost-orbit ghost-orbit-outer" />
        <div className="ghost-orbit ghost-orbit-middle" />
        <div className="ghost-orbit ghost-orbit-inner" />
        <div className="ghost-crosshair" />
        <span className="ghost-core-coordinate">CORE / 004B</span>
      </div>
      <div className="ghost-identity">
        <div className="ghost-protocol"><span /> AN UNDOCUMENTED ENTRANCE <span /></div>
        <h1 data-text="KIKKI">KIKKI</h1>
        <p className="ghost-subtitle">G H O S T &nbsp; P R O T O C O L</p>
        <p className="ghost-motto">静寂を破れ。創造を解き放て。</p>
      </div>
      <aside className="ghost-terminal" aria-hidden="true">
        <div className="ghost-terminal-title">[ BOOT SEQUENCE ] <span>TTY / 01</span></div>
        {LOGS.map((line, i) => <div key={line} className={elapsed > 450 + i * 850 ? "ghost-log visible" : "ghost-log"}>
          <span>{String(i + 1).padStart(2, "0")}</span> {line}<b>✓</b>
        </div>)}
      </aside>
      <aside className="ghost-telemetry" aria-hidden="true">
        <span>ENVIRONMENT</span><strong>ZERO / CLOUD</strong>
        <div className="ghost-wave">{Array.from({ length: 32 }, (_, i) => <i key={i} style={{ height: `${8 + ((i * 17) % 37)}px`, animationDelay: `${i * -0.13}s` }} />)}</div>
        <small>ENCRYPTED MIND. OPEN POSSIBILITIES.</small>
      </aside>
      <footer className="ghost-footer">
        <div className="ghost-progress-label"><span><i /> {phase}</span><span>{String(progress).padStart(3, "0")} <small>/ 100</small></span></div>
        <div className="ghost-progress-track"><div style={{ width: `${progress}%` }} /></div>
        <div className="ghost-footer-bottom"><span>KIKKI PDF v{APP_VERSION} <b> // </b> THE GHOST IN YOUR MACHINE</span>
          <button ref={skipRef} onClick={onFinish} aria-label="起動演出をスキップ">SKIP INTRO <kbd>ESC</kbd></button>
        </div>
      </footer>
    </section>
  );
}

export function StartupExperience({ children }: { children: ReactNode }) {
  const [playing, setPlaying] = useState(true);
  const [returnFocus, setReturnFocus] = useState<HTMLElement | null>(null);
  const finish = useCallback(() => setPlaying(false), []);
  useEffect(() => {
    if (!playing) return;
    // Recovery and native document prompts take priority over the opening.
    const checkDialogs = () => {
      if (document.querySelector("dialog[open]")) finish();
    };
    const observer = new MutationObserver(checkDialogs);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
    checkDialogs();
    return () => observer.disconnect();
  }, [playing, finish]);
  useEffect(() => {
    const replay = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && !event.altKey && event.code === "KeyK" && !event.repeat &&
          !document.querySelector("dialog[open]") &&
          !(event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable=true]"))) {
        event.preventDefault();
        if (!playing) {
          setReturnFocus(document.activeElement instanceof HTMLElement ? document.activeElement : null);
          setPlaying(true);
        }
      }
    };
    window.addEventListener("keydown", replay);
    return () => window.removeEventListener("keydown", replay);
  }, [playing]);
  return <>
    <div inert={playing} style={{ display: "contents" }}>{children}</div>
    {playing && <Opening onFinish={finish} returnFocus={returnFocus} />}
  </>;
}
