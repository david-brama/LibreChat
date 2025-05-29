import { Context } from 'hono';
import { TStartupConfig } from 'librechat-data-provider';
import { ModelRepository } from '../../db/repositories/model';

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
    // Initialize model repository to fetch modelSpecs
    const modelRepository = new ModelRepository(c.env.DB);
    const modelSpecs = await modelRepository.getModelSpecs();

    const config: TStartupConfig = {
      appTitle: c.env.APP_TITLE || 'My App',
      socialLogins: ['openid'],
      discordLoginEnabled: false,
      facebookLoginEnabled: false,
      githubLoginEnabled: false,
      googleLoginEnabled: false,
      openidLoginEnabled: true,
      appleLoginEnabled: false,
      openidLabel: c.env.OPENID_LABEL || 'Continue with Microsoft',
      openidImageUrl: c.env.OPENID_IMAGE_URL || '',
      openidAutoRedirect: false,
      serverDomain: c.env.SERVER_DOMAIN,
      emailLoginEnabled: false,
      registrationEnabled: false,
      socialLoginEnabled: true,
      passwordResetEnabled: false,
      emailEnabled: false,
      showBirthdayIcon: false,
      helpAndFaqURL: c.env.HELP_AND_FAQ_URL || '',
      sharedLinksEnabled: false,
      publicSharedLinksEnabled: false,
      instanceProjectId: '',
      // Enable model selector interface for MVP
      interface: {
        modelSelect: false,
        endpointsMenu: false,
        presets: false,
        bookmarks: true,
        prompts: true,
      },
      balance: {
        enabled: false,
        startBalance: 0,
        autoRefillEnabled: false,
        refillIntervalValue: 0,
        refillIntervalUnit: 'seconds',
        refillAmount: 0,
      },
      modelSpecs: {
        enforce: true,
        prioritize: true,
        list: modelSpecs,
      },
      customFooter: c.env.CUSTOM_FOOTER || 'The cake is a lie.',
    };

    return c.json(config);
  } catch (error) {
    console.error('[getConfig] Error:', error);
    return c.json({ error: 'Error fetching configuration' }, 500);
  }
}
