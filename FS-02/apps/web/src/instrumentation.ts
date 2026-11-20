// Runs once when the Next.js server starts. Fails fast on invalid configuration
// (variable names only are reported, never values).
export async function register(): Promise<void> {
  if (process.env['NEXT_RUNTIME'] === 'nodejs') {
    const { getWebEnv } = await import('./env');
    getWebEnv();
  }
}
