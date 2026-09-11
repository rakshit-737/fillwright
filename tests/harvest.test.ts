import { beforeEach, describe, expect, it } from 'vitest';
import { harvestFields, labelForControl } from '@/field-detection/harvest';
import { classifyField } from '@/field-detection/classify';

function render(html: string): Document {
  document.body.innerHTML = html;
  return document;
}

const fieldByLabel = (label: string) => {
  const { fields } = harvestFields(document);
  return fields.find((field) => field.signals.labelText === label);
};

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('label discovery', () => {
  it('finds a label via for/id', () => {
    render('<label for="a">First Name</label><input id="a">');
    expect(labelForControl(document.querySelector('input')!)).toBe('First Name');
  });

  it('finds a wrapping label without the control text', () => {
    render('<label>Email Address <input type="email" value="typed"></label>');
    expect(labelForControl(document.querySelector('input')!)).toBe('Email Address');
  });

  it('resolves aria-labelledby across several elements', () => {
    render('<span id="x">Expected</span><span id="y">Graduation Date</span><input aria-labelledby="x y">');
    expect(labelForControl(document.querySelector('input')!)).toBe('Expected Graduation Date');
  });

  it('does not return option text as a select label', () => {
    render(`
      <label for="deg">Degree</label>
      <select id="deg"><option>Bachelor</option><option>Master</option></select>
    `);
    expect(labelForControl(document.querySelector('select')!)).toBe('Degree');
  });

  it('handles ids containing CSS-special characters', () => {
    // Enterprise apps (Workday especially) emit ids with colons and brackets.
    // An unescaped selector here throws and loses the label entirely.
    render('<label for="name:field[0].first">First Name</label><input id="name:field[0].first">');
    expect(labelForControl(document.querySelector('input')!)).toBe('First Name');
  });

  it('falls back to a sibling label with no for attribute', () => {
    render('<div><label>Portfolio URL</label><input name="portfolio"></div>');
    expect(labelForControl(document.querySelector('input')!)).toBe('Portfolio URL');
  });
});

describe('control collection', () => {
  it('collects text, select, textarea and file controls', () => {
    render(`
      <label for="a">First Name</label><input id="a">
      <label for="b">Degree</label><select id="b"><option>BS</option></select>
      <label for="c">Summary</label><textarea id="c"></textarea>
      <label for="d">Resume</label><input id="d" type="file">
    `);
    const { fields } = harvestFields(document);
    expect(fields).toHaveLength(4);
    expect(fields.map((f) => f.kind)).toEqual(['text', 'select', 'textarea', 'file']);
  });

  it('never collects password or credential fields', () => {
    render(`
      <label for="p">Password</label><input id="p" type="password">
      <label for="o">One Time Code</label><input id="o" name="otp">
      <label for="s">SSN</label><input id="s" name="ssn">
      <label for="e">Email</label><input id="e" type="email">
    `);
    const { fields } = harvestFields(document);
    expect(fields).toHaveLength(1);
    expect(fields[0]?.signals.labelText).toBe('Email');
  });

  it('skips hidden and submit inputs', () => {
    render(`
      <input type="hidden" name="csrf">
      <input type="submit" value="Apply">
      <label for="a">City</label><input id="a">
    `);
    expect(harvestFields(document).fields).toHaveLength(1);
  });

  it('treats a radio group as one field with its options', () => {
    render(`
      <fieldset>
        <legend>Are you legally authorized to work in the United States?</legend>
        <label><input type="radio" name="auth" value="yes"> Yes</label>
        <label><input type="radio" name="auth" value="no"> No</label>
      </fieldset>
    `);
    const { fields } = harvestFields(document);
    expect(fields).toHaveLength(1);
    expect(fields[0]?.kind).toBe('radio-group');
    expect(fields[0]?.options.map((o) => o.value)).toEqual(['yes', 'no']);
    expect(fields[0]?.signals.labelText).toContain('legally authorized');
  });

  it('reads controls inside an open shadow root', () => {
    render('<div id="host"></div>');
    const host = document.getElementById('host')!;
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<label for="s">GitHub</label><input id="s">';

    const { fields } = harvestFields(document);
    expect(fields.some((field) => field.signals.labelText === 'GitHub')).toBe(true);
  });

  it('ignores its own injected UI', () => {
    render('<div data-fillwright-ui><input id="ours"></div><label for="a">City</label><input id="a">');
    const { fields } = harvestFields(document);
    expect(fields).toHaveLength(1);
    expect(fields[0]?.signals.labelText).toBe('City');
  });
});

describe('existing values', () => {
  it('records that a field already has user-entered data', () => {
    render('<label for="a">First Name</label><input id="a" value="Ada">');
    const field = fieldByLabel('First Name');
    expect(field?.currentValue).toBe('Ada');
    expect(field?.hasExistingValue).toBe(true);
  });

  it('does not treat a select placeholder as a value', () => {
    render(`
      <label for="b">Country</label>
      <select id="b"><option value="">Select…</option><option value="IN">India</option></select>
    `);
    const field = fieldByLabel('Country');
    expect(field?.currentValue).toBe('');
    expect(field?.hasExistingValue).toBe(false);
  });

  it('reads a selected option as a value', () => {
    render(`
      <label for="b">Country</label>
      <select id="b"><option value="">Select…</option><option value="IN" selected>India</option></select>
    `);
    expect(fieldByLabel('Country')?.currentValue).toBe('IN');
  });
});

describe('section headings', () => {
  it('picks up the nearest preceding heading', () => {
    render(`
      <h2>Education</h2>
      <div><label for="a">Start Date</label><input id="a"></div>
    `);
    expect(fieldByLabel('Start Date')?.signals.sectionHeading).toBe('Education');
  });

  it('prefers a fieldset legend over a distant heading', () => {
    render(`
      <h2>Application</h2>
      <fieldset><legend>Work Experience</legend>
        <label for="a">Start Date</label><input id="a">
      </fieldset>
    `);
    expect(fieldByLabel('Start Date')?.signals.sectionHeading).toBe('Work Experience');
  });
});

/**
 * End-to-end through the classifier, on markup shaped like the major applicant
 * tracking systems. These are the layouts the product actually has to work on.
 */
describe('realistic application forms', () => {
  it('reads a Greenhouse-style form', () => {
    render(`
      <form id="application_form">
        <label for="first_name">First Name <span class="required">*</span></label>
        <input type="text" id="first_name" name="job_application[first_name]" autocomplete="given-name">

        <label for="last_name">Last Name <span class="required">*</span></label>
        <input type="text" id="last_name" name="job_application[last_name]" autocomplete="family-name">

        <label for="email">Email <span class="required">*</span></label>
        <input type="email" id="email" name="job_application[email]">

        <label for="phone">Phone</label>
        <input type="tel" id="phone" name="job_application[phone]">

        <label for="resume">Resume/CV</label>
        <input type="file" id="resume" name="job_application[resume]">

        <label for="q_1">LinkedIn Profile</label>
        <input type="text" id="q_1" name="job_application[answers_attributes][0][text_value]">
      </form>
    `);

    const { fields } = harvestFields(document);
    const classified = fields.map((field) => ({
      label: field.signals.labelText,
      ...classifyField(field.signals),
    }));

    const find = (label: string) => classified.find((entry) => entry.label.startsWith(label));
    expect(find('First Name')?.field).toBe('personal.firstName');
    expect(find('Last Name')?.field).toBe('personal.lastName');
    expect(find('Email')?.field).toBe('personal.email');
    expect(find('Phone')?.field).toBe('personal.phone');
    expect(find('Resume')?.field).toBe('documents.resume');
    expect(find('LinkedIn')?.field).toBe('links.linkedin');
    // The opaque Greenhouse question name must not drag confidence down.
    expect(find('LinkedIn')?.confidence).toBeGreaterThan(0.85);
  });

  it('reads a Workday-style form with aria labels and no <label> elements', () => {
    render(`
      <div data-automation-id="legalNameSection">
        <h3 id="h-name">Legal Name</h3>
        <div>
          <span id="l1">First Name</span>
          <input aria-labelledby="l1" data-automation-id="legalNameSection_firstName">
        </div>
        <div>
          <span id="l2">Last Name</span>
          <input aria-labelledby="l2" data-automation-id="legalNameSection_lastName">
        </div>
      </div>
      <div>
        <span id="l3">Email Address</span>
        <input aria-labelledby="l3" type="email">
      </div>
    `);

    const { fields } = harvestFields(document);
    const results = fields.map((field) => classifyField(field.signals).field);
    expect(results).toContain('personal.firstName');
    expect(results).toContain('personal.lastName');
    expect(results).toContain('personal.email');
  });

  it('reads a Lever-style form using name attributes and placeholders', () => {
    render(`
      <form>
        <input name="name" placeholder="Full name" required>
        <input name="email" type="email" placeholder="Email" required>
        <input name="phone" type="tel" placeholder="Phone">
        <input name="org" placeholder="Current company">
        <input name="urls[LinkedIn]" placeholder="LinkedIn URL">
        <input name="urls[GitHub]" placeholder="GitHub URL">
        <input name="urls[Portfolio]" placeholder="Portfolio URL">
      </form>
    `);

    const { fields } = harvestFields(document);
    const byPlaceholder = new Map(
      fields.map((field) => [field.signals.placeholder, classifyField(field.signals)]),
    );

    expect(byPlaceholder.get('Email')?.field).toBe('personal.email');
    expect(byPlaceholder.get('Phone')?.field).toBe('personal.phone');
    expect(byPlaceholder.get('LinkedIn URL')?.field).toBe('links.linkedin');
    expect(byPlaceholder.get('GitHub URL')?.field).toBe('links.github');
    expect(byPlaceholder.get('Portfolio URL')?.field).toBe('links.portfolio');
    expect(byPlaceholder.get('Current company')?.field).toBe('experience.company');
    expect(byPlaceholder.get('Full name')?.field).toBe('personal.fullName');
  });

  it('reads a voluntary disclosure section as sensitive', () => {
    render(`
      <h2>Voluntary Self-Identification</h2>
      <fieldset>
        <legend>Gender</legend>
        <label><input type="radio" name="gender" value="m"> Male</label>
        <label><input type="radio" name="gender" value="f"> Female</label>
        <label><input type="radio" name="gender" value="d"> Decline to self-identify</label>
      </fieldset>
      <fieldset>
        <legend>Are you a protected veteran?</legend>
        <label><input type="radio" name="vet" value="y"> Yes</label>
        <label><input type="radio" name="vet" value="n"> No</label>
      </fieldset>
    `);

    const { fields } = harvestFields(document);
    const results = fields.map((field) => classifyField(field.signals).field);
    expect(results).toContain('sensitive.gender');
    expect(results).toContain('sensitive.veteranStatus');
    expect(results.every((field) => field.startsWith('sensitive.'))).toBe(true);
  });

  it('recognises a custom essay question as needing a written answer', () => {
    render(`
      <label for="q">Why are you interested in this role at our company?</label>
      <textarea id="q"></textarea>
    `);
    const field = harvestFields(document).fields[0]!;
    const result = classifyField(field.signals);
    expect(result.isOpenQuestion).toBe(true);
    expect(result.field).toBe('unknown');
  });
});
