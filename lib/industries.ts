/**
 * Industry registry (Phase 23).
 *
 * Each vertical declares:
 *   - displayName + professionalTerm (bilingual labels for UI)
 *   - features (gate optional pages like Products / Commissions)
 *   - catalog (a starter pack of categories + services seeded into the new
 *     shop's DB at creation time — fully editable from /services afterwards)
 *
 * The catalog is intentionally **conservative**: 5-8 services per vertical
 * with sane Quebec-market 2026 prices. Shop owners customize after first
 * login. The goal is "shop usable on day 1 without typing anything", not
 * "exhaustive industry coverage".
 *
 * Adding a new vertical:
 *   1. Add a value to `industry_kind` in supabase/migrations.
 *   2. Add an entry to `INDUSTRIES` below.
 *   3. Add the radio option in /admin/shops/new + label in messages/*.json.
 */

export type IndustryKind =
  | 'hair_salon'
  | 'barbershop'
  | 'massage'
  | 'physio'
  | 'chiropractic'
  | 'esthetics';

export const INDUSTRY_KINDS = [
  'hair_salon',
  'barbershop',
  'massage',
  'physio',
  'chiropractic',
  'esthetics',
] as const satisfies readonly IndustryKind[];

type Bilingual = { fr: string; en: string };

export type ServiceTemplate = {
  /** Must match one of the category names in the same industry def. */
  category: string;
  name: Bilingual;
  duration_min: number;
  /** CAD, including the 2.9% gross-up convention used by the seed. */
  price: number;
};

export type IndustryDef = {
  id: IndustryKind;
  displayName: Bilingual;
  /** What we call the staff (barber / therapist / practitioner / aesthetician). */
  professionalTerm: Bilingual;
  features: {
    products: boolean;
    commissions: boolean;
    tips: boolean;
  };
  catalog: {
    categories: Array<{ name: Bilingual }>;
    services: ServiceTemplate[];
  };
};

// ---------------------------------------------------------------------------
// Verticals
// ---------------------------------------------------------------------------

export const INDUSTRIES: Record<IndustryKind, IndustryDef> = {
  hair_salon: {
    id: 'hair_salon',
    displayName: { fr: 'Salon de coiffure', en: 'Hair salon' },
    professionalTerm: { fr: 'styliste', en: 'stylist' },
    features: { products: true, commissions: true, tips: true },
    catalog: {
      categories: [
        { name: { fr: 'Coupes', en: 'Cuts' } },
        { name: { fr: 'Couleur', en: 'Color' } },
        { name: { fr: 'Coiffage', en: 'Styling' } },
      ],
      services: [
        {
          category: 'Coupes',
          name: { fr: 'Coupe femme', en: "Women's haircut" },
          duration_min: 45,
          price: 65,
        },
        {
          category: 'Coupes',
          name: { fr: 'Coupe homme', en: "Men's haircut" },
          duration_min: 30,
          price: 40,
        },
        {
          category: 'Coupes',
          name: { fr: 'Coupe enfant (<12 ans)', en: 'Kids haircut (<12)' },
          duration_min: 30,
          price: 28,
        },
        {
          category: 'Couleur',
          name: { fr: 'Coloration', en: 'Color' },
          duration_min: 90,
          price: 120,
        },
        {
          category: 'Couleur',
          name: { fr: 'Mèches', en: 'Highlights' },
          duration_min: 120,
          price: 180,
        },
        {
          category: 'Couleur',
          name: { fr: 'Coupe + couleur', en: 'Cut + color' },
          duration_min: 120,
          price: 165,
        },
        {
          category: 'Coiffage',
          name: { fr: 'Brushing', en: 'Blowout' },
          duration_min: 30,
          price: 45,
        },
        {
          category: 'Coiffage',
          name: { fr: 'Coiffure événement', en: 'Event styling' },
          duration_min: 60,
          price: 90,
        },
      ],
    },
  },

  barbershop: {
    id: 'barbershop',
    displayName: { fr: 'Barbershop', en: 'Barbershop' },
    professionalTerm: { fr: 'barbier', en: 'barber' },
    features: { products: true, commissions: true, tips: true },
    catalog: {
      categories: [{ name: { fr: 'Coupes', en: 'Cuts' } }, { name: { fr: 'Barbe', en: 'Beard' } }],
      services: [
        { category: 'Coupes', name: { fr: 'Coupe', en: 'Haircut' }, duration_min: 30, price: 35 },
        {
          category: 'Coupes',
          name: { fr: 'Coupe enfant', en: 'Kids haircut' },
          duration_min: 25,
          price: 25,
        },
        {
          category: 'Coupes',
          name: { fr: 'Coupe + barbe', en: 'Haircut + beard' },
          duration_min: 45,
          price: 50,
        },
        {
          category: 'Coupes',
          name: { fr: 'Coupe ciseaux', en: 'Scissor cut' },
          duration_min: 45,
          price: 45,
        },
        {
          category: 'Barbe',
          name: { fr: 'Taille de barbe', en: 'Beard trim' },
          duration_min: 20,
          price: 25,
        },
        {
          category: 'Barbe',
          name: { fr: 'Tracé / line up', en: 'Line up' },
          duration_min: 15,
          price: 15,
        },
        {
          category: 'Barbe',
          name: { fr: 'Rasage à la serviette chaude', en: 'Hot-towel shave' },
          duration_min: 30,
          price: 45,
        },
      ],
    },
  },

  massage: {
    id: 'massage',
    displayName: { fr: 'Massothérapie', en: 'Massage therapy' },
    professionalTerm: { fr: 'massothérapeute', en: 'massage therapist' },
    // Massage clinics typically don't sell retail products in-app.
    features: { products: false, commissions: true, tips: true },
    catalog: {
      categories: [
        { name: { fr: 'Massage de détente', en: 'Relaxation massage' } },
        { name: { fr: 'Massage thérapeutique', en: 'Therapeutic massage' } },
        { name: { fr: 'Spécialités', en: 'Specialties' } },
      ],
      services: [
        {
          category: 'Massage de détente',
          name: { fr: 'Massage suédois 60 min', en: 'Swedish 60 min' },
          duration_min: 60,
          price: 90,
        },
        {
          category: 'Massage de détente',
          name: { fr: 'Massage suédois 90 min', en: 'Swedish 90 min' },
          duration_min: 90,
          price: 130,
        },
        {
          category: 'Massage de détente',
          name: { fr: 'Massage suédois 120 min', en: 'Swedish 120 min' },
          duration_min: 120,
          price: 170,
        },
        {
          category: 'Massage thérapeutique',
          name: { fr: 'Tissus profonds 60 min', en: 'Deep tissue 60 min' },
          duration_min: 60,
          price: 100,
        },
        {
          category: 'Massage thérapeutique',
          name: { fr: 'Tissus profonds 90 min', en: 'Deep tissue 90 min' },
          duration_min: 90,
          price: 140,
        },
        {
          category: 'Massage thérapeutique',
          name: {
            fr: 'Thérapeutique (reçu assurance) 60 min',
            en: 'Therapeutic (insurance receipt) 60 min',
          },
          duration_min: 60,
          price: 105,
        },
        {
          category: 'Spécialités',
          name: { fr: 'Massage prénatal 60 min', en: 'Prenatal 60 min' },
          duration_min: 60,
          price: 95,
        },
        {
          category: 'Spécialités',
          name: { fr: 'Pierres chaudes 90 min', en: 'Hot stone 90 min' },
          duration_min: 90,
          price: 145,
        },
      ],
    },
  },

  physio: {
    id: 'physio',
    displayName: { fr: 'Physiothérapie', en: 'Physiotherapy' },
    professionalTerm: { fr: 'physiothérapeute', en: 'physiotherapist' },
    features: { products: false, commissions: true, tips: false },
    catalog: {
      categories: [
        { name: { fr: 'Évaluations', en: 'Assessments' } },
        { name: { fr: 'Traitements', en: 'Treatments' } },
        { name: { fr: 'Spécialités', en: 'Specialties' } },
      ],
      services: [
        {
          category: 'Évaluations',
          name: { fr: 'Évaluation initiale 60 min', en: 'Initial assessment 60 min' },
          duration_min: 60,
          price: 130,
        },
        {
          category: 'Évaluations',
          name: { fr: 'Réévaluation 45 min', en: 'Re-assessment 45 min' },
          duration_min: 45,
          price: 105,
        },
        {
          category: 'Traitements',
          name: { fr: 'Suivi 30 min', en: 'Follow-up 30 min' },
          duration_min: 30,
          price: 80,
        },
        {
          category: 'Traitements',
          name: { fr: 'Suivi 45 min', en: 'Follow-up 45 min' },
          duration_min: 45,
          price: 100,
        },
        {
          category: 'Traitements',
          name: { fr: 'Thérapie manuelle 45 min', en: 'Manual therapy 45 min' },
          duration_min: 45,
          price: 110,
        },
        {
          category: 'Spécialités',
          name: { fr: 'Acupuncture 30 min', en: 'Acupuncture 30 min' },
          duration_min: 30,
          price: 85,
        },
        {
          category: 'Spécialités',
          name: { fr: 'Rééducation périnéale 60 min', en: 'Pelvic-floor rehab 60 min' },
          duration_min: 60,
          price: 130,
        },
      ],
    },
  },

  chiropractic: {
    id: 'chiropractic',
    displayName: { fr: 'Chiropratique', en: 'Chiropractic' },
    professionalTerm: { fr: 'chiropraticien', en: 'chiropractor' },
    features: { products: false, commissions: true, tips: false },
    catalog: {
      categories: [
        { name: { fr: 'Évaluations', en: 'Assessments' } },
        { name: { fr: 'Traitements', en: 'Treatments' } },
      ],
      services: [
        {
          category: 'Évaluations',
          name: { fr: 'Évaluation initiale 60 min', en: 'Initial assessment 60 min' },
          duration_min: 60,
          price: 130,
        },
        {
          category: 'Évaluations',
          name: { fr: 'Radiographies (interprétation)', en: 'X-ray interpretation' },
          duration_min: 15,
          price: 60,
        },
        {
          category: 'Traitements',
          name: { fr: 'Ajustement chiropratique 15 min', en: 'Chiropractic adjustment 15 min' },
          duration_min: 15,
          price: 70,
        },
        {
          category: 'Traitements',
          name: { fr: 'Ajustement prolongé 30 min', en: 'Extended adjustment 30 min' },
          duration_min: 30,
          price: 95,
        },
        {
          category: 'Traitements',
          name: { fr: 'Décompression neurovertébrale 30 min', en: 'Spinal decompression 30 min' },
          duration_min: 30,
          price: 100,
        },
        {
          category: 'Traitements',
          name: { fr: 'Thérapie par ondes de choc 20 min', en: 'Shockwave therapy 20 min' },
          duration_min: 20,
          price: 90,
        },
      ],
    },
  },

  esthetics: {
    id: 'esthetics',
    displayName: { fr: 'Esthétique', en: 'Esthetics' },
    professionalTerm: { fr: 'esthéticien·ne', en: 'aesthetician' },
    features: { products: true, commissions: true, tips: true },
    catalog: {
      categories: [
        { name: { fr: 'Visage', en: 'Face' } },
        { name: { fr: 'Corps', en: 'Body' } },
        { name: { fr: 'Ongles', en: 'Nails' } },
      ],
      services: [
        {
          category: 'Visage',
          name: { fr: 'Soin du visage classique', en: 'Classic facial' },
          duration_min: 60,
          price: 90,
        },
        {
          category: 'Visage',
          name: { fr: 'Soin du visage premium', en: 'Premium facial' },
          duration_min: 90,
          price: 140,
        },
        {
          category: 'Visage',
          name: { fr: 'Microneedling', en: 'Microneedling' },
          duration_min: 90,
          price: 200,
        },
        {
          category: 'Corps',
          name: { fr: 'Épilation cire (jambes complètes)', en: 'Full-leg waxing' },
          duration_min: 45,
          price: 60,
        },
        {
          category: 'Corps',
          name: { fr: 'Épilation cire (sourcils)', en: 'Eyebrow waxing' },
          duration_min: 15,
          price: 18,
        },
        {
          category: 'Ongles',
          name: { fr: 'Manucure', en: 'Manicure' },
          duration_min: 45,
          price: 45,
        },
        {
          category: 'Ongles',
          name: { fr: 'Pédicure', en: 'Pedicure' },
          duration_min: 60,
          price: 65,
        },
        {
          category: 'Ongles',
          name: { fr: 'Pose d’ongles gel', en: 'Gel nail set' },
          duration_min: 75,
          price: 70,
        },
      ],
    },
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Type-guard for arbitrary input strings (form submissions, query params). */
export function isIndustryKind(value: string): value is IndustryKind {
  return (INDUSTRY_KINDS as readonly string[]).includes(value);
}

/**
 * Resolve the catalog for an industry, ready to insert into Supabase.
 *
 * V1 always emits the French strings because `/admin/shops/new` hard-codes
 * `default_language = 'fr'`. The EN strings on the templates exist so that
 * a V1.1 self-service onboarding (where the operator picks language up
 * front) can swap in a single line. The `categoryKey` on each service is
 * locale-stable (always the FR category name) so the seeder can map
 * services → categories.id after categories are inserted, regardless of
 * which locale the displayed name uses.
 */
export function getCatalogFor(
  industry: IndustryKind,
  locale: 'fr' | 'en' = 'fr',
): {
  categories: Array<{ name: string; key: string }>;
  services: Array<{
    categoryKey: string;
    name: string;
    duration_min: number;
    price: number;
  }>;
} {
  const def = INDUSTRIES[industry];
  return {
    categories: def.catalog.categories.map((c) => ({
      name: c.name[locale],
      key: c.name.fr, // stable across locales
    })),
    services: def.catalog.services.map((s) => ({
      categoryKey: s.category, // always the FR category name
      name: s.name[locale],
      duration_min: s.duration_min,
      price: s.price,
    })),
  };
}
