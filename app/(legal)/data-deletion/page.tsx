import { get } from "@/lib/db";
import { APP_NAME } from "@/lib/brand";

export const metadata = { title: "Data deletion" };

export default async function DataDeletion({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams;
  const record = code
    ? get<{ created_at: string }>("SELECT created_at FROM audit_logs WHERE action = 'meta.data_deletion' AND target = ?", code)
    : undefined;
  return (
    <>
      <h1>Data deletion</h1>
      {code && (
        <p className="rounded-lg bg-surface-2 p-3">
          Request <code>{code}</code>: {record ? `completed on ${new Date(record.created_at).toUTCString()}.` : "not found."}
        </p>
      )}
      <p>You can remove your data from {APP_NAME} at any time:</p>
      <ul>
        <li><b>Disconnect a social account</b> in Accounts — its access tokens are deleted immediately.</li>
        <li><b>Delete a workspace</b> in Brand &amp; settings — posts, media records and tokens are deleted.</li>
        <li><b>Remove the app from Facebook</b> (Settings → Business Integrations) — Meta notifies us and we delete the related tokens automatically.</li>
        <li><b>Delete your whole account</b> — email privacy@markvtech.example from your registered address.</li>
      </ul>
    </>
  );
}
