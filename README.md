# Gemma

Lecture incrémentale + répétition espacée FSRS. 100 % local, **aucune IA, aucune clé API**.
Vos données sont stockées dans des fichiers JSON du dossier de l'application :
- Linux : `~/.config/Gemma/data/`
- Windows : `%APPDATA%\Gemma\data\`

Chaque écriture est atomique et garde la version précédente (`*.json.bak`). Une sauvegarde complète est créée chaque jour dans `data/backups/` (7 dernières conservées), ainsi qu'avant chaque restauration ou réinitialisation. Les images importées sont dans `data/media/` : pour une sauvegarde complète, copiez tout le dossier `data`. Ces fichiers ne sont pas supprimés à la désinstallation.
Au premier lancement, la bibliothèque des versions précédentes est reprise automatiquement : le profil de l'application lorsqu'elle s'appelait **Foliole** (`~/.config/Foliole`, `%APPDATA%\Foliole`, laissé intact) et l'ancien stockage du navigateur (localStorage). Le paquet .deb `gemma` remplace le paquet `foliole`.
En mode navigateur (`npm run dev`), les données restent dans le localStorage du navigateur. Seule fonction réseau : la capture d'une page web (l'adresse que vous saisissez) et le téléchargement de ses images.

## Import
- **Page web** : l'article est extrait (Readability), nettoyé et converti en Markdown ; les images sont copiées dans `data/media/` pour être lisibles hors ligne.
- **EPUB** : un document par chapitre, dans le dossier `Livres/<titre>` ; un chapitre par jour arrive dans la file.
- **PDF** : le texte est extrait et remis en paragraphes (les PDF scannés, sans texte, ne sont pas pris en charge).
- **HTML, Markdown, texte**.

## Développement
    npm install
    npm run dev            # http://127.0.0.1:3000
    npm run electron:dev   # fenêtre desktop

## File de lecture du jour
- La file ne contient que ce qui est à faire aujourd'hui (documents, extraits et cartes dus, avec la même limite quotidienne de cartes que la révision). Chaque élément la quitte une fois lu ou révisé ; quand tout est fait, elle est vide et indique la date du prochain élément.
- Un document ou un extrait déjà programmé pour plus tard n'est jamais reprogrammé une seconde fois : « Lu » / « Suivant » passe simplement à la suite (« déjà prévu dans N j »).

## Modifier un extrait ou une carte
- Bouton « Modifier » dans la file, la révision (touche E) et la bibliothèque.
- Modifier un extrait modifie aussi le passage dans le document d'origine (et dans l'extrait parent) ; seule la partie changée est remplacée, la mise en forme autour est conservée. Si le passage n'est plus retrouvé tel quel, seul l'extrait change (un message le signale). Annulable (Ctrl+Z).
- Carte à trou sur une phrase entière : l'éditeur s'ouvre pour choisir le mot à masquer (« Masquer la sélection », Alt+C). Syntaxe : `{{c1::réponse}}` ou `{{c1::réponse::indice}}`.

## Formules mathématiques (LaTeX)
- `$E=mc^2$` dans le texte, `$$\int_0^1 f(x)\,dx$$` sur sa propre ligne (aussi `\(…\)` et `\[…\]`). Pour écrire un symbole dollar : `\$`.
- Fonctionne dans le lecteur, l'éditeur, les extraits et les cartes à trou. Une carte peut masquer une formule entière (`{{c1::$E=mc^2$}}`) ou une partie (`$E={{c1::mc^2}}$`).
- En sélectionnant une formule dans le lecteur, l'extrait ou la carte garde son code LaTeX.
- Les formules des pages web (Wikipédia…) et des EPUB sont importées en LaTeX. Celles des PDF ne peuvent pas être récupérées.

## Installation
- **Linux Mint / Ubuntu / Debian (recommandé)** : `sudo apt install ./Gemma-1.0.0-linux-amd64.deb`, puis lancez Gemma depuis le menu (ou la commande `gemma`).
- **AppImage** (autres distributions) : `chmod +x Gemma-*.AppImage && ./Gemma-*.AppImage`. Sur Ubuntu 24.04+ et dérivés, où AppArmor bloque le bac à sable de Chromium pour les AppImage, Gemma démarre automatiquement sans ce bac à sable ; le .deb, lui, le conserve.
- **Windows** : lancez `Gemma-1.0.0-win-x64.exe` (installateur) ou la version portable. L'application n'est pas signée : au premier lancement, Windows SmartScreen affiche un avertissement → « Informations complémentaires » → « Exécuter quand même ».

Les données (Linux : `~/.config/Gemma/data/`, Windows : `%APPDATA%\Gemma\data\`) sont conservées lors d'une mise à jour ou d'une désinstallation.
Sauvegarde / restauration : onglet Analytique → « Sauvegarde JSON » et « Restaurer une sauvegarde… » (accepte aussi les fichiers de `data/backups/`).

## Construire les installateurs
    npm run dist:linux     # release/*.deb et *.AppImage
    npm run dist:win       # release/*.exe (installateur NSIS + portable) — à lancer sous Windows

Avec GitHub : l'action « Build installers » vérifie le code (types + tests) puis construit les installateurs Linux et Windows. Poussez une étiquette (`git tag v1.0.1 && git push --tags`) pour publier automatiquement une « Release » avec les fichiers. Pensez à remplacer `homepage` dans `package.json` par l'adresse de votre dépôt.

## Tests
    npm run lint           # vérification des types
    npm test               # stockage, cartes à trou, planification
    npm run test:e2e       # parcours complets dans l'application Electron (sous Linux sans écran : xvfb-run -a npm run test:e2e)
