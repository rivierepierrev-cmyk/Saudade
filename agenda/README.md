# Agenda

Agenda pour enseignants : des séquences construites avec des blocs de séances, posées sur l'emploi du temps d'une classe, et décalées automatiquement après les vacances.

Ce dossier est un projet autonome, prévu pour devenir son propre dépôt. Il ne dépend de rien d'autre dans ce dépôt.

    npm install
    npm run dev       # interface : http://127.0.0.1:5173
    npm test          # tests (Node ≥ 22.18, qui exécute le TypeScript directement)
    npm run test:e2e  # test dans un navigateur (Playwright)
    npm run lint      # vérification des types

## Emploi du temps

- **Classes** (à gauche) : ajouter, renommer, changer la couleur, supprimer (avec ses cours ; les séquences restent). Chaque classe affiche son nombre de cours par semaine et ses heures.
- **Dessiner un cours** : sélectionnez une classe, puis cliquez-glissez dans un jour, de l'heure de début à l'heure de fin (au pas de 5 min). Un simple clic donne un cours de 55 min. « + Ajouter un cours » fait la même chose avec un formulaire (au clavier, sur téléphone).
- **Modifier un cours** : cliquez dessus. Classe, jour, heures, salle, semaine A ou B, et période de validité si l'emploi du temps change en cours d'année.
- Deux cours à la même heure sont signalés en rouge et affichés côte à côte (sauf un cours de semaine A et un de semaine B).
- **Semaines A/B** : la semaine A de référence, et si les semaines de vacances comptent ou non. Un cours d'une seule semaine compte pour un demi-cours par semaine.

## Séquences

- **Bibliothèque** (à gauche) : créer, choisir une séquence. Titre, matière, couleur, dupliquer, supprimer.
- **Séances en blocs** : glisser la poignée ⠿ pour réordonner (souris ou doigt), ou flèches haut/bas sur la poignée, ou boutons ↑ ↓. Dupliquer, supprimer (confirmation si la séance a du contenu).
- **Fiche séance** (clic sur un bloc) : titre, durée en cours (une séance peut prendre 2 cours ou plus), objectifs, déroulé, matériel, devoirs. « Réutiliser dans une autre séquence » en ajoute une copie à la fin d'une autre séquence.
- La séquence affiche son nombre de cours et sa durée estimée pour chaque classe, d'après son emploi du temps (« ≈ 3,5 semaines en 6e B »).

Tout est enregistré dans le navigateur (`localStorage`) pour l'instant.

## Fenêtre « Vacances »

Le bouton « Vacances » ouvre l'année scolaire (premier et dernier jour de cours) et la liste des jours sans cours. Une ligne par période, avec un nom (facultatif) et :

- **Un jour** : une seule date (jour férié, pont, journée banalisée) ;
- **Période** : du … au …, les deux dates comprises. Si la date de début passe après la date de fin, la fin suit.

« + Ajouter une ligne » ajoute une ligne vide, la corbeille la supprime. « Ajouter les jours fériés » ajoute ceux de l'année scolaire qui manquent. Une ligne incomplète est signalée en rouge et empêche d'enregistrer. « Annuler » ou Échap ferment sans rien changer.

## Le moteur de planification

- **Modèle** (`src/model.ts`) : classes, créneaux de l'emploi du temps (semaines A/B, changement d'emploi du temps en cours d'année), séances (une séance peut durer plusieurs cours), séquences, placements, calendrier (vacances, jours fériés, fermetures pour une classe), cours annulés, cours exceptionnels.
- **`plan(agenda)`** (`src/plan.ts`) : donne à chaque séance ses cours réels, dans l'ordre. Elle saute les vacances, les jours fériés, les fermetures et les cours annulés, et calcule la date de fin de chaque séquence. Les séquences d'une classe s'enchaînent : sans date de début, une séquence commence au cours qui suit la fin de la précédente.
  - **Aucune date n'est enregistrée** : tout est recalculé. Ajouter des vacances ou annuler un cours décale donc automatiquement tout ce qui suit.
  - Avertissements, jamais d'erreurs : séquence qui déborde de l'année, date de début repoussée parce que la séquence précédente n'est pas finie, séquence vide ou introuvable.
  - Une séance sur plusieurs cours séparés par des vacances est signalée (`interrupted`).
- **`previewPlacement(agenda, placement, index)`** : ce que donnerait le glisser-déposer d'une séquence sur une classe, sans rien modifier. Elle renvoie les dates des séances, la date de fin, et les séquences suivantes qui seraient décalées.
- **`dayEntries` / `weekEntries`** : les cours d'un jour ou d'une semaine, avec la séance prévue ou libres.
- **Vacances** (`src/holidays.ts`) : jours fériés calculés à partir de Pâques (avec l'option Alsace-Moselle), et import des vacances scolaires par zone depuis le jeu de données officiel « Calendrier scolaire » de data.education.gouv.fr. Le jour de reprise est exclu, et les dates sont prises à l'heure de Paris.

## Suite

1. Vues jour / semaine / mois et glisser-déposer des séquences sur les classes, avec l'aperçu de `previewPlacement` (P3).
2. Annuler/rétablir, vue « Aujourd'hui », séances faites ou non faites, export PDF/iCal, synchronisation (P4).
