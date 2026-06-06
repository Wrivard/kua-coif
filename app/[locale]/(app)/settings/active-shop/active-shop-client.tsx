'use client';

import { useState, useTransition } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
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
  const [picked, setPicked] = useState(activeShopId ?? rows[0]?.shop_id);
  const [isPending, startTransition] = useTransition();

  function save() {
    if (!picked) return;
    startTransition(async () => {
      const result = await selectShop({ shop_id: picked });
      if (result.ok) {
        show({ variant: 'success', title: 'Active shop updated' });
      } else {
        show({ variant: 'danger', title: 'Could not switch — refresh and try again.' });
      }
    });
  }

  if (rows.length <= 1) {
    return (
      <div className="p-6">
        <Card>
          <CardBody>
            <p className="text-sm text-text-secondary">
              You have access to a single shop. Once an owner invites you to another, you’ll be able
              to switch here.
            </p>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle>Pick the shop you want to manage</CardTitle>
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
                    : 'hover:border-accent/40 border-border bg-bg-base hover:-translate-y-0.5 hover:shadow-md')
                }
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-text-primary">{r.name}</p>
                  <p className="text-[11px] uppercase tracking-wide text-text-muted">{r.role}</p>
                </div>
                <div className="flex items-center gap-2">
                  {isCurrent ? (
                    <span className="rounded-full bg-accent-subtle px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-text">
                      Current
                    </span>
                  ) : null}
                  {isPicked ? <CheckCircle2 className="h-5 w-5 text-accent" aria-hidden /> : null}
                </div>
              </button>
            );
          })}
        </CardBody>
      </Card>
      <div className="flex justify-end">
        <Button onClick={save} loading={isPending} disabled={picked === activeShopId}>
          Switch
        </Button>
      </div>
    </div>
  );
}
