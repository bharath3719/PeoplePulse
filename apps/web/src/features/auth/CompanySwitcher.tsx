import { Select } from '@/components/ui/select';
import { useSwitchTenant } from './api/auth';
import { usePermissions } from './permissions';

/**
 * The active company, and — for the CA firm's accountant serving several of our
 * customers (D-16) — the control that changes it.
 *
 * Most users belong to one company and see only its name. Switching re-issues
 * the token server-side; nothing here decides who may see what. The list comes
 * from /auth/me, and the API re-checks membership on every switch.
 */
export function CompanySwitcher() {
  const { session } = usePermissions();
  const switchTenant = useSwitchTenant();

  if (!session) return null;
  const current = session.tenants.find((t) => t.id === session.tenantId);

  return (
    <div className="flex items-center gap-2">
      {/* Outside the branch below: a refusal refetches the list, and if that
          leaves one company the dropdown is gone — the reason must not go with it. */}
      {switchTenant.isError && (
        <span role="alert" className="text-xs font-medium text-destructive">
          {switchTenant.error.message}
        </span>
      )}
      {session.tenants.length < 2 ? (
        current && <span className="hidden text-sm text-muted-foreground sm:inline">{current.name}</span>
      ) : (
        <Select
          aria-label="Company"
          value={session.tenantId}
          disabled={switchTenant.isPending}
          onChange={(e) => switchTenant.mutate(e.target.value)}
          className="h-8 w-auto max-w-56"
        >
          {session.tenants.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </Select>
      )}
    </div>
  );
}
