import React, { useState, useEffect } from 'react';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import SetupWizard from './components/SetupWizard';

// Helper function to safely retrieve or instantiate the Supabase client
const getSupabaseClient = (): SupabaseClient | null => {
  const url = (import.meta as any).env?.VITE_SUPABASE_URL || localStorage.getItem('supabase_url');
  const key = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || localStorage.getItem('supabase_key');

  if (!url || !key) return null;
  return createClient(url, key);
};

export default function App() {
  const [isInstalled, setIsInstalled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    async function checkInstallation() {
      const supabase = getSupabaseClient();

      if (!supabase) {
        setIsInstalled(false);
        setLoading(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('options')
          .select('option_value')
          .eq('option_name', 'installed')
          .single();

        if (data && data.option_value === 'true' && !error) {
          setIsInstalled(true);
        } else {
          setIsInstalled(false);
        }
      } catch (err) {
        setIsInstalled(false);
      } finally {
        setLoading(false);
      }
    }

    checkInstallation();
  }, []);

  if (loading) {
    return <div style={{ textAlign: 'center', marginTop: '100px' }}>Loading React-WP...</div>;
  }

  if (!isInstalled) {
    return <SetupWizard onComplete={() => setIsInstalled(true)} />;
  }

  return (
    <div style={{ textAlign: 'center', marginTop: '50px', fontFamily: 'sans-serif' }}>
      <h1>🎉 Welcome to React-WP Dashboard</h1>
      <p>Your CMS is successfully installed and running.</p>
    </div>
  );
}