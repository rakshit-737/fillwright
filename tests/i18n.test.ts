import { beforeEach, describe, expect, it } from 'vitest';
import { classifyField, isThirdPartyField } from '@/field-detection/classify';
import { normalizeLabel } from '@/field-detection/normalize';
import { harvestFields } from '@/field-detection/harvest';
import { sameByAlias, normalizeOptionText } from '@/autofill/aliases';
import { matchOption } from '@/autofill/resolve';
import { validateScan } from '@/security/scan-guard';
import type { CanonicalField, FieldSignals } from '@/types/fields';

function signals(overrides: Partial<FieldSignals> = {}): FieldSignals {
  return {
    labelText: '',
    ariaLabel: '',
    ariaDescription: '',
    placeholder: '',
    name: '',
    id: '',
    autocomplete: '',
    inputType: 'text',
    title: '',
    sectionHeading: '',
    precedingText: '',
    optionLabels: [],
    required: false,
    maxLength: null,
    ...overrides,
  };
}

const classify = (lang: string, labelText: string, extra: Partial<FieldSignals> = {}) =>
  classifyField(signals({ lang, labelText, ...extra }));

/** Labels that must be recognised, per locale: [label, expected field, input type?]. */
type Case = [string, CanonicalField, string?];

/** Labels that must NOT be read as the candidate's own field. */
type NotCase = [string, CanonicalField];

const LOCALES: Record<string, { match: Case[]; not: NotCase[] }> = {
  de: {
    match: [
      ['Vorname', 'personal.firstName'],
      ['Nachname', 'personal.lastName'],
      ['E-Mail-Adresse', 'personal.email', 'email'],
      ['Telefonnummer', 'personal.phone', 'tel'],
      ['Straße und Hausnummer', 'address.line1'],
      ['PLZ', 'address.postalCode'],
      ['Wohnort', 'address.city'],
      ['Land', 'address.country'],
      ['Geburtsdatum', 'personal.dateOfBirth'],
      ['Hochschule', 'education.institution'],
      ['Abschluss', 'education.degree'],
      ['Aktueller Arbeitgeber', 'experience.company'],
      ['Lebenslauf', 'documents.resume', 'file'],
      ['Anschreiben', 'documents.coverLetter', 'file'],
      ['Gehaltsvorstellung', 'preferences.desiredSalary'],
      ['Kündigungsfrist', 'preferences.noticePeriod'],
      // safety vocabulary
      ['Geschlecht', 'sensitive.gender'],
      ['Ethnische Herkunft', 'sensitive.raceEthnicity'],
      ['Haben Sie eine Schwerbehinderung?', 'sensitive.disabilityStatus'],
      ['Sind Sie berechtigt, in Deutschland zu arbeiten?', 'sensitive.workAuthorization'],
      ['Benötigen Sie ein Visum-Sponsoring?', 'sensitive.requiresSponsorship'],
      ['Staatsangehörigkeit', 'sensitive.visaStatus'],
      ['Sind Sie vorbestraft?', 'sensitive.criminalHistory'],
      ['Sind Sie umzugsbereit?', 'sensitive.willingToRelocate'],
    ],
    not: [
      ['Vorname der Referenzperson', 'personal.firstName'],
      ['E-Mail des Vorgesetzten', 'personal.email'],
      ['Telefonnummer Notfallkontakt', 'personal.phone'],
      ['E-Mail-Adresse bestätigen', 'personal.email'],
      ['Name des Unternehmens', 'personal.fullName'],
      ['Aktuelles Gehalt', 'preferences.desiredSalary'],
    ],
  },
  fr: {
    match: [
      ['Prénom', 'personal.firstName'],
      ['Nom de famille', 'personal.lastName'],
      ['Adresse e-mail', 'personal.email', 'email'],
      ['Courriel', 'personal.email'],
      ['Numéro de téléphone', 'personal.phone', 'tel'],
      ['Adresse postale', 'address.line1'],
      ['Code postal', 'address.postalCode'],
      ['Ville', 'address.city'],
      ['Pays', 'address.country'],
      ['Date de naissance', 'personal.dateOfBirth'],
      ['Établissement', 'education.institution'],
      ['Diplôme', 'education.degree'],
      ['Employeur actuel', 'experience.company'],
      ['Lettre de motivation', 'documents.coverLetter', 'file'],
      ['Prétentions salariales', 'preferences.desiredSalary'],
      ['Préavis', 'preferences.noticePeriod'],
      ['Sexe', 'sensitive.gender'],
      ['Origine ethnique', 'sensitive.raceEthnicity'],
      ['Êtes-vous en situation de handicap ?', 'sensitive.disabilityStatus'],
      ['Autorisation de travail', 'sensitive.workAuthorization'],
      ['Nationalité', 'sensitive.visaStatus'],
      ['Casier judiciaire', 'sensitive.criminalHistory'],
      ['Mobilité géographique', 'sensitive.willingToRelocate'],
    ],
    not: [
      ['Prénom du référent', 'personal.firstName'],
      ["Courriel de la personne à contacter en cas d'urgence", 'personal.email'],
      ['Téléphone du responsable', 'personal.phone'],
      ["Nom de l'entreprise", 'personal.lastName'],
      ["Nom de l'entreprise", 'personal.fullName'],
      ['Confirmez votre adresse e-mail', 'personal.email'],
      ['Salaire actuel', 'preferences.desiredSalary'],
    ],
  },
  es: {
    match: [
      ['Nombres', 'personal.firstName'],
      ['Apellidos', 'personal.lastName'],
      ['Correo electrónico', 'personal.email', 'email'],
      ['Teléfono', 'personal.phone', 'tel'],
      ['Dirección', 'address.line1'],
      ['Código postal', 'address.postalCode'],
      ['Ciudad', 'address.city'],
      ['País', 'address.country'],
      ['Fecha de nacimiento', 'personal.dateOfBirth'],
      ['Universidad', 'education.institution'],
      ['Empresa actual', 'experience.company'],
      ['Hoja de vida', 'documents.resume', 'file'],
      ['Carta de presentación', 'documents.coverLetter', 'file'],
      ['Expectativa salarial', 'preferences.desiredSalary'],
      ['Género', 'sensitive.gender'],
      ['Origen étnico', 'sensitive.raceEthnicity'],
      ['¿Tiene alguna discapacidad?', 'sensitive.disabilityStatus'],
      ['¿Está autorizado para trabajar en España?', 'sensitive.workAuthorization'],
      ['¿Requiere patrocinio de visa?', 'sensitive.requiresSponsorship'],
      ['Nacionalidad', 'sensitive.visaStatus'],
      ['Antecedentes penales', 'sensitive.criminalHistory'],
    ],
    not: [
      ['Nombre del contacto de emergencia', 'personal.firstName'],
      ['Nombre del contacto de emergencia', 'personal.fullName'],
      ['Correo del reclutador', 'personal.email'],
      ['Estado civil', 'address.state'],
      ['Nombre de la empresa', 'personal.fullName'],
      ['Confirmar correo electrónico', 'personal.email'],
    ],
  },
  pt: {
    match: [
      ['Primeiro nome', 'personal.firstName'],
      ['Sobrenome', 'personal.lastName'],
      ['Nome completo', 'personal.fullName'],
      ['E-mail', 'personal.email', 'email'],
      ['Telefone', 'personal.phone', 'tel'],
      ['Endereço', 'address.line1'],
      ['CEP', 'address.postalCode'],
      ['Cidade', 'address.city'],
      ['País', 'address.country'],
      ['Data de nascimento', 'personal.dateOfBirth'],
      ['Faculdade', 'education.institution'],
      ['Empresa atual', 'experience.company'],
      ['Currículo', 'documents.resume', 'file'],
      ['Pretensão salarial', 'preferences.desiredSalary'],
      ['Gênero', 'sensitive.gender'],
      ['Raça/Cor', 'sensitive.raceEthnicity'],
      ['Você é pessoa com deficiência (PcD)?', 'sensitive.disabilityStatus'],
      ['Autorização de trabalho', 'sensitive.workAuthorization'],
      ['Nacionalidade', 'sensitive.visaStatus'],
      ['Antecedentes criminais', 'sensitive.criminalHistory'],
    ],
    not: [
      ['Nome da referência', 'personal.fullName'],
      ['Telefone do gestor', 'personal.phone'],
      ['E-mail do contato de emergência', 'personal.email'],
      ['Nome da empresa', 'personal.fullName'],
      ['Salário atual', 'preferences.desiredSalary'],
    ],
  },
  nl: {
    match: [
      ['Voornaam', 'personal.firstName'],
      ['Achternaam', 'personal.lastName'],
      ['E-mailadres', 'personal.email', 'email'],
      ['Telefoonnummer', 'personal.phone', 'tel'],
      ['Straat en huisnummer', 'address.line1'],
      ['Postcode', 'address.postalCode'],
      ['Woonplaats', 'address.city'],
      ['Geboortedatum', 'personal.dateOfBirth'],
      ['Hogeschool', 'education.institution'],
      ['Huidige werkgever', 'experience.company'],
      ['Motivatiebrief', 'documents.coverLetter', 'file'],
      ['Gewenst salaris', 'preferences.desiredSalary'],
      ['Opzegtermijn', 'preferences.noticePeriod'],
      ['Geslacht', 'sensitive.gender'],
      ['Etnische achtergrond', 'sensitive.raceEthnicity'],
      ['Heeft u een arbeidsbeperking?', 'sensitive.disabilityStatus'],
      ['Werkvergunning', 'sensitive.workAuthorization'],
      ['Nationaliteit', 'sensitive.visaStatus'],
      ['Heeft u een strafblad?', 'sensitive.criminalHistory'],
    ],
    not: [
      ['Voornaam referentie', 'personal.firstName'],
      ['E-mailadres contactpersoon', 'personal.email'],
      ['Telefoonnummer leidinggevende', 'personal.phone'],
      ['Bedrijfsnaam', 'personal.fullName'],
      ['Huidig salaris', 'preferences.desiredSalary'],
    ],
  },
  it: {
    match: [
      ['Nome', 'personal.firstName'],
      ['Cognome', 'personal.lastName'],
      ['Indirizzo email', 'personal.email', 'email'],
      ['Telefono', 'personal.phone', 'tel'],
      ['Indirizzo di residenza', 'address.line1'],
      ['CAP', 'address.postalCode'],
      ['Città', 'address.city'],
      ['Data di nascita', 'personal.dateOfBirth'],
      ['Università', 'education.institution'],
      ['Titolo di studio', 'education.degree'],
      ['Azienda attuale', 'experience.company'],
      ['Lettera di presentazione', 'documents.coverLetter', 'file'],
      ['RAL desiderata', 'preferences.desiredSalary'],
      ['Preavviso', 'preferences.noticePeriod'],
      ['Sesso', 'sensitive.gender'],
      ['Origine etnica', 'sensitive.raceEthnicity'],
      ['Appartieni alle categorie protette?', 'sensitive.disabilityStatus'],
      ['Permesso di lavoro', 'sensitive.workAuthorization'],
      ['Cittadinanza', 'sensitive.visaStatus'],
      ['Hai condanne penali o carichi pendenti?', 'sensitive.criminalHistory'],
    ],
    not: [
      ['Nome del referente', 'personal.firstName'],
      ['Telefono del responsabile', 'personal.phone'],
      ["Nome dell'azienda", 'personal.firstName'],
      ['Email del contatto di emergenza', 'personal.email'],
      ['RAL attuale', 'preferences.desiredSalary'],
    ],
  },
};

describe('Unicode-aware label normalisation', () => {
  it('folds diacritics instead of splitting words on them', () => {
    expect(normalizeLabel('Prénom')).toBe('prenom');
    expect(normalizeLabel('Straße')).toBe('strasse');
    expect(normalizeLabel('Código postal')).toBe('codigo postal');
    expect(normalizeLabel('Città')).toBe('citta');
    expect(normalizeLabel('Endereço *')).toBe('endereco');
  });

  it('keeps letters of non-Latin scripts rather than erasing them', () => {
    expect(normalizeLabel('Имя')).toBe('имя');
    expect(normalizeLabel('名前 (required)')).toBe('名前');
  });

  it('strips localised required/optional markers', () => {
    expect(normalizeLabel('Prénom (obligatoire)')).toBe('prenom');
    expect(normalizeLabel('Apellidos (opcional)')).toBe('apellidos');
  });

  it('still behaves exactly as before on English labels', () => {
    expect(normalizeLabel('Legal First Name *')).toBe('legal first name');
    expect(normalizeLabel('legalFirstName')).toBe('legal first name');
    expect(normalizeLabel('E-mail Address')).toBe('email');
  });
});

for (const [lang, { match, not }] of Object.entries(LOCALES)) {
  describe(`locale pack: ${lang}`, () => {
    it.each(match)(`recognises "%s" as %s`, (label, field, type) => {
      const result = classify(lang, label, { inputType: type ?? 'text' });
      expect(result.field).toBe(field);
    });

    it.each(not)(`does not read "%s" as %s`, (label, field) => {
      const result = classify(lang, label);
      expect(result.field === field && result.confidence >= 0.5).toBe(false);
    });
  });
}

describe('safety vocabulary ignores the page language', () => {
  // A page that declares the wrong language (or none) must still never have a
  // demographic or referee question treated as an ordinary field.
  it.each([
    ['Geschlecht', 'sensitive.gender'],
    ['Origine ethnique', 'sensitive.raceEthnicity'],
    ['¿Tiene alguna discapacidad?', 'sensitive.disabilityStatus'],
    ['Antecedentes criminais', 'sensitive.criminalHistory'],
    ['Werkvergunning', 'sensitive.workAuthorization'],
    ['Cittadinanza', 'sensitive.visaStatus'],
  ] as const)('recognises "%s" on a page declared as English', (label, field) => {
    expect(classify('en', label).field).toBe(field);
    expect(classify('', label).field).toBe(field);
  });

  it.each([
    'Vorname der Referenzperson',
    'Prénom du référent',
    'Nombre del contacto de emergencia',
    'Telefone do gestor',
    'E-mailadres contactpersoon',
    'Nome del referente',
  ])('flags "%s" as someone else in every language', (label) => {
    expect(isThirdPartyField(signals({ labelText: label, lang: 'en' }))).toBe(true);
  });
});

describe('choosing locale packs', () => {
  it('lets <html lang> settle words that mean different things in different languages', () => {
    // "Nome" is the first name in Italian but the whole name in Portuguese.
    expect(classify('it', 'Nome').field).toBe('personal.firstName');
    const pt = classify('pt-BR', 'Nome');
    expect(pt.field === 'personal.firstName' && pt.confidence >= 0.75).toBe(false);
  });

  it('goes to review, not autofill, when the language is unknown and a word is ambiguous', () => {
    expect(classify('', 'Nome').confidence).toBeLessThan(0.75);
  });

  it('recognises distinctive foreign labels on a page with no usable lang', () => {
    expect(classify('', 'Vorname').field).toBe('personal.firstName');
    expect(classify('en', 'Achternaam').field).toBe('personal.lastName');
  });

  it('does not let a foreign word that is also English hijack an English form', () => {
    // "Note" is the German for a grade; on an English page it is a note.
    expect(classify('en', 'Note').field).not.toBe('education.gpa');
    expect(classify('en', 'Handy').field).not.toBe('personal.phone');
    expect(classify('de', 'Note').field).toBe('education.gpa');
  });

  it('leaves English classification unchanged', () => {
    expect(classify('en', 'First Name').field).toBe('personal.firstName');
    expect(classify('de', 'Email').field).toBe('personal.email');
  });
});

describe('localised option matching', () => {
  it.each([
    ['Ja', 'Nein'],
    ['Oui', 'Non'],
    ['Sí', 'No'],
    ['Sim', 'Não'],
    ['Ja', 'Nee'],
    ['Sì', 'No'],
  ])('matches Yes/No to %s/%s', (yes, no) => {
    const options = [
      { value: 'a', label: yes },
      { value: 'b', label: no },
    ];
    expect(matchOption('Yes', options)?.option.label).toBe(yes);
    expect(matchOption('No', options)?.option.label).toBe(no);
  });

  it('knows month names in every supported language', () => {
    for (const month of ['September', 'Septembre', 'Septiembre', 'Setembro', 'Settembre']) {
      expect(sameByAlias(month, 'Sep')).toBe(true);
    }
    expect(sameByAlias('März', 'March')).toBe(true);
    expect(sameByAlias('Février', 'February')).toBe(true);
    expect(sameByAlias('Mei', 'May')).toBe(true);
    expect(sameByAlias('März', 'May')).toBe(false);
  });

  it('knows country names in every supported language', () => {
    expect(sameByAlias('Deutschland', 'Germany')).toBe(true);
    expect(sameByAlias('Allemagne', 'Germany')).toBe(true);
    expect(sameByAlias('Estados Unidos', 'USA')).toBe(true);
    expect(sameByAlias('Royaume-Uni', 'United Kingdom')).toBe(true);
    expect(sameByAlias('Índia', 'India')).toBe(true);
    expect(sameByAlias('Österreich', 'Austria')).toBe(true);
    expect(sameByAlias('Paesi Bassi', 'Netherlands')).toBe(true);
    expect(sameByAlias('Deutschland', 'Austria')).toBe(false);
  });

  it('folds diacritics in option text', () => {
    expect(normalizeOptionText('España')).toBe('espana');
  });
});

describe('page language reaches the classifier', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('reads the nearest lang attribute for each control', () => {
    document.body.innerHTML =
      '<div lang="de-DE"><label for="a">Vorname</label><input id="a"></div>' +
      '<div lang="fr"><label for="b">Prénom</label><input id="b"></div>';
    const { fields } = harvestFields(document);
    expect(fields.map((field) => field.signals.lang)).toEqual(['de-DE', 'fr']);
  });

  it('keeps a bounded lang through the worker boundary', () => {
    const field = {
      id: 'fw-1',
      kind: 'text',
      signals: { ...signals(), lang: 'de-DE' },
      options: [],
      currentValue: '',
      visible: true,
      order: 0,
      selectorHint: '',
    };
    const ok = validateScan({ fields: [field] });
    expect(ok.ok && ok.scan.fields[0]!.signals.lang).toBe('de-DE');
    const long = validateScan({
      fields: [{ ...field, signals: { ...signals(), lang: 'x'.repeat(500) } }],
    });
    expect(long.ok && long.scan.fields[0]!.signals.lang!.length).toBeLessThanOrEqual(35);
  });
});
