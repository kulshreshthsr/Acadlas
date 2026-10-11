// Inner SVG markup on a 24px grid, taken from the marketing site so the product
// and the website draw the same icons. Rendered by components/Icon.tsx.
export const icons = {
  students: "<path d=\"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2\"/><circle cx=\"9\" cy=\"7\" r=\"4\"/><path d=\"M22 21v-2a4 4 0 0 0-3-3.87\"/><path d=\"M16 3.13a4 4 0 0 1 0 7.75\"/>",
  staff: "<path d=\"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z\"/><path d=\"m9 12 2 2 4-4\"/>",
  attendance: "<path d=\"M8 2v4\"/><path d=\"M16 2v4\"/><rect x=\"3\" y=\"4\" width=\"18\" height=\"18\" rx=\"2\"/><path d=\"M3 10h18\"/><path d=\"m9 16 2 2 4-4\"/>",
  fees: "<rect x=\"2\" y=\"5\" width=\"20\" height=\"14\" rx=\"2\"/><path d=\"M2 10h20\"/><path d=\"M6 15h4\"/>",
  record: "<rect x=\"2\" y=\"4\" width=\"20\" height=\"16\" rx=\"2\"/><circle cx=\"9\" cy=\"11\" r=\"2\"/><path d=\"M6 17a3 3 0 0 1 6 0\"/><path d=\"M15 9h3\"/><path d=\"M15 13h3\"/>",
  classes: "<path d=\"m12 2 10 5-10 5L2 7z\"/><path d=\"m2 17 10 5 10-5\"/><path d=\"m2 12 10 5 10-5\"/>",
  admission: "<path d=\"M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z\"/><path d=\"M14 2v6h6\"/><path d=\"M8 13h8\"/><path d=\"M8 17h5\"/>",
  lock: "<rect x=\"4\" y=\"11\" width=\"16\" height=\"10\" rx=\"2\"/><path d=\"M8 11V7a4 4 0 0 1 8 0v4\"/>",
  building: "<path d=\"M3 21h18\"/><path d=\"M5 21V8l7-5 7 5v13\"/><path d=\"M9 21v-5h6v5\"/><path d=\"M9 11h.01\"/><path d=\"M15 11h.01\"/>",
  check: "<path d=\"M20 6 9 17l-5-5\"/>",
  "arrow-right": "<path d=\"M5 12h14\"/><path d=\"m12 5 7 7-7 7\"/>",
  sparkle: "<path d=\"M12 3v4\"/><path d=\"M12 17v4\"/><path d=\"M3 12h4\"/><path d=\"M17 12h4\"/><path d=\"m6 6 2 2\"/><path d=\"m16 16 2 2\"/><path d=\"m6 18 2-2\"/><path d=\"m16 8 2-2\"/>",
} as const;

export type IconName = keyof typeof icons;
