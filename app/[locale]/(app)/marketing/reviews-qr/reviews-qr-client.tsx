'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import QRCode from 'qrcode';
import { Download, Printer, QrCode as QrCodeIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';
import { saveReviewUrl } from './actions';

type Labels = {
  title: string;
  subtitle: string;
  formLabel: string;
  formPlaceholder: string;
  formHint: string;
  save: string;
  download: string;
  print: string;
  emptyTitle: string;
  emptyDescription: string;
  savedToast: string;
  invalidUrl: string;
  unexpected: string;
  printHeading: string;
  printSubheading: string;
};

type Props = {
  locale: string;
  shopName: string;
  initialUrl: string;
  initialQrDataUrl: string | null;
  labels: Labels;
};

/**
 * Loop 58 — Review QR code page client.
 *
 * Two halves:
 *   1. Form: URL input + Save action. Re-renders the QR preview as the
 *      owner types (no save required for the preview).
 *   2. Preview pane: shows the QR code + Download/Print buttons. The
 *      print view uses a hidden #print-area with display:none in
 *      screen media and a media-query in the page CSS to flip on print.
 *
 * QR generation is client-side via the `qrcode` library (~50 KB). The
 * server pre-renders the initial QR so the first paint is instant; the
 * client takes over on edit.
 */
export function ReviewsQrClient({ shopName, initialUrl, initialQrDataUrl, labels }: Props) {
  const { show } = useToast();
  const [saving, startSave] = useTransition();
  const [url, setUrl] = useState(initialUrl);
  const [previewUrl, setPreviewUrl] = useState(initialUrl);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(initialQrDataUrl);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Regenerate preview as the user types, debounced 250ms so we don't
  // run QR.toDataURL on every keystroke for long URLs.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!previewUrl || !/^https:\/\/.+/i.test(previewUrl)) {
      setQrDataUrl(null);
      return;
    }
    debounceRef.current = setTimeout(() => {
      QRCode.toDataURL(previewUrl, {
        errorCorrectionLevel: 'H',
        margin: 1,
        width: 512,
      })
        .then(setQrDataUrl)
        .catch(() => setQrDataUrl(null));
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [previewUrl]);

  function onSave() {
    startSave(async () => {
      const result = await saveReviewUrl({ public_review_url: url });
      if (result.ok) {
        show({ variant: 'success', title: labels.savedToast });
        setPreviewUrl(url); // sync preview to saved state
      } else {
        const msg = result.errorCode === 'INVALID_INPUT' ? labels.invalidUrl : labels.unexpected;
        show({ variant: 'danger', title: msg });
      }
    });
  }

  function onDownload() {
    if (!qrDataUrl) return;
    const a = document.createElement('a');
    a.href = qrDataUrl;
    // `kua-review-qr-<shop>.png` — predictable filename for the
    // operator's downloads folder. Strip everything non-filename-safe
    // out of the shop name.
    const safe = shopName.replace(/[^a-z0-9-]+/gi, '-').toLowerCase() || 'shop';
    a.download = `kua-review-qr-${safe}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function onPrint() {
    // Print uses the browser's native dialog. The print stylesheet
    // (inline below in a <style media="print">) hides everything
    // except the print-area block — so the printed page is just the
    // shop name + QR code, ready to laminate.
    window.print();
  }

  return (
    <>
      <PageHeader title={labels.title} subtitle={labels.subtitle} />

      {/* Print-only styles. The screen view stays untouched; printing
       *  collapses everything except #review-qr-print to give the
       *  operator a clean poster. */}
      <style
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html: `
            @media print {
              body * { visibility: hidden !important; }
              #review-qr-print, #review-qr-print * { visibility: visible !important; }
              #review-qr-print { position: absolute; left: 0; top: 0; width: 100%; padding: 4rem; text-align: center; background: white; color: black; }
              #review-qr-print img { display: inline-block; width: 60vmin; height: 60vmin; }
            }
          `,
        }}
      />

      <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-2">
        {/* ── Form ───────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>{labels.formLabel}</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <div>
              <Label htmlFor="review_url" required>
                {labels.formLabel}
              </Label>
              <Input
                id="review_url"
                type="url"
                inputMode="url"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setPreviewUrl(e.target.value);
                }}
                placeholder={labels.formPlaceholder}
                autoComplete="off"
              />
              <p className="mt-1 text-xs text-text-muted">{labels.formHint}</p>
            </div>
            <div className="flex justify-end border-t border-border pt-4">
              <Button
                type="button"
                onClick={onSave}
                loading={saving}
                disabled={url === previewUrl && url === initialUrl}
              >
                {labels.save}
              </Button>
            </div>
          </CardBody>
        </Card>

        {/* ── Preview ────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>{labels.title}</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="flex aspect-square w-full items-center justify-center rounded-md bg-white p-4">
              {qrDataUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={qrDataUrl} alt={labels.title} className="h-full w-full object-contain" />
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 text-center text-text-muted">
                  <QrCodeIcon className="h-12 w-12" />
                  <p className="font-medium text-text-secondary">{labels.emptyTitle}</p>
                  <p className="max-w-xs text-xs">{labels.emptyDescription}</p>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={onDownload} disabled={!qrDataUrl}>
                <Download className="h-4 w-4" /> {labels.download}
              </Button>
              <Button type="button" variant="secondary" onClick={onPrint} disabled={!qrDataUrl}>
                <Printer className="h-4 w-4" /> {labels.print}
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Off-screen print poster. Hidden in screen media; revealed by
       *  the @media print stylesheet above when the user hits Print. */}
      <div id="review-qr-print" className="hidden">
        <h2 style={{ fontSize: '2.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>
          {shopName || labels.printHeading}
        </h2>
        <p style={{ fontSize: '1.25rem', marginBottom: '2rem' }}>{labels.printSubheading}</p>
        {qrDataUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={qrDataUrl} alt={labels.title} />
        ) : null}
      </div>
    </>
  );
}
