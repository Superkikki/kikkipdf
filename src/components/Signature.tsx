import { useRef, useState } from "react";
import { Dialog } from "./Dialog";
export function Signature({
  close,
  apply,
}: {
  close: () => void;
  apply: (bytes: Uint8Array) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  return (
    <Dialog title="手書き署名" onClose={close}>
      <div className="dialog-body">
        <p className="notice">
          マウスで署名してください。画像による簡易署名です。暗号学的な電子署名ではありません。
        </p>
        <canvas
          className="signature-canvas"
          ref={canvas}
          width={800}
          height={260}
          onPointerDown={(e) => {
            const c = canvas.current!,
              r = c.getBoundingClientRect(),
              ctx = c.getContext("2d")!;
            ctx.strokeStyle = "#15283a";
            ctx.lineWidth = 3;
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(
              ((e.clientX - r.left) * c.width) / r.width,
              ((e.clientY - r.top) * c.height) / r.height,
            );
            drawing.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            const c = canvas.current!,
              r = c.getBoundingClientRect(),
              ctx = c.getContext("2d")!;
            ctx.lineTo(
              ((e.clientX - r.left) * c.width) / r.width,
              ((e.clientY - r.top) * c.height) / r.height,
            );
            ctx.stroke();
            setHasInk(true);
          }}
          onPointerUp={() => {
            drawing.current = false;
          }}
        />
        <button
          onClick={() => {
            canvas.current?.getContext("2d")?.clearRect(0, 0, 800, 260);
            setHasInk(false);
          }}
        >
          書き直す
        </button>
      </div>
      <footer>
        <button onClick={close}>キャンセル</button>
        <button
          className="primary"
          disabled={!hasInk}
          onClick={() =>
            canvas.current?.toBlob((b) => {
              if (b) void b.arrayBuffer().then((v) => apply(new Uint8Array(v)));
            })
          }
        >
          登録して配置
        </button>
      </footer>
    </Dialog>
  );
}
