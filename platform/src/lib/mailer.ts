// Sends email, or — until a Resend key is configured — prints it to the console.
//
// Nothing in Acadlas depends on email arriving: an invitation also comes back to the
// person who sent it as a link they can copy or share on WhatsApp, which is how most
// school staff in India would rather receive it anyway.
type Mail = {
  to: string;
  subject: string;
  text: string;
};

export async function sendMail(mail: Mail): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;

  if (!apiKey || !from) {
    console.log(`\n[mail, not sent — RESEND_API_KEY not set]\nTo: ${mail.to}\nSubject: ${mail.subject}\n\n${mail.text}\n`);
    return;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, text: mail.text }),
  });

  if (!response.ok) {
    // Logged rather than thrown: a mail outage must not undo the invitation or reset
    // request that triggered it. The person can still be sent the link by hand.
    console.error(`[mail] Resend refused the message to ${mail.to}: ${response.status} ${await response.text()}`);
  }
}

/** Where the browser app lives — the base of every link we send. */
export function appUrl(): string {
  return (process.env.APP_URL ?? (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(',')[0]).replace(/\/$/, '');
}
