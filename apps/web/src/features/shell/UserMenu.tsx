import { useNavigate } from 'react-router-dom';
import { ChevronsUpDown, KeyRound, LogOut, Monitor, Moon, Sun } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useTheme, type ThemePreference } from '@/lib/theme';
import { signOut } from '@/features/auth/api/auth';
import { usePermissions } from '@/features/auth/permissions';
import { displayName } from './identity';

/** The bottom of the sidebar: who you are, your security settings, theme, sign out. */
export function UserMenu({ collapsed }: { collapsed: boolean }) {
  const { session } = usePermissions();
  const navigate = useNavigate();
  const { preference, setPreference } = useTheme();
  if (!session) return null;

  const name = displayName(session);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Your account"
        className={cn(
          'flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors',
          'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          collapsed && 'justify-center',
        )}
      >
        <Avatar name={name} size="sm" />
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium leading-tight">{name}</span>
              <span className="block truncate text-xs text-muted-foreground">{session.email}</span>
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-60">
        <DropdownMenuLabel className="truncate font-normal">{session.email}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => navigate('/security')}>
          <KeyRound /> Security and two-factor
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={preference} onValueChange={(v) => setPreference(v as ThemePreference)}>
          <DropdownMenuRadioItem value="light"><Sun /> Light</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark"><Moon /> Dark</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system"><Monitor /> Match my device</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
