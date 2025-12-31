// Environment configuration for production
// Replace with your Supabase project credentials

export const environment = {
  production: true,
  supabase: {
    url: 'YOUR_SUPABASE_URL', // e.g., 'https://xxxxxxxxxxxxx.supabase.co'
    anonKey: 'YOUR_SUPABASE_ANON_KEY' // e.g., 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
  },
  app: {
    name: 'MultiDesktopFlow',
    version: '1.0.0'
  }
};
