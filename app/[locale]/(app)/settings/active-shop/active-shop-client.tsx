'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2 } from 'lucide-react';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { selectShop } from '../../actions-shop-switcher';

type Row = { shop_id: string; name: string; role: string };

export function ActiveShopClient({
  activeShopId,
  rows,
}: {
  activeShopId: string | null;
  rows: Row[];
}) {
  const { show } = useToast();
  const t = useTranslations('pages.settings.activeShop');
  const [picked, setPicked] = useState(activeShopId ?? rows[0]?.shop_id);
  const [isPending, startTransition] = useTransition();

  function save() {
    if (!picked) return;
    startTransition(async () => {
      const result = await selectShop({ shop_id: picked });
      if (result.ok) {
        show({ variant: 'success', title: t('toasts.updated') });
      } else {
        show({ variant: 'danger', title: t('toasts.error') });
      }
    });
  }

  if (rows.length <= 1) {
    return (
      <div className="p-6">
        <Card>
          <CardBody>
            <p className="text-sm text-text-secondary">{t('singleShop')}</p>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('pickTitle')}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-2">
          {rows.map((r) => {
            const isPicked = picked === r.shop_id;
            const isCurrent = activeShopId === r.shop_id;
            return (
              <button
                key={r.shop_id}
                type="button"
                onClick={() => setPicked(r.shop_id)}
                className={
                  'group flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left shadow-sm transition-all duration-150 ease-out-quint focus:outline-none focus-visible:ring-2 focus-visible:ring-focus ' +
                  (isPicked
                    ? 'border-accent bg-accent-subtle'
                    : 'border-border bg-bg-base hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-md')
                }
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-text-primary">{r.name}</p>
                  <p className="text-[11px] uppercase tracking-wide text-text-muted">{r.role}</p>
                </div>
                <div className="flex items-center gap-2">
                  {isCurrent ? <Badge variant="accent">{t('current')}</Badge> : null}
                  {isPicked ? <CheckCircle2 className="h-5 w-5 text-accent" aria-hidden /> : null}
                </div>
              </button>
            );
          })}
        </CardBody>
      </Card>
      <div className="flex justify-end">
        <Button onClick={save} loading={isPending} disabled={picked === activeShopId}>
          {t('switch')}
        </Button>
      </div>
    </div>
  );
}
