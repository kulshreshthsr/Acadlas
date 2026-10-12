// Navigation shared by the header and footer. Every href is an in-page anchor that exists on the homepage.
export const navLinks = [
  { label: 'Why Acadlas', href: '#why' },
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Capabilities', href: '#capabilities' },
  { label: 'FAQ', href: '#faq' },
] as const;

// Where pilot-school enquiries go. Leave empty until the Acadlas inbox exists:
// while it is empty, the page hides every "email us" action instead of linking to a dead address.
export const contactEmail = '';
