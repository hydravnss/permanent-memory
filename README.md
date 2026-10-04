# 🧠 Mémoire Permanente (SillyTavern)

Extension SillyTavern de **mémoire à long terme** pour les bots de jeu de rôle — pensée pour **ne pas gaspiller de crédits** (DeepSeek ou autre API payante) et pour l'**iPhone / Safari**. Interface 100 % en français.

- Une mémoire **par personnage** qui **survit à tous les chats** (nouveau chat, chat supprimé, rechargement), plus des mémoires **par persona**, **par groupe**, **« Monde »** (partagée) et **propres à un chat**.
- À chaque message, seuls les souvenirs **pertinents** sont injectés, dans un **budget strict** de tokens (400 par défaut) — la sélection est **100 % locale : 0 appel API, 0 crédit**.
- Création des souvenirs **à la main**, par un bouton 🧠 sur chaque message, par **détection locale gratuite** (boîte de candidats à valider d'un tap), ou — *seulement si tu le veux* — par l'IA, en **un seul appel groupé** plafonné par jour et par mois.
- Mode **« Ne jamais appeler l'IA »** : aucune requête ne part jamais à cause de l'extension.

> ⚠️ **Testée** dans une vraie instance SillyTavern 1.19.0 (Playwright WebKit, émulation iPhone 14 Pro) avec un faux backend compatible OpenAI. **Pas testée sur un vrai iPhone ni avec la vraie API DeepSeek.** Voir « Ce qui est vérifié » en bas.

## Installation

SillyTavern → **Extensions** (icône 🧩) → **Install extension** → colle l'URL :

```
https://github.com/hydravnss/permanent-memory
```

Nécessite SillyTavern ≥ 1.12.0. Ensuite : Extensions → **🧠 Mémoire Permanente** pour les réglages, ou ouvre la mémoire par :

- la baguette magique 🪄 (à gauche de la zone de saisie) → **🧠 Mémoire** ;
- la commande `/mem` ;
- le petit **bouton flottant 🧠** (optionnel, Extensions → Mémoire Permanente → *Petit bouton flottant*), placé avec les curseurs ou en le glissant (*Déplacer le bouton*).

## Comment ça économise tes crédits

| Ce qui coûte d'habitude | Ici |
|---|---|
| Un « résumé » envoyé à l'IA toutes les X messages | **Désactivé par défaut.** Aucun appel automatique tant que tu ne l'actives pas. |
| Une base vectorielle / des embeddings (API) | **Aucun embedding.** Sélection locale en JavaScript : mots-clés + BM25 (type TF-IDF) + importance + récence, sur FR/EN (stopwords, racinisation légère, accents/pluriels ignorés). |
| Tout injecter dans chaque prompt | **Budget strict** : max. N souvenirs **et** max. T tokens (par défaut 6 / 400). Seul ce qui concerne les derniers messages est injecté ; les souvenirs 📌 épinglés sont toujours inclus (mais dans le budget). |
| Extraire des souvenirs à chaque message | 1 seul appel **groupé** tous les N messages (par défaut OFF, N = 10), réponse plafonnée (200 tokens), prompt court, **plafond d'appels par jour** et **plafond de tokens par mois** *durs* (aucun appel ne part au-delà). |
| Tout faire passer par l'IA | Détection **locale gratuite** (regex : « je t'aime », « je te promets », « souviens-toi », noms, dates, événements, préférences…) → **boîte de candidats** : tu valides d'un tap. |
| Cache de contexte cassé | Position par défaut **dans le chat, profondeur 4** : seuls les derniers messages changent d'un tour à l'autre, le début du prompt reste identique (important pour le **cache de contexte de DeepSeek**, qui ne facture presque rien les débuts de prompt identiques). Éviter « Après/Avant le prompt système », qui change tout le préfixe. |

Le panneau **Coût** montre : tokens injectés au dernier message et en moyenne, nombre d'appels IA (jour / total), tokens dépensés estimés (jour / mois / total), appels refusés par les plafonds. Un **avertissement** s'affiche si des souvenirs sont ignorés faute de budget, ou si l'injection dépasse le budget.

Boutons IA à **deux temps** : le 1er tap affiche l'estimation (≈ tokens), le 2e lance l'appel.

**Préréglages** : 💰 *Économie* (4 souvenirs, 200 tokens, aucun appel auto, 2 appels/jour), ⚖️ *Équilibré* (6 / 400), 🛋️ *Confort* (10 / 800). Et le bouton **« Mode économie »** en un tap.

> Conseil DeepSeek : pour l'extraction/résumé, garde un modèle *chat* (pas *reasoner*) — le raisonnement consommerait la limite de tokens de la réponse.

## Où sont les souvenirs ?

| Type | Stockage |
|---|---|
| 🎭 Personnage, 👥 Groupe, 🌍 Monde, 🙋 Persona | **Fichier serveur** `data/<utilisateur>/user/files/permanent_memory_store.json` (écrit via `/api/files/upload`). Clé = nom de fichier d'avatar du personnage (`Seraphina.png`), id du groupe, id du persona. **Indépendant des chats** : survit à la suppression d'un chat. |
| 💬 Ce chat uniquement, résumé glissant | `chat_metadata.permanent_memory` : dans le fichier du chat lui-même. |
| Réglages, compteurs | `extension_settings.permanent_memory` (`settings.json`). Les anciens réglages sont complétés automatiquement par les nouvelles options. |

Le fichier n'est **jamais écrasé** si sa lecture a échoué (réseau coupé…). Pense à faire une sauvegarde de temps en temps (Outils → 💾 *Sauvegarde complète* : télécharge un JSON **et** garde une copie sur le serveur).

Chaque souvenir : `id`, `texte` court, `type` (fait, relation, événement, préférence, lieu, promesse/objectif, résumé), `importance` 1–5 ★, `mots-clés`, date de création, dernière utilisation + nombre d'utilisations, 📌 épinglé, activé/désactivé, archivé, index du message source.

## Utilisation

### Panneau (🪄 → 🧠 Mémoire)
- **Souvenirs** : liste filtrable (portée, recherche, type, état), étoiles d'importance, 📌 épingler, ⏸ désactiver, 🗄 archiver, ✎ modifier, 🗑 supprimer (2 taps).
- **Candidats** : propositions à valider (✓ garder / ✎ modifier / ✗ rejeter ; un rejeté n'est plus reproposé), *Analyser l'historique (gratuit)*, *Extraire avec l'IA (1 appel)*.
- **Injection** : aperçu exact du bloc qui sera injecté + jauge de tokens + avertissements + **simulateur** (« si je dis ça, que se passe-t-il ? », sans appel API).
- **Coût** : voir plus haut.
- **Outils** : résumé glissant (1 souvenir, 1 appel), doublons (Jaccard) + fusion, archivage, export/import JSON, sauvegarde, zone dangereuse.

### Bouton 🧠 sur chaque message
Dans les actions du message (icône « … »), 🧠 **Mémoriser ce message** : propose la sélection (si tu as surligné du texte) ou les phrases clés du message, que tu peux éditer avant d'enregistrer.

### Commandes
```
/mem add Léo déteste les araignées
/mem add scope=monde type=lieu imp=4 pin=true Valmont est en guerre
/mem list
/mem forget <id>
/mem pin <id>        /mem unpin <id>
/mem scan            (analyse locale gratuite → candidats)
/mem stats
/mem                 (ouvre le panneau)
```
`scope` = `perso` (défaut), `chat`, `monde`, `persona`, `groupe`, ou le nom d'un personnage du groupe. `type` = `fait`, `relation`, `evenement`, `preference`, `lieu`, `objectif`.

### Chats de groupe
- Une mémoire **séparée par personnage**. Par défaut, seule la mémoire du **personnage qui parle** (+ mémoire du groupe + « Monde ») est injectée : Bob ne « sait » pas ce que Seraphina a en mémoire. Option : *tous les personnages présents* (les lignes sont alors étiquetées `(Nom)`).
- Les messages d'un personnage proposent des candidats pour **ce** personnage ; ceux de l'utilisateur vont à la mémoire du **groupe**.

### Entretien
- **Doublons** : détection locale (Jaccard, seuil réglable) + fusion en un tap.
- **Archivage automatique** (OFF par défaut) : les souvenirs d'importance ≤ 2, non épinglés et inutilisés depuis N jours sont **archivés** (jamais supprimés, restaurables).
- **Résumé glissant** (OFF par défaut) : un seul souvenir « Résumé » par chat, toujours injecté, mis à jour rarement (même garde-fou de budget).

## Réglages principaux

| Réglage | Défaut |
|---|---|
| Souvenirs max / budget tokens | 6 / 400 |
| Messages récents analysés | 4 |
| Sensibilité (score minimal de pertinence) | 0,5 |
| Position | Dans le chat, profondeur 4, rôle système |
| Détection locale de candidats | ON |
| **Ne jamais appeler l'IA** | OFF |
| Extraction auto (tous les N messages) | **OFF** (N = 10, 4 faits max, 200 tokens) |
| Plafond d'appels IA / jour · tokens / mois (estimés) | 5 · 30 000 |
| Résumé glissant auto | **OFF** |
| Archivage auto | **OFF** |

## Ce qui est vérifié (et ce qui ne l'est pas)

Tests automatisés (`tests/`) contre un vrai SillyTavern 1.19.0 + faux backend OpenAI qui enregistre les prompts reçus :

- ✅ souvenirs persistants entre deux chats du même personnage, après rechargement et après suppression du chat ;
- ✅ seuls les souvenirs pertinents sont injectés, dans le budget de tokens ; les hors-sujet ne le sont pas ; l'épinglé l'est toujours ;
- ✅ mode « Ne jamais appeler l'IA » : 0 requête mémoire (compteur côté backend) ;
- ✅ extraction automatique : exactement 1 appel par intervalle, plafond quotidien respecté ;
- ✅ boîte de candidats (accepter / rejeter), résumé, doublons/fusion, archivage, import/export aller-retour, sauvegarde ;
- ✅ chat de groupe : isolation par personnage ;
- ✅ interface utilisable à la taille d'un iPhone 14 Pro, aucun `transform` ajouté sur un ancêtre, aucune erreur console.

Non vérifié : **vrai iPhone** (seulement l'émulation WebKit), **vraie API DeepSeek** (l'économie réelle dépendra de ton usage), autres thèmes que celui par défaut.

Lancer les tests : démarrer SillyTavern avec l'extension, `node tests/mock-openai.mjs 9101`, puis `node tests/e2e.mjs` (et `node tests/core.test.mjs` pour la logique pure).

## Licence

MIT
