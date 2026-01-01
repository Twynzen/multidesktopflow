/**
 * Environment configuration for development
 *
 * SETUP OPTIONS:
 *
 * Option 1 - Using .env file (recommended):
 *   1. Copy .env.example to .env in the project root
 *   2. Fill in your Supabase credentials in .env
 *   3. The values below will use import.meta.env to read from .env
 *
 * Option 2 - Direct configuration:
 *   1. Replace the values below directly (NOT recommended for git)
 *   2. Make sure environment.ts is in .gitignore if you do this
 *
 * Note: Variables must be prefixed with VITE_ to be exposed to the client
 */

// Read from .env file (Vite exposes VITE_ prefixed vars)
const env = (import.meta as any).env || {};

export const environment = {
  production: false,
  supabase: {
    // Reads from .env: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
    // Falls back to empty string if not set (enables offline mode)
    url: env.VITE_SUPABASE_URL || '',
    anonKey: env.VITE_SUPABASE_ANON_KEY || ''
  },
  app: {
    name: 'MultiDesktopFlow',
    version: '1.0.0'
  }
};
