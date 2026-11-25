import { Toaster as Sonner } from 'sonner';
import { useTheme } from '@/lib/theme';

/**
 * Where `toast()` calls land. Import `toast` from 'sonner' to raise one.
 *
 * For confirming what just happened ("Leave approved"), never for errors a form
 * needs: those belong next to the field, where they stay until fixed.
 */
export function Toaster() {
  const { resolved } = useTheme();
  return (
    <Sonner
      theme={resolved}
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast: 'group rounded-lg border bg-popover text-popover-foreground shadow-popover font-sans',
          description: 'text-muted-foreground',
        },
      }}
    />
  );
}
