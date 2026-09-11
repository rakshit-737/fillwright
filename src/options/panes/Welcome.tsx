import { useState } from 'react';
import { send } from '@/utils/messaging';
import type { Settings } from '@/types/settings';

interface Step {
  title: string;
  body: string;
  detail?: string;
}

const STEPS: Step[] = [
  {
    title: 'Welcome to Fillwright',
    body: 'Import your resume once, and Fillwright fills job applications for you from a profile that stays on this device.',
    detail: 'Three screens, then you are set up.',
  },
  {
    title: 'Your resume is read here, not uploaded',
    body: 'Fillwright extracts the text and builds your profile entirely inside this browser. The file is never sent to a server.',
    detail:
      'The extension is configured so that it cannot make outbound network requests at all — you can check this yourself under Permissions and in the manifest.',
  },
  {
    title: 'You review everything',
    body: 'Fillwright shows you every value before it writes anything, marks anything it is unsure about, and lets you undo a fill in one click.',
    detail: 'It never overwrites something you typed unless you ask it to.',
  },
  {
    title: 'Some questions are yours alone',
    body: 'Work authorisation, visa status, demographics, salary and background declarations are never guessed from a resume.',
    detail:
      'They stay blank until you answer them in Application preferences — and a blank stays blank on the form rather than becoming an accidental "No".',
  },
  {
    title: 'You always press Submit',
    body: 'Fillwright fills forms. It never clicks Submit or Apply, and never sends an application in the background.',
    detail: 'The final action on any application is always yours.',
  },
];

/**
 * First-run onboarding.
 *
 * Deliberately front-loads the privacy model rather than burying it: someone
 * about to hand an extension their resume should know what it will and will not
 * do before they hand it over, not afterwards.
 */
export function Welcome({ onDone }: { onDone: () => void }) {
  const [index, setIndex] = useState(0);
  const step = STEPS[index]!;
  const isLast = index === STEPS.length - 1;

  const finish = async () => {
    await send<Settings>({ type: 'ui:set-settings', patch: { onboardingCompleted: true } });
    onDone();
  };

  return (
    <div className="fw-pane fw-welcome">
      <div className="fw-welcome__card">
        <ol className="fw-steps" aria-label="Setup progress">
          {STEPS.map((entry, position) => (
            <li
              key={entry.title}
              className={`fw-steps__dot${position === index ? ' fw-steps__dot--on' : ''}${
                position < index ? ' fw-steps__dot--done' : ''
              }`}
              aria-current={position === index ? 'step' : undefined}
            >
              <span className="fw-sr-only">
                Step {position + 1} of {STEPS.length}: {entry.title}
              </span>
            </li>
          ))}
        </ol>

        <h1 className="fw-welcome__title">{step.title}</h1>
        <p className="fw-welcome__body">{step.body}</p>
        {step.detail && <p className="fw-welcome__detail">{step.detail}</p>}

        <div className="fw-actions fw-welcome__actions">
          {index > 0 && (
            <button className="fw-btn" onClick={() => setIndex(index - 1)}>
              Back
            </button>
          )}
          {isLast ? (
            <button
              className="fw-btn fw-btn--primary"
              onClick={() => {
                void finish();
                location.hash = '#/import';
              }}
            >
              Import my resume
            </button>
          ) : (
            <button className="fw-btn fw-btn--primary" onClick={() => setIndex(index + 1)}>
              Next
            </button>
          )}
          <button className="fw-btn fw-welcome__skip" onClick={() => void finish()}>
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
