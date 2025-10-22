export const DEFAULT_EXPECTED_VALUES = {
  email: 'ada@example.org',
  phone: '+1 415-555-2671',
  name: 'Ada Lovelace',
  'given-name': 'Ada',
  'family-name': 'Lovelace',
  organization: 'Analytical Engines Inc.',
  'website-url': 'https://example.org',
  'message.body': "Hello! I'm interested in your product. Could you share more details?"
} as const;

export type OntologyKey = keyof typeof DEFAULT_EXPECTED_VALUES;

export interface FormFixture {
  name: string;
  path: string;
  html: string;
  fields: Partial<Record<OntologyKey, string>>;
  minCandidateCount?: number;
}

const sampleContactHtml = String.raw`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>AIAutoFill Sample Contact</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.5; }
    main { max-width: 640px; margin: 0 auto; }
    form { display: grid; gap: 16px; margin-top: 24px; }
    .field { display: grid; gap: 6px; }
    .field-row { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
    label { font-weight: 600; }
    input, textarea { padding: 10px; font-size: 16px; border: 1px solid #d1d5db; border-radius: 6px; }
    textarea { min-height: 120px; resize: vertical; }
  </style>
</head>
<body>
  <main>
    <h1>Contact our team</h1>
    <p>Reach out with any questions about our platform. We typically respond within one business day.</p>
    <form id="sample-contact-form">
      <div class="field-row">
        <div class="field">
          <label for="firstName">First Name</label>
          <input id="firstName" name="first_name" type="text" placeholder="Ada" autocomplete="given-name" />
        </div>
        <div class="field">
          <label for="lastName">Last Name</label>
          <input id="lastName" name="last_name" type="text" placeholder="Lovelace" autocomplete="family-name" />
        </div>
      </div>
      <div class="field">
        <label for="emailAddress">Email Address</label>
        <input id="emailAddress" name="email" type="email" placeholder="you@example.com" autocomplete="email" />
      </div>
      <div class="field">
        <label for="phoneNumber">Phone</label>
        <input id="phoneNumber" name="phone" type="tel" placeholder="(415) 555-2671" autocomplete="tel" />
      </div>
      <div class="field">
        <label for="message">Your Message</label>
        <textarea id="message" name="message" placeholder="How can we help?" autocomplete="off"></textarea>
      </div>
    </form>
  </main>
</body>
</html>
`;

const reactDemoHtml = String.raw`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>React Profile Demo</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 32px; background: #f8fafc; }
    main { max-width: 720px; margin: 0 auto; background: #fff; padding: 32px; border-radius: 16px; box-shadow: 0 20px 40px rgba(15, 23, 42, 0.08); }
    h1 { margin-top: 0; }
    .field { margin-bottom: 18px; display: flex; flex-direction: column; gap: 6px; }
    label { font-size: 14px; font-weight: 600; color: #1f2937; }
    input { padding: 10px 12px; font-size: 15px; border: 1px solid #cbd5f5; border-radius: 8px; transition: border-color 0.2s ease; }
    input:focus { border-color: #2563eb; outline: none; box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15); }
    pre { background: #0f172a; color: #e2e8f0; padding: 16px; border-radius: 10px; font-size: 13px; }
  </style>
</head>
<body>
  <main>
    <h1>React Controlled Form Demo</h1>
    <p>This form mimics a controlled React component with synthetic events.</p>
    <div id="react-root"></div>
  </main>
  <script>
    const root = document.getElementById('react-root');
    const form = document.createElement('form');
    form.id = 'react-profile-form';
    form.setAttribute('data-react-form', 'true');
    form.addEventListener('submit', (event) => event.preventDefault());

    const state = { firstName: '', lastName: '', email: '', organization: '' };
    const stateViewer = document.createElement('pre');
    stateViewer.id = 'react-state';
    stateViewer.textContent = JSON.stringify(state, null, 2);

    function createControlledInput(config) {
      const wrapper = document.createElement('div');
      wrapper.className = 'field';
      const label = document.createElement('label');
      label.htmlFor = config.id;
      label.textContent = config.label;
      const input = document.createElement('input');
      input.id = config.id;
      input.name = config.name;
      input.type = config.type || 'text';
      if (config.autocomplete) input.setAttribute('autocomplete', config.autocomplete);
      if (config.placeholder) input.placeholder = config.placeholder;
      Object.defineProperty(input, '__reactFiber$e2e', { value: {}, configurable: true });
      Object.defineProperty(input, '__reactProps$e2e', { value: {}, configurable: true });
      input.addEventListener('input', (event) => {
        state[config.name] = event.target.value;
        stateViewer.textContent = JSON.stringify(state, null, 2);
      });
      wrapper.append(label, input);
      return { wrapper, input };
    }

    const first = createControlledInput({
      id: 'react-first-name',
      label: 'First Name',
      name: 'firstName',
      autocomplete: 'given-name',
      placeholder: 'Ada'
    });
    const last = createControlledInput({
      id: 'react-last-name',
      label: 'Last Name',
      name: 'lastName',
      autocomplete: 'family-name',
      placeholder: 'Lovelace'
    });
    const email = createControlledInput({
      id: 'react-email',
      label: 'Email',
      name: 'email',
      type: 'email',
      autocomplete: 'email',
      placeholder: 'ada@example.org'
    });
    const company = createControlledInput({
      id: 'react-company',
      label: 'Company',
      name: 'organization',
      autocomplete: 'organization',
      placeholder: 'Analytical Engines Inc.'
    });

    [first, last, email, company].forEach(({ wrapper }) => form.appendChild(wrapper));
    root.append(form, stateViewer);
    window.reactDemoForm = { form, state };
  </script>
</body>
</html>
`;

const vueDemoHtml = String.raw`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Vue Lead Capture Demo</title>
  <style>
    body { font-family: 'Inter', sans-serif; margin: 36px; background: linear-gradient(135deg, #fdf2f8, #f1f5f9); }
    main { max-width: 700px; margin: 0 auto; background: rgba(255, 255, 255, 0.96); padding: 28px 32px; border-radius: 20px; box-shadow: 0 12px 40px rgba(15, 118, 110, 0.18); }
    h1 { margin-top: 0; }
    .grid { display: grid; gap: 18px; }
    label { display: grid; gap: 6px; font-size: 14px; font-weight: 600; color: #134e4a; }
    input, textarea { border: 1px solid rgba(14, 116, 144, 0.25); border-radius: 10px; padding: 12px; font-size: 15px; background: rgba(255, 255, 255, 0.95); }
    textarea { min-height: 110px; }
  </style>
</head>
<body>
  <main>
    <h1>Vue Appointment Request</h1>
    <p>All fields are driven by a simple Vue-like reactive controller.</p>
    <div id="vue-app"></div>
  </main>
  <script>
    const container = document.getElementById('vue-app');
    const form = document.createElement('form');
    form.id = 'vue-appointment-form';
    form.className = 'grid';
    form.addEventListener('submit', (event) => event.preventDefault());

    const reactive = { fullName: '', phone: '', website: '', message: '' };
    const debug = document.createElement('pre');
    debug.id = 'vue-debug';
    debug.textContent = JSON.stringify(reactive, null, 2);

    function createVueField(config) {
      const label = document.createElement('label');
      label.htmlFor = config.id;
      label.textContent = config.label;
      const input = config.multiLine ? document.createElement('textarea') : document.createElement('input');
      input.id = config.id;
      input.name = config.name;
      if (!config.multiLine) {
        input.type = config.type || 'text';
      }
      if (config.placeholder) input.setAttribute('placeholder', config.placeholder);
      if (config.autocomplete) input.setAttribute('autocomplete', config.autocomplete);
      input.__vueParentComponent = { name: 'DemoComponent' };
      input.addEventListener('input', (event) => {
        reactive[config.name] = event.target.value;
        debug.textContent = JSON.stringify(reactive, null, 2);
      });
      label.append(input);
      return label;
    }

    const nameField = createVueField({
      id: 'vue-full-name',
      label: 'Full Name',
      name: 'fullName',
      placeholder: 'Ada Lovelace',
      autocomplete: 'name'
    });
    const phoneField = createVueField({
      id: 'vue-phone',
      label: 'Preferred Phone',
      name: 'phone',
      type: 'tel',
      placeholder: '+1 415 555 2671',
      autocomplete: 'tel'
    });
    const websiteField = createVueField({
      id: 'vue-website',
      label: 'Company Website',
      name: 'website',
      type: 'url',
      placeholder: 'https://example.org',
      autocomplete: 'url'
    });
    const messageField = createVueField({
      id: 'vue-message',
      label: 'Project Details',
      name: 'message',
      multiLine: true,
      placeholder: 'Share what you would like to build'
    });

    [nameField, phoneField, websiteField, messageField].forEach((field) => form.appendChild(field));
    container.append(form, debug);
    window.vueDemoForm = { reactive };
  </script>
</body>
</html>
`;

const angularDemoHtml = String.raw`
<!DOCTYPE html>
<html lang="en" ng-version="17.1.0">
<head>
  <meta charset="utf-8" />
  <title>Angular Profile Demo</title>
  <style>
    body { font-family: 'Roboto', sans-serif; margin: 30px; background: #f5f5f5; }
    section { max-width: 760px; margin: 0 auto; background: #fff; border-radius: 18px; padding: 28px 32px; box-shadow: 0 18px 36px rgba(0,0,0,0.08); }
    header { margin-bottom: 18px; }
    form { display: grid; gap: 18px; }
    .field { display: grid; gap: 6px; }
    label { font-weight: 600; text-transform: uppercase; font-size: 11px; color: #3f51b5; letter-spacing: 0.04em; }
    input { border: none; border-bottom: 2px solid #c5cae9; padding: 10px 4px; font-size: 15px; transition: border-color 0.2s ease; }
    input:focus { outline: none; border-bottom-color: #3f51b5; }
  </style>
</head>
<body>
  <section>
    <header>
      <h1>Angular Onboarding</h1>
      <p>Simple Angular-like reactive form using plain JavaScript bindings.</p>
    </header>
    <form id="ng-onboarding-form" ng-version="17.1.0">
      <div class="field">
        <label for="ng-first-name">First Name</label>
        <input id="ng-first-name" name="firstName" autocomplete="given-name" data-formcontrolname="firstName" />
      </div>
      <div class="field">
        <label for="ng-email">Email</label>
        <input id="ng-email" name="email" type="email" autocomplete="email" data-formcontrolname="email" />
      </div>
      <div class="field">
        <label for="ng-website">Company Website</label>
        <input id="ng-website" name="website" type="url" autocomplete="url" data-formcontrolname="website" />
      </div>
    </form>
    <pre id="ng-state"></pre>
  </section>
  <script>
    const form = document.getElementById('ng-onboarding-form');
    const stateView = document.getElementById('ng-state');
    const state = { firstName: '', email: '', website: '' };
    stateView.textContent = JSON.stringify(state, null, 2);

    form.addEventListener('input', (event) => {
      const target = event.target;
      if (!target || !target.name) return;
      state[target.name] = target.value;
      stateView.textContent = JSON.stringify(state, null, 2);
    });

    form.addEventListener('change', (event) => {
      const target = event.target;
      if (!target || !target.name) return;
      state[target.name] = target.value;
      stateView.textContent = JSON.stringify(state, null, 2);
    });

    window.angularDemoState = state;
  </script>
</body>
</html>
`;

const legacyFormHtml = String.raw`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Legacy Support Form</title>
  <style>
    body { font-family: Georgia, 'Times New Roman', serif; margin: 40px; background: #faf9f6; }
    table { width: 100%; border-collapse: collapse; max-width: 720px; margin: 0 auto; background: #fff; box-shadow: 0 12px 24px rgba(0,0,0,0.08); }
    td { padding: 14px 16px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
    td.label { width: 30%; font-weight: bold; color: #374151; }
    input, textarea { width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 15px; }
    textarea { min-height: 120px; }
  </style>
</head>
<body>
  <h1 style="text-align:center;">Legacy Support Ticket</h1>
  <table id="legacy-support-form">
    <tr>
      <td class="label">Contact Name</td>
      <td><input id="legacy-name" name="contact_name" placeholder="Contact Name" /></td>
    </tr>
    <tr>
      <td class="label">Contact Email</td>
      <td><input id="legacy-email" name="contact_email" placeholder="user@example.com" /></td>
    </tr>
    <tr>
      <td class="label">Company</td>
      <td><input id="legacy-company" name="company" placeholder="Organization" /></td>
    </tr>
    <tr>
      <td class="label">Issue Details</td>
      <td><textarea id="legacy-message" name="issue_details" placeholder="Describe the issue..."></textarea></td>
    </tr>
  </table>
</body>
</html>
`;

export const FORM_FIXTURES: FormFixture[] = [
  {
    name: 'Sample contact form',
    path: '/sample-contact',
    html: sampleContactHtml,
    fields: {
      'given-name': '#firstName',
      'family-name': '#lastName',
      email: '#emailAddress',
      phone: '#phoneNumber',
      'message.body': '#message'
    },
    minCandidateCount: 4
  },
  {
    name: 'React controlled form',
    path: '/react-demo',
    html: reactDemoHtml,
    fields: {
      'given-name': '#react-first-name',
      'family-name': '#react-last-name',
      email: '#react-email',
      organization: '#react-company'
    },
    minCandidateCount: 4
  },
  {
    name: 'Vue appointment form',
    path: '/vue-demo',
    html: vueDemoHtml,
    fields: {
      name: '#vue-full-name',
      phone: '#vue-phone',
      'website-url': '#vue-website',
      'message.body': '#vue-message'
    },
    minCandidateCount: 4
  },
  {
    name: 'Angular onboarding form',
    path: '/angular-demo',
    html: angularDemoHtml,
    fields: {
      'given-name': '#ng-first-name',
      email: '#ng-email',
      'website-url': '#ng-website'
    },
    minCandidateCount: 3
  },
  {
    name: 'Legacy support form',
    path: '/legacy-support',
    html: legacyFormHtml,
    fields: {
      name: '#legacy-name',
      email: '#legacy-email',
      organization: '#legacy-company',
      'message.body': '#legacy-message'
    },
    minCandidateCount: 4
  }
];

export const ROUTE_MAP: Record<string, string> = FORM_FIXTURES.reduce<Record<string, string>>((acc, fixture) => {
  acc[fixture.path] = fixture.html;
  return acc;
}, {});
