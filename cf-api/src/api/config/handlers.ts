import { Context } from 'hono';
import { TStartupConfig } from 'librechat-data-provider';

/**
 * Handler for GET /api/config
 * Returns the LibreChat startup configuration for the frontend
 *
 * This configuration determines which features are enabled/disabled
 * in the LibreChat frontend, including authentication methods,
 * UI features, and service integrations.
 */
export async function getConfig(c: Context) {
  try {
    const config: TStartupConfig = {
      appTitle: 'My App',
      socialLogins: ['openid'],
      discordLoginEnabled: false,
      facebookLoginEnabled: false,
      githubLoginEnabled: false,
      googleLoginEnabled: false,
      openidLoginEnabled: true,
      appleLoginEnabled: false,
      openidLabel: 'Continue with Microsoft',
      openidImageUrl: '',
      openidAutoRedirect: false,
      serverDomain: 'http://localhost:5173',
      emailLoginEnabled: false,
      registrationEnabled: false,
      socialLoginEnabled: true,
      passwordResetEnabled: false,
      emailEnabled: false,
      showBirthdayIcon: false,
      helpAndFaqURL: '',
      sharedLinksEnabled: false,
      publicSharedLinksEnabled: false,
      instanceProjectId: '',
      // Enable model selector interface for MVP
      interface: {
        modelSelect: true,
      },
      balance: {
        enabled: false,
        startBalance: 0,
        autoRefillEnabled: false,
        refillIntervalValue: 0,
        refillIntervalUnit: 'seconds',
        refillAmount: 0,
      },
      customFooter: 'The cake is a lie.',
    };

    return c.json(config);
  } catch (error) {
    console.error('[getConfig] Error:', error);
    return c.json({ error: 'Error fetching configuration' }, 500);
  }
}
