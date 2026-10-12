import qrcode from "qrcode-generator";
import { useState } from "react";

/** A QR code as an SVG, with a PNG download. */
function Qr({ text, file }: { text: string; file: string }) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const cells: string[] = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) cells.push(`M${c + 4} ${r + 4}h1v1h-1z`);
  function png() {
    const scale = 12;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = (n + 8) * scale;
    const g = canvas.getContext("2d");
    if (!g) return;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = "#000";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect((c + 4) * scale, (r + 4) * scale, scale, scale);
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = file;
    a.click();
  }
  return (
    <div className="qr">
      <svg viewBox={`0 0 ${n + 8} ${n + 8}`} role="img" aria-label={`QR code for ${text}`} shapeRendering="crispEdges">
        <rect width={n + 8} height={n + 8} fill="#fff" />
        <path d={cells.join("")} fill="#000" />
      </svg>
      <button type="button" onClick={png}>
        Download PNG
      </button>
    </div>
  );
}

/** A link with Copy; `note` replaces the QR (a link that can't work yet), `warning` sits above it. */
export function ShareLine({ label, url, file, note, warning }: { label: string; url: string; file: string; note?: string; warning?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="share-line">
      <div>
        <h4>{label}</h4>
        <code>{url}</code>{" "}
        <button
          type="button"
          onClick={() =>
            void navigator.clipboard.writeText(url).then(
              () => setCopied(true),
              () => setCopied(false),
            )
          }
        >
          {copied ? "Copied" : "Copy"}
        </button>
        {note && <p className="share-note">{note}</p>}
      </div>
      {!note && (
        <div className="qr-block">
          {warning && <p className="share-note qr-warning">{warning}</p>}
          <Qr text={url} file={file} />
        </div>
      )}
    </div>
  );
}
