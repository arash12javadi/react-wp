import type { AdminStatus } from '../../lib/adminStatus';
import { hasCapability, type UserRole } from '../../lib/roles';
import GuidePanel from './GuidePanel';
import Overview from './Overview';
import UpdatesPanel from './UpdatesPanel';

/** Dashboard → Overview, Updates or Guide. Loaded as its own chunk, so public pages never download it. */
export default function Dashboard({ subsection, navigate, role, status, siteTitle }: {
  subsection: string;
  navigate: (section: string, subsection?: string) => void;
  role: UserRole;
  status: AdminStatus;
  siteTitle: string;
}) {
  if (subsection === 'updates' && hasCapability(role, 'manage_options')) return <UpdatesPanel status={status} />;
  if (subsection === 'guide') return <GuidePanel navigate={navigate} />;
  return <Overview role={role} status={status} navigate={navigate} siteTitle={siteTitle} />;
}
