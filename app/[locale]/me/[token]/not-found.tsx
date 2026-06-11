import { TokenLinkInvalid } from '@/components/token-link-invalid';

// Plan 037 (UX-01) — branded landing for invalid/expired /me tokens; the
// segment's notFound() calls resolve here instead of the generic Küa 404.
export default function MeTokenNotFound() {
  return <TokenLinkInvalid />;
}
