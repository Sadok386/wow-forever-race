# RUSH 60 — WoW Forever

Un petit site pour suivre le rush vers le niveau 60 entre amis sur **World of Warcraft: Forever** : classement en direct, courbe de progression, derniers niveaux gagnés, fiche de chaque personnage (équipement, statistiques, métiers, talents) et lien vers l'armurerie officielle. À la première visite, une intro vidéo s'affiche une seule fois (bouton « Passer ») ; « Rejouer l'intro », sous le titre, la relance.

Il est hébergé gratuitement sur GitHub Pages. Une tâche GitHub interroge l'API officielle de Blizzard toutes les 15 minutes environ et republie le site. Tes amis ajoutent ou retirent un personnage directement depuis le site, sans compte GitHub, grâce à un lien de modification que tu leur envoies.

## Ce qu'il te faut

- Un compte GitHub.
- Un compte Battle.net, pour créer une clé d'accès gratuite à l'API Blizzard.
- Git sur ton ordinateur, pour envoyer les fichiers (ou l'envoi de fichiers par le site de GitHub).

## Mise en ligne

### 1. Crée le dépôt et envoie les fichiers

Sur GitHub, crée un dépôt **public** vide, par exemple `wow-forever-race`, sans README ni licence. Puis, dans le dossier du projet :

```bash
git init -b main
git add -A
git commit -m "Site RUSH 60"
git remote add origin https://github.com/TON-COMPTE/wow-forever-race.git
git push -u origin main
```

La branche doit s'appeler `main`.

### 2. Active GitHub Pages

Dans le dépôt : **Settings → Pages → Build and deployment → Source : GitHub Actions**.

### 3. Donne au dépôt une clé d'API Blizzard

1. Va sur <https://develop.battle.net/access/clients> et crée un client (« Create Client »). Le nom est libre. Blizzard peut demander que l'Authenticator soit activé sur ton compte.
2. Note le **Client ID** et le **Client Secret**.
3. Dans le dépôt : **Settings → Secrets and variables → Actions → New repository secret**, deux fois :
   - `BLIZZARD_CLIENT_ID`
   - `BLIZZARD_CLIENT_SECRET`

Ces deux valeurs restent dans les secrets de GitHub : elles ne sont jamais écrites dans le site.

### 4. Lance la première synchronisation

Onglet **Actions → Tracker → Run workflow**. Une à deux minutes plus tard, le site est en ligne à l'adresse `https://TON-COMPTE.github.io/wow-forever-race/`.

La toute première exécution, déclenchée par l'envoi des fichiers, échoue si Pages n'était pas encore activé : c'est normal, celle que tu viens de lancer la remplace.

### 5. Active la modification partagée

1. Ouvre le site et clique sur **Modifier la liste**, en haut de page. Tant que rien n'est activé, ce bouton ouvre l'activation (plus tard, tu la retrouves sous « Configuration », en bas de page).
2. Suis le lien **Créer le jeton sur GitHub**. Sur la page qui s'ouvre, dans « Repository access », choisis « Only select repositories » puis ton dépôt. La permission « Actions : Read and write » est déjà cochée. Crée le jeton et copie-le.
3. Colle le jeton dans le site et clique sur **Activer**.
4. Attends que la fenêtre affiche « C'est activé. » (une à deux minutes), puis copie le **lien de modification** et envoie-le à tes amis.

Toute personne qui ouvre ce lien peut ajouter ou retirer des personnages et lancer une synchronisation. Les autres visiteurs voient le site sans pouvoir le modifier.

## Au quotidien

- **Ajouter un personnage** : « Ajouter un personnage », puis ses deux noms, sa région et le prénom de la personne qui le joue. Le prénom est obligatoire, pour que tout le monde se reconnaisse. Tu peux aussi coller l'adresse de sa page d'armurerie. Il apparaît une à deux minutes plus tard.
- **Ajouter ou changer un prénom** : lien « modifier » à côté de « joué par… » sur la ligne du personnage, ou « Ajouter le prénom du joueur » s'il n'en a pas encore.
- **Retirer un personnage** : bouton « Retirer » sur sa ligne. Son historique est effacé.
- **Forcer une mise à jour** : menu → « Synchroniser maintenant ».
- **Sans passer par le site** : onglet Actions → Tracker → Run workflow, en choisissant `add` (avec le prénom du joueur) ou `remove`. Ou modifie `players.json` à la main.

## À savoir

- **Niveau 10 et déconnexion.** Blizzard ne publie un personnage qu'à partir du niveau 10, et seulement après qu'il s'est déconnecté. Avant cela il reste dans « En attente ». Exception : son niveau est lu dans la liste de sa guilde, même en dessous de 10, dès qu'un autre personnage suivi de cette guilde est publié, ou si tu indiques la guilde dans les réglages (`guilds`).
- **Fraîcheur.** Un personnage n'est mis à jour chez Blizzard que lorsqu'il se déconnecte. Pendant une session de jeu, le site garde donc le dernier état connu.
- **Retards.** GitHub lance les tâches planifiées avec du retard aux heures chargées, parfois beaucoup sur un dépôt récent. Si un détenteur du lien de modification ouvre le site alors que les données ont plus de 25 minutes, le site demande une synchronisation de lui-même.
- **Barres d'XP.** L'API donne l'XP du niveau en cours, pas le total à atteindre. Le site utilise la table d'XP de WoW Classic, que Forever semble avoir reprise. Vérifie en jeu : il faut 7 600 XP pour passer du niveau 10 au 11, et 47 400 du niveau 30 au 31. Si ce n'est pas le cas, désactive les barres (voir « Réglages »).
- **Trente jours.** Les conditions de l'API Blizzard interdisent de conserver des données qui ne sont plus rafraîchies. Un personnage introuvable depuis 30 jours voit donc ses données effacées. Les données générées sont stockées sur une branche `data` réécrite à chaque synchronisation, sans historique.
- **Deux mois sans activité.** GitHub désactive les tâches planifiées d'un dépôt public resté 60 jours sans activité. Le site le signale aux détenteurs du lien de modification et propose de les réactiver ; tu peux aussi le faire dans l'onglet Actions.

## Réglages

Dans `players.json`, rubrique `settings` :

| Réglage | Effet |
| --- | --- |
| `title` | Titre affiché en haut du site. |
| `goalLevel` | Niveau visé (60 par défaut). |
| `guilds` | Guildes supplémentaires à lire pour les personnages sous le niveau 10, par exemple `[{ "region": "eu", "slug": "les-copains" }]`. Le `slug` est le nom de la guilde en minuscules, les espaces remplacés par des tirets. |
| `xpTable` | `false` pour masquer les barres d'XP, ou une liste de 59 nombres pour remplacer la table. |

## Essayer sur ton ordinateur

Il faut Node.js 20 ou plus récent. Aucune installation de dépendance.

```bash
npm run dev
```

Ouvre ensuite <http://localhost:4173>. C'est une démonstration complète avec des personnages fictifs qui progressent tout seuls, sans clé Blizzard ni connexion à GitHub. Pour essayer l'ajout et le retrait, clique sur « Modifier la liste » : n'importe quel mot fait office de jeton.

```bash
npm test
```

## Sécurité

- Le jeton GitHub du lien de modification est limité à ce dépôt et à la permission « Actions ». Il permet de lancer la tâche du site, pas de modifier le code ni de lire tes secrets.
- Il est stocké chiffré dans `site/edit.json`. La clé de déchiffrement n'existe que dans le lien que tu partages.
- Ne donne le lien qu'à des personnes de confiance : avec lui, on peut aussi remplacer le lien de modification lui-même, ce qui invalide celui des autres.
- Pour couper l'accès : supprime le jeton dans **GitHub → Settings → Developer settings → Personal access tokens**. Pour le renouveler, repasse par « Configuration ».
- Le jeton expire au bout de 90 jours par défaut. Le site prévient alors que le lien a expiré.

## En cas de souci

| Ce que tu vois | Ce qu'il faut faire |
| --- | --- |
| « L'API Blizzard n'est pas encore configurée » | Ajoute les deux secrets de l'étape 3, puis relance la tâche. |
| « Blizzard a refusé les identifiants de l'API » | Un des deux secrets est faux : recrée-les. |
| Un personnage reste « En attente » | Vérifie l'orthographe des deux noms et la région. Il doit être niveau 10 et s'être déconnecté une fois. |
| La tâche échoue à l'étape « Préparer Pages » ou « Publier » | Pages n'est pas réglé sur « GitHub Actions » (étape 2). |
| La tâche échoue à l'étape « Modifier la liste des personnages » ou « Enregistrer les données » | Une protection de branche empêche la tâche d'écrire : retire-la sur `main` et `data`. |
| « Le lien de modification a expiré » | Le jeton a expiré ou a été supprimé : refais l'étape 5 en passant par « Configuration », en bas de page. |
| Plus aucune mise à jour | Regarde l'onglet Actions : la tâche a pu être désactivée après 60 jours sans activité. |

## Comment c'est fait

| Élément | Rôle |
| --- | --- |
| `players.json` | La liste des personnages suivis et les réglages. |
| `.github/workflows/tracker.yml` | La tâche : applique un ajout ou un retrait, interroge Blizzard, enregistre les données, publie le site. Une seule exécution à la fois. |
| `scripts/roster.mjs` | Applique un ajout ou un retrait à `players.json`. |
| `scripts/sync.mjs` | Interroge l'API Blizzard et écrit `site/data/`. |
| `scripts/dev-server.mjs` | La démonstration locale, avec de fausses API Blizzard et GitHub. |
| `site/` | Le site publié. Aucune dépendance, aucun outil de construction. |
| branche `data` | Les données générées, en un seul commit réécrit à chaque fois. |

Ce projet n'est pas affilié à Blizzard Entertainment. World of Warcraft est une marque de Blizzard Entertainment, Inc.
