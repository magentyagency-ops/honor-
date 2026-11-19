# Saint-Honoré — démo « achats, stocks, ventes, factures »

Application de démonstration pour le rendez-vous avec Antoine : une plateforme qui centralise, pour ses trois établissements au Panama, les commandes fournisseurs, les réceptions, les stocks, les ventes des caisses et les factures à payer.

**Tout est fictif et simulé.** Aucun compte, aucune clé API, aucun envoi WhatsApp, aucun paiement. L'interface est en espagnol par défaut (équipes au Panama) et se bascule en **français** ou en **anglais** via le bouton de langue (globe) en haut à droite ; le choix est mémorisé. Montants en USD, les dates en jour/mois/année, à l'heure du Panama quel que soit le fuseau de l'ordinateur.

## Lancer la démo

```bash
npm install      # une seule fois
npm run dev      # puis ouvrir http://localhost:5180
```

Le port est 5180 (le 5173 habituel de Vite est déjà pris par un autre projet sur cette machine). S'il est occupé, Vite en choisit un autre et l'affiche dans le terminal.

| Commande | Rôle |
|---|---|
| `npm run dev` | Lance la démo |
| `npm test` | 27 tests des règles métier |
| `npm run build` puis `npm run preview` | Version de production, servie sur le port 4180 |

Fonctionne hors ligne une fois installé : les polices sont embarquées.

## Avant le rendez-vous

1. Ouvrir la démo, menu du profil (en haut à droite) → **Reiniciar demostración**. Les données repartent de l'état initial, calé sur l'heure qu'il est au Panama.
2. Passer le navigateur en plein écran. L'écran est pensé pour 1280 px de large ou plus.
3. Les données sont régénérées automatiquement chaque jour (heure du Panama) pour que « aujourd'hui », les retards et les échéances restent justes. Une préparation faite la veille n'est donc pas conservée : refaire les manipulations le jour même.

## Le parcours guidé (5 à 7 minutes)

En bas du menu de gauche : **Recorrido de demostración**. Un panneau sombre apparaît en bas de l'écran : c'est la télécommande.

- Le **bouton doré** fait avancer. S'il porte le nom d'une action (« Preparar pedido », « Simular envío »…), il l'exécute réellement dans l'application puis montre le résultat.
- Flèches `→` et `←` du clavier pour avancer et reculer.
- Les 12 segments de la barre de progression sont cliquables : on peut sauter directement à une étape, les actions manquantes sont rejouées en silence.
- Vous pouvez aussi cliquer vous-même sur le vrai bouton de l'interface (celui qui est entouré) : le parcours le détecte et continue.
- Le cadre doré montre où regarder. Le texte du panneau donne les chiffres du moment, calculés en direct.

| # | Étape | Ce qu'il faut faire passer |
|---|---|---|
| 1 | Antoine repère le risque de rupture de lait à San Francisco | Le tableau de bord met l'urgent devant, avec le bouton pour agir. |
| 2 | Il ouvre la suggestion de réapprovisionnement | La quantité proposée vient de la consommation réelle, pas d'une intuition. |
| 3 | Il ajuste puis valide la commande | La plateforme propose, lui décide. Règle d'approbation au-delà de 500 $. |
| 4 | Message WhatsApp préparé, envoi simulé | Plus rien à taper : établissement, référence, articles, quantités, date. |
| 5 | Le gérant enregistre une réception partielle | Bouton **Verlo en su móvil** : la même saisie sur le téléphone du gérant. |
| 6 | Le stock augmente de la quantité reçue | **Seule la réception augmente le stock.** Ni la commande ni la facture. |
| 7 | La caisse synchronise ses ventes | Les tickets déjà importés sont reconnus et ignorés : pas de double comptage. |
| 8 | Café et lait décomptés selon les recettes | 1 cappuccino = 18 g de café + 150 ml de lait, dans le bon établissement. |
| 9 | Une facture arrive par WhatsApp et est traitée | Document à gauche, champs extraits à droite, champ douteux signalé. |
| 10 | Écart entre facturé et reçu | Sans ce rapprochement, la facture aurait été payée en entier. |
| 11 | Antoine vérifie la facture et son échéance | Correction tracée, échéance proposée puis confirmée, validation motivée. |
| 12 | Un règlement partiel réduit le solde | Il paie ce qui est arrivé ; le solde reste visible avec son échéance. |

Pour rejouer le parcours : bouton **Repetir desde el principio** à la fin, ou relancer le parcours (il propose de réinitialiser).

### À montrer ensuite, selon ses questions

- **« Et mes managers ? »** Icône téléphone en haut à droite : l'application telle que la voit le gérant de San Francisco. Ce qu'il fait dans le téléphone apparaît aussitôt à l'écran.
- **« Qui voit quoi ? »** Menu du profil → *Ver la plataforma como* : Antoine (direction), Luis (gérant, limité à son établissement), Rosa (comptabilité).
- **« Combien je dois, à qui, quand ? »** *Facturas y pagos → Pagos a proveedores* : en retard, cette semaine, plus tard, déjà payé ; calendrier ; vue par fournisseur ; **Exportar CSV**.
- **« Et si je reçois deux fois la même facture ? »** *Facturas → Simular llegada por WhatsApp → Reenvío de una factura existente* : alerte de doublon, rien n'est supprimé automatiquement.
- **« Et si ma caisse n'a pas d'API ? »** *Integraciones → Probar la importación de archivos* : importer le fichier d'exemple deux fois, la seconde ne duplique rien.
- **Un article de caisse sans recette** : *Ventas y cajas → Artículos y recetas*. La limonade est vendue mais ne décompte rien ; lui associer une recette régularise les ventes passées.
- **Vendre 10 cappuccinos devant lui** : *Ventas y cajas → Simular una venta*, puis *Sincronizar* : 180 g de café et 1,5 L de lait en moins, dans cet établissement seulement.
- **Comptage physique, pertes, transferts** : boutons en haut de *Inventario*.
- **Traçabilité** : *Registro de actividad* (bas du menu de gauche).

## Hypothèses retenues

- **Marque.** Saint-Honoré. Le logo est un tracé vectoriel fidèle du fichier fourni (`Logo-SaintHonore-solid-01.png.webp`), pas une recréation.
- **Établissements, personnes, fournisseurs, prix, recettes** : fictifs. Casco Viejo, San Francisco, Costa del Este ; 6 fournisseurs, 25 produits, 8 recettes.
- **Volume de données.** 30 jours simulés à partir d'aujourd'hui. Le brief évoquait une douzaine de commandes et une quinzaine de factures ; la démo en contient environ 95 de chaque, parce que ventes, consommations, stocks, achats et dettes sortent du même moteur : ≈ 130 000 $ de ventes pour ≈ 27 000 $ d'achats, soit un coût matière de l'ordre de 21 %. Avec quinze factures, les totaux n'auraient pas tenu debout. Les vues s'ouvrent par défaut sur ce qui demande une action (6 commandes en cours, 4 documents à traiter).
- **Statut ajouté.** Entre « Pendiente de aprobación » et « Enviado », un statut **« Aprobado · por enviar »** : sans lui, une commande approuvée mais pas encore envoyée n'avait pas d'état.
- **Règle d'approbation** : au-delà de 500 $ par commande, celle d'un gérant attend l'accord d'Antoine. Modifiable dans *Compras*.
- **Taxe.** ITBMS de 7 % sur emballages et produits d'entretien, denrées alimentaires exonérées. À valider avec son comptable.
- **Stock.** Théorique, calculé comme la somme des mouvements. Valorisé au dernier prix d'achat. Les produits hors recettes (emballages, entretien) ne bougent qu'aux comptages.
- **Échéances.** Si la facture ne porte pas de date d'échéance, elle est proposée d'après les conditions du fournisseur et doit être confirmée.
- **Rôles.** Simulation d'autorisations pour la démonstration, pas une authentification.

## Ce qui est simulé, et ce qu'il faudra pour le brancher

| Intégration | Dans la démo | Pour la version réelle |
|---|---|---|
| **WhatsApp** | Le message de commande est composé et affiché ; « Simular envío » l'enregistre et produit une réponse fictive du fournisseur. Rien ne sort. | WhatsApp Business Platform avec un numéro de l'entreprise, des modèles de message approuvés, l'accord des fournisseurs. **Cette connexion ne donne pas accès aux conversations personnelles d'Antoine ni à ses groupes actuels** : seulement aux messages du numéro d'entreprise. |
| **Caisses** | Tickets fictifs, déterministes, avec identifiants stables. | Identifier le logiciel de caisse de chaque établissement, puis, par ordre de préférence : 1) API ou connecteur officiel ; 2) import de fichiers exportés ; 3) connecteur navigateur, en dernier recours car fragile. **Aucune compatibilité n'est affirmée.** |
| **Lecture de factures** | Les documents d'exemple portent leur contenu ; l'« extraction » le restitue avec des doutes plausibles. Un fichier personnel n'est jamais « lu » : saisie manuelle. | Un service d'extraction de documents renvoyant un niveau de confiance par champ ; volumes, formats, durée de conservation. |

À confirmer avec lui avant tout chiffrage : fournisseur de caisse et accès, modalités WhatsApp Business, accès autorisé aux messages et documents, catalogue initial, recettes et unités, stock de départ (un inventaire initial par établissement : l'historique d'achats ne suffit pas).

## Comment c'est construit

```
src/
  domain/        Règles métier pures, sans interface : commandes, réceptions, stock, ventes, factures, paiements
  data/          Catalogue fictif, générateur des 30 jours, documents d'exemple
  adapters/      Interfaces WhatsApp, caisse et extraction, avec leur version simulée
  store/         État, persistance locale, synchronisation entre onglets
  features/      Un dossier par écran
  tour/          Parcours guidé
  ui/, layout/   Composants et structure
```

Règles garanties et testées (`npm test`) :

- Une réception partielle ajoute exactement la quantité reçue, dans le bon établissement.
- Commander, approuver, envoyer ou facturer ne modifie jamais le stock.
- Un ticket de caisse n'est importé et décompté qu'une fois ; un même fichier n'est importé qu'une fois.
- Une recette décompte les bonnes quantités ; un article sans recette ne décompte rien.
- Un paiement partiel recalcule solde et statut ; annuler un paiement aussi.
- Les filtres d'établissement et de période modifient réellement les chiffres, et la somme des établissements redonne le total.

Les trois intégrations passent par des interfaces (`WhatsAppGateway`, `PosConnector`, `DocumentExtractor`) : la version réelle remplace la version simulée sans toucher aux règles métier.

## Limites connues

- Traduction FR/EN : les factures papier des fournisseurs et les messages WhatsApp aux fournisseurs restent volontairement en espagnol (c'est leur langue réelle au Panama), de même que les codes de caisse et les adresses. Le changement de langue se fait panneau latéral fermé.

- Les données vivent dans le navigateur (stockage local). Changer de navigateur ou vider ses données repart de l'état initial.
- Les champs de date utilisent le sélecteur du navigateur : il affiche jour/mois/année sur un navigateur réglé en français ou en espagnol, mois/jour/année sur un navigateur en anglais américain. Les dates affichées ailleurs sont toujours en jour/mois/année.
- Pas d'aperçu pour un PDF importé (les images, oui).
- Le journal d'activité détaillé couvre les six derniers jours ; chaque document garde sa propre trace.
