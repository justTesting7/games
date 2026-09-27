// Fictional clubs. Kit colours are sRGB hex; the shader converts to linear.
export const CLUBS = {
  kingsbridge: {
    name: 'Kingsbridge', short: 'KNG', color: '#1f4fd8', crowd: { shirt: '#1d44c4', alt: '#ffffff' },
    kit: {
      shirt: '#1a3fbf', sleeve: '#1a3fbf', trim: '#ffffff', shorts: '#1a3fbf', socks: '#f2f2f2', number: '#ffffff', crest: '#ffffff', sponsor: '#ffffff',
      keeper: { shirt: '#2ac46a', sleeve: '#1f9e53', trim: '#0c3a1e', shorts: '#0c3a1e', socks: '#2ac46a', number: '#0c2a16', gloves: '#f4f4f0' },
    },
  },
  redmoor: {
    name: 'Redmoor', short: 'RDM', color: '#e0262d', crowd: { shirt: '#d41f26', alt: '#ffffff' },
    kit: {
      shirt: '#d61e24', sleeve: '#f4f4f2', trim: '#f4f4f2', shorts: '#f4f4f2', socks: '#d61e24', number: '#ffffff', crest: '#ffe28a', sponsor: '#ffffff',
      keeper: { shirt: '#f2c21b', sleeve: '#f2c21b', trim: '#1c1c1c', shorts: '#1c1c1c', socks: '#f2c21b', number: '#1c1c1c', gloves: '#2a2a2a' },
    },
  },
  northgate: {
    name: 'Northgate', short: 'NTG', color: '#e8e8e8', crowd: { shirt: '#111111', alt: '#f0f0f0' },
    kit: {
      shirt: '#f2f2f2', sleeve: '#141414', trim: '#141414', shorts: '#141414', socks: '#141414', number: '#141414', crest: '#141414', sponsor: '#141414', stripes: true,
      keeper: { shirt: '#6c2bd9', sleeve: '#6c2bd9', trim: '#ffffff', shorts: '#2b1260', socks: '#6c2bd9', number: '#ffffff', gloves: '#f0f0f0' },
    },
  },
  ambervale: {
    name: 'Ambervale', short: 'AMB', color: '#f3b81a', crowd: { shirt: '#f0b418', alt: '#161616' },
    kit: {
      shirt: '#f3b51a', sleeve: '#f3b51a', trim: '#141414', shorts: '#141414', socks: '#f3b51a', number: '#141414', crest: '#141414', sponsor: '#141414',
      keeper: { shirt: '#1aa3e8', sleeve: '#1aa3e8', trim: '#0b2b44', shorts: '#0b2b44', socks: '#1aa3e8', number: '#ffffff', gloves: '#ff5a1f' },
    },
  },
};

const SURNAMES = [
  'Okafor', 'Silva', 'Hartley', 'Novak', 'Mendes', 'Kowalski', 'Adeyemi', 'Laurent', 'Rossi', 'Keane',
  'Haaland', 'Duarte', 'Bakayoko', 'Walsh', 'Ferreira', 'Lindqvist', 'Moreau', 'Osei', 'Petrov', 'Castillo',
  'Van Dijk', 'Murphy', 'Takahashi', 'Diallo', 'Schmidt', 'Costa', 'Bennett', 'Kovacic', 'Nwosu', 'Almeida',
  'Fischer', 'Ramos', 'Hughes', 'Mbeki', 'Jansen', 'Torres', 'Owusu', 'Sorensen', 'Reyes', 'Doyle',
];

const SKINS = [[241, 199, 165], [224, 172, 138], [198, 140, 107], [168, 109, 78], [122, 74, 51], [90, 53, 36], [234, 185, 150], [210, 160, 125]];
const HAIRS = ['#15100c', '#2a1a10', '#3b2616', '#0d0b0a', '#6b4a2a', '#a8793f', '#1c1410'];
const BOOTS = ['#111111', '#f4f4f4', '#ff3b1f', '#1fd1ff', '#f2e21b', '#ff2fa0', '#1a1a1a'];

// 4-4-2 in the team's attacking frame: x from -1 (own goal line) to 1, z
// from -1 (left touchline) to 1. `personality` goes to Jev verbatim.
export const FORMATION = [
  { role: 'GK', pos: 'GK', x: -0.96, z: 0, number: 1, personality: 'a commanding goalkeeper who distributes quickly to start attacks' },
  { role: 'DEF', pos: 'LB', x: -0.64, z: -0.66, number: 3, personality: 'an overlapping left back who loves to get forward and cross' },
  { role: 'DEF', pos: 'CB', x: -0.72, z: -0.22, number: 5, personality: 'a no-nonsense centre back who keeps it simple and clears danger' },
  { role: 'DEF', pos: 'CB', x: -0.72, z: 0.22, number: 4, personality: 'a ball-playing centre back who likes to pass through the lines' },
  { role: 'DEF', pos: 'RB', x: -0.64, z: 0.66, number: 2, personality: 'a disciplined right back who defends first and passes safely' },
  { role: 'MID', pos: 'LM', x: -0.22, z: -0.66, number: 11, personality: 'a tricky left winger who takes on defenders and cuts inside to shoot' },
  { role: 'MID', pos: 'CM', x: -0.32, z: -0.2, number: 8, personality: 'a tireless box-to-box midfielder who drives forward with the ball' },
  { role: 'MID', pos: 'CM', x: -0.34, z: 0.2, number: 6, personality: 'a deep-lying playmaker who keeps possession and switches play' },
  { role: 'MID', pos: 'RM', x: -0.22, z: 0.66, number: 7, personality: 'a fast right winger who runs in behind and whips in crosses' },
  { role: 'FWD', pos: 'ST', x: 0.06, z: -0.16, number: 9, personality: 'a clinical striker who shoots whenever he sees the goal' },
  { role: 'FWD', pos: 'ST', x: 0.02, z: 0.18, number: 10, personality: 'a creative second striker who drops deep and plays killer through balls' },
];

// Kick-off shape: everyone in their own half, the two strikers at the spot.
export const KICKOFF = [
  [-0.96, 0], [-0.55, -0.62], [-0.6, -0.2], [-0.6, 0.2], [-0.55, 0.62],
  [-0.24, -0.6], [-0.26, -0.18], [-0.28, 0.18], [-0.24, 0.6], [-0.005, -0.05], [-0.06, 0.12],
];
export const KICKOFF_DEFEND = [
  [-0.96, 0], [-0.55, -0.62], [-0.6, -0.2], [-0.6, 0.2], [-0.55, 0.62],
  [-0.3, -0.6], [-0.32, -0.18], [-0.32, 0.18], [-0.3, 0.6], [-0.19, -0.14], [-0.19, 0.14],
];

export function squad(clubId, seed = 1) {
  const club = CLUBS[clubId];
  let s = seed * 7919 + clubId.length * 104729;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  const used = new Set();
  return FORMATION.map((f) => {
    let name;
    do { name = SURNAMES[Math.floor(rnd() * SURNAMES.length)]; } while (used.has(name));
    used.add(name);
    const skin = SKINS[Math.floor(rnd() * SKINS.length)];
    return {
      ...f,
      name,
      skin,
      hair: HAIRS[Math.floor(rnd() * HAIRS.length)],
      boots: BOOTS[Math.floor(rnd() * BOOTS.length)],
      height: 0.95 + rnd() * 0.09,
      // Ratings 0..1 shape pace, passing, shooting and tackling.
      pace: f.role === 'GK' ? 0.55 : 0.62 + rnd() * 0.3 + (f.pos === 'LM' || f.pos === 'RM' ? 0.06 : 0),
      passing: 0.6 + rnd() * 0.3 + (f.role === 'MID' ? 0.08 : 0),
      shooting: 0.45 + rnd() * 0.25 + (f.role === 'FWD' ? 0.22 : f.role === 'MID' ? 0.08 : 0),
      tackling: 0.5 + rnd() * 0.25 + (f.role === 'DEF' ? 0.2 : 0),
      keeping: f.role === 'GK' ? 0.75 + rnd() * 0.2 : 0.1,
      club,
    };
  });
}
