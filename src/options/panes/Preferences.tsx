import { useId, useState } from 'react';
import { useProfile, saveStateLabel } from '../useProfile';
import { CheckField, PlainField, SelectField, TagsField } from '@/components/TrackedField';
import { newId, now } from '@/profile/factory';
import type { Settings } from '@/types/settings';
import type { JobPreferences, TriState } from '@/types/profile';

const COUNTRIES: Array<[string, string]> = [
  ['US', 'United States'],
  ['IN', 'India'],
  ['GB', 'United Kingdom'],
  ['CA', 'Canada'],
  ['AU', 'Australia'],
  ['DE', 'Germany'],
  ['IE', 'Ireland'],
  ['NL', 'Netherlands'],
  ['SG', 'Singapore'],
  ['AE', 'United Arab Emirates'],
];

/**
 * Application preferences, including every high-risk answer.
 *
 * This pane is the ONLY way a value in `profile.sensitive` can ever be set.
 * The resume parser is structurally prevented from writing here (see
 * src/security/sensitive.ts), and autofill refuses to answer any of these
 * questions unless the corresponding value has been set deliberately, below.
 *
 * Everything here defaults to unanswered, and "unanswered" is a real state —
 * distinct from "no" — so a blank stays blank on the form rather than becoming
 * an accidental declaration.
 */
export function Preferences({ settings }: { settings: Settings | null }) {
  const editor = useProfile(settings?.activeProfileId ?? null);
  const { profile, update } = editor;
  const [newCountry, setNewCountry] = useState('US');

  if (editor.loading) {
    return (
      <div className="fw-pane" role="status">
        <span className="fw-spinner" aria-hidden="true" />{' '}
        <span className="fw-muted">Loading…</span>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="fw-pane">
        <h1 className="fw-pane__title">Application preferences</h1>
        <p className="fw-muted">{editor.error || 'No profile is active yet.'}</p>
      </div>
    );
  }

  const { sensitive, preferences } = profile;
  const trackedCountries = Array.from(
    new Set([
      ...Object.keys(sensitive.workAuthorization.authorizedIn),
      ...Object.keys(sensitive.workAuthorization.requiresSponsorship),
    ]),
  );

  const setPreference = <K extends keyof JobPreferences>(key: K, value: JobPreferences[K]) =>
    update((draft) => void (draft.preferences[key] = value));

  const markReviewed = (draft: typeof profile) => {
    draft.sensitive.lastReviewedAt = now();
  };

  return (
    <div className="fw-pane">
      <header className="fw-pane__header">
        <div className="fw-pane__titlerow">
          <h1 className="fw-pane__title">Application preferences</h1>
          <span
            className={`fw-savestate fw-savestate--${editor.saveState}`}
            role="status"
            aria-live="polite"
          >
            {saveStateLabel(editor.saveState)}
          </span>
        </div>
        <p className="fw-pane__subtitle">
          Answers to the questions a resume cannot tell Fillwright. Every one of these is optional,
          and anything you leave unanswered is left blank on the form for you to handle yourself.
        </p>
      </header>

      {/* ------------------------------------------------------ what you want */}
      <section className="fw-section">
        <h2 className="fw-section__title">What you are looking for</h2>
        <div className="fw-grid2">
          <div className="fw-grid2__full">
            <TagsField
              label="Desired job titles"
              values={preferences.desiredTitles}
              placeholder="Software Engineer, Backend Engineer"
              onChange={(values) => setPreference('desiredTitles', values)}
            />
            <TagsField
              label="Industries of interest"
              values={preferences.desiredIndustries}
              onChange={(values) => setPreference('desiredIndustries', values)}
            />
            <TagsField
              label="Employment types"
              values={preferences.employmentTypes}
              placeholder="Full time, Internship"
              onChange={(values) => setPreference('employmentTypes', values)}
            />
          </div>
          <SelectField
            label="Preferred work mode"
            value={preferences.workModePreference}
            options={[
              ['', 'Not specified'],
              ['no-preference', 'No preference'],
              ['onsite', 'On site'],
              ['remote', 'Remote'],
              ['hybrid', 'Hybrid'],
            ]}
            onChange={(value) =>
              setPreference('workModePreference', value as JobPreferences['workModePreference'])
            }
          />
          <PlainField
            label="Earliest start date"
            value={preferences.earliestStartDate}
            placeholder="2026-06 or Immediately"
            onChange={(value) => setPreference('earliestStartDate', value)}
          />
          <PlainField
            label="Notice period"
            value={preferences.noticePeriod}
            placeholder="30 days"
            onChange={(value) => setPreference('noticePeriod', value)}
          />
          <PlainField
            label="Referred by"
            value={preferences.referredBy}
            hint="Filled only when a form asks for a referral."
            onChange={(value) => setPreference('referredBy', value)}
          />
          <PlainField
            label="How did you hear about us?"
            value={preferences.howDidYouHear}
            placeholder="Company website"
            onChange={(value) => setPreference('howDidYouHear', value)}
          />
        </div>
      </section>

      {/* --------------------------------------------------- work authorisation */}
      <section className="fw-section fw-section--sensitive">
        <div className="fw-sensitive__head">
          <h2 className="fw-section__title">Work authorisation</h2>
          <span className="fw-tag fw-tag--muted">Never guessed</span>
        </div>
        <p className="fw-section__lead">
          Fillwright will never infer these from your resume, your name, your university or where
          you live. It answers an authorisation question only if you have answered it here for that
          country, and leaves it blank otherwise.
        </p>

        {trackedCountries.length > 0 && (
          <table className="fw-table fw-table--auth">
            <thead>
              <tr>
                <th scope="col">Country</th>
                <th scope="col">Authorised to work there?</th>
                <th scope="col">Will you need sponsorship?</th>
                <th scope="col">
                  <span className="fw-sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {trackedCountries.map((code) => (
                <tr key={code}>
                  <th scope="row">{COUNTRIES.find(([c]) => c === code)?.[1] ?? code}</th>
                  <td>
                    <TriStateInput
                      name={`auth-${code}`}
                      value={sensitive.workAuthorization.authorizedIn[code] ?? 'unset'}
                      onChange={(value) =>
                        update((draft) => {
                          draft.sensitive.workAuthorization.authorizedIn[code] = value;
                          markReviewed(draft);
                        })
                      }
                    />
                  </td>
                  <td>
                    <TriStateInput
                      name={`spon-${code}`}
                      value={sensitive.workAuthorization.requiresSponsorship[code] ?? 'unset'}
                      onChange={(value) =>
                        update((draft) => {
                          draft.sensitive.workAuthorization.requiresSponsorship[code] = value;
                          markReviewed(draft);
                        })
                      }
                    />
                  </td>
                  <td>
                    <button
                      className="fw-icon-btn fw-icon-btn--danger"
                      aria-label={`Remove answers for ${code}`}
                      onClick={() =>
                        update((draft) => {
                          delete draft.sensitive.workAuthorization.authorizedIn[code];
                          delete draft.sensitive.workAuthorization.requiresSponsorship[code];
                        })
                      }
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="fw-inline-add">
          <select
            className="fw-select"
            value={newCountry}
            aria-label="Country to add"
            onChange={(event) => setNewCountry(event.target.value)}
          >
            {COUNTRIES.filter(([code]) => !trackedCountries.includes(code)).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
          <button
            className="fw-btn fw-btn--sm"
            disabled={trackedCountries.includes(newCountry)}
            onClick={() =>
              update((draft) => {
                draft.sensitive.workAuthorization.authorizedIn[newCountry] = 'unset';
                draft.sensitive.workAuthorization.requiresSponsorship[newCountry] = 'unset';
              })
            }
          >
            Add country
          </button>
        </div>

        <div className="fw-grid2">
          <PlainField
            label="Visa or permit status"
            value={sensitive.workAuthorization.visaStatus}
            placeholder="F-1 OPT, H-1B, Citizen…"
            hint="Filled only when a form asks for it by name."
            onChange={(value) =>
              update((draft) => {
                draft.sensitive.workAuthorization.visaStatus = value;
                markReviewed(draft);
              })
            }
          />
          <PlainField
            label="Notes"
            value={sensitive.workAuthorization.workPermitNotes}
            onChange={(value) =>
              update((draft) => void (draft.sensitive.workAuthorization.workPermitNotes = value))
            }
          />
        </div>
      </section>

      {/* ---------------------------------------------------------- relocation */}
      <section className="fw-section">
        <h2 className="fw-section__title">Relocation and travel</h2>
        <div className="fw-authrow">
          <span className="fw-authrow__label">Willing to relocate?</span>
          <TriStateInput
            name="relocate"
            value={sensitive.relocation.willingToRelocate}
            onChange={(value) =>
              update((draft) => void (draft.sensitive.relocation.willingToRelocate = value))
            }
          />
        </div>
        <div className="fw-authrow">
          <span className="fw-authrow__label">Willing to travel?</span>
          <TriStateInput
            name="travel"
            value={sensitive.relocation.willingToTravel}
            onChange={(value) =>
              update((draft) => void (draft.sensitive.relocation.willingToTravel = value))
            }
          />
        </div>
        <div className="fw-grid2">
          <div className="fw-grid2__full">
            <TagsField
              label="Preferred locations"
              values={sensitive.relocation.preferredLocations}
              onChange={(values) =>
                update((draft) => void (draft.sensitive.relocation.preferredLocations = values))
              }
            />
          </div>
          <PlainField
            label="Travel you would accept"
            value={sensitive.relocation.travelPercentage}
            placeholder="Up to 25%"
            onChange={(value) =>
              update((draft) => void (draft.sensitive.relocation.travelPercentage = value))
            }
          />
        </div>
      </section>

      {/* -------------------------------------------------------- compensation */}
      <section className="fw-section fw-section--sensitive">
        <div className="fw-sensitive__head">
          <h2 className="fw-section__title">Compensation</h2>
          <span className="fw-tag fw-tag--muted">Off by default</span>
        </div>
        <p className="fw-section__lead">
          Salary questions are consequential and in several places employers may not legally ask
          them. Fillwright leaves them blank unless you switch this on.
        </p>
        <CheckField
          label="Let Fillwright answer salary questions"
          checked={sensitive.compensation.shareCompensation}
          onChange={(value) =>
            update((draft) => void (draft.sensitive.compensation.shareCompensation = value))
          }
        />
        {sensitive.compensation.shareCompensation && (
          <div className="fw-grid2">
            <PlainField
              label="Expected salary"
              value={sensitive.compensation.expectedSalary}
              onChange={(value) =>
                update((draft) => void (draft.sensitive.compensation.expectedSalary = value))
              }
            />
            <PlainField
              label="Current salary"
              value={sensitive.compensation.currentSalary}
              hint="You are rarely obliged to answer this one."
              onChange={(value) =>
                update((draft) => void (draft.sensitive.compensation.currentSalary = value))
              }
            />
            <PlainField
              label="Currency"
              value={sensitive.compensation.salaryCurrency}
              placeholder="USD, INR, EUR"
              onChange={(value) =>
                update((draft) => void (draft.sensitive.compensation.salaryCurrency = value))
              }
            />
          </div>
        )}
      </section>

      {/* --------------------------------------------------------- demographics */}
      <section className="fw-section fw-section--sensitive">
        <div className="fw-sensitive__head">
          <h2 className="fw-section__title">Voluntary demographic questions</h2>
          <span className="fw-tag fw-tag--muted">Off by default</span>
        </div>
        <p className="fw-section__lead">
          Many applications ask about gender, race, disability and veteran status for equal
          opportunity reporting. Answering is voluntary, and &ldquo;decline to self-identify&rdquo;
          is always a valid response. Fillwright never derives any of this from your name, your
          photo, your school or your location — it fills these only from what you type here, and
          only if you turn this on.
        </p>
        <CheckField
          label="Let Fillwright answer demographic questions"
          checked={sensitive.demographics.shareDemographics}
          onChange={(value) =>
            update((draft) => void (draft.sensitive.demographics.shareDemographics = value))
          }
        />
        {sensitive.demographics.shareDemographics && (
          <div className="fw-grid2">
            <PlainField
              label="Gender"
              value={sensitive.demographics.gender}
              placeholder="Or “Decline to self-identify”"
              onChange={(value) =>
                update((draft) => void (draft.sensitive.demographics.gender = value))
              }
            />
            <PlainField
              label="Race / ethnicity"
              value={sensitive.demographics.raceEthnicity}
              placeholder="Or “Decline to self-identify”"
              onChange={(value) =>
                update((draft) => void (draft.sensitive.demographics.raceEthnicity = value))
              }
            />
            <PlainField
              label="Disability status"
              value={sensitive.demographics.disabilityStatus}
              placeholder="Or “Decline to self-identify”"
              onChange={(value) =>
                update((draft) => void (draft.sensitive.demographics.disabilityStatus = value))
              }
            />
            <PlainField
              label="Veteran status"
              value={sensitive.demographics.veteranStatus}
              placeholder="Or “Decline to self-identify”"
              onChange={(value) =>
                update((draft) => void (draft.sensitive.demographics.veteranStatus = value))
              }
            />
          </div>
        )}
      </section>

      {/* ----------------------------------------------------------- background */}
      <section className="fw-section fw-section--sensitive">
        <div className="fw-sensitive__head">
          <h2 className="fw-section__title">Background checks and clearance</h2>
          <span className="fw-tag fw-tag--muted">Always confirmed</span>
        </div>
        <p className="fw-section__lead">
          These are legal declarations. Even with an answer saved here, Fillwright asks you to
          confirm it on every application before writing it — it will never tick one of these boxes
          on your behalf unattended.
        </p>
        <div className="fw-authrow">
          <span className="fw-authrow__label">Consent to a background check?</span>
          <TriStateInput
            name="bgcheck"
            value={sensitive.background.backgroundCheckConsent}
            onChange={(value) =>
              update((draft) => void (draft.sensitive.background.backgroundCheckConsent = value))
            }
          />
        </div>
        <div className="fw-authrow">
          <span className="fw-authrow__label">Consent to drug testing?</span>
          <TriStateInput
            name="drugtest"
            value={sensitive.background.drugTestConsent}
            onChange={(value) =>
              update((draft) => void (draft.sensitive.background.drugTestConsent = value))
            }
          />
        </div>
        <div className="fw-authrow">
          <span className="fw-authrow__label">Any criminal convictions to declare?</span>
          <TriStateInput
            name="criminal"
            value={sensitive.background.criminalHistory}
            onChange={(value) =>
              update((draft) => void (draft.sensitive.background.criminalHistory = value))
            }
          />
        </div>
        <div className="fw-grid2">
          <PlainField
            label="Security clearance"
            value={sensitive.background.securityClearance}
            onChange={(value) =>
              update((draft) => void (draft.sensitive.background.securityClearance = value))
            }
          />
        </div>
      </section>

      {/* -------------------------------------------------------- saved answers */}
      <section className="fw-section">
        <div className="fw-section__head">
          <div>
            <h2 className="fw-section__title">Saved answers</h2>
            <p className="fw-field__hint">
              Reusable responses to the essay questions that keep coming up. Fillwright offers these
              as a suggestion — it never drops one into an application without showing you.
            </p>
          </div>
          <button
            className="fw-btn fw-btn--sm"
            onClick={() =>
              update(
                (draft) =>
                  void draft.preferences.savedAnswers.push({
                    id: newId('ans'),
                    key: `answer-${draft.preferences.savedAnswers.length + 1}`,
                    label: '',
                    text: '',
                    updatedAt: now(),
                  }),
              )
            }
          >
            Add answer
          </button>
        </div>

        {preferences.savedAnswers.length === 0 ? (
          <p className="fw-empty">
            No saved answers yet. &ldquo;Why do you want to work here?&rdquo; is a good first one.
          </p>
        ) : (
          preferences.savedAnswers.map((answer, index) => (
            <div className="fw-answer" key={answer.id}>
              <div className="fw-answer__head">
                <input
                  className="fw-input"
                  value={answer.label}
                  placeholder="Question this answers"
                  aria-label={`Saved answer ${index + 1} label`}
                  onChange={(event) =>
                    update((draft) => {
                      const target = draft.preferences.savedAnswers[index];
                      if (target) {
                        target.label = event.target.value;
                        target.updatedAt = now();
                      }
                    })
                  }
                />
                <button
                  className="fw-icon-btn fw-icon-btn--danger"
                  aria-label={`Remove ${answer.label || 'saved answer'}`}
                  onClick={() =>
                    update((draft) => void draft.preferences.savedAnswers.splice(index, 1))
                  }
                >
                  ×
                </button>
              </div>
              <textarea
                className="fw-textarea"
                rows={4}
                value={answer.text}
                placeholder="Your answer…"
                aria-label={`Saved answer ${index + 1} text`}
                onChange={(event) =>
                  update((draft) => {
                    const target = draft.preferences.savedAnswers[index];
                    if (target) {
                      target.text = event.target.value;
                      target.updatedAt = now();
                    }
                  })
                }
              />
            </div>
          ))
        )}
      </section>
    </div>
  );
}

/**
 * Yes / No / Not answered.
 *
 * "Not answered" is the default and is a distinct, meaningful state: it tells
 * autofill to leave the question alone rather than to answer "no".
 */
function TriStateInput({
  name,
  value,
  onChange,
}: {
  name: string;
  value: TriState;
  onChange: (value: TriState) => void;
}) {
  const group = useId();
  const options: Array<[TriState, string]> = [
    ['yes', 'Yes'],
    ['no', 'No'],
    ['unset', 'Not answered'],
  ];
  return (
    <div className="fw-tristate" role="radiogroup" aria-label={name}>
      {options.map(([optionValue, label]) => (
        <label
          className={`fw-tristate__option${value === optionValue ? ' fw-tristate__option--on' : ''}`}
          key={optionValue}
        >
          <input
            type="radio"
            name={`${group}-${name}`}
            checked={value === optionValue}
            onChange={() => onChange(optionValue)}
          />
          <span>{label}</span>
        </label>
      ))}
    </div>
  );
}
