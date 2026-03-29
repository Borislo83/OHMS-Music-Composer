import StudioSessionClient from "@/components/StudioSessionClient";

export default async function StudioSessionPage({
  params
}: {
  params: Promise<{ sessionId: string }> | { sessionId: string };
}) {
  const { sessionId } = await Promise.resolve(params);
  return <StudioSessionClient sessionId={sessionId} />;
}
