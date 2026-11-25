import { useLocation } from 'react-router-dom';
import { ChevronRight, Menu, Moon, PanelLeft, Search, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { useTheme } from '@/lib/theme';
import { matchNav } from './nav';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const SEARCH_SHORTCUT = isMac ? '⌘K' : 'Ctrl K';

/** The bar across the top of the page panel: where you are, search, and theme. */
export function Topbar({
  onOpenSearch,
  onOpenMobileNav,
  onToggleSidebar,
}: {
  onOpenSearch: () => void;
  onOpenMobileNav: () => void;
  onToggleSidebar: () => void;
}) {
  const { pathname } = useLocation();
  const { resolved, setPreference } = useTheme();
  const here = matchNav(pathname);

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/70 lg:px-5">
      <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={onOpenMobileNav} aria-label="Open menu">
        <Menu className="h-4 w-4" />
      </Button>
      <Tooltip content="Collapse sidebar" side="bottom">
        <Button variant="ghost" size="icon-sm" className="hidden lg:inline-flex" onClick={onToggleSidebar} aria-label="Toggle sidebar">
          <PanelLeft className="h-4 w-4 text-muted-foreground" />
        </Button>
      </Tooltip>

      {here && (
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
          {here.group?.label && (
            <>
              <span className="hidden text-muted-foreground sm:inline">{here.group.label}</span>
              <ChevronRight className="hidden h-3.5 w-3.5 text-muted-foreground/60 sm:inline" />
            </>
          )}
          <span className="truncate font-medium">{here.item.label}</span>
        </nav>
      )}

      <div className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          onClick={onOpenSearch}
          className="hidden h-8 w-64 items-center gap-2 rounded-md border bg-muted/40 px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:flex"
        >
          <Search className="h-4 w-4" />
          <span className="flex-1 truncate whitespace-nowrap text-left">Search…</span>
          <kbd className="rounded border bg-background px-1.5 py-px font-sans text-[11px] font-medium">{SEARCH_SHORTCUT}</kbd>
        </button>
        <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={onOpenSearch} aria-label="Search">
          <Search className="h-4 w-4" />
        </Button>
        <Tooltip content={resolved === 'dark' ? 'Light mode' : 'Dark mode'} side="bottom">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setPreference(resolved === 'dark' ? 'light' : 'dark')}
            aria-label="Toggle dark mode"
          >
            {resolved === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </Tooltip>
      </div>
    </header>
  );
}
