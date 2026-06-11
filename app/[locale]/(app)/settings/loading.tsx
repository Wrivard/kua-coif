import { Skeleton } from '@/components/ui/skeleton';

/**
 * Pane-only loading skeleton for /settings/* (plan 034). It renders inside
 * the settings layout's content slot, so the persistent sub-rail
 * (settings/layout.tsx → SettingsSidebar) STAYS MOUNTED while a pane
 * suspends. Without this file, suspension bubbled up to the generic (app)
 * boundary and the whole settings shell — rail included — vanished on every
 * settings click, making each one feel like a full app reload.
 */
export default function SettingsLoading() {
  return (
    <div className="flex flex-col">
      {/* Pane header band — title + a save-action placeholder. */}
      <div className="flex h-header-h items-center gap-4 border-b border-border bg-bg-base/95 px-6 backdrop-blur">
        <Skeleton className="h-6 w-40" />
        <div className="flex-1" />
        <Skeleton className="h-8 w-24" />
      </div>

      {/* Typical settings pane: a card of labelled form rows. */}
      <div className="max-w-3xl space-y-6 p-6">
        <div className="space-y-5 rounded-lg bg-bg-surface p-6 shadow-sm">
          <div className="space-y-2">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-10 w-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3 w-36" />
            <Skeleton className="h-10 w-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-10 w-2/3" />
          </div>
          <Skeleton className="h-9 w-28" />
        </div>
      </div>
    </div>
  );
}
