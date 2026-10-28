# Saudade

Lecture incrémentale + répétition espacée FSRS. 100 % local, **aucune IA, aucune clé API**.
Vos données sont stockées dans des fichiers JSON du dossier de l'application :
- Linux : `~/.config/Saudade/data/`
- Windows : `%APPDATA%\Saudade\data\`

Le texte de chaque document est dans son propre fichier, `data/contents/<id>.md` ; `documents.json` ne garde que le reste (titre, priorité, position de lecture…), si bien qu'enregistrer la position de lecture ne réécrit jamais les textes. Chaque écriture est atomique et garde la version précédente (`*.json.bak`). Une sauvegarde complète est créée chaque jour dans `data/backups/` (7 dernières conservées), ainsi qu'avant chaque restauration ou réinitialisation. Les images importées sont dans `data/media/` : pour une sauvegarde complète, copiez tout le dossier `data`. Ces fichiers ne sont pas supprimés à la désinstallation.
Au premier lancement, la bibliothèque des versions précédentes est reprise automatiquement : le profil de l'application lorsqu'elle s'appelait **Gemma** ou, à défaut, **Foliole** (`~/.config/Gemma`, `~/.config/Foliole`, `%APPDATA%\…`, laissés intacts) et l'ancien stockage du navigateur (localStorage). Le paquet .deb `saudade` remplace les paquets `gemma` et `foliole`.
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
- La file ne contient que ce qui est à faire aujourd'hui (documents, extraits et cartes dus, avec la même limite quotidienne de cartes que la révision). Chaque élément la quitte une fois lu ou révisé ; quand tout est fait, elle est vide et indique la date du prochain élément. Les réponses des cartes y restent masquées ; priorité et historique s'affichent au survol. Le badge, la file et les Statistiques donnent le même compte.
- Un document ou un extrait déjà programmé pour plus tard n'est jamais reprogrammé une seconde fois : « Lu » / « Suivant » passe simplement à la suite (« déjà prévu dans N j »).

### Surcharge

- Limites par jour (Réglages) : cartes à trou différentes (50 par défaut) et documents + extraits (20 par défaut). La file ne montre que les plus prioritaires ; une ligne indique ce qui attend au-delà.
- Chaque matin, si « Reporter automatiquement le surplus » est coché (par défaut), les documents et extraits en trop sont reprogrammés plus tard : 1 jour pour les plus prioritaires, jusqu'à la moitié de leur intervalle (16 jours au plus) pour les moins prioritaires. Un message permet d'annuler ; « Reporter maintenant » fait la même chose à la demande (après un gros import, par exemple). Les cartes ne sont jamais reportées : celles au-delà de la limite attendent le lendemain.

## Modifier un extrait ou une carte
- Bouton « Modifier » dans la file, la révision (touche E) et la bibliothèque.
- Modifier un extrait modifie aussi le passage dans le document d'origine (et dans l'extrait parent) ; seule la partie changée est remplacée, la mise en forme autour est conservée. Si le passage n'est plus retrouvé tel quel, seul l'extrait change (un message le signale). Annulable (Ctrl+Z).
- « Carte à trou » (Alt+C) ouvre toujours l'éditeur : les mots sélectionnés y sont déjà masqués (ou, pour une phrase entière, rien n'est masqué et vous choisissez). Seuls les blocs réellement sélectionnés servent de contexte : un titre voisin effleuré par la sélection n'entre pas dans la carte. Syntaxe : `{{c1::réponse}}` ou `{{c1::réponse::indice}}`.
- Une carte garde la phrase d'origine dont elle vient : même reformulée ensuite, elle reste surlignée sur cette phrase dans le document.
- Bouton « Cartes (N) » du lecteur : les cartes du document ; un clic relit la carte et surligne sa phrase dans le texte, puis « Voir la carte » ou « Modifier ».
- **Une carte par numéro de trou** (comme Anki) : `{{c1::Paris}} est une ville de {{c2::France}}` donne 2 cartes d'un trou chacune ; `{{c1::Paris}} est une ville et {{c1::la capitale}} de {{c2::France}}` donne une carte à 2 trous (c1) et une à 1 trou (c2). Dans l'éditeur : « Masquer · nouvelle carte » (Alt+C) ou « Masquer · même carte » (Alt+Maj+C). Les cartes d'une même note partagent le texte ; chacune a sa propre planification, et elles ne passent pas le même jour. Les anciennes cartes à plusieurs numéros sont découpées automatiquement (la première garde son historique).

## Cartes question/réponse

- Dans le lecteur ou en relisant un extrait : sélectionnez un passage puis « Question » (Alt+Q). Le passage pré-remplit la réponse ; écrivez la question et raccourcissez la réponse à l'essentiel.
- En révision, la question s'affiche seule ; Espace montre la réponse sous un trait, puis 1 à 4 comme pour les cartes à trou (même calendrier FSRS, même file, même synchronisation).
- La carte garde le passage d'où elle vient : elle y est surlignée dans le lecteur (panneau « Cartes »). Modifiable depuis la file, la bibliothèque ou la révision (E), avec annulation.

## Cartes image (zones masquées, comme Anki)

- Dans le lecteur, cliquez sur une image du texte puis « Masquer des zones » ; ou Bibliothèque › Par type › Cartes › « Nouvelle carte image… » pour partir d'un fichier.
- Tracez un rectangle sur chaque zone à masquer : chaque rectangle donne une carte (c1, c2…). Pour masquer plusieurs zones sur la même carte, choisissez son numéro dans la liste des zones. Consigne facultative.
- « Tout masquer, en deviner une » (par défaut) : toutes les zones sont cachées, celle à deviner en orange. « Masquer seulement la zone à deviner » : les autres restent visibles.
- Modifier la carte rouvre l'éditeur : une zone ajoutée crée une carte, une zone effacée supprime la sienne ; les autres gardent leur calendrier. Les images voyagent avec la synchronisation.

## Sangsues

- Une carte oubliée 8 fois (réglable) devient une « sangsue » : un message propose aussitôt de la reformuler. Elle est marquée dans la révision, la file et la bibliothèque (Cartes › « Seulement les sangsues »). Elle redevient sangsue tous les 4 oublis de plus.
- Réglages : le seuil, et « Retirer les sangsues de la file » (sinon elles restent, signalées). « Ce n'est plus une sangsue » dans la fenêtre de la carte ; remettre la carte à zéro l'efface aussi.

## Écriture incrémentale

- « Ajouter une source » › « Écrire » : un texte que vous rédigez petit à petit (synthèse, article, chapitre…), avec un titre et une priorité. Il s'ouvre aussitôt dans le lecteur.
- Le lecteur devient un éditeur : vous écrivez directement (Markdown et LaTeX), c'est enregistré au fil de la frappe ; « Aperçu » montre le rendu (on peut y extraire et faire des cartes comme ailleurs). Le nombre de mots est affiché.
- Le texte revient dans la file selon sa priorité (« Écriture », bouton « Écrire ») : « Pas fini · demain » (P), « Continuer · dans N j » (L), « Texte terminé » (T).
- Depuis un extrait (révision ou fenêtre de l'extrait), « Ajouter à un texte… » le verse à la fin d'un texte en cours, en citation avec sa source.

## Consulter les extraits et les cartes
- Bibliothèque (arborescence ou fiches) : cliquer sur un extrait ou une carte l'ouvre en entier (formules, réponse avec Espace, prochaine révision, cartes tirées de l'extrait), avec « Modifier » et « Voir dans le document ».
- Lecteur, volet « Extraits » : cliquer sur un extrait l'affiche en entier, fait défiler le texte jusqu'au passage et le surligne.
- Comme dans SuperMemo, le texte d'origine montre ce qui en a été tiré : passages extraits en doré, phrases transformées en cartes en vert (bouton « Surlignage » pour les masquer). Les marques suivent les modifications et disparaissent quand l'extrait ou la carte est supprimé (« Annuler » les remet). Dans un extrait, seuls ses sous-extraits sont surlignés.
- Réinitialiser une carte (fenêtre de la carte) ou toutes les cartes (Réglages, icône ⚙ en haut) : comme si elles n'avaient jamais été révisées, historique compris. Annulable ; une sauvegarde est créée avant la réinitialisation globale.

## Fin de lecture d'un texte
La question n'est pas « m'en souviendrai-je ? » (ce sont les cartes qui servent à retenir) mais « reste-t-il quelque chose à extraire ? » :
- **Pas fini · demain** (P) : revient demain, à la même position ; ne compte pas comme une lecture.
- **Il reste à extraire** (L) : revient selon la priorité, avec un intervalle qui grandit.
- **Tout est extrait · terminer** (T) : le texte quitte la file. Si rien n'en a été extrait, Saudade propose d'écrire une carte de résumé.
- **Moins important** : baisse la priorité (retours plus espacés).
- La lecture reprend là où elle s'était arrêtée.

## Formules mathématiques (LaTeX)
- `$E=mc^2$` dans le texte, `$$\int_0^1 f(x)\,dx$$` sur sa propre ligne (aussi `\(…\)` et `\[…\]`). Pour écrire un symbole dollar : `\$`.
- Fonctionne dans le lecteur, l'éditeur, les extraits et les cartes à trou. Une carte peut masquer une formule entière (`{{c1::$E=mc^2$}}`) ou une partie (`$E={{c1::mc^2}}$`).
- En sélectionnant une formule dans le lecteur, l'extrait ou la carte garde son code LaTeX.
- Les formules des pages web (Wikipédia…) et des EPUB sont importées en LaTeX. Celles des PDF ne peuvent pas être récupérées.

## Synchronisation entre ordinateurs

Réglages (icône ⚙) → Synchronisation. Il faut un dossier que vos ordinateurs partagent déjà grâce à un client de synchronisation (Nextcloud, Syncthing, Dropbox…), par exemple `Nextcloud/Saudade-sync`.

1. Sur le premier ordinateur : choisir ce dossier, choisir une phrase de passe (deux fois), activer. La bibliothèque y est envoyée.
2. Sur le deuxième : choisir le même dossier (une fois que le client l'a reçu), garder « Prendre la bibliothèque du dossier », saisir la même phrase de passe. Sa propre bibliothèque est sauvegardée dans `data/backups/` avant d'être remplacée.

Ensuite tout est automatique : au démarrage, quand la fenêtre revient au premier plan et toutes les 2 minutes (ou « Synchroniser maintenant »).

- Chaque ordinateur n'écrit que dans son propre fichier du dossier (`<appareil>.log`, en ajout seulement) : jamais de copie en conflit.
- Tout ce qui est écrit dans le dossier (modifications, images) est chiffré (AES-256-GCM, clé tirée de la phrase de passe par scrypt). La phrase de passe n'est pas enregistrée ; la clé l'est, protégée par le trousseau du système quand il y en a un.
- Fusion : pour les documents, extraits et cartes, champ par champ, la modification la plus récente gagne ; une suppression l'emporte sur les modifications (sauf si l'élément est recréé ensuite, par exemple par une restauration). Les révisions de cartes faites sur les deux ordinateurs sont toutes gardées : le calendrier de la carte est recalculé en les rejouant dans l'ordre.
- Les réglages (limite par jour, taux visé, thème…) sont synchronisés aussi, réglage par réglage : le plus récent gagne. Le deuxième ordinateur prend ceux du dossier en le rejoignant.
- Attendez que le client indique que tout est synchronisé avant de passer d'un ordinateur à l'autre.

## Installation
- **Linux Mint / Ubuntu / Debian (recommandé)** : `sudo apt install ./Saudade-1.0.0-linux-amd64.deb`, puis lancez Saudade depuis le menu (ou la commande `saudade`).
- **AppImage** (autres distributions) : `chmod +x Saudade-*.AppImage && ./Saudade-*.AppImage`. Sur Ubuntu 24.04+ et dérivés, où AppArmor bloque le bac à sable de Chromium pour les AppImage, Saudade démarre automatiquement sans ce bac à sable ; le .deb, lui, le conserve.
- **Windows** : lancez `Saudade-1.0.0-win-x64.exe` (installateur) ou la version portable. L'application n'est pas signée : au premier lancement, Windows SmartScreen affiche un avertissement → « Informations complémentaires » → « Exécuter quand même ».

Les données (Linux : `~/.config/Saudade/data/`, Windows : `%APPDATA%\Saudade\data\`) sont conservées lors d'une mise à jour ou d'une désinstallation.
Sauvegarde / restauration : Réglages (icône ⚙ en haut) → « Exporter une sauvegarde » et « Restaurer une sauvegarde… » (accepte aussi les fichiers de `data/backups/`).

## Construire les installateurs
    npm run dist:linux     # release/*.deb et *.AppImage
    npm run dist:win       # release/*.exe (installateur NSIS + portable) — à lancer sous Windows

Avec GitHub : l'action « Build installers » vérifie le code (types + tests) puis construit les installateurs Linux et Windows. Poussez une étiquette (`git tag v1.0.1 && git push --tags`) pour publier automatiquement une « Release » avec les fichiers. Pensez à remplacer `homepage` dans `package.json` par l'adresse de votre dépôt.

## Tests
    npm run lint           # vérification des types
    npm test               # stockage, cartes à trou, planification
    npm run test:e2e       # parcours complets dans l'application Electron (sous Linux sans écran : xvfb-run -a npm run test:e2e)

## Licence
Apache License 2.0 — voir [LICENSE](LICENSE).
