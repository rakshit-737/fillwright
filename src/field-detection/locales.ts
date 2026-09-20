import type { CanonicalField } from '@/types/fields';

/**
 * Locale vocabulary packs.
 *
 * Trust boundary: pure data. Nothing here reads the page; page text is only
 * ever matched AGAINST this vocabulary, never added to it.
 *
 * Each pack teaches the classifier one language's words for the fields in
 * rules.ts. rules.ts merges them into FIELD_RULES under the same discipline as
 * the English rules: a locale rule inherits every negative (`not`) of the
 * English rule for its field, and adds its own.
 *
 * Phrases are written as a speaker would write them ("Prénom", "Straße");
 * rules.ts runs them through normalizeLabel, so they are folded exactly as a
 * page label is. Patterns are matched against folded text and so are written
 * without diacritics.
 *
 * Which packs apply is decided per field (see classify.ts):
 *  - the control's `lang` names a supported pack → that pack only;
 *  - otherwise every pack, except rules marked `langOnly`: words that are also
 *    ordinary English ("Note", "Handy", "Media") and so only count when the
 *    page says it is written in that language.
 *
 * Safety vocabulary — every `sensitive.*` field, date of birth, salary, and
 * the third-party and company words — applies in every language regardless of
 * `lang`. A page that declares the wrong language must not be able to turn a
 * demographic or referee question into an ordinary field.
 */

export type LocaleCode = 'de' | 'fr' | 'es' | 'pt' | 'nl' | 'it';

export interface LocaleRule {
  field: CanonicalField;
  exact?: string[];
  includes?: string[];
  patterns?: RegExp[];
  not?: RegExp[];
  weight?: number;
  /** Only when the control's language is this pack's (the word is also English). */
  langOnly?: boolean;
}

export interface LocalePack {
  code: LocaleCode;
  /** Regex fragments (folded) meaning the field is about somebody else. */
  thirdParty: string[];
  /** Regex fragments (folded) meaning the field is about an organisation. */
  company: string[];
  rules: LocaleRule[];
}

/* ------------------------------------------------------------------ German */

const DE: LocalePack = {
  code: 'de',
  thirdParty: [
    'referenz\\w*',
    'referenzperson\\w*',
    'notfall\\w*',
    'ansprechpartner\\w*',
    'ansprechperson\\w*',
    'kontaktperson\\w*',
    'vorgesetzte\\w*',
    'personalvermittler\\w*',
    'erziehungsberechtigte\\w*',
    'eltern',
    'mutter',
    'vater',
    'ehepartner\\w*',
    'ehefrau',
    'ehemann',
    'lebenspartner\\w*',
    'freund\\w*',
    'kolleg\\w*',
    'zeuge\\w*',
    'angehorige\\w*',
  ],
  company: [
    'unternehmen\\w*',
    'firma',
    'firmen\\w*',
    'arbeitgeber\\w*',
    'organisation',
    'hochschule',
    'universitat',
    'schule',
    'agentur',
  ],
  rules: [
    {
      field: 'personal.firstName',
      exact: ['vorname', 'rufname', 'vornamen'],
      includes: ['vorname'],
    },
    { field: 'personal.middleName', exact: ['zweiter vorname'], includes: ['zweiter vorname'] },
    {
      field: 'personal.lastName',
      exact: ['nachname', 'familienname', 'zuname'],
      includes: ['nachname', 'familienname'],
    },
    {
      field: 'personal.fullName',
      exact: ['vollständiger name', 'vor- und nachname', 'vor und zuname'],
      includes: ['vollständiger name', 'vor und nachname'],
    },
    { field: 'personal.fullName', exact: ['ihr name', 'dein name'], weight: 0.66 },
    {
      field: 'personal.email',
      exact: ['e-mail-adresse', 'email adresse', 'mailadresse', 'ihre e-mail-adresse'],
      includes: ['email adresse', 'mailadresse'],
      not: [/\b(?:bestatig\w*|wiederhol\w*)\b/],
    },
    {
      field: 'personal.phone',
      exact: [
        'telefon',
        'telefonnummer',
        'mobilnummer',
        'mobiltelefon',
        'rufnummer',
        'handynummer',
      ],
      includes: ['telefon', 'telefonnummer', 'mobilnummer', 'rufnummer', 'handynummer'],
      not: [/\b(?:vorwahl|landervorwahl|durchwahl)\b/],
    },
    { field: 'personal.phone', exact: ['handy'], langOnly: true },
    {
      field: 'personal.dateOfBirth',
      exact: ['geburtsdatum', 'geburtstag'],
      includes: ['geburtsdatum'],
    },
    {
      field: 'address.line1',
      exact: [
        'adresse',
        'anschrift',
        'straße',
        'straße und hausnummer',
        'wohnadresse',
        'postanschrift',
      ],
      includes: ['straße und hausnummer', 'anschrift'],
      not: [/\b(?:email|mailadresse|webadresse)\b/],
    },
    {
      field: 'address.line2',
      exact: ['adresszusatz', 'adresse zeile 2'],
      includes: ['adresszusatz'],
    },
    { field: 'address.city', exact: ['stadt', 'wohnort', 'ort'], includes: ['wohnort'] },
    { field: 'address.state', exact: ['bundesland', 'kanton'], includes: ['bundesland'] },
    { field: 'address.postalCode', exact: ['plz', 'postleitzahl'], includes: ['postleitzahl'] },
    {
      field: 'address.country',
      exact: ['land', 'wohnsitzland', 'aufenthaltsland'],
      not: [/\b(?:staatsangehorigkeit|arbeitserlaubnis|vorwahl)\b/],
      langOnly: true,
    },
    { field: 'address.formatted', exact: ['standort', 'aktueller standort'] },
    { field: 'links.website', exact: ['persönliche website', 'webseite', 'homepage'] },
    {
      field: 'education.institution',
      exact: ['hochschule', 'universität', 'bildungseinrichtung', 'fachhochschule'],
      includes: ['universität', 'hochschule'],
    },
    {
      field: 'education.degree',
      exact: ['abschluss', 'studienabschluss', 'höchster abschluss', 'bildungsabschluss'],
      includes: ['abschluss'],
      not: [/\b(?:abschlussnote|abschlussdatum|abschlussjahr)\b/],
    },
    {
      field: 'education.major',
      exact: ['studiengang', 'fachrichtung', 'studienfach', 'hauptfach'],
      includes: ['studiengang', 'fachrichtung'],
    },
    {
      field: 'education.gpa',
      exact: ['abschlussnote', 'notendurchschnitt'],
      includes: ['notendurchschnitt', 'abschlussnote'],
    },
    { field: 'education.gpa', exact: ['note'], langOnly: true },
    { field: 'education.graduationDate', exact: ['abschlussdatum', 'abschlussjahr'] },
    {
      field: 'experience.company',
      exact: [
        'unternehmen',
        'arbeitgeber',
        'firma',
        'aktueller arbeitgeber',
        'derzeitiger arbeitgeber',
      ],
      includes: ['arbeitgeber'],
      not: [/\b(?:warum|bewerben|bewirbst|unser\w*|dies\w*)\b/],
    },
    {
      field: 'experience.title',
      exact: ['berufsbezeichnung', 'jobtitel', 'aktuelle position', 'stellenbezeichnung'],
      includes: ['berufsbezeichnung', 'jobtitel'],
      not: [/\b(?:gewunscht\w*|beworben\w*)\b/],
    },
    {
      field: 'experience.yearsOfExperience',
      exact: ['berufserfahrung', 'jahre berufserfahrung'],
      patterns: [/\bjahre?n?\b.*\b(?:berufs)?erfahrung\b/],
      not: [/\b(?:mit|in)\b/],
    },
    { field: 'documents.resume', exact: ['lebenslauf'], includes: ['lebenslauf'] },
    {
      field: 'documents.coverLetter',
      exact: ['anschreiben', 'motivationsschreiben'],
      includes: ['anschreiben', 'motivationsschreiben'],
    },
    { field: 'profile.summary', exact: ['über mich', 'kurzprofil'] },
    {
      field: 'profile.skills',
      exact: ['kenntnisse', 'fähigkeiten', 'kompetenzen'],
      includes: ['kenntnisse', 'fähigkeiten', 'kompetenzen'],
    },
    {
      field: 'preferences.startDate',
      exact: ['frühester eintrittstermin', 'eintrittsdatum', 'eintrittstermin', 'verfügbar ab'],
      includes: ['eintrittstermin', 'verfügbar ab'],
    },
    {
      field: 'preferences.noticePeriod',
      exact: ['kündigungsfrist'],
      includes: ['kündigungsfrist'],
    },
    {
      field: 'preferences.desiredSalary',
      exact: ['gehaltsvorstellung', 'gehaltswunsch', 'gewünschtes gehalt', 'gehaltsvorstellungen'],
      includes: ['gehaltsvorstellung', 'gehaltswunsch', 'gewünschtes gehalt'],
      not: [/\b(?:aktuell\w*|derzeitig\w*|jetzig\w*)\b/],
    },
    {
      field: 'preferences.howDidYouHear',
      patterns: [/\baufmerksam geworden\b/, /\bwie haben sie (?:von|uns)\b/],
    },
    { field: 'preferences.referredBy', exact: ['empfohlen von'], includes: ['empfohlen von'] },
    // safety
    {
      field: 'sensitive.workAuthorization',
      exact: ['arbeitserlaubnis', 'arbeitsgenehmigung'],
      includes: ['arbeitserlaubnis', 'arbeitsgenehmigung'],
      patterns: [
        /\b(?:berechtigt|erlaubt)\b.*\barbeiten\b/,
        /\barbeiten\b.*\b(?:berechtigt|erlaubt)\b/,
      ],
    },
    {
      field: 'sensitive.requiresSponsorship',
      patterns: [/\bvisum\w*\b.*\bsponsor/, /\bsponsor\w*\b.*\bvisum/, /\bvisum\w*sponsor/],
    },
    {
      field: 'sensitive.visaStatus',
      exact: [
        'aufenthaltsstatus',
        'aufenthaltstitel',
        'visumstatus',
        'staatsangehörigkeit',
        'nationalität',
      ],
      includes: ['aufenthaltsstatus', 'aufenthaltstitel', 'staatsangehörigkeit'],
    },
    { field: 'sensitive.gender', exact: ['geschlecht', 'anrede'], includes: ['geschlecht'] },
    {
      field: 'sensitive.raceEthnicity',
      exact: ['ethnische herkunft', 'ethnie', 'ethnische zugehörigkeit'],
      patterns: [/\bethni\w*/],
    },
    {
      field: 'sensitive.disabilityStatus',
      patterns: [/\b\w*behinderung\w*/, /\bschwerbehindert\w*/],
    },
    {
      field: 'sensitive.veteranStatus',
      exact: ['wehrdienst', 'militärdienst'],
      includes: ['wehrdienst', 'militärdienst'],
    },
    {
      field: 'sensitive.criminalHistory',
      exact: ['vorstrafen', 'führungszeugnis', 'strafregister'],
      patterns: [/\bvorstraf\w*/, /\bvorbestraft\b/, /\bverurteil\w*/],
    },
    {
      field: 'sensitive.securityClearance',
      patterns: [/\bsicherheits(?:uberprufung|freigabe)\w*/],
    },
    {
      field: 'sensitive.willingToRelocate',
      exact: ['umzugsbereitschaft'],
      patterns: [/\bumzugsbereit\w*/, /\bumzuziehen\b/, /\bumziehen\b/],
    },
    { field: 'sensitive.willingToTravel', patterns: [/\breisebereit\w*/] },
    { field: 'sensitive.drugTestConsent', patterns: [/\bdrogen(?:test|screening)\w*/] },
    {
      field: 'sensitive.backgroundCheckConsent',
      patterns: [/\bhintergrund(?:uber)?prufung\w*/],
    },
  ],
};

/* ------------------------------------------------------------------ French */

const FR: LocalePack = {
  code: 'fr',
  thirdParty: [
    'referent\\w*',
    'references?',
    'urgence',
    'personne a (?:contacter|prevenir)',
    'recruteur\\w*',
    'recruteuse\\w*',
    'responsable',
    'superieur\\w*',
    'tuteur',
    'tutrice',
    'conjoint\\w*',
    'epoux',
    'epouse',
    'ami',
    'amie',
    'collegue\\w*',
    'temoin\\w*',
    'parrain\\w*',
    'marraine',
  ],
  company: [
    'entreprise\\w*',
    'societe',
    'employeur\\w*',
    'organisation',
    'ecole',
    'universite',
    'etablissement',
    'agence',
    'cabinet',
  ],
  rules: [
    {
      field: 'personal.firstName',
      exact: ['prénom', 'votre prénom', 'prénom usuel'],
      includes: ['prénom'],
    },
    { field: 'personal.middleName', exact: ['deuxième prénom', 'second prénom'] },
    {
      field: 'personal.lastName',
      exact: ['nom de famille', 'nom de naissance', "nom d'usage"],
      includes: ['nom de famille'],
    },
    // A bare "Nom" is usually the surname, but not always: review it.
    { field: 'personal.lastName', exact: ['nom', 'votre nom'], weight: 0.66 },
    {
      field: 'personal.fullName',
      exact: ['nom complet', 'nom et prénom', 'prénom et nom', 'nom prénom', 'prénom nom'],
      includes: ['nom complet', 'nom et prénom', 'prénom et nom'],
    },
    {
      field: 'personal.email',
      exact: ['courriel', 'adresse e-mail', 'adresse électronique', 'adresse mail', 'mail'],
      includes: ['courriel', 'adresse email', 'adresse électronique', 'adresse mail'],
      not: [/\b(?:confirm\w*|resaisi\w*)\b/],
    },
    {
      field: 'personal.phone',
      exact: [
        'téléphone',
        'numéro de téléphone',
        'tél',
        'téléphone portable',
        'numéro de portable',
      ],
      includes: ['téléphone'],
      not: [/\b(?:indicatif)\b/],
    },
    { field: 'personal.phone', exact: ['portable'], langOnly: true },
    {
      field: 'personal.dateOfBirth',
      exact: ['date de naissance'],
      includes: ['date de naissance'],
    },
    {
      field: 'address.line1',
      exact: [
        'adresse',
        'adresse postale',
        'rue',
        'adresse ligne 1',
        'numéro et rue',
        'adresse de domicile',
      ],
      includes: ['adresse postale', 'adresse ligne 1'],
      not: [/\b(?:email|courriel|electronique|mail|ip)\b/],
    },
    {
      field: 'address.line2',
      exact: ["complément d'adresse", 'adresse ligne 2'],
      includes: ["complément d'adresse"],
    },
    {
      field: 'address.city',
      exact: ['ville', 'localité', 'commune', 'ville de résidence'],
      includes: ['ville'],
    },
    { field: 'address.state', exact: ['département', 'canton'], includes: ['département'] },
    { field: 'address.postalCode', exact: ['code postal', 'cp'], includes: ['code postal'] },
    {
      field: 'address.country',
      exact: ['pays', 'pays de résidence'],
      includes: ['pays'],
      not: [/\b(?:nationalite|indicatif)\b/],
    },
    { field: 'address.formatted', exact: ['localisation', 'lieu de résidence'] },
    { field: 'links.website', exact: ['site web', 'site personnel', 'site internet'] },
    {
      field: 'education.institution',
      exact: [
        'établissement',
        'école',
        'université',
        "nom de l'établissement",
        "établissement d'enseignement",
      ],
      includes: ['université', 'établissement', 'école'],
    },
    {
      field: 'education.degree',
      exact: ['diplôme', "niveau d'études", 'diplôme obtenu', 'niveau de diplôme'],
      includes: ['diplôme', "niveau d'études"],
      not: [/\bdate\b/, /\bannee\b/],
    },
    {
      field: 'education.major',
      exact: ['spécialité', 'filière', "domaine d'études"],
      includes: ['spécialité', 'filière'],
    },
    { field: 'education.gpa', exact: ['moyenne générale'] },
    { field: 'education.gpa', exact: ['moyenne'], langOnly: true },
    {
      field: 'education.graduationDate',
      exact: [
        "date d'obtention du diplôme",
        'date de diplôme',
        "année d'obtention",
        "année d'obtention du diplôme",
      ],
    },
    {
      field: 'experience.company',
      exact: ['entreprise', 'employeur', 'société', 'employeur actuel', 'entreprise actuelle'],
      includes: ['employeur'],
      not: [/\b(?:pourquoi|notre|cette|postulez)\b/],
    },
    {
      field: 'experience.title',
      exact: [
        'intitulé du poste',
        'poste actuel',
        'fonction',
        'titre du poste',
        'fonction actuelle',
      ],
      includes: ['intitulé du poste', 'poste actuel'],
      not: [/\b(?:postulez|vise\w*|souhaite\w*)\b/],
    },
    { field: 'experience.title', exact: ['poste'], langOnly: true },
    {
      field: 'experience.yearsOfExperience',
      exact: ["années d'expérience"],
      patterns: [/\bannees?\b.*\bexperience\b/],
      not: [/\b(?:avec|en)\b/],
    },
    { field: 'documents.resume', exact: ['curriculum'], includes: ['curriculum'] },
    {
      field: 'documents.coverLetter',
      exact: ['lettre de motivation'],
      includes: ['lettre de motivation'],
    },
    { field: 'profile.summary', exact: ['à propos de vous', 'présentez-vous'] },
    { field: 'profile.summary', exact: ['présentation'], langOnly: true },
    {
      field: 'profile.skills',
      exact: ['compétences', 'compétences clés'],
      includes: ['compétences'],
    },
    {
      field: 'preferences.startDate',
      exact: ['date de disponibilité', 'disponibilité', 'date de début souhaitée'],
      includes: ['date de disponibilité'],
    },
    {
      field: 'preferences.noticePeriod',
      exact: ['préavis', 'délai de préavis'],
      includes: ['préavis'],
    },
    {
      field: 'preferences.desiredSalary',
      exact: [
        'prétentions salariales',
        'salaire souhaité',
        'rémunération souhaitée',
        'prétention salariale',
      ],
      includes: [
        'prétentions salariales',
        'prétention salariale',
        'salaire souhaité',
        'rémunération souhaitée',
      ],
      not: [/\b(?:actuel\w*)\b/],
    },
    {
      field: 'preferences.howDidYouHear',
      patterns: [/\bcomment avez vous (?:connu|entendu|trouve)\b/],
    },
    {
      field: 'preferences.referredBy',
      exact: ['recommandé par', 'cooptation'],
      includes: ['recommandé par'],
    },
    // safety
    {
      field: 'sensitive.workAuthorization',
      exact: ['autorisation de travail', 'permis de travail'],
      includes: ['autorisation de travail', 'permis de travail'],
      patterns: [/\bautorise\w*\b.*\btravailler\b/, /\bdroit de travailler\b/],
    },
    {
      field: 'sensitive.requiresSponsorship',
      patterns: [
        /\bparrainage\b.*\bvisa\b/,
        /\bvisa\b.*\b(?:parrainage|sponsor)/,
        /\bsponsoris\w*/,
      ],
    },
    {
      field: 'sensitive.visaStatus',
      exact: ['statut de visa', 'titre de séjour', 'nationalité', "statut d'immigration"],
      includes: ['titre de séjour', 'nationalité', 'statut de visa'],
    },
    { field: 'sensitive.gender', exact: ['sexe', 'genre', 'civilité'], includes: ['sexe'] },
    {
      field: 'sensitive.raceEthnicity',
      exact: ['origine ethnique', 'ethnicité'],
      includes: ['origine ethnique', 'ethnicité'],
    },
    {
      field: 'sensitive.disabilityStatus',
      exact: ['handicap', 'rqth'],
      patterns: [/\bhandicap\w*/, /\brqth\b/],
    },
    {
      field: 'sensitive.veteranStatus',
      exact: ['ancien combattant', 'service militaire'],
      includes: ['ancien combattant', 'service militaire'],
    },
    {
      field: 'sensitive.criminalHistory',
      exact: ['casier judiciaire'],
      includes: ['casier judiciaire'],
      patterns: [/\bcondamn\w*/],
    },
    { field: 'sensitive.securityClearance', patterns: [/\bhabilitation\w*/] },
    {
      field: 'sensitive.willingToRelocate',
      exact: ['mobilité géographique', 'relocalisation'],
      patterns: [/\bmobilite geographique\b/, /\bdemenag\w*/, /\bvous installer\b/],
    },
    { field: 'sensitive.willingToTravel', patterns: [/\bdeplacements?\b/, /\bvoyager\b/] },
    { field: 'sensitive.drugTestConsent', patterns: [/\bdepistage\w*/] },
    { field: 'sensitive.backgroundCheckConsent', patterns: [/\bverification des antecedents\b/] },
  ],
};

/* ----------------------------------------------------------------- Spanish */

const ES: LocalePack = {
  code: 'es',
  thirdParty: [
    'referencias?',
    'referente',
    'emergencia',
    'reclutador\\w*',
    'jefe',
    'jefa',
    'gerente',
    'tutor\\w*',
    'padre',
    'madre',
    'conyuge',
    'esposo',
    'esposa',
    'amigo',
    'amiga',
    'colega\\w*',
    'testigo\\w*',
  ],
  company: [
    'empresa\\w*',
    'compania',
    'empleador\\w*',
    'organizacion',
    'universidad',
    'escuela',
    'colegio',
    'institucion',
    'agencia',
  ],
  rules: [
    {
      field: 'personal.firstName',
      exact: ['nombres', 'primer nombre', 'nombre de pila', 'nombre(s)'],
      includes: ['primer nombre', 'nombre de pila'],
    },
    // A bare "Nombre" is the given name next to "Apellidos", the whole name
    // on its own. Review it.
    { field: 'personal.firstName', exact: ['nombre', 'su nombre', 'tu nombre'], weight: 0.66 },
    { field: 'personal.middleName', exact: ['segundo nombre'], includes: ['segundo nombre'] },
    {
      field: 'personal.lastName',
      exact: ['apellido', 'apellidos', 'primer apellido'],
      includes: ['apellido', 'apellidos'],
    },
    {
      field: 'personal.fullName',
      exact: ['nombre completo', 'nombre y apellidos', 'nombres y apellidos'],
      includes: ['nombre completo', 'nombre y apellidos', 'nombres y apellidos'],
    },
    {
      field: 'personal.email',
      exact: ['correo', 'correo electrónico', 'dirección de correo electrónico'],
      includes: ['correo electrónico', 'correo'],
      not: [/\b(?:confirm\w*|repet\w*)\b/],
    },
    {
      field: 'personal.phone',
      exact: [
        'teléfono',
        'celular',
        'móvil',
        'número de teléfono',
        'teléfono móvil',
        'número de celular',
      ],
      includes: ['teléfono', 'celular', 'móvil'],
      not: [/\b(?:prefijo|extension)\b/],
    },
    {
      field: 'personal.dateOfBirth',
      exact: ['fecha de nacimiento'],
      includes: ['fecha de nacimiento'],
    },
    {
      field: 'address.line1',
      exact: ['dirección', 'domicilio', 'calle', 'dirección postal', 'dirección de residencia'],
      includes: ['dirección postal', 'domicilio', 'dirección de residencia'],
      not: [/\b(?:correo|electronico|email|web|ip)\b/],
    },
    { field: 'address.line1', exact: ['direccion'], not: [/\b(?:correo|electronico|email)\b/] },
    {
      field: 'address.city',
      exact: ['ciudad', 'localidad', 'municipio', 'población'],
      includes: ['ciudad'],
    },
    {
      field: 'address.state',
      exact: ['provincia', 'comunidad autónoma', 'departamento', 'estado'],
      not: [/\b(?:civil|migratorio)\b/],
    },
    { field: 'address.postalCode', exact: ['código postal', 'cp'], includes: ['código postal'] },
    {
      field: 'address.country',
      exact: ['país', 'país de residencia'],
      includes: ['país'],
      not: [/\b(?:nacionalidad|prefijo)\b/],
    },
    { field: 'address.formatted', exact: ['ubicación', 'ubicación actual'] },
    { field: 'links.website', exact: ['sitio web', 'página web', 'sitio web personal'] },
    {
      field: 'education.institution',
      exact: ['universidad', 'institución', 'centro de estudios', 'institución educativa'],
      includes: ['universidad', 'institución educativa', 'centro de estudios'],
    },
    {
      field: 'education.degree',
      exact: ['título', 'titulación', 'nivel de estudios', 'título obtenido', 'grado académico'],
      includes: ['titulación', 'nivel de estudios', 'grado académico'],
      not: [/\b(?:puesto|cargo)\b/],
    },
    {
      field: 'education.major',
      exact: ['carrera', 'especialidad', 'campo de estudio', 'área de estudio'],
      includes: ['especialidad', 'campo de estudio'],
    },
    {
      field: 'education.gpa',
      exact: ['promedio', 'nota media', 'calificación media'],
      includes: ['nota media'],
    },
    {
      field: 'education.graduationDate',
      exact: ['fecha de graduación', 'año de graduación', 'fecha de egreso'],
    },
    {
      field: 'experience.company',
      exact: ['empresa', 'empleador', 'empresa actual', 'compañía', 'empleador actual'],
      includes: ['empleador'],
      not: [/\b(?:por que|nuestra|esta|postula\w*)\b/],
    },
    {
      field: 'experience.title',
      exact: ['puesto', 'cargo actual', 'puesto actual', 'título del puesto'],
      includes: ['cargo actual', 'puesto actual', 'título del puesto'],
      not: [/\b(?:postula\w*|solicita\w*|desead\w*)\b/],
    },
    { field: 'experience.title', exact: ['cargo'], langOnly: true },
    {
      field: 'experience.yearsOfExperience',
      exact: ['años de experiencia'],
      patterns: [/\banos\b.*\bexperiencia\b/],
      not: [/\b(?:con|en)\b/],
    },
    {
      field: 'documents.resume',
      exact: ['currículum', 'hoja de vida', 'currículum vitae'],
      includes: ['currículum', 'hoja de vida'],
    },
    {
      field: 'documents.coverLetter',
      exact: ['carta de presentación', 'carta de motivación'],
      includes: ['carta de presentación', 'carta de motivación'],
    },
    { field: 'profile.summary', exact: ['sobre mí', 'acerca de ti', 'perfil profesional'] },
    {
      field: 'profile.skills',
      exact: ['habilidades', 'competencias', 'aptitudes'],
      includes: ['habilidades', 'competencias'],
    },
    {
      field: 'preferences.startDate',
      exact: ['fecha de incorporación', 'disponibilidad', 'fecha de inicio disponible'],
      includes: ['fecha de incorporación'],
    },
    {
      field: 'preferences.noticePeriod',
      exact: ['preaviso', 'período de preaviso'],
      includes: ['preaviso'],
    },
    {
      field: 'preferences.desiredSalary',
      exact: [
        'expectativa salarial',
        'pretensión salarial',
        'salario deseado',
        'aspiración salarial',
      ],
      includes: [
        'expectativa salarial',
        'pretensión salarial',
        'salario deseado',
        'aspiración salarial',
      ],
      not: [/\b(?:actual)\b/],
    },
    {
      field: 'preferences.howDidYouHear',
      patterns: [/\bcomo (?:se entero|te enteraste|conociste|nos conocio|supo)\b/],
    },
    {
      field: 'preferences.referredBy',
      exact: ['referido por', 'recomendado por'],
      includes: ['referido por'],
    },
    // safety
    {
      field: 'sensitive.workAuthorization',
      exact: ['permiso de trabajo', 'autorización de trabajo'],
      includes: ['permiso de trabajo', 'autorización de trabajo'],
      patterns: [/\bautorizad[oa]s?\b.*\btrabajar\b/, /\bderecho a trabajar\b/],
    },
    { field: 'sensitive.requiresSponsorship', patterns: [/\bpatrocini\w*/] },
    {
      field: 'sensitive.visaStatus',
      exact: ['situación migratoria', 'estatus migratorio', 'tipo de visa', 'nacionalidad'],
      includes: ['nacionalidad', 'tipo de visa'],
      patterns: [/\bmigratori[oa]\b/],
    },
    { field: 'sensitive.gender', exact: ['género', 'sexo'], includes: ['género', 'sexo'] },
    {
      field: 'sensitive.raceEthnicity',
      exact: ['origen étnico', 'etnia', 'raza'],
      includes: ['origen étnico', 'etnia', 'raza'],
    },
    { field: 'sensitive.disabilityStatus', patterns: [/\bdiscapacidad\w*/] },
    {
      field: 'sensitive.veteranStatus',
      exact: ['veterano', 'servicio militar'],
      includes: ['veterano', 'servicio militar'],
    },
    {
      field: 'sensitive.criminalHistory',
      exact: ['antecedentes penales'],
      includes: ['antecedentes penales'],
      patterns: [/\bcondenad[oa]s?\b/],
    },
    {
      field: 'sensitive.securityClearance',
      patterns: [/\b(?:habilitacion|autorizacion) de seguridad\b/],
    },
    {
      field: 'sensitive.willingToRelocate',
      patterns: [/\breubica\w*/, /\btraslad\w*/, /\bmudar\w*/],
    },
    { field: 'sensitive.willingToTravel', patterns: [/\bviajar\b/, /\bviajes\b/] },
    {
      field: 'sensitive.drugTestConsent',
      patterns: [/\b(?:prueba|examen|test) (?:de )?(?:drogas|toxicologic\w*)\b/],
    },
    { field: 'sensitive.backgroundCheckConsent', patterns: [/\bverificacion de antecedentes\b/] },
  ],
};

/* -------------------------------------------------------------- Portuguese */

const PT: LocalePack = {
  code: 'pt',
  thirdParty: [
    'referencias?',
    'emergencia',
    'recrutador\\w*',
    'gestor\\w*',
    'chefe',
    'responsavel',
    'conjuge',
    'esposo',
    'esposa',
    'marido',
    'amigo',
    'amiga',
    'colega\\w*',
    'testemunha\\w*',
  ],
  company: [
    'empresa\\w*',
    'companhia',
    'empregador\\w*',
    'organizacao',
    'universidade',
    'faculdade',
    'escola',
    'instituicao',
    'agencia',
  ],
  rules: [
    {
      field: 'personal.firstName',
      exact: ['primeiro nome', 'nome próprio'],
      includes: ['primeiro nome'],
    },
    { field: 'personal.middleName', exact: ['nome do meio'], includes: ['nome do meio'] },
    {
      field: 'personal.lastName',
      exact: ['sobrenome', 'apelido', 'último nome'],
      includes: ['sobrenome', 'último nome'],
    },
    { field: 'personal.fullName', exact: ['nome completo'], includes: ['nome completo'] },
    // A bare "Nome" is the whole name in Portuguese; ambiguous, so reviewed.
    { field: 'personal.fullName', exact: ['nome', 'seu nome'], weight: 0.66 },
    {
      field: 'personal.email',
      exact: ['correio eletrônico', 'endereço de e-mail', 'correio electrónico', 'seu e-mail'],
      includes: ['correio eletrônico', 'correio electrónico', 'endereço de email'],
      not: [/\b(?:confirm\w*|repet\w*)\b/],
    },
    {
      field: 'personal.phone',
      exact: ['telefone', 'celular', 'telemóvel', 'número de telefone', 'telefone celular'],
      includes: ['telefone', 'celular', 'telemóvel'],
      not: [/\b(?:ddi|ddd|indicativo)\b/],
    },
    {
      field: 'personal.dateOfBirth',
      exact: ['data de nascimento'],
      includes: ['data de nascimento'],
    },
    {
      field: 'address.line1',
      exact: ['endereço', 'morada', 'rua', 'logradouro', 'endereço residencial'],
      includes: ['endereço residencial', 'morada', 'logradouro'],
      not: [/\b(?:email|eletronico|electronico|web|ip)\b/],
    },
    { field: 'address.line2', exact: ['complemento'], langOnly: true },
    { field: 'address.city', exact: ['cidade', 'localidade', 'município'], includes: ['cidade'] },
    {
      field: 'address.state',
      exact: ['estado', 'distrito', 'uf'],
      not: [/\b(?:civil)\b/],
      langOnly: true,
    },
    { field: 'address.postalCode', exact: ['cep', 'código postal'], includes: ['código postal'] },
    {
      field: 'address.country',
      exact: ['país', 'país de residência'],
      includes: ['país'],
      not: [/\b(?:nacionalidade)\b/],
    },
    { field: 'address.formatted', exact: ['localização', 'localização atual'] },
    { field: 'links.website', exact: ['site pessoal', 'página pessoal'] },
    {
      field: 'education.institution',
      exact: ['universidade', 'instituição', 'faculdade', 'instituição de ensino'],
      includes: ['universidade', 'instituição de ensino', 'faculdade'],
    },
    {
      field: 'education.degree',
      exact: [
        'escolaridade',
        'nível de escolaridade',
        'grau académico',
        'grau acadêmico',
        'formação acadêmica',
      ],
      includes: ['escolaridade', 'formação acadêmica', 'grau acadêmico'],
    },
    { field: 'education.degree', exact: ['grau', 'formação'], langOnly: true },
    {
      field: 'education.major',
      exact: ['área de estudo', 'especialização'],
      includes: ['área de estudo'],
    },
    { field: 'education.major', exact: ['curso'], langOnly: true },
    { field: 'education.gpa', exact: ['nota final', 'coeficiente de rendimento'] },
    { field: 'education.gpa', exact: ['média'], langOnly: true },
    {
      field: 'education.graduationDate',
      exact: ['data de conclusão', 'ano de conclusão'],
      includes: ['data de conclusão'],
    },
    {
      field: 'experience.company',
      exact: ['empresa', 'empregador', 'empresa atual', 'empregador atual'],
      includes: ['empregador'],
      not: [/\b(?:por que|nossa|esta|candidat\w*)\b/],
    },
    {
      field: 'experience.title',
      exact: ['cargo atual', 'função', 'título do cargo'],
      includes: ['cargo atual'],
      not: [/\b(?:candidat\w*|desejad\w*|pretendid\w*)\b/],
    },
    { field: 'experience.title', exact: ['cargo'], langOnly: true },
    {
      field: 'experience.yearsOfExperience',
      exact: ['anos de experiência'],
      patterns: [/\banos\b.*\bexperiencia\b/],
      not: [/\b(?:com|em)\b/],
    },
    { field: 'documents.resume', exact: ['currículo'], includes: ['currículo'] },
    {
      field: 'documents.coverLetter',
      exact: ['carta de apresentação', 'carta de motivação'],
      includes: ['carta de apresentação', 'carta de motivação'],
    },
    { field: 'profile.summary', exact: ['sobre você', 'sobre mim', 'resumo profissional'] },
    {
      field: 'profile.skills',
      exact: ['competências', 'habilidades'],
      includes: ['competências', 'habilidades'],
    },
    {
      field: 'preferences.startDate',
      exact: ['disponibilidade para início', 'data de início disponível'],
      includes: ['disponibilidade para início'],
    },
    {
      field: 'preferences.noticePeriod',
      exact: ['aviso prévio', 'período de aviso'],
      includes: ['aviso prévio'],
    },
    {
      field: 'preferences.desiredSalary',
      exact: ['pretensão salarial', 'expectativa salarial', 'salário pretendido'],
      includes: ['pretensão salarial', 'expectativa salarial', 'salário pretendido'],
      not: [/\b(?:atual|actual)\b/],
    },
    {
      field: 'preferences.howDidYouHear',
      patterns: [/\bcomo (?:voce )?(?:soube|conheceu|ficou sabendo)\b/],
    },
    {
      field: 'preferences.referredBy',
      exact: ['indicado por', 'indicação'],
      includes: ['indicado por'],
    },
    // safety
    {
      field: 'sensitive.workAuthorization',
      exact: ['autorização de trabalho', 'permissão de trabalho', 'visto de trabalho'],
      includes: ['autorização de trabalho', 'permissão de trabalho', 'visto de trabalho'],
      patterns: [/\bautorizad[oa]s?\b.*\btrabalhar\b/, /\bdireito de trabalhar\b/],
    },
    { field: 'sensitive.requiresSponsorship', patterns: [/\bpatrocini\w*/] },
    {
      field: 'sensitive.visaStatus',
      exact: ['situação migratória', 'tipo de visto', 'nacionalidade'],
      includes: ['nacionalidade', 'tipo de visto'],
      patterns: [/\bmigratori[oa]\b/],
    },
    {
      field: 'sensitive.gender',
      exact: ['gênero', 'género', 'sexo'],
      includes: ['gênero', 'sexo'],
    },
    {
      field: 'sensitive.raceEthnicity',
      exact: ['raça', 'etnia', 'cor ou raça', 'raça cor'],
      includes: ['raça', 'etnia'],
    },
    { field: 'sensitive.disabilityStatus', patterns: [/\bdeficiencia\w*/, /\bpcd\b/] },
    {
      field: 'sensitive.veteranStatus',
      exact: ['serviço militar', 'veterano'],
      includes: ['serviço militar', 'veterano'],
    },
    {
      field: 'sensitive.criminalHistory',
      exact: ['antecedentes criminais', 'registro criminal', 'registo criminal'],
      includes: ['antecedentes criminais', 'registro criminal', 'registo criminal'],
      patterns: [/\bcondenad[oa]s?\b/],
    },
    { field: 'sensitive.securityClearance', patterns: [/\bcredenciamento de seguranca\b/] },
    {
      field: 'sensitive.willingToRelocate',
      patterns: [/\brealoca\w*/, /\bmudanca\b/, /\bmudar de (?:cidade|pais)\b/],
    },
    { field: 'sensitive.willingToTravel', patterns: [/\bviajar\b/, /\bviagens\b/] },
    {
      field: 'sensitive.drugTestConsent',
      patterns: [/\bexame toxicologic\w*/, /\bteste de drogas\b/],
    },
    { field: 'sensitive.backgroundCheckConsent', patterns: [/\bverificacao de antecedentes\b/] },
  ],
};

/* ------------------------------------------------------------------- Dutch */

const NL: LocalePack = {
  code: 'nl',
  thirdParty: [
    'referent\\w*',
    'referentie\\w*',
    'noodcontact\\w*',
    'nood',
    'contactpersoon\\w*',
    'leidinggevende\\w*',
    'begeleider\\w*',
    'ouders?',
    'voogd',
    'echtgeno\\w*',
    'vriend\\w*',
    'collega\\w*',
    'getuige\\w*',
  ],
  company: [
    'bedrijf\\w*',
    'organisatie',
    'werkgever\\w*',
    'onderneming',
    'universiteit',
    'hogeschool',
    'instelling',
    'bureau',
  ],
  rules: [
    {
      field: 'personal.firstName',
      exact: ['voornaam', 'roepnaam', 'voornamen'],
      includes: ['voornaam'],
    },
    {
      field: 'personal.lastName',
      exact: ['achternaam', 'familienaam'],
      includes: ['achternaam', 'familienaam'],
    },
    { field: 'personal.fullName', exact: ['volledige naam'], includes: ['volledige naam'] },
    { field: 'personal.fullName', exact: ['naam', 'uw naam', 'je naam'], weight: 0.66 },
    {
      field: 'personal.email',
      exact: ['e-mailadres', 'emailadres', 'uw e-mailadres'],
      includes: ['e mailadres', 'emailadres'],
      not: [/\b(?:bevestig\w*|herhaal\w*)\b/],
    },
    {
      field: 'personal.phone',
      exact: ['telefoon', 'telefoonnummer', 'mobiel', 'mobiel nummer', 'mobiele telefoon', 'gsm'],
      includes: ['telefoon', 'telefoonnummer', 'mobiel'],
      not: [/\b(?:landcode|netnummer)\b/],
    },
    { field: 'personal.dateOfBirth', exact: ['geboortedatum'], includes: ['geboortedatum'] },
    {
      field: 'address.line1',
      exact: ['adres', 'straat', 'straatnaam', 'straat en huisnummer', 'woonadres'],
      includes: ['straat en huisnummer', 'woonadres'],
      not: [/\b(?:email|e mailadres|emailadres|web|ip)\b/],
    },
    { field: 'address.line2', exact: ['huisnummer toevoeging', 'toevoeging'] },
    { field: 'address.city', exact: ['woonplaats', 'stad', 'plaats'], includes: ['woonplaats'] },
    { field: 'address.state', exact: ['provincie'], includes: ['provincie'] },
    {
      field: 'address.country',
      exact: ['land', 'land van verblijf'],
      not: [/\b(?:nationaliteit|landcode)\b/],
      langOnly: true,
    },
    { field: 'address.formatted', exact: ['locatie', 'huidige locatie'] },
    { field: 'links.website', exact: ['persoonlijke website'] },
    {
      field: 'education.institution',
      exact: ['universiteit', 'hogeschool', 'onderwijsinstelling', 'opleidingsinstituut'],
      includes: ['universiteit', 'hogeschool', 'onderwijsinstelling'],
    },
    {
      field: 'education.degree',
      exact: ['opleidingsniveau', 'hoogst genoten opleiding', 'graad'],
      includes: ['opleidingsniveau'],
    },
    {
      field: 'education.major',
      exact: ['studierichting', 'studie', 'opleiding'],
      includes: ['studierichting'],
    },
    {
      field: 'education.gpa',
      exact: ['gemiddeld cijfer', 'eindcijfer'],
      includes: ['gemiddeld cijfer'],
    },
    {
      field: 'education.graduationDate',
      exact: ['afstudeerdatum', 'datum van afstuderen', 'afstudeerjaar'],
    },
    {
      field: 'experience.company',
      exact: ['bedrijf', 'werkgever', 'huidige werkgever', 'organisatie', 'bedrijfsnaam'],
      includes: ['werkgever'],
      not: [/\b(?:waarom|ons|onze|dit|deze|solliciteer\w*)\b/],
    },
    {
      field: 'experience.title',
      exact: ['functietitel', 'huidige functie', 'functienaam'],
      includes: ['functietitel', 'huidige functie'],
      not: [/\b(?:solliciteer\w*|gewenste)\b/],
    },
    { field: 'experience.title', exact: ['functie'], langOnly: true },
    {
      field: 'experience.yearsOfExperience',
      exact: ['jaren ervaring', 'werkervaring', 'aantal jaren werkervaring'],
      patterns: [/\bjaren?\b.*\b(?:werk)?ervaring\b/],
      not: [/\b(?:met|in)\b/],
    },
    {
      field: 'documents.coverLetter',
      exact: ['motivatiebrief', 'sollicitatiebrief'],
      includes: ['motivatiebrief', 'sollicitatiebrief'],
    },
    { field: 'profile.summary', exact: ['over mij', 'over jezelf', 'profielschets'] },
    {
      field: 'profile.skills',
      exact: ['vaardigheden', 'competenties'],
      includes: ['vaardigheden', 'competenties'],
    },
    {
      field: 'preferences.startDate',
      exact: ['beschikbaar vanaf', 'startdatum', 'ingangsdatum'],
      includes: ['beschikbaar vanaf'],
    },
    { field: 'preferences.noticePeriod', exact: ['opzegtermijn'], includes: ['opzegtermijn'] },
    {
      field: 'preferences.desiredSalary',
      exact: ['salarisindicatie', 'gewenst salaris', 'salariswens', 'salarisverwachting'],
      includes: ['gewenst salaris', 'salariswens', 'salarisindicatie', 'salarisverwachting'],
      not: [/\b(?:huidig\w*)\b/],
    },
    {
      field: 'preferences.howDidYouHear',
      patterns: [
        /\bhoe (?:heb je|heeft u|bent u|ben je)\b.*\b(?:gehoord|gevonden|terechtgekomen)\b/,
      ],
    },
    { field: 'preferences.referredBy', exact: ['doorverwezen door', 'aangedragen door'] },
    // safety
    {
      field: 'sensitive.workAuthorization',
      exact: ['werkvergunning', 'tewerkstellingsvergunning'],
      includes: ['werkvergunning'],
      patterns: [/\bbevoegd\b.*\bwerken\b/, /\bwerken\b.*\btoegestaan\b/],
    },
    { field: 'sensitive.requiresSponsorship', patterns: [/\bsponsor\w*/, /\bvisumsponsor\w*/] },
    {
      field: 'sensitive.visaStatus',
      exact: ['verblijfsstatus', 'verblijfsvergunning', 'nationaliteit', 'visumstatus'],
      includes: ['verblijfsstatus', 'verblijfsvergunning', 'nationaliteit'],
    },
    { field: 'sensitive.gender', exact: ['geslacht', 'aanhef'], includes: ['geslacht'] },
    {
      field: 'sensitive.raceEthnicity',
      exact: ['etniciteit', 'afkomst', 'etnische achtergrond'],
      patterns: [/\betni\w*/],
    },
    {
      field: 'sensitive.disabilityStatus',
      exact: ['handicap', 'beperking'],
      patterns: [/\b\w*beperking\b/, /\bhandicap\w*/],
    },
    {
      field: 'sensitive.veteranStatus',
      exact: ['veteraan', 'militaire dienst'],
      includes: ['veteraan', 'militaire dienst'],
    },
    {
      field: 'sensitive.criminalHistory',
      exact: ['strafblad', 'vog', 'verklaring omtrent het gedrag'],
      patterns: [/\bstrafblad\b/, /\bveroordeeld\b/, /\bverklaring omtrent het gedrag\b/],
    },
    { field: 'sensitive.securityClearance', patterns: [/\bveiligheids(?:onderzoek|machtiging)\b/] },
    { field: 'sensitive.willingToRelocate', patterns: [/\bverhui\w*/] },
    { field: 'sensitive.willingToTravel', exact: ['reisbereidheid'], patterns: [/\breizen\b/] },
    { field: 'sensitive.drugTestConsent', patterns: [/\bdrugs?test\w*/] },
    {
      field: 'sensitive.backgroundCheckConsent',
      patterns: [/\bantecedentenonderzoek\b/, /\bachtergrondcontrole\b/],
    },
  ],
};

/* ----------------------------------------------------------------- Italian */

const IT: LocalePack = {
  code: 'it',
  thirdParty: [
    'referenz\\w*',
    'referente',
    'emergenza',
    'persona da contattare',
    'selezionator\\w*',
    'responsabile',
    'supervisore',
    'genitor\\w*',
    'tutore',
    'coniuge',
    'marito',
    'moglie',
    'amico',
    'amica',
    'collega\\w*',
    'testimone',
  ],
  company: [
    'azienda\\w*',
    'societa',
    'datore di lavoro',
    'organizzazione',
    'universita',
    'scuola',
    'istituto',
    'ateneo',
    'agenzia',
  ],
  rules: [
    // In Italian "Nome" is the given name, beside "Cognome". Portuguese reads
    // the same word as the whole name, so it needs the page language.
    {
      field: 'personal.firstName',
      exact: ['nome', 'nome di battesimo', 'il tuo nome'],
      langOnly: true,
    },
    { field: 'personal.lastName', exact: ['cognome', 'il tuo cognome'], includes: ['cognome'] },
    {
      field: 'personal.fullName',
      exact: ['nome completo', 'nome e cognome', 'nominativo'],
      includes: ['nome e cognome', 'nome completo'],
    },
    {
      field: 'personal.email',
      exact: ['indirizzo email', 'posta elettronica', 'indirizzo di posta elettronica'],
      includes: ['posta elettronica', 'indirizzo email'],
      not: [/\b(?:conferma\w*|ripeti\w*)\b/],
    },
    {
      field: 'personal.phone',
      exact: [
        'telefono',
        'cellulare',
        'numero di telefono',
        'recapito telefonico',
        'numero di cellulare',
      ],
      includes: ['telefono', 'cellulare'],
      not: [/\b(?:prefisso)\b/],
    },
    { field: 'personal.dateOfBirth', exact: ['data di nascita'], includes: ['data di nascita'] },
    {
      field: 'address.line1',
      exact: ['indirizzo', 'residenza', 'indirizzo di residenza'],
      includes: ['indirizzo di residenza'],
      not: [/\b(?:email|posta|elettronica|web|ip)\b/],
    },
    { field: 'address.line1', exact: ['via'], langOnly: true },
    {
      field: 'address.city',
      exact: ['città', 'località', 'città di residenza'],
      includes: ['città'],
    },
    { field: 'address.city', exact: ['comune'], langOnly: true },
    { field: 'address.state', exact: ['provincia', 'regione'] },
    { field: 'address.postalCode', exact: ['codice postale'], includes: ['codice postale'] },
    { field: 'address.postalCode', exact: ['cap'], langOnly: true },
    {
      field: 'address.country',
      exact: ['paese', 'nazione', 'paese di residenza'],
      not: [/\b(?:cittadinanza|nazionalita|prefisso)\b/],
    },
    { field: 'address.formatted', exact: ['sede attuale', 'località attuale'] },
    { field: 'links.website', exact: ['sito web', 'sito personale'] },
    {
      field: 'education.institution',
      exact: ['università', 'istituto', 'ateneo', 'istituto di formazione'],
      includes: ['università', 'ateneo'],
    },
    {
      field: 'education.degree',
      exact: ['titolo di studio', 'laurea', 'livello di istruzione'],
      includes: ['titolo di studio', 'livello di istruzione'],
      not: [/\b(?:data|anno|voto|corso)\b/],
    },
    {
      field: 'education.major',
      exact: ['corso di laurea', 'indirizzo di studio', 'specializzazione'],
      includes: ['corso di laurea'],
    },
    {
      field: 'education.gpa',
      exact: ['voto di laurea', 'media voti', 'voto finale'],
      includes: ['voto di laurea'],
    },
    { field: 'education.gpa', exact: ['voto', 'media'], langOnly: true },
    {
      field: 'education.graduationDate',
      exact: ['data di laurea', 'anno di laurea', 'data di conseguimento'],
    },
    {
      field: 'experience.company',
      exact: ['azienda', 'datore di lavoro', 'società', 'azienda attuale'],
      includes: ['datore di lavoro'],
      not: [/\b(?:perche|nostra|questa|candid\w*)\b/],
    },
    {
      field: 'experience.title',
      exact: ['ruolo attuale', 'qualifica', 'mansione', 'posizione attuale'],
      includes: ['ruolo attuale', 'posizione attuale'],
      not: [/\b(?:candid\w*|desiderat\w*)\b/],
    },
    { field: 'experience.title', exact: ['ruolo', 'posizione'], langOnly: true },
    {
      field: 'experience.yearsOfExperience',
      exact: ['anni di esperienza'],
      patterns: [/\banni\b.*\besperienza\b/],
      not: [/\b(?:con|in)\b/],
    },
    { field: 'documents.resume', exact: ['curriculum'], includes: ['curriculum'] },
    {
      field: 'documents.coverLetter',
      exact: ['lettera di presentazione', 'lettera motivazionale'],
      includes: ['lettera di presentazione', 'lettera motivazionale'],
    },
    { field: 'profile.summary', exact: ['su di te', 'chi sei'] },
    { field: 'profile.summary', exact: ['presentazione'], langOnly: true },
    { field: 'profile.skills', exact: ['competenze', 'abilità'], includes: ['competenze'] },
    {
      field: 'preferences.startDate',
      exact: ['data di disponibilità', 'disponibilità', 'data di inizio disponibilità'],
      includes: ['data di disponibilità'],
    },
    {
      field: 'preferences.noticePeriod',
      exact: ['preavviso', 'periodo di preavviso'],
      includes: ['preavviso'],
    },
    {
      field: 'preferences.desiredSalary',
      exact: [
        'ral desiderata',
        'retribuzione desiderata',
        'aspettative economiche',
        'stipendio desiderato',
      ],
      includes: [
        'ral desiderata',
        'retribuzione desiderata',
        'aspettative economiche',
        'stipendio desiderato',
      ],
      not: [/\battual\w*\b/],
    },
    {
      field: 'preferences.howDidYouHear',
      patterns: [/\bcome (?:hai|ha|avete) (?:saputo|conosciuto|trovato)\b/],
    },
    { field: 'preferences.referredBy', exact: ['segnalato da', 'presentato da'] },
    // safety
    {
      field: 'sensitive.workAuthorization',
      exact: ['permesso di lavoro', 'autorizzazione al lavoro'],
      includes: ['permesso di lavoro', 'autorizzazione al lavoro'],
      patterns: [/\bautorizzat[oa]\b.*\blavorare\b/, /\bdiritto (?:di|a) lavorare\b/],
    },
    { field: 'sensitive.requiresSponsorship', patterns: [/\bsponsor\w*/] },
    {
      field: 'sensitive.visaStatus',
      exact: ['permesso di soggiorno', 'cittadinanza', 'nazionalità', 'tipo di visto'],
      includes: ['permesso di soggiorno', 'cittadinanza', 'nazionalità'],
    },
    { field: 'sensitive.gender', exact: ['sesso', 'genere'], includes: ['sesso'] },
    {
      field: 'sensitive.raceEthnicity',
      exact: ['etnia', 'origine etnica'],
      includes: ['etnia', 'origine etnica'],
    },
    {
      field: 'sensitive.disabilityStatus',
      exact: ['disabilità', 'invalidità'],
      patterns: [/\bdisabilita\b/, /\binvalidita\b/, /\bcategori[ae] protett[ae]\b/],
    },
    {
      field: 'sensitive.veteranStatus',
      exact: ['servizio militare', 'veterano'],
      includes: ['servizio militare'],
    },
    {
      field: 'sensitive.criminalHistory',
      exact: ['casellario giudiziale', 'carichi pendenti'],
      patterns: [
        /\bcasellario giudiziale\b/,
        /\bcarichi pendenti\b/,
        /\bcondann\w*/,
        /\bprecedenti penali\b/,
      ],
    },
    { field: 'sensitive.securityClearance', patterns: [/\bnulla osta di sicurezza\b/] },
    { field: 'sensitive.willingToRelocate', patterns: [/\btrasferir\w*/, /\btrasferimento\b/] },
    { field: 'sensitive.willingToTravel', patterns: [/\bviaggiare\b/, /\btrasferte\b/] },
    { field: 'sensitive.drugTestConsent', patterns: [/\b(?:test|esame) antidroga\b/] },
    {
      field: 'sensitive.backgroundCheckConsent',
      patterns: [/\b(?:verifica|controllo) dei precedenti\b/],
    },
  ],
};

export const LOCALE_PACKS: readonly LocalePack[] = [DE, FR, ES, PT, NL, IT];

export const LOCALE_CODES: ReadonlySet<string> = new Set(LOCALE_PACKS.map((pack) => pack.code));

/** "de-DE" → "de" when that pack exists, otherwise null. */
export function packForLang(lang: string | undefined): LocaleCode | null {
  const primary = (lang ?? '').trim().toLowerCase().split(/[-_]/)[0] ?? '';
  return LOCALE_CODES.has(primary) ? (primary as LocaleCode) : null;
}
