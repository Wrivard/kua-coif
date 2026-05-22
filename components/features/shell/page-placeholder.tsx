import { Construction } from 'lucide-react';
import type { ReactNode } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';

type Props = {
  title: ReactNode;
  /** Brief description of what this screen will eventually do. Shown in the empty state. */
  description?: ReactNode;
  /** Phase reference (e.g. "Phase 4"). Optional badge in the empty state. */
  phase?: string;
};

/**
 * Skeleton page used until a real screen is built. Renders a sticky PageHeader
 * plus a centered "under construction" empty state, so the navigation still
 * works end-to-end and the layout shell can be tested.
 */
export function PagePlaceholder({ title, description, phase }: Props) {
  return (
    <>
      <PageHeader title={title} />
      <div className="p-6">
        <EmptyState
          icon={<Construction className="h-8 w-8" />}
          title={phase ? `${title} — ${phase}` : title}
          description={description}
        />
      </div>
    </>
  );
}
