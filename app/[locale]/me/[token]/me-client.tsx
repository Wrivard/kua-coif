'use client';

import { useTransition } from 'react';
import { Download, Mail, Phone, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { formatCurrencyCAD } from '@/lib/utils';
import { exportMyData } from './actions';

export function MeClient({
  locale,
  token,
  client,
  shop,
}: {
  locale: string;
  token: string;
  client: { firstName: string; loyaltyBalanceCents: number; completedCount: number };
  shop: { name: string; email: string | null; phone: string | null };
}) {
  const isFr = locale === 'fr';
  const { show } = useToast();
  const [isPending, startTransition] = useTransition();

  function downloadExport() {
    startTransition(async () => {
      const result = await exportMyData({ token });
      if (!result.ok) {
        show({
          variant: 'danger',
          title: isFr
            ? 'Le lien semble expiré. Demande un nouveau lien au salon.'
            : 'The link seems expired. Ask the shop for a new link.',
        });
        return;
      }
      // Stream the JSON to a download. Filename includes a timestamp
      // so successive exports don't overwrite each other in the
      // customer's downloads folder.
      const blob = new Blob([JSON.stringify(result.data, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `kua-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      show({
        variant: 'success',
        title: isFr ? 'Téléchargement démarré' : 'Download started',
      });
    });
  }

  const L = isFr
    ? {
        hello: `Bonjour ${client.firstName}`,
        intro: `Voici ce que ${shop.name} a sur ton compte. Tout est privé — seul le salon (et toi) y a accès.`,
        loyaltyTitle: 'Ton crédit fidélité',
        loyaltyHint: 'Appliqué automatiquement à ta prochaine réservation.',
        visits: 'visites complétées',
        loi25Title: 'Tes données (Loi 25)',
        loi25Body:
          'Tu peux télécharger une copie de toutes tes données : profil, historique de RDV, paiements. Pour supprimer ton compte, contacte le salon — c’est une opération qu’on fait avec toi pour s’assurer que rien d’important ne disparaît par erreur.',
        download: 'Télécharger mes données (JSON)',
        contactTitle: 'Contacte le salon',
      }
    : {
        hello: `Hi ${client.firstName}`,
        intro: `Here's what ${shop.name} has on your account. Everything is private — only the shop (and you) sees this.`,
        loyaltyTitle: 'Your loyalty credit',
        loyaltyHint: 'Auto-applied to your next booking.',
        visits: 'visits completed',
        loi25Title: 'Your data (Quebec Loi 25)',
        loi25Body:
          'You can download a copy of everything we have on you: profile, appointment history, payments. To delete your account, contact the shop — it’s a step we walk through together so nothing important is lost by accident.',
        download: 'Download my data (JSON)',
        contactTitle: 'Contact the shop',
      };

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-text-primary">{L.hello}</h1>
        <p className="text-sm text-text-secondary">{L.intro}</p>
      </header>

      {/* Loyalty */}
      <Card>
        <CardHeader>
          <CardTitle>
            <span className="inline-flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-accent" />
              {L.loyaltyTitle}
            </span>
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-2">
          <p className="text-3xl font-semibold tracking-tight text-text-primary">
            {formatCurrencyCAD(client.loyaltyBalanceCents / 100, isFr ? 'fr' : 'en')}
          </p>
          <p className="text-xs text-text-secondary">{L.loyaltyHint}</p>
          <p className="text-xs text-text-muted">
            {client.completedCount} {L.visits}
          </p>
        </CardBody>
      </Card>

      {/* Loi 25 self-export */}
      <Card>
        <CardHeader>
          <CardTitle>{L.loi25Title}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <p className="text-sm leading-relaxed text-text-secondary">{L.loi25Body}</p>
          <Button onClick={downloadExport} loading={isPending} variant="secondary" size="sm">
            <Download className="h-4 w-4" /> {L.download}
          </Button>
        </CardBody>
      </Card>

      {/* Shop contact */}
      {shop.email || shop.phone ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {L.contactTitle} — {shop.name}
            </CardTitle>
          </CardHeader>
          <CardBody className="space-y-2 text-sm text-text-secondary">
            {shop.phone ? (
              <p className="inline-flex items-center gap-2">
                <Phone className="h-4 w-4 text-text-muted" />
                <a href={`tel:${shop.phone}`} className="hover:text-text-primary">
                  {shop.phone}
                </a>
              </p>
            ) : null}
            {shop.email ? (
              <p className="inline-flex items-center gap-2">
                <Mail className="h-4 w-4 text-text-muted" />
                <a href={`mailto:${shop.email}`} className="hover:text-text-primary">
                  {shop.email}
                </a>
              </p>
            ) : null}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
