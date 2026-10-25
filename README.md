# Foliole

Lecture incrémentale + répétition espacée FSRS. 100 % local, **aucune IA, aucune clé API**.
Vos données sont stockées localement dans l'application (localStorage). Seule fonction réseau : le « web clip » (récupère l'URL que vous saisissez).

## Développement
    npm install
    npm run dev            # http://127.0.0.1:3000
    npm run electron:dev   # fenêtre desktop

## Installateurs
    npm run dist:linux     # release/*.deb et *.AppImage  (Linux Mint / Ubuntu / Debian)
    npm run dist:win       # release/*.exe (installateur NSIS + portable) — à lancer sous Windows

Linux Mint : `sudo apt install ./release/Foliole-1.0.0-linux-amd64.deb` ou `chmod +x *.AppImage && ./*.AppImage`.
Sauvegarde : Statistiques → exporter en JSON (recommandé avant toute désinstallation).
