import {
  Calendar,
  CalendarCheck,
  DollarSign,
  Package,
  Scissors,
  Settings,
  UserCircle2,
  Users,
} from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';

// ---------------------------------------------------------------------------
// In-app documentation content.
//
// The long-form help content lives here as bilingual DATA (not in
// messages/*.json — paragraphs of prose would bloat the i18n parity test).
// Only the UI chrome (page title, search box, empty states) goes through
// next-intl. Each feature grows its `articles` list as we audit + ship it;
// the Calendar is fully documented, the others carry an accurate overview
// until their own review lands.
//
// `resolveDocs(locale)` flattens the bilingual tree to plain strings + a
// precomputed lowercase `search` blob per article for the in-browser search.
// ---------------------------------------------------------------------------

export type DocLocale = 'fr' | 'en';
type Loc = { fr: string; en: string };

type RawBlock =
  | { kind: 'p'; text: Loc }
  | { kind: 'list'; items: Loc[] }
  | { kind: 'steps'; items: Loc[] }
  | { kind: 'note'; tone: 'info' | 'warn'; text: Loc };

type RawArticle = { id: string; title: Loc; blocks: RawBlock[] };
type RawFeature = {
  id: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: Loc;
  summary: Loc;
  articles: RawArticle[];
};

export type DocBlock =
  | { kind: 'p'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'steps'; items: string[] }
  | { kind: 'note'; tone: 'info' | 'warn'; text: string };

export type DocArticle = { id: string; title: string; blocks: DocBlock[]; search: string };
export type DocFeature = {
  id: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
  summary: string;
  articles: DocArticle[];
};

const FEATURES: RawFeature[] = [
  // =========================================================================
  // CALENDAR — fully documented.
  // =========================================================================
  {
    id: 'calendar',
    icon: Calendar,
    title: { fr: 'Calendrier', en: 'Calendar' },
    summary: {
      fr: 'Voir, créer et gérer les rendez-vous du salon.',
      en: 'View, create and manage the shop’s appointments.',
    },
    articles: [
      {
        id: 'views',
        title: { fr: 'Les trois vues', en: 'The three views' },
        blocks: [
          {
            kind: 'p',
            text: {
              fr: 'Le calendrier propose trois vues, à sélectionner en haut à gauche.',
              en: 'The calendar offers three views, selectable at the top left.',
            },
          },
          {
            kind: 'list',
            items: [
              {
                fr: 'Côte à côte : une colonne par barbier pour la journée — la vue par défaut, idéale pour répartir les rendez-vous entre les chaises.',
                en: 'Side by Side: one column per barber for the day — the default view, best for spreading appointments across chairs.',
              },
              {
                fr: 'Semaine : la grille 7 jours pour le barbier filtré.',
                en: 'Week: the 7-day grid for the filtered barber.',
              },
              {
                fr: 'Liste : tous les rendez-vous du jour en ordre chronologique.',
                en: 'List: every appointment of the day in chronological order.',
              },
            ],
          },
          {
            kind: 'p',
            text: {
              fr: 'La date se change avec « Aujourd’hui », les flèches ‹ ›, ou l’icône calendrier.',
              en: 'Change the date with “Today”, the ‹ › arrows, or the calendar icon.',
            },
          },
        ],
      },
      {
        id: 'create',
        title: { fr: 'Créer un rendez-vous', en: 'Create an appointment' },
        blocks: [
          {
            kind: 'steps',
            items: [
              {
                fr: 'Cliquez sur « Add appointment », ou sur un créneau vide dans une colonne.',
                en: 'Click “Add appointment”, or an empty slot inside a column.',
              },
              {
                fr: 'Cherchez et choisissez le client (voir « Trouver un client »).',
                en: 'Search and pick the client (see “Find a client”).',
              },
              {
                fr: 'Choisissez le barbier et un ou plusieurs services — la durée se calcule automatiquement.',
                en: 'Pick the barber and one or more services — the duration is computed automatically.',
              },
              {
                fr: 'Choisissez la date et l’heure, ajoutez une note au besoin.',
                en: 'Pick the date and time, add a note if needed.',
              },
              {
                fr: 'Le système vérifie les conflits avant d’enregistrer.',
                en: 'The system checks for conflicts before saving.',
              },
            ],
          },
          {
            kind: 'note',
            tone: 'info',
            text: {
              fr: 'À la création, un rendez-vous est « réservé » ou « confirmé ». Les autres statuts (complété, annulé…) se définissent ensuite depuis le panneau du rendez-vous.',
              en: 'On creation an appointment is “booked” or “confirmed”. The other statuses (completed, cancelled…) are set afterward from the appointment panel.',
            },
          },
        ],
      },
      {
        id: 'find-client',
        title: { fr: 'Trouver un client', en: 'Find a client' },
        blocks: [
          {
            kind: 'p',
            text: {
              fr: 'Le champ de recherche interroge toute votre base de clients, pas seulement les premiers résultats — utile quand vous en avez des milliers.',
              en: 'The search box queries your entire client base, not just the first few — useful when you have thousands.',
            },
          },
          {
            kind: 'p',
            text: {
              fr: 'Tapez au moins deux lettres : la recherche porte sur le prénom, le nom, le courriel et le téléphone. Le client choisi reste sélectionné même si vous modifiez ensuite votre recherche.',
              en: 'Type at least two letters: the search covers first name, last name, email and phone. The chosen client stays selected even if you change the query afterward.',
            },
          },
        ],
      },
      {
        id: 'move',
        title: { fr: 'Déplacer un rendez-vous', en: 'Move an appointment' },
        blocks: [
          {
            kind: 'p',
            text: {
              fr: 'Glissez un bloc pour le déplacer dans le temps (par pas de 5 minutes). Les gestionnaires peuvent aussi le glisser vers la colonne d’un autre barbier.',
              en: 'Drag a block to move it in time (in 5-minute steps). Managers can also drag it to another barber’s column.',
            },
          },
          {
            kind: 'p',
            text: {
              fr: 'Le bloc bouge immédiatement ; si le nouveau créneau entre en conflit, le déplacement est annulé et un message s’affiche.',
              en: 'The block moves immediately; if the new slot conflicts, the move is reverted and a message is shown.',
            },
          },
          {
            kind: 'note',
            tone: 'info',
            text: {
              fr: 'Les rendez-vous annulés ou « no-show » ne peuvent pas être déplacés.',
              en: 'Cancelled or no-show appointments cannot be moved.',
            },
          },
        ],
      },
      {
        id: 'resize',
        title: { fr: 'Changer la durée', en: 'Change the duration' },
        blocks: [
          {
            kind: 'p',
            text: {
              fr: 'Survolez un bloc : une poignée apparaît sur son bord inférieur. Glissez-la pour allonger ou raccourcir le rendez-vous (par pas de 5 minutes).',
              en: 'Hover a block: a handle appears on its bottom edge. Drag it to lengthen or shorten the appointment (in 5-minute steps).',
            },
          },
          {
            kind: 'p',
            text: {
              fr: 'Seule la durée change — le client, les services et le prix restent identiques. Le système revalide l’absence de chevauchement avant d’enregistrer.',
              en: 'Only the duration changes — client, services and price stay the same. The system re-checks for overlap before saving.',
            },
          },
        ],
      },
      {
        id: 'statuses',
        title: { fr: 'Statuts et couleurs', en: 'Statuses and colours' },
        blocks: [
          {
            kind: 'p',
            text: {
              fr: 'Chaque rendez-vous porte un statut, reflété par la couleur du bloc et sa barre latérale.',
              en: 'Each appointment carries a status, reflected by the block colour and its side bar.',
            },
          },
          {
            kind: 'list',
            items: [
              { fr: 'Réservé : bleu — créneau tentatif.', en: 'Booked: blue — tentative slot.' },
              {
                fr: 'Confirmé : barre accent — oui ferme.',
                en: 'Confirmed: accent bar — a firm yes.',
              },
              {
                fr: 'Arrivé : vert — le client est dans la chaise.',
                en: 'Arrived: green — the client is in the chair.',
              },
              {
                fr: 'Complété : gris, barre verte — terminé et réglé.',
                en: 'Completed: grey, green bar — done and settled.',
              },
              { fr: 'Annulé : texte barré, gris.', en: 'Cancelled: struck-through, grey.' },
              { fr: 'No-show : orange — absence.', en: 'No-show: orange — a missed appointment.' },
            ],
          },
          {
            kind: 'note',
            tone: 'info',
            text: {
              fr: 'Un rendez-vous complété ou annulé ne peut pas être ramené à un autre statut (garde-fou).',
              en: 'A completed or cancelled appointment can’t be moved back to another status (a safeguard).',
            },
          },
        ],
      },
      {
        id: 'block-time',
        title: { fr: 'Bloquer du temps', en: 'Block time' },
        blocks: [
          {
            kind: 'p',
            text: {
              fr: '« Block time » réserve une plage où aucun rendez-vous ne peut être pris (pause, congé, formation). Un blocage peut viser un barbier précis ou tout le salon, et se répéter (hebdomadaire, etc.).',
              en: '“Block time” reserves a span where no appointment can be booked (break, time off, training). A block can target one barber or the whole shop, and can repeat (weekly, etc.).',
            },
          },
          {
            kind: 'note',
            tone: 'warn',
            text: {
              fr: 'Si un blocage recouvre des rendez-vous existants, le système indique combien sont concernés et demande confirmation avant de l’appliquer.',
              en: 'If a block covers existing appointments, the system tells you how many are affected and asks for confirmation before applying it.',
            },
          },
        ],
      },
      {
        id: 'payments',
        title: { fr: 'Dépôts, paiements et remboursements', en: 'Deposits, payments and refunds' },
        blocks: [
          {
            kind: 'p',
            text: {
              fr: 'Un rendez-vous peut porter un dépôt encaissé à la réservation. L’état du paiement (impayé, payé, remboursé…) est suivi sur le rendez-vous.',
              en: 'An appointment can carry a deposit charged at booking. The payment state (unpaid, paid, refunded…) is tracked on the appointment.',
            },
          },
          {
            kind: 'note',
            tone: 'warn',
            text: {
              fr: 'Seuls les gestionnaires et propriétaires peuvent rembourser. Un barbier peut annuler son rendez-vous mais pas déplacer d’argent.',
              en: 'Only managers and owners can issue refunds. A barber may cancel their own appointment but not move money.',
            },
          },
          {
            kind: 'p',
            text: {
              fr: 'Les remboursements sont plafonnés en débit (anti-abus) et respectent la fenêtre d’annulation du salon — au-delà, un remboursement « hors politique » exige une confirmation explicite.',
              en: 'Refunds are rate-limited (anti-abuse) and respect the shop’s cancellation window — beyond it, an “out-of-policy” refund requires explicit confirmation.',
            },
          },
        ],
      },
      {
        id: 'cancel',
        title: { fr: 'Annuler (et rembourser)', en: 'Cancel (and refund)' },
        blocks: [
          {
            kind: 'p',
            text: {
              fr: 'Depuis le panneau du rendez-vous, « Annuler » libère le créneau. Si le rendez-vous était payé, un gestionnaire peut « Annuler et rembourser » en un seul geste.',
              en: 'From the appointment panel, “Cancel” frees the slot. If the appointment was paid, a manager can “Cancel and refund” in a single action.',
            },
          },
          {
            kind: 'p',
            text: {
              fr: 'À l’annulation, les clients en liste d’attente qui correspondent au créneau libéré sont notifiés.',
              en: 'On cancellation, waitlisted clients matching the freed slot are notified.',
            },
          },
        ],
      },
      {
        id: 'availability',
        title: { fr: 'Comment une disponibilité est calculée', en: 'How availability is computed' },
        blocks: [
          {
            kind: 'p',
            text: {
              fr: 'Un créneau est libre s’il respecte en même temps :',
              en: 'A slot is free when it satisfies all of:',
            },
          },
          {
            kind: 'list',
            items: [
              {
                fr: 'les heures d’ouverture du salon ce jour-là,',
                en: 'the shop’s opening hours that day,',
              },
              { fr: 'hors jours de congé,', en: 'not on a day off,' },
              {
                fr: 'aucun chevauchement avec un autre rendez-vous ou un blocage du même barbier,',
                en: 'no overlap with another appointment or a block for the same barber,',
              },
              {
                fr: 'les délais et intervalles configurés (réservation à l’avance, etc.).',
                en: 'the configured delays and intervals (book-in-advance, etc.).',
              },
            ],
          },
          {
            kind: 'p',
            text: {
              fr: 'Une contrainte en base empêche deux rendez-vous de se chevaucher pour un même barbier, même en cas de réservations simultanées.',
              en: 'A database constraint prevents two appointments from overlapping for the same barber, even under simultaneous bookings.',
            },
          },
        ],
      },
      {
        id: 'realtime',
        title: { fr: 'Mises à jour en temps réel', en: 'Real-time updates' },
        blocks: [
          {
            kind: 'p',
            text: {
              fr: 'Le calendrier se met à jour tout seul : une réservation prise ailleurs (autre poste, page publique) apparaît sans rafraîchir.',
              en: 'The calendar updates on its own: a booking made elsewhere (another desk, the public page) appears without refreshing.',
            },
          },
          {
            kind: 'p',
            text: {
              fr: 'Si la connexion temps réel se coupe, un indicateur le signale et le calendrier se resynchronise automatiquement.',
              en: 'If the real-time connection drops, an indicator flags it and the calendar resynchronises automatically.',
            },
          },
        ],
      },
      {
        id: 'permissions',
        title: { fr: 'Qui voit quoi', en: 'Who sees what' },
        blocks: [
          {
            kind: 'p',
            text: {
              fr: 'Un barbier « simple » ne voit que sa propre colonne et ses propres rendez-vous ; il ne peut créer ou modifier que les siens.',
              en: 'A plain barber only sees their own column and their own appointments; they can only create or edit their own.',
            },
          },
          {
            kind: 'p',
            text: {
              fr: 'Les gestionnaires et propriétaires voient et gèrent toutes les colonnes. Cette séparation est appliquée à la fois dans l’interface et dans la base de données.',
              en: 'Managers and owners see and manage every column. This separation is enforced both in the interface and in the database.',
            },
          },
        ],
      },
      {
        id: 'google',
        title: { fr: 'Synchronisation Google Agenda', en: 'Google Calendar sync' },
        blocks: [
          {
            kind: 'p',
            text: {
              fr: 'Si un barbier connecte son Google Agenda, ses occupations personnelles apparaissent en superposition (hachuré, gris) pour éviter les doubles réservations. Les rendez-vous du salon sont aussi reflétés dans son agenda.',
              en: 'If a barber connects their Google Calendar, their personal busy times appear as a hatched grey overlay to avoid double-booking. Shop appointments are also mirrored into their calendar.',
            },
          },
        ],
      },
      {
        id: 'timezone',
        title: { fr: 'Fuseau horaire', en: 'Time zone' },
        blocks: [
          {
            kind: 'p',
            text: {
              fr: 'Tout le calendrier raisonne dans le fuseau du salon (ex. America/Toronto). Les heures affichées et les règles d’ouverture sont calculées en heure locale du salon, peu importe d’où vous vous connectez.',
              en: 'The whole calendar reasons in the shop’s time zone (e.g. America/Toronto). Displayed times and opening rules are computed in the shop’s local time, no matter where you sign in from.',
            },
          },
        ],
      },
    ],
  },

  // =========================================================================
  // CLIENTS — fully documented.
  // =========================================================================
  {
    id: 'clients',
    icon: Users,
    title: { fr: 'Clients', en: 'Clients' },
    summary: {
      fr: 'Le répertoire des clients du salon.',
      en: 'The shop’s client directory.',
    },
    articles: [
      {
        id: 'overview',
        title: { fr: 'Vue d’ensemble', en: 'Overview' },
        blocks: [
          {
            kind: 'p',
            text: {
              fr: 'La page Clients liste tout votre répertoire, filtrable par lettre (A–Z) et par recherche. Cliquez le nom d’un client pour ouvrir sa fiche : coordonnées, statistiques, historique de rendez-vous et notes.',
              en: 'The Clients page lists your whole directory, filterable by letter (A–Z) and by search. Click a client’s name to open their record: contact details, stats, appointment history and notes.',
            },
          },
          {
            kind: 'list',
            items: [
              {
                fr: '« Add client » crée une fiche ; « Download » exporte tout le répertoire en CSV.',
                en: '“Add client” creates a record; “Download” exports the whole directory to CSV.',
              },
              {
                fr: '« Locate Duplicates » filtre pour ne montrer que les doublons (même téléphone ou courriel).',
                en: '“Locate Duplicates” filters the list down to duplicates only (same phone or email).',
              },
            ],
          },
          {
            kind: 'note',
            tone: 'info',
            text: {
              fr: 'Un barbier ne voit que les clients qu’il a déjà servis (au moins un rendez-vous). Les gérants et propriétaires voient tout le répertoire du salon actif.',
              en: 'A barber only sees clients they have already served (at least one appointment). Managers and owners see the whole directory of the active shop.',
            },
          },
        ],
      },
      {
        id: 'search',
        title: { fr: 'Rechercher et parcourir', en: 'Search and browse' },
        blocks: [
          {
            kind: 'p',
            text: {
              fr: 'La barre A–Z filtre par première lettre du prénom. Les accents sont repliés sur leur lettre de base (« Élodie » se trouve sous E) et les noms hors A–Z se rangent sous « # ». Une lettre sans client est grisée.',
              en: 'The A–Z bar filters by the first letter of the first name. Accents fold to their base letter (“Élodie” lives under E) and non-A–Z names land under “#”. A letter with no client is dimmed.',
            },
          },
          {
            kind: 'p',
            text: {
              fr: 'La recherche (nom, courriel ou téléphone) filtre la liste instantanément. Pour les gérants, dès deux caractères elle interroge l’ensemble du salon — un client absent de la page chargée reste donc trouvable. Un bandeau « résultats dans tous les clients » l’indique.',
              en: 'Search (name, email or phone) filters the list instantly. For managers, from two characters it queries the whole shop — so a client not in the loaded page stays findable. A “matches across all clients” banner signals it.',
            },
          },
        ],
      },
      {
        id: 'record',
        title: { fr: 'La fiche client', en: 'The client record' },
        blocks: [
          {
            kind: 'p',
            text: {
              fr: 'Cliquez un nom pour ouvrir la fiche. Elle réunit les coordonnées, la date d’anniversaire, la date d’inscription, quatre statistiques et l’historique complet.',
              en: 'Click a name to open the record. It gathers contact details, birthday, the join date, four stats and the full history.',
            },
          },
          {
            kind: 'list',
            items: [
              {
                fr: 'Total dépensé : la somme des rendez-vous complétés.',
                en: 'Total spent: the sum of completed appointments.',
              },
              {
                fr: 'Visites : le nombre de rendez-vous complétés ; Absences : les « no-show ».',
                en: 'Visits: the count of completed appointments; No-shows: missed ones.',
              },
              {
                fr: 'Solde de fidélité : le crédit ou le compteur courant du client.',
                en: 'Loyalty balance: the client’s current credit or counter.',
              },
            ],
          },
        ],
      },
      {
        id: 'duplicates',
        title: { fr: 'Doublons et fusion', en: 'Duplicates and merging' },
        blocks: [
          {
            kind: 'p',
            text: {
              fr: 'À la création, un client dont le téléphone ou le courriel existe déjà est refusé : pas de doublon silencieux. La réservation en ligne reconnaît aussi un client existant par son numéro normalisé (les 10 derniers chiffres), donc reréserver ne crée pas de second dossier.',
              en: 'On creation, a client whose phone or email already exists is rejected: no silent duplicate. Online booking also recognizes an existing client by their normalized number (the last 10 digits), so rebooking never spawns a second record.',
            },
          },
          {
            kind: 'steps',
            items: [
              {
                fr: 'Cliquez « Locate Duplicates » : les fiches en double portent un badge « Doublon ».',
                en: 'Click “Locate Duplicates”: duplicate records show a “Duplicate” badge.',
              },
              {
                fr: 'Sur une de ces fiches, ouvrez le menu d’actions et choisissez « Fusionner ».',
                en: 'On one of those records, open the actions menu and pick “Merge”.',
              },
              {
                fr: 'Sélectionnez le dossier à replier dans celui que vous gardez, puis confirmez.',
                en: 'Pick the record to fold into the one you keep, then confirm.',
              },
            ],
          },
          {
            kind: 'note',
            tone: 'warn',
            text: {
              fr: 'La fusion est réservée aux gérants et propriétaires. Elle replie les rendez-vous, la fidélité et les avis du doublon dans la fiche conservée, puis supprime le doublon — c’est définitif.',
              en: 'Merging is reserved for managers and owners. It folds the duplicate’s appointments, loyalty and reviews into the kept record, then deletes the duplicate — this is permanent.',
            },
          },
        ],
      },
      {
        id: 'privacy',
        title: { fr: 'Vie privée (Loi 25 / LCAP)', en: 'Privacy (Law 25 / CASL)' },
        blocks: [
          {
            kind: 'p',
            text: {
              fr: 'Chaque fiche offre les droits prévus par la Loi 25, depuis le menu d’actions :',
              en: 'Each record offers the rights required by Quebec’s Law 25, from the actions menu:',
            },
          },
          {
            kind: 'list',
            items: [
              {
                fr: '« Exporter les données » télécharge un fichier JSON complet (coordonnées, rendez-vous, fidélité, avis, envois marketing).',
                en: '“Export data” downloads a full JSON file (contact, appointments, loyalty, reviews, marketing sends).',
              },
              {
                fr: '« Anonymiser » efface définitivement les renseignements personnels tout en gardant les totaux comptables — irréversible.',
                en: '“Anonymize” permanently scrubs personal information while keeping accounting totals — irreversible.',
              },
              {
                fr: '« Révoquer l’accès libre-service » invalide tous les liens « /me » en circulation du client.',
                en: '“Revoke self-service access” invalidates all of the client’s outstanding “/me” links.',
              },
            ],
          },
          {
            kind: 'note',
            tone: 'info',
            text: {
              fr: 'Côté anti-pourriel (LCAP) : chaque courriel marketing (relance, anniversaire, demande d’avis) porte un lien de désabonnement. Un client désabonné est automatiquement ignoré par les trois envois ; vous pouvez aussi voir l’état depuis sa fiche.',
              en: 'On the anti-spam side (CASL): every marketing email (win-back, birthday, review request) carries an unsubscribe link. An unsubscribed client is automatically skipped by all three sends; you can also see the state from their record.',
            },
          },
        ],
      },
    ],
  },
  // =========================================================================
  // The following features carry an accurate OVERVIEW; detailed mechanics are
  // added as each feature gets its own review.
  // =========================================================================
  {
    id: 'services',
    icon: Scissors,
    title: { fr: 'Services', en: 'Services' },
    summary: {
      fr: 'Les prestations offertes : durée, prix, taxes, catégories.',
      en: 'The offered services: duration, price, taxes, categories.',
    },
    articles: [
      {
        id: 'overview',
        title: { fr: 'Vue d’ensemble', en: 'Overview' },
        blocks: [
          {
            kind: 'p',
            text: {
              fr: 'Chaque service a un nom, une catégorie, une durée, un prix et ses taxes applicables. La durée alimente le calcul automatique au calendrier.',
              en: 'Each service has a name, a category, a duration, a price and its applicable taxes. The duration feeds the calendar’s automatic computation.',
            },
          },
          {
            kind: 'p',
            text: {
              fr: 'Les services se réordonnent par glisser-déposer (ordre d’affichage), et peuvent être activés ou désactivés sans être supprimés.',
              en: 'Services can be reordered by drag-and-drop (display order), and enabled or disabled without being deleted.',
            },
          },
        ],
      },
    ],
  },
  {
    id: 'barbers',
    icon: UserCircle2,
    title: { fr: 'Barbiers', en: 'Barbers' },
    summary: {
      fr: 'L’équipe : barbiers confirmés, personnel, et leurs réglages.',
      en: 'The team: confirmed barbers, staff, and their settings.',
    },
    articles: [
      {
        id: 'overview',
        title: { fr: 'Vue d’ensemble', en: 'Overview' },
        blocks: [
          {
            kind: 'p',
            text: {
              fr: 'Les barbiers sont répartis en onglets : Confirmés, Personnel, Supprimés. On invite un barbier par courriel, avec ses coordonnées et un avatar.',
              en: 'Barbers are split into tabs: Confirmed, Staff, Deleted. A barber is invited by email, with contact details and an avatar.',
            },
          },
          {
            kind: 'p',
            text: {
              fr: 'Les réglages par barbier (intervalles de réservation, rappels, pourboires…) se gèrent dans Réglages → Barber settings, avec une ligne « Shop » servant de défaut.',
              en: 'Per-barber settings (booking intervals, reminders, tips…) live in Settings → Barber settings, with a “Shop” row serving as the default.',
            },
          },
        ],
      },
    ],
  },
  {
    id: 'products',
    icon: Package,
    title: { fr: 'Produits', en: 'Products' },
    summary: {
      fr: 'L’inventaire de détail : stock, marques, catégories.',
      en: 'Retail inventory: stock, brands, categories.',
    },
    articles: [
      {
        id: 'overview',
        title: { fr: 'Vue d’ensemble', en: 'Overview' },
        blocks: [
          {
            kind: 'p',
            text: {
              fr: 'Chaque produit a un prix, un prix d’achat, un inventaire courant et un seuil bas. Les produits sous leur seuil sont signalés, et un rapport « Low Inventory » les compte.',
              en: 'Each product has a price, a supply price, a current inventory and a low threshold. Products below their threshold are flagged, and a “Low Inventory” report counts them.',
            },
          },
          {
            kind: 'p',
            text: {
              fr: 'Le commutateur en haut à droite bascule entre Produits, Marques et Catégories.',
              en: 'The switcher at the top right toggles between Products, Brands and Categories.',
            },
          },
        ],
      },
    ],
  },
  {
    id: 'booking',
    icon: CalendarCheck,
    title: { fr: 'Réservation en ligne', en: 'Online booking' },
    summary: {
      fr: 'La page publique où les clients réservent eux-mêmes.',
      en: 'The public page where clients book for themselves.',
    },
    articles: [
      {
        id: 'overview',
        title: { fr: 'Vue d’ensemble', en: 'Overview' },
        blocks: [
          {
            kind: 'p',
            text: {
              fr: 'Sans connexion, le client choisit un ou des services, un barbier (ou « n’importe lequel »), un créneau réellement disponible, puis ses coordonnées. Un pourboire et un code promo peuvent être proposés.',
              en: 'Without logging in, the client picks one or more services, a barber (or “any”), a truly available slot, then their contact details. A tip and a promo code may be offered.',
            },
          },
          {
            kind: 'p',
            text: {
              fr: 'La réservation crée un rendez-vous marqué « en ligne », visible immédiatement au calendrier, en respectant le fuseau, les jours de congé et les horaires du salon.',
              en: 'The booking creates an appointment marked “online”, visible on the calendar right away, respecting the shop’s time zone, days off and hours.',
            },
          },
        ],
      },
    ],
  },
  {
    id: 'settings',
    icon: Settings,
    title: { fr: 'Réglages', en: 'Settings' },
    summary: {
      fr: 'Détails du salon, taxes, fidélité, codes promo, et plus.',
      en: 'Shop details, taxes, loyalty, promo codes, and more.',
    },
    articles: [
      {
        id: 'overview',
        title: { fr: 'Vue d’ensemble', en: 'Overview' },
        blocks: [
          {
            kind: 'p',
            text: {
              fr: 'Les réglages regroupent : détails du salon (coordonnées, horaires, jours de congé, langues), taxes, réglages des barbiers, remises, programme de fidélité, liste d’attente, codes promo, et le traitement des paiements.',
              en: 'Settings gather: shop details (contact, hours, days off, languages), taxes, barber settings, discounts, loyalty program, waiting list, promo codes, and payment processing.',
            },
          },
          {
            kind: 'note',
            tone: 'info',
            text: {
              fr: 'Les taxes (TPS, TVQ) définies ici s’appliquent automatiquement aux services et produits qui les référencent.',
              en: 'Taxes (GST, QST) defined here apply automatically to the services and products that reference them.',
            },
          },
        ],
      },
    ],
  },
  {
    id: 'finances',
    icon: DollarSign,
    title: { fr: 'Finances', en: 'Finances' },
    summary: {
      fr: 'Revenus, commissions et versements.',
      en: 'Revenue, commissions and payouts.',
    },
    articles: [
      {
        id: 'overview',
        title: { fr: 'Vue d’ensemble', en: 'Overview' },
        blocks: [
          {
            kind: 'p',
            text: {
              fr: 'La section Finances suit les revenus du salon et les commissions par barbier, calculées par paliers (et pourboires). Les paliers se configurent dans Réglages → Commission/Tip Splits.',
              en: 'The Finances section tracks shop revenue and per-barber commissions, computed by tiers (and tips). The tiers are configured in Settings → Commission/Tip Splits.',
            },
          },
        ],
      },
    ],
  },
];

function resolveBlock(b: RawBlock, l: DocLocale): DocBlock {
  switch (b.kind) {
    case 'p':
      return { kind: 'p', text: b.text[l] };
    case 'list':
      return { kind: 'list', items: b.items.map((i) => i[l]) };
    case 'steps':
      return { kind: 'steps', items: b.items.map((i) => i[l]) };
    case 'note':
      return { kind: 'note', tone: b.tone, text: b.text[l] };
  }
}

function blockSearchText(b: RawBlock, l: DocLocale): string {
  switch (b.kind) {
    case 'p':
    case 'note':
      return b.text[l];
    case 'list':
    case 'steps':
      return b.items.map((i) => i[l]).join(' ');
  }
}

/** Flatten the bilingual tree to the active locale + a search blob per article. */
export function resolveDocs(locale: DocLocale): DocFeature[] {
  return FEATURES.map((f) => ({
    id: f.id,
    icon: f.icon,
    title: f.title[locale],
    summary: f.summary[locale],
    articles: f.articles.map((a) => ({
      id: a.id,
      title: a.title[locale],
      blocks: a.blocks.map((b) => resolveBlock(b, locale)),
      search: [a.title[locale], ...a.blocks.map((b) => blockSearchText(b, locale))]
        .join(' ')
        .toLowerCase(),
    })),
  }));
}
