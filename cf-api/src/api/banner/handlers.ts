import { Context } from 'hono';
import { TBanner } from 'librechat-data-provider';

/**
 * Handler for GET /api/banner
 * Returns banner configuration for the LibreChat frontend
 *
 * Banners are used to display system-wide announcements or notifications
 * at the top of the LibreChat interface. They can be scheduled to display
 * within specific time ranges.
 */
export async function getBanner(c: Context) {
  try {
    const banner: TBanner = {
      bannerId: '1',
      message: 'My App Banner',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isPublic: true,
      displayFrom: new Date().toISOString(),
      displayTo: new Date().toISOString(),
    };

    return c.json(banner);
  } catch (error) {
    console.error('[getBanner] Error:', error);
    return c.json({ error: 'Error fetching banner' }, 500);
  }
}
