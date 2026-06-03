# CLAUDE.md — NE26 Rooms

Cadrage pour le développement assisté. Lire `BRIEF_TECHNIQUE_NE26_ROOMS.md` en complément.

## Nature du projet
Fork de **Cal.diy** (MIT) transformant un planificateur « agenda-personne » en plateforme de **réservation + vente de salles de réunion** (modèle « ressource »). Pour NATO Edge 26. **Encaisse du vrai argent via Stripe dès la V1.**

## Règles de discipline (strictes)

1. **Périmètre confiné.** Le code custom vit dans des emplacements dédiés et identifiables :
   - Nouveau code métier sous `packages/features/ne26-rooms/` (ou équivalent à définir).
   - Modèles ajoutés au `schema.prisma` clairement commentés `// NE26`.
   - Ne PAS modifier le moteur de disponibilité Cal en profondeur — l'envelopper.

2. **Confirmation avant action destructive.** Toute migration Prisma sur la prod, toute suppression, tout `docker compose down -v` (qui détruit les volumes) doit être confirmé explicitement. Les réservations = de l'argent.

3. **Pas de code `/ee/`.** Rester sur la base MIT. Ne pas réintroduire de fonctionnalités Enterprise (Teams, Orgs, Routing Forms) — elles ne résolvent pas le besoin et alourdissent la licence.

4. **L'anti-double-booking est sacré.** Toute logique touchant à la réservation doit préserver la contrainte d'unicité en base. Aucune réservation payée en double sur un même créneau/salle, jamais. Tester sous concurrence avant de considérer une étape terminée.

5. **Étapes validées une par une.** Avancer par étapes claires, avec un point de validation entre chacune (build OK, test OK) avant de passer à la suivante. Pas de gros commits fourre-tout.

6. **UTC en base, Europe/Brussels à l'affichage.**

7. **Secrets.** `CALENDSO_ENCRYPTION_KEY` = exactement 32 caractères (`openssl rand -hex 16`). Jamais de secret commité dans git. `.env` hors versioning.

## Infra de référence
- VPS Infomaniak : 2 vCPU / 4 Go / 60 Go. Build lourd → builder hors VPS.
- `rooms.vo-eu.be` (Nginx reverse proxy + Let's Encrypt déjà configurés).
- Postgres en conteneur, volume persistant `calcom-pgdata`.
- Service voisin `vo-watermark.service` (pipeline C2PA) — ne pas perturber.

## Définition de terminé pour la V1
Voir section 8 du brief. En résumé : vente mobile fonctionnelle + anti-collision prouvée sous concurrence + 9 salles parallèles + paiement compte VO + facture PDF auto + dashboard admin unique.
