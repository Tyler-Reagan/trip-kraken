import ImportingClient from "@/components/ImportingClient";

export default async function ImportingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ImportingClient tripId={id} />;
}
