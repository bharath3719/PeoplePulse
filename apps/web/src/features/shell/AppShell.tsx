import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { Dialog, DialogTitle, SheetContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/features/auth/permissions';
import { CommandMenu } from './CommandMenu';
import { SidebarContent } from './Sidebar';
import { Topbar } from './Topbar';

const COLLAPSED_KEY = 'pp.sidebar.collapsed';

/**
 * The frame every signed-in page sits in: a sidebar on the canvas, and the page
 * as a raised panel beside it. On a phone the sidebar becomes a sheet.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === '1');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  // A new page starts at its top, and the phone's menu closes behind you.
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
    setMobileNavOpen(false);
  }, [pathname]);

  // Ctrl/⌘ K from anywhere; "/" from anywhere that is not a text field.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSearchOpen((o) => !o);
        return;
      }
      const target = e.target as HTMLElement | null;
      const typing = target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-dvh overflow-hidden bg-canvas">
      <aside
        className={cn(
          'hidden shrink-0 transition-[width] duration-200 ease-out lg:block',
          collapsed ? 'w-[68px]' : 'w-64',
        )}
      >
        <SidebarContent collapsed={collapsed} />
      </aside>

      <Dialog open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent aria-describedby={undefined}>
          <DialogTitle className="sr-only">Menu</DialogTitle>
          <SidebarContent />
        </SheetContent>
      </Dialog>

      <div className="flex min-w-0 flex-1 flex-col lg:py-2 lg:pr-2">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background lg:rounded-xl lg:border lg:shadow-panel">
          <Topbar
            onOpenSearch={() => setSearchOpen(true)}
            onOpenMobileNav={() => setMobileNavOpen(true)}
            onToggleSidebar={() => setCollapsed((c) => !c)}
          />
          <div ref={scroller} className="flex-1 overflow-y-auto">
            <MfaSetupNudge />
            <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
          </div>
        </div>
      </div>

      <CommandMenu open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}

/**
 * For someone whose access needs a second factor and who has none yet. Not a
 * wall — the API refuses only the gated actions, and those offer setup in place
 * — but a reminder to do it now, at a desk, rather than mid-payroll.
 */
function MfaSetupNudge() {
  const { session } = usePermissions();
  const { pathname } = useLocation();
  if (!session?.mfaRequired || session.mfaEnrolled || pathname === '/security') return null;

  return (
    <div className="border-b border-warning/20 bg-warning/10">
      <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-2 text-sm sm:px-6 lg:px-8">
        <ShieldCheck className="h-4 w-4 shrink-0 text-warning" />
        <span>Some of what you can do here needs two-factor authentication.</span>
        <Link to="/security" className="font-medium text-primary hover:underline">Set it up</Link>
      </div>
    </div>
  );
}
