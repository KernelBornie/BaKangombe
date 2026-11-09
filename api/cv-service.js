const express = require('express');
const router = express.Router();

// Catalog of 22+ Professional CV Templates
const CV_TEMPLATES = [
  {
    id: 'executive-prestige',
    name: 'Executive Prestige',
    category: 'Executive',
    columns: 1,
    photoSupport: true,
    bestFor: '10+ years of experience',
    color: '#1e3a8a',
    font: 'serif',
    recommended: true,
    badge: 'C-Suite & Leadership',
    description: 'Dignified traditional single-column layout with refined serif headings and classical rule dividers. Ideal for senior management, legal, and executives.'
  },
  {
    id: 'modern-zurich',
    name: 'Modern Zurich',
    category: 'Modern',
    columns: 2,
    photoSupport: true,
    bestFor: '10+ years of experience',
    color: '#0f766e',
    font: 'sans',
    recommended: true,
    badge: 'Popular Choice',
    description: 'Sleek Swiss-inspired 2-column layout with left sidebar for photo, competencies, and contact; expansive right column for career milestones.'
  },
  {
    id: 'nordic-minimal',
    name: 'Nordic Minimal',
    category: 'Minimalist',
    columns: 1,
    photoSupport: false,
    bestFor: 'All levels',
    color: '#18181b',
    font: 'sans',
    recommended: true,
    badge: 'Clean Aesthetic',
    description: 'Hyper-clean monochrome typography, generous whitespace, subtle hairline dividers. Focuses 100% on achievements and clarity.'
  },
  {
    id: 'corporate-oxford',
    name: 'Corporate Oxford',
    category: 'Corporate',
    columns: 2,
    photoSupport: true,
    bestFor: '10+ years of experience',
    color: '#1e293b',
    font: 'serif',
    recommended: true,
    badge: 'Enterprise Standard',
    description: 'Prestigious two-tone layout featuring top name banner and structured column breakdown for enterprise and academic leaders.'
  },
  {
    id: 'silicon-valley-tech',
    name: 'Silicon Valley Tech',
    category: 'Technical',
    columns: 2,
    photoSupport: true,
    bestFor: 'Mid to Senior',
    color: '#0284c7',
    font: 'sans',
    recommended: true,
    badge: 'Tech & Engineering',
    description: 'Modern developer layout highlighting tech stacks, git repos, system architectures, and measurable engineering metrics.'
  },
  {
    id: 'emerald-edge',
    name: 'Emerald Edge',
    category: 'Modern',
    columns: 2,
    photoSupport: true,
    bestFor: '10+ years of experience',
    color: '#047857',
    font: 'sans',
    recommended: true,
    badge: 'Executive',
    description: 'Distinctive deep forest emerald sidebar with contrasting crisp white cards. Commands instant attention from recruiters.'
  },
  {
    id: 'tokyo-compact',
    name: 'Tokyo Compact',
    category: 'Compact',
    columns: 1,
    photoSupport: true,
    bestFor: '10+ years of experience',
    color: '#334155',
    font: 'sans',
    recommended: true,
    badge: 'High Density',
    description: 'Space-efficient 1-column layout designed to fit extensive 10+ year career chronologies without unnecessary multi-page spillovers.'
  },
  {
    id: 'creative-portfolio',
    name: 'Creative Portfolio',
    category: 'Creative',
    columns: 2,
    photoSupport: true,
    bestFor: 'Mid to Senior',
    color: '#7c3aed',
    font: 'sans',
    recommended: false,
    badge: 'Design & Marketing',
    description: 'Asymmetric two-column structure with circular avatar frame, creative section typography, and visual portfolio links.'
  },
  {
    id: 'geneva-banker',
    name: 'Geneva Banker',
    category: 'Executive',
    columns: 1,
    photoSupport: false,
    bestFor: '10+ years of experience',
    color: '#172554',
    font: 'serif',
    recommended: true,
    badge: 'Finance & Banking',
    description: 'High-prestige centered header with double hairline border, Roman accents, and structured dates. Standard for wealth management and consulting.'
  },
  {
    id: 'berlin-bold',
    name: 'Berlin Bold',
    category: 'Modern',
    columns: 1,
    photoSupport: true,
    bestFor: 'All levels',
    color: '#dc2626',
    font: 'sans',
    recommended: false,
    badge: 'Bold Contrast',
    description: 'Geometric section headers with solid left accent bars and strong typographic hierarchy. High visual impact.'
  },
  {
    id: 'stockholm-clean',
    name: 'Stockholm Clean',
    category: 'Minimalist',
    columns: 2,
    photoSupport: true,
    bestFor: 'Entry to Mid',
    color: '#475569',
    font: 'sans',
    recommended: false,
    badge: 'Scandinavian',
    description: 'Warm modern aesthetic with soft tinted sidebar, clean rounded skill pills, and harmonious spacing throughout.'
  },
  {
    id: 'ivy-league-classic',
    name: 'Ivy League Classic',
    category: 'Academic',
    columns: 1,
    photoSupport: false,
    bestFor: '10+ years of experience',
    color: '#000000',
    font: 'serif',
    recommended: true,
    badge: 'Academic & Research',
    description: 'Pure traditional academic curriculum vitae format modeled after Harvard and Oxford faculty standards. Pure black & white, timeless.'
  },
  {
    id: 'vibrant-split',
    name: 'Vibrant Split',
    category: 'Modern',
    columns: 2,
    photoSupport: true,
    bestFor: 'Mid to Senior',
    color: '#2563eb',
    font: 'sans',
    recommended: false,
    badge: 'Two-Tone',
    description: 'Dynamic 35/65 split with high-contrast colored sidebar and crisp white main section, giving clean separation of skills vs experience.'
  },
  {
    id: 'timeline-flow',
    name: 'Timeline Flow',
    category: 'Creative',
    columns: 1,
    photoSupport: true,
    bestFor: '10+ years of experience',
    color: '#4f46e5',
    font: 'sans',
    recommended: true,
    badge: 'Visual Career Track',
    description: 'Features an elegant connected career progression timeline along the left margin, mapping your career trajectory visually.'
  },
  {
    id: 'europass-elite',
    name: 'EuroPass Elite',
    category: 'Corporate',
    columns: 2,
    photoSupport: true,
    bestFor: 'All levels',
    color: '#0369a1',
    font: 'sans',
    recommended: false,
    badge: 'European Standard',
    description: 'Complies with European Union CV structure, presenting dates and organizations in a distinct left sub-column alongside role descriptions.'
  },
  {
    id: 'ruby-executive',
    name: 'Ruby Executive',
    category: 'Executive',
    columns: 1,
    photoSupport: true,
    bestFor: '10+ years of experience',
    color: '#991b1b',
    font: 'serif',
    recommended: true,
    badge: 'Luxury & C-Level',
    description: 'Deep burgundy accents, small-caps section titles, and refined margins suited for senior directors, founders, and partners.'
  },
  {
    id: 'california-modern',
    name: 'California Modern',
    category: 'Modern',
    columns: 2,
    photoSupport: true,
    bestFor: 'Entry to Mid',
    color: '#0d9488',
    font: 'sans',
    recommended: false,
    badge: 'Tech & Startup',
    description: 'Contemporary startup resume layout with top horizontal photo banner, subtle teal borders, and structured key achievements.'
  },
  {
    id: 'architectural-grid',
    name: 'Architectural Grid',
    category: 'Technical',
    columns: 2,
    photoSupport: true,
    bestFor: 'Mid to Senior',
    color: '#3b82f6',
    font: 'sans',
    recommended: false,
    badge: 'Modular Grid',
    description: 'Balanced modular card compartments for each career facet, providing clarity for multidisciplinary professionals and engineers.'
  },
  {
    id: 'amethyst-signature',
    name: 'Amethyst Signature',
    category: 'Creative',
    columns: 1,
    photoSupport: true,
    bestFor: 'All levels',
    color: '#6b21a8',
    font: 'sans',
    recommended: false,
    badge: 'Communications & HR',
    description: 'Refined royal amethyst styling with italicized subheaders and prominent summary statement, popular in PR and HR.'
  },
  {
    id: 'engineering-blueprint',
    name: 'Engineering Blueprint',
    category: 'Technical',
    columns: 2,
    photoSupport: true,
    bestFor: '10+ years of experience',
    color: '#1e40af',
    font: 'sans',
    recommended: true,
    badge: 'STEM & Engineering',
    description: 'Optimized for technical depth: certifications grid, patent/project callouts, programming proficiencies, and mechanical/IT metrics.'
  },
  {
    id: 'high-impact-lead',
    name: 'High-Impact Lead',
    category: 'Executive',
    columns: 1,
    photoSupport: false,
    bestFor: '10+ years of experience',
    color: '#0f172a',
    font: 'sans',
    recommended: true,
    badge: 'Results-Driven',
    description: 'Starts with a key performance metrics highlight row (e.g. "+35% Revenue", "$4.2M Budget", "50+ Engineers Led") before diving into chronology.'
  },
  {
    id: 'chartered-professional',
    name: 'Chartered Professional',
    category: 'Corporate',
    columns: 2,
    photoSupport: true,
    bestFor: '10+ years of experience',
    color: '#111827',
    font: 'serif',
    recommended: true,
    badge: 'Legal & Accounting',
    description: 'High-contrast dark obsidian sidebar with crisp white typography, coupled with an authoritative serif document body.'
  }
];

// Sample pre-populated profiles
const SAMPLE_PROFILES = {
  bornface_kangombe: {
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
      { name: 'PostgreSQL & Database Design', level: 'Expert' },
      { name: 'High-Concurrency Distributed Systems', level: 'Expert' },
      { name: 'API Security, OAuth 2.0 & JWT', level: 'Expert' },
      { name: 'Fintech & Mobile Money Protocols', level: 'Advanced' },
      { name: 'DevOps & Docker Infrastructure', level: 'Advanced' },
      { name: 'Project & Technical Team Leadership', level: 'Expert' }
    ],
    certifications: [
      { name: 'AWS Certified Solutions Architect – Professional', issuer: 'Amazon Web Services', year: '2021' },
      { name: 'Project Management Professional (PMP)', issuer: 'Project Management Institute', year: '2019' }
    ],
    languages: [
      { name: 'English', proficiency: 'Fluent (Native Proficiency)' },
      { name: 'Bemba', proficiency: 'Native' },
      { name: 'Swahili', proficiency: 'Professional Working Proficiency' }
    ],
    projects: [
      {
        name: 'BaKangombe Real-Time Verification Engine',
        role: 'Creator & Lead Architect',
        description: 'High-throughput email validation and business automation platform serving global clients.'
      }
    ],
    references: [
      { name: 'Available upon request', title: '', company: '', contact: '' }
    ],
    templateId: 'executive-prestige',
    themeColor: '#1e3a8a',
    fontFamily: 'serif'
  },

  software_engineer: {
    heading: {
      firstName: 'David',
      lastName: 'Mutale',
      title: 'Principal Software Engineer & Cloud Architect',
      email: 'david.mutale@dev.io',
      phone: '+260 97 555 0199',
      postcode: '10101',
      city: 'Lusaka',
      country: 'Zambia',
      linkedin: 'linkedin.com/in/david-mutale',
      website: 'github.com/dmutale',
      photoUrl: ''
    },
    summary: 'Senior Cloud Architect & Full-Stack Systems Engineer with 11+ years designing high-throughput distributed microservices, fintech payment gateways, and fault-tolerant cloud backends. Architected platforms serving 4M+ daily active transactions with 99.995% SLA. Expert in Node.js, TypeScript, Golang, PostgreSQL, Kafka, and Kubernetes.',
    workHistory: [
      {
        id: 'w1',
        title: 'Principal Architect & Tech Lead',
        company: 'AfriPay Mobile Systems',
        city: 'Lusaka',
        country: 'Zambia',
        startDate: '2020-01',
        endDate: '',
        current: true,
        bullets: [
          'Engineered core transaction routing engine processing 250+ TPS during peak mobile money remittance cycles.',
          'Migrated legacy monolithic billing engine to event-driven Kubernetes microservices, cutting infrastructure costs by 45%.',
          'Mentored team of 18 junior and mid-level software engineers across Git workflows, clean architecture, and CI/CD automation.'
        ]
      },
      {
        id: 'w2',
        title: 'Senior Backend Engineer',
        company: 'Fintech Velocity Global',
        city: 'Johannesburg / Remote',
        country: 'South Africa',
        startDate: '2016-04',
        endDate: '2019-12',
        current: false,
        bullets: [
          'Built RESTful and GraphQL APIs for mobile banking apps supporting KYC validation, bill pay, and cross-border remittances.',
          'Reduced p99 latency from 1.8s to 120ms by implementing Redis caching tiers and query plan index optimization.',
          'Designed zero-downtime database migration pipelines for 10TB+ Postgres clusters.'
        ]
      }
    ],
    education: [
      {
        id: 'e1',
        degree: 'B.Sc. in Computer Science',
        school: 'University of Cape Town',
        city: 'Cape Town',
        country: 'South Africa',
        gradYear: '2014',
        description: 'First Class Honours. Specialization in Distributed Computing and Database Systems.'
      }
    ],
    skills: [
      { name: 'TypeScript / Node.js', level: 'Expert' },
      { name: 'Go (Golang)', level: 'Advanced' },
      { name: 'PostgreSQL / TimescaleDB', level: 'Expert' },
      { name: 'Distributed Systems & Microservices', level: 'Expert' },
      { name: 'Kubernetes & Docker', level: 'Expert' },
      { name: 'Apache Kafka & RabbitMQ', level: 'Advanced' },
      { name: 'Amazon Web Services (AWS)', level: 'Expert' },
      { name: 'API Security & OAuth 2.0', level: 'Expert' }
    ],
    certifications: [
      { name: 'AWS Certified Solutions Architect – Professional', issuer: 'Amazon Web Services', year: '2021' },
      { name: 'Certified Kubernetes Administrator (CKA)', issuer: 'Cloud Native Computing Foundation', year: '2022' }
    ],
    languages: [
      { name: 'English', proficiency: 'Native / Bilingual' }
    ],
    projects: [
      {
        name: 'OpenMomo Gateway SDK',
        role: 'Creator & Maintainer',
        description: 'Open source SDK for MTN and Airtel Money integration used by over 300 African developers.'
      }
    ],
    references: [
      { name: 'Available upon request', title: '', company: '', contact: '' }
    ],
    templateId: 'silicon-valley-tech',
    themeColor: '#0284c7',
    fontFamily: 'sans'
  }
};

// In-memory store for user saved CVs
const savedCVs = new Map();

// Helper: Calculate completeness score
function calculateCompleteness(cv) {
  let score = 0;
  const tips = [];

  const h = cv.heading || {};
  if (h.firstName && h.lastName) score += 10;
  else tips.push('Add your full name');

  if (h.title) score += 5;
  else tips.push('Add your professional job title');

  if (h.email && h.phone) score += 10;
  else tips.push('Provide both an email address and phone number for recruiters');

  if (h.city || h.country) score += 5;

  if (cv.summary && cv.summary.trim().length > 40) score += 15;
  else tips.push('Write a strong 2-4 sentence professional summary');

  const work = cv.workHistory || [];
  if (work.length > 0) {
    score += 20;
    const hasBullets = work.some(w => (w.bullets && w.bullets.length > 0) || w.description);
    if (hasBullets) score += 5;
    else tips.push('Add specific accomplishment bullet points to your work history');
    if (work.length >= 2) score += 5;
  } else {
    tips.push('Add at least one relevant work experience or internship');
  }

  const edu = cv.education || [];
  if (edu.length > 0) score += 15;
  else tips.push('Add your education or academic qualifications');

  const skills = cv.skills || [];
  if (skills.length >= 3) score += 10;
  else tips.push('Add at least 3 core professional skills');
  if (skills.length >= 6) score += 5;

  return {
    score: Math.min(100, score),
    tips: tips.slice(0, 3)
  };
}

// Routes
// 1. Get all 22+ CV templates
router.get('/templates', (req, res) => {
  res.json({
    templates: CV_TEMPLATES,
    total: CV_TEMPLATES.length,
    categories: ['All', 'Executive', 'Modern', 'Minimalist', 'Corporate', 'Technical', 'Creative', 'Academic', 'Compact']
  });
});

// 2. Get sample CV profile
router.get('/samples/:role?', (req, res) => {
  const role = req.params.role || 'bornface_kangombe';
  const profile = SAMPLE_PROFILES[role] || SAMPLE_PROFILES.bornface_kangombe;
  const completeness = calculateCompleteness(profile);
  res.json({
    profile,
    completeness,
    availableSamples: Object.keys(SAMPLE_PROFILES)
  });
});

// 3. Validate & analyze CV completeness
router.post('/validate', (req, res) => {
  const cv = req.body || {};
  const completeness = calculateCompleteness(cv);
  res.json({
    valid: true,
    completeness: completeness.score,
    tips: completeness.tips
  });
});

// 4. Save CV
router.post('/save', (req, res) => {
  const { cvData, id } = req.body;
  if (!cvData) return res.status(400).json({ error: 'cvData object required' });

  const cvId = id || 'cv_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
  const completeness = calculateCompleteness(cvData);
  const record = {
    id: cvId,
    data: cvData,
    completeness: completeness.score,
    updatedAt: new Date().toISOString()
  };
  savedCVs.set(cvId, record);

  res.json({
    success: true,
    id: cvId,
    completeness: completeness.score,
    message: 'CV saved successfully'
  });
});

// 5. Get saved CV
router.get('/:id', (req, res) => {
  const cv = savedCVs.get(req.params.id);
  if (!cv) return res.status(404).json({ error: 'CV not found' });
  res.json(cv);
});

module.exports = { router, CV_TEMPLATES, SAMPLE_PROFILES };
