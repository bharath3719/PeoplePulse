import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CalendarPlus, UserPlus } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { usePermissions } from '@/features/auth/permissions';
import { firstName } from '@/features/shell/identity';
import { ApprovalsInbox } from './ApprovalsInbox';
import { DepartmentMix } from './DepartmentMix';
import { longToday, partOfDay } from './dates';
import { MyDay } from './MyDay';
import { OutToday } from './OutToday';
import { PeopleMoments } from './PeopleMoments';
import { SetupChecklist } from './SetupChecklist';
import { TeamStats } from './TeamStats';
import { UpcomingHolidays } from './UpcomingHolidays';

/**
 * Home: one page that answers "what needs me today?" for whoever signs in.
 *
 * It is assembled from what the person may DO, never from what their role is
 * called (ENGINEERING-STANDARDS.md): an employee gets their day and their
 * leave; a manager adds the requests waiting on them and who is out; HR adds
 * the company's numbers and the setup still to do. Every widget asks the API
 * only for what its permission allows, so the page never shows a 403.
 */
export function Home() {
  const { can, session } = usePermissions();
  if (!session) return null;

  const employeeId = session.employeeId;
  const hasMyDay = Boolean(employeeId) && (can('attendance.punch') || can('leave.apply'));
  const seesTeamLeave = can('leave.view.all') || can('leave.view.team');
  const seesCompany = can('employee.view.all');

  const main: ReactNode[] = [];
  if (hasMyDay && employeeId) main.push(<MyDay key="day" employeeId={employeeId} />);
  if (can('leave.approve')) main.push(<ApprovalsInbox key="inbox" />);
  if (seesCompany && can('org.view')) main.push(<DepartmentMix key="mix" />);

  const side: ReactNode[] = [];
  if (seesTeamLeave) side.push(<OutToday key="out" />);
  side.push(<UpcomingHolidays key="holidays" />);
  if (can('employee.view')) side.push(<PeopleMoments key="moments" />);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Good ${partOfDay()}, ${firstName(session)}`}
        description={longToday()}
        actions={
          <>
            {employeeId && can('leave.apply') && (
              <Link to="/leave?apply=1" className={buttonVariants({ variant: 'outline' })}>
                <CalendarPlus className="h-4 w-4" /> Apply for leave
              </Link>
            )}
            {can('employee.create') && (
              <Link to="/employees/new" className={buttonVariants()}>
                <UserPlus className="h-4 w-4" /> Add employee
              </Link>
            )}
          </>
        }
      />

      <SetupChecklist />

      {(seesCompany || seesTeamLeave || can('leave.approve')) && <TeamStats />}

      {main.length > 0 ? (
        <div className="grid items-start gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">{main}</div>
          <div className="space-y-6">{side}</div>
        </div>
      ) : (
        <div className="grid items-start gap-6 md:grid-cols-2 xl:grid-cols-3">{side}</div>
      )}
    </div>
  );
}
