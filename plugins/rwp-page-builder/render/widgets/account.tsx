/**
 * Account Form: the sign-in, register, lost-password, profile and dashboard screens as a widget.
 * The default account pages are built from it, so they can be redesigned here like any page.
 * The forms themselves are core's (src/components/auth), the same ones behind the shortcodes, so
 * redirects, social sign-in and Settings → Accounts behave identically.
 */
import { lazy, Suspense } from 'react';
import AuthForm from '../../../../src/components/auth/AuthForm';
import { opts } from '../../lib/controls';
import type { WidgetDefinition } from '../../lib/registry';
import { useRenderContext } from '../context';
import { EditorPlaceholder } from './shared';
import { pick, str } from './kit';

const UserProfile = lazy(() => import('../../../../src/components/auth/UserAccount').then((module) => ({ default: module.UserProfile })));
const UserDashboard = lazy(() => import('../../../../src/components/auth/UserAccount').then((module) => ({ default: module.UserDashboard })));

export const accountScreens = ['login', 'register', 'lost_password', 'profile', 'dashboard'] as const;
export type AccountScreen = (typeof accountScreens)[number];

const formScreens: AccountScreen[] = ['login', 'register', 'lost_password'];

export const accountForm: WidgetDefinition = {
  type: 'account-form',
  label: 'Account Form',
  icon: 'log-in',
  category: 'site',
  keywords: ['login', 'sign in', 'register', 'sign up', 'password', 'profile', 'dashboard', 'account', 'members'],
  defaults: () => ({ settings: { screen: 'login', title: '', subtitle: '', buttonText: '', redirect: '', showSocial: true, showLinks: true } }),
  controls: [
    {
      key: 'screen', label: 'Screen', type: 'select',
      options: opts(['login', 'Log in'], ['register', 'Register'], ['lost_password', 'Lost password / new password'], ['profile', 'User profile'], ['dashboard', 'User dashboard']),
      help: 'Settings → Accounts and Settings → Site choose which page each account address (/login, /profile …) shows.',
    },
    { key: 'title', label: 'Heading', type: 'text', placeholder: 'Default for the screen' },
    { key: 'subtitle', label: 'Text under the heading', type: 'text', placeholder: 'Default for the screen', help: 'Log in, register and lost password only.' },
    { key: 'buttonText', label: 'Button text', type: 'text', placeholder: 'Default for the screen', help: 'Log in, register and lost password only.' },
    { key: 'redirect', label: 'Go to after signing in', type: 'text', placeholder: 'Settings → Accounts decides', help: 'A path such as /dashboard. A ?redirect= in the link still wins.' },
    { key: 'showSocial', label: 'Google / Facebook buttons', type: 'toggle', help: 'Shown only when switched on under Settings → Accounts.' },
    { key: 'showLinks', label: 'Links to the other screens', type: 'toggle', help: '"Create one", "Sign in" and "Forgot password?".' },
  ],
  View: function AccountFormView({ node }) {
    const { mode } = useRenderContext();
    const screen = pick(node.settings.screen, accountScreens, 'login');
    const title = str(node.settings.title).trim() || undefined;

    if (formScreens.includes(screen)) {
      return (
        <div className="rwpb-account-form">
          <AuthForm
            mode={screen as 'login' | 'register' | 'lost_password'}
            title={title}
            subtitle={str(node.settings.subtitle).trim() || undefined}
            buttonLabel={str(node.settings.buttonText).trim() || undefined}
            redirect={str(node.settings.redirect).trim() || undefined}
            showSocial={node.settings.showSocial !== false}
            showLinks={node.settings.showLinks !== false}
            preview={mode === 'edit'}
          />
        </div>
      );
    }
    return (
      <div className="rwpb-account-form">
        {mode === 'edit' && (
          <EditorPlaceholder>
            {screen === 'profile' ? 'The signed-in visitor’s profile form.' : 'The signed-in visitor’s dashboard.'} Shown below as it looks to you; visitors who are not signed in are asked to sign in.
          </EditorPlaceholder>
        )}
        <Suspense fallback={<p>Loading…</p>}>
          {screen === 'profile' ? <UserProfile /> : <UserDashboard title={title} />}
        </Suspense>
      </div>
    );
  },
};
