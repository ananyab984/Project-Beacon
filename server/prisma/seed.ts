// Seeds the same 3 demo users the client's mock auth (client/src/lib/auth.tsx)
// and the old in-memory AuthService both used, so the existing manual-test
// flow (owner@global3.co / recruiter@global3.co / contractor@global3.co, all
// password "demo1234") keeps working once auth is backed by real Postgres.
// Note: Passwords are managed externally by Neon Auth; this seed just creates
// the app profiles and FAQ entries.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEMO_USERS = [
  { name: "Owner User", email: "owner@global3.co", role: "OWNER" as const, languages: [] },
  { name: "Recruiter User", email: "recruiter@global3.co", role: "RECRUITER" as const, languages: [] },
  { name: "Contractor Partner", email: "contractor@global3.co", role: "CONTRACTOR" as const, languages: [] },
];

const FAQ_ENTRIES: { id: string; category: string; question: string; answer: string; tags: string[] }[] = [
  // General / Contract Questions
  {
    id: "faq_consultancy_contract",
    category: "General",
    question: "Why is it a 'Consultancy' contract? Could you also please confirm the range of the services: does it include post-MT editing or AI training?",
    answer: "As Global3 is building its own platform, we sometimes request feedback from freelancers on how to improve our product. Any such request will attract the hourly rate in Exhibit A of your contract. This role includes working with machine translation (especially for QC). We are working hard to integrate the AI capability seamlessly into existing workflows.",
    tags: ["contract", "services", "consulting"],
  },
  {
    id: "faq_non_compete_clause",
    question: "Why is this in my contract? - \"During my consulting relationship, I will not engage in any business activity which is related to the subject matter of my consulting with the Company\"",
    category: "General",
    answer: "Global3 is building its own platform to improve existing workflows using AI. As a result of this, during our initial testing period, freelancers will be able to view improvements and processes that Global3 will be using to make our proprietary software more user friendly and practical. During this time, we safeguard ourselves to ensure that freelancers do not test AI workflows with other similar industries to prevent any conflict of interest. Global3 does not expect freelancers to stop other routine traditional localization contracts that they may be working on currently.",
    tags: ["non-compete", "contract", "ai"],
  },
  {
    id: "faq_inventions_consultant",
    category: "General",
    question: "Why do I need to provide examples of Inventions or have to be Consultant?",
    answer: "Global3 is creating proprietary software that integrates new-age AI technology to improve traditional workflows. We continue to improve our product based on feedback received from our teams and freelancers. We want to be mindful of any existing patents you may have as a freelancer and safeguard your rights to it. Likewise, any recommendations made by you on Global3 platforms will be implemented into our software - the rights to which are what is under the scope of our consulting agreement.",
    tags: ["inventions", "patent", "ip"],
  },
  {
    id: "faq_payment_satisfactory_work",
    category: "General",
    question: "Why is this clause a part of the agreement: \"The Company shall make payment for the same, as set forth below, only if the Services performed are, in the sole opinion of the Company, satisfactory and needs no re-performance.\"",
    answer: "Global3 is a company started by industry stalwarts and ensures a fair and just payment mechanism for its freelancers. For the work to be remunerated, Global3 would need to confirm that no significant reperformance is needed. In good faith, Global3 also has to review the actual time spent by a freelancer against benchmarks to ensure a fair payment scale to its freelancers. The quality of the deliverable will be evaluated based on internal reviews/revisions as well as client feedback. The team would approach the translators to discuss the rework that is required and garner their assent in applying the necessary revisions. The freelancers will be compensated for the time and effort they put in on every project. However, if the quality delivered isn't on par with the expectations of the client then post discussions with the linguist we might decide on alternate projects or tasks that would work well for all involved.",
    tags: ["payment", "quality", "terms"],
  },
  {
    id: "faq_power_of_attorney",
    category: "General",
    question: "Why should I grant power of attorney to the company \"Clause 11g\"? Clause 11(g) – Post-Contract Obligations & Power of Attorney",
    answer: "Global3 is a start-up looking to revolutionize the way localization services are provided. As a part of our initial freelance pool, you will have access to our software, ideas and suggested workflows. This clause aims to safeguard our ideas. It applies only in cases where freelancers working with our software, during their course of consultancy. No other work, ideas or inventions are covered under this clause. Global3 also provides freelancers to list out any industry-specific patents they already possess (in Exhibit B) so we can exclude it from the purview of this clause.",
    tags: ["attorney", "poa", "legal"],
  },
  {
    id: "faq_competing_business",
    category: "General",
    question: "Non-Compete Clause: There's a clause restricting engagement in competing business activities (Paragraph 11(c)). Could you elaborate on how \"competing business activities\" are defined in this context? Would this apply to specific industries or geographic regions?",
    answer: "Global3 is building its own platform to improve existing workflows using AI. As a result of this, during our initial testing period, freelancers will be able to view improvements and processes that Global3 will be using to make our proprietary software more user friendly and practical. During this time, we safeguard ourselves to ensure that freelancers do not test AI workflows with other similar industries to prevent any conflict of interest. Global3 does not expect freelancers to stop other routine traditional localization contracts that they may be working on currently.",
    tags: ["compete", "restriction", "contract"],
  },
  {
    id: "faq_payment_criteria_satisfaction",
    category: "General",
    question: "Compensation Terms: Payment is contingent on the company's satisfaction with the services provided (Paragraph 2.1), and invoices are payable 45 days after submission. Could we discuss how the criteria for satisfactory performance will be communicated and evaluated?",
    answer: "Global3 is a company started by industry stalwarts and ensures a fair and just payment mechanism for its freelancers. For the work to be remunerated, Global3 would need to confirm that no significant reperformance is needed. In good faith, Global3 also has to review the actual time spent by a freelancer against benchmarks to ensure a fair payment scale to its freelancers.",
    tags: ["payment", "criteria", "terms"],
  },
  {
    id: "faq_intellectual_property_rights",
    category: "General",
    question: "Clause 11(d) – Intellectual Property Rights: I am happy to deliver the agreed-upon work, but I cannot agree to disclose all ideas, processes, techniques, or know-how that I develop independently or that are unrelated to the specific work commissioned by the company.",
    answer: "Global3 is a start-up looking to revolutionize the way localization services are provided. As a part of our initial freelance pool, you will have access to our software, ideas and suggested workflows. This clause aims to safeguard our ideas. It applies only in cases where freelancers working with our software, during their course of consultancy. No other work, ideas or inventions are covered under this clause. Global3 also provides freelancers to list out any industry-specific patents they already possess (in Exhibit B) so we can exclude it from the purview of this clause.",
    tags: ["ip", "intellectual", "patent"],
  },
  {
    id: "faq_patent_indemnification",
    category: "General",
    question: "Clause 16 – Indemnification & Injunctive Relief: Regarding the paragraph requiring assistance with enforcing patents, copyrights, or other rights, even beyond the termination of the consulting relationship (Paragraph 11(g)) - Could you clarify the extent of the ongoing obligation after the termination and the reason behind it?",
    answer: "Global3 is a start-up looking to revolutionize the way localization services are provided. As a part of our initial freelance pool, you will have access to our software, ideas and suggested workflows. This clause aims to safeguard our ideas. It applies only in cases where freelancers working with our software, during their course of consultancy. Where there is a patent discovered or where an existing patent is used in our product, we would enter into a separate agreement to ensure that there is continuity in our platform. At this point, we will negotiate with you on rates, based on industry benchmarks.",
    tags: ["patent", "indemnification", "legal"],
  },
  {
    id: "faq_legal_address",
    category: "General",
    question: "Global3 Legal address & Tax ID",
    answer: "Global3 Inc, 201 Ocean Avenue, Santa Monica, California 90402, Tax ID: EIN 33-1330535",
    tags: ["address", "tax", "legal"],
  },
  {
    id: "faq_msa_negotiation",
    category: "General",
    question: "Requested to negotiate specific terms in G3's MSA before signing.",
    answer: "At Global3, we do rely on a standard MSA across all our collaborations, and unfortunately we're not able to make individual edits. This helps us ensure consistency and fairness across our network of partners, while still reflecting our commitment to ethical business practices and proper compensation. We hope you will reconsider your decision, but of course we respect whatever you ultimately decide.",
    tags: ["msa", "terms", "negotiation"],
  },
  {
    id: "faq_name_application",
    category: "General",
    question: "Should I use my real name or performer name on the application?",
    answer: "Please use your real name on the application. During the identity verification stage, your submitted documents (ID, selfie, etc.) must match the name you provide on your application exactly. This ensures consistency and compliance with our verification process.",
    tags: ["application", "name", "verification"],
  },
  // Voice Synthesis / Ownership & Control
  {
    id: "faq_voice_commercial_use",
    category: "Voice Artists",
    question: "You mentioned that the recorded performance will be used to create a synthesized voice model \"strictly for testing and demonstration purposes.\" However, I need a clear, written confirmation that this model will not be used commercially or licensed to any third parties without a separate agreement and additional compensation. Will you be providing that?",
    answer: "Yes, that is expressly written in the contract we provide. When a customer wants to license the model, an additional contract will be provided and you have the choice to accept or decline the offer.",
    tags: ["voice", "commercial", "licensing"],
  },
  {
    id: "faq_voice_ownership_control",
    category: "Voice Artists",
    question: "Who retains ownership of the AI-generated voice? Will I have the ability to opt-out of any future use?",
    answer: "We host and manage the model, use is decided by you on a case by case basis. If you opt-out, use for future customer demonstrations will cease. Opting out can be done after 1 year. If you opt out but have agreed to license the model to a customer for a specific series, they will continue to be able to use the model as agreed in the terms of that specific contract.",
    tags: ["ownership", "control", "optout"],
  },
  {
    id: "faq_voice_payment_concrete",
    category: "Voice Artists",
    question: "You indicated that a \"larger payment\" would be offered if the project moves forward, but I need to understand what that means in concrete terms.",
    answer: "We can share rates after an NDA is signed (but before any recording is commissioned). If a customer wants to use your voice for a dubbing or VO project, you are presented with a new agreement for that customer/use case. If you agree with the terms and want your voice to be used for that project, you will be compensated for that project. If you don't agree with the terms for that project, then you can simply say \"No, thank you\" and your voice won't be used.",
    tags: ["rates", "payment", "compensation", "salary", "pmt", "pay"],
  },
  {
    id: "faq_voice_royalties_notification",
    category: "Voice Artists",
    question: "How would royalties be structured, and how will I be notified if my AI voice model is used in future projects?",
    answer: "Currently, you'll be notified via email, by a Global3 representative if a customer wants to use your voice. In the long term we'll be working on a platform to manage and track your offers and contracts",
    tags: ["royalties", "notification", "tracking"],
  },
  {
    id: "faq_voice_storage_access",
    category: "Voice Artists",
    question: "Before agreeing to anything, I need clarity on where my recordings will be stored, who will have access to them, and how long they will be retained.",
    answer: "Your model will be stored in our platform. Direct access to the models themselves is limited to a handful of engineers. Access to use the model to create short demonstrations to customers is available to our linguistic leads, who work on casting. In most cases, an existing voice sample will work. Before we share more details, an NDA will need to be signed.",
    tags: ["storage", "access", "security"],
  },
  {
    id: "faq_voice_additional_sample",
    category: "Voice Artists",
    question: "Additionally, I noticed that you are requesting additional voice sample, despite already having access to my demos. Could you clarify why this is necessary?",
    answer: "We are sourcing/onboarding many voice talents and we are unaware of which talents have publicly available demos and equipment lists. Typically we request samples so that we can assess recording quality and environment. After having listened to the demo on your website, we don't need an additional voice sample. Your recording environment is great and you're using fantastic equipment.",
    tags: ["sample", "quality", "assessment"],
  },
  {
    id: "faq_voice_one_year_usage",
    category: "Voice Artists",
    question: "What does the \"one year of model usage\" mean in practice — does it mean usage is only allowed for one year, or that content generated within that year can be used indefinitely?",
    answer: "The \"one year of model usage\" refers to the time period during which the synthetic voice model based on your voice can be actively used to generate new content. During the licensed year, the client can use the voice model to create new recordings or dialogue for the specific character/show covered by the license. Any content generated during that one-year period can continue to be used indefinitely, even after the license term ends. In other words, the license to generate new voice content is time-limited (one year), but the license to use what's already been generated is perpetual for that project.",
    tags: ["license", "usage", "perpetual"],
  },
  {
    id: "faq_voice_license_fee",
    category: "Voice Artists",
    question: "Clarify the production license fee",
    answer: "The license fee of up to $800 USD is a one-time payment per character per show. This means: If your voice is selected for multiple distinct characters or separate shows, each would trigger a separate license fee. The fee is not tied to the number of platforms or devices on which the show appears. We do not control how a client chooses to deploy their production—many distribute content across apps, TVs, mobile devices, and other platforms as part of a single use case. The goal is to ensure fair compensation per creative use (i.e., per character in a show), rather than per distribution method.",
    tags: ["license", "fee", "rate"],
  },
  {
    id: "faq_voice_approval_demos",
    category: "Voice Artists",
    question: "I'd also like to confirm that any usage of the model (even for demos or internal testing) will require my approval on a case-by-case basis, as you mentioned. This level of oversight is essential for me to move forward with confidence.",
    answer: "In practice, we may use your voice model to generate limited internal demos or private client samples without prior approval. This is solely for the purpose of evaluating or pitching your voice for a specific role, and never for public or commercial use. We believe this strikes a fair balance between respecting your control and enabling us to help pitch your voice effectively to clients. That said, if you would prefer to be notified in advance of any such internal demo use, just let us know—we're happy to accommodate and include that in our process. Of course, no commercial use, distribution, or public release of your voice or the generated content will occur without your explicit written approval.",
    tags: ["approval", "demos", "oversight"],
  },
  {
    id: "faq_voice_recording_fee_scope",
    category: "Voice Artists",
    question: "The fee of 300 USD does not specify exactly what kind of work it is for - how many words to be recorded, how long the recording should take etc.",
    answer: "The fee is for approximately 30 minutes of recorded voice which could constitute 6 batches of 5 minute voice recordings. This is mainly to record your range of emotions.",
    tags: ["fee", "recording", "scope"],
  },
  {
    id: "faq_voice_internal_use_definition",
    category: "Voice Artists",
    question: "The term \"internal use\" seems to be very vague for us - what exactly does it mean?",
    answer: "Internal use is for us to test the capability of our voice model. For example: will the voice model match the voice of the target voice actor based on the project from our Studio/Client. These are typically POCs where we demonstrate the capability of our model as well as showcase your voice model. If Clients are interested, you will be notified and we will move forward only with your written permission. This is solely for the purpose of evaluating or pitching your voice for a specific role, and never for public or commercial use.",
    tags: ["internal", "testing", "pocs"],
  },
  {
    id: "faq_voice_jurisdiction",
    category: "Voice Artists",
    question: "Jurisdiction in the US - if there is any problem, it is of course beyond our ability to solve the case in the US.",
    answer: "We understand your concern. The team needed to have a common jurisdiction as we work with voice actors from all over the world.",
    tags: ["jurisdiction", "legal", "us"],
  },
  // Billing & Payment
  {
    id: "faq_invoice_submission",
    category: "Billing and Payment",
    question: "How do I submit my invoice?",
    answer: "Global3 is working on a more streamlined process that will integrate invoice generation into our platform. Until then, please submit invoices to payables@global3.io",
    tags: ["invoice", "billing", "payment"],
  },
  {
    id: "faq_billing_information_change",
    category: "Billing and Payment",
    question: "HOW DO I CHANGE MY BILLING INFORMATION?",
    answer: "For any changes to your contract, including billing information, please write to resources@global3.io",
    tags: ["billing", "change", "contact"],
  },
  {
    id: "faq_payment_terms_net30",
    category: "Billing and Payment",
    question: "What are the payment terms? (excluding voice actors)",
    answer: "The payment terms are in your contract (Exhibit A) - Net30. That is: 30 days from the end of the month in which the services were provided. We would need your invoice before the 5th of the following month so we can process the payment on a timely basis.",
    tags: ["payment", "terms", "net30", "pmt", "pay"],
  },
  {
    id: "faq_payment_methods",
    category: "Billing and Payment",
    question: "What payment methods do you accept, and who covers transfer fees?",
    answer: "We accept the following payment methods: • WISE (preferred) – Global3 covers all transfer fees • PayPal – You can choose to cover the fee or we can split it. Payment Terms: Net 30 (invoices are paid within 30 days of submission)",
    tags: ["payment", "methods", "transfer", "pmt", "pay"],
  },
  // Onboarding Queries
  {
    id: "faq_onboarding_apply",
    category: "Onboarding Queries",
    question: "How do I apply to work with G3?",
    answer: "You can apply through our onboarding portal: https://app.global3.io/apply",
    tags: ["apply", "onboarding", "portal"],
  },
  {
    id: "faq_onboarding_steps",
    category: "Onboarding Queries",
    question: "What are the steps after I apply?",
    answer: "Verification → Signing the MSA → Payment details setup → Username & Password creation →Training → Paid evaluation task →Feedback by Language Lead → Project assignment.",
    tags: ["onboarding", "steps", "process"],
  },
  {
    id: "faq_identity_verification",
    category: "Onboarding Queries",
    question: "Why do I need to verify my identity?",
    answer: "It's part of our standard KYC (Know Your Customer) process, done through Veriff (identity verification). It's tied directly to payment processing — WISE and our finance systems require verified identity before we can process any payouts. It's a security/anti-fraud measure to confirm the person signing the MSA and getting paid is genuinely who they claim to be — protects both the linguist and G3. If photo ID via Veriff is a blocker for the linguists specifically, we do have a manual verification alternative via video call. If you're not comfortable uploading documents online, we can arrange a video call or manual document review instead.",
    tags: ["identity", "verification", "kyc"],
  },
  {
    id: "faq_msa_definition",
    category: "Onboarding Queries",
    question: "What is the MSA?",
    answer: "The Master Service Agreement outlines the terms of working with G3 as a freelancer — you'll review and sign this as part of onboarding.",
    tags: ["msa", "agreement", "terms"],
  },
  {
    id: "faq_payment_timing",
    category: "Onboarding Queries",
    question: "How and when do I get paid?",
    answer: "Payment terms are Net 30. Invoices are submitted monthly by the 5th via this form: https://tally.so/r/w842z5",
    tags: ["payment", "timing", "invoice", "pmt", "pay"],
  },
  {
    id: "faq_payment_methods_support",
    category: "Onboarding Queries",
    question: "What payment methods do you support?",
    answer: "WISE is preferred (G3 covers the transfer fees); PayPal is also accepted.",
    tags: ["payment", "methods", "support", "pmt", "pay"],
  },
  {
    id: "faq_training_required",
    category: "Onboarding Queries",
    question: "Is training required?",
    answer: "Yes — our team provides platform and workflow training, typically starting within 2–3 business days of your application being reviewed.",
    tags: ["training", "required", "onboarding"],
  },
  {
    id: "faq_evaluation_test",
    category: "Onboarding Queries",
    question: "Is there a test before I start getting projects?",
    answer: "Yes, most applicants complete a paid evaluation task to assess work quality before regular project assignment.",
    tags: ["evaluation", "test", "assignment"],
  },
  {
    id: "faq_onboarding_duration",
    category: "Onboarding Queries",
    question: "How long does the whole onboarding process take?",
    answer: "Training typically begins within 2–3 business days of completing onboarding, followed by an evaluation task. Once training is complete, project assignments are made based on availability and your language requirements. Please note that assignments depend entirely on project availability and language demand at the time. We are unable to guarantee a minimum volume of work, as this varies by project and language requirements.",
    tags: ["onboarding", "duration", "timeline"],
  },
  {
    id: "faq_multiple_languages",
    category: "Onboarding Queries",
    question: "Can I apply for more than one language or service type?",
    answer: "Yes — you can indicate multiple languages/services on your application, and we'll match you to relevant opportunities.",
    tags: ["languages", "services", "apply"],
  },
  {
    id: "faq_id_sharing",
    category: "Onboarding Queries",
    question: "What if I don't want to share my ID/personal documents right away?",
    answer: "Totally understandable — we can offer alternatives like a video call verification or manual document review instead of an online upload.",
    tags: ["id", "documents", "verification"],
  },
  {
    id: "faq_id_type_not_accepted",
    category: "Onboarding Queries",
    question: "What if my country's ID type is not accepted by Veriff (e.g., Japanese My Number Card, Egyptian National ID)?",
    answer: "If Veriff does not accept your national ID, you have two options: 1. Use an alternative government-issued document (passport, driver's license, etc.) 2. Contact our team for a manual review. We can conduct a video call verification where you can present your ID directly to our team. Please provide high-quality copies of both sides of your ID and a clear selfie holding your ID for manual verification.",
    tags: ["id", "alternative", "manual"],
  },
  {
    id: "faq_msa_preview",
    category: "Onboarding Queries",
    question: "Can I review the Master Service Agreement (MSA) before completing identity verification?",
    answer: "Yes! The MSA is integrated directly into our onboarding platform, so you can review all contract terms before signing. You can go through it at your own pace and reach out with any questions before committing. We're also happy to send you the MSA in advance if you prefer to review it before starting verification.",
    tags: ["msa", "review", "preview"],
  },
  {
    id: "faq_standard_rates",
    category: "Onboarding Queries",
    question: "What are the standard rates for my language and service type?",
    answer: "Rates vary by language, service type, and project complexity. Here are some examples: • Subtitle Creation: varies per RTM • Subtitle QC: varies per RTM • Dubbing Adaptation (Lip-sync): varies per RTM • Dubbing QC: varies per RTM. Note: For linguists with exceptional experience and specialized skills, we do consider premium rates on a case-by-case basis. Specific rates for your language pair will be communicated during project assignment.",
    tags: ["rates", "pricing", "language", "salary", "pmt"],
  },
  {
    id: "faq_voice_training_ai",
    category: "Onboarding Queries",
    question: "Will my Voice be used to train AI?",
    answer: "If You're Applying as a Linguist/Dubbing Adaptor: No. Your voice will NOT be used to train AI. As a linguist or dubbing adaptor, you'll be: Writing and adapting scripts for lip-sync dubbing, Creating dialogue that matches on-screen performances, Reviewing and editing localized content. No voice recording or voice cloning required. Your work is purely linguistic/creative—your voice is never collected or used.",
    tags: ["voice", "ai", "training"],
  },
  {
    id: "faq_otp_code",
    category: "Onboarding Queries",
    question: "I never received the OTP/6-digit code. What should I do?",
    answer: "The 6-digit code is generated by an authenticator app (e.g. Google Authenticator) — it is not sent via email. Download the app, scan the QR code on the login screen, and enter the code generated.",
    tags: ["otp", "authentication", "code"],
  },
  // Voice Cloning Training
  {
    id: "faq_voice_training_duration",
    category: "Voice Cloning Training",
    question: "How long is the training session on July 28 or 29 expected to last? More than an hour?",
    answer: "The Training is expected to take 1 hour or less. However, we want to be prepared for questions or LIVE practice together, so please set aside 2 hours for the same.",
    tags: ["training", "schedule"],
  },
  {
    id: "faq_voice_training_payment",
    category: "Voice Cloning Training",
    question: "Is the $500 payment meant to cover both the training and the creation of one voice model only, or does it also include the second model?",
    answer: "Training + 1st voice model is $500. The second voice model will be an additional $500.",
    tags: ["payment", "rate", "voice model", "pmt", "pay"],
  },
  {
    id: "faq_voice_training_audio_material",
    category: "Voice Cloning Training",
    question: "Will you be providing the audio material for the trainers to base the voice clones on?",
    answer: "Confirming that the project will be set up within the Global3 platform for you to create the voice models.",
    tags: ["training", "voice model"],
  },
  {
    id: "faq_voice_training_tools",
    category: "Voice Cloning Training",
    question: "Are there specific tools or platforms we'll be using for the cloning process, or is that up to us?",
    answer: "You will be using the Global3 platform to create the voice models. Would appreciate it if you can go through the Learning platform and Training Task on G3 to accustom yourself with the tool. We will also be conducting regular DUB creation training over next week. Please join us for the same as it would be great for you to understand the audio generation process within Global3 in order to perform the task between 11th August till end of the month. Will share additional details regarding that in a separate email.",
    tags: ["training", "tools", "platform"],
  },
  {
    id: "faq_voice_training_delivery_format",
    category: "Voice Cloning Training",
    question: "What format and delivery method should we use for submitting the voice models?",
    answer: "The voices have to be saved within the Global3 platform. The process will be showcased during the upcoming training.",
    tags: ["delivery", "voice model"],
  },
  {
    id: "faq_voice_training_qc_volume_deadline",
    category: "Voice Cloning Training",
    question: "Lastly, do you already have a rough estimate of how many videos or how much content I'll be reviewing for QC/QA starting August 11? What's the deadline for the job?",
    answer: "We would expect around 10 minutes of runtime video to be worked on per day. It would depend on the content, and the speed with which you can complete the task. This process involves creation of the dubbed audio and QC.",
    tags: ["qc", "workload", "deadline"],
  },
  {
    id: "faq_voice_training_qc_pay_unit",
    category: "Voice Cloning Training",
    question: "Will the QC tasks be paid per hour or per runtime minute?",
    answer: "The rates will be confirmed next week.",
    tags: ["qc", "rate", "payment", "pmt", "pay"],
  },
  {
    id: "faq_voice_training_availability",
    category: "Voice Cloning Training",
    question: "How much availability would you estimate is needed over the coming days and between August 11th and 31st?",
    answer: "Estimate an average 6-8 hours to create a voice. Please note it will be done on the content, style of exercise trainer, and individual speed as well as expertise.",
    tags: ["availability", "schedule"],
  },
  {
    id: "faq_voice_training_guidelines_pay",
    category: "Voice Cloning Training",
    question: "Will the project guidelines and glossaries be provided in advance, or would that also fall under the QC's responsibilities? If so, would those additional tasks be paid per hour?",
    answer: "The glossary is provided by the client and will be available within the task application.",
    tags: ["guidelines", "glossary", "qc"],
  },
  {
    id: "faq_voice_training_qc_expectations",
    category: "Voice Cloning Training",
    question: "What are the quality expectations for the QC role? For example, is the focus primarily on term consistency or on ensuring that the final result sounds human-like?",
    answer: "The QC task has to be through to ensure consistency as well as make sure that the audio captures the content appropriately.",
    tags: ["qc", "quality"],
  },
  {
    id: "faq_voice_training_qc_turnaround",
    category: "Voice Cloning Training",
    question: "Once a dubber submits their work, how much time will the QC have to complete the review?",
    answer: "The Timeline is about 20 or more minutes of QC in a day. You will have a day to perform the QC.",
    tags: ["qc", "turnaround"],
  },
];

async function main() {
  // Clean up any old synthetic dummy accounts and their dependent rows
  const dummyEmails = ["mathu@global3.co", "divya@global3.co", "varsha@global3.co", "sharmistha@global3.co", "sunaina@global3.co"];
  const dummyUsers = await prisma.user.findMany({ where: { email: { in: dummyEmails } }, select: { id: true } });
  const dummyIds = dummyUsers.map((u: any) => u.id);

  if (dummyIds.length > 0) {
    const snapshots = await prisma.recruiterScoreSnapshot.findMany({
      where: { recruiterId: { in: dummyIds } },
      select: { id: true },
    });
    const snapshotIds = snapshots.map((s: any) => s.id);
    if (snapshotIds.length > 0) {
      await prisma.recruiterMetricSnapshot.deleteMany({ where: { scoreSnapshotId: { in: snapshotIds } } });
      await prisma.recruiterScoreSnapshot.deleteMany({ where: { id: { in: snapshotIds } } });
    }
    await prisma.recruiterKpiSummary.deleteMany({ where: { recruiterId: { in: dummyIds } } });
    await prisma.requirement.updateMany({ where: { recruiterId: { in: dummyIds } }, data: { recruiterId: null } });
    await prisma.user.deleteMany({ where: { id: { in: dummyIds } } });
    console.log(`Cleaned up ${dummyIds.length} synthetic dummy accounts.`);
  }

  for (const u of DEMO_USERS) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {
        name: u.name,
        role: u.role,
      },
      create: {
        name: u.name,
        email: u.email,
        role: u.role,
        languages: u.languages,
        emailVerified: true,
        isActive: true,
      },
    });
    console.log(`Seeded user ${u.name} (${u.email}) [${u.role}]`);
  }

  for (const f of FAQ_ENTRIES) {
    await prisma.faqEntry.upsert({
      where: { id: f.id },
      update: { category: f.category, question: f.question, answer: f.answer, tags: f.tags },
      create: f,
    });
    console.log(`Seeded FAQ: ${f.id}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
