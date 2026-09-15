import { useCallback, useEffect, useState } from 'react';
import { hasCapability, type UserRole } from './roles';
import { readDismissed, runSetupChecks, writeDismissed, type SetupNotice } from './setupChecks';
import {
  availableUpdates, defaultUpdateSettings, runScheduledUpdateCheck, type UpdateSettings, type UpdateStatus,
} from './updates';

export interface AdminStatus {
  notices: SetupNotice[];
  noticesLoading: boolean;
  refreshNotices: () => void;
  dismissed: string[];
  setDismissed: (ids: string[]) => void;
  updateSettings: UpdateSettings;
  setUpdateSettings: (settings: UpdateSettings) => void;
  updateStatus: UpdateStatus | null;
  setUpdateStatus: (status: UpdateStatus) => void;
  updateError: string;
  /** Sidebar badge: visible required/recommended notices plus available updates. */
  badge: number;
}

/**
 * Loaded once when the admin opens, so the sidebar badge is right on every screen and the
 * Dashboard does not repeat the checks each time it is visited.
 */
export function useAdminStatus(role: UserRole, userId: string | undefined): AdminStatus {
  const [notices, setNotices] = useState<SetupNotice[]>([]);
  const [noticesLoading, setNoticesLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [dismissed, setDismissedState] = useState<string[]>([]);
  const [updateSettings, setUpdateSettings] = useState<UpdateSettings>(defaultUpdateSettings);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [updateError, setUpdateError] = useState('');
  const isAdmin = hasCapability(role, 'manage_options');

  useEffect(() => {
    if (!userId) return;
    setDismissedState(readDismissed(userId));
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    let mounted = true;
    setNoticesLoading(true);
    runSetupChecks(role, userId)
      .then((result) => { if (mounted) setNotices(result); })
      .finally(() => { if (mounted) setNoticesLoading(false); });
    return () => { mounted = false; };
  }, [role, userId, revision]);

  useEffect(() => {
    if (!isAdmin || !userId) return;
    let mounted = true;
    runScheduledUpdateCheck()
      .then(({ settings, status }) => {
        if (!mounted) return;
        setUpdateSettings(settings);
        setUpdateStatus(status);
      })
      .catch((error: unknown) => { if (mounted) setUpdateError(error instanceof Error ? error.message : 'The update check failed.'); });
    return () => { mounted = false; };
  }, [isAdmin, userId]);

  const setDismissed = useCallback((ids: string[]) => {
    setDismissedState(ids);
    if (userId) writeDismissed(userId, ids);
  }, [userId]);

  const refreshNotices = useCallback(() => setRevision((value) => value + 1), []);

  const visibleImportant = notices.filter((notice) => notice.level !== 'optional' && !dismissed.includes(notice.id)).length;
  const updates = isAdmin && updateSettings.notify ? availableUpdates(updateStatus).length : 0;

  return {
    notices, noticesLoading, refreshNotices, dismissed, setDismissed,
    updateSettings, setUpdateSettings, updateStatus, setUpdateStatus, updateError,
    badge: visibleImportant + updates,
  };
}
