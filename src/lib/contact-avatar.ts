/** Paleta de fondos para avatares: los 7 gradientes del rediseño Carbón & Vidrio
    (clases Tailwind con valor arbitrario — el JIT las ve como literales estáticos acá).
    El hash de getAvatarColorIndex no cambia; solo cambia el array de colores. */
export const AVATAR_COLORS = [
  "bg-[linear-gradient(150deg,#7A5CBA_0%,#4E3A85_100%)]",
  "bg-[linear-gradient(150deg,#3E8E7E_0%,#2A6152_100%)]",
  "bg-[linear-gradient(150deg,#C2603F_0%,#8A3E27_100%)]",
  "bg-[linear-gradient(150deg,#4A6FA5_0%,#2F4870_100%)]",
  "bg-[linear-gradient(150deg,#8A6BB5_0%,#5B4382_100%)]",
  "bg-[linear-gradient(150deg,#B5843E_0%,#7E5A25_100%)]",
  "bg-[linear-gradient(150deg,#2F6F9E_0%,#1E4A6B_100%)]",
] as const;

/** Color de arranque de cada gradiente de AVATAR_COLORS, como "R,G,B" — para tintes
    radiales tenues detrás del avatar (Perfil). Mismo índice que AVATAR_COLORS. */
export const AVATAR_TINTS = [
  "122,92,186",
  "62,142,126",
  "194,96,63",
  "74,111,165",
  "138,107,181",
  "181,132,62",
  "47,111,158",
] as const;

/** Iniciales (1-2 letras) a partir del nombre completo. */
export function getInitials(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0][0].toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** Índice de color determinístico (mismo nombre → mismo color). */
export function getAvatarColorIndex(fullName: string): number {
  let hash = 0;
  for (let i = 0; i < fullName.length; i++) {
    hash = (hash * 31 + fullName.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % AVATAR_COLORS.length;
}
