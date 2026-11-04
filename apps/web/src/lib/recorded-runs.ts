// Recorded runs: two scripted conversations that replay in the browser with
// no model call, so they open instantly. The program, dates and quotes are
// fictional examples written for the replay. Each stage is what the agent
// shows after one person action: stage 0 plays on open, every later stage
// plays when the person answers (a typed message or a card button).

export interface RecordedEvent {
  /** Pause before this event, in milliseconds. */
  wait?: number;
  event: Record<string, unknown>;
}

export interface RecordedRun {
  /** The person's opening message, shown as soon as the replay starts. */
  opening: string;
  stages: RecordedEvent[][];
}

const step = (id: string, label: string, wait = 260): RecordedEvent => ({
  wait,
  event: { t: 'status', id, label, state: 'done' },
});
const say = (id: string, text: string, wait = 140): RecordedEvent => ({ wait, event: { t: 'message', id, text } });
const card = (id: string, kind: string, payload: Record<string, unknown>, wait = 140): RecordedEvent => ({
  wait,
  event: { t: 'card', id, kind, payload },
});
const done: RecordedEvent = { wait: 60, event: { t: 'done', runId: 'recorded' } };

const SITE = 'https://northfield.example.edu/graduate-fellowship';

const requirements = {
  documents: [
    {
      name: 'Official transcript',
      limit: 'PDF',
      optional: false,
      confidence: 'high',
      needs_human: false,
      evidence_quote: 'Upload one official transcript from every institution you have attended, as a PDF.',
      source_url: `${SITE}/how-to-apply`,
    },
    {
      name: 'Statement of purpose',
      limit: '1,000 words',
      optional: false,
      confidence: 'high',
      needs_human: false,
      evidence_quote: 'Your statement of purpose must not exceed 1,000 words.',
      source_url: `${SITE}/how-to-apply`,
    },
    {
      name: 'Two recommendation letters',
      limit: null,
      optional: false,
      confidence: 'high',
      needs_human: false,
      evidence_quote: 'Two recommenders submit their letters directly through the portal.',
      source_url: `${SITE}/faq`,
    },
  ],
  eligibility: [
    {
      rule: 'Hold, or be about to complete, a bachelor degree',
      hard: true,
      confidence: 'high',
      needs_human: false,
      evidence_quote: 'Applicants must hold or expect to complete a bachelor degree by August 2027.',
      source_url: `${SITE}/eligibility`,
    },
    {
      rule: 'Minimum GPA of 3.3',
      hard: false,
      confidence: 'medium',
      needs_human: false,
      evidence_quote: 'Successful applicants typically hold a cumulative GPA of 3.3 or above.',
      source_url: `${SITE}/eligibility`,
    },
  ],
};

const boren: RecordedRun = {
  opening: `I want to apply to this: ${SITE}/how-to-apply`,
  stages: [
    [
      step('a-1', 'Reading northfield.example.edu/graduate-fellowship/how-to-apply'),
      step('a-2', 'Reading northfield.example.edu/graduate-fellowship/eligibility'),
      step('a-3', 'Reading northfield.example.edu/graduate-fellowship/faq'),
      card('a-req', 'requirements', requirements, 200),
      say(
        'a-m1',
        'This is the Northfield Graduate Fellowship, a one year funded master\'s award.\n\nApplications close on 15 January 2027 at 11:59 PM Eastern, which is 16 January 2027, 04:59 UTC. That date is still ahead. The 15 October 2026 round has already passed, so January is the one to aim for.\n\nWant me to check how you line up?',
      ),
      done,
    ],
    [
      step('a-4', 'Comparing the rules with your profile', 200),
      card('a-fit', 'fit', {
        title: 'How you match up',
        program: 'Northfield Graduate Fellowship',
        lines_up: ['You finish your degree before August 2027', 'Your field matches the award'],
        stretch: ['A GPA near the 3.3 mark makes this competitive'],
        missing: [],
        biggest_risk: 'The statement of purpose carries a lot of weight, and you have one month to write it.',
        question: 'Want to go for it anyway?',
        options: ["Yes, let's apply", 'Not now'],
      }),
      done,
    ],
    [
      step('a-5', 'Building your plan', 200),
      card('a-plan', 'plan', {
        title: 'Northfield Graduate Fellowship',
        deadlines: ['2027-01-16T04:59:00Z'],
        items: ['Request two recommendation letters', 'Order official transcripts', 'Write the statement of purpose'],
        portalUrl: 'https://northfield.example.edu/apply',
        opensIso: null,
        label: null,
      }),
      say(
        'a-m2',
        'Your plan is ready. It has three reminders for this deadline, the last one three days before it closes.\n\nDownload the calendar file whenever you like, or tell me to start your statement.',
      ),
      done,
    ],
    [
      step('a-6', 'Drafting your statement', 300),
      {
        wait: 160,
        event: {
          t: 'needs_approval',
          gate: 'G5',
          card: {
            kind: 'draft',
            draftKind: 'statement',
            title: 'Statement of purpose',
            version: 1,
            what: 'Keep this draft?',
            body:
              'I have spent three years building low-cost sensors for river monitoring, and the Northfield Graduate Fellowship is the place to turn that work into a research career.\n\n' +
              '[PLACEHOLDER: one sentence on your strongest result]\n\n' +
              'At Northfield I want to study how community data can inform water policy.',
          },
        },
      },
      say('a-m3', 'Here is a first draft with gaps marked for you to fill. Keep it, or tell me what to change.'),
      done,
    ],
    [say('a-m4', 'Kept. Open the Application Pack whenever you are ready to copy answers and email drafts.'), done],
  ],
};

const SITE2 = 'https://harborlab.example.org/internship';

const pasted: RecordedRun = {
  opening:
    'Found this posting, can you check it? Summer Research Internship, Harbor Lab. Open to final year undergraduates. Send a CV, a one page letter and one reference. Applications reviewed on a rolling basis.',
  stages: [
    [
      step('b-1', 'Reading the posting you pasted'),
      step('b-2', 'Reading harborlab.example.org/internship'),
      card('b-req', 'requirements', {
        documents: [
          {
            name: 'CV',
            limit: null,
            optional: false,
            confidence: 'high',
            needs_human: false,
            evidence_quote: 'Send a CV, a one page letter and one reference.',
            source_url: SITE2,
          },
          {
            name: 'One page letter',
            limit: '1 page',
            optional: false,
            confidence: 'high',
            needs_human: false,
            evidence_quote: 'Send a CV, a one page letter and one reference.',
            source_url: SITE2,
          },
        ],
        eligibility: [
          {
            rule: 'Final year undergraduate',
            hard: true,
            confidence: 'high',
            needs_human: false,
            evidence_quote: 'Open to final year undergraduates.',
            source_url: SITE2,
          },
        ],
      }),
      say(
        'b-m1',
        'I matched your posting with the official Harbor Lab page and the details agree. It lists what to send and who can apply, but it publishes no dates.\n\nDo you still want to apply, are you just interested, or do you have the dates from somewhere?',
      ),
      done,
    ],
    [
      say('b-m2', 'Thanks. I will use 15 March 2027 and mark it as coming from you, not verified on their page. I will also remind you to check their page again in a week.'),
      card('b-plan', 'plan', {
        title: 'Harbor Lab Summer Research Internship',
        deadlines: ['2027-03-15T23:59:00Z'],
        items: ['Update your CV', 'Write the one page letter', 'Ask one referee'],
        portalUrl: null,
        opensIso: null,
        label: 'date from you',
      }),
      done,
    ],
    [
      step('b-3', 'Drafting your letter', 300),
      {
        wait: 160,
        event: {
          t: 'needs_approval',
          gate: 'G5',
          card: {
            kind: 'draft',
            draftKind: 'statement',
            title: 'Cover letter',
            version: 1,
            what: 'Keep this draft?',
            body:
              'Dear Harbor Lab team,\n\nI am a final year undergraduate who has spent two years measuring coastal water quality, and I would like to join your summer research programme.\n\n[PLACEHOLDER: the project you are proudest of]\n\nThank you for your time.',
          },
        },
      },
      say('b-m3', 'Here is a first draft. The gap in brackets is for you to fill. Keep it, or tell me what to change.'),
      done,
    ],
    [say('b-m4', 'Kept. Your letter is saved with this chat.'), done],
  ],
};

export const RECORDED_RUNS: Record<string, RecordedRun> = {
  'boren-link': boren,
  'pasted-fit': pasted,
};
