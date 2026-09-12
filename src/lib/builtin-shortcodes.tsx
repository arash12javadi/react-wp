import LoginButton from '../components/LoginButton';
import { rwp } from './rwp';

/** Registered once at startup so [rwp_login] works in any page or post. */
export const registerBuiltinShortcodes = () => {
  rwp.shortcodes.register({
    name: 'rwp_login',
    render: (attributes) => (
      <LoginButton
        label={attributes.label}
        variant={attributes.style === 'link' ? 'link' : 'button'}
      />
    ),
  });
};
