import { defineConfig } from 'vite'

// Armana — configuration Vite minimale.
// - Racine = ce dossier ; sortie de build dans dist/ (déployé tel quel sur Cloudflare Pages).
// - Le service worker et le manifest sont servis depuis public/ à la racine du site.
// - Seules les variables préfixées VITE_ sont exposées au client (voir .env.example).
//
// Détection de mise à jour : on fige un identifiant de build (__BUILD_ID__) injecté
// dans le bundle, ET on émet un /version.json contenant le même id. L'app compare son
// __BUILD_ID__ au /version.json en ligne pour savoir si un nouveau déploiement existe.
const BUILD_ID = String(Date.now())

export default defineConfig({
  root: '.',
  publicDir: 'public',
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  plugins: [
    {
      name: 'armana-emit-version',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({ build: BUILD_ID }),
        })
      },
    },
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    open: false,
  },
})
