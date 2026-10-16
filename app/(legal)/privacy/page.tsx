import { APP_NAME, COMPANY } from "@/lib/brand";

export const metadata = { title: "Privacy Policy" };

export default function Privacy() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p>
        {APP_NAME} is operated by {COMPANY} (&ldquo;we&rdquo;). This policy explains how we process personal data in line with the
        Nigeria Data Protection Act 2023 and guidance from the Nigeria Data Protection Commission.
      </p>
      <h2>What we collect</h2>
      <ul>
        <li>Account data: name, email address, password hash or Google sign-in identifier.</li>
        <li>Workspace content: posts, media you upload, brand profile settings.</li>
        <li>Connected social accounts: account names and IDs, and access tokens granted through each platform&apos;s official login. Tokens are encrypted at rest (AES-256).</li>
        <li>Billing data handled by Paystack/Flutterwave; we do not store card numbers.</li>
        <li>Usage and audit logs for security and support.</li>
      </ul>
      <h2>Why we process it (lawful basis)</h2>
      <p>To provide the service you signed up for (contract), to secure the platform (legitimate interest), and to meet legal obligations.</p>
      <h2>AI processing</h2>
      <p>Draft text and brand profile details are sent to our AI provider to generate platform-specific versions. They are not used to train public models.</p>
      <h2>Sharing</h2>
      <p>We share data only with the social platforms you choose to publish to, and with service providers (hosting, email, payments, AI) under contract.</p>
      <h2>Retention and deletion</h2>
      <p>
        Disconnecting a social account deletes its stored tokens. Deleting a workspace deletes its posts, media and tokens. You can
        request deletion of your account at any time — see our Data Deletion page.
      </p>
      <h2>Your rights</h2>
      <p>You may request access, correction, deletion or portability of your data, or object to processing, by contacting privacy@markvtech.example.</p>
      <h2>Breaches</h2>
      <p>We will notify affected users and the NDPC of personal data breaches as required by law.</p>
    </>
  );
}
