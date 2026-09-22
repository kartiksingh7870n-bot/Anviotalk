export interface PolicySection {
  title: string;
  content: string[];
  bullets?: string[];
}

export interface LegalPolicy {
  id: string;
  path: string;
  title: string;
  category: string;
  lastUpdated: string;
  summary: string;
  sections: PolicySection[];
}

export const LEGAL_POLICIES_DATA: Record<string, LegalPolicy> = {
  '/privacy-policy': {
    id: 'privacy-policy',
    path: '/privacy-policy',
    title: 'Privacy Policy',
    category: 'Privacy & Data Handling',
    lastUpdated: 'August 1, 2026',
    summary: 'Comprehensive details on how Anvio Talk collects, uses, stores, and protects your personal information under Indian data protection laws.',
    sections: [
      {
        title: '1. Introduction & Overview',
        content: [
          'Anvio Talk ("we", "our", or "us") operates the Anvio Talk location-based social networking and creative discovery platform. We are committed to protecting your privacy and ensuring transparency regarding how your personal data is collected, stored, processed, and shared.',
          'This Privacy Policy applies to all users of the Anvio Talk mobile application, web platform, and related services. By accessing or using Anvio Talk, you consent to the practices described in this policy.'
        ]
      },
      {
        title: '2. Personal Data We Collect',
        content: [
          'To provide our location-aware matching, real-time messaging, and spatial audio features, Anvio Talk collects the following types of information:'
        ],
        bullets: [
          'Identity & Profile Data: Full name, display name, email address, date of birth, age, gender, self-declared bio, creative skills/tags, and profile photos.',
          'Location & Spatial Data: Precise GPS coordinates and geographical location (with your explicit permission) to calculate nearby creator distances and display interactive map pins.',
          'Communication & Interaction Data: In-app chat messages, audio messages, group conversation activity, voice salon participation logs, and user reaction history.',
          'Media & User Content: Photos, profile gallery uploads, voice snippets, and shared media files.',
          'Device & Technical Diagnostics: Device model, operating system version, unique device identifiers, IP address, app installation ID, push notification tokens, crash reports, and system logs.'
        ]
      },
      {
        title: '3. How We Use Your Information',
        content: [
          'We process your personal data for the following legitimate business and service delivery purposes:'
        ],
        bullets: [
          'Connecting Creators Nearby: Computing geographical proximity to showcase nearby artists, creators, and matches on the interactive discovery map.',
          'Facilitating Communication: Delivering real-time direct messages, group chat threads, push notifications, and spatial audio salons.',
          'Safety & Security Enforcement: Detecting automated bots, preventing harassment, verifying 18+ age eligibility, and investigating user reports.',
          'Platform Personalization: Recommending relevant creative skills, local events, and spatial audio groups based on your preferences.',
          'Service Improvements: Analyzing platform usage trends, resolving bug reports, and optimizing system performance.'
        ]
      },
      {
        title: '4. Data Storage & Infrastructure Architecture',
        content: [
          'Anvio Talk leverages enterprise-grade cloud infrastructure for data hosting and authentication.',
          'Account credentials and real-time database state are securely stored on Google Cloud / Firebase Firestore and Firebase Authentication with strict security rules. User uploaded imagery and media assets are stored on encrypted Cloudinary and Firebase Storage buckets.',
          'All communications between your device and our servers utilize industry-standard TLS 1.3 encryption in transit.'
        ]
      },
      {
        title: '5. Third-Party Integrations & Services',
        content: [
          'We share data with verified third-party service providers strictly necessary to operate our platform:'
        ],
        bullets: [
          'Firebase (Google Cloud Platform): Authentication, Firestore cloud database, and Firebase Cloud Messaging (FCM) for push notifications.',
          'Cloudinary API: Encrypted image processing and optimized avatar media hosting.',
          'Capacitor Native Plugins: Secure device hardware integration for geolocation, camera, and push notification tokens.'
        ]
      },
      {
        title: '6. Statutory Compliance with Indian Law (DPDP Act 2023)',
        content: [
          'For users residing in India, Anvio Talk complies with the Digital Personal Data Protection Act, 2023 (DPDP Act 2023) and the Information Technology Act, 2000.',
          'You retain full statutory rights to access your personal data, request corrections to inaccurate records, withdraw processing consent, and request complete erasure of your data.'
        ]
      },
      {
        title: '7. Your Data Rights & Retention Period',
        content: [
          'You have the right to access, export, or permanently delete your account data at any time via Profile Settings or by emailing privacy@anviotalk.in.',
          'We retain active user data for as long as your account remains open. Upon receiving an account deletion request, your public profile and map pins are immediately removed, and server backup logs are purged within 30 calendar days.'
        ]
      },
      {
        title: '8. Contact Information & Data Protection Officer',
        content: [
          'If you have questions, grievances, or requests regarding this Privacy Policy, please contact our Data Protection Office:',
          'Email: privacy@anviotalk.in | Support: support@anviotalk.in'
        ]
      }
    ]
  },

  '/terms-and-conditions': {
    id: 'terms-and-conditions',
    path: '/terms-and-conditions',
    title: 'Terms & Conditions',
    category: 'Legal Agreements',
    lastUpdated: 'August 1, 2026',
    summary: 'The binding terms of service governing your access to and use of the Anvio Talk platform.',
    sections: [
      {
        title: '1. Acceptance of Terms',
        content: [
          'By downloading, accessing, or using the Anvio Talk mobile app or website, you enter into a legally binding agreement with Anvio Talk. If you do not agree to all terms herein, you must immediately cease using the platform.'
        ]
      },
      {
        title: '2. Eligibility (Strict 18+ Requirement)',
        content: [
          'You must be at least 18 years of age to register or use Anvio Talk. By creating an account, you affirm under penalty of perjury that you are 18 years of age or older.',
          'If we discover or have reason to suspect that a user is under 18 years old, their account will be terminated immediately without notice.'
        ]
      },
      {
        title: '3. User Accounts & Security',
        content: [
          'You are responsible for maintaining the confidentiality of your login credentials and for all activities occurring under your account.',
          'You agree to provide accurate, current, and truthful account information during registration and profile creation.'
        ]
      },
      {
        title: '4. Acceptable Use & Conduct Boundaries',
        content: [
          'You agree to use Anvio Talk solely for lawful, respectful social networking and creative discovery. You agree NOT to:'
        ],
        bullets: [
          'Harass, stalk, intimidate, threaten, or defame any user.',
          'Post or transmit explicit nudity, sexually non-consensual content, or hate speech.',
          'Use automated bots, web scrapers, or unauthorized API clients.',
          'Solicit financial payments, run unauthorized commercial promotions, or commit fraudulent scams.',
          'Impersonate any person, brand, or entity.'
        ]
      },
      {
        title: '5. Content Ownership & Licensing Grant',
        content: [
          'You retain full intellectual property ownership of all photos, text, and media you post on Anvio Talk.',
          'However, by uploading content to Anvio Talk, you grant us a worldwide, non-exclusive, royalty-free, transferable license to host, display, reproduce, and distribute such content solely for operating and promoting the platform.'
        ]
      },
      {
        title: '6. Account Suspension & Termination',
        content: [
          'Anvio Talk reserves the right, in its sole discretion, to suspend, restrict, or permanently ban any user account at any time for violation of these Terms, Community Guidelines, or applicable laws, without prior liability.'
        ]
      },
      {
        title: '7. Governing Law & Jurisdiction',
        content: [
          'These Terms & Conditions are governed by and construed in accordance with the laws of India. Any disputes arising out of or in connection with these terms shall be subject to the exclusive jurisdiction of the competent courts in India.'
        ]
      }
    ]
  },

  '/community-guidelines': {
    id: 'community-guidelines',
    path: '/community-guidelines',
    title: 'Community Guidelines',
    category: 'Safety & Conduct',
    lastUpdated: 'August 1, 2026',
    summary: 'Our standards for maintaining a respectful, safe, and positive space for creators and matches.',
    sections: [
      {
        title: '1. Our Core Philosophy',
        content: [
          'Anvio Talk is built to foster genuine creative connections and meaningful discovery. We maintain a zero-tolerance policy against toxicity, abuse, discrimination, and unsafe behavior.'
        ]
      },
      {
        title: '2. Respect & Kindness First',
        content: [
          'Treat fellow members with empathy and courtesy. Disagreements must remain respectful. Personal attacks, harassment, doxxing, and hate speech targeting race, ethnicity, religion, gender, disability, or sexual orientation will result in permanent removal.'
        ]
      },
      {
        title: '3. Explicit Content & Nudity Rules',
        content: [
          'Pornography, explicit sexual imagery, non-consensual sexual content, and graphic violence are strictly forbidden across profile photos, public map posts, chat media, and spatial audio salons.'
        ]
      },
      {
        title: '4. Authenticity & Anti-Impersonation',
        content: [
          'Catfishing, creating fake profiles using another person’s photos, or operating deceptive promotional accounts is prohibited. Be yourself.'
        ]
      },
      {
        title: '5. Scams, Financial Solicitations & Spam',
        content: [
          'Do not solicit money, wire transfers, crypto investments, or financial aid from other members. Unsolicited commercial broadcast spam in direct messages or group chats will result in an immediate automatic ban.'
        ]
      },
      {
        title: '6. Reporting & Enforcement Flow',
        content: [
          'Every profile, direct message, and group chat includes built-in "Report" tools. Our moderation team reviews reported violations 24/7. Enforcement actions include content removal, formal warnings, temporary account holds, or permanent device bans.'
        ]
      }
    ]
  },

  '/delete-account-policy': {
    id: 'delete-account-policy',
    path: '/delete-account-policy',
    title: 'Delete Account Policy',
    category: 'Account Management',
    lastUpdated: 'August 1, 2026',
    summary: 'Clear instructions and timelines for permanently removing your Anvio Talk account and personal data.',
    sections: [
      {
        title: '1. Self-Service In-App Deletion',
        content: [
          'You can delete your account at any time directly within the Anvio Talk app without contacting support:',
          'Step 1: Open Profile Tab in the bottom navigation bar.',
          'Step 2: Scroll down to Profile Settings & Privacy.',
          'Step 3: Tap "Delete Account" and confirm your choice.'
        ]
      },
      {
        title: '2. Email Request Method',
        content: [
          'If you cannot access your account in-app, you may send a deletion request from your registered email address to support@anviotalk.in with the subject line "Account Deletion Request". Our team will process your request within 48 hours.'
        ]
      },
      {
        title: '3. What Gets Deleted Immediately',
        content: [
          'Upon confirming account deletion, the following data is permanently purged from active systems:'
        ],
        bullets: [
          'Your profile information, bio, creative skills, and gallery photos.',
          'Your interactive map location markers and discovery profile card.',
          'Your active direct messaging threads and group chat memberships.',
          'Your device push notification tokens and session credentials.'
        ]
      },
      {
        title: '4. Server Backup Retention Window',
        content: [
          'To guard against accidental deletion or malicious account compromise, encrypted system back-ups retain residual database snapshots for a maximum of 30 calendar days before complete automated purging.',
          'After 30 days, all associated data is permanently unrecoverable.'
        ]
      }
    ]
  },

  '/contact-us': {
    id: 'contact-us',
    path: '/contact-us',
    title: 'Contact Us',
    category: 'Support & Inquiries',
    lastUpdated: 'August 1, 2026',
    summary: 'Get in touch with the Anvio Talk team for support, privacy queries, safety reports, or business inquiries.',
    sections: [
      {
        title: '1. Customer Support & General Help',
        content: [
          'For assistance with your account, app features, technical bugs, or login issues:',
          'Email: support@anviotalk.in',
          'Typical Response Time: 24 to 48 business hours.'
        ]
      },
      {
        title: '2. Privacy & Data Rights Requests',
        content: [
          'For DPDP Act compliance, data access requests, or privacy concerns:',
          'Email: privacy@anviotalk.in'
        ]
      },
      {
        title: '3. Grievance Officer (India DPDP Act Requirement)',
        content: [
          'In accordance with the Information Technology Act 2000 and DPDP Act 2023 rules:',
          'Name: Grievance Officer, Anvio Talk India',
          'Email: grievance@anviotalk.in',
          'Address: Anvio Talk Digital Technologies Pvt. Ltd., New Delhi, India'
        ]
      },
      {
        title: '4. Copyright & DMCA Takedown Contact',
        content: [
          'For copyright infringement claims:',
          'Email: copyright@anviotalk.in'
        ]
      }
    ]
  },

  '/refund-policy': {
    id: 'refund-policy',
    path: '/refund-policy',
    title: 'Refund Policy',
    category: 'Billing & Transactions',
    lastUpdated: 'August 1, 2026',
    summary: 'Guidelines on purchase refunds, digital coin credits, and subscription cancellations.',
    sections: [
      {
        title: '1. Current Platform Pricing Overview',
        content: [
          'Anvio Talk core discovery, location mapping, and direct messaging features are currently free for all members.',
          'As premium VIP memberships, creator tipping coins, and promoted map highlight features are introduced, this Refund Policy governs all monetary transactions.'
        ]
      },
      {
        title: '2. Refund Eligibility Criteria',
        content: [
          'Refunds for paid digital features or virtual coin packages may be granted under the following circumstances:'
        ],
        bullets: [
          'Technical error resulting in duplicate charges for a single purchase.',
          'Paid virtual items or coins not credited to your account due to server failure.',
          'Unbilled subscription renewal requested within 24 hours of charge.'
        ]
      },
      {
        title: '3. Non-Refundable Items',
        content: [
          'Digital coins, virtual gifts, or boost tokens that have already been spent or consumed within the app are strictly non-refundable.'
        ]
      },
      {
        title: '4. How to Request a Refund',
        content: [
          'To request a refund, email billing@anviotalk.in with your registered email, order receipt/transaction ID, and reason for the request.',
          'Approved refunds will be processed back to your original payment method within 5 to 7 business days.'
        ]
      }
    ]
  },

  '/cookie-policy': {
    id: 'cookie-policy',
    path: '/cookie-policy',
    title: 'Cookie & Storage Policy',
    category: 'Technical & Tracking',
    lastUpdated: 'August 1, 2026',
    summary: 'How Anvio Talk utilizes browser storage, tokens, and cookies to deliver a seamless app experience.',
    sections: [
      {
        title: '1. What Are Cookies & Local Storage?',
        content: [
          'Cookies and local browser storage (localStorage / sessionStorage) are small data files saved on your device to remember preferences, keep you logged in, and optimize app loading speed.'
        ]
      },
      {
        title: '2. Technologies We Use',
        content: [
          'Anvio Talk utilizes the following storage mechanisms:'
        ],
        bullets: [
          'Essential Auth Tokens: Secure session tokens managed by Firebase Auth to maintain your logged-in state across app restarts.',
          'Local State Storage: Browser localStorage for remembering onboarding preferences, audio volume settings, and map filter toggles.',
          'Service Worker Cache: Caching static graphics and icons for rapid offline loading.'
        ]
      },
      {
        title: '3. Third-Party Tracking Statement',
        content: [
          'Anvio Talk DOES NOT use invasive third-party ad-tracking cookies or sell your browsing history to advertisers. All local storage data is used strictly for core app functionality.'
        ]
      },
      {
        title: '4. Controlling Storage',
        content: [
          'You can clear local storage or cookies at any time through your web browser or device app settings. Note that clearing authentication tokens will log you out of your account.'
        ]
      }
    ]
  },

  '/safety-tips': {
    id: 'safety-tips',
    path: '/safety-tips',
    title: 'Safety Tips for Dating',
    category: 'User Safety',
    lastUpdated: 'August 1, 2026',
    summary: 'Essential safety rules and advice for interacting with new connections online and in person.',
    sections: [
      {
        title: '1. Guard Your Personal Details Online',
        content: [
          'Never share sensitive personal information—such as your home address, financial details, bank account numbers, workplace address, or daily routine—with someone you just matched with on Anvio Talk.'
        ]
      },
      {
        title: '2. Keep Conversations In-App First',
        content: [
          'Use Anvio Talk direct messaging, voice notes, and spatial audio salons to build trust before exchanging personal phone numbers, WhatsApp, or personal social media handles.'
        ]
      },
      {
        title: '3. Video or Voice Call Before Meeting',
        content: [
          'Host a quick audio or video chat prior to an in-person date to verify the person matches their profile photos and personality.'
        ]
      },
      {
        title: '4. Always Meet in Busy, Public Places',
        content: [
          'For your first few in-person meetings, choose well-lit, popular public venues such as busy cafes, public art galleries, or central restaurants. Never agree to meet at a private residence or isolated location.'
        ]
      },
      {
        title: '5. Tell a Friend or Family Member',
        content: [
          'Inform a trusted friend or relative about your plans, including who you are meeting, where you are going, and what time you expect to return. Share your live location with them.'
        ]
      },
      {
        title: '6. Arrange Your Own Transport',
        content: [
          'Control your own arrival and departure. Drive yourself or use an independent rideshare app so you can leave at any time.'
        ]
      },
      {
        title: '7. Trust Your Instincts & Report Violations',
        content: [
          'If you ever feel uncomfortable, pressured, or threatened, end the date immediately. Use the in-app Report button on their profile to alert our safety team.'
        ]
      }
    ]
  },

  '/dmca-copyright-policy': {
    id: 'dmca-copyright-policy',
    path: '/dmca-copyright-policy',
    title: 'DMCA & Copyright Policy',
    category: 'Intellectual Property',
    lastUpdated: 'August 1, 2026',
    summary: 'Notice and procedure for reporting intellectual property infringement on Anvio Talk.',
    sections: [
      {
        title: '1. Respect for Intellectual Property',
        content: [
          'Anvio Talk respects the intellectual property rights of creators and expects users to do the same. We respond promptly to notices of alleged copyright infringement under applicable copyright laws.'
        ]
      },
      {
        title: '2. Submitting a Copyright Takedown Notice',
        content: [
          'If you believe that material hosted on Anvio Talk infringes your copyright, please submit a written notice to copyright@anviotalk.in including:'
        ],
        bullets: [
          'Physical or electronic signature of the copyright owner or authorized representative.',
          'Identification of the copyrighted work claimed to have been infringed.',
          'Identification of the material that is claimed to be infringing and its location (URL, user handle, or profile link).',
          'Your contact details: address, telephone number, and email address.',
          'A statement that you have a good faith belief that the use of the material is not authorized by the copyright owner.',
          'A statement under penalty of perjury that the information in the notification is accurate.'
        ]
      },
      {
        title: '3. Counter-Notification Procedure',
        content: [
          'If your content was removed due to a copyright notice and you believe it was removed by mistake or misidentification, you may submit a counter-notice to copyright@anviotalk.in.'
        ]
      },
      {
        title: '4. Repeat Infringer Policy',
        content: [
          'Anvio Talk will terminate the accounts of users who are found to be repeat infringers of intellectual property rights.'
        ]
      }
    ]
  },

  '/content-moderation-policy': {
    id: 'content-moderation-policy',
    path: '/content-moderation-policy',
    title: 'Content Moderation Policy',
    category: 'Moderation & Appeals',
    lastUpdated: 'August 1, 2026',
    summary: 'How Anvio Talk monitors, reviews, and moderates user-generated content and handles appeals.',
    sections: [
      {
        title: '1. Moderation Systems Overview',
        content: [
          'Anvio Talk employs a hybrid moderation system combining automated safety filters (detecting explicit images, spam links, and offensive text) with human moderation review.'
        ]
      },
      {
        title: '2. Review Turnaround Times',
        content: [
          'User reports regarding safety, harassment, or explicit content are triaged automatically and reviewed by human moderators within 12 to 24 hours. Critical safety threats are addressed immediately.'
        ]
      },
      {
        title: '3. Progressive Enforcement Tiers',
        content: [
          'When violations are confirmed, moderators apply appropriate enforcement actions based on severity:'
        ],
        bullets: [
          'Tier 1 - Content Removal & Advisory Warning: Applied for minor or first-time guideline breaches.',
          'Tier 2 - Account Feature Hold (24h - 7 Days): Restricted messaging or map discovery privileges for repeated minor infractions.',
          'Tier 3 - Permanent Device & Account Ban: Applied immediately for severe violations, explicit content, scams, harassment, or underage accounts.'
        ]
      },
      {
        title: '4. Appeals Process',
        content: [
          'If you believe your account or content was restricted in error, you may file an appeal by emailing appeals@anviotalk.in within 14 days of the enforcement action. Provide your user ID and explanation. Our senior safety team will review your case within 3 business days.'
        ]
      }
    ]
  }
};
