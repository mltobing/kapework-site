/** Original, self-contained Kapework pictograms. No remote media or emoji fonts. */
const drawings = {
  wake: ['Wake up', '<circle cx="102" cy="76" r="35" fill="#f8cd6b"/><path d="M102 26v-9m0 118v-9M52 76H41m122 0h-11M67 41l-7-7m83 84-7-7m0-70 7-7m-83 84 7-7"/><path d="M85 75q5-7 10 0m16 0q5-7 10 0m-30 17q12 12 24 0" fill="none"/>'],
  relax: ['Relax / TV', '<rect x="45" y="33" width="110" height="70" rx="9" fill="#b5d7de"/><path d="m87 22 13 11 13-11M86 113h28"/><rect x="35" y="118" width="130" height="34" rx="10" fill="#e9af91"/><path d="M50 118v-11h100v11m-99 34v9m98-9v9"/>'],
  school: ['School', '<path d="M40 81h120v80H40z" fill="#f5d888"/><path d="m30 81 70-48 70 48" fill="#da9c85"/><path d="M86 161v-40h28v40" fill="#a7cbbd"/><path d="M57 98h15v15H57zm71 0h15v15h-15z" fill="#fff"/><path d="M100 33V14l26 9-26 10" fill="#b5d7de"/>'],
  teeth: ['Brush teeth', '<path d="M55 37q14-11 30 0l15 7 15-7q20-10 31 4c17 23-7 47-14 77-7 30-17 30-21 7-4-25-18-25-22 0-4 23-14 23-21-7C61 88 37 60 55 37Z" fill="#fff"/><rect x="121" y="100" width="15" height="63" rx="7" fill="#a7cbbd" transform="rotate(28 128 130)"/><path d="m138 97 17-30m-22 29 17-30m-22 28 17-30" stroke="#78a0af"/>'],
  clothes: ['Get dressed', '<path d="m70 38-36 26 20 28 18-13v79h56V79l18 13 20-28-36-26c-7 24-53 24-60 0Z" fill="#b5d7de"/><path d="M88 93h24v26H88z" fill="#fff"/>'],
  bag: ['Pack the bag', '<path d="M82 45V31h36v14" fill="none"/><rect x="53" y="43" width="94" height="117" rx="24" fill="#a7cbbd"/><path d="M67 72h66M59 95H43v42h10m88-42h16v42h-10" fill="none"/><rect x="71" y="108" width="58" height="38" rx="10" fill="#e8d5ae"/><path d="M79 120h42"/>'],
  shoes: ['Shoes', '<path d="M43 59h40l12 31 58 18q14 5 12 30H37V84Z" fill="#e9af91"/><path d="M37 126h128M85 89l14-12m-3 21 14-12m-1 20 14-12" fill="none"/><path d="M42 59q18 22 41 0" fill="#fff"/>'],
  leave: ['Leave home', '<path d="m31 80 58-49 57 49" fill="#a7cbbd"/><path d="M42 78v82h93V78M76 160v-53h28v53" fill="#f8edd4"/><path d="M120 116h52m-18-18 18 18-18 18" fill="none" stroke="#527666"/>'],
  socks: ['Shoes and socks off', '<path d="M60 30h43v71l-39 52c-17 19-43-1-28-21l24-33Z" fill="#b5d7de"/><path d="M60 49h43m-43 54 27 12"/><path d="M117 64h27v38l20 24c16 17-5 34-18 21l-29-30Z" fill="#e9af91"/><path d="M117 80h27"/>'],
  hands: ['Wash hands', '<path d="M80 58V40h54v19h-28v18" fill="none" stroke-width="12"/><path d="M106 92q-11 17 0 20 11-3 0-20Z" fill="#b5d7de"/><path d="m36 122 39-17 26 12 47-7q17 1 9 13l-45 27H61l-16 9" fill="#ebc49d"/><circle cx="70" cy="86" r="8" fill="#fff"/><circle cx="53" cy="70" r="5" fill="#fff"/>'],
  unpack: ['Unpack', '<rect x="35" y="68" width="67" height="89" rx="12" fill="#a7cbbd"/><path d="M49 68V54h39v14M47 103h43"/><path d="M75 30h53v65H75z" fill="#fff"/><path d="M87 46h28m-28 14h28"/><path d="M142 78h17v17l8 12v49h-34v-49l9-12Z" fill="#b5d7de"/><path d="M142 78v-9h17v9"/>'],
  homework: ['Homework', '<path d="M38 49q31-14 62 0 31-14 62 0v99q-31-14-62 0-31-14-62 0Z" fill="#fff"/><path d="M100 49v99M51 71h32m-32 18h32m34-18h31m-31 18h31"/><path d="m123 139 36-59 12 8-36 58-17 11Z" fill="#f5d888"/>'],
  play: ['Play time', '<rect x="35" y="103" width="51" height="51" rx="6" fill="#a7cbbd"/><path d="m63 52 30 51H33Z" fill="#e9af91"/><circle cx="133" cy="120" r="36" fill="#f5d888"/><path d="M133 84q-24 34 0 72m-36-36h72" fill="none"/>'],
  dinner: ['Dinner', '<circle cx="100" cy="100" r="49" fill="#fff"/><circle cx="100" cy="100" r="34" fill="#f8edd4"/><path d="M30 46v110m-11-110v32h22V46m127 0v110m-10-110v53h10" fill="none"/><path d="m84 89 19-8 15 15-10 22-25-8Z" fill="#a7cbbd"/>'],
  bath: ['Bath', '<path d="M33 94h135l-12 44q-4 14-24 14H68q-20 0-24-14Z" fill="#b5d7de"/><path d="M49 94V50q0-21 23-18v16m-20 104-5 12m101-12 5 12" fill="none"/><circle cx="90" cy="86" r="16" fill="#fff"/><circle cx="113" cy="76" r="20" fill="#fff"/><circle cx="138" cy="89" r="12" fill="#fff"/>'],
  pajamas: ['Pajamas', '<path d="m58 30-24 20 12 21 15-9v49h49V62l15 9 12-21-26-20-25 13Z" fill="#b5d7de"/><path d="M87 44v67m-26 9h66l12 43h-27l-18-31-9 31H59Z" fill="#a7cbbd"/><circle cx="97" cy="65" r="2"/><circle cx="97" cy="81" r="2"/>'],
  bed: ['Get into bed', '<path d="M35 76v85m130-63v63" fill="none" stroke-width="9"/><rect x="35" y="91" width="130" height="54" rx="7" fill="#b5d7de"/><rect x="43" y="79" width="39" height="27" rx="10" fill="#fff"/><path d="M89 92v53"/><path d="M129 26a24 24 0 1 0 28 33 22 22 0 0 1-28-33Z" fill="#f5d888"/>'],
  read: ['Read a story', '<path d="M31 49q35-17 69 2 34-19 69-2v105q-35-17-69 2-34-19-69-2Z" fill="#f5d888"/><path d="M100 51v105M46 123h36m35 0h37" fill="none"/><path d="m64 68 6 13 15 2-11 11 3 15-13-8-13 8 3-15-11-11 15-2Z" fill="#fff"/><path d="M138 72a18 18 0 1 0 16 27 18 18 0 0 1-16-27Z" fill="#fff"/>'],
  prayers: ['Prayers / quiet time', '<path d="m99 42-22 27-15 48-23 23 24 23 30-35 7-44 7 44 30 35 24-23-23-23-15-48-22-27Z" fill="#ebc49d"/><path d="M100 48v74M75 116l18 12m14 0 18-12M78 25l-9-9m53 9 9-9M100 21V8" fill="none"/>'],
  sleep: ['Sleep', '<path d="M124 33a59 59 0 1 0 40 91 56 56 0 0 1-40-91Z" fill="#f5d888"/><path d="M65 105q9 9 18 0m5 18q8 7 15-2" fill="none"/><path d="m149 40 5 10 11 2-8 8 2 11-10-6-10 6 2-11-8-8 11-2Z" fill="#b5d7de"/>'],
  star: ['A special reward', '<path d="m100 28 22 43 48 7-35 34 8 48-43-23-43 23 8-48-35-34 48-7Z" fill="#f5d888"/><path d="M78 96q5-6 10 0m24 0q5-6 10 0m-33 18q11 10 22 0" fill="none"/>'],
  heart: ['Together time', '<path d="M100 153 39 94C1 51 65 14 100 57c35-43 99-6 61 37Z" fill="#e9af91"/><path d="M76 92q5-6 10 0m28 0q5-6 10 0m-35 20q11 12 22 0" fill="none"/>'],
  water: ['Water bottle', '<path d="M78 48h44v22l13 18v67H65V88l13-18Z" fill="#b5d7de"/><rect x="77" y="29" width="46" height="20" rx="5" fill="#a7cbbd"/><path d="M65 107h70m-35 10q-19 24 0 28 19-4 0-28Z" fill="#fff"/>'],
};
export const illustrations = Object.entries(drawings).map(([id,[label]])=>Object.freeze({id,label}));
export const illustrationIds = Object.freeze(Object.keys(drawings));
export function illustrationSVG(id) {
  const body = (drawings[id] || drawings.star)[1];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="180" viewBox="0 0 200 180"><rect width="200" height="180" rx="20" fill="#faf8f2"/><g stroke="#344b49" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`;
}
export function illustrationURL(id) { return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(illustrationSVG(id))}`; }
