import { useNavigate } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useEmployeeLogins } from './api/users';

/**
 * On an employee's profile, for whoever can invite: the login this person signs
 * in as, or the way to give them one (D-26) — the invite form, with them chosen.
 */
export function EmployeeSignIn({ employeeId }: { employeeId: string }) {
  const navigate = useNavigate();
  const people = useEmployeeLogins();
  const person = people.data?.find((p) => p.id === employeeId);
  if (!person) return null;

  if (person.login) {
    return <span className="text-xs text-muted-foreground">Signs in as {person.login}</span>;
  }
  return (
    <Button variant="outline" size="sm" onClick={() => navigate(`/users?invite=${employeeId}`)}>
      <KeyRound className="h-4 w-4" />
      {person.invitedAs ? 'Invite again' : 'Invite to sign in'}
    </Button>
  );
}
