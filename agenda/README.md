# Agenda

Agenda pour enseignants : des séquences construites avec des blocs de séances, posées sur l'emploi du temps d'une classe, et décalées automatiquement après les vacances.

Ce dossier est un projet autonome, prévu pour devenir son propre dépôt. Il ne dépend de rien d'autre dans ce dépôt.

    npm install
    npm test       # tests (Node ≥ 22.18, qui exécute le TypeScript directement)
    npm run lint   # vérification des types

## État : le moteur de planification (P0) et les vacances (P1)

Il n'y a pas encore d'interface. Ce qui existe :

- **Modèle** (`src/model.ts`) : classes, créneaux de l'emploi du temps (semaines A/B, changement d'emploi du temps en cours d'année), séances (une séance peut durer plusieurs cours), séquences, placements, calendrier (vacances, jours fériés, fermetures pour une classe), cours annulés, cours exceptionnels.
- **`plan(agenda)`** (`src/plan.ts`) : donne à chaque séance ses cours réels, dans l'ordre. Elle saute les vacances, les jours fériés, les fermetures et les cours annulés, et calcule la date de fin de chaque séquence. Les séquences d'une classe s'enchaînent : sans date de début, une séquence commence au cours qui suit la fin de la précédente.
  - **Aucune date n'est enregistrée** : tout est recalculé. Ajouter des vacances ou annuler un cours décale donc automatiquement tout ce qui suit.
  - Avertissements, jamais d'erreurs : séquence qui déborde de l'année, date de début repoussée parce que la séquence précédente n'est pas finie, séquence vide ou introuvable.
  - Une séance sur plusieurs cours séparés par des vacances est signalée (`interrupted`).
- **`previewPlacement(agenda, placement, index)`** : ce que donnerait le glisser-déposer d'une séquence sur une classe, sans rien modifier. Elle renvoie les dates des séances, la date de fin, et les séquences suivantes qui seraient décalées.
- **`dayEntries` / `weekEntries`** : les cours d'un jour ou d'une semaine, avec la séance prévue ou libres.
- **Vacances** (`src/holidays.ts`) : jours fériés calculés à partir de Pâques (avec l'option Alsace-Moselle), et import des vacances scolaires par zone depuis le jeu de données officiel « Calendrier scolaire » de data.education.gouv.fr. Le jour de reprise est exclu, et les dates sont prises à l'heure de Paris.

## Suite

1. Éditeur d'emploi du temps et éditeur de séquences par blocs (P2).
2. Vues jour / semaine / mois et glisser-déposer des séquences, avec l'aperçu de `previewPlacement` (P3).
3. Annuler/rétablir, vue « Aujourd'hui », séances faites ou non faites, export PDF/iCal, synchronisation (P4).
