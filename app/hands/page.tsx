import HandSynthLanding from "@/components/HandSynthLanding";

function pickFirst(value: string | string[] | undefined) {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

export default async function HandsPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>;
}) {
  const params = await Promise.resolve(searchParams);
  const sessionId = pickFirst(params?.sessionId);
  return <HandSynthLanding sessionId={sessionId ?? undefined} />;
}
