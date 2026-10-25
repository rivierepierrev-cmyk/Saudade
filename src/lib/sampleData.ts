import { DocumentItem, ExtractItem, ClozeItem } from '../types/foliole';

export const SAMPLE_DOCUMENTS: DocumentItem[] = [
  {
    id: 'doc-wozniak-rules',
    title: 'Les 20 Règles de Formulation des Connaissances en Lecture Incrémentale',
    author: 'Dr. Piotr Woźniak',
    sourceUrl: 'https://super-memory.com/articles/20rules.htm',
    folder: 'Apprentissage & Mémoire/SuperMemo',
    format: 'article',
    tags: ['Lecture Incrémentale', 'Cognition', 'SuperMemo', 'Science de l\'Apprentissage'],
    priority: 95,
    readingProgress: 42,
    lastReadOffset: 480,
    createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 1 * 86400000).toISOString(),
    state: 'learning',
    extractedCount: 3,
    fsrs: {
      stability: 3.2,
      difficulty: 4.8,
      reps: 2,
      lapses: 0,
      lastReview: new Date(Date.now() - 2 * 86400000).toISOString(),
      nextReviewDate: new Date().toISOString(), // à réviser aujourd'hui !
      interval: 2,
    },
    content: `# Les 20 Règles de Formulation des Connaissances

La lecture incrémentale est une méthode d'apprentissage qui permet de lire simultanément des dizaines ou des centaines d'articles et d'ouvrages sans jamais se perdre. Elle a été inventée par le Dr. Piotr Woźniak dans le cadre de SuperMemo.

Le principe cardinal de la lecture incrémentale est limpide :
Plutôt que d'ingurgiter un livre dense d'une seule traite lors d'un marathon épuisant, vous le découpez en fragments assimilés sur des jours, des semaines ou des mois au rythme de votre mémoire.

## Règle 1 : Comprendre avant de mémoriser
Apprendre par cœur sans comprendre est une pure perte de temps. Si vous ne saisissez pas le mécanisme sous-jacent, votre cerveau ne dispose d'aucun échafaudage conceptuel pour y ancrer les traces mémorielles. Face à un sujet complexe (neurosciences, mécanique quantique, droit fiscal), construisez d'abord une représentation mentale cohérente avant de créer la moindre carte.

## Règle 2 : Apprendre l'ensemble avant de mémoriser le détail
Bâtissez la vue d'ensemble avant de découper la matière en items élémentaires. En lecture incrémentale, vous survolez d'abord le texte, en extrayez de larges passages représentatifs, et ce n'est que plus tard que vous transformez ces extraits en clozes atomiques.

## Règle 3 : Consolider les fondations
La structure de la mémoire ressemble à un arbre. Le tronc et les racines incarnent les concepts fondateurs ; les feuilles symbolisent les détails pointus. Si le tronc vacille, les feuilles tombent aussitôt.

## Règle 4 : Respecter le Principe d'Information Minimale (MIP)
C'est la règle d'or absolue de la répétition espacée. Chaque carte ou cloze doit tester UN SEUL fait atomique. Si un élément réunit deux ou trois informations distinctes, un oubli sur une seule d'entre elles vous contraint à réviser tout le bloc, provoquant interférence et saturation cognitive.

## Règle 5 : Le texte à trou (Cloze) est rapide et souverain
Une suppression partielle (cloze) est une phrase dont un mot-clé est masqué sous la forme "[...]". En lecture incrémentale, forger une cloze prend moins de deux secondes, tout en métamorphosant un paragraphe passif en un puissant stimulus de rappel actif.`
  },
  {
    id: 'doc-fsrs-algorithm',
    title: 'FSRS : Fondations Mathématiques de la Répétition Espacée Moderne',
    author: 'Jarrett Ye',
    sourceUrl: 'https://github.com/open-spaced-repetition/fsrs4anki',
    folder: 'Apprentissage & Mémoire/Répétition Espacée',
    format: 'article',
    tags: ['FSRS', 'Algorithmes', 'Mathématiques', 'Répétition Espacée'],
    priority: 88,
    readingProgress: 25,
    lastReadOffset: 240,
    createdAt: new Date(Date.now() - 7 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 1 * 86400000).toISOString(),
    state: 'learning',
    extractedCount: 2,
    fsrs: {
      stability: 4.5,
      difficulty: 5.2,
      reps: 3,
      lapses: 0,
      lastReview: new Date(Date.now() - 3 * 86400000).toISOString(),
      nextReviewDate: new Date().toISOString(), // à réviser aujourd'hui
      interval: 3,
    },
    content: `# Le Planificateur de Répétition Espacée Libre (FSRS)

FSRS est un algorithme de répétition espacée de pointe, open-source, qui surpasse nettement le modèle historique SM-2 employé dans les logiciels traditionnels.

## Les Trois Piliers de la Mémoire
FSRS modélise la mémoire humaine à l'aide de trois variables fondamentales :

1. **Rappelabilité (R - Retrievability)** : La probabilité qu'une personne se remémore avec succès une information donnée à un instant $t$. La rappelabilité décline de manière exponentielle selon la courbe de l'oubli d'Ebbinghaus.
2. **Stabilité (S - Stability)** : Le temps (en jours) nécessaire pour que la Rappelabilité chute de 100% à 90%. À chaque révision réussie, la Stabilité grandit.
3. **Difficulté (D - Difficulty)** : La résistance intrinsèque d'une trace mnésique face à l'accroissement de stabilité. Les faits simples ont une faible valeur $D$, tandis que les concepts complexes présentent un $D$ élevé.

## Formulation Mathématique
La courbe de l'oubli dans FSRS s'exprime par :
$$R(t, S) = (1 + \\frac{t}{9S})^{-1}$$
Où :
- $t$ est le temps écoulé en jours depuis la précédente révision.
- $S$ est la stabilité mémorielle.
- Lorsque $t = S$, $R = (1 + 1/9)^{-1} = 0,90$ (exactement 90% de rétention cible).`
  },
  {
    id: 'doc-neurobiology-memory',
    title: 'La Neurobiologie de la Mémoire : Potentialisation à Long Terme & Plasticité',
    author: 'Eric Kandel & T. Bliss',
    folder: 'Sciences/Neurobiologie',
    format: 'book',
    tags: ['Neurosciences', 'Biologie', 'Plasticité Synaptique'],
    priority: 75,
    readingProgress: 15,
    lastReadOffset: 120,
    createdAt: new Date(Date.now() - 10 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    state: 'learning',
    extractedCount: 2,
    fsrs: {
      stability: 6.0,
      difficulty: 6.5,
      reps: 1,
      lapses: 0,
      lastReview: new Date(Date.now() - 4 * 86400000).toISOString(),
      nextReviewDate: new Date(Date.now() + 2 * 86400000).toISOString(),
      interval: 6,
    },
    content: `# La Potentialisation à Long Terme (LTP)

La Potentialisation à Long Terme (LTP) correspond au renforcement persistant de la transmission synaptique consécutif à une stimulation synaptique répétée et conjointe. Elle constitue le substrat cellulaire fondamental de l'apprentissage et de la mémoire déclarative.

## Activation du Récepteur NMDA
Dans la région CA1 de l'hippocampe, l'induction de la LTP repose essentiellement sur les récepteurs glutamatergiques NMDA (N-méthyl-D-aspartate).

Au potentiel de repos membranaire, le canal ionique du récepteur NMDA est obstrué par des ions magnésium extracellulaires (Mg2+). Lorsque l'épine dendritique postsynaptique subit une forte dépolarisation (relayée par les récepteurs AMPA), le bouchon de magnésium est expulsé électrostatiquement.

Les ions calcium (Ca2+) pénètrent alors massivement dans la cellule postsynaptique, activant la protéine kinase CaMKII. Cette cascade entraîne l'insertion durable de récepteurs AMPA supplémentaires dans la densité postsynaptique.`
  },
  {
    id: 'doc-seneca-time',
    title: 'Sénèque : De la brièveté de la vie (De Brevitate Vitae)',
    author: 'Lucius Annaeus Sénèque',
    folder: 'Philosophie/Stoïcisme',
    format: 'book',
    tags: ['Philosophie', 'Stoïcisme', 'Gestion du Temps'],
    priority: 80,
    readingProgress: 60,
    lastReadOffset: 340,
    createdAt: new Date(Date.now() - 14 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
    state: 'learning',
    extractedCount: 1,
    fsrs: {
      stability: 8.0,
      difficulty: 3.5,
      reps: 4,
      lapses: 0,
      lastReview: new Date(Date.now() - 5 * 86400000).toISOString(),
      nextReviewDate: new Date().toISOString(), // à réviser
      interval: 8,
    },
    content: `# De la brièveté de la vie

La plupart des mortels, Paulinus, se plaignent de l'injustice de la Nature, de ce que nous soyons enfantés pour un espace de temps si court, de ce que le laps de vie qui nous est accordé s'écoule avec tant de rapidité et d'emportement, au point que, sauf un petit nombre d'élus, la vie abandonne les autres alors même qu'ils se préparent à vivre.

Ce n'est point que nous ayons peu de temps à vivre, mais c'est que nous en perdons beaucoup. La vie est assez longue, et une mesure généreuse nous a été départie pour l'accomplissement des plus grands desseins, si elle était tout entière bien employée.

Chacun est avare pour défendre son patrimoine ; mais dès qu'il s'agit de gaspiller le temps, on se montre prodigue de la seule chose pour laquelle l'avarice est une vertu.`
  }
];

export const SAMPLE_EXTRACTS: ExtractItem[] = [
  {
    id: 'ext-mip',
    documentId: 'doc-wozniak-rules',
    documentTitle: 'Les 20 Règles de Formulation des Connaissances',
    text: 'Respecter le Principe d\'Information Minimale (MIP) : Chaque carte ou cloze deletion doit tester UN SEUL fait atomique. Si un item réunit deux ou trois informations, un oubli sur une seule vous contraint à réviser l\'ensemble, provoquant interférence et saturation cognitive.',
    note: 'Règle maîtresse pour composer des cartes de révision percutantes.',
    tags: ['MIP', 'Cognition', 'Lecture Incrémentale'],
    priority: 95,
    createdAt: new Date(Date.now() - 4 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 1 * 86400000).toISOString(),
    state: 'learning',
    fsrs: {
      stability: 4.2,
      difficulty: 4.5,
      reps: 2,
      lapses: 0,
      lastReview: new Date(Date.now() - 2 * 86400000).toISOString(),
      nextReviewDate: new Date().toISOString(),
      interval: 2,
    }
  },
  {
    id: 'ext-fsrs-stability',
    documentId: 'doc-fsrs-algorithm',
    documentTitle: 'FSRS : Fondations Mathématiques de la Répétition Espacée',
    text: 'La Stabilité (S) est définie comme le nombre de jours nécessaires pour que la Rappelabilité (R) chute de 100% à 90%. Au fil des révisions réussies, la Stabilité augmente de manière exponentielle.',
    note: 'Définition technique de la Stabilité selon l\'algorithme FSRS.',
    tags: ['FSRS', 'Stabilité', 'Mémoire'],
    priority: 88,
    createdAt: new Date(Date.now() - 6 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 1 * 86400000).toISOString(),
    state: 'learning',
    fsrs: {
      stability: 3.5,
      difficulty: 4.0,
      reps: 2,
      lapses: 0,
      lastReview: new Date(Date.now() - 1 * 86400000).toISOString(),
      nextReviewDate: new Date().toISOString(),
      interval: 1,
    }
  },
  {
    id: 'ext-nmda-magnesium',
    documentId: 'doc-neurobiology-memory',
    documentTitle: 'La Neurobiologie de la Mémoire : Plasticité Synaptique',
    text: 'Au potentiel de repos membranaire, le canal ionique du récepteur NMDA est obstrué par des ions magnésium (Mg2+). Lorsque l\'épine dendritique subit une dépolarisation via les récepteurs AMPA, ce bouchon est expulsé électrostatiquement.',
    note: 'Mécanisme moléculaire du détecteur de coïncidence synaptique.',
    tags: ['Neurosciences', 'LTP', 'Synapse'],
    priority: 82,
    createdAt: new Date(Date.now() - 8 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 1 * 86400000).toISOString(),
    state: 'learning',
    fsrs: {
      stability: 5.0,
      difficulty: 6.0,
      reps: 2,
      lapses: 0,
      lastReview: new Date(Date.now() - 3 * 86400000).toISOString(),
      nextReviewDate: new Date().toISOString(),
      interval: 3,
    }
  }
];

export const SAMPLE_CLOZES: ClozeItem[] = [
  {
    id: 'cloze-mip',
    documentId: 'doc-wozniak-rules',
    extractId: 'ext-mip',
    documentTitle: 'Les 20 Règles de Formulation',
    text: 'Le {{c1::Principe d\'Information Minimale}} exige que chaque carte de révision ne teste qu\'{{c2::un seul fait atomique}} afin de prévenir toute interférence mémorielle.',
    note: 'Règle n°4 de formulation des connaissances de Woźniak.',
    tags: ['MIP', 'Lecture Incrémentale'],
    priority: 96,
    createdAt: new Date(Date.now() - 4 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 1 * 86400000).toISOString(),
    state: 'learning',
    fsrs: {
      stability: 2.5,
      difficulty: 4.2,
      reps: 3,
      lapses: 0,
      lastReview: new Date(Date.now() - 2 * 86400000).toISOString(),
      nextReviewDate: new Date().toISOString(),
      interval: 2,
    }
  },
  {
    id: 'cloze-fsrs-r',
    documentId: 'doc-fsrs-algorithm',
    extractId: 'ext-fsrs-stability',
    documentTitle: 'FSRS Fondations Mathématiques',
    text: 'Dans FSRS, la {{c1::Stabilité (S)}} correspond au délai en jours pour que la rappelabilité mémorielle passe de 100% à {{c2::90%}}.',
    note: 'Définition canonique de la stabilité.',
    tags: ['FSRS', 'Mémoire'],
    priority: 90,
    createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 1 * 86400000).toISOString(),
    state: 'learning',
    fsrs: {
      stability: 3.8,
      difficulty: 4.0,
      reps: 2,
      lapses: 0,
      lastReview: new Date(Date.now() - 1 * 86400000).toISOString(),
      nextReviewDate: new Date().toISOString(),
      interval: 1,
    }
  },
  {
    id: 'cloze-nmda-ion',
    documentId: 'doc-neurobiology-memory',
    extractId: 'ext-nmda-magnesium',
    documentTitle: 'Neurobiologie de la Mémoire',
    text: 'Au potentiel de repos, les récepteurs NMDA sont bloqués par les ions {{c1::magnésium (Mg2+)}}, qui sont chassés lors de la dépolarisation via les récepteurs {{c2::AMPA}}.',
    note: 'Biologie moléculaire de la potentialisation à long terme.',
    tags: ['Neurosciences', 'LTP'],
    priority: 85,
    createdAt: new Date(Date.now() - 7 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 1 * 86400000).toISOString(),
    state: 'learning',
    fsrs: {
      stability: 4.2,
      difficulty: 6.1,
      reps: 2,
      lapses: 0,
      lastReview: new Date(Date.now() - 2 * 86400000).toISOString(),
      nextReviewDate: new Date().toISOString(),
      interval: 2,
    }
  }
];
