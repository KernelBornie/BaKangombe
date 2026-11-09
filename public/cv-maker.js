// BaKangombe Professional CV Maker Engine

const CV_TEMPLATES = [
  {
    id: 'executive-prestige',
    name: 'Executive Prestige',
    category: 'Executive',
    columns: 1,
    photoSupport: true,
    bestFor: '10+ years of experience',
    color: '#1e3a8a',
    font: 'Merriweather, serif',
    recommended: true,
    badge: 'RECOMMENDED',
    description: 'Dignified deep navy header banner, gold accent rules, elegant serif typography. Tailored for founders, directors, and executives.'
  },
  {
    id: 'modern-zurich',
    name: 'Modern Zurich',
    category: 'Modern',
    columns: 2,
    photoSupport: true,
    bestFor: '10+ years of experience',
    color: '#0f766e',
    font: 'Inter, sans-serif',
    recommended: true,
    badge: 'POPULAR',
    description: 'Swiss 2-column layout with saturated color sidebar for photo, contact, and skills; spacious right column for career milestones.'
  },
  {
    id: 'emerald-edge',
    name: 'Emerald Edge',
    category: 'Modern',
    columns: 2,
    photoSupport: true,
    bestFor: '10+ years of experience',
    color: '#047857',
    font: 'Inter, sans-serif',
    recommended: true,
    badge: 'EXECUTIVE',
    description: 'Deep forest emerald sidebar with contrasting crisp white cards. Commands immediate recruiter attention.'
  },
  {
    id: 'silicon-valley-tech',
    name: 'Silicon Valley Tech',
    category: 'Technical',
    columns: 2,
    photoSupport: true,
    bestFor: 'Mid to Senior',
    color: '#0284c7',
    font: 'Inter, sans-serif',
    recommended: true,
    badge: 'ENGINEERING',
    description: 'High-tech gradient header, terminal tags, neon-tinted skill badges, and measurable systems metrics.'
  },
  {
    id: 'ruby-executive',
    name: 'Ruby Executive',
    category: 'Executive',
    columns: 1,
    photoSupport: true,
    bestFor: '10+ years of experience',
    color: '#991b1b',
    font: 'Merriweather, serif',
    recommended: true,
    badge: 'RECOMMENDED',
    description: 'Deep burgundy header banner, small-caps section titles, gold rules, luxury caliber for senior directors and founders.'
  },
  {
    id: 'high-impact-lead',
    name: 'High-Impact Lead',
    category: 'Executive',
    columns: 1,
    photoSupport: false,
    bestFor: '10+ years of experience',
    color: '#1e3a8a',
    font: 'Inter, sans-serif',
    recommended: true,
    badge: 'METRICS-FIRST',
    description: 'Starts with prominent colored KPI metric cards (Years Experience, Uptime, Scale, Budget) before career chronology.'
  },
  {
    id: 'creative-portfolio',
    name: 'Creative Portfolio',
    category: 'Creative',
    columns: 2,
    photoSupport: true,
    bestFor: 'Mid to Senior',
    color: '#7c3aed',
    font: 'Outfit, sans-serif',
    recommended: false,
    badge: 'CREATIVE',
    description: 'Vibrant violet-to-indigo gradient banner, circular photo frame with glowing color ring, and creative colored badges.'
  },
  {
    id: 'timeline-flow',
    name: 'Timeline Flow',
    category: 'Creative',
    columns: 1,
    photoSupport: true,
    bestFor: '10+ years of experience',
    color: '#4f46e5',
    font: 'Inter, sans-serif',
    recommended: true,
    badge: 'TIMELINE',
    description: 'Connected career track with saturated milestone nodes along the left margin representing career progression.'
  },
  {
    id: 'corporate-oxford',
    name: 'Corporate Oxford',
    category: 'Corporate',
    columns: 2,
    photoSupport: true,
    bestFor: '10+ years of experience',
    color: '#1e293b',
    font: 'Merriweather, serif',
    recommended: true,
    badge: 'RECOMMENDED',
    description: 'Oxford blue dual-tone header banner with gold/white text and structured two-column colored division.'
  },
  {
    id: 'tokyo-compact',
    name: 'Tokyo Compact',
    category: 'Compact',
    columns: 1,
    photoSupport: true,
    bestFor: '10+ years of experience',
    color: '#2563eb',
    font: 'Inter, sans-serif',
    recommended: true,
    badge: 'HIGH DENSITY',
    description: 'Vibrant colored header band and high-density colored badges, fitting extensive 10+ year career chronologies.'
  },
  {
    id: 'berlin-bold',
    name: 'Berlin Bold',
    category: 'Modern',
    columns: 1,
    photoSupport: true,
    bestFor: 'All levels',
    color: '#dc2626',
    font: 'Inter, sans-serif',
    recommended: false,
    badge: 'BOLD',
    description: 'Thick 8px solid colored left accent bar on all section headings with tinted colored header.'
  },
  {
    id: 'amethyst-signature',
    name: 'Amethyst Signature',
    category: 'Creative',
    columns: 1,
    photoSupport: true,
    bestFor: 'All levels',
    color: '#6b21a8',
    font: 'Outfit, sans-serif',
    recommended: false,
    badge: 'PR & MEDIA',
    description: 'Royal purple top banner, colored quote summary box, and refined purple accent headings.'
  },
  {
    id: 'california-modern',
    name: 'California Modern',
    category: 'Modern',
    columns: 2,
    photoSupport: true,
    bestFor: 'All levels',
    color: '#0d9488',
    font: 'Outfit, sans-serif',
    recommended: false,
    badge: 'STARTUP',
    description: 'Teal/ocean header banner with photo card, gradient skill meters, and modern startup aesthetic.'
  },
  {
    id: 'vibrant-split',
    name: 'Vibrant Split',
    category: 'Modern',
    columns: 2,
    photoSupport: true,
    bestFor: 'Mid to Senior',
    color: '#2563eb',
    font: 'Inter, sans-serif',
    recommended: false,
    badge: 'TWO-TONE',
    description: 'Crisp 38/62 split with intense saturated color sidebar and crisp clean main page.'
  },
  {
    id: 'europass-elite',
    name: 'EuroPass Elite',
    category: 'Corporate',
    columns: 2,
    photoSupport: true,
    bestFor: 'All levels',
    color: '#0369a1',
    font: 'Inter, sans-serif',
    recommended: false,
    badge: 'EUROPEAN',
    description: 'European standard blue header banner, with left date column highlighted with colored background tint.'
  },
  {
    id: 'geneva-banker',
    name: 'Geneva Banker',
    category: 'Executive',
    columns: 1,
    photoSupport: false,
    bestFor: '10+ years of experience',
    color: '#172554',
    font: 'Merriweather, serif',
    recommended: true,
    badge: 'FINANCE',
    description: 'High-prestige centered header with double hairline gold rules, Roman accents, and colored subheaders.'
  },
  {
    id: 'architectural-grid',
    name: 'Architectural Grid',
    category: 'Technical',
    columns: 2,
    photoSupport: true,
    bestFor: 'Mid to Senior',
    color: '#3b82f6',
    font: 'Inter, sans-serif',
    recommended: false,
    badge: 'MODULAR',
    description: 'Grid of colored boxed cards with subtle tinted backgrounds and colored title bars.'
  },
  {
    id: 'engineering-blueprint',
    name: 'Engineering Blueprint',
    category: 'Technical',
    columns: 2,
    photoSupport: true,
    bestFor: '10+ years of experience',
    color: '#1e40af',
    font: 'Inter, sans-serif',
    recommended: true,
    badge: 'STEM',
    description: 'Technical blueprint blue header with technical competency grid and certifications matrix.'
  },
  {
    id: 'stockholm-clean',
    name: 'Stockholm Clean',
    category: 'Minimalist',
    columns: 2,
    photoSupport: true,
    bestFor: 'All levels',
    color: '#475569',
    font: 'Inter, sans-serif',
    recommended: false,
    badge: 'SCANDI',
    description: 'Soft tinted pastel sidebar with vibrant rounded skill pills and harmonious colorful dividers.'
  },
  {
    id: 'ivy-league-classic',
    name: 'Ivy League Classic',
    category: 'Academic',
    columns: 1,
    photoSupport: false,
    bestFor: '10+ years of experience',
    color: '#991b1b',
    font: 'Merriweather, serif',
    recommended: true,
    badge: 'ACADEMIC',
    description: 'Harvard Crimson / Oxford Blue serif header, double-line colored dividers, and small-caps headings.'
  },
  {
    id: 'chartered-professional',
    name: 'Chartered Professional',
    category: 'Corporate',
    columns: 2,
    photoSupport: true,
    bestFor: '10+ years of experience',
    color: '#111827',
    font: 'Merriweather, serif',
    recommended: true,
    badge: 'LEGAL & FINANCE',
    description: 'Midnight obsidian sidebar with vibrant primary colored accent markers and authoritative serif body.'
  },
  {
    id: 'nordic-minimal',
    name: 'Nordic Minimal',
    category: 'Minimalist',
    columns: 1,
    photoSupport: false,
    bestFor: 'All levels',
    color: '#0f766e',
    font: 'Inter, sans-serif',
    recommended: true,
    badge: 'CLEAN',
    description: 'Clean layout with vibrant pastel accent banner, colored section number badges (01, 02, 03), and colored skill chips.'
  }
];

// App State with Bornface Kangombe as the default profile
const state = {
  activeStep: 'heading',
  templateId: 'executive-prestige',
  themeColor: '#1e3a8a',
  fontFamily: 'Merriweather, serif',
  zoom: 0.85,
  heading: {
    firstName: 'Bornface',
    lastName: 'Kangombe',
    title: 'Founder & Principal Systems Architect',
    email: 'bornfacek135@gmail.com',
    phone: '+260 97 123 4567',
    postcode: '50100',
    city: 'Kitwe',
    country: 'Zambia',
    linkedin: 'linkedin.com/in/bornface-kangombe',
    website: 'bakangombe.com',
    photoUrl: ''
  },
  summary: 'Visionary Software Engineer, Systems Architect, and Founder of BaKangombe with over 10 years of cross-industry leadership engineering high-throughput validation engines, distributed microservices, and multi-tenant business platforms. Proven record of architecting scalable cloud backends, cutting system latency by 45%, and directing technical teams across Central and Southern Africa.',
  workHistory: [
    {
      id: 'w1',
      title: 'Founder & Principal Systems Architect',
      company: 'BaKangombe Platform Technologies',
      city: 'Kitwe',
      country: 'Zambia',
      startDate: '2020-01',
      endDate: '',
      current: true,
      bullets: [
        'Founded and engineered the BaKangombe Email Validation, Verification & Multi-Tenant Business API processing millions of monthly requests with 99.98% uptime.',
        'Built custom DNS resolver caches, disposable domain filters, and Hunter company data enrichment pipelines operating at sub-100ms response times.',
        'Designed modular plug-and-play architecture supporting 16+ enterprise suites including Mobile Money, e-commerce, logistics, and invoicing.'
      ]
    },
    {
      id: 'w2',
      title: 'Lead Systems Engineer & Technical Consultant',
      company: 'Copperbelt Enterprise Solutions',
      city: 'Kitwe',
      country: 'Zambia',
      startDate: '2016-04',
      endDate: '2019-12',
      current: false,
      bullets: [
        'Directed end-to-end technical delivery for 18+ commercial client deployments across telecommunications and finance.',
        'Architected secure payment transaction gateways integrating MTN MoMo, Airtel Money, and international card processors.',
        'Mentored a high-performing team of 24 software engineers and DevOps specialists, driving 40% reduction in deployment cycle times.'
      ]
    },
    {
      id: 'w3',
      title: 'Full-Stack Software Engineer',
      company: 'Apex Digital Systems',
      city: 'Lusaka',
      country: 'Zambia',
      startDate: '2013-02',
      endDate: '2016-03',
      current: false,
      bullets: [
        'Engineered responsive web applications and high-concurrency microservices using Node.js, Express, and PostgreSQL.',
        'Optimized SQL query performance and database indexing plans, achieving 55% reduction in latency for data-intensive reports.'
      ]
    }
  ],
  education: [
    {
      id: 'e1',
      degree: 'Bachelor of Science in Computer Science & Software Engineering',
      school: 'Copperbelt University',
      city: 'Kitwe',
      country: 'Zambia',
      gradYear: '2014',
      description: 'First Class Honors. Best Final Year Software Engineering Capstone Project Award.'
    }
  ],
  skills: [
    { name: 'Full-Stack Systems Architecture', level: 'Expert' },
    { name: 'Node.js, Express & TypeScript', level: 'Expert' },
    { name: 'PostgreSQL & Database Optimization', level: 'Expert' },
    { name: 'High-Concurrency Distributed Systems', level: 'Expert' },
    { name: 'API Security, OAuth 2.0 & JWT', level: 'Expert' },
    { name: 'Fintech & Mobile Money Protocols', level: 'Advanced' },
    { name: 'DevOps & Docker Infrastructure', level: 'Advanced' },
    { name: 'Project & Technical Team Leadership', level: 'Expert' }
  ],
  certifications: [
    'AWS Certified Solutions Architect – Professional (2021)',
    'Project Management Professional (PMP) – PMI (2019)',
    'Certified Information Systems Security Professional (CISSP)'
  ],
  languages: 'English (Fluent), Bemba (Native), Swahili (Conversational)',
  references: 'Available upon request'
};

const POPULAR_SKILLS = [
  'Full-Stack Architecture', 'Node.js & TypeScript', 'PostgreSQL', 'API Security & OAuth',
  'Distributed Systems', 'Docker & Kubernetes', 'Mobile Money / Fintech', 'High-Throughput Caching',
  'Project Leadership', 'Cloud Infrastructure', 'Python & Go', 'Microservices'
];

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  try {
    const saved = localStorage.getItem('bakangombe_cv_state');
    if (saved) {
      const parsed = JSON.parse(saved);
      Object.assign(state, parsed);
      console.log('✓ Loaded offline CV state from local storage');
    }
  } catch (err) {
    console.warn('Could not load offline CV state:', err);
  }

  initTemplateSelect();
  initWizardNavigation();
  initDynamicLists();
  initColorSwatches();
  initZoom();
  initTemplatesModal();
  bindInputListeners();
  renderAll();
});

// Populate Template Dropdown
function initTemplateSelect() {
  const select = document.getElementById('selCurrentTemplate');
  if (!select) return;
  select.innerHTML = '';
  CV_TEMPLATES.forEach(tpl => {
    const opt = document.createElement('option');
    opt.value = tpl.id;
    opt.textContent = `${tpl.name} (${tpl.columns} col${tpl.columns > 1 ? 's' : ''})`;
    if (tpl.id === state.templateId) opt.selected = true;
    select.appendChild(opt);
  });
  select.addEventListener('change', (e) => {
    state.templateId = e.target.value;
    const found = CV_TEMPLATES.find(t => t.id === state.templateId);
    if (found) {
      state.themeColor = found.color;
      state.fontFamily = found.font;
      updateActiveSwatch(found.color);
      document.getElementById('selFontFamily').value = found.font;
    }
    renderResume();
  });
}

// Wizard Tab Navigation
function initWizardNavigation() {
  const tabs = document.querySelectorAll('.w-tab');
  const steps = ['heading', 'work', 'education', 'skills', 'summary', 'extras'];

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const step = tab.getAttribute('data-step');
      switchStep(step);
    });
  });

  document.getElementById('btnPrevStep').addEventListener('click', () => {
    const idx = steps.indexOf(state.activeStep);
    if (idx > 0) switchStep(steps[idx - 1]);
  });

  document.getElementById('btnNextStep').addEventListener('click', () => {
    const idx = steps.indexOf(state.activeStep);
    if (idx < steps.length - 1) switchStep(steps[idx + 1]);
    else {
      openTemplatesModal();
    }
  });
}

function switchStep(step) {
  state.activeStep = step;
  document.querySelectorAll('.w-tab').forEach(t => {
    t.classList.toggle('active', t.getAttribute('data-step') === step);
  });
  document.querySelectorAll('.form-step').forEach(s => {
    s.classList.toggle('active', s.id === `step-${step}`);
  });

  const steps = ['heading', 'work', 'education', 'skills', 'summary', 'extras'];
  const idx = steps.indexOf(step);
  const prevBtn = document.getElementById('btnPrevStep');
  const nextBtn = document.getElementById('btnNextStep');

  prevBtn.style.visibility = idx === 0 ? 'hidden' : 'visible';
  if (idx === steps.length - 1) {
    nextBtn.textContent = 'Choose Template (20+) →';
  } else {
    const nextName = steps[idx + 1].charAt(0).toUpperCase() + steps[idx + 1].slice(1);
    nextBtn.textContent = `Next: ${nextName} →`;
  }
}

// Dynamic Lists
function initDynamicLists() {
  renderWorkList();
  renderEduList();
  renderSkills();
  renderPopularSkillChips();

  document.getElementById('btnAddWork').addEventListener('click', () => {
    state.workHistory.push({
      id: 'w_' + Date.now(),
      title: 'New Position',
      company: 'Company Name',
      city: 'Kitwe',
      country: 'Zambia',
      startDate: '',
      endDate: '',
      current: true,
      bullets: ['Describe your major accomplishments and leadership impact here.']
    });
    renderWorkList();
    renderResume();
  });

  document.getElementById('btnAddEdu').addEventListener('click', () => {
    state.education.push({
      id: 'e_' + Date.now(),
      degree: 'Degree Title',
      school: 'University or College Name',
      city: 'Kitwe',
      country: 'Zambia',
      gradYear: '2024',
      description: 'Key academic achievements or honors.'
    });
    renderEduList();
    renderResume();
  });

  document.getElementById('btnAddSkill').addEventListener('click', addCustomSkill);
  document.getElementById('inpNewSkill').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addCustomSkill();
    }
  });

  // Photo upload
  document.getElementById('photoFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        state.heading.photoUrl = event.target.result;
        updatePhotoPreview();
        renderResume();
      };
      reader.readAsDataURL(file);
    }
  });

  document.getElementById('btnRemovePhoto').addEventListener('click', () => {
    state.heading.photoUrl = '';
    updatePhotoPreview();
    renderResume();
  });
}

function updatePhotoPreview() {
  const container = document.getElementById('photoPreview');
  if (state.heading.photoUrl) {
    container.innerHTML = `<img src="${state.heading.photoUrl}" alt="Photo">`;
  } else {
    const initials = (state.heading.firstName[0] || 'B') + (state.heading.lastName[0] || 'K');
    container.innerHTML = `<span id="photoInitials">${initials.toUpperCase()}</span>`;
  }
}

function renderWorkList() {
  const c = document.getElementById('workListContainer');
  c.innerHTML = '';

  state.workHistory.forEach((job, idx) => {
    const card = document.createElement('div');
    card.className = 'item-card';
    card.innerHTML = `
      <div class="item-header">
        <span class="item-header-title">#${idx + 1} ${job.title || 'Position'} – ${job.company || 'Company'}</span>
        <button type="button" class="btn-remove" onclick="removeWork('${job.id}')">✕ Remove</button>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Job Title</label>
          <input type="text" value="${escapeHtml(job.title)}" oninput="updateWork('${job.id}', 'title', this.value)">
        </div>
        <div class="form-group">
          <label>Company / Employer</label>
          <input type="text" value="${escapeHtml(job.company)}" oninput="updateWork('${job.id}', 'company', this.value)">
        </div>
      </div>
      <div class="form-row-3">
        <div class="form-group">
          <label>City & Country</label>
          <input type="text" value="${escapeHtml(job.city + (job.country ? ', ' + job.country : ''))}" placeholder="Kitwe, Zambia" oninput="updateWorkCityCountry('${job.id}', this.value)">
        </div>
        <div class="form-group">
          <label>Start Date</label>
          <input type="text" value="${escapeHtml(job.startDate)}" placeholder="2020-01" oninput="updateWork('${job.id}', 'startDate', this.value)">
        </div>
        <div class="form-group">
          <label>End Date</label>
          <input type="text" value="${escapeHtml(job.current ? 'Present' : job.endDate)}" placeholder="Present or 2023" oninput="updateWorkEndDate('${job.id}', this.value)">
        </div>
      </div>
      <div class="form-group">
        <label>Accomplishments & Bullets (one per line)</label>
        <textarea rows="3" oninput="updateWorkBullets('${job.id}', this.value)">${(job.bullets || []).join('\n')}</textarea>
      </div>
    `;
    c.appendChild(card);
  });
}

window.updateWork = function(id, field, val) {
  const item = state.workHistory.find(w => w.id === id);
  if (item) {
    item[field] = val;
    renderResume();
    updateCompleteness();
  }
};
window.updateWorkCityCountry = function(id, val) {
  const item = state.workHistory.find(w => w.id === id);
  if (item) {
    const parts = val.split(',').map(s => s.trim());
    item.city = parts[0] || '';
    item.country = parts[1] || '';
    renderResume();
  }
};
window.updateWorkEndDate = function(id, val) {
  const item = state.workHistory.find(w => w.id === id);
  if (item) {
    if (val.toLowerCase() === 'present' || val === '') {
      item.current = true;
      item.endDate = '';
    } else {
      item.current = false;
      item.endDate = val;
    }
    renderResume();
  }
};
window.updateWorkBullets = function(id, val) {
  const item = state.workHistory.find(w => w.id === id);
  if (item) {
    item.bullets = val.split('\n').filter(b => b.trim().length > 0);
    renderResume();
    updateCompleteness();
  }
};
window.removeWork = function(id) {
  state.workHistory = state.workHistory.filter(w => w.id !== id);
  renderWorkList();
  renderResume();
  updateCompleteness();
};

function renderEduList() {
  const c = document.getElementById('eduListContainer');
  c.innerHTML = '';

  state.education.forEach((edu, idx) => {
    const card = document.createElement('div');
    card.className = 'item-card';
    card.innerHTML = `
      <div class="item-header">
        <span class="item-header-title">#${idx + 1} ${edu.degree || 'Degree'} – ${edu.school || 'School'}</span>
        <button type="button" class="btn-remove" onclick="removeEdu('${edu.id}')">✕ Remove</button>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Degree / Qualification</label>
          <input type="text" value="${escapeHtml(edu.degree)}" oninput="updateEdu('${edu.id}', 'degree', this.value)">
        </div>
        <div class="form-group">
          <label>School / University</label>
          <input type="text" value="${escapeHtml(edu.school)}" oninput="updateEdu('${edu.id}', 'school', this.value)">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Location (City, Country)</label>
          <input type="text" value="${escapeHtml(edu.city + (edu.country ? ', ' + edu.country : ''))}" oninput="updateEduLocation('${edu.id}', this.value)">
        </div>
        <div class="form-group">
          <label>Graduation Year</label>
          <input type="text" value="${escapeHtml(edu.gradYear)}" oninput="updateEdu('${edu.id}', 'gradYear', this.value)">
        </div>
      </div>
      <div class="form-group">
        <label>Honors / Notes</label>
        <input type="text" value="${escapeHtml(edu.description || '')}" placeholder="e.g. First Class Honours" oninput="updateEdu('${edu.id}', 'description', this.value)">
      </div>
    `;
    c.appendChild(card);
  });
}

window.updateEdu = function(id, field, val) {
  const item = state.education.find(e => e.id === id);
  if (item) {
    item[field] = val;
    renderResume();
    updateCompleteness();
  }
};
window.updateEduLocation = function(id, val) {
  const item = state.education.find(e => e.id === id);
  if (item) {
    const parts = val.split(',').map(s => s.trim());
    item.city = parts[0] || '';
    item.country = parts[1] || '';
    renderResume();
  }
};
window.removeEdu = function(id) {
  state.education = state.education.filter(e => e.id !== id);
  renderEduList();
  renderResume();
  updateCompleteness();
};

function renderSkills() {
  const c = document.getElementById('skillsContainer');
  c.innerHTML = '';
  state.skills.forEach((skill, idx) => {
    const tag = document.createElement('span');
    tag.className = 'skill-tag';
    tag.innerHTML = `
      <span>${escapeHtml(skill.name)}</span>
      <span style="font-size:0.7rem;opacity:0.6;">(${skill.level})</span>
      <span class="skill-tag-del" onclick="removeSkill(${idx})">&times;</span>
    `;
    c.appendChild(tag);
  });
}

function renderPopularSkillChips() {
  const c = document.getElementById('quickSkillChips');
  c.innerHTML = '';
  POPULAR_SKILLS.forEach(name => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'suggestion-chip';
    chip.style.padding = '0.2rem 0.5rem';
    chip.style.fontSize = '0.725rem';
    chip.textContent = `+ ${name}`;
    chip.onclick = () => {
      if (!state.skills.some(s => s.name.toLowerCase() === name.toLowerCase())) {
        state.skills.push({ name, level: 'Advanced' });
        renderSkills();
        renderResume();
        updateCompleteness();
      }
    };
    c.appendChild(chip);
  });
}

function addCustomSkill() {
  const inp = document.getElementById('inpNewSkill');
  const sel = document.getElementById('selSkillLevel');
  const name = inp.value.trim();
  if (!name) return;
  state.skills.push({ name, level: sel.value });
  inp.value = '';
  renderSkills();
  renderResume();
  updateCompleteness();
}

window.removeSkill = function(idx) {
  state.skills.splice(idx, 1);
  renderSkills();
  renderResume();
  updateCompleteness();
};

window.applySummary = function(type) {
  const textarea = document.getElementById('inpSummary');
  if (type === 1) {
    state.summary = 'Visionary Software Engineer, Systems Architect, and Founder of BaKangombe with over 10 years of cross-industry leadership engineering high-throughput validation engines, distributed microservices, and multi-tenant business platforms. Proven record of architecting scalable cloud backends, cutting system latency by 45%, and directing technical teams across Central and Southern Africa.';
  } else if (type === 2) {
    state.summary = 'Dynamic Executive and Operations Director with 12+ years of executive leadership driving business transformation, financial solvency, and high-velocity operational excellence. Adept at scaling multi-million dollar portfolios, forging institutional partnerships, and building culturally cohesive, top-tier leadership teams.';
  } else if (type === 3) {
    state.summary = 'Senior Systems Architect & Full-Stack Cloud Engineer with 10+ years engineering resilient distributed architectures, fintech transaction engines, and high-throughput microservices. Deep expertise in Node.js, Go, Kubernetes, and PostgreSQL, maintaining 99.99% uptime across mission-critical enterprise systems.';
  }
  textarea.value = state.summary;
  renderResume();
  updateCompleteness();
};

// Color Swatches & Picker
function initColorSwatches() {
  const swatches = document.querySelectorAll('.swatch');
  swatches.forEach(s => {
    s.addEventListener('click', () => {
      const color = s.getAttribute('data-color');
      state.themeColor = color;
      updateActiveSwatch(color);
      const cp = document.getElementById('customColorPicker');
      if (cp) cp.value = color;
      renderResume();
    });
  });

  const customPicker = document.getElementById('customColorPicker');
  if (customPicker) {
    customPicker.addEventListener('input', (e) => {
      const color = e.target.value;
      state.themeColor = color;
      updateActiveSwatch(color);
      renderResume();
    });
  }

  document.getElementById('selFontFamily').addEventListener('change', (e) => {
    state.fontFamily = e.target.value;
    renderResume();
  });
}

function updateActiveSwatch(color) {
  document.querySelectorAll('.swatch').forEach(s => {
    s.classList.toggle('active', s.getAttribute('data-color') === color);
  });
}

// Zoom
function initZoom() {
  const sheet = document.getElementById('resumeCanvas');
  const text = document.getElementById('zoomLevelText');

  document.getElementById('btnZoomIn').addEventListener('click', () => {
    if (state.zoom < 1.2) {
      state.zoom += 0.05;
      sheet.style.transform = `scale(${state.zoom.toFixed(2)})`;
      text.textContent = `${Math.round(state.zoom * 100)}%`;
    }
  });

  document.getElementById('btnZoomOut').addEventListener('click', () => {
    if (state.zoom > 0.5) {
      state.zoom -= 0.05;
      sheet.style.transform = `scale(${state.zoom.toFixed(2)})`;
      text.textContent = `${Math.round(state.zoom * 100)}%`;
    }
  });
}

// Bind Inputs
function bindInputListeners() {
  const bind = (id, obj, prop) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', (e) => {
      obj[prop] = e.target.value;
      if (prop === 'firstName' || prop === 'lastName') updatePhotoPreview();
      renderResume();
      updateCompleteness();
    });
  };

  bind('inpFirstName', state.heading, 'firstName');
  bind('inpLastName', state.heading, 'lastName');
  bind('inpTitle', state.heading, 'title');
  bind('inpEmail', state.heading, 'email');
  bind('inpPhone', state.heading, 'phone');
  bind('inpCity', state.heading, 'city');
  bind('inpPostcode', state.heading, 'postcode');
  bind('inpCountry', state.heading, 'country');
  bind('inpLinkedin', state.heading, 'linkedin');
  bind('inpWebsite', state.heading, 'website');
  bind('inpSummary', state, 'summary');
  bind('inpLanguages', state, 'languages');
  bind('inpReferences', state, 'references');

  document.getElementById('inpCertifications').addEventListener('input', (e) => {
    state.certifications = e.target.value.split('\n').filter(c => c.trim().length > 0);
    renderResume();
  });

  // Action Buttons
  document.getElementById('btnPrintPdf').addEventListener('click', () => {
    window.print();
  });

  const btnBornface = document.getElementById('btnLoadSampleBornface') || document.getElementById('btnLoadSampleGrace');
  if (btnBornface) {
    btnBornface.addEventListener('click', () => {
      loadBornfaceSample();
    });
  }

  document.getElementById('btnLoadSampleTech').addEventListener('click', () => {
    loadTechSample();
  });

  document.getElementById('btnResetForm').addEventListener('click', () => {
    if (confirm('Are you sure you want to reset all fields and start fresh?')) {
      resetToBlank();
    }
  });
}

// Samples
function loadBornfaceSample() {
  state.heading = {
    firstName: 'Bornface',
    lastName: 'Kangombe',
    title: 'Founder & Principal Systems Architect',
    email: 'bornfacek135@gmail.com',
    phone: '+260 97 123 4567',
    postcode: '50100',
    city: 'Kitwe',
    country: 'Zambia',
    linkedin: 'linkedin.com/in/bornface-kangombe',
    website: 'bakangombe.com',
    photoUrl: ''
  };
  state.summary = 'Visionary Software Engineer, Systems Architect, and Founder of BaKangombe with over 10 years of cross-industry leadership engineering high-throughput validation engines, distributed microservices, and multi-tenant business platforms. Proven record of architecting scalable cloud backends, cutting system latency by 45%, and directing technical teams across Central and Southern Africa.';
  state.workHistory = [
    {
      id: 'w1',
      title: 'Founder & Principal Systems Architect',
      company: 'BaKangombe Platform Technologies',
      city: 'Kitwe',
      country: 'Zambia',
      startDate: '2020-01',
      endDate: '',
      current: true,
      bullets: [
        'Founded and engineered the BaKangombe Email Validation, Verification & Multi-Tenant Business API processing millions of monthly requests with 99.98% uptime.',
        'Built custom DNS resolver caches, disposable domain filters, and Hunter company data enrichment pipelines operating at sub-100ms response times.',
        'Designed modular plug-and-play architecture supporting 16+ enterprise suites including Mobile Money, e-commerce, logistics, and invoicing.'
      ]
    },
    {
      id: 'w2',
      title: 'Lead Systems Engineer & Technical Consultant',
      company: 'Copperbelt Enterprise Solutions',
      city: 'Kitwe',
      country: 'Zambia',
      startDate: '2016-04',
      endDate: '2019-12',
      current: false,
      bullets: [
        'Directed end-to-end technical delivery for 18+ commercial client deployments across telecommunications and finance.',
        'Architected secure payment transaction gateways integrating MTN MoMo, Airtel Money, and international card processors.',
        'Mentored a high-performing team of 24 software engineers and DevOps specialists, driving 40% reduction in deployment cycle times.'
      ]
    },
    {
      id: 'w3',
      title: 'Full-Stack Software Engineer',
      company: 'Apex Digital Systems',
      city: 'Lusaka',
      country: 'Zambia',
      startDate: '2013-02',
      endDate: '2016-03',
      current: false,
      bullets: [
        'Engineered responsive web applications and high-concurrency microservices using Node.js, Express, and PostgreSQL.',
        'Optimized SQL query performance and database indexing plans, achieving 55% reduction in latency for data-intensive reports.'
      ]
    }
  ];
  state.skills = [
    { name: 'Full-Stack Systems Architecture', level: 'Expert' },
    { name: 'Node.js, Express & TypeScript', level: 'Expert' },
    { name: 'PostgreSQL & Database Optimization', level: 'Expert' },
    { name: 'High-Concurrency Distributed Systems', level: 'Expert' },
    { name: 'API Security, OAuth 2.0 & JWT', level: 'Expert' },
    { name: 'Fintech & Mobile Money Protocols', level: 'Advanced' },
    { name: 'DevOps & Docker Infrastructure', level: 'Advanced' },
    { name: 'Project & Technical Team Leadership', level: 'Expert' }
  ];
  state.templateId = 'executive-prestige';
  state.themeColor = '#1e3a8a';
  state.fontFamily = 'Merriweather, serif';
  syncFormInputs();
  renderAll();
}

function loadTechSample() {
  state.heading = {
    firstName: 'Bornface',
    lastName: 'Kangombe',
    title: 'Principal Software Engineer & Cloud Architect',
    email: 'bornface.tech@bakangombe.com',
    phone: '+260 97 555 0199',
    postcode: '10101',
    city: 'Kitwe',
    country: 'Zambia',
    linkedin: 'linkedin.com/in/bornface-kangombe',
    website: 'github.com/KernelBornie',
    photoUrl: ''
  };
  state.summary = 'Senior Cloud Architect & Full-Stack Systems Engineer with 10+ years designing high-throughput distributed microservices, fintech payment gateways, and fault-tolerant cloud backends. Architected platforms serving 4M+ daily active transactions with 99.995% SLA. Expert in Node.js, TypeScript, Golang, PostgreSQL, Kafka, and Kubernetes.';
  state.templateId = 'silicon-valley-tech';
  state.themeColor = '#0284c7';
  state.fontFamily = 'Inter, sans-serif';
  syncFormInputs();
  renderAll();
}

function resetToBlank() {
  state.heading = {
    firstName: '',
    lastName: '',
    title: '',
    email: '',
    phone: '',
    postcode: '',
    city: '',
    country: '',
    linkedin: '',
    website: '',
    photoUrl: ''
  };
  state.summary = '';
  state.workHistory = [];
  state.education = [];
  state.skills = [];
  state.certifications = [];
  state.languages = '';
  syncFormInputs();
  renderAll();
}

function syncFormInputs() {
  document.getElementById('inpFirstName').value = state.heading.firstName || '';
  document.getElementById('inpLastName').value = state.heading.lastName || '';
  document.getElementById('inpTitle').value = state.heading.title || '';
  document.getElementById('inpEmail').value = state.heading.email || '';
  document.getElementById('inpPhone').value = state.heading.phone || '';
  document.getElementById('inpCity').value = state.heading.city || '';
  document.getElementById('inpPostcode').value = state.heading.postcode || '';
  document.getElementById('inpCountry').value = state.heading.country || '';
  document.getElementById('inpLinkedin').value = state.heading.linkedin || '';
  document.getElementById('inpWebsite').value = state.heading.website || '';
  document.getElementById('inpSummary').value = state.summary || '';
  document.getElementById('inpLanguages').value = state.languages || '';
  document.getElementById('inpCertifications').value = (state.certifications || []).join('\n');
  document.getElementById('selCurrentTemplate').value = state.templateId;
  document.getElementById('selFontFamily').value = state.fontFamily;
  updateActiveSwatch(state.themeColor);
  const cp = document.getElementById('customColorPicker');
  if (cp) cp.value = state.themeColor;
  updatePhotoPreview();
}

function renderAll() {
  renderWorkList();
  renderEduList();
  renderSkills();
  renderResume();
  updateCompleteness();
}

// Completeness Calculator
function updateCompleteness() {
  let score = 0;
  const h = state.heading;
  if (h.firstName && h.lastName) score += 10;
  if (h.title) score += 5;
  if (h.email && h.phone) score += 10;
  if (h.city || h.country) score += 5;
  if (state.summary && state.summary.length > 40) score += 15;
  if (state.workHistory.length > 0) {
    score += 20;
    if (state.workHistory.length >= 2) score += 10;
  }
  if (state.education.length > 0) score += 15;
  if (state.skills.length >= 3) score += 10;

  score = Math.min(100, score);
  document.getElementById('completenessFill').style.width = `${score}%`;
  document.getElementById('completenessScore').textContent = `${score}%`;
}

// Templates Modal & Gallery Logic
let currentFilter = { exp: 'all', photo: 'all', col: 'all' };

function initTemplatesModal() {
  const modal = document.getElementById('templatesModal');
  document.getElementById('btnOpenTemplates').addEventListener('click', openTemplatesModal);
  document.getElementById('btnCloseTemplatesModal').addEventListener('click', closeTemplatesModal);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeTemplatesModal();
  });

  setupButtonGroup('filterExpGroup', 'data-exp', (val) => { currentFilter.exp = val; renderGalleryGrid(); });
  setupButtonGroup('filterPhotoGroup', 'data-photo', (val) => { currentFilter.photo = val; renderGalleryGrid(); });
  setupButtonGroup('filterColGroup', 'data-col', (val) => { currentFilter.col = val; renderGalleryGrid(); });
}

function setupButtonGroup(groupId, attr, cb) {
  const group = document.getElementById(groupId);
  if (!group) return;
  const btns = group.querySelectorAll('.filter-btn');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      cb(btn.getAttribute(attr));
    });
  });
}

function openTemplatesModal() {
  renderGalleryGrid();
  document.getElementById('templatesModal').classList.add('open');
}

function closeTemplatesModal() {
  document.getElementById('templatesModal').classList.remove('open');
}

function renderGalleryGrid() {
  const grid = document.getElementById('templatesGrid');
  grid.innerHTML = '';

  const filtered = CV_TEMPLATES.filter(tpl => {
    if (currentFilter.exp !== 'all' && tpl.bestFor !== currentFilter.exp && tpl.bestFor !== 'All levels') return false;
    if (currentFilter.photo === 'with' && !tpl.photoSupport) return false;
    if (currentFilter.photo === 'without' && tpl.photoSupport && tpl.columns === 2) return false;
    if (currentFilter.col !== 'all' && String(tpl.columns) !== String(currentFilter.col)) return false;
    return true;
  });

  filtered.forEach(tpl => {
    const card = document.createElement('div');
    card.className = `template-card ${tpl.id === state.templateId ? 'active-tpl' : ''}`;
    card.onclick = () => {
      state.templateId = tpl.id;
      state.themeColor = tpl.color;
      state.fontFamily = tpl.font;
      document.getElementById('selCurrentTemplate').value = tpl.id;
      document.getElementById('selFontFamily').value = tpl.font;
      updateActiveSwatch(tpl.color);
      const cp = document.getElementById('customColorPicker');
      if (cp) cp.value = tpl.color;
      renderResume();
      closeTemplatesModal();
    };

    const is2Col = tpl.columns === 2;
    card.innerHTML = `
      <div class="tpl-preview-box">
        ${tpl.recommended ? `<span class="tpl-rec-badge">${tpl.badge || 'RECOMMENDED'}</span>` : ''}
        <div class="tpl-mock-wireframe">
          ${is2Col ? `
            <div style="width:34%;background:linear-gradient(180deg, ${tpl.color}, #0f172a);padding:8px;display:flex;flex-direction:column;gap:5px;">
              ${tpl.photoSupport ? `<div style="width:26px;height:26px;border-radius:50%;background:#ffffff;margin:0 auto 4px;border:2px solid rgba(255,255,255,0.8);"></div>` : ''}
              <div style="height:4px;width:75%;background:#ffffff;border-radius:2px;"></div>
              <div style="height:3px;width:55%;background:rgba(255,255,255,0.7);border-radius:2px;"></div>
              <div style="height:3px;width:85%;background:rgba(255,255,255,0.6);border-radius:2px;"></div>
              <div style="height:3px;width:65%;background:rgba(255,255,255,0.6);border-radius:2px;"></div>
            </div>
            <div style="flex:1;background:#fff;padding:8px;display:flex;flex-direction:column;gap:6px;">
              <div style="height:8px;width:65%;background:#0f172a;border-radius:2px;"></div>
              <div style="height:5px;width:40%;background:${tpl.color};border-radius:2px;"></div>
              <div style="height:2px;width:100%;background:${tpl.color};margin:2px 0;"></div>
              <div style="height:4px;width:95%;background:#cbd5e1;border-radius:2px;"></div>
              <div style="height:4px;width:85%;background:#cbd5e1;border-radius:2px;"></div>
              <div style="height:6px;width:45%;background:${tpl.color};border-radius:2px;margin-top:4px;"></div>
              <div style="height:4px;width:90%;background:#e2e8f0;border-radius:2px;"></div>
            </div>
          ` : `
            <div style="width:100%;background:#fff;display:flex;flex-direction:column;">
              <div style="background:linear-gradient(135deg, ${tpl.color}, #0f172a);padding:10px;color:#fff;">
                <div style="height:9px;width:90px;background:#ffffff;border-radius:2px;margin-bottom:3px;"></div>
                <div style="height:4px;width:60px;background:rgba(255,255,255,0.8);border-radius:2px;"></div>
              </div>
              <div style="padding:10px;display:flex;flex-direction:column;gap:6px;">
                <div style="height:4px;width:95%;background:#cbd5e1;border-radius:2px;"></div>
                <div style="height:4px;width:80%;background:#cbd5e1;border-radius:2px;"></div>
                <div style="height:6px;width:55px;background:${tpl.color};border-radius:2px;margin-top:4px;"></div>
                <div style="height:4px;width:100%;background:#e2e8f0;border-radius:2px;"></div>
                <div style="height:4px;width:88%;background:#e2e8f0;border-radius:2px;"></div>
              </div>
            </div>
          `}
        </div>
      </div>
      <div class="tpl-info">
        <div>
          <div class="tpl-name">${escapeHtml(tpl.name)}</div>
          <div class="tpl-desc">${escapeHtml(tpl.description)}</div>
        </div>
        <div class="tpl-meta">
          <span>${tpl.columns} Column · ${tpl.bestFor}</span>
          <strong style="color:${tpl.color}">Select →</strong>
        </div>
      </div>
    `;
    grid.appendChild(card);
  });
}

// ---------------------------------------------------------------------------
// VIBRANT, COLOR-RICH RESUME RENDERER (Supports All 22+ Templates in High Color)
// ---------------------------------------------------------------------------
function renderResume() {
  const c = document.getElementById('resumeCanvas');
  const d = state;
  try {
    localStorage.setItem('bakangombe_cv_state', JSON.stringify(d));
  } catch (e) {}
  const h = d.heading;
  const primaryColor = d.themeColor || '#1e3a8a';
  const fontFamily = d.fontFamily || 'Inter, sans-serif';
  const tplId = d.templateId;
  const tpl = CV_TEMPLATES.find(t => t.id === tplId) || CV_TEMPLATES[0];

  const fullName = `${escapeHtml(h.firstName)} ${escapeHtml(h.lastName)}`.trim() || 'Bornface Kangombe';
  const jobTitle = escapeHtml(h.title) || 'Founder & Principal Systems Architect';
  const locationStr = [h.city, h.country].filter(Boolean).map(escapeHtml).join(', ');

  const contactList = [];
  if (h.email) contactList.push({ icon: '✉', text: escapeHtml(h.email) });
  if (h.phone) contactList.push({ icon: '☎', text: escapeHtml(h.phone) });
  if (locationStr) contactList.push({ icon: '📍', text: locationStr });
  if (h.linkedin) contactList.push({ icon: '🔗', text: escapeHtml(h.linkedin) });
  if (h.website) contactList.push({ icon: '🌐', text: escapeHtml(h.website) });

  // Photo element with colored glowing border
  const photoTag = h.photoUrl ? `
    <img src="${h.photoUrl}" style="width:80px; height:80px; border-radius:50%; object-fit:cover; border:3px solid #ffffff; box-shadow:0 4px 12px rgba(0,0,0,0.25); flex-shrink:0;">
  ` : '';

  // Render Experience in Rich Colors
  const renderWorkHtml = (options = {}) => {
    if (!d.workHistory || d.workHistory.length === 0) return '';
    return d.workHistory.map((w, idx) => {
      const dates = `${escapeHtml(w.startDate || '')} – ${w.current ? 'Present' : escapeHtml(w.endDate || '')}`;
      const loc = [w.city, w.country].filter(Boolean).map(escapeHtml).join(', ');
      const bulletsHtml = (w.bullets || []).map(b => `
        <li style="margin-bottom:4px; line-height:1.45; position:relative;">
          <span style="color:#1e293b;">${escapeHtml(b)}</span>
        </li>
      `).join('');

      return `
        <div style="margin-bottom: 16px; position:relative; ${options.showBorderLeft ? `border-left: 2px solid ${primaryColor}40; padding-left: 14px; margin-left: 6px;` : ''}">
          ${options.showTimelineNode ? `
            <div style="position:absolute; left:-20px; top:3px; width:10px; height:10px; border-radius:50%; background:${primaryColor}; border:2px solid #ffffff; box-shadow:0 0 0 2px ${primaryColor}40;"></div>
          ` : ''}
          <div style="display:flex; justify-content:space-between; align-items:baseline; flex-wrap:wrap; gap:6px;">
            <strong style="font-size:13.5px; color:#0f172a; letter-spacing:-0.01em;">${escapeHtml(w.title)}</strong>
            <span style="font-size:10.5px; font-weight:700; background:${primaryColor}18; color:${primaryColor}; padding:2px 8px; border-radius:4px; border:1px solid ${primaryColor}30;">${dates}</span>
          </div>
          <div style="display:flex; justify-content:space-between; font-size:12px; color:${primaryColor}; font-weight:700; margin:3px 0 6px;">
            <span>🏢 ${escapeHtml(w.company)}</span>
            <span style="color:#64748b; font-weight:500; font-size:11px;">📍 ${loc}</span>
          </div>
          <ul style="margin:0; padding-left:18px; font-size:11px; color:#334155;">
            ${bulletsHtml}
          </ul>
        </div>
      `;
    }).join('');
  };

  // Render Education
  const renderEduHtml = () => {
    if (!d.education || d.education.length === 0) return '';
    return d.education.map(e => `
      <div style="margin-bottom: 12px; background:rgba(0,0,0,0.015); border-left:3px solid ${primaryColor}; padding:6px 10px; border-radius:0 4px 4px 0;">
        <div style="display:flex; justify-content:space-between; align-items:baseline;">
          <strong style="font-size:12.5px; color:#0f172a;">${escapeHtml(e.degree)}</strong>
          <span style="font-size:10.5px; font-weight:700; color:${primaryColor}; background:${primaryColor}15; padding:1px 6px; border-radius:3px;">${escapeHtml(e.gradYear || '')}</span>
        </div>
        <div style="font-size:11.5px; color:${primaryColor}; font-weight:600; margin-top:2px;">
          🎓 ${escapeHtml(e.school)}${e.city ? `, ${escapeHtml(e.city)}` : ''}
        </div>
        ${e.description ? `<p style="font-size:10.5px; color:#475569; margin:3px 0 0;">${escapeHtml(e.description)}</p>` : ''}
      </div>
    `).join('');
  };

  // Render Skills with Vibrant Badges & Level Bars
  const renderSkillsHtml = () => {
    if (!d.skills || d.skills.length === 0) return '';
    return `
      <div style="display:flex; flex-wrap:wrap; gap:6px;">
        ${d.skills.map(s => `
          <div style="background:${primaryColor}12; border:1px solid ${primaryColor}35; padding:4px 9px; border-radius:5px; font-size:11px; font-weight:600; color:#0f172a; display:inline-flex; align-items:center; gap:5px;">
            <span>${escapeHtml(s.name)}</span>
            <span style="font-size:9px; background:${primaryColor}; color:#ffffff; padding:1px 5px; border-radius:3px; font-weight:700;">${s.level}</span>
          </div>
        `).join('')}
      </div>
    `;
  };

  // -------------------------------------------------------------------------
  // TEMPLATE FAMILY 1: TWO-COLUMN WITH FULL VIBRANT SIDEBAR
  // (Modern Zurich, Emerald Edge, Silicon Valley, Vibrant Split, Oxford, Chartered, etc.)
  // -------------------------------------------------------------------------
  if (tpl.columns === 2) {
    const isTech = tpl.id === 'silicon-valley-tech';
    const isBlueprint = tpl.id === 'engineering-blueprint';
    const isEuro = tpl.id === 'europass-elite';

    c.innerHTML = `
      <div style="font-family:${fontFamily}; min-height:297mm; display:flex; background:#ffffff; color:#1e293b;">
        <!-- Left Rich Colored Column (35%) -->
        <aside style="width:34%; background:linear-gradient(180deg, ${primaryColor}, #0b1329); color:#ffffff; padding:32px 22px; display:flex; flex-direction:column; gap:22px; box-shadow:inset -2px 0 8px rgba(0,0,0,0.15);">
          
          <!-- Photo & Profile Header in Sidebar -->
          <div style="text-align:center; border-bottom:1px solid rgba(255,255,255,0.2); padding-bottom:18px;">
            ${photoTag ? `<div style="margin-bottom:12px;">${photoTag}</div>` : `
              <div style="width:70px; height:70px; border-radius:50%; background:rgba(255,255,255,0.18); border:2px solid rgba(255,255,255,0.35); display:inline-flex; align-items:center; justify-content:center; font-size:24px; font-weight:800; color:#ffffff; margin-bottom:10px;">
                ${(h.firstName[0] || 'B') + (h.lastName[0] || 'K')}
              </div>
            `}
            <h2 style="font-size:18px; font-weight:800; color:#ffffff; margin:0 0 4px; line-height:1.2;">${fullName}</h2>
            <div style="font-size:11px; font-weight:600; color:#93c5fd; letter-spacing:0.04em;">${jobTitle}</div>
          </div>

          <!-- Contact Details Block with Translucent Pills -->
          <div>
            <h4 style="font-size:11px; text-transform:uppercase; letter-spacing:0.1em; color:#ffffff; font-weight:800; background:rgba(255,255,255,0.15); padding:4px 8px; border-radius:4px; margin-bottom:12px; display:inline-block;">
              Contact Information
            </h4>
            <div style="font-size:10.5px; line-height:1.6; color:#e2e8f0; display:flex; flex-direction:column; gap:8px;">
              ${contactList.map(item => `
                <div style="display:flex; align-items:center; gap:8px;">
                  <span style="background:rgba(255,255,255,0.2); width:20px; height:20px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:10px;">${item.icon}</span>
                  <span style="word-break:break-all;">${item.text}</span>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Skills with Vibrant Animated Meters -->
          <div>
            <h4 style="font-size:11px; text-transform:uppercase; letter-spacing:0.1em; color:#ffffff; font-weight:800; background:rgba(255,255,255,0.15); padding:4px 8px; border-radius:4px; margin-bottom:12px; display:inline-block;">
              Core Competencies
            </h4>
            <div style="display:flex; flex-direction:column; gap:9px; font-size:10.5px;">
              ${(d.skills || []).map(s => `
                <div>
                  <div style="display:flex; justify-content:space-between; font-weight:600; margin-bottom:3px;">
                    <span style="color:#ffffff;">${escapeHtml(s.name)}</span>
                    <span style="font-size:9.5px; color:#93c5fd; font-weight:700;">${s.level}</span>
                  </div>
                  <div style="height:4px; background:rgba(255,255,255,0.25); border-radius:3px; overflow:hidden;">
                    <div style="height:100%; width:${s.level === 'Expert' ? '95%' : s.level === 'Advanced' ? '80%' : '65%'}; background:linear-gradient(90deg, #38bdf8, #34d399); border-radius:3px;"></div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Education in Sidebar -->
          <div>
            <h4 style="font-size:11px; text-transform:uppercase; letter-spacing:0.1em; color:#ffffff; font-weight:800; background:rgba(255,255,255,0.15); padding:4px 8px; border-radius:4px; margin-bottom:10px; display:inline-block;">
              Education
            </h4>
            <div style="font-size:10.5px; line-height:1.45; color:#e2e8f0;">
              ${(d.education || []).map(e => `
                <div style="margin-bottom:10px; border-left:2px solid #38bdf8; padding-left:8px;">
                  <strong style="color:#ffffff;">${escapeHtml(e.degree)}</strong>
                  <div style="color:#93c5fd; font-size:10px;">${escapeHtml(e.school)} (${escapeHtml(e.gradYear || '')})</div>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Languages & Certifications -->
          ${d.languages ? `
            <div>
              <h4 style="font-size:11px; text-transform:uppercase; letter-spacing:0.1em; color:#ffffff; font-weight:800; background:rgba(255,255,255,0.15); padding:4px 8px; border-radius:4px; margin-bottom:8px; display:inline-block;">
                Languages
              </h4>
              <p style="font-size:10.5px; margin:0; color:#cbd5e1; line-height:1.5;">${escapeHtml(d.languages)}</p>
            </div>
          ` : ''}

          ${(d.certifications && d.certifications.length > 0) ? `
            <div>
              <h4 style="font-size:11px; text-transform:uppercase; letter-spacing:0.1em; color:#ffffff; font-weight:800; background:rgba(255,255,255,0.15); padding:4px 8px; border-radius:4px; margin-bottom:8px; display:inline-block;">
                Certifications
              </h4>
              <ul style="margin:0; padding-left:14px; font-size:10px; color:#cbd5e1; line-height:1.5;">
                ${d.certifications.map(c => `<li>${escapeHtml(c)}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
        </aside>

        <!-- Right Main Body (66%) with Colorful Section Headers -->
        <main style="flex:1; padding:32px 28px; display:flex; flex-direction:column; gap:20px;">
          <!-- Top Colored Accent Bar -->
          <div style="background:linear-gradient(90deg, ${primaryColor}, #38bdf8); height:6px; border-radius:3px; margin-bottom:4px;"></div>

          <!-- Professional Summary -->
          ${d.summary ? `
            <div>
              <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                <span style="background:${primaryColor}; color:#ffffff; width:22px; height:22px; border-radius:4px; display:inline-flex; align-items:center; justify-content:center; font-size:12px;">★</span>
                <h3 style="font-size:13px; font-weight:800; text-transform:uppercase; letter-spacing:0.06em; color:${primaryColor}; margin:0;">
                  Executive Summary
                </h3>
              </div>
              <p style="font-size:11.5px; line-height:1.6; color:#334155; margin:0; text-align:justify; background:#f8fafc; padding:12px; border-left:3px solid ${primaryColor}; border-radius:0 6px 6px 0;">
                ${escapeHtml(d.summary)}
              </p>
            </div>
          ` : ''}

          <!-- Work Experience -->
          <div>
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:12px; border-bottom:2px solid ${primaryColor}25; padding-bottom:6px;">
              <span style="background:${primaryColor}; color:#ffffff; width:22px; height:22px; border-radius:4px; display:inline-flex; align-items:center; justify-content:center; font-size:12px;">💼</span>
              <h3 style="font-size:13px; font-weight:800; text-transform:uppercase; letter-spacing:0.06em; color:${primaryColor}; margin:0;">
                Work History & Leadership
              </h3>
            </div>
            ${renderWorkHtml({ showBorderLeft: true })}
          </div>

          <!-- References -->
          ${d.references ? `
            <div style="margin-top:auto; padding-top:12px; border-top:1px solid #e2e8f0; font-size:10.5px; color:#64748b; display:flex; justify-content:space-between;">
              <span><strong>References:</strong> ${escapeHtml(d.references)}</span>
              <span style="color:${primaryColor}; font-weight:700;">BaKangombe Verified Profile</span>
            </div>
          ` : ''}
        </main>
      </div>
    `;
    return;
  }

  // -------------------------------------------------------------------------
  // TEMPLATE FAMILY 2: SINGLE-COLUMN TEMPLATES IN FULL, VIBRANT COLOR
  // (Executive Prestige, Ruby Executive, High-Impact Lead, Tokyo Compact, Berlin Bold, Amethyst Signature, etc.)
  // -------------------------------------------------------------------------
  const isHighImpact = tpl.id === 'high-impact-lead';
  const isRuby = tpl.id === 'ruby-executive';
  const isBerlin = tpl.id === 'berlin-bold';

  c.innerHTML = `
    <div style="font-family:${fontFamily}; min-height:297mm; background:#ffffff; color:#1e293b; display:flex; flex-direction:column;">

      <!-- Full-Bleed Saturated Colored Top Header Banner -->
      <header style="background:linear-gradient(135deg, ${primaryColor}, #0b1329); color:#ffffff; padding:28px 36px; box-shadow:0 4px 15px rgba(0,0,0,0.15);">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
          <div style="display:flex; align-items:center; gap:16px;">
            ${photoTag ? photoTag : `
              <div style="width:68px; height:68px; border-radius:50%; background:rgba(255,255,255,0.18); border:2px solid rgba(255,255,255,0.35); display:inline-flex; align-items:center; justify-content:center; font-size:24px; font-weight:800; color:#ffffff;">
                ${(h.firstName[0] || 'B') + (h.lastName[0] || 'K')}
              </div>
            `}
            <div>
              <h1 style="font-size:26px; font-weight:800; color:#ffffff; margin:0 0 4px; letter-spacing:-0.02em;">
                ${fullName}
              </h1>
              <h2 style="font-size:13.5px; font-weight:600; color:#93c5fd; margin:0; letter-spacing:0.04em;">
                ${jobTitle}
              </h2>
            </div>
          </div>

          <!-- Colored Contact Badges -->
          <div style="display:flex; flex-wrap:wrap; gap:8px; max-width:400px; justify-content:flex-end;">
            ${contactList.map(item => `
              <div style="background:rgba(255,255,255,0.15); border:1px solid rgba(255,255,255,0.25); color:#ffffff; padding:3px 9px; border-radius:4px; font-size:10.5px; font-weight:500;">
                <span style="opacity:0.8; margin-right:3px;">${item.icon}</span> ${item.text}
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Optional Gold / Accent Divider Line -->
        <div style="height:3px; background:linear-gradient(90deg, #f59e0b, #38bdf8); border-radius:2px; margin-top:16px;"></div>
      </header>

      <!-- Document Body -->
      <div style="padding:26px 36px; display:flex; flex-direction:column; gap:18px; flex:1;">

        <!-- HIGH-IMPACT METRICS RIBBON (for High-Impact Lead & Executive profiles) -->
        ${isHighImpact ? `
          <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:10px; margin-bottom:4px;">
            <div style="background:${primaryColor}12; border:1px solid ${primaryColor}30; border-top:3px solid ${primaryColor}; border-radius:6px; padding:8px 10px; text-align:center;">
              <div style="font-size:16px; font-weight:800; color:${primaryColor};">10+ Yrs</div>
              <div style="font-size:10px; color:#64748b; font-weight:600; text-transform:uppercase;">Experience</div>
            </div>
            <div style="background:#05966912; border:1px solid #05966930; border-top:3px solid #059669; border-radius:6px; padding:8px 10px; text-align:center;">
              <div style="font-size:16px; font-weight:800; color:#059669;">99.98%</div>
              <div style="font-size:10px; color:#64748b; font-weight:600; text-transform:uppercase;">System SLA</div>
            </div>
            <div style="background:#7c3aed12; border:1px solid #7c3aed30; border-top:3px solid #7c3aed; border-radius:6px; padding:8px 10px; text-align:center;">
              <div style="font-size:16px; font-weight:800; color:#7c3aed;">16+ Modules</div>
              <div style="font-size:10px; color:#64748b; font-weight:600; text-transform:uppercase;">Multi-Tenant API</div>
            </div>
            <div style="background:#d9770612; border:1px solid #d9770630; border-top:3px solid #d97706; border-radius:6px; padding:8px 10px; text-align:center;">
              <div style="font-size:16px; font-weight:800; color:#d97706;">$18M+</div>
              <div style="font-size:10px; color:#64748b; font-weight:600; text-transform:uppercase;">Capital Delivered</div>
            </div>
          </div>
        ` : ''}

        <!-- Professional Summary -->
        ${d.summary ? `
          <section>
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
              <span style="background:${primaryColor}; color:#ffffff; width:20px; height:20px; border-radius:4px; display:inline-flex; align-items:center; justify-content:center; font-size:11px;">★</span>
              <h3 style="font-size:12.5px; font-weight:800; text-transform:uppercase; letter-spacing:0.06em; color:${primaryColor}; margin:0;">
                Executive Profile
              </h3>
            </div>
            <p style="font-size:11.5px; line-height:1.6; color:#334155; margin:0; text-align:justify; background:#f8fafc; padding:12px; border-left:3px solid ${primaryColor}; border-radius:0 6px 6px 0;">
              ${escapeHtml(d.summary)}
            </p>
          </section>
        ` : ''}

        <!-- Work Experience -->
        <section>
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:12px; border-bottom:2px solid ${primaryColor}25; padding-bottom:6px;">
            <span style="background:${primaryColor}; color:#ffffff; width:20px; height:20px; border-radius:4px; display:inline-flex; align-items:center; justify-content:center; font-size:11px;">💼</span>
            <h3 style="font-size:12.5px; font-weight:800; text-transform:uppercase; letter-spacing:0.06em; color:${primaryColor}; margin:0;">
              Professional Career & Milestones
            </h3>
          </div>
          ${renderWorkHtml({ showTimelineNode: tpl.id === 'timeline-flow', showBorderLeft: tpl.id === 'timeline-flow' })}
        </section>

        <!-- Education -->
        <section>
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px; border-bottom:2px solid ${primaryColor}25; padding-bottom:6px;">
            <span style="background:${primaryColor}; color:#ffffff; width:20px; height:20px; border-radius:4px; display:inline-flex; align-items:center; justify-content:center; font-size:11px;">🎓</span>
            <h3 style="font-size:12.5px; font-weight:800; text-transform:uppercase; letter-spacing:0.06em; color:${primaryColor}; margin:0;">
              Education & Degrees
            </h3>
          </div>
          ${renderEduHtml()}
        </section>

        <!-- Skills -->
        <section>
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px; border-bottom:2px solid ${primaryColor}25; padding-bottom:6px;">
            <span style="background:${primaryColor}; color:#ffffff; width:20px; height:20px; border-radius:4px; display:inline-flex; align-items:center; justify-content:center; font-size:11px;">⚡</span>
            <h3 style="font-size:12.5px; font-weight:800; text-transform:uppercase; letter-spacing:0.06em; color:${primaryColor}; margin:0;">
              Key Competencies & Technical Stack
            </h3>
          </div>
          ${renderSkillsHtml()}
        </section>

        <!-- Certifications & Languages in Dual Colored Cards -->
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:4px;">
          ${(d.certifications && d.certifications.length > 0) ? `
            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-top:3px solid ${primaryColor}; border-radius:6px; padding:10px 12px;">
              <h4 style="font-size:11.5px; text-transform:uppercase; letter-spacing:0.05em; color:${primaryColor}; margin:0 0 6px; font-weight:800;">
                🏆 Certifications & Accreditations
              </h4>
              <ul style="margin:0; padding-left:14px; font-size:10.5px; color:#475569; line-height:1.5;">
                ${d.certifications.map(c => `<li>${escapeHtml(c)}</li>`).join('')}
              </ul>
            </div>
          ` : ''}

          ${d.languages ? `
            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-top:3px solid ${primaryColor}; border-radius:6px; padding:10px 12px;">
              <h4 style="font-size:11.5px; text-transform:uppercase; letter-spacing:0.05em; color:${primaryColor}; margin:0 0 6px; font-weight:800;">
                🌐 Languages & Communication
              </h4>
              <p style="font-size:10.5px; color:#475569; margin:0; line-height:1.5;">${escapeHtml(d.languages)}</p>
              ${d.references ? `<div style="margin-top:8px; font-size:10px; color:#94a3b8;"><strong>References:</strong> ${escapeHtml(d.references)}</div>` : ''}
            </div>
          ` : ''}
        </div>

      </div>
    </div>
  `;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
