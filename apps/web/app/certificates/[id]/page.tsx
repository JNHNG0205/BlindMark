export default async function CertificatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <main>
      <h1>Certificate {id}</h1>
      <p>Not implemented: certificate details and verify command.</p>
    </main>
  );
}
