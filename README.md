# Foliole

Lecture incrémentale + répétition espacée FSRS. 100 % local, **aucune IA, aucune clé API**.
Vos données sont stockées dans des fichiers JSON du dossier de l'application :
- Linux : `~/.config/Foliole/data/`
- Windows : `%APPDATA%\Foliole\data\`

Chaque écriture est atomique et garde la version précédente (`*.json.bak`). Une sauvegarde complète est créée chaque jour dans `data/backups/` (7 dernières conservées), ainsi qu'avant chaque restauration ou réinitialisation. Ces fichiers ne sont pas supprimés à la désinstallation.
Au premier lancement de cette version, l'ancienne bibliothèque (localStorage) est copiée automatiquement.
En mode navigateur (`npm run dev`), les données restent dans le localStorage du navigateur. Seule fonction réseau : le « web clip » (récupère l'URL que vous saisissez).

## Développement
    npm install
    npm run dev            # http://127.0.0.1:3000
    npm run electron:dev   # fenêtre desktop

## Installateurs
    npm run dist:linux     # release/*.deb et *.AppImage  (Linux Mint / Ubuntu / Debian)
    npm run dist:win       # release/*.exe (installateur NSIS + portable) — à lancer sous Windows

Linux Mint : `sudo apt install ./release/Foliole-1.0.0-linux-amd64.deb` ou `chmod +x *.AppImage && ./*.AppImage`.
Sauvegarde / restauration : onglet Analytique → « Sauvegarde JSON » et « Restaurer une sauvegarde… » (accepte aussi les fichiers de `data/backups/`).
