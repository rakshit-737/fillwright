import { useProfile, saveStateLabel } from '../useProfile';
import { EntryList, moveItem } from '@/components/EntryList';
import { CheckField, PlainField, SelectField, TagsField, TrackedField } from '@/components/TrackedField';
import { Readiness } from '@/components/Readiness';
import { newId, provenance } from '@/profile/factory';
import { formatDate } from '@/parser/dates';
import type { Settings } from '@/types/settings';
import type {
  AchievementEntry,
  CertificationEntry,
  EducationEntry,
  ExperienceEntry,
  LanguageEntry,
  ProjectEntry,
  SkillEntry,
} from '@/types/profile';

const userProv = () => provenance('user', 1, 'entered by you');

/**
 * The profile dashboard.
 *
 * Every field shows what it holds, where the value came from and how confident
 * Fillwright was — the user is the only one who can actually verify a parsed
 * value, so the reasoning is always on screen rather than hidden behind a
 * tooltip in a settings page.
 */
export function ProfileEditor({ settings }: { settings: Settings | null }) {
  const editor = useProfile(settings?.activeProfileId ?? null);
  const { profile, update } = editor;

  if (editor.loading) {
    return (
      <div className="fw-pane" role="status" aria-live="polite">
        <span className="fw-spinner" aria-hidden="true" /> <span className="fw-muted">Loading your profile…</span>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="fw-pane">
        <h1 className="fw-pane__title">Profile</h1>
        <p className="fw-muted">
          {editor.error || 'No profile is active yet. Import a resume to create one.'}
        </p>
      </div>
    );
  }

  const status = saveStateLabel(editor.saveState);

  return (
    <div className="fw-pane">
      <header className="fw-pane__header">
        <div className="fw-pane__titlerow">
          <h1 className="fw-pane__title">{profile.name}</h1>
          <span className={`fw-savestate fw-savestate--${editor.saveState}`} role="status" aria-live="polite">
            {status}
          </span>
        </div>
        <p className="fw-pane__subtitle">
          Everything here stays on this device. Edits you make are never replaced by a future resume
          import.
        </p>

        <Readiness
          profile={profile}
          onNavigate={(route) => {
            location.hash = `#/${route}`;
          }}
        />
      </header>

      {/* ---------------------------------------------------------- personal */}
      <section className="fw-section">
        <h2 className="fw-section__title">Personal information</h2>
        <div className="fw-grid2">
          <TrackedField
            label="First name"
            value={profile.personal.firstName}
            important
            onChange={(next) => update((draft) => void (draft.personal.firstName = next))}
          />
          <TrackedField
            label="Last name"
            value={profile.personal.lastName}
            important
            onChange={(next) => update((draft) => void (draft.personal.lastName = next))}
          />
          <TrackedField
            label="Middle name"
            value={profile.personal.middleName}
            onChange={(next) => update((draft) => void (draft.personal.middleName = next))}
          />
          <TrackedField
            label="Preferred name"
            value={profile.personal.preferredName}
            hint="Used when a form asks what you like to be called."
            onChange={(next) => update((draft) => void (draft.personal.preferredName = next))}
          />
          <TrackedField
            label="Full name"
            value={profile.personal.fullName}
            hint="Used when a form has a single name field."
            onChange={(next) => update((draft) => void (draft.personal.fullName = next))}
          />
          <TrackedField
            label="Pronouns"
            value={profile.personal.pronouns}
            hint="Only filled when a form explicitly asks. Never inferred."
            onChange={(next) => update((draft) => void (draft.personal.pronouns = next))}
          />
        </div>
      </section>

      {/* ----------------------------------------------------------- contact */}
      <section className="fw-section">
        <h2 className="fw-section__title">Contact</h2>
        <div className="fw-grid2">
          <TrackedField
            label="Email"
            type="email"
            value={profile.personal.email}
            important
            onChange={(next) => update((draft) => void (draft.personal.email = next))}
          />
          <TrackedField
            label="Phone"
            type="tel"
            value={profile.personal.phone}
            important
            hint="Include the country code if you apply internationally."
            onChange={(next) => update((draft) => void (draft.personal.phone = next))}
          />
          <TrackedField
            label="Alternate email"
            type="email"
            value={profile.personal.alternateEmail}
            onChange={(next) => update((draft) => void (draft.personal.alternateEmail = next))}
          />
        </div>

        <h3 className="fw-subhead">Address</h3>
        <div className="fw-grid2">
          <TrackedField
            label="Street address"
            value={profile.address.line1}
            onChange={(next) => update((draft) => void (draft.address.line1 = next))}
          />
          <TrackedField
            label="Address line 2"
            value={profile.address.line2}
            onChange={(next) => update((draft) => void (draft.address.line2 = next))}
          />
          <TrackedField
            label="City"
            value={profile.address.city}
            important
            onChange={(next) => update((draft) => void (draft.address.city = next))}
          />
          <TrackedField
            label="State or region"
            value={profile.address.state}
            important
            onChange={(next) => update((draft) => void (draft.address.state = next))}
          />
          <TrackedField
            label="Postal code"
            value={profile.address.postalCode}
            onChange={(next) => update((draft) => void (draft.address.postalCode = next))}
          />
          <TrackedField
            label="Country"
            value={profile.address.country}
            important
            onChange={(next) => update((draft) => void (draft.address.country = next))}
          />
        </div>
      </section>

      {/* ------------------------------------------------------------- links */}
      <section className="fw-section">
        <h2 className="fw-section__title">Links</h2>
        <div className="fw-grid2">
          <TrackedField
            label="LinkedIn"
            type="url"
            value={profile.links.linkedin}
            important
            onChange={(next) => update((draft) => void (draft.links.linkedin = next))}
          />
          <TrackedField
            label="GitHub"
            type="url"
            value={profile.links.github}
            onChange={(next) => update((draft) => void (draft.links.github = next))}
          />
          <TrackedField
            label="Portfolio"
            type="url"
            value={profile.links.portfolio}
            onChange={(next) => update((draft) => void (draft.links.portfolio = next))}
          />
          <TrackedField
            label="Personal website"
            type="url"
            value={profile.links.website}
            onChange={(next) => update((draft) => void (draft.links.website = next))}
          />
          <TrackedField
            label="Twitter / X"
            type="url"
            value={profile.links.twitter}
            onChange={(next) => update((draft) => void (draft.links.twitter = next))}
          />
          <TrackedField
            label="Stack Overflow"
            type="url"
            value={profile.links.stackoverflow}
            onChange={(next) => update((draft) => void (draft.links.stackoverflow = next))}
          />
        </div>
      </section>

      {/* ----------------------------------------------------------- summary */}
      <section className="fw-section">
        <h2 className="fw-section__title">Summary</h2>
        <TrackedField
          label="Professional summary"
          value={profile.summary}
          multiline
          hint="Used for “Tell us about yourself” style fields. Fillwright never writes this into an essay question without showing you first."
          onChange={(next) => update((draft) => void (draft.summary = next))}
        />
      </section>

      {/* --------------------------------------------------------- education */}
      <EntryList<EducationEntry>
        title="Education"
        entries={profile.education}
        keyOf={(entry) => entry.id}
        summaryOf={(entry) => ({
          primary: entry.institution,
          secondary: [entry.degree, entry.major, formatDate(entry.graduationDate || entry.endDate)]
            .filter(Boolean)
            .join(' · '),
          provenance: entry.provenance,
        })}
        addLabel="Add education"
        emptyHint="No education entries yet. Applications ask for your institution and graduation date more than almost anything else."
        onAdd={() =>
          update((draft) => {
            draft.education.unshift(emptyEducation());
          })
        }
        onRemove={(index) => update((draft) => void draft.education.splice(index, 1))}
        onMove={(index, direction) =>
          update((draft) => void (draft.education = moveItem(draft.education, index, direction)))
        }
        onUpdate={(index, mutate) =>
          update((draft) => {
            const entry = draft.education[index];
            if (entry) {
              mutate(entry);
              entry.provenance = userProv();
            }
          })
        }
        renderEditor={(entry, set) => (
          <div className="fw-grid2">
            <PlainField
              label="Institution"
              value={entry.institution}
              onChange={(value) => set((draft) => void (draft.institution = value))}
            />
            <PlainField
              label="Degree"
              value={entry.degree}
              placeholder="B.Tech, B.S., M.Sc…"
              onChange={(value) => set((draft) => void (draft.degree = value))}
            />
            <PlainField
              label="Major / field of study"
              value={entry.major}
              onChange={(value) => set((draft) => void (draft.major = value))}
            />
            <PlainField
              label="Minor"
              value={entry.minor}
              onChange={(value) => set((draft) => void (draft.minor = value))}
            />
            <PlainField
              label="Start date"
              value={entry.startDate}
              placeholder="2022-08"
              hint="Year, or year and month."
              onChange={(value) => set((draft) => void (draft.startDate = value))}
            />
            <PlainField
              label="Graduation date"
              value={entry.graduationDate}
              placeholder="2026-05"
              hint="Expected or actual."
              onChange={(value) =>
                set((draft) => {
                  draft.graduationDate = value;
                  draft.endDate = value;
                })
              }
            />
            <PlainField
              label="GPA"
              value={entry.gpa}
              onChange={(value) => set((draft) => void (draft.gpa = value))}
            />
            <PlainField
              label="GPA scale"
              value={entry.gpaScale}
              placeholder="4, 10 or 100"
              hint="So Fillwright can answer “out of” questions correctly."
              onChange={(value) => set((draft) => void (draft.gpaScale = value))}
            />
            <PlainField
              label="Location"
              value={entry.location}
              onChange={(value) => set((draft) => void (draft.location = value))}
            />
            <PlainField
              label="Honours"
              value={entry.honors}
              onChange={(value) => set((draft) => void (draft.honors = value))}
            />
            <div className="fw-grid2__full">
              <TagsField
                label="Relevant coursework"
                values={entry.coursework}
                placeholder="Data Structures, Machine Learning"
                onChange={(values) => set((draft) => void (draft.coursework = values))}
              />
              <CheckField
                label="I am currently studying here"
                checked={entry.current}
                onChange={(value) => set((draft) => void (draft.current = value))}
              />
            </div>
          </div>
        )}
      />

      {/* -------------------------------------------------------- experience */}
      <EntryList<ExperienceEntry>
        title="Experience"
        description="Roles, internships and contract work."
        entries={profile.experience}
        keyOf={(entry) => entry.id}
        summaryOf={(entry) => ({
          primary: entry.title || entry.company,
          secondary: [
            entry.title && entry.company ? entry.company : '',
            entry.current
              ? `${formatDate(entry.startDate)} – Present`
              : [formatDate(entry.startDate), formatDate(entry.endDate)].filter(Boolean).join(' – '),
          ]
            .filter(Boolean)
            .join(' · '),
          provenance: entry.provenance,
        })}
        addLabel="Add experience"
        emptyHint="No roles yet. Add internships and part-time work too — applications count them."
        onAdd={() => update((draft) => void draft.experience.unshift(emptyExperience()))}
        onRemove={(index) => update((draft) => void draft.experience.splice(index, 1))}
        onMove={(index, direction) =>
          update((draft) => void (draft.experience = moveItem(draft.experience, index, direction)))
        }
        onUpdate={(index, mutate) =>
          update((draft) => {
            const entry = draft.experience[index];
            if (entry) {
              mutate(entry);
              entry.provenance = userProv();
            }
          })
        }
        renderEditor={(entry, set) => (
          <div className="fw-grid2">
            <PlainField
              label="Job title"
              value={entry.title}
              onChange={(value) => set((draft) => void (draft.title = value))}
            />
            <PlainField
              label="Company"
              value={entry.company}
              onChange={(value) => set((draft) => void (draft.company = value))}
            />
            <SelectField
              label="Employment type"
              value={entry.employmentType}
              options={[
                ['', 'Not specified'],
                ['full-time', 'Full time'],
                ['part-time', 'Part time'],
                ['internship', 'Internship'],
                ['contract', 'Contract'],
                ['freelance', 'Freelance'],
                ['other', 'Other'],
              ]}
              onChange={(value) =>
                set((draft) => void (draft.employmentType = value as ExperienceEntry['employmentType']))
              }
            />
            <SelectField
              label="Work mode"
              value={entry.locationType}
              options={[
                ['', 'Not specified'],
                ['onsite', 'On site'],
                ['remote', 'Remote'],
                ['hybrid', 'Hybrid'],
              ]}
              onChange={(value) =>
                set((draft) => void (draft.locationType = value as ExperienceEntry['locationType']))
              }
            />
            <PlainField
              label="Location"
              value={entry.location}
              onChange={(value) => set((draft) => void (draft.location = value))}
            />
            <PlainField
              label="Start date"
              value={entry.startDate}
              placeholder="2025-06"
              onChange={(value) => set((draft) => void (draft.startDate = value))}
            />
            <PlainField
              label="End date"
              value={entry.endDate}
              placeholder="2025-08"
              hint="Leave empty if this is your current role."
              onChange={(value) => set((draft) => void (draft.endDate = value))}
            />
            <div className="fw-grid2__full">
              <CheckField
                label="This is my current role"
                checked={entry.current}
                onChange={(value) =>
                  set((draft) => {
                    draft.current = value;
                    if (value) draft.endDate = '';
                  })
                }
              />
              <TagsField
                label="Technologies"
                values={entry.technologies}
                onChange={(values) => set((draft) => void (draft.technologies = values))}
              />
              <PlainField
                label="What you did"
                value={entry.highlights.join('\n')}
                multiline
                rows={5}
                hint="One point per line."
                onChange={(value) =>
                  set((draft) => {
                    draft.highlights = value.split('\n').filter((line) => line.trim());
                    draft.description = value;
                  })
                }
              />
            </div>
          </div>
        )}
      />

      {/* ---------------------------------------------------------- projects */}
      <EntryList<ProjectEntry>
        title="Projects"
        entries={profile.projects}
        keyOf={(entry) => entry.id}
        summaryOf={(entry) => ({
          primary: entry.name,
          secondary: entry.technologies.slice(0, 4).join(', '),
          provenance: entry.provenance,
        })}
        addLabel="Add project"
        emptyHint="No projects yet."
        onAdd={() => update((draft) => void draft.projects.unshift(emptyProject()))}
        onRemove={(index) => update((draft) => void draft.projects.splice(index, 1))}
        onMove={(index, direction) =>
          update((draft) => void (draft.projects = moveItem(draft.projects, index, direction)))
        }
        onUpdate={(index, mutate) =>
          update((draft) => {
            const entry = draft.projects[index];
            if (entry) {
              mutate(entry);
              entry.provenance = userProv();
            }
          })
        }
        renderEditor={(entry, set) => (
          <div className="fw-grid2">
            <PlainField
              label="Project name"
              value={entry.name}
              onChange={(value) => set((draft) => void (draft.name = value))}
            />
            <PlainField
              label="Your role"
              value={entry.role}
              onChange={(value) => set((draft) => void (draft.role = value))}
            />
            <PlainField
              label="Live URL"
              value={entry.url}
              type="url"
              onChange={(value) => set((draft) => void (draft.url = value))}
            />
            <PlainField
              label="Repository"
              value={entry.repositoryUrl}
              type="url"
              onChange={(value) => set((draft) => void (draft.repositoryUrl = value))}
            />
            <div className="fw-grid2__full">
              <TagsField
                label="Technologies"
                values={entry.technologies}
                onChange={(values) => set((draft) => void (draft.technologies = values))}
              />
              <PlainField
                label="Description"
                value={entry.highlights.join('\n')}
                multiline
                rows={4}
                hint="One point per line."
                onChange={(value) =>
                  set((draft) => {
                    draft.highlights = value.split('\n').filter((line) => line.trim());
                    draft.description = value;
                  })
                }
              />
            </div>
          </div>
        )}
      />

      {/* ------------------------------------------------------------ skills */}
      <section className="fw-section">
        <div className="fw-section__head">
          <div>
            <h2 className="fw-section__title">Skills</h2>
            <p className="fw-field__hint">
              Proficiency is blank unless you set it — a resume listing a skill says nothing about
              your level, so Fillwright will not guess one.
            </p>
          </div>
          <button
            className="fw-btn fw-btn--sm"
            onClick={() => update((draft) => void draft.skills.push(emptySkill()))}
          >
            Add skill
          </button>
        </div>

        {profile.skills.length === 0 ? (
          <p className="fw-empty">No skills yet.</p>
        ) : (
          <ul className="fw-skills">
            {profile.skills.map((skill, index) => (
              <li className="fw-skill" key={skill.id}>
                <input
                  className="fw-input fw-skill__name"
                  value={skill.name}
                  aria-label={`Skill ${index + 1} name`}
                  onChange={(event) =>
                    update((draft) => {
                      const target = draft.skills[index];
                      if (target) {
                        target.name = event.target.value;
                        target.provenance = userProv();
                      }
                    })
                  }
                />
                <input
                  className="fw-input fw-skill__category"
                  value={skill.category}
                  placeholder="Category"
                  aria-label={`Skill ${index + 1} category`}
                  onChange={(event) =>
                    update((draft) => {
                      const target = draft.skills[index];
                      if (target) target.category = event.target.value;
                    })
                  }
                />
                <select
                  className="fw-select fw-skill__level"
                  value={skill.proficiency}
                  aria-label={`Skill ${index + 1} proficiency`}
                  onChange={(event) =>
                    update((draft) => {
                      const target = draft.skills[index];
                      if (target) target.proficiency = event.target.value as SkillEntry['proficiency'];
                    })
                  }
                >
                  <option value="">Level not set</option>
                  <option value="beginner">Beginner</option>
                  <option value="intermediate">Intermediate</option>
                  <option value="advanced">Advanced</option>
                  <option value="expert">Expert</option>
                </select>
                <button
                  className="fw-icon-btn fw-icon-btn--danger"
                  aria-label={`Remove ${skill.name || 'skill'}`}
                  onClick={() => update((draft) => void draft.skills.splice(index, 1))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---------------------------------------------------- certifications */}
      <EntryList<CertificationEntry>
        title="Certifications"
        entries={profile.certifications}
        keyOf={(entry) => entry.id}
        summaryOf={(entry) => ({
          primary: entry.name,
          secondary: [entry.issuer, entry.issueDate].filter(Boolean).join(' · '),
          provenance: entry.provenance,
        })}
        addLabel="Add certification"
        emptyHint="No certifications yet."
        onAdd={() => update((draft) => void draft.certifications.unshift(emptyCertification()))}
        onRemove={(index) => update((draft) => void draft.certifications.splice(index, 1))}
        onMove={(index, direction) =>
          update(
            (draft) => void (draft.certifications = moveItem(draft.certifications, index, direction)),
          )
        }
        onUpdate={(index, mutate) =>
          update((draft) => {
            const entry = draft.certifications[index];
            if (entry) {
              mutate(entry);
              entry.provenance = userProv();
            }
          })
        }
        renderEditor={(entry, set) => (
          <div className="fw-grid2">
            <PlainField label="Name" value={entry.name} onChange={(v) => set((d) => void (d.name = v))} />
            <PlainField label="Issuer" value={entry.issuer} onChange={(v) => set((d) => void (d.issuer = v))} />
            <PlainField label="Issued" value={entry.issueDate} placeholder="2025-03" onChange={(v) => set((d) => void (d.issueDate = v))} />
            <PlainField label="Expires" value={entry.expiryDate} onChange={(v) => set((d) => void (d.expiryDate = v))} />
            <PlainField label="Credential ID" value={entry.credentialId} onChange={(v) => set((d) => void (d.credentialId = v))} />
            <PlainField label="Credential URL" type="url" value={entry.credentialUrl} onChange={(v) => set((d) => void (d.credentialUrl = v))} />
          </div>
        )}
      />

      {/* ------------------------------------------------------ achievements */}
      <EntryList<AchievementEntry>
        title="Achievements"
        entries={profile.achievements}
        keyOf={(entry) => entry.id}
        summaryOf={(entry) => ({
          primary: entry.title,
          secondary: entry.date,
          provenance: entry.provenance,
        })}
        addLabel="Add achievement"
        emptyHint="No achievements yet."
        onAdd={() => update((draft) => void draft.achievements.unshift(emptyAchievement()))}
        onRemove={(index) => update((draft) => void draft.achievements.splice(index, 1))}
        onMove={(index, direction) =>
          update((draft) => void (draft.achievements = moveItem(draft.achievements, index, direction)))
        }
        onUpdate={(index, mutate) =>
          update((draft) => {
            const entry = draft.achievements[index];
            if (entry) {
              mutate(entry);
              entry.provenance = userProv();
            }
          })
        }
        renderEditor={(entry, set) => (
          <div className="fw-grid2">
            <PlainField label="Title" value={entry.title} onChange={(v) => set((d) => void (d.title = v))} />
            <PlainField label="Date" value={entry.date} onChange={(v) => set((d) => void (d.date = v))} />
            <PlainField label="Awarded by" value={entry.issuer} onChange={(v) => set((d) => void (d.issuer = v))} />
            <div className="fw-grid2__full">
              <PlainField
                label="Details"
                value={entry.description}
                multiline
                onChange={(v) => set((d) => void (d.description = v))}
              />
            </div>
          </div>
        )}
      />

      {/* --------------------------------------------------------- languages */}
      <EntryList<LanguageEntry>
        title="Languages"
        entries={profile.languages}
        keyOf={(entry) => entry.id}
        summaryOf={(entry) => ({
          primary: entry.name,
          secondary: entry.proficiency || 'level not set',
          provenance: entry.provenance,
        })}
        addLabel="Add language"
        emptyHint="No languages yet."
        onAdd={() => update((draft) => void draft.languages.push(emptyLanguage()))}
        onRemove={(index) => update((draft) => void draft.languages.splice(index, 1))}
        onMove={(index, direction) =>
          update((draft) => void (draft.languages = moveItem(draft.languages, index, direction)))
        }
        onUpdate={(index, mutate) =>
          update((draft) => {
            const entry = draft.languages[index];
            if (entry) {
              mutate(entry);
              entry.provenance = userProv();
            }
          })
        }
        renderEditor={(entry, set) => (
          <div className="fw-grid2">
            <PlainField label="Language" value={entry.name} onChange={(v) => set((d) => void (d.name = v))} />
            <SelectField
              label="Proficiency"
              value={entry.proficiency}
              options={[
                ['', 'Not set'],
                ['basic', 'Basic'],
                ['conversational', 'Conversational'],
                ['professional', 'Professional working'],
                ['fluent', 'Fluent'],
                ['native', 'Native'],
              ]}
              onChange={(v) => set((d) => void (d.proficiency = v as LanguageEntry['proficiency']))}
            />
          </div>
        )}
      />

      {/* ------------------------------------------------------------ custom */}
      <section className="fw-section">
        <div className="fw-section__head">
          <div>
            <h2 className="fw-section__title">Other information</h2>
            <p className="fw-field__hint">
              Anything a form asks for that does not fit above — a candidate ID, a referral code, a
              student number. You can map a site&rsquo;s field to one of these when Fillwright cannot
              identify it.
            </p>
          </div>
          <button
            className="fw-btn fw-btn--sm"
            onClick={() =>
              update((draft) =>
                void draft.custom.push({
                  id: newId('cf'),
                  key: `custom${draft.custom.length + 1}`,
                  label: '',
                  value: '',
                  provenance: userProv(),
                }),
              )
            }
          >
            Add field
          </button>
        </div>

        {profile.custom.length === 0 ? (
          <p className="fw-empty">No custom fields yet.</p>
        ) : (
          <ul className="fw-skills">
            {profile.custom.map((field, index) => (
              <li className="fw-skill" key={field.id}>
                <input
                  className="fw-input fw-skill__name"
                  value={field.label}
                  placeholder="Label, e.g. Candidate ID"
                  aria-label={`Custom field ${index + 1} label`}
                  onChange={(event) =>
                    update((draft) => {
                      const target = draft.custom[index];
                      if (target) target.label = event.target.value;
                    })
                  }
                />
                <input
                  className="fw-input fw-skill__category"
                  value={field.value}
                  placeholder="Value"
                  aria-label={`Custom field ${index + 1} value`}
                  onChange={(event) =>
                    update((draft) => {
                      const target = draft.custom[index];
                      if (target) {
                        target.value = event.target.value;
                        target.provenance = userProv();
                      }
                    })
                  }
                />
                <button
                  className="fw-icon-btn fw-icon-btn--danger"
                  aria-label={`Remove ${field.label || 'custom field'}`}
                  onClick={() => update((draft) => void draft.custom.splice(index, 1))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------- factories */

function emptyEducation(): EducationEntry {
  return {
    id: newId('edu'),
    institution: '',
    degree: '',
    major: '',
    minor: '',
    location: '',
    startDate: '',
    endDate: '',
    graduationDate: '',
    gpa: '',
    gpaScale: '',
    honors: '',
    coursework: [],
    current: false,
    provenance: userProv(),
  };
}

function emptyExperience(): ExperienceEntry {
  return {
    id: newId('exp'),
    company: '',
    title: '',
    employmentType: '',
    location: '',
    locationType: '',
    startDate: '',
    endDate: '',
    current: false,
    description: '',
    highlights: [],
    technologies: [],
    provenance: userProv(),
  };
}

function emptyProject(): ProjectEntry {
  return {
    id: newId('prj'),
    name: '',
    role: '',
    description: '',
    highlights: [],
    technologies: [],
    url: '',
    repositoryUrl: '',
    startDate: '',
    endDate: '',
    provenance: userProv(),
  };
}

function emptySkill(): SkillEntry {
  return {
    id: newId('skl'),
    name: '',
    category: '',
    proficiency: '',
    yearsOfExperience: '',
    provenance: userProv(),
  };
}

function emptyCertification(): CertificationEntry {
  return {
    id: newId('cert'),
    name: '',
    issuer: '',
    issueDate: '',
    expiryDate: '',
    credentialId: '',
    credentialUrl: '',
    provenance: userProv(),
  };
}

function emptyAchievement(): AchievementEntry {
  return {
    id: newId('ach'),
    title: '',
    description: '',
    date: '',
    issuer: '',
    provenance: userProv(),
  };
}

function emptyLanguage(): LanguageEntry {
  return { id: newId('lang'), name: '', proficiency: '', provenance: userProv() };
}
