# 🧠 Mémoire Permanente (SillyTavern)

Extension SillyTavern de **mémoire à long terme** pour les bots de jeu de rôle — pensée pour **ne pas gaspiller de crédits** (DeepSeek ou autre API payante) et pour l'**iPhone / Safari**. Interface 100 % en français.

- Une mémoire **par personnage** qui **survit à tous les chats** (nouveau chat, chat supprimé, rechargement), plus des mémoires **par persona**, **par groupe**, **« Monde »** (partagée) et **propres à un chat**.
- À chaque message, seuls les souvenirs **pertinents** sont injectés, dans un **budget strict** de tokens (400 par défaut) — la sélection est **100 % locale : 0 appel API, 0 crédit**.
- Création des souvenirs **à la main**, par un bouton 🧠 sur chaque message, par **détection locale gratuite** (boîte de candidats à valider d'un tap), ou — *seulement si tu le veux* — par l'IA, en **un seul appel groupé** plafonné par jour et par mois. **Seule l'IA sait résumer** (souvenirs courts, reformulés, à la 3ᵉ personne) ; l'analyse locale gratuite ne trouve que des faits très simples ou des extraits bruts à reformuler.
- Mode **« Ne jamais appeler l'IA »** : aucune requête ne part jamais à cause de l'extension.

> ⚠️ **Testée** dans une vraie instance SillyTavern 1.19.0 (Playwright WebKit, émulation iPhone 14 Pro) avec un faux backend compatible OpenAI. **Pas testée sur un vrai iPhone ni avec la vraie API DeepSeek.** Voir « Ce qui est vérifié » en bas.

## Mise à jour 1.1.0 — de vrais petits résumés (plus de copier-coller du chat)

Retour d'utilisation (RP en groupe) : les candidats recopiaient les messages au lieu de résumer, et c'était incomplet. Changements :

**1. L'extraction IA écrit des souvenirs reformulés.** Le prompt demande, pour chaque ligne : *un seul fait, 10 à 25 mots, en français, à la 3ᵉ personne, compréhensible sans le chat*, avec les prénoms ; il **interdit** de recopier phrases, répliques et guillemets ; il liste ce qu'il faut couvrir (relations entre personnages, événements marquants, décisions, promesses, secrets, préférences, état émotionnel durable, lieux et objets importants) et donne des exemples. Le format de sortie n'a pas changé (`type|importance|souvenir|mots-clés`) et l'analyse reste tolérante (lignes, JSON, ```, `<think>`…).
- **Dédoublonnage** : les souvenirs déjà connus (et les candidats en attente) sont envoyés à l'IA en liste compacte (~1600 caractères max, les plus importants/récents d'abord) pour qu'elle ne les répète pas ; en plus, tout candidat trop proche d'un souvenir existant (de n'importe quelle portée visible) est écarté localement. Le panneau indique « N déjà connu(s) ignoré(s) ».
- **Garde-fou anti-copie** : si l'IA recopie quand même (guillemets, suite de 10 mots identique à un message, phrase à la 1ʳᵉ personne), le candidat est marqué « ressemble à une copie du chat, à reformuler » : il n'est jamais accepté d'un tap (voir 3).
- Réglages par défaut adaptés : 8 souvenirs max par extraction (au lieu de 4), réponse 700 tokens (au lieu de 400), budget d'entrée 4000 (au lieu de 3000), car le prompt est plus long et les résumés plus complets.

**2. 🎬 « Résumer les derniers messages »** (onglet Candidats) : 1 appel IA → **1 candidat de type événement** de 2 à 4 phrases, reformulé, à valider d'un tap. Nombre de messages résumés réglable (12 par défaut). Même confirmation de coût en deux taps, mêmes plafonds jour/mois, pas de nouvel essai automatique.

**3. Analyse locale gratuite — ce qu'elle fait maintenant.** Une analyse locale (regex) **ne peut pas résumer**. Choix retenu : elle ne garde, **comme candidats directs**, que des **faits très structurés et fiables**, déjà reformulés à la 3ᵉ personne (« Léo adore les pommes rouges. », « Mara est allergique aux noix. », « Léo habite à Valmont. », « Léo se présente sous le nom de Rex. », goûts / dégoûts à objet précis). Pour tout le reste (promesses, secrets…), le bouton manuel *Analyser l'historique* propose encore la phrase brute, mais **clairement marquée « ✂️ Extrait brut, à reformuler »** : pas de bouton ✓ Garder, seulement **✎ Modifier** (avec une consigne de reformulation) et ✗ Rejeter, et « Tout accepter » les laisse de côté. La **détection automatique** à chaque message ne propose plus que les faits structurés (jamais de phrase brute). L'interface rappelle en une phrase que seule l'IA résume. Les anciens candidats « heuristique » encore en attente sont aussi marqués « extrait brut ».

**4. Réglages.** Le plafond d'appels IA par jour par défaut est **5** (les essais ratés ou vides comptent aussi, comme les relances). Migration : seules les valeurs *égales aux anciens défauts* sont remplacées (appels/jour 2 → 5, sauf si le préréglage 💰 Économie — qui vaut 2 volontairement — est actif ; faits max 4 → 8 ; réponse 400 → 700 ; budget d'entrée 3000 → 4000). Toute valeur personnalisée est conservée.

## Mise à jour 1.0.2 — extraction IA fiable (« No message generated »)

Le bouton **« Extraire avec l'IA »** pouvait afficher *« Erreur de l'API : No message generated »*. SillyTavern lève cette erreur quand la réponse du modèle est **vide**. Cause la plus probable : un **modèle à réflexion** (DeepSeek reasoner/R1, o1…) dont la réflexion consomme les 200 tokens de réponse autorisés et laisse le texte final vide (aussi possible : contexte trop grand, filtre du fournisseur). Corrigé :
- nouveau réglage **« Nombre de messages à analyser »** (40 par défaut) + **budget d'entrée en tokens** (3000) : les plus anciens messages sont retirés d'abord ;
- réponse max par défaut portée à **400 tokens** (réglable jusqu'à 4000) ;
- si la réponse est vide : **un seul nouvel essai** avec moins de messages et plus de place pour répondre (les 2 appels comptent dans les plafonds) ;
- si c'est encore vide : un message clair en français (causes probables, quoi régler) au lieu d'une « erreur d'API » ; rien n'est mémorisé ;
- analyse de la réponse tolérante : lignes `type|importance|fait|mots-clés`, **JSON** (tableau ou objet), blocs ```, texte autour, balises `<think>`.

Aucun appel IA n'est fait sans ton action (le comportement par défaut reste 100 % local).

## Mise à jour 1.0.1 — correctif groupes

Dans un chat de **groupe**, des souvenirs épinglés pouvaient ne **jamais** être injectés (« 0 / 400 tokens · 0 souvenir(s) sur 0 »). Cause : en 1.0.0 le réglage par défaut isolait les souvenirs **du seul perso qui parle** ; si ce perso (ou, hors génération, la fiche de membre ouverte) n'avait pas de souvenir à lui, les souvenirs attribués aux autres membres restaient hors du prompt. Corrigé : tous les membres sont injectés par défaut. **Aucun souvenir n'est perdu** : le fichier `permanent_memory_store.json` est relu tel quel, et une copie de sécurité `permanent_memory_store_backup_avant_1.0.1.json` est écrite une fois au premier chargement.

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
| Extraire des souvenirs à chaque message | 1 seul appel **groupé** tous les N messages (par défaut OFF, N = 10), réponse plafonnée (400 tokens), prompt court, **plafond d'appels par jour** et **plafond de tokens par mois** *durs* (aucun appel ne part au-delà). |
| Tout faire passer par l'IA | Détection **locale gratuite** (regex) → **boîte de candidats** : faits simples déjà reformulés (« Léo adore… », « Mara habite… ») ou extraits bruts marqués « à reformuler » (promesses, secrets, événements…) ; tu valides d'un tap ou tu édites. Elle ne résume pas : pour ça, 🤖 l'IA. |
| Cache de contexte cassé | Position par défaut **dans le chat, profondeur 4** : seuls les derniers messages changent d'un tour à l'autre, le début du prompt reste identique (important pour le **cache de contexte de DeepSeek**, qui ne facture presque rien les débuts de prompt identiques). Éviter « Après/Avant le prompt système », qui change tout le préfixe. |

Le panneau **Coût** montre : tokens injectés au dernier message et en moyenne, nombre d'appels IA (jour / total), tokens dépensés estimés (jour / mois / total), appels refusés par les plafonds. Un **avertissement** s'affiche si des souvenirs sont ignorés faute de budget, ou si l'injection dépasse le budget.

Boutons IA à **deux temps** : le 1er tap affiche l'estimation (≈ tokens), le 2e lance l'appel.

**Préréglages** : 💰 *Économie* (4 souvenirs, 200 tokens, aucun appel auto, 2 appels/jour — les essais ratés comptent), ⚖️ *Équilibré* (6 / 400), 🛋️ *Confort* (10 / 800). Et le bouton **« Mode économie »** en un tap.

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
- **Candidats** : propositions à valider (✓ garder / ✎ modifier / ✗ rejeter ; un rejeté n'est plus reproposé), *Analyser l'historique (gratuit)*, *Extraire avec l'IA (1 appel)*, *Résumer les derniers messages (1 appel)* ; les extraits bruts n'ont que ✎ Modifier / ✗ Rejeter.
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
/mem scan            (analyse locale gratuite → candidats ; les phrases brutes sont à reformuler)
/mem stats
/mem                 (ouvre le panneau)
```
`scope` = `perso` (défaut), `chat`, `monde`, `persona`, `groupe`, ou le nom d'un personnage du groupe. `type` = `fait`, `relation`, `evenement`, `preference`, `lieu`, `objectif`.

### Diagnostic de l'injection (onglet *Injection*)
- Affiche la **portée utilisée** (groupe, perso qui parle ou « pas encore choisi »), le **nombre de souvenirs par portée** (utilisables / épinglés / désactivés / archivés) et, si rien n'est injecté, **pourquoi** : réglage désactivé, souvenirs filtrés, ou souvenirs rattachés à une portée non injectée (ex. un personnage hors du groupe).
- L'aperçu et l'injection réelle utilisent **la même fonction** (`buildInjection`).
- **🧪 Tester l'injection maintenant** : liste exactement les souvenirs qui seraient injectés pour **chaque orateur possible** (avant le choix de l'orateur, puis chaque membre).
- **Dernière injection réellement envoyée** : orateur, tokens, souvenirs (avec leur portée) et compteur « utilisé ». Le passage « niveau groupe » de ST (qui n'est jamais envoyé au modèle) n'est plus compté.

### Chats de groupe
- Une mémoire **séparée par personnage**, mais **depuis la 1.0.1, par défaut, tous les membres du groupe sont injectés** (réglage *« Injecter les souvenirs de tous les membres du groupe »*, ON) : souvenirs **épinglés** de tous les membres + mémoire du **groupe** + **« Monde »** ; les souvenirs non épinglés sont classés par pertinence sur l'ensemble des membres et celui du **perso qui parle est favorisé** (×1,25) quand ST l'a déjà choisi. Les lignes sont étiquetées `(Nom)`. Les membres « muets » sont inclus par défaut (réglage dédié).
- Décocher le réglage rétablit l'ancien mode « isolé » (seul le perso qui parle) — dans ce mode, un souvenir attribué à un autre membre n'est **pas** injecté, et l'onglet *Injection* te le dit.
- **Attribution** : chaque carte affiche à qui appartient le souvenir (🎭 perso, 👥 groupe, 🌍 monde…) et un sélecteur **« Attribuer à »** permet de le changer en un tap (« Tout le groupe », un personnage, le chat, le monde). En groupe, un nouveau souvenir est attribué à *tout le groupe* par défaut. Un ⚠️ signale un souvenir rattaché à une portée qui n'est pas injectée dans le contexte courant.
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
| Détection locale (faits structurés reformulés ; ne résume pas) | ON |
| **Ne jamais appeler l'IA** | OFF |
| Extraction auto (tous les N messages) | **OFF** (N = 10, 8 souvenirs max, réponse 700 tokens, entrée 4000 ; manuel : 40 derniers messages) |
| Résumer les derniers messages | 12 messages → 1 candidat événement (2–4 phrases) |
| Plafond d'appels IA / jour (essais ratés compris) · tokens / mois (estimés) | 5 · 30 000 |
| Résumé glissant auto | **OFF** |
| Archivage auto | **OFF** |

## Ce qui est vérifié (et ce qui ne l'est pas)

Tests automatisés (`tests/`) contre un vrai SillyTavern 1.19.0 + faux backend OpenAI qui enregistre les prompts reçus :

- ✅ souvenirs persistants entre deux chats du même personnage, après rechargement et après suppression du chat ;
- ✅ seuls les souvenirs pertinents sont injectés, dans le budget de tokens ; les hors-sujet ne le sont pas ; l'épinglé l'est toujours ;
- ✅ mode « Ne jamais appeler l'IA » : 0 requête mémoire (compteur côté backend) ;
- ✅ extraction automatique : exactement 1 appel par intervalle, plafond quotidien respecté ;
- ✅ boîte de candidats (accepter / rejeter), résumé, doublons/fusion, archivage, import/export aller-retour, sauvegarde ;
- ✅ chat de groupe : 3 souvenirs épinglés attribués à 3 membres, un 4ᵉ membre (sans souvenir) qui parle → les 3 sont injectés ; budget respecté ; compteur « utilisé » incrémenté une seule fois par vraie génération (`tests/e2e-group.mjs`) ; isolation par personnage seulement si le réglage est décoché ;
- ✅ 1.1.0 (`tests/e2e-resumes.mjs`, faux backend dont la réponse contient des souvenirs reformulés) : prompt reformulé + souvenirs connus envoyés, doublon de sens ignoré, copies/guillemets marqués « à reformuler » (sans ✓ Garder), acceptation / « Tout accepter (sauf bruts) » / ✎ Modifier, relance sans doublons, bouton « Résumer les derniers messages » (confirmation de coût, 1 appel, 1 candidat événement, plafond respecté, réponse vide), analyse locale (faits structurés vs extraits bruts), migration des réglages, 0 erreur console ;
- ✅ interface utilisable à la taille d'un iPhone 14 Pro, aucun `transform` ajouté sur un ancêtre, aucune erreur console.

Non vérifié : la **qualité réelle des résumés** (le faux backend renvoie une réponse écrite à l'avance : seul un vrai modèle montrera si le prompt suffit à le faire reformuler), **vrai iPhone** (seulement l'émulation WebKit), **vraie API DeepSeek** (l'économie réelle dépendra de ton usage), autres thèmes que celui par défaut.

Lancer les tests : démarrer SillyTavern avec l'extension, `node tests/mock-openai.mjs 9101`, puis `node tests/e2e.mjs`, `node tests/e2e-extract.mjs`, `node tests/e2e-resumes.mjs` (et `node tests/core.test.mjs` pour la logique pure).

## Licence

MIT
