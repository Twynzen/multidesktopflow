/**
 * Environment configuration for production
 *
 * In production, set these environment variables in your hosting platform:
 * - VITE_SUPABASE_URL
 * - VITE_SUPABASE_ANON_KEY
 *
 * Or use .env.production file (loaded by Vite at build time)
 */

const env = (import.meta as any).env || {};

export const environment = {
  production: true,
  supabase: {
    url: env.VITE_SUPABASE_URL || '',
    anonKey: env.VITE_SUPABASE_ANON_KEY || ''
  },
  app: {
    name: 'MultiDesktopFlow',
    version: '1.0.0'
  }
};
