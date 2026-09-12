import qrcode from "qrcode-generator";

// Small SVG QR renderer for otpauth:// URIs (MFA enrollment) — typeNumber 0
// lets the library auto-pick the smallest size that fits `value`, "M" is a
// reasonable default error-correction level for a screen-scanned code.
export function QrCode({ value, size = 176 }: { value: string; size?: number }) {
  const qr = qrcode(0, "M");
  qr.addData(value);
  qr.make();
  const count = qr.getModuleCount();
  const cell = size / count;
  let path = "";
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) {
        path += `M${col * cell},${row * cell}h${cell}v${cell}h${-cell}z`;
      }
    }
  }
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      className="rounded-lg border border-line/40 bg-white p-2"
      role="img"
      aria-label="QR code"
    >
      <path d={path} fill="#000" />
    </svg>
  );
}
