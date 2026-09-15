// Wiring: screens, the fixed-step loop, and the bridge from sim events to
// effects.
//
// The sim runs at a fixed 60 Hz inside an accumulator while rendering runs as
// fast as the display allows. That separation is what makes frame data mean
// anything: a 4-frame jab is 4 frames on a 144 Hz monitor and on a throttled
// phone, and only the interpolated picture changes.

import * as THREE from './vendor/three.module.js';
import { ConfidenceProps } from './render/confidenceProps.js';
import { BeaverTribute, tributeCamera } from './render/beaverTribute.js';
import { tributeImpact, TRIBUTE } from './engine/beaverTribute.js';
import { WeaponView } from './render/weapons.js';
import { DroneStrike } from './render/droneStrike.js';
import { getFighter, listFighters, DEFAULT_FIGHTER_ID, hasFighter } from './fighters/catalog.js';
import { Match, PHASE } from './engine/match.js';
import { CpuController, DIFFICULTIES } from './engine/ai.js';
import { TICK, MATCH, moveOf } from './engine/frameData.js';
import { SimulationClock } from './engine/simulationClock.js';
import { finisherTimeScale } from './engine/finisherTiming.js';
import { coldCutCamera } from './render/finisherDirector.js';
import { LakeOutcomeDirector } from './render/lakeOutcomeDirector.js';
import { lakeEntranceCamera } from './render/lakeCameraDirector.js';
import { resultDuration, stageOutcome } from './engine/stageOutcomes.js';
import { Stage } from './render/stage.js';
import { Vfx } from './render/vfx.js';
import { GoreDebris } from './render/goreProps.js';
import { Hud } from './render/hud.js';
import { FightCamera } from './render/camera.js';
import { PostFx } from './render/postfx.js';
import { FighterView } from './render/fighterView.js';
import { PlayerInput, TouchControls, KEYBOARD_P1, KEYBOARD_P2 } from './input/sources.js';
import { MenuNavigator } from './input/menuNav.js';
import { registerFightTools } from './game/registerWebMcp.js';
import { FightAudio } from './game/fightAudio.js';
import { Announcer } from './game/announcer.js';
import { RoundReel, WIN_QUOTES } from './render/roundReel.js';
import { GameMenus } from './render/gameMenus.js';
import { installPalette } from './render/palette.js';
import { POSE } from './render/poseAmp.js';
import { RIM } from './render/rimLight.js';
import { REEL, reelAt, endCard, decidingRound } from './engine/reelTimeline.js';
import { worldBox } from './engine/frameData.js';
import { ImpactClock, impactProfile, rumble, stopRumble } from './render/impact.js';
import { OptionsStore } from './game/options.js';
import { PlayerProfile } from './game/profile.js';
import { StageAmbience } from './game/stageAmbience.js';
import { SelectionScreen } from './render/selectionScreen.js';
import { PortraitStudio } from './render/portraitStudio.js';
import { STAGES, stageById } from './render/stageRegistry.js';
import { HazardMarker } from './render/hazardMarker.js';
import { fatalitiesFor, BRUTALITY, finisherCinematicAt } from './engine/fatalities.js';
import './style.css';
import { practiceMoves, preparePractice, demonstrationInput, sustainPractice, practiceDummyInput } from './game/practice.js';
import { PracticePanel } from './render/practicePanel.js';
import { AttractDirector, AttractIdle, demoPair } from './game/attract.js';
import './render/attract.css';
import { installTitleMenu } from './render/titleMenu.js';
const preferences = new OptionsStore();
const reviewMode = import.meta.env.DEV ? new URLSearchParams(location.search).get('review') : null;
if (reviewMode === 'stage') location.replace(`${import.meta.env.BASE_URL}lake-america.html`);
const cinematicReview = ['flock', 'finisher'].includes(reviewMode);
const lakePlayReview = reviewMode === 'lake-play';
const playerProfile = new PlayerProfile();
let selection = null, studio = null;
const impact = new ImpactClock();
const bufferedHits = [{}, {}];
installPalette();
const audio = new FightAudio();
const announcer = new Announcer({ audio });
const ambience = new StageAmbience(audio);

let reducedMotion = preferences.reducedMotion(matchMedia('(prefers-reduced-motion: reduce)').matches);
const coarsePointer = matchMedia('(pointer: coarse)').matches;
// Phones pay for every sprite twice: once to simulate, once to composite a
// large translucent quad. Halving the particle budget there keeps the same look
// at a frame rate that still reads as a fighting game.
let quality = preferences.qualityValue(coarsePointer || (navigator.hardwareConcurrency || 8) <= 4);

const dom = {
  canvas: document.querySelector('#arena'),
  hudRoot: document.querySelector('#hud-root'),
  touchRoot: document.querySelector('#touch-root'),
  loader: document.querySelector('#loader'),
  loaderCopy: document.querySelector('#loader-copy'),
  pauseButton: document.querySelector('#pause-button'),
  screens: {
    title: document.querySelector('#screen-title'),
    setup: document.querySelector('#screen-setup'),
    pause: document.querySelector('#screen-pause'),
    result: document.querySelector('#screen-result'),
  },
};

const roster = listFighters();
const config = {
  fighters: [DEFAULT_FIGHTER_ID, roster[1]?.id || DEFAULT_FIGHTER_ID],
  control: ['human', 'cpu'],
  difficulty: ['normal', 'normal'],
  roundsToWin: MATCH.roundsToWin,
  modelFormat: ['threejs', 'threejs'],
  stage: 'lake-america', hazards: true,
};
{
  const requested = new URLSearchParams(location.search).get('fighter');
  if (requested && hasFighter(requested)) {
    config.fighters[0] = requested;
    config.fighters[1] = roster.find((f) => f.id !== requested)?.id || config.fighters[1];
  }
}

// ---- renderer -------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ canvas: dom.canvas, antialias: !coarsePointer, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, coarsePointer ? 1.5 : 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.13;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = coarsePointer ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(33, 1, 0.05, 850);
const fightCamera = new FightCamera(camera);
const stage = new Stage(scene, { reducedMotion });
const hazardMarker = new HazardMarker(scene);
const vfx = new Vfx(scene, { stage, reducedMotion, quality });
// One debris pool for the whole scene: severed parts outlive the fighter view
// that shed them (a round reset rebuilds views, the floor keeps its mess until
// the round actually ends), and a shared cap is the only way to bound them.
const confidenceProps = new ConfidenceProps(scene);
const beaverTribute = new BeaverTribute(scene);
const lakeOutcome = new LakeOutcomeDirector(scene, stage);
const gore = new GoreDebris(scene, { stage, assetBase: import.meta.env.BASE_URL });
// Fire and forget: the debris pool falls back to generated props until it lands.
gore.load();
const weapons = new WeaponView(scene, stage);
// Overwatch's drone. One rig for the whole session -- the strike is exclusive,
// and the assets are far too large to load per summon.
const droneStrike = new DroneStrike(scene, { stage, vfx, quality, reducedMotion });
// The scene now renders through a composer rather than straight to the canvas.
// `renderer.toneMapping` above still applies exactly once, in the composer's
// terminal OutputPass -- three skips tone mapping when the destination is a
// render target, so the intermediate buffers stay linear for the bloom.
const postfx = new PostFx(renderer, scene, camera, {
  reducedMotion,
  lowPower: quality < 1,
  grade: 'lakeAmerica',
});
// The grade is meant to be set by eye. A live uniform is a far faster loop than
// edit-and-reload, and Vite drops this branch entirely from the build.
if (import.meta.env.DEV) window.postfx = postfx;
// Same escape hatch for pose amplification: the debug studio owns the tuned
// loop, but a live object is the fastest way to A/B one group from a console.
if (import.meta.env.DEV) window.pose = POSE;
if (import.meta.env.DEV) window.rim = RIM;
const koFlash = document.createElement('div');
koFlash.className = 'ko-impact';
koFlash.setAttribute('aria-hidden', 'true');
document.body.append(koFlash);

// ---- input ----------------------------------------------------------------

const players = [
  new PlayerInput({ keymap: KEYBOARD_P1, padIndex: 0 }),
  new PlayerInput({ keymap: KEYBOARD_P2, padIndex: 1 }),
];
const touch = coarsePointer ? new TouchControls(dom.touchRoot, players[0]) : null;
touch?.setVisible(false);

const cpus = [
  new CpuController({ side: 0, difficulty: 'normal', seed: 4021 }),
  new CpuController({ side: 1, difficulty: 'normal', seed: 8117 }),
];

// ---- session state --------------------------------------------------------

let match = null;
let hud = null;
let views = [null, null];
let running = false;
let paused = false;
const simulationClock = new SimulationClock();
let lastPhase = null;
let announceTimer = 0;
let cinematicFocus = null;
const clock = new THREE.Clock();
const projected = new THREE.Vector3();
let activeScreen = 'title', loadingMatch = false;
let demoMode = null, demoLoading = false, demoFailed = false, demoEpoch = 0, loadEpoch = 0, pendingLoad = Promise.resolve();
const attract = new AttractDirector(), attractIdle = new AttractIdle();
let debugSpeed = 1, debugBoxes = false, debugWireframe = false, debugWasPaused = false;
let practiceActive = false, practiceEntry = null, practiceDemo = false, practiceFrame = 0, practiceDummy = 'idle', practiceSeen = new Set();
let practiceSaved = null;
let practicePreviousInput = '', practiceHistory = [];
// The pairing the tutorial copy and the Lake America lesson placements assume:
// Carney's kit is the one with easy chains to teach, and Flock is the partner
// whose spacing gives a learner room to work.
const PRACTICE_DEFAULTS = Object.freeze({ fighter: 'carney', opponent: 'officer_flock', stage: 'lake-america' });
const practicePanel = new PracticePanel({ roster, stages: STAGES, preferences, defaults: PRACTICE_DEFAULTS,
  onLaunch: async (fighter, opponent, arena) => {
    leaveDemo();
    if (!practiceSaved) practiceSaved = { ...config, fighters: [...config.fighters], control: [...config.control] };
    config.fighters = [fighter, opponent]; config.control = ['human', 'cpu']; config.stage = arena;
    practiceActive = true; document.body.classList.add('practice-active');
    if (await startMatch() === false) { leavePractice(); return false; }
    playerProfile.abandon();
    practicePanel.label(getFighter(fighter).label, getFighter(opponent).label);
    practicePanel.populate(practiceMoves(match.left, arena));
    practicePanel.root.hidden = false;
  },
  onAction: (action, entry) => {
    if (!practiceActive || !match) return;
    practiceEntry = entry; practiceDemo = action === 'watch'; practiceFrame = 0; practiceSeen = new Set();
    practicePreviousInput = ''; practiceHistory = []; practicePanel.stats.textContent = ''; practicePanel.history.textContent = '';
    preparePractice(match, entry); reel.reset(); impact.reset(); simulationClock.reset(); lastPhase = null;
    vfx.clear(); gore.resetRound(); stage.resetRound(); hud.clearSay(); audio.setMusic('battle');
    for (const side of [0, 1]) { views[side]?.resetDamage(); bufferedHits[side] = {}; players[side].clearHeld(); }
    practicePanel.status.textContent = practiceDemo ? 'Demonstration playing. Select Try it to take control.' : entry?.kind === 'brutality' ? 'Two combo hits are set up. Land the uppercut to complete Overkill.' : 'Your turn. Follow the inputs above; reset whenever you like.';
    if (paused) setPaused(false);
  },
  onSettings: (key, value) => { if (key === 'dummy') practiceDummy = value; if (key === 'speed') debugSpeed = value; if (key === 'boxes') debugBoxes = value; },
});
function leavePractice() {
  document.body.classList.remove('practice-active');
  practiceActive = false; practicePanel.root.hidden = true; practiceEntry = null; practiceDemo = false;
  debugSpeed = 1; debugBoxes = false;
  if (practiceSaved) { Object.assign(config, practiceSaved); practiceSaved = null; }
}
const reel = new RoundReel({ audio, camera: fightCamera, reducedMotion });
const boxHelpers = Array.from({ length: 4 }, (_, i) => {
  const helper = new THREE.Box3Helper(new THREE.Box3(), i < 2 ? 0x80dbff : 0xffc63d);
  helper.visible = false; helper.material.depthTest = false; scene.add(helper); return helper;
});
const menus = new GameMenus({ audio, options: preferences, profile: playerProfile,
  onOptionsChange: applyOptions,
  getFighters: () => config.fighters.map(getFighter),
  getFinishers: id => id ? [...fatalitiesFor(id, config.stage), BRUTALITY] : [...new Map(roster.flatMap(f => STAGES.flatMap(stage => [...fatalitiesFor(f.id, stage.id), BRUTALITY])).map(f => [f.id, f])).values()],
  // The debug studio drives both CPU sides together; side 0 is the one it
  // reads back, since a knob set through here is always set on both.
  cpu: {
    get: key => cpus[0].params[key],
    set: (key, value) => { for (const c of cpus) c.setTuning(key, value); },
    reset: () => { for (const c of cpus) c.resetTuning(); },
  },
  onDebugOpen: () => { debugWasPaused = paused; setPaused(true); },
  onDebugClose: () => { if (running && !debugWasPaused) setPaused(false); },
  onModel: async (side, format) => {
    const next = new FighterView(getFighter(config.fighters[side]), { scene, side }); next.root.visible = false;
    next.setDebris(gore);
    try { await next.load(format); } catch (e) { next.dispose(); throw e; }
    views[side]?.dispose(); views[side] = next; next.root.visible = true;
    config.modelFormat[side] = format; applyWireframe();
  },
  onRestart: startMatch,
  onPreview: previewReel,
  onSpeed: value => { debugSpeed = value; },
  onWireframe: value => { debugWireframe = value; applyWireframe(); },
  onBoxes: value => { debugBoxes = value; },
});
function applyWireframe() {
  for (const view of views) view?.model?.traverse(n => { if (n.isMesh) n.material.wireframe = debugWireframe; });
}
function configureInput() {
  const single = config.control.filter(c => c === 'human').length === 1;
  for (let side = 0; side < 2; side++) {
    players[side].clearHeld();
    players[side].keymap = config.control[side] === 'human' ? preferences.keymap(side, { single }) : {};
    players[side].padIndex = single && config.control[side] === 'human' ? 0 : side;
  }
  if (touch) touch.player = players[config.control[0] === 'human' ? 0 : 1];
}

function showScreen(name) {
  const previousScreen = activeScreen;
  if (name === 'setup') leaveDemo();
  activeScreen = name;
  practicePanel.root.hidden = !practiceActive || name !== null;
  ambience.pause(name !== null && !demoMode);
  for (const [key, node] of Object.entries(dom.screens)) node.classList.toggle('active', key === name);
  if (name === 'setup') {
    selection?.show();
    if (studio && !studio.prewarmed) {
      studio.prewarmed = true;
      void studio.prewarm().catch(error => { studio.prewarmed = false; selection?.previewError(error); });
    }
  }
  document.body.classList.toggle('in-match', name === null && demoMode !== 'vignette');
  document.body.classList.toggle('menu-vignette', name === 'title');
  document.body.classList.toggle('demo-full', demoMode === 'full');
  audio.setMenuPreview(name === 'title');
  if (demoMode === 'full') audio.setMusic('battle');
  reel.live.hidden = name !== null;
  reel.live.setAttribute('aria-live', name === null ? 'assertive' : 'off');
  dom.pauseButton.hidden = name !== null || Boolean(demoMode);
  touch?.setVisible(!demoMode && name === null && config.control.includes('human'));
  if (name === 'title') {
    if (previousScreen !== 'title') attractIdle.reset();
    if (!demoMode && !demoFailed && !reviewMode) void startDemo();
  }
  resize();
}

function resetDemoPresentation() {
  beaverTribute.reset();
  lakeOutcome.reset(); confidenceProps.grip.restore(); confidenceProps.ice.reset();
  reel.reset(); impact.reset(); simulationClock.reset(); lastPhase = null; cinematicFocus = null;
  vfx.clear(); gore.resetRound(); stage.resetRound(); weapons.clear(); droneStrike.clear();
  hud?.resetRound(); hud?.clearSay(); announcer.reset([]); fightCamera.impact = null;
  for (const side of [0, 1]) { views[side]?.resetDamage(); bufferedHits[side] = {}; players[side].clearHeld(); }
  audio.setMusic(demoMode === 'vignette' ? 'theme' : 'battle');
}

function updateDemoLabel() {
  const pair = match?.fighters.map(f => f.label).join('  vs  ') || 'Preparing exhibition…';
  document.querySelector('#demo-pair').textContent = pair;
  document.querySelector('#demo-caption').textContent = attract.label || 'Live exhibition';
  document.querySelector('#demo-full-caption').textContent = attract.label || 'Live exhibition';
}

async function startDemo(full = false) {
  if (practiceActive) return;
  demoFailed = false;
  demoMode = full ? 'full' : 'vignette';
  if (full) { void audio.unlock(); showScreen(null); }
  if (demoLoading || (running && match)) { updateDemoLabel(); return; }
  const pair = demoPair(roster, STAGES, attract.pairIndex);
  if (!pair) return;
  const token = ++demoEpoch;
  demoLoading = true;
  const started = await startMatch({ demo: true, setup: { ...config, ...pair, control: ['cpu', 'cpu'], difficulty: ['hard', 'hard'], roundsToWin: 1, hazards: true } });
  if (token !== demoEpoch) return;
  demoLoading = false;
  if (started === false && demoMode) {
    demoFailed = true; demoMode = null; document.body.classList.remove('demo-full'); showScreen('title');
    document.querySelector('#demo-caption').textContent = 'Demo unavailable. Select Demo to retry.';
    return;
  }
  if (!demoMode || !match) return;
  attract.begin(match); resetDemoPresentation(); updateDemoLabel();
}

function leaveDemo() {
  if (!demoMode && !demoLoading) return;
  beaverTribute.reset();
  demoMode = null; demoLoading = false; ++demoEpoch; ++loadEpoch; running = false; paused = false; match = null;
  attractIdle.reset(); audio.stop();
  stopRumble(navigator.getGamepads?.());
  hud?.root.remove(); hud = null;
  for (const view of views) if (view) view.root.visible = false;
  document.body.classList.remove('demo-full');
  weapons.clear(); droneStrike.clear(); reel.reset();
  lakeOutcome.reset(); confidenceProps.grip.restore(); confidenceProps.ice.reset(); confidenceProps.root.visible = false;
  vfx.clear(); gore.resetRound();
}

function exitFullDemo() {
  if (demoMode !== 'full') return false;
  demoMode = 'vignette'; audio.stop(); audio.setMusic('theme');
  for (const player of players) player.clearHeld();
  showScreen('title'); document.querySelector('#start-button').focus({ preventScroll: true });
  return true;
}

// ---- match lifecycle ------------------------------------------------------

async function ensureViews(setup = config) {
  const wanted = setup.fighters;
  const loads = [];
  for (let side = 0; side < 2; side += 1) {
    const definition = getFighter(wanted[side]);
    const wantedFormat = definition.runtime === 'gltf' ? 'gltf' : setup.modelFormat[side];
    if (views[side]?.ready && views[side].definition.id === definition.id && views[side].format === wantedFormat) continue;
    views[side]?.dispose();
    views[side] = new FighterView(definition, { scene, side });
    views[side].setDebris(gore);
    loads.push(views[side].load(setup.modelFormat[side]));
  }
  if (loads.length) {
    dom.loader.classList.remove('hidden');
    dom.loaderCopy.textContent = 'Loading fighters…';
    await Promise.all(loads);
    dom.loader.classList.add('hidden');
  }
}

function startMatch({ demo = false, setup = config } = {}) {
  if (!demo) leaveDemo();
  const token = ++loadEpoch;
  const task = pendingLoad.catch(() => {}).then(() => launchMatch(setup, demo, token));
  pendingLoad = task;
  return task;
}

async function launchMatch(setup, demo, token) {
  if (token !== loadEpoch) return false;
  beaverTribute.reset();
  vfx.clear();
  running = false; match = null; hud?.root.remove(); hud = null;
  lakeOutcome.reset(); confidenceProps.grip.restore(); confidenceProps.ice.reset(); confidenceProps.root.visible = false;
  for (const view of views) if (view) view.root.visible = false;
  loadingMatch = true; audio.stop(); audio.pause(false);
  weapons.clear();
  stage.setStage(setup.stage); ambience.setStage(stage.definition);
  postfx.setGrade(({ 'lake-america': 'lakeAmerica', capitol: 'capitol', 'palm-resort': 'palms', 'executive-lawn': 'lawn' })[setup.stage]);
  try {
    await Promise.all([stage.ready, ensureViews(setup), setup.fighters.includes('carney') ? beaverTribute.load() : null, demo || cinematicReview || lakePlayReview ? null : studio?.prewarm(), demo ? null : audio.unlock(), document.fonts.load('48px "Fatal Fighter"'), document.fonts.load('32px "Great Fighter"')]);
  } catch (error) {
    dom.loaderCopy.textContent = `Unable to load arena or fighters: ${error.message}. Try Fight again.`;
    dom.loader.classList.add('hidden'); selection?.previewError(error);
    loadingMatch = false; return false;
  }
  loadingMatch = false;
  if (token !== loadEpoch || (demo && !demoMode)) {
    for (const view of views) if (view) view.root.visible = false;
    return false;
  }
  reel.reset(); configureInput(); applyWireframe(); audio.setMusic('battle');
  const definitions = setup.fighters.map(getFighter);
  match = new Match({
    left: { id: definitions[0].id, label: definitions[0].label },
    right: { id: definitions[1].id, label: definitions[1].label },
    roundsToWin: setup.roundsToWin, stageId: setup.stage, hazards: practiceActive ? false : setup.hazards,
  });
  hud?.root.remove();
  const humanSides = demo ? [] : [0, 1].filter(side => setup.control[side] === 'human');
  hud = new Hud(dom.hudRoot, { fighters: definitions.map(f => ({ ...f, portrait: studio?.portraits.get(f.id) })), humanSides });
  if (!demo) playerProfile.begin({ humanSides, stage: setup.stage });
  if (lakePlayReview) playerProfile.abandon();
  announcer.reset(humanSides);
  for (let side = 0; side < 2; side += 1) cpus[side].setDifficulty(config.difficulty[side]);
  stage.resetRound();
  vfx.clear(); impact.reset(); fightCamera.impact = null;
  for (const side of [0, 1]) { bufferedHits[side] = {}; if (views[side]?.recoil) views[side].recoil.age = 1; views[side]?.resetDamage(); if (views[side]) views[side].root.visible = true; }
  simulationClock.reset();
  lastPhase = null;
  cinematicFocus = null;
  running = true;
  paused = false;
  for (const player of players) player.clearHeld();
  if (touch) touch.player = players[config.control[0] === 'human' ? 0 : 1];
  showScreen(demo && demoMode === 'vignette' ? 'title' : null);
  hud.clearSay();
  announceTimer = 0;
  return true;
}

function endMatch() {
  running = false;
  playerProfile.complete(match.snapshot());
  const snapshot = match.snapshot(), card = endCard(snapshot);
  document.querySelector('#result-title').textContent = card.title;
  document.querySelector('#result-kicker').textContent = card.subtitle;
  document.querySelector('#result-name').textContent = snapshot.winner === null ? 'MATCH DRAWN' : `${snapshot.fighters[snapshot.winner].label.toUpperCase()} WINS`;
  document.querySelector('#result-quote').textContent = snapshot.winner === null ? 'The rematch is waiting.' : stageOutcome(snapshot)?.quote || snapshot.finisher?.tagline || WIN_QUOTES[snapshot.winner];
  document.querySelector('#screen-result').dataset.kind = card.kind;
  showScreen('result');
}

async function previewReel(kind) {
  await startMatch();
  playerProfile.abandon();
  if (!match || kind === 'intro') return;
  match.fighters.forEach((f, side) => { f.x = side ? 0.5 : -0.5; f.state = 'idle'; });
  match.fighters[0].startMove('heavyPunch'); match.fighters[0].moveFrame = 10;
  match.fighters[1].enterHitStun(30, false);
  match.fighters[1].health = 0;
  if (kind === 'double') match.fighters[0].health = 0;
  else if (kind !== 'flawless') match.fighters[0].health = 650;
  match.endRound(kind === 'double' ? null : 0, kind === 'double' ? 'double' : 'ko');
  match.roundsToWin = 1;
  if (kind === 'fatality') { match.fatality = true; match.fighters[1].state = 'finished'; match.finishMatch(); }
  paused = true; debugWasPaused = false;
}

// ---- sim ------------------------------------------------------------------

function pollSide(side) {
  if (demoMode) return attract.input(side, match);
  if (practiceActive) {
    if (side === 0) {
      if (!practiceDemo) return players[0].poll();
      return demonstrationInput(practiceEntry, practiceFrame, match.left.facing, match);
    }
    return practiceDummyInput(match, practiceEntry, practiceDemo ? 'idle' : practiceDummy, practiceFrame);
  }
  return config.control[side] === 'cpu' ? cpus[side].poll(match) : players[side].poll();
}

function simStep() {
  if (paused) return;
  const inputs = [0, 1].map(side => {
    const input = { ...pollSide(side), ...bufferedHits[side] };
    // Render capture lasts one simulation tick. Match now owns hitstop input
    // sampling, including releases; retaining flags across it invents chords.
    bufferedHits[side] = {};
    return input;
  });
  if (practiceActive) sustainPractice(match, practiceEntry);
  if (demoMode) attract.beforeStep(match);
  const events = match.step(inputs);
  if (demoMode) attract.afterStep(match);
  if (practiceActive) {
    practiceFrame++;
    const pressed = Object.keys(inputs[0]).filter(k => inputs[0][k] && k !== 'start').join(' + ');
    if (pressed && pressed !== practicePreviousInput) {
      practiceHistory.push(pressed.toUpperCase()); practiceHistory = practiceHistory.slice(-4);
      practicePanel.history.textContent = `Inputs: ${practiceHistory.join(' → ')}`;
    }
    practicePreviousInput = pressed;
    if (!practiceDemo) {
      for (const k of ['left', 'right', 'up', 'down']) if (inputs[0][k]) practiceSeen.add(k);
      const lesson = practiceEntry?.id;
      if ((lesson === 'lesson-move' && practiceSeen.has('left') && practiceSeen.has('right')) ||
          (lesson === 'lesson-jump' && practiceSeen.has('up') && practiceSeen.has('down')) ||
          (lesson === 'lesson-sprint' && events.some(e => e.type === 'sprint' && e.side === 0)) ||
          (lesson === 'lesson-backhop' && events.some(e => e.type === 'backHop' && e.side === 0)) ||
          (lesson === 'lesson-recovery' && events.some(e => e.type === 'recovery' && e.side === 0)) ||
          (lesson === 'lesson-juggle' && events.some(e => e.type === 'hit' && e.attacker === 0 && e.juggle && e.juggleHits > 1)) ||
          (lesson === 'lesson-block' && events.some(e => e.type === 'block' && e.defender === 0))) practicePanel.status.textContent = 'Lesson complete. Choose the next lesson or explore the move library.';
    }
    for (const event of events) {
      if (['hit', 'block'].includes(event.type) && event.attacker === 0) practicePanel.stats.textContent = `${event.type === 'block' ? 'Blocked' : 'Hit'} · ${event.damage} damage · ${event.combo || 0} hits · ${event.comboDamage || event.damage} total`;
      if (!practiceDemo && practiceEntry?.group !== 'Fundamentals' && event.type === 'attack' && event.side === 0) practicePanel.status.textContent = event.move === practiceEntry?.id ? 'Move performed! Experiment with its reach, or choose another.' : `You performed ${match.left.moves[event.move]?.name || event.move}. Check the selected move’s inputs and try again.`;
      if (event.type === 'finisherStart') practicePanel.status.textContent = practiceDemo ? 'The real in-game cinematic. Watch again or select Try it.' : 'Finisher complete. Enjoy your handiwork.';
    }
    if (match.phase === PHASE.MATCH_END && match.phaseFrame > 150) practicePanel.onAction('reset', practiceEntry);
  }
  if (!practiceActive && !demoMode && match.phase === PHASE.FIGHT) playerProfile.tick(TICK);
  announcer.tick();
  for (const event of events) handleEvent(event);
  if (match.phase === PHASE.FINISHER && match.phaseFrame >= finisherReviewStop) paused = true;
  // Match owns hitstop. Presentation must never overwrite authoritative timing.
}

function worldToScreen(x, y) {
  projected.set(x, y, 0).project(camera);
  return [(projected.x + 1) / 2, (1 - projected.y) / 2];
}

// Camera shake per contact. The impact refactor moved dolly and freeze onto
// `impactProfile` but left shake behind, so only the announcer slams were
// moving the camera -- and because the arena's impact light is driven from
// shake, a heavy punch also stopped lighting the scene. Both are restored here
// from the same profile, so one table tunes the whole response to a hit.
function shakeFor(profile) {
  if (reducedMotion) return 0;
  if (profile.ko) return 0.8;
  if (profile.block) return 0.035;
  return Math.min(0.5, 0.06 + profile.power * 0.11 + (profile.type === 'counter' ? 0.05 : 0));
}

function handleEvent(event) {
  if (match.finisher && ['finisher', 'finisherBeat'].includes(event.type)) {
    const pose = finisherCinematicAt(match.finisher, match.phaseFrame)?.victim;
    if (pose) event = { ...event, x: stagedOrigin(match.finisher) + pose.x * match.finisher.facing, y: pose.y + (event.level === 'low' ? 0.65 : 1.35) };
  }
  if (event.type === 'hazardWarning') {
    hud.say(stage.definition.hazard.name.toUpperCase() + ' · MOVE OR JUMP', 'counter'); announceTimer = 1.1; return;
  }
  if (event.type === 'hazardBurst') {
    stage.impact({ ...event, type: 'hit', bloodScale: 2 }, { power: 2, heavy: true, type: 'blunt' });
    vfx.flash('ring', { x: event.x, y: 0.35, from: 0.6, to: 2.8, life: 0.35, color: new THREE.Color(stage.definition.accent), opacity: 0.85 });
    audio.effect('body_hit_large', { x: event.x, gain: 0.32, rate: 0.65 }); return;
  }
  // Overwatch. The summon is a servo and a lens; the beats are the two moments
  // worth spending screen on -- the lock, which is the player's warning, and
  // the crack of the beam, which is the only frame the whole stack agrees to
  // shake for. The drone's own motion is driven from the snapshot, not here.
  if (event.type === 'droneSummon') {
    vfx.onSummon(match.snapshot().strike);
    audio.effect('metal_punch', { x: event.x, gain: 0.3, rate: 1.65 });
    return;
  }
  if (event.type === 'droneBeat') {
    if (event.beat === 'lock') {
      hud.say('OVERWATCH · CLEAR THE LINE', 'counter'); announceTimer = 1.2;
      audio.effect('block_large', { x: event.x, gain: 0.22, rate: 1.9 });
    }
    if (event.beat === 'fire') {
      audio.effect('fire_punch_finisher', { x: event.x, gain: 0.42, rate: 1.25 });
      fightCamera.addShake(reducedMotion ? 0 : 0.34);
      postfx.pulse({ heavy: true, ko: false }, ...worldToScreen(event.x, 1.2));
      // No flash of its own: the drone already puts a light pool on the ice at
      // exactly this point, and stacking a bloom sprite on top of it was enough
      // to take the whole frame past the post stack's threshold.
    }
    return;
  }
  if (event.type === 'hazardHit') {
    handleEvent({ ...event, type: 'hit', move: 'heavyKick', combo: 0, counter: false, level: 'low' }); return;
  }
  if (!practiceActive && !demoMode) playerProfile.event(event, match.snapshot());
  if (event.type === 'finisherStart') {
    beaverTribute.reset();
    confidenceProps.ice.reset();
    hud.clearSay(); audio.voice(event.kind === 'friendship' ? 'disappointing' : 'execution');
    return;
  }
  if (event.type === 'finisherRange') {
    hud.say(event.range.label.toUpperCase(), 'counter'); announceTimer = 1; return;
  }
  if (event.type === 'finisherBeat') {
    if (match.finisher?.script === 'cold-cut-flock') {
      if (event.effectType === 'slapshot') {
        const cut = confidenceProps.ice.arms.get(event.region);
        if (cut) {
          const x = cut.pieces[0].mesh.position.x;
          stage.impact({ ...event, x, y: 0.08, type: 'hit', bloodScale: 1 }, { power: 1.5, heavy: true, type: 'blunt' });
          audio.effect('metal_punch', { x, gain: 0.5, rate: 0.8 });
          fightCamera.addShake(reducedMotion ? 0 : 0.18);
          vfx.flash('ring', { x, y: 0.08, from: 0.1, to: 0.75, life: 0.22, color: new THREE.Color(0xb9e6ff), opacity: 0.65 });
        }
        return;
      }
      if (event.region && preferences.settings.gore !== false && !reducedMotion) {
        const cut = views[event.defender]?.gore?.sever(event.region, { dx: event.facing, dy: 0, force: 1.5, cinematic: true });
        confidenceProps.ice.capture(cut);
        if (cut) audio.dismember?.(cut);
      }
    }
    if (event.effectType === 'final' || event.effectType === 'stage' || event.effectType === 'confetti') return;
    handleEvent({ ...event, type: 'hit', move: event.effectType === 'slash' ? 'heavyKick' : 'heavyPunch', damage: 0, combo: 0 });
    return;
  }
  if (event.type === 'finisher' && match.finisher?.kind === 'friendship') {
    vfx.confetti(event); audio.effect('metal_punch_finisher', { gain: 0.4, rate: 1.7 });
    hud.say('PLEASE HOLD…', 'counter'); return;
  }
  audio.event(event);
  announcer.event(event, match.snapshot());
  let profile = null;
  if (['hit', 'block', 'finisher'].includes(event.type)) {
    profile = impactProfile(event);
    impact.hit(profile);
    fightCamera.hit(event, profile);
    fightCamera.addShake(shakeFor(profile));
    stage.impact(event, profile);
    // Zoom blur and aberration centre on the contact point, so the screen
    // distorts away from where the blow landed rather than from frame centre.
    postfx.pulse(profile, ...worldToScreen(event.x, event.y));
    const defenderHealth = match.fighters[event.defender]?.health / (match.fighters[event.defender]?.maxHealth || 1);
    // Cinematic cuts are authored on the sequence, not chosen randomly by the
    // zero-health attrition system used during normal combat.
    const defenderView = views[event.defender];
    let torn;
    if (match.finisher && match.phase === PHASE.FINISHER) {
      defenderView?.recoil?.hit(event, profile);
      defenderView?.damage?.onHit(event, profile.power);
    } else torn = defenderView?.flinch(event, profile, defenderHealth ?? 1);
    // A limb coming off is its own impact, louder than the blow that caused it:
    // the screen shakes again, the arterial spray is bigger than a hit's, and
    // the announcer gets told so it can call it.
    for (const cut of torn || []) {
      vfx.onHit({ ...event, x: cut.x, y: cut.y, bloodScale: cut.force * 2.4, level: 'high' }, profile);
      stage.splatBlood(cut.x, 0.3, 0.7 + cut.force * 0.3, 26);
      fightCamera.addShake(shakeFor(profile) * 1.8);
      if (!reducedMotion) hud.splatterScreen(...worldToScreen(cut.x, cut.y), 0.9 + cut.force * 0.25);
      audio.dismember?.(cut);
    }
    for (const side of [event.defender, event.attacker]) {
      // Ask the player for its pad rather than indexing the raw array: after
      // the slot change, padIndex is an ordinal among connected pads and no
      // longer a position in what getGamepads() returns.
      if (!demoMode && preferences.settings.rumble && config.control[side] === 'human') rumble(players[side].pad(), profile, side === event.defender ? 1 : 0.55);
    }
  }
  switch (event.type) {
    case 'hit': {
      vfx.onHit(event, profile);
      if (event.damage > 0 && preferences.settings.damageNumbers) {
        const [dx, dy] = worldToScreen(event.x, event.y);
        hud.damageNumber(dx, dy, event.damage, event.counter ? 'counter' : profile.heavy ? 'heavy' : '');
      }
      // Record the fatal-blow level so the view can pick a low or high reaction.
      match.fighters[event.defender].lastHitLevel = event.level;
      if (event.bloodScale >= 1.2 && !reducedMotion) {
        const [nx, ny] = worldToScreen(event.x, event.y);
        hud.splatterScreen(nx, ny, Math.min(1.4, event.bloodScale * 0.5));
      }
      if (event.counter) { hud.say('COUNTER', 'counter'); announceTimer = 0.7; }
      break;
    }
    case 'block':
      vfx.onBlock(event);
      // Chip is small and easy to miss; showing it is what teaches a player
      // that guarding a heavy is not free.
      if (event.damage > 0 && preferences.settings.damageNumbers) {
        const [bx, by] = worldToScreen(event.x, event.y);
        hud.damageNumber(bx, by, event.damage, 'chip');
      }
      break;
    case 'finisher': {
      vfx.onFinisher(event);
      // Each cinematic chooses its lethal cut; ordinary hits cannot take heads.
      if (!reducedMotion && preferences.settings.gore !== false) {
        const loser = event.defender ?? (match.roundWinner === 0 ? 1 : 0);
        const victimGore = views[loser]?.gore;
        const cuts = ['cold-cut', 'cold-cut-flock'].includes(match.finisher?.script)
          ? [victimGore?.sever('head', { dx: match.finisher.facing, dy: 2.2, force: 3.4, cinematic: true })].filter(Boolean)
          : victimGore?.explode({ force: 3.4 }) || [];
        for (const cut of cuts) {
          if (tributeImpact(match.finisher) !== null && cut.region === 'head') beaverTribute.capture(cut);
          stage.splatBlood(cut.x, 0.3, 1.1, 40);
        }
        fightCamera.addShake(2.4);
      }

      const [nx, ny] = worldToScreen(event.x, event.y);
      if (!reducedMotion) hud.splatterScreen(nx, ny, 1.6);
      stage.splatBlood(event.x, 0.3, 1.5, 90);
      hud.clearSay();
      break;
    }
    case 'ko':
      break; // Lethal contact already dispatched its synchronized KO package.
    case 'roundEnd':
      hud.clearSay(); announceTimer = 0;
      break;
    case 'meterRequired':
      hud.say(`NEED ${event.stocks} METER`, 'counter'); announceTimer = 0.8;
      break;
    case 'roundStart':
      hud.resetRound();
      stage.resetRound();
      vfx.clear(); impact.reset(); fightCamera.impact = null; gore.resetRound(); droneStrike.clear();
  for (const side of [0, 1]) { bufferedHits[side] = {}; if (views[side]?.recoil) views[side].recoil.age = 1; views[side]?.resetDamage(); if (views[side]) views[side].root.visible = true; }
      hud.clearSay(); reel.reset(); audio.setMusic(decidingRound(match.snapshot()) ? 'final' : 'battle');
      announceTimer = 0;
      break;
    case 'finisherWindow':
      hud.clearSay(); announceTimer = 0;
      // Only the round winner can finish, so only show the button to a human
      // holding the pad on that side.
      touch?.setFinisherAvailable(event.winner === (config.control[0] === 'human' ? 0 : 1));
      break;
    case 'matchEnd':
      audio.setMusic('victory');
      touch?.setFinisherAvailable(false);
      break;
    default:
      break;
  }
}

// ---- frame ----------------------------------------------------------------

function frame() {
  const elapsedDt = Math.min(clock.getDelta(), 0.25);
  const realDt = Math.min(elapsedDt, 0.05), dt = realDt * debugSpeed;
  let advancedDt = 0;
  // Start is polled even while the simulation is paused.
  const startHeld = Array.from(navigator.getGamepads?.() || []).some(p => p?.buttons[9]?.pressed);
  if (!demoMode && startHeld && !frame.startHeld && running && !document.querySelector('dialog[open]')) setPaused(!paused);
  frame.startHeld = startHeld;
  // Menus take the pad whenever the fight is not using it; poll() no-ops (and
  // drops its focus ring) as soon as isActive() goes false.
  const pads = Array.from(navigator.getGamepads?.() || []).filter(Boolean);
  const padActive = pads.some(p => p.buttons.some(b => b.pressed) || p.axes.some(a => Math.abs(a) > .5));
  const wasFull = demoMode === 'full';
  if (padActive) { dom.screens.title.dataset.input = 'gamepad'; attractIdle.reset(); if (!frame.demoPadHeld) exitFullDemo(); }
  frame.demoPadHeld = padActive;
  if (!wasFull && !(demoMode === 'vignette' && padActive && frame.consumeDemoPad)) menuNav.poll();
  frame.consumeDemoPad = wasFull || (frame.consumeDemoPad && padActive);
  const demoBlocked = document.hidden || !document.hasFocus() || Boolean(document.querySelector('dialog[open]'));
  if (attractIdle.advance(elapsedDt * 1000, activeScreen === 'title' && !demoBlocked && !padActive && !loadingMatch && !demoFailed)) void startDemo(true);
  const countdown = document.querySelector('#demo-countdown');
  const countdownText = demoFailed ? 'Select Demo to retry' : `Auto demo in ${attractIdle.seconds}s`;
  if (countdown.textContent !== countdownText) countdown.textContent = countdownText;
  if (demoMode && match && running && !demoLoading && !demoBlocked && attract.ready(match)) {
    if (attract.next(match)) { resetDemoPresentation(); updateDemoLabel(); }
    else { running = false; void startDemo(demoMode === 'full'); }
  }
  if (running && !paused && (!demoMode || !demoBlocked)) {
    // Capture brief presses even when no simulation tick occurs this render.
    if (match.hitStop > 0) for (const side of [0, 1]) {
      if (demoMode || config.control[side] !== 'human') continue;
      const input = pollSide(side);
      for (const key of ['lp', 'hp', 'lk', 'hk', 'grab', 'throw', 'finisher'])
        if (input[key]) bufferedHits[side][key] = true;
    }
    simulationClock.advance(elapsedDt * debugSpeed, () => { simStep(); advancedDt += TICK; return !paused; },
      () => match.phase === PHASE.FINISHER ? finisherTimeScale(match.finisher, match.phaseFrame) : 1);
  }
  ambience.sync();
  let fxScale = 1, effectsDt = dt;
  if (match) {
    const snapshot = match.snapshot();
    if (!demoMode && (activeScreen === 'title' || activeScreen === 'setup')) { weapons.clear(); droneStrike.clear(); vfx.sync(null); }
    else {
      vfx.sync(snapshot);
      weapons.update(snapshot, paused ? 0 : realDt);
      // Real delta, like the post stack: the beam keeps boiling through the
      // hitstop its own contact caused, which is what makes the freeze read as
      // a freeze rather than as a dropped frame.
      droneStrike.update(snapshot.strike, paused ? 0 : realDt);
    }
    hazardMarker.update(snapshot.phase === PHASE.FIGHT ? snapshot.hazard : null, paused ? 0 : realDt, reducedMotion);
    const edit = demoMode || activeScreen === null || activeScreen === 'pause' ? reel.update(snapshot) : reelAt(snapshot);
    if (activeScreen === null && edit.stage === 'roundVictory' && snapshot.roundWinner !== null) audio.setMusic('victory');
    if (!practiceActive && !demoMode && snapshot.phase === PHASE.MATCH_END && snapshot.phaseFrame >= resultDuration(snapshot, REEL.resultFrames) && running) endMatch();
    if (snapshot.phase === PHASE.MATCH_END && (activeScreen === null || activeScreen === 'result')) audio.setMusic('victory');
    announcer.update(snapshot);
    if (lastPhase === PHASE.FINISHER_WINDOW && snapshot.phase === PHASE.MATCH_END && !snapshot.fatality)
      announcer.finisherExpired(snapshot);
    if (lastPhase !== snapshot.phase) { for (const p of players) p.clearHeld(); lastPhase = snapshot.phase; }
    const cinematic = snapshot.phase !== PHASE.FIGHT && snapshot.phase !== PHASE.FINISHER_WINDOW;
    const finisherRate = snapshot.phase === PHASE.FINISHER ? finisherTimeScale(snapshot.finisher, snapshot.phaseFrame) : 1;
    const scale = (edit.scale ?? 1) * impact.scale * finisherRate;
    fxScale = scale;
    if (snapshot.phase === PHASE.FINISHER) {
      effectsDt = advancedDt;
      fxScale = scale / finisherRate;
    }
    let actors = snapshot.fighters.map(v => ({ ...v }));
    const choreographyFrame = snapshot.phase === PHASE.MATCH_END ? 10000 : snapshot.phaseFrame
      + (snapshot.phase === PHASE.FINISHER && !paused ? simulationClock.fraction(finisherRate) : 0);
    const choreography = [PHASE.FINISHER, PHASE.MATCH_END].includes(snapshot.phase) ? finisherCinematicAt(snapshot.finisher, choreographyFrame) : null;
    if (choreography) for (const [role, side] of [['attacker', snapshot.finisher.attacker], ['victim', snapshot.finisher.defender]]) {
      const pose = choreography[role], actor = actors[side];
      actor.x = stagedOrigin(snapshot.finisher) + pose.x * snapshot.finisher.facing;
      actor.y = pose.y; actor.cinematicClip = pose.clip; actor.clipTime = pose.clipTime;
      actor.reelKey = snapshot.finisher.id + ':' + choreography.cut;
      actor.cinematicTurn = pose.turn;
      if (role === 'victim' && snapshot.finisher.kind === 'stage' && choreographyFrame >= 198) actor.y -= Math.min(2.8, (choreographyFrame - 198) / 30);
    }
    lakeOutcome.restore();
    const tributeActive = beaverTribute.active(snapshot);
    const ending = lakeOutcome.update(tributeActive ? { ...snapshot, stageId: null } : snapshot, actors, { reducedMotion, portrait: fightCamera.portrait,
      aspect: camera.aspect, fraction: paused || !running ? 0 : simulationClock.fraction(1) });
    if (ending) actors = ending.actors;
    actors = beaverTribute.actors(snapshot, actors, choreographyFrame);
    beaverTribute.restore();
    confidenceProps.grip.restore();
    for (let side = 0; side < 2; side++) {
      const v = actors[side]; v.lastHitLevel = match.fighters[side].lastHitLevel;
      if (edit.stage === 'versus') { v.state = 'idle'; v.x = side ? 1 : -1; v.reelKey = `${snapshot.round}:versus`; }
      if (edit.stage === 'walkout') {
        v.state = 'intro'; v.reelKey = `${snapshot.round}:intro`;
        const amount = Math.max(0, 1 - edit.t / 1.5);
        v.x += (side ? 1 : -1) * amount * 0.8;
      }
      if (edit.stage === 'round' || edit.stage === 'fight') v.state = 'idle';
      views[side]?.apply(v, paused || (match?.hitStop > 0) ? 0 : dt, { scale, freeAnimation: cinematic });
      views[side]?.applyRecoil(paused || (match?.hitStop > 0) ? 0 : dt * scale);
      if (choreography && !v.cinematicClip?.startsWith('lakeAmerica') && views[side]?.pivot) views[side].pivot.rotation.z = v.cinematicTurn * snapshot.finisher.facing;
      // FighterView restores the pivot before sampling. Zeroing one Euler
      // component here would erase part of a composed recovery roll or hop.
      if (edit.stage === 'versus' && views[side]?.pivot) views[side].pivot.rotation.y = side ? -0.5 : 0.5;
    }
    lakeOutcome.pose(ending, views, snapshot);
    confidenceProps.update(ending ? { ...snapshot, finisher: null } : snapshot, views, choreographyFrame, reducedMotion);
    const tribute = beaverTribute.update(snapshot, views, choreographyFrame, { reducedMotion, gore: preferences.settings.gore !== false });
    if (reviewStats) reviewStats.dataset.tribute = tribute ? JSON.stringify(tribute) : '';
    if (tribute && tribute.t >= TRIBUTE.lift) confidenceProps.stick.visible = false;
    else confidenceProps.stick.visible = true;
    beaverTribute.root.visible &&= Boolean(demoMode) || activeScreen === null || activeScreen === 'pause' || activeScreen === 'result';
    if (!choreography) confidenceProps.ice.reset();
    confidenceProps.root.visible &&= Boolean(demoMode) || activeScreen === null || activeScreen === 'pause' || activeScreen === 'result';
    const shown = { ...snapshot, fighters: actors, distance: Math.abs(actors[1].x - actors[0].x) };
    let shot = null;
    if (edit.stage === 'versus') shot = { z: reducedMotion ? 6.4 : 7.4 - Math.min(1, edit.t / 1.8), y: 1.65, lookY: 1.05 };
    else if (['roundVictory', 'result'].includes(edit.stage)) shot = { z: 6, y: 1.9, lookY: 1.08 };
    // The finisher earns its own shot: the rig drops to the ice and looks up,
    // so the blow lands over the viewer instead of beside them. It swings a
    // little off the side-on axis and then holds there -- a hero shot that
    // keeps drifting stops reading as one.
    else if (edit.stage === 'execution') shot = { z: 4.6, y: 0.82, lookY: 1.62, orbit: -0.3, orbitRate: 3.2 };
    // Ordinary KO framing keeps the fight axis readable.
    else if (['freeze', 'ko'].includes(edit.stage)) shot = { z: 5.3, y: 1.95, lookY: 1.25, orbit: 0.34 };
    else if (edit.stage === 'slowmo') shot = { z: 5.3, y: 1.95, lookY: 1.25 };
    if (choreography) shot = { ...choreography.camera, x: stagedOrigin(snapshot.finisher) + choreography.camera.x * snapshot.finisher.facing, tight: true, cut: snapshot.finisher.id + ':' + choreography.cut };
    if (choreography && snapshot.finisher.script === 'cold-cut-flock') {
      shot = coldCutCamera(Math.min(choreographyFrame, 510), stagedOrigin(snapshot.finisher), snapshot.finisher.facing,
        { reducedMotion, portrait: fightCamera.portrait, trackLimbs: preferences.settings.gore !== false,
          subjects: confidenceProps.ice.subjects() });
    }
    shot = ending?.shot || lakeEntranceCamera(snapshot, { reducedMotion, portrait: fightCamera.portrait, aspect: camera.aspect }) || shot;
    if (tribute && tribute.t >= 12) shot = tributeCamera(tribute.t, stagedOrigin(snapshot.finisher), snapshot.finisher.facing,
      { reducedMotion, portrait: fightCamera.portrait, aspect: camera.aspect });
    if (reviewCamera) shot = reviewCamera;
    fightCamera.update(paused || (match?.hitStop > 0) ? 0 : dt * scale, shown, { shot, reducedMotion, frozen: (match?.hitStop > 0), impactDt: paused ? 0 : realDt });
    hud.root.style.opacity = cinematic ? '0' : '1';
    hud.update(snapshot, paused ? 0 : dt, { project: worldToScreen, bindings: preferences.bindings });
    const touchSide = config.control[0] === 'human' ? 0 : 1;
    touch?.setAxeReady(Boolean((snapshot.axePrompt?.includes(touchSide) || snapshot.ringPrompt?.includes(touchSide)) && config.control[touchSide] === 'human'));
    touch?.setMeterStocks(snapshot.fighters[config.control[0] === 'human' ? 0 : 1].stocks);
    if (practiceActive) hud.timer.textContent = '∞';
    touch?.setVisible(!demoMode && activeScreen === null && !edit.locked && config.control.includes('human'));
    if (announceTimer > 0 && !paused) { announceTimer -= dt; if (announceTimer <= 0) hud.clearSay(); }
    for (let side = 0; side < 2; side++) {
      const f = match.fighters[side], hurt = f.hurtBox(), helper = boxHelpers[side];
      helper.visible = debugBoxes;
      helper.box.min.set(hurt.xMin, hurt.yMin, -0.2); helper.box.max.set(hurt.xMax, hurt.yMax, 0.2);
      const hitHelper = boxHelpers[side + 2]; hitHelper.visible = debugBoxes && f.state === 'attack';
      if (f.move) {
        const box = worldBox(f.moveOf().hit.box, f.x, f.y, f.facing);
        hitHelper.box.min.set(box.xMin, box.yMin, -0.12); hitHelper.box.max.set(box.xMax, box.yMax, 0.12);
      }
    }
    menus.updateStats(`PHASE  ${snapshot.phase} · frame ${snapshot.phaseFrame}\nFPS    ${Math.round(1 / Math.max(realDt, 0.001))}\nDRAW   ${renderer.info.render.calls} calls\nMODEL  ${views.map(v => v?.format || 'unloaded').join(' / ')}\nCLIP   ${views.map(v => v?.currentKey || '—').join(' / ')}`);
  }
  const worldDt = (paused && advancedDt === 0) || (match?.hitStop > 0) ? 0 : effectsDt * fxScale;
  vfx.update(worldDt);
  gore.update(worldDt, camera);
  stage.update(worldDt, Math.min(1, fightCamera.shake * 1.6));
  koFlash.style.opacity = !paused && !reducedMotion && activeScreen === null ? String(impact.ko / 12 * 0.65) : '0';
  // Real delta, not sim delta: grain keeps moving and the zoom blur holds
  // through hitstop instead of freezing into a still frame.
  postfx.update(paused ? 0 : realDt, { frozen: (match?.hitStop > 0) || paused, grade: paused ? 0 : impact.grade });
  renderer.info.autoReset = false;
  renderer.info.reset();
  postfx.render();
  // Drawn after the composer and deliberately outside it: the round reel is
  // titling, and titling that blooms and grades reads as a bug.
  if (activeScreen === null) reel.render(renderer);
  if (reviewStats) {
    frame.reviewFps = (frame.reviewFps ?? 60) * .95 + .05 / Math.max(elapsedDt, .001);
    reviewStats.textContent = `Frame ${match?.phaseFrame ?? 0} · ${Math.round(frame.reviewFps)} FPS · ${renderer.info.render.calls} draws · ${Math.round(renderer.info.render.triangles / 1000)}k triangles`;
  }
  if (!paused) impact.rendered(realDt);
  studio?.update(realDt, activeScreen === 'setup' && selection?.step === 'fighters');
}

function resize() {
  const viewportHeight = window.visualViewport?.height || innerHeight;
  document.documentElement.style.setProperty('--app-height', `${Math.round(viewportHeight)}px`);
  reel.resize();
  const width = dom.canvas.clientWidth || innerWidth;
  const height = dom.canvas.clientHeight || innerHeight;
  renderer.setSize(width, height, false);
  postfx.setSize(width, height);
  fightCamera.setViewport(width, height);
  hud?.resize();
}

function installScrollCue(scroller) {
  if (!scroller || scroller.querySelector(':scope > .scroll-cue')) return;
  const cue = document.createElement('p');
  cue.className = 'scroll-cue';
  cue.textContent = 'Swipe for more';
  cue.hidden = true;
  cue.setAttribute('aria-hidden', 'true');
  scroller.append(cue);
  const update = () => {
    const visible = scroller.matches('dialog') ? scroller.open : scroller.classList.contains('active');
    const shouldHide = !visible || scroller.scrollHeight <= scroller.clientHeight + 12 || scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 18;
    if (cue.hidden !== shouldHide) cue.hidden = shouldHide;
  };
  scroller.addEventListener('scroll', update, { passive: true });
  new ResizeObserver(update).observe(scroller);
  new MutationObserver(update).observe(scroller, { attributes: true, childList: true, subtree: true });
  requestAnimationFrame(update);
}

// ---- screens and controls -------------------------------------------------

function refreshSetup() {
  for (let side = 0; side < 2; side += 1) {
    const definition = getFighter(config.fighters[side]);
    document.querySelector(`[data-name="${side}"]`).textContent = definition.label;
    const portrait = document.querySelector(`[data-portrait="${side}"]`);
    portrait.dataset.initial = definition.label[0].toUpperCase();
    for (const button of document.querySelectorAll(`[data-control="${side}"]`)) {
      button.classList.toggle('active', button.dataset.value === config.control[side]);
    }
    document.querySelector(`[data-difficulty-field="${side}"]`).hidden = config.control[side] !== 'cpu';
  }
}

function buildDifficultySelects() {
  for (let side = 0; side < 2; side += 1) {
    const select = document.querySelector(`[data-difficulty="${side}"]`);
    select.replaceChildren(...Object.entries(DIFFICULTIES).map(([id, preset]) => {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = preset.label;
      option.selected = id === config.difficulty[side];
      return option;
    }));
    select.addEventListener('change', () => { config.difficulty[side] = select.value; });
  }
}

function wireUi() {
  buildDifficultySelects();
  refreshSetup();
  for (const target of ['#screen-title .screen-inner', '#screen-pause .screen-inner']) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-ghost'; b.textContent = target.includes('title') ? 'Practice' : 'Practice · Learn every move';
    b.onclick = () => practicePanel.open(); document.querySelector(target).append(b);
  }
  const made = document.createElement('a'); made.className = 'btn btn-ghost'; made.textContent = 'How this game was made ↗'; made.href = 'made.html'; made.target = '_blank'; made.rel = 'noopener';
  document.querySelector('#screen-pause .screen-inner').append(made);

  document.querySelector('#start-button').addEventListener('click', () => {
    leaveDemo(); selection.reset();
    void audio.unlock().then(() => audio.voice('select')); audio.setMusic('theme'); showScreen('setup');
  });
  document.querySelector('#demo-button').addEventListener('click', () => { void startDemo(true); });
  const titleActions = document.querySelector('#title-actions');
  const practiceButton = document.querySelector('#screen-title .screen-inner > button');
  if (practiceButton) titleActions.insertBefore(practiceButton, document.querySelector('#demo-button'));
  const productActions = document.querySelector('.title-product-actions');
  if (productActions) { titleActions.append(...productActions.children); productActions.remove(); }
  installTitleMenu();
  document.querySelector('#fight-button').addEventListener('click', () => { void startMatch(); });
  document.querySelector('#swap-button').addEventListener('click', () => {
    config.fighters.reverse();
    refreshSetup();
  });
  document.querySelector('#rounds-select').addEventListener('change', (event) => {
    config.roundsToWin = Number(event.target.value);
  });
  for (const button of document.querySelectorAll('[data-control]')) {
    button.addEventListener('click', () => {
      config.control[Number(button.dataset.control)] = button.dataset.value;
      refreshSetup();
      touch?.setVisible(false);
    });
  }
  document.querySelector('#rematch-button').addEventListener('click', () => { void startMatch(); });
  document.querySelector('#setup-button').addEventListener('click', () => { audio.setMusic('theme'); showScreen('setup'); });
  document.querySelector('#moves-button').addEventListener('click', () => menus.showMoves());
  document.querySelector('#resume-button').addEventListener('click', () => setPaused(false));
  document.querySelector('#quit-button').addEventListener('click', () => {
    leavePractice();
    running = false; playerProfile.abandon(); stopRumble(navigator.getGamepads?.());
    paused = false; audio.pause(false); audio.stop(); audio.setMusic('theme');
    showScreen('setup');
  });
  dom.pauseButton.addEventListener('click', () => setPaused(!paused));
}

function setPaused(next) {
  if (demoMode) return;
  if (!running) return;
  paused = next;
  if (next) { stopRumble(navigator.getGamepads?.()); bufferedHits[0] = {}; bufferedHits[1] = {}; }
  audio.pause(next);
  showScreen(next ? 'pause' : null);
  if (!next) clock.getDelta();
  for (const player of players) player.clearHeld();
}

addEventListener('keydown', (event) => {
  if (activeScreen === 'title' || demoMode) return;
  if (event.code === 'Backquote') { event.preventDefault(); if (!event.repeat) menus.toggleDebug(); return; }
  if (event.target.closest?.('dialog, input, select, textarea')) return;
  if (event.key === 'Escape') { setPaused(!paused); return; }
  if (event.repeat) return;
  let claimed = false;
  for (const player of players) claimed = player.onKeyDown(event.key, event.code) || claimed;
  if (claimed) event.preventDefault();
});
let consumeDemoClick = false, consumedDemoKey = null;
for (const type of ['keydown', 'pointerdown', 'pointermove', 'wheel']) {
  addEventListener(type, event => {
    attractIdle.reset();
    if (type === 'keydown' && consumedDemoKey === event.code) {
      event.preventDefault(); event.stopImmediatePropagation(); return;
    }
    if (type === 'pointerdown' && demoMode !== 'full') consumeDemoClick = false;
    if (type === 'pointermove' || type === 'wheel') return;
    if (exitFullDemo()) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (type === 'pointerdown') consumeDemoClick = true;
      if (type === 'keydown') consumedDemoKey = event.code;
      return;
    }
  }, { capture: true });
}
addEventListener('keyup', event => {
  if (event.code !== consumedDemoKey) return;
  consumedDemoKey = null; event.preventDefault(); event.stopImmediatePropagation();
}, { capture: true });
addEventListener('blur', () => { consumedDemoKey = null; consumeDemoClick = false; });
addEventListener('contextmenu', event => { if (consumeDemoClick) event.preventDefault(); }, { capture: true });
addEventListener('click', event => {
  if (!consumeDemoClick) return;
  consumeDemoClick = false; event.preventDefault(); event.stopImmediatePropagation();
}, { capture: true });
document.querySelector('#demo-exit').addEventListener('click', exitFullDemo);
addEventListener('keyup', (event) => {
  for (const player of players) player.onKeyUp(event.key, event.code);
});
addEventListener('resize', resize);
addEventListener('orientationchange', () => setTimeout(resize, 120));
window.visualViewport?.addEventListener('resize', resize);
// Silence everything the moment the tab or window loses focus. A backgrounded
// game — especially on a phone, where switching apps or locking the screen
// does not stop the page — otherwise keeps the music, effects and announcer
// running. In a live match we also pause the sim; in the menus we just suspend
// the audio graph and bring it back on return, unless the player is sitting on
// the pause screen and expects it to stay quiet.
function suspendAudioForBlur() {
  audio.pause(true);
  for (const player of players) player.clearHeld();
}
function resumeAudioFromBlur() {
  attractIdle.reset();
  if (!paused) audio.pause(false);
  clock.getDelta();
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (running) setPaused(true);
    suspendAudioForBlur();
  } else {
    resumeAudioFromBlur();
  }
});
// visibilitychange does not fire for a desktop alt-tab that leaves the tab
// visible; blur/focus and pagehide cover that and the mobile app-switch.
addEventListener('blur', suspendAudioForBlur);
addEventListener('focus', resumeAudioFromBlur);
addEventListener('pagehide', suspendAudioForBlur);
addEventListener('gamepadconnected', () => { /* polled on demand */ });
// Keep the gesture bridge available until a browser accepts media playback.
// unlock() is idempotent after setup and retries only a paused, unfinished
// music element, so denied autoplay cannot leave the entire session silent.
const unlockAudio = () => { if (!paused) void audio.unlock(); };
addEventListener('pointerdown', unlockAudio);
addEventListener('keydown', unlockAudio);

wireUi();
studio = new PortraitStudio({ renderer, roster, reducedMotion, onPortrait: (id, url) => selection?.setPortrait(id, url) });
selection = new SelectionScreen({ container: dom.screens.setup, config, roster, stages: STAGES, difficulties: DIFFICULTIES,
  onFight: startMatch, onChange: refreshSetup, onPreview: (id, side) => studio.select(id, side).catch(error => selection.previewError(error)),
  onOptions: () => menus.showOptions(), onProfile: () => menus.showProfile(), onBack: () => showScreen('title') });
selection.setPreviewCanvas(studio.canvas);
[...document.querySelectorAll('.screen, .game-dialog')].forEach(installScrollCue);
const menuNav = new MenuNavigator({
  isActive: () => !running || paused || activeScreen !== null || Boolean(document.querySelector('dialog[open]')),
  onBack: (screen) => {
    if (screen.id === 'screen-pause') setPaused(false);
    else if (screen.id === 'screen-result') { audio.setMusic('theme'); showScreen('setup'); }
    else if (screen.id === 'screen-setup' && !selection.back()) showScreen('title');
  },
});
if (touch) touch.onSecrets = () => {
  setPaused(true); menus.showMoves();
  [...menus.moves.querySelectorAll('.move-tabs button')].find(button => button.textContent === 'Finish')?.click();
};
applyOptions();
resize();
showScreen('title');
dom.loader.classList.add('hidden');
renderer.setAnimationLoop(frame);

// Browser-agent hooks, when the host supports them. Same reader the HUD uses.
const lifecycle = new AbortController();
registerFightTools(document.modelContext, {
  read: () => (match ? match.snapshot() : { phase: 'menu' }),
  press: (button, frames) => players[0].setTouch(button, true) || setTimeout(() => players[0].setTouch(button, false), frames * 16),
}, lifecycle.signal);
addEventListener('beforeunload', () => lifecycle.abort(), { once: true });

window.__FIGHT__ = {
  // The fighter views and the debris pool, so the asset-review pages and a
  // browser agent can trigger a severance without landing a real hit.
  views, gore, droneStrike,
  start: startMatch,
  snapshot: () => match?.snapshot(),
  // The live match, so a review page can put a fighter into a specific move
  // without having to type the command that performs it.
  match: () => match,
  config,
  scene,
  camera,
  renderer,
  demo: () => ({ mode: demoMode, label: attract.label, seconds: attractIdle.seconds }),
};



function applyOptions() {
  configureInput();
  reducedMotion = preferences.reducedMotion(matchMedia('(prefers-reduced-motion: reduce)').matches);
  quality = preferences.qualityValue(coarsePointer || (navigator.hardwareConcurrency || 8) <= 4);
  for (const target of [stage, vfx, postfx, reel, studio, droneStrike]) if (target) target.reducedMotion = reducedMotion;
  stage.environment?.update(0);
  document.body.classList.toggle('reduce-motion', reducedMotion);
  vfx.quality = quality;
  droneStrike.quality = quality;
  renderer.setPixelRatio(Math.min(devicePixelRatio, quality < 1 ? 1 : 1.75));
  renderer.shadowMap.enabled = quality >= 1;
  postfx.bloom.enabled = quality >= 1;
  postfx.composer.setPixelRatio(renderer.getPixelRatio());
  if (!preferences.settings.rumble) stopRumble(navigator.getGamepads?.());
  // Gore is a setting, and reduced motion turns it off on its own: a body
  // coming apart is the single most motion-heavy thing on screen.
  const goreOn = preferences.settings.gore !== false && !reducedMotion;
  for (const view of views) if (view?.gore) view.gore.enabled = goreOn;
  if (!goreOn) gore.resetRound();
  resize();
}

function stagedOrigin(finisher) { return Math.max(-1.4, Math.min(1.4, finisher.originX)); }

// Local visual acceptance uses the real match, effects and renderer, with
// repeatable pause points. No alternate rendering implementation to drift.
let finisherReviewStop = Infinity;
let reviewCamera = null, reviewStats = null;
if (cinematicReview) {
  const panel = document.createElement('aside');
  panel.style.cssText = 'position:fixed;z-index:10000;bottom:8px;right:8px;background:#101923ed;padding:10px;border:1px solid #9cc8db;color:white;font:13px system-ui;display:flex;gap:6px;flex-wrap:wrap;max-width:650px';
  const status = document.createElement('span'); status.textContent = 'Carney finisher review'; panel.append(status);
  let side = 0, opponent = 'officer_flock';
  const launch = async target => {
    if (loadingMatch) return;
    reviewCamera = null;
    finisherReviewStop = target;
    config.fighters = side ? [opponent, 'carney'] : ['carney', opponent];
    config.control = ['human', 'human']; config.stage = 'lake-america'; config.hazards = false;
    confidenceProps.ice.reset(); gore.resetRound();
    const controls = panel.querySelectorAll('button'); controls.forEach(button => { button.disabled = true; });
    let started;
    try { started = await startMatch(); } finally { controls.forEach(button => { button.disabled = false; }); }
    if (started === false) return;
    // Review runs never award profile statistics.
    playerProfile.abandon();
    practiceActive = false; practiceDemo = false; practiceEntry = null; practicePanel.root.hidden = true;
    document.body.classList.remove('practice-active');
    match.fighters[side].roundsWon = match.roundsToWin;
    match.fighters[1 - side].health = 0;
    match.roundWinner = side;
    match.startFinisher(fatalitiesFor('carney').find(f => f.id === 'carney-cold-cut'), side);
    for (const event of match.events) handleEvent(event);
    status.textContent = Number.isFinite(target) ? `Pause at frame ${target}` : 'Playing · cinematic time ramps';
  };
  for (const [label, target] of [['Play finisher', Infinity], ['Arms down', 160], ['First slapshot', 204], ['Second slapshot', 250], ['Return', 350], ['Final strike', 394], ['Head slide', 490], ['Beaver pickup', 568], ['Head handoff', 700], ['Signpost', 787], ['Hero shot', 848]]) {
    const button = document.createElement('button'); button.textContent = label;
    button.onclick = () => { void launch(target); }; panel.append(button);
  }
  const mirror = document.createElement('button'); mirror.textContent = 'Mirror sides';
  mirror.onclick = () => { side = 1 - side; void launch(160); }; panel.append(mirror);
  const partner = document.createElement('button'); partner.textContent = 'Opponent: Flock';
  partner.onclick = () => { opponent = opponent === 'officer_flock' ? 'trump' : 'officer_flock'; partner.textContent = `Opponent: ${opponent === 'trump' ? 'Trump' : 'Flock'}`; void launch(1); }; panel.append(partner);
  for (const [label, position, target] of [
    ['Stage wide', [0, 2.24, 8.2], [0, 1.46, 0]],
    ['Orbit 45°', [6, 2.4, 6], [0, 1.2, 0]],
    ['Reverse', [0, 2.2, -7], [0, 1.2, 0]],
    ['Aerial', [12, 22, 22], [0, 0, -4]],
  ]) {
    const button = document.createElement('button'); button.textContent = label;
    button.onclick = async () => { await launch(1); reviewCamera = { authored: true, position, target, fov: 38 }; };
    panel.append(button);
  }
  reviewStats = document.createElement('span'); reviewStats.style.cssText = 'flex-basis:100%;font-size:11px;color:#c3d7e3'; panel.append(reviewStats);
  document.body.append(panel);
}

if (lakePlayReview) {
  const panel = document.createElement('aside');
  panel.style.cssText = 'position:fixed;z-index:10000;bottom:10px;right:10px;display:flex;gap:10px;align-items:center;padding:10px;background:#101923ed;border:1px solid #9cc8db;color:white;font:13px system-ui';
  const launch = document.createElement('button'); launch.textContent = 'Play Lake America';
  launch.onclick = async () => {
    config.stage = 'lake-america'; config.fighters = ['carney', 'trump'];
    config.control = ['human', 'cpu'];
    launch.disabled = true;
    try { await startMatch(); } finally { launch.disabled = false; }
  };
  const art = document.createElement('a'); art.textContent = 'Back to art review'; art.href = './lake-america.html'; art.style.color = '#a8dfff';
  panel.append(launch, art); document.body.append(panel);
}

if (reviewMode === 'lake-endings') {
  const panel = document.createElement('aside');
  panel.style.cssText = 'position:fixed;z-index:10000;bottom:10px;right:10px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;max-width:700px;padding:12px;background:#101923ed;border:1px solid #9cc8db;color:white;font:14px system-ui';
  const winner = document.createElement('select'), loser = document.createElement('select');
  winner.setAttribute('aria-label', 'Winning fighter'); loser.setAttribute('aria-label', 'Losing fighter');
  for (const fighter of roster) {
    winner.add(new Option(`${fighter.label} wins`, fighter.id));
    loser.add(new Option(`${fighter.label} loses`, fighter.id));
  }
  winner.value = 'carney'; loser.value = 'trump';
  const play = document.createElement('button'); play.textContent = 'Play ending';
  const intro = document.createElement('button'); intro.textContent = 'Play camera entrance';
  const pause = document.createElement('button'); pause.textContent = 'Pause / resume';
  const motion = document.createElement('button');
  const motionLabel = () => { motion.textContent = reducedMotion ? 'Camera: Reduced motion' : 'Camera: Full motion'; };
  motionLabel();
  motion.onclick = () => { preferences.set('motion', reducedMotion ? 'full' : 'reduced'); applyOptions(); motionLabel(); };
  const scrub = document.createElement('input'); scrub.type = 'range'; scrub.min = '0'; scrub.max = '599'; scrub.value = '0';
  scrub.setAttribute('aria-label', 'Ending frame');
  const status = document.createElement('span'); status.textContent = 'Lake America endings';
  const launch = async (ending = true) => {
    if (loadingMatch) return;
    lakeOutcome.reset(); reviewCamera = null;
    config.fighters = [winner.value, loser.value]; config.control = ['human', 'human'];
    config.stage = 'lake-america'; config.hazards = false;
    play.disabled = intro.disabled = true;
    let started;
    try { started = await startMatch(); } finally { play.disabled = intro.disabled = false; }
    if (started === false) return;
    playerProfile.abandon();
    if (ending) {
      match.fighters[0].roundsWon = match.roundsToWin; match.fighters[1].health = 0;
      match.roundWinner = 0; match.finishMatch();
    }
    status.textContent = ending ? `${winner.selectedOptions[0].text} · ${loser.selectedOptions[0].text}` : 'Entrance · 180° and back';
  };
  play.onclick = () => { void launch(); }; intro.onclick = () => { void launch(false); };
  pause.onclick = () => { if (match && running) paused = !paused; };
  scrub.oninput = () => {
    if (match?.phase !== PHASE.MATCH_END) return;
    paused = true; match.phaseFrame = Number(scrub.value);
    status.textContent = `${(match.phaseFrame / 60).toFixed(2)} s`;
  };
  panel.append(winner, loser, play, intro, pause, motion, scrub, status); document.body.append(panel);
}
