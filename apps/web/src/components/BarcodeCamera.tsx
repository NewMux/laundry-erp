import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { Camera, CameraOff, SwitchCamera } from 'lucide-react';
import { Button } from './ui';

/**
 * Live camera barcode reader (Code 128 tags, receipt barcodes and QR codes).
 * Works on phones/tablets over HTTPS. Repeated reads of the same code are ignored for a few seconds.
 */
export function BarcodeCamera({ onCode, autoStart = false }: { onCode: (code: string) => void; autoStart?: boolean }) {
  const { t } = useTranslation();
  const video = useRef<HTMLVideoElement>(null);
  const controls = useRef<IScannerControls | null>(null);
  const last = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const cb = useRef(onCode);
  cb.current = onCode;
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');

  const stop = () => {
    controls.current?.stop();
    controls.current = null;
    setRunning(false);
  };

  const start = async (mode = facing) => {
    setError(null);
    stop();
    try {
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.QR_CODE]);
      const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120 });
      controls.current = await reader.decodeFromConstraints({ video: { facingMode: mode, width: { ideal: 1280 } } }, video.current!, (result) => {
        if (!result) return;
        const code = result.getText();
        const now = Date.now();
        if (code === last.current.code && now - last.current.at < 2500) return;
        last.current = { code, at: now };
        cb.current(code);
      });
      setRunning(true);
    } catch {
      setError(t('tracking.cameraError'));
      setRunning(false);
    }
  };

  useEffect(() => {
    if (autoStart) void start();
    return stop;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-2">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-slate-900">
        <video ref={video} className="size-full object-cover" muted playsInline />
        {running && <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-rose-500/80 shadow-[0_0_12px_rgba(244,63,94,.8)]" />}
        {!running && (
          <div className="absolute inset-0 grid place-items-center">
            <Button size="lg" icon={<Camera className="size-5" />} onClick={() => start()}>
              {t('tracking.startCamera')}
            </Button>
          </div>
        )}
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      {running && (
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" icon={<CameraOff className="size-4" />} onClick={stop}>
            {t('tracking.stopCamera')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<SwitchCamera className="size-4" />}
            onClick={() => {
              const next = facing === 'environment' ? 'user' : 'environment';
              setFacing(next);
              void start(next);
            }}
          >
            {t('tracking.switchCamera')}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Turn whatever was scanned into an order code: tag "1042-3", receipt "O1042", or the receipt QR link. */
export async function normalizeScanCode(raw: string, lookupById: (id: string) => Promise<number | null>): Promise<string> {
  const text = raw.trim();
  const m = /\/receipt\/([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/.exec(text);
  if (m) {
    try {
      const json = JSON.parse(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (json?.o) {
        const no = await lookupById(json.o);
        if (no) return `O${no}`;
      }
    } catch {
      /* not one of our links */
    }
  }
  return text;
}
