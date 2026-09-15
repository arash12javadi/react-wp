import LoginButton from '../components/LoginButton';
import { rwp } from './rwp';

/** Registered once at startup so [rwp_login] works in any page or post. */
export const registerBuiltinShortcodes = () => {
  rwp.shortcodes.register({
    name: 'rwp_login',
    description: 'A sign-in button for visitors, or sign-out for someone already signed in.',
    example: '[rwp_login label="Sign in" style="link"]',
    attributes: [
      { name: 'label', description: 'Button text, used in both states. Without it: "Log in", or "Log out" when signed in.' },
      { name: 'style', description: 'button (default) or link.' },
    ],
    render: (attributes) => (
      <LoginButton
        label={attributes.label}
        variant={attributes.style === 'link' ? 'link' : 'button'}
      />
    ),
  });
};
