const base = () => `${location.protocol}//${location.hostname}:4281`;
export async function omrRequest(path: string, options: RequestInit = {}) {
  const response = await fetch(base() + path, {
    signal: AbortSignal.timeout(30000),
    ...options,
    headers: { ...options.headers, "X-OMR-Request": "1" },
  });
  const value = await response.json();
  if (!response.ok) throw Error(value.error || "本機辨識失敗");
  return value;
}
export const omrHealth = () => omrRequest("/health");
export const cancelRecognition = (id: string) =>
  omrRequest(`/jobs/${id}`, { method: "DELETE", keepalive: true }).catch(() => {});
