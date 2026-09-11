import { beforeEach, describe, expect, it } from 'vitest';
import { harvestFields } from '@/field-detection/harvest';
import { classifyField } from '@/field-detection/classify';

/**
 * Regression tests for a bug found only by running the extension in real
 * Chrome: on forms where inputs are direct children of the `<form>` — which is
 * how Greenhouse, Lever and many hand-written forms are built — the "text near
 * this control" signal returned the entire form's text.
 *
 * That had two consequences, the second much worse than the first:
 *
 *  1. Every field carried every other field's wording as evidence.
 *  2. Negative rules saw it too, so a single unrelated "University / College"
 *     field disqualified `personal.firstName` for the whole page. First name,
 *     last name and the resume upload all collapsed onto one wrong field.
 *
 * The fixes: nearby text is now strictly preceding and adjacent, and negative
 * rules only ever see the signals that identify a control.
 */
describe('a field is classified from its own signals, not its neighbours', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  const flatForm = `
    <form>
      <h2>Basic information</h2>
      <label for="first_name">First Name <span>*</span></label>
      <input id="first_name" name="first_name" autocomplete="given-name" />
      <label for="last_name">Last Name <span>*</span></label>
      <input id="last_name" name="last_name" autocomplete="family-name" />
      <label for="resume">Resume/CV</label>
      <input id="resume" type="file" />
      <label for="school">University / College</label>
      <input id="school" name="school" />
      <label for="company">Current Employer</label>
      <input id="company" name="company" />
      <label for="ref">Referee Email Address</label>
      <input id="ref" name="ref" type="email" />
    </form>
  `;

  function classifyAll() {
    document.body.innerHTML = flatForm;
    const { fields } = harvestFields(document);
    return new Map(
      fields.map((field) => [field.signals.labelText.replace(/\s*\*$/, ''), classifyField(field.signals)]),
    );
  }

  it('does not let a neighbouring field disqualify this one', () => {
    const results = classifyAll();
    // "University" and "Employer" appear elsewhere in this form. Before the
    // fix, either was enough to veto the name fields entirely.
    expect(results.get('First Name')?.field).toBe('personal.firstName');
    expect(results.get('Last Name')?.field).toBe('personal.lastName');
  });

  it('still classifies every other field on the same form correctly', () => {
    const results = classifyAll();
    expect(results.get('Resume/CV')?.field).toBe('documents.resume');
    expect(results.get('University / College')?.field).toBe('education.institution');
    expect(results.get('Current Employer')?.field).toBe('experience.company');
  });

  it('keeps negative rules working on the field’s own wording', () => {
    const results = classifyAll();
    // This one must still be rejected — the disqualifier is in its own label.
    expect(results.get('Referee Email Address')?.field).not.toBe('personal.email');
  });

  it('does not hand a field the whole form as nearby text', () => {
    document.body.innerHTML = flatForm;
    const { fields } = harvestFields(document);
    const first = fields.find((field) => field.signals.labelText.startsWith('First Name'));

    expect(first).toBeTruthy();
    const nearby = first!.signals.precedingText;
    expect(nearby.toLowerCase()).not.toContain('university');
    expect(nearby.toLowerCase()).not.toContain('referee');
    expect(nearby.length).toBeLessThan(200);
  });

  it('still captures genuinely adjacent text for label-less controls', () => {
    document.body.innerHTML = `
      <form><div><span>Expected Graduation Date</span><input id="g" /></div></form>
    `;
    const { fields } = harvestFields(document);
    expect(fields[0]?.signals.precedingText).toContain('Expected Graduation Date');
    expect(classifyField(fields[0]!.signals).field).toBe('education.graduationDate');
  });

  it('reads "Location (City)" as the city, not a general location', () => {
    document.body.innerHTML = '<label for="l">Location (City)</label><input id="l" />';
    const { fields } = harvestFields(document);
    expect(classifyField(fields[0]!.signals).field).toBe('address.city');
  });
});
