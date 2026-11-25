import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarPlus, LogOut, Moon, Sun, Upload, UserPlus, UserRoundPlus } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Dialog, DialogOverlay, DialogPortal, DialogTitle } from '@/components/ui/dialog';
import { useTheme } from '@/lib/theme';
import { signOut } from '@/features/auth/api/auth';
import { usePermissions } from '@/features/auth/permissions';
import { useEmployees } from '@/features/employee/api/employees';
import { NAV, SECURITY } from './nav';

/**
 * Ctrl K: jump to a person, a page, or an action without reaching for the
 * mouse. Everything listed is filtered by permission the same way the sidebar
 * is — and, the same way, that is convenience; the API is what refuses.
 */
export function CommandMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const { can, session } = usePermissions();
  const { resolved, setPreference } = useTheme();
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  function go(to: string) {
    onOpenChange(false);
    navigate(to);
  }

  const pages = [...NAV.flatMap((g) => g.items), SECURITY].filter((i) => !i.permission || can(i.permission));
  const searching = query.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        aria-describedby={undefined}
        className="fixed left-1/2 top-[14vh] z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border bg-popover shadow-popover data-[state=open]:animate-drop-in"
      >
        <DialogTitle className="sr-only">Search PeoplePulse</DialogTitle>
        <Command loop>
          <CommandInput placeholder="Search people, pages and actions…" value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>Nothing matches “{query}”.</CommandEmpty>

            {searching && can('employee.view') && <PeopleResults onPick={(id) => go(`/employees/${id}`)} />}

            <CommandGroup heading="Go to">
              {pages.map((p) => (
                <CommandItem key={p.to} value={p.label} keywords={p.keywords ?? []} onSelect={() => go(p.to)}>
                  <p.icon />
                  {p.label}
                </CommandItem>
              ))}
            </CommandGroup>

            <CommandGroup heading="Actions">
              {can('employee.create') && (
                <CommandItem value="Add an employee" keywords={['new', 'hire', 'onboard']} onSelect={() => go('/employees/new')}>
                  <UserPlus /> Add an employee
                </CommandItem>
              )}
              {can('leave.apply') && session?.employeeId && (
                <CommandItem value="Apply for leave" keywords={['time off', 'vacation', 'sick']} onSelect={() => go('/leave?apply=1')}>
                  <CalendarPlus /> Apply for leave
                </CommandItem>
              )}
              {can('user.invite') && (
                <CommandItem value="Invite someone to sign in" keywords={['user', 'access', 'admin']} onSelect={() => go('/users')}>
                  <UserRoundPlus /> Invite someone to sign in
                </CommandItem>
              )}
              {can('employee.import') && (
                <CommandItem value="Import employees from Excel" keywords={['upload', 'bulk', 'xlsx']} onSelect={() => go('/import')}>
                  <Upload /> Import employees from Excel
                </CommandItem>
              )}
              <CommandItem
                value={resolved === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                keywords={['theme', 'appearance']}
                onSelect={() => {
                  setPreference(resolved === 'dark' ? 'light' : 'dark');
                  onOpenChange(false);
                }}
              >
                {resolved === 'dark' ? <Sun /> : <Moon />}
                {resolved === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              </CommandItem>
              <CommandItem value="Sign out" keywords={['log out', 'logout']} onSelect={signOut}>
                <LogOut /> Sign out
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

/**
 * People, filtered in the browser: an SMB has at most a couple of hundred, the
 * list is cached from the People page, and matching on every keystroke without
 * a round trip is what makes this feel instant. The API already removed anyone
 * this user may not see.
 */
function PeopleResults({ onPick }: { onPick: (id: string) => void }) {
  const { data: people = [] } = useEmployees();
  if (people.length === 0) return null;

  return (
    <CommandGroup heading="People">
      {people.map((e) => {
        const name = `${e.firstName} ${e.lastName ?? ''}`.trim();
        return (
          <CommandItem
            key={e.id}
            value={`${name} ${e.empCode}`}
            keywords={e.workEmail ? [e.workEmail] : []}
            onSelect={() => onPick(e.id)}
          >
            <Avatar name={name} size="xs" />
            <span className="flex-1 truncate">{name}</span>
            <span className="tabular text-xs text-muted-foreground">{e.empCode}</span>
          </CommandItem>
        );
      })}
    </CommandGroup>
  );
}
