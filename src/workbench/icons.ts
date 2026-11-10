const paths = {
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  'chevron-left': '<path d="m15 18-6-6 6-6"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  sliders: '<path d="M4 7h10m4 0h2M4 17h2m4 0h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  headphones: '<path d="M4 13v-1a8 8 0 0 1 16 0v1M4 13h3v7H5a1 1 0 0 1-1-1zm16 0h-3v7h2a1 1 0 0 0 1-1z"/>',
  type: '<path d="M4 7V5h16v2M12 5v14m-4 0h8"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15 9-2 4-4 2 2-4z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  'arrow-up': '<path d="M12 19V5M5 12l7-7 7 7"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2-.6-.7-1.6 1-1.9-2.1-2.1-1.9 1-1.6-.7-.6-2h-3l-.6 2-1.6.7-1.9-1-2.1 2.1 1 1.9-.7 1.6-2 .6v3l2 .6.7 1.6-1 1.9 2.1 2.1 1.9-1 1.6.7.6 2h3l.6-2 1.6-.7 1.9 1 2.1-2.1-1-1.9.7-1.6z" transform="translate(2 0) scale(.83 1)"/>',
  play: '<path d="m8 5 11 7-11 7z"/>', pause: '<path d="M8 5v14M16 5v14"/>', stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
  repeat: '<path d="M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-1v2a3 3 0 0 1-3 3H3"/>',
  mic: '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3m-3 0h6"/>',
  volume: '<path d="M4 10v4h4l5 4V6l-5 4zm12-1a4 4 0 0 1 0 6m2-9a8 8 0 0 1 0 12"/>',
  'rotate-ccw': '<path d="M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5"/>',
  'rotate-cw': '<path d="M21 12a9 9 0 1 1-3-6.7L21 8m0-5v5h-5"/>',
  check: '<path d="m5 12 4 4L19 6"/>', close: '<path d="M6 6l12 12M18 6 6 18"/>',
} as const;

export type PithIconName = keyof typeof paths;
export function pithIcon(name: PithIconName): string {
  return `<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
}
