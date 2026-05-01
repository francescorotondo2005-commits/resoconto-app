/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pacchetti con binari nativi o non bundlabili da Turbopack/Webpack
  serverExternalPackages: [
    'better-sqlite3',
    '@libsql/client',
    'playwright',
  ],
  // Permette l'accesso alle risorse dev da domini esterni (ngrok, rete locale)
  allowedDevOrigins: [
    '*.ngrok-free.app',
    '*.ngrok-free.dev',   // dominio statico ngrok dell'utente
    '*.ngrok.io',
    '192.168.*.*',
  ],
};

export default nextConfig;
