export function decodeDisplayText(value: string) {
  if (!value.includes("&")) return value;
  const decoder = document.createElement("textarea");
  decoder.innerHTML = value;
  return decoder.value;
}
