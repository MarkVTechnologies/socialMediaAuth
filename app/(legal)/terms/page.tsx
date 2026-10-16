import { APP_NAME, COMPANY } from "@/lib/brand";

export const metadata = { title: "Terms of Service" };

export default function Terms() {
  return (
    <>
      <h1>Terms of Service</h1>
      <p>These terms govern your use of {APP_NAME}, provided by {COMPANY}.</p>
      <h2>Your content</h2>
      <p>
        You own the content you upload and publish. You are responsible for ensuring it complies with the law and with each
        platform&apos;s policies. AI-generated versions are suggestions; review them before publishing.
      </p>
      <h2>Platform rules</h2>
      <p>
        Publishing depends on third-party platforms (Meta, Google/YouTube, TikTok, LinkedIn). They may change or restrict their APIs
        at any time; we will make reasonable efforts to keep integrations working but cannot guarantee availability.
      </p>
      <h2>WhatsApp Status autopost</h2>
      <p>
        This optional feature uses an unofficial gateway not supported by Meta and may result in your number being restricted or
        banned. You use it at your own risk after accepting the in-app risk notice.
      </p>
      <h2>Subscriptions</h2>
      <p>
        Plans renew automatically until cancelled. If a payment fails, scheduled posts are paused (not deleted) until billing is
        updated. Usage limits apply per plan.
      </p>
      <h2>Acceptable use</h2>
      <p>No spam, misleading financial claims, illegal products, harassment, or attempts to abuse platform APIs.</p>
      <h2>Liability</h2>
      <p>The service is provided &ldquo;as is&rdquo;. Our liability is limited to the fees you paid in the previous three months.</p>
    </>
  );
}
