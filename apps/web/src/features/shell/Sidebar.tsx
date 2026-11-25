import { NavLink } from 'react-router-dom';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/features/auth/permissions';
import { usePendingDecisions } from '@/features/leave/api/leave';
import { CompanyMenu } from './CompanyMenu';
import { UserMenu } from './UserMenu';
import { NAV, type NavItem } from './nav';

/**
 * The sidebar's contents — the same on a desktop rail and in the phone's sheet.
 * Groups with nothing the user may open are left out entirely, so an employee
 * sees a short list rather than headings over nothing.
 */
export function SidebarContent({ collapsed = false }: { collapsed?: boolean }) {
  const { can } = usePermissions();
  const pending = usePendingDecisions(can('leave.approve'));
  const counts: Record<string, number | undefined> = { '/leave/approvals': pending.data?.length };

  const groups = NAV
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.permission || can(i.permission)) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="flex h-full flex-col gap-4 px-3 py-3">
      <CompanyMenu collapsed={collapsed} />

      <nav aria-label="Main" className="-mx-1 flex-1 space-y-5 overflow-y-auto px-1">
        {groups.map((g) => (
          <div key={g.label ?? 'top'} className="space-y-0.5">
            {g.label && !collapsed && (
              <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">{g.label}</p>
            )}
            {g.label && collapsed && <div className="mx-auto mb-2 h-px w-6 bg-border" />}
            {g.items.map((item) => (
              <SidebarLink key={item.to} item={item} collapsed={collapsed} count={counts[item.to]} />
            ))}
          </div>
        ))}
      </nav>

      <UserMenu collapsed={collapsed} />
    </div>
  );
}

function SidebarLink({ item, collapsed, count }: { item: NavItem; collapsed: boolean; count?: number | undefined }) {
  const Icon = item.icon;
  const showCount = typeof count === 'number' && count > 0;

  return (
    <Tooltip content={item.label} side="right" disabled={!collapsed}>
      <NavLink
        to={item.to}
        end={item.end ?? false}
        className={({ isActive }) =>
          cn(
            'group relative flex h-8 items-center gap-2.5 rounded-md px-2 text-sm transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            collapsed && 'justify-center px-0',
            isActive
              ? 'bg-card font-medium text-foreground shadow-card ring-1 ring-border/60'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )
        }
      >
        {({ isActive }) => (
          <>
            <Icon className={cn('h-4 w-4 shrink-0', isActive && 'text-primary')} />
            {!collapsed && <span className="truncate">{item.label}</span>}
            {showCount && !collapsed && (
              <span className="figures ml-auto rounded-full bg-primary px-1.5 py-px text-[11px] font-semibold text-primary-foreground">
                {count}
              </span>
            )}
            {showCount && collapsed && (
              <span className="absolute right-1.5 top-1 h-2 w-2 rounded-full bg-primary ring-2 ring-canvas" />
            )}
          </>
        )}
      </NavLink>
    </Tooltip>
  );
}
