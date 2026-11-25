import { Building2, Check, ChevronsUpDown } from 'lucide-react';
import { toast } from 'sonner';
import { LogoMark } from '@/components/brand/logo';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useSwitchTenant } from '@/features/auth/api/auth';
import { usePermissions } from '@/features/auth/permissions';

/**
 * The top of the sidebar: whose company this is, and — for the CA firm's
 * accountant serving several of our customers (D-16) — the control that changes
 * it. Switching re-issues the token server-side; the API re-checks membership.
 */
export function CompanyMenu({ collapsed }: { collapsed: boolean }) {
  const { session } = usePermissions();
  const switchTenant = useSwitchTenant();
  if (!session) return null;

  const current = session.tenants.find((t) => t.id === session.tenantId);
  const canSwitch = session.tenants.length > 1;

  const face = (
    <span className={cn('flex min-w-0 items-center gap-2.5', collapsed && 'justify-center')}>
      <LogoMark />
      {!collapsed && (
        <span className="min-w-0 text-left">
          <span className="block truncate text-sm font-semibold leading-tight">{current?.name ?? 'PeoplePulse'}</span>
          <span className="block text-xs text-muted-foreground">PeoplePulse</span>
        </span>
      )}
    </span>
  );

  if (!canSwitch) return <div className="flex h-11 items-center px-1.5">{face}</div>;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Switch company"
        className={cn(
          'flex h-11 w-full items-center justify-between gap-2 rounded-lg px-1.5 transition-colors',
          'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        {face}
        {!collapsed && <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Your companies</DropdownMenuLabel>
        {session.tenants.map((t) => (
          <DropdownMenuItem
            key={t.id}
            disabled={switchTenant.isPending}
            onSelect={() => {
              if (t.id === session.tenantId) return;
              switchTenant.mutate(t.id, { onError: (e) => toast.error(e.message) });
            }}
          >
            <Building2 />
            <span className="flex-1 truncate">{t.name}</span>
            {t.id === session.tenantId && <Check className="!text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
