# Brief technique — NE26 Rooms (fork Cal.diy)

> Document de cadrage pour développement avec Claude Code.
> Déposer à la racine du repo forké. Versionner avec git.
> **Auteur du besoin : Tim Leskens / VO Group SA — NATO Edge 26.**

---

## 1. Contexte & objectif

Construire une plateforme de **réservation et vente de créneaux de salles de réunion** pour l'événement NATO Edge 26 (NE26), basée sur un fork de **Cal.diy** (fork MIT de Cal.com, sans code Enterprise).

**La plateforme doit être commercialisable immédiatement** : on vend des slots dès maintenant (vente anticipée en ligne) et pendant l'événement (URL diffusée + tablette gérée par une hôtesse). Il y a du **vrai argent encaissé via Stripe dès la V1** — la fiabilité de l'anti-double-booking et du paiement n'est pas négociable.

### Le problème central à résoudre
Cal.com/Cal.diy raisonne **« utilisateur = un agenda »**. Deux event types sous le même utilisateur se bloquent mutuellement sur un même créneau (comportement prouvé, issue GitHub calcom #21467, toujours ouverte en juin 2026). Or NE26 a **9 salles qui doivent être réservables EN PARALLÈLE** sur le même créneau. Il faut donc introduire un modèle **« ressource »** où chaque salle a sa propre disponibilité indépendante.

---

## 2. Inventaire métier (les 9 ressources)

| Ressource | Type | Capacité | Catégorie tarifaire |
|---|---|---|---|
| Suite 1 | Suite | 12 (table) + 12 (lounge) | Premium |
| Suite 2 | Suite | 12 (table) + 12 (lounge) | Premium |
| Grande salle 1 | Grande | 12 | Intermédiaire |
| Grande salle 2 | Grande | 12 | Intermédiaire |
| Petite salle 1 | Petite | 6 | Entrée |
| Petite salle 2 | Petite | 6 | Entrée |
| Petite salle 3 | Petite | 6 | Entrée |
| Petite salle 4 | Petite | 6 | Entrée |
| Petite salle 5 | Petite | 6 | Entrée |

### Règles de réservation
- **Dates de l'événement** : mardi 17, mercredi 18, jeudi 19 novembre 2026.
- **Plages horaires** :
  - Mardi 17 : 14:00 – 17:00
  - Mercredi 18 : 09:00 – 17:00
  - Jeudi 19 : 09:00 – 11:00
- **Durées sélectionnables** : 1h / 2h / 3h (prix proportionnel à la durée).
- **Tarif** : différencié par catégorie (Premium / Intermédiaire / Entrée). Montants non encore figés (placeholder configurable). Tarif horaire × durée.
- **Anti-double-booking** : une salle réservée sur un créneau est indisponible POUR CETTE SALLE UNIQUEMENT. Les 8 autres restent libres sur le même créneau.
- **Fuseau** : Europe/Brussels.

---

## 3. Décisions produit (validées)

| Sujet | Décision |
|---|---|
| Base de code | Fork **Cal.diy** (MIT) — modifiable et privé |
| Hébergement | VPS Infomaniak existant (2 vCPU / 4 Go RAM / 60 Go), Docker + Nginx + SSL déjà en place, sous-domaine `rooms.vo-eu.be` |
| Canaux de vente | En ligne uniquement (web). Vente sur place = même app via URL/tablette, PAS de mode POS séparé |
| Compte acheteur | **Oui** — l'exposant crée un compte / se connecte (auth Cal.diy native réutilisée) |
| Paiement | **Stripe**, compte unique VO. Une seule connexion mutualisée pour toutes les salles |
| Facturation | **1 facture/reçu PDF auto par réservation** |
| Langue | Interface en anglais (exposants internationaux). FR/NL en bonus plus tard |

---

## 4. Architecture cible

### 4.1 Principe directeur : NE PAS réécrire le moteur de disponibilité

Le moteur `getAvailableSlots` / `getUserAvailability` de Cal.com est la pièce la plus complexe et la plus risquée à modifier. **Stratégie recommandée : ne pas le réécrire en profondeur**, mais l'envelopper.

Deux couches de garantie :

**Couche 1 — Affichage (filtrage)** : réutiliser le moteur Cal existant en associant chaque salle à un « owner » technique (un user interne par salle, créé en base directement, pas via le panneau admin EE). Le moteur calcule alors la dispo par salle nativement. C'est l'approche pragmatique qui exploite l'existant.

**Couche 2 — Intégrité (la vraie garantie anti-collision)** : une **contrainte d'unicité en base de données** qui rend physiquement impossible deux réservations confirmées sur le même `(resourceId, startTime)`. C'est CETTE couche qui protège l'argent, pas l'affichage.

> ⚠️ Règle d'or : l'affichage peut mentir (race condition entre deux onglets), la base de données ne ment jamais. La contrainte DB est le filet de sécurité ultime.

### 4.2 Modèle de données (Prisma)

Ajouter au `schema.prisma` (ne pas casser les tables existantes) :

```prisma
model Resource {
  id            Int       @id @default(autoincrement())
  name          String                      // "Suite 1"
  slug          String    @unique            // "suite-1"
  category      ResourceCategory             // PREMIUM | INTERMEDIATE | ENTRY
  capacity      Int
  hourlyPrice   Int                          // en centimes (ex: 10000 = 100€)
  currency      String    @default("EUR")
  description   String?
  isActive      Boolean   @default(true)
  ownerUserId   Int?                         // user technique lié (couche 1)
  bookings      ResourceBooking[]
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
}

enum ResourceCategory {
  PREMIUM
  INTERMEDIATE
  ENTRY
}

model ResourceBooking {
  id              Int       @id @default(autoincrement())
  resourceId      Int
  resource        Resource  @relation(fields: [resourceId], references: [id])
  startTime       DateTime
  endTime         DateTime
  durationMinutes Int                          // 60 | 120 | 180
  bookerUserId    Int                          // l'exposant (compte)
  bookerEmail     String
  bookerName      String
  status          BookingStatus @default(PENDING)
  amountPaid      Int                          // centimes
  currency        String    @default("EUR")
  stripePaymentId String?
  invoiceNumber   String?   @unique
  invoicePdfUrl   String?
  createdAt       DateTime  @default(now())

  // ⭐ LA GARANTIE ANTI-DOUBLE-BOOKING :
  @@unique([resourceId, startTime], name: "no_double_booking")
}

enum BookingStatus {
  PENDING       // créée, paiement en attente
  CONFIRMED     // payée
  CANCELLED
}
```

> La contrainte `@@unique([resourceId, startTime])` est le cœur. Même si deux requêtes arrivent à la même milliseconde, la base en rejette une. À gérer proprement côté code (catch de l'erreur d'unicité → message « créneau déjà pris »).
>
> ⚠️ Nuance à traiter : un créneau 9h-12h (3h) et un créneau 10h-11h (1h) se chevauchent SANS avoir le même `startTime`. La contrainte `startTime` seule ne suffit pas pour des durées variables qui se chevauchent. **Voir section 4.3.**

### 4.3 Gestion du chevauchement de durées variables

Comme on autorise 1h/2h/3h, deux réservations peuvent se chevaucher sans partager `startTime`. Deux options :

**Option A (recommandée pour fiabilité) — Slots atomiques d'1h.**
Découper la journée en créneaux atomiques d'1 heure. Une réservation de 3h = 3 slots atomiques consécutifs réservés. La contrainte d'unicité porte alors sur chaque slot atomique `(resourceId, slotStart)`. Réserver 9h-12h pose 3 lignes (9h, 10h, 11h) ; si l'une est déjà prise, l'insert transactionnel échoue → tout est annulé (transaction atomique). C'est robuste et simple à raisonner.

**Option B — Vérification de chevauchement applicative + verrou transactionnel.**
Une requête `SELECT ... FOR UPDATE` dans une transaction qui vérifie l'absence de chevauchement `(start < existingEnd AND end > existingStart)` avant insert. Plus souple mais plus délicat à rendre concurrent-safe.

> **Recommandation : Option A** pour la V1. Plus facile à garantir correcte, et le découpage horaire colle au modèle de vente (slots d'1h).

### 4.3bis Add-ons (catering, AV, boissons) — vendus AVEC le slot

Un add-on est un **produit optionnel attaché à une réservation**, payé dans la même transaction Stripe et figurant sur la même facture. Relation many-to-many entre `ResourceBooking` et un catalogue `AddOn`. **Inclus dès la V1.**

```prisma
model AddOn {
  id            Int            @id @default(autoincrement())
  name          String                       // "Catering - Lunch", "Écran AV"
  slug          String         @unique
  description   String?
  price         Int                           // centimes
  currency      String         @default("EUR")
  priceType     AddOnPriceType                // FLAT | PER_PERSON | PER_HOUR
  vatRate       Int            @default(2100) // taux TVA en points de base (2100 = 21%)
  isActive      Boolean        @default(true)
  // V2 : restriction par catégorie de salle (ex: catering réservé aux suites)
  // restrictedToCategories ResourceCategory[]
  bookingAddOns BookingAddOn[]
}

enum AddOnPriceType {
  FLAT          // forfait fixe (ex: 1 écran = 50€)
  PER_PERSON    // × nombre de couverts (catering)
  PER_HOUR      // × durée du slot
}

model BookingAddOn {
  id         Int             @id @default(autoincrement())
  bookingId  Int
  booking    ResourceBooking @relation(fields: [bookingId], references: [id])
  addOnId    Int
  addOn      AddOn           @relation(fields: [addOnId], references: [id])
  quantity   Int             @default(1)      // ex: nombre de personnes (catering)
  unitPrice  Int                              // prix figé au moment de la résa (centimes)
  lineTotal  Int                              // quantity × unitPrice
}
```

> Ajouter `bookingAddOns BookingAddOn[]` au modèle `ResourceBooking`.

**Points d'attention add-ons :**

1. **Montant total** = `(hourlyPrice × durée) + Σ(lineTotal des add-ons)`. Le Payment Intent Stripe doit refléter ce total, pas seulement le slot.
2. **`priceType` est crucial pour le catering** : un lunch se facture souvent **par personne** → l'acheteur saisit le nombre de couverts (`quantity`). Un écran AV = `FLAT`. Un service boissons peut être `PER_HOUR`. Les trois modes sont prévus dès la V1.
3. **TVA potentiellement différente par add-on** : en Belgique, la restauration/catering a souvent un taux de TVA distinct de la location de salle. D'où le champ `vatRate` par add-on. À confirmer avec la compta VO. La facture doit ventiler la TVA par ligne si les taux diffèrent.
4. **Logistique Foodport (≠ paiement)** : le système encaisse le catering, mais la commande doit remonter à l'équipe/au traiteur. **V1** : les add-ons commandés apparaissent dans le dashboard admin + export, l'équipe transmet manuellement à Foodport. **V2/V3** : intégration automatique Foodport. Confirmer le process de notification interne.
5. **Prix figé à la réservation** : `unitPrice` est copié au moment de la commande (ne pas référencer le prix live de l'AddOn, qui peut changer).

### 4.4 Stripe — connexion unique mutualisée

- Un seul compte Stripe VO. Configuration au niveau **instance** (variables `.env`), pas par salle.
- Flux : réservation créée en `PENDING` → Stripe Checkout/Payment Intent → webhook `payment_intent.succeeded` → passage en `CONFIRMED` + génération facture PDF.
- ⚠️ Le créneau ne doit être considéré comme bloqué définitivement qu'après confirmation de paiement, MAIS il faut un verrou temporaire (hold) pendant le paiement pour éviter qu'un autre le prenne. Prévoir un statut `PENDING` avec expiration (ex. 15 min) : si le paiement n'aboutit pas, le hold est libéré.
- Réutiliser l'intégration Stripe existante de Cal.diy (app store) comme point de départ, mais brancher sur le modèle `ResourceBooking`.

### 4.5 Facturation PDF

- Génération automatique à la confirmation de paiement.
- Numérotation séquentielle (`invoiceNumber` unique, format à définir, ex. `NE26-2026-0001`).
- **Ventilation des lignes** : ligne salle (tarif × durée) + une ligne par add-on (quantité × prix unitaire), avec sous-total HT, TVA (par taux si add-ons à taux différent), et total TTC.
- Mentions légales VO Group SA + TVA (cohérence avec config TVA NE26 : BE 21%, reverse charge UE, exempt hors-UE — à confirmer si applicable aux locations de salles ET au catering, qui peut avoir un taux distinct).
- Stockage du PDF (volume Docker ou stockage objet) + lien dans `invoicePdfUrl`.
- Envoi par email à l'exposant (SMTP Infomaniak — déjà prévu dans la config).

---

## 5. Découpage en phases

### Phase 0 — Mise en place (infra déjà prête)
- [ ] Fork Cal.diy sur le compte GitHub VO (repo privé).
- [ ] Clone en local pour dev avec Claude Code.
- [ ] Build local fonctionnel (`yarn`, `.env`, Postgres local).
- [ ] Sur le VPS : remplacer l'image Docker pré-buildée Cal.com par un build du fork. **Conserver** Nginx, SSL, `rooms.vo-eu.be`, le Postgres existant.

### Phase 1 — Modèle ressource + add-ons (cœur, NON vendable encore)
- [ ] Migration Prisma : tables `Resource`, `ResourceBooking`, `AddOn`, `BookingAddOn`, enums.
- [ ] Seed des 9 salles avec catégories/capacités/prix placeholder.
- [ ] Seed du catalogue d'add-ons (catering, AV…) avec leurs `priceType` et `vatRate`.
- [ ] Logique de slots atomiques 1h + contrainte anti-collision (section 4.3 option A).
- [ ] Tests concurrents : simuler 2 réservations simultanées sur le même slot → 1 seule passe.

### Phase 2 — Réservation + add-ons + affichage (V1 démontrable)
- [ ] Page publique par salle : `rooms.vo-eu.be/rooms/suite-1` (calendrier borné 17-19 nov, plages réelles, durées 1/2/3h).
- [ ] Sélection d'add-ons dans le flux de réservation (avec quantité pour le catering par personne).
- [ ] Calcul du total en direct : (salle × durée) + add-ons.
- [ ] Paramètre `?month=2026-11` ou ouverture forcée sur novembre (le calendrier Cal natif ouvre sur le mois courant sinon — workaround connu).
- [ ] Auth exposant (compte / login — réutiliser l'auth Cal.diy).
- [ ] Création de réservation en `PENDING` avec hold temporaire (slot + add-ons figés).

### Phase 3 — Paiement Stripe (V1 VENDABLE) ⭐
- [ ] Connexion Stripe compte VO unique (`.env`).
- [ ] Payment Intent sur le **montant total** (salle + add-ons).
- [ ] Flux Checkout → webhook → `CONFIRMED`.
- [ ] Gestion du hold/expiration.
- [ ] Tests de bout en bout avec cartes test Stripe.
- [ ] **Tests de race condition avec paiement réel (mode test) : le créneau se verrouille-t-il correctement ?**

### Phase 4 — Facturation PDF
- [ ] Génération PDF auto à la confirmation, avec ventilation salle + add-ons.
- [ ] Numérotation séquentielle + mentions légales VO + TVA par ligne.
- [ ] Email automatique avec PDF joint.

### Phase 5 — Admin & exploitation
- [ ] Dashboard admin unique : voir toutes les réservations des 9 salles + add-ons commandés.
- [ ] Export (CSV) des réservations ET des commandes catering/add-ons (pour transmission à Foodport).
- [ ] Page récap « réservez votre salle » listant les 9 salles (pour diffusion + tablette hôtesse).
- [ ] Durcissement sécurité (la plateforme encaisse de l'argent).

---

## 6. Pièges connus / points de vigilance

1. **Le calendrier ouvre sur le mois courant**, pas sur novembre (comportement Cal.com, issue connue). Forcer via `?month=2026-11` ou modifier le composant de calendrier pour ouvrir sur la première date disponible.
2. **`CALENDSO_ENCRYPTION_KEY` doit faire exactement 32 caractères** (utiliser `openssl rand -hex 16`). Une clé base64 de 44 caractères provoque `ERR_CRYPTO_INVALID_KEYLEN` (déjà rencontré et corrigé sur l'instance actuelle).
3. **Build lourd** : ne pas builder sur le VPS 4 Go sans surveillance (risque OOM). Builder en local/CI, déployer l'image. Le swap de 2 Go ajouté aide mais ne suffit pas pour un gros build.
4. **Race condition de paiement** : ne jamais marquer un créneau définitivement pris avant confirmation Stripe, mais poser un hold temporaire pendant le paiement. Sinon soit double-booking, soit créneaux fantômes bloqués.
5. **AGPL vs MIT** : Cal.diy est MIT (modifs privées OK). Ne PAS réintroduire de code venant du répertoire `/ee/` de Cal.com (AGPL/commercial) — rester sur la base MIT propre.
6. **Migrations Prisma** : toujours tester les migrations sur une copie avant la prod. Les réservations = de l'argent, pas de perte de données tolérée. Backup `pg_dump` avant chaque migration en prod.
7. **Fuseau horaire** : tout stocker en UTC en base, afficher en Europe/Brussels. Erreur classique sur les events à date fixe.

---

## 7. Fichiers Cal.com / Cal.diy probablement concernés

> À confirmer par exploration du repo avec Claude Code (le codebase évolue).

- `packages/prisma/schema.prisma` — modèle de données.
- `packages/lib/getUserAvailability.ts` / `packages/core/getAvailableSlots` — moteur de dispo (à envelopper, pas réécrire).
- `packages/features/bookings/` — logique de réservation.
- `packages/app-store/stripepayment/` — intégration Stripe existante (point de départ).
- `apps/web/` — pages publiques de réservation.
- Schéma de tarification : voir comment les `EventType` portent un prix via l'app Stripe.

---

## 8. Définition de « V1 vendable »

La V1 est commercialisable quand TOUS ces points sont vrais :
1. Un exposant peut, depuis son mobile, choisir une salle, un créneau (1/2/3h) sur les 17-19 nov, **ajouter des add-ons (catering, AV…)**, et payer le total par carte.
2. Deux exposants ne peuvent JAMAIS payer le même créneau de la même salle (testé sous concurrence).
3. Les 9 salles sont réservables en parallèle (réserver Suite 1 ne bloque pas Suite 2).
4. Le paiement (salle + add-ons) crédite le compte VO unique.
5. Une facture PDF ventilée (salle + add-ons + TVA) est générée et envoyée automatiquement.
6. L'équipe peut voir toutes les réservations et commandes d'add-ons dans un dashboard unique.

Tant que le point 2 n'est pas prouvé par un test de concurrence, **ne pas ouvrir la vente au public**.

---

## 9. CLAUDE.md de cadrage (à placer aussi à la racine)

Voir fichier séparé `CLAUDE.md`.
