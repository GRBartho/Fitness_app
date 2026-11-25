// Program + strength standards.
//
// Strength standards are 1RM / bodyweight ratios for Beginner, Novice,
// Intermediate, Advanced, Elite (roughly the 5th/20th/50th/80th/95th
// percentile of lifters), estimated from public strength-standard tables
// (Strength Level, Legion, Stronger). Dumbbell lifts are PER DUMBBELL.
// Female thresholds are scaled by FEMALE_FACTOR.

const FEMALE_FACTOR = { upper: 0.6, lower: 0.72, core: 0.85 };

// type: 'weight' (score = estimated 1RM / bodyweight) or 'reps' (score = best reps in a set)
const EXERCISES = {
  bench:        { name: 'Barbell Bench Press',             type: 'weight', region: 'upper', std: [0.50, 0.75, 1.15, 1.50, 1.90], muscles: { chest: 1, triceps: 0.5, shoulders: 0.4 }, inc: 5 },
  incline_db:   { name: 'Incline Dumbbell Press',  type: 'weight', region: 'upper', std: [0.15, 0.25, 0.40, 0.55, 0.70], muscles: { chest: 1, shoulders: 0.6, triceps: 0.4 }, inc: 5, note: 'weight of ONE dumbbell' },
  leg_press:    { name: 'Leg Press',               type: 'weight', region: 'lower', std: [1.00, 1.75, 2.50, 3.50, 4.50], muscles: { quads: 1, glutes: 0.6 }, inc: 10 },
  squat:        { name: 'Barbell Squat',                   type: 'weight', region: 'lower', std: [0.75, 1.10, 1.50, 2.00, 2.50], muscles: { quads: 1, glutes: 0.8, core: 0.3 }, inc: 5 },
  rdl:          { name: 'Romanian Deadlift',       type: 'weight', region: 'lower', std: [0.75, 1.10, 1.50, 2.00, 2.50], muscles: { hamstrings: 1, glutes: 0.8, back: 0.4 }, inc: 5 },
  leg_curl:     { name: 'Seated Leg Curl',                type: 'weight', region: 'lower', std: [0.35, 0.50, 0.75, 1.00, 1.30], muscles: { hamstrings: 1 }, inc: 5 },
  lat_pulldown: { name: 'Lat Pulldown',            type: 'weight', region: 'upper', std: [0.50, 0.70, 1.00, 1.25, 1.50], muscles: { back: 1, biceps: 0.5 }, inc: 5 },
  assisted_pullup:{ name: 'Assisted Pull-Up',      type: 'weight', region: 'upper', std: [0.50, 0.70, 1.00, 1.25, 1.50], muscles: { back: 1, biceps: 0.5 }, inc: 5, assist: true, note: 'enter the ASSIST weight (less = stronger)' },
  cable_row:    { name: 'Seated Cable Row',        type: 'weight', region: 'upper', std: [0.50, 0.75, 1.00, 1.40, 1.75], muscles: { back: 1, biceps: 0.5 }, inc: 5 },
  cs_row:       { name: 'Chest-Supported Row',     type: 'weight', region: 'upper', std: [0.40, 0.60, 0.85, 1.15, 1.50], muscles: { back: 1, biceps: 0.4, shoulders: 0.3 }, inc: 5 },
  shoulder_press:{ name: 'Seated Dumbbell Shoulder Press',         type: 'weight', region: 'upper', std: [0.15, 0.25, 0.40, 0.55, 0.75], muscles: { shoulders: 1, triceps: 0.5 }, inc: 5, note: 'weight of ONE dumbbell' },
  lateral_raise:{ name: 'Dumbbell Lateral Raise',           type: 'weight', region: 'upper', std: [0.05, 0.10, 0.18, 0.27, 0.37], muscles: { shoulders: 1 }, inc: 2.5, note: 'weight of ONE dumbbell' },
  biceps_curl:  { name: 'Biceps Curl',             type: 'weight', region: 'upper', std: [0.10, 0.18, 0.30, 0.42, 0.55], muscles: { biceps: 1 }, inc: 2.5, note: 'weight of ONE dumbbell' },
  tri_pushdown: { name: 'Triceps Pushdown',        type: 'weight', region: 'upper', std: [0.25, 0.40, 0.60, 0.85, 1.10], muscles: { triceps: 1 }, inc: 5 },
  tri_ext:      { name: 'Overhead Triceps Extension',       type: 'weight', region: 'upper', std: [0.20, 0.35, 0.50, 0.75, 1.00], muscles: { triceps: 1 }, inc: 5 },
  hack_squat:   { name: 'Hack Squat',              type: 'weight', region: 'lower', std: [0.75, 1.15, 1.65, 2.30, 3.00], muscles: { quads: 1, glutes: 0.5 }, inc: 10, note: 'plates loaded (not counting the sled)' },
  hip_thrust:   { name: 'Hip Thrust / Glute Drive', type: 'weight', region: 'lower', std: [0.50, 1.00, 1.60, 2.40, 3.20], muscles: { glutes: 1, hamstrings: 0.4 }, inc: 10 },
  bss:          { name: 'Bulgarian Split Squat',   type: 'weight', region: 'lower', std: [0.10, 0.20, 0.33, 0.50, 0.70], muscles: { quads: 1, glutes: 0.7 }, inc: 5, note: 'weight of ONE dumbbell, reps per leg (0 = bodyweight)' },
  hammer_curl:  { name: 'Hammer Curl',             type: 'weight', region: 'upper', std: [0.10, 0.20, 0.32, 0.45, 0.60], muscles: { biceps: 1 }, inc: 2.5, note: 'weight of ONE dumbbell' },
  knee_raise:   { name: 'Hanging Knee Raises',     type: 'reps',   region: 'core',  std: [5, 10, 15, 22, 30],            muscles: { core: 1 } },
  calf_raise:   { name: 'Standing Calf Raise',     type: 'weight', region: 'lower', std: [0.50, 1.00, 1.50, 2.25, 3.00], muscles: { calves: 1 }, inc: 10 },
  seated_calf:  { name: 'Seated Calf Raise',       type: 'weight', region: 'lower', std: [0.25, 0.50, 0.90, 1.40, 2.00], muscles: { calves: 1 }, inc: 10 },
  seated_chest_press:{ name: 'Seated Chest Press', type: 'weight', region: 'upper', std: [0.40, 0.65, 1.00, 1.40, 1.85], muscles: { chest: 1, triceps: 0.5, shoulders: 0.4 }, inc: 5, note: 'machine' },
  machine_shoulder_press:{ name: 'Machine Shoulder Press', type: 'weight', region: 'upper', std: [0.30, 0.50, 0.75, 1.00, 1.30], muscles: { shoulders: 1, triceps: 0.5 }, inc: 5 },
  reverse_pec_deck:{ name: 'Reverse Pec Deck',     type: 'weight', region: 'upper', std: [0.15, 0.30, 0.50, 0.75, 1.00], muscles: { shoulders: 1, back: 0.4 }, inc: 5 },
  leg_extension:{ name: 'Leg Extension',           type: 'weight', region: 'lower', std: [0.45, 0.75, 1.15, 1.60, 2.10], muscles: { quads: 1 }, inc: 5 },
  reverse_lunge:{ name: 'Dumbbell Reverse Lunge',  type: 'weight', region: 'lower', std: [0.10, 0.20, 0.33, 0.50, 0.70], muscles: { glutes: 1, quads: 0.7 }, inc: 5, note: 'weight of ONE dumbbell, reps per leg (0 = bodyweight)' },
  back_extension:{ name: 'Weighted Back Extension', type: 'weight', region: 'lower', std: [0.05, 0.15, 0.30, 0.45, 0.65], muscles: { glutes: 0.6, hamstrings: 0.6, back: 0.4 }, inc: 5, note: 'added weight (0 = bodyweight)' },
  cable_crunch: { name: 'Cable Crunch',            type: 'weight', region: 'core',  std: [0.30, 0.50, 0.75, 1.00, 1.30], muscles: { core: 1 }, inc: 5 },
  woodchopper:  { name: 'Cable Woodchopper',       type: 'weight', region: 'core',  std: [0.10, 0.20, 0.35, 0.50, 0.70], muscles: { core: 1 }, inc: 5, note: 'reps per side' },
  abs:          { name: 'Abs (reps per set)',      type: 'reps',   region: 'core',  std: [8, 15, 25, 35, 50],            muscles: { core: 1 } },
};

const MUSCLES = {
  chest:        { name: 'Chest',        icon: '🛡️' },
  back:         { name: 'Back',         icon: '🦅' },
  shoulders:    { name: 'Shoulders',    icon: '⛰️' },
  biceps:       { name: 'Biceps',       icon: '💪' },
  triceps:      { name: 'Triceps',      icon: '🔱' },
  quads:        { name: 'Quads',        icon: '🦵' },
  hamstrings:   { name: 'Hamstrings',   icon: '🏹' },
  glutes:       { name: 'Glutes',       icon: '🍑' },
  calves:       { name: 'Calves',       icon: '🐐' },
  core:         { name: 'Core',         icon: '🧱' },
};

// Fitness Court stations (no longer in the plan; kept so older logged sessions still display).
const COURT_STATIONS = [
  { cat: 'Core',    name: 'Mountain Climbers',     std: [30, 45, 60, 75, 90],  muscles: { core: 1, conditioning: 1 }, alts: ['Plank Shoulder Taps', 'Bicycle Crunches', 'V-Ups'] },
  { cat: 'Squat',   name: 'Step-Ups',              std: [12, 18, 24, 30, 36],  muscles: { conditioning: 1 }, alts: ['Jump Squats', 'Bodyweight Squats', 'Box Jumps'] },
  { cat: 'Push',    name: 'Suspended Push-Ups',    std: [8, 14, 20, 27, 35],   muscles: { conditioning: 1 }, alts: ['Push-Ups', 'Dips', 'Incline Push-Ups'] },
  { cat: 'Lunge',   name: 'Side-Box Lunges',       std: [10, 16, 22, 28, 34],  muscles: { conditioning: 1 }, alts: ['Reverse Lunges', 'Jump Lunges', 'Bulgarian Split Squats'] },
  { cat: 'Pull',    name: 'Inverted Rows',         std: [5, 10, 15, 20, 25],   muscles: { conditioning: 1 }, alts: ['Pull-Ups', 'Chin-Ups', 'Australian Pull-Ups'] },
  { cat: 'Agility', name: 'High Knees',            std: [40, 60, 80, 100, 120], muscles: { conditioning: 1 }, alts: ['Skaters', 'Burpees', 'Lateral Shuffles'] },
  { cat: 'Bend',    name: 'Reverse Hyperextension', std: [10, 15, 20, 25, 30], muscles: { conditioning: 1 }, alts: ['Supermans', 'Glute Bridges', 'Good Mornings'] },
];

// Plan keyed by JS weekday (0 = Sunday). Items: [exerciseId | [alt ids], sets, repLow, repHigh]
// 5-day PPL + Upper/Lower, built around Muay Thai on Tuesday and Thursday.
const PLAN = {
  1: { title: 'Push + Abs', emoji: '💥', type: 'lift', note: 'Chest thickness, upper chest, broader shoulders and triceps.', items: [
    ['seated_chest_press', 3, 8, 12], ['incline_db', 3, 8, 12], [['shoulder_press', 'machine_shoulder_press'], 3, 8, 12],
    ['lateral_raise', 3, 12, 15], ['tri_pushdown', 2, 10, 15], ['cable_crunch', 3, 12, 15],
  ] },
  2: { title: 'Pull', emoji: '🦅', type: 'lift', note: '🥊 Muay Thai today: keep 2–3 reps in reserve.', items: [
    [['lat_pulldown', 'assisted_pullup'], 3, 8, 12], ['cs_row', 3, 8, 12], ['reverse_pec_deck', 3, 12, 15],
    ['biceps_curl', 3, 10, 12], ['hammer_curl', 2, 10, 12],
  ] },
  3: { title: 'Legs · Quads + Abs', emoji: '🦵', type: 'lift', note: "Don't take legs to failure: Muay Thai tomorrow.", items: [
    ['hack_squat', 3, 8, 10], ['leg_extension', 2, 12, 15], ['leg_curl', 2, 10, 15],
    ['calf_raise', 3, 12, 15], ['knee_raise', 3, 10, 15],
  ] },
  4: { title: 'Upper Body', emoji: '🛡️', type: 'lift', note: '🥊 Muay Thai today: keep the intensity moderate.', items: [
    ['incline_db', 3, 8, 12], ['cable_row', 3, 8, 12], ['lat_pulldown', 3, 8, 12],
    ['lateral_raise', 3, 12, 15], ['biceps_curl', 2, 10, 12], ['tri_ext', 1, 12, 15],
  ] },
  5: { title: 'Legs · Posterior Chain + Abs', emoji: '🍑', type: 'lift', note: 'Your hardest leg day: you have the weekend to recover.', items: [
    ['hip_thrust', 3, 8, 12], ['leg_curl', 3, 10, 15], [['reverse_lunge', 'squat'], 2, 8, 10],
    ['back_extension', 2, 10, 15], ['seated_calf', 2, 15, 20], ['woodchopper', 3, 10, 15],
  ] },
  6: { title: 'Active Recovery', emoji: '🚶', type: 'rest', note: 'Easy walk, mobility or stretching.' },
  0: { title: 'Rest Day', emoji: '😴', type: 'rest' },
};

const GRADES = ['F', 'E', 'D', 'C', 'B', 'A', 'S', 'S+', 'S++'];
const GRADE_LABELS = ['Untrained', 'Beginner', 'Novice', 'Novice+', 'Intermediate', 'Intermediate+', 'Advanced', 'Elite', 'World Class'];

const TITLES = [
  [1, 'Novice'], [5, 'Iron Initiate'], [10, 'Bronze Lifter'], [15, 'Silver Warrior'],
  [20, 'Gold Champion'], [30, 'Platinum Titan'], [40, 'Diamond Legend'], [50, 'Mythic Hunter'],
];

const ACHIEVEMENTS = {
  first_workout: { name: 'First Quest',         desc: 'Log your first workout',          xp: 100, icon: '🎯' },
  workouts_10:   { name: 'Habit Forming',       desc: 'Log 10 workouts',                  xp: 250, icon: '📅' },
  workouts_50:   { name: 'Iron Discipline',     desc: 'Log 50 workouts',                  xp: 1000, icon: '⚙️' },
  workouts_100:  { name: 'Centurion',           desc: 'Log 100 workouts',                 xp: 2500, icon: '🏛️' },
  first_pr:      { name: 'Personal Record',     desc: 'Set your first PR',                xp: 100, icon: '📈' },
  full_week:     { name: 'Perfect Week',        desc: 'Complete all 5 training days in one week', xp: 400, icon: '⭐' },
  rank_c:        { name: 'Rising',              desc: 'Reach C rank in any muscle',       xp: 200, icon: '🥉' },
  rank_a:        { name: 'Elite Class',         desc: 'Reach A rank in any muscle',       xp: 500, icon: '🥈' },
  rank_s:        { name: 'S-Rank Hunter',       desc: 'Reach S rank in any muscle',       xp: 1500, icon: '👑' },
  bw_bench:      { name: 'Bodyweight Bench',    desc: 'Bench or chest press your bodyweight (est. 1RM)', xp: 500, icon: '🏋️' },
  weight_5:      { name: 'Shedding (5)',        desc: 'Move 5 lb / 2.5 kg toward your goal', xp: 300, icon: '⚖️' },
  weight_10:     { name: 'Transformation (10)', desc: 'Move 10 lb / 5 kg toward your goal', xp: 600, icon: '🦋' },
  goal_weight:   { name: 'Goal Reached',        desc: 'Hit your goal bodyweight',         xp: 1500, icon: '🏆' },
};
