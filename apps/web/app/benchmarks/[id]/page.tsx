export default async function BenchmarkPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <main>
      <h1>Benchmark {id}</h1>
      <p>Not implemented: benchmark card and evaluation request.</p>
    </main>
  );
}
