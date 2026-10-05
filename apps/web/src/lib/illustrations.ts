/**
 * Built-in illustration library for the POS picture grid.
 * Every common item has a clear, colourful drawing so staff with limited
 * English can pick the right item by sight. 100×100 viewBox SVGs.
 */
const sw = (w: number) => `stroke="#1f2937" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;
const S = sw(2.5);

function svg(bg: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" fill="${bg}"/>${body}</svg>`;
}

export const ITEM_ILLUSTRATIONS: Record<string, { label: string; svg: string }> = {
  thobe: {
    label: 'Thobe',
    svg: svg(
      '#e0f2fe',
      `<path d="M40 12 L60 12 L74 18 L88 46 L79 51 L70 35 L70 92 L30 92 L30 35 L21 51 L12 46 L26 18 Z" fill="#fff" ${S}/>
       <path d="M42 12 Q50 20 58 12" fill="none" ${S}/>
       <path d="M50 18 L50 42" ${S}/>
       <circle cx="54" cy="24" r="1.6" fill="#1f2937"/><circle cx="54" cy="31" r="1.6" fill="#1f2937"/><circle cx="54" cy="38" r="1.6" fill="#1f2937"/>
       <path d="M34 72 L34 80 M66 72 L66 80" stroke="#94a3b8" stroke-width="2"/>`,
    ),
  },
  ghutra: {
    label: 'Ghutra',
    svg: svg(
      '#fee2e2',
      `<defs><clipPath id="gc"><path d="M50 16 L88 80 L12 80 Z"/></clipPath></defs>
       <path d="M50 16 L88 80 L12 80 Z" fill="#fff"/>
       <g clip-path="url(#gc)" stroke="#dc2626" stroke-width="2.2">
         <path d="M0 30 L100 30 M0 40 L100 40 M0 50 L100 50 M0 60 L100 60 M0 70 L100 70"/>
         <path d="M20 0 L20 100 M30 0 L30 100 M40 0 L40 100 M50 0 L50 100 M60 0 L60 100 M70 0 L70 100 M80 0 L80 100"/>
       </g>
       <path d="M50 16 L88 80 L12 80 Z" fill="none" ${S}/>
       <ellipse cx="50" cy="34" rx="20" ry="6" fill="none" stroke="#111827" stroke-width="4"/>
       <ellipse cx="50" cy="40" rx="22" ry="6.5" fill="none" stroke="#111827" stroke-width="4"/>`,
    ),
  },
  bisht: {
    label: 'Bisht',
    svg: svg(
      '#fef3c7',
      `<path d="M38 12 L62 12 L84 28 L92 90 L8 90 L16 28 Z" fill="#3f2a1d" ${S}/>
       <path d="M44 12 L38 90 M56 12 L62 90" stroke="#d4a017" stroke-width="5"/>
       <path d="M38 12 Q50 22 62 12" fill="none" stroke="#d4a017" stroke-width="4"/>`,
    ),
  },
  shirt: {
    label: 'Shirt',
    svg: svg(
      '#dbeafe',
      `<path d="M36 16 L44 12 L50 20 L56 12 L64 16 L84 26 L90 48 L80 52 L74 38 L74 90 L26 90 L26 38 L20 52 L10 48 L16 26 Z" fill="#93c5fd" ${S}/>
       <path d="M44 12 L40 24 L50 20 L60 24 L56 12" fill="#fff" ${S}/>
       <path d="M50 20 L50 90" ${S}/>
       <circle cx="53" cy="32" r="1.6" fill="#1f2937"/><circle cx="53" cy="44" r="1.6" fill="#1f2937"/><circle cx="53" cy="56" r="1.6" fill="#1f2937"/><circle cx="53" cy="68" r="1.6" fill="#1f2937"/>
       <rect x="32" y="34" width="12" height="10" rx="1" fill="none" ${S}/>`,
    ),
  },
  tshirt: {
    label: 'T-Shirt',
    svg: svg(
      '#ffe4e6',
      `<path d="M34 16 Q50 28 66 16 L88 28 L80 46 L70 41 L70 88 L30 88 L30 41 L20 46 L12 28 Z" fill="#fb7185" ${S}/>
       <path d="M38 18 Q50 26 62 18" fill="none" ${S}/>`,
    ),
  },
  trousers: {
    label: 'Trousers',
    svg: svg(
      '#f5f5f4',
      `<path d="M30 12 L70 12 L76 90 L56 90 L50 38 L44 90 L24 90 Z" fill="#a8a29e" ${S}/>
       <path d="M30 19 L70 19" ${S}/>
       <path d="M38 12 L38 19 M50 12 L50 19 M62 12 L62 19" ${S}/>
       <path d="M50 19 L50 38" ${S}/>`,
    ),
  },
  jeans: {
    label: 'Jeans',
    svg: svg(
      '#dbeafe',
      `<path d="M30 12 L70 12 L76 90 L56 90 L50 38 L44 90 L24 90 Z" fill="#2563eb" ${S}/>
       <path d="M30 19 L70 19" ${S}/>
       <path d="M33 22 Q38 32 46 24 M67 22 Q62 32 54 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-dasharray="3 2"/>
       <path d="M28 40 L44 40 M56 40 L72 40" stroke="#f59e0b" stroke-width="1.6" stroke-dasharray="3 2"/>
       <circle cx="50" cy="16" r="1.8" fill="#f59e0b"/>`,
    ),
  },
  suit: {
    label: 'Suit',
    svg: svg(
      '#e2e8f0',
      `<path d="M30 14 L44 10 L50 30 L56 10 L70 14 L86 28 L88 74 L78 76 L74 44 L74 90 L26 90 L26 44 L22 76 L12 74 L14 28 Z" fill="#334155" ${S}/>
       <path d="M44 10 L50 30 L56 10 Z" fill="#fff" ${S}/>
       <path d="M48 16 L52 16 L53 22 L50 46 L47 22 Z" fill="#dc2626" stroke="#1f2937" stroke-width="1.5"/>
       <path d="M44 10 L40 30 L50 48 M56 10 L60 30 L50 48" fill="none" stroke="#94a3b8" stroke-width="2"/>
       <circle cx="50" cy="58" r="2" fill="#cbd5e1"/><circle cx="50" cy="68" r="2" fill="#cbd5e1"/>`,
    ),
  },
  jacket: {
    label: 'Jacket',
    svg: svg(
      '#e0e7ff',
      `<path d="M30 14 L42 10 L50 34 L58 10 L70 14 L86 28 L88 74 L78 76 L74 44 L74 90 L26 90 L26 44 L22 76 L12 74 L14 28 Z" fill="#1e3a8a" ${S}/>
       <path d="M42 10 L50 34 L58 10" fill="#e0e7ff" ${S}/>
       <path d="M42 10 L38 30 L50 50 M58 10 L62 30 L50 50" fill="none" stroke="#93c5fd" stroke-width="2"/>
       <circle cx="50" cy="60" r="2.4" fill="#fbbf24"/><circle cx="50" cy="70" r="2.4" fill="#fbbf24"/>
       <path d="M30 66 L42 66 M58 66 L70 66" stroke="#93c5fd" stroke-width="2"/>`,
    ),
  },
  coat: {
    label: 'Coat',
    svg: svg(
      '#fef3c7',
      `<path d="M32 10 L44 8 L50 24 L56 8 L68 10 L84 24 L88 78 L78 80 L72 40 L74 94 L26 94 L28 40 L22 80 L12 78 L16 24 Z" fill="#b45309" ${S}/>
       <path d="M44 8 L38 26 L50 40 L62 26 L56 8" fill="none" stroke="#fde68a" stroke-width="2"/>
       <path d="M28 58 L72 58" stroke="#78350f" stroke-width="5"/>
       <circle cx="44" cy="46" r="2" fill="#fde68a"/><circle cx="56" cy="46" r="2" fill="#fde68a"/><circle cx="44" cy="70" r="2" fill="#fde68a"/><circle cx="56" cy="70" r="2" fill="#fde68a"/>`,
    ),
  },
  abaya: {
    label: 'Abaya',
    svg: svg(
      '#ede9fe',
      `<path d="M40 10 L60 10 L70 16 L94 58 L82 65 L70 42 L78 94 L22 94 L30 42 L18 65 L6 58 L30 16 Z" fill="#111827" ${S}/>
       <path d="M86 61 L92 57 M14 61 L8 57" stroke="#d4a017" stroke-width="4"/>
       <path d="M50 16 L50 94" stroke="#d4a017" stroke-width="2.5" stroke-dasharray="4 3"/>
       <path d="M42 10 Q50 18 58 10" fill="none" stroke="#d4a017" stroke-width="2.5"/>`,
    ),
  },
  sheila: {
    label: 'Sheila',
    svg: svg(
      '#ede9fe',
      `<circle cx="50" cy="40" r="13" fill="#f5d0a9" ${S}/>
       <path d="M30 42 Q30 14 50 14 Q70 14 70 42 L76 86 L60 88 L58 56 Q50 60 42 56 L40 88 L24 86 Z" fill="#312e81" ${S}/>
       <circle cx="50" cy="42" r="11" fill="#f5d0a9"/>
       <circle cx="45" cy="41" r="1.4" fill="#1f2937"/><circle cx="55" cy="41" r="1.4" fill="#1f2937"/>
       <path d="M46 47 Q50 50 54 47" fill="none" stroke="#1f2937" stroke-width="1.6"/>`,
    ),
  },
  dress: {
    label: 'Dress',
    svg: svg(
      '#fce7f3',
      `<path d="M40 10 L44 10 L46 22 L54 22 L56 10 L60 10 L63 30 L58 40 L82 90 L18 90 L42 40 L37 30 Z" fill="#ec4899" ${S}/>
       <path d="M40 40 L60 40" stroke="#fff" stroke-width="3"/>
       <path d="M30 76 Q40 80 50 76 Q60 72 70 76" fill="none" stroke="#fbcfe8" stroke-width="2"/>`,
    ),
  },
  skirt: {
    label: 'Skirt',
    svg: svg(
      '#f3e8ff',
      `<path d="M32 20 L68 20 L84 84 L16 84 Z" fill="#a855f7" ${S}/>
       <path d="M32 20 L68 20 L68 28 L32 28 Z" fill="#7e22ce" ${S}/>
       <path d="M42 28 L36 84 M50 28 L50 84 M58 28 L64 84" stroke="#e9d5ff" stroke-width="2"/>`,
    ),
  },
  blouse: {
    label: 'Blouse',
    svg: svg(
      '#fef9c3',
      `<path d="M38 14 L50 34 L62 14 L82 24 Q90 36 84 48 L72 44 L72 88 L28 88 L28 44 L16 48 Q10 36 18 24 Z" fill="#fcd34d" ${S}/>
       <path d="M44 34 Q50 40 56 34 L50 44 Z" fill="#f472b6" ${S}/>
       <path d="M28 80 Q50 86 72 80" fill="none" ${S}/>`,
    ),
  },
  sweater: {
    label: 'Sweater',
    svg: svg(
      '#dcfce7',
      `<path d="M34 14 Q50 24 66 14 L84 24 L92 74 L80 76 L72 40 L72 88 L28 88 L28 40 L20 76 L8 74 L16 24 Z" fill="#4ade80" ${S}/>
       <path d="M28 82 L72 82 M10 68 L22 70 M90 68 L78 70" stroke="#166534" stroke-width="2.5"/>
       <path d="M38 40 L44 46 L50 40 L56 46 L62 40 M38 54 L44 60 L50 54 L56 60 L62 54" fill="none" stroke="#bbf7d0" stroke-width="2.5"/>`,
    ),
  },
  kids: {
    label: 'Kids Wear',
    svg: svg(
      '#ffedd5',
      `<path d="M36 22 Q50 32 64 22 L80 32 L74 44 L66 40 L66 70 Q66 82 56 82 L56 90 L44 90 L44 82 Q34 82 34 70 L34 40 L26 44 L20 32 Z" fill="#fb923c" ${S}/>
       <path d="M50 46 L53 53 L60 53 L54 58 L57 65 L50 60 L43 65 L46 58 L40 53 L47 53 Z" fill="#fef08a" stroke="#1f2937" stroke-width="1.5"/>`,
    ),
  },
  uniform: {
    label: 'Uniform',
    svg: svg(
      '#f5f5f4',
      `<path d="M36 16 L44 12 L50 20 L56 12 L64 16 L84 26 L90 48 L80 52 L74 38 L74 90 L26 90 L26 38 L20 52 L10 48 L16 26 Z" fill="#d6d3d1" ${S}/>
       <path d="M30 20 L40 18 M60 18 L70 20" stroke="#57534e" stroke-width="4"/>
       <path d="M50 20 L50 90" ${S}/>
       <rect x="56" y="34" width="13" height="6" rx="1" fill="#fff" stroke="#1f2937" stroke-width="1.5"/>
       <circle cx="38" cy="38" r="5" fill="#2563eb" stroke="#1f2937" stroke-width="1.5"/>`,
    ),
  },
  tie: {
    label: 'Tie',
    svg: svg(
      '#fee2e2',
      `<path d="M44 12 L56 12 L54 22 L62 76 L50 90 L38 76 L46 22 Z" fill="#dc2626" ${S}/>
       <path d="M44 12 L56 12 L54 22 L46 22 Z" fill="#b91c1c" ${S}/>
       <path d="M42 46 L58 34 M40 60 L60 46 M42 74 L60 60" stroke="#fecaca" stroke-width="2.5"/>`,
    ),
  },
  wedding_dress: {
    label: 'Wedding Dress',
    svg: svg(
      '#fce7f3',
      `<path d="M42 10 L58 10 L60 36 Q86 58 92 92 L8 92 Q14 58 40 36 Z" fill="#fff" ${S}/>
       <path d="M40 36 L60 36" stroke="#f9a8d4" stroke-width="3"/>
       <circle cx="50" cy="22" r="2" fill="#f9a8d4"/><circle cx="30" cy="70" r="2" fill="#f9a8d4"/><circle cx="50" cy="66" r="2" fill="#f9a8d4"/><circle cx="70" cy="70" r="2" fill="#f9a8d4"/><circle cx="40" cy="82" r="2" fill="#f9a8d4"/><circle cx="60" cy="82" r="2" fill="#f9a8d4"/>`,
    ),
  },
  bedsheet: {
    label: 'Bed Sheet',
    svg: svg(
      '#e0f2fe',
      `<rect x="14" y="52" width="72" height="22" rx="4" fill="#7dd3fc" ${S}/>
       <rect x="18" y="32" width="64" height="22" rx="4" fill="#bae6fd" ${S}/>
       <path d="M18 43 L82 43 M14 63 L86 63" stroke="#0369a1" stroke-width="1.6" stroke-dasharray="3 3"/>
       <circle cx="30" cy="38" r="1.5" fill="#0284c7"/><circle cx="46" cy="38" r="1.5" fill="#0284c7"/><circle cx="62" cy="38" r="1.5" fill="#0284c7"/>`,
    ),
  },
  blanket: {
    label: 'Blanket',
    svg: svg(
      '#fee2e2',
      `<rect x="12" y="30" width="76" height="44" rx="8" fill="#f87171" ${S}/>
       <path d="M12 42 L88 42 M12 52 L88 52 M12 62 L88 62" stroke="#fecaca" stroke-width="3.5"/>
       <path d="M72 30 Q90 40 88 74" fill="none" ${S}/>`,
    ),
  },
  duvet: {
    label: 'Duvet',
    svg: svg(
      '#eef2ff',
      `<rect x="12" y="24" width="76" height="54" rx="12" fill="#c7d2fe" ${S}/>
       <path d="M37 24 L37 78 M63 24 L63 78 M12 51 L88 51" stroke="#6366f1" stroke-width="2" stroke-dasharray="3 3"/>`,
    ),
  },
  pillow: {
    label: 'Pillow',
    svg: svg(
      '#fef3c7',
      `<path d="M18 32 Q50 22 82 32 Q90 50 82 68 Q50 78 18 68 Q10 50 18 32 Z" fill="#fde68a" ${S}/>
       <path d="M30 42 Q50 36 70 42 M30 58 Q50 64 70 58" fill="none" stroke="#f59e0b" stroke-width="2"/>`,
    ),
  },
  towel: {
    label: 'Towel',
    svg: svg(
      '#ccfbf1',
      `<rect x="16" y="62" width="68" height="16" rx="5" fill="#0d9488" ${S}/>
       <rect x="20" y="46" width="60" height="16" rx="5" fill="#2dd4bf" ${S}/>
       <rect x="24" y="30" width="52" height="16" rx="5" fill="#99f6e4" ${S}/>
       <path d="M24 38 L76 38 M20 54 L80 54 M16 70 L84 70" stroke="#fff" stroke-width="2.5"/>`,
    ),
  },
  curtain: {
    label: 'Curtain',
    svg: svg(
      '#f3e8ff',
      `<path d="M10 16 L90 16" stroke="#1f2937" stroke-width="4"/>
       <path d="M14 18 L46 18 L44 50 Q34 56 36 88 L14 88 Z" fill="#a78bfa" ${S}/>
       <path d="M86 18 L54 18 L56 50 Q66 56 64 88 L86 88 Z" fill="#a78bfa" ${S}/>
       <path d="M22 20 L22 86 M30 20 L28 86 M78 20 L78 86 M70 20 L72 86" stroke="#7c3aed" stroke-width="1.8"/>`,
    ),
  },
  carpet: {
    label: 'Carpet',
    svg: svg(
      '#ffedd5',
      `<rect x="18" y="22" width="64" height="56" rx="3" fill="#c2410c" ${S}/>
       <rect x="25" y="29" width="50" height="42" rx="2" fill="none" stroke="#fed7aa" stroke-width="2.5"/>
       <path d="M50 34 L66 50 L50 66 L34 50 Z" fill="#fdba74" stroke="#7c2d12" stroke-width="2"/>
       <path d="M18 28 L12 28 M18 36 L12 36 M18 44 L12 44 M18 52 L12 52 M18 60 L12 60 M18 68 L12 68 M82 28 L88 28 M82 36 L88 36 M82 44 L88 44 M82 52 L88 52 M82 60 L88 60 M82 68 L88 68" stroke="#1f2937" stroke-width="2"/>`,
    ),
  },
  other: {
    label: 'Other',
    svg: svg(
      '#f1f5f9',
      `<path d="M50 22 Q50 14 56 14 Q62 14 62 20 Q62 26 50 32 L14 62 Q10 68 18 68 L82 68 Q90 68 86 62 L50 32" fill="none" ${sw(3.5)}/>`,
    ),
  },
};

export const SERVICE_ICONS: Record<string, { label: string; svg: string }> = {
  wash_iron: {
    label: 'Wash & Iron',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="10" y="12" width="56" height="70" rx="8" fill="#e0f2fe" ${S}/><circle cx="38" cy="52" r="18" fill="#7dd3fc" ${S}/><path d="M24 54 Q38 46 52 54" fill="none" stroke="#fff" stroke-width="3"/><circle cx="22" cy="23" r="3" fill="#1f2937"/><path d="M52 92 L94 92 Q94 74 80 70 L62 70 Q52 72 52 92 Z" fill="#fbbf24" ${S}/><path d="M66 70 L66 62 L84 62" fill="none" ${S}/></svg>`,
  },
  iron: {
    label: 'Iron Only',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M10 78 L88 78 Q88 46 66 42 L36 42 Q14 46 10 78 Z" fill="#fbbf24" ${S}/><path d="M40 42 L40 26 L80 26 L80 36" fill="none" ${sw(5)}/><circle cx="36" cy="64" r="3" fill="#1f2937"/><circle cx="50" cy="64" r="3" fill="#1f2937"/><circle cx="64" cy="64" r="3" fill="#1f2937"/><path d="M20 88 Q26 84 32 88 M44 88 Q50 84 56 88" fill="none" stroke="#60a5fa" stroke-width="3"/></svg>`,
  },
  dry_clean: {
    label: 'Dry Clean',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50 18 Q50 10 56 10 Q62 10 62 16 Q62 22 50 28 L18 52 L82 52 L50 28" fill="none" ${sw(3)}/><path d="M24 52 L76 52 L72 92 L28 92 Z" fill="#c4b5fd" ${S}/><circle cx="50" cy="72" r="12" fill="#fff" ${S}/><text x="50" y="78" text-anchor="middle" font-family="Arial" font-weight="700" font-size="16" fill="#1f2937">P</text></svg>`,
  },
  wash: {
    label: 'Wash Only',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="16" y="10" width="68" height="82" rx="10" fill="#e0f2fe" ${S}/><path d="M16 28 L84 28" ${S}/><circle cx="28" cy="19" r="3" fill="#1f2937"/><circle cx="40" cy="19" r="3" fill="#1f2937"/><circle cx="50" cy="60" r="22" fill="#38bdf8" ${S}/><path d="M32 62 Q41 52 50 62 Q59 72 68 62" fill="none" stroke="#fff" stroke-width="3.5"/></svg>`,
  },
  dye: {
    label: 'Dyeing',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="dg" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#f472b6"/><stop offset=".5" stop-color="#a855f7"/><stop offset="1" stop-color="#3b82f6"/></linearGradient></defs><path d="M50 8 Q78 44 78 62 Q78 90 50 90 Q22 90 22 62 Q22 44 50 8 Z" fill="url(#dg)" ${S}/><path d="M36 64 Q36 76 48 78" fill="none" stroke="#fff" stroke-width="4"/></svg>`,
  },
  default: {
    label: 'Service',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50 10 L58 40 L90 50 L58 60 L50 90 L42 60 L10 50 L42 40 Z" fill="#fde68a" ${S}/></svg>`,
  },
};

export const ITEM_IMAGE_KEYS = Object.keys(ITEM_ILLUSTRATIONS);
export const SERVICE_ICON_KEYS = Object.keys(SERVICE_ICONS).filter((k) => k !== 'default');

export function svgDataUri(svgText: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
}
